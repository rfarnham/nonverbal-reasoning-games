import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldCountTurboTime,
  shouldShowTurboPaused,
} from "../lib/progression/timer-policy.ts";

const activeTurbo = {
  visible: true,
  attemptKind: "turbo",
  attemptPhase: "playing",
  hasCurrentQuestion: true,
  explanationOpen: false,
};

test("Turbo clock runs continuously through ordinary puzzle states", () => {
  for (const state of ["answering", "feedback", "solved transition"]) {
    assert.equal(
      shouldCountTurboTime(activeTurbo),
      true,
      `${state} should remain on the clock`,
    );
  }
  assert.equal(
    shouldShowTurboPaused(activeTurbo),
    false,
  );
});

test("only visibility and explicit explanations pause an active Turbo clock", () => {
  assert.equal(
    shouldCountTurboTime({ ...activeTurbo, visible: false }),
    false,
  );
  assert.equal(
    shouldCountTurboTime({ ...activeTurbo, explanationOpen: true }),
    false,
  );
  assert.equal(
    shouldShowTurboPaused({ ...activeTurbo, visible: false }),
    true,
  );
  assert.equal(
    shouldShowTurboPaused({ ...activeTurbo, explanationOpen: true }),
    true,
  );
});

test("Turbo clock does not run outside an active timed puzzle", () => {
  assert.equal(
    shouldCountTurboTime({ ...activeTurbo, attemptKind: "normal" }),
    false,
  );
  assert.equal(
    shouldCountTurboTime({ ...activeTurbo, attemptPhase: "redemption" }),
    false,
  );
  assert.equal(
    shouldCountTurboTime({ ...activeTurbo, hasCurrentQuestion: false }),
    false,
  );
});
