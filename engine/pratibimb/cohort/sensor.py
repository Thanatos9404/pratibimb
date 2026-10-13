"""CGM sensor model: interstitial truth -> noisy, lagged, drifting, gappy 5-minute readings.

* sensor sessions of 14 days with a 60-minute warm-up gap and a noisier, negatively biased first day;
* multiplicative calibration drift (slow mean-reverting random walk per session);
* AR(2) measurement noise with level-dependent scale;
* compression artefacts (false lows) while asleep (~12% of nights, 20-60 min, -25..-50%);
* random dropouts (Bluetooth / signal loss), integer rounding and the 40-400 mg/dL reporting range.

The interstitial lag itself comes from the truth simulator (patient-specific 6-12 min).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import lfilter

from ..config import STEP_MIN
from .lifestyle import Lifestyle


@dataclass
class CGMResult:
    cgm: np.ndarray  # float32, NaN = missing
    sessions: list[int] = field(default_factory=list)  # sample index where a new sensor starts
    compressions: list[tuple[int, int]] = field(default_factory=list)  # (start, end) samples


def simulate_cgm(gi_minute: np.ndarray, life: Lifestyle, seed: int) -> CGMResult:
    rng = np.random.default_rng([seed, 6])
    x = gi_minute[::STEP_MIN].astype(float)
    n = x.shape[0]
    per_day = 1440 // STEP_MIN
    first_change = int(rng.integers(per_day, 13 * per_day)) + int(rng.integers(0, per_day))
    starts = [s for s in range(first_change, n, 14 * per_day)]
    bounds = [0, *starts, n]
    drift = np.zeros(n)
    noise_scale = np.ones(n)
    bias = np.zeros(n)
    missing = np.zeros(n, dtype=bool)
    for a, b in zip(bounds[:-1], bounds[1:], strict=True):
        m = b - a
        a_ = np.exp(-1.0 / (3 * per_day))
        rw = lfilter([1.0], [1.0, -a_], rng.normal(0, 0.004, m)) + rng.normal(0, 0.035)
        drift[a:b] = rw
        if a in starts:
            missing[a:a + 12] = True  # 60-minute warm-up
            day1 = slice(a, min(b, a + per_day))
            noise_scale[day1] = 1.5
            bias[day1] = -0.04 * np.exp(-np.arange(day1.stop - day1.start) / (0.4 * per_day))
    e = rng.normal(0, 1.0, n)
    ar = lfilter([1.0], [1.0, -1.1, 0.3], e) * 0.45
    sigma = (2.5 + 0.035 * x) * noise_scale
    y = x * (1.0 + drift + bias) + sigma * ar

    # compression lows during sleep
    comps: list[tuple[int, int]] = []
    for onset, wake in life.sleeps:
        if rng.random() < 0.12:
            a_s, b_s = max(onset, 0) // STEP_MIN, min(wake, life.n_min) // STEP_MIN
            if b_s - a_s < 30:
                continue
            start = int(rng.integers(a_s + 6, b_s - 14))
            dur = int(rng.integers(4, 13))
            depth = rng.uniform(0.25, 0.5)
            shape = np.minimum(1.0, np.minimum(np.arange(dur) + 1, dur - np.arange(dur)) / 2.0)
            y[start:start + dur] *= 1.0 - depth * shape[: max(0, min(dur, n - start))]
            comps.append((start, start + dur))
    # dropouts
    n_drop = rng.poisson(0.4 * n / per_day)
    for _ in range(n_drop):
        s = int(rng.integers(0, n))
        missing[s:s + int(rng.geometric(1 / 6.0))] = True
    y = np.clip(np.round(y), 40, 400)
    y[missing] = np.nan
    return CGMResult(cgm=y.astype(np.float32), sessions=starts, compressions=comps)
