# Pratibimb API

FastAPI service exposing the digital twin to the clinician console. Prefix `/api`, JSON, ISO-8601 times
with `+05:30` (IST). Implements the contract in `SPEC.md` section 5 exactly; a few **optional** fields
were added (marked *extra* below) — clients that ignore them keep working.

Run locally:

```bash
cd engine
.venv/Scripts/python -m pratibimb serve --profile full      # or: pratibimb serve --profile small
# -> http://localhost:8000/api/health   (OpenAPI docs at http://localhost:8000/docs)
```

Environment: `PORT` (default 8000), `PRATIBIMB_PROFILE` (`full|small|tiny`), `PRATIBIMB_DATA` (data root,
default `<repo>/data`), `PRATIBIMB_CORS_ORIGINS` (comma-separated, added to `http://localhost:3000`),
`PRATIBIMB_METRICS_DIR` (directory whose `metrics.json`/`cohort_validation.json` take precedence).
Responses ≥1 KB are gzip-compressed.

## Demo clock

The synthetic dataset spans 28 days from `2026-09-21T00:00+05:30`. The console runs at a fixed demo
clock `now` = start + 21 days, 19:30 IST (`2026-10-12T19:30:00+05:30`). All GET endpoints accept an
optional `now=ISO` query parameter (*extra*) to evaluate the view at another time. Data *after* `now`
exists (it is the "future" used by the live replay).

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, version, profile*}` |
| GET | `/api/clock` | `{start, end, now}` |
| GET | `/api/cohort` | `{now, patients: CohortPatient[]}` — all patients (240 in the full profile); cached at the default clock |
| GET | `/api/patients/{id}` | `PatientDetail` |
| GET | `/api/patients/{id}/fhir` | FHIR R4 `Bundle` (type `collection`), `application/fhir+json` |
| GET | `/api/patients/{id}/timeline?from&to` | default `now-24h..now`; window ≤ 14 days |
| GET | `/api/patients/{id}/forecast?at` | 240-min ensemble forecast cone from the synced twin at `at` (default `now`) |
| POST | `/api/patients/{id}/whatif` | `WhatIfRequest` → `WhatIfResponse` |
| GET | `/api/foods` | Indian food table (73 items) |
| GET | `/api/metrics` | `reports/metrics.json` |
| GET | `/api/cohort/validation` | `reports/cohort_validation.json` |
| WS | `/api/stream/{id}?from&speed` | replay; `speed` = simulated seconds per real second (default 120) |

### Semantics worth knowing

* **Risk** (`Risk`): calibrated probabilities from the hybrid LightGBM models at the latest 15-minute
  decision point ≤ the requested time. `nocturnal_hypo` is the bedtime model's probability between the
  bedtime decision (≈15 min after the wearable detects sleep, ≤ 23:45) and 06:00. Between 17:00 and the
  bedtime decision a **provisional** twin-only estimate (ensemble forecast to 06:00 with the habitual
  meal prior, isotonic-calibrated) is returned; otherwise `null`.
  *extra* `nocturnal_source: "bedtime_model" | "twin_provisional" | null`, *extra* `decision_t`.
  `level`: `high` if any probability ≥ its operating threshold (chosen on validation patients),
  `moderate` if ≥ 50 % of it, else `low`.
* **CohortPatient**: 7-day stats are CGM-based over `[now-7d, now]`; `tir_7d/tar_7d/tbr_7d/cv_7d` are
  percentages (0–100), `gmi_7d` is % (GMI = 3.31 + 0.02392 × mean mg/dL). `sparkline_24h` = 96 × 15-min
  CGM means (null where missing). `trend` uses the 15-min CGM slope (±1 / ±2 mg/dL/min cut-offs).
  `open_alerts` = alerts issued ≤ now whose prediction window has not closed. `inferred_subtype` is
  inferred from twin posteriors + EHR (the truth archetype is never exposed). *extra* `split`
  (`train|val|test`) tells the UI whether the patient was held out from training.
* **PatientDetail.twin.params**: posterior ensemble at `now`; display units: `SI` ×10⁻⁴ /min per µU/mL,
  `SG` ×10⁻² /min, `beta` ×10⁻² µU/mL/min per mg/dL, `EGP` mg/kg/min (minimal-model units),
  `meal_rate` × typical, `dawn` % EGP rise at ~06:00. `trend_7d` = 28 points (6-hourly posterior means
  over the last 7 days). `population_median` = cohort median at the demo clock.
  `fit.mard_24h` (%) and `fit.coverage_80_24h` (0–1) score the twin's **one-step-ahead** (5-min)
  predictions against CGM over the last 24 h. *extra* `medications[].drug` = engine drug key (use it for
  what-if `skip_dose` / `shift_dose`).
* **Timeline**: `twin` is the filtered plasma-glucose band (ensemble p10–p90 widened with a 6 % sensor
  calibration term). `hrv` is night-weighted (reported during sleep, rarely when still by day); `hr`
  omits points while the watch is off. `events` are detected on CGM (≥15 min beyond 250 / below 70 /
  below 54). `alerts[].outcome` is `pending` until the alert's window closes relative to `now`.
  *extra* `alerts[].resolves_at`, `alerts[].outcome_final`, `alerts[].lead_min_final` (ground truth
  once resolved — lets an offline replay reveal outcomes), *extra* `meals[].slot`,
  *extra* `risk: {t, hyper_2h, hypo_1h, nocturnal_hypo, level}[]` (15-min series).
* **Forecast**: `quantiles` p05–p95 of the 64-member ensemble with the habitual-meal prior (learned from
  the patient's last 7 days of logged meals) and prescribed doses; interval width recalibrated on
  validation patients. `mechanistic_p50` = deterministic run of the posterior-mean twin with planned
  doses only (no meal prior, no noise). `state.insulin_action` is in 10⁻³ /min; `carbs_on_board_g` is
  the twin's gut glucose; `insulin_sensitivity_vs_baseline` = current posterior SI / the patient's
  7-day median. `drivers` = TreeSHAP contributions (log-odds) of the hybrid models.
* **What-if**: from the twin ensemble at `at` (default `now`), baseline vs scenario with common random
  numbers. Baseline = prescribed doses + habitual-meal prior, unless *extra* `baseline_meals` gives
  explicit planned meals. `replace_planned_meals: true` drops the meal prior (and `baseline_meals`) from
  the scenario. `walk.intensity`: light = 0.5, brisk = 1.0 exercise units. `skip_dose` /
  `shift_dose.drug` accept a drug key (`glimepiride`) or display name; only **future** planned doses are
  affected. `sleep_hours_last_night` sets the twin's next-day insulin-sensitivity modifier. Metrics use
  the scenario median (`min_above_180`, `min_below_70` in minutes, `tir` %), `hypo_probability` = share
  of members with ≥15 min < 70. Unknown `food_id` → 422. Horizon 60–480 min (default 300).
* **WebSocket**: one `tick` per simulated 5 minutes, `meal`/`dose`/`alert` events as their timestamps
  pass, a `forecast` every 15 simulated minutes, `end` at the dataset end. Ticks carry `risk` without the
  provisional nocturnal estimate (cheap path). Errors: `{type: "error", message}`.

## Static demo export

`pratibimb export-demo --profile full --out ../web/public/demo` writes, for 24 curated patients:

```
clock.json  cohort.json  foods.json  metrics.json  validation.json  manifest.json*
patients/{id}.json  timeline/{id}.json (now-7d..now+3d)  forecast/{id}.json
forecasts/{id}.json*   hourly forecasts now+1h..now+24h for offline replay
fhir/{id}.json*        FHIR bundle for the EHR sheet
whatif/{id}/{preset}.json  whatif/{id}/index.json*  (preset ids, labels and the request used)
```

Presets per patient: `swap-rice-for-millet-roti`, `walk-15-after-dinner`, `short-sleep`, and
`skip-<drug>` for the patient's main hypoglycaemia-relevant drug (e.g. `skip-glimepiride`,
`skip-gliclazide-mr`, `skip-glargine`, `skip-metformin`) — read `index.json` for the list.
`manifest.json` explains why each demo patient was chosen (scenarios at the demo clock); model
metrics always refer to the full held-out test split.
