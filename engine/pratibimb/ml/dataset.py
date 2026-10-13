"""Assemble the decision-point datasets (features + twin features + truth labels) for all patients."""

from __future__ import annotations

import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import SAMPLES_PER_DAY, Paths
from ..observables import list_patients, load_observed, load_truth
from ..twin.assimilate import NOCT_FEATURES, TWIN_FEATURES
from ..twin.inputs import build_filter_inputs
from .features import compute_features
from .labels import H_HYPER, RUN, nocturnal_label, task_labels

META = ["pid", "split", "k"]


def patient_rows(paths: Paths, pid: str, split: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    obs = load_observed(paths, pid)
    drv, _, _ = build_filter_inputs(obs)
    tw = np.load(paths.twin / f"{pid}.npz")
    _, ts = load_truth(paths, pid)
    g = ts["g"].astype(float)
    dp_k = tw["dp_k"].astype(int)
    dp_feat = tw["dp_feat"]
    n = obs.n
    sel = (dp_k >= SAMPLES_PER_DAY) & (dp_k + H_HYPER + RUN <= n)
    ks = dp_k[sel]
    df = compute_features(obs, ks, drv)
    df[TWIN_FEATURES] = dp_feat[sel]
    for key, val in task_labels(g, ks).items():
        df[key] = val
    for key, val in task_labels(obs.cgm, ks).items():
        if not key.endswith("elig"):
            df[key + "_cgm"] = val
    df.insert(0, "k", ks)
    df.insert(0, "split", split)
    df.insert(0, "pid", pid)

    rows = []
    kmap = {int(k): i for i, k in enumerate(dp_k)}
    nk = tw["noct_k"].astype(int)
    keep = [i for i, k in enumerate(nk) if k >= SAMPLES_PER_DAY and int(k) in kmap]
    if keep:
        kk = nk[keep]
        nf = compute_features(obs, kk, drv)
        nf[TWIN_FEATURES] = dp_feat[[kmap[int(k)] for k in kk]]
        nf[NOCT_FEATURES] = tw["noct_feat"][keep]
        labs = [nocturnal_label(g, int(k)) for k in kk]
        labs_cgm = [nocturnal_label(obs.cgm, int(k))[0] for k in kk]
        nf["nocturnal_hypo"] = [lab[0] for lab in labs]
        nf["noct_onset"] = [lab[1] for lab in labs]
        nf["nocturnal_hypo_cgm"] = labs_cgm
        nf.insert(0, "k", kk)
        nf.insert(0, "split", split)
        nf.insert(0, "pid", pid)
        nf = nf[nf["nocturnal_hypo"] >= 0]
        rows.append(nf)
    noct = pd.concat(rows) if rows else pd.DataFrame()
    return df, noct


def _worker(args: tuple) -> tuple[pd.DataFrame, pd.DataFrame]:
    root, reports, pid, split = args
    return patient_rows(Paths(root=Path(root), reports=Path(reports)), pid, split)


def build_datasets(paths: Paths, workers: int = 6, log=print) -> tuple[pd.DataFrame, pd.DataFrame]:
    t0 = time.time()
    pts = list_patients(paths)
    args = [(str(paths.root), str(paths.reports), p["id"], p["split"]) for p in pts]
    if workers <= 1:
        parts = [_worker(a) for a in args]
    else:
        with Pool(min(workers, 6)) as pool:
            parts = pool.map(_worker, args, chunksize=2)
    dp = pd.concat([p[0] for p in parts], ignore_index=True)
    noct = pd.concat([p[1] for p in parts if len(p[1])], ignore_index=True)
    paths.ml.mkdir(parents=True, exist_ok=True)
    dp.to_parquet(paths.ml / "dp.parquet", index=False)
    noct.to_parquet(paths.ml / "noct.parquet", index=False)
    log(f"datasets: {len(dp)} decision points, {len(noct)} bedtime decisions ({time.time() - t0:.1f}s)")
    return dp, noct


def load_datasets(paths: Paths) -> tuple[pd.DataFrame, pd.DataFrame]:
    return pd.read_parquet(paths.ml / "dp.parquet"), pd.read_parquet(paths.ml / "noct.parquet")
