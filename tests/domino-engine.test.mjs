import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  PIP_PATTERNS,
  ROUNDS,
  TILING_LAYOUTS,
  TUTORIAL,
  analyzeImpossibleDesign,
  buildCampaignRounds,
  designKey,
  differingCellIndexes,
  enumerateBuildableDesigns,
  findBuildWitnesses,
  generateInfiniteRound,
  isDesignBuildable,
  isDirectionalPipMask,
  isPipMask,
  legalLayoutIds,
  makeSeededRandom,
  renderWitness,
  rotatePipMask,
  roundFingerprint,
  validateRound,
} from "../app/games/domino-twist/game-engine.ts";

const DIFFICULTIES = ["Starter", "Junior", "Expert", "Wizard"];
const GENERATED_COUNT_PER_DIFFICULTY = 400;

function physicalPieceKey(piece) {
  const forward = `${piece.first.toString(16)}:${piece.second.toString(16)}`;
  const reversed = `${rotatePipMask(piece.second, 2).toString(16)}:${rotatePipMask(
    piece.first,
    2,
  ).toString(16)}`;
  return forward < reversed ? forward : reversed;
}

function makeGeneratedCorpus() {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty, difficultyIndex) => {
      const fingerprints = new Set();
      const rounds = Array.from(
        { length: GENERATED_COUNT_PER_DIFFICULTY },
        (_, seedIndex) => {
          const seed =
            0x6d00_0000 + difficultyIndex * 0x1_0000 + seedIndex;
          const round = generateInfiniteRound(
            difficulty,
            makeSeededRandom(seed),
            fingerprints,
          );
          fingerprints.add(roundFingerprint(round));
          return round;
        },
      );
      return [difficulty, rounds];
    }),
  );
}

const GENERATED = makeGeneratedCorpus();

function assertDifficultyContract(round, label) {
  const rules = DIFFICULTY_RULES[round.difficulty];
  const halves = round.pieces.flatMap(({ first, second }) => [first, second]);
  const directionalCount = halves.filter(isDirectionalPipMask).length;
  const reachable = enumerateBuildableDesigns(
    round.pieces,
    round.rows,
    round.columns,
    round.layoutId,
  );

  assert.equal(round.rows, rules.rows, `${label} row count`);
  assert.equal(round.columns, rules.columns, `${label} column count`);
  assert.equal(round.pieces.length, rules.pieceCount, `${label} piece count`);
  assert.equal(
    round.seamsVisible,
    rules.seamsVisible,
    `${label} seam scaffold`,
  );
  assert.equal(
    round.layoutId !== null,
    rules.seamsVisible,
    `${label} layout disclosure`,
  );
  assert.ok(
    directionalCount >= rules.minDirectionalHalves &&
      directionalCount <= rules.maxDirectionalHalves,
    `${label} directional-half density`,
  );
  assert.ok(
    new Set(halves).size >= rules.minDistinctHalves,
    `${label} distinct halves`,
  );
  assert.equal(
    new Set(round.pieces.map(({ id }) => id)).size,
    round.pieces.length,
    `${label} piece IDs`,
  );
  assert.equal(
    new Set(round.pieces.map(physicalPieceKey)).size,
    round.pieces.length,
    `${label} physically distinct dominoes`,
  );
  assert.ok(
    reachable.length >= rules.minReachableDesigns,
    `${label} reachable-design floor`,
  );
}

function assertRoundContract(round, label) {
  assert.deepEqual(validateRound(round), [], `${label} validator result`);
  assert.equal(round.prompt, "Which design cannot be built?");
  assert.equal(round.options.length, 4, `${label} option count`);
  assert.ok(
    Number.isInteger(round.correctIndex) &&
      round.correctIndex >= 0 &&
      round.correctIndex < 4,
    `${label} answer index`,
  );
  assertDifficultyContract(round, label);

  const reachable = enumerateBuildableDesigns(
    round.pieces,
    round.rows,
    round.columns,
    round.layoutId,
  );
  const reachableKeys = new Set(reachable.map(({ design }) => designKey(design)));
  const optionKeys = round.options.map(({ design }) => designKey(design));
  const impossibleIndexes = optionKeys.flatMap((key, optionIndex) =>
    reachableKeys.has(key) ? [] : [optionIndex],
  );

  assert.equal(new Set(optionKeys).size, 4, `${label} distinct options`);
  if (round.difficulty === "Starter" || round.difficulty === "Junior") {
    for (let first = 0; first < round.options.length; first += 1) {
      for (let second = first + 1; second < round.options.length; second += 1) {
        assert.ok(
          differingCellIndexes(
            round.options[first].design,
            round.options[second].design,
          ).length >= 2,
          `${label} options ${first + 1} and ${second + 1} differ in at least two cells`,
        );
      }
    }
  }
  assert.deepEqual(
    impossibleIndexes,
    [round.correctIndex],
    `${label} exact impossible answer`,
  );

  for (const [optionIndex, option] of round.options.entries()) {
    assert.equal(
      option.design.cells.length,
      round.rows * round.columns,
      `${label} option ${optionIndex + 1} board size`,
    );
    assert.ok(
      option.design.cells.every(isPipMask),
      `${label} option ${optionIndex + 1} pip masks`,
    );

    if (optionIndex !== round.correctIndex) {
      assert.equal(option.buildable, true);
      assert.equal(option.kind, "buildable");
      assert.equal(option.mismatch, null);
      assert.ok(option.witness, `${label} option ${optionIndex + 1} witness`);
      assert.equal(
        designKey(
          renderWitness(
            round.pieces,
            round.rows,
            round.columns,
            option.witness,
          ),
        ),
        designKey(option.design),
        `${label} option ${optionIndex + 1} rendered witness`,
      );
      assert.ok(
        findBuildWitnesses(
          round.pieces,
          option.design,
          round.rows,
          round.columns,
          round.layoutId,
        ).length > 0,
        `${label} option ${optionIndex + 1} exhaustive witness`,
      );
      continue;
    }

    assert.equal(option.buildable, false);
    assert.equal(option.witness, null);
    assert.ok(option.mismatch, `${label} impossible explanation`);
    assert.equal(option.kind, option.mismatch.kind);
    assert.deepEqual(
      option.mismatch,
      analyzeImpossibleDesign(
        round.pieces,
        option.design,
        round.rows,
        round.columns,
        round.layoutId,
      ),
      `${label} recomputed impossible explanation`,
    );
    assert.deepEqual(
      option.mismatch.differingCells,
      differingCellIndexes(
        option.design,
        option.mismatch.closestBuildable,
      ),
      `${label} exact local differences`,
    );
    assert.ok(
      option.mismatch.differingCells.length >= 1 &&
        option.mismatch.differingCells.length <= 2,
      `${label} close impossible design`,
    );
    if (round.difficulty === "Starter" || round.difficulty === "Junior") {
      assert.equal(
        option.mismatch.differingCells.length,
        2,
        `${label} generous early-level mismatch`,
      );
    }
    assert.equal(
      designKey(
        renderWitness(
          round.pieces,
          round.rows,
          round.columns,
          option.mismatch.closestWitness,
        ),
      ),
      designKey(option.mismatch.closestBuildable),
      `${label} closest-buildable witness`,
    );
    assert.ok(
      isDesignBuildable(
        round.pieces,
        option.mismatch.closestBuildable,
        round.rows,
        round.columns,
        round.layoutId,
      ),
      `${label} closest comparison is buildable`,
    );
    assert.ok(option.mismatch.message.trim().length > 0);

    const closest = option.mismatch.closestBuildable;
    const matchedPieces = option.mismatch.closestWitness.placements.filter(
      ({ fromCell, toCell }) =>
        option.design.cells[fromCell] === closest.cells[fromCell] &&
        option.design.cells[toCell] === closest.cells[toCell],
    ).length;
    assert.equal(
      option.mismatch.matchedPieces,
      matchedPieces,
      `${label} matched-piece count`,
    );

    if (option.kind === "seam-trap") {
      assert.notEqual(round.layoutId, null);
      assert.ok(
        isDesignBuildable(
          round.pieces,
          option.design,
          round.rows,
          round.columns,
          null,
        ),
        `${label} seam trap works under another tiling`,
      );
    } else if (option.kind === "twisted-half") {
      assert.equal(option.mismatch.differingCells.length, 1);
    } else {
      assert.equal(option.kind, "broken-pair");
      assert.equal(option.mismatch.differingCells.length, 2);
    }
  }
}

test("pip masks rotate as a whole-domino orientation system", () => {
  const directional = PIP_PATTERNS["corner-l"];
  const invariant = PIP_PATTERNS.corners;

  assert.notEqual(rotatePipMask(directional, 1), directional);
  assert.equal(rotatePipMask(directional, 4), directional);
  assert.equal(rotatePipMask(directional, -1), rotatePipMask(directional, 3));
  assert.equal(rotatePipMask(invariant, 1), invariant);
  assert.equal(isDirectionalPipMask(directional), true);
  assert.equal(isDirectionalPipMask(invariant), false);
  assert.equal(isPipMask(0), true);
  assert.equal(isPipMask((1 << 9) - 1), true);
  assert.equal(isPipMask(-1), false);
  assert.equal(isPipMask(1 << 9), false);
  assert.throws(() => rotatePipMask(-1, 1), /Invalid pip mask/);
});

test("every declared layout is a complete adjacent exact cover", () => {
  for (const layout of Object.values(TILING_LAYOUTS)) {
    const coveredCells = layout.pairs.flat();
    assert.equal(layout.pairs.length, (layout.rows * layout.columns) / 2);
    assert.deepEqual(
      [...coveredCells].sort((left, right) => left - right),
      Array.from({ length: layout.rows * layout.columns }, (_, index) => index),
      `${layout.id} exact cover`,
    );
    for (const [first, second] of layout.pairs) {
      const firstRow = Math.floor(first / layout.columns);
      const firstColumn = first % layout.columns;
      const secondRow = Math.floor(second / layout.columns);
      const secondColumn = second % layout.columns;
      assert.equal(
        Math.abs(firstRow - secondRow) +
          Math.abs(firstColumn - secondColumn),
        1,
        `${layout.id} adjacent pair`,
      );
    }
  }

  assert.deepEqual(legalLayoutIds(2, 2), ["2x2-rows", "2x2-columns"]);
  assert.deepEqual(legalLayoutIds(2, 3), [
    "2x3-columns",
    "2x3-left-stack",
    "2x3-right-stack",
  ]);
});

test("Campaign contains 48 deterministic, unique, fully valid rounds", () => {
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    ROUNDS.map(({ difficulty }) => difficulty),
    DIFFICULTIES.flatMap((difficulty) => Array(12).fill(difficulty)),
  );
  assert.deepEqual(
    DIFFICULTIES.map(
      (difficulty) =>
        ROUNDS.filter((round) => round.difficulty === difficulty).length,
    ),
    [12, 12, 12, 12],
  );
  assert.equal(new Set(ROUNDS.map(({ id }) => id)).size, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);

  for (const [roundIndex, round] of ROUNDS.entries()) {
    assertRoundContract(round, `authored round ${roundIndex + 1}`);
  }

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Campaign authoring must not consult randomness.");
  };
  try {
    assert.deepEqual(buildCampaignRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});

test("Campaign answer positions are balanced and resist guessable sequences", () => {
  for (const difficulty of DIFFICULTIES) {
    const indexes = ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    ).map(({ correctIndex }) => correctIndex);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => indexes.filter((index) => index === position).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} position balance`,
    );
    assert.ok(
      indexes.every(
        (position, index) => index === 0 || position !== indexes[index - 1],
      ),
      `${difficulty} adjacent positions`,
    );
    assert.equal(
      indexes
        .slice(0, 4)
        .every(
          (position, index) =>
            position === indexes[index + 4] &&
            position === indexes[index + 8],
        ),
      false,
      `${difficulty} repeated four-position cycle`,
    );
  }
});

test("the difficulty ladder adds density, orientation, then removes seams", () => {
  assert.deepEqual(
    {
      rows: DIFFICULTY_RULES.Wizard.rows,
      columns: DIFFICULTY_RULES.Wizard.columns,
      pieceCount: DIFFICULTY_RULES.Wizard.pieceCount,
      minDirectionalHalves:
        DIFFICULTY_RULES.Wizard.minDirectionalHalves,
      maxDirectionalHalves:
        DIFFICULTY_RULES.Wizard.maxDirectionalHalves,
      minDistinctHalves: DIFFICULTY_RULES.Wizard.minDistinctHalves,
    },
    {
      rows: DIFFICULTY_RULES.Expert.rows,
      columns: DIFFICULTY_RULES.Expert.columns,
      pieceCount: DIFFICULTY_RULES.Expert.pieceCount,
      minDirectionalHalves:
        DIFFICULTY_RULES.Expert.minDirectionalHalves,
      maxDirectionalHalves:
        DIFFICULTY_RULES.Expert.maxDirectionalHalves,
      minDistinctHalves: DIFFICULTY_RULES.Expert.minDistinctHalves,
    },
    "Wizard keeps Expert stimulus density",
  );
  assert.equal(DIFFICULTY_RULES.Expert.seamsVisible, true);
  assert.equal(DIFFICULTY_RULES.Wizard.seamsVisible, false);

  const expectedLayouts = {
    Starter: new Set(["2x2-rows", "2x2-columns"]),
    Junior: new Set([null]),
    Expert: new Set([
      "2x3-columns",
      "2x3-left-stack",
      "2x3-right-stack",
    ]),
    Wizard: new Set([null]),
  };
  for (const difficulty of DIFFICULTIES) {
    const authored = ROUNDS.filter((round) => round.difficulty === difficulty);
    assert.deepEqual(
      new Set(authored.map(({ layoutId }) => layoutId)),
      expectedLayouts[difficulty],
      `${difficulty} authored layout coverage`,
    );
  }
});

test("1,600 independently seeded generated rounds satisfy every round invariant", () => {
  const allMismatchKinds = new Set();

  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    assert.equal(rounds.length, GENERATED_COUNT_PER_DIFFICULTY);
    assert.equal(
      new Set(rounds.map(roundFingerprint)).size,
      GENERATED_COUNT_PER_DIFFICULTY,
      `${difficulty} within-session fingerprints`,
    );

    for (const [roundIndex, round] of rounds.entries()) {
      assert.equal(round.difficulty, difficulty);
      assertRoundContract(
        round,
        `${difficulty} generated round ${roundIndex + 1}`,
      );
      allMismatchKinds.add(round.options[round.correctIndex].kind);
    }
  }

  assert.deepEqual(
    allMismatchKinds,
    new Set(["seam-trap", "twisted-half", "broken-pair"]),
    "the corpus exercises every misconception family",
  );
});

test("generated corpora cover answer positions and every visible tiling", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    assert.deepEqual(
      new Set(rounds.map(({ correctIndex }) => correctIndex)),
      new Set([0, 1, 2, 3]),
      `${difficulty} answer positions`,
    );
    const rules = DIFFICULTY_RULES[difficulty];
    assert.deepEqual(
      new Set(rounds.map(({ layoutId }) => layoutId)),
      rules.seamsVisible
        ? new Set(legalLayoutIds(rules.rows, rules.columns))
        : new Set([null]),
      `${difficulty} generated layout coverage`,
    );
  }
});

test("Junior possible choices span both hidden tilings", () => {
  const juniorRounds = [
    ...ROUNDS.filter(({ difficulty }) => difficulty === "Junior"),
    ...GENERATED.Junior,
  ];
  const allJuniorLayouts = new Set(legalLayoutIds(2, 2));

  for (const [roundIndex, round] of juniorRounds.entries()) {
    assert.deepEqual(
      new Set(
        round.options
          .filter(({ buildable }) => buildable)
          .map(({ witness }) => witness.layoutId),
      ),
      allJuniorLayouts,
      `Junior ${roundIndex + 1} possible choices span hidden tilings`,
    );
  }
});

test("Wizard hides the tiling while retaining one exact local answer", () => {
  const wizardRounds = [
    ...ROUNDS.filter(({ difficulty }) => difficulty === "Wizard"),
    ...GENERATED.Wizard,
  ];
  const allWizardLayouts = new Set(legalLayoutIds(2, 3));

  for (const [roundIndex, round] of wizardRounds.entries()) {
    const impossible = round.options[round.correctIndex];
    assert.equal(round.layoutId, null);
    assert.equal(round.seamsVisible, false);
    assert.equal(impossible.witness, null);
    assert.notEqual(impossible.kind, "seam-trap");
    assert.ok(
      impossible.mismatch.differingCells.length >= 1 &&
        impossible.mismatch.differingCells.length <= 2,
      `Wizard ${roundIndex + 1} local explanation`,
    );
    assert.deepEqual(
      findBuildWitnesses(
        round.pieces,
        impossible.design,
        round.rows,
        round.columns,
        null,
      ),
      [],
      `Wizard ${roundIndex + 1} impossible across every hidden tiling`,
    );
    assert.deepEqual(
      new Set(
        round.options
          .filter(({ buildable }) => buildable)
          .map(({ witness }) => witness.layoutId),
      ),
      allWizardLayouts,
      `Wizard ${roundIndex + 1} possible choices span hidden tilings`,
    );
  }
});

test("misconception metadata names the exact nearest buildable state", () => {
  const kindsByDifficulty = Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      new Set(
        GENERATED[difficulty].map(
          (round) => round.options[round.correctIndex].kind,
        ),
      ),
    ]),
  );

  assert.deepEqual(kindsByDifficulty.Starter, new Set(["seam-trap"]));
  assert.deepEqual(kindsByDifficulty.Junior, new Set(["broken-pair"]));
  assert.ok(kindsByDifficulty.Expert.has("seam-trap"));
  assert.ok(kindsByDifficulty.Expert.has("twisted-half"));
  assert.ok(kindsByDifficulty.Expert.has("broken-pair"));
  assert.ok(kindsByDifficulty.Wizard.has("twisted-half"));
  assert.ok(kindsByDifficulty.Wizard.has("broken-pair"));
  assert.equal(kindsByDifficulty.Wizard.has("seam-trap"), false);
});

test("Infinite generation is reproducible and honors session exclusions", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    for (const seedOffset of [0, 1, 17, 73, 399]) {
      const seed =
        0x7a00_0000 + difficultyIndex * 0x1_0000 + seedOffset;
      assert.deepEqual(
        generateInfiniteRound(difficulty, makeSeededRandom(seed)),
        generateInfiniteRound(difficulty, makeSeededRandom(seed)),
        `${difficulty} seed ${seedOffset}`,
      );
    }

    const sessionSeed = 0x4f00_0000 + difficultyIndex;
    const sequentialRandom = makeSeededRandom(sessionSeed);
    const first = generateInfiniteRound(difficulty, sequentialRandom);
    const next = generateInfiniteRound(difficulty, sequentialRandom);
    const excludedRetry = generateInfiniteRound(
      difficulty,
      makeSeededRandom(sessionSeed),
      new Set([roundFingerprint(first)]),
    );
    assert.notEqual(roundFingerprint(first), roundFingerprint(excludedRetry));
    assert.deepEqual(excludedRetry, next);
  }
});

test("round fingerprints ignore cosmetic ordering and physical presentation", () => {
  for (const round of ROUNDS) {
    const reversedOptions = [...round.options].reverse();
    const reordered = {
      ...round,
      id: `renamed-${round.id}`,
      pieces: [...round.pieces].reverse().map((piece) => ({
        ...piece,
        first: rotatePipMask(piece.second, 2),
        second: rotatePipMask(piece.first, 2),
      })),
      options: reversedOptions,
      correctIndex: reversedOptions.findIndex(
        ({ design }) =>
          designKey(design) ===
          designKey(round.options[round.correctIndex].design),
      ),
    };
    assert.equal(roundFingerprint(reordered), roundFingerprint(round));
  }
});

test("generation rejects hostile random sources and stops at its bound", () => {
  const seeded = makeSeededRandom(731);
  let retryCalls = 0;
  const initiallyDegenerate = () => {
    retryCalls += 1;
    return retryCalls <= 24 ? 0 : seeded();
  };
  assertRoundContract(
    generateInfiniteRound("Starter", initiallyDegenerate),
    "retried Starter round",
  );
  assert.ok(retryCalls > 24);

  let hostileCalls = 0;
  assert.throws(
    () =>
      generateInfiniteRound("Starter", () => {
        hostileCalls += 1;
        return 0;
      }),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.ok(hostileCalls > 0);
  assert.ok(
    hostileCalls <= GENERATOR_MAX_ATTEMPTS * 16,
    "hostile generation remains bounded",
  );

  for (const invalidValue of [
    Number.NaN,
    -0.01,
    1,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => generateInfiniteRound("Starter", () => invalidValue),
      /Random source must return a finite number from 0 up to 1/,
    );
  }
  assert.throws(
    () => generateInfiniteRound("Impossible", makeSeededRandom(1)),
    /Unknown difficulty/,
  );
  assert.throws(() => makeSeededRandom(Number.NaN), /Seed must be finite/);
});

test("the validator and witness renderer reject corrupted puzzle state", () => {
  const round = ROUNDS[0];
  const duplicateOptions = {
    ...round,
    options: [
      round.options[0],
      round.options[0],
      round.options[2],
      round.options[3],
    ],
  };
  assert.ok(
    validateRound(duplicateOptions).some((message) =>
      message.includes("distinct"),
    ),
  );
  const wrongSizedOptions = [...round.options];
  wrongSizedOptions[0] = {
    ...wrongSizedOptions[0],
    design: { cells: wrongSizedOptions[0].design.cells.slice(1) },
  };
  const wrongSizedErrors = validateRound({
    ...round,
    options: wrongSizedOptions,
  });
  assert.ok(
    wrongSizedErrors.some((message) => message.includes("complete board")),
  );

  const junior = ROUNDS.find(({ difficulty }) => difficulty === "Junior");
  assert.ok(junior);
  const existingJuniorDesigns = new Set(
    junior.options.map(({ design }) => designKey(design)),
  );
  let oneCellNearDesign = null;
  for (let mask = 0; mask < 1 << 9; mask += 1) {
    const cells = [...junior.options[0].design.cells];
    cells[0] = mask;
    const candidate = { cells };
    if (
      mask !== junior.options[0].design.cells[0] &&
      !existingJuniorDesigns.has(designKey(candidate))
    ) {
      oneCellNearDesign = candidate;
      break;
    }
  }
  assert.ok(oneCellNearDesign);
  const oneCellNearOptions = [...junior.options];
  oneCellNearOptions[1] = {
    ...oneCellNearOptions[1],
    design: oneCellNearDesign,
  };
  assert.ok(
    validateRound({ ...junior, options: oneCellNearOptions }).some((message) =>
      message.includes("at least two cells"),
    ),
  );

  const buildableIndex = round.options.findIndex(({ buildable }) => buildable);
  const falseLabelOptions = [...round.options];
  falseLabelOptions[buildableIndex] = {
    ...falseLabelOptions[buildableIndex],
    buildable: false,
  };
  assert.ok(
    validateRound({ ...round, options: falseLabelOptions }).some((message) =>
      message.includes("false buildability"),
    ),
  );

  const witness = round.options[buildableIndex].witness;
  const invalidWitness = {
    ...witness,
    placements: witness.placements.map((placement, index) =>
      index === 0
        ? {
            ...placement,
            quarterTurns: (placement.quarterTurns + 1) % 4,
          }
        : placement,
    ),
  };
  assert.throws(
    () =>
      renderWitness(
        round.pieces,
        round.rows,
        round.columns,
        invalidWitness,
      ),
    /incorrect rotation/,
  );
  assert.throws(
    () =>
      differingCellIndexes(
        round.options[0].design,
        { cells: round.options[0].design.cells.slice(1) },
      ),
    /same number of cells/,
  );
});

test("the opening example is a solved build plus a meaningful near-match", () => {
  assert.equal(
    designKey(
      renderWitness(
        TUTORIAL.pieces,
        TUTORIAL.rows,
        TUTORIAL.columns,
        TUTORIAL.witness,
      ),
    ),
    designKey(TUTORIAL.possible),
  );
  assert.equal(
    isDesignBuildable(
      TUTORIAL.pieces,
      TUTORIAL.possible,
      TUTORIAL.rows,
      TUTORIAL.columns,
      TUTORIAL.layoutId,
    ),
    true,
  );
  assert.equal(
    isDesignBuildable(
      TUTORIAL.pieces,
      TUTORIAL.nearMiss,
      TUTORIAL.rows,
      TUTORIAL.columns,
      TUTORIAL.layoutId,
    ),
    false,
  );
  const nearMiss = analyzeImpossibleDesign(
    TUTORIAL.pieces,
    TUTORIAL.nearMiss,
    TUTORIAL.rows,
    TUTORIAL.columns,
    TUTORIAL.layoutId,
  );
  assert.equal(TUTORIAL.nearMissReason, nearMiss.message);
  assert.ok(
    nearMiss.differingCells.length >= 1 &&
      nearMiss.differingCells.length <= 2,
  );
});
