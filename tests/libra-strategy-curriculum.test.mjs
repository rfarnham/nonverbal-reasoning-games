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
  buildTeachingProof,
  buildSolutionProof,
  canOpenHistoricalReview,
  canIntroduceStrategiesBeforeRound,
  discoveredStrategyIdsAfterLesson,
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

function equationChanged(before, after, label) {
  assert.notDeepEqual(
    [counts(before.left), counts(before.right)],
    [counts(after.left), counts(after.right)],
    label,
  );
}

function addedExpressionCounts(...expressions) {
  return Object.fromEntries(
    BALANCE_TOKENS.map((token) => [
      token,
      expressions.reduce(
        (total, expression) => total + counts(expression)[token],
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

  equationMatches(plan.finalEquation, expectedGoal);
  assert.ok(plan.steps.length > 0, `${label}: has a direct operation`);
  assert.ok(
    plan.steps.every(({ kind }) => kind !== "inspect" && kind !== "conclude"),
    `${label}: omits repeated opening and closing boilerplate`,
  );
  equationMatches(plan.steps.at(-1).after, expectedGoal);
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
    if (step.kind === "substitute") {
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
        addedExpressionCounts(...step.before.map(({ equation }) => equation.left)),
      );
      assert.deepEqual(
        counts(step.after.right),
        addedExpressionCounts(...step.before.map(({ equation }) => equation.right)),
      );
    }
    if (step.kind === "subtract-scales") {
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
    equationMatches(plan.steps[0].before, round.equations[0]);
    assert.ok(!plan.strategyIds.includes("add-scales"));
    assert.ok(!plan.strategyIds.includes("subtract-scales"));
  }

  const addCombo = juniorRounds.find(({ family }) => family === "add-combo");
  assert.equal(juniorRounds.indexOf(addCombo) + 1, 11);
  assert.deepEqual(
    buildTeachingProof(addCombo).steps.map(({ kind }) => kind),
    ["add-scales", "regroup", "split-evenly"],
  );
});

test("proof copy explains why each operation helps using the pictured loads", () => {
  const direct = ROUNDS.find(({ family }) => family === "direct");
  const directText = buildTeachingProof(direct).steps[0].text;
  assert.match(directText, /there are \d+ (?:rabbits|geese|foxes|frogs|turtles|cats|owls|beetles|bears|chicks) on the left/i);
  assert.match(directText, /so make \d+ equal groups/i);
  assert.doesNotMatch(directText, /\d+\s*×/);

  const substitution = ROUNDS.find(({ family }) => family === "chain");
  const substitutionText = buildTeachingProof(substitution).steps[0].text;
  assert.match(substitutionText, /\bbalances?\b.+, so replace/i);

  const combo = ROUNDS.find(({ family }) => family === "combo-primer");
  const comboText = buildTeachingProof(combo).steps[0].text;
  assert.match(comboText, /there are \d+ equal groups/i);
  assert.match(comboText, /so make \d+ equal groups/i);

  for (const round of ROUNDS) {
    for (const { text } of buildTeachingProof(round).steps) {
      assert.doesNotMatch(text, /\ba (?:owl)\b/i);
      assert.doesNotMatch(text, /\b(?:gooses|foxs)\b/i);
    }
  }
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
