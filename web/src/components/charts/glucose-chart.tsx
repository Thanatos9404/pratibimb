"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useId, useMemo, useState } from "react";

import { rangeColor } from "@/lib/glucose";
import type { Pt, QPt, Series } from "@/lib/series";
import { HOUR, MIN, fmtDayTime, fmtTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { EcgPattern, nearestT, timeTicks, YAxis } from "./primitives";
import { useSize } from "./use-size";

const KIND_LABEL = { hyper_2h: "Hyper risk (2 h)", hypo_1h: "Hypo risk (1 h)", nocturnal_hypo: "Nocturnal hypo risk" } as const;

export interface GlucoseChartProps {
  series: Series;
  clock: number;
  windowH: number;
  forecast?: { at: number; q: QPt[]; mech: Pt[] } | null;
  showMechanistic?: boolean;
  height?: number;
  className?: string;
}

export function GlucoseChart({ series, clock, windowH, forecast, showMechanistic = false, height = 380, className }: GlucoseChartProps) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const [hoverT, setHoverT] = useState<number | null>(null);

  const M = { l: 40, r: 14, t: 26, b: 64 };
  const W = Math.max(0, width);
  const H = height;
  const plotB = H - M.b;
  const laneY = plotB + 18;

  const t0 = clock - windowH * HOUR;
  const t1 = clock + 4 * HOUR;

  const vis = useMemo(() => {
    const inX = <T extends { t: number }>(arr: T[]) => arr.filter((p) => p.t >= t0 - 10 * MIN && p.t <= t1);
    return {
      cgm: inX(series.cgm),
      twin: inX(series.twin),
      q: forecast ? forecast.q.filter((p) => p.t <= t1) : [],
      mech: forecast ? forecast.mech.filter((p) => p.t <= t1) : [],
    };
  }, [series.cgm, series.twin, forecast, t0, t1]);

  const yMax = useMemo(() => {
    let m = 300;
    for (const p of vis.cgm) if (p.g != null && p.g > m) m = p.g;
    for (const p of vis.q) if (p.p95 > m) m = p.p95;
    return Math.min(420, Math.ceil((m + 15) / 50) * 50);
  }, [vis]);

  const x = useMemo(() => scaleLinear().domain([t0, t1]).range([M.l, W - M.r]), [t0, t1, W, M.l, M.r]);
  const y = useMemo(() => scaleLinear().domain([40, yMax]).range([plotB, M.t]).clamp(true), [yMax, plotB, M.t]);

  const paths = useMemo(() => {
    const band = area<{ t: number; p10: number; p90: number }>()
      .x((d) => x(d.t))
      .y0((d) => y(d.p10))
      .y1((d) => y(d.p90))
      .curve(curveMonotoneX);
    const mid = line<{ t: number; p50: number }>()
      .x((d) => x(d.t))
      .y((d) => y(d.p50))
      .curve(curveMonotoneX);
    const outer = area<QPt>()
      .x((d) => x(d.t))
      .y0((d) => y(d.p05))
      .y1((d) => y(d.p95))
      .curve(curveMonotoneX);
    const inner = area<QPt>()
      .x((d) => x(d.t))
      .y0((d) => y(d.p25))
      .y1((d) => y(d.p75))
      .curve(curveMonotoneX);
    const mech = line<Pt>()
      .x((d) => x(d.t))
      .y((d) => y(d.v))
      .curve(curveMonotoneX);
    return {
      twinBand: band(vis.twin) ?? "",
      twinMid: mid(vis.twin) ?? "",
      outer: outer(vis.q) ?? "",
      inner: inner(vis.q) ?? "",
      fMid: mid(vis.q) ?? "",
      mech: mech(vis.mech) ?? "",
    };
  }, [vis, x, y]);

  const ticks = useMemo(() => timeTicks(t0, t1, W - M.l - M.r), [t0, t1, W, M.l, M.r]);
  const yTicks = [70, 180, 250, ...(yMax >= 350 ? [350] : [])].filter((v) => v < yMax);

  const r = windowH <= 6 ? 2.6 : windowH <= 24 ? 2 : 1.4;
  const plotW = Math.max(0, W - M.l - M.r);
  const stale = forecast && clock - forecast.at > 10 * MIN;

  // hover
  const hover = useMemo(() => {
    if (hoverT == null) return null;
    const t = hoverT;
    const cg = t <= clock ? nearestT(series.cgm, t, 6 * MIN) : null;
    const tw = t <= clock ? nearestT(series.twin, t, 6 * MIN) : null;
    const fq = forecast ? nearestT(forecast.q, t, 6 * MIN) : null;
    const meals = series.meals.filter((m) => Math.abs(m.ms - t) <= 12 * MIN);
    const doses = series.doses.filter((d) => Math.abs(d.ms - t) <= 12 * MIN);
    const alerts = series.alerts.filter((a) => Math.abs(a.ms - t) <= 12 * MIN);
    return { t, cg, tw, fq: fq && fq.t >= (forecast?.at ?? 0) ? fq : null, meals, doses, alerts };
  }, [hoverT, clock, series, forecast]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    const t = x.invert(px);
    setHoverT(Math.round(t / (5 * MIN)) * 5 * MIN);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 60 : 5) * MIN;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setHoverT((h) => {
        const base = h ?? Math.floor(clock / (5 * MIN)) * 5 * MIN;
        const next = base + (e.key === "ArrowRight" ? step : -step);
        return Math.min(t1, Math.max(t0, next));
      });
    } else if (e.key === "Escape") setHoverT(null);
    else if (e.key === "Home") setHoverT(t0);
    else if (e.key === "End") setHoverT(clock);
  };

  const lastG = [...series.cgm].reverse().find((p) => p.g != null);
  const ariaLabel = `Glucose chart, last ${windowH} hours and 4-hour forecast. ${lastG ? `Latest CGM ${lastG.g} mg/dL at ${fmtTime(lastG.t)}.` : ""} Use left and right arrow keys to inspect values.`;

  return (
    <div
      ref={ref}
      className={cn("relative w-full select-none outline-none", className)}
      style={{ height: H }}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      onBlur={() => setHoverT(null)}
    >
      {W > 0 && (
        <svg width={W} height={H} className="block overflow-visible">
          <EcgPattern id={`ecg-${uid}`} />
          <defs>
            <clipPath id={`plot-${uid}`}>
              <rect x={M.l} y={M.t - 4} width={plotW} height={plotB - M.t + 8} />
            </clipPath>
            <clipPath id={`reveal-${uid}`}>
              <motion.rect
                x={M.l}
                y={0}
                height={H}
                initial={{ width: reduce ? plotW : 0 }}
                animate={{ width: plotW + 4 }}
                transition={{ duration: reduce ? 0 : 1.3, ease: [0.16, 1, 0.3, 1] }}
              />
            </clipPath>
          </defs>

          {/* paper */}
          <rect x={M.l} y={M.t} width={plotW} height={plotB - M.t} fill={`url(#ecg-${uid})`} />

          <g clipPath={`url(#plot-${uid})`}>
            {/* target range wash */}
            <rect x={M.l} width={plotW} y={y(180)} height={Math.max(0, y(70) - y(180))} fill="var(--range-wash)" />

            {/* sleep */}
            {series.sleepPeriods
              .filter((p) => p.end >= t0 && p.start <= t1)
              .map((p) => {
                const a = Math.max(x(p.start), M.l);
                const b = Math.min(x(p.end), W - M.r);
                return (
                  <g key={p.start}>
                    <rect x={a} width={Math.max(0, b - a)} y={M.t} height={plotB - M.t} fill="var(--twin)" opacity={0.055} />
                    {b - a > 44 && (
                      <text x={a + 6} y={M.t + 12} className="fill-muted-ink" style={{ fontSize: 9.5, fontWeight: 500 }}>
                        Sleep
                      </text>
                    )}
                  </g>
                );
              })}
          </g>

          {/* thresholds */}
          <YAxis y={y} ticks={yTicks} x={M.l} width={plotW} />
          <line x1={M.l} x2={W - M.r} y1={y(70)} y2={y(70)} stroke="var(--r-low)" strokeOpacity={0.55} />
          <line x1={M.l} x2={W - M.r} y1={y(180)} y2={y(180)} stroke="var(--r-high)" strokeOpacity={0.65} />
          <line x1={M.l} x2={W - M.r} y1={y(250)} y2={y(250)} stroke="var(--r-vhigh)" strokeOpacity={0.6} strokeDasharray="2 4" />
          <line x1={M.l} x2={W - M.r} y1={y(54)} y2={y(54)} stroke="var(--r-vlow)" strokeOpacity={0.6} strokeDasharray="2 4" />
          <text x={W - M.r - 4} y={y(54) - 4} textAnchor="end" className="num fill-muted-ink" style={{ fontSize: 9 }}>
            54
          </text>

          <g clipPath={`url(#plot-${uid})`}>
            <g clipPath={`url(#reveal-${uid})`}>
              {/* forecast cone */}
              {vis.q.length > 0 && (
                <g opacity={stale ? 0.45 : 1}>
                  <path d={paths.outer} fill="var(--twin-band)" />
                  <path d={paths.inner} fill="var(--twin-band-2)" />
                  <path d={paths.fMid} fill="none" stroke="var(--twin)" strokeWidth={1.6} strokeDasharray="5 4" strokeLinecap="round" />
                  {showMechanistic && <path d={paths.mech} fill="none" stroke="var(--brown)" strokeWidth={1.3} strokeDasharray="1 3.5" strokeLinecap="round" />}
                </g>
              )}

              {/* twin band */}
              <path d={paths.twinBand} fill="var(--twin-band)" />
              <path d={paths.twinMid} fill="none" stroke="var(--twin)" strokeWidth={1.25} strokeOpacity={0.9} />

              {/* CGM dots */}
              {vis.cgm.map((p) =>
                p.g == null ? null : <circle key={p.t} cx={x(p.t)} cy={y(p.g)} r={r} fill={rangeColor(p.g)} />,
              )}
            </g>
          </g>

          {/* forecast label */}
          {vis.q.length > 0 && forecast && (
            <text x={Math.min(x(forecast.at) + 6, W - M.r - 120)} y={M.t + 12} style={{ fontSize: 10, fontWeight: 600, fill: "var(--twin)" }}>
              {stale ? `Forecast issued ${fmtTime(forecast.at)}` : "Forecast +4 h"}
            </text>
          )}

          {/* alerts */}
          {series.alerts
            .filter((a) => a.ms >= t0 && a.ms <= clock)
            .map((a) => (
              <g key={a.id} transform={`translate(${x(a.ms)} ${M.t - 2})`}>
                <line y1={0} y2={plotB - M.t + 2} stroke="var(--alert)" strokeOpacity={0.25} />
                <path d="M-4.5 -9 L4.5 -9 L0 -1.5 Z" fill="var(--alert)" />
              </g>
            ))}

          {/* now line */}
          <g transform={`translate(${x(clock)} 0)`}>
            <line y1={M.t - 6} y2={plotB} stroke="var(--ink)" strokeWidth={1.2} />
            <rect x={-25} y={M.t - 23} width={50} height={17} rx={8.5} fill="var(--ink)" />
            <text y={M.t - 11.5} textAnchor="middle" className="num" style={{ fontSize: 9.5, fill: "var(--page)", fontWeight: 600 }}>
              {fmtTime(clock)}
            </text>
          </g>

          {/* lane: walks, meals, doses */}
          <line x1={M.l} x2={W - M.r} y1={laneY - 12} y2={laneY - 12} stroke="var(--line)" />
          {series.walks
            .filter((w) => w.end >= t0 && w.start <= t1)
            .map((w) => (
              <rect key={w.start} x={x(w.start)} y={laneY + 7} width={Math.max(3, x(w.end) - x(w.start))} height={3} rx={1.5} fill="var(--r-in)" opacity={0.85} />
            ))}
          {series.meals
            .filter((m) => m.ms >= t0 && m.ms <= t1)
            .map((m) => (
              <g key={m.t} transform={`translate(${x(m.ms)} ${laneY - 2})`}>
                <circle r={Math.max(3, Math.min(6.5, Math.sqrt(m.carbs_g) * 0.75))} fill="var(--body)" />
                {windowH <= 24 && (
                  <text x={8} dy="0.32em" className="num fill-body" style={{ fontSize: 9.5 }}>
                    {Math.round(m.carbs_g)}g
                  </text>
                )}
              </g>
            ))}
          {series.doses
            .filter((d) => d.ms >= t0 && d.ms <= t1)
            .map((d) => (
              <g key={d.t + d.drug} transform={`translate(${x(d.ms)} ${laneY + 9})`}>
                <rect
                  x={-3.2}
                  y={-3.2}
                  width={6.4}
                  height={6.4}
                  transform="rotate(45)"
                  fill={d.taken ? "var(--twin)" : "var(--card)"}
                  stroke="var(--twin)"
                  strokeWidth={1.2}
                  strokeDasharray={d.taken ? undefined : "1.5 1.5"}
                />
              </g>
            ))}

          {/* x axis */}
          {ticks.map((tk) => (
            <g key={tk.t} transform={`translate(${x(tk.t)} 0)`}>
              <line y1={plotB} y2={plotB + 4} stroke="var(--line)" />
              <text y={H - 8} textAnchor="middle" className={cn("num", tk.major ? "fill-body" : "fill-muted-ink")} style={{ fontSize: 10 }}>
                {tk.label}
              </text>
            </g>
          ))}
          <line x1={M.l} x2={W - M.r} y1={plotB} y2={plotB} stroke="var(--line)" />
          <text x={M.l - 6} y={M.t - 12} textAnchor="end" className="fill-muted-ink" style={{ fontSize: 9.5, fontWeight: 500 }}>
            mg/dL
          </text>

          {/* crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.t)} x2={x(hover.t)} y1={M.t} y2={plotB} stroke="var(--ink)" strokeOpacity={0.45} />
              {hover.cg?.g != null && <circle cx={x(hover.cg.t)} cy={y(hover.cg.g)} r={4.5} fill={rangeColor(hover.cg.g)} stroke="var(--card)" strokeWidth={2} />}
              {hover.fq && <circle cx={x(hover.fq.t)} cy={y(hover.fq.p50)} r={4} fill="var(--card)" stroke="var(--twin)" strokeWidth={1.6} />}
            </g>
          )}

          <rect
            x={M.l}
            y={M.t - 12}
            width={plotW}
            height={H - M.t + 12}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHoverT(null)}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
      )}

      {hover && W > 0 && <Tooltip hover={hover} left={x(hover.t)} width={W} clock={clock} />}
    </div>
  );
}

function Tooltip({
  hover,
  left,
  width,
  clock,
}: {
  hover: {
    t: number;
    cg: { t: number; g: number | null } | null;
    tw: { p10: number; p50: number; p90: number } | null;
    fq: QPt | null;
    meals: Series["meals"];
    doses: Series["doses"];
    alerts: Series["alerts"];
  };
  left: number;
  width: number;
  clock: number;
}) {
  const flip = left > width - 230;
  return (
    <div
      className="pointer-events-none absolute top-8 z-10 w-[210px] rounded-xl border border-line bg-card/95 p-3 text-[12px] shadow-[var(--shadow-soft)] backdrop-blur-sm"
      style={{ left: flip ? left - 222 : left + 12 }}
      role="status"
      aria-live="polite"
    >
      <div className="label-xs mb-2 flex justify-between">
        <span>{fmtDayTime(hover.t)}</span>
        {hover.t > clock && <span className="text-twin">forecast</span>}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {hover.cg && (
          <>
            <dt className="flex items-center gap-1.5 text-muted-ink">
              <span className="size-2 rounded-full" style={{ background: rangeColor(hover.cg.g) }} />
              CGM
            </dt>
            <dd className="num text-right">{hover.cg.g ?? "no signal"}</dd>
          </>
        )}
        {hover.tw && (
          <>
            <dt className="text-muted-ink">Twin p50</dt>
            <dd className="num text-right">
              {Math.round(hover.tw.p50)} <span className="text-muted-ink">({Math.round(hover.tw.p10)}–{Math.round(hover.tw.p90)})</span>
            </dd>
          </>
        )}
        {hover.fq && (
          <>
            <dt className="text-muted-ink">Forecast p50</dt>
            <dd className="num text-right">
              {Math.round(hover.fq.p50)} <span className="text-muted-ink">({Math.round(hover.fq.p05)}–{Math.round(hover.fq.p95)})</span>
            </dd>
          </>
        )}
      </dl>
      {(hover.meals.length > 0 || hover.doses.length > 0 || hover.alerts.length > 0) && (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          {hover.meals.map((m) => (
            <div key={m.t}>
              <div className="flex justify-between">
                <span className="font-medium">Meal · {fmtTime(m.ms)}</span>
                <span className="num">{Math.round(m.carbs_g)} g</span>
              </div>
              <div className="text-muted-ink">{m.items.map((i) => `${i.portions}× ${i.name}`).join(", ")}</div>
            </div>
          ))}
          {hover.doses.map((d) => (
            <div key={d.t + d.drug} className="flex justify-between gap-2">
              <span>
                {d.drug} {d.dose}
              </span>
              <span className={d.taken ? "text-muted-ink" : "text-alert"}>{d.taken ? "taken" : "missed"}</span>
            </div>
          ))}
          {hover.alerts.map((a) => (
            <div key={a.id} className="flex justify-between gap-2 text-alert">
              <span>{KIND_LABEL[a.kind]}</span>
              <span className="num">{Math.round(a.probability * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
