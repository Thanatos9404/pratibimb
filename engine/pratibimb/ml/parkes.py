"""Parkes (Consensus) Error Grid for Type 2 diabetes (mg/dL).

Zone polygons follow the coordinates used by the R package ``ega`` (getParkesZones, type 2), which
implements Parkes et al., Diabetes Care 2000 with the technical description of Pfuetzner et al.,
J Diabetes Sci Technol 2013. x = reference glucose, y = predicted/measured glucose.
"""

from __future__ import annotations

import numpy as np

_MAX = 1000.0


def _coef(x: float, y: float, xe: float, ye: float) -> float:
    return (ye - y) / (xe - x)


def _endy(sx: float, sy: float, mx: float, c: float) -> float:
    return (mx - sx) * c + sy


def _endx(sx: float, sy: float, my: float, c: float) -> float:
    return (my - sy) / c + sx


def _polygons() -> list[tuple[str, np.ndarray]]:
    mx = my = _MAX
    ce = _coef(35, 200, 50, 550)
    cdu = _coef(35, 90, 125, 550)
    cdl = _coef(410, 110, 550, 160)
    ccu = _coef(30, 60, 280, 550)
    ccl = _coef(260, 130, 550, 250)
    cbu = _coef(230, 330, 440, 550)
    cbl = _coef(330, 230, 550, 450)
    polys = [
        ("B", [(50, 0), (50, 30), (90, 80), (330, 230), (mx, _endy(330, 230, mx, cbl)), (mx, 0), (50, 0)]),
        ("B", [(0, 50), (30, 50), (230, 330), (_endx(230, 330, my, cbu), my), (0, my), (0, 50)]),
        ("C", [(90, 0), (260, 130), (mx, _endy(260, 130, mx, ccl)), (mx, 0), (90, 0)]),
        ("C", [(0, 60), (30, 60), (_endx(30, 60, my, ccu), my), (0, my), (0, 60)]),
        ("D", [(250, 0), (250, 40), (410, 110), (mx, _endy(410, 110, mx, cdl)), (mx, 0), (250, 0)]),
        ("D", [(0, 80), (25, 80), (35, 90), (_endx(35, 90, my, cdu), my), (0, my), (0, 80)]),
        ("E", [(0, 200), (35, 200), (_endx(35, 200, my, ce), my), (0, my), (0, 200)]),
    ]
    return [(z, np.array(p, dtype=float)) for z, p in polys]


_POLYS = _polygons()


def _inside(px: np.ndarray, py: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Vectorised even-odd ray casting."""
    inside = np.zeros(px.shape[0], dtype=bool)
    x0, y0 = poly[:-1, 0], poly[:-1, 1]
    x1, y1 = poly[1:, 0], poly[1:, 1]
    for a, b, c, d in zip(x0, y0, x1, y1, strict=True):
        cond = (b > py) != (d > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (c - a) * (py - b) / (d - b) + a
        inside ^= cond & (px < xint)
    return inside


def parkes_zones(reference: np.ndarray, predicted: np.ndarray) -> np.ndarray:
    """Zone letter per point (A..E); later polygons override earlier ones as in ``ega``."""
    ref = np.clip(np.asarray(reference, dtype=float), 0, _MAX - 1)
    pred = np.clip(np.asarray(predicted, dtype=float), 0, _MAX - 1)
    zones = np.full(ref.shape[0], "A", dtype="<U1")
    for z, poly in _POLYS:
        zones[_inside(ref, pred, poly)] = z
    return zones


def zone_shares(reference: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    z = parkes_zones(reference, predicted)
    n = max(z.shape[0], 1)
    return {k: round(100.0 * float((z == k).sum()) / n, 2) for k in "ABCDE"}
