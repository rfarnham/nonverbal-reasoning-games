import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  PIP_PATTERNS,
  ROUNDS,
  TARGET_SHAPES,
  TILING_LAYOUTS,
  TUTORIAL,
  analyzeImpossibleDesign,
  buildCampaignRounds,
  designKey,
  differingCellIndexes,
  enumerateBuildableDesigns,
  exactMaskMultiplicitySignature,
  findBuildWitnesses,
  generateInfiniteRound,
  isDesignBuildable,
  isDirectionalPipMask,
  isPipMask,
  legalLayoutIds,
  legalLayoutIdsForShape,
  makeSeededRandom,
  pipCount,
  pipDotIndexes,
  renderWitness,
  rotatePipMask,
  roundFingerprint,
  validateRound,
} from "../app/games/domino-twist/game-engine.ts";
import { progressionAdapter } from "../app/games/domino-twist/progression-adapter.ts";
import { progressionMetadata } from "../app/games/domino-twist/progression-metadata.ts";
import { resolveProgressionQuestion } from "../lib/progression/game-adapter.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildDominoJourneyExtraCampaignRounds,
} from "../app/games/domino-twist/journey-campaign.ts";

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

test("Domino Twist v2 migrates saved questions to the revised curriculum", () => {
  assert.equal(progressionMetadata.contentVersion, "2");
  assert.equal(progressionMetadata.generatorVersion, "2");
  assert.equal(progressionMetadata.journeyContentVersion, "1");

  const campaign = resolveProgressionQuestion(progressionAdapter, {
    source: "campaign",
    gameSlug: "domino-twist",
    level: "junior",
    questionIndex: 0,
    contentVersion: "1",
  });
  assert.equal(campaign.resolution, "campaign-updated");
  assert.equal(campaign.ref.contentVersion, "2");
  assert.equal(campaign.round.difficulty, "Junior");
  assert.deepEqual(validateRound(campaign.round), []);

  const generated = resolveProgressionQuestion(progressionAdapter, {
    source: "generated",
    gameSlug: "domino-twist",
    level: "junior",
    seed: "legacy-domino-junior",
    generatorVersion: "1",
  });
  assert.equal(generated.resolution, "generated-fallback");
  assert.equal(generated.ref.source, "campaign");
  assert.equal(generated.ref.contentVersion, "2");
  assert.equal(generated.round.difficulty, "Junior");
  assert.deepEqual(validateRound(generated.round), []);
});

function assertDifficultyContract(round, label) {
  const rules = DIFFICULTY_RULES[round.difficulty];
  const shape = TARGET_SHAPES[round.targetShapeId];
  const halves = round.pieces.flatMap(({ first, second }) => [first, second]);
  const directionalCount = halves.filter(isDirectionalPipMask).length;
  const reachable = enumerateBuildableDesigns(
    round.pieces,
    round.rows,
    round.columns,
    round.layoutId,
  );

  assert.ok(
    rules.targetShapeIds.includes(round.targetShapeId),
    `${label} target-shape curriculum`,
  );
  assert.equal(round.rows, shape.rows, `${label} row count`);
  assert.equal(round.columns, shape.columns, `${label} column count`);
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
    new Set(halves).size >= rules.minDistinctHalves &&
      new Set(halves).size <= rules.maxDistinctHalves,
    `${label} distinct halves`,
  );
  if (round.difficulty === "Wizard") {
    assert.equal(
      exactMaskMultiplicitySignature({ cells: halves }),
      "2,2,1,1",
      `${label} repeats exactly two source faces`,
    );
  }
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
  const shape = TARGET_SHAPES[round.targetShapeId];
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
      option.design.cells.every((mask, cell) =>
        shape.occupiedCells.includes(cell)
          ? mask !== null && isPipMask(mask)
          : mask === null,
      ),
      `${label} option ${optionIndex + 1} target footprint and pip masks`,
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

  if (round.layoutId === null) {
    const exclusiveLayouts = new Set(
      round.options.flatMap((option) => {
        if (!option.buildable) return [];
        const layouts = new Set(
          findBuildWitnesses(
            round.pieces,
            option.design,
            round.rows,
            round.columns,
            null,
          ).map(({ layoutId }) => layoutId),
        );
        return layouts.size === 1 ? [...layouts] : [];
      }),
    );
    assert.deepEqual(
      exclusiveLayouts,
      new Set(legalLayoutIdsForShape(round.targetShapeId)),
      `${label} has exclusive evidence for every hidden tiling`,
    );
  }
  if (round.difficulty === "Expert" || round.difficulty === "Wizard") {
    const impossibleSignature = exactMaskMultiplicitySignature(
      round.options[round.correctIndex].design,
    );
    assert.ok(
      round.options.some(
        (option, index) =>
          index !== round.correctIndex &&
          option.buildable &&
          exactMaskMultiplicitySignature(option.design) ===
            impossibleSignature,
      ),
      `${label} impossible face-count signature is not a shortcut`,
    );
  }
}

test("pip masks rotate as a whole-domino orientation system", () => {
  const directional = PIP_PATTERNS["corner-l"];
  const invariant = PIP_PATTERNS.corners;
  const diagonal = PIP_PATTERNS["diag-two"];

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

  const oppositeDiagonal = rotatePipMask(diagonal, 1);
  assert.deepEqual(pipDotIndexes(diagonal), [0, 8]);
  assert.deepEqual(pipDotIndexes(oppositeDiagonal), [2, 6]);
  assert.notEqual(oppositeDiagonal, diagonal);
  assert.equal(rotatePipMask(oppositeDiagonal, 1), diagonal);
});

function canonicalMatching(pairs) {
  return pairs
    .map(([first, second]) =>
      first < second ? `${first}-${second}` : `${second}-${first}`,
    )
    .sort()
    .join("|");
}

function enumeratePerfectMatchings(shape) {
  const occupied = new Set(shape.occupiedCells);

  function adjacent(first, second) {
    const firstRow = Math.floor(first / shape.columns);
    const firstColumn = first % shape.columns;
    const secondRow = Math.floor(second / shape.columns);
    const secondColumn = second % shape.columns;
    return (
      Math.abs(firstRow - secondRow) +
        Math.abs(firstColumn - secondColumn) ===
      1
    );
  }

  function search(remaining) {
    if (remaining.size === 0) return [[]];
    const first = Math.min(...remaining);
    return [...remaining]
      .filter((second) => second !== first && adjacent(first, second))
      .flatMap((second) => {
        const next = new Set(remaining);
        next.delete(first);
        next.delete(second);
        return search(next).map((pairs) => [[first, second], ...pairs]);
      });
  }

  return new Set(search(occupied).map(canonicalMatching));
}

test("target shapes are connected and declare every adjacent exact cover", () => {
  for (const shape of Object.values(TARGET_SHAPES)) {
    assert.equal(
      shape.occupiedCells.length,
      shape.id === "2x2-rect" ? 4 : 6,
      `${shape.id} occupied-cell count`,
    );
    const visited = new Set([shape.occupiedCells[0]]);
    const queue = [shape.occupiedCells[0]];
    while (queue.length > 0) {
      const current = queue.shift();
      const currentRow = Math.floor(current / shape.columns);
      const currentColumn = current % shape.columns;
      for (const candidate of shape.occupiedCells) {
        const candidateRow = Math.floor(candidate / shape.columns);
        const candidateColumn = candidate % shape.columns;
        if (
          Math.abs(currentRow - candidateRow) +
            Math.abs(currentColumn - candidateColumn) ===
          1
        ) {
          if (!visited.has(candidate)) queue.push(candidate);
          visited.add(candidate);
        }
      }
    }
    assert.equal(visited.size, shape.occupiedCells.length, `${shape.id} connected`);

    const declared = Object.values(TILING_LAYOUTS).filter(
      (layout) => layout.targetShapeId === shape.id,
    );
    const declaredMatchings = new Set(
      declared.map((layout) => canonicalMatching(layout.pairs)),
    );
    assert.deepEqual(
      declaredMatchings,
      enumeratePerfectMatchings(shape),
      `${shape.id} complete legal-tiling catalogue`,
    );

    for (const layout of declared) {
      assert.equal(layout.rows, shape.rows);
      assert.equal(layout.columns, shape.columns);
      assert.deepEqual(
        [...layout.pairs.flat()].sort((left, right) => left - right),
        [...shape.occupiedCells].sort((left, right) => left - right),
        `${layout.id} exact target cover`,
      );
    }
  }

  assert.deepEqual(legalLayoutIds(2, 2), ["2x2-rows", "2x2-columns"]);
  assert.deepEqual(legalLayoutIdsForShape("2x3-rect"), [
    "2x3-columns",
    "2x3-left-stack",
    "2x3-right-stack",
  ]);
  assert.deepEqual(legalLayoutIdsForShape("2x4-ledge"), [
    "2x4-ledge-horizontal",
    "2x4-ledge-vertical",
  ]);
  assert.deepEqual(legalLayoutIdsForShape("3x3-stair"), [
    "3x3-stair-horizontal",
    "3x3-stair-vertical",
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
    for (let blockStart = 0; blockStart < indexes.length; blockStart += 4) {
      assert.ok(
        new Set(indexes.slice(blockStart, blockStart + 4)).size < 4,
        `${difficulty} block ${blockStart / 4 + 1} does not expose a full answer-position permutation`,
      );
    }
  }
});

test("Journey-only Domino banks are frozen, valid, balanced, and disjoint", () => {
  const expectations = {
    "junior-2": "Junior",
    "expert-2": "Expert",
    "wizard-2": "Wizard",
  };
  const standaloneFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const journeyFingerprints = new Set();
  const journeyIds = new Set();

  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.deepEqual(
    buildDominoJourneyExtraCampaignRounds(),
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
    for (let blockStart = 0; blockStart < positions.length; blockStart += 4) {
      assert.ok(
        new Set(positions.slice(blockStart, blockStart + 4)).size < 4,
        `${level}: block ${blockStart / 4 + 1} does not expose every answer position`,
      );
    }

    for (const [index, round] of rounds.entries()) {
      assert.equal(
        round.id,
        `journey-${level}-${String(index + 1).padStart(2, "0")}`,
      );
      assertRoundContract(round, `${level} round ${index + 1}`);
      assert.equal(journeyIds.has(round.id), false);
      journeyIds.add(round.id);

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

  assert.equal(journeyIds.size, 36);
  assert.equal(journeyFingerprints.size, 36);

  const juniorRounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"];
  for (const [index, round] of juniorRounds.entries()) {
    const impossible = round.options[round.correctIndex];
    assert.equal(round.seamsVisible, false);
    assert.equal(impossible.kind, "broken-pair");
    assert.equal(impossible.mismatch.differingCells.length, 2);
    assert.deepEqual(
      new Set(
        round.options
          .filter(({ buildable }) => buildable)
          .map(({ witness }) => witness.layoutId),
      ),
      new Set(legalLayoutIdsForShape(round.targetShapeId)),
      `Junior II round ${index + 1}: possible choices span every legal hidden tiling`,
    );
  }

  for (const level of ["expert-2", "wizard-2"]) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    assert.deepEqual(
      new Set(rounds.map(({ targetShapeId }) => targetShapeId)),
      new Set(["2x3-rect", "2x4-ledge", "3x3-stair"]),
      `${level}: target-shape coverage`,
    );
    for (const [index, round] of rounds.entries()) {
      const impossible = round.options[round.correctIndex];
      assert.equal(round.seamsVisible, false);
      assert.equal(impossible.kind, "twisted-half");
      assert.equal(impossible.mismatch.differingCells.length, 1);
      assert.deepEqual(
        new Set(
          round.options
            .filter(({ buildable }) => buildable)
            .map(({ witness }) => witness.layoutId),
        ),
        new Set(legalLayoutIdsForShape(round.targetShapeId)),
        `${level} round ${index + 1}: possible choices span every legal hidden tiling`,
      );
    }
  }

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Journey campaign construction cannot consult randomness.");
  };
  try {
    assert.deepEqual(
      buildDominoJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("the difficulty ladder removes seams, adds orientation, then repeats faces", () => {
  assert.equal(DIFFICULTY_RULES.Starter.seamsVisible, true);
  assert.equal(DIFFICULTY_RULES.Junior.seamsVisible, false);
  assert.equal(DIFFICULTY_RULES.Expert.seamsVisible, false);
  assert.equal(DIFFICULTY_RULES.Wizard.seamsVisible, false);

  assert.deepEqual(
    DIFFICULTY_RULES.Starter.targetShapeIds,
    ["2x2-rect"],
    "Starter keeps one compact rectangle",
  );
  assert.equal(
    DIFFICULTY_RULES.Junior.pieceCount >
      DIFFICULTY_RULES.Starter.pieceCount,
    true,
    "Junior adds a third domino",
  );
  assert.deepEqual(
    DIFFICULTY_RULES.Junior.targetShapeIds,
    ["2x3-rect", "2x4-ledge", "3x3-stair"],
    "Junior introduces rectangular and non-rectangular targets",
  );
  assert.deepEqual(
    DIFFICULTY_RULES.Expert.targetShapeIds,
    DIFFICULTY_RULES.Junior.targetShapeIds,
    "Expert keeps Junior target geometry",
  );
  assert.deepEqual(
    DIFFICULTY_RULES.Wizard.targetShapeIds,
    DIFFICULTY_RULES.Expert.targetShapeIds,
    "Wizard keeps Expert target geometry",
  );
  assert.equal(
    DIFFICULTY_RULES.Junior.maxDirectionalHalves,
    DIFFICULTY_RULES.Starter.maxDirectionalHalves,
    "Junior keeps rotation-invariant faces",
  );
  assert.ok(
    DIFFICULTY_RULES.Expert.minDirectionalHalves >
      DIFFICULTY_RULES.Junior.maxDirectionalHalves,
    "Expert adds orientation reasoning",
  );
  assert.equal(
    DIFFICULTY_RULES.Wizard.maxDistinctHalves,
    4,
    "Wizard repeats two of six faces",
  );
  assert.ok(
    DIFFICULTY_RULES.Wizard.maxDistinctHalves <
      DIFFICULTY_RULES.Expert.minDistinctHalves,
    "Wizard removes unique face identity as a scaffold",
  );

  const threePieceShapeSequence = [
    "2x3-rect",
    "2x3-rect",
    "2x3-rect",
    "2x4-ledge",
    "3x3-stair",
    "2x4-ledge",
    "2x3-rect",
    "3x3-stair",
    "2x4-ledge",
    "3x3-stair",
    "2x4-ledge",
    "3x3-stair",
  ];
  for (const difficulty of ["Junior", "Expert", "Wizard"]) {
    const authored = ROUNDS.filter(({ difficulty: value }) => value === difficulty);
    assert.deepEqual(
      authored.map(({ targetShapeId }) => targetShapeId),
      threePieceShapeSequence,
      `${difficulty} uses the same interleaved 4/4/4 target-shape sequence`,
    );
    assert.deepEqual(new Set(authored.map(({ layoutId }) => layoutId)), new Set([null]));
  }
  assert.deepEqual(
    new Set(
      ROUNDS.filter(({ difficulty }) => difficulty === "Starter").map(
        ({ layoutId }) => layoutId,
      ),
    ),
    new Set(["2x2-rows", "2x2-columns"]),
  );
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
    new Set(["seam-trap", "broken-pair", "twisted-half"]),
    "the corpus exercises every taught misconception family",
  );
});

test("generated corpora cover answer positions, target shapes, and visible tilings", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    assert.deepEqual(
      new Set(rounds.map(({ correctIndex }) => correctIndex)),
      new Set([0, 1, 2, 3]),
      `${difficulty} answer positions`,
    );
    const expectedShapes = new Set(DIFFICULTY_RULES[difficulty].targetShapeIds);
    assert.deepEqual(
      new Set(rounds.map(({ targetShapeId }) => targetShapeId)),
      expectedShapes,
      `${difficulty} generated target-shape coverage`,
    );
    if (difficulty === "Starter") {
      assert.deepEqual(
        new Set(rounds.map(({ layoutId }) => layoutId)),
        new Set(legalLayoutIdsForShape("2x2-rect")),
        "Starter generated visible-layout coverage",
      );
    } else {
      assert.deepEqual(new Set(rounds.map(({ layoutId }) => layoutId)), new Set([null]));
    }
  }
});

test("Junior hides seams and uses globally impossible two-face swaps", () => {
  const juniorRounds = [
    ...ROUNDS.filter(({ difficulty }) => difficulty === "Junior"),
    ...GENERATED.Junior,
  ];

  for (const [roundIndex, round] of juniorRounds.entries()) {
    assert.equal(round.layoutId, null, `Junior ${roundIndex + 1} hidden layout`);
    assert.equal(round.seamsVisible, false, `Junior ${roundIndex + 1} hidden seams`);
    assert.ok(
      round.pieces
        .flatMap(({ first, second }) => [first, second])
        .every((mask) => !isDirectionalPipMask(mask)),
      `Junior ${roundIndex + 1} faces stay rotation-invariant`,
    );
    const impossible = round.options[round.correctIndex];
    assert.equal(impossible.kind, "broken-pair");
    assert.equal(impossible.mismatch.differingCells.length, 2);
    assert.deepEqual(
      [...impossible.design.cells].sort(),
      [...impossible.mismatch.closestBuildable.cells].sort(),
      `Junior ${roundIndex + 1} trap preserves the face multiset`,
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
      `Junior ${roundIndex + 1} trap fails every hidden tiling`,
    );
  }
});

test("Wizard hides the tiling while retaining one exact local answer", () => {
  const wizardRounds = [
    ...ROUNDS.filter(({ difficulty }) => difficulty === "Wizard"),
    ...GENERATED.Wizard,
  ];
  for (const [roundIndex, round] of wizardRounds.entries()) {
    const impossible = round.options[round.correctIndex];
    assert.equal(round.layoutId, null);
    assert.equal(round.seamsVisible, false);
    assert.equal(impossible.witness, null);
    assert.equal(impossible.kind, "twisted-half");
    assert.equal(impossible.mismatch.differingCells.length, 1);
    assert.equal(
      new Set(round.pieces.flatMap(({ first, second }) => [first, second])).size,
      4,
      `Wizard ${roundIndex + 1} repeats two face identities`,
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
      new Set(legalLayoutIdsForShape(round.targetShapeId)),
      `Wizard ${roundIndex + 1} possible choices span hidden tilings`,
    );
  }
});

function belongsToRotationFamily(mask, patternName) {
  return (
    mask !== null &&
    [0, 1, 2, 3].some(
      (turns) => rotatePipMask(PIP_PATTERNS[patternName], turns) === mask,
    )
  );
}

test("Expert and Wizard use one-cell orientation near-misses", () => {
  const orientationRounds = [
    ...ROUNDS.filter(
      ({ difficulty }) => difficulty === "Expert" || difficulty === "Wizard",
    ),
    ...GENERATED.Expert,
    ...GENERATED.Wizard,
  ];

  for (const [roundIndex, round] of orientationRounds.entries()) {
    const impossible = round.options[round.correctIndex];
    assert.equal(
      impossible.kind,
      "twisted-half",
      `${round.difficulty} orientation round ${roundIndex + 1} kind`,
    );
    assert.equal(
      impossible.mismatch.differingCells.length,
      1,
      `${round.difficulty} orientation round ${roundIndex + 1} one cell`,
    );
    const differingCell = impossible.mismatch.differingCells[0];
    const shownMask = impossible.design.cells[differingCell];
    const buildableMask =
      impossible.mismatch.closestBuildable.cells[differingCell];
    assert.equal(
      isDirectionalPipMask(buildableMask),
      true,
      `${round.difficulty} orientation round ${roundIndex + 1} uses a directional face`,
    );
    assert.equal(
      pipCount(shownMask),
      pipCount(buildableMask),
      `${round.difficulty} orientation round ${roundIndex + 1} preserves pip count`,
    );
    assert.ok(
      [1, 3].some(
        (quarterTurns) =>
          rotatePipMask(buildableMask, quarterTurns) === shownMask,
      ),
      `${round.difficulty} orientation round ${roundIndex + 1} is a true quarter-turn relation`,
    );
  }

  const trapFamily = (round) => {
    const impossible = round.options[round.correctIndex];
    const cell = impossible.mismatch.differingCells[0];
    const mask = impossible.mismatch.closestBuildable.cells[cell];
    return [
      "diag-two",
      "diag-three",
      "top-pair",
      "corner-l",
      "edge-single",
      "corner-single",
      "top-bar",
      "six",
    ].find((name) => belongsToRotationFamily(mask, name));
  };
  const expertFamilies = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Expert",
  ).map(trapFamily);
  assert.deepEqual(
    new Set(expertFamilies),
    new Set([
      "diag-two",
      "diag-three",
      "top-pair",
      "corner-l",
      "edge-single",
      "corner-single",
      "top-bar",
      "six",
    ]),
    "Expert Campaign covers every directional family",
  );
  assert.equal(expertFamilies.filter((name) => name === "diag-two").length, 2);
  assert.equal(expertFamilies.filter((name) => name === "diag-three").length, 2);
  assert.deepEqual(
    new Set(
      ROUNDS.filter(({ difficulty }) => difficulty === "Expert")
        .filter((round) => {
          const family = trapFamily(round);
          return family === "diag-two" || family === "diag-three";
        })
        .map(({ targetShapeId }) => targetShapeId),
    ),
    new Set(["2x3-rect", "2x4-ledge", "3x3-stair"]),
    "Expert diagonal traps are distributed across every target family",
  );

  const wizardFamilies = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  ).map(trapFamily);
  assert.equal(wizardFamilies.filter((name) => name === "diag-two").length, 2);
  assert.equal(wizardFamilies.filter((name) => name === "diag-three").length, 2);
  assert.deepEqual(
    new Set(wizardFamilies),
    new Set([
      "diag-two",
      "diag-three",
      "top-pair",
      "corner-l",
      "edge-single",
      "corner-single",
      "top-bar",
      "six",
    ]),
    "Wizard Campaign keeps diagonal depth without making the answer family guessable",
  );
  assert.deepEqual(
    new Set(GENERATED.Wizard.map(trapFamily)),
    new Set([
      "diag-two",
      "diag-three",
      "top-pair",
      "corner-l",
      "edge-single",
      "corner-single",
      "top-bar",
      "six",
    ]),
    "generated Wizard rounds retain broad directional variety",
  );
  assert.deepEqual(
    new Set(
      ROUNDS.filter(({ difficulty }) => difficulty === "Wizard")
        .filter((round) => {
          const family = trapFamily(round);
          return family === "diag-two" || family === "diag-three";
        })
        .map(({ targetShapeId }) => targetShapeId),
    ),
    new Set(["2x3-rect", "2x4-ledge", "3x3-stair"]),
    "Wizard diagonal traps are distributed across every target family",
  );

  for (const difficulty of ["Expert", "Wizard"]) {
    const unambiguousTurn = (round) => {
        const impossible = round.options[round.correctIndex];
        const cell = impossible.mismatch.differingCells[0];
        const buildable = impossible.mismatch.closestBuildable.cells[cell];
        const shown = impossible.design.cells[cell];
        const turns = [1, 3].filter(
          (turn) => rotatePipMask(buildable, turn) === shown,
        );
        return turns.length === 1 ? turns : [];
    };
    const authoredTurns = new Set(
      ROUNDS.filter(({ difficulty: value }) => value === difficulty).flatMap(
        unambiguousTurn,
      ),
    );
    assert.deepEqual(
      authoredTurns,
      new Set([1, 3]),
      `${difficulty} Campaign covers clockwise and counter-clockwise traps`,
    );
    assert.deepEqual(
      new Set(GENERATED[difficulty].flatMap(unambiguousTurn)),
      new Set([1, 3]),
      `${difficulty} generation covers clockwise and counter-clockwise traps`,
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
  assert.deepEqual(kindsByDifficulty.Expert, new Set(["twisted-half"]));
  assert.deepEqual(kindsByDifficulty.Wizard, new Set(["twisted-half"]));
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

  const starter = ROUNDS[0];
  assert.notEqual(
    roundFingerprint({ ...starter, targetShapeId: "2x3-rect" }),
    roundFingerprint(starter),
    "the target-shape identity is explicit in the fingerprint",
  );
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
    wrongSizedErrors.some((message) => message.includes("target footprint")),
  );

  const irregular = ROUNDS.find(
    ({ targetShapeId }) => targetShapeId === "2x4-ledge",
  );
  assert.ok(irregular);
  const holeIndex = irregular.options[0].design.cells.findIndex(
    (mask) => mask === null,
  );
  const filledHoleOptions = [...irregular.options];
  const filledHoleCells = [...filledHoleOptions[0].design.cells];
  filledHoleCells[holeIndex] = PIP_PATTERNS.center;
  filledHoleOptions[0] = {
    ...filledHoleOptions[0],
    design: { cells: filledHoleCells },
  };
  assert.ok(
    validateRound({ ...irregular, options: filledHoleOptions }).some((message) =>
      message.includes("target footprint"),
    ),
    "the validator rejects pips outside an irregular footprint",
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
  assert.equal(TUTORIAL.pieces.length, 2);
  assert.equal(TUTORIAL.targetShapeId, "2x2-rect");
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
  assert.equal(
    isDesignBuildable(
      TUTORIAL.pieces,
      TUTORIAL.nearMiss,
      TUTORIAL.rows,
      TUTORIAL.columns,
      null,
    ),
    false,
    "the near-match fails every legal tiling",
  );
  const nearMiss = analyzeImpossibleDesign(
    TUTORIAL.pieces,
    TUTORIAL.nearMiss,
    TUTORIAL.rows,
    TUTORIAL.columns,
    TUTORIAL.layoutId,
  );
  assert.equal(TUTORIAL.nearMissReason, nearMiss.message);
  assert.equal(nearMiss.kind, "twisted-half");
  assert.equal(nearMiss.differingCells.length, 1);
  assert.ok(
    TUTORIAL.witness.placements.some((placement) => {
      const piece = TUTORIAL.pieces.find(({ id }) => id === placement.pieceId);
      if (!piece || ![1, 3].includes(placement.quarterTurns)) return false;
      return (
        (isDirectionalPipMask(piece.first) &&
          rotatePipMask(piece.first, placement.quarterTurns) ===
            TUTORIAL.possible.cells[placement.fromCell] &&
          piece.first !== TUTORIAL.possible.cells[placement.fromCell]) ||
        (isDirectionalPipMask(piece.second) &&
          rotatePipMask(piece.second, placement.quarterTurns) ===
            TUTORIAL.possible.cells[placement.toCell] &&
          piece.second !== TUTORIAL.possible.cells[placement.toCell])
      );
    }),
    "the solved example visibly rotates a directional face with its domino",
  );
});
