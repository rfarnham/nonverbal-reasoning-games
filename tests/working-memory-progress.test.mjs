import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_TASK_IDS,
  RESEARCH_PROFILE,
  TASK_IDS,
  advanceRound,
  createProgress,
  createTaskStates,
  recordFirstAttempt,
} from "../app/lab/working-memory/engine.ts";
import {
  digitTaskForVariant,
  enumerateDigitVariants,
} from "../app/lab/working-memory/digit-options.ts";
import {
  conditionKey,
  fresh,
  normalizeSaved,
  restore,
  selectTaskStates,
  taskTotals,
} from "../app/lab/working-memory/progress.ts";

function settings(saved, canonical = true) {
  return { slow: saved.slow, inputMode: saved.inputMode, digitOrder: saved.digitOrder,
    ...(canonical ? { digitVariant: saved.digitVariant } : {}) };
}

function preferences(saved, digitVariant, slow = saved.slow) {
  return normalizeSaved({ ...saved, digitVariant, slow, inputMode: digitVariant.inputMode,
    digitOrder: digitVariant.order === "reverse" ? saved.digitOrder : digitVariant.order });
}

function begin(saved, focusedTask, seed = `${focusedTask}-session`) {
  if (AUDIO_TASK_IDS.includes(focusedTask)) focusedTask = digitTaskForVariant(saved.digitVariant);
  const session = createProgress(seed, 8, {
    focusedTask, tasks: selectTaskStates(saved), digitOrder: saved.digitOrder,
    profile: RESEARCH_PROFILE, digitVariant: saved.digitVariant,
  });
  return normalizeSaved({ ...saved, session, sessionCondition: settings(saved), redeemed: [] });
}

function score(saved, correct) {
  const session = recordFirstAttempt(saved.session, saved.session.active, correct);
  return normalizeSaved({ ...saved, session });
}

function advance(saved) {
  return normalizeSaved({ ...saved, session: advanceRound(saved.session) });
}

function finish(saved, results = Array(8).fill(true)) {
  for (const correct of results) {
    saved = score(saved, correct);
    if (!correct) saved = normalizeSaved({ ...saved, redeemed: [...saved.redeemed, saved.session.active.id] });
    saved = advance(saved);
  }
  return saved;
}

function legacy(session, extra = {}) {
  return { version: 1, session, tasks: session?.tasks ?? createTaskStates(), logs: [], redeemed: [],
    slow: false, digitOrder: "ascending", ...extra };
}

function oldSelected(conditions, context) {
  const tasks = createTaskStates(RESEARCH_PROFILE);
  for (const task of TASK_IDS) if (conditions[conditionKey(task, context)]) tasks[task] = conditions[conditionKey(task, context)];
  return tasks;
}

function previous(conditions = {}, context = { slow: false, inputMode: "keypad", digitOrder: "ascending" }, session = null) {
  return { version: 2, ...context, session, tasks: session?.tasks ?? oldSelected(conditions, context),
    legacyTasks: createTaskStates(), conditions, sessionCondition: session ? context : null, logs: [], redeemed: [] };
}

function digitTotals(saved) {
  const totals = taskTotals(saved);
  return AUDIO_TASK_IDS.reduce((sum, task) => ({ attempts: sum.attempts + totals[task].attempts,
    correct: sum.correct + totals[task].correct }), { attempts: 0, correct: 0 });
}

const learned = (span, attempts, correct, balance = 0) => ({ span, attempts, correct, balance, successStreak: 0 });
const json = (value) => JSON.parse(JSON.stringify(value));

test("fresh schema-three progress stores nine unique digit variants per presentation pace", () => {
  const saved = fresh();
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.digitVariant, { order: "reverse", inputMode: "keypad", keypad: "visible" });
  assert.equal(saved.tasks.forward.span, 3);
  assert.equal(saved.tasks.locations.span, 2);
  assert.equal(saved.legacyTasks.locations.span, 3);
  assert.deepEqual(saved.archivedConditions, {});
  assert.deepEqual(restore(json(saved)), saved);
  const keys = new Set();
  for (const slow of [false, true]) for (const digitVariant of enumerateDigitVariants()) {
    const context = { slow, inputMode: digitVariant.inputMode,
      digitOrder: digitVariant.order === "reverse" ? "ascending" : digitVariant.order, digitVariant };
    const aliases = AUDIO_TASK_IDS.map((task) => conditionKey(task, context));
    assert.equal(new Set(aliases).size, 1);
    keys.add(aliases[0]);
  }
  assert.equal(keys.size, 18);
  assert.deepEqual(taskTotals(saved), Object.fromEntries(TASK_IDS.map((task) => [task, { attempts: 0, correct: 0 }])));
});

test("version-one active saves retain the exact old round and finish on the original staircase", () => {
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
  assert.equal(selectTaskStates(saved).locations.span, 2);
  saved = advance(saved);
  while (saved.session.active) saved = advance(score(saved, true));
  assert.deepEqual(taskTotals(saved).locations, { attempts: 8, correct: 7 });
  assert.equal(saved.session.history[0].correct, false);
  assert.deepEqual(saved.conditions, {});
  assert.deepEqual(saved.archivedConditions, {});
  assert.deepEqual(restore(json(saved)), saved);
  saved = score(begin(saved, "locations", "new-hidden-homes"), true);
  assert.equal(saved.session.active.positions.length, 2);
  assert.equal(saved.legacyTasks.locations.attempts, 8);
  assert.deepEqual(taskTotals(saved).locations, { attempts: 9, correct: 8 });
  assert.deepEqual(restore(json(saved)), saved);
});

test("idle and completed original saves preserve history and old session settings", () => {
  const tasks = createTaskStates();
  tasks.forward = { span: 7, successStreak: 1, attempts: 23, correct: 18 };
  const idle = restore(legacy(null, { tasks, digitOrder: undefined }));
  assert.ok(idle);
  assert.deepEqual(idle.legacyTasks, tasks);
  assert.deepEqual(idle.tasks, createTaskStates(RESEARCH_PROFILE));
  assert.equal(idle.digitOrder, "ascending");
  assert.deepEqual(taskTotals(idle).forward, { attempts: 23, correct: 18 });
  let session = createProgress("old-descending", 8, { focusedTask: "sort-digits", digitOrder: "descending" });
  while (session.active) session = advanceRound(recordFirstAttempt(session, session.active, true));
  const saved = restore(legacy(session, { slow: false, digitOrder: "ascending", logs: [{ id: session.seed,
    date: "2026-10-01T12:00:00Z", rounds: 8, correct: 8, maxSpan: 6, slow: true, digitOrder: "descending", modality: "audio" }] }));
  assert.ok(saved);
  assert.deepEqual(saved.sessionCondition, { slow: true, inputMode: "keypad", digitOrder: "descending" });
  assert.equal(saved.slow, false);
  assert.equal(saved.digitOrder, "ascending");
  assert.deepEqual(normalizeSaved(saved), saved);
  assert.deepEqual(restore(json(saved)), saved);
});

test("version-two research sessions retain exact rounds and finish in their archived banks", () => {
  const context = { slow: false, inputMode: "spoken", digitOrder: "ascending" };
  let session = createProgress("old-spoken-hidden", 8, { focusedTask: "hidden-digits", profile: RESEARCH_PROFILE });
  session = recordFirstAttempt(session, session.active, false);
  const conditions = Object.fromEntries(TASK_IDS.map((task) => [conditionKey(task, context), session.tasks[task]]));
  const old = previous(conditions, context, session);
  old.redeemed = [session.active.id];
  let saved = restore(old);
  assert.ok(saved);
  assert.deepEqual(saved.session, session);
  assert.equal(saved.sessionCondition.digitVariant, undefined);
  assert.deepEqual(saved.archivedConditions, conditions);
  assert.deepEqual(digitTotals(saved), { attempts: 1, correct: 0 });
  saved = advance(saved);
  while (saved.session.active) saved = advance(score(saved, true));
  assert.deepEqual(digitTotals(saved), { attempts: 8, correct: 7 });
  assert.equal(saved.archivedConditions[conditionKey("hidden-digits", context)].attempts, 8);
  assert.equal(selectTaskStates(saved)["reverse-digits"].attempts, 0);
  assert.deepEqual(restore(json(saved)), saved);
  saved = score(begin(saved, "reverse-digits", "unified-spoken"), true);
  assert.equal(saved.session.active.task, "reverse-digits");
  assert.deepEqual(digitTotals(saved), { attempts: 9, correct: 8 });
  assert.deepEqual(restore(json(saved)), saved);
});

test("migration seeds a uniquely played predecessor without counting its history twice", () => {
  const context = { slow: false, inputMode: "spoken", digitOrder: "ascending" };
  const conditions = {
    [conditionKey("reverse-digits", context)]: learned(6, 20, 15, 2),
    [conditionKey("hidden-digits", context)]: learned(2, 0, 0),
    [conditionKey("sort-digits", context)]: learned(5, 12, 9, -1),
  };
  let saved = restore(previous(conditions, context));
  assert.ok(saved);
  const selected = selectTaskStates(saved);
  assert.deepEqual(selected["reverse-digits"], learned(6, 0, 0, 2));
  assert.deepEqual(selected["hidden-digits"], selected["reverse-digits"]);
  assert.deepEqual(digitTotals(saved), { attempts: 32, correct: 24 });
  assert.deepEqual(saved.archivedConditions, conditions);
  saved = score(begin(saved, "reverse-digits"), true);
  assert.deepEqual(digitTotals(saved), { attempts: 33, correct: 25 });
  assert.deepEqual(restore(json(saved)), saved);
});

test("independently played spoken aliases archive both trajectories and start one fresh controller", () => {
  const context = { slow: false, inputMode: "spoken", digitOrder: "ascending" };
  const conditions = {
    [conditionKey("reverse-digits", context)]: learned(6, 20, 15, 2),
    [conditionKey("hidden-digits", context)]: learned(4, 12, 8, -3),
  };
  const saved = restore(previous(conditions, context));
  assert.ok(saved);
  assert.deepEqual(selectTaskStates(saved)["reverse-digits"], learned(2, 0, 0));
  assert.deepEqual(saved.archivedConditions, conditions);
  assert.deepEqual(digitTotals(saved), { attempts: 32, correct: 23 });
  assert.deepEqual(restore(json(saved)), saved);
});

test("unplayed predecessor records cannot carry arbitrary adaptive loads into a new controller", () => {
  const context = { slow: false, inputMode: "spoken", digitOrder: "ascending" };
  const conditions = { [conditionKey("reverse-digits", context)]: learned(8, 0, 0, 4) };
  const saved = restore(previous(conditions, context));
  assert.ok(saved);
  assert.deepEqual(selectTaskStates(saved)["reverse-digits"], learned(2, 0, 0));
  assert.deepEqual(digitTotals(saved), { attempts: 0, correct: 0 });
});

test("visual research history also archives once and seeds only its own adaptive condition", () => {
  const context = { slow: false, inputMode: "keypad", digitOrder: "ascending" };
  let saved = restore(previous({ [conditionKey("forward", context)]: learned(6, 23, 18, 2) }));
  assert.ok(saved);
  assert.deepEqual(selectTaskStates(saved).forward, learned(6, 0, 0, 2));
  assert.deepEqual(taskTotals(saved).forward, { attempts: 23, correct: 18 });
  saved = score(begin(saved, "forward"), true);
  assert.deepEqual(taskTotals(saved).forward, { attempts: 24, correct: 19 });
  assert.equal(saved.archivedConditions[conditionKey("forward", context)].attempts, 23);
  assert.deepEqual(restore(json(saved)), saved);
});

test("finishing an old session never overwrites an already played canonical trajectory", () => {
  const context = { slow: false, inputMode: "spoken", digitOrder: "ascending" };
  const session = createProgress("old-retained", 8, { focusedTask: "hidden-digits", profile: RESEARCH_PROFILE });
  let saved = restore(previous({}, context, session));
  const key = conditionKey("reverse-digits", saved);
  const played = learned(7, 10, 8, 3);
  saved.conditions[key] = played;
  saved = score(saved, true);
  assert.deepEqual(saved.conditions[key], played);
  assert.equal(saved.archivedConditions[conditionKey("hidden-digits", context)].attempts, 1);
  assert.deepEqual(digitTotals(saved), { attempts: 11, correct: 9 });
  assert.deepEqual(restore(json(saved)), saved);
});

test("canonical digit variants isolate recall rule, keypad visibility, input and presentation pace", () => {
  let saved = finish(begin(fresh(), "forward"));
  const visual = selectTaskStates(saved).forward;
  const variants = enumerateDigitVariants();
  for (const [index, variant] of variants.entries()) {
    saved = preferences(saved, variant);
    const selected = selectTaskStates(saved);
    assert.equal(selected["reverse-digits"].attempts, 0);
    assert.deepEqual(selected.forward, visual);
    saved = finish(begin(saved, "reverse-digits", `variant-${index}`));
    const after = selectTaskStates(saved);
    assert.equal(after["reverse-digits"].attempts, 8);
    assert.deepEqual(after["reverse-digits"], after["hidden-digits"]);
    assert.deepEqual(after["reverse-digits"], after["sort-digits"]);
    assert.deepEqual(restore(json(saved)), saved);
  }
  assert.deepEqual(digitTotals(saved), { attempts: 72, correct: 72 });
  for (const variant of variants) {
    saved = preferences(saved, variant);
    assert.equal(selectTaskStates(saved)["reverse-digits"].attempts, 8);
  }
  saved = preferences(saved, saved.digitVariant, true);
  assert.equal(selectTaskStates(saved)["reverse-digits"].attempts, 0);
  assert.equal(selectTaskStates(saved).forward.attempts, 0);
  assert.deepEqual(digitTotals(saved), { attempts: 72, correct: 72 });
});

test("only session participants update banks, avoiding duplicate-alias clobbering", () => {
  let saved = score(begin(fresh(), "reverse-digits"), true);
  const key = conditionKey("reverse-digits", saved);
  assert.equal(Object.keys(saved.conditions).length, 1);
  assert.equal(saved.conditions[key].attempts, 1);
  assert.equal(saved.session.tasks["hidden-digits"].attempts, 0);
  assert.equal(saved.session.tasks["sort-digits"].attempts, 0);
  assert.equal(selectTaskStates(saved)["hidden-digits"].attempts, 1);
  assert.deepEqual(digitTotals(saved), { attempts: 1, correct: 1 });
  saved = advance(saved);
  assert.equal(saved.conditions[key].attempts, 1);
  assert.deepEqual(restore(json(saved)), saved);
});

test("visual-only sessions use canonical snapshots even though engine omits irrelevant digit options", () => {
  let saved = begin(fresh(), "forward");
  assert.equal(saved.session.digitVariant, undefined);
  assert.ok(saved.sessionCondition.digitVariant);
  saved = score(saved, true);
  assert.deepEqual(Object.keys(saved.conditions), [conditionKey("forward", saved)]);
  assert.deepEqual(saved.archivedConditions, {});
  assert.deepEqual(restore(json(saved)), saved);
});

test("completed snapshots cannot contaminate another variant or pace after preferences change", () => {
  let saved = finish(begin(fresh(), "reverse-digits"));
  const original = structuredClone(saved.conditions);
  saved = preferences(saved, { order: "descending", inputMode: "spoken", keypad: "none" }, true);
  saved = normalizeSaved(saved);
  assert.deepEqual(saved.conditions, original);
  assert.deepEqual(saved.sessionCondition.digitVariant, { order: "reverse", inputMode: "keypad", keypad: "visible" });
  assert.equal(selectTaskStates(saved)["reverse-digits"].attempts, 0);
  assert.deepEqual(digitTotals(saved), { attempts: 8, correct: 8 });
  assert.deepEqual(restore(json(saved)), saved);
  saved = normalizeSaved({ ...saved, session: null, redeemed: [] });
  assert.equal(saved.sessionCondition, null);
  assert.deepEqual(saved.tasks, selectTaskStates(saved));
  assert.deepEqual(digitTotals(saved), { attempts: 8, correct: 8 });
});

test("replay preserves the miss and archived/new totals aggregate only once", () => {
  const old = previous({ "hidden-digits|standard|keypad|none": learned(4, 5, 3) });
  let saved = restore(old);
  saved = preferences(saved, { order: "reverse", inputMode: "keypad", keypad: "hidden" });
  saved = score(begin(saved, "hidden-digits"), false);
  const missedId = saved.session.active.id;
  const bank = conditionKey("hidden-digits", saved);
  const recorded = structuredClone(saved.conditions[bank]);
  saved = normalizeSaved({ ...saved, redeemed: [missedId] });
  saved = advance(saved);
  assert.deepEqual(saved.conditions[bank], recorded);
  assert.equal(saved.session.history[0].correct, false);
  assert.deepEqual(digitTotals(saved), { attempts: 6, correct: 3 });
  assert.deepEqual(saved.redeemed, [missedId]);
  assert.deepEqual(restore(json(saved)), saved);
});

test("version-two migration validates its original full bank/session consistency first", () => {
  const context = { slow: false, inputMode: "keypad", digitOrder: "ascending" };
  const session = createProgress("old-research", 8, { focusedTask: "forward", profile: RESEARCH_PROFILE });
  const old = previous({}, context, session);
  assert.ok(restore(old));
  old.conditions[conditionKey("rotation", context)] = learned(8, 40, 30);
  assert.equal(restore(old), null);
});

test("restoration rejects noncanonical options, wrong schemas, corrupt banks and inconsistent snapshots", () => {
  const original = score(begin(fresh(), "locations"), false);
  const bank = conditionKey("locations", original);
  const mutations = [
    (saved) => { saved.version = 4; },
    (saved) => { saved.inputMode = "remote"; },
    (saved) => { saved.digitVariant.keypad = "none"; },
    (saved) => { saved.digitVariant.extra = true; },
    (saved) => { saved.digitVariant = { order: "reverse", inputMode: "spoken", keypad: "visible" }; saved.inputMode = "spoken"; },
    (saved) => { saved.sessionCondition = null; },
    (saved) => { delete saved.sessionCondition.digitVariant; },
    (saved) => { saved.slow = true; },
    (saved) => { saved.conditions[bank].correct = 2; },
    (saved) => { saved.conditions[bank].attempts = -1; },
    (saved) => { saved.conditions[bank].attempts = 1_000_001; },
    (saved) => { saved.conditions[bank].balance = 5; },
    (saved) => { saved.conditions[bank].span = 7; },
    (saved) => { saved.conditions["locations|standard|spoken|none"] = saved.conditions[bank]; },
    (saved) => { saved.conditions["reverse-digits|standard|keypad|none"] = learned(2, 0, 0); },
    (saved) => { saved.archivedConditions["digits|standard|reverse|keypad|visible"] = learned(2, 0, 0); },
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
  const audio = begin(fresh(), "reverse-digits");
  audio.sessionCondition.digitVariant.keypad = "hidden";
  assert.equal(restore(audio), null);
  assert.throws(() => normalizeSaved({ ...original, inputMode: "spoken" }));
});

test("new logs record canonical digit metadata while legacy log fields remain readable", () => {
  const saved = finish(begin(fresh(), "reverse-digits"), [true, false, true, false, true, true, false, true]);
  saved.logs = [{ id: saved.session.seed, date: "2026-10-18T12:00:00Z", rounds: 8, correct: 5,
    maxSpan: 2, slow: false, modality: "audio", profile: RESEARCH_PROFILE, inputMode: "keypad", digitVariant: saved.digitVariant }];
  assert.deepEqual(restore(json(saved)), saved);
  assert.deepEqual(digitTotals(saved), { attempts: 8, correct: 5 });
  for (const field of ["profile", "inputMode", "digitOrder", "digitVariant"]) {
    const broken = structuredClone(saved);
    broken.logs[0][field] = "unknown";
    assert.equal(restore(broken), null);
  }
});
