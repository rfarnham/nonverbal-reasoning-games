import assert from "node:assert/strict";
import test from "node:test";

import { canOpenHistoricalReview } from "../app/games/braids/campaign-review.ts";

test("historical review opens only for a solved, idle campaign marker", () => {
  const state = {
    isCampaign: true,
    isIdle: true,
    isSolved: true,
    hasOpenReview: false,
  };
  const serializedBefore = JSON.stringify(state);

  assert.equal(canOpenHistoricalReview(state), true);
  assert.equal(
    canOpenHistoricalReview({ ...state, isCampaign: false }),
    false,
  );
  assert.equal(canOpenHistoricalReview({ ...state, isIdle: false }), false);
  assert.equal(canOpenHistoricalReview({ ...state, isSolved: false }), false);
  assert.equal(
    canOpenHistoricalReview({ ...state, hasOpenReview: true }),
    false,
  );
  assert.equal(JSON.stringify(state), serializedBefore);
});
