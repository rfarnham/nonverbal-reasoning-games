import type { AttemptEvent } from "./adaptive/types.ts";
import {
  PERFORMANCE_SLOW_RESPONSE_MS,
  performanceLocalTimestamp,
  type PerformanceAttempt,
  type PerformanceGameType,
  type PerformanceInputSource,
  type PerformanceOrientation,
  type PerformanceOutcomeReason,
  type PerformancePresentationMode,
} from "./performance-storage.ts";

export type AnalyticsAttemptSource = "flash" | "adaptive";
export type AnalyticsGameType = PerformanceGameType | "adaptive";

export type NormalizedPerformanceAttempt = Readonly<{
  id: string;
  source: AnalyticsAttemptSource;
  sessionId: string;
  timestamp: number;
  localDate: string;
  localTime: string;
  timeZone: string;
  utcOffsetMinutes: number;
  gameType: AnalyticsGameType;
  presentationMode: PerformancePresentationMode;
  orientation: PerformanceOrientation | null;
  inputSource: PerformanceInputSource;
  minuend: number | null;
  subtrahend: number | null;
  expectedAnswer: number | null;
  submittedAnswer: number | null;
  correct: boolean;
  latencyMs: number | null;
  timingEligible: boolean;
  slow: boolean;
  isReview: boolean;
  cardId: string | null;
  factKey: string | null;
  drawNumber: number | null;
  cycle: number | null;
  cardsRemainingAfter: number | null;
  sessionPosition: number;
  sessionElapsedMs: number | null;
  outcomeReason: PerformanceOutcomeReason;
  reviewQueued: boolean | null;
  reinserted: boolean | null;
  rawRecognition: string | null;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionProcessingMs: number | null;
}>;

export type PerformanceAttemptFilters = Readonly<{
  dateFrom?: string | null;
  dateTo?: string | null;
  fromTimestamp?: number | null;
  toTimestamp?: number | null;
  gameTypes?: readonly AnalyticsGameType[];
  presentationModes?: readonly PerformancePresentationMode[];
  inputSources?: readonly PerformanceInputSource[];
  minuends?: readonly number[];
  subtrahends?: readonly number[];
}>;

export const PERFORMANCE_LATENCY_BINS = [
  { id: "0-1", label: "0–1 s", minMs: 0, maxMsExclusive: 1_000 },
  { id: "1-2", label: "1–2 s", minMs: 1_000, maxMsExclusive: 2_000 },
  { id: "2-3", label: "2–3 s", minMs: 2_000, maxMsExclusive: 3_000 },
  { id: "3-4", label: "3–4 s", minMs: 3_000, maxMsExclusive: 4_000 },
  { id: "4-5", label: "4–5 s", minMs: 4_000, maxMsExclusive: 5_000 },
  { id: "5-6", label: "5–6 s", minMs: 5_000, maxMsExclusive: 6_000 },
  { id: "6-8", label: "6–8 s", minMs: 6_000, maxMsExclusive: 8_000 },
  { id: "8-12", label: "8–12 s", minMs: 8_000, maxMsExclusive: 12_000 },
  { id: "12+", label: "12+ s", minMs: 12_000, maxMsExclusive: null },
] as const;

export const WRONG_INFINITY_BIN = Object.freeze({
  id: "wrong-infinity",
  label: "Wrong · ∞",
});
export const MAX_SCRUB_FRAMES = 20;

export type LatencyBinResult = Readonly<{
  id: (typeof PERFORMANCE_LATENCY_BINS)[number]["id"];
  label: string;
  minMs: number;
  maxMsExclusive: number | null;
  count: number;
  share: number;
}>;

export type LatencyDistribution = Readonly<{
  totalCount: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number | null;
  timedCorrectCount: number;
  bins: readonly LatencyBinResult[];
  infinity: Readonly<{
    id: typeof WRONG_INFINITY_BIN.id;
    label: typeof WRONG_INFINITY_BIN.label;
    count: number;
    share: number;
  }>;
  correctMeanMs: number | null;
  correctMedianMs: number | null;
  correctP90Ms: number | null;
}>;

export type RollingPerformanceFrame = Readonly<{
  index: number;
  timestamp: number;
  localDate: string;
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  attemptCount: number;
  distribution: LatencyDistribution;
}>;

export type RollingPerformanceFrameOptions = Readonly<{
  maxFrames?: number;
  windowMs?: number;
  windowAttemptCount?: number;
}>;

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function integerOperand(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function numericAnswer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validEpochMilliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Math.max(0, Math.round(value));
  return Number.isSafeInteger(rounded) &&
    !Number.isNaN(new Date(rounded).getTime())
    ? rounded
    : 0;
}

function adaptiveInputSource(attempt: AttemptEvent): PerformanceInputSource {
  return attempt.firstInkAt !== null ||
    attempt.rawRecognizedValue !== null ||
    attempt.recognitionConfidence !== null
    ? "handwriting"
    : "tap";
}

function outcomeReason(
  correct: boolean,
  slow: boolean,
): PerformanceOutcomeReason {
  if (!correct && slow) return "both";
  if (!correct) return "incorrect";
  if (slow) return "slow";
  return null;
}

function normalizeCoreAttempt(
  attempt: PerformanceAttempt,
): NormalizedPerformanceAttempt {
  return {
    id: `flash:${attempt.id}`,
    source: "flash",
    sessionId: attempt.sessionId,
    timestamp: attempt.occurredAt,
    localDate: attempt.localDate,
    localTime: attempt.localTime,
    timeZone: attempt.timeZone,
    utcOffsetMinutes: attempt.utcOffsetMinutes,
    gameType: attempt.gameType,
    presentationMode: attempt.presentationMode,
    orientation: attempt.orientation,
    inputSource: attempt.inputSource,
    minuend: attempt.minuend,
    subtrahend: attempt.subtrahend,
    expectedAnswer: attempt.expectedAnswer,
    submittedAnswer: attempt.submittedAnswer,
    correct: attempt.correct,
    latencyMs: attempt.elapsedMs,
    timingEligible: true,
    slow: attempt.slow,
    isReview: attempt.isReview,
    cardId: attempt.cardId,
    factKey: attempt.factKey,
    drawNumber: attempt.drawNumber,
    cycle: attempt.cycle,
    cardsRemainingAfter: attempt.cardsRemainingAfter,
    sessionPosition: attempt.sessionPosition,
    sessionElapsedMs: attempt.sessionElapsedMs,
    outcomeReason: attempt.outcomeReason,
    reviewQueued: attempt.reviewQueued,
    reinserted: attempt.reinserted,
    rawRecognition: attempt.rawRecognition,
    recognitionConfidence: attempt.recognitionConfidence,
    recognitionMargin: attempt.recognitionMargin,
    recognitionProcessingMs: attempt.recognitionProcessingMs,
  };
}

function normalizeAdaptiveAttempt(
  attempt: AttemptEvent,
): NormalizedPerformanceAttempt {
  const timestamp = validEpochMilliseconds(attempt.submittedAt);
  const latencyMs = finiteNonnegative(attempt.responseMs);
  const slow = latencyMs !== null && latencyMs > PERFORMANCE_SLOW_RESPONSE_MS;
  const localTimestamp = performanceLocalTimestamp(timestamp);
  return {
    id: `adaptive:${attempt.id}`,
    source: "adaptive",
    sessionId: attempt.sessionId,
    timestamp,
    localDate: localTimestamp.localDate,
    localTime: localTimestamp.localTime,
    timeZone: localTimestamp.timeZone,
    utcOffsetMinutes: localTimestamp.utcOffsetMinutes,
    gameType: "adaptive",
    presentationMode: "visual",
    orientation: attempt.format,
    inputSource: adaptiveInputSource(attempt),
    minuend: integerOperand(attempt.operands.minuend),
    subtrahend: integerOperand(attempt.operands.subtrahend),
    expectedAnswer: numericAnswer(attempt.expectedAnswer),
    submittedAnswer: numericAnswer(attempt.normalizedRecognizedValue),
    correct: attempt.firstAttemptCorrect,
    latencyMs,
    timingEligible: attempt.timingEligible,
    slow,
    isReview:
      attempt.sessionLane === "review" ||
      attempt.relatedProblemRelation === "delayed_retry",
    cardId: attempt.problemId,
    factKey: attempt.problemFingerprint,
    drawNumber: null,
    cycle: null,
    cardsRemainingAfter: null,
    sessionPosition: attempt.sessionPosition,
    sessionElapsedMs: null,
    outcomeReason: outcomeReason(attempt.firstAttemptCorrect, slow),
    reviewQueued: null,
    reinserted: null,
    rawRecognition: attempt.rawRecognizedValue,
    recognitionConfidence: attempt.recognitionConfidence,
    recognitionMargin: attempt.recognitionMargin,
    recognitionProcessingMs: null,
  };
}

export function normalizePerformanceAttempts(
  coreAttempts: readonly PerformanceAttempt[] = [],
  adaptiveAttempts: readonly AttemptEvent[] = [],
): NormalizedPerformanceAttempt[] {
  return [
    ...coreAttempts.map(normalizeCoreAttempt),
    ...adaptiveAttempts.map(normalizeAdaptiveAttempt),
  ].sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

function matchesSelection<T>(value: T, selections?: readonly T[]): boolean {
  return !selections || selections.length === 0 || selections.includes(value);
}

export function filterPerformanceAttempts(
  attempts: readonly NormalizedPerformanceAttempt[],
  filters: PerformanceAttemptFilters = {},
): NormalizedPerformanceAttempt[] {
  return attempts.filter((attempt) => {
    if (filters.dateFrom && attempt.localDate < filters.dateFrom) return false;
    if (filters.dateTo && attempt.localDate > filters.dateTo) return false;
    if (
      filters.fromTimestamp !== undefined &&
      filters.fromTimestamp !== null &&
      attempt.timestamp < filters.fromTimestamp
    ) {
      return false;
    }
    if (
      filters.toTimestamp !== undefined &&
      filters.toTimestamp !== null &&
      attempt.timestamp > filters.toTimestamp
    ) {
      return false;
    }
    return (
      matchesSelection(attempt.gameType, filters.gameTypes) &&
      matchesSelection(attempt.presentationMode, filters.presentationModes) &&
      matchesSelection(attempt.inputSource, filters.inputSources) &&
      (attempt.minuend === null
        ? !filters.minuends || filters.minuends.length === 0
        : matchesSelection(attempt.minuend, filters.minuends)) &&
      (attempt.subtrahend === null
        ? !filters.subtrahends || filters.subtrahends.length === 0
        : matchesSelection(attempt.subtrahend, filters.subtrahends))
    );
  });
}

function quantile(sortedValues: readonly number[], probability: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function buildLatencyDistribution(
  attempts: readonly NormalizedPerformanceAttempt[],
): LatencyDistribution {
  const correct = attempts.filter((attempt) => attempt.correct);
  const timedCorrectLatencies = correct
    .map((attempt) => finiteNonnegative(attempt.latencyMs))
    .filter((latency): latency is number => latency !== null)
    .sort((left, right) => left - right);
  const bins = PERFORMANCE_LATENCY_BINS.map((bin) => {
    const count = timedCorrectLatencies.filter(
      (latency) =>
        latency >= bin.minMs &&
        (bin.maxMsExclusive === null || latency < bin.maxMsExclusive),
    ).length;
    return {
      ...bin,
      count,
      share: attempts.length === 0 ? 0 : count / attempts.length,
    };
  });
  const wrongCount = attempts.length - correct.length;
  const mean = timedCorrectLatencies.length === 0
    ? null
    : timedCorrectLatencies.reduce((sum, latency) => sum + latency, 0) /
      timedCorrectLatencies.length;
  return {
    totalCount: attempts.length,
    correctCount: correct.length,
    wrongCount,
    accuracy: attempts.length === 0 ? null : correct.length / attempts.length,
    timedCorrectCount: timedCorrectLatencies.length,
    bins,
    infinity: {
      ...WRONG_INFINITY_BIN,
      count: wrongCount,
      share: attempts.length === 0 ? 0 : wrongCount / attempts.length,
    },
    correctMeanMs: mean,
    correctMedianMs: quantile(timedCorrectLatencies, 0.5),
    correctP90Ms: quantile(timedCorrectLatencies, 0.9),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

export function buildRollingPerformanceFrames(
  attempts: readonly NormalizedPerformanceAttempt[],
  options: RollingPerformanceFrameOptions = {},
): RollingPerformanceFrame[] {
  if (attempts.length === 0) return [];
  const sorted = [...attempts].sort(
    (left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const requestedFrames = positiveInteger(options.maxFrames, MAX_SCRUB_FRAMES);
  const frameCount = Math.min(MAX_SCRUB_FRAMES, requestedFrames, sorted.length);
  const defaultWindowCount = Math.max(1, Math.ceil(sorted.length / 5));
  const windowCount = positiveInteger(options.windowAttemptCount, defaultWindowCount);
  const explicitWindowMs =
    options.windowMs !== undefined &&
    Number.isFinite(options.windowMs) &&
    options.windowMs >= 0
      ? options.windowMs
      : null;
  const anchorIndexes = Array.from({ length: frameCount }, (_, index) =>
    frameCount === 1
      ? sorted.length - 1
      : Math.round((index * (sorted.length - 1)) / (frameCount - 1)),
  ).filter((value, index, values) => index === 0 || value !== values[index - 1]);

  return anchorIndexes.map((anchorIndex, index) => {
    const anchor = sorted[anchorIndex];
    let windowAttempts: NormalizedPerformanceAttempt[];
    if (explicitWindowMs !== null) {
      const start = anchor.timestamp - explicitWindowMs;
      windowAttempts = sorted.filter(
        (attempt) => attempt.timestamp >= start && attempt.timestamp <= anchor.timestamp,
      );
    } else {
      windowAttempts = sorted.slice(
        Math.max(0, anchorIndex - windowCount + 1),
        anchorIndex + 1,
      );
    }
    return {
      index,
      timestamp: anchor.timestamp,
      localDate: anchor.localDate,
      windowStartTimestamp: windowAttempts[0]?.timestamp ?? anchor.timestamp,
      windowEndTimestamp: anchor.timestamp,
      attemptCount: windowAttempts.length,
      distribution: buildLatencyDistribution(windowAttempts),
    };
  });
}
