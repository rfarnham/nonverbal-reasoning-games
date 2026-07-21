export const PROGRESSION_SCHEMA_VERSION = 2 as const;

export const PROGRESSION_LEVELS = [
  "starter",
  "junior",
  "expert",
  "wizard",
] as const;

export type ProgressionLevel = (typeof PROGRESSION_LEVELS)[number];

export const JOURNEY_GAMES_PER_BOARD = 8;
export const NORMAL_STOPS_PER_BOARD = 8;
export const TURBO_STOPS_PER_BOARD = 4;
export const TURBO_ACTIVE_TIME_MS = 2 * 60 * 1000;
export const CAMPAIGN_QUESTIONS_PER_STOP = 12;
export const CLEAR_ACCURACY_THRESHOLD = 0.7;

export const XP_PER_STOP: Readonly<Record<ProgressionLevel, number>> = {
  starter: 25,
  junior: 50,
  expert: 100,
  wizard: 200,
};

export type JourneyGame = {
  slug: string;
  title: string;
  contentVersion?: string;
  generatorVersion?: string;
};

type JourneyNodeBase = {
  id: string;
  level: ProgressionLevel;
  position: number;
  xp: number;
};

export type NormalJourneyNode = JourneyNodeBase & {
  kind: "normal";
  gameSlug: string;
  questionCount: typeof CAMPAIGN_QUESTIONS_PER_STOP;
};

export type TurboJourneyNode = JourneyNodeBase & {
  kind: "turbo";
  gameSlug: string;
  activeTimeMs: typeof TURBO_ACTIVE_TIME_MS;
};

export type CulminationJourneyNode = JourneyNodeBase & {
  kind: "culmination";
  gameSlugs: readonly string[];
  questionsPerGame: 3;
};

export type JourneyNode =
  | NormalJourneyNode
  | TurboJourneyNode
  | CulminationJourneyNode;

export type JourneyBoard = {
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

export type QuestionReference =
  | CampaignQuestionReference
  | GeneratedQuestionReference;

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

export type MissedQuestion = {
  key: string;
  question: QuestionReference;
  missCount: number;
  lastMissedAtMs: number;
};

export type PlayerProfile = {
  id: string;
  name: string;
  avatarId: string;
  createdAtMs: number;
  updatedAtMs: number;
  gameSnapshot: readonly JourneyGame[];
  clearedStopIds: readonly string[];
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
