import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_TASK_IDS,
  RESEARCH_PROFILE,
  VISUAL_TASK_IDS,
  advanceRound,
  createProgress,
  createTaskStates,
  recordFirstAttempt,
} from "../app/lab/working-memory/engine.ts";
import { digitTaskForVariant, enumerateDigitVariants } from "../app/lab/working-memory/digit-options.ts";
import { conditionKey, fresh, normalizeSaved, restore, selectTaskStates, taskTotals } from "../app/lab/working-memory/progress.ts";
import {
  MEMORY_HABITATS,
  MEMORY_TROPHIES,
  getMemoryRewards,
  getSessionRewards,
} from "../app/lab/working-memory/rewards.ts";

function withCounts(counts) {
  const saved = fresh();
  for (const [task, [attempts, correct = 0]] of Object.entries(counts)) {
    saved.legacyTasks[task] = { ...saved.legacyTasks[task], attempts, correct };
  }
  assert.ok(restore(structuredClone(saved)), "aggregate fixtures must remain valid saved practice");
  return saved;
}

function begin(saved, task = "forward", seed = "reward-session") {
  if (AUDIO_TASK_IDS.includes(task)) task = digitTaskForVariant(saved.digitVariant);
  const session = createProgress(seed, 8, {
    focusedTask: task, tasks: selectTaskStates(saved), profile: RESEARCH_PROFILE,
    digitVariant: saved.digitVariant, digitOrder: saved.digitOrder,
  });
  return normalizeSaved({ ...saved, session, redeemed: [], sessionCondition: {
    slow: saved.slow, inputMode: saved.inputMode, digitOrder: saved.digitOrder, digitVariant: saved.digitVariant,
  } });
}

function score(saved, correct) {
  return normalizeSaved({ ...saved, session: recordFirstAttempt(saved.session, saved.session.active, correct) });
}

function advance(saved) {
  return normalizeSaved({ ...saved, session: advanceRound(saved.session) });
}

function finish(saved, correct = true) {
  while (saved.session.active) {
    saved = score(saved, correct);
    if (!correct) saved = normalizeSaved({ ...saved, redeemed: [...saved.redeemed, saved.session.active.id] });
    saved = advance(saved);
  }
  return saved;
}

function trophy(saved, id) { return getMemoryRewards(saved).trophies.find((item) => item.id === id); }

test("fresh practice starts at the first habitat with no earned rewards or hidden preference defaults", () => {
  const saved = fresh();
  const rewards = getMemoryRewards(saved);
  assert.deepEqual([rewards.xp, rewards.attempts, rewards.correct, rewards.completedStops], [0, 0, 0, 0]);
  assert.deepEqual([rewards.expedition, rewards.habitatIndex, rewards.stopIndex, rewards.stopXp], [1, 0, 0, 0]);
  assert.deepEqual(MEMORY_HABITATS.map(({ title }) => title), ["Acorn Grove", "Pebble Brook", "Fern Hollow", "Moonlit Meadow", "Starry Summit"]);
  assert.equal(rewards.trophies.length, 6);
  assert.equal(new Set(MEMORY_TROPHIES.map(({ id }) => id)).size, 6);
  assert.ok(rewards.trophies.every((item) => !item.earned && item.progress === 0));
  assert.equal(Object.hasOwn(saved, "buddy"), false, "existing Saved3 fixtures keep their original shape");
  const session = getSessionRewards(saved);
  assert.deepEqual([session.xp, session.attempts, session.correct, session.xpBefore], [0, 0, 0, 0]);
  assert.deepEqual(session.earnedTrophies, []);
});

test("first attempts earn equal XP for correct answers, memory misses, and different adaptive spans", () => {
  const correct = score(begin(fresh(), "forward", "reward-correct"), true);
  const missed = score(begin(fresh(), "forward", "reward-missed"), false);
  assert.equal(getMemoryRewards(correct).xp, 10);
  assert.equal(getMemoryRewards(missed).xp, 10);
  assert.equal(getMemoryRewards(correct).correct, 1);
  assert.equal(getMemoryRewards(missed).correct, 0);
  const differentSpan = withCounts({ forward: [1, 0] });
  differentSpan.legacyTasks.forward.span = 9;
  assert.equal(getMemoryRewards(differentSpan).xp, 10, "XP does not reward a harder span or pressure children to increase it");
});

test("save, reload, replay, redemption, and leaving a session cannot award an attempt twice", () => {
  let saved = score(begin(fresh()), false);
  const missed = getMemoryRewards(saved);
  saved = normalizeSaved({ ...saved, redeemed: [saved.session.active.id] });
  assert.deepEqual(getMemoryRewards(saved), missed, "redeeming the answer does not mint another award");
  saved = restore(structuredClone(saved));
  assert.deepEqual(getMemoryRewards(saved), missed);
  saved = advance(saved);
  assert.deepEqual(getMemoryRewards(saved), missed, "automatic next presentation is not another attempt");
  saved = normalizeSaved({ ...saved, session: null, redeemed: [] });
  assert.deepEqual(getMemoryRewards(saved), missed, "ending an unfinished session retains its legitimate first-attempt XP");
  saved = score(begin(saved, "forward", "later-session"), true);
  assert.equal(getMemoryRewards(saved).xp, 20);
});

test("trail boundaries advance habitats and repeat expeditions without resetting lifetime XP", () => {
  const boundaries = [
    [0, [0, 0, 1, 0, 0, 0]],
    [7, [70, 0, 1, 0, 0, 70]],
    [8, [80, 1, 1, 0, 1, 0]],
    [39, [390, 4, 1, 0, 4, 70]],
    [40, [400, 5, 1, 1, 0, 0]],
    [199, [1990, 24, 1, 4, 4, 70]],
    [200, [2000, 25, 2, 0, 0, 0]],
    [208, [2080, 26, 2, 0, 1, 0]],
    [400, [4000, 50, 3, 0, 0, 0]],
  ];
  for (const [attempts, expected] of boundaries) {
    const r = getMemoryRewards(withCounts({ forward: [attempts] }));
    assert.deepEqual([r.xp, r.completedStops, r.expedition, r.habitatIndex, r.stopIndex, r.stopXp], expected, `${attempts} attempts`);
  }
  assert.equal(trophy(withCounts({ forward: [400] }), "expedition-explorer").earned, true);
});

test("trophies honor practice totals and visual/listening variety without an accuracy gate", () => {
  const saved = withCounts({ forward: [32], "hidden-digits": [8] });
  const rewards = getMemoryRewards(saved);
  assert.equal(rewards.correct, 0);
  assert.deepEqual(rewards.trophies.filter(({ earned }) => earned).map(({ id }) => id), ["first-footsteps", "trail-explorer", "bright-eyes", "listening-ears"]);
  assert.equal(trophy(saved, "first-footsteps").progress, 8, "displayed trophy progress caps at its goal");
  assert.equal(trophy(saved, "curious-explorer").progress, 2);
  assert.equal(trophy(saved, "expedition-explorer").earned, false);
});

test("all audio aliases count as one Digits family for the nine-game trophy", () => {
  const counts = Object.fromEntries([...VISUAL_TASK_IDS.slice(0, 7), ...AUDIO_TASK_IDS].map((task) => [task, [1]]));
  const saved = withCounts(counts);
  assert.equal(trophy(saved, "curious-explorer").progress, 8);
  assert.equal(trophy(saved, "curious-explorer").earned, false);
  saved.legacyTasks[VISUAL_TASK_IDS[7]].attempts = 1;
  assert.equal(trophy(saved, "curious-explorer").progress, 9);
  assert.equal(trophy(saved, "curious-explorer").earned, true);
});

test("all nine digit variants and both presentation paces contribute only their own first attempts", () => {
  let saved = fresh();
  for (const slow of [false, true]) {
    for (const [index, digitVariant] of enumerateDigitVariants().entries()) {
      saved = normalizeSaved({ ...saved, digitVariant, slow, inputMode: digitVariant.inputMode,
        digitOrder: digitVariant.order === "reverse" ? saved.digitOrder : digitVariant.order });
      saved = finish(begin(saved, "reverse-digits", `variant-${slow}-${index}`), false);
    }
  }
  const rewards = getMemoryRewards(saved);
  assert.equal(rewards.attempts, 144);
  assert.equal(rewards.xp, 1440);
  assert.equal(rewards.correct, 0);
  assert.equal(trophy(saved, "curious-explorer").progress, 1);
  assert.equal(trophy(saved, "listening-ears").earned, true);
  assert.deepEqual(getMemoryRewards(restore(structuredClone(saved))), rewards);
});

test("original and archived migrated histories earn retroactive XP without counting seeded controllers again", () => {
  const oldTasks = createTaskStates();
  oldTasks.forward = { span: 6, successStreak: 0, attempts: 12, correct: 9 };
  const original = restore({ version: 1, session: null, tasks: oldTasks, logs: [], redeemed: [], slow: false });
  assert.ok(original);
  assert.equal(getMemoryRewards(original).xp, 120);
  const context = { slow: false, inputMode: "spoken", digitOrder: "ascending" };
  const oldKey = conditionKey("hidden-digits", context);
  const state = { span: 5, successStreak: 0, attempts: 20, correct: 12, balance: 1 };
  const oldResearchTasks = createTaskStates(RESEARCH_PROFILE);
  oldResearchTasks["hidden-digits"] = state;
  let saved = restore({ version: 2, ...context, session: null, sessionCondition: null, tasks: oldResearchTasks,
    legacyTasks: oldTasks, conditions: { [oldKey]: state }, logs: [], redeemed: [] });
  assert.ok(saved);
  assert.equal(getMemoryRewards(saved).xp, 320);
  assert.equal(getMemoryRewards(saved).correct, 21);
  assert.equal(selectTaskStates(saved)["reverse-digits"].attempts, 0, "a seeded span is not duplicate practice");
  saved = score(begin(saved, "reverse-digits", "new-canonical-play"), false);
  assert.equal(getMemoryRewards(saved).xp, 330);
  assert.deepEqual(getMemoryRewards(restore(structuredClone(saved))), getMemoryRewards(saved));
});

test("session summaries subtract only retained first attempts and find newly crossed trophies", () => {
  let saved = begin(withCounts({ forward: [35] }), "forward", "cross-habitat");
  saved = finish(saved, false);
  const session = getSessionRewards(saved);
  assert.deepEqual([session.xp, session.attempts, session.correct, session.xpBefore], [80, 8, 0, 350]);
  assert.equal(session.before.xp, 350);
  assert.equal(session.before.habitatIndex, 0);
  assert.equal(session.after.xp, 430);
  assert.equal(session.after.habitatIndex, 1);
  assert.deepEqual(session.earnedTrophies.map(({ id }) => id), ["trail-explorer"]);
  assert.equal(saved.session.history.length, 8);
  assert.equal(saved.redeemed.length, 8);
  assert.deepEqual(getSessionRewards(restore(structuredClone(saved))), session);
});

test("incomplete and completed sessions have no replay or completion XP bonuses", () => {
  let saved = score(begin(fresh()), false);
  assert.deepEqual([getSessionRewards(saved).xp, getSessionRewards(saved).xpBefore], [10, 0]);
  saved = advance(saved);
  while (saved.session.active) saved = advance(score(saved, true));
  const beforeLogs = getMemoryRewards(saved);
  const session = getSessionRewards(saved);
  assert.deepEqual([session.xp, session.attempts, session.correct], [80, 8, 7]);
  const log = { id: saved.session.seed, date: "2026-10-20T12:00:00Z", rounds: 8, correct: 7, maxSpan: 3, slow: false, modality: "visual" };
  saved.logs = Array.from({ length: 500 }, (_, index) => ({ ...log, id: `history-${index}` }));
  assert.deepEqual(getMemoryRewards(saved), beforeLogs, "completion log retention cannot change lifetime XP");
  assert.deepEqual(getSessionRewards(saved), session);
});

test("reward reads cannot mutate calibration, histories, preferences, or bank totals", () => {
  const saved = finish(begin(withCounts({ locations: [9, 4] }), "rotation"), false);
  const snapshot = structuredClone(saved);
  const totals = taskTotals(saved);
  getMemoryRewards(saved);
  getSessionRewards(saved);
  getMemoryRewards(saved);
  assert.deepEqual(saved, snapshot);
  assert.deepEqual(taskTotals(saved), totals);
});
