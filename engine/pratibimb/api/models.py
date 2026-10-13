"""Pydantic models mirroring the API contract in SPEC section 5 (optional extras are marked)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Archetype = Literal["SIDD", "SIRD", "MARD", "IROD"]
Trend = Literal["rising_fast", "rising", "flat", "falling", "falling_fast"]
Level = Literal["low", "moderate", "high"]


class Health(BaseModel):
    status: str
    version: str
    profile: str | None = None  # extra


class Clock(BaseModel):
    start: str
    end: str
    now: str


class Risk(BaseModel):
    hyper_2h: float
    hypo_1h: float
    nocturnal_hypo: float | None
    level: Level
    nocturnal_source: Literal["bedtime_model", "twin_provisional"] | None = None  # extra
    decision_t: str | None = None  # extra: decision point the risk refers to


class CohortPatient(BaseModel):
    id: str
    display_name: str
    abha: str
    age: int
    sex: Literal["F", "M"]
    inferred_subtype: Archetype
    bmi: float
    hba1c: float
    meds: list[str]
    risk: Risk
    open_alerts: int
    last_glucose: float | None
    trend: Trend
    tir_7d: float
    tar_7d: float
    tbr_7d: float
    mean_glucose_7d: float
    cv_7d: float
    gmi_7d: float
    sparkline_24h: list[float | None]
    split: Literal["train", "val", "test"] | None = None  # extra: which evaluation split the patient is in


class CohortResponse(BaseModel):
    now: str
    patients: list[CohortPatient]


class Lab(BaseModel):
    name: str
    loinc: str
    value: float
    unit: str
    date: str
    ref: str


class Condition(BaseModel):
    system: str
    code: str
    display: str
    onset: str | None = None


class Medication(BaseModel):
    name: str
    drug_class: str
    dose: str
    times: list[str]
    drug: str | None = None  # extra: engine drug key (use for what-if skip/shift)


class Genetic(BaseModel):
    marker: str
    value: str
    note: str


class TwinParam(BaseModel):
    key: Literal["SI", "SG", "beta", "EGP", "meal_rate", "dawn"]
    label: str
    unit: str
    mean: float
    p10: float
    p90: float
    population_median: float
    trend_7d: list[float]


class TwinFit(BaseModel):
    mard_24h: float
    coverage_80_24h: float


class TwinInfo(BaseModel):
    updated_at: str
    params: list[TwinParam]
    fit: TwinFit


class PatientDetail(CohortPatient):
    height_cm: float
    weight_kg: float
    waist_cm: float
    diabetes_years: float
    region: str
    labs: list[Lab]
    conditions: list[Condition]
    medications: list[Medication]
    genetics: list[Genetic]
    twin: TwinInfo


class Driver(BaseModel):
    feature: str
    label: str
    value_text: str
    contribution: float


class Alert(BaseModel):
    id: str
    t: str
    kind: Literal["hyper_2h", "hypo_1h", "nocturnal_hypo"]
    probability: float
    threshold: float
    outcome: Literal["true_positive", "false_positive", "pending"]
    lead_min: float | None
    drivers: list[Driver]
    recommendation: str
    resolves_at: str | None = None  # extra: when the alert's prediction window closes
    outcome_final: Literal["true_positive", "false_positive"] | None = None  # extra: outcome once resolved
    lead_min_final: float | None = None  # extra


class CGMPoint(BaseModel):
    t: str
    g: float | None


class BandPoint(BaseModel):
    t: str
    p10: float
    p50: float
    p90: float


class HRPoint(BaseModel):
    t: str
    bpm: float


class HRVPoint(BaseModel):
    t: str
    rmssd: float


class StepsPoint(BaseModel):
    t: str
    count: int


class SleepSeg(BaseModel):
    start: str
    end: str
    stage: Literal["wake", "light", "deep", "rem"]


class MealItemOut(BaseModel):
    food_id: str
    name: str
    portions: float
    carbs_g: float


class MealOut(BaseModel):
    t: str
    carbs_g: float
    gl: float
    items: list[MealItemOut]
    slot: str | None = None  # extra


class DoseOut(BaseModel):
    t: str
    drug: str
    dose: str
    taken: bool


class EventOut(BaseModel):
    kind: Literal["hyper_l2", "hypo_l1", "hypo_l2"]
    start: str
    end: str
    extreme: float


class RiskPoint(BaseModel):  # extra
    t: str
    hyper_2h: float
    hypo_1h: float
    nocturnal_hypo: float | None
    level: Level


class Timeline(BaseModel):
    from_: str = Field(alias="from")
    to: str
    cgm: list[CGMPoint]
    twin: list[BandPoint]
    hr: list[HRPoint]
    hrv: list[HRVPoint]
    steps: list[StepsPoint]
    sleep: list[SleepSeg]
    meals: list[MealOut]
    doses: list[DoseOut]
    alerts: list[Alert]
    events: list[EventOut]
    risk: list[RiskPoint] | None = None  # extra: 15-min risk series

    model_config = {"populate_by_name": True}


class QuantilePoint(BaseModel):
    t: str
    p05: float
    p25: float
    p50: float
    p75: float
    p95: float


class GPoint(BaseModel):
    t: str
    g: float


class ForecastState(BaseModel):
    glucose: float
    insulin_action: float
    carbs_on_board_g: float
    sulfonylurea_active: bool
    insulin_sensitivity_vs_baseline: float


class ForecastDrivers(BaseModel):
    hyper_2h: list[Driver]
    hypo_1h: list[Driver]


class Forecast(BaseModel):
    at: str
    step_min: Literal[5] = 5
    horizon_min: Literal[240] = 240
    quantiles: list[QuantilePoint]
    mechanistic_p50: list[GPoint]
    risk: Risk
    drivers: ForecastDrivers
    state: ForecastState


class WhatIfFoodItem(BaseModel):
    food_id: str
    portions: float = 1.0


class WhatIfMeal(BaseModel):
    offset_min: int
    items: list[WhatIfFoodItem]


class WhatIfWalk(BaseModel):
    offset_min: int
    duration_min: int
    intensity: Literal["light", "brisk"]


class ShiftDose(BaseModel):
    drug: str
    offset_min: int


class Scenario(BaseModel):
    meals: list[WhatIfMeal] | None = None
    replace_planned_meals: bool | None = False
    walk: WhatIfWalk | None = None
    skip_dose: str | None = None
    shift_dose: ShiftDose | None = None
    sleep_hours_last_night: float | None = None


class WhatIfRequest(BaseModel):
    at: str | None = None
    horizon_min: int | None = 300
    scenario: Scenario
    baseline_meals: list[WhatIfMeal] | None = None  # extra: explicit planned meals for the baseline


class WhatIfMetrics(BaseModel):
    peak: float
    nadir: float
    min_above_180: float
    min_below_70: float
    hypo_probability: float
    tir: float


class WhatIfResponse(BaseModel):
    at: str
    baseline: list[BandPoint]
    scenario: list[BandPoint]
    metrics: dict[Literal["baseline", "scenario"], WhatIfMetrics]
    narrative: list[str]


class Food(BaseModel):
    id: str
    name: str
    name_hi: str
    category: str
    serving_desc: str
    carbs_g: float
    fiber_g: float
    protein_g: float
    fat_g: float
    gi: float
    gl: float
    source: str


class FoodsResponse(BaseModel):
    foods: list[Food]
