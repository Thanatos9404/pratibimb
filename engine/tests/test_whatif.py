"""What-if monotonic sanity checks."""

from __future__ import annotations


def _meal(off, fid, portions):
    return [{"offset_min": off, "items": [{"food_id": fid, "portions": portions}]}]


def test_walk_does_not_raise_peak(service):
    pid = service.ids[0]
    base_meal = _meal(30, "white_rice", 2.0)
    r = service.whatif(pid, {"horizon_min": 300, "baseline_meals": base_meal,
                             "scenario": {"walk": {"offset_min": 50, "duration_min": 20, "intensity": "brisk"}}},
                       service.default_now)
    assert r["metrics"]["scenario"]["peak"] <= r["metrics"]["baseline"]["peak"] + 0.5


def test_removing_carbs_lowers_peak(service):
    pid = service.ids[1]
    r = service.whatif(pid, {"horizon_min": 300, "baseline_meals": _meal(30, "white_rice", 2.0),
                             "scenario": {"meals": _meal(30, "white_rice", 0.5), "replace_planned_meals": True}},
                       service.default_now)
    assert r["metrics"]["scenario"]["peak"] < r["metrics"]["baseline"]["peak"]


def test_lower_gi_swap_lowers_peak(service):
    pid = service.ids[2]
    r = service.whatif(pid, {"horizon_min": 300, "baseline_meals": _meal(30, "white_rice", 1.5),
                             "scenario": {"meals": _meal(30, "bajra_roti", 2.0), "replace_planned_meals": True}},
                       service.default_now)
    assert r["metrics"]["scenario"]["peak"] <= r["metrics"]["baseline"]["peak"]


def test_short_sleep_does_not_lower_glucose(service):
    pid = service.ids[0]
    r = service.whatif(pid, {"horizon_min": 300, "scenario": {"sleep_hours_last_night": 4.0}}, service.default_now)
    assert r["metrics"]["scenario"]["peak"] >= r["metrics"]["baseline"]["peak"] - 0.5


def test_presets_run(service):
    pid = service.ids[0]
    presets = service.presets(pid, service.default_now)
    assert {"swap-rice-for-millet-roti", "walk-15-after-dinner", "short-sleep"} <= set(presets)
    for p in presets.values():
        out = service.whatif(pid, p["request"], service.default_now)
        assert out["narrative"]
