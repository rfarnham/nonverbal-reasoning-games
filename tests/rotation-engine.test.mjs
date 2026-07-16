import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUNDS,
  buildRounds,
  isRotationOf,
  patternKey,
  rotatePattern,
} from "../app/games/rotation-match/game-engine.ts";

test("every authored round has one unique rotation and three valid distractors", () => {
  assert.equal(ROUNDS.length, 8);

  for (const [index, round] of ROUNDS.entries()) {
    assert.equal(round.clue.length, 9, `round ${index + 1} clue size`);
    assert.equal(round.options.length, 4, `round ${index + 1} option count`);
    assert.equal(
      new Set(round.options.map(patternKey)).size,
      4,
      `round ${index + 1} options must be unique`,
    );

    const rotationIndexes = round.options.flatMap((option, optionIndex) =>
      isRotationOf(option, round.clue) ? [optionIndex] : [],
    );

    assert.deepEqual(
      rotationIndexes,
      [round.correctIndex],
      `round ${index + 1} must have exactly one correct rotation`,
    );
  }
});

test("four quarter turns return every clue to its starting orientation", () => {
  for (const round of ROUNDS) {
    assert.deepEqual(rotatePattern(round.clue, 4), round.clue);
  }
});

test("authored rounds build deterministically", () => {
  assert.deepEqual(buildRounds(), ROUNDS);
});
