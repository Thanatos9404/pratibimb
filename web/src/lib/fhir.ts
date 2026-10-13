import type { FhirBundle, PatientDetail } from "@/lib/api/types";

/**
 * Builds a minimal FHIR R4 `collection` Bundle from a PatientDetail record.
 * Used (a) by the dev mock generator and (b) as a clearly-labelled client-side
 * fallback when the static demo export carries no FHIR file. The engine's own
 * `/api/patients/{id}/fhir` output is always preferred.
 */
export function bundleFromPatient(p: PatientDetail): FhirBundle {
  const pid = `Patient/${p.id}`;
  const entries: { fullUrl: string; resource: { resourceType: string; [k: string]: unknown } }[] = [];

  entries.push({
    fullUrl: `urn:uuid:patient-${p.id}`,
    resource: {
      resourceType: "Patient",
      id: p.id,
      meta: { tag: [{ system: "urn:pratibimb", code: "synthetic", display: "Synthetic record" }] },
      identifier: [{ system: "https://healthid.ndhm.gov.in", value: p.abha, type: { text: "ABHA number (synthetic)" } }],
      name: [{ text: p.display_name }],
      gender: p.sex === "F" ? "female" : "male",
      extension: [{ url: "urn:pratibimb:age-years", valueInteger: p.age }],
      address: [{ text: p.region, country: "IN" }],
    },
  });

  p.conditions.forEach((c, i) => {
    entries.push({
      fullUrl: `urn:uuid:condition-${p.id}-${i}`,
      resource: {
        resourceType: "Condition",
        subject: { reference: pid },
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        code: { coding: [{ system: c.system, code: c.code, display: c.display }], text: c.display },
        ...(c.onset ? { onsetDateTime: c.onset } : {}),
      },
    });
  });

  p.labs.forEach((l, i) => {
    entries.push({
      fullUrl: `urn:uuid:obs-${p.id}-${i}`,
      resource: {
        resourceType: "Observation",
        status: "final",
        subject: { reference: pid },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: l.loinc, display: l.name }], text: l.name },
        effectiveDateTime: l.date,
        valueQuantity: { value: l.value, unit: l.unit, system: "http://unitsofmeasure.org" },
        referenceRange: [{ text: l.ref }],
      },
    });
  });

  p.medications.forEach((m, i) => {
    entries.push({
      fullUrl: `urn:uuid:med-${p.id}-${i}`,
      resource: {
        resourceType: "MedicationStatement",
        status: "active",
        subject: { reference: pid },
        medicationCodeableConcept: { text: m.name },
        dosage: [{ text: `${m.dose} at ${m.times.join(", ")}`, timing: { repeat: { timeOfDay: m.times.map((t) => `${t}:00`) } } }],
        note: [{ text: m.drug_class }],
      },
    });
  });

  entries.push({
    fullUrl: `urn:uuid:device-${p.id}`,
    resource: {
      resourceType: "Device",
      status: "active",
      deviceName: [{ name: "Continuous glucose monitor (simulated)", type: "user-friendly-name" }],
      patient: { reference: pid },
    },
  });

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: p.twin.updated_at,
    entry: entries,
  };
}
