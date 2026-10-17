"""External validation of the twin + risk layer on real, open, de-identified CGM records.

Pipeline (``pratibimb validate-real --glyco-path <GlycoTwin repo>``):

1. :mod:`.adapter` converts GlycoTwin's harmonised CGMacros + ShanghaiT2DM store to Pratibimb records.
2. The unchanged EnKF twin (population priors from the EHR, no re-tuning) is run over every record;
   at each 15-min decision point we keep the +120-min ensemble forecast summary (Pratibimb's twin
   features) and Pratibimb's causal features.
3. Forecasts are scored against the CGM at the *same timestamps* as GlycoTwin's out-of-fold LightGBM
   predictions (its ``oof_predictions.parquet``); persistence and linear extrapolation as baselines.
4. Risk: GlycoTwin's features and patient-level folds (``models/folds.json``), LightGBM with GlycoTwin's
   fixed hyper-parameters (no early stopping, nothing tuned on test folds), with and without twin
   features; plus the synthetic-trained Pratibimb hybrid model applied with no retraining (transfer).

Only aggregate metrics leave ``data/real`` (git-ignored, licence note in ``docs/REAL_DATA.md``).
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from multiprocessing import Pool
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from ..config import IST, REPO_DIR, SAMPLES_PER_DAY, STEP_MIN, get_profile, paths_for
from ..jsonutil import clean
from ..ml.features import compute_features
from ..ml.parkes import zone_shares
from ..observables import observed_from
from ..twin.assimilate import DP_STEP, TWIN_FEATURES, twin_features_from_traj
from ..twin.enkf import TwinRun
from ..twin.forecast import HabitPrior, ensemble_forecast, forecast_seed
from .adapter import LICENCES, build_all, real_root, record_seed

HORIZONS = (30, 60, 120)


def dump_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(clean(obj), fh, indent=1)
        fh.write("\n")


EXTRA_TWIN = ["p_ge180_120"]
# GlycoTwin's classifier settings (glycotwin/models.py, MIT): fixed rounds, no early stopping.
GLYCO_CLF_PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=31, min_data_in_leaf=80,
                        feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1,
                        seed=7, num_threads=6)
GLYCO_N_ROUNDS = 250
GLYCO_NON_FEATURES = {"twin_id", "time", "y_delta_30", "y_delta_60", "y_delta_120", "y_spike", "y_hypo",
                      "spike_onset", "person_id", "cohort", "diabetes_status"}
WARMUP_K = SAMPLES_PER_DAY  # first 24 h of each record are twin warm-up (same rule as the synthetic evaluation)


# ---------------------------------------------------------------------------------------------------
def _assimilate_one(args: tuple) -> dict:
    rec_dir, out_dir, rid, m = args
    t0 = time.time()
    rec = json.loads((Path(rec_dir) / f"{rid}.json").read_text(encoding="utf-8"))
    z = dict(np.load(Path(rec_dir) / f"{rid}.npz"))
    obs = observed_from(rec, z)
    run = TwinRun(obs, m, record_seed(rid))
    prior = HabitPrior(run)
    ks, feats = [], []

    def on_block(b, k0, keeps, prior_arr, pmean):
        for i in range(keeps.shape[0]):
            k = k0 + DP_STEP * (i + 1)
            zk = keeps[i]
            traj = ensemble_forecast(run, zk, k, 120, prior, forecast_seed(run, k))
            f = twin_features_from_traj(run, traj, zk, k, prior_arr[:, 0], pmean)
            p180 = float((traj[:, 1:] >= 180.0).any(axis=1).mean())
            ks.append(k)
            feats.append(np.concatenate([f, [p180]]))

    out = run.run(on_block=on_block, keep_every=DP_STEP)
    ks_arr = np.array(ks, dtype=int)
    df = compute_features(obs, ks_arr, run.drv).add_prefix("pb_")
    tw = pd.DataFrame(np.array(feats, dtype=np.float32), columns=TWIN_FEATURES + EXTRA_TWIN)
    df = pd.concat([df.reset_index(drop=True), tw], axis=1)
    df.insert(0, "k", ks_arr)
    df.insert(0, "rid", rid)
    df.to_parquet(Path(out_dir) / f"{rid}.parquet", index=False)
    g_fin = np.isfinite(obs.cgm)
    sync = np.abs(out.q[g_fin, 1] - obs.cgm[g_fin]) / obs.cgm[g_fin]
    return {"rid": rid, "applied": int(out.applied), "seconds": round(time.time() - t0, 1),
            "sync_mard": float(np.nanmean(sync[1:]) * 100) if sync.size > 1 else None}


def assimilate_real(rec_dir: Path, out_dir: Path, rids: list[str], m: int, workers: int, log=print) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    args = [(str(rec_dir), str(out_dir), r, m) for r in rids]
    workers = max(1, min(workers, 6))
    t0 = time.time()
    if workers == 1:
        rows = [_assimilate_one(a) for a in args]
    else:
        with Pool(workers) as pool:
            rows = list(pool.imap_unordered(_assimilate_one, args, chunksize=1))
    log(f"real-data twin: {len(rows)} records assimilated in {time.time() - t0:.0f}s")
    return sorted(rows, key=lambda r: r["rid"])


# ---------------------------------------------------------------------------------------------------
def _auc(y, s) -> float | None:
    y = np.asarray(y)
    return float(roc_auc_score(y, s)) if len(np.unique(y)) == 2 else None


def _ap(y, s) -> float | None:
    y = np.asarray(y)
    return float(average_precision_score(y, s)) if len(np.unique(y)) == 2 else None


def _r(x, nd=4):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), nd)


def _boot(frame: pd.DataFrame, label: str, scores: list[str], n_boot: int = 200, seed: int = 0) -> dict:
    """Person-level bootstrap 95% CI for AUROC/AUPRC of each score, and of the paired delta vs scores[0]."""
    rng = np.random.default_rng(seed)
    groups = [g.index.to_numpy() for _, g in frame.groupby("person_id")]
    res = {s: {"auroc": [], "auprc": []} for s in scores}
    delta = {s: {"auroc": [], "auprc": []} for s in scores[1:]}
    for _ in range(n_boot):
        idx = np.concatenate([groups[i] for i in rng.integers(0, len(groups), len(groups))])
        sub = frame.loc[idx]
        y = sub[label].to_numpy()
        if len(np.unique(y)) < 2:
            continue
        base = {}
        for s in scores:
            a, p = roc_auc_score(y, sub[s]), average_precision_score(y, sub[s])
            res[s]["auroc"].append(a)
            res[s]["auprc"].append(p)
            base[s] = (a, p)
        for s in scores[1:]:
            delta[s]["auroc"].append(base[s][0] - base[scores[0]][0])
            delta[s]["auprc"].append(base[s][1] - base[scores[0]][1])
    ci = lambda v: [round(float(np.quantile(v, 0.025)), 4), round(float(np.quantile(v, 0.975)), 4)] if v else None  # noqa: E731
    return {"ci95": {s: {k: ci(v) for k, v in d.items()} for s, d in res.items()},
            "delta_ci95_vs_" + scores[0]: {s: {k: ci(v) for k, v in d.items()} for s, d in delta.items()}}


def _future_label(series: pd.DataFrame, thr: float, strict: bool) -> pd.DataFrame:
    """GlycoTwin-style event label on its 15-min grid: current below ``thr`` and any CGM >= thr (``>`` if
    strict) in the next 120 min, with >= 6 of the 8 future readings present."""
    out = []
    for tid, d in series.groupby("twin_id", sort=False):
        d = d.sort_values("time").reset_index(drop=True)
        g = d["glucose"].astype(float)
        fut = np.column_stack([g.shift(-j).to_numpy() for j in range(1, 9)])
        enough = np.isfinite(fut).sum(1) >= 6
        fmax = np.nanmax(np.where(np.isfinite(fut), fut, -np.inf), 1)
        hit = (fmax > thr) if strict else (fmax >= thr)
        now_ok = g.to_numpy() < thr
        y = np.where(enough & now_ok, hit.astype(float), np.nan)
        out.append(pd.DataFrame({"twin_id": tid, "time": d["time"], "y": y}))
    return pd.concat(out, ignore_index=True)


def _cv_predict(frame: pd.DataFrame, cols: list[str], label: str) -> np.ndarray:
    p = np.full(len(frame), np.nan)
    for k in sorted(frame["fold"].unique()):
        tr = (frame["fold"] != k).to_numpy()
        te = ~tr
        b = lgb.train(GLYCO_CLF_PARAMS, lgb.Dataset(frame.loc[tr, cols].to_numpy(np.float32),
                                                    frame.loc[tr, label].to_numpy()), GLYCO_N_ROUNDS)
        p[te] = b.predict(frame.loc[te, cols].to_numpy(np.float32))
    return p


def _synthetic_stats(profile_name: str = "full") -> dict | None:
    """GlycoTwin-style event rates and 30-min volatility on the synthetic CGM, sub-sampled to 15 min."""
    paths = paths_for(get_profile(profile_name))
    files = sorted(paths.patients.glob("*.npz"))
    if not files:
        return None
    n180 = d180 = n250 = d250 = 0
    dv = []
    for f in files:
        g = np.load(f)["cgm"].astype(float)[::3]
        fut = np.column_stack([np.concatenate([g[j:], np.full(j, np.nan)]) for j in range(1, 9)])
        enough = np.isfinite(fut).sum(1) >= 6
        fmax = np.nanmax(np.where(np.isfinite(fut), fut, -np.inf), 1)
        idx = np.arange(g.size) >= WARMUP_K // 3
        e180 = enough & (g < 180) & idx
        e250 = enough & (g < 250) & idx
        n180 += int((fmax[e180] >= 180).sum())
        d180 += int(e180.sum())
        n250 += int((fmax[e250] > 250).sum())
        d250 += int(e250.sum())
        d = g[2:] - g[:-2]
        dv.append(d[np.isfinite(d)])
    dv = np.concatenate(dv)
    return {"rate_ge180": n180 / max(d180, 1), "rate_gt250": n250 / max(d250, 1), "sd_delta30": float(dv.std()),
            "n_patients": len(files)}


# ---------------------------------------------------------------------------------------------------
def evaluate_real(glyco: Path, root: Path, assim_rows: list[dict], log=print) -> tuple[dict, dict]:
    glyco = Path(glyco)
    man = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    recs = pd.DataFrame(man["records"])
    proc = glyco / "data" / "processed"
    pts = pd.read_parquet(proc / "patients.parquet")
    pts = pts[pts["twin_id"].isin(recs["twin_id"])]
    folds = json.loads((glyco / "models" / "folds.json").read_text(encoding="utf-8"))

    tw = pd.concat([pd.read_parquet(root / "twin" / f"{r}.parquet") for r in recs["id"]], ignore_index=True)
    tw = tw.merge(recs[["id", "twin_id"]].rename(columns={"id": "rid"}), on="rid")
    origin = {r.twin_id: pd.Timestamp(r.origin) for r in recs.itertuples()}

    def add_k(df: pd.DataFrame) -> pd.DataFrame:
        df = df[df["twin_id"].isin(origin)].copy()
        o = df["twin_id"].map(origin)
        mins = (df["time"] - pd.to_datetime(o.to_numpy())) / pd.Timedelta(minutes=1)
        df["k"] = np.round(mins.to_numpy() / STEP_MIN).astype(int)
        return df

    # ---------------- forecast ----------------
    oof_cols = ["twin_id", "person_id", "cohort", "time", "g0", "hours_since_start"] + \
        [c for h in HORIZONS for c in (f"full_{h}", f"full_{h}_lo", f"full_{h}_hi", f"y_{h}", f"trend_{h}")]
    oof = add_k(pd.read_parquet(proc / "oof_predictions.parquet", columns=oof_cols))
    fc_cols = ["twin_id", "k"] + [f"fc{h}_p{q}" for h in HORIZONS for q in (10, 50, 90)] + \
        [f"pb_lin{h}" for h in HORIZONS]
    f = oof.merge(tw[fc_cols], on=["twin_id", "k"], how="inner")
    need = ["g0"] + [c for h in HORIZONS for c in (f"y_{h}", f"full_{h}", f"fc{h}_p50", f"pb_lin{h}")]
    ok = np.isfinite(f[need].to_numpy(float)).all(axis=1)
    warm = f["k"].to_numpy() >= WARMUP_K
    cal_path = paths_for(get_profile("full")).models / "forecast_calibration.json"
    scales = json.loads(cal_path.read_text())["scale"] if cal_path.exists() else [1.0, 1.0, 1.0]

    def fc_block(mask: np.ndarray) -> dict:
        d = f[mask]
        blk = {"n_points": int(len(d)), "twin": {"rmse": [], "mard": [], "coverage_80": [], "coverage_80_raw": [],
                                                 "parkes": []},
               "persistence": {"rmse": [], "mard": []}, "linear": {"rmse": [], "mard": []},
               "glycotwin_lgbm": {"rmse": [], "mard": [], "coverage_80": [], "parkes": []}}
        for i, h in enumerate(HORIZONS):
            ref = d[f"y_{h}"].to_numpy(float)
            p50, p10, p90 = (d[f"fc{h}_p{q}"].to_numpy(float) for q in (50, 10, 90))
            rm = lambda x: round(float(np.sqrt(np.mean((x - ref) ** 2))), 2)  # noqa: E731
            ma = lambda x: round(float(100 * np.mean(np.abs(x - ref) / ref)), 2)  # noqa: E731
            sc = scales[i]
            lo, hi = p50 - sc * (p50 - p10), p50 + sc * (p90 - p50)
            blk["twin"]["rmse"].append(rm(p50))
            blk["twin"]["mard"].append(ma(p50))
            blk["twin"]["coverage_80"].append(round(float(np.mean((ref >= lo) & (ref <= hi))), 4))
            blk["twin"]["coverage_80_raw"].append(round(float(np.mean((ref >= p10) & (ref <= p90))), 4))
            blk["twin"]["parkes"].append(zone_shares(ref, p50))
            for key, col in (("persistence", "g0"), ("linear", f"pb_lin{h}")):
                blk[key]["rmse"].append(rm(d[col].to_numpy(float)))
                blk[key]["mard"].append(ma(d[col].to_numpy(float)))
            gl = d[f"full_{h}"].to_numpy(float)
            blk["glycotwin_lgbm"]["rmse"].append(rm(gl))
            blk["glycotwin_lgbm"]["mard"].append(ma(gl))
            glo, ghi = d[f"full_{h}_lo"].to_numpy(float), d[f"full_{h}_hi"].to_numpy(float)
            fin = np.isfinite(glo) & np.isfinite(ghi)
            blk["glycotwin_lgbm"]["coverage_80"].append(round(float(np.mean((ref[fin] >= glo[fin]) & (ref[fin] <= ghi[fin]))), 4))
            blk["glycotwin_lgbm"]["parkes"].append(zone_shares(ref, gl))
        return blk

    fc_main = fc_block(ok & warm)
    fc_detail = {"main_after_24h": fc_main, "cold_start_first_24h": fc_block(ok & ~warm),
                 "by_cohort": {c: fc_block(ok & warm & (f["cohort"] == c).to_numpy()) for c in LICENCES},
                 "interval_scale_from_synthetic_validation": scales}
    nc = tw[(tw["k"] >= WARMUP_K) & (tw["pb_cgm_age_min"] <= 0)]
    err = (nc["tw_g"] - nc["pb_cgm"]).to_numpy(float)
    fc_detail["nowcast_twin_mean_vs_current_cgm"] = {"rmse": round(float(np.sqrt(np.mean(err ** 2))), 2),
                                                       "bias": round(float(err.mean()), 2), "n": int(err.size)}
    log(f"forecast: n={fc_main['n_points']} twin RMSE {fc_main['twin']['rmse']} GlycoTwin {fc_main['glycotwin_lgbm']['rmse']}"
        f" persistence {fc_main['persistence']['rmse']}")

    # ---------------- risk ----------------
    feats = pd.read_parquet(proc / "features.parquet")
    feats = add_k(feats[feats["twin_id"].isin(origin)])
    base_cols = [c for c in feats.columns if c not in GLYCO_NON_FEATURES and c != "k"]
    ser = pd.read_parquet(proc / "series.parquet", columns=["twin_id", "time", "glucose"])
    ser = ser[ser["twin_id"].isin(origin)]
    lab250 = _future_label(ser, 250.0, True).rename(columns={"y": "y_gt250"})
    feats = feats.merge(lab250, on=["twin_id", "time"], how="left").rename(columns={"y_spike": "y_ge180"})
    twin_cols = TWIN_FEATURES + EXTRA_TWIN
    pb_cols = [c for c in tw.columns if c.startswith("pb_")]
    frame = feats.merge(tw[["twin_id", "k"] + twin_cols + pb_cols], on=["twin_id", "k"], how="inner")
    frame = frame[frame["k"] >= WARMUP_K].reset_index(drop=True)
    frame["fold"] = frame["person_id"].map(folds)
    if frame["fold"].isna().any():
        raise RuntimeError("person without a GlycoTwin fold")

    paths = paths_for(get_profile("full"))
    meta = json.loads((paths.models / "meta.json").read_text(encoding="utf-8"))
    hyb = meta["tasks"]["hyper_2h"]["hybrid"]
    booster = lgb.Booster(model_file=str(paths.models / "hyper_2h__hybrid.txt"))
    X = frame[["pb_" + c if ("pb_" + c) in frame.columns else c for c in hyb["features"]]].to_numpy(np.float32)
    raw = booster.predict(X)
    frame["transfer"] = np.interp(raw, hyb["calibrator"]["x"], hyb["calibrator"]["y"])
    nt = meta["tasks"]["hyper_2h"]["ml_no_twin"]
    b2 = lgb.Booster(model_file=str(paths.models / "hyper_2h__ml_no_twin.txt"))
    frame["transfer_no_twin"] = b2.predict(frame[["pb_" + c for c in nt["features"]]].to_numpy(np.float32))

    risk, risk_detail = [], {}
    for event, label, twin_score in (("ge180_2h", "y_ge180", "p_ge180_120"), ("gt250_2h", "y_gt250", "p_hyper120")):
        d = frame[frame[label].notna()].reset_index(drop=True)
        d[label] = d[label].astype(int)
        t0 = time.time()
        d["baseline"] = _cv_predict(d, base_cols, label)
        d["plus_twin"] = _cv_predict(d, base_cols + twin_cols, label)
        y = d[label].to_numpy()
        entry = {"event": event, "base_rate": _r(y.mean()), "n_windows": int(len(d))}
        for key in ("baseline", "plus_twin", "transfer"):
            out_key = "transfer_no_retrain" if key == "transfer" else key
            entry[out_key] = {"auroc": _r(_auc(y, d[key])), "auprc": _r(_ap(y, d[key]))}
        risk.append(entry)
        det = {"scores": {}, "by_cohort": {}}
        for key in ("baseline", "plus_twin", "transfer", "transfer_no_twin", twin_score):
            det["scores"][key] = {"auroc": _r(_auc(y, d[key])), "auprc": _r(_ap(y, d[key]))}
        for c in LICENCES:
            dc = d[d["cohort"] == c]
            yc = dc[label].to_numpy()
            det["by_cohort"][c] = {"n": int(len(dc)), "base_rate": _r(yc.mean()) if len(dc) else None,
                                   **{k: _r(_auc(yc, dc[k])) for k in ("baseline", "plus_twin", "transfer")}}
        det.update(_boot(d, label, ["baseline", "plus_twin", "transfer"]))
        det["n_people"] = int(d["person_id"].nunique())
        det["twin_only_score"] = twin_score
        risk_detail[event] = det
        log(f"risk {event}: n={len(d)} rate={y.mean():.3f} base {entry['baseline']} +twin {entry['plus_twin']} "
            f"transfer {entry['transfer_no_retrain']} ({time.time() - t0:.0f}s)")

    # ---------------- synthetic vs real ----------------
    g = ser.sort_values(["twin_id", "time"])
    dv = (g.groupby("twin_id")["glucose"].shift(-2) - g["glucose"]).to_numpy()
    real_sd30 = float(np.nanstd(dv))
    syn = _synthetic_stats()
    rate = {e["event"]: e["base_rate"] for e in risk}
    svr = {"event_rate_ratio_ge180": _r(syn["rate_ge180"] / rate["ge180_2h"], 3) if syn else None,
           "event_rate_ratio_gt250": _r(syn["rate_gt250"] / rate["gt250_2h"], 3) if syn else None,
           "volatility_ratio_30min": _r(syn["sd_delta30"] / real_sd30, 3) if syn else None}
    svr_detail = {"synthetic": syn, "real": {"rate_ge180": rate["ge180_2h"], "rate_gt250": rate["gt250_2h"],
                                             "sd_delta30": round(real_sd30, 2)},
                  "definition": "ratio = synthetic / real; labels GlycoTwin-style on 15-min CGM after 24 h; "
                                "volatility = SD of the 30-min CGM change"}

    # ---------------- datasets ----------------
    datasets = []
    for c, (src, lic) in LICENCES.items():
        pc = pts[pts["cohort"] == c]
        note = ("All 45 participants (15 healthy, 16 prediabetes, 14 T2D by HbA1c); 5-min Dexcom G6, Fitbit HR/METs, "
                "photo-logged meal macros; no medication records." if c == "CGMacros" else
                "Non-insulin records only (45 of 109; 64 with any insulin excluded); 15-min FreeStyle Libre H, "
                "text meal records (carbs estimated by GlycoTwin's food rules), oral agents mapped to Pratibimb's "
                "catalogue; no wearables.")
        datasets.append({"name": c, "source": src, "licence": lic, "n_people": int(pc["person_id"].nunique()),
                         "n_days": round(float(pc["n_days"].sum()), 1), "used_records": int(len(pc)), "notes": note})

    out = {
        "generated_at": datetime.now(IST).isoformat(timespec="seconds"),
        "datasets": datasets,
        "forecast": {"horizons_min": list(HORIZONS), "n_points": fc_main["n_points"],
                     "twin": {"rmse": fc_main["twin"]["rmse"], "mard": fc_main["twin"]["mard"],
                              "coverage_80": fc_main["twin"]["coverage_80"],
                              "parkes_A": [p["A"] for p in fc_main["twin"]["parkes"]]},
                     "persistence": {"rmse": fc_main["persistence"]["rmse"]},
                     "linear": {"rmse": fc_main["linear"]["rmse"]},
                     "glycotwin_lgbm": {"rmse": fc_main["glycotwin_lgbm"]["rmse"], "source": "reproduced"}},
        "risk": risk,
        "synthetic_vs_real": svr,
        "limitations": [
            "Real-data twin uses population priors from the EHR (no per-patient tuning); the EnKF and all twin "
            "settings were fixed on synthetic validation patients and not re-tuned on these records.",
            "Twin forecast is plasma glucose and is scored against CGM (interstitial) readings.",
            "ShanghaiT2DM meals are carbohydrate estimates from free text (some imputed); CGMacros macros are "
            "photo-based estimates. Meal glycaemic index is unknown (fixed at 55).",
            "No waist (WHtR from BMI), no sleep or HRV in either dataset; ShanghaiT2DM has no wearables; CGMacros "
            "has no medication records; diabetes duration is defaulted for CGMacros.",
            "Insulin-treated ShanghaiT2DM records (64 of 109) are excluded: Pratibimb models basal glargine only.",
            "Only 87 people (90 records, ~10-14 days each); Chinese and US cohorts, not Indian patients.",
            "Transfer model was trained on synthetic plasma-glucose labels (>250 mg/dL runs) with 5-min CGM features; "
            "real ShanghaiT2DM CGM is 15-min, so CGM-gap features are out of distribution.",
            "Research prototype; not clinically validated; not a medical device.",
        ],
        "notes": [
            "REAL DATA: CGMacros (PhysioNet, CC BY-NC-SA 4.0) and ShanghaiT2DM (figshare, CC BY 4.0) via GlycoTwin's "
            "harmonised store; derived records stay in git-ignored data/real; only aggregates are published here.",
            "Forecast points: GlycoTwin's 15-min timestamps after each record's first 24 h where twin, GlycoTwin "
            "LightGBM, persistence, linear and all three targets exist (identical points for every method).",
            "glycotwin_lgbm = GlycoTwin's own out-of-fold LightGBM predictions (oof_predictions.parquet) read at the "
            "same timestamps; it was trained on all 154 records (incl. insulin users) with patient-level 5-fold CV.",
            "Twin 80% interval: ensemble p10-p90 widened by the scale fitted on synthetic validation patients "
            f"({scales}), applied unchanged.",
            "Linear = last CGM + 30-min slope x horizon (Pratibimb's baseline); persistence = current CGM.",
            "Risk: GlycoTwin features and person-level folds (models/folds.json), LightGBM with GlycoTwin's fixed "
            "settings (250 rounds, no early stopping); identical windows (after 24 h) for every model.",
            "ge180_2h = current <180 and any CGM >=180 in next 120 min; gt250_2h = current <250 and any CGM >250 in "
            "next 120 min (>=6 of 8 future 15-min readings present).",
            "transfer_no_retrain = synthetic-trained Pratibimb hybrid hyper_2h (>250) model applied as is; for "
            "ge180_2h the same score is used, so it ranks a different event than it was trained on.",
            "synthetic_vs_real ratios are synthetic / real (same label rules on 15-min CGM).",
        ],
    }
    detail = {"forecast": fc_detail, "risk": risk_detail, "synthetic_vs_real": svr_detail,
              "assimilation": _assim_summary(assim_rows), "baseline_features": base_cols, "twin_features": twin_cols,
              "excluded_records": len(man["excluded"])}
    return out, detail


def _assim_summary(rows: list[dict]) -> dict:
    """Aggregate only (no per-record rows leave data/real)."""
    mard = [r["sync_mard"] for r in rows if r.get("sync_mard") is not None]
    return {"records": len(rows), "total_seconds": round(sum(r["seconds"] for r in rows), 1),
            "sync_mard_median_pct": round(float(np.median(mard)), 2) if mard else None,
            "sync_mard_iqr_pct": [round(float(np.quantile(mard, q)), 2) for q in (0.25, 0.75)] if mard else None,
            "definition": "posterior plasma-glucose median vs the CGM reading at the same sample, per record"}


def validate_real(glyco: Path, workers: int = 6, ensemble: int = 64, reuse: bool = False,
                  web_out: Path | None = None, log=print) -> dict:
    root = real_root()
    t0 = time.time()
    rows = build_all(Path(glyco), root / "records", log=log)
    rids = [r["id"] for r in rows]
    twin_dir = root / "twin"
    todo = [r for r in rids if not (reuse and (twin_dir / f"{r}.parquet").exists())]
    assim = assimilate_real(root / "records", twin_dir, todo, ensemble, workers, log=log) if todo else []
    if reuse and (root / "assimilation.json").exists():
        prev = {a["rid"]: a for a in json.loads((root / "assimilation.json").read_text())}
        prev.update({a["rid"]: a for a in assim})
        assim = sorted(prev.values(), key=lambda a: a["rid"])
    dump_json(root / "assimilation.json", assim)
    out, detail = evaluate_real(Path(glyco), root, assim, log=log)
    out_path = REPO_DIR / "reports" / "real_validation.json"
    dump_json(out_path, out)
    dump_json(REPO_DIR / "reports" / "real_validation_detail.json", detail)
    if web_out is not None:
        web_out.mkdir(parents=True, exist_ok=True)
        dump_json(web_out / "real_validation.json", out)
    log(f"real-data validation written to {out_path} ({time.time() - t0:.0f}s)")
    return out
