"use client";

import { BellIcon, ChevronRightIcon, NotebookPenIcon, Trash2Icon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import type { CareNote } from "@/lib/careplan";
import { outcomeAt, leadAt, type Series } from "@/lib/series";
import { fmtDayTime, fmtRelative } from "@/lib/time";
import { cn } from "@/lib/utils";

import { Empty, Panel } from "../panel";
import { fmtProb } from "./risk-panel";

export const KIND = {
  hyper_2h: { label: "Hyperglycaemia within 2 h", short: "Hyper 2 h", color: "var(--r-high)" },
  hypo_1h: { label: "Hypoglycaemia within 1 h", short: "Hypo 1 h", color: "var(--alert)" },
  nocturnal_hypo: { label: "Nocturnal hypoglycaemia", short: "Night hypo", color: "var(--twin)" },
} as const;

const OUTCOME = {
  true_positive: { label: "Event followed", bg: "color-mix(in oklab, var(--pos) 12%, var(--card))", dot: "var(--pos)" },
  false_positive: { label: "No event", bg: "var(--page-warm)", dot: "var(--faint)" },
  pending: { label: "Window open", bg: "color-mix(in oklab, var(--twin) 12%, var(--card))", dot: "var(--twin)" },
} as const;

export function AlertFeed({ alerts, clock, className }: { alerts: Series["alerts"]; clock: number; className?: string }) {
  const [all, setAll] = useState(false);
  const sorted = [...alerts].sort((a, b) => b.ms - a.ms);
  const shown = all ? sorted : sorted.slice(0, 6);
  const open = sorted.filter((a) => outcomeAt(a, clock) === "pending").length;
  return (
    <Panel
      id="alerts"
      title="Alert feed"
      icon={<BellIcon className="size-4" />}
      kicker={`${sorted.length} issued in this window · ${open} open`}
      className={className}
      bodyClassName="p-3 sm:p-4"
    >
      {sorted.length === 0 ? (
        <Empty title="No alerts issued in this window">The hysteresis rule allows one alert per event window; quiet is a result too.</Empty>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {shown.map((a) => {
              const o = outcomeAt(a, clock);
              const lead = leadAt(a, clock);
              const k = KIND[a.kind];
              return (
                <motion.li key={a.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                  <details className="group rounded-2xl border border-line/80 bg-card px-4 py-3 transition-colors open:bg-page hover:bg-page">
                    <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: k.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13.5px] font-semibold text-ink">{k.label}</span>
                          <span className="inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10.5px] font-medium text-ink" style={{ background: OUTCOME[o].bg }}>
                            <span className="size-1.5 rounded-full" style={{ background: OUTCOME[o].dot }} />
                            {OUTCOME[o].label}
                          </span>
                        </div>
                        <div className="num mt-0.5 text-[12px] text-muted-ink">
                          {fmtDayTime(a.ms)} · {fmtRelative(a.ms, clock)} · p {fmtProb(a.probability)} (≥ {fmtProb(a.threshold)}){lead != null ? ` · lead ${lead} min` : ""}
                        </div>
                      </div>
                      <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-ink transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="mt-3 space-y-3 pl-5">
                      <p className="text-[12.5px] leading-relaxed text-body">
                        {a.recommendation} <span className="text-muted-ink">(illustrative)</span>
                      </p>
                      {a.drivers.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {a.drivers.slice(0, 5).map((d) => (
                            <li key={d.feature} className="inline-flex h-6 items-center gap-1 rounded-full bg-page-warm px-2.5 text-[11px] text-body">
                              <span className={d.contribution > 0 ? "text-alert" : "text-twin"}>{d.contribution > 0 ? "▲" : "▼"}</span>
                              {d.label}: {d.value_text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {sorted.length > 6 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 w-full rounded-full bg-page-warm py-2 text-[12.5px] font-semibold text-ink hover:bg-beige">
          {all ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </Panel>
  );
}

export function CarePlan({ notes, onRemove, className }: { notes: CareNote[]; onRemove: (id: string) => void; className?: string }) {
  return (
    <Panel id="careplan" title="Care plan" icon={<NotebookPenIcon className="size-4" />} kicker="Advice saved from the What-If Lab (this browser only)" className={className}>
      {notes.length === 0 ? (
        <Empty title="No advice saved yet">Run a scenario in the What-If Lab and choose “Save as advice”.</Empty>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-2xl bg-page-warm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">{n.title}</div>
                  <div className="num text-[11.5px] text-muted-ink">For {n.at}</div>
                </div>
                <button type="button" onClick={() => onRemove(n.id)} className="inline-flex size-7 items-center justify-center rounded-full text-muted-ink hover:bg-card hover:text-ink" aria-label="Remove note">
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] text-body">
                {n.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              {n.deltas.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {n.deltas.map((d) => (
                    <span key={d.label} className={cn("num inline-flex h-6 items-center rounded-full bg-card px-2.5 text-[11px] text-body")}>
                      {d.label} {d.baseline} → <b className="ml-1 font-semibold text-ink">{d.scenario}</b>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
