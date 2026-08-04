import assert from "node:assert/strict";
import test from "node:test";

import {
  BALANCE_TOKENS,
  BALANCE_TOKEN_NAMES,
  ROUNDS,
  SOLUTION_STRATEGIES,
  displayedRoundEquation,
  generateInfiniteRoundFromSeed,
} from "../app/games/libra/game-engine.ts";
import {
  PROOF_STRATEGY_NAMES,
  STRATEGY_CATALOGUE,
  STRATEGY_CATALOGUE_BY_ID,
  STRATEGY_IDS,
  STRATEGY_SECTIONS,
  buildTeachingProof,
  buildSolutionProof,
  canOpenHistoricalReview,
  canIntroduceStrategiesBeforeRound,
  discoveredStrategyIdsAfterLesson,
  displayedProofScaleIndexes,
  displayedProofScaleNumber,
  isInfiniteCurriculumCandidate,
  orderedStrategyIdsForRound,
  preRoundStrategyIds,
  teachingProofDurationMs,
  teachingProofStepDurationMs,
  teachingProofTimeline,
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

const CAPTION_PLURAL_NAMES = {
  ...Object.fromEntries(
    BALANCE_TOKENS.map((token) => [token, `${BALANCE_TOKEN_NAMES[token]}s`]),
  ),
  goose: "geese",
  fox: "foxes",
  mystery: "sealed loads",
};

function captionExpressionText(expression) {
  const parts = expression.map(({ creature, count }) => {
    if (count > 1) return `${count} ${CAPTION_PLURAL_NAMES[creature]}`;
    const name = BALANCE_TOKEN_NAMES[creature];
    return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
  });
  if (parts.length <= 1) return parts[0] ?? "nothing";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function captionEquationText(equation) {
  const left = captionExpressionText(equation.left);
  const verb =
    equation.left.length === 1 && equation.left[0].count === 1
      ? "balances"
      : "balance";
  return `${left} ${verb} ${captionExpressionText(equation.right)}`;
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

function expressionMatches(left, right) {
  assert.deepEqual(counts(left), counts(right));
}

function equationMatches(left, right) {
  expressionMatches(left.left, right.left);
  expressionMatches(left.right, right.right);
}

function expressionsHaveSameCounts(left, right) {
  return JSON.stringify(counts(left)) === JSON.stringify(counts(right));
}

function equationMatchesEitherDirection(left, right, label) {
  const direct =
    expressionsHaveSameCounts(left.left, right.left) &&
    expressionsHaveSameCounts(left.right, right.right);
  const reversed =
    expressionsHaveSameCounts(left.left, right.right) &&
    expressionsHaveSameCounts(left.right, right.left);
  assert.ok(direct || reversed, label);
}

function equationChanged(before, after, label) {
  assert.notDeepEqual(
    [counts(before.left), counts(before.right)],
    [counts(after.left), counts(after.right)],
    label,
  );
}

function addedSourceCounts(sources, side) {
  return Object.fromEntries(
    BALANCE_TOKENS.map((token) => [
      token,
      sources.reduce(
        (total, source) =>
          total + counts(source.equation[side])[token] * source.copies,
        0,
      ),
    ]),
  );
}

function changedExpressionCounts(before, removed, added = []) {
  return Object.fromEntries(
    BALANCE_TOKENS.map((token) => [
      token,
      counts(before)[token] - counts(removed)[token] + counts(added)[token],
    ]),
  );
}

function assertTeachingPlan(round, label) {
  const plan = buildTeachingProof(round);
  const expectedGoal = {
    left: round.question.target,
    right: [{ creature: round.question.unit, count: round.answer }],
  };

  equationMatchesEitherDirection(
    plan.finalEquation,
    expectedGoal,
    `${label}: final scale matches the goal in either balanced direction`,
  );
  assert.ok(plan.steps.length > 0, `${label}: has a direct operation`);
  assert.ok(
    plan.steps.every(({ kind }) => kind !== "inspect" && kind !== "conclude"),
    `${label}: omits repeated opening and closing boilerplate`,
  );
  equationMatchesEitherDirection(
    plan.steps.at(-1).after,
    expectedGoal,
    `${label}: last operation reaches the goal in either balanced direction`,
  );
  assert.deepEqual(plan.timeline, teachingProofTimeline(plan.steps));
  assert.equal(plan.timeline.length, plan.steps.length);
  let expectedDelayMs = 0;
  for (const [stepIndex, timing] of plan.timeline.entries()) {
    const step = plan.steps[stepIndex];
    assert.equal(timing.stepId, step.id);
    assert.equal(timing.delayMs, expectedDelayMs);
    assert.equal(timing.durationMs, teachingProofStepDurationMs(step));
    expectedDelayMs += timing.durationMs;
  }
  assert.equal(plan.durationMs, expectedDelayMs, `${label}: cumulative duration`);
  assert.equal(
    plan.reducedMotionDurationMs,
    plan.durationMs,
    `${label}: reduced motion keeps the narrated teaching time`,
  );
  assert.equal(teachingProofDurationMs(round), plan.durationMs);
  assert.equal(new Set(plan.steps.map(({ id }) => id)).size, plan.steps.length);

  const actualStrategies = [];
  for (const step of plan.steps) {
    assert.ok(step.title.length > 0, `${label}: titled ${step.kind}`);
    assert.ok(step.text.length > 0, `${label}: described ${step.kind}`);
    if (
      step.strategyId !== null &&
      !actualStrategies.includes(step.strategyId)
    ) {
      actualStrategies.push(step.strategyId);
    }
    if (step.kind === "substitute" || step.kind === "cancel-matches") {
      equationChanged(step.before, step.after, `${label}: ${step.kind} changes state`);
    }
    if (step.kind === "reorient-scale") {
      equationChanged(step.before, step.after, `${label}: reorientation changes sides`);
      expressionMatches(step.before.left, step.after.right);
      expressionMatches(step.before.right, step.after.left);
      assert.match(step.text, /turn it around/i);
      assert.match(step.text, /trays line up with scale \(\d+\)/i);
    }
    if (step.kind === "substitute") {
      assert.match(
        step.text,
        new RegExp(
          `shows that ${captionEquationText(step.source.equation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          "i",
        ),
        `${label}: substitution caption follows the displayed source direction`,
      );
      assert.notEqual(step.replacement.sourceFromSide, step.replacement.sourceToSide);
      assert.deepEqual(
        scaledCounts(
          step.source.equation[step.replacement.sourceFromSide],
          step.replacement.copies,
        ),
        counts(step.replacement.from),
        `${label}: source load scales to every highlighted copy`,
      );
      assert.deepEqual(
        scaledCounts(
          step.source.equation[step.replacement.sourceToSide],
          step.replacement.copies,
        ),
        counts(step.replacement.to),
        `${label}: source replacement scales to every traveler`,
      );
      assert.deepEqual(
        counts(step.after[step.replacement.side]),
        changedExpressionCounts(
          step.before[step.replacement.side],
          step.replacement.from,
          step.replacement.to,
        ),
        `${label}: substitution morphs only the pictured target load`,
      );
      const otherSide = step.replacement.side === "left" ? "right" : "left";
      expressionMatches(step.before[otherSide], step.after[otherSide]);
    }
    if (step.kind === "add-scales") {
      assert.equal(step.before.length, 2, `${label}: add shows two scales`);
      assert.deepEqual(
        counts(step.after.left),
        addedSourceCounts(step.before, "left"),
      );
      assert.deepEqual(
        counts(step.after.right),
        addedSourceCounts(step.before, "right"),
      );
    }
    if (step.kind === "subtract-scales") {
      assert.match(
        step.text,
        new RegExp(
          captionEquationText(step.after).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        ),
        `${label}: subtraction caption follows the displayed result direction`,
      );
      equationChanged(
        step.before[0].equation,
        step.after,
        `${label}: subtraction changes state`,
      );
      assert.equal(step.before.length, 2, `${label}: subtract shows two scales`);
      assert.deepEqual(
        counts(step.after.left),
        changedExpressionCounts(
          step.before[0].equation.left,
          step.before[1].equation.left,
        ),
      );
      assert.deepEqual(
        counts(step.after.right),
        changedExpressionCounts(
          step.before[0].equation.right,
          step.before[1].equation.right,
        ),
      );
    }
    if (step.kind === "cancel-matches") {
      assert.match(
        step.text,
        new RegExp(
          captionEquationText(step.after).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        ),
        `${label}: cancellation caption follows the displayed result direction`,
      );
      assert.deepEqual(
        counts(step.after.left),
        changedExpressionCounts(step.before.left, step.removed),
      );
      assert.deepEqual(
        counts(step.after.right),
        changedExpressionCounts(step.before.right, step.removed),
      );
    }
    if (step.kind === "regroup") {
      assert.deepEqual(
        counts(step.before.left),
        scaledCounts(step.after.leftBundle, step.after.groupCount),
      );
      assert.deepEqual(
        counts(step.before.right),
        scaledCounts(step.after.rightBundle, step.after.groupCount),
      );
    }
    if (step.kind === "split-evenly") {
      assert.match(
        step.text,
        new RegExp(
          captionEquationText(step.after).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        ),
        `${label}: division caption follows the displayed result direction`,
      );
      if ("groupCount" in step.before) {
        assert.equal(step.before.groupCount, step.divisor);
        expressionMatches(step.before.leftBundle, step.after.left);
        expressionMatches(step.before.rightBundle, step.after.right);
      } else {
        equationChanged(step.before, step.after, `${label}: split changes state`);
        assert.deepEqual(
          counts(step.before.left),
          scaledCounts(step.after.left, step.divisor),
        );
        assert.deepEqual(
          counts(step.before.right),
          scaledCounts(step.after.right, step.divisor),
        );
      }
    }
  }
  assert.deepEqual(plan.strategyIds, actualStrategies, `${label}: visible tools`);
  assert.deepEqual(
    orderedStrategyIdsForRound(round),
    actualStrategies,
    `${label}: hint tools exactly match proof tools`,
  );
}

test("all 48 authored rounds have direct, non-no-op teaching plans ending at the exact goal", () => {
  for (const [index, round] of ROUNDS.entries()) {
    assertTeachingPlan(round, `campaign round ${index + 1} (${round.family})`);
  }
});

test("every authored proof remains exact under every independent scale orientation", () => {
  for (const [roundIndex, round] of ROUNDS.entries()) {
    const orientationCount = 2 ** round.equations.length;
    for (let mask = 0; mask < orientationCount; mask += 1) {
      const equationOrientations = round.equations.map((_, equationIndex) =>
        mask & (1 << equationIndex) ? "mirrored" : "standard",
      );
      assertTeachingPlan(
        { ...round, equationOrientations },
        `campaign round ${roundIndex + 1}, orientation ${mask + 1}/${orientationCount}`,
      );
    }
  }
});

function substitutionSideCounts(rounds) {
  const countsByPair = new Map();
  for (const round of rounds) {
    for (const step of buildTeachingProof(round).steps) {
      if (step.kind !== "substitute") continue;
      const key = `${step.replacement.sourceFromSide}->${step.replacement.side}`;
      countsByPair.set(key, (countsByPair.get(key) ?? 0) + 1);
    }
  }
  return countsByPair;
}

test("substitution sources and replacement points appear on both sides independently", () => {
  const authoredCounts = substitutionSideCounts(ROUNDS);
  assert.deepEqual(
    new Set(authoredCounts.keys()),
    new Set(["left->left", "left->right", "right->left", "right->right"]),
  );
  assert.ok(
    Math.max(...authoredCounts.values()) - Math.min(...authoredCounts.values()) <= 1,
    `authored substitution side pairs are balanced: ${JSON.stringify(Object.fromEntries(authoredCounts))}`,
  );

  for (const [difficultyIndex, difficulty] of [
    "Junior",
    "Expert",
    "Wizard",
  ].entries()) {
    const generatedCounts = substitutionSideCounts(
      Array.from({ length: 400 }, (_, sample) =>
        generateInfiniteRoundFromSeed(
          difficulty,
          0x4a20_0000 + difficultyIndex * 0x1_0000 + sample,
        ),
      ),
    );
    const total = [...generatedCounts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    for (const pair of ["left->left", "left->right", "right->left", "right->right"]) {
      const share = (generatedCounts.get(pair) ?? 0) / total;
      assert.ok(
        share >= 0.2 && share <= 0.3,
        `${difficulty} ${pair} substitutions are common: ${generatedCounts.get(pair)}/${total}`,
      );
    }
  }
});

function addedComboSideCounts(rounds) {
  const result = { left: 0, right: 0 };
  for (const round of rounds) {
    const plan = buildTeachingProof(round);
    if (!plan.steps.some(({ kind }) => kind === "add-scales")) continue;
    for (const step of plan.steps) {
      if (step.kind !== "regroup") continue;
      const targetIsLeft = expressionsHaveSameCounts(
        step.after.leftBundle,
        round.question.target,
      );
      const targetIsRight = expressionsHaveSameCounts(
        step.after.rightBundle,
        round.question.target,
      );
      assert.notEqual(
        targetIsLeft,
        targetIsRight,
        `${round.id}: exactly one grouped tray is the requested combo`,
      );
      const side = targetIsLeft ? "left" : "right";
      result[side] += 1;
    }
  }
  return result;
}

test("adding scales creates combos on both the left and right trays", () => {
  const authored = addedComboSideCounts(ROUNDS);
  assert.ok(
    authored.left >= 3 && authored.right >= 3,
    `Campaign add-to-combo sides: ${JSON.stringify(authored)}`,
  );

  for (const [difficultyIndex, difficulty] of [
    "Junior",
    "Expert",
    "Wizard",
  ].entries()) {
    const generated = addedComboSideCounts(
      Array.from({ length: 400 }, (_, sample) =>
        generateInfiniteRoundFromSeed(
          difficulty,
          0x5b20_0000 + difficultyIndex * 0x1_0000 + sample,
        ),
      ),
    );
    const total = generated.left + generated.right;
    assert.ok(total >= 50, `${difficulty}: enough add-to-combo proofs sampled`);
    assert.ok(
      generated.left / total >= 0.4 && generated.left / total <= 0.6,
      `${difficulty} add-to-combo sides: ${JSON.stringify(generated)}`,
    );
  }
});

test("mixed-direction add and subtract proofs visibly align scales before combining", () => {
  let reorientationCount = 0;

  for (const [roundIndex, round] of ROUNDS.entries()) {
    const currentOrientations = [...round.equationOrientations];
    const plan = buildTeachingProof(round);

    for (const [stepIndex, step] of plan.steps.entries()) {
      if (step.kind === "reorient-scale") {
        reorientationCount += 1;
        const turnedScaleIndex = step.scaleFocus.workingScaleIndex;
        const guideScaleIndex = step.scaleFocus.sourceScaleIndexes[0];
        assert.notEqual(
          currentOrientations[turnedScaleIndex],
          currentOrientations[guideScaleIndex],
          `round ${roundIndex + 1}: only a differently oriented scale is turned`,
        );
        currentOrientations[turnedScaleIndex] =
          currentOrientations[turnedScaleIndex] === "standard"
            ? "mirrored"
            : "standard";
        assert.equal(
          currentOrientations[turnedScaleIndex],
          currentOrientations[guideScaleIndex],
          `round ${roundIndex + 1}: trays line up after the turn`,
        );
        assert.equal(
          plan.steps
            .slice(stepIndex + 1)
            .find(({ kind }) => kind !== "reorient-scale")?.kind,
          step.strategyId,
          `round ${roundIndex + 1}: turning immediately prepares the named operation`,
        );
      }

      if (step.kind === "add-scales" || step.kind === "subtract-scales") {
        const workingOrientation =
          currentOrientations[step.scaleFocus.workingScaleIndex];
        assert.ok(
          step.before.every(
            ({ sourceIndex }) =>
              currentOrientations[sourceIndex] === workingOrientation,
          ),
          `round ${roundIndex + 1}: ${step.kind} combines matching tray directions`,
        );
      }
    }
  }

  assert.ok(
    reorientationCount >= 8,
    `the Campaign visibly turns individual scales in ${reorientationCount} proofs`,
  );
});

test("substitution replaces loads in place without adding whole scales", () => {
  const juniorRounds = ROUNDS.filter(({ difficulty }) => difficulty === "Junior");
  const juniorTwo = juniorRounds[1];
  const plan = buildTeachingProof(juniorTwo);
  assert.equal(juniorTwo.family, "chain");
  assert.deepEqual(
    plan.steps.map(({ kind }) => kind),
    ["substitute"],
  );
  assert.deepEqual(plan.strategyIds, ["substitution"]);

  const replacement = plan.steps.find(({ kind }) => kind === "substitute").replacement;
  assert.equal(replacement.copies, 2);
  assert.deepEqual(replacement.from, [{ creature: "rabbit", count: 2 }]);
  assert.deepEqual(replacement.to, [{ creature: "frog", count: 6 }]);
});

test("offset chains cancel only after the bridge has been substituted", () => {
  const offset = ROUNDS.find(
    ({ difficulty, family }) => difficulty === "Junior" && family === "offset-chain",
  );
  const plan = buildTeachingProof(offset);
  assert.deepEqual(
    plan.steps.map(({ kind }) => kind),
    ["substitute", "cancel-matches"],
  );
  assert.deepEqual(plan.strategyIds, ["substitution", "cancel-matches"]);
});

test("combo primers use one scale before add-scale combos are introduced", () => {
  const juniorRounds = ROUNDS.filter(({ difficulty }) => difficulty === "Junior");
  const comboPrimers = juniorRounds.filter(
    ({ family }) => family === "combo-primer",
  );
  assert.equal(comboPrimers.length, 3);
  assert.deepEqual(
    comboPrimers.map((round) => juniorRounds.indexOf(round) + 1),
    [8, 9, 10],
  );
  for (const round of comboPrimers) {
    const plan = buildTeachingProof(round);
    assert.equal(round.equations.length, 1);
    assert.equal(round.question.target.length, 2);
    assert.deepEqual(
      plan.steps.map(({ kind }) => kind),
      ["regroup", "split-evenly"],
    );
    equationMatches(plan.steps[0].before, displayedRoundEquation(round, 0));
    assert.ok(!plan.strategyIds.includes("add-scales"));
    assert.ok(!plan.strategyIds.includes("subtract-scales"));
  }

  const addCombo = juniorRounds.find(({ family }) => family === "add-combo");
  assert.equal(juniorRounds.indexOf(addCombo) + 1, 11);
  assert.deepEqual(
    buildTeachingProof(addCombo).steps
      .map(({ kind }) => kind)
      .filter((kind) => kind !== "reorient-scale"),
    ["add-scales", "regroup", "split-evenly"],
  );
});

test("proof copy explains why each operation helps using the pictured loads", () => {
  const direct = ROUNDS.find(({ family }) => family === "direct");
  const directText = buildTeachingProof(direct).steps[0].text;
  assert.match(directText, /there are \d+ (?:rabbits|geese|foxes|frogs|turtles|cats|owls|beetles|bears|chicks) on the left/i);
  assert.match(directText, /so split .+ on the right into \d+ equal groups/i);
  assert.match(directText, /keep one group from each tray/i);
  assert.doesNotMatch(directText, /\d+\s*×/);

  const substitution = ROUNDS.find(({ family }) => family === "chain");
  const substitutionText = buildTeachingProof(substitution).steps[0].text;
  assert.match(
    substitutionText,
    /scale \(\d+\) shows that .+ balances? .+\.(?: the .+ tray (?:of scale \(\d+\) )?has .+\.)? (?:on scale \(\d+\), )?replace/i,
  );

  const combo = ROUNDS.find(({ family }) => family === "combo-primer");
  const comboText = buildTeachingProof(combo).steps[0].text;
  const comboSide = comboText.match(
    /on scale \(\d+\), the (left|right) tray has .+/i,
  )?.[1];
  assert.ok(comboSide, "combo narration identifies the grouped tray");
  assert.match(comboText, /circle \d+ groups, each with .+/i);
  assert.match(
    comboText,
    new RegExp(
      `split .+ on the ${comboSide === "left" ? "right" : "left"} into \\d+ equal groups`,
      "i",
    ),
  );

  for (const round of ROUNDS) {
    for (const { kind, text } of buildTeachingProof(round).steps) {
      assert.doesNotMatch(text, /\ba (?:owl)\b/i);
      assert.doesNotMatch(text, /\b(?:gooses|foxs)\b/i);
      assert.doesNotMatch(text, /\breplace each (?:a|an)\b/i);
      assert.doesNotMatch(text, /(?:^|[.!?]\s+)(?:a|an)\s/);
      assert.doesNotMatch(text, /\bbalances?\b[^.!?]*\bremains\b/i);
      assert.doesNotMatch(
        text,
        /\b(?:like splitting|you added scales|works backwards|as before|as we saw|use what you know)\b/i,
      );

      if (kind === "add-scales") {
        assert.match(
          text,
          /(?:neither scale has .+ together\. add the scales|add the scales so .+ on both trays)\./i,
        );
        assert.match(
          text,
          /add (?:\d+ copies of )?scale \(\d+\) to (?:\d+ copies of )?scale \(\d+\): (?:left tray to left tray and right tray to right tray|right tray to right tray and left tray to left tray)/i,
        );
      } else if (kind === "subtract-scales") {
        assert.match(
          text,
          /subtract (?:\d+ copies of )?scale \(\d+\) from (?:\d+ copies of )?scale \(\d+\)/i,
        );
        assert.match(
          text,
          /remove .+ from the (?:left tray and .+ from the right tray|right tray and .+ from the left tray)/i,
        );
        assert.match(text, /of scale \(\d+\)/i);
        assert.match(text, /\bnow .+ balances? .+\.$/i);
      } else if (kind === "reorient-scale") {
        assert.match(text, /^scale \(\d+\) is balanced in either direction/i);
        assert.match(text, /turn it around so its trays line up with scale \(\d+\)/i);
      } else if (kind === "cancel-matches") {
        assert.match(text, /^on scale \(\d+\),/i);
        assert.match(text, /appear(?:s)? on both trays/i);
        assert.match(text, /remove .+ from each tray/i);
        assert.match(text, /\bnow .+ balances? .+\.$/i);
      } else if (kind === "regroup") {
        assert.match(text, /^on scale \(\d+\), the (?:left|right) tray has .+/i);
        assert.match(text, /circle \d+ groups, each with .+/i);
      } else if (kind === "split-evenly") {
        assert.match(text, /^on scale \(\d+\),/i);
        assert.match(text, /keep one group from each tray/i);
      }
    }
  }

  for (const strategy of STRATEGY_CATALOGUE) {
    assert.doesNotMatch(
      strategy.description,
      /\b(?:like splitting|you added scales|works backwards|as before|as we saw|use what you know)\b/i,
      `${strategy.id} explains itself directly`,
    );
  }
});

test("every proof uses stable visible scale numbers and a named strategy", () => {
  assert.deepEqual(PROOF_STRATEGY_NAMES, {
    "split-evenly": "Split",
    "cancel-matches": "Cancel",
    substitution: "Substitution",
    "create-combo": "Combo",
    "add-scales": "Add scales",
    "subtract-scales": "Subtract scales",
  });

  for (const [roundIndex, round] of ROUNDS.entries()) {
    const displayedIndexes = displayedProofScaleIndexes(round);
    assert.equal(displayedIndexes.length, round.equations.length);
    assert.equal(new Set(displayedIndexes).size, round.equations.length);

    for (const [displayedIndex, sourceIndex] of displayedIndexes.entries()) {
      assert.equal(
        displayedProofScaleNumber(round, sourceIndex),
        displayedIndex + 1,
      );
    }

    for (const step of buildTeachingProof(round).steps) {
      assert.ok(step.strategyId, `round ${roundIndex + 1}: strategy is named`);
      assert.ok(step.scaleFocus, `round ${roundIndex + 1}: a scale is focused`);
      const { workingScaleIndex, sourceScaleIndexes } = step.scaleFocus;
      assert.ok(
        workingScaleIndex >= 0 &&
          workingScaleIndex < round.equations.length,
        `round ${roundIndex + 1}: working scale exists`,
      );
      assert.match(
        step.text,
        new RegExp(
          `scale \\(${displayedProofScaleNumber(
            round,
            workingScaleIndex,
          )}\\)`,
          "i",
        ),
        `round ${roundIndex + 1}: copy names the working scale`,
      );
      for (const sourceIndex of sourceScaleIndexes) {
        assert.ok(
          sourceIndex >= 0 && sourceIndex < round.equations.length,
          `round ${roundIndex + 1}: reference scale exists`,
        );
        assert.match(
          step.text,
          new RegExp(
            `scale \\(${displayedProofScaleNumber(round, sourceIndex)}\\)`,
            "i",
          ),
          `round ${roundIndex + 1}: copy names each reference scale`,
        );
      }

      const sources =
        step.kind === "substitute"
          ? [step.source]
          : step.kind === "add-scales" || step.kind === "subtract-scales"
            ? step.before
            : [];
      for (const source of sources) {
        assert.ok(
          Number.isSafeInteger(source.copies) && source.copies >= 1,
          `round ${roundIndex + 1}: scale copies are explicit`,
        );
      }
    }
  }

  const threeScaleRound = ROUNDS.find(({ equations }) => equations.length === 3);
  assert.ok(threeScaleRound, "the campaign includes a three-scale proof");
  const reordered = {
    equations: threeScaleRound.equations,
    scaffold: {
      ...threeScaleRound.scaffold,
      equationOrder: [2, 0, 1],
    },
  };
  assert.deepEqual(displayedProofScaleIndexes(reordered), [2, 0, 1]);
  assert.equal(displayedProofScaleNumber(reordered, 2), 1);
  assert.equal(displayedProofScaleNumber(reordered, 0), 2);
  assert.equal(displayedProofScaleNumber(reordered, 1), 3);
});

test("plain one-animal targets divide directly instead of pretending to form a combo", () => {
  for (const [index, round] of ROUNDS.entries()) {
    if (round.question.target.length !== 1) continue;
    const plan = buildTeachingProof(round);
    assert.ok(
      !plan.steps.some(({ kind }) => kind === "regroup"),
      `campaign round ${index + 1}: no combo regroup for a single animal`,
    );
    assert.ok(!plan.strategyIds.includes("create-combo"));
  }
});

test("every authored proof uses only tools available by that point in Campaign", () => {
  let discovered = [];

  for (const [index, round] of ROUNDS.entries()) {
    const available = new Set([
      ...discovered,
      ...preRoundStrategyIds(round),
    ]);
    for (const strategyId of buildTeachingProof(round).strategyIds) {
      assert.ok(
        available.has(strategyId),
        `campaign round ${index + 1}: ${strategyId} is available`,
      );
    }
    for (const strategyId of orderedStrategyIdsForRound(round)) {
      discovered = discoveredStrategyIdsAfterLesson(discovered, strategyId);
    }
  }
});

test("proof operations linger long enough to inspect the scales and moving loads", () => {
  const minimumMsByKind = {
    substitute: 4_600,
    "reorient-scale": 4_600,
    "add-scales": 4_600,
    "subtract-scales": 4_400,
    "cancel-matches": 3_600,
    regroup: 3_500,
    "split-evenly": 4_600,
  };

  for (const round of ROUNDS) {
    for (const step of buildTeachingProof(round).steps) {
      assert.ok(
        teachingProofStepDurationMs(step) >= minimumMsByKind[step.kind],
        `${step.kind} has a readable hold`,
      );
    }
  }
});

test("authored family plans follow the direct strategy matrix", () => {
  const plansByFamily = new Map();
  for (const round of ROUNDS) {
    const kinds = buildTeachingProof(round).steps.map(({ kind }) => kind);
    const existing = plansByFamily.get(round.family) ?? [];
    existing.push(kinds);
    plansByFamily.set(round.family, existing);
  }

  for (const family of ["chain", "offset-chain", "fork", "cross", "parallel"]) {
    for (const kinds of plansByFamily.get(family)) {
      assert.ok(kinds.includes("substitute"), `${family}: substitutes in place`);
      assert.ok(!kinds.includes("add-scales"), `${family}: never adds whole scales`);
      assert.ok(
        !kinds.includes("subtract-scales"),
        `${family}: never subtracts whole scales`,
      );
    }
  }

  for (const kinds of plansByFamily.get("sum-combo")) {
    assert.ok(kinds.indexOf("substitute") < kinds.indexOf("add-scales"));
    assert.ok(kinds.indexOf("add-scales") < kinds.indexOf("regroup"));
  }
  for (const kinds of plansByFamily.get("difference")) {
    assert.ok(kinds.indexOf("substitute") < kinds.indexOf("subtract-scales"));
  }
  for (const kinds of plansByFamily.get("combo-bridge")) {
    assert.ok(kinds.indexOf("subtract-scales") < kinds.indexOf("split-evenly"));
    assert.ok(kinds.indexOf("split-evenly") < kinds.indexOf("substitute"));
  }
});

test("generated rounds use the same strategy-aware teaching model", () => {
  for (const [difficultyIndex, difficulty] of [
    "Starter",
    "Junior",
    "Expert",
    "Wizard",
  ].entries()) {
    for (let sample = 0; sample < 400; sample += 1) {
      const round = generateInfiniteRoundFromSeed(
        difficulty,
        0x71b0_0000 + difficultyIndex * 0x1_0000 + sample,
      );
      assertTeachingPlan(round, `${difficulty} generated ${sample + 1}`);
    }
  }
});

test("standalone Infinite introduces strategy families in scaffolded discovery order", () => {
  const round = (difficulty, family) => {
    const found = ROUNDS.find(
      (candidate) =>
        candidate.difficulty === difficulty && candidate.family === family,
    );
    assert.ok(found, `${difficulty} ${family} fixture`);
    return found;
  };
  const accepts = (difficulty, family, discovered) =>
    isInfiniteCurriculumCandidate(round(difficulty, family), discovered);

  assert.equal(accepts("Starter", "direct", []), true);
  assert.equal(accepts("Starter", "cancellation", []), false);
  assert.equal(accepts("Starter", "direct", ["split-evenly"]), false);
  assert.equal(
    accepts("Starter", "cancellation", ["split-evenly"]),
    true,
  );

  const foundations = ["split-evenly", "cancel-matches"];
  assert.equal(accepts("Junior", "chain", foundations), true);
  assert.equal(accepts("Junior", "offset-chain", foundations), false);
  assert.equal(accepts("Junior", "combo-primer", foundations), false);

  const substituted = [...foundations, "substitution"];
  assert.equal(accepts("Junior", "combo-primer", substituted), true);
  assert.equal(accepts("Junior", "add-combo", substituted), false);
  assert.equal(accepts("Junior", "subtract-combo", substituted), false);
  assert.equal(round("Junior", "combo-primer").equations.length, 1);

  const combined = [...substituted, "create-combo"];
  assert.equal(accepts("Junior", "combo-primer", combined), false);
  assert.equal(accepts("Junior", "add-combo", combined), true);
  assert.equal(accepts("Junior", "subtract-combo", combined), false);

  const added = [...combined, "add-scales"];
  assert.equal(accepts("Junior", "subtract-combo", added), true);
  assert.equal(accepts("Junior", "add-combo", added), false);

  assert.equal(accepts("Expert", "difference", added), true);
  assert.equal(accepts("Expert", "sum-combo", added), false);

  const complete = [...added, "subtract-scales"];
  for (const candidate of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Expert",
  )) {
    assert.equal(isInfiniteCurriculumCandidate(candidate, complete), true);
  }

  const missingAdd = [...combined, "subtract-scales"];
  assert.equal(accepts("Wizard", "sealed-sum", missingAdd), false);
  assert.equal(accepts("Wizard", "sealed-difference", missingAdd), true);
  for (const candidate of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  )) {
    assert.equal(isInfiniteCurriculumCandidate(candidate, complete), true);
  }
});
