import "server-only";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CohortResponse, Food, Forecast, Metrics, PatientDetail, Timeline, WhatIfResponse } from "@/lib/api/types";
import { HOUR, ms } from "@/lib/time";

/**
 * Build-time data for the landing page, read from the engine's static export
 * (public/demo) or, failing that, the dev fixtures (public/mock).
 */
const PUB = path.join(process.cwd(), "public");

function base(): { dir: string; kind: "demo" | "mock" } | null {
  if (existsSync(path.join(PUB, "demo", "cohort.json"))) return { dir: path.join(PUB, "demo"), kind: "demo" };
  if (existsSync(path.join(PUB, "mock", "cohort.json"))) return { dir: path.join(PUB, "mock"), kind: "mock" };
  return null;
}

function read<T>(dir: string, rel: string): T | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, rel), "utf8")) as T;
  } catch {
    return null;
  }
}

export interface MiniPoint {
  t: number;
  g: number | null;
}
export interface LandingData {
  kind: "demo" | "mock";
  now: number;
  cohort: CohortResponse["patients"];
  metrics: Metrics | null;
  foodsCount: number;
  hero: {
    patient: Pick<PatientDetail, "id" | "display_name" | "age" | "sex" | "inferred_subtype" | "meds" | "risk" | "tir_7d" | "last_glucose" | "trend" | "hba1c" | "bmi" | "region"> & {
      mard: number;
      coverage: number;
      labs: PatientDetail["labs"];
      params: PatientDetail["twin"]["params"];
    };
    hr: { t: number; v: number }[];
    steps: { t: number; v: number }[];
    hrv: { t: number; v: number }[];
    sleep: { start: number; end: number; stage: string }[];
    drivers: Forecast["drivers"] | null;
    cgm: MiniPoint[];
    twin: { t: number; p10: number; p50: number; p90: number }[];
    q: { t: number; p05: number; p25: number; p50: number; p75: number; p95: number }[];
    meals: { t: number; carbs: number }[];
    alerts: { t: number; kind: string; p: number; outcome: string; lead: number | null; label: string; drivers: { label: string; value_text: string; contribution: number }[]; reco: string }[];
  } | null;
  whatif: {
    patientId: string;
    patientName: string;
    label: string;
    baselineFoods: string[];
    scenarioFoods: string[];
    res: WhatIfResponse;
  } | null;
  scenarios: { id: string; name: string; age: number; sex: string; meds: string[]; why: string; risk: CohortResponse["patients"][number]["risk"]; subtype: string }[];
  foods: Pick<Food, "name" | "name_hi" | "gi" | "carbs_g" | "serving_desc">[];
}

type PresetIndex = { presets: (string | { id: string; label?: string; request?: { baseline_meals?: { items: { food_id: string }[] }[]; scenario?: { meals?: { items: { food_id: string }[] }[] } } })[] };

export function loadLandingData(): LandingData | null {
  const b = base();
  if (!b) return null;
  const cohort = read<CohortResponse>(b.dir, "cohort.json");
  const clock = read<{ now: string }>(b.dir, "clock.json");
  if (!cohort || !clock) return null;
  const now = ms(clock.now);
  const metrics = read<Metrics>(b.dir, "metrics.json");
  const foodsAll = read<{ foods: Food[] }>(b.dir, "foods.json")?.foods ?? [];
  const foodName = (id: string) => foodsAll.find((f) => f.id === id)?.name ?? id.replace(/_/g, " ");
  const manifest = read<{ patients: { id: string; why: string[] }[] }>(b.dir, "manifest.json");

  // What-If showcase: the swap preset with the largest drop in peak glucose
  let whatif: LandingData["whatif"] = null;
  let best = -Infinity;
  for (const p of cohort.patients) {
    const idx = read<PresetIndex>(b.dir, `whatif/${p.id}/index.json`);
    const entry = idx?.presets.find((x) => (typeof x === "string" ? x : x.id) === "swap-rice-for-millet-roti");
    if (!entry) continue;
    const res = read<WhatIfResponse>(b.dir, `whatif/${p.id}/swap-rice-for-millet-roti.json`);
    if (!res) continue;
    // prefer a typical patient (planned-dinner peak < 320 mg/dL) with the clearest improvement
    const drop = res.metrics.baseline.peak - res.metrics.scenario.peak - (res.metrics.baseline.peak >= 320 ? 1000 : 0);
    if (drop > best) {
      best = drop;
      const req = typeof entry === "string" ? undefined : entry.request;
      whatif = {
        patientId: p.id,
        patientName: p.display_name,
        label: typeof entry === "string" ? "Swap rice for millet roti at dinner" : (entry.label ?? entry.id),
        baselineFoods: (req?.baseline_meals?.[0]?.items ?? []).map((i) => foodName(i.food_id)),
        scenarioFoods: (req?.scenario?.meals?.[0]?.items ?? []).map((i) => foodName(i.food_id)),
        res,
      };
    }
  }

  // Hero patient: the what-if showcase patient if available, else the highest-risk one
  const heroId = whatif?.patientId ?? [...cohort.patients].sort((a, c) => Math.max(c.risk.hyper_2h, c.risk.hypo_1h) - Math.max(a.risk.hyper_2h, a.risk.hypo_1h))[0]?.id;
  let hero: LandingData["hero"] = null;
  if (heroId) {
    const det = read<PatientDetail>(b.dir, `patients/${heroId}.json`);
    const tl = read<Timeline>(b.dir, `timeline/${heroId}.json`);
    const fc = read<Forecast>(b.dir, `forecast/${heroId}.json`);
    if (det && tl) {
      const from = now - 24 * HOUR;
      const win = <T extends { t: string }>(a: T[]) => a.filter((x) => ms(x.t) >= from && ms(x.t) <= now);
      hero = {
        patient: {
          id: det.id,
          display_name: det.display_name,
          age: det.age,
          sex: det.sex,
          inferred_subtype: det.inferred_subtype,
          meds: det.meds,
          risk: det.risk,
          tir_7d: det.tir_7d,
          last_glucose: det.last_glucose,
          trend: det.trend,
          mard: det.twin.fit.mard_24h,
          coverage: det.twin.fit.coverage_80_24h,
          hba1c: det.hba1c,
          bmi: det.bmi,
          region: det.region,
          labs: det.labs.filter((l, i, a) => a.findIndex((x) => x.name === l.name) === i).slice(0, 7),
          params: det.twin.params,
        },
        hr: win(tl.hr).map((p) => ({ t: ms(p.t), v: p.bpm })),
        steps: win(tl.steps).map((p) => ({ t: ms(p.t), v: p.count })),
        hrv: win(tl.hrv).map((p) => ({ t: ms(p.t), v: p.rmssd })),
        sleep: tl.sleep.filter((x) => ms(x.end) >= from && ms(x.start) <= now).map((x) => ({ start: ms(x.start), end: ms(x.end), stage: x.stage })),
        drivers: fc?.drivers ?? null,
        cgm: win(tl.cgm).map((p) => ({ t: ms(p.t), g: p.g })),
        twin: win(tl.twin).map((p) => ({ t: ms(p.t), p10: p.p10, p50: p.p50, p90: p.p90 })),
        q: (fc?.quantiles ?? []).map((p) => ({ t: ms(p.t), p05: p.p05, p25: p.p25, p50: p.p50, p75: p.p75, p95: p.p95 })),
        meals: win(tl.meals).map((m) => ({ t: ms(m.t), carbs: m.carbs_g })),
        alerts: tl.alerts
          .filter((a) => ms(a.t) <= now)
          .slice(-12)
          .map((a) => ({
            t: ms(a.t),
            kind: a.kind,
            p: a.probability,
            outcome: a.outcome,
            lead: a.lead_min ?? null,
            label: a.kind,
            drivers: a.drivers.slice(0, 3).map((d) => ({ label: d.label, value_text: d.value_text, contribution: d.contribution })),
            reco: a.recommendation,
          })),
      };
    }
  }

  const byId = new Map(cohort.patients.map((p) => [p.id, p]));
  const seenWhy = new Set<string>();
  const scenarios: LandingData["scenarios"] = [];
  for (const m of manifest?.patients ?? []) {
    const why = m.why.find((w) => !w.startsWith("split=")) ?? "";
    const key = why.replace(/\s*\(truth\)/, "");
    const p = byId.get(m.id);
    if (!p || !key || seenWhy.has(key) || key.startsWith("held-out") || key.startsWith("inferred")) continue;
    seenWhy.add(key);
    scenarios.push({ id: p.id, name: p.display_name, age: p.age, sex: p.sex, meds: p.meds, why: key, risk: p.risk, subtype: p.inferred_subtype });
  }

  const pickFoods = ["bajra_roti", "jowar_roti", "white_rice", "idli", "poha", "masala_dosa", "chai_sugar", "jalebi", "rajma", "ragi_mudde", "khichdi", "sprouts_salad"];
  const foods = foodsAll
    .filter((f) => pickFoods.includes(f.id))
    .concat(foodsAll.filter((f) => !pickFoods.includes(f.id)))
    .slice(0, 12)
    .map((f) => ({ name: f.name, name_hi: f.name_hi, gi: f.gi, carbs_g: f.carbs_g, serving_desc: f.serving_desc }));

  return { kind: b.kind, now, cohort: cohort.patients, metrics, foodsCount: foodsAll.length, hero, whatif, scenarios: scenarios.slice(0, 6), foods };
}
