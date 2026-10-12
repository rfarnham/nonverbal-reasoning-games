import { BOSS_CHALLENGES } from "./boss-challenges.ts";
import { hasSubmittedBoss, type BossProgress } from "./boss-progress.ts";
import { canNavigateDestination, DANGERS } from "./danger-definitions.ts";
import type { DangerState } from "./danger-engine.ts";
import type { WorldProgress } from "./engine.ts";
import { acknowledgedVoyageChapters, type WorldStoryProgress } from "./story-progress.ts";
import { storySoFar } from "./voyage-reading.ts";
import { VOYAGE_CHAPTERS, type VoyageChapter } from "./voyage-story-content.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";

const reforgingId = "oceania-voyage-reforging";
const ascentId = "oceania-voyage-ascent";

/** A chapter follows its archipelago's completed stops and every crossing on
 * the way there. Chapters at a storm boundary describe the storm passing, so
 * their own crossing and storm must also be submitted before they can open. */
function hasChapterPrerequisites(
  chapter: VoyageChapter,
  progress: WorldProgress,
  dangers: DangerState,
  bosses: BossProgress,
): boolean {
  const worlds = WORLD_DEFINITIONS.filter(world => world.number <= chapter.worldNumber);
  const completed = new Set(progress.completedStopIds);
  if (worlds.length !== chapter.worldNumber || !worlds.every(world =>
    world.stopIds.length > 0 && world.stopIds.every(id => completed.has(id)))) return false;

  const includesBoundary = chapter.shardWorld === undefined
    || BOSS_CHALLENGES.some(boss => boss.afterWorld === chapter.worldNumber);
  const boundary = chapter.worldNumber - (includesBoundary ? 0 : 1);
  return DANGERS.filter(danger => danger.afterWorld <= boundary)
    .every(danger => Boolean(dangers.packets[danger.id]?.completedAt))
    && BOSS_CHALLENGES.filter(boss => boss.afterWorld <= boundary)
      .every(boss => hasSubmittedBoss(bosses, boss.id));
}

/** Earned story access has no map-selection or QA bypass. Reading flags retain
 * their history, but cannot unlock uncompleted archipelagos or crossings. */
export function unlockedVoyageChapters(
  story: WorldStoryProgress,
  progress: WorldProgress,
  dangers: DangerState,
  bosses: BossProgress,
): VoyageChapter[] {
  if (story.ending !== "complete") return [];
  const read = new Set(acknowledgedVoyageChapters(story).map(chapter => chapter.id));
  const allShardsRead = VOYAGE_CHAPTERS.filter(chapter => chapter.shardWorld !== undefined)
    .every(chapter => read.has(chapter.id));
  return VOYAGE_CHAPTERS.filter(chapter => hasChapterPrerequisites(chapter, progress, dangers, bosses)
    && (chapter.id === reforgingId ? allShardsRead
      : chapter.id === ascentId ? allShardsRead && read.has(reforgingId) : true));
}

export function canReadVoyageChapter(
  story: WorldStoryProgress,
  progress: WorldProgress,
  dangers: DangerState,
  bosses: BossProgress,
  id: string,
): boolean {
  return unlockedVoyageChapters(story, progress, dangers, bosses).some(chapter => chapter.id === id);
}

export function nextAvailableVoyageChapter(
  story: WorldStoryProgress,
  progress: WorldProgress,
  dangers: DangerState,
  bosses: BossProgress,
): VoyageChapter | undefined {
  const read = new Set(acknowledgedVoyageChapters(story).map(chapter => chapter.id));
  return unlockedVoyageChapters(story, progress, dangers, bosses).find(chapter => !read.has(chapter.id));
}

/** Use this view for recaps, replays and recovered-shard scenery. A previously
 * unrestricted story save keeps its original ledger; hidden pages reappear
 * when the student earns their prerequisites. Never persist this filtered view. */
export function eligibleStoryProgress(
  story: WorldStoryProgress,
  progress: WorldProgress,
  dangers: DangerState,
  bosses: BossProgress,
): WorldStoryProgress {
  if (!story.readChapters?.length) return story;
  const unlocked = new Set(unlockedVoyageChapters(story, progress, dangers, bosses).map(chapter => chapter.id));
  const readChapters = story.readChapters.filter(id => unlocked.has(id));
  return readChapters.length === story.readChapters.length ? story : { ...story, readChapters };
}

/** The recap honors the same earned route as books and encounters. Old
 * read-ahead flags and legacy packet briefings stay saved without revealing
 * unreachable pages through the library. */
export function availableStorySoFar(
  story: WorldStoryProgress,
  progress: WorldProgress,
  dangers: DangerState,
  bosses: BossProgress,
): ReturnType<typeof storySoFar> {
  const eligible = eligibleStoryProgress(story, progress, dangers, bosses);
  const reachable = new Set([...DANGERS, ...BOSS_CHALLENGES]
    .filter(encounter => canNavigateDestination(progress, dangers, encounter.id, false, bosses))
    .map(encounter => encounter.id));
  return storySoFar({ ...eligible, readEncounters: eligible.readEncounters.filter(id => reachable.has(id)) },
    { ...dangers, packets: Object.fromEntries(Object.entries(dangers.packets).filter(([id]) => reachable.has(id))) });
}
