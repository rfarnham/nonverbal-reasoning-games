import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_ROUNDS_BY_DIFFICULTY,
  CELL_STATES,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  PATTERNS,
  ROUNDS,
  TUTORIAL,
  applyProgram,
  applyRule,
  buildCampaignRounds,
  differingStripIndexes,
  encodeStrip,
  generateInfiniteRound,
  makeSeededRandom,
  optionFeedback,
  roundFingerprint,
  stripDistance,
  validateRound,
} from "../app/games/changing-strips/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildChangingStripsJourneyExtraCampaignRounds,
} from "../app/games/changing-strips/journey-campaign.ts";
import { progressionAdapter } from "../app/games/changing-strips/progression-adapter.ts";

const GENERATED_COUNT_PER_DIFFICULTY = 400;

const NAMED_MISTAKES = new Set([
  "wrong-order",
  "stopped-early",
  "one-step-only",
  "skipped-step",
  "missed-all",
  "reversed-arrow",
  "wrong-source",
  "wrong-target",
  "changed-some-matches",
]);

function assertTraceTruth(round, label) {
  const result = applyProgram(round.input, round.rules);
  assert.deepEqual(result.output, round.answer, `${label}: calculated answer`);
  assert.equal(
    result.steps.length,
    round.rules.length,
    `${label}: trace length`,
  );

  let current = [...round.input];
  result.steps.forEach((step, executionIndex) => {
    assert.equal(
      step.executionIndex,
      executionIndex,
      `${label}: execution index`,
    );
    assert.equal(
      step.ruleIndex,
      executionIndex,
      `${label}: card index follows top-to-bottom order`,
    );
    assert.equal(step.rule.kind, "replace", `${label}: finite grammar`);
    assert.deepEqual(step.before, current, `${label}: before snapshot`);
    assert.deepEqual(
      step.after,
      applyRule(step.before, step.rule),
      `${label}: independently applied card`,
    );
    assert.deepEqual(
      step.changedIndexes,
      differingStripIndexes(step.before, step.after),
      `${label}: exact changed cells`,
    );
    assert.ok(
      step.changedIndexes.length > 0,
      `${label}: every shown card changes at least one cell`,
    );
    current = [...step.after];
  });
}

function assertRoundContract(round, label) {
  assert.deepEqual(validateRound(round), [], `${label}: validator`);
  assert.equal(
    round.input.length,
    round.rows * round.columns,
    `${label}: row-major dimensions`,
  );
  assert.equal(round.options.length, 4, `${label}: four options`);
  assert.equal(
    new Set(round.options.map(({ strip }) => encodeStrip(strip))).size,
    4,
    `${label}: distinct options`,
  );
  assert.deepEqual(
    round.options.flatMap((option, index) =>
      encodeStrip(option.strip) === encodeStrip(round.answer) ? [index] : [],
    ),
    [round.correctIndex],
    `${label}: one exact answer`,
  );
  assert.equal(
    round.options[round.correctIndex].kind,
    "correct",
    `${label}: indexed answer label`,
  );
  assert.ok(
    stripDistance(round.input, round.answer) >= 2,
    `${label}: complete recipe visibly changes the board`,
  );
  assert.ok(
    new Set(round.answer).size >= 2,
    `${label}: answer is not a uniform shortcut`,
  );

  round.options.forEach((option, optionIndex) => {
    const feedback = optionFeedback(round, optionIndex);
    assert.equal(
      feedback.correct,
      optionIndex === round.correctIndex,
      `${label}: feedback correctness`,
    );
    assert.equal(feedback.kind, option.kind, `${label}: feedback kind`);
    assert.equal(
      feedback.mismatchCount,
      stripDistance(option.strip, round.answer),
      `${label}: mismatch count`,
    );
    assert.deepEqual(
      feedback.differingIndexes,
      differingStripIndexes(option.strip, round.answer),
      `${label}: exact mismatch cells`,
    );
    assert.equal(
      feedback.trace.length,
      round.rules.length,
      `${label}: feedback proof`,
    );
    if (optionIndex !== round.correctIndex) {
      assert.ok(
        NAMED_MISTAKES.has(option.kind),
        `${label}: distractor is a named recipe mistake`,
      );
      assert.ok(
        feedback.message.length > 20,
        `${label}: explanatory feedback`,
      );
    }
  });

  if (round.difficulty === "Starter" || round.difficulty === "Junior") {
    for (let first = 0; first < round.options.length; first += 1) {
      for (
        let second = first + 1;
        second < round.options.length;
        second += 1
      ) {
        assert.ok(
          stripDistance(
            round.options[first].strip,
            round.options[second].strip,
          ) >= 2,
          `${label}: options ${first + 1}/${second + 1} differ twice`,
        );
      }
    }
  } else {
    assert.ok(
      round.options.some(
        (option, optionIndex) =>
          optionIndex !== round.correctIndex &&
          option.kind === "changed-some-matches" &&
          stripDistance(option.strip, round.answer) === 1,
      ),
      `${label}: advanced board has a named one-cell partial-change trap`,
    );
  }

  assertTraceTruth(round, label);
}

test("one replacement card changes every matching pattern simultaneously", () => {
  const input = [
    "solid",
    "hollow",
    "solid",
    "striped",
    "solid",
  ];
  assert.deepEqual(
    applyRule(input, {
      kind: "replace",
      from: "solid",
      to: "hollow",
    }),
    ["hollow", "hollow", "hollow", "striped", "hollow"],
  );
  assert.deepEqual(input, [
    "solid",
    "hollow",
    "solid",
    "striped",
    "solid",
  ]);
});

test("recipes execute exactly once per card in visible top-to-bottom order", () => {
  const input = ["solid", "hollow", "striped", "solid"];
  const rules = [
    { kind: "replace", from: "solid", to: "hollow" },
    { kind: "replace", from: "hollow", to: "solid" },
  ];
  const result = applyProgram(input, rules);
  const bottomFirst = applyProgram(input, [...rules].reverse());

  assert.deepEqual(
    result.steps.map(({ executionIndex, ruleIndex }) => [
      executionIndex,
      ruleIndex,
    ]),
    [
      [0, 0],
      [1, 1],
    ],
  );
  assert.deepEqual(result.output, [
    "solid",
    "solid",
    "striped",
    "solid",
  ]);
  assert.deepEqual(bottomFirst.output, [
    "hollow",
    "hollow",
    "striped",
    "hollow",
  ]);
  assert.notDeepEqual(result.output, bottomFirst.output);
});

test("the example uses a gentle two-card recipe and an honest trace", () => {
  assert.equal(TUTORIAL.isExample, true);
  assert.equal(TUTORIAL.rows, 1);
  assert.equal(TUTORIAL.columns, 6);
  assert.deepEqual(TUTORIAL.input, [
    "solid",
    "hollow",
    "striped",
    "hollow",
    "striped",
    "solid",
  ]);
  assert.deepEqual(TUTORIAL.rules, [
    { kind: "replace", from: "solid", to: "hollow" },
    { kind: "replace", from: "striped", to: "solid" },
  ]);
  assertRoundContract(TUTORIAL, "tutorial");
});

test("Campaign has 48 deterministic rounds with balanced non-patterned answer positions", () => {
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(buildCampaignRounds(), CAMPAIGN_ROUNDS_BY_DIFFICULTY);
  assert.deepEqual(
    DIFFICULTIES.flatMap(
      (difficulty) => CAMPAIGN_ROUNDS_BY_DIFFICULTY[difficulty],
    ),
    ROUNDS,
  );

  const expectedStepCoverage = {
    Starter: [2],
    Junior: [2, 3],
    Expert: [3, 4],
    Wizard: [4, 5, 6],
  };
  const allFingerprints = new Set();

  DIFFICULTIES.forEach((difficulty) => {
    const rounds = CAMPAIGN_ROUNDS_BY_DIFFICULTY[difficulty];
    const expected = DIFFICULTY_RULES[difficulty];
    const answerIndexes = rounds.map(({ correctIndex }) => correctIndex);
    const stepCounts = new Set();

    assert.equal(rounds.length, 12, `${difficulty}: authored count`);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (answerIndex) =>
          answerIndexes.filter((value) => value === answerIndex).length,
      ),
      [3, 3, 3, 3],
      `${difficulty}: 3/3/3/3 answer balance`,
    );
    assert.ok(
      answerIndexes.every(
        (value, index) =>
          index === 0 || answerIndexes[index - 1] !== value,
      ),
      `${difficulty}: no adjacent repeat`,
    );
    for (let blockStart = 0; blockStart < 12; blockStart += 4) {
      assert.ok(
        new Set(answerIndexes.slice(blockStart, blockStart + 4)).size < 4,
        `${difficulty}: aligned block is not a predictable permutation`,
      );
    }

    rounds.forEach((round, index) => {
      assertRoundContract(round, `${difficulty} Campaign ${index + 1}`);
      assert.equal(round.rows, expected.rows, `${difficulty}: rows`);
      assert.equal(
        round.columns,
        expected.columns,
        `${difficulty}: columns`,
      );
      assert.ok(
        round.rules.every(({ kind }) => kind === "replace"),
        `${difficulty}: replacement-only grammar`,
      );
      assert.ok(
        round.rules.length >= expected.minSteps &&
          round.rules.length <= expected.maxSteps,
        `${difficulty}: recipe length`,
      );
      stepCounts.add(round.rules.length);

      const fingerprint = roundFingerprint(round);
      assert.equal(
        allFingerprints.has(fingerprint),
        false,
        `${difficulty}: unique fingerprint ${index + 1}`,
      );
      allFingerprints.add(fingerprint);
    });

    assert.deepEqual(
      [...stepCounts].sort(
        (firstCount, secondCount) => firstCount - secondCount,
      ),
      expectedStepCoverage[difficulty],
      `${difficulty}: authored recipe-length coverage`,
    );
  });

  assert.equal(allFingerprints.size, 48);
  assert.ok(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Starter.every(
      ({ rules }) => rules.length === 2,
    ),
    "Starter uses two-card recipes from puzzle 1",
  );
  assert.ok(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Expert.every(
      ({ rows }) => rows === 2,
    ),
    "Expert uses two-row boards",
  );
  assert.ok(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Wizard.every(
      ({ rows }) => rows === 2,
    ),
    "Wizard uses two-row boards",
  );
  assert.equal(DIFFICULTY_RULES.Junior.columns, 6);
  assert.equal(DIFFICULTY_RULES.Expert.columns, 5);
  assert.equal(DIFFICULTY_RULES.Wizard.columns, 5);
  assert.ok(
    DIFFICULTY_RULES.Expert.rows * DIFFICULTY_RULES.Expert.columns >
      DIFFICULTY_RULES.Junior.rows * DIFFICULTY_RULES.Junior.columns,
    "two-row levels increase total cells without shrinking phone options",
  );
});

test("authored construction never consults randomness", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Authored construction cannot use randomness.");
  };
  try {
    assert.deepEqual(buildCampaignRounds(), CAMPAIGN_ROUNDS_BY_DIFFICULTY);
    assert.deepEqual(
      buildChangingStripsJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("Journey-only banks add 36 deterministic valid rounds disjoint from standalone Campaign", () => {
  const expectations = {
    "junior-2": {
      difficulty: "Junior",
      positions: [1, 3, 1, 0, 2, 1, 2, 0, 3, 2, 3, 0],
    },
    "expert-2": {
      difficulty: "Expert",
      positions: [3, 2, 3, 0, 1, 3, 1, 0, 2, 0, 2, 1],
    },
    "wizard-2": {
      difficulty: "Wizard",
      positions: [3, 2, 3, 0, 1, 2, 1, 3, 0, 1, 0, 2],
    },
  };
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));

  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.deepEqual(
    buildChangingStripsJourneyExtraCampaignRounds(),
    JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  );

  Object.entries(expectations).forEach(([level, expectation]) => {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    assert.equal(rounds.length, 12, `${level}: count`);
    assert.equal(Object.isFrozen(rounds), true, `${level}: frozen`);
    assert.deepEqual(
      rounds.map(({ correctIndex }) => correctIndex),
      expectation.positions,
      `${level}: answer schedule`,
    );
    for (let blockStart = 0; blockStart < 12; blockStart += 4) {
      assert.ok(
        new Set(
          expectation.positions.slice(blockStart, blockStart + 4),
        ).size < 4,
        `${level}: aligned block is not a predictable permutation`,
      );
    }

    rounds.forEach((round, index) => {
      assert.equal(
        round.difficulty,
        expectation.difficulty,
        `${level}: difficulty`,
      );
      assert.equal(
        round.id,
        `changing-strips-journey-${level}-${String(index + 1).padStart(2, "0")}`,
      );
      assertRoundContract(round, `${level} Journey ${index + 1}`);
      const fingerprint = roundFingerprint(round);
      assert.equal(
        usedFingerprints.has(fingerprint),
        false,
        `${level}: disjoint fingerprint ${index + 1}`,
      );
      usedFingerprints.add(fingerprint);
    });
  });

  assert.equal(usedFingerprints.size, 84);
});

test("the adapter exposes version-2 authored and generated content through seven Journey banks", () => {
  const expectedBanks = {
    starter: CAMPAIGN_ROUNDS_BY_DIFFICULTY.Starter,
    "junior-1": CAMPAIGN_ROUNDS_BY_DIFFICULTY.Junior,
    "junior-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"],
    "expert-1": CAMPAIGN_ROUNDS_BY_DIFFICULTY.Expert,
    "expert-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"],
    "wizard-1": CAMPAIGN_ROUNDS_BY_DIFFICULTY.Wizard,
    "wizard-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"],
  };
  const fingerprints = new Set();

  assert.equal(progressionAdapter.contentVersion, "2");
  assert.equal(progressionAdapter.generatorVersion, "2");
  assert.equal(progressionAdapter.journeyContentVersion, "2");
  assert.deepEqual(progressionAdapter.campaignRounds, ROUNDS);
  assert.deepEqual(
    Object.keys(progressionAdapter.journeyCampaignRounds),
    Object.keys(expectedBanks),
  );

  Object.entries(expectedBanks).forEach(([level, expectedRounds]) => {
    const rounds = progressionAdapter.journeyCampaignRounds[level];
    assert.deepEqual(rounds, expectedRounds, `${level}: explicit bank`);
    rounds.forEach((round) => {
      const fingerprint = roundFingerprint(round);
      assert.equal(
        fingerprints.has(fingerprint),
        false,
        `${level}: unique Journey fingerprint`,
      );
      fingerprints.add(fingerprint);
    });
  });

  assert.equal(fingerprints.size, 84);
});

test("fingerprints ignore answer placement and normalize equivalent replacement recipes", () => {
  const round = CAMPAIGN_ROUNDS_BY_DIFFICULTY.Wizard[0];
  const reorderedOptions = {
    ...round,
    options: [...round.options].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  assert.equal(roundFingerprint(reorderedOptions), roundFingerprint(round));

  const expanded = {
    rows: 1,
    columns: 6,
    input: [
      "solid",
      "hollow",
      "striped",
      "solid",
      "hollow",
      "striped",
    ],
    rules: [
      { kind: "replace", from: "solid", to: "hollow" },
      { kind: "replace", from: "hollow", to: "solid" },
    ],
  };
  const normalized = {
    ...expanded,
    rules: [
      { kind: "replace", from: "hollow", to: "solid" },
    ],
  };
  assert.deepEqual(
    applyProgram(expanded.input, expanded.rules).output,
    applyProgram(normalized.input, normalized.rules).output,
  );
  assert.equal(
    roundFingerprint(expanded),
    roundFingerprint(normalized),
    "execution-equivalent recipes share one semantic fingerprint",
  );
  assert.notEqual(
    roundFingerprint(expanded),
    roundFingerprint({
      ...expanded,
      rows: 2,
      columns: 3,
    }),
    "board geometry remains part of puzzle identity",
  );
});

test("1,600 seeded Infinite rounds are reproducible, unique, valid, and in tier", () => {
  DIFFICULTIES.forEach((difficulty, difficultyIndex) => {
    const fingerprints = new Set();
    const answerIndexes = new Set();
    const stepCounts = new Set();
    const expected = DIFFICULTY_RULES[difficulty];

    for (
      let seedIndex = 0;
      seedIndex < GENERATED_COUNT_PER_DIFFICULTY;
      seedIndex += 1
    ) {
      const seed =
        0x5c00_0000 + difficultyIndex * 0x1_0000 + seedIndex;
      const exclusionsBefore = new Set(fingerprints);
      const round = generateInfiniteRound(
        difficulty,
        makeSeededRandom(seed),
        exclusionsBefore,
      );
      const reproduced = generateInfiniteRound(
        difficulty,
        makeSeededRandom(seed),
        exclusionsBefore,
      );

      assert.deepEqual(
        reproduced,
        round,
        `${difficulty} seed ${seedIndex}: reproducible`,
      );
      assertRoundContract(
        round,
        `${difficulty} generated seed ${seedIndex}`,
      );
      assert.equal(round.rows, expected.rows, `${difficulty}: rows`);
      assert.equal(round.columns, expected.columns, `${difficulty}: columns`);
      assert.ok(
        round.rules.every(({ kind }) => kind === "replace"),
        `${difficulty}: replacement-only generator`,
      );

      const fingerprint = roundFingerprint(round);
      assert.equal(
        fingerprints.has(fingerprint),
        false,
        `${difficulty} seed ${seedIndex}: session uniqueness`,
      );
      fingerprints.add(fingerprint);
      answerIndexes.add(round.correctIndex);
      stepCounts.add(round.rules.length);
    }

    assert.equal(
      fingerprints.size,
      GENERATED_COUNT_PER_DIFFICULTY,
      `${difficulty}: generated corpus size`,
    );
    assert.deepEqual(
      [...answerIndexes].sort(),
      [0, 1, 2, 3],
      `${difficulty}: answer-position coverage`,
    );
    assert.deepEqual(
      [...stepCounts].sort(
        (firstCount, secondCount) => firstCount - secondCount,
      ),
      Array.from(
        { length: expected.maxSteps - expected.minSteps + 1 },
        (_, index) => expected.minSteps + index,
      ),
      `${difficulty}: recipe-length coverage`,
    );
  });
});

test("excluded fingerprints are honored and hostile randomness fails at the bound", () => {
  const fixed = () => 0;
  const first = generateInfiniteRound("Starter", fixed);
  const excluded = new Set([roundFingerprint(first)]);
  assert.throws(
    () => generateInfiniteRound("Starter", fixed, excluded),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );

  let invalidCalls = 0;
  assert.throws(
    () =>
      generateInfiniteRound("Wizard", () => {
        invalidCalls += 1;
        return Number.NaN;
      }),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.equal(
    invalidCalls,
    GENERATOR_MAX_ATTEMPTS,
    "one rejected candidate per bounded attempt",
  );

  assert.throws(
    () => generateInfiniteRound("Expert", () => 1),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.throws(
    () =>
      generateInfiniteRound("Junior", () => {
        throw new Error("hostile source");
      }),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
});

test("validator rejects no-op cards, bad dimensions, duplicate answers, and unnamed mistakes", () => {
  const noOp = structuredClone(CAMPAIGN_ROUNDS_BY_DIFFICULTY.Starter[0]);
  noOp.rules[0] = {
    kind: "replace",
    from: "solid",
    to: "solid",
  };
  assert.ok(
    validateRound(noOp).some((issue) => issue.includes("no-op")),
    "static or executed no-op is rejected",
  );

  const badDimensions = structuredClone(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Expert[0],
  );
  badDimensions.columns += 1;
  assert.ok(
    validateRound(badDimensions).some(
      (issue) =>
        issue.includes("dimensions") || issue.includes("must use"),
    ),
    "declared dimensions are enforced",
  );

  const duplicate = structuredClone(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Junior[0],
  );
  duplicate.options[0].strip = [...duplicate.answer];
  duplicate.options[1].strip = [...duplicate.answer];
  assert.ok(
    validateRound(duplicate).some(
      (issue) =>
        issue.includes("mutually distinct") ||
        issue.includes("Exactly the indexed option"),
    ),
    "duplicate answer options are rejected",
  );

  const unnamed = structuredClone(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Wizard[0],
  );
  const wrongIndex = unnamed.correctIndex === 0 ? 1 : 0;
  unnamed.options[wrongIndex].kind = "mystery-error";
  assert.ok(
    validateRound(unnamed).some((issue) =>
      issue.includes("named recipe mistake"),
    ),
    "generic distractor labels are rejected",
  );

  const missingCloseTrap = structuredClone(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Expert[0],
  );
  missingCloseTrap.options.forEach((option, index) => {
    if (
      index !== missingCloseTrap.correctIndex &&
      option.kind === "changed-some-matches"
    ) {
      option.kind = "wrong-order";
    }
  });
  assert.ok(
    validateRound(missingCloseTrap).some((issue) =>
      issue.includes("one-cell partial-change trap"),
    ),
    "advanced rounds require the named close trap",
  );
});

test("the finite pattern catalogue is solid, hollow, and striped", () => {
  assert.deepEqual(PATTERNS, ["solid", "hollow", "striped"]);
  assert.deepEqual(CELL_STATES, PATTERNS);
  assert.equal(new Set(PATTERNS).size, 3);
});
