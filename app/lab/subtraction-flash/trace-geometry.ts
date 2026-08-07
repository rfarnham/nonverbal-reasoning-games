/** A point in one answer cell, normalized from 0 (top/left) to 1 (bottom/right). */
export interface TracePoint {
  readonly x: number;
  readonly y: number;
}

export type TraceStroke = readonly TracePoint[];

export type DigitTraceTemplate = readonly TraceStroke[];

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
 * Fit one glyph from the public-domain Hershey digit SVG into this game's
 * normalized 100 × 140 tracing surface while preserving its separate strokes.
 * The source paths are the plain print row in Wikimedia Commons revision
 * 1225175617. See public/licenses/Hershey-NIST-Public-Domain.txt.
 */
function hersheyGlyph(
  strokes: readonly (readonly (readonly [number, number])[])[],
): DigitTraceTemplate {
  const allPoints = strokes.flat();
  const xs = allPoints.map(([x]) => x);
  const ys = allPoints.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;

  return Object.freeze(
    strokes.map((stroke) =>
      referencePath(
        stroke.map(
          ([x, y]) =>
            [
              0.17 + ((x - minX) / width) * 0.66,
              0.08 + ((y - minY) / height) * 0.84,
            ] as const,
        ),
      ),
    ),
  );
}

/**
 * Large single-line teaching glyphs. The open 4 and print 5 intentionally
 * expose their pen lifts; either stroke order and either direction are valid.
 */
export const DIGIT_REFERENCE_STROKES: Readonly<
  Record<TraceDigit, DigitTraceTemplate>
> = Object.freeze({
  2: hersheyGlyph([[
    [188, 186], [188, 184], [190, 180], [192, 178], [196, 176],
    [204, 176], [208, 178], [210, 180], [212, 184], [212, 188],
    [210, 192], [206, 198], [186, 218], [214, 218],
  ]]),
  3: hersheyGlyph([[
    [230, 176], [252, 176], [240, 192], [246, 192], [250, 194],
    [252, 196], [254, 202], [254, 206], [252, 212], [248, 216],
    [242, 218], [236, 218], [230, 216], [228, 214], [226, 210],
  ]]),
  4: hersheyGlyph([
    [[286, 176], [266, 204], [296, 204]],
    [[290, 176], [286, 218]],
  ]),
  5: hersheyGlyph([
    [
      [310, 176], [308, 194], [310, 192], [316, 190], [322, 190],
      [328, 192], [332, 196], [334, 202], [334, 206], [332, 212],
      [328, 216], [322, 218], [316, 218], [310, 216], [308, 214],
      [306, 210],
    ],
    [[330, 176], [310, 176]],
  ]),
  6: hersheyGlyph([[
    [372, 182], [370, 178], [364, 176], [360, 176], [354, 178],
    [350, 184], [348, 194], [348, 204], [350, 212], [354, 216],
    [360, 218], [362, 218], [368, 216], [372, 212], [374, 206],
    [374, 204], [372, 198], [368, 194], [362, 192], [360, 192],
    [354, 194], [350, 198], [348, 204],
  ]]),
  7: hersheyGlyph([[
    [386, 176], [414, 176], [404, 197], [394, 218],
  ]]),
  8: hersheyGlyph([[
    [436, 176], [430, 178], [428, 182], [428, 186], [430, 190],
    [434, 192], [442, 194], [448, 196], [452, 200], [454, 204],
    [454, 210], [452, 214], [450, 216], [444, 218], [436, 218],
    [430, 216], [428, 214], [426, 210], [426, 204], [428, 200],
    [432, 196], [438, 194], [446, 192], [450, 190], [452, 186],
    [452, 182], [450, 178], [444, 176], [436, 176],
  ]]),
  9: hersheyGlyph([[
    [492, 190], [490, 196], [486, 200], [480, 202], [478, 202],
    [472, 200], [468, 196], [466, 190], [466, 188], [468, 182],
    [472, 178], [478, 176], [480, 176], [486, 178], [490, 182],
    [492, 190], [492, 200], [490, 210], [486, 216], [480, 218],
    [476, 218], [470, 216], [468, 212],
  ]]),
});

const FIVE_ONE_STROKE = hersheyGlyph([[
  [330, 176], [310, 176], [308, 194], [310, 192], [316, 190],
  [322, 190], [328, 192], [332, 196], [334, 202], [334, 206],
  [332, 212], [328, 216], [322, 218], [316, 218], [310, 216],
  [308, 214], [306, 210],
]]);

const DIGIT_TRACE_TEMPLATES: Readonly<
  Record<TraceDigit, readonly DigitTraceTemplate[]>
> = Object.freeze({
  2: [DIGIT_REFERENCE_STROKES[2]],
  3: [DIGIT_REFERENCE_STROKES[3]],
  4: [DIGIT_REFERENCE_STROKES[4]],
  5: [DIGIT_REFERENCE_STROKES[5], FIVE_ONE_STROKE],
  6: [DIGIT_REFERENCE_STROKES[6]],
  7: [DIGIT_REFERENCE_STROKES[7]],
  8: [DIGIT_REFERENCE_STROKES[8]],
  9: [DIGIT_REFERENCE_STROKES[9]],
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
  if (!Object.hasOwn(DIGIT_REFERENCE_STROKES, digit)) {
    throw new RangeError("Trace scoring supports only the digits 2 through 9.");
  }
}

const DIGIT_QUALITY_OVERRIDES: Readonly<
  Partial<Record<TraceDigit, Partial<TraceQualityOptions>>>
> = Object.freeze({
  // Eight is a closed, self-crossing path. It is the hardest glyph to follow
  // under a finger, so allow more size, path, and closure drift without
  // weakening any other numeral.
  8: {
    minimumSpanRatio: 0.5,
    minimumLengthRatio: 0.58,
    maximumLengthRatio: 2.45,
    maximumRawLengthRatio: 3.6,
    maximumCenterError: 0.2,
    maximumOrderedRmsError: 0.24,
    maximumMeanPathError: 0.16,
    maximumCoverageError: 0.18,
    maximumPathError90: 0.3,
    maximumEndpointError: 0.34,
  },
});

function resolveOptions(
  digit: TraceDigit,
  overrides: Partial<TraceQualityOptions>,
): TraceQualityOptions {
  const options = {
    ...DEFAULT_TRACE_QUALITY_OPTIONS,
    ...DIGIT_QUALITY_OVERRIDES[digit],
    ...overrides,
  };
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

type StrokeAlignment = Readonly<{
  direction: TraceDirection;
  orderedRmsError: number;
  endpointError: number;
}>;

function rotatePoints(
  points: readonly TracePoint[],
  offset: number,
): TracePoint[] {
  return [...points.slice(offset), ...points.slice(0, offset)];
}

function alignStroke(
  trace: readonly TracePoint[],
  reference: readonly TracePoint[],
): StrokeAlignment {
  const isClosed =
    reference.length > 2 && distance(reference[0]!, reference.at(-1)!) <= 0.04;
  let bestDirection: TraceDirection = "forward";
  let bestError = Number.POSITIVE_INFINITY;

  for (const direction of ["forward", "reverse"] as const) {
    const oriented =
      direction === "forward" ? [...reference] : [...reference].reverse();
    const offsets = isClosed
      ? Array.from({ length: oriented.length }, (_, index) => index)
      : [0];
    for (const offset of offsets) {
      const candidate = isClosed ? rotatePoints(oriented, offset) : oriented;
      const error = meanSquaredOrderedError(trace, candidate);
      if (error < bestError) {
        bestError = error;
        bestDirection = direction;
      }
    }
  }

  const forwardReference =
    bestDirection === "forward" ? reference : [...reference].reverse();
  return {
    direction: bestDirection,
    orderedRmsError: bestError,
    endpointError: isClosed
      ? distance(trace[0]!, trace.at(-1)!)
      : (distance(trace[0]!, forwardReference[0]!) +
          distance(trace.at(-1)!, forwardReference.at(-1)!)) /
        2,
  };
}

function scoreAgainstTemplate(
  strokes: readonly (readonly TracePoint[])[],
  template: DigitTraceTemplate,
  options: TraceQualityOptions,
): DigitTraceScore {
  const pairings =
    strokes.length === 2
      ? ([
          [0, 1],
          [1, 0],
        ] as const)
      : ([strokes.map((_, index) => index)] as const);

  let best:
    | Readonly<{
        alignments: readonly StrokeAlignment[];
        references: readonly (readonly TracePoint[])[];
        orderedRmsError: number;
      }>
    | null = null;

  for (const pairing of pairings) {
    const references = pairing.map((index) => template[index]!);
    const alignments: StrokeAlignment[] = [];
    let squaredError = 0;
    for (let index = 0; index < strokes.length; index += 1) {
      const traceSamples = smoothPolyline(
        resamplePolyline(strokes[index]!, options.sampleCount),
      );
      const referenceSamples = smoothPolyline(
        resamplePolyline(references[index]!, options.sampleCount),
      );
      const alignment = alignStroke(traceSamples, referenceSamples);
      alignments.push(alignment);
      squaredError += alignment.orderedRmsError ** 2;
    }
    const orderedRmsError = Math.sqrt(squaredError / strokes.length);
    if (!best || orderedRmsError < best.orderedRmsError) {
      best = { alignments, references, orderedRmsError };
    }
  }

  const traceStrokeSamples = strokes.map((stroke) =>
    smoothPolyline(resamplePolyline(stroke, options.sampleCount)),
  );
  const referenceStrokeSamples = best!.references.map((stroke) =>
    smoothPolyline(resamplePolyline(stroke, options.sampleCount)),
  );
  const traceSamples = traceStrokeSamples.flat();
  const referenceSamples = referenceStrokeSamples.flat();
  const rawPathLength = strokes.reduce(
    (total, stroke) => total + tracePathLength(stroke),
    0,
  );
  const pathLength = traceStrokeSamples.reduce(
    (total, stroke) => total + tracePathLength(stroke),
    0,
  );
  const referencePathLength = referenceStrokeSamples.reduce(
    (total, stroke) => total + tracePathLength(stroke),
    0,
  );
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
  const endpointError = mean(
    best!.alignments.map((alignment) => alignment.endpointError),
  );
  const orderedRmsError = best!.orderedRmsError;

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
    direction:
      best!.alignments.filter(({ direction }) => direction === "reverse").length >
      best!.alignments.length / 2
        ? "reverse"
        : "forward",
    inputPointCount: strokes.reduce((total, stroke) => total + stroke.length, 0),
    distinctPointCount: strokes.reduce(
      (total, stroke) => total + stroke.length,
      0,
    ),
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

/** Score one or more pen strokes against the digit's accepted handwriting. */
export function scoreDigitStrokes(
  strokes: readonly (readonly TracePoint[])[],
  digit: TraceDigit,
  optionOverrides: Partial<TraceQualityOptions> = {},
): DigitTraceScore {
  assertTraceDigit(digit);
  const options = resolveOptions(digit, optionOverrides);
  const inputPointCount = strokes.reduce(
    (total, stroke) => total + stroke.length,
    0,
  );
  if (strokes.some((stroke) => stroke.some((point) => !isFinitePoint(point)))) {
    return rejectedEmptyScore(inputPointCount, "invalid_points");
  }
  const collapsed = strokes.map(collapseConsecutivePoints);
  const distinctPointCount = collapsed.reduce(
    (total, stroke) => total + stroke.length,
    0,
  );
  const rawPathLength = collapsed.reduce(
    (total, stroke) => total + tracePathLength(stroke),
    0,
  );
  if (
    collapsed.length === 0 ||
    collapsed.some((stroke) => stroke.length < 2) ||
    distinctPointCount < options.minimumPointCount ||
    rawPathLength < options.minimumPathLength
  ) {
    return {
      ...rejectedEmptyScore(inputPointCount, "tap"),
      distinctPointCount,
      rawPathLength,
    };
  }

  const matchingTemplates = DIGIT_TRACE_TEMPLATES[digit].filter(
    (template) => template.length === collapsed.length,
  );
  if (matchingTemplates.length === 0) {
    return {
      ...rejectedEmptyScore(
        inputPointCount,
        collapsed.length < DIGIT_REFERENCE_STROKES[digit].length
          ? "incomplete"
          : "too_long",
      ),
      distinctPointCount,
      rawPathLength,
    };
  }

  const scores = matchingTemplates.map((template) =>
    scoreAgainstTemplate(collapsed, template, options),
  );
  return scores.find(({ accepted }) => accepted) ??
    scores.reduce((best, score) =>
      score.orderedRmsError + score.meanPathError + score.coverageError <
      best.orderedRmsError + best.meanPathError + best.coverageError
        ? score
        : best,
    );
}

/** Score a normalized one-stroke trace, including the one-stroke 5 variant. */
export function scoreDigitTrace(
  points: readonly TracePoint[],
  digit: TraceDigit,
  optionOverrides: Partial<TraceQualityOptions> = {},
): DigitTraceScore {
  return scoreDigitStrokes([points], digit, optionOverrides);
}

/** Strict default acceptance predicate for enabling a digit-grid submission. */
export function isAcceptableDigitTrace(
  points: readonly TracePoint[],
  digit: TraceDigit,
  optionOverrides: Partial<TraceQualityOptions> = {},
): boolean {
  return scoreDigitTrace(points, digit, optionOverrides).accepted;
}

export function isAcceptableDigitStrokes(
  strokes: readonly (readonly TracePoint[])[],
  digit: TraceDigit,
  optionOverrides: Partial<TraceQualityOptions> = {},
): boolean {
  return scoreDigitStrokes(strokes, digit, optionOverrides).accepted;
}
