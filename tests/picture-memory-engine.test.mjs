import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CAMPAIGN_BY_LEVEL,
  CAMPAIGN_ROUNDS,
  EXAMPLE,
  GENERATOR_MAX_ATTEMPTS,
  JOURNEY_EXTRA_ROUNDS,
  LEVELS,
  LEVEL_RULES,
  PuzzleGenerationError,
  evaluateSelection,
  generateInfiniteRound,
  roundFingerprint,
  seededRandom,
  structuralSibling,
  validateRound,
} from "../app/games/picture-memory/game-engine.ts";
import { PICTURE_FAMILIES, PICTURES, PICTURE_BY_ID } from "../app/games/picture-memory/picture-data.ts";

function possibleSelections(round) {
  const solutions = [];
  for (let mask = 0; mask < 2 ** round.options.length; mask += 1) {
    const selected = round.options.filter((_, index) => mask & (1 << index));
    if (evaluateSelection(round, selected).correct) solutions.push(selected);
  }
  return solutions;
}

function assertDifficulty(round) {
  assert.equal(validateRound(round), true, round.id);
  const rules = LEVEL_RULES[round.difficulty];
  assert.equal(round.study.length, rules.studyCount);
  assert.equal(round.options.length, rules.optionCount);
  assert.equal(new Set(round.options).size, rules.optionCount);
  assert.equal(new Set(round.study).size, rules.studyCount);
  assert.ok(round.study.every((picture) => round.options.includes(picture)));
  if (rules.includeStructuralVariants) {
    for (const picture of round.study) {
      assert.ok(round.options.includes(structuralSibling(picture)));
      assert.notEqual(PICTURE_BY_ID[picture].detail, PICTURE_BY_ID[structuralSibling(picture)].detail);
    }
  } else {
    assert.equal(new Set(round.options.map((picture) => PICTURE_BY_ID[picture].family)).size, rules.optionCount);
    assert.ok(round.options.every((picture) => PICTURE_BY_ID[picture].variant === 1));
  }
}

test("the authored Campaign has 48 frozen, valid, globally distinct rounds", () => {
  assert.equal(CAMPAIGN_ROUNDS.length, 48);
  assert.equal(new Set(CAMPAIGN_ROUNDS.map(roundFingerprint)).size, 48);
  assert.ok(Object.isFrozen(CAMPAIGN_ROUNDS));
  for (const level of LEVELS) {
    const rounds = CAMPAIGN_BY_LEVEL[level];
    assert.equal(rounds.length, 12);
    assert.ok(Object.isFrozen(rounds));
    for (const round of rounds) {
      assertDifficulty(round);
      assert.ok(Object.isFrozen(round));
      assert.ok(Object.isFrozen(round.study));
      assert.ok(Object.isFrozen(round.options));
      assert.deepEqual(possibleSelections(round), [round.options.filter((id) => round.study.includes(id))]);
    }
  }
  assertDifficulty(EXAMPLE);
  assert.equal(possibleSelections(EXAMPLE).length, 1);
});

test("Starter's one-answer positions are balanced without adjacent repeats or a repeated four-choice cycle", () => {
  const indexes = CAMPAIGN_BY_LEVEL.Starter.map((round) => round.options.indexOf(round.study[0]));
  assert.deepEqual([0, 1, 2, 3].map((position) => indexes.filter((index) => index === position).length), [3, 3, 3, 3]);
  assert.ok(indexes.every((index, offset) => offset === 0 || index !== indexes[offset - 1]));
  assert.notDeepEqual(indexes.slice(0, 4), indexes.slice(4, 8));
  assert.notDeepEqual(indexes.slice(4, 8), indexes.slice(8, 12));
});

test("multiple-selection target positions remain evenly exposed across each authored bank", () => {
  for (const rounds of [CAMPAIGN_BY_LEVEL.Junior, CAMPAIGN_BY_LEVEL.Expert, CAMPAIGN_BY_LEVEL.Wizard, ...Object.values(JOURNEY_EXTRA_ROUNDS)]) {
    const counts = Array.from({ length: rounds[0].options.length }, (_, index) => rounds.filter((round) => round.study.includes(round.options[index])).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts));
    assert.equal(new Set(rounds.map((round) => round.options.map((picture, index) => round.study.includes(picture) ? index : "").filter((index) => index !== "").join(","))).size, 12);
  }
});

test("Journey owns 12 separate frozen rounds for each second board without changing Campaign", () => {
  assert.deepEqual(Object.keys(JOURNEY_EXTRA_ROUNDS), ["junior-2", "expert-2", "wizard-2"]);
  const all = [...CAMPAIGN_ROUNDS];
  for (const [level, difficulty] of [["junior-2", "Junior"], ["expert-2", "Expert"], ["wizard-2", "Wizard"]]) {
    const rounds = JOURNEY_EXTRA_ROUNDS[level];
    assert.equal(rounds.length, 12);
    assert.ok(Object.isFrozen(rounds));
    for (const round of rounds) {
      assert.equal(round.difficulty, difficulty);
      assertDifficulty(round);
      assert.equal(possibleSelections(round).length, 1);
    }
    all.push(...rounds);
  }
  assert.equal(all.length, 84);
  assert.equal(new Set(all.map((round) => round.id)).size, 84);
  assert.equal(new Set(all.map(roundFingerprint)).size, 84);
  assert.equal(CAMPAIGN_ROUNDS.length, 48);
});

test("Wizard keeps Expert density and structural alternatives and removes only the recall-count scaffold", () => {
  assert.deepEqual(LEVEL_RULES.Expert, { ...LEVEL_RULES.Wizard, showTargetCount: true });
  assert.equal(LEVEL_RULES.Wizard.showTargetCount, false);
  for (const level of ["Expert", "Wizard"]) {
    assert.ok(CAMPAIGN_BY_LEVEL[level].every((round) => round.study.length === 3 && round.options.length === 8));
  }
});

test("exact set recall ignores order and reports missing and extra objects separately", () => {
  const round = CAMPAIGN_BY_LEVEL.Expert[0];
  assert.deepEqual(evaluateSelection(round, [...round.study].reverse()), { correct: true, missed: [], extra: [] });
  const wrong = structuralSibling(round.study[0]);
  assert.deepEqual(evaluateSelection(round, [wrong, ...round.study.slice(1)]), { correct: false, missed: [round.study[0]], extra: [wrong] });
  assert.deepEqual(evaluateSelection(round, []), { correct: false, missed: [...round.study], extra: [] });
  assert.equal(evaluateSelection(round, [...round.study, round.study[0]]).correct, false);
  assert.equal(evaluateSelection(round, round.options).correct, false);
});

test("fingerprints ignore IDs, difficulty labels, study order, and choice order", () => {
  const round = CAMPAIGN_BY_LEVEL.Expert[0];
  assert.equal(roundFingerprint(round), roundFingerprint({ ...round, id: "other", difficulty: "Wizard", study: [...round.study].reverse(), options: [...round.options].reverse() }));
  const changed = { ...round, study: [structuralSibling(round.study[0]), ...round.study.slice(1)] };
  assert.notEqual(roundFingerprint(round), roundFingerprint(changed));
});

test("validation rejects missing targets, duplicate identities, style-only early alternatives, and missing advanced near-misses", () => {
  const early = CAMPAIGN_BY_LEVEL.Starter[0];
  const advanced = CAMPAIGN_BY_LEVEL.Expert[0];
  assert.equal(validateRound({ ...early, study: [] }), false);
  assert.equal(validateRound({ ...early, options: [...early.options.slice(0, -1), early.options[0]] }), false);
  assert.equal(validateRound({ ...early, study: ["missing-1"] }), false);
  assert.equal(validateRound({ ...early, study: [structuralSibling(early.study[0])], options: early.options.map((id) => id === early.study[0] ? structuralSibling(id) : id) }), false);
  assert.equal(validateRound({ ...advanced, options: advanced.options.map((id) => id === structuralSibling(advanced.study[0]) ? "apple-1" : id) }), false);
  assert.equal(validateRound({ ...advanced, difficulty: "unknown" }), false);
  assert.equal(validateRound({ ...advanced, id: "" }), false);
});

test("1,600 seeded generated puzzles are reproducible and have one exact answer", () => {
  for (const [offset, level] of LEVELS.entries()) {
    const targetFamilies = new Set();
    const variants = new Set();
    for (let seed = 0; seed < 400; seed += 1) {
      const actualSeed = 100_000 * offset + seed;
      const round = generateInfiniteRound(level, seededRandom(actualSeed));
      assert.deepEqual(round, generateInfiniteRound(level, seededRandom(actualSeed)));
      assertDifficulty(round);
      assert.equal(possibleSelections(round).length, 1);
      assert.ok(Object.isFrozen(round));
      for (const id of round.study) {
        targetFamilies.add(PICTURE_BY_ID[id].family);
        variants.add(PICTURE_BY_ID[id].variant);
      }
    }
    assert.equal(targetFamilies.size, PICTURE_FAMILIES.length);
    assert.equal(variants.size, LEVEL_RULES[level].includeStructuralVariants ? 2 : 1);
  }
});

test("the exclusion set prevents repeated visual content in long sessions", () => {
  for (const level of LEVELS) {
    const random = seededRandom(20260927);
    const seen = new Set();
    for (let index = 0; index < 400; index += 1) {
      const round = generateInfiniteRound(level, random, seen);
      const fingerprint = roundFingerprint(round);
      assert.equal(seen.has(fingerprint), false);
      seen.add(fingerprint);
    }
    assert.equal(seen.size, 400);
  }
});

test("hostile random sources fail clearly and repetition exhausts within a fixed bound", () => {
  for (const invalid of [NaN, Infinity, -Infinity, -0.01, 1, 2]) {
    assert.throws(() => generateInfiniteRound("Starter", () => invalid), PuzzleGenerationError);
  }
  for (const constant of [0, 0.5, 0.999999999]) {
    for (const level of LEVELS) {
      const first = generateInfiniteRound(level, () => constant);
      assertDifficulty(first);
      let calls = 0;
      assert.throws(() => generateInfiniteRound(level, () => { calls += 1; return constant; }, new Set([roundFingerprint(first)])), PuzzleGenerationError);
      assert.ok(calls <= GENERATOR_MAX_ATTEMPTS * 40, String(calls));
    }
  }
  assert.throws(() => generateInfiniteRound("invalid", seededRandom(1)), PuzzleGenerationError);
});

test("the bundled object vocabulary has paired visible structural descriptions, not color-only variants", () => {
  assert.equal(PICTURE_FAMILIES.length, 24);
  assert.equal(PICTURES.length, PICTURE_FAMILIES.length * 2);
  for (const family of PICTURE_FAMILIES) {
    const pair = PICTURES.filter((picture) => picture.family === family);
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map((picture) => picture.variant).sort(), [1, 2]);
    assert.notEqual(pair[0].detail, pair[1].detail);
    assert.ok(pair.every((picture) => picture.label.length > 0 && picture.detail.length > 0));
  }
});

test("authored picture banks are literal data without runtime generation", async () => {
  const source = await readFile(new URL("../app/games/picture-memory/authored-data.ts", import.meta.url), "utf8");
  assert.equal(/Math\.random|generateInfiniteRound|seededRandom/.test(source), false);
});
