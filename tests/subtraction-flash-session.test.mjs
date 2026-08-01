import assert from "node:assert/strict";
import test from "node:test";

import {
  TWO_MINUTE_SESSION_MS,
  createSessionClock,
  formatCountdownTime,
  formatElapsedTime,
  isTimedAnswerAllowed,
  pauseSessionClock,
  readSessionElapsed,
  resumeSessionClock,
  sessionAccuracy,
  sessionEncouragement,
} from "../app/lab/subtraction-flash/session-engine.ts";

test("the session clock excludes paused time", () => {
  const started = createSessionClock(1_000);
  assert.equal(readSessionElapsed(started, 3_500), 2_500);

  const paused = pauseSessionClock(started, 4_000);
  assert.equal(readSessionElapsed(paused, 34_000), 3_000);

  const resumed = resumeSessionClock(paused, 40_000);
  assert.equal(readSessionElapsed(resumed, 41_250), 4_250);
});

test("time formatting is compact and stable at the two-minute edge", () => {
  assert.equal(formatElapsedTime(0), "0:00");
  assert.equal(formatElapsedTime(64_290, true), "1:04.2");
  assert.equal(formatCountdownTime(TWO_MINUTE_SESSION_MS), "2:00");
  assert.equal(formatCountdownTime(119_001), "2:00");
  assert.equal(formatCountdownTime(119_000), "1:59");
  assert.equal(formatCountdownTime(0), "0:00");
});

test("accuracy and encouragement handle empty and perfect runs", () => {
  assert.equal(sessionAccuracy(0, 0), null);
  assert.equal(sessionAccuracy(8, 10), 80);
  assert.equal(sessionAccuracy(99, 100), 99);
  assert.equal(sessionEncouragement(0, 0), "Ready for the next run.");
  assert.equal(sessionEncouragement(12, 12), "Perfect accuracy. Clean work.");
});

test("the two-minute deadline includes the exact boundary", () => {
  assert.equal(isTimedAnswerAllowed(119_999), true);
  assert.equal(isTimedAnswerAllowed(120_000), true);
  assert.equal(isTimedAnswerAllowed(120_001), false);
});
