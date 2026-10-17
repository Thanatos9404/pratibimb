/**
 * API contract — mirrors SPEC.md §5 exactly. The contract is the source of
 * truth: do not add optional fields here to paper over engine output; report
 * mismatches instead.
 *
 * All timestamps are ISO-8601 strings with a +05:30 offset.
 */

export type ISO = string;

// GET /api/health
export interface Health {
  status: "ok";
  version: string;
}

// GET /api/clock
export interface Clock {
  start: ISO;
  end: ISO;
  now: ISO;
}

export type Archetype = "SIDD" | "SIRD" | "MARD" | "IROD";
export type Trend = "rising_fast" | "rising" | "flat" | "falling" | "falling_fast";

export interface Risk {
  hyper_2h: number;
  hypo_1h: number;
  nocturnal_hypo: number | null;
  level: "low" | "moderate" | "high";
  /** extra (docs/API.md) */
  nocturnal_source?: "bedtime_model" | "twin_provisional" | null;
  /** extra (docs/API.md): decision time the probabilities refer to */
  decision_t?: ISO;
}

// GET /api/cohort
export interface CohortResponse {
  now: ISO;
  patients: CohortPatient[];
}

export interface CohortPatient {
  id: string;
  display_name: string;
  abha: string;
  age: number;
  sex: "F" | "M";
  /** inferred by twin + EHR, not the hidden truth label */
  inferred_subtype: Archetype;
  bmi: number;
  hba1c: number;
  /** e.g. ["Metformin 1000 mg BD", "Glimepiride 2 mg OD"] */
  meds: string[];
  risk: Risk;
  open_alerts: number;
  last_glucose: number | null;
  trend: Trend;
  tir_7d: number;
  tar_7d: number;
  tbr_7d: number;
  mean_glucose_7d: number;
  cv_7d: number;
  gmi_7d: number;
  /** 96 points, 15-min means of CGM */
  sparkline_24h: (number | null)[];
  /** extra (docs/API.md): whether the patient was held out from training */
  split?: "train" | "val" | "test";
}

export type TwinParamKey = "SI" | "SG" | "beta" | "EGP" | "meal_rate" | "dawn";

export interface TwinParam {
  key: TwinParamKey;
  label: string;
  unit: string;
  mean: number;
  p10: number;
  p90: number;
  population_median: number;
  trend_7d: number[];
}

export interface Lab {
  name: string;
  loinc: string;
  value: number;
  unit: string;
  date: string;
  ref: string;
}

export interface Condition {
  system: string;
  code: string;
  display: string;
  onset?: string;
}

export interface Medication {
  name: string;
  drug_class: string;
  dose: string;
  /** "08:00" */
  times: string[];
  /** extra (docs/API.md): engine drug key, used for what-if skip/shift */
  drug?: string;
}

export interface GeneticMarker {
  marker: string;
  value: string;
  note: string;
}

// GET /api/patients/{id}
export interface PatientDetail extends CohortPatient {
  height_cm: number;
  weight_kg: number;
  waist_cm: number;
  diabetes_years: number;
  region: string;
  labs: Lab[];
  conditions: Condition[];
  medications: Medication[];
  genetics: GeneticMarker[];
  twin: {
    updated_at: ISO;
    params: TwinParam[];
    fit: { mard_24h: number; coverage_80_24h: number };
  };
}

// GET /api/patients/{id}/fhir -> FHIR R4 Bundle (kept loose on purpose)
export interface FhirBundle {
  resourceType: "Bundle";
  type: string;
  entry?: { fullUrl?: string; resource: { resourceType: string; [k: string]: unknown } }[];
  [k: string]: unknown;
}

export type SleepStage = "wake" | "light" | "deep" | "rem";

export interface MealItem {
  food_id: string;
  name: string;
  portions: number;
  carbs_g: number;
}

export interface Meal {
  t: ISO;
  /** extra (docs/API.md) */
  slot?: string;
  carbs_g: number;
  gl: number;
  items: MealItem[];
}

export interface Dose {
  t: ISO;
  drug: string;
  dose: string;
  taken: boolean;
}

export type GlycemicEventKind = "hyper_l2" | "hypo_l1" | "hypo_l2";

export interface GlycemicEvent {
  kind: GlycemicEventKind;
  start: ISO;
  end: ISO;
  extreme: number;
}

// GET /api/patients/{id}/timeline?from=ISO&to=ISO
export interface Timeline {
  from: ISO;
  to: ISO;
  /** 5-min */
  cgm: { t: ISO; g: number | null }[];
  /** filtered twin estimate, 5-min */
  twin: { t: ISO; p10: number; p50: number; p90: number }[];
  hr: { t: ISO; bpm: number }[];
  /** night-weighted */
  hrv: { t: ISO; rmssd: number }[];
  /** 5-min bins */
  steps: { t: ISO; count: number }[];
  sleep: { start: ISO; end: ISO; stage: SleepStage }[];
  /** logged only */
  meals: Meal[];
  /** logged only */
  doses: Dose[];
  alerts: Alert[];
  /** from CGM */
  events: GlycemicEvent[];
  /** extra (docs/API.md): 15-min risk series */
  risk?: (Omit<Risk, "nocturnal_source" | "decision_t"> & { t: ISO })[];
}

export type RiskTask = "hyper_2h" | "hypo_1h" | "nocturnal_hypo";

/** contribution in log-odds, signed */
export interface Driver {
  feature: string;
  label: string;
  value_text: string;
  contribution: number;
}

export interface Alert {
  id: string;
  t: ISO;
  kind: RiskTask;
  probability: number;
  threshold: number;
  outcome: "true_positive" | "false_positive" | "pending";
  lead_min: number | null;
  drivers: Driver[];
  recommendation: string;
  /** extra (docs/API.md): ground truth once the window closes (lets offline replay reveal outcomes) */
  resolves_at?: ISO;
  outcome_final?: "true_positive" | "false_positive";
  lead_min_final?: number | null;
}

export interface ForecastQuantile {
  t: ISO;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

// GET /api/patients/{id}/forecast?at=ISO
export interface Forecast {
  at: ISO;
  step_min: 5;
  horizon_min: 240;
  quantiles: ForecastQuantile[];
  mechanistic_p50: { t: ISO; g: number }[];
  risk: Risk;
  drivers: { hyper_2h: Driver[]; hypo_1h: Driver[] };
  state: {
    glucose: number;
    insulin_action: number;
    carbs_on_board_g: number;
    sulfonylurea_active: boolean;
    insulin_sensitivity_vs_baseline: number;
  };
}

// POST /api/patients/{id}/whatif
export interface WhatIfRequest {
  /** default now */
  at?: ISO;
  /** default 300 */
  horizon_min?: number;
  scenario: WhatIfScenario;
  /** extra (docs/API.md): explicit planned meals for the baseline */
  baseline_meals?: { offset_min: number; items: { food_id: string; portions: number }[] }[];
}

export interface WhatIfScenario {
  meals?: { offset_min: number; items: { food_id: string; portions: number }[] }[];
  replace_planned_meals?: boolean;
  walk?: { offset_min: number; duration_min: number; intensity: "light" | "brisk" };
  skip_dose?: string;
  shift_dose?: { drug: string; offset_min: number };
  sleep_hours_last_night?: number;
}

export interface BandPoint {
  t: ISO;
  p10: number;
  p50: number;
  p90: number;
}

export interface WhatIfMetrics {
  peak: number;
  nadir: number;
  min_above_180: number;
  min_below_70: number;
  hypo_probability: number;
  tir: number;
}

export interface WhatIfResponse {
  at: ISO;
  baseline: BandPoint[];
  scenario: BandPoint[];
  metrics: Record<"baseline" | "scenario", WhatIfMetrics>;
  narrative: string[];
}

// GET /api/foods
export interface Food {
  id: string;
  name: string;
  name_hi: string;
  category: string;
  serving_desc: string;
  carbs_g: number;
  fiber_g: number;
  protein_g: number;
  fat_g: number;
  gi: number;
  gl: number;
  source: string;
}

export interface FoodsResponse {
  foods: Food[];
}

// WS /api/stream/{id}?from=ISO&speed=120
export type StreamMessage =
  | {
      type: "tick";
      t: ISO;
      cgm: number | null;
      hr: number;
      steps: number;
      hrv: number | null;
      twin: { p10: number; p50: number; p90: number };
      risk: Risk;
    }
  | { type: "meal"; meal: Meal }
  | { type: "dose"; dose: Dose }
  | { type: "alert"; alert: Alert }
  | { type: "forecast"; forecast: Forecast }
  | { type: "end" };

// reports/metrics.json
export type MetricTask = "hyper_2h" | "hypo_1h" | "nocturnal_hypo";
export type AblationModel = "cgm_linear" | "ml_no_twin" | "twin_only" | "hybrid";

export interface TaskMetrics {
  prevalence: number;
  auroc: number;
  auprc: number;
  brier: number;
  operating_point: {
    threshold: number;
    sensitivity: number;
    precision: number;
    alerts_per_patient_day: number;
    median_lead_min: number;
    /** extra */
    false_alerts_per_patient_day?: number;
    events?: number;
  };
  calibration: { pred: number; obs: number; n: number }[];
  lead_time_hist: { min: number; count: number }[];
  /** extra */
  n_test?: number;
  n_positive?: number;
}

export interface WhatIfPreset {
  id: string;
  label: string;
  request?: WhatIfRequest;
}

/** extra (static export): hourly forecasts for offline replay */
export interface ForecastSeries {
  forecasts: Forecast[];
}

export interface Metrics {
  generated_at: ISO;
  dataset: {
    patients: number;
    days: number;
    train_patients: number;
    val_patients: number;
    test_patients: number;
    cgm_points: number;
    subtype_counts: Record<Archetype, number>;
    /** extra */
    decision_points?: number;
    bedtime_decisions?: number;
  };
  tasks: Record<MetricTask, TaskMetrics>;
  ablation: {
    model: AblationModel;
    hyper_2h_auroc: number;
    hypo_1h_auroc: number;
    nocturnal_hypo_auroc: number;
    hyper_2h_auprc: number;
    hypo_1h_auprc: number;
    /** extra */
    nocturnal_hypo_auprc?: number;
  }[];
  forecast: {
    horizons_min: number[];
    rmse: number[];
    mard: number[];
    coverage_80: number[];
    parkes: { horizon_min: number; A: number; B: number; C: number; D: number; E: number }[];
    baseline_rmse: number[];
    /** extra */
    baseline_mard?: number[];
    persistence_rmse?: number[];
    coverage_80_raw?: number[];
  };
  top_features: { task: string; feature: string; label: string; mean_abs_contrib: number }[];
  /** extras present in reports/metrics.json (beyond SPEC §5) */
  sync?: { twin_vs_truth_mard?: number; cgm_vs_truth_mard?: number; twin_band_coverage_80?: number };
  ci95?: Partial<Record<MetricTask, { auroc?: [number, number]; auprc?: [number, number] }>>;
  cgm_labelled?: Partial<Record<MetricTask, { prevalence?: number; auroc?: number; auprc?: number }>>;
  brier_by_model?: Partial<Record<MetricTask, Partial<Record<AblationModel, number>>>>;
  notes?: string[];
}

/** reports/cohort_validation.json — shape not fixed by the contract; rendered defensively. */
export type CohortValidation = Record<string, unknown>;

/** reports/real_validation.json — REAL-data external validation (engine `pratibimb validate-real`). */
export interface RealValidation {
  generated_at: string;
  datasets: { name: string; source: string; licence: string; n_people: number; n_days: number; used_records: number; notes: string }[];
  forecast: {
    horizons_min: number[];
    n_points: number;
    twin: { rmse: (number | null)[]; mard: (number | null)[]; coverage_80: (number | null)[]; parkes_A: (number | null)[] };
    persistence: { rmse: (number | null)[] };
    linear: { rmse: (number | null)[] };
    glycotwin_lgbm: { rmse: (number | null)[]; source: "reproduced" | "reported" | string };
  };
  risk: {
    event: string;
    base_rate: number | null;
    n_windows: number | null;
    baseline: { auroc: number | null; auprc: number | null };
    plus_twin: { auroc: number | null; auprc: number | null };
    transfer_no_retrain: { auroc: number | null; auprc: number | null };
  }[];
  synthetic_vs_real: { event_rate_ratio_ge180: number | null; event_rate_ratio_gt250: number | null; volatility_ratio_30min: number | null };
  limitations: string[];
  notes: string[];
}
