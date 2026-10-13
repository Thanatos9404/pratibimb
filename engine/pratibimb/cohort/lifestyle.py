"""Indian lifestyle generator: sleep, meals (regional templates), chai snacks, fasting & festival days,
walks, office sitting, stress and illness episodes, medication-taking behaviour and logging behaviour.

Everything is generated on a 1-minute grid for the truth simulator; *logged* views (what an app would
record) are derived here too, with portion errors, unlogged snacks and false/missed dose ticks.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import lfilter

from ..config import DATASET_START
from ..timeutil import weekday
from .patient import PatientSpec

# meal templates: list of options; each option is a list of (food_id, base portions); "nv" = non-veg
Option = tuple[list[tuple[str, float]], bool]
TEMPLATES: dict[str, dict[str, list[Option]]] = {
    "North": {
        "breakfast": [([("aloo_paratha", 1.5), ("curd", 1)], False), ([("poha", 1.1)], False),
                      ([("plain_paratha", 2)], False), ([("white_bread", 1), ("egg_bhurji", 1)], True),
                      ([("wheat_dalia", 1)], False), ([("chapati", 2), ("mixed_veg", 1)], False)],
        "lunch": [([("chapati", 3), ("toor_dal", 1), ("mixed_veg", 1), ("white_rice", 0.5), ("curd", 1)], False),
                  ([("rajma", 1), ("white_rice", 1.5), ("green_salad", 1)], False),
                  ([("chole", 1), ("chapati", 3)], False),
                  ([("chapati", 3), ("aloo_sabzi", 1), ("toor_dal", 1)], False),
                  ([("khichdi", 1.5), ("curd", 1)], False),
                  ([("chicken_biryani", 1), ("curd", 1)], True)],
        "snack": [([("marie_biscuits", 1)], False), ([("namkeen", 1)], False), ([("samosa", 1)], False),
                  ([("rusk", 1)], False), ([("fruit_chaat", 1)], False)],
        "dinner": [([("chapati", 3), ("toor_dal", 1), ("palak_saag", 1)], False),
                   ([("chapati", 3), ("paneer_sabzi", 1), ("white_rice", 0.5)], False),
                   ([("chapati", 2), ("rajma", 1), ("white_rice", 1)], False),
                   ([("chapati", 3), ("chicken_curry", 1)], True),
                   ([("khichdi", 1.5), ("curd", 1)], False),
                   ([("plain_paratha", 2), ("mixed_veg", 1)], False),
                   ([("bajra_roti", 2), ("mixed_veg", 1), ("toor_dal", 1)], False)],
    },
    "South": {
        "breakfast": [([("idli", 1.5), ("sambar", 1)], False), ([("plain_dosa", 2), ("sambar", 1)], False),
                      ([("masala_dosa", 1)], False), ([("upma", 1.1)], False),
                      ([("ven_pongal", 1), ("sambar", 0.5)], False), ([("uttapam", 1.5)], False),
                      ([("medu_vada", 1), ("idli", 1), ("sambar", 1)], False)],
        "lunch": [([("white_rice", 2), ("sambar", 1), ("mixed_veg", 1), ("curd", 1)], False),
                  ([("white_rice", 2), ("sambar", 1), ("fish_curry", 1)], True),
                  ([("lemon_rice", 1), ("curd", 1)], False), ([("curd_rice", 1.2), ("bhindi_sabzi", 1)], False),
                  ([("ragi_mudde", 1), ("sambar", 1), ("mixed_veg", 1)], False),
                  ([("white_rice", 1.5), ("toor_dal", 1), ("bhindi_sabzi", 1), ("buttermilk", 1)], False)],
        "snack": [([("marie_biscuits", 1)], False), ([("medu_vada", 0.5)], False), ([("pakora", 1)], False),
                  ([("banana", 1)], False)],
        "dinner": [([("plain_dosa", 2), ("sambar", 1)], False),
                   ([("white_rice", 1.5), ("sambar", 1), ("mixed_veg", 1)], False),
                   ([("idli", 1.5), ("sambar", 1)], False),
                   ([("chapati", 2), ("mixed_veg", 1), ("curd_rice", 0.5)], False),
                   ([("white_rice", 1.5), ("chicken_curry", 1)], True)],
    },
    "West": {
        "breakfast": [([("poha", 1.2)], False), ([("methi_thepla", 1), ("curd", 1)], False),
                      ([("upma", 1)], False), ([("dhokla", 1.5)], False), ([("white_bread", 1)], False)],
        "lunch": [([("chapati", 3), ("toor_dal", 1), ("mixed_veg", 1), ("white_rice", 1)], False),
                  ([("jowar_roti", 2), ("mixed_veg", 1), ("toor_dal", 1)], False),
                  ([("khichdi", 1.5), ("buttermilk", 1)], False),
                  ([("bajra_roti", 2), ("mixed_veg", 1), ("buttermilk", 1)], False)],
        "snack": [([("namkeen", 1)], False), ([("dhokla", 0.7)], False), ([("marie_biscuits", 1)], False)],
        "dinner": [([("chapati", 3), ("mixed_veg", 1), ("toor_dal", 1)], False),
                   ([("khichdi", 1.5), ("curd", 1)], False), ([("methi_thepla", 1.5), ("curd", 1)], False),
                   ([("bajra_roti", 2), ("mixed_veg", 1)], False),
                   ([("chapati", 2), ("white_rice", 1), ("toor_dal", 1)], False)],
    },
    "East": {
        "breakfast": [([("puri", 1.5), ("aloo_sabzi", 1)], False), ([("white_bread", 1), ("egg_bhurji", 1)], True),
                      ([("poha", 1)], False), ([("chapati", 2), ("aloo_sabzi", 1)], False)],
        "lunch": [([("white_rice", 2), ("toor_dal", 1), ("fish_curry", 1)], True),
                  ([("white_rice", 2), ("moong_dal", 1), ("mixed_veg", 1)], False),
                  ([("white_rice", 2), ("toor_dal", 1), ("aloo_sabzi", 1)], False)],
        "snack": [([("marie_biscuits", 1)], False), ([("pakora", 1)], False), ([("samosa", 1)], False)],
        "dinner": [([("white_rice", 1.5), ("fish_curry", 1), ("mixed_veg", 1)], True),
                   ([("chapati", 3), ("mixed_veg", 1), ("moong_dal", 1)], False),
                   ([("white_rice", 1.5), ("moong_dal", 1), ("aloo_sabzi", 0.5)], False),
                   ([("chapati", 2), ("chicken_curry", 1), ("white_rice", 0.5)], True)],
    },
}
EXTRA_SNACKS = [[("banana", 1)], [("apple", 1)], [("marie_biscuits", 1)], [("namkeen", 1)], [("besan_ladoo", 1)],
                [("guava", 1)], [("sweet_lassi", 1)], [("mango", 1)], [("rusk", 1)], [("coconut_water", 1)]]
FESTIVE_SWEETS = [[("jalebi", 1)], [("gulab_jamun", 1)], [("besan_ladoo", 2)], [("rice_kheer", 1)]]
FASTING_MEALS = [[("sabudana_khichdi", 1)], [("kuttu_puri", 1), ("aloo_sabzi", 1)], [("fruit_chaat", 1), ("milk", 1)],
                 [("banana", 1), ("milk", 1)], [("dates", 1), ("milk", 1)]]
MAIN_SLOTS = ("breakfast", "lunch", "dinner")
SHARED_FESTIVAL_DAY = 19  # synthetic shared festival day (2026-10-10 in the default calendar)
EKADASHI_DAYS = (3, 18)  # synthetic fasting days for the ekadashi-style practice
NAVRATRI_DAYS = range(20, 29)  # synthetic 9-day fasting window


@dataclass
class Meal:
    t: int  # true start minute
    slot: str
    items: list[tuple[str, float]]
    logged: bool
    t_log: int
    items_log: list[tuple[str, float]]


@dataclass
class Dose:
    drug: str
    dose: float
    t_sched: int
    t: int  # actual time if taken
    taken: bool
    logged_taken: bool


@dataclass
class Lifestyle:
    n_min: int
    stage_true: np.ndarray  # int8 per minute: 0 wake, 1 light, 2 deep, 3 REM
    steps_min: np.ndarray  # float32 per minute
    stress: np.ndarray  # float32 per minute (latent)
    illness: np.ndarray  # float32 per minute (0/1)
    meals: list[Meal]
    doses: list[Dose]
    sleeps: list[tuple[int, int]]  # (onset, wake) true main sleep episodes
    walks: list[dict] = field(default_factory=list)
    fasting_days: list[int] = field(default_factory=list)
    festival_days: list[int] = field(default_factory=list)
    short_nights: list[int] = field(default_factory=list)


def _is_weekend(day: int) -> bool:
    return weekday(day * 1440, DATASET_START) >= 5


def _fasting_days(spec: PatientSpec, days: int) -> list[int]:
    hb = spec.habits
    if hb.fasting == "ekadashi":
        return [d for d in EKADASHI_DAYS if d < days]
    if hb.fasting == "weekly":
        return [d for d in range(days) if weekday(d * 1440) == hb.fasting_weekday]
    if hb.fasting == "navratri":
        return [d for d in NAVRATRI_DAYS if d < days]
    return []


def _hypnogram(rng: np.random.Generator, n: int) -> np.ndarray:
    """Minute-level sleep stages for a sleep episode of ``n`` minutes (~90-min cycles)."""
    out = np.ones(n, dtype=np.int8)
    t = int(rng.integers(5, 20))  # latency in light sleep
    cycle = 0
    while t < n:
        length = int(rng.integers(80, 111))
        deep = max(0, int(rng.normal(35 - 9 * cycle, 6))) if cycle < 4 else 0
        rem = int(np.clip(rng.normal(10 + 7 * cycle, 4), 4, 45))
        light1 = max(10, (length - deep - rem) // 2)
        seq = [(1, light1), (2, deep), (1, max(5, length - deep - rem - light1)), (3, rem)]
        for stage, dur in seq:
            if dur <= 0 or t >= n:
                continue
            out[t:min(n, t + dur)] = stage
            t += dur
        if rng.random() < 0.35 and t < n:  # brief awakening
            w = int(rng.integers(2, 9))
            out[t:min(n, t + w)] = 0
            t += w
        cycle += 1
    return out


def _pick(rng: np.random.Generator, options: list[Option], veg: bool) -> list[tuple[str, float]]:
    ok = [o for o, nv in options if not (nv and veg)]
    return ok[int(rng.integers(len(ok)))]


def _portions(rng: np.random.Generator, items: list[tuple[str, float]], scale: float) -> list[tuple[str, float]]:
    return [(f, round(float(p * scale * rng.lognormal(0, 0.18)), 2)) for f, p in items]


def _log_items(rng: np.random.Generator, items: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Logged portions: +/-~30% error, rounded to half portions (min 0.5)."""
    out = []
    for f, p in items:
        q = p * rng.lognormal(0, 0.25)
        out.append((f, max(0.5, round(q * 2) / 2)))
    return out


def generate_lifestyle(spec: PatientSpec, days: int) -> Lifestyle:
    rng = np.random.default_rng([spec.seed, 2])
    hb = spec.habits
    n_min = days * 1440
    stage = np.zeros(n_min, dtype=np.int8)
    steps = np.zeros(n_min, dtype=np.float32)
    stress = np.zeros(n_min, dtype=np.float32)
    illness = np.zeros(n_min, dtype=np.float32)
    fasting_days = _fasting_days(spec, days)
    festival_days = sorted({d for d in (SHARED_FESTIVAL_DAY, hb.celebration_day) if d < days})
    ill_days: set[int] = set()
    if hb.illness is not None:
        s, dur = hb.illness
        ill_days = {d for d in range(s, s + dur) if d < days}
        for d in ill_days:
            illness[d * 1440:(d + 1) * 1440] = 1.0

    # ---- sleep -------------------------------------------------------------------------------
    sleeps: list[tuple[int, int]] = []
    short_nights: list[int] = []
    wake_times: list[int] = []
    bed_times: list[int] = []
    for d in range(days + 1):
        wk = _is_weekend(d)
        wake_h = hb.wake_h + (0.7 if wk else 0.0) + rng.normal(0, 0.3)
        wake_times.append(int(d * 1440 + wake_h * 60))
    for d in range(-1, days):
        nxt_wake = wake_times[d + 1]
        dur_h = hb.sleep_dur_h + rng.normal(0, 0.45) + (0.6 if (d + 1) in ill_days else 0.0)
        if d in festival_days:
            dur_h -= 1.0
        if rng.random() < hb.short_night_p:
            dur_h = rng.uniform(3.8, 5.3)
            short_nights.append(d + 1)
        onset = int(nxt_wake - dur_h * 60)
        bed_times.append(onset)
        sleeps.append((onset, nxt_wake))
    for onset, wake in sleeps:
        a, b = max(onset, 0), min(wake, n_min)
        if b > a:
            hyp = _hypnogram(rng, wake - onset)
            stage[a:b] = hyp[a - onset:b - onset]
        # pre-sleep in bed / post-wake are wake (0)
    asleep = stage > 0
    for onset, wake in sleeps:  # mark the whole episode as "asleep" for activity masking
        asleep[max(onset, 0):min(wake, n_min)] = True

    # ---- meals -------------------------------------------------------------------------------
    meals: list[Meal] = []
    walks: list[dict] = []
    region = TEMPLATES[hb.region]

    def add_meal(t: float, slot: str, items: list[tuple[str, float]], main: bool, scale: float = 1.0) -> None:
        t_i = int(np.clip(t, 0, n_min - 1))
        ill = t_i // 1440 in ill_days
        sc = hb.portion_scale * scale * (0.75 if ill else 1.0)
        it = _portions(rng, items, sc)
        logged = rng.random() < (hb.log_main_p if main else hb.log_snack_p)
        t_log = int(round((t_i + rng.normal(0, 8)) / 5) * 5)
        meals.append(Meal(t_i, slot, it, bool(logged), int(np.clip(t_log, 0, n_min - 1)), _log_items(rng, it)))

    chai = ("chai_sugar" if hb.chai_sugar else "chai_nosugar") if hb.region != "South" else "filter_coffee"
    for d in range(days):
        base = d * 1440
        wk = _is_weekend(d)
        wake = wake_times[d]
        fast = d in fasting_days
        fest = d in festival_days
        if fast:
            strict = rng.random() < 0.3
            add_meal(wake + 40 + rng.normal(0, 15), "snack", [(chai, 1)], False)
            if not strict:
                add_meal(base + rng.normal(13.5, 0.4) * 60, "lunch",
                         FASTING_MEALS[int(rng.integers(len(FASTING_MEALS)))], True)
                add_meal(base + rng.normal(17.3, 0.3) * 60, "snack", [(chai, 1)], False)
            add_meal(base + rng.normal(19.8, 0.4) * 60, "dinner",
                     FASTING_MEALS[int(rng.integers(2))], True, scale=1.2)
            continue
        bt = wake + (hb.breakfast_delay_h + (0.3 if wk else 0.0) + rng.normal(0, 0.25)) * 60
        bitems = list(_pick(rng, region["breakfast"], hb.vegetarian)) + [(chai, 1)]
        if rng.random() < 0.06 and not wk:
            pass  # skipped breakfast (rushed morning)
        else:
            add_meal(bt, "breakfast", bitems, True)
        if hb.mid_morning_chai and rng.random() < 0.7:
            mm = [(chai, 1)] + ([("marie_biscuits", 0.5)] if rng.random() < 0.5 else [])
            add_meal(base + rng.normal(11.0, 0.4) * 60, "snack", mm, False)
        lt = base + (hb.lunch_h + (0.4 if wk else 0.0) + rng.normal(0, 0.35)) * 60
        add_meal(lt, "lunch", _pick(rng, region["lunch"], hb.vegetarian), True)
        if rng.random() < 0.85:
            st = base + (hb.snack_h + rng.normal(0, 0.35)) * 60
            items = [(chai, 1)] + (list(_pick(rng, region["snack"], hb.vegetarian)) if rng.random() < 0.7 else [])
            add_meal(st, "evening_snack", items, False)
        dt = base + (hb.dinner_h + (0.3 if wk else 0.0) + (0.4 if fest else 0.0) + rng.normal(0, 0.35)) * 60
        add_meal(dt, "dinner", _pick(rng, region["dinner"], hb.vegetarian), True, scale=1.1 if fest else 1.0)
        for _ in range(int(rng.poisson(hb.extra_snack_rate))):
            when = base + rng.uniform(10.0, 22.0) * 60
            add_meal(when, "snack", EXTRA_SNACKS[int(rng.integers(len(EXTRA_SNACKS)))], False)
        if fest:
            add_meal(base + rng.uniform(15.5, 18.0) * 60, "snack", FESTIVE_SWEETS[int(rng.integers(4))], False)
            add_meal(dt + 25, "snack", FESTIVE_SWEETS[int(rng.integers(4))], False)
        if hb.bedtime_milk and rng.random() < 0.7:
            bed = bed_times[d + 1] if d + 1 < len(bed_times) else base + 23 * 60
            add_meal(bed - 30, "snack", [("milk", 1)], False)
        # walks
        ill = d in ill_days
        if hb.morning_walk and not ill and rng.random() < hb.morning_walk_p:
            ws = int(wake + rng.uniform(10, 35))
            walks.append({"t": ws, "dur": int(rng.integers(25, 46)), "kind": "brisk"})
        if hb.post_dinner_walk and not ill and rng.random() < hb.post_dinner_walk_p:
            walks.append({"t": int(dt + rng.uniform(15, 35)), "dur": int(rng.integers(10, 21)), "kind": "light"})
    meals.sort(key=lambda m: m.t)

    # ---- activity: ambient steps + walks + commute -------------------------------------------
    minute_of_day = np.arange(n_min) % 1440
    day_of = np.arange(n_min) // 1440
    lam = np.full(n_min, hb.ambient_steps_per_min, dtype=np.float64)
    for d in range(days):
        if hb.office and not _is_weekend(d) and d not in fasting_days:
            sl = slice(d * 1440 + 9 * 60 + 30, d * 1440 + 18 * 60)
            lam[sl] *= 0.45
            for c0 in (9 * 60, 18 * 60 + 10):
                a = d * 1440 + c0
                lam[a:a + 15] = 70.0
    ill_mask = illness > 0
    lam[ill_mask] *= 0.4
    # bursty ambient activity
    burst = rng.random(n_min) < 0.04
    lam = lam * np.where(burst, 4.0, 0.85)
    steps = rng.poisson(lam).astype(np.float32)
    for w in walks:
        a, b = w["t"], min(w["t"] + w["dur"], n_min)
        rate = 108.0 if w["kind"] == "brisk" else 78.0
        steps[a:b] = rng.normal(rate, 6.0, b - a).clip(40, 140)
    steps[asleep] = 0.0
    night_wake = (~asleep) & ((minute_of_day < 5 * 60) | (minute_of_day > 23 * 60 + 30))
    steps[night_wake] *= 0.3

    # ---- latent stress -----------------------------------------------------------------------
    raw = np.zeros(n_min)
    for d in range(days):
        if hb.office and not _is_weekend(d):
            level = hb.stress_level * rng.uniform(0.3, 1.0)
            raw[d * 1440 + 10 * 60:d * 1440 + 18 * 60] += level
        if rng.random() < 0.12:
            a = int(d * 1440 + rng.uniform(9, 21) * 60)
            raw[a:a + int(rng.uniform(60, 180))] += rng.uniform(0.6, 1.4)
        if d in short_nights:
            raw[d * 1440 + 7 * 60:d * 1440 + 22 * 60] += 0.3
    raw += 0.8 * illness
    alpha = 1.0 / 30.0  # exponential smoothing (30 min)
    stress = lfilter([alpha], [1.0, -(1.0 - alpha)], raw).astype(np.float32)

    # ---- doses -------------------------------------------------------------------------------
    doses: list[Dose] = []
    for rx in spec.prescriptions:
        su = rx.spec.kind == "su"
        for d in range(days):
            for tm in rx.times_min:
                t_sched = d * 1440 + tm
                if t_sched >= n_min:
                    continue
                p = hb.adherence * (0.95 if _is_weekend(d) else 1.0) * (0.9 if tm >= 18 * 60 else 1.0)
                if d in ill_days:
                    p *= 0.85
                if su and d in fasting_days:
                    p *= hb.su_on_fast_p
                taken = bool(rng.random() < p)
                t_act = int(np.clip(t_sched + rng.normal(0, 20), 0, n_min - 1))
                logged = bool(rng.random() < 0.96) if taken else bool(rng.random() < 0.2)
                doses.append(Dose(rx.drug, rx.dose, t_sched, t_act, taken, logged))
    doses.sort(key=lambda x: x.t_sched)
    del day_of
    return Lifestyle(n_min=n_min, stage_true=stage, steps_min=steps, stress=stress, illness=illness,
                     meals=meals, doses=doses, sleeps=sleeps, walks=walks, fasting_days=fasting_days,
                     festival_days=festival_days, short_nights=short_nights)
