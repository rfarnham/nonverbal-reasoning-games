export const PROGRESSION_SCHEMA_VERSION = 3 as const;
export const CURRENT_JOURNEY_PLAN_VERSION = 2 as const;
export type JourneyPlanVersion = 1 | typeof CURRENT_JOURNEY_PLAN_VERSION;

export const PROGRESSION_LEVELS = [
  "starter",
  "junior",
  "expert",
  "wizard",
] as const;

/**
 * The four canonical game difficulties. Standalone Campaign and Infinite mode
 * intentionally continue to use only these tiers.
 */
export type ProgressionLevel = (typeof PROGRESSION_LEVELS)[number];

export const JOURNEY_LEVELS = [
  "starter",
  "junior-1",
  "junior-2",
  "expert-1",
  "expert-2",
  "wizard-1",
  "wizard-2",
] as const;

export type JourneyLevel = (typeof JOURNEY_LEVELS)[number];

export type JourneyReviewGradeBand = "grades-1-2" | "grades-3-4";

export type JourneyLevelMetadata = Readonly<{
  label: string;
  difficulty: ProgressionLevel;
  xpPerStop: number;
  reviewGradeBand: JourneyReviewGradeBand | null;
}>;

export const JOURNEY_LEVEL_METADATA = {
  starter: {
    label: "Starter",
    difficulty: "starter",
    xpPerStop: 25,
    reviewGradeBand: null,
  },
  "junior-1": {
    label: "Junior I",
    difficulty: "junior",
    xpPerStop: 50,
    reviewGradeBand: "grades-1-2",
  },
  "junior-2": {
    label: "Junior II",
    difficulty: "junior",
    xpPerStop: 100,
    reviewGradeBand: "grades-1-2",
  },
  "expert-1": {
    label: "Expert I",
    difficulty: "expert",
    xpPerStop: 200,
    reviewGradeBand: "grades-1-2",
  },
  "expert-2": {
    label: "Expert II",
    difficulty: "expert",
    xpPerStop: 400,
    reviewGradeBand: "grades-3-4",
  },
  "wizard-1": {
    label: "Wizard I",
    difficulty: "wizard",
    xpPerStop: 800,
    reviewGradeBand: "grades-3-4",
  },
  "wizard-2": {
    label: "Wizard II",
    difficulty: "wizard",
    xpPerStop: 1600,
    reviewGradeBand: "grades-3-4",
  },
} as const satisfies Readonly<Record<JourneyLevel, JourneyLevelMetadata>>;

export function journeyLevelMetadata(
  level: JourneyLevel,
): JourneyLevelMetadata {
  return JOURNEY_LEVEL_METADATA[level];
}

export function journeyLevelLabel(level: JourneyLevel): string {
  return journeyLevelMetadata(level).label;
}

export function journeyLevelDifficulty(
  level: JourneyLevel,
): ProgressionLevel {
  return journeyLevelMetadata(level).difficulty;
}

export function isJourneyLevel(value: unknown): value is JourneyLevel {
  return (
    typeof value === "string" &&
    JOURNEY_LEVELS.includes(value as JourneyLevel)
  );
}

/**
 * Compatibility mapping for the original four-board Journey. New code should
 * persist a JourneyLevel directly instead of inferring one from difficulty.
 */
export function firstJourneyLevelForDifficulty(
  level: ProgressionLevel,
): JourneyLevel {
  if (level === "starter") return "starter";
  return `${level}-1` as JourneyLevel;
}

export function journeyCampaignCollectionId(level: JourneyLevel): string {
  return `campaign:${level}`;
}

export function journeyReviewCollectionId(level: JourneyLevel): string {
  return `review:${level}`;
}

export const JOURNEY_GAMES_PER_BOARD = 8;
export const NORMAL_STOPS_PER_BOARD = 8;
export const TURBO_STOPS_PER_BOARD = 4;
export const REVIEW_STOPS_PER_BOARD = 2;
export const TURBO_ACTIVE_TIME_MS = 2 * 60 * 1000;
export const CAMPAIGN_QUESTIONS_PER_STOP = 12;
export const REVIEW_QUESTIONS_PER_STOP = 12;
export const REVIEW_CULMINATION_QUESTIONS = 4;
export const CLEAR_ACCURACY_THRESHOLD = 0.7;

/**
 * Legacy four-tier lookup retained until persisted XP is migrated to a
 * write-once award ledger. New Journey planning uses XP_PER_JOURNEY_STOP.
 */
export const XP_PER_STOP: Readonly<Record<ProgressionLevel, number>> = {
  starter: 25,
  junior: 50,
  expert: 100,
  wizard: 200,
};

export const XP_PER_JOURNEY_STOP: Readonly<Record<JourneyLevel, number>> =
  Object.fromEntries(
    JOURNEY_LEVELS.map((level) => [
      level,
      JOURNEY_LEVEL_METADATA[level].xpPerStop,
    ]),
  ) as Readonly<Record<JourneyLevel, number>>;

export type JourneyGameRole = "game" | "review";

export type JourneyGame = {
  slug: string;
  title: string;
  contentVersion?: string;
  generatorVersion?: string;
  journeyContentVersion?: string;
  role?: JourneyGameRole;
};

type JourneyNodeBase = {
  id: string;
  journeyLevel: JourneyLevel;
  /**
   * Four-tier difficulty alias retained for game adapters and the current
   * attempt schema while persistence migrates to an explicit journeyLevel.
   */
  level: ProgressionLevel;
  position: number;
  xp: number;
};

export type NormalJourneyNode = JourneyNodeBase & {
  kind: "normal";
  gameSlug: string;
  collectionId: string;
  questionOffset: 0;
  questionCount: typeof CAMPAIGN_QUESTIONS_PER_STOP;
};

export type TurboJourneyNode = JourneyNodeBase & {
  kind: "turbo";
  gameSlug: string;
  activeTimeMs: typeof TURBO_ACTIVE_TIME_MS;
};

export type ReviewJourneyNode = JourneyNodeBase & {
  kind: "review";
  gameSlug: string;
  collectionId: string;
  questionOffset: number;
  questionCount: typeof REVIEW_QUESTIONS_PER_STOP;
};

export type CulminationMistakeSection = {
  selection: "mistakes";
  gameSlug: string;
  questionCount: 3;
};

export type CulminationFixedSection = {
  selection: "fixed";
  gameSlug: string;
  collectionId: string;
  questionOffset: number;
  questionCount: typeof REVIEW_CULMINATION_QUESTIONS;
};

export type CulminationSectionSpec =
  | CulminationMistakeSection
  | CulminationFixedSection;

export type CulminationJourneyNode = JourneyNodeBase & {
  kind: "culmination";
  sections: readonly CulminationSectionSpec[];
  /**
   * Compatibility fields for the current culmination builder. `sections` is
   * the canonical shape and can express non-uniform fixed review sections.
   */
  gameSlugs: readonly string[];
  questionsPerGame: 3;
};

export type JourneyNode =
  | NormalJourneyNode
  | TurboJourneyNode
  | ReviewJourneyNode
  | CulminationJourneyNode;

export type JourneyBoard = {
  journeyLevel: JourneyLevel;
  /** Compatibility alias for the board's four-tier difficulty cap. */
  level: ProgressionLevel;
  position: number;
  nodes: readonly JourneyNode[];
  availableXp: number;
};

export type JourneyPlan = {
  gameSnapshot: readonly JourneyGame[];
  boards: readonly JourneyBoard[];
};

type QuestionReferenceBase = {
  gameSlug: string;
  level: ProgressionLevel;
  fingerprint?: string;
};

export type CampaignQuestionReference = QuestionReferenceBase & {
  source: "campaign";
  questionIndex: number;
  contentVersion: string;
};

export type GeneratedQuestionReference = QuestionReferenceBase & {
  source: "generated";
  seed: string;
  generatorVersion: string;
};

export type JourneyQuestionReference = QuestionReferenceBase & {
  source: "journey";
  journeyLevel: JourneyLevel;
  collectionId: string;
  questionIndex: number;
  contentVersion: string;
};

export type QuestionReference =
  | CampaignQuestionReference
  | GeneratedQuestionReference
  | JourneyQuestionReference;

export type AttemptKind = JourneyNode["kind"];
export type AttemptPhase =
  | "playing"
  | "redemption-ready"
  | "redemption"
  | "summary-ready"
  | "summary"
  | "retry-required"
  | "complete";

export type AttemptRoundPhase = "answering" | "feedback" | "solved";

export type AttemptRound = {
  question: QuestionReference;
  phase: AttemptRoundPhase;
  attemptCount: number;
  firstTryCorrect: boolean | null;
  /**
   * Visible, active time accumulated before the first answer. Undefined is
   * reserved for migrated legacy rounds whose answer timing is unknowable.
   */
  firstAnswerActiveTimeMs?: number;
  /**
   * Device-local timestamp captured when the first answer is submitted.
   * Undefined is reserved for unanswered and migrated legacy rounds.
   */
  firstAnsweredAtMs?: number;
  lastAnswerToken?: string;
};

export type AttemptSection = {
  gameSlug: string;
  startRoundIndex: number;
  questionCount: number;
};

export type RedemptionState = {
  queue: readonly QuestionReference[];
  currentIndex: number;
  phase: AttemptRoundPhase;
  attemptCount: number;
  lastAnswerToken?: string;
};

export type AttemptSettlement = {
  passed: boolean;
  correctFirstAttempts: number;
  totalFirstAttempts: number;
  accuracy: number;
  accuracyPercent: number;
  activeTimeMs: number;
  xpAwarded: number;
  settledAtMs: number;
};

export type ProgressionAttempt = {
  schemaVersion: typeof PROGRESSION_SCHEMA_VERSION;
  id: string;
  stopId: string;
  kind: AttemptKind;
  journeyLevel: JourneyLevel;
  /** Four-tier game difficulty retained for question resolution. */
  level: ProgressionLevel;
  phase: AttemptPhase;
  rounds: readonly AttemptRound[];
  currentRoundIndex: number | null;
  sections: readonly AttemptSection[];
  currentSectionIndex: number | null;
  pendingSectionIndex: number | null;
  redemption: RedemptionState | null;
  activeTimeMs: number;
  turboRemainingMs?: number;
  startedAtMs: number;
  updatedAtMs: number;
  settlement?: AttemptSettlement;
};

export type MissObservation = {
  attemptId: string;
  stopId: string;
  journeyLevel: JourneyLevel;
  elapsedMs: number | null;
  missedAtMs: number;
};

export type MissedQuestion = {
  key: string;
  question: QuestionReference;
  missCount: number;
  lastMissedAtMs: number;
  observations: readonly MissObservation[];
};

export type XpAward = {
  stopId: string;
  amount: number;
};

export type PlayerProfile = {
  id: string;
  name: string;
  avatarId: string;
  createdAtMs: number;
  updatedAtMs: number;
  journeyPlanVersion: JourneyPlanVersion;
  gameSnapshot: readonly JourneyGame[];
  clearedStopIds: readonly string[];
  xpAwards: readonly XpAward[];
  /** Legacy idempotency index retained while storage migrates to xpAwards. */
  awardedStopIds: readonly string[];
  settledAttemptIds: readonly string[];
  missedQuestions: readonly MissedQuestion[];
  attempts: Readonly<Record<string, ProgressionAttempt>>;
  activeAttemptId: string | null;
};

export type ProgressionState = {
  schemaVersion: typeof PROGRESSION_SCHEMA_VERSION;
  activeProfileId: string | null;
  profiles: readonly PlayerProfile[];
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
