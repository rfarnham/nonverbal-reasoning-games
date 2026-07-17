import { gameInfo } from "./catalog";

export const patternMatrixGame = {
  ...gameInfo,
  slug: "pattern-matrix",
  href: "/games/pattern-matrix",
  status: "playable",
} as const;
