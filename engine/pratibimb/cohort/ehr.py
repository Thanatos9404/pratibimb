"""Synthetic EHR: two years of labs, comorbidities, medication list and a small genetic panel.

Lab values are generated from the hidden physiology with noise (e.g. TG worsens with insulin
resistance, HbA1c follows the simulated mean glucose through ADAG plus an individual glycation gap),
so the EHR is *informative but imperfect* - exactly what the twin's priors have to work with.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
from scipy.optimize import brentq

from ..config import DATASET_START
from .patient import PatientSpec
from .truth import TruthResult

SNOMED = "http://snomed.info/sct"
LOINC = "http://loinc.org"

LAB_DEFS: dict[str, tuple[str, str, str, str]] = {
    # key: (display name, LOINC, unit, reference text)
    "hba1c": ("HbA1c", "4548-4", "%", "<5.7 % (non-diabetic); target <7 %"),
    "fpg": ("Fasting plasma glucose", "1558-6", "mg/dL", "70-99 mg/dL"),
    "tg": ("Triglycerides", "2571-8", "mg/dL", "<150 mg/dL"),
    "hdl": ("HDL cholesterol", "2085-9", "mg/dL", ">40 (M) / >50 (F) mg/dL"),
    "tc": ("Total cholesterol", "2093-3", "mg/dL", "<200 mg/dL"),
    "ldl": ("LDL cholesterol (calculated)", "13457-7", "mg/dL", "<100 mg/dL"),
    "creatinine": ("Serum creatinine", "2160-0", "mg/dL", "0.6-1.2 mg/dL"),
    "egfr": ("eGFR (CKD-EPI 2021)", "62238-1", "mL/min/1.73m2", ">=90"),
    "alt": ("ALT", "1742-6", "U/L", "<40 U/L"),
    "uacr": ("Urine albumin/creatinine ratio", "9318-7", "mg/g", "<30 mg/g"),
    "cpeptide": ("C-peptide (fasting)", "1986-9", "ng/mL", "0.8-3.1 ng/mL"),
    "bmi": ("Body mass index", "39156-5", "kg/m2", "18.5-22.9 (Asian)"),
    "waist": ("Waist circumference", "8280-0", "cm", "<90 (M) / <80 (F) cm (Asian)"),
    "weight": ("Body weight", "29463-7", "kg", ""),
    "height": ("Body height", "8302-2", "cm", ""),
    "sbp": ("Systolic blood pressure", "8480-6", "mm[Hg]", "<130"),
    "dbp": ("Diastolic blood pressure", "8462-4", "mm[Hg]", "<80"),
}


def ckd_epi_2021(scr: float, age: float, female: bool) -> float:
    """CKD-EPI 2021 race-free creatinine equation (mL/min/1.73 m2)."""
    k = 0.7 if female else 0.9
    a = -0.241 if female else -0.302
    r = scr / k
    egfr = 142.0 * min(r, 1.0) ** a * max(r, 1.0) ** -1.200 * 0.9938 ** age
    return egfr * (1.012 if female else 1.0)


def creatinine_for_egfr(egfr: float, age: float, female: bool) -> float:
    return float(brentq(lambda s: ckd_epi_2021(s, age, female) - egfr, 0.2, 15.0))


def tyg_index(tg: float, fpg: float) -> float:
    """TyG = ln(TG [mg/dL] x FPG [mg/dL] / 2)."""
    return float(np.log(tg * fpg / 2.0))


def adag_eag(hba1c: float) -> float:
    """ADAG estimated average glucose (mg/dL) = 28.7 x HbA1c - 46.7."""
    return 28.7 * hba1c - 46.7


def adag_hba1c(mean_glucose: float) -> float:
    return (mean_glucose + 46.7) / 28.7


def _date(months_before: float) -> str:
    return (DATASET_START - timedelta(days=30.4 * months_before)).date().isoformat()


def build_ehr(spec: PatientSpec, truth: TruthResult) -> dict:
    """Return the EHR payload: labs (history), summary values, conditions, medications, genetics."""
    rng = np.random.default_rng([spec.seed, 7])
    tp = spec.truth
    female = spec.sex == "F"
    g = truth.g[1440:]
    mean_g = float(g.mean()) * float(np.exp(rng.normal(0, 0.04)))  # 3-month vs 28-day mean
    hba1c_latent = adag_hba1c(mean_g)
    hba1c = float(np.clip(hba1c_latent + rng.normal(0, 0.3) + rng.normal(0, 0.1), 5.6, 14.0))
    mod = (np.arange(truth.g.shape[0]) % 1440)
    fast = truth.g[(mod >= 7 * 60) & (mod < 8 * 60)]
    fpg = float(np.clip(fast.mean() * rng.lognormal(0, 0.07), 80, 400))
    si_rel = tp.si0 / 1.8e-4
    from .archetypes import SPECS

    tg = float(np.clip(SPECS[spec.archetype].tg_mean * si_rel ** -0.35 * rng.lognormal(0, 0.22), 60, 650))
    hdl = float(np.clip(44 + (7 if female else 0) + 4.0 * np.log(si_rel) + rng.normal(0, 6), 24, 85))
    tc = float(np.clip(rng.normal(182, 32), 110, 300))
    ldl = float(np.clip(tc - hdl - tg / 5.0, 40, 220))
    creat = creatinine_for_egfr(spec.egfr, spec.age, female)
    nafld = rng.random() < (0.55 if spec.archetype in ("IROD", "SIRD") else 0.25)
    alt = float(np.clip(rng.normal(48 if nafld else 26, 12 if nafld else 7), 10, 160))
    uacr = float(np.clip(rng.lognormal(np.log(14 * (2.5 if spec.diabetes_years > 10 or spec.egfr < 60 else 1)), 0.8),
                         2, 1500))
    htn = rng.random() < np.clip(0.3 + 0.012 * (spec.age - 45) + 0.02 * (spec.bmi - 24), 0.1, 0.85)
    sbp = float(np.clip(rng.normal(138 if htn else 124, 10), 100, 185))
    dbp = float(np.clip(sbp * 0.62 + rng.normal(0, 5), 60, 110))
    has_cpep = rng.random() < 0.35
    cpep = float(np.clip((0.5 + 22.0 * tp.beta) * (fpg / 150) ** 0.5 * rng.lognormal(0, 0.2), 0.2, 8.0))

    current = {
        "hba1c": round(hba1c, 1), "fpg": round(fpg), "tg": round(tg), "hdl": round(hdl), "tc": round(tc),
        "ldl": round(ldl), "creatinine": round(creat, 2), "egfr": round(spec.egfr), "alt": round(alt),
        "uacr": round(uacr, 1), "bmi": spec.bmi, "waist": spec.waist_cm, "weight": spec.weight_kg,
        "height": spec.height_cm, "sbp": round(sbp), "dbp": round(dbp),
    }
    if has_cpep:
        current["cpeptide"] = round(cpep, 2)

    labs: list[dict] = []

    def add(key: str, value: float, months: float) -> None:
        name, loinc, unit, ref = LAB_DEFS[key]
        labs.append({"name": name, "loinc": loinc, "value": value, "unit": unit, "date": _date(months), "ref": ref})

    drift = rng.normal(0.25, 0.5)
    for months in (24, 18, 12, 9, 6, 3):
        if rng.random() < 0.8 or months in (12, 3):
            val = hba1c + drift * months / 24 + rng.normal(0, 0.25)
            add("hba1c", round(float(np.clip(val, 5.6, 14)), 1), months)
            add("fpg", round(float(np.clip(fpg * (1 + 0.04 * drift * months / 24) * rng.lognormal(0, 0.08), 80, 400))),
                months)
    add("hba1c", current["hba1c"], 0.5)
    add("fpg", current["fpg"], 0.5)
    for months in (24, 12):
        for key in ("tg", "hdl", "tc", "ldl"):
            add(key, round(current[key] * float(rng.lognormal(0, 0.08))), months)
        add("creatinine", round(creat * float(rng.lognormal(0, 0.05)), 2), months)
        add("egfr", round(spec.egfr * float(rng.lognormal(0.02 * months / 12, 0.05))), months)
        add("weight", round(spec.weight_kg * float(rng.lognormal(0, 0.03)), 1), months)
    for key in ("tg", "hdl", "tc", "ldl", "creatinine", "egfr", "alt", "uacr", "bmi", "waist", "weight", "height",
                "sbp", "dbp"):
        add(key, current[key], 0.5)
    if has_cpep:
        add("cpeptide", current["cpeptide"], 6)
    labs.sort(key=lambda r: (r["date"], r["name"]))

    onset = (DATASET_START - timedelta(days=365.25 * spec.diabetes_years)).date().isoformat()
    conditions = [{"system": SNOMED, "code": "44054006", "display": "Type 2 diabetes mellitus", "onset": onset}]

    def cond(code: str, display: str, years_before: float | None = None) -> None:
        item = {"system": SNOMED, "code": code, "display": display}
        if years_before is not None:
            item["onset"] = (DATASET_START - timedelta(days=365.25 * years_before)).date().isoformat()
        conditions.append(item)

    if htn:
        cond("38341003", "Hypertensive disorder", float(rng.uniform(0.5, 12)))
    if tg >= 150 or ldl >= 100 or hdl < 40:
        cond("370992007", "Dyslipidemia", float(rng.uniform(0.5, 8)))
    if nafld:
        cond("197321007", "Steatosis of liver (NAFLD on ultrasound)", float(rng.uniform(0.5, 6)))
    if spec.egfr < 60 or uacr >= 30:
        stage = "3a" if spec.egfr >= 45 else ("3b" if spec.egfr >= 30 else "4")
        label = f"Chronic kidney disease (G{stage})" if spec.egfr < 60 else "Chronic kidney disease (albuminuria A2+)"
        cond("709044004", label, float(rng.uniform(0.5, 5)))
    if spec.bmi >= 25:
        cond("414916001", "Obesity (BMI >=25 kg/m2, Asian cut-off)")
    if spec.diabetes_years > 8 and rng.random() < 0.3:
        cond("230572002", "Diabetic peripheral neuropathy", float(rng.uniform(0.5, 4)))
    if rng.random() < (0.12 if female else 0.04):
        cond("40930008", "Hypothyroidism", float(rng.uniform(1, 10)))

    meds = [{
        "drug": rx.drug, "name": rx.spec.name, "drug_class": rx.spec.drug_class, "dose": f"{rx.dose:g} {rx.spec.unit}",
        "dose_amount": rx.dose, "unit": rx.spec.unit, "times": rx.times_hhmm(), "per_day": rx.per_day,
        "label": rx.label(),
    } for rx in spec.prescriptions]
    genotype = {0: "CC", 1: "CT", 2: "TT"}[spec.tcf7l2_t_alleles]
    genetics = [
        {"marker": "TCF7L2 rs7903146", "value": genotype,
         "note": "Synthetic. T allele associated with reduced insulin secretion; weak prior on beta-cell decline."},
        {"marker": "T2D polygenic risk score", "value": f"{spec.prs_percentile}th percentile",
         "note": "Synthetic, illustrative only; not a validated Indian PRS."},
    ]
    summary = dict(current)
    summary["tyg"] = round(tyg_index(tg, fpg), 2)
    summary["whtr"] = round(spec.waist_cm / spec.height_cm, 3)
    summary["eag_adag"] = round(adag_eag(hba1c), 1)
    summary["cpeptide"] = current.get("cpeptide")
    return {"labs": labs, "summary": summary, "conditions": conditions, "medications": meds, "genetics": genetics,
            "hba1c_latent": round(hba1c_latent, 2)}
