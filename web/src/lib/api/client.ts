import { bundleFromPatient } from "@/lib/fhir";
import { DAY, toISO } from "@/lib/time";

import { resolveSource, STATIC_SETS, type ResolvedSource } from "./source";
import type {
  Clock,
  CohortResponse,
  CohortValidation,
  FhirBundle,
  FoodsResponse,
  Forecast,
  ForecastSeries,
  Metrics,
  PatientDetail,
  Timeline,
  WhatIfPreset,
  WhatIfRequest,
  WhatIfResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  } catch (e) {
    throw new ApiError(`Network error while loading ${url}: ${(e as Error).message}`, 0, url);
  }
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText} — ${url}`, res.status, url);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new ApiError(`Expected JSON from ${url}, got ${ct || "unknown content"}`, 415, url);
  return (await res.json()) as T;
}

const memo = new Map<string, Promise<unknown>>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn().catch((e) => {
    memo.delete(key);
    throw e;
  });
  memo.set(key, p);
  return p;
}

const enc = encodeURIComponent;
const s = (src: ResolvedSource, rel: string) => `${src.staticBase}/${rel}`;

const PRESET_LABEL: Record<string, string> = {
  "swap-rice-for-millet-roti": "Swap rice / wheat for millet roti at dinner",
  "walk-15-after-dinner": "15-minute walk after dinner",
  "short-sleep": "Short night (4.5 h sleep)",
};

/** Accepts the export's `{presets:[{id,label,request}]}` and the older string-list shape. */
function normalizePresets(raw: unknown): WhatIfPreset[] {
  const list = Array.isArray(raw) ? raw : ((raw as { presets?: unknown[] })?.presets ?? []);
  return list
    .map((p) => {
      if (typeof p === "string") return { id: p, label: PRESET_LABEL[p] ?? p.replace(/-/g, " ") };
      const o = p as WhatIfPreset;
      return o?.id ? { id: o.id, label: o.label ?? o.id, request: o.request } : null;
    })
    .filter((x): x is WhatIfPreset => x != null);
}

export const api = {
  source: resolveSource,

  async clock(): Promise<Clock> {
    const src = await resolveSource();
    return cached(`clock:${src.kind}`, () => (src.kind === "api" ? getJSON<Clock>(`${src.apiBase}/api/clock`) : getJSON<Clock>(s(src, "clock.json"))));
  },

  async cohort(): Promise<CohortResponse> {
    const src = await resolveSource();
    return cached(`cohort:${src.kind}`, () => (src.kind === "api" ? getJSON(`${src.apiBase}/api/cohort`) : getJSON(s(src, "cohort.json"))));
  },

  async patient(id: string): Promise<PatientDetail> {
    const src = await resolveSource();
    return cached(`patient:${src.kind}:${id}`, () =>
      src.kind === "api" ? getJSON(`${src.apiBase}/api/patients/${enc(id)}`) : getJSON(s(src, `patients/${enc(id)}.json`)),
    );
  },

  /** FHIR bundle. If a static set carries none, it is derived client-side from the patient record — and labelled so. */
  async fhir(id: string): Promise<{ bundle: FhirBundle; derived: boolean }> {
    const src = await resolveSource();
    return cached(`fhir:${src.kind}:${id}`, async () => {
      if (src.kind === "api") return { bundle: await getJSON<FhirBundle>(`${src.apiBase}/api/patients/${enc(id)}/fhir`), derived: false };
      if (src.kind === "mock" || STATIC_SETS.demoFhir) {
        try {
          return { bundle: await getJSON<FhirBundle>(s(src, `fhir/${enc(id)}.json`)), derived: false };
        } catch {
          /* fall through */
        }
      }
      return { bundle: bundleFromPatient(await api.patient(id)), derived: true };
    });
  },

  /**
   * Timeline. Static exports cover now−7d..now+3d (the future powers the offline
   * replay). From the live API we request now−14d..now for the AGP.
   */
  async timeline(id: string): Promise<Timeline> {
    const src = await resolveSource();
    return cached(`timeline:${src.kind}:${id}`, async () => {
      if (src.kind !== "api") return getJSON<Timeline>(s(src, `timeline/${enc(id)}.json`));
      const clock = await api.clock();
      const now = Date.parse(clock.now);
      const from = toISO(Math.max(Date.parse(clock.start), now - 14 * DAY));
      return getJSON<Timeline>(`${src.apiBase}/api/patients/${enc(id)}/timeline?from=${enc(from)}&to=${enc(clock.now)}`);
    });
  },

  async forecast(id: string, at?: string): Promise<Forecast> {
    const src = await resolveSource();
    if (src.kind === "api") return getJSON(`${src.apiBase}/api/patients/${enc(id)}/forecast${at ? `?at=${enc(at)}` : ""}`);
    return cached(`forecast:${src.kind}:${id}`, () => getJSON(s(src, `forecast/${enc(id)}.json`)));
  },

  /** Hourly forecasts after `now` for the offline replay (static demo only). */
  async forecastSeries(id: string): Promise<Forecast[]> {
    const src = await resolveSource();
    if (src.kind !== "demo" || !STATIC_SETS.demoForecasts) return [];
    return cached(`forecasts:${src.kind}:${id}`, async () => {
      try {
        return (await getJSON<ForecastSeries>(s(src, `forecasts/${enc(id)}.json`))).forecasts ?? [];
      } catch {
        return [];
      }
    });
  },

  async foods(): Promise<FoodsResponse> {
    const src = await resolveSource();
    return cached(`foods:${src.kind}`, () => (src.kind === "api" ? getJSON(`${src.apiBase}/api/foods`) : getJSON(s(src, "foods.json"))));
  },

  async metrics(): Promise<Metrics> {
    const src = await resolveSource();
    return cached(`metrics:${src.kind}`, () => (src.kind === "api" ? getJSON(`${src.apiBase}/api/metrics`) : getJSON(s(src, "metrics.json"))));
  },

  async validation(): Promise<CohortValidation> {
    const src = await resolveSource();
    return cached(`validation:${src.kind}`, () =>
      src.kind === "api" ? getJSON(`${src.apiBase}/api/cohort/validation`) : getJSON(s(src, "validation.json")),
    );
  },

  /** Live what-if (API only). */
  async whatif(id: string, req: WhatIfRequest): Promise<WhatIfResponse> {
    const src = await resolveSource();
    if (src.kind !== "api") throw new ApiError("Custom scenarios need the live engine; offline mode offers precomputed presets only.", 503, "");
    return getJSON(`${src.apiBase}/api/patients/${enc(id)}/whatif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  },

  /** Precomputed presets (from the static export's index.json; in API mode the same requests are POSTed live). */
  async presets(id: string): Promise<WhatIfPreset[]> {
    const src = await resolveSource();
    const base = src.kind === "api" ? (STATIC_SETS.demo ? "/demo" : null) : src.staticBase;
    if (!base) return [];
    return cached(`presets:${src.kind}:${id}`, async () => {
      try {
        return normalizePresets(await getJSON(`${base}/whatif/${enc(id)}/index.json`));
      } catch {
        return [];
      }
    });
  },

  /** Result of a preset: static file offline, live POST of the preset's request when the engine is up. */
  async preset(id: string, preset: WhatIfPreset): Promise<WhatIfResponse> {
    const src = await resolveSource();
    if (src.kind === "api" && preset.request) return api.whatif(id, preset.request);
    const base = src.kind === "api" ? "/demo" : src.staticBase;
    return cached(`preset:${src.kind}:${id}:${preset.id}`, () => getJSON(`${base}/whatif/${enc(id)}/${enc(preset.id)}.json`));
  },
};
