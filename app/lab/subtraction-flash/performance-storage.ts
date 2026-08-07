export const PERFORMANCE_STORAGE_KEY =
  "spatial-gym:subtraction-flash:performance:v1";
export const PERFORMANCE_SCHEMA_VERSION = 1 as const;
export const PERFORMANCE_SLOW_RESPONSE_MS = 4_000;

export type PerformanceGameType =
  | "infinite"
  | "two-minute"
  | "deck-sprint";
export type PerformancePresentationMode = "visual" | "listen";
export type PerformanceOrientation = "horizontal" | "vertical";
export type PerformanceInputSource =
  | "tap"
  | "keyboard"
  | "handwriting"
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
    presentationMode: PerformancePresentationMode;
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
  presentationMode: PerformancePresentationMode;
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
    presentationMode: PerformancePresentationMode;
    baseDeckSize: number;
  }
>;

export type CreatePerformanceSessionInput = Readonly<{
  sessionId: string;
  gameType: PerformanceGameType;
  presentationMode: PerformancePresentationMode;
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
const ORIENTATIONS: readonly PerformanceOrientation[] = [
  "horizontal",
  "vertical",
];
const INPUT_SOURCES: readonly PerformanceInputSource[] = [
  "tap",
  "keyboard",
  "handwriting",
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
  if (
    !Number.isSafeInteger(input.minuend) ||
    input.minuend < 11 ||
    input.minuend > 18 ||
    !Number.isSafeInteger(input.subtrahend) ||
    input.subtrahend < 2 ||
    input.subtrahend > 9 ||
    input.minuend % 10 >= input.subtrahend
  ) {
    throw new RangeError("Performance attempts must contain a borrowing fact from this game.");
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
  const correct = input.correct ?? input.submittedAnswer === input.expectedAnswer;
  if (correct !== (input.submittedAnswer === input.expectedAnswer)) {
    throw new RangeError("The correct flag must match the submitted answer.");
  }
  const slow = input.slow ?? input.elapsedMs > PERFORMANCE_SLOW_RESPONSE_MS;
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
    `${input.sessionId}:attempt:${input.sessionPosition}:${input.cardId}`;
  return {
    id,
    sessionId: input.sessionId.trim(),
    occurredAt,
    ...performanceLocalTimestamp(occurredAt),
    sessionPosition: input.sessionPosition,
    gameType: input.gameType,
    presentationMode: input.presentationMode,
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
    presentationMode: input.presentationMode,
    baseDeckSize: input.baseDeckSize,
  };
}

const ATTEMPT_KEYS = [
  "id", "sessionId", "occurredAt", "localDate", "localTime", "timeZone",
  "utcOffsetMinutes", "sessionPosition", "gameType", "presentationMode",
  "orientation", "inputSource", "cardId", "factKey", "minuend",
  "subtrahend", "expectedAnswer", "submittedAnswer", "correct", "elapsedMs",
  "slow", "isReview", "reviewQueued", "reinserted", "outcomeReason",
  "drawNumber", "cycle", "cardsRemainingAfter", "sessionElapsedMs",
  "rawRecognition", "recognitionConfidence", "recognitionMargin",
  "recognitionProcessingMs",
] as const;
const SESSION_START_KEYS = [
  "id", "event", "sessionId", "occurredAt", "localDate", "localTime",
  "timeZone", "utcOffsetMinutes", "gameType", "presentationMode",
  "baseDeckSize",
] as const;
const SESSION_FINISH_KEYS = [
  "id", "event", "sessionId", "occurredAt", "localDate", "localTime",
  "timeZone", "utcOffsetMinutes", "finishReason", "elapsedMs", "answered",
  "correct", "slow", "reviews", "baseDeckSize",
] as const;

function isPerformanceAttempt(value: unknown): value is PerformanceAttempt {
  if (!isRecord(value) || !hasExactKeys(value, ATTEMPT_KEYS)) return false;
  return (
    isText(value.id) &&
    isText(value.sessionId) &&
    isValidEpoch(value.occurredAt) &&
    isLocalTimestamp(value) &&
    isNonnegativeInteger(value.sessionPosition) &&
    GAME_TYPES.includes(value.gameType as PerformanceGameType) &&
    PRESENTATION_MODES.includes(
      value.presentationMode as PerformancePresentationMode,
    ) &&
    (value.orientation === null ||
      ORIENTATIONS.includes(value.orientation as PerformanceOrientation)) &&
    INPUT_SOURCES.includes(value.inputSource as PerformanceInputSource) &&
    isText(value.cardId) &&
    isText(value.factKey) &&
    Number.isSafeInteger(value.minuend) &&
    (value.minuend as number) >= 11 &&
    (value.minuend as number) <= 18 &&
    Number.isSafeInteger(value.subtrahend) &&
    (value.subtrahend as number) >= 2 &&
    (value.subtrahend as number) <= 9 &&
    (value.minuend as number) % 10 < (value.subtrahend as number) &&
    Number.isSafeInteger(value.expectedAnswer) &&
    value.expectedAnswer ===
      (value.minuend as number) - (value.subtrahend as number) &&
    Number.isSafeInteger(value.submittedAnswer) &&
    typeof value.correct === "boolean" &&
    value.correct === (value.submittedAnswer === value.expectedAnswer) &&
    isFiniteNonnegative(value.elapsedMs) &&
    typeof value.slow === "boolean" &&
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
    PRESENTATION_MODES.includes(
      value.presentationMode as PerformancePresentationMode,
    ) &&
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
  if (!isPerformanceLog(parsed)) {
    return {
      status: "corrupt",
      log: null,
      canWrite: false,
      message: "Saved performance data failed validation and was left untouched.",
    };
  }
  return { status: "loaded", log: parsed, canWrite: true, message: null };
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
  "session_id", "session_position", "game_type", "presentation_mode",
  "orientation", "input_source", "minuend", "subtrahend", "expected_answer",
  "submitted_answer", "result", "correct", "time_taken_ms", "slow",
  "is_review", "review_queued", "reinserted", "outcome_reason", "draw_number",
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
      attempt.presentationMode,
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
