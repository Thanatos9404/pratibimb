"""Train the risk layer: LightGBM per task (hybrid and no-twin variants), isotonic calibration and
alert operating points chosen on the *validation* patients only. Test patients are never touched here.
"""

from __future__ import annotations

import json
import time

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from ..config import Paths
from ..twin.assimilate import NOCT_FEATURES, TWIN_FEATURES
from .alerts import POLICIES, simulate_alerts
from .dataset import META, load_datasets

TASKS = ("hyper_2h", "hypo_1h", "nocturnal_hypo")
TWIN_SCORE = {"hyper_2h": "p_hyper120", "hypo_1h": "p_hypo60", "nocturnal_hypo": "p_noct"}
NOCT_FA_PER_NIGHT = 1.0 / 7.0  # nocturnal operating point: <= 1 false alert per patient-week
FA_PER_DAY = 1.0
NON_FEATURES = set(META) | {"hyper_2h", "hyper_2h_elig", "hypo_1h", "hypo_1h_elig", "hyper_2h_cgm", "hypo_1h_cgm",
                            "nocturnal_hypo", "nocturnal_hypo_cgm", "noct_onset"}


def feature_columns(df: pd.DataFrame, task: str, variant: str) -> list[str]:
    cols = [c for c in df.columns if c not in NON_FEATURES]
    if variant == "ml_no_twin":
        drop = set(TWIN_FEATURES) | set(NOCT_FEATURES)
        cols = [c for c in cols if c not in drop]
    return cols


def task_frame(dp: pd.DataFrame, noct: pd.DataFrame, task: str) -> pd.DataFrame:
    if task == "nocturnal_hypo":
        return noct
    return dp[dp[f"{task}_elig"] == 1]


def lgb_params(task: str, pos_rate: float, seed: int) -> dict:
    spw = float(min(10.0, np.sqrt((1 - pos_rate) / max(pos_rate, 1e-4))))
    p = {"objective": "binary", "learning_rate": 0.04, "num_leaves": 31, "min_child_samples": 80,
         "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0,
         "metric": "average_precision", "verbose": -1, "num_threads": 6, "seed": seed, "scale_pos_weight": spw}
    if task == "nocturnal_hypo":
        p.update(num_leaves=15, min_child_samples=25, learning_rate=0.03, feature_fraction=0.7)
    return p


class Calibrator:
    """Isotonic calibration stored as interpolation knots (JSON-serialisable)."""

    def __init__(self, x: np.ndarray, y: np.ndarray) -> None:
        self.x = np.asarray(x, dtype=float)
        self.y = np.asarray(y, dtype=float)

    @classmethod
    def fit(cls, raw: np.ndarray, label: np.ndarray) -> Calibrator:
        if len(raw) < 10 or len(np.unique(label)) < 2:  # too little data: identity mapping
            return cls(np.array([0.0, 1.0]), np.array([0.0, 1.0]))
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(raw, label)
        return cls(iso.X_thresholds_, iso.y_thresholds_)

    def __call__(self, raw: np.ndarray) -> np.ndarray:
        return np.interp(raw, self.x, self.y)

    def to_json(self) -> dict:
        return {"x": self.x.tolist(), "y": self.y.tolist()}

    @classmethod
    def from_json(cls, d: dict) -> Calibrator:
        return cls(np.array(d["x"]), np.array(d["y"]))


def fit_model(tr: pd.DataFrame, va: pd.DataFrame, cols: list[str], label: str, task: str, seed: int):
    pos = float(tr[label].mean()) if len(tr) else 0.0
    dtr = lgb.Dataset(tr[cols], label=tr[label], free_raw_data=True)
    params = lgb_params(task, pos, seed)
    if va[label].nunique() == 2 and tr[label].sum() >= 5:
        dva = lgb.Dataset(va[cols], label=va[label], reference=dtr)
        booster = lgb.train(params, dtr, num_boost_round=2000, valid_sets=[dva],
                            callbacks=[lgb.early_stopping(100, verbose=False)])
    else:  # degenerate tiny datasets (CI profile): fixed small model, no early stopping
        booster = lgb.train(params, dtr, num_boost_round=50)
        booster.best_iteration = 50
    raw_va = booster.predict(va[cols], num_iteration=booster.best_iteration) if len(va) else np.zeros(0)
    return booster, Calibrator.fit(raw_va, va[label].to_numpy())


def choose_threshold(task: str, frame_all: pd.DataFrame, probs: np.ndarray, label: str) -> dict:
    """Lowest threshold whose false alerts per patient-day (validation) stays within budget."""
    cands = np.unique(np.quantile(probs, np.linspace(0.5, 0.9995, 300)))
    cands = cands[cands > 0]
    if task == "nocturnal_hypo":
        y = frame_all[label].to_numpy()
        n_nights = len(frame_all)
        best = float(cands[-1]) if cands.size else 0.5
        for thr in cands:
            fa = float(((probs >= thr) & (y == 0)).sum()) / max(n_nights, 1)
            if fa <= NOCT_FA_PER_NIGHT:
                best = float(thr)
                break
        return {"threshold": best, "budget": f"<= {NOCT_FA_PER_NIGHT:.3f} false alerts per patient-night"}
    pol = POLICIES[task]
    frame_all = frame_all.assign(_p=probs)
    groups = [(g["k"].to_numpy(), g["_p"].to_numpy(), g["cgm"].to_numpy(), g[label].to_numpy())
              for _, g in frame_all.groupby("pid")]
    patient_days = sum(len(ks) for ks, *_ in groups) * 15 / 1440.0

    def fa_rate(thr: float) -> float:
        fp = 0
        for ks, p, cgm, y in groups:
            fired = simulate_alerts(ks, p, cgm, thr, pol)
            fp += int((y[fired] == 0).sum())  # no event within the horizon of this alert
        return fp / patient_days

    lo, hi = 0, len(cands) - 1  # false-alert rate is (near-)monotone in the threshold: bisection
    if hi < 0:
        return {"threshold": 0.5, "budget": f"<= {FA_PER_DAY:.0f} false alert per patient-day"}
    while lo < hi:
        mid = (lo + hi) // 2
        if fa_rate(float(cands[mid])) <= FA_PER_DAY:
            hi = mid
        else:
            lo = mid + 1
    return {"threshold": float(cands[lo]), "budget": f"<= {FA_PER_DAY:.0f} false alert per patient-day",
            "val_false_alerts_per_day": round(fa_rate(float(cands[lo])), 3)}


def train_all(paths: Paths, seed: int = 7, log=print) -> dict:
    t0 = time.time()
    dp, noct = load_datasets(paths)
    meta: dict = {"tasks": {}, "seed": seed}
    preds_dp = dp[["pid", "split", "k"]].copy()
    preds_noct = noct[["pid", "split", "k"]].copy()
    for task in TASKS:
        frame = task_frame(dp, noct, task)
        tr, va = frame[frame.split == "train"], frame[frame.split == "val"]
        info: dict = {"n_train": int(len(tr)), "n_val": int(len(va)), "prevalence_train": float(tr[task].mean())}
        full = noct if task == "nocturnal_hypo" else dp
        for variant in ("hybrid", "ml_no_twin"):
            cols = feature_columns(frame, task, variant)
            booster, cal = fit_model(tr, va, cols, task, task, seed)
            booster.save_model(str(paths.models / f"{task}__{variant}.txt"), num_iteration=booster.best_iteration)
            info[variant] = {"features": cols, "best_iteration": int(booster.best_iteration),
                             "calibrator": cal.to_json()}
            raw = booster.predict(full[cols], num_iteration=booster.best_iteration)
            target = preds_noct if task == "nocturnal_hypo" else preds_dp
            target[f"{task}__{variant}"] = cal(raw).astype(np.float32)
            log(f"  {task}/{variant}: {len(cols)} features, {booster.best_iteration} trees")
        twin_cal = Calibrator.fit(va[TWIN_SCORE[task]].to_numpy(), va[task].to_numpy())
        info["twin_only"] = {"score": TWIN_SCORE[task], "calibrator": twin_cal.to_json()}
        # operating point on validation patients (all decision points, not only eligible ones)
        target = preds_noct if task == "nocturnal_hypo" else preds_dp
        vmask = (target.split == "val").to_numpy()
        vframe = full[vmask].copy()
        if task != "nocturnal_hypo":
            vframe[task] = vframe[task].where(vframe[f"{task}_elig"] == 1, 0)
        op = choose_threshold(task, vframe, target.loc[vmask, f"{task}__hybrid"].to_numpy(), task)
        info["operating_point"] = op
        meta["tasks"][task] = info
        log(f"  {task}: threshold {op['threshold']:.3f} ({op['budget']})")
    preds_dp.to_parquet(paths.ml / "predictions_dp.parquet", index=False)
    preds_noct.to_parquet(paths.ml / "predictions_noct.parquet", index=False)
    with (paths.models / "meta.json").open("w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    log(f"trained in {time.time() - t0:.1f}s")
    return meta


def load_meta(paths: Paths) -> dict:
    with (paths.models / "meta.json").open(encoding="utf-8") as fh:
        return json.load(fh)


def load_booster(paths: Paths, task: str, variant: str = "hybrid") -> lgb.Booster:
    return lgb.Booster(model_file=str(paths.models / f"{task}__{variant}.txt"))


def recompute_operating_points(paths: Paths, log=print) -> dict:
    """Re-select alert thresholds on validation patients with the current alert policy (no retraining)."""
    dp, noct = load_datasets(paths)
    meta = load_meta(paths)
    preds = {"dp": pd.read_parquet(paths.ml / "predictions_dp.parquet"),
             "noct": pd.read_parquet(paths.ml / "predictions_noct.parquet")}
    for task in TASKS:
        full = noct if task == "nocturnal_hypo" else dp
        target = preds["noct"] if task == "nocturnal_hypo" else preds["dp"]
        vmask = (target.split == "val").to_numpy()
        vframe = full[vmask].copy()
        if task != "nocturnal_hypo":
            vframe[task] = vframe[task].where(vframe[f"{task}_elig"] == 1, 0)
        op = choose_threshold(task, vframe, target.loc[vmask, f"{task}__hybrid"].to_numpy(), task)
        meta["tasks"][task]["operating_point"] = op
        log(f"  {task}: threshold {op['threshold']:.3f} ({op['budget']})")
    with (paths.models / "meta.json").open("w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    return meta
