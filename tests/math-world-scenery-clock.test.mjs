import assert from "node:assert/strict";
import test from "node:test";
import { createSceneryClock } from "../app/math-world/scenery-clock.ts";

function harness() {
  let now = 0, id = 0;
  const queue = new Map(), frames = [];
  const clock = createSceneryClock({
    request: callback => { queue.set(++id, callback); return id; },
    cancel: id => queue.delete(id), now: () => now, onFrame: time => frames.push(time),
  });
  return { clock, queue, frames, advance(ms) {
    now += ms;
    const pending = [...queue.values()]; queue.clear();
    for (const callback of pending) callback(now);
  } };
}

test("scenery pauses without idle RAF work and resumes without a hidden-time jump", () => {
  const h = harness();
  assert.equal(h.queue.size, 0);
  h.clock.setRunning(true);
  h.advance(40);
  assert.equal(h.frames[0], 0.04);
  h.clock.setRunning(false);
  assert.equal(h.queue.size, 0);
  h.advance(60_000);
  h.clock.setRunning(true);
  h.advance(40);
  assert.equal(h.frames[1], 0.08);
  h.clock.dispose();
  assert.equal(h.queue.size, 0);
  h.clock.setRunning(true);
  assert.equal(h.queue.size, 0, "disposed scenes cannot restart");
});

test("scenery caps painting at 30Hz, keeps only one frame pending, and bounds a long frame", () => {
  const h = harness();
  h.clock.setRunning(true); h.clock.setRunning(true);
  assert.equal(h.queue.size, 1);
  for (let i = 0; i < 120; i++) h.advance(1000 / 120);
  assert.ok(h.frames.length >= 29 && h.frames.length <= 30);
  assert.equal(h.queue.size, 1);
  const before = h.frames.at(-1);
  h.advance(5000);
  assert.ok(h.frames.at(-1) - before < 0.14, "a stalled browser cannot jump seconds of scenery");
  h.clock.dispose();
});
