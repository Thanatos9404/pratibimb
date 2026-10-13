import type { Trend } from "@/lib/api/types";

/** Battelino et al., Diabetes Care 2019 consensus thresholds (mg/dL). */
export const T = {
  veryLow: 54,
  low: 70,
  high: 180,
  veryHigh: 250,
} as const;

export type RangeKey = "vlow" | "low" | "in" | "high" | "vhigh";

export const RANGE_LABEL: Record<RangeKey, string> = {
  vlow: "Very low  <54",
  low: "Low  54–69",
  in: "In range  70–180",
  high: "High  181–250",
  vhigh: "Very high  >250",
};

export const RANGE_SHORT: Record<RangeKey, string> = {
  vlow: "<54",
  low: "54–69",
  in: "70–180",
  high: "181–250",
  vhigh: ">250",
};

/** CSS variable for each clinical range (defined in globals.css, theme-aware). */
export const RANGE_VAR: Record<RangeKey, string> = {
  vlow: "var(--r-vlow)",
  low: "var(--r-low)",
  in: "var(--r-in)",
  high: "var(--r-high)",
  vhigh: "var(--r-vhigh)",
};

export function rangeOf(g: number): RangeKey {
  if (g < T.veryLow) return "vlow";
  if (g < T.low) return "low";
  if (g <= T.high) return "in";
  if (g <= T.veryHigh) return "high";
  return "vhigh";
}

export function rangeColor(g: number | null | undefined): string {
  if (g == null || Number.isNaN(g)) return "var(--muted-foreground)";
  return RANGE_VAR[rangeOf(g)];
}

export interface RangeShares {
  vlow: number;
  low: number;
  in: number;
  high: number;
  vhigh: number;
  n: number;
}

/** Percent (0–100) of valid readings in each consensus range. */
export function rangeShares(values: (number | null)[]): RangeShares {
  const s = { vlow: 0, low: 0, in: 0, high: 0, vhigh: 0, n: 0 };
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    s[rangeOf(v)]++;
    s.n++;
  }
  if (s.n === 0) return s;
  return {
    vlow: (s.vlow / s.n) * 100,
    low: (s.low / s.n) * 100,
    in: (s.in / s.n) * 100,
    high: (s.high / s.n) * 100,
    vhigh: (s.vhigh / s.n) * 100,
    n: s.n,
  };
}

export function mean(values: (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    sum += v;
    n++;
  }
  return n ? sum / n : null;
}

export function sd(values: (number | null)[]): number | null {
  const m = mean(values);
  if (m == null) return null;
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    s += (v - m) ** 2;
    n++;
  }
  return n > 1 ? Math.sqrt(s / (n - 1)) : null;
}

/** Glucose management indicator (%), Bergenstal et al. 2018. */
export function gmi(meanGlucose: number): number {
  return 3.31 + 0.02392 * meanGlucose;
}

/** ADAG estimated average glucose (mg/dL) from HbA1c (%). */
export function eag(hba1c: number): number {
  return 28.7 * hba1c - 46.7;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const TREND_ARROW: Record<Trend, string> = {
  rising_fast: "↑↑",
  rising: "↗",
  flat: "→",
  falling: "↘",
  falling_fast: "↓↓",
};

export const TREND_LABEL: Record<Trend, string> = {
  rising_fast: "Rising fast",
  rising: "Rising",
  flat: "Steady",
  falling: "Falling",
  falling_fast: "Falling fast",
};

/** Rotation in degrees for an arrow glyph pointing right (→). */
export const TREND_ROTATION: Record<Trend, number> = {
  rising_fast: -90,
  rising: -45,
  flat: 0,
  falling: 45,
  falling_fast: 90,
};

export function trendFromSlope(mgPerMin: number): Trend {
  if (mgPerMin > 2) return "rising_fast";
  if (mgPerMin > 1) return "rising";
  if (mgPerMin < -2) return "falling_fast";
  if (mgPerMin < -1) return "falling";
  return "flat";
}
