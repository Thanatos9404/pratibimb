import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Architecture, Team } from "@/components/landing/closing";

export const metadata: Metadata = { title: "About", description: "Architecture, team and scope of the Pratibimb Type 2 Diabetes digital twin." };

const LINKS: [string, string][] = [
  ["Clinician console", "/console"],
  ["Model card", "/console/model"],
  ["Photo credits", "/photos/CREDITS.md"],
];

export default function AboutPage() {
  return (
    <div className="light-scope min-h-dvh bg-[#f9f8f8] text-ink">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={30} title={null} />
          <span className="text-[19px] font-bold tracking-[-0.035em]">Pratibimb</span>
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-body hover:text-ink">
          <ArrowLeftIcon className="size-4" /> Home
        </Link>
      </header>
      <section className="sky-fade-soft px-5 pt-20 pb-24 text-center">
        <div className="eyebrow">About</div>
        <h1 className="h-display mx-auto mt-4 max-w-[860px] text-[clamp(40px,6vw,72px)]">A digital twin you can question before you advise.</h1>
        <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-body">
          Pratibimb (प्रतिबिम्ब, “reflection”) fuses a simulated health record with simulated wearable streams, keeps a physiological model in sync with them, and predicts
          adverse glucose events in advance. It is a proof of concept on synthetic data, not a medical device.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {LINKS.map(([l, h]) => (
            <Link key={h} href={h} className="pill-light h-11 text-[14px]">
              {l}
            </Link>
          ))}
        </div>
      </section>
      <Architecture />
      <Team />
      <footer className="px-5 pb-10 text-center text-[13px] text-muted-ink">Apache-2.0 · synthetic data only · not for clinical use</footer>
    </div>
  );
}
