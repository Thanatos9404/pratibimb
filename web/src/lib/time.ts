/**
 * Deterministic IST time helpers. We never rely on the browser's locale or
 * timezone so that server and client render identical strings.
 */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const IST_OFFSET = 5.5 * HOUR;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

export function ms(iso: string): number {
  return Date.parse(iso);
}

/** Epoch ms -> ISO string with +05:30 offset, e.g. 2026-10-12T19:30:00+05:30 */
export function toISO(t: number): string {
  const d = new Date(t + IST_OFFSET);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+05:30`
  );
}

function istParts(t: number) {
  const d = new Date(t + IST_OFFSET);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    wd: d.getUTCDay(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
}

/** Minutes since IST midnight, 0..1439 */
export function istMinuteOfDay(t: number): number {
  const p = istParts(t);
  return p.h * 60 + p.mi;
}

/** Epoch ms of IST midnight for the day containing t */
export function istMidnight(t: number): number {
  return t - (((t + IST_OFFSET) % DAY) + DAY) % DAY;
}

export function fmtTime(t: number): string {
  const p = istParts(t);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function fmtDay(t: number): string {
  const p = istParts(t);
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.mo]}`;
}

export function fmtDateLong(t: number): string {
  const p = istParts(t);
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.mo]} ${p.y}`;
}

export function fmtDate(t: number): string {
  const p = istParts(t);
  return `${p.d} ${MONTHS[p.mo]} ${p.y}`;
}

export function fmtDayTime(t: number): string {
  return `${fmtDay(t)} · ${fmtTime(t)}`;
}

/** "2 h 15 min", "45 min" */
export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** Relative label vs a reference clock: "12 min ago", "in 40 min" */
export function fmtRelative(t: number, now: number): string {
  const diff = Math.round((t - now) / MIN);
  if (Math.abs(diff) < 1) return "now";
  if (diff < 0) {
    const a = -diff;
    if (a < 60) return `${a} min ago`;
    if (a < 48 * 60) return `${Math.round(a / 60)} h ago`;
    return `${Math.round(a / 1440)} d ago`;
  }
  if (diff < 60) return `in ${diff} min`;
  return `in ${Math.round(diff / 60)} h`;
}
