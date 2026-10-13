"""Asian-Indian T2D archetypes (INSPIRED cohort clusters; Anjana et al., BMJ Open Diabetes Res Care 2020).

The archetype is a *truth-only* label: it drives the hidden physiology and EHR sampling but is never
read by the twin or the risk model. Proportions approximate the INSPIRED clusters
(IROD ~39%, SIDD ~26%, MARD ~22%, SIRD ~12%; rounded so they sum to 1).

Parameter medians are illustrative values chosen to reproduce the qualitative cluster descriptions
(SIDD: low beta-cell function, high HbA1c, leaner; SIRD: very insulin resistant with high C-peptide
and TG, includes the "thin-fat" phenotype; MARD: older onset, milder; IROD: obese, insulin
resistant) - they are not fitted to INSPIRED individual data.
"""

from __future__ import annotations

from dataclasses import dataclass

ARCHETYPES = ("SIDD", "SIRD", "MARD", "IROD")
PROPORTIONS = {"IROD": 0.39, "SIDD": 0.26, "MARD": 0.22, "SIRD": 0.13}


@dataclass(frozen=True)
class ArchetypeSpec:
    name: str
    age_mean: float
    age_sd: float
    bmi_mean: float
    bmi_sd: float
    whtr_extra: float  # extra central adiposity (waist-to-height) beyond BMI
    hba1c_mean: float
    hba1c_sd: float
    si_median: float  # 1/min per uU/mL
    beta_median: float  # uU/mL/min per mg/dL
    duration_mean: float  # years since diagnosis
    dawn_range: tuple[float, float]
    p_su: float
    p_dpp4: float
    p_sglt2: float
    p_insulin: float
    tg_mean: float  # mg/dL (log-normal median)
    fpg_mean: float  # pre-treatment fasting glucose set-point (mg/dL)
    fpg_sd: float


SPECS: dict[str, ArchetypeSpec] = {
    "SIDD": ArchetypeSpec("SIDD", 47, 9, 24.0, 3.0, 0.00, 8.8, 0.9, 2.6e-4, 0.020, 7.0, (0.12, 0.45),
                          0.62, 0.35, 0.15, 0.32, 150, 215, 35),
    "SIRD": ArchetypeSpec("SIRD", 50, 9, 25.5, 3.5, 0.04, 7.5, 0.8, 0.9e-4, 0.105, 5.5, (0.08, 0.35),
                          0.35, 0.35, 0.35, 0.10, 210, 178, 25),
    "MARD": ArchetypeSpec("MARD", 61, 7, 24.5, 3.0, 0.01, 6.9, 0.55, 3.0e-4, 0.050, 6.0, (0.06, 0.3),
                          0.38, 0.38, 0.15, 0.05, 140, 155, 20),
    "IROD": ArchetypeSpec("IROD", 50, 9, 29.0, 3.5, 0.03, 7.6, 0.8, 1.4e-4, 0.060, 6.5, (0.08, 0.35),
                          0.45, 0.33, 0.30, 0.10, 185, 180, 28),
}
