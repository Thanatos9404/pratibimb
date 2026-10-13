"""What the twin and the risk model are allowed to see, plus causal derived signals.

:func:`load_observed` reads a patient's record *without* the ``truth`` section. Derived signals
(sleep episodes, personal HR/HRV baselines, stress index, exercise intensity) are strictly causal:
the value at sample ``k`` depends only on samples ``<= k`` (sleep metrics become available 35 minutes
after the wearable detects waking; baselines use previous days only).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

from .config import SAMPLES_PER_DAY, STEP_MIN, Paths

SLOTS = ("breakfast", "lunch", "evening_snack", "dinner", "snack")
SLOT_CODE = {s: i for i, s in enumerate(SLOTS)}
DEFAULT_REST_HR = 76.0
DEFAULT_RMSSD = 30.0


@dataclass
class SleepEpisode:
    on_k: int
    off_k: int
    avail_k: int  # first sample at which the metrics are known
    dur_h: float
    efficiency: float
    deep_pct: float


@dataclass
class Observed:
    pid: str
    days: int
    n: int
    record: dict  # public record (no truth)
    cgm: np.ndarray
    hr: np.ndarray
    hrv: np.ndarray
    steps: np.ndarray
    stage: np.ndarray
    meals: list[dict]
    doses: list[dict]
    meal_t: np.ndarray = field(default_factory=lambda: np.zeros(0))
    meal_carbs: np.ndarray = field(default_factory=lambda: np.zeros(0))
    meal_gl: np.ndarray = field(default_factory=lambda: np.zeros(0))
    meal_tau: np.ndarray = field(default_factory=lambda: np.zeros(0))
    meal_slot: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=int))
    sleeps: list[SleepEpisode] = field(default_factory=list)
    hr_base: np.ndarray = field(default_factory=lambda: np.zeros(0))
    hrv_base: np.ndarray = field(default_factory=lambda: np.zeros(0))
    stress: np.ndarray = field(default_factory=lambda: np.zeros(0))
    ex_int: np.ndarray = field(default_factory=lambda: np.zeros(0))

    @property
    def ehr(self) -> dict:
        return self.record["ehr"]

    @property
    def meds(self) -> list[dict]:
        return self.record["medications"]

    @property
    def weight_kg(self) -> float:
        return float(self.record["weight_kg"])

    def drug_kinds(self) -> set[str]:
        from .physiology.drugs import DRUGS

        return {DRUGS[m["drug"]].kind for m in self.meds}


def detect_sleeps(stage: np.ndarray, gap: int = 6, min_len: int = 36) -> list[SleepEpisode]:
    asleep = stage > 0
    idx = np.flatnonzero(asleep)
    if idx.size == 0:
        return []
    runs: list[list[int]] = [[int(idx[0]), int(idx[0])]]
    for k in idx[1:]:
        if k - runs[-1][1] <= gap:
            runs[-1][1] = int(k)
        else:
            runs.append([int(k), int(k)])
    out = []
    for a, b in runs:
        if b - a + 1 < min_len:
            continue
        seg = stage[a:b + 1]
        sl = int((seg > 0).sum())
        # metrics become available once waking is confirmed beyond the merge gap (keeps them causal)
        out.append(SleepEpisode(on_k=a, off_k=b + 1, avail_k=b + 1 + gap + 1, dur_h=sl * STEP_MIN / 60.0,
                                efficiency=sl / (b + 1 - a), deep_pct=float((seg == 2).sum()) / max(sl, 1)))
    return out


def _daily_baselines(values: np.ndarray, mask: np.ndarray, days: int, default: float) -> np.ndarray:
    """Per-day median of ``values[mask]`` over the previous (up to) 7 days; day 0 uses ``default``."""
    per_day = []
    for d in range(days):
        sl = slice(d * SAMPLES_PER_DAY, (d + 1) * SAMPLES_PER_DAY)
        v = values[sl][mask[sl] & ~np.isnan(values[sl])]
        per_day.append(v)
    base = np.full(days, default)
    for d in range(1, days):
        pool = np.concatenate(per_day[max(0, d - 7):d])
        if pool.size > 20:
            base[d] = float(np.median(pool))
    return base


def _ffill_limited(x: np.ndarray, limit: int) -> np.ndarray:
    out = np.full_like(x, np.nan)
    last = np.nan
    age = limit + 1
    for i, v in enumerate(x):
        if not np.isnan(v):
            last, age = v, 0
        else:
            age += 1
        out[i] = last if age <= limit else np.nan
    return out


def derive(obs: Observed) -> Observed:
    days = obs.days
    obs.sleeps = detect_sleeps(obs.stage)
    asleep = obs.stage > 0
    rest = (~asleep) & (obs.steps < 50)
    obs.hr_base = _daily_baselines(obs.hr, rest, days, DEFAULT_REST_HR)
    obs.hrv_base = _daily_baselines(obs.hrv, asleep, days, DEFAULT_RMSSD)
    day = np.arange(obs.n) // SAMPLES_PER_DAY
    hr_ex = obs.hr - obs.hr_base[day] - 0.025 * obs.steps + 8.0 * asleep
    hr_ex = np.where(np.isnan(hr_ex), 0.0, hr_ex)
    last_hrv = _ffill_limited(obs.hrv.astype(float), 12)
    hrv_def = np.where(np.isnan(last_hrv), 0.0, np.maximum(0.0, 1.0 - last_hrv / obs.hrv_base[day]))
    raw = np.clip(0.6 * np.maximum(hr_ex, 0) / 8.0 + 0.4 * hrv_def / 0.3, 0.0, 2.0)
    a = 1.0 / 6.0
    obs.stress = lfilter([a], [1.0, -(1 - a)], raw)
    obs.ex_int = np.clip((obs.steps / STEP_MIN - 30.0) / 75.0, 0.0, 1.4)
    return obs


def load_observed(paths: Paths, pid: str) -> Observed:
    with (paths.patients / f"{pid}.json").open(encoding="utf-8") as fh:
        rec = json.load(fh)
    rec.pop("truth", None)
    z = np.load(paths.patients / f"{pid}.npz")
    return observed_from(rec, z)


def observed_from(rec: dict, z) -> Observed:
    cgm = z["cgm"].astype(float)
    n = cgm.shape[0]
    meals = rec["logged"]["meals"]
    obs = Observed(
        pid=rec["id"], days=n // SAMPLES_PER_DAY, n=n, record=rec, cgm=cgm, hr=z["hr"].astype(float),
        hrv=z["hrv"].astype(float), steps=z["steps"].astype(float), stage=z["stage"].astype(np.int8),
        meals=meals, doses=rec["logged"]["doses"],
        meal_t=np.array([m["t"] for m in meals], dtype=float),
        meal_carbs=np.array([m["carbs_g"] for m in meals], dtype=float),
        meal_gl=np.array([m["gl"] for m in meals], dtype=float),
        meal_tau=np.array([m["tau_min"] for m in meals], dtype=float),
        meal_slot=np.array([SLOT_CODE.get(m["slot"], 4) for m in meals], dtype=int),
    )
    return derive(obs)


def load_truth(paths: Paths, pid: str) -> tuple[dict, dict]:
    """Truth section + truth series (for labels, evaluation and reporting only)."""
    with (paths.patients / f"{pid}.json").open(encoding="utf-8") as fh:
        rec = json.load(fh)
    z = np.load(paths.patients / f"{pid}.npz")
    return rec["truth"], {k: z[k] for k in ("g", "gi", "stage_true", "si_true")}


def bedtime_decisions(stage: np.ndarray, days: int) -> np.ndarray:
    """Causal nocturnal decision sample per evening (index = day): 15 min after the wearable detects
    sustained sleep after 21:00, snapped up to the 15-min grid, capped at 23:45."""
    out = np.full(days, -1, dtype=int)
    for d in range(days - 1):
        base = d * SAMPLES_PER_DAY
        lo, hi = base + 21 * 12, base + 23 * 12 + 9  # 21:00 .. 23:45
        k_dec = hi
        for k in range(lo + 2, hi + 1):
            if stage[k] > 0 and stage[k - 1] > 0 and stage[k - 2] > 0:
                k_dec = k
                break
        k_dec = int(np.ceil(k_dec / 3) * 3)
        out[d] = min(k_dec, hi)
    return out


def list_patients(paths: Paths) -> list[dict]:
    with (paths.cohort / "manifest.json").open(encoding="utf-8") as fh:
        return json.load(fh)["patients"]


def manifest(paths: Paths) -> dict:
    with (Path(paths.cohort) / "manifest.json").open(encoding="utf-8") as fh:
        return json.load(fh)
