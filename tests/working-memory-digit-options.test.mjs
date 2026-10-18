import assert from "node:assert/strict";
import test from "node:test";
import {
  digitTaskForVariant,
  digitVariantFromLegacy,
  digitVariantKey,
  enumerateDigitVariants,
  isCanonicalDigitVariant,
  normalizeDigitVariant,
} from "../app/lab/working-memory/digit-options.ts";
import {
  AUDIO_TASK_IDS,
  RESEARCH_PROFILE,
  TASK_IDS,
  VISUAL_TASK_IDS,
  advanceRound,
  createProgress,
  createSessionPlan,
  generateRound,
  isCorrectResponse,
  recordFirstAttempt,
  validateProgress,
} from "../app/lab/working-memory/engine.ts";

const variants = enumerateDigitVariants();

test("the independent option product folds only irrelevant spoken-keypad visibility into nine variants", () => {
  const keys = new Set();
  let combinations = 0;
  for (const order of ["reverse", "ascending", "descending"]) {
    for (const inputMode of ["keypad", "spoken"]) {
      for (const keypad of ["visible", "hidden"]) {
        combinations += 1;
        const original = { order, inputMode, keypad };
        const before = structuredClone(original);
        const normalized = normalizeDigitVariant(original);
        assert.deepEqual(original, before);
        assert.deepEqual(normalizeDigitVariant(normalized), normalized);
        assert.ok(isCanonicalDigitVariant(normalized));
        assert.equal(isCanonicalDigitVariant(original), inputMode === "keypad");
        assert.equal(normalized.keypad, inputMode === "spoken" ? "none" : keypad);
        keys.add(digitVariantKey(normalized));
      }
    }
  }
  assert.equal(combinations, 12);
  assert.equal(keys.size, 9);
  assert.equal(variants.length, 9);
  assert.deepEqual(new Set(variants.map(digitVariantKey)), keys);
  assert.equal(variants.filter(({ inputMode }) => inputMode === "spoken").length, 3);
  const copy = enumerateDigitVariants();
  copy[0].keypad = "hidden";
  assert.equal(enumerateDigitVariants()[0].keypad, "visible");
  for (const invalid of [
    null, [], {}, true, "reverse", { order: "reverse", inputMode: "spoken" },
    { order: "forward", inputMode: "keypad", keypad: "visible" },
    { order: "reverse", inputMode: "browser", keypad: "visible" },
    { order: "reverse", inputMode: "keypad", keypad: "none" },
    { order: "reverse", inputMode: "spoken", keypad: "sometimes" },
    { order: "reverse", inputMode: "spoken", keypad: "none", extra: true },
  ]) {
    assert.throws(() => normalizeDigitVariant(invalid));
    assert.equal(isCanonicalDigitVariant(invalid), false);
  }
});

test("legacy digit aliases map to one family without introducing a forward-digit exercise", () => {
  for (const inputMode of ["keypad", "spoken"]) {
    for (const digitOrder of ["ascending", "descending"]) {
      for (const task of AUDIO_TASK_IDS) {
        const mapped = digitVariantFromLegacy(task, inputMode, digitOrder);
        assert.ok(isCanonicalDigitVariant(mapped));
        assert.equal(mapped.order, task === "sort-digits" ? digitOrder : "reverse");
        assert.equal(mapped.keypad, inputMode === "spoken" ? "none" : task === "hidden-digits" ? "hidden" : "visible");
        assert.equal(digitTaskForVariant(mapped), task === "hidden-digits" && inputMode === "spoken" ? "reverse-digits" : task);
      }
      for (const task of [...VISUAL_TASK_IDS, "unknown"]) assert.equal(digitVariantFromLegacy(task, inputMode, digitOrder), null);
    }
  }
  for (const variant of variants) {
    assert.equal(digitTaskForVariant(variant), variant.order !== "reverse" ? "sort-digits" : variant.keypad === "hidden" ? "hidden-digits" : "reverse-digits");
    assert.notEqual(variant.order, "forward");
  }
  assert.equal(TASK_IDS.length, 11);
});

test("400 seeds at every digit span and variant produce correct answers and task-independent canonical identities", () => {
  for (let span = 2; span <= 9; span += 1) {
    for (let seed = 0; seed < 400; seed += 1) {
      const fingerprints = new Set();
      for (const variant of variants) {
        const rounds = AUDIO_TASK_IDS.map((task) => generateRound(task, span, `digit-product-${seed}`, undefined, seed % 2 ? "descending" : "ascending", RESEARCH_PROFILE, variant));
        const round = rounds[0];
        for (const aliasRound of rounds) assert.deepEqual(aliasRound, round);
        assert.match(round.id, /^digits-/);
        assert.equal(round.task, digitTaskForVariant(variant));
        assert.deepEqual(round.digitVariant, variant);
        assert.equal(round.sequence.length, span);
        assert.ok(round.sequence.every((digit, index) => digit >= 1 && digit <= 9 && (index === 0 || digit !== round.sequence[index - 1])));
        const expected = variant.order === "reverse"
          ? [...round.sequence].reverse()
          : [...round.sequence].sort((first, second) => variant.order === "ascending" ? first - second : second - first);
        assert.deepEqual(round.expected, expected);
        assert.deepEqual([...round.expected].sort(), [...round.sequence].sort());
        assert.ok(isCorrectResponse(round, expected));
        assert.ok(!isCorrectResponse(round, expected.slice(1)));
        assert.notDeepEqual(round.expected, round.sequence);
        assert.equal(round.digitOrder, variant.order === "descending" ? "descending" : undefined);
        fingerprints.add(round.fingerprint);
      }
      assert.equal(fingerprints.size, 9);
    }
  }
});

test("spoken visibility aliases fold before round generation while auditory settings leave visual rounds identical", () => {
  for (const order of ["reverse", "ascending", "descending"]) {
    const expected = generateRound("reverse-digits", 5, "fold-before-identity", undefined, "ascending", RESEARCH_PROFILE, { order, inputMode: "spoken", keypad: "none" });
    for (const keypad of ["visible", "hidden", "none"]) {
      assert.deepEqual(generateRound("hidden-digits", 5, "fold-before-identity", undefined, "descending", RESEARCH_PROFILE, { order, inputMode: "spoken", keypad }), expected);
    }
  }
  for (const task of VISUAL_TASK_IDS) {
    const original = generateRound(task, 3, "visual-options", undefined, "ascending", RESEARCH_PROFILE);
    for (const variant of variants) {
      const round = generateRound(task, 3, "visual-options", undefined, "ascending", RESEARCH_PROFILE, variant);
      assert.deepEqual(round, original);
      assert.equal("digitVariant" in round, false);
    }
  }
});

test("400 canonical plan seeds select one digit variant, preserve a half-auditory mixed session, and never schedule undefined aliases", () => {
  for (let seed = 0; seed < 400; seed += 1) {
    for (const length of [24, 48]) {
      for (const variant of variants) {
        const selectedTask = digitTaskForVariant(variant);
        const audio = createSessionPlan(length, `canonical-plan-${seed}`, undefined, "audio", variant);
        assert.deepEqual(audio, Array(length).fill(selectedTask));
        const mixed = createSessionPlan(length, `canonical-plan-${seed}`, undefined, "mixed", variant);
        assert.deepEqual(mixed, createSessionPlan(length, `canonical-plan-${seed}`, undefined, "mixed", variant));
        assert.equal(mixed.length, length);
        assert.equal(mixed.filter((task) => task === selectedTask).length, length / 2);
        for (const task of ["forward", "rotation", "tracking"]) assert.equal(mixed.filter((id) => id === task).length, length / 6);
        assert.ok(mixed.every((task, index) => TASK_IDS.includes(task) && (index === 0 || task !== mixed[index - 1])));
        assert.ok(mixed.every((task, index) => index === 0 || AUDIO_TASK_IDS.includes(task) !== AUDIO_TASK_IDS.includes(mixed[index - 1])));
        assert.deepEqual(createSessionPlan(length, `canonical-plan-${seed}`, undefined, "visual", variant), createSessionPlan(length, `canonical-plan-${seed}`, undefined, "visual"));
      }
    }
  }
  for (const variant of variants) {
    const task = digitTaskForVariant(variant);
    assert.deepEqual(createSessionPlan(8, "focus", task, "audio", variant), Array(8).fill(task));
    for (const other of AUDIO_TASK_IDS.filter((id) => id !== task)) {
      assert.throws(() => createProgress("wrong-focus", 8, { focusedTask: other, profile: RESEARCH_PROFILE, digitVariant: variant }));
    }
  }
});

test("all nine canonical variants retain strict settings, repeat-free rounds and first-attempt adaptation through every saved transition", () => {
  for (const variant of variants) {
    for (const options of [{ modality: "audio" }, { modality: "mixed" }, { focusedTask: digitTaskForVariant(variant), modality: "audio" }]) {
      let progress = createProgress("canonical-resume", options.focusedTask ? 8 : 24, { ...options, profile: RESEARCH_PROFILE, digitVariant: variant });
      const fingerprints = new Set();
      while (progress.active) {
        assert.deepEqual(validateProgress(structuredClone(progress)), progress);
        assert.deepEqual(progress.digitVariant, variant);
        const round = progress.active;
        assert.ok(!fingerprints.has(round.fingerprint));
        fingerprints.add(round.fingerprint);
        if (AUDIO_TASK_IDS.includes(round.task)) {
          assert.equal(round.task, digitTaskForVariant(variant));
          assert.deepEqual(round.digitVariant, variant);
        } else assert.equal("digitVariant" in round, false);
        const answered = recordFirstAttempt(progress, round, progress.cursor % 3 !== 0);
        assert.deepEqual(validateProgress(structuredClone(answered)), answered);
        assert.throws(() => recordFirstAttempt(answered, round, true));
        progress = advanceRound(answered);
      }
      assert.deepEqual(validateProgress(structuredClone(progress)), progress);
      for (const mutate of [
        (value) => { delete value.digitVariant; },
        (value) => { value.digitVariant.extra = true; },
        (value) => { value.digitVariant.order = variant.order === "ascending" ? "descending" : "ascending"; },
        (value) => { value.history.find(({ round }) => round.answerKind === "ordered-digits").round.digitVariant.keypad = "invalid"; },
        (value) => { delete value.history.find(({ round }) => round.answerKind === "ordered-digits").round.digitVariant; },
        (value) => { value.plan[0] = "hidden-digits" === value.plan[0] ? "reverse-digits" : "hidden-digits"; },
        (value) => { value.digitOrder = variant.order === "descending" ? "ascending" : "descending"; },
      ]) {
        const invalid = structuredClone(progress);
        mutate(invalid);
        assert.equal(validateProgress(invalid), null);
      }
    }
  }
});

test("visual-only canonical requests omit irrelevant digit metadata and strict validation rejects its injection", () => {
  for (const variant of variants) {
    for (const options of [{ modality: "visual" }, { focusedTask: "locations" }]) {
      const length = options.focusedTask ? 8 : 24;
      const progress = createProgress("visual-progress", length, { ...options, profile: RESEARCH_PROFILE, digitOrder: "descending", digitVariant: variant });
      assert.equal("digitVariant" in progress, false);
      assert.equal("digitOrder" in progress, false);
      assert.deepEqual(progress, createProgress("visual-progress", length, { ...options, profile: RESEARCH_PROFILE }));
      const injected = structuredClone(progress);
      injected.digitVariant = variant;
      assert.equal(validateProgress(injected), null);
    }
  }
});

test("legacy audio round identities and shuffled three-alias plans remain exact when digitVariant is absent", () => {
  const common = { version: 1, span: 4, gridSize: 4, profile: RESEARCH_PROFILE, sequence: [5, 7, 9, 8], answerKind: "ordered-digits" };
  const expected = [
    { id: "reverse-digits-1m23sl", task: "reverse-digits", expected: [8, 9, 7, 5], fingerprint: '["reverse-digits",[5,7,9,8],null,null,null,"research-v1"]' },
    { id: "hidden-digits-v4sohb", task: "hidden-digits", expected: [8, 9, 7, 5], fingerprint: '["hidden-digits",[5,7,9,8],null,null,null,"research-v1"]' },
    { id: "sort-digits-zp2hj", task: "sort-digits", expected: [9, 8, 7, 5], digitOrder: "descending", fingerprint: '["sort-digits",[5,7,9,8],null,null,null,"descending","research-v1"]' },
  ];
  for (const snapshot of expected) {
    assert.deepEqual(generateRound(snapshot.task, 4, "canonical-legacy-snapshot", undefined, "descending", RESEARCH_PROFILE), { ...common, ...snapshot });
  }
  assert.deepEqual(createSessionPlan(24, "canonical-legacy-snapshot", undefined, "audio"), [
    "hidden-digits", "sort-digits", "reverse-digits", "sort-digits", "reverse-digits", "hidden-digits", "sort-digits", "hidden-digits", "reverse-digits", "hidden-digits", "sort-digits", "reverse-digits", "hidden-digits", "sort-digits", "reverse-digits", "sort-digits", "reverse-digits", "hidden-digits", "sort-digits", "hidden-digits", "reverse-digits", "hidden-digits", "reverse-digits", "sort-digits",
  ]);
  for (const profile of [undefined, RESEARCH_PROFILE]) {
    let progress = createProgress("legacy-canonical-resume", 24, { modality: "audio", profile, digitOrder: "descending" });
    while (progress.active) {
      assert.equal("digitVariant" in progress, false);
      assert.equal("digitVariant" in progress.active, false);
      assert.deepEqual(validateProgress(structuredClone(progress)), progress);
      progress = advanceRound(recordFirstAttempt(progress, progress.active, progress.cursor % 2 === 0));
    }
    assert.deepEqual(validateProgress(structuredClone(progress)), progress);
  }
});

test("two-digit sorting enumerates the exact final unseen pair before recycling a fully exhausted pool", () => {
  for (const variant of variants.filter(({ order }) => order !== "reverse")) {
    const seen = new Set();
    const rounds = [];
    for (let index = 0; index < 36; index += 1) {
      const round = generateRound("sort-digits", 2, `finite-pool-${index}`, seen, "ascending", RESEARCH_PROFILE, variant);
      assert.ok(!seen.has(round.fingerprint));
      seen.add(round.fingerprint);
      rounds.push(round);
    }
    assert.equal(seen.size, 36);
    assert.deepEqual(new Set(rounds.map(({ sequence }) => `${Math.min(...sequence)}:${Math.max(...sequence)}`)), new Set(
      Array.from({ length: 9 }, (_, first) => Array.from({ length: 8 - first }, (_, second) => `${first + 1}:${first + second + 2}`)).flat(),
    ));
    const onlyRemaining = rounds[35];
    const saturated = new Set(rounds.slice(0, 35).map(({ fingerprint }) => fingerprint));
    assert.equal(generateRound("sort-digits", 2, "last-unseen-pair", saturated, "ascending", RESEARCH_PROFILE, variant).fingerprint, onlyRemaining.fingerprint);
    const recycled = generateRound("sort-digits", 2, "new-cycle", seen, "ascending", RESEARCH_PROFILE, variant);
    assert.ok(seen.has(recycled.fingerprint));
    assert.ok(rounds.every(({ id }) => id !== recycled.id));
    // Generation returns independent data even when a finite semantic pool is cached.
    const untouched = structuredClone(recycled);
    recycled.sequence[0] = 99;
    recycled.expected[0] = 99;
    recycled.digitVariant.keypad = "invalid";
    assert.deepEqual(generateRound("sort-digits", 2, "new-cycle", seen, "ascending", RESEARCH_PROFILE, variant), untouched);
  }
});

test("400 seeds complete all 48 low-load trials for every canonical variant without raising load after misses", () => {
  for (let seed = 0; seed < 400; seed += 1) {
    for (const variant of variants) {
      let progress = createProgress(`sort-48-capacity-${seed}`, 48, { modality: "audio", profile: RESEARCH_PROFILE, digitVariant: variant });
      const cycle = new Set();
      const firstCycle = new Set();
      const ids = new Set();
      while (progress.active) {
        const round = progress.active;
        assert.equal(round.span, 2);
        assert.ok(!ids.has(round.id));
        ids.add(round.id);
        assert.ok(!cycle.has(round.fingerprint));
        cycle.add(round.fingerprint);
        if (progress.cursor < 36) firstCycle.add(round.fingerprint);
        if (variant.order !== "reverse" && progress.cursor === 35) {
          assert.equal(cycle.size, 36);
          assert.deepEqual(validateProgress(structuredClone(progress)), progress);
          cycle.clear();
        }
        if (variant.order !== "reverse" && progress.cursor >= 36) assert.ok(firstCycle.has(round.fingerprint));
        const answered = recordFirstAttempt(progress, round, false);
        assert.equal(answered.tasks[round.task].span, 2);
        assert.equal(answered.history.at(-1).correct, false);
        progress = advanceRound(answered);
        if (progress.cursor === 37) assert.deepEqual(validateProgress(structuredClone(progress)), progress);
      }
      assert.equal(progress.history.length, 48);
      assert.equal(ids.size, 48);
      assert.equal(progress.tasks[digitTaskForVariant(variant)].attempts, 48);
      assert.equal(progress.tasks[digitTaskForVariant(variant)].correct, 0);
      assert.equal(cycle.size, variant.order === "reverse" ? 48 : 12);
      assert.deepEqual(validateProgress(structuredClone(progress)), progress);
    }
  }
});

test("recycled semantics have distinct occurrence IDs so earlier redemption cannot redeem or rescore a later trial", () => {
  for (const variant of variants.filter(({ order }) => order !== "reverse")) {
    let progress = createProgress("recycled-redemption", 48, { modality: "audio", profile: RESEARCH_PROFILE, digitVariant: variant });
    for (let cursor = 0; cursor < 36; cursor += 1) progress = advanceRound(recordFirstAttempt(progress, progress.active, false));
    const repeated = progress.active;
    const previous = progress.history.find(({ round }) => round.fingerprint === repeated.fingerprint).round;
    assert.notEqual(previous.id, repeated.id);
    const redeemedIds = [previous.id];
    assert.ok(!redeemedIds.includes(repeated.id));
    const before = structuredClone(progress);
    const answered = recordFirstAttempt(progress, repeated, false);
    assert.deepEqual(progress, before);
    assert.equal(answered.tasks[repeated.task].attempts, 37);
    assert.equal(answered.history.filter(({ round }) => round.fingerprint === repeated.fingerprint).length, 2);
    assert.throws(() => recordFirstAttempt(answered, repeated, true));
    redeemedIds.push(repeated.id);
    assert.equal(new Set(redeemedIds).size, 2);
    assert.deepEqual(validateProgress(structuredClone(answered)), answered);
    const next = advanceRound(answered);
    assert.equal(next.cursor, 37);
    assert.equal(next.answered, false);
    assert.ok(!redeemedIds.includes(next.active.id));
    assert.deepEqual(validateProgress(structuredClone(next)), next);
  }
  const variant = { order: "ascending", inputMode: "keypad", keypad: "visible" };
  const plain = generateRound("sort-digits", 2, "seed", undefined, "ascending", RESEARCH_PROFILE, variant);
  for (const otherSeed of ["seed:round:1", "seed:round:2", "seed\ud800", "seed\ud801"]) {
    const different = generateRound("hidden-digits", 2, otherSeed, undefined, "ascending", RESEARCH_PROFILE, variant);
    assert.notEqual(different.id, plain.id);
  }
});
