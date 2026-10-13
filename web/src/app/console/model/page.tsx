import type { Metadata } from "next";

import { ModelView } from "@/components/console/model/model-view";

export const metadata: Metadata = { title: "Model card" };

export default function ModelPage() {
  return <ModelView />;
}
