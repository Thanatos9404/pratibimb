"""Static demo export for the web app's offline mode (``web/public/demo``).

Writes the files listed at the end of SPEC section 5 for ~24 representative patients plus a few
optional extras (``fhir/{id}.json``, hourly ``forecasts/{id}.json`` for offline replay, what-if
``index.json`` per patient and a top-level ``manifest.json``).

Demo patients are *curated* to illustrate scenarios at the demo clock (e.g. a nocturnal low tonight, a
post-dinner spike), using knowledge of what happens next in the synthetic data. Model metrics are
always computed on the full held-out test split, not on this subset.
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import numpy as np

from .config import SAMPLES_PER_DAY, STEP_MIN, Paths, Profile
from .ml.labels import episode_onsets, nocturnal_label
from .api.service import TwinService, foods


def _dump(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(data, encoding="utf-8")
    return len(data.encode("utf-8"))


def select_demo_patients(svc: TwinService, n: int) -> tuple[list[str], dict[str, list[str]]]:
    now = svc.default_now
    k_now = now // STEP_MIN
    rank = {"test": 0, "val": 1, "train": 2}
    ids = sorted(svc.ids, key=lambda p: (rank[svc.split[p]], p))
    info: dict[str, dict] = {}
    for pid in ids:
        rec = json.loads((svc.paths.patients / f"{pid}.json").read_text(encoding="utf-8"))
        g = np.load(svc.paths.patients / f"{pid}.npz")["g"].astype(float)
        night_k = (k_now // SAMPLES_PER_DAY) * SAMPLES_PER_DAY + 285
        lab, _ = nocturnal_label(g, night_k)
        hy = episode_onsets(g, 250.0, True)
        spike = bool(((hy > k_now) & (hy <= k_now + 60)).any())
        kinds = {m["drug"] for m in rec["medications"]}
        day = now // 1440
        ill = rec["truth"]["illness"]
        info[pid] = {"noct": lab == 1, "spike": spike, "glimepiride": "glimepiride" in kinds,
                     "insulin": "glargine" in kinds, "fasting": day in rec["truth"]["fasting_days"],
                     "ill": bool(ill and ill[0] - 1 <= day <= ill[0] + ill[1]),
                     "subtype": svc.subtypes.get(pid, "IROD")}
    chosen: list[str] = []
    why: dict[str, list[str]] = {}

    def take(pred, label: str, limit: int) -> None:
        c = 0
        for pid in ids:
            if c >= limit or len(chosen) >= n:
                return
            if pred(info[pid]) and pid not in chosen:
                chosen.append(pid)
                why.setdefault(pid, []).append(label)
                c += 1

    take(lambda x: x["noct"], "nocturnal hypo tonight (truth)", 3)
    take(lambda x: x["spike"], "post-dinner level-2 spike tonight (truth)", 3)
    take(lambda x: x["glimepiride"], "on glimepiride", 2)
    take(lambda x: x["insulin"], "on basal insulin", 2)
    take(lambda x: x["fasting"], "religious fasting day today", 2)
    take(lambda x: x["ill"], "illness episode around now", 1)
    for st in ("SIDD", "SIRD", "MARD", "IROD"):
        have = sum(info[p]["subtype"] == st for p in chosen)
        take(lambda x, st=st: x["subtype"] == st, f"inferred {st}", max(0, 4 - have))
    take(lambda x: True, "held-out test patient", n)
    for pid in chosen:
        if pid not in why:
            why[pid] = []
        why[pid].append(f"split={svc.split[pid]}")
    return chosen, why


def export_demo(profile: Profile, paths: Paths, out: Path, n_patients: int | None = None, log=print) -> dict:
    t0 = time.time()
    svc = TwinService(profile.name)
    n = n_patients or profile.demo_patients
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    now = svc.default_now
    ids, why = select_demo_patients(svc, n)
    sizes: dict[str, int] = {}
    sizes["clock.json"] = _dump(out / "clock.json", svc.clock())
    sizes["cohort.json"] = _dump(out / "cohort.json", svc.cohort(now, ids=ids))
    sizes["foods.json"] = _dump(out / "foods.json", foods())
    sizes["metrics.json"] = _dump(out / "metrics.json", svc.reports_json("metrics.json"))
    sizes["validation.json"] = _dump(out / "validation.json", svc.reports_json("cohort_validation.json"))
    t_from = max(0, now - 7 * 1440)
    t_to = min(svc.n_min - STEP_MIN, now + 3 * 1440)
    for pid in ids:
        sizes[f"patients/{pid}.json"] = _dump(out / "patients" / f"{pid}.json", svc.patient_detail(pid, now))
        sizes[f"timeline/{pid}.json"] = _dump(out / "timeline" / f"{pid}.json", svc.timeline(pid, t_from, t_to, now))
        sizes[f"forecast/{pid}.json"] = _dump(out / "forecast" / f"{pid}.json", svc.forecast(pid, now))
        hourly = [svc.forecast(pid, t) for t in range(now + 60, min(now + 24 * 60, svc.n_min - 245) + 1, 60)]
        sizes[f"forecasts/{pid}.json"] = _dump(out / "forecasts" / f"{pid}.json", {"forecasts": hourly})
        sizes[f"fhir/{pid}.json"] = _dump(out / "fhir" / f"{pid}.json", svc.fhir(pid))
        index = []
        for name, preset in svc.presets(pid, now).items():
            resp = svc.whatif(pid, preset["request"], now)
            sizes[f"whatif/{pid}/{name}.json"] = _dump(out / "whatif" / pid / f"{name}.json", resp)
            index.append({"id": name, "label": preset["label"], "request": preset["request"]})
        _dump(out / "whatif" / pid / "index.json", {"presets": index})
        svc._patients.pop(pid, None)
    total = sum(sizes.values())
    manifest = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "profile": profile.name, "now": svc.clock()["now"],
                "patients": [{"id": p, "why": why[p]} for p in ids], "timeline_window": ["now-7d", "now+3d"],
                "total_bytes": total,
                "note": "Demo patients curated to illustrate scenarios; metrics.json covers all held-out test patients."}
    _dump(out / "manifest.json", manifest)
    log(f"demo export: {len(ids)} patients, {total / 1e6:.1f} MB -> {out} ({time.time() - t0:.1f}s)")
    return manifest
