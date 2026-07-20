import {
  JOURNEY_GAMES_PER_BOARD,
  PROGRESSION_LEVELS,
  TURBO_ACTIVE_TIME_MS,
  XP_PER_STOP,
  type JourneyBoard,
  type JourneyGame,
  type JourneyNode,
  type JourneyPlan,
  type ProgressionLevel,
} from "./types.ts";

function nodeId(
  level: ProgressionLevel,
  kind: JourneyNode["kind"],
  position: number,
  gameSlug?: string,
): string {
  return [level, String(position + 1).padStart(2, "0"), kind, gameSlug]
    .filter(Boolean)
    .join(":");
}

function validateGameSnapshot(
  games: readonly JourneyGame[],
): readonly JourneyGame[] {
  if (games.length === 0) {
    throw new Error("A journey snapshot needs at least one game.");
  }

  const seen = new Set<string>();
  const validated = games.map((game) => {
    const slug = game.slug.trim();
    const title = game.title.trim();
    if (!slug || !title) {
      throw new Error("Every journey game needs a non-empty slug and title.");
    }
    if (seen.has(slug)) {
      throw new Error(`Duplicate journey game slug: ${slug}`);
    }
    seen.add(slug);
    return {
      slug,
      title,
      ...(game.contentVersion
        ? { contentVersion: game.contentVersion.trim() }
        : {}),
      ...(game.generatorVersion
        ? { generatorVersion: game.generatorVersion.trim() }
        : {}),
    };
  });
  return validated.slice(0, JOURNEY_GAMES_PER_BOARD);
}

/**
 * Creates one deterministic board without knowing anything about a minigame.
 * Each pair of normal stops is followed by Turbo Time. Alternating the Turbo
 * member by board gives each member of a full eight-game snapshot two Turbo
 * appearances across four boards. Smaller snapshots repeat in stable order so
 * the board still keeps its eight-normal, four-Turbo cadence.
 */
export function buildJourneyBoard(
  level: ProgressionLevel,
  games: readonly JourneyGame[],
): JourneyBoard {
  const boardIndex = PROGRESSION_LEVELS.indexOf(level);
  if (boardIndex < 0) {
    throw new Error(`Unknown progression level: ${level}`);
  }

  if (!games.length) {
    throw new Error("A journey board needs at least one game.");
  }
  const ordinaryGames = Array.from(
    { length: JOURNEY_GAMES_PER_BOARD },
    (_, index) => games[index % games.length]!,
  );
  const nodes: JourneyNode[] = [];
  for (
    let pairStart = 0;
    pairStart < ordinaryGames.length;
    pairStart += 2
  ) {
    const first = ordinaryGames[pairStart]!;
    const second = ordinaryGames[pairStart + 1]!;

    for (const game of [first, second]) {
      const position = nodes.length;
      nodes.push({
        id: nodeId(level, "normal", position, game.slug),
        kind: "normal",
        level,
        position,
        gameSlug: game.slug,
        questionCount: 12,
        xp: XP_PER_STOP[level],
      });
    }

    const turboGame = boardIndex % 2 === 0 ? first : second;
    const position = nodes.length;
    nodes.push({
      id: nodeId(level, "turbo", position, turboGame.slug),
      kind: "turbo",
      level,
      position,
      gameSlug: turboGame.slug,
      activeTimeMs: TURBO_ACTIVE_TIME_MS,
      xp: XP_PER_STOP[level],
    });
  }

  const culminationPosition = nodes.length;
  nodes.push({
    id: nodeId(level, "culmination", culminationPosition),
    kind: "culmination",
    level,
    position: culminationPosition,
    gameSlugs: games.map(({ slug }) => slug),
    questionsPerGame: 3,
    xp: XP_PER_STOP[level],
  });

  return {
    level,
    position: boardIndex,
    nodes,
    availableXp: nodes.length * XP_PER_STOP[level],
  };
}

export function buildJourneyPlan(
  gameSnapshot: readonly JourneyGame[],
): JourneyPlan {
  const games = validateGameSnapshot(gameSnapshot);
  return {
    gameSnapshot: games,
    boards: PROGRESSION_LEVELS.map((level) =>
      buildJourneyBoard(level, games),
    ),
  };
}

export function findJourneyNode(
  journey: JourneyPlan,
  stopId: string,
): JourneyNode | undefined {
  for (const board of journey.boards) {
    const node = board.nodes.find(({ id }) => id === stopId);
    if (node) return node;
  }
  return undefined;
}

export function previousJourneyNodeIds(
  journey: JourneyPlan,
  stopId: string,
): readonly string[] {
  const flattened = journey.boards.flatMap(({ nodes }) => nodes);
  const stopIndex = flattened.findIndex(({ id }) => id === stopId);
  return stopIndex < 0
    ? []
    : flattened.slice(0, stopIndex).map(({ id }) => id);
}

export function isJourneyNodeUnlocked(
  journey: JourneyPlan,
  clearedStopIds: readonly string[],
  stopId: string,
): boolean {
  const previousIds = previousJourneyNodeIds(journey, stopId);
  if (!findJourneyNode(journey, stopId)) return false;
  const cleared = new Set(clearedStopIds);
  return previousIds.every((id) => cleared.has(id));
}

export function nextJourneyNode(
  journey: JourneyPlan,
  stopId: string,
): JourneyNode | undefined {
  const flattened = journey.boards.flatMap(({ nodes }) => nodes);
  const stopIndex = flattened.findIndex(({ id }) => id === stopId);
  return stopIndex < 0 ? undefined : flattened[stopIndex + 1];
}
