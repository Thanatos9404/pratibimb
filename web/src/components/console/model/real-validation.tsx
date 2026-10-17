"use client";

import { scaleBand, scaleLinear } from "d3-scale";

import { useSize } from "@/components/charts/use-size";
import { useRealValidation } from "@/lib/api/hooks";
import type { RealValidation } from "@/lib/api/types";
import { DASH, grouped, isNum } from "@/lib/format";
import { fmtDate, ms } from "@/lib/time";

import { Panel, PanelSkeleton } from "../panel";

/** Every number here is read from /demo/real_validation.json (engine: `pratibimb validate-real`). */

export const REAL_LABEL = "REAL · CGMacros + ShanghaiT2DM (non-commercial licence)";

type Method = "twin" | "persistence" | "linear" | "glycotwin_lgbm";
const METHODS: { key: Method; label: string; color: string }[] = [
  { key: "twin", label: "Pratibimb twin", color: "var(--twin)" },
  { key: "persistence", label: "Persistence", color: "var(--muted-ink)" },
  { key: "linear", label: "Linear extrapolation", color: "var(--sand-2)" },
  { key: "glycotwin_lgbm", label: "GlycoTwin LightGBM", color: "var(--brown)" },
];

const EVENT_LABEL: Record<string, string> = {
  ge180_2h: "≥180 mg/dL within 2 h",
  gt250_2h: ">250 mg/dL within 2 h",
};

const n1 = (v: unknown) => (isNum(v) ? v.toFixed(1) : DASH);
const n3 = (v: unknown) => (isNum(v) ? v.toFixed(3) : DASH);
const pct = (v: unknown, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : DASH);

export function RealBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[11px] font-semibold tracking-wide text-page ${className}`}>
      <span className="size-1.5 rounded-full bg-pos" />
      {REAL_LABEL}
    </span>
  );
}

function rmseOf(r: RealValidation, k: Method): (number | null)[] {
  return r.forecast[k].rmse;
}

function RmseChart({ r }: { r: RealValidation }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const hs = r.forecast.horizons_min;
  const vals = METHODS.flatMap((m) => rmseOf(r, m.key)).filter(isNum);
  const max = Math.max(10, ...vals);
  const L = 64;
  const barH = 9;
  const gap = 3;
  const groupH = METHODS.length * (barH + gap) + 14;
  const height = hs.length * groupH + 22;
  const x = scaleLinear().domain([0, max * 1.12]).nice().range([L, Math.max(L + 10, width - 40)]);
  const band = scaleBand<number>().domain(hs).range([0, hs.length * groupH]);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Real-data forecast RMSE by horizon for the twin, persistence, linear extrapolation and GlycoTwin LightGBM">
          {x.ticks(5).map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={0} y2={hs.length * groupH} stroke="var(--grid)" />
              <text x={x(v)} y={height - 6} textAnchor="middle" className="num fill-muted-ink" style={{ fontSize: 9.5 }}>
                {v}
              </text>
            </g>
          ))}
          {hs.map((h, hi) => {
            const y0 = (band(h) ?? 0) + 6;
            return (
              <g key={h}>
                <text x={0} y={y0 + (METHODS.length * (barH + gap)) / 2} dy="0.32em" className="num fill-body" style={{ fontSize: 11 }}>
                  +{h} min
                </text>
                {METHODS.map((m, mi) => {
                  const v = rmseOf(r, m.key)[hi];
                  const y = y0 + mi * (barH + gap);
                  if (!isNum(v)) return null;
                  return (
                    <g key={m.key}>
                      <rect x={L} y={y} width={Math.max(1, x(v) - L)} height={barH} rx={3} fill={m.color} opacity={m.key === "twin" ? 1 : 0.85} />
                      <text x={x(v) + 5} y={y + barH / 2} dy="0.32em" className="num fill-ink" style={{ fontSize: 9.5, fontWeight: m.key === "twin" ? 600 : 400 }}>
                        {v.toFixed(1)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-ink">
      {METHODS.map((m) => (
        <span key={m.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: m.color }} /> {m.label}
        </span>
      ))}
    </div>
  );
}

function ForecastPanel({ r }: { r: RealValidation }) {
  const f = r.forecast;
  const src = f.glycotwin_lgbm.source === "reproduced" ? "its own out-of-fold predictions at the same timestamps" : "as reported";
  return (
    <Panel
      title="Glucose forecast vs baselines"
      kicker={`RMSE (mg/dL) on the same ${isNum(f.n_points) ? grouped(f.n_points) : DASH} real timestamps · GlycoTwin LightGBM: ${src}`}
      className="xl:col-span-7"
    >
      <Legend />
      <RmseChart r={r} />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[460px] text-[12.5px]">
          <thead>
            <tr className="label-xs text-left">
              <th className="py-2 font-medium">Horizon</th>
              {METHODS.map((m) => (
                <th key={m.key} className="py-2 text-right font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {f.horizons_min.map((h, i) => (
              <tr key={h} className="border-t border-line-2">
                <td className="num py-2">+{h} min</td>
                {METHODS.map((m) => (
                  <td key={m.key} className={`num py-2 text-right ${m.key === "twin" ? "font-semibold text-ink" : ""}`}>
                    {n1(rmseOf(r, m.key)[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mt-4 w-full min-w-[460px] text-[12.5px]">
          <thead>
            <tr className="label-xs text-left">
              <th className="py-2 font-medium">Twin, horizon</th>
              <th className="py-2 text-right font-medium">MARD</th>
              <th className="py-2 text-right font-medium">Parkes zone A</th>
              <th className="py-2 text-right font-medium">80% interval coverage</th>
            </tr>
          </thead>
          <tbody>
            {f.horizons_min.map((h, i) => (
              <tr key={h} className="border-t border-line-2">
                <td className="num py-2">+{h} min</td>
                <td className="num py-2 text-right">{isNum(f.twin.mard[i]) ? `${f.twin.mard[i]!.toFixed(1)}%` : DASH}</td>
                <td className="num py-2 text-right">{isNum(f.twin.parkes_A[i]) ? `${f.twin.parkes_A[i]!.toFixed(1)}%` : DASH}</td>
                <td className="num py-2 text-right">{pct(f.twin.coverage_80[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RiskPanel({ r }: { r: RealValidation }) {
  const cols = [
    { k: "baseline", label: "Baseline features" },
    { k: "plus_twin", label: "+ twin features" },
    { k: "transfer_no_retrain", label: "Synthetic model, no retraining" },
  ] as const;
  return (
    <Panel title="Risk prediction, like for like" kicker="AUROC / AUPRC · patient-level 5-fold CV, identical windows for every model" className="xl:col-span-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12.5px]">
          <thead>
            <tr className="label-xs text-left">
              <th className="py-2 font-medium">Event</th>
              {cols.map((c) => (
                <th key={c.k} className="py-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.risk.map((e) => (
              <tr key={e.event} className="border-t border-line-2 align-top">
                <td className="py-2.5">
                  <div className="font-medium text-ink">{EVENT_LABEL[e.event] ?? e.event}</div>
                  <div className="num text-[11px] text-muted-ink">
                    base rate {pct(e.base_rate)} · {isNum(e.n_windows) ? grouped(e.n_windows) : DASH} windows
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.k} className="num py-2.5 text-right">
                    <div className={c.k === "plus_twin" ? "font-semibold text-ink" : ""}>{n3(e[c.k].auroc)}</div>
                    <div className="text-[11px] text-muted-ink">{n3(e[c.k].auprc)}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-ink">
        Baseline = GlycoTwin&rsquo;s CGM, meal, activity and EHR features with its person-level folds; &ldquo;+ twin&rdquo; adds Pratibimb&rsquo;s forecast quantiles, exceedance probabilities and posterior physiology. The last column applies the synthetic-trained Pratibimb model as is.
      </p>
    </Panel>
  );
}

function Ratio({ label, v, sub }: { label: string; v: number | null; sub: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-card p-4">
      <div className="label-xs">{label}</div>
      <div className="num mt-1 text-[26px] font-bold tracking-[-0.03em] text-ink">{isNum(v) ? `${v.toFixed(2)}×` : DASH}</div>
      <div className="mt-1 text-[11.5px] text-muted-ink">{sub}</div>
    </div>
  );
}

export function RealValidationSection() {
  const q = useRealValidation();
  if (q.status === "loading") return <PanelSkeleton />;
  if (q.status === "error" || !q.data) {
    return (
      <Panel title="Validated on real patients">
        <p className="text-[13px] text-body">The real-data report (real_validation.json) is not available in this build.</p>
      </Panel>
    );
  }
  const r = q.data;
  const s = r.synthetic_vs_real;
  return (
    <section className="space-y-4" aria-labelledby="real-validation">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">External validation</div>
          <h2 id="real-validation" className="h-section mt-1 text-[24px]">
            Validated on real patients
          </h2>
          <p className="mt-1 max-w-3xl text-[13.5px] text-body">
            The unchanged twin and risk layer, run on open, de-identified CGM records. Nothing was tuned on them. Read from{" "}
            <span className="font-mono text-[12px]">reports/real_validation.json</span>
            {r.generated_at ? `, generated ${fmtDate(ms(r.generated_at))}` : ""}.
          </p>
        </div>
        <RealBadge />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {r.datasets.map((d) => (
          <div key={d.name} className="rounded-2xl border border-line/80 bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[15px] font-semibold text-ink">{d.name}</div>
              <div className="text-[11.5px] text-muted-ink">
                {d.source} · {d.licence}
              </div>
            </div>
            <div className="num mt-1 text-[12.5px] text-body">
              {d.n_people} people · {d.used_records} records · {isNum(d.n_days) ? Math.round(d.n_days) : DASH} days
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-ink">{d.notes}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <ForecastPanel r={r} />
        <RiskPanel r={r} />
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <Panel title="Synthetic vs real" kicker="Synthetic ÷ real, same label rules on 15-min CGM" className="lg:col-span-5">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <Ratio label="≥180 event rate" v={s.event_rate_ratio_ge180} sub="windows with ≥180 in 2 h" />
            <Ratio label=">250 event rate" v={s.event_rate_ratio_gt250} sub="windows with >250 in 2 h" />
            <Ratio label="30-min volatility" v={s.volatility_ratio_30min} sub="SD of the 30-min change" />
          </div>
        </Panel>
        <Panel title="Honest limits" className="lg:col-span-7">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-body">
            {r.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {r.notes.length > 0 && (
            <details className="mt-3 text-[12px] text-muted-ink">
              <summary className="cursor-pointer select-none">Method notes</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      </div>
    </section>
  );
}
