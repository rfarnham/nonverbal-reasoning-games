import { GLOBE_DANGER_LOCATIONS } from "./globe-danger-locations.ts";
import { canOpenWorld, type WorldProgress } from "./engine.ts";
import { BOSS_CHALLENGES, canOpenBoss } from "./boss-challenges.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import type { DangerState } from "./danger-engine.ts";

const titles = { squall: "The Thunder Squall", kraken: "The Kraken Crossing", maelstrom: "The Whirling Deep" };
export const DANGERS = GLOBE_DANGER_LOCATIONS.map(location => ({ ...location, title: titles[location.kind] }));
export type DangerDefinition = (typeof DANGERS)[number];
export const dangerById = (id: string | null | undefined) => DANGERS.find(danger => danger.id === id);
export const dangerAfterWorld = (number: number) => DANGERS.find(danger => danger.afterWorld === number);
const finished = (progress: WorldProgress, number: number) => WORLD_DEFINITIONS.find(world => world.number === number)?.stopIds.every(id => progress.completedStopIds.includes(id)) ?? false;
const reached = (progress: WorldProgress, number: number) => WORLD_DEFINITIONS.some(world => world.number >= number && world.stopIds.some(id => progress.completedStopIds.includes(id) || Object.hasOwn(progress.stopAttempts, id)));
const prerequisitesFinished = (progress: WorldProgress, danger: DangerDefinition) => WORLD_DEFINITIONS.filter(world => world.number <= danger.afterWorld).every(world => finished(progress, world.number));

/** Actual attempted/earned work beyond a crossing predates its new gate. A
 * selectedWorldId or URL alone is not evidence of earned access. */
export function hasCrossedDanger(progress: WorldProgress, state: DangerState, danger: DangerDefinition): boolean {
  return Boolean(state.packets[danger.id]?.completedAt) || reached(progress, danger.afterWorld + 1);
}

/** The next real crossing, excluding historical crossings grandfathered by
 * earned progress. Useful when a stale saved URL points just beyond the gate. */
export function nextDueDanger(progress: WorldProgress, state: DangerState): DangerDefinition | undefined {
  return DANGERS.find(danger => !hasCrossedDanger(progress, state, danger) && prerequisitesFinished(progress, danger));
}

/** Shared by map pins, menus, voyages and deep links. Existing earned worlds
 * remain reachable; a newly unlocked world or boss requires its crossing.
 * Dangers themselves depend on their teaching worlds, never on earlier danger
 * packets, so legacy voyages cannot become stuck behind old inserted gates. */
export function canNavigateDestination(progress: WorldProgress, state: DangerState, id: string, qa = false): boolean {
  const danger = dangerById(id);
  const boss = BOSS_CHALLENGES.find(candidate => candidate.id === id);
  const world = WORLD_DEFINITIONS.find(candidate => candidate.id === id);
  if (!danger && !boss && !world) return false;
  if (qa) return true;
  if (danger) return prerequisitesFinished(progress, danger);
  if (world && !canOpenWorld(progress, id)) return false;
  if (boss && !canOpenBoss(progress, boss)) return false;
  const boundary = boss?.afterWorld ?? (world!.number - 1);
  return DANGERS.filter(candidate => candidate.afterWorld <= boundary).every(candidate => hasCrossedDanger(progress, state, candidate));
}
export function dangerSceneryStages(progress: WorldProgress, state: DangerState, qa = false): Record<string, number> {
  return Object.fromEntries(DANGERS.map(danger => [danger.id, state.packets[danger.id]?.completedAt ? .35 : qa || canNavigateDestination(progress, state, danger.id) ? 1 : 0]));
}
