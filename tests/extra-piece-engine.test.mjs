import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIFFICULTIES,
  DIFFICULTY_RULES,
  ROUNDS,
  PuzzleGenerationError,
  enumeratePiecePlacements,
  generateInfiniteRound,
  hiddenPatternCount,
  hiddenPlacementGain,
  possibleExtraIndexes,
  rotatePieceCells,
  roundFingerprint,
  solveRound,
  starterInventoryMatchIndexes,
  starterInventoryResidual,
  starterSymbolInventory,
  symbolInventoryCompatibleExtraIndexes,
  validateRound,
} from "../app/games/extra-piece/game-engine.ts";
import { JOURNEY_EXTRA_CAMPAIGN_ROUNDS } from "../app/games/extra-piece/journey-campaign.ts";
import { progressionAdapter } from "../app/games/extra-piece/progression-adapter.ts";
import { progressionMetadata } from "../app/games/extra-piece/progression-metadata.ts";
import {
  SOLUTION_PRESENTATIONS,
  solutionCellAssignments,
  solutionPresentationForPiece,
} from "../app/games/extra-piece/solution-presentation.ts";
import {
  EMPTY_WORKING_GRID,
  clearWorkingCells,
  toggleWorkingCell,
  workingCellsForRound,
} from "../app/games/extra-piece/working-grid.ts";
import {
  campaignQuestionReferences,
  resolveProgressionQuestion,
} from "../lib/progression/game-adapter.ts";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function roundsAt(difficulty) {
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

test("Campaign contains 12 validated puzzles at every level", () => {
  assert.equal(ROUNDS.length, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);
  for (const difficulty of DIFFICULTIES) {
    const rounds = roundsAt(difficulty);
    assert.equal(rounds.length, 12);
    for (const round of rounds) {
      assert.deepEqual(validateRound(round), {
        valid: true,
        issues: [],
      });
    }
  }
});

test("Campaign answer positions are balanced for each candidate count", () => {
  for (const difficulty of DIFFICULTIES) {
    const positions = roundsAt(difficulty).map(
      ({ correctIndex }) => correctIndex,
    );
    assert.ok(
      positions.every(
        (position, index) =>
          index === 0 || positions[index - 1] !== position,
      ),
    );
    const optionCount = roundsAt(difficulty)[0].pieces.length;
    const counts = Array.from({ length: optionCount }, (_, index) =>
      positions.filter((position) => position === index).length,
    );
    if (optionCount === 5) {
      assert.deepEqual([...counts].sort(), [2, 2, 2, 3, 3]);
    } else {
      assert.deepEqual(counts, [2, 2, 2, 2, 2, 2]);
    }
    assert.notDeepEqual(
      positions.slice(0, optionCount),
      positions.slice(optionCount, optionCount * 2),
    );
  }
});

test("the curriculum grows from a 4x4 pattern to 5x5 patterns with progressive unknowns", () => {
  assert.deepEqual(
    Object.fromEntries(
      DIFFICULTIES.map((difficulty) => [
        difficulty,
        {
          boardSize: DIFFICULTY_RULES[difficulty].boardSize,
          scaffold: DIFFICULTY_RULES[difficulty].scaffold,
          hiddenPatternCount:
            DIFFICULTY_RULES[difficulty].hiddenPatternCount,
        },
      ]),
    ),
    {
      Easy: {
        boardSize: 4,
        scaffold: "symbols",
        hiddenPatternCount: 0,
      },
      Medium: {
        boardSize: 5,
        scaffold: "symbols",
        hiddenPatternCount: 0,
      },
      Hard: {
        boardSize: 5,
        scaffold: "symbols",
        hiddenPatternCount: 4,
      },
      Wizard: {
        boardSize: 5,
        scaffold: "symbols",
        hiddenPatternCount: 8,
      },
    },
  );

  const pictureSymbols = new Set([
    "arrow",
    "circle",
    "diamond",
    "star",
  ]);
  for (const difficulty of DIFFICULTIES) {
    const rules = DIFFICULTY_RULES[difficulty];
    for (const round of roundsAt(difficulty)) {
      assert.equal(round.boardSize, rules.boardSize);
      assert.equal(round.scaffold, rules.scaffold);
      assert.equal(round.pieces.length, round.boardSize + 1);
      assert.ok(
        round.board.every(({ mark }) => mark.color === "ink"),
      );
      assert.ok(
        round.board.every(({ mark }) =>
          pictureSymbols.has(mark.motif),
        ),
      );
      assert.ok(
        round.pieces.every((piece) =>
          piece.cells.every(
            ({ mark }) =>
              mark.color === "ink" &&
              pictureSymbols.has(mark.motif),
          ),
        ),
      );
      assert.equal(
        hiddenPatternCount(round),
        rules.hiddenPatternCount,
      );
      const visibleMotifs = new Set(
        round.board
          .filter(({ hidden }) => !hidden)
          .map(({ mark }) => mark.motif),
      );
      assert.deepEqual(visibleMotifs, pictureSymbols);
    }
  }

  assert.ok(
    roundsAt("Easy").every((round) => {
      const usedAreas = round.pieces
        .filter((_, index) => index !== round.correctIndex)
        .map(({ cells }) => cells.length)
        .sort();
      const motifs = new Set(
        round.board.map(({ mark }) => mark.motif),
      );
      return (
        round.scaffold === "symbols" &&
        ["arrow", "circle", "diamond", "star"].every((motif) =>
          motifs.has(motif),
        ) &&
        motifs.size === 4 &&
        String(usedAreas) === "3,4,4,5" &&
        round.pieces[round.correctIndex].cells.length === 4 &&
        round.pieces.filter(({ cells }) => cells.length === 4).length === 3
      );
    }),
  );

  for (const round of [
    ...roundsAt("Medium"),
    ...roundsAt("Hard"),
    ...roundsAt("Wizard"),
  ]) {
    assert.deepEqual(
      round.pieces
        .filter((_, index) => index !== round.correctIndex)
        .map(({ cells }) => cells.length)
        .sort(),
      [5, 5, 5, 5, 5],
    );
    const extra = round.pieces[round.correctIndex];
    assert.equal(extra.extraKind, "one-cell-near-miss");
  }
});

test("Starter and Junior use the source question's zero-backtracking symbol strategy", () => {
  for (const round of [
    ...roundsAt("Easy"),
    ...roundsAt("Medium"),
  ]) {
    assert.deepEqual(starterInventoryMatchIndexes(round), [
      round.correctIndex,
    ]);
    assert.deepEqual(
      starterInventoryResidual(round),
      starterSymbolInventory(
        round.pieces[round.correctIndex].cells,
      ),
    );

    const shapeOnlyRound = {
      ...round,
      scaffold: "silhouette",
    };
    assert.ok(possibleExtraIndexes(shapeOnlyRound).length >= 2);

    const forcedUsedPieces = round.pieces.filter(
      (_, pieceIndex) =>
        pieceIndex !== round.correctIndex &&
        enumeratePiecePlacements(round, pieceIndex).length === 1,
    );
    assert.ok(forcedUsedPieces.length >= 2);
    assert.equal(solveRound(round, 2, round.correctIndex).length, 1);
  }
});

test("Expert and Wizard unknowns remove shortcuts without removing the proof", () => {
  for (const difficulty of ["Hard", "Wizard"]) {
    const rules = DIFFICULTY_RULES[difficulty];
    for (const round of roundsAt(difficulty)) {
      const inventoryCandidates =
        symbolInventoryCompatibleExtraIndexes(round);
      assert.ok(
        inventoryCandidates.length >=
          rules.minimumInventoryCandidates,
      );
      assert.ok(inventoryCandidates.includes(round.correctIndex));
      assert.ok(
        hiddenPlacementGain(round) >= rules.minimumPlacementGain,
      );
      assert.deepEqual(possibleExtraIndexes(round), [
        round.correctIndex,
      ]);

      const hiddenRegions = new Map();
      for (const cell of round.board.filter(({ hidden }) => hidden)) {
        hiddenRegions.set(
          cell.sourceRegion,
          (hiddenRegions.get(cell.sourceRegion) ?? 0) + 1,
        );
      }
      assert.ok(hiddenRegions.size >= 4);
      assert.ok(
        [...hiddenRegions.values()].every(
          (count) => count <= (difficulty === "Hard" ? 1 : 2),
        ),
      );

      const changedConcealedMarks = {
        ...round,
        board: round.board.map((cell) =>
          cell.hidden
            ? {
                ...cell,
                mark: {
                  ...cell.mark,
                  motif:
                    cell.mark.motif === "star"
                      ? "diamond"
                      : "star",
                },
              }
            : cell,
        ),
      };
      assert.deepEqual(
        possibleExtraIndexes(changedConcealedMarks),
        possibleExtraIndexes(round),
      );
      assert.equal(
        roundFingerprint(changedConcealedMarks),
        roundFingerprint(round),
      );
    }
  }
  assert.ok(
    DIFFICULTY_RULES.Wizard.hiddenPatternCount >
      DIFFICULTY_RULES.Hard.hiddenPatternCount,
  );
});

test("every puzzle proves one and only one possible extra piece", () => {
  for (const round of ROUNDS) {
    assert.deepEqual(possibleExtraIndexes(round), [round.correctIndex]);
    assert.equal(round.solution.length, round.boardSize);
    assert.equal(
      new Set(round.solution.map(({ pieceIndex }) => pieceIndex)).size,
      round.boardSize,
    );
    assert.equal(
      round.solution.some(
        ({ pieceIndex }) => pieceIndex === round.correctIndex,
      ),
      false,
    );
  }
});

test("the working grid toggles and clears marks without affecting other rounds", () => {
  const firstToggle = toggleWorkingCell(
    EMPTY_WORKING_GRID,
    "round-a",
    "0,0",
  );
  assert.deepEqual(workingCellsForRound(EMPTY_WORKING_GRID, "round-a"), []);
  assert.deepEqual(workingCellsForRound(firstToggle, "round-a"), ["0,0"]);

  const twoRounds = toggleWorkingCell(firstToggle, "round-b", "2,3");
  const twoMarks = toggleWorkingCell(twoRounds, "round-a", "1,0");
  assert.deepEqual(workingCellsForRound(twoMarks, "round-a"), [
    "0,0",
    "1,0",
  ]);
  assert.deepEqual(workingCellsForRound(twoMarks, "round-b"), ["2,3"]);

  const toggledOff = toggleWorkingCell(twoMarks, "round-a", "0,0");
  assert.deepEqual(workingCellsForRound(toggledOff, "round-a"), ["1,0"]);
  assert.deepEqual(workingCellsForRound(twoMarks, "round-a"), [
    "0,0",
    "1,0",
  ]);

  const cleared = clearWorkingCells(toggledOff, "round-a");
  assert.deepEqual(workingCellsForRound(cleared, "round-a"), []);
  assert.deepEqual(workingCellsForRound(cleared, "round-b"), ["2,3"]);
  assert.equal(clearWorkingCells(cleared, "missing"), cleared);
});

test("solved layouts color every target cell and uniquely match every used piece", () => {
  const allRounds = [
    ...ROUNDS,
    ...Object.values(JOURNEY_EXTRA_CAMPAIGN_ROUNDS).flat(),
  ];
  for (const round of allRounds) {
    const assignments = solutionCellAssignments(round);
    const usedPieceIndexes = round.solution
      .map(({ pieceIndex }) => pieceIndex)
      .sort((left, right) => left - right);
    const presentedPieceIndexes = [
      ...new Set(assignments.map(({ pieceIndex }) => pieceIndex)),
    ].sort((left, right) => left - right);
    const presentationIds = usedPieceIndexes.map(
      (pieceIndex) => solutionPresentationForPiece(pieceIndex).id,
    );

    assert.equal(assignments.length, round.boardSize ** 2);
    assert.equal(
      new Set(assignments.map(({ key }) => key)).size,
      round.boardSize ** 2,
    );
    assert.deepEqual(presentedPieceIndexes, usedPieceIndexes);
    assert.equal(usedPieceIndexes.includes(round.correctIndex), false);
    assert.equal(
      new Set(presentationIds).size,
      usedPieceIndexes.length,
    );
    for (const assignment of assignments) {
      assert.equal(
        assignment.presentationId,
        solutionPresentationForPiece(assignment.pieceIndex).id,
      );
    }
  }

  assert.equal(SOLUTION_PRESENTATIONS.length, 6);
  assert.notEqual(
    solutionPresentationForPiece(0).id,
    solutionPresentationForPiece(5).id,
  );
  assert.ok(
    ROUNDS.some(
      (round) =>
        round.pieces.length === 6 &&
        round.correctIndex !== 0 &&
        round.correctIndex !== 5 &&
        round.solution.some(({ pieceIndex }) => pieceIndex === 0) &&
        round.solution.some(({ pieceIndex }) => pieceIndex === 5),
    ),
  );
});

test("validation rejects hidden-pattern curriculum drift", () => {
  const starter = roundsAt("Easy")[0];
  const starterWithUnknown = {
    ...starter,
    board: starter.board.map((cell, index) =>
      index === 0 ? { ...cell, hidden: true } : cell,
    ),
  };
  assert.ok(
    validateRound(starterWithUnknown).issues.includes(
      "The number of hidden patterns does not match the difficulty.",
    ),
  );

  const expert = roundsAt("Hard")[0];
  const revealedExpertCell = {
    ...expert,
    board: expert.board.map((cell) =>
      cell.hidden ? { ...cell, hidden: false } : cell,
    ),
  };
  assert.ok(
    validateRound(revealedExpertCell).issues.includes(
      "The number of hidden patterns does not match the difficulty.",
    ),
  );

  const juniorWithOldArrowScaffold = {
    ...roundsAt("Medium")[0],
    scaffold: "orientation",
  };
  assert.ok(
    validateRound(juniorWithOldArrowScaffold).issues.includes(
      "Scaffold does not match the difficulty.",
    ),
  );
});

test("fingerprints ignore option order and input-piece rotation", () => {
  const round = ROUNDS[17];
  const reversed = {
    ...round,
    pieces: [...round.pieces].reverse(),
  };
  const rotated = {
    ...round,
    pieces: round.pieces.map((piece) => ({
      ...piece,
      cells: rotatePieceCells(piece.cells, 1),
    })),
  };
  assert.equal(roundFingerprint(reversed), roundFingerprint(round));
  assert.equal(roundFingerprint(rotated), roundFingerprint(round));
});

test("fingerprints record unknown locations but not concealed motifs", () => {
  const round = roundsAt("Hard")[0];
  const hiddenIndex = round.board.findIndex(({ hidden }) => hidden);
  assert.ok(hiddenIndex >= 0);
  const changedConcealedMark = {
    ...round,
    board: round.board.map((cell, index) =>
      index === hiddenIndex
        ? {
            ...cell,
            mark: {
              ...cell.mark,
              motif:
                cell.mark.motif === "circle" ? "star" : "circle",
            },
          }
        : cell,
    ),
  };
  assert.equal(
    roundFingerprint(changedConcealedMark),
    roundFingerprint(round),
  );

  const revealed = {
    ...round,
    board: round.board.map((cell, index) =>
      index === hiddenIndex ? { ...cell, hidden: false } : cell,
    ),
  };
  assert.notEqual(roundFingerprint(revealed), roundFingerprint(round));
});

test("visible picture symbols and arrow turns are part of the puzzle state", () => {
  const round = roundsAt("Easy")[0];
  const changedBoard = round.board.map((cell, index) =>
    index === 0
      ? {
          ...cell,
          mark: {
            ...cell.mark,
            motif:
              cell.mark.motif === "star" ? "diamond" : "star",
          },
        }
      : cell,
  );
  assert.notEqual(
    roundFingerprint({ ...round, board: changedBoard }),
    roundFingerprint(round),
  );

  const arrow = {
    x: 0,
    y: 0,
    mark: { color: "ink", motif: "arrow", orientation: 0 },
  };
  const [turnedArrow] = rotatePieceCells([arrow], 1);
  assert.equal(turnedArrow.mark.orientation, 1);

  const headingChanged = {
    ...round,
    pieces: round.pieces.map((piece) => ({
      ...piece,
      cells: piece.cells.map((cell) => ({
        ...cell,
        mark:
          cell.mark.motif === "arrow"
            ? {
                ...cell.mark,
                orientation: (cell.mark.orientation + 1) % 4,
              }
            : cell.mark,
      })),
    })),
  };
  assert.deepEqual(
    starterInventoryResidual(headingChanged),
    starterInventoryResidual(round),
  );
});

test("Infinite generation is deterministic and valid across a broad corpus", {
  timeout: 120_000,
}, () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    for (let seed = 0; seed < 400; seed += 1) {
      const numericSeed =
        900_001 + difficultyIndex * 100_003 + seed * 97;
      const first = generateInfiniteRound(
        difficulty,
        seededRandom(numericSeed),
      );
      const second = generateInfiniteRound(
        difficulty,
        seededRandom(numericSeed),
      );
      assert.equal(roundFingerprint(first), roundFingerprint(second));
      assert.deepEqual(validateRound(first), {
        valid: true,
        issues: [],
      });
    }
  }
});

test("Infinite generation avoids supplied fingerprints and fails safely", () => {
  const first = generateInfiniteRound("Easy", seededRandom(443));
  const excluded = new Set([roundFingerprint(first)]);
  const second = generateInfiniteRound(
    "Easy",
    seededRandom(443),
    excluded,
  );
  assert.notEqual(roundFingerprint(second), roundFingerprint(first));

  const constantRound = generateInfiniteRound("Easy", () => 0);
  assert.throws(
    () =>
      generateInfiniteRound(
        "Easy",
        () => 0,
        new Set([roundFingerprint(constantRound)]),
      ),
    PuzzleGenerationError,
  );
});

test("Journey II banks are valid, disjoint, and mapped by difficulty", () => {
  const expected = {
    "junior-2": "Medium",
    "expert-2": "Hard",
    "wizard-2": "Wizard",
  };
  const used = new Set(ROUNDS.map(roundFingerprint));
  for (const [level, difficulty] of Object.entries(expected)) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    assert.equal(rounds.length, 12);
    for (const round of rounds) {
      assert.equal(round.difficulty, difficulty);
      assert.equal(validateRound(round).valid, true);
      const fingerprint = roundFingerprint(round);
      assert.equal(used.has(fingerprint), false);
      used.add(fingerprint);
    }
  }
  assert.equal(used.size, 84);
});

test("the Journey adapter resolves Campaign and generated references", () => {
  const first = ROUNDS[0];
  const reference = campaignQuestionReferences(
    progressionAdapter,
    "starter",
  )[0];
  assert.equal(
    resolveProgressionQuestion(progressionAdapter, reference).round.id,
    first.id,
  );
  const generated = progressionAdapter.generate(
    "Easy",
    seededRandom(10_303),
  );
  assert.equal(validateRound(generated).valid, true);
});

test("the changed Campaign, generator, and Journey banks use version 3", () => {
  assert.deepEqual(progressionMetadata, {
    contentVersion: "3",
    generatorVersion: "3",
    journeyContentVersion: "3",
  });
});

test("the route exposes semantic choices, shortcuts, and reduced motion", async () => {
  const [page, css] = await Promise.all([
    readFile(
      new URL("../app/games/extra-piece/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/extra-piece/extra-piece.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(page, /<button[\s\S]*aria-keyshortcuts=/);
  assert.match(page, /Keys 1–\{round\.pieces\.length\}/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /readSoundPreference/);
  assert.match(page, /ProgressionGameHud/);
  assert.match(page, /motif === "star"/);
  assert.match(page, /motif === "diamond"/);
  assert.match(page, /motif === "circle"/);
  assert.match(page, /Count the symbols first/);
  assert.match(page, /\? = any symbol/);
  assert.match(page, /gray question-mark cells that accept any symbol/);
  assert.match(page, /unknownPatternMark/);
  assert.match(page, /aria-pressed=\{marked\}/);
  assert.match(page, /data-working-cell=/);
  assert.match(page, /Use arrow keys to move and Space to mark/);
  assert.match(page, /event\.key === "Enter"/);
  assert.match(page, /event\.key === "Space"/);
  assert.match(page, /Select squares to mark what you’ve checked/);
  assert.match(page, /Clear marks/);
  assert.match(page, /matchedFill=\{matchedFill\}/);
  assert.match(page, /solutionRegionLabel/);
  assert.match(css, /\.unknownPatternMark/);
  assert.match(css, /\.workingCellButton:focus-visible/);
  assert.match(css, /\.workingCellButton\[aria-pressed="true"\]/);
  assert.match(css, /\.solutionRegionLabel/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height: 44px/);
});
