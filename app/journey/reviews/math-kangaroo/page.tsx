import type { Metadata } from "next";

import { MathKangarooReviewClient } from "./MathKangarooReviewClient";
import { assertJourneyReviewReleaseReady } from "./progression-adapter";

export const metadata: Metadata = {
  title: "Math Kangaroo Spatial Review",
  description:
    "Journey-only visual-spatial Math Kangaroo practice with animated explanations.",
};

export default function MathKangarooReviewPage() {
  assertJourneyReviewReleaseReady();
  return <MathKangarooReviewClient />;
}
