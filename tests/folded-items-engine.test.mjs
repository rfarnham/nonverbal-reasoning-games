import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTIES,
  FOLD_DIRECTIONS,
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  TUTORIAL,
  buildAuthoredFoldedItemsRound,
  buildAuthoredFoldedItemsRounds,
  buildRounds,
  describeItem,
  foldPaper,
  foldSteps,
  generateInfiniteRound,
  initialPaper,
  itemSetKey,
  matchingFirstFolds,
  patternDifference,
  roundFingerprint,
  targetStack,
  validateRound,
} from "../app/games/folded-items/game-engine.ts";
import { CAMPAIGN_ROUND_SPECS } from "../app/games/folded-items/campaign-data.ts";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function assertValid(round, label) {
  assert.deepEqual(validateRound(round), [], `${label}: validator`);
  const stack = targetStack(round);
  assert.equal(stack[0], round.targetId, `${label}: visible target`);
  assert.equal(itemSetKey(round.correctItems), itemSetKey(stack.slice(1)), `${label}: actual layers`);
  assert.equal(round.options.length, 4);
  assert.equal(new Set(round.options.map(itemSetKey)).size, 4);
  assert.deepEqual(round.options.flatMap((option, index) => itemSetKey(option) === itemSetKey(stack.slice(1)) ? [index] : []), [round.correctIndex], `${label}: single exact answer`);
}

const GENERATED = Object.fromEntries(DIFFICULTIES.map((difficulty, index) => {
  const random = seededRandom(0xf01d1000 + index);
  const seen = new Set();
  const rounds = Array.from({ length: 400 }, () => {
    const round = generateInfiniteRound(difficulty, random, seen);
    seen.add(roundFingerprint(round));
    return round;
  });
  return [difficulty, rounds];
}));

test("the letter example reproduces both worksheet folds without creating holes", () => {
  assert.deepEqual(TUTORIAL.source.items.map(({ label }) => label), "ABCDEFGHIJKLMNOP".split(""));
  assert.deepEqual(TUTORIAL.foldSteps[0].after.stacks[0].map((id) => describeItem(TUTORIAL, id)), ["A", "M"]);
  assert.deepEqual(TUTORIAL.foldSteps[0].after.stacks[1].map((id) => describeItem(TUTORIAL, id)), ["B", "N"]);
  assert.equal(describeItem(TUTORIAL, TUTORIAL.targetId), "B");
  assert.deepEqual(targetStack(TUTORIAL).map((id) => describeItem(TUTORIAL, id)), ["B", "N", "O", "C"]);
  assert.deepEqual(TUTORIAL.correctItems.map((id) => describeItem(TUTORIAL, id)), ["C", "N", "O"]);
  assertValid(TUTORIAL, "solved example");
});

test("folding underneath preserves the kept top and reverses the entire moving stack", () => {
  const original = initialPaper(TUTORIAL.source);
  assert.deepEqual(foldPaper(original, "up").stacks[0], [0, 12]);
  assert.deepEqual(foldPaper(original, "down").stacks[0], [8, 4]);
  assert.deepEqual(foldPaper(original, "left").stacks[0], [0, 3]);
  assert.deepEqual(foldPaper(original, "right").stacks[0], [2, 1]);
  assert.deepEqual(foldPaper(foldPaper(original, "up"), "left").stacks[0], [0, 12, 15, 3]);
  assert.deepEqual(foldPaper(foldPaper(original, "up"), "up").stacks[0], [0, 12, 8, 4]);
  assert.deepEqual(foldPaper(foldPaper(original, "left"), "right").stacks[0], [1, 2, 3, 0]);
  assert.deepEqual(original, initialPaper(TUTORIAL.source), "folding never mutates the source");
});

test("all sixteen two-fold programs conserve every unique physical item", () => {
  for (const first of FOLD_DIRECTIONS) {
    for (const second of FOLD_DIRECTIONS) {
      const steps = foldSteps(TUTORIAL.source, [first, second]);
      const final = steps[1].after;
      assert.equal(final.rows * final.cols, 4);
      assert.deepEqual(final.stacks.flat().sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index));
      assert.ok(final.stacks.every((stack) => stack.length === 4));
      const sameAxis = (["up", "down"].includes(first)) === (["up", "down"].includes(second));
      for (const stack of final.stacks) {
        const coordinates = stack.map((id) => [id % 4, Math.floor(id / 4)]);
        if (sameAxis) {
          const preservedIndex = ["up", "down"].includes(first) ? 0 : 1;
          assert.equal(new Set(coordinates.map((point) => point[preservedIndex])).size, 1);
          assert.equal(new Set(coordinates.map((point) => point[1 - preservedIndex])).size, 4);
        } else {
          assert.equal(new Set(coordinates.map(([x]) => x)).size, 2);
          assert.equal(new Set(coordinates.map(([, y]) => y)).size, 2);
          assert.ok(coordinates.every(([x, y]) => coordinates.some(([otherX, otherY]) => otherX === 3 - x && otherY === 3 - y)));
        }
      }
    }
  }
});

test("Campaign is 48 deterministic authored questions with balanced irregular answer schedules", () => {
  assert.equal(ROUNDS.length, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);
  for (const difficulty of DIFFICULTIES) {
    const rounds = ROUNDS.filter((round) => round.difficulty === difficulty);
    assert.equal(rounds.length, 12);
    assert.deepEqual([0, 1, 2, 3].map((index) => rounds.filter(({ correctIndex }) => correctIndex === index).length), [3, 3, 3, 3]);
    assert.ok(rounds.every((round, index) => index === 0 || round.correctIndex !== rounds[index - 1].correctIndex));
    assert.equal(new Set([0, 4, 8].map((start) => rounds.slice(start, start + 4).map(({ correctIndex }) => correctIndex).join(","))).size, 3);
    assert.deepEqual(new Set(rounds.flatMap(({ folds }) => folds)), new Set(FOLD_DIRECTIONS));
    assert.deepEqual(new Set(rounds.map(({ source }) => source.items[0].kind)), new Set(difficulty === "Easy" ? ["letter", "number"] : ["letter", "number", "flower"]));
    rounds.forEach((round, index) => assertValid(round, `${difficulty} authored ${index + 1}`));
  }
  const originalRandom = Math.random;
  Math.random = () => { throw new Error("Authored inputs must not consult randomness."); };
  try { assert.deepEqual(buildRounds(), ROUNDS); } finally { Math.random = originalRandom; }
});

test("Starter teaches one fold, Junior composes axes, Expert adds shortened-axis folds, Wizard removes one cue", () => {
  for (const round of ROUNDS) {
    assert.equal(round.source.items.length, round.difficulty === "Easy" ? 8 : 16);
    assert.equal(round.folds.length, round.difficulty === "Easy" ? 1 : 2);
    assert.equal(round.correctItems.length, round.difficulty === "Easy" ? 1 : 3);
    if (round.difficulty === "Medium") {
      assert.notEqual(["up", "down"].includes(round.folds[0]), ["up", "down"].includes(round.folds[1]));
      for (let first = 0; first < 4; first += 1) for (let second = 0; second < first; second += 1) assert.ok(patternDifference(round.options[first], round.options[second]).total >= 4);
    }
    if (round.difficulty === "Hard" || round.difficulty === "Wizard") {
      assert.ok(round.options.every((option, index) => index === round.correctIndex || patternDifference(option, round.correctItems).total === 2));
      assert.equal(new Set(round.options.flatMap((option, index) => index === round.correctIndex ? [] : patternDifference(option, round.correctItems).missing)).size, 3, "advanced traps vary the missing component");
    }
    assert.equal(round.hiddenFoldIndex, round.difficulty === "Wizard" ? 0 : null);
  }
  const profile = (difficulty) => ROUNDS.filter((round) => round.difficulty === difficulty).map(({ source, folds }) => [source.items.length, source.items[0].kind, ["up", "down"].includes(folds[0]) === ["up", "down"].includes(folds[1])]);
  assert.deepEqual(profile("Hard"), profile("Wizard"));
});

test("Wizard overlap evidence proves one fold across the complete catalogue without naming a target partner", () => {
  for (const round of [...ROUNDS, ...GENERATED.Wizard].filter(({ difficulty }) => difficulty === "Wizard")) {
    assert.deepEqual(matchingFirstFolds(round), [round.folds[0]]);
    assert.notEqual(round.overlapClue.aboveId, round.targetId);
    assert.notEqual(round.overlapClue.belowId, round.targetId);
    assert.ok(!round.correctItems.includes(round.overlapClue.aboveId));
    assert.ok(!round.correctItems.includes(round.overlapClue.belowId));
    const wrongClue = { ...round, overlapClue: { aboveId: round.overlapClue.aboveId, belowId: round.overlapClue.aboveId } };
    assert.deepEqual(matchingFirstFolds(wrongClue), []);
    assert.ok(validateRound(wrongClue).some((error) => error.includes("exactly one legal first fold")));
    assert.deepEqual(matchingFirstFolds({ ...round, overlapClue: { aboveId: round.overlapClue.belowId, belowId: round.overlapClue.aboveId } }), [({ up: "down", down: "up", left: "right", right: "left" })[round.folds[0]]]);
  }
});

test("flower identities remain distinct without color and use exactly the shown geometric descriptions", () => {
  for (const round of [...ROUNDS, ...GENERATED.Hard].filter(({ source }) => source.items[0].kind === "flower")) {
    assert.equal(new Set(round.source.items.map(({ flower }) => `${flower.petals}:${flower.petalShape}:${flower.center}`)).size, round.source.items.length);
    assert.ok(round.source.items.every(({ flower, label }) => label === `${flower.petals} ${flower.petalShape} petals with a ${flower.center} center`));
  }
  const source = ROUNDS.find(({ source }) => source.items[0].kind === "flower");
  const corrupted = { ...source, source: { ...source.source, items: source.source.items.map((item, index) => index === 1 ? { ...item, flower: source.source.items[0].flower } : item) } };
  assert.ok(validateRound(corrupted).some((error) => error.includes("distinct identities and appearances")));
});

test("1,600 seeded Infinite questions are exact, nonrepeating, meaningful and cover every direction and style", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    assert.equal(new Set(rounds.map(roundFingerprint)).size, 400);
    assert.deepEqual(new Set(rounds.flatMap(({ folds }) => folds)), new Set(FOLD_DIRECTIONS));
    assert.deepEqual(new Set(rounds.map(({ source }) => source.items[0].kind)), new Set(difficulty === "Easy" ? ["letter", "number"] : ["letter", "number", "flower"]));
    rounds.forEach((round, index) => assertValid(round, `${difficulty} Infinite ${index + 1}`));
    assert.deepEqual(generateInfiniteRound(difficulty, seededRandom(731)), generateInfiniteRound(difficulty, seededRandom(731)));
  }
});

test("fingerprints normalize option order, arbitrary IDs and equivalent perpendicular fold order", () => {
  const source = TUTORIAL;
  assert.equal(roundFingerprint({ ...source, options: [...source.options].reverse(), optionKinds: [...source.optionKinds].reverse(), correctIndex: 3 - source.correctIndex }), roundFingerprint(source));
  const alternate = buildAuthoredFoldedItemsRound({ ...CAMPAIGN_ROUND_SPECS[12], folds: ["left", "up"] });
  assert.equal(roundFingerprint(source), roundFingerprint(alternate));
  const newSource = { ...source.source, items: source.source.items.map((item) => ({ ...item, id: item.id + 100 })) };
  const relabeled = { ...source, source: newSource, targetId: source.targetId + 100, foldSteps: foldSteps(newSource, source.folds), correctItems: source.correctItems.map((id) => id + 100), options: source.options.map((option) => option.map((id) => id + 100)) };
  assert.equal(roundFingerprint(source), roundFingerprint(relabeled));
});

test("the validator rejects duplicate answers, false stages, hidden targets, and invalid level constraints", () => {
  const source = ROUNDS[24];
  assert.ok(validateRound({ ...source, options: [source.correctItems, source.correctItems, source.options[2], source.options[3]] }).some((error) => error.includes("distinct")));
  assert.ok(validateRound({ ...source, correctItems: [0, 1, 2] }).some((error) => error.includes("calculated")));
  assert.ok(validateRound({ ...source, foldSteps: [] }).some((error) => error.includes("stages")));
  const underneathId = targetStack(source)[1];
  assert.ok(validateRound({ ...source, targetId: underneathId }).some((error) => error.includes("visible top")));
  assert.ok(validateRound({ ...source, difficulty: "Medium" }).some((error) => error.includes("differ clearly")), "Expert close traps must not leak into Junior");
  assert.ok(validateRound({ ...ROUNDS[28], difficulty: "Medium" }).some((error) => error.includes("perpendicular")), "Junior cannot add shortened-axis folds early");
});

test("invalid randomness fails clearly; repeated hostile output exhausts its bounded session search safely", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const value of [Number.NaN, -0.01, 1, Number.POSITIVE_INFINITY]) assert.throws(() => generateInfiniteRound(difficulty, () => value), /Random source must return/);
    const constant = generateInfiniteRound(difficulty, () => 0);
    assertValid(constant, `${difficulty} constant random is still a complete unique-label puzzle`);
    assert.throws(() => generateInfiniteRound(difficulty, () => 0, new Set([roundFingerprint(constant)])), new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`));
    let calls = 0;
    const seeded = seededRandom(44);
    const initiallyRepeated = () => { calls += 1; return calls <= 28 ? 0 : seeded(); };
    assertValid(generateInfiniteRound(difficulty, initiallyRepeated, new Set([roundFingerprint(constant)])), `${difficulty} recovers after rejected repetition`);
  }
  assert.throws(() => generateInfiniteRound("Impossible", seededRandom(1)), /Unknown difficulty/);
  assert.throws(() => foldPaper({ rows: 1, cols: 1, stacks: [[0]] }, "up"), /Cannot fold/);
  assert.throws(() => buildAuthoredFoldedItemsRounds([CAMPAIGN_ROUND_SPECS[0], CAMPAIGN_ROUND_SPECS[0]]), /repeats content/);
  assert.throws(() => buildAuthoredFoldedItemsRound({ ...CAMPAIGN_ROUND_SPECS[0], itemOrder: [0, 0, 1, 2, 3, 4, 5, 6] }), /unique permutation/);
});
