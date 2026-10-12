import { gameInfo } from "./catalog";

export const foldedItemsGame = {
  ...gameInfo,
  slug: "folded-items",
  href: "/games/folded-items",
  status: "playable",
} as const;
