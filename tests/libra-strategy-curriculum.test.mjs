import assert from "node:assert/strict";
import test from "node:test";

import {
  BALANCE_TOKENS,
  ROUNDS,
  SOLUTION_STRATEGIES,
  generateInfiniteRoundFromSeed,
} from "../app/games/libra/game-engine.ts";
import {
  STRATEGY_CATALOGUE,
  STRATEGY_CATALOGUE_BY_ID,
  STRATEGY_IDS,
  STRATEGY_SECTIONS,
  buildSolutionProof,
  canOpenHistoricalReview,
  canIntroduceStrategiesBeforeRound,
  discoveredStrategyIdsAfterLesson,
  orderedStrategyIdsForRound,
  preRoundStrategyIds,
  unseenStrategyIds,
} from "../app/games/libra/strategy-curriculum.ts";

test("the strategy catalogue is complete, sectioned, and curriculum ordered", () => {
  assert.deepEqual(STRATEGY_IDS, [
    "split-evenly",
    "cancel-matches",
    "substitution",
    "create-combo",
    "add-scales",
    "subtract-scales",
  ]);
  assert.deepEqual(
    STRATEGY_CATALOGUE.map(({ id }) => id),
    STRATEGY_IDS,
  );
  assert.deepEqual(
    STRATEGY_SECTIONS.map(({ id }) => id),
    ["foundation", "solve-plans"],
  );
  assert.deepEqual(
    SOLUTION_STRATEGIES.filter(
      (id) => STRATEGY_CATALOGUE_BY_ID[id] === undefined,
    ),
    [],
  );
  assert.equal(
    new Set(STRATEGY_CATALOGUE.map(({ id }) => id)).size,
    STRATEGY_IDS.length,
  );

  for (const entry of STRATEGY_CATALOGUE) {
    assert.equal(STRATEGY_CATALOGUE_BY_ID[entry.id], entry);
    assert.ok(entry.name.length > 0);
    assert.ok(entry.shortName.length > 0);
    assert.ok(entry.symbol.length > 0);
    assert.ok(entry.description.length > 0);
    assert.ok(
      STRATEGY_SECTIONS.some(({ id }) => id === entry.section),
    );
  }
});

test("the authored curriculum introduces one plan at a time in teaching order", () => {
  let discovered = [];
  const introductions = [];

  for (const [index, round] of ROUNDS.entries()) {
    const additions = unseenStrategyIds(
      discovered,
      [],
      orderedStrategyIdsForRound(round),
    );
    if (additions.length > 0) {
      introductions.push({
        ordinal: index + 1,
        ids: additions,
      });
    }
    for (const id of additions) {
      discovered = discoveredStrategyIdsAfterLesson(discovered, id);
    }
  }

  assert.deepEqual(introductions.slice(0, 6), [
    { ordinal: 1, ids: ["split-evenly"] },
    { ordinal: 4, ids: ["cancel-matches"] },
    { ordinal: 13, ids: ["substitution"] },
    { ordinal: 20, ids: ["create-combo"] },
    { ordinal: 23, ids: ["add-scales"] },
    { ordinal: 24, ids: ["subtract-scales"] },
  ]);
  assert.deepEqual(discovered, STRATEGY_IDS);
});

test("Wizard plans are discoverable after solving but never introduced before a round", () => {
  for (const round of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  )) {
    assert.ok(orderedStrategyIdsForRound(round).length > 0);
    assert.equal(canIntroduceStrategiesBeforeRound(round), false);
    assert.deepEqual(preRoundStrategyIds(round), []);
  }

  const junior = ROUNDS.find(
    ({ difficulty }) => difficulty === "Junior",
  );
  assert.equal(canIntroduceStrategiesBeforeRound(junior), true);
  assert.deepEqual(
    preRoundStrategyIds(junior),
    orderedStrategyIdsForRound(junior),
  );
});

test("lesson queues deduplicate and discovery happens only on close", () => {
  const additions = unseenStrategyIds(
    ["split-evenly"],
    ["cancel-matches"],
    [
      "split-evenly",
      "substitution",
      "create-combo",
      "substitution",
      "add-scales",
      "create-combo",
    ],
  );
  assert.deepEqual(additions, [
    "substitution",
    "create-combo",
    "add-scales",
  ]);

  const beforeClose = ["split-evenly"];
  assert.deepEqual(beforeClose, ["split-evenly"]);
  const afterClose = discoveredStrategyIdsAfterLesson(
    beforeClose,
    "cancel-matches",
  );
  assert.deepEqual(afterClose, ["split-evenly", "cancel-matches"]);
  assert.strictEqual(
    discoveredStrategyIdsAfterLesson(afterClose, "cancel-matches"),
    afterClose,
  );
});

test("historical review opens only from a solved idle marker", () => {
  assert.equal(
    canOpenHistoricalReview({
      isIdle: true,
      isSolved: true,
      hasPendingLessons: false,
      isReplayingLesson: false,
    }),
    true,
  );

  for (const blockedState of [
    { isIdle: false },
    { isSolved: false },
    { hasPendingLessons: true },
    { isReplayingLesson: true },
  ]) {
    assert.equal(
      canOpenHistoricalReview({
        isIdle: true,
        isSolved: true,
        hasPendingLessons: false,
        isReplayingLesson: false,
        ...blockedState,
      }),
      false,
    );
  }
});

function counts(expression) {
  return Object.fromEntries(
    BALANCE_TOKENS.map((token) => [
      token,
      expression
        .filter(({ creature }) => creature === token)
        .reduce((total, { count }) => total + count, 0),
    ]),
  );
}

function scaledCounts(expression, multiplier) {
  return Object.fromEntries(
    BALANCE_TOKENS.map((token) => [
      token,
      counts(expression)[token] * multiplier,
    ]),
  );
}

function assertProofCertificate(round, label) {
  const proof = buildSolutionProof(round);
  const factor = round.solutionDerivation.normalizeBy;

  assert.deepEqual(
    counts(proof.reducedEquation.left),
    scaledCounts(round.question.target, factor),
    `${label}: reduced target side`,
  );
  assert.deepEqual(
    counts(proof.reducedEquation.right),
    {
      ...Object.fromEntries(BALANCE_TOKENS.map((token) => [token, 0])),
      [round.question.unit]: factor * round.answer,
    },
    `${label}: reduced answer side`,
  );
  assert.deepEqual(proof.regroup, {
    factor,
    targetBundle: round.question.target,
    rightBundle: [
      {
        creature: round.question.unit,
        count: round.answer,
      },
    ],
  });
  assert.deepEqual(proof.finalEquation, {
    left: round.question.target,
    right: [
      {
        creature: round.question.unit,
        count: round.answer,
      },
    ],
  });
  assert.equal(
    proof.equationUses.length,
    round.solutionDerivation.equationMultipliers.filter(
      (multiplier) => multiplier !== 0,
    ).length,
    `${label}: every used source scale is prepared`,
  );
  for (const use of proof.equationUses) {
    const multiplier =
      round.solutionDerivation.equationMultipliers[use.sourceIndex];
    assert.equal(use.multiplier, multiplier);
    assert.equal(use.repeatCount, Math.abs(multiplier));
    assert.equal(use.reversed, multiplier < 0);
    assert.equal(use.copies.length, Math.abs(multiplier));
  }
  assert.deepEqual(
    proof.accessibleSteps,
    proof.steps.map(({ text }) => text),
  );
  assert.ok(proof.accessibleSteps.every((step) => step.length > 0));

  for (const expression of [
    proof.combinedEquation.left,
    proof.combinedEquation.right,
    proof.cancellation.common,
    proof.reducedEquation.left,
    proof.reducedEquation.right,
    proof.finalEquation.left,
    proof.finalEquation.right,
  ]) {
    const tokenIndexes = expression.map(({ creature }) =>
      BALANCE_TOKENS.indexOf(creature),
    );
    assert.deepEqual(
      tokenIndexes,
      [...tokenIndexes].sort((left, right) => left - right),
      `${label}: canonical token order`,
    );
  }
}

test("all authored and representative generated rounds build exact visual proofs", () => {
  for (const [index, round] of ROUNDS.entries()) {
    assertProofCertificate(round, `campaign round ${index + 1}`);
  }

  for (const [difficultyIndex, difficulty] of [
    "Starter",
    "Junior",
    "Expert",
    "Wizard",
  ].entries()) {
    for (let sample = 0; sample < 12; sample += 1) {
      const round = generateInfiniteRoundFromSeed(
        difficulty,
        0x5170_0000 + difficultyIndex * 0x1_0000 + sample,
      );
      assertProofCertificate(
        round,
        `${difficulty} generated round ${sample + 1}`,
      );
    }
  }
});
