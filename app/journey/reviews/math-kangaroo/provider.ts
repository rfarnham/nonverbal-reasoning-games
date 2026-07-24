import type { JourneyReviewInfo } from "@/lib/journey-review-catalog-types";

export const reviewInfo = {
  title: "Math Kangaroo Spatial Review",
  description:
    "Carefully selected visual-spatial Math Kangaroo problems with animated explanations.",
  journeyContentVersion: "mk-spatial-cyprus-2026.1",
  gradeBands: ["grades-1-2", "grades-3-4"],
} as const satisfies JourneyReviewInfo;
