import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_SPECS,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  TUTORIAL,
  analyzeWrongAttempt,
  braceletClassKey,
  braceletOrbitSize,
  braceletViews,
  buildCampaignRounds,
  closestBraceletComparisons,
  createSeededRandom,
  decodeBracelet,
  decodePattern,
  distractorKindMatches,
  encodePattern,
  findCompatibleSolutions,
  findOccurrences,
  generateInfiniteRound,
  matchingOptionIndexes,
  resolvedCorrectPattern,
  reversePattern,
  roundFingerprint,
  segmentClassKey,
  validateRound,
  visibleSegmentDistance,
} from "../app/games/bracelet-search/game-engine.ts";

const SIMPLE_DIFFICULTIES = new Set(["Easy", "Medium"]);
const ADVANCED_DIFFICULTIES = new Set(["Hard", "Wizard"]);

function modulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function binaryStrings(length, zero = "C", one = "G") {
  return Array.from({ length: 2 ** length }, (_, value) =>
    Array.from({ length }, (__, index) =>
      value & (1 << index) ? one : zero,
    ).join(""),
  );
}

function tokenMatchesBead(token, bead) {
  return (
    token.kind === "hidden" ||
    (token.bead.color === bead.color && token.bead.mark === bead.mark)
  );
}

/**
 * Independent reference matcher: enumerate both directed traversals, then
 * quotient a traversal and its reverse to one clockwise physical arc.
 */
function brutePhysicalStarts(bracelet, pattern) {
  const starts = new Set();
  for (let start = 0; start < bracelet.length; start += 1) {
    for (const direction of [1, -1]) {
      const matches = pattern.every((token, offset) =>
        tokenMatchesBead(
          token,
          bracelet[modulo(start + direction * offset, bracelet.length)],
        ),
      );
      if (!matches) continue;
      const clockwiseStart =
        direction === 1
          ? start
          : modulo(start - (pattern.length - 1), bracelet.length);
      starts.add(clockwiseStart);
    }
  }
  return [...starts].sort((left, right) => left - right);
}

function hiddenIndexes(pattern) {
  return pattern.flatMap((token, index) =>
    token.kind === "hidden" ? [index] : [],
  );
}

function assertOneExactAnswer(round, label) {
  const validation = validateRound(round);
  assert.equal(
    validation.valid,
    true,
    `${label}: ${validation.issues.join(" ")}`,
  );
  assert.deepEqual(
    matchingOptionIndexes(round.bracelet, round.options),
    [round.correctIndex],
    `${label} matching option`,
  );
  assert.equal(
    findCompatibleSolutions(round.bracelet, round.options).length,
    1,
    `${label} total option/placement solution count`,
  );
  assert.equal(
    findOccurrences(
      round.bracelet,
      round.options[round.correctIndex].pattern,
    ).length,
    1,
    `${label} physical placement`,
  );
  assert.equal(
    new Set(
      round.options.map(({ pattern }) => segmentClassKey(pattern)),
    ).size,
    4,
    `${label} reversal-distinct options`,
  );
}

function bruteSolutions(bracelet, options) {
  return options.flatMap((option, optionIndex) =>
    brutePhysicalStarts(bracelet, option.pattern).map((clockwiseStart) => ({
      optionIndex,
      clockwiseStart,
    })),
  );
}

function assertSimpleOptions(round, label) {
  assert.ok(SIMPLE_DIFFICULTIES.has(round.difficulty));
  const braceletColors = new Set(round.bracelet.map(({ color }) => color));
  for (const option of round.options) {
    assert.ok(
      !["one-color-off", "one-mark-off"].includes(option.kind),
      `${label} has no one-feature option`,
    );
    assert.ok(
      option.pattern.every(
        (token) => token.kind === "bead" && token.bead.mark === "plain",
      ),
      `${label} uses content-only plain beads`,
    );
    assert.ok(
      option.pattern.every(
        (token) =>
          token.kind === "bead" && braceletColors.has(token.bead.color),
      ),
      `${label} uses only colors visible on its bracelet`,
    );
  }
  for (let left = 0; left < round.options.length; left += 1) {
    for (let right = left + 1; right < round.options.length; right += 1) {
      assert.ok(
        visibleSegmentDistance(
          round.options[left].pattern,
          round.options[right].pattern,
        ) >= 2,
        `${label} options ${left + 1}/${right + 1} differ twice`,
      );
    }
  }
}

function assertWizardRound(round, label) {
  assert.equal(round.difficulty, "Wizard");
  for (const [optionIndex, option] of round.options.entries()) {
    assert.deepEqual(
      hiddenIndexes(option.pattern),
      [2],
      `${label} option ${optionIndex + 1} centered wildcard`,
    );
  }
  assert.deepEqual(
    matchingOptionIndexes(round.bracelet, round.options),
    [round.correctIndex],
    `${label} unique compatible option`,
  );
  assert.equal(
    findOccurrences(
      round.bracelet,
      round.options[round.correctIndex].pattern,
    ).length,
    1,
    `${label} unique compatible placement`,
  );
  assert.ok(
    resolvedCorrectPattern(round).every((token) => token.kind === "bead"),
    `${label} resolves only after success`,
  );

  for (const [optionIndex] of round.options.entries()) {
    if (optionIndex === round.correctIndex) continue;
    const feedback = analyzeWrongAttempt(round, optionIndex);
    assert.deepEqual(
      Object.keys(feedback).sort(),
      ["kind", "visibleMismatchCount"],
      `${label} wrong feedback has a deliberately narrow shape`,
    );
    assert.equal(feedback.kind, "visible-conflict");
    assert.ok(feedback.visibleMismatchCount >= 1);
    const serialized = JSON.stringify(feedback).toLowerCase();
    for (const forbidden of [
      "occurrence",
      "placement",
      "braceletindex",
      "optionindex",
      "expected",
      "hidden",
      "wildcard",
      "bead",
      "color",
      "mark",
    ]) {
      assert.ok(
        !serialized.includes(forbidden),
        `${label} feedback must not leak ${forbidden}`,
      );
    }
  }
}

test("cyclic and reverse matching agrees with exhaustive directed traversal", () => {
  for (let braceletLength = 3; braceletLength <= 7; braceletLength += 1) {
    for (const braceletCode of binaryStrings(braceletLength)) {
      const bracelet = decodeBracelet(braceletCode);
      const maximumPatternLength = Math.min(4, braceletLength - 1);
      for (
        let patternLength = 1;
        patternLength <= maximumPatternLength;
        patternLength += 1
      ) {
        for (const exactCode of binaryStrings(patternLength)) {
          const patterns = [decodePattern(exactCode)];
          for (let hiddenIndex = 0; hiddenIndex < patternLength; hiddenIndex += 1) {
            patterns.push(
              decodePattern(
                `${exactCode.slice(0, hiddenIndex)}?${exactCode.slice(
                  hiddenIndex + 1,
                )}`,
              ),
            );
          }
          for (const pattern of patterns) {
            const expected = brutePhysicalStarts(bracelet, pattern);
            const actual = findOccurrences(bracelet, pattern)
              .map(({ clockwiseStart }) => clockwiseStart)
              .sort((left, right) => left - right);
            assert.deepEqual(
              actual,
              expected,
              `${braceletCode} / ${encodePattern(pattern)}`,
            );
          }
        }
      }
    }
  }
});

test("matching recognizes wraparound and a bracelet viewed from the other side", () => {
  assert.deepEqual(
    findOccurrences(decodeBracelet("CGTV"), decodePattern("VCG")).map(
      ({ clockwiseStart }) => clockwiseStart,
    ),
    [3],
  );

  const tutorialOccurrences = findOccurrences(
    TUTORIAL.bracelet,
    TUTORIAL.answer,
  );
  assert.equal(tutorialOccurrences.length, 1);
  assert.equal(tutorialOccurrences[0].alignment, "reverse");
  assert.equal(
    findOccurrences(TUTORIAL.bracelet, reversePattern(TUTORIAL.answer)).length,
    1,
  );
  assert.equal(findOccurrences(TUTORIAL.bracelet, TUTORIAL.nearMiss).length, 0);
  const tutorialColors = new Set(
    TUTORIAL.bracelet.map(({ color }) => color),
  );
  assert.ok(
    TUTORIAL.nearMiss.every(
      (token) =>
        token.kind === "bead" && tutorialColors.has(token.bead.color),
    ),
  );
  assert.equal(visibleSegmentDistance(TUTORIAL.answer, TUTORIAL.nearMiss), 2);

  for (const round of ROUNDS) {
    for (const view of braceletViews(round.bracelet)) {
      assert.deepEqual(
        matchingOptionIndexes(view, round.options),
        [round.correctIndex],
        `${round.id} remains exact from every rotation and side`,
      );
    }
  }
});

test("reverse-equivalent choices are duplicates and repeated physical arcs stay ambiguous", () => {
  assert.equal(
    segmentClassKey(decodePattern("CGT")),
    segmentClassKey(decodePattern("TGC")),
  );
  assert.deepEqual(
    findOccurrences(decodeBracelet("CGTCGT"), decodePattern("CGT")).map(
      ({ clockwiseStart }) => clockwiseStart,
    ),
    [0, 3],
  );

  const base = ROUNDS[0];
  const duplicateIndex = (base.correctIndex + 1) % 4;
  const options = base.options.map((option, index) =>
    index === duplicateIndex
      ? {
          pattern: reversePattern(base.options[base.correctIndex].pattern),
          kind: option.kind,
        }
      : option,
  );
  const result = validateRound({ ...base, options });
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.includes("distinct even when read in reverse")),
  );
  assert.ok(
    result.issues.some((issue) => issue.includes("Exactly one option")),
  );
});

test("the frozen Campaign is exact, balanced, nonperiodic, and deterministic", () => {
  assert.equal(CAMPAIGN_SPECS.length, 48);
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    ROUNDS.map(({ difficulty }) => difficulty),
    DIFFICULTIES.flatMap((difficulty) => Array(12).fill(difficulty)),
  );
  assert.equal(new Set(ROUNDS.map(({ id }) => id)).size, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);

  for (const [roundIndex, round] of ROUNDS.entries()) {
    assertOneExactAnswer(round, `Campaign ${roundIndex + 1}`);
    for (const [optionIndex] of round.options.entries()) {
      assert.equal(
        distractorKindMatches(round, optionIndex),
        true,
        `${round.id} option ${optionIndex + 1} kind`,
      );
      if (optionIndex === round.correctIndex) continue;
      const comparisons = closestBraceletComparisons(
        round.bracelet,
        round.options[optionIndex].pattern,
      );
      assert.equal(comparisons.length, 1, `${round.id} closest comparison`);
      assert.ok(comparisons[0].mismatchCount > 0);
    }
  }

  for (const difficulty of DIFFICULTIES) {
    const level = ROUNDS.filter((round) => round.difficulty === difficulty);
    const positions = level.map(({ correctIndex }) => correctIndex);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} answer balance`,
    );
    assert.ok(
      positions.every(
        (position, index) => index === 0 || position !== positions[index - 1],
      ),
      `${difficulty} has no adjacent answer-position repeat`,
    );
    assert.ok(
      positions.slice(4).some(
        (position, index) => position !== positions[index],
      ),
      `${difficulty} is not a four-position cycle`,
    );
    assert.deepEqual(
      ["forward", "reverse"].map(
        (alignment) =>
          level.filter(
            ({ occurrence }) => occurrence.alignment === alignment,
          ).length,
      ),
      [6, 6],
      `${difficulty} direction balance`,
    );
  }

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Campaign construction cannot consult randomness.");
  };
  try {
    assert.deepEqual(buildCampaignRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});

test("Starter and Junior use generous content differences, never one-feature traps", () => {
  for (const round of ROUNDS.filter(({ difficulty }) =>
    SIMPLE_DIFFICULTIES.has(difficulty),
  )) {
    assertSimpleOptions(round, round.id);
  }

  const base = ROUNDS.find(({ difficulty }) => difficulty === "Easy");
  const removedColor = base.bracelet[0].color;
  const replacementColor = base.bracelet.find(
    ({ color }) => color !== removedColor,
  ).color;
  const withoutOneOptionColor = {
    ...base,
    bracelet: base.bracelet.map((bead) =>
      bead.color === removedColor
        ? { ...bead, color: replacementColor }
        : bead,
    ),
  };
  const invalid = validateRound(withoutOneOptionColor);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.issues.some((issue) =>
      issue.includes("color absent from the bracelet"),
    ),
  );
});

test("Expert and Wizard share the same base complexity profile", () => {
  const expert = DIFFICULTY_RULES.Hard;
  const wizard = DIFFICULTY_RULES.Wizard;
  assert.deepEqual(
    {
      braceletLength: wizard.braceletLength,
      segmentLength: wizard.segmentLength,
      colorCount: wizard.colorCount,
      dotCount: wizard.dotCount,
    },
    {
      braceletLength: expert.braceletLength,
      segmentLength: expert.segmentLength,
      colorCount: expert.colorCount,
      dotCount: expert.dotCount,
    },
  );

  for (const round of ROUNDS.filter(({ difficulty }) =>
    ADVANCED_DIFFICULTIES.has(difficulty),
  )) {
    assert.equal(round.bracelet.length, 12);
    assert.equal(
      round.bracelet.filter(({ mark }) => mark === "dot").length,
      4,
    );
    assert.equal(round.options[0].pattern.length, 5);
    assert.ok(round.options.some(({ kind }) => kind === "one-mark-off"));
  }
});

test("Wizard uses one centered wildcard and wrong feedback cannot leak it", () => {
  for (const round of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  )) {
    assertWizardRound(round, round.id);
  }

  const wizard = ROUNDS.find(({ difficulty }) => difficulty === "Wizard");
  const brokenOptions = wizard.options.map((option, index) =>
    index === 0
      ? {
          ...option,
          pattern: option.pattern.map((token, tokenIndex) =>
            tokenIndex === 1
              ? { kind: "hidden" }
              : tokenIndex === 2
                ? resolvedCorrectPattern(wizard)[2]
                : token,
          ),
        }
      : option,
  );
  const invalid = validateRound({ ...wizard, options: brokenOptions });
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.issues.some((issue) => issue.includes("center bead")),
  );
});

test("all Wizard Campaign and 400 deterministic Infinite rounds have one solution from every view", () => {
  const campaign = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  );
  assert.equal(campaign.length, 12);

  const generated = Array.from({ length: 400 }, (_, seed) =>
    generateInfiniteRound(
      "Wizard",
      createSeededRandom(0x71a2_0000 + seed),
    ),
  );

  for (const [roundIndex, round] of [...campaign, ...generated].entries()) {
    const source = roundIndex < campaign.length ? "Campaign" : "Infinite";
    const number =
      roundIndex < campaign.length
        ? roundIndex + 1
        : roundIndex - campaign.length + 1;
    const label = `Wizard ${source} ${number}`;
    assertWizardRound(round, label);

    for (const [viewIndex, view] of braceletViews(round.bracelet).entries()) {
      const solutions = bruteSolutions(view, round.options);
      assert.equal(
        solutions.length,
        1,
        `${label}, bracelet view ${viewIndex + 1}: total compatible option/arc pairs`,
      );
      assert.equal(
        solutions[0].optionIndex,
        round.correctIndex,
        `${label}, bracelet view ${viewIndex + 1}: compatible option`,
      );
      assert.equal(
        brutePhysicalStarts(
          view,
          round.options[round.correctIndex].pattern,
        ).length,
        1,
        `${label}, bracelet view ${viewIndex + 1}: physical placement`,
      );
      assert.equal(
        findCompatibleSolutions(view, round.options).length,
        1,
        `${label}, bracelet view ${viewIndex + 1}: engine solution count`,
      );
    }
  }
});

function makeGeneratedCorpus(countPerDifficulty = 400) {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty, difficultyIndex) => {
      const random = createSeededRandom(0xbace_1000 + difficultyIndex);
      return [
        difficulty,
        Array.from({ length: countPerDifficulty }, () =>
          generateInfiniteRound(difficulty, random),
        ),
      ];
    }),
  );
}

test("1,600 deterministic generated rounds satisfy every per-round invariant", () => {
  const generated = makeGeneratedCorpus();
  for (const difficulty of DIFFICULTIES) {
    const rules = DIFFICULTY_RULES[difficulty];
    const directions = new Set();
    const answerPositions = new Set();

    for (const [roundIndex, round] of generated[difficulty].entries()) {
      const label = `${difficulty} generated ${roundIndex + 1}`;
      assertOneExactAnswer(round, label);
      assert.equal(round.difficulty, difficulty);
      assert.equal(round.bracelet.length, rules.braceletLength);
      assert.equal(
        new Set(round.bracelet.map(({ color }) => color)).size,
        rules.colorCount,
      );
      assert.equal(
        round.bracelet.filter(({ mark }) => mark === "dot").length,
        rules.dotCount,
      );
      assert.equal(
        braceletOrbitSize(round.bracelet),
        round.bracelet.length * 2,
      );
      directions.add(round.occurrence.alignment);
      answerPositions.add(round.correctIndex);

      for (const [optionIndex, option] of round.options.entries()) {
        assert.equal(option.pattern.length, rules.segmentLength);
        assert.equal(
          distractorKindMatches(round, optionIndex),
          true,
          `${label} option ${optionIndex + 1} kind`,
        );
        if (difficulty === "Wizard") {
          assert.deepEqual(hiddenIndexes(option.pattern), [2]);
        } else {
          assert.deepEqual(hiddenIndexes(option.pattern), []);
        }
        if (optionIndex === round.correctIndex) continue;
        assert.ok(
          visibleSegmentDistance(
            option.pattern,
            round.options[round.correctIndex].pattern,
          ) <= rules.maximumDistractorDistance,
        );
        const comparisons = closestBraceletComparisons(
          round.bracelet,
          option.pattern,
        );
        assert.equal(comparisons.length, 1, `${label} unique closest match`);
        assert.ok(comparisons[0].mismatchCount > 0);
        if (difficulty !== "Wizard") {
          assert.notEqual(comparisons[0].alignment, "both");
        }
      }

      if (SIMPLE_DIFFICULTIES.has(difficulty)) {
        assertSimpleOptions(round, label);
      }
      if (difficulty === "Wizard") {
        assertWizardRound(round, label);
      }
    }

    assert.deepEqual(
      directions,
      new Set(["forward", "reverse"]),
      `${difficulty} generated direction coverage`,
    );
    assert.deepEqual(
      answerPositions,
      new Set([0, 1, 2, 3]),
      `${difficulty} generated answer-position coverage`,
    );
  }
});

test("seeded generation is reproducible with the same exclusion history", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const firstRandom = createSeededRandom(0xdec0_0000 + difficultyIndex);
    const secondRandom = createSeededRandom(0xdec0_0000 + difficultyIndex);
    const firstUsed = new Set();
    const secondUsed = new Set();
    const first = [];
    const second = [];

    for (let index = 0; index < 20; index += 1) {
      const firstRound = generateInfiniteRound(
        difficulty,
        firstRandom,
        firstUsed,
      );
      const secondRound = generateInfiniteRound(
        difficulty,
        secondRandom,
        secondUsed,
      );
      first.push(firstRound);
      second.push(secondRound);
      firstUsed.add(roundFingerprint(firstRound));
      secondUsed.add(roundFingerprint(secondRound));
    }
    assert.deepEqual(first, second, `${difficulty} reproducibility`);
  }
});

test("a realistic Infinite session avoids repeated fingerprints", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const used = new Set();
    const random = createSeededRandom(0x515e_0000 + difficultyIndex);
    for (let roundIndex = 0; roundIndex < 24; roundIndex += 1) {
      const round = generateInfiniteRound(difficulty, random, used);
      const fingerprint = roundFingerprint(round);
      assert.ok(
        !used.has(fingerprint),
        `${difficulty} session round ${roundIndex + 1} repeated`,
      );
      used.add(fingerprint);
    }
    assert.equal(used.size, 24);
  }
});

test("fingerprints ignore option order, viewing side, and segment direction", () => {
  const round = ROUNDS[0];
  const reordered = {
    ...round,
    options: [...round.options].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  const reversedAnswerOptions = round.options.map((option, index) =>
    index === round.correctIndex
      ? { ...option, pattern: reversePattern(option.pattern) }
      : option,
  );
  const otherSide = {
    ...round,
    bracelet: [...round.bracelet].reverse(),
  };
  assert.equal(roundFingerprint(reordered), roundFingerprint(round));
  assert.equal(
    roundFingerprint({ ...round, options: reversedAnswerOptions }),
    roundFingerprint(round),
  );
  assert.equal(roundFingerprint(otherSide), roundFingerprint(round));
  assert.equal(
    braceletClassKey(round.bracelet),
    braceletClassKey([...round.bracelet].reverse()),
  );
});

test("generation rejects hostile randomness and retries excluded output safely", () => {
  assert.throws(
    () => generateInfiniteRound("Easy", () => 0),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
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

  const seed = 0xabc1_2345;
  const first = generateInfiniteRound("Medium", createSeededRandom(seed));
  const excluded = new Set([roundFingerprint(first)]);
  const replacement = generateInfiniteRound(
    "Medium",
    createSeededRandom(seed),
    excluded,
  );
  assert.notEqual(roundFingerprint(replacement), roundFingerprint(first));

  const recoveredRandom = createSeededRandom(731);
  let calls = 0;
  const initiallyDegenerate = () => {
    calls += 1;
    return calls <= 80 ? 0 : recoveredRandom();
  };
  assertOneExactAnswer(
    generateInfiniteRound("Easy", initiallyDegenerate),
    "recovered hostile source",
  );
  assert.ok(calls > 80);
});
