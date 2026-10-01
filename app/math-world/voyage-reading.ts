import { BOSS_CHALLENGES } from "./boss-challenges.ts";
import { BOSS_STORIES } from "./boss-story-content.ts";
import { DANGER_STORIES } from "./danger-content.ts";
import { GLOBE_DANGER_LOCATIONS } from "./globe-danger-locations.ts";
import { FIRST_WORLD_STORY } from "./story-content.ts";
import type { DangerState } from "./danger-engine.ts";
import type { StoryPageProps } from "./StoryPage";
import type { WorldStoryProgress } from "./story-progress.ts";

/** A small field guide to words used in Oceania's story and scenery. */
export const VOYAGE_GLOSSARY = [
  { term: "Archipelago", definition: "A group of islands close to one another." },
  { term: "Coral", definition: "Tiny sea animals whose hard skeletons can build reefs." },
  { term: "Current", definition: "A steady flow of water moving in one direction." },
  { term: "Fog bank", definition: "A thick patch of cloud near the ground or sea." },
  { term: "Glacier", definition: "A huge mass of ice that slowly moves across land." },
  { term: "Harbor", definition: "A sheltered place where boats can rest safely." },
  { term: "Horizon", definition: "The faraway line where the sky seems to meet land or sea." },
  { term: "Hurricane", definition: "A huge, spinning ocean storm with very strong winds and heavy rain." },
  { term: "Iceberg", definition: "A large piece of glacier ice floating in the sea." },
  { term: "Kraken", definition: "A legendary giant sea creature said to have enormous reaching arms." },
  { term: "Maelstrom", definition: "A powerful whirlpool that pulls water around and toward its center." },
  { term: "Octahedron", definition: "A solid shape with eight triangular faces." },
  { term: "Reef", definition: "A ridge of rock or coral near the sea’s surface." },
  { term: "Shard", definition: "A sharp piece broken from something hard, such as glass or crystal." },
  { term: "Squall", definition: "A sudden, short burst of strong wind, often with rain." },
  { term: "Summit", definition: "The highest point of a hill or mountain." },
  { term: "Tide", definition: "The regular rise and fall of the sea." },
  { term: "Voyage", definition: "A long journey, especially a trip across the sea." },
] as const satisfies readonly Readonly<{ term: string; definition: string }>[];

/** Reading history is independent of map access, including QA unlocks. Repeated
 * danger kinds share one chronicle page; their packets remain separate. */
export function storySoFar(story: WorldStoryProgress, dangers: DangerState): StoryPageProps["page"][] {
  const pages: StoryPageProps["page"][] = [];
  if (story.introSeen) pages.push(FIRST_WORLD_STORY.intro);
  if (story.readBooks.includes(0)) pages.push(FIRST_WORLD_STORY.book1);
  if (story.readBooks.includes(1)) pages.push(FIRST_WORLD_STORY.book2);
  if (story.ending !== "unseen") pages.push(FIRST_WORLD_STORY.fracture);
  if (story.ending === "complete") pages.push(FIRST_WORLD_STORY.appeal);

  const read = new Set(story.readEncounters ?? []);
  // Packets predate the explicit reading ledger. Preparing or printing a packet
  // alone is not evidence that its introduction was read.
  for (const danger of GLOBE_DANGER_LOCATIONS) {
    const packet = dangers.packets[danger.id];
    if (packet?.briefingRead || packet?.completedAt) read.add(danger.id);
  }
  const encounters = [
    ...GLOBE_DANGER_LOCATIONS.map(danger => ({ id: danger.id, order: danger.afterWorld * 2, page: DANGER_STORIES[danger.kind] })),
    ...BOSS_CHALLENGES.map(boss => ({ id: boss.id, order: boss.afterWorld * 2 + 1, page: BOSS_STORIES[boss.id] })),
  ].sort((a, b) => a.order - b.order);
  const included = new Set<string>();
  for (const encounter of encounters) {
    if (read.has(encounter.id) && !included.has(encounter.page.id)) {
      pages.push(encounter.page);
      included.add(encounter.page.id);
    }
  }
  return pages;
}
