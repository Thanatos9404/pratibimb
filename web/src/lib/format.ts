/** Formatting helpers. Anything missing renders as an em dash — never a made-up number. */

export const DASH = "—";

const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function num(v: unknown, digits = 0): string {
  return ok(v) ? v.toFixed(digits) : DASH;
}

/** Fraction 0–1 rendered as a percent: 0.734 -> "73%" */
export function pct01(v: unknown, digits = 0): string {
  return ok(v) ? `${(v * 100).toFixed(digits)}%` : DASH;
}

/** Already a percent 0–100: 62.4 -> "62%" */
export function pct(v: unknown, digits = 0): string {
  return ok(v) ? `${v.toFixed(digits)}%` : DASH;
}

/** Thousands separators, Indian grouping (12,34,567), deterministic. */
export function grouped(v: unknown): string {
  if (!ok(v)) return DASH;
  const n = Math.round(v);
  const sign = n < 0 ? "-" : "";
  const s = String(Math.abs(n));
  if (s.length <= 3) return sign + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${rest},${last3}`;
}

export function signed(v: unknown, digits = 0, unit = ""): string {
  if (!ok(v)) return DASH;
  const s = v.toFixed(digits);
  const zero = Number(s) === 0;
  return `${v > 0 && !zero ? "+" : ""}${zero ? (0).toFixed(digits) : s.replace("-", "−")}${unit}`;
}

export function isNum(v: unknown): v is number {
  return ok(v);
}
