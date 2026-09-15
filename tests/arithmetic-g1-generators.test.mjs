import assert from "node:assert/strict";
import test from "node:test";

import { exactIntegerValue } from "../lib/arithmetic-fluency/exact-number.ts";
import { G1_SKILLS } from "../lib/arithmetic-fluency/g1-curriculum.ts";
import {
  G1_BOUNDARY_FIXTURE_SEEDS,
  G1_CANONICAL_FIXTURE_SEEDS,
  G1_GENERATOR_VERSION,
  evaluateG1Answer,
  factKeyForQuestion,
  factUniverseForSkill,
  generateG1Question,
  g1QuestionSemanticFingerprint,
  requiredCoverageKeysForSkill,
  verifyG1GeneratorCorpus,
} from "../lib/arithmetic-fluency/generator.ts";

function integerOperands(question) {
  return question.operands.map((operand) => {
    assert.equal(operand.kind, "integer");
    return operand.value;
  });
}

function recomputeFromAst(question) {
  const ast = question.promptAst;
  if (ast.kind === "part-whole") return ast.total - ast.knownPart;
  if (ast.kind === "equal-groups") return ast.groupCount * ast.groupSize;
  if (ast.kind === "division-model") {
    assert.notEqual(ast.divisor, 0);
    assert.equal(ast.dividend % ast.divisor, 0);
    return ast.dividend / ast.divisor;
  }
  const operands = ast.operands.map((operand) => operand.value);
  const result = ast.operator === "+"
    ? operands.reduce((sum, operand) => sum + operand, 0)
    : ast.operator === "-"
      ? operands[0] - operands[1]
      : ast.operator === "×"
        ? operands[0] * operands[1]
        : operands[0] / operands[1];
  assert.equal(result, ast.result.value);
  return ast.unknown === "result" ? result : operands[ast.unknown.operandIndex];
}

function assertNormativeConstraint(question) {
  const values = integerOperands(question);
  const answer = exactIntegerValue(question.exactAnswer);
  assert.notEqual(answer, null);
  const [a, b, c] = values;
  const onesCarry = b === undefined ? false : a % 10 + (b % 10) >= 10;
  const additionRegroups = b === undefined ? 0 : Number(onesCarry) + Number(Math.floor(a / 10) + Math.floor(b / 10) + Number(onesCarry) >= 10);
  const subtractionRegroups = b === undefined ? 0 : Number(a % 10 < b % 10);
  const crossesDecade = (left, result) => Math.floor(left / 10) !== Math.floor(result / 10);

  switch (question.skillId) {
    case "G1-AS-01":
      assert.equal(question.promptAst.kind, "part-whole"); assert.ok(question.promptAst.total <= 5); assert.equal(question.difficultyFeatures.numberOfAddends, 2); assert.ok(["dot-parts", "number-bond", "equation"].includes(question.promptAst.representation)); assert.equal(question.difficultyFeatures.representation, question.promptAst.representation); assert.equal(question.difficultyFeatures.unknownKind, "missing_part"); assert.equal(question.orientation, "horizontal"); break;
    case "G1-AS-02":
      assert.equal(question.promptAst.kind, "part-whole"); assert.ok(question.promptAst.total <= 10); assert.equal(question.promptAst.maximumTotal, 10); assert.ok(["dot-parts", "number-bond", "equation"].includes(question.promptAst.representation)); assert.equal(question.difficultyFeatures.representation, question.promptAst.representation); assert.equal(question.difficultyFeatures.unknownKind, "missing_part"); assert.equal(question.orientation, "horizontal"); break;
    case "G1-AS-03": assert.ok(a >= 0 && a <= 9 && b >= 0 && b <= 9 && answer <= 10); break;
    case "G1-AS-04": assert.ok(a >= 0 && a <= 9 && b >= 0 && b <= 9 && answer >= 0); break;
    case "G1-AS-05": assert.ok(a <= 9 && b <= 9 && answer >= 11 && answer <= 18); break;
    case "G1-AS-06": assert.ok(a >= 10 && a <= 18 && b >= 0 && b <= 9 && answer >= 0); break;
    case "G1-AS-07": assert.ok(a >= 0 && a <= 20 && b >= 0 && b <= 20 && answer >= 0 && answer <= 20); break;
    case "G1-AS-08": assert.ok(a <= 9 && b <= 9 && c <= 9 && answer <= 20); assert.equal(values.length, 3); break;
    case "G1-AS-09": assert.ok(a >= 10 && a <= 99 && b <= 9); assert.equal(crossesDecade(a, answer), false); break;
    case "G1-AS-10": assert.ok(a >= 10 && a <= 99 && b >= 1 && b <= 9 && answer <= 100); assert.equal(crossesDecade(a, answer), true); break;
    case "G1-AS-11": assert.ok(a >= 10 && a <= 99 && b <= 9); assert.equal(crossesDecade(a, answer), false); break;
    case "G1-AS-12": assert.ok(a >= 10 && a <= 99 && b >= 1 && b <= 9 && answer >= 0); assert.equal(crossesDecade(a, answer), true); break;
    case "G1-AS-13": assert.ok(a >= 10 && a <= 99 && b >= 10 && b < 100 && b % 10 === 0 && answer >= 0 && answer <= 100); break;
    case "G1-AS-14": assert.ok(a >= 10 && b >= 10 && answer <= 100); assert.equal(additionRegroups, 0); break;
    case "G1-AS-15": assert.ok(a >= 10 && b >= 10 && answer <= 100); assert.equal(additionRegroups, 1); break;
    case "G1-AS-16": assert.ok(a >= b && b >= 10); assert.equal(subtractionRegroups, 0); break;
    case "G1-AS-17": assert.ok(a >= b && b >= 10); assert.equal(subtractionRegroups, 1); break;
    case "G1-AS-18":
      assert.equal(question.promptAst.kind, "equation"); assert.notEqual(question.promptAst.unknown, "result"); assert.ok(question.promptAst.result.value <= 20); break;
    case "G1-M-01":
    case "G1-M-02": assert.ok([a, b].includes(2) || [a, b].includes(5) || [a, b].includes(10)); assert.ok(a * b <= 40); break;
    case "G1-D-01":
    case "G1-D-02": assert.ok([2, 5, 10].includes(b)); assert.ok(a <= 40 && a % b === 0); break;
    case "G1-M-03": {
      const focusIndex = [2, 5, 10].includes(a) ? 0 : 1;
      const other = focusIndex === 0 ? b : a;
      assert.ok([2, 5, 10].includes(values[focusIndex]) && other >= 0 && other <= 10);
      break;
    }
    case "G1-D-03": assert.ok([2, 5, 10].includes(b) && answer >= 0 && answer <= 10 && a === b * answer); break;
    default: assert.fail(`Unhandled skill ${question.skillId}`);
  }
}

test("all 24 generators satisfy their normative constraints over 1,000 deterministic seeds each", () => {
  for (const skill of G1_SKILLS) {
    const observedCoverage = new Set();
    const observedBands = new Set();
    const observedInstances = new Set();
    const semanticFingerprintsByBand = new Map([1, 2, 3, 4].map((band) => [band, new Set()]));
    for (let index = 0; index < 1_000; index += 1) {
      const options = { skillId: skill.id, seed: `property:${skill.id}:${index}` };
      const question = generateG1Question(options);
      assert.deepEqual(generateG1Question(options), question, `${skill.id} regenerates deterministically`);
      assert.deepEqual(JSON.parse(JSON.stringify(question)), question, `${skill.id} is JSON-safe`);
      assert.equal(question.skillId, skill.id);
      assert.equal(question.curriculumVersion, 1);
      assert.equal(question.generatorVersion, G1_GENERATOR_VERSION);
      assert.ok(question.renderedPrompt.length > 0);
      assert.equal(question.exactAnswer.kind, "integer");
      assert.equal(question.exactAnswer.value, recomputeFromAst(question));
      assert.equal(evaluateG1Answer(question, question.exactAnswer.value).correct, true);
      assert.equal(evaluateG1Answer(question, question.exactAnswer.value + 101).correct, false);
      assert.equal(question.difficultyFeatures.factKey.length > 0, true);
      assertNormativeConstraint(question);
      assert.equal(question.misconceptionDistractors.length, 3);
      assert.equal(new Set(question.misconceptionDistractors.map((entry) => entry.value.value)).size, 3);
      for (const distractor of question.misconceptionDistractors) {
        assert.notEqual(distractor.value.value, question.exactAnswer.value);
        assert.ok(skill.misconceptionTags.includes(distractor.misconceptionTag));
      }
      question.coverageTags.forEach((tag) => observedCoverage.add(tag));
      observedBands.add(question.difficultyBand);
      observedInstances.add(JSON.stringify(question.promptAst));
      semanticFingerprintsByBand.get(question.difficultyBand).add(
        g1QuestionSemanticFingerprint(question),
      );
    }
    assert.deepEqual([...observedBands].sort(), [1, 2, 3, 4], `${skill.id} exercises every band`);
    for (const key of requiredCoverageKeysForSkill(skill.id)) assert.ok(observedCoverage.has(key), `${skill.id} covers ${key}`);
    assert.ok(observedInstances.size >= 5, `${skill.id} has substantial finite-family diversity`);
    for (let leftBand = 1; leftBand <= 4; leftBand += 1) {
      for (let rightBand = leftBand + 1; rightBand <= 4; rightBand += 1) {
        const right = semanticFingerprintsByBand.get(rightBand);
        const overlap = [...semanticFingerprintsByBand.get(leftBand)].filter((fingerprint) => right.has(fingerprint));
        assert.deepEqual(overlap, [], `${skill.id} has intrinsic, cross-band-disjoint difficulty`);
      }
    }
  }
});

test("every skill exposes 12 stable canonical fixtures across easy, ordinary, and hard/adversarial bands", () => {
  const fixtureNames = new Set();
  for (const skill of G1_SKILLS) {
    const fixtures = G1_CANONICAL_FIXTURE_SEEDS[skill.id];
    assert.equal(fixtures.length, 12);
    assert.deepEqual(
      fixtures.reduce((counts, fixture) => {
        counts[fixture.difficultyBand] = (counts[fixture.difficultyBand] ?? 0) + 1;
        return counts;
      }, {}),
      { 1: 4, 2: 4, 3: 2, 4: 2 },
    );
    const fingerprintsByBand = new Map([1, 2, 3, 4].map((band) => [band, new Set()]));
    for (const fixture of fixtures) {
      assert.equal(fixture.skillId, skill.id);
      assert.equal(fixtureNames.has(fixture.name), false, fixture.name);
      fixtureNames.add(fixture.name);
      const options = {
        skillId: fixture.skillId,
        seed: fixture.seed,
        difficultyBand: fixture.difficultyBand,
        orientation: "horizontal",
      };
      const question = generateG1Question(options);
      assert.deepEqual(generateG1Question(options), question);
      assert.equal(question.difficultyBand, fixture.difficultyBand);
      assert.equal(g1QuestionSemanticFingerprint(question), fixture.expectedFingerprint);
      fingerprintsByBand.get(fixture.difficultyBand).add(fixture.expectedFingerprint);
      assert.equal(question.exactAnswer.value, recomputeFromAst(question));
      assertNormativeConstraint(question);
    }
    assert.equal(fingerprintsByBand.get(1).size, 4);
    assert.equal(fingerprintsByBand.get(2).size, 4);
    assert.equal(fingerprintsByBand.get(3).size, 2);
    assert.equal(fingerprintsByBand.get(4).size, 2);
    assert.equal(new Set([...fingerprintsByBand.get(3), ...fingerprintsByBand.get(4)]).size, 4);
  }
  assert.equal(fixtureNames.size, 24 * 12);
});

test("applicable Grade 1 boundary fixtures are explicit and exact", () => {
  assert.deepEqual(G1_BOUNDARY_FIXTURE_SEEDS.map((fixture) => fixture.name), [
    "g1-boundary-9-plus-1",
    "g1-boundary-99-plus-1",
  ]);
  for (const fixture of G1_BOUNDARY_FIXTURE_SEEDS) {
    const question = generateG1Question({
      skillId: fixture.skillId,
      seed: fixture.seed,
      difficultyBand: fixture.difficultyBand,
      orientation: "horizontal",
    });
    assert.equal(question.promptAst.kind, "equation");
    assert.deepEqual(question.promptAst.operands.map((operand) => operand.value), fixture.expectedOperands);
    assert.equal(question.exactAnswer.value, fixture.expectedAnswer);
    assert.equal(question.exactAnswer.value, recomputeFromAst(question));
    assertNormativeConstraint(question);
  }
});

test("requested difficulty and presentation are stable and vertical equations omit an equals sign", () => {
  for (const skill of G1_SKILLS) {
    for (const band of [1, 2, 3, 4]) {
      const horizontal = generateG1Question({ skillId: skill.id, seed: `band:${skill.id}:${band}`, difficultyBand: band, orientation: "horizontal" });
      const vertical = generateG1Question({ skillId: skill.id, seed: `band:${skill.id}:${band}`, difficultyBand: band, orientation: "vertical" });
      assert.equal(horizontal.difficultyBand, band);
      assert.equal(horizontal.orientation, "horizontal");
      const supportsVertical =
        horizontal.promptAst.kind === "equation" &&
        horizontal.promptAst.unknown === "result" &&
        horizontal.promptAst.operands.length === 2;
      assert.equal(
        vertical.orientation,
        supportsVertical ? "vertical" : "horizontal",
      );
      assert.equal(
        g1QuestionSemanticFingerprint(horizontal),
        g1QuestionSemanticFingerprint(vertical),
      );
      if (vertical.promptAst.kind === "equation" && vertical.promptAst.unknown === "result" && vertical.promptAst.operands.length === 2) {
        assert.doesNotMatch(vertical.renderedPrompt, /=/);
        assert.match(vertical.renderedPrompt, /\n/);
      }
      if (skill.id === "G1-AS-18") {
        assert.equal(vertical.promptAst.kind, "equation");
        assert.notEqual(vertical.promptAst.unknown, "result");
        assert.equal(vertical.promptAst.orientation, "horizontal");
        assert.doesNotMatch(vertical.renderedPrompt, /\n/);
      }
    }
  }
  assert.throws(() => generateG1Question({ skillId: "G1-AS-03", seed: "bad", difficultyBand: 9 }), /Difficulty band/);
  assert.throws(() => generateG1Question({ skillId: "G1-AS-03", seed: "" }), /non-empty seed/);
  assert.throws(() => generateG1Question({ skillId: "G2-AS-01", seed: "bad" }), /Unknown Grade 1 skill/);
});

test("part-whole generators expose all genuine structural representations", () => {
  for (const skillId of ["G1-AS-01", "G1-AS-02"]) {
    const observed = new Set();
    for (let index = 0; index < 100; index += 1) {
      const question = generateG1Question({
        skillId,
        seed: `part-whole-representation:${skillId}:${index}`,
        orientation: index % 2 ? "vertical" : "horizontal",
      });
      assert.equal(question.promptAst.kind, "part-whole");
      observed.add(question.promptAst.representation);
      assert.equal(question.orientation, "horizontal");
      assert.equal(
        question.difficultyFeatures.surfaceForm,
        `part-whole:${question.promptAst.representation}`,
      );
    }
    assert.deepEqual([...observed].sort(), ["dot-parts", "equation", "number-bond"]);
  }
});

test("fact universes are finite, explicit, balanced, and do not smuggle -10 into Grade 1 digit subtraction", () => {
  const expectedSizes = {
    "G1-AS-03": 64,
    "G1-AS-04": 55,
    "G1-M-02": 23,
    "G1-D-02": 25,
    "G1-M-03": 30,
    "G1-D-03": 33,
  };
  for (const skill of G1_SKILLS) {
    const universe = factUniverseForSkill(skill.id);
    if (skill.masteryProfile === "FACT") {
      assert.equal(universe.length, expectedSizes[skill.id]);
      assert.equal(new Set(universe).size, universe.length);
    } else {
      assert.deepEqual(universe, []);
    }
  }
  for (let index = 0; index < 2_000; index += 1) {
    const question = generateG1Question({ skillId: "G1-AS-06", seed: `no-minus-ten:${index}` });
    assert.ok(question.promptAst.kind === "equation");
    assert.ok(question.promptAst.operands[1].value <= 9);
  }
  assert.equal(factKeyForQuestion(generateG1Question({ skillId: "G1-AS-03", seed: "fact-key" })).startsWith("+:"), true);
  assert.equal(factKeyForQuestion(generateG1Question({ skillId: "G1-M-01", seed: "model" })), null);
});

test("multiplication deliberately presents commuted orientations without double-counting mastery facts", () => {
  for (const skillId of ["G1-M-02", "G1-M-03"]) {
    const presentations = new Map();
    const observedCoverage = new Set();
    for (let index = 0; index < 5_000; index += 1) {
      const question = generateG1Question({ skillId, seed: `commuted:${skillId}:${index}` });
      const operands = question.promptAst.operands.map((operand) => operand.value);
      presentations.set(operands.join(":"), question);
      question.coverageTags.forEach((tag) => observedCoverage.add(tag));
    }
    const left = presentations.get("2:9");
    const right = presentations.get("9:2");
    assert.ok(left);
    assert.ok(right);
    assert.equal(factKeyForQuestion(left), "×:2:9");
    assert.equal(factKeyForQuestion(right), "×:2:9");
    assert.ok(factUniverseForSkill(skillId).includes("×:2:9"));
    assert.equal(factUniverseForSkill(skillId).includes("×:9:2"), false);
    assert.ok(observedCoverage.has("focus_factor_left"));
    assert.ok(observedCoverage.has("focus_factor_right"));
  }
});

test("multiplication and division questions expose complete structural difficulty metadata", () => {
  for (const skillId of ["G1-M-01", "G1-M-02", "G1-M-03"]) {
    for (let index = 0; index < 100; index += 1) {
      const question = generateG1Question({ skillId, seed: `multiply-features:${skillId}:${index}` });
      const [left, right] = question.operands.map((operand) => operand.value);
      const features = question.difficultyFeatures;
      assert.equal(features.leftFactorDigitCount, String(left).length);
      assert.equal(features.rightFactorDigitCount, String(right).length);
      assert.equal(typeof features.factFamily, "string");
      assert.equal(features.carryCount, 0);
      assert.equal(features.carryPositions, "");
      assert.equal(features.zeroFactorCount, [left, right].filter((value) => value === 0).length);
      assert.equal(features.containsZeroFactor, left === 0 || right === 0);
      assert.equal(typeof features.internalZeroCount, "number");
      assert.equal(typeof features.trailingZeroCount, "number");
      assert.equal(features.nonzeroPartialProductCount, question.exactAnswer.value === 0 ? 0 : 1);
      assert.equal(features.productDigitCount, String(question.exactAnswer.value).length);
      assert.equal(typeof features.shortcutAvailable, "boolean");
      assert.equal(typeof features.shortcutKind, "string");
      assert.equal(features.distributiveShortcutAvailable, false);
      assert.equal(features.cancellationAvailable, false);
      assert.equal(features.requestedAnswerRepresentation, "integer");
    }
  }
  for (const skillId of ["G1-D-01", "G1-D-02", "G1-D-03"]) {
    for (let index = 0; index < 100; index += 1) {
      const question = generateG1Question({ skillId, seed: `divide-features:${skillId}:${index}` });
      const [dividend, divisor] = question.operands.map((operand) => operand.value);
      const quotient = question.exactAnswer.value;
      const features = question.difficultyFeatures;
      assert.equal(features.dividendDigitCount, String(dividend).length);
      assert.equal(features.divisorDigitCount, String(divisor).length);
      assert.equal(features.quotientDigitCount, String(quotient).length);
      assert.equal(features.divisionExact, true);
      assert.equal(features.remainderValue, 0);
      assert.equal(features.remainderSize, "zero");
      assert.equal(features.quotientContainsZero, String(quotient).includes("0"));
      assert.equal(features.leadingQuotientEstimate, quotient);
      assert.equal(features.quotientEstimateRequired, false);
      assert.equal(features.quotientEstimateCorrections, 0);
      assert.equal(features.requestedAnswerRepresentation, "integer");
    }
  }
});

test("integer-only Grade 1 evaluation rejects equivalent but undeclared answer forms", () => {
  const question = generateG1Question({ skillId: "G1-AS-03", seed: "answer-forms", orientation: "horizontal" });
  const answer = question.exactAnswer.value;
  assert.deepEqual(evaluateG1Answer(question, String(answer)), {
    correct: true,
    normalizedSubmission: { kind: "integer", value: answer },
    acceptedForm: "integer",
    reason: "correct",
  });
  const equivalentFraction = evaluateG1Answer(question, `${answer}/1`);
  assert.equal(equivalentFraction.correct, false);
  assert.equal(equivalentFraction.reason, "answer_form_not_accepted");
  assert.equal(evaluateG1Answer(question, "not a number").reason, "unreadable");
  assert.equal(evaluateG1Answer(question, `0${answer}`).reason, "unreadable");
});

test("the dedicated full-corpus verifier reports complete structural coverage", () => {
  assert.deepEqual(verifyG1GeneratorCorpus(1_000), {
    generated: 24_000,
    skills: 24,
    coverageMissing: [],
  });
});
