import type {
  CanonicalExample,
  CanonicalNonExample,
  CoverageRequirement,
  DifficultyBand,
  Domain,
  ExpectedMethod,
  JsonValue,
  MasteryProfile,
  SkillDefinition,
  Tier,
} from "./types.ts";

export const G1_CURRICULUM_VERSION = 1;

export const G1_SKILL_IDS = [
  "G1-AS-01", "G1-AS-02", "G1-AS-03", "G1-AS-04", "G1-AS-05", "G1-AS-06",
  "G1-AS-07", "G1-AS-08", "G1-AS-09", "G1-AS-10", "G1-AS-11", "G1-AS-12",
  "G1-AS-13", "G1-AS-14", "G1-AS-15", "G1-AS-16", "G1-AS-17", "G1-AS-18",
  "G1-M-01", "G1-M-02", "G1-D-01", "G1-D-02", "G1-M-03", "G1-D-03",
] as const;

export type G1SkillId = (typeof G1_SKILL_IDS)[number];

export const G1_GENERATOR_KINDS = [
  "part-whole",
  "addition-fact",
  "subtraction-fact",
  "mixed-within-20",
  "three-addends",
  "place-value-change",
  "two-digit-addition",
  "two-digit-subtraction",
  "missing-term",
  "multiplication-model",
  "multiplication-fact",
  "division-model",
  "division-fact",
] as const;

interface SkillInput {
  readonly id: G1SkillId;
  readonly tier?: Tier;
  readonly profile: MasteryProfile;
  readonly domain: Domain;
  readonly title: string;
  readonly description: string;
  readonly prerequisites: readonly G1SkillId[];
  readonly generatorKind: (typeof G1_GENERATOR_KINDS)[number];
  readonly operandSpec: Readonly<Record<string, JsonValue>>;
  readonly constraints: Readonly<Record<string, JsonValue>>;
  readonly method: ExpectedMethod;
  readonly misconceptions: readonly string[];
  readonly coverage: readonly [string, string, ...string[]];
  readonly examples: readonly [
    readonly [prompt: string, answer: string],
    readonly [prompt: string, answer: string],
    readonly [prompt: string, answer: string],
    readonly [prompt: string, answer: string],
  ];
  readonly nonExample: readonly [string, string];
}

const BAND_LABELS = [
  "clean",
  "ordinary",
  "structurally_difficult",
  "adversarial",
] as const;

const BAND_DESCRIPTIONS = [
  "Small, direct values with the clearest available structure.",
  "An ordinary mix from the middle of the skill's allowed range.",
  "Larger values or a less immediately visible relationship.",
  "Near-boundary values or a plausible-misconception trap, still inside the skill.",
] as const;

function difficultyBands(): readonly DifficultyBand[] {
  return BAND_LABELS.map((label, index) => ({
    band: (index + 1) as 1 | 2 | 3 | 4,
    label,
    description: BAND_DESCRIPTIONS[index]!,
    constraints: {
      deterministicCandidateQuartile: index + 1,
      remainsWithinSkillDefinition: true,
    },
  }));
}

function coverageRequirements(keys: readonly [string, string, ...string[]]): readonly CoverageRequirement[] {
  const minimumShare = Number((1 / keys.length / 2).toFixed(3));
  return keys.map((key) => ({
    key,
    description: key.replaceAll("_", " "),
    minimumShare,
    critical: true,
  }));
}

function canonicalExamples(values: SkillInput["examples"]): readonly CanonicalExample[] {
  return values.map(([prompt, answer], index) => {
    return {
      prompt,
      answer,
      difficultyBand: (index + 1) as 1 | 2 | 3 | 4,
      rationale: `A band ${index + 1} instance that stays inside the stated operand and structure limits.`,
    };
  });
}

function defineSkill(input: SkillInput): SkillDefinition {
  const nonExamples: readonly CanonicalNonExample[] = [{
    prompt: input.nonExample[0],
    reason: input.nonExample[1],
  }];
  return Object.freeze({
    id: input.id,
    version: G1_CURRICULUM_VERSION,
    grade: 1,
    tier: input.tier ?? "core",
    domain: input.domain,
    title: input.title,
    description: input.description,
    prerequisites: input.prerequisites,
    generator: {
      kind: input.generatorKind,
      operandSpec: input.operandSpec,
      constraints: input.constraints,
      difficultyBands: difficultyBands(),
      coverageRequirements: coverageRequirements(input.coverage),
    },
    expectedMethod: input.method,
    masteryProfile: input.profile,
    acceptedAnswerForms: ["integer"] as const,
    misconceptionTags: input.misconceptions,
    examples: canonicalExamples(input.examples),
    nonExamples,
  });
}

const ADD_MISCONCEPTIONS = ["count_all", "count_from_one", "omitted_carry"] as const;
const SUB_MISCONCEPTIONS = ["operation_reversal", "subtract_smaller_digit_from_larger", "borrow_without_decomposing"] as const;
const MULTIPLY_MISCONCEPTIONS = ["repeated_addition_error", "fact_family_confusion", "identity_property_error"] as const;
const DIVIDE_MISCONCEPTIONS = ["dividend_divisor_reversal", "quotient_digit_shift", "poor_quotient_estimate"] as const;

export const G1_SKILLS: readonly SkillDefinition[] = Object.freeze([
  defineSkill({
    id: "G1-AS-01", profile: "CONCEPT", domain: "addition", title: "Parts through 5",
    description: "Compose and decompose quantities through 5; find a missing part in a total no greater than 5.",
    prerequisites: [], generatorKind: "part-whole", operandSpec: { total: "F5", part: "0..total" },
    constraints: { maximumTotal: 5, unknown: "missing_part" }, method: "recognition",
    misconceptions: ["count_all", "missing_operand_confusion"], coverage: ["total_0_to_2", "total_3_to_5", "zero_part"],
    examples: [["1 + □ = 2", "1"], ["3 + □ = 4", "1"], ["2 + □ = 5", "3"], ["0 + □ = 5", "5"]],
    nonExample: ["4 + 3 =", "The total exceeds 5."],
  }),
  defineSkill({
    id: "G1-AS-02", profile: "CONCEPT", domain: "addition", title: "Parts through 10",
    description: "Compose and decompose quantities through 10, including complements to 10.",
    prerequisites: ["G1-AS-01"], generatorKind: "part-whole", operandSpec: { total: "F10", part: "0..total" },
    constraints: { maximumTotal: 10, includesComplementsTo10: true }, method: "recognition",
    misconceptions: ["count_all", "missing_operand_confusion"], coverage: ["total_6_to_9", "complement_to_10", "zero_part"],
    examples: [["2 + □ = 5", "3"], ["4 + □ = 8", "4"], ["3 + □ = 10", "7"], ["9 + □ = 10", "1"]],
    nonExample: ["8 + 5 =", "The total exceeds 10."],
  }),
  defineSkill({
    id: "G1-AS-03", profile: "FACT", domain: "addition", title: "Addition facts through 10",
    description: "Add two digits when the sum is no greater than 10.", prerequisites: ["G1-AS-01"],
    generatorKind: "addition-fact", operandSpec: { left: "D1", right: "D1" }, constraints: { maximumSum: 10 },
    method: "fact_recall", misconceptions: ADD_MISCONCEPTIONS, coverage: ["zero_addend", "doubles", "mixed_fact"],
    examples: [["1 + 2 =", "3"], ["3 + 3 =", "6"], ["4 + 5 =", "9"], ["9 + 1 =", "10"]],
    nonExample: ["7 + 6 =", "The sum is greater than 10."],
  }),
  defineSkill({
    id: "G1-AS-04", profile: "FACT", domain: "subtraction", title: "Subtraction facts through 10",
    description: "Subtract one digit from another with a nonnegative result and minuend no greater than 10.", prerequisites: ["G1-AS-03"],
    generatorKind: "subtraction-fact", operandSpec: { minuend: "D1", subtrahend: "D1" }, constraints: { nonnegativeResult: true },
    method: "fact_recall", misconceptions: SUB_MISCONCEPTIONS, coverage: ["subtract_zero", "subtract_all", "mixed_fact"],
    examples: [["3 - 1 =", "2"], ["5 - 5 =", "0"], ["8 - 3 =", "5"], ["9 - 1 =", "8"]],
    nonExample: ["4 - 7 =", "The result is negative."],
  }),
  defineSkill({
    id: "G1-AS-05", profile: "MENTAL", domain: "addition", title: "Addition facts from 11 to 18",
    description: "Add two digits with a sum from 11 through 18 using make-ten, doubles, or near-doubles.", prerequisites: ["G1-AS-02", "G1-AS-03"],
    generatorKind: "addition-fact", operandSpec: { left: "D1", right: "D1" }, constraints: { minimumSum: 11, maximumSum: 18 },
    method: "mental", misconceptions: ADD_MISCONCEPTIONS, coverage: ["make_ten", "doubles", "near_doubles"],
    examples: [["6 + 5 =", "11"], ["7 + 7 =", "14"], ["8 + 7 =", "15"], ["9 + 9 =", "18"]],
    nonExample: ["5 + 4 =", "The sum is below 11."],
  }),
  defineSkill({
    id: "G1-AS-06", profile: "MENTAL", domain: "subtraction", title: "Subtraction within 18",
    description: "Subtract a digit from an integer from 10 through 18 with a nonnegative result.", prerequisites: ["G1-AS-04", "G1-AS-05"],
    generatorKind: "subtraction-fact", operandSpec: { minuend: "10..18", subtrahend: "D1" }, constraints: { nonnegativeResult: true },
    method: "mental", misconceptions: SUB_MISCONCEPTIONS, coverage: ["no_decade_crossing", "decade_crossing", "subtract_zero"],
    examples: [["10 - 2 =", "8"], ["12 - 3 =", "9"], ["15 - 7 =", "8"], ["18 - 9 =", "9"]],
    nonExample: ["18 - 10 =", "The subtrahend is not a digit from 0 through 9."],
  }),
  defineSkill({
    id: "G1-AS-07", profile: "MENTAL", domain: "addition", title: "Mixed facts within 20",
    description: "Solve a mix of addition and subtraction facts within 20.", prerequisites: ["G1-AS-05", "G1-AS-06"],
    generatorKind: "mixed-within-20", operandSpec: { operands: "0..20" }, constraints: { resultRange: "0..20", operations: ["+", "-"] },
    method: "mental", misconceptions: ["operation_reversal", "count_all", "count_from_one"], coverage: ["addition", "subtraction", "result_10_or_20"],
    examples: [["4 + 5 =", "9"], ["13 - 4 =", "9"], ["8 + 8 =", "16"], ["20 - 1 =", "19"]],
    nonExample: ["17 + 8 =", "The result exceeds 20."],
  }),
  defineSkill({
    id: "G1-AS-08", profile: "MENTAL", domain: "addition", title: "Three addends within 20",
    description: "Add three digits with a sum no greater than 20.", prerequisites: ["G1-AS-05"],
    generatorKind: "three-addends", operandSpec: { addends: "D1", numberOfAddends: 3 }, constraints: { maximumSum: 20 },
    method: "mental", misconceptions: ADD_MISCONCEPTIONS, coverage: ["contains_zero", "make_ten_pair", "no_make_ten_pair"],
    examples: [["1 + 2 + 3 =", "6"], ["4 + 6 + 2 =", "12"], ["5 + 7 + 3 =", "15"], ["9 + 9 + 2 =", "20"]],
    nonExample: ["9 + 8 + 7 =", "The sum exceeds 20."],
  }),
  defineSkill({
    id: "G1-AS-09", profile: "MENTAL", domain: "addition", title: "Add a digit without crossing a decade",
    description: "Add a digit to a two-digit number when the ones sum is below 10.", prerequisites: ["G1-AS-03"],
    generatorKind: "addition-fact", operandSpec: { left: "D2", right: "D1" }, constraints: { decadeCrossings: 0 },
    method: "mental", misconceptions: ADD_MISCONCEPTIONS, coverage: ["zero_addend", "low_ones_sum", "high_ones_sum"],
    examples: [["12 + 2 =", "14"], ["34 + 5 =", "39"], ["61 + 7 =", "68"], ["98 + 1 =", "99"]],
    nonExample: ["27 + 5 =", "The ones sum crosses a decade."],
  }),
  defineSkill({
    id: "G1-AS-10", profile: "MENTAL", domain: "addition", title: "Add a digit across a decade",
    description: "Add a digit to a two-digit number, crossing exactly one decade, with result no greater than 100.", prerequisites: ["G1-AS-05", "G1-AS-09"],
    generatorKind: "addition-fact", operandSpec: { left: "D2", right: "D1" }, constraints: { decadeCrossings: 1, maximumResult: 100 },
    method: "mental", misconceptions: ADD_MISCONCEPTIONS, coverage: ["result_20_to_49", "result_50_to_89", "result_90_to_100"],
    examples: [["18 + 3 =", "21"], ["47 + 5 =", "52"], ["76 + 8 =", "84"], ["99 + 1 =", "100"]],
    nonExample: ["42 + 3 =", "The sum does not cross a decade."],
  }),
  defineSkill({
    id: "G1-AS-11", profile: "MENTAL", domain: "subtraction", title: "Subtract a digit without crossing a decade",
    description: "Subtract a digit from a two-digit number without crossing a decade.", prerequisites: ["G1-AS-04"],
    generatorKind: "subtraction-fact", operandSpec: { minuend: "D2", subtrahend: "D1" }, constraints: { decadeCrossings: 0 },
    method: "mental", misconceptions: SUB_MISCONCEPTIONS, coverage: ["subtract_zero", "equal_ones", "positive_ones_result"],
    examples: [["14 - 2 =", "12"], ["37 - 5 =", "32"], ["68 - 8 =", "60"], ["99 - 1 =", "98"]],
    nonExample: ["42 - 5 =", "The subtraction crosses a decade."],
  }),
  defineSkill({
    id: "G1-AS-12", profile: "MENTAL", domain: "subtraction", title: "Subtract a digit across a decade",
    description: "Subtract a digit from a two-digit number, crossing exactly one decade, with a nonnegative result.", prerequisites: ["G1-AS-06", "G1-AS-11"],
    generatorKind: "subtraction-fact", operandSpec: { minuend: "D2", subtrahend: "D1" }, constraints: { decadeCrossings: 1, nonnegativeResult: true },
    method: "mental", misconceptions: SUB_MISCONCEPTIONS, coverage: ["minuend_ends_zero", "small_difference", "large_minuend"],
    examples: [["10 - 2 =", "8"], ["32 - 5 =", "27"], ["61 - 7 =", "54"], ["90 - 9 =", "81"]],
    nonExample: ["48 - 5 =", "The subtraction does not cross a decade."],
  }),
  defineSkill({
    id: "G1-AS-13", profile: "MENTAL", domain: "addition", title: "Change by whole tens",
    description: "Add or subtract a positive multiple of 10 below 100 from a two-digit number, keeping the result from 0 through 100.", prerequisites: ["G1-AS-02"],
    generatorKind: "place-value-change", operandSpec: { left: "D2", right: "T10" }, constraints: { resultRange: "0..100", operations: ["+", "-"] },
    method: "mental", misconceptions: ["column_misalignment", "operation_reversal", "count_from_one"], coverage: ["addition", "subtraction", "result_ends_zero"],
    examples: [["12 + 10 =", "22"], ["54 - 20 =", "34"], ["35 + 40 =", "75"], ["90 - 90 =", "0"]],
    nonExample: ["24 + 6 =", "The second operand is not a positive multiple of 10."],
  }),
  defineSkill({
    id: "G1-AS-14", profile: "ALGO_SHORT", domain: "addition", title: "Two-digit addition without regrouping",
    description: "Add two two-digit numbers without regrouping, with sum no greater than 100.", prerequisites: ["G1-AS-09"],
    generatorKind: "two-digit-addition", operandSpec: { left: "D2", right: "D2" }, constraints: { regroupCount: 0, maximumSum: 100 },
    method: "written", misconceptions: ["column_misalignment", "count_all", "carry_to_wrong_place"], coverage: ["ones_sum_zero_to_four", "ones_sum_five_to_nine", "result_contains_zero"],
    examples: [["12 + 21 =", "33"], ["34 + 25 =", "59"], ["61 + 28 =", "89"], ["50 + 40 =", "90"]],
    nonExample: ["28 + 17 =", "The ones require regrouping."],
  }),
  defineSkill({
    id: "G1-AS-15", profile: "ALGO_SHORT", domain: "addition", title: "Two-digit addition with one regrouping",
    description: "Add two two-digit numbers with exactly one regrouping and sum no greater than 100.", prerequisites: ["G1-AS-10", "G1-AS-14"],
    generatorKind: "two-digit-addition", operandSpec: { left: "D2", right: "D2" }, constraints: { regroupCount: 1, maximumSum: 100 },
    method: "written", misconceptions: ["omitted_carry", "carry_to_wrong_place", "column_misalignment"], coverage: ["ones_regroup", "new_hundred_regroup", "sum_near_100"],
    examples: [["18 + 23 =", "41"], ["27 + 35 =", "62"], ["56 + 28 =", "84"], ["60 + 40 =", "100"]],
    nonExample: ["23 + 14 =", "No place requires regrouping."],
  }),
  defineSkill({
    id: "G1-AS-16", profile: "ALGO_SHORT", domain: "subtraction", title: "Two-digit subtraction without regrouping",
    description: "Subtract two two-digit numbers without regrouping and with a nonnegative result.", prerequisites: ["G1-AS-11"],
    generatorKind: "two-digit-subtraction", operandSpec: { minuend: "D2", subtrahend: "D2" }, constraints: { regroupCount: 0, nonnegativeResult: true },
    method: "written", misconceptions: ["column_misalignment", "operation_reversal", "subtract_smaller_digit_from_larger"], coverage: ["zero_ones_result", "result_contains_zero", "ordinary_difference"],
    examples: [["32 - 11 =", "21"], ["56 - 24 =", "32"], ["88 - 37 =", "51"], ["99 - 10 =", "89"]],
    nonExample: ["42 - 17 =", "The ones require regrouping."],
  }),
  defineSkill({
    id: "G1-AS-17", profile: "ALGO_SHORT", domain: "subtraction", title: "Two-digit subtraction with one regrouping",
    description: "Subtract two two-digit numbers with exactly one regrouping and a nonnegative result.", prerequisites: ["G1-AS-12", "G1-AS-16"],
    generatorKind: "two-digit-subtraction", operandSpec: { minuend: "D2", subtrahend: "D2" }, constraints: { regroupCount: 1, nonnegativeResult: true },
    method: "written", misconceptions: ["borrow_without_decomposing", "subtract_smaller_digit_from_larger", "column_misalignment"], coverage: ["minuend_ends_zero", "small_difference", "ordinary_difference"],
    examples: [["31 - 12 =", "19"], ["52 - 27 =", "25"], ["70 - 34 =", "36"], ["91 - 87 =", "4"]],
    nonExample: ["76 - 24 =", "No regrouping is needed."],
  }),
  defineSkill({
    id: "G1-AS-18", profile: "MENTAL", domain: "addition", title: "Missing number within 20",
    description: "Find a missing addend, minuend, or subtrahend in arithmetic within 20.", prerequisites: ["G1-AS-07"],
    generatorKind: "missing-term", operandSpec: { operandsAndResult: "0..20" }, constraints: { unknown: ["addend", "minuend", "subtrahend"] },
    method: "mental", misconceptions: ["missing_operand_confusion", "operation_reversal", "count_from_one"], coverage: ["missing_addend", "missing_minuend", "missing_subtrahend"],
    examples: [["□ + 2 = 5", "3"], ["7 + □ = 12", "5"], ["□ - 4 = 9", "13"], ["20 - □ = 11", "9"]],
    nonExample: ["9 + 8 = ?", "The result, rather than an operand, is missing."],
  }),
  defineSkill({
    id: "G1-M-01", profile: "CONCEPT", domain: "multiplication", title: "Equal groups",
    description: "Interpret multiplication as equal groups, arrays, and repeated addition, using group sizes 2, 5, or 10 and products no greater than 40.", prerequisites: ["G1-AS-03"],
    generatorKind: "multiplication-model", operandSpec: { groupSize: [2, 5, 10], groupCount: "0..10" }, constraints: { maximumProduct: 40, representations: ["groups", "array", "repeated-addition"] },
    method: "recognition", misconceptions: MULTIPLY_MISCONCEPTIONS, coverage: ["equal_groups", "array", "repeated_addition"],
    examples: [["2 groups of 2 =", "4"], ["3 groups of 5 =", "15"], ["4 groups of 10 =", "40"], ["8 groups of 5 =", "40"]],
    nonExample: ["5 groups of 9", "The group size is not 2, 5, or 10."],
  }),
  defineSkill({
    id: "G1-M-02", profile: "FACT", domain: "multiplication", title: "Facts for 2, 5, and 10",
    description: "Recall multiplication facts involving 2, 5, or 10 with product no greater than 40.", prerequisites: ["G1-M-01"],
    generatorKind: "multiplication-fact", operandSpec: { focusFactor: [2, 5, 10], otherFactor: "0..10" }, constraints: { maximumProduct: 40 },
    method: "fact_recall", misconceptions: MULTIPLY_MISCONCEPTIONS, coverage: ["row_2", "row_5", "row_10", "focus_factor_left", "focus_factor_right"],
    examples: [["2 × 2 =", "4"], ["5 × 3 =", "15"], ["10 × 4 =", "40"], ["2 × 10 =", "20"]],
    nonExample: ["5 × 9 =", "The product exceeds 40."],
  }),
  defineSkill({
    id: "G1-D-01", profile: "CONCEPT", domain: "division", title: "Share and group exactly",
    description: "Interpret exact division as sharing and grouping with divisors 2, 5, or 10 and dividend no greater than 40.", prerequisites: ["G1-M-01", "G1-AS-04"],
    generatorKind: "division-model", operandSpec: { divisor: [2, 5, 10], dividend: "0..40" }, constraints: { exactDivision: true, representations: ["sharing", "grouping"] },
    method: "recognition", misconceptions: DIVIDE_MISCONCEPTIONS, coverage: ["sharing", "grouping", "zero_dividend"],
    examples: [["4 ÷ 2 =", "2"], ["15 ÷ 5 =", "3"], ["40 ÷ 10 =", "4"], ["20 ÷ 5 =", "4"]],
    nonExample: ["17 ÷ 5 =", "The division is not exact."],
  }),
  defineSkill({
    id: "G1-D-02", profile: "FACT", domain: "division", title: "Inverse division facts",
    description: "Recall exact division facts inverse to the Grade 1 multiplication facts.", prerequisites: ["G1-M-02", "G1-D-01"],
    generatorKind: "division-fact", operandSpec: { divisor: [2, 5, 10], dividend: "0..40" }, constraints: { exactDivision: true, inverseOf: "G1-M-02" },
    method: "fact_recall", misconceptions: DIVIDE_MISCONCEPTIONS, coverage: ["divisor_2", "divisor_5", "divisor_10"],
    examples: [["4 ÷ 2 =", "2"], ["15 ÷ 5 =", "3"], ["40 ÷ 10 =", "4"], ["20 ÷ 2 =", "10"]],
    nonExample: ["45 ÷ 5 =", "Its inverse multiplication fact has product above 40."],
  }),
  defineSkill({
    id: "G1-M-03", tier: "stretch", profile: "FACT", domain: "multiplication", title: "Complete 2, 5, and 10 rows",
    description: "Complete multiplication rows for 2, 5, and 10 through an other factor of 10.", prerequisites: ["G1-M-02"],
    generatorKind: "multiplication-fact", operandSpec: { focusFactor: [2, 5, 10], otherFactor: "0..10" }, constraints: { completeRows: true },
    method: "fact_recall", misconceptions: MULTIPLY_MISCONCEPTIONS, coverage: ["row_2", "row_5", "row_10", "focus_factor_left", "focus_factor_right"],
    examples: [["2 × 6 =", "12"], ["5 × 8 =", "40"], ["10 × 9 =", "90"], ["10 × 10 =", "100"]],
    nonExample: ["2 × 11 =", "The other factor exceeds 10."],
  }),
  defineSkill({
    id: "G1-D-03", tier: "stretch", profile: "FACT", domain: "division", title: "Complete inverse division rows",
    description: "Complete exact inverse-division rows for 2, 5, and 10.", prerequisites: ["G1-M-03", "G1-D-02"],
    generatorKind: "division-fact", operandSpec: { divisor: [2, 5, 10], quotient: "0..10" }, constraints: { exactDivision: true, completeRows: true },
    method: "fact_recall", misconceptions: DIVIDE_MISCONCEPTIONS, coverage: ["divisor_2", "divisor_5", "divisor_10"],
    examples: [["12 ÷ 2 =", "6"], ["40 ÷ 5 =", "8"], ["90 ÷ 10 =", "9"], ["100 ÷ 10 =", "10"]],
    nonExample: ["110 ÷ 10 =", "The inverse row stops at quotient 10."],
  }),
]);

export const G1_SKILL_BY_ID: Readonly<Record<G1SkillId, SkillDefinition>> = Object.freeze(
  Object.fromEntries(G1_SKILLS.map((skill) => [skill.id, skill])) as Record<G1SkillId, SkillDefinition>,
);

/** Alias for adapters that use a grade-oriented naming convention. */
export const GRADE_1_SKILLS = G1_SKILLS;

export function isG1SkillId(value: string): value is G1SkillId {
  return Object.hasOwn(G1_SKILL_BY_ID, value);
}

export function getG1Skill(skillId: string): SkillDefinition {
  if (!isG1SkillId(skillId)) throw new RangeError(`Unknown Grade 1 skill: ${skillId}`);
  return G1_SKILL_BY_ID[skillId];
}
