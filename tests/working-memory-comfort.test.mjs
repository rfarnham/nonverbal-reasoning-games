import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptComfortState,
  validateComfortState,
  withComfortState,
} from "../app/lab/working-memory/comfort-adaptation.ts";
import { enumerateDigitVariants } from "../app/lab/working-memory/digit-options.ts";

function initial(span = 5, max = 9) {
  return withComfortState({ span }, 2, max);
}

function answer(state, correct, max = 9) {
  const before = structuredClone(state);
  const next = adaptComfortState(state, correct, 2, max);
  assert.deepEqual(state, before);
  assert.ok(validateComfortState(next, 2, max));
  return next;
}

function successes(state, count, max = 9) {
  for (let index = 0; index < count; index += 1) state = answer(state, true, max);
  return state;
}

function randomFor(seed) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate({ span = 5, trials = 10_000, probability, seed = 1729, max = 9 }) {
  let state = initial(span, max);
  const random = randomFor(seed);
  const counts = {};
  const harderTrials = [];
  const bases = [];
  for (let index = 0; index < trials; index += 1) {
    const presented = state.span;
    counts[presented] = (counts[presented] ?? 0) + 1;
    if (presented === 6) harderTrials.push(index);
    bases.push(state.comfortSpan);
    state = adaptComfortState(state, random() < probability(presented, index), 2, max);
    assert.ok(validateComfortState(state, 2, max));
  }
  return { state, counts, harderTrials, bases };
}

test("two baseline wins schedule one probe; two spaced successful probes establish the harder span", () => {
  let state = initial();
  assert.equal(state.span, 5);
  assert.equal(state.probeWait, 2);
  state = successes(state, 2);
  assert.equal(state.span, 6);
  assert.equal(state.comfortSpan, 5);
  state = answer(state, true);
  assert.equal(state.span, 5);
  assert.equal(state.probeWins, 1);
  state = successes(state, 2);
  assert.equal(state.span, 6);
  state = answer(state, true);
  assert.equal(state.span, 6);
  assert.equal(state.comfortSpan, 6);
  assert.equal(state.probeWins, 0);
  assert.equal(state.probeWait, 2);
});

test("failed harder probes retreat immediately and back off for eight then sixteen successful baseline answers", () => {
  let state = answer(successes(initial(), 2), false);
  assert.equal(state.span, 5);
  assert.equal(state.comfortSpan, 5);
  assert.equal(state.probeWait, 8);
  state = successes(state, 3);
  const waitBeforeMiss = state.probeWait;
  state = answer(state, false);
  assert.equal(state.probeWait, waitBeforeMiss);
  state = successes(state, 4);
  assert.equal(state.span, 5);
  state = answer(state, true);
  assert.equal(state.span, 6);
  state = answer(state, false);
  assert.equal(state.span, 5);
  assert.equal(state.probeWait, 16);
  for (let failure = 0; failure < 4; failure += 1) {
    state = successes(state, 15);
    assert.equal(state.span, 5);
    state = answer(state, true);
    assert.equal(state.span, 6);
    state = answer(state, false);
    assert.equal(state.probeWait, 16);
    assert.equal(state.probeWins, 0);
  }
});

test("two baseline misses retreat while a single miss and recognition-free pause preserve the baseline", () => {
  let state = initial(7);
  state = answer(state, false);
  assert.equal(state.comfortSpan, 7);
  assert.equal(state.baseMisses, 1);
  const resumed = JSON.parse(JSON.stringify(state));
  assert.deepEqual(resumed, state);
  state = answer(resumed, true);
  assert.equal(state.baseMisses, 0);
  state = answer(answer(state, false), false);
  assert.equal(state.comfortSpan, 6);
  assert.equal(state.span, 6);
  assert.equal(state.probeWait, 8);
  state = answer(answer(state, false), false);
  assert.equal(state.comfortSpan, 5);
  assert.equal(state.probeWait, 8);
});

test("failed harder-target backoff survives baseline retreats and recovery", () => {
  let state = answer(successes(initial(), 2), false);
  state = answer(successes(state, 8), false);
  assert.equal(state.probeWait, 16);
  const failedSix = state.probeBackoff;
  state = answer(answer(state, false), false);
  assert.equal(state.comfortSpan, 4);
  state = successes(state, 8);
  assert.equal(state.span, 5);
  state = answer(state, true);
  state = successes(state, 2);
  state = answer(state, true);
  assert.equal(state.comfortSpan, 5);
  assert.equal(state.probeBackoff, failedSix);
  assert.equal(state.probeWait, 16);
  assert.equal(state.span, 5);
});

test("an unmanageable legacy target is remembered and becomes easier on the next question", () => {
  const original = { span: 6, attempts: 42, correct: 30 };
  const rescued = withComfortState(original, 2, 9, 6);
  assert.equal(rescued.comfortSpan, 5);
  assert.equal(rescued.span, 5);
  assert.equal(rescued.probeWait, 8);
  assert.equal(rescued.attempts, 42);
  assert.equal(rescued.correct, 30);
  assert.deepEqual(original, { span: 6, attempts: 42, correct: 30 });
});

test("95%-at-five and 0%-at-six simulations spend most practice at five with rare, separated harder probes", () => {
  for (const seed of [1729, 42, 20261021]) {
    const result = simulate({ seed, probability: (span) => span <= 4 ? 1 : span === 5 ? 0.95 : 0 });
    assert.ok(result.counts[5] / 10_000 > 0.87, JSON.stringify(result.counts));
    assert.ok(result.counts[6] / 10_000 < 0.065, JSON.stringify(result.counts));
    assert.ok(result.counts[6] / 10_000 > 0.035);
    assert.equal(result.counts[7], undefined);
    for (let index = 1; index < result.harderTrials.length; index += 1) {
      assert.ok(result.harderTrials[index] - result.harderTrials[index - 1] >= 9);
    }
    assert.equal(result.state.comfortSpan, 5);
  }
});

test("starting too high retreats quickly and real improvement escapes a previously failed target", () => {
  const wall = simulate({ span: 7, trials: 200, probability: (span) => span <= 4 ? 1 : span === 5 ? 0.95 : 0 });
  assert.deepEqual(wall.bases.slice(0, 5), [7, 7, 6, 6, 5]);
  assert.ok((wall.counts[5] ?? 0) / 200 > 0.85);
  const learning = simulate({ trials: 1300, probability: (span, index) => span <= 4 ? 1
    : span === 5 ? 0.95 : span === 6 && index >= 1000 ? 1 : 0 });
  const promotedAt = learning.bases.findIndex((span, index) => index >= 1000 && span === 6);
  assert.ok(promotedAt >= 1000 && promotedAt <= 1045, `Promotion at ${promotedAt}`);
  assert.ok(learning.counts[7] < 25);
  const easy = simulate({ span: 2, trials: 70, probability: () => 1 });
  assert.equal(easy.state.comfortSpan, 9);
  assert.equal(easy.state.span, 9);
});

test("floors and task ceilings stay bounded and the easiest span can recover after repeated failures", () => {
  for (const max of [6, 9]) {
    const failed = simulate({ span: 2, trials: 200, max, probability: () => 0 });
    assert.deepEqual(failed.counts, { 2: 200 });
    assert.equal(failed.state.comfortSpan, 2);
    let recovered = successes(failed.state, 2, max);
    assert.equal(recovered.span, 3);
    recovered = successes(recovered, 4, max);
    assert.equal(recovered.comfortSpan, 3);
    const ceiling = simulate({ span: max, trials: 100, max, probability: () => 1 });
    assert.deepEqual(ceiling.counts, { [max]: 100 });
  }
});

test("the nine digit variants at both paces carry independent serializable controller state", () => {
  const conditions = enumerateDigitVariants().flatMap((variant) => [false, true].map((slow) => ({ variant, slow })));
  assert.equal(conditions.length, 18);
  const bank = Object.fromEntries(conditions.map(({ variant, slow }) => [JSON.stringify([variant, slow]), initial()]));
  const keys = Object.keys(bank);
  const untouched = structuredClone(bank);
  bank[keys[0]] = answer(successes(bank[keys[0]], 2), false);
  assert.equal(bank[keys[0]].probeWait, 8);
  for (const key of keys.slice(1)) assert.deepEqual(bank[key], untouched[key]);
  const resumed = JSON.parse(JSON.stringify(bank));
  resumed[keys[0]] = successes(resumed[keys[0]], 8);
  assert.equal(resumed[keys[0]].span, 6);
  assert.equal(bank[keys[0]].span, 5);
});
