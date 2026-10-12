import { GLOBE_DANGER_LOCATIONS } from "./globe-danger-locations.ts";
import type { WorldProgress } from "./engine.ts";
import { BOSS_CHALLENGES, canOpenBoss, type BossChallenge } from "./boss-challenges.ts";
import { hasSubmittedBoss, type BossProgress } from "./boss-progress.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import type { DangerState } from "./danger-engine.ts";

const titles = { squall: "The Thunder Squall", kraken: "The Kraken Crossing", maelstrom: "The Whirling Deep", fog: "The Lantern Fog", icebergs: "The Iceberg Passage", reef: "The Hidden Reef" };
export const DANGERS = GLOBE_DANGER_LOCATIONS.map(location => ({ ...location, title: titles[location.kind] }));
export type DangerDefinition = (typeof DANGERS)[number];
export const dangerById = (id: string | null | undefined) => DANGERS.find(danger => danger.id === id);
export const dangerAfterWorld = (number: number) => DANGERS.find(danger => danger.afterWorld === number);
const finished = (progress: WorldProgress, number: number) => WORLD_DEFINITIONS.find(world => world.number === number)?.stopIds.every(id => progress.completedStopIds.includes(id)) ?? false;
const prerequisitesFinished = (progress: WorldProgress, danger: DangerDefinition) => WORLD_DEFINITIONS.filter(world => world.number <= danger.afterWorld).every(world => finished(progress, world.number));
const bossSubmitted = (state: BossProgress | undefined, id: string) => !!state && hasSubmittedBoss(state, id);

/** A crossing clears only when its review packet is completed. Saved work on
 * later islands is retained, but cannot stand in for the required crossing. */
export function hasCrossedDanger(_progress: WorldProgress, state: DangerState, danger: DangerDefinition): boolean {
  return Boolean(state.packets[danger.id]?.completedAt);
}

/** Shared by map pins, menus, voyages and deep links. Every destination needs
 * its completed teaching prerequisites and all encounters before it. At a
 * shared boundary the danger comes first, followed by the storm workbook. */
export function canNavigateDestination(progress: WorldProgress, state: DangerState, id: string, qa = false, bossState?: BossProgress): boolean {
  const danger = dangerById(id);
  const boss = BOSS_CHALLENGES.find(candidate => candidate.id === id);
  const world = WORLD_DEFINITIONS.find(candidate => candidate.id === id);
  if (!danger && !boss && !world) return false;
  if (qa) return true;
  if (danger && !prerequisitesFinished(progress, danger)) return false;
  if (world && !WORLD_DEFINITIONS.filter(candidate => candidate.number < world.number).every(candidate => finished(progress, candidate.number))) return false;
  if (boss && !canOpenBoss(progress, boss)) return false;
  const boundary = danger?.afterWorld ?? boss?.afterWorld ?? (world!.number - 1);
  const priorDangers = DANGERS.filter(candidate => danger ? candidate.afterWorld < boundary : candidate.afterWorld <= boundary);
  const priorBosses = BOSS_CHALLENGES.filter(candidate => world ? candidate.afterWorld <= boundary : candidate.afterWorld < boundary);
  return priorDangers.every(candidate => hasCrossedDanger(progress, state, candidate))
    && priorBosses.every(candidate => bossSubmitted(bossState, candidate.id));
}

/** Return only a crossing that can actually be reached now, including when a
 * stale saved destination lies beyond an unfinished danger or storm. */
export function nextDueDanger(progress: WorldProgress, state: DangerState, bossState?: BossProgress): DangerDefinition | undefined {
  return DANGERS.find(danger => !hasCrossedDanger(progress, state, danger) && canNavigateDestination(progress, state, danger.id, false, bossState));
}

export function nextDueBoss(progress: WorldProgress, state: DangerState, bossState?: BossProgress): BossChallenge | undefined {
  return BOSS_CHALLENGES.find(boss => !bossSubmitted(bossState, boss.id) && canNavigateDestination(progress, state, boss.id, false, bossState));
}

export function nextRequiredEncounter(progress: WorldProgress, state: DangerState, bossState?: BossProgress): DangerDefinition | BossChallenge | undefined {
  return nextDueDanger(progress, state, bossState) ?? nextDueBoss(progress, state, bossState);
}

/** Only the next unfinished crossing belongs on the globe. QA can preview an
 * explicitly selected unfinished danger, but never revive a completed one. */
export function dangerSceneryStages(progress: WorldProgress, state: DangerState, qa = false, activeDestinationId?: string | null, bossState?: BossProgress): Record<string, number> {
  const selected = qa ? dangerById(activeDestinationId) : undefined;
  const preview = selected && !hasCrossedDanger(progress, state, selected) ? selected : undefined;
  const relevant = preview ?? nextDueDanger(progress, state, bossState);
  return Object.fromEntries(DANGERS.map(danger => [danger.id, danger.id === relevant?.id ? 1 : 0]));
}
