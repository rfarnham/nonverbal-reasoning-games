import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_IDS,
  AUDIO_TASK_IDS,
  VISUAL_TASK_IDS,
  SESSION_TASK_POOLS,
  RESEARCH_PROFILE,
  activeRound,
  advanceRound,
  createProgress,
  createSessionPlan,
  createTaskStates,
  finalTrackingPositions,
  generateRound,
  getTaskProfile,
  hasStraightRun,
  isCorrectResponse,
  recordFirstAttempt,
  rotateCell,
  studyDuration,
  validateProgress,
  validateTaskStates,
} from "../app/lab/working-memory/engine.ts";

const CELL_TASKS = new Set(["forward", "backward", "rotation", "pattern", "split"]);
const ORDERED_CELL_TASKS = new Set(["forward", "backward", "rotation", "split"]);

function independentExpected(round) {
  if (round.task === "backward" || round.task === "reverse-digits" || round.task === "hidden-digits") return [...round.sequence].reverse();
  if (round.task === "sort-digits") return [...round.sequence].sort((first, second) => round.digitOrder === "descending" ? second - first : first - second);
  if (round.task === "rotation") {
    return round.sequence.map((cell) => {
      const row = Math.floor(cell / 4);
      const column = cell % 4;
      return round.rotation === "clockwise" ? column * 4 + 3 - row : (3 - column) * 4 + row;
    });
  }
  if (round.task === "tracking") {
    const initialToFinal = [...round.positions];
    for (const [first, second] of round.moves) {
      const before = initialToFinal[first];
      initialToFinal[first] = initialToFinal[second];
      initialToFinal[second] = before;
    }
    return round.sequence.map((id) => initialToFinal[id]);
  }
  if (round.task === "locations") return round.cues.map((id) => round.positions[id]);
  return [...round.sequence];
}

test("400 deterministic seeds at every span and task have one calculated completion state", () => {
  const directions = new Set();
  const audioWithRepeatedDigits = new Set();
  for (const task of TASK_IDS) {
    for (let span = 2; span <= 9; span += 1) {
      for (let seed = 0; seed < 400; seed += 1) {
        const round = generateRound(task, span, `corpus-${seed}`);
        assert.deepEqual(round, generateRound(task, span, `corpus-${seed}`));
        assert.equal(round.task, task);
        assert.equal(round.span, span);
        assert.equal(round.sequence.length, span);
        assert.equal(round.gridSize, 4);
        assert.deepEqual(round.expected, independentExpected(round));
        assert.ok(isCorrectResponse(round, round.expected));
        assert.ok(!isCorrectResponse(round, round.expected.slice(1)));
        assert.ok(!isCorrectResponse(round, [...round.expected, round.expected[0]]));
        const wrong = [...round.expected];
        wrong[0] = (wrong[0] + 1) % (task === "symbols" ? 6 : 16);
        if (task === "pattern") wrong[0] = round.expected[1];
        assert.ok(!isCorrectResponse(round, wrong));
        assert.ok(!isCorrectResponse(round, round.expected.map((value, index) => index === 0 ? value + 0.1 : value)));
        if (CELL_TASKS.has(task)) {
          assert.equal(new Set(round.sequence).size, span);
          assert.ok(round.sequence.every((cell) => cell >= 0 && cell < 16));
        }
        if (ORDERED_CELL_TASKS.has(task)) assert.ok(!hasStraightRun(round.sequence));
        if (task === "rotation") directions.add(round.rotation);
        if (task === "symbols" || task === "locations" || task === "tracking") {
          const count = task === "tracking" ? 8 : 6;
          assert.ok(round.sequence.every((id) => id >= 0 && id < count));
          assert.ok(round.sequence.every((id, index) => index === 0 || id !== round.sequence[index - 1]));
        }
        if (AUDIO_TASK_IDS.includes(task)) {
          assert.equal(round.answerKind, "ordered-digits");
          assert.ok(round.sequence.every((digit) => digit >= 1 && digit <= 9));
          assert.ok(round.sequence.every((digit, index) => index === 0 || digit !== round.sequence[index - 1]));
          assert.notDeepEqual(round.expected, round.sequence);
          if (new Set(round.sequence).size < span) audioWithRepeatedDigits.add(task);
          if (task === "sort-digits") assert.ok(round.expected.every((digit, index) => index === 0 || digit >= round.expected[index - 1]));
        }
        if (task === "tracking" || task === "locations") {
          assert.equal(round.positions.length, task === "tracking" ? 8 : 6);
          assert.equal(new Set(round.positions).size, round.positions.length);
          assert.ok(round.positions.every((cell) => cell >= 0 && cell < 16));
        }
        if (task === "tracking") {
          assert.equal(round.moves.length, 3);
          assert.equal(new Set(round.moves.flat()).size, 6);
          assert.ok(round.sequence.some((id) => round.moves.flat().includes(id)));
          assert.deepEqual(round.sequence.map((id) => finalTrackingPositions(round)[id]), round.expected);
        }
        if (task === "locations") assert.deepEqual(round.cues, round.sequence);
        if (task === "split") {
          assert.ok(round.sequence.every((cell, index) => index === 0 || (cell % 4 < 2) !== (round.sequence[index - 1] % 4 < 2)));
        }
        if (task === "pattern") assert.ok(isCorrectResponse(round, [...round.expected].reverse()));
      }
    }
  }
  assert.deepEqual([...directions].sort(), ["clockwise", "counterclockwise"]);
  assert.deepEqual([...audioWithRepeatedDigits].sort(), [...AUDIO_TASK_IDS].sort());
});

test("rotation geometry and straight-run rejection respect row boundaries and both diagonals", () => {
  assert.deepEqual([0, 3, 15, 12].map((cell) => rotateCell(cell, "clockwise")), [3, 15, 12, 0]);
  for (let cell = 0; cell < 16; cell += 1) {
    assert.equal(rotateCell(rotateCell(cell, "clockwise"), "counterclockwise"), cell);
  }
  for (const sequence of [[0, 1, 2], [12, 8, 4], [0, 5, 10], [3, 6, 9], [15, 10, 5]]) assert.ok(hasStraightRun(sequence));
  for (const sequence of [[2, 3, 4], [0, 5, 9], [0, 0, 0], [0, 1]]) assert.ok(!hasStraightRun(sequence));
  assert.throws(() => rotateCell(16, "clockwise"));
  assert.throws(() => rotateCell(0, "other"));
  assert.throws(() => finalTrackingPositions({ positions: [0, 1], moves: [[0, 0]] }));
});

test("balanced plans use every task in their modality pool and focused practice contains eight rounds", () => {
  assert.equal(VISUAL_TASK_IDS.length, 8);
  assert.equal(AUDIO_TASK_IDS.length, 3);
  assert.equal(TASK_IDS.length, 11);
  assert.equal(new Set(TASK_IDS).size, 11);
  assert.deepEqual(SESSION_TASK_POOLS.mixed, ["forward", "rotation", "tracking", ...AUDIO_TASK_IDS]);
  for (let seed = 0; seed < 400; seed += 1) {
    for (const length of [24, 48]) {
      for (const [modality, pool] of Object.entries(SESSION_TASK_POOLS)) {
        const plan = createSessionPlan(length, seed, undefined, modality);
        assert.deepEqual(plan, createSessionPlan(length, seed, undefined, modality));
        assert.equal(plan.length, length);
        for (const task of TASK_IDS) assert.equal(plan.filter((id) => id === task).length, pool.includes(task) ? length / pool.length : 0);
        for (let start = 0; start < length; start += pool.length) assert.deepEqual([...plan.slice(start, start + pool.length)].sort(), [...pool].sort());
        assert.ok(plan.every((task, index) => index === 0 || task !== plan[index - 1]));
        if (modality === "mixed") assert.deepEqual(plan, createSessionPlan(length, seed));
      }
    }
  }
  for (const task of TASK_IDS) assert.deepEqual(createSessionPlan(8, "practice", task), Array(8).fill(task));
  assert.throws(() => createSessionPlan(8, "invalid"));
  assert.throws(() => createSessionPlan(24, "invalid", "tracking"));
  assert.throws(() => createSessionPlan(24, "invalid", undefined, "unknown"));
});

test("session fingerprints do not repeat and generation exhaustion fails in a bounded way", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    for (const modality of ["mixed", "audio", "visual"]) {
      let progress = createProgress(`session-${seed}`, 48, { modality });
      const seen = new Set();
      while (activeRound(progress)) {
        const round = activeRound(progress);
        assert.ok(!seen.has(round.fingerprint));
        seen.add(round.fingerprint);
        progress = advanceRound(recordFirstAttempt(progress, round, progress.cursor % 3 !== 0));
      }
      assert.equal(seen.size, 48);
    }
  }
  const original = generateRound("pattern", 2, "same-seed");
  const next = generateRound("pattern", 2, "same-seed", new Set([original.fingerprint]));
  assert.notEqual(next.fingerprint, original.fingerprint);
  let calls = 0;
  assert.throws(() => generateRound("symbols", 2, "hostile", { has() { calls += 1; return true; } }), /128 attempts/);
  assert.equal(calls, 128);
  for (const span of [0, 1, 10, 2.1, NaN, Infinity]) assert.throws(() => generateRound("forward", span, 0));
  assert.throws(() => generateRound("unknown", 3, 0));
});

test("two first-try successes raise span, failure lowers it, and retries cannot change history", () => {
  let progress = createProgress("adaptation", 8, { focusedTask: "forward" });
  assert.equal(progress.tasks.forward.span, 3);
  const untouched = JSON.stringify(progress);
  const firstRound = activeRound(progress);
  assert.throws(() => advanceRound(progress));
  let answered = recordFirstAttempt(progress, firstRound, true);
  assert.equal(JSON.stringify(progress), untouched);
  assert.equal(answered.tasks.forward.span, 3);
  assert.equal(answered.tasks.forward.successStreak, 1);
  assert.throws(() => recordFirstAttempt(answered, firstRound, false));
  assert.equal(answered.history[0].correct, true);
  progress = advanceRound(answered);
  answered = recordFirstAttempt(progress, activeRound(progress), true);
  assert.equal(answered.tasks.forward.span, 4);
  assert.equal(answered.tasks.forward.successStreak, 0);
  assert.equal(answered.active.span, 3);
  progress = advanceRound(answered);
  assert.equal(progress.active.span, 4);
  answered = recordFirstAttempt(progress, progress.active, false);
  assert.equal(answered.tasks.forward.span, 3);
  assert.equal(answered.tasks.forward.successStreak, 0);
  assert.throws(() => recordFirstAttempt(answered, answered.active, true));
  assert.equal(answered.history[2].correct, false);
  assert.deepEqual(answered.tasks.backward, createTaskStates().backward);
  progress = advanceRound(answered);
  assert.throws(() => recordFirstAttempt(progress, firstRound, true));
});

test("adaptation remains within span bounds and can carry independent task state into a new session", () => {
  for (const [initialSpan, correct, expectedSpan] of [[2, false, 2], [9, true, 9]]) {
    const tasks = createTaskStates();
    tasks.forward = { span: initialSpan, successStreak: 1, attempts: 20, correct: 10 };
    const before = structuredClone(tasks);
    let progress = createProgress(`bound-${initialSpan}`, 8, { focusedTask: "forward", tasks });
    for (let index = 0; index < 8; index += 1) progress = advanceRound(recordFirstAttempt(progress, progress.active, correct));
    assert.equal(progress.tasks.forward.span, expectedSpan);
    assert.equal(progress.tasks.forward.attempts, 28);
    assert.deepEqual(tasks, before);
    assert.equal(activeRound(progress), null);
    assert.throws(() => advanceRound(progress));
    const continued = createProgress("carry", 24, { tasks: progress.tasks });
    assert.deepEqual(continued.tasks, progress.tasks);
    continued.tasks.backward.span = 8;
    assert.equal(progress.tasks.backward.span, 3);
  }
});

test("stored progress round-trips at every observation, answered, and completed state", () => {
  for (const options of [{}, { modality: "visual" }, { modality: "audio" }, { focusedTask: "tracking" }, { focusedTask: "sort-digits", modality: "audio" }, { digitOrder: "descending" }, { focusedTask: "sort-digits", digitOrder: "descending" }]) {
    let progress = createProgress("resume", options.focusedTask ? 8 : 24, options);
    for (;;) {
      assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(progress))), progress);
      if (!progress.active) break;
      progress = recordFirstAttempt(progress, progress.active, progress.cursor % 2 === 0);
      assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(progress))), progress);
      progress = advanceRound(progress);
    }
  }
});

test("storage validation rejects stale rounds, inconsistent first attempts, plans, and adaptive state", () => {
  let progress = createProgress("validation", 24);
  for (let index = 0; index < 3; index += 1) progress = advanceRound(recordFirstAttempt(progress, progress.active, true));
  const mutations = [
    (value) => { value.version = 2; },
    (value) => { value.modality = "unknown"; },
    (value) => { value.digitOrder = "unknown"; },
    (value) => { value.modality = "visual"; },
    (value) => { value.cursor = 4; },
    (value) => { value.cursor = -1; },
    (value) => { value.active.sequence[0] = 99; },
    (value) => { value.active.expected[0] = 99; },
    (value) => { value.history[0].correct = false; },
    (value) => { value.history[0].round.fingerprint = "tampered"; },
    (value) => { value.plan.reverse(); },
    (value) => { value.tasks.forward.span = 9; },
    (value) => { value.initialTasks.forward.span = 10; },
    (value) => { value.initialTasks.forward.successStreak = 1; },
    (value) => { value.initialTasks.forward.attempts = Infinity; },
    (value) => { value.tasks.forward.correct = -1; },
    (value) => { value.tasks.forward = null; },
    (value) => { value.answered = true; },
    (value) => { value.active = null; },
    (value) => { value.focusedTask = "unknown"; },
    (value) => { value.seed = "different-seed"; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(progress);
    mutate(invalid);
    assert.equal(validateProgress(invalid), null);
  }
  for (const value of [null, true, [], {}, "{}", { version: 1, history: [] }]) assert.equal(validateProgress(value), null);
  assert.throws(() => createProgress(Infinity));
  assert.throws(() => createProgress("x".repeat(257)));
  assert.throws(() => createProgress("bad-order", 24, { digitOrder: "unknown" }));
  assert.throws(() => generateRound("sort-digits", 3, "bad-order", undefined, "unknown"));
  const withoutModality = structuredClone(progress);
  delete withoutModality.modality;
  assert.deepEqual(validateProgress(withoutModality), progress);
});

test("legacy ascending rounds and saved progress retain their original identities", () => {
  // These rounds were captured before a selectable sorting direction existed.
  const legacyRound = {
    version: 1, id: "sort-digits-czpc76", task: "sort-digits", span: 5, gridSize: 4,
    sequence: [4, 9, 5, 9, 6], expected: [4, 5, 6, 9, 9], answerKind: "ordered-digits",
    fingerprint: '["sort-digits",[4,9,5,9,6],null,null,null]',
  };
  assert.deepEqual(generateRound("sort-digits", 5, "legacy-digit-direction"), legacyRound);
  assert.deepEqual(generateRound("sort-digits", 5, "legacy-digit-direction", undefined, "ascending"), legacyRound);
  const legacySession = {
    version: 1, seed: "legacy-digit-direction", length: 8, modality: "audio", focusedTask: "sort-digits",
    initialTasks: createTaskStates(),
    tasks: { ...createTaskStates(), "sort-digits": { span: 2, successStreak: 1, attempts: 3, correct: 2 } },
    plan: Array(8).fill("sort-digits"), cursor: 3, answered: false,
    history: [
      {
        round: {
          version: 1, id: "sort-digits-1xfo8ey", task: "sort-digits", span: 3, gridSize: 4,
          sequence: [3, 9, 5], expected: [3, 5, 9], answerKind: "ordered-digits",
          fingerprint: '["sort-digits",[3,9,5],null,null,null]',
        }, correct: true,
      },
      {
        round: {
          version: 1, id: "sort-digits-98mxn7", task: "sort-digits", span: 3, gridSize: 4,
          sequence: [6, 3, 7], expected: [3, 6, 7], answerKind: "ordered-digits",
          fingerprint: '["sort-digits",[6,3,7],null,null,null]',
        }, correct: false,
      },
      {
        round: {
          version: 1, id: "sort-digits-zkopvv", task: "sort-digits", span: 2, gridSize: 4,
          sequence: [8, 6], expected: [6, 8], answerKind: "ordered-digits",
          fingerprint: '["sort-digits",[8,6],null,null,null]',
        }, correct: true,
      },
    ],
    active: {
      version: 1, id: "sort-digits-r5apvo", task: "sort-digits", span: 2, gridSize: 4,
      sequence: [8, 1], expected: [1, 8], answerKind: "ordered-digits",
      fingerprint: '["sort-digits",[8,1],null,null,null]',
    },
  };
  assert.deepEqual(validateProgress(legacySession), legacySession);
  const progressed = advanceRound(recordFirstAttempt(legacySession, legacySession.active, true));
  assert.deepEqual(validateProgress(progressed), progressed);
  assert.equal("digitOrder" in progressed, false);
  assert.ok(progressed.history.every(({ round }) => !("digitOrder" in round)));
  assert.deepEqual(
    createProgress("explicit-ascending", 8, { focusedTask: "sort-digits", digitOrder: "ascending" }),
    createProgress("explicit-ascending", 8, { focusedTask: "sort-digits" }),
  );
});

test("descending number assembly is deterministic, retains repeated digits, and rejects the opposite order", () => {
  let hasRepeatedDigits = false;
  for (let span = 2; span <= 9; span += 1) {
    for (let seed = 0; seed < 200; seed += 1) {
      const round = generateRound("sort-digits", span, `descending-${seed}`, undefined, "descending");
      assert.deepEqual(round, generateRound("sort-digits", span, `descending-${seed}`, undefined, "descending"));
      assert.equal(round.digitOrder, "descending");
      assert.deepEqual(round.expected, independentExpected(round));
      assert.deepEqual([...round.expected].sort(), [...round.sequence].sort());
      assert.notDeepEqual(round.expected, round.sequence);
      assert.ok(isCorrectResponse(round, round.expected));
      assert.ok(!isCorrectResponse(round, [...round.expected].reverse()));
      if (new Set(round.sequence).size < span) {
        hasRepeatedDigits = true;
        assert.ok(!isCorrectResponse(round, [...new Set(round.expected)]));
      }
      const ascending = generateRound("sort-digits", span, `descending-${seed}`);
      assert.notEqual(ascending.fingerprint, round.fingerprint);
      assert.notEqual(ascending.id, round.id);
      const next = generateRound("sort-digits", span, `descending-${seed}`, new Set([round.fingerprint]), "descending");
      assert.notEqual(next.fingerprint, round.fingerprint);
    }
  }
  assert.ok(hasRepeatedDigits);
  // Sorting preference does not modify the presentation of other exercises.
  for (const task of TASK_IDS.filter((task) => task !== "sort-digits")) {
    assert.deepEqual(generateRound(task, 4, "unrelated-order", undefined, "descending"), generateRound(task, 4, "unrelated-order"));
  }
});

test("descending sessions preserve the selected rule through adaptation, resume, and completion", () => {
  for (const options of [{ modality: "mixed" }, { modality: "audio" }, { focusedTask: "sort-digits" }]) {
    let progress = createProgress("descending-session", options.focusedTask ? 8 : 24, { ...options, digitOrder: "descending" });
    let sortedRounds = 0;
    const seen = new Set();
    while (progress.active) {
      const round = progress.active;
      assert.equal(progress.digitOrder, "descending");
      assert.ok(!seen.has(round.fingerprint));
      seen.add(round.fingerprint);
      if (round.task === "sort-digits") {
        sortedRounds += 1;
        assert.equal(round.digitOrder, "descending");
        assert.deepEqual(round.expected, [...round.sequence].sort((first, second) => second - first));
      } else assert.equal("digitOrder" in round, false);
      assert.deepEqual(validateProgress(structuredClone(progress)), progress);
      const answered = recordFirstAttempt(progress, round, progress.cursor % 3 !== 0);
      assert.deepEqual(validateProgress(structuredClone(answered)), answered);
      progress = advanceRound(answered);
    }
    assert.ok(sortedRounds > 0);
    assert.deepEqual(validateProgress(structuredClone(progress)), progress);
    for (const mutate of [
      (value) => { delete value.digitOrder; },
      (value) => { value.digitOrder = "ascending"; },
      (value) => { value.history.find(({ round }) => round.task === "sort-digits").round.expected.reverse(); },
      (value) => { delete value.history.find(({ round }) => round.task === "sort-digits").round.digitOrder; },
    ]) {
      const invalid = structuredClone(progress);
      mutate(invalid);
      assert.equal(validateProgress(invalid), null);
    }
  }
});

test("audio reverse tasks preserve repeated digits and numeric sorting keeps every occurrence", () => {
  for (const task of AUDIO_TASK_IDS) {
    let repeated;
    for (let seed = 0; seed < 100 && !repeated; seed += 1) {
      const round = generateRound(task, 9, `digit-duplicates-${seed}`);
      if (new Set(round.sequence).size < round.sequence.length) repeated = round;
    }
    assert.ok(repeated, `${task} must permit repeated digits`);
    assert.deepEqual([...repeated.expected].sort(), [...repeated.sequence].sort());
    assert.deepEqual(repeated.expected, task === "sort-digits" ? [...repeated.sequence].sort((first, second) => first - second) : [...repeated.sequence].reverse());
    assert.ok(isCorrectResponse(repeated, repeated.expected));
    assert.ok(!isCorrectResponse(repeated, [...new Set(repeated.expected)]));
    assert.ok(!isCorrectResponse(repeated, repeated.sequence));
    if (task === "sort-digits") assert.ok(!isCorrectResponse(repeated, [...repeated.expected].reverse()));
    const focused = createProgress(`audio-${task}`, 8, { focusedTask: task, modality: "audio" });
    const answered = recordFirstAttempt(focused, focused.active, false);
    assert.equal(answered.tasks[task].span, 2);
    assert.equal(answered.tasks[task].attempts, 1);
    assert.deepEqual(answered.tasks.forward, focused.tasks.forward);
    assert.throws(() => recordFirstAttempt(answered, answered.active, true));
    assert.equal(answered.history[0].correct, false);
  }
});

test("research task profiles use independent conservative starts and bound the actual binding load", () => {
  const states = createTaskStates(RESEARCH_PROFILE);
  assert.ok(validateTaskStates(states, RESEARCH_PROFILE));
  assert.ok(!validateTaskStates(states));
  assert.ok(!validateTaskStates(createTaskStates(), RESEARCH_PROFILE));
  for (const task of TASK_IDS) {
    const profile = getTaskProfile(task, RESEARCH_PROFILE);
    assert.deepEqual(profile, {
      minSpan: 2,
      initialSpan: task === "forward" || task === "pattern" ? 3 : 2,
      maxSpan: task === "locations" ? 6 : 9,
    });
    assert.deepEqual(states[task], { span: profile.initialSpan, successStreak: 0, attempts: 0, correct: 0, balance: 0 });
    assert.deepEqual(getTaskProfile(task), { minSpan: 2, initialSpan: 3, maxSpan: 9 });
    assert.deepEqual(createTaskStates()[task], { span: 3, successStreak: 0, attempts: 0, correct: 0 });
  }
  assert.throws(() => createTaskStates("unknown"));
  assert.throws(() => createProgress("mixing-banks", 24, { profile: RESEARCH_PROFILE, tasks: createTaskStates() }));
  assert.throws(() => createProgress("mixing-banks", 24, { tasks: states }));
  assert.throws(() => generateRound("locations", 7, "too-many-bindings", undefined, "ascending", RESEARCH_PROFILE));
  assert.throws(() => generateRound("forward", 3, "invalid", undefined, "ascending", "unknown"));
  assert.ok(!validateTaskStates(states, "unknown"));
});

test("400 research-profile seeds at every supported task load preserve the declared response mechanics", () => {
  for (const task of TASK_IDS) {
    const { minSpan, maxSpan } = getTaskProfile(task, RESEARCH_PROFILE);
    for (let span = minSpan; span <= maxSpan; span += 1) {
      for (let seed = 0; seed < 400; seed += 1) {
        const digitOrder = seed % 2 ? "descending" : "ascending";
        const round = generateRound(task, span, `research-${seed}`, undefined, digitOrder, RESEARCH_PROFILE);
        assert.deepEqual(round, generateRound(task, span, `research-${seed}`, undefined, digitOrder, RESEARCH_PROFILE));
        assert.equal(round.profile, RESEARCH_PROFILE);
        assert.equal(round.span, span);
        assert.equal(round.sequence.length, span);
        assert.deepEqual(round.expected, independentExpected(round));
        assert.ok(isCorrectResponse(round, round.expected));
        assert.ok(!isCorrectResponse(round, round.expected.slice(1)));
        if (task === "rotation") assert.equal(round.rotation, "clockwise");
        if (task === "locations") {
          assert.equal(round.positions.length, span);
          assert.equal(new Set(round.positions).size, span);
          assert.equal(new Set(round.cues).size, span);
          assert.deepEqual([...round.cues].sort(), Array.from({ length: span }, (_, index) => index));
          assert.deepEqual(round.sequence, round.cues);
          assert.deepEqual(round.expected, round.cues.map((id) => round.positions[id]));
          assert.notEqual(round.fingerprint, generateRound(task, span, `research-${seed}`, undefined, digitOrder).fingerprint);
        }
      }
    }
  }
});

test("research weighted evidence has zero drift at three successes and two misses without changing first attempts", () => {
  const tasks = createTaskStates(RESEARCH_PROFILE);
  tasks.forward.span = 5;
  let progress = createProgress("weighted-evidence", 8, { profile: RESEARCH_PROFILE, focusedTask: "forward", tasks });
  const expectedBalances = [2, 4, 1, -2, 0];
  const expectedSpans = [5, 5, 6, 6, 5];
  const outcomes = [true, true, true, false, false];
  for (let index = 0; index < outcomes.length; index += 1) {
    const before = structuredClone(progress);
    const answered = recordFirstAttempt(progress, progress.active, outcomes[index]);
    assert.deepEqual(progress, before);
    assert.equal(answered.tasks.forward.balance, expectedBalances[index]);
    assert.equal(answered.tasks.forward.span, expectedSpans[index]);
    assert.equal(answered.tasks.forward.successStreak, 0);
    assert.equal(answered.history[index].correct, outcomes[index]);
    assert.equal(answered.tasks.forward.attempts, index + 1);
    assert.throws(() => recordFirstAttempt(answered, answered.active, !outcomes[index]));
    assert.deepEqual(answered.tasks.backward, tasks.backward);
    assert.deepEqual(validateProgress(structuredClone(answered)), answered);
    progress = advanceRound(answered);
  }
  assert.equal(progress.tasks.forward.correct, 3);
  assert.deepEqual(progress.initialTasks, tasks);
});

test("research adaptation clamps task-specific bounds and fresh conditions do not inherit another bank", () => {
  for (const task of TASK_IDS) {
    const { minSpan, maxSpan } = getTaskProfile(task, RESEARCH_PROFILE);
    for (const [span, correct] of [[minSpan, false], [maxSpan, true]]) {
      const tasks = createTaskStates(RESEARCH_PROFILE);
      tasks[task].span = span;
      let progress = createProgress(`research-bounds-${task}-${span}`, 8, { profile: RESEARCH_PROFILE, focusedTask: task, tasks });
      while (progress.active) {
        const answered = recordFirstAttempt(progress, progress.active, correct);
        assert.equal(answered.tasks[task].span, span);
        assert.ok(answered.tasks[task].balance >= -4 && answered.tasks[task].balance <= 4);
        assert.deepEqual(validateProgress(structuredClone(answered)), answered);
        progress = advanceRound(answered);
      }
      assert.deepEqual(validateProgress(structuredClone(progress)), progress);
      const otherCondition = createProgress(`new-condition-${task}`, 8, { profile: RESEARCH_PROFILE, focusedTask: task });
      assert.deepEqual(otherCondition.tasks, createTaskStates(RESEARCH_PROFILE));
      assert.equal(otherCondition.tasks[task].attempts, 0);
    }
  }
});

test("research sessions replay-validate every transition and reject incompatible profile or adaptive evidence", () => {
  for (const options of [{ modality: "visual" }, { modality: "audio" }, { digitOrder: "descending" }, { focusedTask: "locations" }]) {
    let progress = createProgress("research-resume", options.focusedTask ? 8 : 24, { ...options, profile: RESEARCH_PROFILE });
    const seen = new Set();
    while (progress.active) {
      assert.deepEqual(validateProgress(structuredClone(progress)), progress);
      assert.ok(!seen.has(progress.active.fingerprint));
      seen.add(progress.active.fingerprint);
      const answered = recordFirstAttempt(progress, progress.active, progress.cursor % 3 !== 0);
      assert.deepEqual(validateProgress(structuredClone(answered)), answered);
      progress = advanceRound(answered);
    }
    assert.deepEqual(validateProgress(structuredClone(progress)), progress);
    for (const mutate of [
      (value) => { delete value.profile; },
      (value) => { value.profile = "unknown"; },
      (value) => { value.initialTasks.forward.balance = 5; },
      (value) => { delete value.initialTasks.forward.balance; },
      (value) => { value.initialTasks.forward.successStreak = 1; },
      (value) => { value.tasks.forward.balance = value.tasks.forward.balance === 0 ? 1 : 0; },
      (value) => { delete value.history[0].round.profile; },
      (value) => { value.tasks.locations.span = 7; },
    ]) {
      const invalid = structuredClone(progress);
      mutate(invalid);
      assert.equal(validateProgress(invalid), null);
    }
  }
});

test("research binding study time scales with encoded items while original sessions keep their timing and identity", () => {
  const original = {
    version: 1, id: "locations-q5cwje", task: "locations", span: 2, gridSize: 4,
    sequence: [1, 5], expected: [4, 8], answerKind: "ordered-cells",
    positions: [12, 4, 10, 6, 7, 8], cues: [1, 5],
    fingerprint: '["locations",[1,5],null,[12,4,10,6,7,8],null]',
  };
  assert.deepEqual(generateRound("locations", 2, "legacy-binding-profile"), original);
  assert.equal(studyDuration(original), 3200);
  assert.equal(studyDuration(original, true), 4800);
  for (let span = 2; span <= 6; span += 1) {
    const round = generateRound("locations", span, "research-study", undefined, "ascending", RESEARCH_PROFILE);
    assert.equal(studyDuration(round), Math.max(5000, span * 1000));
    assert.equal(studyDuration(round, true), Math.max(5000, span * 1000) * 1.5);
  }
  for (let span = 2; span <= 9; span += 1) {
    const originalPattern = generateRound("pattern", span, "pattern-study");
    const researchPattern = generateRound("pattern", span, "pattern-study", undefined, "ascending", RESEARCH_PROFILE);
    assert.equal(studyDuration(originalPattern), studyDuration(researchPattern));
    assert.equal(studyDuration(originalPattern, true), studyDuration(researchPattern, true));
  }
  let legacy = createProgress("legacy-profile-preservation", 8, { focusedTask: "locations" });
  while (legacy.active) {
    assert.equal("profile" in legacy, false);
    assert.equal("profile" in legacy.active, false);
    assert.equal(legacy.active.positions.length, 6);
    assert.deepEqual(validateProgress(structuredClone(legacy)), legacy);
    legacy = advanceRound(recordFirstAttempt(legacy, legacy.active, true));
  }
  assert.equal("profile" in legacy, false);
});
