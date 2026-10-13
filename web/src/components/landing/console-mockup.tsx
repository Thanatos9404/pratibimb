"use client";

import { ActivityIcon, BellIcon, DropletIcon, InfoIcon, LayoutGridIcon, PlayIcon, SearchIcon, ShieldAlertIcon, UsersIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/console/avatar";
import { LEVEL_COLOR } from "@/components/console/risk";
import { rangeColor } from "@/lib/glucose";
import type { LandingData } from "@/lib/server/landing-data";
import { fmtTime } from "@/lib/time";

import { MirrorChart } from "./mirror-chart";

const W = 1180;
const H = 740;
const pct = (p: number | null | undefined) => (p == null ? "—" : p >= 0.995 ? ">99%" : `${Math.round(p * 100)}%`);

/** The real console, rendered at a fixed design size and scaled to fit (like a product screenshot, but live). */
export function ConsoleMockup({ data }: { data: LandingData }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const up = () => setScale(el.clientWidth / W);
    up();
    const ro = new ResizeObserver(up);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const c = data.cohort;
  const high = c.filter((p) => p.risk.level === "high").length;
  const alerts = c.reduce((a, p) => a + p.open_alerts, 0);
  const tirs = c.map((p) => p.tir_7d).sort((a, b) => a - b);
  const med = tirs.length ? tirs[Math.floor(tirs.length / 2)] : null;
  const watch = [...c].filter((p) => p.risk.level !== "low").slice(0, 5);
  const hero = data.hero;

  return (
    <div ref={wrap} className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
      <div
        className="absolute top-0 left-0 overflow-hidden rounded-[28px] bg-[#f9f8f8] text-left"
        style={{ width: W, height: H, transform: `scale(${scale ?? 1})`, transformOrigin: "top left", opacity: scale == null ? 0 : 1 }}
        aria-hidden
      >
        <div className="grid h-full grid-cols-[220px_1fr]">
          {/* sidebar */}
          <div className="flex flex-col border-r border-line bg-white px-4 py-5">
            <div className="mb-6 flex items-center gap-2 px-1.5">
              <Logo size={24} title={null} />
              <span className="text-[16px] font-bold tracking-[-0.03em]">Pratibimb</span>
            </div>
            {[
              [LayoutGridIcon, "Cohort", true],
              [ActivityIcon, "Model card", false],
              [InfoIcon, "About the twin", false],
              [SearchIcon, "Search", false],
            ].map(([Icon, label, on]) => {
              const I = Icon as typeof LayoutGridIcon;
              return (
                <div key={label as string} className={`mb-0.5 flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] ${on ? "bg-beige font-semibold text-ink" : "text-body"}`}>
                  <I className="size-4" strokeWidth={1.8} />
                  {label as string}
                </div>
              );
            })}
            <div className="label-xs mt-6 mb-2 border-t border-line px-3 pt-4">On watch</div>
            {watch.map((p) => (
              <div key={p.id} className="flex h-9 items-center gap-2.5 px-2 text-[12.5px] text-body">
                <Avatar name={p.display_name} size={22} />
                <span className="flex-1 truncate">{p.display_name}</span>
                <span className="size-1.5 rounded-full" style={{ background: LEVEL_COLOR[p.risk.level] }} />
              </div>
            ))}
            <div className="mt-auto rounded-2xl bg-page-warm p-3 text-[11px] text-muted-ink">Synthetic patients only. Not a medical device.</div>
          </div>

          {/* main */}
          <div className="min-w-0">
            <div className="flex h-[66px] items-center gap-4 border-b border-line/70 px-6">
              <div>
                <div className="text-[14px] font-semibold tracking-[-0.02em]">Good evening, Doctor</div>
                <div className="text-[11.5px] text-muted-ink">Twins synced to the demo clock</div>
              </div>
              <div className="mx-auto flex h-9 w-[300px] items-center gap-2 rounded-full border border-line bg-white px-3.5 text-[12.5px] text-muted-ink">
                <SearchIcon className="size-3.5" /> Search patients, ABHA, drugs
              </div>
              <div className="flex h-9 items-center gap-2 rounded-full border border-line bg-white pr-1 pl-3 shadow-[var(--shadow-card)]">
                <span className="text-[11px] text-muted-ink">Demo clock</span>
                <span className="num text-[13px] font-semibold">{fmtTime(data.now)}</span>
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-ink text-white">
                  <PlayIcon className="ml-0.5 size-3" fill="currentColor" />
                </span>
              </div>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid grid-cols-4 gap-3">
                {[
                  [UsersIcon, "Patients", String(c.length), "synced twins", "var(--muted-ink)"],
                  [ShieldAlertIcon, "High risk now", String(high), `${Math.round((high / Math.max(1, c.length)) * 100)}% of cohort`, "var(--neg)"],
                  [BellIcon, "Open alerts", String(alerts), "windows still open", "var(--muted-ink)"],
                  [DropletIcon, "Median time in range", med != null ? `${Math.round(med)}%` : "—", "7-day CGM", "var(--pos)"],
                ].map(([Icon, label, v, chip, color]) => {
                  const I = Icon as typeof UsersIcon;
                  return (
                    <div key={label as string} className="rounded-[18px] border border-line/80 p-4 shadow-[var(--shadow-card)]" style={{ background: "linear-gradient(180deg,#fff 45%,#f6f1ed 100%)" }}>
                      <div className="flex items-center gap-2 text-[12px] font-medium text-body">
                        <span className="inline-flex size-6 items-center justify-center rounded-full border border-line bg-white">
                          <I className="size-3" />
                        </span>
                        {label as string}
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <span className="text-[26px] leading-none font-semibold tracking-[-0.03em]">{v as string}</span>
                        <span className="text-[10.5px] font-semibold" style={{ color: color as string }}>
                          {chip as string}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-[1fr_270px] gap-3">
                <div className="rounded-[22px] border border-line/80 bg-white shadow-[var(--shadow-card)]">
                  <div className="flex items-center justify-between border-b border-line-2 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-semibold tracking-[-0.02em]">{hero ? `${hero.patient.display_name} · glucose and its twin` : "Glucose and its twin"}</div>
                      <div className="text-[11.5px] text-muted-ink">CGM · twin p10–p90 · forecast to +4 h</div>
                    </div>
                    <div className="flex rounded-full bg-page-warm p-1 text-[11px] font-semibold">
                      <span className="rounded-full px-2.5 py-1 text-muted-ink">6 h</span>
                      <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">24 h</span>
                      <span className="rounded-full px-2.5 py-1 text-muted-ink">3 d</span>
                    </div>
                  </div>
                  <div className="px-3 pt-2 pb-3">{hero ? <MirrorChart hero={hero} width={600} height={300} now={data.now} /> : <div className="h-[300px]" />}</div>
                </div>
                <div className="rounded-[22px] border border-line/80 bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="text-[14px] font-semibold tracking-[-0.02em]">Risk now</div>
                  <div className="mb-4 text-[11.5px] text-muted-ink">Calibrated, hybrid model</div>
                  {hero &&
                    (
                      [
                        ["Level-2 hyper · 2 h", hero.patient.risk.hyper_2h],
                        ["Hypoglycaemia · 1 h", hero.patient.risk.hypo_1h],
                        ["Nocturnal hypo", hero.patient.risk.nocturnal_hypo],
                      ] as [string, number | null][]
                    ).map(([label, p]) => (
                      <div key={label} className="mb-4">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[12.5px] font-medium">{label}</span>
                          <span className="num text-[17px] font-semibold">{pct(p)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-page-warm">
                          <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (p ?? 0) * 100)}%`, background: (p ?? 0) > 0.3 ? "var(--alert)" : (p ?? 0) > 0.1 ? "var(--r-high)" : "var(--pos)" }} />
                        </div>
                      </div>
                    ))}
                  {hero && (
                    <div className="mt-2 rounded-2xl bg-page p-3">
                      <div className="text-[11px] text-muted-ink">Glucose now</div>
                      <div className="num text-[24px] font-semibold tracking-[-0.03em]" style={{ color: hero.patient.last_glucose != null ? rangeColor(hero.patient.last_glucose) : undefined }}>
                        {hero.patient.last_glucose ?? "—"} <span className="text-[11px] font-medium text-muted-ink">mg/dL</span>
                      </div>
                      <div className="text-[11px] text-muted-ink">Twin sync error {hero.patient.mard.toFixed(1)}% (24 h)</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
