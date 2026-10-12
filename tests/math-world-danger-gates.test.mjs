import assert from "node:assert/strict";
import test from "node:test";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { WORLD_DEFINITIONS } from "../app/math-world/world-data.ts";
import { BOSS_CHALLENGES } from "../app/math-world/boss-challenges.ts";
import { createBossProgress, setBossAnswer, submitBossAnswers } from "../app/math-world/boss-progress.ts";
import { DANGERS, canNavigateDestination, dangerAfterWorld, hasCrossedDanger, nextDueDanger, nextDueBoss, nextRequiredEncounter } from "../app/math-world/danger-definitions.ts";
import { acknowledgeDangerBriefing, createDangerState, ensureDangerPacket, startDangerPacket } from "../app/math-world/danger-engine.ts";
const state = createDangerState("gate-player");
const world = number => WORLD_DEFINITIONS.find(candidate => candidate.number === number);
function finishedThrough(number) {
  return { ...createInitialProgress(), completedStopIds: WORLD_DEFINITIONS.filter(candidate => candidate.number <= number).flatMap(candidate => candidate.stopIds) };
}
function completeEmptyDanger(before, number) {
  const id = dangerAfterWorld(number).id;
  const prepared = ensureDangerPacket(before, { dangerId: id, afterWorldNumber: number });
  return startDangerPacket(acknowledgeDangerBriefing(prepared, id), id);
}
function dangersThrough(number) {
  return DANGERS.filter(danger => danger.afterWorld <= number).reduce((before, danger) => completeEmptyDanger(before, danger.afterWorld), state);
}
function bossesThrough(number) {
  return BOSS_CHALLENGES.filter(boss => boss.afterWorld <= number).reduce((before, boss) => {
    for (let index = 0; index < 24; index++) before = setBossAnswer(before, boss.id, index, 0);
    return submitBossAnswers(before, boss.id, "2026-10-12T12:00:00.000Z");
  }, createBossProgress("gate-player"));
}

test("16 encounters occur after every two archipelagos with known-only QA bypass", () => {
  assert.deepEqual(DANGERS.map(danger => danger.afterWorld), Array.from({ length: 16 }, (_, i) => (i + 1) * 2));
  assert.equal(canNavigateDestination(createInitialProgress(), state, "invented-danger", true), false);
  for (const destination of [...DANGERS, ...WORLD_DEFINITIONS, ...BOSS_CHALLENGES]) assert.equal(canNavigateDestination(createInitialProgress(), state, destination.id, true), true);
});

test("finishing world2 unlocks its danger but not world3, including stale selected destination", () => {
  let progress = { ...finishedThrough(2), selectedWorldId: world(3).id };
  assert.equal(canNavigateDestination(progress, state, world(1).id), true);
  assert.equal(canNavigateDestination(progress, state, world(2).id), true);
  assert.equal(canNavigateDestination(progress, state, dangerAfterWorld(2).id), true);
  assert.equal(canNavigateDestination(progress, state, world(3).id), false);
  assert.equal(canNavigateDestination(progress, state, dangerAfterWorld(4).id), false);
  assert.equal(nextDueDanger(progress, state)?.id, dangerAfterWorld(2).id);
  const after = completeEmptyDanger(state, 2);
  assert.equal(canNavigateDestination(progress, after, world(3).id), true);
  assert.equal(nextDueDanger(progress, after), undefined);
  progress = finishedThrough(4);
  assert.equal(nextDueDanger(progress, after)?.id, dangerAfterWorld(4).id);
  assert.equal(canNavigateDestination(progress, after, world(5).id), false);
});

test("a prepared or printed packet cannot by itself open its crossing or a future danger", () => {
  const id = dangerAfterWorld(2).id;
  const prepared = ensureDangerPacket(state, { dangerId: id, afterWorldNumber: 2 });
  assert.equal(canNavigateDestination(finishedThrough(2), prepared, world(3).id), false);
  assert.equal(canNavigateDestination(finishedThrough(0), prepared, id), false);
  assert.equal(canNavigateDestination(finishedThrough(1), prepared, id), false);
});

test("old earned work is preserved but does not bypass unfinished crossings", () => {
  const legacy = finishedThrough(8), before = structuredClone(legacy);
  for (let number = 1; number <= 8; number++) assert.equal(canNavigateDestination(legacy, state, world(number).id), number <= 2);
  assert.equal(canNavigateDestination(legacy, state, dangerAfterWorld(8).id), false);
  assert.equal(nextDueDanger(legacy, state)?.id, dangerAfterWorld(2).id);
  const after = completeEmptyDanger(state, 2);
  assert.equal(canNavigateDestination(legacy, after, world(3).id), true);
  assert.equal(canNavigateDestination(legacy, after, world(5).id), false);
  assert.equal(nextDueDanger(legacy, after)?.id, dangerAfterWorld(4).id);
  assert.equal(canNavigateDestination(legacy, dangersThrough(8), world(9).id), true);
  assert.deepEqual(legacy, before);
});

test("attempted and completed later stops cannot clear a danger or unlock their world", () => {
  const progress = finishedThrough(2);
  const attempted = { ...progress, stopAttempts: { [world(3).stopIds[0]]: { questionIndex: 0, phase: "answering", selectedIndex: null, firstTryCorrect: {}, solvedQuestionIds: [] } } };
  for (const saved of [attempted, finishedThrough(3), { ...progress, selectedWorldId: world(3).id }]) {
    assert.equal(canNavigateDestination(saved, state, world(3).id), false);
    assert.equal(hasCrossedDanger(saved, state, dangerAfterWorld(2)), false);
    assert.equal(nextDueDanger(saved, state)?.id, dangerAfterWorld(2).id);
  }
});

test("boss milestones require all previous dangers and storms, including their own crossing", () => {
  for (const boss of BOSS_CHALLENGES) {
    const progress = finishedThrough(boss.afterWorld), priorBosses = bossesThrough(boss.afterWorld - 1);
    assert.equal(canNavigateDestination(progress, state, boss.id, false, priorBosses), false);
    assert.equal(canNavigateDestination(progress, dangersThrough(boss.afterWorld - 2), dangerAfterWorld(boss.afterWorld).id, false, priorBosses), true);
    assert.equal(canNavigateDestination(progress, dangersThrough(boss.afterWorld - 2), boss.id, false, priorBosses), false);
    assert.equal(canNavigateDestination(progress, dangersThrough(boss.afterWorld), boss.id, false, priorBosses), true);
    assert.equal(canNavigateDestination(finishedThrough(boss.afterWorld - 1), dangersThrough(boss.afterWorld), boss.id, false, priorBosses), false);
  }
  assert.equal(canNavigateDestination(finishedThrough(32), dangersThrough(32), "boss-2026"), false, "the first storm cannot be skipped");
});

test("world17 and subsequent dangers stay gated until the first storm workbook is submitted", () => {
  const progress = finishedThrough(32), cleared = dangersThrough(16), submitted = bossesThrough(16);
  assert.equal(canNavigateDestination(progress, cleared, world(17).id), false);
  assert.equal(canNavigateDestination(progress, cleared, "danger-18"), false);
  assert.equal(nextDueDanger(progress, cleared), undefined);
  assert.equal(nextDueBoss(progress, cleared)?.id, "boss-2025");
  assert.equal(nextRequiredEncounter(progress, cleared)?.id, "boss-2025");
  assert.equal(canNavigateDestination(progress, cleared, world(17).id, false, submitted), true);
  assert.equal(canNavigateDestination(progress, cleared, "danger-18", false, submitted), true);
  assert.equal(nextDueDanger(progress, cleared, submitted)?.id, "danger-18");
  assert.equal(nextRequiredEncounter(progress, dangersThrough(32), submitted)?.id, "boss-2026");
  assert.equal(nextRequiredEncounter(progress, dangersThrough(32), bossesThrough(32)), undefined);
});


test("stale later attempts never substitute for incomplete prerequisite archipelagos", () => {
  const attempt = { questionIndex: 0, phase: "answering", selectedIndex: null, firstTryCorrect: {}, solvedQuestionIds: [] };
  for (const number of [2, 5, 17, 32]) {
    const progress = {
      ...finishedThrough(number - 1),
      selectedWorldId: world(number).id,
      activeStopId: world(number).stopIds[0],
      stopAttempts: { [world(number).stopIds[0]]: attempt },
    };
    const saved = { ...progress, completedStopIds: progress.completedStopIds.filter(id => id !== world(1).stopIds[0]) };
    const before = structuredClone(saved);
    assert.equal(canNavigateDestination(saved, dangersThrough(32), world(number).id, false, bossesThrough(32)), false);
    assert.equal(canNavigateDestination(progress, dangersThrough(32), world(number).id, false, bossesThrough(32)), true);
    assert.deepEqual(saved, before, "blocking a stale route preserves all saved work");
  }
});
