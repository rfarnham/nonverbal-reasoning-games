import type { JourneyReviewGradeBand } from "./progression/types";

export type JourneyReviewInfo = Readonly<{
  title: string;
  description: string;
  journeyContentVersion: string;
  gradeBands: readonly JourneyReviewGradeBand[];
}>;

export type JourneyReviewCatalogEntry = JourneyReviewInfo &
  Readonly<{
    slug: string;
    href: `/journey/reviews/${string}/`;
    role: "review";
  }>;
