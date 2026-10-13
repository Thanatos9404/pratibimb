"""Shared fixtures: a tiny end-to-end build (8 patients x 6 days) in a temporary data directory."""

from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def tiny_build(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("pratibimb_data")
    os.environ["PRATIBIMB_DATA"] = str(root)
    os.environ["PRATIBIMB_REPORTS"] = str(root / "reports")
    os.environ["PRATIBIMB_PROFILE"] = "tiny"
    from pratibimb.cli import main

    main(["build", "--profile", "tiny", "--workers", "1", "--no-figures"])
    return root


@pytest.fixture(scope="session")
def tiny_paths(tiny_build):
    from pratibimb.config import get_profile, paths_for

    return paths_for(get_profile("tiny"))


@pytest.fixture(scope="session")
def service(tiny_build):
    from pratibimb.api.service import TwinService, set_service

    svc = TwinService("tiny")
    set_service(svc)
    return svc
