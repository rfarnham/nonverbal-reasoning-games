import type {
  AttemptEvent,
  ErrorCode,
  LearnerSkillState,
  MasteryPolicy,
  SkillDefinition,
  SkillId,
} from "./types.ts";

export type FluencyThresholds = Readonly<{
  factMs: number;
  microStepMs: number;
  fullNoRegroupingMs: number;
  fullRegroupingMs: number;
  transferMs: number;
}>;

export type MasteryConfiguration = Readonly<{
  recencyDecay: number;
  reliableRecognitionConfidence: number;
  reliableRecognitionMargin: number;
  maximumIndependentInterruptionMs: number;
  maximumPlausibleResponseMs: number;
  answerRevealingHintLevel: number;
  minimumFluencySamples: number;
  fluencySampleWindow: number;
  minimumImprovementRatio: number;
  maximumVariabilityRatio: number;
  plateauMinimumCorrectExposures: number;
  plateauMinimumSessions: number;
  plateauMaximumImprovementRatio: number;
  spacedReviewMinimumAttempts: number;
  spacedReviewReactivationAccuracy: number;
  comfortableThresholds: FluencyThresholds;
}>;

export const DEFAULT_MASTERY_CONFIGURATION: MasteryConfiguration = {
  recencyDecay: 0.85,
  reliableRecognitionConfidence: 0.52,
  reliableRecognitionMargin: 0.1,
  maximumIndependentInterruptionMs: 5_000,
  maximumPlausibleResponseMs: 10 * 60 * 1_000,
  answerRevealingHintLevel: 3,
  minimumFluencySamples: 3,
  fluencySampleWindow: 7,
  minimumImprovementRatio: 0.15,
  maximumVariabilityRatio: 0.45,
  plateauMinimumCorrectExposures: 22,
  plateauMinimumSessions: 4,
  plateauMaximumImprovementRatio: 0.05,
  spacedReviewMinimumAttempts: 3,
  spacedReviewReactivationAccuracy: 0.67,
  comfortableThresholds: {
    factMs: 3_000,
    microStepMs: 5_000,
    fullNoRegroupingMs: 12_000,
    fullRegroupingMs: 20_000,
    transferMs: 20_000,
  },
};

export type SkillReductionOptions = Readonly<{
  previousState?: LearnerSkillState;
  unlocked?: boolean;
  now?: number;
  configuration?: Partial<MasteryConfiguration>;
  comfortableResponseMs?: number;
}>;

function configurationWith(
  changes: Partial<MasteryConfiguration> | undefined,
): MasteryConfiguration {
  return {
    ...DEFAULT_MASTERY_CONFIGURATION,
    ...changes,
    comfortableThresholds: {
      ...DEFAULT_MASTERY_CONFIGURATION.comfortableThresholds,
      ...changes?.comfortableThresholds,
    },
  };
}

/**
 * Concept evidence can include a low-confidence result only after the child
 * confirms it. Timing remains stricter and is handled separately below.
 */
export function isIndependentEvidence(
  event: AttemptEvent,
  changes?: Partial<MasteryConfiguration>,
): boolean {
  const configuration = configurationWith(changes);
  const recognitionReliable =
    event.recognitionConfidence === null ||
    (event.recognitionConfidence >=
      configuration.reliableRecognitionConfidence &&
      (event.recognitionMargin === null ||
        event.recognitionMargin >= configuration.reliableRecognitionMargin)) ||
    event.recognitionConfirmedByChild;
  return (
    event.independent &&
    !event.skipped &&
    event.errorCode !== "recognition_uncertain" &&
    !event.workedAnswerVisible &&
    !event.appWasBackgrounded &&
    !event.pauseUsed &&
    event.hintLevelUsed < configuration.answerRevealingHintLevel &&
    recognitionReliable
  );
}

/**
 * Correct learning evidence is not automatically trustworthy fluency data.
 * Backgrounding, pauses/corrections (encoded by timingEligible), uncertain
 * recognition, revealing hints, and implausible durations are excluded only
 * from timing statistics.
 */
export function isTimingEligible(
  event: AttemptEvent,
  changes?: Partial<MasteryConfiguration>,
): boolean {
  const configuration = configurationWith(changes);
  return (
    event.timingEligible &&
    isIndependentEvidence(event, configuration) &&
    event.firstAttemptCorrect &&
    event.responseMs !== null &&
    Number.isFinite(event.responseMs) &&
    event.responseMs >= 0 &&
    event.responseMs <= configuration.maximumPlausibleResponseMs &&
    !event.appWasBackgrounded &&
    event.interruptionDurationMs === 0 &&
    !event.pauseUsed &&
    !event.recognizerCorrection &&
    (event.recognitionConfidence === null ||
      (event.recognitionConfidence >=
        configuration.reliableRecognitionConfidence &&
        (event.recognitionMargin === null ||
          event.recognitionMargin >= configuration.reliableRecognitionMargin)))
  );
}

function isUsableMathAttempt(
  event: AttemptEvent,
  configuration: MasteryConfiguration,
): boolean {
  const recognitionUsable =
    event.recognitionConfidence === null ||
    (event.recognitionConfidence >=
      configuration.reliableRecognitionConfidence &&
      (event.recognitionMargin === null ||
        event.recognitionMargin >= configuration.reliableRecognitionMargin)) ||
    event.recognitionConfirmedByChild ||
    event.recognizerCorrection;
  return (
    !event.skipped &&
    event.errorCode !== "recognition_uncertain" &&
    event.normalizedRecognizedValue !== null &&
    recognitionUsable
  );
}

function chronological(events: readonly AttemptEvent[]): AttemptEvent[] {
  return [...events].sort(
    (left, right) =>
      left.submittedAt - right.submittedAt ||
      left.sessionId.localeCompare(right.sessionId) ||
      left.id.localeCompare(right.id),
  );
}

function confirmedExecutionSlipProblemIds(
  attempts: readonly AttemptEvent[],
): ReadonlySet<string> {
  const probes = new Map<string, AttemptEvent[]>();
  for (const event of chronological(attempts)) {
    const target = event.relatedProblemId;
    const result = event.diagnosticProbeResult;
    if (
      !target ||
      event.relatedProblemRelation !== "remediation_probe" ||
      !result ||
      result.probeId !== target
    ) continue;
    const group = probes.get(target) ?? [];
    group.push(event);
    probes.set(target, group);
  }
  const resolved = new Set<string>();
  for (const [problemId, group] of probes) {
    const expected = Math.max(
      1,
      ...group.map(
        ({ diagnosticProbeResult }) =>
          diagnosticProbeResult?.expectedProbeCount ?? 1,
      ),
    );
    if (
      group.length >= expected &&
      group.slice(0, expected).every(
        ({ diagnosticProbeResult }) =>
          diagnosticProbeResult?.outcome === "pass",
      )
    ) {
      resolved.add(problemId);
    }
  }
  return resolved;
}

export function recencyWeightedAccuracy(
  events: readonly AttemptEvent[],
  decay = DEFAULT_MASTERY_CONFIGURATION.recencyDecay,
): number {
  if (!events.length) return 0;
  const safeDecay =
    Number.isFinite(decay) && decay > 0 && decay <= 1 ? decay : 0.85;
  const ordered = chronological(events);
  let correctWeight = 0;
  let totalWeight = 0;
  ordered.forEach((event, index) => {
    const weight = safeDecay ** (ordered.length - index - 1);
    totalWeight += weight;
    if (event.firstAttemptCorrect) correctWeight += weight;
  });
  return totalWeight === 0 ? 0 : correctWeight / totalWeight;
}

function meetsConceptCriteria(
  evidence: readonly AttemptEvent[],
  policy: MasteryPolicy,
  decay: number,
): boolean {
  const masteryCredit = evidence.reduce(
    (total, event) =>
      total +
      (event.hintLevelUsed === 0
        ? 1
        : event.hintLevelUsed === 1
          ? 0.7
          : event.hintLevelUsed === 2
            ? 0.4
            : 0),
    0,
  );
  const minimumUnhinted = Math.max(
    2,
    Math.ceil(policy.minIndependentAttempts / 2),
  );
  if (
    masteryCredit < policy.minIndependentAttempts ||
    evidence.filter(({ hintLevelUsed }) => hintLevelUsed === 0).length <
      minimumUnhinted
  ) return false;
  if (new Set(evidence.map(({ sessionId }) => sessionId)).size < policy.minSessions) {
    return false;
  }
  if (
    recencyWeightedAccuracy(evidence, decay) <
    policy.weightedAccuracyThreshold
  ) {
    return false;
  }
  const recent = evidence.slice(-policy.recentWindowSize);
  return (
    recent.filter(({ firstAttemptCorrect }) => firstAttemptCorrect).length >=
    policy.recentCorrectRequired
  );
}

function firstMasteredAt(
  evidence: readonly AttemptEvent[],
  policy: MasteryPolicy,
  decay: number,
): number | null {
  for (
    let length = policy.minIndependentAttempts;
    length <= evidence.length;
    length += 1
  ) {
    const prefix = evidence.slice(0, length);
    if (meetsConceptCriteria(prefix, policy, decay)) {
      return prefix.at(-1)?.submittedAt ?? null;
    }
  }
  return null;
}

function diagnosticMasteredAt(
  skill: SkillDefinition,
  evidence: readonly AttemptEvent[],
): number | null {
  if (skill.kind === "transfer") return null;
  const minimum =
    skill.kind === "fact"
      ? 2
      : skill.kind === "micro_step"
        ? skill.id === "R01" || skill.id === "R02"
          ? 2
          : 1
        : skill.id === "A02"
          ? 3
          : skill.id === "A03"
            ? 4
            : 2;
  const diagnostic = evidence.filter(
    ({ sessionLane, hintLevelUsed }) =>
      sessionLane === "diagnostic" && hintLevelUsed === 0,
  );
  for (let end = minimum; end <= diagnostic.length; end += 1) {
    const window = diagnostic.slice(end - minimum, end);
    if (window.every(({ firstAttemptCorrect }) => firstAttemptCorrect)) {
      return window.at(-1)?.submittedAt ?? null;
    }
  }
  return null;
}

const NON_MISCONCEPTION_ERRORS = new Set<ErrorCode>([
  "recognition_uncertain",
  "execution_slip",
  "fatigue_related_error",
  "unclassified_math_error",
]);

export function repeatedRecentMisconception(
  evidence: readonly AttemptEvent[],
  policy: MasteryPolicy,
): ErrorCode | null {
  const window = evidence.slice(-Math.max(5, policy.recentWindowSize + 1));
  const counts: Partial<Record<ErrorCode, number>> = {};
  for (const { errorCode } of window) {
    if (!errorCode || NON_MISCONCEPTION_ERRORS.has(errorCode)) continue;
    counts[errorCode] = (counts[errorCode] ?? 0) + 1;
  }
  const threshold = Math.max(2, policy.maxRepeatedMisconceptionCount + 1);
  return (
    (Object.entries(counts) as [ErrorCode, number][]).find(
      ([, count]) => count >= threshold,
    )?.[0] ?? null
  );
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? (ordered[middle] ?? null)
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function comfortableResponseThreshold(
  skill: SkillDefinition,
  configuration: MasteryConfiguration,
): number {
  const thresholds = configuration.comfortableThresholds;
  if (skill.kind === "fact") return thresholds.factMs;
  if (skill.kind === "micro_step") return thresholds.microStepMs;
  if (skill.kind === "transfer") return thresholds.transferMs;
  const noRegrouping =
    skill.id === "A02" ||
    skill.tags.some((tag) =>
      tag === "no-regrouping" || tag === "without-regrouping",
    );
  return noRegrouping
    ? thresholds.fullNoRegroupingMs
    : thresholds.fullRegroupingMs;
}

function errorCounts(
  attempts: readonly AttemptEvent[],
): Partial<Record<ErrorCode, number>> {
  const counts: Partial<Record<ErrorCode, number>> = {};
  for (const { errorCode } of attempts) {
    if (errorCode) counts[errorCode] = (counts[errorCode] ?? 0) + 1;
  }
  return counts;
}

export function initialLearnerSkillState(
  skillId: SkillId,
  unlocked = false,
  now = 0,
): LearnerSkillState {
  return {
    skillId,
    conceptStatus: unlocked ? "diagnostic" : "locked",
    fluencyStatus: "not_started",
    weightedAccuracy: 0,
    independentAttemptCount: 0,
    correctIndependentAttemptCount: 0,
    hintRate: 0,
    recentErrorCodes: [],
    plateauExposureCount: 0,
    consecutiveSuccessfulSessions: 0,
    totalAttemptCount: 0,
    distinctSessionCount: 0,
    errorCounts: {},
    recentIndependentResults: [],
    updatedAt: now,
  };
}

function consecutiveSuccessfulSessions(
  evidence: readonly AttemptEvent[],
): number {
  const sessions: AttemptEvent[][] = [];
  for (const event of evidence) {
    const current = sessions.at(-1);
    if (current?.[0]?.sessionId === event.sessionId) current.push(event);
    else sessions.push([event]);
  }
  let count = 0;
  for (const session of sessions.reverse()) {
    const correct = session.filter(({ firstAttemptCorrect }) => firstAttemptCorrect).length;
    if (correct / session.length < 0.9) break;
    count += 1;
  }
  return count;
}

/** Recomputes one cached state from the immutable attempt-event log. */
export function deriveLearnerSkillState(
  skill: SkillDefinition,
  attempts: readonly AttemptEvent[],
  options: SkillReductionOptions = {},
): LearnerSkillState {
  const configuration = configurationWith(options.configuration);
  const executionSlipProblemIds = confirmedExecutionSlipProblemIds(attempts);
  const relevant = chronological(
    attempts.filter(({ skillId }) => skillId === skill.id),
  ).map((event) =>
    executionSlipProblemIds.has(event.problemId) &&
    !event.firstAttemptCorrect
      ? { ...event, errorCode: "execution_slip" as const }
      : event,
  );
  const independent = relevant.filter((event) =>
    isIndependentEvidence(event, configuration),
  );
  const weightedAccuracy = recencyWeightedAccuracy(
    independent,
    configuration.recencyDecay,
  );
  const reachedMasteryAt =
    firstMasteredAt(
      independent,
      skill.masteryPolicy,
      configuration.recencyDecay,
    ) ?? diagnosticMasteredAt(skill, independent);
  const previouslySecure =
    options.previousState?.conceptStatus === "mastered" ||
    reachedMasteryAt !== null;
  const misconception = repeatedRecentMisconception(
    independent,
    skill.masteryPolicy,
  );
  const postMasteryEvidence = reachedMasteryAt === null
    ? independent
    : independent.filter(({ submittedAt }) => submittedAt > reachedMasteryAt);
  const recentReviews = postMasteryEvidence
    .filter(
      (event) =>
        event.sessionLane === "review" ||
        event.metadata.templateId.startsWith("review:") ||
        event.metadata.challengeProvider === "spaced-review",
    )
    .slice(-Math.max(4, configuration.spacedReviewMinimumAttempts));
  const spacedReviewLoss =
    recentReviews.length >= configuration.spacedReviewMinimumAttempts &&
    recencyWeightedAccuracy(recentReviews, configuration.recencyDecay) <
      configuration.spacedReviewReactivationAccuracy;
  const latestDiagnosticIndex = postMasteryEvidence.findLastIndex(
    ({ diagnosticProbeResult }) => diagnosticProbeResult !== null,
  );
  const latestDiagnostic = latestDiagnosticIndex < 0
    ? undefined
    : postMasteryEvidence[latestDiagnosticIndex];
  const evidenceAfterLatestDiagnostic = latestDiagnosticIndex < 0
    ? []
    : postMasteryEvidence.slice(latestDiagnosticIndex + 1);
  const recoveredAfterDiagnosticFailure =
    meetsConceptCriteria(
      evidenceAfterLatestDiagnostic,
      skill.masteryPolicy,
      configuration.recencyDecay,
    ) ||
    diagnosticMasteredAt(skill, evidenceAfterLatestDiagnostic) !== null;
  const diagnosticLoss =
    latestDiagnostic?.diagnosticProbeResult?.outcome === "fail" &&
    !recoveredAfterDiagnosticFailure;
  const currentlySecure =
    meetsConceptCriteria(
      independent,
      skill.masteryPolicy,
      configuration.recencyDecay,
    ) || diagnosticMasteredAt(skill, independent) !== null;
  const hasUsableMathAttempt = relevant.some((event) =>
    isUsableMathAttempt(event, configuration),
  );

  const conceptStatus =
    (misconception || spacedReviewLoss || diagnosticLoss) && previouslySecure
      ? "learning"
      : currentlySecure
        ? "mastered"
        : previouslySecure
          ? "mastered" // one isolated miss never resets mastery
          : !hasUsableMathAttempt
            ? options.unlocked === false
              ? "locked"
              : "diagnostic"
            : "learning";

  const timingEvents = relevant.filter((event) =>
    isTimingEligible(event, configuration),
  );
  const responseTimes = timingEvents.flatMap(({ responseMs }) =>
    responseMs === null ? [] : [responseMs],
  );
  const firstInkLatencies = timingEvents.flatMap(({ firstInkLatencyMs }) =>
    firstInkLatencyMs === null ? [] : [firstInkLatencyMs],
  );
  const writingDurations = timingEvents.flatMap(({ writingDurationMs }) =>
    writingDurationMs === null ? [] : [writingDurationMs],
  );
  const sampleWindow = configuration.fluencySampleWindow;
  const baseline = median(responseTimes.slice(0, sampleWindow));
  const recentValues = responseTimes.slice(-sampleWindow);
  const recentMedian = median(recentValues);
  const variabilityMs = standardDeviation(recentValues);
  const variabilityRatio =
    recentMedian && variabilityMs !== null
      ? variabilityMs / recentMedian
      : 0;
  const improvement =
    baseline && recentMedian !== null
      ? (baseline - recentMedian) / baseline
      : 0;
  const comfortable =
    options.comfortableResponseMs ??
    comfortableResponseThreshold(skill, configuration);
  const timingSessions = new Set(timingEvents.map(({ sessionId }) => sessionId));
  const plateau =
    conceptStatus === "mastered" &&
    timingEvents.length >= configuration.plateauMinimumCorrectExposures &&
    timingSessions.size >= configuration.plateauMinimumSessions &&
    improvement < configuration.plateauMaximumImprovementRatio &&
    (recentMedian ?? Number.POSITIVE_INFINITY) > comfortable;
  const fluent =
    conceptStatus === "mastered" &&
    timingEvents.length >= configuration.minimumFluencySamples &&
    weightedAccuracy >= 0.9 &&
    variabilityRatio <= configuration.maximumVariabilityRatio &&
    ((recentMedian ?? Number.POSITIVE_INFINITY) <= comfortable ||
      improvement >= configuration.minimumImprovementRatio);
  const fluencyStatus =
    timingEvents.length === 0
      ? "not_started"
      : plateau
        ? "plateau"
        : fluent
          ? options.previousState?.fluencyStatus === "smooth" ||
            options.previousState?.fluencyStatus === "maintenance"
            ? "maintenance"
            : "smooth"
          : "developing";

  const now =
    options.now ??
    relevant.at(-1)?.submittedAt ??
    options.previousState?.updatedAt ??
    0;
  return {
    skillId: skill.id,
    conceptStatus,
    fluencyStatus,
    weightedAccuracy,
    independentAttemptCount: independent.length,
    correctIndependentAttemptCount: independent.filter(
      ({ firstAttemptCorrect }) => firstAttemptCorrect,
    ).length,
    hintRate:
      relevant.length === 0
        ? 0
        : relevant.filter(({ hintLevelUsed }) => hintLevelUsed > 0).length /
          relevant.length,
    recentErrorCodes: relevant
      .flatMap(({ errorCode }) => (errorCode ? [errorCode] : []))
      .slice(-6),
    ...(baseline === null
      ? {}
      : { initialCorrectMedianResponseMs: baseline }),
    ...(recentMedian === null
      ? {}
      : { recentCorrectMedianResponseMs: recentMedian }),
    ...(median(firstInkLatencies.slice(-sampleWindow)) === null
      ? {}
      : {
          recentMedianFirstInkLatencyMs: median(
            firstInkLatencies.slice(-sampleWindow),
          ) ?? undefined,
        }),
    ...(median(writingDurations.slice(-sampleWindow)) === null
      ? {}
      : {
          recentMedianWritingDurationMs: median(
            writingDurations.slice(-sampleWindow),
          ) ?? undefined,
        }),
    ...(variabilityMs === null
      ? {}
      : { responseTimeVariability: variabilityRatio }),
    ...(relevant.at(-1)
      ? { lastPracticedAt: relevant.at(-1)?.submittedAt }
      : {}),
    ...(conceptStatus === "mastered" && relevant.at(-1)
      ? { nextReviewAt: (relevant.at(-1)?.submittedAt ?? now) + 86_400_000 }
      : options.previousState?.nextReviewAt === undefined
        ? {}
        : { nextReviewAt: options.previousState.nextReviewAt }),
    plateauExposureCount: plateau ? timingEvents.length : 0,
    consecutiveSuccessfulSessions: consecutiveSuccessfulSessions(independent),
    totalAttemptCount: relevant.length,
    distinctSessionCount: new Set(relevant.map(({ sessionId }) => sessionId)).size,
    errorCounts: errorCounts(relevant),
    recentIndependentResults: independent
      .slice(-Math.max(6, skill.masteryPolicy.recentWindowSize))
      .map(({ firstAttemptCorrect }) => firstAttemptCorrect),
    updatedAt: now,
  };
}

export function deriveLearnerSkillStates(
  skills: readonly SkillDefinition[],
  attempts: readonly AttemptEvent[],
  previous: Readonly<Partial<Record<SkillId, LearnerSkillState>>> = {},
  configuration?: Partial<MasteryConfiguration>,
): Readonly<Partial<Record<SkillId, LearnerSkillState>>> {
  const definitions = new Map(skills.map((skill) => [skill.id, skill]));
  const results: Partial<Record<SkillId, LearnerSkillState>> = {};
  const visiting = new Set<SkillId>();

  const reduce = (skill: SkillDefinition): LearnerSkillState => {
    const cached = results[skill.id];
    if (cached) return cached;

    const ownDiagnosticEvidence = attempts.some(
      (event) =>
        event.skillId === skill.id &&
        (event.sessionLane === "diagnostic" ||
          event.diagnosticProbeResult !== null) &&
        isIndependentEvidence(event, configuration),
    );
    visiting.add(skill.id);
    const prerequisitesMastered = skill.prerequisites.every((skillId) => {
      if (visiting.has(skillId)) return false;
      const prerequisite = definitions.get(skillId);
      if (!prerequisite) return previous[skillId]?.conceptStatus === "mastered";
      return reduce(prerequisite).conceptStatus === "mastered";
    });
    visiting.delete(skill.id);

    const state = deriveLearnerSkillState(skill, attempts, {
      previousState: previous[skill.id],
      configuration,
      unlocked:
        skill.prerequisites.length === 0 ||
        ownDiagnosticEvidence ||
        prerequisitesMastered,
    });
    results[skill.id] = state;
    return state;
  };

  for (const skill of skills) reduce(skill);
  return results;
}
