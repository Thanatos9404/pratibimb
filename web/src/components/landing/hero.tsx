"use client";

import { ArrowRightIcon } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

import { BlurWords, Magnetic } from "@/components/motion/primitives";
import type { LandingData } from "@/lib/server/landing-data";

import { ConsoleMockup } from "./console-mockup";
import { SkyShader } from "./sky-shader";

/** Photographed clouds: desaturated and crushed so the blue sky goes black, then `screen`-blended so only the white cumulus shows over the sky fade. */
export function Clouds({ progress, dense = false }: { progress?: ReturnType<typeof useScroll>["scrollYProgress"]; dense?: boolean }) {
  const reduce = useReducedMotion();
  const fallback = useScroll().scrollYProgress;
  const p = progress ?? fallback;
  const yFar = useTransform(p, [0, 1], [0, reduce ? 0 : -60]);
  const yNear = useTransform(p, [0, 1], [0, reduce ? 0 : -180]);
  const xL = useTransform(p, [0, 1], [0, reduce ? 0 : -80]);
  const xR = useTransform(p, [0, 1], [0, reduce ? 0 : 80]);
  const mask = "radial-gradient(closest-side, #000 52%, rgba(0,0,0,0.6) 70%, transparent 100%)";
  const cls = "pointer-events-none absolute select-none mix-blend-screen";
  const f = "grayscale(1) brightness(0.8) contrast(4)";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div className={cls} style={{ y: yFar, left: "-13%", top: dense ? "-10%" : "16%", width: "40vw", minWidth: 300, aspectRatio: "1.5", WebkitMaskImage: mask, maskImage: mask, filter: f, opacity: 0.9 }}>
        <Image src="/photos/sky-cumulus-ishan-sharma.webp" alt="" fill sizes="40vw" className="object-cover" priority />
      </motion.div>
      <motion.div className={cls} style={{ y: yNear, x: xL, left: "-14%", top: dense ? "28%" : "36%", width: "30vw", minWidth: 240, aspectRatio: "1.6", WebkitMaskImage: mask, maskImage: mask, filter: f }}>
        <Image src="/photos/sky-clouds-bulat-akhtiamov.webp" alt="" fill sizes="36vw" className="object-cover object-[20%_30%]" />
      </motion.div>
      <motion.div className={cls} style={{ y: yFar, right: "-14%", top: dense ? "-6%" : "8%", width: "40vw", minWidth: 300, aspectRatio: "1.5", WebkitMaskImage: mask, maskImage: mask, filter: f, scaleX: -1, opacity: 0.9 }}>
        <Image src="/photos/sky-clouds-bulat-akhtiamov.webp" alt="" fill sizes="40vw" className="object-cover object-[80%_25%]" priority />
      </motion.div>
      <motion.div className={cls} style={{ y: yNear, x: xR, right: "-13%", top: dense ? "30%" : "38%", width: "28vw", minWidth: 220, aspectRatio: "1.5", WebkitMaskImage: mask, maskImage: mask, filter: f }}>
        <Image src="/photos/sky-cumulus-ishan-sharma.webp" alt="" fill sizes="34vw" className="object-cover object-[70%_60%]" />
      </motion.div>
    </div>
  );
}

export function Hero({ data }: { data: LandingData }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const rotateX = useTransform(scrollYProgress, [0, 0.42], [reduce ? 0 : 24, 0]);
  const y = useTransform(scrollYProgress, [0, 0.42], [reduce ? 0 : 60, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.42], [reduce ? 1 : 0.9, 1]);
  const textY = useTransform(scrollYProgress, [0, 0.4], [0, reduce ? 0 : -60]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.35], [1, reduce ? 1 : 0.2]);

  return (
    <section ref={ref} id="top" className="sky-fade relative overflow-hidden pb-0">
      <Clouds progress={scrollYProgress} />
      <SkyShader className="pointer-events-none absolute inset-0 h-full w-full mix-blend-soft-light" />
      <motion.div style={{ y: textY, opacity: textOpacity }} className="relative z-10 mx-auto max-w-[1100px] px-5 pt-[132px] text-center sm:pt-[168px]">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="frost mx-auto mb-7 inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[12.5px] font-medium text-body shadow-[inset_0_0_0_1px_rgb(255_255_255/0.7)]"
        >
          <span className="font-deva text-[13px] text-ink">प्रतिबिम्ब</span>
          <span className="h-3 w-px bg-ink/20" />
          A digital twin for Type 2 Diabetes
        </motion.div>
        <h1 className="h-display text-[clamp(42px,6.6vw,84px)]">
          <BlurWords text="A living reflection" className="block" />
          <BlurWords text="of a person with diabetes." className="block" delay={0.24} />
        </h1>
        <motion.p
          initial={reduce ? false : { opacity: 0, filter: "blur(8px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.9, delay: 0.55 }}
          className="mx-auto mt-6 max-w-[680px] text-[17px] leading-[1.6] text-body sm:text-[19px]"
        >
          Pratibimb mirrors each patient’s physiology from their health record and wearables, keeps the twin in sync with every CGM reading, and sees the spike two hours
          before it happens.
        </motion.p>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.75 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Magnetic>
            <Link href="/console" className="pill-dark">
              Open clinician console <ArrowRightIcon className="arrow size-4" />
            </Link>
          </Magnetic>
          <Magnetic>
            <a href="#how" className="pill-light">
              See how it works
            </a>
          </Magnetic>
        </motion.div>
      </motion.div>

      <div className="relative z-10 mx-auto mt-16 max-w-[1220px] px-4 sm:mt-20 sm:px-8" style={{ perspective: 1600, marginBottom: "-9%" }}>
        <motion.div
          style={{ rotateX, y, scale, transformOrigin: "50% 0%" }}
          initial={reduce ? false : { opacity: 0, y: 140 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-[34px] bg-white/45 p-2 shadow-[var(--shadow-float)] ring-1 ring-white/70 backdrop-blur-md sm:p-2.5"
        >
          <ConsoleMockup data={data} />
        </motion.div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-b from-transparent to-[#f9f8f8]" />
    </section>
  );
}
