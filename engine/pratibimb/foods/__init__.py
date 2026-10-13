"""Indian food table (composition + glycaemic index) and meal aggregation helpers."""

from .table import Food, MealItem, MealSummary, food_table, foods_as_dicts, get_food, summarize_meal

__all__ = ["Food", "MealItem", "MealSummary", "food_table", "foods_as_dicts", "get_food", "summarize_meal"]
