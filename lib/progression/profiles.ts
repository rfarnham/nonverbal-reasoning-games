import { summarizeAttempt } from "./attempts.ts";
import {
  buildJourneyPlan,
  findJourneyNode,
  isJourneyNodeUnlocked,
  nextJourneyNode,
} from "./journey.ts";
import { questionReferenceKey } from "./questions.ts";
import {
  PROGRESSION_SCHEMA_VERSION,
  type AttemptSettlement,
  type JourneyGame,
  type JourneyNode,
  type JourneyPlan,
  type MissedQuestion,
  type PlayerProfile,
  type ProgressionAttempt,
  type ProgressionState,
  type QuestionReference,
} from "./types.ts";
import { assertProgressionAttemptIntegrity } from "./validation.ts";

type CreateProfileInput = {
  id: string;
  name: string;
  avatarId: string;
  gameSnapshot: readonly JourneyGame[];
  nowMs?: number;
};

export type SettleAttemptResult = {
  profile: PlayerProfile;
  attempt: ProgressionAttempt;
  settlement: AttemptSettlement;
};

function nowOrCurrent(nowMs?: number): number {
  return Number.isFinite(nowMs) && Number(nowMs) >= 0
    ? Number(nowMs)
    : Date.now();
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty.`);
  return trimmed;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export function createProgressionState(): ProgressionState {
  return {
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    activeProfileId: null,
    profiles: [],
  };
}

export function createPlayerProfile({
  id,
  name,
  avatarId,
  gameSnapshot,
  nowMs,
}: CreateProfileInput): PlayerProfile {
  const now = nowOrCurrent(nowMs);
  const journey = buildJourneyPlan(gameSnapshot);
  return {
    id: requiredText(id, "Profile ID"),
    name: requiredText(name, "Profile name"),
    avatarId: requiredText(avatarId, "Avatar ID"),
    createdAtMs: now,
    updatedAtMs: now,
    gameSnapshot: journey.gameSnapshot,
    clearedStopIds: [],
    awardedStopIds: [],
    settledAttemptIds: [],
    missedQuestions: [],
    attempts: {},
    activeAttemptId: null,
  };
}

export function addPlayerProfile(
  state: ProgressionState,
  profile: PlayerProfile,
): ProgressionState {
  if (state.profiles.some(({ id }) => id === profile.id)) {
    throw new Error(`Profile ID already exists: ${profile.id}`);
  }
  return {
    ...state,
    activeProfileId: profile.id,
    profiles: [...state.profiles, profile],
  };
}

export function updatePlayerProfileIdentity(
  profile: PlayerProfile,
  changes: { name?: string; avatarId?: string; nowMs?: number },
): PlayerProfile {
  return {
    ...profile,
    ...(changes.name === undefined
      ? {}
      : { name: requiredText(changes.name, "Profile name") }),
    ...(changes.avatarId === undefined
      ? {}
      : { avatarId: requiredText(changes.avatarId, "Avatar ID") }),
    updatedAtMs: nowOrCurrent(changes.nowMs),
  };
}

export function replacePlayerProfile(
  state: ProgressionState,
  profile: PlayerProfile,
): ProgressionState {
  if (!state.profiles.some(({ id }) => id === profile.id)) {
    throw new Error(`Unknown profile ID: ${profile.id}`);
  }
  return {
    ...state,
    profiles: state.profiles.map((candidate) =>
      candidate.id === profile.id ? profile : candidate,
    ),
  };
}

export function switchPlayerProfile(
  state: ProgressionState,
  profileId: string,
): ProgressionState {
  if (!state.profiles.some(({ id }) => id === profileId)) {
    throw new Error(`Unknown profile ID: ${profileId}`);
  }
  return {
    ...state,
    activeProfileId: profileId,
  };
}

export function deletePlayerProfile(
  state: ProgressionState,
  profileId: string,
): ProgressionState {
  const profiles = state.profiles.filter(({ id }) => id !== profileId);
  if (profiles.length === state.profiles.length) return state;
  return {
    ...state,
    profiles,
    activeProfileId:
      state.activeProfileId === profileId
        ? (profiles[0]?.id ?? null)
        : state.activeProfileId,
  };
}

export function activePlayerProfile(
  state: ProgressionState,
): PlayerProfile | undefined {
  return state.profiles.find(({ id }) => id === state.activeProfileId);
}

export function upsertProfileAttempt(
  profile: PlayerProfile,
  attempt: ProgressionAttempt,
  options: { makeActive?: boolean; nowMs?: number } = {},
): PlayerProfile {
  const journey = buildJourneyPlan(profile.gameSnapshot);
  const node = findJourneyNode(journey, attempt.stopId);
  if (
    !node ||
    node.kind !== attempt.kind ||
    node.level !== attempt.level
  ) {
    throw new Error("Attempt does not match a stop in this profile's journey.");
  }
  assertProgressionAttemptIntegrity(attempt, node);
  if (!isJourneyNodeUnlocked(journey, profile.clearedStopIds, node.id)) {
    throw new Error("Attempt belongs to a locked journey stop.");
  }
  const existing = profile.attempts[attempt.id];
  if (existing && existing.stopId !== attempt.stopId) {
    throw new Error("An attempt ID cannot be reused for another stop.");
  }
  if (
    options.makeActive !== false &&
    profile.activeAttemptId &&
    profile.activeAttemptId !== attempt.id &&
    profile.attempts[profile.activeAttemptId]?.phase !== "complete"
  ) {
    throw new Error("Finish the active journey attempt before starting another.");
  }
  return {
    ...profile,
    attempts: {
      ...profile.attempts,
      [attempt.id]: attempt,
    },
    activeAttemptId:
      options.makeActive === false ? profile.activeAttemptId : attempt.id,
    updatedAtMs: nowOrCurrent(options.nowMs),
  };
}

function mergeMissedQuestions(
  existing: readonly MissedQuestion[],
  attempt: ProgressionAttempt,
  nowMs: number,
): readonly MissedQuestion[] {
  const byKey = new Map(existing.map((missed) => [missed.key, missed]));
  for (const round of attempt.rounds) {
    if (round.firstTryCorrect !== false) continue;
    const key = questionReferenceKey(round.question);
    const previous = byKey.get(key);
    byKey.set(key, {
      key,
      question: round.question,
      missCount: (previous?.missCount ?? 0) + 1,
      lastMissedAtMs: nowMs,
    });
  }
  return [...byKey.values()].sort(
    (left, right) => right.lastMissedAtMs - left.lastMissedAtMs,
  );
}

/**
 * Drops an unfinishable active run without changing clears or XP. Any
 * write-once misses already recorded in that run remain available for future
 * culmination review.
 */
export function discardActiveProgressionAttempt(
  profile: PlayerProfile,
  attemptId: string,
  nowMs?: number,
): PlayerProfile {
  const attempt = profile.attempts[attemptId];
  if (!attempt || profile.activeAttemptId !== attemptId) {
    throw new Error("Only the active journey attempt can be restarted.");
  }
  if (attempt.settlement) {
    throw new Error("Close this attempt's summary instead of restarting it.");
  }
  const journey = buildJourneyPlan(profile.gameSnapshot);
  const node = findJourneyNode(journey, attempt.stopId);
  if (!node) {
    throw new Error("The active attempt no longer belongs to this journey.");
  }
  assertProgressionAttemptIntegrity(attempt, node);
  const now = nowOrCurrent(nowMs);
  const attempts = Object.fromEntries(
    Object.entries(profile.attempts).filter(([id]) => id !== attemptId),
  );
  return {
    ...profile,
    attempts,
    settledAttemptIds: profile.settledAttemptIds.filter(
      (id) => id !== attemptId,
    ),
    missedQuestions: mergeMissedQuestions(
      profile.missedQuestions,
      attempt,
      now,
    ),
    activeAttemptId: null,
    updatedAtMs: now,
  };
}

export function settleProgressionAttempt(
  profile: PlayerProfile,
  attempt: ProgressionAttempt,
  journey: JourneyPlan = buildJourneyPlan(profile.gameSnapshot),
  nowMs?: number,
): SettleAttemptResult {
  const canonicalJourney = buildJourneyPlan(profile.gameSnapshot);
  const canonicalNode = findJourneyNode(canonicalJourney, attempt.stopId);
  const suppliedNode = findJourneyNode(journey, attempt.stopId);
  if (
    !canonicalNode ||
    !suppliedNode ||
    JSON.stringify(canonicalNode) !== JSON.stringify(suppliedNode)
  ) {
    throw new Error("Attempt does not match this profile's canonical journey.");
  }

  const alreadySettled = profile.settledAttemptIds.includes(attempt.id);
  const priorAttempt = profile.attempts[attempt.id];
  if (alreadySettled) {
    if (!priorAttempt?.settlement) {
      throw new Error("Settled attempt history is missing its summary.");
    }
    assertProgressionAttemptIntegrity(priorAttempt, canonicalNode);
    return {
      profile,
      attempt: priorAttempt,
      settlement: priorAttempt.settlement,
    };
  }

  if (
    profile.activeAttemptId !== attempt.id ||
    !priorAttempt ||
    JSON.stringify(priorAttempt) !== JSON.stringify(attempt)
  ) {
    throw new Error("Only the profile's persisted active attempt can settle.");
  }
  assertProgressionAttemptIntegrity(attempt, canonicalNode);
  if (attempt.phase !== "summary-ready") {
    throw new Error(
      "Finish all questions and redemption before settling an attempt.",
    );
  }
  if (
    !isJourneyNodeUnlocked(
      canonicalJourney,
      profile.clearedStopIds,
      canonicalNode.id,
    )
  ) {
    throw new Error("A locked journey stop cannot settle.");
  }

  const now = nowOrCurrent(nowMs);
  const preliminary = summarizeAttempt(attempt, 0, now);
  const firstAward = preliminary.passed &&
    !profile.awardedStopIds.includes(canonicalNode.id);
  const settlement: AttemptSettlement = {
    ...preliminary,
    xpAwarded: firstAward ? canonicalNode.xp : 0,
  };
  const settledAttempt: ProgressionAttempt = {
    ...attempt,
    phase: settlement.passed ? "summary" : "retry-required",
    settlement,
    updatedAtMs: now,
  };
  const updatedProfile: PlayerProfile = {
    ...profile,
    clearedStopIds: settlement.passed
      ? uniqueStrings([...profile.clearedStopIds, canonicalNode.id])
      : profile.clearedStopIds,
    awardedStopIds: firstAward
      ? [...profile.awardedStopIds, canonicalNode.id]
      : profile.awardedStopIds,
    settledAttemptIds: [...profile.settledAttemptIds, attempt.id],
    missedQuestions: mergeMissedQuestions(
      profile.missedQuestions,
      attempt,
      now,
    ),
    attempts: {
      ...profile.attempts,
      [attempt.id]: settledAttempt,
    },
    activeAttemptId: attempt.id,
    updatedAtMs: now,
  };
  return {
    profile: updatedProfile,
    attempt: settledAttempt,
    settlement,
  };
}

export function closeAttemptSummary(
  profile: PlayerProfile,
  attemptId: string,
  nowMs?: number,
): PlayerProfile {
  const attempt = profile.attempts[attemptId];
  if (
    !attempt ||
    (attempt.phase !== "summary" && attempt.phase !== "retry-required")
  ) {
    throw new Error("Attempt does not have a summary to close.");
  }
  if (profile.activeAttemptId !== attemptId) {
    throw new Error("Only the active attempt summary can be closed.");
  }
  const journey = buildJourneyPlan(profile.gameSnapshot);
  const node = findJourneyNode(journey, attempt.stopId);
  if (!node || !profile.settledAttemptIds.includes(attemptId)) {
    throw new Error("Attempt summary is not part of settled journey history.");
  }
  assertProgressionAttemptIntegrity(attempt, node);
  const updatedAtMs = nowOrCurrent(nowMs);
  const attempts = Object.fromEntries(
    Object.entries(profile.attempts).filter(
      ([candidateId, candidate]) =>
        candidateId !== attemptId && candidate.phase !== "complete",
    ),
  );
  const retainedAttemptIds = new Set(Object.keys(attempts));
  return {
    ...profile,
    attempts,
    settledAttemptIds: profile.settledAttemptIds.filter((settledId) =>
      retainedAttemptIds.has(settledId),
    ),
    activeAttemptId: null,
    updatedAtMs,
  };
}

export function profileXpTotal(
  profile: PlayerProfile,
  journey: JourneyPlan = buildJourneyPlan(profile.gameSnapshot),
): number {
  const awarded = new Set(profile.awardedStopIds);
  return journey.boards
    .flatMap(({ nodes }) => nodes)
    .reduce((sum, node) => sum + (awarded.has(node.id) ? node.xp : 0), 0);
}

export function nextIncompleteJourneyNode(
  profile: PlayerProfile,
  journey: JourneyPlan = buildJourneyPlan(profile.gameSnapshot),
): JourneyNode | undefined {
  const cleared = new Set(profile.clearedStopIds);
  return journey.boards
    .flatMap(({ nodes }) => nodes)
    .find(({ id }) => !cleared.has(id));
}

export function nodeAfterClearedStop(
  profile: PlayerProfile,
  stopId: string,
  journey: JourneyPlan = buildJourneyPlan(profile.gameSnapshot),
): JourneyNode | undefined {
  if (!profile.clearedStopIds.includes(stopId)) return undefined;
  return nextJourneyNode(journey, stopId);
}

type CulminationQuestionInput = {
  gameSlug: string;
  approachable: QuestionReference;
  missedQuestions: readonly MissedQuestion[];
  fallbackQuestions: readonly QuestionReference[];
};

/**
 * Selects one approachable question, then the most recent missed questions,
 * then campaign fallbacks. Callers supply canonical question references, so
 * this contains no game-specific data or random selection.
 */
export function selectCulminationQuestions({
  gameSlug,
  approachable,
  missedQuestions,
  fallbackQuestions,
}: CulminationQuestionInput): readonly QuestionReference[] {
  const candidates = [
    approachable,
    ...missedQuestions
      .filter(({ question }) => question.gameSlug === gameSlug)
      .map(({ question }) => question),
    ...fallbackQuestions,
  ];
  const selected: QuestionReference[] = [];
  const keys = new Set<string>();
  for (const question of candidates) {
    if (question.gameSlug !== gameSlug) continue;
    const key = questionReferenceKey(question);
    if (keys.has(key)) continue;
    keys.add(key);
    selected.push(question);
    if (selected.length === 3) return selected;
  }
  throw new Error(
    `Culmination needs three distinct questions for ${gameSlug}.`,
  );
}
