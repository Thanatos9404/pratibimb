"""Real-data adapter: GlycoTwin's harmonised open-data store -> Pratibimb patient records.

Reads (read-only) the GlycoTwin repository given by ``--glyco-path``:

* ``data/processed/{patients,series,events}.parquet`` - GlycoTwin's harmonised 15-min store
  (``python -m glycotwin.store`` builds it); used for ShanghaiT2DM and for the record list / EHR.
* ``data/raw/cgmacros/CGMacros/CGMacros-0XX/CGMacros-0XX.csv`` - CGMacros minute-level files, read here
  for the 5-min Dexcom G6 trace, heart rate, activity METs and exact meal times/macros.

The CGMacros parsing rules (Dexcom chosen over Libre Pro, energy-consistency fix for carbs, "Amount
Consumed" scaling, METs = activity kcal/min x 60 / weight) are ported from GlycoTwin's
``glycotwin/io_cgmacros.py`` (MIT licence, same authors' team). Nothing from the GlycoTwin package is
imported at runtime.

Every mapping and assumption is documented in ``docs/REAL_DATA.md``. Derived records are written to
``data/real/records`` (git-ignored): CGMacros-derived data are CC BY-NC-SA 4.0 and are never part of the
Apache-2.0 repository.
"""

from __future__ import annotations

import json
import math
import re
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import SAMPLES_PER_DAY, STEP_MIN, data_root
from ..foods.table import meal_tau
from ..physiology.drugs import DRUGS

GRID_MIN = 15  # GlycoTwin grid; record origins are chosen so its timestamps land on Pratibimb's 15-min DPs
MEAL_GI = 55.0  # assumed glycaemic index of a mixed meal (neither dataset records GI)
AGI_TAU_FACTOR = 1.5  # alpha-glucosidase inhibitor taken with a meal -> slower carbohydrate absorption
AGI_WINDOW_MIN = 45
WHTR_FROM_BMI = (0.22, 0.012)  # waist not recorded: WHtR ~ 0.22 + 0.012 x BMI (BMI path), clipped 0.40-0.75
DEFAULT_DURATION_Y = {"Healthy": 0.0, "Prediabetes": 0.0, "T2D": 5.0}
DEFAULT_TG = 150.0
DEFAULT_EGFR = 90.0
CPEP_NMOL_TO_NGML = 3.02
STATUS_DEFAULTS = {"Healthy": (5.3, 92.0), "Prediabetes": (6.0, 108.0), "T2D": (7.5, 150.0)}  # (HbA1c, FPG)

LICENCES = {"CGMacros": ("PhysioNet", "CC BY-NC-SA 4.0"), "ShanghaiT2DM": ("figshare", "CC BY 4.0")}

# ShanghaiT2DM oral agents -> Pratibimb catalogue: (regex, drug key, dose factor to Pratibimb units)
SU_OR_GLINIDE = [
    (r"gliclazide", None, 1.0),  # resolved below: 30/60/90/120 mg = MR tablet, else immediate release
    (r"glimepiride", "glimepiride", 1.0),
    (r"gliquidone", "gliclazide", 80.0 / 30.0),  # short-acting SU: 30 mg ~ gliclazide 80 mg
    (r"glipizide", "gliclazide", 80.0 / 5.0),
    (r"glibenclamide|glyburide", "glimepiride", 2.0 / 5.0),
    (r"repaglinide", "gliclazide", 80.0),  # glinide -> short-acting SU: 1 mg ~ gliclazide 80 mg
    (r"nateglinide", "gliclazide", 80.0 / 120.0),
]
OTHER_ORAL = [
    (r"metformin", "metformin", 1.0),
    (r"sitagliptin|linagliptin|saxagliptin|alogliptin|vildagliptin", "sitagliptin", None),  # adherence trace only
    (r"dapagliflozin|canagliflozin|empagliflozin", "dapagliflozin", None),
]
AGI_RE = r"acarbose|voglibose|miglitol"
UNMODELLED_RE = r"pioglitazone|rosiglitazone|liraglutide|exenatide|dulaglutide|semaglutide|lixisenatide"


def real_root() -> Path:
    return data_root() / "real"


def record_id(twin_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", twin_id)


def record_seed(rid: str) -> int:
    return int(zlib.crc32(rid.encode()) % (2**31 - 1))


# ---------------------------------------------------------------------------------------------------
def load_store(glyco: Path) -> dict[str, pd.DataFrame]:
    proc = Path(glyco) / "data" / "processed"
    missing = [n for n in ("patients", "series", "events") if not (proc / f"{n}.parquet").exists()]
    if missing:
        raise FileNotFoundError(f"GlycoTwin store missing {missing} under {proc}; run `python -m glycotwin.store` "
                                "in the GlycoTwin repository first (its loader would silently fall back to "
                                "synthetic demo patients, which we refuse to use).")
    out = {n: pd.read_parquet(proc / f"{n}.parquet") for n in ("patients", "series", "events")}
    pts = out["patients"]
    if "synthetic" in pts.columns:
        pts = pts[~pts["synthetic"].astype(bool)]
    out["patients"] = pts.reset_index(drop=True)
    return out


def select_records(store: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, list[dict]]:
    """CGMacros: all records. ShanghaiT2DM: only records with no insulin at all (Pratibimb models basal
    glargine only; rapid/premixed/pump insulin is out of scope)."""
    pts, s = store["patients"], store["series"]
    ins = s.groupby("twin_id")[["ins_fast", "ins_int", "ins_basal"]].sum().sum(axis=1)
    keep, excluded = [], []
    for _, r in pts.iterrows():
        if r["cohort"] == "ShanghaiT2DM" and (bool(r["on_insulin"]) or float(ins.get(r["twin_id"], 0.0)) > 0):
            excluded.append({"twin_id": r["twin_id"], "reason": "insulin therapy"})
            continue
        if r["cohort"] not in LICENCES:
            excluded.append({"twin_id": r["twin_id"], "reason": "unknown cohort"})
            continue
        keep.append(r)
    return pd.DataFrame(keep).reset_index(drop=True), excluded


# ---------------------------------------------------------------------------------------------------
def origin_for(t0: pd.Timestamp) -> pd.Timestamp:
    """Midnight of the first day, shifted by (minute-of-day mod 15) so that every GlycoTwin grid point is a
    multiple of 15 min after the origin (Pratibimb decision points). Shift <= 14 min (documented)."""
    day = t0.normalize()
    mod = int(((t0 - day).total_seconds() // 60) % GRID_MIN)
    return day + pd.Timedelta(minutes=mod)


def minutes_since(ts, origin: pd.Timestamp) -> np.ndarray:
    return ((pd.to_datetime(pd.Series(ts)) - origin) / pd.Timedelta(minutes=1)).to_numpy(dtype=float)


def slot_for(meal_type: str | None, minute_of_day: float) -> str:
    mt = (meal_type or "").strip().lower()
    if mt.startswith("breakfast"):
        return "breakfast"
    if mt.startswith("lunch"):
        return "lunch"
    if mt.startswith("dinner"):
        return "dinner"
    h = (minute_of_day % 1440) / 60.0
    if not mt:  # no label (ShanghaiT2DM): assign by clock time
        if 4.0 <= h < 10.5:
            return "breakfast"
        if 10.5 <= h < 15.5:
            return "lunch"
        if 18.5 <= h < 23.0:
            return "dinner"
    return "evening_snack" if 15.5 <= h < 18.5 else "snack"


def _meal(t: float, slot: str, carbs: float, protein: float, fat: float, fiber: float, source: str) -> dict:
    carbs = max(float(carbs), 0.0)
    return {"t": int(round(t)), "slot": slot, "carbs_g": round(carbs, 1), "gi": MEAL_GI,
            "gl": round(MEAL_GI * carbs / 100.0, 1), "tau_min": round(meal_tau(MEAL_GI, fat, protein, fiber), 1),
            "protein_g": round(float(protein), 1), "fat_g": round(float(fat), 1), "fiber_g": round(float(fiber), 1),
            "source": source}


# ---------------------------------------------------------------------------------------------------
def _read_cgmacros_csv(glyco: Path, twin_id: str) -> pd.DataFrame:
    sid = int(twin_id.split("-")[1])
    p = Path(glyco) / "data" / "raw" / "cgmacros" / "CGMacros" / f"CGMacros-{sid:03d}" / f"CGMacros-{sid:03d}.csv"
    d = pd.read_csv(p)
    d.columns = [c.strip() for c in d.columns]
    d = d.drop(columns=[c for c in d.columns if c.startswith("Unnamed")])
    d["Timestamp"] = pd.to_datetime(d["Timestamp"])
    return d.sort_values("Timestamp").reset_index(drop=True)


def mets_to_steps_per_min(mets: np.ndarray) -> np.ndarray:
    """Activity proxy: steps/min = clip((METs - 1.5) x 70, 0, 180) (3 METs ~ brisk walk ~ 105 steps/min)."""
    return np.clip((np.nan_to_num(mets, nan=1.0) - 1.5) * 70.0, 0.0, 180.0)


def cgmacros_streams(glyco: Path, twin_id: str, weight: float, origin: pd.Timestamp, n: int):
    d = _read_cgmacros_csv(glyco, twin_id)
    m = minutes_since(d["Timestamp"], origin)
    mi = np.round(m).astype(int)
    cgm = np.full(n, np.nan)
    dex = pd.to_numeric(d["Dexcom GL"], errors="coerce").to_numpy(dtype=float)
    sel = (mi % STEP_MIN == 0) & (mi >= 0) & (mi < n * STEP_MIN) & np.isfinite(dex)
    cgm[mi[sel] // STEP_MIN] = dex[sel]  # Dexcom G6 native 5-min reading at each 5-min mark
    cgm[(cgm < 40) | (cgm > 400)] = np.nan
    b = np.ceil(m / STEP_MIN).astype(int)  # (t-5, t] -> sample t
    okb = (b >= 0) & (b < n)
    hr_v = pd.to_numeric(d["HR"], errors="coerce").to_numpy(dtype=float)
    okh = okb & np.isfinite(hr_v)
    hr_sum = np.bincount(b[okh], weights=hr_v[okh], minlength=n)
    hr_cnt = np.bincount(b[okh], minlength=n)
    with np.errstate(invalid="ignore"):
        hr = np.where(hr_cnt > 0, hr_sum / np.maximum(hr_cnt, 1), np.nan)
    if "Calories (Activity)" in d:
        mets = pd.to_numeric(d["Calories (Activity)"], errors="coerce").to_numpy(dtype=float) * 60.0 / weight
    elif "METs" in d:
        mets = pd.to_numeric(d["METs"], errors="coerce").to_numpy(dtype=float) / 10.0
    else:
        mets = np.full(len(d), np.nan)
    steps = np.bincount(b[okb], weights=mets_to_steps_per_min(mets[okb]), minlength=n)[:n]

    meals_df = d[d["Meal Type"].notna()].copy()
    for c in ("Calories", "Carbs", "Protein", "Fat", "Fiber"):
        meals_df[c] = pd.to_numeric(meals_df.get(c), errors="coerce")
    bad = (meals_df["Calories"] > 0) & (meals_df["Carbs"] * 4 > meals_df["Calories"] + 100)
    meals_df.loc[bad, "Carbs"] = ((meals_df.loc[bad, "Calories"] - 4 * meals_df.loc[bad, "Protein"].fillna(0)
                                   - 9 * meals_df.loc[bad, "Fat"].fillna(0)) / 4).clip(lower=0)
    frac = pd.to_numeric(meals_df.get("Amount Consumed", pd.Series(100.0, index=meals_df.index)), errors="coerce")
    frac = frac.fillna(100.0).clip(0, 100) / 100.0
    for c in ("Calories", "Carbs", "Protein", "Fat", "Fiber"):
        meals_df[c] = meals_df[c] * frac
    mt = minutes_since(meals_df["Timestamp"], origin)
    meals = []
    for t, (_, r) in zip(mt, meals_df.iterrows(), strict=True):
        if 0 <= t < n * STEP_MIN:
            meals.append(_meal(t, slot_for(str(r["Meal Type"]), t), np.nan_to_num(r["Carbs"]),
                               np.nan_to_num(r["Protein"]), np.nan_to_num(r["Fat"]), np.nan_to_num(r["Fiber"]),
                               "logged (photo-estimated macros)"))
    return cgm, hr, steps, meals


def shanghai_streams(series: pd.DataFrame, origin: pd.Timestamp, n: int):
    k = np.round(minutes_since(series["time"], origin) / STEP_MIN).astype(int)
    ok = (k >= 0) & (k < n)
    cgm = np.full(n, np.nan)
    g = series["glucose"].to_numpy(dtype=float)
    cgm[k[ok]] = g[ok]  # FreeStyle Libre H, native 15-min
    meals = []
    mrows = series[series["meal_flag"].astype(bool)]
    tm = minutes_since(mrows["time"], origin)
    for t, (_, r) in zip(tm, mrows.iterrows(), strict=True):
        if 0 <= t < n * STEP_MIN:
            src = "imputed (patient median; content not recorded)" if bool(r["carbs_imputed"]) else \
                "estimated from meal text (GlycoTwin food rules)"
            meals.append(_meal(t, slot_for(None, t), r["carbs"], r["protein"], r["fat"], r["fiber"], src))
    return cgm, meals


# ---------------------------------------------------------------------------------------------------
def parse_oral(label: str) -> tuple[list[tuple[str, float]], bool, list[str]]:
    """Parse one ShanghaiT2DM oral-dose label -> ([(drug, amount)], agi_taken, unmodelled agents)."""
    text = label.split(":", 1)[-1].lower()
    doses: list[tuple[str, float]] = []
    agi = bool(re.search(AGI_RE, text))
    unmodelled = sorted(set(re.findall(UNMODELLED_RE, text)))
    for piece in re.split(r",(?![^()]*\))", text):
        names = []
        for rx, key, fac in SU_OR_GLINIDE + OTHER_ORAL:
            mm = re.search(rx, piece)
            if mm:
                names.append((mm.start(), rx, key, fac))
        names.sort()
        nums = [(float(v) * (1000.0 if u == "g" else 1.0)) for v, u in re.findall(r"(\d+(?:\.\d+)?)\s*(mg|g)\b", piece)]
        for i, (_, rx, key, fac) in enumerate(names):
            amt = nums[i] if i < len(nums) else (nums[0] if nums else float("nan"))
            if rx == "gliclazide":
                key = "gliclazide_mr" if (np.isfinite(amt) and amt % 30 == 0) else "gliclazide"
            spec = DRUGS[key]
            dose = spec.ref_dose if (fac is None or not np.isfinite(amt)) else amt * fac
            doses.append((key, float(dose)))
    return doses, agi, unmodelled


def _schedule(times: np.ndarray, amounts: np.ndarray, n_days: int) -> tuple[list[str], float]:
    """Regular dose slots from logged clock times (minute of the Pratibimb day)."""
    mod = np.mod(times, 1440.0)
    bins = np.round(mod / 60.0).astype(int) % 24
    out = []
    for bval in np.unique(bins):
        sel = bins == bval
        if sel.sum() >= max(2, 0.3 * n_days):
            t = int(round(float(np.median(mod[sel])) / 5.0) * 5) % 1440
            out.append(f"{t // 60:02d}:{t % 60:02d}")
    return sorted(set(out)), float(np.median(amounts))


def shanghai_meds(events: pd.DataFrame, origin: pd.Timestamp, n_days: int):
    oral = events[events["kind"] == "oral"]
    if oral.empty:
        return [], [], [], [], []
    tt = minutes_since(oral["time"], origin)
    per_drug: dict[str, list[tuple[float, float]]] = {}
    agi_t, unmodelled = [], set()
    for t, lab in zip(tt, oral["label"].astype(str), strict=True):
        doses, agi, um = parse_oral(lab)
        unmodelled.update(um)
        if agi:
            agi_t.append(float(t))
        for key, amt in doses:
            per_drug.setdefault(key, []).append((float(t), amt))
    meds, logged = [], []
    for key, lst in sorted(per_drug.items()):
        t_arr = np.array([x[0] for x in lst])
        a_arr = np.array([x[1] for x in lst])
        times, amt = _schedule(t_arr, a_arr, n_days)
        meds.append({"drug": key, "dose_amount": round(amt, 2), "times": times, "per_day": max(len(times), 1),
                     "source": "inferred from logged doses"})
        slot_min = np.array([int(h[:2]) * 60 + int(h[3:]) for h in times], dtype=float)
        for t, a in lst:
            t_sched = t
            if slot_min.size:
                day = math.floor(t / 1440.0) * 1440.0
                cand = np.concatenate([day + slot_min - 1440, day + slot_min, day + slot_min + 1440])
                j = int(np.argmin(np.abs(cand - t)))
                if abs(cand[j] - t) <= 120:
                    t_sched = float(cand[j])
            logged.append({"t": int(round(t)), "t_sched": int(round(t_sched)), "drug": key, "dose_amount": round(a, 2),
                           "taken": True})
    logged.sort(key=lambda d: d["t"])
    return meds, logged, agi_t, sorted(unmodelled), sorted(per_drug)


# ---------------------------------------------------------------------------------------------------
def _f(x) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return float("nan")
    return v


def ehr_from_row(r: pd.Series) -> tuple[dict, dict, list[str]]:
    status = str(r.get("diabetes_status") or "T2D")
    imputed = []
    hba1c, fpg = _f(r.get("hba1c_pct")), _f(r.get("fpg_mgdl"))
    if not np.isfinite(hba1c) and not np.isfinite(fpg):
        hba1c, fpg = STATUS_DEFAULTS.get(status, STATUS_DEFAULTS["T2D"])
        imputed += ["hba1c", "fpg"]
    elif not np.isfinite(hba1c):
        hba1c = (fpg + 46.7) / 28.7  # ADAG relation inverted with FPG as the eAG proxy
        imputed.append("hba1c")
    elif not np.isfinite(fpg):
        fpg = float(np.clip(28.7 * hba1c - 46.7, 80.0, 300.0))
        imputed.append("fpg")
    tg = _f(r.get("tg_mgdl"))
    if not np.isfinite(tg):
        tg = DEFAULT_TG
        imputed.append("tg")
    weight, height, bmi = _f(r.get("weight_kg")), _f(r.get("height_cm")), _f(r.get("bmi"))
    if not np.isfinite(bmi):
        bmi = weight / (height / 100.0) ** 2 if np.isfinite(weight) and np.isfinite(height) else 24.0
        imputed.append("bmi")
    if not np.isfinite(weight):
        weight = bmi * ((height / 100.0) ** 2 if np.isfinite(height) else 1.65 ** 2)
        imputed.append("weight")
    whtr = float(np.clip(WHTR_FROM_BMI[0] + WHTR_FROM_BMI[1] * bmi, 0.40, 0.75))
    imputed.append("whtr (from BMI)")
    egfr = _f(r.get("egfr"))
    if not np.isfinite(egfr):
        egfr = DEFAULT_EGFR
        imputed.append("egfr")
    cp = _f(r.get("fasting_cpeptide_nmol"))
    cpep = round(cp * CPEP_NMOL_TO_NGML, 2) if np.isfinite(cp) and cp > 0 else None
    dur = _f(r.get("diabetes_duration_y"))
    if not np.isfinite(dur):
        dur = DEFAULT_DURATION_Y.get(status, 5.0)
        imputed.append("diabetes_years")
    ehr = {"hba1c": round(hba1c, 2), "fpg": round(fpg, 1), "tg": round(tg, 1), "tyg": round(math.log(tg * fpg / 2), 3),
           "whtr": round(whtr, 3), "egfr": round(egfr, 1), "cpeptide": cpep, "bmi": round(bmi, 2)}
    age = _f(r.get("age"))
    rec = {"age": float(age) if np.isfinite(age) else 50.0, "sex": "M" if str(r.get("sex")).upper().startswith("M") else "F",
           "bmi": round(bmi, 2), "weight_kg": round(weight, 1), "height_cm": round(height, 1) if np.isfinite(height) else None,
           "diabetes_years": round(dur, 2), "genetics": []}
    return ehr, rec, imputed


def build_record(glyco: Path, row: pd.Series, series: pd.DataFrame, events: pd.DataFrame) -> tuple[dict, dict]:
    tid = str(row["twin_id"])
    cohort = str(row["cohort"])
    ser = series.sort_values("time")
    t0, t1 = ser["time"].iloc[0], ser["time"].iloc[-1]
    origin = origin_for(t0)
    n_days = int(math.ceil(((t1 - origin) / pd.Timedelta(minutes=1) + STEP_MIN) / 1440.0))
    n = n_days * SAMPLES_PER_DAY
    ehr, rec_base, imputed = ehr_from_row(row)
    hrv = np.full(n, np.nan)
    stage = np.zeros(n, dtype=np.int8)
    meds, doses, unmodelled, drugs_seen = [], [], [], []
    if cohort == "CGMacros":
        cgm, hr, steps, meals = cgmacros_streams(glyco, tid, rec_base["weight_kg"], origin, n)
    else:
        cgm, meals = shanghai_streams(ser, origin, n)
        hr = np.full(n, np.nan)
        steps = np.zeros(n)
        meds, doses, agi_t, unmodelled, drugs_seen = shanghai_meds(events, origin, n_days)
        if agi_t:
            agi = np.array(agi_t)
            for m in meals:
                if np.any(np.abs(agi - m["t"]) <= AGI_WINDOW_MIN):
                    m["tau_min"] = round(m["tau_min"] * AGI_TAU_FACTOR, 1)
                    m["source"] += "; acarbose-class AGI with meal -> slower absorption"
    meals.sort(key=lambda m: m["t"])
    rid = record_id(tid)
    rec = {"id": rid, **rec_base, "ehr": ehr, "medications": meds, "logged": {"meals": meals, "doses": doses},
           "real": {"twin_id": tid, "person_id": str(row["person_id"]), "cohort": cohort,
                    "diabetes_status": str(row.get("diabetes_status")), "origin": origin.isoformat(),
                    "n_days": n_days, "imputed": imputed, "unmodelled_agents": unmodelled,
                    "drug_classes_mapped": drugs_seen, "licence": LICENCES[cohort][1],
                    "cgm_points": int(np.isfinite(cgm).sum())}}
    arrays = {"cgm": cgm.astype(np.float32), "hr": hr.astype(np.float32), "hrv": hrv.astype(np.float32),
              "steps": steps.astype(np.float32), "stage": stage}
    return rec, arrays


def build_all(glyco: Path, out_dir: Path | None = None, log=print) -> list[dict]:
    """Convert every eligible GlycoTwin record; returns the manifest rows."""
    store = load_store(glyco)
    sel, excluded = select_records(store)
    out_dir = out_dir or real_root() / "records"
    out_dir.mkdir(parents=True, exist_ok=True)
    ser_by = dict(tuple(store["series"].groupby("twin_id", sort=False)))
    ev_by = dict(tuple(store["events"].groupby("twin_id", sort=False)))
    rows = []
    for _, r in sel.iterrows():
        tid = r["twin_id"]
        rec, arr = build_record(glyco, r, ser_by[tid], ev_by.get(tid, store["events"].iloc[:0]))
        with (out_dir / f"{rec['id']}.json").open("w", encoding="utf-8") as fh:
            json.dump(rec, fh)
        np.savez_compressed(out_dir / f"{rec['id']}.npz", **arr)
        rows.append({"id": rec["id"], **rec["real"], "n_meals": len(rec["logged"]["meals"]),
                     "n_doses": len(rec["logged"]["doses"])})
    man = {"records": rows, "excluded": excluded,
           "licence_note": "Derived from CGMacros (CC BY-NC-SA 4.0) and ShanghaiT2DM (CC BY 4.0). Not part of the "
                           "Apache-2.0 repository; do not redistribute CGMacros-derived files except under "
                           "CC BY-NC-SA 4.0."}
    with (out_dir.parent / "manifest.json").open("w", encoding="utf-8") as fh:
        json.dump(man, fh, indent=1)
    (out_dir.parent / "LICENCE-NOTE.txt").write_text(man["licence_note"] + "\n", encoding="utf-8")
    log(f"real-data adapter: {len(rows)} records converted, {len(excluded)} excluded")
    return rows
