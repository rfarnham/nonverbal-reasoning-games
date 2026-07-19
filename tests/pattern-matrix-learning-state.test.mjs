import assert from "node:assert/strict";
import test from "node:test";

import {
  canOpenHistoricalReview,
  discoveredPartIdsAfterLesson,
  hintRoundIdsAfterMiss,
  lessonPartIdsForMoment,
  ruleLessonMomentForDifficulty,
  unseenLessonPartIds,
} from "../app/games/pattern-matrix/learning-state.ts";
import { CAMPAIGN_ROUNDS } from "../app/games/pattern-matrix/campaign-data.ts";
import { rulePartIds } from "../app/games/pattern-matrix/rule-engine.ts";

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

test("Starter and Junior introduce rules before play while Expert and Wizard discover them after solving", () => {
  assert.equal(ruleLessonMomentForDifficulty("Easy"), "introduction");
  assert.equal(ruleLessonMomentForDifficulty("Medium"), "introduction");
  assert.equal(ruleLessonMomentForDifficulty("Hard"), "discovery");
  assert.equal(ruleLessonMomentForDifficulty("Wizard"), "discovery");

  const encounteredPartIds = [
    "combine:join",
    "change:rotate-clockwise",
  ];
  assert.deepEqual(
    lessonPartIdsForMoment({
      difficulty: "Easy",
      moment: "introduction",
      discoveredPartIds: [],
      pendingPartIds: [],
      encounteredPartIds,
    }),
    encounteredPartIds,
  );
  assert.deepEqual(
    lessonPartIdsForMoment({
      difficulty: "Easy",
      moment: "discovery",
      discoveredPartIds: [],
      pendingPartIds: [],
      encounteredPartIds,
    }),
    [],
  );
  assert.deepEqual(
    lessonPartIdsForMoment({
      difficulty: "Hard",
      moment: "introduction",
      discoveredPartIds: [],
      pendingPartIds: [],
      encounteredPartIds,
    }),
    [],
  );
  assert.deepEqual(
    lessonPartIdsForMoment({
      difficulty: "Wizard",
      moment: "discovery",
      discoveredPartIds: ["combine:join"],
      pendingPartIds: [],
      encounteredPartIds,
    }),
    ["change:rotate-clockwise"],
  );
});

test("the authored curriculum introduces each rule part at the intended round and none first appear in Wizard", () => {
  const firstRoundByPart = new Map();
  for (const round of CAMPAIGN_ROUNDS) {
    for (const partId of rulePartIds(round.rule)) {
      if (!firstRoundByPart.has(partId)) {
        firstRoundByPart.set(partId, round.id);
      }
    }
  }

  assert.deepEqual([...firstRoundByPart], [
    ["combine:join", "campaign-easy-1"],
    ["combine:overlap", "campaign-easy-4"],
    ["combine:cancel", "campaign-easy-7"],
    ["combine:left-minus-right", "campaign-easy-10"],
    ["combine:right-minus-left", "campaign-medium-1"],
    ["change:rotate-clockwise", "campaign-medium-4"],
    ["change:grow", "campaign-medium-7"],
    ["change:columns", "campaign-medium-10"],
    ["combine:match", "campaign-hard-1"],
    ["combine:neither", "campaign-hard-3"],
    ["change:rotate-half", "campaign-hard-6"],
    ["change:rotate-counterclockwise", "campaign-hard-7"],
    ["change:shape-cycle", "campaign-hard-10"],
    ["change:grid-cascade", "campaign-hard-11"],
  ]);

  for (const [partId, roundId] of firstRoundByPart) {
    const round = CAMPAIGN_ROUNDS.find(({ id }) => id === roundId);
    assert.ok(round, `${partId} needs an authored first round`);
    assert.notEqual(round.difficulty, "Wizard", `${partId} starts too late`);
    assert.equal(
      ruleLessonMomentForDifficulty(round.difficulty),
      round.difficulty === "Easy" || round.difficulty === "Medium"
        ? "introduction"
        : "discovery",
    );
  }
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
