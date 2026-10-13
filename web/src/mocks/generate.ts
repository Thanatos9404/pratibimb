/**
 * DEV FIXTURE GENERATOR — `npm run mocks`
 *
 * Writes physiologically plausible mock data to `public/mock/` using the same
 * file layout as the engine's static demo export (`public/demo/`), so the web
 * app can be developed before the engine exists. Nothing here is a result:
 * every metric written by this script is a placeholder, and the UI stamps
 * pages "Mock fixture" whenever this source is active.
 *
 * Model: phenomenological superposition (circadian baseline with dawn rise and
 * nocturnal dip, gamma-shaped meal responses scaled by available carbs and GI,
 * walk-induced uptake, sulfonylurea glucose-independent lowering, AR(1)
 * process noise), observed by a lagged noisy CGM with dropouts.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  Alert,
  Archetype,
  BandPoint,
  CohortPatient,
  Dose,
  Driver,
  Forecast,
  GlycemicEvent,
  Meal,
  Metrics,
  PatientDetail,
  Risk,
  SleepStage,
  Timeline,
  TwinParam,
  WhatIfMetrics,
  WhatIfResponse,
} from "@/lib/api/types";
import { bundleFromPatient } from "@/lib/fhir";
import { eag, gmi, mean, rangeShares, sd, trendFromSlope } from "@/lib/glucose";
import { DAY, HOUR, MIN, istMidnight, istMinuteOfDay, toISO } from "@/lib/time";

import { FOOD_BY_ID, MOCK_FOODS } from "./foods";
import { FIRST, REGIONS, SURNAMES, type Region } from "./people";

const OUT = path.resolve(process.cwd(), "public/mock");
const N_PATIENTS = 18;
const STEP = 5 * MIN;

// ---------------------------------------------------------------- RNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const uni = (r: Rng, a: number, b: number) => a + (b - a) * r();
const gauss = (r: Rng, m = 0, s = 1) => {
  const u = Math.max(r(), 1e-9);
  const v = r();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// ---------------------------------------------------------------- clock
const START = Date.parse("2026-09-21T00:00:00+05:30");
const END = START + 28 * DAY;
const NOW = START + 21 * DAY + 19.5 * HOUR; // 12 Oct 2026, 19:30 IST
const WIN_FROM = NOW - 7 * DAY;
const WIN_TO = NOW + 3 * DAY;
const SIM_FROM = istMidnight(WIN_FROM) - 2 * DAY;
const SIM_TO = WIN_TO + 6 * HOUR;

// ---------------------------------------------------------------- patient spec
interface MedPlan {
  name: string;
  drug_class: string;
  dose: string;
  label: string;
  times: string[];
  su?: number; // glucose-lowering strength per dose (mg/dL)
  basal?: boolean;
}

interface Spec {
  id: string;
  name: string;
  sex: "F" | "M";
  age: number;
  archetype: Archetype;
  region: Region;
  city: string;
  height: number;
  weight: number;
  waist: number;
  hba1c: number;
  duration: number;
  meds: MedPlan[];
  morningWalk: boolean;
  dinnerWalk: boolean;
  dinnerMin: number;
  dawnAmp: number;
  dipAmp: number;
  kShape: number;
  tauScale: number;
  gain: number;
  Gb: number;
  hrDay: number;
  hrvNight: number;
  fastingDay: number | null; // day index relative to SIM_FROM midnight
}

const MET = (mg: 500 | 1000): MedPlan => ({
  name: "Metformin",
  drug_class: "Biguanide",
  dose: `${mg} mg`,
  label: `Metformin ${mg} mg BD`,
  times: ["08:30", "20:30"],
});
const GLIM: MedPlan = { name: "Glimepiride", drug_class: "Sulfonylurea", dose: "2 mg", label: "Glimepiride 2 mg OD", times: ["20:45"], su: 34 };
const GLIC: MedPlan = { name: "Gliclazide", drug_class: "Sulfonylurea", dose: "80 mg", label: "Gliclazide 80 mg BD", times: ["08:00", "20:00"], su: 22 };
const SITA: MedPlan = { name: "Sitagliptin", drug_class: "DPP-4 inhibitor", dose: "100 mg", label: "Sitagliptin 100 mg OD", times: ["08:30"] };
const TENE: MedPlan = { name: "Teneligliptin", drug_class: "DPP-4 inhibitor", dose: "20 mg", label: "Teneligliptin 20 mg OD", times: ["08:30"] };
const DAPA: MedPlan = { name: "Dapagliflozin", drug_class: "SGLT2 inhibitor", dose: "10 mg", label: "Dapagliflozin 10 mg OD", times: ["08:30"] };
const EMPA: MedPlan = { name: "Empagliflozin", drug_class: "SGLT2 inhibitor", dose: "10 mg", label: "Empagliflozin 10 mg OD", times: ["08:30"] };
const GLAR: MedPlan = { name: "Insulin glargine", drug_class: "Basal insulin", dose: "14 U", label: "Insulin glargine 14 U HS", times: ["22:30"], basal: true };

const ARCHETYPES: Archetype[] = ["IROD", "SIDD", "IROD", "MARD", "SIRD", "IROD", "SIDD", "MARD", "IROD", "SIDD", "IROD", "MARD", "SIRD", "IROD", "SIDD", "MARD", "IROD", "SIRD"];

function makeSpec(i: number): Spec {
  const r = mulberry32(1000 + i * 97);
  const archetype = ARCHETYPES[i];
  const region: Region = i === 0 ? "North" : pick(r, ["North", "South", "West", "East"] as const);
  const sex: "F" | "M" = i === 0 ? "M" : r() < 0.48 ? "F" : "M";
  const first = i === 0 ? "Rajesh" : pick(r, FIRST[sex]);
  const last = i === 0 ? "Verma" : pick(r, SURNAMES[region]);
  const city = i === 0 ? "Jaipur" : pick(r, REGIONS[region]);

  let age = 0;
  let bmi = 0;
  let hba1c = 0;
  let duration = 0;
  let meds: MedPlan[] = [];
  let kShape = 1;
  let dawnAmp = 0;
  switch (archetype) {
    case "SIDD":
      age = Math.round(uni(r, 36, 56));
      bmi = uni(r, 21.5, 25);
      hba1c = uni(r, 8.6, 10.1);
      duration = Math.round(uni(r, 3, 12));
      meds = r() < 0.5 ? [MET(1000), GLIC] : [MET(1000), GLAR, SITA];
      kShape = 0.78;
      dawnAmp = uni(r, 22, 38);
      break;
    case "SIRD":
      age = Math.round(uni(r, 40, 60));
      bmi = uni(r, 23.5, 27.5);
      hba1c = uni(r, 7.3, 8.6);
      duration = Math.round(uni(r, 2, 8));
      meds = r() < 0.5 ? [MET(1000), DAPA] : [MET(1000), TENE];
      kShape = 0.9;
      dawnAmp = uni(r, 18, 30);
      break;
    case "MARD":
      age = Math.round(uni(r, 58, 74));
      bmi = uni(r, 22.5, 26);
      hba1c = uni(r, 6.6, 7.4);
      duration = Math.round(uni(r, 4, 15));
      meds = r() < 0.6 ? [MET(500), GLIM] : [MET(500), SITA];
      kShape = 1.15;
      dawnAmp = uni(r, 8, 18);
      break;
    case "IROD":
      age = Math.round(uni(r, 38, 62));
      bmi = uni(r, 27, 33.5);
      hba1c = uni(r, 7.2, 8.8);
      duration = Math.round(uni(r, 2, 10));
      meds = r() < 0.45 ? [MET(1000), GLIM] : r() < 0.5 ? [MET(1000), EMPA] : [MET(1000), SITA];
      kShape = 0.95;
      dawnAmp = uni(r, 14, 28);
      break;
  }
  if (i === 0) {
    age = 58;
    bmi = 28.6;
    hba1c = 7.9;
    duration = 9;
    meds = [MET(1000), GLIM];
  }
  const height = sex === "F" ? uni(r, 150, 164) : uni(r, 162, 178);
  const weight = bmi * (height / 100) ** 2;
  const waist = (sex === "F" ? 0.55 : 0.53) * height + (bmi - 23) * 1.6 + gauss(r, 0, 3);

  const fpg = eag(hba1c) * 0.9;
  return {
    id: `P${String(i + 1).padStart(3, "0")}`,
    name: `${first} ${last}`,
    sex,
    age,
    archetype,
    region,
    city,
    height,
    weight,
    waist,
    hba1c: Math.round(hba1c * 10) / 10,
    duration,
    meds,
    morningWalk: r() < 0.4,
    dinnerWalk: r() < 0.25,
    dinnerMin: Math.round(uni(r, 20.75, 22.0) * 4) / 4 * 60,
    dawnAmp,
    dipAmp: uni(r, 6, 14) + (meds.some((m) => m.basal) ? 12 : 0),
    kShape,
    tauScale: uni(r, 0.9, 1.15),
    gain: 1.6,
    Gb: fpg - dawnAmp * 0.7,
    hrDay: uni(r, 70, 84),
    hrvNight: clamp(62 - age * 0.45 + gauss(r, 0, 5), 18, 55),
    fastingDay: meds.some((m) => m.su) && r() < 0.7 ? Math.floor(uni(r, 2, 11)) : null,
  };
}

// ---------------------------------------------------------------- lifestyle events
interface MealEv {
  t: number;
  items: { food_id: string; portions: number }[];
  logged: boolean;
  kind: "breakfast" | "lunch" | "snack" | "dinner";
}
interface WalkEv {
  t: number;
  dur: number;
  intensity: "light" | "brisk";
}
interface DoseEv {
  t: number;
  med: MedPlan;
  taken: boolean;
}
interface Night {
  start: number;
  end: number;
  segs: { start: number; end: number; stage: SleepStage }[];
  hours: number;
}

const TEMPLATES: Record<Region, Record<"breakfast" | "lunch" | "snack" | "dinner", [string, number][][]>> = {
  North: {
    breakfast: [[["aloo_paratha", 1], ["curd", 1], ["chai_sugar", 1]], [["poha", 1], ["chai_sugar", 1]], [["besan_chilla", 1], ["chai_no_sugar", 1]], [["dalia", 1], ["chai_sugar", 1]]],
    lunch: [[["roti", 3], ["dal", 1], ["mixed_sabzi", 1]], [["rajma", 1], ["white_rice", 1.5]], [["roti", 2], ["chole", 1], ["kachumber", 1]]],
    snack: [[["chai_sugar", 1], ["marie_biscuit", 1]], [["chai_sugar", 1], ["samosa", 1]], [["chai_no_sugar", 1], ["roasted_chana", 1]]],
    dinner: [[["white_rice", 1.5], ["dal", 1], ["roti", 1], ["mixed_sabzi", 1]], [["roti", 3], ["palak_paneer", 1]], [["khichdi", 1.5], ["curd", 1]], [["bajra_roti", 2], ["dal", 1], ["mixed_sabzi", 1]]],
  },
  South: {
    breakfast: [[["idli", 1.5], ["sambar", 1], ["chai_sugar", 1]], [["plain_dosa", 2], ["sambar", 1]], [["upma", 1], ["chai_sugar", 1]], [["uttapam", 1], ["sambar", 1]]],
    lunch: [[["white_rice", 2], ["sambar", 1], ["mixed_sabzi", 1], ["curd", 1]], [["curd_rice", 1.5], ["bhindi", 1]], [["white_rice", 1.5], ["dal", 1], ["fish_curry", 1]]],
    snack: [[["chai_sugar", 1], ["glucose_biscuit", 1]], [["banana", 1]], [["chai_sugar", 1], ["pakora", 1]]],
    dinner: [[["plain_dosa", 2], ["sambar", 1]], [["idli", 2], ["sambar", 1]], [["white_rice", 1.5], ["sambar", 1], ["mixed_sabzi", 1]], [["ragi_roti", 2], ["dal", 1]]],
  },
  West: {
    breakfast: [[["poha", 1], ["chai_sugar", 1]], [["thepla", 2], ["curd", 1], ["chai_sugar", 1]], [["dhokla", 1], ["chai_sugar", 1]]],
    lunch: [[["roti", 2], ["dal", 1], ["white_rice", 1], ["mixed_sabzi", 1]], [["roti", 3], ["aloo_sabzi", 1], ["buttermilk", 1]]],
    snack: [[["chai_sugar", 1], ["marie_biscuit", 1]], [["dhokla", 1]], [["chai_sugar", 1], ["makhana", 1]]],
    dinner: [[["khichdi", 1.5], ["curd", 1]], [["bajra_roti", 2], ["mixed_sabzi", 1], ["buttermilk", 1]], [["roti", 3], ["dal", 1], ["mixed_sabzi", 1]], [["white_rice", 1.5], ["dal", 1], ["roti", 1]]],
  },
  East: {
    breakfast: [[["puri", 1], ["aloo_sabzi", 1], ["chai_sugar", 1]], [["oats_porridge", 1], ["banana", 1]], [["roti", 2], ["mixed_sabzi", 1], ["chai_sugar", 1]]],
    lunch: [[["white_rice", 2], ["dal", 1], ["fish_curry", 1], ["mixed_sabzi", 1]], [["white_rice", 2], ["dal", 1], ["aloo_sabzi", 1]]],
    snack: [[["chai_sugar", 1], ["marie_biscuit", 1]], [["chai_sugar", 1], ["pakora", 1]], [["makhana", 1], ["chai_no_sugar", 1]]],
    dinner: [[["roti", 3], ["mixed_sabzi", 1], ["dal", 1]], [["white_rice", 1.5], ["fish_curry", 1]], [["white_rice", 1.5], ["dal", 1], ["mixed_sabzi", 1]]],
  },
};

function lifestyle(s: Spec, seed: number) {
  const r = mulberry32(seed);
  const meals: MealEv[] = [];
  const walks: WalkEv[] = [];
  const doses: DoseEv[] = [];
  const nights: Night[] = [];
  const days = Math.ceil((SIM_TO - SIM_FROM) / DAY) + 1;
  const T = TEMPLATES[s.region];
  for (let d = 0; d < days; d++) {
    const mid = SIM_FROM + d * DAY;
    const dow = new Date(mid + 5.5 * HOUR).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const fasting = s.fastingDay === d;
    const at = (h: number, jitter: number) => mid + (h + gauss(r, 0, jitter)) * HOUR;
    const tmpl = (k: keyof typeof T) => pick(r, T[k]).map(([food_id, portions]) => ({ food_id, portions }));

    if (!fasting) {
      meals.push({ t: at(weekend ? 9.2 : 8.6, 0.35), items: tmpl("breakfast"), logged: r() > 0.04, kind: "breakfast" });
      if (r() > 0.06) meals.push({ t: at(13.6, 0.45), items: tmpl("lunch"), logged: r() > 0.04, kind: "lunch" });
      if (r() > 0.25) meals.push({ t: at(17.4, 0.4), items: tmpl("snack"), logged: r() > 0.15, kind: "snack" });
    } else {
      meals.push({ t: at(17.5, 0.3), items: [{ food_id: "sabudana_khichdi", portions: 1 }, { food_id: "banana", portions: 1 }], logged: true, kind: "snack" });
    }
    let dinnerItems = tmpl("dinner");
    if (s.id === "P001") dinnerItems = [{ food_id: "white_rice", portions: 1.5 }, { food_id: "dal", portions: 1 }, { food_id: "roti", portions: 1 }, { food_id: "mixed_sabzi", portions: 1 }];
    if (r() < 0.08) dinnerItems.push({ food_id: pick(r, ["gulab_jamun", "jalebi", "kheer", "besan_ladoo"] as const), portions: 1 });
    meals.push({ t: mid + s.dinnerMin * MIN + gauss(r, 0, 20) * MIN, items: dinnerItems, logged: r() > 0.03, kind: "dinner" });

    if (s.morningWalk && r() < 0.8) walks.push({ t: at(6.8, 0.25), dur: Math.round(uni(r, 25, 40)), intensity: "brisk" });
    if (s.dinnerWalk && r() < 0.6) walks.push({ t: mid + (s.dinnerMin + 35) * MIN, dur: 15, intensity: "light" });
    if (r() < 0.3) walks.push({ t: at(18.3, 0.6), dur: Math.round(uni(r, 10, 25)), intensity: "light" });

    for (const m of s.meds) {
      for (const hhmm of m.times) {
        const [hh, mm] = hhmm.split(":").map(Number);
        doses.push({ t: mid + (hh * 60 + mm + gauss(r, 0, 12)) * MIN, med: m, taken: r() > 0.07 });
      }
    }

    // night starting this evening
    const short = r() < 0.13;
    const bed = mid + (weekend ? 23.6 : 23.1) * HOUR + gauss(r, 0, 0.5) * HOUR;
    const hours = short ? uni(r, 4.2, 5.4) : clamp(gauss(r, 7.0, 0.6), 5.8, 8.4);
    const wake = bed + hours * HOUR;
    const segs: Night["segs"] = [];
    let t = bed;
    let cycle = 0;
    while (t < wake - 10 * MIN) {
      const early = cycle < 2;
      const plan: [SleepStage, number][] = [
        ["light", uni(r, 15, 30)],
        ["deep", early ? uni(r, 25, 45) : uni(r, 0, 12)],
        ["light", uni(r, 10, 20)],
        ["rem", early ? uni(r, 8, 15) : uni(r, 20, 35)],
      ];
      if (r() < 0.35) plan.push(["wake", uni(r, 2, 8)]);
      for (const [stage, dur] of plan) {
        if (dur < 1) continue;
        const e = Math.min(wake, t + dur * MIN);
        if (e > t) segs.push({ start: t, end: e, stage });
        t = e;
        if (t >= wake) break;
      }
      cycle++;
    }
    nights.push({ start: bed, end: wake, segs, hours });
  }
  meals.sort((a, b) => a.t - b.t);
  return { meals, walks, doses, nights };
}

// ---------------------------------------------------------------- physiology
function mealLoad(items: { food_id: string; portions: number }[]) {
  let carbs = 0;
  let avail = 0;
  let giW = 0;
  let gl = 0;
  for (const it of items) {
    const f = FOOD_BY_ID[it.food_id];
    const c = f.carbs_g * it.portions;
    const a = Math.max(f.carbs_g - f.fiber_g, 0) * it.portions;
    carbs += c;
    avail += a;
    giW += f.gi * a;
    gl += f.gl * it.portions;
  }
  const gi = avail > 0 ? giW / avail : 0;
  return { carbs, avail, gi, gl };
}

const shape = (x: number, k: number) => (x <= 0 ? 0 : Math.pow(x * Math.exp(1 - x), k));

function circDist(a: number, b: number) {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

interface World {
  meals: MealEv[];
  walks: WalkEv[];
  doses: DoseEv[];
  nights: Night[];
}

function lastNightHours(nights: Night[], t: number) {
  let h = 7;
  for (const n of nights) if (n.end <= t && t - n.end < 20 * HOUR) h = n.hours;
  return h;
}

/** Noise-free physiological glucose at time t (truth before process noise). */
function physio(s: Spec, w: World, t: number, drift: (t: number) => number, opts?: { sleepHours?: number }) {
  const mod = istMinuteOfDay(t);
  const sleepH = opts?.sleepHours ?? lastNightHours(w.nights, t);
  const sleepPenalty = sleepH < 6 ? (6 - sleepH) * 0.09 : 0;
  let g = s.Gb + drift(t) + sleepPenalty * 30;
  g += s.dawnAmp * Math.exp(-((circDist(mod, 405) / 95) ** 2));
  g -= s.dipAmp * Math.exp(-((circDist(mod, 150) / 85) ** 2));
  const gain = s.gain * (1 + sleepPenalty);
  for (const m of w.meals) {
    const dt = (t - m.t) / MIN;
    if (dt <= 0 || dt > 420) continue;
    const L = mealLoad(m.items);
    const tau = (30 + (100 - L.gi) * 0.55) * s.tauScale;
    g += gain * L.avail * (0.35 + (0.65 * L.gi) / 70) * shape(dt / tau, s.kShape);
  }
  for (const wk of w.walks) {
    const dt = (t - wk.t) / MIN;
    if (dt <= 0 || dt > 240) continue;
    const W = (wk.intensity === "brisk" ? 26 : 14) * Math.pow(wk.dur / 30, 0.7);
    g -= W * shape(dt / (wk.dur * 0.8 + 15), 1.2);
  }
  for (const d of w.doses) {
    if (!d.taken || !d.med.su) continue;
    const dt = (t - d.t) / MIN;
    if (dt <= 0 || dt > 960) continue;
    g -= d.med.su * shape(dt / 230, 0.8);
  }
  return g;
}

function makeDrift(seed: number) {
  const r = mulberry32(seed);
  const knots: number[] = [];
  const n = Math.ceil((SIM_TO - SIM_FROM) / (12 * HOUR)) + 2;
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = 0.6 * v + gauss(r, 0, 6);
    knots.push(v);
  }
  return (t: number) => {
    const x = (t - SIM_FROM) / (12 * HOUR);
    const i = clamp(Math.floor(x), 0, n - 2);
    const f = x - i;
    return knots[i] * (1 - f) + knots[i + 1] * f;
  };
}

// ---------------------------------------------------------------- simulate one patient
function simulate(s: Spec, idx: number) {
  const seed = 50_000 + idx * 131;
  const world = lifestyle(s, seed);
  const drift = makeDrift(seed + 7);
  const r = mulberry32(seed + 11);

  const grid: number[] = [];
  for (let t = SIM_FROM; t <= SIM_TO; t += STEP) grid.push(t);

  // calibrate meal gain so the 7-day mean before NOW tracks ADAG eAG(HbA1c)
  const past = grid.filter((t) => t > NOW - 7 * DAY && t <= NOW);
  const base0 = { ...s, gain: 0 };
  const unit = { ...s, gain: 1, Gb: 0, dawnAmp: 0, dipAmp: 0 };
  const noMeal = mean(past.map((t) => physio(base0, world, t, drift)))!;
  const mealUnit = mean(past.map((t) => physio(unit, { ...world, walks: [], doses: [] }, t, () => 0)))!;
  const target = eag(s.hba1c) + gauss(r, 0, 6);
  s.gain = clamp((target - noMeal) / Math.max(mealUnit, 1), 0.7, 3.2);

  // truth with AR(1) process noise
  const truth: number[] = [];
  let ar = 0;
  for (const t of grid) {
    ar = 0.96 * ar + gauss(r, 0, 2.0);
    truth.push(Math.max(36, physio(s, world, t, drift) + ar));
  }

  // CGM: first-order lag (~10 min), AR sensor noise, dropouts, compression lows at night
  const cgm: (number | null)[] = [];
  let gi = truth[0];
  let sn = 0;
  let drop = 0;
  let comp = 0;
  for (let k = 0; k < grid.length; k++) {
    gi += (1 - Math.exp(-5 / 10)) * (truth[k] - gi);
    sn = 0.7 * sn + gauss(r, 0, 3.4);
    if (drop > 0) drop--;
    else if (r() < 0.0035) drop = Math.floor(uni(r, 2, 12));
    const mod = istMinuteOfDay(grid[k]);
    if (comp > 0) comp--;
    else if ((mod < 300 || mod > 1410) && r() < 0.0009) comp = Math.floor(uni(r, 4, 8));
    const compression = comp > 0 ? -28 * Math.sin((Math.PI * comp) / 8) : 0;
    cgm.push(drop > 0 ? null : Math.round(clamp(gi + sn + compression, 40, 400)));
  }

  // twin (filtered estimate)
  const twin: { p10: number; p50: number; p90: number }[] = [];
  let est = truth[0];
  let since = 0;
  let terr = 0;
  for (let k = 0; k < grid.length; k++) {
    terr = 0.9 * terr + gauss(r, 0, 1.6);
    const obs = cgm[k];
    if (obs != null) {
      est = est + 0.55 * (truth[k] + terr - est);
      since = 0;
    } else {
      est = est + 0.25 * (truth[k] - est);
      since++;
    }
    const w = (7 + 0.065 * est) * (1 + Math.min(since, 12) * 0.08);
    twin.push({ p10: r1(est - w), p50: r1(est), p90: r1(est + w * 1.12) });
  }

  return { world, drift, grid, truth, cgm, twin, r };
}

// ---------------------------------------------------------------- wearables
function wearables(s: Spec, world: World, grid: number[], seed: number) {
  const r = mulberry32(seed);
  const hr: number[] = [];
  const hrv: number[] = [];
  const steps: number[] = [];
  let hrN = 0;
  let hrvN = 0;
  for (const t of grid) {
    const night = world.nights.find((n) => t >= n.start && t < n.end);
    const seg = night?.segs.find((x) => t >= x.start && t < x.end);
    const walk = world.walks.find((w) => t >= w.t && t < w.t + w.dur * MIN);
    const sleepDebt = Math.max(0, 7 - lastNightHours(world.nights, t));
    hrN = 0.8 * hrN + gauss(r, 0, 1.6);
    hrvN = 0.85 * hrvN + gauss(r, 0, 2.2);
    let bpm: number;
    let rmssd: number;
    let st: number;
    if (night) {
      const stage = seg?.stage ?? "light";
      bpm = s.hrDay - 17 + (stage === "rem" ? 4 : stage === "deep" ? -3 : stage === "wake" ? 8 : 0);
      rmssd = s.hrvNight * (stage === "deep" ? 1.18 : stage === "rem" ? 0.88 : 1) - sleepDebt * 1.4;
      st = stage === "wake" && r() < 0.3 ? Math.floor(uni(r, 5, 30)) : 0;
    } else if (walk) {
      bpm = s.hrDay + (walk.intensity === "brisk" ? 34 : 18);
      rmssd = s.hrvNight * 0.42;
      st = Math.round((walk.intensity === "brisk" ? uni(r, 520, 590) : uni(r, 330, 420)) * Math.min(1, (w2(t, walk) || 5) / 5));
    } else {
      const mod = istMinuteOfDay(t);
      const office = mod > 600 && mod < 1050 && r() < 0.8;
      const burst = r() < (office ? 0.08 : 0.22);
      bpm = s.hrDay + (burst ? 8 : 0) + sleepDebt * 1.5;
      rmssd = s.hrvNight * 0.68 - sleepDebt * 1.2;
      st = burst ? Math.floor(uni(r, 60, 260)) : Math.floor(uni(r, 0, office ? 25 : 60));
    }
    hr.push(Math.round(bpm + hrN));
    hrv.push(r1(clamp(rmssd + hrvN, 8, 90)));
    steps.push(Math.max(0, st));
  }
  return { hr, hrv, steps };
}
function w2(t: number, w: WalkEv) {
  return Math.min(5, (w.t + w.dur * MIN - t) / MIN);
}

// ---------------------------------------------------------------- events, alerts, risk
function eventsFrom(grid: number[], g: (number | null)[], from: number, to: number): GlycemicEvent[] {
  const out: GlycemicEvent[] = [];
  const scan = (kind: GlycemicEvent["kind"], pred: (v: number) => boolean, extreme: (a: number, b: number) => number) => {
    let start = -1;
    let ext = 0;
    for (let k = 0; k <= grid.length; k++) {
      const v = k < grid.length ? g[k] : null;
      const inside = k < grid.length && grid[k] >= from && grid[k] <= to && v != null && pred(v);
      if (inside) {
        if (start < 0) {
          start = k;
          ext = v!;
        } else ext = extreme(ext, v!);
      } else if (start >= 0) {
        if (k - start >= 3) out.push({ kind, start: toISO(grid[start]), end: toISO(grid[k - 1]), extreme: Math.round(ext) });
        start = -1;
      }
    }
  };
  scan("hyper_l2", (v) => v > 250, Math.max);
  scan("hypo_l1", (v) => v < 70, Math.min);
  scan("hypo_l2", (v) => v < 54, Math.min);
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function onsets(grid: number[], truth: number[], pred: (v: number) => boolean): number[] {
  const res: number[] = [];
  let run = 0;
  for (let k = 0; k < grid.length; k++) {
    if (pred(truth[k])) {
      run++;
      if (run === 3) res.push(grid[k - 2]);
    } else run = 0;
  }
  return res;
}

interface FeatureCtx {
  g: number;
  slope: number;
  cob: number;
  stepsHr: number;
  sleepH: number;
  suActive: boolean;
  p90_120: number;
  p10_60: number;
  hrvRatio: number;
  siRatio: number;
  minsSinceMeal: number;
}

function drivers(kind: "hyper_2h" | "hypo_1h" | "nocturnal_hypo", f: FeatureCtx): Driver[] {
  const d: Driver[] = [];
  const add = (feature: string, label: string, value_text: string, contribution: number) =>
    d.push({ feature, label, value_text, contribution: r2(contribution) });
  if (kind === "hyper_2h") {
    add("cgm_level", "Current glucose", `${Math.round(f.g)} mg/dL`, (f.g - 160) / 55);
    add("cgm_slope_30", "30-min trend", `${f.slope >= 0 ? "+" : ""}${f.slope.toFixed(1)} mg/dL/min`, f.slope * 0.55);
    add("carbs_on_board", "Carbs on board", `${Math.round(f.cob)} g`, (f.cob - 20) / 45);
    add("twin_p90_120", "Twin p90 at +2 h", `${Math.round(f.p90_120)} mg/dL`, (f.p90_120 - 230) / 45);
    add("sleep_last_night", "Sleep last night", `${f.sleepH.toFixed(1)} h`, f.sleepH < 6 ? (6 - f.sleepH) * 0.35 : -0.05);
    add("steps_60", "Steps, last hour", `${f.stepsHr.toLocaleString("en-IN")}`, -Math.min(f.stepsHr, 3000) / 3000);
    add("si_vs_baseline", "Insulin sensitivity vs baseline", `${f.siRatio >= 1 ? "+" : ""}${Math.round((f.siRatio - 1) * 100)}%`, (1 - f.siRatio) * 2.2);
  } else if (kind === "hypo_1h") {
    add("cgm_level", "Current glucose", `${Math.round(f.g)} mg/dL`, (110 - f.g) / 25);
    add("cgm_slope_30", "30-min trend", `${f.slope >= 0 ? "+" : ""}${f.slope.toFixed(1)} mg/dL/min`, -f.slope * 0.7);
    add("su_active", "Sulfonylurea active", f.suActive ? "Yes" : "No", f.suActive ? 0.85 : -0.2);
    add("twin_p10_60", "Twin p10 at +1 h", `${Math.round(f.p10_60)} mg/dL`, (85 - f.p10_60) / 18);
    add("mins_since_meal", "Time since last meal", `${Math.round(f.minsSinceMeal / 60 * 10) / 10} h`, (f.minsSinceMeal - 240) / 240);
    add("steps_60", "Steps, last hour", `${f.stepsHr.toLocaleString("en-IN")}`, Math.min(f.stepsHr, 3000) / 4000);
    add("carbs_on_board", "Carbs on board", `${Math.round(f.cob)} g`, -f.cob / 40);
  } else {
    add("bedtime_glucose", "Bedtime glucose", `${Math.round(f.g)} mg/dL`, (130 - f.g) / 30);
    add("su_active", "Sulfonylurea / basal insulin overnight", f.suActive ? "Yes" : "No", f.suActive ? 0.9 : -0.3);
    add("hrv_vs_baseline", "Night HRV vs 7-day baseline", `${Math.round((f.hrvRatio - 1) * 100)}%`, (f.hrvRatio - 1) * 0.8);
    add("carbs_on_board", "Carbs on board at bedtime", `${Math.round(f.cob)} g`, -f.cob / 35);
    add("twin_p10_60", "Twin overnight p10", `${Math.round(f.p10_60)} mg/dL`, (90 - f.p10_60) / 20);
  }
  return d.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 5);
}

const RECO = {
  hyper_2h: "Suggest a 15-minute walk after the meal and a smaller rice/roti portion. Re-check in 2 h.",
  hypo_1h: "Check a fingerstick value; if <70 mg/dL take 15 g fast-acting carbohydrate and re-check in 15 min. Review sulfonylurea timing.",
  nocturnal_hypo: "Advise a small protein-containing bedtime snack; review the evening sulfonylurea or basal-insulin dose with the treating physician.",
} as const;

// ---------------------------------------------------------------- build all
function main() {
  rmSync(OUT, { recursive: true, force: true });
  for (const d of ["patients", "timeline", "forecast", "fhir", "whatif"]) mkdirSync(path.join(OUT, d), { recursive: true });
  const write = (rel: string, obj: unknown) => {
    const p = path.join(OUT, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(obj));
  };

  write("clock.json", { start: toISO(START), end: toISO(END), now: toISO(NOW) });
  write("foods.json", { foods: MOCK_FOODS });
  write("_mock.json", { mock: true, note: "Development fixtures generated by web/src/mocks/generate.ts. Not results." });

  const cohort: CohortPatient[] = [];
  const stats: string[] = [];

  for (let i = 0; i < N_PATIENTS; i++) {
    const s = makeSpec(i);
    const { world, grid, truth, cgm, twin, drift } = simulate(s, i);
    const wear = wearables(s, world, grid, 77_000 + i);
    const r = mulberry32(90_000 + i);

    const idxOf = (t: number) => Math.round((t - SIM_FROM) / STEP);
    const kNow = idxOf(NOW);
    const winIdx = grid.map((t, k) => [t, k] as const).filter(([t]) => t >= WIN_FROM && t <= WIN_TO);

    // ---- stats over last 7 days (<= now)
    const past7 = cgm.slice(idxOf(NOW - 7 * DAY) + 1, kNow + 1);
    const sh = rangeShares(past7);
    const mg = mean(past7) ?? 0;
    const cv = ((sd(past7) ?? 0) / mg) * 100;
    const last = cgm[kNow];
    const prevIdx = kNow - 6;
    const slope = last != null && cgm[prevIdx] != null ? (last - (cgm[prevIdx] as number)) / 30 : 0;

    // ---- truth onsets for alert outcomes
    const hyperOn = onsets(grid, truth, (v) => v > 250);
    const hypoOn = onsets(grid, truth, (v) => v < 70);

    const features = (k: number): FeatureCtx => {
      const t = grid[k];
      const g = cgm[k] ?? twin[k].p50;
      const g30 = cgm[k - 6] ?? twin[k - 6]?.p50 ?? g;
      const recentMeals = world.meals.filter((m) => m.logged && m.t <= t && t - m.t < 4 * HOUR);
      const cob = recentMeals.reduce((a, m) => a + mealLoad(m.items).avail * Math.max(0, 1 - (t - m.t) / (3.5 * HOUR)), 0);
      const lastMeal = world.meals.filter((m) => m.t <= t).at(-1);
      let stepsHr = 0;
      for (let j = Math.max(0, k - 11); j <= k; j++) stepsHr += wear.steps[j];
      const suActive = world.doses.some((d) => d.taken && (d.med.su || d.med.basal) && t - d.t > 0 && t - d.t < 12 * HOUR);
      const fut120 = truth.slice(k + 1, k + 25);
      const fut60 = truth.slice(k + 1, k + 13);
      const sleepH = lastNightHours(world.nights, t);
      return {
        g,
        slope: (g - g30) / 30,
        cob,
        stepsHr,
        sleepH,
        suActive,
        p90_120: (fut120.length ? Math.max(...fut120) : g) + 18,
        p10_60: (fut60.length ? Math.min(...fut60) : g) - 10,
        hrvRatio: 1 + (wear.hrv[k] - s.hrvNight * 0.7) / (s.hrvNight * 2),
        siRatio: sleepH < 6 ? 0.8 - (6 - sleepH) * 0.05 : 1 + gauss(r, 0, 0.04),
        minsSinceMeal: lastMeal ? (t - lastMeal.t) / MIN : 600,
      };
    };

    // ---- alerts
    const alerts: Alert[] = [];
    const lastAlert: Record<string, number> = {};
    let aid = 0;
    for (const [t, k] of winIdx) {
      if ((t - WIN_FROM) % (15 * MIN) !== 0 || k + 25 >= grid.length) continue;
      const g = truth[k];
      const mk = (kind: Alert["kind"], p: number, threshold: number, onsetList: number[], horizon: number) => {
        if (p < threshold) return;
        if (lastAlert[kind] && t - lastAlert[kind] < 3 * HOUR) return;
        lastAlert[kind] = t;
        const on = onsetList.find((o) => o > t && o <= t + horizon * MIN);
        alerts.push({
          id: `${s.id}-A${String(++aid).padStart(3, "0")}`,
          t: toISO(t),
          kind,
          probability: r2(p),
          threshold,
          outcome: on ? "true_positive" : "false_positive",
          lead_min: on ? Math.round((on - t) / MIN) : null,
          drivers: drivers(kind, features(k)),
          recommendation: RECO[kind],
        });
      };
      if (g < 250) {
        const mx = Math.max(...truth.slice(k + 1, k + 25));
        const p = clamp(0.85 * sigmoid((mx - 240) / 13) + uni(r, 0, 0.18), 0, 0.99);
        mk("hyper_2h", p, 0.42, hyperOn, 120);
      }
      if (g >= 70) {
        const mn = Math.min(...truth.slice(k + 1, k + 13));
        const p = clamp(0.85 * sigmoid((80 - mn) / 6) + uni(r, 0, 0.12), 0, 0.99);
        mk("hypo_1h", p, 0.3, hypoOn, 60);
      }
      const mod = istMinuteOfDay(t);
      if (mod === 22 * 60 + 30) {
        const mid = istMidnight(t) + DAY;
        const night = truth.slice(idxOf(mid), idxOf(mid + 6 * HOUR));
        const mn = Math.min(...night);
        const p = clamp(0.85 * sigmoid((84 - mn) / 7) + uni(r, 0, 0.1), 0, 0.99);
        const on = hypoOn.find((o) => o >= mid && o <= mid + 6 * HOUR);
        if (p >= 0.3) {
          alerts.push({
            id: `${s.id}-A${String(++aid).padStart(3, "0")}`,
            t: toISO(t),
            kind: "nocturnal_hypo",
            probability: r2(p),
            threshold: 0.3,
            outcome: on ? "true_positive" : "false_positive",
            lead_min: on ? Math.round((on - t) / MIN) : null,
            drivers: drivers("nocturnal_hypo", features(k)),
            recommendation: RECO.nocturnal_hypo,
          });
        }
      }
    }

    // ---- forecast at NOW
    const fq: Forecast["quantiles"] = [];
    const mech: Forecast["mechanistic_p50"] = [];
    let bias = 0;
    for (let h = 0; h <= 48; h++) {
      const k = kNow + h;
      const smooth = (truth[k - 1] + truth[k] + truth[k + 1]) / 3;
      bias += h === 0 ? 0 : gauss(r, 0, 1.4);
      const p50 = h === 0 ? twin[kNow].p50 : smooth + bias;
      const sig = h === 0 ? (twin[kNow].p90 - twin[kNow].p10) / 2.56 : (6 + 0.06 * p50) * Math.sqrt(h / 4 + 0.6);
      fq.push({
        t: toISO(grid[k]),
        p05: r1(Math.max(40, p50 - 1.645 * sig)),
        p25: r1(p50 - 0.674 * sig),
        p50: r1(p50),
        p75: r1(p50 + 0.674 * sig * 1.08),
        p95: r1(p50 + 1.645 * sig * 1.12),
      });
      mech.push({ t: toISO(grid[k]), g: r1(p50 + 4 * Math.sin(h / 9) + h * 0.12) });
    }
    const pAbove = (q: (typeof fq)[number], x: number) => {
      const sig = (q.p95 - q.p05) / 3.29;
      return 1 - 0.5 * (1 + erf((x - q.p50) / (sig * Math.SQRT2)));
    };
    const pBelow = (q: (typeof fq)[number], x: number) => 1 - pAbove(q, x);
    const hyper = clamp(Math.max(...fq.slice(1, 25).map((q) => pAbove(q, 250))) * 1.1, 0.01, 0.97);
    const hypo = clamp(Math.max(...fq.slice(1, 13).map((q) => pBelow(q, 70))) * 1.1, 0.005, 0.95);
    const midTonight = istMidnight(NOW) + DAY;
    const nightMin = Math.min(...truth.slice(idxOf(midTonight), idxOf(midTonight + 6 * HOUR)));
    const noct = clamp(0.8 * sigmoid((86 - nightMin) / 8) + uni(r, 0, 0.05), 0.01, 0.95);
    const level: Risk["level"] = hyper >= 0.5 || hypo >= 0.3 || noct >= 0.4 ? "high" : hyper >= 0.2 || hypo >= 0.1 || noct >= 0.2 ? "moderate" : "low";
    const risk: Risk = { hyper_2h: r3(hyper), hypo_1h: r3(hypo), nocturnal_hypo: r3(noct), level };
    const fNow = features(kNow);
    const forecast: Forecast = {
      at: toISO(NOW),
      step_min: 5,
      horizon_min: 240,
      quantiles: fq,
      mechanistic_p50: mech,
      risk,
      drivers: { hyper_2h: drivers("hyper_2h", fNow), hypo_1h: drivers("hypo_1h", fNow) },
      state: {
        glucose: r1(twin[kNow].p50),
        insulin_action: r3(0.004 + 0.012 * Math.min(1, fNow.cob / 60) + (fNow.suActive ? 0.006 : 0)),
        carbs_on_board_g: r1(fNow.cob),
        sulfonylurea_active: world.doses.some((d) => d.taken && d.med.su && NOW - d.t > 0 && NOW - d.t < 14 * HOUR),
        insulin_sensitivity_vs_baseline: r2(fNow.siRatio),
      },
    };

    // ---- timeline window
    const inWin = (t: number) => t >= WIN_FROM && t <= WIN_TO;
    const meals: Meal[] = world.meals
      .filter((m) => m.logged && inWin(m.t))
      .map((m) => {
        const L = mealLoad(m.items);
        return {
          t: toISO(Math.round(m.t / MIN) * MIN),
          carbs_g: Math.round(L.carbs),
          gl: r1(L.gl),
          items: m.items.map((it) => ({
            food_id: it.food_id,
            name: FOOD_BY_ID[it.food_id].name,
            portions: it.portions,
            carbs_g: r1(FOOD_BY_ID[it.food_id].carbs_g * it.portions),
          })),
        };
      });
    const doses: Dose[] = world.doses
      .filter((d) => inWin(d.t))
      .map((d) => ({ t: toISO(Math.round(d.t / MIN) * MIN), drug: d.med.name, dose: d.med.dose, taken: d.taken }));
    const sleep: Timeline["sleep"] = world.nights
      .filter((n) => n.end >= WIN_FROM && n.start <= WIN_TO)
      .flatMap((n) => n.segs.map((sg) => ({ start: toISO(Math.round(sg.start / MIN) * MIN), end: toISO(Math.round(sg.end / MIN) * MIN), stage: sg.stage })));

    const timeline: Timeline = {
      from: toISO(WIN_FROM),
      to: toISO(WIN_TO),
      cgm: winIdx.map(([t, k]) => ({ t: toISO(t), g: cgm[k] })),
      twin: winIdx.map(([t, k]) => ({ t: toISO(t), ...twin[k] })),
      hr: winIdx.map(([t, k]) => ({ t: toISO(t), bpm: wear.hr[k] })),
      hrv: winIdx.map(([t, k]) => ({ t: toISO(t), rmssd: wear.hrv[k] })),
      steps: winIdx.map(([t, k]) => ({ t: toISO(t), count: wear.steps[k] })),
      sleep,
      meals,
      doses,
      alerts,
      events: eventsFrom(grid, cgm, WIN_FROM, WIN_TO),
    };

    // ---- cohort row + detail
    const spark: (number | null)[] = [];
    for (let b = 0; b < 96; b++) {
      const k0 = kNow - 287 + b * 3;
      const v = [cgm[k0], cgm[k0 + 1], cgm[k0 + 2]].filter((x): x is number => x != null);
      spark.push(v.length ? r1(v.reduce((a, c) => a + c, 0) / v.length) : null);
    }
    const openAlerts = alerts.filter((a) => {
      const t = Date.parse(a.t);
      return t <= NOW && NOW - t < 12 * HOUR;
    }).length;

    const bmi = s.weight / (s.height / 100) ** 2;
    const row: CohortPatient = {
      id: s.id,
      display_name: s.name,
      abha: `91-0000-${String(4000 + i * 137).padStart(4, "0")}-${String(1000 + ((i * 7919) % 9000)).padStart(4, "0")}`,
      age: s.age,
      sex: s.sex,
      inferred_subtype: s.archetype,
      bmi: r1(bmi),
      hba1c: s.hba1c,
      meds: s.meds.map((m) => m.label),
      risk,
      open_alerts: openAlerts,
      last_glucose: last,
      trend: trendFromSlope(slope),
      tir_7d: r1(sh.in),
      tar_7d: r1(sh.high + sh.vhigh),
      tbr_7d: r1(sh.low + sh.vlow),
      mean_glucose_7d: r1(mg),
      cv_7d: r1(cv),
      gmi_7d: r2(gmi(mg)),
      sparkline_24h: spark,
    };
    cohort.push(row);

    const tg = (s.archetype === "SIRD" || s.archetype === "IROD" ? uni(r, 170, 260) : uni(r, 110, 170));
    const fpg = eag(s.hba1c) * 0.82;
    const egfr = s.age > 65 ? uni(r, 52, 78) : uni(r, 72, 105);
    const date = (daysAgo: number) => toISO(NOW - daysAgo * DAY).slice(0, 10);
    const pop = { SI: 3.2, SG: 1.9, beta: 1.0, EGP: 2.0, meal_rate: 45, dawn: 16 };
    const siMean = { SIDD: 2.8, SIRD: 1.2, MARD: 3.4, IROD: 1.6 }[s.archetype] * uni(r, 0.85, 1.15);
    const betaMean = { SIDD: 0.42, SIRD: 1.35, MARD: 0.8, IROD: 1.05 }[s.archetype] * uni(r, 0.85, 1.15);
    const param = (key: TwinParam["key"], label: string, unit: string, m: number, spread: number, popMed: number): TwinParam => {
      const trend: number[] = [];
      let v = m * (1 + gauss(r, 0, spread * 0.6));
      for (let d = 0; d < 7; d++) {
        v = v + (m - v) * 0.35 + gauss(r, 0, m * spread * 0.25);
        trend.push(r3(v));
      }
      trend[6] = r3(m);
      return { key, label, unit, mean: r3(m), p10: r3(m * (1 - spread)), p90: r3(m * (1 + spread * 1.15)), population_median: popMed, trend_7d: trend };
    };
    const detail: PatientDetail = {
      ...row,
      height_cm: r1(s.height),
      weight_kg: r1(s.weight),
      waist_cm: r1(s.waist),
      diabetes_years: s.duration,
      region: `${s.region} — ${s.city}`,
      labs: [
        { name: "HbA1c", loinc: "4548-4", value: s.hba1c, unit: "%", date: date(18), ref: "<5.7" },
        { name: "HbA1c", loinc: "4548-4", value: r1(s.hba1c + uni(r, -0.2, 0.6)), unit: "%", date: date(110), ref: "<5.7" },
        { name: "HbA1c", loinc: "4548-4", value: r1(s.hba1c + uni(r, -0.1, 0.9)), unit: "%", date: date(290), ref: "<5.7" },
        { name: "HbA1c", loinc: "4548-4", value: r1(s.hba1c + uni(r, 0.1, 1.2)), unit: "%", date: date(560), ref: "<5.7" },
        { name: "Fasting plasma glucose", loinc: "1558-6", value: Math.round(fpg), unit: "mg/dL", date: date(18), ref: "70–99" },
        { name: "Triglycerides", loinc: "2571-8", value: Math.round(tg), unit: "mg/dL", date: date(18), ref: "<150" },
        { name: "HDL cholesterol", loinc: "2085-9", value: Math.round(uni(r, 34, 52)), unit: "mg/dL", date: date(18), ref: ">40 (M), >50 (F)" },
        { name: "Creatinine", loinc: "2160-0", value: r2(uni(r, 0.7, 1.25)), unit: "mg/dL", date: date(18), ref: "0.6–1.2" },
        { name: "eGFR", loinc: "33914-3", value: Math.round(egfr), unit: "mL/min/1.73m²", date: date(18), ref: "≥90" },
        { name: "ALT", loinc: "1742-6", value: Math.round(uni(r, 18, 62)), unit: "U/L", date: date(18), ref: "<40" },
        { name: "Urine albumin/creatinine", loinc: "9318-7", value: Math.round(uni(r, 8, 90)), unit: "mg/g", date: date(18), ref: "<30" },
        { name: "BMI", loinc: "39156-5", value: r1(bmi), unit: "kg/m²", date: date(18), ref: "18.5–22.9 (Asian)" },
        { name: "Waist circumference", loinc: "8280-0", value: r1(s.waist), unit: "cm", date: date(18), ref: s.sex === "F" ? "<80" : "<90" },
      ],
      conditions: [
        { system: "http://snomed.info/sct", code: "44054006", display: "Type 2 diabetes mellitus", onset: date(s.duration * 365) },
        ...(r() < 0.55 ? [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertensive disorder", onset: date(Math.round(uni(r, 300, 2500))) }] : []),
        ...(tg > 170 ? [{ system: "http://snomed.info/sct", code: "55822004", display: "Hyperlipidemia" }] : []),
      ],
      medications: s.meds.map((m) => ({ name: m.name, drug_class: m.drug_class, dose: m.dose, times: m.times })),
      genetics: [
        { marker: "TCF7L2 rs7903146", value: pick(r, ["CC", "CT", "CT", "TT"]), note: "Synthetic genotype. T allele associated with reduced insulin secretion; weak prior on β decline." },
        { marker: "T2D polygenic risk score", value: `${Math.round(uni(r, 20, 97))}th percentile`, note: "Synthetic score; used only as a weak prior." },
      ],
      twin: {
        updated_at: toISO(NOW),
        params: [
          param("SI", "Insulin sensitivity", "×10⁻⁴ /min per µU/mL", siMean, 0.22, pop.SI),
          param("SG", "Glucose effectiveness", "×10⁻² /min", uni(r, 1.4, 2.4), 0.15, pop.SG),
          param("beta", "β-cell responsiveness", "relative", betaMean, 0.2, pop.beta),
          param("EGP", "Hepatic glucose output", "mg/kg/min", s.archetype === "SIRD" || s.archetype === "IROD" ? uni(r, 2.2, 2.8) : uni(r, 1.7, 2.3), 0.12, pop.EGP),
          param("meal_rate", "Meal absorption time", "min", 45 * s.tauScale, 0.14, pop.meal_rate),
          param("dawn", "Dawn effect", "mg/dL", s.dawnAmp, 0.25, pop.dawn),
        ],
        fit: { mard_24h: r1(uni(r, 6.5, 11.5)), coverage_80_24h: r2(uni(r, 0.74, 0.88)) },
      },
    };

    write(`patients/${s.id}.json`, detail);
    write(`timeline/${s.id}.json`, timeline);
    write(`forecast/${s.id}.json`, forecast);
    write(`fhir/${s.id}.json`, bundleFromPatient(detail));

    // ---- what-if presets (deterministic re-simulation without process noise)
    const presets: string[] = [];
    const H = 300;
    const tGrid: number[] = [];
    for (let t = NOW; t <= NOW + H * MIN; t += STEP) tGrid.push(t);
    const dinner = world.meals.find((m) => m.kind === "dinner" && m.t > NOW && m.t < NOW + 6 * HOUR);
    const runScenario = (w: World, opts?: { sleepHours?: number }) => tGrid.map((t) => physio(s, w, t, drift, opts));
    const baseCurve = runScenario(world);
    const offset = truth[kNow] - baseCurve[0];
    const band = (curve: number[]): BandPoint[] =>
      curve.map((g0, j) => {
        const g = g0 + offset * Math.exp(-j / 18);
        const w = (6 + 0.07 * g) * Math.sqrt(j / 6 + 0.5);
        return { t: toISO(tGrid[j]), p10: r1(Math.max(40, g - w)), p50: r1(g), p90: r1(g + w * 1.1) };
      });
    const metricsOf = (b: BandPoint[]): WhatIfMetrics => {
      const p50 = b.map((x) => x.p50);
      const hypoP = Math.max(...b.map((x) => clamp((70 - x.p10) / 40 + 0.03, 0.01, 0.95)));
      return {
        peak: Math.round(Math.max(...p50)),
        nadir: Math.round(Math.min(...p50)),
        min_above_180: p50.filter((g) => g > 180).length * 5,
        min_below_70: p50.filter((g) => g < 70).length * 5,
        hypo_probability: r2(hypoP),
        tir: r1((p50.filter((g) => g >= 70 && g <= 180).length / p50.length) * 100),
      };
    };
    const narrate = (a: WhatIfMetrics, b: WhatIfMetrics, lead: string): string[] => {
      const out = [lead];
      const dp = b.peak - a.peak;
      out.push(Math.abs(dp) < 4 ? `Peak glucose essentially unchanged (${a.peak} → ${b.peak} mg/dL).` : `Peak glucose ${dp < 0 ? "falls" : "rises"} from ${a.peak} to ${b.peak} mg/dL (${dp > 0 ? "+" : ""}${dp}).`);
      const da = b.min_above_180 - a.min_above_180;
      if (da !== 0) out.push(`Time above 180 mg/dL ${da < 0 ? "shrinks" : "grows"} by ${Math.abs(da)} min over the next 5 h.`);
      const dh = b.hypo_probability - a.hypo_probability;
      out.push(Math.abs(dh) < 0.03 ? `Hypoglycaemia probability stays near ${Math.round(a.hypo_probability * 100)}%.` : `Hypoglycaemia probability ${dh > 0 ? "rises" : "falls"} from ${Math.round(a.hypo_probability * 100)}% to ${Math.round(b.hypo_probability * 100)}%.`);
      return out;
    };
    const emit = (name: string, w: World, lead: string, opts?: { sleepHours?: number }) => {
      const baseline = band(baseCurve);
      const scenario = band(runScenario(w, opts));
      const mA = metricsOf(baseline);
      const mB = metricsOf(scenario);
      const res: WhatIfResponse = { at: toISO(NOW), baseline, scenario, metrics: { baseline: mA, scenario: mB }, narrative: narrate(mA, mB, lead) };
      write(`whatif/${s.id}/${name}.json`, res);
      presets.push(name);
    };
    if (dinner) {
      const swapped = world.meals.map((m) =>
        m === dinner ? { ...m, items: [{ food_id: "bajra_roti", portions: 2 }, { food_id: "dal", portions: 1 }, { food_id: "mixed_sabzi", portions: 1 }] } : m,
      );
      emit("swap-rice-for-millet-roti", { ...world, meals: swapped }, "Dinner swapped for 2 bajra roti with dal and sabzi (lower glycaemic load).");
      emit("walk-15-after-dinner", { ...world, walks: [...world.walks, { t: dinner.t + 20 * MIN, dur: 15, intensity: "brisk" }] }, "Brisk 15-minute walk starting 20 minutes after dinner.");
    }
    const glim = world.doses.find((d) => d.med.name === "Glimepiride" && d.t > NOW && d.t < NOW + H * MIN);
    if (glim) emit("skip-glimepiride", { ...world, doses: world.doses.filter((d) => d !== glim) }, "Tonight's glimepiride dose skipped.");
    emit("short-sleep", world, "Last night's sleep set to 4.5 h (insulin sensitivity reduced next day).", { sleepHours: 4.5 });
    write(`whatif/${s.id}/index.json`, { presets });

    const ev = timeline.events;
    stats.push(
      `${s.id} ${s.archetype.padEnd(4)} A1c ${s.hba1c.toFixed(1)} eAG ${eag(s.hba1c).toFixed(0)} mean7 ${mg.toFixed(0)} TIR ${sh.in.toFixed(0)} TBR ${(sh.low + sh.vlow).toFixed(1)} CV ${cv.toFixed(0)} hyperL2 ${ev.filter((e) => e.kind === "hyper_l2").length} hypo ${ev.filter((e) => e.kind === "hypo_l1").length} alerts ${alerts.length} gain ${s.gain.toFixed(2)} risk ${level} ${s.meds.map((m) => m.name).join("+")}`,
    );
  }

  write("cohort.json", { now: toISO(NOW), patients: cohort });
  write("metrics.json", mockMetrics());
  write("validation.json", mockValidation(cohort));
  console.log(stats.join("\n"));
  console.log(`\nWrote mock fixtures to ${OUT}`);
}

function erf(x: number) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** PLACEHOLDER numbers for layout work only — the UI stamps these as mock. */
function mockMetrics(): Metrics {
  const r = mulberry32(4242);
  const calib = (bias: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const pred = (i + 0.5) / 10;
      return { pred: r2(pred), obs: r2(clamp(pred + bias * Math.sin(pred * Math.PI) + gauss(r, 0, 0.025), 0, 1)), n: Math.round(4000 / (1 + i * 1.6)) };
    });
  const hist = (peak: number, max: number) =>
    Array.from({ length: Math.round(max / 10) }, (_, i) => ({ min: i * 10, count: Math.round(120 * Math.exp(-(((i * 10 - peak) / (max / 3)) ** 2)) + uni(r, 0, 8)) }));
  return {
    generated_at: toISO(NOW),
    dataset: { patients: 240, days: 28, train_patients: 168, val_patients: 36, test_patients: 36, cgm_points: 240 * 28 * 288, subtype_counts: { IROD: 94, SIDD: 62, MARD: 53, SIRD: 31 } },
    tasks: {
      hyper_2h: { prevalence: 0.083, auroc: 0.912, auprc: 0.611, brier: 0.052, operating_point: { threshold: 0.42, sensitivity: 0.78, precision: 0.46, alerts_per_patient_day: 0.92, median_lead_min: 74 }, calibration: calib(0.04), lead_time_hist: hist(70, 120) },
      hypo_1h: { prevalence: 0.021, auroc: 0.934, auprc: 0.402, brier: 0.017, operating_point: { threshold: 0.3, sensitivity: 0.71, precision: 0.33, alerts_per_patient_day: 0.41, median_lead_min: 32 }, calibration: calib(-0.03), lead_time_hist: hist(30, 60) },
      nocturnal_hypo: { prevalence: 0.064, auroc: 0.861, auprc: 0.388, brier: 0.049, operating_point: { threshold: 0.3, sensitivity: 0.66, precision: 0.38, alerts_per_patient_day: 0.12, median_lead_min: 212 }, calibration: calib(0.05), lead_time_hist: hist(200, 420) },
    },
    ablation: [
      { model: "cgm_linear", hyper_2h_auroc: 0.781, hypo_1h_auroc: 0.842, nocturnal_hypo_auroc: 0.612, hyper_2h_auprc: 0.322, hypo_1h_auprc: 0.191 },
      { model: "ml_no_twin", hyper_2h_auroc: 0.874, hypo_1h_auroc: 0.902, nocturnal_hypo_auroc: 0.803, hyper_2h_auprc: 0.501, hypo_1h_auprc: 0.311 },
      { model: "twin_only", hyper_2h_auroc: 0.861, hypo_1h_auroc: 0.889, nocturnal_hypo_auroc: 0.792, hyper_2h_auprc: 0.488, hypo_1h_auprc: 0.296 },
      { model: "hybrid", hyper_2h_auroc: 0.912, hypo_1h_auroc: 0.934, nocturnal_hypo_auroc: 0.861, hyper_2h_auprc: 0.611, hypo_1h_auprc: 0.402 },
    ],
    forecast: {
      horizons_min: [30, 60, 120],
      rmse: [13.8, 22.9, 34.6],
      mard: [7.1, 11.6, 17.9],
      coverage_80: [0.82, 0.8, 0.77],
      parkes: [
        { horizon_min: 30, A: 91.2, B: 8.4, C: 0.4, D: 0, E: 0 },
        { horizon_min: 60, A: 80.5, B: 18.3, C: 1.2, D: 0, E: 0 },
        { horizon_min: 120, A: 66.9, B: 30.1, C: 2.8, D: 0.2, E: 0 },
      ],
      baseline_rmse: [18.6, 33.4, 57.2],
    },
    top_features: [
      { task: "hyper_2h", feature: "twin_p90_120", label: "Twin p90 at +2 h", mean_abs_contrib: 0.81 },
      { task: "hyper_2h", feature: "carbs_on_board", label: "Carbs on board", mean_abs_contrib: 0.62 },
      { task: "hyper_2h", feature: "cgm_level", label: "Current glucose", mean_abs_contrib: 0.55 },
      { task: "hyper_2h", feature: "cgm_slope_30", label: "30-min trend", mean_abs_contrib: 0.41 },
      { task: "hypo_1h", feature: "twin_p10_60", label: "Twin p10 at +1 h", mean_abs_contrib: 0.92 },
      { task: "hypo_1h", feature: "su_active", label: "Sulfonylurea active", mean_abs_contrib: 0.58 },
      { task: "hypo_1h", feature: "cgm_slope_30", label: "30-min trend", mean_abs_contrib: 0.47 },
      { task: "nocturnal_hypo", feature: "bedtime_glucose", label: "Bedtime glucose", mean_abs_contrib: 0.77 },
      { task: "nocturnal_hypo", feature: "su_active", label: "Sulfonylurea / basal insulin overnight", mean_abs_contrib: 0.64 },
    ],
  };
}

function mockValidation(cohort: CohortPatient[]) {
  const by: Record<string, CohortPatient[]> = {};
  for (const p of cohort) (by[p.inferred_subtype] ??= []).push(p);
  return {
    generated_at: toISO(NOW),
    note: "Mock fixture — structure guessed; the engine's cohort_validation.json replaces this.",
    per_archetype: Object.entries(by).map(([archetype, ps]) => ({
      archetype,
      n: ps.length,
      mean_glucose: r1(mean(ps.map((p) => p.mean_glucose_7d))!),
      adag_from_hba1c: r1(mean(ps.map((p) => eag(p.hba1c)))!),
      tir_median: r1(median(ps.map((p) => p.tir_7d))),
      cv_median: r1(median(ps.map((p) => p.cv_7d))),
    })),
  };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

main();
