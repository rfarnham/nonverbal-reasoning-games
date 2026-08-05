import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAttemptEvent,
  createEmptyAdaptiveSubtractionProgress,
  loadAdaptiveSubtractionProgressDiagnostic,
  setActiveAdaptiveSession,
  writeAdaptiveSubtractionProgress,
} from "../app/lab/subtraction-flash/adaptive-storage.ts";
import {
  attemptWasEventuallyCorrect,
  createAttemptEvent,
} from "../app/lab/subtraction-flash/adaptive/attempts.ts";
import {
  buildAdaptiveSessionPlan,
  buildEasyCloseCard,
  classifyAdaptiveError,
  replanAfterAttempt,
} from "../app/lab/subtraction-flash/adaptive/planner.ts";
import {
  evaluateProblemAnswer,
  generateProblem,
} from "../app/lab/subtraction-flash/adaptive/problems.ts";
import { diagnosticSessionNumber } from "../app/lab/subtraction-flash/adaptive/progression.ts";
import {
  BENCHMARK_INTERVAL_DAYS,
  DAY_MS,
  benchmarkEligibility,
  isWeeklyBenchmarkEligible,
} from "../app/lab/subtraction-flash/adaptive/scheduling.ts";
import {
  adaptiveSessionCompletedAsPlanned,
  advanceAdaptiveSession,
  backgroundAdaptiveSession,
  createAdaptiveSession,
  finishAdaptiveSession,
  foregroundAdaptiveSession,
  pendingAttemptForSession,
  shortenAdaptiveSessionForFatigue,
  startAdaptiveSession,
} from "../app/lab/subtraction-flash/adaptive/session.ts";

const LEARNER_ID = "integration-learner";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function learningState(skillId, overrides = {}) {
  return {
    skillId,
    conceptStatus: "learning",
    fluencyStatus: "developing",
    weightedAccuracy: 0.7,
    independentAttemptCount: 2,
    correctIndependentAttemptCount: 1,
    hintRate: 0,
    recentErrorCodes: [],
    plateauExposureCount: 0,
    consecutiveSuccessfulSessions: 0,
    recentIndependentResults: [true, false],
    ...overrides,
  };
}

function plan(changes = {}) {
  return buildAdaptiveSessionPlan({
    learnerId: LEARNER_ID,
    seed: "integration-plan",
    createdAt: 1_000,
    skillStates: {},
    ...changes,
  });
}

function wrongAnswer(problem) {
  if (problem.expectedAnswer === "yes") return "no";
  if (problem.expectedAnswer === "no") return "yes";
  return problem.expectedAnswer + 1;
}

function completedSummary({
  sessionId,
  kind,
  startedAt,
  completedAt,
  completedAsPlanned,
}) {
  return {
    sessionId,
    learnerId: LEARNER_ID,
    kind,
    startedAt,
    completedAt,
    activeDurationMs: completedAt - startedAt,
    attemptedProblemCount: 8,
    independentlyCorrectCount: 8,
    eventuallyCorrectCount: 8,
    focusSkillId: null,
    endedEarlyForFatigue: false,
    completedAsPlanned,
  };
}

function diagnosticEvidence(sessionId, seed, count = 6) {
  const source = plan({
    seed,
    diagnosticSessionNumber: 1,
    sessionLength: "short",
  });
  return source.cards.slice(0, count).map((card, index) => {
    const shownAt = 10_000 + index * 1_000;
    return createAttemptEvent({
      learnerId: LEARNER_ID,
      sessionId,
      sessionPosition: index,
      sessionLane: card.lane,
      problem: card.problem,
      shownAt,
      firstInkAt: shownAt + 200,
      submittedAt: shownAt + 500,
      answer: card.problem.expectedAnswer,
      firstAttemptCorrect: true,
      diagnosticProbeResult: {
        probeId: card.problem.id,
        outcome: "pass",
        expectedProbeCount: 1,
      },
    });
  });
}

test("a new diagnostic starts one finite seeded plan with a fixed target", () => {
  const diagnostic = plan({
    seed: "new-diagnostic",
    diagnosticSessionNumber: 1,
  });
  assert.equal(diagnostic.kind, "diagnostic");
  assert.equal(diagnostic.cards.length, 10);
  assert.equal(diagnostic.targetCardCount, diagnostic.cards.length);
  assert.equal(diagnostic.cards.at(-1).lane, "easy_close");

  const started = startAdaptiveSession(createAdaptiveSession(diagnostic), 2_000);
  assert.equal(started.phase, "diagnostic");
  assert.equal(started.currentCardIndex, 0);
  assert.equal(started.currentProblem?.id, diagnostic.cards[0].problem.id);
  assert.equal(started.cards.filter(({ status }) => status === "active").length, 1);
  assert.equal(started.cards.filter(({ status }) => status === "planned").length, 9);
});

test("storage round-trips both a mid-card session and its answered feedback boundary", () => {
  const storage = memoryStorage();
  const sourcePlan = plan({ seed: "persist-mid-card", sessionLength: "short" });
  const started = startAdaptiveSession(createAdaptiveSession(sourcePlan), 2_000);
  let progress = setActiveAdaptiveSession(
    createEmptyAdaptiveSubtractionProgress(LEARNER_ID, 0),
    started,
    2_200,
  );

  assert.equal(writeAdaptiveSubtractionProgress(progress, storage), true);
  let hydrated = loadAdaptiveSubtractionProgressDiagnostic(storage);
  assert.equal(hydrated.status, "loaded");
  assert.equal(hydrated.progress.activeSession?.currentProblem?.id, started.currentProblem.id);
  assert.equal(hydrated.progress.activeSession?.shownAt, 2_000);
  assert.equal(hydrated.progress.activeSession?.activeSince, 2_000);
  assert.equal(pendingAttemptForSession(hydrated.progress.activeSession, []), null);

  const currentCard = started.cards[started.currentCardIndex];
  const failed = createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId: started.id,
    sessionPosition: started.currentCardIndex,
    sessionLane: currentCard.lane,
    problem: started.currentProblem,
    shownAt: started.shownAt,
    firstInkAt: 2_300,
    submittedAt: 2_800,
    answer: wrongAnswer(started.currentProblem),
    firstAttemptCorrect: false,
    errorCode: "unclassified_math_error",
  });
  progress = appendAttemptEvent(progress, failed);
  progress = setActiveAdaptiveSession(progress, started, 2_900);
  assert.equal(writeAdaptiveSubtractionProgress(progress, storage), true);

  hydrated = loadAdaptiveSubtractionProgressDiagnostic(storage);
  const restoredSession = hydrated.progress.activeSession;
  assert.ok(restoredSession);
  assert.equal(restoredSession.currentProblem?.id, failed.problemId);
  assert.deepEqual(
    pendingAttemptForSession(restoredSession, hydrated.progress.attemptEvents),
    hydrated.progress.attemptEvents[0],
  );
  assert.equal(restoredSession.cards[0].status, "active");
});

test("a full-problem miss creates linked probes and only a fresh delayed retry resolves it", () => {
  const original = plan({
    seed: "linked-remediation",
    focusSkillId: "A03",
    skillStates: { A03: learningState("A03") },
  });
  const failedIndex = original.cards.findIndex(
    ({ skillId, lane }) => skillId === "A03" && lane !== "easy_close",
  );
  assert.ok(failedIndex >= 0);
  const failedCard = original.cards[failedIndex];
  const failed = createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId: original.id,
    sessionPosition: failedIndex,
    sessionLane: failedCard.lane,
    problem: failedCard.problem,
    shownAt: 2_000,
    firstInkAt: 2_400,
    submittedAt: 3_000,
    answer: wrongAnswer(failedCard.problem),
    firstAttemptCorrect: false,
    errorCode: "regrouped_state_lost",
  });
  const adapted = replanAfterAttempt({
    plan: original,
    cardIndex: failedIndex,
    attempt: failed,
  });
  const probeCards = adapted.cards.filter(
    ({ remediationForProblemId }) => remediationForProblemId === failed.problemId,
  );
  const retryCard = adapted.cards.find(
    ({ delayedRetryForProblemId }) => delayedRetryForProblemId === failed.problemId,
  );
  assert.ok(probeCards.length >= 1);
  assert.ok(retryCard);
  assert.notEqual(retryCard.problem.fingerprint, failed.problemFingerprint);

  const probeCard = probeCards[0];
  const probeIndex = adapted.cards.indexOf(probeCard);
  const probe = createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId: original.id,
    sessionPosition: probeIndex,
    sessionLane: probeCard.lane,
    relatedProblemId: probeCard.remediationForProblemId,
    relatedProblemRelation: "remediation_probe",
    problem: probeCard.problem,
    shownAt: 4_000,
    firstInkAt: 4_200,
    submittedAt: 4_600,
    answer: probeCard.problem.expectedAnswer,
    firstAttemptCorrect: true,
    diagnosticProbeResult: {
      probeId: failed.problemId,
      outcome: "pass",
      expectedProbeCount: probeCards.length,
    },
  });
  assert.equal(probe.relatedProblemRelation, "remediation_probe");
  assert.equal(probe.relatedProblemId, failed.problemId);
  assert.equal(attemptWasEventuallyCorrect(failed, [failed, probe]), false);

  const retryIndex = adapted.cards.indexOf(retryCard);
  const retry = createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId: original.id,
    sessionPosition: retryIndex,
    sessionLane: retryCard.lane,
    relatedProblemId: retryCard.delayedRetryForProblemId,
    relatedProblemRelation: "delayed_retry",
    problem: retryCard.problem,
    shownAt: 6_000,
    firstInkAt: 6_200,
    submittedAt: 6_700,
    answer: retryCard.problem.expectedAnswer,
    firstAttemptCorrect: true,
  });
  assert.ok(retryIndex - failedIndex >= 2 && retryIndex - failedIndex <= 4);
  assert.equal(retry.relatedProblemRelation, "delayed_retry");
  assert.equal(retry.relatedProblemId, failed.problemId);
  assert.equal(failed.eventuallyCorrect, false);
  assert.equal(attemptWasEventuallyCorrect(failed, [failed, probe, retry]), true);
});

test("typed three-digit misconception values reach wrong-operation diagnosis intact", () => {
  const problem = Array.from({ length: 32 }, (_, index) =>
    generateProblem({
      skillId: "A03",
      seed: `three-digit-wrong-operation:${index}`,
    }),
  ).find(
    (candidate) =>
      candidate.operands.minuend + candidate.operands.subtrahend >= 100,
  );
  assert.ok(problem);
  const additionInstead = problem.operands.minuend + problem.operands.subtrahend;
  const typedValue = String(additionInstead);
  assert.equal(typedValue.length, 3);

  const evaluation = evaluateProblemAnswer(problem, typedValue);
  assert.equal(evaluation.normalizedAnswer, additionInstead);
  assert.equal(evaluation.correct, false);
  const errorCode = classifyAdaptiveError({
    problem,
    answer: evaluation.normalizedAnswer,
  });
  assert.equal(errorCode, "wrong_operation");

  const event = createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId: "three-digit-input",
    sessionPosition: 0,
    sessionLane: "focus",
    problem,
    shownAt: 1_000,
    firstInkAt: 1_300,
    submittedAt: 2_000,
    answer: evaluation.normalizedAnswer,
    rawRecognizedValue: typedValue,
    firstAttemptCorrect: evaluation.correct,
    errorCode,
  });
  assert.equal(event.rawRecognizedValue, typedValue);
  assert.equal(event.normalizedRecognizedValue, additionInstead);
  assert.equal(event.errorCode, "wrong_operation");
});

test("manual, time-cap, and fatigue-shortened endings retain their partial-completion semantics", () => {
  const manualPlan = plan({ seed: "manual-completion", sessionLength: "short" });
  const manual = finishAdaptiveSession(
    startAdaptiveSession(createAdaptiveSession(manualPlan), 1_000),
    1_500,
  );
  assert.equal(manual.phase, "complete");
  assert.equal(adaptiveSessionCompletedAsPlanned(manual), false);
  assert.ok(manual.cards.some(({ status }) => status === "skipped"));

  const capPlan = plan({
    seed: "time-cap-completion",
    sessionLength: "short",
    maxActiveDurationMs: 100,
  });
  const capped = advanceAdaptiveSession(
    startAdaptiveSession(createAdaptiveSession(capPlan), 2_000),
    2_150,
  );
  assert.equal(capped.phase, "complete");
  assert.equal(capped.activeElapsedMs, 150);
  assert.equal(adaptiveSessionCompletedAsPlanned(capped), false);

  const fatiguePlan = plan({ seed: "fatigue-completion", sessionLength: "standard" });
  const fatigueStart = startAdaptiveSession(createAdaptiveSession(fatiguePlan), 3_000);
  const close = buildEasyCloseCard({
    seed: "fatigue-close",
    excludedFingerprints: fatiguePlan.cards.map(({ problem }) => problem.fingerprint),
  });
  const shortened = shortenAdaptiveSessionForFatigue(fatigueStart, close);
  const atClose = advanceAdaptiveSession(shortened, 3_400);
  const fatigueComplete = advanceAdaptiveSession(atClose, 3_900);
  assert.equal(fatigueComplete.phase, "ended_early_for_fatigue");
  assert.equal(fatigueComplete.fatigueFlag, true);
  assert.equal(adaptiveSessionCompletedAsPlanned(fatigueComplete), false);
  // The shortened child-facing plan was finished, but it must not advance a
  // diagnostic placement or start a benchmark lockout as a full session.
  assert.ok(fatigueComplete.cards.every(({ status }) => status === "completed"));
});

test("diagnostic placement advances only from sufficiently completed sessions", () => {
  const empty = createEmptyAdaptiveSubtractionProgress(LEARNER_ID, 0);
  assert.equal(diagnosticSessionNumber(empty), 1);

  const firstId = "diagnostic-first";
  const firstEvidence = diagnosticEvidence(firstId, "placement-first");
  const firstPartial = completedSummary({
    sessionId: firstId,
    kind: "diagnostic",
    startedAt: 1_000,
    completedAt: 9_000,
    completedAsPlanned: false,
  });
  assert.equal(
    diagnosticSessionNumber({
      ...empty,
      attemptEvents: firstEvidence,
      completedSessions: [firstPartial],
    }),
    1,
  );

  const firstComplete = { ...firstPartial, completedAsPlanned: true };
  assert.equal(
    diagnosticSessionNumber({
      ...empty,
      attemptEvents: firstEvidence.slice(0, 5),
      completedSessions: [firstComplete],
    }),
    1,
  );
  assert.equal(
    diagnosticSessionNumber({
      ...empty,
      attemptEvents: firstEvidence,
      completedSessions: [firstComplete],
    }),
    2,
  );

  const secondId = "diagnostic-second";
  const secondEvidence = diagnosticEvidence(secondId, "placement-second");
  const secondComplete = completedSummary({
    sessionId: secondId,
    kind: "diagnostic",
    startedAt: 10_000,
    completedAt: 18_000,
    completedAsPlanned: true,
  });
  assert.equal(
    diagnosticSessionNumber({
      ...empty,
      attemptEvents: [...firstEvidence, ...secondEvidence],
      completedSessions: [firstComplete, secondComplete],
    }),
    3,
  );

  const demonstrated = {
    A02: learningState("A02", {
      weightedAccuracy: 1,
      independentAttemptCount: 3,
      correctIndependentAttemptCount: 3,
      recentIndependentResults: [true, true, true],
    }),
    A03: learningState("A03", {
      weightedAccuracy: 1,
      independentAttemptCount: 3,
      correctIndependentAttemptCount: 3,
      recentIndependentResults: [true, true, true],
    }),
  };
  assert.equal(
    diagnosticSessionNumber({
      ...empty,
      attemptEvents: [...firstEvidence, ...secondEvidence],
      completedSessions: [firstComplete, secondComplete],
      skillStates: demonstrated,
    }),
    undefined,
  );
});

test("partial benchmarks do not start the weekly lockout; full benchmarks do", () => {
  const fullAt = 20 * DAY_MS;
  const partial = completedSummary({
    sessionId: "benchmark-partial",
    kind: "benchmark",
    startedAt: fullAt - 1_000,
    completedAt: fullAt,
    completedAsPlanned: false,
  });
  assert.equal(isWeeklyBenchmarkEligible([partial], fullAt), true);
  assert.deepEqual(benchmarkEligibility([partial], [], fullAt), {
    eligible: true,
    nextEligibleAt: null,
    excludedProblemCount: 0,
  });

  const full = { ...partial, sessionId: "benchmark-full", completedAsPlanned: true };
  const partialLater = {
    ...partial,
    sessionId: "benchmark-partial-later",
    startedAt: fullAt + DAY_MS - 1_000,
    completedAt: fullAt + DAY_MS,
  };
  const beforeNext = fullAt + (BENCHMARK_INTERVAL_DAYS - 1) * DAY_MS;
  assert.equal(isWeeklyBenchmarkEligible([full, partialLater], beforeNext), false);
  assert.equal(
    benchmarkEligibility([full, partialLater], [], beforeNext).nextEligibleAt,
    fullAt + BENCHMARK_INTERVAL_DAYS * DAY_MS,
  );
  assert.equal(
    isWeeklyBenchmarkEligible(
      [full, partialLater],
      fullAt + BENCHMARK_INTERVAL_DAYS * DAY_MS,
    ),
    true,
  );
});

test("a persisted background interruption excludes idle time and timing evidence after resume", () => {
  const storage = memoryStorage();
  const sourcePlan = plan({ seed: "resume-interruption", sessionLength: "short" });
  const started = startAdaptiveSession(createAdaptiveSession(sourcePlan), 1_000);
  const backgrounded = backgroundAdaptiveSession(started, 2_000);
  let progress = setActiveAdaptiveSession(
    createEmptyAdaptiveSubtractionProgress(LEARNER_ID, 0),
    backgrounded,
    2_100,
  );
  assert.equal(writeAdaptiveSubtractionProgress(progress, storage), true);

  const hydrated = loadAdaptiveSubtractionProgressDiagnostic(storage).progress;
  assert.equal(hydrated.activeSession?.phase, "paused");
  assert.deepEqual(hydrated.activeSession?.pauseReasons, ["background"]);
  const resumed = foregroundAdaptiveSession(hydrated.activeSession, 8_000);
  assert.equal(resumed.interruptionDurationMs, 6_000);
  assert.equal(resumed.activeElapsedMs, 1_000);
  assert.equal(resumed.shownAt, 1_000);

  const currentCard = resumed.cards[resumed.currentCardIndex];
  const answered = createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId: resumed.id,
    sessionPosition: resumed.currentCardIndex,
    sessionLane: currentCard.lane,
    problem: resumed.currentProblem,
    shownAt: resumed.shownAt,
    firstInkAt: 8_500,
    submittedAt: 9_000,
    answer: resumed.currentProblem.expectedAnswer,
    firstAttemptCorrect: true,
    appWasBackgrounded: true,
    interruptionDurationMs: resumed.interruptionDurationMs,
  });
  assert.equal(answered.responseMs, 8_000);
  assert.equal(answered.interruptionDurationMs, 6_000);
  assert.equal(answered.independent, false);
  assert.equal(answered.timingEligible, false);

  progress = appendAttemptEvent(hydrated, answered);
  assert.equal(progress.attemptEvents.length, 1);
  const advanced = advanceAdaptiveSession(resumed, 9_000);
  assert.equal(advanced.activeElapsedMs, 2_000);
});
