import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CAMPAIGN_ROUND_SPECS } from "../app/games/shape-fold/campaign-data.ts";
import { canOpenHistoricalReview } from "../app/games/shape-fold/historical-review.ts";
import {
  ROUNDS,
  TUTORIAL,
  PuzzleGenerationError,
  applyFolds,
  buildRounds,
  describePattern,
  generateInfiniteRound,
  hiddenDirectionCandidates,
  patternDifference,
  patternKey,
  patternsEqual,
  roundFingerprint,
  unfoldPunch,
  unfoldStages,
  validateRound,
} from "../app/games/shape-fold/game-engine.ts";

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Wizard"];
const FOLD_COUNTS = {
  Easy: 1,
  Medium: 2,
  Hard: 3,
  Wizard: 3,
};

function roundsAt(difficulty) {
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

test("the reviewed Campaign source is a frozen 48-round corpus", () => {
  assert.equal(CAMPAIGN_ROUND_SPECS.length, 48);
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(CAMPAIGN_ROUND_SPECS))
      .digest("hex"),
    "8bc38623786990abe7314d736010d26b6fcad0d9fecf7ea0d119ad7a8a3d3a0e",
  );
  for (const spec of CAMPAIGN_ROUND_SPECS) {
    assert.ok(!("foldSteps" in spec));
    assert.ok(!("foldedBounds" in spec));
    assert.ok(!("correctPattern" in spec));
  }
});

test("the authored campaign contains 12 rounds at every level", () => {
  assert.equal(ROUNDS.length, 48);
  for (const difficulty of DIFFICULTIES) {
    assert.equal(roundsAt(difficulty).length, 12);
  }
});

test("campaign answer positions are balanced without exploitable sequences", () => {
  for (const difficulty of DIFFICULTIES) {
    const positions = roundsAt(difficulty).map(
      ({ correctIndex }) => correctIndex,
    );
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
    );
    assert.ok(
      positions.every(
        (position, index) => index === 0 || positions[index - 1] !== position,
      ),
    );
    assert.notDeepEqual(positions.slice(0, 4), positions.slice(4, 8));
    assert.notDeepEqual(positions.slice(4, 8), positions.slice(8, 12));
  }
});

test("authored rounds calculate one exact answer with distinct close options", () => {
  for (const round of ROUNDS) {
    assert.deepEqual(validateRound(round), []);
    assert.equal(new Set(round.options.map(patternKey)).size, 4);
    const calculated = unfoldPunch(round.folds, round.punch);
    assert.ok(patternsEqual(calculated, round.correctPattern));
    assert.equal(
      round.options.filter((option) => patternsEqual(option, calculated))
        .length,
      1,
    );
    assert.equal(2 ** round.folds.length, round.correctPattern.length);
    assert.ok(
      round.options.some((option, optionIndex) => {
        if (optionIndex === round.correctIndex) return false;
        const difference = patternDifference(option, calculated);
        return difference.missing.length === 1 && difference.extra.length === 1;
      }),
    );
  }
});

test("authored fingerprints stay unique across all 48 puzzles", () => {
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, ROUNDS.length);
});

test("difficulty comes from reasoning depth rather than added clutter", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const round of roundsAt(difficulty)) {
      assert.equal(round.folds.length, FOLD_COUNTS[difficulty]);
      assert.equal(round.correctPattern.length, 2 ** FOLD_COUNTS[difficulty]);
      if (difficulty === "Hard" || difficulty === "Wizard") {
        const axes = new Set(
          round.folds.map((direction) =>
            direction === "left" || direction === "right"
              ? "vertical"
              : "horizontal",
          ),
        );
        assert.equal(axes.size, 2);
      }
    }
  }
});

test("Wizard matches Expert complexity and hides only an inferable cue", () => {
  for (const round of roundsAt("Wizard")) {
    assert.equal(round.folds.length, 3);
    assert.equal(round.correctPattern.length, 8);
    assert.ok(Number.isInteger(round.hiddenFoldIndex));
    assert.deepEqual(hiddenDirectionCandidates(round), [
      round.folds[round.hiddenFoldIndex],
    ]);
  }
  for (const round of roundsAt("Hard")) {
    assert.equal(round.folds.length, 3);
    assert.equal(round.correctPattern.length, 8);
    assert.equal(round.hiddenFoldIndex, undefined);
  }
});

test("fold stacks and reverse unfolding preserve every original cell", () => {
  const examples = [
    ["left"],
    ["right", "up"],
    ["left", "down", "right"],
  ];
  for (const folds of examples) {
    const state = applyFolds(folds);
    assert.equal(state.layers.length, 64 / 2 ** folds.length);
    assert.ok(
      state.layers.every(
        ({ originals }) => originals.length === 2 ** folds.length,
      ),
    );
    assert.equal(
      state.layers.reduce((total, layer) => total + layer.originals.length, 0),
      64,
    );
  }
});

test("known folds open to independently checkable coordinates", () => {
  assert.deepEqual(unfoldPunch(["left"], { x: 4, y: 2 }), [
    { x: 3, y: 2 },
    { x: 4, y: 2 },
  ]);
  assert.deepEqual(unfoldPunch(["left", "up"], { x: 4, y: 4 }), [
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 3, y: 4 },
    { x: 4, y: 4 },
  ]);

  const state = applyFolds(["left", "up"]);
  const punchedLayer = state.layers.find(
    ({ position }) => position.x === 4 && position.y === 4,
  );
  assert.deepEqual(punchedLayer.originals, [
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 3, y: 4 },
    { x: 4, y: 4 },
  ]);
});

test("validation rejects corrupted prompt geometry and option semantics", () => {
  const round = ROUNDS[0];
  const otherRound = ROUNDS[1];
  assert.match(
    validateRound({ ...round, foldSteps: otherRound.foldSteps }).join("; "),
    /fold step snapshots/,
  );
  assert.match(
    validateRound({
      ...round,
      foldedBounds: { x: 0, y: 0, width: 8, height: 8 },
    }).join("; "),
    /folded bounds/,
  );
  assert.match(
    validateRound({ ...round, punch: { x: -1, y: 2 } }).join("; "),
    /punch must be an integer cell inside/,
  );
  assert.match(
    validateRound({
      ...round,
      optionKinds: ["correct", "correct", "near-miss", "wrong-punch"],
    }).join("; "),
    /only the exact answer/,
  );
  assert.match(
    validateRound({
      ...round,
      correctPattern: [{ x: 99, y: 99 }],
    }).join("; "),
    /integer cells on the paper/,
  );
});

test("unfold stages double the visible openings at every honest reverse fold", () => {
  for (const round of ROUNDS) {
    const stages = unfoldStages(round.folds, round.punch);
    assert.equal(stages.length, round.folds.length + 1);
    stages.forEach((stage, index) => {
      assert.equal(stage.length, 2 ** index);
    });
    assert.ok(patternsEqual(stages.at(-1), round.correctPattern));
  }
});

test("1,600 seeded generated rounds satisfy all invariants and level bounds", () => {
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 0; seed < 400; seed += 1) {
      const round = generateInfiniteRound(difficulty, seed);
      assert.deepEqual(validateRound(round), []);
      assert.equal(round.folds.length, FOLD_COUNTS[difficulty]);
      assert.equal(new Set(round.options.map(patternKey)).size, 4);
      assert.equal(
        round.options.filter((option) =>
          patternsEqual(option, round.correctPattern),
        ).length,
        1,
      );
    }
  }
});

test("seeded corpora cover every fold direction at every difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    const directions = new Set();
    for (let seed = 0; seed < 400; seed += 1) {
      for (const direction of generateInfiniteRound(difficulty, seed).folds) {
        directions.add(direction);
      }
    }
    assert.deepEqual(
      [...directions].sort(),
      ["down", "left", "right", "up"],
    );
  }
});

test("the generator is reproducible from the same seed", () => {
  for (const difficulty of DIFFICULTIES) {
    const first = generateInfiniteRound(difficulty, 91_337);
    const second = generateInfiniteRound(difficulty, 91_337);
    assert.deepEqual(first, second);
  }
});

test("infinite generation rejects fingerprints already seen in the session", () => {
  for (const difficulty of DIFFICULTIES) {
    const first = generateInfiniteRound(difficulty, 4_242);
    const seen = new Set([roundFingerprint(first)]);
    const next = generateInfiniteRound(difficulty, 4_242, seen);
    assert.notEqual(roundFingerprint(next), roundFingerprint(first));
  }
});

test("a long Infinite session remains unique until its recoverable boundary", () => {
  const seen = new Set();
  for (let ordinal = 0; ordinal < 96; ordinal += 1) {
    const round = generateInfiniteRound(
      "Easy",
      10_007 + ordinal * 97,
      seen,
    );
    const fingerprint = roundFingerprint(round);
    assert.ok(!seen.has(fingerprint));
    seen.add(fingerprint);
  }
  assert.equal(seen.size, 96);
});

test("fingerprints ignore answer ordering", () => {
  const round = ROUNDS[17];
  const reversed = {
    ...round,
    options: [...round.options].reverse(),
    optionKinds: [...round.optionKinds].reverse(),
    correctIndex: round.options.length - 1 - round.correctIndex,
  };
  assert.equal(roundFingerprint(round), roundFingerprint(reversed));
});

test("hostile random sources fail at a clear bounded error", () => {
  assert.throws(
    () => generateInfiniteRound("Easy", () => Number.NaN),
    PuzzleGenerationError,
  );
  assert.throws(
    () => generateInfiniteRound("Wizard", () => 1),
    PuzzleGenerationError,
  );
  assert.doesNotThrow(() => generateInfiniteRound("Easy", () => 0));

  let calls = 0;
  const repeated = generateInfiniteRound("Easy", () => 0);
  assert.throws(
    () =>
      generateInfiniteRound(
        "Easy",
        () => {
          calls += 1;
          return 0;
        },
        new Set([roundFingerprint(repeated)]),
      ),
    PuzzleGenerationError,
  );
  assert.ok(calls > 0 && calls < 1_000);
});

test("authored rounds build without consulting ambient randomness", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("ambient randomness was consulted");
  };
  try {
    const firstBuild = buildRounds();
    const secondBuild = buildRounds();
    assert.deepEqual(firstBuild, ROUNDS);
    assert.deepEqual(secondBuild, firstBuild);
    assert.notStrictEqual(secondBuild, firstBuild);
  } finally {
    Math.random = originalRandom;
  }
});

test("the solved example pairs a valid answer with a one-opening near-match", () => {
  assert.deepEqual(validateRound(TUTORIAL), []);
  assert.ok(patternsEqual(TUTORIAL.answer, TUTORIAL.correctPattern));
  const difference = patternDifference(
    TUTORIAL.nearMiss,
    TUTORIAL.correctPattern,
  );
  assert.equal(difference.missing.length, 1);
  assert.equal(difference.extra.length, 1);
});

test("accessible answer descriptions preserve each visual arrangement", () => {
  for (const round of ROUNDS) {
    const descriptions = round.options.map(describePattern);
    assert.equal(new Set(descriptions).size, 4);
    for (const description of descriptions) {
      assert.match(description, /row \d, column \d/);
    }
  }
});

test("historical review opens only for a solved idle Campaign problem", () => {
  const eligible = {
    isIdle: true,
    isSolved: true,
    isReviewOpen: false,
  };
  assert.equal(canOpenHistoricalReview(eligible), true);
  assert.equal(
    canOpenHistoricalReview({ ...eligible, isIdle: false }),
    false,
  );
  assert.equal(
    canOpenHistoricalReview({ ...eligible, isSolved: false }),
    false,
  );
  assert.equal(
    canOpenHistoricalReview({ ...eligible, isReviewOpen: true }),
    false,
  );
});
