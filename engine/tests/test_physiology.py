"""ODE sanity: steady state, glucose mass balance, gut mass balance and meal-response shape."""

from __future__ import annotations

import numpy as np

from pratibimb.physiology import neutral_drivers
from pratibimb.physiology.model import _step_member, simulate_single
from pratibimb.physiology.params import (
    C_FBIO, C_VG, NX, NZ, PARAM_KEYS, POP_DEFAULT, S_D1, S_D2, S_G, S_GI, S_TAU, patient_constants, to_internal,
)


def _state(g0: float = 150.0, **over) -> np.ndarray:
    z = np.zeros(NZ)
    z[S_G] = z[S_GI] = g0
    z[S_TAU] = 40.0
    for i, k in enumerate(PARAM_KEYS):
        z[NX + i] = to_internal(k, over.get(k, POP_DEFAULT[k]))
    return z


def _run(z, c, n, carb_at=None, carbs_g=0.0, tau=40.0, minute0=12 * 60, drv=None):
    d = neutral_drivers(n) if drv is None else drv
    carb = np.zeros(n)
    taus = np.full(n, tau)
    if carb_at is not None:
        carb[carb_at] = carbs_g * 1000.0
    g = np.zeros(n)
    gi = np.zeros(n)
    simulate_single(z, d, carb, taus, minute0, n, c, g, gi)
    return g, gi


def test_steady_state_without_secretion():
    c = patient_constants(70.0, h_threshold=1000.0)  # no stimulated secretion
    z = _state(120.0, dawn=1e-3)
    g, _ = _run(z, c, 3000, minute0=12 * 60)
    expected = POP_DEFAULT["EGP"] / 1.6 / POP_DEFAULT["SG"]
    assert abs(g[-1] - expected) / expected < 0.02


def test_glucose_mass_balance_without_disposal():
    c = patient_constants(70.0, h_threshold=1000.0)
    c[C_FBIO] = 0.9
    z = _state(100.0, SG=1e-9, EGP=1e-9, dawn=1e-3)
    d = neutral_drivers(1500)
    d[:, 9] = 0.0  # no renal loss
    g, _ = _run(z, c, 1500, carb_at=10, carbs_g=50.0, drv=d)
    absorbed_mg = (g[-1] - g[0]) * c[C_VG]
    assert abs(absorbed_mg - 0.9 * 50_000) / (0.9 * 50_000) < 0.02


def test_gut_mass_balance():
    c = patient_constants(70.0, 105.0)
    z = _state(140.0)
    d = neutral_drivers(1)[0]
    carbs = 60_000.0
    absorbed = 0.0
    for m in range(900):
        tau = z[S_TAU] * np.exp(z[NX + 4])
        absorbed += c[C_FBIO] * z[S_D2] / tau
        _step_member(z, d, 12.0, c, carbs if m == 0 else 0.0, 40.0)
    remaining = c[C_FBIO] * (z[S_D1] + z[S_D2])
    assert abs(absorbed + remaining - c[C_FBIO] * carbs) / carbs < 0.02


def test_meal_response_shape_and_gi_ordering():
    c = patient_constants(70.0, 105.0)
    base = _state(140.0)
    g0, _ = _run(base.copy(), c, 600)
    g_lo, gi_lo = _run(base.copy(), c, 600, carb_at=0, carbs_g=60.0, tau=60.0)
    g_hi, _ = _run(base.copy(), c, 600, carb_at=0, carbs_g=60.0, tau=30.0)
    peak = int(np.argmax(g_lo))
    assert 30 <= peak <= 150
    assert g_lo.max() - g0[peak] > 40
    assert abs(g_lo[-1] - g0[-1]) < 0.25 * (g_lo.max() - g0[-1])  # returns towards baseline
    assert np.argmax(gi_lo) > peak  # interstitial lags plasma
    assert np.argmax(g_hi) < peak and g_hi.max() > g_lo.max()  # faster (high-GI) meal: earlier, higher peak
