import { Ticker } from "@/components/motion/ticker";
import { Reveal } from "@/components/motion/primitives";

import { SectionHead } from "./section-head";

const STANDARDS = [
  "HL7 FHIR R4",
  "ABDM · ABHA",
  "LOINC",
  "SNOMED CT",
  "Bergman minimal model",
  "Ensemble Kalman filter",
  "LightGBM",
  "TreeSHAP",
  "Parkes error grid",
  "IFCT 2017",
  "FastAPI",
  "Next.js",
];

export function BuiltOn() {
  return (
    <section aria-label="Built on" className="bg-[#f9f8f8] pt-24 pb-6 sm:pt-28">
      <p className="text-center text-[16px] text-muted-ink sm:text-[17px]">Built on open clinical standards and open-source science</p>
      <div className="mask-x mt-8 overflow-hidden">
        <div className="marquee flex w-max gap-14 pr-14">
          {[...STANDARDS, ...STANDARDS].map((s, i) => (
            <span key={i} className="text-[22px] font-semibold tracking-[-0.03em] whitespace-nowrap text-[#a39d9a] sm:text-[26px]">
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const STATS = [
  { v: 11.4, unit: "%", big: "101 M", label: "adults in India live with diabetes" },
  { v: 15.3, unit: "%", big: "136 M", label: "more have prediabetes" },
  { v: 35.5, unit: "%", big: null, label: "have hypertension" },
  { v: 39.5, unit: "%", big: null, label: "have abdominal obesity" },
];

export function Problem() {
  return (
    <section id="problem" className="scroll-mt-24 bg-[#f9f8f8] px-5 py-24 sm:py-32">
      <SectionHead eyebrow="The problem" line1="101 million Indians live with diabetes." line2="Between visits, no one sees the spike coming.">
        Glucose moves every few minutes; clinic data arrives every few months. Indian patients also differ: insulin-deficient and “thin-fat” insulin-resistant phenotypes,
        carbohydrate-heavy meals, late dinners and fasting days on sulfonylureas.
      </SectionHead>
      <div className="mx-auto mt-16 grid max-w-[1072px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08}>
            <div className="h-full rounded-[28px] bg-[#f0eae5] p-7">
              <div className="text-[52px] leading-none font-bold tracking-[-0.045em] text-ink">
                <Ticker value={s.v} digits={1} suffix={s.unit} />
              </div>
              <div className="mt-3 text-[15px] leading-snug text-body">
                {s.big && <b className="font-semibold text-ink">~{s.big} </b>}
                {s.label}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <p className="mx-auto mt-6 max-w-[1072px] text-center text-[12.5px] text-muted-ink">
        ICMR-INDIAB-17 national survey — Anjana RM et al., <i>Lancet Diabetes &amp; Endocrinology</i> 2023.
      </p>
    </section>
  );
}
