"""Build the twin's exogenous inputs (per-minute drivers and meal impulses) from *observed* data only.

* Filtering uses logged doses (``taken`` as logged), logged meals, observed steps/sleep/HR/HRV.
* Forecasting from time ``t`` uses logged doses up to ``t`` plus the *prescribed* schedule after ``t``
  (assumed taken), no future activity (unless a scenario adds a walk), decaying exercise/stress traces
  and the current sleep modifier. Future meals come from the habitual-meal prior or a scenario.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.signal import lfilter

from ..config import STEP_MIN
from ..observables import Observed
from ..physiology import renal_rate
from ..physiology.drugs import (
    DRUGS, INSULIN_BIOAVAIL, accumulate, insulin_density, su_amplitude, su_kernel, trace_kernel,
)
from ..physiology.params import (
    DPP4_GAIN, DR_DPP4, DR_EXI, DR_EXT, DR_INS, DR_KR, DR_MET, DR_SLEEP, DR_STRESS, DR_SU, DR_THR, ND,
    NORMAL_THRESHOLD, SGLT2_THRESHOLD, VI_PER_KG, patient_constants,
)

TWIN_H = 105.0  # twin's glucose threshold for stimulated secretion (fixed, mg/dL)
EX_TAU_MIN = 240.0
STRESS_DECAY_MIN = 60.0
SLEEP_SI_LOSS = 0.2
PRE_WINDOW_DAYS = 3


@dataclass
class DoseEvent:
    t: float
    drug: str
    amount: float


def constants(obs: Observed) -> np.ndarray:
    return patient_constants(obs.weight_kg, TWIN_H)


def planned_doses(obs: Observed, t_from: float, t_to: float) -> list[DoseEvent]:
    """Prescribed doses with scheduled time in (t_from, t_to] (assumed taken)."""
    out: list[DoseEvent] = []
    d0 = int(math.floor(t_from / 1440)) - 1
    d1 = int(math.ceil(t_to / 1440)) + 1
    for m in obs.meds:
        for hhmm in m["times"]:
            hh, mm = (int(x) for x in hhmm.split(":"))
            for d in range(d0, d1 + 1):
                t = d * 1440 + hh * 60 + mm
                if t_from < t <= t_to:
                    out.append(DoseEvent(float(t), m["drug"], float(m["dose_amount"])))
    return out


def dose_events(obs: Observed, cutoff: float | None, horizon_end: float, skip: str | None = None,
                shift: tuple[str, float] | None = None) -> list[DoseEvent]:
    """Logged-taken doses up to ``cutoff`` (all if None), assumed pre-window doses, and planned doses
    after ``cutoff`` up to ``horizon_end``. ``skip``/``shift`` modify the *planned* future doses."""
    ev: list[DoseEvent] = list(planned_doses(obs, -PRE_WINDOW_DAYS * 1440, 0))
    already: set[tuple[str, int]] = set()
    for d in obs.doses:
        if cutoff is None or d["t"] <= cutoff:
            already.add((d["drug"], int(d["t_sched"])))
            if d["taken"]:
                ev.append(DoseEvent(float(d["t"]), d["drug"], float(d["dose_amount"])))
    if cutoff is not None:
        future = planned_doses(obs, cutoff, horizon_end)
        skipped = False
        for e in future:
            if (e.drug, int(e.t)) in already:
                continue
            if skip and e.drug == skip and not skipped:
                skipped = True
                continue
            if shift and e.drug == shift[0]:
                e = DoseEvent(e.t + shift[1], e.drug, e.amount)
            ev.append(e)
    return ev


def drug_drivers(obs: Observed, events: list[DoseEvent], grid_start: int, n: int) -> dict[str, np.ndarray]:
    su = np.zeros(n)
    ins = np.zeros(n)
    met = np.zeros(n)
    dpp4 = np.zeros(n)
    sglt2 = np.zeros(n)
    per_day = {m["drug"]: m["per_day"] for m in obs.meds}
    for e in events:
        spec = DRUGS[e.drug]
        t = np.array([e.t])
        if spec.kind == "su":
            accumulate(su, grid_start, t, np.array([su_amplitude(e.drug, e.amount)]), su_kernel(spec.ka_min, spec.t_half_h))
        elif spec.kind == "insulin":
            amt = e.amount * INSULIN_BIOAVAIL * 1e6 / (VI_PER_KG * obs.weight_kg)
            accumulate(ins, grid_start, t, np.array([amt]), insulin_density(spec.ka_min, spec.t_half_h))
        else:
            target = {"metformin": met, "dpp4": dpp4, "sglt2": sglt2}[spec.kind]
            accumulate(target, grid_start, t, np.array([1.0]), trace_kernel(spec.trace_tau_h, per_day.get(e.drug, 1)))
    return {"su": su, "ins": ins, "met": np.clip(met, 0, 1.3), "dpp4": np.clip(dpp4, 0, 1.3),
            "sglt2": np.clip(sglt2, 0, 1.3)}


def _fill_drug_columns(drv: np.ndarray, dd: dict[str, np.ndarray], egfr: float) -> None:
    drv[:, DR_SU] = dd["su"]
    drv[:, DR_INS] = dd["ins"]
    drv[:, DR_MET] = dd["met"]
    drv[:, DR_DPP4] = 1.0 + DPP4_GAIN * np.minimum(dd["dpp4"], 1.0)
    s = np.minimum(dd["sglt2"], 1.0)
    drv[:, DR_THR] = NORMAL_THRESHOLD - (NORMAL_THRESHOLD - SGLT2_THRESHOLD) * s
    drv[:, DR_KR] = np.where(s > 0.3, renal_rate(egfr, True), renal_rate(egfr, False))


def sleep_multiplier(obs: Observed) -> np.ndarray:
    """Per-sample SI multiplier from the last *available* sleep episode (1.0 while asleep)."""
    m = np.ones(obs.n)
    for i, ep in enumerate(obs.sleeps):
        nxt = obs.sleeps[i + 1].on_k if i + 1 < len(obs.sleeps) else obs.n
        loss = float(np.clip((6.5 - ep.dur_h) / 2.5, 0.0, 1.0))
        a, b = min(ep.avail_k, obs.n), min(nxt, obs.n)
        if b > a:
            m[a:b] = 1.0 - SLEEP_SI_LOSS * loss
    return m


def sleep_mult_for_hours(hours: float) -> float:
    return 1.0 - SLEEP_SI_LOSS * float(np.clip((6.5 - hours) / 2.5, 0.0, 1.0))


def exercise_trace(ex_min: np.ndarray, start_value: float = 0.0) -> np.ndarray:
    a = math.exp(-1.0 / EX_TAU_MIN)
    zi = np.array([start_value * a])
    y, _ = lfilter([1.0 / 60.0], [1.0, -a], ex_min, zi=zi)
    return np.minimum(y, 1.5)


def build_filter_inputs(obs: Observed) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-minute drivers, carbohydrate impulses (mg) and meal time constants for the whole record."""
    n_min = obs.n * STEP_MIN
    drv = np.zeros((n_min, ND))
    _fill_drug_columns(drv, drug_drivers(obs, dose_events(obs, None, n_min), 0, n_min), obs.ehr["egfr"])
    ex = np.repeat(obs.ex_int, STEP_MIN)
    drv[:, DR_EXI] = ex
    drv[:, DR_EXT] = exercise_trace(ex)
    drv[:, DR_SLEEP] = np.repeat(sleep_multiplier(obs), STEP_MIN)
    drv[:, DR_STRESS] = np.repeat(obs.stress, STEP_MIN)
    carb = np.zeros(n_min)
    tau = np.full(n_min, 40.0)
    for t, c, tm in zip(obs.meal_t, obs.meal_carbs, obs.meal_tau, strict=True):
        i = int(t)
        if 0 <= i < n_min:
            tau[i] = (tau[i] * carb[i] + tm * 1000 * c) / (carb[i] + 1000 * c) if carb[i] > 0 else tm
            carb[i] += 1000.0 * c
    return drv, carb, tau


def build_forecast_drivers(obs: Observed, filt_drv: np.ndarray, t_min: int, n_min: int,
                           walk: tuple[float, float, float] | None = None, skip_dose: str | None = None,
                           shift_dose: tuple[str, float] | None = None,
                           sleep_hours: float | None = None) -> np.ndarray:
    """Drivers for minutes [t_min, t_min + n_min) as *planned at* ``t_min``.

    ``walk`` = (offset_min, duration_min, intensity) adds a scenario walk.
    """
    drv = np.zeros((n_min, ND))
    ev = dose_events(obs, float(t_min), float(t_min + n_min), skip=skip_dose, shift=shift_dose)
    _fill_drug_columns(drv, drug_drivers(obs, ev, t_min, n_min), obs.ehr["egfr"])
    ex = np.zeros(n_min)
    if walk is not None:
        off, dur, inten = walk
        a, b = int(max(off, 0)), int(min(off + dur, n_min))
        ex[a:b] = inten
    i0 = min(max(t_min - 1, 0), filt_drv.shape[0] - 1)
    drv[:, DR_EXI] = ex
    drv[:, DR_EXT] = exercise_trace(ex, start_value=float(filt_drv[i0, DR_EXT]))
    drv[:, DR_SLEEP] = sleep_mult_for_hours(sleep_hours) if sleep_hours is not None else filt_drv[i0, DR_SLEEP]
    drv[:, DR_STRESS] = filt_drv[i0, DR_STRESS] * np.exp(-np.arange(n_min) / STRESS_DECAY_MIN)
    return drv
