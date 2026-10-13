"""EnKF: converges on a twin-generated patient; tracks a truth-simulator patient within tolerance."""

from __future__ import annotations

import numpy as np

from pratibimb.observables import load_observed, load_truth, observed_from
from pratibimb.physiology.model import simulate_single
from pratibimb.physiology.params import NX, NZ, P_EGP, PARAM_KEYS, S_G, S_GI, S_TAU, to_internal
from pratibimb.twin.enkf import TwinRun
from pratibimb.twin.inputs import build_filter_inputs, constants


def _synthetic_record(days: int) -> tuple[dict, dict]:
    meals = []
    for d in range(days):
        for hh, c in ((8.5, 50.0), (13.5, 70.0), (21.0, 75.0)):
            meals.append({"t": int(d * 1440 + hh * 60), "slot": "lunch", "carbs_g": c, "gl": 0.6 * c, "gi": 60.0,
                          "fat_g": 10.0, "protein_g": 10.0, "fiber_g": 4.0, "tau_min": 45.0, "items": []})
    rec = {"id": "P9999", "age": 50, "sex": "M", "bmi": 25.0, "weight_kg": 70.0, "diabetes_years": 6.0,
           "genetics": [], "medications": [],
           "ehr": {"tyg": 9.2, "whtr": 0.57, "hba1c": 7.8, "fpg": 150, "egfr": 90, "cpeptide": None},
           "logged": {"meals": meals, "doses": []}}
    n = days * 288
    z = {"cgm": np.full(n, np.nan), "hr": np.full(n, 75.0), "hrv": np.full(n, np.nan), "steps": np.zeros(n),
         "stage": np.zeros(n, dtype=np.int8)}
    return rec, z


def test_enkf_converges_on_twin_generated_patient():
    days = 5
    rec, z = _synthetic_record(days)
    obs = observed_from(rec, z)
    drv, carb, tau = build_filter_inputs(obs)
    c = constants(obs)
    true_params = {"SI": 1.2e-4, "SG": 0.011, "beta": 0.04, "EGP": 2.6, "meal_rate": 1.0, "dawn": 0.25}
    s = np.zeros(NZ)
    s[S_G] = s[S_GI] = 160.0
    s[S_TAU] = 40.0
    for i, k in enumerate(PARAM_KEYS):
        s[NX + i] = to_internal(k, true_params[k])
    n_min = days * 1440
    g = np.zeros(n_min)
    gi = np.zeros(n_min)
    simulate_single(s, drv, carb, tau, 0, n_min, c, g, gi)
    rng = np.random.default_rng(0)
    z["cgm"] = gi[::5] * (1 + rng.normal(0, 0.03, n_min // 5)) + rng.normal(0, 3, n_min // 5)
    run = TwinRun(observed_from(rec, z), 64, seed=3)
    out = run.run()
    g5 = g[::5]
    sl = slice(288, None)
    mard = np.mean(np.abs(out.q[sl, 1] - g5[sl]) / g5[sl])
    assert mard < 0.05
    egp_err_prior = abs(run.prior.mean[P_EGP - NX] - np.log(true_params["EGP"]))
    egp_err_post = abs(out.pmean[-1, P_EGP - NX] - np.log(true_params["EGP"]))
    assert egp_err_post < max(egp_err_prior, 0.25)


def test_enkf_tracks_truth_patient(tiny_paths):
    pid = "P0001"
    obs = load_observed(tiny_paths, pid)
    run = TwinRun(obs, 32, seed=5)
    out = run.run()
    g = load_truth(tiny_paths, pid)[1]["g"].astype(float)
    sl = slice(288, None)
    mard_twin = np.mean(np.abs(out.q[sl, 1] - g[sl]) / g[sl])
    assert mard_twin < 0.15
    # reconstruction from block snapshots is exact
    k = 400
    z_a = run.ensemble_at(k, out.snaps, out.rej)
    z_b = run.ensemble_at(k, out.snaps, out.rej)
    assert np.allclose(z_a, z_b)
    assert abs(np.median(z_a[:, S_G]) - out.q[k, 1]) < 1e-6 * max(1.0, out.q[k, 1]) + 1e-3
