"""JSON helpers: strict JSON (NaN/inf -> null) for reports consumed by browsers."""

from __future__ import annotations

import math
from typing import Any


def clean(obj: Any) -> Any:
    """Recursively replace NaN/inf floats with None and numpy scalars with Python scalars."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes)):
        try:
            obj = obj.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj
