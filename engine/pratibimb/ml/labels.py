"""Event and label definitions (SPEC section 3.5), computed on 5-minute series.

An *episode* is >= 3 consecutive 5-minute samples (>= 15 min) beyond a threshold; its onset is the
first sample. Labels are computed on **truth plasma glucose** (the CGM-labelled variant is reported
separately):

* ``hyper_2h``  - currently < 250 and a >250 episode starts within the next 120 min;
* ``hypo_1h``   - currently >= 70 and a <70 episode starts within the next 60 min;
* ``nocturnal_hypo`` - any <70 episode with onset between 00:00 and 06:00 tonight (decided at bedtime).
"""

from __future__ import annotations

import numpy as np

from ..config import SAMPLES_PER_DAY

RUN = 3
H_HYPER = 24  # samples (120 min)
H_HYPO = 12  # samples (60 min)


def episode_onsets(x: np.ndarray, thr: float, above: bool, run: int = RUN) -> np.ndarray:
    """Onset indices of episodes (NaN never counts as beyond the threshold)."""
    with np.errstate(invalid="ignore"):
        b = (x > thr) if above else (x < thr)
    b = np.where(np.isnan(x), False, b)
    n = b.shape[0]
    if n < run:
        return np.zeros(0, dtype=int)
    full = b[: n - run + 1].copy()
    for i in range(1, run):
        full &= b[i: n - run + 1 + i]
    prev = np.concatenate([[False], b[:-1]])[: n - run + 1]
    return np.flatnonzero(full & ~prev)


def episodes(x: np.ndarray, thr: float, above: bool, run: int = RUN) -> list[tuple[int, int, float]]:
    """(start, end_exclusive, extreme) for each episode."""
    out = []
    with np.errstate(invalid="ignore"):
        b = np.where(np.isnan(x), False, (x > thr) if above else (x < thr))
    n = b.shape[0]
    i = 0
    while i < n:
        if b[i]:
            j = i
            while j < n and b[j]:
                j += 1
            if j - i >= run:
                seg = x[i:j]
                out.append((i, j, float(np.nanmax(seg) if above else np.nanmin(seg))))
            i = j
        else:
            i += 1
    return out


def window_label(ks: np.ndarray, onsets: np.ndarray, horizon: int) -> np.ndarray:
    """1 if any onset j satisfies k < j <= k + horizon."""
    if onsets.size == 0:
        return np.zeros(ks.shape[0], dtype=np.int8)
    pos = np.searchsorted(onsets, ks, side="right")
    nxt = np.where(pos < onsets.size, onsets[np.minimum(pos, onsets.size - 1)], 10**9)
    return ((nxt - ks) <= horizon).astype(np.int8)


def next_onset(ks: np.ndarray, onsets: np.ndarray) -> np.ndarray:
    if onsets.size == 0:
        return np.full(ks.shape[0], -1)
    pos = np.searchsorted(onsets, ks, side="right")
    return np.where(pos < onsets.size, onsets[np.minimum(pos, onsets.size - 1)], -1)


def task_labels(g: np.ndarray, ks: np.ndarray) -> dict[str, np.ndarray]:
    """Labels + eligibility for the two rolling tasks at decision samples ``ks``."""
    hyper_on = episode_onsets(g, 250.0, True)
    hypo_on = episode_onsets(g, 70.0, False)
    n = g.shape[0]
    return {
        "hyper_2h": window_label(ks, hyper_on, H_HYPER),
        "hyper_2h_elig": ((g[ks] < 250.0) & (ks + H_HYPER + RUN <= n)).astype(np.int8),
        "hypo_1h": window_label(ks, hypo_on, H_HYPO),
        "hypo_1h_elig": ((g[ks] >= 70.0) & (ks + H_HYPO + RUN <= n)).astype(np.int8),
    }


def nocturnal_label(g: np.ndarray, k_dec: int) -> tuple[int, int]:
    """(label, onset sample or -1) for the night following decision sample ``k_dec``."""
    mid = (k_dec // SAMPLES_PER_DAY + 1) * SAMPLES_PER_DAY
    end = mid + 72
    if end + RUN > g.shape[0]:
        return -1, -1
    on = episode_onsets(g[mid:end + RUN - 1], 70.0, False)
    on = on[on < 72]
    return (1, int(mid + on[0])) if on.size else (0, -1)
