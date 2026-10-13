"""Alert logic with hysteresis/cool-down, and event-level alert evaluation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

REARM_FRACTION = 0.7


@dataclass(frozen=True)
class AlertPolicy:
    horizon: int  # samples
    cooldown: int  # samples
    above: bool  # hyper (True) / hypo (False) - suppress while CGM already beyond threshold
    level: float


POLICIES = {
    "hyper_2h": AlertPolicy(horizon=24, cooldown=24, above=True, level=250.0),
    "hypo_1h": AlertPolicy(horizon=12, cooldown=12, above=False, level=70.0),
}


def simulate_alerts(ks: np.ndarray, probs: np.ndarray, cgm_now: np.ndarray, thr: float, pol: AlertPolicy) -> np.ndarray:
    """Return indices (into ``ks``) of issued alerts.

    An alert fires when p >= thr, the alert is armed, the cool-down has elapsed and the CGM is not
    already beyond the event threshold. After firing it disarms until p falls below 0.7 x thr, or until
    twice the cool-down has passed (so a persistently elevated risk re-alerts at most every 2 x cool-down
    instead of going silent).
    """
    fired: list[int] = []
    armed = True
    last = -10**9
    for i in range(ks.shape[0]):
        k, p, c = ks[i], probs[i], cgm_now[i]
        if not armed and (p < REARM_FRACTION * thr or k - last >= 2 * pol.cooldown):
            armed = True
        beyond = (not np.isnan(c)) and ((c > pol.level) if pol.above else (c < pol.level))
        if armed and p >= thr and k - last >= pol.cooldown and not beyond:
            fired.append(i)
            armed = False
            last = k
    return np.array(fired, dtype=int)


def evaluate_patient(ks: np.ndarray, alert_idx: np.ndarray, onsets: np.ndarray, pol: AlertPolicy) -> dict:
    """Alert-level TP/FP and event-level detection with lead times for one patient."""
    a_k = ks[alert_idx] if alert_idx.size else np.zeros(0, dtype=int)
    tp = fp = 0
    for k in a_k:
        nxt = onsets[onsets > k]
        if nxt.size and nxt[0] - k <= pol.horizon:
            tp += 1
        else:
            fp += 1
    kmin, kmax = (int(ks.min()), int(ks.max())) if ks.size else (0, -1)
    ev = onsets[(onsets > kmin + pol.horizon) & (onsets <= kmax)]
    detected = 0
    leads: list[float] = []
    for j in ev:
        cand = a_k[(a_k >= j - pol.horizon) & (a_k < j)]
        if cand.size:
            detected += 1
            leads.append(float((j - cand.min()) * 5))
    return {"tp": tp, "fp": fp, "events": int(ev.size), "detected": detected, "leads": leads,
            "alert_k": a_k.tolist()}


def outcome_for(k: int, onsets: np.ndarray, horizon: int) -> tuple[str, int | None]:
    nxt = onsets[onsets > k]
    if nxt.size and nxt[0] - k <= horizon:
        return "true_positive", int((nxt[0] - k) * 5)
    return "false_positive", None
