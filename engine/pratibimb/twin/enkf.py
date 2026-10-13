"""Ensemble Kalman Filter wrapper: keeps the twin in sync with the CGM stream.

Augmented state = 7 dynamic states + 6 log/logit parameters with a slow random walk. The filter
runs in 6-hour blocks; each block re-seeds the (numba) RNG from (patient seed, block index), and the
ensemble is stored (float32) at every block boundary. Re-running a block from its snapshot therefore
reproduces the original trajectory exactly, which lets the API reconstruct the ensemble at any time.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..config import STEP_MIN
from ..observables import Observed
from ..physiology.model import (
    F_GATE, F_INFL, F_MAXREJ, F_OBS_ABS, F_OBS_REL, F_QG, F_QI, F_QX, F_RW0, NF, enkf_run,
)
from ..physiology.params import (
    NP, NX, NZ, P_BETA, P_SI, S_D1, S_D2, S_G, S_GI, S_I, S_TAU, S_X, internal_bounds,
)
from .inputs import TWIN_H, build_filter_inputs, constants
from .priors import TwinPrior, ehr_prior

BLOCK = 72  # samples per block (6 h)


def default_filter_config() -> np.ndarray:
    f = np.zeros(NF)
    f[F_QG], f[F_QX], f[F_QI] = 2.5, 2e-4, 1.0
    f[F_RW0:F_RW0 + NP] = [0.012, 0.004, 0.008, 0.006, 0.006, 0.02]
    f[F_OBS_ABS], f[F_OBS_REL] = 5.0, 0.06
    f[F_GATE], f[F_INFL], f[F_MAXREJ] = 4.0, 1.001, 3  # inflation chosen on validation patients
    return f


@dataclass
class FilterOutputs:
    q: np.ndarray  # (n, 3) posterior plasma-glucose p10/p50/p90
    prior: np.ndarray  # (n, 2) one-step prior predictive mean / sd of Gi (incl. obs noise)
    pmean: np.ndarray  # (n, 6) parameter ensemble means (internal coords)
    snaps: np.ndarray  # (n_blocks + 1, m, NZ) float32 ensembles at block boundaries
    rej: np.ndarray  # (n_blocks + 1,) gating counter at block boundaries
    applied: int


class TwinRun:
    """One patient's twin: inputs, prior, filter and ensemble reconstruction."""

    def __init__(self, obs: Observed, m: int, seed: int, fcfg: np.ndarray | None = None) -> None:
        self.obs = obs
        self.m = m
        self.seed = int(seed)
        self.c = constants(obs)
        self.drv, self.carb, self.tau = build_filter_inputs(obs)
        self.prior: TwinPrior = ehr_prior(obs.ehr, obs.record, TWIN_H)
        self.lo, self.hi = internal_bounds()
        self.fcfg = default_filter_config() if fcfg is None else fcfg
        self.n_blocks = int(np.ceil((obs.n - 1) / BLOCK))

    # ------------------------------------------------------------------------------------------
    def block_seed(self, b: int) -> int:
        return int((self.seed * 1_000_003 + b * 7919 + 17) % (2**31 - 1))

    def init_ensemble(self) -> np.ndarray:
        rng = np.random.default_rng([self.seed, 11])
        z = np.zeros((self.m, NZ))
        params = self.prior.mean + self.prior.sd * rng.standard_normal((self.m, NP))
        z[:, NX:] = params
        first = self.obs.cgm[~np.isnan(self.obs.cgm)]
        g0 = float(first[0]) if first.size else float(self.obs.ehr["fpg"])
        z[:, S_G] = g0 + rng.normal(0, 8, self.m)
        z[:, S_GI] = z[:, S_G]
        beta = np.exp(z[:, P_BETA])
        z[:, S_I] = beta * np.maximum(z[:, S_G] - TWIN_H, 0) / self.c[2]
        z[:, S_X] = np.exp(z[:, P_SI]) * z[:, S_I]
        z[:, S_D1] = z[:, S_D2] = 0.0
        z[:, S_TAU] = 40.0
        z = np.clip(z, self.lo, self.hi)
        return z.astype(np.float32).astype(np.float64)

    def _run_block(self, z: np.ndarray, b: int, n_steps: int, rej: np.ndarray, keep_every: int = 0):
        k0 = b * BLOCK
        obs = self.obs.cgm[k0 + 1:k0 + 1 + n_steps]
        m0 = k0 * STEP_MIN
        m1 = m0 + n_steps * STEP_MIN
        out_q = np.zeros((n_steps, 3))
        out_prior = np.zeros((n_steps, 2))
        out_pmean = np.zeros((n_steps, NP))
        n_keep = n_steps // keep_every if keep_every else 0
        out_keep = np.zeros((max(n_keep, 1), self.m, NZ))
        applied = enkf_run(z, np.ascontiguousarray(obs, dtype=np.float64), self.drv[m0:m1], self.carb[m0:m1],
                           self.tau[m0:m1], m0, n_steps, self.c, self.fcfg, self.lo, self.hi, self.block_seed(b),
                           out_q, out_prior, out_pmean, keep_every, out_keep, rej)
        return out_q, out_prior, out_pmean, (out_keep[:n_keep] if keep_every else None), applied

    def run(self, on_block=None, keep_every: int = 3) -> FilterOutputs:
        """Filter the whole record. ``on_block(b, k0, keeps, prior, pmean)`` receives the ensembles at
        samples ``k0 + keep_every * (i + 1)`` plus the running prior/parameter-mean arrays (filled up to
        the end of block ``b``)."""
        n = self.obs.n
        q = np.full((n, 3), np.nan)
        prior = np.full((n, 2), np.nan)
        pmean = np.full((n, NP), np.nan)
        snaps = np.zeros((self.n_blocks + 1, self.m, NZ), dtype=np.float32)
        rejs = np.zeros(self.n_blocks + 1, dtype=np.int64)
        z = self.init_ensemble()
        g = np.sort(z[:, S_G])
        q[0] = [g[int(0.1 * (self.m - 1))], np.median(g), g[int(0.9 * (self.m - 1))]]
        pmean[0] = z[:, NX:].mean(axis=0)
        rej = np.zeros(1, dtype=np.int64)
        applied = 0
        for b in range(self.n_blocks):
            z = z.astype(np.float32).astype(np.float64)
            snaps[b] = z
            rejs[b] = rej[0]
            k0 = b * BLOCK
            n_steps = min(BLOCK, n - 1 - k0)
            oq, op, opm, keeps, app = self._run_block(z, b, n_steps, rej, keep_every)
            applied += app
            q[k0 + 1:k0 + 1 + n_steps] = oq
            prior[k0 + 1:k0 + 1 + n_steps] = op
            pmean[k0 + 1:k0 + 1 + n_steps] = opm
            if on_block is not None:
                on_block(b, k0, keeps, prior, pmean)
        snaps[self.n_blocks] = z
        rejs[self.n_blocks] = rej[0]
        return FilterOutputs(q=q, prior=prior, pmean=pmean, snaps=snaps, rej=rejs, applied=applied)

    def ensemble_at(self, k: int, snaps: np.ndarray, rejs: np.ndarray) -> np.ndarray:
        """Reconstruct the posterior ensemble at sample ``k`` from the stored block snapshots."""
        k = int(np.clip(k, 0, self.obs.n - 1))
        b = min(k // BLOCK, self.n_blocks)
        z = snaps[b].astype(np.float64)
        steps = k - b * BLOCK
        if steps > 0:
            rej = np.array([rejs[b]], dtype=np.int64)
            self._run_block(z, b, steps, rej, 0)
        return z


def gut_glucose(z: np.ndarray) -> np.ndarray:
    return (z[:, S_D1] + z[:, S_D2]) / 1000.0
