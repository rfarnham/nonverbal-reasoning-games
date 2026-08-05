import assert from "node:assert/strict";
import test from "node:test";

import { buildParentProgressSummary } from "../app/lab/subtraction-flash/adaptive/analytics.ts";
import {
  deriveLearnerSkillState,
  deriveLearnerSkillStates,
  isIndependentEvidence,
  isTimingEligible,
} from "../app/lab/subtraction-flash/adaptive/mastery.ts";
import { SKILLS_BY_ID } from "../app/lab/subtraction-flash/adaptive/skills.ts";

function attempt(index, changes = {}) {
  const submittedAt = changes.submittedAt ?? (index + 1) * 10_000;
  const responseMs = changes.responseMs === undefined ? 6_000 : changes.responseMs;
  const shownAt = submittedAt - (responseMs ?? 0);
  const firstInkLatencyMs = responseMs === null ? null : Math.min(1_000, responseMs);
  const firstInkAt = firstInkLatencyMs === null ? null : shownAt + firstInkLatencyMs;
  return {
    id: `attempt-${index}`,
    learnerId: "learner",
    sessionId: changes.sessionId ?? `session-${Math.floor(index / 4)}`,
    problemId: `problem-${index}`,
    problemSeed: `seed-${index}`,
    problemFingerprint: `fingerprint-${index}`,
    skillId: "F01",
    supportingSkillIds: [],
    operands: { minuend: 12, subtrahend: 5 },
    metadata: {
      templateId: "F01:horizontal",
      format: "horizontal",
      operation: "subtraction",
    },
    sessionPosition: index,
    sessionLane: "focus",
    relatedProblemId: null,
    relatedProblemRelation: null,
    shownAt,
    firstInkAt,
    submittedAt,
    responseMs,
    firstInkLatencyMs,
    writingDurationMs:
      responseMs === null || firstInkLatencyMs === null
        ? null
        : responseMs - firstInkLatencyMs,
    appWasBackgrounded: false,
    interruptionDurationMs: 0,
    timingEligible: true,
    rawRecognizedValue: "7",
    normalizedRecognizedValue: 7,
    recognitionConfidence: 0.95,
    recognitionMargin: 0.5,
    recognitionConfirmedByChild: false,
    recognizerCorrection: false,
    expectedAnswer: 7,
    firstAttemptCorrect: true,
    eventuallyCorrect: true,
    independent: true,
    hintLevelUsed: 0,
    correctionCount: 0,
    skipped: false,
    pauseUsed: false,
    workedAnswerVisible: false,
    errorCode: null,
    diagnosticProbeResult: null,
    format: "horizontal",
    operation: "subtraction",
    ...changes,
  };
}

test("mastery evidence excludes pauses, backgrounding, revealing help, and unconfirmed recognition", () => {
  const ordinary = attempt(0);
  assert.equal(isIndependentEvidence(ordinary), true);
  assert.equal(isTimingEligible(ordinary), true);
  assert.equal(
    isIndependentEvidence(attempt(1, { appWasBackgrounded: true })),
    false,
  );
  assert.equal(isIndependentEvidence(attempt(2, { pauseUsed: true })), false);
  assert.equal(
    isIndependentEvidence(attempt(3, { workedAnswerVisible: true })),
    false,
  );
  assert.equal(isIndependentEvidence(attempt(4, { hintLevelUsed: 3 })), false);

  const uncertain = attempt(5, {
    recognitionConfidence: 0.4,
    recognitionMargin: 0.02,
    timingEligible: false,
  });
  assert.equal(isIndependentEvidence(uncertain), false);

  const confirmed = {
    ...uncertain,
    id: "attempt-confirmed",
    recognitionConfirmedByChild: true,
    independent: true,
  };
  assert.equal(isIndependentEvidence(confirmed), true);
  assert.equal(isTimingEligible(confirmed), false);
});

test("accurate but slow work masters concepts and unlocks prerequisites without becoming fluent", () => {
  const slowAccurate = Array.from({ length: 8 }, (_, index) =>
    attempt(index, {
      responseMs: 9_000,
      sessionId: index < 4 ? "session-a" : "session-b",
    }),
  );
  const state = deriveLearnerSkillState(SKILLS_BY_ID.F01, slowAccurate);
  assert.equal(state.conceptStatus, "mastered");
  assert.equal(state.fluencyStatus, "developing");

  const states = deriveLearnerSkillStates(
    [SKILLS_BY_ID.F04, SKILLS_BY_ID.F01],
    slowAccurate,
  );
  assert.equal(states.F01?.conceptStatus, "mastered");
  assert.equal(states.F04?.conceptStatus, "diagnostic");
});

test("strong independent diagnostic placement can satisfy already-known concepts", () => {
  const knownFact = Array.from({ length: 2 }, (_, index) =>
    attempt(index, {
      skillId: "F04",
      sessionId: "diagnostic-one",
      sessionLane: "diagnostic",
      diagnosticProbeResult: {
        probeId: `problem-${index}`,
        outcome: "pass",
        expectedProbeCount: 1,
      },
    }),
  );
  const knownApplication = Array.from({ length: 4 }, (_, index) =>
    attempt(index + 2, {
      skillId: "A03",
      sessionId: "diagnostic-two",
      sessionLane: "diagnostic",
      diagnosticProbeResult: {
        probeId: `problem-${index + 2}`,
        outcome: "pass",
        expectedProbeCount: 1,
      },
    }),
  );

  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F04, knownFact).conceptStatus,
    "mastered",
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.A03, knownApplication).conceptStatus,
    "mastered",
  );
});

test("hinted work receives reduced mastery credit and cannot master alone", () => {
  const hinted = Array.from({ length: 16 }, (_, index) =>
    attempt(index, {
      sessionId: index < 8 ? "hinted-a" : "hinted-b",
      hintLevelUsed: 2,
    }),
  );
  const state = deriveLearnerSkillState(SKILLS_BY_ID.F01, hinted);
  assert.equal(state.independentAttemptCount, 16);
  assert.equal(state.hintRate, 1);
  assert.equal(state.conceptStatus, "learning");
  const report = buildParentProgressSummary({
    learnerId: "learner",
    attempts: hinted,
    skillStates: { F01: state },
  });
  assert.equal(report.accuracy.independentAttemptCount, 0);
  assert.equal(report.accuracy.assistedAttemptCount, 16);
});

test("one isolated miss is sticky, while a repeated misconception reactivates learning", () => {
  const mastered = Array.from({ length: 8 }, (_, index) =>
    attempt(index, { sessionId: index < 4 ? "session-a" : "session-b" }),
  );
  const oneMiss = [
    ...mastered,
    attempt(8, {
      sessionId: "session-c",
      firstAttemptCorrect: false,
      eventuallyCorrect: true,
      errorCode: "fact_retrieval_error",
      timingEligible: false,
    }),
  ];
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, oneMiss).conceptStatus,
    "mastered",
  );

  const repeated = [
    ...oneMiss,
    attempt(9, {
      sessionId: "session-c",
      firstAttemptCorrect: false,
      eventuallyCorrect: true,
      errorCode: "fact_retrieval_error",
      timingEligible: false,
    }),
  ];
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, repeated).conceptStatus,
    "learning",
  );
});

test("all successful component probes resolve repeated full-problem misses as execution slips", () => {
  const mastered = Array.from({ length: 12 }, (_, index) =>
    attempt(index, {
      skillId: "A03",
      sessionId: index < 6 ? "session-a" : "session-b",
    }),
  );
  const misses = [12, 14].map((index) =>
    attempt(index, {
      skillId: "A03",
      sessionId: "session-c",
      firstAttemptCorrect: false,
      eventuallyCorrect: false,
      timingEligible: false,
      errorCode: "regrouped_state_lost",
    }),
  );
  const probes = misses.map((miss, offset) =>
    attempt(13 + offset * 2, {
      skillId: "R02",
      sessionId: "session-c",
      relatedProblemId: miss.problemId,
      relatedProblemRelation: "remediation_probe",
      diagnosticProbeResult: {
        probeId: miss.problemId,
        outcome: "pass",
        expectedProbeCount: 1,
      },
    }),
  );

  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.A03, [
      ...mastered,
      ...misses,
    ]).conceptStatus,
    "learning",
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.A03, [
      ...mastered,
      misses[0],
      probes[0],
      misses[1],
      probes[1],
    ]).conceptStatus,
    "mastered",
  );
});

test("late fatigue errors do not reactivate an otherwise mastered concept", () => {
  const mastered = Array.from({ length: 12 }, (_, index) =>
    attempt(index, {
      skillId: "A03",
      sessionId: index < 6 ? "session-a" : "session-b",
    }),
  );
  const late = [12, 13].map((index) =>
    attempt(index, {
      skillId: "A03",
      sessionId: "fatigue-session",
      firstAttemptCorrect: false,
      eventuallyCorrect: false,
      timingEligible: false,
      errorCode: "fatigue_related_error",
    }),
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.A03, [...mastered, ...late])
      .conceptStatus,
    "mastered",
  );
});

test("material spaced-review loss or a failed diagnostic can reactivate a mastered concept", () => {
  const mastered = Array.from({ length: 8 }, (_, index) =>
    attempt(index, { sessionId: index < 4 ? "session-a" : "session-b" }),
  );
  const weakReviews = Array.from({ length: 3 }, (_, offset) =>
    attempt(8 + offset, {
      sessionId: "review-session",
      metadata: {
        templateId: `review:F01:${offset}`,
        format: "horizontal",
        operation: "subtraction",
        challengeProvider: "spaced-review",
      },
      firstAttemptCorrect: offset === 2,
      eventuallyCorrect: true,
      errorCode: offset === 2 ? null : "execution_slip",
      timingEligible: offset === 2,
    }),
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, [
      ...mastered,
      ...weakReviews,
    ]).conceptStatus,
    "learning",
  );

  const failedDiagnostic = attempt(8, {
    sessionId: "diagnostic-session",
    diagnosticProbeResult: { probeId: "probe-f01", outcome: "fail" },
    firstAttemptCorrect: false,
    eventuallyCorrect: true,
    errorCode: "execution_slip",
    timingEligible: false,
  });
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, [
      ...mastered,
      failedDiagnostic,
    ]).conceptStatus,
    "learning",
  );

  const passingDiagnostic = attempt(9, {
    sessionId: "diagnostic-recheck",
    diagnosticProbeResult: { probeId: "probe-f01-recheck", outcome: "pass" },
  });
  const recoveryEvidence = Array.from({ length: 7 }, (_, offset) =>
    attempt(10 + offset, {
      sessionId: offset < 3 ? "recovery-a" : "recovery-b",
    }),
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, [
      ...mastered,
      failedDiagnostic,
      passingDiagnostic,
      ...recoveryEvidence,
    ]).conceptStatus,
    "mastered",
  );

  const cleanRecovery = Array.from({ length: 20 }, (_, offset) =>
    attempt(30 + offset, {
      sessionId: offset < 10 ? "clean-recovery-a" : "clean-recovery-b",
    }),
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, [
      ...mastered,
      failedDiagnostic,
      ...cleanRecovery,
    ]).conceptStatus,
    "mastered",
  );
});

test("fluency uses personal improvement or a comfortable threshold and detects a plateau", () => {
  const improving = Array.from({ length: 14 }, (_, index) =>
    attempt(index, {
      responseMs: index < 7 ? 10_000 : 7_000,
      sessionId: index < 7 ? "session-a" : "session-b",
    }),
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, improving).fluencyStatus,
    "smooth",
  );

  const alreadyComfortable = Array.from({ length: 8 }, (_, index) =>
    attempt(index, {
      responseMs: 2_500,
      sessionId: index < 4 ? "session-a" : "session-b",
    }),
  );
  assert.equal(
    deriveLearnerSkillState(SKILLS_BY_ID.F01, alreadyComfortable).fluencyStatus,
    "smooth",
  );

  const plateau = Array.from({ length: 24 }, (_, index) =>
    attempt(index, {
      responseMs: 9_000,
      sessionId: `session-${Math.floor(index / 6)}`,
    }),
  );
  const plateauState = deriveLearnerSkillState(SKILLS_BY_ID.F01, plateau);
  assert.equal(plateauState.conceptStatus, "mastered");
  assert.equal(plateauState.fluencyStatus, "plateau");
  assert.equal(plateauState.plateauExposureCount, 24);
});

test("own independent diagnostic evidence bypasses a locked prerequisite", () => {
  const diagnostic = attempt(0, {
    skillId: "F04",
    diagnosticProbeResult: { probeId: "probe-f04", outcome: "partial" },
  });
  const states = deriveLearnerSkillStates([SKILLS_BY_ID.F04], [diagnostic]);
  assert.equal(states.F04?.conceptStatus, "learning");
  assert.equal(states.F04?.independentAttemptCount, 1);
});

test("recognition uncertainty remains a raw diagnostic event without starting mathematical learning", () => {
  const uncertain = attempt(0, {
    recognitionConfidence: 0.35,
    recognitionMargin: 0.01,
    normalizedRecognizedValue: 6,
    errorCode: "recognition_uncertain",
    firstAttemptCorrect: false,
    eventuallyCorrect: false,
    independent: false,
    timingEligible: false,
  });
  const state = deriveLearnerSkillState(SKILLS_BY_ID.F01, [uncertain], {
    unlocked: true,
  });
  assert.equal(state.conceptStatus, "diagnostic");
  assert.equal(state.independentAttemptCount, 0);
  assert.equal(state.totalAttemptCount, 1);
});

test("parent reporting keeps mathematical accuracy and trustworthy speed separate", () => {
  const reliable = attempt(0, { responseMs: 4_000 });
  const pausedCorrect = attempt(1, {
    pauseUsed: true,
    timingEligible: false,
    responseMs: 30_000,
  });
  const recognitionUncertain = attempt(2, {
    recognitionConfidence: 0.4,
    recognitionMargin: 0.01,
    errorCode: "recognition_uncertain",
    firstAttemptCorrect: false,
    eventuallyCorrect: false,
    independent: false,
    timingEligible: false,
  });
  const state = deriveLearnerSkillState(SKILLS_BY_ID.F01, [reliable]);
  const report = buildParentProgressSummary({
    learnerId: "learner",
    attempts: [reliable, pausedCorrect, recognitionUncertain],
    skillStates: { F01: state },
  });

  assert.equal(report.accuracy.firstAttemptAccuracy, 1);
  assert.equal(report.accuracy.independentAttemptCount, 1);
  assert.equal(report.accuracy.assistedAttemptCount, 1);
  assert.equal(report.speed.eligibleAttemptCount, 1);
  assert.equal(report.speed.medianResponseMs, 4_000);
  assert.equal(report.errorPatternCounts.recognition_uncertain, 1);
});

test("parent reporting counts persisted spaced-review outcomes", () => {
  const reviewAttempt = attempt(0, {
    submittedAt: 50_000,
    sessionId: "review-session",
  });
  const report = buildParentProgressSummary({
    learnerId: "learner",
    attempts: [reviewAttempt],
    skillStates: {},
    reviewSchedule: [
      {
        id: "review-f01-complete",
        learnerId: "learner",
        skillId: "F01",
        intervalIndex: 0,
        dueAt: 40_000,
        scheduledAt: 0,
        lastReviewedAt: 50_000,
        completedAt: 50_000,
        status: "completed",
        sourceSessionId: "mastery-session",
        sourceProblemId: "mastery-problem",
      },
    ],
  });

  assert.equal(report.retention.reviewAttemptCount, 1);
  assert.equal(report.retention.reviewAccuracy, 1);
});

test("only a linked fresh retry resolves eventually-correct reporting", () => {
  const initial = attempt(0, {
    firstAttemptCorrect: false,
    eventuallyCorrect: false,
    timingEligible: false,
    errorCode: "execution_slip",
  });
  const probe = attempt(1, {
    skillId: "R02",
    relatedProblemId: initial.problemId,
    relatedProblemRelation: "remediation_probe",
  });
  const unresolved = buildParentProgressSummary({
    learnerId: "learner",
    attempts: [initial, probe],
    skillStates: {},
  });
  assert.equal(unresolved.accuracy.eventuallyCorrectRate, 0.5);

  const retry = attempt(2, {
    skillId: initial.skillId,
    relatedProblemId: initial.problemId,
    relatedProblemRelation: "delayed_retry",
  });
  const resolved = buildParentProgressSummary({
    learnerId: "learner",
    attempts: [initial, probe, retry],
    skillStates: {},
  });

  assert.equal(resolved.accuracy.eventuallyCorrectRate, 1);
});

test("parent reporting derives latest benchmark metrics and target comparison from the event log", () => {
  const responseTimes = [2_000, 2_000, 2_000, 3_000, 3_000, 4_000, 4_000, 4_000];
  const benchmarkAttempts = responseTimes.map((responseMs, index) =>
    attempt(index, {
      sessionId: "benchmark-latest",
      responseMs,
      ...(index === 3
        ? {
            firstAttemptCorrect: false,
            eventuallyCorrect: false,
            independent: false,
            timingEligible: false,
            errorCode: "ones_digit_error",
          }
        : {}),
    }),
  );
  const report = buildParentProgressSummary({
    learnerId: "learner",
    attempts: benchmarkAttempts,
    skillStates: {},
    completedSessions: [
      {
        sessionId: "benchmark-partial",
        learnerId: "learner",
        kind: "benchmark",
        startedAt: 60_000,
        completedAt: 80_000,
        activeDurationMs: 20_000,
        attemptedProblemCount: 2,
        independentlyCorrectCount: 2,
        eventuallyCorrectCount: 2,
        focusSkillId: null,
        endedEarlyForFatigue: false,
        completedAsPlanned: false,
      },
      {
        sessionId: "benchmark-latest",
        learnerId: "learner",
        kind: "benchmark",
        startedAt: 1_000,
        completedAt: 61_000,
        activeDurationMs: 60_000,
        attemptedProblemCount: 8,
        independentlyCorrectCount: 7,
        eventuallyCorrectCount: 7,
        focusSkillId: null,
        endedEarlyForFatigue: false,
        completedAsPlanned: true,
      },
    ],
    parentBenchmarkTargetMs: 50_000,
  });

  assert.equal(report.benchmark.completedSessionCount, 1);
  assert.equal(report.benchmark.latestCompletedAt, 61_000);
  assert.equal(report.benchmark.attemptedProblemCount, 8);
  assert.equal(report.benchmark.firstAttemptAccuracy, 7 / 8);
  assert.equal(report.benchmark.activeDurationMs, 60_000);
  assert.equal(report.benchmark.medianResponseMs, 3_000);
  assert.equal(report.benchmark.medianFirstInkLatencyMs, 1_000);
  assert.equal(report.benchmark.medianWritingDurationMs, 2_000);
  assert.equal(report.benchmark.lateSetSlowdownRatio, 2);
  assert.equal(report.benchmark.errorPatternCounts.ones_digit_error, 1);
  assert.equal(report.benchmark.targetMs, 50_000);
  assert.equal(report.benchmark.activeDurationVsTargetMs, 10_000);
});

test("benchmark pacing includes reliable wrong answers in a late slow tail", () => {
  const benchmarkAttempts = Array.from({ length: 8 }, (_, index) =>
    attempt(100 + index, {
      sessionId: "benchmark-wrong-tail",
      sessionPosition: index,
      responseMs: index < 4 ? 2_000 : 5_000,
      ...(index < 4
        ? {}
        : {
            rawRecognizedValue: "8",
            normalizedRecognizedValue: 8,
            firstAttemptCorrect: false,
            eventuallyCorrect: false,
            independent: false,
            timingEligible: false,
            errorCode: "fact_retrieval_error",
          }),
    }),
  );
  const report = buildParentProgressSummary({
    learnerId: "learner",
    attempts: benchmarkAttempts,
    skillStates: {},
    completedSessions: [
      {
        sessionId: "benchmark-wrong-tail",
        learnerId: "learner",
        kind: "benchmark",
        startedAt: 1_000,
        completedAt: 61_000,
        activeDurationMs: 60_000,
        attemptedProblemCount: 8,
        independentlyCorrectCount: 4,
        eventuallyCorrectCount: 4,
        focusSkillId: null,
        endedEarlyForFatigue: false,
        completedAsPlanned: true,
      },
    ],
  });

  assert.equal(report.benchmark.firstAttemptAccuracy, 0.5);
  assert.equal(report.benchmark.medianResponseMs, 3_500);
  assert.equal(report.benchmark.lateSetSlowdownRatio, 2.5);
});
