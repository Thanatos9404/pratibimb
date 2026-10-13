import { Architecture, Evidence, FinalCta, Scenarios, Team } from "@/components/landing/closing";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { IndiaBento } from "@/components/landing/india-bento";
import { LandingNav } from "@/components/landing/nav";
import { BuiltOn, Problem } from "@/components/landing/problem";
import { WhatIfTeaser } from "@/components/landing/whatif-teaser";
import { SmoothScroll } from "@/components/motion/primitives";
import { loadLandingData } from "@/lib/server/landing-data";

export const dynamic = "force-static";

export default function Home() {
  const data = loadLandingData();
  if (!data) {
    return (
      <main className="light-scope grid min-h-dvh place-items-center bg-[#f9f8f8] p-8 text-center">
        <p className="max-w-md text-[15px] text-body">No data found. Run the engine’s <code>export-demo</code> into <code>web/public/demo</code> or <code>npm run mocks</code>.</p>
      </main>
    );
  }
  return (
    <div className="light-scope bg-[#f9f8f8] text-ink">
      <SmoothScroll />
      <LandingNav />
      <main>
        <Hero data={data} />
        <BuiltOn />
        <Problem />
        <HowItWorks data={data} />
        <WhatIfTeaser data={data} />
        <IndiaBento data={data} />
        <Scenarios data={data} />
        <Evidence data={data} />
        <Architecture />
        <Team />
      </main>
      <FinalCta />
    </div>
  );
}
