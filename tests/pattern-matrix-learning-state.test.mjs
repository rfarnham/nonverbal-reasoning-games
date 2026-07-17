import assert from "node:assert/strict";
import test from "node:test";

import {
  canOpenHistoricalReview,
  discoveredPartIdsAfterLesson,
  hintRoundIdsAfterMiss,
  unseenLessonPartIds,
} from "../app/games/pattern-matrix/learning-state.ts";

test("the shipped hint transition unlocks Expert once and never unlocks Wizard", () => {
  const initial = [];
  const expertUnlocked = hintRoundIdsAfterMiss(
    initial,
    "campaign-expert-0",
    "after-miss",
  );

  assert.deepEqual(expertUnlocked, ["campaign-expert-0"]);
  assert.strictEqual(
    hintRoundIdsAfterMiss(
      expertUnlocked,
      "campaign-expert-0",
      "after-miss",
    ),
    expertUnlocked,
  );
  assert.strictEqual(
    hintRoundIdsAfterMiss(
      expertUnlocked,
      "campaign-wizard-0",
      "never",
    ),
    expertUnlocked,
  );
  assert.strictEqual(
    hintRoundIdsAfterMiss(
      expertUnlocked,
      "campaign-starter-0",
      "always",
    ),
    expertUnlocked,
  );
});

test("the shipped lesson transition deduplicates and discovers only on close", () => {
  const additions = unseenLessonPartIds(
    [],
    [],
    [
      "combine:join",
      "change:rotate-clockwise",
      "combine:join",
      "change:columns",
    ],
  );

  assert.deepEqual(additions, [
    "combine:join",
    "change:rotate-clockwise",
    "change:columns",
  ]);
  assert.deepEqual(
    unseenLessonPartIds(
      ["combine:join"],
      ["change:rotate-clockwise"],
      [
        "combine:join",
        "change:columns",
        "combine:cancel",
        "combine:cancel",
      ],
    ),
    ["change:columns", "combine:cancel"],
  );

  const discovered = discoveredPartIdsAfterLesson(
    [],
    "combine:join",
  );
  assert.deepEqual(discovered, ["combine:join"]);
  assert.strictEqual(
    discoveredPartIdsAfterLesson(discovered, "combine:join"),
    discovered,
  );
});

test("the shipped historical-review guard is pure and requires solved idle state", () => {
  const state = {
    isIdle: true,
    isSolved: true,
    hasPendingLessons: false,
  };
  const serializedBefore = JSON.stringify(state);

  assert.equal(canOpenHistoricalReview(state), true);
  assert.equal(
    canOpenHistoricalReview({ ...state, isIdle: false }),
    false,
  );
  assert.equal(
    canOpenHistoricalReview({ ...state, isSolved: false }),
    false,
  );
  assert.equal(
    canOpenHistoricalReview({
      ...state,
      hasPendingLessons: true,
    }),
    false,
  );
  assert.equal(JSON.stringify(state), serializedBefore);
});
