import {
  exactNumbersEqual,
  integerExact,
  parseExactAnswer,
} from "./exact-number.ts";
import {
  G1_CURRICULUM_VERSION,
  G1_GENERATOR_KINDS,
  G1_SKILL_IDS,
  G1_SKILLS,
  getG1Skill,
  isG1SkillId,
  type G1SkillId,
} from "./g1-curriculum.ts";
import type {
  AnswerEvaluation,
  Distractor,
  GenerationOptions,
  Orientation,
  PromptAst,
  QuestionInstance,
  SolutionStep,
  SubmittedAnswer,
} from "./types.ts";

export const G1_GENERATOR_VERSION = "g1-v3";
const G1_GENERATOR_SELECTION_VERSION = "g1-v2";
export { G1_GENERATOR_KINDS };

export interface G1FixtureSeed {
  readonly name: string;
  readonly skillId: G1SkillId;
  readonly seed: string;
  readonly difficultyBand: 1 | 2 | 3 | 4;
}

export interface G1CanonicalFixtureSeed extends G1FixtureSeed {
  readonly expectedFingerprint: string;
}

export interface G1BoundaryFixtureSeed extends G1FixtureSeed {
  readonly expectedOperands: readonly number[];
  readonly expectedAnswer: number;
}

export interface G1FactGenerationOptions {
  readonly skillId: G1SkillId;
  readonly factKey: string;
  readonly seed: string;
  readonly orientation?: Orientation;
}

/** Normative global boundaries that fall inside the Grade 1 skill inventory. */
export const G1_BOUNDARY_FIXTURE_SEEDS: readonly G1BoundaryFixtureSeed[] = Object.freeze([
  Object.freeze({
    name: "g1-boundary-9-plus-1",
    skillId: "G1-AS-03",
    seed: "boundary:G1-AS-03:14",
    difficultyBand: 4,
    expectedOperands: Object.freeze([9, 1]),
    expectedAnswer: 10,
  }),
  Object.freeze({
    name: "g1-boundary-99-plus-1",
    skillId: "G1-AS-10",
    seed: "boundary:G1-AS-10:22",
    difficultyBand: 4,
    expectedOperands: Object.freeze([99, 1]),
    expectedAnswer: 100,
  }),
]);

type BinaryOperator = "+" | "-" | "×" | "÷";
type Unknown = "result" | { readonly operandIndex: 0 | 1 };
type PartWholeRepresentation = Extract<
  PromptAst,
  { kind: "part-whole" }
>["representation"];

const PART_WHOLE_REPRESENTATIONS = Object.freeze([
  "dot-parts",
  "number-bond",
  "equation",
] as const satisfies readonly PartWholeRepresentation[]);

interface Candidate {
  readonly operands: readonly number[];
  readonly answer: number;
  readonly operator: BinaryOperator;
  readonly unknown: Unknown;
  readonly score: number;
  readonly tags: readonly string[];
  readonly promptKind?: "part-whole" | "equal-groups" | "division-model";
  readonly representation?: "groups" | "array" | "repeated-addition" | "sharing" | "grouping";
}

function seedHash(seed: string): number {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("Arithmetic question seeds must be non-empty strings.");
  }
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = seedHash(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function choose<T>(random: () => number, values: readonly T[]): T {
  if (values.length === 0) throw new RangeError("Cannot select from an empty candidate set.");
  return values[Math.floor(random() * values.length)]!;
}

function digits(value: number): number {
  return Math.max(1, String(Math.abs(value)).length);
}

function trailingZeroCount(value: number): number {
  if (value === 0) return 0;
  return String(Math.abs(value)).match(/0+$/)?.[0].length ?? 0;
}

function internalZeroCount(value: number): number {
  const digitsOnly = String(Math.abs(value));
  if (digitsOnly.length < 3) return 0;
  return [...digitsOnly.slice(1, -1)].filter((digit) => digit === "0").length;
}

function additionRegroupPositions(left: number, right: number): readonly string[] {
  const positions: string[] = [];
  const onesCarry = left % 10 + (right % 10) >= 10;
  if (onesCarry) positions.push("ones");
  if (Math.floor(left / 10) + Math.floor(right / 10) + (onesCarry ? 1 : 0) >= 10) {
    positions.push("tens");
  }
  return positions;
}

function subtractionRegroupPositions(left: number, right: number): readonly string[] {
  return left % 10 < right % 10 ? ["ones"] : [];
}

function crossesDecade(left: number, answer: number): boolean {
  return Math.floor(left / 10) !== Math.floor(answer / 10);
}

function candidate(
  operands: readonly number[],
  operator: BinaryOperator,
  answer: number,
  tags: readonly string[],
  extra: Partial<Omit<Candidate, "operands" | "operator" | "answer" | "tags" | "score">> = {},
): Candidate {
  const maximum = Math.max(answer, ...operands);
  const boundaryBonus = [0, 5, 9, 10, 18, 20, 40, 90, 99, 100].includes(maximum) ? 20 : 0;
  return { operands, operator, answer, tags, unknown: "result", score: maximum * 4 + operands.reduce((a, b) => a + b, 0) + boundaryBonus, ...extra };
}

function buildPartWhole(maximumTotal: number, skillId: G1SkillId): Candidate[] {
  const values: Candidate[] = [];
  for (let total = 0; total <= maximumTotal; total += 1) {
    for (let known = 0; known <= total; known += 1) {
      const missing = total - known;
      const tags = skillId === "G1-AS-01"
        ? [total <= 2 ? "total_0_to_2" : "total_3_to_5", known === 0 || missing === 0 ? "zero_part" : "two_nonzero_parts"]
        : [total === 10 ? "complement_to_10" : total >= 6 ? "total_6_to_9" : "total_0_to_5", known === 0 || missing === 0 ? "zero_part" : "two_nonzero_parts"];
      values.push(candidate([known, missing, total], "+", missing, tags, { promptKind: "part-whole" }));
    }
  }
  return values;
}

function buildAdditionFacts(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
  predicate: (left: number, right: number, sum: number) => boolean,
  tags: (left: number, right: number, sum: number) => readonly string[],
): Candidate[] {
  const values: Candidate[] = [];
  for (let left = leftMin; left <= leftMax; left += 1) {
    for (let right = rightMin; right <= rightMax; right += 1) {
      const sum = left + right;
      if (predicate(left, right, sum)) values.push(candidate([left, right], "+", sum, tags(left, right, sum)));
    }
  }
  return values;
}

function buildSubtractionFacts(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
  predicate: (left: number, right: number, difference: number) => boolean,
  tags: (left: number, right: number, difference: number) => readonly string[],
): Candidate[] {
  const values: Candidate[] = [];
  for (let left = leftMin; left <= leftMax; left += 1) {
    for (let right = rightMin; right <= rightMax; right += 1) {
      const difference = left - right;
      if (predicate(left, right, difference)) values.push(candidate([left, right], "-", difference, tags(left, right, difference)));
    }
  }
  return values;
}

function multiplicationCandidates(completeRows: boolean, model: boolean): Candidate[] {
  const representations = ["groups", "array", "repeated-addition"] as const;
  if (!model) {
    const presentations = new Map<
      string,
      { left: number; right: number; product: number; tags: Set<string> }
    >();
    const addPresentation = (
      left: number,
      right: number,
      focus: number,
      orientation: "focus_factor_left" | "focus_factor_right",
    ): void => {
      const key = `${left}:${right}`;
      const existing = presentations.get(key) ?? {
        left,
        right,
        product: left * right,
        tags: new Set<string>(),
      };
      existing.tags.add(`row_${focus}`);
      existing.tags.add(orientation);
      presentations.set(key, existing);
    };
    for (const focus of [2, 5, 10]) {
      for (let other = 0; other <= 10; other += 1) {
        const product = focus * other;
        if (!completeRows && product > 40) continue;
        addPresentation(focus, other, focus, "focus_factor_left");
        if (focus !== other) {
          addPresentation(other, focus, focus, "focus_factor_right");
        }
      }
    }
    return [...presentations.values()].map(({ left, right, product, tags }) =>
      candidate([left, right], "×", product, [...tags]));
  }

  const values: Candidate[] = [];
  for (const focus of [2, 5, 10]) {
    for (let other = 0; other <= 10; other += 1) {
      const product = focus * other;
      if (!completeRows && product > 40) continue;
      for (const representation of representations) {
        values.push(candidate([other, focus], "×", product, [
          representation === "groups" ? "equal_groups" : representation.replaceAll("-", "_"),
          `row_${focus}`,
        ], { promptKind: "equal-groups", representation }));
      }
    }
  }
  return values;
}

function divisionCandidates(completeRows: boolean, model: boolean): Candidate[] {
  const values: Candidate[] = [];
  const representations = ["sharing", "grouping"] as const;
  for (const divisor of [2, 5, 10]) {
    for (let quotient = 0; quotient <= 10; quotient += 1) {
      const dividend = divisor * quotient;
      if (!completeRows && dividend > 40) continue;
      const baseTags = [`divisor_${divisor}`, dividend === 0 ? "zero_dividend" : "positive_dividend"];
      if (model) {
        for (const representation of representations) {
          values.push(candidate([dividend, divisor], "÷", quotient, [representation, ...baseTags], {
            promptKind: "division-model",
            representation,
          }));
        }
      } else {
        values.push(candidate([dividend, divisor], "÷", quotient, baseTags));
      }
    }
  }
  return values;
}

function buildCandidatePool(skillId: G1SkillId): Candidate[] {
  switch (skillId) {
    case "G1-AS-01": return buildPartWhole(5, skillId);
    case "G1-AS-02": return buildPartWhole(10, skillId);
    case "G1-AS-03": return buildAdditionFacts(0, 9, 0, 9, (_a, _b, sum) => sum <= 10, (a, b) => [
      a === 0 || b === 0 ? "zero_addend" : a === b ? "doubles" : "mixed_fact",
    ]);
    case "G1-AS-04": return buildSubtractionFacts(0, 9, 0, 9, (_a, _b, difference) => difference >= 0, (a, b) => [
      b === 0 ? "subtract_zero" : a === b ? "subtract_all" : "mixed_fact",
    ]);
    case "G1-AS-05": return buildAdditionFacts(0, 9, 0, 9, (_a, _b, sum) => sum >= 11 && sum <= 18, (a, b) => [
      a === b ? "doubles" : Math.abs(a - b) === 1 ? "near_doubles" : "make_ten",
    ]);
    case "G1-AS-06": return buildSubtractionFacts(10, 18, 0, 9, (_a, _b, difference) => difference >= 0, (a, b, difference) => [
      b === 0 ? "subtract_zero" : crossesDecade(a, difference) ? "decade_crossing" : "no_decade_crossing",
    ]);
    case "G1-AS-07": {
      return [
        ...buildAdditionFacts(0, 20, 0, 20, (_a, _b, sum) => sum <= 20, (_a, _b, sum) => ["addition", sum === 10 || sum === 20 ? "result_10_or_20" : "other_result"]),
        ...buildSubtractionFacts(0, 20, 0, 20, (_a, _b, difference) => difference >= 0, (_a, _b, difference) => ["subtraction", difference === 10 || difference === 20 ? "result_10_or_20" : "other_result"]),
      ];
    }
    case "G1-AS-08": {
      const values: Candidate[] = [];
      for (let a = 0; a <= 9; a += 1) for (let b = 0; b <= 9; b += 1) for (let c = 0; c <= 9; c += 1) {
        const sum = a + b + c;
        if (sum > 20) continue;
        const makeTen = a + b === 10 || a + c === 10 || b + c === 10;
        values.push(candidate([a, b, c], "+", sum, [
          a === 0 || b === 0 || c === 0 ? "contains_zero" : makeTen ? "make_ten_pair" : "no_make_ten_pair",
        ]));
      }
      return values;
    }
    case "G1-AS-09": return buildAdditionFacts(10, 99, 0, 9, (_a, _b, sum) => sum <= 99 && !crossesDecade(_a, sum), (a, b) => [
      b === 0 ? "zero_addend" : a % 10 + b <= 4 ? "low_ones_sum" : "high_ones_sum",
    ]);
    case "G1-AS-10": return buildAdditionFacts(10, 99, 1, 9, (a, _b, sum) => sum <= 100 && crossesDecade(a, sum), (_a, _b, sum) => [
      sum <= 49 ? "result_20_to_49" : sum <= 89 ? "result_50_to_89" : "result_90_to_100",
    ]);
    case "G1-AS-11": return buildSubtractionFacts(10, 99, 0, 9, (a, _b, difference) => difference >= 0 && !crossesDecade(a, difference), (a, b, difference) => [
      b === 0 ? "subtract_zero" : difference % 10 === 0 ? "equal_ones" : "positive_ones_result",
    ]);
    case "G1-AS-12": return buildSubtractionFacts(10, 99, 1, 9, (a, _b, difference) => difference >= 0 && crossesDecade(a, difference), (a, _b, difference) => [
      a % 10 === 0 ? "minuend_ends_zero" : difference < 10 ? "small_difference" : "large_minuend",
    ]);
    case "G1-AS-13": {
      const values: Candidate[] = [];
      for (let left = 10; left <= 99; left += 1) for (let right = 10; right <= 90; right += 10) {
        if (left + right <= 100) values.push(candidate([left, right], "+", left + right, ["addition", (left + right) % 10 === 0 ? "result_ends_zero" : "result_keeps_ones"]));
        if (left - right >= 0) values.push(candidate([left, right], "-", left - right, ["subtraction", (left - right) % 10 === 0 ? "result_ends_zero" : "result_keeps_ones"]));
      }
      return values;
    }
    case "G1-AS-14": return buildAdditionFacts(10, 99, 10, 99, (a, b, sum) => sum <= 100 && additionRegroupPositions(a, b).length === 0, (a, b, sum) => [
      a % 10 + (b % 10) <= 4 ? "ones_sum_zero_to_four" : "ones_sum_five_to_nine",
      String(sum).includes("0") ? "result_contains_zero" : "result_no_zero",
    ]);
    case "G1-AS-15": return buildAdditionFacts(10, 99, 10, 99, (a, b, sum) => sum <= 100 && additionRegroupPositions(a, b).length === 1, (a, b, sum) => [
      additionRegroupPositions(a, b)[0] === "ones" ? "ones_regroup" : "new_hundred_regroup",
      sum >= 90 ? "sum_near_100" : "sum_below_90",
    ]);
    case "G1-AS-16": return buildSubtractionFacts(10, 99, 10, 99, (a, _b, difference) => difference >= 0 && subtractionRegroupPositions(a, _b).length === 0, (_a, _b, difference) => [
      difference % 10 === 0 ? "zero_ones_result" : "ordinary_difference",
      String(difference).includes("0") ? "result_contains_zero" : "result_no_zero",
    ]);
    case "G1-AS-17": return buildSubtractionFacts(10, 99, 10, 99, (a, b, difference) => difference >= 0 && subtractionRegroupPositions(a, b).length === 1, (a, _b, difference) => [
      a % 10 === 0 ? "minuend_ends_zero" : difference < 10 ? "small_difference" : "ordinary_difference",
      String(difference).includes("0") ? "result_contains_zero" : "result_no_zero",
    ]);
    case "G1-AS-18": {
      const values: Candidate[] = [];
      for (let left = 0; left <= 20; left += 1) for (let right = 0; right <= 20; right += 1) {
        const sum = left + right;
        if (sum <= 20) {
          values.push(candidate([left, right], "+", left, ["missing_addend"], { unknown: { operandIndex: 0 } }));
          values.push(candidate([left, right], "+", right, ["missing_addend"], { unknown: { operandIndex: 1 } }));
        }
        const difference = left - right;
        if (difference >= 0) {
          values.push(candidate([left, right], "-", left, ["missing_minuend"], { unknown: { operandIndex: 0 } }));
          values.push(candidate([left, right], "-", right, ["missing_subtrahend"], { unknown: { operandIndex: 1 } }));
        }
      }
      return values;
    }
    case "G1-M-01": return multiplicationCandidates(false, true);
    case "G1-M-02": return multiplicationCandidates(false, false);
    case "G1-D-01": return divisionCandidates(false, true);
    case "G1-D-02": return divisionCandidates(false, false);
    case "G1-M-03": return multiplicationCandidates(true, false);
    case "G1-D-03": return divisionCandidates(true, false);
  }
}

const candidatePools = new Map<G1SkillId, readonly Candidate[]>();
const intrinsicBandMaps = new Map<
  G1SkillId,
  ReadonlyMap<string, 1 | 2 | 3 | 4>
>();

function candidatesForSkill(skillId: G1SkillId): readonly Candidate[] {
  const cached = candidatePools.get(skillId);
  if (cached) return cached;
  const generated = buildCandidatePool(skillId);
  if (generated.length < 4) throw new Error(`Generator ${skillId} has too few valid candidates.`);
  candidatePools.set(skillId, Object.freeze(generated));
  return generated;
}

function candidateFactKey(value: Candidate): string {
  const operands = value.operator === "×"
    ? [...value.operands].sort((left, right) => left - right)
    : value.operands;
  return `${value.operator}:${operands.join(":")}`;
}

function candidateSemanticKey(value: Candidate): string {
  const unknown = value.unknown === "result"
    ? "result"
    : `operand:${value.unknown.operandIndex}`;
  return [
    value.promptKind ?? "equation",
    value.representation ?? "numeric",
    value.operator,
    value.operands.join(","),
    unknown,
    value.answer,
  ].join("|");
}

function intrinsicBandsForSkill(
  skillId: G1SkillId,
): ReadonlyMap<string, 1 | 2 | 3 | 4> {
  const cached = intrinsicBandMaps.get(skillId);
  if (cached) return cached;
  const cohorts = new Map<string, Candidate[]>();
  for (const value of candidatesForSkill(skillId)) {
    const cohort = value.tags[0] ?? "all";
    const members = cohorts.get(cohort) ?? [];
    members.push(value);
    cohorts.set(cohort, members);
  }
  const result = new Map<string, 1 | 2 | 3 | 4>();
  for (const members of cohorts.values()) {
    const sorted = [...members].sort(
      (left, right) =>
        left.score - right.score ||
        candidateSemanticKey(left).localeCompare(candidateSemanticKey(right)),
    );
    for (let index = 0; index < sorted.length; index += 1) {
      const band = Math.min(
        4,
        Math.floor((index * 4) / sorted.length) + 1,
      ) as 1 | 2 | 3 | 4;
      const key = candidateSemanticKey(sorted[index]!);
      if (result.has(key)) {
        throw new Error(`${skillId} contains duplicate semantic candidate ${key}.`);
      }
      result.set(key, band);
    }
  }
  intrinsicBandMaps.set(skillId, result);
  return result;
}

function promptAstFor(
  value: Candidate,
  orientation: Orientation,
  skillId: G1SkillId,
  partWholeRepresentation: PartWholeRepresentation | null,
): PromptAst {
  if (value.promptKind === "part-whole") {
    if (partWholeRepresentation === null) {
      throw new Error("Part-whole prompts require an explicit representation.");
    }
    return {
      kind: "part-whole",
      representation: partWholeRepresentation,
      knownPart: value.operands[0]!,
      total: value.operands[2]!,
      unknown: "missing-part",
      maximumTotal: skillId === "G1-AS-01" ? 5 : 10,
    };
  }
  if (value.promptKind === "equal-groups") {
    return {
      kind: "equal-groups",
      groupCount: value.operands[0]!,
      groupSize: value.operands[1]!,
      representation: value.representation as "groups" | "array" | "repeated-addition",
      unknown: "product",
    };
  }
  if (value.promptKind === "division-model") {
    return {
      kind: "division-model",
      dividend: value.operands[0]!,
      divisor: value.operands[1]!,
      representation: value.representation as "sharing" | "grouping",
      unknown: "quotient",
    };
  }
  const result = value.operator === "+"
    ? value.operands.reduce((sum, operand) => sum + operand, 0)
    : value.operator === "-"
      ? value.operands[0]! - value.operands[1]!
      : value.operator === "×"
        ? value.operands[0]! * value.operands[1]!
        : value.operands[0]! / value.operands[1]!;
  return {
    kind: "equation",
    operator: value.operator,
    operands: value.operands.map(integerExact),
    unknown: value.unknown,
    result: integerExact(result),
    orientation,
  };
}

function renderPrompt(ast: PromptAst): string {
  if (ast.kind === "part-whole") {
    if (ast.representation === "number-bond") {
      return `Number bond: ${ast.total} is made from ${ast.knownPart} and □`;
    }
    if (ast.representation === "dot-parts") {
      return `Dot parts: ${ast.knownPart} and □ make ${ast.total}`;
    }
    return `${ast.knownPart} + □ = ${ast.total}`;
  }
  if (ast.kind === "equal-groups") {
    if (ast.representation === "array") return `${ast.groupCount} rows of ${ast.groupSize} =`;
    if (ast.representation === "repeated-addition") {
      return `${Array.from({ length: ast.groupCount }, () => ast.groupSize).join(" + ") || "0"} =`;
    }
    return `${ast.groupCount} groups of ${ast.groupSize} =`;
  }
  if (ast.kind === "division-model") {
    return ast.representation === "sharing"
      ? `${ast.dividend} shared among ${ast.divisor} equal groups =`
      : `How many groups of ${ast.divisor} are in ${ast.dividend}`;
  }
  const values = ast.operands.map((operand, index) =>
    typeof ast.unknown === "object" && ast.unknown.operandIndex === index ? "□" : String(operand.value));
  if (ast.orientation === "vertical" && ast.operands.length === 2 && ast.unknown === "result") {
    return `${values[0]}\n${ast.operator} ${values[1]}\n────`;
  }
  const result = ast.unknown === "result" ? "" : String(ast.result.value);
  return `${values.join(` ${ast.operator} `)} = ${result}`.trimEnd();
}

function solutionTraceFor(value: Candidate): readonly SolutionStep[] {
  if (value.promptKind === "part-whole") return [{ kind: "model", text: "The two parts join to make the total.", expression: `${value.operands[0]} + ${value.answer} = ${value.operands[2]}` }];
  if (value.promptKind === "equal-groups") return [{ kind: "model", text: "Every group has the same size.", expression: `${value.operands[0]} × ${value.operands[1]} = ${value.answer}` }];
  if (value.promptKind === "division-model") return [{ kind: "inverse-check", text: "Multiply the number of groups by the group size to check.", expression: `${value.answer} × ${value.operands[1]} = ${value.operands[0]}` }];
  if (value.unknown !== "result") return [{ kind: "inverse-check", text: "Use the inverse relationship to find the missing number.", expression: `${value.operands.join(` ${value.operator} `)} = ${value.operator === "+" ? value.operands.reduce((a, b) => a + b, 0) : value.operands[0]! - value.operands[1]!}` }];
  return [{ kind: "calculate", text: "Calculate the shown operation exactly.", expression: `${value.operands.join(` ${value.operator} `)} = ${value.answer}` }];
}

function misconceptionDistractors(value: Candidate, skillId: G1SkillId): readonly Distractor[] {
  const skill = getG1Skill(skillId);
  const proposed: Array<readonly [number, string]> = [];
  if (value.operator === "+") {
    proposed.push([Math.abs(value.operands[0]! - value.operands[1]!), "operation_reversal"]);
    proposed.push([Math.max(0, value.answer - 10), "omitted_carry"]);
    proposed.push([value.answer + 1, "count_all"]);
    proposed.push([Math.max(0, value.answer - 1), "count_from_one"]);
  } else if (value.operator === "-") {
    proposed.push([value.operands[0]! + value.operands[1]!, "operation_reversal"]);
    proposed.push([Math.abs((value.operands[0]! % 10) - (value.operands[1]! % 10)) + 10 * Math.abs(Math.floor(value.operands[0]! / 10) - Math.floor(value.operands[1]! / 10)), "subtract_smaller_digit_from_larger"]);
    proposed.push([value.answer + 10, "borrow_without_decomposing"]);
    proposed.push([value.answer + 1, "count_from_one"]);
  } else if (value.operator === "×") {
    proposed.push([value.answer + value.operands[1]!, "repeated_addition_error"]);
    proposed.push([Math.max(0, value.answer - value.operands[1]!), "fact_family_confusion"]);
    proposed.push([value.operands[0]! + value.operands[1]!, "repeated_addition_error"]);
  } else {
    proposed.push([value.answer + 1, "poor_quotient_estimate"]);
    proposed.push([Math.max(0, value.answer - 1), "fact_family_confusion"]);
    proposed.push([value.operands[1]!, "dividend_divisor_reversal"]);
  }
  const allowed = new Set(skill.misconceptionTags);
  const seen = new Set<number>([value.answer]);
  const result: Distractor[] = [];
  for (const [wrong, proposedTag] of proposed) {
    if (!Number.isSafeInteger(wrong) || wrong < 0 || seen.has(wrong)) continue;
    seen.add(wrong);
    const misconceptionTag = allowed.has(proposedTag) ? proposedTag : skill.misconceptionTags[0]!;
    result.push({ value: integerExact(wrong), renderedValue: String(wrong), misconceptionTag });
    if (result.length === 3) break;
  }
  for (let offset = 2; result.length < 3; offset += 1) {
    const wrong = value.answer + offset;
    if (seen.has(wrong)) continue;
    seen.add(wrong);
    result.push({ value: integerExact(wrong), renderedValue: String(wrong), misconceptionTag: skill.misconceptionTags[0]! });
  }
  return result;
}

function difficultyFeaturesFor(
  value: Candidate,
  orientation: Orientation,
  expectedMethod: string,
  partWholeRepresentation: PartWholeRepresentation | null,
): Readonly<Record<string, string | number | boolean>> {
  const left = value.operands[0] ?? 0;
  const right = value.operands[1] ?? 0;
  const actualAddends = value.promptKind === "part-whole" ? value.operands.slice(0, 2) : value.operands;
  const regroupPositions = value.operator === "+"
    ? actualAddends.length > 2
      ? actualAddends.reduce((sum, operand) => sum + operand, 0) >= 10 ? ["ones"] : []
      : additionRegroupPositions(left, right)
    : value.operator === "-"
      ? subtractionRegroupPositions(left, right)
      : [];
  const operationResult = value.promptKind === "part-whole"
    ? value.operands[2]!
    : value.unknown === "result"
      ? value.answer
      : value.operator === "+"
        ? actualAddends.reduce((sum, operand) => sum + operand, 0)
        : value.operator === "-"
          ? left - right
          : value.answer;
  const boundaryValues = [10, 20, 40, 100];
  const features: Record<string, string | number | boolean> = {
    leftOperandDigitCount: digits(left),
    rightOperandDigitCount: digits(right),
    numberOfAddends: value.operator === "+" ? (value.promptKind === "part-whole" ? 2 : value.operands.length) : 0,
    regroupCount: regroupPositions.length,
    regroupPositions: regroupPositions.join(","),
    crossesPowerOfTenBoundary: value.operator === "+" || value.operator === "-" ? crossesDecade(left, operationResult) : false,
    zeroChainLength: value.operator === "-" && regroupPositions.length > 0 && left % 10 === 0 ? 1 : 0,
    unknownKind: value.promptKind === "part-whole"
      ? "missing_part"
      : value.unknown === "result" ? "result" : `operand_${value.unknown.operandIndex}`,
    orientation,
    expectedMethod,
    operation: value.operator,
    operandCount: value.operands.length,
    maximumOperand: Math.max(...value.operands),
    nearBoundary: [value.answer, ...value.operands].some((operand) => boundaryValues.some((boundary) => Math.abs(operand - boundary) <= 1)),
    factKey: candidateFactKey(value),
    requestedAnswerRepresentation: "integer",
  };
  if (value.promptKind === "part-whole" && partWholeRepresentation !== null) {
    features.representation = partWholeRepresentation;
    features.surfaceForm = `part-whole:${partWholeRepresentation}`;
  }
  if (value.operator === "×") {
    const rows = value.tags
      .filter((tag) => /^row_(2|5|10)$/.test(tag))
      .map((tag) => tag.slice(4))
      .sort((a, b) => Number(a) - Number(b));
    const zeroFactorCount = value.operands.filter((operand) => operand === 0).length;
    const shortcutKind = value.operands.includes(0)
      ? "zero_property"
      : value.operands.includes(1)
        ? "identity_property"
        : value.operands.includes(10)
          ? "times_ten"
          : value.operands.includes(5)
            ? "times_five"
            : value.operands.includes(2)
              ? "doubling"
              : "none";
    Object.assign(features, {
      leftFactorDigitCount: digits(left),
      rightFactorDigitCount: digits(right),
      factorDigitCounts: `${digits(left)},${digits(right)}`,
      factFamily: rows.join(",") || "equal_groups",
      carryCount: 0,
      carryPositions: "",
      containsZeroFactor: zeroFactorCount > 0,
      zeroFactorCount,
      internalZeroCount: value.operands.reduce(
        (count, operand) => count + internalZeroCount(operand),
        0,
      ),
      trailingZeroCount: value.operands.reduce(
        (count, operand) => count + trailingZeroCount(operand),
        0,
      ),
      nonzeroPartialProductCount: value.answer === 0 ? 0 : 1,
      productDigitCount: digits(value.answer),
      shortcutAvailable: shortcutKind !== "none",
      shortcutKind,
      distributiveShortcutAvailable: false,
      cancellationAvailable: false,
      focusFactorOrientation:
        value.tags.includes("focus_factor_left") && value.tags.includes("focus_factor_right")
          ? "both"
          : value.tags.includes("focus_factor_right")
            ? "right"
            : "left",
    });
  }
  if (value.operator === "÷") {
    Object.assign(features, {
      dividendDigitCount: digits(left),
      divisorDigitCount: digits(right),
      quotientDigitCount: digits(value.answer),
      divisionExact: true,
      remainderValue: 0,
      remainderSize: "zero",
      quotientContainsZero: String(value.answer).includes("0"),
      leadingQuotientEstimate: value.answer,
      quotientEstimateRequired: false,
      quotientEstimateCorrections: 0,
    });
  }
  return features;
}

export function requiredCoverageKeysForSkill(skillId: string): readonly string[] {
  return getG1Skill(skillId).generator.coverageRequirements.map((requirement) => requirement.key);
}

export function factUniverseForSkill(skillId: string): readonly string[] {
  const skill = getG1Skill(skillId);
  if (skill.masteryProfile !== "FACT") return [];
  return Object.freeze([...new Set(candidatesForSkill(skillId as G1SkillId).map(candidateFactKey))].sort());
}

export function factKeyForQuestion(question: QuestionInstance): string | null {
  if (question.promptAst.kind !== "equation") return null;
  const operands = question.promptAst.operands.map((operand) => operand.value);
  if (question.promptAst.operator === "×") operands.sort((left, right) => left - right);
  return `${question.promptAst.operator}:${operands.join(":")}`;
}

/** Learner-visible mathematical identity; cosmetic orientation and skill labels are omitted. */
export function g1QuestionContentFingerprint(question: QuestionInstance): string {
  const ast = question.promptAst;
  let prompt: string;
  switch (ast.kind) {
    case "equation":
      prompt = [
        "equation",
        ast.operator,
        ast.operands.map((operand) => operand.value).join(","),
        ast.unknown === "result" ? "result" : `operand:${ast.unknown.operandIndex}`,
        ast.result.value,
      ].join("|");
      break;
    case "part-whole":
      prompt = `part-whole|${ast.representation}|${ast.knownPart}|${ast.total}|${ast.unknown}`;
      break;
    case "equal-groups":
      prompt = `equal-groups|${ast.representation}|${ast.groupCount}|${ast.groupSize}`;
      break;
    case "division-model":
      prompt = `division-model|${ast.representation}|${ast.dividend}|${ast.divisor}`;
      break;
  }
  return `${prompt}|${JSON.stringify(question.exactAnswer)}`;
}

/** Skill-scoped identity retained for mastery facts and pinned fixture snapshots. */
export function g1QuestionSemanticFingerprint(question: QuestionInstance): string {
  return `${question.skillId}|${g1QuestionContentFingerprint(question)}`;
}

/** Mathematical task identity with structural presentation variants removed. */
export function g1QuestionMathematicalFingerprint(
  question: QuestionInstance,
): string {
  const ast = question.promptAst;
  let prompt: string;
  if (ast.kind === "equation") {
    const operands = ast.operator === "×"
      ? [...ast.operands].sort((left, right) => left.value - right.value)
      : ast.operands;
    prompt = [
      "equation",
      ast.operator,
      operands.map(({ value }) => value).join(","),
      ast.unknown === "result" ? "result" : `operand:${ast.unknown.operandIndex}`,
      ast.result.value,
    ].join("|");
  } else if (ast.kind === "part-whole") {
    prompt = `part-whole|${ast.knownPart}|${ast.total}|${ast.unknown}`;
  } else if (ast.kind === "equal-groups") {
    prompt = `equal-groups|${ast.groupCount}|${ast.groupSize}`;
  } else {
    prompt = `division-model|${ast.dividend}|${ast.divisor}`;
  }
  return `${prompt}|${JSON.stringify(question.exactAnswer)}`;
}

/** Stable, order-independent identity for the exact cards in an assessment. */
export function g1AssessmentQuestionSetFingerprint(
  questions: readonly QuestionInstance[],
): string {
  const semanticSet = questions
    .map(g1QuestionSemanticFingerprint)
    .sort()
    .join("\n");
  return seedHash(`g1-assessment-plan-v1|${semanticSet}`).toString(36);
}

function candidateKeyFromQuestion(question: QuestionInstance): string | null {
  if (question.exactAnswer.kind !== "integer") return null;
  const ast = question.promptAst;
  if (ast.kind === "equation") {
    return [
      "equation",
      "numeric",
      ast.operator,
      ast.operands.map((operand) => operand.value).join(","),
      ast.unknown === "result" ? "result" : `operand:${ast.unknown.operandIndex}`,
      question.exactAnswer.value,
    ].join("|");
  }
  if (ast.kind === "part-whole") {
    return ["part-whole", "numeric", "+", [ast.knownPart, question.exactAnswer.value, ast.total].join(","), "result", question.exactAnswer.value].join("|");
  }
  if (ast.kind === "equal-groups") {
    return ["equal-groups", ast.representation, "×", [ast.groupCount, ast.groupSize].join(","), "result", question.exactAnswer.value].join("|");
  }
  return ["division-model", ast.representation, "÷", [ast.dividend, ast.divisor].join(","), "result", question.exactAnswer.value].join("|");
}

function validateG1QuestionSnapshot(
  question: QuestionInstance,
  enforceIntrinsicBand: boolean,
  requireResolvedPresentation: boolean,
): boolean {
  try {
    if (
      !isG1SkillId(question.skillId) ||
      ![1, 2, 3, 4].includes(question.difficultyBand) ||
      (question.orientation !== "horizontal" && question.orientation !== "vertical") ||
      !Array.isArray(question.coverageTags) ||
      !question.coverageTags.every((tag) => typeof tag === "string") ||
      new Set(question.coverageTags).size !== question.coverageTags.length ||
      !question.acceptedAnswerForms.includes("integer")
    ) return false;
    if (requireResolvedPresentation) {
      const ast = question.promptAst;
      const supportedVertical =
        ast.kind === "equation" &&
        ast.unknown === "result" &&
        ast.operands.length === 2;
      if (question.orientation === "vertical" && !supportedVertical) return false;
      if (
        ast.kind === "part-whole" &&
        (!PART_WHOLE_REPRESENTATIONS.includes(ast.representation) ||
          question.difficultyFeatures.representation !== ast.representation ||
          question.difficultyFeatures.surfaceForm !== `part-whole:${ast.representation}`)
      ) return false;
    }
    const skillId = question.skillId;
    const key = candidateKeyFromQuestion(question);
    if (key === null) return false;
    const matching = candidatesForSkill(skillId).filter(
      (value) =>
        candidateSemanticKey(value) === key &&
        (!enforceIntrinsicBand ||
          intrinsicBandsForSkill(skillId).get(candidateSemanticKey(value)) ===
            question.difficultyBand),
    );
    if (matching.length === 0) return false;
    const allowedCoverage = new Set(matching.flatMap((value) => value.tags));
    const bandTag = `band_${question.difficultyBand}`;
    if (!question.coverageTags.includes(bandTag)) return false;
    if (question.coverageTags.some((tag) => tag !== bandTag && !allowedCoverage.has(tag))) {
      return false;
    }
    const required = new Set(requiredCoverageKeysForSkill(skillId));
    if (!question.coverageTags.some((tag) => required.has(tag))) return false;
    const candidateOperands = matching[0]!.operands;
    return question.operands.length === candidateOperands.length &&
      question.operands.every(
        (operand, index) =>
          operand.kind === "integer" && operand.value === candidateOperands[index],
      );
  } catch {
    return false;
  }
}

const validateG1V1QuestionSnapshot: G1QuestionSnapshotValidator = (question) =>
  validateG1QuestionSnapshot(question, false, false);

const validateG1V2QuestionSnapshot: G1QuestionSnapshotValidator = (question) =>
  validateG1QuestionSnapshot(question, true, false);

const validateG1V3QuestionSnapshot: G1QuestionSnapshotValidator = (question) =>
  validateG1QuestionSnapshot(question, true, true);

type G1QuestionSnapshotValidator = (question: QuestionInstance) => boolean;

/**
 * Historical validator registry. A generator bump must add a validator rather
 * than repointing old persisted evidence at the newest generator contract.
 * v1 through v3 share the same durable G1 candidate grammar. v2 changed
 * intrinsic bands; v3 added truthful structural-presentation metadata.
 */
const G1_QUESTION_SNAPSHOT_VALIDATORS: Readonly<
  Record<string, G1QuestionSnapshotValidator>
> = Object.freeze({
  "g1-v1": validateG1V1QuestionSnapshot,
  "g1-v2": validateG1V2QuestionSnapshot,
  "g1-v3": validateG1V3QuestionSnapshot,
});

export function g1QuestionSnapshotIsSemanticallyValid(
  question: QuestionInstance,
): boolean {
  if (typeof question.generatorVersion !== "string") return false;
  const validator = G1_QUESTION_SNAPSHOT_VALIDATORS[question.generatorVersion];
  return validator?.(question) ?? false;
}

function generateQuestionFromCandidate(
  skillId: G1SkillId,
  seed: string,
  difficultyBand: 1 | 2 | 3 | 4,
  orientation: Orientation,
  selected: Candidate,
): QuestionInstance {
  const skill = getG1Skill(skillId);
  const supportsVertical =
    selected.promptKind === undefined &&
    selected.unknown === "result" &&
    selected.operands.length === 2;
  const resolvedOrientation = orientation === "vertical" && !supportsVertical
    ? "horizontal"
    : orientation;
  const partWholeRepresentation = selected.promptKind === "part-whole"
    ? PART_WHOLE_REPRESENTATIONS[
        seedHash(`${skillId}|${seed}|part-whole-representation`) %
          PART_WHOLE_REPRESENTATIONS.length
      ]!
    : null;
  const promptAst = promptAstFor(
    selected,
    resolvedOrientation,
    skillId,
    partWholeRepresentation,
  );
  const answer = integerExact(selected.answer);
  const secondarySkillIds = skill.prerequisites.filter((_id, index) => index < 2);
  const coverageTags = [...new Set([`band_${difficultyBand}`, ...selected.tags])];
  const idToken = seedHash(
    `${skillId}|${seed}|${difficultyBand}|${resolvedOrientation}|${partWholeRepresentation ?? "numeric"}|${candidateFactKey(selected)}`,
  ).toString(36).padStart(7, "0");

  return Object.freeze({
    instanceId: `arithmetic-${skillId.toLowerCase()}-${idToken}`,
    skillId,
    secondarySkillIds,
    curriculumVersion: G1_CURRICULUM_VERSION,
    generatorVersion: G1_GENERATOR_VERSION,
    seed,
    promptAst,
    renderedPrompt: renderPrompt(promptAst),
    operands: selected.operands.map(integerExact),
    exactAnswer: answer,
    acceptedAnswerForms: skill.acceptedAnswerForms,
    difficultyBand,
    difficultyFeatures: difficultyFeaturesFor(
      selected,
      resolvedOrientation,
      skill.expectedMethod,
      partWholeRepresentation,
    ),
    solutionTrace: solutionTraceFor(selected),
    misconceptionDistractors: misconceptionDistractors(selected, skillId),
    coverageTags,
    orientation: resolvedOrientation,
  });
}

export function generateG1Question(options: GenerationOptions): QuestionInstance {
  if (!isG1SkillId(options.skillId)) throw new RangeError(`Unknown Grade 1 skill: ${options.skillId}`);
  if (typeof options.seed !== "string" || options.seed.length === 0) throw new TypeError("A non-empty seed is required.");
  const random = createRandom(`${G1_GENERATOR_SELECTION_VERSION}|${options.skillId}|${options.seed}`);
  const difficultyBand = options.difficultyBand ?? (Math.floor(random() * 4) + 1) as 1 | 2 | 3 | 4;
  if (![1, 2, 3, 4].includes(difficultyBand)) throw new RangeError("Difficulty band must be 1, 2, 3, or 4.");
  const orientation = options.orientation ?? (random() < 0.5 ? "horizontal" : "vertical");
  if (orientation !== "horizontal" && orientation !== "vertical") throw new RangeError("Orientation must be horizontal or vertical.");

  const targetCoverageKey = choose(random, requiredCoverageKeysForSkill(options.skillId));
  const allCandidates = candidatesForSkill(options.skillId);
  const intrinsicBands = intrinsicBandsForSkill(options.skillId);
  const bandPool = allCandidates.filter(
    (value) => intrinsicBands.get(candidateSemanticKey(value)) === difficultyBand,
  );
  if (bandPool.length === 0) {
    throw new Error(`${options.skillId} has no intrinsic candidates in band ${difficultyBand}.`);
  }
  const coveragePool = bandPool.filter((value) => value.tags.includes(targetCoverageKey));
  const selected = choose(random, coveragePool.length > 0 ? coveragePool : bandPool);
  return generateQuestionFromCandidate(
    options.skillId,
    options.seed,
    difficultyBand,
    orientation,
    selected,
  );
}

/**
 * Resolve one finite FACT identity directly. Session scheduling uses this to
 * present every normative fact before retention, including facts whose
 * intrinsic cohort is above the learner's ordinary practice band.
 */
export function generateG1FactQuestion(
  options: G1FactGenerationOptions,
): QuestionInstance {
  if (!isG1SkillId(options.skillId)) {
    throw new RangeError(`Unknown Grade 1 skill: ${options.skillId}`);
  }
  if (typeof options.seed !== "string" || options.seed.length === 0) {
    throw new TypeError("A non-empty seed is required.");
  }
  if (typeof options.factKey !== "string" || options.factKey.length === 0) {
    throw new TypeError("A non-empty fact key is required.");
  }
  const skill = getG1Skill(options.skillId);
  if (skill.masteryProfile !== "FACT") {
    throw new TypeError(`${options.skillId} does not have a finite FACT universe.`);
  }
  const matching = candidatesForSkill(options.skillId).filter(
    (value) => candidateFactKey(value) === options.factKey,
  );
  if (matching.length === 0) {
    throw new RangeError(`${options.factKey} is not in ${options.skillId}'s fact universe.`);
  }
  const random = createRandom(
    `${G1_GENERATOR_SELECTION_VERSION}|${options.skillId}|${options.seed}|${options.factKey}`,
  );
  const selected = choose(random, matching);
  const difficultyBand = intrinsicBandsForSkill(options.skillId).get(
    candidateSemanticKey(selected),
  );
  if (difficultyBand === undefined) {
    throw new Error(`No intrinsic difficulty band for ${options.factKey}.`);
  }
  const orientation = options.orientation ?? (random() < 0.5 ? "horizontal" : "vertical");
  return generateQuestionFromCandidate(
    options.skillId,
    options.seed,
    difficultyBand,
    orientation,
    selected,
  );
}

type G1PinnedCanonicalFixture = readonly [
  seed: string,
  difficultyBand: 1 | 2 | 3 | 4,
  expectedFingerprint: string,
];

/**
 * Generated offline and committed intentionally. These literals make the
 * canonical corpus editorially reviewable and prevent runtime seed searches.
 */
const G1_PINNED_CANONICAL_FIXTURES = {
  "G1-AS-01": [
    [
      "canonical-search:g1-v2:G1-AS-01:band-1:0",
      1,
      "G1-AS-01|part-whole|number-bond|1|3|missing-part|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-1:1",
      1,
      "G1-AS-01|part-whole|equation|1|1|missing-part|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-1:2",
      1,
      "G1-AS-01|part-whole|equation|0|1|missing-part|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-1:3",
      1,
      "G1-AS-01|part-whole|number-bond|0|3|missing-part|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-2:0",
      2,
      "G1-AS-01|part-whole|dot-parts|2|4|missing-part|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-2:1",
      2,
      "G1-AS-01|part-whole|equation|0|4|missing-part|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-2:5",
      2,
      "G1-AS-01|part-whole|equation|0|2|missing-part|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-2:7",
      2,
      "G1-AS-01|part-whole|equation|3|4|missing-part|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-3:0",
      3,
      "G1-AS-01|part-whole|equation|1|2|missing-part|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-3:1",
      3,
      "G1-AS-01|part-whole|number-bond|2|2|missing-part|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-4:0",
      4,
      "G1-AS-01|part-whole|dot-parts|0|0|missing-part|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-01:band-4:1",
      4,
      "G1-AS-01|part-whole|number-bond|4|5|missing-part|{\"kind\":\"integer\",\"value\":1}"
    ]
  ],
  "G1-AS-02": [
    [
      "canonical-search:g1-v2:G1-AS-02:band-1:0",
      1,
      "G1-AS-02|part-whole|number-bond|0|3|missing-part|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-1:1",
      1,
      "G1-AS-02|part-whole|number-bond|2|6|missing-part|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-1:2",
      1,
      "G1-AS-02|part-whole|equation|1|7|missing-part|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-1:3",
      1,
      "G1-AS-02|part-whole|equation|2|2|missing-part|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-2:0",
      2,
      "G1-AS-02|part-whole|equation|3|10|missing-part|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-2:1",
      2,
      "G1-AS-02|part-whole|equation|4|10|missing-part|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-2:2",
      2,
      "G1-AS-02|part-whole|dot-parts|0|4|missing-part|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-2:3",
      2,
      "G1-AS-02|part-whole|dot-parts|2|7|missing-part|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-3:0",
      3,
      "G1-AS-02|part-whole|dot-parts|5|8|missing-part|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-3:2",
      3,
      "G1-AS-02|part-whole|equation|7|10|missing-part|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-4:0",
      4,
      "G1-AS-02|part-whole|dot-parts|9|10|missing-part|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-02:band-4:1",
      4,
      "G1-AS-02|part-whole|dot-parts|5|9|missing-part|{\"kind\":\"integer\",\"value\":4}"
    ]
  ],
  "G1-AS-03": [
    [
      "canonical-search:g1-v2:G1-AS-03:band-1:0",
      1,
      "G1-AS-03|equation|+|3,1|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-1:1",
      1,
      "G1-AS-03|equation|+|0,3|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-1:2",
      1,
      "G1-AS-03|equation|+|0,1|result|1|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-1:3",
      1,
      "G1-AS-03|equation|+|1,6|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-2:0",
      2,
      "G1-AS-03|equation|+|3,3|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-2:1",
      2,
      "G1-AS-03|equation|+|3,0|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-2:3",
      2,
      "G1-AS-03|equation|+|0,6|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-2:4",
      2,
      "G1-AS-03|equation|+|0,0|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-3:0",
      3,
      "G1-AS-03|equation|+|6,0|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-3:1",
      3,
      "G1-AS-03|equation|+|6,3|result|9|{\"kind\":\"integer\",\"value\":9}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-4:0",
      4,
      "G1-AS-03|equation|+|1,9|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-03:band-4:1",
      4,
      "G1-AS-03|equation|+|9,1|result|10|{\"kind\":\"integer\",\"value\":10}"
    ]
  ],
  "G1-AS-04": [
    [
      "canonical-search:g1-v2:G1-AS-04:band-1:0",
      1,
      "G1-AS-04|equation|-|4,3|result|1|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-1:1",
      1,
      "G1-AS-04|equation|-|3,1|result|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-1:2",
      1,
      "G1-AS-04|equation|-|3,0|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-1:4",
      1,
      "G1-AS-04|equation|-|2,2|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-2:0",
      2,
      "G1-AS-04|equation|-|4,0|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-2:1",
      2,
      "G1-AS-04|equation|-|6,6|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-2:2",
      2,
      "G1-AS-04|equation|-|7,3|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-2:3",
      2,
      "G1-AS-04|equation|-|0,0|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-3:0",
      3,
      "G1-AS-04|equation|-|6,0|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-3:1",
      3,
      "G1-AS-04|equation|-|5,1|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-4:0",
      4,
      "G1-AS-04|equation|-|9,4|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-04:band-4:1",
      4,
      "G1-AS-04|equation|-|9,9|result|0|{\"kind\":\"integer\",\"value\":0}"
    ]
  ],
  "G1-AS-05": [
    [
      "canonical-search:g1-v2:G1-AS-05:band-1:0",
      1,
      "G1-AS-05|equation|+|6,6|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-1:1",
      1,
      "G1-AS-05|equation|+|5,6|result|11|{\"kind\":\"integer\",\"value\":11}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-1:5",
      1,
      "G1-AS-05|equation|+|3,8|result|11|{\"kind\":\"integer\",\"value\":11}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-1:7",
      1,
      "G1-AS-05|equation|+|6,5|result|11|{\"kind\":\"integer\",\"value\":11}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-2:0",
      2,
      "G1-AS-05|equation|+|6,7|result|13|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-2:1",
      2,
      "G1-AS-05|equation|+|7,6|result|13|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-2:2",
      2,
      "G1-AS-05|equation|+|7,7|result|14|{\"kind\":\"integer\",\"value\":14}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-2:6",
      2,
      "G1-AS-05|equation|+|7,5|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-3:0",
      3,
      "G1-AS-05|equation|+|8,7|result|15|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-3:1",
      3,
      "G1-AS-05|equation|+|5,8|result|13|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-4:0",
      4,
      "G1-AS-05|equation|+|9,8|result|17|{\"kind\":\"integer\",\"value\":17}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-05:band-4:1",
      4,
      "G1-AS-05|equation|+|9,9|result|18|{\"kind\":\"integer\",\"value\":18}"
    ]
  ],
  "G1-AS-06": [
    [
      "canonical-search:g1-v2:G1-AS-06:band-1:0",
      1,
      "G1-AS-06|equation|-|12,5|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-1:1",
      1,
      "G1-AS-06|equation|-|14,1|result|13|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-1:2",
      1,
      "G1-AS-06|equation|-|12,0|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-1:3",
      1,
      "G1-AS-06|equation|-|11,2|result|9|{\"kind\":\"integer\",\"value\":9}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-2:0",
      2,
      "G1-AS-06|equation|-|15,5|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-2:1",
      2,
      "G1-AS-06|equation|-|12,8|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-2:2",
      2,
      "G1-AS-06|equation|-|13,4|result|9|{\"kind\":\"integer\",\"value\":9}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-2:3",
      2,
      "G1-AS-06|equation|-|16,1|result|15|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-3:0",
      3,
      "G1-AS-06|equation|-|16,6|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-3:1",
      3,
      "G1-AS-06|equation|-|15,0|result|15|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-4:0",
      4,
      "G1-AS-06|equation|-|18,1|result|17|{\"kind\":\"integer\",\"value\":17}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-06:band-4:1",
      4,
      "G1-AS-06|equation|-|17,0|result|17|{\"kind\":\"integer\",\"value\":17}"
    ]
  ],
  "G1-AS-07": [
    [
      "canonical-search:g1-v2:G1-AS-07:band-1:0",
      1,
      "G1-AS-07|equation|+|5,0|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-1:1",
      1,
      "G1-AS-07|equation|-|7,4|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-1:2",
      1,
      "G1-AS-07|equation|-|11,1|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-1:3",
      1,
      "G1-AS-07|equation|-|12,2|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-2:0",
      2,
      "G1-AS-07|equation|-|13,1|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-2:1",
      2,
      "G1-AS-07|equation|-|12,8|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-2:2",
      2,
      "G1-AS-07|equation|-|10,0|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-2:3",
      2,
      "G1-AS-07|equation|+|7,3|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-3:0",
      3,
      "G1-AS-07|equation|+|11,5|result|16|{\"kind\":\"integer\",\"value\":16}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-3:1",
      3,
      "G1-AS-07|equation|+|8,2|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-4:0",
      4,
      "G1-AS-07|equation|+|9,10|result|19|{\"kind\":\"integer\",\"value\":19}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-07:band-4:1",
      4,
      "G1-AS-07|equation|-|20,10|result|10|{\"kind\":\"integer\",\"value\":10}"
    ]
  ],
  "G1-AS-08": [
    [
      "canonical-search:g1-v2:G1-AS-08:band-1:0",
      1,
      "G1-AS-08|equation|+|2,1,2|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-1:1",
      1,
      "G1-AS-08|equation|+|8,2,1|result|11|{\"kind\":\"integer\",\"value\":11}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-1:2",
      1,
      "G1-AS-08|equation|+|4,3,5|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-1:3",
      1,
      "G1-AS-08|equation|+|2,1,5|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-2:0",
      2,
      "G1-AS-08|equation|+|2,0,6|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-2:1",
      2,
      "G1-AS-08|equation|+|7,1,0|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-2:2",
      2,
      "G1-AS-08|equation|+|0,7,4|result|11|{\"kind\":\"integer\",\"value\":11}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-2:3",
      2,
      "G1-AS-08|equation|+|0,5,7|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-3:0",
      3,
      "G1-AS-08|equation|+|8,0,1|result|9|{\"kind\":\"integer\",\"value\":9}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-3:1",
      3,
      "G1-AS-08|equation|+|2,7,7|result|16|{\"kind\":\"integer\",\"value\":16}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-4:0",
      4,
      "G1-AS-08|equation|+|7,5,6|result|18|{\"kind\":\"integer\",\"value\":18}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-08:band-4:1",
      4,
      "G1-AS-08|equation|+|0,8,9|result|17|{\"kind\":\"integer\",\"value\":17}"
    ]
  ],
  "G1-AS-09": [
    [
      "canonical-search:g1-v2:G1-AS-09:band-1:0",
      1,
      "G1-AS-09|equation|+|20,5|result|25|{\"kind\":\"integer\",\"value\":25}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-1:1",
      1,
      "G1-AS-09|equation|+|13,1|result|14|{\"kind\":\"integer\",\"value\":14}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-1:2",
      1,
      "G1-AS-09|equation|+|22,2|result|24|{\"kind\":\"integer\",\"value\":24}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-1:3",
      1,
      "G1-AS-09|equation|+|32,4|result|36|{\"kind\":\"integer\",\"value\":36}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-2:0",
      2,
      "G1-AS-09|equation|+|53,2|result|55|{\"kind\":\"integer\",\"value\":55}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-2:1",
      2,
      "G1-AS-09|equation|+|38,0|result|38|{\"kind\":\"integer\",\"value\":38}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-2:2",
      2,
      "G1-AS-09|equation|+|32,5|result|37|{\"kind\":\"integer\",\"value\":37}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-2:3",
      2,
      "G1-AS-09|equation|+|33,5|result|38|{\"kind\":\"integer\",\"value\":38}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-3:0",
      3,
      "G1-AS-09|equation|+|56,3|result|59|{\"kind\":\"integer\",\"value\":59}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-3:1",
      3,
      "G1-AS-09|equation|+|76,0|result|76|{\"kind\":\"integer\",\"value\":76}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-4:0",
      4,
      "G1-AS-09|equation|+|81,1|result|82|{\"kind\":\"integer\",\"value\":82}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-09:band-4:1",
      4,
      "G1-AS-09|equation|+|84,5|result|89|{\"kind\":\"integer\",\"value\":89}"
    ]
  ],
  "G1-AS-10": [
    [
      "canonical-search:g1-v2:G1-AS-10:band-1:0",
      1,
      "G1-AS-10|equation|+|13,7|result|20|{\"kind\":\"integer\",\"value\":20}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-1:1",
      1,
      "G1-AS-10|equation|+|49,4|result|53|{\"kind\":\"integer\",\"value\":53}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-1:2",
      1,
      "G1-AS-10|equation|+|49,6|result|55|{\"kind\":\"integer\",\"value\":55}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-1:3",
      1,
      "G1-AS-10|equation|+|89,2|result|91|{\"kind\":\"integer\",\"value\":91}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-2:0",
      2,
      "G1-AS-10|equation|+|58,2|result|60|{\"kind\":\"integer\",\"value\":60}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-2:1",
      2,
      "G1-AS-10|equation|+|59,1|result|60|{\"kind\":\"integer\",\"value\":60}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-2:2",
      2,
      "G1-AS-10|equation|+|29,2|result|31|{\"kind\":\"integer\",\"value\":31}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-2:3",
      2,
      "G1-AS-10|equation|+|25,5|result|30|{\"kind\":\"integer\",\"value\":30}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-3:0",
      3,
      "G1-AS-10|equation|+|35,7|result|42|{\"kind\":\"integer\",\"value\":42}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-3:1",
      3,
      "G1-AS-10|equation|+|29,7|result|36|{\"kind\":\"integer\",\"value\":36}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-4:0",
      4,
      "G1-AS-10|equation|+|93,7|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-10:band-4:1",
      4,
      "G1-AS-10|equation|+|75,6|result|81|{\"kind\":\"integer\",\"value\":81}"
    ]
  ],
  "G1-AS-11": [
    [
      "canonical-search:g1-v2:G1-AS-11:band-1:0",
      1,
      "G1-AS-11|equation|-|12,2|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-1:1",
      1,
      "G1-AS-11|equation|-|12,0|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-1:2",
      1,
      "G1-AS-11|equation|-|17,4|result|13|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-1:3",
      1,
      "G1-AS-11|equation|-|29,0|result|29|{\"kind\":\"integer\",\"value\":29}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-2:0",
      2,
      "G1-AS-11|equation|-|55,5|result|50|{\"kind\":\"integer\",\"value\":50}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-2:1",
      2,
      "G1-AS-11|equation|-|46,6|result|40|{\"kind\":\"integer\",\"value\":40}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-2:2",
      2,
      "G1-AS-11|equation|-|49,5|result|44|{\"kind\":\"integer\",\"value\":44}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-2:3",
      2,
      "G1-AS-11|equation|-|38,0|result|38|{\"kind\":\"integer\",\"value\":38}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-3:0",
      3,
      "G1-AS-11|equation|-|67,3|result|64|{\"kind\":\"integer\",\"value\":64}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-3:1",
      3,
      "G1-AS-11|equation|-|66,2|result|64|{\"kind\":\"integer\",\"value\":64}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-4:0",
      4,
      "G1-AS-11|equation|-|81,1|result|80|{\"kind\":\"integer\",\"value\":80}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-11:band-4:1",
      4,
      "G1-AS-11|equation|-|95,0|result|95|{\"kind\":\"integer\",\"value\":95}"
    ]
  ],
  "G1-AS-12": [
    [
      "canonical-search:g1-v2:G1-AS-12:band-1:0",
      1,
      "G1-AS-12|equation|-|10,3|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-1:1",
      1,
      "G1-AS-12|equation|-|25,6|result|19|{\"kind\":\"integer\",\"value\":19}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-1:2",
      1,
      "G1-AS-12|equation|-|11,8|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-1:3",
      1,
      "G1-AS-12|equation|-|20,7|result|13|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-2:0",
      2,
      "G1-AS-12|equation|-|13,6|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-2:1",
      2,
      "G1-AS-12|equation|-|40,2|result|38|{\"kind\":\"integer\",\"value\":38}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-2:2",
      2,
      "G1-AS-12|equation|-|56,7|result|49|{\"kind\":\"integer\",\"value\":49}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-2:3",
      2,
      "G1-AS-12|equation|-|12,8|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-3:0",
      3,
      "G1-AS-12|equation|-|60,2|result|58|{\"kind\":\"integer\",\"value\":58}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-3:1",
      3,
      "G1-AS-12|equation|-|14,8|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-4:0",
      4,
      "G1-AS-12|equation|-|70,8|result|62|{\"kind\":\"integer\",\"value\":62}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-12:band-4:1",
      4,
      "G1-AS-12|equation|-|16,9|result|7|{\"kind\":\"integer\",\"value\":7}"
    ]
  ],
  "G1-AS-13": [
    [
      "canonical-search:g1-v2:G1-AS-13:band-1:0",
      1,
      "G1-AS-13|equation|-|50,30|result|20|{\"kind\":\"integer\",\"value\":20}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-1:1",
      1,
      "G1-AS-13|equation|-|50,40|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-1:2",
      1,
      "G1-AS-13|equation|-|30,30|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-1:3",
      1,
      "G1-AS-13|equation|-|28,20|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-2:0",
      2,
      "G1-AS-13|equation|-|60,50|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-2:1",
      2,
      "G1-AS-13|equation|-|60,30|result|30|{\"kind\":\"integer\",\"value\":30}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-2:2",
      2,
      "G1-AS-13|equation|+|50,20|result|70|{\"kind\":\"integer\",\"value\":70}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-2:3",
      2,
      "G1-AS-13|equation|+|30,30|result|60|{\"kind\":\"integer\",\"value\":60}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-3:0",
      3,
      "G1-AS-13|equation|-|80,30|result|50|{\"kind\":\"integer\",\"value\":50}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-3:1",
      3,
      "G1-AS-13|equation|-|80,70|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-4:0",
      4,
      "G1-AS-13|equation|+|50,40|result|90|{\"kind\":\"integer\",\"value\":90}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-13:band-4:1",
      4,
      "G1-AS-13|equation|-|98,60|result|38|{\"kind\":\"integer\",\"value\":38}"
    ]
  ],
  "G1-AS-14": [
    [
      "canonical-search:g1-v2:G1-AS-14:band-1:0",
      1,
      "G1-AS-14|equation|+|15,20|result|35|{\"kind\":\"integer\",\"value\":35}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-1:1",
      1,
      "G1-AS-14|equation|+|24,20|result|44|{\"kind\":\"integer\",\"value\":44}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-1:2",
      1,
      "G1-AS-14|equation|+|21,13|result|34|{\"kind\":\"integer\",\"value\":34}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-1:3",
      1,
      "G1-AS-14|equation|+|20,10|result|30|{\"kind\":\"integer\",\"value\":30}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-2:0",
      2,
      "G1-AS-14|equation|+|53,10|result|63|{\"kind\":\"integer\",\"value\":63}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-2:1",
      2,
      "G1-AS-14|equation|+|20,41|result|61|{\"kind\":\"integer\",\"value\":61}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-2:2",
      2,
      "G1-AS-14|equation|+|13,62|result|75|{\"kind\":\"integer\",\"value\":75}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-2:3",
      2,
      "G1-AS-14|equation|+|21,42|result|63|{\"kind\":\"integer\",\"value\":63}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-3:0",
      3,
      "G1-AS-14|equation|+|20,60|result|80|{\"kind\":\"integer\",\"value\":80}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-3:1",
      3,
      "G1-AS-14|equation|+|14,74|result|88|{\"kind\":\"integer\",\"value\":88}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-4:0",
      4,
      "G1-AS-14|equation|+|54,35|result|89|{\"kind\":\"integer\",\"value\":89}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-14:band-4:1",
      4,
      "G1-AS-14|equation|+|40,50|result|90|{\"kind\":\"integer\",\"value\":90}"
    ]
  ],
  "G1-AS-15": [
    [
      "canonical-search:g1-v2:G1-AS-15:band-1:0",
      1,
      "G1-AS-15|equation|+|33,27|result|60|{\"kind\":\"integer\",\"value\":60}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-1:1",
      1,
      "G1-AS-15|equation|+|20,80|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-1:2",
      1,
      "G1-AS-15|equation|+|30,70|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-1:3",
      1,
      "G1-AS-15|equation|+|10,90|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-2:0",
      2,
      "G1-AS-15|equation|+|40,60|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-2:1",
      2,
      "G1-AS-15|equation|+|50,50|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-2:5",
      2,
      "G1-AS-15|equation|+|19,48|result|67|{\"kind\":\"integer\",\"value\":67}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-2:9",
      2,
      "G1-AS-15|equation|+|27,35|result|62|{\"kind\":\"integer\",\"value\":62}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-3:0",
      3,
      "G1-AS-15|equation|+|60,40|result|100|{\"kind\":\"integer\",\"value\":100}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-3:1",
      3,
      "G1-AS-15|equation|+|47,34|result|81|{\"kind\":\"integer\",\"value\":81}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-4:0",
      4,
      "G1-AS-15|equation|+|45,46|result|91|{\"kind\":\"integer\",\"value\":91}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-15:band-4:1",
      4,
      "G1-AS-15|equation|+|90,10|result|100|{\"kind\":\"integer\",\"value\":100}"
    ]
  ],
  "G1-AS-16": [
    [
      "canonical-search:g1-v2:G1-AS-16:band-1:0",
      1,
      "G1-AS-16|equation|-|45,25|result|20|{\"kind\":\"integer\",\"value\":20}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-1:1",
      1,
      "G1-AS-16|equation|-|15,11|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-1:2",
      1,
      "G1-AS-16|equation|-|40,10|result|30|{\"kind\":\"integer\",\"value\":30}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-1:3",
      1,
      "G1-AS-16|equation|-|46,20|result|26|{\"kind\":\"integer\",\"value\":26}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-2:0",
      2,
      "G1-AS-16|equation|-|62,12|result|50|{\"kind\":\"integer\",\"value\":50}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-2:1",
      2,
      "G1-AS-16|equation|-|72,21|result|51|{\"kind\":\"integer\",\"value\":51}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-2:2",
      2,
      "G1-AS-16|equation|-|68,21|result|47|{\"kind\":\"integer\",\"value\":47}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-2:3",
      2,
      "G1-AS-16|equation|-|62,62|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-3:0",
      3,
      "G1-AS-16|equation|-|73,53|result|20|{\"kind\":\"integer\",\"value\":20}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-3:1",
      3,
      "G1-AS-16|equation|-|80,70|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-4:0",
      4,
      "G1-AS-16|equation|-|92,91|result|1|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-16:band-4:1",
      4,
      "G1-AS-16|equation|-|91,31|result|60|{\"kind\":\"integer\",\"value\":60}"
    ]
  ],
  "G1-AS-17": [
    [
      "canonical-search:g1-v2:G1-AS-17:band-1:0",
      1,
      "G1-AS-17|equation|-|32,26|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-1:1",
      1,
      "G1-AS-17|equation|-|50,38|result|12|{\"kind\":\"integer\",\"value\":12}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-1:2",
      1,
      "G1-AS-17|equation|-|22,15|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-1:3",
      1,
      "G1-AS-17|equation|-|40,31|result|9|{\"kind\":\"integer\",\"value\":9}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-2:0",
      2,
      "G1-AS-17|equation|-|52,46|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-2:1",
      2,
      "G1-AS-17|equation|-|71,34|result|37|{\"kind\":\"integer\",\"value\":37}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-2:2",
      2,
      "G1-AS-17|equation|-|60,29|result|31|{\"kind\":\"integer\",\"value\":31}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-2:3",
      2,
      "G1-AS-17|equation|-|43,36|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-3:0",
      3,
      "G1-AS-17|equation|-|83,36|result|47|{\"kind\":\"integer\",\"value\":47}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-3:1",
      3,
      "G1-AS-17|equation|-|73,64|result|9|{\"kind\":\"integer\",\"value\":9}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-4:0",
      4,
      "G1-AS-17|equation|-|93,78|result|15|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-17:band-4:1",
      4,
      "G1-AS-17|equation|-|90,34|result|56|{\"kind\":\"integer\",\"value\":56}"
    ]
  ],
  "G1-AS-18": [
    [
      "canonical-search:g1-v2:G1-AS-18:band-1:0",
      1,
      "G1-AS-18|equation|+|1,8|operand:1|9|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-1:1",
      1,
      "G1-AS-18|equation|-|11,4|operand:1|7|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-1:2",
      1,
      "G1-AS-18|equation|-|2,2|operand:0|0|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-1:3",
      1,
      "G1-AS-18|equation|-|8,2|operand:1|6|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-2:0",
      2,
      "G1-AS-18|equation|-|13,11|operand:1|2|{\"kind\":\"integer\",\"value\":11}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-2:1",
      2,
      "G1-AS-18|equation|-|13,9|operand:0|4|{\"kind\":\"integer\",\"value\":13}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-2:2",
      2,
      "G1-AS-18|equation|-|14,5|operand:1|9|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-2:3",
      2,
      "G1-AS-18|equation|-|15,1|operand:0|14|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-3:0",
      3,
      "G1-AS-18|equation|-|16,4|operand:0|12|{\"kind\":\"integer\",\"value\":16}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-3:1",
      3,
      "G1-AS-18|equation|-|19,4|operand:0|15|{\"kind\":\"integer\",\"value\":19}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-4:0",
      4,
      "G1-AS-18|equation|+|2,15|operand:0|17|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-AS-18:band-4:1",
      4,
      "G1-AS-18|equation|+|6,14|operand:0|20|{\"kind\":\"integer\",\"value\":6}"
    ]
  ],
  "G1-M-01": [
    [
      "canonical-search:g1-v2:G1-M-01:band-1:0",
      1,
      "G1-M-01|equal-groups|array|1|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-1:1",
      1,
      "G1-M-01|equal-groups|array|0|5|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-1:2",
      1,
      "G1-M-01|equal-groups|groups|4|2|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-1:3",
      1,
      "G1-M-01|equal-groups|groups|1|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-2:0",
      2,
      "G1-M-01|equal-groups|repeated-addition|3|5|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-2:1",
      2,
      "G1-M-01|equal-groups|repeated-addition|5|2|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-2:2",
      2,
      "G1-M-01|equal-groups|groups|0|10|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-2:3",
      2,
      "G1-M-01|equal-groups|array|3|5|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-3:0",
      3,
      "G1-M-01|equal-groups|groups|8|2|{\"kind\":\"integer\",\"value\":16}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-3:1",
      3,
      "G1-M-01|equal-groups|groups|4|5|{\"kind\":\"integer\",\"value\":20}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-4:0",
      4,
      "G1-M-01|equal-groups|repeated-addition|7|5|{\"kind\":\"integer\",\"value\":35}"
    ],
    [
      "canonical-search:g1-v2:G1-M-01:band-4:1",
      4,
      "G1-M-01|equal-groups|array|4|10|{\"kind\":\"integer\",\"value\":40}"
    ]
  ],
  "G1-M-02": [
    [
      "canonical-search:g1-v2:G1-M-02:band-1:0",
      1,
      "G1-M-02|equation|×|2,3|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-1:1",
      1,
      "G1-M-02|equation|×|2,1|result|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-1:2",
      1,
      "G1-M-02|equation|×|1,5|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-1:4",
      1,
      "G1-M-02|equation|×|10,0|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-2:0",
      2,
      "G1-M-02|equation|×|5,3|result|15|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-2:1",
      2,
      "G1-M-02|equation|×|3,2|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-2:2",
      2,
      "G1-M-02|equation|×|1,10|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-2:5",
      2,
      "G1-M-02|equation|×|2,4|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-3:0",
      3,
      "G1-M-02|equation|×|2,5|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-3:1",
      3,
      "G1-M-02|equation|×|5,6|result|30|{\"kind\":\"integer\",\"value\":30}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-4:0",
      4,
      "G1-M-02|equation|×|5,8|result|40|{\"kind\":\"integer\",\"value\":40}"
    ],
    [
      "canonical-search:g1-v2:G1-M-02:band-4:1",
      4,
      "G1-M-02|equation|×|7,5|result|35|{\"kind\":\"integer\",\"value\":35}"
    ]
  ],
  "G1-D-01": [
    [
      "canonical-search:g1-v2:G1-D-01:band-1:0",
      1,
      "G1-D-01|division-model|sharing|0|5|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-1:3",
      1,
      "G1-D-01|division-model|grouping|0|2|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-1:4",
      1,
      "G1-D-01|division-model|grouping|2|2|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-1:5",
      1,
      "G1-D-01|division-model|sharing|2|2|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-2:0",
      2,
      "G1-D-01|division-model|grouping|0|10|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-2:1",
      2,
      "G1-D-01|division-model|grouping|10|5|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-2:4",
      2,
      "G1-D-01|division-model|sharing|0|10|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-2:6",
      2,
      "G1-D-01|division-model|grouping|10|10|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-3:0",
      3,
      "G1-D-01|division-model|sharing|15|5|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-3:1",
      3,
      "G1-D-01|division-model|grouping|16|2|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-4:0",
      4,
      "G1-D-01|division-model|grouping|25|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-D-01:band-4:1",
      4,
      "G1-D-01|division-model|grouping|30|10|{\"kind\":\"integer\",\"value\":3}"
    ]
  ],
  "G1-D-02": [
    [
      "canonical-search:g1-v2:G1-D-02:band-1:0",
      1,
      "G1-D-02|equation|÷|0,10|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-1:2",
      1,
      "G1-D-02|equation|÷|2,2|result|1|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-1:5",
      1,
      "G1-D-02|equation|÷|10,5|result|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-1:8",
      1,
      "G1-D-02|equation|÷|4,2|result|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-2:0",
      2,
      "G1-D-02|equation|÷|20,5|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-2:1",
      2,
      "G1-D-02|equation|÷|20,10|result|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-2:4",
      2,
      "G1-D-02|equation|÷|8,2|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-2:6",
      2,
      "G1-D-02|equation|÷|12,2|result|6|{\"kind\":\"integer\",\"value\":6}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-3:0",
      3,
      "G1-D-02|equation|÷|30,10|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-3:1",
      3,
      "G1-D-02|equation|÷|10,2|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-4:0",
      4,
      "G1-D-02|equation|÷|40,5|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-D-02:band-4:1",
      4,
      "G1-D-02|equation|÷|40,10|result|4|{\"kind\":\"integer\",\"value\":4}"
    ]
  ],
  "G1-M-03": [
    [
      "canonical-search:g1-v2:G1-M-03:band-1:0",
      1,
      "G1-M-03|equation|×|2,1|result|2|{\"kind\":\"integer\",\"value\":2}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-1:1",
      1,
      "G1-M-03|equation|×|1,5|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-1:2",
      1,
      "G1-M-03|equation|×|5,0|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-1:3",
      1,
      "G1-M-03|equation|×|0,5|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-2:0",
      2,
      "G1-M-03|equation|×|2,4|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-2:1",
      2,
      "G1-M-03|equation|×|5,3|result|15|{\"kind\":\"integer\",\"value\":15}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-2:2",
      2,
      "G1-M-03|equation|×|3,10|result|30|{\"kind\":\"integer\",\"value\":30}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-2:5",
      2,
      "G1-M-03|equation|×|4,2|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-3:0",
      3,
      "G1-M-03|equation|×|7,5|result|35|{\"kind\":\"integer\",\"value\":35}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-3:1",
      3,
      "G1-M-03|equation|×|6,10|result|60|{\"kind\":\"integer\",\"value\":60}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-4:0",
      4,
      "G1-M-03|equation|×|10,5|result|50|{\"kind\":\"integer\",\"value\":50}"
    ],
    [
      "canonical-search:g1-v2:G1-M-03:band-4:1",
      4,
      "G1-M-03|equation|×|10,2|result|20|{\"kind\":\"integer\",\"value\":20}"
    ]
  ],
  "G1-D-03": [
    [
      "canonical-search:g1-v2:G1-D-03:band-1:0",
      1,
      "G1-D-03|equation|÷|2,2|result|1|{\"kind\":\"integer\",\"value\":1}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-1:1",
      1,
      "G1-D-03|equation|÷|0,5|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-1:2",
      1,
      "G1-D-03|equation|÷|0,2|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-1:3",
      1,
      "G1-D-03|equation|÷|0,10|result|0|{\"kind\":\"integer\",\"value\":0}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-2:0",
      2,
      "G1-D-03|equation|÷|50,10|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-2:1",
      2,
      "G1-D-03|equation|÷|20,5|result|4|{\"kind\":\"integer\",\"value\":4}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-2:2",
      2,
      "G1-D-03|equation|÷|25,5|result|5|{\"kind\":\"integer\",\"value\":5}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-2:3",
      2,
      "G1-D-03|equation|÷|15,5|result|3|{\"kind\":\"integer\",\"value\":3}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-3:0",
      3,
      "G1-D-03|equation|÷|40,5|result|8|{\"kind\":\"integer\",\"value\":8}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-3:1",
      3,
      "G1-D-03|equation|÷|35,5|result|7|{\"kind\":\"integer\",\"value\":7}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-4:0",
      4,
      "G1-D-03|equation|÷|20,2|result|10|{\"kind\":\"integer\",\"value\":10}"
    ],
    [
      "canonical-search:g1-v2:G1-D-03:band-4:2",
      4,
      "G1-D-03|equation|÷|18,2|result|9|{\"kind\":\"integer\",\"value\":9}"
    ]
  ]
} as const satisfies Readonly<
  Record<G1SkillId, readonly G1PinnedCanonicalFixture[]>
>;

/**
 * Stable 12-case fixture matrix for every skill: four clean, four ordinary,
 * and four split across the structurally-difficult/adversarial bands. Each
 * stored fingerprint pins the structured mathematical prompt and answer.
 */
export const G1_CANONICAL_FIXTURE_SEEDS: Readonly<
  Record<G1SkillId, readonly G1CanonicalFixtureSeed[]>
> = Object.freeze(Object.fromEntries(
  G1_SKILL_IDS.map((skillId) => [
    skillId,
    Object.freeze(G1_PINNED_CANONICAL_FIXTURES[skillId].map(
      ([seed, difficultyBand, expectedFingerprint], index) => Object.freeze({
        name: `${skillId.toLowerCase()}-fixture-${String(index + 1).padStart(2, "0")}`,
        skillId,
        seed,
        difficultyBand,
        expectedFingerprint,
      }),
    )),
  ]),
) as Record<G1SkillId, readonly G1CanonicalFixtureSeed[]>);

export const generateArithmeticQuestion = generateG1Question;

export function evaluateG1Answer(
  question: QuestionInstance,
  submitted: SubmittedAnswer,
): AnswerEvaluation {
  const parsed = parseExactAnswer(submitted, question.exactAnswer);
  if (!parsed) return { correct: false, normalizedSubmission: null, acceptedForm: null, reason: "unreadable" };
  const submittedForm = parsed.form === "fraction" && parsed.reducedFraction ? "reduced_fraction" : parsed.form;
  const accepted = question.acceptedAnswerForms.includes(parsed.form) || question.acceptedAnswerForms.includes(submittedForm);
  if (!accepted) {
    return { correct: false, normalizedSubmission: parsed.value, acceptedForm: parsed.form, reason: "answer_form_not_accepted" };
  }
  const correct = exactNumbersEqual(question.exactAnswer, parsed.value);
  return {
    correct,
    normalizedSubmission: parsed.value,
    acceptedForm: submittedForm,
    reason: correct ? "correct" : "incorrect",
  };
}

export const evaluateArithmeticAnswer = evaluateG1Answer;

export function verifyG1GeneratorCorpus(seedsPerSkill = 1_000): Readonly<{
  generated: number;
  skills: number;
  coverageMissing: readonly string[];
}> {
  if (!Number.isSafeInteger(seedsPerSkill) || seedsPerSkill < 1) throw new RangeError("seedsPerSkill must be a positive integer.");
  const coverageMissing: string[] = [];
  for (const skill of G1_SKILLS) {
    const observed = new Set<string>();
    for (let index = 0; index < seedsPerSkill; index += 1) {
      const question = generateG1Question({ skillId: skill.id, seed: `verify:${skill.id}:${index}` });
      question.coverageTags.forEach((tag) => observed.add(tag));
      if (question.exactAnswer.kind !== "integer") throw new Error(`${skill.id} produced a non-integer Grade 1 answer.`);
      if (!evaluateG1Answer(question, question.exactAnswer.value).correct) throw new Error(`${skill.id} rejected its exact answer.`);
    }
    for (const key of requiredCoverageKeysForSkill(skill.id)) {
      if (!observed.has(key)) coverageMissing.push(`${skill.id}:${key}`);
    }
  }
  return Object.freeze({ generated: seedsPerSkill * G1_SKILLS.length, skills: G1_SKILLS.length, coverageMissing });
}
