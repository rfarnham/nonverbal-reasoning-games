import assert from "node:assert/strict";
import test from "node:test";
import {
  DIFFICULTIES, FOLD_DIRECTIONS, FOLD_SENSES, GENERATOR_MAX_ATTEMPTS, ROUNDS, TUTORIAL,
  answerKey, buildAuthoredFoldedItemsRound, buildAuthoredFoldedItemsRounds, buildRounds,
  describeItem, foldPaper, foldSteps, foldAxis, foldInstructionKey, generateInfiniteRound,
  initialPaper, isMovingCell, itemSetKey, legalFolds,
  patternDifference, roundFingerprint, targetStack, validateRound, visualItemKey, visualAnswerKey,
  describeAnswer, describeOrientedItem, UPRIGHT, ITEM_ORIENTATIONS,
} from "../app/games/folded-items/game-engine.ts";
import { CAMPAIGN_ROUND_SPECS } from "../app/games/folded-items/campaign-data.ts";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state / 4_294_967_296; };
}
function source(rows, cols) {
  return { rows, cols, items: Array.from({ length: rows * cols }, (_, id) => ({ id, kind: "number", label: String(id + 1) })) };
}
const fold = (direction, sense, crease) => ({ direction, sense, crease });
function assertValid(round, label) {
  assert.deepEqual(validateRound(round), [], `${label}: validator`);
  const stack = targetStack(round);
  const expected = round.answerMode === "ordered" ? stack : stack.filter((id) => id !== round.targetId);
  assert.equal(answerKey(round.correctItems, round.answerMode), answerKey(expected, round.answerMode), `${label}: physical answer`);
  assert.equal(round.options.length, 4);
  const orientations = expected.map((id) => round.orientationMatters ? round.foldSteps.at(-1).after.orientations[id] : UPRIGHT);
  assert.deepEqual(round.correctOrientations, orientations);
  const keys = round.options.map((option, index) => visualAnswerKey(round, option, round.optionOrientations[index]));
  assert.equal(new Set(keys).size, 4);
  assert.deepEqual(keys.flatMap((key, index) => key === visualAnswerKey(round, expected, orientations) ? [index] : []), [round.correctIndex], `${label}: one exact visual answer`);
}
const GENERATED = Object.fromEntries(DIFFICULTIES.map((difficulty, difficultyIndex) => {
  const seen = new Set();
  // 400 independent deterministic seeds for each difficulty, with session-level deduplication.
  const rounds = Array.from({ length: 400 }, (_, index) => {
    const round = generateInfiniteRound(difficulty, seededRandom((0xf01d1000 + difficultyIndex * 10000) ^ Math.imul(index + 1, 2654435761)), seen);
    seen.add(roundFingerprint(round)); return round;
  });
  return [difficulty, rounds];
}));

test("one-fold Example teaches the same pair for either sense without claiming the partner is underneath", () => {
  assert.equal(TUTORIAL.answerMode, "group");
  assert.deepEqual(TUTORIAL.source.items.map(({ label }) => label), "ABCDEFGH".split(""));
  assert.deepEqual(targetStack(TUTORIAL).map((id) => describeItem(TUTORIAL, id)), ["F", "B"]);
  assert.equal(describeItem(TUTORIAL, TUTORIAL.targetId), "B");
  assert.deepEqual(TUTORIAL.correctItems.map((id) => describeItem(TUTORIAL, id)), ["F"]);
  const under = { ...TUTORIAL, folds: [fold("up", "under", 1)] };
  assert.deepEqual(targetStack(under), [...targetStack(TUTORIAL)].reverse());
  assertValid(TUTORIAL, "Example");
});

test("over and under reverse the moving layers, then place the whole flap above or below", () => {
  const original = initialPaper(source(4, 4));
  const first = foldPaper(original, fold("up", "under", 2));
  assert.deepEqual(first.stacks[0], [0, 12]);
  assert.deepEqual(foldPaper(original, fold("up", "over", 2)).stacks[0], [12, 0]);
  assert.deepEqual(foldPaper(original, fold("down", "under", 2)).stacks[0], [8, 4]);
  assert.deepEqual(foldPaper(original, fold("left", "under", 2)).stacks[0], [0, 3]);
  assert.deepEqual(foldPaper(original, fold("right", "under", 2)).stacks[0], [2, 1]);
  assert.deepEqual(foldPaper(first, fold("left", "under", 2)).stacks[0], [0, 12, 15, 3]);
  assert.deepEqual(foldPaper(first, fold("left", "over", 2)).stacks[0], [15, 3, 0, 12]);
  assert.deepEqual(foldPaper(first, fold("up", "over", 1)).stacks[0], [8, 4, 0, 12]);
  assert.deepEqual(original, initialPaper(source(4, 4)), "pure folds never mutate paper");
});

test("5×5 folds use real between-cell creases and preserve uncovered cells and overhanging flaps", () => {
  const original = initialPaper(source(5, 5));
  const narrow = foldPaper(original, fold("left", "over", 4));
  assert.deepEqual(narrow.stacks.slice(0, 4), [[0], [1], [2], [4, 3]]);
  assert.equal(narrow.rows, 5); assert.equal(narrow.cols, 4);
  const twoOntoThree = foldPaper(original, fold("up", "under", 3));
  assert.deepEqual(twoOntoThree.stacks.slice(0, 6), [[0], [1], [2], [3], [4], [5, 20]]);
  const overhang = foldPaper(original, fold("right", "over", 4));
  assert.deepEqual(overhang.stacks.slice(0, 4), [[3, 4], [2], [1], [0]]);
  assert.deepEqual(overhang.stacks.flat().sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
  assert.throws(() => foldPaper(original, fold("up", "under", 2.5)), /Cannot fold/);
  assert.throws(() => foldPaper(original, fold("up", "under", 0)), /Cannot fold/);
  assert.throws(() => foldPaper(original, fold("up", "under", 5)), /Cannot fold/);
});

test("every legal two-fold program conserves all items, layer counts, dimensions and mark reflections", () => {
  for (const dimension of [2, 3, 4, 5]) {
    const paper = initialPaper(source(dimension, dimension));
    assert.equal(legalFolds(paper).length, 8 * (dimension - 1));
    for (const first of legalFolds(paper)) {
      const intermediate = foldPaper(paper, first);
      for (const second of legalFolds(intermediate)) {
        const result = foldPaper(intermediate, second);
        assert.deepEqual(result.stacks.flat().sort((a, b) => a - b), paper.stacks.flat());
        assert.equal(result.stacks.length, result.rows * result.cols);
        assert.ok(result.stacks.every((stack) => stack.length > 0));
        for (const [cell, stack] of intermediate.stacks.entries()) for (const id of stack) {
          const moving = isMovingCell(Math.floor(cell / intermediate.cols), cell % intermediate.cols, second);
          assert.deepEqual(result.orientations[id], {
            flipX: intermediate.orientations[id].flipX !== (moving && foldAxis(second.direction) === "cols"),
            flipY: intermediate.orientations[id].flipY !== (moving && foldAxis(second.direction) === "rows"),
          });
        }
      }
    }
  }
});

test("Campaign has 48 deterministic authored questions, balanced irregular answers and freely alternating styles", () => {
  assert.equal(ROUNDS.length, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);
  for (const difficulty of DIFFICULTIES) {
    const rounds = ROUNDS.filter((round) => round.difficulty === difficulty);
    assert.equal(rounds.length, 12);
    assert.deepEqual([0, 1, 2, 3].map((index) => rounds.filter(({ correctIndex }) => correctIndex === index).length), [3, 3, 3, 3]);
    assert.ok(rounds.every((round, index) => index === 0 || round.correctIndex !== rounds[index - 1].correctIndex));
    assert.equal(new Set([0, 4, 8].map((start) => rounds.slice(start, start + 4).map(({ correctIndex }) => correctIndex).join(","))).size, 3);
    assert.deepEqual(new Set(rounds.flatMap(({ folds }) => folds.map(({ direction }) => direction))), new Set(FOLD_DIRECTIONS));
    assert.deepEqual(["letter", "number", "shape"].map((kind) => rounds.filter(({ source }) => source.items[0].kind === kind).length), [4, 4, 4]);
    assert.ok(rounds.every((round, index) => index === 0 || round.source.items[0].kind !== rounds[index - 1].source.items[0].kind));
    rounds.forEach((round, index) => assertValid(round, `${difficulty} authored ${index + 1}`));
  }
  const originalRandom = Math.random;
  Math.random = () => { throw new Error("Authored inputs must not consult randomness."); };
  try { assert.deepEqual(buildRounds(), ROUNDS); } finally { Math.random = originalRandom; }
});

test("Starter groups, Junior orders, Expert expands to 5×5 and off-center flaps, Wizard tracks every mirror and flip", () => {
  for (const round of ROUNDS) {
    const starter = round.difficulty === "Easy", junior = round.difficulty === "Medium";
    assert.equal(round.source.items.length, starter ? 8 : junior ? 16 : 25);
    assert.equal(round.folds.length, starter ? 1 : 2);
    assert.equal(round.answerMode, starter ? "group" : "ordered");
    assert.equal(round.correctItems.length, starter ? 1 : 4);
    if (junior) assert.notEqual(foldAxis(round.folds[0].direction), foldAxis(round.folds[1].direction));
    if (!starter) {
      assert.ok(round.optionKinds.includes("opposite-sense"));
      assert.ok(round.optionKinds.includes("layer-not-reversed"), "all ordered rounds include the actual layer-reversal trap");
      assert.ok(round.options.some((option, index) => index !== round.correctIndex && itemSetKey(option) === itemSetKey(round.correctItems)), "some wrong answers have exactly the right items in the wrong order");
      assert.ok(round.options.some((option, index) => index !== round.correctIndex && patternDifference(option, round.correctItems, "ordered").total === 2), "a close local order mistake exists");
    }
    for (let i = 0; !round.orientationMatters && i < 4; i++) for (let j = 0; j < i; j++) assert.ok(patternDifference(round.options[i], round.options[j], round.answerMode).total >= (starter || junior ? 2 : 1));
    assert.equal(round.orientationMatters, round.difficulty === "Wizard");
    if (!round.orientationMatters) assert.ok(round.optionOrientations.flat().every(({ flipX, flipY }) => !flipX && !flipY));

  }
  for (const start of [0, 3, 6, 9]) assert.equal(new Set(ROUNDS.slice(start, start + 3).map(({ folds }) => folds[0].direction)).size, 1);
  const hard = ROUNDS.filter(({ difficulty }) => difficulty === "Hard");
  assert.ok(hard.slice(0, 6).every(({ folds }) => folds.every(({ crease }) => [2, 3].includes(crease))));
  assert.ok(hard.slice(6).every(({ folds }) => folds.some(({ crease }) => [1, 4].includes(crease))));
  const complexity = (difficulty) => ROUNDS.filter((round) => round.difficulty === difficulty).map(({ source, folds }) => [source.rows, source.cols, source.items[0].kind, folds]);
  assert.deepEqual(complexity("Hard"), complexity("Wizard"));
});

test("Wizard specifies both folds and has no hidden operation or inference-only evidence", () => {
  for (const round of [...ROUNDS, ...GENERATED.Wizard].filter(({ difficulty }) => difficulty === "Wizard")) {
    assert.equal(round.folds.length, 2);
    assert.equal(round.foldSteps.length, 2);
    assert.equal(Object.hasOwn(round, "hiddenFoldIndex"), false);
    assert.equal(Object.hasOwn(round, "overlapClue"), false);
    for (const [index, step] of round.foldSteps.entries()) {
      assert.deepEqual(step.instruction, round.folds[index]);
      assert.ok(legalFolds(step.before).some((instruction) => foldInstructionKey(instruction) === foldInstructionKey(step.instruction)));
      assert.deepEqual(foldPaper(step.before, step.instruction), step.after);
    }
    const fingerprint = JSON.parse(roundFingerprint(round));
    assert.equal(Object.hasOwn(fingerprint, "hidden"), false);
    assert.equal(Object.hasOwn(fingerprint, "evidence"), false);
  }
});

test("shape identity uses large outline/mark combinations and never depends on color or petal counting", () => {
  for (const round of [...ROUNDS, ...GENERATED.Hard].filter(({ source }) => source.items[0].kind === "shape")) {
    assert.equal(new Set(round.source.items.map(({ shape }) => `${shape.outline}:${shape.mark}`)).size, round.source.items.length);
    assert.ok(round.source.items.every(({ shape, label }) => label === (shape.mark === "none" ? `plain ${shape.outline}` : `${shape.outline} with ${shape.mark}`)));
  }
  const round = ROUNDS.find(({ source }) => source.items[0].kind === "shape");
  const corrupted = { ...round, source: { ...round.source, items: round.source.items.map((item, index) => index === 1 ? { ...item, shape: round.source.items[0].shape } : item) } };
  assert.ok(validateRound(corrupted).some((error) => error.includes("distinct identities and appearances")));
});

test("1,600 seeded Infinite questions are unique, exact, ordered, and cover the taught directions/senses/styles", () => {
  for (const difficulty of DIFFICULTIES) {
    const rounds = GENERATED[difficulty];
    assert.equal(new Set(rounds.map(roundFingerprint)).size, 400);
    assert.deepEqual(new Set(rounds.flatMap(({ folds }) => folds.map(({ direction }) => direction))), new Set(FOLD_DIRECTIONS));
    assert.deepEqual(new Set(rounds.flatMap(({ folds }) => folds.map(({ sense }) => sense))), new Set(difficulty === "Easy" ? ["over"] : FOLD_SENSES));
    assert.deepEqual(new Set(rounds.map(({ source }) => source.items[0].kind)), new Set(["letter", "number", "shape"]));
    rounds.forEach((round, index) => assertValid(round, `${difficulty} Infinite ${index + 1}`));
    assert.deepEqual(generateInfiniteRound(difficulty, seededRandom(731)), generateInfiniteRound(difficulty, seededRandom(731)));
  }
});

test("fingerprints normalize choice order and arbitrary IDs but preserve physically different stack order", () => {
  const original = ROUNDS[12];
  assert.equal(roundFingerprint({ ...original, options: [...original.options].reverse(), correctIndex: 3 - original.correctIndex }), roundFingerprint(original));
  const newSource = { ...original.source, items: original.source.items.map((item) => ({ ...item, id: item.id + 100 })) };
  const relabeled = { ...original, source: newSource, targetId: original.targetId + 100, foldSteps: foldSteps(newSource, original.folds), correctItems: original.correctItems.map((id) => id + 100), options: original.options.map((option) => option.map((id) => id + 100)) };
  assert.equal(roundFingerprint(original), roundFingerprint(relabeled));
  const changed = { ...original, folds: original.folds.map((fold, index) => index === 1 ? { ...fold, sense: "under" } : fold) };
  changed.foldSteps = foldSteps(changed.source, changed.folds);
  assert.notEqual(roundFingerprint(changed), roundFingerprint(original));
  assert.notEqual(answerKey(original.correctItems), answerKey([...original.correctItems].reverse()));
});

test("validator rejects false calculations, reordered truth, duplicate options, fake traps, and invalid level constraints", () => {
  const original = ROUNDS[24];
  assert.ok(validateRound({ ...original, options: [original.correctItems, original.correctItems, original.options[2], original.options[3]] }).some((error) => error.includes("distinct")));
  assert.ok(validateRound({ ...original, correctItems: [...original.correctItems].reverse() }).some((error) => error.includes("calculated")));
  assert.ok(validateRound({ ...original, foldSteps: [] }).some((error) => error.includes("stages")));
  assert.ok(validateRound({ ...original, difficulty: "Medium" }).some((error) => error.includes("4×4")));
  assert.ok(validateRound({ ...original, optionKinds: original.optionKinds.map((kind) => kind === "opposite-sense" ? "wrong-axis" : kind) }).some((error) => error.includes("misconception")));
  const junior = ROUNDS[12];
  assert.ok(validateRound({ ...junior, folds: [junior.folds[0], { ...junior.folds[1], direction: "up", crease: 1 }] }).some((error) => error.includes("perpendicular")));
});

test("invalid and hostile randomness fail clearly and exhaustion stays bounded", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const value of [Number.NaN, -0.01, 1, Number.POSITIVE_INFINITY]) assert.throws(() => generateInfiniteRound(difficulty, () => value), /Random source must return/);
    for (const value of [0, 0.49999, 0.99999]) {
      const constant = generateInfiniteRound(difficulty, () => value);
      assertValid(constant, `${difficulty} constant ${value}`);
      let calls = 0;
      assert.throws(() => generateInfiniteRound(difficulty, () => { calls++; return value; }, new Set([roundFingerprint(constant)])), new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`));
      assert.ok(calls < GENERATOR_MAX_ATTEMPTS * 40, "bounded generator call count");
    }
    const constant = generateInfiniteRound(difficulty, () => 0);
    const seeded = seededRandom(44); let calls = 0;
    assertValid(generateInfiniteRound(difficulty, () => ++calls <= 40 ? 0 : seeded(), new Set([roundFingerprint(constant)])), `${difficulty} recovers from repeated output`);
  }
  assert.throws(() => generateInfiniteRound("Impossible", seededRandom(1)), /Unknown difficulty/);
  assert.throws(() => foldPaper(initialPaper(source(1, 1)), fold("up", "over", 1)), /Cannot fold/);
  assert.throws(() => buildAuthoredFoldedItemsRounds([CAMPAIGN_ROUND_SPECS[0], CAMPAIGN_ROUND_SPECS[0]]), /repeats content/);
  assert.throws(() => buildAuthoredFoldedItemsRound({ ...CAMPAIGN_ROUND_SPECS[0], itemOrder: [0, 0, 1, 2, 3, 4, 5, 6] }), /unique permutation/);
  assert.equal(new Set(legalFolds(initialPaper(source(5, 5))).map(foldInstructionKey)).size, 32);
});


test("unmarked glyph equivalences collapse invisible flips, M/W and 6/9 identity ambiguities", () => {
  const letter = (label) => ({ id: 0, kind: "letter", label });
  const number = (label) => ({ id: 0, kind: "number", label });
  const x = { flipX: true, flipY: false }, y = { flipX: false, flipY: true }, turn = { flipX: true, flipY: true };
  for (const label of "HIOXQ") for (const orientation of ITEM_ORIENTATIONS) assert.equal(visualItemKey(letter(label), orientation), visualItemKey(letter(label)), `${label} is symmetric`);
  for (const label of "AMTUVWY") assert.equal(visualItemKey(letter(label), x), visualItemKey(letter(label)), `${label} left-right mirror`);
  for (const label of "NSZ") assert.equal(visualItemKey(letter(label), turn), visualItemKey(letter(label)), `${label} half-turn`);
  assert.equal(visualItemKey(letter("G"), y), visualItemKey(letter("G")), "a subtle G notch is not an orientation trap");
  assert.equal(visualItemKey(letter("M"), y), visualItemKey(letter("W")));
  assert.equal(visualItemKey(letter("W"), turn), visualItemKey(letter("M")));
  assert.equal(visualItemKey(number("6"), turn), visualItemKey(number("9")));
  assert.equal(visualItemKey(number("9"), turn), visualItemKey(number("6")));
  assert.equal(visualItemKey(number("69"), turn), visualItemKey(number("69")), "turning a whole multi-digit label reverses character positions too");
  assert.notEqual(visualItemKey(number("12"), x), visualItemKey(number("12")));
  assert.notEqual(visualItemKey(letter("F"), x), visualItemKey(letter("F")));
  for (const outline of ["circle", "square", "diamond", "hexagon", "triangle"]) for (const mark of ["none", "dot", "plus", "bars", "cross"]) {
    const item = { id: 0, kind: "shape", shape: { outline, mark }, label: `${outline} ${mark}` };
    assert.equal(visualItemKey(item, x), visualItemKey(item));
    assert.equal(visualItemKey(item, turn), visualItemKey(item, y));
    assert.equal(visualItemKey(item, y) === visualItemKey(item), outline !== "triangle");
  }
});

test("every Wizard puzzle requires observable orientation and contains one honest orientation-only trap", () => {
  for (const round of [...ROUNDS.filter(({ difficulty }) => difficulty === "Wizard"), ...GENERATED.Wizard]) {
    assert.ok(round.correctItems.some((id, index) => visualItemKey(round.source.items.find((item) => item.id === id), round.correctOrientations[index]) !== visualItemKey(round.source.items.find((item) => item.id === id))));
    const trap = round.optionKinds.indexOf("orientation");
    assert.ok(trap >= 0);
    assert.deepEqual(round.options[trap], round.correctItems, "same identities and same layer order");
    const changed = round.correctItems.filter((id, index) => {
      const item = round.source.items.find((item) => item.id === id);
      return visualItemKey(item, round.correctOrientations[index]) !== visualItemKey(item, round.optionOrientations[trap][index]);
    });
    assert.equal(changed.length, 1, "exactly one visibly different glyph is the near-miss");
    assert.notEqual(describeAnswer(round, round.options[trap], round.optionOrientations[trap]), describeAnswer(round, round.correctItems, round.correctOrientations), "accessible descriptions distinguish the orientation trap");
    if (round.source.items[0].kind === "shape") assert.ok(changed.every((id) => round.source.items.find((item) => item.id === id).shape.outline === "triangle"));
  }
});

test("validator rejects orientation lies, invisible orientation traps and equivalent duplicate choices", () => {
  const round = ROUNDS.find(({ difficulty, source }) => difficulty === "Wizard" && source.items[0].kind === "shape");
  const trap = round.optionKinds.indexOf("orientation");
  const symmetric = round.correctItems.findIndex((id) => round.source.items.find((item) => item.id === id).shape.outline !== "triangle");
  assert.ok(symmetric >= 0);
  const invisible = round.correctOrientations.map((orientation, index) => index === symmetric ? { ...orientation, flipX: !orientation.flipX } : orientation);
  const corrupted = { ...round, optionOrientations: round.optionOrientations.map((orientations, index) => index === trap ? invisible : orientations) };
  assert.ok(validateRound(corrupted).some((error) => error.includes("distinct")));
  assert.ok(validateRound(corrupted).some((error) => error.includes("orientation-only")));
  assert.ok(validateRound({ ...round, correctOrientations: round.correctOrientations.map(() => UPRIGHT) }).some((error) => error.includes("calculated")));
  assert.ok(validateRound({ ...round, orientationMatters: false }).some((error) => error.includes("Only Wizard")));
  const upright = ROUNDS[12];
  const rotated = { ...upright, optionOrientations: upright.optionOrientations.map((orientations) => orientations.map(() => ({ flipX: true, flipY: true }))) };
  assert.ok(validateRound(rotated).some((error) => error.includes("stay upright")));
  const symmetricItem = { source: { rows: 1, cols: 1, items: [{ id: 0, kind: "letter", label: "O" }] } };
  assert.equal(describeOrientedItem(symmetricItem, 0, { flipX: true, flipY: true }), "O", "alt text never invents an invisible distinction");
});


test("orientation validation rejects malformed and sparse payloads without throwing", () => {
  for (const round of [ROUNDS[0], ROUNDS[12], ROUNDS[36]]) {
    for (const bad of [null, undefined, {}, [null], [undefined], Array(round.options[0].length), [], [{ flipX: "yes", flipY: false }]]) {
      const corrupted = { ...round, optionOrientations: round.optionOrientations.map((orientations, index) => index === 0 ? bad : orientations) };
      assert.ok(validateRound(corrupted).some((error) => error.includes("valid orientation")), `${round.difficulty}: ${String(bad)}`);
    }
    for (const bad of [null, undefined, {}, [], Array(4)]) assert.ok(validateRound({ ...round, optionOrientations: bad }).length > 0);
    for (const bad of [null, undefined, {}, [], Array(round.correctItems.length), [null]]) assert.ok(validateRound({ ...round, correctOrientations: bad }).length > 0);
  }
});
