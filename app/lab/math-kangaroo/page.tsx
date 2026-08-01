import type { Metadata } from "next";

import { assertJourneyReviewReleaseReady } from "@/app/journey/reviews/math-kangaroo/progression-adapter";
import { MathKangarooLabClient } from "./MathKangarooLabClient";

export const metadata: Metadata = {
  title: "Math Kangaroo Lab",
  description:
    "Random, answer-key-verified Math Kangaroo spatial questions filtered by grade, point value, and question type.",
};

export default function MathKangarooLabPage() {
  assertJourneyReviewReleaseReady();
  return <MathKangarooLabClient />;
}
