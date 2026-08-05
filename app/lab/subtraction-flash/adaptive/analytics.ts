import {
  attemptWasEventuallyCorrect,
  recognitionIsReliable,
} from "./attempts.ts";
import { isIndependentEvidence, isTimingEligible } from "./mastery.ts";
import type {
  AttemptEvent,
  CompletedSessionSummary,
  ErrorCode,
  LearnerSkillState,
  RecognitionEvent,
  ReviewScheduleEntry,
  SkillId,
} from "./types.ts";

export type ParentAccuracySummary = Readonly<{
  firstAttemptAccuracy: number | null;
  eventuallyCorrectRate: number | null;
  independentAttemptCount: number;
  assistedAttemptCount: number;
  skippedCount: number;
  hintRate: number;
  correctionRate: number;
}>;

export type ParentSpeedSummary = Readonly<{
  eligibleAttemptCount: number;
  medianResponseMs: number | null;
  baselineMedianResponseMs: number | null;
  recentMedianResponseMs: number | null;
  responseTimeTrendRatio: number | null;
  medianFirstInkLatencyMs: number | null;
  medianWritingDurationMs: number | null;
  responseVariabilityRatio: number | null;
}>;

export type ParentRetentionSummary = Readonly<{
  reviewAttemptCount: number;
  reviewAccuracy: number | null;
  dueSkillCount: number;
}>;

export type ParentFatigueSummary = Readonly<{
  shortenedSessionCount: number;
  recentShortenedSessionCount: number;
  lateSessionSlowdownRatio: number | null;
  fatigueErrorCount: number;
}>;

export type ParentBenchmarkSummary = Readonly<{
  completedSessionCount: number;
  latestCompletedAt: number | null;
  attemptedProblemCount: number;
  firstAttemptAccuracy: number | null;
  activeDurationMs: number | null;
  medianResponseMs: number | null;
  medianFirstInkLatencyMs: number | null;
  medianWritingDurationMs: number | null;
  lateSetSlowdownRatio: number | null;
  errorPatternCounts: Readonly<Partial<Record<ErrorCode, number>>>;
  targetMs: number | null;
  activeDurationVsTargetMs: number | null;
}>;

export type ParentSkillSummary = Readonly<{
  skillId: SkillId;
  conceptStatus: LearnerSkillState["conceptStatus"];
  fluencyStatus: LearnerSkillState["fluencyStatus"];
  weightedAccuracy: number;
  independentAttemptCount: number;
  assistedAttemptCount: number;
  hintRate: number;
  medianResponseMs: number | null;
  medianFirstInkLatencyMs: number | null;
  medianWritingDurationMs: number | null;
  plateau: boolean;
}>;

export type ParentProgressSummary = Readonly<{
  learnerId: string;
  accuracy: ParentAccuracySummary;
  speed: ParentSpeedSummary;
  skills: readonly ParentSkillSummary[];
  errorPatternCounts: Readonly<Partial<Record<ErrorCode, number>>>;
  recognition: Readonly<{
    uncertainCount: number;
    confirmedCount: number;
    correctedCount: number;
  }>;
  retention: ParentRetentionSummary;
  fatigue: ParentFatigueSummary;
  benchmark: ParentBenchmarkSummary;
  plateauSkillIds: readonly SkillId[];
  notes: readonly string[];
}>;

export type ParentProgressInput = Readonly<{
  learnerId: string;
  attempts: readonly AttemptEvent[];
  skillStates: Readonly<Partial<Record<SkillId, LearnerSkillState>>>;
  recognitionEvents?: readonly RecognitionEvent[];
  reviewSchedule?: readonly ReviewScheduleEntry[];
  completedSessions?: readonly CompletedSessionSummary[];
  parentBenchmarkTargetMs?: number | null;
  now?: number;
}>;

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? (ordered[middle] ?? null)
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function variabilityRatio(values: readonly number[]): number | null {
  const center = median(values);
  if (center === null || center <= 0 || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance) / center;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function errorPatternCounts(
  attempts: readonly AttemptEvent[],
): Partial<Record<ErrorCode, number>> {
  const counts: Partial<Record<ErrorCode, number>> = {};
  for (const { errorCode } of attempts) {
    if (errorCode) counts[errorCode] = (counts[errorCode] ?? 0) + 1;
  }
  return counts;
}

function isReviewAttempt(event: AttemptEvent): boolean {
  return (
    event.sessionLane === "review" ||
    event.metadata.templateId.startsWith("review:") ||
    event.metadata.challengeProvider === "spaced-review"
  );
}

function completedReviewAttemptKeys(
  schedules: readonly ReviewScheduleEntry[],
): ReadonlySet<string> {
  return new Set(
    schedules.flatMap((entry) =>
      entry.status === "completed" && entry.completedAt !== null
        ? [`${entry.skillId}:${entry.completedAt}`]
        : [],
    ),
  );
}

function isUsableMathAttempt(event: AttemptEvent): boolean {
  return (
    !event.skipped &&
    event.errorCode !== "recognition_uncertain" &&
    event.normalizedRecognizedValue !== null &&
    (event.recognitionConfidence === null ||
      event.recognitionConfirmedByChild ||
      event.recognizerCorrection ||
      (event.recognitionConfidence >= 0.52 &&
        (event.recognitionMargin === null || event.recognitionMargin >= 0.1)))
  );
}

function isParentIndependentAttempt(event: AttemptEvent): boolean {
  return event.hintLevelUsed === 0 && isIndependentEvidence(event);
}

function sessionSlowdownRatio(
  attempts: readonly AttemptEvent[],
  eligibleAttempt: (attempt: AttemptEvent) => boolean = isTimingEligible,
): number | null {
  const bySession = new Map<string, AttemptEvent[]>();
  for (const event of attempts.filter(eligibleAttempt)) {
    const events = bySession.get(event.sessionId) ?? [];
    events.push(event);
    bySession.set(event.sessionId, events);
  }
  const ratios: number[] = [];
  for (const events of bySession.values()) {
    const ordered = [...events].sort(
      (left, right) => left.sessionPosition - right.sessionPosition,
    );
    if (ordered.length < 6) continue;
    const first = median(
      ordered.slice(0, 3).flatMap(({ responseMs }) =>
        responseMs === null ? [] : [responseMs],
      ),
    );
    const last = median(
      ordered.slice(-3).flatMap(({ responseMs }) =>
        responseMs === null ? [] : [responseMs],
      ),
    );
    if (first !== null && first > 0 && last !== null) ratios.push(last / first);
  }
  return median(ratios);
}

function speedSummary(
  attempts: readonly AttemptEvent[],
  eligibleAttempt: (attempt: AttemptEvent) => boolean = isTimingEligible,
): ParentSpeedSummary {
  const eligible = attempts.filter(eligibleAttempt);
  const responseTimes = eligible.flatMap(({ responseMs }) =>
    responseMs === null ? [] : [responseMs],
  );
  const firstInk = eligible.flatMap(({ firstInkLatencyMs }) =>
    firstInkLatencyMs === null ? [] : [firstInkLatencyMs],
  );
  const writing = eligible.flatMap(({ writingDurationMs }) =>
    writingDurationMs === null ? [] : [writingDurationMs],
  );
  const windowSize = Math.min(7, Math.max(1, responseTimes.length));
  const baseline = median(responseTimes.slice(0, windowSize));
  const recent = median(responseTimes.slice(-windowSize));
  return {
    eligibleAttemptCount: eligible.length,
    medianResponseMs: median(responseTimes),
    baselineMedianResponseMs: baseline,
    recentMedianResponseMs: recent,
    responseTimeTrendRatio:
      baseline === null || baseline === 0 || recent === null
        ? null
        : (baseline - recent) / baseline,
    medianFirstInkLatencyMs: median(firstInk),
    medianWritingDurationMs: median(writing),
    responseVariabilityRatio: variabilityRatio(responseTimes.slice(-windowSize)),
  };
}

/** Benchmark pacing includes trustworthy wrong answers as well as correct ones. */
function isBenchmarkTimingEligible(event: AttemptEvent): boolean {
  return (
    !event.skipped &&
    event.responseMs !== null &&
    event.normalizedRecognizedValue !== null &&
    recognitionIsReliable(
      event.recognitionConfidence,
      event.recognitionMargin,
    ) &&
    !event.recognitionConfirmedByChild &&
    !event.recognizerCorrection &&
    event.hintLevelUsed === 0 &&
    !event.workedAnswerVisible &&
    !event.pauseUsed &&
    !event.appWasBackgrounded &&
    event.interruptionDurationMs === 0
  );
}

function benchmarkSummary(
  sessions: readonly CompletedSessionSummary[],
  attempts: readonly AttemptEvent[],
  targetMs: number | null,
): ParentBenchmarkSummary {
  const benchmarkSessions = sessions
    .filter(
      ({ kind, completedAsPlanned }) =>
        kind === "benchmark" && completedAsPlanned,
    )
    .sort(
      (left, right) =>
        left.completedAt - right.completedAt ||
        left.sessionId.localeCompare(right.sessionId),
    );
  const latest = benchmarkSessions.at(-1);
  if (!latest) {
    return {
      completedSessionCount: 0,
      latestCompletedAt: null,
      attemptedProblemCount: 0,
      firstAttemptAccuracy: null,
      activeDurationMs: null,
      medianResponseMs: null,
      medianFirstInkLatencyMs: null,
      medianWritingDurationMs: null,
      lateSetSlowdownRatio: null,
      errorPatternCounts: {},
      targetMs,
      activeDurationVsTargetMs: null,
    };
  }

  const latestAttempts = attempts.filter(
    ({ sessionId }) => sessionId === latest.sessionId,
  );
  const latestMathAttempts = latestAttempts.filter(isUsableMathAttempt);
  const latestSpeed = speedSummary(
    latestAttempts,
    isBenchmarkTimingEligible,
  );
  return {
    completedSessionCount: benchmarkSessions.length,
    latestCompletedAt: latest.completedAt,
    attemptedProblemCount:
      latestMathAttempts.length || latest.attemptedProblemCount,
    firstAttemptAccuracy:
      latestMathAttempts.length > 0
        ? ratio(
            latestMathAttempts.filter(({ firstAttemptCorrect }) =>
              firstAttemptCorrect,
            ).length,
            latestMathAttempts.length,
          )
        : ratio(
            latest.independentlyCorrectCount,
            latest.attemptedProblemCount,
          ),
    activeDurationMs: latest.activeDurationMs,
    medianResponseMs: latestSpeed.medianResponseMs,
    medianFirstInkLatencyMs: latestSpeed.medianFirstInkLatencyMs,
    medianWritingDurationMs: latestSpeed.medianWritingDurationMs,
    lateSetSlowdownRatio: sessionSlowdownRatio(
      latestAttempts,
      isBenchmarkTimingEligible,
    ),
    errorPatternCounts: errorPatternCounts(latestAttempts),
    targetMs,
    activeDurationVsTargetMs:
      targetMs === null ? null : latest.activeDurationMs - targetMs,
  };
}

function skillSummaries(
  attempts: readonly AttemptEvent[],
  states: ParentProgressInput["skillStates"],
): ParentSkillSummary[] {
  return Object.values(states)
    .filter((state): state is LearnerSkillState => state !== undefined)
    .sort((left, right) => left.skillId.localeCompare(right.skillId))
    .map((state) => {
      const skillAttempts = attempts.filter(
        (attempt) =>
          attempt.skillId === state.skillId && isUsableMathAttempt(attempt),
      );
      const eligible = skillAttempts.filter((attempt) =>
        isTimingEligible(attempt),
      );
      const independent = skillAttempts.filter((attempt) =>
        isParentIndependentAttempt(attempt),
      ).length;
      return {
        skillId: state.skillId,
        conceptStatus: state.conceptStatus,
        fluencyStatus: state.fluencyStatus,
        weightedAccuracy: state.weightedAccuracy,
        independentAttemptCount: independent,
        assistedAttemptCount: skillAttempts.length - independent,
        hintRate: state.hintRate,
        medianResponseMs:
          state.recentCorrectMedianResponseMs ??
          median(
            eligible.flatMap(({ responseMs }) =>
              responseMs === null ? [] : [responseMs],
            ),
          ),
        medianFirstInkLatencyMs:
          state.recentMedianFirstInkLatencyMs ??
          median(
            eligible.flatMap(({ firstInkLatencyMs }) =>
              firstInkLatencyMs === null ? [] : [firstInkLatencyMs],
            ),
          ),
        medianWritingDurationMs:
          state.recentMedianWritingDurationMs ??
          median(
            eligible.flatMap(({ writingDurationMs }) =>
              writingDurationMs === null ? [] : [writingDurationMs],
            ),
          ),
        plateau:
          state.fluencyStatus === "plateau" || state.plateauExposureCount > 0,
      };
    });
}

function summaryNotes(
  skills: readonly ParentSkillSummary[],
  errors: Readonly<Partial<Record<ErrorCode, number>>>,
  fatigue: ParentFatigueSummary,
): string[] {
  const notes: string[] = [];
  const masteredButDeveloping = skills.filter(
    ({ conceptStatus, fluencyStatus }) =>
      conceptStatus === "mastered" && fluencyStatus === "developing",
  );
  if (masteredButDeveloping.length) {
    notes.push(
      "The concept is mastered. It remains in brief, spaced fluency review.",
    );
  }
  const plateau = skills.filter(({ plateau: value }) => value);
  if (plateau.length) {
    notes.push(
      "Additional identical practice has not improved timing; plateau skills have moved to spaced maintenance.",
    );
  }
  const microSkills = skills.filter(({ skillId }) => skillId.startsWith("R"));
  const microSkillsSecure =
    microSkills.length > 0 &&
    microSkills
    .every(({ conceptStatus }) => conceptStatus === "mastered");
  if (microSkillsSecure && (errors.execution_slip ?? 0) > 0) {
    notes.push(
      "Regrouping micro-steps are secure; remaining misses look like isolated full-problem execution slips.",
    );
  }
  if (
    fatigue.recentShortenedSessionCount >= 2 ||
    (fatigue.lateSessionSlowdownRatio ?? 0) >= 1.6
  ) {
    notes.push(
      "Performance declines later in sessions. A shorter next session is recommended.",
    );
  }
  return notes;
}

export function buildParentProgressSummary({
  learnerId,
  attempts,
  skillStates,
  recognitionEvents = [],
  reviewSchedule = [],
  completedSessions = [],
  parentBenchmarkTargetMs = null,
  now = Date.now(),
}: ParentProgressInput): ParentProgressSummary {
  const learnerAttempts = attempts.filter(
    (attempt) => attempt.learnerId === learnerId,
  );
  const mathAttempts = learnerAttempts.filter(isUsableMathAttempt);
  const independent = mathAttempts.filter((attempt) =>
    isParentIndependentAttempt(attempt),
  );
  const assistedCount = mathAttempts.length - independent.length;
  const reviewKeys = completedReviewAttemptKeys(reviewSchedule);
  const reviews = mathAttempts.filter(
    (attempt) =>
      isReviewAttempt(attempt) ||
      reviewKeys.has(`${attempt.skillId}:${attempt.submittedAt}`),
  );
  const errors = errorPatternCounts(learnerAttempts);
  const learnerRecognition = recognitionEvents.filter(
    (event) => event.learnerId === learnerId,
  );
  const learnerSessions = completedSessions
    .filter((session) => session.learnerId === learnerId)
    .sort((left, right) => left.completedAt - right.completedAt);
  const shortened = learnerSessions.filter(
    ({ endedEarlyForFatigue }) => endedEarlyForFatigue,
  );
  const recentSessions = learnerSessions.slice(-3);
  const fatigue: ParentFatigueSummary = {
    shortenedSessionCount: shortened.length,
    recentShortenedSessionCount: recentSessions.filter(
      ({ endedEarlyForFatigue }) => endedEarlyForFatigue,
    ).length,
    lateSessionSlowdownRatio: sessionSlowdownRatio(learnerAttempts),
    fatigueErrorCount: errors.fatigue_related_error ?? 0,
  };
  const skills = skillSummaries(learnerAttempts, skillStates);
  const plateauSkillIds = skills
    .filter(({ plateau }) => plateau)
    .map(({ skillId }) => skillId);
  const dueSkillCount = new Set(
    reviewSchedule
      .filter(
        (entry) =>
          entry.learnerId === learnerId &&
          entry.status !== "completed" &&
          entry.dueAt <= now,
      )
      .map(({ skillId }) => skillId),
  ).size;

  return {
    learnerId,
    accuracy: {
      firstAttemptAccuracy: ratio(
        mathAttempts.filter(({ firstAttemptCorrect }) => firstAttemptCorrect)
          .length,
        mathAttempts.length,
      ),
      eventuallyCorrectRate: ratio(
        mathAttempts.filter(
          (attempt) =>
            attemptWasEventuallyCorrect(attempt, mathAttempts),
        ).length,
        mathAttempts.length,
      ),
      independentAttemptCount: independent.length,
      assistedAttemptCount: assistedCount,
      skippedCount: learnerAttempts.filter(({ skipped }) => skipped).length,
      hintRate: ratio(
        mathAttempts.filter(({ hintLevelUsed }) => hintLevelUsed > 0).length,
        mathAttempts.length,
      ) ?? 0,
      correctionRate: ratio(
        mathAttempts.filter(({ correctionCount }) => correctionCount > 0).length,
        mathAttempts.length,
      ) ?? 0,
    },
    speed: speedSummary(learnerAttempts),
    skills,
    errorPatternCounts: errors,
    recognition: {
      uncertainCount: learnerRecognition.filter(
        ({ kind }) => kind === "recognition_uncertain",
      ).length,
      confirmedCount: learnerRecognition.filter(
        ({ kind }) => kind === "recognition_confirmed",
      ).length,
      correctedCount: learnerRecognition.filter(
        ({ kind }) => kind === "recognition_corrected",
      ).length,
    },
    retention: {
      reviewAttemptCount: reviews.length,
      reviewAccuracy: ratio(
        reviews.filter(({ firstAttemptCorrect }) => firstAttemptCorrect).length,
        reviews.length,
      ),
      dueSkillCount,
    },
    fatigue,
    benchmark: benchmarkSummary(
      learnerSessions,
      learnerAttempts,
      parentBenchmarkTargetMs,
    ),
    plateauSkillIds,
    notes: summaryNotes(skills, errors, fatigue),
  };
}
