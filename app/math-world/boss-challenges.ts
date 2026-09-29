import type { WorldProgress } from "./engine.ts";
import { WORLD_DEFINITIONS, WORLD_MODE } from "./world-data.ts";
import holdouts from "../../content/math-world/boss-holdouts.json" with { type: "json" };

export type BossChallenge = Readonly<{
  id: "boss-2025" | "boss-2026";
  year: 2025 | 2026;
  afterWorld: number;
  title: string;
  questionCount: 24;
  gradeBand: "1-2";
}>;

type ReservedTest = Omit<BossChallenge, "afterWorld" | "title"> & Readonly<{ afterWorldNumber: number }>;

/** Storm assessments use the same milestones as the teaching-pool exclusions. */
export const BOSS_CHALLENGES: readonly BossChallenge[] = WORLD_MODE === "spiral-preview"
  ? (holdouts.challenges as readonly ReservedTest[]).map(challenge => ({
    id: challenge.id,
    year: challenge.year,
    afterWorld: challenge.afterWorldNumber,
    title: `${challenge.year} Storm Challenge`,
    questionCount: challenge.questionCount,
    gradeBand: challenge.gradeBand,
  }))
  : [];

export function bossById(id: string | null): BossChallenge | undefined {
  return BOSS_CHALLENGES.find(challenge => challenge.id === id);
}

export function bossAfterWorld(worldNumber: number): BossChallenge | undefined {
  return BOSS_CHALLENGES.find(challenge => challenge.afterWorld === worldNumber);
}

export function canOpenBoss(progress: WorldProgress, challenge: BossChallenge, qaUnlocked = false): boolean {
  const canonical = bossById(challenge.id);
  if (!canonical) return false;
  if (qaUnlocked) return true;
  const prerequisites = WORLD_DEFINITIONS.filter(world => world.number <= canonical.afterWorld);
  return prerequisites.length === canonical.afterWorld
    && prerequisites.every(world => world.stopIds.every(id => progress.completedStopIds.includes(id)));
}
