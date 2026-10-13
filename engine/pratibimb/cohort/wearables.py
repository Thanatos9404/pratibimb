"""Synthetic wearable streams (5-minute): heart rate, HRV (RMSSD, night-weighted), steps, sleep stages.

Physiological couplings: sleep lowers HR and raises HRV (deep > light > REM); activity raises HR and
suppresses HRV; latent stress and illness raise HR and lower HRV; meals add a small HR rise; a short
night lowers next-day HRV. The wearable's sleep staging is imperfect (stage confusion), HR has daily
charging gaps, and HRV is only reported during sleep or still periods.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import lfilter

from ..config import STEP_MIN
from .lifestyle import Lifestyle
from .patient import PatientSpec
from .truth import TruthResult


@dataclass
class WearableStreams:
    hr: np.ndarray  # float32 bpm (NaN = not worn)
    hrv: np.ndarray  # float32 ms RMSSD (NaN = not reported)
    steps: np.ndarray  # int32 steps per 5 min
    stage: np.ndarray  # int8 observed stage (0 wake, 1 light, 2 deep, 3 REM)


def _block(x: np.ndarray) -> np.ndarray:
    return x.reshape(-1, STEP_MIN)


def _observed_stage(rng: np.random.Generator, stage_true: np.ndarray) -> np.ndarray:
    blocks = _block(stage_true.astype(np.int64))
    counts = np.stack([(blocks == s).sum(axis=1) for s in range(4)], axis=1)
    st = counts.argmax(axis=1).astype(np.int8)
    u = rng.random(st.shape[0])
    out = st.copy()
    out[(st == 2) & (u < 0.15)] = 1
    out[(st == 1) & (u < 0.08)] = 2
    out[(st == 3) & (u < 0.15)] = 1
    out[(st == 1) & (u > 0.94)] = 3
    out[(st == 1) & (u > 0.5) & (u < 0.53)] = 0
    return out


def simulate_wearables(spec: PatientSpec, life: Lifestyle, truth: TruthResult) -> WearableStreams:
    rng = np.random.default_rng([spec.seed, 5])
    hb = spec.habits
    n = life.n_min
    stage = life.stage_true
    stage_drop = np.array([0.0, 8.0, 12.0, 5.0])[stage]
    meal_bump = np.zeros(n)
    for m in life.meals:
        meal_bump[m.t:min(n, m.t + 90)] += 3.0
    minute = np.arange(n)
    circ = 2.0 * np.sin(2 * np.pi * ((minute % 1440) / 1440.0 - 0.3))
    short_prev = np.zeros(n)
    for d in life.short_nights:
        short_prev[d * 1440:(d + 1) * 1440] = 1.0
    noise = lfilter([1.0], [1.0, -0.95], rng.normal(0, 0.8, n))
    hr = (hb.rest_hr - stage_drop + np.minimum(0.28 * life.steps_min, 60.0) + 6.0 * life.stress
          + 10.0 * life.illness + meal_bump + circ + 2.0 * short_prev + noise)
    hr5 = _block(hr).mean(axis=1) + rng.normal(0, 1.2, n // STEP_MIN)

    # daily charging gap (watch off) in the evening on most days
    days = n // 1440
    for d in range(days):
        if rng.random() < 0.6:
            a = (d * 1440 + int(rng.uniform(18.5, 20.5) * 60)) // STEP_MIN
            hr5[a:a + int(rng.integers(9, 16))] = np.nan

    steps5 = _block(life.steps_min).sum(axis=1).astype(np.int32)
    stage5_true = _block(stage.astype(np.int64)).max(axis=1)
    g5 = truth.g[::STEP_MIN]
    stage_fac = np.array([0.85, 1.15, 1.35, 1.0])[stage5_true]
    act = np.clip(steps5 / 300.0, 0, 1)
    stress5 = _block(life.stress).mean(axis=1)
    ill5 = _block(life.illness).mean(axis=1)
    short5 = _block(short_prev).mean(axis=1)
    hrv = (hb.rmssd_base * stage_fac * (1 - 0.5 * act) * (1 - 0.25 * np.minimum(stress5, 1.5))
           * (1 - 0.3 * ill5) * (1 - 0.15 * short5) * np.where(g5 > 250, 0.9, 1.0)
           * rng.lognormal(0, 0.15, steps5.shape[0]))
    st_obs = _observed_stage(rng, stage)
    asleep = st_obs > 0
    avail = np.where(asleep, rng.random(hrv.shape[0]) < 0.9, (steps5 < 25) & (rng.random(hrv.shape[0]) < 0.12))
    hrv = np.where(avail & ~np.isnan(hr5), hrv, np.nan)
    return WearableStreams(hr=hr5.astype(np.float32), hrv=hrv.astype(np.float32), steps=steps5, stage=st_obs)
