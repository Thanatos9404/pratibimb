"""Ensemble forecasting from the synced twin, with a habitual-meal prior learned from logged meals.

The habitual-meal prior is causal: at time ``t`` it uses logged main meals (breakfast, lunch,
evening snack, dinner) from the previous 7 days to estimate, per slot, how often the patient logs it,
when, how much carbohydrate and how fast it is absorbed. Slots already logged today are skipped; for the
others each ensemble member samples whether/when the meal happens (truncated normal after ``t``)
and its size, so the forecast cone reflects meal uncertainty.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.special import ndtr, ndtri

from ..config import STEP_MIN
from ..physiology.model import forecast_kernel
from ..physiology.params import NX, S_G
from .enkf import TwinRun
from .inputs import build_forecast_drivers

DAY_START_MIN = 240  # the "meal day" starts at 04:00
MAIN_SLOTS = (0, 1, 2, 3)


@dataclass
class SlotStats:
    freq: float
    mu: float  # minutes after 04:00
    sd: float
    carbs: float
    tau: float


class HabitPrior:
    def __init__(self, run: TwinRun) -> None:
        o = run.obs
        self.t = o.meal_t
        self.slot = o.meal_slot
        self.carbs = o.meal_carbs
        self.tau = o.meal_tau

    def slot_stats(self, t_min: float) -> tuple[dict[int, SlotStats], set[int], float]:
        day_start = np.floor((t_min - DAY_START_MIN) / 1440.0) * 1440.0 + DAY_START_MIN
        n_days = int(min(7, day_start // 1440 + (1 if day_start >= DAY_START_MIN else 0)))
        win = (self.t >= day_start - 7 * 1440) & (self.t < day_start)
        today = (self.t >= day_start) & (self.t <= t_min)
        logged_today = {int(s) for s in self.slot[today]}
        stats: dict[int, SlotStats] = {}
        if n_days < 1:
            return stats, logged_today, day_start
        for s in MAIN_SLOTS:
            sel = win & (self.slot == s)
            if sel.sum() == 0:
                continue
            tt = self.t[sel] - day_start
            mod = np.mod(tt, 1440.0)
            days = np.unique(np.floor(tt / 1440.0))
            stats[s] = SlotStats(freq=min(1.0, days.size / n_days), mu=float(mod.mean()),
                                 sd=float(max(mod.std(), 20.0)), carbs=float(np.median(self.carbs[sel])),
                                 tau=float(np.median(self.tau[sel])))
        return stats, logged_today, day_start

    def sample(self, t_min: float, n_min: int, m: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
        meal_mg = np.zeros((m, n_min))
        meal_tau = np.full((m, n_min), 40.0)
        stats, logged_today, day_start = self.slot_stats(t_min)
        c = t_min - day_start
        for s, st in stats.items():
            if s in logged_today or c > st.mu + 2.5 * st.sd:
                continue
            phi = float(ndtr((c - st.mu) / st.sd))
            denom = 1.0 - st.freq * phi
            p = st.freq * (1.0 - phi) / denom if denom > 1e-9 else 0.0
            occur = rng.random(m) < p
            u = phi + rng.random(m) * (1.0 - phi)
            when = st.mu + st.sd * ndtri(np.clip(u, 1e-9, 1 - 1e-9))
            off = np.floor(when - c).astype(int)
            size = st.carbs * 1000.0 * rng.lognormal(0.0, 0.2, m)
            ok = occur & (off >= 0) & (off < n_min)
            idx = np.flatnonzero(ok)
            meal_mg[idx, off[idx]] += size[idx]
            meal_tau[idx, off[idx]] = st.tau
        return meal_mg, meal_tau

    def habitual_meal(self, slot: int, t_min: float) -> SlotStats | None:
        return self.slot_stats(t_min)[0].get(slot)


def forecast_seed(run: TwinRun, k: int, salt: int = 0) -> int:
    return int((run.seed * 7_368_787 + k * 104_729 + salt * 31) % (2**31 - 1))


def ensemble_forecast(run: TwinRun, z: np.ndarray, k: int, n_min: int, prior: HabitPrior | None,
                      seed: int, extra_meals: list[tuple[int, float, float]] | None = None,
                      use_prior: bool = True, noise: bool = True, **scenario) -> np.ndarray:
    """Forecast plasma glucose (members x (n_min/5 + 1)) from ensemble ``z`` at sample ``k``.

    ``extra_meals`` = [(offset_min, carbs_g, tau_min)] added to every member; ``scenario`` keys are
    forwarded to :func:`build_forecast_drivers` (walk, skip_dose, shift_dose, sleep_hours).
    """
    t = k * STEP_MIN
    m = z.shape[0]
    rng = np.random.default_rng(seed)
    drv = build_forecast_drivers(run.obs, run.drv, t, n_min, **scenario)
    if prior is not None and use_prior:
        meal_mg, meal_tau = prior.sample(t, n_min, m, rng)
    else:
        meal_mg, meal_tau = np.zeros((m, n_min)), np.full((m, n_min), 40.0)
    for off, carbs, tau in extra_meals or []:
        if 0 <= off < n_min:
            meal_mg[:, off] += carbs * 1000.0
            meal_tau[:, off] = tau
    out = np.zeros((m, n_min // STEP_MIN + 1))
    forecast_kernel(np.ascontiguousarray(z), drv, meal_mg, meal_tau, t, n_min, run.c, run.fcfg, run.lo, run.hi,
                    seed % (2**31 - 1), 1 if noise else 0, out)
    return out


def mechanistic_run(run: TwinRun, z: np.ndarray, k: int, n_min: int) -> np.ndarray:
    """Deterministic run of the ensemble-mean state with planned inputs only (no meal prior, no noise)."""
    zm = z.mean(axis=0, keepdims=True)
    return ensemble_forecast(run, zm, k, n_min, None, 1, use_prior=False, noise=False)[0]


def run_exceed(traj: np.ndarray, thr: float, above: bool, run: int = 3) -> np.ndarray:
    """Per-member flag: ``run`` consecutive 5-min samples beyond ``thr``."""
    b = traj > thr if above else traj < thr
    if b.shape[1] < run:
        return np.zeros(b.shape[0], dtype=bool)
    acc = b[:, : b.shape[1] - run + 1].copy()
    for i in range(1, run):
        acc &= b[:, i: b.shape[1] - run + 1 + i]
    return acc.any(axis=1)


def quantiles(traj: np.ndarray, qs: tuple[float, ...]) -> np.ndarray:
    return np.quantile(traj, qs, axis=0)


def state_summary(z: np.ndarray) -> dict[str, float]:
    from ..physiology.params import S_D1, S_D2, S_I, S_X

    return {"glucose": float(z[:, S_G].mean()), "insulin_action": float(z[:, S_X].mean()),
            "insulin": float(z[:, S_I].mean()), "gut_g": float((z[:, S_D1] + z[:, S_D2]).mean() / 1000.0),
            "params": z[:, NX:].mean(axis=0)}
