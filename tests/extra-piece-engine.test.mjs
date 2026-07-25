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
  isChiral,
  pieceCanonicalKey,
  possibleExtraIndexes,
  reflectPieceCells,
  rotatePieceCells,
  roundFingerprint,
  solveRound,
  starterInventoryMatchIndexes,
  starterInventoryResidual,
  starterSymbolInventory,
  validateRound,
} from "../app/games/extra-piece/game-engine.ts";
import { JOURNEY_EXTRA_CAMPAIGN_ROUNDS } from "../app/games/extra-piece/journey-campaign.ts";
import { progressionAdapter } from "../app/games/extra-piece/progression-adapter.ts";
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

test("the curriculum stays monochrome while increasing size and chirality", () => {
  for (const difficulty of DIFFICULTIES) {
    const rules = DIFFICULTY_RULES[difficulty];
    for (const round of roundsAt(difficulty)) {
      assert.equal(round.boardSize, rules.boardSize);
      assert.equal(round.scaffold, rules.scaffold);
      assert.equal(round.pieces.length, round.boardSize + 1);
      assert.ok(
        round.board.every(({ mark }) => mark.color === "ink"),
      );
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
  assert.ok(
    roundsAt("Medium").every((round) =>
      round.board.some(({ mark }) => mark.motif === "chevron"),
    ),
  );
  assert.ok(
    roundsAt("Hard").every((round) =>
      round.board.every(({ mark }) => mark.color === "ink"),
    ),
  );
  assert.ok(
    roundsAt("Wizard").every((round) => {
      const motifCount = round.board.filter(
        ({ mark }) => mark.motif === "chevron",
      ).length;
      return (
        round.board.every(({ mark }) => mark.color === "ink") &&
        motifCount > 0 &&
        motifCount <= 10
      );
    }),
  );

  for (const round of [
    ...roundsAt("Hard"),
    ...roundsAt("Wizard"),
  ]) {
    const extra = round.pieces[round.correctIndex];
    const source = round.pieces.find(
      (piece) =>
        piece.kind === "used" &&
        piece.sourceRegion === extra.sourceRegion,
    );
    assert.ok(source);
    assert.equal(extra.extraKind, "mirror-trap");
    assert.equal(isChiral(source.cells), true);
    assert.notEqual(
      pieceCanonicalKey(source.cells, false),
      pieceCanonicalKey(extra.cells, false),
    );
    assert.equal(
      pieceCanonicalKey(source.cells, false),
      pieceCanonicalKey(reflectPieceCells(extra.cells), false),
    );
  }
});

test("Starter mirrors the source question's zero-backtracking symbol strategy", () => {
  for (const round of roundsAt("Easy")) {
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
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height: 44px/);
});
