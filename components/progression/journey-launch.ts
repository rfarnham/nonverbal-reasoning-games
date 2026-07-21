import { games } from "@/lib/games";
import {
  createCulminationProgressionAttempt,
  createNormalProgressionAttempt,
  createTurboProgressionAttempt,
  currentAttemptSection,
  currentRedemptionQuestion,
  JOURNEY_GAMES_PER_BOARD,
  type CampaignQuestionReference,
  type JourneyNode,
  type PlayerProfile,
  type ProgressionAttempt,
  type ProgressionLevel,
} from "@/lib/progression";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const JOURNEY_ARRIVAL_KEY = "spatial-gym:journey-arrival";

function nextAttemptId(stopId: string) {
  try {
    return `attempt-${window.crypto.randomUUID()}`;
  } catch {
    return `attempt-${encodeURIComponent(stopId)}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }
}

export function journeyCatalogSnapshot() {
  return games.slice(0, JOURNEY_GAMES_PER_BOARD).map(({ slug, title, progression }) => ({
    slug,
    title,
    contentVersion: progression.contentVersion,
    generatorVersion: progression.generatorVersion,
  }));
}

export function journeyCampaignQuestions(
  gameSlug: string,
  level: ProgressionLevel,
  contentVersion: string,
): readonly CampaignQuestionReference[] {
  return Array.from({ length: 12 }, (_, questionIndex) => ({
    source: "campaign" as const,
    gameSlug,
    level,
    questionIndex,
    contentVersion,
  }));
}

function currentGameVersions(profile: PlayerProfile, gameSlug: string) {
  const savedGame = profile.gameSnapshot.find(({ slug }) => slug === gameSlug);
  if (!savedGame) {
    throw new Error(`${gameSlug} is not part of this profile's saved Journey.`);
  }
  const currentGame = games.find(({ slug }) => slug === gameSlug);
  const contentVersion =
    currentGame?.progression.contentVersion ?? savedGame.contentVersion;
  const generatorVersion =
    currentGame?.progression.generatorVersion ?? savedGame.generatorVersion;
  if (!contentVersion?.trim() || !generatorVersion?.trim()) {
    throw new Error(`${gameSlug} is missing current progression versions.`);
  }
  return { contentVersion, generatorVersion };
}

export function createJourneyAttempt(
  profile: PlayerProfile,
  node: JourneyNode,
) {
  const id = nextAttemptId(node.id);
  if (node.kind === "normal") {
    const versions = currentGameVersions(profile, node.gameSlug);
    return createNormalProgressionAttempt({
      id,
      node,
      campaignQuestions: journeyCampaignQuestions(
        node.gameSlug,
        node.level,
        versions.contentVersion,
      ),
    });
  }
  if (node.kind === "turbo") {
    const versions = currentGameVersions(profile, node.gameSlug);
    return createTurboProgressionAttempt({
      id,
      node,
      generatorVersion: versions.generatorVersion,
    });
  }
  return createCulminationProgressionAttempt({
    id,
    node,
    missedQuestions: profile.missedQuestions,
    questionPools: node.gameSlugs.map((gameSlug) => {
      const versions = currentGameVersions(profile, gameSlug);
      const questions = journeyCampaignQuestions(
        gameSlug,
        node.level,
        versions.contentVersion,
      );
      return {
        gameSlug,
        approachableQuestion: journeyCampaignQuestions(
          gameSlug,
          "starter",
          versions.contentVersion,
        )[0],
        campaignQuestions: questions,
        currentContentVersion: versions.contentVersion,
        currentGeneratorVersion: versions.generatorVersion,
      };
    }),
  });
}

export function markJourneyArrival(profileId: string, nodeId: string) {
  try {
    window.sessionStorage.setItem(
      JOURNEY_ARRIVAL_KEY,
      JSON.stringify({ profileId, nodeId }),
    );
  } catch {
    // The map still works when session storage is unavailable.
  }
}

export function consumeJourneyArrival(profileId: string): string | null {
  try {
    const serialized = window.sessionStorage.getItem(JOURNEY_ARRIVAL_KEY);
    window.sessionStorage.removeItem(JOURNEY_ARRIVAL_KEY);
    if (!serialized) return null;
    const value = JSON.parse(serialized) as {
      profileId?: unknown;
      nodeId?: unknown;
    };
    return value.profileId === profileId && typeof value.nodeId === "string"
      ? value.nodeId
      : null;
  } catch {
    return null;
  }
}

export function progressionAttemptGameSlug(attempt: ProgressionAttempt) {
  if (attempt.phase === "redemption" && attempt.redemption) {
    return currentRedemptionQuestion(attempt)?.gameSlug;
  }
  if (attempt.phase === "redemption-ready") {
    return attempt.rounds.at(-1)?.question.gameSlug;
  }
  return (
    currentAttemptSection(attempt)?.gameSlug ??
    attempt.sections[attempt.sections.length - 1]?.gameSlug
  );
}

export function navigateToProgressionAttempt(attempt: ProgressionAttempt) {
  if (
    attempt.phase === "summary-ready" ||
    attempt.phase === "summary" ||
    attempt.phase === "retry-required"
  ) {
    window.location.assign(
      `${basePath}/journey/summary/?attempt=${encodeURIComponent(attempt.id)}`,
    );
    return;
  }
  const gameSlug = progressionAttemptGameSlug(attempt);
  if (!gameSlug) {
    window.location.assign(`${basePath}/journey/`);
    return;
  }
  window.location.assign(
    `${basePath}/games/${encodeURIComponent(
      gameSlug,
    )}/?progression=${encodeURIComponent(attempt.id)}`,
  );
}

export function navigateToJourney(
  options: { replace?: boolean } = {},
) {
  const target = `${basePath}/journey/`;
  if (options.replace) {
    window.location.replace(target);
  } else {
    window.location.assign(target);
  }
}
