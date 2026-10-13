"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useId, useMemo, useState } from "react";

import type { BandPoint } from "@/lib/api/types";
import { ms, fmtTime } from "@/lib/time";

import { EcgPattern, LegendSwatch, timeTicks, YAxis } from "./primitives";
import { useSize } from "./use-size";

type B = { t: number; p10: number; p50: number; p90: number };

/** Baseline (blue) vs scenario (ink) quantile bands. */
export function WhatIfChart({
  baseline,
  scenario,
  height = 300,
  labels = { baseline: "Baseline (as planned)", scenario: "Scenario" },
  showLegend = true,
  compact = false,
}: {
  baseline: BandPoint[];
  scenario: BandPoint[];
  height?: number;
  labels?: { baseline: string; scenario: string };
  showLegend?: boolean;
  compact?: boolean;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const A = useMemo(() => baseline.map((p) => ({ t: ms(p.t), p10: p.p10, p50: p.p50, p90: p.p90 })), [baseline]);
  const S = useMemo(() => scenario.map((p) => ({ t: ms(p.t), p10: p.p10, p50: p.p50, p90: p.p90 })), [scenario]);
  const M = { l: compact ? 30 : 38, r: 10, t: 12, b: 22 };

  const g = useMemo(() => {
    if (width <= 0 || A.length === 0) return null;
    const t0 = A[0].t;
    const t1 = A[A.length - 1].t;
    const max = Math.max(260, ...A.map((p) => p.p90), ...S.map((p) => p.p90));
    const x = scaleLinear().domain([t0, t1]).range([M.l, width - M.r]);
    const y = scaleLinear().domain([40, Math.min(420, Math.ceil((max + 10) / 50) * 50)]).range([height - M.b, M.t]).clamp(true);
    const band = area<B>().x((d) => x(d.t)).y0((d) => y(d.p10)).y1((d) => y(d.p90)).curve(curveMonotoneX);
    const mid = line<B>().x((d) => x(d.t)).y((d) => y(d.p50)).curve(curveMonotoneX);
    return {
      x,
      y,
      t0,
      t1,
      aBand: band(A) ?? "",
      aMid: mid(A) ?? "",
      sBand: band(S) ?? "",
      sMid: mid(S) ?? "",
      ticks: timeTicks(t0, t1, width - M.l - M.r),
    };
  }, [A, S, width, height, M.l, M.r, M.t, M.b]);

  const hv = hover != null ? { a: A[hover], s: S[hover] } : null;

  return (
    <div className="w-full">
      {showLegend && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          <LegendSwatch kind="band" color="var(--twin-band-2)" label={`${labels.baseline} · p10–p90`} />
          <LegendSwatch kind="band" color="color-mix(in oklab, var(--ink) 18%, transparent)" label={`${labels.scenario} · p10–p90`} />
        </div>
      )}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {g && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Baseline versus scenario glucose forecast from ${fmtTime(g.t0)} to ${fmtTime(g.t1)}`}
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const t = g.x.invert(e.clientX - box.left);
              let bi = 0;
              for (let i = 0; i < A.length; i++) if (Math.abs(A[i].t - t) < Math.abs(A[bi].t - t)) bi = i;
              setHover(bi);
            }}
          >
            <EcgPattern id={`wi-${uid}`} />
            <rect x={M.l} y={M.t} width={width - M.l - M.r} height={height - M.t - M.b} fill={`url(#wi-${uid})`} />
            <rect x={M.l} width={width - M.l - M.r} y={g.y(180)} height={g.y(70) - g.y(180)} fill="var(--range-wash)" />
            <YAxis y={g.y} ticks={[70, 180, 250]} x={M.l} width={width - M.l - M.r} />
            <line x1={M.l} x2={width - M.r} y1={g.y(70)} y2={g.y(70)} stroke="var(--r-low)" strokeOpacity={0.55} />
            <line x1={M.l} x2={width - M.r} y1={g.y(180)} y2={g.y(180)} stroke="var(--r-high)" strokeOpacity={0.65} />

            <path d={g.aBand} fill="var(--twin-band)" />
            <path d={g.aMid} fill="none" stroke="var(--twin)" strokeWidth={2} strokeLinecap="round" />
            <motion.path
              key={g.sMid}
              d={g.sBand}
              fill="color-mix(in oklab, var(--ink) 9%, transparent)"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            />
            <motion.path
              key={`m-${g.sMid}`}
              d={g.sMid}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            />
            {g.ticks.map((t) => (
              <text key={t.t} x={g.x(t.t)} y={height - 6} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 10 }}>
                {t.label}
              </text>
            ))}
            {hv?.a && (
              <g pointerEvents="none">
                <line x1={g.x(hv.a.t)} x2={g.x(hv.a.t)} y1={M.t} y2={height - M.b} stroke="var(--ink)" strokeOpacity={0.4} />
                <circle cx={g.x(hv.a.t)} cy={g.y(hv.a.p50)} r={4} fill="var(--twin)" stroke="var(--card)" strokeWidth={2} />
                {hv.s && <circle cx={g.x(hv.s.t)} cy={g.y(hv.s.p50)} r={4} fill="var(--ink)" stroke="var(--card)" strokeWidth={2} />}
              </g>
            )}
          </svg>
        )}
        {hv?.a && g && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-xl border border-line bg-card/95 px-2.5 py-2 text-[11.5px] shadow-[var(--shadow-soft)]"
            style={{ left: g.x(hv.a.t) > width - 170 ? g.x(hv.a.t) - 160 : g.x(hv.a.t) + 10 }}
          >
            <div className="label-xs mb-1">{fmtTime(hv.a.t)}</div>
            <div className="num grid grid-cols-[auto_auto] gap-x-3">
              <span className="text-twin">Baseline</span>
              <span className="text-right">{Math.round(hv.a.p50)}</span>
              {hv.s && (
                <>
                  <span className="text-alert">Scenario</span>
                  <span className="text-right">{Math.round(hv.s.p50)}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
