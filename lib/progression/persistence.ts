import {
  buildJourneyPlanForVersion,
  findJourneyNode,
} from "./journey.ts";
import {
  canPlayerAccessJourneyNode,
  isJourneyTestProfile,
} from "./test-mode.ts";
import {
  isQuestionReference,
  questionReferenceIdentityKey,
  questionReferenceKey,
} from "./questions.ts";
import {
  CURRENT_JOURNEY_PLAN_VERSION,
  PROGRESSION_LEVELS,
  PROGRESSION_SCHEMA_VERSION,
  firstJourneyLevelForDifficulty,
  isJourneyLevel,
  type AttemptPhase,
  type AttemptRound,
  type AttemptRoundPhase,
  type AttemptSection,
  type AttemptSettlement,
  type JourneyGame,
  type JourneyLevel,
  type JourneyPlan,
  type JourneyPlanVersion,
  type MissObservation,
  type MissedQuestion,
  type PlayerProfile,
  type ProgressionAttempt,
  type ProgressionLevel,
  type ProgressionState,
  type RedemptionState,
  type StorageLike,
  type XpAward,
} from "./types.ts";
import { assertProgressionAttemptIntegrity } from "./validation.ts";

export const PROGRESSION_STORAGE_KEY = "spatial-gym:progression";

export type ProgressionLoadStatus =
  | "empty"
  | "loaded"
  | "migrated"
  | "corrupt"
  | "unsupported"
  | "unavailable";

export type ProgressionLoadResult = Readonly<{
  state: ProgressionState;
  status: ProgressionLoadStatus;
}>;

const ATTEMPT_PHASES: readonly AttemptPhase[] = [
  "playing",
  "redemption-ready",
  "redemption",
  "summary-ready",
  "summary",
  "retry-required",
  "complete",
];
const ROUND_PHASES: readonly AttemptRoundPhase[] = [
  "answering",
  "feedback",
  "solved",
];
const ATTEMPT_KINDS = ["normal", "review", "turbo", "culmination"] as const;
const LEGACY_SCHEMA_VERSIONS = [0, 1, 2] as const;

function isSupportedSchemaVersion(value: unknown): boolean {
  return (
    value === PROGRESSION_SCHEMA_VERSION ||
    LEGACY_SCHEMA_VERSIONS.includes(
      value as (typeof LEGACY_SCHEMA_VERSIONS)[number],
    )
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = nonNegativeNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(textValue).filter((item) => item !== undefined))];
}

function parseLevel(value: unknown): ProgressionLevel | undefined {
  return typeof value === "string" &&
    PROGRESSION_LEVELS.includes(value as ProgressionLevel)
    ? (value as ProgressionLevel)
    : undefined;
}

function parseJourneyLevel(value: unknown): JourneyLevel | undefined {
  return isJourneyLevel(value) ? value : undefined;
}

function parseJourneyGames(
  raw: unknown,
  journeyPlanVersion: JourneyPlanVersion,
): readonly JourneyGame[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const games = raw
    .map((item) => {
      if (typeof item === "string") {
        const slug = textValue(item);
        return slug ? { slug, title: slug } : undefined;
      }
      const game = recordValue(item);
      const slug = textValue(game?.slug);
      const title = textValue(game?.title) ?? slug;
      if (!slug || !title) return undefined;
      const contentVersion = textValue(game?.contentVersion);
      const generatorVersion = textValue(game?.generatorVersion);
      const journeyContentVersion = textValue(game?.journeyContentVersion);
      const role =
        game?.role === "review"
          ? ("review" as const)
          : ("game" as const);
      return {
        slug,
        title,
        role,
        ...(contentVersion ? { contentVersion } : {}),
        ...(generatorVersion ? { generatorVersion } : {}),
        ...(journeyContentVersion ? { journeyContentVersion } : {}),
      };
    })
    .filter((game) => game !== undefined);
  try {
    return buildJourneyPlanForVersion(
      games,
      journeyPlanVersion,
    ).gameSnapshot;
  } catch {
    return undefined;
  }
}

function parseRound(raw: unknown): AttemptRound | undefined {
  const round = recordValue(raw);
  const question = round?.question;
  const phase =
    typeof round?.phase === "string" &&
    ROUND_PHASES.includes(round.phase as AttemptRoundPhase)
      ? (round.phase as AttemptRoundPhase)
      : undefined;
  const attemptCount = nonNegativeInteger(round?.attemptCount);
  const firstTryCorrect =
    round?.firstTryCorrect === null ||
    typeof round?.firstTryCorrect === "boolean"
      ? round.firstTryCorrect
      : undefined;
  if (
    !isQuestionReference(question) ||
    !phase ||
    attemptCount === undefined ||
    firstTryCorrect === undefined
  ) {
    return undefined;
  }
  const lastAnswerToken = textValue(round?.lastAnswerToken);
  const firstAnswerActiveTimeMs =
    round?.firstAnswerActiveTimeMs === undefined
      ? undefined
      : nonNegativeNumber(round.firstAnswerActiveTimeMs);
  const firstAnsweredAtMs =
    round?.firstAnsweredAtMs === undefined
      ? undefined
      : nonNegativeNumber(round.firstAnsweredAtMs);
  if (
    round?.firstAnswerActiveTimeMs !== undefined &&
    firstAnswerActiveTimeMs === undefined
  ) {
    return undefined;
  }
  if (
    round?.firstAnsweredAtMs !== undefined &&
    firstAnsweredAtMs === undefined
  ) {
    return undefined;
  }
  return {
    question,
    phase,
    attemptCount,
    firstTryCorrect,
    ...(firstAnswerActiveTimeMs === undefined
      ? {}
      : { firstAnswerActiveTimeMs }),
    ...(firstAnsweredAtMs === undefined
      ? {}
      : { firstAnsweredAtMs }),
    ...(lastAnswerToken ? { lastAnswerToken } : {}),
  };
}

function deriveSections(
  rounds: readonly AttemptRound[],
): readonly AttemptSection[] {
  const sections: AttemptSection[] = [];
  for (const [index, round] of rounds.entries()) {
    const current = sections.at(-1);
    if (current?.gameSlug === round.question.gameSlug) {
      current.questionCount += 1;
    } else {
      sections.push({
        gameSlug: round.question.gameSlug,
        startRoundIndex: index,
        questionCount: 1,
      });
    }
  }
  return sections;
}

function isPristineRound(round: AttemptRound | undefined): boolean {
  return (
    round?.phase === "answering" &&
    round.attemptCount === 0 &&
    round.firstTryCorrect === null &&
    round.lastAnswerToken === undefined
  );
}

function parseRedemption(raw: unknown): RedemptionState | null | undefined {
  if (raw === null || raw === undefined) return null;
  const redemption = recordValue(raw);
  if (!redemption || !Array.isArray(redemption.queue)) return undefined;
  const queue = redemption.queue.filter(isQuestionReference);
  if (queue.length !== redemption.queue.length) return undefined;
  const currentIndex = nonNegativeInteger(redemption.currentIndex);
  const phase =
    typeof redemption.phase === "string" &&
    ROUND_PHASES.includes(redemption.phase as AttemptRoundPhase)
      ? (redemption.phase as AttemptRoundPhase)
      : undefined;
  const attemptCount = nonNegativeInteger(redemption.attemptCount);
  if (
    currentIndex === undefined ||
    currentIndex > queue.length ||
    !phase ||
    attemptCount === undefined
  ) {
    return undefined;
  }
  const lastAnswerToken = textValue(redemption.lastAnswerToken);
  return {
    queue,
    currentIndex,
    phase,
    attemptCount,
    ...(lastAnswerToken ? { lastAnswerToken } : {}),
  };
}

function parseSettlement(raw: unknown): AttemptSettlement | undefined {
  const settlement = recordValue(raw);
  if (!settlement) return undefined;
  const correctFirstAttempts = nonNegativeInteger(
    settlement.correctFirstAttempts,
  );
  const totalFirstAttempts = nonNegativeInteger(settlement.totalFirstAttempts);
  const accuracy = nonNegativeNumber(settlement.accuracy);
  const accuracyPercent = nonNegativeNumber(settlement.accuracyPercent);
  const activeTimeMs = nonNegativeNumber(settlement.activeTimeMs);
  const xpAwarded = nonNegativeNumber(settlement.xpAwarded);
  const settledAtMs = nonNegativeNumber(settlement.settledAtMs);
  if (
    typeof settlement.passed !== "boolean" ||
    correctFirstAttempts === undefined ||
    totalFirstAttempts === undefined ||
    correctFirstAttempts > totalFirstAttempts ||
    accuracy === undefined ||
    accuracy > 1 ||
    accuracyPercent === undefined ||
    accuracyPercent > 100 ||
    activeTimeMs === undefined ||
    xpAwarded === undefined ||
    settledAtMs === undefined
  ) {
    return undefined;
  }
  return {
    passed: settlement.passed,
    correctFirstAttempts,
    totalFirstAttempts,
    accuracy,
    accuracyPercent,
    activeTimeMs,
    xpAwarded,
    settledAtMs,
  };
}

function parseAttempt(raw: unknown): ProgressionAttempt | undefined {
  const attempt = recordValue(raw);
  const id = textValue(attempt?.id);
  const stopId = textValue(attempt?.stopId);
  const kind =
    typeof attempt?.kind === "string" &&
    ATTEMPT_KINDS.includes(attempt.kind as (typeof ATTEMPT_KINDS)[number])
      ? (attempt.kind as (typeof ATTEMPT_KINDS)[number])
      : undefined;
  const level = parseLevel(attempt?.level);
  const journeyLevel =
    parseJourneyLevel(attempt?.journeyLevel) ??
    (level ? firstJourneyLevelForDifficulty(level) : undefined);
  const phase =
    typeof attempt?.phase === "string" &&
    ATTEMPT_PHASES.includes(attempt.phase as AttemptPhase)
      ? (attempt.phase as AttemptPhase)
      : undefined;
  if (
    !id ||
    !stopId ||
    !kind ||
    !level ||
    !journeyLevel ||
    !phase ||
    !Array.isArray(attempt?.rounds)
  ) {
    return undefined;
  }
  const rounds = attempt.rounds.map(parseRound);
  if (rounds.some((round) => !round)) return undefined;
  const validRounds = rounds as AttemptRound[];
  const keys = validRounds.map(({ question }) =>
    questionReferenceKey(question),
  );
  if (new Set(keys).size !== keys.length) return undefined;

  const currentRoundIndex =
    attempt.currentRoundIndex === null
      ? null
      : nonNegativeInteger(attempt.currentRoundIndex);
  if (
    currentRoundIndex === undefined ||
    (currentRoundIndex !== null && currentRoundIndex >= validRounds.length)
  ) {
    return undefined;
  }
  const redemption = parseRedemption(attempt.redemption);
  if (redemption === undefined) return undefined;
  const activeTimeMs = nonNegativeNumber(attempt.activeTimeMs);
  const startedAtMs = nonNegativeNumber(attempt.startedAtMs);
  const updatedAtMs = nonNegativeNumber(attempt.updatedAtMs);
  if (
    activeTimeMs === undefined ||
    startedAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return undefined;
  }
  const turboRemainingMs =
    attempt.turboRemainingMs === undefined
      ? undefined
      : nonNegativeNumber(attempt.turboRemainingMs);
  if (
    attempt.turboRemainingMs !== undefined &&
    turboRemainingMs === undefined
  ) {
    return undefined;
  }
  const settlement =
    attempt.settlement === undefined
      ? undefined
      : parseSettlement(attempt.settlement);
  if (attempt.settlement !== undefined && !settlement) return undefined;

  const sections = deriveSections(validRounds);
  const currentSectionIndex =
    currentRoundIndex === null
      ? null
      : sections.findIndex(
          ({ startRoundIndex, questionCount }) =>
            currentRoundIndex >= startRoundIndex &&
            currentRoundIndex < startRoundIndex + questionCount,
        );
  if (currentSectionIndex === -1) return undefined;
  const pendingSectionIndex =
    attempt.pendingSectionIndex === undefined
      ? kind === "culmination" &&
        phase === "playing" &&
        currentRoundIndex !== null &&
        currentSectionIndex !== null &&
        currentRoundIndex === sections[currentSectionIndex]?.startRoundIndex &&
        isPristineRound(validRounds[currentRoundIndex])
        ? currentSectionIndex
        : null
      : attempt.pendingSectionIndex === null
        ? null
        : nonNegativeInteger(attempt.pendingSectionIndex);
  if (
    pendingSectionIndex === undefined ||
    (pendingSectionIndex !== null && pendingSectionIndex >= sections.length)
  ) {
    return undefined;
  }

  return {
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    id,
    stopId,
    kind,
    journeyLevel,
    level,
    phase,
    rounds: validRounds,
    currentRoundIndex,
    sections,
    currentSectionIndex,
    pendingSectionIndex,
    redemption,
    activeTimeMs,
    ...(turboRemainingMs === undefined ? {} : { turboRemainingMs }),
    startedAtMs,
    updatedAtMs,
    ...(settlement ? { settlement } : {}),
  };
}

function parseMissObservation(
  raw: unknown,
): MissObservation | undefined {
  const observation = recordValue(raw);
  const attemptId = textValue(observation?.attemptId);
  const stopId = textValue(observation?.stopId);
  const journeyLevel = parseJourneyLevel(observation?.journeyLevel);
  const elapsedMs =
    observation?.elapsedMs === null
      ? null
      : nonNegativeNumber(observation?.elapsedMs);
  const missedAtMs = nonNegativeNumber(observation?.missedAtMs);
  if (
    !attemptId ||
    !stopId ||
    !journeyLevel ||
    elapsedMs === undefined ||
    missedAtMs === undefined
  ) {
    return undefined;
  }
  return { attemptId, stopId, journeyLevel, elapsedMs, missedAtMs };
}

function parseMissedQuestion(raw: unknown): MissedQuestion | undefined {
  const missed = recordValue(raw);
  if (!missed || !isQuestionReference(missed.question)) return undefined;
  const missCount = nonNegativeInteger(missed.missCount);
  const lastMissedAtMs = nonNegativeNumber(missed.lastMissedAtMs);
  if (!missCount || lastMissedAtMs === undefined) return undefined;
  const rawObservations = Array.isArray(missed.observations)
    ? missed.observations
    : [];
  const observations = rawObservations
    .map(parseMissObservation)
    .filter(
      (observation): observation is MissObservation =>
        observation !== undefined,
    );
  if (observations.length !== rawObservations.length) return undefined;
  return {
    key: questionReferenceIdentityKey(missed.question),
    question: missed.question,
    missCount: Math.max(missCount, observations.length),
    lastMissedAtMs,
    observations,
  };
}

function normalizedCompletion(
  journey: JourneyPlan,
  rawClearedStopIds: unknown,
  rawAwardedStopIds: unknown,
): {
  clearedStopIds: readonly string[];
  awardedStopIds: readonly string[];
} {
  const orderedNodeIds = journey.boards.flatMap(({ nodes }) =>
    nodes.map(({ id }) => id),
  );
  const requestedCleared = new Set(stringArray(rawClearedStopIds));
  const requestedAwarded = new Set(stringArray(rawAwardedStopIds));
  const clearedStopIds = orderedNodeIds.filter((nodeId) =>
    requestedCleared.has(nodeId),
  );
  const cleared = new Set(clearedStopIds);
  return {
    clearedStopIds,
    awardedStopIds: orderedNodeIds.filter(
      (nodeId) => cleared.has(nodeId) && requestedAwarded.has(nodeId),
    ),
  };
}

function parseJourneyPlanVersion(
  value: unknown,
  sourceSchemaVersion: number,
): JourneyPlanVersion {
  if (value === 1 || value === CURRENT_JOURNEY_PLAN_VERSION) return value;
  return sourceSchemaVersion <= 2 ? 1 : CURRENT_JOURNEY_PLAN_VERSION;
}

function parseXpAwards(
  raw: unknown,
  journey: JourneyPlan,
  clearedStopIds: readonly string[],
  legacyAwardedStopIds: readonly string[],
): readonly XpAward[] | undefined {
  const cleared = new Set(clearedStopIds);
  if (raw === undefined) {
    return legacyAwardedStopIds.flatMap((stopId) => {
      const node = findJourneyNode(journey, stopId);
      return node && cleared.has(stopId)
        ? [{ stopId, amount: node.xp }]
        : [];
    });
  }
  if (!Array.isArray(raw)) return undefined;
  const awards: XpAward[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const award = recordValue(item);
    const stopId = textValue(award?.stopId);
    const amount = nonNegativeInteger(award?.amount);
    if (
      !stopId ||
      amount === undefined ||
      amount < 1 ||
      seen.has(stopId) ||
      !cleared.has(stopId) ||
      !findJourneyNode(journey, stopId)
    ) {
      return undefined;
    }
    seen.add(stopId);
    awards.push({ stopId, amount });
  }
  return awards;
}

function parseProfile(
  raw: unknown,
  sourceSchemaVersion: number,
): PlayerProfile | undefined {
  const profile = recordValue(raw);
  const id = textValue(profile?.id);
  const name = textValue(profile?.name);
  const avatarId = textValue(profile?.avatarId);
  const journeyPlanVersion = parseJourneyPlanVersion(
    profile?.journeyPlanVersion,
    sourceSchemaVersion,
  );
  const gameSnapshot = parseJourneyGames(
    profile?.gameSnapshot ?? profile?.gameSlugs,
    journeyPlanVersion,
  );
  const createdAtMs = nonNegativeNumber(profile?.createdAtMs) ?? 0;
  const updatedAtMs = nonNegativeNumber(profile?.updatedAtMs) ?? createdAtMs;
  if (!id || !name || !avatarId || !gameSnapshot) return undefined;

  const journey = buildJourneyPlanForVersion(
    gameSnapshot,
    journeyPlanVersion,
  );
  const completion = normalizedCompletion(
    journey,
    profile?.clearedStopIds,
    profile?.awardedStopIds,
  );
  const xpAwards = parseXpAwards(
    profile?.xpAwards,
    journey,
    completion.clearedStopIds,
    completion.awardedStopIds,
  );
  if (!xpAwards) return undefined;
  const clearedStopIds = completion.clearedStopIds;
  const awardedStopIds = xpAwards.map(({ stopId }) => stopId);
  const requestedSettledAttemptIds = new Set(
    stringArray(profile?.settledAttemptIds),
  );
  const parsedAttempts: Record<string, ProgressionAttempt> = {};
  const rawAttempts = recordValue(profile?.attempts) ?? {};
  for (const rawAttempt of Object.values(rawAttempts)) {
    const attempt = parseAttempt(rawAttempt);
    const node = attempt
      ? findJourneyNode(journey, attempt.stopId)
      : undefined;
    if (!attempt || !node) continue;
    try {
      assertProgressionAttemptIntegrity(attempt, node);
    } catch {
      continue;
    }
    if (
      !canPlayerAccessJourneyNode(
        { name, clearedStopIds },
        journey,
        node.id,
      ) ||
      (attempt.settlement &&
        (!requestedSettledAttemptIds.has(attempt.id) ||
          (attempt.settlement.passed &&
            (!isJourneyTestProfile({ name }) ||
              attempt.settlement.xpAwarded > 0) &&
            (!awardedStopIds.includes(node.id) ||
              !clearedStopIds.includes(node.id))))) ||
      (!attempt.settlement && requestedSettledAttemptIds.has(attempt.id)) ||
      attempt.phase === "complete"
    ) {
      continue;
    }
    parsedAttempts[attempt.id] = attempt;
  }

  const missedQuestions = Array.isArray(profile?.missedQuestions)
    ? profile.missedQuestions
        .map(parseMissedQuestion)
        .filter(
          (missed): missed is MissedQuestion =>
            missed !== undefined &&
            gameSnapshot.some(({ slug }) => slug === missed.question.gameSlug),
        )
    : [];
  const missedByKey = new Map<string, MissedQuestion>();
  for (const missed of missedQuestions) {
    const previous = missedByKey.get(missed.key);
    if (!previous) {
      missedByKey.set(missed.key, missed);
      continue;
    }
    const latest =
      missed.lastMissedAtMs >= previous.lastMissedAtMs ? missed : previous;
    const observations = [...previous.observations, ...missed.observations];
    const seenObservations = new Set<string>();
    const uniqueObservations = observations.filter((observation) => {
      const key = [
        observation.attemptId,
        observation.stopId,
        observation.missedAtMs,
      ].join(":");
      if (seenObservations.has(key)) return false;
      seenObservations.add(key);
      return true;
    });
    missedByKey.set(missed.key, {
      ...latest,
      key: missed.key,
      missCount: Math.max(
        previous.missCount,
        missed.missCount,
        uniqueObservations.length,
      ),
      lastMissedAtMs: Math.max(
        previous.lastMissedAtMs,
        missed.lastMissedAtMs,
      ),
      observations: uniqueObservations,
    });
  }
  const activeAttemptCandidate =
    profile?.activeAttemptId === null
      ? null
      : textValue(profile?.activeAttemptId);
  const activeAttempt =
    activeAttemptCandidate && parsedAttempts[activeAttemptCandidate]
      ? parsedAttempts[activeAttemptCandidate]
      : undefined;
  const attempts: Record<string, ProgressionAttempt> = activeAttempt
    ? { [activeAttempt.id]: activeAttempt }
    : {};
  const settledAttemptIds =
    activeAttempt?.settlement &&
    requestedSettledAttemptIds.has(activeAttempt.id)
      ? [activeAttempt.id]
      : [];

  return {
    id,
    name,
    avatarId,
    createdAtMs,
    updatedAtMs,
    journeyPlanVersion,
    gameSnapshot,
    clearedStopIds,
    xpAwards,
    awardedStopIds,
    settledAttemptIds,
    missedQuestions: [...missedByKey.values()].sort(
      (left, right) => right.lastMissedAtMs - left.lastMissedAtMs,
    ),
    attempts,
    activeAttemptId: activeAttempt?.id ?? null,
  };
}

function legacyProfiles(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const record = recordValue(value);
  return record ? Object.values(record) : [];
}

/**
 * Accepts the current schema and the unversioned/version-0 prototype shape.
 * Unknown future schemas reset safely instead of guessing at user data.
 */
export function migrateProgressionState(raw: unknown): ProgressionState {
  const state = recordValue(raw);
  if (!state) {
    return {
      schemaVersion: PROGRESSION_SCHEMA_VERSION,
      activeProfileId: null,
      profiles: [],
    };
  }
  const version = state.schemaVersion ?? state.version ?? 0;
  if (!isSupportedSchemaVersion(version)) {
    return {
      schemaVersion: PROGRESSION_SCHEMA_VERSION,
      activeProfileId: null,
      profiles: [],
    };
  }

  const parsedProfiles = legacyProfiles(state.profiles)
    .map((profile) => parseProfile(profile, Number(version)))
    .filter((profile) => profile !== undefined);
  const profiles: PlayerProfile[] = [];
  const ids = new Set<string>();
  for (const profile of parsedProfiles) {
    if (ids.has(profile.id)) continue;
    ids.add(profile.id);
    profiles.push(profile);
  }
  const requestedActiveId =
    state.activeProfileId === null ? null : textValue(state.activeProfileId);

  return {
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    activeProfileId:
      requestedActiveId && ids.has(requestedActiveId)
        ? requestedActiveId
        : (profiles[0]?.id ?? null),
    profiles,
  };
}

function jsonEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEquivalent(item, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonEquivalent(leftRecord[key], rightRecord[key]),
    )
  );
}

export function decodeProgressionStateDiagnostic(
  serialized: string,
): ProgressionLoadResult {
  try {
    const raw = JSON.parse(serialized) as unknown;
    const record = recordValue(raw);
    if (!record) {
      return {
        state: migrateProgressionState(null),
        status: "corrupt",
      };
    }
    const version = record.schemaVersion ?? record.version ?? 0;
    if (!isSupportedSchemaVersion(version)) {
      return {
        state: migrateProgressionState(null),
        status: "unsupported",
      };
    }
    const state = migrateProgressionState(raw);
    return {
      state,
      status:
        version !== PROGRESSION_SCHEMA_VERSION
          ? "migrated"
          : jsonEquivalent(raw, state)
            ? "loaded"
            : "corrupt",
    };
  } catch {
    return {
      state: migrateProgressionState(null),
      status: "corrupt",
    };
  }
}

export function decodeProgressionState(serialized: string): ProgressionState {
  return decodeProgressionStateDiagnostic(serialized).state;
}

export function browserProgressionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadProgressionState(
  storage: StorageLike | null = browserProgressionStorage(),
  storageKey = PROGRESSION_STORAGE_KEY,
): ProgressionState {
  return loadProgressionStateDiagnostic(storage, storageKey).state;
}

export function loadProgressionStateDiagnostic(
  storage: StorageLike | null = browserProgressionStorage(),
  storageKey = PROGRESSION_STORAGE_KEY,
): ProgressionLoadResult {
  if (!storage) {
    return {
      state: migrateProgressionState(null),
      status: "unavailable",
    };
  }
  try {
    const serialized = storage.getItem(storageKey);
    return serialized === null
      ? {
          state: migrateProgressionState(null),
          status: "empty",
        }
      : decodeProgressionStateDiagnostic(serialized);
  } catch {
    return {
      state: migrateProgressionState(null),
      status: "unavailable",
    };
  }
}

export function saveProgressionState(
  state: ProgressionState,
  storage: StorageLike | null = browserProgressionStorage(),
  storageKey = PROGRESSION_STORAGE_KEY,
): boolean {
  if (!storage) return false;
  try {
    const normalized = migrateProgressionState(state);
    storage.setItem(storageKey, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function removeProgressionState(
  storage: StorageLike | null = browserProgressionStorage(),
  storageKey = PROGRESSION_STORAGE_KEY,
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
