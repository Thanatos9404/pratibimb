"""HL7 FHIR R4 export (Bundle type ``collection``) for a synthetic patient.

Codes used: SNOMED CT for conditions, LOINC for labs/vitals and a few wearable summaries
(8867-4 heart rate, 41950-7 steps in 24 h, 93832-4 sleep duration). CGM/HRV summaries for which we
are not certain of a standard code use a local, clearly-labelled code system. The ABHA identifier is
synthetic and uses a local system URI so it can never be mistaken for a real ABHA.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from ..config import DATASET_START
from .ehr import LAB_DEFS, LOINC

LOCAL_CS = "urn:pratibimb:codesystem:wearable-summary"
ABHA_SYSTEM = "urn:pratibimb:synthetic-abha"
UCUM = "http://unitsofmeasure.org"


def _uid(pid: str, *parts: object) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "pratibimb/" + pid + "/" + "/".join(map(str, parts))))


def _entry(resource: dict) -> dict:
    return {"fullUrl": f"urn:uuid:{resource['id']}", "resource": resource}


def build_bundle(record: dict, wearable_summary: dict) -> dict:
    """Build a FHIR R4 collection Bundle from a patient record (see :mod:`generate`)."""
    pid = record["id"]
    pat_id = _uid(pid, "patient")
    subject = {"reference": f"urn:uuid:{pat_id}"}
    birth_year = DATASET_START.year - record["age"]
    patient = {
        "resourceType": "Patient", "id": pat_id,
        "meta": {"tag": [{"system": "urn:pratibimb:tags", "code": "synthetic", "display": "Synthetic data"}]},
        "identifier": [{"type": {"text": "ABHA number (synthetic)"}, "system": ABHA_SYSTEM, "value": record["abha"]},
                       {"system": "urn:pratibimb:patient-id", "value": pid}],
        "name": [{"use": "official", "family": record["family"], "given": [record["given"]]}],
        "gender": "female" if record["sex"] == "F" else "male",
        "birthDate": f"{birth_year}",
        "address": [{"country": "IN", "text": f"{record['region']} India (synthetic)"}],
    }
    entries = [_entry(patient)]
    for i, c in enumerate(record["conditions"]):
        res = {"resourceType": "Condition", "id": _uid(pid, "cond", i),
               "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                                              "code": "active"}]},
               "code": {"coding": [{"system": c["system"], "code": c["code"], "display": c["display"]}],
                        "text": c["display"]},
               "subject": subject}
        if c.get("onset"):
            res["onsetDateTime"] = c["onset"]
        entries.append(_entry(res))
    by_loinc = {v[1]: k for k, v in LAB_DEFS.items()}
    bp: dict[str, dict] = {}
    for i, lab in enumerate(record["labs"]):
        key = by_loinc.get(lab["loinc"])
        if key in ("sbp", "dbp"):
            bp.setdefault(lab["date"], {})[key] = lab["value"]
            continue
        cat = "vital-signs" if key in ("bmi", "waist", "weight", "height") else "laboratory"
        entries.append(_entry({
            "resourceType": "Observation", "id": _uid(pid, "lab", i), "status": "final",
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                      "code": cat}]}],
            "code": {"coding": [{"system": LOINC, "code": lab["loinc"], "display": lab["name"]}], "text": lab["name"]},
            "subject": subject, "effectiveDateTime": lab["date"],
            "valueQuantity": {"value": lab["value"], "unit": lab["unit"], "system": UCUM, "code": lab["unit"]},
        }))
    for date, v in bp.items():
        comps = []
        for key, code, name in (("sbp", "8480-6", "Systolic blood pressure"), ("dbp", "8462-4", "Diastolic blood pressure")):
            if key in v:
                comps.append({"code": {"coding": [{"system": LOINC, "code": code, "display": name}]},
                              "valueQuantity": {"value": v[key], "unit": "mm[Hg]", "system": UCUM, "code": "mm[Hg]"}})
        entries.append(_entry({
            "resourceType": "Observation", "id": _uid(pid, "bp", date), "status": "final",
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                      "code": "vital-signs"}]}],
            "code": {"coding": [{"system": LOINC, "code": "85354-9", "display": "Blood pressure panel"}]},
            "subject": subject, "effectiveDateTime": date, "component": comps}))
    for i, m in enumerate(record["medications"]):
        entries.append(_entry({
            "resourceType": "MedicationStatement", "id": _uid(pid, "med", i), "status": "active",
            "medicationCodeableConcept": {"text": f"{m['name']} {m['dose']}"},
            "subject": subject,
            "dosage": [{"text": f"{m['dose']} at {', '.join(m['times'])}",
                        "timing": {"repeat": {"frequency": m["per_day"], "period": 1, "periodUnit": "d",
                                              "timeOfDay": [f"{t}:00" for t in m["times"]]}}}],
            "note": [{"text": m["drug_class"]}],
        }))
    dev_ids = []
    for kind, name in (("cgm", "Continuous glucose monitor (synthetic, 14-day sensor)"),
                       ("wrist", "Wrist wearable: HR, HRV, steps, sleep (synthetic)")):
        did = _uid(pid, "device", kind)
        dev_ids.append(did)
        entries.append(_entry({"resourceType": "Device", "id": did, "status": "active",
                               "deviceName": [{"name": name, "type": "user-friendly-name"}],
                               "patient": subject}))
    start = DATASET_START.isoformat()
    end = (DATASET_START + timedelta(days=wearable_summary["days"])).isoformat()
    period = {"start": start, "end": end}

    def summary_obs(key: str, coding: dict, value: float, unit: str, device: str) -> None:
        entries.append(_entry({
            "resourceType": "Observation", "id": _uid(pid, "wear", key), "status": "final",
            "code": {"coding": [coding], "text": coding["display"]}, "subject": subject,
            "effectivePeriod": period, "device": {"reference": f"urn:uuid:{device}"},
            "valueQuantity": {"value": value, "unit": unit, "system": UCUM, "code": unit},
        }))

    ws = wearable_summary
    summary_obs("hr", {"system": LOINC, "code": "8867-4", "display": "Heart rate (mean resting)"},
                ws["resting_hr"], "/min", dev_ids[1])
    summary_obs("steps", {"system": LOINC, "code": "41950-7", "display": "Number of steps in 24 hour (mean)"},
                ws["steps_per_day"], "/d", dev_ids[1])
    summary_obs("sleep", {"system": LOINC, "code": "93832-4", "display": "Sleep duration (mean)"},
                ws["sleep_hours"], "h", dev_ids[1])
    summary_obs("hrv", {"system": LOCAL_CS, "code": "rmssd-night-mean", "display": "HRV RMSSD, nightly mean"},
                ws["rmssd_night"], "ms", dev_ids[1])
    summary_obs("cgm_mean", {"system": LOCAL_CS, "code": "cgm-mean", "display": "CGM mean glucose"},
                ws["cgm_mean"], "mg/dL", dev_ids[0])
    summary_obs("cgm_tir", {"system": LOCAL_CS, "code": "cgm-tir-70-180", "display": "CGM time in range 70-180 mg/dL"},
                ws["cgm_tir"], "%", dev_ids[0])
    return {"resourceType": "Bundle", "id": _uid(pid, "bundle"), "type": "collection",
            "timestamp": DATASET_START.isoformat(), "entry": entries}
