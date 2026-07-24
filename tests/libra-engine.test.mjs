import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTIES,
  FOUNDATIONAL_STRATEGY_BY_FAMILY,
  GENERATOR_MAX_ATTEMPTS,
  MYSTERY_TOKEN,
  ROUNDS,
  TUTORIAL,
  analyzeBalanceQuestion,
  buildRounds,
  calculateAnswer,
  canonicalEquationKey,
  createSeededRandom,
  expressionItemCount,
  expressionKey,
  generateInfiniteRound,
  generateInfiniteRoundFromSeed,
  makeExpression,
  optionFeedback,
  roundFingerprint,
  solutionDerivationMatchesRound,
  solutionStrategyFeedback,
  validateRound,
} from "../app/games/libra/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildLibraJourneyExtraCampaignRounds,
} from "../app/games/libra/journey-campaign.ts";
import { progressionAdapter } from "../app/games/libra/progression-adapter.ts";
import { progressionMetadata } from "../app/games/libra/progression-metadata.ts";
import {
  assertSoundTeachingRound,
  buildTeachingProof,
} from "../app/games/libra/strategy-curriculum.ts";
import { resolveProgressionQuestion } from "../lib/progression/game-adapter.ts";

const SEEDS_PER_DIFFICULTY = 400;

const EXPECTED_EQUATION_COUNTS = {
  Starter: 1,
  Junior: 2,
  Expert: 3,
  Wizard: 3,
};

function expectedEquationCount(round) {
  return round.difficulty === "Junior" && round.family === "combo-primer"
    ? 1
    : EXPECTED_EQUATION_COUNTS[round.difficulty];
}

const EXPECTED_CREATURE_COUNTS = {
  Starter: 2,
  Junior: 3,
  Expert: 4,
  Wizard: 4,
};

const EXPECTED_FAMILIES = {
  Starter: new Set(["direct", "cancellation"]),
  Junior: new Set([
    "chain",
    "offset-chain",
    "combo-primer",
    "add-combo",
    "subtract-combo",
  ]),
  Expert: new Set([
    "fork",
    "cross",
    "parallel",
    "sum-combo",
    "difference",
    "combo-bridge",
  ]),
  Wizard: new Set([
    "sealed-cancellation",
    "sealed-sum",
    "sealed-difference",
  ]),
};

const EXPECTED_AUTHORED_FAMILIES = {
  ...EXPECTED_FAMILIES,
  Junior: new Set([
    "chain",
    "offset-chain",
    "combo-primer",
    "add-combo",
    "subtract-combo",
  ]),
};

const GENERATED = Object.fromEntries(
  DIFFICULTIES.map((difficulty, difficultyIndex) => [
    difficulty,
    Array.from({ length: SEEDS_PER_DIFFICULTY }, (_, seedIndex) =>
      generateInfiniteRoundFromSeed(
        difficulty,
        0x1b20_0000 + difficultyIndex * 0x1_0000 + seedIndex,
      ),
    ),
  ]),
);

test("Libra content v2 and generator v3 safely migrate saved generator v2 questions", () => {
  assert.equal(progressionMetadata.contentVersion, "2");
  assert.equal(progressionMetadata.generatorVersion, "3");
  const resolved = resolveProgressionQuestion(progressionAdapter, {
    source: "generated",
    gameSlug: "libra",
    level: "starter",
    seed: "legacy-libra-starter",
    generatorVersion: "2",
  });
  assert.equal(resolved.resolution, "generated-fallback");
  assert.equal(resolved.ref.source, "campaign");
  assert.equal(resolved.round.difficulty, "Starter");
  assert.equal(validateRound(resolved.round).valid, true);
});

function relationExpressions(round) {
  return round.equations.flatMap(({ left, right }) => [left, right]);
}

function namedCreatures(round) {
  const values = new Set([round.question.unit]);
  for (const expression of [
    ...relationExpressions(round),
    round.question.target,
  ]) {
    for (const { creature } of expression) {
      if (creature !== MYSTERY_TOKEN) values.add(creature);
    }
  }
  return values;
}

function assertValidRound(round, label) {
  const validation = validateRound(round);
  assert.deepEqual(validation.errors, [], `${label}: ${validation.errors.join(" ")}`);
  assert.equal(validation.valid, true, `${label} validation`);
  assert.equal(validation.hasPositiveSolution, true, `${label} positive weights`);
  assert.equal(validation.answerInvariant, true, `${label} invariant answer`);
  assert.equal(validation.derivedAnswer, round.answer, `${label} derived answer`);
  assert.equal(
    solutionDerivationMatchesRound(round),
    true,
    `${label} exact derivation`,
  );
  assert.ok(round.solutionStrategies.length >= 1, `${label} strategy metadata`);
  assert.ok(
    Number.isInteger(round.answer) && round.answer >= 1 && round.answer <= 8,
    `${label} answer range`,
  );

  assert.equal(
    round.equations.length,
    expectedEquationCount(round),
    `${label} relation count`,
  );
  assert.equal(
    namedCreatures(round).size,
    EXPECTED_CREATURE_COUNTS[round.difficulty],
    `${label} named creature count`,
  );
  const relationKeys = round.equations.map(canonicalEquationKey);
  assert.ok(
    relationKeys.every((key) => key !== "identity"),
    `${label} nontrivial relations`,
  );
  assert.equal(
    new Set(relationKeys).size,
    relationKeys.length,
    `${label} distinct relations`,
  );

  for (const [index, expression] of [
    ...relationExpressions(round),
    round.question.target,
  ].entries()) {
    const count = expressionItemCount(expression);
    assert.ok(count >= 1 && count <= 8, `${label} expression ${index + 1} density`);
  }

  assert.equal(round.options.length, 4, `${label} option count`);
  assert.equal(round.optionKinds.length, 4, `${label} option-kind count`);
  assert.deepEqual(
    round.options.map(({ kind }) => kind),
    round.optionKinds,
    `${label} option labels`,
  );
  assert.equal(
    new Set(round.options.map(({ count }) => count)).size,
    4,
    `${label} distinct answer quantities`,
  );
  assert.ok(
    round.options.every(
      ({ creature, count }) =>
        creature === round.question.unit &&
        Number.isInteger(count) &&
        count >= 1 &&
        count <= 8,
    ),
    `${label} option quantity range`,
  );
  assert.deepEqual(
    round.options.flatMap(({ count }, index) =>
      count === validation.derivedAnswer ? [index] : [],
    ),
    [round.correctIndex],
    `${label} exactly one algebraic answer`,
  );
  assert.equal(round.options[round.correctIndex].kind, "correct");
  assert.ok(
    round.options.every(
      ({ kind }, index) => index === round.correctIndex || kind !== "correct",
    ),
    `${label} only one correct label`,
  );

  const wrongOptions = round.options.filter(
    (_, index) => index !== round.correctIndex,
  );
  assert.ok(
    wrongOptions.some(({ count }) => Math.abs(count - round.answer) === 1),
    `${label} close one-unit near miss`,
  );
  assert.ok(
    wrongOptions.filter(({ kind }) => kind !== "off-by-one").length >= 2,
    `${label} misconception distractors`,
  );
}

test("Campaign contains 48 deterministic, unique, algebraically valid rounds", () => {
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    ROUNDS.map(({ difficulty }) => difficulty),
    DIFFICULTIES.flatMap((difficulty) => Array(12).fill(difficulty)),
  );
  assert.equal(new Set(ROUNDS.map(({ id }) => id)).size, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);

  for (const [index, round] of ROUNDS.entries()) {
    assertValidRound(round, `authored round ${index + 1}`);
  }

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Authored rounds must not consult randomness.");
  };
  try {
    assert.deepEqual(buildRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});

test("each Campaign level balances answer positions without a visible cycle", () => {
  for (const difficulty of DIFFICULTIES) {
    const positions = ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    ).map(({ correctIndex }) => correctIndex);

    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} position balance`,
    );
    assert.ok(
      positions.every(
        (position, index) => index === 0 || position !== positions[index - 1],
      ),
      `${difficulty} adjacent positions`,
    );
    const blocks = [0, 4, 8].map((start) =>
      positions.slice(start, start + 4).join(","),
    );
    assert.notEqual(new Set(blocks).size, 1, `${difficulty} repeated four-cycle`);
  }
});

test("Journey-only Libra banks are valid, diverse, disjoint, and never divide by one", () => {
  const expectations = {
    "junior-2": "Junior",
    "expert-2": "Expert",
    "wizard-2": "Wizard",
  };
  const standaloneFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const journeyFingerprints = new Set();

  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.deepEqual(
    buildLibraJourneyExtraCampaignRounds(),
    JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  );

  for (const [level, difficulty] of Object.entries(expectations)) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    const positions = rounds.map(({ correctIndex }) => correctIndex);

    assert.equal(rounds.length, 12, `${level}: round count`);
    assert.equal(Object.isFrozen(rounds), true, `${level}: frozen bank`);
    assert.ok(
      rounds.every((round) => round.difficulty === difficulty),
      `${level}: mapped difficulty`,
    );
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) =>
          positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${level}: answer balance`,
    );
    assert.ok(
      positions.every(
        (position, index) =>
          index === 0 || positions[index - 1] !== position,
      ),
      `${level}: no adjacent answer-position repeat`,
    );
    assert.ok(
      new Set(
        [0, 4, 8].map((start) =>
          positions.slice(start, start + 4).join(","),
        ),
      ).size > 1,
      `${level}: no repeated four-position cycle`,
    );

    for (const [index, round] of rounds.entries()) {
      assertValidRound(round, `${level} round ${index + 1}`);

      const targetKey = expressionKey(round.question.target);
      const directlyRevealsSingleTarget =
        round.question.target.length === 1 &&
        round.question.target[0].count === 1 &&
        round.equations.some(({ left, right }) => {
          const leftIsTarget = expressionKey(left) === targetKey;
          const rightIsTarget = expressionKey(right) === targetKey;
          const leftIsKnownUnits = left.every(
            ({ creature }) => creature === round.question.unit,
          );
          const rightIsKnownUnits = right.every(
            ({ creature }) => creature === round.question.unit,
          );
          return (
            (leftIsTarget && rightIsKnownUnits) ||
            (rightIsTarget && leftIsKnownUnits)
          );
        });
      assert.equal(
        directlyRevealsSingleTarget,
        false,
        `${level} round ${index + 1}: no lone requested unknown against known units`,
      );

      const teaching = buildTeachingProof(round);
      const splitSteps = teaching.steps.filter(
        (step) => step.kind === "split-evenly",
      );
      for (const step of splitSteps) {
        assert.ok(
          step.divisor >= 2,
          `${level} round ${index + 1}: never divide by one`,
        );
        if ("groupCount" in step.before) {
          assert.equal(
            step.before.groupCount,
            step.divisor,
            `${level} round ${index + 1}: grouped divisor`,
          );
        } else {
          assert.ok(
            [...step.before.left, ...step.before.right].every(
              ({ count }) => count % step.divisor === 0,
            ),
            `${level} round ${index + 1}: divisor applies to every pictured load`,
          );
          assert.notEqual(
            expressionKey(step.before.left),
            targetKey,
            `${level} round ${index + 1}: division starts with repeated target bundles`,
          );
        }
      }
      if (round.optionKinds.includes("forgot-to-divide")) {
        assert.ok(
          splitSteps.length > 0,
          `${level} round ${index + 1}: division distractor has a real split`,
        );
      }

      const fingerprint = roundFingerprint(round);
      assert.equal(
        standaloneFingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1}: standalone disjointness`,
      );
      assert.equal(
        journeyFingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1}: Journey disjointness`,
      );
      journeyFingerprints.add(fingerprint);
    }
  }

  assert.equal(journeyFingerprints.size, 36);

  const familyCounts = (level) =>
    Object.fromEntries(
      [...new Set(JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level].map(({ family }) => family))]
        .sort()
        .map((family) => [
          family,
          JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level].filter(
            (round) => round.family === family,
          ).length,
        ]),
    );
  assert.deepEqual(familyCounts("junior-2"), {
    "add-combo": 3,
    chain: 2,
    "combo-primer": 3,
    "offset-chain": 2,
    "subtract-combo": 2,
  });
  assert.deepEqual(familyCounts("expert-2"), {
    "combo-bridge": 2,
    cross: 2,
    difference: 2,
    fork: 2,
    parallel: 2,
    "sum-combo": 2,
  });
  assert.deepEqual(familyCounts("wizard-2"), {
    "sealed-cancellation": 4,
    "sealed-difference": 4,
    "sealed-sum": 4,
  });

  const visibleStrategies = (level) =>
    new Set(
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level].flatMap(
        (round) => buildTeachingProof(round).strategyIds,
      ),
    );
  assert.deepEqual(
    visibleStrategies("junior-2"),
    new Set([
      "substitution",
      "cancel-matches",
      "create-combo",
      "split-evenly",
      "add-scales",
      "subtract-scales",
    ]),
  );
  for (const level of ["expert-2", "wizard-2"]) {
    assert.deepEqual(
      visibleStrategies(level),
      new Set([
        "substitution",
        "cancel-matches",
        "add-scales",
        "create-combo",
        "split-evenly",
        "subtract-scales",
      ]),
      `${level}: full strategy coverage`,
    );
  }

  const wizardRounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"];
  assert.equal(
    wizardRounds.filter(({ question }) => question.target.length === 1)
      .length,
    6,
    "Wizard II balances single and composite questions",
  );
  assert.equal(
    wizardRounds.filter(({ question }) => question.target.length === 2)
      .length,
    6,
    "Wizard II balances single and composite questions",
  );

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Journey campaign construction cannot consult randomness.");
  };
  try {
    assert.deepEqual(
      buildLibraJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("Journey Turbo generation rejects trivial scales and dishonest division", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    for (let seedIndex = 0; seedIndex < SEEDS_PER_DIFFICULTY; seedIndex += 1) {
      const round = progressionAdapter.generate(
        difficulty,
        createSeededRandom(
          0x71b0_0000 + difficultyIndex * 0x1_0000 + seedIndex,
        ),
      );
      assert.doesNotThrow(
        () => assertSoundTeachingRound(round),
        `${difficulty} Turbo seed ${seedIndex + 1}`,
      );
    }
  }
});

test("the authored ladder adds relations and covers its intended rule families", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = ROUNDS.filter((round) => round.difficulty === difficulty);
    assert.equal(rounds.length, 12);
    assert.deepEqual(
      new Set(rounds.map(({ family }) => family)),
      EXPECTED_AUTHORED_FAMILIES[difficulty],
      `${difficulty} family coverage`,
    );
  }

  for (const round of ROUNDS.filter(({ difficulty }) => difficulty !== "Wizard")) {
    assert.equal(
      validateRound(round).freeVariableCount,
      round.family === "combo-primer" ? 1 : 0,
    );
    assert.equal(round.scaffold?.kind, "equation-path");
    assert.deepEqual(
      new Set(round.scaffold.equationOrder),
      new Set(round.equations.map((_, index) => index)),
    );
    assert.equal(round.feedbackPolicy, "explain-difference");
    assert.ok(
      relationExpressions(round)
        .flat()
        .every(({ creature }) => creature !== MYSTERY_TOKEN),
    );
  }
});

test("authored strategy archetypes progress from foundations to scale algebra", () => {
  const starter = ROUNDS.filter(({ difficulty }) => difficulty === "Starter");
  assert.ok(starter.every(({ family }) => family in FOUNDATIONAL_STRATEGY_BY_FAMILY));
  assert.deepEqual(
    new Set(
      starter
        .filter(({ family }) => family === "direct")
        .map(({ family }) => FOUNDATIONAL_STRATEGY_BY_FAMILY[family]),
    ),
    new Set(["split-evenly"]),
  );
  assert.deepEqual(
    new Set(
      starter
        .filter(({ family }) => family === "cancellation")
        .map(({ family }) => FOUNDATIONAL_STRATEGY_BY_FAMILY[family]),
    ),
    new Set(["cancel-matches"]),
  );

  const junior = ROUNDS.filter(({ difficulty }) => difficulty === "Junior");
  const comboPrimers = junior.slice(7, 10);
  const juniorAdd = junior.at(-2);
  const juniorSubtract = junior.at(-1);

  assert.deepEqual(
    comboPrimers.map(({ family }) => family),
    ["combo-primer", "combo-primer", "combo-primer"],
  );
  assert.deepEqual(
    comboPrimers.map(({ correctIndex }) => correctIndex),
    [0, 2, 0],
  );
  assert.deepEqual(
    comboPrimers.map(({ solutionStrategies }) => solutionStrategies),
    [["create-combo"], ["create-combo"], ["create-combo"]],
  );
  assert.deepEqual(
    comboPrimers.map(({ solutionDerivation }) => solutionDerivation),
    [
      { equationMultipliers: [1], normalizeBy: 2 },
      { equationMultipliers: [1], normalizeBy: 3 },
      { equationMultipliers: [1], normalizeBy: 4 },
    ],
  );

  const expectedComboPrimerEquations = [
    {
      comboLeft: "cat:2+bear:2",
      comboRight: "beetle:8",
      target: "cat:1+bear:1",
      answer: 4,
    },
    {
      comboLeft: "goose:3+fox:3",
      comboRight: "chick:6",
      target: "goose:1+fox:1",
      answer: 2,
    },
    {
      comboLeft: "rabbit:4+turtle:4",
      comboRight: "frog:8",
      target: "rabbit:1+turtle:1",
      answer: 2,
    },
  ];
  for (const [index, round] of comboPrimers.entries()) {
    const expected = expectedComboPrimerEquations[index];
    assert.deepEqual(
      {
        comboLeft: expressionKey(round.equations[0].left),
        comboRight: expressionKey(round.equations[0].right),
        target: expressionKey(round.question.target),
        answer: round.answer,
      },
      expected,
      `Junior combo primer ${index + 1}`,
    );
    assert.equal(
      calculateAnswer([round.equations[0]], round.question),
      round.answer,
      `Junior combo primer ${index + 1} is solved by regrouping its repeated combo`,
    );
    assert.equal(round.equations.length, 1);
    assert.equal(validateRound(round).freeVariableCount, 1);
  }

  assert.equal(junior[10], juniorAdd);
  assert.equal(juniorAdd.family, "add-combo");
  assert.deepEqual(juniorAdd.solutionStrategies, [
    "add-scales",
    "create-combo",
  ]);
  assert.deepEqual(juniorAdd.solutionDerivation, {
    equationMultipliers: [1, 1],
    normalizeBy: 3,
  });
  assert.equal(juniorAdd.answer, 5);
  assert.ok(juniorAdd.optionKinds.includes("used-one-scale"));

  assert.deepEqual(juniorSubtract.solutionStrategies, [
    "subtract-scales",
    "create-combo",
  ]);
  assert.deepEqual(juniorSubtract.solutionDerivation, {
    equationMultipliers: [1, -1],
    normalizeBy: 2,
  });
  assert.equal(juniorSubtract.answer, 2);
  assert.ok(juniorSubtract.optionKinds.includes("forgot-to-divide"));

  const expert = ROUNDS.filter(({ difficulty }) => difficulty === "Expert");
  const expertFamilyCounts = Object.fromEntries(
    [...EXPECTED_FAMILIES.Expert].map((family) => [
      family,
      expert.filter((round) => round.family === family).length,
    ]),
  );
  assert.deepEqual(expertFamilyCounts, {
    fork: 1,
    cross: 1,
    parallel: 1,
    "sum-combo": 3,
    difference: 3,
    "combo-bridge": 3,
  });

  const strategyCount = (rounds, strategy) =>
    rounds.filter(({ solutionStrategies }) =>
      solutionStrategies.includes(strategy),
    ).length;
  for (const strategy of [
    "substitution",
    "add-scales",
    "subtract-scales",
    "create-combo",
  ]) {
    assert.ok(
      strategyCount(expert, strategy) >= 3,
      `Expert ${strategy} coverage`,
    );
  }

  const wizard = ROUNDS.filter(({ difficulty }) => difficulty === "Wizard");
  const strategiesSeenBeforeWizard = new Set(
    ROUNDS.filter(({ difficulty }) => difficulty !== "Wizard").flatMap(
      ({ solutionStrategies }) => solutionStrategies,
    ),
  );
  for (const strategy of [
    "substitution",
    "add-scales",
    "subtract-scales",
    "create-combo",
  ]) {
    assert.ok(
      strategyCount(wizard, strategy) >= 3,
      `Wizard ${strategy} coverage`,
    );
  }
  assert.ok(
    wizard
      .flatMap(({ solutionStrategies }) => solutionStrategies)
      .every((strategy) => strategiesSeenBeforeWizard.has(strategy)),
    "Wizard introduces no new solution strategy",
  );

  for (const round of [juniorAdd, juniorSubtract, ...expert]) {
    for (
      let removedIndex = 0;
      removedIndex < round.equations.length;
      removedIndex += 1
    ) {
      assert.equal(
        calculateAnswer(
          round.equations.filter((_, index) => index !== removedIndex),
          round.question,
        ),
        null,
        `${round.id} relation ${removedIndex + 1} is necessary`,
      );
    }
  }
});

test("Starter split-evenly rounds require a real split without constraining cancellation", () => {
  const direct = ROUNDS.find(
    ({ difficulty, family }) =>
      difficulty === "Starter" && family === "direct",
  );
  const cancellation = ROUNDS.find(
    ({ difficulty, family }) =>
      difficulty === "Starter" && family === "cancellation",
  );
  assert.ok(direct);
  assert.ok(cancellation);

  assert.ok(direct.solutionDerivation.normalizeBy >= 2);
  assert.equal(cancellation.solutionDerivation.normalizeBy, 1);
  assertValidRound(cancellation, "authored Starter cancellation");

  const answerExpression = makeExpression([
    direct.question.unit,
    direct.answer,
  ]);
  for (const [label, equation, multiplier] of [
    [
      "target on left",
      { left: direct.question.target, right: answerExpression },
      1,
    ],
    [
      "target on right",
      { left: answerExpression, right: direct.question.target },
      -1,
    ],
  ]) {
    const validation = validateRound({
      ...direct,
      equations: [equation],
      solutionDerivation: {
        equationMultipliers: [multiplier],
        normalizeBy: 1,
      },
    });
    assert.equal(validation.valid, false, label);
    assert.ok(
      validation.errors.some((error) =>
        error.includes("directly show the requested answer"),
      ),
      `${label} evidence leak`,
    );
    assert.ok(
      validation.errors.some((error) =>
        error.includes("at least two target groups"),
      ),
      `${label} split-evenly normalization`,
    );
  }
});

test("every stored derivation is an exact certificate for its target", () => {
  for (const [index, round] of [...ROUNDS, TUTORIAL].entries()) {
    assert.equal(
      solutionDerivationMatchesRound(round),
      true,
      `authored derivation ${index + 1}`,
    );
  }

  for (const difficulty of DIFFICULTIES) {
    for (const [index, round] of GENERATED[difficulty].entries()) {
      assert.equal(
        solutionDerivationMatchesRound(round),
        true,
        `${difficulty} generated derivation ${index + 1}`,
      );
    }
  }
});

test("Wizard matches Expert base density while removing the equation-path cue", () => {
  const profile = (difficulty) =>
    ROUNDS.filter((round) => round.difficulty === difficulty)
      .map((round) => expressionItemCount(round.question.target))
      .sort((left, right) => left - right);

  assert.deepEqual(profile("Wizard"), profile("Expert"));
  assert.deepEqual(profile("Wizard"), [...Array(6).fill(1), ...Array(6).fill(2)]);

  for (const difficulty of ["Expert", "Wizard"]) {
    for (const round of ROUNDS.filter(
      (candidate) => candidate.difficulty === difficulty,
    )) {
      assert.equal(round.equations.length, 3);
      assert.equal(namedCreatures(round).size, 4);
      assert.ok(expressionItemCount(round.question.target) <= 2);
      assert.ok(
        relationExpressions(round).every(
          (expression) => expressionItemCount(expression) <= 8,
        ),
      );
    }
  }
});

test("every Wizard answer cancels one sealed nuisance and needs every relation", () => {
  const wizardRounds = ROUNDS.filter(({ difficulty }) => difficulty === "Wizard");
  assert.equal(wizardRounds.length, 12);

  for (const [roundIndex, round] of wizardRounds.entries()) {
    const validation = validateRound(round);
    const mysteryGroups = relationExpressions(round)
      .flat()
      .filter(({ creature }) => creature === MYSTERY_TOKEN);

    assert.ok(
      EXPECTED_FAMILIES.Wizard.has(round.family),
      `Wizard ${roundIndex + 1} sealed family`,
    );
    assert.equal(mysteryGroups.length, 2, `Wizard ${roundIndex + 1} sealed appearances`);
    assert.ok(mysteryGroups.every(({ count }) => count === 1));
    assert.equal(validation.freeVariableCount, 1);
    assert.equal(validation.answerInvariant, true);
    assert.equal(validation.derivedAnswer, round.answer);
    assert.equal(round.scaffold, null);
    assert.equal(round.feedbackPolicy, "preserve-inference");
    assert.ok(
      round.question.target.every(({ creature }) => creature !== MYSTERY_TOKEN),
    );

    for (let removedIndex = 0; removedIndex < round.equations.length; removedIndex += 1) {
      assert.equal(
        calculateAnswer(
          round.equations.filter((_, index) => index !== removedIndex),
          round.question,
        ),
        null,
        `Wizard ${roundIndex + 1} relation ${removedIndex + 1} is necessary`,
      );
    }
  }
});

test("1,600 independently seeded Infinite rounds satisfy all puzzle invariants", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const [index, round] of GENERATED[difficulty].entries()) {
      assert.equal(round.difficulty, difficulty);
      assertValidRound(round, `${difficulty} seed ${index + 1}`);
    }
  }
});

test("the seeded corpus covers every generated family and both advanced target forms", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    assert.deepEqual(
      new Set(rounds.map(({ family }) => family)),
      EXPECTED_FAMILIES[difficulty],
      `${difficulty} generated family coverage`,
    );
  }

  for (const difficulty of ["Expert", "Wizard"]) {
    const targetDensities = new Set(
      GENERATED[difficulty].map((round) =>
        expressionItemCount(round.question.target),
      ),
    );
    assert.deepEqual(targetDensities, new Set([1, 2]));
    assert.ok(
      GENERATED[difficulty].every(
        (round) =>
          round.equations.length === 3 &&
          namedCreatures(round).size === 4 &&
          expressionItemCount(round.question.target) <= 2,
      ),
      `${difficulty} generated density envelope`,
    );
  }
});

test("generated Starter direct rounds always require splitting at least two target groups", () => {
  const direct = GENERATED.Starter.filter(({ family }) => family === "direct");
  const cancellation = GENERATED.Starter.filter(
    ({ family }) => family === "cancellation",
  );

  assert.ok(direct.length >= 100, "the corpus meaningfully samples direct rounds");
  assert.ok(
    cancellation.length >= 100,
    "the corpus meaningfully samples cancellation rounds",
  );
  assert.ok(
    direct.every(({ solutionDerivation }) =>
      solutionDerivation.normalizeBy >= 2,
    ),
  );
  assert.ok(
    direct.every(
      (round) =>
        expressionKey(round.equations[0].left) !==
        expressionKey(round.question.target),
    ),
    "a direct relation never displays the requested single target unchanged",
  );
  assert.ok(
    cancellation.every(
      ({ solutionDerivation }) => solutionDerivation.normalizeBy === 1,
    ),
    "cancellation may legitimately remove equal loads without splitting",
  );
});

test("generated Junior includes honest one-scale combo primers", () => {
  const primers = GENERATED.Junior.filter(
    ({ family }) => family === "combo-primer",
  );

  assert.ok(primers.length >= 30, "the corpus meaningfully samples combo primers");
  for (const [index, round] of primers.entries()) {
    assert.equal(round.equations.length, 1, `combo primer ${index + 1}`);
    assert.deepEqual(round.solutionStrategies, ["create-combo"]);
    assert.deepEqual(round.solutionDerivation.equationMultipliers, [1]);
    assert.ok(round.solutionDerivation.normalizeBy >= 2);
    assert.equal(validateRound(round).freeVariableCount, 1);
  }
});

test("generated Junior through Wizard repeatedly exercise every strategy archetype", () => {
  const minimumCounts = {
    Junior: {
      substitution: 120,
      "add-scales": 30,
      "subtract-scales": 30,
      "create-combo": 60,
    },
    Expert: {
      substitution: 40,
      "add-scales": 40,
      "subtract-scales": 80,
      "create-combo": 120,
    },
    Wizard: {
      substitution: 40,
      "add-scales": 160,
      "subtract-scales": 80,
      "create-combo": 160,
    },
  };

  for (const [difficulty, expected] of Object.entries(minimumCounts)) {
    for (const [strategy, minimum] of Object.entries(expected)) {
      const count = GENERATED[difficulty].filter(({ solutionStrategies }) =>
        solutionStrategies.includes(strategy),
      ).length;
      assert.ok(
        count >= minimum,
        `${difficulty} ${strategy}: ${count} should be at least ${minimum}`,
      );
    }
  }
});

test("generated teaching plans visibly exercise every available strategy", () => {
  const minimumCounts = {
    Starter: {
      "split-evenly": 100,
      "cancel-matches": 100,
    },
    Junior: {
      "split-evenly": 100,
      "cancel-matches": 50,
      substitution: 100,
      "create-combo": 100,
      "add-scales": 30,
      "subtract-scales": 30,
    },
    Expert: {
      "split-evenly": 100,
      "cancel-matches": 50,
      substitution: 200,
      "create-combo": 75,
      "add-scales": 50,
      "subtract-scales": 100,
    },
    Wizard: {
      "split-evenly": 150,
      "cancel-matches": 150,
      substitution: 200,
      // Only multi-animal targets visibly create a combo. Single-animal
      // coefficient reductions use Split evenly without relabeling them.
      "create-combo": 120,
      "add-scales": 100,
      "subtract-scales": 50,
    },
  };

  for (const [difficulty, expected] of Object.entries(minimumCounts)) {
    const visiblePlans = GENERATED[difficulty].map(
      (round) => buildTeachingProof(round).strategyIds,
    );
    for (const [strategy, minimum] of Object.entries(expected)) {
      const count = visiblePlans.filter((ids) => ids.includes(strategy)).length;
      assert.ok(
        count >= minimum,
        `${difficulty} visible ${strategy}: ${count} should be at least ${minimum}`,
      );
    }
  }
});

test("validation rejects a chain family label that lies about visible cancellation", () => {
  const chain = ROUNDS.find(
    ({ difficulty, family }) =>
      difficulty === "Junior" && family === "chain",
  );
  const offsetChain = ROUNDS.find(
    ({ difficulty, family }) =>
      difficulty === "Junior" && family === "offset-chain",
  );
  assert.ok(chain);
  assert.ok(offsetChain);

  const mislabeledOffset = validateRound({
    ...chain,
    family: "offset-chain",
  });
  assert.equal(mislabeledOffset.valid, false);
  assert.ok(
    mislabeledOffset.errors.some((error) =>
      error.includes("removable unit offset"),
    ),
  );

  const mislabeledChain = validateRound({
    ...offsetChain,
    family: "chain",
  });
  assert.equal(mislabeledChain.valid, false);
  assert.ok(
    mislabeledChain.errors.some((error) =>
      error.includes("removable unit offset"),
    ),
  );
});

test("Wizard generation always preserves the sealed-load invariant", () => {
  for (const [index, round] of GENERATED.Wizard.entries()) {
    const validation = validateRound(round);
    assert.equal(validation.freeVariableCount, 1, `Wizard seed ${index + 1}`);
    assert.equal(validation.answerInvariant, true, `Wizard seed ${index + 1}`);
    assert.equal(
      relationExpressions(round)
        .flat()
        .filter(({ creature }) => creature === MYSTERY_TOKEN).length,
      2,
    );
    assert.ok(
      round.equations.every(
        (_, removedIndex) =>
          calculateAnswer(
            round.equations.filter((__, relationIndex) => relationIndex !== removedIndex),
            round.question,
          ) === null,
      ),
      `Wizard seed ${index + 1} necessary relations`,
    );
  }
});

test("Infinite generation avoids repeated fingerprints within a session", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const random = createSeededRandom(0x51a7_0000 + difficultyIndex);
    const fingerprints = new Set();
    for (let index = 0; index < 150; index += 1) {
      const round = generateInfiniteRound(difficulty, random, fingerprints);
      const fingerprint = roundFingerprint(round);
      assert.equal(fingerprints.has(fingerprint), false);
      fingerprints.add(fingerprint);
    }
    assert.equal(fingerprints.size, 150, `${difficulty} session uniqueness`);
  }
});

test("seeded generation is reproducible", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const seed of [0, 1, 17, 731, 0x7fff_ffff]) {
      assert.deepEqual(
        generateInfiniteRoundFromSeed(difficulty, seed),
        generateInfiniteRoundFromSeed(difficulty, seed),
        `${difficulty} seed ${seed}`,
      );
    }

    const firstRandom = createSeededRandom(0xdecafbad);
    const secondRandom = createSeededRandom(0xdecafbad);
    assert.deepEqual(
      Array.from({ length: 30 }, () =>
        generateInfiniteRound(difficulty, firstRandom),
      ),
      Array.from({ length: 30 }, () =>
        generateInfiniteRound(difficulty, secondRandom),
      ),
    );
  }
});

test("fingerprints ignore option order, relation order, side direction, and scaling", () => {
  const round = ROUNDS.find(({ difficulty }) => difficulty === "Expert");
  assert.ok(round);

  const reverseExpression = (expression, scale = 1) =>
    makeExpression(
      ...expression.map(
        ({ creature, count }) => [creature, count * scale],
      ),
    );
  const equivalent = {
    ...round,
    equations: [...round.equations]
      .reverse()
      .map(({ left, right }) => ({
        left: reverseExpression(right, 2),
        right: reverseExpression(left, 2),
      })),
    options: [...round.options].reverse(),
    optionKinds: [...round.optionKinds].reverse(),
    correctIndex: 3 - round.correctIndex,
  };

  assert.equal(roundFingerprint(equivalent), roundFingerprint(round));
  assert.equal(
    canonicalEquationKey(equivalent.equations.at(-1)),
    canonicalEquationKey(round.equations[0]),
  );
});

test("the exact solver distinguishes invariant, ambiguous, and inconsistent balances", () => {
  const sealedEquations = [
    {
      left: makeExpression([MYSTERY_TOKEN, 1], ["fox", 2]),
      right: makeExpression(["owl", 1]),
    },
    {
      left: makeExpression(["owl", 1], ["frog", 1]),
      right: makeExpression([MYSTERY_TOKEN, 1], ["chick", 7]),
    },
    {
      left: makeExpression(["frog", 1]),
      right: makeExpression(["chick", 3]),
    },
  ];
  const question = {
    target: makeExpression(["fox", 1], ["frog", 1]),
    unit: "chick",
  };
  const invariant = analyzeBalanceQuestion(sealedEquations, question);
  assert.equal(invariant.answer, 5);
  assert.equal(invariant.answerInvariant, true);
  assert.equal(invariant.freeVariableCount, 1);
  assert.equal(invariant.hasPositiveSolution, true);

  const ambiguous = analyzeBalanceQuestion(
    sealedEquations.slice(0, 2),
    question,
  );
  assert.equal(ambiguous.answer, null);
  assert.equal(ambiguous.answerInvariant, false);

  const inconsistent = analyzeBalanceQuestion(
    [
      {
        left: makeExpression(["fox", 1]),
        right: makeExpression(["chick", 1]),
      },
      {
        left: makeExpression(["fox", 1]),
        right: makeExpression(["chick", 2]),
      },
    ],
    { target: makeExpression(["fox", 1]), unit: "chick" },
  );
  assert.equal(inconsistent.answer, null);
  assert.equal(inconsistent.hasPositiveSolution, false);
});

test("canonical expressions merge groups and reject malformed counts", () => {
  const expression = makeExpression(
    ["fox", 1],
    ["chick", 2],
    ["fox", 3],
  );
  assert.equal(expressionKey(expression), "chick:2+fox:4");
  assert.equal(expressionItemCount(expression), 6);
  assert.throws(() => makeExpression(["fox", 0]), /positive integers/);
  assert.throws(() => makeExpression(["fox", 1.5]), /positive integers/);
  assert.throws(() => makeExpression(["dragon", 1]), /Unknown balance token/);
});

test("validation rejects duplicate choices, oversized pans, and leaked Wizard cues", () => {
  const starter = ROUNDS[0];
  const duplicateOptions = [...starter.options];
  duplicateOptions[1] = {
    ...duplicateOptions[1],
    count: duplicateOptions[0].count,
  };
  const duplicateValidation = validateRound({
    ...starter,
    options: duplicateOptions,
    optionKinds: duplicateOptions.map(({ kind }) => kind),
  });
  assert.equal(duplicateValidation.valid, false);
  assert.ok(
    duplicateValidation.errors.some((error) => error.includes("mutually distinct")),
  );

  const oversizedValidation = validateRound({
    ...starter,
    equations: [
      {
        ...starter.equations[0],
        right: makeExpression([starter.question.unit, 9]),
      },
    ],
  });
  assert.equal(oversizedValidation.valid, false);
  assert.ok(
    oversizedValidation.errors.some((error) => error.includes("eight")),
  );

  const wizard = ROUNDS.find(({ difficulty }) => difficulty === "Wizard");
  assert.ok(wizard);
  const leakedCueValidation = validateRound({
    ...wizard,
    scaffold: { kind: "equation-path", equationOrder: [0, 1, 2] },
    feedbackPolicy: "explain-difference",
  });
  assert.equal(leakedCueValidation.valid, false);
  assert.ok(leakedCueValidation.errors.some((error) => error.includes("hide")));
  assert.ok(
    leakedCueValidation.errors.some((error) => error.includes("preserve")),
  );
});

test("generation retries rejected repeats and fails safely on hostile sources", () => {
  const constantZero = () => 0;
  const repeated = generateInfiniteRound("Starter", constantZero);
  assert.equal(repeated.family, "direct");
  assert.ok(repeated.solutionDerivation.normalizeBy >= 2);

  const constantNearOne = () => 1 - Number.EPSILON;
  const cancellation = generateInfiniteRound("Starter", constantNearOne);
  assert.equal(cancellation.family, "cancellation");
  assert.equal(cancellation.solutionDerivation.normalizeBy, 1);
  assertValidRound(cancellation, "hostile-source cancellation round");

  const excluded = new Set([roundFingerprint(repeated)]);

  let retryCalls = 0;
  const seeded = createSeededRandom(731);
  const initiallyRepeated = () => {
    retryCalls += 1;
    return retryCalls <= 40 ? 0 : seeded();
  };
  const recovered = generateInfiniteRound(
    "Starter",
    initiallyRepeated,
    excluded,
  );
  assertValidRound(recovered, "recovered generated round");
  assert.equal(excluded.has(roundFingerprint(recovered)), false);
  assert.ok(retryCalls > 40);

  let exhaustionCalls = 0;
  assert.throws(
    () =>
      generateInfiniteRound(
        "Starter",
        () => {
          exhaustionCalls += 1;
          return 0;
        },
        excluded,
      ),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.ok(exhaustionCalls >= GENERATOR_MAX_ATTEMPTS);

  for (const invalidValue of [Number.NaN, -0.01, 1, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => generateInfiniteRound("Starter", () => invalidValue),
      /Random source must return a finite number/,
    );
  }
  assert.throws(
    () => generateInfiniteRound("Impossible", createSeededRandom(1)),
    /Unknown difficulty/,
  );
  assert.throws(() => createSeededRandom(1.5), /safe integer/);
});

test("tutorial and feedback copy preserve the hidden Wizard inference", () => {
  assertValidRound(TUTORIAL, "tutorial");
  assert.match(optionFeedback(TUTORIAL, TUTORIAL.correctIndex), /balances/);
  assert.match(solutionStrategyFeedback(TUTORIAL), /Split both pans/);
  const tutorialWrongIndex = TUTORIAL.correctIndex === 0 ? 1 : 0;
  assert.match(optionFeedback(TUTORIAL, tutorialWrongIndex), /too (heavy|light)/);

  const starterCancellation = ROUNDS.find(
    ({ difficulty, family }) =>
      difficulty === "Starter" && family === "cancellation",
  );
  assert.ok(starterCancellation);
  assert.match(
    solutionStrategyFeedback(starterCancellation),
    /Remove the matching unit loads/,
  );

  const wizard = ROUNDS.find(({ difficulty }) => difficulty === "Wizard");
  assert.ok(wizard);
  const wrongIndex = wizard.correctIndex === 0 ? 1 : 0;
  const feedback = optionFeedback(wizard, wrongIndex);
  assert.equal(feedback, "That group does not leave the target scale balanced.");
  assert.equal(feedback.includes(String(wizard.answer)), false);

  const juniorAdd = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Junior",
  ).at(-2);
  assert.match(solutionStrategyFeedback(juniorAdd), /Add the balances/);
  assert.match(solutionStrategyFeedback(juniorAdd), /3 matching target groups/);
});
