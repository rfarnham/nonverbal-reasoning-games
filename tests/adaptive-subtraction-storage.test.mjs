import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTIVE_SUBTRACTION_CONTENT_VERSION,
  ADAPTIVE_SUBTRACTION_SCHEMA_VERSION,
  ADAPTIVE_SUBTRACTION_STORAGE_KEY,
  appendAttemptEvent,
  appendCompletedSessionSummary,
  appendRecognitionEvent,
  createEmptyAdaptiveSubtractionProgress,
  decodeAdaptiveSubtractionProgressDiagnostic,
  loadAdaptiveSubtractionProgressDiagnostic,
  readAdaptiveSubtractionProgress,
  removeAdaptiveSubtractionProgress,
  replaceSkillStateCache,
  setActiveAdaptiveSession,
  updateAdaptiveSettings,
  upsertReviewScheduleEntry,
  writeAdaptiveSubtractionProgress,
} from "../app/lab/subtraction-flash/adaptive-storage.ts";
import {
  createAttemptEvent,
  createRecognitionEvent,
} from "../app/lab/subtraction-flash/adaptive/attempts.ts";
import { deriveLearnerSkillState } from "../app/lab/subtraction-flash/adaptive/mastery.ts";
import { generateProblem } from "../app/lab/subtraction-flash/adaptive/problems.ts";
import { createReviewScheduleEntry } from "../app/lab/subtraction-flash/adaptive/scheduling.ts";
import {
  backgroundAdaptiveSession,
  createAdaptiveSession,
  startAdaptiveSession,
} from "../app/lab/subtraction-flash/adaptive/session.ts";
import { SKILLS_BY_ID } from "../app/lab/subtraction-flash/adaptive/skills.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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
    values,
  };
}

function fixture() {
  const problem = generateProblem({ skillId: "F01", seed: "storage-problem" });
  const attempt = createAttemptEvent({
    learnerId: "learner",
    sessionId: "session-a",
    sessionPosition: 0,
    sessionLane: "review",
    relatedProblemId: "earlier-problem",
    relatedProblemRelation: "remediation_probe",
    problem,
    shownAt: 1_000,
    firstInkAt: 1_500,
    submittedAt: 3_500,
    answer: problem.expectedAnswer,
    rawRecognizedValue: String(problem.expectedAnswer),
    recognitionConfidence: 0.94,
    recognitionMargin: 0.41,
    firstAttemptCorrect: true,
  });
  const recognition = createRecognitionEvent({
    kind: "recognition_confirmed",
    learnerId: "learner",
    sessionId: "session-a",
    problemId: problem.id,
    occurredAt: 3_400,
    rawRecognizedValue: String(problem.expectedAnswer),
    normalizedRecognizedValue: problem.expectedAnswer,
    recognitionConfidence: 0.4,
    recognitionMargin: 0.02,
    confirmedByChild: true,
  });
  const card = {
    id: "card-a",
    lane: "warmup",
    reason: "Resume fixture",
    problem,
    skillId: "F01",
    status: "planned",
    remediationForProblemId: null,
    delayedRetryForProblemId: null,
  };
  const session = backgroundAdaptiveSession(
    startAdaptiveSession(
      createAdaptiveSession({
        id: "session-a",
        learnerId: "learner",
        kind: "practice",
        seed: "storage-session",
        createdAt: 500,
        targetCardCount: 1,
        maxActiveDurationMs: 60_000,
        focusSkillId: "F01",
        cards: [card],
      }),
      1_000,
    ),
    4_000,
  );
  const skillState = deriveLearnerSkillState(SKILLS_BY_ID.F01, [attempt]);
  const review = createReviewScheduleEntry({
    id: "review-f01",
    learnerId: "learner",
    skillId: "F01",
    masteredAt: 5_000,
    sourceSessionId: "session-a",
    sourceProblemId: problem.id,
  });
  const completed = {
    sessionId: "session-complete",
    learnerId: "learner",
    kind: "practice",
    startedAt: 1_000,
    completedAt: 6_000,
    activeDurationMs: 5_000,
    attemptedProblemCount: 1,
    independentlyCorrectCount: 1,
    eventuallyCorrectCount: 1,
    focusSkillId: "F01",
    endedEarlyForFatigue: false,
    completedAsPlanned: true,
  };
  return { attempt, recognition, review, session, skillState, completed };
}

test("empty, unavailable, and corrupt storage load without crashing", () => {
  const empty = loadAdaptiveSubtractionProgressDiagnostic(memoryStorage());
  assert.equal(empty.status, "empty");
  assert.equal(empty.progress.schemaVersion, ADAPTIVE_SUBTRACTION_SCHEMA_VERSION);
  assert.equal(empty.progress.settings.parentBenchmarkTargetMs, null);

  const unavailable = loadAdaptiveSubtractionProgressDiagnostic({
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  });
  assert.equal(unavailable.status, "unavailable");

  assert.equal(
    decodeAdaptiveSubtractionProgressDiagnostic("not-json").status,
    "corrupt",
  );
  assert.equal(
    decodeAdaptiveSubtractionProgressDiagnostic(
      JSON.stringify({ schemaVersion: ADAPTIVE_SUBTRACTION_SCHEMA_VERSION + 1 }),
    ).status,
    "unsupported",
  );
});

test("attempts, recognition diagnostics, derived state, review, settings, and a paused session round-trip", () => {
  const data = fixture();
  let progress = createEmptyAdaptiveSubtractionProgress("learner", 0);
  progress = appendAttemptEvent(progress, data.attempt);
  progress = appendRecognitionEvent(progress, data.recognition);
  progress = replaceSkillStateCache(progress, { F01: data.skillState }, 6_000);
  progress = upsertReviewScheduleEntry(progress, data.review, 7_000);
  progress = setActiveAdaptiveSession(progress, data.session, 8_000);
  progress = updateAdaptiveSettings(
    progress,
    { targetCardCount: 9, parentBenchmarkTargetMs: 75_000 },
    9_000,
  );

  const storage = memoryStorage();
  assert.equal(writeAdaptiveSubtractionProgress(progress, storage), true);
  const result = loadAdaptiveSubtractionProgressDiagnostic(storage);
  assert.equal(result.status, "loaded");
  assert.deepEqual(result.progress, progress);
  assert.equal(result.progress.attemptEvents[0].problemSeed, data.attempt.problemSeed);
  assert.equal(result.progress.attemptEvents[0].sessionLane, "review");
  assert.equal(
    result.progress.attemptEvents[0].relatedProblemId,
    "earlier-problem",
  );
  assert.equal(
    result.progress.attemptEvents[0].relatedProblemRelation,
    "remediation_probe",
  );
  assert.equal(result.progress.recognitionEvents[0].recognitionConfidence, 0.4);
  assert.equal(result.progress.reviewSchedule[0].dueAt, data.review.dueAt);
  assert.equal(result.progress.activeSession?.createdAt, 500);
  assert.equal(result.progress.activeSession?.focusSkillId, "F01");
  assert.deepEqual(result.progress.activeSession?.pauseReasons, ["background"]);
  assert.equal(result.progress.activeSession?.phaseBeforePause, "warmup");
  assert.equal(result.progress.activeSession?.backgroundedAt, 4_000);
  assert.equal(result.progress.settings.parentBenchmarkTargetMs, 75_000);
  assert.deepEqual(readAdaptiveSubtractionProgress(storage), progress);
});

test("append-only event and completed-session APIs are idempotent and reject conflicting IDs", () => {
  const data = fixture();
  let progress = createEmptyAdaptiveSubtractionProgress("learner");
  progress = appendAttemptEvent(progress, data.attempt);
  assert.equal(appendAttemptEvent(progress, data.attempt).attemptEvents.length, 1);
  assert.throws(
    () =>
      appendAttemptEvent(progress, {
        ...data.attempt,
        correctionCount: data.attempt.correctionCount + 1,
      }),
    /already belongs to different data/,
  );

  progress = appendRecognitionEvent(progress, data.recognition);
  assert.equal(
    appendRecognitionEvent(progress, data.recognition).recognitionEvents.length,
    1,
  );
  assert.throws(
    () =>
      appendRecognitionEvent(progress, {
        ...data.recognition,
        confirmedByChild: false,
      }),
    /already belongs to different data/,
  );

  progress = setActiveAdaptiveSession(progress, data.session);
  progress = appendCompletedSessionSummary(progress, data.completed);
  assert.equal(progress.activeSession?.id, "session-a");
  assert.equal(
    appendCompletedSessionSummary(progress, data.completed).completedSessions
      .length,
    1,
  );
  assert.throws(
    () =>
      appendCompletedSessionSummary(progress, {
        ...data.completed,
        independentlyCorrectCount: 0,
      }),
    /cannot be rewritten/,
  );
});

test("completing the active session clears only that resumable snapshot", () => {
  const data = fixture();
  let progress = createEmptyAdaptiveSubtractionProgress("learner");
  const matchingSummary = {
    ...data.completed,
    sessionId: data.session.id,
  };
  progress = setActiveAdaptiveSession(progress, data.session);
  progress = appendCompletedSessionSummary(progress, matchingSummary);
  assert.equal(progress.activeSession, null);
});

test("compatible settings/session shapes and content changes migrate safely", () => {
  const data = fixture();
  let progress = appendAttemptEvent(
    createEmptyAdaptiveSubtractionProgress("learner"),
    data.attempt,
  );
  progress = setActiveAdaptiveSession(progress, data.session);
  const legacyShape = JSON.parse(JSON.stringify(progress));
  delete legacyShape.settings.parentBenchmarkTargetMs;
  for (const event of legacyShape.attemptEvents) {
    delete event.relatedProblemRelation;
    delete event.problem;
  }
  legacyShape.attemptEvents.push({
    ...legacyShape.attemptEvents[0],
    id: "legacy-remediation-probe",
    diagnosticProbeResult: {
      probeId: legacyShape.attemptEvents[0].relatedProblemId,
      outcome: "pass",
      expectedProbeCount: 1,
    },
  });
  delete legacyShape.activeSession.activeSince;
  delete legacyShape.activeSession.pauseReasons;
  delete legacyShape.activeSession.phaseBeforePause;
  delete legacyShape.activeSession.backgroundedAt;
  legacyShape.completedSessions = [data.completed];
  delete legacyShape.completedSessions[0].completedAsPlanned;
  const migratedShape = decodeAdaptiveSubtractionProgressDiagnostic(
    JSON.stringify(legacyShape),
  );
  assert.equal(migratedShape.status, "migrated");
  assert.equal(migratedShape.progress.settings.parentBenchmarkTargetMs, null);
  assert.equal(
    migratedShape.progress.completedSessions[0]?.completedAsPlanned,
    true,
  );
  assert.equal(
    migratedShape.progress.attemptEvents[0]?.relatedProblemRelation,
    "delayed_retry",
  );
  assert.equal(
    migratedShape.progress.attemptEvents[1]?.relatedProblemRelation,
    "remediation_probe",
  );
  assert.equal(migratedShape.progress.attemptEvents[0]?.problem, null);
  assert.deepEqual(migratedShape.progress.activeSession?.pauseReasons, [
    "background",
  ]);

  progress = { ...progress, contentVersion: "older-content" };
  const migratedContent = decodeAdaptiveSubtractionProgressDiagnostic(
    JSON.stringify(progress),
  );
  assert.equal(migratedContent.status, "migrated");
  assert.equal(
    migratedContent.progress.contentVersion,
    ADAPTIVE_SUBTRACTION_CONTENT_VERSION,
  );
  assert.equal(migratedContent.progress.activeSession, null);
});

test("invalid metadata, invalid runtime state, settings, and quota failures are rejected", () => {
  const data = fixture();
  const progress = createEmptyAdaptiveSubtractionProgress("learner");
  assert.throws(
    () =>
      appendAttemptEvent(progress, {
        ...data.attempt,
        metadata: { ...data.attempt.metadata, renameQuestion: "anything" },
      }),
    /Invalid learner attempt event/,
  );
  assert.throws(
    () =>
      setActiveAdaptiveSession(progress, {
        ...data.session,
        pauseReasons: ["not-a-reason"],
      }),
    /Invalid active adaptive session/,
  );
  assert.throws(
    () => updateAdaptiveSettings(progress, { parentBenchmarkTargetMs: 0 }),
    /Invalid adaptive settings/,
  );

  const quotaStorage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {},
  };
  assert.equal(writeAdaptiveSubtractionProgress(progress, quotaStorage), false);

  const storage = memoryStorage({
    [ADAPTIVE_SUBTRACTION_STORAGE_KEY]: JSON.stringify(progress),
  });
  assert.equal(removeAdaptiveSubtractionProgress(storage), true);
  assert.equal(storage.getItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY), null);
});

test("semantically impossible attempts cannot contaminate mastery or timing", () => {
  const data = fixture();
  const progress = createEmptyAdaptiveSubtractionProgress("learner");
  const wrongAnswer =
    typeof data.attempt.expectedAnswer === "number"
      ? data.attempt.expectedAnswer + 1
      : data.attempt.expectedAnswer === "yes"
        ? "no"
        : "yes";
  for (const invalid of [
    { ...data.attempt, normalizedRecognizedValue: wrongAnswer },
    { ...data.attempt, appWasBackgrounded: true },
    { ...data.attempt, pauseUsed: true },
    { ...data.attempt, skipped: true },
    { ...data.attempt, errorCode: "fact_retrieval_error" },
  ]) {
    assert.throws(
      () => appendAttemptEvent(progress, invalid),
      /Invalid learner attempt event/,
    );
  }
});

test("semantically impossible resumable sessions recover as invalid", () => {
  const data = fixture();
  const progress = createEmptyAdaptiveSubtractionProgress("learner");
  const otherProblem = generateProblem({
    skillId: "F01",
    seed: "other-session-problem",
  });
  const otherCard = {
    ...data.session.cards[0],
    id: "card-b",
    problem: otherProblem,
    skillId: otherProblem.skillId,
    status: "active",
  };
  const impossible = [
    { ...data.session, currentCardIndex: data.session.cards.length },
    { ...data.session, currentProblem: otherProblem },
    {
      ...data.session,
      cards: [...data.session.cards, otherCard],
      targetCardCount: 2,
    },
    { ...data.session, targetCardCount: 2 },
    {
      ...data.session,
      cards: data.session.cards.map((card) => ({ ...card, status: "planned" })),
    },
  ];
  for (const session of impossible) {
    assert.throws(
      () => setActiveAdaptiveSession(progress, session),
      /Invalid active adaptive session/,
    );
  }
});
