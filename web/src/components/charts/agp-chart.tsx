"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useId, useMemo, useState } from "react";

import type { AgpBin } from "@/lib/series";

import { EcgPattern, YAxis } from "./primitives";
import { useSize } from "./use-size";

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const lbl = (h: number) => (h === 0 || h === 24 ? "00:00" : `${String(h).padStart(2, "0")}:00`);

/** Ambulatory glucose profile (5/25/50/75/95 percentiles by time of day). */
export function AgpChart({ bins, height = 240 }: { bins: AgpBin[]; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<AgpBin | null>(null);
  const M = { l: 34, r: 10, t: 10, b: 24 };
  const valid = bins.filter((b) => !Number.isNaN(b.p50));
  const yMax = Math.min(400, Math.max(300, Math.ceil((Math.max(...valid.map((b) => b.p95), 0) + 10) / 50) * 50));

  const g = useMemo(() => {
    if (width <= 0) return null;
    const x = scaleLinear().domain([0, 1440]).range([M.l, width - M.r]);
    const y = scaleLinear().domain([40, yMax]).range([height - M.b, M.t]).clamp(true);
    const outer = area<AgpBin>().x((d) => x(d.minute)).y0((d) => y(d.p05)).y1((d) => y(d.p95)).curve(curveMonotoneX)(valid) ?? "";
    const inner = area<AgpBin>().x((d) => x(d.minute)).y0((d) => y(d.p25)).y1((d) => y(d.p75)).curve(curveMonotoneX)(valid) ?? "";
    const mid = line<AgpBin>().x((d) => x(d.minute)).y((d) => y(d.p50)).curve(curveMonotoneX)(valid) ?? "";
    return { x, y, outer, inner, mid };
  }, [width, height, valid, yMax, M.l, M.r, M.t, M.b]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {g && (
        <svg
          width={width}
          height={height}
          className="block"
          role="img"
          aria-label="Ambulatory glucose profile: median and percentile bands by time of day"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const m = g.x.invert(e.clientX - box.left);
            const b = valid.reduce((best, c) => (Math.abs(c.minute - m) < Math.abs(best.minute - m) ? c : best), valid[0]);
            setHover(b ?? null);
          }}
        >
          <EcgPattern id={`agp-${uid}`} />
          <rect x={M.l} y={M.t} width={width - M.l - M.r} height={height - M.t - M.b} fill={`url(#agp-${uid})`} />
          <rect x={M.l} width={width - M.l - M.r} y={g.y(180)} height={g.y(70) - g.y(180)} fill="var(--range-wash)" />
          <YAxis y={g.y} ticks={[70, 180, 250].filter((v) => v < yMax)} x={M.l} width={width - M.l - M.r} />
          <line x1={M.l} x2={width - M.r} y1={g.y(70)} y2={g.y(70)} stroke="var(--r-low)" strokeOpacity={0.6} />
          <line x1={M.l} x2={width - M.r} y1={g.y(180)} y2={g.y(180)} stroke="var(--r-high)" strokeOpacity={0.7} />
          <path d={g.outer} fill="var(--twin-band)" />
          <path d={g.inner} fill="var(--twin-band-2)" />
          <path d={g.mid} fill="none" stroke="var(--twin)" strokeWidth={2} strokeLinecap="round" />
          {HOURS.filter((h) => width > 480 || h % 6 === 0).map((h) => (
            <text key={h} x={g.x(h * 60)} y={height - 6} textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"} className="num fill-muted-ink" style={{ fontSize: 10 }}>
              {lbl(h)}
            </text>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={g.x(hover.minute)} x2={g.x(hover.minute)} y1={M.t} y2={height - M.b} stroke="var(--ink)" strokeOpacity={0.4} />
              <circle cx={g.x(hover.minute)} cy={g.y(hover.p50)} r={4} fill="var(--twin)" stroke="var(--card)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hover && g && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-xl border border-line bg-card/95 px-2.5 py-2 text-[11.5px] shadow-[var(--shadow-soft)]"
          style={{ left: Math.min(Math.max(g.x(hover.minute) + 10, 0), width - 150) }}
        >
          <div className="label-xs mb-1">
            {String(Math.floor((hover.minute - 7.5) / 60)).padStart(2, "0")}:{String((hover.minute - 7.5) % 60).padStart(2, "0")} · n={hover.n}
          </div>
          <div className="num grid grid-cols-[auto_auto] gap-x-3">
            <span className="text-muted-ink">95th</span>
            <span className="text-right">{Math.round(hover.p95)}</span>
            <span className="text-muted-ink">75th</span>
            <span className="text-right">{Math.round(hover.p75)}</span>
            <span className="text-ink">Median</span>
            <span className="text-right font-semibold">{Math.round(hover.p50)}</span>
            <span className="text-muted-ink">25th</span>
            <span className="text-right">{Math.round(hover.p25)}</span>
            <span className="text-muted-ink">5th</span>
            <span className="text-right">{Math.round(hover.p05)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
