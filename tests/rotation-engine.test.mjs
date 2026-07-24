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
  validateRound,
} from "../app/games/rotation-match/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildRotationJourneyExtraCampaignRounds,
} from "../app/games/rotation-match/journey-campaign.ts";
import { progressionAdapter } from "../app/games/rotation-match/progression-adapter.ts";

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Wizard"];
const CAMPAIGN_DIFFICULTIES = DIFFICULTIES;
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
  assert.deepEqual(validateRound(round), [], `${label} validator`);
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

test("each campaign level balances the correct answer across all four positions", () => {
  for (const difficulty of CAMPAIGN_DIFFICULTIES) {
    const rounds = ROUNDS.filter((round) => round.difficulty === difficulty);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (correctIndex) =>
          rounds.filter((round) => round.correctIndex === correctIndex).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} answer position distribution`,
    );
  }
});

test("Journey II Rotation Match banks are frozen, validated, balanced, and disjoint", () => {
  const expectations = {
    "junior-2": "Medium",
    "expert-2": "Hard",
    "wizard-2": "Wizard",
  };
  const standaloneIds = ROUNDS.map(roundFingerprint);
  const fingerprints = new Set(standaloneIds);

  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);

  for (const [level, difficulty] of Object.entries(expectations)) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    const positions = rounds.map(({ correctIndex }) => correctIndex);
    assert.equal(rounds.length, 12, `${level} round count`);
    assert.equal(Object.isFrozen(rounds), true, `${level} frozen bank`);
    assert.ok(
      rounds.every((round) => round.difficulty === difficulty),
      `${level} canonical difficulty`,
    );
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) =>
          positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${level} answer balance`,
    );
    assert.ok(
      positions.every(
        (position, index) =>
          index === 0 || positions[index - 1] !== position,
      ),
      `${level} adjacent answer repeat`,
    );
    const blocks = [0, 4, 8].map((start) =>
      positions.slice(start, start + 4).join(","),
    );
    assert.equal(
      new Set(blocks).size,
      blocks.length,
      `${level} repeated four-answer cycle`,
    );

    for (const [index, round] of rounds.entries()) {
      assertValidRound(round, `${level} round ${index + 1}`);
      const fingerprint = roundFingerprint(round);
      assert.equal(
        fingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1} repeats content`,
      );
      fingerprints.add(fingerprint);
    }
  }

  assert.equal(fingerprints.size, 84);
  assert.deepEqual(ROUNDS.map(roundFingerprint), standaloneIds);
});

test("Journey II rounds cover every transform with honest tier mechanics", () => {
  const transformKey = ({ transform }) =>
    transform.kind === "rotation"
      ? `${transform.direction}:${transform.degrees}`
      : `reflection:${transform.axis}`;
  const expectedTransforms = new Set([
    "clockwise:90",
    "clockwise:180",
    "clockwise:270",
    "counterclockwise:90",
    "counterclockwise:180",
    "counterclockwise:270",
    "reflection:vertical",
    "reflection:horizontal",
    "reflection:main-diagonal",
    "reflection:anti-diagonal",
  ]);
  const junior = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"];
  const expert = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"];
  const wizard = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"];

  for (const [level, rounds] of Object.entries(
    JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  )) {
    assert.deepEqual(
      new Set(rounds.map(transformKey)),
      expectedTransforms,
      `${level} transform coverage`,
    );
    assert.ok(
      rounds.every(
        ({ clue }) =>
          new Set(
            clue
              .filter(({ color }) => color !== "empty")
              .map(({ color }) => color),
          ).size >= 3,
      ),
      `${level} should use varied, legible colors`,
    );
  }

  assert.deepEqual(
    junior.map(({ clue }) =>
      clue.filter(({ color }) => color !== "empty").length,
    ),
    [6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5],
  );
  assert.ok(
    junior.every(({ clue }) =>
      clue.every(({ motif }) => motif === "none"),
    ),
  );
  assert.ok(
    junior.every(({ optionKinds }) =>
      optionKinds.includes("one-block-off"),
    ),
  );

  const complexityProfile = (rounds) =>
    rounds.map(({ clue }) => {
      const filled = clue.filter(({ color }) => color !== "empty");
      return `${filled.length}:${
        filled.filter(({ motif }) => motif === "cap").length
      }`;
    });
  assert.deepEqual(
    complexityProfile(expert),
    complexityProfile(wizard),
    "Wizard II must deepen inference without adding visual density",
  );
  assert.deepEqual(complexityProfile(expert), [
    "6:2",
    "7:3",
    "6:4",
    "7:2",
    "6:3",
    "7:4",
    "6:2",
    "7:3",
    "6:4",
    "7:2",
    "6:3",
    "7:4",
  ]);
  assert.ok(
    expert.every(
      ({ optionKinds }) =>
        optionKinds.includes("one-motif-off") &&
        optionKinds.includes("one-block-off"),
    ),
  );

  for (const [index, round] of wizard.entries()) {
    assert.equal(
      round.optionKinds.filter((kind) => kind === "one-motif-off")
        .length,
      2,
    );
    assert.ok(round.optionKinds.includes("one-block-off"));
    assert.deepEqual(
      hiddenTransformOptionIndexes(round.clue, round.options),
      [round.correctIndex],
      `Wizard II ${index + 1} hidden answer`,
    );
    for (const [optionIndex, option] of round.options.entries()) {
      if (optionIndex === round.correctIndex) continue;
      const differenceCount = differingTileIndexes(
        option,
        round.correctPattern,
      ).length;
      assert.ok(
        differenceCount >= 1 && differenceCount <= 2,
        `Wizard II ${index + 1} option ${optionIndex + 1}`,
      );
    }
  }
});

test("Journey II banks rebuild without randomness and wire all seven adapter levels", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Authored Journey rounds cannot consult randomness.");
  };
  try {
    assert.deepEqual(
      buildRotationJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(progressionAdapter.campaignRounds.length, 48);
  assert.equal(progressionAdapter.journeyContentVersion, "1");
  assert.deepEqual(
    Object.keys(progressionAdapter.journeyCampaignRounds),
    [
      "starter",
      "junior-1",
      "junior-2",
      "expert-1",
      "expert-2",
      "wizard-1",
      "wizard-2",
    ],
  );
  for (const [journeyLevel, rounds] of Object.entries(
    progressionAdapter.journeyCampaignRounds,
  )) {
    assert.equal(rounds.length, 12, `${journeyLevel} adapter bank`);
  }
  for (const level of ["junior-2", "expert-2", "wizard-2"]) {
    assert.deepEqual(
      progressionAdapter.journeyCampaignRounds[level].map(
        roundFingerprint,
      ),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level].map(roundFingerprint),
    );
  }
});

test("the complete round validator rejects corrupted authored state", () => {
  const source = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"][0];
  const duplicateOptions = [...source.options];
  const wrongIndex = source.correctIndex === 0 ? 1 : 0;
  duplicateOptions[wrongIndex] = source.correctPattern;
  const duplicateErrors = validateRound({
    ...source,
    options: duplicateOptions,
  });
  assert.ok(
    duplicateErrors.some((error) =>
      error.includes("Exactly one option"),
    ),
  );
  assert.ok(
    duplicateErrors.some((error) =>
      error.includes("distinct"),
    ),
  );

  assert.ok(
    validateRound({ ...source, turn: "incorrect label" }).some(
      (error) => error.includes("label"),
    ),
  );
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
    const fullOrbitKeys = new Set([
      patternKey(round.clue),
      ...hiddenTransformKeys(round.clue),
    ]);
    assert.equal(
      hiddenTransformKeys(round.clue).size,
      7,
      `wizard ${index + 1} must have no rotational or mirror symmetry`,
    );
    assert.equal(fullOrbitKeys.size, 8);
    assert.deepEqual(
      hiddenTransformOptionIndexes(round.clue, round.options),
      [round.correctIndex],
      `wizard ${index + 1} hidden answer`,
    );
    assert.equal(new Set(round.options.map(patternKey)).size, 4);
    assert.ok(
      round.options.every(
        (option, optionIndex) =>
          optionIndex === round.correctIndex ||
          !fullOrbitKeys.has(patternKey(option)),
      ),
      `wizard ${index + 1} traps must be outside the transform orbit`,
    );
  }
});

test("wizard rounds match expert complexity and use only close near-misses", () => {
  const complexityProfile = (difficulty) =>
    ROUNDS.filter((round) => round.difficulty === difficulty)
      .map((round) => {
        const filled = round.clue.filter(({ color }) => color !== "empty");
        const motifs = filled.filter(({ motif }) => motif === "cap");
        return `${filled.length}:${motifs.length}`;
      })
      .sort();

  assert.deepEqual(complexityProfile("Wizard"), complexityProfile("Hard"));

  for (const [index, round] of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  ).entries()) {
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

test("1,600 seeded generated rounds are exact, unique, and asymmetric", () => {
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
  const expertRules = {
    minFilled: 6,
    maxFilled: 7,
    minMotifs: 2,
    maxMotifs: 4,
  };
  const expected = {
    Easy: { minFilled: 3, maxFilled: 4, minMotifs: 0, maxMotifs: 0 },
    Medium: { minFilled: 5, maxFilled: 6, minMotifs: 0, maxMotifs: 0 },
    Hard: expertRules,
    Wizard: expertRules,
  };

  assert.deepEqual(expected.Wizard, expected.Hard);

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
      if (difficulty === "Hard" || difficulty === "Wizard") {
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

test("generated wizard traps are close, distinct, and outside the full transform orbit", () => {
  for (const [roundIndex, round] of GENERATED.Wizard.entries()) {
    assert.deepEqual(
      hiddenTransformOptionIndexes(round.clue, round.options),
      [round.correctIndex],
      `generated wizard ${roundIndex + 1} hidden answer`,
    );

    const fullOrbitKeys = new Set([
      patternKey(round.clue),
      ...hiddenTransformKeys(round.clue),
    ]);
    assert.equal(fullOrbitKeys.size, 8);
    assert.equal(new Set(round.options.map(patternKey)).size, 4);

    for (const [optionIndex, option] of round.options.entries()) {
      if (optionIndex === round.correctIndex) continue;
      const differenceCount = differingTileIndexes(
        option,
        round.correctPattern,
      ).length;
      assert.ok(
        differenceCount >= 1 && differenceCount <= 2,
        `generated wizard ${roundIndex + 1} trap ${optionIndex + 1}`,
      );
      assert.ok(
        !fullOrbitKeys.has(patternKey(option)),
        `generated wizard ${roundIndex + 1} trap ${optionIndex + 1} orbit`,
      );
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
  assertValidRound(
    generateInfiniteRound("Wizard", makeSeededRandom(1)),
    "seeded wizard round",
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
