"""Business logic behind the API and the static demo export (returns plain JSON-able dicts).

All times inside are minutes since the dataset start; responses use ISO-8601 strings with +05:30.
"""

from __future__ import annotations

import json
import math
import os
from collections import OrderedDict
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import numpy as np
import pandas as pd

from .. import __version__
from ..jsonutil import clean
from ..config import (
    PROFILES, SAMPLES_PER_DAY, STEP_MIN, Paths, Profile, data_root, get_profile, paths_for,
)
from ..foods import foods_as_dicts, get_food, summarize_meal
from ..ml.explain import drivers_from_contrib
from ..ml.features import compute_features, window_slope
from ..ml.labels import episodes
from ..observables import Observed, load_observed
from ..physiology.drugs import DRUGS
from ..physiology.params import NX, P_SI, PARAM_KEYS, S_D1, S_D2, S_G, S_X, to_natural
from ..timeutil import iso, parse_iso
from ..twin.assimilate import NOCT_FEATURES, TWIN_FEATURES, patient_seed
from ..twin.enkf import TwinRun
from ..twin.forecast import HabitPrior, ensemble_forecast, forecast_seed, mechanistic_run, run_exceed

STAGES = {0: "wake", 1: "light", 2: "deep", 3: "rem"}
PARAM_DISPLAY = {
    # key: (label, unit, display scale)
    "SI": ("Insulin sensitivity", "x10^-4 /min per uU/mL", 1e4),
    "SG": ("Glucose effectiveness", "x10^-2 /min", 1e2),
    "beta": ("Beta-cell responsiveness", "x10^-2 uU/mL/min per mg/dL", 1e2),
    "EGP": ("Basal liver glucose output", "mg/kg/min (model units)", 1.0),
    "meal_rate": ("Meal absorption speed", "x typical", 1.0),
    "dawn": ("Dawn phenomenon", "% EGP rise at ~06:00", 100.0),
}
WALK_INTENSITY = {"light": 0.5, "brisk": 1.0}
DEFAULT_DINNER = [("white_rice", 1.5), ("toor_dal", 1.0), ("mixed_veg", 1.0)]
RICE_LIKE = {"white_rice", "jeera_rice", "lemon_rice", "curd_rice", "veg_biryani", "chicken_biryani", "khichdi",
             "ven_pongal", "brown_rice"}
WHEAT_FLATBREAD = {"chapati", "plain_paratha", "aloo_paratha", "naan", "puri"}


def _r(x: float | None, nd: int = 1) -> float | None:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), nd)


@dataclass
class PatientData:
    pid: str
    split: str
    record: dict
    cgm: np.ndarray
    hr: np.ndarray
    hrv: np.ndarray
    steps: np.ndarray
    stage: np.ndarray
    q: np.ndarray
    prior: np.ndarray
    pmean: np.ndarray
    snaps: np.ndarray
    rej: np.ndarray
    dp_k: np.ndarray
    dp_feat: np.ndarray
    noct_k: np.ndarray
    noct_feat: np.ndarray
    pred_k: np.ndarray
    p_hyper: np.ndarray
    p_hypo: np.ndarray
    noct_pred: dict[int, float]
    alerts: list[dict]
    cache: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return self.cgm.shape[0]


class TwinService:
    def __init__(self, profile: str | None = None, root: Path | None = None, reports: Path | None = None,
                 max_runs: int = 12) -> None:
        name = profile or os.environ.get("PRATIBIMB_PROFILE")
        if name is None:
            name = next((p for p in ("full", "small", "tiny") if (data_root() / p / "cohort" / "manifest.json").exists()),
                        "full")
        self.profile: Profile = get_profile(name)
        self.paths: Paths = paths_for(self.profile, reports=reports)
        if root is not None:
            self.paths = Paths(root=root, reports=reports or self.paths.reports)
        with (self.paths.cohort / "manifest.json").open(encoding="utf-8") as fh:
            self.manifest = json.load(fh)
        self.split = {p["id"]: p["split"] for p in self.manifest["patients"]}
        self.ids = [p["id"] for p in self.manifest["patients"]]
        self.days = int(self.manifest["days"])
        self.n_min = self.days * 1440
        self.default_now = int(self.manifest["now_minute"])
        self._patients: OrderedDict[str, PatientData] = OrderedDict()
        self._runs: OrderedDict[str, TwinRun] = OrderedDict()
        self._max_runs = max_runs
        self._boosters: dict = {}

    # ---- static resources ----------------------------------------------------------------------
    @cached_property
    def meta(self) -> dict:
        with (self.paths.models / "meta.json").open(encoding="utf-8") as fh:
            return json.load(fh)

    @cached_property
    def thresholds(self) -> dict[str, float]:
        return {t: float(v["operating_point"]["threshold"]) for t, v in self.meta["tasks"].items()}

    @cached_property
    def subtypes(self) -> dict[str, str]:
        p = self.paths.twin / "subtypes.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    @cached_property
    def twin_summary(self) -> dict:
        return json.loads((self.paths.twin / "summary.json").read_text(encoding="utf-8"))

    @cached_property
    def population_medians(self) -> dict[str, float]:
        vals: dict[str, list[float]] = {k: [] for k in PARAM_KEYS}
        for r in self.twin_summary["patients"]:
            for k in PARAM_KEYS:
                vals[k].append(r["params_now"][k][0])
        return {k: float(np.median(v)) * PARAM_DISPLAY[k][2] for k, v in vals.items()}

    @cached_property
    def fc_scale(self) -> tuple[np.ndarray, np.ndarray]:
        p = self.paths.models / "forecast_calibration.json"
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            return np.array([0.0, *d["horizons_min"], 240.0]), np.array([1.0, *d["scale"], d["scale"][-1]])
        return np.array([0.0, 240.0]), np.array([1.0, 1.0])

    @cached_property
    def _predictions(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        return (pd.read_parquet(self.paths.ml / "predictions_dp.parquet"),
                pd.read_parquet(self.paths.ml / "predictions_noct.parquet"))

    def booster(self, task: str):
        if task not in self._boosters:
            import lightgbm as lgb

            self._boosters[task] = lgb.Booster(model_file=str(self.paths.models / f"{task}__hybrid.txt"))
        return self._boosters[task]

    def reports_json(self, name: str) -> dict:
        """Headline reports: ``$PRATIBIMB_METRICS_DIR`` (e.g. a full run copied into a container) wins,
        then this profile's reports directory, then ``<repo>/reports``."""
        bases = [Path(os.environ["PRATIBIMB_METRICS_DIR"])] if os.environ.get("PRATIBIMB_METRICS_DIR") else []
        for base in (*bases, self.paths.reports, Path(__file__).resolve().parents[3] / "reports"):
            p = base / name
            if p.exists():
                return clean(json.loads(p.read_text(encoding="utf-8")))
        raise FileNotFoundError(name)

    # ---- per-patient data ------------------------------------------------------------------------
    def patient(self, pid: str) -> PatientData:
        if pid in self._patients:
            self._patients.move_to_end(pid)
            return self._patients[pid]
        if pid not in self.split:
            raise KeyError(pid)
        with (self.paths.patients / f"{pid}.json").open(encoding="utf-8") as fh:
            rec = json.load(fh)
        rec.pop("truth", None)
        z = np.load(self.paths.patients / f"{pid}.npz")
        tw = np.load(self.paths.twin / f"{pid}.npz")
        pdp, pn = self._predictions
        sel = pdp[pdp.pid == pid]
        seln = pn[pn.pid == pid]
        ap = self.paths.ml / "alerts" / f"{pid}.json"
        alerts = json.loads(ap.read_text(encoding="utf-8")) if ap.exists() else []
        pdata = PatientData(
            pid=pid, split=self.split[pid], record=rec, cgm=z["cgm"].astype(float), hr=z["hr"].astype(float),
            hrv=z["hrv"].astype(float), steps=z["steps"].astype(float), stage=z["stage"].astype(int),
            q=tw["q"].astype(float), prior=tw["prior"].astype(float), pmean=tw["pmean"].astype(float),
            snaps=tw["snaps"], rej=tw["rej"], dp_k=tw["dp_k"].astype(int), dp_feat=tw["dp_feat"],
            noct_k=tw["noct_k"].astype(int), noct_feat=tw["noct_feat"],
            pred_k=sel["k"].to_numpy().astype(int), p_hyper=sel["hyper_2h__hybrid"].to_numpy(),
            p_hypo=sel["hypo_1h__hybrid"].to_numpy(),
            noct_pred={int(k): float(p) for k, p in zip(seln["k"], seln["nocturnal_hypo__hybrid"], strict=True)},
            alerts=alerts,
        )
        self._patients[pid] = pdata
        if len(self._patients) > 64:
            self._patients.popitem(last=False)
        return pdata

    def observed(self, pid: str) -> Observed:
        return self.run(pid).obs

    def run(self, pid: str) -> TwinRun:
        if pid in self._runs:
            self._runs.move_to_end(pid)
            return self._runs[pid]
        obs = load_observed(self.paths, pid)
        r = TwinRun(obs, self.profile.ensemble_size, patient_seed(self.profile.seed, pid))
        self._runs[pid] = r
        if len(self._runs) > self._max_runs:
            self._runs.popitem(last=False)
        return r

    def ensemble(self, pid: str, k: int) -> np.ndarray:
        pdat = self.patient(pid)
        key = ("ens", k)
        if key not in pdat.cache:
            pdat.cache[key] = self.run(pid).ensemble_at(k, pdat.snaps, pdat.rej)
            if len(pdat.cache) > 64:
                pdat.cache.pop(next(iter(pdat.cache)))
        return pdat.cache[key]

    # ---- time helpers ----------------------------------------------------------------------------
    def resolve_now(self, now: str | None) -> int:
        if now is None:
            return self.default_now
        return int(np.clip(parse_iso(now), 0, self.n_min - STEP_MIN))

    def clock(self) -> dict:
        return {"start": iso(0), "end": iso(self.n_min), "now": iso(self.default_now)}

    # ---- risk ------------------------------------------------------------------------------------
    def _dp_index(self, pdat: PatientData, k: int) -> int | None:
        i = int(np.searchsorted(pdat.pred_k, k, side="right")) - 1
        return i if i >= 0 else None

    def _night_decision(self, pdat: PatientData, k: int) -> int | None:
        """Bedtime decision covering sample k (from decision until 06:00 next morning)."""
        for kd in pdat.noct_pred:
            end = (kd // SAMPLES_PER_DAY + 1) * SAMPLES_PER_DAY + 72
            if kd <= k < end:
                return kd
        return None

    def provisional_nocturnal(self, pid: str, k: int) -> float:
        pdat = self.patient(pid)
        key = ("noct_prov", k)
        if key in pdat.cache:
            return pdat.cache[key]
        run = self.run(pid)
        z = self.ensemble(pid, k)
        t = k * STEP_MIN
        midnight = (t // 1440 + 1) * 1440
        n_min = int(midnight + 360 - t)
        traj = ensemble_forecast(run, z, k, n_min, HabitPrior(run), forecast_seed(run, k, salt=5))
        c0 = int((midnight - t) // STEP_MIN)
        raw = float(run_exceed(traj[:, c0:], 70.0, False).mean())
        cal = self.meta["tasks"]["nocturnal_hypo"]["twin_only"]["calibrator"]
        p = float(np.interp(raw, cal["x"], cal["y"]))
        pdat.cache[key] = p
        return p

    def _level(self, hyper: float, hypo: float, noct: float | None) -> str:
        r = [hyper / self.thresholds["hyper_2h"], hypo / self.thresholds["hypo_1h"]]
        if noct is not None:
            r.append(noct / self.thresholds["nocturnal_hypo"])
        m = max(r)
        return "high" if m >= 1.0 else ("moderate" if m >= 0.5 else "low")

    def risk_at(self, pid: str, t_min: int, provisional: bool = True) -> dict:
        pdat = self.patient(pid)
        k = t_min // STEP_MIN
        i = self._dp_index(pdat, k)
        hyper = float(pdat.p_hyper[i]) if i is not None else 0.0
        hypo = float(pdat.p_hypo[i]) if i is not None else 0.0
        noct, src = None, None
        kd = self._night_decision(pdat, k)
        if kd is not None:
            noct, src = pdat.noct_pred[kd], "bedtime_model"
        elif provisional and 17 * 60 <= (t_min % 1440) < 24 * 60 and t_min + 360 + 240 < self.n_min:
            noct, src = self.provisional_nocturnal(pid, k), "twin_provisional"
        out = {"hyper_2h": round(hyper, 4), "hypo_1h": round(hypo, 4),
               "nocturnal_hypo": None if noct is None else round(noct, 4), "level": self._level(hyper, hypo, noct),
               "nocturnal_source": src, "decision_t": iso(int(pdat.pred_k[i]) * STEP_MIN) if i is not None else None}
        return out

    # ---- cohort ----------------------------------------------------------------------------------
    def _alert_view(self, a: dict, now: int) -> dict:
        t = a["k"] * STEP_MIN
        resolves = a["resolves_k"] * STEP_MIN
        pending = resolves > now
        return {"id": a["id"], "t": iso(t), "kind": a["kind"], "probability": a["probability"],
                "threshold": a["threshold"], "outcome": "pending" if pending else a["outcome_final"],
                "lead_min": None if pending else a["lead_min_final"], "drivers": a["drivers"],
                "recommendation": a["recommendation"], "resolves_at": iso(resolves), "outcome_final": a["outcome_final"],
                "lead_min_final": a["lead_min_final"]}

    def cohort_patient(self, pid: str, now: int) -> dict:
        pdat = self.patient(pid)
        rec = pdat.record
        k = now // STEP_MIN
        a = max(0, k + 1 - 7 * SAMPLES_PER_DAY)
        c7 = pdat.cgm[a:k + 1]
        v = c7[~np.isnan(c7)]
        mean7 = float(v.mean()) if v.size else float("nan")
        spark_src = pdat.cgm[max(0, k + 1 - SAMPLES_PER_DAY):k + 1]
        spark_src = np.concatenate([np.full(SAMPLES_PER_DAY - spark_src.shape[0], np.nan), spark_src])
        blocks = spark_src.reshape(96, 3)
        spark = [None if np.all(np.isnan(b)) else round(float(np.nanmean(b)), 1) for b in blocks]
        recent = pdat.cgm[max(0, k - 5):k + 1]
        last = next((float(x) for x in recent[::-1] if not np.isnan(x)), None)
        slope = float(window_slope(pdat.cgm, np.array([k]), 3)[0])
        trend = ("flat" if math.isnan(slope) else "rising_fast" if slope > 2 else "rising" if slope > 1
                 else "falling_fast" if slope < -2 else "falling" if slope < -1 else "flat")
        open_alerts = sum(1 for al in pdat.alerts if al["k"] * STEP_MIN <= now < al["resolves_k"] * STEP_MIN)
        return {
            "id": pid, "display_name": rec["display_name"], "abha": rec["abha"], "age": int(rec["age"]),
            "sex": rec["sex"], "inferred_subtype": self.subtypes.get(pid, "IROD"), "bmi": rec["bmi"],
            "hba1c": rec["ehr"]["hba1c"], "meds": [m["label"] for m in rec["medications"]],
            "risk": self.risk_at(pid, now), "open_alerts": open_alerts, "last_glucose": last, "trend": trend,
            "tir_7d": _r(100 * np.mean((v >= 70) & (v <= 180))) if v.size else 0.0,
            "tar_7d": _r(100 * np.mean(v > 180)) if v.size else 0.0,
            "tbr_7d": _r(100 * np.mean(v < 70)) if v.size else 0.0,
            "mean_glucose_7d": _r(mean7) or 0.0, "cv_7d": _r(100 * v.std() / mean7) if v.size else 0.0,
            "gmi_7d": _r(3.31 + 0.02392 * mean7, 2) if v.size else 0.0,
            "sparkline_24h": spark, "split": pdat.split,
        }

    def cohort(self, now: int, ids: list[str] | None = None) -> dict:
        cache = self.paths.ml / "cohort_now.json"
        if ids is None and now == self.default_now and cache.exists():
            return json.loads(cache.read_text(encoding="utf-8"))
        return {"now": iso(now), "patients": [self.cohort_patient(p, now) for p in (ids or self.ids)]}

    def precompute_cohort(self) -> dict:
        """Cache the cohort view at the default demo clock (it needs one twin forecast per patient)."""
        out = {"now": iso(self.default_now), "patients": [self.cohort_patient(p, self.default_now) for p in self.ids]}
        (self.paths.ml / "cohort_now.json").write_text(json.dumps(clean(out), separators=(",", ":")), encoding="utf-8")
        for pid in list(self._patients):
            self._patients[pid].cache.clear()
        return out

    # ---- patient detail --------------------------------------------------------------------------
    def patient_detail(self, pid: str, now: int) -> dict:
        pdat = self.patient(pid)
        rec = pdat.record
        base = self.cohort_patient(pid, now)
        k = now // STEP_MIN
        z = self.ensemble(pid, k)
        params = []
        for i, key in enumerate(PARAM_KEYS):
            label, unit, scale = PARAM_DISPLAY[key]
            vals = np.asarray(to_natural(key, z[:, NX + i]), dtype=float)
            if key == "meal_rate":
                vals = 1.0 / vals
            vals = vals * scale
            idx = [kk for kk in range(k - 7 * SAMPLES_PER_DAY + 72, k + 1, 72) if kk >= 0]
            tr = np.asarray(to_natural(key, pdat.pmean[idx, i]), dtype=float)
            tr = (1.0 / tr if key == "meal_rate" else tr) * scale
            params.append({"key": key, "label": label, "unit": unit, "mean": round(float(vals.mean()), 4),
                           "p10": round(float(np.quantile(vals, 0.1)), 4), "p90": round(float(np.quantile(vals, 0.9)), 4),
                           "population_median": round(self.population_medians[key], 4),
                           "trend_7d": [round(float(x), 4) for x in tr if not math.isnan(x)]})
        a = max(1, k + 1 - SAMPLES_PER_DAY)
        c = pdat.cgm[a:k + 1]
        pm, ps = pdat.prior[a:k + 1, 0], pdat.prior[a:k + 1, 1]
        ok = ~np.isnan(c) & ~np.isnan(pm)
        mard = float(np.mean(np.abs(c[ok] - pm[ok]) / c[ok])) * 100 if ok.any() else float("nan")
        cov = float(np.mean(np.abs(c[ok] - pm[ok]) <= 1.2816 * ps[ok])) if ok.any() else float("nan")
        last_obs = int(np.max(np.flatnonzero(~np.isnan(pdat.cgm[:k + 1])), initial=0))
        detail = dict(base)
        detail.update({
            "height_cm": rec["height_cm"], "weight_kg": rec["weight_kg"], "waist_cm": rec["waist_cm"],
            "diabetes_years": rec["diabetes_years"], "region": rec["region"], "labs": rec["labs"],
            "conditions": rec["conditions"],
            "medications": [{"name": m["name"], "drug_class": m["drug_class"], "dose": m["dose"], "times": m["times"],
                             "drug": m["drug"]} for m in rec["medications"]],
            "genetics": rec["genetics"],
            "twin": {"updated_at": iso(last_obs * STEP_MIN), "params": params,
                     "fit": {"mard_24h": _r(mard, 2) or 0.0, "coverage_80_24h": _r(cov, 3) or 0.0}},
        })
        return detail

    def fhir(self, pid: str) -> dict:
        if pid not in self.split:
            raise KeyError(pid)
        return json.loads((self.paths.fhir / f"{pid}.json").read_text(encoding="utf-8"))

    # ---- timeline --------------------------------------------------------------------------------
    def _sleep_segments(self, pdat: PatientData, a: int, b: int) -> list[dict]:
        from ..observables import detect_sleeps

        segs = []
        for ep in detect_sleeps(pdat.stage):
            s0, s1 = max(ep.on_k, a), min(ep.off_k, b)
            if s1 <= s0:
                continue
            st = pdat.stage[s0:s1]
            start = s0
            for i in range(1, st.shape[0] + 1):
                if i == st.shape[0] or st[i] != st[i - 1]:
                    segs.append({"start": iso(start * STEP_MIN), "end": iso((s0 + i) * STEP_MIN),
                                 "stage": STAGES[int(st[i - 1])]})
                    start = s0 + i
        return segs

    def timeline(self, pid: str, t_from: int, t_to: int, now: int, with_risk: bool = True) -> dict:
        pdat = self.patient(pid)
        a = max(0, t_from // STEP_MIN)
        b = min(pdat.n, t_to // STEP_MIN + 1)
        ks = np.arange(a, b)
        ts = [iso(k * STEP_MIN) for k in ks]
        cgm = [{"t": t, "g": None if np.isnan(g) else float(g)} for t, g in zip(ts, pdat.cgm[a:b], strict=True)]
        twin = [{"t": t, "p10": round(float(q[0]), 1), "p50": round(float(q[1]), 1), "p90": round(float(q[2]), 1)}
                for t, q in zip(ts, pdat.q[a:b], strict=True) if not np.isnan(q[1])]
        hr = [{"t": t, "bpm": round(float(h), 1)} for t, h in zip(ts, pdat.hr[a:b], strict=True) if not np.isnan(h)]
        hrv = [{"t": t, "rmssd": round(float(h), 1)} for t, h in zip(ts, pdat.hrv[a:b], strict=True) if not np.isnan(h)]
        steps = [{"t": t, "count": int(s)} for t, s in zip(ts, pdat.steps[a:b], strict=True)]
        meals = [{"t": iso(m["t"]), "carbs_g": m["carbs_g"], "gl": m["gl"], "slot": m["slot"],
                  "items": [{"food_id": i["food_id"], "name": i["name"], "portions": i["portions"],
                             "carbs_g": i["carbs_g"]} for i in m["items"]]}
                 for m in pdat.record["logged"]["meals"] if t_from <= m["t"] <= t_to]
        doses = [{"t": iso(d["t"]), "drug": DRUGS[d["drug"]].name, "dose": f"{d['dose_amount']:g} {DRUGS[d['drug']].unit}",
                  "taken": bool(d["taken"])} for d in pdat.record["logged"]["doses"] if t_from <= d["t"] <= t_to]
        alerts = [self._alert_view(al, now) for al in pdat.alerts if t_from <= al["k"] * STEP_MIN <= t_to]
        events = []
        seg = pdat.cgm[a:b]
        for kind, thr, above in (("hyper_l2", 250.0, True), ("hypo_l1", 70.0, False), ("hypo_l2", 54.0, False)):
            for s, e, ext in episodes(seg, thr, above):
                events.append({"kind": kind, "start": iso((a + s) * STEP_MIN), "end": iso((a + e) * STEP_MIN),
                               "extreme": round(ext, 1)})
        events.sort(key=lambda x: x["start"])
        out = {"from": iso(a * STEP_MIN), "to": iso((b - 1) * STEP_MIN), "cgm": cgm, "twin": twin, "hr": hr,
               "hrv": hrv, "steps": steps, "sleep": self._sleep_segments(pdat, a, b), "meals": meals, "doses": doses,
               "alerts": alerts, "events": events}
        if with_risk:
            out["risk"] = self.risk_series(pid, a * STEP_MIN, (b - 1) * STEP_MIN)
        return out

    def risk_series(self, pid: str, t_from: int, t_to: int) -> list[dict]:
        pdat = self.patient(pid)
        sel = (pdat.pred_k * STEP_MIN >= t_from) & (pdat.pred_k * STEP_MIN <= t_to)
        out = []
        for k, ph, po in zip(pdat.pred_k[sel], pdat.p_hyper[sel], pdat.p_hypo[sel], strict=True):
            kd = self._night_decision(pdat, int(k))
            pn = pdat.noct_pred[kd] if kd is not None else None
            out.append({"t": iso(int(k) * STEP_MIN), "hyper_2h": round(float(ph), 4), "hypo_1h": round(float(po), 4),
                        "nocturnal_hypo": None if pn is None else round(pn, 4),
                        "level": self._level(float(ph), float(po), pn)})
        return out

    # ---- drivers / forecast ----------------------------------------------------------------------
    def drivers_at(self, pid: str, k: int) -> dict[str, list[dict]]:
        pdat = self.patient(pid)
        key = ("drivers", k)
        if key in pdat.cache:
            return pdat.cache[key]
        i = self._dp_index(pdat, k)
        out: dict[str, list[dict]] = {"hyper_2h": [], "hypo_1h": []}
        if i is not None:
            kd = int(pdat.pred_k[i])
            run = self.run(pid)
            row = compute_features(run.obs, np.array([kd]), run.drv)
            j = int(np.searchsorted(pdat.dp_k, kd))
            if j < pdat.dp_k.shape[0] and pdat.dp_k[j] == kd:
                row[TWIN_FEATURES] = pdat.dp_feat[j:j + 1]
                for task in ("hyper_2h", "hypo_1h"):
                    cols = self.meta["tasks"][task]["hybrid"]["features"]
                    x = row[cols]
                    contrib = self.booster(task).predict(x, pred_contrib=True)[0]
                    out[task] = drivers_from_contrib(contrib, x.to_numpy(dtype=float)[0], cols)
        pdat.cache[key] = out
        return out

    def _scale_quantiles(self, traj: np.ndarray) -> np.ndarray:
        q = np.quantile(traj, [0.05, 0.25, 0.5, 0.75, 0.95], axis=0)
        lead = np.arange(traj.shape[1]) * STEP_MIN
        s = np.interp(lead, *self.fc_scale)
        return q[2] + s * (q - q[2])

    def forecast(self, pid: str, at: int) -> dict:
        pdat = self.patient(pid)
        k = at // STEP_MIN
        key = ("forecast", k)
        if key in pdat.cache:
            return pdat.cache[key]
        run = self.run(pid)
        z = self.ensemble(pid, k)
        traj = ensemble_forecast(run, z, k, 240, HabitPrior(run), forecast_seed(run, k))
        q = np.clip(self._scale_quantiles(traj), 20, 600)
        mech = mechanistic_run(run, z, k, 240)
        t0 = k * STEP_MIN
        times = [iso(t0 + j * STEP_MIN) for j in range(q.shape[1])]
        si_now = float(np.exp(z[:, P_SI]).mean())
        a = max(0, k - 7 * SAMPLES_PER_DAY)
        si_hist = np.exp(pdat.pmean[a:k + 1, P_SI - NX].astype(float))
        si_hist = si_hist[~np.isnan(si_hist)]
        base_si = float(np.median(si_hist)) if si_hist.size else si_now
        su_eff = float(run.drv[max(t0 - 1, 0), 0])
        out = {
            "at": iso(t0), "step_min": 5, "horizon_min": 240,
            "quantiles": [{"t": t, "p05": round(float(a5), 1), "p25": round(float(a25), 1), "p50": round(float(a50), 1),
                           "p75": round(float(a75), 1), "p95": round(float(a95), 1)}
                          for t, a5, a25, a50, a75, a95 in zip(times, *q, strict=True)],
            "mechanistic_p50": [{"t": t, "g": round(float(g), 1)} for t, g in zip(times, mech, strict=True)],
            "risk": self.risk_at(pid, t0),
            "drivers": self.drivers_at(pid, k),
            "state": {"glucose": round(float(z[:, S_G].mean()), 1),
                      "insulin_action": round(float(z[:, S_X].mean()) * 1e3, 3),
                      "carbs_on_board_g": round(float((z[:, S_D1] + z[:, S_D2]).mean()) / 1000.0, 1),
                      "sulfonylurea_active": bool(su_eff > 0.25),
                      "insulin_sensitivity_vs_baseline": round(si_now / base_si, 3) if base_si > 0 else 1.0},
        }
        pdat.cache[key] = out
        return out

    # ---- what-if ---------------------------------------------------------------------------------
    def _resolve_drug(self, pid: str, name: str | None) -> str | None:
        if not name:
            return None
        meds = self.patient(pid).record["medications"]
        low = name.strip().lower()
        for m in meds:
            if low in (m["drug"], m["name"].lower(), m["label"].lower()) or m["name"].lower().startswith(low):
                return m["drug"]
        return None

    @staticmethod
    def _meal_inputs(meals: list[dict] | None) -> list[tuple[int, float, float]]:
        out = []
        for m in meals or []:
            items = [(it["food_id"], float(it.get("portions", 1.0))) for it in m["items"]]
            for fid, _ in items:
                get_food(fid)
            s = summarize_meal(items)
            out.append((int(m["offset_min"]), s.carbs_g, s.tau_min))
        return out

    @staticmethod
    def _wi_metrics(traj: np.ndarray) -> dict:
        p50 = np.median(traj, axis=0)[1:]
        return {"peak": round(float(p50.max()), 1), "nadir": round(float(p50.min()), 1),
                "min_above_180": float(5 * (p50 > 180).sum()), "min_below_70": float(5 * (p50 < 70).sum()),
                "hypo_probability": round(float(run_exceed(traj[:, 1:], 70.0, False).mean()), 3),
                "tir": round(float(100 * np.mean((p50 >= 70) & (p50 <= 180))), 1)}

    def whatif(self, pid: str, req: dict, now: int) -> dict:
        at = self.resolve_now(req.get("at")) if req.get("at") else now
        horizon = int(np.clip(req.get("horizon_min") or 300, 60, 480))
        horizon -= horizon % STEP_MIN
        horizon = min(horizon, self.n_min - at - STEP_MIN)
        k = at // STEP_MIN
        run = self.run(pid)
        z = self.ensemble(pid, k)
        sc = req.get("scenario") or {}
        seed = forecast_seed(run, k, salt=99)
        prior = HabitPrior(run)
        base_meals = self._meal_inputs(req.get("baseline_meals"))
        use_prior_base = not base_meals
        scen_meals = self._meal_inputs(sc.get("meals"))
        replace = bool(sc.get("replace_planned_meals"))
        if replace or not base_meals:
            scen_all = scen_meals if replace else scen_meals
        else:
            scen_all = base_meals + scen_meals
        walk = sc.get("walk")
        walk_t = (walk["offset_min"], walk["duration_min"], WALK_INTENSITY[walk["intensity"]]) if walk else None
        skip = self._resolve_drug(pid, sc.get("skip_dose"))
        shift = sc.get("shift_dose")
        shift_t = (self._resolve_drug(pid, shift["drug"]), float(shift["offset_min"])) if shift else None
        if shift_t and shift_t[0] is None:
            shift_t = None
        sleep = sc.get("sleep_hours_last_night")
        base = ensemble_forecast(run, z, k, horizon, prior, seed, extra_meals=base_meals, use_prior=use_prior_base)
        scen = ensemble_forecast(run, z, k, horizon, prior, seed, extra_meals=scen_all,
                                 use_prior=(use_prior_base and not replace), walk=walk_t, skip_dose=skip,
                                 shift_dose=shift_t, sleep_hours=sleep)
        t0 = k * STEP_MIN
        times = [iso(t0 + j * STEP_MIN) for j in range(base.shape[1])]

        def band(traj: np.ndarray) -> list[dict]:
            q = np.clip(np.quantile(traj, [0.1, 0.5, 0.9], axis=0), 20, 600)
            return [{"t": t, "p10": round(float(a), 1), "p50": round(float(b), 1), "p90": round(float(c), 1)}
                    for t, a, b, c in zip(times, *q, strict=True)]

        mb, ms = self._wi_metrics(base), self._wi_metrics(scen)
        return {"at": iso(t0), "baseline": band(base), "scenario": band(scen), "metrics": {"baseline": mb, "scenario": ms},
                "narrative": narrative(mb, ms, sc, skip, sleep, walk)}

    # ---- presets for the static demo ---------------------------------------------------------------
    def habitual_dinner(self, pid: str, now: int) -> tuple[list[tuple[str, float]], int]:
        meals = [m for m in self.patient(pid).record["logged"]["meals"]
                 if m["slot"] == "dinner" and now - 7 * 1440 <= m["t"] < now]
        if not meals:
            return DEFAULT_DINNER, 21 * 60 + 15
        counts: dict[tuple, int] = {}
        for m in meals:
            key = tuple(sorted(i["food_id"] for i in m["items"]))
            counts[key] = counts.get(key, 0) + 1
        best = max(counts, key=counts.get)
        sample = next(m for m in meals if tuple(sorted(i["food_id"] for i in m["items"])) == best)
        tod = int(np.median([m["t"] % 1440 for m in meals]))
        items = [(i["food_id"], max(0.5, round(i["portions"] * 2) / 2)) for i in sample["items"]]
        return items, tod

    def presets(self, pid: str, now: int) -> dict[str, dict]:
        items, tod = self.habitual_dinner(pid, now)
        off = (tod - (now % 1440)) % 1440
        if off > 300 - 120:
            off = 60
        swapped = []
        for fid, p in items:
            if fid in RICE_LIKE:
                swapped.append(("bajra_roti", round(2 * p) / 1.0 if p >= 1 else 1.0))
            elif fid in WHEAT_FLATBREAD:
                swapped.append(("bajra_roti", p))
            else:
                swapped.append((fid, p))
        if swapped == items:
            swapped = [("jowar_roti", p) if f == "bajra_roti" else (f, p) for f, p in items]
        dinner = [{"offset_min": off, "items": [{"food_id": f, "portions": p} for f, p in items]}]
        swap = [{"offset_min": off, "items": [{"food_id": f, "portions": p} for f, p in swapped]}]
        out = {
            "swap-rice-for-millet-roti": {
                "label": "Swap rice / wheat for bajra (millet) roti at dinner",
                "request": {"horizon_min": 300, "baseline_meals": dinner,
                            "scenario": {"meals": swap, "replace_planned_meals": True}}},
            "walk-15-after-dinner": {
                "label": "15-minute brisk walk 20 min after dinner",
                "request": {"horizon_min": 300, "baseline_meals": dinner,
                            "scenario": {"walk": {"offset_min": off + 20, "duration_min": 15, "intensity": "brisk"}}}},
            "short-sleep": {
                "label": "Only 4.5 h of sleep last night",
                "request": {"horizon_min": 300, "scenario": {"sleep_hours_last_night": 4.5}}},
        }
        meds = self.patient(pid).record["medications"]
        order = {"su": 0, "insulin": 1, "metformin": 2, "dpp4": 3, "sglt2": 4}
        main = sorted(meds, key=lambda m: order.get(DRUGS[m["drug"]].kind, 9))
        if main:
            m = main[0]
            times = [int(t[:2]) * 60 + int(t[3:]) for t in m["times"]]
            nxt = [t for t in times if 0 < (t - now % 1440) % 1440 <= 240]
            if nxt:
                at = now
            else:
                day0 = (now // 1440) * 1440
                at = max(day0 + min(times) - 30, 0)
            # when no dose is due in the next 4 h the preset replays today's dose from 30 min before it
            # (``at`` earlier than now); say so in the label so the UI does not imply "next 5 h from now"
            label = (f"Skip the next {m['name']} dose" if at == now else
                     f"Skip today's {m['name']} dose (replayed from {at % 1440 // 60:02d}:{at % 60:02d})")
            out[f"skip-{m['drug'].replace('_', '-')}"] = {
                "label": label, "request": {"at": iso(at), "horizon_min": 360,
                                                                        "scenario": {"skip_dose": m["drug"]}}}
        return out


def narrative(mb: dict, ms: dict, sc: dict, skip: str | None, sleep: float | None, walk: dict | None) -> list[str]:
    out: list[str] = []
    dp = ms["peak"] - mb["peak"]
    if abs(dp) >= 3:
        out.append(f"Peak glucose {'falls' if dp < 0 else 'rises'} from {mb['peak']:.0f} to {ms['peak']:.0f} mg/dL "
                   f"({dp:+.0f}).")
    else:
        out.append(f"Peak glucose is essentially unchanged (~{ms['peak']:.0f} mg/dL).")
    da = ms["min_above_180"] - mb["min_above_180"]
    if abs(da) >= 10:
        out.append(f"Time above 180 mg/dL {'drops' if da < 0 else 'increases'} by {abs(da):.0f} min over the window.")
    dh = ms["hypo_probability"] - mb["hypo_probability"]
    if abs(dh) >= 0.03:
        out.append(f"Chance of a low (<70 mg/dL for 15 min) {'rises' if dh > 0 else 'falls'} from "
                   f"{100 * mb['hypo_probability']:.0f}% to {100 * ms['hypo_probability']:.0f}%.")
    if walk:
        out.append(f"The {walk['duration_min']}-min {walk['intensity']} walk increases muscle glucose uptake and "
                   f"insulin sensitivity for several hours in the twin.")
    if sc.get("meals"):
        if dp < -3:
            out.append("Lower-GI / higher-fibre choices slow carbohydrate absorption in the twin's gut model, "
                       "flattening the post-meal curve.")
        elif dp > 3:
            out.append("The added / higher-GI carbohydrate is absorbed quickly in the twin's gut model, raising the "
                       "post-meal curve.")
    if skip:
        out.append(f"Skipping {DRUGS[skip].name} removes its expected effect from the forecast"
                   + (" - sulfonylureas lower glucose even without food, so skipping can reduce hypo risk but raises "
                      "the day's glucose." if DRUGS[skip].kind == "su" else "."))
    if sleep is not None:
        out.append(f"After {sleep:g} h of sleep the twin lowers insulin sensitivity for the day (sleep-restriction "
                   f"studies report roughly 15-25 % lower insulin sensitivity after one short night).")
    dt = ms["tir"] - mb["tir"]
    if abs(dt) >= 2:
        out.append(f"Time in range over the window: {mb['tir']:.0f}% -> {ms['tir']:.0f}%.")
    out.append("Simulation on a synthetic patient's digital twin; illustrative, not medical advice.")
    return out


_SERVICE: TwinService | None = None


def get_service() -> TwinService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = TwinService()
    return _SERVICE


def set_service(svc: TwinService | None) -> None:
    global _SERVICE
    _SERVICE = svc


def foods() -> dict:
    return {"foods": foods_as_dicts()}


__all__ = ["TwinService", "get_service", "set_service", "foods", "PROFILES", "__version__", "NOCT_FEATURES"]
