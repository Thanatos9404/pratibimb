import type { ScaleLinear } from "d3-scale";

import { cn } from "@/lib/utils";
import { DAY, HOUR, fmtDay, fmtTime, istMidnight } from "@/lib/time";

/** Soft plot backdrop: a faint sky wash that fades to the card (OBLIQ chart chrome). */
export function EcgPattern({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--twin)" stopOpacity="0.045" />
        <stop offset="1" stopColor="var(--twin)" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

/** IST-aligned time ticks for a window. */
export function timeTicks(t0: number, t1: number, width: number): { t: number; label: string; major: boolean }[] {
  const span = t1 - t0;
  const candidates = [1, 2, 3, 4, 6, 12, 24].map((h) => h * HOUR);
  const target = Math.max(3, Math.floor(width / 90));
  const step = candidates.find((s) => span / s <= target) ?? DAY;
  const out: { t: number; label: string; major: boolean }[] = [];
  let t = istMidnight(t0);
  while (t < t0) t += step;
  for (; t <= t1; t += step) {
    const isMidnight = istMidnight(t) === t;
    out.push({ t, label: isMidnight ? fmtDay(t) : fmtTime(t), major: isMidnight });
  }
  return out;
}

export function YAxis({
  y,
  ticks,
  x,
  width,
  format = (v: number) => String(v),
  className,
}: {
  y: ScaleLinear<number, number>;
  ticks: number[];
  x: number;
  width: number;
  format?: (v: number) => string;
  className?: string;
}) {
  return (
    <g className={cn("text-[10px]", className)}>
      {ticks.map((v) => (
        <g key={v} transform={`translate(0 ${y(v)})`}>
          <line x1={x} x2={x + width} stroke="var(--grid)" strokeWidth={1} />
          <text x={x - 6} dy="0.32em" textAnchor="end" className="num fill-muted-ink">
            {format(v)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function LegendSwatch({ kind, color, label }: { kind: "dot" | "line" | "band" | "dash" | "rect"; color: string; label: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-ink">
      <svg width="16" height="10" aria-hidden className="shrink-0">
        {kind === "dot" && <circle cx="8" cy="5" r="2.6" fill={color} />}
        {kind === "line" && <line x1="1" x2="15" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />}
        {kind === "dash" && <line x1="1" x2="15" y1="5" y2="5" stroke={color} strokeWidth="1.6" strokeDasharray="3 2.5" />}
        {kind === "band" && <rect x="1" y="1.5" width="14" height="7" rx="1.5" fill={color} />}
        {kind === "rect" && <rect x="3" y="0.5" width="10" height="9" rx="1" fill={color} />}
      </svg>
      {label}
    </span>
  );
}

/** Binary search: index of the last element with t <= target. */
export function bisectT<T extends { t: number }>(arr: T[], target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (hi < 0 || arr[0].t > target) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].t <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function nearestT<T extends { t: number }>(arr: T[], target: number, maxGap = 10 * 60_000): T | null {
  const i = bisectT(arr, target);
  const a = i >= 0 ? arr[i] : null;
  const b = i + 1 < arr.length ? arr[i + 1] : null;
  let best: T | null = null;
  if (a && b) best = Math.abs(a.t - target) <= Math.abs(b.t - target) ? a : b;
  else best = a ?? b;
  if (!best || Math.abs(best.t - target) > maxGap) return null;
  return best;
}

/** Vertical gradient that colours a stroke by consensus glucose range (userSpaceOnUse). */
export function RangeGradient({ id, y }: { id: string; y: ScaleLinear<number, number> }) {
  const [y0, y1] = y.range();
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const span = bottom - top || 1;
  const off = (v: number) => Math.min(1, Math.max(0, (y(v) - top) / span));
  const stops: [number, string][] = [
    [off(400), "var(--r-vhigh)"],
    [off(250), "var(--r-vhigh)"],
    [off(250), "var(--r-high)"],
    [off(180), "var(--r-high)"],
    [off(180), "var(--r-in)"],
    [off(70), "var(--r-in)"],
    [off(70), "var(--r-low)"],
    [off(54), "var(--r-low)"],
    [off(54), "var(--r-vlow)"],
    [off(0), "var(--r-vlow)"],
  ];
  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={top} y2={bottom}>
        {stops.map(([o, c], i) => (
          <stop key={i} offset={o} stopColor={c} />
        ))}
      </linearGradient>
    </defs>
  );
}
