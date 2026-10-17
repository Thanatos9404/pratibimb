"""Fusion ablations on the synthetic cohort: how much do the EHR and the wearable streams contribute?

Two levels, both scored on the held-out synthetic *test* patients only:

* **Risk model (ML side)** - retrain the hybrid LightGBM (same splits, seed, early stopping on validation
  patients, isotonic calibration on validation) without the EHR/static features, without the wearable
  features (HR, HRV, steps, sleep, stress/exercise traces), and without both. Twin features are kept.
* **Twin side** - re-run the EnKF twin on the test patients with (a) a population prior instead of the
  EHR prior, (b) no wearable inputs (no steps -> exercise, no sleep, no HR/HRV stress), and compare the
  twin's forecast RMSE vs truth plasma glucose and its twin-only risk scores (no ML).

Results go to ``data/<profile>/ml/fusion_ablation.json`` and into ``reports/metrics.json`` under the new key
``fusion_ablation`` (existing keys untouched).
"""

from __future__ import annotations

import json
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from ..config import SAMPLES_PER_DAY, STEP_MIN, Paths, Profile
from ..jsonutil import clean
from ..observables import list_patients, load_truth, observed_from
from ..twin.assimilate import DP_STEP, TWIN_FEATURES, patient_seed, twin_features
from ..twin.enkf import TwinRun
from ..twin.forecast import HabitPrior
from ..twin.inputs import TWIN_H
from ..twin.priors import ehr_prior
from .dataset import load_datasets
from .features import STATIC_FEATURES
from .labels import task_labels
from .train import TASKS, TWIN_SCORE, feature_columns, fit_model, task_frame

WEARABLE_FEATURES = ["steps_30", "steps_60", "steps_today", "hr", "hr_vs_base", "hrv", "hrv_vs_base", "sleep_h_last",
                     "sleep_eff_last", "deep_pct_last", "sleep_debt_3d", "min_since_wake", "asleep_now", "ex_trace",
                     "sleep_si_mult", "stress"]
EHR_FEATURES = list(STATIC_FEATURES)
POP_EHR = {"tyg": 9.2, "whtr": 0.57, "hba1c": 7.8, "fpg": 150.0, "egfr": 90.0, "cpeptide": None}
POP_RECORD = {"bmi": 25.0, "diabetes_years": 7.0, "genetics": []}


def _scores(y: np.ndarray, p: np.ndarray) -> dict:
    return {"auroc": round(float(roc_auc_score(y, p)), 4), "auprc": round(float(average_precision_score(y, p)), 4)}


def ml_ablation(paths: Paths, seed: int, log=print) -> dict:
    dp, noct = load_datasets(paths)
    preds = {"dp": pd.read_parquet(paths.ml / "predictions_dp.parquet"),
             "noct": pd.read_parquet(paths.ml / "predictions_noct.parquet")}
    out: dict = {}
    for task in TASKS:
        frame = task_frame(dp, noct, task)
        pr = preds["noct"] if task == "nocturnal_hypo" else preds["dp"]  # same row order as noct / dp
        tr, va, te = (frame[frame.split == s] for s in ("train", "val", "test"))
        y = te[task].to_numpy()
        res = {"n_test": int(len(te)), "prevalence": round(float(y.mean()), 4),
               "hybrid": _scores(y, pr.loc[te.index, f"{task}__hybrid"].to_numpy())}
        base = feature_columns(frame, task, "hybrid")
        for name, drop in (("no_ehr", EHR_FEATURES), ("no_wearable", WEARABLE_FEATURES),
                           ("no_ehr_no_wearable", EHR_FEATURES + WEARABLE_FEATURES)):
            cols = [c for c in base if c not in set(drop)]
            booster, cal = fit_model(tr, va, cols, task, task, seed)
            p = cal(booster.predict(te[cols], num_iteration=booster.best_iteration))
            res[name] = _scores(y, p)
            res[name]["delta_auroc"] = round(res[name]["auroc"] - res["hybrid"]["auroc"], 4)
            res[name]["delta_auprc"] = round(res[name]["auprc"] - res["hybrid"]["auprc"], 4)
            res[name]["n_features"] = len(cols)
            log(f"  fusion/{task}/{name}: AUROC {res[name]['auroc']} (hybrid {res['hybrid']['auroc']})")
        res["n_features_hybrid"] = len(base)
        out[task] = res
    return out


# ---------------------------------------------------------------------------------------------------
def _twin_variant(args: tuple) -> pd.DataFrame:
    root, reports, pid, m, prof_seed, variant = args
    paths = Paths(root=Path(root), reports=Path(reports))
    with (paths.patients / f"{pid}.json").open(encoding="utf-8") as fh:
        rec = json.load(fh)
    rec.pop("truth", None)
    z = dict(np.load(paths.patients / f"{pid}.npz"))
    if variant == "no_wearable_inputs":
        z["steps"] = np.zeros_like(z["steps"])
        z["hr"] = np.full_like(z["hr"], np.nan, dtype=np.float32)
        z["hrv"] = np.full_like(z["hrv"], np.nan, dtype=np.float32)
        z["stage"] = np.zeros_like(z["stage"])
    obs = observed_from(rec, z)
    run = TwinRun(obs, m, patient_seed(prof_seed, pid))
    if variant == "population_prior":
        run.prior = ehr_prior({**obs.ehr, **POP_EHR}, {**rec, **POP_RECORD}, TWIN_H)
    prior = HabitPrior(run)
    ks, feats = [], []

    def on_block(b, k0, keeps, prior_arr, pmean):
        for i in range(keeps.shape[0]):
            k = k0 + DP_STEP * (i + 1)
            ks.append(k)
            feats.append(twin_features(run, prior, keeps[i], k, prior_arr[:, 0], pmean))

    run.run(on_block=on_block, keep_every=DP_STEP)
    df = pd.DataFrame(np.array(feats), columns=TWIN_FEATURES)
    df.insert(0, "k", ks)
    df.insert(0, "pid", pid)
    return df


def _twin_metrics(paths: Paths, feats: pd.DataFrame, k_lo: int = SAMPLES_PER_DAY, k_hi: int = 10**9) -> dict:
    rows = {h: ([], []) for h in (30, 60, 120)}
    lab = {"hyper_2h": ([], []), "hypo_1h": ([], [])}
    for pid, g in feats.groupby("pid"):
        _, ts = load_truth(paths, pid)
        tg = ts["g"].astype(float)
        g = g[(g["k"] >= k_lo) & (g["k"] < k_hi) & (g["k"] + 27 <= tg.shape[0])]
        ks = g["k"].to_numpy()
        for h in rows:
            rows[h][0].append(tg[ks + h // STEP_MIN])
            rows[h][1].append(g[f"fc{h}_p50"].to_numpy())
        tl = task_labels(tg, ks)
        for task in lab:
            e = tl[f"{task}_elig"] == 1
            lab[task][0].append(tl[task][e])
            lab[task][1].append(g[TWIN_SCORE[task]].to_numpy()[e])
    out = {"forecast_rmse": [], "n_points": 0}
    for h, (r, p) in rows.items():
        r, p = np.concatenate(r), np.concatenate(p)
        out["forecast_rmse"].append(round(float(np.sqrt(np.mean((p - r) ** 2))), 2))
        out["n_points"] = int(r.size)
    for task, (y, s) in lab.items():
        out[f"twin_only_{task}"] = _scores(np.concatenate(y), np.concatenate(s))
    return out


def twin_ablation(profile: Profile, paths: Paths, workers: int = 6, log=print) -> dict:
    test = [p["id"] for p in list_patients(paths) if p["split"] == "test"]
    out = {"patients": len(test), "horizons_min": [30, 60, 120]}
    # reference: the stored twin features (EHR prior + wearables)
    ref = []
    for pid in test:
        tw = np.load(paths.twin / f"{pid}.npz")
        df = pd.DataFrame(tw["dp_feat"], columns=TWIN_FEATURES)
        df.insert(0, "k", tw["dp_k"].astype(int))
        df.insert(0, "pid", pid)
        ref.append(df)
    ref = pd.concat(ref, ignore_index=True)
    out["full_twin"] = _twin_metrics(paths, ref)
    # cold start: first 24 h of each record (from 1 h in), where the EHR prior should matter most
    out["cold_start_first_24h"] = {"full_twin": _twin_metrics(paths, ref, 12, SAMPLES_PER_DAY)}
    for variant in ("population_prior", "no_wearable_inputs"):
        t0 = time.time()
        args = [(str(paths.root), str(paths.reports), pid, profile.ensemble_size, profile.seed, variant) for pid in test]
        with Pool(max(1, min(workers, 6))) as pool:
            parts = pool.map(_twin_variant, args, chunksize=1)
        feats = pd.concat(parts, ignore_index=True)
        out[variant] = _twin_metrics(paths, feats)
        out["cold_start_first_24h"][variant] = _twin_metrics(paths, feats, 12, SAMPLES_PER_DAY)
        log(f"  fusion/twin/{variant}: {out[variant]} ({time.time() - t0:.0f}s)")
    return out


def fusion_ablation(profile: Profile, paths: Paths, workers: int = 6, seed: int = 7, log=print,
                    twin_only: bool = False) -> dict:
    t0 = time.time()
    prev = paths.ml / "fusion_ablation.json"
    risk = (json.loads(prev.read_text(encoding="utf-8"))["risk_model"] if twin_only and prev.exists()
            else ml_ablation(paths, seed, log))
    res = {"description": "SYNTHETIC test patients. Risk: hybrid LightGBM retrained without EHR/static features, "
                          "without wearable features (HR, HRV, steps, sleep, stress/exercise traces) and without both; "
                          "twin features kept; same splits/seed/early stopping/calibration as the main model. Twin: "
                          "EnKF re-run with a population prior instead of the EHR prior, or with no wearable inputs; "
                          "twin-only scores and forecast RMSE vs truth plasma glucose.",
           "ehr_features": EHR_FEATURES, "wearable_features": WEARABLE_FEATURES,
           "risk_model": risk, "twin": twin_ablation(profile, paths, workers, log)}
    res["elapsed_s"] = round(time.time() - t0, 1)
    with (paths.ml / "fusion_ablation.json").open("w", encoding="utf-8") as fh:
        json.dump(clean(res), fh, indent=1)
    mpath = paths.reports / "metrics.json"
    if mpath.exists():
        metrics = json.loads(mpath.read_text(encoding="utf-8"))
        metrics["fusion_ablation"] = clean(res)
        with mpath.open("w", encoding="utf-8") as fh:
            json.dump(metrics, fh, indent=1, allow_nan=False)
    log(f"fusion ablation done in {res['elapsed_s']}s")
    return res
