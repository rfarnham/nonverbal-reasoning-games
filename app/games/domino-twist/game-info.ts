import { gameInfo } from "./catalog";

export const dominoTwistGame = {
  ...gameInfo,
  slug: "domino-twist",
  href: "/games/domino-twist",
  status: "playable",
} as const;
