import { G1_GENERATOR_KINDS, G1_SKILL_IDS, G1_SKILLS } from "./g1-curriculum.ts";
import type { AnswerForm, MasteryProfile, SkillDefinition } from "./types.ts";

export type CurriculumValidationCode =
  | "duplicate_skill_id"
  | "missing_normative_skill"
  | "unknown_prerequisite"
  | "prerequisite_cycle"
  | "core_depends_on_stretch"
  | "later_grade_prerequisite"
  | "unknown_generator"
  | "unknown_mastery_profile"
  | "missing_examples"
  | "invalid_example"
  | "missing_nonexamples"
  | "missing_coverage"
  | "invalid_coverage"
  | "missing_difficulty_band"
  | "unknown_answer_evaluator"
  | "unknown_misconception_tag"
  | "outside_arithmetic_scope"
  | "invalid_grade_or_version";

export interface CurriculumValidationIssue {
  readonly code: CurriculumValidationCode;
  readonly message: string;
  readonly skillId?: string;
}

export interface CurriculumValidationResult {
  readonly valid: boolean;
  readonly skillsValidated: number;
  readonly errors: readonly CurriculumValidationIssue[];
}

const MASTERY_PROFILES = new Set<MasteryProfile>([
  "CONCEPT", "FACT", "MENTAL", "ALGO_SHORT", "ALGO_LONG", "RATIONAL", "MIXED",
]);
const ANSWER_EVALUATORS = new Set<AnswerForm>([
  "integer", "fraction", "reduced_fraction", "finite_decimal", "mixed_number", "remainder", "percent",
]);
const ARITHMETIC_DOMAINS = new Set([
  "addition", "subtraction", "multiplication", "division", "fractions", "decimals", "percent",
  "ratio_rate", "number_properties", "expressions", "estimation",
]);
const GENERATOR_KINDS = new Set<string>(G1_GENERATOR_KINDS);
const MISCONCEPTION_TAGS = new Set([
  "count_all", "count_from_one", "column_misalignment", "omitted_carry", "carry_to_wrong_place",
  "subtract_smaller_digit_from_larger", "borrow_without_decomposing", "zero_chain_failure",
  "operation_reversal", "missing_operand_confusion", "repeated_addition_error", "zero_property_error",
  "identity_property_error", "fact_family_confusion", "omitted_partial_product", "place_shift_error",
  "carry_error", "multiplication_always_increases", "dividend_divisor_reversal", "division_by_zero",
  "remainder_too_large", "omitted_quotient_zero", "poor_quotient_estimate", "quotient_digit_shift",
  "remainder_form_mismatch", "division_always_decreases", "add_denominators", "subtract_denominators",
  "compare_numerators_only", "compare_denominators_only", "whole_number_bias",
  "incorrect_equivalent_fraction", "failure_to_reduce", "cross_cancel_across_addition", "wrong_reciprocal",
  "mixed_number_conversion_error", "align_right_edges", "more_digits_means_larger",
  "decimal_point_shift_error", "trailing_zero_changes_value", "whole_number_place_value_transfer",
  "rounding_place_error", "part_whole_reversal", "percent_treated_as_whole_number",
  "percent_change_wrong_base", "reverse_percent_subtraction", "ratio_order_reversal",
  "additive_instead_of_multiplicative_scaling", "ratio_parts_not_summed", "unit_rate_reversal",
]);

function issue(
  errors: CurriculumValidationIssue[],
  code: CurriculumValidationCode,
  message: string,
  skillId?: string,
): void {
  errors.push(skillId ? { code, message, skillId } : { code, message });
}

function evaluateIntegerExpression(source: string): number | null {
  const compact = source.replaceAll(/\s/g, "");
  if (/^\d+$/.test(compact)) return Number(compact);
  const tokens = compact.match(/\d+|[+\-×÷]/g);
  if (!tokens || tokens.join("") !== compact || tokens.length < 3 || tokens.length % 2 === 0) {
    return null;
  }
  let value = Number(tokens[0]);
  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index]!;
    const operand = Number(tokens[index + 1]);
    if (!Number.isSafeInteger(operand)) return null;
    if (operator === "+") value += operand;
    else if (operator === "-") value -= operand;
    else if (operator === "×") value *= operand;
    else {
      if (operand === 0 || value % operand !== 0) return null;
      value /= operand;
    }
  }
  return Number.isSafeInteger(value) ? value : null;
}

function canonicalExampleIsExecutable(
  example: SkillDefinition["examples"][number],
): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(example.answer)) return false;
  const answer = Number(example.answer);
  const groups = /^(\d+)\s+groups\s+of\s+(\d+)\s*=\s*$/.exec(example.prompt);
  if (groups) return Number(groups[1]) * Number(groups[2]) === answer;
  const completed = example.prompt.replaceAll("□", example.answer);
  const equalsIndex = completed.indexOf("=");
  if (equalsIndex < 0 || completed.indexOf("=", equalsIndex + 1) >= 0) return false;
  const left = evaluateIntegerExpression(completed.slice(0, equalsIndex));
  const rightSource = completed.slice(equalsIndex + 1).trim();
  const right = evaluateIntegerExpression(rightSource || example.answer);
  return left !== null && right !== null && left === right;
}

export function validateG1Curriculum(
  skills: readonly SkillDefinition[] = G1_SKILLS,
): CurriculumValidationResult {
  const errors: CurriculumValidationIssue[] = [];
  const byId = new Map<string, SkillDefinition>();

  for (const skill of skills) {
    if (byId.has(skill.id)) {
      issue(errors, "duplicate_skill_id", `Skill ID ${skill.id} appears more than once.`, skill.id);
    } else {
      byId.set(skill.id, skill);
    }
  }

  for (const expectedId of G1_SKILL_IDS) {
    if (!byId.has(expectedId)) issue(errors, "missing_normative_skill", `Normative skill ${expectedId} is missing.`, expectedId);
  }

  for (const skill of skills) {
    if (skill.grade !== 1 || !Number.isSafeInteger(skill.version) || skill.version < 1) {
      issue(errors, "invalid_grade_or_version", "Grade 1 skills require grade=1 and a positive integer version.", skill.id);
    }
    if (!ARITHMETIC_DOMAINS.has(skill.domain)) {
      issue(errors, "outside_arithmetic_scope", `Domain ${skill.domain} is not an arithmetic-fluency domain.`, skill.id);
    }
    if (!GENERATOR_KINDS.has(skill.generator.kind)) {
      issue(errors, "unknown_generator", `Generator kind ${skill.generator.kind} is not registered.`, skill.id);
    }
    if (!MASTERY_PROFILES.has(skill.masteryProfile)) {
      issue(errors, "unknown_mastery_profile", `Mastery profile ${skill.masteryProfile} is not registered.`, skill.id);
    }
    if (skill.examples.length === 0) issue(errors, "missing_examples", "At least one canonical example is required.", skill.id);
    for (const example of skill.examples) {
      if (!canonicalExampleIsExecutable(example)) {
        issue(
          errors,
          "invalid_example",
          `Canonical example ${example.prompt} ${example.answer} is not an exact executable equation.`,
          skill.id,
        );
      }
    }
    if (skill.nonExamples.length === 0) issue(errors, "missing_nonexamples", "At least one canonical nonexample is required.", skill.id);
    if (skill.generator.coverageRequirements.length === 0) {
      issue(errors, "missing_coverage", "At least one structural coverage requirement is required.", skill.id);
    }
    const coverageKeys = new Set<string>();
    for (const requirement of skill.generator.coverageRequirements) {
      if (!requirement.key || coverageKeys.has(requirement.key) || requirement.minimumShare <= 0 || requirement.minimumShare > 1) {
        issue(errors, "invalid_coverage", `Coverage requirement ${requirement.key || "(blank)"} is duplicated or invalid.`, skill.id);
      }
      coverageKeys.add(requirement.key);
    }
    const bands = skill.generator.difficultyBands.map((band) => band.band);
    if (bands.length !== 4 || new Set(bands).size !== 4 || ![1, 2, 3, 4].every((band) => bands.includes(band as 1 | 2 | 3 | 4))) {
      issue(errors, "missing_difficulty_band", "Every skill must define difficulty bands 1, 2, 3, and 4 exactly once.", skill.id);
    }
    for (const form of skill.acceptedAnswerForms) {
      if (!ANSWER_EVALUATORS.has(form)) issue(errors, "unknown_answer_evaluator", `No evaluator is registered for ${form}.`, skill.id);
    }
    for (const tag of skill.misconceptionTags) {
      if (!MISCONCEPTION_TAGS.has(tag)) issue(errors, "unknown_misconception_tag", `Misconception tag ${tag} is not registered.`, skill.id);
    }
    for (const prerequisiteId of skill.prerequisites) {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite) {
        issue(errors, "unknown_prerequisite", `Prerequisite ${prerequisiteId} does not exist.`, skill.id);
        continue;
      }
      if (prerequisite.grade > skill.grade) {
        issue(errors, "later_grade_prerequisite", `Prerequisite ${prerequisiteId} is from a later grade.`, skill.id);
      }
      if (skill.tier === "core" && prerequisite.tier === "stretch") {
        issue(errors, "core_depends_on_stretch", `Core skill depends on stretch skill ${prerequisiteId}.`, skill.id);
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const reported = new Set<string>();
  const visit = (skillId: string): void => {
    if (visited.has(skillId)) return;
    if (visiting.has(skillId)) {
      if (!reported.has(skillId)) {
        issue(errors, "prerequisite_cycle", `Prerequisite graph contains a cycle through ${skillId}.`, skillId);
        reported.add(skillId);
      }
      return;
    }
    const skill = byId.get(skillId);
    if (!skill) return;
    visiting.add(skillId);
    for (const prerequisite of skill.prerequisites) visit(prerequisite);
    visiting.delete(skillId);
    visited.add(skillId);
  };
  for (const skill of skills) visit(skill.id);

  return Object.freeze({
    valid: errors.length === 0,
    skillsValidated: skills.length,
    errors: Object.freeze(errors),
  });
}

export function assertValidG1Curriculum(skills: readonly SkillDefinition[] = G1_SKILLS): void {
  const result = validateG1Curriculum(skills);
  if (!result.valid) {
    throw new Error(`Invalid Grade 1 arithmetic curriculum:\n${result.errors.map((error) => `- [${error.code}] ${error.skillId ?? "curriculum"}: ${error.message}`).join("\n")}`);
  }
}
