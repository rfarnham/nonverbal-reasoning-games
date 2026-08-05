import {
  createAdaptiveRandom,
  deriveAdaptiveSeed,
  randomChoice,
  randomInt,
  randomIntBetween,
  stableSeedToken,
  type RandomSource,
} from "./random.ts";
import { isSkillId, skillDefinition } from "./skills.ts";
import type {
  ArithmeticOperation,
  ErrorCode,
  GeneratedProblem,
  HintStep,
  MissingEquationTerm,
  NumericPromptSpec,
  PlaceValueQuestion,
  ProblemAnswer,
  ProblemEvaluation,
  ProblemFormat,
  ProblemMetadata,
  ProblemPromptSpec,
  SkillId,
  TwoChoicePromptSpec,
} from "./types.ts";

export const MAX_PROBLEM_GENERATION_ATTEMPTS = 96;

export interface GenerateProblemInput {
  skillId: SkillId;
  seed: string;
  excludedFingerprints?: ReadonlySet<string>;
  format?: ProblemFormat;
  difficulty?: number;
  maxAttempts?: number;
}

export interface GenerateProblemSetInput {
  seed: string;
  count: number;
  skillId?: SkillId;
  skillIds?: readonly SkillId[];
  excludedFingerprints?: ReadonlySet<string>;
  format?: ProblemFormat;
  formats?: readonly ProblemFormat[];
  difficulty?: number;
}

type ProblemCandidate = Omit<GeneratedProblem, "id" | "fingerprint">;

interface GeneratorContext {
  skillId: SkillId;
  seed: string;
  random: RandomSource;
  format: ProblemFormat;
  difficulty: number;
}

type ProblemGenerator = (context: GeneratorContext) => ProblemCandidate;

interface SubtractionCase {
  minuend: number;
  subtrahend: number;
  result: number;
  sourceSkillId: "A01" | "A02" | "A03" | "A04" | "A05";
  templateId: string;
}

const YES_NO_CHOICES = Object.freeze([
  Object.freeze({ value: "yes" as const, label: "Yes" }),
  Object.freeze({ value: "no" as const, label: "No" }),
]) as readonly [
  Readonly<{ value: "yes"; label: "Yes" }>,
  Readonly<{ value: "no"; label: "No" }>,
];

function chooseFormat(random: RandomSource, requested?: ProblemFormat): ProblemFormat {
  if (requested !== undefined && requested !== "horizontal" && requested !== "vertical") {
    throw new RangeError(`Unsupported problem format: ${String(requested)}`);
  }
  return requested ?? (randomInt(random, 2) === 0 ? "horizontal" : "vertical");
}

function resolveDifficulty(skillId: SkillId, random: RandomSource, requested?: number): number {
  const bands = skillDefinition(skillId).difficultyBands;
  if (requested !== undefined) {
    if (!Number.isFinite(requested) || !bands.includes(requested)) {
      throw new RangeError(
        `Difficulty ${String(requested)} is not valid for adaptive skill ${skillId}.`,
      );
    }
    return requested;
  }
  return randomChoice(random, bands);
}

function operationSymbol(operation: ArithmeticOperation): "+" | "-" {
  return operation === "addition" ? "+" : "-";
}

function visibleValue(value: number | null): string {
  return value === null ? "__" : String(value);
}

function equationDisplay(
  left: number | null,
  operator: "+" | "-",
  right: number | null,
  result: number | null,
  format: ProblemFormat,
): string {
  const horizontal = `${visibleValue(left)} ${operator === "-" ? "−" : "+"} ${visibleValue(right)} = ${visibleValue(result)}`;
  if (format === "horizontal" || left === null || right === null) {
    return horizontal;
  }

  const width = Math.max(String(left).length, String(right).length, result === null ? 1 : String(result).length) + 2;
  const operatorText = operator === "-" ? "−" : "+";
  return `${String(left).padStart(width)}\n${operatorText}${String(right).padStart(width - 1)}\n${"─".repeat(width)}\n${visibleValue(result).padStart(width)}`;
}

function uniqueSkillIds(values: readonly SkillId[]): SkillId[] {
  return [...new Set(values)];
}

function supportingSkillIds(skillId: SkillId, sourceSkillId?: SkillId): readonly SkillId[] {
  const prerequisites = skillDefinition(skillId).prerequisites;
  return Object.freeze(uniqueSkillIds(sourceSkillId ? [sourceSkillId, ...prerequisites] : prerequisites));
}

function numericAnswerHints(params: {
  nudge: string;
  visual: string;
  workedStep: string;
  workedExample: string;
}): readonly HintStep[] {
  return Object.freeze([
    Object.freeze({
      level: 1 as const,
      kind: "nudge" as const,
      text: params.nudge,
      answerRevealing: false,
    }),
    Object.freeze({
      level: 2 as const,
      kind: "visual" as const,
      text: params.visual,
      answerRevealing: false,
    }),
    Object.freeze({
      level: 3 as const,
      kind: "worked_step" as const,
      text: params.workedStep,
      answerRevealing: false,
    }),
    Object.freeze({
      level: 4 as const,
      kind: "worked_step" as const,
      text: `Worked example: ${params.workedExample}`,
      answerRevealing: false,
    }),
  ]);
}

function chooseDifferentWorkedExample(
  activeAnswer: number,
  examples: readonly Readonly<{ answer: number; text: string }>[],
): string {
  return (
    examples.find((example) => example.answer !== activeAnswer) ?? examples[0]
  )!.text;
}

function similarSubtractionWorkedExample(problem: SubtractionCase): string {
  const requiresRegrouping = problem.minuend % 10 < problem.subtrahend % 10;
  if (problem.minuend % 10 === 0) {
    return chooseDifferentWorkedExample(problem.result, [
      { answer: 36, text: "For 60 − 24, rename 60 as 5 tens and 10 ones; 10 − 4 = 6 and 5 − 2 = 3, so 60 − 24 = 36." },
      { answer: 34, text: "For 70 − 36, rename 70 as 6 tens and 10 ones; 10 − 6 = 4 and 6 − 3 = 3, so 70 − 36 = 34." },
    ]);
  }
  if (problem.result < 10) {
    return chooseDifferentWorkedExample(problem.result, [
      { answer: 6, text: "For 41 − 35, rename 41 as 3 tens and 11 ones; 11 − 5 = 6 and 3 − 3 = 0, so the answer is 6." },
      { answer: 5, text: "For 32 − 27, rename 32 as 2 tens and 12 ones; 12 − 7 = 5 and 2 − 2 = 0, so the answer is 5." },
    ]);
  }
  if (requiresRegrouping && problem.subtrahend < 10) {
    return chooseDifferentWorkedExample(problem.result, [
      { answer: 35, text: "For 42 − 7, rename 42 as 3 tens and 12 ones; 12 − 7 = 5, so 42 − 7 = 35." },
      { answer: 25, text: "For 31 − 6, rename 31 as 2 tens and 11 ones; 11 − 6 = 5, so 31 − 6 = 25." },
    ]);
  }
  if (requiresRegrouping) {
    return chooseDifferentWorkedExample(problem.result, [
      { answer: 25, text: "For 52 − 27, rename 52 as 4 tens and 12 ones; 12 − 7 = 5 and 4 − 2 = 2, so 52 − 27 = 25." },
      { answer: 37, text: "For 61 − 24, rename 61 as 5 tens and 11 ones; 11 − 4 = 7 and 5 − 2 = 3, so 61 − 24 = 37." },
    ]);
  }
  return chooseDifferentWorkedExample(problem.result, [
    { answer: 44, text: "For 68 − 24, 8 − 4 = 4 and 6 − 2 = 4, so 68 − 24 = 44." },
    { answer: 43, text: "For 75 − 32, 5 − 2 = 3 and 7 − 3 = 4, so 75 − 32 = 43." },
  ]);
}

function yesNoHints(needsRegrouping: boolean, minuend: number, subtrahend: number): readonly HintStep[] {
  const minuendOnes = minuend % 10;
  const subtrahendOnes = subtrahend % 10;
  return Object.freeze([
    Object.freeze({
      level: 1 as const,
      kind: "nudge" as const,
      text: "Look only at the ones column first.",
      answerRevealing: false,
    }),
    Object.freeze({
      level: 2 as const,
      kind: "visual" as const,
      text: `Compare ${minuendOnes} ones with ${subtrahendOnes} ones.`,
      answerRevealing: false,
    }),
    Object.freeze({
      level: 3 as const,
      kind: "worked_step" as const,
      text: needsRegrouping
        ? `${minuendOnes} ones is not enough to subtract ${subtrahendOnes} ones.`
        : `${minuendOnes} ones is enough to subtract ${subtrahendOnes} ones.`,
      answerRevealing: false,
    }),
    Object.freeze({
      level: 4 as const,
      kind: "worked_step" as const,
      text: needsRegrouping
        ? minuend === 31 && subtrahend === 16
          ? "Worked example: in 42 − 27, 2 ones cannot take away 7 ones, so trade one ten."
          : "Worked example: in 31 − 16, 1 one cannot take away 6 ones, so trade one ten."
        : minuend === 38 && subtrahend === 24
          ? "Worked example: in 47 − 25, 7 ones can take away 5 ones, so no trade is needed."
          : "Worked example: in 38 − 24, 8 ones can take away 4 ones, so no trade is needed.",
      answerRevealing: false,
    }),
  ]);
}

function makeEquationCandidate(
  context: GeneratorContext,
  params: {
    left: number;
    right: number;
    result: number;
    operation: ArithmeticOperation;
    missing?: MissingEquationTerm;
    instruction?: string;
    templateId: string;
    operands?: Readonly<Record<string, number>>;
    metadata?: Partial<ProblemMetadata>;
    hints: readonly HintStep[];
    sourceSkillId?: SkillId;
  },
): ProblemCandidate {
  const missing = params.missing ?? "result";
  const operator = operationSymbol(params.operation);
  const left = missing === "left" ? null : params.left;
  const right = missing === "right" ? null : params.right;
  const result = missing === "result" ? null : params.result;
  const expectedAnswer =
    missing === "left" ? params.left : missing === "right" ? params.right : params.result;
  const promptSpec: NumericPromptSpec = {
    kind: "numeric",
    instruction: params.instruction ?? "Write the missing number.",
    format: context.format,
    displayText: equationDisplay(left, operator, right, result, context.format),
    math: { kind: "equation", left, operator, right, result, missing },
  };

  return {
    seed: context.seed,
    skillId: context.skillId,
    supportingSkillIds: supportingSkillIds(context.skillId, params.sourceSkillId),
    difficulty: context.difficulty,
    promptSpec,
    answerSpec: { kind: "numeric", expected: expectedAnswer, integerOnly: true },
    expectedAnswer,
    operands: Object.freeze({
      left: params.left,
      right: params.right,
      result: params.result,
      ...(params.operands ?? {}),
    }),
    hints: params.hints,
    metadata: {
      templateId: params.templateId,
      format: context.format,
      operation: params.operation,
      missingTerm: missing,
      ...(params.metadata ?? {}),
    },
  };
}

function subtractionHints(problem: SubtractionCase): readonly HintStep[] {
  const minuendOnes = problem.minuend % 10;
  const subtrahendOnes = problem.subtrahend % 10;
  const regrouping = minuendOnes < subtrahendOnes;
  const renamedOnes = regrouping ? minuendOnes + 10 : minuendOnes;
  const renamedTens = Math.floor(problem.minuend / 10) - (regrouping ? 1 : 0);
  const subtrahendTens = Math.floor(problem.subtrahend / 10);
  return numericAnswerHints({
    nudge: regrouping
      ? "The ones column needs one ten traded before you subtract."
      : "Subtract the ones, then subtract the tens.",
    visual: regrouping
      ? `${problem.minuend} can be renamed as ${renamedTens} tens and ${renamedOnes} ones.`
      : `${problem.minuend} has ${Math.floor(problem.minuend / 10)} tens and ${minuendOnes} ones.`,
    workedStep: `${renamedOnes} − ${subtrahendOnes} gives the ones; ${renamedTens} − ${subtrahendTens} gives the tens.`,
    workedExample: similarSubtractionWorkedExample(problem),
  });
}

function makeSubtractionCandidate(
  context: GeneratorContext,
  problem: SubtractionCase,
  metadata: Partial<ProblemMetadata> = {},
): ProblemCandidate {
  const requiresRegrouping = problem.minuend % 10 < problem.subtrahend % 10;
  return makeEquationCandidate(context, {
    left: problem.minuend,
    right: problem.subtrahend,
    result: problem.result,
    operation: "subtraction",
    templateId: problem.templateId,
    operands: {
      minuend: problem.minuend,
      subtrahend: problem.subtrahend,
    },
    metadata: {
      requiresRegrouping,
      minuendEndsInZero: problem.minuend % 10 === 0,
      resultUnderTen: problem.result < 10,
      sourceSkillId: problem.sourceSkillId === context.skillId ? undefined : problem.sourceSkillId,
      ...metadata,
    },
    hints: subtractionHints(problem),
    sourceSkillId: problem.sourceSkillId === context.skillId ? undefined : problem.sourceSkillId,
  });
}

function createA01Case(random: RandomSource): SubtractionCase {
  const tens = randomIntBetween(random, 2, 9);
  const ones = randomIntBetween(random, 0, 8);
  const subtrahend = randomIntBetween(random, ones + 1, 9);
  const minuend = tens * 10 + ones;
  return {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: "A01",
    templateId: "a01-two-digit-minus-digit-across-ten",
  };
}

function createA02Case(random: RandomSource): SubtractionCase {
  const minuendTens = randomIntBetween(random, 2, 9);
  const minuendOnes = randomIntBetween(random, 0, 9);
  const subtrahendTens = randomIntBetween(random, 1, minuendTens - 1);
  const subtrahendOnes = randomIntBetween(random, 0, minuendOnes);
  const minuend = minuendTens * 10 + minuendOnes;
  const subtrahend = subtrahendTens * 10 + subtrahendOnes;
  return {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: "A02",
    templateId: "a02-no-regrouping",
  };
}

function createA03Case(random: RandomSource): SubtractionCase {
  const minuendTens = randomIntBetween(random, 3, 9);
  const minuendOnes = randomIntBetween(random, 1, 8);
  const subtrahendTens = randomIntBetween(random, 1, minuendTens - 2);
  const subtrahendOnes = randomIntBetween(random, minuendOnes + 1, 9);
  const minuend = minuendTens * 10 + minuendOnes;
  const subtrahend = subtrahendTens * 10 + subtrahendOnes;
  return {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: "A03",
    templateId: "a03-standard-regrouping",
  };
}

function createA04Case(random: RandomSource): SubtractionCase {
  const minuendTens = randomIntBetween(random, 2, 9);
  const subtrahendTens = randomIntBetween(random, 1, minuendTens - 1);
  const subtrahendOnes = randomIntBetween(random, 1, 9);
  const minuend = minuendTens * 10;
  const subtrahend = subtrahendTens * 10 + subtrahendOnes;
  return {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: "A04",
    templateId: "a04-zero-ones-regrouping",
  };
}

function createA05Case(random: RandomSource): SubtractionCase {
  const minuendTens = randomIntBetween(random, 2, 9);
  const minuendOnes = randomIntBetween(random, 0, 8);
  const subtrahendTens = minuendTens - 1;
  const subtrahendOnes = randomIntBetween(random, minuendOnes + 1, 9);
  const minuend = minuendTens * 10 + minuendOnes;
  const subtrahend = subtrahendTens * 10 + subtrahendOnes;
  return {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: "A05",
    templateId: "a05-result-under-ten",
  };
}

function createMixedApplicationCase(random: RandomSource): SubtractionCase {
  return randomChoice(random, [createA02Case, createA03Case, createA04Case, createA05Case])(random);
}

function generateF01(context: GeneratorContext): ProblemCandidate {
  const missingValue = randomIntBetween(context.random, 1, 9);
  const complement = 10 - missingValue;
  const variant = randomInt(context.random, 3);
  if (variant === 1) {
    return makeEquationCandidate(context, {
      left: 10,
      right: complement,
      result: missingValue,
      operation: "subtraction",
      templateId: "f01-ten-minus-complement",
      hints: numericAnswerHints({
        nudge: "Think of the two partners that make 10.",
        visual: `${complement} and the missing number make 10.`,
        workedStep: `Count from ${complement} up to 10.`,
        workedExample: chooseDifferentWorkedExample(missingValue, [
          { answer: 3, text: "7 and 3 make 10, so 10 − 7 = 3." },
          { answer: 4, text: "6 and 4 make 10, so 10 − 6 = 4." },
        ]),
      }),
      operands: { missingValue, complement },
    });
  }

  const missing = variant === 0 ? "right" : "left";
  return makeEquationCandidate(context, {
    left: missingValue,
    right: complement,
    result: 10,
    operation: "addition",
    missing,
    templateId: missing === "right" ? "f01-missing-right-addend" : "f01-missing-left-addend",
    hints: numericAnswerHints({
      nudge: "Think of the two partners that make 10.",
      visual: `${missing === "right" ? missingValue : complement} needs a partner to reach 10.`,
      workedStep: `Count up to 10 to find the missing partner.`,
      workedExample: chooseDifferentWorkedExample(
        missing === "right" ? complement : missingValue,
        [
          { answer: 3, text: "7 + 3 = 10, so the missing partner of 7 is 3." },
          { answer: 4, text: "6 + 4 = 10, so the missing partner of 6 is 4." },
        ],
      ),
    }),
    operands: { missingValue, complement },
  });
}

function generateF02(context: GeneratorContext): ProblemCandidate {
  const minuend = randomIntBetween(context.random, 2, 10);
  const subtrahend = randomIntBetween(context.random, 1, minuend - 1);
  const problem: SubtractionCase = {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: "A01",
    templateId: "f02-within-ten",
  };
  return makeEquationCandidate(context, {
    left: minuend,
    right: subtrahend,
    result: problem.result,
    operation: "subtraction",
    templateId: problem.templateId,
    operands: { minuend, subtrahend },
    metadata: { requiresRegrouping: false, resultUnderTen: true },
    hints: numericAnswerHints({
      nudge: "Start at the first number and count back.",
      visual: `Take ${subtrahend} away from ${minuend}.`,
      workedStep: `${minuend} − ${subtrahend} leaves ${problem.result}.`,
      workedExample: chooseDifferentWorkedExample(problem.result, [
        { answer: 5, text: "For 9 − 4, count back four: 8, 7, 6, 5, so 9 − 4 = 5." },
        { answer: 4, text: "For 7 − 3, count back three: 6, 5, 4, so 7 − 3 = 4." },
      ]),
    }),
  });
}

function generateF03(context: GeneratorContext): ProblemCandidate {
  const ones = randomIntBetween(context.random, 1, 8);
  const minuend = 10 + ones;
  const subtrahend = randomIntBetween(context.random, 1, ones);
  const result = minuend - subtrahend;
  return makeEquationCandidate(context, {
    left: minuend,
    right: subtrahend,
    result,
    operation: "subtraction",
    templateId: "f03-teen-no-crossing",
    operands: { minuend, subtrahend },
    metadata: { requiresRegrouping: false, resultUnderTen: false },
    hints: numericAnswerHints({
      nudge: "Subtract from the ones; the ten stays.",
      visual: `${minuend} is 10 and ${ones}.`,
      workedStep: `${ones} − ${subtrahend} = ${ones - subtrahend}, with one ten still there.`,
      workedExample: chooseDifferentWorkedExample(result, [
        { answer: 14, text: "For 17 − 3, subtract 3 from the 7 ones and keep the ten: 17 − 3 = 14." },
        { answer: 12, text: "For 16 − 4, subtract 4 from the 6 ones and keep the ten: 16 − 4 = 12." },
      ]),
    }),
  });
}

function generateF04(context: GeneratorContext): ProblemCandidate {
  const minuend = randomIntBetween(context.random, 11, 18);
  const ones = minuend % 10;
  const subtrahend = randomIntBetween(context.random, ones + 1, 9);
  const result = minuend - subtrahend;
  return makeEquationCandidate(context, {
    left: minuend,
    right: subtrahend,
    result,
    operation: "subtraction",
    templateId: "f04-teen-across-ten",
    operands: { minuend, subtrahend },
    metadata: { requiresRegrouping: true, resultUnderTen: true },
    hints: numericAnswerHints({
      nudge: "Bridge through 10.",
      visual: `First take ${ones} from ${minuend} to reach 10.`,
      workedStep: `After reaching 10, subtract the remaining ${subtrahend - ones}.`,
      workedExample: chooseDifferentWorkedExample(result, [
        { answer: 7, text: "For 13 − 6, subtract 3 to reach 10, then subtract the remaining 3: 13 − 6 = 7." },
        { answer: 8, text: "For 14 − 6, subtract 4 to reach 10, then subtract the remaining 2: 14 − 6 = 8." },
      ]),
    }),
  });
}

function generateF05(context: GeneratorContext): ProblemCandidate {
  const source = randomChoice(context.random, ["F02", "F03", "F04"] as const);
  const sourceContext: GeneratorContext = { ...context, skillId: source };
  const candidate = PROBLEM_GENERATORS[source](sourceContext);
  return {
    ...candidate,
    skillId: "F05",
    supportingSkillIds: supportingSkillIds("F05", source),
    metadata: {
      ...candidate.metadata,
      templateId: `f05-mixed-${source.toLowerCase()}`,
      sourceSkillId: source,
    },
  };
}

function createR01Case(random: RandomSource, needsRegrouping: boolean): SubtractionCase {
  const minuendTens = randomIntBetween(random, 2, 9);
  const minuendOnes = needsRegrouping
    ? randomIntBetween(random, 0, 8)
    : randomIntBetween(random, 0, 9);
  const subtrahendTens = randomIntBetween(random, 1, minuendTens - 1);
  const subtrahendOnes = needsRegrouping
    ? randomIntBetween(random, minuendOnes + 1, 9)
    : randomIntBetween(random, 0, minuendOnes);
  const minuend = minuendTens * 10 + minuendOnes;
  const subtrahend = subtrahendTens * 10 + subtrahendOnes;
  return {
    minuend,
    subtrahend,
    result: minuend - subtrahend,
    sourceSkillId: needsRegrouping ? "A03" : "A02",
    templateId: needsRegrouping ? "r01-regrouping-needed" : "r01-no-regrouping-needed",
  };
}

function generateR01(context: GeneratorContext): ProblemCandidate {
  const needsRegrouping = randomInt(context.random, 2) === 0;
  const problem = createR01Case(context.random, needsRegrouping);
  const promptSpec: TwoChoicePromptSpec = {
    kind: "two-choice",
    instruction: "Do you need to trade one ten?",
    format: context.format,
    displayText: equationDisplay(
      problem.minuend,
      "-",
      problem.subtrahend,
      null,
      context.format,
    ),
    math: {
      kind: "regrouping-decision",
      minuend: problem.minuend,
      subtrahend: problem.subtrahend,
    },
    choices: YES_NO_CHOICES,
  };
  const expectedAnswer = needsRegrouping ? "yes" : "no";
  return {
    seed: context.seed,
    skillId: context.skillId,
    supportingSkillIds: supportingSkillIds(context.skillId),
    difficulty: context.difficulty,
    promptSpec,
    answerSpec: { kind: "two-choice", expected: expectedAnswer },
    expectedAnswer,
    operands: Object.freeze({
      minuend: problem.minuend,
      subtrahend: problem.subtrahend,
      result: problem.result,
    }),
    hints: yesNoHints(needsRegrouping, problem.minuend, problem.subtrahend),
    metadata: {
      templateId: problem.templateId,
      format: context.format,
      operation: "subtraction",
      requiresRegrouping: needsRegrouping,
      resultUnderTen: problem.result < 10,
    },
  };
}

function placeValuePrompt(
  context: GeneratorContext,
  params: {
    instruction: string;
    displayText: string;
    expectedAnswer: number;
    templateId: string;
    question: PlaceValueQuestion;
    whole: number;
    originalTens: number;
    originalOnes: number;
    renamedTens?: number;
    renamedOnes?: number;
    subtrahendTens?: number;
    subtrahendOnes?: number;
    answerTens?: number;
    answerOnes?: number;
    operands: Readonly<Record<string, number>>;
    hints: readonly HintStep[];
    sourceSkillId?: SkillId;
    metadata?: Partial<ProblemMetadata>;
  },
): ProblemCandidate {
  const promptSpec: NumericPromptSpec = {
    kind: "numeric",
    instruction: params.instruction,
    format: context.format,
    displayText: params.displayText,
    math: {
      kind: "place-value",
      whole: params.whole,
      originalTens: params.originalTens,
      originalOnes: params.originalOnes,
      renamedTens: params.renamedTens,
      renamedOnes: params.renamedOnes,
      subtrahendTens: params.subtrahendTens,
      subtrahendOnes: params.subtrahendOnes,
      answerTens: params.answerTens,
      answerOnes: params.answerOnes,
      question: params.question,
    },
  };
  return {
    seed: context.seed,
    skillId: context.skillId,
    supportingSkillIds: supportingSkillIds(context.skillId, params.sourceSkillId),
    difficulty: context.difficulty,
    promptSpec,
    answerSpec: { kind: "numeric", expected: params.expectedAnswer, integerOnly: true },
    expectedAnswer: params.expectedAnswer,
    operands: Object.freeze({ ...params.operands }),
    hints: params.hints,
    metadata: {
      templateId: params.templateId,
      format: context.format,
      operation: "subtraction",
      requiresRegrouping: true,
      renameQuestion: params.question,
      sourceSkillId: params.sourceSkillId,
      ...(params.metadata ?? {}),
    },
  };
}

function generateR02(context: GeneratorContext): ProblemCandidate {
  const originalTens = randomIntBetween(context.random, 2, 9);
  const originalOnes = randomIntBetween(context.random, 0, 9);
  const whole = originalTens * 10 + originalOnes;
  const renamedTens = originalTens - 1;
  const renamedOnes = originalOnes + 10;
  const question = randomInt(context.random, 2) === 0 ? "renamed_tens" : "renamed_ones";
  const asksTens = question === "renamed_tens";
  const expectedAnswer = asksTens ? renamedTens : renamedOnes;
  return placeValuePrompt(context, {
    instruction: asksTens
      ? "After trading one ten, how many tens remain?"
      : "After trading one ten, how many ones are there now?",
    displayText: asksTens
      ? `${whole} → __ tens and ${renamedOnes} ones`
      : `${whole} → ${renamedTens} tens and __ ones`,
    expectedAnswer,
    templateId: asksTens ? "r02-renamed-tens" : "r02-renamed-ones",
    question,
    whole,
    originalTens,
    originalOnes,
    renamedTens,
    renamedOnes,
    operands: { whole, originalTens, originalOnes, renamedTens, renamedOnes },
    metadata: { minuendEndsInZero: originalOnes === 0 },
    hints: numericAnswerHints({
      nudge: "One ten moves to the ones place.",
      visual: `${originalTens} tens and ${originalOnes} ones becomes ${renamedTens} tens and ${renamedOnes} ones.`,
      workedStep: asksTens
        ? `${originalTens} − 1 gives the tens that remain.`
        : `${originalOnes} + 10 gives the renamed ones.`,
      workedExample: asksTens
        ? chooseDifferentWorkedExample(expectedAnswer, [
            { answer: 3, text: "Rename 43 by trading one ten: 4 tens become 3 tens, and the 3 ones become 13 ones." },
            { answer: 5, text: "Rename 62 by trading one ten: 6 tens become 5 tens, and the 2 ones become 12 ones." },
          ])
        : chooseDifferentWorkedExample(expectedAnswer, [
            { answer: 13, text: "Rename 43 by trading one ten: 4 tens become 3 tens, and 3 ones become 13 ones." },
            { answer: 12, text: "Rename 62 by trading one ten: 6 tens become 5 tens, and 2 ones become 12 ones." },
          ]),
    }),
  });
}

function generateR03(context: GeneratorContext): ProblemCandidate {
  const application = randomChoice(context.random, [createA03Case, createA04Case, createA05Case])(
    context.random,
  );
  const originalTens = Math.floor(application.minuend / 10);
  const originalOnes = application.minuend % 10;
  const renamedTens = originalTens - 1;
  const renamedOnes = originalOnes + 10;
  const subtrahendOnes = application.subtrahend % 10;
  const expectedAnswer = renamedOnes - subtrahendOnes;
  return placeValuePrompt(context, {
    instruction: "The number has already been renamed. Subtract only the ones.",
    displayText: `${renamedOnes} − ${subtrahendOnes} = __`,
    expectedAnswer,
    templateId: "r03-ones-after-regrouping",
    question: "ones_after_regrouping",
    whole: application.minuend,
    originalTens,
    originalOnes,
    renamedTens,
    renamedOnes,
    subtrahendOnes,
    answerOnes: expectedAnswer,
    sourceSkillId: "F04",
    operands: {
      minuend: application.minuend,
      subtrahend: application.subtrahend,
      originalTens,
      originalOnes,
      renamedTens,
      renamedOnes,
      subtrahendOnes,
    },
    hints: numericAnswerHints({
      nudge: "Use the renamed ones, not the original ones.",
      visual: `The ones column is ${renamedOnes} − ${subtrahendOnes}.`,
      workedStep: `Subtract ${subtrahendOnes} from ${renamedOnes}.`,
      workedExample: chooseDifferentWorkedExample(expectedAnswer, [
        { answer: 6, text: "After 43 is renamed as 3 tens and 13 ones, the ones step in 43 − 27 is 13 − 7 = 6." },
        { answer: 7, text: "After 52 is renamed as 4 tens and 12 ones, the ones step in 52 − 25 is 12 − 5 = 7." },
      ]),
    }),
  });
}

function generateR04(context: GeneratorContext): ProblemCandidate {
  const application = randomChoice(context.random, [createA03Case, createA04Case, createA05Case])(
    context.random,
  );
  const originalTens = Math.floor(application.minuend / 10);
  const originalOnes = application.minuend % 10;
  const renamedTens = originalTens - 1;
  const renamedOnes = originalOnes + 10;
  const subtrahendTens = Math.floor(application.subtrahend / 10);
  const expectedAnswer = renamedTens - subtrahendTens;
  return placeValuePrompt(context, {
    instruction: "After the trade, subtract only the tens.",
    displayText: `${renamedTens} tens − ${subtrahendTens} tens = __ tens`,
    expectedAnswer,
    templateId: "r04-tens-after-regrouping",
    question: "tens_after_regrouping",
    whole: application.minuend,
    originalTens,
    originalOnes,
    renamedTens,
    renamedOnes,
    subtrahendTens,
    answerTens: expectedAnswer,
    operands: {
      minuend: application.minuend,
      subtrahend: application.subtrahend,
      originalTens,
      originalOnes,
      renamedTens,
      renamedOnes,
      subtrahendTens,
    },
    hints: numericAnswerHints({
      nudge: "Use the tens count after the trade.",
      visual: `${originalTens} tens became ${renamedTens} tens.`,
      workedStep: `${renamedTens} − ${subtrahendTens} gives the tens in the answer.`,
      workedExample: chooseDifferentWorkedExample(expectedAnswer, [
        { answer: 3, text: "After 63 is renamed as 5 tens and 13 ones, the tens step in 63 − 24 is 5 tens − 2 tens = 3 tens." },
        { answer: 4, text: "After 74 is renamed as 6 tens and 14 ones, the tens step in 74 − 25 is 6 tens − 2 tens = 4 tens." },
      ]),
    }),
  });
}

function generateR05(context: GeneratorContext): ProblemCandidate {
  const application = randomChoice(context.random, [createA03Case, createA04Case, createA05Case])(
    context.random,
  );
  const answerTens = Math.floor(application.result / 10);
  const answerOnes = application.result % 10;
  const originalTens = Math.floor(application.minuend / 10);
  const originalOnes = application.minuend % 10;
  return placeValuePrompt(context, {
    instruction: "Put the tens answer and ones answer together.",
    displayText: `${answerTens} tens and ${answerOnes} ones = __`,
    expectedAnswer: application.result,
    templateId: "r05-place-value-assembly",
    question: "assembled_value",
    whole: application.minuend,
    originalTens,
    originalOnes,
    answerTens,
    answerOnes,
    operands: {
      minuend: application.minuend,
      subtrahend: application.subtrahend,
      result: application.result,
      answerTens,
      answerOnes,
    },
    hints: numericAnswerHints({
      nudge: "The tens digit comes first and the ones digit comes second.",
      visual: `${answerTens} tens means ${answerTens * 10}; then add ${answerOnes} ones.`,
      workedStep: `${answerTens * 10} + ${answerOnes} makes the full number.`,
      workedExample: chooseDifferentWorkedExample(application.result, [
        { answer: 36, text: "3 tens and 6 ones means 30 + 6, which is 36." },
        { answer: 42, text: "4 tens and 2 ones means 40 + 2, which is 42." },
      ]),
    }),
  });
}

function generateA01(context: GeneratorContext): ProblemCandidate {
  return makeSubtractionCandidate(context, createA01Case(context.random));
}

function generateA02(context: GeneratorContext): ProblemCandidate {
  return makeSubtractionCandidate(context, createA02Case(context.random));
}

function generateA03(context: GeneratorContext): ProblemCandidate {
  return makeSubtractionCandidate(context, createA03Case(context.random));
}

function generateA04(context: GeneratorContext): ProblemCandidate {
  return makeSubtractionCandidate(context, createA04Case(context.random));
}

function generateA05(context: GeneratorContext): ProblemCandidate {
  return makeSubtractionCandidate(context, createA05Case(context.random));
}

function generateA06(context: GeneratorContext): ProblemCandidate {
  const problem = createMixedApplicationCase(context.random);
  return makeSubtractionCandidate(
    context,
    { ...problem, templateId: `a06-mixed-${problem.sourceSkillId.toLowerCase()}` },
    { sourceSkillId: problem.sourceSkillId },
  );
}

function generateT01(context: GeneratorContext): ProblemCandidate {
  const problem = createMixedApplicationCase(context.random);
  const missing =
    context.difficulty >= 4
      ? randomChoice(
          context.random,
          ["result", "result", "right", "right", "left"] as const,
        )
      : randomChoice(context.random, ["result", "result", "right", "right"] as const);
  const expected =
    missing === "left" ? problem.minuend : missing === "right" ? problem.subtrahend : problem.result;
  return makeEquationCandidate(context, {
    left: problem.minuend,
    right: problem.subtrahend,
    result: problem.result,
    operation: "subtraction",
    missing,
    instruction: "Write the number that makes the subtraction sentence true.",
    templateId: `t01-missing-${missing}`,
    operands: { minuend: problem.minuend, subtrahend: problem.subtrahend },
    metadata: {
      requiresRegrouping: problem.minuend % 10 < problem.subtrahend % 10,
      minuendEndsInZero: problem.minuend % 10 === 0,
      resultUnderTen: problem.result < 10,
      sourceSkillId: problem.sourceSkillId,
    },
    sourceSkillId: problem.sourceSkillId,
    hints: numericAnswerHints({
      nudge:
        missing === "result"
          ? "Solve the subtraction in the usual direction."
          : "Use the known numbers to reason backward.",
      visual:
        missing === "right"
          ? `Ask what must be taken from ${problem.minuend} to leave ${problem.result}.`
          : missing === "left"
            ? `Ask what number loses ${problem.subtrahend} and leaves ${problem.result}.`
            : `Inspect whether the ones column needs a trade.`,
      workedStep:
        missing === "right"
          ? `${problem.minuend} − ${problem.result} finds the missing subtrahend.`
          : missing === "left"
            ? `${problem.result} + ${problem.subtrahend} finds the missing minuend.`
            : `Subtract ${problem.subtrahend} from ${problem.minuend}.`,
      workedExample:
        missing === "right"
          ? chooseDifferentWorkedExample(expected, [
              { answer: 28, text: "For 54 − __ = 26, subtract 26 from 54; 54 − 26 = 28, so the missing subtrahend is 28." },
              { answer: 24, text: "For 61 − __ = 37, subtract 37 from 61; 61 − 37 = 24, so the missing subtrahend is 24." },
            ])
          : missing === "left"
            ? chooseDifferentWorkedExample(expected, [
                { answer: 54, text: "For __ − 28 = 26, add 26 and 28; 26 + 28 = 54, so the missing minuend is 54." },
                { answer: 61, text: "For __ − 24 = 37, add 37 and 24; 37 + 24 = 61, so the missing minuend is 61." },
              ])
            : chooseDifferentWorkedExample(expected, [
                { answer: 26, text: "For 54 − 28 = __, rename 54 as 4 tens and 14 ones; 14 − 8 = 6 and 4 − 2 = 2, so the result is 26." },
                { answer: 37, text: "For 61 − 24 = __, rename 61 as 5 tens and 11 ones; 11 − 4 = 7 and 5 − 2 = 3, so the result is 37." },
              ]),
    }),
  });
}

function alteredOnesAnswer(correct: number): number {
  const ones = correct % 10;
  if (ones === 9) return correct - 1;
  return correct + 1;
}

function alteredTensAnswer(correct: number): number {
  return correct >= 10 ? correct - 10 : correct + 10;
}

function generateT02(context: GeneratorContext): ProblemCandidate {
  const problem = randomChoice(context.random, [createA03Case, createA04Case, createA05Case])(
    context.random,
  );
  const misconception = randomChoice(context.random, [
    "forgot_to_decrement_tens",
    "regrouping_not_detected",
    "wrong_operation",
    "ones_digit_error",
    "tens_digit_error",
  ] as const satisfies readonly ErrorCode[]);
  const minuendTens = Math.floor(problem.minuend / 10);
  const minuendOnes = problem.minuend % 10;
  const subtrahendTens = Math.floor(problem.subtrahend / 10);
  const subtrahendOnes = problem.subtrahend % 10;
  let shownAnswer: number;
  if (misconception === "forgot_to_decrement_tens") {
    shownAnswer = problem.result + 10;
  } else if (misconception === "regrouping_not_detected") {
    shownAnswer = (minuendTens - subtrahendTens) * 10 + (subtrahendOnes - minuendOnes);
  } else if (misconception === "wrong_operation") {
    shownAnswer = problem.minuend + problem.subtrahend;
  } else if (misconception === "ones_digit_error") {
    shownAnswer = alteredOnesAnswer(problem.result);
  } else {
    shownAnswer = alteredTensAnswer(problem.result);
  }
  if (shownAnswer === problem.result || shownAnswer < 0) {
    shownAnswer = problem.result + 1;
  }

  const promptSpec: NumericPromptSpec = {
    kind: "numeric",
    instruction: "This solution has a mistake. What should the answer be?",
    format: context.format,
    displayText: equationDisplay(
      problem.minuend,
      "-",
      problem.subtrahend,
      shownAnswer,
      context.format,
    ),
    math: {
      kind: "repair",
      minuend: problem.minuend,
      subtrahend: problem.subtrahend,
      operation: "subtraction",
      shownAnswer,
      misconception,
    },
  };
  return {
    seed: context.seed,
    skillId: context.skillId,
    supportingSkillIds: supportingSkillIds(context.skillId, problem.sourceSkillId),
    difficulty: context.difficulty,
    promptSpec,
    answerSpec: { kind: "numeric", expected: problem.result, integerOnly: true },
    expectedAnswer: problem.result,
    operands: Object.freeze({
      minuend: problem.minuend,
      subtrahend: problem.subtrahend,
      result: problem.result,
      shownAnswer,
    }),
    hints: numericAnswerHints({
      nudge: "Check the operation sign and each place-value column.",
      visual: "Rename one ten before subtracting the ones.",
      workedStep: `${problem.minuend} − ${problem.subtrahend} must be smaller than ${problem.minuend}.`,
      workedExample: chooseDifferentWorkedExample(problem.result, [
        { answer: 25, text: "To repair 52 − 27 = 35, rename 52 as 4 tens and 12 ones; 12 − 7 = 5 and 4 − 2 = 2, so the corrected answer is 25." },
        { answer: 37, text: "To repair 61 − 24 = 47, rename 61 as 5 tens and 11 ones; 11 − 4 = 7 and 5 − 2 = 3, so the corrected answer is 37." },
      ]),
    }),
    metadata: {
      templateId: `t02-repair-${misconception}`,
      format: context.format,
      operation: "subtraction",
      requiresRegrouping: true,
      minuendEndsInZero: problem.minuend % 10 === 0,
      resultUnderTen: problem.result < 10,
      misconception,
      sourceSkillId: problem.sourceSkillId,
    },
  };
}

function generateT03(context: GeneratorContext): ProblemCandidate {
  const problem = randomChoice(context.random, [createA02Case, createA03Case])(context.random);
  return makeSubtractionCandidate(
    context,
    { ...problem, templateId: `t03-${context.format}-${problem.sourceSkillId.toLowerCase()}` },
    { sourceSkillId: problem.sourceSkillId },
  );
}

function generateT04(context: GeneratorContext): ProblemCandidate {
  const operation = randomInt(context.random, 2) === 0 ? "addition" : "subtraction";
  if (operation === "subtraction") {
    const problem = createMixedApplicationCase(context.random);
    return makeSubtractionCandidate(
      context,
      { ...problem, templateId: `t04-subtraction-${problem.sourceSkillId.toLowerCase()}` },
      { sourceSkillId: problem.sourceSkillId },
    );
  }

  const left = randomIntBetween(context.random, 20, 79);
  const right = randomIntBetween(context.random, 10, Math.min(39, 99 - left));
  const result = left + right;
  return makeEquationCandidate(context, {
    left,
    right,
    result,
    operation: "addition",
    instruction: "Check the operation sign, then solve.",
    templateId: "t04-addition",
    operands: { addendA: left, addendB: right },
    sourceSkillId: "A06",
    hints: numericAnswerHints({
      nudge: "Look at the plus sign before calculating.",
      visual: "Addition combines the two amounts.",
      workedStep: `Add ${right} to ${left}.`,
      workedExample: chooseDifferentWorkedExample(result, [
        { answer: 49, text: "For 32 + 17, add the ones to get 9 and the tens to get 4 tens, so 32 + 17 = 49." },
        { answer: 52, text: "For 31 + 21, add the ones to get 2 and the tens to get 5 tens, so 31 + 21 = 52." },
      ]),
    }),
  });
}

function generateT05(context: GeneratorContext): ProblemCandidate {
  const sourceSkillId = randomInt(context.random, 2) === 0 ? "T01" : "T02";
  const sourceContext: GeneratorContext = { ...context, skillId: sourceSkillId };
  const candidate = PROBLEM_GENERATORS[sourceSkillId](sourceContext);
  return {
    ...candidate,
    skillId: "T05",
    supportingSkillIds: supportingSkillIds("T05", sourceSkillId),
    metadata: {
      ...candidate.metadata,
      templateId: `t05-fallback-${sourceSkillId.toLowerCase()}-${candidate.metadata.templateId}`,
      sourceSkillId,
      challengeProvider: "built-in-transfer-fallback",
    },
  };
}

export const PROBLEM_GENERATORS: Readonly<Record<SkillId, ProblemGenerator>> = Object.freeze({
  F01: generateF01,
  F02: generateF02,
  F03: generateF03,
  F04: generateF04,
  F05: generateF05,
  R01: generateR01,
  R02: generateR02,
  R03: generateR03,
  R04: generateR04,
  R05: generateR05,
  A01: generateA01,
  A02: generateA02,
  A03: generateA03,
  A04: generateA04,
  A05: generateA05,
  A06: generateA06,
  T01: generateT01,
  T02: generateT02,
  T03: generateT03,
  T04: generateT04,
  T05: generateT05,
});

function encoded(value: string | number | boolean | undefined): string {
  return encodeURIComponent(value === undefined ? "" : String(value));
}

export function problemFingerprint(
  problem: Omit<GeneratedProblem, "id" | "fingerprint"> | GeneratedProblem,
): string {
  if (
    problem.skillId === "F01" &&
    Number.isSafeInteger(problem.operands.missingValue) &&
    Number.isSafeInteger(problem.operands.complement)
  ) {
    const pair = [
      problem.operands.missingValue!,
      problem.operands.complement!,
    ].sort((left, right) => left - right);
    return `skill=F01|pair=${encoded(pair[0]!)}+${encoded(pair[1]!)}`;
  }
  const operandKey = Object.entries(problem.operands)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encoded(key)}=${encoded(value)}`)
    .join("&");
  return [
    `skill=${encoded(problem.skillId)}`,
    ...(problem.skillId === "T03"
      ? [`format=${encoded(problem.metadata.format)}`]
      : []),
    `operation=${encoded(problem.metadata.operation)}`,
    `expected=${encoded(problem.expectedAnswer)}`,
    `rename=${encoded(problem.metadata.renameQuestion)}`,
    `misconception=${encoded(problem.metadata.misconception)}`,
    `source=${encoded(problem.metadata.sourceSkillId)}`,
    `operands=${operandKey}`,
  ].join("|");
}

function finalizeCandidate(candidate: ProblemCandidate): GeneratedProblem {
  const fingerprint = problemFingerprint(candidate);
  const id = `adaptive-${candidate.skillId.toLowerCase()}-${stableSeedToken(candidate.seed)}-${stableSeedToken(fingerprint)}`;
  return Object.freeze({ ...candidate, id, fingerprint });
}

function operand(problem: GeneratedProblem, key: string): number | undefined {
  return problem.operands[key];
}

function validateApplicationCase(problem: GeneratedProblem, sourceSkillId: SkillId): string[] {
  const issues: string[] = [];
  const minuend = operand(problem, "minuend");
  const subtrahend = operand(problem, "subtrahend");
  const result = operand(problem, "result");
  if (minuend === undefined || subtrahend === undefined || result === undefined) {
    return ["Application problems must retain minuend, subtrahend, and result operands."];
  }
  const minuendTens = Math.floor(minuend / 10);
  const minuendOnes = minuend % 10;
  const subtrahendTens = Math.floor(subtrahend / 10);
  const subtrahendOnes = subtrahend % 10;
  if (result !== minuend - subtrahend || result <= 0) {
    issues.push("Subtraction operands must produce the retained positive result.");
  }
  if (sourceSkillId === "A01") {
    if (!(minuend >= 20 && subtrahend >= 1 && subtrahend <= 9 && minuendOnes < subtrahend)) {
      issues.push("A01 must be two-digit minus one-digit across ten.");
    }
  } else if (sourceSkillId === "A02") {
    if (!(minuendOnes >= subtrahendOnes && minuendTens >= subtrahendTens && minuend > subtrahend)) {
      issues.push("A02 must be a nonnegative two-digit problem without regrouping.");
    }
  } else if (sourceSkillId === "A03") {
    if (
      !(
        minuendOnes > 0 &&
        minuendOnes < subtrahendOnes &&
        minuendTens - 1 >= subtrahendTens &&
        result >= 10
      )
    ) {
      issues.push("A03 must require regrouping, avoid zero ones, and produce at least ten.");
    }
  } else if (sourceSkillId === "A04") {
    if (!(minuendOnes === 0 && subtrahendOnes > 0 && result > 0)) {
      issues.push("A04 must regroup from a minuend ending in zero.");
    }
  } else if (sourceSkillId === "A05") {
    if (
      !(
        minuendOnes < subtrahendOnes &&
        minuendTens - 1 === subtrahendTens &&
        result >= 1 &&
        result <= 9
      )
    ) {
      issues.push("A05 must require regrouping and produce a result from one through nine.");
    }
  }
  return issues;
}

export function validateGeneratedProblem(problem: GeneratedProblem): string[] {
  const issues: string[] = [];
  if (!isSkillId(problem.skillId)) issues.push("Unknown skill ID.");
  if (typeof problem.seed !== "string" || problem.seed.length === 0) issues.push("Seed must be non-empty.");
  if (!Number.isFinite(problem.difficulty)) issues.push("Difficulty must be finite.");
  if (!skillDefinition(problem.skillId).difficultyBands.includes(problem.difficulty)) {
    issues.push("Difficulty is outside the skill's configured bands.");
  }
  if (problem.promptSpec.format !== problem.metadata.format) {
    issues.push("Prompt and metadata formats must agree.");
  }
  if (problem.promptSpec.kind !== problem.answerSpec.kind) {
    issues.push("Prompt and answer interaction kinds must agree.");
  }
  if (problem.answerSpec.expected !== problem.expectedAnswer) {
    issues.push("Answer spec and expected answer must agree.");
  }
  if (problem.answerSpec.kind === "numeric" && !Number.isSafeInteger(problem.expectedAnswer)) {
    issues.push("Numeric answers must be safe integers.");
  }
  if (
    problem.answerSpec.kind === "two-choice" &&
    problem.expectedAnswer !== "yes" &&
    problem.expectedAnswer !== "no"
  ) {
    issues.push("Two-choice answers must be yes or no.");
  }
  if (Object.values(problem.operands).some((value) => !Number.isSafeInteger(value))) {
    issues.push("All retained operands must be safe integers.");
  }
  if (
    problem.hints.length !== 4 ||
    problem.hints.some((hint, index) => hint.level !== index + 1)
  ) {
    issues.push("Every problem must provide the four bounded hint levels in order.");
  }
  const finalHint = problem.hints.at(-1);
  if (
    !finalHint ||
    finalHint.kind !== "worked_step" ||
    finalHint.answerRevealing ||
    !finalHint.text.startsWith("Worked example:")
  ) {
    issues.push("Hint 4 must be a different worked example, not the active answer.");
  }
  if (problem.fingerprint !== problemFingerprint(problem)) {
    issues.push("Fingerprint must match the canonical problem content.");
  }

  const result = operand(problem, "result");
  const minuend = operand(problem, "minuend");
  const subtrahend = operand(problem, "subtrahend");
  switch (problem.skillId) {
    case "F01": {
      const missingValue = operand(problem, "missingValue");
      const complement = operand(problem, "complement");
      if (
        missingValue === undefined ||
        complement === undefined ||
        missingValue < 1 ||
        missingValue > 9 ||
        missingValue + complement !== 10
      ) {
        issues.push("F01 must use a missing value from one through nine and a complement to ten.");
      }
      break;
    }
    case "F02":
      if (
        minuend === undefined ||
        subtrahend === undefined ||
        result === undefined ||
        minuend > 10 ||
        subtrahend < 1 ||
        result !== minuend - subtrahend ||
        result < 0
      ) {
        issues.push("F02 must be valid subtraction within ten.");
      }
      break;
    case "F03":
      if (
        minuend === undefined ||
        subtrahend === undefined ||
        result === undefined ||
        minuend < 11 ||
        minuend > 18 ||
        minuend % 10 < subtrahend ||
        result < 10 ||
        result !== minuend - subtrahend
      ) {
        issues.push("F03 must be teen subtraction that does not cross ten.");
      }
      break;
    case "F04":
      if (
        minuend === undefined ||
        subtrahend === undefined ||
        result === undefined ||
        minuend < 11 ||
        minuend > 18 ||
        subtrahend <= minuend % 10 ||
        result < 1 ||
        result > 9 ||
        result !== minuend - subtrahend
      ) {
        issues.push("F04 must cross ten and produce a positive one-digit result.");
      }
      break;
    case "F05":
      if (!(["F02", "F03", "F04"] as const).includes(problem.metadata.sourceSkillId as never)) {
        issues.push("F05 must identify its component fact family.");
      }
      break;
    case "R01": {
      if (minuend === undefined || subtrahend === undefined || result === undefined || result < 0) {
        issues.push("R01 subtraction must be nonnegative.");
      } else {
        const expected = minuend % 10 < subtrahend % 10 ? "yes" : "no";
        if (problem.expectedAnswer !== expected) issues.push("R01 decision must match the ones digits.");
      }
      break;
    }
    case "R02": {
      const originalTens = operand(problem, "originalTens");
      const originalOnes = operand(problem, "originalOnes");
      const renamedTens = operand(problem, "renamedTens");
      const renamedOnes = operand(problem, "renamedOnes");
      if (
        originalTens === undefined ||
        originalOnes === undefined ||
        renamedTens !== originalTens - 1 ||
        renamedOnes !== originalOnes + 10
      ) {
        issues.push("R02 rename must trade exactly one ten for ten ones.");
      }
      break;
    }
    case "R03": {
      const renamedOnes = operand(problem, "renamedOnes");
      const subtractOnes = operand(problem, "subtrahendOnes");
      if (
        renamedOnes === undefined ||
        subtractOnes === undefined ||
        problem.expectedAnswer !== renamedOnes - subtractOnes
      ) {
        issues.push("R03 must ask for the renamed ones subtraction.");
      }
      break;
    }
    case "R04": {
      const renamedTens = operand(problem, "renamedTens");
      const subtractTens = operand(problem, "subtrahendTens");
      if (
        renamedTens === undefined ||
        subtractTens === undefined ||
        problem.expectedAnswer !== renamedTens - subtractTens
      ) {
        issues.push("R04 must ask for the decremented tens subtraction.");
      }
      break;
    }
    case "R05": {
      const answerTens = operand(problem, "answerTens");
      const answerOnes = operand(problem, "answerOnes");
      if (
        answerTens === undefined ||
        answerOnes === undefined ||
        problem.expectedAnswer !== answerTens * 10 + answerOnes
      ) {
        issues.push("R05 must assemble the retained tens and ones.");
      }
      break;
    }
    case "A01":
    case "A02":
    case "A03":
    case "A04":
    case "A05":
      issues.push(...validateApplicationCase(problem, problem.skillId));
      break;
    case "A06":
    case "T03": {
      const source = problem.metadata.sourceSkillId;
      if (!source || !(source in PROBLEM_GENERATORS)) {
        issues.push(`${problem.skillId} must identify a source application family.`);
      } else {
        issues.push(...validateApplicationCase(problem, source));
      }
      break;
    }
    case "T01":
      if (problem.promptSpec.math.kind !== "equation" || !problem.metadata.missingTerm) {
        issues.push("T01 must contain a structured missing-number equation.");
      }
      if (problem.difficulty < 4 && problem.metadata.missingTerm === "left") {
        issues.push("T01 missing minuends are reserved for the later difficulty band.");
      }
      break;
    case "T02":
      if (
        problem.promptSpec.math.kind !== "repair" ||
        operand(problem, "shownAnswer") === problem.expectedAnswer ||
        !problem.metadata.misconception
      ) {
        issues.push("T02 must show and classify a plausible incorrect result.");
      }
      break;
    case "T04":
      if (problem.metadata.operation === "addition") {
        const left = operand(problem, "left");
        const right = operand(problem, "right");
        if (left === undefined || right === undefined || problem.expectedAnswer !== left + right) {
          issues.push("T04 addition answer must equal the sum of its operands.");
        }
      } else if (minuend === undefined || subtrahend === undefined || result !== minuend - subtrahend) {
        issues.push("T04 subtraction answer must equal the operand difference.");
      }
      break;
    case "T05":
      if (
        problem.metadata.challengeProvider !== "built-in-transfer-fallback" ||
        (problem.metadata.sourceSkillId !== "T01" && problem.metadata.sourceSkillId !== "T02")
      ) {
        issues.push("T05 must expose a challenge provider or the built-in T01/T02 fallback.");
      }
      break;
  }
  return issues;
}

function assertGenerationInput(input: GenerateProblemInput): void {
  if (!isSkillId(input.skillId)) throw new RangeError(`Unknown adaptive skill: ${String(input.skillId)}`);
  if (typeof input.seed !== "string" || input.seed.length === 0) {
    throw new TypeError("Problem generation requires a non-empty string seed.");
  }
  if (
    input.maxAttempts !== undefined &&
    (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts <= 0)
  ) {
    throw new RangeError("maxAttempts must be a positive safe integer.");
  }
}

export function generateProblem(input: GenerateProblemInput): GeneratedProblem {
  assertGenerationInput(input);
  const maxAttempts = input.maxAttempts ?? MAX_PROBLEM_GENERATION_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidateSeed =
      attempt === 0 ? input.seed : deriveAdaptiveSeed(input.seed, "candidate", attempt);
    const random = createAdaptiveRandom(candidateSeed);
    const context: GeneratorContext = {
      skillId: input.skillId,
      seed: candidateSeed,
      random,
      difficulty: resolveDifficulty(input.skillId, random, input.difficulty),
      format: chooseFormat(random, input.format),
    };
    const problem = finalizeCandidate(PROBLEM_GENERATORS[input.skillId](context));
    const issues = validateGeneratedProblem(problem);
    if (issues.length > 0) {
      throw new Error(`Generator ${input.skillId} produced an invalid problem: ${issues.join(" ")}`);
    }
    if (!input.excludedFingerprints?.has(problem.fingerprint)) {
      return problem;
    }
  }
  throw new Error(
    `Unable to generate a fresh ${input.skillId} problem after ${maxAttempts} deterministic attempts.`,
  );
}

function f01PairKey(problem: GeneratedProblem): string | null {
  if (problem.skillId !== "F01") return null;
  const missingValue = operand(problem, "missingValue");
  const complement = operand(problem, "complement");
  if (missingValue === undefined || complement === undefined) return null;
  return [Math.min(missingValue, complement), Math.max(missingValue, complement)].join("+");
}

export function generateProblemSet(input: GenerateProblemSetInput): GeneratedProblem[] {
  if (typeof input.seed !== "string" || input.seed.length === 0) {
    throw new TypeError("Problem-set generation requires a non-empty string seed.");
  }
  if (!Number.isSafeInteger(input.count) || input.count < 0) {
    throw new RangeError("Problem-set count must be a nonnegative safe integer.");
  }
  const requestedSkills = input.skillId ? [input.skillId] : [...(input.skillIds ?? [])];
  if (requestedSkills.length === 0 || requestedSkills.some((skillId) => !isSkillId(skillId))) {
    throw new RangeError("Problem-set generation requires at least one valid adaptive skill.");
  }
  if (input.formats?.length === 0) {
    throw new RangeError("formats cannot be an empty collection.");
  }
  if (input.formats?.some((format) => format !== "horizontal" && format !== "vertical")) {
    throw new RangeError("Problem-set formats must be horizontal or vertical.");
  }
  if (requestedSkills.length === 1 && requestedSkills[0] === "F01" && input.count > 5) {
    throw new RangeError("A single session can contain at most five distinct complement pairs.");
  }

  const skillRandom = createAdaptiveRandom(deriveAdaptiveSeed(input.seed, "skill-order"));
  const fingerprints = new Set(input.excludedFingerprints ?? []);
  const complementPairs = new Set<string>();
  const problems: GeneratedProblem[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const skillId =
      requestedSkills.length === 1 ? requestedSkills[0]! : randomChoice(skillRandom, requestedSkills);
    const format =
      input.format ??
      (input.formats
        ? input.formats[index % input.formats.length]
        : undefined);
    const slotSeed = deriveAdaptiveSeed(input.seed, "card", index, skillId);
    let problem: GeneratedProblem | null = null;
    for (let retry = 0; retry < MAX_PROBLEM_GENERATION_ATTEMPTS; retry += 1) {
      const retrySeed = retry === 0 ? slotSeed : deriveAdaptiveSeed(slotSeed, "pair-retry", retry);
      const candidate = generateProblem({
        skillId,
        seed: retrySeed,
        excludedFingerprints: fingerprints,
        format,
        difficulty: input.difficulty,
      });
      const pairKey = f01PairKey(candidate);
      if (pairKey && complementPairs.has(pairKey)) {
        fingerprints.add(candidate.fingerprint);
        continue;
      }
      problem = candidate;
      if (pairKey) complementPairs.add(pairKey);
      break;
    }
    if (!problem) {
      throw new Error(`Unable to produce a session-distinct ${skillId} problem for card ${index + 1}.`);
    }
    fingerprints.add(problem.fingerprint);
    problems.push(problem);
  }
  return problems;
}

export function normalizeProblemAnswer(
  problem: GeneratedProblem,
  rawAnswer: unknown,
): ProblemAnswer | null {
  if (problem.answerSpec.kind === "numeric") {
    if (typeof rawAnswer === "number") {
      return Number.isSafeInteger(rawAnswer) ? rawAnswer : null;
    }
    if (typeof rawAnswer !== "string") return null;
    const trimmed = rawAnswer.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  if (typeof rawAnswer === "boolean") return rawAnswer ? "yes" : "no";
  if (typeof rawAnswer !== "string") return null;
  const normalized = rawAnswer.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y" || normalized === "true") return "yes";
  if (normalized === "no" || normalized === "n" || normalized === "false") return "no";
  return null;
}

export function evaluateProblemAnswer(
  problem: GeneratedProblem,
  rawAnswer: unknown,
): ProblemEvaluation {
  const normalizedAnswer = normalizeProblemAnswer(problem, rawAnswer);
  return {
    correct: normalizedAnswer !== null && normalizedAnswer === problem.expectedAnswer,
    normalizedAnswer,
    expectedAnswer: problem.expectedAnswer,
  };
}

export function promptSpecForProblem(problem: GeneratedProblem): ProblemPromptSpec {
  return problem.promptSpec;
}
