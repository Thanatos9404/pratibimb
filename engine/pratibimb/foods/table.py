"""Load the Indian food table and summarise meals for the physiological models.

``carbs_g`` in the table is *available* (glycaemic) carbohydrate per serving; ``gl`` is the
glycaemic load per serving (``carbs_g * gi / 100``).
"""

from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

CSV_PATH = Path(__file__).with_name("indian_foods.csv")


@dataclass(frozen=True)
class Food:
    id: str
    name: str
    name_hi: str
    category: str
    serving_desc: str
    carbs_g: float
    fiber_g: float
    protein_g: float
    fat_g: float
    gi: float
    gl: float
    source: str


@dataclass(frozen=True)
class MealItem:
    food_id: str
    portions: float


@dataclass(frozen=True)
class MealSummary:
    """Aggregate of a meal: carbohydrate, GI-weighted index, load and macronutrients."""

    carbs_g: float
    gl: float
    gi: float
    fiber_g: float
    protein_g: float
    fat_g: float

    @property
    def tau_min(self) -> float:
        """Twin gut time constant (min) for this meal: higher GI -> faster; fat/protein/fibre slow it."""
        return meal_tau(self.gi, self.fat_g, self.protein_g, self.fiber_g)


def meal_tau(gi: float, fat_g: float, protein_g: float, fiber_g: float) -> float:
    """Twin absorption time constant (minutes).

    tau = 40 min for a GI-70 low-fat meal, scaled by (70/GI)^0.6 and lengthened by fat, protein and
    fibre (a mixed-meal heuristic; see MODEL_CARD).
    """
    gi = max(gi, 15.0)
    base = 40.0 * (70.0 / gi) ** 0.6
    slow = 1.0 + 0.006 * fat_g + 0.003 * protein_g + 0.012 * fiber_g
    return float(min(max(base * slow, 18.0), 120.0))


@lru_cache(maxsize=1)
def food_table() -> dict[str, Food]:
    out: dict[str, Food] = {}
    with CSV_PATH.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out[row["id"]] = Food(
                id=row["id"],
                name=row["name"],
                name_hi=row["name_hi"],
                category=row["category"],
                serving_desc=row["serving_desc"],
                carbs_g=float(row["carbs_g"]),
                fiber_g=float(row["fiber_g"]),
                protein_g=float(row["protein_g"]),
                fat_g=float(row["fat_g"]),
                gi=float(row["gi"]),
                gl=float(row["gl"]),
                source=row["source"],
            )
    return out


def get_food(food_id: str) -> Food:
    try:
        return food_table()[food_id]
    except KeyError as exc:
        raise KeyError(f"unknown food_id {food_id!r}") from exc


def foods_as_dicts() -> list[dict]:
    return [asdict(f) for f in food_table().values()]


def summarize_meal(items: list[tuple[str, float]] | list[MealItem]) -> MealSummary:
    """Sum macronutrients over ``(food_id, portions)`` items; GI is carbohydrate-weighted."""
    carbs = gl = fiber = protein = fat = 0.0
    for it in items:
        fid, portions = (it.food_id, it.portions) if isinstance(it, MealItem) else it
        f = get_food(fid)
        carbs += f.carbs_g * portions
        gl += f.gl * portions
        fiber += f.fiber_g * portions
        protein += f.protein_g * portions
        fat += f.fat_g * portions
    gi = 100.0 * gl / carbs if carbs > 1e-9 else 50.0
    return MealSummary(carbs_g=carbs, gl=gl, gi=gi, fiber_g=fiber, protein_g=protein, fat_g=fat)
