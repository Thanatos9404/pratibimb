# Pratibimb (प्रतिबिम्ब) — Build Specification

> Internal build spec for the Happiest Health **Digital Twin Challenge 2026** (Unstop). Deadline: **20 Oct 2026, 7:00 PM IST**.
> Team **Stack Underflow** — Yashvardhan Thanvi (lead), Devesh Jain — Birla Institute of Technology (BIT Mesra), Off Campus Jaipur.

## 0. The brief (verbatim requirements, condensed)

- Build a **proof-of-concept Digital Twin** for **one** chronic condition prevalent in India. We chose **Type 2 Diabetes (T2D)**.
- Must **fuse two data streams**:
  1. Static/historical: simulated **EHR** (demographics, past diagnoses, labs, genetic markers).
  2. Dynamic/real-time: simulated or open **wearable/IoT time series** (HRV, CGM, sleep stages, steps).
- Output: a **working algorithmic model** that ingests both streams and **predicts an adverse event in advance** (their example: "a sudden glucose spike 2 hours in advance").
- Plus a **conceptual UI dashboard showing how a doctor interacts with the virtual patient**.
- **Sandbox rules:** only anonymized, open-source, or **synthetic** data (DPDP Act / HIPAA). Synthea / MIMIC-IV for EHR are examples; synthetic wearables allowed.
- Submission: public GitHub repo; README must contain team + college, title, problem + use case, tech stack + AI/ML details, a **≥20-minute video**, license, **architecture diagram (PDF/PPT)**, **presentation (PDF/PPT)**.

Judges are a technical + clinical expert panel. We win on: (1) a *real* twin (mechanistic physiology kept in sync with data, able to answer "what if"), not just a classifier; (2) rigorous, honest evaluation; (3) India-specific depth; (4) a clinician UX that feels like a product.

## 1. The idea in one paragraph

Pratibimb ("reflection") is a **hybrid physiological + machine-learning digital twin** of a person with T2D. A compact glucose–insulin model (extended Bergman minimal model with gut absorption, exercise, circadian dawn effect, sleep/stress modulation and medication effects) is **personalised from the EHR** (HbA1c, TyG index, BMI/waist, diabetes duration, eGFR, medications) and then **kept in sync with the person's CGM + wearable streams by an Ensemble Kalman Filter** that continuously re-estimates hidden physiology (insulin sensitivity, beta-cell responsiveness, hepatic glucose output). The synced twin (a) **forecasts glucose 4 h ahead with uncertainty**, (b) feeds a **gradient-boosted risk layer** that predicts **level-2 hyperglycaemia within 2 h**, **hypoglycaemia within 1 h**, and **nocturnal hypoglycaemia tonight** with explanations, and (c) powers a **What-If Lab** where a doctor can test Indian meals, a post-meal walk, a missed/shifted sulfonylurea dose, or a short night's sleep on *this* patient before advising them.

## 2. India-specific grounding (use these, cite them, keep claims hedged)

- Burden: ICMR-INDIAB-17 (Anjana et al., *Lancet Diabetes Endocrinol* 2023): diabetes prevalence 11.4% (~101 million), prediabetes 15.3% (~136 million), hypertension 35.5%, abdominal obesity 39.5%.
- Phenotypes: Asian Indian T2D subgroups from the INSPIRED cohort (Anjana et al., *BMJ Open Diabetes Res Care* 2020): **SIDD** (severe insulin-deficient), **SIRD** (severe insulin-resistant), **MARD** (mild age-related), **IROD** (insulin-resistant obese). Use these as cohort archetypes; proportions approximately IROD ~39%, SIDD ~26%, MARD ~22%, SIRD ~12%. Also model the **"thin-fat" Indian phenotype** (normal BMI with central adiposity and high insulin resistance) inside SIRD/IROD sampling. Use Asian BMI cut-offs (overweight ≥23, obese ≥25).
- Diet: high-carbohydrate meals (white rice, roti, poha, idli/dosa), evening chai + snack, **late dinners (21:00–22:30)**, festival sweets, religious fasting days (Navratri / Ekadashi / Ramadan) — fasting + sulfonylurea is a classic hypoglycaemia trap.
- Medications common in India: metformin (very common), **sulfonylureas** (glimepiride/gliclazide; hypoglycaemia risk), DPP-4 inhibitors (sitagliptin/vildagliptin/teneligliptin), SGLT2 inhibitors (dapagliflozin/empagliflozin), basal insulin (glargine).
- Insulin resistance surrogate: **TyG index** = ln(TG [mg/dL] × FPG [mg/dL] / 2) — validated, cheap, available from routine labs (fasting insulin rarely measured in India).
- HbA1c ↔ mean glucose: ADAG eAG (mg/dL) = 28.7 × HbA1c − 46.7.
- Interoperability: **ABDM** (Ayushman Bharat Digital Mission) health records use **HL7 FHIR R4**; patients have a 14-digit **ABHA** number (format `XX-XXXX-XXXX-XXXX`). Export synthetic EHR as FHIR R4 Bundles; generate obviously-synthetic ABHA numbers (prefix `91-0000-…` is fine) and synthetic Indian names.
- CGM consensus targets (Battelino et al., *Diabetes Care* 2019): TIR 70–180 mg/dL > 70%, TBR <70 < 4%, TBR <54 < 1%, TAR >250 < 5%. Level 1 hypo <70, level 2 hypo <54, level 2 hyper >250.
- Error grid: **Parkes (Consensus) Error Grid for Type 2** to grade forecast accuracy.

All numbers in the UI, README, deck and video must come from our own generated `reports/metrics.json` or the cited literature above. **Never invent metrics.**

## 3. Science design

### 3.1 Two different models (avoid the "inverse crime")
- **Truth simulator** (`engine/pratibimb/cohort/truth.py`): the generator of synthetic patients. Richer than the twin: time-varying insulin sensitivity (slow random walk + circadian + post-sleep-loss + illness episodes), stress hormone effect on EGP, unlogged snacks, meal-logging errors (portion ±30%, ~15% of snacks never logged), missed doses, CGM sensor artefacts (lag ~8–10 min, AR(2) noise, calibration drift, compression lows at night, dropouts).
- **Twin model** (`engine/pratibimb/physiology/model.py`): simpler structure the twin actually runs. Only sees *observable* data: CGM, HR, HRV, steps, sleep stages, *logged* meals, *logged* doses, EHR.
- Evaluation is always twin-vs-truth on **held-out patients**.

### 3.2 Twin model (state-space ODE, 1-min internal step, 5-min observation step)
State: G (plasma glucose, mg/dL), X (remote insulin action, 1/min), I (plasma insulin above basal, µU/mL), D1, D2 (gut compartments, mg), Gi (interstitial glucose, mg/dL; CGM observes Gi with ~10 min lag).
- dG/dt = −(S_G + X)·G + S_G·G_b·f_EGP(t) + Ra(t)/V_G − U_ex(t) − R_renal(G)
- dX/dt = −p2·X + p2·S_I·m_sleep·m_stress·m_ex(t)·I
- dI/dt = −n·I + β·max(G − h, 0)·m_drug + I_exo(t)/V_I
- Gut: dD1/dt = −D1/τ_m + CHO_in(t); dD2/dt = (D1 − D2)/τ_m; Ra = f_bio·D2/τ_m. τ_m depends on meal glycaemic index and fibre/fat/protein (higher GI → shorter τ_m).
- Interstitial: dGi/dt = (G − Gi)/τ_i, τ_i ≈ 8–10 min.
- f_EGP(t): circadian dawn term peaking ~05:00–08:00 with patient-specific amplitude; metformin lowers EGP; stress (low HRV vs personal baseline, high resting HR) raises it.
- Exercise (from steps/HR): insulin-independent uptake U_ex ∝ intensity·G and transient S_I boost (m_ex) lasting hours.
- Sleep: previous night's short/fragmented sleep → m_sleep < 1 next day (literature: one night of partial sleep restriction lowers insulin sensitivity by roughly 15–25%).
- Drugs: sulfonylurea raises β·m_drug (glucose-independent component too → hypo risk when meals are skipped); DPP-4 modest postprandial boost; SGLT2i lowers renal threshold (~180 → ~100 mg/dL effective); basal insulin = slow flat I_exo.
- Renal: R_renal = k_r·max(G − G_thr, 0).
Personalised parameters θ = {S_I, S_G, β, EGP_b, τ_m scale, dawn amplitude}. Priors from EHR (§3.3). Keep ranges physiologically plausible; document every default and its source in `docs/MODEL_CARD.md`.

### 3.3 EHR → priors
- G_b & EGP_b from FPG and HbA1c (ADAG).
- S_I prior from TyG index, waist-to-height ratio, BMI, archetype-agnostic regression (the twin must **not** read the archetype label — the label is truth-only; the UI may show an *inferred* subtype computed from twin parameters + EHR).
- β prior from diabetes duration, HbA1c, and (if present) fasting C-peptide.
- Medication schedule from MedicationStatement.

### 3.4 Data assimilation (the "sync")
- **Ensemble Kalman Filter** (augmented state: dynamic states + log-parameters with slow random walk), ~64–128 members, vectorised numpy, observation = CGM (Gi) every 5 min with noise model; handle missing CGM (skip update). Inflation to avoid collapse. Parameter bounds by transformation (log / logit).
- Outputs at every step: filtered state mean/p10/p90, parameter posteriors. These are the "live twin".
- Forecast: propagate ensemble forward 240 min with logged/planned inputs + patient's habitual-meal prior (learned from logged meal times) as an option. Quantiles p05/p25/p50/p75/p95.

### 3.5 Risk layer (hybrid ML)
- Decision points every 15 min (and at bedtime for nocturnal task).
- Tasks / labels (computed on **truth** glucose, never on CGM noise artefacts; also report CGM-labelled variant):
  - `hyper_2h`: level-2 hyperglycaemia (>250 mg/dL for ≥15 min) begins within the next 120 min, given currently <250.
  - `hypo_1h`: level-1 hypoglycaemia (<70 mg/dL for ≥15 min) begins within the next 60 min, given currently ≥70.
  - `nocturnal_hypo`: any level-1 hypo between 00:00–06:00 tonight, predicted at bedtime.
- Features (only data ≤ t): CGM level/slopes (15/30/60 min)/acceleration/3-h SD & CV; carbs-on-board & GI-weighted load from logged meals; time since meal/dose; SU active flag; steps 30/60 min; HR, HRV RMSSD vs personal 7-day baseline; last-night sleep duration/efficiency/deep%; 3-day sleep debt; hour (sin/cos), weekday; EHR statics (age, sex, BMI, waist, HbA1c, TyG, eGFR, duration, med flags); **twin features**: ensemble forecast p50/p90/p10 at +30/+60/+120 min, ensemble exceedance probabilities, posterior S_I, β, EGP and their 24-h change, insulin-action state, gut glucose.
- Model: **LightGBM** (install it), class-imbalance aware, isotonic/Platt calibration on a validation split. Explanations via LightGBM `pred_contrib` (TreeSHAP) mapped to clinician-readable driver text.
- **Ablation (must report):** (a) CGM-only linear extrapolation baseline, (b) ML without twin features, (c) twin ensemble probability alone, (d) hybrid (ML + twin). Same splits.
- Splits: **patient-level** (≈70/15/15 train/val/test by patient, stratified by archetype). No leakage across patients or time.
- Metrics per task: AUROC, AUPRC, Brier, sensitivity at an operating point of ≤1 false alert per patient-day (report alerts/day), **median lead time** (minutes between alert and event onset for true positives), calibration bins. Forecast: RMSE & MARD at 30/60/120 min, Parkes zones A–E %, prediction-interval coverage (80%).
- Alert logic: a hysteresis/cool-down so alerts don't spam (e.g., one alert per event window).

### 3.6 What-If Lab
From the twin's current ensemble at time `at`, simulate a baseline (logged/planned future) vs a scenario: swap/add meals from the Indian food table (portions), add a light/brisk walk at an offset, skip or shift a dose, or set last night's sleep hours. Return quantile bands, peak, minutes >180 / <70, hypo probability, and plain-language narrative computed from deltas (no LLM required).

### 3.7 Indian food table
`engine/pratibimb/foods/indian_foods.csv`: ~60 common items (rice, brown rice, jeera rice, biryani, roti/chapati, bajra roti, jowar roti, paratha, naan, poha, upma, idli, dosa, uttapam, dal, rajma, chole, sambar, curd, paneer, sabzis, khichdi, sprouts salad, banana, mango, apple, chai with sugar, chai without sugar, biscuits, samosa, pakora, jalebi, gulab jamun, ladoo, kheer, sweet lassi, buttermilk, coconut water, etc.). Columns: id, name, name_hi (Devanagari), category, serving_desc (katori/piece/cup with grams), carbs_g, fiber_g, protein_g, fat_g, gi, gl, source. Values from IFCT 2017 (NIN) and International GI Tables (Atkinson et al., 2021) where available; mark estimates as `estimate`. Approximate is OK for a PoC; be honest in `source`.

### 3.8 Synthetic cohort
- Default **N = 240 patients × 28 days**, 5-min resolution (configurable; a `--small` profile for CI/deploy, e.g., 40 × 14).
- Each patient: synthetic Indian name, ABHA, age 30–75, sex, height/weight/waist, archetype, diabetes duration, labs over past 2 years (HbA1c trend, FPG, lipids incl. TG/HDL, creatinine/eGFR, ALT, urine ACR), comorbidities (hypertension, dyslipidaemia, NAFLD, CKD stage), **genetic markers** (the brief mentions them): a small polygenic-style panel, e.g. TCF7L2 rs7903146 genotype and a T2D polygenic risk score percentile — used only as a weak prior on β decline; label clearly as synthetic.
- Lifestyle generator: wake/sleep times (+ variability, weekends, occasional short nights), meals per Indian pattern with region flavour (North/South/West/East diet templates), chai snacks, festival days, fasting days, walks (morning walk habit for some), office sitting, HR/HRV dynamics (sleep ↓HR ↑HRV; stress ↑HR ↓HRV; exercise), sleep stages hypnogram (~90-min cycles), steps.
- Sensor layer for CGM noise/lag/dropouts; wearable noise.
- Sanity report (`reports/cohort_validation.json` + figures): per archetype mean glucose vs ADAG-from-HbA1c, TIR/TAR/TBR distributions, CV, hypo frequency by medication class, postprandial peak by meal type. Tune until plausible (e.g., cohort-median TIR ~55–75%, CV mostly 20–36%, hypos concentrated in SU/insulin users).

### 3.9 FHIR R4 export
Per patient Bundle (type `collection`): Patient (with ABHA identifier, synthetic), Condition (SNOMED CT 44054006 Type 2 diabetes mellitus, 38341003 hypertension, …), Observation for labs with LOINC (4548-4 HbA1c, 1558-6 fasting glucose, 2571-8 triglycerides, 2085-9 HDL, 2160-0 creatinine, 39156-5 BMI, 8280-0 waist circumference, 85354-9 BP panel), MedicationStatement, and a Device + summarised wearable Observations. Validate structure with a light JSON-schema-ish check in tests. Only use codes you are confident about.

## 4. Repository layout

```
Pratibimb/
  SPEC.md                 (this file)
  README.md               (final submission README — written last)
  LICENSE                 Apache-2.0
  engine/                 Python package `pratibimb` (pyproject, uv/venv)
    pratibimb/
      physiology/  cohort/  foods/  twin/  ml/  api/  cli.py
    tests/
  web/                    Next.js app (landing + clinician console)
  data/                   generated (gitignored except data/demo-small if needed)
  reports/                metrics.json, cohort_validation.json, figures/*.png|svg
  docs/                   MODEL_CARD.md, DATA_CARD.md, ARCHITECTURE.md, API.md
  video/                  (later) Remotion project
  submission/             (later) PDFs/PPTX, video link
  docker-compose.yml
```

CLI (`pratibimb …`): `generate`, `assimilate`, `train`, `evaluate`, `export-demo --out ../web/public/demo`, `serve`, and `build` (= all steps). Deterministic seeds.

## 5. API contract (FastAPI, prefix `/api`, JSON, ISO-8601 times with `+05:30`)

The dataset spans 28 days; the console runs at a fixed **demo clock** `now` (default: start + 21 days, 19:30 IST) so there is history behind and a future to replay live.

```ts
// GET /api/health -> { status: "ok", version: string }
// GET /api/clock  -> { start: ISO; end: ISO; now: ISO }

type Archetype = "SIDD" | "SIRD" | "MARD" | "IROD";
type Trend = "rising_fast" | "rising" | "flat" | "falling" | "falling_fast";
interface Risk { hyper_2h: number; hypo_1h: number; nocturnal_hypo: number | null; level: "low" | "moderate" | "high" }

// GET /api/cohort -> { now: ISO; patients: CohortPatient[] }
interface CohortPatient {
  id: string; display_name: string; abha: string; age: number; sex: "F" | "M";
  inferred_subtype: Archetype;            // inferred by twin+EHR, not the hidden truth label
  bmi: number; hba1c: number; meds: string[];   // e.g. ["Metformin 1000 mg BD", "Glimepiride 2 mg OD"]
  risk: Risk; open_alerts: number;
  last_glucose: number | null; trend: Trend;
  tir_7d: number; tar_7d: number; tbr_7d: number; mean_glucose_7d: number; cv_7d: number; gmi_7d: number;
  sparkline_24h: (number | null)[];      // 96 points, 15-min means of CGM
}

// GET /api/patients/{id} -> PatientDetail
interface PatientDetail extends CohortPatient {
  height_cm: number; weight_kg: number; waist_cm: number; diabetes_years: number; region: string;
  labs: { name: string; loinc: string; value: number; unit: string; date: string; ref: string }[];
  conditions: { system: string; code: string; display: string; onset?: string }[];
  medications: { name: string; drug_class: string; dose: string; times: string[] }[];   // times "08:00"
  genetics: { marker: string; value: string; note: string }[];
  twin: {
    updated_at: ISO;
    params: { key: "SI" | "SG" | "beta" | "EGP" | "meal_rate" | "dawn"; label: string; unit: string;
              mean: number; p10: number; p90: number; population_median: number; trend_7d: number[] }[];
    fit: { mard_24h: number; coverage_80_24h: number };
  };
}

// GET /api/patients/{id}/fhir -> FHIR R4 Bundle

// GET /api/patients/{id}/timeline?from=ISO&to=ISO   (default: now-24h .. now)
interface Timeline {
  from: ISO; to: ISO;
  cgm: { t: ISO; g: number | null }[];                       // 5-min
  twin: { t: ISO; p10: number; p50: number; p90: number }[]; // filtered twin estimate, 5-min
  hr: { t: ISO; bpm: number }[];                             // 5-min
  hrv: { t: ISO; rmssd: number }[];                          // 5-min (night-weighted)
  steps: { t: ISO; count: number }[];                        // 5-min bins
  sleep: { start: ISO; end: ISO; stage: "wake" | "light" | "deep" | "rem" }[];
  meals: { t: ISO; carbs_g: number; gl: number; items: { food_id: string; name: string; portions: number; carbs_g: number }[] }[]; // logged only
  doses: { t: ISO; drug: string; dose: string; taken: boolean }[];  // logged only
  alerts: Alert[];
  events: { kind: "hyper_l2" | "hypo_l1" | "hypo_l2"; start: ISO; end: ISO; extreme: number }[]; // from CGM
}
interface Driver { feature: string; label: string; value_text: string; contribution: number } // contribution in log-odds, signed
interface Alert {
  id: string; t: ISO; kind: "hyper_2h" | "hypo_1h" | "nocturnal_hypo";
  probability: number; threshold: number;
  outcome: "true_positive" | "false_positive" | "pending"; lead_min: number | null;
  drivers: Driver[]; recommendation: string;
}

// GET /api/patients/{id}/forecast?at=ISO (default now)
interface Forecast {
  at: ISO; step_min: 5; horizon_min: 240;
  quantiles: { t: ISO; p05: number; p25: number; p50: number; p75: number; p95: number }[];
  mechanistic_p50: { t: ISO; g: number }[];
  risk: Risk; drivers: { hyper_2h: Driver[]; hypo_1h: Driver[] };
  state: { glucose: number; insulin_action: number; carbs_on_board_g: number; sulfonylurea_active: boolean; insulin_sensitivity_vs_baseline: number };
}

// POST /api/patients/{id}/whatif
interface WhatIfRequest {
  at?: ISO; horizon_min?: number; // default now, 300
  scenario: {
    meals?: { offset_min: number; items: { food_id: string; portions: number }[] }[];
    replace_planned_meals?: boolean;
    walk?: { offset_min: number; duration_min: number; intensity: "light" | "brisk" };
    skip_dose?: string; shift_dose?: { drug: string; offset_min: number };
    sleep_hours_last_night?: number;
  };
}
interface WhatIfResponse {
  at: ISO;
  baseline: { t: ISO; p10: number; p50: number; p90: number }[];
  scenario: { t: ISO; p10: number; p50: number; p90: number }[];
  metrics: Record<"baseline" | "scenario", { peak: number; nadir: number; min_above_180: number; min_below_70: number; hypo_probability: number; tir: number }>;
  narrative: string[];
}

// GET /api/foods -> { foods: { id: string; name: string; name_hi: string; category: string; serving_desc: string; carbs_g: number; fiber_g: number; protein_g: number; fat_g: number; gi: number; gl: number; source: string }[] }
// GET /api/metrics -> contents of reports/metrics.json (shape below)
// GET /api/cohort/validation -> reports/cohort_validation.json

// WS /api/stream/{id}?from=ISO&speed=120   (speed = simulated seconds per real second)
// server -> client messages:
//  { type: "tick", t, cgm: number|null, hr, steps, hrv: number|null, twin: { p10, p50, p90 }, risk: Risk }
//  { type: "meal", meal } | { type: "dose", dose } | { type: "alert", alert: Alert }
//  { type: "forecast", forecast: Forecast }   // every 15 simulated minutes
//  { type: "end" }
```

`reports/metrics.json` shape:
```ts
interface Metrics {
  generated_at: ISO;
  dataset: { patients: number; days: number; train_patients: number; val_patients: number; test_patients: number; cgm_points: number; subtype_counts: Record<Archetype, number> };
  tasks: Record<"hyper_2h" | "hypo_1h" | "nocturnal_hypo", {
    prevalence: number; auroc: number; auprc: number; brier: number;
    operating_point: { threshold: number; sensitivity: number; precision: number; alerts_per_patient_day: number; median_lead_min: number };
    calibration: { pred: number; obs: number; n: number }[];
    lead_time_hist: { min: number; count: number }[];
  }>;
  ablation: { model: "cgm_linear" | "ml_no_twin" | "twin_only" | "hybrid"; hyper_2h_auroc: number; hypo_1h_auroc: number; nocturnal_hypo_auroc: number; hyper_2h_auprc: number; hypo_1h_auprc: number }[];
  forecast: { horizons_min: number[]; rmse: number[]; mard: number[]; coverage_80: number[]; parkes: { horizon_min: number; A: number; B: number; C: number; D: number; E: number }[]; baseline_rmse: number[] };
  top_features: { task: string; feature: string; label: string; mean_abs_contrib: number }[];
}
```

Static demo mode: `pratibimb export-demo --out web/public/demo` writes `clock.json`, `cohort.json`, `patients/{id}.json`, `timeline/{id}.json` (now−7d..now+3d), `forecast/{id}.json`, `foods.json`, `metrics.json`, `validation.json`, and a few precomputed `whatif/{id}/{preset}.json` presets (e.g. `swap-rice-for-millet-roti`, `walk-15-after-dinner`, `skip-glimepiride`, `short-sleep`). The web app uses the live API when `NEXT_PUBLIC_API_BASE` is reachable and falls back to `/demo/*` otherwise (with a visible "offline demo data" badge; What-If limited to presets offline).

## 6. Web app (Next.js) — product & design direction

Stack: Next.js 15 App Router + TypeScript + Tailwind CSS v4 + shadcn/ui (Radix: **Sheet**, Dialog, Tabs, Tooltip, Command, Slider, Switch, Popover) + **Framer Motion** (`motion`) + **Lenis** smooth scroll on the landing + visx or hand-written D3/SVG charts (no generic chart-library look) + lucide icons (sparingly) + React Three Fiber only if it earns its place.

### Visual direction — "clinical editorial", not "AI startup"
References in spirit: godly.website / awwwards-level editorial sites, medical instrument UIs, ECG graph paper, Swiss typography. **Avoid** the generic AI look: no purple-blue gradients, no glassmorphism soup, no sparkles/robots/brains, no emoji, no centered-everything hero with a gradient blob, no lorem ipsum, no fake testimonials or fake logos.
- Palette (light): paper `#F3F0E8`, ink `#15140F`, muted `#6E6A60`, hairline `#DAD4C6`, panel `#FBFAF6`. Accent: **vermilion `#D9481C`** (brand, used sparingly). Clinical range colours (AGP-consistent, muted): very low `#8E1B2C`, low `#C8324A`, in range `#2F7D5B`, high `#D99A1E`, very high `#C2561A`. Twin/forecast ink: deep indigo `#2B3A67` with translucent bands.
- Dark console theme: background `#0E0E0C`, panel `#161613`, ink `#ECE8DE`, same accents tuned for contrast. Theme toggle; respect `prefers-color-scheme`.
- Type: display **Instrument Serif** (incl. italic) for headlines; UI **Inter Tight** (or Geist); numerals **JetBrains Mono / Geist Mono** with tabular figures; Devanagari wordmark **Tiro Devanagari Hindi** or Noto Serif Devanagari for "प्रतिबिम्ब". Load via `next/font/google`.
- Texture: subtle paper grain, 1-px hairline grids, graph-paper (ECG-style) background in chart areas, generous whitespace, asymmetric layouts, numbered section labels (`01 — Record`).
- Logo: hand-built SVG — a glucose waveform and its mirror reflection across a horizontal axis (the twin), inside a thin circle. Favicon + OG image from it.
- Motion (Framer Motion): staggered text reveals (split lines), chart lines drawing on (pathLength), layout/shared-element transition from cohort card → patient view, number tickers, live "heartbeat" pulse on streaming values, Sheet slide-ins, scroll-linked sections on landing (sticky storytelling), subtle parallax on imagery, cursor-aware hover on cards. Respect `prefers-reduced-motion`.
- Photos: optional, landing only, max 3–4, **Pexels only** (free licence), Indian context (thali/meal, clinician, CGM sensor on arm, morning walk). Save to `web/public/photos/` with `CREDITS.md` (photographer + URL). If you can't reliably fetch real Pexels images, skip photos — typography + real data visualisation carry the design.

### Pages
1. **`/` Landing** — hero: the wordmark, one-line promise ("A living reflection of a person with diabetes — it sees the spike two hours before it happens."), and a live animated canvas/SVG where a patient's CGM trace and its twin's reflection converge (real data from demo JSON). Sections: 01 The problem (India burden, cited); 02 How the twin works (Record → Sense → Mirror → Foresee, sticky scroll with diagrams of the model); 03 What-If teaser (interactive mini: swap white rice for bajra roti and watch the curve change, using a precomputed preset); 04 Evidence (numbers pulled from metrics.json, ablation chart); 05 Built for India (ABDM/FHIR, Indian foods, INSPIRED subtypes, sulfonylurea safety); 06 Architecture; 07 Team (Yashvardhan Thanvi, Devesh Jain — BIT Mesra, Jaipur campus); CTA → "Open clinician console". Footer: data is synthetic, not a medical device, licence, GitHub link.
2. **`/console`** — Cohort triage: header with demo clock; KPI strip (patients, high-risk now, alerts open, cohort TIR); sortable/filterable list (risk, subtype, meds) of patient rows/cards with 24-h sparkline in range colours, last glucose + trend arrow, risk chips, TIR bar; search (Command palette ⌘K).
3. **`/console/patient/[id]`** — the virtual patient:
   - Header: synthetic name, age/sex, ABHA, inferred subtype, meds; buttons: "EHR (FHIR)" opens a **Sheet** with labs/conditions/meds/genetics and raw FHIR JSON viewer; "Live" toggle starts WS replay (speed control 60×/120×/300×).
   - Main chart: last 24 h CGM dots/line + twin band + **forecast cone** (p05–p95, p25–p75) to +4 h + vertical "now" line; markers for meals (with carbs), doses, walks; sleep shading; threshold bands 70/180/250; hover crosshair with tooltip; zoom 6h/24h/3d.
   - Risk panel: three gauges/meters (hyper 2 h, hypo 1 h, nocturnal hypo tonight) with calibrated probability and plain-language driver list (SHAP) — "Why the twin is worried".
   - Alert feed: issued alerts with time, probability, lead time, outcome, recommendation.
   - Physiology panel ("Inside the twin"): S_I, β, EGP, dawn effect — posterior mean with p10–p90 bars vs population median, 7-day trend sparklines; a small schematic of the compartments that lights up as states change.
   - Wearables: hypnogram for last night, HRV vs baseline, HR, steps.
   - AGP (14-day ambulatory glucose profile) percentile chart + TIR stacked bar (standard clinical report).
   - **What-If Lab** (Sheet or dedicated tab): food picker (Command search over Indian foods with Hindi names, portions), walk (offset/duration/intensity), dose skip/shift, last-night sleep slider → side-by-side curves (baseline vs scenario bands) + metric deltas + narrative bullets. Clinician can "Save as advice" (local state) → appears as a care-plan note.
4. **`/console/model`** — Model card: dataset card, validation charts (cohort realism), task metrics, ablation bar chart, calibration curves, lead-time histogram, Parkes error-grid zone shares, limitations & intended use.
5. **`/about`** optional: architecture diagram (SVG), team, links.

Quality bar: production-grade code (typed API client, loading/empty/error states, skeletons, no console errors, responsive to 360 px, keyboard accessible, Lighthouse-friendly), `npm run build` clean, ESLint clean.

### 6.1 DESIGN OVERRIDE (user directive, 12 Oct 2026 — supersedes the palette/typography/visual direction above)
The user rejected the first UI. **Primary reference: https://obliqq.framer.ai/ ("OBLIQ.in") — reverse-engineer its UI language and apply it to the landing page AND the clinician console.** Secondary references for craft and motion: https://www.llmslim.app (the user's own site), aside.com, crazyui.com, godly.website. Keep the page structure/features of §6 pages; change the look.

Measured OBLIQ tokens (from its live CSS):
- Font: **Open Runde** (rounded Inter-based sans, SIL OFL — get the woff2 files from github.com/lauridskern/open-runde, self-host in `web/public/fonts/`). Weights 400/500/600/900. Headlines 900 or 600 with tight tracking (≈ −0.03em; e.g. 40 px → −1.2 px; 28 px → −0.84 px). Display headline on landing ~64–80 px, 2 lines, centred, very tight leading.
- Ink: `#1A1615` (headings, primary buttons), body `#453F3D`, muted `#757170`, warm brown accent text `#614A44`. Positive delta green `#00A82D` (tiny chips only).
- Surfaces: page white `#FFFFFF`, warm beige `#F0EAE5`, `#F4F1EE`, `#F9F8F8`; frosted panels `rgba(255,255,255,0.7)` + `backdrop-filter: blur(10px)` (nav pill, overlay cards); dark section/CTA `#1A1615`.
- Hero sky: a **real sky/cloud photograph** (Pexels/Unsplash, free licence — NOT Shutterstock, which is paid) with soft drifting clouds on both edges, blended into a vertical fade `#9CC1E7 → #EDDFD0` (sky blue to warm sand) — later sections reuse `#B7D5F1 15% → #F4E6DA 100%`. This is atmospheric photography, not a synthetic "AI gradient"; no blue-green/purple neon gradients anywhere.
- Radii: pills 100 px / 1000 px (buttons, chips, nav), cards 32/24/20/16 px, small 10–11 px. Shadows: very soft warm `rgba(97,74,68,0.06–0.10) 0 4px 50px 0`; layered crisp shadows for floating UI mockups.
- Buttons: primary = black pill `#1A1615`, white 15–16 px/600 text, subtle hover lift + arrow nudge; secondary = white/frosted pill with hairline.
- Section anatomy: small UPPERCASE eyebrow (e.g. "HOW THE TWIN WORKS", letter-spaced, muted) → two-line H2 (second line lighter/muted) → short paragraph → black pill CTA → a large product visual. Product visuals = the real console rendered inside a big white rounded frame floating on the sky/beige backdrop with depth shadow (like OBLIQ's dashboard hero), with mobile + web device pairing.
- OBLIQ patterns to reproduce: centred hero with floating dashboard below that rises and tilts into place on scroll; logo marquee row → replace with a "built on" row of real tech/standards (FHIR R4, ABDM, LightGBM, FastAPI, Next.js…) — no fake customer logos; tabbed feature section where tabs (e.g. "Forecast · Alerts · What-If · Physiology") swap the product visual with a smooth crossfade/slide; bento feature grid with small illustrated UI fragments; testimonial carousel → replace with "clinical scenarios" cards (no fake quotes); pricing → replace with "Evidence" (metrics.json numbers) or omit; final CTA band on sky background; clean multi-column footer.
- Motion & effects (Framer Motion + light shaders): word-by-word blur-in headline reveal, scroll-linked mockup rise/tilt/scale (useScroll/useTransform), parallax drifting clouds (2–3 depth layers), magnetic/lift hovers on cards and buttons, tab underline `layoutId` transitions, number tickers, chart lines drawing on, staggered bento entrance, smooth Lenis scroll, a subtle WebGL/OGL shader (soft noise/grain or light caustics over the sky — keep it tasteful and cheap, disable on reduced-motion/low-power). No slop: no generic glow blobs, no glassmorphism everywhere, no emoji, no stock "AI brain" imagery.
- Console in the same language: light warm-white app shell, left sidebar with rounded icon nav (like OBLIQ's dashboard: "Hello, Dr. …" greeting header, search pill, KPI cards with tiny delta chips, soft charts). Clinical range colours stay (muted) but chart chrome adopts OBLIQ's light-blue/beige softness. Dark mode optional; light is primary.
- Photos: Pexels/Unsplash only, credited in `web/public/photos/CREDITS.md`; Indian context where people/food appear.
- This design language also applies to every other app we build for the user's hackathons.

## 7. Non-goals / honesty
- Not a medical device; synthetic data only; clinical recommendations are illustrative and say so.
- Don't claim validation on real patients. Say "validated on held-out synthetic patients generated by a different (richer) simulator".
- No LLM dependency is required for core features.
