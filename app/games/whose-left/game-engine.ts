export type Difficulty = "Starter" | "Junior" | "Expert" | "Wizard";
export type Side = "left" | "right";
export type Direction = "north" | "east" | "south" | "west";
export type OptionKind =
  | "correct"
  | "opposite-side"
  | "reversed-order"
  | "one-person-off";

export type Point = Readonly<{
  x: number;
  y: number;
}>;

export type RouteSegment = Readonly<{
  index: number;
  from: Point;
  to: Point;
  direction: Direction;
  length: number;
}>;

export type Person = Readonly<{
  id: string;
  name: string;
  initial: string;
  segmentIndex: number;
  position: Point;
  side: Side;
}>;

export type ViewBox = Readonly<{
  minX: number;
  minY: number;
  width: number;
  height: number;
}>;

export type Route = Readonly<{
  points: readonly Point[];
  segments: readonly RouteSegment[];
  viewBox: ViewBox;
}>;

export type Scaffold = Readonly<{
  showIntermediateChevrons: boolean;
  directionCueSegmentIndexes: readonly number[];
}>;

export type AnswerSequence = readonly string[];

export type Round = Readonly<{
  id: string;
  difficulty: Difficulty;
  route: Route;
  people: readonly Person[];
  querySide: Side;
  options: readonly AnswerSequence[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
  correctSequence: AnswerSequence;
  scaffold: Scaffold;
}>;

export type DifficultyRule = Readonly<{
  segmentCount: number;
  peoplePerSide: number;
  minSegmentLength: number;
  maxSegmentLength: number;
  showIntermediateChevrons: boolean;
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  errors: readonly string[];
}>;

type PersonIdentity = (typeof PERSON_POOL)[number];

type AuthoredSpec = Readonly<{
  verticalSigns: string;
  lengths: readonly number[];
  quarterTurns: number;
  sides: string;
  querySide: Side;
  correctIndex: number;
  nameOffset: number;
  nearMissSalt: number;
  distractorRotation: number;
}>;

const EPSILON = 1e-9;
const LANDMARK_OFFSET = 2.5;
const LANDMARK_PATH_CLEARANCE = 2.4;
const LANDMARK_SEPARATION = 2;
const VIEWBOX_PADDING = 4;

export const GENERATOR_MAX_ATTEMPTS = 128;

export const DIFFICULTIES = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
] as const satisfies readonly Difficulty[];

export const DIFFICULTY_RULES: Readonly<Record<Difficulty, DifficultyRule>> = {
  Starter: {
    segmentCount: 4,
    peoplePerSide: 2,
    minSegmentLength: 8,
    maxSegmentLength: 12,
    showIntermediateChevrons: true,
  },
  Junior: {
    segmentCount: 6,
    peoplePerSide: 3,
    minSegmentLength: 8,
    maxSegmentLength: 12,
    showIntermediateChevrons: true,
  },
  Expert: {
    segmentCount: 8,
    peoplePerSide: 4,
    minSegmentLength: 8,
    maxSegmentLength: 12,
    showIntermediateChevrons: true,
  },
  Wizard: {
    segmentCount: 8,
    peoplePerSide: 4,
    minSegmentLength: 8,
    maxSegmentLength: 12,
    showIntermediateChevrons: false,
  },
};

const PERSON_POOL = [
  { id: "ari", name: "Ari", initial: "A" },
  { id: "bea", name: "Bea", initial: "B" },
  { id: "chen", name: "Chen", initial: "C" },
  { id: "dev", name: "Dev", initial: "D" },
  { id: "esme", name: "Esme", initial: "E" },
  { id: "finn", name: "Finn", initial: "F" },
  { id: "gia", name: "Gia", initial: "G" },
  { id: "hugo", name: "Hugo", initial: "H" },
  { id: "inez", name: "Inez", initial: "I" },
  { id: "jules", name: "Jules", initial: "J" },
  { id: "kian", name: "Kian", initial: "K" },
  { id: "luz", name: "Luz", initial: "L" },
  { id: "mina", name: "Mina", initial: "M" },
  { id: "noor", name: "Noor", initial: "N" },
  { id: "omar", name: "Omar", initial: "O" },
  { id: "pia", name: "Pia", initial: "P" },
  { id: "quinn", name: "Quinn", initial: "Q" },
  { id: "ravi", name: "Ravi", initial: "R" },
  { id: "sage", name: "Sage", initial: "S" },
  { id: "tali", name: "Tali", initial: "T" },
  { id: "uma", name: "Uma", initial: "U" },
  { id: "vik", name: "Vik", initial: "V" },
  { id: "wren", name: "Wren", initial: "W" },
  { id: "xavi", name: "Xavi", initial: "X" },
  { id: "yara", name: "Yara", initial: "Y" },
  { id: "zane", name: "Zane", initial: "Z" },
] as const;

const LENGTH_PATTERNS = [
  [8, 10, 8, 12, 10, 8, 12, 10],
  [10, 8, 12, 8, 10, 12, 8, 10],
  [12, 10, 8, 10, 8, 12, 10, 8],
  [8, 12, 10, 8, 12, 10, 8, 12],
  [10, 12, 8, 10, 8, 10, 12, 8],
  [12, 8, 10, 12, 10, 8, 10, 12],
  [8, 10, 12, 10, 12, 8, 10, 8],
  [10, 8, 10, 12, 8, 12, 8, 10],
  [12, 10, 12, 8, 10, 8, 12, 10],
  [8, 12, 8, 10, 12, 10, 8, 12],
  [10, 12, 10, 8, 10, 12, 10, 8],
  [12, 8, 12, 10, 8, 10, 12, 10],
] as const;

const VERTICAL_PATTERNS = [
  "-+-+",
  "+-+-",
  "-++-",
  "+--+",
  "-+--",
  "+-++",
  "-+++",
  "+---",
  "-+-+",
  "+-+-",
  "-++-",
  "+--+",
] as const;

const SIDE_PATTERNS: Readonly<Record<Difficulty, readonly string[]>> = {
  Starter: [
    "LRLR",
    "RLRL",
    "LLRR",
    "RRLL",
    "LRRL",
    "RLLR",
    "LRLR",
    "RLRL",
    "LLRR",
    "RRLL",
    "LRRL",
    "RLLR",
  ],
  Junior: [
    "LRLRLR",
    "RLRLRL",
    "LLRRLR",
    "RRLLRL",
    "LRRLLR",
    "RLLRRL",
    "LRLLRR",
    "RLRRLL",
    "LLRLRR",
    "RRLRLL",
    "LRRLRL",
    "RLLRLR",
  ],
  Expert: [
    "LRLRLRLR",
    "RLRLRLRL",
    "LLRRLLRR",
    "RRLLRRLL",
    "LRRLLRRL",
    "RLLRRLLR",
    "LRLLRRLR",
    "RLRRLLRL",
    "LLRLRRLR",
    "RRLRLLRL",
    "LRRLRLLR",
    "RLLRLRRL",
  ],
  Wizard: [
    "RLRLLRLR",
    "LRLRRLRL",
    "RRLLRLLR",
    "LLRRLRRL",
    "RLLRRLLR",
    "LRRLLRRL",
    "RLRRLLRL",
    "LRLLRRLR",
    "RRLRLLRL",
    "LLRLRRLR",
    "RLLRLRRL",
    "LRRLRLLR",
  ],
};

const ANSWER_POSITION_SCHEDULES: Readonly<
  Record<Difficulty, readonly number[]>
> = {
  Starter: [0, 1, 2, 3, 1, 0, 3, 2, 0, 2, 1, 3],
  Junior: [2, 0, 3, 1, 3, 2, 1, 0, 2, 1, 0, 3],
  Expert: [1, 3, 0, 2, 0, 1, 2, 3, 1, 2, 3, 0],
  Wizard: [3, 1, 2, 0, 2, 3, 0, 1, 3, 0, 1, 2],
};

function isDifficulty(value: string): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

function oppositeSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function rotatePoint(point: Point, quarterTurns: number): Point {
  const normalized = ((quarterTurns % 4) + 4) % 4;
  if (normalized === 1) return { x: -point.y, y: point.x };
  if (normalized === 2) return { x: -point.x, y: -point.y };
  if (normalized === 3) return { x: point.y, y: -point.x };
  return { ...point };
}

function pointKey(point: Point): string {
  return `${numberKey(point.x)},${numberKey(point.y)}`;
}

function numberKey(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function directionForPoints(from: Point, to: Point): Direction {
  if (Math.abs(from.x - to.x) < EPSILON) {
    if (to.y < from.y) return "north";
    if (to.y > from.y) return "south";
  }
  if (Math.abs(from.y - to.y) < EPSILON) {
    if (to.x > from.x) return "east";
    if (to.x < from.x) return "west";
  }
  throw new Error("Route segments must be non-zero and horizontal or vertical.");
}

function makeSegments(points: readonly Point[]): readonly RouteSegment[] {
  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    return {
      index,
      from,
      to,
      direction: directionForPoints(from, to),
      length: distance(from, to),
    };
  });
}

function buildMonotonePoints(
  lengths: readonly number[],
  verticalSigns: string,
  quarterTurns: number,
): readonly Point[] {
  const points: Point[] = [{ x: 0, y: 0 }];
  let verticalIndex = 0;

  for (const [segmentIndex, length] of lengths.entries()) {
    const previous = points[points.length - 1];
    const delta =
      segmentIndex % 2 === 0
        ? { x: length, y: 0 }
        : {
            x: 0,
            y: verticalSigns[verticalIndex++] === "+" ? length : -length,
          };
    points.push(add(previous, delta));
  }

  return points.map((point) => rotatePoint(point, quarterTurns));
}

function personPosition(segment: RouteSegment, side: Side): Point {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  const sideMultiplier = side === "left" ? 1 : -1;
  const leftNormal = { x: dy / length, y: -dx / length };
  return {
    x:
      (segment.from.x + segment.to.x) / 2 +
      leftNormal.x * LANDMARK_OFFSET * sideMultiplier,
    y:
      (segment.from.y + segment.to.y) / 2 +
      leftNormal.y * LANDMARK_OFFSET * sideMultiplier,
  };
}

function makeViewBox(
  points: readonly Point[],
  people: readonly Person[],
): ViewBox {
  const allPoints = [...points, ...people.map(({ position }) => position)];
  const xs = allPoints.map(({ x }) => x);
  const ys = allPoints.map(({ y }) => y);
  const minX = Math.min(...xs) - VIEWBOX_PADDING;
  const minY = Math.min(...ys) - VIEWBOX_PADDING;
  return {
    minX,
    minY,
    width: Math.max(...xs) - minX + VIEWBOX_PADDING,
    height: Math.max(...ys) - minY + VIEWBOX_PADDING,
  };
}

function sequenceKey(sequence: AnswerSequence): string {
  return sequence.join(">");
}

function identitiesFromOffset(
  count: number,
  offset: number,
): readonly PersonIdentity[] {
  return Array.from(
    { length: count },
    (_, index) => PERSON_POOL[(offset + index) % PERSON_POOL.length],
  );
}

function scaffoldForDifficulty(
  difficulty: Difficulty,
  segmentCount: number,
): Scaffold {
  const showIntermediateChevrons =
    DIFFICULTY_RULES[difficulty].showIntermediateChevrons;
  return {
    showIntermediateChevrons,
    directionCueSegmentIndexes: showIntermediateChevrons
      ? Array.from({ length: segmentCount }, (_, index) => index)
      : [0],
  };
}

function localNearMiss(
  people: readonly Person[],
  querySide: Side,
  salt: number,
): AnswerSequence {
  const targetPeople = people.filter(({ side }) => side === querySide);
  const otherPeople = people.filter(({ side }) => side !== querySide);
  const targetPosition = Math.abs(salt) % targetPeople.length;
  const target = targetPeople[targetPosition];
  const nearestOther = [...otherPeople].sort(
    (a, b) =>
      Math.abs(a.segmentIndex - target.segmentIndex) -
        Math.abs(b.segmentIndex - target.segmentIndex) ||
      a.segmentIndex - b.segmentIndex,
  )[0];
  const result = targetPeople.map(({ id }) => id);
  result[targetPosition] = nearestOther.id;
  return result;
}

function assembleOptions(
  people: readonly Person[],
  querySide: Side,
  correctIndex: number,
  nearMissSalt: number,
  distractorRotation: number,
): Readonly<{
  options: readonly AnswerSequence[];
  optionKinds: readonly OptionKind[];
  correctSequence: AnswerSequence;
}> {
  const correctSequence = people
    .filter(({ side }) => side === querySide)
    .map(({ id }) => id);
  const wrong = [
    {
      kind: "opposite-side" as const,
      sequence: people
        .filter(({ side }) => side === oppositeSide(querySide))
        .map(({ id }) => id),
    },
    {
      kind: "reversed-order" as const,
      sequence: [...correctSequence].reverse(),
    },
    {
      kind: "one-person-off" as const,
      sequence: localNearMiss(people, querySide, nearMissSalt),
    },
  ];
  const rotation = ((distractorRotation % wrong.length) + wrong.length) %
    wrong.length;
  const rotatedWrong = [...wrong.slice(rotation), ...wrong.slice(0, rotation)];
  const options: AnswerSequence[] = [];
  const optionKinds: OptionKind[] = [];
  let wrongIndex = 0;

  for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
    if (optionIndex === correctIndex) {
      options.push(correctSequence);
      optionKinds.push("correct");
    } else {
      options.push(rotatedWrong[wrongIndex].sequence);
      optionKinds.push(rotatedWrong[wrongIndex].kind);
      wrongIndex += 1;
    }
  }

  return { options, optionKinds, correctSequence };
}

function makeRound({
  id,
  difficulty,
  points,
  sides,
  querySide,
  identities,
  correctIndex,
  nearMissSalt,
  distractorRotation,
}: {
  id: string;
  difficulty: Difficulty;
  points: readonly Point[];
  sides: readonly Side[];
  querySide: Side;
  identities: readonly PersonIdentity[];
  correctIndex: number;
  nearMissSalt: number;
  distractorRotation: number;
}): Round {
  const segments = makeSegments(points);
  const people = segments.map((segment, segmentIndex) => {
    const identity = identities[segmentIndex];
    const side = sides[segmentIndex];
    return {
      ...identity,
      segmentIndex,
      position: personPosition(segment, side),
      side,
    };
  });
  const { options, optionKinds, correctSequence } = assembleOptions(
    people,
    querySide,
    correctIndex,
    nearMissSalt,
    distractorRotation,
  );
  const round: Round = {
    id,
    difficulty,
    route: {
      points,
      segments,
      viewBox: makeViewBox(points, people),
    },
    people,
    querySide,
    options,
    optionKinds,
    correctIndex,
    correctSequence,
    scaffold: scaffoldForDifficulty(difficulty, segments.length),
  };
  assertValidRound(round);
  return round;
}

function authoredSpec(
  difficulty: Difficulty,
  levelIndex: number,
  roundIndex: number,
): AuthoredSpec {
  const segmentCount = DIFFICULTY_RULES[difficulty].segmentCount;
  return {
    verticalSigns: VERTICAL_PATTERNS[roundIndex].slice(0, segmentCount / 2),
    lengths: LENGTH_PATTERNS[roundIndex].slice(0, segmentCount),
    quarterTurns: (roundIndex + levelIndex * 2) % 4,
    sides: SIDE_PATTERNS[difficulty][roundIndex],
    querySide: (roundIndex + levelIndex) % 2 === 0 ? "left" : "right",
    correctIndex: ANSWER_POSITION_SCHEDULES[difficulty][roundIndex],
    nameOffset: (levelIndex * 7 + roundIndex * 5) % PERSON_POOL.length,
    nearMissSalt: roundIndex + levelIndex,
    distractorRotation: roundIndex + levelIndex * 2,
  };
}

function buildAuthoredRound(
  difficulty: Difficulty,
  levelIndex: number,
  roundIndex: number,
): Round {
  const spec = authoredSpec(difficulty, levelIndex, roundIndex);
  const sides = [...spec.sides].map((side) =>
    side === "L" ? "left" : "right",
  );
  const points = buildMonotonePoints(
    spec.lengths,
    spec.verticalSigns,
    spec.quarterTurns,
  );
  return makeRound({
    id: `${difficulty.toLowerCase()}-${String(roundIndex + 1).padStart(2, "0")}`,
    difficulty,
    points,
    sides,
    querySide: spec.querySide,
    identities: identitiesFromOffset(spec.lengths.length, spec.nameOffset),
    correctIndex: spec.correctIndex,
    nearMissSalt: spec.nearMissSalt,
    distractorRotation: spec.distractorRotation,
  });
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: Point, segment: RouteSegment): boolean {
  return (
    Math.abs(orientation(segment.from, segment.to, point)) < EPSILON &&
    point.x >= Math.min(segment.from.x, segment.to.x) - EPSILON &&
    point.x <= Math.max(segment.from.x, segment.to.x) + EPSILON &&
    point.y >= Math.min(segment.from.y, segment.to.y) - EPSILON &&
    point.y <= Math.max(segment.from.y, segment.to.y) + EPSILON
  );
}

function segmentsIntersect(a: RouteSegment, b: RouteSegment): boolean {
  const o1 = orientation(a.from, a.to, b.from);
  const o2 = orientation(a.from, a.to, b.to);
  const o3 = orientation(b.from, b.to, a.from);
  const o4 = orientation(b.from, b.to, a.to);

  if (
    ((o1 > EPSILON && o2 < -EPSILON) ||
      (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) ||
      (o3 < -EPSILON && o4 > EPSILON))
  ) {
    return true;
  }

  return (
    (Math.abs(o1) < EPSILON && pointOnSegment(b.from, a)) ||
    (Math.abs(o2) < EPSILON && pointOnSegment(b.to, a)) ||
    (Math.abs(o3) < EPSILON && pointOnSegment(a.from, b)) ||
    (Math.abs(o4) < EPSILON && pointOnSegment(a.to, b))
  );
}

function distanceToSegment(point: Point, segment: RouteSegment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength < EPSILON) return distance(point, segment.from);
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.from.x) * dx +
        (point.y - segment.from.y) * dy) /
        squaredLength,
    ),
  );
  return distance(point, {
    x: segment.from.x + projection * dx,
    y: segment.from.y + projection * dy,
  });
}

/** Returns the visual left/right side in screen coordinates (positive y down). */
export function relativeSideOfSegment(
  segment: RouteSegment,
  point: Point,
): Side | "on-path" {
  const cross = orientation(segment.from, segment.to, point);
  if (Math.abs(cross) < EPSILON) return "on-path";
  return cross < 0 ? "left" : "right";
}

/** Calculates the answer from route geometry rather than trusting option labels. */
export function peopleOnSide(
  round: Pick<Round, "route" | "people">,
  side: Side,
): readonly Person[] {
  return [...round.people]
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .filter((person) => {
      const segment = round.route.segments[person.segmentIndex];
      return (
        segment !== undefined &&
        relativeSideOfSegment(segment, person.position) === side
      );
    });
}

/** Calculates the queried people in encounter order. */
export function correctSequenceForRound(
  round: Pick<Round, "route" | "people" | "querySide">,
): AnswerSequence {
  return peopleOnSide(round, round.querySide).map(({ id }) => id);
}

/** Checks route geometry without consulting answer metadata. */
export function validateRoute(route: Route): ValidationResult {
  const errors: string[] = [];
  if (route.points.length < 2) errors.push("Route needs at least two points.");
  if (route.segments.length !== route.points.length - 1) {
    errors.push("Route segment count must be one less than point count.");
  }

  for (const [index, segment] of route.segments.entries()) {
    if (segment.index !== index) errors.push(`Segment ${index} has wrong index.`);
    if (
      !samePoint(segment.from, route.points[index]) ||
      !samePoint(segment.to, route.points[index + 1])
    ) {
      errors.push(`Segment ${index} does not match its route points.`);
    }
    try {
      const direction = directionForPoints(segment.from, segment.to);
      if (direction !== segment.direction) {
        errors.push(`Segment ${index} has the wrong direction.`);
      }
      if (Math.abs(distance(segment.from, segment.to) - segment.length) > EPSILON) {
        errors.push(`Segment ${index} has the wrong length.`);
      }
    } catch {
      errors.push(`Segment ${index} is not a non-zero orthogonal segment.`);
    }
  }

  for (let index = 1; index < route.segments.length; index += 1) {
    const previous = route.segments[index - 1];
    const current = route.segments[index];
    const previousHorizontal = previous.from.y === previous.to.y;
    const currentHorizontal = current.from.y === current.to.y;
    if (previousHorizontal === currentHorizontal) {
      errors.push(`Segments ${index - 1} and ${index} must meet at a turn.`);
    }
  }

  for (let first = 0; first < route.segments.length; first += 1) {
    for (let second = first + 2; second < route.segments.length; second += 1) {
      if (segmentsIntersect(route.segments[first], route.segments[second])) {
        errors.push(`Segments ${first} and ${second} self-intersect.`);
      }
    }
  }

  const { viewBox } = route;
  if (
    !Number.isFinite(viewBox.minX) ||
    !Number.isFinite(viewBox.minY) ||
    !Number.isFinite(viewBox.width) ||
    !Number.isFinite(viewBox.height) ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) {
    errors.push("Route viewBox must be finite and positive.");
  }

  return { valid: errors.length === 0, errors };
}

/** Validates geometry, progression rules, uniqueness, and all four answers. */
export function validateRound(round: Round): ValidationResult {
  const errors = [...validateRoute(round.route).errors];
  if (!isDifficulty(round.difficulty)) {
    errors.push(`Unknown difficulty: ${round.difficulty}.`);
    return { valid: false, errors };
  }

  const rules = DIFFICULTY_RULES[round.difficulty];
  if (round.route.segments.length !== rules.segmentCount) {
    errors.push(`${round.difficulty} must have ${rules.segmentCount} segments.`);
  }
  for (const segment of round.route.segments) {
    if (
      segment.length < rules.minSegmentLength ||
      segment.length > rules.maxSegmentLength
    ) {
      errors.push(`Segment ${segment.index} is outside the difficulty length range.`);
    }
  }
  if (round.people.length !== rules.segmentCount) {
    errors.push("There must be exactly one person for every route segment.");
  }

  for (const field of ["id", "name", "initial"] as const) {
    if (new Set(round.people.map((person) => person[field])).size !== round.people.length) {
      errors.push(`Every person must have a distinct ${field}.`);
    }
  }

  const segmentIndexes = round.people
    .map(({ segmentIndex }) => segmentIndex)
    .sort((a, b) => a - b);
  if (
    sequenceKey(segmentIndexes.map(String)) !==
    sequenceKey(Array.from({ length: rules.segmentCount }, (_, index) => String(index)))
  ) {
    errors.push("People must occupy successive route segments exactly once.");
  }

  for (const person of round.people) {
    const segment = round.route.segments[person.segmentIndex];
    if (!segment) {
      errors.push(`${person.name} refers to a missing route segment.`);
      continue;
    }
    const derivedSide = relativeSideOfSegment(segment, person.position);
    if (derivedSide !== person.side) {
      errors.push(`${person.name}'s stored side does not match the geometry.`);
    }
    const nearestPathDistance = Math.min(
      ...round.route.segments.map((candidate) =>
        distanceToSegment(person.position, candidate),
      ),
    );
    if (nearestPathDistance < LANDMARK_PATH_CLEARANCE - EPSILON) {
      errors.push(`${person.name} collides with the route.`);
    }
    if (!pointOnSegment(person.position, {
      ...segment,
      from: {
        x: segment.from.x + (segment.to.x - segment.from.x) * 0.2,
        y: segment.from.y + (segment.to.y - segment.from.y) * 0.2,
      },
      to: {
        x: segment.from.x + (segment.to.x - segment.from.x) * 0.8,
        y: segment.from.y + (segment.to.y - segment.from.y) * 0.8,
      },
    })) {
      const dx = segment.to.x - segment.from.x;
      const dy = segment.to.y - segment.from.y;
      const squaredLength = dx * dx + dy * dy;
      const projection =
        ((person.position.x - segment.from.x) * dx +
          (person.position.y - segment.from.y) * dy) /
        squaredLength;
      if (projection < 0.2 - EPSILON || projection > 0.8 + EPSILON) {
        errors.push(`${person.name} is too close to a route corner.`);
      }
    }
  }

  for (let first = 0; first < round.people.length; first += 1) {
    for (let second = first + 1; second < round.people.length; second += 1) {
      if (
        distance(
          round.people[first].position,
          round.people[second].position,
        ) < LANDMARK_SEPARATION - EPSILON
      ) {
        errors.push(
          `${round.people[first].name} and ${round.people[second].name} overlap.`,
        );
      }
    }
  }

  const left = peopleOnSide(round, "left");
  const right = peopleOnSide(round, "right");
  if (
    left.length !== rules.peoplePerSide ||
    right.length !== rules.peoplePerSide
  ) {
    errors.push(
      `The route must place ${rules.peoplePerSide} people on each side.`,
    );
  }

  const expectedSequence = correctSequenceForRound(round);
  if (sequenceKey(round.correctSequence) !== sequenceKey(expectedSequence)) {
    errors.push("Stored correct sequence does not match route geometry.");
  }
  if (round.options.length !== 4 || round.optionKinds.length !== 4) {
    errors.push("A round must have four options and four option kinds.");
  }
  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex > 3
  ) {
    errors.push("Correct index must be an answer position from 0 to 3.");
  }
  if (new Set(round.options.map(sequenceKey)).size !== 4) {
    errors.push("All answer sequences must be distinct.");
  }
  const exactAnswerIndexes = round.options.flatMap((option, index) =>
    sequenceKey(option) === sequenceKey(expectedSequence) ? [index] : [],
  );
  if (
    exactAnswerIndexes.length !== 1 ||
    exactAnswerIndexes[0] !== round.correctIndex
  ) {
    errors.push("Exactly one option must equal the calculated answer.");
  }
  if (round.optionKinds[round.correctIndex] !== "correct") {
    errors.push("Correct option must carry the correct kind.");
  }
  if (new Set(round.optionKinds).size !== 4) {
    errors.push("Every misconception kind must appear exactly once.");
  }

  const oppositeSequence = peopleOnSide(round, oppositeSide(round.querySide)).map(
    ({ id }) => id,
  );
  const reverseSequence = [...expectedSequence].reverse();
  for (const [index, kind] of round.optionKinds.entries()) {
    const option = round.options[index];
    if (
      kind === "opposite-side" &&
      sequenceKey(option) !== sequenceKey(oppositeSequence)
    ) {
      errors.push("Opposite-side option does not follow the other side.");
    }
    if (
      kind === "reversed-order" &&
      sequenceKey(option) !== sequenceKey(reverseSequence)
    ) {
      errors.push("Reversed-order option is not the exact reverse.");
    }
    if (kind === "one-person-off") {
      const differenceIndexes = option.flatMap((personId, personIndex) =>
        personId !== expectedSequence[personIndex] ? [personIndex] : [],
      );
      const expectedIds = new Set(expectedSequence);
      if (
        option.length !== expectedSequence.length ||
        differenceIndexes.length !== 1 ||
        option.filter((personId) => expectedIds.has(personId)).length !==
          expectedSequence.length - 1
      ) {
        errors.push("One-person-off option must be a single local substitution.");
      } else {
        const differenceIndex = differenceIndexes[0];
        const target = round.people.find(
          ({ id }) => id === expectedSequence[differenceIndex],
        );
        const replacement = round.people.find(
          ({ id }) => id === option[differenceIndex],
        );
        const nearestOtherDistance = target
          ? Math.min(
              ...round.people
                .filter(({ side }) => side !== round.querySide)
                .map(({ segmentIndex }) =>
                  Math.abs(segmentIndex - target.segmentIndex),
                ),
            )
          : Number.POSITIVE_INFINITY;
        if (
          !target ||
          !replacement ||
          replacement.side === round.querySide ||
          Math.abs(replacement.segmentIndex - target.segmentIndex) !==
            nearestOtherDistance
        ) {
          errors.push(
            "One-person-off option must substitute the nearest person from the other side.",
          );
        }
      }
    }
  }

  const expectedScaffold = scaffoldForDifficulty(
    round.difficulty,
    rules.segmentCount,
  );
  if (
    round.scaffold.showIntermediateChevrons !==
      expectedScaffold.showIntermediateChevrons ||
    sequenceKey(round.scaffold.directionCueSegmentIndexes.map(String)) !==
      sequenceKey(expectedScaffold.directionCueSegmentIndexes.map(String))
  ) {
    errors.push("Direction scaffold does not match the difficulty.");
  }

  const visiblePoints = [
    ...round.route.points,
    ...round.people.map(({ position }) => position),
  ];
  const { minX, minY, width, height } = round.route.viewBox;
  if (
    visiblePoints.some(
      ({ x, y }) =>
        x < minX - EPSILON ||
        x > minX + width + EPSILON ||
        y < minY - EPSILON ||
        y > minY + height + EPSILON,
    )
  ) {
    errors.push("Route viewBox must contain every point and person.");
  }

  return { valid: errors.length === 0, errors };
}

/** Throws one actionable error when a round violates an engine invariant. */
export function assertValidRound(round: Round): void {
  const validation = validateRound(round);
  if (!validation.valid) {
    throw new Error(`Invalid Whose Left? round: ${validation.errors.join(" ")}`);
  }
}

/** Identifies the visual clue and question without depending on answer order. */
export function roundFingerprint(round: Round): string {
  const origin = round.route.points[0];
  const relativePoint = (point: Point) =>
    pointKey({ x: point.x - origin.x, y: point.y - origin.y });
  const path = round.route.points.map(relativePoint).join(";");
  const people = [...round.people]
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .map(
      (person) =>
        `${person.id}@${person.segmentIndex}:${relativePoint(person.position)}`,
    )
    .join(";");
  const cues = round.scaffold.directionCueSegmentIndexes.join(",");
  return `path=${path}|people=${people}|ask=${round.querySide}|cues=${cues}`;
}

/** Validates the complete deterministic Campaign and answer-position sequence. */
export function validateCampaign(rounds: readonly Round[]): ValidationResult {
  const errors: string[] = [];
  if (rounds.length !== 48) errors.push("Campaign must contain 48 rounds.");

  for (const [roundIndex, round] of rounds.entries()) {
    for (const error of validateRound(round).errors) {
      errors.push(`Round ${roundIndex + 1}: ${error}`);
    }
  }

  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    errors.push("Every Campaign fingerprint must be unique.");
  }

  for (const difficulty of DIFFICULTIES) {
    const levelRounds = rounds.filter((round) => round.difficulty === difficulty);
    if (levelRounds.length !== 12) {
      errors.push(`${difficulty} must contain 12 rounds.`);
      continue;
    }
    const positions = levelRounds.map(({ correctIndex }) => correctIndex);
    const counts = [0, 1, 2, 3].map(
      (position) => positions.filter((value) => value === position).length,
    );
    if (counts.some((count) => count !== 3)) {
      errors.push(`${difficulty} answer positions must balance 3/3/3/3.`);
    }
    if (positions.some((position, index) => index > 0 && position === positions[index - 1])) {
      errors.push(`${difficulty} cannot repeat adjacent answer positions.`);
    }
    if (positions.slice(4).every((position, index) => position === positions[index])) {
      errors.push(`${difficulty} cannot repeat one four-position cycle.`);
    }
  }

  const expectedOrder = DIFFICULTIES.flatMap((difficulty) =>
    Array(12).fill(difficulty),
  );
  if (
    sequenceKey(rounds.map(({ difficulty }) => difficulty)) !==
    sequenceKey(expectedOrder)
  ) {
    errors.push("Campaign levels must be stored in progression order.");
  }

  return { valid: errors.length === 0, errors };
}

/** Builds the frozen, authored 48-round learning path without randomness. */
export function buildCampaignRounds(): readonly Round[] {
  const rounds = DIFFICULTIES.flatMap((difficulty, levelIndex) =>
    Array.from({ length: 12 }, (_, roundIndex) =>
      buildAuthoredRound(difficulty, levelIndex, roundIndex),
    ),
  );
  const validation = validateCampaign(rounds);
  if (!validation.valid) {
    throw new Error(`Invalid Whose Left? Campaign: ${validation.errors.join(" ")}`);
  }
  return deepFreeze(rounds);
}

function randomValue(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a finite value from 0 up to 1.");
  }
  return value;
}

function randomInteger(random: () => number, exclusiveMaximum: number): number {
  return Math.floor(randomValue(random) * exclusiveMaximum);
}

function samplePeople(
  count: number,
  random: () => number,
): readonly PersonIdentity[] {
  const available = [...PERSON_POOL];
  for (let index = 0; index < count; index += 1) {
    const selected =
      index + randomInteger(random, available.length - index);
    [available[index], available[selected]] = [
      available[selected],
      available[index],
    ];
  }
  return available.slice(0, count);
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

/** Makes a small deterministic PRNG for repeatable sessions and tests. */
export function makeSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * Generates one validated round. Pass prior fingerprints to prevent repeats
 * in an Infinite session; bounded exhaustion throws for the UI to recover.
 */
export function generateInfiniteRound(
  difficulty: Difficulty,
  random: () => number = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  if (!isDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }
  const rules = DIFFICULTY_RULES[difficulty];

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const quarterTurns = randomInteger(random, 4);
    const lengths = Array.from(
      { length: rules.segmentCount },
      () => 8 + randomInteger(random, 3) * 2,
    );
    const verticalSigns = Array.from(
      { length: rules.segmentCount / 2 },
      () => (randomValue(random) < 0.5 ? "-" : "+"),
    ).join("");
    const sides = Array.from(
      { length: rules.segmentCount },
      () => (randomValue(random) < 0.5 ? "left" : "right") as Side,
    );

    if (
      !verticalSigns.includes("-") ||
      !verticalSigns.includes("+") ||
      sides.filter((side) => side === "left").length !== rules.peoplePerSide
    ) {
      continue;
    }

    const querySide: Side = randomValue(random) < 0.5 ? "left" : "right";
    const correctIndex = randomInteger(random, 4);
    const nearMissSalt = randomInteger(random, 1_000_000);
    const distractorRotation = randomInteger(random, 3);
    const points = buildMonotonePoints(
      lengths,
      verticalSigns,
      quarterTurns,
    );
    let round: Round;
    try {
      round = makeRound({
        id: "infinite-candidate",
        difficulty,
        points,
        sides,
        querySide,
        identities: samplePeople(rules.segmentCount, random),
        correctIndex,
        nearMissSalt,
        distractorRotation,
      });
    } catch {
      continue;
    }

    const fingerprint = roundFingerprint(round);
    if (excludedFingerprints.has(fingerprint)) continue;
    round = { ...round, id: `infinite-${stableHash(fingerprint)}` };
    return deepFreeze(round);
  }

  throw new Error(
    `Unable to generate a valid ${difficulty} round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

export const CAMPAIGN_ROUNDS = buildCampaignRounds();

const examplePoints = buildMonotonePoints([10, 8, 10, 8], "-+", 0);
const exampleRound = makeRound({
  id: "whose-left-example",
  difficulty: "Starter",
  points: examplePoints,
  sides: ["left", "right", "right", "left"],
  querySide: "left",
  identities: identitiesFromOffset(4, 22),
  correctIndex: 0,
  nearMissSalt: 1,
  distractorRotation: 0,
});

/** Solved visual example plus one explicit opposite-side misconception. */
export const EXAMPLE = deepFreeze({
  round: exampleRound,
  answer: exampleRound.correctSequence,
  nearMatch:
    exampleRound.options[
      exampleRound.optionKinds.indexOf("opposite-side")
    ],
});

/** Plain prompt copy; answer semantics remain encoded by querySide. */
export function questionForRound(round: Pick<Round, "querySide">): string {
  return `Who do you pass on your ${round.querySide}, in order?`;
}

/** Converts a sequence of stable person IDs into its visible names. */
export function namesForSequence(
  round: Pick<Round, "people">,
  sequence: AnswerSequence,
): readonly string[] {
  const names = new Map(round.people.map(({ id, name }) => [id, name]));
  return sequence.map((id) => names.get(id) ?? id);
}
