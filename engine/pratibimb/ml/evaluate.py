"""Held-out evaluation (test patients only) -> ``reports/metrics.json`` (SPEC shape + optional extras),
plus the alert ledger for every patient (used by the API / demo).
"""

from __future__ import annotations

import json
import time
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from ..jsonutil import clean
from ..config import IST, Paths, Profile
from ..observables import list_patients, load_truth
from .alerts import POLICIES, evaluate_patient, simulate_alerts
from .dataset import load_datasets
from .explain import drivers_from_contrib, recommendation
from .features import cgm_linear_scores
from .labels import episode_onsets, nocturnal_label
from .parkes import parkes_zones, zone_shares
from .train import TASKS, TWIN_SCORE, Calibrator, load_booster, load_meta, task_frame

HORIZONS = (30, 60, 120)


def _auc(y: np.ndarray, s: np.ndarray) -> float:
    ok = ~np.isnan(s)
    if len(np.unique(y[ok])) < 2:
        return float("nan")
    return float(roc_auc_score(y[ok], s[ok]))


def _ap(y: np.ndarray, s: np.ndarray) -> float:
    ok = ~np.isnan(s)
    if y[ok].sum() == 0:
        return float("nan")
    return float(average_precision_score(y[ok], s[ok]))


def _bootstrap_ci(df: pd.DataFrame, label: str, score: str, n_boot: int = 200, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    pids = df["pid"].unique()
    groups = {p: g for p, g in df.groupby("pid")}
    aucs, aps = [], []
    for _ in range(n_boot):
        sample = pd.concat([groups[p] for p in rng.choice(pids, pids.size, replace=True)])
        y, s = sample[label].to_numpy(), sample[score].to_numpy()
        if len(np.unique(y)) == 2:
            aucs.append(roc_auc_score(y, s))
            aps.append(average_precision_score(y, s))
    q = lambda a: [round(float(np.quantile(a, 0.025)), 3), round(float(np.quantile(a, 0.975)), 3)] if a else None  # noqa: E731
    return {"auroc": q(aucs), "auprc": q(aps)}


def calibration_bins(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> list[dict]:
    order = np.argsort(p)
    out = []
    for chunk in np.array_split(order, n_bins):
        if chunk.size:
            out.append({"pred": round(float(p[chunk].mean()), 4), "obs": round(float(y[chunk].mean()), 4),
                        "n": int(chunk.size)})
    return out


def _lead_hist(leads: list[float], horizon_min: int) -> list[dict]:
    edges = np.arange(0, horizon_min + 15, 15)
    counts, _ = np.histogram(leads, bins=edges)
    return [{"min": int(e), "count": int(c)} for e, c in zip(edges[:-1], counts, strict=True)]


def _truth_cache(paths: Paths, pids: list[str]) -> dict[str, np.ndarray]:
    return {p: load_truth(paths, p)[1]["g"].astype(float) for p in pids}


def operating_metrics(task: str, frame: pd.DataFrame, probs: np.ndarray, thr: float,
                      truth: dict[str, np.ndarray]) -> tuple[dict, list[float]]:
    if task == "nocturnal_hypo":
        y = frame[task].to_numpy()
        alert = probs >= thr
        tp = int((alert & (y == 1)).sum())
        leads = [float((on - k) * 5) for on, k, a, yy in zip(frame["noct_onset"], frame["k"], alert, y, strict=True)
                 if a and yy == 1 and on >= 0]
        nights = len(frame)
        return {"threshold": round(thr, 4), "sensitivity": round(tp / max(int(y.sum()), 1), 4),
                "precision": round(tp / max(int(alert.sum()), 1), 4),
                "alerts_per_patient_day": round(float(alert.sum()) / max(nights, 1), 4),
                "median_lead_min": round(float(np.median(leads)), 1) if leads else 0.0,
                "false_alerts_per_patient_day": round(float((alert & (y == 0)).sum()) / max(nights, 1), 4)}, leads
    pol = POLICIES[task]
    tot = {"tp": 0, "fp": 0, "events": 0, "detected": 0}
    leads: list[float] = []
    frame = frame.assign(_p=probs)
    days = 0.0
    for pid, g in frame.groupby("pid"):
        ks = g["k"].to_numpy()
        fired = simulate_alerts(ks, g["_p"].to_numpy(), g["cgm"].to_numpy(), thr, pol)
        on = episode_onsets(truth[pid], pol.level, pol.above)
        r = evaluate_patient(ks, fired, on, pol)
        for key in tot:
            tot[key] += r[key]
        leads += r["leads"]
        days += len(ks) * 15 / 1440.0
    n_alerts = tot["tp"] + tot["fp"]
    return {"threshold": round(thr, 4), "sensitivity": round(tot["detected"] / max(tot["events"], 1), 4),
            "precision": round(tot["tp"] / max(n_alerts, 1), 4),
            "alerts_per_patient_day": round(n_alerts / max(days, 1e-9), 4),
            "median_lead_min": round(float(np.median(leads)), 1) if leads else 0.0,
            "false_alerts_per_patient_day": round(tot["fp"] / max(days, 1e-9), 4),
            "events": int(tot["events"])}, leads


def calibrate_intervals(paths: Paths, dp: pd.DataFrame, log=print) -> list[float]:
    """Scale factor per horizon for the ensemble p10-p90 interval so that it covers 80 % of truth on the
    *validation* patients (applied unchanged to test patients and to the API forecast cone)."""
    va = dp[dp.split == "val"]
    ids = list(va["pid"].unique())
    truth = _truth_cache(paths, ids)
    scales = []
    for h in HORIZONS:
        ref, p10, p50, p90 = [], [], [], []
        for pid, g in va.groupby("pid"):
            kt = g["k"].to_numpy() + h // 5
            ok = kt < truth[pid].shape[0]
            ref.append(truth[pid][kt[ok]])
            p10.append(g[f"fc{h}_p10"].to_numpy()[ok])
            p50.append(g[f"fc{h}_p50"].to_numpy()[ok])
            p90.append(g[f"fc{h}_p90"].to_numpy()[ok])
        ref, p10, p50, p90 = (np.concatenate(x) for x in (ref, p10, p50, p90))
        lo, hi = 0.5, 6.0
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            cov = np.mean((ref >= p50 - mid * (p50 - p10)) & (ref <= p50 + mid * (p90 - p50)))
            lo, hi = (mid, hi) if cov < 0.8 else (lo, mid)
        scales.append(round(0.5 * (lo + hi), 3))
    with (paths.models / "forecast_calibration.json").open("w", encoding="utf-8") as fh:
        json.dump({"horizons_min": list(HORIZONS), "scale": scales, "fitted_on": "validation patients"}, fh)
    log(f"  forecast interval scale (val): {scales}")
    return scales


def evaluate(profile: Profile, paths: Paths, log=print) -> dict:
    t0 = time.time()
    dp, noct = load_datasets(paths)
    meta = load_meta(paths)
    pd_dp = pd.read_parquet(paths.ml / "predictions_dp.parquet")
    pd_noct = pd.read_parquet(paths.ml / "predictions_noct.parquet")
    for task in ("hyper_2h", "hypo_1h"):
        for v in ("hybrid", "ml_no_twin"):
            dp[f"{task}__{v}"] = pd_dp[f"{task}__{v}"].to_numpy()
    for v in ("hybrid", "ml_no_twin"):
        noct[f"nocturnal_hypo__{v}"] = pd_noct[f"nocturnal_hypo__{v}"].to_numpy()
    pts = list_patients(paths)
    test_ids = [p["id"] for p in pts if p["split"] == "test"]
    truth = _truth_cache(paths, test_ids)

    tasks_out: dict = {}
    ablation: dict[str, dict] = {m: {"model": m} for m in ("cgm_linear", "ml_no_twin", "twin_only", "hybrid")}
    extras: dict = {"ci95": {}, "cgm_labelled": {}, "brier_by_model": {}}
    for task in TASKS:
        frame = task_frame(dp, noct, task)
        te = frame[frame.split == "test"].copy()
        y = te[task].to_numpy()
        p_h = te[f"{task}__hybrid"].to_numpy()
        lin = cgm_linear_scores(te)[task]
        tw = te[TWIN_SCORE[task]].to_numpy()
        scores = {"hybrid": p_h, "ml_no_twin": te[f"{task}__ml_no_twin"].to_numpy(), "twin_only": tw, "cgm_linear": lin}
        for m, s in scores.items():
            ablation[m][f"{task.replace('nocturnal_hypo', 'nocturnal_hypo')}_auroc"] = round(_auc(y, s), 4)
            ablation[m][f"{task}_auprc"] = round(_ap(y, s), 4)
        twin_cal = Calibrator.from_json(meta["tasks"][task]["twin_only"]["calibrator"])
        extras["brier_by_model"][task] = {"hybrid": round(float(brier_score_loss(y, p_h)), 5),
                                          "ml_no_twin": round(float(brier_score_loss(y, scores["ml_no_twin"])), 5),
                                          "twin_only": round(float(brier_score_loss(y, twin_cal(tw))), 5)}
        te["_score"] = p_h
        extras["ci95"][task] = _bootstrap_ci(te, task, "_score")
        if f"{task}_cgm" in te:
            yc = te[f"{task}_cgm"].to_numpy()
            extras["cgm_labelled"][task] = {"prevalence": round(float(yc.mean()), 4), "auroc": round(_auc(yc, p_h), 4),
                                            "auprc": round(_ap(yc, p_h), 4)}
        thr = meta["tasks"][task]["operating_point"]["threshold"]
        if task == "nocturnal_hypo":
            op, leads = operating_metrics(task, te, p_h, thr, truth)
            horizon_min = 480
        else:
            full_te = dp[dp.split == "test"]
            op, leads = operating_metrics(task, full_te, full_te[f"{task}__hybrid"].to_numpy(), thr, truth)
            horizon_min = POLICIES[task].horizon * 5
        tasks_out[task] = {
            "prevalence": round(float(y.mean()), 4), "auroc": round(_auc(y, p_h), 4), "auprc": round(_ap(y, p_h), 4),
            "brier": round(float(brier_score_loss(y, p_h)), 5),
            "operating_point": op, "calibration": calibration_bins(y, p_h), "lead_time_hist": _lead_hist(leads, horizon_min),
            "n_test": int(len(te)), "n_positive": int(y.sum()),
        }
        log(f"  {task}: AUROC {tasks_out[task]['auroc']:.3f} AUPRC {tasks_out[task]['auprc']:.3f} "
            f"sens {op['sensitivity']:.2f} alerts/day {op['alerts_per_patient_day']:.2f}")
    ab_list = []
    for m in ("cgm_linear", "ml_no_twin", "twin_only", "hybrid"):
        a = ablation[m]
        ab_list.append({"model": m, "hyper_2h_auroc": a["hyper_2h_auroc"], "hypo_1h_auroc": a["hypo_1h_auroc"],
                        "nocturnal_hypo_auroc": a["nocturnal_hypo_auroc"], "hyper_2h_auprc": a["hyper_2h_auprc"],
                        "hypo_1h_auprc": a["hypo_1h_auprc"], "nocturnal_hypo_auprc": a["nocturnal_hypo_auprc"]})

    # ---- forecast accuracy (twin p50 vs truth plasma glucose) ----------------------------------
    scales = calibrate_intervals(paths, dp, log)
    te_dp = dp[dp.split == "test"]
    fc = {"horizons_min": list(HORIZONS), "rmse": [], "mard": [], "coverage_80": [], "parkes": [], "baseline_rmse": [],
          "baseline_mard": [], "persistence_rmse": [], "n": [], "coverage_80_raw": [], "interval_scale": scales}
    sample_rows = []
    for h in HORIZONS:
        refs, p50s, p10s, p90s, lins, cgms = [], [], [], [], [], []
        for pid, g in te_dp.groupby("pid"):
            kt = g["k"].to_numpy() + h // 5
            ok = kt < truth[pid].shape[0]
            refs.append(truth[pid][kt[ok]])
            p50s.append(g[f"fc{h}_p50"].to_numpy()[ok])
            p10s.append(g[f"fc{h}_p10"].to_numpy()[ok])
            p90s.append(g[f"fc{h}_p90"].to_numpy()[ok])
            lins.append(g[f"lin{h}"].to_numpy()[ok])
            cgms.append(g["cgm"].to_numpy()[ok])
        ref, p50 = np.concatenate(refs), np.concatenate(p50s)
        p10, p90, lin, cg = np.concatenate(p10s), np.concatenate(p90s), np.concatenate(lins), np.concatenate(cgms)
        okl = ~np.isnan(lin)
        fc["rmse"].append(round(float(np.sqrt(np.mean((p50 - ref) ** 2))), 2))
        fc["mard"].append(round(float(100 * np.mean(np.abs(p50 - ref) / ref)), 2))
        sc = scales[HORIZONS.index(h)]
        lo_s, hi_s = p50 - sc * (p50 - p10), p50 + sc * (p90 - p50)
        fc["coverage_80"].append(round(float(np.mean((ref >= lo_s) & (ref <= hi_s))), 4))
        fc["coverage_80_raw"].append(round(float(np.mean((ref >= p10) & (ref <= p90))), 4))
        fc["parkes"].append({"horizon_min": h, **zone_shares(ref, p50)})
        fc["baseline_rmse"].append(round(float(np.sqrt(np.mean((lin[okl] - ref[okl]) ** 2))), 2))
        fc["baseline_mard"].append(round(float(100 * np.mean(np.abs(lin[okl] - ref[okl]) / ref[okl])), 2))
        okc = ~np.isnan(cg)
        fc["persistence_rmse"].append(round(float(np.sqrt(np.mean((cg[okc] - ref[okc]) ** 2))), 2))
        fc["n"].append(int(ref.size))
        rng = np.random.default_rng(h)
        idx = rng.choice(ref.size, size=min(4000, ref.size), replace=False)
        sample_rows.append(pd.DataFrame({"horizon": h, "ref": ref[idx], "pred": p50[idx],
                                         "zone": parkes_zones(ref[idx], p50[idx])}))
    pd.concat(sample_rows).to_parquet(paths.ml / "forecast_sample.parquet", index=False)

    # ---- twin sync quality (test patients) -----------------------------------------------------
    m_tw, m_cgm, cov = [], [], []
    for pid in test_ids:
        tw = np.load(paths.twin / f"{pid}.npz")
        z = np.load(paths.patients / f"{pid}.npz")
        g = truth[pid][288:]
        q = tw["q"][288:].astype(float)
        c = z["cgm"][288:].astype(float)
        m_tw.append(np.abs(q[:, 1] - g) / g)
        okc = ~np.isnan(c)
        m_cgm.append(np.abs(c[okc] - g[okc]) / g[okc])
        cov.append((g >= q[:, 0]) & (g <= q[:, 2]))
    sync = {"twin_vs_truth_mard": round(float(100 * np.mean(np.concatenate(m_tw))), 2),
            "cgm_vs_truth_mard": round(float(100 * np.mean(np.concatenate(m_cgm))), 2),
            "twin_band_coverage_80": round(float(np.mean(np.concatenate(cov))), 4)}

    # ---- top features (mean |TreeSHAP| on test) -------------------------------------------------
    top = []
    from .explain import feature_label

    for task in TASKS:
        frame = task_frame(dp, noct, task)
        te = frame[frame.split == "test"]
        cols = meta["tasks"][task]["hybrid"]["features"]
        booster = load_booster(paths, task, "hybrid")
        sample = te.sample(n=min(len(te), 20000), random_state=0)
        contrib = booster.predict(sample[cols], pred_contrib=True)[:, :-1]
        mean_abs = np.abs(contrib).mean(axis=0)
        for i in np.argsort(-mean_abs)[:10]:
            top.append({"task": task, "feature": cols[i], "label": feature_label(cols[i]),
                        "mean_abs_contrib": round(float(mean_abs[i]), 4)})

    from ..cohort.archetypes import ARCHETYPES

    cgm_points = 0
    for p in pts:
        z = np.load(paths.patients / f"{p['id']}.npz")
        cgm_points += int((~np.isnan(z["cgm"])).sum())
    metrics = {
        "generated_at": datetime.now(IST).isoformat(timespec="seconds"),
        "dataset": {"patients": len(pts), "days": profile.days,
                    "train_patients": sum(p["split"] == "train" for p in pts),
                    "val_patients": sum(p["split"] == "val" for p in pts),
                    "test_patients": sum(p["split"] == "test" for p in pts), "cgm_points": cgm_points,
                    "subtype_counts": {a: sum(p["archetype"] == a for p in pts) for a in ARCHETYPES},
                    "decision_points": int(len(dp)), "bedtime_decisions": int(len(noct))},
        "tasks": tasks_out, "ablation": ab_list, "forecast": fc, "top_features": top,
        "sync": sync, "ci95": extras["ci95"], "cgm_labelled": extras["cgm_labelled"],
        "brier_by_model": extras["brier_by_model"],
        "notes": ["All numbers are on held-out synthetic test patients generated by a richer simulator than the twin.",
                  "Labels use truth plasma glucose; 'cgm_labelled' re-scores the same predictions against CGM-derived labels.",
                  "Nocturnal operating point: <= 1 false alert per patient-week (one decision per night).",
                  "ci95: patient-level bootstrap (200 resamples)."],
    }
    fusion = paths.ml / "fusion_ablation.json"  # written by `pratibimb fusion-ablation`; kept across re-evaluation
    if fusion.exists():
        metrics["fusion_ablation"] = json.loads(fusion.read_text(encoding="utf-8"))
    paths.reports.mkdir(parents=True, exist_ok=True)
    with (paths.reports / "metrics.json").open("w", encoding="utf-8") as fh:
        json.dump(clean(metrics), fh, indent=1, allow_nan=False)
    log(f"evaluated in {time.time() - t0:.1f}s -> {paths.reports / 'metrics.json'}")
    return metrics


def build_alert_ledger(paths: Paths, log=print) -> int:
    """Alerts for every patient over the whole window (hybrid model, validation-chosen thresholds),
    with TreeSHAP drivers, recommendations and truth-based final outcomes."""
    dp, noct = load_datasets(paths)
    meta = load_meta(paths)
    pd_dp = pd.read_parquet(paths.ml / "predictions_dp.parquet")
    pd_noct = pd.read_parquet(paths.ml / "predictions_noct.parquet")
    out_dir = paths.ml / "alerts"
    out_dir.mkdir(parents=True, exist_ok=True)
    ledger: dict[str, list] = {}
    rows_by_task: dict[str, list] = {t: [] for t in TASKS}
    for task in ("hyper_2h", "hypo_1h"):
        thr = meta["tasks"][task]["operating_point"]["threshold"]
        pol = POLICIES[task]
        probs = pd_dp[f"{task}__hybrid"].to_numpy()
        for pid, g in dp.assign(_p=probs).groupby("pid"):
            fired = simulate_alerts(g["k"].to_numpy(), g["_p"].to_numpy(), g["cgm"].to_numpy(), thr, pol)
            for i in fired:
                rows_by_task[task].append((pid, g.index[i], float(g["_p"].iloc[i]), thr))
    thr_n = meta["tasks"]["nocturnal_hypo"]["operating_point"]["threshold"]
    pn = pd_noct["nocturnal_hypo__hybrid"].to_numpy()
    for i in np.flatnonzero(pn >= thr_n):
        rows_by_task["nocturnal_hypo"].append((noct["pid"].iloc[i], noct.index[i], float(pn[i]), thr_n))
    truths: dict[str, np.ndarray] = {}
    for task, rows in rows_by_task.items():
        if not rows:
            continue
        frame = noct if task == "nocturnal_hypo" else dp
        cols = meta["tasks"][task]["hybrid"]["features"]
        booster = load_booster(paths, task, "hybrid")
        idx = [r[1] for r in rows]
        X = frame.loc[idx, cols]
        contrib = booster.predict(X, pred_contrib=True)
        Xv = X.to_numpy(dtype=float)
        for j, (pid, ix, p, thr) in enumerate(rows):
            if pid not in truths:
                truths[pid] = load_truth(paths, pid)[1]["g"].astype(float)
            k = int(frame.at[ix, "k"])
            g = truths[pid]
            if task == "nocturnal_hypo":
                lab, on = nocturnal_label(g, k)
                outcome = "true_positive" if lab == 1 else "false_positive"
                lead = int((on - k) * 5) if lab == 1 else None
                horizon = (k // 288 + 1) * 288 + 72 - k
            else:
                pol = POLICIES[task]
                ons = episode_onsets(g, pol.level, pol.above)
                nxt = ons[ons > k]
                if nxt.size and nxt[0] - k <= pol.horizon:
                    outcome, lead = "true_positive", int((nxt[0] - k) * 5)
                else:
                    outcome, lead = "false_positive", None
                horizon = pol.horizon
            drivers = drivers_from_contrib(contrib[j], Xv[j], cols)
            su_active = float(frame.at[ix, "su_effect"]) > 0.25
            ledger.setdefault(pid, []).append({
                "id": f"{pid}-{task}-{k}", "k": k, "kind": task, "probability": round(p, 4),
                "threshold": round(thr, 4), "outcome_final": outcome, "lead_min_final": lead,
                "resolves_k": int(k + horizon), "drivers": drivers,
                "recommendation": recommendation(task, drivers, su_active),
            })
    n = 0
    for pid, items in ledger.items():
        items.sort(key=lambda a: a["k"])
        with (out_dir / f"{pid}.json").open("w", encoding="utf-8") as fh:
            json.dump(items, fh)
        n += len(items)
    log(f"alert ledger: {n} alerts")
    return n
