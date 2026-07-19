import { gameInfo } from "./catalog";

export const braceletSearchGame = {
  ...gameInfo,
  slug: "bracelet-search",
  href: "/games/bracelet-search",
  status: "playable",
} as const;
