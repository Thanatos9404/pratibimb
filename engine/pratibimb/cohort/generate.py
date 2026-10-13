"""Cohort generation orchestrator: sample -> lifestyle -> truth -> sensors -> EHR -> FHIR -> disk.

Per-patient outputs (``data/<profile>/cohort``):

* ``patients/<id>.json`` - public record (demographics, EHR, *logged* meals/doses) plus a ``truth``
  section (archetype, hidden parameters, true meals/doses, illness, ...) that only the evaluation
  and reporting code may read;
* ``patients/<id>.npz`` - 5-minute series: ``cgm, hr, hrv, steps, stage`` (observable) and
  ``g, gi, stage_true, si_true`` (truth);
* ``fhir/<id>.json`` - FHIR R4 collection Bundle;
* ``manifest.json`` - profile, clock, patient list with archetype and patient-level split.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from ..config import DATASET_START, STEP_MIN, Paths, Profile
from ..foods import get_food, summarize_meal
from .ehr import build_ehr
from .fhir import build_bundle
from .lifestyle import Lifestyle, generate_lifestyle
from .patient import PatientSpec, sample_patient
from .sensor import CGMResult, simulate_cgm
from .truth import TruthResult, simulate_with_titration
from .wearables import WearableStreams, simulate_wearables

MAX_WORKERS = 6


def _meal_dict(t: int, slot: str, items: list[tuple[str, float]]) -> dict:
    s = summarize_meal(items)
    return {
        "t": int(t), "slot": slot, "carbs_g": round(s.carbs_g, 1), "gl": round(s.gl, 1), "gi": round(s.gi, 1),
        "fat_g": round(s.fat_g, 1), "protein_g": round(s.protein_g, 1), "fiber_g": round(s.fiber_g, 1),
        "tau_min": round(s.tau_min, 1),
        "items": [{"food_id": f, "name": get_food(f).name, "portions": round(p, 2),
                   "carbs_g": round(get_food(f).carbs_g * p, 1)} for f, p in items],
    }


def _wearable_summary(days: int, cgm: np.ndarray, wear: WearableStreams) -> dict:
    asleep = wear.stage > 0
    rest = (~asleep) & (wear.steps < 50) & ~np.isnan(wear.hr)
    night_hrv = wear.hrv[asleep & ~np.isnan(wear.hrv)]
    c = cgm[~np.isnan(cgm)]
    return {
        "days": days,
        "resting_hr": round(float(np.nanmedian(wear.hr[rest])), 1) if rest.any() else None,
        "steps_per_day": round(float(wear.steps.sum()) / days),
        "sleep_hours": round(float(asleep.sum()) * STEP_MIN / 60.0 / days, 2),
        "rmssd_night": round(float(np.mean(night_hrv)), 1) if night_hrv.size else None,
        "cgm_mean": round(float(c.mean()), 1),
        "cgm_tir": round(100.0 * float(np.mean((c >= 70) & (c <= 180))), 1),
    }


def build_record(spec: PatientSpec, life: Lifestyle, truth: TruthResult, cgm: CGMResult, ehr: dict) -> dict:
    logged_meals = [_meal_dict(m.t_log, m.slot, m.items_log) for m in life.meals if m.logged]
    logged_doses = [{"t": int(d.t if d.taken and d.logged_taken else d.t_sched), "t_sched": int(d.t_sched),
                     "drug": d.drug, "dose_amount": d.dose, "taken": bool(d.logged_taken)} for d in life.doses]
    truth_meals = [dict(_meal_dict(m.t, m.slot, m.items), logged=bool(m.logged)) for m in life.meals]
    truth_doses = [{"t": int(d.t), "t_sched": int(d.t_sched), "drug": d.drug, "dose_amount": d.dose,
                    "taken": bool(d.taken), "logged_taken": bool(d.logged_taken)} for d in life.doses]
    hb = spec.habits
    return {
        "id": spec.pid, "display_name": spec.display_name, "given": spec.given, "family": spec.family,
        "abha": spec.abha, "age": spec.age, "sex": spec.sex, "height_cm": spec.height_cm,
        "weight_kg": spec.weight_kg, "waist_cm": spec.waist_cm, "bmi": spec.bmi, "region": hb.region,
        "diet": "vegetarian" if hb.vegetarian else "non-vegetarian",
        "occupation": "office job" if hb.office else ("retired / home" if spec.age >= 58 else "home / self-employed"),
        "diabetes_years": spec.diabetes_years,
        "labs": ehr["labs"], "ehr": ehr["summary"], "conditions": ehr["conditions"],
        "medications": ehr["medications"], "genetics": ehr["genetics"],
        "logged": {"meals": logged_meals, "doses": logged_doses},
        "truth": {
            "archetype": spec.archetype,
            "params": asdict(spec.truth),
            "habits": asdict(hb),
            "hba1c_latent": ehr["hba1c_latent"],
            "meals": truth_meals,
            "doses": truth_doses,
            "walks": life.walks,
            "illness": list(hb.illness) if hb.illness else None,
            "fasting_days": life.fasting_days,
            "festival_days": life.festival_days,
            "short_nights": life.short_nights,
            "sleeps": [list(s) for s in life.sleeps],
            "titration": spec.extras.get("titration", []),
            "sensor_sessions": cgm.sessions,
            "compressions": [list(c) for c in cgm.compressions],
        },
    }


def generate_patient(idx: int, seed: int, days: int, out: Paths) -> dict:
    """Generate one patient and write it to disk; returns a small summary row."""
    spec = sample_patient(idx, seed, days)
    life = generate_lifestyle(spec, days)
    truth = simulate_with_titration(spec, life)
    wear = simulate_wearables(spec, life, truth)
    cgm = simulate_cgm(truth.gi, life, spec.seed)
    ehr = build_ehr(spec, truth)
    record = build_record(spec, life, truth, cgm, ehr)
    with (out.patients / f"{spec.pid}.json").open("w", encoding="utf-8") as fh:
        json.dump(record, fh, ensure_ascii=False, separators=(",", ":"))
    si5 = truth.drivers.si[::STEP_MIN].astype(np.float32)
    np.savez_compressed(
        out.patients / f"{spec.pid}.npz",
        cgm=cgm.cgm, hr=wear.hr, hrv=wear.hrv, steps=wear.steps.astype(np.int16), stage=wear.stage,
        g=truth.g[::STEP_MIN].astype(np.float32), gi=truth.gi[::STEP_MIN].astype(np.float32),
        stage_true=life.stage_true.reshape(-1, STEP_MIN).max(axis=1).astype(np.int8), si_true=si5,
    )
    bundle = build_bundle(record, _wearable_summary(days, cgm.cgm, wear))
    with (out.fhir / f"{spec.pid}.json").open("w", encoding="utf-8") as fh:
        json.dump(bundle, fh, ensure_ascii=False, separators=(",", ":"))
    return {"id": spec.pid, "archetype": spec.archetype}


def _worker(args: tuple[int, int, int, str, str]) -> dict:
    idx, seed, days, root, reports = args
    return generate_patient(idx, seed, days, Paths(root=Path(root), reports=Path(reports)))


def assign_splits(rows: list[dict], seed: int) -> dict[str, str]:
    """Patient-level 70/15/15 split stratified by (hidden) archetype."""
    rng = np.random.default_rng([seed, 99])
    split: dict[str, str] = {}
    for arch in sorted({r["archetype"] for r in rows}):
        ids = sorted(r["id"] for r in rows if r["archetype"] == arch)
        rng.shuffle(ids)
        n = len(ids)
        n_val = max(1, int(round(0.15 * n)))
        n_test = max(1, int(round(0.15 * n)))
        for i, pid in enumerate(ids):
            split[pid] = "val" if i < n_val else ("test" if i < n_val + n_test else "train")
    return split


def generate_cohort(profile: Profile, paths: Paths, workers: int = MAX_WORKERS, log=print) -> dict:
    paths.ensure()
    t0 = time.time()
    args = [(i, profile.seed, profile.days, str(paths.root), str(paths.reports)) for i in range(profile.n_patients)]
    workers = max(1, min(workers, MAX_WORKERS))
    if workers == 1:
        rows = [_worker(a) for a in args]
    else:
        with Pool(workers) as pool:
            rows = list(pool.imap_unordered(_worker, args, chunksize=2))
    rows.sort(key=lambda r: r["id"])
    split = assign_splits(rows, profile.seed)
    manifest = {
        "profile": profile.name, "start": DATASET_START.isoformat(), "days": profile.days,
        "n_patients": profile.n_patients, "now_minute": profile.now_minute, "ensemble_size": profile.ensemble_size,
        "seed": profile.seed,
        "patients": [{"id": r["id"], "archetype": r["archetype"], "split": split[r["id"]]} for r in rows],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with (paths.cohort / "manifest.json").open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    log(f"generated {len(rows)} patients x {profile.days} d in {time.time() - t0:.1f}s")
    return manifest
