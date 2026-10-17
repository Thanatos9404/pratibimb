"""Unit tests for the real-data adapter's mapping rules (no external data needed)."""

import numpy as np
import pandas as pd

from pratibimb.realdata.adapter import (
    _schedule, ehr_from_row, mets_to_steps_per_min, origin_for, parse_oral, slot_for,
)


def test_parse_oral_maps_glinide_su_and_agi():
    doses, agi, um = parse_oral("Oral: acarbose 50 mg, repaglinide 1 mg")
    assert agi and doses == [("gliclazide", 80.0)] and um == []
    doses, _, _ = parse_oral("Oral: dapagliflozin 10 mg, acarbose 100 mg, gliclazide 120 mg")
    assert ("gliclazide_mr", 120.0) in doses and ("dapagliflozin", 10.0) in doses
    doses, _, _ = parse_oral("Oral: sitagliptinphosphate/metforminhydrochloride tablets 50 mg / 500 mg")
    assert ("metformin", 500.0) in doses and any(d[0] == "sitagliptin" for d in doses)
    doses, _, um = parse_oral("Oral: metformin 0.5 g, liraglutide")
    assert doses == [("metformin", 500.0)] and um == ["liraglutide"]


def test_origin_puts_grid_on_15_min_decision_points():
    t0 = pd.Timestamp("2021-05-20 07:27:00")
    o = origin_for(t0)
    assert o == pd.Timestamp("2021-05-20 00:12:00")
    assert ((t0 - o) / pd.Timedelta(minutes=1)) % 15 == 0


def test_slots_steps_and_ehr_defaults():
    assert slot_for("Breakfast", 600) == "breakfast"
    assert slot_for("snacks", 17 * 60) == "evening_snack"
    assert slot_for(None, 13 * 60) == "lunch"
    assert np.allclose(mets_to_steps_per_min(np.array([1.0, 3.0, 9.0])), [0.0, 105.0, 180.0])
    ehr, rec, imputed = ehr_from_row(pd.Series({"diabetes_status": "T2D", "hba1c_pct": np.nan, "fpg_mgdl": 140.0,
                                                "tg_mgdl": np.nan, "bmi": 30.0, "weight_kg": 80.0, "age": 50,
                                                "sex": "F"}))
    assert {"hba1c", "tg", "diabetes_years", "egfr"} <= set(imputed)
    assert abs(ehr["whtr"] - 0.58) < 1e-6 and rec["diabetes_years"] == 5.0
    times, amt = _schedule(np.array([480.0, 1920.0, 3360.0, 1200.0]), np.array([500.0] * 4), 3)
    assert times == ["08:00"] and amt == 500.0
