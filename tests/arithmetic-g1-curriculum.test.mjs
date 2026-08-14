import assert from "node:assert/strict";
import test from "node:test";

import {
  exactIntegerValue,
  exactNumberToString,
  exactNumbersEqual,
  finiteDecimalExact,
  integerExact,
  mixedNumberExact,
  parseExactAnswer,
  percentExact,
  rationalExact,
  remainderExact,
} from "../lib/arithmetic-fluency/exact-number.ts";
import {
  G1_CURRICULUM_VERSION,
  G1_GENERATOR_KINDS,
  G1_SKILL_BY_ID,
  G1_SKILL_IDS,
  G1_SKILLS,
  GRADE_1_SKILLS,
  getG1Skill,
  isG1SkillId,
} from "../lib/arithmetic-fluency/g1-curriculum.ts";
import {
  assertValidG1Curriculum,
  validateG1Curriculum,
} from "../lib/arithmetic-fluency/validator.ts";

const EXPECTED_PREREQUISITES = {
  "G1-AS-01": [],
  "G1-AS-02": ["G1-AS-01"],
  "G1-AS-03": ["G1-AS-01"],
  "G1-AS-04": ["G1-AS-03"],
  "G1-AS-05": ["G1-AS-02", "G1-AS-03"],
  "G1-AS-06": ["G1-AS-04", "G1-AS-05"],
  "G1-AS-07": ["G1-AS-05", "G1-AS-06"],
  "G1-AS-08": ["G1-AS-05"],
  "G1-AS-09": ["G1-AS-03"],
  "G1-AS-10": ["G1-AS-05", "G1-AS-09"],
  "G1-AS-11": ["G1-AS-04"],
  "G1-AS-12": ["G1-AS-06", "G1-AS-11"],
  "G1-AS-13": ["G1-AS-02"],
  "G1-AS-14": ["G1-AS-09"],
  "G1-AS-15": ["G1-AS-10", "G1-AS-14"],
  "G1-AS-16": ["G1-AS-11"],
  "G1-AS-17": ["G1-AS-12", "G1-AS-16"],
  "G1-AS-18": ["G1-AS-07"],
  "G1-M-01": ["G1-AS-03"],
  "G1-M-02": ["G1-M-01"],
  "G1-D-01": ["G1-M-01", "G1-AS-04"],
  "G1-D-02": ["G1-M-02", "G1-D-01"],
  "G1-M-03": ["G1-M-02"],
  "G1-D-03": ["G1-M-03", "G1-D-02"],
};

test("Grade 1 exposes all 22 core and 2 stretch skills as structured curriculum data", () => {
  assert.equal(G1_CURRICULUM_VERSION, 1);
  assert.equal(G1_SKILL_IDS.length, 24);
  assert.equal(new Set(G1_SKILL_IDS).size, 24);
  assert.equal(G1_SKILLS.length, 24);
  assert.equal(GRADE_1_SKILLS, G1_SKILLS);
  assert.deepEqual(Object.keys(G1_SKILL_BY_ID), G1_SKILL_IDS);
  assert.equal(G1_SKILLS.filter((skill) => skill.tier === "core").length, 22);
  assert.deepEqual(G1_SKILLS.filter((skill) => skill.tier === "stretch").map((skill) => skill.id), ["G1-M-03", "G1-D-03"]);

  for (const skill of G1_SKILLS) {
    assert.equal(skill.grade, 1);
    assert.equal(skill.version, 1);
    assert.deepEqual(skill.prerequisites, EXPECTED_PREREQUISITES[skill.id]);
    assert.equal(getG1Skill(skill.id), skill);
    assert.equal(isG1SkillId(skill.id), true);
    assert.ok(G1_GENERATOR_KINDS.includes(skill.generator.kind));
    assert.deepEqual(skill.generator.difficultyBands.map((band) => band.band), [1, 2, 3, 4]);
    assert.equal(skill.generator.coverageRequirements.length >= 2, true);
    assert.ok(skill.generator.coverageRequirements.every((entry) => entry.critical));
    assert.equal(skill.examples.length, 4);
    assert.equal(skill.nonExamples.length >= 1, true);
    assert.equal(skill.misconceptionTags.length >= 2, true);
    assert.deepEqual(skill.acceptedAnswerForms, ["integer"]);
  }
  assert.equal(isG1SkillId("G2-AS-01"), false);
  assert.throws(() => getG1Skill("G1-NOT-REAL"), /Unknown Grade 1 skill/);
});

test("the normative Grade 1 prerequisite graph validates and is acyclic", () => {
  const result = validateG1Curriculum();
  assert.deepEqual(result, { valid: true, skillsValidated: 24, errors: [] });
  assert.doesNotThrow(() => assertValidG1Curriculum());

  const visited = new Set();
  const visiting = new Set();
  const visit = (skillId) => {
    assert.equal(visiting.has(skillId), false, `cycle through ${skillId}`);
    if (visited.has(skillId)) return;
    visiting.add(skillId);
    for (const prerequisite of EXPECTED_PREREQUISITES[skillId]) visit(prerequisite);
    visiting.delete(skillId);
    visited.add(skillId);
  };
  G1_SKILL_IDS.forEach(visit);
  assert.equal(visited.size, 24);
});

test("canonical examples carry explicit executable answers for missing-part and missing-term prompts", () => {
  assert.deepEqual(
    G1_SKILL_BY_ID["G1-AS-01"].examples.map(({ prompt, answer }) => [prompt, answer]),
    [["1 + □ = 2", "1"], ["3 + □ = 4", "1"], ["2 + □ = 5", "3"], ["0 + □ = 5", "5"]],
  );
  assert.deepEqual(
    G1_SKILL_BY_ID["G1-AS-18"].examples.map(({ prompt, answer }) => [prompt, answer]),
    [["□ + 2 = 5", "3"], ["7 + □ = 12", "5"], ["□ - 4 = 9", "13"], ["20 - □ = 11", "9"]],
  );
  const invalid = G1_SKILLS.map((skill) =>
    skill.id === "G1-AS-18"
      ? { ...skill, examples: [{ ...skill.examples[0], answer: "99" }, ...skill.examples.slice(1)] }
      : skill);
  assert.ok(
    validateG1Curriculum(invalid).errors.some(
      ({ code, skillId }) => code === "invalid_example" && skillId === "G1-AS-18",
    ),
  );
});

test("validation detects duplicate IDs, missing prerequisites, cycles, and core-to-stretch dependencies", () => {
  const base = G1_SKILLS.map((skill) => ({ ...skill }));
  const duplicate = validateG1Curriculum([...base, base[0]]);
  assert.equal(duplicate.errors.some((entry) => entry.code === "duplicate_skill_id"), true);

  const missingPrerequisite = base.map((skill) => skill.id === "G1-AS-01" ? { ...skill, prerequisites: ["G1-NOPE"] } : skill);
  assert.equal(validateG1Curriculum(missingPrerequisite).errors.some((entry) => entry.code === "unknown_prerequisite"), true);

  const cyclic = base.map((skill) => skill.id === "G1-AS-01" ? { ...skill, prerequisites: ["G1-AS-02"] } : skill);
  assert.equal(validateG1Curriculum(cyclic).errors.some((entry) => entry.code === "prerequisite_cycle"), true);

  const coreToStretch = base.map((skill) => skill.id === "G1-AS-01" ? { ...skill, prerequisites: ["G1-M-03"] } : skill);
  assert.equal(validateG1Curriculum(coreToStretch).errors.some((entry) => entry.code === "core_depends_on_stretch"), true);
});

test("validation rejects a supplied catalogue with a missing normative leaf", () => {
  for (const leafId of ["G1-AS-08", "G1-D-03"]) {
    const withoutLeaf = G1_SKILLS.filter((skill) => skill.id !== leafId);
    const result = validateG1Curriculum(withoutLeaf);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some((entry) => entry.code === "missing_normative_skill" && entry.skillId === leafId),
      true,
    );
  }
});

test("exact numbers normalize equivalent rational, decimal, mixed, remainder, and percent forms", () => {
  const half = rationalExact(2, 4);
  assert.deepEqual(half, { kind: "rational", numerator: 1, denominator: 2 });
  assert.equal(exactNumbersEqual(half, finiteDecimalExact(50, 2)), true);
  assert.equal(exactNumbersEqual(half, percentExact(50, 100)), true);
  assert.equal(exactNumbersEqual(mixedNumberExact(7, 2, 5), remainderExact(7, 2, 5)), true);
  assert.equal(exactNumbersEqual(remainderExact(7, 2, 5), finiteDecimalExact(74, 1)), true);
  assert.equal(exactIntegerValue(rationalExact(8, 4)), 2);
  assert.equal(exactIntegerValue(rationalExact(3, 2)), null);
  assert.equal(exactNumberToString(finiteDecimalExact(250, 2)), "2.5");
  assert.equal(exactNumberToString(remainderExact(7, 2, 5)), "7 R 2");
});

test("exact answer parsing is strict, JSON-safe, and retains the submitted form", () => {
  assert.deepEqual(parseExactAnswer("2/4"), {
    value: { kind: "rational", numerator: 1, denominator: 2 },
    form: "fraction",
    reducedFraction: false,
  });
  assert.deepEqual(parseExactAnswer("2.50"), {
    value: { kind: "finite_decimal", coefficient: 25, scale: 1 },
    form: "finite_decimal",
    reducedFraction: true,
  });
  assert.deepEqual(parseExactAnswer("50%"), {
    value: { kind: "percent", numerator: 1, denominator: 2 },
    form: "percent",
    reducedFraction: true,
  });
  assert.deepEqual(parseExactAnswer("7 R 2", remainderExact(7, 2, 5)), {
    value: { kind: "remainder", quotient: 7, remainder: 2, divisor: 5 },
    form: "remainder",
    reducedFraction: true,
  });
  assert.equal(parseExactAnswer("seven"), null);
  assert.equal(parseExactAnswer("07"), null);
  assert.equal(parseExactAnswer("00"), null);
  assert.equal(parseExactAnswer("00.5"), null);
  assert.equal(parseExactAnswer("02/4"), null);
  assert.equal(parseExactAnswer("7 R 5", remainderExact(7, 2, 5)), null);
  assert.deepEqual(JSON.parse(JSON.stringify(integerExact(9))), integerExact(9));
});
