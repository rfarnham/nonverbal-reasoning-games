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
  pipRotationOrbitKey,
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

function phaseTwinInfo(pieces) {
  for (let firstIndex = 0; firstIndex < pieces.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < pieces.length;
      secondIndex += 1
    ) {
      const first = pieces[firstIndex];
      const second = pieces[secondIndex];
      const fixedOrbitKey = pipRotationOrbitKey(first.first);
      const variableOrbitKey = pipRotationOrbitKey(first.second);
      if (
        fixedOrbitKey === variableOrbitKey ||
        first.first !== second.first ||
        pipRotationOrbitKey(second.first) !== fixedOrbitKey ||
        pipRotationOrbitKey(second.second) !== variableOrbitKey ||
        ![1, 3].some(
          (turns) => rotatePipMask(first.second, turns) === second.second,
        )
      ) {
        continue;
      }
      const third = pieces.find(
        (_, index) => index !== firstIndex && index !== secondIndex,
      );
      if (!third) continue;
      const thirdOrbits = [
        pipRotationOrbitKey(third.first),
        pipRotationOrbitKey(third.second),
      ];
      if (
        new Set(thirdOrbits).size !== 2 ||
        thirdOrbits.some(
          (key) => key === fixedOrbitKey || key === variableOrbitKey,
        )
      ) {
        continue;
      }
      return { fixedOrbitKey, variableOrbitKey };
    }
  }
  return null;
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

test("Domino Twist v3 migrates saved questions to the revised curriculum", () => {
  assert.equal(progressionMetadata.contentVersion, "3");
  assert.equal(progressionMetadata.generatorVersion, "3");
  assert.equal(progressionMetadata.journeyContentVersion, "2");

  const campaign = resolveProgressionQuestion(progressionAdapter, {
    source: "campaign",
    gameSlug: "domino-twist",
    level: "junior",
    questionIndex: 0,
    contentVersion: "2",
  });
  assert.equal(campaign.resolution, "campaign-updated");
  assert.equal(campaign.ref.contentVersion, "3");
  assert.equal(campaign.round.difficulty, "Junior");
  assert.deepEqual(validateRound(campaign.round), []);

  const generated = resolveProgressionQuestion(progressionAdapter, {
    source: "generated",
    gameSlug: "domino-twist",
    level: "junior",
    seed: "legacy-domino-junior",
    generatorVersion: "2",
  });
  assert.equal(generated.resolution, "generated-fallback");
  assert.equal(generated.ref.source, "campaign");
  assert.equal(generated.ref.contentVersion, "3");
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
      "2,1,1,1,1",
      `${label} repeats one fixed phase-twin face`,
    );
    assert.ok(phaseTwinInfo(round.pieces), `${label} relative-phase twins`);
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
    } else if (option.kind === "twisted-pair") {
      assert.equal(option.mismatch.differingCells.length, 2);
      for (const cell of option.mismatch.differingCells) {
        assert.ok(
          [1, 3].some(
            (turns) =>
              rotatePipMask(
                option.mismatch.closestBuildable.cells[cell],
                turns,
              ) === option.design.cells[cell],
          ),
          `${label} coupled face ${cell} is a quarter-turn near-miss`,
        );
      }
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
  if (
    round.difficulty === "Junior" ||
    round.difficulty === "Expert" ||
    round.difficulty === "Wizard"
  ) {
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
  assert.deepEqual(Object.keys(TARGET_SHAPES), ["2x2-rect", "2x3-rect"]);
  for (const shape of Object.values(TARGET_SHAPES)) {
    assert.equal(
      shape.occupiedCells.length,
      shape.id === "2x2-rect" ? 4 : 6,
      `${shape.id} occupied-cell count`,
    );
    assert.deepEqual(
      shape.occupiedCells,
      Array.from({ length: shape.rows * shape.columns }, (_, index) => index),
      `${shape.id} is a full rectangle without rendering holes`,
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
    assert.equal(round.targetShapeId, "2x2-rect");
    assert.equal(round.pieces.length, 2);
    assert.equal(impossible.kind, "twisted-pair");
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
      new Set(["2x3-rect"]),
      `${level}: rectangular target`,
    );
    for (const [index, round] of rounds.entries()) {
      const impossible = round.options[round.correctIndex];
      assert.equal(round.seamsVisible, false);
      assert.equal(round.pieces.length, 3);
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

test("the curriculum adds diagonal rotation, then a third piece, then phase twins", () => {
  for (const difficulty of DIFFICULTIES) {
    assert.equal(
      DIFFICULTY_RULES[difficulty].seamsVisible,
      false,
      `${difficulty} hides layout hints`,
    );
  }

  assert.deepEqual(DIFFICULTY_RULES.Starter.targetShapeIds, ["2x2-rect"]);
  assert.deepEqual(DIFFICULTY_RULES.Junior.targetShapeIds, ["2x2-rect"]);
  assert.equal(DIFFICULTY_RULES.Starter.pieceCount, 2);
  assert.equal(DIFFICULTY_RULES.Junior.pieceCount, 2);
  assert.equal(DIFFICULTY_RULES.Starter.maxDirectionalHalves, 0);
  assert.equal(DIFFICULTY_RULES.Junior.minDirectionalHalves, 4);

  assert.deepEqual(DIFFICULTY_RULES.Expert.targetShapeIds, ["2x3-rect"]);
  assert.deepEqual(DIFFICULTY_RULES.Wizard.targetShapeIds, ["2x3-rect"]);
  assert.equal(DIFFICULTY_RULES.Expert.pieceCount, 3);
  assert.equal(DIFFICULTY_RULES.Wizard.pieceCount, 3);
  assert.equal(
    DIFFICULTY_RULES.Expert.minDirectionalHalves,
    DIFFICULTY_RULES.Wizard.minDirectionalHalves,
    "Wizard keeps Expert visual density",
  );
  assert.equal(DIFFICULTY_RULES.Expert.minDistinctHalves, 6);
  assert.equal(DIFFICULTY_RULES.Wizard.maxDistinctHalves, 5);

  for (const difficulty of DIFFICULTIES) {
    const authored = ROUNDS.filter(({ difficulty: value }) => value === difficulty);
    assert.deepEqual(
      new Set(authored.map(({ layoutId }) => layoutId)),
      new Set([null]),
      `${difficulty} Campaign hides every seam`,
    );
  }

  const starterRounds = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Starter",
  );
  const aggregateLayouts = new Map([
    ["2x2-rows", 0],
    ["2x2-columns", 0],
  ]);
  const dominantLayouts = [];
  for (const [index, round] of starterRounds.entries()) {
    const counts = new Map([
      ["2x2-rows", 0],
      ["2x2-columns", 0],
    ]);
    for (const option of round.options.filter(({ buildable }) => buildable)) {
      const layouts = new Set(
        findBuildWitnesses(
          round.pieces,
          option.design,
          round.rows,
          round.columns,
          null,
        ).map(({ layoutId }) => layoutId),
      );
      assert.equal(layouts.size, 1, `Starter ${index + 1} exclusive layout`);
      const layoutId = [...layouts][0];
      counts.set(layoutId, counts.get(layoutId) + 1);
      aggregateLayouts.set(layoutId, aggregateLayouts.get(layoutId) + 1);
    }
    assert.deepEqual(
      new Set([...counts].filter(([, count]) => count > 0).map(([id]) => id)),
      new Set(["2x2-rows", "2x2-columns"]),
      `Starter ${index + 1} compares horizontal and vertical tilings`,
    );
    dominantLayouts.push(
      [...counts].find(([, count]) => count === 2)[0],
    );
  }
  assert.deepEqual(
    aggregateLayouts,
    new Map([
      ["2x2-rows", 18],
      ["2x2-columns", 18],
    ]),
    "Starter balances horizontal and vertical witnesses",
  );
  assert.equal(
    dominantLayouts.filter((id) => id === "2x2-rows").length,
    6,
  );
  assert.equal(
    dominantLayouts.filter((id) => id === "2x2-columns").length,
    6,
  );

  assert.ok(
    ROUNDS.filter(({ difficulty }) => difficulty === "Wizard").every((round) =>
      phaseTwinInfo(round.pieces),
    ),
    "every Wizard round removes unique orbit identity with phase twins",
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
    new Set(["broken-pair", "twisted-pair", "twisted-half"]),
    "the corpus exercises every taught misconception family",
  );
});

test("generated corpora cover answer positions, target shapes, and hidden tiling hypotheses", () => {
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
    assert.deepEqual(
      new Set(rounds.map(({ layoutId }) => layoutId)),
      new Set([null]),
      `${difficulty} generated rounds hide seams`,
    );
  }
});

test("Junior uses diagonal two-face rotation traps without one-cell shortcuts", () => {
  const juniorRounds = [
    ...ROUNDS.filter(({ difficulty }) => difficulty === "Junior"),
    ...JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"],
    ...GENERATED.Junior,
  ];

  for (const [roundIndex, round] of juniorRounds.entries()) {
    assert.equal(round.layoutId, null, `Junior ${roundIndex + 1} hidden layout`);
    assert.equal(round.seamsVisible, false, `Junior ${roundIndex + 1} hidden seams`);
    const halves = round.pieces.flatMap(({ first, second }) => [first, second]);
    assert.ok(
      halves.every(
        (mask) => isDirectionalPipMask(mask) && [2, 3].includes(pipCount(mask)),
      ),
      `Junior ${roundIndex + 1} uses directional two- and three-pip faces`,
    );
    assert.ok(
      halves.some((mask) => belongsToRotationFamily(mask, "diag-two")) &&
        halves.some((mask) => belongsToRotationFamily(mask, "diag-three")),
      `Junior ${roundIndex + 1} includes both diagonal families`,
    );
    const impossible = round.options[round.correctIndex];
    assert.equal(impossible.kind, "twisted-pair");
    assert.equal(impossible.mismatch.differingCells.length, 2);
    assert.deepEqual(
      impossible.mismatch.differingCells
        .map((cell) => {
          const mask = impossible.mismatch.closestBuildable.cells[cell];
          if (belongsToRotationFamily(mask, "diag-two")) return "diag-two";
          if (belongsToRotationFamily(mask, "diag-three")) return "diag-three";
          return "support";
        })
        .sort(),
      ["diag-three", "diag-two"],
      `Junior ${roundIndex + 1} trap turns the diagonal two- and three-pip faces`,
    );
    for (const cell of impossible.mismatch.differingCells) {
      const buildable = impossible.mismatch.closestBuildable.cells[cell];
      const shown = impossible.design.cells[cell];
      assert.equal(pipCount(buildable), pipCount(shown));
      assert.ok(
        [1, 3].some((turns) => rotatePipMask(buildable, turns) === shown),
        `Junior ${roundIndex + 1} cell ${cell} is a quarter-turn`,
      );
    }
    assert.deepEqual(
      findBuildWitnesses(
        round.pieces,
        impossible.design,
        round.rows,
        round.columns,
        null,
      ),
      [],
      `Junior ${roundIndex + 1} coupled trap fails every hidden tiling`,
    );
  }
});

test("Wizard phase twins require relative orientation without adding density", () => {
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
    const twinInfo = phaseTwinInfo(round.pieces);
    assert.ok(twinInfo, `Wizard ${roundIndex + 1} phase-twin structure`);
    assert.equal(
      new Set(round.pieces.flatMap(({ first, second }) => [first, second])).size,
      5,
      `Wizard ${roundIndex + 1} repeats one fixed twin phase`,
    );
    const differingCell = impossible.mismatch.differingCells[0];
    assert.equal(
      pipRotationOrbitKey(
        impossible.mismatch.closestBuildable.cells[differingCell],
      ),
      twinInfo.variableOrbitKey,
      `Wizard ${roundIndex + 1} twists the twin's relative phase`,
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
      "top-bar",
    ]),
    "Expert Campaign covers diagonal and asymmetric directional families",
  );
  assert.equal(expertFamilies.filter((name) => name === "diag-two").length, 3);
  assert.equal(expertFamilies.filter((name) => name === "diag-three").length, 3);
  assert.deepEqual(
    new Set(
      ROUNDS.filter(({ difficulty }) => difficulty === "Expert")
        .filter((round) => {
          const family = trapFamily(round);
          return family === "diag-two" || family === "diag-three";
        })
        .map(({ targetShapeId }) => targetShapeId),
    ),
    new Set(["2x3-rect"]),
    "Expert diagonal traps stay on the harder three-tiling rectangle",
  );

  const wizardFamilies = ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  ).map(trapFamily);
  assert.deepEqual(
    new Set(wizardFamilies),
    new Set([
      "top-pair",
      "corner-l",
      "edge-single",
      "corner-single",
      "top-bar",
    ]),
    "Wizard Campaign covers every phase-twin family",
  );
  assert.deepEqual(
    new Set(GENERATED.Wizard.map(trapFamily)),
    new Set([
      "top-pair",
      "corner-l",
      "edge-single",
      "corner-single",
      "top-bar",
    ]),
    "generated Wizard rounds cover every phase-twin family",
  );
  assert.ok(
    ROUNDS.filter(({ difficulty }) => difficulty === "Wizard").every(
      ({ targetShapeId }) => targetShapeId === "2x3-rect",
    ),
    "Wizard keeps Expert geometry",
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

  assert.deepEqual(kindsByDifficulty.Starter, new Set(["broken-pair"]));
  assert.deepEqual(kindsByDifficulty.Junior, new Set(["twisted-pair"]));
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

  const missingCellOptions = [...round.options];
  const missingCellDesign = [...missingCellOptions[0].design.cells];
  missingCellDesign[0] = null;
  missingCellOptions[0] = {
    ...missingCellOptions[0],
    design: { cells: missingCellDesign },
  };
  assert.ok(
    validateRound({ ...round, options: missingCellOptions }).some((message) =>
      message.includes("target footprint"),
    ),
    "the validator rejects a hole in a rectangular target",
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
