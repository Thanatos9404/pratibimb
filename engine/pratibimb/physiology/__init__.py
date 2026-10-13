"""Twin physiology: extended Bergman minimal model, drug kinetics and numba ensemble kernels."""

from __future__ import annotations

import numpy as np

from .params import DR_DPP4, DR_KR, DR_SLEEP, DR_THR, ND, NORMAL_THRESHOLD


def renal_rate(egfr: float, sglt2: bool = False) -> float:
    """Renal glucose clearance above threshold (1/min, normalised to V_G of a 70 kg adult)."""
    base = 0.0089 * min(max(egfr, 10.0), 120.0) / 100.0
    return base * (0.75 if sglt2 else 1.0)


def neutral_drivers(n_min: int, egfr: float = 90.0) -> np.ndarray:
    """Driver matrix with no drugs, no exercise, normal sleep and no stress."""
    d = np.zeros((n_min, ND))
    d[:, DR_SLEEP] = 1.0
    d[:, DR_DPP4] = 1.0
    d[:, DR_THR] = NORMAL_THRESHOLD
    d[:, DR_KR] = renal_rate(egfr)
    return d


__all__ = ["neutral_drivers", "renal_rate"]
