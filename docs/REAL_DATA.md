# Real-data external validation

Pratibimb was built and trained on **synthetic** patients. This page documents how the unchanged twin and
risk layer were tested on **real, open, de-identified CGM records**: what data, how each stream was mapped
into Pratibimb's patient format, every assumption, and the licence boundary. The results are in
[`reports/real_validation.json`](../reports/real_validation.json) (web-facing summary) and
[`reports/real_validation_detail.json`](../reports/real_validation_detail.json) (per-cohort, cold start,
bootstrap CIs). Both files contain aggregate metrics only.

```bash
# GlycoTwin repo with its harmonised store built (python -m glycotwin.store), read-only
python -m pratibimb validate-real --glyco-path ../DigitalTwin_HappiestHealth      # ~6 min, 6 workers
#   --reuse      reuse cached twin runs in data/real/twin
#   --no-web     do not copy the JSON to web/public/demo/real_validation.json
```

Code: `engine/pratibimb/realdata/adapter.py` (data -> records) and `engine/pratibimb/realdata/validate.py`
(twin runs, scoring).

## 1. Data and licences

| dataset | source | licence | used here |
|---|---|---|---|
| CGMacros v1.0.0 (Gutierrez-Osuna et al., 2025; doi:10.13026/3z8q-x658) | PhysioNet | **CC BY-NC-SA 4.0** | all 45 participants (15 healthy, 16 prediabetes, 14 T2D by HbA1c), ~10 days each |
| ShanghaiT2DM (Zhao et al., *Sci Data* 2023; doi:10.6084/m9.figshare.20444397.v3) | figshare | **CC BY 4.0** | 45 of 109 CGM records (42 people), those with no insulin at all |

Both are read through the harmonised store of the GlycoTwin project (same team, MIT code; `data/processed/*.parquet`
plus the CGMacros minute-level CSVs in `data/raw/`). Nothing from the GlycoTwin package is imported at runtime;
the small CGMacros parsing rules are ported with attribution. The adapter refuses to run if the store is missing
(GlycoTwin's own loader would silently fall back to its synthetic demo patients).

**Licence boundary.** CGMacros is NonCommercial-ShareAlike. Every derived file (converted records, twin runs,
per-window features) is written under `data/real/`, which is git-ignored and carries a `LICENCE-NOTE.txt`.
Nothing derived from CGMacros is committed or shipped in the Apache-2.0 repository or the web demo; only
aggregate metrics (AUROC, RMSE, counts) are published. Pratibimb's code remains Apache-2.0. No model trained on
CGMacros is saved: the cross-validated risk models of section 4 are refitted in memory and discarded.

## 2. Mapping into Pratibimb records

Pratibimb's clock is "minutes since the record origin", 5-minute samples, decision points every 15 minutes.

| item | mapping | assumption / caveat |
|---|---|---|
| record origin | midnight of the first day, shifted by (first timestamp minute-of-day mod 15) | puts every GlycoTwin 15-min timestamp exactly on a Pratibimb decision point; ShanghaiT2DM clocks shift by at most 14 min (CGMacros: 0) |
| record length | padded with missing data to whole days | the twin just predicts through gaps |
| **CGM, CGMacros** | Dexcom G6 reading at every 5-min mark of the minute-level file | Dexcom chosen over Libre Pro (GlycoTwin finding: Libre Pro trace implausibly low for several participants); values outside 40–400 mg/dL dropped |
| **CGM, ShanghaiT2DM** | FreeStyle Libre H, native 15 min, placed on every third 5-min sample | the EnKF updates only when a reading exists |
| meals, CGMacros | exact logged minute; carbs/protein/fat/fibre × "Amount Consumed"; carbs recomputed from energy when carbs alone exceed kcal + 100 (GlycoTwin rule) | macros are photo-based estimates |
| meals, ShanghaiT2DM | GlycoTwin's carb estimate from the free-text meal record, at the logged time | approximate; meals logged as "content not recorded" use the patient's median meal (GlycoTwin imputation, flagged) |
| meal absorption | Pratibimb `meal_tau(GI, fat, protein, fibre)` with **GI fixed at 55** (mixed meal); GL = 55 × carbs / 100 | neither dataset records GI; ShanghaiT2DM has carbs only, so fat/protein/fibre are 0 there |
| meal slot | CGMacros "Meal Type" (breakfast/lunch/dinner; snacks 15:30–18:30 = evening snack); ShanghaiT2DM by clock time (04:00–10:30 breakfast, 10:30–15:30 lunch, 15:30–18:30 evening snack, 18:30–23:00 dinner) | feeds the habitual-meal prior used for "meal unknown" forecasts |
| heart rate (CGMacros) | Fitbit HR averaged over each 5-min sample | personal resting baseline computed causally as in the synthetic cohort |
| activity (CGMacros) | METs = activity kcal/min × 60 / weight (GlycoTwin rule) → **steps proxy** steps/min = clip((METs − 1.5) × 70, 0, 180) | 3 METs ≈ brisk walk ≈ 105 steps/min; a heuristic, not measured steps |
| HRV, sleep stages | not available in either dataset → missing | sleep-related twin modifiers stay neutral; sleep/HRV features are missing |
| ShanghaiT2DM wearables | none → HR missing, steps 0 | |
| **EHR priors** | HbA1c, FPG, TG → TyG; BMI; eGFR; fasting C-peptide (nmol/L × 3.02 → ng/mL, ShanghaiT2DM) | same `ehr_prior` as for synthetic patients, unchanged |
| waist | not recorded → **BMI path**: WHtR = clip(0.22 + 0.012 × BMI, 0.40, 0.75) | heuristic (BMI 25 → 0.52, 30 → 0.58, 35 → 0.64) |
| diabetes duration | ShanghaiT2DM: recorded; CGMacros: not recorded → **default by diagnosis**: healthy / prediabetes 0 y, T2D 5 y | |
| missing labs | HbA1c missing → (FPG + 46.7)/28.7; FPG missing → 28.7 × HbA1c − 46.7; both missing → status defaults; TG missing → 150 mg/dL; eGFR missing → 90 | ShanghaiT2DM: HbA1c imputed for 7 records, FPG 3, TG 13; eGFR missing for 64 of 90 records |
| medications, CGMacros | none recorded → twin runs drug-free | the EnKF absorbs any drug effect into the parameters |

### ShanghaiT2DM medication mapping (non-insulin records only)

Pratibimb's drug catalogue has metformin, three sulfonylureas, DPP-4 and SGLT2 inhibitors and basal glargine.
Rapid/premixed/pump insulin is not modelled, so **every record with any insulin was excluded** (64 of 109;
8 of them are marked "not on insulin" in the summary sheet but have insulin entries in the CGM-period log).

| logged agent | Pratibimb drug | dose equivalence |
|---|---|---|
| metformin | metformin | mg as logged (g → mg) |
| gliclazide 30/60/90/120 mg | gliclazide MR | as logged |
| gliclazide (other doses) | gliclazide (immediate release) | as logged |
| glimepiride | glimepiride | as logged |
| **repaglinide** (glinide) | **gliclazide IR (short-acting SU)** | 1 mg ≈ 80 mg |
| nateglinide (glinide) | gliclazide IR | 120 mg ≈ 80 mg |
| gliquidone / glipizide | gliclazide IR | 30 mg ≈ 80 mg / 5 mg ≈ 80 mg |
| sitagliptin, linagliptin and other DPP-4 inhibitors | sitagliptin | adherence trace only (dose not used) |
| dapagliflozin, canagliflozin, empagliflozin | dapagliflozin | adherence trace only |
| **acarbose, voglibose, miglitol** (α-glucosidase inhibitors) | no drug; **slower absorption** | any meal within ±45 min of a logged AGI dose gets meal τ × 1.5 |
| pioglitazone, liraglutide | not modelled (1 and 4 records) | left to the EnKF parameter drift |

Dose times come from the CGM-period oral-medication log. A regular schedule per drug (clock-hour slots seen on
≥ 30 % of days, at least twice) is inferred so that the forecast can assume future doses as Pratibimb does for
synthetic patients; logged doses within 2 h of a slot are matched to it.

## 3. What was run

* The **unchanged twin** (extended Bergman minimal model + EnKF, 64 members, EHR priors, filter settings fixed on
  synthetic validation patients) was run over all 90 records. At every 15-min decision point we kept the
  +120-min ensemble forecast (habitual-meal prior; future meals unknown) and Pratibimb's twin features, plus
  P(any reading ≥ 180 within 2 h) for the ≥180 task.
* **Forecast scoring** uses GlycoTwin's 15-min timestamps after each record's first 24 h (twin warm-up, as in
  the synthetic evaluation), keeping only points where the twin, GlycoTwin's LightGBM, persistence, linear
  extrapolation and all three targets exist, so every method is scored on identical points. GlycoTwin's numbers
  are its own out-of-fold predictions (`oof_predictions.parquet`) at those timestamps ("reproduced"); its models
  were trained on all 154 records, including insulin users, with patient-level 5-fold CV. The twin's 80 %
  interval uses the widening factors fitted on synthetic validation patients, unchanged.
* **Risk ablation** uses GlycoTwin's 74 features and its person-level folds (`models/folds.json`), LightGBM with
  GlycoTwin's fixed settings (250 rounds, no early stopping, nothing tuned on test folds), with and without
  Pratibimb's twin features. Events: `ge180_2h` = current < 180 and any CGM ≥ 180 within 120 min;
  `gt250_2h` = current < 250 and any CGM > 250 within 120 min (≥ 6 of 8 future readings present).
* **Transfer**: the synthetic-trained Pratibimb hybrid `hyper_2h` model, applied with no retraining or
  recalibration.

## 4. Results (REAL data, from `reports/real_validation.json`, generated 2026-10-16)

90 records (87 people, 1,051 recorded days). Excluded: 64 insulin-treated ShanghaiT2DM records.

**Forecast**: identical 89,977 points (15-min timestamps after each record's first 24 h).

| horizon | twin RMSE | twin MARD | twin 80 % coverage | twin Parkes A | persistence RMSE | linear RMSE | GlycoTwin LightGBM RMSE (its OOF predictions) |
|---|---|---|---|---|---|---|---|
| 30 min | 27.3 | 13.6 % | 0.7818 | 88.78 % | **18.52** | 23.23 | **14.06** |
| 60 min | 30.84 | 15.39 % | 0.7636 | 84.6 % | 28.83 | 45.96 | **21.7** |
| 120 min | 34.51 | 17.22 % | 0.7586 | 80.25 % | 40.6 | 90.61 | **27.87** |

* The physiological twin, run with population/EHR priors and no retuning, beats linear extrapolation at every
  horizon and persistence at 120 min, but **loses to persistence at 30 and 60 min** and to GlycoTwin's
  data-driven LightGBM at every horizon. Its posterior plasma-glucose mean at "now" sits 21.47 mg/dL RMS from the current CGM
  reading (`nowcast_twin_mean_vs_current_cgm` in the detail file; plasma state vs an interstitial reading, with
  filter noise settings chosen for synthetic CGM), and that offset dominates short horizons.
* The interval widening fitted on synthetic patients transfers reasonably: 76–78 % coverage for a nominal 80 %.
* Per cohort (`real_validation_detail.json`): CGMacros twin RMSE 27.6 / 31.51 / 35.78 vs persistence
  20.38 / 30.01 / 40.75; ShanghaiT2DM 27.07 / 30.31 / 33.51 vs 16.95 / 27.9 / 40.48. First 24 h of each record
  (cold start, 4,162 points): twin 29.73 / 34.42 / 38.12.

**Risk** (GlycoTwin's features and person-level folds; same windows for every model):

| event | base rate | windows | baseline AUROC / AUPRC | + twin features AUROC / AUPRC | synthetic-trained Pratibimb model, no retraining |
|---|---|---|---|---|---|
| `ge180_2h` | 0.1304 | 78,970 | 0.8681 / 0.5341 | 0.8703 / 0.5366 | 0.6628 / 0.2363 |
| `gt250_2h` | 0.0246 | 88,585 | 0.9232 / 0.3552 | 0.9235 / 0.3554 | 0.7902 / 0.1543 |

* Person-level bootstrap (200 resamples) of the AUROC gain from twin features: `ge180_2h` −0.0018 to +0.0071,
  `gt250_2h` −0.0078 to +0.0102. **On real data the twin features add no measurable discrimination** on top of a
  strong CGM/meal/activity/EHR feature set (on synthetic data they added +0.013 AUROC for `hyper_2h`).
* The synthetic-trained model transfers poorly (AUROC 0.79 for >250 mg/dL, 0.66 when used to rank ≥180 events,
  which it was not trained for). The twin-only probabilities score 0.6568 (`p_hyper120`, >250) and 0.714
  (`p_ge180_120`, ≥180).
* GlycoTwin's published figure for ≥180 on all 154 records is AUROC 0.875 / AUPRC 0.592; our baseline on the
  90-record non-insulin subset (0.8681 / 0.5341) is consistent with it.

**Synthetic vs real** (same label rules on 15-min CGM; ratio = synthetic / real): ≥180-in-2h event rate
**2.479×**, >250-in-2h event rate **5.439×**, SD of the 30-min CGM change **1.532×**. The synthetic cohort is far
more hyperglycaemic and more volatile than these real records, which explains much of the transfer gap and why the
synthetic headline numbers must not be read as real-world performance.

## 5. Limitations

The `limitations` list in `reports/real_validation.json` is the authoritative summary. In short: population
priors only, no per-patient tuning; plasma-glucose forecast scored against CGM; approximate meals (photo or
text estimates, GI fixed); no waist, sleep or HRV, and no wearables in ShanghaiT2DM; no medication records in
CGMacros; insulin users excluded; 87 people from China and the USA, not India; the transfer model sees 15-min
CGM where it was trained on 5-min CGM. Research prototype, not a medical device.
