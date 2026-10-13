/**
 * Data-source resolution.
 *
 *   NEXT_PUBLIC_DATA_SOURCE = demo | api | mock     (default: demo)
 *   NEXT_PUBLIC_API_BASE    = http://localhost:8000  (only used when the source is api)
 *
 * demo -> static `/demo/*` (engine export), else `/mock/*`
 * api  -> live FastAPI if /api/health answers, else `/demo/*`, else `/mock/*`
 * mock -> static `/mock/*` (dev fixtures from src/mocks/generate.ts)
 *
 * Which static sets exist is baked in at build time (next.config.ts), so the
 * browser never probes for missing files.
 */

export type SourceKind = "api" | "demo" | "mock";

export interface ResolvedSource {
  kind: SourceKind;
  /** REST base, e.g. http://localhost:8000 (api only) */
  apiBase?: string;
  /** static base path, e.g. /demo or /mock */
  staticBase?: "/demo" | "/mock";
  /** why we ended up here (shown in the badge tooltip) */
  reason: string;
}

export const STATIC_SETS: { demo: boolean; mock: boolean; demoFhir: boolean; demoForecasts: boolean } = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_STATIC_SETS ?? "{}");
  } catch {
    return { demo: false, mock: false, demoFhir: false, demoForecasts: false };
  }
})();

const REQUESTED = (process.env.NEXT_PUBLIC_DATA_SOURCE ?? "demo").toLowerCase() as SourceKind;
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

async function probe(url: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function staticFallback(prefix: string): ResolvedSource {
  if (STATIC_SETS.demo) return { kind: "demo", staticBase: "/demo", reason: `${prefix}Using the engine's static demo export.` };
  return { kind: "mock", staticBase: "/mock", reason: `${prefix}No engine export in /demo — using development mock fixtures.` };
}

let resolving: Promise<ResolvedSource> | null = null;

export function resolveSource(): Promise<ResolvedSource> {
  if (resolving) return resolving;
  resolving = (async () => {
    if (REQUESTED === "mock") return { kind: "mock", staticBase: "/mock", reason: "NEXT_PUBLIC_DATA_SOURCE=mock" } satisfies ResolvedSource;
    if (REQUESTED === "api") {
      if (API_BASE && (await probe(`${API_BASE}/api/health`, 2500))) {
        return { kind: "api", apiBase: API_BASE, reason: `Live engine at ${API_BASE}` } satisfies ResolvedSource;
      }
      return staticFallback(API_BASE ? `Engine at ${API_BASE} unreachable. ` : "NEXT_PUBLIC_API_BASE not set. ");
    }
    return staticFallback("");
  })();
  return resolving;
}

export function wsUrl(apiBase: string, path: string): string {
  return apiBase.replace(/^http/, "ws") + path;
}
