"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { curveMonotoneX, curveStepAfter, line } from "d3-shape";
import { useMemo, useState } from "react";

import type { SleepStage } from "@/lib/api/types";
import type { Pt } from "@/lib/series";
import { HOUR, fmtTime } from "@/lib/time";

import { timeTicks } from "./primitives";
import { useSize } from "./use-size";

const STAGES: SleepStage[] = ["wake", "rem", "light", "deep"];
const STAGE_LABEL: Record<SleepStage, string> = { wake: "Awake", rem: "REM", light: "Light", deep: "Deep" };
const STAGE_COLOR: Record<SleepStage, string> = {
  wake: "var(--muted-ink)",
  rem: "color-mix(in oklab, var(--brown) 75%, var(--card))",
  light: "color-mix(in oklab, var(--twin) 55%, var(--card))",
  deep: "var(--twin)",
};

export function Hypnogram({ segs, height = 132 }: { segs: { start: number; end: number; stage: SleepStage }[]; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const M = { l: 44, r: 8, t: 6, b: 20 };
  const g = useMemo(() => {
    if (width <= 0 || segs.length === 0) return null;
    const t0 = segs[0].start;
    const t1 = segs[segs.length - 1].end;
    const x = scaleLinear().domain([t0, t1]).range([M.l, width - M.r]);
    const y = scaleBand<SleepStage>().domain(STAGES).range([M.t, height - M.b]).padding(0.35);
    const pts: [number, number][] = [];
    for (const s of segs) {
      const yc = (y(s.stage) ?? 0) + y.bandwidth() / 2;
      pts.push([x(s.start), yc]);
    }
    const last = segs[segs.length - 1];
    pts.push([x(last.end), (y(last.stage) ?? 0) + y.bandwidth() / 2]);
    const path = line().curve(curveStepAfter)(pts) ?? "";
    return { x, y, path, ticks: timeTicks(t0, t1, width - M.l - M.r) };
  }, [segs, width, height, M.l, M.r, M.t, M.b]);

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {g && (
        <svg width={width} height={height} role="img" aria-label="Hypnogram for last night">
          {STAGES.map((s) => (
            <g key={s}>
              <line x1={M.l} x2={width - M.r} y1={(g.y(s) ?? 0) + g.y.bandwidth() / 2} y2={(g.y(s) ?? 0) + g.y.bandwidth() / 2} stroke="var(--grid)" />
              <text x={M.l - 8} y={(g.y(s) ?? 0) + g.y.bandwidth() / 2} dy="0.32em" textAnchor="end" className="fill-muted-ink" style={{ fontSize: 10 }}>
                {STAGE_LABEL[s]}
              </text>
            </g>
          ))}
          <path d={g.path} fill="none" stroke="var(--line)" strokeWidth={1} />
          {segs.map((s) => (
            <rect
              key={s.start}
              x={g.x(s.start)}
              y={g.y(s.stage)}
              width={Math.max(1, g.x(s.end) - g.x(s.start))}
              height={g.y.bandwidth()}
              rx={1.5}
              fill={STAGE_COLOR[s.stage]}
              opacity={s.stage === "wake" ? 0.6 : 0.92}
            />
          ))}
          {g.ticks.map((t) => (
            <text key={t.t} x={g.x(t.t)} y={height - 5} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 10 }}>
              {t.label}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

/** Nightly mean RMSSD columns vs personal baseline (mean of the previous nights). */
export function HrvNights({ nights, height = 120 }: { nights: { label: string; rmssd: number }[]; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const M = { l: 30, r: 6, t: 14, b: 20 };
  const g = useMemo(() => {
    if (width <= 0 || nights.length === 0) return null;
    const x = scaleBand<string>().domain(nights.map((n) => n.label)).range([M.l, width - M.r]).padding(0.38);
    const max = Math.max(...nights.map((n) => n.rmssd)) * 1.2;
    const y = scaleLinear().domain([0, max]).range([height - M.b, M.t]);
    const prev = nights.slice(0, -1);
    const baseline = prev.length ? prev.reduce((a, n) => a + n.rmssd, 0) / prev.length : null;
    return { x, y, baseline, bw: Math.min(22, x.bandwidth()) };
  }, [nights, width, height, M.l, M.r, M.t, M.b]);
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {g && (
        <svg width={width} height={height} role="img" aria-label="Night-time HRV by night versus personal baseline">
          {[0, Math.round(g.y.domain()[1] / 2)].map((v) => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={g.y(v)} y2={g.y(v)} stroke="var(--grid)" />
              <text x={M.l - 6} y={g.y(v)} dy="0.32em" textAnchor="end" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
            </g>
          ))}
          {nights.map((n, i) => {
            const last = i === nights.length - 1;
            const cx = (g.x(n.label) ?? 0) + g.x.bandwidth() / 2;
            const h = g.y(0) - g.y(n.rmssd);
            return (
              <g key={n.label}>
                <path
                  d={`M${cx - g.bw / 2} ${g.y(0)} V${g.y(n.rmssd) + 3} q0 -3 3 -3 H${cx + g.bw / 2 - 3} q3 0 3 3 V${g.y(0)} Z`}
                  fill={last ? "var(--twin)" : "color-mix(in oklab, var(--twin) 35%, var(--card))"}
                  opacity={h > 0 ? 1 : 0}
                />
                <text x={cx} y={height - 5} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                  {n.label}
                </text>
                {last && (
                  <text x={cx} y={g.y(n.rmssd) - 5} textAnchor="middle" className="num fill-ink" style={{ fontSize: 10, fontWeight: 600 }}>
                    {Math.round(n.rmssd)}
                  </text>
                )}
              </g>
            );
          })}
          {g.baseline != null && (
            <g>
              <line x1={M.l} x2={width - M.r} y1={g.y(g.baseline)} y2={g.y(g.baseline)} stroke="var(--brown)" strokeDasharray="3 3" />
              <text x={M.l + 2} y={g.y(g.baseline) - 4} style={{ fontSize: 9.5, fontWeight: 600, fill: "var(--brown)" }}>
                baseline {Math.round(g.baseline)} ms
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

export function HrLine({ hr, sleep, t0, t1, height = 110 }: { hr: Pt[]; sleep: { start: number; end: number }[]; t0: number; t1: number; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Pt | null>(null);
  const M = { l: 30, r: 6, t: 8, b: 20 };
  const g = useMemo(() => {
    if (width <= 0 || hr.length === 0) return null;
    const x = scaleLinear().domain([t0, t1]).range([M.l, width - M.r]);
    const vs = hr.map((p) => p.v);
    const y = scaleLinear().domain([Math.min(...vs) - 5, Math.max(...vs) + 5]).nice().range([height - M.b, M.t]);
    const p = line<Pt>().x((d) => x(d.t)).y((d) => y(d.v)).curve(curveMonotoneX)(hr) ?? "";
    return { x, y, p, ticks: timeTicks(t0, t1, width - M.l - M.r).filter((_, i) => i % 2 === 0) };
  }, [hr, t0, t1, width, height, M.l, M.r, M.t, M.b]);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {g && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Heart rate, last 24 hours"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const t = g.x.invert(e.clientX - box.left);
            let best = hr[0];
            for (const p of hr) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
            setHover(best);
          }}
        >
          {sleep
            .filter((s) => s.end > t0 && s.start < t1)
            .map((s) => (
              <rect key={s.start} x={g.x(Math.max(s.start, t0))} width={g.x(Math.min(s.end, t1)) - g.x(Math.max(s.start, t0))} y={M.t} height={height - M.t - M.b} fill="var(--twin)" opacity={0.06} />
            ))}
          {g.y.ticks(3).map((v) => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={g.y(v)} y2={g.y(v)} stroke="var(--grid)" />
              <text x={M.l - 6} y={g.y(v)} dy="0.32em" textAnchor="end" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
            </g>
          ))}
          <path d={g.p} fill="none" stroke="var(--r-low)" strokeWidth={1.3} strokeOpacity={0.9} />
          {g.ticks.map((t) => (
            <text key={t.t} x={g.x(t.t)} y={height - 5} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
              {t.label}
            </text>
          ))}
          {hover && <circle cx={g.x(hover.t)} cy={g.y(hover.v)} r={3.5} fill="var(--r-low)" stroke="var(--card)" strokeWidth={2} />}
        </svg>
      )}
      {hover && g && (
        <div className="num pointer-events-none absolute top-0 rounded-lg border border-line bg-card px-2 py-1 text-[11px] shadow-[var(--shadow-soft)]" style={{ left: Math.min(g.x(hover.t) + 8, width - 100) }}>
          {fmtTime(hover.t)} · {hover.v} bpm
        </div>
      )}
    </div>
  );
}

export function StepsBars({ steps, t0, t1, height = 110 }: { steps: Pt[]; t0: number; t1: number; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { l: 34, r: 6, t: 8, b: 20 };
  const hourly = useMemo(() => {
    const n = Math.round((t1 - t0) / HOUR);
    const out = Array.from({ length: n }, (_, i) => ({ t: t0 + i * HOUR, v: 0 }));
    for (const p of steps) {
      const i = Math.floor((p.t - t0) / HOUR);
      if (i >= 0 && i < n) out[i].v += p.v;
    }
    return out;
  }, [steps, t0, t1]);
  const g = useMemo(() => {
    if (width <= 0) return null;
    const x = scaleLinear().domain([t0, t1]).range([M.l, width - M.r]);
    const max = Math.max(500, ...hourly.map((h) => h.v));
    const y = scaleLinear().domain([0, max]).nice().range([height - M.b, M.t]);
    const bw = Math.max(2, Math.min(14, (width - M.l - M.r) / hourly.length - 2));
    return { x, y, bw, ticks: timeTicks(t0, t1, width - M.l - M.r).filter((_, i) => i % 2 === 0) };
  }, [hourly, t0, t1, width, height, M.l, M.r, M.t, M.b]);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {g && (
        <svg width={width} height={height} role="img" aria-label="Steps per hour, last 24 hours" onPointerLeave={() => setHover(null)}>
          {g.y.ticks(2).map((v) => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={g.y(v)} y2={g.y(v)} stroke="var(--grid)" />
              <text x={M.l - 6} y={g.y(v)} dy="0.32em" textAnchor="end" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v >= 1000 ? `${v / 1000}k` : v}
              </text>
            </g>
          ))}
          {hourly.map((h, i) => {
            const cx = g.x(h.t + HOUR / 2);
            const top = g.y(h.v);
            const base = g.y(0);
            const r = Math.min(3, (base - top) / 2);
            return (
              <g key={h.t} onPointerEnter={() => setHover(i)}>
                <rect x={cx - g.bw / 2 - 1} y={M.t} width={g.bw + 2} height={base - M.t} fill="transparent" />
                {h.v > 0 && (
                  <path
                    d={`M${cx - g.bw / 2} ${base} V${top + r} q0 -${r} ${r} -${r} H${cx + g.bw / 2 - r} q${r} 0 ${r} ${r} V${base} Z`}
                    fill={hover === i ? "var(--ink)" : "var(--body)"}
                    opacity={hover === i ? 1 : 0.75}
                  />
                )}
              </g>
            );
          })}
          {g.ticks.map((t) => (
            <text key={t.t} x={g.x(t.t)} y={height - 5} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
              {t.label}
            </text>
          ))}
        </svg>
      )}
      {hover != null && g && (
        <div className="num pointer-events-none absolute top-0 rounded-lg border border-line bg-card px-2 py-1 text-[11px] shadow-[var(--shadow-soft)]" style={{ left: Math.min(g.x(hourly[hover].t) + 8, width - 130) }}>
          {fmtTime(hourly[hover].t)}–{fmtTime(hourly[hover].t + HOUR)} · {hourly[hover].v.toLocaleString("en-IN")} steps
        </div>
      )}
    </div>
  );
}
