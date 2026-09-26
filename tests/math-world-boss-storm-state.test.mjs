import assert from "node:assert/strict";
import test from "node:test";
import { BOSS_CHALLENGES, canOpenBoss } from "../app/math-world/boss-challenges.ts";
import { completedTeachingWorldCount, getBossStormStages, bossStormStageLabel } from "../app/math-world/boss-storm-state.ts";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { WORLD_DEFINITIONS, WORLD_MODE } from "../app/math-world/world-data.ts";

const spiral = WORLD_MODE === "spiral-preview";
const through = count => ({ ...createInitialProgress(), completedStopIds: WORLD_DEFINITIONS.slice(0, count).flatMap(world => world.stopIds) });

test("hurricanes gather two worlds before each milestone, without unlocking the tests early", { skip: !spiral }, () => {
  for (const boss of BOSS_CHALLENGES) {
    for (const [offset, strength] of [[-3, 0], [-2, .34], [-1, .68], [0, 1]]) {
      const progress = through(boss.afterWorld + offset);
      assert.equal(getBossStormStages(progress)[boss.id], strength);
      assert.equal(canOpenBoss(progress, boss), offset === 0);
    }
  }
  assert.deepEqual(getBossStormStages(through(0)), { "boss-2025": 0, "boss-2026": 0 });
  assert.deepEqual(getBossStormStages(through(32)), { "boss-2025": 1, "boss-2026": 1 });
});

test("only contiguous fully completed teaching worlds drive storm weather", { skip: !spiral }, () => {
  const full = through(32);
  const missing = WORLD_DEFINITIONS[4].stopIds.at(-1);
  const gap = { ...full, selectedWorldId: WORLD_DEFINITIONS[31].id, completedStopIds: full.completedStopIds.filter(id => id !== missing) };
  assert.equal(completedTeachingWorldCount(gap), 4);
  assert.deepEqual(getBossStormStages(gap), getBossStormStages(through(4)));
  const partial = { ...through(13), completedStopIds: [...through(13).completedStopIds, ...WORLD_DEFINITIONS[13].stopIds.slice(0, -1)] };
  assert.equal(completedTeachingWorldCount(partial), 13);
  assert.equal(getBossStormStages(partial)["boss-2025"], 0);
  assert.deepEqual(getBossStormStages({ ...through(13), selectedWorldId: WORLD_DEFINITIONS[31].id }), getBossStormStages(through(13)));
});

test("QA and active storm presentation never write completion or widen navigation access", { skip: !spiral }, () => {
  const progress = through(0), before = structuredClone(progress);
  assert.deepEqual(getBossStormStages(progress, true), { "boss-2025": 1, "boss-2026": 1 });
  assert.deepEqual(getBossStormStages(progress, false, "boss-2025"), { "boss-2025": 1, "boss-2026": 0 });
  assert.deepEqual(getBossStormStages(progress, false, "unknown"), { "boss-2025": 0, "boss-2026": 0 });
  assert.deepEqual(progress, before);
  assert.equal(canOpenBoss(progress, BOSS_CHALLENGES[0]), false);
  assert.deepEqual([0, .34, .68, 1].map(bossStormStageLabel), ["Storm ahead", "Storm gathering", "Storm strengthening", "Hurricane"]);
});
