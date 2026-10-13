"""Twin model layout, fixed constants, parameter bounds and population defaults.

Units: glucose mg/dL, insulin uU/mL, time minutes, carbohydrate mg inside the ODE (grams at the API).

The *personalised* parameter vector theta (estimated by the EnKF, stored in log/logit space):

======== ============================== ====================== ==========================
key      meaning                        unit                   population default (range)
======== ============================== ====================== ==========================
SI       insulin sensitivity            1/min per uU/mL        2.0e-4 (2e-5 .. 2e-3)
SG       glucose effectiveness          1/min                  0.009 (0.003 .. 0.04)
beta     beta-cell responsiveness       uU/mL/min per mg/dL    0.05 (0.003 .. 0.5)
EGP      basal endogenous glucose prod. mg/kg/min              2.0 (0.8 .. 5.0)
tau_s    gut absorption time scale      x (dimensionless)      1.0 (0.5 .. 2.0)
dawn     dawn EGP amplitude             fraction of EGP        0.15 (0 .. 0.6)
======== ============================== ====================== ==========================

Sources/justification for the fixed constants are in ``docs/MODEL_CARD.md`` (Bergman minimal model
literature for SG/SI/p2/n ranges; Dalla Man et al. for gut absorption shape; ADAG for HbA1c ->
mean glucose).
"""

from __future__ import annotations

import numpy as np

# ---- augmented state layout -------------------------------------------------------------------
S_G, S_X, S_I, S_D1, S_D2, S_GI, S_TAU = 0, 1, 2, 3, 4, 5, 6
P_SI, P_SG, P_BETA, P_EGP, P_TAUS, P_DAWN = 7, 8, 9, 10, 11, 12
NX = 7  # dynamic states (incl. carried gut time-constant)
NP = 6  # personalised parameters
NZ = NX + NP
STATE_NAMES = ["G", "X", "I", "D1", "D2", "Gi", "tau_gut"]
PARAM_KEYS = ["SI", "SG", "beta", "EGP", "meal_rate", "dawn"]

# ---- exogenous driver layout (per minute) ------------------------------------------------------
DR_SU, DR_INS, DR_EXI, DR_EXT, DR_SLEEP, DR_STRESS, DR_MET, DR_DPP4, DR_THR, DR_KR = range(10)
ND = 10
DRIVER_NAMES = [
    "su_effect", "insulin_appearance", "exercise_intensity", "exercise_trace", "sleep_si_mult",
    "stress_index", "metformin_adherence", "dpp4_mult", "renal_threshold", "renal_rate",
]

# ---- per-patient constants vector --------------------------------------------------------------
(C_VG, C_P2, C_N, C_TAUI, C_KEX, C_H, C_KSU, C_SUGAIN, C_AEX, C_FBIO, C_EMET, C_ESTR_EGP, C_ESTR_SI,
 C_DAWN_MAX, C_DAWN_PEAK, C_DAWN_W) = range(16)
NC = 16

VG_PER_KG = 1.6  # dL/kg glucose distribution volume
VI_PER_KG = 120.0  # mL/kg insulin distribution volume
P2 = 0.025  # 1/min remote insulin action rate
N_INS = 0.14  # 1/min insulin clearance
TAU_I = 9.0  # min plasma -> interstitial lag
K_EX = 0.0045  # 1/min insulin-independent uptake per unit exercise intensity
K_SU = 25.0  # glucose-independent SU secretion (mg/dL-equivalent stimulus at peak effect)
SU_GAIN = 0.6  # SU amplification of glucose-stimulated secretion
A_EX = 0.5  # post-exercise SI boost per unit exercise trace
F_BIO = 0.9  # carbohydrate bioavailability
E_MET = 0.15  # metformin EGP reduction at full adherence
E_STRESS_EGP = 0.10
E_STRESS_SI = 0.08
DAWN_MAX = 0.6
DAWN_PEAK_H = 6.0
DAWN_WIDTH_H = 1.5
DPP4_GAIN = 0.15
SGLT2_THRESHOLD = 105.0
NORMAL_THRESHOLD = 180.0


def patient_constants(weight_kg: float, h_threshold: float) -> np.ndarray:
    """Fixed (non-estimated) constants for one patient."""
    c = np.zeros(NC)
    c[C_VG] = VG_PER_KG * weight_kg
    c[C_P2] = P2
    c[C_N] = N_INS
    c[C_TAUI] = TAU_I
    c[C_KEX] = K_EX
    c[C_H] = h_threshold
    c[C_KSU] = K_SU
    c[C_SUGAIN] = SU_GAIN
    c[C_AEX] = A_EX
    c[C_FBIO] = F_BIO
    c[C_EMET] = E_MET
    c[C_ESTR_EGP] = E_STRESS_EGP
    c[C_ESTR_SI] = E_STRESS_SI
    c[C_DAWN_MAX] = DAWN_MAX
    c[C_DAWN_PEAK] = DAWN_PEAK_H
    c[C_DAWN_W] = DAWN_WIDTH_H
    return c


# ---- parameter transforms & bounds -------------------------------------------------------------
POP_DEFAULT = {"SI": 2.0e-4, "SG": 0.009, "beta": 0.05, "EGP": 2.0, "meal_rate": 1.0, "dawn": 0.15}
BOUNDS_NATURAL = {
    "SI": (2e-5, 2e-3),
    "SG": (0.003, 0.04),
    "beta": (0.003, 0.5),
    "EGP": (0.8, 5.0),
    "meal_rate": (0.5, 2.0),  # tau scale
    "dawn": (0.0, DAWN_MAX),
}


def to_internal(key: str, value: float) -> float:
    """Natural -> internal (log, or logit for dawn)."""
    if key == "dawn":
        f = np.clip(value / DAWN_MAX, 1e-4, 1 - 1e-4)
        return float(np.log(f / (1 - f)))
    return float(np.log(value))


def to_natural(key: str, z: np.ndarray | float) -> np.ndarray | float:
    if key == "dawn":
        return DAWN_MAX / (1.0 + np.exp(-np.asarray(z)))
    return np.exp(z)


def internal_bounds() -> tuple[np.ndarray, np.ndarray]:
    """Lower/upper bounds for the full augmented state in internal coordinates."""
    lo = np.full(NZ, -np.inf)
    hi = np.full(NZ, np.inf)
    lo[S_G], hi[S_G] = 20.0, 600.0
    lo[S_X], hi[S_X] = 0.0, 0.2
    lo[S_I], hi[S_I] = 0.0, 500.0
    lo[S_D1], lo[S_D2] = 0.0, 0.0
    lo[S_GI], hi[S_GI] = 20.0, 600.0
    lo[S_TAU], hi[S_TAU] = 15.0, 150.0
    for p, key in zip(range(NX, NZ), PARAM_KEYS, strict=True):
        a, b = BOUNDS_NATURAL[key]
        if key == "dawn":
            lo[p], hi[p] = -5.0, 5.0
        else:
            lo[p], hi[p] = np.log(a), np.log(b)
    return lo, hi
