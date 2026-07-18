import { gameInfo } from "./catalog";

export const whoseLeftGame = {
  ...gameInfo,
  slug: "whose-left",
  href: "/games/whose-left",
  status: "playable",
} as const;
