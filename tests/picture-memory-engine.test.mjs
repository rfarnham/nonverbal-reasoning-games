import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CAMPAIGN_BY_LEVEL, CAMPAIGN_ROUNDS, EXAMPLE, GENERATOR_MAX_ATTEMPTS,
  JOURNEY_EXTRA_ROUNDS, LEVELS, LEVEL_RULES, PuzzleGenerationError,
  applyTrap, buildAuthoredRound, evaluateSelection, generateInfiniteRound,
  optionMisconception, roundFingerprint, seededRandom, structuralSibling,
  trapCounts, validateRound,
} from "../app/games/picture-memory/game-engine.ts";
import { AUTHORED_CAMPAIGN_DATA, AUTHORED_JOURNEY_DATA } from "../app/games/picture-memory/authored-data.ts";
import {
  PICTURE_FAMILIES, PICTURE_POSES, PICTURES, PICTURE_BY_ID, POSE_SAFE_FAMILIES,
  UPRIGHT_PICTURES, normalizePictureId, pictureBaseId, pictureHasDistinctPoseOrbit,
  picturePose, picturePoseOrbit, reflectionTrap, rotationTrap, withPicturePose,
} from "../app/games/picture-memory/picture-data.ts";

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
  assert.equal(new Set(round.options.map(normalizePictureId)).size, rules.optionCount);
  assert.equal(new Set(round.study.map(normalizePictureId)).size, rules.studyCount);
  assert.ok(round.study.every((picture) => round.options.includes(picture)));
  const studyFamilies = round.study.map((picture) => PICTURE_BY_ID[picture].family);
  assert.equal(new Set(studyFamilies).size, rules.studyFamilyCount);
  if (rules.includeStructuralVariants) {
    assert.ok(round.study.every(pictureHasDistinctPoseOrbit));
    assert.ok(round.study.some(id => picturePose(id).startsWith("turn-")), "At least one target is turned; upright selection is not a solution shortcut.");
    assert.ok(round.study.some(id => picturePose(id).startsWith("mirror-")), "At least one target is mirrored.");
    assert.ok(round.options.every(id => studyFamilies.includes(PICTURE_BY_ID[id].family)), "Every advanced alternative belongs to a studied object family.");
    assert.ok(round.options.every(id => !["unrelated", "ambiguous"].includes(optionMisconception(round, id))));
    assert.deepEqual(trapCounts(round), { structural: rules.structuralTraps, rotation: rules.rotationTraps, reflection: rules.reflectionTraps });
    if (round.difficulty === "Expert") {
      assert.ok(round.study.every(id => round.options.includes(structuralSibling(id))));
    } else {
      const pair = round.study.filter(id => studyFamilies.filter(family => family === PICTURE_BY_ID[id].family).length === 2);
      assert.equal(pair.length, 2);
      assert.notEqual(PICTURE_BY_ID[pair[0]].variant, PICTURE_BY_ID[pair[1]].variant);
      assert.notEqual(picturePose(pair[0]), picturePose(pair[1]));
      assert.deepEqual([...new Set(studyFamilies)].map(family => round.options.filter(id => PICTURE_BY_ID[id].family === family).length), [4, 4]);
    }
  } else {
    assert.equal(new Set(round.options.map(picture => PICTURE_BY_ID[picture].family)).size, rules.optionCount);
    assert.ok(round.options.every(picture => PICTURE_BY_ID[picture].variant === 1 && picturePose(picture) === "upright"));
  }
}

function allAuthoredRounds() { return [...CAMPAIGN_ROUNDS, ...Object.values(JOURNEY_EXTRA_ROUNDS).flat()]; }

test("the authored Campaign has 48 frozen, valid, globally distinct exact-appearance rounds", () => {
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
      assert.deepEqual(possibleSelections(round), [round.options.filter(id => round.study.includes(id))]);
    }
  }
  assertDifficulty(EXAMPLE);
  assert.equal(possibleSelections(EXAMPLE).length, 1);
});

test("Starter keeps its original balanced one-answer sequence without adjacent repeats or a repeated cycle", () => {
  const indexes = CAMPAIGN_BY_LEVEL.Starter.map(round => round.options.indexOf(round.study[0]));
  assert.deepEqual(indexes, [2, 0, 3, 1, 0, 2, 1, 3, 2, 3, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map(position => indexes.filter(index => index === position).length), [3, 3, 3, 3]);
  assert.ok(indexes.every((index, offset) => offset === 0 || index !== indexes[offset - 1]));
  assert.notDeepEqual(indexes.slice(0, 4), indexes.slice(4, 8));
  assert.notDeepEqual(indexes.slice(4, 8), indexes.slice(8, 12));
});

test("multiple-selection target positions remain evenly exposed across every authored bank", () => {
  for (const rounds of [CAMPAIGN_BY_LEVEL.Junior, CAMPAIGN_BY_LEVEL.Expert, CAMPAIGN_BY_LEVEL.Wizard, ...Object.values(JOURNEY_EXTRA_ROUNDS)]) {
    const counts = Array.from({ length: rounds[0].options.length }, (_, index) => rounds.filter(round => round.study.includes(round.options[index])).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts));
    assert.equal(new Set(rounds.map(round => round.options.flatMap((picture, index) => round.study.includes(picture) ? [index] : []).join(","))).size, 12);
  }
});

test("Journey owns three separate frozen 12-round banks without expanding Campaign", () => {
  assert.deepEqual(Object.keys(JOURNEY_EXTRA_ROUNDS), ["junior-2", "expert-2", "wizard-2"]);
  for (const [level, difficulty] of [["junior-2", "Junior"], ["expert-2", "Expert"], ["wizard-2", "Wizard"]]) {
    const rounds = JOURNEY_EXTRA_ROUNDS[level];
    assert.equal(rounds.length, 12);
    assert.ok(Object.isFrozen(rounds));
    for (const round of rounds) {
      assert.equal(round.difficulty, difficulty);
      assertDifficulty(round);
      assert.equal(possibleSelections(round).length, 1);
    }
  }
  const all = allAuthoredRounds();
  assert.equal(all.length, 84);
  assert.equal(new Set(all.map(round => round.id)).size, 84);
  assert.equal(new Set(all.map(roundFingerprint)).size, 84);
});

test("Wizard removes the distinct-family scaffold and doubles pose traps at the same three-picture density", () => {
  assert.equal(LEVEL_RULES.Wizard.showTargetCount, false);
  assert.equal(LEVEL_RULES.Expert.studyCount, LEVEL_RULES.Wizard.studyCount);
  assert.equal(LEVEL_RULES.Expert.optionCount, LEVEL_RULES.Wizard.optionCount);
  assert.equal(LEVEL_RULES.Expert.studyFamilyCount, 3);
  assert.equal(LEVEL_RULES.Wizard.studyFamilyCount, 2);
  for (const round of allAuthoredRounds().filter(round => ["Expert", "Wizard"].includes(round.difficulty))) {
    assertDifficulty(round);
    assert.equal(round.study.length, 3);
    assert.equal(round.options.length, 8);
    assert.equal(trapCounts(round).rotation + trapCounts(round).reflection, round.difficulty === "Expert" ? 2 : 4);
    if (round.difficulty === "Wizard") assert.equal(validateRound({ ...round, difficulty: "Expert" }), false);
  }
});

test("authored advanced options execute frozen trap programs over the actual studied appearances", () => {
  const sources = [...AUTHORED_CAMPAIGN_DATA, ...Object.values(AUTHORED_JOURNEY_DATA).flat()];
  assert.equal(sources.filter(spec => "traps" in spec).length, 48);
  for (const spec of sources) {
    const round = buildAuthoredRound(spec);
    assert.equal(validateRound(round), true);
    if (!("traps" in spec)) continue;
    const foils = spec.traps.map(trap => applyTrap(spec.study, trap));
    assert.deepEqual(round.options, spec.optionOrder.map(index => [...spec.study, ...foils][index]));
    for (const [index, trap] of spec.traps.entries()) {
      assert.notEqual(foils[index], spec.study[trap.source]);
      assert.equal(optionMisconception(round, foils[index]), trap.kind);
    }
    assert.throws(() => buildAuthoredRound({ ...spec, optionOrder: [0, 0, 1, 2, 3, 4, 5, 6] }), /permutation/);
  }
});

test("exact appearance recall rejects a rotated or reflected copy of the same object", () => {
  const round = CAMPAIGN_BY_LEVEL.Expert[0];
  assert.deepEqual(evaluateSelection(round, [...round.study].reverse()), { correct: true, missed: [], extra: [] });
  for (const kind of ["structural", "rotation", "reflection"]) {
    const wrong = round.options.find(id => optionMisconception(round, id) === kind);
    const source = round.study.find(id => PICTURE_BY_ID[id].family === PICTURE_BY_ID[wrong].family);
    const selection = round.study.map(id => id === source ? wrong : id);
    assert.deepEqual(evaluateSelection(round, selection), { correct: false, missed: [source], extra: [wrong] });
    if (kind !== "structural") assert.equal(pictureBaseId(wrong), pictureBaseId(source));
  }
  assert.deepEqual(evaluateSelection(round, []), { correct: false, missed: [...round.study], extra: [] });
  assert.equal(evaluateSelection(round, [...round.study, round.study[0]]).correct, false);
  assert.equal(evaluateSelection(round, round.options).correct, false);
});

test("fingerprints normalize upright aliases and order but preserve pose and handedness", () => {
  const round = CAMPAIGN_BY_LEVEL.Expert[0];
  assert.match(roundFingerprint(round), /^picture-memory:v2:/);
  assert.equal(roundFingerprint(round), roundFingerprint({ ...round, id: "other", difficulty: "Wizard", study: [...round.study].reverse(), options: [...round.options].reverse() }));
  const early = CAMPAIGN_BY_LEVEL.Starter[0];
  assert.equal(roundFingerprint(early), roundFingerprint({ ...early, study: early.study.map(id => `${id}@upright`), options: early.options.map(id => `${id}@upright`) }));
  assert.notEqual(roundFingerprint(round), roundFingerprint({ ...round, study: [rotationTrap(round.study[0]), ...round.study.slice(1)] }));
  assert.notEqual(roundFingerprint(round), roundFingerprint({ ...round, study: [reflectionTrap(round.study[0]), ...round.study.slice(1)] }));
});

test("validation rejects duplicate appearances, unsafe symmetric poses, unrelated filler and missing near-misses", () => {
  const early = CAMPAIGN_BY_LEVEL.Starter[0];
  const expert = CAMPAIGN_BY_LEVEL.Expert[0];
  const wizard = CAMPAIGN_BY_LEVEL.Wizard[0];
  assert.equal(validateRound({ ...early, study: [] }), false);
  assert.equal(validateRound({ ...early, options: [...early.options.slice(0, -1), early.options[0]] }), false);
  assert.equal(validateRound({ ...early, study: ["missing-1"] }), false);
  assert.equal(validateRound({ ...early, study: [structuralSibling(early.study[0])], options: early.options.map(id => id === early.study[0] ? structuralSibling(id) : id) }), false);
  assert.equal(validateRound({ ...expert, study: ["apple-1@turn-90", ...expert.study.slice(1)] }), false);
  assert.equal(validateRound({ ...expert, options: expert.options.map(id => optionMisconception(expert, id) === "rotation" ? "apple-1" : id) }), false);
  assert.equal(validateRound({ ...wizard, study: [wizard.study[0], withPicturePose(structuralSibling(wizard.study[0]), picturePose(wizard.study[0])), wizard.study[2]] }), false);
  assert.equal(validateRound({ ...expert, difficulty: "unknown" }), false);
  assert.equal(validateRound({ ...expert, id: "" }), false);
});

test("advanced authored banks cover all supported target poses, turn lengths and reflection axes", () => {
  for (const bank of [CAMPAIGN_BY_LEVEL.Expert, CAMPAIGN_BY_LEVEL.Wizard, JOURNEY_EXTRA_ROUNDS["expert-2"], JOURNEY_EXTRA_ROUNDS["wizard-2"]]) {
    assert.deepEqual(new Set(bank.flatMap(round => round.study.map(picturePose))), new Set(PICTURE_POSES));
    assert.equal(new Set(bank.flatMap(round => round.study.map(id => PICTURE_BY_ID[id].family))).size, POSE_SAFE_FAMILIES.length);
  }
  const programs = [...AUTHORED_CAMPAIGN_DATA, ...Object.values(AUTHORED_JOURNEY_DATA).flat()].filter(spec => "traps" in spec).flatMap(spec => spec.traps);
  assert.deepEqual(new Set(programs.filter(trap => trap.kind === "rotation").map(trap => trap.quarterTurns)), new Set([1, 2, 3]));
  assert.deepEqual(new Set(programs.filter(trap => trap.kind === "reflection").map(trap => trap.axis)), new Set(["left-right", "top-bottom", "diagonal", "antidiagonal"]));
});

test("1,600 seeded puzzles are reproducible and have one exact appearance-set solution", () => {
  for (const [offset, level] of LEVELS.entries()) {
    const targetFamilies = new Set(), variants = new Set(), poses = new Set();
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
        poses.add(picturePose(id));
      }
    }
    assert.equal(targetFamilies.size, LEVEL_RULES[level].includeStructuralVariants ? POSE_SAFE_FAMILIES.length : PICTURE_FAMILIES.length);
    assert.equal(variants.size, LEVEL_RULES[level].includeStructuralVariants ? 2 : 1);
    assert.equal(poses.size, LEVEL_RULES[level].includeStructuralVariants ? 8 : 1);
  }
});

test("the exclusion set prevents visual-content repeats in long sessions", () => {
  for (const level of LEVELS) {
    const random = seededRandom(20260927), seen = new Set();
    for (let index = 0; index < 400; index += 1) {
      const round = generateInfiniteRound(level, random, seen);
      const fingerprint = roundFingerprint(round);
      assert.equal(seen.has(fingerprint), false);
      seen.add(fingerprint);
    }
    assert.equal(seen.size, 400);
  }
});

test("hostile random sources fail clearly and excluded constant streams exhaust within the fixed bound", () => {
  for (const invalid of [NaN, Infinity, -Infinity, -0.01, 1, 2]) assert.throws(() => generateInfiniteRound("Starter", () => invalid), PuzzleGenerationError);
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

test("the upright vocabulary stays unchanged and posed objects have certified non-no-op symmetry orbits", () => {
  assert.equal(PICTURE_FAMILIES.length, 24);
  assert.equal(UPRIGHT_PICTURES.length, 48);
  for (const family of PICTURE_FAMILIES) {
    const pair = UPRIGHT_PICTURES.filter(picture => picture.family === family);
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map(picture => picture.variant).sort(), [1, 2]);
    assert.notEqual(pair[0].detail, pair[1].detail);
  }
  for (const family of POSE_SAFE_FAMILIES) for (const variant of [1, 2]) {
    const base = `${family}-${variant}`;
    const orbit = picturePoseOrbit(base);
    assert.equal(orbit.length, 8);
    assert.equal(new Set(orbit.map(normalizePictureId)).size, 8);
    assert.equal(pictureHasDistinctPoseOrbit(base), true);
    assert.equal(PICTURES.filter(picture => picture.baseId === base).length, 8);
  }
});

test("authored source programs are frozen literals without runtime generation", async () => {
  const source = await readFile(new URL("../app/games/picture-memory/authored-data.ts", import.meta.url), "utf8");
  assert.equal(/Math\.random|generateInfiniteRound|seededRandom/.test(source), false);
});
