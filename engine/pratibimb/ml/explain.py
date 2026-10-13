"""TreeSHAP drivers (LightGBM ``pred_contrib``) mapped to clinician-readable text."""

from __future__ import annotations

import math

import numpy as np

# feature -> (label, value formatter)
_F = {
    "cgm": ("Current glucose (CGM)", lambda v: f"{v:.0f} mg/dL"),
    "cgm_age_min": ("Minutes since last CGM reading", lambda v: f"{v:.0f} min"),
    "slope15": ("Glucose trend (15 min)", lambda v: f"{v:+.1f} mg/dL/min"),
    "slope30": ("Glucose trend (30 min)", lambda v: f"{v:+.1f} mg/dL/min"),
    "slope60": ("Glucose trend (60 min)", lambda v: f"{v:+.1f} mg/dL/min"),
    "accel": ("Trend acceleration", lambda v: f"{v:+.2f} mg/dL/min change"),
    "mean3h": ("Mean glucose, last 3 h", lambda v: f"{v:.0f} mg/dL"),
    "sd3h": ("Glucose variability, last 3 h", lambda v: f"SD {v:.0f} mg/dL"),
    "cv3h": ("Glucose CV, last 3 h", lambda v: f"{100 * v:.0f} %"),
    "min3h": ("Lowest glucose, last 3 h", lambda v: f"{v:.0f} mg/dL"),
    "max3h": ("Highest glucose, last 3 h", lambda v: f"{v:.0f} mg/dL"),
    "mean24h": ("Mean glucose, last 24 h", lambda v: f"{v:.0f} mg/dL"),
    "cv24h": ("Glucose CV, last 24 h", lambda v: f"{100 * v:.0f} %"),
    "tbr24h": ("Time below 70, last 24 h", lambda v: f"{100 * v:.1f} %"),
    "tar250_24h": ("Time above 250, last 24 h", lambda v: f"{100 * v:.1f} %"),
    "missing1h": ("CGM data missing, last hour", lambda v: f"{100 * v:.0f} %"),
    "lin30": ("Straight-line projection +30 min", lambda v: f"{v:.0f} mg/dL"),
    "lin60": ("Straight-line projection +60 min", lambda v: f"{v:.0f} mg/dL"),
    "lin120": ("Straight-line projection +120 min", lambda v: f"{v:.0f} mg/dL"),
    "cob_g": ("Carbohydrate still being absorbed", lambda v: f"{v:.0f} g on board"),
    "gl_3h": ("Glycaemic load eaten, last 3 h", lambda v: f"GL {v:.0f}"),
    "min_since_meal": ("Time since last logged meal", lambda v: f"{v:.0f} min"),
    "carbs_last_meal": ("Carbs in last logged meal", lambda v: f"{v:.0f} g"),
    "carbs_today": ("Carbs logged today", lambda v: f"{v:.0f} g"),
    "meals_today": ("Meals logged today", lambda v: f"{v:.0f}"),
    "su_effect": ("Sulfonylurea effect (active now)", lambda v: f"{100 * v:.0f} % of peak"),
    "insulin_rate": ("Basal insulin action", lambda v: f"{v:.2f} uU/mL/min"),
    "met_trace": ("Metformin adherence (recent)", lambda v: f"{100 * v:.0f} %"),
    "ex_trace": ("Recent physical activity", lambda v: f"{v:.2f} (exercise trace)"),
    "sleep_si_mult": ("Sleep-related insulin sensitivity", lambda v: f"{100 * (v - 1):+.0f} %"),
    "stress": ("Stress index (HR/HRV)", lambda v: f"{v:.2f}"),
    "min_since_su": ("Time since sulfonylurea dose", lambda v: f"{v / 60:.1f} h"),
    "missed_doses_24h": ("Doses marked missed, last 24 h", lambda v: f"{v:.0f}"),
    "steps_30": ("Steps, last 30 min", lambda v: f"{v:.0f}"),
    "steps_60": ("Steps, last 60 min", lambda v: f"{v:.0f}"),
    "steps_today": ("Steps today", lambda v: f"{v:.0f}"),
    "hr": ("Heart rate", lambda v: f"{v:.0f} bpm"),
    "hr_vs_base": ("Heart rate vs personal baseline", lambda v: f"{v:+.0f} bpm"),
    "hrv": ("HRV (RMSSD)", lambda v: f"{v:.0f} ms"),
    "hrv_vs_base": ("HRV vs personal baseline", lambda v: f"{100 * (v - 1):+.0f} %"),
    "sleep_h_last": ("Last night's sleep", lambda v: f"{v:.1f} h"),
    "sleep_eff_last": ("Last night's sleep efficiency", lambda v: f"{100 * v:.0f} %"),
    "deep_pct_last": ("Deep sleep last night", lambda v: f"{100 * v:.0f} %"),
    "sleep_debt_3d": ("Sleep debt, last 3 nights", lambda v: f"{v:.1f} h"),
    "min_since_wake": ("Time since waking", lambda v: f"{v / 60:.1f} h"),
    "asleep_now": ("Asleep now (wearable)", lambda v: "yes" if v > 0.5 else "no"),
    "hour_sin": ("Time of day", lambda v: ""),
    "hour_cos": ("Time of day", lambda v: ""),
    "weekday": ("Day of week", lambda v: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][int(v) % 7]),
    "weekend": ("Weekend", lambda v: "yes" if v > 0.5 else "no"),
    "age": ("Age", lambda v: f"{v:.0f} y"),
    "sex_m": ("Sex", lambda v: "male" if v > 0.5 else "female"),
    "bmi": ("BMI", lambda v: f"{v:.1f} kg/m2"),
    "whtr": ("Waist-to-height ratio", lambda v: f"{v:.2f}"),
    "hba1c": ("HbA1c", lambda v: f"{v:.1f} %"),
    "tyg": ("TyG index (insulin resistance)", lambda v: f"{v:.2f}"),
    "egfr": ("eGFR", lambda v: f"{v:.0f} mL/min/1.73m2"),
    "fpg": ("Fasting glucose (lab)", lambda v: f"{v:.0f} mg/dL"),
    "diabetes_years": ("Diabetes duration", lambda v: f"{v:.0f} y"),
    "cpeptide": ("Fasting C-peptide", lambda v: f"{v:.1f} ng/mL"),
    "rx_metformin": ("On metformin", lambda v: "yes" if v > 0.5 else "no"),
    "rx_su": ("On a sulfonylurea", lambda v: "yes" if v > 0.5 else "no"),
    "rx_dpp4": ("On a DPP-4 inhibitor", lambda v: "yes" if v > 0.5 else "no"),
    "rx_sglt2": ("On an SGLT2 inhibitor", lambda v: "yes" if v > 0.5 else "no"),
    "rx_insulin": ("On basal insulin", lambda v: "yes" if v > 0.5 else "no"),
    "su_dose_rel": ("Sulfonylurea dose intensity", lambda v: f"{v:.1f} x reference"),
    "insulin_units": ("Basal insulin dose", lambda v: f"{v:.0f} U/day"),
    "tcf7l2_t": ("TCF7L2 risk alleles (synthetic)", lambda v: f"{v:.0f}"),
    "tw_g": ("Twin: current plasma glucose", lambda v: f"{v:.0f} mg/dL"),
    "tw_g_sd": ("Twin: estimate uncertainty", lambda v: f"+/-{v:.0f} mg/dL"),
    "tw_gi": ("Twin: interstitial glucose", lambda v: f"{v:.0f} mg/dL"),
    "tw_x": ("Twin: insulin action now", lambda v: f"{1e3 * v:.1f} x10^-3 /min"),
    "tw_ins": ("Twin: plasma insulin above basal", lambda v: f"{v:.0f} uU/mL"),
    "tw_gut": ("Twin: glucose still in the gut", lambda v: f"{v:.0f} g"),
    "fc30_p10": ("Twin forecast +30 min (low)", lambda v: f"{v:.0f} mg/dL"),
    "fc30_p50": ("Twin forecast +30 min", lambda v: f"{v:.0f} mg/dL"),
    "fc30_p90": ("Twin forecast +30 min (high)", lambda v: f"{v:.0f} mg/dL"),
    "fc60_p10": ("Twin forecast +60 min (low)", lambda v: f"{v:.0f} mg/dL"),
    "fc60_p50": ("Twin forecast +60 min", lambda v: f"{v:.0f} mg/dL"),
    "fc60_p90": ("Twin forecast +60 min (high)", lambda v: f"{v:.0f} mg/dL"),
    "fc120_p10": ("Twin forecast +2 h (low)", lambda v: f"{v:.0f} mg/dL"),
    "fc120_p50": ("Twin forecast +2 h", lambda v: f"{v:.0f} mg/dL"),
    "fc120_p90": ("Twin forecast +2 h (high)", lambda v: f"{v:.0f} mg/dL"),
    "fc_max120_p50": ("Twin: forecast peak in next 2 h", lambda v: f"{v:.0f} mg/dL"),
    "fc_min60_p10": ("Twin: plausible low in next hour", lambda v: f"{v:.0f} mg/dL"),
    "fc_min120_p50": ("Twin: forecast low in next 2 h", lambda v: f"{v:.0f} mg/dL"),
    "p_hyper120": ("Twin: chance of >250 within 2 h", lambda v: f"{100 * v:.0f} %"),
    "p_hypo60": ("Twin: chance of <70 within 1 h", lambda v: f"{100 * v:.0f} %"),
    "p_hypo120": ("Twin: chance of <70 within 2 h", lambda v: f"{100 * v:.0f} %"),
    "tw_si": ("Twin: insulin sensitivity", lambda v: f"{1e4 * math.exp(v):.1f} x10^-4"),
    "tw_sg": ("Twin: glucose effectiveness", lambda v: f"{1e2 * math.exp(v):.2f} x10^-2 /min"),
    "tw_beta": ("Twin: beta-cell responsiveness", lambda v: f"{math.exp(v):.3f}"),
    "tw_egp": ("Twin: liver glucose output", lambda v: f"{math.exp(v):.2f} mg/kg/min"),
    "tw_taus": ("Twin: meal absorption speed", lambda v: f"{1 / math.exp(v):.2f} x typical"),
    "tw_dawn": ("Twin: dawn effect", lambda v: f"{60 / (1 + math.exp(-v)):.0f} %"),
    "tw_si_d24": ("Twin: insulin sensitivity change vs 24 h ago", lambda v: f"{100 * (math.exp(v) - 1):+.0f} %"),
    "tw_beta_d24": ("Twin: beta-cell change vs 24 h ago", lambda v: f"{100 * (math.exp(v) - 1):+.0f} %"),
    "tw_egp_d24": ("Twin: liver output change vs 24 h ago", lambda v: f"{100 * (math.exp(v) - 1):+.0f} %"),
    "tw_si_vs_prior": ("Twin: insulin sensitivity vs EHR expectation", lambda v: f"{100 * (math.exp(v) - 1):+.0f} %"),
    "tw_innov30": ("Twin mismatch, last 30 min (possible unlogged food)", lambda v: f"{v:+.0f} mg/dL"),
    "tw_innov_abs60": ("Twin tracking error, last hour", lambda v: f"{v:.0f} mg/dL"),
    "p_noct": ("Twin: chance of a night-time low", lambda v: f"{100 * v:.0f} %"),
    "noct_min_p50": ("Twin: expected overnight low", lambda v: f"{v:.0f} mg/dL"),
    "noct_min_p10": ("Twin: plausible overnight low", lambda v: f"{v:.0f} mg/dL"),
    "noct_mean_p50": ("Twin: expected overnight mean", lambda v: f"{v:.0f} mg/dL"),
}


def feature_label(name: str) -> str:
    return _F.get(name, (name.replace("_", " "), None))[0]


def value_text(name: str, value: float) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "not available"
    fmt = _F.get(name, (None, lambda v: f"{v:.3g}"))[1]
    try:
        return fmt(float(value))
    except (ValueError, OverflowError):
        return f"{value:.3g}"


def drivers_from_contrib(contrib: np.ndarray, x: np.ndarray, names: list[str], top: int = 5) -> list[dict]:
    """``contrib`` = one row of pred_contrib (features + bias). Time-of-day sin/cos are merged."""
    c = contrib[:-1].astype(float).copy()
    merged: dict[str, float] = {}
    vals: dict[str, float] = {}
    for i, n in enumerate(names):
        key = "hour" if n in ("hour_sin", "hour_cos") else n
        merged[key] = merged.get(key, 0.0) + c[i]
        vals[key] = float(x[i])
    if "hour" in merged:
        hs = float(x[names.index("hour_sin")])
        hc = float(x[names.index("hour_cos")])
        hour = (math.degrees(math.atan2(hs, hc)) / 15.0) % 24
        vals["hour"] = hour
    order = sorted(merged, key=lambda k: -abs(merged[k]))[:top]
    out = []
    for key in order:
        if key == "hour":
            h = vals["hour"]
            out.append({"feature": "hour", "label": "Time of day",
                        "value_text": f"{int(h):02d}:{int(round((h % 1) * 60)) % 60:02d}",
                        "contribution": round(merged[key], 4)})
        else:
            out.append({"feature": key, "label": feature_label(key), "value_text": value_text(key, vals[key]),
                        "contribution": round(merged[key], 4)})
    return out


def recommendation(kind: str, drivers: list[dict], su_active: bool) -> str:
    feats = {d["feature"] for d in drivers if d["contribution"] > 0}
    note = " (Illustrative decision support on synthetic data - not medical advice.)"
    if kind == "hypo_1h":
        if su_active:
            return ("Sulfonylurea still active while glucose is falling: check glucose, take 15 g fast-acting "
                    "carbohydrate if below 70 mg/dL, and review SU dose/timing relative to meals." + note)
        return "Falling glucose predicted: check a fingerstick and keep fast-acting carbohydrate at hand." + note
    if kind == "nocturnal_hypo":
        base = "Night-time low predicted: consider a small bedtime snack and check glucose on waking"
        if su_active:
            base += "; review evening sulfonylurea / insulin dose with the clinician"
        return base + "." + note
    if {"cob_g", "gl_3h", "carbs_last_meal", "tw_gut"} & feats:
        return ("High post-meal rise expected: a 10-15 minute walk now and a lower-GI swap (e.g. millet roti "
                "instead of white rice) at the next meal can blunt the spike." + note)
    if {"missed_doses_24h", "met_trace"} & feats:
        return "Recent missed doses may be driving the rise: confirm medication was taken." + note
    if {"stress", "hr_vs_base", "sleep_si_mult", "sleep_debt_3d", "tw_si_d24"} & feats:
        return ("Reduced insulin sensitivity today (short sleep / stress / illness signals): favour lighter, "
                "lower-GI meals and some activity; recheck in 2 h." + note)
    return "Rising glucose expected within 2 h: review the next meal and consider light activity." + note
