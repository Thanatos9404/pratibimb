"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useMemo, useState } from "react";

import type { AblationModel, Metrics } from "@/lib/api/types";
import { DASH, isNum } from "@/lib/format";

import { useSize } from "./use-size";

const tip = "pointer-events-none absolute z-10 rounded-lg border border-line bg-card px-2 py-1 text-[11px] shadow-[var(--shadow-soft)] num";

/** Reliability diagram. */
export function CalibrationChart({ bins, height = 220 }: { bins: { pred: number; obs: number; n: number }[]; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { l: 32, r: 8, t: 8, b: 26 };
  const size = Math.min(width, height + 40);
  const g = useMemo(() => {
    if (size <= 0) return null;
    const x = scaleLinear().domain([0, 1]).range([M.l, size - M.r]);
    const y = scaleLinear().domain([0, 1]).range([height - M.b, M.t]);
    const valid = bins.filter((b) => isNum(b.pred) && isNum(b.obs));
    const p = line<{ pred: number; obs: number }>().x((d) => x(d.pred)).y((d) => y(d.obs))(valid) ?? "";
    const maxN = Math.max(1, ...valid.map((b) => b.n));
    return { x, y, p, valid, maxN };
  }, [bins, size, height, M.l, M.r, M.t, M.b]);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {g && (
        <svg width={size} height={height} role="img" aria-label="Calibration: predicted probability versus observed frequency">
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={M.l} x2={size - M.r} y1={g.y(v)} y2={g.y(v)} stroke="var(--grid)" />
              <text x={M.l - 6} y={g.y(v)} dy="0.32em" textAnchor="end" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
              <text x={g.x(v)} y={height - 10} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
            </g>
          ))}
          <line x1={g.x(0)} y1={g.y(0)} x2={g.x(1)} y2={g.y(1)} stroke="var(--muted-ink)" strokeOpacity={0.5} strokeDasharray="3 3" />
          <path d={g.p} fill="none" stroke="var(--twin)" strokeWidth={2} />
          {g.valid.map((b, i) => (
            <circle
              key={i}
              cx={g.x(b.pred)}
              cy={g.y(b.obs)}
              r={3 + 4 * Math.sqrt(b.n / g.maxN)}
              fill="var(--twin)"
              stroke="var(--card)"
              strokeWidth={2}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
          <text x={(M.l + size - M.r) / 2} y={height} textAnchor="middle" className="fill-muted-ink" style={{ fontSize: 10 }}>
            predicted
          </text>
        </svg>
      )}
      {hover != null && g && (
        <div className={tip} style={{ left: Math.min(g.x(g.valid[hover].pred) + 8, size - 140), top: g.y(g.valid[hover].obs) - 30 }}>
          pred {g.valid[hover].pred.toFixed(2)} · obs {g.valid[hover].obs.toFixed(2)} · n={g.valid[hover].n}
        </div>
      )}
    </div>
  );
}

/** Lead-time histogram (minutes before event onset). */
export function LeadHistogram({ hist, median, height = 160 }: { hist: { min: number; count: number }[]; median?: number; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { l: 30, r: 8, t: 14, b: 22 };
  const g = useMemo(() => {
    if (width <= 0 || hist.length === 0) return null;
    const step = hist.length > 1 ? hist[1].min - hist[0].min : 10;
    const x = scaleLinear().domain([hist[0].min, hist[hist.length - 1].min + step]).range([M.l, width - M.r]);
    const y = scaleLinear().domain([0, Math.max(1, ...hist.map((h) => h.count))]).nice().range([height - M.b, M.t]);
    return { x, y, step };
  }, [hist, width, height, M.l, M.r, M.t, M.b]);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {g && (
        <svg width={width} height={height} role="img" aria-label="Histogram of alert lead times">
          {g.y.ticks(3).map((v) => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={g.y(v)} y2={g.y(v)} stroke="var(--grid)" />
              <text x={M.l - 6} y={g.y(v)} dy="0.32em" textAnchor="end" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
            </g>
          ))}
          {hist.map((h, i) => {
            const x0 = g.x(h.min) + 1;
            const w = Math.max(1, g.x(h.min + g.step) - g.x(h.min) - 2);
            const top = g.y(h.count);
            const base = g.y(0);
            const r = Math.min(2.5, (base - top) / 2, w / 2);
            return (
              <g key={h.min} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={x0} y={M.t} width={w} height={base - M.t} fill="transparent" />
                {h.count > 0 && <path d={`M${x0} ${base} V${top + r} q0 -${r} ${r} -${r} H${x0 + w - r} q${r} 0 ${r} ${r} V${base} Z`} fill={hover === i ? "var(--ink)" : "var(--twin)"} opacity={0.85} />}
              </g>
            );
          })}
          {isNum(median) && (
            <g transform={`translate(${g.x(median)} 0)`}>
              <line y1={M.t - 4} y2={height - M.b} stroke="var(--ink)" strokeWidth={1.5} />
              <text x={4} y={M.t} className="num" style={{ fontSize: 9.5, fill: "var(--alert)" }}>
                median {Math.round(median)} min
              </text>
            </g>
          )}
          {g.x.ticks(5).map((v) => (
            <text key={v} x={g.x(v)} y={height - 6} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
              {v}
            </text>
          ))}
        </svg>
      )}
      {hover != null && g && (
        <div className={tip} style={{ left: Math.min(g.x(hist[hover].min) + 8, width - 140), top: 0 }}>
          {hist[hover].min}–{hist[hover].min + g.step} min · {hist[hover].count}
        </div>
      )}
    </div>
  );
}

export const MODEL_LABEL: Record<AblationModel, string> = {
  cgm_linear: "CGM linear extrapolation",
  ml_no_twin: "ML without twin features",
  twin_only: "Twin ensemble alone",
  hybrid: "Hybrid (ML + twin)",
};

const ABL_METRICS = [
  { key: "hyper_2h_auroc", label: "Hyper 2 h · AUROC" },
  { key: "hypo_1h_auroc", label: "Hypo 1 h · AUROC" },
  { key: "nocturnal_hypo_auroc", label: "Nocturnal hypo · AUROC" },
  { key: "hyper_2h_auprc", label: "Hyper 2 h · AUPRC" },
  { key: "hypo_1h_auprc", label: "Hypo 1 h · AUPRC" },
] as const;

/** Ablation: one row per metric, a bar per model; hybrid emphasised, others greyed. */
export function AblationChart({ ablation, metrics = ["hyper_2h_auroc", "hypo_1h_auroc", "nocturnal_hypo_auroc"] }: { ablation: Metrics["ablation"]; metrics?: (typeof ABL_METRICS)[number]["key"][] }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const order: AblationModel[] = ["cgm_linear", "ml_no_twin", "twin_only", "hybrid"];
  const rows = ABL_METRICS.filter((m) => metrics.includes(m.key));
  const L = Math.min(200, Math.max(120, width * 0.34));
  const barH = 9;
  const gap = 4;
  const groupH = order.length * (barH + gap) + 26;
  const height = rows.length * groupH;
  const x = scaleLinear().domain([0.5, 1]).range([L, Math.max(L + 10, width - 44)]).clamp(true);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Ablation study: discrimination by model variant">
          {rows.map((m, gi) => {
            const y0 = gi * groupH;
            const isPr = m.key.endsWith("auprc");
            const xs = isPr ? scaleLinear().domain([0, 1]).range([L, Math.max(L + 10, width - 44)]) : x;
            return (
              <g key={m.key} transform={`translate(0 ${y0})`}>
                <text x={0} y={12} style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink)" }}>
                  {m.label}
                </text>
                {order.map((mod, i) => {
                  const row = ablation.find((a) => a.model === mod);
                  const v = row ? (row[m.key as keyof typeof row] as number) : undefined;
                  const y = 22 + i * (barH + gap);
                  const hyb = mod === "hybrid";
                  return (
                    <g key={mod}>
                      <text x={L - 8} y={y + barH / 2} dy="0.32em" textAnchor="end" className={hyb ? "fill-ink" : "fill-muted-ink"} style={{ fontSize: 10.5, fontWeight: hyb ? 600 : 400 }}>
                        {MODEL_LABEL[mod]}
                      </text>
                      <rect x={L} y={y} width={Math.max(0, xs.range()[1] - L)} height={barH} rx={2} fill="var(--grid)" />
                      {isNum(v) && <rect x={L} y={y} width={Math.max(2, xs(v) - L)} height={barH} rx={2} fill={hyb ? "var(--twin)" : "color-mix(in oklab, var(--ink) 38%, var(--card))"} />}
                      <text x={isNum(v) ? xs(v) + 6 : L + 6} y={y + barH / 2} dy="0.32em" className="num fill-ink" style={{ fontSize: 10.5, fontWeight: hyb ? 600 : 400 }}>
                        {isNum(v) ? v.toFixed(3) : DASH}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      <p className="mt-1 text-[11px] text-muted-ink">AUROC axis starts at 0.5 (chance); AUPRC axis starts at 0.</p>
    </div>
  );
}

const PARKES_COLOR = {
  A: "var(--r-in)",
  B: "color-mix(in oklab, var(--r-in) 45%, var(--card))",
  C: "var(--r-high)",
  D: "var(--r-vhigh)",
  E: "var(--r-vlow)",
} as const;

/** Parkes consensus error grid zone shares per horizon (stacked, labelled). */
export function ParkesBars({ parkes }: { parkes: Metrics["forecast"]["parkes"] }) {
  const zones = ["A", "B", "C", "D", "E"] as const;
  const total = (p: (typeof parkes)[number]) => zones.reduce((a, z) => a + (isNum(p[z]) ? p[z] : 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-ink">
        {zones.map((z) => (
          <span key={z} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: PARKES_COLOR[z] }} />
            Zone {z}
          </span>
        ))}
      </div>
      {parkes.map((p) => {
        const sum = total(p) || 1;
        return (
          <div key={p.horizon_min} className="grid grid-cols-[52px_1fr] items-center gap-3">
            <span className="num text-[12px] text-body">+{p.horizon_min} min</span>
            <div>
              <div className="flex h-5 w-full gap-[2px]">
                {zones.map((z) =>
                  isNum(p[z]) && p[z] > 0 ? (
                    <div
                      key={z}
                      title={`Zone ${z}: ${p[z].toFixed(1)}`}
                      className="flex h-full items-center justify-center overflow-visible rounded-[2px] first:rounded-l-[3px] last:rounded-r-[3px]"
                      style={{ width: `${(p[z] / sum) * 100}%`, background: PARKES_COLOR[z], minWidth: 2 }}
                    >
                      {(p[z] / sum) * 100 > 12 && (
                        <span className="num text-[10px] font-medium" style={{ color: z === "B" || z === "C" ? "var(--ink)" : "#fff" }}>
                          {z} {((p[z] / sum) * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  ) : null,
                )}
              </div>
              <div className="num mt-1 text-[10.5px] text-muted-ink">
                {zones.map((z) => `${z} ${isNum(p[z]) ? ((p[z] / sum) * 100).toFixed(1) : DASH}%`).join(" · ")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Forecast error by horizon: twin vs naive baseline (dumbbell). */
export function ForecastDumbbell({ f }: { f: Metrics["forecast"] }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const rows = f.horizons_min.map((h, i) => ({ h, twin: f.rmse[i], base: f.baseline_rmse[i] }));
  const max = Math.max(10, ...rows.flatMap((r) => [r.twin, r.base].filter(isNum)));
  const L = 64;
  const rowH = 34;
  const height = rows.length * rowH + 24;
  const x = scaleLinear().domain([0, max * 1.1]).nice().range([L, Math.max(L + 10, width - 16)]);
  const band = scaleBand<number>().domain(rows.map((r) => r.h)).range([0, rows.length * rowH]);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Forecast RMSE by horizon, twin versus baseline">
          {x.ticks(4).map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={0} y2={rows.length * rowH} stroke="var(--grid)" />
              <text x={x(v)} y={height - 6} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
            </g>
          ))}
          {rows.map((r) => {
            const cy = (band(r.h) ?? 0) + rowH / 2;
            return (
              <g key={r.h}>
                <text x={0} y={cy} dy="0.32em" className="num fill-body" style={{ fontSize: 11 }}>
                  +{r.h} min
                </text>
                {isNum(r.twin) && isNum(r.base) && <line x1={x(r.twin)} x2={x(r.base)} y1={cy} y2={cy} stroke="var(--line)" strokeWidth={2} />}
                {isNum(r.base) && (
                  <g>
                    <circle cx={x(r.base)} cy={cy} r={5} fill="var(--card)" stroke="var(--muted-ink)" strokeWidth={1.6} />
                    <text x={x(r.base) + 9} y={cy} dy="0.32em" className="num fill-muted-ink" style={{ fontSize: 10 }}>
                      {r.base.toFixed(1)}
                    </text>
                  </g>
                )}
                {isNum(r.twin) && (
                  <g>
                    <circle cx={x(r.twin)} cy={cy} r={5.5} fill="var(--twin)" stroke="var(--card)" strokeWidth={2} />
                    <text x={x(r.twin) - 9} y={cy} dy="0.32em" textAnchor="end" className="num fill-ink" style={{ fontSize: 10, fontWeight: 600 }}>
                      {r.twin.toFixed(1)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
