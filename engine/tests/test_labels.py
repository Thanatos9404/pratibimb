"""Label correctness on crafted series."""

from __future__ import annotations

import numpy as np

from pratibimb.ml.labels import episode_onsets, episodes, nocturnal_label, task_labels


def test_episode_needs_three_samples():
    x = np.full(100, 150.0)
    x[10:12] = 260  # 10 min only -> not an episode
    x[40:43] = 260  # 15 min -> episode
    assert list(episode_onsets(x, 250, True)) == [40]
    assert episodes(x, 250, True)[0][:2] == (40, 43)


def test_hyper_and_hypo_windows_and_eligibility():
    g = np.full(200, 150.0)
    g[60:66] = 280.0
    g[150:154] = 60.0
    ks = np.array([30, 36, 40, 60, 140, 137])
    lab = task_labels(g, ks)
    # hyper onset at 60: k=36 (24 samples before) positive, k=30 (30 before) negative
    assert lab["hyper_2h"].tolist()[:3] == [0, 1, 1]
    assert lab["hyper_2h_elig"][3] == 0  # already above 250 at k=60
    # hypo onset at 150 within 12 samples of k=140 but not of k=137
    assert lab["hypo_1h"][4] == 1 and lab["hypo_1h"][5] == 0


def test_nocturnal_label():
    g = np.full(3 * 288, 140.0)
    k_dec = 288 + 270  # 22:30 on day 1
    g[2 * 288 + 24:2 * 288 + 30] = 62.0  # 02:00-02:30 next night
    lab, onset = nocturnal_label(g, k_dec)
    assert lab == 1 and onset == 2 * 288 + 24
    g2 = np.full(3 * 288, 140.0)
    g2[2 * 288 + 90:2 * 288 + 96] = 62.0  # 07:30 -> outside 00:00-06:00
    assert nocturnal_label(g2, k_dec)[0] == 0
