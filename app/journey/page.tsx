import type { Metadata } from "next";

import { JourneyClient } from "@/components/progression/JourneyClient";

export const metadata: Metadata = {
  title: "Journey",
  description:
    "Follow a seven-board path through Spatial Gym games and visual-spatial review.",
};

export default function JourneyPage() {
  return <JourneyClient />;
}
