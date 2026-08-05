import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_RECENT_EXCLUSION_DAYS,
  DAY_MS,
  SPACED_REVIEW_INTERVAL_DAYS,
  benchmarkEligibility,
  benchmarkRecentExclusions,
  classifyReviewOutcome,
  completeReviewSchedule,
  createReviewScheduleEntry,
  dueSkillIds,
  freshBenchmarkCandidates,
  isReviewDue,
  isWeeklyBenchmarkEligible,
  refreshReviewScheduleStatus,
  reviewDueAt,
} from "../app/lab/subtraction-flash/adaptive/scheduling.ts";

function reviewAttempt(index, changes = {}) {
  const submittedAt = changes.submittedAt ?? (index + 1) * 1_000;
  const responseMs = changes.responseMs ?? 4_000;
  return {
    id: `attempt-${index}`,
    learnerId: "learner",
    skillId: "F01",
    submittedAt,
    responseMs,
    firstAttemptCorrect: true,
    skipped: false,
    errorCode: null,
    timingEligible: true,
    independent: true,
    workedAnswerVisible: false,
    appWasBackgrounded: false,
    pauseUsed: false,
    hintLevelUsed: 0,
    recognitionConfidence: null,
    recognitionMargin: null,
    recognitionConfirmedByChild: false,
    recognizerCorrection: false,
    interruptionDurationMs: 0,
    ...changes,
  };
}

function completedBenchmark(completedAt, changes = {}) {
  return {
    sessionId: `benchmark-${completedAt}`,
    learnerId: "learner",
    kind: "benchmark",
    startedAt: completedAt - 60_000,
    completedAt,
    activeDurationMs: 60_000,
    attemptedProblemCount: 8,
    independentlyCorrectCount: 8,
    eventuallyCorrectCount: 8,
    focusSkillId: null,
    endedEarlyForFatigue: false,
    completedAsPlanned: true,
    ...changes,
  };
}

test("spaced review uses the 1, 3, 7, 14, and 30 day ladder", () => {
  assert.deepEqual(SPACED_REVIEW_INTERVAL_DAYS, [1, 3, 7, 14, 30]);
  const masteredAt = 100 * DAY_MS;
  const entry = createReviewScheduleEntry({
    id: "review-f01",
    learnerId: "learner",
    skillId: "F01",
    masteredAt,
    sourceSessionId: "session-a",
  });
  assert.equal(entry.intervalIndex, 0);
  assert.equal(entry.dueAt, masteredAt + DAY_MS);
  SPACED_REVIEW_INTERVAL_DAYS.forEach((days, index) => {
    assert.equal(reviewDueAt(masteredAt, index), masteredAt + days * DAY_MS);
  });
});

test("review outcomes extend, modestly shorten, or reset the interval", () => {
  const entry = {
    ...createReviewScheduleEntry({
      id: "review-f01",
      learnerId: "learner",
      skillId: "F01",
      masteredAt: 10 * DAY_MS,
      sourceSessionId: "session-a",
    }),
    intervalIndex: 3,
  };
  const at = 20 * DAY_MS;

  const correct = completeReviewSchedule(entry, "correct_smooth", at, "next-a");
  assert.equal(correct.completed.status, "completed");
  assert.equal(correct.next.intervalIndex, 4);
  assert.equal(correct.next.dueAt, at + 30 * DAY_MS);

  const accurateButDeveloping = completeReviewSchedule(
    entry,
    "correct",
    at,
    "next-developing",
  );
  assert.equal(accurateButDeveloping.next.intervalIndex, 3);
  assert.equal(accurateButDeveloping.next.dueAt, at + 14 * DAY_MS);

  const isolated = completeReviewSchedule(entry, "isolated_miss", at, "next-b");
  assert.equal(isolated.next.intervalIndex, 2);
  assert.equal(isolated.next.dueAt, at + 7 * DAY_MS);

  const confirmed = completeReviewSchedule(
    entry,
    "confirmed_misconception",
    at,
    "next-c",
  );
  assert.equal(confirmed.next.intervalIndex, 0);
  assert.equal(confirmed.next.dueAt, at + DAY_MS);
});

test("review recurrence uses only the five latest comparable prior attempts", () => {
  const ancientMatch = reviewAttempt(0, {
    firstAttemptCorrect: false,
    errorCode: "fact_retrieval_error",
  });
  const fiveRecentCorrect = Array.from({ length: 5 }, (_, index) =>
    reviewAttempt(index + 1),
  );
  const currentMiss = reviewAttempt(6, {
    firstAttemptCorrect: false,
    errorCode: "fact_retrieval_error",
  });

  assert.equal(
    classifyReviewOutcome(currentMiss, [ancientMatch, ...fiveRecentCorrect]),
    "isolated_miss",
  );
  assert.equal(
    classifyReviewOutcome(currentMiss, [
      ...fiveRecentCorrect.slice(1),
      reviewAttempt(7, {
        submittedAt: currentMiss.submittedAt - 1,
        firstAttemptCorrect: false,
        errorCode: "fact_retrieval_error",
      }),
      ancientMatch,
    ]),
    "confirmed_misconception",
  );
});

test("a correct review is smooth only at a comfortable or meaningfully improved pace", () => {
  assert.equal(
    classifyReviewOutcome(reviewAttempt(0, { responseMs: 8_000 }), [], 8_000),
    "correct",
  );
  assert.equal(
    classifyReviewOutcome(reviewAttempt(0, { responseMs: 3_000 }), [], 8_000),
    "correct_smooth",
  );
  assert.equal(
    classifyReviewOutcome(reviewAttempt(0, { responseMs: 4_000 }), [], 5_000),
    "correct_smooth",
  );
  assert.equal(
    classifyReviewOutcome(
      reviewAttempt(1, { responseMs: 4_000 }),
      [reviewAttempt(0, { responseMs: 5_000 })],
    ),
    "correct_smooth",
  );
  assert.equal(
    classifyReviewOutcome(
      reviewAttempt(0, { responseMs: 2_000, timingEligible: false }),
      [],
      5_000,
    ),
    "correct",
  );
});

test("due review status and skill selection are deterministic", () => {
  const now = 50 * DAY_MS;
  const base = createReviewScheduleEntry({
    id: "review-f01",
    learnerId: "learner",
    skillId: "F01",
    masteredAt: now - 2 * DAY_MS,
    sourceSessionId: "session-a",
  });
  const later = {
    ...base,
    id: "review-a03",
    skillId: "A03",
    dueAt: now - 2_000,
  };
  const duplicateSkill = { ...base, id: "review-f01-again", dueAt: now - 1_000 };
  const future = { ...base, id: "review-future", skillId: "R02", dueAt: now + 1 };

  assert.equal(isReviewDue(base, now), true);
  assert.equal(refreshReviewScheduleStatus(base, now).status, "due");
  assert.deepEqual(dueSkillIds([duplicateSkill, future, base, later], now), [
    "F01",
    "A03",
  ]);
});

test("a parent-only benchmark becomes eligible no more than once each seven days", () => {
  const now = 100 * DAY_MS;
  assert.equal(isWeeklyBenchmarkEligible([], now), true);
  assert.equal(
    isWeeklyBenchmarkEligible([completedBenchmark(now - 7 * DAY_MS)], now),
    true,
  );
  assert.equal(
    isWeeklyBenchmarkEligible([completedBenchmark(now - 7 * DAY_MS + 1)], now),
    false,
  );
  assert.equal(
    isWeeklyBenchmarkEligible([
      completedBenchmark(now - 20 * DAY_MS),
      completedBenchmark(now - 2 * DAY_MS, { sessionId: "latest" }),
    ], now),
    false,
  );
  assert.equal(
    isWeeklyBenchmarkEligible(
      [completedBenchmark(now - DAY_MS, { completedAsPlanned: false })],
      now,
    ),
    true,
  );
});

test("benchmark candidates exclude exact IDs and fingerprints seen in the preceding 30 days", () => {
  const now = 100 * DAY_MS;
  const cutoff = now - BENCHMARK_RECENT_EXCLUSION_DAYS * DAY_MS;
  const attempts = [
    {
      problemId: "recent-id",
      problemFingerprint: "recent-fingerprint",
      submittedAt: cutoff,
    },
    {
      problemId: "old-id",
      problemFingerprint: "old-fingerprint",
      submittedAt: cutoff - 1,
    },
  ];
  const exclusions = benchmarkRecentExclusions(attempts, now);
  assert.equal(exclusions.problemIds.has("recent-id"), true);
  assert.equal(exclusions.fingerprints.has("recent-fingerprint"), true);
  assert.equal(exclusions.problemIds.has("old-id"), false);

  assert.deepEqual(
    freshBenchmarkCandidates(
      [
        { id: "recent-id", fingerprint: "fresh-one" },
        { id: "fresh-id", fingerprint: "recent-fingerprint" },
        { id: "old-id", fingerprint: "old-fingerprint" },
      ],
      attempts,
      now,
    ),
    [{ id: "old-id", fingerprint: "old-fingerprint" }],
  );

  assert.deepEqual(benchmarkEligibility([], attempts, now), {
    eligible: true,
    nextEligibleAt: null,
    excludedProblemCount: 1,
  });
});
