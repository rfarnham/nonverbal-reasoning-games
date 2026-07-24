import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  TUTORIAL,
  buildCampaignRounds,
  depthOnly,
  generateInfiniteRound,
  isDifficultyValid,
  mirrorOnly,
  optionMatchesCorrect,
  otherSideOf,
  roundFingerprint,
  turnOverTop,
  weaveDifferences,
  weaveKey,
} from "../app/games/braids/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildBraidJourneyExtraCampaignRounds,
} from "../app/games/braids/journey-campaign.ts";

const DIFFICULTIES = ["Starter", "Junior", "Expert", "Wizard"];
const SEEDS_PER_DIFFICULTY = 400;

const EXPECTED_DISTRACTORS = {
  Starter: new Set(["mirror-only", "depth-only", "two-crossings-off"]),
  Junior: new Set(["mirror-only", "top-turn", "two-crossings-off"]),
  Expert: new Set(["mirror-only", "one-crossing-off", "one-motif-off"]),
  Wizard: new Set(["mirror-only", "one-crossing-off", "one-motif-off"]),
};

function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function ribbons(weave) {
  return [...weave.verticalRibbons, ...weave.horizontalRibbons];
}

function assertSimpleOptionsAreSeparated(round, label) {
  for (let first = 0; first < round.options.length; first += 1) {
    for (let second = first + 1; second < round.options.length; second += 1) {
      const difference = weaveDifferences(
        round.options[first],
        round.options[second],
      );
      assert.ok(
        difference.total >= 2,
        `${label}: choices ${first + 1} and ${second + 1} differ in at least two positions`,
      );
    }
  }
}

function assertDistractorSemantics(round, label) {
  const correctKey = weaveKey(round.correctPattern);

  for (const [optionIndex, option] of round.options.entries()) {
    const kind = round.optionKinds[optionIndex];
    if (kind === "correct") {
      assert.equal(weaveKey(option), correctKey, `${label}: correct label`);
      continue;
    }

    const difference = weaveDifferences(option, round.correctPattern);
    assert.ok(difference.total > 0, `${label}: ${kind} must be wrong`);

    if (kind === "mirror-only") {
      assert.equal(
        weaveKey(option),
        weaveKey(mirrorOnly(round.clue)),
        `${label}: mirror trap`,
      );
    } else if (kind === "depth-only") {
      assert.equal(
        weaveKey(option),
        weaveKey(depthOnly(round.clue)),
        `${label}: depth-only trap`,
      );
    } else if (kind === "top-turn") {
      assert.equal(
        weaveKey(option),
        weaveKey(turnOverTop(round.clue)),
        `${label}: top-turn trap`,
      );
    } else if (kind === "one-crossing-off") {
      assert.equal(difference.crossingIndexes.length, 1, `${label}: local crossing`);
      assert.equal(difference.verticalRibbonIndexes.length, 0);
      assert.equal(difference.horizontalRibbonIndexes.length, 0);
    } else if (kind === "two-crossings-off") {
      assert.equal(difference.crossingIndexes.length, 2, `${label}: two crossings`);
      assert.equal(difference.verticalRibbonIndexes.length, 0);
      assert.equal(difference.horizontalRibbonIndexes.length, 0);
    } else if (kind === "one-motif-off") {
      assert.equal(difference.crossingIndexes.length, 0);
      assert.equal(difference.verticalRibbonIndexes.length, 0);
      assert.equal(
        difference.horizontalRibbonIndexes.length,
        1,
        `${label}: local endpoint motif`,
      );
    } else {
      assert.fail(`${label}: unknown distractor kind ${kind}`);
    }
  }
}

function assertDifficulty(round, label) {
  const rule = DIFFICULTY_RULES[round.difficulty];
  const clueRibbons = ribbons(round.clue);
  const motifCount = clueRibbons.filter(({ motif }) => motif !== "none").length;
  const columns = round.clue.verticalRibbons.length;
  const rows = round.clue.horizontalRibbons.length;

  assert.equal(isDifficultyValid(round.clue, round.difficulty), true, `${label}: rules`);
  assert.ok(rule.columns.includes(columns), `${label}: columns`);
  assert.ok(rule.rows.includes(rows), `${label}: rows`);
  assert.equal(columns * rows, rule.crossingCount, `${label}: crossing count`);
  assert.equal(columns + rows, rule.ribbonCount, `${label}: ribbon count`);
  assert.equal(motifCount, rule.motifCount, `${label}: motif count`);
  assert.ok(
    clueRibbons.every(({ color }) =>
      rule.usesBodyColor ? color !== "neutral" : color === "neutral",
    ),
    `${label}: body-color scaffold`,
  );

  if (round.difficulty === "Starter" || round.difficulty === "Junior") {
    assert.ok(
      clueRibbons.every(
        ({ motif, motifEnd }) => motif === "none" && motifEnd === "start",
      ),
      `${label}: no style-only cues`,
    );
    assertSimpleOptionsAreSeparated(round, label);
  } else {
    assert.ok(
      round.clue.verticalRibbons.some(({ motifEnd }) => motifEnd === "start") &&
        round.clue.verticalRibbons.some(({ motifEnd }) => motifEnd === "end"),
      `${label}: vertical endpoint variety`,
    );
    assert.ok(
      round.clue.horizontalRibbons.some(({ motifEnd }) => motifEnd === "start") &&
        round.clue.horizontalRibbons.some(({ motifEnd }) => motifEnd === "end"),
      `${label}: horizontal endpoint variety`,
    );
  }
}

function assertValidRound(round, label) {
  assert.ok(DIFFICULTIES.includes(round.difficulty), `${label}: difficulty`);
  assert.equal(round.options.length, 4, `${label}: four options`);
  assert.equal(round.optionKinds.length, 4, `${label}: four option labels`);
  assert.ok(
    Number.isInteger(round.correctIndex) &&
      round.correctIndex >= 0 &&
      round.correctIndex < 4,
    `${label}: correct index`,
  );

  const expected = otherSideOf(round.clue);
  assert.equal(
    weaveKey(round.correctPattern),
    weaveKey(expected),
    `${label}: answer is calculated from the clue`,
  );
  assert.equal(
    new Set(round.options.map(weaveKey)).size,
    4,
    `${label}: distinct options`,
  );
  assert.deepEqual(
    optionMatchesCorrect(round),
    [round.correctIndex],
    `${label}: one exact answer`,
  );
  assert.equal(round.optionKinds[round.correctIndex], "correct");
  assert.deepEqual(
    new Set(round.optionKinds.filter((kind) => kind !== "correct")),
    EXPECTED_DISTRACTORS[round.difficulty],
    `${label}: misconception curriculum`,
  );

  for (const [optionIndex, option] of round.options.entries()) {
    assert.equal(
      option.verticalRibbons.length,
      round.clue.verticalRibbons.length,
      `${label}: option ${optionIndex + 1} columns`,
    );
    assert.equal(
      option.horizontalRibbons.length,
      round.clue.horizontalRibbons.length,
      `${label}: option ${optionIndex + 1} rows`,
    );
    assert.equal(
      option.crossings.length,
      round.clue.crossings.length,
      `${label}: option ${optionIndex + 1} crossings`,
    );
  }

  assertDifficulty(round, label);
  assertDistractorSemantics(round, label);

  const expectedNearMiss =
    round.difficulty === "Starter" || round.difficulty === "Junior" ? 2 : 1;
  assert.ok(
    round.options.some(
      (option, optionIndex) =>
        optionIndex !== round.correctIndex &&
        weaveDifferences(option, round.correctPattern).total === expectedNearMiss,
    ),
    `${label}: meaningful local near-miss`,
  );
}

test("the opposite-side view reverses crossing depth as well as left and right", () => {
  const clue = ROUNDS.find(({ difficulty }) => difficulty === "Expert").clue;
  const otherSide = otherSideOf(clue);
  const simpleMirror = mirrorOnly(clue);
  const columns = clue.verticalRibbons.length;
  const rows = clue.horizontalRibbons.length;

  assert.notEqual(weaveKey(otherSide), weaveKey(simpleMirror));
  assert.deepEqual(
    otherSide.verticalRibbons,
    [...clue.verticalRibbons].reverse(),
    "left and right ribbon lanes swap",
  );
  assert.deepEqual(
    otherSide.horizontalRibbons.map(({ motifEnd }) => motifEnd),
    clue.horizontalRibbons.map(({ motifEnd }) =>
      motifEnd === "start" ? "end" : "start",
    ),
    "horizontal endpoint symbols swap ends",
  );
  assert.deepEqual(
    otherSide.verticalRibbons.map(({ motifEnd }) => motifEnd),
    [...clue.verticalRibbons].reverse().map(({ motifEnd }) => motifEnd),
    "top and bottom remain fixed",
  );

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const resultIndex = row * columns + column;
      const sourceIndex = row * columns + (columns - column - 1);
      assert.notEqual(
        otherSide.crossings[resultIndex],
        clue.crossings[sourceIndex],
        `crossing ${resultIndex + 1} changes front/back depth`,
      );
      assert.equal(
        simpleMirror.crossings[resultIndex],
        clue.crossings[sourceIndex],
        `simple mirror ${resultIndex + 1} leaves depth wrong`,
      );
    }
  }

  assert.equal(
    weaveKey(otherSideOf(otherSide)),
    weaveKey(clue),
    "walking around twice restores the original view",
  );
  assert.notEqual(weaveKey(TUTORIAL.answer), weaveKey(TUTORIAL.mirror));
  assert.equal(weaveKey(TUTORIAL.answer), weaveKey(otherSideOf(TUTORIAL.clue)));
});

test("Campaign contains 12 valid, unique rounds at every level", () => {
  assert.equal(ROUNDS.length, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);
  assert.deepEqual(
    ROUNDS.map(({ difficulty }) => difficulty),
    DIFFICULTIES.flatMap((difficulty) => Array(12).fill(difficulty)),
  );

  for (const difficulty of DIFFICULTIES) {
    assert.equal(
      ROUNDS.filter((round) => round.difficulty === difficulty).length,
      12,
      `${difficulty} count`,
    );
  }

  for (const [index, round] of ROUNDS.entries()) {
    assertValidRound(round, `Campaign round ${index + 1}`);
  }
});

test("Campaign answer positions are balanced without repeats or a repeated cycle", () => {
  for (const difficulty of DIFFICULTIES) {
    const schedule = ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    ).map(({ correctIndex }) => correctIndex);

    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => schedule.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${difficulty}: 3/3/3/3 balance`,
    );
    assert.ok(
      schedule.every((value, index) => index === 0 || schedule[index - 1] !== value),
      `${difficulty}: no adjacent repeat`,
    );
    assert.ok(
      new Set([0, 4, 8].map((start) => schedule.slice(start, start + 4).join(",")))
        .size > 1,
      `${difficulty}: not one four-position permutation repeated three times`,
    );
  }
});

test("Journey-only Braids banks are frozen, valid, balanced, and disjoint", () => {
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
    buildBraidJourneyExtraCampaignRounds(),
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

  const juniorRounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"];
  assert.deepEqual(
    ["3x2", "2x3"].map(
      (dimensions) =>
        juniorRounds.filter(
          ({ clue }) =>
            `${clue.verticalRibbons.length}x${clue.horizontalRibbons.length}` ===
            dimensions,
        ).length,
    ),
    [6, 6],
    "Junior II balances wide and tall panes",
  );
  assert.deepEqual(
    new Set(
      juniorRounds.map(
        ({ clue }) =>
          clue.crossings.filter((crossing) => crossing === "vertical").length,
      ),
    ),
    new Set([2, 3, 4]),
    "Junior II varies crossing density across its permitted range",
  );

  const expertRounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"];
  const wizardRounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"];
  for (const round of [...expertRounds, ...wizardRounds]) {
    const localTraps = round.options.filter(
      (option, optionIndex) =>
        optionIndex !== round.correctIndex &&
        weaveDifferences(option, round.correctPattern).total === 1,
    );
    assert.equal(localTraps.length, 2);
  }
  for (const [level, rounds] of [
    ["Expert II", expertRounds],
    ["Wizard II", wizardRounds],
  ]) {
    assert.deepEqual(
      new Set(
        rounds.map(
          ({ clue }) =>
            clue.crossings.filter(
              (crossing) => crossing === "vertical",
            ).length,
        ),
      ),
      new Set([3, 4, 5, 6]),
      `${level} varies crossing density across its permitted range`,
    );
  }
  assert.ok(
    expertRounds.every((round) =>
      ribbons(round.clue).every(({ color }) => color !== "neutral"),
    ),
    "Expert II keeps the body-color scaffold",
  );
  assert.ok(
    wizardRounds.every((round) =>
      ribbons(round.clue).every(({ color }) => color === "neutral"),
    ),
    "Wizard II removes the body-color scaffold",
  );

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Journey campaign construction cannot consult randomness.");
  };
  try {
    assert.deepEqual(
      buildBraidJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("Expert and Wizard keep one-detail traps while Wizard removes body color", () => {
  for (const difficulty of ["Expert", "Wizard"]) {
    for (const [index, round] of ROUNDS.filter(
      (candidate) => candidate.difficulty === difficulty,
    ).entries()) {
      const localTraps = round.options.filter(
        (option, optionIndex) =>
          optionIndex !== round.correctIndex &&
          weaveDifferences(option, round.correctPattern).total === 1,
      );
      assert.equal(
        localTraps.length,
        2,
        `${difficulty} round ${index + 1}: crossing and motif near-misses`,
      );
    }
  }

  const profile = (difficulty) =>
    ROUNDS.filter((round) => round.difficulty === difficulty).map((round) => [
      round.clue.verticalRibbons.length,
      round.clue.horizontalRibbons.length,
      round.clue.crossings.length,
      ribbons(round.clue).filter(({ motif }) => motif !== "none").length,
    ]);
  assert.deepEqual(profile("Wizard"), profile("Expert"));
  assert.ok(
    ROUNDS.filter(({ difficulty }) => difficulty === "Expert").every((round) =>
      ribbons(round.clue).every(({ color }) => color !== "neutral"),
    ),
  );
  assert.ok(
    ROUNDS.filter(({ difficulty }) => difficulty === "Wizard").every((round) =>
      ribbons(round.clue).every(({ color }) => color === "neutral"),
    ),
  );
});

test("1,600 deterministic seed rounds are valid and reproducible", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const answerPositions = new Set();
    const dimensionProfiles = new Set();

    for (let seedIndex = 0; seedIndex < SEEDS_PER_DIFFICULTY; seedIndex += 1) {
      const seed =
        0xb4a1_0000 + difficultyIndex * 0x1_0000 + seedIndex;
      const first = generateInfiniteRound(difficulty, makeSeededRandom(seed));
      const second = generateInfiniteRound(difficulty, makeSeededRandom(seed));
      const label = `${difficulty} seed ${seedIndex + 1}`;

      assert.deepEqual(first, second, `${label}: reproducible`);
      assertValidRound(first, label);
      answerPositions.add(first.correctIndex);
      dimensionProfiles.add(
        `${first.clue.verticalRibbons.length}x${first.clue.horizontalRibbons.length}`,
      );
    }

    assert.deepEqual(answerPositions, new Set([0, 1, 2, 3]));
    if (difficulty === "Junior") {
      assert.deepEqual(dimensionProfiles, new Set(["3x2", "2x3"]));
    } else {
      assert.equal(dimensionProfiles.size, 1);
    }
  }
});

test("a deterministic Infinite session can reject repeats and keep unique fingerprints", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const random = makeSeededRandom(0x51a7_7000 + difficultyIndex);
    const fingerprints = new Set();
    let draws = 0;

    while (fingerprints.size < 100 && draws < 2_000) {
      fingerprints.add(roundFingerprint(generateInfiniteRound(difficulty, random)));
      draws += 1;
    }

    assert.equal(
      fingerprints.size,
      100,
      `${difficulty}: 100 nonrepeating session rounds`,
    );
    assert.ok(draws < 2_000, `${difficulty}: bounded repeat rejection`);
  }
});

test("fingerprints ignore option ordering and which side is used as the clue", () => {
  const round = ROUNDS.find(({ difficulty }) => difficulty === "Expert");
  const reordered = {
    ...round,
    options: [...round.options].reverse(),
    optionKinds: [...round.optionKinds].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  const viewedFromBack = {
    ...round,
    clue: otherSideOf(round.clue),
    correctPattern: round.clue,
  };

  assert.equal(roundFingerprint(reordered), roundFingerprint(round));
  assert.equal(roundFingerprint(viewedFromBack), roundFingerprint(round));
});

test("authored rounds build deterministically without consulting randomness", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Campaign construction must not use randomness.");
  };
  try {
    assert.deepEqual(buildCampaignRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});

test("hostile random sources are rejected or exhaust the bounded generator", () => {
  let calls = 0;
  assert.throws(
    () =>
      generateInfiniteRound("Starter", () => {
        calls += 1;
        return 0;
      }),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.ok(calls >= GENERATOR_MAX_ATTEMPTS);
  assert.ok(
    calls <= GENERATOR_MAX_ATTEMPTS * 20,
    "bounded attempts also bound random-source calls",
  );

  for (const invalidValue of [
    Number.NaN,
    -0.01,
    1,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => generateInfiniteRound("Starter", () => invalidValue),
      /Random source must return a finite value from 0 up to 1/,
    );
  }
  assert.throws(
    () => generateInfiniteRound("Impossible", makeSeededRandom(1)),
    /Unknown difficulty/,
  );

  const seeded = makeSeededRandom(731);
  let retryCalls = 0;
  const initiallyDegenerate = () => {
    retryCalls += 1;
    return retryCalls <= 30 ? 0 : seeded();
  };
  const recovered = generateInfiniteRound("Starter", initiallyDegenerate);
  assertValidRound(recovered, "recovered after rejected candidates");
  assert.ok(retryCalls > 30);
});
