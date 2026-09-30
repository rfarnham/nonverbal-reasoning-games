import assert from "node:assert/strict";
import test from "node:test";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { WORLD_DEFINITIONS } from "../app/math-world/world-data.ts";
import { BOSS_CHALLENGES } from "../app/math-world/boss-challenges.ts";
import { DANGERS, canNavigateDestination, dangerAfterWorld, nextDueDanger } from "../app/math-world/danger-definitions.ts";
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

test("legacy earned progress stays accessible and old incomplete dangers do not trap the next crossing", () => {
  const legacy = finishedThrough(8);
  for (let number = 1; number <= 8; number++) assert.equal(canNavigateDestination(legacy, state, world(number).id), true);
  assert.equal(canNavigateDestination(legacy, state, dangerAfterWorld(8).id), true);
  assert.equal(nextDueDanger(legacy, state)?.id, dangerAfterWorld(8).id);
  assert.equal(canNavigateDestination(legacy, state, world(9).id), false);
  const after = completeEmptyDanger(state, 8);
  assert.equal(canNavigateDestination(legacy, after, world(9).id), true);
  assert.equal(after.packets[dangerAfterWorld(2).id], undefined);
});

test("already attempted next world is earned access; selectedWorldId without work is not", () => {
  const progress = finishedThrough(2);
  const attempted = { ...progress, stopAttempts: { [world(3).stopIds[0]]: { questionIndex: 0, phase: "answering", selectedIndex: null, firstTryCorrect: {}, solvedQuestionIds: [] } } };
  assert.equal(canNavigateDestination(attempted, state, world(3).id), true);
  assert.equal(nextDueDanger(attempted, state), undefined);
  assert.equal(canNavigateDestination({ ...progress, selectedWorldId: world(3).id }, state, world(3).id), false);
});

test("both boss milestones require their danger until genuinely crossed, preserving all earlier earned worlds", () => {
  for (const boss of BOSS_CHALLENGES) {
    const progress = finishedThrough(boss.afterWorld);
    assert.equal(canNavigateDestination(progress, state, boss.id), false);
    assert.equal(canNavigateDestination(progress, state, dangerAfterWorld(boss.afterWorld).id), true);
    assert.equal(canNavigateDestination(progress, completeEmptyDanger(state, boss.afterWorld), boss.id), true);
    assert.equal(canNavigateDestination(finishedThrough(boss.afterWorld - 1), completeEmptyDanger(state, boss.afterWorld), boss.id), false);
  }
  const legacy = finishedThrough(17);
  assert.equal(canNavigateDestination(legacy, state, BOSS_CHALLENGES[0].id), true);
});
