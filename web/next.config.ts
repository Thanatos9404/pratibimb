import { existsSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

/**
 * Which static data sets exist is decided at build/dev-start time, so the
 * browser never has to probe for missing files (404s would show up as console
 * errors). Restart `next dev` after the engine writes a new export.
 */
const pub = path.join(process.cwd(), "public");
const has = (rel: string) => existsSync(path.join(pub, rel));
const staticSets = {
  demo: has("demo/clock.json") && has("demo/cohort.json"),
  mock: has("mock/clock.json"),
  demoFhir: has("demo/fhir"),
  demoForecasts: has("demo/forecasts"),
};

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_STATIC_SETS: JSON.stringify(staticSets),
  },
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:dir(demo|mock|photos|fonts)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
