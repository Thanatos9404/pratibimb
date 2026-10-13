export type DrugClass = "sulfonylurea" | "insulin" | "sglt2" | "dpp4" | "metformin" | "other";

export const DRUG_CLASS_LABEL: Record<DrugClass, string> = {
  sulfonylurea: "Sulfonylurea",
  insulin: "Insulin",
  sglt2: "SGLT2 inhibitor",
  dpp4: "DPP-4 inhibitor",
  metformin: "Metformin",
  other: "Other",
};

export function classOf(med: string): DrugClass {
  const m = med.toLowerCase();
  if (/glimepiride|gliclazide|glibenclamide|glipizide|glyburide|sulfonylurea/.test(m)) return "sulfonylurea";
  if (/insulin|glargine|degludec|detemir|nph/.test(m)) return "insulin";
  if (/gliflozin|sglt2/.test(m)) return "sglt2";
  if (/gliptin|dpp-?4/.test(m)) return "dpp4";
  if (/metformin|biguanide/.test(m)) return "metformin";
  return "other";
}

export function classesOf(meds: string[]): Set<DrugClass> {
  return new Set(meds.map(classOf));
}

/** "Glimepiride 2 mg OD" -> "Glimepiride" */
export function drugName(med: string): string {
  return med.replace(/\s+\d.*$/, "").trim();
}
