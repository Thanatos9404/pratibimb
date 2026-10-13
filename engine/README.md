# Pratibimb engine (`pratibimb`)

Python package behind Pratibimb (प्रतिबिम्ब): a hybrid physiological + machine-learning digital twin for
Type 2 Diabetes, built on **synthetic** data only. Not a medical device.

```
pratibimb/
  physiology/   twin ODE (extended Bergman minimal model), drug kinetics, numba ensemble kernels
  cohort/       truth simulator (richer than the twin), archetypes, Indian lifestyle generator,
                wearables, CGM sensor model, synthetic EHR, FHIR R4 export
  foods/        Indian food table (73 items, Hindi names, GI/GL, honest source column)
  twin/         EHR -> priors (TyG, ADAG), EnKF sync, ensemble forecasts with a habitual-meal prior,
                what-if simulation, inferred subtype
  ml/           causal features, truth labels, LightGBM + isotonic calibration, TreeSHAP drivers,
                alert hysteresis, ablation, Parkes error grid, evaluation
  reports/      cohort validation + slide-ready figures
  api/          FastAPI app (SPEC section 5 contract), WebSocket replay
  export.py     static demo export for the web app
  cli.py        `pratibimb generate|assimilate|train|evaluate|export-demo|serve|build`
```

## Setup

```bash
cd engine
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe -e ".[dev]"      # Windows
# uv pip install --python .venv/bin/python -e ".[dev]"            # Linux / macOS
```

Dependencies: numpy, scipy, pandas, pyarrow, numba, scikit-learn, lightgbm, fastapi, uvicorn, pydantic,
matplotlib (tests: pytest, httpx).

## Commands

All commands take `--profile full|small|tiny` (default `full`) and `--workers N` (capped at 6).

```bash
pratibimb build --profile full                      # generate + assimilate + train + evaluate (+ figures)
pratibimb export-demo --profile full --out ../web/public/demo
pratibimb serve --profile full --port 8000         # http://localhost:8000/docs

# individual stages
pratibimb generate     # synthetic cohort -> data/<profile>/cohort
pratibimb assimilate   # EnKF sync + per-decision-point twin forecasts -> data/<profile>/twin
pratibimb train        # decision-point datasets + LightGBM/calibration/thresholds -> data/<profile>/ml
pratibimb evaluate     # metrics.json, alert ledger, cohort_validation.json, figures
```

(`python -m pratibimb ...` works too.) Seeds are fixed, so every stage is deterministic.

| profile | patients x days | ensemble | reports written to |
|---|---|---|---|
| `full`  | 240 x 28 | 64 | `<repo>/reports` |
| `small` | 40 x 14  | 64 | `data/small/reports` |
| `tiny`  | 8 x 6    | 32 | `data/tiny/reports` (CI / tests) |

Data lands in `<repo>/data/<profile>` (override with `PRATIBIMB_DATA`).

## Timings (this machine: 12-core Windows laptop, 6 worker processes)

Full profile (240 x 28 d): generate 32 s, assimilate ~20 min, train 6.5 min, evaluate 4.2 min,
export-demo 75 s — about 33 min end to end. `pratibimb build` also writes `data/<profile>/timings.json`.

## Tests

```bash
.venv/Scripts/python -m pytest          # builds the tiny profile in a temp dir (~2-4 min first run)
```

Covers ODE sanity (steady state, glucose and gut mass balance, meal-response shape), EnKF convergence on
a twin-generated patient and tracking of a truth patient, feature leakage (features and twin features at
`t` unchanged when data after `t` is perturbed), label correctness on crafted series, FHIR bundle
structure, every API endpoint incl. the WebSocket, what-if monotonicity, and the Parkes grid.

## Docker

```bash
docker build -f engine/Dockerfile -t pratibimb-api --build-arg PROFILE=small .   # from the repo root
docker run -p 8000:8000 pratibimb-api
docker compose up --build                                                          # api + web
```

The image builds the (deterministic) `small` profile at build time; `/api/metrics` and
`/api/cohort/validation` serve the full-run reports copied from `reports/` when present.

See `docs/MODEL_CARD.md`, `docs/DATA_CARD.md` and `docs/API.md` for the science, data and contract.
