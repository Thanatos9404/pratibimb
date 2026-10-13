"""Cohort realism report (``reports/cohort_validation.json``) and inferred-subtype table.

Glycaemic statistics use the CGM stream over days 1..end (day 0 is twin warm-up) as a clinician would
see it; truth-based equivalents are included for transparency.
"""

from __future__ import annotations

import json
import time

import numpy as np

from ..cohort.archetypes import ARCHETYPES
from ..jsonutil import clean
from ..config import SAMPLES_PER_DAY, Paths, Profile
from ..foods import summarize_meal  # noqa: F401  (kept for API symmetry)
from ..ml.labels import episode_onsets
from ..physiology.drugs import DRUGS
from ..twin.subtype import infer_subtypes

TARGETS = {
    "cohort_median_tir_pct": [55, 75],
    "cv_pct_mostly_within": [20, 36],
    "hypos_concentrated_in_su_or_insulin_users": True,
}


def _q(a, qs=(0.25, 0.5, 0.75)) -> list[float] | None:
    a = np.asarray([v for v in a if v is not None and not np.isnan(v)], dtype=float)
    if a.size == 0:
        return None
    return [round(float(np.quantile(a, q)), 2) for q in qs]


def glycemic_stats(x: np.ndarray) -> dict[str, float]:
    v = x[~np.isnan(x)]
    if v.size == 0:
        return {}
    return {"mean": float(v.mean()), "cv": float(100 * v.std() / v.mean()),
            "tir": float(100 * np.mean((v >= 70) & (v <= 180))), "tar180": float(100 * np.mean(v > 180)),
            "tar250": float(100 * np.mean(v > 250)), "tbr70": float(100 * np.mean(v < 70)),
            "tbr54": float(100 * np.mean(v < 54)), "gmi": float(3.31 + 0.02392 * v.mean())}


def cohort_validation(profile: Profile, paths: Paths, log=print) -> dict:
    t0 = time.time()
    with (paths.cohort / "manifest.json").open(encoding="utf-8") as fh:
        man = json.load(fh)
    with (paths.twin / "summary.json").open(encoding="utf-8") as fh:
        twin_sum = {r["id"]: r for r in json.load(fh)["patients"]}
    rows = []
    peaks: dict[str, list[float]] = {}
    sub_rows = []
    for p in man["patients"]:
        pid = p["id"]
        with (paths.patients / f"{pid}.json").open(encoding="utf-8") as fh:
            rec = json.load(fh)
        z = np.load(paths.patients / f"{pid}.npz")
        cgm = z["cgm"][SAMPLES_PER_DAY:].astype(float)
        g = z["g"].astype(float)
        kinds = {DRUGS[m["drug"]].kind for m in rec["medications"]}
        med_class = "insulin" if "insulin" in kinds else ("sulfonylurea" if "su" in kinds else "neither")
        cs = glycemic_stats(cgm)
        ts = glycemic_stats(g[SAMPLES_PER_DAY:])
        days = (g.shape[0] - SAMPLES_PER_DAY) / SAMPLES_PER_DAY
        hypo_on = episode_onsets(g[SAMPLES_PER_DAY:], 70.0, False)
        hyper_on = episode_onsets(g[SAMPLES_PER_DAY:], 250.0, True)
        nights_with = set()
        for o in hypo_on + SAMPLES_PER_DAY:
            if (o % SAMPLES_PER_DAY) < 72:
                nights_with.add(int(o // SAMPLES_PER_DAY))
        for m in rec["truth"]["meals"]:
            if m["slot"] in ("breakfast", "lunch", "dinner", "evening_snack") and m["carbs_g"] > 20:
                k = m["t"] // 5
                if k + 30 < g.shape[0]:
                    peaks.setdefault(m["slot"], []).append(float(g[k:k + 30].max() - g[k]))
        rows.append({"id": pid, "archetype": rec["truth"]["archetype"], "med_class": med_class, "cgm": cs, "truth": ts,
                     "hba1c": rec["ehr"]["hba1c"], "eag": rec["ehr"]["eag_adag"], "bmi": rec["bmi"],
                     "tyg": rec["ehr"]["tyg"], "hypo_per_week": 7 * len(hypo_on) / days,
                     "hyper_per_day": len(hyper_on) / days, "noct_night_rate": len(nights_with) / max(days - 1, 1),
                     "titrated": bool(rec["truth"]["titration"])})
        tw = twin_sum.get(pid)
        if tw:
            sub_rows.append({"id": pid, "si": tw["params_now"]["SI"][0], "beta": tw["params_now"]["beta"][0],
                             "bmi": rec["bmi"], "age": rec["age"], "hba1c": rec["ehr"]["hba1c"]})
    inferred = infer_subtypes(sub_rows)
    with (paths.twin / "subtypes.json").open("w", encoding="utf-8") as fh:
        json.dump(inferred, fh)

    def by(key_fn, metric_fn):
        out = {}
        for r in rows:
            out.setdefault(key_fn(r), []).append(metric_fn(r))
        return out

    per_arch = {}
    for a in ARCHETYPES:
        rs = [r for r in rows if r["archetype"] == a]
        if not rs:
            continue
        cg_mean = np.array([r["cgm"]["mean"] for r in rs])
        eag = np.array([r["eag"] for r in rs])
        per_arch[a] = {
            "n": len(rs),
            "cgm_mean_glucose_iqr": _q(cg_mean), "adag_eag_from_hba1c_iqr": _q(eag),
            "mean_minus_eag_median": round(float(np.median(cg_mean - eag)), 1),
            "hba1c_iqr": _q([r["hba1c"] for r in rs]), "bmi_iqr": _q([r["bmi"] for r in rs]),
            "tyg_iqr": _q([r["tyg"] for r in rs]),
            "tir_iqr": _q([r["cgm"]["tir"] for r in rs]), "tar250_iqr": _q([r["cgm"]["tar250"] for r in rs]),
            "tbr70_iqr": _q([r["cgm"]["tbr70"] for r in rs]), "cv_iqr": _q([r["cgm"]["cv"] for r in rs]),
        }
    cg_mean = np.array([r["cgm"]["mean"] for r in rows])
    eag = np.array([r["eag"] for r in rows])
    cvs = np.array([r["cgm"]["cv"] for r in rows])
    tirs = np.array([r["cgm"]["tir"] for r in rows])
    hypo_med = by(lambda r: r["med_class"], lambda r: r)
    hypo_by_med = {k: {"n": len(v), "tbr70_median": round(float(np.median([r["cgm"]["tbr70"] for r in v])), 2),
                       "tbr70_mean": round(float(np.mean([r["cgm"]["tbr70"] for r in v])), 2),
                       "truth_tbr70_mean": round(float(np.mean([r["truth"]["tbr70"] for r in v])), 2),
                       "hypo_episodes_per_week_mean": round(float(np.mean([r["hypo_per_week"] for r in v])), 2),
                       "pct_patients_with_any_hypo": round(100 * float(np.mean([r["hypo_per_week"] > 0 for r in v])), 1),
                       "nocturnal_hypo_night_rate": round(float(np.mean([r["noct_night_rate"] for r in v])), 4)}
                   for k, v in hypo_med.items()}
    su_ins = [r for r in rows if r["med_class"] != "neither"]
    neither = [r for r in rows if r["med_class"] == "neither"]
    total_hypo = sum(r["hypo_per_week"] for r in rows) or 1.0
    agree = None
    if inferred:
        pairs = [(r["archetype"], inferred.get(r["id"])) for r in rows if inferred.get(r["id"])]
        agree = {"accuracy": round(float(np.mean([a == b for a, b in pairs])), 3),
                 "confusion": {a: {b: sum(1 for x, y in pairs if x == a and y == b) for b in ARCHETYPES}
                               for a in ARCHETYPES},
                 "note": "Inferred from twin posteriors + EHR; the truth archetype is never shown to the twin."}
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "profile": profile.name, "patients": len(rows), "days": profile.days,
        "targets": TARGETS,
        "checks": {
            "cohort_median_tir_pct": round(float(np.median(tirs)), 1),
            "tir_in_target_band": bool(55 <= np.median(tirs) <= 75),
            "share_cv_20_36_pct": round(100 * float(np.mean((cvs >= 20) & (cvs <= 36))), 1),
            "cv_median_pct": round(float(np.median(cvs)), 1),
            "share_of_hypo_episodes_in_su_or_insulin_users_pct": round(
                100 * sum(r["hypo_per_week"] for r in su_ins) / total_hypo, 1),
            "patients_su_or_insulin": len(su_ins), "patients_neither": len(neither),
            "mean_glucose_vs_adag_r": round(float(np.corrcoef(cg_mean, eag)[0, 1]), 3),
            "mean_glucose_minus_adag_median": round(float(np.median(cg_mean - eag)), 1),
            "patients_dose_titrated_for_hypos": int(sum(r["titrated"] for r in rows)),
        },
        "per_archetype": per_arch,
        "hypo_by_medication_class": hypo_by_med,
        "postprandial_rise_by_meal": {k: {"n": len(v), "median_rise_mg_dl": round(float(np.median(v)), 1),
                                          "iqr": _q(v)} for k, v in peaks.items()},
        "cohort_distributions": {
            "tir_pct": _q(tirs, (0.1, 0.25, 0.5, 0.75, 0.9)), "cv_pct": _q(cvs, (0.1, 0.25, 0.5, 0.75, 0.9)),
            "mean_glucose": _q(cg_mean, (0.1, 0.25, 0.5, 0.75, 0.9)),
            "tbr70_pct": _q([r["cgm"]["tbr70"] for r in rows], (0.5, 0.75, 0.9)),
            "tar250_pct": _q([r["cgm"]["tar250"] for r in rows], (0.25, 0.5, 0.75)),
            "hyper_l2_episodes_per_day": _q([r["hyper_per_day"] for r in rows]),
        },
        "subtype_inference": agree,
        "patients_table": [{"id": r["id"], "archetype": r["archetype"], "med_class": r["med_class"],
                            "tir": round(r["cgm"]["tir"], 1), "cv": round(r["cgm"]["cv"], 1),
                            "mean": round(r["cgm"]["mean"], 1), "tbr70": round(r["cgm"]["tbr70"], 2),
                            "hba1c": r["hba1c"], "eag": r["eag"]} for r in rows],
    }
    paths.reports.mkdir(parents=True, exist_ok=True)
    with (paths.reports / "cohort_validation.json").open("w", encoding="utf-8") as fh:
        json.dump(clean(report), fh, indent=1, allow_nan=False)
    log(f"cohort validation: median TIR {report['checks']['cohort_median_tir_pct']} %, "
        f"CV median {report['checks']['cv_median_pct']} % ({time.time() - t0:.1f}s)")
    return report
