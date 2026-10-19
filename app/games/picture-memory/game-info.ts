import type { GameInfo } from "../../../lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const pictureMemoryGame = {
  title: "Picture Memory",
  description:
    "Study a group of everyday objects, hide it, and pick the pictures you remember.",
  skills: ["Visual memory", "Recognition", "Focused attention"],
  estimatedMinutes: 12,
  progression: progressionMetadata,
  shelfOrder: 95,
  slug: "picture-memory",
  href: "/games/picture-memory/",
  status: "playable",
} as const satisfies GameInfo & {
  slug: string;
  href: `/games/${string}/`;
  status: string;
};
