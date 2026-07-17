import assert from "node:assert/strict";
import test from "node:test";

import { playFeedbackEarcon } from "../lib/game-audio.ts";

function recordingContext() {
  const frequencies = [];
  const stops = [];

  return {
    context: {
      currentTime: 4,
      destination: {},
      createOscillator() {
        return {
          type: "sine",
          frequency: {
            setValueAtTime(value, start) {
              frequencies.push({ value, start });
            },
          },
          connect() {},
          disconnect() {},
          start() {},
          stop(time) {
            stops.push(time);
          },
          addEventListener(_name, callback) {
            callback();
          },
        };
      },
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          disconnect() {},
        };
      },
    },
    frequencies,
    stops,
  };
}

test("shared correct and incorrect earcons use the suite pitch grammar", () => {
  const correct = recordingContext();
  playFeedbackEarcon(correct.context, true);
  assert.deepEqual(
    correct.frequencies.map(({ value }) => value),
    [523.25, 659.25],
  );

  const incorrect = recordingContext();
  playFeedbackEarcon(incorrect.context, false);
  assert.deepEqual(
    incorrect.frequencies.map(({ value }) => value),
    [220, 174.61],
  );
  assert.equal(incorrect.stops.length, 2);
});

test("earcon failures never escape into gameplay", () => {
  const unavailableContext = {
    currentTime: 0,
    createOscillator() {
      throw new Error("audio unavailable");
    },
  };

  assert.doesNotThrow(() => playFeedbackEarcon(unavailableContext, true));
});
