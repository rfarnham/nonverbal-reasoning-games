import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_PROFILE,
  TASK_IDS,
  advanceRound,
  createProgress,
  createTaskStates,
  recordFirstAttempt,
} from "../app/lab/working-memory/engine.ts";
import {
  conditionKey,
  fresh,
  normalizeSaved,
  restore,
  selectTaskStates,
  taskTotals,
} from "../app/lab/working-memory/progress.ts";

function settings(saved) {
  return { slow: saved.slow, inputMode: saved.inputMode, digitOrder: saved.digitOrder };
}

function begin(saved, focusedTask, seed = `${focusedTask}-session`) {
  const session = createProgress(seed, 8, {
    focusedTask,
    tasks: selectTaskStates(saved),
    digitOrder: saved.digitOrder,
    profile: RESEARCH_PROFILE,
  });
  return normalizeSaved({ ...saved, session, sessionCondition: settings(saved), redeemed: [] });
}

function score(saved, correct) {
  const session = recordFirstAttempt(saved.session, saved.session.active, correct);
  return normalizeSaved({ ...saved, session });
}

function finish(saved, results = Array(8).fill(true)) {
  for (const correct of results) {
    saved = score(saved, correct);
    if (!correct) saved = normalizeSaved({ ...saved, redeemed: [...saved.redeemed, saved.session.active.id] });
    saved = normalizeSaved({ ...saved, session: advanceRound(saved.session) });
  }
  return saved;
}

function legacy(session, extra = {}) {
  return {
    version: 1,
    session,
    tasks: session?.tasks ?? createTaskStates(),
    logs: [],
    redeemed: [],
    slow: false,
    digitOrder: "ascending",
    ...extra,
  };
}

test("fresh progress has independent research and legacy records and round-trips strictly", () => {
  const saved = fresh();
  assert.equal(saved.version, 2);
  assert.equal(saved.tasks.forward.span, 3);
  assert.equal(saved.tasks.locations.span, 2);
  assert.equal(saved.tasks.locations.balance, 0);
  assert.equal(saved.legacyTasks.locations.span, 3);
  assert.equal(saved.legacyTasks.locations.balance, undefined);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(taskTotals(saved), Object.fromEntries(TASK_IDS.map((task) => [task, { attempts: 0, correct: 0 }])));
});

test("version-one active saves retain the exact old round and finish on the old staircase", () => {
  let session = createProgress("old-hidden-homes", 8, { focusedTask: "locations" });
  session = recordFirstAttempt(session, session.active, false);
  const original = legacy(session, { redeemed: [session.active.id], slow: true });
  let saved = restore(original);
  assert.ok(saved);
  assert.deepEqual(saved.session, original.session);
  assert.deepEqual(saved.tasks, original.tasks);
  assert.deepEqual(saved.legacyTasks, original.tasks);
  assert.deepEqual(saved.redeemed, original.redeemed);
  assert.deepEqual(saved.sessionCondition, { slow: true, inputMode: "keypad", digitOrder: "ascending" });
  assert.equal(saved.session.profile, undefined);
  assert.equal(saved.session.active.positions.length, 6);
  assert.deepEqual(saved.conditions, {});
  assert.equal(selectTaskStates(saved).locations.span, 2);

  saved = normalizeSaved({ ...saved, session: advanceRound(saved.session) });
  while (saved.session.active) {
    saved = score(saved, true);
    saved = normalizeSaved({ ...saved, session: advanceRound(saved.session) });
  }
  assert.equal(saved.legacyTasks.locations.attempts, 8);
  assert.equal(saved.legacyTasks.locations.correct, 7);
  assert.equal(saved.session.history[0].correct, false);
  assert.deepEqual(saved.redeemed, original.redeemed);
  assert.deepEqual(saved.conditions, {});
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);

  saved = begin(saved, "locations", "new-hidden-homes");
  assert.equal(saved.session.profile, RESEARCH_PROFILE);
  assert.equal(saved.session.active.span, 2);
  assert.equal(saved.session.active.positions.length, 2);
  assert.equal(saved.legacyTasks.locations.attempts, 8);
  assert.equal(saved.session.tasks.locations.attempts, 0);
  assert.deepEqual(taskTotals(saved).locations, { attempts: 8, correct: 7 });
  saved = score(saved, true);
  assert.deepEqual(taskTotals(saved).locations, { attempts: 9, correct: 8 });
  assert.equal(saved.legacyTasks.locations.attempts, 8);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);
});

test("idle and complete version-one saves archive legacy history without copying its load into research", () => {
  const tasks = createTaskStates();
  tasks.forward = { span: 7, successStreak: 1, attempts: 23, correct: 18 };
  const oldLog = { id: "older", date: "2026-10-01T12:00:00Z", rounds: 24, correct: 18, maxSpan: 7, slow: false, modality: "mixed" };
  const idle = restore(legacy(null, { tasks, logs: [oldLog], digitOrder: undefined }));
  assert.ok(idle);
  assert.deepEqual(idle.legacyTasks, tasks);
  assert.deepEqual(idle.tasks, createTaskStates(RESEARCH_PROFILE));
  assert.deepEqual(idle.logs, [oldLog]);
  assert.equal(idle.digitOrder, "ascending");
  assert.equal(idle.sessionCondition, null);
  assert.deepEqual(taskTotals(idle).forward, { attempts: 23, correct: 18 });

  let session = createProgress("finished-old", 8, { focusedTask: "reverse-digits" });
  while (session.active) session = advanceRound(recordFirstAttempt(session, session.active, true));
  const completed = restore(legacy(session));
  assert.ok(completed);
  assert.deepEqual(completed.session, session);
  assert.equal(completed.tasks["reverse-digits"].attempts, 8);
  assert.equal(selectTaskStates(completed)["reverse-digits"].attempts, 0);
});

test("completed legacy sessions retain their old settings after the player changes preferences", () => {
  let session = createProgress("old-descending", 8, { focusedTask: "sort-digits", digitOrder: "descending" });
  while (session.active) session = advanceRound(recordFirstAttempt(session, session.active, true));
  const saved = restore(legacy(session, {
    slow: false,
    digitOrder: "ascending",
    logs: [{ id: session.seed, date: "2026-10-01T12:00:00Z", rounds: 8, correct: 8, maxSpan: 6, slow: true, digitOrder: "descending", modality: "audio" }],
  }));
  assert.ok(saved);
  assert.deepEqual(saved.sessionCondition, { slow: true, inputMode: "keypad", digitOrder: "descending" });
  assert.equal(saved.slow, false);
  assert.equal(saved.digitOrder, "ascending");
  assert.deepEqual(normalizeSaved(saved), saved);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);
});

test("input mode and sorting direction only separate the task conditions they change", () => {
  let saved = finish(begin(fresh(), "forward"));
  saved = finish(begin(saved, "reverse-digits"));
  saved = finish(begin(saved, "sort-digits"));
  const normal = selectTaskStates(saved);
  assert.equal(normal.forward.attempts, 8);
  assert.equal(normal["reverse-digits"].attempts, 8);
  assert.equal(normal["sort-digits"].attempts, 8);

  saved = normalizeSaved({ ...saved, digitOrder: "descending" });
  let chosen = selectTaskStates(saved);
  assert.deepEqual(chosen.forward, normal.forward);
  assert.deepEqual(chosen["reverse-digits"], normal["reverse-digits"]);
  assert.equal(chosen["sort-digits"].attempts, 0);
  assert.equal(saved.sessionCondition.digitOrder, "ascending");
  assert.equal(saved.tasks["sort-digits"].attempts, 8);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);
  saved = finish(begin(saved, "sort-digits", "descending-sort"));

  saved = normalizeSaved({ ...saved, inputMode: "spoken" });
  chosen = selectTaskStates(saved);
  assert.deepEqual(chosen.forward, normal.forward);
  assert.equal(chosen["reverse-digits"].attempts, 0);
  assert.equal(chosen["sort-digits"].attempts, 0);
  saved = finish(begin(saved, "reverse-digits", "spoken-reversal"));
  saved = normalizeSaved({ ...saved, inputMode: "keypad", digitOrder: "ascending" });
  assert.deepEqual(selectTaskStates(saved), normal);
  assert.deepEqual(taskTotals(saved)["reverse-digits"], { attempts: 16, correct: 16 });
  assert.deepEqual(taskTotals(saved)["sort-digits"], { attempts: 16, correct: 16 });

  saved = normalizeSaved({ ...saved, slow: true });
  chosen = selectTaskStates(saved);
  assert.equal(chosen.forward.attempts, 0);
  assert.equal(chosen["reverse-digits"].attempts, 0);
  saved = finish(begin(saved, "forward", "slow-forward"));
  saved = normalizeSaved({ ...saved, slow: false });
  assert.deepEqual(selectTaskStates(saved), normal);
  assert.deepEqual(taskTotals(saved).forward, { attempts: 16, correct: 16 });
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);
});

test("the completed session snapshot prevents later settings from contaminating other banks", () => {
  let saved = finish(begin(fresh(), "reverse-digits"));
  const original = structuredClone(saved.conditions);
  saved = normalizeSaved({ ...saved, slow: true, inputMode: "spoken", digitOrder: "descending" });
  saved = normalizeSaved(saved);
  assert.deepEqual(saved.conditions, original);
  assert.deepEqual(saved.sessionCondition, { slow: false, inputMode: "keypad", digitOrder: "ascending" });
  assert.equal(selectTaskStates(saved)["reverse-digits"].attempts, 0);
  assert.equal(taskTotals(saved)["reverse-digits"].attempts, 8);
  assert.ok(restore(saved));

  saved = normalizeSaved({ ...saved, session: null, redeemed: [] });
  assert.equal(saved.sessionCondition, null);
  assert.deepEqual(saved.tasks, selectTaskStates(saved));
  assert.equal(taskTotals(saved)["reverse-digits"].attempts, 8);
  assert.ok(restore(saved));
});

test("replaying a miss preserves first-attempt totals and banks across reload", () => {
  let saved = score(begin(fresh(), "hidden-digits"), false);
  const missedId = saved.session.active.id;
  const bank = conditionKey("hidden-digits", saved);
  const recorded = structuredClone(saved.conditions[bank]);
  assert.deepEqual(taskTotals(saved)["hidden-digits"], { attempts: 1, correct: 0 });
  saved = normalizeSaved({ ...saved, redeemed: [missedId] });
  saved = normalizeSaved({ ...saved, session: advanceRound(saved.session) });
  assert.deepEqual(saved.conditions[bank], recorded);
  assert.equal(saved.session.history[0].correct, false);
  assert.deepEqual(saved.redeemed, [missedId]);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(saved))), saved);
});

test("condition keys ignore irrelevant preferences and cover only the supported schema", () => {
  const base = { slow: false, inputMode: "keypad", digitOrder: "ascending" };
  assert.equal(conditionKey("forward", base), conditionKey("forward", { ...base, inputMode: "spoken", digitOrder: "descending" }));
  assert.equal(conditionKey("reverse-digits", base), conditionKey("reverse-digits", { ...base, digitOrder: "descending" }));
  assert.notEqual(conditionKey("reverse-digits", base), conditionKey("reverse-digits", { ...base, inputMode: "spoken" }));
  assert.notEqual(conditionKey("sort-digits", base), conditionKey("sort-digits", { ...base, digitOrder: "descending" }));
  for (const task of TASK_IDS) assert.notEqual(conditionKey(task, base), conditionKey(task, { ...base, slow: true }));
  assert.throws(() => conditionKey("unknown", base));
  assert.throws(() => conditionKey("forward", { ...base, inputMode: "remote" }));
});

test("restoration rejects corrupt counters, banks, snapshots, first-attempt history and redemptions", () => {
  const original = score(begin(fresh(), "locations"), false);
  const bank = conditionKey("locations", original);
  const mutations = [
    (saved) => { saved.version = 3; },
    (saved) => { saved.inputMode = "remote"; },
    (saved) => { saved.sessionCondition = null; },
    (saved) => { saved.sessionCondition.inputMode = "spoken"; },
    (saved) => { saved.slow = true; },
    (saved) => { saved.conditions[bank].correct = 2; },
    (saved) => { saved.conditions[bank].attempts = -1; },
    (saved) => { saved.conditions[bank].attempts = 1_000_001; },
    (saved) => { saved.conditions[bank].balance = 5; },
    (saved) => { saved.conditions[bank].span = 7; },
    (saved) => { saved.conditions["locations|standard|spoken|none"] = saved.conditions[bank]; },
    (saved) => { saved.conditions["sort-digits|standard|keypad|none"] = saved.conditions[bank]; },
    (saved) => { delete saved.conditions[bank]; },
    (saved) => { saved.tasks.locations.attempts = 0; },
    (saved) => { saved.legacyTasks.locations.correct = 1; },
    (saved) => { saved.session.history[0].correct = true; },
    (saved) => { saved.redeemed = ["not-a-round"]; },
    (saved) => { saved.redeemed = [saved.session.active.id, saved.session.active.id]; },
    (saved) => { saved.logs = [{ id: "bad" }]; },
  ];
  for (const mutate of mutations) {
    const saved = structuredClone(original);
    mutate(saved);
    assert.equal(restore(saved), null, mutate.toString());
  }
  const complete = finish(begin(fresh(), "sort-digits"));
  complete.sessionCondition.digitOrder = "descending";
  assert.equal(restore(complete), null);
  assert.throws(() => normalizeSaved({ ...original, inputMode: "spoken" }));
});

test("logs retain legacy fields and distinguish research/input conditions without changing scores", () => {
  const saved = finish(begin(fresh(), "reverse-digits"), [true, false, true, false, true, true, false, true]);
  saved.logs = [{
    id: saved.session.seed,
    date: "2026-10-18T12:00:00Z",
    rounds: 8,
    correct: 5,
    maxSpan: 2,
    slow: false,
    modality: "audio",
    profile: RESEARCH_PROFILE,
    inputMode: "keypad",
  }];
  const restored = restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored, saved);
  assert.deepEqual(taskTotals(restored)["reverse-digits"], { attempts: 8, correct: 5 });
  for (const field of ["profile", "inputMode", "digitOrder"]) {
    const broken = structuredClone(saved);
    broken.logs[0][field] = "unknown";
    assert.equal(restore(broken), null);
  }
});
