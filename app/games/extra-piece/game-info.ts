import { gameInfo } from "./catalog";

export const extraPieceGame = {
  ...gameInfo,
  slug: "extra-piece",
  href: "/games/extra-piece",
  status: "playable",
} as const;
