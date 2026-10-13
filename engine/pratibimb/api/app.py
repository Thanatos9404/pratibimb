"""FastAPI application (prefix ``/api``) implementing the SPEC section 5 contract."""

from __future__ import annotations

import asyncio
import os

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .. import __version__
from ..config import STEP_MIN
from ..timeutil import iso, parse_iso
from .models import (
    Clock, CohortResponse, Forecast, FoodsResponse, Health, PatientDetail, Timeline, WhatIfRequest, WhatIfResponse,
)
from .service import foods, get_service


def _origins() -> list[str]:
    extra = [o.strip() for o in os.environ.get("PRATIBIMB_CORS_ORIGINS", "").split(",") if o.strip()]
    return ["http://localhost:3000", "http://127.0.0.1:3000", *extra]


app = FastAPI(title="Pratibimb API", version=__version__,
              description="Hybrid physiological + ML digital twin for Type 2 Diabetes (synthetic data; not a medical device).")
app.add_middleware(CORSMiddleware, allow_origins=_origins(), allow_credentials=False, allow_methods=["*"],
                   allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _svc():
    try:
        return get_service()
    except FileNotFoundError as exc:  # pragma: no cover - deployment misconfiguration
        raise HTTPException(503, f"engine data not built: {exc}") from exc


def _pid(svc, pid: str) -> str:
    if pid not in svc.split:
        raise HTTPException(404, f"unknown patient {pid}")
    return pid


def _time(svc, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(min(max(parse_iso(value), 0), svc.n_min - STEP_MIN))
    except ValueError as exc:
        raise HTTPException(422, f"invalid ISO time {value!r}") from exc


@app.get("/api/health", response_model=Health)
def health() -> dict:
    svc = get_service()
    return {"status": "ok", "version": __version__, "profile": svc.profile.name}


@app.get("/api/clock", response_model=Clock)
def clock() -> dict:
    return _svc().clock()


@app.get("/api/cohort", response_model=CohortResponse, response_model_exclude_none=False)
def cohort(now: str | None = None) -> dict:
    svc = _svc()
    return svc.cohort(_time(svc, now, svc.default_now))


@app.get("/api/cohort/validation")
def cohort_validation() -> JSONResponse:
    try:
        return JSONResponse(_svc().reports_json("cohort_validation.json"))
    except FileNotFoundError as exc:
        raise HTTPException(404, "cohort_validation.json not built") from exc


@app.get("/api/metrics")
def metrics() -> JSONResponse:
    try:
        return JSONResponse(_svc().reports_json("metrics.json"))
    except FileNotFoundError as exc:
        raise HTTPException(404, "metrics.json not built") from exc


@app.get("/api/foods", response_model=FoodsResponse)
def foods_route() -> dict:
    return foods()


@app.get("/api/patients/{pid}", response_model=PatientDetail)
def patient(pid: str, now: str | None = None) -> dict:
    svc = _svc()
    return svc.patient_detail(_pid(svc, pid), _time(svc, now, svc.default_now))


@app.get("/api/patients/{pid}/fhir")
def patient_fhir(pid: str) -> JSONResponse:
    svc = _svc()
    return JSONResponse(svc.fhir(_pid(svc, pid)), media_type="application/fhir+json")


@app.get("/api/patients/{pid}/timeline", response_model=Timeline, response_model_by_alias=True)
def timeline(pid: str, from_: str | None = Query(None, alias="from"), to: str | None = None,
             now: str | None = None) -> dict:
    svc = _svc()
    _pid(svc, pid)
    n = _time(svc, now, svc.default_now)
    t_to = _time(svc, to, n)
    t_from = _time(svc, from_, t_to - 1440)
    if t_from > t_to:
        raise HTTPException(422, "'from' must be before 'to'")
    if t_to - t_from > 14 * 1440:
        raise HTTPException(422, "timeline window limited to 14 days")
    return svc.timeline(pid, t_from, t_to, n)


@app.get("/api/patients/{pid}/forecast", response_model=Forecast)
def forecast(pid: str, at: str | None = None) -> dict:
    svc = _svc()
    _pid(svc, pid)
    t = _time(svc, at, svc.default_now)
    t = min(t, svc.n_min - 245)
    return svc.forecast(pid, t)


@app.post("/api/patients/{pid}/whatif", response_model=WhatIfResponse)
def whatif(pid: str, req: WhatIfRequest, now: str | None = None) -> dict:
    svc = _svc()
    _pid(svc, pid)
    n = _time(svc, now, svc.default_now)
    try:
        return svc.whatif(pid, req.model_dump(), n)
    except KeyError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.websocket("/api/stream/{pid}")
async def stream(ws: WebSocket, pid: str) -> None:
    await ws.accept()
    svc = get_service()
    if pid not in svc.split:
        await ws.send_json({"type": "error", "message": f"unknown patient {pid}"})
        await ws.close()
        return
    params = ws.query_params
    try:
        t = int(parse_iso(params["from"])) if "from" in params else svc.default_now
        speed = float(params.get("speed", 120))
    except ValueError:
        await ws.send_json({"type": "error", "message": "bad query parameters"})
        await ws.close()
        return
    speed = min(max(speed, 1.0), 3600.0)
    t = max(0, min(t - t % STEP_MIN, svc.n_min - STEP_MIN))
    pdat = svc.patient(pid)
    meals = sorted(pdat.record["logged"]["meals"], key=lambda m: m["t"])
    doses = sorted(pdat.record["logged"]["doses"], key=lambda d: d["t"])
    try:
        while t < svc.n_min - STEP_MIN:
            prev, t = t, t + STEP_MIN
            k = t // STEP_MIN
            for m in meals:
                if prev < m["t"] <= t:
                    tl = svc.timeline(pid, m["t"], m["t"], t, with_risk=False)
                    for meal in tl["meals"]:
                        await ws.send_json({"type": "meal", "meal": meal})
            for d in doses:
                if prev < d["t"] <= t:
                    tl = svc.timeline(pid, d["t"], d["t"], t, with_risk=False)
                    for dose in tl["doses"]:
                        await ws.send_json({"type": "dose", "dose": dose})
            for al in pdat.alerts:
                if prev < al["k"] * STEP_MIN <= t:
                    await ws.send_json({"type": "alert", "alert": svc._alert_view(al, t)})
            cg = pdat.cgm[k]
            hrv = pdat.hrv[k]
            hr = pdat.hr[k]
            await ws.send_json({
                "type": "tick", "t": iso(t), "cgm": None if cg != cg else float(cg),
                "hr": None if hr != hr else round(float(hr), 1), "steps": int(pdat.steps[k]),
                "hrv": None if hrv != hrv else round(float(hrv), 1),
                "twin": {"p10": round(float(pdat.q[k, 0]), 1), "p50": round(float(pdat.q[k, 1]), 1),
                         "p90": round(float(pdat.q[k, 2]), 1)},
                "risk": svc.risk_at(pid, t, provisional=False),
            })
            if t % 15 == 0 and t + 245 < svc.n_min:
                fc = await asyncio.to_thread(svc.forecast, pid, t)
                await ws.send_json({"type": "forecast", "forecast": fc})
            await asyncio.sleep(STEP_MIN * 60.0 / speed)
        await ws.send_json({"type": "end"})
        await ws.close()
    except WebSocketDisconnect:
        return
