"use client";

import { ArrowRightIcon, BellIcon, ChevronDownIcon, DropletIcon, ListFilterIcon, SearchIcon, ShieldAlertIcon, UsersIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { GlucoseSparkline } from "@/components/charts/sparkline";
import { TirMini } from "@/components/charts/tir-bar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useCohort } from "@/lib/api/hooks";
import type { Archetype, CohortPatient, Risk } from "@/lib/api/types";
import { rangeColor, TREND_LABEL, TREND_ROTATION } from "@/lib/glucose";
import { classesOf, DRUG_CLASS_LABEL, type DrugClass } from "@/lib/meds";
import { fmtDateLong, fmtTime, ms } from "@/lib/time";
import { cn } from "@/lib/utils";

import { Avatar } from "../avatar";
import { ErrorBlock, MockStamp } from "../panel";
import { LEVEL_COLOR, LevelPill, ProbChip } from "../risk";
import { StatCard, StatCardSkeleton } from "../stat-card";

const LEVELS: Risk["level"][] = ["high", "moderate", "low"];
const GROUP_LABEL: Record<Risk["level"], string> = { high: "High risk", moderate: "Moderate risk", low: "Low risk" };
const GROUP_TINT: Record<Risk["level"], string> = {
  high: "color-mix(in oklab, var(--alert) 6%, var(--card))",
  moderate: "color-mix(in oklab, var(--r-high) 8%, var(--card))",
  low: "color-mix(in oklab, var(--pos) 5%, var(--card))",
};
const maxP = (r: Risk) => Math.max(r.hyper_2h, r.hypo_1h, r.nocturnal_hypo ?? 0);

type SortKey = "risk" | "hypo" | "hyper" | "tir" | "glucose" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "risk", label: "Risk band" },
  { key: "hypo", label: "Hypo risk, 1 h" },
  { key: "hyper", label: "Hyper risk, 2 h" },
  { key: "tir", label: "Lowest time in range" },
  { key: "glucose", label: "Highest glucose now" },
  { key: "name", label: "Name" },
];

const SUBTYPES: Archetype[] = ["SIDD", "SIRD", "MARD", "IROD"];
export const SUBTYPE_NAME: Record<Archetype, string> = {
  SIDD: "Severe insulin-deficient",
  SIRD: "Severe insulin-resistant",
  MARD: "Mild age-related",
  IROD: "Insulin-resistant obese",
};

const GRID = "lg:grid-cols-[minmax(220px,1.6fr)_64px_110px_minmax(140px,1.2fr)_minmax(200px,1.3fr)_minmax(110px,0.8fr)_44px]";

export function CohortView() {
  const cohort = useCohort();
  const [q, setQ] = useState("");
  const [subtypes, setSubtypes] = useState<Archetype[]>([]);
  const [drug, setDrug] = useState<"all" | DrugClass>("all");
  const [sort, setSort] = useState<SortKey>("risk");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const patients = cohort.data?.patients;
  const rows = useMemo(() => {
    if (!patients) return [];
    const needle = q.trim().toLowerCase();
    const out = patients.filter((p) => {
      if (subtypes.length && !subtypes.includes(p.inferred_subtype)) return false;
      if (drug !== "all" && !classesOf(p.meds).has(drug)) return false;
      if (needle && !`${p.display_name} ${p.abha} ${p.id} ${p.meds.join(" ")}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: CohortPatient, b: CohortPatient) => number> = {
      risk: (a, b) => maxP(b.risk) - maxP(a.risk),
      hypo: (a, b) => b.risk.hypo_1h - a.risk.hypo_1h,
      hyper: (a, b) => b.risk.hyper_2h - a.risk.hyper_2h,
      tir: (a, b) => a.tir_7d - b.tir_7d,
      glucose: (a, b) => (b.last_glucose ?? -1) - (a.last_glucose ?? -1),
      name: (a, b) => a.display_name.localeCompare(b.display_name),
    };
    return [...out].sort(cmp[sort]);
  }, [patients, q, subtypes, drug, sort]);

  const kpi = useMemo(() => {
    if (!patients) return null;
    const n = patients.length;
    const high = patients.filter((p) => p.risk.level === "high").length;
    const alerts = patients.reduce((a, p) => a + p.open_alerts, 0);
    const tirs = patients.map((p) => p.tir_7d).sort((a, b) => a - b);
    const median = tirs.length % 2 ? tirs[(tirs.length - 1) / 2] : (tirs[tirs.length / 2 - 1] + tirs[tirs.length / 2]) / 2;
    const meetTarget = patients.filter((p) => p.tir_7d > 70).length;
    const hypoWatch = patients.filter((p) => p.risk.hypo_1h >= 0.1 || (p.risk.nocturnal_hypo ?? 0) >= 0.2).length;
    return { n, high, alerts, median, meetTarget, hypoWatch };
  }, [patients]);

  const nFilters = subtypes.length + (drug !== "all" ? 1 : 0) + (sort !== "risk" ? 1 : 0);
  const grouped = sort === "risk";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.035em] text-ink sm:text-[32px]">Cohort triage</h1>
          <p className="mt-1 max-w-xl text-[14px] text-body">Every row is a synced digital twin. Risk is the calibrated probability of an event in the window shown.</p>
        </div>
        {cohort.data && (
          <p className="text-[12.5px] text-muted-ink">
            As of {fmtDateLong(ms(cohort.data.now))}, {fmtTime(ms(cohort.data.now))} IST
          </p>
        )}
      </div>

      <MockStamp />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {kpi ? (
          <>
            <StatCard icon={<UsersIcon />} label="Patients" value={kpi.n} chip="synced twins" />
            <StatCard icon={<ShieldAlertIcon />} label="High risk now" value={kpi.high} chip={`${Math.round((kpi.high / Math.max(1, kpi.n)) * 100)}% of cohort`} chipTone={kpi.high ? "neg" : "pos"} />
            <StatCard icon={<BellIcon />} label="Open alerts" value={kpi.alerts} chip={`${kpi.hypoWatch} on hypo watch`} chipTone={kpi.hypoWatch ? "warn" : "neutral"} />
            <StatCard
              icon={<DropletIcon />}
              label="Median time in range"
              value={kpi.median}
              suffix="%"
              chip={`${kpi.meetTarget}/${kpi.n} meet >70%`}
              chipTone={kpi.median >= 70 ? "pos" : "neg"}
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <StatCardSkeleton key={i} />)
        )}
      </div>

      {cohort.status === "error" ? (
        <ErrorBlock error={cohort.error} onRetry={cohort.retry} />
      ) : (
        <section aria-labelledby="patients-title" className="overflow-hidden rounded-3xl border border-line/80 bg-card shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:flex-row sm:items-center sm:px-6">
            <h2 id="patients-title" className="text-[18px] font-semibold tracking-[-0.025em] text-ink">
              Patients
            </h2>
            <div className="flex flex-1 items-center gap-2 sm:justify-end">
              <label className="relative flex min-w-0 flex-1 items-center sm:max-w-[340px]">
                <span className="sr-only">Find a patient</span>
                <SearchIcon className="pointer-events-none absolute left-3.5 size-4 text-muted-ink" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a patient…"
                  className="h-10 w-full rounded-full border border-line bg-card pr-3 pl-10 text-[13.5px] outline-none placeholder:text-muted-ink focus-visible:border-twin"
                />
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-card px-4 text-[13.5px] font-medium text-ink hover:bg-page-warm">
                    <ListFilterIcon className="size-4" />
                    Filter
                    {nFilters > 0 && <span className="num inline-flex size-5 items-center justify-center rounded-full bg-ink text-[10.5px] text-page">{nFilters}</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[300px] rounded-2xl p-4">
                  <FilterPanel subtypes={subtypes} setSubtypes={setSubtypes} drug={drug} setDrug={setDrug} sort={sort} setSort={setSort} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div aria-hidden className={cn("label-xs hidden gap-4 border-y border-line-2 bg-page px-6 py-2.5 lg:grid", GRID)}>
            <span>Patient</span>
            <span>Subtype</span>
            <span>Glucose now</span>
            <span>Last 24 h</span>
            <span>Hyper 2 h · Hypo 1 h · Night</span>
            <span>TIR, 7 d</span>
            <span className="text-right">Alerts</span>
          </div>

          {cohort.status === "loading" ? (
            <ul>
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="flex items-center gap-4 border-b border-line-2 px-6 py-4 last:border-0">
                  <Skeleton className="size-9 rounded-full" />
                  <Skeleton className="h-4 w-40 rounded-full" />
                  <Skeleton className="h-8 flex-1 rounded-xl" />
                  <Skeleton className="h-4 w-32 rounded-full" />
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13.5px] text-muted-ink">No patients match these filters.</div>
          ) : grouped ? (
            LEVELS.map((lvl) => {
              const g = rows.filter((p) => p.risk.level === lvl);
              if (!g.length) return null;
              const isCollapsed = collapsed[lvl];
              return (
                <div key={lvl}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [lvl]: !c[lvl] }))}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-2.5 border-b border-line-2 px-6 py-3 text-left text-[14px] font-semibold text-ink"
                    style={{ background: GROUP_TINT[lvl] }}
                  >
                    <ChevronDownIcon className={cn("size-4 transition-transform", isCollapsed && "-rotate-90")} />
                    {GROUP_LABEL[lvl]}
                    <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-line bg-card px-1.5 text-[11px] font-medium">{g.length}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                        {g.map((p, i) => (
                          <PatientRow key={p.id} p={p} i={i} />
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          ) : (
            <ul>
              {rows.map((p, i) => (
                <PatientRow key={p.id} p={p} i={i} />
              ))}
            </ul>
          )}
        </section>
      )}
      {cohort.data && (
        <p className="text-[12.5px] text-muted-ink">
          Showing {rows.length} of {cohort.data.patients.length}. Subtype is inferred by the twin from EHR and fitted physiology (INSPIRED clusters), never read from a ground-truth label.
        </p>
      )}
    </div>
  );
}

function FilterPanel({
  subtypes,
  setSubtypes,
  drug,
  setDrug,
  sort,
  setSort,
}: {
  subtypes: Archetype[];
  setSubtypes: (v: Archetype[]) => void;
  drug: "all" | DrugClass;
  setDrug: (v: "all" | DrugClass) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
}) {
  const chip = (on: boolean) =>
    cn("h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors", on ? "bg-ink text-page" : "bg-page-warm text-body hover:text-ink");
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label-xs mb-2">Inferred subtype</legend>
        <div className="flex flex-wrap gap-1.5">
          {SUBTYPES.map((s) => {
            const on = subtypes.includes(s);
            return (
              <button key={s} type="button" aria-pressed={on} title={SUBTYPE_NAME[s]} className={chip(on)} onClick={() => setSubtypes(on ? subtypes.filter((x) => x !== s) : [...subtypes, s])}>
                {s}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label-xs mb-2">Medication class</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "sulfonylurea", "insulin", "sglt2", "dpp4", "metformin"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={drug === d} className={chip(drug === d)} onClick={() => setDrug(d)}>
              {d === "all" ? "All" : DRUG_CLASS_LABEL[d]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label-xs mb-2">Sort by</legend>
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <button key={s.key} type="button" aria-pressed={sort === s.key} className={chip(sort === s.key)} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>
      {(subtypes.length > 0 || drug !== "all" || sort !== "risk") && (
        <button
          type="button"
          onClick={() => {
            setSubtypes([]);
            setDrug("all");
            setSort("risk");
          }}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-ink hover:text-ink"
        >
          <XIcon className="size-3.5" /> Reset filters
        </button>
      )}
    </div>
  );
}

export function TrendGlyph({ trend, className }: { trend: CohortPatient["trend"]; className?: string }) {
  return (
    <ArrowRightIcon
      className={cn("size-3.5", className)}
      style={{ transform: `rotate(${TREND_ROTATION[trend]}deg)` }}
      aria-label={TREND_LABEL[trend]}
      strokeWidth={2.4}
    />
  );
}

function PatientRow({ p, i }: { p: CohortPatient; i: number }) {
  const onMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const g = p.last_glucose;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03 }}
      className="relative border-b border-line-2 last:border-0"
    >
      <span aria-hidden className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full" style={{ background: LEVEL_COLOR[p.risk.level] }} />
      <Link
        href={`/console/patient/${p.id}`}
        onMouseMove={onMove}
        aria-label={`${p.display_name}, ${p.age}${p.sex}, ${p.inferred_subtype}. Risk ${p.risk.level}. Glucose ${g ?? "unavailable"}.`}
        className={cn(
          "cursor-glow grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-page focus-visible:bg-page sm:px-6 lg:items-center",
          GRID,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={p.display_name} size={36} />
          <div className="min-w-0">
            <motion.div layoutId={`pname-${p.id}`} className="truncate text-[14.5px] font-semibold tracking-[-0.015em] text-ink">
              {p.display_name}
            </motion.div>
            <div className="num truncate text-[12px] text-muted-ink">
              {p.age} {p.sex} · {p.abha}
            </div>
            <div className="truncate text-[12px] text-body">{p.meds.join(" · ")}</div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 lg:items-start">
          <span className="inline-flex h-6 items-center rounded-full bg-page-warm px-2.5 text-[11.5px] font-semibold text-body">{p.inferred_subtype}</span>
          <span className="lg:hidden">
            <LevelPill level={p.risk.level} />
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="num text-[22px] leading-none font-semibold tracking-[-0.03em]" style={{ color: g == null ? undefined : rangeColor(g) }}>
            {g ?? "—"}
          </span>
          <span className="flex items-center text-body">
            <TrendGlyph trend={p.trend} />
          </span>
          <span className="text-[11px] text-muted-ink">mg/dL</span>
        </div>

        <GlucoseSparkline values={p.sparkline_24h} height={34} className="col-span-2 lg:col-span-1" />

        <div className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1">
          <ProbChip label="Hyper" p={p.risk.hyper_2h} kind="hyper_2h" title="Level-2 hyperglycaemia (>250 mg/dL) within 2 h" />
          <ProbChip label="Hypo" p={p.risk.hypo_1h} kind="hypo_1h" title="Hypoglycaemia (<70 mg/dL) within 1 h" />
          <ProbChip label="Night" p={p.risk.nocturnal_hypo} kind="nocturnal_hypo" title="Nocturnal hypoglycaemia tonight (00:00–06:00)" />
        </div>

        <div className="col-span-2 flex items-center gap-2.5 lg:col-span-1">
          <TirMini tbr={p.tbr_7d} tir={p.tir_7d} tar={p.tar_7d} className="flex-1" />
          <span className="num w-9 text-right text-[12.5px] font-semibold">{Math.round(p.tir_7d)}%</span>
        </div>

        <div className="hidden text-right lg:block">
          {p.open_alerts > 0 ? (
            <span className="num inline-flex size-6 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-page">{p.open_alerts}</span>
          ) : (
            <span className="num text-[12px] text-faint">0</span>
          )}
        </div>
      </Link>
    </motion.li>
  );
}
