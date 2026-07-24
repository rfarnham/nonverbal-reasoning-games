import { summarizeAttempt } from "./attempts.ts";
import {
  buildJourneyPlan,
  buildJourneyPlanForVersion,
  findJourneyNode,
  isJourneyNodeUnlocked,
  nextJourneyNode,
} from "./journey.ts";
import {
  questionReferenceIdentityKey,
} from "./questions.ts";
import {
  canPlayerAccessJourneyNode,
  isJourneyTestProfile,
} from "./test-mode.ts";
import {
  CURRENT_JOURNEY_PLAN_VERSION,
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

function profileJourney(profile: PlayerProfile): JourneyPlan {
  return buildJourneyPlanForVersion(
    profile.gameSnapshot,
    profile.journeyPlanVersion,
  );
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
    journeyPlanVersion: CURRENT_JOURNEY_PLAN_VERSION,
    gameSnapshot: journey.gameSnapshot,
    clearedStopIds: [],
    xpAwards: [],
    awardedStopIds: [],
    settledAttemptIds: [],
    missedQuestions: [],
    attempts: {},
    activeAttemptId: null,
  };
}

/**
 * Moves an idle four-board profile onto the expanded seven-board plan without
 * rewriting history. Existing clears map to their matching I boards, and the
 * write-once XP amounts remain exactly what the player originally earned.
 * An in-flight legacy attempt deliberately stays on plan v1 until it closes.
 */
export function upgradePlayerProfileJourneyPlan(
  profile: PlayerProfile,
  currentSnapshot: readonly JourneyGame[],
  nowMs?: number,
): PlayerProfile {
  if (
    profile.journeyPlanVersion === CURRENT_JOURNEY_PLAN_VERSION ||
    profile.activeAttemptId !== null
  ) {
    return profile;
  }
  const reviewProvider = currentSnapshot.find(
    ({ role }) => role === "review",
  );
  if (!reviewProvider) return profile;

  const coreSnapshot = profile.gameSnapshot.filter(
    ({ role }) => (role ?? "game") === "game",
  );
  const expandedSnapshot = [...coreSnapshot, reviewProvider];
  const legacyJourney = buildJourneyPlanForVersion(coreSnapshot, 1);
  const expandedJourney = buildJourneyPlan(expandedSnapshot);

  const stopIdMap = new Map<string, string>();
  for (const legacyBoard of legacyJourney.boards) {
    const targetBoard = expandedJourney.boards.find(
      ({ journeyLevel }) =>
        journeyLevel === legacyBoard.journeyLevel,
    );
    if (!targetBoard) continue;
    for (const legacyNode of legacyBoard.nodes) {
      const legacyKindNodes = legacyBoard.nodes.filter(
        ({ kind }) => kind === legacyNode.kind,
      );
      const ordinal = legacyKindNodes.findIndex(
        ({ id }) => id === legacyNode.id,
      );
      const target = targetBoard.nodes.filter(
        ({ kind }) => kind === legacyNode.kind,
      )[ordinal];
      if (!target) continue;
      if (
        "gameSlug" in legacyNode &&
        "gameSlug" in target &&
        legacyNode.gameSlug !== target.gameSlug
      ) {
        continue;
      }
      stopIdMap.set(legacyNode.id, target.id);
    }
  }

  const mapStopId = (stopId: string) => stopIdMap.get(stopId);
  const clearedStopIds = uniqueStrings(
    profile.clearedStopIds.flatMap((stopId) => {
      const mapped = mapStopId(stopId);
      return mapped ? [mapped] : [];
    }),
  );
  const cleared = new Set(clearedStopIds);
  const xpAwards = profile.xpAwards.flatMap((award) => {
    const stopId = mapStopId(award.stopId);
    return stopId && cleared.has(stopId)
      ? [{ stopId, amount: award.amount }]
      : [];
  });
  const awardedStopIds = xpAwards.map(({ stopId }) => stopId);
  const missedQuestions = profile.missedQuestions.map((missed) => ({
    ...missed,
    observations: missed.observations.map((observation) => {
      const stopId = mapStopId(observation.stopId);
      const node = stopId
        ? findJourneyNode(expandedJourney, stopId)
        : undefined;
      return {
        ...observation,
        ...(stopId ? { stopId } : {}),
        ...(node ? { journeyLevel: node.journeyLevel } : {}),
      };
    }),
  }));

  return {
    ...profile,
    journeyPlanVersion: CURRENT_JOURNEY_PLAN_VERSION,
    gameSnapshot: expandedJourney.gameSnapshot,
    clearedStopIds,
    xpAwards,
    awardedStopIds,
    settledAttemptIds: [],
    missedQuestions,
    attempts: {},
    activeAttemptId: null,
    updatedAtMs: nowOrCurrent(nowMs),
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
  const updatedProfile = {
    ...profile,
    ...(changes.name === undefined
      ? {}
      : { name: requiredText(changes.name, "Profile name") }),
    ...(changes.avatarId === undefined
      ? {}
      : { avatarId: requiredText(changes.avatarId, "Avatar ID") }),
    updatedAtMs: nowOrCurrent(changes.nowMs),
  };
  const activeAttempt = updatedProfile.activeAttemptId
    ? updatedProfile.attempts[updatedProfile.activeAttemptId]
    : undefined;
  if (
    isJourneyTestProfile(profile) &&
    !isJourneyTestProfile(updatedProfile) &&
    activeAttempt &&
    !isJourneyNodeUnlocked(
      profileJourney(updatedProfile),
      updatedProfile.clearedStopIds,
      activeAttempt.stopId,
    )
  ) {
    return activeAttempt.settlement
      ? closeAttemptSummary(
          updatedProfile,
          activeAttempt.id,
          changes.nowMs,
        )
      : discardActiveProgressionAttempt(
          updatedProfile,
          activeAttempt.id,
          changes.nowMs,
        );
  }
  return updatedProfile;
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
  const journey = profileJourney(profile);
  const node = findJourneyNode(journey, attempt.stopId);
  if (
    !node ||
    node.kind !== attempt.kind ||
    node.journeyLevel !== attempt.journeyLevel ||
    node.level !== attempt.level
  ) {
    throw new Error("Attempt does not match a stop in this profile's journey.");
  }
  assertProgressionAttemptIntegrity(attempt, node);
  if (!canPlayerAccessJourneyNode(profile, journey, node.id)) {
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
  const now = nowOrCurrent(options.nowMs);
  return {
    ...profile,
    attempts: {
      ...profile.attempts,
      [attempt.id]: attempt,
    },
    // Keep the extractable profile history current after every saved answer.
    // mergeMissedQuestions is idempotent by attempt ID, so later settlement,
    // reload, or restart cannot double-count the same observation.
    missedQuestions: mergeMissedQuestions(
      profile.missedQuestions,
      attempt,
      now,
    ),
    activeAttemptId:
      options.makeActive === false ? profile.activeAttemptId : attempt.id,
    updatedAtMs: now,
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
    const key = questionReferenceIdentityKey(round.question);
    const previous = byKey.get(key);
    const observation = {
      attemptId: attempt.id,
      stopId: attempt.stopId,
      journeyLevel: attempt.journeyLevel,
      elapsedMs: round.firstAnswerActiveTimeMs ?? null,
      missedAtMs: round.firstAnsweredAtMs ?? nowMs,
    };
    const observations = previous?.observations ?? [];
    const alreadyObserved = observations.some(
      (candidate) => candidate.attemptId === attempt.id,
    );
    byKey.set(key, {
      key,
      question: round.question,
      missCount:
        (previous?.missCount ?? 0) + (alreadyObserved ? 0 : 1),
      lastMissedAtMs: Math.max(
        previous?.lastMissedAtMs ?? 0,
        observation.missedAtMs,
      ),
      observations: alreadyObserved
        ? observations
        : [...observations, observation],
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
  const journey = profileJourney(profile);
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
  journey: JourneyPlan = profileJourney(profile),
  nowMs?: number,
): SettleAttemptResult {
  const canonicalJourney = profileJourney(profile);
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
  if (!canPlayerAccessJourneyNode(profile, canonicalJourney, canonicalNode.id)) {
    throw new Error("A locked journey stop cannot settle.");
  }

  const now = nowOrCurrent(nowMs);
  const preliminary = summarizeAttempt(attempt, 0, now);
  const recordsJourneyProgress = !isJourneyTestProfile(profile);
  const firstAward = recordsJourneyProgress &&
    preliminary.passed &&
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
    clearedStopIds: recordsJourneyProgress && settlement.passed
      ? uniqueStrings([...profile.clearedStopIds, canonicalNode.id])
      : profile.clearedStopIds,
    awardedStopIds: firstAward
      ? [...profile.awardedStopIds, canonicalNode.id]
      : profile.awardedStopIds,
    xpAwards: firstAward
      ? [
          ...profile.xpAwards,
          { stopId: canonicalNode.id, amount: canonicalNode.xp },
        ]
      : profile.xpAwards,
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
  const journey = profileJourney(profile);
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
  journey: JourneyPlan = profileJourney(profile),
): number {
  // Keep the historical optional argument for callers migrating from
  // plan-derived XP; earned totals now come solely from the write-once ledger.
  void journey;
  return profile.xpAwards.reduce((sum, award) => sum + award.amount, 0);
}

export function nextIncompleteJourneyNode(
  profile: PlayerProfile,
  journey: JourneyPlan = profileJourney(profile),
): JourneyNode | undefined {
  const cleared = new Set(profile.clearedStopIds);
  return journey.boards
    .flatMap(({ nodes }) => nodes)
    .find(({ id }) => !cleared.has(id));
}

export function nodeAfterClearedStop(
  profile: PlayerProfile,
  stopId: string,
  journey: JourneyPlan = profileJourney(profile),
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
    const key = questionReferenceIdentityKey(question);
    if (keys.has(key)) continue;
    keys.add(key);
    selected.push(question);
    if (selected.length === 3) return selected;
  }
  throw new Error(
    `Culmination needs three distinct questions for ${gameSlug}.`,
  );
}
