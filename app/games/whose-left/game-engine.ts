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

export type RouteCrossing = Readonly<{
  point: Point;
  underSegmentIndex: number;
  overSegmentIndex: number;
}>;

export type Person = Readonly<{
  id: string;
  name: string;
  initial: string;
  segmentIndex: number;
  position: Point;
  side: Side;
}>;

export type LandmarkLink = Readonly<{
  person: Person;
  anchor: Point;
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
  minCrossings: number;
  maxCrossings: number;
  minHeadingReversals: number;
  showIntermediateChevrons: boolean;
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  errors: readonly string[];
}>;

type PersonIdentity = (typeof PERSON_POOL)[number];

type RouteTemplate = Readonly<{
  id: string;
  turns: string;
  lengths: readonly number[];
}>;

type AuthoredSpec = Readonly<{
  template: RouteTemplate;
  quarterTurns: number;
  reflected: boolean;
  sides: string;
  querySide: Side;
  correctIndex: number;
  nameOffset: number;
  nearMissSalt: number;
  distractorRotation: number;
}>;

const EPSILON = 1e-9;
const LANDMARK_OFFSET = 2.75;
const LANDMARK_PATH_CLEARANCE = 2.4;
const LANDMARK_SEPARATION = 3.7;
const ENDPOINT_LANDMARK_SEPARATION = 3.5;
const CROSSING_CORNER_CLEARANCE = 3;
const CROSSING_SEPARATION = 5;
const VIEWBOX_PADDING = 5;

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
    minCrossings: 0,
    maxCrossings: 0,
    minHeadingReversals: 0,
    showIntermediateChevrons: true,
  },
  Junior: {
    segmentCount: 6,
    peoplePerSide: 3,
    minSegmentLength: 8,
    maxSegmentLength: 16,
    minCrossings: 0,
    maxCrossings: 1,
    minHeadingReversals: 1,
    showIntermediateChevrons: true,
  },
  Expert: {
    segmentCount: 8,
    peoplePerSide: 4,
    minSegmentLength: 8,
    maxSegmentLength: 18,
    minCrossings: 1,
    maxCrossings: 2,
    minHeadingReversals: 2,
    showIntermediateChevrons: true,
  },
  Wizard: {
    segmentCount: 8,
    peoplePerSide: 4,
    minSegmentLength: 8,
    maxSegmentLength: 18,
    minCrossings: 1,
    maxCrossings: 2,
    minHeadingReversals: 2,
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

const STARTER_ROUTE_TEMPLATES = [
  { id: "starter-bends-1", turns: "LRL", lengths: [8, 10, 8, 10] },
  { id: "starter-bends-2", turns: "RLR", lengths: [10, 8, 10, 12] },
  { id: "starter-bends-3", turns: "LRL", lengths: [12, 8, 10, 8] },
  { id: "starter-bends-4", turns: "RLR", lengths: [8, 12, 10, 10] },
  { id: "starter-hairpin-1", turns: "LLR", lengths: [8, 10, 8, 12] },
  { id: "starter-hairpin-2", turns: "RRL", lengths: [10, 8, 8, 10] },
  { id: "starter-hairpin-3", turns: "LLR", lengths: [12, 10, 8, 8] },
  { id: "starter-hairpin-4", turns: "RRL", lengths: [8, 12, 10, 8] },
  { id: "starter-open-loop-1", turns: "LLL", lengths: [12, 12, 8, 8] },
  { id: "starter-open-loop-2", turns: "RRR", lengths: [12, 12, 8, 10] },
  { id: "starter-open-loop-3", turns: "LLL", lengths: [12, 10, 8, 8] },
  { id: "starter-open-loop-4", turns: "RRR", lengths: [10, 12, 8, 8] },
] as const satisfies readonly RouteTemplate[];

const JUNIOR_ROUTE_TEMPLATES = [
  { id: "junior-wind-1", turns: "LLRLR", lengths: [8, 8, 8, 8, 8, 8] },
  { id: "junior-wind-2", turns: "RRLRL", lengths: [8, 10, 8, 8, 8, 10] },
  { id: "junior-wind-3", turns: "LLRLL", lengths: [8, 8, 8, 8, 8, 8] },
  { id: "junior-wind-4", turns: "RRLRR", lengths: [10, 8, 8, 8, 10, 8] },
  {
    id: "junior-cross-1",
    turns: "LLLRL",
    lengths: [16, 10, 10, 16, 10, 10],
  },
  {
    id: "junior-cross-2",
    turns: "RRRLR",
    lengths: [16, 10, 10, 16, 10, 12],
  },
  {
    id: "junior-cross-3",
    turns: "LLLRL",
    lengths: [16, 12, 10, 16, 10, 10],
  },
  {
    id: "junior-cross-4",
    turns: "RRRLR",
    lengths: [16, 12, 10, 16, 10, 12],
  },
  {
    id: "junior-loop-1",
    turns: "LLLRR",
    lengths: [16, 10, 10, 16, 10, 10],
  },
  {
    id: "junior-loop-2",
    turns: "RRRLL",
    lengths: [16, 10, 10, 16, 10, 12],
  },
  {
    id: "junior-loop-3",
    turns: "LLLRR",
    lengths: [16, 12, 10, 16, 10, 10],
  },
  {
    id: "junior-loop-4",
    turns: "RRRLL",
    lengths: [16, 12, 10, 16, 10, 12],
  },
] as const satisfies readonly RouteTemplate[];

const EXPERT_ROUTE_TEMPLATES = [
  {
    id: "expert-cross-1",
    turns: "LLLRLRL",
    lengths: [12, 8, 8, 12, 8, 8, 8, 8],
  },
  {
    id: "expert-cross-2",
    turns: "RRRLRLR",
    lengths: [12, 8, 8, 12, 8, 8, 8, 10],
  },
  {
    id: "expert-cross-3",
    turns: "LLLRLLL",
    lengths: [8, 8, 10, 10, 12, 8, 8, 12],
  },
  {
    id: "expert-cross-4",
    turns: "RRRLRRR",
    lengths: [8, 8, 10, 10, 12, 8, 8, 12],
  },
  {
    id: "expert-double-1",
    turns: "LRRRLRR",
    lengths: [10, 14, 12, 10, 16, 16, 10, 10],
  },
  {
    id: "expert-double-2",
    turns: "RLLLRLL",
    lengths: [10, 14, 12, 10, 16, 16, 10, 12],
  },
  {
    id: "expert-double-3",
    turns: "LRRRLRR",
    lengths: [10, 14, 12, 10, 16, 16, 10, 14],
  },
  {
    id: "expert-double-4",
    turns: "RLLLRLL",
    lengths: [10, 14, 12, 10, 16, 16, 10, 16],
  },
  {
    id: "expert-double-5",
    turns: "LRRRLRR",
    lengths: [10, 14, 12, 10, 16, 16, 10, 18],
  },
  {
    id: "expert-double-6",
    turns: "RLLLRLL",
    lengths: [10, 14, 12, 10, 16, 16, 12, 10],
  },
  {
    id: "expert-double-7",
    turns: "LRRRLRR",
    lengths: [10, 14, 12, 10, 16, 16, 12, 12],
  },
  {
    id: "expert-double-8",
    turns: "RLLLRLL",
    lengths: [10, 14, 12, 10, 16, 16, 12, 14],
  },
] as const satisfies readonly RouteTemplate[];

const ROUTE_TEMPLATES: Readonly<
  Record<Difficulty, readonly RouteTemplate[]>
> = {
  Starter: STARTER_ROUTE_TEMPLATES,
  Junior: JUNIOR_ROUTE_TEMPLATES,
  Expert: EXPERT_ROUTE_TEMPLATES,
  Wizard: EXPERT_ROUTE_TEMPLATES,
};

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

function buildTemplatePoints(
  template: RouteTemplate,
  quarterTurns: number,
  reflected: boolean,
): readonly Point[] {
  const points: Point[] = [{ x: 0, y: 0 }];
  const vectors = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ] as const;
  let directionIndex = 0;

  if (template.turns.length !== template.lengths.length - 1) {
    throw new Error(`${template.id} needs one turn between every route segment.`);
  }

  for (const [segmentIndex, length] of template.lengths.entries()) {
    if (segmentIndex > 0) {
      const turn = template.turns[segmentIndex - 1];
      if (turn !== "L" && turn !== "R") {
        throw new Error(`${template.id} contains an unknown turn.`);
      }
      directionIndex =
        (directionIndex + (turn === "R" ? 1 : 3)) % vectors.length;
    }
    const previous = points[points.length - 1];
    const vector = vectors[directionIndex];
    const delta = { x: vector.x * length, y: vector.y * length };
    points.push(add(previous, delta));
  }

  return points.map((point) =>
    rotatePoint(reflected ? { x: -point.x, y: point.y } : point, quarterTurns),
  );
}

function positionBesideSegment(
  segment: RouteSegment,
  side: Side,
  progress: number,
): Point {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  const sideMultiplier = side === "left" ? 1 : -1;
  const leftNormal = { x: dy / length, y: -dx / length };
  return {
    x:
      segment.from.x +
      dx * progress +
      leftNormal.x * LANDMARK_OFFSET * sideMultiplier,
    y:
      segment.from.y +
      dy * progress +
      leftNormal.y * LANDMARK_OFFSET * sideMultiplier,
  };
}

function personPositionCandidates(
  segment: RouteSegment,
  side: Side,
  allSegments: readonly RouteSegment[],
  routeEndpoints: readonly Point[],
): readonly Point[] {
  const progressSlots =
    segment.index % 2 === 0
      ? [0.3, 0.5, 0.7, 0.4, 0.6]
      : [0.7, 0.5, 0.3, 0.6, 0.4];

  return progressSlots.flatMap((progress) => {
    const position = positionBesideSegment(segment, side, progress);
    const clearsEveryPath = allSegments.every(
      (candidate) =>
        distanceToSegment(position, candidate) >=
        LANDMARK_PATH_CLEARANCE - EPSILON,
    );
    const clearsEndpoints = routeEndpoints.every(
      (endpoint) =>
        distance(position, endpoint) >=
        ENDPOINT_LANDMARK_SEPARATION - EPSILON,
    );
    return clearsEveryPath && clearsEndpoints ? [position] : [];
  });
}

function placePeople(
  segments: readonly RouteSegment[],
  sides: readonly Side[],
  identities: readonly PersonIdentity[],
  routeEndpoints: readonly Point[],
): readonly Person[] {
  const placed: Person[] = [];

  function place(segmentIndex: number): boolean {
    if (segmentIndex === segments.length) return true;
    const segment = segments[segmentIndex];
    const side = sides[segmentIndex];
    const identity = identities[segmentIndex];
    for (const position of personPositionCandidates(
      segment,
      side,
      segments,
      routeEndpoints,
    )) {
      if (
        placed.some(
          (person) =>
            distance(position, person.position) <
            LANDMARK_SEPARATION - EPSILON,
        )
      ) {
        continue;
      }
      placed.push({ ...identity, segmentIndex, position, side });
      if (place(segmentIndex + 1)) return true;
      placed.pop();
    }
    return false;
  }

  if (!place(0)) {
    throw new Error("No collision-free arrangement exists for the landmarks.");
  }
  return placed;
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
  const routeEndpoints = [points[0], points[points.length - 1]];
  const people = placePeople(segments, sides, identities, routeEndpoints);
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
  return {
    template: ROUTE_TEMPLATES[difficulty][roundIndex],
    quarterTurns: (roundIndex + levelIndex * 2) % 4,
    reflected: (roundIndex + levelIndex) % 3 === 1,
    sides: SIDE_PATTERNS[difficulty][roundIndex],
    querySide: (roundIndex + levelIndex) % 2 === 0 ? "left" : "right",
    correctIndex: ANSWER_POSITION_SCHEDULES[difficulty][roundIndex],
    nameOffset: (levelIndex * 7 + roundIndex * 5) % PERSON_POOL.length,
    nearMissSalt: roundIndex + levelIndex,
    distractorRotation: roundIndex + levelIndex * 2,
  };
}

function balancedSideAssignments(
  segmentCount: number,
  leftCount: number,
): readonly (readonly Side[])[] {
  const assignments: Side[][] = [];

  function build(index: number, remainingLeft: number, sides: Side[]): void {
    if (index === segmentCount) {
      if (remainingLeft === 0) assignments.push([...sides]);
      return;
    }
    const remainingSlots = segmentCount - index;
    if (remainingLeft > 0) {
      sides.push("left");
      build(index + 1, remainingLeft - 1, sides);
      sides.pop();
    }
    if (remainingSlots > remainingLeft) {
      sides.push("right");
      build(index + 1, remainingLeft, sides);
      sides.pop();
    }
  }

  build(0, leftCount, []);
  return assignments;
}

function buildAuthoredRound(
  difficulty: Difficulty,
  levelIndex: number,
  roundIndex: number,
): Round {
  const spec = authoredSpec(difficulty, levelIndex, roundIndex);
  const preferredSides = [...spec.sides].map((side) =>
    side === "L" ? "left" : "right",
  );
  const points = buildTemplatePoints(
    spec.template,
    spec.quarterTurns,
    spec.reflected,
  );
  const sideCandidates = [
    ...balancedSideAssignments(
      spec.template.lengths.length,
      DIFFICULTY_RULES[difficulty].peoplePerSide,
    ),
  ].sort((first, second) => {
    const firstDifference = first.filter(
      (side, index) => side !== preferredSides[index],
    ).length;
    const secondDifference = second.filter(
      (side, index) => side !== preferredSides[index],
    ).length;
    const firstKey = first.join("");
    const secondKey = second.join("");
    return (
      firstDifference - secondDifference ||
      (firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0)
    );
  });
  let lastError: unknown;

  for (const sides of sideCandidates) {
    try {
      return makeRound({
        id: `${difficulty.toLowerCase()}-${String(roundIndex + 1).padStart(2, "0")}`,
        difficulty,
        points,
        sides,
        querySide: spec.querySide,
        identities: identitiesFromOffset(
          spec.template.lengths.length,
          spec.nameOffset,
        ),
        correctIndex: spec.correctIndex,
        nearMissSalt: spec.nearMissSalt,
        distractorRotation: spec.distractorRotation,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to build ${difficulty} problem ${roundIndex + 1} from ${
      spec.template.id
    }: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

type SegmentContact =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "proper-crossing"; point: Point }>
  | Readonly<{ kind: "endpoint-touch"; point: Point }>
  | Readonly<{ kind: "overlap" }>;

function isHorizontal(segment: RouteSegment): boolean {
  return Math.abs(segment.from.y - segment.to.y) < EPSILON;
}

function liesBetween(value: number, first: number, second: number): boolean {
  return (
    value >= Math.min(first, second) - EPSILON &&
    value <= Math.max(first, second) + EPSILON
  );
}

function liesStrictlyBetween(
  value: number,
  first: number,
  second: number,
): boolean {
  return (
    value > Math.min(first, second) + EPSILON &&
    value < Math.max(first, second) - EPSILON
  );
}

function classifySegmentContact(
  first: RouteSegment,
  second: RouteSegment,
): SegmentContact {
  const firstHorizontal = isHorizontal(first);
  const secondHorizontal = isHorizontal(second);

  if (firstHorizontal !== secondHorizontal) {
    const horizontal = firstHorizontal ? first : second;
    const vertical = firstHorizontal ? second : first;
    const point = { x: vertical.from.x, y: horizontal.from.y };
    if (
      !liesBetween(point.x, horizontal.from.x, horizontal.to.x) ||
      !liesBetween(point.y, vertical.from.y, vertical.to.y)
    ) {
      return { kind: "none" };
    }
    if (
      liesStrictlyBetween(point.x, horizontal.from.x, horizontal.to.x) &&
      liesStrictlyBetween(point.y, vertical.from.y, vertical.to.y)
    ) {
      return { kind: "proper-crossing", point };
    }
    return { kind: "endpoint-touch", point };
  }

  const fixedCoordinateMatches = firstHorizontal
    ? Math.abs(first.from.y - second.from.y) < EPSILON
    : Math.abs(first.from.x - second.from.x) < EPSILON;
  if (!fixedCoordinateMatches) return { kind: "none" };

  const firstStart = firstHorizontal ? first.from.x : first.from.y;
  const firstEnd = firstHorizontal ? first.to.x : first.to.y;
  const secondStart = firstHorizontal ? second.from.x : second.from.y;
  const secondEnd = firstHorizontal ? second.to.x : second.to.y;
  const overlapStart = Math.max(
    Math.min(firstStart, firstEnd),
    Math.min(secondStart, secondEnd),
  );
  const overlapEnd = Math.min(
    Math.max(firstStart, firstEnd),
    Math.max(secondStart, secondEnd),
  );
  if (overlapStart > overlapEnd + EPSILON) return { kind: "none" };
  if (Math.abs(overlapStart - overlapEnd) < EPSILON) {
    return {
      kind: "endpoint-touch",
      point: firstHorizontal
        ? { x: overlapStart, y: first.from.y }
        : { x: first.from.x, y: overlapStart },
    };
  }
  return { kind: "overlap" };
}

/** Finds unambiguous interior crossings; the later strand is drawn on top. */
export function routeCrossings(
  route: Pick<Route, "segments">,
): readonly RouteCrossing[] {
  const crossings: RouteCrossing[] = [];
  for (let first = 0; first < route.segments.length; first += 1) {
    for (let second = first + 2; second < route.segments.length; second += 1) {
      const contact = classifySegmentContact(
        route.segments[first],
        route.segments[second],
      );
      if (contact.kind === "proper-crossing") {
        crossings.push({
          point: contact.point,
          underSegmentIndex: first,
          overSegmentIndex: second,
        });
      }
    }
  }
  return crossings;
}

function routeTurnSequence(route: Pick<Route, "segments">): string {
  const directionIndexes: Readonly<Record<Direction, number>> = {
    east: 0,
    south: 1,
    west: 2,
    north: 3,
  };
  let turns = "";
  for (let index = 1; index < route.segments.length; index += 1) {
    const previous = directionIndexes[route.segments[index - 1].direction];
    const current = directionIndexes[route.segments[index].direction];
    const difference = (current - previous + 4) % 4;
    if (difference === 1) turns += "R";
    if (difference === 3) turns += "L";
  }
  return turns;
}

/** Summarizes the structural winding used by curriculum and corpus tests. */
export function routeTopology(route: Pick<Route, "segments">): Readonly<{
  crossingCount: number;
  headingReversals: number;
  longestWinding: number;
  turnSequence: string;
}> {
  const turnSequence = routeTurnSequence(route);
  let headingReversals = 0;
  let longestWinding = 0;
  let currentRun = 0;
  let previousTurn = "";

  for (const turn of turnSequence) {
    if (turn === previousTurn) {
      headingReversals += 1;
      currentRun += 1;
    } else {
      currentRun = 1;
      previousTurn = turn;
    }
    longestWinding = Math.max(longestWinding, currentRun);
  }

  return {
    crossingCount: routeCrossings(route).length,
    headingReversals,
    longestWinding,
    turnSequence,
  };
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

/** Connects every landmark to its exact perpendicular anchor on the route. */
export function landmarkLinksForRound(
  round: Pick<Round, "route" | "people">,
): readonly LandmarkLink[] {
  return round.people.map((person) => {
    const segment = round.route.segments[person.segmentIndex];
    if (!segment) {
      throw new Error(
        `Cannot link ${person.id}: route section ${person.segmentIndex} is missing.`,
      );
    }
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength < EPSILON) {
      throw new Error(
        `Cannot link ${person.id}: route section ${person.segmentIndex} has no length.`,
      );
    }
    const projection = Math.max(
      0,
      Math.min(
        1,
        ((person.position.x - segment.from.x) * dx +
          (person.position.y - segment.from.y) * dy) /
          squaredLength,
      ),
    );
    return {
      person,
      anchor: {
        x: segment.from.x + dx * projection,
        y: segment.from.y + dy * projection,
      },
    };
  });
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

  const crossings: RouteCrossing[] = [];
  for (let first = 0; first < route.segments.length; first += 1) {
    for (let second = first + 2; second < route.segments.length; second += 1) {
      const contact = classifySegmentContact(
        route.segments[first],
        route.segments[second],
      );
      if (contact.kind === "endpoint-touch") {
        errors.push(
          `Segments ${first} and ${second} meet at an ambiguous nonadjacent endpoint.`,
        );
      }
      if (contact.kind === "overlap") {
        errors.push(`Segments ${first} and ${second} overlap.`);
      }
      if (contact.kind === "proper-crossing") {
        const endpointClearance = Math.min(
          distance(contact.point, route.segments[first].from),
          distance(contact.point, route.segments[first].to),
          distance(contact.point, route.segments[second].from),
          distance(contact.point, route.segments[second].to),
        );
        if (endpointClearance < CROSSING_CORNER_CLEARANCE - EPSILON) {
          errors.push(
            `Crossing between segments ${first} and ${second} is too close to a corner.`,
          );
        }
        crossings.push({
          point: contact.point,
          underSegmentIndex: first,
          overSegmentIndex: second,
        });
      }
    }
  }

  for (let first = 0; first < crossings.length; first += 1) {
    for (let second = first + 1; second < crossings.length; second += 1) {
      if (samePoint(crossings[first].point, crossings[second].point)) {
        errors.push("Three or more strands cannot share one crossing point.");
      } else if (
        distance(crossings[first].point, crossings[second].point) <
        CROSSING_SEPARATION - EPSILON
      ) {
        errors.push("Route crossings are too close together.");
      }
    }
  }

  const crossingUses = new Map<number, number>();
  for (const crossing of crossings) {
    for (const segmentIndex of [
      crossing.underSegmentIndex,
      crossing.overSegmentIndex,
    ]) {
      crossingUses.set(segmentIndex, (crossingUses.get(segmentIndex) ?? 0) + 1);
    }
  }
  for (const [segmentIndex, count] of crossingUses) {
    if (count > 1) {
      errors.push(`Segment ${segmentIndex} passes through too many crossings.`);
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
  const topology = routeTopology(round.route);
  if (
    topology.crossingCount < rules.minCrossings ||
    topology.crossingCount > rules.maxCrossings
  ) {
    errors.push(
      `${round.difficulty} must have ${rules.minCrossings}–${rules.maxCrossings} proper crossings.`,
    );
  }
  if (topology.headingReversals < rules.minHeadingReversals) {
    errors.push(
      `${round.difficulty} needs at least ${rules.minHeadingReversals} winding reversals.`,
    );
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
    const start = round.route.points[0];
    const finish = round.route.points[round.route.points.length - 1];
    if (
      distance(person.position, start) <
        ENDPOINT_LANDMARK_SEPARATION - EPSILON ||
      distance(person.position, finish) <
        ENDPOINT_LANDMARK_SEPARATION - EPSILON
    ) {
      errors.push(`${person.name} is too close to Start or Finish.`);
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

    const topologies = levelRounds.map(({ route }) => routeTopology(route));
    const crossingCounts = topologies.map(({ crossingCount }) => crossingCount);
    if (
      difficulty === "Starter" &&
      (crossingCounts.some((count) => count !== 0) ||
        topologies.slice(0, 4).some(({ headingReversals }) => headingReversals !== 0) ||
        topologies.slice(4, 8).some(({ headingReversals }) => headingReversals < 1) ||
        topologies.slice(8).some(({ headingReversals }) => headingReversals < 2))
    ) {
      errors.push(
        "Starter must progress from simple bends to hairpins and open loops without crossings.",
      );
    }
    if (
      difficulty === "Junior" &&
      (crossingCounts.slice(0, 4).some((count) => count !== 0) ||
        crossingCounts.slice(4).some((count) => count !== 1) ||
        topologies.slice(0, 4).some(({ headingReversals }) => headingReversals < 1) ||
        topologies.slice(4, 8).some(({ headingReversals }) => headingReversals < 2) ||
        topologies.slice(8).some(({ headingReversals }) => headingReversals < 3))
    ) {
      errors.push(
        "Junior must teach broad windings before one-crossing loops.",
      );
    }
    if (
      (difficulty === "Expert" || difficulty === "Wizard") &&
      (crossingCounts.slice(0, 4).some((count) => count !== 1) ||
        crossingCounts.slice(4).some((count) => count !== 2))
    ) {
      errors.push(
        `${difficulty} must progress from one crossing to two crossings.`,
      );
    }
  }

  const expertTopology = rounds
    .filter(({ difficulty }) => difficulty === "Expert")
    .map(({ route }) => routeTopology(route).crossingCount);
  const wizardTopology = rounds
    .filter(({ difficulty }) => difficulty === "Wizard")
    .map(({ route }) => routeTopology(route).crossingCount);
  if (sequenceKey(expertTopology.map(String)) !== sequenceKey(wizardTopology.map(String))) {
    errors.push("Wizard must match Expert route density and remove only its scaffold.");
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

function sampleBalancedSides(
  rules: DifficultyRule,
  random: () => number,
): readonly Side[] {
  const sides: Side[] = [
    ...Array<Side>(rules.peoplePerSide).fill("left"),
    ...Array<Side>(rules.peoplePerSide).fill("right"),
  ];
  for (let index = 0; index < sides.length; index += 1) {
    const selected = index + randomInteger(random, sides.length - index);
    [sides[index], sides[selected]] = [sides[selected], sides[index]];
  }
  return sides;
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
  const templates = ROUTE_TEMPLATES[difficulty];

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const template = templates[randomInteger(random, templates.length)];
    const quarterTurns = randomInteger(random, 4);
    const reflected = randomValue(random) < 0.5;
    const sides = sampleBalancedSides(rules, random);
    const querySide: Side = randomValue(random) < 0.5 ? "left" : "right";
    const correctIndex = randomInteger(random, 4);
    const nearMissSalt = randomInteger(random, 1_000_000);
    const distractorRotation = randomInteger(random, 3);
    const points = buildTemplatePoints(
      template,
      quarterTurns,
      reflected,
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

const examplePoints = buildTemplatePoints(STARTER_ROUTE_TEMPLATES[0], 0, false);
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
