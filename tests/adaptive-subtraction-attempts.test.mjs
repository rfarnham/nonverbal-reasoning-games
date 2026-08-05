import assert from "node:assert/strict";
import test from "node:test";

import {
  createAttemptEvent,
  createRecognitionEvent,
  recognitionIsReliable,
} from "../app/lab/subtraction-flash/adaptive/attempts.ts";
import { generateProblem } from "../app/lab/subtraction-flash/adaptive/problems.ts";

const problem = {
  id: "A03:test",
  seed: "test-seed",
  skillId: "A03",
  supportingSkillIds: ["F04", "R02", "R03", "R04"],
  difficulty: 3,
  promptSpec: {
    kind: "numeric",
    instruction: "Subtract.",
    format: "vertical",
    displayText: "42 - 17",
    math: {
      kind: "equation",
      left: 42,
      operator: "-",
      right: 17,
      result: null,
      missing: "result",
    },
  },
  answerSpec: { kind: "numeric", expected: 25, integerOnly: true },
  expectedAnswer: 25,
  operands: { minuend: 42, subtrahend: 17 },
  hints: [],
  metadata: {
    templateId: "A03:vertical",
    format: "vertical",
    operation: "subtraction",
    requiresRegrouping: true,
  },
  fingerprint: "subtraction:42:17:result",
};

function attempt(changes = {}) {
  return createAttemptEvent({
    learnerId: "learner",
    sessionId: "session",
    sessionPosition: 2,
    problem,
    shownAt: 1_000,
    firstInkAt: 1_700,
    submittedAt: 3_000,
    answer: 25,
    firstAttemptCorrect: true,
    ...changes,
  });
}

test("attempt events retain reconstructable problem and timing components", () => {
  const event = attempt();
  assert.equal(event.problemSeed, "test-seed");
  assert.deepEqual(event.problem, problem);
  assert.equal(event.problemFingerprint, problem.fingerprint);
  assert.deepEqual(event.operands, problem.operands);
  assert.deepEqual(event.metadata, problem.metadata);
  assert.equal(event.responseMs, 2_000);
  assert.equal(event.firstInkLatencyMs, 700);
  assert.equal(event.writingDurationMs, 1_300);
  assert.equal(event.independent, true);
  assert.equal(event.timingEligible, true);
});

test("forced T01 difficulty bands retain an exact replay snapshot", () => {
  for (const difficulty of [3, 4]) {
    const generated = generateProblem({
      skillId: "T01",
      seed: `t01-replay-${difficulty}`,
      difficulty,
      format: "horizontal",
    });
    const event = createAttemptEvent({
      learnerId: "learner",
      sessionId: `replay-${difficulty}`,
      sessionPosition: 0,
      problem: generated,
      shownAt: 10_000,
      submittedAt: 12_000,
      answer: generated.expectedAnswer,
      firstAttemptCorrect: true,
    });
    assert.equal(event.problem?.difficulty, difficulty);
    const replayed = generateProblem({
      skillId: event.skillId,
      seed: event.problemSeed,
      difficulty: event.problem?.difficulty,
      format: event.format,
    });
    assert.equal(replayed.fingerprint, event.problemFingerprint);
    assert.deepEqual(event.problem, generated);
  }
});

test("confirmed uncertainty can inform math but never fluency timing", () => {
  const uncertain = attempt({
    recognitionConfidence: 0.4,
    recognitionMargin: 0.04,
  });
  assert.equal(uncertain.independent, false);
  assert.equal(uncertain.timingEligible, false);

  const confirmed = attempt({
    recognitionConfidence: 0.4,
    recognitionMargin: 0.04,
    recognitionConfirmedByChild: true,
  });
  assert.equal(confirmed.independent, true);
  assert.equal(confirmed.timingEligible, false);

  const corrected = attempt({
    recognitionConfidence: 0.9,
    recognitionMargin: 0.5,
    recognizerCorrection: true,
  });
  assert.equal(corrected.independent, true);
  assert.equal(corrected.timingEligible, false);
});

test("interruptions and answer-revealing hints do not become mastery evidence", () => {
  assert.equal(attempt({ appWasBackgrounded: true }).independent, false);
  assert.equal(attempt({ pauseUsed: true }).independent, false);
  assert.equal(attempt({ hintLevelUsed: 2 }).independent, true);
  assert.equal(attempt({ hintLevelUsed: 3 }).independent, false);
  assert.equal(attempt({ workedAnswerVisible: true }).independent, false);
});

test("recognition reliability uses confidence and margin together", () => {
  assert.equal(recognitionIsReliable(null, null), true);
  assert.equal(recognitionIsReliable(0.9, 0.2), true);
  assert.equal(recognitionIsReliable(0.51, 0.2), false);
  assert.equal(recognitionIsReliable(0.9, 0.09), false);

  const event = createRecognitionEvent({
    kind: "recognition_corrected",
    learnerId: "learner",
    sessionId: "session",
    problemId: problem.id,
    occurredAt: 4_000,
    rawRecognizedValue: "35",
    normalizedRecognizedValue: 35,
    recognitionConfidence: 0.38,
    recognitionMargin: 0.02,
    confirmedByChild: false,
    correctedValue: 25,
  });
  assert.match(event.id, /recognition_corrected$/);
  assert.equal(event.correctedValue, 25);
});
