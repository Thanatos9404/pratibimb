"""Time helpers: minutes-since-start <-> ISO-8601 strings in IST (+05:30)."""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from .config import DATASET_START, IST


def iso(minute: float, start: datetime = DATASET_START) -> str:
    """ISO-8601 string with +05:30 offset for a minute offset from ``start``."""
    dt = start + timedelta(minutes=float(minute))
    return dt.astimezone(IST).isoformat(timespec="seconds")


def iso_many(minutes: np.ndarray, start: datetime = DATASET_START) -> list[str]:
    return [iso(m, start) for m in np.asarray(minutes).tolist()]


def parse_iso(text: str, start: datetime = DATASET_START) -> float:
    """Parse an ISO string (any offset; naive strings are treated as IST) into minutes since start."""
    t = text.strip().replace("Z", "+00:00").replace(" ", "+")
    dt = datetime.fromisoformat(t)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return (dt - start).total_seconds() / 60.0


def clock_hour(minute: np.ndarray | float) -> np.ndarray | float:
    """Clock hour of day in IST (0..24) for a minute offset (start is midnight)."""
    return (np.asarray(minute) % 1440) / 60.0


def day_index(minute: np.ndarray | float) -> np.ndarray | int:
    return np.asarray(minute) // 1440


def hhmm(minute_of_day: float) -> str:
    m = int(round(minute_of_day)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def weekday(minute: float, start: datetime = DATASET_START) -> int:
    """0 = Monday."""
    return (start + timedelta(minutes=float(minute))).weekday()
