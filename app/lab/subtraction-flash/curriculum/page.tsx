"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";

import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  G1_SKILLS,
  type G1SkillId,
} from "@/lib/arithmetic-fluency/g1-curriculum.ts";
import {
  evaluateG1Answer,
  g1QuestionSemanticFingerprint,
} from "@/lib/arithmetic-fluency/generator.ts";
import { exactIntegerValue } from "@/lib/arithmetic-fluency/exact-number.ts";
import {
  createG1AttemptEvent,
  deriveGradeAssessmentEvidence,
  deriveG1LearnerModel,
  type G1AttemptEvent,
  type G1AttemptSubmissionInput,
  type G1SkillMasteryView,
} from "@/lib/arithmetic-fluency/mastery.ts";
import {
  buildG1GradeAssessmentPlan,
  buildG1RemediationPlan,
  buildG1SessionPlan,
  type G1GradeAssessmentCard,
  type G1GradeAssessmentPlan,
  type G1RemediationPlan,
  type G1SessionCard,
} from "@/lib/arithmetic-fluency/session.ts";
import {
  appendArithmeticAttempt,
  loadArithmeticFluencyDiagnostic,
  type ArithmeticFluencyStorage,
} from "@/lib/arithmetic-fluency/storage.ts";
import type {
  Domain,
  PromptAst,
  QuestionInstance,
  SkillDefinition,
} from "@/lib/arithmetic-fluency/types.ts";
import { RedemptionIntroPanel } from "@/components/progression/ProgressionSessionPanels";

import {
  BORROW_FLASH_DEFAULT_PROFILE_ID,
  createBorrowFlashProfileStorage,
  loadBorrowFlashProfilesDiagnostic,
  type BorrowFlashProfileRegistry,
} from "../borrow-flash-profiles";
import {
  FlashHandwriting,
  type FlashHandwritingEvidence,
  type FlashHandwritingRejectedRecognition,
} from "../flash-handwriting";
import styles from "./g1-curriculum.module.css";

type CurriculumView = "browser" | "playing" | "results";
type CurriculumInputMode = "type" | "draw";
type DomainFilter = "all" | Extract<
  Domain,
  "addition" | "subtraction" | "multiplication" | "division"
>;
type FeedbackState = "idle" | "incorrect" | "correct";
type SessionStage = "main" | "redemption-intro" | "redemption";

type PracticeSession = Readonly<{
  kind: "practice";
  id: string;
  targetSkillId: G1SkillId;
  title: string;
  cards: readonly G1SessionCard[];
}>;

type AssessmentSession = Readonly<{
  kind: "assessment";
  id: string;
  assessmentId: string;
  title: string;
  cards: readonly G1GradeAssessmentCard[];
}>;

type CurriculumSession = PracticeSession | AssessmentSession;
type CurriculumCard = G1SessionCard | G1GradeAssessmentCard;

type SupportDetour = Readonly<{
  sourceCard: CurriculumCard;
  supportCard: G1SessionCard;
  workedExampleQuestion: QuestionInstance;
  originalMathAttemptCount: number;
  threshold: number;
  supportErrorCount: number;
  supportRound: number;
  showWorkedExample: boolean;
}>;

type ActiveTime = {
  elapsedMs: number;
  activeSince: number | null;
};

type SessionSummary = Readonly<{
  kind: CurriculumSession["kind"];
  targetSkillId: G1SkillId | null;
  targetTitle: string;
  assessmentId: string | null;
  inputMode: CurriculumInputMode;
  firstTryCorrect: number;
  answered: number;
  elapsedMs: number;
  retries: number;
}>;

const DOMAIN_OPTIONS: readonly Readonly<{
  id: DomainFilter;
  label: string;
}>[] = [
  { id: "all", label: "All skills" },
  { id: "addition", label: "Addition" },
  { id: "subtraction", label: "Subtraction" },
  { id: "multiplication", label: "Multiplication" },
  { id: "division", label: "Division" },
];

const DOMAIN_LABELS: Record<Exclude<DomainFilter, "all">, string> = {
  addition: "Addition",
  subtraction: "Subtraction",
  multiplication: "Multiplication",
  division: "Division",
};

const WRONG_FEEDBACK_MS = 900;
const CORRECT_FEEDBACK_MS = 480;

const THREE_DIGIT_CAPACITY_SKILLS = new Set<G1SkillId>([
  "G1-AS-10",
  "G1-AS-13",
  "G1-AS-14",
  "G1-AS-15",
  "G1-M-03",
]);

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 5 7.5 12l7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SoundIcon({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 10v4h3l4 3V7l-4 3h-3Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {enabled ? (
        <path
          d="M14.5 9.2c1 .8 1.5 1.7 1.5 2.8s-.5 2-1.5 2.8M17 7c1.8 1.4 2.7 3 2.7 5s-.9 3.6-2.7 5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="m15 9 5 6m0-6-5 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function createSessionSeed(profileId: string, focus: string): string {
  let token: string;
  try {
    token = globalThis.crypto.randomUUID();
  } catch {
    token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return `g1-ui:${profileId}:${focus}:${token}`;
}

function isPracticeCard(card: CurriculumCard): card is G1SessionCard {
  return "retentionIntervalDays" in card;
}

function misconceptionTagsForAnswer(
  question: QuestionInstance,
  answer: number,
): readonly string[] {
  const matched = question.misconceptionDistractors
    .filter(
      ({ value }) => value.kind === "integer" && value.value === answer,
    )
    .map(({ misconceptionTag }) => misconceptionTag);
  return matched.length ? matched : ["unclassified_math_error"];
}

function isRemediationCheckpoint(errorCount: number): boolean {
  return errorCount === 2 || (errorCount >= 3 && errorCount % 2 === 1);
}

function remediationCardFor(card: CurriculumCard): G1SessionCard {
  if (isPracticeCard(card)) return card;
  return {
    id: card.id,
    position: card.position,
    lane: "target",
    skillId: card.skillId,
    question: card.question,
    surfaceForm: card.question.renderedPrompt,
    reason: "Grade check support",
    retryOfCardId: null,
    retryNumber: 0,
    retryPolicy: {
      retryUntilCorrect: true,
      firstUnassistedAttemptOnlyForMastery: true,
      maximumSameStructureAttempts: 3,
      suppressWrongScoreOnRetry: true,
    },
    remediation: {
      classifyMisconception: true,
      preserveOriginalFirstAttempt: true,
      distinguishRecognitionFailure: true,
      contrastiveItemCount: 1,
      reProbeOriginalLater: true,
      reduceOneDifficultyDimensionAfterSimilarErrors: 2,
      showWorkedExampleAfterSimilarErrors: 2,
      moveToPrerequisiteAfterSameStructureAttempts: 3,
    },
    retentionIntervalDays: null,
  };
}

function buildDistinctSupportPlan(
  card: G1SessionCard,
  seed: string,
  similarErrorCount: number,
): G1RemediationPlan {
  const sourceFingerprint = g1QuestionSemanticFingerprint(card.question);
  let fallback: G1RemediationPlan | null = null;
  for (let variant = 0; variant < 8; variant += 1) {
    const plan = buildG1RemediationPlan({
      card,
      seed: `${seed}:variant:${variant}`,
      similarErrorCount,
    });
    fallback ??= plan;
    const nearTransfer = plan.contrastiveQuestions[0];
    const workedExample = plan.workedExampleQuestion;
    if (
      nearTransfer &&
      g1QuestionSemanticFingerprint(nearTransfer) !== sourceFingerprint &&
      (!workedExample ||
        g1QuestionSemanticFingerprint(workedExample) !== sourceFingerprint)
    ) {
      return plan;
    }
  }
  return fallback!;
}

function formatAccuracy(value: number | null): string {
  return value === null ? "New" : `${Math.round(value * 100)}%`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 10_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  return `${Math.round(milliseconds / 1_000)}s`;
}

function formatSessionTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function activeSolveTimeInsideWindow(
  measuredActiveSolveTimeMs: number,
  startedAt: number,
  completedAt: number,
): number {
  const wallClockTimeMs = Math.max(0, completedAt - startedAt);
  return Math.min(Math.max(0, measuredActiveSolveTimeMs), wallClockTimeMs);
}

function formatReviewDate(timestamp: number | null): string {
  if (timestamp === null) return "Not scheduled";
  const days = Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1_000));
  if (days <= 0) return "Due now";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function displayState(state: G1SkillMasteryView["state"]): string {
  switch (state) {
    case "LOCKED":
      return "Locked";
    case "AVAILABLE":
      return "Available";
    case "LEARNING":
      return "Learning";
    case "PRACTICING":
      return "Practicing";
    case "FLUENT":
      return "Fluent";
    case "RETAINED":
      return "Retained";
    case "REVIEW_DUE":
      return "Review due";
  }
}

function formatTrend(view: G1SkillMasteryView): string {
  const time = formatDuration(view.medianActiveSolveTimeMs);
  switch (view.firstTryTrend) {
    case "improving":
      return `${time} · improving`;
    case "regressing":
      return `${time} · needs review`;
    case "steady":
      return `${time} · steady`;
    case "insufficient_data":
      return time === "—" ? "No trend yet" : `${time} · early data`;
  }
}

function retentionLabel(view: G1SkillMasteryView): string {
  if (view.state === "RETAINED") return "Retained";
  if (view.state === "REVIEW_DUE") return "Review due";
  if (view.state === "FLUENT") {
    return `${view.completedRetentionIntervals.length}/5 probes`;
  }
  return "Not started";
}

function skillAnswerCapacity(skillId: G1SkillId): 1 | 2 | 3 {
  if (skillId === "G1-AS-01") return 1;
  return THREE_DIGIT_CAPACITY_SKILLS.has(skillId) ? 3 : 2;
}

function operatorWords(operator: string): string {
  switch (operator) {
    case "+":
      return "plus";
    case "-":
      return "minus";
    case "×":
      return "times";
    case "÷":
      return "divided by";
    default:
      return "with";
  }
}

function EquationProblem({
  ast,
  answer,
  inputMode,
}: Readonly<{
  ast: Extract<PromptAst, { kind: "equation" }>;
  answer: ReactNode;
  inputMode: CurriculumInputMode;
}>) {
  const unknownOperand =
    ast.unknown === "result" ? null : ast.unknown.operandIndex;
  const vertical =
    ast.orientation === "vertical" &&
    ast.unknown === "result" &&
    ast.operands.length === 2;
  const accessible = `${ast.operands
    .map(({ value }, index) =>
      index === unknownOperand ? "a missing number" : String(value),
    )
    .join(` ${operatorWords(ast.operator)} `)} equals ${
    ast.unknown === "result" ? "a missing number" : ast.result.value
  }`;

  if (vertical) {
    return (
      <div className={styles.verticalProblem} role="group" aria-label={accessible}>
        <span className={styles.verticalTop} aria-hidden="true">
          {ast.operands[0]?.value}
        </span>
        <span className={styles.verticalOperator} aria-hidden="true">
          {ast.operator}
        </span>
        <span className={styles.verticalBottom} aria-hidden="true">
          {ast.operands[1]?.value}
        </span>
        <span className={styles.verticalRule} aria-hidden="true" />
        <div className={styles.verticalAnswer}>
          {answer}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.equation}
      data-input-mode={inputMode}
      role="group"
      aria-label={accessible}
    >
      {ast.operands.map((operand, index) => (
        <Fragment key={index}>
          {index === unknownOperand ? answer : <span aria-hidden="true">{operand.value}</span>}
          {index < ast.operands.length - 1 ? (
            <span className={styles.operator} aria-hidden="true">
              {ast.operator}
            </span>
          ) : null}
        </Fragment>
      ))}
      <span className={styles.equals} aria-hidden="true">
        =
      </span>
      {ast.unknown === "result" ? (
        answer
      ) : (
        <span aria-hidden="true">{ast.result.value}</span>
      )}
    </div>
  );
}

function DotPile({ count }: Readonly<{ count: number }>) {
  return (
    <span className={styles.group} aria-hidden="true">
      {count === 0 ? (
        <span className={styles.zeroPile}>0</span>
      ) : (
        Array.from({ length: count }, (_, index) => (
          <span className={styles.dot} key={index} />
        ))
      )}
    </span>
  );
}

function EqualGroupsProblem({
  ast,
  answer,
}: Readonly<{
  ast: Extract<PromptAst, { kind: "equal-groups" }>;
  answer: ReactNode;
}>) {
  const label =
    ast.representation === "array"
      ? `${ast.groupCount} rows of ${ast.groupSize}. Find the total.`
      : ast.representation === "repeated-addition"
        ? `${ast.groupSize} added ${ast.groupCount} times. Find the total.`
        : `${ast.groupCount} equal groups of ${ast.groupSize}. Find the total.`;
  let representation: ReactNode;
  if (ast.representation === "array") {
    representation = (
      <div
        className={styles.arrayModel}
        style={{
          gridTemplateColumns: `repeat(${ast.groupSize}, 14px)`,
        }}
      >
        {Array.from(
          { length: ast.groupCount * ast.groupSize },
          (_, index) => <span className={styles.dot} key={index} />,
        )}
      </div>
    );
  } else if (ast.representation === "repeated-addition") {
    representation = (
      <div className={styles.repeatedAddition}>
        {Array.from({ length: ast.groupCount }, (_, index) => (
          <Fragment key={index}>
            <strong>{ast.groupSize}</strong>
            {index < ast.groupCount - 1 ? (
              <span className={styles.repeatOperator}>+</span>
            ) : null}
          </Fragment>
        ))}
      </div>
    );
  } else {
    representation = (
      <div className={styles.groupModel}>
        {Array.from({ length: ast.groupCount }, (_, index) => (
          <DotPile count={ast.groupSize} key={index} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.modelPrompt} role="group" aria-label={label}>
      <div aria-hidden="true">{representation}</div>
      <div className={styles.modelEquation}>
        <span aria-hidden="true">{ast.groupCount}</span>
        <span className={styles.operator} aria-hidden="true">×</span>
        <span aria-hidden="true">{ast.groupSize}</span>
        <span className={styles.equals} aria-hidden="true">=</span>
        {answer}
      </div>
    </div>
  );
}

function DivisionModelProblem({
  ast,
  answer,
}: Readonly<{
  ast: Extract<PromptAst, { kind: "division-model" }>;
  answer: ReactNode;
}>) {
  const label =
    ast.representation === "sharing"
      ? `Share ${ast.dividend} equally into ${ast.divisor} groups. Find how many are in each group.`
      : `Make groups of ${ast.divisor} from ${ast.dividend}. Find the number of groups.`;
  return (
    <div className={styles.modelPrompt} role="group" aria-label={label}>
      <div className={styles.groupModel} aria-hidden="true">
        <DotPile count={ast.dividend} />
        <span className={styles.operator}>→</span>
        {ast.representation === "sharing" ? (
          Array.from({ length: ast.divisor }, (_, index) => (
            <span className={styles.group} key={index} />
          ))
        ) : (
          <>
            <DotPile count={ast.divisor} />
            <span className={styles.groupingHint}>… groups</span>
          </>
        )}
      </div>
      <div className={styles.modelEquation}>
        <span aria-hidden="true">{ast.dividend}</span>
        <span className={styles.operator} aria-hidden="true">÷</span>
        <span aria-hidden="true">{ast.divisor}</span>
        <span className={styles.equals} aria-hidden="true">=</span>
        {answer}
      </div>
    </div>
  );
}

function PartWholeProblem({
  ast,
  answer,
}: Readonly<{
  ast: Extract<PromptAst, { kind: "part-whole" }>;
  answer: ReactNode;
}>) {
  const label = `${ast.knownPart} and a missing part make ${ast.total}`;

  if (ast.representation === "equation") {
    return (
      <div className={styles.modelPrompt} role="group" aria-label={label}>
        <div className={styles.modelEquation}>
          <span aria-hidden="true">{ast.knownPart}</span>
          <span className={styles.operator} aria-hidden="true">+</span>
          {answer}
          <span className={styles.equals} aria-hidden="true">=</span>
          <span aria-hidden="true">{ast.total}</span>
        </div>
      </div>
    );
  }

  if (ast.representation === "number-bond") {
    return (
      <div className={styles.modelPrompt} role="group" aria-label={label}>
        <div className={styles.numberBond}>
          <span className={styles.numberBondTotal} aria-hidden="true">
            {ast.total}
          </span>
          <span className={styles.numberBondStem} aria-hidden="true" />
          <div className={styles.numberBondParts}>
            <span className={styles.numberBondKnown} aria-hidden="true">
              {ast.knownPart}
            </span>
            <div className={styles.numberBondAnswer}>{answer}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.modelPrompt}
      role="group"
      aria-label={label}
    >
      <div className={styles.dotPartsModel}>
        <span className={styles.dotPartsTotal} aria-hidden="true">
          {ast.total} altogether
        </span>
        <div className={styles.dotPartsRow}>
          <DotPile count={ast.knownPart} />
          <span className={styles.operator} aria-hidden="true">+</span>
          <div className={styles.dotPartsAnswer}>{answer}</div>
        </div>
      </div>
    </div>
  );
}

function StructuredProblem({
  question,
  answer,
  inputMode,
  supportHint,
}: Readonly<{
  question: QuestionInstance;
  answer: ReactNode;
  inputMode: CurriculumInputMode;
  supportHint?: string | null;
}>) {
  const ast = question.promptAst;
  let content: ReactNode;
  switch (ast.kind) {
    case "equation":
      content = <EquationProblem ast={ast} answer={answer} inputMode={inputMode} />;
      break;
    case "equal-groups":
      content = <EqualGroupsProblem ast={ast} answer={answer} />;
      break;
    case "division-model":
      content = <DivisionModelProblem ast={ast} answer={answer} />;
      break;
    case "part-whole":
      content = <PartWholeProblem ast={ast} answer={answer} />;
      break;
  }
  return (
    <section className={styles.problem} aria-label={question.renderedPrompt}>
      <p className={styles.instruction}>Find the missing number</p>
      {supportHint ? <p className={styles.reprobeHint}>{supportHint}</p> : null}
      {content}
    </section>
  );
}

function WorkedSupportPanel({
  question,
  onContinue,
}: Readonly<{
  question: QuestionInstance;
  onContinue(): void;
}>) {
  const answer = exactIntegerValue(question.exactAnswer);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => continueRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const solvedPrompt = question.renderedPrompt.replace(
    /□|\?|__+/,
    answer === null ? "" : String(answer),
  );
  const completePrompt =
    question.solutionTrace.find(({ expression }) => expression)?.expression ??
    (answer === null
      ? solvedPrompt
      : solvedPrompt === question.renderedPrompt
        ? /=$/.test(question.renderedPrompt.trim())
          ? `${question.renderedPrompt} ${answer}`
          : `${question.renderedPrompt} → ${answer}`
        : solvedPrompt);
  return (
    <section className={styles.supportPanel} aria-labelledby="support-heading">
      <p className={styles.supportKicker}>Quick practice</p>
      <h1 id="support-heading">Look at one together.</h1>
      <div className={styles.solvedSupport}>{completePrompt}</div>
      <ol className={styles.supportSteps}>
        {question.solutionTrace.slice(0, 2).map((step, index) => (
          <li key={`${step.kind}:${index}`}>
            <span>{step.text}</span>
            {step.expression ? <strong>{step.expression}</strong> : null}
          </li>
        ))}
      </ol>
      <button
        ref={continueRef}
        className={styles.primaryButton}
        type="button"
        onClick={onContinue}
      >
        Continue
      </button>
    </section>
  );
}

type NumericInputProps = Readonly<{
  disabled: boolean;
  focusRef: MutableRefObject<HTMLInputElement | null>;
  onSubmit(answer: number, inputMode: "tap" | "keyboard", raw: string): void;
}>;

function NumericInput({
  disabled,
  focusRef,
  onSubmit,
}: NumericInputProps) {
  const [value, setValue] = useState("");
  const hardwareRef = useRef(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => focusRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusRef]);

  const submit = useCallback(
    (raw: string, source: "tap" | "keyboard") => {
      if (submittedRef.current || !/^\d{1,3}$/.test(raw)) return;
      submittedRef.current = true;
      onSubmit(Number(raw), source, raw);
    },
    [onSubmit],
  );

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit(value, "keyboard");
      }}
    >
      <input
        ref={focusRef}
        className={styles.numericInput}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={3}
        autoComplete="off"
        enterKeyHint="done"
        aria-label="Answer. Press Done to submit."
        disabled={disabled}
        value={value}
        onKeyDown={(event) => {
          hardwareRef.current = true;
          if (event.key === "Enter") submit(value, "keyboard");
        }}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/\D/g, "").slice(0, 3);
          const next =
            digits.length > 1 ? digits.replace(/^0+(?=\d)/, "") : digits;
          hardwareRef.current = false;
          setValue(next);
        }}
      />
    </form>
  );
}

function SkillCard({
  skill,
  mastery,
  inputMode,
  expanded,
  onToggleDetails,
  onStart,
}: Readonly<{
  skill: SkillDefinition;
  mastery: G1SkillMasteryView;
  inputMode: CurriculumInputMode;
  expanded: boolean;
  onToggleDetails(): void;
  onStart(): void;
}>) {
  const prerequisites = skill.prerequisites;
  const detailsId = `${skill.id.toLowerCase()}-details`;
  return (
    <article
      className={styles.skillCard}
      data-state={mastery.state}
      data-tier={skill.tier}
    >
      <div className={styles.skillTopline}>
        <span className={styles.skillId}>{skill.id}</span>
        <span className={styles.tier}>{skill.tier}</span>
        <span className={styles.statePill}>{displayState(mastery.state)}</span>
      </div>
      <h3 className={styles.skillTitle}>{skill.title}</h3>
      <p className={styles.skillDescription}>{skill.description}</p>
      <div className={styles.quickMetrics} aria-label={`${skill.title} progress`}>
        <span className={styles.metric}>
          <span>Accuracy</span>
          <strong>{formatAccuracy(mastery.accuracy)}</strong>
        </span>
        <span className={styles.metric}>
          <span>Solve time</span>
          <strong>{formatDuration(mastery.medianActiveSolveTimeMs)}</strong>
        </span>
        <span className={styles.metric}>
          <span>Band</span>
          <strong>{mastery.currentBand} of 4</strong>
        </span>
      </div>
      <div className={styles.cardActions}>
        <button
          className={styles.startButton}
          type="button"
          disabled={!mastery.unlocked}
          onClick={onStart}
        >
          {mastery.state === "REVIEW_DUE"
            ? `Review with ${inputMode === "draw" ? "Draw" : "Type"}`
            : mastery.unlocked
              ? `Start with ${inputMode === "draw" ? "Draw" : "Type"}`
              : "Finish prerequisites"}
        </button>
        <button
          className={styles.detailsButton}
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? "Hide" : "Show"} details for ${skill.title}`}
          onClick={onToggleDetails}
        >
          {expanded ? "−" : "+"}
        </button>
      </div>
      {expanded ? (
        <dl className={styles.details} id={detailsId}>
          <div className={styles.detailsRow}>
            <dt>Time trend</dt>
            <dd>{formatTrend(mastery)}</dd>
          </div>
          <div className={styles.detailsRow}>
            <dt>Retention</dt>
            <dd>{retentionLabel(mastery)}</dd>
          </div>
          <div className={styles.detailsRow}>
            <dt>Next review</dt>
            <dd>{formatReviewDate(mastery.nextReviewAt)}</dd>
          </div>
          <div className={styles.detailsRow}>
            <dt>Prerequisites</dt>
            <dd className={styles.prerequisiteList}>
              {prerequisites.length ? (
                prerequisites.map((id) => (
                  <span className={styles.prerequisiteTag} key={id}>
                    {id}
                  </span>
                ))
              ) : (
                "None"
              )}
            </dd>
          </div>
          <div className={styles.detailsRow}>
            <dt>Evidence</dt>
            <dd>
              {mastery.correctAttempts} correct from {mastery.independentAttempts}{" "}
              first attempts
            </dd>
          </div>
          <div className={styles.detailsRow}>
            <dt>Profile</dt>
            <dd>{skill.masteryProfile.replaceAll("_", " ")}</dd>
          </div>
        </dl>
      ) : null}
    </article>
  );
}

export default function GradeOneArithmeticCurriculumPage() {
  const [view, setView] = useState<CurriculumView>("browser");
  const [inputMode, setInputMode] = useState<CurriculumInputMode>("type");
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [profileRegistry, setProfileRegistry] =
    useState<BorrowFlashProfileRegistry | null>(null);
  const [activeProfileId, setActiveProfileId] = useState(
    BORROW_FLASH_DEFAULT_PROFILE_ID,
  );
  const [events, setEvents] = useState<readonly G1AttemptEvent[]>([]);
  const [modelAsOf, setModelAsOf] = useState(0);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [session, setSession] = useState<CurriculumSession | null>(null);
  const [sessionStage, setSessionStage] = useState<SessionStage>("main");
  const [cardIndex, setCardIndex] = useState(0);
  const [redemptionQueue, setRedemptionQueue] = useState<readonly CurriculumCard[]>([]);
  const [redemptionIndex, setRedemptionIndex] = useState(0);
  const [supportDetour, setSupportDetour] = useState<SupportDetour | null>(null);
  const [supportExampleOpen, setSupportExampleOpen] = useState(false);
  const [reprobeScaffold, setReprobeScaffold] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>("idle");
  const [inputNonce, setInputNonce] = useState(0);
  const [firstTryCorrect, setFirstTryCorrect] = useState(0);
  const [sessionRetries, setSessionRetries] = useState(0);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);

  const storageRef = useRef<ArithmeticFluencyStorage | null>(null);
  const submissionsRef = useRef<G1AttemptSubmissionInput[]>([]);
  const mathAttemptCountRef = useRef(0);
  const supportThresholdsRef = useRef<Set<number>>(new Set());
  const workedSupportShownRef = useRef(false);
  const eventSequenceRef = useRef(0);
  const questionStartedAtRef = useRef(0);
  const activeTimeRef = useRef<ActiveTime>({ elapsedMs: 0, activeSince: null });
  const sessionActiveMsRef = useRef(0);
  const redemptionQueueRef = useRef<readonly CurriculumCard[]>([]);
  const resultTimerRef = useRef<number | null>(null);
  const numericRef = useRef<HTMLInputElement | null>(null);
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const learnerModel = useMemo(
    () => deriveG1LearnerModel(events, modelAsOf, activeProfileId),
    [activeProfileId, events, modelAsOf],
  );
  const activeProfile = profileRegistry?.profiles.find(
    ({ id }) => id === activeProfileId,
  );
  const currentCard: CurriculumCard | null = supportDetour
    ? supportDetour.supportCard
    : sessionStage === "redemption"
      ? redemptionQueue[redemptionIndex] ?? null
      : sessionStage === "main"
        ? session?.cards[cardIndex] ?? null
        : null;
  const currentQuestion = currentCard?.question ?? null;
  const currentSkill = currentCard
    ? G1_SKILLS.find(({ id }) => id === currentCard.skillId) ?? null
    : null;
  const gradePercent = Math.round(
    (learnerModel.grade.coreFluentCount /
      Math.max(1, learnerModel.grade.coreSkillCount)) *
      100,
  );

  const clearResultTimer = useCallback(() => {
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  }, []);

  const pauseActiveTime = useCallback((now = performance.now()) => {
    const timer = activeTimeRef.current;
    if (timer.activeSince !== null) {
      timer.elapsedMs += Math.max(0, now - timer.activeSince);
      timer.activeSince = null;
    }
    return timer.elapsedMs;
  }, []);

  const resumeActiveTime = useCallback((now = performance.now()) => {
    if (!document.hidden && activeTimeRef.current.activeSince === null) {
      activeTimeRef.current.activeSince = now;
    }
  }, []);

  const startAttemptTimer = useCallback(() => {
    const now = performance.now();
    questionStartedAtRef.current = Date.now();
    activeTimeRef.current = {
      elapsedMs: 0,
      activeSince: document.hidden ? null : now,
    };
    submissionsRef.current = [];
  }, []);

  const startQuestionTimer = useCallback(() => {
    mathAttemptCountRef.current = 0;
    supportThresholdsRef.current = new Set();
    workedSupportShownRef.current = false;
    setReprobeScaffold(false);
    startAttemptTimer();
  }, [startAttemptTimer]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const profiles = loadBorrowFlashProfilesDiagnostic();
      const profileId = profiles.registry.activeProfileId;
      const scopedStorage = createBorrowFlashProfileStorage(profileId);
      const diagnostic = loadArithmeticFluencyDiagnostic(scopedStorage);
      setProfileRegistry(profiles.registry);
      setActiveProfileId(profileId);
      storageRef.current = profiles.canWrite ? scopedStorage : null;
      setEvents(diagnostic.store.attemptEvents);
      setModelAsOf(Date.now());
      setSoundEnabled(readSoundPreference());
      if (!profiles.canWrite) {
        setStorageWarning(profiles.message);
      } else if (
        diagnostic.status === "corrupt" ||
        diagnostic.status === "unsupported" ||
        diagnostic.status === "unavailable"
      ) {
        setStorageWarning(
          diagnostic.message ?? "Progress cannot be saved on this device.",
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (
        view !== "playing" ||
        feedback !== "idle" ||
        supportExampleOpen ||
        sessionStage === "redemption-intro"
      ) {
        return;
      }
      if (document.hidden) pauseActiveTime();
      else resumeActiveTime();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [
    feedback,
    pauseActiveTime,
    resumeActiveTime,
    sessionStage,
    supportExampleOpen,
    view,
  ]);

  useEffect(() => () => clearResultTimer(), [clearResultTimer]);

  useEffect(() => {
    if (view !== "results") return;
    const frame = window.requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const handleSoundToggle = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
  }, [soundEnabled]);

  const playFeedback = useCallback(
    (correct: boolean) => {
      if (!soundEnabled) return;
      let context = audioContextRef.current;
      if (!context) {
        context = createGameAudioContext();
        audioContextRef.current = context;
      }
      if (!context) return;
      if (context.state === "suspended") {
        void context
          .resume()
          .then(() => playFeedbackEarcon(context, correct))
          .catch(() => undefined);
        return;
      }
      playFeedbackEarcon(context, correct);
    },
    [soundEnabled],
  );

  const launchSession = useCallback(
    (nextSession: CurriculumSession) => {
      clearResultTimer();
      setSession(nextSession);
      setSessionStage("main");
      setCardIndex(0);
      setRedemptionQueue([]);
      redemptionQueueRef.current = [];
      setRedemptionIndex(0);
      setSupportDetour(null);
      setSupportExampleOpen(false);
      setReprobeScaffold(false);
      setFeedback("idle");
      setInputNonce(0);
      setFirstTryCorrect(0);
      setSessionRetries(0);
      eventSequenceRef.current = 0;
      sessionActiveMsRef.current = 0;
      setSessionSummary(null);
      setView("playing");
      startQuestionTimer();
    },
    [clearResultTimer, startQuestionTimer],
  );

  const beginSession = useCallback(
    (skillId: G1SkillId) => {
      const skill = G1_SKILLS.find(({ id }) => id === skillId);
      const plan = buildG1SessionPlan({
        learnerId: activeProfileId,
        targetSkillId: skillId,
        seed: createSessionSeed(activeProfileId, skillId),
        events,
        now: Date.now(),
        count: 15,
      });
      launchSession({
        kind: "practice",
        id: plan.id,
        targetSkillId: skillId,
        title: skill?.title ?? "Grade 1 practice",
        cards: plan.cards,
      });
    },
    [activeProfileId, events, launchSession],
  );

  const beginAssessment = useCallback(() => {
    if (!learnerModel.grade.allCoreFluent) return;
    const plan: G1GradeAssessmentPlan = buildG1GradeAssessmentPlan({
      learnerId: activeProfileId,
      seed: createSessionSeed(activeProfileId, "grade-check"),
      events,
      now: Date.now(),
    });
    launchSession({
      kind: "assessment",
      id: plan.assessmentId,
      assessmentId: plan.assessmentId,
      title: "Grade 1 check",
      cards: plan.cards,
    });
  }, [activeProfileId, events, launchSession, learnerModel.grade.allCoreFluent]);

  const returnToBrowser = useCallback(() => {
    clearResultTimer();
    pauseActiveTime();
    setSession(null);
    setSessionStage("main");
    setRedemptionQueue([]);
    redemptionQueueRef.current = [];
    setRedemptionIndex(0);
    setSupportDetour(null);
    setSupportExampleOpen(false);
    setReprobeScaffold(false);
    setSessionSummary(null);
    setFeedback("idle");
    setView("browser");
  }, [clearResultTimer, pauseActiveTime]);

  const finishSessionWithResults = useCallback(
    (correctCount: number) => {
      if (!session) return;
      setSessionSummary({
        kind: session.kind,
        targetSkillId:
          session.kind === "practice" ? session.targetSkillId : null,
        targetTitle: session.title,
        assessmentId:
          session.kind === "assessment" ? session.assessmentId : null,
        inputMode,
        firstTryCorrect: correctCount,
        answered: session.cards.length,
        elapsedMs: sessionActiveMsRef.current,
        retries: sessionRetries,
      });
      setView("results");
      setFeedback("idle");
      setSession(null);
      setSessionStage("main");
    },
    [inputMode, session, sessionRetries],
  );

  const advanceAfterCorrect = useCallback(
    (
      correctOnFirstTry: boolean,
      queueAfterAnswer: readonly CurriculumCard[],
    ) => {
      if (!session) return;
      if (sessionStage === "redemption") {
        const nextRedemption = redemptionIndex + 1;
        if (nextRedemption >= queueAfterAnswer.length) {
          finishSessionWithResults(firstTryCorrect);
          return;
        }
        setRedemptionIndex(nextRedemption);
        setFeedback("idle");
        setInputNonce(0);
        startQuestionTimer();
        return;
      }

      const nextAnswered = cardIndex + 1;
      const nextFirstTryCorrect =
        firstTryCorrect + (correctOnFirstTry ? 1 : 0);
      setFirstTryCorrect(nextFirstTryCorrect);
      if (nextAnswered >= session.cards.length) {
        if (queueAfterAnswer.length > 0) {
          setSessionStage("redemption-intro");
          setRedemptionIndex(0);
          setFeedback("idle");
          return;
        }
        finishSessionWithResults(nextFirstTryCorrect);
        return;
      }
      setCardIndex(nextAnswered);
      setFeedback("idle");
      setInputNonce(0);
      startQuestionTimer();
    },
    [
      cardIndex,
      finishSessionWithResults,
      firstTryCorrect,
      redemptionIndex,
      session,
      sessionStage,
      startQuestionTimer,
    ],
  );

  const startRedemption = useCallback(() => {
    if (!redemptionQueueRef.current.length) {
      finishSessionWithResults(firstTryCorrect);
      return;
    }
    setSessionStage("redemption");
    setRedemptionIndex(0);
    setFeedback("idle");
    setInputNonce(0);
    startQuestionTimer();
  }, [finishSessionWithResults, firstTryCorrect, startQuestionTimer]);

  const beginSupportPractice = useCallback(() => {
    if (!supportDetour) return;
    setSupportExampleOpen(false);
    startQuestionTimer();
    workedSupportShownRef.current = supportDetour.showWorkedExample;
  }, [startQuestionTimer, supportDetour]);

  const persistAttempt = useCallback(
    ({
      card,
      submissions,
      independentFirstAttempt,
      activeSolveTimeMs,
      completedAt,
      misconceptionTags,
      eventRole,
      workedExampleShown,
    }: Readonly<{
      card: CurriculumCard;
      submissions: readonly G1AttemptSubmissionInput[];
      independentFirstAttempt: boolean;
      activeSolveTimeMs: number;
      completedAt: number;
      misconceptionTags: readonly string[];
      eventRole: string;
      workedExampleShown: boolean;
    }>): G1AttemptEvent | null => {
      if (!session) return null;
      const retentionIntervalDays =
        isPracticeCard(card) && sessionStage !== "redemption"
          ? card.retentionIntervalDays
          : null;
      const sessionKind =
        session.kind === "assessment"
          ? "assessment"
          : retentionIntervalDays !== null
            ? "retention"
            : isPracticeCard(card) &&
                learnerModel.skills[card.skillId].state === "REVIEW_DUE" &&
                supportDetour === null &&
                sessionStage === "main"
              ? "review"
              : "practice";
      const sequence = eventSequenceRef.current++;
      const event = createG1AttemptEvent({
        id: `${session.id}:${card.id}:${eventRole}:${sequence}:${completedAt}`,
        learnerId: activeProfileId,
        sessionId: session.id,
        question: card.question,
        startedAt: questionStartedAtRef.current,
        completedAt,
        activeSolveTimeMs,
        submissions,
        independentFirstAttempt,
        coverageKeys: card.question.coverageTags,
        misconceptionTags,
        workedExampleShown,
        workedExampleShownBeforeFirstAttempt: workedExampleShown,
        sessionKind,
        assessmentId:
          session.kind === "assessment" ? session.assessmentId : null,
        retentionIntervalDays,
      });
      const result = appendArithmeticAttempt(event, storageRef.current);
      setEvents((current) =>
        result.ok
          ? result.store.attemptEvents
          : current.some(({ id }) => id === event.id)
            ? current
            : [...current, event],
      );
      setModelAsOf(completedAt);
      if (!result.ok) {
        setStorageWarning("This session is working, but its progress could not be saved.");
      }
      return event;
    },
    [
      activeProfileId,
      learnerModel.skills,
      session,
      sessionStage,
      supportDetour,
    ],
  );

  const submitAnswer = useCallback(
    (
      answer: number,
      submission: G1AttemptSubmissionInput,
      performanceCompletedAt?: number,
    ) => {
      if (
        feedback !== "idle" ||
        !session ||
        !currentCard ||
        !currentQuestion
      ) {
        return;
      }
      const nowPerformance = performance.now();
      const timingEnd =
        performanceCompletedAt !== undefined &&
        Number.isFinite(performanceCompletedAt) &&
        performanceCompletedAt >= 0 &&
        performanceCompletedAt <= nowPerformance + 16
          ? Math.min(performanceCompletedAt, nowPerformance)
          : nowPerformance;
      const measuredActiveSolveTimeMs = pauseActiveTime(timingEnd);
      const completedAt = Math.max(
        Date.now(),
        questionStartedAtRef.current,
        submission.submittedAt,
        ...submissionsRef.current.map(({ submittedAt }) => submittedAt),
      );
      const activeSolveTimeMs = activeSolveTimeInsideWindow(
        measuredActiveSolveTimeMs,
        questionStartedAtRef.current,
        completedAt,
      );
      const mathAttemptIndex = mathAttemptCountRef.current;
      const errorCount = mathAttemptIndex + 1;
      const correct = evaluateG1Answer(currentQuestion, answer).correct;
      const nextSubmissions = [
        ...submissionsRef.current,
        { ...submission, activeSolveTimeMs },
      ];
      const independentFirstAttempt =
        supportDetour === null &&
        sessionStage === "main" &&
        mathAttemptIndex === 0;
      persistAttempt({
        card: currentCard,
        submissions: nextSubmissions,
        independentFirstAttempt,
        activeSolveTimeMs,
        completedAt,
        misconceptionTags: correct
          ? []
          : [
              ...misconceptionTagsForAnswer(currentQuestion, answer),
              ...(supportDetour === null &&
              errorCount === 3
                ? ["content_gap_after_three_same_structure_attempts"]
                : []),
            ],
        eventRole:
          supportDetour !== null
            ? `support-${supportDetour.threshold}-round-${supportDetour.supportRound}-attempt-${mathAttemptIndex + 1}`
            : sessionStage === "redemption"
              ? `redemption-${redemptionIndex}-attempt-${mathAttemptIndex + 1}`
              : `card-${cardIndex}-attempt-${mathAttemptIndex + 1}`,
        workedExampleShown:
          supportDetour?.showWorkedExample === true ||
          workedSupportShownRef.current,
      });
      submissionsRef.current = [];
      mathAttemptCountRef.current = mathAttemptIndex + 1;
      if (sessionStage === "main") {
        sessionActiveMsRef.current += activeSolveTimeMs;
      }

      let queueAfterAnswer = redemptionQueueRef.current;
      if (
        !correct &&
        supportDetour === null &&
        sessionStage === "main" &&
        mathAttemptIndex === 0
      ) {
        queueAfterAnswer = [...queueAfterAnswer, currentCard];
        redemptionQueueRef.current = queueAfterAnswer;
        setRedemptionQueue(queueAfterAnswer);
      }

      setFeedback(correct ? "correct" : "incorrect");
      playFeedback(correct);
      clearResultTimer();

      if (correct) {
        if (supportDetour !== null) {
          const detour = supportDetour;
          resultTimerRef.current = window.setTimeout(() => {
            setSupportDetour(null);
            setSupportExampleOpen(false);
            if (detour.threshold >= 3) setReprobeScaffold(true);
            mathAttemptCountRef.current = detour.originalMathAttemptCount;
            supportThresholdsRef.current = new Set([
              2,
              ...Array.from(
                { length: Math.max(0, Math.floor((detour.threshold - 1) / 2)) },
                (_, index) => 3 + index * 2,
              ).filter((threshold) => threshold <= detour.threshold),
            ]);
            setFeedback("idle");
            setInputNonce((value) => value + 1);
            startAttemptTimer();
          }, CORRECT_FEEDBACK_MS);
          return;
        }
        resultTimerRef.current = window.setTimeout(
          () =>
            advanceAfterCorrect(
              mathAttemptIndex === 0,
              queueAfterAnswer,
            ),
          CORRECT_FEEDBACK_MS,
        );
        return;
      }

      if (supportDetour === null && sessionStage === "main") {
        setSessionRetries((value) => value + 1);
      }

      let nextDetour: SupportDetour | null = null;
      let continuingSupportDetour: SupportDetour | null = null;
      if (supportDetour !== null) {
        const supportErrorCount = supportDetour.supportErrorCount + 1;
        continuingSupportDetour = {
          ...supportDetour,
          supportErrorCount,
        };
        if (isRemediationCheckpoint(supportErrorCount)) {
          const supportRound = supportDetour.supportRound + 1;
          const plan = buildDistinctSupportPlan(
            supportDetour.supportCard,
            `${session.id}:${supportDetour.sourceCard.id}:nested-support:${supportRound}:errors:${supportErrorCount}`,
            supportErrorCount,
          );
          const supportQuestion = plan.contrastiveQuestions[0];
          if (supportQuestion) {
            nextDetour = {
              ...supportDetour,
              supportErrorCount,
              supportRound,
              showWorkedExample:
                plan.showWorkedExample && plan.workedExampleQuestion !== null,
              workedExampleQuestion:
                plan.workedExampleQuestion ?? supportDetour.supportCard.question,
              supportCard: {
                ...supportDetour.supportCard,
                id: `${supportDetour.sourceCard.id}:support-chain:${supportRound}:errors:${supportErrorCount}`,
                lane:
                  supportQuestion.skillId === supportDetour.supportCard.skillId
                    ? supportDetour.supportCard.lane
                    : "prerequisite",
                skillId: supportQuestion.skillId as G1SkillId,
                question: supportQuestion,
                surfaceForm: supportQuestion.renderedPrompt,
                reason: "Quick practice",
                retryOfCardId: supportDetour.sourceCard.id,
                retryNumber: supportErrorCount,
                retentionIntervalDays: null,
              },
            };
          }
        }
      } else if (
        isRemediationCheckpoint(errorCount) &&
        !supportThresholdsRef.current.has(errorCount)
      ) {
        const threshold = errorCount;
        supportThresholdsRef.current.add(threshold);
        const remediationCard = remediationCardFor(currentCard);
        const plan = buildDistinctSupportPlan(
          remediationCard,
          `${session.id}:${currentCard.id}:support:${threshold}`,
          threshold,
        );
        const supportQuestion = plan.contrastiveQuestions[0];
        if (supportQuestion) {
          const workedExampleQuestion =
            plan.workedExampleQuestion ?? currentCard.question;
          nextDetour = {
            sourceCard: currentCard,
            originalMathAttemptCount: errorCount,
            threshold,
            supportErrorCount: 0,
            supportRound: 0,
            showWorkedExample:
              plan.showWorkedExample && plan.workedExampleQuestion !== null,
            workedExampleQuestion,
            supportCard: {
              ...remediationCard,
              id: `${currentCard.id}:support:${threshold}`,
              lane:
                supportQuestion.skillId === currentCard.skillId
                  ? remediationCard.lane
                  : "prerequisite",
              skillId: supportQuestion.skillId as G1SkillId,
              question: supportQuestion,
              surfaceForm: supportQuestion.renderedPrompt,
              reason: "Quick practice",
              retryOfCardId: currentCard.id,
              retryNumber: threshold,
              retentionIntervalDays: null,
            },
          };
        }
      }

      resultTimerRef.current = window.setTimeout(() => {
        setFeedback("idle");
        setInputNonce((value) => value + 1);
        if (nextDetour) {
          setSupportDetour(nextDetour);
          if (nextDetour.showWorkedExample) {
            setSupportExampleOpen(true);
          } else {
            startQuestionTimer();
          }
        } else {
          if (continuingSupportDetour) {
            setSupportDetour(continuingSupportDetour);
          }
          startAttemptTimer();
        }
      }, WRONG_FEEDBACK_MS);
    },
    [
      advanceAfterCorrect,
      cardIndex,
      clearResultTimer,
      currentCard,
      currentQuestion,
      feedback,
      pauseActiveTime,
      persistAttempt,
      playFeedback,
      redemptionIndex,
      session,
      sessionStage,
      startAttemptTimer,
      startQuestionTimer,
      supportDetour,
    ],
  );

  const handleTypedAnswer = useCallback(
    (answer: number, source: "tap" | "keyboard", raw: string) => {
      submitAnswer(answer, {
        submittedAt: Date.now(),
        inputMode: source,
        rawInput: raw,
        answer,
      });
    },
    [submitAnswer],
  );

  const handleDrawnAnswer = useCallback(
    (
      answer: number,
      answeredAt: number,
      evidence: FlashHandwritingEvidence,
    ) => {
      const performanceCompletedAt =
        evidence.recognitionStatus === "accepted"
          ? answeredAt
          : Math.max(
              answeredAt,
              performance.now() - evidence.recognitionProcessingMs,
            );
      submitAnswer(
        answer,
        {
          submittedAt: Date.now(),
          inputMode: "handwriting",
          rawInput: evidence.rawRecognition,
          answer,
          recognition: {
            raw: evidence.rawRecognition,
            recognizedAnswer: Number(evidence.rawRecognition),
            confidence: evidence.recognitionConfidence,
            margin: evidence.recognitionMargin,
            processingMs: evidence.recognitionProcessingMs,
            status: evidence.recognitionStatus,
            confirmedAnswer: evidence.confirmedAnswer,
          },
        },
        performanceCompletedAt,
      );
    },
    [submitAnswer],
  );

  const handleRejectedRecognition = useCallback(
    (evidence: FlashHandwritingRejectedRecognition) => {
      submissionsRef.current = [
        ...submissionsRef.current,
        {
          submittedAt: Date.now(),
          inputMode: "handwriting",
          rawInput: evidence.rawRecognition,
          answer: null,
          recognition: {
            raw: evidence.rawRecognition,
            recognizedAnswer: evidence.rawRecognition,
            confidence: evidence.recognitionConfidence,
            margin: evidence.recognitionMargin,
            processingMs: evidence.recognitionProcessingMs,
            status: "failed",
          },
        },
      ];
    },
    [],
  );

  const answerInput = currentQuestion ? (
    <div className={styles.answerSlot} data-state={feedback}>
      {inputMode === "type" ? (
        <NumericInput
          key={`${currentQuestion.instanceId}:${inputNonce}`}
          disabled={feedback !== "idle"}
          focusRef={numericRef}
          onSubmit={handleTypedAnswer}
        />
      ) : (
        <div className={styles.drawAnswer}>
          <FlashHandwriting
            key={`${currentQuestion.instanceId}:${inputNonce}`}
            digitCount={currentCard ? skillAnswerCapacity(currentCard.skillId) : 1}
            entryMode="right-aligned"
            rejectedRecognitionMode="confirm"
            disabled={feedback !== "idle"}
            focusRef={drawRef}
            roundId={`${currentQuestion.instanceId}:${inputNonce}`}
            onAnswer={handleDrawnAnswer}
            onRecognitionRejected={handleRejectedRecognition}
          />
        </div>
      )}
      {feedback === "incorrect" ? (
        <strong className={styles.retryFeedback} aria-hidden="true">
          Try again
        </strong>
      ) : feedback === "correct" ? (
        <strong className={styles.correctFeedback} aria-hidden="true">
          ✓ Correct
        </strong>
      ) : null}
    </div>
  ) : null;

  if (view === "playing" && session) {
    const inRedemption = sessionStage !== "main";
    const completed =
      sessionStage === "redemption" ? redemptionIndex : cardIndex;
    const total = inRedemption
      ? Math.max(1, redemptionQueue.length)
      : session.cards.length;
    const liveLabel =
      supportDetour !== null
        ? "Quick practice"
        : sessionStage === "redemption-intro"
        ? "Untimed review"
        : sessionStage === "redemption"
          ? `Redemption · ${redemptionIndex + 1} of ${redemptionQueue.length}`
          : `${session.kind === "assessment" ? "Grade check" : currentSkill?.title ?? "Grade 1"} · ${cardIndex + 1} of ${session.cards.length}`;
    return (
      <main className={styles.livePage}>
        <header className={styles.liveHud} aria-label="Practice status">
          <nav className={styles.liveNav} aria-label="Practice navigation">
            <Link className={styles.homeButton} href="/" aria-label="Home — all games">
              <HomeIcon />
            </Link>
            <button
              className={styles.backButton}
              type="button"
              aria-label="Back to Grade 1 curriculum"
              onClick={returnToBrowser}
            >
              <BackIcon />
            </button>
          </nav>
          <div className={styles.liveCenter}>
            <strong>{liveLabel}</strong>
            <span
              className={styles.sessionTrack}
              role="progressbar"
              aria-label="Session progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completed}
            >
              <span
                className={styles.sessionFill}
                style={{ width: `${(completed / total) * 100}%` }}
              />
            </span>
          </div>
          <div className={styles.liveEnd}>
            {inRedemption ? (
              <span className={styles.liveScore}>Untimed</span>
            ) : (
              <span
                className={styles.liveScore}
                aria-label={`${firstTryCorrect} correct on the first try`}
              >
                ✓ {firstTryCorrect}
              </span>
            )}
            <button
              className={styles.liveSoundButton}
              type="button"
              aria-pressed={soundEnabled}
              aria-label={`Sound ${soundEnabled ? "on" : "off"}. Toggle sound.`}
              onClick={handleSoundToggle}
            >
              <SoundIcon enabled={soundEnabled} />
            </button>
          </div>
        </header>
        {sessionStage === "redemption-intro" ? (
          <RedemptionIntroPanel
            missedCount={redemptionQueue.length}
            focusKey={session.id}
            complete
            onBegin={startRedemption}
          />
        ) : supportDetour !== null && supportExampleOpen ? (
          <WorkedSupportPanel
            question={supportDetour.workedExampleQuestion}
            onContinue={beginSupportPractice}
          />
        ) : currentQuestion && answerInput ? (
          <div className={styles.problemStage}>
            <StructuredProblem
              question={currentQuestion}
              inputMode={inputMode}
              answer={answerInput}
              supportHint={
                reprobeScaffold
                  ? currentQuestion.solutionTrace[0]?.text ?? "Use the smaller step you just practiced."
                  : null
              }
            />
          </div>
        ) : null}
        <span
          className={styles.visuallyHidden}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {feedback === "incorrect"
            ? "Try again"
            : feedback === "correct"
              ? "Correct"
              : ""}
        </span>
      </main>
    );
  }

  if (view === "results" && sessionSummary) {
    const accuracy = sessionSummary.answered
      ? sessionSummary.firstTryCorrect / sessionSummary.answered
      : 0;
    const assessmentEvidence = sessionSummary.assessmentId
      ? deriveGradeAssessmentEvidence(events, sessionSummary.assessmentId)
      : null;
    const assessmentDomainsPassed =
      assessmentEvidence !== null &&
      (["addition", "subtraction", "multiplication", "division"] as const).every(
        (domain) => (assessmentEvidence.domainAccuracy[domain] ?? 0) >= 0.85,
      );
    const assessmentPassed =
      assessmentEvidence !== null &&
      assessmentEvidence.balanced &&
      assessmentEvidence.accuracy >= 0.92 &&
      assessmentDomainsPassed;
    const encouragement =
      accuracy >= 0.9
        ? "Excellent focus. This skill is getting strong."
        : accuracy >= 0.7
          ? "Good practice. Each retry is useful evidence for what comes next."
          : "Nice persistence. The curriculum will keep this skill in reach.";
    return (
      <main className={styles.resultsPage}>
        <section className={styles.resultsCard} aria-labelledby="results-heading">
          <p className={styles.resultsEyebrow}>
            {sessionSummary.answered}-question {sessionSummary.kind === "assessment" ? "grade check" : "session"} complete
          </p>
          <h1 ref={resultsHeadingRef} id="results-heading" tabIndex={-1}>
            {sessionSummary.targetTitle}
          </h1>
          <div className={styles.resultMetrics}>
            <span className={styles.resultMetric}>
              <strong>{Math.round(accuracy * 100)}%</strong>
              <span>First-try accuracy</span>
            </span>
            <span className={styles.resultMetric}>
              <strong>{formatSessionTime(sessionSummary.elapsedMs)}</strong>
              <span>Time</span>
            </span>
            <span className={styles.resultMetric}>
              <strong>{sessionSummary.retries}</strong>
              <span>Retries</span>
            </span>
          </div>
          {assessmentEvidence ? (
            <section className={styles.assessmentResult} aria-label="Grade check outcome">
              <strong>
                {assessmentPassed ? "✓ Grade check passed" : "Keep building fluency"}
              </strong>
              <div className={styles.domainResults}>
                {(
                  ["addition", "subtraction", "multiplication", "division"] as const
                ).map((domain) => (
                  <span
                    key={domain}
                    data-passed={(assessmentEvidence.domainAccuracy[domain] ?? 0) >= 0.85}
                  >
                    {DOMAIN_LABELS[domain]}{" "}
                    {Math.round((assessmentEvidence.domainAccuracy[domain] ?? 0) * 100)}%
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          <p className={styles.encouragement}>{encouragement}</p>
          {storageWarning ? (
            <p className={styles.storageNotice} role="status">
              {storageWarning}
            </p>
          ) : null}
          <div className={styles.resultActions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                if (sessionSummary.targetSkillId) {
                  beginSession(sessionSummary.targetSkillId);
                } else {
                  beginAssessment();
                }
              }}
            >
              {sessionSummary.kind === "assessment" ? "Take grade check again" : "Practice again"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setSessionSummary(null);
                setView("browser");
              }}
            >
              Grade 1 curriculum
            </button>
          </div>
        </section>
      </main>
    );
  }

  const visibleDomains = DOMAIN_OPTIONS.filter(
    ({ id }) => id !== "all" && (domainFilter === "all" || id === domainFilter),
  ) as readonly Readonly<{ id: Exclude<DomainFilter, "all">; label: string }>[];

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.navGroup}>
          <Link className={styles.iconButton} href="/" aria-label="Home — all games">
            <HomeIcon />
          </Link>
          <Link
            className={styles.iconButton}
            href="/lab/subtraction-flash/"
            aria-label="Back to Borrow Flash"
          >
            <BackIcon />
          </Link>
          <span className={styles.wordmark}>
            <strong>Arithmetic fluency</strong>
            <span>Borrow Flash</span>
          </span>
        </div>
        <nav className={styles.gradeNav} aria-label="Grade">
          {Array.from({ length: 6 }, (_, index) => index + 1).map((grade) => (
            <button
              className={styles.gradeButton}
              type="button"
              key={grade}
              aria-current={grade === 1 ? "page" : undefined}
              aria-label={grade === 1 ? "Grade 1" : `Grade ${grade}, coming later`}
              disabled={grade !== 1}
            >
              G{grade}
            </button>
          ))}
        </nav>
        <div className={styles.topbarEnd}>
          <Link
            className={styles.profilePill}
            href="/lab/subtraction-flash/"
            aria-label={`Player: ${activeProfile?.name ?? "Player 1"}. Change player in Borrow Flash.`}
          >
            <ProfileIcon />
            <span>{activeProfile?.name ?? "Player 1"}</span>
          </Link>
          <button
            className={styles.iconButton}
            type="button"
            aria-pressed={soundEnabled}
            aria-label={`Sound ${soundEnabled ? "on" : "off"}. Toggle sound.`}
            onClick={handleSoundToggle}
          >
            <SoundIcon enabled={soundEnabled} />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="curriculum-heading">
          <div className={styles.introText}>
            <p className={styles.kicker}>Grade 1 · 24 skills</p>
            <h1 id="curriculum-heading">Arithmetic, one skill at a time.</h1>
            <p className={styles.introCopy}>
              Start with the available skills. New skills open when their
              prerequisites become fluent; stretch skills stay optional.
            </p>
          </div>
          <div className={styles.gradeProgress}>
            <div className={styles.progressHeading}>
              <span>Core fluency</span>
              <strong>{gradePercent}%</strong>
            </div>
            <span
              className={styles.progressTrack}
              role="progressbar"
              aria-label="Grade 1 core skills fluent"
              aria-valuemin={0}
              aria-valuemax={learnerModel.grade.coreSkillCount}
              aria-valuenow={learnerModel.grade.coreFluentCount}
            >
              <span className={styles.progressFill} style={{ width: `${gradePercent}%` }} />
            </span>
            <p className={styles.progressNote}>
              {learnerModel.grade.coreFluentCount} of{" "}
              {learnerModel.grade.coreSkillCount} core skills fluent ·{" "}
              {learnerModel.grade.coreRetainedCount} retained
            </p>
            <ul className={styles.gradeGates} aria-label="Grade 1 completion checks">
              <li data-complete={learnerModel.grade.allCoreFluent}>
                <span aria-hidden="true">
                  {learnerModel.grade.allCoreFluent ? "✓" : "○"}
                </span>{" "}
                Core fluent
              </li>
              <li data-complete={learnerModel.grade.retentionRequirementMet}>
                <span aria-hidden="true">
                  {learnerModel.grade.retentionRequirementMet ? "✓" : "○"}
                </span>{" "}
                Retention
              </li>
              <li data-complete={learnerModel.grade.assessmentPassed}>
                <span aria-hidden="true">
                  {learnerModel.grade.assessmentPassed ? "✓" : "○"}
                </span>{" "}
                Grade check
              </li>
              <li data-complete={learnerModel.grade.majorDomainsPassed}>
                <span aria-hidden="true">
                  {learnerModel.grade.majorDomainsPassed ? "✓" : "○"}
                </span>{" "}
                All domains
              </li>
            </ul>
            <button
              className={styles.gradeCheckButton}
              type="button"
              disabled={!learnerModel.grade.allCoreFluent}
              onClick={beginAssessment}
            >
              {learnerModel.grade.complete
                ? "Grade 1 complete"
                : learnerModel.grade.assessmentPassed &&
                    learnerModel.grade.majorDomainsPassed
                  ? "Grade check passed"
                : learnerModel.grade.allCoreFluent
                  ? `Start grade check with ${inputMode === "draw" ? "Draw" : "Type"}`
                  : "Grade check opens at core fluency"}
            </button>
          </div>
        </section>

        <section className={styles.controls} aria-label="Curriculum controls">
          <nav className={styles.domainNav} aria-label="Arithmetic domain">
            {DOMAIN_OPTIONS.map(({ id, label }) => (
              <button
                className={styles.domainButton}
                type="button"
                key={id}
                aria-pressed={domainFilter === id}
                onClick={() => setDomainFilter(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <fieldset className={styles.inputChoice}>
            <legend>Answer with</legend>
            <div className={styles.inputButtons}>
              <button
                className={styles.inputButton}
                type="button"
                aria-pressed={inputMode === "type"}
                onClick={() => setInputMode("type")}
              >
                Type
              </button>
              <button
                className={styles.inputButton}
                type="button"
                aria-pressed={inputMode === "draw"}
                onClick={() => setInputMode("draw")}
              >
                Draw
              </button>
            </div>
          </fieldset>
        </section>

        {storageWarning ? (
          <p className={styles.storageNotice} role="status">
            {storageWarning}
          </p>
        ) : null}

        <div className={styles.curriculum}>
          {visibleDomains.map(({ id }) => {
            const domainSkills = G1_SKILLS.filter(({ domain }) => domain === id);
            return (
              <section className={styles.domainSection} key={id} aria-labelledby={`${id}-heading`}>
                <div className={styles.domainHeading}>
                  <h2 id={`${id}-heading`}>{DOMAIN_LABELS[id]}</h2>
                  <span>{domainSkills.length} skills</span>
                </div>
                <div className={styles.skillGrid}>
                  {domainSkills.map((skill) => {
                    const skillId = skill.id as G1SkillId;
                    return (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        mastery={learnerModel.skills[skillId]}
                        inputMode={inputMode}
                        expanded={expandedSkillId === skill.id}
                        onToggleDetails={() =>
                          setExpandedSkillId((current) =>
                            current === skill.id ? null : skill.id,
                          )
                        }
                        onStart={() => beginSession(skillId)}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
