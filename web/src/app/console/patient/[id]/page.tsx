import type { Metadata } from "next";

import { PatientView } from "@/components/console/patient/patient-view";

export const metadata: Metadata = { title: "Virtual patient" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PatientView id={decodeURIComponent(id)} />;
}
