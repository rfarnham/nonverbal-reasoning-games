import { BOSS_CHALLENGES } from "./boss-challenges.ts";
import type { WorldProgress } from "./engine.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";

export type BossStormStages = Readonly<Record<string, number>>;

/** Progress, rather than the selected map or a scattered set of later clears,
 * drives the weather. Incomplete stops never count as a completed archipelago. */
export function completedTeachingWorldCount(progress: WorldProgress): number {
  const completed = new Set(progress.completedStopIds);
  let count = 0;
  for (const world of WORLD_DEFINITIONS) {
    if (!world.stopIds.length || !world.stopIds.every(id => completed.has(id))) break;
    count++;
  }
  return count;
}

/** Both storms have two worlds of foreshadowing before the test milestone.
 * Previewing a storm never writes to real completion or unlocks the test. */
export function getBossStormStages(progress: WorldProgress, qaUnlocked = false, activeBossId?: string | null): BossStormStages {
  const complete = completedTeachingWorldCount(progress);
  return Object.fromEntries(BOSS_CHALLENGES.map(boss => {
    const remaining = boss.afterWorld - complete;
    const strength = qaUnlocked || boss.id === activeBossId || remaining <= 0 ? 1
      : remaining === 1 ? .68 : remaining === 2 ? .34 : 0;
    return [boss.id, strength];
  }));
}

export function bossStormStageLabel(strength: number): string {
  return strength >= 1 ? "Hurricane" : strength >= .68 ? "Storm strengthening" : strength > 0 ? "Storm gathering" : "Storm ahead";
}
