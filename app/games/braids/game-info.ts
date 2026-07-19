import { gameInfo } from "./catalog";

export const braidsGame = {
  ...gameInfo,
  slug: "braids",
  href: "/games/braids",
  status: "playable",
} as const;
