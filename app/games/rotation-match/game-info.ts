import { gameInfo } from "./catalog";

export const rotationMatchGame = {
  ...gameInfo,
  slug: "rotation-match",
  href: "/games/rotation-match",
  status: "playable",
} as const;
