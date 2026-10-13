"""Run the twin over every patient: EnKF sync + per-decision-point ensemble forecasts (twin features).

Outputs ``data/<profile>/twin/<id>.npz``:

* ``q`` (n, 3) posterior plasma-glucose band p10/p50/p90 (ensemble spread combined with a 6 % sensor
  calibration term, see :func:`report_band`), ``prior`` (n, 2) one-step-ahead predictive mean/sd,
  ``pmean`` (n, 6) parameter means, ``snaps``/``rej`` block snapshots for exact reconstruction;
* ``dp_k`` + ``dp_feat`` twin features at every 15-minute decision point (forecast to +120 min);
* ``noct_k`` + ``noct_feat`` overnight forecast features at each bedtime decision.

Only observable data are used here; truth is never read.
"""

from __future__ import annotations

import json
import time
from multiprocessing import Pool

import numpy as np

from ..config import DP_EVERY_MIN, FEATURE_HORIZON_MIN, SAMPLES_PER_DAY, STEP_MIN, Paths, Profile
from ..observables import bedtime_decisions, list_patients, load_observed
from ..physiology.params import NX, P_BETA, P_EGP, P_SI, PARAM_KEYS, S_D1, S_D2, S_G, S_GI, S_I, S_X, to_natural
from .enkf import BLOCK, TwinRun
from .forecast import HabitPrior, ensemble_forecast, forecast_seed, run_exceed

DP_STEP = DP_EVERY_MIN // STEP_MIN  # 3 samples
H_COLS = FEATURE_HORIZON_MIN // STEP_MIN  # 24
SENSOR_REL_SD = 0.06

TWIN_FEATURES = [
    "tw_g", "tw_g_sd", "tw_gi", "tw_x", "tw_ins", "tw_gut",
    "fc30_p10", "fc30_p50", "fc30_p90", "fc60_p10", "fc60_p50", "fc60_p90", "fc120_p10", "fc120_p50", "fc120_p90",
    "fc_max120_p50", "fc_min60_p10", "fc_min120_p50", "p_hyper120", "p_hypo60", "p_hypo120",
    "tw_si", "tw_sg", "tw_beta", "tw_egp", "tw_taus", "tw_dawn", "tw_si_d24", "tw_beta_d24", "tw_egp_d24",
    "tw_si_vs_prior", "tw_innov30", "tw_innov_abs60",
]
NOCT_FEATURES = ["p_noct", "noct_min_p50", "noct_min_p10", "noct_mean_p50"]


def patient_seed(profile_seed: int, pid: str) -> int:
    return int((profile_seed * 2_654_435_761 + int(pid[1:]) * 97_531) % (2**31 - 1))


def report_band(q: np.ndarray) -> np.ndarray:
    """Widen the ensemble p10-p90 by an uncorrelated 6 % sensor-calibration term."""
    p50 = q[:, 1]
    half_ens = (q[:, 2] - q[:, 0]) / 2.0
    sd = np.sqrt((half_ens / 1.2816) ** 2 + (SENSOR_REL_SD * p50) ** 2)
    return np.stack([p50 - 1.2816 * sd, p50, p50 + 1.2816 * sd], axis=1)


def _innovations(obs_cgm: np.ndarray, prior_mean: np.ndarray, k: int, n: int) -> tuple[float, float]:
    a = max(1, k - n + 1)
    d = obs_cgm[a:k + 1] - prior_mean[a:k + 1]
    d = d[~np.isnan(d)]
    return (float(d.mean()) if d.size else 0.0), (float(np.abs(d).mean()) if d.size else 0.0)


def twin_features(run: TwinRun, prior: HabitPrior, z: np.ndarray, k: int, q_prior: np.ndarray,
                  pmean: np.ndarray) -> np.ndarray:
    traj = ensemble_forecast(run, z, k, FEATURE_HORIZON_MIN, prior, forecast_seed(run, k))
    qs = np.quantile(traj[:, [6, 12, 24]], [0.1, 0.5, 0.9], axis=0)
    p50 = np.median(traj, axis=0)
    g = z[:, S_G]
    k24 = max(k - SAMPLES_PER_DAY, 0)
    pm_now = z[:, NX:].mean(axis=0)
    pm_24 = pmean[k24] if not np.isnan(pmean[k24]).any() else pm_now
    innov, innov_abs = _innovations(run.obs.cgm, q_prior, k, 6)
    _, innov_abs60 = _innovations(run.obs.cgm, q_prior, k, 12)
    return np.array([
        g.mean(), g.std(), z[:, S_GI].mean(), z[:, S_X].mean(), z[:, S_I].mean(),
        (z[:, S_D1] + z[:, S_D2]).mean() / 1000.0,
        qs[0, 0], qs[1, 0], qs[2, 0], qs[0, 1], qs[1, 1], qs[2, 1], qs[0, 2], qs[1, 2], qs[2, 2],
        p50[1:].max(), np.quantile(traj[:, 1:13].min(axis=1), 0.1), p50[1:].min(),
        run_exceed(traj[:, 1:], 250.0, True).mean(), run_exceed(traj[:, 1:13], 70.0, False).mean(),
        run_exceed(traj[:, 1:], 70.0, False).mean(),
        *pm_now, pm_now[P_SI - NX] - pm_24[P_SI - NX], pm_now[P_BETA - NX] - pm_24[P_BETA - NX],
        pm_now[P_EGP - NX] - pm_24[P_EGP - NX], pm_now[P_SI - NX] - run.prior.mean[0], innov, innov_abs60,
    ], dtype=np.float32)


def nocturnal_features(run: TwinRun, z: np.ndarray, k: int) -> np.ndarray:
    t = k * STEP_MIN
    midnight = (t // 1440 + 1) * 1440
    end = midnight + 6 * 60
    n_min = int(end - t)
    traj = ensemble_forecast(run, z, k, n_min, None, forecast_seed(run, k, salt=7), use_prior=False)
    c0 = int((midnight - t) // STEP_MIN)
    night = traj[:, c0:]
    p50 = np.median(night, axis=0)
    return np.array([run_exceed(night, 70.0, False).mean(), p50.min(), np.quantile(night.min(axis=1), 0.1),
                     p50.mean()], dtype=np.float32)


def assimilate_patient(paths: Paths, pid: str, m: int, profile_seed: int, now_k: int) -> dict:
    obs = load_observed(paths, pid)
    run = TwinRun(obs, m, patient_seed(profile_seed, pid))
    prior = HabitPrior(run)
    dp_k: list[int] = []
    dp_feat: list[np.ndarray] = []
    noct_ks = bedtime_decisions(obs.stage, obs.days)
    noct_set = {int(k): d for d, k in enumerate(noct_ks) if k >= 0}
    noct_rows: list[tuple[int, np.ndarray]] = []

    def on_block(b: int, k0: int, keeps: np.ndarray, prior_arr: np.ndarray, pmean: np.ndarray) -> None:
        for i in range(keeps.shape[0]):
            k = k0 + DP_STEP * (i + 1)
            z = keeps[i]
            dp_k.append(k)
            dp_feat.append(twin_features(run, prior, z, k, prior_arr[:, 0], pmean))
            if k in noct_set:
                noct_rows.append((k, nocturnal_features(run, z, k)))

    out = run.run(on_block=on_block, keep_every=DP_STEP)
    np.savez_compressed(
        paths.twin / f"{pid}.npz",
        q=report_band(out.q).astype(np.float32), q_ens=out.q.astype(np.float32), prior=out.prior.astype(np.float32),
        pmean=out.pmean.astype(np.float32), snaps=out.snaps, rej=out.rej,
        dp_k=np.array(dp_k, dtype=np.int32), dp_feat=np.array(dp_feat, dtype=np.float32),
        noct_k=np.array([r[0] for r in noct_rows], dtype=np.int32),
        noct_feat=np.array([r[1] for r in noct_rows], dtype=np.float32).reshape(-1, len(NOCT_FEATURES)),
    )
    z_now = run.ensemble_at(now_k, out.snaps, out.rej)
    params_now = {}
    for i, key in enumerate(PARAM_KEYS):
        v = np.asarray(to_natural(key, z_now[:, NX + i]))
        if key == "meal_rate":
            v = 1.0 / v
        params_now[key] = [float(v.mean()), float(np.quantile(v, 0.1)), float(np.quantile(v, 0.9))]
    return {"id": pid, "params_now": params_now, "applied_updates": int(out.applied),
            "prior": {k: float(v) for k, v in run.prior.natural().items()}}


def _worker(args: tuple) -> dict:
    root, reports, pid, m, seed, now_k = args
    from pathlib import Path

    return assimilate_patient(Paths(root=Path(root), reports=Path(reports)), pid, m, seed, now_k)


def assimilate_cohort(profile: Profile, paths: Paths, workers: int = 6, log=print) -> dict:
    paths.ensure()
    t0 = time.time()
    pts = list_patients(paths)
    now_k = profile.now_minute // STEP_MIN
    args = [(str(paths.root), str(paths.reports), p["id"], profile.ensemble_size, profile.seed, now_k) for p in pts]
    workers = max(1, min(workers, 6))
    if workers == 1:
        rows = [_worker(a) for a in args]
    else:
        with Pool(workers) as pool:
            rows = list(pool.imap_unordered(_worker, args, chunksize=1))
    rows.sort(key=lambda r: r["id"])
    summary = {"profile": profile.name, "now_k": now_k, "block": BLOCK, "patients": rows,
               "twin_features": TWIN_FEATURES, "noct_features": NOCT_FEATURES,
               "elapsed_s": round(time.time() - t0, 1)}
    with (paths.twin / "summary.json").open("w", encoding="utf-8") as fh:
        json.dump(summary, fh)
    log(f"assimilated {len(rows)} patients in {time.time() - t0:.1f}s")
    return summary
