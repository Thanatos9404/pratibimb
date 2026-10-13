"""Strictly causal features at decision samples ``ks`` (each uses only data with time <= 5 k minutes).

Groups: CGM dynamics, logged meals, logged doses and drug-effect traces, activity, HR/HRV/stress,
sleep, time of day, EHR statics. Twin features are added from the assimilation output.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import SAMPLES_PER_DAY, STEP_MIN
from ..observables import Observed
from ..physiology.drugs import DRUGS
from ..physiology.params import DR_EXT, DR_INS, DR_MET, DR_SLEEP, DR_STRESS, DR_SU

STATIC_FEATURES = ["age", "sex_m", "bmi", "whtr", "hba1c", "tyg", "egfr", "fpg", "diabetes_years", "cpeptide",
                   "rx_metformin", "rx_su", "rx_dpp4", "rx_sglt2", "rx_insulin", "su_dose_rel", "insulin_units",
                   "tcf7l2_t"]


def _window_sums(y: np.ndarray, ks: np.ndarray, w: int):
    valid = ~np.isnan(y)
    t = np.arange(y.shape[0], dtype=float)
    yy = np.where(valid, y, 0.0)
    cs = {
        "n": np.concatenate([[0.0], np.cumsum(valid)]),
        "t": np.concatenate([[0.0], np.cumsum(t * valid)]),
        "y": np.concatenate([[0.0], np.cumsum(yy)]),
        "tt": np.concatenate([[0.0], np.cumsum(t * t * valid)]),
        "ty": np.concatenate([[0.0], np.cumsum(t * yy)]),
        "yy": np.concatenate([[0.0], np.cumsum(yy * yy)]),
    }
    hi = ks + 1
    lo = np.maximum(ks + 1 - w, 0)
    return {k: v[hi] - v[lo] for k, v in cs.items()}


def window_slope(y: np.ndarray, ks: np.ndarray, w: int) -> np.ndarray:
    s = _window_sums(y, ks, w)
    den = s["n"] * s["tt"] - s["t"] ** 2
    with np.errstate(invalid="ignore", divide="ignore"):
        slope = (s["n"] * s["ty"] - s["t"] * s["y"]) / den
    return np.where((s["n"] >= 2) & (den > 0), slope / STEP_MIN, np.nan)


def window_stats(y: np.ndarray, ks: np.ndarray, w: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    s = _window_sums(y, ks, w)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = s["y"] / s["n"]
        var = s["yy"] / s["n"] - mean ** 2
    mean = np.where(s["n"] > 0, mean, np.nan)
    sd = np.where(s["n"] > 1, np.sqrt(np.maximum(var, 0)), np.nan)
    return mean, sd, s["n"] / w


def _frac_window(mask: np.ndarray, valid: np.ndarray, ks: np.ndarray, w: int) -> np.ndarray:
    cm = np.concatenate([[0.0], np.cumsum(mask & valid)])
    cv = np.concatenate([[0.0], np.cumsum(valid)])
    lo = np.maximum(ks + 1 - w, 0)
    n = cv[ks + 1] - cv[lo]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, (cm[ks + 1] - cm[lo]) / n, np.nan)


def _rolling_extreme(y: np.ndarray, ks: np.ndarray, w: int, fn) -> np.ndarray:
    out = np.full(ks.shape[0], np.nan)
    for i, k in enumerate(ks):
        seg = y[max(0, k - w + 1):k + 1]
        seg = seg[~np.isnan(seg)]
        if seg.size:
            out[i] = fn(seg)
    return out


def last_valid(y: np.ndarray, ks: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    idx = np.where(~np.isnan(y), np.arange(y.shape[0]), -1)
    idx = np.maximum.accumulate(idx)
    li = idx[ks]
    val = np.where(li >= 0, y[np.maximum(li, 0)], np.nan)
    age = np.where(li >= 0, (ks - li) * STEP_MIN, np.nan)
    return val, age


def static_features(obs: Observed) -> dict[str, float]:
    e = obs.ehr
    kinds = {}
    su_rel = 0.0
    ins_units = 0.0
    for m in obs.meds:
        spec = DRUGS[m["drug"]]
        kinds[spec.kind] = 1.0
        if spec.kind == "su":
            su_rel += (m["dose_amount"] / spec.ref_dose) ** 0.6 * m["per_day"]
        if spec.kind == "insulin":
            ins_units += m["dose_amount"]
    t_all = 0
    for g in obs.record.get("genetics", []):
        if g["marker"].startswith("TCF7L2"):
            t_all = g["value"].count("T")
    rec = obs.record
    return {
        "age": rec["age"], "sex_m": 1.0 if rec["sex"] == "M" else 0.0, "bmi": rec["bmi"], "whtr": e["whtr"],
        "hba1c": e["hba1c"], "tyg": e["tyg"], "egfr": e["egfr"], "fpg": e["fpg"],
        "diabetes_years": rec["diabetes_years"], "cpeptide": e["cpeptide"] if e.get("cpeptide") else np.nan,
        "rx_metformin": kinds.get("metformin", 0.0), "rx_su": kinds.get("su", 0.0), "rx_dpp4": kinds.get("dpp4", 0.0),
        "rx_sglt2": kinds.get("sglt2", 0.0), "rx_insulin": kinds.get("insulin", 0.0), "su_dose_rel": su_rel,
        "insulin_units": ins_units, "tcf7l2_t": float(t_all),
    }


def compute_features(obs: Observed, ks: np.ndarray, drv: np.ndarray) -> pd.DataFrame:
    """Non-twin features at samples ``ks``; ``drv`` are the twin filter drivers (observable-derived)."""
    ks = np.asarray(ks, dtype=int)
    cgm = obs.cgm
    t = ks * STEP_MIN
    f: dict[str, np.ndarray] = {}
    last, age = last_valid(cgm, ks)
    f["cgm"] = last
    f["cgm_age_min"] = age
    for w, name in ((3, "15"), (6, "30"), (12, "60")):
        f[f"slope{name}"] = window_slope(cgm, ks, w)
    prev = np.maximum(ks - 3, 0)
    f["accel"] = f["slope15"] - window_slope(cgm, prev, 3)
    mean3, sd3, cov3 = window_stats(cgm, ks, 36)
    f["mean3h"], f["sd3h"] = mean3, sd3
    f["cv3h"] = sd3 / mean3
    f["min3h"] = _rolling_extreme(cgm, ks, 36, np.min)
    f["max3h"] = _rolling_extreme(cgm, ks, 36, np.max)
    mean24, sd24, cov24 = window_stats(cgm, ks, SAMPLES_PER_DAY)
    f["mean24h"], f["cv24h"] = mean24, sd24 / mean24
    valid = ~np.isnan(cgm)
    with np.errstate(invalid="ignore"):
        f["tbr24h"] = _frac_window(cgm < 70, valid, ks, SAMPLES_PER_DAY)
        f["tar250_24h"] = _frac_window(cgm > 250, valid, ks, SAMPLES_PER_DAY)
    f["missing1h"] = 1.0 - window_stats(cgm, ks, 12)[2]
    s30 = np.nan_to_num(f["slope30"])
    f["lin30"] = last + s30 * 30
    f["lin60"] = last + s30 * 60
    f["lin120"] = last + s30 * 120

    # ---- meals (logged, time <= t) -----------------------------------------------------------
    mt, mc, mgl, mtau = obs.meal_t, obs.meal_carbs, obs.meal_gl, obs.meal_tau
    dt = t[:, None] - mt[None, :]
    past = dt >= 0
    with np.errstate(over="ignore", invalid="ignore"):
        rem = np.where(past & (dt < 480), (1 + dt / mtau) * np.exp(-dt / mtau), 0.0)
    f["cob_g"] = (rem * mc[None, :]).sum(axis=1)
    f["gl_3h"] = np.where(past & (dt < 180), mgl[None, :], 0.0).sum(axis=1)
    last_meal = np.where(past, dt, np.inf).min(axis=1) if mt.size else np.full(ks.shape[0], np.inf)
    f["min_since_meal"] = np.minimum(last_meal, 720.0)
    idx_last = np.where(past, dt, np.inf).argmin(axis=1) if mt.size else np.zeros(ks.shape[0], dtype=int)
    f["carbs_last_meal"] = np.where(np.isfinite(last_meal), mc[idx_last] if mt.size else 0.0, 0.0)
    day_start = np.floor((t - 240) / 1440) * 1440 + 240
    today = past & (mt[None, :] >= day_start[:, None])
    f["carbs_today"] = np.where(today, mc[None, :], 0.0).sum(axis=1)
    f["meals_today"] = today.sum(axis=1).astype(float)

    # ---- doses & drug-effect traces ----------------------------------------------------------
    mi = np.maximum(t - 1, 0)
    f["su_effect"] = drv[mi, DR_SU]
    f["insulin_rate"] = drv[mi, DR_INS]
    f["met_trace"] = drv[mi, DR_MET]
    f["ex_trace"] = drv[mi, DR_EXT]
    f["sleep_si_mult"] = drv[mi, DR_SLEEP]
    f["stress"] = drv[mi, DR_STRESS]
    su_t = np.array([d["t"] for d in obs.doses if d["taken"] and DRUGS[d["drug"]].kind == "su"], dtype=float)
    if su_t.size:
        dsu = t[:, None] - su_t[None, :]
        f["min_since_su"] = np.minimum(np.where(dsu >= 0, dsu, np.inf).min(axis=1), 1440.0)
    else:
        f["min_since_su"] = np.full(ks.shape[0], 1440.0)
    miss_t = np.array([d["t_sched"] for d in obs.doses if not d["taken"]], dtype=float)
    if miss_t.size:
        dm = t[:, None] - miss_t[None, :]
        f["missed_doses_24h"] = ((dm >= 0) & (dm < 1440)).sum(axis=1).astype(float)
    else:
        f["missed_doses_24h"] = np.zeros(ks.shape[0])

    # ---- activity, HR, HRV ---------------------------------------------------------------------
    st = np.concatenate([[0.0], np.cumsum(obs.steps)])
    f["steps_30"] = st[ks + 1] - st[np.maximum(ks + 1 - 6, 0)]
    f["steps_60"] = st[ks + 1] - st[np.maximum(ks + 1 - 12, 0)]
    day0 = (ks // SAMPLES_PER_DAY) * SAMPLES_PER_DAY
    f["steps_today"] = st[ks + 1] - st[day0]
    hr15, _, _ = window_stats(obs.hr, ks, 3)
    day = ks // SAMPLES_PER_DAY
    f["hr"] = hr15
    f["hr_vs_base"] = hr15 - obs.hr_base[day]
    hrv_last, hrv_age = last_valid(obs.hrv, ks)
    hrv_last = np.where(hrv_age <= 120, hrv_last, np.nan)
    f["hrv"] = hrv_last
    f["hrv_vs_base"] = hrv_last / obs.hrv_base[day]

    # ---- sleep ---------------------------------------------------------------------------------
    av = np.array([e.avail_k for e in obs.sleeps]) if obs.sleeps else np.zeros(0, dtype=int)
    pos = np.searchsorted(av, ks, side="right") - 1
    dur = np.full(ks.shape[0], np.nan)
    eff = np.full(ks.shape[0], np.nan)
    deep = np.full(ks.shape[0], np.nan)
    debt = np.full(ks.shape[0], np.nan)
    since_wake = np.full(ks.shape[0], np.nan)
    for i, p in enumerate(pos):
        if p >= 0:
            ep = obs.sleeps[p]
            dur[i], eff[i], deep[i] = ep.dur_h, ep.efficiency, ep.deep_pct
            debt[i] = sum(max(0.0, 7.5 - obs.sleeps[j].dur_h) for j in range(max(0, p - 2), p + 1))
            since_wake[i] = min((ks[i] - ep.off_k) * STEP_MIN, 1440)
    f["sleep_h_last"], f["sleep_eff_last"], f["deep_pct_last"] = dur, eff, deep
    f["sleep_debt_3d"] = debt
    f["min_since_wake"] = since_wake
    f["asleep_now"] = (obs.stage[ks] > 0).astype(float)

    # ---- time ----------------------------------------------------------------------------------
    hour = (t % 1440) / 60.0
    f["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    f["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    wd = (t // 1440) % 7  # dataset starts on a Monday
    f["weekday"] = wd.astype(float)
    f["weekend"] = (wd >= 5).astype(float)

    df = pd.DataFrame(f)
    for key, val in static_features(obs).items():
        df[key] = val
    return df.astype(np.float32)


CGM_LINEAR = {"hyper_2h": "lin_hyper", "hypo_1h": "lin_hypo", "nocturnal_hypo": "lin_noct"}


def cgm_linear_scores(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """CGM-only linear extrapolation baseline scores (higher = more risk)."""
    cgm = df["cgm"].to_numpy()
    s30 = np.nan_to_num(df["slope30"].to_numpy())
    s60 = np.nan_to_num(df["slope60"].to_numpy())
    return {
        "hyper_2h": np.maximum(cgm, cgm + s30 * 120),
        "hypo_1h": -np.minimum(cgm, cgm + s30 * 60),
        "nocturnal_hypo": -np.minimum(cgm, cgm + s60 * 120),
    }
