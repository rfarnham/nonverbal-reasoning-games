import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "../app/games/domino-twist/infinite-progression.ts";

function record(state, id, correct, difficulty = state.targetDifficulty) {
  return recordInfiniteFirstAttempt(state, {
    roundId: id,
    difficulty,
    firstTryCorrect: correct,
  });
}

test("Domino Infinite starts at Starter and promotes through all four levels", () => {
  let state = initialInfiniteAdaptiveState();
  assert.equal(state.targetDifficulty, "Starter");

  for (let index = 1; index <= 9; index += 1) {
    state = record(state, `win-${index}`, true);
  }

  assert.equal(state.targetDifficulty, "Wizard");
  assert.equal(state.combo, 9);
});

test("Domino Infinite demotes on two misses in three and ignores retries", () => {
  let state = {
    ...initialInfiniteAdaptiveState(),
    targetDifficulty: "Expert",
    combo: 4,
  };

  state = record(state, "miss-a", false);
  assert.equal(state.combo, 0);
  state = record(state, "win-b", true);
  state = record(state, "miss-c", false);
  assert.equal(state.targetDifficulty, "Junior");

  const retried = record(state, "miss-c", true, "Expert");
  assert.strictEqual(retried, state);
});

test("Domino energy is linear and capped at combo eight", () => {
  assert.equal(comboEnergyPercent(0), 0);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO / 2), 50);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO), 100);
  assert.equal(comboEnergyPercent(80), 100);
});
