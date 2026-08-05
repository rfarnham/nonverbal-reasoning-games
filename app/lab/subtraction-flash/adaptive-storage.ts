import type {
  AttemptRelationKind,
  AdaptiveSessionState,
  AdaptiveSettings,
  AttemptEvent,
  CompletedSessionSummary,
  ConceptStatus,
  ErrorCode,
  FluencyStatus,
  GeneratedProblem,
  LearnerSkillState,
  PlannedCard,
  ProblemAnswer,
  ProblemFormat,
  ProblemMetadata,
  RecognitionEvent,
  ReviewScheduleEntry,
  SessionKind,
  SessionLane,
  SessionLifecycle,
  SkillId,
} from "./adaptive/types.ts";
import type {
  AdaptiveSessionPauseReason,
  AdaptiveSessionRuntime,
} from "./adaptive/session.ts";
import {
  SUBSTANTIAL_INTERRUPTION_MS,
  recognitionIsReliable,
} from "./adaptive/attempts.ts";
import { validateGeneratedProblem } from "./adaptive/problems.ts";

export const ADAPTIVE_SUBTRACTION_STORAGE_KEY =
  "spatial-gym:adaptive-subtraction";
export const ADAPTIVE_SUBTRACTION_SCHEMA_VERSION = 1 as const;
export const ADAPTIVE_SUBTRACTION_CONTENT_VERSION = "3";
export const DEVICE_LEARNER_ID = "device-learner";

export const DEFAULT_ADAPTIVE_SETTINGS: AdaptiveSettings = {
  soundEnabled: true,
  targetCardCount: 11,
  maxActiveDurationMs: 12 * 60 * 1_000,
  handwritingRecognitionEnabled: true,
  confirmLowConfidenceRecognition: true,
  optionalChallengeEnabled: true,
  parentBenchmarkTargetMs: null,
};

export interface AdaptiveSubtractionProgress {
  schemaVersion: typeof ADAPTIVE_SUBTRACTION_SCHEMA_VERSION;
  contentVersion: string;
  learnerId: string;
  attemptEvents: readonly AttemptEvent[];
  recognitionEvents: readonly RecognitionEvent[];
  skillStates: Readonly<Partial<Record<SkillId, LearnerSkillState>>>;
  reviewSchedule: readonly ReviewScheduleEntry[];
  activeSession: AdaptiveSessionRuntime | null;
  settings: AdaptiveSettings;
  completedSessions: readonly CompletedSessionSummary[];
  updatedAt: number;
}

export type AdaptiveSubtractionLoadStatus =
  | "empty"
  | "loaded"
  | "migrated"
  | "corrupt"
  | "unsupported"
  | "unavailable";

export type AdaptiveSubtractionLoadResult = Readonly<{
  progress: AdaptiveSubtractionProgress;
  status: AdaptiveSubtractionLoadStatus;
}>;

export type AdaptiveStorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const SKILL_IDS: readonly SkillId[] = [
  "F01", "F02", "F03", "F04", "F05",
  "R01", "R02", "R03", "R04", "R05",
  "A01", "A02", "A03", "A04", "A05", "A06",
  "T01", "T02", "T03", "T04", "T05",
];
const ERROR_CODES: readonly ErrorCode[] = [
  "recognition_uncertain",
  "wrong_operation",
  "fact_retrieval_error",
  "regrouping_not_detected",
  "unnecessary_regrouping",
  "forgot_to_decrement_tens",
  "regrouped_state_lost",
  "ones_digit_error",
  "tens_digit_error",
  "place_value_assembly_error",
  "digit_transposition",
  "copy_or_alignment_error",
  "execution_slip",
  "fatigue_related_error",
  "unclassified_math_error",
];
const CONCEPT_STATUSES: readonly ConceptStatus[] = [
  "locked", "diagnostic", "learning", "mastered",
];
const FLUENCY_STATUSES: readonly FluencyStatus[] = [
  "not_started", "developing", "smooth", "maintenance", "plateau",
];
const SESSION_KINDS: readonly SessionKind[] = [
  "diagnostic", "practice", "benchmark",
];
const SESSION_LANES: readonly SessionLane[] = [
  "diagnostic", "warmup", "focus", "integration", "review", "transfer",
  "easy_close",
];
const ATTEMPT_RELATIONS: readonly AttemptRelationKind[] = [
  "remediation_probe",
  "delayed_retry",
];
const SESSION_PHASES: readonly SessionLifecycle[] = [
  "not_started",
  "diagnostic",
  "warmup",
  "focused_practice",
  "integration",
  "transfer",
  "easy_close",
  "complete",
  "paused",
  "ended_early_for_fatigue",
];
const RENAME_QUESTIONS = [
  "renamed_tens",
  "renamed_ones",
  "ones_after_regrouping",
  "tens_after_regrouping",
  "assembled_value",
] as const;
const SESSION_PAUSE_REASONS: readonly AdaptiveSessionPauseReason[] = [
  "explicit",
  "background",
];

function sessionPhaseForLane(lane: SessionLane): SessionLifecycle {
  switch (lane) {
    case "diagnostic":
      return "diagnostic";
    case "focus":
      return "focused_practice";
    case "integration":
      return "integration";
    case "transfer":
      return "transfer";
    case "easy_close":
      return "easy_close";
    case "review":
    case "warmup":
      return "warmup";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonnegative(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function integer(value: unknown): number | null {
  const number = nonnegative(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : nonnegative(value) ?? undefined;
}

function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : text(value) ?? undefined;
}

function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && SKILL_IDS.includes(value as SkillId);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODES.includes(value as ErrorCode);
}

function problemAnswer(value: unknown): ProblemAnswer | null | undefined {
  if (value === null) return null;
  if (value === "yes" || value === "no") return value;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function format(value: unknown): ProblemFormat | null {
  return value === "horizontal" || value === "vertical" ? value : null;
}

function normalizeMetadata(value: unknown): ProblemMetadata | null {
  const item = record(value);
  const templateId = text(item?.templateId);
  const itemFormat = format(item?.format);
  const operation =
    item?.operation === "addition" || item?.operation === "subtraction"
      ? item.operation
      : null;
  if (!item || !templateId || !itemFormat || !operation) return null;
  const optionalBoolean = (key: string) =>
    item[key] === undefined || typeof item[key] === "boolean";
  if (
    !optionalBoolean("requiresRegrouping") ||
    !optionalBoolean("minuendEndsInZero") ||
    !optionalBoolean("resultUnderTen") ||
    (item.missingTerm !== undefined &&
      item.missingTerm !== "left" &&
      item.missingTerm !== "right" &&
      item.missingTerm !== "result") ||
    (item.renameQuestion !== undefined &&
      !RENAME_QUESTIONS.includes(
        item.renameQuestion as (typeof RENAME_QUESTIONS)[number],
      )) ||
    (item.sourceSkillId !== undefined && !isSkillId(item.sourceSkillId)) ||
    (item.misconception !== undefined && !isErrorCode(item.misconception)) ||
    (item.challengeProvider !== undefined && text(item.challengeProvider) === null)
  ) {
    return null;
  }
  return {
    templateId,
    format: itemFormat,
    operation,
    ...(typeof item.requiresRegrouping === "boolean"
      ? { requiresRegrouping: item.requiresRegrouping }
      : {}),
    ...(typeof item.minuendEndsInZero === "boolean"
      ? { minuendEndsInZero: item.minuendEndsInZero }
      : {}),
    ...(typeof item.resultUnderTen === "boolean"
      ? { resultUnderTen: item.resultUnderTen }
      : {}),
    ...(item.missingTerm === "left" ||
    item.missingTerm === "right" ||
    item.missingTerm === "result"
      ? { missingTerm: item.missingTerm }
      : {}),
    ...(RENAME_QUESTIONS.includes(
      item.renameQuestion as (typeof RENAME_QUESTIONS)[number],
    )
      ? { renameQuestion: item.renameQuestion as ProblemMetadata["renameQuestion"] }
      : {}),
    ...(isErrorCode(item.misconception)
      ? { misconception: item.misconception }
      : {}),
    ...(isSkillId(item.sourceSkillId)
      ? { sourceSkillId: item.sourceSkillId }
      : {}),
    ...(text(item.challengeProvider)
      ? { challengeProvider: text(item.challengeProvider) ?? undefined }
      : {}),
  };
}

function normalizeOperands(value: unknown): Readonly<Record<string, number>> | null {
  const item = record(value);
  if (!item) return null;
  const entries = Object.entries(item);
  if (entries.some(([, operand]) => finite(operand) === null)) return null;
  return Object.fromEntries(entries) as Readonly<Record<string, number>>;
}

function normalizeDiagnostic(value: unknown): AttemptEvent["diagnosticProbeResult"] | undefined {
  if (value === null) return null;
  const item = record(value);
  const probeId = text(item?.probeId);
  const outcome = item?.outcome;
  if (!item || !probeId || !["pass", "partial", "fail"].includes(String(outcome))) {
    return undefined;
  }
  const expectedProbeCount =
    item.expectedProbeCount === undefined
      ? undefined
      : integer(item.expectedProbeCount);
  if (
    (item.notes !== undefined && typeof item.notes !== "string") ||
    expectedProbeCount === null ||
    expectedProbeCount === 0
  ) return undefined;
  return {
    probeId,
    outcome: outcome as "pass" | "partial" | "fail",
    ...(expectedProbeCount === undefined ? {} : { expectedProbeCount }),
    ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
  };
}

function normalizeAttempt(value: unknown): AttemptEvent | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id);
  const learnerId = text(item.learnerId);
  const sessionId = text(item.sessionId);
  const problemId = text(item.problemId);
  const problem = item.problem === undefined || item.problem === null
    ? null
    : validGeneratedProblem(item.problem)
      ? jsonClone(item.problem)
      : undefined;
  const problemSeed = text(item.problemSeed);
  const problemFingerprint = text(item.problemFingerprint);
  const supportingSkillIds = Array.isArray(item.supportingSkillIds) &&
    item.supportingSkillIds.every(isSkillId)
    ? [...new Set(item.supportingSkillIds)]
    : null;
  const operands = normalizeOperands(item.operands);
  const metadata = normalizeMetadata(item.metadata);
  const sessionPosition = integer(item.sessionPosition);
  const sessionLane = SESSION_LANES.includes(item.sessionLane as SessionLane)
    ? item.sessionLane as SessionLane
    : metadata?.challengeProvider === "spaced-review"
      ? "review"
      : "focus";
  const relatedProblemId =
    item.relatedProblemId === undefined
      ? null
      : nullableText(item.relatedProblemId);
  const shownAt = nonnegative(item.shownAt);
  const firstInkAt = nullableNumber(item.firstInkAt);
  const submittedAt = nonnegative(item.submittedAt);
  const responseMs = nullableNumber(item.responseMs);
  const firstInkLatencyMs = nullableNumber(item.firstInkLatencyMs);
  const writingDurationMs = nullableNumber(item.writingDurationMs);
  const interruptionDurationMs = nonnegative(item.interruptionDurationMs);
  const rawRecognizedValue = nullableText(item.rawRecognizedValue);
  const normalizedRecognizedValue = problemAnswer(item.normalizedRecognizedValue);
  const expectedAnswer = problemAnswer(item.expectedAnswer);
  const confidence = nullableNumber(item.recognitionConfidence);
  const margin = nullableNumber(item.recognitionMargin);
  const diagnostic = normalizeDiagnostic(item.diagnosticProbeResult);
  const relatedProblemRelation =
    item.relatedProblemRelation === undefined
      ? relatedProblemId === null
        ? null
        : diagnostic && diagnostic.probeId === relatedProblemId
          ? "remediation_probe"
          : "delayed_retry"
      : item.relatedProblemRelation === null
        ? null
        : ATTEMPT_RELATIONS.includes(
              item.relatedProblemRelation as AttemptRelationKind,
            )
          ? (item.relatedProblemRelation as AttemptRelationKind)
          : undefined;
  const itemFormat = format(item.format);
  const operation =
    item.operation === "addition" || item.operation === "subtraction"
      ? item.operation
      : null;
  const booleans = [
    "appWasBackgrounded", "timingEligible", "recognitionConfirmedByChild",
    "recognizerCorrection", "firstAttemptCorrect", "eventuallyCorrect",
    "independent", "skipped", "pauseUsed", "workedAnswerVisible",
  ] as const;
  const skipped = item.skipped === true;
  const reliableRecognition = recognitionIsReliable(confidence ?? null, margin ?? null);
  const recognitionUsable =
    reliableRecognition ||
    item.recognitionConfirmedByChild === true ||
    item.recognizerCorrection === true;
  const expectedIndependent =
    !skipped &&
    recognitionUsable &&
    Number(item.hintLevelUsed) < 3 &&
    item.workedAnswerVisible !== true &&
    item.appWasBackgrounded !== true &&
    item.pauseUsed !== true &&
    (interruptionDurationMs ?? Number.POSITIVE_INFINITY) <=
      SUBSTANTIAL_INTERRUPTION_MS;
  const expectedTimingEligible =
    expectedIndependent &&
    item.firstAttemptCorrect === true &&
    reliableRecognition &&
    item.recognitionConfirmedByChild !== true &&
    item.recognizerCorrection !== true &&
    item.pauseUsed !== true &&
    item.appWasBackgrounded !== true &&
    interruptionDurationMs === 0 &&
    responseMs !== null;
  const answerMatches =
    normalizedRecognizedValue !== null &&
    normalizedRecognizedValue !== undefined &&
    normalizedRecognizedValue === expectedAnswer;
  if (
    !id || !learnerId || !sessionId || !problemId || problem === undefined ||
    !problemSeed ||
    !problemFingerprint || !isSkillId(item.skillId) || !supportingSkillIds ||
    !operands || !metadata || sessionPosition === null ||
    relatedProblemId === undefined || relatedProblemRelation === undefined ||
    (relatedProblemId === null && relatedProblemRelation !== null) ||
    shownAt === null ||
    firstInkAt === undefined || submittedAt === null || responseMs === undefined ||
    firstInkLatencyMs === undefined || writingDurationMs === undefined ||
    interruptionDurationMs === null ||
    rawRecognizedValue === undefined || normalizedRecognizedValue === undefined ||
    expectedAnswer === undefined || expectedAnswer === null ||
    confidence === undefined || margin === undefined ||
    confidence !== null && confidence > 1 || margin !== null && margin > 1 ||
    !booleans.every((key) => typeof item[key] === "boolean") ||
    ![0, 1, 2, 3, 4].includes(item.hintLevelUsed as number) ||
    integer(item.correctionCount) === null ||
    (item.errorCode !== null && !isErrorCode(item.errorCode)) ||
    diagnostic === undefined || !itemFormat || !operation || submittedAt < shownAt ||
    (firstInkAt !== null && (firstInkAt < shownAt || firstInkAt > submittedAt)) ||
    supportingSkillIds.length !==
      (item.supportingSkillIds as unknown[]).length ||
    metadata.format !== itemFormat || metadata.operation !== operation ||
    (skipped ? responseMs !== null : responseMs !== submittedAt - shownAt) ||
    (firstInkAt === null
      ? firstInkLatencyMs !== null || writingDurationMs !== null
      : firstInkLatencyMs !== firstInkAt - shownAt ||
        writingDurationMs !== submittedAt - firstInkAt) ||
    (item.firstAttemptCorrect === true && item.eventuallyCorrect !== true) ||
    (skipped &&
      (normalizedRecognizedValue !== null ||
        item.firstAttemptCorrect === true ||
        item.eventuallyCorrect === true ||
        item.independent === true ||
        item.timingEligible === true ||
        item.errorCode !== null)) ||
    (!skipped && normalizedRecognizedValue === null) ||
    (!skipped && item.firstAttemptCorrect !== answerMatches) ||
    item.independent !== expectedIndependent ||
    item.timingEligible !== expectedTimingEligible ||
    (item.firstAttemptCorrect === true && item.errorCode !== null)
    || (problem !== null &&
      (problem.id !== problemId ||
        problem.seed !== problemSeed ||
        problem.fingerprint !== problemFingerprint ||
        problem.skillId !== item.skillId ||
        problem.expectedAnswer !== expectedAnswer ||
        problem.metadata.format !== itemFormat ||
        problem.metadata.operation !== operation))
  ) {
    return null;
  }
  return {
    id, learnerId, sessionId, problemId, problem, problemSeed,
    problemFingerprint,
    skillId: item.skillId, supportingSkillIds, operands, metadata,
    sessionPosition, sessionLane, relatedProblemId, relatedProblemRelation,
    shownAt, firstInkAt,
    submittedAt, responseMs,
    firstInkLatencyMs, writingDurationMs,
    appWasBackgrounded: item.appWasBackgrounded as boolean,
    interruptionDurationMs,
    timingEligible: item.timingEligible as boolean,
    rawRecognizedValue, normalizedRecognizedValue,
    recognitionConfidence: confidence, recognitionMargin: margin,
    recognitionConfirmedByChild: item.recognitionConfirmedByChild as boolean,
    recognizerCorrection: item.recognizerCorrection as boolean,
    expectedAnswer: expectedAnswer as ProblemAnswer,
    firstAttemptCorrect: item.firstAttemptCorrect as boolean,
    eventuallyCorrect: item.eventuallyCorrect as boolean,
    independent: item.independent as boolean,
    hintLevelUsed: item.hintLevelUsed as AttemptEvent["hintLevelUsed"],
    correctionCount: item.correctionCount as number,
    skipped: item.skipped as boolean,
    pauseUsed: item.pauseUsed as boolean,
    workedAnswerVisible: item.workedAnswerVisible as boolean,
    errorCode: item.errorCode as ErrorCode | null,
    diagnosticProbeResult: diagnostic,
    format: itemFormat, operation,
  };
}

function normalizeRecognition(value: unknown): RecognitionEvent | null {
  const item = record(value);
  if (!item) return null;
  const raw = nullableText(item.rawRecognizedValue);
  const normalized = problemAnswer(item.normalizedRecognizedValue);
  const confidence = nullableNumber(item.recognitionConfidence);
  const margin = nullableNumber(item.recognitionMargin);
  const corrected = item.correctedValue === undefined
    ? undefined
    : problemAnswer(item.correctedValue);
  if (
    !text(item.id) || !text(item.learnerId) || !text(item.sessionId) ||
    !text(item.problemId) ||
    !["recognition_uncertain", "recognition_confirmed", "recognition_corrected"].includes(String(item.kind)) ||
    nonnegative(item.occurredAt) === null || raw === undefined ||
    normalized === undefined || confidence === undefined || margin === undefined ||
    confidence !== null && confidence > 1 || margin !== null && margin > 1 ||
    typeof item.confirmedByChild !== "boolean" || corrected === null ||
    (item.correctedValue !== undefined && corrected === undefined)
  ) return null;
  return {
    id: text(item.id)!, kind: item.kind as RecognitionEvent["kind"],
    learnerId: text(item.learnerId)!, sessionId: text(item.sessionId)!,
    problemId: text(item.problemId)!, occurredAt: item.occurredAt as number,
    rawRecognizedValue: raw, normalizedRecognizedValue: normalized,
    recognitionConfidence: confidence, recognitionMargin: margin,
    confirmedByChild: item.confirmedByChild,
    ...(corrected === undefined ? {} : { correctedValue: corrected }),
  };
}

function normalizeSkillState(value: unknown): LearnerSkillState | null {
  const item = record(value);
  if (!item || !isSkillId(item.skillId)) return null;
  if (!CONCEPT_STATUSES.includes(item.conceptStatus as ConceptStatus) ||
      !FLUENCY_STATUSES.includes(item.fluencyStatus as FluencyStatus)) return null;
  const accuracy = nonnegative(item.weightedAccuracy);
  const independent = integer(item.independentAttemptCount);
  const correct = integer(item.correctIndependentAttemptCount);
  const hintRate = nonnegative(item.hintRate);
  const errors = Array.isArray(item.recentErrorCodes) && item.recentErrorCodes.every(isErrorCode)
    ? item.recentErrorCodes : null;
  const plateau = integer(item.plateauExposureCount);
  const sessions = integer(item.consecutiveSuccessfulSessions);
  if (accuracy === null || accuracy > 1 || independent === null || correct === null ||
      correct > independent || hintRate === null || hintRate > 1 || !errors ||
      plateau === null || sessions === null) return null;
  const result: LearnerSkillState = {
    skillId: item.skillId, conceptStatus: item.conceptStatus as ConceptStatus,
    fluencyStatus: item.fluencyStatus as FluencyStatus, weightedAccuracy: accuracy,
    independentAttemptCount: independent, correctIndependentAttemptCount: correct,
    hintRate, recentErrorCodes: [...errors], plateauExposureCount: plateau,
    consecutiveSuccessfulSessions: sessions,
  };
  const optionalNumbers = [
    "initialCorrectMedianResponseMs", "recentCorrectMedianResponseMs",
    "recentMedianFirstInkLatencyMs", "recentMedianWritingDurationMs",
    "responseTimeVariability", "lastPracticedAt", "nextReviewAt",
    "totalAttemptCount", "distinctSessionCount", "updatedAt",
  ] as const;
  for (const key of optionalNumbers) {
    if (item[key] === undefined) continue;
    const parsed = nonnegative(item[key]);
    if (parsed === null) return null;
    (result as unknown as Record<string, unknown>)[key] = parsed;
  }
  if (item.errorCounts !== undefined) {
    const counts = record(item.errorCounts);
    if (!counts || Object.entries(counts).some(([key, count]) =>
      !isErrorCode(key) || integer(count) === null)) return null;
    result.errorCounts = counts as Partial<Record<ErrorCode, number>>;
  }
  if (item.recentIndependentResults !== undefined) {
    if (!Array.isArray(item.recentIndependentResults) ||
        !item.recentIndependentResults.every((entry) => typeof entry === "boolean")) return null;
    result.recentIndependentResults = [...item.recentIndependentResults];
  }
  return result;
}

function normalizeReview(value: unknown): ReviewScheduleEntry | null {
  const item = record(value);
  const interval = integer(item?.intervalIndex);
  const completedAt = nullableNumber(item?.completedAt);
  if (!item || !text(item.id) || !text(item.learnerId) || !isSkillId(item.skillId) ||
      interval === null || interval >= 5 || nonnegative(item.dueAt) === null ||
      nonnegative(item.scheduledAt) === null || nullableNumber(item.lastReviewedAt) === undefined ||
      completedAt === undefined ||
      !["scheduled", "due", "completed"].includes(String(item.status)) ||
      !text(item.sourceSessionId) || nullableText(item.sourceProblemId) === undefined ||
      (item.status === "completed" ? completedAt === null : completedAt !== null)) return null;
  return {
    id: text(item.id)!, learnerId: text(item.learnerId)!, skillId: item.skillId,
    intervalIndex: item.intervalIndex as number, dueAt: item.dueAt as number,
    scheduledAt: item.scheduledAt as number,
    lastReviewedAt: item.lastReviewedAt as number | null,
    completedAt: item.completedAt as number | null,
    status: item.status as ReviewScheduleEntry["status"],
    sourceSessionId: text(item.sourceSessionId)!,
    sourceProblemId: item.sourceProblemId as string | null,
  };
}

function normalizeCompletedSession(value: unknown): CompletedSessionSummary | null {
  const item = record(value);
  const startedAt = nonnegative(item?.startedAt);
  const completedAt = nonnegative(item?.completedAt);
  const attempted = integer(item?.attemptedProblemCount);
  const independentlyCorrect = integer(item?.independentlyCorrectCount);
  const eventuallyCorrect = integer(item?.eventuallyCorrectCount);
  if (!item || !text(item.sessionId) || !text(item.learnerId) ||
      !SESSION_KINDS.includes(item.kind as SessionKind) ||
      startedAt === null || completedAt === null || completedAt < startedAt ||
      nonnegative(item.activeDurationMs) === null ||
      Number(item.activeDurationMs) > completedAt - startedAt ||
      attempted === null || independentlyCorrect === null || eventuallyCorrect === null ||
      independentlyCorrect > attempted || eventuallyCorrect > attempted ||
      independentlyCorrect > eventuallyCorrect ||
      (item.focusSkillId !== null && !isSkillId(item.focusSkillId)) ||
      typeof item.endedEarlyForFatigue !== "boolean" ||
      (item.completedAsPlanned !== undefined &&
        typeof item.completedAsPlanned !== "boolean")) return null;
  return {
    sessionId: text(item.sessionId)!, learnerId: text(item.learnerId)!,
    kind: item.kind as SessionKind, startedAt: item.startedAt as number,
    completedAt: item.completedAt as number, activeDurationMs: item.activeDurationMs as number,
    attemptedProblemCount: item.attemptedProblemCount as number,
    independentlyCorrectCount: item.independentlyCorrectCount as number,
    eventuallyCorrectCount: item.eventuallyCorrectCount as number,
    focusSkillId: item.focusSkillId as SkillId | null,
    endedEarlyForFatigue: item.endedEarlyForFatigue,
    completedAsPlanned: item.completedAsPlanned !== false,
  };
}

function normalizeSettings(value: unknown): AdaptiveSettings | null {
  const item = record(value);
  if (!item) return null;
  const booleans = ["soundEnabled", "handwritingRecognitionEnabled",
    "confirmLowConfidenceRecognition", "optionalChallengeEnabled"] as const;
  const parentBenchmarkTargetMs = item.parentBenchmarkTargetMs === undefined ||
      item.parentBenchmarkTargetMs === null
    ? null
    : nonnegative(item.parentBenchmarkTargetMs);
  if (!booleans.every((key) => typeof item[key] === "boolean") ||
      integer(item.targetCardCount) === null || Number(item.targetCardCount) < 1 ||
      nonnegative(item.maxActiveDurationMs) === null || Number(item.maxActiveDurationMs) < 1 ||
      (parentBenchmarkTargetMs === null &&
        item.parentBenchmarkTargetMs !== undefined &&
        item.parentBenchmarkTargetMs !== null) ||
      (parentBenchmarkTargetMs !== null && parentBenchmarkTargetMs <= 0)) return null;
  return {
    soundEnabled: item.soundEnabled as boolean,
    targetCardCount: item.targetCardCount as number,
    maxActiveDurationMs: item.maxActiveDurationMs as number,
    handwritingRecognitionEnabled: item.handwritingRecognitionEnabled as boolean,
    confirmLowConfidenceRecognition: item.confirmLowConfidenceRecognition as boolean,
    optionalChallengeEnabled: item.optionalChallengeEnabled as boolean,
    parentBenchmarkTargetMs,
  };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validGeneratedProblem(value: unknown): value is GeneratedProblem {
  const item = record(value);
  if (!(item && text(item.id) && text(item.seed) && text(item.fingerprint) &&
    isSkillId(item.skillId) && Array.isArray(item.supportingSkillIds) &&
    item.supportingSkillIds.every(isSkillId) && nonnegative(item.difficulty) !== null &&
    normalizeOperands(item.operands) && normalizeMetadata(item.metadata) &&
    record(item.promptSpec) && record(item.answerSpec) &&
    problemAnswer(item.expectedAnswer) !== undefined &&
    problemAnswer(item.expectedAnswer) !== null && Array.isArray(item.hints))) {
    return false;
  }
  try {
    return validateGeneratedProblem(item as unknown as GeneratedProblem).length === 0;
  } catch {
    return false;
  }
}

function validPlannedCard(value: unknown): value is PlannedCard {
  const item = record(value);
  return Boolean(item && text(item.id) && isSkillId(item.skillId) &&
    ["diagnostic", "warmup", "focus", "integration", "review", "transfer", "easy_close"].includes(String(item.lane)) &&
    text(item.reason) && validGeneratedProblem(item.problem) &&
    record(item.problem)?.skillId === item.skillId &&
    ["planned", "active", "completed", "skipped"].includes(String(item.status)) &&
    nullableText(item.remediationForProblemId) !== undefined &&
    nullableText(item.delayedRetryForProblemId) !== undefined);
}

function normalizeSession(value: unknown): AdaptiveSessionRuntime | null {
  if (value === null) return null;
  const item = record(value);
  const createdAt = item?.createdAt === undefined
    ? nullableNumber(item?.startedAt) ?? nullableNumber(item?.shownAt) ?? 0
    : nonnegative(item.createdAt);
  const focusSkillId = item?.focusSkillId === undefined || item?.focusSkillId === null
    ? null
    : isSkillId(item.focusSkillId)
      ? item.focusSkillId
      : undefined;
  if (!item || !text(item.id) || !text(item.learnerId) ||
      !SESSION_KINDS.includes(item.kind as SessionKind) || !text(item.seed) ||
      createdAt === null || focusSkillId === undefined ||
      integer(item.targetCardCount) === null || Number(item.targetCardCount) < 1 ||
      nonnegative(item.maxActiveDurationMs) === null || Number(item.maxActiveDurationMs) < 1 ||
      !SESSION_PHASES.includes(item.phase as SessionLifecycle) ||
      !Array.isArray(item.cards) || !item.cards.every(validPlannedCard) ||
      !Array.isArray(item.completedProblemIds) || !item.completedProblemIds.every((id) => text(id) !== null) ||
      (item.currentProblem !== null && !validGeneratedProblem(item.currentProblem)) ||
      integer(item.currentCardIndex) === null || nullableNumber(item.shownAt) === undefined ||
      nonnegative(item.activeElapsedMs) === null || nullableNumber(item.pausedAt) === undefined ||
      typeof item.explicitPauseUsed !== "boolean" || typeof item.backgrounded !== "boolean" ||
      nonnegative(item.interruptionDurationMs) === null ||
      !Array.isArray(item.remediationQueue) || !item.remediationQueue.every(validPlannedCard) ||
      typeof item.fatigueFlag !== "boolean" || nullableNumber(item.startedAt) === undefined ||
      nullableNumber(item.completedAt) === undefined ||
      Number(item.currentCardIndex) >= item.cards.length ||
      Number(item.targetCardCount) !== item.cards.length) return null;

  const hasRuntimeFields = [
    "activeSince",
    "pauseReasons",
    "phaseBeforePause",
    "backgroundedAt",
  ].some((key) => Object.hasOwn(item, key));
  const activeSince = nullableNumber(item.activeSince);
  const pauseReasons = Array.isArray(item.pauseReasons) &&
    item.pauseReasons.every((reason) =>
      SESSION_PAUSE_REASONS.includes(reason as AdaptiveSessionPauseReason)) &&
    new Set(item.pauseReasons).size === item.pauseReasons.length
      ? item.pauseReasons as AdaptiveSessionPauseReason[]
      : null;
  const phaseBeforePause = item.phaseBeforePause === null
    ? null
    : SESSION_PHASES.includes(item.phaseBeforePause as SessionLifecycle)
      ? item.phaseBeforePause as SessionLifecycle
      : undefined;
  const backgroundedAt = nullableNumber(item.backgroundedAt);

  if (
    hasRuntimeFields &&
    (activeSince === undefined || pauseReasons === null ||
      phaseBeforePause === undefined || backgroundedAt === undefined)
  ) return null;

  const normalizedPauseReasons = hasRuntimeFields
    ? pauseReasons ?? []
    : item.phase === "paused"
      ? [
          ...(item.explicitPauseUsed ? ["explicit" as const] : []),
          ...(item.backgrounded ? ["background" as const] : []),
          ...(!item.explicitPauseUsed && !item.backgrounded
            ? ["explicit" as const]
            : []),
        ]
      : [];
  const normalizedPhaseBeforePause = hasRuntimeFields
    ? phaseBeforePause ?? null
    : item.phase === "paused"
      ? sessionPhaseForLane(
          (item.cards as PlannedCard[])[item.currentCardIndex as number]!.lane,
        )
      : null;
  const normalizedActiveSince = hasRuntimeFields ? activeSince ?? null : null;
  const normalizedBackgroundedAt = hasRuntimeFields
    ? backgroundedAt ?? null
    : null;

  if (
    (item.phase === "paused" && normalizedPauseReasons.length === 0) ||
    (item.phase !== "paused" && normalizedPauseReasons.length > 0) ||
    (item.phase === "paused" && normalizedActiveSince !== null) ||
    (normalizedPauseReasons.includes("background") !== item.backgrounded) ||
    (normalizedBackgroundedAt !== null &&
      !normalizedPauseReasons.includes("background"))
  ) return null;

  const cards = item.cards as PlannedCard[];
  const currentCardIndex = item.currentCardIndex as number;
  const activeIndexes = cards.flatMap((card, index) =>
    card.status === "active" ? [index] : [],
  );
  const phase = item.phase as SessionLifecycle;
  const terminal = phase === "complete" || phase === "ended_early_for_fatigue";
  const notStarted = phase === "not_started";
  const currentProblem = item.currentProblem as GeneratedProblem | null;
  const currentCard = cards[currentCardIndex];
  const expectedLivePhase = currentCard
    ? sessionPhaseForLane(currentCard.lane)
    : null;
  const completedIds = cards
    .filter(({ status }) => status === "completed")
    .map(({ problem }) => problem.id);
  const storedCompletedIds = item.completedProblemIds as string[];
  const completionIdsMatch =
    new Set(storedCompletedIds).size === storedCompletedIds.length &&
    completedIds.length === storedCompletedIds.length &&
    completedIds.every((id) => storedCompletedIds.includes(id));

  if (
    !completionIdsMatch ||
    (notStarted &&
      (activeIndexes.length !== 0 ||
        cards.some(({ status }) => status !== "planned") ||
        currentProblem !== null ||
        item.shownAt !== null ||
        item.startedAt !== null ||
        item.completedAt !== null)) ||
    (notStarted && normalizedActiveSince !== null) ||
    (terminal &&
      (activeIndexes.length !== 0 ||
        cards.some(({ status }) => status === "planned") ||
        currentProblem !== null ||
        item.shownAt !== null ||
        item.completedAt === null ||
        normalizedActiveSince !== null ||
        item.pausedAt !== null)) ||
    (!notStarted &&
      !terminal &&
      (activeIndexes.length !== 1 ||
        activeIndexes[0] !== currentCardIndex ||
        currentProblem === null ||
        currentCard?.problem.id !== currentProblem.id ||
        currentCard.problem.fingerprint !== currentProblem.fingerprint ||
        item.shownAt === null ||
        item.startedAt === null ||
        item.completedAt !== null ||
        (phase === "paused"
          ? normalizedPhaseBeforePause !== expectedLivePhase ||
            item.pausedAt === null
          : phase !== expectedLivePhase ||
            item.pausedAt !== null ||
            (hasRuntimeFields && normalizedActiveSince === null))))
  ) return null;

  return {
    ...(jsonClone(item) as unknown as AdaptiveSessionState),
    createdAt,
    focusSkillId,
    activeSince: normalizedActiveSince,
    pauseReasons: normalizedPauseReasons,
    phaseBeforePause: normalizedPhaseBeforePause,
    backgroundedAt: normalizedBackgroundedAt,
  };
}

export function createEmptyAdaptiveSubtractionProgress(
  learnerId = DEVICE_LEARNER_ID,
  now = 0,
): AdaptiveSubtractionProgress {
  const normalizedLearnerId = text(learnerId);
  if (!normalizedLearnerId || nonnegative(now) === null) {
    throw new Error("Adaptive subtraction progress needs a learner and valid time.");
  }
  return {
    schemaVersion: ADAPTIVE_SUBTRACTION_SCHEMA_VERSION,
    contentVersion: ADAPTIVE_SUBTRACTION_CONTENT_VERSION,
    learnerId: normalizedLearnerId,
    attemptEvents: [], recognitionEvents: [], skillStates: {}, reviewSchedule: [],
    activeSession: null, settings: { ...DEFAULT_ADAPTIVE_SETTINGS },
    completedSessions: [], updatedAt: now,
  };
}

function normalizeProgress(value: unknown): AdaptiveSubtractionProgress | null {
  const item = record(value);
  if (!item || item.schemaVersion !== ADAPTIVE_SUBTRACTION_SCHEMA_VERSION ||
      !text(item.contentVersion) || !text(item.learnerId) ||
      !Array.isArray(item.attemptEvents) || !Array.isArray(item.recognitionEvents) ||
      !Array.isArray(item.reviewSchedule) || !Array.isArray(item.completedSessions) ||
      !record(item.skillStates) || normalizeSettings(item.settings) === null ||
      nonnegative(item.updatedAt) === null) return null;
  const attempts = item.attemptEvents.map(normalizeAttempt);
  const recognitions = item.recognitionEvents.map(normalizeRecognition);
  const reviews = item.reviewSchedule.map(normalizeReview);
  const sessions = item.completedSessions.map(normalizeCompletedSession);
  const states = Object.entries(item.skillStates as Record<string, unknown>).map(([key, state]) => {
    if (!isSkillId(key)) return null;
    const normalized = normalizeSkillState(state);
    return normalized?.skillId === key ? normalized : null;
  });
  const activeSession = normalizeSession(item.activeSession);
  if (attempts.some((entry) => !entry) || recognitions.some((entry) => !entry) ||
      reviews.some((entry) => !entry) || sessions.some((entry) => !entry) ||
      states.some((entry) => !entry) || (item.activeSession !== null && !activeSession)) return null;
  const learnerId = text(item.learnerId)!;
  if ([...attempts, ...recognitions, ...reviews, ...sessions].some(
    (entry) => entry?.learnerId !== learnerId) ||
    activeSession && activeSession.learnerId !== learnerId) return null;
  const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
  if (!unique(attempts.map((entry) => entry!.id)) ||
      !unique(recognitions.map((entry) => entry!.id)) ||
      !unique(reviews.map((entry) => entry!.id)) ||
      !unique(sessions.map((entry) => entry!.sessionId))) return null;
  return {
    schemaVersion: ADAPTIVE_SUBTRACTION_SCHEMA_VERSION,
    contentVersion: text(item.contentVersion)!, learnerId,
    attemptEvents: attempts as AttemptEvent[],
    recognitionEvents: recognitions as RecognitionEvent[],
    skillStates: Object.fromEntries((states as LearnerSkillState[]).map((state) => [state.skillId, state])),
    reviewSchedule: reviews as ReviewScheduleEntry[], activeSession,
    settings: normalizeSettings(item.settings)!,
    completedSessions: sessions as CompletedSessionSummary[],
    updatedAt: item.updatedAt as number,
  };
}

function equivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equivalent(value, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) =>
    key === bKeys[index] && equivalent(a[key], b[key]));
}

export function decodeAdaptiveSubtractionProgressDiagnostic(
  serialized: string,
): AdaptiveSubtractionLoadResult {
  const empty = createEmptyAdaptiveSubtractionProgress();
  try {
    const raw = JSON.parse(serialized) as unknown;
    const item = record(raw);
    if (!item) return { progress: empty, status: "corrupt" };
    if (item.schemaVersion !== ADAPTIVE_SUBTRACTION_SCHEMA_VERSION) {
      return {
        progress: empty,
        status: typeof item.schemaVersion === "number" && item.schemaVersion > ADAPTIVE_SUBTRACTION_SCHEMA_VERSION
          ? "unsupported" : "corrupt",
      };
    }
    const contentChanged = item.contentVersion !== ADAPTIVE_SUBTRACTION_CONTENT_VERSION;
    const normalized = normalizeProgress(
      contentChanged ? { ...item, activeSession: null } : raw,
    );
    if (!normalized) return { progress: empty, status: "corrupt" };
    const rawSettings = record(item.settings);
    const rawSession = record(item.activeSession);
    const rawAttempts = Array.isArray(item.attemptEvents)
      ? item.attemptEvents
      : [];
    const rawCompletedSessions = Array.isArray(item.completedSessions)
      ? item.completedSessions
      : [];
    const needsCompatibleShapeMigration =
      rawSettings?.parentBenchmarkTargetMs === undefined ||
      rawAttempts.some(
        (attempt) =>
          !Object.hasOwn(record(attempt) ?? {}, "relatedProblemRelation") ||
          !Object.hasOwn(record(attempt) ?? {}, "problem"),
      ) ||
      rawCompletedSessions.some(
        (session) => !Object.hasOwn(record(session) ?? {}, "completedAsPlanned"),
      ) ||
      (rawSession !== null &&
        [
          "createdAt",
          "focusSkillId",
          "activeSince",
          "pauseReasons",
          "phaseBeforePause",
          "backgroundedAt",
        ].some((key) => !Object.hasOwn(rawSession, key)));
    if (
      contentChanged ||
      needsCompatibleShapeMigration
    ) {
      return {
        progress: {
          ...normalized,
          contentVersion: ADAPTIVE_SUBTRACTION_CONTENT_VERSION,
          activeSession:
            contentChanged
              ? null
              : normalized.activeSession,
        },
        status: "migrated",
      };
    }
    return {
      progress: normalized,
      status: equivalent(raw, normalized) ? "loaded" : "corrupt",
    };
  } catch {
    return { progress: empty, status: "corrupt" };
  }
}

function browserStorage(): AdaptiveStorageLike | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function loadAdaptiveSubtractionProgressDiagnostic(
  storage: AdaptiveStorageLike | null = browserStorage(),
): AdaptiveSubtractionLoadResult {
  if (!storage) return { progress: createEmptyAdaptiveSubtractionProgress(), status: "unavailable" };
  try {
    const serialized = storage.getItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY);
    return serialized === null
      ? { progress: createEmptyAdaptiveSubtractionProgress(), status: "empty" }
      : decodeAdaptiveSubtractionProgressDiagnostic(serialized);
  } catch {
    return { progress: createEmptyAdaptiveSubtractionProgress(), status: "unavailable" };
  }
}

export function readAdaptiveSubtractionProgress(
  storage: AdaptiveStorageLike | null = browserStorage(),
): AdaptiveSubtractionProgress {
  return loadAdaptiveSubtractionProgressDiagnostic(storage).progress;
}

export function writeAdaptiveSubtractionProgress(
  progress: AdaptiveSubtractionProgress,
  storage: AdaptiveStorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const normalized = normalizeProgress(progress);
    if (!normalized) return false;
    storage.setItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch { return false; }
}

export function removeAdaptiveSubtractionProgress(
  storage: AdaptiveStorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try { storage.removeItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY); return true; }
  catch { return false; }
}

function appendUnique<T extends { id: string }>(values: readonly T[], value: T): readonly T[] {
  const existing = values.find(({ id }) => id === value.id);
  if (!existing) return [...values, value];
  if (equivalent(existing, value)) return values;
  throw new Error(`Event ID ${value.id} already belongs to different data.`);
}

export function appendAttemptEvent(progress: AdaptiveSubtractionProgress, event: AttemptEvent): AdaptiveSubtractionProgress {
  const normalized = normalizeAttempt(event);
  if (event.learnerId !== progress.learnerId || !normalized) throw new Error("Invalid learner attempt event.");
  return { ...progress, attemptEvents: appendUnique(progress.attemptEvents, normalized), updatedAt: Math.max(progress.updatedAt, event.submittedAt) };
}

export function appendRecognitionEvent(progress: AdaptiveSubtractionProgress, event: RecognitionEvent): AdaptiveSubtractionProgress {
  const normalized = normalizeRecognition(event);
  if (event.learnerId !== progress.learnerId || !normalized) throw new Error("Invalid learner recognition event.");
  return { ...progress, recognitionEvents: appendUnique(progress.recognitionEvents, normalized), updatedAt: Math.max(progress.updatedAt, event.occurredAt) };
}

export function replaceSkillStateCache(progress: AdaptiveSubtractionProgress, skillStates: Readonly<Partial<Record<SkillId, LearnerSkillState>>>, now = Date.now()): AdaptiveSubtractionProgress {
  const normalizedEntries = Object.entries(skillStates).map(([key, state]) => {
    const normalized = normalizeSkillState(state);
    return isSkillId(key) && normalized?.skillId === key
      ? [key, normalized] as const
      : null;
  });
  if (normalizedEntries.some((entry) => entry === null) || nonnegative(now) === null) throw new Error("Invalid derived skill-state cache.");
  return { ...progress, skillStates: Object.fromEntries(normalizedEntries.filter((entry) => entry !== null)), updatedAt: now };
}

export function setActiveAdaptiveSession(progress: AdaptiveSubtractionProgress, activeSession: AdaptiveSessionState | AdaptiveSessionRuntime | null, now = Date.now()): AdaptiveSubtractionProgress {
  const normalized = normalizeSession(activeSession);
  if (
    nonnegative(now) === null ||
    (activeSession &&
      (activeSession.learnerId !== progress.learnerId || !normalized))
  ) throw new Error("Invalid active adaptive session.");
  return { ...progress, activeSession: normalized, updatedAt: now };
}

export function upsertReviewScheduleEntry(progress: AdaptiveSubtractionProgress, entry: ReviewScheduleEntry, now = Date.now()): AdaptiveSubtractionProgress {
  const normalized = normalizeReview(entry);
  if (nonnegative(now) === null || entry.learnerId !== progress.learnerId || !normalized) throw new Error("Invalid review schedule entry.");
  const index = progress.reviewSchedule.findIndex(({ id }) => id === entry.id);
  const reviewSchedule = index < 0 ? [...progress.reviewSchedule, normalized] : progress.reviewSchedule.map((candidate) => candidate.id === entry.id ? normalized : candidate);
  return { ...progress, reviewSchedule, updatedAt: now };
}

export function appendCompletedSessionSummary(progress: AdaptiveSubtractionProgress, summary: CompletedSessionSummary): AdaptiveSubtractionProgress {
  const normalized = normalizeCompletedSession(summary);
  if (summary.learnerId !== progress.learnerId || !normalized) throw new Error("Invalid completed session summary.");
  const existing = progress.completedSessions.find(({ sessionId }) => sessionId === summary.sessionId);
  if (existing && !equivalent(existing, normalized)) throw new Error("A completed session cannot be rewritten.");
  return { ...progress, completedSessions: existing ? progress.completedSessions : [...progress.completedSessions, normalized], activeSession: progress.activeSession?.id === summary.sessionId ? null : progress.activeSession, updatedAt: Math.max(progress.updatedAt, summary.completedAt) };
}

export function updateAdaptiveSettings(progress: AdaptiveSubtractionProgress, changes: Partial<AdaptiveSettings>, now = Date.now()): AdaptiveSubtractionProgress {
  const settings = { ...progress.settings, ...changes };
  const normalized = normalizeSettings(settings);
  if (!normalized || nonnegative(now) === null) throw new Error("Invalid adaptive settings.");
  return { ...progress, settings: normalized, updatedAt: now };
}
