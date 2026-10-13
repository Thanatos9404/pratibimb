"""Static patient sampling: demographics, archetype, hidden truth physiology, prescriptions, habits."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np

from ..physiology.drugs import DRUGS, format_dose, frequency_label
from .archetypes import ARCHETYPES, PROPORTIONS, SPECS
from .names import synthetic_abha, synthetic_name

REGIONS = ("North", "South", "West", "East")
# approximate on-treatment reduction in fasting glucose per drug class (mg/dL), used only to place the
# synthetic patient's on-treatment fasting set-point below their pre-treatment (archetype) level
FPG_EFFECT = {"metformin": 20.0, "su": 25.0, "dpp4": 12.0, "sglt2": 18.0, "insulin": 35.0}
REGION_P = (0.35, 0.30, 0.20, 0.15)


@dataclass
class Prescription:
    drug: str
    dose: float
    times_min: list[int]  # scheduled minute-of-day for each daily dose

    @property
    def per_day(self) -> int:
        return len(self.times_min)

    @property
    def spec(self):
        return DRUGS[self.drug]

    def label(self) -> str:
        return f"{self.spec.name} {format_dose(self.drug, self.dose)} {frequency_label(self.per_day)}"

    def times_hhmm(self) -> list[str]:
        return [f"{t // 60:02d}:{t % 60:02d}" for t in self.times_min]


@dataclass
class TruthParams:
    """Hidden physiology of the truth simulator (never visible to the twin)."""

    si0: float
    sg: float
    beta: float
    tau_scale: float
    dawn: float
    dawn_peak_h: float
    night_dip: float  # early-night (~02:30) EGP nadir depth
    tau_i: float
    p2: float
    n: float
    k_ex: float
    a_ex: float
    tau_ex_min: float
    circ_si_amp: float
    sleep_si_sens: float
    si_ou_sd: float
    si_ou_tau_days: float
    stress_egp: float
    cr_gain: float
    incretin_gain: float
    met_effect: float
    su_sens: float
    su_thalf_mult: float
    sglt2_thr: float
    ins_abs_sd: float
    fpg_target: float  # pre-dawn fasting set-point used to calibrate basal EGP (mg/dL)
    h: float  # glucose threshold for stimulated secretion (mg/dL)
    egp0: float = 0.0  # filled by calibration


@dataclass
class Habits:
    region: str
    vegetarian: bool
    office: bool
    wake_h: float
    sleep_dur_h: float
    breakfast_delay_h: float
    lunch_h: float
    snack_h: float
    dinner_h: float
    mid_morning_chai: bool
    chai_sugar: bool
    bedtime_milk: bool
    morning_walk: bool
    morning_walk_p: float
    post_dinner_walk: bool
    post_dinner_walk_p: float
    ambient_steps_per_min: float
    portion_scale: float
    extra_snack_rate: float
    adherence: float
    log_main_p: float
    log_snack_p: float
    fasting: str  # "none" | "ekadashi" | "weekly" | "navratri"
    fasting_weekday: int
    su_on_fast_p: float
    stress_level: float
    short_night_p: float
    rest_hr: float
    rmssd_base: float
    illness: tuple[int, int] | None  # (start_day, duration_days)
    celebration_day: int


@dataclass
class PatientSpec:
    idx: int
    pid: str
    seed: int
    sex: str
    age: int
    given: str
    family: str
    abha: str
    height_cm: float
    weight_kg: float
    waist_cm: float
    bmi: float
    archetype: str
    diabetes_years: float
    egfr: float
    tcf7l2_t_alleles: int
    prs_percentile: int
    prescriptions: list[Prescription]
    truth: TruthParams
    habits: Habits
    extras: dict = field(default_factory=dict)

    @property
    def display_name(self) -> str:
        return f"{self.given} {self.family}"

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _clip(x: float, lo: float, hi: float) -> float:
    return float(min(max(x, lo), hi))


def sample_archetype(rng: np.random.Generator) -> str:
    names = list(PROPORTIONS)
    p = np.array([PROPORTIONS[n] for n in names])
    return str(rng.choice(names, p=p / p.sum()))


def _prescriptions(rng: np.random.Generator, arch: str, egfr: float, hb: Habits) -> list[Prescription]:
    spec = SPECS[arch]
    rx: list[Prescription] = []
    bfast = int(round((hb.wake_h + hb.breakfast_delay_h) * 60 / 30) * 30)
    dinner = int(round(hb.dinner_h * 60 / 30) * 30)
    if egfr >= 30 and rng.random() < 0.88:
        dose = float(rng.choice([500, 1000, 1000]))
        times = [bfast, dinner] if rng.random() < 0.8 else [dinner]
        rx.append(Prescription("metformin", dose, times))
    if rng.random() < spec.p_su:
        which = rng.choice(["glimepiride", "gliclazide_mr", "gliclazide"], p=[0.55, 0.3, 0.15])
        if which == "glimepiride":
            rx.append(Prescription("glimepiride", float(rng.choice([1, 2, 2, 3, 4])), [bfast - 30]))
        elif which == "gliclazide_mr":
            rx.append(Prescription("gliclazide_mr", float(rng.choice([30, 60, 60])), [bfast - 30]))
        else:
            rx.append(Prescription("gliclazide", 80.0, [bfast - 30, dinner - 30]))
    if rng.random() < spec.p_dpp4:
        which = rng.choice(["sitagliptin", "vildagliptin", "teneligliptin"], p=[0.4, 0.3, 0.3])
        if which == "vildagliptin":
            rx.append(Prescription("vildagliptin", 50.0, [bfast, dinner]))
        elif which == "sitagliptin":
            rx.append(Prescription("sitagliptin", 100.0, [bfast]))
        else:
            rx.append(Prescription("teneligliptin", 20.0, [bfast]))
    if egfr >= 30 and rng.random() < spec.p_sglt2:
        which = rng.choice(["dapagliflozin", "empagliflozin"])
        rx.append(Prescription(str(which), 10.0, [bfast]))
    if rng.random() < spec.p_insulin:
        units = float(rng.integers(8, 27))
        rx.append(Prescription("glargine", units, [22 * 60] if rng.random() < 0.7 else [8 * 60]))
    if not rx:
        rx.append(Prescription("metformin", 500.0, [bfast, dinner]))
    return rx


def _habits(rng: np.random.Generator, age: int, sex: str, arch: str, days: int) -> Habits:
    region = str(rng.choice(REGIONS, p=REGION_P))
    office = age < 60 and rng.random() < 0.55
    wake = _clip(rng.normal(6.4, 0.55), 5.0, 8.0)
    fasting = str(rng.choice(["none", "ekadashi", "weekly", "navratri"], p=[0.52, 0.18, 0.15, 0.15]))
    illness = None
    if rng.random() < 0.3 and days >= 8:
        illness = (int(rng.integers(2, days - 4)), int(rng.integers(2, 6)))
    rmssd = _clip(rng.normal(34 - 0.35 * (age - 40), 6), 10, 60)
    return Habits(
        region=region,
        vegetarian=bool(rng.random() < (0.45 if region in ("North", "West") else 0.25) + 0.15),
        office=office,
        wake_h=wake,
        sleep_dur_h=_clip(rng.normal(6.9, 0.55), 5.5, 8.5),
        breakfast_delay_h=_clip(rng.normal(1.6, 0.4), 0.6, 2.8),
        lunch_h=_clip(rng.normal(13.6, 0.4), 12.5, 15.0),
        snack_h=_clip(rng.normal(17.4, 0.4), 16.3, 18.5),
        dinner_h=_clip(rng.normal(21.3, 0.5), 20.0, 22.6),
        mid_morning_chai=bool(rng.random() < 0.4),
        chai_sugar=bool(rng.random() < 0.65),
        bedtime_milk=bool(rng.random() < 0.25),
        morning_walk=bool(rng.random() < 0.4),
        morning_walk_p=float(rng.uniform(0.55, 0.9)),
        post_dinner_walk=bool(rng.random() < 0.22),
        post_dinner_walk_p=float(rng.uniform(0.4, 0.8)),
        ambient_steps_per_min=float(rng.uniform(5.0, 11.0) * (0.75 if office else 1.0)),
        portion_scale=_clip(rng.lognormal(0.0, 0.12) * (1.05 if sex == "M" else 0.88), 0.65, 1.25),
        extra_snack_rate=float(rng.uniform(0.2, 1.1)),
        adherence=_clip(rng.beta(12, 1.4), 0.65, 0.995),
        log_main_p=float(rng.uniform(0.9, 0.99)),
        log_snack_p=float(rng.uniform(0.6, 0.9)),
        fasting=fasting,
        fasting_weekday=int(rng.choice([0, 1, 3, 5])),
        su_on_fast_p=float(rng.uniform(0.3, 0.85)),
        stress_level=float(rng.uniform(0.1, 0.8)),
        short_night_p=float(rng.uniform(0.04, 0.14)),
        rest_hr=_clip(rng.normal(76, 7), 58, 95),
        rmssd_base=rmssd,
        illness=illness,
        celebration_day=int(rng.integers(0, max(days, 1))),
    )


def sample_patient(idx: int, seed: int, days: int) -> PatientSpec:
    """Sample one synthetic patient's static profile (deterministic for (seed, idx))."""
    rng = np.random.default_rng([seed, idx, 1])
    arch = sample_archetype(rng)
    a = SPECS[arch]
    sex = "M" if rng.random() < 0.55 else "F"
    age = int(_clip(rng.normal(a.age_mean, a.age_sd), 30, 75))
    height = rng.normal(167, 6.5) if sex == "M" else rng.normal(154, 6.0)
    bmi = _clip(rng.normal(a.bmi_mean, a.bmi_sd), 18.0, 42.0)
    weight = bmi * (height / 100) ** 2
    whtr = 0.50 + 0.011 * (bmi - 23) + a.whtr_extra + rng.normal(0, 0.025) + (0.01 if sex == "F" else 0)
    whtr = _clip(whtr, 0.43, 0.75)
    waist = whtr * height
    duration = _clip(rng.gamma(2.2, a.duration_mean / 2.2), 0.5, min(30.0, age - 25))
    egfr = _clip(105 - 0.9 * (age - 40) - 0.6 * duration + rng.normal(0, 12), 22, 125)
    t_alleles = int(rng.binomial(2, 0.38 if arch == "SIDD" else 0.29))
    prs = int(_clip(rng.normal(62 if arch == "SIDD" else 55, 24), 1, 99))

    hb = _habits(rng, age, sex, arch, days)
    # within-archetype adiposity modulates insulin sensitivity (thin-fat phenotype via WHtR)
    si = a.si_median * np.exp(rng.normal(0, 0.3) - 2.5 * (whtr - 0.57))
    beta = a.beta_median * np.exp(rng.normal(0, 0.3)) * 0.95 ** t_alleles * np.exp(-0.012 * duration)
    rx = _prescriptions(rng, arch, egfr, hb)
    pre_fpg = rng.normal(a.fpg_mean, a.fpg_sd)
    lowering = sum(FPG_EFFECT[r.spec.kind] * rng.uniform(0.6, 1.4) for r in rx)
    truth = TruthParams(
        si0=float(_clip(si, 3e-5, 1.2e-3)),
        sg=float(_clip(rng.lognormal(np.log(0.0085), 0.22), 0.004, 0.02)),
        beta=float(_clip(beta, 0.01, 0.3)),
        tau_scale=float(_clip(rng.lognormal(0, 0.18), 0.6, 1.6)),
        dawn=float(rng.uniform(*a.dawn_range)),
        dawn_peak_h=float(rng.uniform(5.0, 7.5)),
        night_dip=float(rng.uniform(0.12, 0.32)),
        tau_i=float(rng.uniform(6.0, 12.0)),
        p2=float(rng.uniform(0.018, 0.035)),
        n=float(rng.uniform(0.11, 0.18)),
        k_ex=float(rng.uniform(0.003, 0.0065)),
        a_ex=float(rng.uniform(0.3, 0.8)),
        tau_ex_min=float(rng.uniform(180, 360)),
        circ_si_amp=float(rng.uniform(0.05, 0.2)),
        sleep_si_sens=float(rng.uniform(0.15, 0.3)),
        si_ou_sd=float(rng.uniform(0.12, 0.24)),
        si_ou_tau_days=float(rng.uniform(2.0, 5.0)),
        stress_egp=float(rng.uniform(0.08, 0.22)),
        cr_gain=float(rng.uniform(0.3, 1.2)),
        incretin_gain=float(rng.uniform(0.15, 0.35)),
        met_effect=float(rng.uniform(0.12, 0.28)),
        su_sens=float(_clip(rng.lognormal(0, 0.4), 0.4, 2.5)),
        su_thalf_mult=float(1.0 + max(0.0, (60 - egfr) / 60.0)),
        sglt2_thr=float(rng.uniform(90, 120)),
        ins_abs_sd=float(rng.uniform(0.08, 0.2)),
        fpg_target=float(_clip(pre_fpg - lowering, 88, 225)),
        h=float(rng.uniform(90, 125)),
    )
    given, family = synthetic_name(rng, sex, hb.region)
    return PatientSpec(
        idx=idx, pid=f"P{idx + 1:04d}", seed=int(rng.integers(0, 2**31 - 1)), sex=sex, age=age,
        given=given, family=family, abha=synthetic_abha(idx + 1, rng),
        height_cm=float(round(height, 1)), weight_kg=float(round(weight, 1)), waist_cm=float(round(waist, 1)),
        bmi=float(round(bmi, 1)), archetype=arch, diabetes_years=float(round(duration, 1)),
        egfr=float(round(egfr, 0)), tcf7l2_t_alleles=t_alleles, prs_percentile=prs,
        prescriptions=rx, truth=truth, habits=hb,
    )


assert set(ARCHETYPES) == set(PROPORTIONS)
