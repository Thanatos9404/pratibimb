from __future__ import annotations

import numpy as np

from pratibimb.ml.parkes import parkes_zones, zone_shares


def test_parkes_type2_zones():
    ref = np.array([100, 200, 300, 20, 300, 120])
    pred = np.array([100, 210, 30, 400, 130, 230])
    z = parkes_zones(ref, pred)
    assert z[0] == "A" and z[1] == "A"
    assert z[2] == "D"
    assert z[3] == "E"
    assert z[4] in ("B", "C")
    assert z[5] in ("B", "C")
    s = zone_shares(ref, pred)
    assert abs(sum(s.values()) - 100) < 0.05  # shares are rounded to 2 decimals
