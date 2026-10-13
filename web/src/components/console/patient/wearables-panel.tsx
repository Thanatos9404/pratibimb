"use client";

import { WatchIcon } from "lucide-react";
import { useMemo } from "react";

import { AgpChart } from "@/components/charts/agp-chart";
import { TirStack } from "@/components/charts/tir-bar";
import { HrLine, HrvNights, Hypnogram, StepsBars } from "@/components/charts/wearables";
import { gmi, mean, rangeShares, sd } from "@/lib/glucose";
import { computeAgp, lastNight, type Series } from "@/lib/series";
import { DAY, HOUR, fmtDay, fmtDuration, fmtTime } from "@/lib/time";

import { Empty, Panel } from "../panel";

function Block({ title, meta, children }: { title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-page p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {meta && <div className="num text-[11.5px] text-muted-ink">{meta}</div>}
      </div>
      {children}
    </div>
  );
}

export function WearablesPanel({ series, clock, className }: { series: Series; clock: number; className?: string }) {
  const night = useMemo(() => lastNight(series, clock), [series, clock]);
  const nights = useMemo(() => {
    return series.sleepPeriods
      .filter((p) => p.end <= clock && clock - p.end < 8 * DAY)
      .slice(-7)
      .map((p) => {
        const vals = series.hrv.filter((h) => h.t >= p.start && h.t <= p.end).map((h) => h.v);
        return { label: fmtDay(p.end).split(" ")[0], rmssd: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
      })
      .filter((n) => n.rmssd > 0);
  }, [series, clock]);
  const t0 = clock - 24 * HOUR;
  const hr24 = useMemo(() => series.hr.filter((p) => p.t >= t0 && p.t <= clock), [series.hr, t0, clock]);
  const steps24 = useMemo(() => series.steps.filter((p) => p.t >= t0 && p.t <= clock), [series.steps, t0, clock]);
  const totalSteps = steps24.reduce((a, p) => a + p.v, 0);
  const hrvDelta = nights.length > 1 ? nights[nights.length - 1].rmssd / (nights.slice(0, -1).reduce((a, n) => a + n.rmssd, 0) / (nights.length - 1)) - 1 : null;

  return (
    <Panel id="wearables" title="Wearables" icon={<WatchIcon className="size-4" />} kicker="Sleep, heart-rate variability, heart rate and steps" className={className} bodyClassName="p-3 sm:p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Block
          title="Last night"
          meta={night ? `${fmtTime(night.start)}–${fmtTime(night.end)} · ${fmtDuration(night.asleepMin)} asleep` : undefined}
        >
          {night && night.segs.length > 0 ? (
            <>
              <Hypnogram segs={night.segs} />
              <div className="num mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-ink">
                <span>Deep {fmtDuration(night.deepMin)}</span>
                <span>REM {fmtDuration(night.remMin)}</span>
                <span>Efficiency {Math.round(night.efficiency * 100)}%</span>
              </div>
            </>
          ) : (
            <Empty title="No sleep recorded yet" />
          )}
        </Block>
        <Block title="Night HRV (RMSSD, ms)" meta={hrvDelta != null ? `${hrvDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(hrvDelta * 100))}% vs baseline` : undefined}>
          {nights.length ? <HrvNights nights={nights} /> : <Empty title="No night HRV yet" />}
        </Block>
        <Block title="Heart rate, 24 h" meta={hr24.length ? `${Math.min(...hr24.map((p) => p.v))}–${Math.max(...hr24.map((p) => p.v))} bpm` : undefined}>
          {hr24.length ? <HrLine hr={hr24} sleep={series.sleepPeriods} t0={t0} t1={clock} /> : <Empty title="Watch off" />}
        </Block>
        <Block title="Steps, 24 h" meta={`${totalSteps.toLocaleString("en-IN")} steps`}>
          <StepsBars steps={steps24} t0={t0} t1={clock} />
        </Block>
      </div>
    </Panel>
  );
}

export function AgpPanel({ series, clock, className }: { series: Series; clock: number; className?: string }) {
  const data = useMemo(() => {
    const from = clock - 14 * DAY;
    const cgm = series.cgm.filter((p) => p.t > from && p.t <= clock);
    const vals = cgm.map((p) => p.g);
    const m = mean(vals);
    const s = sd(vals);
    return { agp: computeAgp(cgm), shares: rangeShares(vals), mean: m, cv: m && s ? (s / m) * 100 : null, gmi: m ? gmi(m) : null };
  }, [series.cgm, clock]);
  return (
    <Panel
      id="agp"
      title={`Ambulatory glucose profile · ${data.agp.days} days`}
      kicker={`CGM coverage ${Math.round(data.agp.coverage * 100)}% · median with 25–75% and 5–95% bands`}
      className={className}
    >
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <AgpChart bins={data.agp.bins} />
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["Mean glucose", data.mean != null ? `${Math.round(data.mean)} mg/dL` : "—"],
              ["GMI", data.gmi != null ? `${data.gmi.toFixed(1)}%` : "—"],
              ["CV", data.cv != null ? `${data.cv.toFixed(0)}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-page px-3 py-2.5">
                <dt className="text-[11px] text-muted-ink">{k}</dt>
                <dd className="num text-[15px] font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <TirStack shares={data.shares} />
      </div>
    </Panel>
  );
}
