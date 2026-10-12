import { WORLD_DEFINITIONS } from "./world-data.ts";
import type { WorldProgress } from "./engine.ts";
import type { StorageLike } from "../../lib/progression/types.ts";
import { VOYAGE_CHAPTERS, type VoyageChapter } from "./voyage-story-content.ts";

export type StoryEnding = "unseen" | "shattering" | "appeal" | "complete";
export type AutomaticStoryPage = "intro" | "fracture" | "shattering" | "appeal";
export type WorldStoryProgress = Readonly<{
  version: 1;
  introSeen: boolean;
  readBooks: readonly number[];
  readEncounters: readonly string[];
  readChapters?: readonly string[];
  ending: StoryEnding;
}>;
export const WORLD_STORY_STORAGE_KEY = "spatial-gym-math-world-story-v1";
export const WORLD_STORY_PLAYTEST_KEY = "spatial-gym-math-world-story-playtest-v1";
export const createStoryProgress = (): WorldStoryProgress => ({ version: 1, introSeen: false, readBooks: [], readEncounters: [], ending: "unseen" });
const encounterIds = new Set(["boss-2025", "boss-2026", ...Array.from({ length: 16 }, (_, index) => `danger-${String((index + 1) * 2).padStart(2, "0")}`)]);
const chapterIds: ReadonlySet<string> = new Set(VOYAGE_CHAPTERS.map(chapter => chapter.id));
const shardChapterIds = VOYAGE_CHAPTERS.filter(chapter => chapter.shardWorld !== undefined).map(chapter => chapter.id);
const reforgingId = "oceania-voyage-reforging", ascentId = "oceania-voyage-ascent";
function sanitizedChapterReads(values: readonly unknown[]): string[] {
  const read = [...new Set(values.filter((value): value is string => typeof value === "string" && chapterIds.has(value)))];
  const allShardsRead = shardChapterIds.every(id => read.includes(id));
  return read.filter(id => id === reforgingId ? allShardsRead
    : id === ascentId ? allShardsRead && read.includes(reforgingId) : true);
}

/** Validated acknowledged pages only; future finale flags never expose a page. */
export function acknowledgedVoyageChapters(story: WorldStoryProgress): VoyageChapter[] {
  if (story.ending !== "complete") return [];
  const read = new Set(sanitizedChapterReads(story.readChapters ?? []));
  return VOYAGE_CHAPTERS.filter(chapter => read.has(chapter.id));
}

/** The optional voyage follows the existing sundering. Its acknowledgements
 * belong only to the story ledger, independently of questions and packets. */
export function nextVoyageChapter(story: WorldStoryProgress): VoyageChapter | undefined {
  if (story.ending !== "complete") return undefined;
  const read = new Set(sanitizedChapterReads(story.readChapters ?? []));
  return VOYAGE_CHAPTERS.find(chapter => !read.has(chapter.id));
}
export function markVoyageChapterRead(story: WorldStoryProgress, id: string): WorldStoryProgress {
  const read = sanitizedChapterReads(story.readChapters ?? []);
  const permitted = id === reforgingId ? shardChapterIds.every(shardId => read.includes(shardId))
    : id === ascentId ? read.includes(reforgingId) : true;
  return story.ending === "complete" && permitted && chapterIds.has(id) && !read.includes(id)
    ? { ...story, readChapters: [...read, id] } : story;
}
export function recoveredShardWorlds(story: WorldStoryProgress): number[] {
  return [...new Set(acknowledgedVoyageChapters(story).flatMap(chapter =>
    chapter.shardWorld !== undefined ? [chapter.shardWorld] : []))];
}

/** A reading acknowledgement only: no question, packet or voyage state changes. */
export function markEncounterRead(story: WorldStoryProgress, id: string): WorldStoryProgress {
  return encounterIds.has(id) && !story.readEncounters.includes(id)
    ? { ...story, readEncounters: [...story.readEncounters, id] } : story;
}
export function firstWorldComplete(progress: WorldProgress): boolean {
  return WORLD_DEFINITIONS[0].stopIds.every(id => progress.completedStopIds.includes(id));
}
export function pendingFirstWorldEnding(story: WorldStoryProgress, progress: WorldProgress): boolean {
  return progress.selectedWorldId === WORLD_DEFINITIONS[0].id && firstWorldComplete(progress) && story.ending !== "complete";
}
export function automaticStoryPage(story: WorldStoryProgress, progress: WorldProgress, worldId: string, isBoss = false): AutomaticStoryPage | null {
  if (isBoss || worldId !== WORLD_DEFINITIONS[0].id) return null;
  if (!story.introSeen) return "intro";
  if (!firstWorldComplete(progress) || story.ending === "complete") return null;
  return story.ending === "unseen" ? "fracture" : story.ending;
}
export function advanceStoryPage(story: WorldStoryProgress, page: AutomaticStoryPage): WorldStoryProgress {
  if (page === "intro") return { ...story, introSeen: true };
  if (page === "fracture" && story.ending === "unseen") return { ...story, ending: "shattering" };
  if (page === "shattering" && story.ending === "shattering") return { ...story, ending: "appeal" };
  if (page === "appeal" && story.ending === "appeal") return { ...story, ending: "complete" };
  return story;
}
export function markStoryBookRead(story: WorldStoryProgress, index: number): WorldStoryProgress {
  return (index === 0 || index === 1) && !story.readBooks.includes(index)
    ? { ...story, readBooks: [...story.readBooks, index].sort() } : story;
}
function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
export function readStoryProgress(qa = false, storage: StorageLike | null = browserStorage()): WorldStoryProgress {
  try {
    const raw = JSON.parse(storage?.getItem(qa ? WORLD_STORY_PLAYTEST_KEY : WORLD_STORY_STORAGE_KEY) ?? "null");
    if (!raw || raw.version !== 1 || typeof raw.introSeen !== "boolean" || !["unseen", "shattering", "appeal", "complete"].includes(raw.ending)) return createStoryProgress();
    return { version: 1, introSeen: raw.introSeen, ending: raw.ending,
      readBooks: Array.isArray(raw.readBooks) ? [...new Set<number>(raw.readBooks.filter((value: unknown) => value === 0 || value === 1))].sort() : [],
      readEncounters: Array.isArray(raw.readEncounters) ? [...new Set<string>(raw.readEncounters.filter((value: unknown) => typeof value === "string" && encounterIds.has(value)))] : [],
      ...(Array.isArray(raw.readChapters) ? { readChapters: raw.ending === "complete" ? sanitizedChapterReads(raw.readChapters) : [] } : {}) };
  } catch { return createStoryProgress(); }
}
export function writeStoryProgress(story: WorldStoryProgress, qa = false, storage: StorageLike | null = browserStorage()): void {
  try { storage?.setItem(qa ? WORLD_STORY_PLAYTEST_KEY : WORLD_STORY_STORAGE_KEY, JSON.stringify(story)); } catch { /* Reading remains available in memory. */ }
}
