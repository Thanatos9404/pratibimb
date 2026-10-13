"use client";

import { ArrowRightIcon } from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { MiniLine } from "@/components/charts/sparkline";
import { useSize } from "@/components/charts/use-size";
import { prettyUnit } from "@/components/console/patient/twin-panel";
import type { LandingData } from "@/lib/server/landing-data";
import { cn } from "@/lib/utils";

import { MirrorChart } from "./mirror-chart";
import { SectionHead } from "./section-head";

type Hero = NonNullable<LandingData["hero"]>;

const STEPS = [
  { id: "record", n: "01", title: "Record", body: "The EHR (FHIR R4, ABHA) sets the twin’s priors: HbA1c and fasting glucose for basal levels, the TyG index, waist and BMI for insulin sensitivity, duration for β-cell reserve." },
  { id: "sense", n: "02", title: "Sense", body: "CGM every 5 minutes, heart rate, night HRV, steps and sleep stages stream in, alongside logged meals and doses." },
  { id: "mirror", n: "03", title: "Mirror", body: "A 64-member Ensemble Kalman Filter keeps a glucose–insulin model in sync, re-estimating insulin sensitivity, β-cell response and liver output." },
  { id: "foresee", n: "04", title: "Foresee", body: "The synced twin forecasts four hours ahead; a LightGBM layer turns it into calibrated, explained alerts for hyper- and hypoglycaemia." },
] as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[32px] p-5 sm:p-10" style={{ background: "linear-gradient(180deg, #9cc1e7 0%, #c9d6e2 55%, #eddfd0 100%)" }}>
      <div className="min-h-[380px] rounded-[24px] bg-white p-5 shadow-[0_20px_50px_-20px_rgb(97_74_68/0.35)] sm:p-6">{children}</div>
    </div>
  );
}

function RecordVisual({ hero }: { hero: Hero }) {
  const pick = hero.patient.params.filter((p) => ["SI", "beta", "EGP", "dawn"].includes(p.key));
  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div>
        <div className="mb-3 text-[15px] font-semibold tracking-[-0.02em]">Health record</div>
        <ul className="space-y-1.5">
          {hero.patient.labs.map((l) => (
            <li key={l.name} className="flex items-baseline justify-between gap-3 rounded-xl bg-[#f9f8f8] px-3 py-2 text-[12.5px]">
              <span className="truncate text-body">{l.name}</span>
              <span className="num font-semibold whitespace-nowrap text-ink">
                {l.value} <span className="font-normal text-muted-ink">{l.unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ArrowRightIcon className="mx-auto hidden size-5 text-muted-ink sm:block" />
      <div>
        <div className="mb-3 text-[15px] font-semibold tracking-[-0.02em]">Twin priors → posteriors</div>
        <ul className="space-y-3">
          {pick.map((p) => {
            const max = Math.max(p.p90, p.population_median) * 1.25 || 1;
            return (
              <li key={p.key}>
                <div className="flex justify-between text-[12.5px]">
                  <span className="text-ink">{p.label}</span>
                  <span className="num font-semibold">{p.mean.toFixed(2)}</span>
                </div>
                <div className="relative mt-1.5 h-2 rounded-full bg-[#f4f1ee]">
                  <div className="absolute inset-y-0 rounded-full bg-[#dce9f8]" style={{ left: `${(p.p10 / max) * 100}%`, width: `${((p.p90 - p.p10) / max) * 100}%` }} />
                  <div className="absolute -top-0.5 size-3 -translate-x-1/2 rounded-full border-2 border-white bg-[#3a77d6]" style={{ left: `${(p.mean / max) * 100}%` }} />
                  <div className="absolute -top-1 -bottom-1 w-0.5 bg-[#614a44]/60" style={{ left: `${(p.population_median / max) * 100}%` }} />
                </div>
                <div className="mt-1 text-[10.5px] text-muted-ink">{prettyUnit(p.unit)} · bar = p10–p90, tick = cohort median</div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SenseVisual({ hero }: { hero: Hero }) {
  const g = hero.cgm.map((p) => p.g).filter((v): v is number => v != null);
  const rows = [
    { label: "CGM glucose", unit: "mg/dL", vals: g, color: "#2f8a5f", last: g.at(-1) },
    { label: "Heart rate", unit: "bpm", vals: hero.hr.map((p) => p.v), color: "#c8324a", last: hero.hr.at(-1)?.v },
    { label: "Heart-rate variability", unit: "ms", vals: hero.hrv.map((p) => p.v), color: "#614a44", last: hero.hrv.at(-1)?.v },
    { label: "Steps per 5 min", unit: "", vals: hero.steps.map((p) => p.v), color: "#1a1615", last: hero.steps.reduce((a, p) => a + p.v, 0) },
  ];
  const STAGE: Record<string, string> = { deep: "#3a77d6", light: "#9cc1e7", rem: "#b59a8e", wake: "#e4ddd7" };
  const s0 = hero.sleep[0]?.start ?? 0;
  const s1 = hero.sleep.at(-1)?.end ?? 1;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[130px_1fr_70px] items-center gap-3 rounded-2xl bg-[#f9f8f8] px-4 py-2.5">
          <div className="text-[12.5px] font-medium text-ink">{r.label}</div>
          {r.vals.length > 1 ? <MiniLine values={r.vals} stroke={r.color} height={30} /> : <div className="h-[30px]" />}
          <div className="num text-right text-[13px] font-semibold">
            {r.last != null ? Math.round(r.last).toLocaleString("en-IN") : "—"} <span className="text-[10.5px] font-normal text-muted-ink">{r.label.startsWith("Steps") ? "today" : r.unit}</span>
          </div>
        </div>
      ))}
      {hero.sleep.length > 0 && (
        <div className="rounded-2xl bg-[#f9f8f8] px-4 py-3">
          <div className="mb-2 flex justify-between text-[12.5px] font-medium text-ink">
            Sleep stages, last night
            <span className="flex gap-2 text-[10.5px] font-normal text-muted-ink">
              {Object.entries(STAGE).map(([k, c]) => (
                <span key={k} className="inline-flex items-center gap-1 capitalize">
                  <span className="size-2 rounded-full" style={{ background: c }} />
                  {k === "rem" ? "REM" : k}
                </span>
              ))}
            </span>
          </div>
          <div className="flex h-5 overflow-hidden rounded-full">
            {hero.sleep.map((s) => (
              <div key={s.start} style={{ width: `${((s.end - s.start) / (s1 - s0)) * 100}%`, background: STAGE[s.stage] ?? "#ddd" }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MirrorVisual({ hero, now }: { hero: Hero; now: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[15px] font-semibold tracking-[-0.02em]">{hero.patient.display_name} and {hero.patient.sex === "F" ? "her" : "his"} twin</div>
        <div className="flex gap-3 text-[11.5px] text-muted-ink">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#2f8a5f]" /> CGM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-[#3a77d6]/30" /> Twin p10–p90
          </span>
        </div>
      </div>
      <div ref={ref}>{width > 0 && <MirrorChart key={width} hero={hero} width={width} height={290} now={now} />}</div>
      <p className="mt-3 text-[12.5px] text-muted-ink">
        The band starts as a population prior and narrows onto this patient as readings arrive. Sync error over the last 24 h: <b className="text-ink">{hero.patient.mard.toFixed(1)}% MARD</b>,{" "}
        {Math.round(hero.patient.coverage * 100)}% of readings inside the 80% band.
      </p>
    </div>
  );
}

function ForeseeVisual({ hero }: { hero: Hero }) {
  const a = [...hero.alerts].reverse().find((x) => x.outcome === "true_positive") ?? hero.alerts.at(-1);
  const KIND: Record<string, string> = { hyper_2h: "Hyperglycaemia within 2 h", hypo_1h: "Hypoglycaemia within 1 h", nocturnal_hypo: "Nocturnal hypoglycaemia" };
  const risks: [string, number | null][] = [
    ["Level-2 hyper, 2 h", hero.patient.risk.hyper_2h],
    ["Hypoglycaemia, 1 h", hero.patient.risk.hypo_1h],
    ["Nocturnal hypo", hero.patient.risk.nocturnal_hypo],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-4">
        <div className="text-[15px] font-semibold tracking-[-0.02em]">Risk at 19:30</div>
        {risks.map(([l, p]) => (
          <div key={l}>
            <div className="flex justify-between text-[12.5px]">
              <span>{l}</span>
              <span className="num font-semibold">{p == null ? "—" : p >= 0.995 ? ">99%" : `${Math.round(p * 100)}%`}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-[#f4f1ee]">
              <motion.div className="h-2 rounded-full" style={{ background: (p ?? 0) > 0.3 ? "#e5484d" : (p ?? 0) > 0.1 ? "#d99a1e" : "#00a82d" }} initial={{ width: 0 }} whileInView={{ width: `${Math.max(2, (p ?? 0) * 100)}%` }} viewport={{ once: true }} transition={{ duration: 0.9 }} />
            </div>
          </div>
        ))}
      </div>
      {a && (
        <div className="rounded-2xl bg-[#f9f8f8] p-4">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#e5484d]" />
            <span className="text-[13px] font-semibold">{KIND[a.kind] ?? a.kind}</span>
          </div>
          <div className="num mt-1 text-[11.5px] text-muted-ink">
            p {Math.round(a.p * 100)}% {a.lead != null ? `· warned ${a.lead} min ahead` : ""} · {a.outcome === "true_positive" ? "event followed" : a.outcome === "pending" ? "window open" : "no event"}
          </div>
          <ul className="mt-3 space-y-1.5">
            {a.drivers.map((d) => (
              <li key={d.label} className="flex items-center gap-2 text-[12px]">
                <span className={d.contribution > 0 ? "text-[#e5484d]" : "text-[#3a77d6]"}>{d.contribution > 0 ? "▲" : "▼"}</span>
                <span className="text-body">
                  {d.label}: <b className="font-semibold text-ink">{d.value_text}</b>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-snug text-body">{a.reco}</p>
        </div>
      )}
    </div>
  );
}

export function HowItWorks({ data }: { data: LandingData }) {
  const [tab, setTab] = useState<(typeof STEPS)[number]["id"]>("record");
  const [auto, setAuto] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!auto || !inView || reduce) return;
    const id = setTimeout(() => setTab((t) => STEPS[(STEPS.findIndex((s) => s.id === t) + 1) % STEPS.length].id), 7000);
    return () => clearTimeout(id);
  }, [tab, auto, inView, reduce]);
  const hero = data.hero;

  return (
    <section id="how" className="scroll-mt-24 bg-[#f4f1ee] px-5 py-24 sm:py-32">
      <SectionHead eyebrow="How the twin works" line1="Record, sense, mirror," line2="then see what is coming.">
        A compact glucose–insulin model personalised from the record, kept in sync with every reading, and asked about the next four hours.
      </SectionHead>
      <div ref={ref} className="mx-auto mt-14 grid max-w-[1180px] gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <div role="tablist" aria-label="How the twin works" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {STEPS.map((s) => {
            const on = s.id === tab;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                aria-controls={`how-${s.id}`}
                onClick={() => {
                  setTab(s.id);
                  setAuto(false);
                }}
                className={cn("relative min-w-[230px] rounded-[24px] px-5 py-4 text-left transition-colors lg:min-w-0", on ? "text-ink" : "text-body hover:bg-white/50")}
              >
                {on && <motion.span layoutId="how-tab" className="absolute inset-0 rounded-[24px] bg-white shadow-[var(--shadow-soft)]" transition={{ type: "spring", stiffness: 300, damping: 32 }} />}
                <span className="relative block">
                  <span className="flex items-center gap-3">
                    <span className="num text-[13px] font-semibold text-brown">{s.n}</span>
                    <span className="text-[20px] font-bold tracking-[-0.03em]">{s.title}</span>
                  </span>
                  <span className={cn("mt-1.5 block text-[14px] leading-snug", on ? "text-body" : "line-clamp-2 text-muted-ink lg:line-clamp-none")}>{s.body}</span>
                  {on && auto && inView && !reduce && (
                    <motion.span key={tab} className="mt-3 block h-0.5 rounded-full bg-ink/80" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 7, ease: "linear" }} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div id={`how-${tab}`} role="tabpanel" className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10, filter: "blur(6px)" }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
              <Frame>
                {!hero ? (
                  <p className="text-[14px] text-muted-ink">Demo data not available.</p>
                ) : tab === "record" ? (
                  <RecordVisual hero={hero} />
                ) : tab === "sense" ? (
                  <SenseVisual hero={hero} />
                ) : tab === "mirror" ? (
                  <MirrorVisual hero={hero} now={data.now} />
                ) : (
                  <ForeseeVisual hero={hero} />
                )}
              </Frame>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}


