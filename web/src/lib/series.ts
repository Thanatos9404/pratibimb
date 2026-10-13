import type { Alert, Dose, Forecast, GlycemicEvent, Meal, Risk, SleepStage, Timeline } from "@/lib/api/types";
import { quantile } from "@/lib/glucose";
import { DAY, MIN, istMinuteOfDay, ms } from "@/lib/time";

export type Pt = { t: number; v: number };
export type GPt = { t: number; g: number | null };
export type BandPt = { t: number; p10: number; p50: number; p90: number };
export type QPt = { t: number; p05: number; p25: number; p50: number; p75: number; p95: number };

export interface Series {
  from: number;
  to: number;
  cgm: GPt[];
  twin: BandPt[];
  hr: Pt[];
  hrv: Pt[];
  steps: Pt[];
  sleep: { start: number; end: number; stage: SleepStage }[];
  sleepPeriods: { start: number; end: number }[];
  meals: (Meal & { ms: number })[];
  doses: (Dose & { ms: number })[];
  alerts: (Alert & { ms: number })[];
  events: (GlycemicEvent & { startMs: number; endMs: number })[];
  walks: { start: number; end: number; steps: number; intensity: "light" | "brisk" }[];
  /** 15-min risk series (export extra); empty when absent */
  risk: ({ t: number } & Pick<Risk, "hyper_2h" | "hypo_1h" | "nocturnal_hypo" | "level">)[];
}

const byT = <T extends { t: number }>(a: T, b: T) => a.t - b.t;

export function parseTimeline(tl: Timeline): Series {
  const sleep = tl.sleep.map((s) => ({ start: ms(s.start), end: ms(s.end), stage: s.stage })).sort((a, b) => a.start - b.start);
  const steps = tl.steps.map((p) => ({ t: ms(p.t), v: p.count })).sort(byT);
  return {
    from: ms(tl.from),
    to: ms(tl.to),
    cgm: tl.cgm.map((p) => ({ t: ms(p.t), g: p.g })).sort(byT),
    twin: tl.twin.map((p) => ({ t: ms(p.t), p10: p.p10, p50: p.p50, p90: p.p90 })).sort(byT),
    hr: tl.hr.map((p) => ({ t: ms(p.t), v: p.bpm })).sort(byT),
    hrv: tl.hrv.map((p) => ({ t: ms(p.t), v: p.rmssd })).sort(byT),
    steps,
    sleep,
    sleepPeriods: mergeSleep(sleep),
    meals: tl.meals.map((m) => ({ ...m, ms: ms(m.t) })).sort((a, b) => a.ms - b.ms),
    doses: tl.doses.map((d) => ({ ...d, ms: ms(d.t) })).sort((a, b) => a.ms - b.ms),
    alerts: tl.alerts.map((a) => ({ ...a, ms: ms(a.t) })).sort((a, b) => a.ms - b.ms),
    events: tl.events.map((e) => ({ ...e, startMs: ms(e.start), endMs: ms(e.end) })).sort((a, b) => a.startMs - b.startMs),
    walks: detectWalks(steps),
    risk: (tl.risk ?? []).map((r) => ({ t: ms(r.t), hyper_2h: r.hyper_2h, hypo_1h: r.hypo_1h, nocturnal_hypo: r.nocturnal_hypo, level: r.level })).sort(byT),
  };
}

export function parseForecast(f: Forecast): { at: number; q: QPt[]; mech: Pt[] } {
  return {
    at: ms(f.at),
    q: f.quantiles.map((p) => ({ t: ms(p.t), p05: p.p05, p25: p.p25, p50: p.p50, p75: p.p75, p95: p.p95 })).sort(byT),
    mech: f.mechanistic_p50.map((p) => ({ t: ms(p.t), v: p.g })).sort(byT),
  };
}

function mergeSleep(segs: { start: number; end: number; stage: SleepStage }[]) {
  const out: { start: number; end: number }[] = [];
  for (const s of segs) {
    const last = out.at(-1);
    if (last && s.start - last.end <= 30 * MIN) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out.filter((p) => p.end - p.start >= 60 * MIN);
}

/** Walks = runs of 5-min bins with ≥250 steps lasting ≥10 min. */
function detectWalks(steps: Pt[]) {
  const out: Series["walks"] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const total = run.reduce((a, p) => a + p.v, 0);
      out.push({ start: run[0].t, end: run[run.length - 1].t + 5 * MIN, steps: total, intensity: total / run.length >= 470 ? "brisk" : "light" });
    }
    run = [];
  };
  for (const p of steps) {
    if (p.v >= 250 && (run.length === 0 || p.t - run[run.length - 1].t <= 5 * MIN)) run.push(p);
    else {
      flush();
      if (p.v >= 250) run.push(p);
    }
  }
  flush();
  return out;
}

/** Index of first element with t > clock (for slicing arrays sorted by t). */
export function upto<T extends { t: number }>(arr: T[], clock: number): T[] {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= clock) lo = mid + 1;
    else hi = mid;
  }
  return lo === arr.length ? arr : arr.slice(0, lo);
}

export function between<T extends { t: number }>(arr: T[], a: number, b: number): T[] {
  return upto(arr, b).filter((p) => p.t >= a);
}

/** Restrict a full series to what is knowable at `clock`. */
export function seriesAt(s: Series, clock: number): Series {
  return {
    ...s,
    cgm: upto(s.cgm, clock),
    twin: upto(s.twin, clock),
    hr: upto(s.hr, clock),
    hrv: upto(s.hrv, clock),
    steps: upto(s.steps, clock),
    sleep: s.sleep.filter((x) => x.start <= clock).map((x) => (x.end > clock ? { ...x, end: clock } : x)),
    sleepPeriods: s.sleepPeriods.filter((x) => x.start <= clock).map((x) => (x.end > clock ? { ...x, end: clock } : x)),
    meals: s.meals.filter((m) => m.ms <= clock),
    doses: s.doses.filter((d) => d.ms <= clock),
    alerts: s.alerts.filter((a) => a.ms <= clock),
    events: s.events.filter((e) => e.startMs <= clock).map((e) => (e.endMs > clock ? { ...e, endMs: clock } : e)),
    walks: s.walks.filter((w) => w.start <= clock).map((w) => (w.end > clock ? { ...w, end: clock } : w)),
    risk: upto(s.risk, clock),
  };
}

export const ALERT_WINDOW_MIN: Record<Alert["kind"], number> = {
  hyper_2h: 120,
  hypo_1h: 60,
  nocturnal_hypo: 8 * 60,
};

export function leadAt(a: Alert & { ms: number }, clock: number): number | null {
  const o = outcomeAt(a, clock);
  if (o !== "true_positive") return null;
  return a.lead_min_final ?? a.lead_min ?? null;
}

/** An outcome is unknowable until its prediction window has closed at `clock`. */
export function outcomeAt(a: Alert & { ms: number }, clock: number): Alert["outcome"] {
  // export extra: resolves_at + outcome_final let a replay reveal outcomes as their windows close
  if (a.resolves_at && a.outcome_final) {
    if (ms(a.resolves_at) <= clock) return a.outcome_final;
    const lead = a.lead_min_final ?? null;
    if (a.outcome_final === "true_positive" && lead != null && a.ms + lead * MIN <= clock) return "true_positive";
    return "pending";
  }
  if (a.outcome === "pending") return "pending";
  if (a.ms + ALERT_WINDOW_MIN[a.kind] * MIN > clock) {
    // a true positive whose event has already started is known early
    if (a.outcome === "true_positive" && a.lead_min != null && a.ms + a.lead_min * MIN <= clock) return "true_positive";
    return "pending";
  }
  return a.outcome;
}

// ------------------------------------------------------------------ AGP
export interface AgpBin {
  minute: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  n: number;
}

/** Ambulatory glucose profile: 15-min time-of-day bins, lightly smoothed (circular, 5 bins). */
export function computeAgp(cgm: GPt[]): { bins: AgpBin[]; days: number; coverage: number } {
  const B = 96;
  const buckets: number[][] = Array.from({ length: B }, () => []);
  let valid = 0;
  for (const p of cgm) {
    if (p.g == null) continue;
    buckets[Math.floor(istMinuteOfDay(p.t) / 15) % B].push(p.g);
    valid++;
  }
  const raw = buckets.map((b) => {
    const s = [...b].sort((x, y) => x - y);
    return { p05: quantile(s, 0.05), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p95: quantile(s, 0.95), n: s.length };
  });
  const keys = ["p05", "p25", "p50", "p75", "p95"] as const;
  const bins: AgpBin[] = raw.map((_, i) => {
    const o: AgpBin = { minute: i * 15 + 7.5, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, n: raw[i].n };
    for (const k of keys) {
      let sum = 0;
      let w = 0;
      for (let d = -2; d <= 2; d++) {
        const r = raw[(i + d + B) % B];
        if (r.n === 0 || Number.isNaN(r[k])) continue;
        const wt = 3 - Math.abs(d);
        sum += r[k] * wt;
        w += wt;
      }
      o[k] = w ? sum / w : NaN;
    }
    return o;
  });
  const span = cgm.length ? cgm[cgm.length - 1].t - cgm[0].t : 0;
  const expected = span / (5 * MIN) + 1;
  return { bins, days: Math.round(span / DAY), coverage: expected > 0 ? valid / expected : 0 };
}

export function lastNight(s: Series, clock: number) {
  const p = [...s.sleepPeriods].reverse().find((x) => x.start <= clock && clock - x.end < 20 * 60 * MIN);
  if (!p) return null;
  const segs = s.sleep.filter((x) => x.start >= p.start - 1 && x.end <= p.end + 1);
  const dur = (st: SleepStage) => segs.filter((x) => x.stage === st).reduce((a, x) => a + (x.end - x.start), 0) / MIN;
  const total = (p.end - p.start) / MIN;
  const asleep = total - dur("wake");
  return { ...p, segs, totalMin: total, asleepMin: asleep, deepMin: dur("deep"), remMin: dur("rem"), lightMin: dur("light"), wakeMin: dur("wake"), efficiency: total ? asleep / total : 0 };
}
