import { WORLD_DEFINITIONS } from "./world-data.ts";
import type { WorldProgress } from "./engine.ts";
import type { StorageLike } from "../../lib/progression/types.ts";

export type StoryEnding = "unseen" | "shattering" | "appeal" | "complete";
export type AutomaticStoryPage = "intro" | "fracture" | "shattering" | "appeal";
export type WorldStoryProgress = Readonly<{
  version: 1;
  introSeen: boolean;
  readBooks: readonly number[];
  ending: StoryEnding;
}>;
export const WORLD_STORY_STORAGE_KEY = "spatial-gym-math-world-story-v1";
export const WORLD_STORY_PLAYTEST_KEY = "spatial-gym-math-world-story-playtest-v1";
export const createStoryProgress = (): WorldStoryProgress => ({ version: 1, introSeen: false, readBooks: [], ending: "unseen" });
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
      readBooks: Array.isArray(raw.readBooks) ? [...new Set<number>(raw.readBooks.filter((value: unknown) => value === 0 || value === 1))].sort() : [] };
  } catch { return createStoryProgress(); }
}
export function writeStoryProgress(story: WorldStoryProgress, qa = false, storage: StorageLike | null = browserStorage()): void {
  try { storage?.setItem(qa ? WORLD_STORY_PLAYTEST_KEY : WORLD_STORY_STORAGE_KEY, JSON.stringify(story)); } catch { /* Reading remains available in memory. */ }
}
