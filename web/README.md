# Pratibimb — web

Landing page and clinician console for **Pratibimb (प्रतिबिम्ब)**, a hybrid physiological + ML digital twin for Type 2 Diabetes. Next.js 15 (App Router, TypeScript strict), Tailwind CSS v4, shadcn/ui (Radix), Motion, Lenis, d3-scale/d3-shape charts drawn by hand in SVG. All patients are synthetic; not a medical device.

## Run

```bash
npm i
npm run dev            # http://localhost:3000
npm run build && npm start
```

Copy `.env.example` to `.env.local` to change the data source:

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `demo` | `demo` = engine's static export in `public/demo` (falls back to `public/mock`); `api` = live engine, falling back to demo, then mock; `mock` = dev fixtures |
| `NEXT_PUBLIC_API_BASE` | — | e.g. `http://localhost:8000` (only for `api`; the engine must allow the origin via `PRATIBIMB_CORS_ORIGINS`) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical URL for Open Graph |
| `NEXT_PUBLIC_REPO_URL` | — | GitHub link in the footer (hidden when empty) |

Which static sets exist (`public/demo`, `public/mock`, FHIR files, hourly forecasts) is detected when `next dev`/`next build` starts (see `next.config.ts`), so the browser never probes for missing files. **Restart the dev server after re-exporting the engine data.**

### Data source behaviour

- The badge in the console sidebar says where data comes from: *Live engine*, *Offline demo data* or *Mock fixtures* (mock pages also show a red “Mock” stamp — those numbers are placeholders, never results).
- **Live mode**: with the API, “Go live” opens the WebSocket replay (`/api/stream/{id}`, 60×/120×/300×). Offline, the same control replays the export's recorded future (now → now+3 d) in the browser, using the hourly `forecasts/{id}.json`, the 15-min `risk` series and `alerts[].resolves_at/outcome_final` to reveal outcomes only when their windows close.
- **What-If Lab**: presets come from `whatif/{id}/index.json` (per-patient names such as `skip-glimepiride`). With the API the same preset requests are POSTed live and the custom builder (Indian food picker, walk, dose skip/shift, sleep) is enabled; offline only presets run.
- **Landing page** is statically generated from `public/demo` at build time (fallback `public/mock`).

## Pages

`/` landing · `/console` cohort triage · `/console/patient/[id]` virtual patient (glucose + twin + forecast cone, risk + TreeSHAP drivers, alert feed, inside-the-twin physiology + compartment schematic, wearables, AGP + TIR, care plan, EHR/FHIR sheet, What-If Lab, live replay) · `/console/model` model card (all numbers from `metrics.json` / `validation.json`; missing values render as “—”) · `/about`.

## Code map

```
src/app/                    routes, OG image, icons
src/components/landing/     hero (sky photo + WebGL grain + floating console), sections
src/components/console/     shell, cohort, patient/*, model/*
src/components/charts/      hand-built SVG charts (glucose, AGP, TIR, wearables, what-if, model card)
src/lib/api/                types.ts (SPEC §5 + documented optional extras), client.ts, source.ts, hooks.ts
src/lib/live/use-live.ts    WebSocket / offline replay
src/lib/server/             build-time loader for the landing page
src/mocks/                  dev fixture generator (`npm run mocks` → public/mock)
scripts/                    Playwright screenshots, overflow check, smoke test
```

## Checks

```bash
npm run lint
npx tsc --noEmit
node scripts/screenshots.mjs http://localhost:3000     # → screenshots/ (gitignored)
node scripts/check-overflow.mjs http://localhost:3000 360
node scripts/smoke.mjs http://localhost:3000
```

Requires `npx playwright install chromium` once.

## Deploy

- **Vercel**: import the `web/` directory; `vercel.json` is included. No secrets needed.
- **Docker**: `docker build -t pratibimb-web . && docker run -p 3000:3000 pratibimb-web` (standalone output). Pass `--build-arg NEXT_PUBLIC_DATA_SOURCE=api --build-arg NEXT_PUBLIC_API_BASE=…` for a live engine.

## Credits

Font: Open Runde (SIL OFL 1.1, `public/fonts/OpenRunde-OFL.txt`). Photos: Unsplash licence, see `public/photos/CREDITS.md`. Code: Apache-2.0. Team Stack Underflow — Yashvardhan Thanvi (solo entry) — BIT Mesra (Off Campus Jaipur).
