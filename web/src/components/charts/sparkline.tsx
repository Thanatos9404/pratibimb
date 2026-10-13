"use client";

import { scaleLinear } from "d3-scale";
import { curveMonotoneX, line } from "d3-shape";
import { useId, useMemo } from "react";

import { cn } from "@/lib/utils";

import { RangeGradient } from "./primitives";
import { useSize } from "./use-size";

/** 24-h CGM sparkline, stroke coloured by consensus range. */
export function GlucoseSparkline({ values, height = 36, className }: { values: (number | null)[]; height?: number; className?: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const d = useMemo(() => {
    if (width <= 0) return null;
    const x = scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([1, width - 1]);
    const max = Math.max(300, ...values.filter((v): v is number => v != null));
    const y = scaleLinear().domain([40, max]).range([height - 2, 2]).clamp(true);
    const path = line<number | null>()
      .defined((v) => v != null)
      .x((_, i) => x(i))
      .y((v) => y(v as number))
      .curve(curveMonotoneX)(values);
    return { path: path ?? "", y };
  }, [values, width, height]);

  const last = [...values].reverse().find((v) => v != null);
  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {d && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <RangeGradient id={`sg-${uid}`} y={d.y} />
          <rect x={0} width={width} y={d.y(180)} height={d.y(70) - d.y(180)} fill="var(--range-wash)" />
          <line x1={0} x2={width} y1={d.y(180)} y2={d.y(180)} stroke="var(--line)" />
          <line x1={0} x2={width} y1={d.y(70)} y2={d.y(70)} stroke="var(--line)" />
          <path d={d.path} fill="none" stroke={`url(#sg-${uid})`} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {last != null && <circle cx={width - 1} cy={d.y(last)} r={2.4} fill={`url(#sg-${uid})`} stroke="var(--card)" strokeWidth={1} />}
        </svg>
      )}
    </div>
  );
}

/** Generic small trend line (twin parameter trends, HR, etc.). */
export function MiniLine({
  values,
  height = 28,
  stroke = "var(--twin)",
  className,
  domain,
  refValue,
}: {
  values: number[];
  height?: number;
  stroke?: string;
  className?: string;
  domain?: [number, number];
  refValue?: number;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const d = useMemo(() => {
    if (width <= 0 || values.length === 0) return null;
    const x = scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([2, width - 3]);
    const lo = domain?.[0] ?? Math.min(...values, refValue ?? Infinity);
    const hi = domain?.[1] ?? Math.max(...values, refValue ?? -Infinity);
    const pad = (hi - lo) * 0.15 || 1;
    const y = scaleLinear().domain([lo - pad, hi + pad]).range([height - 3, 3]);
    const p = line<number>()
      .x((_, i) => x(i))
      .y((v) => y(v))
      .curve(curveMonotoneX)(values);
    return { p: p ?? "", x, y };
  }, [values, width, height, domain, refValue]);
  return (
    <div ref={ref} className={cn("w-full", className)} style={{ height }}>
      {d && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          {refValue != null && <line x1={0} x2={width} y1={d.y(refValue)} y2={d.y(refValue)} stroke="var(--brown)" strokeOpacity={0.5} strokeDasharray="2 3" />}
          <path d={d.p} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={d.x(values.length - 1)} cy={d.y(values[values.length - 1])} r={2.6} fill={stroke} stroke="var(--card)" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
}
