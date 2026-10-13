"use client";

import { ActivityIcon, ArrowLeftIcon, DropletIcon, FileHeart, FlaskConicalIcon, GaugeIcon, PauseIcon, PlayIcon, RotateCcwIcon, UtensilsIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { GlucoseChart } from "@/components/charts/glucose-chart";
import { LegendSwatch } from "@/components/charts/primitives";
import { api } from "@/lib/api/client";
import { useAsync, useForecast, useMetrics, usePatient, useSource, useTimeline } from "@/lib/api/hooks";
import { useCarePlan } from "@/lib/careplan";
import { rangeColor, rangeShares, trendFromSlope } from "@/lib/glucose";
import { useLive, type Speed } from "@/lib/live/use-live";
import { parseTimeline, seriesAt } from "@/lib/series";
import { fmtTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { Avatar } from "../avatar";
import { TrendGlyph, SUBTYPE_NAME } from "../cohort/cohort-view";
import { useConsoleClock } from "../console-clock";
import { ErrorBlock, MockStamp, Panel, PanelSkeleton, Segmented } from "../panel";
import { LevelPill } from "../risk";
import { StatCard, StatCardSkeleton } from "../stat-card";
import { AlertFeed, CarePlan } from "./alert-feed";
import { EhrSheet } from "./ehr-sheet";
import { RiskPanel } from "./risk-panel";
import { TwinPanel } from "./twin-panel";
import { AgpPanel, WearablesPanel } from "./wearables-panel";
import { WhatIfLab } from "./whatif-lab";

export function PatientView({ id }: { id: string }) {
  const patient = usePatient(id);
  const timeline = useTimeline(id);
  const forecast = useForecast(id);
  const metrics = useMetrics();
  const src = useSource();
  const fseries = useAsync(`fseries:${id}`, () => api.forecastSeries(id));
  const { now, setLive, setControl } = useConsoleClock();
  const care = useCarePlan(id);

  const base = useMemo(() => (timeline.data ? parseTimeline(timeline.data) : undefined), [timeline.data]);
  const live = useLive({
    source: src.data,
    patientId: id,
    base,
    now,
    initialForecast: forecast.data,
    forecastSeries: fseries.data ?? [],
  });
  const [windowH, setWindowH] = useState<"6" | "24" | "72">("24");
  const [mech, setMech] = useState(false);

  const clock = live.clock ?? now;
  const view = useMemo(() => (live.series && clock != null ? seriesAt(live.series, clock) : undefined), [live.series, clock]);

  // expose replay to the header clock pill
  const { running, toggle, moved } = live;
  useEffect(() => {
    setControl({ running, toggle, label: running ? "Pause live replay" : "Start live replay" });
    return () => setControl(null);
  }, [running, toggle, setControl]);
  useEffect(() => {
    setLive(moved ? clock : null);
    return () => setLive(null);
  }, [moved, clock, setLive]);

  const latest = useMemo(() => {
    if (!view) return null;
    for (let i = view.cgm.length - 1; i >= 0; i--) {
      const p = view.cgm[i];
      if (p.g != null) {
        const prev = view.cgm.slice(Math.max(0, i - 3), i).find((x) => x.g != null);
        const slope = prev && prev.g != null ? (p.g - prev.g) / ((p.t - prev.t) / 60000) : 0;
        return { g: p.g, t: p.t, trend: trendFromSlope(slope) };
      }
    }
    return null;
  }, [view]);
  const tir7 = useMemo(() => (view && clock ? rangeShares(view.cgm.filter((p) => p.t > clock - 7 * 86400000).map((p) => p.g)) : null), [view, clock]);

  if (patient.status === "error") return <ErrorBlock error={patient.error} onRetry={patient.retry} />;
  if (timeline.status === "error") return <ErrorBlock error={timeline.error} onRetry={timeline.retry} />;

  const p = patient.data;
  const ready = p && view && clock != null;
  const fNow = live.forecast;

  return (
    <div className="space-y-5">
      <Link href="/console" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-ink hover:text-ink">
        <ArrowLeftIcon className="size-3.5" /> Cohort
      </Link>

      {/* header */}
      <section className="rounded-3xl border border-line/80 bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        {p ? (
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <Avatar name={p.display_name} size={52} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <motion.h1 layoutId={`pname-${p.id}`} className="text-[24px] font-bold tracking-[-0.035em] text-ink sm:text-[28px]">
                    {p.display_name}
                  </motion.h1>
                  <LevelPill level={(live.risk ?? p.risk).level}>{`${(live.risk ?? p.risk).level === "high" ? "High" : (live.risk ?? p.risk).level === "moderate" ? "Moderate" : "Low"} risk`}</LevelPill>
                  {p.split && (
                    <span className="inline-flex h-6 items-center rounded-full bg-page-warm px-2.5 text-[11.5px] font-medium text-body" title="Whether this synthetic patient was held out from model training">
                      {p.split === "test" ? "Held-out test patient" : p.split === "val" ? "Validation patient" : "Training patient"}
                    </span>
                  )}
                </div>
                <div className="num mt-1 text-[13px] text-muted-ink">
                  {p.age} y · {p.sex === "F" ? "Female" : "Male"} · ABHA {p.abha} · {p.region}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="inline-flex h-7 items-center rounded-full bg-twin-soft px-3 text-[12px] font-semibold text-ink" title="Inferred by the twin from EHR + fitted physiology">
                    {p.inferred_subtype} · {SUBTYPE_NAME[p.inferred_subtype]}
                  </span>
                  {p.meds.map((m) => (
                    <span key={m} className="inline-flex h-7 items-center rounded-full bg-page-warm px-3 text-[12px] text-body">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <EhrSheet
                patient={p}
                trigger={
                  <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold text-ink hover:bg-page-warm">
                    <FileHeart className="size-4" /> EHR · FHIR
                  </button>
                }
              />
              {clock != null && now != null && (
                <WhatIfLab
                  patient={p}
                  clock={clock}
                  now={now}
                  trigger={
                    <button type="button" className="pill-dark h-11">
                      <FlaskConicalIcon className="size-4" /> What-If Lab
                    </button>
                  }
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="size-13 animate-pulse rounded-full bg-beige" />
            <div className="space-y-2">
              <div className="h-6 w-56 animate-pulse rounded-full bg-beige" />
              <div className="h-4 w-80 animate-pulse rounded-full bg-page-warm" />
            </div>
          </div>
        )}
      </section>

      <MockStamp />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {ready ? (
          <>
            <StatCard
              icon={<DropletIcon />}
              label={`Glucose · ${latest ? fmtTime(latest.t) : "no signal"}`}
              value={latest?.g ?? null}
              unit="mg/dL"
              valueColor={latest ? rangeColor(latest.g) : undefined}
              chip={latest ? TrendGlyphLabel(latest.trend) : undefined}
            >
              {latest && (
                <span key={latest.t} className="relative ml-1 inline-flex size-2 self-center">
                  {live.running && <span className="beat absolute inset-0 rounded-full bg-twin" />}
                  <span className="relative size-2 rounded-full bg-twin" />
                </span>
              )}
            </StatCard>
            <StatCard
              icon={<GaugeIcon />}
              label="Time in range, 7 d"
              value={tir7?.n ? tir7.in : null}
              suffix="%"
              chip={tir7?.n ? `${tir7.in >= 70 ? "+" : "−"}${Math.abs(Math.round(tir7.in - 70))} pts vs 70% target` : undefined}
              chipTone={tir7 && tir7.in >= 70 ? "pos" : "neg"}
            />
            <StatCard
              icon={<ActivityIcon />}
              label="Twin sync error, 24 h"
              value={p.twin.fit.mard_24h}
              digits={1}
              suffix="%"
              chip={`${Math.round(p.twin.fit.coverage_80_24h * 100)}% in 80% band`}
              chipTone={p.twin.fit.coverage_80_24h >= 0.75 ? "pos" : "warn"}
            />
            <StatCard
              icon={<UtensilsIcon />}
              label="Gut glucose on board"
              value={fNow?.raw.state.carbs_on_board_g ?? null}
              unit="g"
              chip={fNow?.raw.state.sulfonylurea_active ? "Sulfonylurea active" : fNow ? `SI ${fNow.raw.state.insulin_sensitivity_vs_baseline.toFixed(2)}× base` : undefined}
              chipTone={fNow?.raw.state.sulfonylurea_active ? "warn" : "neutral"}
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <StatCardSkeleton key={i} />)
        )}
      </div>

      {/* chart + risk */}
      <div className="grid gap-5 xl:grid-cols-12">
        {ready ? (
          <Panel
            id="glucose"
            title="Glucose and its twin"
            kicker="CGM dots · twin estimate p10–p90 · forecast cone to +4 h"
            className="xl:col-span-8"
            bodyClassName="px-3 pt-3 pb-4 sm:px-5"
            actions={
              <>
                <Segmented label="Zoom" value={windowH} onChange={setWindowH} options={[{ value: "6", label: "6 h" }, { value: "24", label: "24 h" }, { value: "72", label: "3 d" }]} />
              </>
            }
          >
            <LiveBar live={live} clock={clock} now={now} />
            <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 px-1">
              <LegendSwatch kind="dot" color="var(--r-in)" label="CGM (colour = range)" />
              <LegendSwatch kind="band" color="var(--twin-band-2)" label="Twin p10–p90" />
              <LegendSwatch kind="dash" color="var(--twin)" label="Forecast p50 · p05–p95 / p25–p75" />
              <button type="button" onClick={() => setMech((m) => !m)} aria-pressed={mech} className={cn("rounded-full transition-opacity", mech ? "opacity-100" : "opacity-60 hover:opacity-100")}>
                <LegendSwatch kind="dash" color="var(--brown)" label={mech ? "Physiology-only p50 (on)" : "Physiology-only p50 (off)"} />
              </button>
              <LegendSwatch kind="dot" color="var(--body)" label="Meal (carbs)" />
              <LegendSwatch kind="rect" color="var(--twin)" label="Dose" />
              <LegendSwatch kind="rect" color="var(--r-in)" label="Walk" />
              <LegendSwatch kind="band" color="color-mix(in oklab, var(--twin) 10%, transparent)" label="Sleep" />
            </div>
            <GlucoseChart series={view} clock={clock} windowH={Number(windowH)} forecast={fNow} showMechanistic={mech} height={470} />
          </Panel>
        ) : (
          <PanelSkeleton className="xl:col-span-8" />
        )}
        {ready ? (
          <RiskPanel
            className="xl:col-span-4"
            risk={live.risk ?? p.risk}
            drivers={fNow?.raw.drivers ?? null}
            driversAt={fNow?.at ?? null}
            metrics={metrics.data}
            clock={clock}
          />
        ) : (
          <PanelSkeleton className="xl:col-span-4" />
        )}
      </div>

      {ready ? (
        <>
          <div className="grid gap-5 xl:grid-cols-12">
            <TwinPanel className="xl:col-span-7" patient={p} forecast={fNow?.raw ?? null} glucoseNow={latest?.g ?? null} />
            <div className="space-y-5 xl:col-span-5">
              <AlertFeed alerts={view.alerts.filter((a) => a.ms > clock - 7 * 86400000)} clock={clock} />
              <CarePlan notes={care.notes} onRemove={care.remove} />
            </div>
          </div>
          <div className="grid gap-5 xl:grid-cols-12">
            <WearablesPanel className="xl:col-span-7" series={view} clock={clock} />
            <AgpPanel className="xl:col-span-5" series={view} clock={clock} />
          </div>
        </>
      ) : (
        <div className="grid gap-5 xl:grid-cols-12">
          <PanelSkeleton className="xl:col-span-7" />
          <PanelSkeleton className="xl:col-span-5" />
        </div>
      )}
    </div>
  );
}

function TrendGlyphLabel(t: ReturnType<typeof trendFromSlope>) {
  return { rising_fast: "↑↑ rising fast", rising: "↗ rising", flat: "→ steady", falling: "↘ falling", falling_fast: "↓↓ falling fast" }[t];
}

function LiveBar({ live, clock, now }: { live: ReturnType<typeof useLive>; clock: number | null; now: number | null }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-page px-3 py-2">
      <button
        type="button"
        onClick={live.toggle}
        disabled={live.ended}
        aria-pressed={live.running}
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-page disabled:opacity-40"
      >
        {live.running ? <PauseIcon className="size-3.5" fill="currentColor" /> : <PlayIcon className="size-3.5" fill="currentColor" />}
        {live.running ? "Pause" : live.moved ? "Resume live" : "Go live"}
      </button>
      <Segmented
        label="Replay speed"
        value={String(live.speed) as "60" | "120" | "300"}
        onChange={(v) => live.setSpeed(Number(v) as Speed)}
        options={[
          { value: "60", label: "60×" },
          { value: "120", label: "120×" },
          { value: "300", label: "300×" },
        ]}
      />
      {live.moved && (
        <button type="button" onClick={live.reset} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-muted-ink hover:text-ink">
          <RotateCcwIcon className="size-3.5" /> Back to {now != null ? fmtTime(now) : "now"}
        </button>
      )}
      <span className="ml-auto flex items-center gap-2 text-[12px] text-muted-ink">
        {live.running && (
          <span className="relative inline-flex size-2">
            <span className="beat absolute inset-0 rounded-full bg-alert" />
            <span className="relative size-2 rounded-full bg-alert" />
          </span>
        )}
        {live.error ? (
          <span className="text-alert">{live.error}</span>
        ) : live.running ? (
          <span className="num">Replaying · {clock != null ? fmtTime(clock) : ""} IST</span>
        ) : live.ended ? (
          "End of recorded data"
        ) : (
          "Replays the recorded future of this synthetic patient"
        )}
      </span>
    </div>
  );
}

export { TrendGlyph };
