"""API contract tests (FastAPI TestClient) for every endpoint in SPEC section 5."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pratibimb.api.models import (
    Clock, CohortResponse, Forecast, FoodsResponse, PatientDetail, Timeline, WhatIfResponse,
)


@pytest.fixture(scope="module")
def client(service):
    from pratibimb.api.app import app

    return TestClient(app)


@pytest.fixture(scope="module")
def pid(service):
    return service.ids[0]


def test_health_clock(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["version"]
    c = Clock.model_validate(client.get("/api/clock").json())
    assert c.start.endswith("+05:30") and c.now.endswith("+05:30") and c.start < c.now < c.end


def test_cohort(client, service):
    body = client.get("/api/cohort").json()
    co = CohortResponse.model_validate(body)
    assert len(co.patients) == len(service.ids)
    p = co.patients[0]
    assert len(p.sparkline_24h) == 96
    assert 0 <= p.risk.hyper_2h <= 1 and p.risk.level in ("low", "moderate", "high")
    assert 0 <= p.tir_7d <= 100


def test_patient_detail_and_fhir(client, pid):
    d = PatientDetail.model_validate(client.get(f"/api/patients/{pid}").json())
    assert {p.key for p in d.twin.params} == {"SI", "SG", "beta", "EGP", "meal_rate", "dawn"}
    assert all(p.p10 <= p.mean <= p.p90 or abs(p.p90 - p.p10) < 1e-9 for p in d.twin.params)
    assert d.labs and d.conditions and d.medications
    f = client.get(f"/api/patients/{pid}/fhir").json()
    assert f["resourceType"] == "Bundle"
    assert client.get("/api/patients/NOPE").status_code == 404


def test_timeline(client, pid, service):
    body = client.get(f"/api/patients/{pid}/timeline").json()
    assert "from" in body
    tl = Timeline.model_validate(body)
    assert len(tl.cgm) == 289 and len(tl.steps) == 289
    assert all(b.p10 <= b.p50 <= b.p90 for b in tl.twin)
    for a in tl.alerts:
        assert a.outcome in ("true_positive", "false_positive", "pending")
    r = client.get(f"/api/patients/{pid}/timeline", params={"from": "2026-09-22T00:00:00+05:30",
                                                            "to": "2026-09-22T06:00:00+05:30"})
    assert r.status_code == 200 and len(r.json()["cgm"]) == 73


def test_forecast(client, pid):
    f = Forecast.model_validate(client.get(f"/api/patients/{pid}/forecast").json())
    assert f.step_min == 5 and f.horizon_min == 240 and len(f.quantiles) == 49 and len(f.mechanistic_p50) == 49
    for q in f.quantiles:
        assert q.p05 <= q.p25 <= q.p50 <= q.p75 <= q.p95
    assert isinstance(f.state.sulfonylurea_active, bool)


def test_whatif(client, pid):
    req = {"scenario": {"meals": [{"offset_min": 30, "items": [{"food_id": "poha", "portions": 1}]}],
                        "walk": {"offset_min": 60, "duration_min": 15, "intensity": "light"}}}
    w = WhatIfResponse.model_validate(client.post(f"/api/patients/{pid}/whatif", json=req).json())
    assert len(w.baseline) == len(w.scenario) == 61
    assert set(w.metrics) == {"baseline", "scenario"} and w.narrative
    bad = client.post(f"/api/patients/{pid}/whatif", json={"scenario": {"meals": [
        {"offset_min": 0, "items": [{"food_id": "pizza", "portions": 1}]}]}})
    assert bad.status_code == 422


def test_static_resources(client):
    foods = FoodsResponse.model_validate(client.get("/api/foods").json())
    assert len(foods.foods) >= 60 and all(f.name_hi for f in foods.foods)
    m = client.get("/api/metrics").json()
    for key in ("generated_at", "dataset", "tasks", "ablation", "forecast", "top_features"):
        assert key in m
    assert {a["model"] for a in m["ablation"]} == {"cgm_linear", "ml_no_twin", "twin_only", "hybrid"}
    for t in ("hyper_2h", "hypo_1h", "nocturnal_hypo"):
        assert {"prevalence", "auroc", "auprc", "brier", "operating_point", "calibration",
                "lead_time_hist"} <= set(m["tasks"][t])
    assert client.get("/api/cohort/validation").status_code == 200


def test_stream(client, pid):
    with client.websocket_connect(f"/api/stream/{pid}?speed=100000") as ws:
        msgs = [ws.receive_json() for _ in range(6)]
    types = {m["type"] for m in msgs}
    assert "tick" in types
    tick = next(m for m in msgs if m["type"] == "tick")
    assert {"t", "cgm", "hr", "steps", "hrv", "twin", "risk"} <= set(tick)
