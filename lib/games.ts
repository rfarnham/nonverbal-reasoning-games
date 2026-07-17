import { discoveredGames } from "./generated/game-registry";
import type { GameCatalogEntry } from "./game-catalog-types";

const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateGame(game: GameCatalogEntry): GameCatalogEntry {
  if (!GAME_SLUG.test(game.slug)) {
    throw new Error(`Invalid discovered game slug: ${game.slug}`);
  }
  if (game.href !== `/games/${game.slug}/`) {
    throw new Error(`Game "${game.slug}" has a route that does not match its slug.`);
  }
  if (!game.title.trim() || !game.description.trim()) {
    throw new Error(`Game "${game.slug}" needs a title and description.`);
  }
  if (
    game.skills.length === 0 ||
    game.skills.some((skill) => !skill.trim())
  ) {
    throw new Error(`Game "${game.slug}" needs at least one named skill.`);
  }
  if (
    !Number.isInteger(game.estimatedMinutes) ||
    game.estimatedMinutes < 1
  ) {
    throw new Error(`Game "${game.slug}" has invalid estimated minutes.`);
  }
  if (
    game.shelfOrder !== undefined &&
    !Number.isFinite(game.shelfOrder)
  ) {
    throw new Error(`Game "${game.slug}" has an invalid shelf order.`);
  }
  return game;
}

const validatedGames = discoveredGames.map(validateGame);
const slugs = validatedGames.map(({ slug }) => slug);
if (new Set(slugs).size !== slugs.length) {
  throw new Error("Discovered game slugs must be unique.");
}

export const games = [...validatedGames].sort((left, right) => {
  const orderDifference =
    (left.shelfOrder ?? Number.MAX_SAFE_INTEGER) -
    (right.shelfOrder ?? Number.MAX_SAFE_INTEGER);
  return (
    orderDifference ||
    compareText(left.title, right.title) ||
    compareText(left.slug, right.slug)
  );
});

export type { GameCatalogEntry, GameInfo, ShelfIconProps } from "./game-catalog-types";
