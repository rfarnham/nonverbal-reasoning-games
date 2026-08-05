import type {
  AttemptEvent,
  CompletedSessionSummary,
  ReviewScheduleEntry,
  SkillId,
} from "./types.ts";
import {
  DEFAULT_MASTERY_CONFIGURATION,
  isTimingEligible,
} from "./mastery.ts";
import { skillDefinition } from "./skills.ts";

export const DAY_MS = 24 * 60 * 60 * 1_000;
export const SPACED_REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
export const BENCHMARK_INTERVAL_DAYS = 7;
export const BENCHMARK_RECENT_EXCLUSION_DAYS = 30;

export type ReviewOutcome =
  | "correct_smooth"
  | "correct"
  | "isolated_miss"
  | "confirmed_misconception";

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? (ordered[middle] ?? null)
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function comfortableReviewResponseMs(skillId: SkillId): number {
  const skill = skillDefinition(skillId);
  const thresholds = DEFAULT_MASTERY_CONFIGURATION.comfortableThresholds;
  if (skill.kind === "fact") return thresholds.factMs;
  if (skill.kind === "micro_step") return thresholds.microStepMs;
  if (skill.kind === "transfer") return thresholds.transferMs;
  return skill.id === "A02" || skill.tags.includes("no-regrouping")
    ? thresholds.fullNoRegroupingMs
    : thresholds.fullRegroupingMs;
}

/**
 * Classifies one due review from append-only attempt history. A misconception
 * is considered recurrent only when the same error appears among the five
 * latest comparable attempts; an ancient match does not reset review spacing.
 */
export function classifyReviewOutcome(
  event: AttemptEvent,
  priorAttempts: readonly AttemptEvent[],
  recentCorrectMedianResponseMs: number | null = null,
): ReviewOutcome {
  if (event.firstAttemptCorrect) {
    const responseMs = event.responseMs;
    const priorMedianResponseMs =
      recentCorrectMedianResponseMs ??
      median(
        priorAttempts
          .filter(
            (attempt) =>
              attempt.id !== event.id &&
              attempt.learnerId === event.learnerId &&
              attempt.skillId === event.skillId &&
              attempt.submittedAt < event.submittedAt &&
              isTimingEligible(attempt),
          )
          .sort(
            (left, right) =>
              left.submittedAt - right.submittedAt ||
              left.id.localeCompare(right.id),
          )
          .slice(-DEFAULT_MASTERY_CONFIGURATION.fluencySampleWindow)
          .flatMap((attempt) =>
            attempt.responseMs === null ? [] : [attempt.responseMs],
          ),
      );
    const meaningfulImprovement =
      responseMs !== null &&
      priorMedianResponseMs !== null &&
      priorMedianResponseMs > 0 &&
      responseMs <=
        priorMedianResponseMs *
          (1 - DEFAULT_MASTERY_CONFIGURATION.minimumImprovementRatio);
    const comfortablyFast =
      responseMs !== null &&
      responseMs <= comfortableReviewResponseMs(event.skillId);
    return isTimingEligible(event) &&
      (comfortablyFast || meaningfulImprovement)
      ? "correct_smooth"
      : "correct";
  }

  const comparable = priorAttempts
    .filter(
      (attempt) =>
        attempt.id !== event.id &&
        attempt.learnerId === event.learnerId &&
        attempt.skillId === event.skillId &&
        !attempt.skipped &&
        attempt.errorCode !== "recognition_uncertain" &&
        (attempt.submittedAt < event.submittedAt ||
          (attempt.submittedAt === event.submittedAt &&
            attempt.id.localeCompare(event.id) < 0)),
    )
    .sort(
      (left, right) =>
        left.submittedAt - right.submittedAt || left.id.localeCompare(right.id),
    )
    .slice(-5);
  const recurring =
    event.errorCode !== null &&
    comparable.some((attempt) => attempt.errorCode === event.errorCode);
  return recurring ? "confirmed_misconception" : "isolated_miss";
}

export type CreateReviewScheduleInput = Readonly<{
  id: string;
  learnerId: string;
  skillId: SkillId;
  masteredAt: number;
  sourceSessionId: string;
  sourceProblemId?: string | null;
}>;

function checkedTime(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative timestamp.`);
  }
  return value;
}

function intervalIndex(value: number): number {
  return Math.max(
    0,
    Math.min(
      SPACED_REVIEW_INTERVAL_DAYS.length - 1,
      Number.isInteger(value) ? value : 0,
    ),
  );
}

export function reviewDueAt(fromMs: number, index: number): number {
  const from = checkedTime(fromMs, "Review start");
  const days = SPACED_REVIEW_INTERVAL_DAYS[intervalIndex(index)];
  return from + days * DAY_MS;
}

export function createReviewScheduleEntry({
  id,
  learnerId,
  skillId,
  masteredAt,
  sourceSessionId,
  sourceProblemId = null,
}: CreateReviewScheduleInput): ReviewScheduleEntry {
  const scheduledAt = checkedTime(masteredAt, "Mastery time");
  if (!id.trim() || !learnerId.trim() || !sourceSessionId.trim()) {
    throw new Error("A review schedule needs stable learner, session, and entry IDs.");
  }
  return {
    id: id.trim(),
    learnerId: learnerId.trim(),
    skillId,
    intervalIndex: 0,
    dueAt: reviewDueAt(scheduledAt, 0),
    scheduledAt,
    lastReviewedAt: null,
    completedAt: null,
    status: "scheduled",
    sourceSessionId: sourceSessionId.trim(),
    sourceProblemId,
  };
}

export function refreshReviewScheduleStatus(
  entry: ReviewScheduleEntry,
  now = Date.now(),
): ReviewScheduleEntry {
  if (entry.status === "completed") return entry;
  return {
    ...entry,
    status: checkedTime(now, "Current time") >= entry.dueAt ? "due" : "scheduled",
  };
}

export function isReviewDue(
  entry: Pick<ReviewScheduleEntry, "status" | "dueAt">,
  now = Date.now(),
): boolean {
  return entry.status !== "completed" && entry.dueAt <= now;
}

export type CompletedReview = Readonly<{
  completed: ReviewScheduleEntry;
  next: ReviewScheduleEntry;
}>;

/**
 * An isolated miss steps back one interval instead of resetting all progress.
 * Only a confirmed misconception returns the skill to a one-day review.
 */
export function completeReviewSchedule(
  entry: ReviewScheduleEntry,
  outcome: ReviewOutcome,
  reviewedAt: number,
  nextEntryId = `${entry.id}:next:${reviewedAt}`,
): CompletedReview {
  const at = checkedTime(reviewedAt, "Review completion");
  const previous = intervalIndex(entry.intervalIndex);
  const nextIndex =
    outcome === "confirmed_misconception"
      ? 0
      : outcome === "isolated_miss"
        ? Math.max(0, previous - 1)
        : outcome === "correct_smooth"
          ? Math.min(SPACED_REVIEW_INTERVAL_DAYS.length - 1, previous + 1)
          : previous;
  const completed: ReviewScheduleEntry = {
    ...entry,
    lastReviewedAt: at,
    completedAt: at,
    status: "completed",
  };
  return {
    completed,
    next: {
      ...entry,
      id: nextEntryId,
      intervalIndex: nextIndex,
      dueAt: reviewDueAt(at, nextIndex),
      scheduledAt: at,
      lastReviewedAt: at,
      completedAt: null,
      status: "scheduled",
    },
  };
}

export function dueSkillIds(
  schedules: readonly ReviewScheduleEntry[],
  now = Date.now(),
): readonly SkillId[] {
  const due = schedules
    .filter((entry) => isReviewDue(entry, now))
    .sort(
      (left, right) =>
        left.dueAt - right.dueAt || left.skillId.localeCompare(right.skillId),
    );
  return [...new Set(due.map(({ skillId }) => skillId))];
}

export function isWeeklyBenchmarkEligible(
  completedSessions: readonly CompletedSessionSummary[],
  now = Date.now(),
): boolean {
  if (!Number.isFinite(now) || now < 0) return false;
  const latest = completedSessions
    .filter(
      ({ kind, completedAsPlanned }) =>
        kind === "benchmark" && completedAsPlanned,
    )
    .reduce<number | null>(
      (value, session) =>
        value === null ? session.completedAt : Math.max(value, session.completedAt),
      null,
    );
  return latest === null || now - latest >= BENCHMARK_INTERVAL_DAYS * DAY_MS;
}

export type BenchmarkExclusions = Readonly<{
  problemIds: ReadonlySet<string>;
  fingerprints: ReadonlySet<string>;
}>;

function fingerprintOf(event: AttemptEvent): string | null {
  const fingerprint = event.problemFingerprint;
  return typeof fingerprint === "string" && fingerprint.trim()
    ? fingerprint.trim()
    : null;
}

/** Excludes exact problems observed during the preceding 30 days. */
export function benchmarkRecentExclusions(
  attempts: readonly AttemptEvent[],
  now = Date.now(),
  lookbackDays = BENCHMARK_RECENT_EXCLUSION_DAYS,
): BenchmarkExclusions {
  const cutoff = now - Math.max(0, lookbackDays) * DAY_MS;
  const recent = attempts.filter(
    ({ submittedAt }) => submittedAt >= cutoff && submittedAt <= now,
  );
  return {
    problemIds: new Set(recent.map(({ problemId }) => problemId)),
    fingerprints: new Set(
      recent.flatMap((event) => {
        const fingerprint = fingerprintOf(event);
        return fingerprint ? [fingerprint] : [];
      }),
    ),
  };
}

export type BenchmarkCandidate = Readonly<{
  id: string;
  fingerprint?: string;
}>;

export function freshBenchmarkCandidates<T extends BenchmarkCandidate>(
  candidates: readonly T[],
  attempts: readonly AttemptEvent[],
  now = Date.now(),
): readonly T[] {
  const exclusions = benchmarkRecentExclusions(attempts, now);
  return candidates.filter(
    ({ id, fingerprint }) =>
      !exclusions.problemIds.has(id) &&
      (!fingerprint || !exclusions.fingerprints.has(fingerprint)),
  );
}

export type BenchmarkEligibility = Readonly<{
  eligible: boolean;
  nextEligibleAt: number | null;
  excludedProblemCount: number;
}>;

export function benchmarkEligibility(
  completedSessions: readonly CompletedSessionSummary[],
  attempts: readonly AttemptEvent[],
  now = Date.now(),
): BenchmarkEligibility {
  const latest = completedSessions
    .filter(
      ({ kind, completedAsPlanned }) =>
        kind === "benchmark" && completedAsPlanned,
    )
    .reduce<number | null>(
      (value, session) =>
        value === null ? session.completedAt : Math.max(value, session.completedAt),
      null,
    );
  return {
    eligible: isWeeklyBenchmarkEligible(completedSessions, now),
    nextEligibleAt:
      latest === null ? null : latest + BENCHMARK_INTERVAL_DAYS * DAY_MS,
    excludedProblemCount: benchmarkRecentExclusions(attempts, now).problemIds.size,
  };
}
