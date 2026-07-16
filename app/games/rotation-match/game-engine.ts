export type TileColor = "empty" | "coral" | "gold" | "teal" | "violet";
export type TileMotif = "none" | "cap";
export type Orientation = 0 | 1 | 2 | 3;

export type Tile = {
  color: TileColor;
  motif: TileMotif;
  orientation: Orientation;
};

export type Pattern = readonly Tile[];
export type Difficulty = "Easy" | "Medium" | "Hard";
export type RotationDirection = "clockwise" | "counterclockwise";
export type MirrorAxis =
  | "vertical"
  | "horizontal"
  | "main-diagonal"
  | "anti-diagonal";

export type RotationTransform = {
  kind: "rotation";
  direction: RotationDirection;
  quarterTurns: 1 | 2 | 3;
  degrees: 90 | 180 | 270;
  angleDegrees: number;
};

export type ReflectionTransform = {
  kind: "reflection";
  axis: MirrorAxis;
};

export type PuzzleTransform = RotationTransform | ReflectionTransform;

export type DistractorKind =
  | "wrong-rotation"
  | "mirror-vertical"
  | "mirror-horizontal"
  | "mirror-main-diagonal"
  | "mirror-anti-diagonal"
  | "one-block-off"
  | "one-motif-off";

export type OptionKind = "correct" | DistractorKind;

export type Round = {
  clue: Pattern;
  options: readonly Pattern[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
  correctPattern: Pattern;
  transform: PuzzleTransform;
  difficulty: Difficulty;
  turn: string;
};

type RoundSpecBase = {
  pattern: string;
  motifs?: ReadonlyArray<{
    index: number;
    orientation: Orientation;
  }>;
  difficulty: Difficulty;
  correctIndex: number;
  distractors: readonly [DistractorKind, DistractorKind, DistractorKind];
};

type RoundSpec = RoundSpecBase &
  (
    | {
        direction: RotationDirection;
        quarterTurns: 1 | 2 | 3;
        axis?: never;
      }
    | {
        axis: MirrorAxis;
        direction?: never;
        quarterTurns?: never;
      }
  );

const COLOR_NAMES: Record<TileColor, string> = {
  empty: "empty",
  coral: "coral",
  gold: "gold",
  teal: "teal",
  violet: "violet",
};

const TILE_CODES: Record<string, TileColor> = {
  ".": "empty",
  C: "coral",
  G: "gold",
  T: "teal",
  V: "violet",
};

const POSITIONS = [
  "top left",
  "top middle",
  "top right",
  "middle left",
  "center",
  "middle right",
  "bottom left",
  "bottom middle",
  "bottom right",
] as const;

const ORIENTATION_NAMES = ["up", "right", "down", "left"] as const;

const MIRROR_AXIS_NAMES: Record<MirrorAxis, string> = {
  vertical: "vertical",
  horizontal: "horizontal",
  "main-diagonal": "diagonal down-right",
  "anti-diagonal": "diagonal up-right",
};

const ROUND_SPECS: readonly RoundSpec[] = [
  {
    pattern: "CT..G...V",
    direction: "clockwise",
    quarterTurns: 1,
    difficulty: "Easy",
    correctIndex: 2,
    distractors: ["wrong-rotation", "one-block-off", "mirror-vertical"],
  },
  {
    pattern: "C...T.GV.",
    direction: "counterclockwise",
    quarterTurns: 1,
    difficulty: "Easy",
    correctIndex: 0,
    distractors: ["wrong-rotation", "one-block-off", "mirror-horizontal"],
  },
  {
    pattern: ".GCT...VT",
    direction: "clockwise",
    quarterTurns: 2,
    difficulty: "Easy",
    correctIndex: 3,
    distractors: ["wrong-rotation", "mirror-vertical", "one-block-off"],
  },
  {
    pattern: "T.G.CVG..",
    direction: "counterclockwise",
    quarterTurns: 3,
    difficulty: "Easy",
    correctIndex: 1,
    distractors: ["mirror-vertical", "mirror-horizontal", "one-block-off"],
  },
  {
    pattern: "C.VT.G.CT",
    axis: "vertical",
    difficulty: "Medium",
    correctIndex: 2,
    distractors: [
      "mirror-horizontal",
      "mirror-main-diagonal",
      "one-block-off",
    ],
  },
  {
    pattern: ".TGC.VG.C",
    axis: "horizontal",
    difficulty: "Medium",
    correctIndex: 1,
    distractors: ["mirror-vertical", "mirror-anti-diagonal", "one-block-off"],
  },
  {
    pattern: "T.G.CVG..",
    axis: "main-diagonal",
    difficulty: "Medium",
    correctIndex: 3,
    distractors: ["mirror-anti-diagonal", "mirror-vertical", "one-block-off"],
  },
  {
    pattern: ".GCT...VT",
    axis: "anti-diagonal",
    difficulty: "Medium",
    correctIndex: 0,
    distractors: ["mirror-main-diagonal", "mirror-horizontal", "one-block-off"],
  },
  {
    pattern: "G.CVT..CG",
    motifs: [
      { index: 0, orientation: 0 },
      { index: 3, orientation: 1 },
      { index: 8, orientation: 3 },
    ],
    direction: "clockwise",
    quarterTurns: 2,
    difficulty: "Hard",
    correctIndex: 3,
    distractors: [
      "mirror-horizontal",
      "mirror-main-diagonal",
      "one-motif-off",
    ],
  },
  {
    pattern: "VGT..C.GT",
    motifs: [
      { index: 0, orientation: 2 },
      { index: 2, orientation: 0 },
      { index: 5, orientation: 3 },
      { index: 8, orientation: 1 },
    ],
    direction: "counterclockwise",
    quarterTurns: 1,
    difficulty: "Hard",
    correctIndex: 0,
    distractors: [
      "mirror-vertical",
      "mirror-anti-diagonal",
      "one-motif-off",
    ],
  },
  {
    pattern: "CV..GTT.C",
    motifs: [
      { index: 1, orientation: 0 },
      { index: 5, orientation: 2 },
      { index: 8, orientation: 1 },
    ],
    axis: "vertical",
    difficulty: "Hard",
    correctIndex: 2,
    distractors: [
      "mirror-horizontal",
      "mirror-main-diagonal",
      "one-motif-off",
    ],
  },
  {
    pattern: "T.CG.VC..",
    motifs: [
      { index: 0, orientation: 1 },
      { index: 3, orientation: 3 },
      { index: 5, orientation: 0 },
      { index: 6, orientation: 2 },
    ],
    axis: "anti-diagonal",
    difficulty: "Hard",
    correctIndex: 1,
    distractors: [
      "mirror-vertical",
      "mirror-main-diagonal",
      "one-motif-off",
    ],
  },
] as const;

function normalizeOrientation(value: number): Orientation {
  return (((value % 4) + 4) % 4) as Orientation;
}

function tile(color: TileColor, motif: TileMotif = "none", orientation = 0): Tile {
  if (color === "empty") {
    return { color, motif: "none", orientation: 0 };
  }

  return {
    color,
    motif,
    orientation: normalizeOrientation(orientation),
  };
}

function clonePattern(pattern: Pattern): Tile[] {
  return pattern.map((item) => ({ ...item }));
}

function decodePattern(
  encoded: string,
  motifs: RoundSpec["motifs"] = [],
): Pattern {
  const pattern = [...encoded].map((code) => tile(TILE_CODES[code]));

  if (
    pattern.length !== 9 ||
    pattern.some((item) => item.color === undefined)
  ) {
    throw new Error(`Invalid 3x3 pattern: ${encoded}`);
  }

  for (const motif of motifs) {
    const current = pattern[motif.index];
    if (!current || current.color === "empty") {
      throw new Error(`Motif must point to a filled tile: ${motif.index}`);
    }
    pattern[motif.index] = tile(current.color, "cap", motif.orientation);
  }

  return pattern;
}

export function makeRotationTransform(
  direction: RotationDirection,
  quarterTurns: 1 | 2 | 3,
): RotationTransform {
  const degrees = (quarterTurns * 90) as 90 | 180 | 270;
  return {
    kind: "rotation",
    direction,
    quarterTurns,
    degrees,
    angleDegrees: direction === "clockwise" ? degrees : -degrees,
  };
}

export function makeReflectionTransform(axis: MirrorAxis): ReflectionTransform {
  return { kind: "reflection", axis };
}

export function rotatePattern(pattern: Pattern, quarterTurns: number): Pattern {
  let result = clonePattern(pattern);
  const normalizedTurns = normalizeOrientation(quarterTurns);

  for (let turnIndex = 0; turnIndex < normalizedTurns; turnIndex += 1) {
    const rotated = Array.from({ length: 9 }, () => tile("empty"));

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const source = result[row * 3 + column];
        rotated[column * 3 + (2 - row)] = tile(
          source.color,
          source.motif,
          source.motif === "none" ? 0 : source.orientation + 1,
        );
      }
    }

    result = rotated;
  }

  return result;
}

function reflectOrientation(
  orientation: Orientation,
  axis: MirrorAxis,
): Orientation {
  switch (axis) {
    case "vertical":
      return normalizeOrientation(-orientation);
    case "horizontal":
      return normalizeOrientation(2 - orientation);
    case "main-diagonal":
      return normalizeOrientation(3 - orientation);
    case "anti-diagonal":
      return normalizeOrientation(1 - orientation);
  }
}

export function reflectPattern(pattern: Pattern, axis: MirrorAxis): Pattern {
  const reflected = Array.from({ length: 9 }, () => tile("empty"));

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const source = pattern[row * 3 + column];
      let targetRow = row;
      let targetColumn = column;

      switch (axis) {
        case "vertical":
          targetColumn = 2 - column;
          break;
        case "horizontal":
          targetRow = 2 - row;
          break;
        case "main-diagonal":
          targetRow = column;
          targetColumn = row;
          break;
        case "anti-diagonal":
          targetRow = 2 - column;
          targetColumn = 2 - row;
          break;
      }

      reflected[targetRow * 3 + targetColumn] = tile(
        source.color,
        source.motif,
        source.motif === "none"
          ? 0
          : reflectOrientation(source.orientation, axis),
      );
    }
  }

  return reflected;
}

export function applyRotation(
  pattern: Pattern,
  transform: RotationTransform,
): Pattern {
  const signedTurns =
    transform.direction === "clockwise"
      ? transform.quarterTurns
      : -transform.quarterTurns;
  return rotatePattern(pattern, signedTurns);
}

export function applyTransform(
  pattern: Pattern,
  transform: PuzzleTransform,
): Pattern {
  return transform.kind === "rotation"
    ? applyRotation(pattern, transform)
    : reflectPattern(pattern, transform.axis);
}

function moveOneBlock(pattern: Pattern, salt: number): Pattern {
  const result = clonePattern(pattern);
  const filled = result.flatMap((item, index) =>
    item.color === "empty" ? [] : [index],
  );
  const empty = result.flatMap((item, index) =>
    item.color === "empty" ? [index] : [],
  );

  const from = filled[salt % filled.length];
  const to = empty[(salt * 2 + 1) % empty.length];
  result[to] = { ...result[from] };
  result[from] = tile("empty");
  return result;
}

function turnOneMotif(pattern: Pattern, salt: number): Pattern {
  const result = clonePattern(pattern);
  const motifIndexes = result.flatMap((item, index) =>
    item.motif === "cap" ? [index] : [],
  );

  if (motifIndexes.length === 0) {
    return moveOneBlock(pattern, salt);
  }

  const index = motifIndexes[salt % motifIndexes.length];
  const current = result[index];
  result[index] = tile(current.color, current.motif, current.orientation + 1);
  return result;
}

function mirrorAxisFor(kind: DistractorKind): MirrorAxis | null {
  switch (kind) {
    case "mirror-vertical":
      return "vertical";
    case "mirror-horizontal":
      return "horizontal";
    case "mirror-main-diagonal":
      return "main-diagonal";
    case "mirror-anti-diagonal":
      return "anti-diagonal";
    default:
      return null;
  }
}

function makeDistractor(
  kind: DistractorKind,
  clue: Pattern,
  correct: Pattern,
  transform: PuzzleTransform,
  salt: number,
): Pattern {
  const mirrorAxis = mirrorAxisFor(kind);
  if (mirrorAxis) return reflectPattern(clue, mirrorAxis);

  if (kind === "one-block-off") return moveOneBlock(correct, salt);
  if (kind === "one-motif-off") return turnOneMotif(correct, salt);

  if (transform.kind === "rotation") {
    const signedTurns =
      transform.direction === "clockwise"
        ? transform.quarterTurns
        : -transform.quarterTurns;
    return rotatePattern(clue, signedTurns + 1);
  }

  return rotatePattern(clue, (salt % 3) + 1);
}

export function patternKey(pattern: Pattern): string {
  return pattern
    .map((item) => `${item.color}:${item.motif}:${item.orientation}`)
    .join("|");
}

export function isRotationOf(candidate: Pattern, clue: Pattern): boolean {
  const candidateKey = patternKey(candidate);
  return [0, 1, 2, 3].some(
    (turns) => patternKey(rotatePattern(clue, turns)) === candidateKey,
  );
}

export function buildRounds(): readonly Round[] {
  return ROUND_SPECS.map((spec, roundIndex) => {
    const clue = decodePattern(spec.pattern, spec.motifs);
    const transform =
      spec.axis === undefined
        ? makeRotationTransform(spec.direction, spec.quarterTurns)
        : makeReflectionTransform(spec.axis);
    const correctPattern = applyTransform(clue, transform);
    const distractors = spec.distractors.map((kind, distractorIndex) => ({
      kind,
      pattern: makeDistractor(
        kind,
        clue,
        correctPattern,
        transform,
        roundIndex + distractorIndex,
      ),
    }));
    const options = distractors.map(({ pattern }) => pattern);
    const optionKinds: OptionKind[] = distractors.map(({ kind }) => kind);
    options.splice(spec.correctIndex, 0, correctPattern);
    optionKinds.splice(spec.correctIndex, 0, "correct");

    const uniqueOptions = new Set(options.map(patternKey));
    if (uniqueOptions.size !== 4) {
      throw new Error(`Round ${roundIndex + 1} has duplicate answer options.`);
    }

    return {
      clue,
      options,
      optionKinds,
      correctIndex: spec.correctIndex,
      correctPattern,
      transform,
      difficulty: spec.difficulty,
      turn:
        transform.kind === "rotation"
          ? `${transform.degrees}° ${transform.direction}`
          : `${MIRROR_AXIS_NAMES[transform.axis]} flip`,
    };
  });
}

export const ROUNDS = buildRounds();

const tutorialTransform = makeRotationTransform("clockwise", 1);
const tutorialClue = decodePattern("C.T..G.V.");

export const TUTORIAL = {
  clue: tutorialClue,
  transform: tutorialTransform,
  answer: applyRotation(tutorialClue, tutorialTransform),
  mirror: reflectPattern(
    applyRotation(tutorialClue, tutorialTransform),
    "vertical",
  ),
} as const;

export function describePattern(pattern: Pattern): string {
  return pattern
    .flatMap((item, index) => {
      if (item.color === "empty") return [];
      const motif =
        item.motif === "cap"
          ? ` with mark facing ${ORIENTATION_NAMES[item.orientation]}`
          : "";
      return [`${COLOR_NAMES[item.color]}${motif} at ${POSITIONS[index]}`];
    })
    .join(", ");
}
