"""EHR -> twin parameter priors (archetype-agnostic; the twin never reads the truth label).

* Insulin sensitivity from the TyG index (ln(TG x FPG / 2)), waist-to-height ratio and BMI - TyG is a
  validated, cheap surrogate of insulin resistance (fasting insulin is rarely measured in India).
* Beta-cell responsiveness from diabetes duration, HbA1c, fasting C-peptide when available and (weakly)
  the TCF7L2 rs7903146 genotype.
* Basal EGP from the fasting glucose, with ADAG eAG (28.7 x HbA1c - 46.7) as a consistency anchor,
  solved so the twin's fasting steady state matches the patient's fasting glucose.

Coefficients are heuristic and fixed a priori (documented in MODEL_CARD); they were not fitted on
evaluation patients. Prior SDs are wide so the EnKF can move away from them.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..physiology.params import N_INS, NP, PARAM_KEYS, POP_DEFAULT, to_internal

PRIOR_SD = np.array([0.5, 0.3, 0.5, 0.25, 0.25, 0.8])  # internal (log / logit) units


@dataclass
class TwinPrior:
    mean: np.ndarray  # internal coordinates, order PARAM_KEYS
    sd: np.ndarray
    explain: dict

    def natural(self) -> dict[str, float]:
        from ..physiology.params import to_natural

        return {k: float(to_natural(k, self.mean[i])) for i, k in enumerate(PARAM_KEYS)}


def ehr_prior(ehr: dict, record: dict, h: float) -> TwinPrior:
    tyg = float(ehr["tyg"])
    whtr = float(ehr["whtr"])
    bmi = float(record["bmi"])
    hba1c = float(ehr["hba1c"])
    fpg = float(ehr["fpg"])
    dur = float(record["diabetes_years"])
    cpep = ehr.get("cpeptide")
    t_alleles = 0
    for gmk in record.get("genetics", []):
        if gmk["marker"].startswith("TCF7L2"):
            t_alleles = gmk["value"].count("T")

    log_si = np.log(POP_DEFAULT["SI"]) - 0.9 * (tyg - 9.2) - 2.0 * (whtr - 0.57) - 0.02 * (bmi - 25.0)
    log_beta = (np.log(POP_DEFAULT["beta"]) - 0.025 * (dur - 7.0) - 0.12 * (hba1c - 7.8) - 0.05 * t_alleles)
    sd = PRIOR_SD.copy()
    if cpep:
        log_beta += 0.6 * np.log(float(cpep) / 1.8)
        sd[2] = 0.35
    sg = POP_DEFAULT["SG"]
    si = float(np.exp(np.clip(log_si, np.log(3e-5), np.log(1.5e-3))))
    beta = float(np.exp(np.clip(log_beta, np.log(0.004), np.log(0.4))))
    eag = 28.7 * hba1c - 46.7
    g_fast = float(np.clip(0.85 * fpg + 0.15 * (eag - 20.0), 85.0, 300.0))
    x_b = si * beta * max(g_fast - h, 0.0) / N_INS
    egp = float(np.clip(1.6 * g_fast * (sg + x_b), 0.9, 4.8))
    mean = np.array([
        np.log(si), np.log(sg), np.log(beta), np.log(egp), 0.0, to_internal("dawn", POP_DEFAULT["dawn"]),
    ])
    assert mean.shape[0] == NP
    return TwinPrior(mean=mean, sd=sd, explain={"tyg": tyg, "whtr": whtr, "eag": round(eag, 1), "g_fast": g_fast,
                                                 "cpeptide_used": bool(cpep), "tcf7l2_t_alleles": t_alleles})
