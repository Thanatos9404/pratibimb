"use client";

import { scaleLinear } from "d3-scale";
import { CpuIcon } from "lucide-react";
import { motion } from "motion/react";

import { MiniLine } from "@/components/charts/sparkline";
import type { Forecast, PatientDetail, TwinParam } from "@/lib/api/types";
import { rangeColor } from "@/lib/glucose";
import { fmtTime, ms } from "@/lib/time";

import { Panel } from "../panel";

export function prettyUnit(u: string) {
  return u
    .replace(/x10\^-(\d)/g, (_, d) => `×10⁻${"⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]}`)
    .replace(/\buU\b/g, "µU")
    .replace(/^x /, "× ")
    .replace(/kg\/m2/g, "kg/m²");
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function ParamRow({ p }: { p: TwinParam }) {
  const lo = Math.min(p.p10, p.population_median);
  const hi = Math.max(p.p90, p.population_median);
  const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.2 || 1;
  const x = scaleLinear().domain([Math.max(0, lo - pad), hi + pad]).range([0, 100]);
  const ratio = p.population_median ? p.mean / p.population_median : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-3.5 md:grid-cols-[170px_minmax(0,1fr)_76px_84px]">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink">{p.label}</div>
        <div className="truncate text-[11px] text-muted-ink">{prettyUnit(p.unit)}</div>
      </div>
      <div className="order-3 col-span-2 md:order-none md:col-span-1">
        <div className="relative h-5">
          <div className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-line" />
          <motion.div
            className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full"
            style={{ left: `${x(p.p10)}%`, background: "var(--twin-band-2)" }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(1, x(p.p90) - x(p.p10))}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
          <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-twin shadow" style={{ left: `${x(p.mean)}%` }} />
          <span className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full bg-brown/70" style={{ left: `${x(p.population_median)}%` }} title={`Cohort median ${fmt(p.population_median)}`} />
        </div>
        <div className="num mt-0.5 flex justify-between gap-2 text-[10.5px] text-muted-ink">
          <span>
            p10–p90 {fmt(p.p10)}–{fmt(p.p90)}
          </span>
          <span className="text-brown">cohort median {fmt(p.population_median)}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="num text-[17px] leading-none font-semibold tracking-[-0.02em] text-ink">{fmt(p.mean)}</div>
        {ratio != null && <div className="num mt-1 text-[10.5px] whitespace-nowrap text-muted-ink">{ratio >= 1 ? `${ratio.toFixed(1)}× cohort` : `${Math.round(ratio * 100)}% of cohort`}</div>}
      </div>
      <div className="hidden md:block" title="7-day posterior trend">
        <MiniLine values={p.trend_7d} height={26} />
      </div>
    </li>
  );
}

export function TwinPanel({ patient, forecast, glucoseNow, className }: { patient: PatientDetail; forecast: Forecast | null; glucoseNow: number | null; className?: string }) {
  const tw = patient.twin;
  return (
    <Panel
      id="twin"
      title="Inside the twin"
      icon={<CpuIcon className="size-4" />}
      kicker={`Posterior physiology, updated ${fmtTime(ms(tw.updated_at))} · 7-day trend at right`}
      className={className}
      actions={
        <>
          <span className="num inline-flex h-7 items-center rounded-full bg-page-warm px-3 text-[11.5px] text-body">
            Sync MARD <b className="ml-1 font-semibold text-ink">{tw.fit.mard_24h.toFixed(1)}%</b>
          </span>
          <span className="num inline-flex h-7 items-center rounded-full bg-page-warm px-3 text-[11.5px] text-body">
            80% band coverage <b className="ml-1 font-semibold text-ink">{Math.round(tw.fit.coverage_80_24h * 100)}%</b>
          </span>
        </>
      }
    >
      <ul className="divide-y divide-line-2">
        {tw.params.map((p) => (
          <ParamRow key={p.key} p={p} />
        ))}
      </ul>
      <div className="mt-4 grid items-center gap-4 rounded-2xl bg-page p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <Schematic state={forecast?.state ?? null} glucose={glucoseNow} />
        <div>
          <div className="mb-1 text-[13px] font-semibold text-ink">Compartments, live</div>
          <p className="text-[11.5px] leading-snug text-muted-ink">
            Compartments of the twin’s glucose–insulin model. Arrows animate with the current state: gut glucose, insulin action, sulfonylurea effect. Fit scores are one-step-ahead (5-min) over the last 24 h.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function Node({ x, y, w = 132, h = 56, title, value, tint, active }: { x: number; y: number; w?: number; h?: number; title: string; value: string; tint?: string; active?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={16} fill={tint ?? "var(--card)"} stroke={active ? "var(--twin)" : "var(--line)"} strokeWidth={active ? 1.6 : 1} />
      <text x={14} y={22} style={{ fontSize: 11, fontWeight: 500, fill: "var(--muted-ink)" }}>
        {title}
      </text>
      <text x={14} y={42} className="num" style={{ fontSize: 15, fontWeight: 600, fill: "var(--ink)" }}>
        {value}
      </text>
    </g>
  );
}

function Arrow({ d, on, strength = 1 }: { d: string; on: boolean; strength?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke="var(--line)" strokeWidth={2} strokeLinecap="round" />
      {on && <path d={d} fill="none" stroke="var(--twin)" strokeWidth={1.5 + strength * 1.5} strokeLinecap="round" className="flow" opacity={0.4 + 0.6 * strength} />}
    </g>
  );
}

function Schematic({ state, glucose }: { state: Forecast["state"] | null; glucose: number | null }) {
  const cob = state?.carbs_on_board_g ?? 0;
  const ia = state?.insulin_action ?? 0;
  const su = state?.sulfonylurea_active ?? false;
  const g = state?.glucose ?? glucose;
  const si = state?.insulin_sensitivity_vs_baseline;
  const gTint = g == null ? undefined : `color-mix(in oklab, ${rangeColor(g)} 12%, var(--card))`;
  return (
    <svg viewBox="0 0 470 250" className="h-auto w-full" role="img" aria-label="Twin compartment schematic">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--muted-ink)" />
        </marker>
      </defs>
      <Arrow d="M144 48 C 175 48, 168 112, 166 112" on={cob > 2} strength={Math.min(1, cob / 60)} />
      <Arrow d="M144 196 C 172 196, 168 140, 166 140" on strength={0.35} />
      <Arrow d="M300 112 C 322 112, 318 48, 330 48" on strength={0.6} />
      <Arrow d="M300 140 C 322 140, 318 196, 330 196" on={su || (g ?? 0) > 140} strength={su ? 1 : 0.5} />
      <Arrow d="M330 214 C 300 236, 250 236, 233 172" on={ia > 0.5} strength={Math.min(1, ia / 8)} />
      <Node x={12} y={20} title="Gut · glucose on board" value={state ? `${Math.round(cob)} g` : "—"} active={cob > 2} />
      <Node x={12} y={168} title="Liver · output" value={si != null ? `SI ${si.toFixed(2)}× base` : "—"} />
      <Node x={166} y={96} w={134} h={76} title="Plasma glucose" value={g != null ? `${Math.round(g)} mg/dL` : "—"} tint={gTint} active />
      <Node x={330} y={20} w={128} title="CGM · interstitial" value="~10 min lag" />
      <Node x={330} y={168} w={128} title={su ? "Insulin action · SU on" : "Insulin action"} value={state ? `${ia.toFixed(1)} ×10⁻³/min` : "—"} active={su} />
    </svg>
  );
}
