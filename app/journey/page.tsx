import type { Metadata } from "next";

import { JourneyClient } from "@/components/progression/JourneyClient";

export const metadata: Metadata = {
  title: "Journey",
  description:
    "Follow a four-level path through Spatial Gym's visual reasoning games.",
};

export default function JourneyPage() {
  return <JourneyClient />;
}
