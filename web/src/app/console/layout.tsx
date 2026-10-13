import type { Metadata } from "next";

import { ConsoleShell } from "@/components/console/console-shell";

export const metadata: Metadata = {
  title: { default: "Clinician console", template: "%s · Pratibimb console" },
  description: "Cohort triage and virtual-patient views for the Pratibimb Type 2 Diabetes digital twin. Synthetic data.",
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
