"use client";

import { CheckIcon, DatabaseIcon, GaugeIcon, LayersIcon, TimerIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";

import { AblationChart, CalibrationChart, ForecastDumbbell, LeadHistogram, MODEL_LABEL, ParkesBars } from "@/components/charts/model-charts";
import { useMetrics, useValidation } from "@/lib/api/hooks";
import type { AblationModel, Archetype, Metrics, MetricTask } from "@/lib/api/types";
import { DASH, grouped, isNum } from "@/lib/format";
import { fmtDate, ms } from "@/lib/time";

import { ErrorBlock, MockStamp, Panel, PanelSkeleton } from "../panel";
import { StatCard, StatCardSkeleton } from "../stat-card";

const TASKS: { key: MetricTask; title: string; sub: string }[] = [
  { key: "hyper_2h", title: "Level-2 hyperglycaemia", sub: ">250 mg/dL for ≥15 min, starting within 2 h" },
  { key: "hypo_1h", title: "Hypoglycaemia", sub: "<70 mg/dL for ≥15 min, starting within 1 h" },
  { key: "nocturnal_hypo", title: "Nocturnal hypoglycaemia", sub: "any level-1 hypo 00:00–06:00, predicted at bedtime" },
];

const f3 = (v: unknown) => (isNum(v) ? v.toFixed(3) : DASH);
const pc = (v: unknown, d = 0) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : DASH);
const ci = (c?: [number, number]) => (c && isNum(c[0]) && isNum(c[1]) ? `${c[0].toFixed(3)}–${c[1].toFixed(3)}` : null);

function Metric({ k, v, note }: { k: string; v: string; note?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-[13px] text-body">{k}</dt>
      <dd className="text-right">
        <span className="num text-[14px] font-semibold text-ink">{v}</span>
        {note && <div className="num text-[10.5px] text-muted-ink">95% CI {note}</div>}
      </dd>
    </div>
  );
}

function TaskCard({ m, t, featured }: { m: Metrics; t: (typeof TASKS)[number]; featured?: boolean }) {
  const x = m.tasks?.[t.key];
  const c = m.ci95?.[t.key];
  const cg = m.cgm_labelled?.[t.key];
  const op = x?.operating_point;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={featured ? "rounded-[28px] p-[3px] shadow-[var(--shadow-soft)]" : "rounded-[28px] border border-line/80 bg-card shadow-[var(--shadow-card)]"}
      style={featured ? { background: "linear-gradient(180deg, var(--sky) 0%, var(--sand) 100%)" } : undefined}
    >
      <div className={featured ? "h-full rounded-[25px] p-6" : "h-full p-6"} style={featured ? { background: "linear-gradient(180deg, color-mix(in oklab, var(--sky-2) 55%, var(--card)) 0%, color-mix(in oklab, var(--sand-2) 70%, var(--card)) 100%)" } : undefined}>
        <div className="text-[13px] font-medium text-body">{t.sub}</div>
        <h3 className="mt-1 text-[22px] font-bold tracking-[-0.03em] text-ink">{t.title}</h3>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-[44px] leading-none font-bold tracking-[-0.04em] text-ink">{isNum(x?.auroc) ? x.auroc.toFixed(3) : DASH}</span>
          <span className="text-[13px] font-medium text-muted-ink">AUROC</span>
        </div>
        {ci(c?.auroc) && <div className="num mt-1 text-[11.5px] text-muted-ink">95% CI {ci(c?.auroc)}</div>}
        <dl className="mt-5 divide-y divide-line-2 border-t border-line-2">
          <Metric k="AUPRC" v={f3(x?.auprc)} note={ci(c?.auprc)} />
          <Metric k="Prevalence" v={pc(x?.prevalence, 1)} />
          <Metric k="Brier score" v={f3(x?.brier)} />
          <Metric k="Alert threshold" v={pc(op?.threshold)} />
          <Metric k="Sensitivity" v={pc(op?.sensitivity)} />
          <Metric k="Precision" v={pc(op?.precision)} />
          <Metric k="Alerts / patient-day" v={isNum(op?.alerts_per_patient_day) ? op.alerts_per_patient_day.toFixed(2) : DASH} />
          {isNum(op?.false_alerts_per_patient_day) && <Metric k="False alerts / patient-day" v={op.false_alerts_per_patient_day.toFixed(2)} />}
          <Metric k="Median lead time" v={isNum(op?.median_lead_min) ? `${op.median_lead_min} min` : DASH} />
        </dl>
        {cg && (
          <p className="mt-4 rounded-2xl bg-card/70 px-3 py-2 text-[11.5px] leading-snug text-body">
            Re-scored against CGM-derived labels: AUROC {f3(cg.auroc)}, AUPRC {f3(cg.auprc)}.
          </p>
        )}
        {isNum(x?.n_test) && (
          <p className="num mt-2 text-[11px] text-muted-ink">
            {grouped(x.n_test)} test decisions · {grouped(x?.n_positive)} positive{isNum(op?.events) ? ` · ${grouped(op.events)} events` : ""}
          </p>
        )}
      </div>
    </motion.div>
  );
}

type Iqr = [number, number, number];
const iqr = (v: unknown) => (Array.isArray(v) && v.length === 3 && v.every(isNum) ? (v as Iqr) : null);

function ValidationSection() {
  const v = useValidation();
  if (v.status === "loading") return <PanelSkeleton />;
  if (v.status === "error") return <ErrorBlock error={v.error} onRetry={v.retry} />;
  const d = v.data as Record<string, unknown>;
  const checks = (d.checks ?? {}) as Record<string, unknown>;
  const per = (d.per_archetype ?? {}) as Record<string, Record<string, unknown>>;
  const hypo = (d.hypo_by_medication_class ?? {}) as Record<string, Record<string, unknown>>;
  const pp = (d.postprandial_rise_by_meal ?? {}) as Record<string, Record<string, unknown>>;
  const si = d.subtype_inference as { accuracy?: number; confusion?: Record<string, Record<string, number>>; note?: string } | undefined;
  const subtypes: Archetype[] = ["SIDD", "SIRD", "MARD", "IROD"];
  const maxHypo = Math.max(0.01, ...Object.values(hypo).map((h) => (isNum(h.hypo_episodes_per_week_mean) ? h.hypo_episodes_per_week_mean : 0)));
  const maxRise = Math.max(1, ...Object.values(pp).map((h) => (isNum(h.median_rise_mg_dl) ? h.median_rise_mg_dl : 0)));

  const checkRows: [string, string, boolean | null][] = [
    ["Cohort median TIR", isNum(checks.cohort_median_tir_pct) ? `${checks.cohort_median_tir_pct}% (target 55–75%)` : DASH, typeof checks.tir_in_target_band === "boolean" ? checks.tir_in_target_band : null],
    ["Patients with CV 20–36%", isNum(checks.share_cv_20_36_pct) ? `${checks.share_cv_20_36_pct}% · median CV ${checks.cv_median_pct ?? DASH}%` : DASH, isNum(checks.share_cv_20_36_pct) ? checks.share_cv_20_36_pct >= 50 : null],
    ["Hypo episodes in SU / insulin users", isNum(checks.share_of_hypo_episodes_in_su_or_insulin_users_pct) ? `${checks.share_of_hypo_episodes_in_su_or_insulin_users_pct}%` : DASH, isNum(checks.share_of_hypo_episodes_in_su_or_insulin_users_pct) ? checks.share_of_hypo_episodes_in_su_or_insulin_users_pct >= 80 : null],
    ["CGM mean vs ADAG eAG (Pearson r)", isNum(checks.mean_glucose_vs_adag_r) ? checks.mean_glucose_vs_adag_r.toFixed(3) : DASH, isNum(checks.mean_glucose_vs_adag_r) ? checks.mean_glucose_vs_adag_r >= 0.8 : null],
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Realism checks" kicker={`${d.patients ?? DASH} synthetic patients × ${d.days ?? DASH} days, against literature targets`}>
          <ul className="divide-y divide-line-2">
            {checkRows.map(([k, val, ok]) => (
              <li key={k} className="flex items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-2.5 text-[13px] text-body">
                  <span className="inline-flex size-5 items-center justify-center rounded-full" style={{ background: ok == null ? "var(--page-warm)" : ok ? "color-mix(in oklab, var(--pos) 15%, var(--card))" : "color-mix(in oklab, var(--neg) 12%, var(--card))" }}>
                    {ok == null ? null : ok ? <CheckIcon className="size-3 text-pos" /> : <XIcon className="size-3 text-neg" />}
                  </span>
                  {k}
                </span>
                <span className="num text-right text-[13px] font-semibold text-ink">{val}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Hypoglycaemia by medication class" kicker="Mean hypo episodes per patient-week (CGM)">
          <ul className="space-y-3">
            {Object.entries(hypo).map(([k, h]) => {
              const val = isNum(h.hypo_episodes_per_week_mean) ? h.hypo_episodes_per_week_mean : null;
              return (
                <li key={k}>
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="text-ink capitalize">{k.replace(/_/g, " ")} <span className="text-muted-ink">· n={String(h.n ?? DASH)}</span></span>
                    <span className="num font-semibold">{val != null ? val.toFixed(2) : DASH}</span>
                  </div>
                  <div className="h-2 rounded-full bg-page-warm">
                    <motion.div className="h-2 rounded-full bg-alert/80" initial={{ width: 0 }} whileInView={{ width: `${((val ?? 0) / maxHypo) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Per inferred archetype" kicker="CGM mean vs ADAG eAG from HbA1c; medians with IQR" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-[12.5px]">
              <thead className="bg-page-warm">
                <tr className="label-xs text-left">
                  <th className="px-5 py-2.5 font-medium">Archetype</th>
                  <th className="px-2 py-2.5 text-right font-medium">n</th>
                  <th className="px-2 py-2.5 text-right font-medium">CGM mean</th>
                  <th className="px-2 py-2.5 text-right font-medium">ADAG eAG</th>
                  <th className="px-2 py-2.5 text-right font-medium">TIR</th>
                  <th className="px-5 py-2.5 text-right font-medium">CV</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(per).map(([k, r]) => {
                  const mg = iqr(r.cgm_mean_glucose_iqr);
                  const ea = iqr(r.adag_eag_from_hba1c_iqr);
                  const tir = iqr(r.tir_iqr);
                  const cv = iqr(r.cv_iqr);
                  return (
                    <tr key={k} className="border-t border-line-2">
                      <td className="px-5 py-2.5 font-semibold">{k}</td>
                      <td className="num px-2 py-2.5 text-right">{String(r.n ?? DASH)}</td>
                      <td className="num px-2 py-2.5 text-right">{mg ? mg[1].toFixed(0) : DASH}</td>
                      <td className="num px-2 py-2.5 text-right">{ea ? ea[1].toFixed(0) : DASH}</td>
                      <td className="num px-2 py-2.5 text-right">{tir ? `${tir[1].toFixed(0)}% (${tir[0].toFixed(0)}–${tir[2].toFixed(0)})` : DASH}</td>
                      <td className="num px-5 py-2.5 text-right">{cv ? `${cv[1].toFixed(0)}%` : DASH}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Post-meal rise by meal" kicker="Median CGM rise (mg/dL) after logged meals">
          <ul className="space-y-3">
            {Object.entries(pp).map(([k, r]) => {
              const val = isNum(r.median_rise_mg_dl) ? r.median_rise_mg_dl : null;
              return (
                <li key={k}>
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="text-ink capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="num font-semibold">{val != null ? `${val.toFixed(0)} mg/dL` : DASH}</span>
                  </div>
                  <div className="h-2 rounded-full bg-page-warm">
                    <motion.div className="h-2 rounded-full bg-twin/80" initial={{ width: 0 }} whileInView={{ width: `${((val ?? 0) / maxRise) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      {si?.confusion && (
        <Panel title="Subtype inference vs hidden truth" kicker={`${si.note ?? ""} Accuracy ${isNum(si.accuracy) ? `${(si.accuracy * 100).toFixed(1)}%` : DASH} (4 classes; chance ≈ 25%).`}>
          <div className="overflow-x-auto">
            <table className="mx-auto text-[12.5px]">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-ink">truth ↓ / inferred →</th>
                  {subtypes.map((s) => (
                    <th key={s} className="px-3 py-2 text-center font-semibold">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subtypes.map((row) => {
                  const r = si.confusion?.[row] ?? {};
                  const tot = Object.values(r).reduce((a, b) => a + b, 0) || 1;
                  return (
                    <tr key={row}>
                      <th className="px-3 py-1.5 text-left font-semibold">{row}</th>
                      {subtypes.map((c) => {
                        const n = r[c] ?? 0;
                        return (
                          <td key={c} className="p-1">
                            <div
                              className="num flex h-11 w-16 items-center justify-center rounded-xl text-[13px] font-semibold"
                              style={{ background: `color-mix(in oklab, var(--twin) ${Math.round((n / tot) * 70)}%, var(--page-warm))`, color: n / tot > 0.45 ? "#fff" : "var(--ink)" }}
                            >
                              {n}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function ModelView() {
  const m = useMetrics();
  if (m.status === "error") return <ErrorBlock error={m.error} onRetry={m.retry} />;
  const x = m.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.035em] text-ink sm:text-[32px]">Model card</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-body">
            Every number on this page is read from <span className="font-mono text-[12.5px]">reports/metrics.json</span>. Evaluated on held-out synthetic patients generated by a different, richer simulator than the twin.
          </p>
        </div>
        {x && <p className="text-[12.5px] text-muted-ink">Generated {fmtDate(ms(x.generated_at))}</p>}
      </div>

      <MockStamp />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {x ? (
          <>
            <StatCard icon={<DatabaseIcon />} label="Synthetic patients" value={x.dataset.patients} chip={`${x.dataset.train_patients}/${x.dataset.val_patients}/${x.dataset.test_patients} train/val/test`} />
            <StatCard icon={<TimerIcon />} label="Days per patient" value={x.dataset.days} chip="5-min CGM" />
            <StatCard icon={<LayersIcon />} label="CGM readings" value={x.dataset.cgm_points / 1e6} digits={2} suffix="M" chip={isNum(x.dataset.decision_points) ? `${grouped(x.dataset.decision_points)} decisions` : undefined} />
            <StatCard icon={<GaugeIcon />} label="Twin sync error (MARD)" value={x.sync?.twin_vs_truth_mard ?? null} digits={1} suffix="%" chip={isNum(x.sync?.cgm_vs_truth_mard) ? `CGM itself ${x.sync.cgm_vs_truth_mard.toFixed(1)}%` : undefined} />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <StatCardSkeleton key={i} />)
        )}
      </div>

      {!x ? (
        <PanelSkeleton />
      ) : (
        <>
          <section>
            <div className="mb-4">
              <div className="eyebrow">Risk layer</div>
              <h2 className="h-section mt-1 text-[24px]">Three alerts, scored on held-out patients</h2>
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-3">
              {TASKS.map((t, i) => (
                <TaskCard key={t.key} m={x} t={t} featured={i === 0} />
              ))}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-12">
            <Panel title="Ablation: does the twin help?" kicker="Same patient-level splits, four model variants" className="xl:col-span-7">
              <AblationChart ablation={x.ablation} />
              {x.brier_by_model && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[12px]">
                    <thead>
                      <tr className="label-xs text-left">
                        <th className="py-2 font-medium">Brier score</th>
                        {(["ml_no_twin", "twin_only", "hybrid"] as AblationModel[]).map((k) => (
                          <th key={k} className="py-2 text-right font-medium">
                            {MODEL_LABEL[k]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TASKS.map((t) => (
                        <tr key={t.key} className="border-t border-line-2">
                          <td className="py-2 text-body">{t.title}</td>
                          {(["ml_no_twin", "twin_only", "hybrid"] as AblationModel[]).map((k) => (
                            <td key={k} className="num py-2 text-right">
                              {f3(x.brier_by_model?.[t.key]?.[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title="What the models lean on" kicker="Mean |TreeSHAP| contribution (log-odds), hybrid models" className="xl:col-span-5">
              {TASKS.map((t) => {
                const feats = x.top_features.filter((f) => f.task === t.key).slice(0, 5);
                if (!feats.length) return null;
                const max = Math.max(...feats.map((f) => f.mean_abs_contrib));
                return (
                  <div key={t.key} className="mb-5 last:mb-0">
                    <div className="mb-2 text-[13px] font-semibold text-ink">{t.title}</div>
                    <ul className="space-y-1.5">
                      {feats.map((f) => (
                        <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_110px_40px] items-center gap-3 text-[12px]">
                          <span className="truncate text-body">{f.label}</span>
                          <span className="h-1.5 rounded-full bg-page-warm">
                            <span className="block h-1.5 rounded-full bg-twin" style={{ width: `${(f.mean_abs_contrib / max) * 100}%` }} />
                          </span>
                          <span className="num text-right text-muted-ink">{f.mean_abs_contrib.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </Panel>
          </div>

          <Panel title="Calibration" kicker="Predicted probability vs observed frequency on test patients (dot size = n)">
            <div className="grid gap-6 md:grid-cols-3">
              {TASKS.map((t) => (
                <div key={t.key}>
                  <div className="mb-1 text-[13px] font-semibold">{t.title}</div>
                  <CalibrationChart bins={x.tasks[t.key]?.calibration ?? []} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Lead time" kicker="Minutes between alert and event onset, true positives at the operating point">
            <div className="grid gap-6 md:grid-cols-3">
              {TASKS.map((t) => (
                <div key={t.key}>
                  <div className="mb-1 text-[13px] font-semibold">{t.title}</div>
                  <LeadHistogram hist={x.tasks[t.key]?.lead_time_hist ?? []} median={x.tasks[t.key]?.operating_point?.median_lead_min} />
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Glucose forecast accuracy" kicker="RMSE (mg/dL): twin ensemble median vs linear-extrapolation baseline">
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-ink">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-twin" /> Twin</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-muted-ink" /> Baseline</span>
              </div>
              <ForecastDumbbell f={x.forecast} />
              <table className="mt-4 w-full text-[12.5px]">
                <thead>
                  <tr className="label-xs text-left">
                    <th className="py-2 font-medium">Horizon</th>
                    <th className="py-2 text-right font-medium">RMSE</th>
                    <th className="py-2 text-right font-medium">MARD</th>
                    <th className="py-2 text-right font-medium">80% PI coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {x.forecast.horizons_min.map((h, i) => (
                    <tr key={h} className="border-t border-line-2">
                      <td className="num py-2">+{h} min</td>
                      <td className="num py-2 text-right">{isNum(x.forecast.rmse[i]) ? x.forecast.rmse[i].toFixed(1) : DASH}</td>
                      <td className="num py-2 text-right">{isNum(x.forecast.mard[i]) ? `${x.forecast.mard[i].toFixed(1)}%` : DASH}</td>
                      <td className="num py-2 text-right">{pc(x.forecast.coverage_80[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Parkes consensus error grid (Type 2)" kicker="Share of forecast points by zone; A + B are clinically acceptable">
              <ParkesBars parkes={x.forecast.parkes} />
            </Panel>
          </div>
        </>
      )}

      <section className="space-y-4">
        <div>
          <div className="eyebrow">Cohort realism</div>
          <h2 className="h-section mt-1 text-[24px]">Is the synthetic cohort believable?</h2>
        </div>
        <ValidationSection />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Intended use">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-body">
            <li>A proof-of-concept clinician console for Type 2 Diabetes, built for the Happiest Health Digital Twin Challenge 2026.</li>
            <li>Decision support research only: forecasts, alerts and What-If simulations on synthetic patients.</li>
            <li>Shows how a doctor could interact with a virtual patient before advising a real one.</li>
          </ul>
        </Panel>
        <Panel title="Limitations">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-body">
            <li>All patients are synthetic. Results have not been validated on real people and must not be used for treatment.</li>
            <li>The truth simulator is richer than the twin, but both are models; real physiology, sensors and behaviour are messier.</li>
            <li>Subtype inference is weak (see the confusion matrix) and is shown as a hint, never a diagnosis.</li>
            <li>Food values are approximate (IFCT 2017 / International GI Tables where available, estimates otherwise).</li>
            {(x?.notes ?? []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
