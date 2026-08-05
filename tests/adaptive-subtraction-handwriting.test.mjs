import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADAPTIVE_HANDWRITING_SLOT_COUNT,
  adaptiveTypedAnswerIsReady,
  handwritingSlotsWithInk,
  normalizeAdaptiveTypedAnswer,
} from "../app/lab/subtraction-flash/adaptive-handwriting-logic.ts";

const component = await readFile(
  new URL(
    "../app/lab/subtraction-flash/adaptive-handwriting.tsx",
    import.meta.url,
  ),
  "utf8",
);
const styles = await readFile(
  new URL(
    "../app/lab/subtraction-flash/adaptive-handwriting.module.css",
    import.meta.url,
  ),
  "utf8",
);
const curriculum = await readFile(
  new URL(
    "../app/lab/subtraction-flash/adaptive-curriculum.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("adaptive handwriting reuses the local recognizer and established thresholds", () => {
  assert.match(component, /recognizeDigit/);
  assert.match(component, /warmDigitRecognizer/);
  assert.match(component, /ADAPTIVE_HANDWRITING_CONFIDENCE = 0\.52/);
  assert.match(component, /ADAPTIVE_HANDWRITING_MARGIN = 0\.1/);
  assert.match(component, /prediction\.confidence >= ADAPTIVE_HANDWRITING_CONFIDENCE/);
  assert.match(component, /prediction\.margin >= ADAPTIVE_HANDWRITING_MARGIN/);
});

test("every recognition can be confirmed or rejected before math submission", () => {
  assert.match(component, /setPending\(recognition\)/);
  assert.match(component, /setPhase\("confirming"\)/);
  assert.match(component, /Yes, that’s right/);
  assert.match(component, />\s*Rewrite\s*</);
  assert.match(component, /onRejectedRecognition\?\.\(\{/);
  assert.match(component, /reason: "child-rejected"/);
  assert.match(component, /recognitionConfirmedByChild/);
  assert.match(component, /pending\.digitResults\.some\(\(\{ reliable \}\) => !reliable\)/);
});

test("answer events retain recognition, correction, and timing evidence", () => {
  for (const field of [
    "digitResults",
    "confidence",
    "margin",
    "firstInkAt",
    "recognitionRequestedAt",
    "recognizedAt",
    "submittedAt",
    "writingDurationMs",
    "correctionCount",
  ]) {
    assert.match(component, new RegExp(`\\b${field}\\b`), field);
  }
  assert.match(component, /return Date\.now\(\)/);
  assert.match(
    component,
    /const submittedAt = uncertain \? now\(\) : pending\.recognizedAt/,
  );
});

test("every numeric problem gets the same answer-neutral two-slot control", () => {
  assert.equal(ADAPTIVE_HANDWRITING_SLOT_COUNT, 2);
  assert.match(
    component,
    /Array\.from\(\{ length: ADAPTIVE_HANDWRITING_SLOT_COUNT \}/,
  );
  assert.match(component, /Use either box for one digit/);
  assert.doesNotMatch(component, /digitCount/);
  assert.doesNotMatch(
    curriculum,
    /<AdaptiveHandwritingInput[\s\S]{0,300}expectedAnswer/,
  );
  assert.doesNotMatch(curriculum, /digitCount=/);
  assert.match(
    curriculum,
    /const drawAvailable = problem\?\.answerSpec\.kind === "numeric"/,
  );
});

test("one inked slot reads one digit and two inked slots read left to right", () => {
  assert.deepEqual(handwritingSlotsWithInk([true, false]), [0]);
  assert.deepEqual(handwritingSlotsWithInk([false, true]), [1]);
  assert.deepEqual(handwritingSlotsWithInk([true, true]), [0, 1]);
  assert.deepEqual(handwritingSlotsWithInk([false, false]), []);
  assert.deepEqual(handwritingSlotsWithInk([true, true, true]), [0, 1]);
});

test("keyboard fallback accepts either answer width without hidden-answer input", () => {
  assert.equal(normalizeAdaptiveTypedAnswer("7"), "7");
  assert.equal(normalizeAdaptiveTypedAnswer("4a2"), "42");
  assert.equal(normalizeAdaptiveTypedAnswer("123"), "12");
  assert.equal(adaptiveTypedAnswerIsReady("7"), true);
  assert.equal(adaptiveTypedAnswerIsReady("42"), true);
  assert.equal(adaptiveTypedAnswerIsReady(""), false);
  assert.equal(adaptiveTypedAnswerIsReady("123"), false);
  assert.match(component, /<canvas/);
  assert.match(component, /inputMode="numeric"/);
  assert.match(component, /Type instead/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
