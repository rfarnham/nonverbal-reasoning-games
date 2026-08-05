/**
 * Shared, JSON-safe domain contracts for the adaptive subtraction curriculum.
 *
 * Pure generation, planning, mastery, scheduling, and persistence modules all
 * depend on this file. Keep browser APIs and executable behavior out of it.
 */

export type SkillId =
  | "F01"
  | "F02"
  | "F03"
  | "F04"
  | "F05"
  | "R01"
  | "R02"
  | "R03"
  | "R04"
  | "R05"
  | "A01"
  | "A02"
  | "A03"
  | "A04"
  | "A05"
  | "A06"
  | "T01"
  | "T02"
  | "T03"
  | "T04"
  | "T05";

export type SkillTrack = "facts" | "regrouping" | "application" | "transfer";

export type SkillKind = "fact" | "micro_step" | "full_problem" | "transfer";

export type ConceptStatus = "locked" | "diagnostic" | "learning" | "mastered";

export type FluencyStatus =
  | "not_started"
  | "developing"
  | "smooth"
  | "maintenance"
  | "plateau";

export type ErrorCode =
  | "recognition_uncertain"
  | "wrong_operation"
  | "fact_retrieval_error"
  | "regrouping_not_detected"
  | "unnecessary_regrouping"
  | "forgot_to_decrement_tens"
  | "regrouped_state_lost"
  | "ones_digit_error"
  | "tens_digit_error"
  | "place_value_assembly_error"
  | "digit_transposition"
  | "copy_or_alignment_error"
  | "execution_slip"
  | "fatigue_related_error"
  | "unclassified_math_error";

export type ProblemFormat = "horizontal" | "vertical";
export type ArithmeticOperation = "addition" | "subtraction";
export type ProblemAnswer = number | "yes" | "no";
export type AttemptRelationKind = "remediation_probe" | "delayed_retry";

export interface MasteryPolicy {
  minIndependentAttempts: number;
  minSessions: number;
  weightedAccuracyThreshold: number;
  recentWindowSize: number;
  recentCorrectRequired: number;
  maxRepeatedMisconceptionCount: number;
}

export interface SkillDefinition {
  id: SkillId;
  title: string;
  childFacingTitle: string;
  description: string;
  track: SkillTrack;
  kind: SkillKind;
  prerequisites: readonly SkillId[];
  remediationSkillIds: readonly SkillId[];
  difficultyBands: readonly number[];
  masteryPolicy: MasteryPolicy;
  tags: readonly string[];
  /** T04 is implemented but intentionally excluded from normal plans. */
  enabledByDefault: boolean;
  generatorId: SkillId;
}

export type MissingEquationTerm = "left" | "right" | "result";

export interface EquationMathSpec {
  kind: "equation";
  left: number | null;
  operator: "+" | "-";
  right: number | null;
  result: number | null;
  missing: MissingEquationTerm;
}

export interface RegroupingDecisionMathSpec {
  kind: "regrouping-decision";
  minuend: number;
  subtrahend: number;
}

export type PlaceValueQuestion =
  | "renamed_tens"
  | "renamed_ones"
  | "ones_after_regrouping"
  | "tens_after_regrouping"
  | "assembled_value";

export interface PlaceValueMathSpec {
  kind: "place-value";
  whole: number;
  originalTens: number;
  originalOnes: number;
  renamedTens?: number;
  renamedOnes?: number;
  subtrahendTens?: number;
  subtrahendOnes?: number;
  answerTens?: number;
  answerOnes?: number;
  question: PlaceValueQuestion;
}

export interface RepairMathSpec {
  kind: "repair";
  minuend: number;
  subtrahend: number;
  operation: ArithmeticOperation;
  shownAnswer: number;
  misconception: ErrorCode;
}

export type ProblemMathSpec =
  | EquationMathSpec
  | RegroupingDecisionMathSpec
  | PlaceValueMathSpec
  | RepairMathSpec;

export interface NumericPromptSpec {
  kind: "numeric";
  instruction: string;
  format: ProblemFormat;
  /** A text fallback; renderers should prefer the structured math field. */
  displayText: string;
  math: ProblemMathSpec;
}

export interface TwoChoiceOption {
  value: "yes" | "no";
  label: string;
}

export interface TwoChoicePromptSpec {
  kind: "two-choice";
  instruction: string;
  format: ProblemFormat;
  displayText: string;
  math: RegroupingDecisionMathSpec;
  choices: readonly [TwoChoiceOption, TwoChoiceOption];
}

export type ProblemPromptSpec = NumericPromptSpec | TwoChoicePromptSpec;

export interface NumericAnswerSpec {
  kind: "numeric";
  expected: number;
  integerOnly: true;
}

export interface TwoChoiceAnswerSpec {
  kind: "two-choice";
  expected: "yes" | "no";
}

export type ProblemAnswerSpec = NumericAnswerSpec | TwoChoiceAnswerSpec;

export interface HintStep {
  level: 1 | 2 | 3 | 4;
  kind: "nudge" | "visual" | "worked_step" | "answer";
  text: string;
  answerRevealing: boolean;
}

export interface ProblemMetadata {
  templateId: string;
  format: ProblemFormat;
  operation: ArithmeticOperation;
  requiresRegrouping?: boolean;
  minuendEndsInZero?: boolean;
  resultUnderTen?: boolean;
  missingTerm?: MissingEquationTerm;
  renameQuestion?: PlaceValueQuestion;
  misconception?: ErrorCode;
  sourceSkillId?: SkillId;
  challengeProvider?: string;
}

export interface GeneratedProblem {
  id: string;
  seed: string;
  skillId: SkillId;
  supportingSkillIds: readonly SkillId[];
  difficulty: number;
  promptSpec: ProblemPromptSpec;
  answerSpec: ProblemAnswerSpec;
  expectedAnswer: ProblemAnswer;
  operands: Readonly<Record<string, number>>;
  hints: readonly HintStep[];
  metadata: ProblemMetadata;
  fingerprint: string;
}

export interface ProblemEvaluation {
  correct: boolean;
  normalizedAnswer: ProblemAnswer | null;
  expectedAnswer: ProblemAnswer;
}

export type RecognitionEventKind =
  | "recognition_uncertain"
  | "recognition_confirmed"
  | "recognition_corrected";

export interface RecognitionEvent {
  id: string;
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
}

export interface DiagnosticProbeResult {
  /** The original problem being diagnosed, or this problem for placement. */
  probeId: string;
  outcome: "pass" | "partial" | "fail";
  /** Lets reducers wait until every planned component probe has resolved. */
  expectedProbeCount?: number;
  notes?: string;
}

export interface AttemptEvent {
  id: string;
  learnerId: string;
  sessionId: string;
  problemId: string;
  /** Full JSON-safe generated card snapshot for exact replay and migration. */
  problem: GeneratedProblem | null;
  problemSeed: string;
  problemFingerprint: string;
  skillId: SkillId;
  supportingSkillIds: readonly SkillId[];
  operands: Readonly<Record<string, number>>;
  metadata: ProblemMetadata;
  sessionPosition: number;
  sessionLane: SessionLane;
  /** Original problem linked to a probe or delayed fresh retry. */
  relatedProblemId: string | null;
  relatedProblemRelation: AttemptRelationKind | null;
  shownAt: number;
  firstInkAt: number | null;
  submittedAt: number;
  responseMs: number | null;
  firstInkLatencyMs: number | null;
  writingDurationMs: number | null;
  appWasBackgrounded: boolean;
  interruptionDurationMs: number;
  timingEligible: boolean;
  rawRecognizedValue: string | null;
  normalizedRecognizedValue: ProblemAnswer | null;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionConfirmedByChild: boolean;
  recognizerCorrection: boolean;
  expectedAnswer: ProblemAnswer;
  firstAttemptCorrect: boolean;
  eventuallyCorrect: boolean;
  independent: boolean;
  hintLevelUsed: 0 | 1 | 2 | 3 | 4;
  correctionCount: number;
  skipped: boolean;
  pauseUsed: boolean;
  workedAnswerVisible: boolean;
  errorCode: ErrorCode | null;
  diagnosticProbeResult: DiagnosticProbeResult | null;
  format: ProblemFormat;
  operation: ArithmeticOperation;
}

export interface LearnerSkillState {
  skillId: SkillId;
  conceptStatus: ConceptStatus;
  fluencyStatus: FluencyStatus;
  weightedAccuracy: number;
  independentAttemptCount: number;
  correctIndependentAttemptCount: number;
  hintRate: number;
  recentErrorCodes: readonly ErrorCode[];
  initialCorrectMedianResponseMs?: number;
  recentCorrectMedianResponseMs?: number;
  recentMedianFirstInkLatencyMs?: number;
  recentMedianWritingDurationMs?: number;
  responseTimeVariability?: number;
  lastPracticedAt?: number;
  nextReviewAt?: number;
  plateauExposureCount: number;
  consecutiveSuccessfulSessions: number;
  /** Optional reducer bookkeeping that does not alter the public mastery model. */
  totalAttemptCount?: number;
  distinctSessionCount?: number;
  errorCounts?: Partial<Record<ErrorCode, number>>;
  recentIndependentResults?: readonly boolean[];
  updatedAt?: number;
}

export type ReviewScheduleStatus = "scheduled" | "due" | "completed";

export interface ReviewScheduleEntry {
  id: string;
  learnerId: string;
  skillId: SkillId;
  intervalIndex: number;
  dueAt: number;
  scheduledAt: number;
  lastReviewedAt: number | null;
  completedAt: number | null;
  status: ReviewScheduleStatus;
  sourceSessionId: string;
  sourceProblemId: string | null;
}

export type SessionKind = "diagnostic" | "practice" | "benchmark";

export type SessionLane =
  | "diagnostic"
  | "warmup"
  | "focus"
  | "integration"
  | "review"
  | "transfer"
  | "easy_close";

export type SessionLifecycle =
  | "not_started"
  | "diagnostic"
  | "warmup"
  | "focused_practice"
  | "integration"
  | "transfer"
  | "easy_close"
  | "complete"
  | "paused"
  | "ended_early_for_fatigue";

export type PlannedCardStatus = "planned" | "active" | "completed" | "skipped";

export interface PlannedCard {
  id: string;
  lane: SessionLane;
  reason: string;
  problem: GeneratedProblem;
  skillId: SkillId;
  status: PlannedCardStatus;
  remediationForProblemId: string | null;
  delayedRetryForProblemId: string | null;
}

export interface AdaptiveSessionPlan {
  id: string;
  learnerId: string;
  kind: SessionKind;
  seed: string;
  createdAt: number;
  targetCardCount: number;
  maxActiveDurationMs: number;
  focusSkillId: SkillId | null;
  cards: readonly PlannedCard[];
}

export interface AdaptiveSession {
  id: string;
  learnerId: string;
  kind: SessionKind;
  seed: string;
  createdAt: number;
  focusSkillId: SkillId | null;
  targetCardCount: number;
  maxActiveDurationMs: number;
  phase: SessionLifecycle;
  cards: readonly PlannedCard[];
  completedProblemIds: readonly string[];
  currentProblem: GeneratedProblem | null;
  currentCardIndex: number;
  shownAt: number | null;
  activeElapsedMs: number;
  pausedAt: number | null;
  explicitPauseUsed: boolean;
  backgrounded: boolean;
  interruptionDurationMs: number;
  remediationQueue: readonly PlannedCard[];
  fatigueFlag: boolean;
  startedAt: number | null;
  completedAt: number | null;
}

/** Storage-facing name retained so persisted state modules need no alias layer. */
export type AdaptiveSessionState = AdaptiveSession;

export interface CompletedSessionSummary {
  sessionId: string;
  learnerId: string;
  kind: SessionKind;
  startedAt: number;
  completedAt: number;
  activeDurationMs: number;
  attemptedProblemCount: number;
  independentlyCorrectCount: number;
  eventuallyCorrectCount: number;
  focusSkillId: SkillId | null;
  endedEarlyForFatigue: boolean;
  /** False when the child chose End for now before the finite plan finished. */
  completedAsPlanned: boolean;
}

export interface AdaptiveSettings {
  soundEnabled: boolean;
  targetCardCount: number;
  maxActiveDurationMs: number;
  handwritingRecognitionEnabled: boolean;
  confirmLowConfidenceRecognition: boolean;
  optionalChallengeEnabled: boolean;
  /** Parent-only comparison datum; never a concept or planning gate. */
  parentBenchmarkTargetMs: number | null;
}
