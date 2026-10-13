"""Twin glucose-insulin model (extended Bergman minimal model) and ensemble kernels (numba).

Equations (per minute, explicit Euler, see ``docs/MODEL_CARD.md``)::

    dG/dt  = -(SG + X) G + EGP/1.6 * f_EGP(t) + Ra(t)/V_G - k_ex e(t) G - k_r max(G - G_thr, 0)
    dX/dt  = -p2 X + p2 SI m_sleep m_stress m_ex(t) I
    dI/dt  = -n I + beta max(G - h, 0) (1 + g_SU s(t)) m_DPP4 + beta k_SU s(t) + I_exo(t)
    dD1/dt = -D1/tau + CHO_in(t);   dD2/dt = (D1 - D2)/tau;   Ra = f_bio D2 / tau
    dGi/dt = (G - Gi)/tau_i

with ``f_EGP = (1 + dawn * bump(hour; 06:00, 1.5 h)) (1 - e_met a_met) (1 + e_s stress)`` and the gut
time constant ``tau = tau_meal * tau_s`` where ``tau_meal`` is a carbohydrate-weighted mix of the GI-based
time constants of meals currently in the gut.

Kernels operate on an ensemble matrix ``Z`` of shape (members, NZ) holding states and internal
(log/logit) parameters; see :mod:`pratibimb.physiology.params`.
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

from .params import (
    C_AEX, C_DAWN_MAX, C_DAWN_PEAK, C_DAWN_W, C_EMET, C_ESTR_EGP, C_ESTR_SI, C_FBIO, C_H, C_KEX, C_KSU,
    C_N, C_P2, C_SUGAIN, C_TAUI, C_VG, DR_DPP4, DR_EXI, DR_EXT, DR_INS, DR_KR, DR_MET, DR_SLEEP,
    DR_STRESS, DR_SU, DR_THR, NX, NZ, P_BETA, P_DAWN, P_EGP, P_SG, P_SI, P_TAUS, S_D1, S_D2, S_G, S_GI,
    S_I, S_TAU, S_X,
)

# filter-config vector layout
F_QG, F_QX, F_QI, F_RW0 = 0, 1, 2, 3  # F_RW0..F_RW0+5: random-walk sd for the six parameters
F_OBS_ABS, F_OBS_REL, F_GATE, F_INFL, F_MAXREJ = 9, 10, 11, 12, 13
NF = 14


@njit(cache=True, fastmath=True)
def _step_member(z, d, hour, c, carb, carb_tau):
    """Advance one ensemble member by one minute in place."""
    # meal impulse into the first gut compartment, mixing gut time constants by carbohydrate mass
    if carb > 0.0:
        gut = z[S_D1] + z[S_D2]
        z[S_TAU] = (z[S_TAU] * gut + carb_tau * carb) / (gut + carb)
        z[S_D1] += carb
    si = math.exp(z[P_SI])
    sg = math.exp(z[P_SG])
    beta = math.exp(z[P_BETA])
    egp = math.exp(z[P_EGP])
    taus = math.exp(z[P_TAUS])
    dawn = c[C_DAWN_MAX] / (1.0 + math.exp(-z[P_DAWN]))
    g = z[S_G]
    x = z[S_X]
    ins = z[S_I]
    d1 = z[S_D1]
    d2 = z[S_D2]
    tau = z[S_TAU] * taus

    dh = abs(hour - c[C_DAWN_PEAK])
    if dh > 12.0:
        dh = 24.0 - dh
    f_egp = 1.0 + dawn * math.exp(-0.5 * (dh / c[C_DAWN_W]) ** 2)
    f_egp *= (1.0 - c[C_EMET] * d[DR_MET]) * (1.0 + c[C_ESTR_EGP] * d[DR_STRESS])
    egp_rate = egp / 1.6 * f_egp
    si_eff = si * d[DR_SLEEP] * (1.0 + c[C_AEX] * d[DR_EXT]) * (1.0 - c[C_ESTR_SI] * d[DR_STRESS])
    ra = c[C_FBIO] * d2 / tau / c[C_VG]
    uex = c[C_KEX] * d[DR_EXI] * g
    excess = g - d[DR_THR]
    ren = d[DR_KR] * excess if excess > 0.0 else 0.0
    stim = g - c[C_H]
    if stim < 0.0:
        stim = 0.0
    sec = beta * stim * (1.0 + c[C_SUGAIN] * d[DR_SU]) * d[DR_DPP4] + beta * c[C_KSU] * d[DR_SU]

    dg = -(sg + x) * g + egp_rate + ra - uex - ren
    dx = -c[C_P2] * x + c[C_P2] * si_eff * ins
    di = -c[C_N] * ins + sec + d[DR_INS]
    dd1 = -d1 / tau
    dd2 = (d1 - d2) / tau
    dgi = (g - z[S_GI]) / c[C_TAUI]

    z[S_G] = max(g + dg, 15.0)
    z[S_X] = max(x + dx, 0.0)
    z[S_I] = max(ins + di, 0.0)
    z[S_D1] = max(d1 + dd1, 0.0)
    z[S_D2] = max(d2 + dd2, 0.0)
    z[S_GI] = max(z[S_GI] + dgi, 15.0)


@njit(cache=True)
def _add_process_noise(Z, fcfg, lo, hi):
    m = Z.shape[0]
    for j in range(m):
        Z[j, S_G] += fcfg[F_QG] * np.random.standard_normal()
        Z[j, S_X] += fcfg[F_QX] * np.random.standard_normal()
        Z[j, S_I] += fcfg[F_QI] * np.random.standard_normal()
        for p in range(6):
            Z[j, NX + p] += fcfg[F_RW0 + p] * np.random.standard_normal()
        for i in range(NZ):
            if Z[j, i] < lo[i]:
                Z[j, i] = lo[i]
            elif Z[j, i] > hi[i]:
                Z[j, i] = hi[i]


@njit(cache=True)
def _clip(Z, lo, hi):
    for j in range(Z.shape[0]):
        for i in range(NZ):
            if Z[j, i] < lo[i]:
                Z[j, i] = lo[i]
            elif Z[j, i] > hi[i]:
                Z[j, i] = hi[i]


@njit(cache=True)
def _enkf_update(Z, y, fcfg, lo, hi, force):
    """Stochastic EnKF update with a scalar CGM observation of Gi. Returns 1 if applied, 0 if gated."""
    m = Z.shape[0]
    mh = 0.0
    for j in range(m):
        mh += Z[j, S_GI]
    mh /= m
    vh = 0.0
    for j in range(m):
        vh += (Z[j, S_GI] - mh) ** 2
    vh /= (m - 1)
    sd_obs = fcfg[F_OBS_ABS] + fcfg[F_OBS_REL] * y
    r = sd_obs * sd_obs
    s = vh + r
    innov = y - mh
    if (not force) and abs(innov) > fcfg[F_GATE] * math.sqrt(s):
        return 0
    if force:
        r *= 4.0
        s = vh + r
    gain = np.zeros(NZ)
    means = np.zeros(NZ)
    for i in range(NZ):
        mi = 0.0
        for j in range(m):
            mi += Z[j, i]
        means[i] = mi / m
    for i in range(NZ):
        if i == S_TAU:
            continue
        cov = 0.0
        for j in range(m):
            cov += (Z[j, i] - means[i]) * (Z[j, S_GI] - mh)
        gain[i] = cov / (m - 1) / s
    sr = math.sqrt(r)
    for j in range(m):
        dy = y + sr * np.random.standard_normal() - Z[j, S_GI]
        for i in range(NZ):
            Z[j, i] += gain[i] * dy
    # multiplicative inflation of parameter anomalies (prevents collapse)
    infl = fcfg[F_INFL]
    for p in range(NX, NZ):
        mp = 0.0
        for j in range(m):
            mp += Z[j, p]
        mp /= m
        for j in range(m):
            Z[j, p] = mp + infl * (Z[j, p] - mp)
    _clip(Z, lo, hi)
    return 1


@njit(cache=True)
def enkf_run(Z, obs, drv, carb_mg, carb_tau, minute0, n_steps, c, fcfg, lo, hi, seed,
             out_q, out_prior, out_pmean, keep_every, out_keep, rej_state):
    """Run the EnKF for ``n_steps`` 5-minute steps starting at absolute minute ``minute0``.

    * ``obs[k]``: CGM at the *end* of step k (NaN = missing).
    * ``drv``/``carb_mg``/``carb_tau``: per-minute inputs indexed from ``minute0``.
    * Writes posterior G quantiles (p10, p50, p90) to ``out_q[k]``, prior predictive (mean, sd) of Gi
      to ``out_prior[k]``, parameter means to ``out_pmean[k]``; every ``keep_every`` steps (at the end
      of steps keep_every-1, 2*keep_every-1, ...) the full ensemble is copied into ``out_keep``.
    * ``rej_state[0]`` carries the consecutive-gating counter across calls.
    Returns the number of applied updates.
    """
    np.random.seed(seed)
    m = Z.shape[0]
    applied = 0
    gbuf = np.empty(m)
    for k in range(n_steps):
        for s in range(5):
            mi = k * 5 + s
            hour = ((minute0 + mi) % 1440) / 60.0
            for j in range(m):
                _step_member(Z[j], drv[mi], hour, c, carb_mg[mi], carb_tau[mi])
        _add_process_noise(Z, fcfg, lo, hi)
        mu = 0.0
        for j in range(m):
            mu += Z[j, S_GI]
        mu /= m
        var = 0.0
        for j in range(m):
            var += (Z[j, S_GI] - mu) ** 2
        var /= (m - 1)
        y = obs[k]
        sd_obs = fcfg[F_OBS_ABS] + fcfg[F_OBS_REL] * (y if not math.isnan(y) else mu)
        out_prior[k, 0] = mu
        out_prior[k, 1] = math.sqrt(var + sd_obs * sd_obs)
        if not math.isnan(y):
            force = rej_state[0] >= fcfg[F_MAXREJ]
            ok = _enkf_update(Z, y, fcfg, lo, hi, force)
            if ok == 1:
                applied += 1
                rej_state[0] = 0
            else:
                rej_state[0] += 1
        for j in range(m):
            gbuf[j] = Z[j, S_G]
        gs = np.sort(gbuf)
        out_q[k, 0] = gs[int(0.1 * (m - 1) + 0.5)]
        out_q[k, 1] = 0.5 * (gs[(m - 1) // 2] + gs[m // 2])
        out_q[k, 2] = gs[int(0.9 * (m - 1) + 0.5)]
        for p in range(6):
            acc = 0.0
            for j in range(m):
                acc += Z[j, NX + p]
            out_pmean[k, p] = acc / m
        if keep_every > 0 and (k + 1) % keep_every == 0:
            idx = (k + 1) // keep_every - 1
            if idx < out_keep.shape[0]:
                out_keep[idx, :, :] = Z
    return applied


@njit(cache=True)
def forecast_kernel(Z0, drv, meal_mg, meal_tau, minute0, n_min, c, fcfg, lo, hi, seed, noise, out_g):
    """Propagate a copy of ensemble ``Z0`` for ``n_min`` minutes.

    ``drv[n_min, ND]`` are shared drivers; ``meal_mg[m, n_min]``/``meal_tau[m, n_min]`` are
    member-specific carbohydrate impulses (habitual-meal prior and/or scenario meals).
    Plasma glucose is written every 5 minutes into ``out_g[m, n_min // 5 + 1]`` (column 0 = start).
    ``noise`` = 0 disables process noise (deterministic mechanistic run).
    """
    np.random.seed(seed)
    Z = Z0.copy()
    m = Z.shape[0]
    for j in range(m):
        out_g[j, 0] = Z[j, S_G]
    for mi in range(n_min):
        hour = ((minute0 + mi) % 1440) / 60.0
        for j in range(m):
            _step_member(Z[j], drv[mi], hour, c, meal_mg[j, mi], meal_tau[j, mi])
        if (mi + 1) % 5 == 0:
            if noise > 0:
                _add_process_noise(Z, fcfg, lo, hi)
            col = (mi + 1) // 5
            for j in range(m):
                out_g[j, col] = Z[j, S_G]
    return Z


@njit(cache=True)
def simulate_single(z0, drv, carb_mg, carb_tau, minute0, n_min, c, out_g, out_gi):
    """Deterministic single-trajectory simulation (1-min output) used by tests and sanity checks."""
    z = z0.copy()
    for mi in range(n_min):
        hour = ((minute0 + mi) % 1440) / 60.0
        _step_member(z, drv[mi], hour, c, carb_mg[mi], carb_tau[mi])
        out_g[mi] = z[S_G]
        out_gi[mi] = z[S_GI]
    return z
