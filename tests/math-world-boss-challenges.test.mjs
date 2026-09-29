import assert from "node:assert/strict";
import test from "node:test";
import { BOSS_CHALLENGES, bossAfterWorld, bossById, canOpenBoss } from "../app/math-world/boss-challenges.ts";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { WORLD_DEFINITIONS, WORLD_MODE, WORLD_QUESTIONS } from "../app/math-world/world-data.ts";

const spiral = WORLD_MODE === "spiral-preview";
const throughWorld = number => ({
  ...createInitialProgress(),
  completedStopIds: WORLD_DEFINITIONS.filter(world => world.number <= number).flatMap(world => world.stopIds),
});

test("boss milestones reserve two full grade 1–2 tests without adding teaching worlds", { skip: !spiral }, () => {
  assert.deepEqual(BOSS_CHALLENGES.map(({ year, afterWorld, questionCount, gradeBand }) => ({ year, afterWorld, questionCount, gradeBand })), [
    { year: 2025, afterWorld: 16, questionCount: 24, gradeBand: "1-2" },
    { year: 2026, afterWorld: 32, questionCount: 24, gradeBand: "1-2" },
  ]);
  assert.equal(WORLD_DEFINITIONS.length, 32);
  assert.equal(WORLD_QUESTIONS.length, 680);
  assert.equal(bossAfterWorld(9), undefined);
  assert.equal(bossAfterWorld(16), bossById("boss-2025"));
  assert.equal(bossAfterWorld(32), bossById("boss-2026"));
  assert.equal(bossById("boss-2024"), undefined);
  assert.equal(bossById(null), undefined);
});

test("each boss opens only after all of its preceding teaching stops", { skip: !spiral }, () => {
  for (const boss of BOSS_CHALLENGES) {
    assert.equal(canOpenBoss(createInitialProgress(), boss), false);
    assert.equal(canOpenBoss(throughWorld(boss.afterWorld - 1), boss), false);
    const complete = throughWorld(boss.afterWorld);
    assert.equal(canOpenBoss(complete, boss), true);
    assert.equal(canOpenBoss({ ...complete, completedStopIds: complete.completedStopIds.slice(1) }, boss), false, "a cleared milestone world alone cannot hide an earlier gap");
    assert.equal(canOpenBoss(createInitialProgress(), { ...boss, afterWorld: 0 }), false, "unlock checks use the authored milestone");
  }
  assert.equal(canOpenBoss(throughWorld(16), bossById("boss-2026")), false);
});

test("test mode can inspect both placeholders without changing progress or granting completion", { skip: !spiral }, () => {
  const progress = createInitialProgress();
  const before = structuredClone(progress);
  for (const boss of BOSS_CHALLENGES) assert.equal(canOpenBoss(progress, boss, true), true);
  assert.equal(canOpenBoss(progress, { ...BOSS_CHALLENGES[0], id: "unknown" }, true), false);
  assert.deepEqual(progress, before);
});
