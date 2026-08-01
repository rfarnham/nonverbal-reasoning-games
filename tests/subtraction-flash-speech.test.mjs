import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDigitSpeechRecognition,
  getSpeechRecognitionConstructor,
  parseSpokenAnswer,
  readSpokenAnswer,
} from "../app/lab/subtraction-flash/browser-speech.ts";

const pageSource = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);

test("spoken digits and constrained homophones parse to answers 2 through 9", () => {
  const examples = new Map([
    [2, ["2", "two", "to", "too", " TWO! "]],
    [3, ["3", "three"]],
    [4, ["4", "four", "for", "fore"]],
    [5, ["5", "five"]],
    [6, ["6", "six"]],
    [7, ["7", "seven"]],
    [8, ["8", "eight", "ate"]],
    [9, ["9", "nine"]],
  ]);

  for (const [answer, transcripts] of examples) {
    for (const transcript of transcripts) {
      assert.equal(parseSpokenAnswer(transcript), answer, transcript);
    }
  }
});

test("spoken parsing rejects extra language, ambiguity, and out-of-range values", () => {
  const rejected = [
    "",
    "one",
    "ten",
    "0",
    "1",
    "the answer is four",
    "number seven",
    "four or five",
    "twenty four",
    "42",
    "tonight",
  ];

  for (const transcript of rejected) {
    assert.equal(parseSpokenAnswer(transcript), null, transcript);
  }
});

test("constructor lookup prefers the standard API and falls back to WebKit", () => {
  class StandardRecognition {}
  class WebKitRecognition {}

  assert.equal(
    getSpeechRecognitionConstructor({
      SpeechRecognition: StandardRecognition,
      webkitSpeechRecognition: WebKitRecognition,
    }),
    StandardRecognition,
  );
  assert.equal(
    getSpeechRecognitionConstructor({
      webkitSpeechRecognition: WebKitRecognition,
    }),
    WebKitRecognition,
  );
  assert.equal(getSpeechRecognitionConstructor({}), null);
});

test("digit recognition sessions use brisk one-shot browser settings", () => {
  class FakeRecognition {
    lang = "";
    continuous = true;
    interimResults = true;
    maxAlternatives = 1;
  }

  const recognition = createDigitSpeechRecognition({
    webkitSpeechRecognition: FakeRecognition,
  });

  assert.ok(recognition);
  assert.equal(recognition.lang, "en-US");
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, false);
  assert.equal(recognition.maxAlternatives, 5);
});

function result(alternatives, isFinal = true) {
  return Object.assign([...alternatives], {
    isFinal,
    item(index) {
      return this[index] ?? null;
    },
  });
}

function resultList(results) {
  return Object.assign([...results], {
    item(index) {
      return this[index] ?? null;
    },
  });
}

test("answer reading ignores interim text and checks ranked final alternatives", () => {
  const match = readSpokenAnswer({
    resultIndex: 0,
    results: resultList([
      result([{ transcript: "seven", confidence: 0.99 }], false),
      result([
        { transcript: "heaven", confidence: 0.7 },
        { transcript: "eight", confidence: 0.62 },
      ]),
    ]),
  });

  assert.deepEqual(match, {
    answer: 8,
    confidence: 0.62,
    transcript: "eight",
  });
});

test("answer reading returns null when no final alternative is one digit", () => {
  assert.equal(
    readSpokenAnswer({
      resultIndex: 0,
      results: resultList([
        result([{ transcript: "number seven", confidence: 0.9 }]),
      ]),
    }),
    null,
  );
});

test("Speak starts automatically after the prompt becomes ready", () => {
  assert.doesNotMatch(pageSource, /Tap to speak/);
  assert.doesNotMatch(pageSource, /onClick=\{startListening\}/);
  assert.match(pageSource, /const frame = requestAnimationFrame/);
  assert.match(pageSource, /startListening\(\);/);
  assert.match(pageSource, /!supported \|\|\s+disabled \|\|/);
});
