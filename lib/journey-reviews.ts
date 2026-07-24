import { discoveredJourneyReviews } from "./generated/journey-review-registry.ts";
import type { JourneyReviewCatalogEntry } from "./journey-review-catalog-types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateReview(
  review: JourneyReviewCatalogEntry,
): JourneyReviewCatalogEntry {
  if (!SLUG.test(review.slug)) {
    throw new Error(`Invalid Journey review slug: ${review.slug}`);
  }
  if (review.href !== `/journey/reviews/${review.slug}/`) {
    throw new Error(`Journey review "${review.slug}" has an invalid route.`);
  }
  if (
    !review.title.trim() ||
    !review.description.trim() ||
    !review.journeyContentVersion.trim() ||
    review.gradeBands.length === 0
  ) {
    throw new Error(`Journey review "${review.slug}" has invalid metadata.`);
  }
  return review;
}

export const journeyReviews = discoveredJourneyReviews.map(validateReview);

export type { JourneyReviewCatalogEntry, JourneyReviewInfo } from "./journey-review-catalog-types";
