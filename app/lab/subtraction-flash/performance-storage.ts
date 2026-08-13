export const PERFORMANCE_STORAGE_KEY =
  "spatial-gym:subtraction-flash:performance:v2";
export const PERFORMANCE_LEGACY_STORAGE_KEY =
  "spatial-gym:subtraction-flash:performance:v1";
export const PERFORMANCE_SCHEMA_VERSION = 2 as const;
export const PERFORMANCE_SLOW_RESPONSE_MS = 4_000;

export type PerformanceGameType =
  | "infinite"
  | "two-minute"
  | "deck-sprint";
export type PerformancePresentationMode = "visual" | "listen";
export type PerformanceOrientation = "horizontal" | "vertical";
export type PerformanceLevel = "B100" | "B120";
export type PerformanceInputMode = "tap" | "draw" | "trace" | "speak";
export type PerformanceInputSource =
  | "tap"
  | "keyboard"
  | "handwriting"
  | "trace"
  | "speech";
export type PerformanceOutcomeReason =
  | "incorrect"
  | "slow"
  | "both"
  | null;
export type PerformanceSessionFinishReason =
  | "manual"
  | "time"
  | "deck"
  | "abandoned";
export type PerformanceSessionLane = "main" | "retry" | "redemption";

export type PerformanceStorageLike = Pick<Storage, "getItem" | "setItem">;

export type PerformanceLocalTimestamp = Readonly<{
  localDate: string;
  localTime: string;
  timeZone: string;
  utcOffsetMinutes: number;
}>;

export type PerformanceAttempt = Readonly<
  PerformanceLocalTimestamp & {
    id: string;
    sessionId: string;
    occurredAt: number;
    sessionPosition: number;
    gameType: PerformanceGameType;
    level: PerformanceLevel;
    presentationMode: PerformancePresentationMode;
    inputMode: PerformanceInputMode;
    orientation: PerformanceOrientation | null;
    inputSource: PerformanceInputSource;
    cardId: string;
    factKey: string;
    minuend: number;
    subtrahend: number;
    expectedAnswer: number;
    submittedAnswer: number;
    correct: boolean;
    elapsedMs: number;
    slow: boolean;
    /** One-based submission number for the currently displayed question. */
    attemptOrdinal: number;
    /** True only for the original main-deck submission scored by analytics. */
    firstAttempt: boolean;
    /** The session segment in which this raw submission occurred. */
    sessionLane: PerformanceSessionLane;
    isReview: boolean;
    reviewQueued: boolean;
    reinserted: boolean;
    outcomeReason: PerformanceOutcomeReason;
    drawNumber: number;
    cycle: number;
    cardsRemainingAfter: number;
    sessionElapsedMs: number;
    rawRecognition: string | null;
    recognitionConfidence: number | null;
    recognitionMargin: number | null;
    recognitionProcessingMs: number | null;
  }
>;

export type CreatePerformanceAttemptInput = Readonly<{
  id?: string;
  sessionId: string;
  occurredAt?: number;
  sessionPosition: number;
  gameType: PerformanceGameType;
  level: PerformanceLevel;
  presentationMode: PerformancePresentationMode;
  inputMode: PerformanceInputMode;
  orientation?: PerformanceOrientation | null;
  inputSource: PerformanceInputSource;
  cardId: string;
  factKey: string;
  minuend: number;
  subtrahend: number;
  expectedAnswer: number;
  submittedAnswer: number;
  correct?: boolean;
  elapsedMs: number;
  slow?: boolean;
  attemptOrdinal?: number;
  firstAttempt?: boolean;
  sessionLane?: PerformanceSessionLane;
  isReview: boolean;
  reviewQueued?: boolean;
  reinserted?: boolean;
  outcomeReason?: PerformanceOutcomeReason;
  drawNumber: number;
  cycle: number;
  cardsRemainingAfter: number;
  sessionElapsedMs: number;
  rawRecognition?: string | null;
  recognitionConfidence?: number | null;
  recognitionMargin?: number | null;
  recognitionProcessingMs?: number | null;
}>;

export type PerformanceSessionStart = Readonly<
  PerformanceLocalTimestamp & {
    id: string;
    event: "start";
    sessionId: string;
    occurredAt: number;
    gameType: PerformanceGameType;
    level: PerformanceLevel;
    presentationMode: PerformancePresentationMode;
    inputMode: PerformanceInputMode;
    baseDeckSize: number;
  }
>;

export type CreatePerformanceSessionInput = Readonly<{
  sessionId: string;
  gameType: PerformanceGameType;
  level: PerformanceLevel;
  presentationMode: PerformancePresentationMode;
  inputMode: PerformanceInputMode;
  baseDeckSize: number;
  startedAt?: number;
}>;

export type PerformanceSessionFinish = Readonly<
  PerformanceLocalTimestamp & {
    id: string;
    event: "finish";
    sessionId: string;
    occurredAt: number;
    finishReason: PerformanceSessionFinishReason;
    elapsedMs: number;
    answered: number;
    correct: number;
    slow: number;
    reviews: number;
    baseDeckSize: number;
  }
>;

export type FinishPerformanceSessionInput = Readonly<{
  finishedAt?: number;
  finishReason: PerformanceSessionFinishReason;
  elapsedMs: number;
  answered: number;
  correct: number;
  slow: number;
  reviews: number;
  baseDeckSize: number;
}>;

export type PerformanceSessionEvent =
  | PerformanceSessionStart
  | PerformanceSessionFinish;

export type PerformanceLog = Readonly<{
  schemaVersion: typeof PERFORMANCE_SCHEMA_VERSION;
  attempts: readonly PerformanceAttempt[];
  sessionEvents: readonly PerformanceSessionEvent[];
}>;

export type PerformanceLoadStatus =
  | "empty"
  | "loaded"
  | "corrupt"
  | "unsupported"
  | "unavailable";

export type PerformanceLoadDiagnostic = Readonly<{
  status: PerformanceLoadStatus;
  log: PerformanceLog | null;
  canWrite: boolean;
  message: string | null;
}>;

export type PerformanceWriteStatus =
  | "written"
  | "duplicate"
  | "conflict"
  | "missing-session"
  | "corrupt"
  | "unsupported"
  | "unavailable"
  | "write-failed";

export type PerformanceWriteResult = Readonly<{
  ok: boolean;
  status: PerformanceWriteStatus;
}>;

const EMPTY_LOG: PerformanceLog = Object.freeze({
  schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  attempts: Object.freeze([]),
  sessionEvents: Object.freeze([]),
});

const GAME_TYPES: readonly PerformanceGameType[] = [
  "infinite",
  "two-minute",
  "deck-sprint",
];
const PRESENTATION_MODES: readonly PerformancePresentationMode[] = [
  "visual",
  "listen",
];
const LEVELS: readonly PerformanceLevel[] = ["B100", "B120"];
const INPUT_MODES: readonly PerformanceInputMode[] = [
  "tap",
  "draw",
  "trace",
  "speak",
];
const ORIENTATIONS: readonly PerformanceOrientation[] = [
  "horizontal",
  "vertical",
];
const INPUT_SOURCES: readonly PerformanceInputSource[] = [
  "tap",
  "keyboard",
  "handwriting",
  "trace",
  "speech",
];
const OUTCOME_REASONS: readonly Exclude<
  PerformanceOutcomeReason,
  null
>[] = ["incorrect", "slow", "both"];
const FINISH_REASONS: readonly PerformanceSessionFinishReason[] = [
  "manual",
  "time",
  "deck",
  "abandoned",
];
const SESSION_LANES: readonly PerformanceSessionLane[] = [
  "main",
  "retry",
  "redemption",
];
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return isFiniteNonnegative(value) && Number.isSafeInteger(value);
}

function isNullableUnitInterval(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1)
  );
}

function isNullableNonnegative(value: unknown): value is number | null {
  return value === null || isFiniteNonnegative(value);
}

function isValidEpoch(value: unknown): value is number {
  return (
    isNonnegativeInteger(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isLocalTimestamp(value: Record<string, unknown>): boolean {
  return (
    typeof value.localDate === "string" &&
    LOCAL_DATE_PATTERN.test(value.localDate) &&
    typeof value.localTime === "string" &&
    LOCAL_TIME_PATTERN.test(value.localTime) &&
    isText(value.timeZone) &&
    typeof value.utcOffsetMinutes === "number" &&
    Number.isInteger(value.utcOffsetMinutes) &&
    value.utcOffsetMinutes >= -840 &&
    value.utcOffsetMinutes <= 840
  );
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function performanceLocalTimestamp(
  occurredAt: number,
): PerformanceLocalTimestamp {
  if (!isValidEpoch(occurredAt)) {
    throw new RangeError("Performance timestamps must be valid epoch milliseconds.");
  }
  const date = new Date(occurredAt);
  let timeZone = "unknown";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  } catch {
    // The numeric offset still makes the local timestamp unambiguous.
  }
  return {
    localDate: `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}`,
    localTime: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds(),
    )}.${pad(date.getMilliseconds(), 3)}`,
    timeZone,
    utcOffsetMinutes: -date.getTimezoneOffset(),
  };
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!isNonnegativeInteger(value)) {
    throw new RangeError(`${name} must be a nonnegative integer.`);
  }
}

function assertFiniteNonnegative(value: number, name: string): void {
  if (!isFiniteNonnegative(value)) {
    throw new RangeError(`${name} must be a finite nonnegative number.`);
  }
}

function inferredOutcomeReason(
  correct: boolean,
  slow: boolean,
): PerformanceOutcomeReason {
  if (!correct && slow) return "both";
  if (!correct) return "incorrect";
  if (slow) return "slow";
  return null;
}

function isValidPerformanceFact(
  level: PerformanceLevel,
  minuend: unknown,
  subtrahend: unknown,
): boolean {
  if (!Number.isSafeInteger(minuend) || !Number.isSafeInteger(subtrahend)) {
    return false;
  }
  const safeMinuend = minuend as number;
  const safeSubtrahend = subtrahend as number;
  if (level === "B100") {
    return (
      safeMinuend >= 11 &&
      safeMinuend <= 18 &&
      safeSubtrahend >= 2 &&
      safeSubtrahend <= 9 &&
      safeMinuend % 10 < safeSubtrahend
    );
  }
  return (
    safeMinuend >= 20 &&
    safeMinuend <= 64 &&
    safeSubtrahend >= 2 &&
    safeSubtrahend <= 10 &&
    (safeSubtrahend === 10 || safeMinuend % 10 < safeSubtrahend)
  );
}

function inputSourceMatchesMode(
  inputMode: PerformanceInputMode,
  inputSource: PerformanceInputSource,
): boolean {
  switch (inputMode) {
    case "tap":
      return inputSource === "tap" || inputSource === "keyboard";
    case "draw":
      return inputSource === "handwriting";
    case "trace":
      return inputSource === "trace";
    case "speak":
      return inputSource === "speech";
  }
}

export function createPerformanceAttempt(
  input: CreatePerformanceAttemptInput,
): PerformanceAttempt {
  const occurredAt = input.occurredAt ?? Date.now();
  if (!isText(input.sessionId) || !isText(input.cardId) || !isText(input.factKey)) {
    throw new TypeError("Performance attempt identifiers must be nonempty strings.");
  }
  assertNonnegativeInteger(input.sessionPosition, "sessionPosition");
  assertNonnegativeInteger(input.drawNumber, "drawNumber");
  assertNonnegativeInteger(input.cycle, "cycle");
  assertNonnegativeInteger(input.cardsRemainingAfter, "cardsRemainingAfter");
  assertFiniteNonnegative(input.elapsedMs, "elapsedMs");
  assertFiniteNonnegative(input.sessionElapsedMs, "sessionElapsedMs");
  if (!LEVELS.includes(input.level)) {
    throw new TypeError("Unknown subtraction level.");
  }
  if (!INPUT_MODES.includes(input.inputMode)) {
    throw new TypeError("Unknown configured input mode.");
  }
  if (!isValidPerformanceFact(input.level, input.minuend, input.subtrahend)) {
    throw new RangeError(
      "Performance attempts must contain a fact allowed by the selected level.",
    );
  }
  if (
    !Number.isSafeInteger(input.expectedAnswer) ||
    input.expectedAnswer !== input.minuend - input.subtrahend ||
    !Number.isSafeInteger(input.submittedAnswer)
  ) {
    throw new RangeError("Performance attempt answers are inconsistent with the fact.");
  }
  if (!GAME_TYPES.includes(input.gameType)) {
    throw new TypeError("Unknown performance game type.");
  }
  if (!PRESENTATION_MODES.includes(input.presentationMode)) {
    throw new TypeError("Unknown presentation mode.");
  }
  if (
    input.orientation !== undefined &&
    input.orientation !== null &&
    !ORIENTATIONS.includes(input.orientation)
  ) {
    throw new TypeError("Unknown problem orientation.");
  }
  if (!INPUT_SOURCES.includes(input.inputSource)) {
    throw new TypeError("Unknown performance input source.");
  }
  if (!inputSourceMatchesMode(input.inputMode, input.inputSource)) {
    throw new TypeError("The input source does not match the configured input mode.");
  }
  const correct = input.correct ?? input.submittedAnswer === input.expectedAnswer;
  if (correct !== (input.submittedAnswer === input.expectedAnswer)) {
    throw new RangeError("The correct flag must match the submitted answer.");
  }
  const slow = input.slow ?? input.elapsedMs > PERFORMANCE_SLOW_RESPONSE_MS;
  const sessionLane =
    input.sessionLane ?? (input.isReview ? "redemption" : "main");
  if (!SESSION_LANES.includes(sessionLane)) {
    throw new TypeError("Unknown performance session lane.");
  }
  const attemptOrdinal = input.attemptOrdinal ?? 1;
  if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 1) {
    throw new RangeError("attemptOrdinal must be a positive integer.");
  }
  const firstAttempt =
    input.firstAttempt ?? (sessionLane === "main" && attemptOrdinal === 1);
  if (
    firstAttempt !== (sessionLane === "main" && attemptOrdinal === 1)
  ) {
    throw new RangeError(
      "Only ordinal 1 in the main lane can be the scored first attempt.",
    );
  }
  const outcomeReason =
    input.outcomeReason === undefined
      ? inferredOutcomeReason(correct, slow)
      : input.outcomeReason;
  if (outcomeReason !== null && !OUTCOME_REASONS.includes(outcomeReason)) {
    throw new TypeError("Unknown performance outcome reason.");
  }
  const recognitionConfidence = input.recognitionConfidence ?? null;
  const recognitionMargin = input.recognitionMargin ?? null;
  const recognitionProcessingMs = input.recognitionProcessingMs ?? null;
  if (
    !isNullableUnitInterval(recognitionConfidence) ||
    !isNullableUnitInterval(recognitionMargin) ||
    !isNullableNonnegative(recognitionProcessingMs)
  ) {
    throw new RangeError("Recognition measurements are outside their valid range.");
  }
  const id = input.id?.trim() ||
    `${input.sessionId}:attempt:${input.sessionPosition}:${input.cardId}:${sessionLane}:${attemptOrdinal}`;
  return {
    id,
    sessionId: input.sessionId.trim(),
    occurredAt,
    ...performanceLocalTimestamp(occurredAt),
    sessionPosition: input.sessionPosition,
    gameType: input.gameType,
    level: input.level,
    presentationMode: input.presentationMode,
    inputMode: input.inputMode,
    orientation: input.orientation ?? null,
    inputSource: input.inputSource,
    cardId: input.cardId.trim(),
    factKey: input.factKey.trim(),
    minuend: input.minuend,
    subtrahend: input.subtrahend,
    expectedAnswer: input.expectedAnswer,
    submittedAnswer: input.submittedAnswer,
    correct,
    elapsedMs: input.elapsedMs,
    slow,
    attemptOrdinal,
    firstAttempt,
    sessionLane,
    isReview: input.isReview,
    reviewQueued: input.reviewQueued ?? outcomeReason !== null,
    reinserted: input.reinserted ?? false,
    outcomeReason,
    drawNumber: input.drawNumber,
    cycle: input.cycle,
    cardsRemainingAfter: input.cardsRemainingAfter,
    sessionElapsedMs: input.sessionElapsedMs,
    rawRecognition: input.rawRecognition ?? null,
    recognitionConfidence,
    recognitionMargin,
    recognitionProcessingMs,
  };
}

export function createPerformanceSession(
  input: CreatePerformanceSessionInput,
): PerformanceSessionStart {
  if (!isText(input.sessionId)) {
    throw new TypeError("A performance session needs a nonempty sessionId.");
  }
  if (!GAME_TYPES.includes(input.gameType)) {
    throw new TypeError("Unknown performance game type.");
  }
  if (!PRESENTATION_MODES.includes(input.presentationMode)) {
    throw new TypeError("Unknown presentation mode.");
  }
  if (!LEVELS.includes(input.level)) {
    throw new TypeError("Unknown subtraction level.");
  }
  if (!INPUT_MODES.includes(input.inputMode)) {
    throw new TypeError("Unknown configured input mode.");
  }
  assertNonnegativeInteger(input.baseDeckSize, "baseDeckSize");
  const occurredAt = input.startedAt ?? Date.now();
  const sessionId = input.sessionId.trim();
  return {
    id: `${sessionId}:start`,
    event: "start",
    sessionId,
    occurredAt,
    ...performanceLocalTimestamp(occurredAt),
    gameType: input.gameType,
    level: input.level,
    presentationMode: input.presentationMode,
    inputMode: input.inputMode,
    baseDeckSize: input.baseDeckSize,
  };
}

const ATTEMPT_KEYS = [
  "id", "sessionId", "occurredAt", "localDate", "localTime", "timeZone",
  "utcOffsetMinutes", "sessionPosition", "gameType", "level",
  "presentationMode", "inputMode", "orientation", "inputSource", "cardId", "factKey", "minuend",
  "subtrahend", "expectedAnswer", "submittedAnswer", "correct", "elapsedMs",
  "slow", "attemptOrdinal", "firstAttempt", "sessionLane", "isReview",
  "reviewQueued", "reinserted", "outcomeReason",
  "drawNumber", "cycle", "cardsRemainingAfter", "sessionElapsedMs",
  "rawRecognition", "recognitionConfidence", "recognitionMargin",
  "recognitionProcessingMs",
] as const;
const SESSION_START_KEYS = [
  "id", "event", "sessionId", "occurredAt", "localDate", "localTime",
  "timeZone", "utcOffsetMinutes", "gameType", "level", "presentationMode",
  "inputMode", "baseDeckSize",
] as const;
const SESSION_FINISH_KEYS = [
  "id", "event", "sessionId", "occurredAt", "localDate", "localTime",
  "timeZone", "utcOffsetMinutes", "finishReason", "elapsedMs", "answered",
  "correct", "slow", "reviews", "baseDeckSize",
] as const;
const V2_ATTEMPT_KEYS = ATTEMPT_KEYS.filter(
  (key) =>
    key !== "attemptOrdinal" &&
    key !== "firstAttempt" &&
    key !== "sessionLane",
);
const LEGACY_ATTEMPT_KEYS = V2_ATTEMPT_KEYS.filter(
  (key) => key !== "level" && key !== "inputMode",
);
const LEGACY_SESSION_START_KEYS = SESSION_START_KEYS.filter(
  (key) => key !== "level" && key !== "inputMode",
);

function isPerformanceAttempt(value: unknown): value is PerformanceAttempt {
  if (!isRecord(value) || !hasExactKeys(value, ATTEMPT_KEYS)) return false;
  return (
    isText(value.id) &&
    isText(value.sessionId) &&
    isValidEpoch(value.occurredAt) &&
    isLocalTimestamp(value) &&
    isNonnegativeInteger(value.sessionPosition) &&
    GAME_TYPES.includes(value.gameType as PerformanceGameType) &&
    LEVELS.includes(value.level as PerformanceLevel) &&
    PRESENTATION_MODES.includes(
      value.presentationMode as PerformancePresentationMode,
    ) &&
    INPUT_MODES.includes(value.inputMode as PerformanceInputMode) &&
    (value.orientation === null ||
      ORIENTATIONS.includes(value.orientation as PerformanceOrientation)) &&
    INPUT_SOURCES.includes(value.inputSource as PerformanceInputSource) &&
    inputSourceMatchesMode(
      value.inputMode as PerformanceInputMode,
      value.inputSource as PerformanceInputSource,
    ) &&
    isText(value.cardId) &&
    isText(value.factKey) &&
    isValidPerformanceFact(
      value.level as PerformanceLevel,
      value.minuend,
      value.subtrahend,
    ) &&
    Number.isSafeInteger(value.expectedAnswer) &&
    value.expectedAnswer ===
      (value.minuend as number) - (value.subtrahend as number) &&
    Number.isSafeInteger(value.submittedAnswer) &&
    typeof value.correct === "boolean" &&
    value.correct === (value.submittedAnswer === value.expectedAnswer) &&
    isFiniteNonnegative(value.elapsedMs) &&
    typeof value.slow === "boolean" &&
    isNonnegativeInteger(value.attemptOrdinal) &&
    (value.attemptOrdinal as number) >= 1 &&
    typeof value.firstAttempt === "boolean" &&
    SESSION_LANES.includes(value.sessionLane as PerformanceSessionLane) &&
    value.firstAttempt ===
      (value.sessionLane === "main" && value.attemptOrdinal === 1) &&
    typeof value.isReview === "boolean" &&
    typeof value.reviewQueued === "boolean" &&
    typeof value.reinserted === "boolean" &&
    (value.outcomeReason === null ||
      OUTCOME_REASONS.includes(value.outcomeReason as Exclude<PerformanceOutcomeReason, null>)) &&
    isNonnegativeInteger(value.drawNumber) &&
    isNonnegativeInteger(value.cycle) &&
    isNonnegativeInteger(value.cardsRemainingAfter) &&
    isFiniteNonnegative(value.sessionElapsedMs) &&
    (value.rawRecognition === null || typeof value.rawRecognition === "string") &&
    isNullableUnitInterval(value.recognitionConfidence) &&
    isNullableUnitInterval(value.recognitionMargin) &&
    isNullableNonnegative(value.recognitionProcessingMs)
  );
}

function isSessionStart(value: unknown): value is PerformanceSessionStart {
  if (!isRecord(value) || !hasExactKeys(value, SESSION_START_KEYS)) return false;
  return (
    value.event === "start" &&
    isText(value.id) &&
    isText(value.sessionId) &&
    value.id === `${value.sessionId}:start` &&
    isValidEpoch(value.occurredAt) &&
    isLocalTimestamp(value) &&
    GAME_TYPES.includes(value.gameType as PerformanceGameType) &&
    LEVELS.includes(value.level as PerformanceLevel) &&
    PRESENTATION_MODES.includes(
      value.presentationMode as PerformancePresentationMode,
    ) &&
    INPUT_MODES.includes(value.inputMode as PerformanceInputMode) &&
    isNonnegativeInteger(value.baseDeckSize)
  );
}

function isSessionFinish(value: unknown): value is PerformanceSessionFinish {
  if (!isRecord(value) || !hasExactKeys(value, SESSION_FINISH_KEYS)) return false;
  return (
    value.event === "finish" &&
    isText(value.id) &&
    isText(value.sessionId) &&
    value.id === `${value.sessionId}:finish` &&
    isValidEpoch(value.occurredAt) &&
    isLocalTimestamp(value) &&
    FINISH_REASONS.includes(value.finishReason as PerformanceSessionFinishReason) &&
    isFiniteNonnegative(value.elapsedMs) &&
    isNonnegativeInteger(value.answered) &&
    isNonnegativeInteger(value.correct) &&
    (value.correct as number) <= (value.answered as number) &&
    isNonnegativeInteger(value.slow) &&
    (value.slow as number) <= (value.answered as number) &&
    isNonnegativeInteger(value.reviews) &&
    (value.reviews as number) <= (value.answered as number) &&
    isNonnegativeInteger(value.baseDeckSize)
  );
}

function legacyInputMode(inputSource: unknown): PerformanceInputMode {
  switch (inputSource) {
    case "handwriting":
      return "draw";
    case "trace":
      return "trace";
    case "speech":
      return "speak";
    default:
      return "tap";
  }
}

function legacyAttemptProgress(value: Record<string, unknown>): Readonly<{
  attemptOrdinal: 1;
  firstAttempt: boolean;
  sessionLane: PerformanceSessionLane;
}> {
  const sessionLane: PerformanceSessionLane = value.isReview
    ? "redemption"
    : "main";
  return {
    attemptOrdinal: 1,
    firstAttempt: sessionLane === "main",
    sessionLane,
  };
}

function migrateV2Attempt(value: unknown): PerformanceAttempt | null {
  if (!isRecord(value) || !hasExactKeys(value, V2_ATTEMPT_KEYS)) {
    return null;
  }
  const migrated = {
    ...value,
    ...legacyAttemptProgress(value),
  };
  return isPerformanceAttempt(migrated) ? migrated : null;
}

function migrateLegacyAttempt(value: unknown): PerformanceAttempt | null {
  if (!isRecord(value) || !hasExactKeys(value, LEGACY_ATTEMPT_KEYS)) {
    return null;
  }
  const migrated = {
    ...value,
    level: "B100",
    inputMode: legacyInputMode(value.inputSource),
    ...legacyAttemptProgress(value),
  };
  return isPerformanceAttempt(migrated) ? migrated : null;
}

function migrateV2PerformanceLog(value: unknown): PerformanceLog | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "attempts", "sessionEvents"]) ||
    value.schemaVersion !== PERFORMANCE_SCHEMA_VERSION ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.sessionEvents)
  ) {
    return null;
  }
  const attempts = value.attempts.map((attempt) =>
    isPerformanceAttempt(attempt) ? attempt : migrateV2Attempt(attempt),
  );
  if (attempts.some((attempt) => attempt === null)) return null;
  const migrated: PerformanceLog = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    attempts: attempts as PerformanceAttempt[],
    sessionEvents: value.sessionEvents as PerformanceSessionEvent[],
  };
  return isPerformanceLog(migrated) ? migrated : null;
}

function migrateLegacySessionStart(
  value: unknown,
  attempts: readonly PerformanceAttempt[],
): PerformanceSessionStart | null {
  if (!isRecord(value) || !hasExactKeys(value, LEGACY_SESSION_START_KEYS)) {
    return null;
  }
  const sessionAttempt = attempts.find(
    (attempt) => attempt.sessionId === value.sessionId,
  );
  const migrated = {
    ...value,
    level: "B100",
    inputMode: sessionAttempt?.inputMode ?? "tap",
  };
  return isSessionStart(migrated) ? migrated : null;
}

function migrateLegacyPerformanceLog(value: unknown): PerformanceLog | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "attempts", "sessionEvents"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.sessionEvents)
  ) {
    return null;
  }
  const attempts = value.attempts.map(migrateLegacyAttempt);
  if (attempts.some((attempt) => attempt === null)) return null;
  const migratedAttempts = attempts as PerformanceAttempt[];
  const sessionEvents = value.sessionEvents.map((event) => {
    if (isSessionFinish(event)) return event;
    return migrateLegacySessionStart(event, migratedAttempts);
  });
  if (sessionEvents.some((event) => event === null)) return null;
  const migrated: PerformanceLog = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    attempts: migratedAttempts,
    sessionEvents: sessionEvents as PerformanceSessionEvent[],
  };
  return isPerformanceLog(migrated) ? migrated : null;
}

function isPerformanceLog(value: unknown): value is PerformanceLog {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "attempts", "sessionEvents"]) ||
    value.schemaVersion !== PERFORMANCE_SCHEMA_VERSION ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.sessionEvents) ||
    !value.attempts.every(isPerformanceAttempt) ||
    !value.sessionEvents.every(
      (event) => isSessionStart(event) || isSessionFinish(event),
    )
  ) {
    return false;
  }
  const attemptIds = new Set(value.attempts.map((attempt) => attempt.id));
  const sessionEventIds = new Set(value.sessionEvents.map((event) => event.id));
  return (
    attemptIds.size === value.attempts.length &&
    sessionEventIds.size === value.sessionEvents.length
  );
}

function defaultStorage(): PerformanceStorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadPerformanceLogDiagnostic(
  storage: PerformanceStorageLike | null = defaultStorage(),
): PerformanceLoadDiagnostic {
  if (!storage) {
    return {
      status: "unavailable",
      log: null,
      canWrite: false,
      message: "Local storage is unavailable.",
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(PERFORMANCE_STORAGE_KEY);
    if (raw === null) {
      raw = storage.getItem(PERFORMANCE_LEGACY_STORAGE_KEY);
    }
  } catch {
    return {
      status: "unavailable",
      log: null,
      canWrite: false,
      message: "Local storage could not be read.",
    };
  }
  if (raw === null) {
    return { status: "empty", log: EMPTY_LOG, canWrite: true, message: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "corrupt",
      log: null,
      canWrite: false,
      message: "Saved performance data is not valid JSON and was left untouched.",
    };
  }
  if (
    isRecord(parsed) &&
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > PERFORMANCE_SCHEMA_VERSION
  ) {
    return {
      status: "unsupported",
      log: null,
      canWrite: false,
      message: "Saved performance data uses a newer schema and was left untouched.",
    };
  }
  const migrated = migrateLegacyPerformanceLog(parsed);
  if (migrated) {
    return { status: "loaded", log: migrated, canWrite: true, message: null };
  }
  const migratedV2 = migrateV2PerformanceLog(parsed);
  if (!migratedV2) {
    return {
      status: "corrupt",
      log: null,
      canWrite: false,
      message: "Saved performance data failed validation and was left untouched.",
    };
  }
  return { status: "loaded", log: migratedV2, canWrite: true, message: null };
}

function blockedWrite(status: PerformanceLoadStatus): PerformanceWriteResult {
  if (status === "unsupported" || status === "corrupt" || status === "unavailable") {
    return { ok: false, status };
  }
  return { ok: false, status: "write-failed" };
}

function persistLog(
  storage: PerformanceStorageLike | null,
  log: PerformanceLog,
): PerformanceWriteResult {
  if (!storage) return { ok: false, status: "unavailable" };
  try {
    storage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(log));
    return { ok: true, status: "written" };
  } catch {
    return { ok: false, status: "write-failed" };
  }
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function appendPerformanceAttempt(
  attempt: PerformanceAttempt,
  storage: PerformanceStorageLike | null = defaultStorage(),
): PerformanceWriteResult {
  if (!isPerformanceAttempt(attempt)) {
    throw new TypeError("Refusing to store an invalid performance attempt.");
  }
  const diagnostic = loadPerformanceLogDiagnostic(storage);
  if (!diagnostic.log) return blockedWrite(diagnostic.status);
  const sessionStart = diagnostic.log.sessionEvents.find(
    (event): event is PerformanceSessionStart =>
      event.event === "start" && event.sessionId === attempt.sessionId,
  );
  if (
    sessionStart &&
    (sessionStart.level !== attempt.level ||
      sessionStart.inputMode !== attempt.inputMode)
  ) {
    return { ok: false, status: "conflict" };
  }
  const existing = diagnostic.log.attempts.find((row) => row.id === attempt.id);
  if (existing) {
    return {
      ok: sameRecord(existing, attempt),
      status: sameRecord(existing, attempt) ? "duplicate" : "conflict",
    };
  }
  return persistLog(storage, {
    ...diagnostic.log,
    attempts: [...diagnostic.log.attempts, attempt],
  });
}

export function startPerformanceSession(
  session: PerformanceSessionStart,
  storage: PerformanceStorageLike | null = defaultStorage(),
): PerformanceWriteResult {
  if (!isSessionStart(session)) {
    throw new TypeError("Refusing to store an invalid performance session.");
  }
  const diagnostic = loadPerformanceLogDiagnostic(storage);
  if (!diagnostic.log) return blockedWrite(diagnostic.status);
  const existing = diagnostic.log.sessionEvents.find(
    (event) => event.id === session.id,
  );
  if (existing) {
    return {
      ok: sameRecord(existing, session),
      status: sameRecord(existing, session) ? "duplicate" : "conflict",
    };
  }
  return persistLog(storage, {
    ...diagnostic.log,
    sessionEvents: [...diagnostic.log.sessionEvents, session],
  });
}

export function finishPerformanceSession(
  sessionId: string,
  input: FinishPerformanceSessionInput,
  storage: PerformanceStorageLike | null = defaultStorage(),
): PerformanceWriteResult {
  if (!isText(sessionId)) {
    throw new TypeError("A performance session needs a nonempty sessionId.");
  }
  assertFiniteNonnegative(input.elapsedMs, "elapsedMs");
  assertNonnegativeInteger(input.answered, "answered");
  assertNonnegativeInteger(input.correct, "correct");
  assertNonnegativeInteger(input.slow, "slow");
  assertNonnegativeInteger(input.reviews, "reviews");
  assertNonnegativeInteger(input.baseDeckSize, "baseDeckSize");
  if (
    input.correct > input.answered ||
    input.slow > input.answered ||
    input.reviews > input.answered
  ) {
    throw new RangeError("Session totals cannot exceed answered questions.");
  }
  if (!FINISH_REASONS.includes(input.finishReason)) {
    throw new TypeError("Unknown performance session finish reason.");
  }
  const diagnostic = loadPerformanceLogDiagnostic(storage);
  if (!diagnostic.log) return blockedWrite(diagnostic.status);
  const normalizedSessionId = sessionId.trim();
  if (
    !diagnostic.log.sessionEvents.some(
      (event) => event.event === "start" && event.sessionId === normalizedSessionId,
    )
  ) {
    return { ok: false, status: "missing-session" };
  }
  const occurredAt = input.finishedAt ?? Date.now();
  const finish: PerformanceSessionFinish = {
    id: `${normalizedSessionId}:finish`,
    event: "finish",
    sessionId: normalizedSessionId,
    occurredAt,
    ...performanceLocalTimestamp(occurredAt),
    finishReason: input.finishReason,
    elapsedMs: input.elapsedMs,
    answered: input.answered,
    correct: input.correct,
    slow: input.slow,
    reviews: input.reviews,
    baseDeckSize: input.baseDeckSize,
  };
  const existing = diagnostic.log.sessionEvents.find(
    (event) => event.id === finish.id,
  );
  if (existing) {
    return {
      ok: sameRecord(existing, finish),
      status: sameRecord(existing, finish) ? "duplicate" : "conflict",
    };
  }
  return persistLog(storage, {
    ...diagnostic.log,
    sessionEvents: [...diagnostic.log.sessionEvents, finish],
  });
}

const CSV_COLUMNS = [
  "date", "time", "time_zone", "utc_offset_minutes", "timestamp_ms",
  "session_id", "session_position", "game_type", "level", "presentation_mode",
  "input_mode", "orientation", "input_source", "minuend", "subtrahend", "expected_answer",
  "submitted_answer", "result", "correct", "time_taken_ms", "slow",
  "attempt_ordinal", "first_attempt", "session_lane", "is_review",
  "review_queued", "reinserted", "outcome_reason", "draw_number",
  "cycle", "cards_remaining_after", "session_elapsed_ms", "card_id", "fact_key",
  "raw_recognition", "recognition_confidence", "recognition_margin",
  "recognition_processing_ms", "attempt_id",
] as const;

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function performanceAttemptsToCsv(
  attempts?: readonly PerformanceAttempt[],
  storage: PerformanceStorageLike | null = defaultStorage(),
): string {
  const rows = attempts ?? loadPerformanceLogDiagnostic(storage).log?.attempts ?? [];
  const lines = rows.map((attempt) =>
    [
      attempt.localDate,
      attempt.localTime,
      attempt.timeZone,
      attempt.utcOffsetMinutes,
      attempt.occurredAt,
      attempt.sessionId,
      attempt.sessionPosition,
      attempt.gameType,
      attempt.level,
      attempt.presentationMode,
      attempt.inputMode,
      attempt.orientation,
      attempt.inputSource,
      attempt.minuend,
      attempt.subtrahend,
      attempt.expectedAnswer,
      attempt.submittedAnswer,
      attempt.correct ? "correct" : "wrong",
      attempt.correct,
      attempt.elapsedMs,
      attempt.slow,
      attempt.attemptOrdinal,
      attempt.firstAttempt,
      attempt.sessionLane,
      attempt.isReview,
      attempt.reviewQueued,
      attempt.reinserted,
      attempt.outcomeReason,
      attempt.drawNumber,
      attempt.cycle,
      attempt.cardsRemainingAfter,
      attempt.sessionElapsedMs,
      attempt.cardId,
      attempt.factKey,
      attempt.rawRecognition,
      attempt.recognitionConfidence,
      attempt.recognitionMargin,
      attempt.recognitionProcessingMs,
      attempt.id,
    ].map(csvCell).join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\r\n");
}
