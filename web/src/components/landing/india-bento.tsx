"use client";

import { FileJson2Icon, MoonIcon, PillIcon, ScaleIcon, UsersIcon, UtensilsIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import type { LandingData } from "@/lib/server/landing-data";
import { cn } from "@/lib/utils";

import { SectionHead } from "./section-head";

function Card({ className, icon, title, children, i }: { className?: string; icon: React.ReactNode; title: string; children: React.ReactNode; i: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.7, delay: (i % 3) * 0.08, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduce ? undefined : { y: -4 }}
      className={cn("flex flex-col overflow-hidden rounded-[28px] bg-[#f0eae5] p-7", className)}
    >
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-white text-ink shadow-[0_8px_24px_-10px_rgb(97_74_68/0.4)]">{icon}</span>
      <div className="mt-6 flex-1">{children}</div>
      <h3 className="mt-6 text-[20px] font-bold tracking-[-0.03em] text-ink">{title}</h3>
    </motion.article>
  );
}

const SUBTYPE: Record<string, string> = {
  IROD: "Insulin-resistant obese",
  SIDD: "Severe insulin-deficient",
  MARD: "Mild age-related",
  SIRD: "Severe insulin-resistant",
};

export function IndiaBento({ data }: { data: LandingData }) {
  const counts = data.metrics?.dataset.subtype_counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <section id="india" className="scroll-mt-24 bg-[#f4f1ee] px-5 py-24 sm:py-32">
      <SectionHead eyebrow="Built for India" line1="Indian phenotypes, Indian plates," line2="Indian health records." />
      <div className="mx-auto mt-14 grid max-w-[1072px] gap-5 md:grid-cols-6">
        <Card i={0} className="md:col-span-3" icon={<FileJson2Icon className="size-5" />} title="ABDM-ready: FHIR R4 with ABHA identifiers">
          <pre className="overflow-hidden rounded-2xl bg-white p-4 font-mono text-[11.5px] leading-[1.7] text-body shadow-[0_6px_24px_-12px_rgb(97_74_68/0.35)]">
            <span className="text-[#3a77d6]">&quot;resourceType&quot;</span>: &quot;Observation&quot;,{"\n"}
            <span className="text-[#3a77d6]">&quot;code&quot;</span>: {"{"} LOINC <b className="text-ink">4548-4</b> HbA1c {"}"},{"\n"}
            <span className="text-[#3a77d6]">&quot;subject&quot;</span>: ABHA <b className="text-ink">91-0000-…</b> (synthetic),{"\n"}
            <span className="text-[#3a77d6]">&quot;condition&quot;</span>: SNOMED CT <b className="text-ink">44054006</b>
          </pre>
          <p className="mt-4 text-[14.5px] leading-relaxed text-body">Every synthetic patient is exported as an HL7 FHIR R4 bundle, the format of the Ayushman Bharat Digital Mission.</p>
        </Card>
        <Card i={1} className="md:col-span-3" icon={<UtensilsIcon className="size-5" />} title={`${data.foodsCount || "—"} Indian foods with glycaemic index`}>
          <div className="flex flex-wrap gap-2">
            {data.foods.map((f) => (
              <span key={f.name} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3.5 text-[13px] shadow-[0_4px_14px_-8px_rgb(97_74_68/0.4)]">
                <span className="font-deva text-[13.5px] text-ink">{f.name_hi}</span>
                <span className="text-muted-ink">GI {f.gi}</span>
              </span>
            ))}
          </div>
          <p className="mt-4 text-[14.5px] leading-relaxed text-body">Katori and roti portions, Hindi names, values from IFCT 2017 and the International GI Tables where available.</p>
        </Card>
        <Card i={2} className="md:col-span-2" icon={<UsersIcon className="size-5" />} title="INSPIRED subtypes">
          {counts ? (
            <ul className="space-y-2.5">
              {Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <li key={k}>
                    <div className="flex justify-between text-[12.5px]">
                      <span>
                        <b className="font-semibold text-ink">{k}</b> <span className="text-muted-ink">{SUBTYPE[k]}</span>
                      </span>
                      <span className="num font-semibold">{Math.round((n / total) * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-white">
                      <motion.div className="h-1.5 rounded-full bg-[#3a77d6]" initial={{ width: 0 }} whileInView={{ width: `${(n / total) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9 }} />
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-ink">—</p>
          )}
          <p className="mt-4 text-[13.5px] leading-relaxed text-body">The synthetic cohort follows Asian Indian T2D clusters, including the “thin-fat” phenotype.</p>
        </Card>
        <Card i={3} className="md:col-span-2" icon={<PillIcon className="size-5" />} title="Sulfonylurea safety">
          <div className="rounded-2xl bg-white p-4 shadow-[0_6px_24px_-12px_rgb(97_74_68/0.35)]">
            {[
              ["Fasting day", "No breakfast, light lunch", "#d99a1e"],
              ["Glimepiride taken", "Glucose-independent insulin release", "#3a77d6"],
              ["Twin warns", "Hypoglycaemia risk before it happens", "#e5484d"],
            ].map(([a, b, c], i) => (
              <div key={a} className="flex gap-3 pb-3 last:pb-0">
                <div className="flex flex-col items-center">
                  <span className="size-2.5 rounded-full" style={{ background: c }} />
                  {i < 2 && <span className="mt-1 w-px flex-1 bg-[#ece7e3]" />}
                </div>
                <div className="-mt-1">
                  <div className="text-[13px] font-semibold">{a}</div>
                  <div className="text-[12px] text-muted-ink">{b}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13.5px] leading-relaxed text-body">Fasting with a sulfonylurea is a classic hypoglycaemia trap; the twin models it.</p>
        </Card>
        <Card i={4} className="md:col-span-2" icon={<ScaleIcon className="size-5" />} title="Asian cut-offs and late dinners">
          <div className="rounded-2xl bg-white p-4 shadow-[0_6px_24px_-12px_rgb(97_74_68/0.35)]">
            <div className="flex h-3 overflow-hidden rounded-full">
              <span className="flex-[4.5] bg-[#9cc1e7]" />
              <span className="flex-[2] bg-[#d99a1e]/70" />
              <span className="flex-[5] bg-[#e5484d]/70" />
            </div>
            <div className="num mt-1.5 flex justify-between text-[11px] text-muted-ink">
              <span>BMI 18.5</span>
              <span>23 overweight</span>
              <span>25 obese</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[12.5px]">
              <MoonIcon className="size-4 text-[#3a77d6]" />
              Dinners at <b className="num font-semibold">21:00–22:30</b>
            </div>
          </div>
          <p className="mt-4 text-[13.5px] leading-relaxed text-body">Asian BMI thresholds and Indian meal timing are built into the cohort and the priors.</p>
        </Card>
      </div>
    </section>
  );
}
