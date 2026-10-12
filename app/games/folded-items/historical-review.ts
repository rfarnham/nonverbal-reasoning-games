export function canOpenHistoricalReview({
  isIdle,
  isSolved,
  isReviewOpen,
}: Readonly<{
  isIdle: boolean;
  isSolved: boolean;
  isReviewOpen: boolean;
}>): boolean {
  return isIdle && isSolved && !isReviewOpen;
}
