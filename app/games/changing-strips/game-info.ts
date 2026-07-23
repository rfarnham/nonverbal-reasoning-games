import { gameInfo } from "./catalog";

export const changingStripsGame = {
  ...gameInfo,
  slug: "changing-strips",
  href: "/games/changing-strips",
  status: "playable",
} as const;
