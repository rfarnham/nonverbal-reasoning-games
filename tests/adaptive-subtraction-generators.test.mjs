import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROBLEM_GENERATION_ATTEMPTS,
  PROBLEM_GENERATORS,
  evaluateProblemAnswer,
  generateProblem,
  generateProblemSet,
  normalizeProblemAnswer,
  problemFingerprint,
  validateGeneratedProblem,
} from "../app/lab/subtraction-flash/adaptive/problems.ts";
import {
  adaptiveSeedHash,
  createAdaptiveRandom,
  deriveAdaptiveSeed,
  randomChoice,
  randomInt,
  randomIntBetween,
  randomUnit,
  shuffleWithRandom,
  stableSeedToken,
} from "../app/lab/subtraction-flash/adaptive/random.ts";
import {
  FACT_AND_MICRO_STEP_MASTERY_POLICY,
  FULL_PROBLEM_MASTERY_POLICY,
  SKILL_DEFINITIONS,
  SKILL_IDS,
  SKILL_PREREQUISITES,
  SKILLS_BY_ID,
  enabledDefaultSkillIds,
  isSkillId,
  skillDefinition,
  skillPrerequisitesMet,
} from "../app/lab/subtraction-flash/adaptive/skills.ts";

const EXPECTED_GRAPH = {
  F01: [],
  F02: [],
  F03: ["F02"],
  F04: ["F01"],
  F05: ["F02", "F03", "F04"],
  R01: [],
  R02: ["R01"],
  R03: ["R02"],
  R04: ["R02"],
  R05: ["R03", "R04"],
  A01: ["F04", "R02", "R03"],
  A02: ["F02"],
  A03: ["F05", "R05", "A01"],
  A04: ["A03"],
  A05: ["A03"],
  A06: ["A02", "A03"],
  T01: ["A06"],
  T02: ["A03"],
  T03: ["A02", "A03"],
  T04: ["A06"],
  T05: [],
};

function corpus(skillId, count = 300, options = {}) {
  return Array.from({ length: count }, (_, index) =>
    generateProblem({ skillId, seed: `corpus:${skillId}:${index}`, ...options }),
  );
}

function numberOperand(problem, key) {
  const value = problem.operands[key];
  assert.equal(typeof value, "number", `${problem.skillId} retains ${key}`);
  return value;
}

function assertCommonProblemContract(problem) {
  assert.deepEqual(validateGeneratedProblem(problem), []);
  assert.ok(problem.id.startsWith(`adaptive-${problem.skillId.toLowerCase()}-`));
  assert.equal(problem.fingerprint, problemFingerprint(problem));
  assert.ok(problem.seed.length > 0);
  assert.ok(problem.promptSpec.displayText.length > 0);
  assert.ok(problem.promptSpec.instruction.length > 0);
  assert.equal(problem.promptSpec.format, problem.metadata.format);
  assert.equal(problem.promptSpec.kind, problem.answerSpec.kind);
  assert.equal(problem.answerSpec.expected, problem.expectedAnswer);
  assert.deepEqual(
    problem.hints.map((hint) => hint.level),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    problem.hints.map((hint) => hint.answerRevealing),
    [false, false, false, false],
  );
  assert.equal(problem.hints[3].kind, "worked_step");
  assert.match(problem.hints[3].text, /^Worked example:/);
  assert.doesNotMatch(problem.hints[3].text, /^The answer is /);
  assert.equal(evaluateProblemAnswer(problem, problem.expectedAnswer).correct, true);
  const wrongAnswer =
    typeof problem.expectedAnswer === "number"
      ? problem.expectedAnswer + 1
      : problem.expectedAnswer === "yes"
        ? "no"
        : "yes";
  assert.equal(evaluateProblemAnswer(problem, wrongAnswer).correct, false);
}

test("the curriculum exposes the complete, acyclic 21-skill graph", () => {
  assert.deepEqual(SKILL_IDS, Object.keys(EXPECTED_GRAPH));
  assert.equal(new Set(SKILL_IDS).size, 21);
  assert.equal(SKILL_DEFINITIONS.length, 21);
  assert.deepEqual(Object.keys(SKILLS_BY_ID), SKILL_IDS);
  assert.deepEqual(Object.keys(PROBLEM_GENERATORS), SKILL_IDS);

  for (const skillId of SKILL_IDS) {
    const skill = skillDefinition(skillId);
    assert.equal(skill.id, skillId);
    assert.deepEqual(skill.prerequisites, EXPECTED_GRAPH[skillId]);
    assert.deepEqual(SKILL_PREREQUISITES[skillId], EXPECTED_GRAPH[skillId]);
    assert.equal(skill.generatorId, skillId);
    assert.ok(skill.title.length > 0);
    assert.ok(skill.childFacingTitle.length > 0);
    assert.ok(skill.description.length > 0);
    assert.ok(skill.tags.length > 0);
    assert.ok(skill.difficultyBands.length > 0);
    assert.ok(skill.remediationSkillIds.every(isSkillId));
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(skillId) {
    assert.equal(visiting.has(skillId), false, `cycle reaches ${skillId}`);
    if (visited.has(skillId)) return;
    visiting.add(skillId);
    for (const prerequisite of EXPECTED_GRAPH[skillId]) visit(prerequisite);
    visiting.delete(skillId);
    visited.add(skillId);
  }
  for (const skillId of SKILL_IDS) visit(skillId);
  assert.equal(visited.size, SKILL_IDS.length);
});

test("mastery metadata preserves separate fact/micro and full-problem defaults", () => {
  assert.deepEqual(FACT_AND_MICRO_STEP_MASTERY_POLICY, {
    minIndependentAttempts: 8,
    minSessions: 2,
    weightedAccuracyThreshold: 0.88,
    recentWindowSize: 4,
    recentCorrectRequired: 3,
    maxRepeatedMisconceptionCount: 1,
  });
  assert.deepEqual(FULL_PROBLEM_MASTERY_POLICY, {
    minIndependentAttempts: 12,
    minSessions: 2,
    weightedAccuracyThreshold: 0.9,
    recentWindowSize: 5,
    recentCorrectRequired: 4,
    maxRepeatedMisconceptionCount: 1,
  });
  for (const skill of SKILL_DEFINITIONS) {
    assert.equal(
      skill.masteryPolicy,
      skill.kind === "fact" || skill.kind === "micro_step"
        ? FACT_AND_MICRO_STEP_MASTERY_POLICY
        : FULL_PROBLEM_MASTERY_POLICY,
    );
  }
  assert.equal(SKILLS_BY_ID.T04.enabledByDefault, false);
  assert.equal(enabledDefaultSkillIds().includes("T04"), false);
  assert.equal(enabledDefaultSkillIds().includes("T05"), true);
});

test("concept prerequisites, not fluency, determine graph availability", () => {
  assert.equal(skillPrerequisitesMet("A03", new Set(["F05", "R05", "A01"])), true);
  assert.equal(skillPrerequisitesMet("A03", new Set(["F05", "R05"])), false);
  assert.equal(skillPrerequisitesMet("T05", new Set()), true);
});

test("string-seeded random helpers are deterministic, bounded, and strict", () => {
  const first = createAdaptiveRandom("same-seed");
  const second = createAdaptiveRandom("same-seed");
  const third = createAdaptiveRandom("different-seed");
  const sequence = Array.from({ length: 20 }, () => first());
  assert.deepEqual(sequence, Array.from({ length: 20 }, () => second()));
  assert.notDeepEqual(sequence, Array.from({ length: 20 }, () => third()));
  assert.ok(sequence.every((value) => value >= 0 && value < 1));
  assert.equal(adaptiveSeedHash("same-seed"), adaptiveSeedHash("same-seed"));
  assert.notEqual(adaptiveSeedHash("same-seed"), adaptiveSeedHash("other-seed"));
  assert.equal(stableSeedToken("same-seed"), stableSeedToken("same-seed"));
  assert.notEqual(deriveAdaptiveSeed("ab", "c"), deriveAdaptiveSeed("a", "bc"));

  const integerRandom = createAdaptiveRandom("integer-ranges");
  for (let index = 0; index < 200; index += 1) {
    assert.ok(randomInt(integerRandom, 7) >= 0 && randomInt(integerRandom, 7) < 7);
    const bounded = randomIntBetween(integerRandom, 4, 9);
    assert.ok(bounded >= 4 && bounded <= 9);
  }
  assert.ok(["a", "b", "c"].includes(randomChoice(createAdaptiveRandom("choice"), ["a", "b", "c"])));
  assert.deepEqual(
    [...shuffleWithRandom(createAdaptiveRandom("shuffle"), [1, 2, 3, 4])].sort(),
    [1, 2, 3, 4],
  );

  assert.throws(() => createAdaptiveRandom(""), /non-empty strings/);
  assert.throws(() => randomUnit(() => -0.01), /\[0, 1\)/);
  assert.throws(() => randomUnit(() => 1), /\[0, 1\)/);
  assert.throws(() => randomUnit(() => Number.NaN), /\[0, 1\)/);
  assert.throws(() => randomInt(() => 0.5, 0), /positive safe integer/);
  assert.throws(() => randomIntBetween(() => 0.5, 9, 4), /ordered safe integers/);
  assert.throws(() => randomChoice(() => 0.5, []), /empty collection/);
});

test("every skill generator is deterministic and valid across a large corpus", () => {
  for (const skillId of SKILL_IDS) {
    for (let index = 0; index < 250; index += 1) {
      const seed = `validity:${skillId}:${index}`;
      const problem = generateProblem({ skillId, seed });
      assertCommonProblemContract(problem);
      assert.deepEqual(problem, generateProblem({ skillId, seed }));
    }
  }
});

test("every skill supports explicit horizontal and vertical presentation", () => {
  for (const skillId of SKILL_IDS) {
    const horizontal = generateProblem({ skillId, seed: `horizontal:${skillId}`, format: "horizontal" });
    const vertical = generateProblem({ skillId, seed: `vertical:${skillId}`, format: "vertical" });
    assert.equal(horizontal.promptSpec.format, "horizontal");
    assert.equal(horizontal.metadata.format, "horizontal");
    assert.equal(vertical.promptSpec.format, "vertical");
    assert.equal(vertical.metadata.format, "vertical");
    assertCommonProblemContract(horizontal);
    assertCommonProblemContract(vertical);
  }
});

test("fact generators preserve each fact-family boundary", () => {
  for (const problem of corpus("F01", 600)) {
    const missingValue = numberOperand(problem, "missingValue");
    const complement = numberOperand(problem, "complement");
    assert.ok(missingValue >= 1 && missingValue <= 9);
    assert.equal(missingValue + complement, 10);
  }
  for (const problem of corpus("F02")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.ok(minuend <= 10 && subtrahend >= 1);
    assert.equal(problem.expectedAnswer, minuend - subtrahend);
  }
  for (const problem of corpus("F03")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.ok(minuend >= 11 && minuend <= 18);
    assert.ok(minuend % 10 >= subtrahend);
    assert.ok(problem.expectedAnswer >= 10);
  }
  for (const problem of corpus("F04")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.ok(minuend >= 11 && minuend <= 18);
    assert.ok(subtrahend > minuend % 10);
    assert.ok(problem.expectedAnswer >= 1 && problem.expectedAnswer <= 9);
  }
  const mixed = corpus("F05", 600);
  assert.deepEqual(new Set(mixed.map((problem) => problem.metadata.sourceSkillId)), new Set(["F02", "F03", "F04"]));
});

test("complements are balanced and a generated session never repeats a pair", () => {
  const counts = new Map(Array.from({ length: 9 }, (_, index) => [index + 1, 0]));
  for (const problem of corpus("F01", 900)) {
    const value = numberOperand(problem, "missingValue");
    counts.set(value, counts.get(value) + 1);
  }
  for (const count of counts.values()) {
    assert.ok(count >= 65 && count <= 135, `balanced complement count ${count}`);
  }

  const session = generateProblemSet({ skillId: "F01", seed: "five-complement-pairs", count: 5 });
  const pairs = session.map((problem) => {
    const left = numberOperand(problem, "missingValue");
    const right = numberOperand(problem, "complement");
    return `${Math.min(left, right)}+${Math.max(left, right)}`;
  });
  assert.equal(new Set(pairs).size, 5);
  assert.throws(
    () => generateProblemSet({ skillId: "F01", seed: "too-many-pairs", count: 6 }),
    /at most five/,
  );
});

test("regrouping micro-skills isolate the intended state transition", () => {
  const decisions = corpus("R01", 600);
  const yesCount = decisions.filter((problem) => problem.expectedAnswer === "yes").length;
  assert.ok(yesCount >= 250 && yesCount <= 350, `R01 yes count ${yesCount}`);
  for (const problem of decisions) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.equal(problem.promptSpec.kind, "two-choice");
    assert.equal(problem.expectedAnswer, minuend % 10 < subtrahend % 10 ? "yes" : "no");
    assert.ok(numberOperand(problem, "result") >= 0);
  }

  const renames = corpus("R02", 600);
  assert.ok(renames.some((problem) => numberOperand(problem, "originalOnes") === 0));
  assert.deepEqual(
    new Set(renames.map((problem) => problem.metadata.renameQuestion)),
    new Set(["renamed_tens", "renamed_ones"]),
  );
  for (const problem of renames) {
    assert.equal(
      numberOperand(problem, "renamedTens"),
      numberOperand(problem, "originalTens") - 1,
    );
    assert.equal(
      numberOperand(problem, "renamedOnes"),
      numberOperand(problem, "originalOnes") + 10,
    );
  }

  for (const problem of corpus("R03")) {
    assert.equal(
      problem.expectedAnswer,
      numberOperand(problem, "renamedOnes") - numberOperand(problem, "subtrahendOnes"),
    );
  }
  for (const problem of corpus("R04")) {
    assert.equal(
      problem.expectedAnswer,
      numberOperand(problem, "renamedTens") - numberOperand(problem, "subtrahendTens"),
    );
  }
  for (const problem of corpus("R05")) {
    assert.equal(
      problem.expectedAnswer,
      numberOperand(problem, "answerTens") * 10 + numberOperand(problem, "answerOnes"),
    );
  }
});

test("complete-application generators preserve exact regrouping distinctions", () => {
  for (const problem of corpus("A01")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.ok(minuend >= 20 && subtrahend <= 9 && subtrahend > minuend % 10);
  }
  for (const problem of corpus("A02")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.ok(minuend % 10 >= subtrahend % 10);
    assert.ok(Math.floor(minuend / 10) >= Math.floor(subtrahend / 10));
    assert.ok(minuend > subtrahend);
    assert.equal(problem.metadata.requiresRegrouping, false);
  }
  for (const problem of corpus("A03")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.notEqual(minuend % 10, 0);
    assert.ok(minuend % 10 < subtrahend % 10);
    assert.ok(Math.floor(minuend / 10) - 1 >= Math.floor(subtrahend / 10));
    assert.ok(problem.expectedAnswer >= 10);
  }
  for (const problem of corpus("A04")) {
    assert.equal(numberOperand(problem, "minuend") % 10, 0);
    assert.notEqual(numberOperand(problem, "subtrahend") % 10, 0);
    assert.ok(problem.expectedAnswer > 0);
    assert.equal(problem.metadata.minuendEndsInZero, true);
  }
  for (const problem of corpus("A05")) {
    const minuend = numberOperand(problem, "minuend");
    const subtrahend = numberOperand(problem, "subtrahend");
    assert.ok(minuend % 10 < subtrahend % 10);
    assert.equal(Math.floor(minuend / 10) - 1, Math.floor(subtrahend / 10));
    assert.ok(problem.expectedAnswer >= 1 && problem.expectedAnswer <= 9);
    assert.equal(problem.metadata.resultUnderTen, true);
  }

  const mixed = corpus("A06", 800);
  assert.deepEqual(
    new Set(mixed.map((problem) => problem.metadata.sourceSkillId)),
    new Set(["A02", "A03", "A04", "A05"]),
  );
});

test("transfer generators cover missing terms, repair errors, formats, signs, and fallback challenges", () => {
  const missing = corpus("T01", 800);
  assert.deepEqual(
    new Set(missing.map((problem) => problem.metadata.missingTerm)),
    new Set(["left", "right", "result"]),
  );
  const missingCounts = Object.groupBy(missing, (problem) => problem.metadata.missingTerm);
  assert.ok(missingCounts.left.length < missingCounts.right.length);
  assert.ok(missingCounts.left.length < missingCounts.result.length);
  for (const problem of missing) {
    assert.equal(problem.promptSpec.math.kind, "equation");
    assert.equal(problem.promptSpec.math[problem.metadata.missingTerm], null);
  }
  const introductoryMissing = corpus("T01", 400, { difficulty: 3 });
  assert.deepEqual(
    new Set(introductoryMissing.map((problem) => problem.metadata.missingTerm)),
    new Set(["right", "result"]),
  );
  assert.equal(
    introductoryMissing.some((problem) => problem.metadata.missingTerm === "left"),
    false,
  );
  const laterMissing = corpus("T01", 800, { difficulty: 4 });
  assert.ok(laterMissing.some((problem) => problem.metadata.missingTerm === "left"));

  const repairs = corpus("T02", 800);
  assert.deepEqual(
    new Set(repairs.map((problem) => problem.metadata.misconception)),
    new Set([
      "forgot_to_decrement_tens",
      "regrouping_not_detected",
      "wrong_operation",
      "ones_digit_error",
      "tens_digit_error",
    ]),
  );
  for (const problem of repairs) {
    assert.equal(problem.promptSpec.math.kind, "repair");
    assert.notEqual(numberOperand(problem, "shownAnswer"), problem.expectedAnswer);
  }

  const horizontal = generateProblem({ skillId: "T03", seed: "transfer-pair", format: "horizontal" });
  const vertical = generateProblem({ skillId: "T03", seed: "transfer-pair", format: "vertical" });
  assert.equal(horizontal.metadata.format, "horizontal");
  assert.equal(vertical.metadata.format, "vertical");
  assert.deepEqual(horizontal.operands, vertical.operands);
  assert.equal(horizontal.expectedAnswer, vertical.expectedAnswer);
  assert.equal(horizontal.seed, vertical.seed);
  assert.notEqual(horizontal.fingerprint, vertical.fingerprint);

  const signs = corpus("T04", 800);
  assert.deepEqual(
    new Set(signs.map((problem) => problem.metadata.operation)),
    new Set(["addition", "subtraction"]),
  );
  for (const problem of signs) {
    if (problem.metadata.operation === "addition") {
      assert.equal(problem.expectedAnswer, numberOperand(problem, "left") + numberOperand(problem, "right"));
    } else {
      assert.equal(
        problem.expectedAnswer,
        numberOperand(problem, "minuend") - numberOperand(problem, "subtrahend"),
      );
    }
  }

  const challenges = corpus("T05", 400);
  assert.deepEqual(
    new Set(challenges.map((problem) => problem.metadata.sourceSkillId)),
    new Set(["T01", "T02"]),
  );
  assert.ok(
    challenges.every(
      (problem) => problem.metadata.challengeProvider === "built-in-transfer-fallback",
    ),
  );
  const introductoryChallenges = corpus("T05", 400, { difficulty: 3 });
  assert.ok(
    introductoryChallenges.every(
      (problem) =>
        problem.metadata.sourceSkillId !== "T01" ||
        problem.metadata.missingTerm !== "left",
    ),
  );
});

test("canonical fingerprints support deterministic exclusions and reconstruction", () => {
  for (const skillId of SKILL_IDS) {
    const first = generateProblem({ skillId, seed: `exclude:${skillId}` });
    const excluded = new Set([first.fingerprint]);
    const replacement = generateProblem({ skillId, seed: `exclude:${skillId}`, excludedFingerprints: excluded });
    assert.notEqual(replacement.fingerprint, first.fingerprint);
    assert.deepEqual(
      replacement,
      generateProblem({ skillId, seed: `exclude:${skillId}`, excludedFingerprints: excluded }),
    );
    assert.deepEqual(replacement, generateProblem({ skillId, seed: replacement.seed }));

    const reorderedOperands = Object.fromEntries(Object.entries(first.operands).reverse());
    assert.equal(problemFingerprint({ ...first, operands: reorderedOperands }), first.fingerprint);
  }
});

test("problem-set generation avoids repeats and can alternate presentation formats", () => {
  const problems = generateProblemSet({
    skillId: "A06",
    seed: "mixed-session",
    count: 48,
    formats: ["horizontal", "vertical"],
  });
  assert.equal(problems.length, 48);
  assert.equal(new Set(problems.map((problem) => problem.fingerprint)).size, 48);
  assert.deepEqual(
    problems.map((problem) => problem.metadata.format),
    Array.from({ length: 48 }, (_, index) => (index % 2 === 0 ? "horizontal" : "vertical")),
  );
  assert.deepEqual(
    problems,
    generateProblemSet({
      skillId: "A06",
      seed: "mixed-session",
      count: 48,
      formats: ["horizontal", "vertical"],
    }),
  );

  const multiSkill = generateProblemSet({
    skillIds: ["F04", "R02", "A03", "T01"],
    seed: "multi-skill-session",
    count: 24,
  });
  assert.equal(new Set(multiSkill.map((problem) => problem.fingerprint)).size, 24);
  assert.ok(multiSkill.every((problem) => ["F04", "R02", "A03", "T01"].includes(problem.skillId)));
});

test("answer normalization accepts intentional equivalents and rejects ambiguous input", () => {
  const numeric = generateProblem({ skillId: "A03", seed: "numeric-evaluation" });
  assert.equal(normalizeProblemAnswer(numeric, `  ${numeric.expectedAnswer}  `), numeric.expectedAnswer);
  assert.equal(evaluateProblemAnswer(numeric, String(numeric.expectedAnswer)).correct, true);
  assert.equal(normalizeProblemAnswer(numeric, "12.0"), null);
  assert.equal(normalizeProblemAnswer(numeric, "12 apples"), null);
  assert.equal(normalizeProblemAnswer(numeric, Number.NaN), null);
  assert.equal(normalizeProblemAnswer(numeric, 3.5), null);
  assert.equal(normalizeProblemAnswer(numeric, null), null);

  const decision = generateProblem({ skillId: "R01", seed: "choice-evaluation" });
  assert.equal(normalizeProblemAnswer(decision, "Y"), "yes");
  assert.equal(normalizeProblemAnswer(decision, " false "), "no");
  assert.equal(normalizeProblemAnswer(decision, true), "yes");
  assert.equal(normalizeProblemAnswer(decision, false), "no");
  assert.equal(normalizeProblemAnswer(decision, "maybe"), null);
});

test("invalid inputs and stale fingerprints fail clearly", () => {
  assert.equal(MAX_PROBLEM_GENERATION_ATTEMPTS, 96);
  assert.throws(() => generateProblem({ skillId: "A03", seed: "" }), /non-empty string seed/);
  assert.throws(
    () => generateProblem({ skillId: "A03", seed: "bad-format", format: "diagonal" }),
    /Unsupported problem format/,
  );
  assert.throws(
    () => generateProblem({ skillId: "A03", seed: "bad-difficulty", difficulty: 1 }),
    /not valid/,
  );
  assert.throws(
    () => generateProblemSet({ skillIds: [], seed: "no-skills", count: 1 }),
    /at least one valid adaptive skill/,
  );
  assert.throws(
    () => generateProblemSet({ skillId: "A03", seed: "negative", count: -1 }),
    /nonnegative safe integer/,
  );

  const valid = generateProblem({ skillId: "A03", seed: "tamper-check" });
  const tampered = { ...valid, expectedAnswer: valid.expectedAnswer + 1 };
  assert.ok(validateGeneratedProblem(tampered).length > 0);
});
