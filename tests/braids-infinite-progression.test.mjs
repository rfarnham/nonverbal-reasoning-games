import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "../app/games/braids/infinite-progression.ts";

function record(state, id, correct, difficulty = state.targetDifficulty) {
  return recordInfiniteFirstAttempt(state, {
    roundId: id,
    difficulty,
    firstTryCorrect: correct,
  });
}

test("Braids Infinite starts at Starter and promotes after three wins", () => {
  let state = initialInfiniteAdaptiveState();
  assert.equal(state.targetDifficulty, "Starter");

  for (let index = 1; index <= 9; index += 1) {
    state = record(state, `round-${index}`, true);
    if (index === 3) assert.equal(state.targetDifficulty, "Junior");
    if (index === 6) assert.equal(state.targetDifficulty, "Expert");
    if (index === 9) assert.equal(state.targetDifficulty, "Wizard");
  }
  assert.equal(state.combo, 9);
});

test("two misses among three demote and the first miss resets combo", () => {
  let state = {
    ...initialInfiniteAdaptiveState(),
    targetDifficulty: "Expert",
    combo: 5,
  };
  state = record(state, "one", false);
  assert.equal(state.combo, 0);
  state = record(state, "two", true);
  state = record(state, "three", false);
  assert.equal(state.targetDifficulty, "Junior");
  assert.deepEqual(state.recentAtLevel, []);
});

test("adaptation clamps and a retry cannot contribute twice", () => {
  let starter = initialInfiniteAdaptiveState();
  starter = record(starter, "s1", false);
  starter = record(starter, "s2", true);
  starter = record(starter, "s3", false);
  assert.equal(starter.targetDifficulty, "Starter");

  let wizard = {
    ...initialInfiniteAdaptiveState(),
    targetDifficulty: "Wizard",
  };
  wizard = record(wizard, "w1", true);
  wizard = record(wizard, "w2", true);
  wizard = record(wizard, "w3", true);
  assert.equal(wizard.targetDifficulty, "Wizard");

  const missed = record(initialInfiniteAdaptiveState(), "same", false);
  const retried = record(missed, "same", true, "Starter");
  assert.strictEqual(retried, missed);
  assert.equal(retried.attempts.length, 1);
  assert.equal(retried.combo, 0);
});

test("combo energy fills linearly and clamps at combo eight", () => {
  assert.equal(comboEnergyPercent(0), 0);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO / 2), 50);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO), 100);
  assert.equal(comboEnergyPercent(99), 100);
  assert.equal(comboEnergyPercent(-1), 0);
  assert.equal(comboEnergyPercent(Number.NaN), 0);
});
