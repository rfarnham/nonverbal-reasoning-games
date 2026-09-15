import {
  G1_SKILLS,
  type G1SkillId,
} from "./g1-curriculum.ts";
import {
  evaluateG1Answer,
  factKeyForQuestion,
  factUniverseForSkill,
  g1AssessmentQuestionSetFingerprint,
  g1QuestionMathematicalFingerprint,
  g1QuestionSnapshotIsSemanticallyValid,
  requiredCoverageKeysForSkill,
} from "./generator.ts";
import type { MasteryProfile, QuestionInstance, SkillDefinition } from "./types.ts";

export const G1_MASTERY_POLICY_VERSION = 1 as const;
export const RETENTION_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
export const DAY_MS = 24 * 60 * 60 * 1_000;

export type RetentionIntervalDays = (typeof RETENTION_INTERVAL_DAYS)[number];
export type G1MasteryState =
  | "LOCKED"
  | "AVAILABLE"
  | "LEARNING"
  | "PRACTICING"
  | "FLUENT"
  | "RETAINED"
  | "REVIEW_DUE";

export type G1InputMode = "tap" | "keyboard" | "handwriting" | "speech";
export type G1SessionKind =
  | "practice"
  | "review"
  | "assessment"
  | "retention";
export type MathematicalEvaluation = "correct" | "incorrect" | "not_evaluated";
export type RecognitionStatus =
  | "not_applicable"
  | "accepted"
  | "failed"
  | "confirmed"
  | "corrected";
export type G1AnswerValue = string | number | null;
export type G1DifficultyBand = QuestionInstance["difficultyBand"];

export const G1_GLOBAL_DIAGNOSTIC_TAGS = Object.freeze([
  "unclassified_math_error",
  "content_gap_after_three_same_structure_attempts",
] as const);

export const G1_STRATEGY_TAGS = Object.freeze([
  "count_all",
  "count_on",
  "make_ten",
  "doubles",
  "near_doubles",
  "fact_recall",
  "decompose",
  "standard_algorithm",
  "inverse_relationship",
  "equal_groups",
  "sharing",
  "grouping",
] as const);

export const G1_METHOD_TAGS = Object.freeze([
  "recognition",
  "fact_recall",
  "mental",
  "written",
  "either",
  "full_written_algorithm",
] as const);

export type G1RecognitionInput = Readonly<{
  raw: string | null;
  recognizedAnswer: G1AnswerValue;
  confidence: number | null;
  margin?: number | null;
  processingMs?: number | null;
  status: Exclude<RecognitionStatus, "not_applicable">;
  confirmedAnswer?: G1AnswerValue;
}>;

export type G1AttemptSubmissionInput = Readonly<{
  submittedAt: number;
  inputMode: G1InputMode;
  rawInput: string | null;
  /** Cumulative active time at this submission, when the surface exposes it. */
  activeSolveTimeMs?: number | null;
  /** Null means no mathematical answer was submitted (for example OCR failure). */
  answer: G1AnswerValue;
  recognition?: G1RecognitionInput;
}>;

export type G1AttemptSubmission = Readonly<{
  index: number;
  submittedAt: number;
  inputMode: G1InputMode;
  rawInput: string | null;
  activeSolveTimeMs: number | null;
  answer: G1AnswerValue;
  normalizedAnswer: string | null;
  mathematicalEvaluation: MathematicalEvaluation;
  recognitionRaw: string | null;
  recognizedAnswer: G1AnswerValue;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionProcessingMs: number | null;
  recognitionStatus: RecognitionStatus;
  userConfirmedAnswer: G1AnswerValue;
}>;

export type G1AttemptEvent = Readonly<{
  eventVersion: 1;
  id: string;
  learnerId: string;
  sessionId: string;
  questionInstanceId: string;
  /** Versioned structured card snapshot keeps historical evidence replayable. */
  question: QuestionInstance;
  skillId: G1SkillId;
  timestamp: number;
  startedAt: number;
  completedAt: number;
  firstAnswer: G1AnswerValue;
  finalAnswer: G1AnswerValue;
  firstAttemptCorrect: boolean | null;
  finalCorrect: boolean | null;
  attemptCount: number;
  submissionCount: number;
  hintsRequested: number;
  hintsRequestedBeforeFirstAttempt: number;
  workedExampleShown: boolean;
  workedExampleShownBeforeFirstAttempt: boolean;
  independentFirstAttempt: boolean;
  timingEligible: boolean;
  activeSolveTimeMs: number;
  firstAttemptActiveSolveTimeMs: number | null;
  wallClockTimeMs: number;
  inputMode: G1InputMode;
  recognitionRaw: string | null;
  recognizedAnswer: G1AnswerValue;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionProcessingMs: number | null;
  recognitionConfirmed: boolean;
  recognitionConfirmedAnswer: G1AnswerValue;
  mathematicalEvaluation: MathematicalEvaluation;
  learnerConfidence: number | null;
  curriculumVersion: number;
  generatorVersion: string;
  masteryPolicyVersion: number;
  difficultyBand: G1DifficultyBand;
  difficultyFeatures: Readonly<Record<string, string | number | boolean>>;
  coverageKeys: readonly string[];
  factKey: string | null;
  sessionKind: G1SessionKind;
  retentionIntervalDays: RetentionIntervalDays | null;
  assessmentId: string | null;
  strategy: string | null;
  method: string | null;
  algorithmStructureCorrect: boolean | null;
  placeAlignmentCorrect: boolean | null;
  estimateOrInverseCheckCorrect: boolean | null;
  misconceptionTags: readonly string[];
  submissions: readonly G1AttemptSubmission[];
}>;

export type CreateG1AttemptEventInput = Readonly<{
  id?: string;
  learnerId: string;
  sessionId: string;
  question: QuestionInstance;
  startedAt: number;
  completedAt: number;
  activeSolveTimeMs: number;
  submissions: readonly G1AttemptSubmissionInput[];
  hintsRequested?: number;
  hintsRequestedBeforeFirstAttempt?: number;
  workedExampleShown?: boolean;
  workedExampleShownBeforeFirstAttempt?: boolean;
  /** Set false for redemption/re-probes that must remain instructional only. */
  independentFirstAttempt?: boolean;
  learnerConfidence?: number | null;
  masteryPolicyVersion?: number;
  coverageKeys?: readonly string[];
  factKey?: string | null;
  sessionKind?: G1SessionKind;
  retentionIntervalDays?: RetentionIntervalDays | null;
  assessmentId?: string | null;
  strategy?: string | null;
  method?: string | null;
  algorithmStructureCorrect?: boolean | null;
  placeAlignmentCorrect?: boolean | null;
  estimateOrInverseCheckCorrect?: boolean | null;
  misconceptionTags?: readonly string[];
}>;

export type MasteryThreshold = Readonly<{
  minimumIndependentAttempts: number;
  minimumSessions: number;
  minimumAccuracy: number;
  maximumMedianActiveSolveTimeMs: number | null;
  maximumP90ActiveSolveTimeMs: number | null;
  criticalSubtypeMinimumAccuracy: number | null;
  minimumOperationFamilyAccuracy: number | null;
}>;

export const MASTERY_PROFILE_THRESHOLDS: Readonly<
  Record<MasteryProfile, MasteryThreshold>
> = {
  CONCEPT: {
    minimumIndependentAttempts: 16,
    minimumSessions: 2,
    minimumAccuracy: 0.9,
    maximumMedianActiveSolveTimeMs: null,
    maximumP90ActiveSolveTimeMs: null,
    criticalSubtypeMinimumAccuracy: 0.8,
    minimumOperationFamilyAccuracy: null,
  },
  FACT: {
    minimumIndependentAttempts: 40,
    minimumSessions: 3,
    minimumAccuracy: 0.97,
    maximumMedianActiveSolveTimeMs: 3_000,
    maximumP90ActiveSolveTimeMs: 5_000,
    criticalSubtypeMinimumAccuracy: null,
    minimumOperationFamilyAccuracy: null,
  },
  MENTAL: {
    minimumIndependentAttempts: 30,
    minimumSessions: 3,
    minimumAccuracy: 0.95,
    maximumMedianActiveSolveTimeMs: 8_000,
    maximumP90ActiveSolveTimeMs: 15_000,
    criticalSubtypeMinimumAccuracy: null,
    minimumOperationFamilyAccuracy: null,
  },
  ALGO_SHORT: {
    minimumIndependentAttempts: 25,
    minimumSessions: 3,
    minimumAccuracy: 0.95,
    maximumMedianActiveSolveTimeMs: null,
    maximumP90ActiveSolveTimeMs: null,
    criticalSubtypeMinimumAccuracy: 0.9,
    minimumOperationFamilyAccuracy: null,
  },
  ALGO_LONG: {
    minimumIndependentAttempts: 20,
    minimumSessions: 3,
    minimumAccuracy: 0.95,
    maximumMedianActiveSolveTimeMs: null,
    maximumP90ActiveSolveTimeMs: null,
    criticalSubtypeMinimumAccuracy: 0.9,
    minimumOperationFamilyAccuracy: null,
  },
  RATIONAL: {
    minimumIndependentAttempts: 25,
    minimumSessions: 3,
    minimumAccuracy: 0.95,
    maximumMedianActiveSolveTimeMs: null,
    maximumP90ActiveSolveTimeMs: null,
    criticalSubtypeMinimumAccuracy: 0.9,
    minimumOperationFamilyAccuracy: null,
  },
  MIXED: {
    minimumIndependentAttempts: 30,
    minimumSessions: 3,
    minimumAccuracy: 0.92,
    maximumMedianActiveSolveTimeMs: null,
    maximumP90ActiveSolveTimeMs: null,
    criticalSubtypeMinimumAccuracy: null,
    minimumOperationFamilyAccuracy: 0.85,
  },
};

export type G1SkillMasteryView = Readonly<{
  skillId: G1SkillId;
  state: G1MasteryState;
  unlocked: boolean;
  independentAttempts: number;
  recentIndependentAttempts: number;
  correctAttempts: number;
  accuracy: number | null;
  sessionCount: number;
  medianActiveSolveTimeMs: number | null;
  p90ActiveSolveTimeMs: number | null;
  currentBand: G1DifficultyBand;
  coverageObserved: readonly string[];
  coverageMissing: readonly string[];
  coverageSatisfied: boolean;
  criticalSubtypeFailures: readonly string[];
  factUniversePresented: number;
  factUniverseSize: number;
  factUniverseComplete: boolean;
  fluentAt: number | null;
  retainedAt: number | null;
  nextReviewAt: number | null;
  completedRetentionIntervals: readonly RetentionIntervalDays[];
  retentionAccuracy: number | null;
  firstTryTrend: "improving" | "steady" | "regressing" | "insufficient_data";
}>;

export type GradeAssessmentEvidence = Readonly<{
  assessmentId: string;
  planFingerprint: string;
  balanced: boolean;
  accuracy: number;
  domainAccuracy: Readonly<Record<string, number>>;
  domainCounts: Readonly<Record<string, number>>;
  questionCount: number;
}>;

export type G1GradeProgress = Readonly<{
  grade: 1;
  complete: boolean;
  coreSkillCount: number;
  coreFluentCount: number;
  coreRetainedCount: number;
  retainedRatio: number;
  allCoreFluent: boolean;
  retentionRequirementMet: boolean;
  assessmentPassed: boolean;
  majorDomainsPassed: boolean;
  stretchSkillStates: Readonly<Partial<Record<G1SkillId, G1MasteryState>>>;
}>;

export type G1LearnerModel = Readonly<{
  learnerId: string;
  asOf: number;
  skills: Readonly<Record<G1SkillId, G1SkillMasteryView>>;
  grade: G1GradeProgress;
  eventCount: number;
}>;

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be non-empty.`);
  return normalized;
}

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  const result = nonnegative(value, label);
  if (!Number.isInteger(result)) throw new RangeError(`${label} must be an integer.`);
  return result;
}

function normalizedConfidence(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Recognition confidence must be between 0 and 1.");
  }
  return value;
}

function normalizedOptionalDuration(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return nonnegative(value, "Recognition processing time");
}

function uniqueText(values: readonly string[] | undefined): readonly string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function answerForEvaluation(submission: G1AttemptSubmissionInput): G1AnswerValue {
  if (submission.answer !== null) return submission.answer;
  const recognition = submission.recognition;
  if (!recognition || recognition.status === "failed") return null;
  if (
    (recognition.status === "confirmed" || recognition.status === "corrected") &&
    recognition.confirmedAnswer !== undefined
  ) {
    return recognition.confirmedAnswer;
  }
  return recognition.status === "accepted" ? recognition.recognizedAnswer : null;
}

function normalizedEvaluationAnswer(evaluation: unknown): string | null {
  if (!evaluation || typeof evaluation !== "object") return null;
  const record = evaluation as Record<string, unknown>;
  const value =
    record.normalizedSubmission ??
    record.normalizedAnswer ??
    record.normalizedSubmittedAnswer;
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function coverageFromQuestion(question: QuestionInstance): readonly string[] {
  return [...new Set(question.coverageTags)].sort();
}

function factKeyFromQuestion(question: QuestionInstance): string | null {
  return factKeyForQuestion(question);
}

export function createG1AttemptEvent(input: CreateG1AttemptEventInput): G1AttemptEvent {
  const learnerId = requiredText(input.learnerId, "Learner ID");
  const sessionId = requiredText(input.sessionId, "Session ID");
  const startedAt = nonnegative(input.startedAt, "Attempt start time");
  const completedAt = nonnegative(input.completedAt, "Attempt completion time");
  if (completedAt < startedAt) {
    throw new RangeError("Attempt completion time cannot precede its start time.");
  }
  const rawActiveSolveTimeMs = nonnegative(input.activeSolveTimeMs, "Active solve time");
  const wallClockTimeMs = completedAt - startedAt;
  // performance.now() and Date.now() have different precision. Clamp the
  // sub-second edge instead of rejecting an otherwise sound browser event.
  if (rawActiveSolveTimeMs > wallClockTimeMs + 1_000) {
    throw new RangeError("Active solve time cannot exceed wall-clock time.");
  }
  const activeSolveTimeMs = Math.min(rawActiveSolveTimeMs, wallClockTimeMs);
  if (!input.submissions.length) {
    throw new TypeError("An attempt event requires at least one raw submission.");
  }

  let previousRawSubmissionActiveSolveTimeMs = 0;
  const submissions = input.submissions.map((submission, index): G1AttemptSubmission => {
    const submittedAt = nonnegative(submission.submittedAt, "Submission time");
    if (submittedAt < startedAt || submittedAt > completedAt) {
      throw new RangeError("Submission time must fall inside the attempt window.");
    }
    if (index > 0 && submittedAt < input.submissions[index - 1]!.submittedAt) {
      throw new RangeError("Raw submissions must be chronological.");
    }
    const answer = answerForEvaluation(submission);
    const evaluation = answer === null ? null : evaluateG1Answer(input.question, answer);
    const correct = evaluation === null ? null : Boolean(evaluation.correct);
    const recognition = submission.recognition;
    const rawSubmissionActiveSolveTimeMs = normalizedOptionalDuration(
      submission.activeSolveTimeMs,
    );
    if (
      rawSubmissionActiveSolveTimeMs !== null &&
      (rawSubmissionActiveSolveTimeMs < previousRawSubmissionActiveSolveTimeMs ||
        rawSubmissionActiveSolveTimeMs > rawActiveSolveTimeMs)
    ) {
      throw new RangeError(
        "Submission active solve times must be cumulative and cannot exceed the attempt total.",
      );
    }
    if (rawSubmissionActiveSolveTimeMs !== null) {
      previousRawSubmissionActiveSolveTimeMs = rawSubmissionActiveSolveTimeMs;
    }
    return {
      index,
      submittedAt,
      inputMode: submission.inputMode,
      rawInput: submission.rawInput,
      // The browser measures active time with performance.now() but brackets
      // the persisted wall-clock interval with integer Date.now() values. At a
      // millisecond boundary the high-resolution value can be fractionally
      // larger than that wall interval. Normalize builder input once so the
      // emitted snapshot is internally exact; persisted-event validation stays
      // strict and never repairs independently tampered timing fields.
      activeSolveTimeMs:
        rawSubmissionActiveSolveTimeMs === null
          ? null
          : Math.min(rawSubmissionActiveSolveTimeMs, activeSolveTimeMs),
      answer,
      normalizedAnswer: normalizedEvaluationAnswer(evaluation),
      mathematicalEvaluation:
        correct === null ? "not_evaluated" : correct ? "correct" : "incorrect",
      recognitionRaw: recognition?.raw ?? null,
      recognizedAnswer: recognition?.recognizedAnswer ?? null,
      recognitionConfidence: normalizedConfidence(recognition?.confidence),
      recognitionMargin: normalizedConfidence(recognition?.margin),
      recognitionProcessingMs: normalizedOptionalDuration(recognition?.processingMs),
      recognitionStatus: recognition?.status ?? "not_applicable",
      userConfirmedAnswer: recognition?.confirmedAnswer ?? null,
    };
  });
  const mathematicalSubmissions = submissions.filter(
    ({ mathematicalEvaluation }) => mathematicalEvaluation !== "not_evaluated",
  );
  const first = mathematicalSubmissions[0] ?? null;
  const final = mathematicalSubmissions.at(-1) ?? null;
  const recognitionSubmission = [...submissions]
    .reverse()
    .find(({ recognitionStatus }) => recognitionStatus !== "not_applicable") ?? null;
  const hintsRequested = nonnegativeInteger(input.hintsRequested ?? 0, "Hints requested");
  const hintsBefore = nonnegativeInteger(
    input.hintsRequestedBeforeFirstAttempt ?? hintsRequested,
    "Hints requested before first attempt",
  );
  const workedExampleShown = input.workedExampleShown ?? false;
  const workedBefore = input.workedExampleShownBeforeFirstAttempt ?? workedExampleShown;
  const canonicalCoverageKeys = coverageFromQuestion(input.question);
  // Legacy callers may still pass a subset, but mastery coverage is always
  // derived from the immutable question snapshot rather than caller metadata.
  const coverageKeys = canonicalCoverageKeys;
  const derivedFactKey = factKeyFromQuestion(input.question);
  if (
    input.factKey !== undefined &&
    input.factKey !== null &&
    input.factKey !== derivedFactKey
  ) {
    throw new TypeError("Fact identity must match the resolved question.");
  }
  const id = requiredText(
    input.id ?? `${sessionId}:${input.question.instanceId}:${completedAt}`,
    "Attempt event ID",
  );
  const firstCorrect =
    first?.mathematicalEvaluation === "correct"
      ? true
      : first?.mathematicalEvaluation === "incorrect"
        ? false
        : null;
  const finalCorrect =
    final?.mathematicalEvaluation === "correct"
      ? true
      : final?.mathematicalEvaluation === "incorrect"
        ? false
        : null;
  const independentlyEligible =
    first !== null && hintsBefore === 0 && workedBefore === false;
  if (input.independentFirstAttempt === true && !independentlyEligible) {
    throw new TypeError(
      "Hinted, worked-example, or unevaluated work cannot be forced into independent evidence.",
    );
  }
  const strategy = input.strategy?.trim() || null;
  const method = input.method?.trim() || null;
  const misconceptionTags = uniqueText(input.misconceptionTags);
  const skill = G1_SKILLS.find(({ id: skillId }) => skillId === input.question.skillId)!;
  const allowedMisconceptions = new Set([
    ...skill.misconceptionTags,
    ...G1_GLOBAL_DIAGNOSTIC_TAGS,
  ]);
  if (strategy !== null && !G1_STRATEGY_TAGS.includes(strategy as never)) {
    throw new TypeError(`Unknown Grade 1 strategy tag: ${strategy}.`);
  }
  if (method !== null && !G1_METHOD_TAGS.includes(method as never)) {
    throw new TypeError(`Unknown Grade 1 method tag: ${method}.`);
  }
  if (misconceptionTags.some((tag) => !allowedMisconceptions.has(tag))) {
    throw new TypeError("Misconception tags must be declared by the skill or global diagnostic contract.");
  }
  const event: G1AttemptEvent = {
    eventVersion: 1,
    id,
    learnerId,
    sessionId,
    questionInstanceId: input.question.instanceId,
    question: input.question,
    skillId: input.question.skillId as G1SkillId,
    timestamp: completedAt,
    startedAt,
    completedAt,
    firstAnswer: first?.answer ?? null,
    finalAnswer: final?.answer ?? null,
    firstAttemptCorrect: firstCorrect,
    finalCorrect,
    attemptCount: mathematicalSubmissions.length,
    submissionCount: submissions.length,
    hintsRequested,
    hintsRequestedBeforeFirstAttempt: hintsBefore,
    workedExampleShown,
    workedExampleShownBeforeFirstAttempt: workedBefore,
    independentFirstAttempt:
      input.independentFirstAttempt ?? independentlyEligible,
    timingEligible:
      (input.independentFirstAttempt ?? independentlyEligible) &&
      firstCorrect === true &&
      first?.index === 0 &&
      first.recognitionStatus !== "failed",
    activeSolveTimeMs,
    firstAttemptActiveSolveTimeMs:
      first === null
        ? null
        : (first.activeSolveTimeMs ??
          (first.index === 0 ? activeSolveTimeMs : null)),
    wallClockTimeMs,
    inputMode: first?.inputMode ?? submissions[0]!.inputMode,
    recognitionRaw: recognitionSubmission?.recognitionRaw ?? null,
    recognizedAnswer: recognitionSubmission?.recognizedAnswer ?? null,
    recognitionConfidence: recognitionSubmission?.recognitionConfidence ?? null,
    recognitionMargin: recognitionSubmission?.recognitionMargin ?? null,
    recognitionProcessingMs: recognitionSubmission?.recognitionProcessingMs ?? null,
    recognitionConfirmed:
      recognitionSubmission?.recognitionStatus === "confirmed" ||
      recognitionSubmission?.recognitionStatus === "corrected",
    recognitionConfirmedAnswer: recognitionSubmission?.userConfirmedAnswer ?? null,
    mathematicalEvaluation:
      final?.mathematicalEvaluation ?? "not_evaluated",
    learnerConfidence: normalizedConfidence(input.learnerConfidence),
    curriculumVersion: input.question.curriculumVersion,
    generatorVersion: input.question.generatorVersion,
    masteryPolicyVersion:
      input.masteryPolicyVersion ?? G1_MASTERY_POLICY_VERSION,
    difficultyBand: input.question.difficultyBand,
    difficultyFeatures: { ...input.question.difficultyFeatures },
    coverageKeys,
    factKey: input.factKey ?? derivedFactKey,
    sessionKind: input.sessionKind ?? "practice",
    retentionIntervalDays: input.retentionIntervalDays ?? null,
    assessmentId: input.assessmentId?.trim() || null,
    strategy,
    method,
    algorithmStructureCorrect: input.algorithmStructureCorrect ?? null,
    placeAlignmentCorrect: input.placeAlignmentCorrect ?? null,
    estimateOrInverseCheckCorrect: input.estimateOrInverseCheckCorrect ?? null,
    misconceptionTags,
    submissions,
  };
  return deepFreeze(event);
}

function structuredG1QuestionAnswer(question: QuestionInstance): number | null {
  if (
    question.exactAnswer.kind !== "integer" ||
    !Number.isSafeInteger(question.exactAnswer.value) ||
    !question.acceptedAnswerForms.includes("integer")
  ) return null;
  const ast = question.promptAst;
  let expected: number;
  if (ast.kind === "part-whole") {
    expected = ast.total - ast.knownPart;
    if (
      ast.unknown !== "missing-part" ||
      !Number.isSafeInteger(ast.total) ||
      !Number.isSafeInteger(ast.knownPart) ||
      expected < 0
    ) return null;
  } else if (ast.kind === "equal-groups") {
    expected = ast.groupCount * ast.groupSize;
  } else if (ast.kind === "division-model") {
    if (ast.divisor === 0 || ast.dividend % ast.divisor !== 0) return null;
    expected = ast.dividend / ast.divisor;
  } else {
    const operands = ast.operands.map(({ value }) => value);
    if (!operands.length || operands.some((operand) => !Number.isSafeInteger(operand))) {
      return null;
    }
    const result = ast.operator === "+"
      ? operands.reduce((sum, operand) => sum + operand, 0)
      : ast.operator === "-"
        ? operands[0]! - operands[1]!
        : ast.operator === "×"
          ? operands.reduce((product, operand) => product * operand, 1)
          : ast.operator === "÷" && operands[1] !== 0
            ? operands[0]! / operands[1]!
            : Number.NaN;
    if (!Number.isSafeInteger(result) || ast.result.value !== result) return null;
    expected = ast.unknown === "result"
      ? result
      : operands[ast.unknown.operandIndex] ?? Number.NaN;
  }
  if (!Number.isSafeInteger(expected) || expected !== question.exactAnswer.value) {
    return null;
  }
  const operands = question.operands.map((operand) =>
    operand.kind === "integer" ? operand.value : Number.NaN,
  );
  const expectedOperands = ast.kind === "equation"
    ? ast.operands.map(({ value }) => value)
    : ast.kind === "part-whole"
      ? [ast.knownPart, expected, ast.total]
      : ast.kind === "equal-groups"
        ? [ast.groupCount, ast.groupSize]
        : [ast.dividend, ast.divisor];
  return operands.length === expectedOperands.length &&
    operands.every((operand, index) => operand === expectedOperands[index])
    ? expected
    : null;
}

function sameAnswer(left: G1AnswerValue | undefined, right: G1AnswerValue): boolean {
  return left === right;
}

function attemptSemanticsAreConsistent(
  event: Partial<G1AttemptEvent>,
  question: QuestionInstance,
  submissions: readonly G1AttemptSubmission[],
): boolean {
  try {
    if (
      structuredG1QuestionAnswer(question) === null ||
      !g1QuestionSnapshotIsSemanticallyValid(question)
    ) return false;
    let previousSubmittedAt = event.startedAt!;
    let previousActiveSolveTimeMs = 0;
    let correctMathematicalSubmissionSeen = false;
    for (const submission of submissions) {
      if (
        submission.submittedAt < event.startedAt! ||
        submission.submittedAt > event.completedAt! ||
        submission.submittedAt < previousSubmittedAt
      ) return false;
      previousSubmittedAt = submission.submittedAt;
      if (submission.activeSolveTimeMs !== null) {
        if (
          submission.activeSolveTimeMs < previousActiveSolveTimeMs ||
          submission.activeSolveTimeMs > event.activeSolveTimeMs!
        ) return false;
        previousActiveSolveTimeMs = submission.activeSolveTimeMs;
      }
      const evaluation = submission.answer === null
        ? null
        : evaluateG1Answer(question, submission.answer);
      const expectedEvaluation: MathematicalEvaluation = evaluation === null
        ? "not_evaluated"
        : evaluation.correct ? "correct" : "incorrect";
      if (
        submission.mathematicalEvaluation !== expectedEvaluation ||
        submission.normalizedAnswer !== normalizedEvaluationAnswer(evaluation)
      ) return false;
      if (expectedEvaluation !== "not_evaluated") {
        if (correctMathematicalSubmissionSeen) return false;
        if (expectedEvaluation === "correct") correctMathematicalSubmissionSeen = true;
      }
    }
    const mathematical = submissions.filter(
      ({ mathematicalEvaluation }) => mathematicalEvaluation !== "not_evaluated",
    );
    const first = mathematical[0] ?? null;
    const final = mathematical.at(-1) ?? null;
    const firstCorrect = first === null
      ? null
      : first.mathematicalEvaluation === "correct";
    const finalCorrect = final === null
      ? null
      : final.mathematicalEvaluation === "correct";
    const eligible = first !== null &&
      event.hintsRequestedBeforeFirstAttempt === 0 &&
      event.workedExampleShownBeforeFirstAttempt === false;
    const expectedFirstTime = first === null
      ? null
      : first.activeSolveTimeMs ?? (first.index === 0 ? event.activeSolveTimeMs! : null);
    const recognition = [...submissions].reverse().find(
      ({ recognitionStatus }) => recognitionStatus !== "not_applicable",
    ) ?? null;
    return (
      sameAnswer(event.firstAnswer, first?.answer ?? null) &&
      sameAnswer(event.finalAnswer, final?.answer ?? null) &&
      event.firstAttemptCorrect === firstCorrect &&
      event.finalCorrect === finalCorrect &&
      event.attemptCount === mathematical.length &&
      event.submissionCount === submissions.length &&
      event.mathematicalEvaluation === (final?.mathematicalEvaluation ?? "not_evaluated") &&
      event.inputMode === (first?.inputMode ?? submissions[0]!.inputMode) &&
      (!event.independentFirstAttempt || eligible) &&
      event.timingEligible === (
        event.independentFirstAttempt === true &&
        firstCorrect === true &&
        first?.index === 0 &&
        first.recognitionStatus !== "failed"
      ) &&
      (!event.timingEligible || (
        mathematical.length === 1 &&
        event.firstAttemptActiveSolveTimeMs === event.activeSolveTimeMs &&
        (first?.activeSolveTimeMs === null ||
          first?.activeSolveTimeMs === event.activeSolveTimeMs)
      )) &&
      event.firstAttemptActiveSolveTimeMs === expectedFirstTime &&
      event.activeSolveTimeMs! <= event.wallClockTimeMs! &&
      event.hintsRequestedBeforeFirstAttempt! <= event.hintsRequested! &&
      event.recognitionRaw === (recognition?.recognitionRaw ?? null) &&
      sameAnswer(event.recognizedAnswer, recognition?.recognizedAnswer ?? null) &&
      event.recognitionConfidence === (recognition?.recognitionConfidence ?? null) &&
      event.recognitionMargin === (recognition?.recognitionMargin ?? null) &&
      event.recognitionProcessingMs === (recognition?.recognitionProcessingMs ?? null) &&
      event.recognitionConfirmed === (
        recognition?.recognitionStatus === "confirmed" ||
        recognition?.recognitionStatus === "corrected"
      ) &&
      sameAnswer(
        event.recognitionConfirmedAnswer,
        recognition?.userConfirmedAnswer ?? null,
      ) &&
      event.difficultyBand === question.difficultyBand &&
      JSON.stringify(event.difficultyFeatures) === JSON.stringify(question.difficultyFeatures) &&
      JSON.stringify(event.coverageKeys) === JSON.stringify(coverageFromQuestion(question)) &&
      event.factKey === factKeyFromQuestion(question)
    );
  } catch {
    return false;
  }
}

export function isG1AttemptEvent(value: unknown): value is G1AttemptEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<G1AttemptEvent>;
  const answer = (item: unknown) =>
    item === null ||
    typeof item === "string" ||
    (typeof item === "number" && Number.isFinite(item));
  const finiteNonnegative = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0;
  const integerNonnegative = (item: unknown) =>
    finiteNonnegative(item) && Number.isInteger(item);
  const confidence = (item: unknown) =>
    item === null ||
    (typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1);
  const nullableBoolean = (item: unknown) => item === null || typeof item === "boolean";
  const nullableText = (item: unknown) => item === null || typeof item === "string";
  const stringArray = (item: unknown) =>
    Array.isArray(item) && item.every((entry) => typeof entry === "string");
  const modes: readonly G1InputMode[] = ["tap", "keyboard", "handwriting", "speech"];
  const evaluations: readonly MathematicalEvaluation[] = [
    "correct",
    "incorrect",
    "not_evaluated",
  ];
  const recognitionStatuses: readonly RecognitionStatus[] = [
    "not_applicable",
    "accepted",
    "failed",
    "confirmed",
    "corrected",
  ];
  const sessionKinds: readonly G1SessionKind[] = [
    "practice",
    "review",
    "assessment",
    "retention",
  ];
  const submissionsValid =
    Array.isArray(event.submissions) &&
    event.submissions.every((submission, index) =>
      submission !== null &&
      typeof submission === "object" &&
      submission.index === index &&
      finiteNonnegative(submission.submittedAt) &&
      modes.includes(submission.inputMode) &&
      nullableText(submission.rawInput) &&
      (submission.activeSolveTimeMs === null ||
        finiteNonnegative(submission.activeSolveTimeMs)) &&
      answer(submission.answer) &&
      nullableText(submission.normalizedAnswer) &&
      evaluations.includes(submission.mathematicalEvaluation) &&
      nullableText(submission.recognitionRaw) &&
      answer(submission.recognizedAnswer) &&
      confidence(submission.recognitionConfidence) &&
      confidence(submission.recognitionMargin) &&
      (submission.recognitionProcessingMs === null ||
        finiteNonnegative(submission.recognitionProcessingMs)) &&
      recognitionStatuses.includes(submission.recognitionStatus) &&
      answer(submission.userConfirmedAnswer),
    );
  const featureRecord =
    event.difficultyFeatures !== null &&
    typeof event.difficultyFeatures === "object" &&
    !Array.isArray(event.difficultyFeatures) &&
    Object.values(event.difficultyFeatures).every(
      (item) =>
        typeof item === "string" ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)),
    );
  const question =
    event.question !== null &&
    typeof event.question === "object" &&
    !Array.isArray(event.question)
      ? event.question
      : null;
  const skill = typeof event.skillId === "string"
    ? G1_SKILLS.find(({ id }) => id === event.skillId)
    : undefined;
  const diagnosticTagsValid =
    skill !== undefined &&
    Array.isArray(event.misconceptionTags) &&
    event.misconceptionTags.every((tag) =>
      skill.misconceptionTags.includes(tag) ||
      G1_GLOBAL_DIAGNOSTIC_TAGS.includes(tag as never),
    );
  const semanticConsistency =
    submissionsValid &&
    question !== null &&
    Array.isArray(event.submissions) &&
    attemptSemanticsAreConsistent(
      event,
      question as QuestionInstance,
      event.submissions as readonly G1AttemptSubmission[],
    );
  return (
    event.eventVersion === 1 &&
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.learnerId === "string" &&
    typeof event.sessionId === "string" &&
    typeof event.questionInstanceId === "string" &&
    question !== null &&
    question.instanceId === event.questionInstanceId &&
    question.skillId === event.skillId &&
    typeof question.seed === "string" &&
    question.seed.length > 0 &&
    question.curriculumVersion === event.curriculumVersion &&
    question.generatorVersion === event.generatorVersion &&
    typeof event.skillId === "string" &&
    skill !== undefined &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp) &&
    finiteNonnegative(event.startedAt) &&
    finiteNonnegative(event.completedAt) &&
    event.completedAt! >= event.startedAt! &&
    event.timestamp === event.completedAt &&
    answer(event.firstAnswer) &&
    answer(event.finalAnswer) &&
    (event.firstAttemptCorrect === null || typeof event.firstAttemptCorrect === "boolean") &&
    (event.finalCorrect === null || typeof event.finalCorrect === "boolean") &&
    integerNonnegative(event.attemptCount) &&
    integerNonnegative(event.submissionCount) &&
    event.submissionCount === event.submissions?.length &&
    integerNonnegative(event.hintsRequested) &&
    integerNonnegative(event.hintsRequestedBeforeFirstAttempt) &&
    typeof event.workedExampleShown === "boolean" &&
    typeof event.workedExampleShownBeforeFirstAttempt === "boolean" &&
    typeof event.independentFirstAttempt === "boolean" &&
    typeof event.timingEligible === "boolean" &&
    finiteNonnegative(event.activeSolveTimeMs) &&
    (event.firstAttemptActiveSolveTimeMs === null ||
      finiteNonnegative(event.firstAttemptActiveSolveTimeMs)) &&
    finiteNonnegative(event.wallClockTimeMs) &&
    event.wallClockTimeMs === event.completedAt! - event.startedAt! &&
    modes.includes(event.inputMode!) &&
    nullableText(event.recognitionRaw) &&
    answer(event.recognizedAnswer) &&
    confidence(event.recognitionConfidence) &&
    confidence(event.recognitionMargin) &&
    (event.recognitionProcessingMs === null ||
      finiteNonnegative(event.recognitionProcessingMs)) &&
    typeof event.recognitionConfirmed === "boolean" &&
    answer(event.recognitionConfirmedAnswer) &&
    evaluations.includes(event.mathematicalEvaluation!) &&
    confidence(event.learnerConfidence) &&
    integerNonnegative(event.curriculumVersion) &&
    typeof event.generatorVersion === "string" &&
    event.generatorVersion.length > 0 &&
    integerNonnegative(event.masteryPolicyVersion) &&
    [1, 2, 3, 4].includes(event.difficultyBand!) &&
    featureRecord &&
    stringArray(event.coverageKeys) &&
    nullableText(event.factKey) &&
    sessionKinds.includes(event.sessionKind!) &&
    (event.retentionIntervalDays === null ||
      RETENTION_INTERVAL_DAYS.includes(event.retentionIntervalDays!)) &&
    nullableText(event.assessmentId) &&
    nullableText(event.strategy) &&
    (event.strategy === null || G1_STRATEGY_TAGS.includes(event.strategy as never)) &&
    nullableText(event.method) &&
    (event.method === null || G1_METHOD_TAGS.includes(event.method as never)) &&
    nullableBoolean(event.algorithmStructureCorrect) &&
    nullableBoolean(event.placeAlignmentCorrect) &&
    nullableBoolean(event.estimateOrInverseCheckCorrect) &&
    stringArray(event.misconceptionTags) &&
    diagnosticTagsValid &&
    submissionsValid &&
    semanticConsistency
  );
}

export function freezeG1AttemptEvent(event: G1AttemptEvent): G1AttemptEvent {
  if (!isG1AttemptEvent(event)) throw new TypeError("Invalid Grade 1 attempt event.");
  return deepFreeze(event);
}

export function isIndependentMasteryEvidence(event: G1AttemptEvent): boolean {
  return (
    event.independentFirstAttempt &&
    event.firstAttemptCorrect !== null &&
    event.mathematicalEvaluation !== "not_evaluated"
  );
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  if (quantile === 0.5 && ordered.length % 2 === 0) {
    const upper = ordered.length / 2;
    return (ordered[upper - 1]! + ordered[upper]!) / 2;
  }
  const rank = Math.ceil(quantile * ordered.length) - 1;
  return ordered[Math.max(0, Math.min(rank, ordered.length - 1))]!;
}

function accuracy(events: readonly G1AttemptEvent[]): number | null {
  if (!events.length) return null;
  return events.filter(({ firstAttemptCorrect }) => firstAttemptCorrect).length / events.length;
}

function trendFor(events: readonly G1AttemptEvent[]): G1SkillMasteryView["firstTryTrend"] {
  if (events.length < 8) return "insufficient_data";
  const midpoint = Math.floor(events.length / 2);
  const older = accuracy(events.slice(0, midpoint)) ?? 0;
  const newer = accuracy(events.slice(midpoint)) ?? 0;
  if (newer - older >= 0.08) return "improving";
  if (older - newer >= 0.08) return "regressing";
  return "steady";
}

function coverageAccuracy(
  evidence: readonly G1AttemptEvent[],
  key: string,
): number | null {
  return accuracy(evidence.filter(({ coverageKeys }) => coverageKeys.includes(key)));
}

function timeNotRegressing(events: readonly G1AttemptEvent[]): boolean {
  const timings = events
    .filter(({ firstAttemptCorrect, timingEligible }) =>
      firstAttemptCorrect && timingEligible,
    )
    .map(({ firstAttemptActiveSolveTimeMs, activeSolveTimeMs }) =>
      firstAttemptActiveSolveTimeMs ?? activeSolveTimeMs,
    );
  if (timings.length < 8) return true;
  const midpoint = Math.floor(timings.length / 2);
  const older = percentile(timings.slice(0, midpoint), 0.5) ?? 0;
  const newer = percentile(timings.slice(midpoint), 0.5) ?? 0;
  return older === 0 || newer <= older * 1.25;
}

function masteryGate(
  skill: SkillDefinition,
  evidence: readonly G1AttemptEvent[],
): {
  passed: boolean;
  recent: readonly G1AttemptEvent[];
  coverageMissing: readonly string[];
  criticalFailures: readonly string[];
} {
  const threshold = MASTERY_PROFILE_THRESHOLDS[skill.masteryProfile];
  const recent = evidence.slice(-threshold.minimumIndependentAttempts);
  const coverageRequirements = skill.generator.coverageRequirements;
  const requiredCoverage = requiredCoverageKeysForSkill(skill.id as G1SkillId);
  const coverageMissing = coverageRequirements
    .filter((requirement) => {
      const observations = recent.filter(({ coverageKeys }) =>
        coverageKeys.includes(requirement.key),
      ).length;
      const minimumObservations = Math.max(
        1,
        Math.ceil(recent.length * requirement.minimumShare),
      );
      return observations < minimumObservations;
    })
    .map(({ key }) => key);
  const criticalFloor = threshold.criticalSubtypeMinimumAccuracy;
  const criticalCoverage = new Set(
    skill.generator.coverageRequirements
      .filter(({ critical }) => critical === true)
      .map(({ key }) => key),
  );
  const criticalFailures = criticalFloor === null
    ? []
    : requiredCoverage.filter((key) => criticalCoverage.has(key)).filter((key) => {
        const bucketAccuracy = coverageAccuracy(recent, key);
        return bucketAccuracy !== null && bucketAccuracy < criticalFloor;
      });
  const timedCorrect = recent
    .filter(({ firstAttemptCorrect, timingEligible }) =>
      firstAttemptCorrect && timingEligible,
    )
    .map(({ firstAttemptActiveSolveTimeMs, activeSolveTimeMs }) =>
      firstAttemptActiveSolveTimeMs ?? activeSolveTimeMs,
    );
  const median = percentile(timedCorrect, 0.5);
  const p90 = percentile(timedCorrect, 0.9);
  const timingSampleRequired =
    threshold.maximumMedianActiveSolveTimeMs !== null ||
    threshold.maximumP90ActiveSolveTimeMs !== null
      ? Math.ceil(threshold.minimumIndependentAttempts * 0.8)
      : 0;
  const repeatedCountAll =
    skill.masteryProfile === "FACT" &&
    recent.filter(({ strategy }) => strategy === "count_all").length >= 2;
  const fullWrittenAlgorithm =
    skill.masteryProfile === "MENTAL" &&
    recent.some(({ method }) => method === "full_written_algorithm");
  const algorithmTelemetryPasses =
    !["ALGO_SHORT", "ALGO_LONG"].includes(skill.masteryProfile) ||
    recent.every(
      ({ algorithmStructureCorrect, placeAlignmentCorrect }) =>
        algorithmStructureCorrect !== false && placeAlignmentCorrect !== false,
    );
  const longCheckPasses =
    skill.masteryProfile !== "ALGO_LONG" ||
    (recent.some(({ estimateOrInverseCheckCorrect }) =>
      estimateOrInverseCheckCorrect === true,
    ) &&
      !recent.some(({ estimateOrInverseCheckCorrect }) =>
        estimateOrInverseCheckCorrect === false,
      ));
  const repeatedOrderOfOperationsMisconception =
    skill.masteryProfile === "MIXED" &&
    recent.filter(({ misconceptionTags }) =>
      misconceptionTags.some((tag) => tag.includes("order_of_operations")),
    ).length >= 2;
  const mixedFamilyPasses = threshold.minimumOperationFamilyAccuracy === null ||
    requiredCoverage.every((key) => {
      const bucketAccuracy = coverageAccuracy(recent, key);
      return bucketAccuracy === null || bucketAccuracy >= threshold.minimumOperationFamilyAccuracy!;
    });

  return {
    passed:
      recent.length >= threshold.minimumIndependentAttempts &&
      new Set(recent.map(({ sessionId }) => sessionId)).size >= threshold.minimumSessions &&
      (accuracy(recent) ?? 0) >= threshold.minimumAccuracy &&
      timedCorrect.length >= timingSampleRequired &&
      (threshold.maximumMedianActiveSolveTimeMs === null ||
        (median !== null && median <= threshold.maximumMedianActiveSolveTimeMs)) &&
      (threshold.maximumP90ActiveSolveTimeMs === null ||
        (p90 !== null && p90 <= threshold.maximumP90ActiveSolveTimeMs)) &&
      coverageMissing.length === 0 &&
      criticalFailures.length === 0 &&
      !repeatedCountAll &&
      !fullWrittenAlgorithm &&
      algorithmTelemetryPasses &&
      longCheckPasses &&
      !repeatedOrderOfOperationsMisconception &&
      mixedFamilyPasses &&
      (skill.masteryProfile !== "ALGO_SHORT" || timeNotRegressing(recent)),
    recent,
    coverageMissing,
    criticalFailures,
  };
}

function firstFluentAt(
  skill: SkillDefinition,
  evidence: readonly G1AttemptEvent[],
): number | null {
  const minimum = MASTERY_PROFILE_THRESHOLDS[skill.masteryProfile].minimumIndependentAttempts;
  for (let length = minimum; length <= evidence.length; length += 1) {
    const prefix = evidence.slice(0, length);
    if (masteryGate(skill, prefix).passed) return prefix.at(-1)!.timestamp;
  }
  return null;
}

type RetentionResult = Readonly<{
  state: "FLUENT" | "RETAINED" | "REVIEW_DUE";
  completed: readonly RetentionIntervalDays[];
  accuracy: number | null;
  nextReviewAt: number | null;
  retainedAt: number | null;
}>;

function deriveRetention(
  fluentAt: number,
  evidence: readonly G1AttemptEvent[],
  factUniverseComplete: boolean,
  now: number,
): RetentionResult {
  const probes = evidence.filter(
    (event) => event.sessionKind === "retention" && event.timestamp >= fluentAt,
  );
  const completed: RetentionIntervalDays[] = [];
  let retainedAt: number | null = null;
  const considered: G1AttemptEvent[] = [];
  for (const interval of RETENTION_INTERVAL_DAYS) {
    const dueAt = fluentAt + interval * DAY_MS;
    const intervalProbes = probes.filter(
      (event) =>
        event.retentionIntervalDays === interval &&
        event.timestamp >= dueAt &&
        !considered.includes(event),
    );
    if (!intervalProbes.length) {
      return {
        state: now >= dueAt ? "REVIEW_DUE" : "FLUENT",
        completed,
        accuracy: accuracy(considered),
        nextReviewAt: dueAt,
        retainedAt: null,
      };
    }
    considered.push(...intervalProbes);
    if ((accuracy(intervalProbes) ?? 0) < 0.9) {
      return {
        state: "REVIEW_DUE",
        completed,
        accuracy: accuracy(considered),
        nextReviewAt: dueAt,
        retainedAt: null,
      };
    }
    completed.push(interval);
    if (interval === 30) {
      retainedAt = Math.max(...intervalProbes.map(({ timestamp }) => timestamp));
    }
  }
  const delayedAccuracy = accuracy(considered);
  const retained =
    delayedAccuracy !== null && delayedAccuracy >= 0.9 && factUniverseComplete;
  return {
    state: retained ? "RETAINED" : "FLUENT",
    completed,
    accuracy: delayedAccuracy,
    nextReviewAt: retained ? null : fluentAt + 30 * DAY_MS,
    retainedAt: retained ? retainedAt : null,
  };
}

function difficultyBandForState(state: G1MasteryState): G1DifficultyBand {
  switch (state) {
    case "LOCKED":
    case "AVAILABLE":
    case "LEARNING":
      return 1;
    case "PRACTICING":
      return 2;
    case "FLUENT":
    case "REVIEW_DUE":
      return 3;
    case "RETAINED":
      return 4;
  }
}

function deriveUnlockedSkill(
  skill: SkillDefinition,
  events: readonly G1AttemptEvent[],
  now: number,
): G1SkillMasteryView {
  const evidence = events
    .filter(
      (event) =>
        event.skillId === skill.id &&
        isIndependentMasteryEvidence(event),
    )
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  const gate = masteryGate(skill, evidence);
  const threshold = MASTERY_PROFILE_THRESHOLDS[skill.masteryProfile];
  const observed = uniqueText(evidence.flatMap(({ coverageKeys }) => coverageKeys));
  const factUniverse = factUniverseForSkill(skill.id as G1SkillId);
  const presented = new Set(evidence.map(({ factKey }) => factKey).filter((key): key is string => key !== null));
  const universePresented = factUniverse.filter((key) => presented.has(key)).length;
  const universeComplete = factUniverse.length === 0 || universePresented === factUniverse.length;
  const fluentAt = firstFluentAt(skill, evidence);
  let state: G1MasteryState;
  let retention: RetentionResult | null = null;
  // A later miss cannot erase the historical FLUENT transition. Retention
  // failures are represented explicitly as REVIEW_DUE instead.
  if (fluentAt !== null) {
    retention = deriveRetention(fluentAt, evidence, universeComplete, now);
    state = retention.state;
  } else if (!evidence.length) {
    state = "AVAILABLE";
  } else if (evidence.length < Math.max(4, Math.ceil(threshold.minimumIndependentAttempts / 3))) {
    state = "LEARNING";
  } else {
    state = "PRACTICING";
  }
  const recent = gate.recent;
  const timings = recent
    .filter(({ firstAttemptCorrect, timingEligible }) =>
      firstAttemptCorrect && timingEligible,
    )
    .map(({ firstAttemptActiveSolveTimeMs, activeSolveTimeMs }) =>
      firstAttemptActiveSolveTimeMs ?? activeSolveTimeMs,
    );
  return deepFreeze({
    skillId: skill.id as G1SkillId,
    state,
    unlocked: true,
    independentAttempts: evidence.length,
    recentIndependentAttempts: recent.length,
    correctAttempts: evidence.filter(({ firstAttemptCorrect }) => firstAttemptCorrect).length,
    accuracy: accuracy(recent),
    sessionCount: new Set(recent.map(({ sessionId }) => sessionId)).size,
    medianActiveSolveTimeMs: percentile(timings, 0.5),
    p90ActiveSolveTimeMs: percentile(timings, 0.9),
    currentBand: difficultyBandForState(state),
    coverageObserved: observed,
    coverageMissing: gate.coverageMissing,
    coverageSatisfied: gate.coverageMissing.length === 0,
    criticalSubtypeFailures: gate.criticalFailures,
    factUniversePresented: universePresented,
    factUniverseSize: factUniverse.length,
    factUniverseComplete: universeComplete,
    fluentAt,
    retainedAt: retention?.retainedAt ?? null,
    nextReviewAt: retention?.nextReviewAt ?? null,
    completedRetentionIntervals: retention?.completed ?? [],
    retentionAccuracy: retention?.accuracy ?? null,
    firstTryTrend: trendFor(recent),
  });
}

function lockedSkillView(skill: SkillDefinition): G1SkillMasteryView {
  return deepFreeze({
    skillId: skill.id as G1SkillId,
    state: "LOCKED",
    unlocked: false,
    independentAttempts: 0,
    recentIndependentAttempts: 0,
    correctAttempts: 0,
    accuracy: null,
    sessionCount: 0,
    medianActiveSolveTimeMs: null,
    p90ActiveSolveTimeMs: null,
    currentBand: 1,
    coverageObserved: [],
    coverageMissing: requiredCoverageKeysForSkill(skill.id as G1SkillId),
    coverageSatisfied: false,
    criticalSubtypeFailures: [],
    factUniversePresented: 0,
    factUniverseSize: factUniverseForSkill(skill.id as G1SkillId).length,
    factUniverseComplete: false,
    fluentAt: null,
    retainedAt: null,
    nextReviewAt: null,
    completedRetentionIntervals: [],
    retentionAccuracy: null,
    firstTryTrend: "insufficient_data",
  });
}

export function masteryStateSatisfiesPrerequisite(state: G1MasteryState): boolean {
  return state === "FLUENT" || state === "RETAINED" || state === "REVIEW_DUE";
}

export function deriveGradeCompletion(
  skills: Readonly<Record<G1SkillId, G1SkillMasteryView>>,
  assessment: GradeAssessmentEvidence | null = null,
): G1GradeProgress {
  const coreSkills = G1_SKILLS.filter(({ tier }) => tier === "core");
  const stretchSkills = G1_SKILLS.filter(({ tier }) => tier === "stretch");
  const coreViews = coreSkills.map(({ id }) => skills[id as G1SkillId]);
  const coreFluentCount = coreViews.filter(({ state }) =>
    masteryStateSatisfiesPrerequisite(state),
  ).length;
  const coreRetainedCount = coreViews.filter(({ state }) => state === "RETAINED").length;
  const retainedRatio = coreSkills.length ? coreRetainedCount / coreSkills.length : 0;
  const majorDomains = [...new Set(coreSkills.map(({ domain }) => domain))];
  const balancedAssessmentSample =
    assessment !== null &&
    assessment.balanced &&
    assessment.questionCount === majorDomains.length * 5 &&
    majorDomains.every((domain) => assessment.domainCounts[domain] === 5);
  const assessmentPassed =
    balancedAssessmentSample && assessment!.accuracy >= 0.92;
  const majorDomainsPassed =
    balancedAssessmentSample &&
    majorDomains.every(
      (domain) =>
        typeof assessment.domainAccuracy[domain] === "number" &&
        assessment.domainAccuracy[domain] >= 0.85,
    );
  const allCoreFluent = coreFluentCount === coreSkills.length;
  const retentionRequirementMet = retainedRatio >= 0.8;
  return deepFreeze({
    grade: 1,
    complete:
      allCoreFluent &&
      retentionRequirementMet &&
      assessmentPassed &&
      majorDomainsPassed,
    coreSkillCount: coreSkills.length,
    coreFluentCount,
    coreRetainedCount,
    retainedRatio,
    allCoreFluent,
    retentionRequirementMet,
    assessmentPassed,
    majorDomainsPassed,
    stretchSkillStates: Object.fromEntries(
      stretchSkills.map(({ id }) => [id, skills[id as G1SkillId].state]),
    ),
  });
}

export function deriveGradeAssessmentEvidence(
  events: readonly G1AttemptEvent[],
  assessmentId?: string,
): GradeAssessmentEvidence | null {
  const assessmentEvents = events.filter(
    (event) =>
      isG1AttemptEvent(event) &&
      event.sessionKind === "assessment" &&
      event.assessmentId !== null &&
      isIndependentMasteryEvidence(event),
  );
  const evidenceForGroup = (
    chosenId: string,
    group: readonly G1AttemptEvent[],
  ): GradeAssessmentEvidence => {
  const byDomain = new Map<string, G1AttemptEvent[]>();
  let coreOnly = true;
  for (const event of group) {
    const skill = G1_SKILLS.find(({ id }) => id === event.skillId);
    if (!skill || skill.tier !== "core") {
      coreOnly = false;
      continue;
    }
    const domain = skill.domain;
    const domainEvents = byDomain.get(domain) ?? [];
    domainEvents.push(event);
    byDomain.set(domain, domainEvents);
  }
  const majorDomains = [
    ...new Set(G1_SKILLS.filter(({ tier }) => tier === "core").map(({ domain }) => domain)),
  ];
  const domainAccuracy = Object.fromEntries(
    [...byDomain].map(([domain, domainEvents]) => [domain, accuracy(domainEvents) ?? 0]),
  );
  const domainCounts = Object.fromEntries(
    majorDomains.map((domain) => [domain, byDomain.get(domain)?.length ?? 0]),
  );
  const uniqueQuestions = new Set(group.map(({ question }) =>
    g1QuestionMathematicalFingerprint(question)));
  const planFingerprint = g1AssessmentQuestionSetFingerprint(
    group.map(({ question }) => question),
  );
  const declaredFingerprint =
    /^g1-assessment:[a-z0-9]+:([a-z0-9]+)$/.exec(chosenId)?.[1] ?? null;
  const correctBandMix = majorDomains.every((domain) => {
    const domainEvents = byDomain.get(domain) ?? [];
    return domainEvents.filter(({ difficultyBand }) => difficultyBand === 3).length === 3 &&
      domainEvents.filter(({ difficultyBand }) => difficultyBand === 4).length === 2;
  });
  const balanced =
    coreOnly &&
    group.length === majorDomains.length * 5 &&
    uniqueQuestions.size === group.length &&
    majorDomains.every((domain) => domainCounts[domain] === 5) &&
    correctBandMix &&
    declaredFingerprint === planFingerprint;
  return deepFreeze({
    assessmentId: chosenId,
    planFingerprint,
    balanced,
    accuracy: accuracy(group) ?? 0,
    domainAccuracy,
    domainCounts,
    questionCount: group.length,
  });
  };

  const explicitId = assessmentId?.trim();
  if (explicitId) {
    const group = assessmentEvents.filter(({ assessmentId: id }) => id === explicitId);
    return group.length ? evidenceForGroup(explicitId, group) : null;
  }
  const groups = new Map<string, G1AttemptEvent[]>();
  for (const event of assessmentEvents) {
    const id = event.assessmentId!;
    const group = groups.get(id) ?? [];
    group.push(event);
    groups.set(id, group);
  }
  const newestFirst = [...groups].sort(
    (left, right) =>
      Math.max(...right[1].map(({ timestamp }) => timestamp)) -
        Math.max(...left[1].map(({ timestamp }) => timestamp)) ||
      right[0].localeCompare(left[0]),
  );
  let newestIncomplete: GradeAssessmentEvidence | null = null;
  for (const [id, group] of newestFirst) {
    const evidence = evidenceForGroup(id, group);
    newestIncomplete ??= evidence;
    if (evidence.balanced) return evidence;
  }
  return newestIncomplete;
}

export function deriveG1LearnerModel(
  events: readonly G1AttemptEvent[],
  now = Date.now(),
  learnerId?: string,
  assessment: GradeAssessmentEvidence | null = null,
): G1LearnerModel {
  const asOf = nonnegative(now, "Learner-model time");
  const chosenLearnerId = learnerId?.trim() || events[0]?.learnerId || "device-learner";
  const learnerEvents = events.filter(({ learnerId: eventLearnerId }) =>
    eventLearnerId === chosenLearnerId,
  );
  const partial: Partial<Record<G1SkillId, G1SkillMasteryView>> = {};
  const pending = [...G1_SKILLS];
  while (pending.length) {
    const readyIndex = pending.findIndex(({ prerequisites }) =>
      prerequisites.every((id) => partial[id as G1SkillId] !== undefined),
    );
    if (readyIndex < 0) throw new Error("Grade 1 prerequisite graph is not acyclic.");
    const [skill] = pending.splice(readyIndex, 1);
    const unlocked = skill!.prerequisites.every((id) =>
      masteryStateSatisfiesPrerequisite(partial[id as G1SkillId]!.state),
    );
    partial[skill!.id as G1SkillId] = unlocked
      ? deriveUnlockedSkill(skill!, learnerEvents, asOf)
      : lockedSkillView(skill!);
  }
  const skills = partial as Record<G1SkillId, G1SkillMasteryView>;
  const resolvedAssessment =
    assessment ?? deriveGradeAssessmentEvidence(learnerEvents);
  return deepFreeze({
    learnerId: chosenLearnerId,
    asOf,
    skills,
    grade: deriveGradeCompletion(skills, resolvedAssessment),
    eventCount: learnerEvents.length,
  });
}

/** Replaying immutable events is the only way learner state is produced. */
export const replayG1LearnerEvidence = deriveG1LearnerModel;
export const replayLearnerState = deriveG1LearnerModel;
