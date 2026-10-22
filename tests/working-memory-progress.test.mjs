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
  recordRetryAttempt,
} from "../app/lab/working-memory/engine.ts";
import { COMFORT_ADAPTATION } from "../app/lab/working-memory/comfort-adaptation.ts";
import {
  digitTaskForVariant,
  enumerateDigitVariants,
} from "../app/lab/working-memory/digit-options.ts";
import {
  canResumePractice,
  conditionKey,
  fresh,
  normalizeSaved,
  restore,
  selectTaskStates,
  taskTotals,
} from "../app/lab/working-memory/progress.ts";
import { getMemoryRewards } from "../app/lab/working-memory/rewards.ts";

function settings(saved, canonical = true) {
  return { slow: saved.slow, inputMode: saved.inputMode, digitOrder: saved.digitOrder,
    ...(canonical ? { digitVariant: saved.digitVariant } : {}) };
}

function preferences(saved, digitVariant, slow = saved.slow) {
  return normalizeSaved({ ...saved, digitVariant, slow, inputMode: digitVariant.inputMode,
    digitOrder: digitVariant.order === "reverse" ? saved.digitOrder : digitVariant.order });
}

function begin(saved, focusedTask, seed = `${focusedTask}-session`, options = {}) {
  if (AUDIO_TASK_IDS.includes(focusedTask)) focusedTask = digitTaskForVariant(saved.digitVariant);
  const session = createProgress(seed, 8, {
    focusedTask, tasks: selectTaskStates(saved), digitOrder: saved.digitOrder,
    profile: RESEARCH_PROFILE, digitVariant: saved.digitVariant, ...options,
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

function retry(saved, correct) {
  return normalizeSaved({ ...saved, session: recordRetryAttempt(saved.session, saved.session.active, correct) });
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
    (saved) => { saved.sessionCondition.slow = true; },
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

test("optional buddy preference stays with valid encrypted progress without changing its schema or totals", () => {
  const original = score(begin(fresh(), "locations"), false);
  assert.equal(Object.hasOwn(original, "buddy"), false);
  const selected = normalizeSaved({ ...original, buddy: "hedgehog" });
  const restored = restore(json(selected));
  assert.ok(restored);
  assert.equal(restored.version, 3);
  assert.equal(restored.buddy, "hedgehog");
  assert.deepEqual(taskTotals(restored), taskTotals(original));
  assert.deepEqual(restored.session, original.session);
  assert.deepEqual(restore(json({ ...selected, buddy: "future-bundled-animal" })).buddy, "future-bundled-animal", "the UI, not the progress format, owns the allowed animal IDs");
  const withoutBuddy = restore(json(original));
  assert.deepEqual(withoutBuddy, original, "old schema-three saves do not acquire an unnecessary new field");
  const reset = fresh();
  assert.equal(Object.hasOwn(reset, "buddy"), false);
  assert.deepEqual(taskTotals(reset).locations, { attempts: 0, correct: 0 });
});

test("malformed optional buddy preference is ignored without losing valid earned progress", () => {
  const original = score(begin(fresh(), "locations"), true);
  for (const buddy of [null, 42, false, {}, [], "", "   ", "x".repeat(65)]) {
    const restored = restore({ ...json(original), buddy });
    assert.ok(restored, `cosmetic corruption ${JSON.stringify(buddy)} must not erase practice`);
    assert.equal(Object.hasOwn(restored, "buddy"), false);
    assert.deepEqual(restored, original);
  }
  const bounded = restore({ ...json(original), buddy: "x".repeat(64) });
  assert.equal(bounded.buddy.length, 64);
});

test("both scored responses survive save and reload without changing first-attempt totals", () => {
  let saved = begin(fresh(), "locations", "retained-second-attempt", { adaptation: COMFORT_ADAPTATION });
  const round = structuredClone(saved.session.active);
  saved = score(saved, false);
  const first = structuredClone(saved);
  assert.deepEqual(restore(json(first)), first, "a pause after the first miss retains one available response");
  saved = retry(restore(json(first)), false);
  const second = structuredClone(saved);
  assert.deepEqual(saved.session.active, round);
  assert.equal(saved.session.history[0].correct, false);
  assert.equal(saved.session.history[0].retryCorrect, false);
  assert.deepEqual(saved.session.tasks, first.session.tasks, "the second response cannot update adaptation or accuracy");
  assert.deepEqual(taskTotals(saved), taskTotals(first));
  saved = restore(json(saved));
  assert.deepEqual(saved, second, "pause, lock, or reload cannot grant another scored response");
  saved = advance(saved);
  assert.equal(saved.session.cursor, 1);
  assert.equal(saved.session.history[0].retryCorrect, false);
  assert.deepEqual(saved.redeemed, []);
  assert.deepEqual(taskTotals(saved).locations, { attempts: 1, correct: 0 });
  assert.deepEqual(restore(json(saved)), saved);
  assert.equal(restore({ ...second, redeemed: [round.id] }), null, "an exhausted miss is never a redeemed answer");

  let redeemed = retry(restore(json(first)), true);
  redeemed = normalizeSaved({ ...redeemed, redeemed: [round.id] });
  assert.deepEqual(restore(json(redeemed)), redeemed);
  assert.equal(redeemed.session.history[0].correct, false);
  assert.equal(redeemed.session.history[0].retryCorrect, true);
  assert.deepEqual(taskTotals(redeemed), taskTotals(first));
});

function retainedOldSession(version) {
  const context = { slow: false, inputMode: "keypad", digitOrder: "ascending" };
  const tasks = createTaskStates(version === 1 ? undefined : RESEARCH_PROFILE);
  tasks.locations = { span: 6, successStreak: 0, attempts: 20, correct: 19,
    ...(version === 1 ? {} : { balance: 0 }) };
  let session = createProgress(`saved-${version}-old-prefix`, 8, {
    focusedTask: "locations", tasks, ...(version === 1 ? {} : { profile: RESEARCH_PROFILE }),
  });
  session = advanceRound(recordFirstAttempt(session, session.active, true));
  session = recordFirstAttempt(session, session.active, false);
  if (version === 1) return legacy(session, { buddy: "fox" });
  if (version === 2) {
    const conditions = Object.fromEntries(TASK_IDS.map((task) => [conditionKey(task, context), session.tasks[task]]));
    conditions[conditionKey("hidden-digits", { ...context, slow: true })] = learned(4, 7, 6);
    return { ...previous(conditions, context, session), buddy: "fox" };
  }
  let saved = fresh();
  saved.conditions[conditionKey("locations", saved)] = tasks.locations;
  saved.archivedConditions[conditionKey("hidden-digits", { ...context, slow: true })] = learned(4, 7, 6);
  saved.legacyTasks.forward = { span: 4, successStreak: 0, attempts: 3, correct: 2 };
  saved = begin(saved, "locations", `saved-${version}-old-prefix`);
  saved = advance(score(saved, true));
  return { ...score(saved, false), buddy: "fox" };
}

test("old schema-one, two, and three active rounds upgrade only after the retained question", () => {
  for (const version of [1, 2, 3]) {
    const original = retainedOldSession(version);
    let saved = restore(json(original));
    assert.ok(saved, `schema ${version}`);
    assert.deepEqual(saved.session, original.session, `schema ${version} must preserve the round and old prefix exactly`);
    assert.equal(saved.session.adaptation, undefined);
    assert.equal(saved.session.active.span, 6);
    const before = taskTotals(saved);
    const archived = structuredClone(saved.archivedConditions);
    const legacyForward = structuredClone(saved.legacyTasks.forward);
    saved = retry(saved, false);
    assert.deepEqual(taskTotals(saved), before);
    assert.deepEqual(restore(json(saved)), saved, "the exhausted retained question must survive an interrupted advance");
    const prefix = structuredClone(saved.session.history);
    saved = normalizeSaved({ ...saved, session: advanceRound(saved.session, { upgradeAdaptation: true }) });
    assert.equal(saved.session.adaptation, COMFORT_ADAPTATION);
    assert.equal(saved.session.comfortFrom, 2);
    assert.equal(saved.session.cursor, 2);
    assert.equal(saved.session.active.span, 5, "a missed old span gets a gentler next question");
    assert.equal(saved.session.tasks.locations.comfortSpan, 5);
    assert.deepEqual(saved.session.history, prefix, "upgrade must not reinterpret either old first-attempt record");
    assert.equal(saved.buddy, "fox");
    assert.deepEqual(saved.legacyTasks.forward, legacyForward);
    assert.deepEqual(taskTotals(saved), before, "controller migration cannot create practice, correct answers, or XP");
    for (const [key, state] of Object.entries(archived)) {
      if (key !== conditionKey("locations", saved.sessionCondition)) assert.deepEqual(saved.archivedConditions[key], state);
    }
    assert.deepEqual(restore(json(saved)), saved, `schema ${version} must replay the original prefix and upgraded boundary`);
    saved = score(saved, true);
    assert.equal(taskTotals(saved).locations.attempts, before.locations.attempts + 1);
    assert.equal(taskTotals(saved).locations.correct, before.locations.correct + 1);
    assert.deepEqual(restore(json(saved)), saved);
  }
});

test("legacy redemptions remain valid when the saved question has no second-response marker", () => {
  for (const version of [1, 2, 3]) {
    const original = retainedOldSession(version);
    original.redeemed = [original.session.active.id];
    const saved = restore(json(original));
    assert.ok(saved);
    assert.equal(saved.session.history.at(-1).retryCorrect, undefined);
    assert.deepEqual(saved.redeemed, original.redeemed);
    const upgraded = normalizeSaved({ ...saved, session: advanceRound(saved.session, { upgradeAdaptation: true }) });
    assert.deepEqual(restore(json(upgraded)), upgraded);
    assert.deepEqual(upgraded.redeemed, original.redeemed);
  }
});

test("comfort controllers remain independent across digit conditions and reuse played state", () => {
  let saved = begin(fresh(), "reverse-digits", "comfortable-keypad", { adaptation: COMFORT_ADAPTATION });
  saved = advance(score(saved, true));
  saved = retry(score(saved, false), false);
  saved = advance(saved);
  const keypad = { ...saved.conditions[conditionKey("reverse-digits", saved)] };
  assert.equal(typeof keypad.comfortSpan, "number");
  assert.equal(keypad.attempts, 2);
  const keypadKey = conditionKey("reverse-digits", saved);
  saved = normalizeSaved({ ...saved, session: null, redeemed: [] });
  saved = preferences(saved, { order: "reverse", inputMode: "spoken", keypad: "none" });
  assert.equal(selectTaskStates(saved)["reverse-digits"].comfortSpan, undefined, "unplayed conditions retain an independent starting point");
  saved = begin(saved, "reverse-digits", "comfortable-spoken", { adaptation: COMFORT_ADAPTATION });
  saved = advance(retry(score(saved, false), false));
  const spoken = { ...saved.conditions[conditionKey("reverse-digits", saved)] };
  assert.equal(spoken.attempts, 1);
  assert.deepEqual(saved.conditions[keypadKey], keypad);
  assert.deepEqual(digitTotals(saved), { attempts: 3, correct: 1 });
  assert.deepEqual(restore(json(saved)), saved);
  saved = normalizeSaved({ ...saved, session: null, redeemed: [] });
  saved = preferences(saved, saved.digitVariant, true);
  assert.equal(selectTaskStates(saved)["reverse-digits"].comfortSpan, undefined, "slow presentation has its own controller");
  saved = preferences(saved, { order: "reverse", inputMode: "keypad", keypad: "visible" }, false);
  saved = begin(saved, "reverse-digits", "return-to-comfort", { adaptation: COMFORT_ADAPTATION });
  assert.deepEqual(saved.session.initialTasks["reverse-digits"], keypad, "starting again preserves the played controller and probe schedule");
  assert.deepEqual(saved.conditions[keypadKey], keypad);
  assert.deepEqual(restore(json(saved)), saved);
});

test("restoration compares complete comfort controllers and rejects malformed bank metadata", () => {
  const original = score(begin(fresh(), "locations", "comfort-consistency", { adaptation: COMFORT_ADAPTATION }), true);
  const key = conditionKey("locations", original);
  const mismatchedBank = json(original);
  mismatchedBank.conditions[key].baseMisses = 1;
  assert.equal(restore(mismatchedBank), null, "a valid but different controller cannot replace the retained session's controller");
  const mismatchedTasks = json(original);
  mismatchedTasks.tasks.locations.baseMisses = 1;
  assert.equal(restore(mismatchedTasks), null, "the exact saved snapshot includes controller metadata");
  const idle = normalizeSaved({ ...original, session: null, redeemed: [] });
  assert.deepEqual(restore(json(idle)), idle, "idle banks preserve valid comfort metadata");
  for (const mutate of [
    (state) => { delete state.comfortSpan; },
    (state) => { state.probeWait = 17; },
    (state) => { state.probeWins = 2; },
    (state) => { state.baseMisses = 2; },
    (state) => { state.probeBackoff = 3; },
  ]) {
    const corrupted = json(idle);
    mutate(corrupted.conditions[key]);
    assert.equal(restore(corrupted), null, mutate.toString());
  }
});

test("pending preferences preserve the active round and captured condition through reload and retry", () => {
  const firstVariant = { order: "reverse", inputMode: "keypad", keypad: "hidden" };
  let saved = preferences(fresh(), firstVariant);
  saved = score(begin(saved, "hidden-digits", "pending-preferences", { adaptation: COMFORT_ADAPTATION }), false);
  const before = structuredClone(saved);
  const oldKey = conditionKey("hidden-digits", before.sessionCondition);
  saved = preferences(saved, { order: "descending", inputMode: "spoken", keypad: "none" }, true);
  assert.notDeepEqual(settings(saved), saved.sessionCondition);
  assert.deepEqual(saved.session, before.session, "a preference choice cannot replace the saved question or restore a retry");
  assert.deepEqual(saved.tasks, before.tasks);
  assert.deepEqual(saved.sessionCondition, before.sessionCondition);
  assert.deepEqual(saved.conditions, before.conditions, "the retained controller stays in its original bank");
  assert.equal(saved.conditions[conditionKey("sort-digits", saved)], undefined);
  assert.equal(selectTaskStates(saved)["sort-digits"].attempts, 0);
  assert.deepEqual(restore(json(saved)), saved);
  assert.equal(canResumePractice(saved, "sort-digits"), false);
  saved = retry(restore(json(saved)), false);
  assert.equal(saved.session.history[0].retryCorrect, false);
  assert.deepEqual(saved.conditions[oldKey], before.conditions[oldKey]);
  assert.deepEqual(taskTotals(saved), taskTotals(before));
  saved = advance(restore(json(saved)));
  assert.deepEqual(saved.session.active.digitVariant, firstVariant, "continuation follows the captured session, not pending options");
  assert.deepEqual(saved.sessionCondition, before.sessionCondition);
  assert.equal(saved.conditions[conditionKey("sort-digits", saved)], undefined);
  assert.deepEqual(restore(json(saved)), saved);
  const corrupted = json(saved);
  corrupted.sessionCondition = settings(saved);
  assert.equal(restore(corrupted), null, "pending preferences must not allow the retained session's context to be rewritten");
});

test("focused practice resumes only the same game and pace while visual practice ignores digit preferences", () => {
  let saved = begin(fresh(), "forward", "matching-visual-practice", { adaptation: COMFORT_ADAPTATION });
  assert.equal(canResumePractice(saved, "forward"), true);
  assert.equal(canResumePractice(saved, "locations"), false);
  assert.equal(canResumePractice(saved, "reverse-digits"), false);
  saved = preferences(saved, { order: "ascending", inputMode: "spoken", keypad: "none" });
  assert.equal(canResumePractice(saved, "forward"), true, "listening options do not define a visual condition");
  saved = score(saved, false);
  assert.equal(canResumePractice(saved, "forward"), true, "the one remaining try must resume rather than restart");
  saved = retry(saved, false);
  assert.equal(canResumePractice(saved, "forward"), true, "a resolved question resumes through the normal advance boundary");
  saved = preferences(saved, saved.digitVariant, true);
  assert.equal(canResumePractice(saved, "forward"), false);
  const session = createProgress("unfocused-session", 24, { profile: RESEARCH_PROFILE, digitVariant: saved.digitVariant });
  const mixed = normalizeSaved({ ...saved, session, sessionCondition: settings(saved), redeemed: [] });
  assert.equal(canResumePractice(mixed, "forward"), false, "a focused game choice replaces a multi-game session");
  assert.equal(canResumePractice(normalizeSaved({ ...saved, session: null, redeemed: [] }), "forward"), false);
});

test("matching digit practice uses its full canonical variant and retains legacy audio aliases", () => {
  for (const variant of enumerateDigitVariants()) {
    let saved = preferences(fresh(), variant, true);
    saved = begin(saved, digitTaskForVariant(variant), `matching-${JSON.stringify(variant)}`, { adaptation: COMFORT_ADAPTATION });
    for (const task of AUDIO_TASK_IDS) assert.equal(canResumePractice(saved, task), true, "audio aliases share the selected variant identity");
    for (const other of enumerateDigitVariants()) {
      const pending = preferences(saved, other);
      assert.equal(canResumePractice(pending, digitTaskForVariant(other)), JSON.stringify(other) === JSON.stringify(variant));
      assert.deepEqual(pending.session, saved.session);
      assert.deepEqual(restore(json(pending)), pending);
    }
    assert.equal(canResumePractice(preferences(saved, variant, false), digitTaskForVariant(variant)), false);
  }
  for (const task of AUDIO_TASK_IDS) {
    for (const inputMode of ["keypad", "spoken"]) {
      const context = { slow: false, inputMode, digitOrder: "descending" };
      const session = createProgress(`matching-old-${task}-${inputMode}`, 8, { focusedTask: task, profile: RESEARCH_PROFILE, digitOrder: "descending" });
      const old = previous({}, context, session);
      const saved = restore(old);
      assert.ok(saved);
      assert.equal(saved.session.digitVariant, undefined);
      assert.equal(canResumePractice(saved, digitTaskForVariant(saved.digitVariant)), true);
      const pending = preferences(saved, { order: "ascending", inputMode: "keypad", keypad: "visible" }, true);
      assert.deepEqual(restore(json(pending)), pending, "a migrated schema-three save can keep pending preferences alongside an older session");
      assert.equal(canResumePractice(pending, "sort-digits"), false);
      const brokenOld = { ...json(old), slow: true };
      assert.equal(restore(brokenOld), null, "schema-two migration still validates its historical condition contract");
    }
  }
});

test("switching away from a missed harder trial keeps counters, probe rest, rewards and buddy without completing the old session", () => {
  let saved = fresh();
  const oldKey = conditionKey("reverse-digits", saved);
  saved.conditions[oldKey] = learned(5, 40, 38);
  saved = normalizeSaved({ ...saved, buddy: "fox" });
  saved = begin(saved, "reverse-digits", "switch-hard-probe", { adaptation: COMFORT_ADAPTATION });
  saved = advance(score(saved, true));
  saved = advance(score(saved, true));
  assert.equal(saved.session.active.span, 6);
  saved = score(saved, false);
  const oldBank = structuredClone(saved.conditions[oldKey]);
  assert.equal(oldBank.comfortSpan, 5);
  assert.equal(oldBank.probeWait, 8);
  assert.ok(oldBank.probeBackoff > 0);
  const before = structuredClone(saved);
  const beforeXp = getMemoryRewards(saved).xp;
  saved = preferences(saved, { order: "descending", inputMode: "spoken", keypad: "none" }, true);
  saved = begin(saved, "locations", "switch-to-new-game", { adaptation: COMFORT_ADAPTATION });
  assert.equal(saved.session.focusedTask, "locations");
  assert.equal(saved.session.cursor, 0);
  assert.deepEqual(saved.session.history, []);
  assert.deepEqual(saved.conditions[oldKey], oldBank);
  assert.deepEqual(taskTotals(saved), taskTotals(before));
  assert.equal(getMemoryRewards(saved).xp, beforeXp);
  assert.equal(saved.buddy, "fox");
  assert.deepEqual(saved.logs, before.logs, "replacing an unfinished run does not count it as completed");
  assert.deepEqual(saved.redeemed, []);
  assert.deepEqual(restore(json(saved)), saved);
  saved = score(saved, false);
  assert.equal(getMemoryRewards(saved).xp, beforeXp + 10);
  saved = preferences(saved, before.digitVariant, false);
  saved = begin(saved, "reverse-digits", "switch-back-to-original", { adaptation: COMFORT_ADAPTATION });
  assert.equal(saved.session.active.span, 5);
  assert.deepEqual(saved.session.initialTasks["reverse-digits"], oldBank, "switching back cannot reset the failed harder target's rest");
  assert.deepEqual(saved.conditions[oldKey], oldBank);
  assert.equal(getMemoryRewards(saved).xp, beforeXp + 10);
  assert.deepEqual(saved.logs, []);
  assert.deepEqual(restore(json(saved)), saved);
});
