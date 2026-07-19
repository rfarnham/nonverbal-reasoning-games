/** Pure guard for opening a read-only campaign history entry. */
export function canOpenHistoricalReview({
  isCampaign,
  isIdle,
  isSolved,
  hasOpenReview,
}: {
  isCampaign: boolean;
  isIdle: boolean;
  isSolved: boolean;
  hasOpenReview: boolean;
}): boolean {
  return isCampaign && isIdle && isSolved && !hasOpenReview;
}
