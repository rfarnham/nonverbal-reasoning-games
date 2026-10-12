import {
  LEGACY_JOURNEY_GAMES_PER_BOARD,
  JOURNEY_LEVELS,
  REVIEW_CULMINATION_QUESTIONS,
  REVIEW_QUESTIONS_PER_STOP,
  TURBO_ACTIVE_TIME_MS,
  TURBO_STOPS_PER_BOARD,
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
  type PlayerProfile,
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

  const coreGames = validated.filter(({ role }) => role === "game");
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
  return games.filter(({ role }) => (role ?? "game") === "game");
}

function reviewProvider(
  games: readonly JourneyGame[],
): JourneyGame | undefined {
  return games.find(({ role }) => role === "review");
}

/**
 * Creates one deterministic board without knowing any provider slug.
 *
 * Current boards teach every canonical game, split into four groups with a
 * Turbo stop after each. Junior and above add a review after groups two and four.
 * Version two remains frozen so saved stops can be reconstructed exactly.
 *
 * Node IDs use a semantic kind ordinal, not their visual position, so later
 * cadence changes do not renumber unrelated stops.
 */
export function buildJourneyBoard(
  level: JourneyLevel | ProgressionLevel,
  games: readonly JourneyGame[],
  version: 2 | 3 = 3,
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
  // This window belongs only to frozen v2 profiles, never a new journey.
  const gameOffset =
    coreGames.length > LEGACY_JOURNEY_GAMES_PER_BOARD
      ? boardIndex * LEGACY_JOURNEY_GAMES_PER_BOARD
      : 0;
  const ordinaryGames = version === 2
    ? Array.from(
        { length: LEGACY_JOURNEY_GAMES_PER_BOARD },
        (_, index) => coreGames[(gameOffset + index) % coreGames.length]!,
      )
    : coreGames;
  const useSecondTurboGame =
    journeyLevel === "junior-1" ||
    journeyLevel === "expert-2" ||
    journeyLevel === "wizard-1";
  const nodes: JourneyNode[] = [];
  let normalOrdinal = 0;
  let turboOrdinal = 0;
  let reviewOrdinal = 0;

  for (let groupIndex = 0; groupIndex < TURBO_STOPS_PER_BOARD; groupIndex += 1) {
    const start = Math.ceil(groupIndex * ordinaryGames.length / TURBO_STOPS_PER_BOARD);
    const end = Math.ceil((groupIndex + 1) * ordinaryGames.length / TURBO_STOPS_PER_BOARD);
    const group = ordinaryGames.slice(start, end);

    for (const game of group) {
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

    const turboGame = version === 3 && coreGames.length > LEGACY_JOURNEY_GAMES_PER_BOARD
      ? coreGames[(boardIndex * TURBO_STOPS_PER_BOARD + groupIndex) % coreGames.length]!
      : (group[useSecondTurboGame ? 1 : 0] ?? group[0] ??
        coreGames[(boardIndex + groupIndex) % coreGames.length]!);
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

    const finishesBoardHalf = groupIndex === 1 || groupIndex === 3;
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
  version: 2 | 3 = 3,
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
      buildJourneyBoard(level, games, version),
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
  const games = validateGameSnapshot(gameSnapshot)
    .filter(({ role }) => role === "game")
    .slice(0, LEGACY_JOURNEY_GAMES_PER_BOARD);
  const legacyLevels: readonly ProgressionLevel[] = [
    "starter",
    "junior",
    "expert",
    "wizard",
  ];
  const boards = legacyLevels.map((level, boardIndex): JourneyBoard => {
    const journeyLevel = firstJourneyLevelForDifficulty(level);
    const ordinaryGames = Array.from(
      { length: LEGACY_JOURNEY_GAMES_PER_BOARD },
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
  additions: readonly JourneyGame[] = [],
  coverageVersion?: 1,
): JourneyPlan {
  const original = version === 1
    ? buildLegacyJourneyPlan(gameSnapshot)
    : buildJourneyPlan(gameSnapshot, version);
  if (coverageVersion !== undefined && (coverageVersion !== 1 || version !== 2)) {
    throw new Error("Coverage repair requires a version-two Journey plan.");
  }
  if (!additions.length && !coverageVersion) return original;
  if (version === 1 || additions.some(({ role }) => role === "review")) {
    throw new Error("Catalog additions require the current Journey plan and canonical games.");
  }
  // Validate the combined membership, including duplicate slugs, but never
  // rebuild the original ordinary stops from this expanded set.
  const games = validateGameSnapshot([...original.gameSnapshot, ...additions]);
  const addedGames = games.filter(({ slug }) =>
    additions.some((game) => game.slug.trim() === slug),
  );
  return {
    gameSnapshot: games,
    boards: original.boards.map((board) => {
      const culmination = board.nodes.at(-1)!;
      if (culmination.kind !== "culmination") {
        throw new Error("A Journey board must end in a culmination.");
      }
      const covered = new Set(board.nodes.flatMap((node) =>
        node.kind === "normal" ? [node.gameSlug] : [],
      ));
      const missingOriginalGames = coverageVersion
        ? canonicalGames(original.gameSnapshot).filter(({ slug }) => !covered.has(slug))
        : [];
      const extraNodes: JourneyNode[] = [...missingOriginalGames, ...addedGames].map((game, index) => ({
        id: `${board.journeyLevel}:catch-up:${game.slug}`,
        kind: "normal",
        catalogAddition: true,
        journeyLevel: board.journeyLevel,
        level: board.level,
        position: culmination.position + index,
        gameSlug: game.slug,
        collectionId: journeyCampaignCollectionId(board.journeyLevel),
        questionOffset: 0,
        questionCount: 12,
        xp: XP_PER_JOURNEY_STOP[board.journeyLevel],
      }));
      const nodes: JourneyNode[] = [
        ...board.nodes.slice(0, -1),
        ...extraNodes,
        {
          ...culmination,
          position: culmination.position + extraNodes.length,
          sections: [
            ...culmination.sections.filter(({ selection }) => selection === "mistakes"),
            ...addedGames.map(({ slug }) => ({
              selection: "mistakes" as const,
              gameSlug: slug,
              questionCount: 3 as const,
            })),
            ...culmination.sections.filter(({ selection }) => selection === "fixed"),
          ],
          gameSlugs: [...culmination.gameSlugs, ...addedGames.map(({ slug }) => slug)],
        },
      ];
      return {
        ...board,
        nodes,
        availableXp: board.availableXp + extraNodes.reduce((sum, node) => sum + node.xp, 0),
      };
    }),
  };
}

/** Reconstruct a profile's original trail plus its append-only catalog updates. */
export function buildPlayerJourney(
  profile: Pick<PlayerProfile, "gameSnapshot" | "journeyPlanVersion" | "journeyAdditions" | "journeyCoverageVersion">,
): JourneyPlan {
  return buildJourneyPlanForVersion(
    profile.gameSnapshot,
    profile.journeyPlanVersion,
    profile.journeyAdditions,
    profile.journeyCoverageVersion,
  );
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
