"""Truth simulator: the (hidden) physiology that generates each synthetic patient.

Deliberately *richer* than the twin (avoids the inverse crime):

* time-varying insulin sensitivity: slow Ornstein-Uhlenbeck drift x diurnal rhythm x previous-night
  sleep loss x illness episodes x latent stress x post-exercise boost (patient-specific magnitudes);
* two-pathway gut absorption (fast/slow fractions from GI; fat/protein/fibre delay gastric
  emptying; per-meal random variation);
* hepatic insulin suppression of EGP (faster remote insulin compartment) and a counter-regulatory
  EGP rise below 65 mg/dL; latent stress and illness raise EGP;
* glucose-dependent incretin effect for DPP-4 inhibitors; patient-specific SU sensitivity and
  CKD-prolonged SU half-life; day-to-day basal-insulin absorption variability;
* patient-specific interstitial lag (6-12 min), p2 and insulin clearance.

The twin sees none of these internals, only sensor outputs and *logged* events.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numba import njit
from scipy.optimize import brentq
from scipy.signal import lfilter

from ..foods import summarize_meal
from ..physiology import renal_rate
from ..physiology.drugs import (
    DRUGS, INSULIN_BIOAVAIL, accumulate, insulin_density, su_amplitude, su_kernel, trace_kernel,
)
from ..physiology.params import NORMAL_THRESHOLD, VG_PER_KG, VI_PER_KG
from .lifestyle import Lifestyle
from .patient import PatientSpec


HEP_MAX = 0.5  # maximal hepatic suppression of EGP by insulin (truth only)
HEP_X50 = 0.005  # hepatic insulin action giving half-maximal suppression
CR_THRESHOLD = 60.0  # counter-regulation onset (mg/dL)
SU_ABS = 10.0  # glucose-independent SU insulin secretion at unit effect (uU/mL/min)
TRUTH_SU_GAIN = 0.6  # SU amplification of glucose-stimulated secretion (truth)


@dataclass
class TruthDrivers:
    carb_fast: np.ndarray
    tau_fast: np.ndarray
    carb_slow: np.ndarray
    tau_slow: np.ndarray
    si: np.ndarray
    egp_shape: np.ndarray
    ex: np.ndarray
    su: np.ndarray
    ins: np.ndarray
    incretin: np.ndarray
    thr: np.ndarray
    kr: np.ndarray
    consts: np.ndarray  # sg, beta, h, p2, n, tau_i, k_ex, k_su, su_gain, cr_gain, vg, fbio


@dataclass
class TruthResult:
    g: np.ndarray  # plasma glucose, per minute
    gi: np.ndarray  # interstitial glucose, per minute
    ins: np.ndarray  # insulin above basal, per minute
    egp0: float
    drivers: TruthDrivers


@njit(cache=True, fastmath=True)
def _truth_kernel(cf, tf, cs, ts, si, egp_shape, ex, su, ins_in, incr, thr, kr, k, egp0, g0, out_g, out_gi,
                  out_i):
    sg, beta, h, p2, n, tau_i, kex, ksu, su_gain, cr_gain, vg, fbio, hep_max, hep_x50, cr_thr = (
        k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9], k[10], k[11], k[12], k[13], k[14])
    g = g0
    x = 0.0
    xh = 0.0
    ins = 0.0
    df1 = 0.0
    df2 = 0.0
    ds1 = 0.0
    ds2 = 0.0
    tauf = 20.0
    taus = 65.0
    gi = g0
    for m in range(cf.shape[0]):
        if cf[m] > 0.0:
            tot = df1 + df2
            tauf = (tauf * tot + tf[m] * cf[m]) / (tot + cf[m])
            df1 += cf[m]
        if cs[m] > 0.0:
            tot = ds1 + ds2
            taus = (taus * tot + ts[m] * cs[m]) / (tot + cs[m])
            ds1 += cs[m]
        ra = fbio * (df2 / tauf + ds2 / taus) / vg
        low = (cr_thr - g) / 30.0
        if low < 0.0:
            low = 0.0
        elif low > 1.5:
            low = 1.5
        hep = 1.0 - hep_max * xh / (xh + hep_x50)  # hepatic insulin suppression of EGP
        egp = egp0 / 1.6 * egp_shape[m] * hep * (1.0 + cr_gain * low)
        exc = g - thr[m]
        ren = kr[m] * exc if exc > 0.0 else 0.0
        dg = -(sg + x) * g + egp + ra - kex * ex[m] * g - ren
        dx = -p2 * x + p2 * si[m] * ins
        dxh = -0.05 * xh + 0.05 * si[m] * ins
        stim = g - h
        if stim < 0.0:
            stim = 0.0
        rf = ra / 2.0
        if rf > 1.0:
            rf = 1.0
        sec = beta * stim * (1.0 + su_gain * su[m]) * (1.0 + incr[m] * rf) + ksu * su[m]
        di = -n * ins + sec + ins_in[m]
        out_g[m] = g
        out_gi[m] = gi
        out_i[m] = ins
        g = max(g + dg, 18.0)
        x = max(x + dx, 0.0)
        xh = max(xh + dxh, 0.0)
        ins = max(ins + di, 0.0)
        ndf1 = df1 - df1 / tauf
        df2 = df2 + (df1 - df2) / tauf
        df1 = ndf1
        nds1 = ds1 - ds1 / taus
        ds2 = ds2 + (ds1 - ds2) / taus
        ds1 = nds1
        gi = gi + (g - gi) / tau_i
    return g


def _ou(rng: np.random.Generator, n_min: int, sd: float, tau_days: float) -> np.ndarray:
    """Hourly OU process interpolated to minutes (stationary sd ``sd``)."""
    n_h = n_min // 60 + 2
    a = math.exp(-1.0 / (tau_days * 24.0))
    eps = rng.normal(0, sd * math.sqrt(1 - a * a), n_h)
    x = lfilter([1.0], [1.0, -a], eps)
    x[0:] += rng.normal(0, sd) * a ** np.arange(n_h)
    return np.interp(np.arange(n_min) / 60.0, np.arange(n_h), x)


def _exp_trace(x: np.ndarray, tau_min: float, gain: float) -> np.ndarray:
    a = math.exp(-1.0 / tau_min)
    return lfilter([gain], [1.0, -a], x)


def build_drivers(spec: PatientSpec, life: Lifestyle) -> TruthDrivers:
    tp = spec.truth
    rng = np.random.default_rng([spec.seed, 3])
    n = life.n_min
    minute = np.arange(n)
    hour = (minute % 1440) / 60.0

    # ---- meals: two-pathway gut ---------------------------------------------------------------
    cf = np.zeros(n)
    tf = np.full(n, 20.0)
    cs = np.zeros(n)
    ts = np.full(n, 65.0)
    for meal in life.meals:
        s = summarize_meal(meal.items)
        if s.carbs_g <= 0:
            continue
        frac_fast = float(np.clip((s.gi - 25.0) / 85.0, 0.1, 0.9))
        scale = tp.tau_scale * rng.lognormal(0, 0.15)
        t = meal.t
        cf[t] += 1000.0 * s.carbs_g * frac_fast
        cs[t] += 1000.0 * s.carbs_g * (1 - frac_fast)
        tf[t] = 20.0 * scale * (1 + 0.003 * s.fat_g)
        ts[t] = 65.0 * scale * (1 + 0.008 * s.fat_g + 0.004 * s.protein_g + 0.015 * s.fiber_g)

    # ---- exercise ----------------------------------------------------------------------------
    ex = np.clip((life.steps_min.astype(float) - 30.0) / 75.0, 0.0, 1.4)
    ex_trace = np.minimum(_exp_trace(ex, tp.tau_ex_min, 1.0 / 60.0), 1.5)

    # ---- previous-night sleep loss -> next-day SI reduction ------------------------------------
    sleep_mult = np.ones(n)
    for i, (onset, wake) in enumerate(life.sleeps):
        dur_h = (wake - onset) / 60.0
        loss = float(np.clip((7.0 - dur_h) / 3.0, 0.0, 1.0))
        nxt = life.sleeps[i + 1][0] if i + 1 < len(life.sleeps) else n
        a, b = max(wake, 0), min(nxt, n)
        if b > a:
            sleep_mult[a:b] = 1.0 - tp.sleep_si_sens * loss

    illness_factor = 1.0 - rng.uniform(0.3, 0.45)
    si = (tp.si0 * np.exp(_ou(rng, n, tp.si_ou_sd, tp.si_ou_tau_days))
          * (1.0 + tp.circ_si_amp * np.cos(2 * np.pi * (hour - 9.0) / 24.0))
          * sleep_mult
          * np.where(life.illness > 0, illness_factor, 1.0)
          * (1.0 + tp.a_ex * ex_trace)
          * (1.0 - 0.1 * life.stress))

    # ---- drugs -------------------------------------------------------------------------------
    su = np.zeros(n)
    ins = np.zeros(n)
    met = np.zeros(n)
    dpp4 = np.zeros(n)
    sglt2 = np.zeros(n)
    per_day = {rx.drug: rx.per_day for rx in spec.prescriptions}
    for dose in life.doses:
        if not dose.taken:
            continue
        drug = DRUGS[dose.drug]
        if drug.kind == "su":
            kern = su_kernel(drug.ka_min, drug.t_half_h * tp.su_thalf_mult)
            accumulate(su, 0, np.array([dose.t]), np.array([su_amplitude(dose.drug, dose.dose)]), kern)
        elif drug.kind == "insulin":
            amt = dose.dose * INSULIN_BIOAVAIL * rng.lognormal(0, tp.ins_abs_sd) * 1e6 / (VI_PER_KG * spec.weight_kg)
            accumulate(ins, 0, np.array([dose.t]), np.array([amt]), insulin_density(drug.ka_min, drug.t_half_h))
        else:
            target = {"metformin": met, "dpp4": dpp4, "sglt2": sglt2}[drug.kind]
            accumulate(target, 0, np.array([dose.t]), np.array([1.0]),
                       trace_kernel(drug.trace_tau_h, per_day[dose.drug]))
    # chronic drugs are at steady state before the window: pre-fill with adherence-level traces
    for rx in spec.prescriptions:
        kind = rx.spec.kind
        if kind in ("metformin", "dpp4", "sglt2"):
            tau = rx.spec.trace_tau_h * 60
            pre = spec.habits.adherence * np.exp(-minute / tau)
            {"metformin": met, "dpp4": dpp4, "sglt2": sglt2}[kind][:] += pre
    su *= tp.su_sens
    met = np.clip(met, 0, 1.3)
    dpp4 = np.clip(dpp4, 0, 1.3)
    sglt2 = np.clip(sglt2, 0, 1.3)

    dawn = 1.0 + tp.dawn * np.exp(-0.5 * ((((hour - tp.dawn_peak_h) + 12) % 24 - 12) / 1.6) ** 2)
    dawn *= 1.0 - tp.night_dip * np.exp(-0.5 * ((((hour - 2.5) + 12) % 24 - 12) / 1.5) ** 2)
    egp_shape = dawn * (1.0 - tp.met_effect * met) * (1.0 + tp.stress_egp * life.stress) * (1.0 + 0.15 * life.illness)
    has_sglt2 = sglt2 > 0.3
    thr = NORMAL_THRESHOLD - (NORMAL_THRESHOLD - tp.sglt2_thr) * np.minimum(sglt2, 1.0)
    kr = np.where(has_sglt2, renal_rate(spec.egfr, True), renal_rate(spec.egfr, False))
    su_abs = SU_ABS * (tp.beta / 0.05) ** 0.3  # glucose-independent SU secretion (uU/mL/min)
    k = np.array([tp.sg, tp.beta, tp.h, tp.p2, tp.n, tp.tau_i, tp.k_ex, su_abs, TRUTH_SU_GAIN, tp.cr_gain,
                  VG_PER_KG * spec.weight_kg, 0.9, HEP_MAX, HEP_X50, CR_THRESHOLD])
    return TruthDrivers(cf, tf, cs, ts, si, egp_shape, ex, su, ins, dpp4 * tp.incretin_gain, thr, kr, k)


def _run(dr: TruthDrivers, egp0: float, g0: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = dr.si.shape[0]
    g = np.empty(n)
    gi = np.empty(n)
    ins = np.empty(n)
    _truth_kernel(dr.carb_fast, dr.tau_fast, dr.carb_slow, dr.tau_slow, dr.si, dr.egp_shape, dr.ex, dr.su,
                  dr.ins, dr.incretin, dr.thr, dr.kr, dr.consts, egp0, g0, g, gi, ins)
    return g, gi, ins


def _fasting_mask(n: int) -> np.ndarray:
    mod = np.arange(n) % 1440
    return (mod >= 5 * 60 + 30) & (mod < 7 * 60)


def _solve_monotone(f, lo: float, hi: float, xtol: float = 2e-3) -> float:
    """Root of an increasing function on [lo, hi]; clamps to the boundary if there is no sign change."""
    flo, fhi = f(lo), f(hi)
    if flo >= 0:
        return lo
    if fhi <= 0:
        return hi
    return float(brentq(f, lo, hi, xtol=xtol))


def simulate_truth(spec: PatientSpec, life: Lifestyle) -> TruthResult:
    """Build truth drivers, calibrate basal EGP so that the mean pre-dawn (05:30-07:00) glucose matches
    the patient's fasting set-point, then simulate. Mean glucose (and hence the latent HbA1c) *emerges*
    from meals, insulin secretion/action and medication - it is not imposed."""
    tp = spec.truth
    dr = build_drivers(spec, life)
    g0 = tp.fpg_target
    mask = _fasting_mask(dr.si.shape[0])

    def fast_err(log_egp: float) -> float:
        g, _, _ = _run(dr, math.exp(log_egp), g0)
        return float(g[mask].mean() - tp.fpg_target)

    log_egp = _solve_monotone(fast_err, math.log(0.4), math.log(9.0))
    egp0 = math.exp(log_egp)
    tp.egp0 = float(egp0)
    g, gi, ins = _run(dr, egp0, g0)
    return TruthResult(g=g, gi=gi, ins=ins, egp0=egp0, drivers=dr)


MAX_TBR_BEFORE_TITRATION = 0.08
_SU_STEPS = {"glimepiride": [1, 2, 3, 4], "gliclazide_mr": [30, 60], "gliclazide": [40, 80]}


def _step_down(spec: PatientSpec, life: Lifestyle) -> bool:
    """Reduce the most hypoglycaemia-prone drug one step (mimics clinician titration). Returns False if
    nothing is left to reduce."""
    for rx in spec.prescriptions:
        if rx.spec.kind == "su":
            steps = _SU_STEPS[rx.drug]
            lower = [d for d in steps if d < rx.dose]
            if lower:
                new = float(lower[-1])
            else:
                spec.prescriptions.remove(rx)
                life.doses[:] = [d for d in life.doses if d.drug != rx.drug]
                spec.extras.setdefault("titration", []).append(f"stopped {rx.drug}")
                return True
            spec.extras.setdefault("titration", []).append(f"{rx.drug} {rx.dose:g}->{new:g}")
            rx.dose = new
            for d in life.doses:
                if d.drug == rx.drug:
                    d.dose = new
            return True
    for rx in spec.prescriptions:
        if rx.spec.kind == "insulin" and rx.dose > 6:
            new = float(max(6, round(rx.dose * 0.75)))
            spec.extras.setdefault("titration", []).append(f"{rx.drug} {rx.dose:g}->{new:g}")
            rx.dose = new
            for d in life.doses:
                if d.drug == rx.drug:
                    d.dose = new
            return True
    return False


def simulate_with_titration(spec: PatientSpec, life: Lifestyle, max_rounds: int = 4) -> TruthResult:
    """Simulate; if time below 70 mg/dL exceeds 8% (a patient who would be symptomatic and re-titrated),
    step down the sulfonylurea / basal insulin dose and re-simulate (the window then shows the patient on
    their titrated regimen)."""
    res = simulate_truth(spec, life)
    for _ in range(max_rounds):
        if float(np.mean(res.g < 70.0)) <= MAX_TBR_BEFORE_TITRATION:
            break
        if not _step_down(spec, life):
            break
        res = simulate_truth(spec, life)
    return res
