import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "../app/games/whose-left/infinite-progression.ts";

function record(state, id, correct, difficulty = state.targetDifficulty) {
  return recordInfiniteFirstAttempt(state, {
    roundId: id,
    difficulty,
    firstTryCorrect: correct,
  });
}

test("Whose Left promotes after three first-try wins and clamps at Wizard", () => {
  let state = initialInfiniteAdaptiveState();
  for (let index = 1; index <= 12; index += 1) {
    state = record(state, `win-${index}`, true);
  }

  assert.equal(state.targetDifficulty, "Wizard");
  assert.equal(state.combo, 12);
});

test("Whose Left demotes after two misses in three and ignores a retry", () => {
  let state = {
    ...initialInfiniteAdaptiveState(),
    targetDifficulty: "Expert",
    combo: 4,
  };
  state = record(state, "one", false);
  const afterMiss = state;
  state = record(state, "one", true, "Expert");
  assert.strictEqual(state, afterMiss);
  state = record(state, "two", true);
  state = record(state, "three", false);

  assert.equal(state.targetDifficulty, "Junior");
  assert.equal(state.combo, 0);
  assert.equal(state.attempts.length, 3);
});

test("Whose Left combo energy fills linearly and stays in range", () => {
  assert.equal(comboEnergyPercent(0), 0);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO / 2), 50);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO), 100);
  assert.equal(comboEnergyPercent(50), 100);
  assert.equal(comboEnergyPercent(-2), 0);
  assert.equal(comboEnergyPercent(Number.NaN), 0);
});
