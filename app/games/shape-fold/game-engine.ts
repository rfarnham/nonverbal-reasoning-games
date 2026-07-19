import {
  CAMPAIGN_ROUND_SPECS,
  type CampaignRoundSpec,
} from "./campaign-data.ts";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
export type FoldDirection = "left" | "right" | "up" | "down";
export type FoldAxis = "horizontal" | "vertical";

export type Point = Readonly<{
  x: number;
  y: number;
}>;
export type Cell = Point;

export type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type FoldStep = Readonly<{
  index: number;
  direction: FoldDirection;
  before: Bounds;
  after: Bounds;
  crease: Readonly<{
    axis: FoldAxis;
    coordinate: number;
  }>;
}>;

export type HolePattern = readonly Point[];
export type OptionKind = "correct" | "near-miss" | "wrong-punch";

export type Round = Readonly<{
  difficulty: Difficulty;
  folds: readonly FoldDirection[];
  foldSteps: readonly FoldStep[];
  foldedBounds: Bounds;
  punches: HolePattern;
  correctPattern: HolePattern;
  options: readonly HolePattern[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
}>;

export type PatternDifference = Readonly<{
  missing: HolePattern;
  extra: HolePattern;
  total: number;
}>;

export type FoldedLayer = Readonly<{
  position: Point;
  originals: HolePattern;
}>;

export type FoldedState = Readonly<{
  bounds: Bounds;
  steps: readonly FoldStep[];
  layers: readonly FoldedLayer[];
}>;

export type RandomSource = () => number;

const PAPER_SIZE = 8;
const INITIAL_BOUNDS: Bounds = Object.freeze({
  x: 0,
  y: 0,
  width: PAPER_SIZE,
  height: PAPER_SIZE,
});
const MAX_GENERATION_ATTEMPTS = 64;
const FOLD_COUNTS: Record<Difficulty, number> = {
  Easy: 1,
  Medium: 2,
  Hard: 3,
  Wizard: 3,
};
const PUNCH_COUNT_BOUNDS: Record<
  Difficulty,
  Readonly<{ minimum: number; maximum: number }>
> = {
  Easy: { minimum: 1, maximum: 1 },
  Medium: { minimum: 1, maximum: 1 },
  Hard: { minimum: 2, maximum: 3 },
  Wizard: { minimum: 2, maximum: 3 },
};

const DIRECTION_LABELS: Record<FoldDirection, string> = {
  left: "fold the left half to the right",
  right: "fold the right half to the left",
  up: "fold the top half down",
  down: "fold the bottom half up",
};

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function comparePoints(a: Point, b: Point): number {
  return a.y - b.y || a.x - b.x;
}

function normalizePattern(pattern: HolePattern): HolePattern {
  const points = new Map<string, Point>();
  for (const point of pattern) {
    points.set(pointKey(point), { x: point.x, y: point.y });
  }
  return [...points.values()].sort(comparePoints);
}

export function patternKey(pattern: HolePattern): string {
  return normalizePattern(pattern).map(pointKey).join("|");
}

export function patternsEqual(
  first: HolePattern,
  second: HolePattern,
): boolean {
  return patternKey(first) === patternKey(second);
}

export function patternDifference(
  attempted: HolePattern,
  expected: HolePattern,
): PatternDifference {
  const attemptedKeys = new Set(attempted.map(pointKey));
  const expectedKeys = new Set(expected.map(pointKey));
  const missing = normalizePattern(
    expected.filter((point) => !attemptedKeys.has(pointKey(point))),
  );
  const extra = normalizePattern(
    attempted.filter((point) => !expectedKeys.has(pointKey(point))),
  );

  return {
    missing,
    extra,
    total: missing.length + extra.length,
  };
}

export const compareHolePatterns = patternDifference;

function axisForDirection(direction: FoldDirection): FoldAxis {
  return direction === "left" || direction === "right"
    ? "vertical"
    : "horizontal";
}

function oppositeDirection(direction: FoldDirection): FoldDirection {
  switch (direction) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "up":
      return "down";
    case "down":
      return "up";
  }
}

function canFold(bounds: Bounds, direction: FoldDirection): boolean {
  return axisForDirection(direction) === "vertical"
    ? bounds.width >= 2 && bounds.width % 2 === 0
    : bounds.height >= 2 && bounds.height % 2 === 0;
}

export function nextBounds(
  bounds: Bounds,
  direction: FoldDirection,
): Bounds {
  if (!canFold(bounds, direction)) {
    throw new Error(
      `Cannot fold ${direction} from ${bounds.width}×${bounds.height}.`,
    );
  }

  switch (direction) {
    case "left":
      return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y,
        width: bounds.width / 2,
        height: bounds.height,
      };
    case "right":
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width / 2,
        height: bounds.height,
      };
    case "up":
      return {
        x: bounds.x,
        y: bounds.y + bounds.height / 2,
        width: bounds.width,
        height: bounds.height / 2,
      };
    case "down":
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height / 2,
      };
  }
}

function foldStep(
  before: Bounds,
  direction: FoldDirection,
  index: number,
): FoldStep {
  const axis = axisForDirection(direction);
  return {
    index,
    direction,
    before,
    after: nextBounds(before, direction),
    crease: {
      axis,
      coordinate:
        axis === "vertical"
          ? before.x + before.width / 2
          : before.y + before.height / 2,
    },
  };
}

export function buildFoldSteps(
  folds: readonly FoldDirection[],
): readonly FoldStep[] {
  const steps: FoldStep[] = [];
  let bounds = INITIAL_BOUNDS;

  folds.forEach((direction, index) => {
    const step = foldStep(bounds, direction, index);
    steps.push(step);
    bounds = step.after;
  });

  return steps;
}

function mirrorPoint(point: Point, step: FoldStep): Point {
  if (step.crease.axis === "vertical") {
    return {
      x: 2 * step.before.x + step.before.width - 1 - point.x,
      y: point.y,
    };
  }

  return {
    x: point.x,
    y: 2 * step.before.y + step.before.height - 1 - point.y,
  };
}

function pointMoves(
  point: Point,
  bounds: Bounds,
  direction: FoldDirection,
): boolean {
  switch (direction) {
    case "left":
      return point.x < bounds.x + bounds.width / 2;
    case "right":
      return point.x >= bounds.x + bounds.width / 2;
    case "up":
      return point.y < bounds.y + bounds.height / 2;
    case "down":
      return point.y >= bounds.y + bounds.height / 2;
  }
}

export function applyFolds(
  folds: readonly FoldDirection[],
): FoldedState {
  let bounds = INITIAL_BOUNDS;
  let layers = new Map<string, Point[]>();
  const steps: FoldStep[] = [];

  for (let y = 0; y < PAPER_SIZE; y += 1) {
    for (let x = 0; x < PAPER_SIZE; x += 1) {
      const point = { x, y };
      layers.set(pointKey(point), [point]);
    }
  }

  folds.forEach((direction, index) => {
    const step = foldStep(bounds, direction, index);
    const nextLayers = new Map<string, Point[]>();

    for (const [key, originals] of layers) {
      const [x, y] = key.split(",").map(Number);
      const position = { x, y };
      const destination = pointMoves(position, bounds, direction)
        ? mirrorPoint(position, step)
        : position;
      const destinationKey = pointKey(destination);
      nextLayers.set(destinationKey, [
        ...(nextLayers.get(destinationKey) ?? []),
        ...originals,
      ]);
    }

    steps.push(step);
    layers = nextLayers;
    bounds = step.after;
  });

  return {
    bounds,
    steps,
    layers: [...layers.entries()]
      .map(([key, originals]) => {
        const [x, y] = key.split(",").map(Number);
        return {
          position: { x, y },
          originals: normalizePattern(originals),
        };
      })
      .sort((a, b) => comparePoints(a.position, b.position)),
  };
}

export function unfoldStages(
  folds: readonly FoldDirection[],
  punches: HolePattern,
): readonly HolePattern[] {
  const steps = buildFoldSteps(folds);
  const stages: HolePattern[] = [normalizePattern(punches)];
  let holes: HolePattern = stages[0];

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    holes = normalizePattern([
      ...holes,
      ...holes.map((point) => mirrorPoint(point, steps[index])),
    ]);
    stages.push(holes);
  }

  return stages;
}

export function unfoldPunches(
  folds: readonly FoldDirection[],
  punches: HolePattern,
): HolePattern {
  return unfoldStages(folds, punches).at(-1) ?? [];
}

export function unfoldPunch(
  folds: readonly FoldDirection[],
  punch: Point,
): HolePattern {
  return unfoldPunches(folds, [punch]);
}

function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a finite value from 0 to 1.");
  }
  return value;
}

function randomInt(random: RandomSource, maximum: number): number {
  return Math.floor(randomUnit(random) * maximum);
}

function chooseDirection(
  axis: FoldAxis,
  random: RandomSource,
): FoldDirection {
  if (axis === "vertical") {
    return randomUnit(random) < 0.5 ? "left" : "right";
  }
  return randomUnit(random) < 0.5 ? "up" : "down";
}

function chooseFolds(
  difficulty: Difficulty,
  random: RandomSource,
): readonly FoldDirection[] {
  const foldCount = FOLD_COUNTS[difficulty];
  const axes: FoldAxis[] = [];

  if (foldCount === 1) {
    axes.push(randomUnit(random) < 0.5 ? "vertical" : "horizontal");
  } else if (foldCount === 2) {
    const first =
      randomUnit(random) < 0.5 ? "vertical" : "horizontal";
    const useBothAxes = randomUnit(random) < 0.68;
    axes.push(first, useBothAxes ? (first === "vertical" ? "horizontal" : "vertical") : first);
  } else {
    const first =
      randomUnit(random) < 0.5 ? "vertical" : "horizontal";
    const second = first === "vertical" ? "horizontal" : "vertical";
    axes.push(
      first,
      second,
      randomUnit(random) < 0.5 ? "vertical" : "horizontal",
    );
  }

  return axes.map((axis) => chooseDirection(axis, random));
}

function choosePunches(
  bounds: Bounds,
  count: number,
  random: RandomSource,
): HolePattern {
  const cells: Point[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      cells.push({ x, y });
    }
  }

  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, index + 1);
    [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
  }
  return normalizePattern(cells.slice(0, count));
}

function nearestEmptyPoint(
  pattern: HolePattern,
  source: Point,
  salt: number,
): Point | null {
  const occupied = new Set(pattern.map(pointKey));
  const offsets = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
  ];

  for (let offset = 0; offset < offsets.length; offset += 1) {
    const delta = offsets[(offset + salt) % offsets.length];
    const candidate = {
      x: source.x + delta.x,
      y: source.y + delta.y,
    };
    if (
      candidate.x >= 0 &&
      candidate.x < PAPER_SIZE &&
      candidate.y >= 0 &&
      candidate.y < PAPER_SIZE &&
      !occupied.has(pointKey(candidate))
    ) {
      return candidate;
    }
  }

  for (let y = 0; y < PAPER_SIZE; y += 1) {
    for (let x = 0; x < PAPER_SIZE; x += 1) {
      const candidate = { x, y };
      if (!occupied.has(pointKey(candidate))) return candidate;
    }
  }

  return null;
}

function buildNearMiss(
  correctPattern: HolePattern,
  salt: number,
): HolePattern | null {
  for (let offset = 0; offset < correctPattern.length; offset += 1) {
    const sourceIndex = (salt + offset) % correctPattern.length;
    const source = correctPattern[sourceIndex];
    const replacement = nearestEmptyPoint(
      correctPattern,
      source,
      salt + offset,
    );
    if (!replacement) continue;
    return normalizePattern(
      correctPattern.map((point, index) =>
        index === sourceIndex ? replacement : point,
      ),
    );
  }
  return null;
}

function adjacentPunchPatterns(
  bounds: Bounds,
  punches: HolePattern,
): readonly HolePattern[] {
  const occupied = new Set(punches.map(pointKey));
  const patterns = new Map<string, HolePattern>();
  const offsets = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];

  punches.forEach((punch, punchIndex) => {
    offsets.forEach((offset) => {
      const replacement = {
        x: punch.x + offset.x,
        y: punch.y + offset.y,
      };
      if (
        replacement.x < bounds.x ||
        replacement.x >= bounds.x + bounds.width ||
        replacement.y < bounds.y ||
        replacement.y >= bounds.y + bounds.height ||
        occupied.has(pointKey(replacement))
      ) {
        return;
      }
      const pattern = normalizePattern(
        punches.map((point, index) =>
          index === punchIndex ? replacement : point,
        ),
      );
      patterns.set(patternKey(pattern), pattern);
    });
  });
  return [...patterns.values()];
}

function buildDistractors(
  folds: readonly FoldDirection[],
  foldedBounds: Bounds,
  punches: HolePattern,
  correctPattern: HolePattern,
  salt: number,
): readonly Readonly<{ pattern: HolePattern; kind: OptionKind }>[] {
  const distractors: Array<Readonly<{
    pattern: HolePattern;
    kind: OptionKind;
  }>> = [];
  const seen = new Set([patternKey(correctPattern)]);

  for (let nearMissSalt = salt; nearMissSalt < salt + 32; nearMissSalt += 1) {
    const pattern = buildNearMiss(correctPattern, nearMissSalt);
    if (!pattern || seen.has(patternKey(pattern))) continue;
    distractors.push({ pattern, kind: "near-miss" });
    seen.add(patternKey(pattern));
    break;
  }

  const wrongPunches = adjacentPunchPatterns(foldedBounds, punches);
  for (let offset = 0; offset < wrongPunches.length; offset += 1) {
    const candidate = wrongPunches[(offset + salt) % wrongPunches.length];
    const pattern = unfoldPunches(folds, candidate);
    if (seen.has(patternKey(pattern))) continue;
    distractors.push({ pattern, kind: "wrong-punch" });
    seen.add(patternKey(pattern));
    if (distractors.length === 3) break;
  }

  for (let nearMissSalt = salt + 32; distractors.length < 3; nearMissSalt += 1) {
    if (nearMissSalt > salt + 128) break;
    const pattern = buildNearMiss(correctPattern, nearMissSalt);
    if (!pattern || seen.has(patternKey(pattern))) continue;
    distractors.push({ pattern, kind: "near-miss" });
    seen.add(patternKey(pattern));
  }

  if (distractors.length !== 3) {
    throw new Error("Could not build three distinct meaningful distractors.");
  }

  return distractors;
}

function buildRound(
  difficulty: Difficulty,
  random: RandomSource,
  forcedCorrectIndex?: number,
): Round {
  const folds = chooseFolds(difficulty, random);
  const foldedState = applyFolds(folds);
  const punchBounds = PUNCH_COUNT_BOUNDS[difficulty];
  const punchCount =
    punchBounds.minimum +
    randomInt(random, punchBounds.maximum - punchBounds.minimum + 1);
  const punches = choosePunches(foldedState.bounds, punchCount, random);
  const correctPattern = unfoldPunches(folds, punches);
  const salt = randomInt(random, 10_000);
  const distractors = buildDistractors(
    folds,
    foldedState.bounds,
    punches,
    correctPattern,
    salt,
  );
  const correctIndex =
    forcedCorrectIndex ?? randomInt(random, distractors.length + 1);
  const options: HolePattern[] = [];
  const optionKinds: OptionKind[] = [];
  let distractorIndex = 0;

  for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
    if (optionIndex === correctIndex) {
      options.push(correctPattern);
      optionKinds.push("correct");
    } else {
      const distractor = distractors[distractorIndex];
      options.push(distractor.pattern);
      optionKinds.push(distractor.kind);
      distractorIndex += 1;
    }
  }

  const round: Round = {
    difficulty,
    folds,
    foldSteps: foldedState.steps,
    foldedBounds: foldedState.bounds,
    punches,
    correctPattern,
    options,
    optionKinds,
    correctIndex,
  };
  const errors = validateRound(round);
  if (errors.length > 0) {
    throw new Error(`Invalid Shape Fold round: ${errors.join("; ")}`);
  }
  return round;
}

export class PuzzleGenerationError extends Error {
  constructor(difficulty: Difficulty) {
    super(
      `Unable to generate a valid ${difficulty} Shape Fold puzzle after ${MAX_GENERATION_ATTEMPTS} attempts.`,
    );
    this.name = "PuzzleGenerationError";
  }
}

export function generateInfiniteRound(
  difficulty: Difficulty,
  seedOrRandom: number | RandomSource = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  const random =
    typeof seedOrRandom === "number"
      ? mulberry32(seedOrRandom)
      : seedOrRandom;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const round = buildRound(difficulty, random);
      if (excludedFingerprints.has(roundFingerprint(round))) continue;
      return round;
    } catch {
      // Rejected candidates are retried, then fail explicitly at the bound.
    }
  }

  throw new PuzzleGenerationError(difficulty);
}

export function foldDirectionCandidates(
  step: FoldStep,
): readonly FoldDirection[] {
  const directions: readonly FoldDirection[] = [
    "left",
    "right",
    "up",
    "down",
  ];
  return directions.filter((direction) => {
    if (!canFold(step.before, direction)) return false;
    const candidate = nextBounds(step.before, direction);
    return (
      candidate.x === step.after.x &&
      candidate.y === step.after.y &&
      candidate.width === step.after.width &&
      candidate.height === step.after.height
    );
  });
}

function boundsEqual(first: Bounds, second: Bounds): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function validBoardPoint(point: Point): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.x < PAPER_SIZE &&
    point.y >= 0 &&
    point.y < PAPER_SIZE
  );
}

function pointInsideBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function foldStepsEqual(
  first: readonly FoldStep[],
  second: readonly FoldStep[],
): boolean {
  return (
    first.length === second.length &&
    first.every((step, index) => {
      const expected = second[index];
      return (
        Boolean(expected) &&
        step.index === expected.index &&
        step.direction === expected.direction &&
        boundsEqual(step.before, expected.before) &&
        boundsEqual(step.after, expected.after) &&
        step.crease.axis === expected.crease.axis &&
        step.crease.coordinate === expected.crease.coordinate
      );
    })
  );
}

export function validateRound(round: Round): readonly string[] {
  const errors: string[] = [];
  const expectedFoldCount = FOLD_COUNTS[round.difficulty];
  if (round.folds.length !== expectedFoldCount) {
    errors.push(`expected ${expectedFoldCount} folds`);
  }
  if (
    (round.difficulty === "Hard" || round.difficulty === "Wizard") &&
    new Set(round.folds.map(axisForDirection)).size !== 2
  ) {
    errors.push("expert-level rounds must use both fold axes");
  }
  if (round.options.length !== 4) errors.push("expected four options");
  if (round.optionKinds.length !== round.options.length) {
    errors.push("option kinds must align with the options");
  }
  if (
    round.optionKinds.filter((kind) => kind === "near-miss").length !== 1 ||
    round.optionKinds.filter((kind) => kind === "wrong-punch").length !== 2
  ) {
    errors.push(
      "expected one near-miss and two wrong-punch alternatives",
    );
  }
  if (new Set(round.options.map(patternKey)).size !== round.options.length) {
    errors.push("options must be distinct");
  }

  let foldedState: FoldedState | null = null;
  let computedCorrect: HolePattern = [];
  try {
    foldedState = applyFolds(round.folds);
    computedCorrect = unfoldPunches(round.folds, round.punches);
  } catch {
    errors.push("fold sequence is not geometrically valid");
  }

  if (foldedState) {
    if (!foldStepsEqual(round.foldSteps, foldedState.steps)) {
      errors.push("fold step snapshots do not match the fold sequence");
    }
    if (!boundsEqual(round.foldedBounds, foldedState.bounds)) {
      errors.push("folded bounds do not match the fold sequence");
    }
    const punchBounds = PUNCH_COUNT_BOUNDS[round.difficulty];
    if (
      round.punches.length < punchBounds.minimum ||
      round.punches.length > punchBounds.maximum
    ) {
      errors.push(
        `expected ${punchBounds.minimum}${
          punchBounds.minimum === punchBounds.maximum
            ? ""
            : `-${punchBounds.maximum}`
        } punches`,
      );
    }
    if (
      round.punches.some(
        (punch) =>
          !validBoardPoint(punch) ||
          !pointInsideBounds(punch, foldedState.bounds),
      ) ||
      new Set(round.punches.map(pointKey)).size !== round.punches.length
    ) {
      errors.push(
        "punches must be unique integer cells inside the folded paper",
      );
    }
    const independentPattern = normalizePattern(
      round.punches.flatMap((punch) => {
        const layer = foldedState?.layers.find(
          ({ position }) => pointKey(position) === pointKey(punch),
        );
        return layer?.originals ?? [];
      }),
    );
    if (!patternsEqual(independentPattern, round.correctPattern)) {
      errors.push("correct pattern does not match the independent fold stack");
    }
  }

  const patterns = [round.correctPattern, ...round.options];
  if (
    patterns.some(
      (pattern) =>
        pattern.some((point) => !validBoardPoint(point)) ||
        new Set(pattern.map(pointKey)).size !== pattern.length,
    )
  ) {
    errors.push("hole patterns must use unique integer cells on the paper");
  }

  if (
    computedCorrect.length > 0 &&
    !patternsEqual(computedCorrect, round.correctPattern)
  ) {
    errors.push("correct pattern was not calculated from the folds");
  }
  const exactAnswerCount = round.options.filter((option) =>
    patternsEqual(option, computedCorrect),
  ).length;
  if (exactAnswerCount !== 1) errors.push("expected exactly one answer");
  if (
    !round.options[round.correctIndex] ||
    !patternsEqual(round.options[round.correctIndex], computedCorrect)
  ) {
    errors.push("correct index does not identify the answer");
  }
  if (round.optionKinds[round.correctIndex] !== "correct") {
    errors.push("correct option kind is inconsistent");
  }
  if (
    round.optionKinds.some(
      (kind, index) =>
        (index === round.correctIndex && kind !== "correct") ||
        (index !== round.correctIndex && kind === "correct"),
    )
  ) {
    errors.push("only the exact answer may use the correct option kind");
  }
  if (
    !round.options.some((option, index) => {
      if (index === round.correctIndex) return false;
      const difference = patternDifference(option, computedCorrect);
      return difference.missing.length === 1 && difference.extra.length === 1;
    })
  ) {
    errors.push("expected a close one-opening near-miss");
  }
  round.options.forEach((option, index) => {
    const kind = round.optionKinds[index];
    const difference = patternDifference(option, computedCorrect);
    if (
      kind === "near-miss" &&
      (difference.missing.length !== 1 || difference.extra.length !== 1)
    ) {
      errors.push("near-miss options must move exactly one opening");
    }
  });

  if (foldedState) {
    const legalWrongPunches = new Set(
      adjacentPunchPatterns(foldedState.bounds, round.punches).map((punches) =>
        patternKey(unfoldPunches(round.folds, punches)),
      ),
    );
    round.options.forEach((option, index) => {
      if (
        round.optionKinds[index] === "wrong-punch" &&
        !legalWrongPunches.has(patternKey(option))
      ) {
        errors.push("wrong-punch options must come from an adjacent punch");
      }
    });
  }

  const expectedHoleCount = round.punches.length * 2 ** round.folds.length;
  if (
    round.options.some(
      (option) => normalizePattern(option).length !== expectedHoleCount,
    )
  ) {
    errors.push(
      `all options must contain ${expectedHoleCount} openings (${round.options
        .map((option) => normalizePattern(option).length)
        .join(", ")})`,
    );
  }
  if (round.difficulty === "Wizard") {
    if (
      round.foldSteps.some((step) => {
        const candidates = foldDirectionCandidates(step);
        return candidates.length !== 1 || candidates[0] !== step.direction;
      })
    ) {
      errors.push("wizard folds must remain uniquely inferable");
    }
  }
  return errors;
}

export function roundFingerprint(round: Round): string {
  const folds = round.folds.join(",");
  return `${round.difficulty}|${folds}|${patternKey(
    round.punches,
  )}|${patternKey(round.correctPattern)}`;
}

function buildCampaignRound(spec: CampaignRoundSpec): Round {
  const foldedState = applyFolds(spec.folds);
  const correctPattern = unfoldPunches(spec.folds, spec.punches);
  const round: Round = {
    difficulty: spec.difficulty,
    folds: spec.folds,
    foldSteps: foldedState.steps,
    foldedBounds: foldedState.bounds,
    punches: spec.punches,
    correctPattern,
    options: spec.options,
    optionKinds: spec.optionKinds,
    correctIndex: spec.correctIndex,
  };
  const errors = validateRound(round);
  if (errors.length > 0) {
    throw new Error(
      `Invalid authored Shape Fold ${spec.difficulty} round: ${errors.join("; ")}`,
    );
  }
  return round;
}

export function buildRounds(): readonly Round[] {
  const rounds = CAMPAIGN_ROUND_SPECS.map(buildCampaignRound);
  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error("Authored Shape Fold Campaign fingerprints must be unique.");
  }
  return rounds;
}

export const ROUNDS: readonly Round[] = buildRounds();

const tutorialRound = ROUNDS.find(
  (round) => round.difficulty === "Easy",
) ?? ROUNDS[0];
const tutorialNearMiss =
  tutorialRound.options.find(
    (option, index) =>
      index !== tutorialRound.correctIndex &&
      patternDifference(option, tutorialRound.correctPattern).missing.length ===
        1 &&
      patternDifference(option, tutorialRound.correctPattern).extra.length === 1,
  ) ?? tutorialRound.options.find((_, index) => index !== tutorialRound.correctIndex)!;

export const TUTORIAL = Object.freeze({
  ...tutorialRound,
  answer: tutorialRound.correctPattern,
  nearMiss: tutorialNearMiss,
});

export function describeFoldSequence(
  folds: readonly FoldDirection[],
  hideDirections = false,
): string {
  if (hideDirections) {
    return `${folds.length} folds are shown without direction arrows; infer each fold from the changing paper position`;
  }
  return folds
    .map((direction) => DIRECTION_LABELS[direction])
    .join(", then ");
}

export function describeHolePattern(pattern: HolePattern): string {
  const normalized = normalizePattern(pattern);
  const count = normalized.length;
  const positions = normalized
    .map(({ x, y }) => `row ${y + 1}, column ${x + 1}`)
    .join("; ");
  return `${count} ${
    count === 1 ? "opening" : "openings"
  } on the unfolded sheet at ${positions}`;
}

export const describePattern = describeHolePattern;

export function difficultyFoldCount(difficulty: Difficulty): number {
  return FOLD_COUNTS[difficulty];
}

export function difficultyPunchBounds(
  difficulty: Difficulty,
): Readonly<{ minimum: number; maximum: number }> {
  return PUNCH_COUNT_BOUNDS[difficulty];
}

export function oppositeFoldDirection(
  direction: FoldDirection,
): FoldDirection {
  return oppositeDirection(direction);
}

export const SHAPE_FOLD_PAPER_SIZE = PAPER_SIZE;
export const BOARD_SIZE = PAPER_SIZE;
