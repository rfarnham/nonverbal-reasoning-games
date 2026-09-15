import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDigitSpeechRecognition,
  getSpeechRecognitionConstructor,
  parseCanonicalSpokenAnswer,
  parseSpokenAnswer,
  readSpokenAnswer,
} from "../app/lab/subtraction-flash/browser-speech.ts";
import {
  readStreamingSpokenAnswer,
  SpokenAnswerStreamGate,
} from "../app/lab/subtraction-flash/speech-answer-stream.ts";

const pageSource = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);

test("spoken digits and constrained homophones still parse to answers 2 through 9", () => {
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

test("spoken parsing accepts standalone numerals and English numbers through 99", () => {
  const examples = new Map([
    [0, ["0", "zero"]],
    [1, ["1", "one"]],
    [10, ["10", "ten"]],
    [19, ["19", "nineteen"]],
    [20, ["20", "twenty"]],
    [21, ["21", "twenty one", "twenty-one"]],
    [42, ["42", "forty two", " FORTY-TWO! "]],
    [54, ["54", "fifty four"]],
    [64, ["64", "sixty four"]],
    [99, ["99", "ninety nine"]],
  ]);

  for (const [answer, transcripts] of examples) {
    for (const transcript of transcripts) {
      assert.equal(parseSpokenAnswer(transcript), answer, transcript);
      assert.equal(
        parseCanonicalSpokenAnswer(transcript),
        answer,
        `canonical ${transcript}`,
      );
    }
  }
});

test("spoken parsing rejects extra language, malformed numbers, and out-of-range values", () => {
  const rejected = [
    "",
    "the answer is four",
    "number seven",
    "four or five",
    "twenty and four",
    "twenty ten",
    "one hundred",
    "100",
    "004",
    "-1",
    "4.2",
    "tonight",
  ];

  for (const transcript of rejected) {
    assert.equal(parseSpokenAnswer(transcript), null, transcript);
  }
});

test("canonical interim parsing rejects ambiguous homophones", () => {
  for (const transcript of ["to", "too", "for", "fore", "ate"]) {
    assert.equal(parseCanonicalSpokenAnswer(transcript), null, transcript);
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

test("digit recognition creates a constrained browser recognizer", () => {
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
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
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

test("answer reading returns the leading interim digit immediately", () => {
  const match = readStreamingSpokenAnswer({
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
    answer: 7,
    confidence: 0.99,
    transcript: "seven",
  });
});

test("answer reading returns a two-digit interim answer immediately", () => {
  assert.deepEqual(
    readStreamingSpokenAnswer({
      resultIndex: 0,
      results: resultList([
        result([{ transcript: "forty two", confidence: 0.94 }], false),
      ]),
    }),
    {
      answer: 42,
      confidence: 0.94,
      transcript: "forty two",
    },
  );
});

test("interim reading never promotes a lower-ranked guess", () => {
  assert.equal(
    readStreamingSpokenAnswer({
      resultIndex: 0,
      results: resultList([
        result(
          [
            { transcript: "heaven", confidence: 0.7 },
            { transcript: "seven", confidence: 0.62 },
          ],
          false,
        ),
      ]),
    }),
    null,
  );
});

test("interim reading rejects ambiguous homophones until they are final", () => {
  for (const [transcript, answer] of [
    ["to", 2],
    ["too", 2],
    ["for", 4],
    ["fore", 4],
    ["ate", 8],
  ]) {
    const interim = {
      resultIndex: 0,
      results: resultList([
        result([{ transcript, confidence: 0.9 }], false),
      ]),
    };
    const final = {
      resultIndex: 0,
      results: resultList([result([{ transcript, confidence: 0.9 }])]),
    };

    assert.equal(readStreamingSpokenAnswer(interim), null, transcript);
    assert.equal(
      readStreamingSpokenAnswer(final)?.answer,
      answer,
      transcript,
    );
  }
});

test("final reading checks ranked alternatives", () => {
  assert.deepEqual(
    readStreamingSpokenAnswer({
      resultIndex: 0,
      results: resultList([
        result([
          { transcript: "heaven", confidence: 0.7 },
          { transcript: "eight", confidence: 0.62 },
        ]),
      ]),
    }),
    {
      answer: 8,
      confidence: 0.62,
      transcript: "eight",
    },
  );
});

test("answer reading returns null when no alternative is a standalone number", () => {
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

test("the stream trims prompt results and accepts an overlapping answer", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.beginPrompt("round-1", "eleven minus four?");
  gate.speechStarted();

  const promptInterim = {
    resultIndex: 0,
    results: resultList([
      result(
        [{ transcript: "eleven minus four", confidence: 0.96 }],
        false,
      ),
    ]),
  };
  assert.equal(gate.read(promptInterim), null);

  gate.updateRound("round-1", true);
  const bufferedPromptFinal = {
    resultIndex: 0,
    results: resultList([
      result([{ transcript: "eleven minus four", confidence: 0.98 }]),
    ]),
  };
  assert.equal(gate.read(bufferedPromptFinal), null);

  // No new speech boundary is required: an answer that overlaps the tail of
  // the prompt is still a fresh recognition result and can land immediately.
  const answerInterim = {
    resultIndex: 1,
    results: resultList([
      bufferedPromptFinal.results.item(0),
      result([{ transcript: "seven", confidence: 0.91 }], false),
    ]),
  };
  assert.deepEqual(gate.read(answerInterim), {
    answer: 7,
    confidence: 0.91,
    transcript: "seven",
  });
});

test("the stream normalizes a B120 prompt echo before trimming its answer", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.beginPrompt("round-b120", "64 minus 10 equals");
  gate.speechStarted();

  assert.equal(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result(
          [
            {
              transcript: "sixty four minus ten equals",
              confidence: 0.97,
            },
          ],
          false,
        ),
      ]),
    }),
    null,
  );

  gate.updateRound("round-b120", true);
  assert.deepEqual(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result(
          [
            {
              transcript: "sixty four minus ten equals fifty four",
              confidence: 0.93,
            },
          ],
          false,
        ),
      ]),
    }),
    {
      answer: 54,
      confidence: 0.93,
      transcript: "fifty four",
    },
  );
});

test("the stream trims a prompt when its interim slot becomes the answer", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.beginPrompt("round-1", "eleven minus four?");
  gate.speechStarted();
  assert.equal(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result(
          [{ transcript: "eleven minus four", confidence: 0.95 }],
          false,
        ),
      ]),
    }),
    null,
  );

  gate.updateRound("round-1", true);
  assert.deepEqual(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result([{ transcript: "seven", confidence: 0.92 }], false),
      ]),
    }),
    { answer: 7, confidence: 0.92, transcript: "seven" },
  );
});

test("prompt-tail revisions and lower alternatives never become answers", () => {
  for (const finalizedAlternatives of [
    [
      { transcript: "eleven minus four", confidence: 0.98 },
      { transcript: "four", confidence: 0.7 },
    ],
    [{ transcript: "four", confidence: 0.98 }],
  ]) {
    const gate = new SpokenAnswerStreamGate();
    gate.beginRecognitionSession();
    gate.beginPrompt("round-1", "eleven minus four?");
    gate.speechStarted();
    assert.equal(
      gate.read({
        resultIndex: 0,
        results: resultList([
          result(
            [
              {
                transcript: "eleven minus four",
                confidence: 0.95,
              },
            ],
            false,
          ),
        ]),
      }),
      null,
    );

    gate.updateRound("round-1", true);
    assert.equal(
      gate.read({
        resultIndex: 0,
        results: resultList([result(finalizedAlternatives)]),
      }),
      null,
    );
  }
});

test("fresh slots stay leader-only until prompt-side speech ends", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.beginPrompt("round-1", "eleven minus four?");
  gate.speechStarted();
  assert.equal(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result(
          [{ transcript: "eleven minus four", confidence: 0.95 }],
          false,
        ),
      ]),
    }),
    null,
  );
  gate.updateRound("round-1", true);

  const promptSideAlternatives = {
    resultIndex: 1,
    results: resultList([
      result([{ transcript: "eleven minus four", confidence: 0.98 }]),
      result([
        { transcript: "heaven", confidence: 0.8 },
        { transcript: "four", confidence: 0.65 },
      ]),
    ]),
  };
  assert.equal(gate.read(promptSideAlternatives), null);

  gate.speechEnded();
  gate.speechStarted();
  const freshAnswerAlternatives = {
    resultIndex: 2,
    results: resultList([
      promptSideAlternatives.results.item(0),
      promptSideAlternatives.results.item(1),
      result([
        { transcript: "heaven", confidence: 0.8 },
        { transcript: "four", confidence: 0.65 },
      ]),
    ]),
  };
  assert.equal(gate.read(freshAnswerAlternatives)?.answer, 4);
});

test("an answer appended during the prompt is ready when the gate opens", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.beginPrompt("round-1", "eleven minus four?");
  gate.speechStarted();
  assert.equal(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result(
          [
            {
              transcript: "eleven minus four seven",
              confidence: 0.9,
            },
          ],
          false,
        ),
      ]),
    }),
    null,
  );

  gate.updateRound("round-1", true);
  const expected = {
    answer: 7,
    confidence: 0.9,
    transcript: "seven",
  };
  assert.deepEqual(gate.peekBufferedAnswer(), expected);
  assert.deepEqual(gate.peekBufferedAnswer(), expected);
  assert.deepEqual(gate.takeBufferedAnswer(), expected);
  assert.equal(gate.peekBufferedAnswer(), null);
});

test("a late prompt tail cannot answer a newly opened gate", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.beginPrompt("round-1", "eleven minus four?");
  gate.speechStarted();
  gate.updateRound("round-1", true);
  gate.speechEnded();

  const latePromptTail = {
    resultIndex: 0,
    results: resultList([
      result([{ transcript: "four", confidence: 0.98 }]),
    ]),
  };
  assert.equal(gate.read(latePromptTail), null);

  gate.speechStarted();
  const nextSpeech = {
    resultIndex: 1,
    results: resultList([
      latePromptTail.results.item(0),
      result([{ transcript: "seven", confidence: 0.93 }], false),
    ]),
  };
  assert.equal(gate.read(nextSpeech)?.answer, 7);
});

test("the stream submits at most once and cannot leak into the next round", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.updateRound("round-1", true);

  const interim = {
    resultIndex: 0,
    results: resultList([
      result([{ transcript: "six", confidence: 0.88 }], false),
    ]),
  };
  assert.equal(gate.read(interim)?.answer, 6);

  gate.updateRound("round-2", false);
  gate.updateRound("round-2", true);
  const lateFinal = {
    resultIndex: 0,
    results: resultList([
      result([{ transcript: "six", confidence: 0.97 }]),
    ]),
  };
  assert.equal(gate.read(lateFinal), null);

  const nextAnswer = {
    resultIndex: 1,
    results: resultList([
      lateFinal.results.item(0),
      result([{ transcript: "three", confidence: 0.89 }], false),
    ]),
  };
  assert.equal(gate.read(nextAnswer)?.answer, 3);
});

test("a mutable interim result slot can be reused by the next card", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.updateRound("round-1", true);
  gate.speechStarted();

  const results = resultList([
    result([{ transcript: "six", confidence: 0.9 }], false),
  ]);
  assert.equal(
    gate.read({ resultIndex: 0, results })?.answer,
    6,
  );
  gate.speechEnded();

  gate.beginPrompt("round-2", "eleven minus four?");
  // Echo cancellation can suppress the TTS entirely, leaving no prompt-side
  // result to replace the mutable slot from the first answer.
  gate.updateRound("round-2", true);
  gate.speechStarted();

  results[0] = result(
    [{ transcript: "seven", confidence: 0.92 }],
    false,
  );
  assert.equal(
    gate.read({ resultIndex: 0, results })?.answer,
    7,
  );
});

test("a removed interim result releases its slot for another attempt", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.updateRound("round-1", true);
  gate.speechStarted();

  const results = resultList([
    result([{ transcript: "six", confidence: 0.9 }], false),
  ]);
  assert.equal(
    gate.read({ resultIndex: 0, results })?.answer,
    6,
  );
  gate.speechEnded();

  results.length = 0;
  assert.equal(gate.read({ resultIndex: 0, results }), null);

  gate.updateRound("round-1", false);
  gate.updateRound("round-1", true);
  gate.speechStarted();
  results[0] = result(
    [{ transcript: "seven", confidence: 0.92 }],
    false,
  );
  assert.equal(
    gate.read({ resultIndex: 0, results })?.answer,
    7,
  );
});

test("a wrong spoken answer can be retried on the same round", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.updateRound("session-1:round-1", true);

  const firstAttempt = {
    resultIndex: 0,
    results: resultList([
      result([{ transcript: "six", confidence: 0.9 }], false),
    ]),
  };
  assert.equal(gate.read(firstAttempt)?.answer, 6);

  gate.updateRound("session-1:round-1", false);
  gate.updateRound("session-1:round-1", true);
  const retry = {
    resultIndex: 1,
    results: resultList([
      result([{ transcript: "six", confidence: 0.96 }]),
      result([{ transcript: "three", confidence: 0.91 }], false),
    ]),
  };
  assert.equal(gate.read(retry)?.answer, 3);
});

test("round keys keep reused card ids independent across sessions", () => {
  const gate = new SpokenAnswerStreamGate();
  gate.beginRecognitionSession();
  gate.updateRound("session-1:card-1", true);
  assert.equal(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result([{ transcript: "four", confidence: 0.9 }], false),
      ]),
    })?.answer,
    4,
  );

  gate.beginRecognitionSession();
  gate.updateRound("session-2:card-1", true);
  assert.equal(
    gate.read({
      resultIndex: 0,
      results: resultList([
        result([{ transcript: "seven", confidence: 0.92 }], false),
      ]),
    })?.answer,
    7,
  );
});

test("Speak keeps one silent recognition stream across cards", () => {
  assert.doesNotMatch(pageSource, /Tap to speak/);
  assert.doesNotMatch(pageSource, /onBeforeListen/);
  assert.doesNotMatch(pageSource, /recognition\.stop\(\)/);
  assert.match(pageSource, /key=\{`\$\{sessionProgress\.id\}:\$\{mode\}`\}/);
  assert.match(
    pageSource,
    /active=\{\s*sessionPhase === "playing" &&\s*\(mode !== "listen" \|\| soundEnabled\)\s*\}/,
  );
  assert.match(pageSource, /accepting=\{answerReady\}/);
  assert.doesNotMatch(pageSource, /recognition\.continuous = false/);
  assert.doesNotMatch(pageSource, /recognition\.interimResults = false/);
  assert.match(pageSource, /answeredWith === "draw"/);
  assert.match(pageSource, /answeredWith !== "speak"/);
  assert.match(pageSource, /answerGate\.speechStarted\(\)/);
  assert.match(pageSource, /answerGate\.speechEnded\(\)/);
  assert.match(pageSource, /speechAnswerGate\.beginPrompt\(/);
  assert.match(pageSource, /speechAnswerGate\.updateRound\(/);
  assert.match(
    pageSource,
    /if \(listeningRound\.startedAt !== null\) \{\s*speechAnswerGate\.updateRound\(roundId, true\);/,
  );
  assert.match(
    pageSource,
    /active &&\s*speechState\.kind === "listening"/,
  );
});
