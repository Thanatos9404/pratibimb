"""No feature leakage: features at decision time t are unchanged when data after t is perturbed."""

from __future__ import annotations

import copy
import json

import numpy as np

from pratibimb.ml.features import compute_features
from pratibimb.observables import observed_from
from pratibimb.twin.assimilate import twin_features
from pratibimb.twin.enkf import TwinRun
from pratibimb.twin.forecast import HabitPrior
from pratibimb.twin.inputs import build_filter_inputs


def _load(paths, pid):
    rec = json.loads((paths.patients / f"{pid}.json").read_text(encoding="utf-8"))
    rec.pop("truth")
    z = dict(np.load(paths.patients / f"{pid}.npz"))
    return rec, z


def _perturb_future(rec, z, k):
    rec2 = copy.deepcopy(rec)
    z2 = {key: v.copy() for key, v in z.items()}
    rng = np.random.default_rng(1)
    t = k * 5
    z2["cgm"][k + 1:] = np.clip(z2["cgm"][k + 1:] + rng.normal(0, 40, z2["cgm"][k + 1:].shape), 40, 400)
    z2["hr"][k + 1:] += 15
    z2["hrv"][k + 1:] = 5
    z2["steps"][k + 1:] = 900
    z2["stage"][k + 1:] = 2
    for m in rec2["logged"]["meals"]:
        if m["t"] > t:
            m["carbs_g"] *= 3
    rec2["logged"]["meals"].append({**rec2["logged"]["meals"][0], "t": t + 10})
    for d in rec2["logged"]["doses"]:
        if d["t"] > t:
            d["taken"] = not d["taken"]
    return rec2, z2


def test_features_unchanged_by_future_data(tiny_paths):
    rec, z = _load(tiny_paths, "P0002")
    k = 288 + 230
    ks = np.array([288, 300, 400, 450, k])
    a = observed_from(rec, z)
    rec2, z2 = _perturb_future(rec, z, k)
    b = observed_from(rec2, z2)
    fa = compute_features(a, ks, build_filter_inputs(a)[0])
    fb = compute_features(b, ks, build_filter_inputs(b)[0])
    assert np.allclose(fa.to_numpy(), fb.to_numpy(), equal_nan=True)


def test_twin_features_unchanged_by_future_data(tiny_paths):
    rec, z = _load(tiny_paths, "P0003")
    k = 288 + 216  # on the 15-min grid and a block boundary + 0
    outs = []
    for r, zz in ((rec, z), _perturb_future(rec, z, k)):
        obs = observed_from(r, zz)
        run = TwinRun(obs, 16, seed=9)
        prior = HabitPrior(run)
        got = {}

        def cb(b, k0, keeps, prior_arr, pmean, run=run, prior=prior, got=got):
            for i in range(keeps.shape[0]):
                kk = k0 + 3 * (i + 1)
                if kk == k:
                    got["f"] = twin_features(run, prior, keeps[i], kk, prior_arr[:, 0], pmean)

        run.run(on_block=cb)
        outs.append(got["f"])
    assert np.allclose(outs[0], outs[1], equal_nan=True)
