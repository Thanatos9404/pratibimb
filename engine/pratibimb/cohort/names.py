"""Synthetic Indian names and obviously-synthetic ABHA numbers.

Names are common given names/surnames combined at random; any resemblance to a real person is
coincidental. ABHA numbers use the reserved-looking prefix ``91-0000-`` and are not valid ABHA IDs.
"""

from __future__ import annotations

import numpy as np

GIVEN_F = [
    "Asha", "Priya", "Sunita", "Kavita", "Meena", "Lakshmi", "Anjali", "Rekha", "Pooja", "Geeta",
    "Shalini", "Deepa", "Nirmala", "Savitri", "Usha", "Radha", "Sangeeta", "Neha", "Aarti", "Padma",
    "Revathi", "Kamala", "Farida", "Nasreen", "Manpreet", "Gurpreet", "Rupa", "Mitali", "Swati", "Vandana",
]
GIVEN_M = [
    "Rajesh", "Suresh", "Ramesh", "Anil", "Vijay", "Arun", "Sanjay", "Manoj", "Ravi", "Prakash",
    "Mahesh", "Dinesh", "Venkatesh", "Srinivas", "Ashok", "Rakesh", "Mohan", "Gopal", "Imran", "Salim",
    "Harpreet", "Jaswant", "Subhash", "Debashish", "Kiran", "Naveen", "Sunil", "Ajay", "Murali", "Ganesh",
]
SURNAMES = {
    "North": ["Sharma", "Verma", "Gupta", "Singh", "Agarwal", "Malhotra", "Chauhan", "Yadav", "Khan", "Saxena"],
    "South": ["Iyer", "Reddy", "Nair", "Pillai", "Rao", "Menon", "Krishnan", "Subramanian", "Naidu", "Shetty"],
    "West": ["Patel", "Shah", "Desai", "Joshi", "Kulkarni", "Patil", "Mehta", "Deshpande", "Pawar", "Jain"],
    "East": ["Das", "Banerjee", "Chatterjee", "Mukherjee", "Bose", "Ghosh", "Sen", "Mohanty", "Sahu", "Roy"],
}


def synthetic_name(rng: np.random.Generator, sex: str, region: str) -> tuple[str, str]:
    given = rng.choice(GIVEN_F if sex == "F" else GIVEN_M)
    family = rng.choice(SURNAMES[region])
    return str(given), str(family)


def synthetic_abha(index: int, rng: np.random.Generator) -> str:
    """14-digit ABHA-formatted number ``91-0000-XXXX-XXXX`` (synthetic, not a valid ABHA)."""
    a = int(rng.integers(0, 10_000))
    return f"91-0000-{index:04d}-{a:04d}"
