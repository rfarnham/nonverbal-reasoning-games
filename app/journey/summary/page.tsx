import type { Metadata } from "next";

import { JourneySummaryClient } from "@/components/progression/JourneySummaryClient";

export const metadata: Metadata = {
  title: "Journey result",
  description: "Review a completed Spatial Gym Journey stop.",
};

export default function JourneySummaryPage() {
  return <JourneySummaryClient />;
}
