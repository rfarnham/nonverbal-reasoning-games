import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { incorrectFeedback } from "../app/games/folded-items/feedback.ts";
import { canOpenHistoricalReview } from "../app/games/folded-items/historical-review.ts";
import { ROUNDS, roundFingerprint, validateRound } from "../app/games/folded-items/game-engine.ts";
import { progressionAdapter } from "../app/games/folded-items/progression-adapter.ts";
import {
  campaignQuestionReferences, createFreshGeneratedQuestion,
  journeyQuestionReferences, resolveProgressionQuestion,
} from "../lib/progression/game-adapter.ts";

const pageSource = await readFile(new URL("../app/games/folded-items/page.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Run the actual runtime boundary with an injected generator. The engine tests
// validate generated puzzles; this verifies the UI recovers when it cannot get one.
function infiniteBoundary(generateInfiniteRound, authored = ROUNDS) {
  const functions = ["seededRandom", "safeInfiniteRound"].map((name) => {
    const declaration = pageAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `${name} remains a testable runtime boundary`);
    return declaration.getText(pageAst);
  });
  const compiled = ts.transpileModule(`${functions.join("\n")}\nsafeInfiniteRound;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(compiled, { generateInfiniteRound, ROUNDS: authored, roundFingerprint, Math });
}

test("historical review accepts only completed idle puzzles and does not mutate its input", () => {
  for (const isIdle of [false, true]) {
    for (const isSolved of [false, true]) {
      for (const isReviewOpen of [false, true]) {
        const state = Object.freeze({ isIdle, isSolved, isReviewOpen });
        assert.equal(canOpenHistoricalReview(state), isIdle && isSolved && !isReviewOpen);
        assert.deepEqual(state, { isIdle, isSolved, isReviewOpen });
      }
    }
  }
});

test("Infinite recovers from generator failure with deterministic attempts before an unused authored fallback", () => {
  let calls = 0;
  const randomSamples = [];
  const run = infiniteBoundary((_difficulty, random) => {
    calls += 1;
    randomSamples.push(random());
    throw new Error("bounded generator exhausted");
  });
  const starter = ROUNDS.filter(({ difficulty }) => difficulty === "Easy");
  const seen = new Set([roundFingerprint(starter[0])]);
  const next = run(7, "Easy", seen);
  assert.equal(calls, 65, "one random attempt plus 64 bounded deterministic attempts");
  assert.equal(next.round, starter[1]);
  assert.equal(next.ordinal, 7);
  assert.equal(next.id, `infinite-7-${roundFingerprint(starter[1])}`);
  assert.equal(seen.size, 2);
  assert.ok(seen.has(roundFingerprint(next.round)));
  assert.ok(randomSamples.every((value) => Number.isFinite(value) && value >= 0 && value < 1));
  assert.equal(new Set(randomSamples.slice(1)).size, 64, "fallback seeds explore different candidates");
});

test("Infinite recoveries keep the requested difficulty and report exhaustion without repeating content", () => {
  const run = infiniteBoundary(() => { throw new Error("no fresh candidate"); });
  for (const difficulty of ["Easy", "Medium", "Hard", "Wizard"]) {
    const level = ROUNDS.filter((round) => round.difficulty === difficulty);
    const seen = new Set(level.map(roundFingerprint));
    const before = [...seen];
    assert.equal(run(90, difficulty, seen), null);
    assert.deepEqual([...seen], before, "exhaustion leaves the session fingerprints unchanged");
  }
});

test("Infinite records exactly the generated puzzle that the session receives", () => {
  const generated = ROUNDS.find(({ difficulty }) => difficulty === "Medium");
  const seen = new Set();
  let calls = 0;
  const run = infiniteBoundary((difficulty, random, suppliedSeen) => {
    calls += 1;
    assert.equal(difficulty, "Medium");
    assert.equal(typeof random, "function");
    assert.equal(suppliedSeen, seen);
    return generated;
  });
  assert.equal(run(3, "Medium", seen).round, generated);
  assert.equal(calls, 1);
  assert.deepEqual([...seen], [roundFingerprint(generated)]);
});


test("wrong feedback teaches the kind of mistake without listing the solution", () => {
  const round = {
    ...ROUNDS[0], difficulty: "Medium", answerMode: "ordered",
    targetId: 1, correctItems: [1, 2, 3, 4],
    options: [[1, 2, 3, 4], [1, 3, 2, 4], [1, 2, 3, 5], [1, 2, 5, 4]],
  };
  const orderFeedback = incorrectFeedback(round, 1);
  const identityFeedback = incorrectFeedback(round, 2);
  assert.match(orderFeedback, /layer order/);
  assert.match(identityFeedback, /lands elsewhere/);
  assert.notEqual(orderFeedback, identityFeedback, "a reversal and a different item receive different teaching");
  for (const feedback of [orderFeedback, identityFeedback]) {
    assert.doesNotMatch(feedback, /\d|correct (?:answer|stack)|(?:over|under) fold|option/i);
  }
  const relabeled = {
    ...round,
    correctItems: round.correctItems.map(id => id + 100),
    options: round.options.map(option => option.map(id => id + 100)),
  };
  assert.equal(incorrectFeedback(relabeled, 1), orderFeedback);
  assert.equal(incorrectFeedback(relabeled, 2), identityFeedback);
  assert.match(incorrectFeedback({ ...round, answerMode: "group" }, 1), /different stack/);
  assert.doesNotThrow(() => incorrectFeedback(round, null));
});

test("Wizard feedback gives no answer-dependent information about order, items, or the hidden fold", () => {
  const wizard = { ...ROUNDS[0], difficulty: "Wizard", answerMode: "ordered" };
  const expected = incorrectFeedback(wizard, null);
  for (const optionIndex of [0, 1, 2, 3]) {
    assert.equal(incorrectFeedback(wizard, optionIndex), expected);
    assert.equal(incorrectFeedback({ ...wizard, correctItems: [101, 102, 103, 104] }, optionIndex), expected);
  }
  assert.doesNotMatch(expected, /left|right|\bup\b|\bdown\b|under|over|reverse|missing|extra|order|\d/i);
});

test("version-one Journey references recover to validated version-two content without reinterpreting the old generator", () => {
  for (const [currentRef, resolution] of [
    [campaignQuestionReferences(progressionAdapter, "junior")[0], "campaign-updated"],
    [journeyQuestionReferences(progressionAdapter, "expert-2")[0], "journey-updated"],
  ]) {
    const legacy = Object.freeze({ ...currentRef, contentVersion: "1", fingerprint: "legacy-unordered-paper" });
    const before = JSON.stringify(legacy);
    const resolved = resolveProgressionQuestion(progressionAdapter, legacy);
    assert.equal(resolved.resolution, resolution);
    assert.equal(resolved.migrated, true);
    assert.equal(resolved.ref.contentVersion, "2");
    assert.equal(resolved.ref.questionIndex, currentRef.questionIndex);
    assert.equal(resolved.round.answerMode, "ordered");
    assert.deepEqual(validateRound(resolved.round), []);
    assert.equal(resolveProgressionQuestion(progressionAdapter, resolved.ref).resolution, "current");
    assert.equal(JSON.stringify(legacy), before, "the saved reference is not mutated in place");
  }
  const generated = createFreshGeneratedQuestion(progressionAdapter, { level: "wizard", seedBase: "folded-items-legacy-test" });
  const legacy = Object.freeze({ ...generated.ref, generatorVersion: "1", fingerprint: "legacy-unordered-generated" });
  const recovered = resolveProgressionQuestion(progressionAdapter, legacy);
  assert.equal(recovered.resolution, "generated-fallback");
  assert.equal(recovered.ref.source, "campaign");
  assert.equal(recovered.ref.contentVersion, "2");
  assert.equal(recovered.round.difficulty, "Wizard");
  assert.deepEqual(validateRound(recovered.round), []);
  const next = resolveProgressionQuestion(progressionAdapter, legacy, { excludedFingerprints: new Set([recovered.fingerprint]) });
  assert.notEqual(next.fingerprint, recovered.fingerprint, "recovery respects already-used puzzle exclusions");
});
