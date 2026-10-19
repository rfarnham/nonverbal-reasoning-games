import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiledTimer = ts.transpileModule(readFileSync(
  new URL("../app/games/picture-memory/use-visible-timer.ts", import.meta.url), "utf8",
), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

/** Deterministic browser clock and effect lifecycle; layout commits can precede passive cleanup. */
function timerHarness() {
  let now = 0, nextId = 0, cursor = 0, layout = [], passive = [];
  const slots = [], timers = new Map();
  class Surface {
    listeners = new Map();
    visibilityState = "visible";
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    emit(name) { for (const callback of this.listeners.get(name) ?? []) callback(); }
    count() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
  }
  const document = new Surface(), window = new Surface();
  function effect(setup, deps, queue) {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, offset) => !Object.is(value, old.deps[offset]))) {
      queue.push({ index, old, setup, deps });
    }
  }
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useLayoutEffect: (setup, deps) => effect(setup, deps, layout),
    useEffect: (setup, deps) => effect(setup, deps, passive),
  };
  const timerModule = { exports: {} };
  vm.runInNewContext(compiledTimer, {
    module: timerModule, exports: timerModule.exports,
    require: (specifier) => { assert.equal(specifier, "react"); return react; },
    document, window, performance: { now: () => now },
    setTimeout: (callback, delay) => { timers.set(++nextId, { callback, due: now + delay }); return nextId; },
    clearTimeout: (id) => timers.delete(id),
  });
  function commit(queue) {
    queue.forEach(({ old }) => old?.cleanup?.());
    queue.forEach(({ index, setup, deps }) => { slots[index] = { setup, deps, cleanup: setup() }; });
  }
  function renderLayout(options) { cursor = 0; timerModule.exports.useVisibleTimer(options); commit(layout); layout = []; }
  function flushPassive() { commit(passive); passive = []; }
  function render(options) { renderLayout(options); flushPassive(); }
  function cleanup() { slots.forEach((slot) => slot?.cleanup?.()); }
  function advance(ms) {
    const target = now + ms;
    let remainingCallbacks = 100;
    while (remainingCallbacks--) {
      const next = [...timers].sort((left, right) => left[1].due - right[1].due)[0];
      if (!next || next[1].due > target) break;
      now = next[1].due;
      timers.delete(next[0]);
      next[1].callback();
    }
    assert.ok(remainingCallbacks > 0, "Timer callbacks must remain bounded.");
    now = target;
  }
  return {
    document, window, timers, render, renderLayout, flushPassive, advance, cleanup,
    advanceWithoutCallbacks: (ms) => { now += ms; },
    replayEffects: () => { cleanup(); slots.forEach((slot) => { if (slot?.setup) slot.cleanup = slot.setup(); }); },
  };
}

test("study timers count visible exposure and preserve their budget across callback rerenders", () => {
  const harness = timerHarness(), reports = [];
  let expired = 0, latestExpired = 0;
  const options = { active: true, resetKey: "study", durationMs: 4000, onElapsed: () => expired++, onRemaining: (value) => reports.push(value) };
  harness.render(options);
  harness.advance(1500);
  harness.document.visibilityState = "hidden";
  harness.document.emit("visibilitychange");
  assert.equal(reports.at(-1), 2500);
  harness.advance(30_000);
  assert.equal(expired, 0);
  harness.document.visibilityState = "visible";
  harness.document.emit("visibilitychange");
  harness.render({ ...options, durationMs: 1, onElapsed: () => latestExpired++ });
  harness.advance(2499);
  assert.equal(latestExpired, 0);
  harness.advance(1);
  assert.equal(latestExpired, 1);
  assert.equal(expired, 0);
  harness.cleanup();
});

test("leaving study flushes the remaining budget and removes browser listeners", () => {
  const harness = timerHarness(), reports = [];
  const options = { active: true, resetKey: "study", durationMs: 12000, onElapsed: () => {}, onRemaining: (value) => reports.push(value) };
  harness.render(options);
  harness.advance(3000);
  harness.render({ ...options, active: false });
  assert.equal(reports.at(-1), 9000);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.document.count() + harness.window.count(), 0);
});

test("queued callbacks from an old round cannot complete or overwrite the next round", () => {
  const harness = timerHarness(), nextReports = [];
  let expired = 0;
  const options = { active: true, resetKey: "old", durationMs: 4000, onElapsed: () => expired++ };
  harness.render(options);
  harness.advance(250);
  const staleTick = [...harness.timers.values()][0].callback;
  harness.renderLayout({ ...options, resetKey: "new", onRemaining: (value) => nextReports.push(value) });
  harness.advanceWithoutCallbacks(5000);
  staleTick();
  harness.window.emit("beforeunload");
  harness.document.visibilityState = "hidden";
  harness.document.emit("visibilitychange");
  harness.window.emit("pagehide");
  harness.window.emit("pageshow");
  assert.deepEqual(nextReports, []);
  assert.equal(expired, 0);
  harness.document.visibilityState = "visible";
  harness.flushPassive();
  assert.deepEqual(nextReports, [4000]);
  harness.advance(4000);
  assert.equal(expired, 1);
  harness.cleanup();
});

test("zero-duration automatic transitions fire once through Strict Mode effect replay", () => {
  const harness = timerHarness();
  let expired = 0;
  harness.render({ active: true, resetKey: "automatic-commit", durationMs: 0, onElapsed: () => expired++ });
  harness.replayEffects();
  assert.equal(expired, 0);
  harness.advance(0);
  assert.equal(expired, 1);
  harness.advance(10);
  assert.equal(expired, 1);
  harness.cleanup();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.document.count() + harness.window.count(), 0);
});
