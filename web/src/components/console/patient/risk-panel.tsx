"use client";

import { ShieldAlertIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import type { Driver, Metrics, Risk } from "@/lib/api/types";
import { fmtTime, ms } from "@/lib/time";
import { cn } from "@/lib/utils";

import { Panel, Segmented } from "../panel";
import { LEVEL_COLOR, LevelPill } from "../risk";

const TASKS = [
  { key: "hyper_2h", label: "Level-2 hyper", window: "> 250 mg/dL within 2 h" },
  { key: "hypo_1h", label: "Hypoglycaemia", window: "< 70 mg/dL within 1 h" },
  { key: "nocturnal_hypo", label: "Nocturnal hypo", window: "< 70 mg/dL tonight, 00:00–06:00" },
] as const;

export function fmtProb(p: number | null | undefined) {
  if (p == null || Number.isNaN(p)) return "—";
  if (p >= 0.995) return ">99%";
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

function levelFor(p: number | null, thr: number | undefined): Risk["level"] {
  if (p == null) return "low";
  if (thr == null) return p >= 0.5 ? "high" : p >= 0.2 ? "moderate" : "low";
  return p >= thr ? "high" : p >= thr / 2 ? "moderate" : "low";
}

export function RiskPanel({
  risk,
  drivers,
  driversAt,
  metrics,
  clock,
  className,
}: {
  risk: Risk | null;
  drivers: { hyper_2h: Driver[]; hypo_1h: Driver[] } | null;
  driversAt: number | null;
  metrics: Metrics | undefined;
  clock: number;
  className?: string;
}) {
  const [task, setTask] = useState<"hyper_2h" | "hypo_1h">(() => (risk && risk.hypo_1h > risk.hyper_2h ? "hypo_1h" : "hyper_2h"));
  const list = drivers?.[task] ?? [];
  const maxAbs = Math.max(0.01, ...list.map((d) => Math.abs(d.contribution)));
  return (
    <Panel
      id="risk"
      title="Risk now"
      icon={<ShieldAlertIcon className="size-4" />}
      kicker="Calibrated probabilities from the hybrid model"
      actions={risk ? <LevelPill level={risk.level} /> : undefined}
      className={className}
    >
      <ul className="space-y-4">
        {TASKS.map((t) => {
          const p = risk ? (risk[t.key] as number | null) : null;
          const thr = metrics?.tasks?.[t.key]?.operating_point?.threshold;
          const lvl = levelFor(p, thr);
          const isNoct = t.key === "nocturnal_hypo";
          return (
            <li key={t.key}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink">{t.label}</div>
                  <div className="truncate text-[11.5px] text-muted-ink">{t.window}</div>
                </div>
                <div className="num text-[22px] leading-none font-semibold tracking-[-0.03em]" style={{ color: lvl === "low" ? "var(--ink)" : LEVEL_COLOR[lvl] }}>
                  {p == null ? "—" : fmtProb(p)}
                </div>
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-page-warm" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p == null ? undefined : Math.round(p * 100)} aria-label={`${t.label} probability`}>
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: LEVEL_COLOR[lvl] }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(p == null ? 0 : 2, (p ?? 0) * 100)}%` }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                />
                {thr != null && (
                  <span className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-ink/70" style={{ left: `${thr * 100}%` }} title={`Alert threshold ${Math.round(thr * 100)}%`} />
                )}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-ink">
                <span>{thr != null ? `Alert threshold ${Math.round(thr * 100)}%` : "Threshold —"}</span>
                {isNoct && (
                  <span>
                    {p == null
                      ? "Assessed from 17:00 / at bedtime"
                      : risk?.nocturnal_source === "bedtime_model"
                        ? "Bedtime model"
                        : risk?.nocturnal_source === "twin_provisional"
                          ? "Provisional (twin only)"
                          : ""}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 border-t border-line-2 pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold tracking-[-0.015em] text-ink">Why the twin is worried</h3>
          <Segmented
            label="Driver task"
            value={task}
            onChange={setTask}
            options={[
              { value: "hyper_2h", label: "Hyper 2 h" },
              { value: "hypo_1h", label: "Hypo 1 h" },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <p className="text-[12.5px] text-muted-ink">No driver breakdown available at this time.</p>
        ) : (
          <ul className="space-y-2.5">
            {list.slice(0, 6).map((d) => {
              const up = d.contribution > 0;
              return (
                <li key={d.feature} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                  <div className="min-w-0 text-[12.5px] leading-tight">
                    <span className="text-ink">{d.label}</span> <span className="text-muted-ink">· {d.value_text}</span>
                  </div>
                  <span className={cn("num text-[11px] font-semibold", up ? "text-alert" : "text-twin")}>
                    {up ? "▲ raises" : "▼ lowers"}
                  </span>
                  <div className="col-span-2 flex h-1.5 items-center">
                    <div className="relative h-1.5 w-full rounded-full bg-page-warm">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ background: up ? "var(--alert)" : "var(--twin)", opacity: 0.85 }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(Math.abs(d.contribution) / maxAbs) * 100}%` }}
                        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-snug text-muted-ink">
          TreeSHAP contributions (log-odds) of the hybrid model{driversAt != null && driversAt !== clock ? `, as of ${fmtTime(driversAt)}` : ""}. Explanations, not causes.
        </p>
      </div>
    </Panel>
  );
}

export const parseAt = (iso: string | undefined) => (iso ? ms(iso) : null);
