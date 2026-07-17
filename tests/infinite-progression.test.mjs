import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  infiniteLevelLabel,
  recordInfiniteFirstAttempt,
} from "../app/games/rotation-match/infinite-progression.ts";

test("infinite mode uses the four campaign level names", () => {
  assert.equal(infiniteLevelLabel("Easy"), "Starter");
  assert.equal(infiniteLevelLabel("Medium"), "Junior");
  assert.equal(infiniteLevelLabel("Hard"), "Expert");
  assert.equal(infiniteLevelLabel("Wizard"), "Wizard");
});

function record(state, id, correct, difficulty = state.targetDifficulty) {
  return recordInfiniteFirstAttempt(state, {
    roundId: id,
    difficulty,
    firstTryCorrect: correct,
  });
}

test("three first-try wins promote one infinite level at a time", () => {
  let state = initialInfiniteAdaptiveState();
  for (let index = 1; index <= 9; index += 1) {
    state = record(state, `round-${index}`, true);
    if (index === 3) assert.equal(state.targetDifficulty, "Medium");
    if (index === 6) assert.equal(state.targetDifficulty, "Hard");
    if (index === 9) assert.equal(state.targetDifficulty, "Wizard");
  }
  assert.equal(state.combo, 9);
});

test("two misses among three demote and a miss breaks the combo immediately", () => {
  let state = {
    ...initialInfiniteAdaptiveState(),
    targetDifficulty: "Hard",
    combo: 5,
  };
  state = record(state, "one", false);
  assert.equal(state.combo, 0);
  state = record(state, "two", true);
  state = record(state, "three", false);
  assert.equal(state.targetDifficulty, "Medium");
  assert.deepEqual(state.recentAtLevel, []);
});

test("adaptive evidence is clamped at boundaries", () => {
  let starter = initialInfiniteAdaptiveState();
  starter = record(starter, "s1", false);
  starter = record(starter, "s2", true);
  starter = record(starter, "s3", false);
  assert.equal(starter.targetDifficulty, "Easy");

  let wizard = {
    ...initialInfiniteAdaptiveState(),
    targetDifficulty: "Wizard",
  };
  wizard = record(wizard, "w1", true);
  wizard = record(wizard, "w2", true);
  wizard = record(wizard, "w3", true);
  assert.equal(wizard.targetDifficulty, "Wizard");
});

test("a retry cannot change history or restore a broken combo", () => {
  const initial = initialInfiniteAdaptiveState();
  const missed = record(initial, "same-round", false);
  const retried = record(missed, "same-round", true, "Easy");
  assert.strictEqual(retried, missed);
  assert.equal(retried.combo, 0);
  assert.equal(retried.attempts.length, 1);
});

test("combo energy fills at the cap and never exceeds its range", () => {
  assert.equal(comboEnergyPercent(0), 0);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO / 2), 50);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO), 100);
  assert.equal(comboEnergyPercent(MAX_ENERGY_COMBO + 20), 100);
  assert.equal(comboEnergyPercent(-4), 0);
  assert.equal(comboEnergyPercent(Number.NaN), 0);
});
