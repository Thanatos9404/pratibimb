"""Global configuration: run profiles, paths, clock and seeds.

Everything time-related inside the engine is expressed in *integer minutes since the dataset start*
(``t = 0`` is the dataset start at 00:00 IST). Observations live on a 5-minute grid (index ``k`` ->
minute ``5 k``); the physiological models integrate on a 1-minute grid.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30), name="IST")

STEP_MIN = 5  # observation step (minutes)
SAMPLES_PER_DAY = 1440 // STEP_MIN  # 288
DP_EVERY_MIN = 15  # ML decision-point spacing
FORECAST_HORIZON_MIN = 240  # API forecast horizon
FEATURE_HORIZON_MIN = 120  # forecast horizon used for twin features
DATASET_START = datetime(2026, 9, 21, 0, 0, tzinfo=IST)  # a Monday
DEMO_NOW_HOUR = 19.5  # 19:30 IST

ENGINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = ENGINE_DIR.parent


@dataclass(frozen=True)
class Profile:
    """A run profile (cohort size, duration and assimilation density)."""

    name: str
    n_patients: int
    days: int
    ensemble_size: int = 64
    seed: int = 20261020
    demo_patients: int = 24

    @property
    def n_samples(self) -> int:
        return self.days * SAMPLES_PER_DAY

    @property
    def n_minutes(self) -> int:
        return self.days * 1440

    @property
    def now_minute(self) -> int:
        """Default demo clock: ``days - 7`` days after start at 19:30 (start + 21 d for 28-day runs);
        very short CI profiles use ``days - 2``."""
        back = 7 if self.days >= 14 else 2
        return (self.days - back) * 1440 + int(DEMO_NOW_HOUR * 60)


PROFILES: dict[str, Profile] = {
    "full": Profile("full", n_patients=240, days=28),
    "small": Profile("small", n_patients=40, days=14, demo_patients=12),
    "tiny": Profile("tiny", n_patients=8, days=6, ensemble_size=32, demo_patients=4),
}


@dataclass(frozen=True)
class Paths:
    """Filesystem layout for one profile."""

    root: Path
    reports: Path = field(default=REPO_DIR / "reports")

    @property
    def cohort(self) -> Path:
        return self.root / "cohort"

    @property
    def patients(self) -> Path:
        return self.root / "cohort" / "patients"

    @property
    def fhir(self) -> Path:
        return self.root / "cohort" / "fhir"

    @property
    def twin(self) -> Path:
        return self.root / "twin"

    @property
    def ml(self) -> Path:
        return self.root / "ml"

    @property
    def models(self) -> Path:
        return self.root / "ml" / "models"

    @property
    def figures(self) -> Path:
        return self.reports / "figures"

    def ensure(self) -> None:
        for p in (self.patients, self.fhir, self.twin, self.models, self.figures):
            p.mkdir(parents=True, exist_ok=True)


def data_root() -> Path:
    """Root data directory (override with ``PRATIBIMB_DATA``)."""
    return Path(os.environ.get("PRATIBIMB_DATA", REPO_DIR / "data"))


def paths_for(profile: Profile, reports: Path | None = None) -> Paths:
    """Paths for a profile. The ``full`` profile writes reports to ``<repo>/reports``; other profiles
    write to ``data/<profile>/reports`` so headline reports are never overwritten by CI runs."""
    root = data_root() / profile.name
    if reports is None:
        env = os.environ.get("PRATIBIMB_REPORTS")
        if env:
            reports = Path(env)
        elif profile.name == "full":
            reports = REPO_DIR / "reports"
        else:
            reports = root / "reports"
    return Paths(root=root, reports=reports)


def get_profile(name: str) -> Profile:
    try:
        return PROFILES[name]
    except KeyError as exc:  # pragma: no cover - CLI guards this
        raise ValueError(f"unknown profile {name!r}; choose from {sorted(PROFILES)}") from exc
