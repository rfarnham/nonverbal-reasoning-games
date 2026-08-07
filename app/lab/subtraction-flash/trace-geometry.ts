/** A point in one answer cell, normalized from 0 (top/left) to 1 (bottom/right). */
export interface TracePoint {
  readonly x: number;
  readonly y: number;
}

export type TraceDigit = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type TraceDirection = "forward" | "reverse";

export type TraceRejectionReason =
  | "invalid_points"
  | "tap"
  | "too_small"
  | "incomplete"
  | "too_long"
  | "off_path";

export interface TraceQualityOptions {
  /** Common arc-length samples used for order and coverage comparisons. */
  readonly sampleCount: number;
  readonly minimumPointCount: number;
  readonly minimumPathLength: number;
  readonly minimumSpanRatio: number;
  readonly maximumSpanRatio: number;
  readonly minimumLengthRatio: number;
  readonly maximumLengthRatio: number;
  readonly maximumRawLengthRatio: number;
  readonly maximumCenterError: number;
  readonly maximumOrderedRmsError: number;
  readonly maximumMeanPathError: number;
  readonly maximumCoverageError: number;
  readonly maximumPathError90: number;
  readonly maximumEndpointError: number;
}

export interface TraceBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** Detailed, answer-neutral geometry evidence suitable for UI feedback or telemetry. */
export interface DigitTraceScore {
  readonly accepted: boolean;
  readonly rejectionReason: TraceRejectionReason | null;
  readonly direction: TraceDirection;
  readonly inputPointCount: number;
  readonly distinctPointCount: number;
  readonly pathLength: number;
  readonly rawPathLength: number;
  readonly referencePathLength: number;
  readonly lengthRatio: number;
  readonly rawLengthRatio: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly centerError: number;
  readonly orderedRmsError: number;
  readonly meanPathError: number;
  readonly coverageError: number;
  readonly pathError90: number;
  readonly endpointError: number;
}

export interface DigitTraceAttemptDecision {
  readonly disposition: "submit" | "retry" | "reject";
  readonly nextRetryDigit: TraceDigit | null;
}

export const DEFAULT_TRACE_QUALITY_OPTIONS: Readonly<TraceQualityOptions> =
  Object.freeze({
    sampleCount: 64,
    minimumPointCount: 4,
    minimumPathLength: 0.42,
    minimumSpanRatio: 0.58,
    maximumSpanRatio: 1.5,
    minimumLengthRatio: 0.7,
    maximumLengthRatio: 2.1,
    maximumRawLengthRatio: 3.2,
    maximumCenterError: 0.18,
    maximumOrderedRmsError: 0.18,
    maximumMeanPathError: 0.12,
    maximumCoverageError: 0.135,
    maximumPathError90: 0.22,
    maximumEndpointError: 0.25,
  });

/**
 * A substantial attempt that was recognizable enough to express a choice,
 * even though it missed the normal quality gate. This deliberately excludes
 * taps, tiny marks, and runaway scribbles so retry grace cannot become a
 * hidden double-tap input mode.
 */
export function isGoodFaithDigitTraceAttempt(
  score: DigitTraceScore,
): boolean {
  if (
    score.accepted ||
    (score.rejectionReason !== "too_small" &&
      score.rejectionReason !== "incomplete" &&
      score.rejectionReason !== "off_path")
  ) {
    return false;
  }

  return (
    score.distinctPointCount >= 8 &&
    score.rawLengthRatio >= 0.65 &&
    score.rawLengthRatio <= 2.25 &&
    score.widthRatio >= 0.48 &&
    score.heightRatio >= 0.48 &&
    score.centerError <= 0.25 &&
    score.coverageError <= 0.2 &&
    score.pathError90 <= 0.35
  );
}

/** Resolve the finite retry policy without using the mathematical answer. */
export function resolveDigitTraceAttempt(
  score: DigitTraceScore,
  digit: TraceDigit,
  retryDigit: TraceDigit | null,
): DigitTraceAttemptDecision {
  if (score.accepted) {
    return { disposition: "submit", nextRetryDigit: null };
  }

  if (!isGoodFaithDigitTraceAttempt(score)) {
    return {
      disposition: "reject",
      nextRetryDigit: retryDigit === digit ? retryDigit : null,
    };
  }

  if (retryDigit === digit) {
    return { disposition: "submit", nextRetryDigit: null };
  }

  return { disposition: "retry", nextRetryDigit: digit };
}

function referencePath(
  coordinates: readonly (readonly [number, number])[],
): readonly TracePoint[] {
  return Object.freeze(
    coordinates.map(([x, y]) => Object.freeze({ x, y })),
  );
}

/**
 * Map the source font's 1000-unit, bottom-up coordinates into this game's
 * normalized 100 × 140 tracing surface.
 *
 * Digit coordinates are adapted from EMS Readability at pinned commit
 * 068fdaab668007da7ecd768540cb10ab8ae39bac. The font is a single-line
 * Source Sans Pro Light derivative distributed under SIL OFL 1.1. See
 * public/licenses/EMS-Readability-OFL.txt for provenance and license.
 */
function emsReadabilityPath(
  coordinates: readonly (readonly [number, number])[],
): readonly TracePoint[] {
  return referencePath(
    coordinates.map(
      ([sourceX, sourceY]) =>
        [
          (7 + sourceX * 0.17) / 100,
          (124 - sourceY * 0.172) / 140,
        ] as const,
    ),
  );
}

/**
 * Natural one-stroke teaching paths. Either drawing direction is accepted.
 */
export const DIGIT_REFERENCE_PATHS: Readonly<
  Record<TraceDigit, readonly TracePoint[]>
> = Object.freeze({
  2: emsReadabilityPath([
    [75.6, 558],
    [117, 598],
    [167, 630],
    [230, 646],
    [284, 636],
    [340, 608],
    [375, 561],
    [391, 491],
    [387, 432],
    [356, 359],
    [299, 277],
    [230, 192],
    [167, 126],
    [110, 63],
    [81.9, 31.5],
    [438, 31.5],
  ]),
  3: emsReadabilityPath([
    [88.2, 576],
    [139, 614],
    [205, 643],
    [258, 643],
    [315, 627],
    [362, 589],
    [384, 539],
    [394, 479],
    [378, 425],
    [324, 384],
    [265, 353],
    [214, 343],
    [176, 343],
    [224, 343],
    [274, 337],
    [324, 318],
    [378, 277],
    [403, 239],
    [413, 195],
    [410, 148],
    [400, 110],
    [369, 66.1],
    [324, 37.8],
    [268, 22.1],
    [208, 22.1],
    [151, 37.8],
    [94.5, 69.3],
    [59.9, 101],
  ]),
  4: emsReadabilityPath([
    [340, 15.8],
    [340, 630],
    [47.2, 220],
    [444, 220],
  ]),
  5: emsReadabilityPath([
    [59.9, 97.6],
    [101, 63],
    [145, 37.8],
    [195, 18.9],
    [243, 15.8],
    [315, 34.6],
    [365, 75.6],
    [406, 135],
    [422, 205],
    [413, 287],
    [378, 350],
    [306, 391],
    [233, 397],
    [180, 384],
    [126, 356],
    [120, 365],
    [139, 630],
    [397, 630],
  ]),
  6: emsReadabilityPath([
    [85, 265],
    [132, 315],
    [189, 359],
    [246, 378],
    [309, 378],
    [356, 356],
    [391, 324],
    [416, 265],
    [425, 195],
    [410, 123],
    [375, 63],
    [321, 25.2],
    [258, 15.8],
    [202, 34.6],
    [151, 72.4],
    [110, 135],
    [91.4, 224],
    [85, 318],
    [97.6, 438],
    [120, 510],
    [148, 567],
    [195, 614],
    [255, 639],
    [315, 643],
    [372, 624],
    [413, 589],
  ]),
  7: emsReadabilityPath([
    [224, 18.9],
    [236, 186],
    [261, 306],
    [296, 410],
    [340, 491],
    [387, 567],
    [435, 633],
    [72.5, 633],
  ]),
  8: emsReadabilityPath([
    [296, 321],
    [359, 372],
    [397, 428],
    [406, 482],
    [403, 539],
    [362, 605],
    [299, 639],
    [249, 643],
    [173, 621],
    [123, 570],
    [110, 513],
    [126, 435],
    [176, 387],
    [265, 340],
    [346, 296],
    [400, 255],
    [425, 198],
    [419, 129],
    [400, 78.8],
    [340, 31.5],
    [265, 15.8],
    [205, 25.2],
    [142, 53.6],
    [94.5, 104],
    [78.8, 158],
    [85, 236],
    [135, 306],
    [176, 334],
    [230, 359],
  ]),
  9: emsReadabilityPath([
    [88.2, 75.6],
    [123, 40.9],
    [180, 22.1],
    [239, 15.8],
    [302, 47.2],
    [362, 107],
    [397, 198],
    [413, 309],
    [413, 413],
    [391, 510],
    [353, 586],
    [293, 630],
    [224, 643],
    [151, 617],
    [107, 573],
    [81.9, 517],
    [75.6, 460],
    [78.8, 397],
    [113, 331],
    [176, 290],
    [252, 280],
    [334, 315],
    [384, 362],
    [416, 403],
  ]),
});

const EPSILON = 1e-9;

function distance(left: TracePoint, right: TracePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isFinitePoint(point: TracePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function collapseConsecutivePoints(
  points: readonly TracePoint[],
): TracePoint[] {
  const collapsed: TracePoint[] = [];
  for (const point of points) {
    const previous = collapsed.at(-1);
    if (!previous || distance(previous, point) > EPSILON) {
      collapsed.push({ x: point.x, y: point.y });
    }
  }
  return collapsed;
}

export function tracePathLength(points: readonly TracePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1]!, points[index]!);
  }
  return length;
}

export function traceBounds(points: readonly TracePoint[]): TraceBounds {
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
      centerX: 0,
      centerY: 0,
    };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/** Resample a polyline at deterministic, equal arc-length intervals. */
export function resamplePolyline(
  points: readonly TracePoint[],
  sampleCount = DEFAULT_TRACE_QUALITY_OPTIONS.sampleCount,
): TracePoint[] {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2) {
    throw new RangeError("Trace sampleCount must be an integer of at least 2.");
  }
  if (points.some((point) => !isFinitePoint(point))) {
    throw new TypeError("Trace points must contain finite x and y coordinates.");
  }
  const collapsed = collapseConsecutivePoints(points);
  if (collapsed.length === 0) return [];
  if (collapsed.length === 1) {
    return Array.from({ length: sampleCount }, () => ({ ...collapsed[0]! }));
  }

  const cumulative = [0];
  for (let index = 1; index < collapsed.length; index += 1) {
    cumulative.push(
      cumulative[index - 1]! +
        distance(collapsed[index - 1]!, collapsed[index]!),
    );
  }
  const totalLength = cumulative.at(-1)!;
  if (totalLength <= EPSILON) {
    return Array.from({ length: sampleCount }, () => ({ ...collapsed[0]! }));
  }

  const result: TracePoint[] = [];
  let segmentIndex = 1;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const target = (totalLength * sampleIndex) / (sampleCount - 1);
    while (
      segmentIndex < cumulative.length - 1 &&
      cumulative[segmentIndex]! < target
    ) {
      segmentIndex += 1;
    }
    const startDistance = cumulative[segmentIndex - 1]!;
    const endDistance = cumulative[segmentIndex]!;
    const segmentLength = endDistance - startDistance;
    const progress =
      segmentLength <= EPSILON ? 0 : (target - startDistance) / segmentLength;
    const start = collapsed[segmentIndex - 1]!;
    const end = collapsed[segmentIndex]!;
    result.push({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    });
  }
  return result;
}

function smoothPolyline(points: readonly TracePoint[]): TracePoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point };
    const previous = points[index - 1]!;
    const next = points[index + 1]!;
    return {
      x: previous.x * 0.2 + point.x * 0.6 + next.x * 0.2,
      y: previous.y * 0.2 + point.y * 0.6 + next.y * 0.2,
    };
  });
}

function meanSquaredOrderedError(
  trace: readonly TracePoint[],
  reference: readonly TracePoint[],
): number {
  let squaredError = 0;
  for (let index = 0; index < trace.length; index += 1) {
    const delta = distance(trace[index]!, reference[index]!);
    squaredError += delta * delta;
  }
  return Math.sqrt(squaredError / trace.length);
}

function nearestDistances(
  source: readonly TracePoint[],
  target: readonly TracePoint[],
): number[] {
  return source.map((sourcePoint) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const targetPoint of target) {
      nearest = Math.min(nearest, distance(sourcePoint, targetPoint));
    }
    return nearest;
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile90(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.9) - 1]!;
}

function assertTraceDigit(digit: TraceDigit): void {
  if (!Object.hasOwn(DIGIT_REFERENCE_PATHS, digit)) {
    throw new RangeError("Trace scoring supports only the digits 2 through 9.");
  }
}

function resolveOptions(
  overrides: Partial<TraceQualityOptions>,
): TraceQualityOptions {
  const options = { ...DEFAULT_TRACE_QUALITY_OPTIONS, ...overrides };
  if (!Number.isSafeInteger(options.sampleCount) || options.sampleCount < 8) {
    throw new RangeError("Trace scoring sampleCount must be an integer of at least 8.");
  }
  for (const [name, value] of Object.entries(options)) {
    if (name !== "sampleCount" && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`Trace quality option ${name} must be nonnegative.`);
    }
  }
  return options;
}

function rejectedEmptyScore(
  inputPointCount: number,
  reason: TraceRejectionReason,
): DigitTraceScore {
  return {
    accepted: false,
    rejectionReason: reason,
    direction: "forward",
    inputPointCount,
    distinctPointCount: 0,
    pathLength: 0,
    rawPathLength: 0,
    referencePathLength: 0,
    lengthRatio: 0,
    rawLengthRatio: 0,
    widthRatio: 0,
    heightRatio: 0,
    centerError: Number.POSITIVE_INFINITY,
    orderedRmsError: Number.POSITIVE_INFINITY,
    meanPathError: Number.POSITIVE_INFINITY,
    coverageError: Number.POSITIVE_INFINITY,
    pathError90: Number.POSITIVE_INFINITY,
    endpointError: Number.POSITIVE_INFINITY,
  };
}

/** Score a normalized one-stroke trace against a digit teaching path. */
export function scoreDigitTrace(
  points: readonly TracePoint[],
  digit: TraceDigit,
  optionOverrides: Partial<TraceQualityOptions> = {},
): DigitTraceScore {
  assertTraceDigit(digit);
  const options = resolveOptions(optionOverrides);
  if (points.some((point) => !isFinitePoint(point))) {
    return rejectedEmptyScore(points.length, "invalid_points");
  }
  const collapsed = collapseConsecutivePoints(points);
  if (collapsed.length < options.minimumPointCount) {
    return {
      ...rejectedEmptyScore(points.length, "tap"),
      distinctPointCount: collapsed.length,
      rawPathLength: tracePathLength(collapsed),
    };
  }

  const reference = DIGIT_REFERENCE_PATHS[digit];
  const traceSamples = smoothPolyline(
    resamplePolyline(collapsed, options.sampleCount),
  );
  const referenceSamples = smoothPolyline(
    resamplePolyline(reference, options.sampleCount),
  );
  const reversedReference = [...referenceSamples].reverse();
  const forwardError = meanSquaredOrderedError(traceSamples, referenceSamples);
  const reverseError = meanSquaredOrderedError(traceSamples, reversedReference);
  const direction: TraceDirection =
    reverseError < forwardError ? "reverse" : "forward";
  const orientedReference =
    direction === "forward" ? referenceSamples : reversedReference;

  const rawPathLength = tracePathLength(collapsed);
  const pathLength = tracePathLength(traceSamples);
  const referencePathLength = tracePathLength(referenceSamples);
  const lengthRatio = pathLength / referencePathLength;
  const rawLengthRatio = rawPathLength / referencePathLength;
  const bounds = traceBounds(traceSamples);
  const referenceBounds = traceBounds(referenceSamples);
  const widthRatio = bounds.width / referenceBounds.width;
  const heightRatio = bounds.height / referenceBounds.height;
  const centerError = Math.hypot(
    bounds.centerX - referenceBounds.centerX,
    bounds.centerY - referenceBounds.centerY,
  );
  const traceToReference = nearestDistances(traceSamples, referenceSamples);
  const referenceToTrace = nearestDistances(referenceSamples, traceSamples);
  const meanPathError =
    (mean(traceToReference) + mean(referenceToTrace)) / 2;
  const coverageError = mean(referenceToTrace);
  const pathError90 = Math.max(
    percentile90(traceToReference),
    percentile90(referenceToTrace),
  );
  const endpointError =
    (distance(traceSamples[0]!, orientedReference[0]!) +
      distance(traceSamples.at(-1)!, orientedReference.at(-1)!)) /
    2;
  const orderedRmsError = Math.min(forwardError, reverseError);

  let rejectionReason: TraceRejectionReason | null = null;
  if (rawPathLength < options.minimumPathLength) {
    rejectionReason = "tap";
  } else if (
    widthRatio < options.minimumSpanRatio ||
    heightRatio < options.minimumSpanRatio
  ) {
    rejectionReason = "too_small";
  } else if (
    widthRatio > options.maximumSpanRatio ||
    heightRatio > options.maximumSpanRatio ||
    lengthRatio > options.maximumLengthRatio ||
    rawLengthRatio > options.maximumRawLengthRatio
  ) {
    rejectionReason = "too_long";
  } else if (
    lengthRatio < options.minimumLengthRatio ||
    coverageError > options.maximumCoverageError ||
    endpointError > options.maximumEndpointError
  ) {
    rejectionReason = "incomplete";
  } else if (
    centerError > options.maximumCenterError ||
    orderedRmsError > options.maximumOrderedRmsError ||
    meanPathError > options.maximumMeanPathError ||
    pathError90 > options.maximumPathError90
  ) {
    rejectionReason = "off_path";
  }

  return {
    accepted: rejectionReason === null,
    rejectionReason,
    direction,
    inputPointCount: points.length,
    distinctPointCount: collapsed.length,
    pathLength,
    rawPathLength,
    referencePathLength,
    lengthRatio,
    rawLengthRatio,
    widthRatio,
    heightRatio,
    centerError,
    orderedRmsError,
    meanPathError,
    coverageError,
    pathError90,
    endpointError,
  };
}

/** Strict default acceptance predicate for enabling a digit-grid submission. */
export function isAcceptableDigitTrace(
  points: readonly TracePoint[],
  digit: TraceDigit,
  optionOverrides: Partial<TraceQualityOptions> = {},
): boolean {
  return scoreDigitTrace(points, digit, optionOverrides).accepted;
}
