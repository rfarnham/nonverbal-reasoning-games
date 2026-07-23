import {
  braceletClassKey,
  type BraceletRound,
} from "./game-engine.ts";

export const TANGLE_LAYOUT_IDS = ["figure-eight", "labyrinth"] as const;

export type TangleLayoutId = (typeof TANGLE_LAYOUT_IDS)[number];
export type BraceletPresentation = "circle" | TangleLayoutId;

type Point = Readonly<{
  x: number;
  y: number;
}>;

type CubicSegment = readonly [Point, Point, Point, Point];

export type TangledBeadSlot = Readonly<
  Point & {
    braceletIndex: number;
  }
>;

export type TangledBraceletLayout = Readonly<{
  id: TangleLayoutId;
  viewBox: string;
  strandPath: string;
  overpassPaths: readonly string[];
  beadSlots: readonly TangledBeadSlot[];
  cycleEdges: readonly (readonly [number, number])[];
}>;

function cycleEdgesForSlots(
  beadSlots: readonly TangledBeadSlot[],
): readonly (readonly [number, number])[] {
  return beadSlots.map(
    ({ braceletIndex }) =>
      [braceletIndex, (braceletIndex + 1) % beadSlots.length] as const,
  );
}

function cubicPoint(
  [start, firstControl, secondControl, end]: CubicSegment,
  time: number,
): Point {
  const inverse = 1 - time;
  const startWeight = inverse ** 3;
  const firstControlWeight = 3 * inverse ** 2 * time;
  const secondControlWeight = 3 * inverse * time ** 2;
  const endWeight = time ** 3;
  return {
    x:
      startWeight * start.x +
      firstControlWeight * firstControl.x +
      secondControlWeight * secondControl.x +
      endWeight * end.x,
    y:
      startWeight * start.y +
      firstControlWeight * firstControl.y +
      secondControlWeight * secondControl.y +
      endWeight * end.y,
  };
}

const FIGURE_EIGHT_SEGMENTS: readonly CubicSegment[] = [
  [
    { x: 180, y: 150 },
    { x: 222, y: 74 },
    { x: 330, y: 71 },
    { x: 330, y: 150 },
  ],
  [
    { x: 330, y: 150 },
    { x: 330, y: 229 },
    { x: 222, y: 226 },
    { x: 180, y: 150 },
  ],
  [
    { x: 180, y: 150 },
    { x: 138, y: 74 },
    { x: 30, y: 71 },
    { x: 30, y: 150 },
  ],
  [
    { x: 30, y: 150 },
    { x: 30, y: 229 },
    { x: 138, y: 226 },
    { x: 180, y: 150 },
  ],
] as const;

const figureEightBeadTimes = [0.18, 0.5, 0.82] as const;
const figureEightBeadSlots: readonly TangledBeadSlot[] =
  FIGURE_EIGHT_SEGMENTS.flatMap((segment, segmentIndex) =>
    figureEightBeadTimes.map((time, timeIndex) => ({
      braceletIndex:
        segmentIndex * figureEightBeadTimes.length + timeIndex,
      ...cubicPoint(segment, time),
    })),
  );
const figureEightStrandPath = [
  `M ${FIGURE_EIGHT_SEGMENTS[0][0].x} ${FIGURE_EIGHT_SEGMENTS[0][0].y}`,
  ...FIGURE_EIGHT_SEGMENTS.map(
    ([, firstControl, secondControl, end]) =>
      `C ${firstControl.x} ${firstControl.y} ${secondControl.x} ${secondControl.y} ${end.x} ${end.y}`,
  ),
  "Z",
].join(" ");

const FIGURE_EIGHT_LAYOUT: TangledBraceletLayout = {
  id: "figure-eight",
  viewBox: "0 50 360 200",
  strandPath: figureEightStrandPath,
  overpassPaths: [
    "M 151 202 C 162 183 172 162 180 150 C 188 138 198 117 209 98",
  ],
  beadSlots: figureEightBeadSlots,
  cycleEdges: cycleEdgesForSlots(figureEightBeadSlots),
};

function labyrinthPoint(turn: number): Point {
  const angle = turn * Math.PI * 2;
  return {
    x: 180 + 145 * Math.sin(angle * 2),
    y: 150 + 85 * Math.sin(angle * 3),
  };
}

function pointCommand(point: Point): string {
  return `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
}

function sampledClosedPath(
  pointAt: (turn: number) => Point,
  sampleCount: number,
): string {
  const points = Array.from({ length: sampleCount }, (_, index) =>
    pointAt(index / sampleCount),
  );
  return [
    `M ${pointCommand(points[0])}`,
    ...points.slice(1).map((point) => `L ${pointCommand(point)}`),
    "Z",
  ].join(" ");
}

function sampledOpenPath(
  pointAt: (turn: number) => Point,
  centerTurn: number,
  halfSpan: number,
  sampleCount: number,
): string {
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    return pointAt(centerTurn - halfSpan + progress * halfSpan * 2);
  });
  return [
    `M ${pointCommand(points[0])}`,
    ...points.slice(1).map((point) => `L ${pointCommand(point)}`),
  ].join(" ");
}

const LABYRINTH_CROSSING_BRANCHES = [
  0,
  1 / 6,
  7 / 24,
  11 / 24,
  13 / 24,
  17 / 24,
  5 / 6,
] as const;
const labyrinthPathStart = 1 / 48;
const labyrinthBeadSlots: readonly TangledBeadSlot[] = Array.from(
  { length: 12 },
  (_, braceletIndex) => ({
    braceletIndex,
    ...labyrinthPoint(labyrinthPathStart + braceletIndex / 12),
  }),
);

const LABYRINTH_LAYOUT: TangledBraceletLayout = {
  id: "labyrinth",
  viewBox: "0 50 360 200",
  strandPath: sampledClosedPath(
    (turn) => labyrinthPoint(labyrinthPathStart + turn),
    192,
  ),
  overpassPaths: LABYRINTH_CROSSING_BRANCHES.map((centerTurn) =>
    sampledOpenPath(labyrinthPoint, centerTurn, 0.008, 9),
  ),
  beadSlots: labyrinthBeadSlots,
  cycleEdges: cycleEdgesForSlots(labyrinthBeadSlots),
};

export const TANGLED_BRACELET_LAYOUTS: Readonly<
  Record<TangleLayoutId, TangledBraceletLayout>
> = {
  "figure-eight": FIGURE_EIGHT_LAYOUT,
  labyrinth: LABYRINTH_LAYOUT,
};

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function braceletPresentationForRound(
  round: Pick<BraceletRound, "bracelet" | "difficulty">,
): BraceletPresentation {
  if (round.difficulty === "Easy" || round.difficulty === "Medium") {
    return "circle";
  }

  const layoutIndex =
    (stableHash(braceletClassKey(round.bracelet)) >>> 16) %
    TANGLE_LAYOUT_IDS.length;
  return TANGLE_LAYOUT_IDS[layoutIndex];
}

export function tangledLayoutForPresentation(
  presentation: BraceletPresentation,
): TangledBraceletLayout | null {
  return presentation === "circle"
    ? null
    : TANGLED_BRACELET_LAYOUTS[presentation];
}
