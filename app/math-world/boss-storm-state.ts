import { BOSS_CHALLENGES } from "./boss-challenges.ts";
import { hasSubmittedBoss, type BossProgress } from "./boss-progress.ts";
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

/** Both storms gather before their milestone and remain until workbook
 * answers are submitted. QA previews only the selected unfinished storm. */
export function getBossStormStages(progress: WorldProgress, qaUnlocked = false, activeBossId?: string | null, bossState?: BossProgress): BossStormStages {
  const complete = completedTeachingWorldCount(progress);
  return Object.fromEntries(BOSS_CHALLENGES.map(boss => {
    if (bossState && hasSubmittedBoss(bossState, boss.id)) return [boss.id, 0];
    const remaining = boss.afterWorld - complete;
    const strength = (qaUnlocked && boss.id === activeBossId) || remaining <= 0 ? 1
      : remaining === 1 ? .68 : remaining === 2 ? .34 : 0;
    return [boss.id, strength];
  }));
}

export function bossStormStageLabel(strength: number): string {
  return strength >= 1 ? "Hurricane" : strength >= .68 ? "Storm strengthening" : strength > 0 ? "Storm gathering" : "Storm ahead";
}
