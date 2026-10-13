"""FHIR R4 bundle structure (light schema-style checks)."""

from __future__ import annotations

import json
import re

ALLOWED = {"Patient", "Condition", "Observation", "MedicationStatement", "Device"}


def test_bundle_structure(tiny_paths):
    b = json.loads((tiny_paths.fhir / "P0001.json").read_text(encoding="utf-8"))
    assert b["resourceType"] == "Bundle" and b["type"] == "collection"
    urls = {e["fullUrl"] for e in b["entry"]}
    assert all(u.startswith("urn:uuid:") for u in urls)
    types = [e["resource"]["resourceType"] for e in b["entry"]]
    assert set(types) <= ALLOWED and types.count("Patient") == 1
    pat = next(e["resource"] for e in b["entry"] if e["resource"]["resourceType"] == "Patient")
    abha = next(i["value"] for i in pat["identifier"] if "abha" in i["system"])
    assert re.fullmatch(r"91-0000-\d{4}-\d{4}", abha)
    assert pat["gender"] in ("male", "female")
    conds = [e["resource"] for e in b["entry"] if e["resource"]["resourceType"] == "Condition"]
    assert any(c["code"]["coding"][0]["code"] == "44054006" and c["code"]["coding"][0]["system"] ==
               "http://snomed.info/sct" for c in conds)
    obs = [e["resource"] for e in b["entry"] if e["resource"]["resourceType"] == "Observation"]
    codes = {o["code"]["coding"][0]["code"] for o in obs}
    for loinc in ("4548-4", "1558-6", "2571-8", "2085-9", "2160-0", "39156-5", "8280-0", "85354-9"):
        assert loinc in codes, loinc
    for o in obs:
        assert o["status"] == "final"
        assert o["subject"]["reference"] in urls
        if "valueQuantity" in o:
            assert isinstance(o["valueQuantity"]["value"], (int, float))
        else:
            assert o["component"]
    meds = [e["resource"] for e in b["entry"] if e["resource"]["resourceType"] == "MedicationStatement"]
    assert meds and all(m["dosage"][0]["timing"]["repeat"]["timeOfDay"] for m in meds)
