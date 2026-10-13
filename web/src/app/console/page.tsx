import type { Metadata } from "next";

import { CohortView } from "@/components/console/cohort/cohort-view";

export const metadata: Metadata = { title: "Cohort triage" };

export default function ConsolePage() {
  return <CohortView />;
}
