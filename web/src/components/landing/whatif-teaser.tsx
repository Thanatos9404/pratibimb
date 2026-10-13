"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { animate, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSize } from "@/components/charts/use-size";
import type { LandingData } from "@/lib/server/landing-data";
import { fmtTime, ms } from "@/lib/time";
import { cn } from "@/lib/utils";

import { SectionHead } from "./section-head";

type W = NonNullable<LandingData["whatif"]>;

function Curve({ w, k, width, height }: { w: W; k: number; width: number; height: number }) {
  const A = w.res.baseline;
  const B = w.res.scenario;
  const pts = A.map((a, i) => {
    const b = B[i] ?? a;
    return { t: ms(a.t), p10: a.p10 + (b.p10 - a.p10) * k, p50: a.p50 + (b.p50 - a.p50) * k, p90: a.p90 + (b.p90 - a.p90) * k };
  });
  const max = Math.max(260, ...A.map((p) => p.p90), ...B.map((p) => p.p90));
  const x = scaleLinear().domain([pts[0].t, pts[pts.length - 1].t]).range([30, width - 8]);
  const y = scaleLinear().domain([50, max + 10]).range([height - 20, 8]);
  const band = area<(typeof pts)[number]>().x((d) => x(d.t)).y0((d) => y(d.p10)).y1((d) => y(d.p90)).curve(curveMonotoneX)(pts) ?? "";
  const mid = line<(typeof pts)[number]>().x((d) => x(d.t)).y((d) => y(d.p50)).curve(curveMonotoneX)(pts) ?? "";
  const ghost = line<(typeof A)[number]>().x((d) => x(ms(d.t))).y((d) => y(d.p50)).curve(curveMonotoneX)(A) ?? "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => pts[0].t + (pts[pts.length - 1].t - pts[0].t) * f);
  return (
    <svg width={width} height={height} role="img" aria-label="Forecast glucose for the next five hours, planned dinner versus the swap">
      <rect x={30} width={width - 38} y={y(180)} height={y(70) - y(180)} fill="rgb(47 138 95 / 0.06)" />
      {[70, 180, 250].map((v) => (
        <g key={v}>
          <line x1={30} x2={width - 8} y1={y(v)} y2={y(v)} stroke={v === 70 ? "#c8324a" : v === 180 ? "#d99a1e" : "#c2561a"} strokeOpacity={0.4} strokeDasharray={v === 250 ? "2 4" : undefined} />
          <text x={24} y={y(v)} dy="0.32em" textAnchor="end" style={{ fontSize: 9.5, fill: "#757170" }}>
            {v}
          </text>
        </g>
      ))}
      <path d={ghost} fill="none" stroke="#a8a29f" strokeDasharray="3 4" opacity={k} />
      <path d={band} fill={k > 0.5 ? "rgb(26 22 21 / 0.1)" : "rgb(58 119 214 / 0.16)"} />
      <path d={mid} fill="none" stroke={k > 0.5 ? "#1a1615" : "#3a77d6"} strokeWidth={2.2} strokeLinecap="round" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={height - 4} textAnchor="middle" style={{ fontSize: 9.5, fill: "#757170" }}>
          {fmtTime(t)}
        </text>
      ))}
    </svg>
  );
}

const list = (xs: string[]) => (xs.length ? xs.join(" + ") : "");

export function WhatIfTeaser({ data }: { data: LandingData }) {
  const w = data.whatif;
  const [swap, setSwap] = useState(false);
  const [k, setK] = useState(0);
  const reduce = useReducedMotion();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const sec = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sec, offset: ["start end", "end start"] });
  const photoY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["-6%", "6%"]);

  useEffect(() => {
    const c = animate(k, swap ? 1 : 0, { duration: reduce ? 0 : 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: setK });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap, reduce]);

  const m = w?.res.metrics;
  const shown = useMemo(() => (m ? (swap ? m.scenario : m.baseline) : null), [m, swap]);

  return (
    <section id="whatif" ref={sec} className="scroll-mt-24 bg-[#f9f8f8] px-5 py-24 sm:py-32">
      <SectionHead eyebrow="What-If Lab" line1="Try tonight’s dinner on the twin" line2="before the patient eats it.">
        Swap rice for millet roti, add a walk after dinner, skip a sulfonylurea dose, or shorten last night’s sleep — on <i>this</i> patient, with Indian foods and their Hindi
        names.
      </SectionHead>

      <div className="relative mx-auto mt-14 max-w-[1072px] overflow-hidden rounded-[32px]">
        <motion.div style={{ y: photoY }} className="absolute -inset-y-[8%] inset-x-0">
          <Image src="/photos/thali-zoshua-colah.webp" alt="A steel thali with white rice, roti, dal and vegetable curries" fill sizes="(max-width: 1100px) 100vw, 1072px" className="object-cover" />
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/35" />
        <div className="relative flex min-h-[620px] flex-col items-center justify-center px-4 py-14 sm:min-h-[680px]">
          {w ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 40, rotate: -2 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, margin: "-15% 0px" }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-[540px] rounded-[28px] bg-white/90 p-5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45)] ring-1 ring-white/70 backdrop-blur-xl sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium text-muted-ink">{w.patientName} · next 5 h from 19:30</div>
                  <div className="mt-0.5 text-[17px] font-bold tracking-[-0.03em]">{swap ? list(w.scenarioFoods) || "Swap" : list(w.baselineFoods) || "Planned dinner"}</div>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", swap ? "bg-ink text-white" : "bg-[#dce9f8] text-ink")}>{swap ? "Scenario" : "Baseline"}</span>
              </div>
              <div ref={ref} className="mt-4">
                {width > 0 && <Curve w={w} k={k} width={width} height={210} />}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ["Peak", shown ? `${Math.round(shown.peak)}` : "—", "mg/dL"],
                  ["Above 180", shown ? `${Math.round(shown.min_above_180)}` : "—", "min"],
                  ["Hypo risk", shown ? `${Math.round(shown.hypo_probability * 100)}` : "—", "%"],
                ].map(([l, v, u]) => (
                  <div key={l} className="rounded-2xl bg-[#f4f1ee] px-3 py-2">
                    <div className="text-[11px] text-muted-ink">{l}</div>
                    <div className="num text-[18px] font-semibold tracking-[-0.02em]">
                      {v} <span className="text-[10.5px] font-normal text-muted-ink">{u}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 min-h-[40px] text-[12.5px] leading-snug text-body">{swap ? w.res.narrative[0] : `Precomputed by the engine for ${w.patientName.split(" ")[0]}: “${w.label}”.`}</p>
            </motion.div>
          ) : (
            <p className="rounded-2xl bg-white/80 px-4 py-3 text-[14px]">What-If presets appear once the engine export is present.</p>
          )}
        </div>
        {w && (
          <div className="absolute inset-x-0 bottom-6 flex justify-center px-4">
            <div role="radiogroup" aria-label="Dinner" className="frost flex rounded-full p-1.5 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.4)] ring-1 ring-white/60">
              {[
                { v: false, l: "Planned dinner" },
                { v: true, l: "Millet swap" },
              ].map((o) => (
                <button
                  key={o.l}
                  role="radio"
                  aria-checked={swap === o.v}
                  onClick={() => setSwap(o.v)}
                  className={cn("relative h-11 rounded-full px-5 text-[15px] font-semibold transition-colors sm:px-6", swap === o.v ? "text-white" : "text-ink")}
                >
                  {swap === o.v && <motion.span layoutId="whatif-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                  <span className="relative">{o.l}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mx-auto mt-4 max-w-[1072px] text-right text-[11.5px] text-muted-ink">Photo: Zoshua Colah / Unsplash</p>
    </section>
  );
}
