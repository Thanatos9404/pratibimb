# Data card — Pratibimb synthetic T2D cohort

> **Everything here is synthetic.** No real patient data were used to build or train Pratibimb (a separate,
> after-the-fact external validation on open, de-identified real CGM data is documented in
> [REAL_DATA.md](REAL_DATA.md); see section 5b). Names are random combinations of
> common Indian given names and surnames; ABHA numbers use the obviously-synthetic prefix
> `91-0000-` and a local identifier system. Genetic markers are synthetic and illustrative.

## 1. Summary

| | full profile |
|---|---|
| patients | 240 (patient-level split 70/15/15 by hidden archetype: train 168 / val 36 / test 36) |
| duration | 28 days from 2026-09-21 (Monday) 00:00 IST, demo clock = day 21, 19:30 |
| streams | CGM (5 min), heart rate (5 min), HRV RMSSD (5 min, night-weighted), steps (5 min), sleep stages (5 min), logged meals, logged doses |
| static | demographics, 2 years of labs, comorbidities, medications, genetic markers, FHIR R4 bundle |
| generator | `engine/pratibimb/cohort` (`pratibimb generate`), deterministic seed 20261020 |

## 2. How a patient is generated

1. **Archetype** (truth-only label) — Asian-Indian T2D subgroups from the INSPIRED cohort
   (Anjana et al., *BMJ Open Diabetes Research & Care* 2020): IROD 39 %, SIDD 26 %, MARD 22 %,
   SIRD 13 % (rounded). Archetypes shape age, BMI, central adiposity, insulin sensitivity, beta-cell
   function, pre-treatment fasting glucose, triglycerides, dawn effect and medication mix
   (SIDD: low beta function, more SU/insulin; SIRD: very insulin resistant, includes "thin-fat"
   patients with normal BMI but high waist-to-height ratio; MARD: older, milder; IROD: obese).
   Asian BMI cut-offs are used (overweight ≥ 23, obese ≥ 25 kg/m²). Parameter values are illustrative
   choices that reproduce the qualitative cluster descriptions, not fits to INSPIRED data.
2. **Medications** — metformin (~88 % unless eGFR < 30), sulfonylureas (glimepiride / gliclazide MR /
   gliclazide BD), DPP-4 inhibitors (sitagliptin / vildagliptin / teneligliptin), SGLT2 inhibitors
   (dapagliflozin / empagliflozin) and basal insulin (glargine), with archetype-specific
   probabilities. On-treatment fasting glucose = archetype pre-treatment level minus per-drug effects.
   Patients whose simulated time below 70 mg/dL exceeded 8 % had their SU / insulin dose stepped down
   (mimicking clinician titration) before the observation window.
3. **Lifestyle** (`cohort/lifestyle.py`) — region (North/South/West/East) meal templates built from the
   food table; breakfast, optional mid-morning chai, lunch, evening chai + snack, **late dinner
   (≈ 20:00–22:45)**, random extra snacks, bedtime milk; weekend shifts; festival / celebration days with
   sweets; religious fasting practice (Ekadashi-style, weekly fast, a 9-day Navratri-style window — dates
   are synthetic) with a probability of still taking the SU while fasting (a classic hypoglycaemia
   trap); morning-walk and post-dinner-walk habits; office sitting and commute; sleep with ~90-min
   cycles, brief awakenings and occasional short nights; latent work stress and acute stress;
   illness episodes (2–5 days) in ~30 % of patients.
4. **Truth physiology** (`cohort/truth.py`) — an extended minimal model that is deliberately **richer
   than the twin**: insulin sensitivity drifts (Ornstein–Uhlenbeck), follows a diurnal rhythm, drops
   after short nights, during illness and stress and rises after exercise; two-pathway gut absorption
   (fast/slow fractions from GI; fat, protein and fibre delay emptying; per-meal noise); hepatic insulin
   suppression of EGP; counter-regulation below 60 mg/dL; an early-night EGP nadir and a dawn rise;
   glucose-dependent incretin effect for DPP-4 inhibitors; patient-specific SU sensitivity and
   CKD-prolonged SU half-life; day-to-day basal-insulin absorption variability; patient-specific
   interstitial lag (6–12 min). Basal EGP is calibrated so the pre-dawn fasting level matches the
   patient's on-treatment fasting set-point; mean glucose (and HbA1c) then **emerge** from meals,
   insulin response and drugs.
5. **Sensors** — CGM: patient lag (from the truth model), 14-day sessions with 60-min warm-up and a
   noisier first day, calibration drift, AR(2) noise, compression lows during ~12 % of nights,
   dropouts, integer rounding, 40–400 mg/dL range. Wrist wearable: HR coupled to sleep stage, steps,
   stress, illness and meals with evening charging gaps; HRV (RMSSD) higher in deep sleep, lower with
   activity/stress/illness/short sleep/hyperglycaemia, reported mostly during sleep; sleep staging with
   stage confusion.
6. **Logging behaviour** — main meals logged with 90–99 % probability, snacks 60–90 % (≈ 15 % of snacks
   never logged); logged portions carry ≈ ±30 % error (rounded to half portions); logged times ± 8 min;
   doses logged as taken/missed with false ticks (≈ 4 % of taken doses unticked, 20 % of missed doses
   ticked as taken).
7. **EHR** (`cohort/ehr.py`) — HbA1c from the simulated mean glucose via ADAG (eAG = 28.7 × HbA1c −
   46.7; Nathan et al., *Diabetes Care* 2008) plus an individual glycation gap (SD 0.3 %) and assay
   noise, with a 2-year history; fasting glucose; triglycerides worsening with insulin resistance; HDL,
   total/LDL cholesterol; creatinine via the CKD-EPI 2021 equation from eGFR; ALT (higher with NAFLD);
   urine ACR; BP; anthropometrics; fasting C-peptide for ~35 % of patients. TyG index = ln(TG × FPG / 2)
   is derived (Simental-Mendía et al., 2008; widely validated as an insulin-resistance surrogate).
   Conditions (SNOMED CT): T2D 44054006, hypertension 38341003, dyslipidaemia 370992007, steatosis of
   liver 197321007, CKD 709044004, obesity 414916001 (Asian cut-off), diabetic peripheral neuropathy
   230572002, hypothyroidism 40930008. Genetics: TCF7L2 rs7903146 genotype (T allele slightly enriched
   in SIDD; used only as a weak prior on beta-cell function) and a synthetic PRS percentile.
8. **FHIR R4** (`cohort/fhir.py`) — one `collection` Bundle per patient: Patient (synthetic ABHA),
   Condition, Observation (LOINC 4548-4 HbA1c, 1558-6 FPG, 2571-8 TG, 2085-9 HDL, 2093-3 TC, 13457-7 LDL,
   2160-0 creatinine, 62238-1 eGFR, 1742-6 ALT, 9318-7 UACR, 1986-9 C-peptide, 39156-5 BMI, 8280-0 waist,
   29463-7 weight, 8302-2 height, 85354-9 BP panel with 8480-6/8462-4), MedicationStatement, Device and
   wearable summaries (8867-4 heart rate, 41950-7 steps/24 h, 93832-4 sleep duration; CGM/HRV summaries
   use a local code system because we are not certain of standard codes).

## 3. Indian food table (`engine/pratibimb/foods/indian_foods.csv`)

73 items with Hindi (Devanagari) names, serving descriptions (katori / piece / cup with grams),
available carbohydrate, fibre, protein, fat, GI and GL (= carbs × GI / 100). The `source` column is
honest about provenance:

* `IFCT2017(approx);GI:IntlGITables(Atkinson)` — composition approximated from Indian Food Composition
  Tables 2017 (NIN) values and GI taken from the International Tables of Glycemic Index (Atkinson et al.;
  2008 edition values, updated tables 2021) for the matching generic food (e.g. boiled white rice,
  chapatti, kidney beans, chickpeas, banana, mango, apple, milk, white bread);
* `IFCT2017(approx);GI:estimate` — composition approximated, GI estimated;
* `estimate(recipe-based)` — both composition and GI estimated from typical recipes (most composite
  Indian dishes, sweets and snacks).

Values were compiled from general reference knowledge, not transcribed row-by-row from the source
tables, and must be verified before any clinical or nutritional use.

## 4. Realism checks (`reports/cohort_validation.json`)

Full profile, CGM over days 1–27 (day 0 is twin warm-up):

| check | result | target |
|---|---|---|
| cohort-median TIR 70–180 | 68.7 % (10th–90th pct 30.6–85.2 %) | ~55–75 % |
| CV | median 29.0 %; 78 % of patients within 20–36 % | mostly 20–36 % |
| hypoglycaemia concentrated in SU / insulin users | 97 % of truth hypo episodes occur in the 118 SU/insulin users | yes |
| mean CGM glucose vs ADAG eAG from HbA1c | r = 0.91, median difference −1.9 mg/dL | consistent |
| doses titrated for >8 % time <70 before the window | 33 patients | — |

Hypoglycaemia by medication class (truth episodes ≥15 min <70): neither SU nor insulin (n = 122)
0.06 episodes/patient-week, 4 % of patients with any, nocturnal 0.25 % of nights; sulfonylurea (n = 80)
2.16/week, 71 %, nocturnal 2.5 % of nights, CGM TBR median 1.9 %; basal insulin (n = 38) 1.23/week, 40 %,
nocturnal 4.3 % of nights.

Per archetype (CGM TIR IQR; HbA1c IQR): SIDD 31–69 % (7.1–8.9 %), SIRD 43–77 % (6.9–8.6 %), MARD 70–83 %
(6.5–7.5 %), IROD 56–81 % (6.5–8.1 %). Post-prandial 2-h rise (truth, meals > 20 g carbs): breakfast
median 96 mg/dL, lunch 122, evening snack 45, dinner 112. Level-2 hyperglycaemia episodes: median 1.4 per
patient-day. CGM MARD vs plasma truth ≈ 8.5 %.

Inferred-subtype agreement with the hidden archetype: 51 % (4 classes; chance ≈ 25–40 % given class
imbalance) — the subtype shown in the UI is a rough phenotype, not a diagnosis.

## 5. Known gaps

* Diet, activity and sleep patterns are plausible caricatures, not survey-calibrated distributions.
* Festival/fasting calendars are synthetic; Ramadan is not represented in the 28-day window.
* No other chronic-disease dynamics (e.g. retinopathy progression), no hospitalisations, no type 1 /
  LADA / MODY, no pregnancy.
* The CGM error model targets a MARD of roughly 8–10 % versus plasma truth; real sensors differ by
  brand and wear day.

## 5b. Synthetic vs real (external check, `reports/real_validation.json`)

The same label rules were applied to synthetic CGM and to 90 real records (CGMacros + non-insulin
ShanghaiT2DM), both on a 15-min grid after the first 24 h. The synthetic cohort has **2.479×** the real rate
of ≥180 mg/dL-within-2 h windows and **5.439×** the rate of >250 mg/dL-within-2 h windows. The SD of its
30-min CGM change is **1.532×** the real one. The synthetic cohort is therefore much more hyperglycaemic and
volatile than these real records (which include healthy and prediabetic CGMacros participants and mostly
well-controlled, non-insulin T2D). This is a known gap to close when the simulator is next recalibrated.
Real data are not redistributed: derived files live in the git-ignored `data/real/` (CGMacros is CC BY-NC-SA
4.0; ShanghaiT2DM is CC BY 4.0).

## 6. References (cited for design choices; claims hedged)

* Anjana RM et al. Novel subgroups of type 2 diabetes and their association with microvascular
  outcomes in an Asian Indian population (INSPIRED). *BMJ Open Diabetes Res Care* 2020.
* Anjana RM et al. Metabolic non-communicable disease health report of India: the ICMR-INDIAB
  national cross-sectional study (ICMR-INDIAB-17). *Lancet Diabetes Endocrinol* 2023 — diabetes
  prevalence 11.4 %, prediabetes 15.3 %.
* Nathan DM et al. Translating the A1C assay into estimated average glucose values (ADAG).
  *Diabetes Care* 2008.
* Simental-Mendía LE et al. The product of fasting glucose and triglycerides as surrogate for
  identifying insulin resistance in apparently healthy subjects. *Metab Syndr Relat Disord* 2008.
* Battelino T et al. Clinical targets for continuous glucose monitoring data interpretation:
  recommendations from the international consensus on time in range. *Diabetes Care* 2019.
* Longvah T et al. Indian Food Composition Tables 2017. National Institute of Nutrition, Hyderabad.
* Atkinson FS et al. International tables of glycemic index and glycemic load values 2021: a systematic
  review. *Am J Clin Nutr* 2021 (and the 2008 edition in *Diabetes Care*).
* Sleep restriction and insulin sensitivity: experimental studies (e.g. Donga et al., *J Clin Endocrinol
  Metab* 2010, one night of partial sleep restriction) report reduced insulin sensitivity on the order
  of 15–25 %; used only to set the order of magnitude of the twin's sleep modifier.
* Bergman RN et al. Quantitative estimation of insulin sensitivity (minimal model). *Am J Physiol* 1979;
  Dalla Man C et al. Meal simulation model of the glucose-insulin system. *IEEE TBME* 2007.
* Parkes JL et al. A new consensus error grid to evaluate the clinical significance of inaccuracies in
  the measurement of blood glucose. *Diabetes Care* 2000; Pfützner A et al. Technical aspects of the
  Parkes error grid. *J Diabetes Sci Technol* 2013.
* Bergenstal RM et al. Glucose Management Indicator (GMI). *Diabetes Care* 2018.
* Inker LA et al. New creatinine- and cystatin C-based equations to estimate GFR without race
  (CKD-EPI 2021). *N Engl J Med* 2021.
