"""Medication catalogue and simple pharmacokinetic/pharmacodynamic kernels.

All kernels are evaluated on a 1-minute grid. Effects superpose linearly over doses.

* Sulfonylureas: normalised Bateman curve (peak = 1 for the reference dose), amplitude
  ``(dose / ref_dose) ** 0.6``.
* Basal insulin (glargine): two-step subcutaneous depot -> plasma appearance density (integrates to 1),
  scaled to uU/mL/min by bioavailability and insulin distribution volume.
* Metformin, DPP-4 and SGLT2 inhibitors: an exponentially weighted *adherence trace* (1.0 at steady
  full adherence) that scales their effect.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np


@dataclass(frozen=True)
class DrugSpec:
    key: str
    name: str
    drug_class: str  # human-readable class
    kind: str  # "metformin" | "su" | "dpp4" | "sglt2" | "insulin"
    unit: str
    ref_dose: float
    ka_min: float = 0.0  # absorption rate (1/min) for SU
    t_half_h: float = 0.0  # elimination half-life (h) for SU / insulin depot
    trace_tau_h: float = 24.0  # adherence-trace memory for chronic-effect drugs


DRUGS: dict[str, DrugSpec] = {
    "metformin": DrugSpec("metformin", "Metformin", "Biguanide", "metformin", "mg", 1000, trace_tau_h=36),
    "glimepiride": DrugSpec("glimepiride", "Glimepiride", "Sulfonylurea", "su", "mg", 2, 1 / 60, 7.0),
    "gliclazide_mr": DrugSpec("gliclazide_mr", "Gliclazide MR", "Sulfonylurea", "su", "mg", 60, 1 / 150, 14.0),
    "gliclazide": DrugSpec("gliclazide", "Gliclazide", "Sulfonylurea", "su", "mg", 80, 1 / 60, 10.0),
    "sitagliptin": DrugSpec("sitagliptin", "Sitagliptin", "DPP-4 inhibitor", "dpp4", "mg", 100, trace_tau_h=24),
    "vildagliptin": DrugSpec("vildagliptin", "Vildagliptin", "DPP-4 inhibitor", "dpp4", "mg", 50, trace_tau_h=16),
    "teneligliptin": DrugSpec("teneligliptin", "Teneligliptin", "DPP-4 inhibitor", "dpp4", "mg", 20, trace_tau_h=24),
    "dapagliflozin": DrugSpec("dapagliflozin", "Dapagliflozin", "SGLT2 inhibitor", "sglt2", "mg", 10, trace_tau_h=24),
    "empagliflozin": DrugSpec("empagliflozin", "Empagliflozin", "SGLT2 inhibitor", "sglt2", "mg", 10, trace_tau_h=24),
    "glargine": DrugSpec("glargine", "Insulin glargine", "Basal insulin", "insulin", "U", 20, 1 / 90, 14.0),
}

SU_WINDOW_MIN = 48 * 60
INSULIN_WINDOW_MIN = 60 * 60
INSULIN_BIOAVAIL = 0.8


@lru_cache(maxsize=64)
def su_kernel(ka: float, t_half_h: float, window: int = SU_WINDOW_MIN) -> np.ndarray:
    """Normalised (peak 1) Bateman effect curve for a sulfonylurea dose."""
    t = np.arange(window, dtype=float)
    ke = np.log(2.0) / (t_half_h * 60.0)
    curve = np.exp(-ke * t) - np.exp(-ka * t)
    return curve / curve.max()


@lru_cache(maxsize=16)
def insulin_density(k_fast: float, t_half_h: float, window: int = INSULIN_WINDOW_MIN) -> np.ndarray:
    """Plasma appearance density (fraction of dose per minute) for a two-step depot."""
    t = np.arange(window, dtype=float)
    k2 = np.log(2.0) / (t_half_h * 60.0)
    k1 = k_fast
    return (k1 * k2 / (k1 - k2)) * (np.exp(-k2 * t) - np.exp(-k1 * t))


@lru_cache(maxsize=16)
def trace_kernel(tau_h: float, doses_per_day: int) -> np.ndarray:
    """Exponential adherence kernel; full adherence at ``doses_per_day`` gives a trace of ~1."""
    tau = tau_h * 60.0
    t = np.arange(int(5 * tau), dtype=float)
    w = 1440.0 / (doses_per_day * tau)
    return w * np.exp(-t / tau)


def accumulate(out: np.ndarray, grid_start: int, dose_t: np.ndarray, amount: np.ndarray,
               kernel: np.ndarray) -> np.ndarray:
    """Add ``amount * kernel(t - dose_t)`` for each dose onto ``out`` (a per-minute grid starting at
    ``grid_start``). Doses after the grid end are ignored; doses before it contribute their tails."""
    n = out.shape[0]
    klen = kernel.shape[0]
    for td, a in zip(np.asarray(dose_t, dtype=float), np.asarray(amount, dtype=float), strict=True):
        if a == 0.0:
            continue
        td_i = int(round(td))
        start = td_i - grid_start
        if start >= n or start + klen <= 0:
            continue
        k0 = max(0, -start)
        o0 = max(0, start)
        m = min(n - o0, klen - k0)
        out[o0:o0 + m] += a * kernel[k0:k0 + m]
    return out


def su_amplitude(drug: str, dose: float) -> float:
    spec = DRUGS[drug]
    return float((dose / spec.ref_dose) ** 0.6)


def format_dose(drug: str, dose: float) -> str:
    spec = DRUGS[drug]
    v = f"{dose:g}"
    return f"{v} {spec.unit}"


def frequency_label(n_per_day: int) -> str:
    return {1: "OD", 2: "BD", 3: "TDS"}.get(n_per_day, f"{n_per_day}x/day")
