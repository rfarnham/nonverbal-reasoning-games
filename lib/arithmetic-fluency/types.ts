/**
 * JSON-safe contracts for the arithmetic-fluency curriculum.
 *
 * Keep browser APIs and executable state out of this module. Generated
 * questions are durable evidence, so every value here can survive a
 * JSON.stringify/JSON.parse round trip without changing its meaning.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type Grade = 1 | 2 | 3 | 4 | 5 | 6;
export type Tier = "core" | "stretch";

export type Domain =
  | "addition"
  | "subtraction"
  | "multiplication"
  | "division"
  | "fractions"
  | "decimals"
  | "percent"
  | "ratio_rate"
  | "number_properties"
  | "expressions"
  | "estimation";

export type MasteryProfile =
  | "CONCEPT"
  | "FACT"
  | "MENTAL"
  | "ALGO_SHORT"
  | "ALGO_LONG"
  | "RATIONAL"
  | "MIXED";

export type ExpectedMethod = "recognition" | "fact_recall" | "mental" | "written" | "either";

export type AnswerForm =
  | "integer"
  | "fraction"
  | "reduced_fraction"
  | "finite_decimal"
  | "mixed_number"
  | "remainder"
  | "percent";

export interface IntegerExact {
  readonly kind: "integer";
  readonly value: number;
}

export interface RationalExact {
  readonly kind: "rational";
  readonly numerator: number;
  readonly denominator: number;
}

export interface FiniteDecimalExact {
  readonly kind: "finite_decimal";
  readonly coefficient: number;
  readonly scale: number;
}

/** Display form backed by the exact rational value numerator/denominator. */
export interface MixedNumberExact {
  readonly kind: "mixed_number";
  readonly whole: number;
  readonly numerator: number;
  readonly denominator: number;
}

export interface RemainderExact {
  readonly kind: "remainder";
  readonly quotient: number;
  readonly remainder: number;
  readonly divisor: number;
}

/** Percent display form; `numerator / denominator` is the underlying value. */
export interface PercentExact {
  readonly kind: "percent";
  readonly numerator: number;
  readonly denominator: number;
}

export type ExactNumber =
  | IntegerExact
  | RationalExact
  | FiniteDecimalExact
  | MixedNumberExact
  | RemainderExact
  | PercentExact;

export type ArithmeticOperator = "+" | "-" | "×" | "÷";
export type Orientation = "horizontal" | "vertical";

export interface EquationPromptAst {
  readonly kind: "equation";
  readonly operator: ArithmeticOperator;
  readonly operands: readonly IntegerExact[];
  /** `result` or the zero-based operand index hidden from the learner. */
  readonly unknown: "result" | { readonly operandIndex: number };
  readonly result: IntegerExact;
  readonly orientation: Orientation;
}

export interface EqualGroupsPromptAst {
  readonly kind: "equal-groups";
  readonly representation: "groups" | "array" | "repeated-addition";
  readonly groupCount: number;
  readonly groupSize: number;
  readonly unknown: "product";
}

export interface DivisionModelPromptAst {
  readonly kind: "division-model";
  readonly representation: "sharing" | "grouping";
  readonly dividend: number;
  readonly divisor: number;
  readonly unknown: "quotient";
}

export interface PartWholePromptAst {
  readonly kind: "part-whole";
  readonly representation: "dot-parts" | "number-bond" | "equation";
  readonly total: number;
  readonly knownPart: number;
  readonly unknown: "missing-part";
  readonly maximumTotal: number;
}

export type PromptAst =
  | EquationPromptAst
  | EqualGroupsPromptAst
  | DivisionModelPromptAst
  | PartWholePromptAst;

export interface DifficultyBand {
  readonly band: 1 | 2 | 3 | 4;
  readonly label: "clean" | "ordinary" | "structurally_difficult" | "adversarial";
  readonly description: string;
  readonly constraints: Readonly<Record<string, JsonValue>>;
}

export interface CoverageRequirement {
  /** Stable structural key written into generated `coverageTags`. */
  readonly key: string;
  readonly description: string;
  /** Sampling guidance, not a per-small-batch guarantee. */
  readonly minimumShare: number;
  readonly critical?: boolean;
}

export interface CanonicalExample {
  readonly prompt: string;
  readonly answer: string;
  readonly difficultyBand: 1 | 2 | 3 | 4;
  readonly rationale: string;
}

export interface CanonicalNonExample {
  readonly prompt: string;
  readonly reason: string;
}

export interface SkillDefinition {
  readonly id: string;
  readonly version: number;
  readonly grade: Grade;
  readonly tier: Tier;
  readonly domain: Domain;
  readonly title: string;
  readonly description: string;
  readonly prerequisites: readonly string[];
  readonly generator: {
    readonly kind: string;
    readonly operandSpec: Readonly<Record<string, JsonValue>>;
    readonly constraints: Readonly<Record<string, JsonValue>>;
    readonly difficultyBands: readonly DifficultyBand[];
    readonly coverageRequirements: readonly CoverageRequirement[];
  };
  readonly expectedMethod: ExpectedMethod;
  readonly masteryProfile: MasteryProfile;
  readonly acceptedAnswerForms: readonly AnswerForm[];
  readonly misconceptionTags: readonly string[];
  readonly examples: readonly CanonicalExample[];
  readonly nonExamples: readonly CanonicalNonExample[];
}

export interface SolutionStep {
  readonly kind: "model" | "decompose" | "calculate" | "inverse-check";
  readonly text: string;
  readonly expression?: string;
}

export interface Distractor {
  readonly value: IntegerExact;
  readonly renderedValue: string;
  readonly misconceptionTag: string;
}

export interface QuestionInstance {
  readonly instanceId: string;
  readonly skillId: string;
  readonly secondarySkillIds: readonly string[];
  readonly curriculumVersion: number;
  readonly generatorVersion: string;
  readonly seed: string;
  readonly promptAst: PromptAst;
  readonly renderedPrompt: string;
  readonly operands: readonly ExactNumber[];
  readonly exactAnswer: ExactNumber;
  readonly acceptedAnswerForms: readonly AnswerForm[];
  readonly difficultyBand: 1 | 2 | 3 | 4;
  readonly difficultyFeatures: Readonly<Record<string, string | number | boolean>>;
  readonly solutionTrace: readonly SolutionStep[];
  readonly misconceptionDistractors: readonly Distractor[];
  readonly coverageTags: readonly string[];
  readonly orientation: Orientation;
}

export interface GenerationOptions {
  readonly skillId: string;
  readonly seed: string;
  readonly difficultyBand?: 1 | 2 | 3 | 4;
  readonly orientation?: Orientation;
}

export type SubmittedAnswer = string | number | ExactNumber;

export interface AnswerEvaluation {
  readonly correct: boolean;
  readonly normalizedSubmission: ExactNumber | null;
  readonly acceptedForm: AnswerForm | null;
  readonly reason: "correct" | "incorrect" | "unreadable" | "answer_form_not_accepted";
}
