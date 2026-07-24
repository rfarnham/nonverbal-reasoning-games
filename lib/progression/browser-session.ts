import {
  addAttemptActiveTime,
  advanceAttemptQuestion,
  advanceRedemptionQuestion,
  appendAttemptQuestion,
  beginAttemptRedemption,
  beginCulminationSection,
  currentAttemptRound,
  currentRedemptionQuestion,
  recordQuestionAttempt,
  recordRedemptionAttempt,
  retryCurrentQuestion,
  retryRedemptionQuestion,
} from "./attempts.ts";
import {
  browserProgressionStorage,
  loadProgressionStateDiagnostic,
  PROGRESSION_STORAGE_KEY,
  saveProgressionState,
} from "./persistence.ts";
import {
  buildJourneyPlanForVersion,
  findJourneyNode,
} from "./journey.ts";
import {
  activePlayerProfile,
  replacePlayerProfile,
  upsertProfileAttempt,
} from "./profiles.ts";
import { questionReferenceKey } from "./questions.ts";
import { deterministicTurboSeed } from "./session-builders.ts";
import {
  PROGRESSION_LEVELS,
  type AttemptRound,
  type PlayerProfile,
  type ProgressionAttempt,
  type ProgressionLevel,
  type ProgressionState,
  type QuestionReference,
  type StorageLike,
} from "./types.ts";
import {
  campaignQuestionReferences,
  createFreshGeneratedQuestion,
  ProgressionQuestionResolutionError,
  resolveProgressionQuestion,
  type ProgressionGameAdapter,
  type ResolvedProgressionQuestion,
} from "./game-adapter.ts";
import {
  recordAdaptiveFirstAttempt,
  type AdaptiveState,
} from "../adaptive-progression.ts";
import { journeyReviews } from "../journey-reviews.ts";

export type ProgressionRouteTarget = Readonly<{
  pathname:
    | "/journey/"
    | "/journey/summary/"
    | `/journey/reviews/${string}/`
    | `/games/${string}/`;
  query?: Readonly<Record<string, string>>;
}>;

export type BrowserSessionRecovery = Readonly<{
  mode: "recovery";
  message: string;
  navigationTarget: ProgressionRouteTarget;
}>;

export type BrowserSessionRedirect = Readonly<{
  mode: "redirect";
  message: string;
  navigationTarget: ProgressionRouteTarget;
}>;

export type BrowserSessionStandalone = Readonly<{
  mode: "standalone";
}>;

export type BrowserSessionControlled<Round> = Readonly<{
  mode: "controlled";
  state: ProgressionState;
  profile: PlayerProfile;
  attempt: ProgressionAttempt;
  current: ResolvedProgressionQuestion<Round> | null;
  isRedemption: boolean;
  navigationTarget: null;
}>;

export type BrowserProgressionSession<Round> =
  | BrowserSessionStandalone
  | BrowserSessionRecovery
  | BrowserSessionRedirect
  | BrowserSessionControlled<Round>;

export type BrowserSessionOptions = Readonly<{
  search?: string;
  attemptId?: string;
  storage?: StorageLike | null;
  storageKey?: string;
}>;

type PersistedContext = Readonly<{
  state: ProgressionState;
  profile: PlayerProfile;
  attempt: ProgressionAttempt;
  storage: StorageLike;
  storageKey: string;
}>;

type AnswerInput = Readonly<{
  correct: boolean;
  answerToken?: string;
  nowMs?: number;
}>;

const JOURNEY_TARGET: ProgressionRouteTarget = {
  pathname: "/journey/",
};

function gameTarget(
  gameSlug: string,
  attemptId: string,
): ProgressionRouteTarget {
  const review = journeyReviews.find(({ slug }) => slug === gameSlug);
  return {
    pathname: review?.href ?? `/games/${gameSlug}/`,
    query: { progression: attemptId },
  };
}

function summaryTarget(attemptId: string): ProgressionRouteTarget {
  return {
    pathname: "/journey/summary/",
    query: { attempt: attemptId },
  };
}

function recovery(message: string): BrowserSessionRecovery {
  return {
    mode: "recovery",
    message,
    navigationTarget: JOURNEY_TARGET,
  };
}

export function progressionAttemptIdFromSearch(
  search: string,
): string | null {
  try {
    const value = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    )
      .get("progression")
      ?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function requestedAttemptId(options: BrowserSessionOptions): string | null {
  const explicit = options.attemptId?.trim();
  if (explicit) return explicit;
  return progressionAttemptIdFromSearch(options.search ?? "");
}

function loadPersistedContext(
  options: BrowserSessionOptions,
): PersistedContext | BrowserSessionStandalone | BrowserSessionRecovery {
  const attemptId = requestedAttemptId(options);
  if (!attemptId) return { mode: "standalone" };

  const storage =
    options.storage === undefined
      ? browserProgressionStorage()
      : options.storage;
  if (!storage) {
    return recovery(
      "Journey progress is unavailable because device storage could not be opened.",
    );
  }
  const storageKey = options.storageKey ?? PROGRESSION_STORAGE_KEY;
  const loaded = loadProgressionStateDiagnostic(storage, storageKey);
  if (
    loaded.status === "corrupt" ||
    loaded.status === "unsupported" ||
    loaded.status === "unavailable"
  ) {
    return recovery(
      "Journey progress needs attention before this saved stop can continue.",
    );
  }
  const state = loaded.state;
  const profile = activePlayerProfile(state);
  if (!profile) {
    return recovery(
      "This journey session no longer has an active player profile.",
    );
  }
  if (profile.activeAttemptId !== attemptId) {
    return recovery(
      "This journey session is no longer the active stop for this player.",
    );
  }
  const attempt = profile.attempts[attemptId];
  if (!attempt) {
    return recovery("This journey session could not be found on this device.");
  }
  return {
    state,
    profile,
    attempt,
    storage,
    storageKey,
  };
}

function sameLogicalQuestion(
  left: QuestionReference,
  right: QuestionReference,
): boolean {
  if (
    left.source !== right.source ||
    left.gameSlug !== right.gameSlug ||
    left.level !== right.level
  ) {
    return false;
  }
  return left.source === "campaign" && right.source === "campaign"
    ? left.questionIndex === right.questionIndex
    : left.source === "journey" && right.source === "journey"
      ? left.journeyLevel === right.journeyLevel &&
        left.collectionId === right.collectionId &&
        left.questionIndex === right.questionIndex
      : left.source === "generated" &&
        right.source === "generated" &&
        left.seed === right.seed;
}

function logicalQuestionSlotKey(question: QuestionReference): string {
  const prefix = [
    encodeURIComponent(question.gameSlug),
    question.level,
    question.source,
  ];
  if (question.source === "campaign") {
    return [...prefix, question.questionIndex].join(":");
  }
  if (question.source === "journey") {
    return [
      ...prefix,
      question.journeyLevel,
      encodeURIComponent(question.collectionId),
      question.questionIndex,
    ].join(":");
  }
  return [...prefix, encodeURIComponent(question.seed)].join(":");
}

function isPristineAttemptRound(round: AttemptRound): boolean {
  return (
    round.phase === "answering" &&
    round.attemptCount === 0 &&
    round.firstTryCorrect === null &&
    round.lastAnswerToken === undefined
  );
}

/**
 * Early culmination builds could select the same Campaign slot twice when one
 * reference already had a fingerprint and the approachable copy did not. The
 * first copy then failed integrity validation as soon as it was materialized.
 * Replace only untouched duplicate copies with deterministic current Campaign
 * fallbacks so an already-saved test can continue without losing solved work.
 */
function repairCulminationQuestionCollisions<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attempt: ProgressionAttempt,
): ProgressionAttempt {
  if (attempt.kind !== "culmination" || attempt.phase !== "playing") {
    return attempt;
  }

  const seenSlots = new Set<string>();
  const duplicateIndexes: number[] = [];
  for (const [index, round] of attempt.rounds.entries()) {
    if (round.question.gameSlug !== adapter.gameSlug) continue;
    const slot = logicalQuestionSlotKey(round.question);
    if (seenSlots.has(slot)) {
      if (!isPristineAttemptRound(round)) {
        throw new Error("An attempted culmination question cannot be replaced.");
      }
      duplicateIndexes.push(index);
    } else {
      seenSlots.add(slot);
    }
  }
  if (!duplicateIndexes.length) return attempt;

  const duplicateSet = new Set(duplicateIndexes);
  const usedSlots = new Set(
    attempt.rounds
      .filter((_, index) => !duplicateSet.has(index))
      .map(({ question }) => logicalQuestionSlotKey(question)),
  );
  const candidates = campaignQuestionReferences(adapter, attempt.level).filter(
    (question) => !usedSlots.has(logicalQuestionSlotKey(question)),
  );
  if (candidates.length < duplicateIndexes.length) {
    throw new Error("No current Campaign fallback can repair this culmination.");
  }

  const rounds = [...attempt.rounds];
  duplicateIndexes.forEach((roundIndex, candidateIndex) => {
    const replacement = candidates[candidateIndex];
    if (!replacement) {
      throw new Error("A culmination fallback disappeared unexpectedly.");
    }
    rounds[roundIndex] = {
      ...rounds[roundIndex],
      question: replacement,
    };
    usedSlots.add(logicalQuestionSlotKey(replacement));
  });
  return { ...attempt, rounds };
}

function currentQuestion(
  attempt: ProgressionAttempt,
): QuestionReference | undefined {
  return attempt.phase === "redemption"
    ? currentRedemptionQuestion(attempt)
    : attempt.phase === "playing"
      ? currentAttemptRound(attempt)?.question
      : undefined;
}

function expectedGameForNonQuestionStage(
  attempt: ProgressionAttempt,
): string | undefined {
  if (attempt.phase === "redemption-ready") {
    return attempt.rounds.at(-1)?.question.gameSlug;
  }
  return undefined;
}

function questionGameMatchesJourney(
  profile: PlayerProfile,
  attempt: ProgressionAttempt,
  gameSlug: string,
): boolean {
  const node = findJourneyNode(
    buildJourneyPlanForVersion(
      profile.gameSnapshot,
      profile.journeyPlanVersion,
    ),
    attempt.stopId,
  );
  if (
    !node ||
    node.kind !== attempt.kind ||
    node.journeyLevel !== attempt.journeyLevel ||
    node.level !== attempt.level
  ) {
    return false;
  }
  return node.kind === "culmination"
    ? node.sections.some((section) => section.gameSlug === gameSlug)
    : node.gameSlug === gameSlug;
}

function exclusionSets(
  attempt: ProgressionAttempt,
  activeQuestion: QuestionReference,
): {
  fingerprints: ReadonlySet<string>;
  questionKeys: ReadonlySet<string>;
} {
  const fingerprints = new Set<string>();
  const questionKeys = new Set<string>();
  for (const { question } of attempt.rounds) {
    if (sameLogicalQuestion(question, activeQuestion)) continue;
    if (question.fingerprint) fingerprints.add(question.fingerprint);
    questionKeys.add(questionReferenceKey(question));
  }
  return { fingerprints, questionKeys };
}

function replaceCurrentQuestion(
  attempt: ProgressionAttempt,
  original: QuestionReference,
  replacement: QuestionReference,
): ProgressionAttempt {
  if (attempt.phase === "playing" && attempt.currentRoundIndex !== null) {
    const rounds = [...attempt.rounds];
    const round = rounds[attempt.currentRoundIndex];
    if (!round || !sameLogicalQuestion(round.question, original)) {
      throw new Error("The active progression question changed unexpectedly.");
    }
    rounds[attempt.currentRoundIndex] = {
      ...round,
      question: replacement,
    };
    return {
      ...attempt,
      rounds,
    };
  }

  if (attempt.phase === "redemption" && attempt.redemption) {
    const queue = [...attempt.redemption.queue];
    const queueQuestion = queue[attempt.redemption.currentIndex];
    if (!queueQuestion || !sameLogicalQuestion(queueQuestion, original)) {
      throw new Error("The active redemption question changed unexpectedly.");
    }
    queue[attempt.redemption.currentIndex] = replacement;
    const rounds = attempt.rounds.map((round) =>
      sameLogicalQuestion(round.question, original)
        ? { ...round, question: replacement }
        : round,
    );
    return {
      ...attempt,
      rounds,
      redemption: {
        ...attempt.redemption,
        queue,
      },
    };
  }

  throw new Error("This attempt does not have an active question to replace.");
}

function persistAttempt(
  context: PersistedContext,
  attempt: ProgressionAttempt,
): PersistedContext | BrowserSessionRecovery {
  try {
    const profile = upsertProfileAttempt(context.profile, attempt);
    const state = replacePlayerProfile(context.state, profile);
    if (!saveProgressionState(state, context.storage, context.storageKey)) {
      return recovery(
        "Journey progress could not be saved. Check device storage before continuing.",
      );
    }
    return {
      ...context,
      state,
      profile,
      attempt,
    };
  } catch {
    return recovery(
      "Journey progress could not be safely updated on this device.",
    );
  }
}

function isPersistedContext(
  value:
    | PersistedContext
    | BrowserSessionStandalone
    | BrowserSessionRecovery,
): value is PersistedContext {
  return !("mode" in value);
}

export function loadProgressionBrowserSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  options: BrowserSessionOptions = {},
): BrowserProgressionSession<Round> {
  let context = loadPersistedContext(options);
  if (!isPersistedContext(context)) return context;

  const { attempt } = context;
  if (
    attempt.phase === "summary-ready" ||
    attempt.phase === "summary" ||
    attempt.phase === "retry-required"
  ) {
    return {
      mode: "redirect",
      message: "This stop is ready for its summary.",
      navigationTarget: summaryTarget(attempt.id),
    };
  }
  if (attempt.phase === "complete") {
    return {
      mode: "redirect",
      message: "This stop is already complete.",
      navigationTarget: JOURNEY_TARGET,
    };
  }

  const question = currentQuestion(attempt);
  if (!question) {
    const expectedGame = expectedGameForNonQuestionStage(attempt);
    if (
      expectedGame &&
      !questionGameMatchesJourney(context.profile, attempt, expectedGame)
    ) {
      return recovery(
        "This journey stop contains a game that is not part of its saved path.",
      );
    }
    if (expectedGame && expectedGame !== adapter.gameSlug) {
      return {
        mode: "redirect",
        message: "Continue this stop in its current game.",
        navigationTarget: gameTarget(expectedGame, attempt.id),
      };
    }
    if (attempt.phase === "redemption-ready") {
      return {
        mode: "controlled",
        state: context.state,
        profile: context.profile,
        attempt,
        current: null,
        isRedemption: false,
        navigationTarget: null,
      };
    }
    return recovery("This journey stop has no current question.");
  }

  if (
    !questionGameMatchesJourney(
      context.profile,
      attempt,
      question.gameSlug,
    )
  ) {
    return recovery(
      "This journey stop contains a game that is not part of its saved path.",
    );
  }

  if (question.gameSlug !== adapter.gameSlug) {
    return {
      mode: "redirect",
      message: "Continue this stop in the next game.",
      navigationTarget: gameTarget(question.gameSlug, attempt.id),
    };
  }

  try {
    let activeAttempt = attempt;
    let activeQuestion = question;
    const repairedAttempt = repairCulminationQuestionCollisions(
      adapter,
      activeAttempt,
    );
    if (repairedAttempt !== activeAttempt) {
      const persisted = persistAttempt(context, repairedAttempt);
      if (!isPersistedContext(persisted)) return persisted;
      context = persisted;
      activeAttempt = persisted.attempt;
      const repairedQuestion = currentQuestion(activeAttempt);
      if (!repairedQuestion || repairedQuestion.gameSlug !== adapter.gameSlug) {
        return recovery(
          "This journey stop could not restore its current culmination question.",
        );
      }
      activeQuestion = repairedQuestion;
    }

    const exclusions = exclusionSets(activeAttempt, activeQuestion);
    const resolved = resolveProgressionQuestion(adapter, activeQuestion, {
      excludedFingerprints: exclusions.fingerprints,
      excludedQuestionKeys: exclusions.questionKeys,
    });
    if (resolved.migrated) {
      const nextAttempt = replaceCurrentQuestion(
        activeAttempt,
        activeQuestion,
        resolved.ref,
      );
      const persisted = persistAttempt(context, nextAttempt);
      if (!isPersistedContext(persisted)) return persisted;
      context = persisted;
    }
    return {
      mode: "controlled",
      state: context.state,
      profile: context.profile,
      attempt: context.attempt,
      current: resolved,
      isRedemption: context.attempt.phase === "redemption",
      navigationTarget: null,
    };
  } catch {
    return recovery(
      "This question no longer matches current game content. Return to the journey and try the stop again.",
    );
  }
}

function mutateBrowserAttempt<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  options: Omit<BrowserSessionOptions, "attemptId" | "search">,
  mutate: (attempt: ProgressionAttempt) => ProgressionAttempt,
): BrowserProgressionSession<Round> {
  const loaded = loadProgressionBrowserSession(adapter, {
    ...options,
    attemptId,
  });
  if (loaded.mode !== "controlled") return loaded;

  const storage =
    options.storage === undefined
      ? browserProgressionStorage()
      : options.storage;
  if (!storage) {
    return recovery(
      "Journey progress is unavailable because device storage could not be opened.",
    );
  }
  const context: PersistedContext = {
    state: loaded.state,
    profile: loaded.profile,
    attempt: loaded.attempt,
    storage,
    storageKey: options.storageKey ?? PROGRESSION_STORAGE_KEY,
  };

  try {
    const nextAttempt = mutate(loaded.attempt);
    const persisted = persistAttempt(context, nextAttempt);
    if (!isPersistedContext(persisted)) return persisted;
  } catch {
    return recovery(
      "That journey action could not be applied safely. Your saved progress was left unchanged.",
    );
  }
  return loadProgressionBrowserSession(adapter, {
    ...options,
    attemptId,
  });
}

export function answerProgressionBrowserSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  answer: AnswerInput,
  options: Omit<BrowserSessionOptions, "attemptId" | "search"> = {},
): BrowserProgressionSession<Round> {
  return mutateBrowserAttempt(adapter, attemptId, options, (attempt) => {
    if (attempt.phase === "redemption") {
      const retryable =
        attempt.redemption?.phase === "feedback"
          ? retryRedemptionQuestion(attempt, answer.nowMs)
          : attempt;
      return recordRedemptionAttempt(retryable, answer);
    }
    if (attempt.phase !== "playing") {
      throw new Error("This attempt is not accepting answers.");
    }
    const retryable =
      currentAttemptRound(attempt)?.phase === "feedback"
        ? retryCurrentQuestion(attempt, answer.nowMs)
        : attempt;
    return recordQuestionAttempt(retryable, answer);
  });
}

export function retryProgressionBrowserSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  nowMs?: number,
  options: Omit<BrowserSessionOptions, "attemptId" | "search"> = {},
): BrowserProgressionSession<Round> {
  return mutateBrowserAttempt(adapter, attemptId, options, (attempt) =>
    attempt.phase === "redemption"
      ? retryRedemptionQuestion(attempt, nowMs)
      : retryCurrentQuestion(attempt, nowMs),
  );
}

function turboAdaptiveLevel(attempt: ProgressionAttempt): ProgressionLevel {
  const capIndex = PROGRESSION_LEVELS.indexOf(attempt.level);
  const allowedLevels = PROGRESSION_LEVELS.slice(0, capIndex + 1);
  let state: AdaptiveState<ProgressionLevel> = {
    targetDifficulty: "starter",
    recentAtLevel: [],
    combo: 0,
    attempts: [],
  };
  for (const round of attempt.rounds) {
    if (round.firstTryCorrect === null) continue;
    if (!allowedLevels.includes(round.question.level)) {
      throw new Error("Turbo question difficulty exceeds the board level.");
    }
    state = recordAdaptiveFirstAttempt(allowedLevels, state, {
      roundId: questionReferenceKey(round.question),
      difficulty: round.question.level,
      firstTryCorrect: round.firstTryCorrect,
    });
  }
  return state.targetDifficulty;
}

function usedQuestionIdentity(attempt: ProgressionAttempt): {
  fingerprints: ReadonlySet<string>;
  questionKeys: ReadonlySet<string>;
} {
  const fingerprints = new Set<string>();
  const questionKeys = new Set<string>();
  for (const { question } of attempt.rounds) {
    if (question.fingerprint) fingerprints.add(question.fingerprint);
    questionKeys.add(questionReferenceKey(question));
  }
  return { fingerprints, questionKeys };
}

function appendNextTurboQuestion<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  const used = usedQuestionIdentity(attempt);
  const generated = createFreshGeneratedQuestion(adapter, {
    level: turboAdaptiveLevel(attempt),
    seedBase: deterministicTurboSeed(
      attempt.id,
      attempt.stopId,
      attempt.rounds.length,
    ),
    excludedFingerprints: used.fingerprints,
    excludedQuestionKeys: used.questionKeys,
  });
  return appendAttemptQuestion(attempt, generated.ref, nowMs);
}

export function advanceProgressionBrowserSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  nowMs?: number,
  options: Omit<BrowserSessionOptions, "attemptId" | "search"> = {},
): BrowserProgressionSession<Round> {
  return mutateBrowserAttempt(adapter, attemptId, options, (attempt) => {
    if (attempt.phase === "redemption") {
      return advanceRedemptionQuestion(attempt, nowMs);
    }
    if (attempt.phase !== "playing") {
      throw new Error("This attempt cannot advance.");
    }

    let nextAttempt = attempt;
    const currentIndex = attempt.currentRoundIndex;
    const current = currentAttemptRound(attempt);
    if (
      attempt.kind === "turbo" &&
      current?.phase === "solved" &&
      currentIndex === attempt.rounds.length - 1 &&
      (attempt.turboRemainingMs ?? 0) > 0
    ) {
      try {
        nextAttempt = appendNextTurboQuestion(adapter, attempt, nowMs);
      } catch (error) {
        if (!(error instanceof ProgressionQuestionResolutionError)) {
          throw error;
        }
        // A finite engine or a long run can exhaust every unique generated
        // and Campaign fallback. Finish the already-solved Turbo run instead
        // of trapping the player on a Next button that can never succeed.
        nextAttempt = {
          ...attempt,
          turboRemainingMs: 0,
        };
      }
    }
    return advanceAttemptQuestion(nextAttempt, nowMs);
  });
}

export function beginProgressionBrowserSection<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  nowMs?: number,
  options: Omit<BrowserSessionOptions, "attemptId" | "search"> = {},
): BrowserProgressionSession<Round> {
  return mutateBrowserAttempt(adapter, attemptId, options, (attempt) =>
    beginCulminationSection(attempt, nowMs),
  );
}

export function beginRedemptionBrowserSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  nowMs?: number,
  options: Omit<BrowserSessionOptions, "attemptId" | "search"> = {},
): BrowserProgressionSession<Round> {
  return mutateBrowserAttempt(adapter, attemptId, options, (attempt) =>
    beginAttemptRedemption(attempt, nowMs),
  );
}

export function addActiveTimeBrowserSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  attemptId: string,
  elapsedMs: number,
  nowMs?: number,
  options: Omit<BrowserSessionOptions, "attemptId" | "search"> = {},
  timing: {
    countTowardTurbo?: boolean;
    countTowardFirstAnswer?: boolean;
  } = {},
): BrowserProgressionSession<Round> {
  return mutateBrowserAttempt(adapter, attemptId, options, (attempt) => {
    if (attempt.phase !== "playing" && attempt.phase !== "redemption") {
      return attempt;
    }
    return addAttemptActiveTime(attempt, elapsedMs, nowMs, {
      countTowardTurbo:
        attempt.phase === "playing" &&
        timing.countTowardTurbo !== false,
      countTowardFirstAnswer:
        attempt.phase === "playing" &&
        timing.countTowardFirstAnswer !== false,
    });
  });
}

export function currentBrowserAttemptRound(
  attempt: ProgressionAttempt,
): AttemptRound | undefined {
  return currentAttemptRound(attempt);
}
