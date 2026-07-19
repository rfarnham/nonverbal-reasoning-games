import { gameInfo } from "./catalog";

export const shapeFoldGame = {
  ...gameInfo,
  slug: "shape-fold",
  href: "/games/shape-fold",
  status: "playable",
} as const;
