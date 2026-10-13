"""Inferred INSPIRED-style subtype from twin posteriors + EHR (never from the hidden truth label).

Each patient is placed in a standardised space (cohort-relative z-scores of log SI, log beta from the
twin, and BMI, age, HbA1c from the EHR) and assigned to the nearest of four a-priori centroids that
encode the published qualitative cluster descriptions (Anjana et al. 2020):
SIDD = low beta-cell function + high HbA1c; SIRD = very low insulin sensitivity; MARD = older + milder;
IROD = high BMI with reduced insulin sensitivity.
"""

from __future__ import annotations

import numpy as np

ORDER = ("SIDD", "SIRD", "MARD", "IROD")
#                    logSI  logBeta  BMI   age  HbA1c
CENTROIDS = np.array([
    [0.2, -1.2, -0.5, -0.4, 1.2],   # SIDD
    [-1.2, 0.8, -0.1, -0.2, 0.0],   # SIRD
    [0.8, 0.0, -0.4, 1.2, -0.8],    # MARD
    [-0.5, 0.2, 1.3, -0.2, 0.1],    # IROD
])
WEIGHTS = np.array([1.0, 1.0, 1.0, 0.8, 1.0])


def infer_subtypes(rows: list[dict]) -> dict[str, str]:
    """``rows``: dicts with id, si, beta (natural units, posterior means), bmi, age, hba1c."""
    if not rows:
        return {}
    x = np.array([[np.log(r["si"]), np.log(r["beta"]), r["bmi"], r["age"], r["hba1c"]] for r in rows], dtype=float)
    med = np.median(x, axis=0)
    iqr = np.subtract(*np.percentile(x, [75, 25], axis=0))
    scale = np.where(iqr > 1e-9, iqr / 1.349, 1.0)
    z = (x - med) / scale
    d = (((z[:, None, :] - CENTROIDS[None, :, :]) ** 2) * WEIGHTS).sum(axis=2)
    return {r["id"]: ORDER[int(i)] for r, i in zip(rows, d.argmin(axis=1), strict=True)}
