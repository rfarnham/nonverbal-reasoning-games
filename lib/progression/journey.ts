import {
  JOURNEY_GAMES_PER_BOARD,
  JOURNEY_LEVELS,
  REVIEW_CULMINATION_QUESTIONS,
  REVIEW_QUESTIONS_PER_STOP,
  TURBO_ACTIVE_TIME_MS,
  XP_PER_STOP,
  XP_PER_JOURNEY_STOP,
  firstJourneyLevelForDifficulty,
  isJourneyLevel,
  journeyCampaignCollectionId,
  journeyLevelDifficulty,
  journeyReviewCollectionId,
  type JourneyBoard,
  type CulminationSectionSpec,
  type JourneyGame,
  type JourneyLevel,
  type JourneyNode,
  type JourneyPlan,
  type JourneyPlanVersion,
  type ProgressionLevel,
} from "./types.ts";

function legacyNodeId(
  level: ProgressionLevel,
  kind: JourneyNode["kind"],
  position: number,
  gameSlug?: string,
): string {
  return [level, String(position + 1).padStart(2, "0"), kind, gameSlug]
    .filter(Boolean)
    .join(":");
}

function nodeId(
  journeyLevel: JourneyLevel,
  kind: JourneyNode["kind"],
  ordinal: number,
  gameSlug?: string,
): string {
  return [
    journeyLevel,
    kind,
    String(ordinal + 1).padStart(2, "0"),
    gameSlug,
  ]
    .filter(Boolean)
    .join(":");
}

function normalizedJourneyLevel(
  level: JourneyLevel | ProgressionLevel,
): JourneyLevel {
  return isJourneyLevel(level)
    ? level
    : firstJourneyLevelForDifficulty(level);
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
    const role = game.role ?? "game";
    if (role !== "game" && role !== "review") {
      throw new Error(`Unknown journey game role for ${slug}.`);
    }
    return {
      slug,
      title,
      role,
      ...(game.contentVersion
        ? { contentVersion: game.contentVersion.trim() }
        : {}),
      ...(game.generatorVersion
        ? { generatorVersion: game.generatorVersion.trim() }
        : {}),
      ...(game.journeyContentVersion
        ? { journeyContentVersion: game.journeyContentVersion.trim() }
        : {}),
    };
  });

  const coreGames = validated
    .filter(({ role }) => role === "game")
    .slice(0, JOURNEY_GAMES_PER_BOARD);
  const reviewGames = validated.filter(({ role }) => role === "review");
  if (reviewGames.length > 1) {
    throw new Error("A journey snapshot currently supports one review provider.");
  }
  if (!coreGames.length) {
    throw new Error("A journey snapshot needs at least one canonical game.");
  }
  return [...coreGames, ...reviewGames];
}

function canonicalGames(
  games: readonly JourneyGame[],
): readonly JourneyGame[] {
  return games
    .filter(({ role }) => (role ?? "game") === "game")
    .slice(0, JOURNEY_GAMES_PER_BOARD);
}

function reviewProvider(
  games: readonly JourneyGame[],
): JourneyGame | undefined {
  return games.find(({ role }) => role === "review");
}

/**
 * Creates one deterministic board without knowing any provider slug.
 *
 * Starter preserves the original `(normal, normal, turbo) × 4` cadence.
 * Junior and above place a generic review stop after each half of that path:
 * `(N,N,T) × 2, review, (N,N,T) × 2, review, culmination`.
 *
 * Node IDs use a semantic kind ordinal, not their visual position, so later
 * cadence changes do not renumber unrelated stops.
 */
export function buildJourneyBoard(
  level: JourneyLevel | ProgressionLevel,
  games: readonly JourneyGame[],
): JourneyBoard {
  const journeyLevel = normalizedJourneyLevel(level);
  const boardIndex = JOURNEY_LEVELS.indexOf(journeyLevel);
  if (boardIndex < 0) {
    throw new Error(`Unknown journey level: ${level}`);
  }

  const coreGames = canonicalGames(games);
  if (!coreGames.length) {
    throw new Error("A journey board needs at least one canonical game.");
  }
  const reviewGame = reviewProvider(games);
  if (journeyLevel !== "starter" && !reviewGame) {
    throw new Error(
      `${journeyLevel} needs one discovered review provider.`,
    );
  }
  const difficulty = journeyLevelDifficulty(journeyLevel);
  const xp = XP_PER_JOURNEY_STOP[journeyLevel];
  const ordinaryGames = Array.from(
    { length: JOURNEY_GAMES_PER_BOARD },
    (_, index) => coreGames[index % coreGames.length]!,
  );
  const useSecondTurboGame =
    journeyLevel === "junior-1" ||
    journeyLevel === "expert-2" ||
    journeyLevel === "wizard-1";
  const nodes: JourneyNode[] = [];
  let normalOrdinal = 0;
  let turboOrdinal = 0;
  let reviewOrdinal = 0;

  for (
    let pairStart = 0;
    pairStart < ordinaryGames.length;
    pairStart += 2
  ) {
    const pairIndex = pairStart / 2;
    const first = ordinaryGames[pairStart]!;
    const second = ordinaryGames[pairStart + 1]!;

    for (const game of [first, second]) {
      nodes.push({
        id: nodeId(journeyLevel, "normal", normalOrdinal, game.slug),
        kind: "normal",
        journeyLevel,
        level: difficulty,
        position: nodes.length,
        gameSlug: game.slug,
        collectionId: journeyCampaignCollectionId(journeyLevel),
        questionOffset: 0,
        questionCount: 12,
        xp,
      });
      normalOrdinal += 1;
    }

    const turboGame = useSecondTurboGame ? second : first;
    nodes.push({
      id: nodeId(journeyLevel, "turbo", turboOrdinal, turboGame.slug),
      kind: "turbo",
      journeyLevel,
      level: difficulty,
      position: nodes.length,
      gameSlug: turboGame.slug,
      activeTimeMs: TURBO_ACTIVE_TIME_MS,
      xp,
    });
    turboOrdinal += 1;

    const finishesBoardHalf = pairIndex === 1 || pairIndex === 3;
    if (
      journeyLevel !== "starter" &&
      reviewGame &&
      finishesBoardHalf
    ) {
      nodes.push({
        id: nodeId(
          journeyLevel,
          "review",
          reviewOrdinal,
          reviewGame.slug,
        ),
        kind: "review",
        journeyLevel,
        level: difficulty,
        position: nodes.length,
        gameSlug: reviewGame.slug,
        collectionId: journeyReviewCollectionId(journeyLevel),
        questionOffset: reviewOrdinal * REVIEW_QUESTIONS_PER_STOP,
        questionCount: REVIEW_QUESTIONS_PER_STOP,
        xp,
      });
      reviewOrdinal += 1;
    }
  }

  const sections: CulminationSectionSpec[] = [
    ...coreGames.map(({ slug }) => ({
      selection: "mistakes" as const,
      gameSlug: slug,
      questionCount: 3 as const,
    })),
    ...(journeyLevel !== "starter" && reviewGame
      ? [
          {
            selection: "fixed" as const,
            gameSlug: reviewGame.slug,
            collectionId: journeyReviewCollectionId(journeyLevel),
            questionOffset:
              REVIEW_QUESTIONS_PER_STOP * 2,
            questionCount: REVIEW_CULMINATION_QUESTIONS as 4,
          },
        ]
      : []),
  ];
  nodes.push({
    id: nodeId(journeyLevel, "culmination", 0),
    kind: "culmination",
    journeyLevel,
    level: difficulty,
    position: nodes.length,
    sections,
    gameSlugs: coreGames.map(({ slug }) => slug),
    questionsPerGame: 3,
    xp,
  });

  return {
    journeyLevel,
    level: difficulty,
    position: boardIndex,
    nodes,
    availableXp: nodes.length * xp,
  };
}

export function buildJourneyPlan(
  gameSnapshot: readonly JourneyGame[],
): JourneyPlan {
  const games = validateGameSnapshot(gameSnapshot);
  if (!reviewProvider(games)) {
    throw new Error(
      "The current Journey plan needs one discovered review provider.",
    );
  }
  return {
    gameSnapshot: games,
    boards: JOURNEY_LEVELS.map((level) =>
      buildJourneyBoard(level, games),
    ),
  };
}

/**
 * Reconstructs the original four-board plan byte-for-byte at the node-ID
 * boundary so a saved in-flight schema-v2 attempt can finish safely. New
 * profiles never start on this plan.
 */
export function buildLegacyJourneyPlan(
  gameSnapshot: readonly JourneyGame[],
): JourneyPlan {
  const games = validateGameSnapshot(gameSnapshot).filter(
    ({ role }) => role === "game",
  );
  const legacyLevels: readonly ProgressionLevel[] = [
    "starter",
    "junior",
    "expert",
    "wizard",
  ];
  const boards = legacyLevels.map((level, boardIndex): JourneyBoard => {
    const journeyLevel = firstJourneyLevelForDifficulty(level);
    const ordinaryGames = Array.from(
      { length: JOURNEY_GAMES_PER_BOARD },
      (_, index) => games[index % games.length]!,
    );
    const nodes: JourneyNode[] = [];
    for (let pairStart = 0; pairStart < ordinaryGames.length; pairStart += 2) {
      const first = ordinaryGames[pairStart]!;
      const second = ordinaryGames[pairStart + 1]!;
      for (const game of [first, second]) {
        const position = nodes.length;
        nodes.push({
          id: legacyNodeId(level, "normal", position, game.slug),
          kind: "normal",
          journeyLevel,
          level,
          position,
          gameSlug: game.slug,
          collectionId: journeyCampaignCollectionId(journeyLevel),
          questionOffset: 0,
          questionCount: 12,
          xp: XP_PER_STOP[level],
        });
      }
      const turboGame = boardIndex % 2 === 0 ? first : second;
      const position = nodes.length;
      nodes.push({
        id: legacyNodeId(level, "turbo", position, turboGame.slug),
        kind: "turbo",
        journeyLevel,
        level,
        position,
        gameSlug: turboGame.slug,
        activeTimeMs: TURBO_ACTIVE_TIME_MS,
        xp: XP_PER_STOP[level],
      });
    }
    const position = nodes.length;
    const gameSlugs = games.map(({ slug }) => slug);
    nodes.push({
      id: legacyNodeId(level, "culmination", position),
      kind: "culmination",
      journeyLevel,
      level,
      position,
      sections: gameSlugs.map((gameSlug) => ({
        selection: "mistakes" as const,
        gameSlug,
        questionCount: 3 as const,
      })),
      gameSlugs,
      questionsPerGame: 3,
      xp: XP_PER_STOP[level],
    });
    return {
      journeyLevel,
      level,
      position: boardIndex,
      nodes,
      availableXp: nodes.length * XP_PER_STOP[level],
    };
  });
  return { gameSnapshot: games, boards };
}

export function buildJourneyPlanForVersion(
  gameSnapshot: readonly JourneyGame[],
  version: JourneyPlanVersion,
): JourneyPlan {
  return version === 1
    ? buildLegacyJourneyPlan(gameSnapshot)
    : buildJourneyPlan(gameSnapshot);
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
