import type {
  AttemptRelationKind,
  AttemptEvent,
  DiagnosticProbeResult,
  ErrorCode,
  GeneratedProblem,
  ProblemAnswer,
  RecognitionEvent,
  RecognitionEventKind,
  SessionLane,
} from "./types";

export const RELIABLE_RECOGNITION_CONFIDENCE = 0.52;
export const RELIABLE_RECOGNITION_MARGIN = 0.1;
export const SUBSTANTIAL_INTERRUPTION_MS = 5_000;

export type AttemptInput = Readonly<{
  learnerId: string;
  sessionId: string;
  sessionPosition: number;
  sessionLane?: SessionLane;
  relatedProblemId?: string | null;
  relatedProblemRelation?: AttemptRelationKind | null;
  problem: GeneratedProblem;
  shownAt: number;
  firstInkAt?: number | null;
  submittedAt: number;
  answer: ProblemAnswer | null;
  rawRecognizedValue?: string | null;
  recognitionConfidence?: number | null;
  recognitionMargin?: number | null;
  recognitionConfirmedByChild?: boolean;
  recognizerCorrection?: boolean;
  firstAttemptCorrect: boolean;
  eventuallyCorrect?: boolean;
  hintLevelUsed?: 0 | 1 | 2 | 3 | 4;
  correctionCount?: number;
  skipped?: boolean;
  pauseUsed?: boolean;
  workedAnswerVisible?: boolean;
  appWasBackgrounded?: boolean;
  interruptionDurationMs?: number;
  errorCode?: ErrorCode | null;
  diagnosticProbeResult?: DiagnosticProbeResult | null;
}>;

function validTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function elapsed(later: number, earlier: number): number | null {
  if (!validTime(later) || !validTime(earlier)) return null;
  return Math.max(0, later - earlier);
}

export function recognitionIsReliable(
  confidence: number | null,
  margin: number | null,
): boolean {
  return (
    confidence === null ||
    (confidence >= RELIABLE_RECOGNITION_CONFIDENCE &&
      (margin === null || margin >= RELIABLE_RECOGNITION_MARGIN))
  );
}

/**
 * Builds the immutable learning record at the UI/domain boundary. Concept
 * evidence and timing evidence are intentionally decided separately.
 */
export function createAttemptEvent(input: AttemptInput): AttemptEvent {
  const firstInkAt = input.firstInkAt ?? null;
  const confidence = input.recognitionConfidence ?? null;
  const margin = input.recognitionMargin ?? null;
  const confirmed = input.recognitionConfirmedByChild ?? false;
  const recognizerCorrection = input.recognizerCorrection ?? false;
  const hintLevel = input.hintLevelUsed ?? 0;
  const skipped = input.skipped ?? false;
  const pauseUsed = input.pauseUsed ?? false;
  const workedAnswerVisible = input.workedAnswerVisible ?? false;
  const appWasBackgrounded = input.appWasBackgrounded ?? false;
  const interruptionDurationMs = Math.max(
    0,
    input.interruptionDurationMs ?? 0,
  );
  const reliable = recognitionIsReliable(confidence, margin);
  const recognitionUsable = reliable || confirmed || recognizerCorrection;
  const answerRevealing = hintLevel >= 3 || workedAnswerVisible;
  const substantiallyInterrupted =
    appWasBackgrounded ||
    pauseUsed ||
    interruptionDurationMs > SUBSTANTIAL_INTERRUPTION_MS;
  const independent =
    !skipped &&
    recognitionUsable &&
    !answerRevealing &&
    !substantiallyInterrupted;
  const responseMs = skipped
    ? null
    : elapsed(input.submittedAt, input.shownAt);
  const firstInkLatencyMs =
    firstInkAt === null ? null : elapsed(firstInkAt, input.shownAt);
  const writingDurationMs =
    firstInkAt === null ? null : elapsed(input.submittedAt, firstInkAt);
  const timingEligible =
    independent &&
    input.firstAttemptCorrect &&
    reliable &&
    !confirmed &&
    !recognizerCorrection &&
    !pauseUsed &&
    !appWasBackgrounded &&
    interruptionDurationMs === 0 &&
    responseMs !== null;

  return {
    id: `${input.sessionId}:attempt:${input.sessionPosition}:${input.problem.id}`,
    learnerId: input.learnerId,
    sessionId: input.sessionId,
    problemId: input.problem.id,
    problem: input.problem,
    problemSeed: input.problem.seed,
    problemFingerprint: input.problem.fingerprint,
    skillId: input.problem.skillId,
    supportingSkillIds: input.problem.supportingSkillIds,
    operands: input.problem.operands,
    metadata: input.problem.metadata,
    sessionPosition: input.sessionPosition,
    sessionLane: input.sessionLane ?? "focus",
    relatedProblemId: input.relatedProblemId ?? null,
    relatedProblemRelation: input.relatedProblemRelation ?? null,
    shownAt: input.shownAt,
    firstInkAt,
    submittedAt: input.submittedAt,
    responseMs,
    firstInkLatencyMs,
    writingDurationMs,
    appWasBackgrounded,
    interruptionDurationMs,
    timingEligible,
    rawRecognizedValue: input.rawRecognizedValue ?? null,
    normalizedRecognizedValue: input.answer,
    recognitionConfidence: confidence,
    recognitionMargin: margin,
    recognitionConfirmedByChild: confirmed,
    recognizerCorrection,
    expectedAnswer: input.problem.expectedAnswer,
    firstAttemptCorrect: input.firstAttemptCorrect,
    eventuallyCorrect:
      input.eventuallyCorrect ?? input.firstAttemptCorrect,
    independent,
    hintLevelUsed: hintLevel,
    correctionCount: Math.max(0, input.correctionCount ?? 0),
    skipped,
    pauseUsed,
    workedAnswerVisible,
    errorCode: input.errorCode ?? null,
    diagnosticProbeResult: input.diagnosticProbeResult ?? null,
    format: input.problem.metadata.format,
    operation: input.problem.metadata.operation,
  };
}

/**
 * Resolve an original miss without rewriting it. A successful component probe
 * diagnoses the miss; only a correct fresh integrated retry solves it.
 */
export function attemptWasEventuallyCorrect(
  attempt: AttemptEvent,
  attempts: readonly AttemptEvent[],
): boolean {
  return (
    attempt.eventuallyCorrect ||
    attempts.some(
      (candidate) =>
        candidate.relatedProblemRelation === "delayed_retry" &&
        candidate.relatedProblemId === attempt.problemId &&
        candidate.skillId === attempt.skillId &&
        candidate.firstAttemptCorrect &&
        !candidate.skipped &&
        candidate.submittedAt >= attempt.submittedAt,
    )
  );
}

export type RecognitionEventInput = Readonly<{
  kind: RecognitionEventKind;
  learnerId: string;
  sessionId: string;
  problemId: string;
  occurredAt: number;
  rawRecognizedValue: string | null;
  normalizedRecognizedValue: ProblemAnswer | null;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  confirmedByChild: boolean;
  correctedValue?: ProblemAnswer;
}>;

export function createRecognitionEvent(
  input: RecognitionEventInput,
): RecognitionEvent {
  return {
    id: `${input.sessionId}:recognition:${input.problemId}:${input.occurredAt}:${
      input.kind
    }`,
    ...input,
  };
}
