"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { rangeColor } from "@/lib/glucose";
import type { LandingData } from "@/lib/server/landing-data";
import { HOUR, fmtTime } from "@/lib/time";

type Hero = NonNullable<LandingData["hero"]>;

/**
 * The hero visual: a patient's CGM trace and the twin's estimate converging.
 * `sync` animates 0→1: the twin band starts as a wide population prior and
 * narrows onto the patient as the readings arrive (left to right).
 */
export function MirrorChart({ hero, width, height, now, compact = false }: { hero: Hero; width: number; height: number; now: number; compact?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-5% 0px" });
  const reduce = useReducedMotion();
  const [k, setK] = useState(reduce ? 1 : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, 1, { duration: 2.6, ease: [0.45, 0, 0.2, 1], onUpdate: setK, delay: 0.3 });
    return () => c.stop();
  }, [inView, reduce]);

  const M = { l: compact ? 26 : 34, r: 10, t: 14, b: compact ? 18 : 22 };
  const t0 = now - 24 * HOUR;
  const t1 = hero.q.length ? hero.q[hero.q.length - 1].t : now + 4 * HOUR;
  const x = useMemo(() => scaleLinear().domain([t0, t1]).range([M.l, width - M.r]), [t0, t1, width, M.l, M.r]);
  const yMax = Math.min(400, Math.max(260, ...hero.cgm.map((p) => p.g ?? 0), ...hero.q.map((q) => q.p95)) + 10);
  const y = useMemo(() => scaleLinear().domain([50, yMax]).range([height - M.b, M.t]).clamp(true), [yMax, height, M.b, M.t]);

  const reveal = t0 + (now - t0) * k;
  const prior = useMemo(() => {
    const vals = hero.twin.map((p) => p.p50);
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  }, [hero.twin]);

  const paths = useMemo(() => {
    const wide = 70 * (1 - k);
    const pts = hero.twin.map((p) => {
      const local = Math.min(1, Math.max(0, (reveal - p.t) / (3 * HOUR) + 0.15));
      const mid = prior + (p.p50 - prior) * local;
      return { t: p.t, lo: mid - (p.p50 - p.p10) - wide * (1 - local), hi: mid + (p.p90 - p.p50) + wide * (1 - local), mid };
    });
    const band = area<(typeof pts)[number]>().x((d) => x(d.t)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(curveMonotoneX)(pts) ?? "";
    const mid = line<(typeof pts)[number]>().x((d) => x(d.t)).y((d) => y(d.mid)).curve(curveMonotoneX)(pts) ?? "";
    const outer = area<Hero["q"][number]>().x((d) => x(d.t)).y0((d) => y(d.p05)).y1((d) => y(d.p95)).curve(curveMonotoneX)(hero.q) ?? "";
    const inner = area<Hero["q"][number]>().x((d) => x(d.t)).y0((d) => y(d.p25)).y1((d) => y(d.p75)).curve(curveMonotoneX)(hero.q) ?? "";
    const fmid = line<Hero["q"][number]>().x((d) => x(d.t)).y((d) => y(d.p50)).curve(curveMonotoneX)(hero.q) ?? "";
    return { band, mid, outer, inner, fmid };
  }, [hero, x, y, k, reveal, prior]);

  const ticks = [t0 + 4 * HOUR, t0 + 10 * HOUR, t0 + 16 * HOUR, t0 + 22 * HOUR];
  return (
    <svg ref={ref} width={width} height={height} className="block overflow-visible" role="img" aria-label={`Last 24 hours of CGM for ${hero.patient.display_name} with the twin's estimate and a 4-hour forecast`}>
      <rect x={M.l} width={width - M.l - M.r} y={y(180)} height={y(70) - y(180)} fill="var(--range-wash)" />
      {[70, 180, 250].map((v) => (
        <g key={v}>
          <line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke={v === 70 ? "var(--r-low)" : v === 180 ? "var(--r-high)" : "var(--r-vhigh)"} strokeOpacity={0.45} strokeDasharray={v === 250 ? "2 4" : undefined} />
          <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" style={{ fontSize: compact ? 8.5 : 10, fill: "var(--muted-ink)" }}>
            {v}
          </text>
        </g>
      ))}
      <g opacity={k > 0.85 ? (k - 0.85) / 0.15 : 0}>
        <path d={paths.outer} fill="var(--twin-band)" />
        <path d={paths.inner} fill="var(--twin-band-2)" />
        <path d={paths.fmid} fill="none" stroke="var(--twin)" strokeWidth={1.6} strokeDasharray="5 4" />
      </g>
      <path d={paths.band} fill="var(--twin-band-2)" opacity={0.75} />
      <path d={paths.mid} fill="none" stroke="var(--twin)" strokeWidth={1.4} />
      {hero.cgm.map((p) =>
        p.g == null || p.t > reveal ? null : <circle key={p.t} cx={x(p.t)} cy={y(p.g)} r={compact ? 1.5 : 2} fill={rangeColor(p.g)} />,
      )}
      {hero.meals.map((m) => (
        <g key={m.t} transform={`translate(${x(m.t)} ${height - M.b + (compact ? 9 : 11)})`} opacity={m.t <= reveal ? 1 : 0}>
          <circle r={compact ? 2.6 : 3.4} fill="var(--body)" />
        </g>
      ))}
      <line x1={x(now)} x2={x(now)} y1={M.t - 4} y2={height - M.b} stroke="var(--ink)" strokeWidth={1.2} opacity={k} />
      {!compact &&
        ticks.map((t) => (
          <text key={t} x={x(t)} y={height - 2} textAnchor="middle" style={{ fontSize: 10, fill: "var(--muted-ink)" }}>
            {fmtTime(t)}
          </text>
        ))}
    </svg>
  );
}
