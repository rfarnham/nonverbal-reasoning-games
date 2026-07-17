import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  TUTORIAL,
  applyRotation,
  applyTransform,
  buildRounds,
  differingTileIndexes,
  generateInfiniteRound,
  hiddenTransformKeys,
  hiddenTransformOptionIndexes,
  patternKey,
  reflectPattern,
  rotatePattern,
  roundFingerprint,
} from "../app/games/rotation-match/game-engine.ts";

const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const CAMPAIGN_DIFFICULTIES = [...DIFFICULTIES, "Wizard"];
const MIRROR_AXES = [
  "vertical",
  "horizontal",
  "main-diagonal",
  "anti-diagonal",
];

function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function assertValidRound(round, label) {
  assert.equal(round.clue.length, 9, `${label} clue size`);
  assert.equal(round.options.length, 4, `${label} option count`);
  assert.equal(round.optionKinds.length, 4, `${label} option labels`);
  assert.ok(
    Number.isInteger(round.correctIndex) &&
      round.correctIndex >= 0 &&
      round.correctIndex < 4,
    `${label} correct index`,
  );

  const expected = applyTransform(round.clue, round.transform);
  const expectedKey = patternKey(expected);
  assert.equal(
    patternKey(round.correctPattern),
    expectedKey,
    `${label} computed answer`,
  );
  assert.equal(
    new Set(round.options.map(patternKey)).size,
    4,
    `${label} options must be distinct`,
  );
  assert.deepEqual(
    round.options.flatMap((option, optionIndex) =>
      patternKey(option) === expectedKey ? [optionIndex] : [],
    ),
    [round.correctIndex],
    `${label} must have exactly one exact answer`,
  );
  assert.equal(round.optionKinds[round.correctIndex], "correct");
}

function generatedCorpus(countPerDifficulty = 400) {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty, difficultyIndex) => {
      const random = makeSeededRandom(0x51a7_1000 + difficultyIndex);
      return [
        difficulty,
        Array.from({ length: countPerDifficulty }, () =>
          generateInfiniteRound(difficulty, random),
        ),
      ];
    }),
  );
}

const GENERATED = generatedCorpus();

test("the authored session contains 12 rounds at each progressive difficulty", () => {
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    CAMPAIGN_DIFFICULTIES.map((difficulty) =>
      ROUNDS.filter((round) => round.difficulty === difficulty).length,
    ),
    [12, 12, 12, 12],
  );
  assert.deepEqual(
    ROUNDS.map((round) => round.difficulty),
    CAMPAIGN_DIFFICULTIES.flatMap((difficulty) =>
      Array(12).fill(difficulty),
    ),
  );
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);

  for (const [index, round] of ROUNDS.entries()) {
    assertValidRound(round, `authored round ${index + 1}`);
  }
});

test("each authored difficulty covers every turn length, direction, and reflection axis", () => {
  for (const difficulty of CAMPAIGN_DIFFICULTIES) {
    const rounds = ROUNDS.filter((round) => round.difficulty === difficulty);
    const rotations = rounds.filter(
      ({ transform }) => transform.kind === "rotation",
    );
    const reflections = rounds.filter(
      ({ transform }) => transform.kind === "reflection",
    );

    assert.deepEqual(
      new Set(rotations.map(({ transform }) => transform.direction)),
      new Set(["clockwise", "counterclockwise"]),
    );
    assert.deepEqual(
      new Set(rotations.map(({ transform }) => transform.degrees)),
      new Set([90, 180, 270]),
    );
    assert.deepEqual(
      new Set(reflections.map(({ transform }) => transform.axis)),
      new Set(MIRROR_AXES),
    );
    assert.ok(
      rotations.every(({ transform }) =>
        transform.direction === "clockwise"
          ? transform.angleDegrees > 0
          : transform.angleDegrees < 0,
      ),
    );
  }
});

test("authored progression stays flat before directional motifs appear on hard and wizard", () => {
  for (const round of ROUNDS.filter(({ difficulty }) =>
    ["Easy", "Medium"].includes(difficulty),
  )) {
    assert.ok(round.clue.every((tile) => tile.motif === "none"));
  }

  for (const round of ROUNDS.filter(({ difficulty }) =>
    ["Hard", "Wizard"].includes(difficulty),
  )) {
    assert.ok(round.clue.some((tile) => tile.motif === "cap"));
    assert.ok(round.optionKinds.includes("one-motif-off"));
  }

  for (const round of ROUNDS.filter(({ difficulty }) => difficulty === "Medium")) {
    assert.ok(round.optionKinds.includes("one-block-off"));
  }
});

test("wizard rounds have one and only one valid answer with the operation hidden", () => {
  const wizardRounds = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  );
  assert.equal(wizardRounds.length, 12);

  for (const [index, round] of wizardRounds.entries()) {
    assert.equal(
      hiddenTransformKeys(round.clue).size,
      7,
      `wizard ${index + 1} must have no rotational or mirror symmetry`,
    );
    assert.deepEqual(
      hiddenTransformOptionIndexes(round.clue, round.options),
      [round.correctIndex],
      `wizard ${index + 1} hidden answer`,
    );
    assert.equal(new Set(round.options.map(patternKey)).size, 4);
  }
});

test("wizard rounds are dense motif puzzles with only close near-misses", () => {
  for (const [index, round] of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  ).entries()) {
    const filled = round.clue.filter(({ color }) => color !== "empty");
    const motifs = filled.filter(({ motif }) => motif === "cap");
    assert.ok(filled.length >= 7, `wizard ${index + 1} density`);
    assert.ok(motifs.length >= 4, `wizard ${index + 1} motifs`);
    assert.equal(
      round.optionKinds.filter((kind) => kind === "one-motif-off").length,
      2,
    );
    assert.ok(round.optionKinds.includes("one-block-off"));

    for (const [optionIndex, option] of round.options.entries()) {
      if (optionIndex === round.correctIndex) continue;
      const differences = differingTileIndexes(option, round.correctPattern);
      assert.ok(
        differences.length >= 1 && differences.length <= 2,
        `wizard ${index + 1} option ${optionIndex + 1} closeness`,
      );
    }
  }
});

test("authored mirror distractors are the stated exact reflections", () => {
  const kindToAxis = {
    "mirror-vertical": "vertical",
    "mirror-horizontal": "horizontal",
    "mirror-main-diagonal": "main-diagonal",
    "mirror-anti-diagonal": "anti-diagonal",
  };
  const optionKinds = new Set(ROUNDS.flatMap((round) => round.optionKinds));

  for (const kind of Object.keys(kindToAxis)) assert.ok(optionKinds.has(kind));

  for (const [roundIndex, round] of ROUNDS.entries()) {
    for (const [optionIndex, kind] of round.optionKinds.entries()) {
      if (!(kind in kindToAxis)) continue;
      assert.equal(
        patternKey(round.options[optionIndex]),
        patternKey(reflectPattern(round.clue, kindToAxis[kind])),
        `round ${roundIndex + 1} ${kind}`,
      );
    }
  }
});

test("motif orientation follows rotations and reflections", () => {
  const source = [
    { color: "empty", motif: "none", orientation: 0 },
    { color: "coral", motif: "cap", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
  ];

  const clockwise = rotatePattern(source, 1);
  assert.equal(clockwise[5].color, "coral");
  assert.equal(clockwise[5].orientation, 1);

  const counterclockwise = rotatePattern(source, -1);
  assert.equal(counterclockwise[3].color, "coral");
  assert.equal(counterclockwise[3].orientation, 3);

  assert.equal(reflectPattern(source, "vertical")[1].orientation, 0);
  assert.equal(reflectPattern(source, "horizontal")[7].orientation, 2);
  assert.equal(reflectPattern(source, "main-diagonal")[3].orientation, 3);
  assert.equal(reflectPattern(source, "anti-diagonal")[5].orientation, 1);

  for (const axis of MIRROR_AXES) {
    for (const orientation of [0, 1, 2, 3]) {
      const oriented = source.map((tile) =>
        tile.color === "coral" ? { ...tile, orientation } : tile,
      );
      assert.equal(
        patternKey(reflectPattern(reflectPattern(oriented, axis), axis)),
        patternKey(oriented),
        `${axis} inverse at orientation ${orientation}`,
      );
    }
  }
});

test("difference indexes identify exact block and motif mistakes", () => {
  for (const [roundIndex, round] of ROUNDS.entries()) {
    assert.deepEqual(
      differingTileIndexes(round.correctPattern, round.correctPattern),
      [],
    );

    for (const [optionIndex, kind] of round.optionKinds.entries()) {
      const option = round.options[optionIndex];
      const differences = differingTileIndexes(option, round.correctPattern);
      assert.equal(
        differences.length === 0,
        kind === "correct",
        `round ${roundIndex + 1} ${kind}`,
      );

      if (kind === "one-block-off") {
        assert.equal(differences.length, 2);
        const occupancyChanges = differences
          .map((index) => [
            option[index].color === "empty",
            round.correctPattern[index].color === "empty",
          ])
          .sort();
        assert.deepEqual(occupancyChanges, [
          [false, true],
          [true, false],
        ]);
      }

      if (kind === "one-motif-off") {
        assert.equal(differences.length, 1);
        const index = differences[0];
        assert.equal(option[index].color, round.correctPattern[index].color);
        assert.equal(option[index].motif, round.correctPattern[index].motif);
        assert.notEqual(
          option[index].orientation,
          round.correctPattern[index].orientation,
        );
      }
    }
  }

  assert.throws(
    () => differingTileIndexes(ROUNDS[0].clue.slice(1), ROUNDS[0].clue),
    /same number of tiles/,
  );
});

test("1,200 seeded generated rounds are exact, unique, and asymmetric", () => {
  for (const difficulty of DIFFICULTIES) {
    const fingerprints = new Set();
    for (const [index, round] of GENERATED[difficulty].entries()) {
      assertValidRound(round, `${difficulty} generated round ${index + 1}`);
      assert.equal(round.difficulty, difficulty);
      fingerprints.add(roundFingerprint(round));

      const orbit = [
        patternKey(round.clue),
        patternKey(rotatePattern(round.clue, 1)),
        patternKey(rotatePattern(round.clue, 2)),
        patternKey(rotatePattern(round.clue, 3)),
        ...MIRROR_AXES.map((axis) =>
          patternKey(reflectPattern(round.clue, axis)),
        ),
      ];
      assert.equal(new Set(orbit).size, 8, `${difficulty} full orbit`);
    }
    assert.equal(
      fingerprints.size,
      GENERATED[difficulty].length,
      `${difficulty} seeded corpus should not repeat`,
    );
  }
});

test("generated density and motif rules scale with difficulty", () => {
  const expected = {
    Easy: { minFilled: 3, maxFilled: 4, minMotifs: 0, maxMotifs: 0 },
    Medium: { minFilled: 5, maxFilled: 6, minMotifs: 0, maxMotifs: 0 },
    Hard: { minFilled: 6, maxFilled: 7, minMotifs: 2, maxMotifs: 4 },
  };

  for (const difficulty of DIFFICULTIES) {
    const rules = expected[difficulty];
    for (const round of GENERATED[difficulty]) {
      const filled = round.clue.filter((tile) => tile.color !== "empty");
      const motifs = filled.filter((tile) => tile.motif === "cap");
      assert.ok(filled.length >= rules.minFilled);
      assert.ok(filled.length <= rules.maxFilled);
      assert.ok(motifs.length >= rules.minMotifs);
      assert.ok(motifs.length <= rules.maxMotifs);
      assert.ok(new Set(filled.map((tile) => tile.color)).size >= 2);
    }
  }
});

test("seeded generated corpora cover every transformation at every difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    const rotations = rounds.filter(
      ({ transform }) => transform.kind === "rotation",
    );
    const reflections = rounds.filter(
      ({ transform }) => transform.kind === "reflection",
    );
    assert.deepEqual(
      new Set(rotations.map(({ transform }) => transform.direction)),
      new Set(["clockwise", "counterclockwise"]),
    );
    assert.deepEqual(
      new Set(rotations.map(({ transform }) => transform.degrees)),
      new Set([90, 180, 270]),
    );
    assert.deepEqual(
      new Set(reflections.map(({ transform }) => transform.axis)),
      new Set(MIRROR_AXES),
    );
  }
});

test("generated distractors always include a meaningful close mistake", () => {
  const mirrorKindToAxis = {
    "mirror-vertical": "vertical",
    "mirror-horizontal": "horizontal",
    "mirror-main-diagonal": "main-diagonal",
    "mirror-anti-diagonal": "anti-diagonal",
  };

  for (const difficulty of DIFFICULTIES) {
    for (const round of GENERATED[difficulty]) {
      const wrongDifferences = round.options.flatMap((option, optionIndex) =>
        optionIndex === round.correctIndex
          ? []
          : [differingTileIndexes(option, round.correctPattern)],
      );
      assert.ok(wrongDifferences.every((differences) => differences.length > 0));
      assert.ok(wrongDifferences.some((differences) => differences.length <= 2));
      assert.ok(round.optionKinds.includes("one-block-off"));
      if (difficulty === "Hard") {
        assert.ok(round.optionKinds.includes("one-motif-off"));
      } else {
        assert.ok(!round.optionKinds.includes("one-motif-off"));
      }

      for (const [optionIndex, kind] of round.optionKinds.entries()) {
        if (kind === "correct") continue;
        const option = round.options[optionIndex];
        const differences = differingTileIndexes(option, round.correctPattern);

        if (kind === "one-block-off") {
          assert.equal(differences.length, 2);
          assert.equal(
            differences.filter(
              (index) =>
                option[index].color === "empty" &&
                round.correctPattern[index].color !== "empty",
            ).length,
            1,
          );
          assert.equal(
            differences.filter(
              (index) =>
                option[index].color !== "empty" &&
                round.correctPattern[index].color === "empty",
            ).length,
            1,
          );
        }

        if (kind === "one-motif-off") {
          assert.equal(differences.length, 1);
          const index = differences[0];
          assert.equal(option[index].color, round.correctPattern[index].color);
          assert.equal(option[index].motif, round.correctPattern[index].motif);
          assert.notEqual(
            option[index].orientation,
            round.correctPattern[index].orientation,
          );
        }

        if (kind in mirrorKindToAxis) {
          assert.equal(
            patternKey(option),
            patternKey(reflectPattern(round.clue, mirrorKindToAxis[kind])),
          );
        }
      }
    }
  }
});

test("the infinite generator is reproducible with an injected seed", () => {
  for (const difficulty of DIFFICULTIES) {
    const firstRandom = makeSeededRandom(0xdecafbad);
    const secondRandom = makeSeededRandom(0xdecafbad);
    const first = Array.from({ length: 50 }, () =>
      generateInfiniteRound(difficulty, firstRandom),
    );
    const second = Array.from({ length: 50 }, () =>
      generateInfiniteRound(difficulty, secondRandom),
    );
    assert.deepEqual(first, second);
  }
});

test("round fingerprints ignore option order and answer-equivalent instructions", () => {
  const round = ROUNDS[0];
  const reordered = {
    ...round,
    options: [...round.options].reverse(),
    optionKinds: [...round.optionKinds].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  const equivalentInstruction = {
    ...round,
    transform: {
      kind: "rotation",
      direction: "counterclockwise",
      quarterTurns: 3,
      degrees: 270,
      angleDegrees: -270,
    },
    turn: "270° counterclockwise",
  };

  assert.equal(roundFingerprint(reordered), roundFingerprint(round));
  assert.equal(roundFingerprint(equivalentInstruction), roundFingerprint(round));
});

test("generation retries rejected candidates and fails safely for hostile randomness", () => {
  const seeded = makeSeededRandom(731);
  let calls = 0;
  const initiallyDegenerate = () => {
    calls += 1;
    return calls <= 24 ? 0 : seeded();
  };
  assertValidRound(
    generateInfiniteRound("Easy", initiallyDegenerate),
    "retried generated round",
  );
  assert.ok(calls > 24);

  assert.throws(
    () => generateInfiniteRound("Easy", () => 0),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  for (const invalidValue of [Number.NaN, -0.01, 1, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => generateInfiniteRound("Easy", () => invalidValue),
      /Random source must return/,
    );
  }
  assert.throws(
    () => generateInfiniteRound("Impossible", makeSeededRandom(1)),
    /Unknown difficulty/,
  );
  assert.throws(
    () => generateInfiniteRound("Wizard", makeSeededRandom(1)),
    /Unknown difficulty/,
  );
});

test("tutorial demonstrates a true turn beside a mirror trap", () => {
  assert.equal(
    patternKey(TUTORIAL.answer),
    patternKey(applyRotation(TUTORIAL.clue, TUTORIAL.transform)),
  );
  assert.notEqual(patternKey(TUTORIAL.answer), patternKey(TUTORIAL.mirror));
});

test("authored rounds build deterministically without consulting randomness", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("buildRounds must not use randomness");
  };
  try {
    assert.deepEqual(buildRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});
