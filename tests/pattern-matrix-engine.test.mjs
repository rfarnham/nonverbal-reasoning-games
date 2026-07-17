import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CAMPAIGN_ROUNDS,
  DIFFICULTIES,
  GENERATOR_MAX_ATTEMPTS,
  OPERATIONS,
  PATTERN_TRANSFORMS,
  ROUNDS,
  TUTORIAL,
  applyMatrixRule,
  buildCampaignRounds,
  combinePatterns,
  compatibleRules,
  createSeededRandom,
  differingDotIndexes,
  difficultyLabel,
  dotCount,
  generateInfiniteRound,
  inferenceOptionIndexes,
  inferredAnswerKeys,
  incorrectFeedback,
  operationLabel,
  patternFromMask,
  patternKey,
  patternMask,
  rotatePattern,
  roundFingerprint,
  ruleLabel,
  transformPattern,
  validateRound,
} from "../app/games/pattern-matrix/game-engine.ts";

const EXPECTED_CUES = {
  Easy: "full-rule",
  Medium: "full-rule",
  Hard: "operation-only",
  Wizard: "hidden",
};

const EXPECTED_DENSITY = {
  Easy: {
    minInput: 1,
    maxInput: 2,
    minOutput: 2,
    maxOutput: 3,
  },
  Medium: {
    minInput: 2,
    maxInput: 3,
    minOutput: 1,
    maxOutput: 3,
  },
  Hard: {
    minInput: 2,
    maxInput: 3,
    minOutput: 1,
    maxOutput: 3,
  },
  Wizard: {
    minInput: 2,
    maxInput: 3,
    minOutput: 1,
    maxOutput: 3,
  },
};

const TURN_KINDS = new Set(["skipped-turn", "wrong-turn"]);
const LOCAL_KINDS = new Set(["one-dot-added", "one-dot-removed"]);

function completedRows(round) {
  return [
    [round.matrix[0], round.matrix[1], round.matrix[2]],
    [round.matrix[3], round.matrix[4], round.matrix[5]],
    [round.matrix[6], round.matrix[7], round.correctPattern],
  ];
}

function assertExactRound(round, label) {
  assert.equal(round.matrix.length, 9, `${label} matrix size`);
  assert.equal(round.matrix[8], null, `${label} missing position`);
  assert.equal(round.options.length, 4, `${label} option count`);
  assert.equal(round.optionKinds.length, 4, `${label} option-kind count`);
  assert.ok(
    Number.isInteger(round.correctIndex) &&
      round.correctIndex >= 0 &&
      round.correctIndex < 4,
    `${label} correct index`,
  );

  for (const [rowIndex, [left, right, result]] of completedRows(
    round,
  ).entries()) {
    assert.equal(
      patternKey(applyMatrixRule(left, right, round.rule)),
      patternKey(result),
      `${label} row ${rowIndex + 1} follows its rule`,
    );
  }

  const expectedKey = patternKey(
    applyMatrixRule(round.matrix[6], round.matrix[7], round.rule),
  );
  assert.equal(
    patternKey(round.correctPattern),
    expectedKey,
    `${label} calculated answer`,
  );
  assert.equal(
    new Set(round.options.map(patternKey)).size,
    4,
    `${label} distinct options`,
  );
  assert.deepEqual(
    round.options.flatMap((option, index) =>
      patternKey(option) === expectedKey ? [index] : [],
    ),
    [round.correctIndex],
    `${label} one exact answer`,
  );
  assert.equal(round.optionKinds[round.correctIndex], "correct");
  assert.deepEqual(validateRound(round), [], `${label} validates`);
}

function assertDifficultyContract(round, label) {
  const density = EXPECTED_DENSITY[round.difficulty];
  assert.equal(round.cueMode, EXPECTED_CUES[round.difficulty], `${label} cue`);

  if (round.difficulty === "Easy") {
    assert.equal(round.rule.operation, "join", `${label} starter operation`);
    assert.equal(round.rule.transform, "none", `${label} starter turn`);
  } else if (round.difficulty === "Medium") {
    assert.ok(
      OPERATIONS.includes(round.rule.operation),
      `${label} junior operation`,
    );
    assert.equal(round.rule.transform, "none", `${label} junior turn`);
  } else {
    assert.ok(
      OPERATIONS.includes(round.rule.operation),
      `${label} harder operation`,
    );
    assert.ok(
      PATTERN_TRANSFORMS.includes(round.rule.transform) &&
        round.rule.transform !== "none",
      `${label} harder non-identity turn`,
    );
  }

  for (const [rowIndex, [left, right, result]] of completedRows(
    round,
  ).entries()) {
    for (const [inputIndex, input] of [left, right].entries()) {
      const count = dotCount(input);
      assert.ok(
        count >= density.minInput && count <= density.maxInput,
        `${label} row ${rowIndex + 1} input ${inputIndex + 1} density`,
      );
    }
    const outputCount = dotCount(result);
    assert.ok(
      outputCount >= density.minOutput &&
        outputCount <= density.maxOutput,
      `${label} row ${rowIndex + 1} output density`,
    );

    const overlap = patternMask(left) & patternMask(right);
    if (round.difficulty === "Easy") {
      assert.equal(overlap, 0, `${label} starter inputs stay separate`);
    } else {
      assert.notEqual(overlap, 0, `${label} overlap must matter`);
    }
  }
}

function assertDistractorContract(round, label) {
  const wrongKinds = round.optionKinds.filter(
    (_, index) => index !== round.correctIndex,
  );
  const wrongOptions = round.options.filter(
    (_, index) => index !== round.correctIndex,
  );
  const differences = wrongOptions.map(
    (option) => differingDotIndexes(option, round.correctPattern).length,
  );

  assert.ok(
    wrongKinds.some((kind) => LOCAL_KINDS.has(kind)),
    `${label} local misconception`,
  );
  assert.ok(
    differences.some((count) => count === 1),
    `${label} one-dot near miss`,
  );
  assert.ok(
    differences.every((count) => count > 0),
    `${label} no accidental correct distractor`,
  );

  if (round.difficulty === "Hard" || round.difficulty === "Wizard") {
    assert.ok(
      wrongKinds.some((kind) => TURN_KINDS.has(kind)),
      `${label} turn misconception`,
    );
    assert.ok(
      differences.every((count) => count <= 2),
      `${label} close harder distractors`,
    );
  } else {
    assert.ok(
      wrongKinds.some((kind) => !LOCAL_KINDS.has(kind)),
      `${label} rule misconception`,
    );
  }
}

function seededGeneratedCorpus(countPerDifficulty = 400) {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      Array.from({ length: countPerDifficulty }, (_, seedIndex) =>
        generateInfiniteRound(
          difficulty,
          createSeededRandom(`corpus-${difficulty}-${seedIndex}`),
        ),
      ),
    ]),
  );
}

const GENERATED = seededGeneratedCorpus();

test("2×2 pattern primitives implement every set operation and turn exactly", () => {
  const left = patternFromMask(0b1101);
  const right = patternFromMask(0b1011);

  assert.equal(patternMask(left), 0b1101);
  assert.equal(patternKey(left), "1011");
  assert.equal(dotCount(left), 3);
  assert.equal(patternMask(combinePatterns(left, right, "join")), 0b1111);
  assert.equal(patternMask(combinePatterns(left, right, "overlap")), 0b1001);
  assert.equal(patternMask(combinePatterns(left, right, "cancel")), 0b0110);
  assert.equal(
    patternMask(combinePatterns(left, right, "left-minus-right")),
    0b0100,
  );
  assert.equal(
    patternMask(combinePatterns(left, right, "right-minus-left")),
    0b0010,
  );

  const topLeft = patternFromMask(0b0001);
  assert.equal(patternMask(rotatePattern(topLeft, 1)), 0b0010);
  assert.equal(patternMask(rotatePattern(topLeft, 2)), 0b1000);
  assert.equal(patternMask(rotatePattern(topLeft, -1)), 0b0100);
  assert.equal(patternMask(rotatePattern(topLeft, 4)), 0b0001);
  assert.equal(
    patternMask(transformPattern(topLeft, "rotate-clockwise")),
    0b0010,
  );
  assert.equal(patternMask(transformPattern(topLeft, "rotate-half")), 0b1000);
  assert.equal(
    patternMask(transformPattern(topLeft, "rotate-counterclockwise")),
    0b0100,
  );
  assert.equal(patternMask(transformPattern(topLeft, "none")), 0b0001);

  const ruleResult = applyMatrixRule(left, right, {
    operation: "cancel",
    transform: "rotate-clockwise",
  });
  assert.equal(patternMask(ruleResult), 0b1001);
  assert.deepEqual(differingDotIndexes(patternFromMask(1), patternFromMask(9)), [
    3,
  ]);

  assert.throws(() => patternFromMask(-1), /0 to 15/);
  assert.throws(() => patternFromMask(16), /0 to 15/);
  assert.throws(
    () => differingDotIndexes([true], patternFromMask(1)),
    /same number/,
  );
});

test("the tutorial is a solved join example with a genuine near miss", () => {
  assert.equal(TUTORIAL.matrix.length, 9);
  assert.equal(TUTORIAL.matrix[8], null);
  assert.equal(TUTORIAL.rule.operation, "join");
  assert.equal(TUTORIAL.rule.transform, "none");
  assert.equal(TUTORIAL.cueMode, "full-rule");
  assert.equal(
    patternKey(TUTORIAL.answer),
    patternKey(
      applyMatrixRule(TUTORIAL.matrix[6], TUTORIAL.matrix[7], TUTORIAL.rule),
    ),
  );
  assert.notEqual(patternKey(TUTORIAL.answer), patternKey(TUTORIAL.nearMiss));
  assert.equal(
    differingDotIndexes(TUTORIAL.nearMiss, TUTORIAL.answer).length,
    1,
  );
});

test("Campaign contains 48 exact literal rounds, 12 at each level", () => {
  assert.equal(CAMPAIGN_ROUNDS, ROUNDS);
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    DIFFICULTIES.map(
      (difficulty) =>
        ROUNDS.filter((round) => round.difficulty === difficulty).length,
    ),
    [12, 12, 12, 12],
  );
  assert.deepEqual(
    ROUNDS.map(({ difficulty }) => difficulty),
    DIFFICULTIES.flatMap((difficulty) => Array(12).fill(difficulty)),
  );

  for (const [index, round] of ROUNDS.entries()) {
    assertExactRound(round, `Campaign ${index + 1}`);
    assertDifficultyContract(round, `Campaign ${index + 1}`);
    assertDistractorContract(round, `Campaign ${index + 1}`);
  }
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);
});

test("Campaign answer positions are balanced and sequence-safe per level", () => {
  for (const difficulty of DIFFICULTIES) {
    const sequence = ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    ).map(({ correctIndex }) => correctIndex);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => sequence.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} 3/3/3/3 balance`,
    );
    assert.ok(
      sequence.every(
        (position, index) => index === 0 || position !== sequence[index - 1],
      ),
      `${difficulty} no adjacent repeat`,
    );
    assert.ok(
      !sequence.slice(4).every(
        (position, index) => position === sequence[index % 4],
      ),
      `${difficulty} does not repeat one four-answer cycle`,
    );
  }
});

test("Campaign rebuilds from frozen literals without any random source", () => {
  const engineSource = readFileSync(
    new URL("../app/games/pattern-matrix/game-engine.ts", import.meta.url),
    "utf8",
  );
  const authoredStart = engineSource.indexOf("const AUTHORED_ROUND_SPECS");
  const authoredEnd = engineSource.indexOf("function assertMask", authoredStart);
  const authoredSource = engineSource.slice(authoredStart, authoredEnd);

  assert.ok(authoredStart >= 0 && authoredEnd > authoredStart);
  assert.match(authoredSource, /matrixMasks:/);
  assert.match(authoredSource, /optionMasks:/);
  assert.doesNotMatch(authoredSource, /\bseed\s*:/);
  assert.doesNotMatch(
    buildCampaignRounds.toString(),
    /Math\.random|createSeededRandom|generateInfiniteRound|generateRoundForRule/,
  );

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Campaign must not consult Math.random");
  };
  try {
    assert.deepEqual(buildCampaignRounds(), ROUNDS);
    assert.deepEqual(buildCampaignRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});

test("authored levels cover their intended rule and turn families", () => {
  const byDifficulty = Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      ROUNDS.filter((round) => round.difficulty === difficulty),
    ]),
  );
  assert.deepEqual(
    new Set(byDifficulty.Easy.map(({ rule }) => rule.operation)),
    new Set(["join"]),
  );
  assert.deepEqual(
    new Set(byDifficulty.Easy.map(({ rule }) => rule.transform)),
    new Set(["none"]),
  );
  assert.deepEqual(
    new Set(byDifficulty.Medium.map(({ rule }) => rule.operation)),
    new Set(OPERATIONS),
  );
  assert.deepEqual(
    new Set(byDifficulty.Medium.map(({ rule }) => rule.transform)),
    new Set(["none"]),
  );

  for (const difficulty of ["Hard", "Wizard"]) {
    assert.deepEqual(
      new Set(byDifficulty[difficulty].map(({ rule }) => rule.operation)),
      new Set(OPERATIONS),
      `${difficulty} operations`,
    );
    assert.deepEqual(
      new Set(byDifficulty[difficulty].map(({ rule }) => rule.transform)),
      new Set(PATTERN_TRANSFORMS.filter((transform) => transform !== "none")),
      `${difficulty} turns`,
    );
  }
});

test("1,600 independently seeded Infinite rounds are exact and level-valid", () => {
  for (const difficulty of DIFFICULTIES) {
    assert.equal(GENERATED[difficulty].length, 400);
    for (const [index, round] of GENERATED[difficulty].entries()) {
      const label = `${difficulty} seed ${index + 1}`;
      assert.equal(round.difficulty, difficulty, `${label} level`);
      assertExactRound(round, label);
      assertDifficultyContract(round, label);
      assertDistractorContract(round, label);
    }
  }
});

test("large Infinite corpora cover every allowed operation and turn", () => {
  assert.deepEqual(
    new Set(GENERATED.Easy.map(({ rule }) => rule.operation)),
    new Set(["join"]),
  );
  assert.deepEqual(
    new Set(GENERATED.Medium.map(({ rule }) => rule.operation)),
    new Set(OPERATIONS),
  );
  for (const difficulty of ["Hard", "Wizard"]) {
    assert.deepEqual(
      new Set(GENERATED[difficulty].map(({ rule }) => rule.operation)),
      new Set(OPERATIONS),
    );
    assert.deepEqual(
      new Set(GENERATED[difficulty].map(({ rule }) => rule.transform)),
      new Set(PATTERN_TRANSFORMS.filter((transform) => transform !== "none")),
    );
  }
});

test("Expert turns and Wizard full rules are uniquely inferable", () => {
  const allHarderRounds = [
    ...ROUNDS.filter(({ difficulty }) =>
      ["Hard", "Wizard"].includes(difficulty),
    ),
    ...GENERATED.Hard,
    ...GENERATED.Wizard,
  ];

  for (const [index, round] of allHarderRounds.entries()) {
    const compatible = compatibleRules(round.matrix);
    if (round.difficulty === "Hard") {
      assert.equal(round.cueMode, "operation-only");
      assert.deepEqual(
        compatible.filter(
          ({ operation }) => operation === round.rule.operation,
        ),
        [round.rule],
        `Expert ${index + 1} hidden turn`,
      );
    } else {
      assert.equal(round.cueMode, "hidden");
      assert.deepEqual(compatible, [round.rule], `Wizard ${index + 1} rule`);
      assert.equal(
        inferredAnswerKeys(round.matrix).size,
        1,
        `Wizard ${index + 1} inferred answer`,
      );
      assert.deepEqual(
        inferenceOptionIndexes(round.matrix, round.options),
        [round.correctIndex],
        `Wizard ${index + 1} unique option`,
      );
    }
  }
});

test("same seeds reproduce identical Infinite rounds and sequences", () => {
  for (const difficulty of DIFFICULTIES) {
    const first = createSeededRandom(`repro-${difficulty}`);
    const second = createSeededRandom(`repro-${difficulty}`);
    assert.deepEqual(
      Array.from({ length: 60 }, () =>
        generateInfiniteRound(difficulty, first),
      ),
      Array.from({ length: 60 }, () =>
        generateInfiniteRound(difficulty, second),
      ),
      `${difficulty} sequence`,
    );
  }
  const firstNumbers = createSeededRandom(0xdecafbad);
  const secondNumbers = createSeededRandom(0xdecafbad);
  assert.deepEqual(
    Array.from({ length: 20 }, firstNumbers),
    Array.from({ length: 20 }, secondNumbers),
  );
  assert.throws(() => createSeededRandom(Number.NaN), /finite/);
});

test("excluded fingerprints prevent 400 within-session repeats per level", () => {
  for (const difficulty of DIFFICULTIES) {
    const usedFingerprints = new Set();
    const random = createSeededRandom(`long-session-${difficulty}`);

    for (let index = 0; index < 400; index += 1) {
      const round = generateInfiniteRound(
        difficulty,
        random,
        usedFingerprints,
      );
      const fingerprint = roundFingerprint(round);
      assert.ok(
        !usedFingerprints.has(fingerprint),
        `${difficulty} session round ${index + 1} is new`,
      );
      usedFingerprints.add(fingerprint);
    }
    assert.equal(usedFingerprints.size, 400);
  }
});

test("generator rejects invalid and hostile random sources with a bounded error", () => {
  for (const invalidValue of [
    Number.NaN,
    -0.01,
    1,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => generateInfiniteRound("Easy", () => invalidValue),
      /Random source must return/,
    );
  }
  assert.throws(
    () => generateInfiniteRound("Impossible", createSeededRandom(1)),
    /Unknown difficulty/,
  );

  for (const difficulty of DIFFICULTIES) {
    let calls = 0;
    assert.throws(
      () =>
        generateInfiniteRound(difficulty, () => {
          calls += 1;
          return 0;
        }),
      new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
      `${difficulty} constant source`,
    );
    assert.ok(
      calls <= GENERATOR_MAX_ATTEMPTS * 257,
      `${difficulty} bounded random calls`,
    );
  }

  const seeded = createSeededRandom(731);
  let calls = 0;
  const initiallyDegenerate = () => {
    calls += 1;
    return calls <= 500 ? 0 : seeded();
  };
  assertExactRound(
    generateInfiniteRound("Easy", initiallyDegenerate),
    "recovered generated round",
  );
  assert.ok(calls > 500);
});

test("fingerprints ignore answer order, labels, IDs, cues, and rule metadata", () => {
  const round = ROUNDS[0];
  const reordered = {
    ...round,
    id: "different-id",
    difficulty: "Wizard",
    cueMode: "hidden",
    rule: { operation: "cancel", transform: "rotate-half" },
    options: [...round.options].reverse(),
    optionKinds: [...round.optionKinds].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  assert.equal(roundFingerprint(reordered), roundFingerprint(round));
});

test("feedback teaches disclosed levels without spoiling hidden dimensions", () => {
  for (const round of [...ROUNDS, ...Object.values(GENERATED).flat()]) {
    for (const optionIndex of [0, 1, 2, 3]) {
      if (optionIndex === round.correctIndex) continue;
      const feedback = incorrectFeedback(round, optionIndex);
      assert.equal(feedback.heading, "Try again");
      assert.ok(feedback.message.length > 0);

      if (round.difficulty === "Hard" || round.difficulty === "Wizard") {
        assert.equal(feedback.revealDifferences, false);
        assert.equal(feedback.differenceCount, null);
        assert.doesNotMatch(
          feedback.message,
          /clockwise|counterclockwise|halfway|left minus|right minus|join|overlap|cancel/i,
        );
      } else {
        assert.equal(feedback.revealDifferences, true);
        assert.equal(
          feedback.differenceCount,
          differingDotIndexes(
            round.options[optionIndex],
            round.correctPattern,
          ).length,
        );
      }
    }
  }

  assert.throws(
    () => incorrectFeedback(ROUNDS[0], ROUNDS[0].correctIndex),
    /only available for a wrong option/,
  );
  assert.throws(() => incorrectFeedback(ROUNDS[0], -1), /Unknown answer/);
  assert.throws(() => incorrectFeedback(ROUNDS[0], 4), /Unknown answer/);
});

test("rule labels are grammatical and player-facing level labels are stable", () => {
  assert.deepEqual(DIFFICULTIES.map(difficultyLabel), [
    "Starter",
    "Junior",
    "Expert",
    "Wizard",
  ]);
  assert.deepEqual(OPERATIONS.map(operationLabel), [
    "Join",
    "Keep overlap",
    "Cancel matches",
    "Left minus right",
    "Right minus left",
  ]);
  assert.equal(
    ruleLabel({ operation: "join", transform: "none" }),
    "Join the two patterns.",
  );
  assert.equal(
    ruleLabel({ operation: "overlap", transform: "none" }),
    "Keep only their overlapping dots.",
  );
  assert.equal(
    ruleLabel({ operation: "cancel", transform: "none" }),
    "Cancel the dots they share.",
  );
  assert.equal(
    ruleLabel({ operation: "left-minus-right", transform: "none" }),
    "Remove the right pattern's dots from the left.",
  );
  assert.equal(
    ruleLabel({ operation: "right-minus-left", transform: "none" }),
    "Remove the left pattern's dots from the right.",
  );
  assert.equal(
    ruleLabel({
      operation: "left-minus-right",
      transform: "rotate-clockwise",
    }),
    "Remove the right pattern's dots from the left, then turn the result right.",
  );
});

test("validateRound rejects mutated cue, rule, density, and option labels", () => {
  const easy = ROUNDS.find(({ difficulty }) => difficulty === "Easy");
  assert.ok(easy);

  assert.match(
    validateRound({ ...easy, cueMode: "hidden" }).join(" "),
    /cue mode/i,
  );
  assert.match(
    validateRound({
      ...easy,
      rule: { operation: "cancel", transform: "none" },
    }).join(" "),
    /allowed rule family/i,
  );

  const denseMatrix = [...easy.matrix];
  denseMatrix[0] = patternFromMask(15);
  assert.match(
    validateRound({ ...easy, matrix: denseMatrix }).join(" "),
    /density bounds/i,
  );

  const falseKinds = [...easy.optionKinds];
  const wrongIndex = [0, 1, 2, 3].find(
    (index) => index !== easy.correctIndex,
  );
  falseKinds[wrongIndex] = "correct";
  assert.match(
    validateRound({ ...easy, optionKinds: falseKinds }).join(" "),
    /truthfully describe/i,
  );

  const unknownKinds = [...easy.optionKinds];
  unknownKinds[wrongIndex] = "invented-kind";
  assert.match(
    validateRound({ ...easy, optionKinds: unknownKinds }).join(" "),
    /truthfully describe/i,
  );
});
