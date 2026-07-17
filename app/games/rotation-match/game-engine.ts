export type TileColor = "empty" | "coral" | "gold" | "teal" | "violet";
export type TileMotif = "none" | "cap";
export type Orientation = 0 | 1 | 2 | 3;

export type Tile = {
  color: TileColor;
  motif: TileMotif;
  orientation: Orientation;
};

export type Pattern = readonly Tile[];
export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
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

const FILLED_COLORS: readonly Exclude<TileColor, "empty">[] = [
  "coral",
  "gold",
  "teal",
  "violet",
];

const MIRROR_DISTRACTORS: readonly DistractorKind[] = [
  "mirror-vertical",
  "mirror-horizontal",
  "mirror-main-diagonal",
  "mirror-anti-diagonal",
];

const GENERATED_DIFFICULTY_RULES: Record<
  Difficulty,
  {
    minFilled: number;
    maxFilled: number;
    minMotifs: number;
    maxMotifs: number;
  }
> = {
  Easy: { minFilled: 3, maxFilled: 4, minMotifs: 0, maxMotifs: 0 },
  Medium: { minFilled: 5, maxFilled: 6, minMotifs: 0, maxMotifs: 0 },
  Hard: { minFilled: 6, maxFilled: 7, minMotifs: 2, maxMotifs: 4 },
  Wizard: { minFilled: 7, maxFilled: 8, minMotifs: 4, maxMotifs: 6 },
};

export const GENERATOR_MAX_ATTEMPTS = 128;

const ROUND_SPECS: readonly RoundSpec[] = [
  // Easy: sparse, flat-color patterns introduce every transform family.
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
    pattern: "V.C...T.G",
    axis: "vertical",
    difficulty: "Easy",
    correctIndex: 2,
    distractors: [
      "mirror-horizontal",
      "mirror-main-diagonal",
      "one-block-off",
    ],
  },
  {
    pattern: ".CG...V.T",
    axis: "horizontal",
    difficulty: "Easy",
    correctIndex: 1,
    distractors: ["mirror-vertical", "mirror-anti-diagonal", "one-block-off"],
  },
  {
    pattern: "G..T.C..V",
    axis: "main-diagonal",
    difficulty: "Easy",
    correctIndex: 3,
    distractors: ["mirror-anti-diagonal", "mirror-vertical", "one-block-off"],
  },
  {
    pattern: "..VCT.G..",
    axis: "anti-diagonal",
    difficulty: "Easy",
    correctIndex: 0,
    distractors: ["mirror-main-diagonal", "mirror-horizontal", "one-block-off"],
  },
  {
    pattern: "C.G..VT..",
    direction: "clockwise",
    quarterTurns: 3,
    difficulty: "Easy",
    correctIndex: 1,
    distractors: ["wrong-rotation", "mirror-main-diagonal", "one-block-off"],
  },
  {
    pattern: ".T.C...GV",
    direction: "counterclockwise",
    quarterTurns: 2,
    difficulty: "Easy",
    correctIndex: 3,
    distractors: ["wrong-rotation", "mirror-vertical", "one-block-off"],
  },
  {
    pattern: "GV...C.T.",
    direction: "clockwise",
    quarterTurns: 1,
    difficulty: "Easy",
    correctIndex: 0,
    distractors: ["wrong-rotation", "mirror-horizontal", "one-block-off"],
  },
  {
    pattern: "T..G.V.C.",
    direction: "counterclockwise",
    quarterTurns: 3,
    difficulty: "Easy",
    correctIndex: 2,
    distractors: ["wrong-rotation", "mirror-anti-diagonal", "one-block-off"],
  },

  // Medium: denser flat patterns make geometric near-matches less obvious.
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
    pattern: "CGV.T..CT",
    direction: "clockwise",
    quarterTurns: 1,
    difficulty: "Medium",
    correctIndex: 1,
    distractors: ["wrong-rotation", "mirror-horizontal", "one-block-off"],
  },
  {
    pattern: "T.CGV.G..",
    direction: "counterclockwise",
    quarterTurns: 1,
    difficulty: "Medium",
    correctIndex: 3,
    distractors: ["wrong-rotation", "mirror-vertical", "one-block-off"],
  },
  {
    pattern: ".VGCT..CG",
    direction: "clockwise",
    quarterTurns: 2,
    difficulty: "Medium",
    correctIndex: 0,
    distractors: ["wrong-rotation", "mirror-main-diagonal", "one-block-off"],
  },
  {
    pattern: "C.TG.VG.C",
    direction: "counterclockwise",
    quarterTurns: 2,
    difficulty: "Medium",
    correctIndex: 2,
    distractors: ["wrong-rotation", "mirror-anti-diagonal", "one-block-off"],
  },
  {
    pattern: "GT..C.VTG",
    direction: "clockwise",
    quarterTurns: 3,
    difficulty: "Medium",
    correctIndex: 3,
    distractors: ["wrong-rotation", "mirror-vertical", "one-block-off"],
  },
  {
    pattern: ".CVG.TC.G",
    direction: "counterclockwise",
    quarterTurns: 3,
    difficulty: "Medium",
    correctIndex: 1,
    distractors: ["wrong-rotation", "mirror-horizontal", "one-block-off"],
  },
  {
    pattern: "V.GCT.CG.",
    axis: "vertical",
    difficulty: "Medium",
    correctIndex: 2,
    distractors: ["mirror-horizontal", "mirror-anti-diagonal", "one-block-off"],
  },
  {
    pattern: "TC.G..VGC",
    axis: "anti-diagonal",
    difficulty: "Medium",
    correctIndex: 0,
    distractors: ["mirror-main-diagonal", "mirror-vertical", "one-block-off"],
  },

  // Hard: directional motifs must transform along with their tiles.
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
  {
    pattern: "CG.VT.CGV",
    motifs: [
      { index: 0, orientation: 0 },
      { index: 3, orientation: 2 },
      { index: 8, orientation: 1 },
    ],
    direction: "clockwise",
    quarterTurns: 1,
    difficulty: "Hard",
    correctIndex: 2,
    distractors: ["one-motif-off", "one-block-off", "mirror-vertical"],
  },
  {
    pattern: "T.VCG.GCT",
    motifs: [
      { index: 2, orientation: 3 },
      { index: 4, orientation: 0 },
      { index: 6, orientation: 1 },
      { index: 8, orientation: 2 },
    ],
    direction: "counterclockwise",
    quarterTurns: 2,
    difficulty: "Hard",
    correctIndex: 0,
    distractors: ["one-motif-off", "one-block-off", "mirror-horizontal"],
  },
  {
    pattern: "VGC.TC.GT",
    motifs: [
      { index: 0, orientation: 2 },
      { index: 2, orientation: 0 },
      { index: 5, orientation: 3 },
    ],
    direction: "clockwise",
    quarterTurns: 3,
    difficulty: "Hard",
    correctIndex: 1,
    distractors: ["one-motif-off", "one-block-off", "mirror-main-diagonal"],
  },
  {
    pattern: ".CTGV.VCG",
    motifs: [
      { index: 1, orientation: 1 },
      { index: 3, orientation: 3 },
      { index: 4, orientation: 0 },
      { index: 8, orientation: 2 },
    ],
    direction: "counterclockwise",
    quarterTurns: 3,
    difficulty: "Hard",
    correctIndex: 3,
    distractors: ["one-motif-off", "one-block-off", "mirror-anti-diagonal"],
  },
  {
    pattern: "GTV.C.CVG",
    motifs: [
      { index: 0, orientation: 0 },
      { index: 2, orientation: 2 },
      { index: 4, orientation: 1 },
      { index: 7, orientation: 3 },
    ],
    axis: "horizontal",
    difficulty: "Hard",
    correctIndex: 1,
    distractors: ["one-motif-off", "one-block-off", "mirror-vertical"],
  },
  {
    pattern: "C.GVTC.VG",
    motifs: [
      { index: 2, orientation: 1 },
      { index: 3, orientation: 2 },
      { index: 5, orientation: 0 },
      { index: 8, orientation: 3 },
    ],
    axis: "main-diagonal",
    difficulty: "Hard",
    correctIndex: 3,
    distractors: ["one-motif-off", "one-block-off", "mirror-anti-diagonal"],
  },
  {
    pattern: "VT.CG.GTC",
    motifs: [
      { index: 0, orientation: 3 },
      { index: 4, orientation: 1 },
      { index: 6, orientation: 0 },
      { index: 8, orientation: 2 },
    ],
    axis: "vertical",
    difficulty: "Hard",
    correctIndex: 0,
    distractors: ["one-motif-off", "one-block-off", "mirror-horizontal"],
  },
  {
    pattern: "G.CTVGC.T",
    motifs: [
      { index: 0, orientation: 1 },
      { index: 2, orientation: 3 },
      { index: 4, orientation: 2 },
      { index: 6, orientation: 0 },
    ],
    axis: "anti-diagonal",
    difficulty: "Hard",
    correctIndex: 2,
    distractors: ["one-motif-off", "one-block-off", "mirror-main-diagonal"],
  },

  // Wizard: the operation is hidden in the UI, so every near-miss is a small
  // edit of the true answer rather than another valid geometric transform.
  {
    pattern: "CTV.GC.VT",
    motifs: [
      { index: 0, orientation: 0 },
      { index: 2, orientation: 3 },
      { index: 4, orientation: 1 },
      { index: 8, orientation: 2 },
    ],
    direction: "clockwise",
    quarterTurns: 1,
    difficulty: "Wizard",
    correctIndex: 0,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "G.VCTTG.C",
    motifs: [
      { index: 0, orientation: 2 },
      { index: 2, orientation: 0 },
      { index: 5, orientation: 3 },
      { index: 6, orientation: 1 },
    ],
    direction: "counterclockwise",
    quarterTurns: 1,
    difficulty: "Wizard",
    correctIndex: 2,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "VC.TG.CVT",
    motifs: [
      { index: 0, orientation: 3 },
      { index: 3, orientation: 1 },
      { index: 6, orientation: 0 },
      { index: 8, orientation: 2 },
    ],
    direction: "clockwise",
    quarterTurns: 2,
    difficulty: "Wizard",
    correctIndex: 1,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: ".TGCV.VCG",
    motifs: [
      { index: 1, orientation: 0 },
      { index: 3, orientation: 2 },
      { index: 6, orientation: 3 },
      { index: 8, orientation: 1 },
    ],
    direction: "counterclockwise",
    quarterTurns: 2,
    difficulty: "Wizard",
    correctIndex: 3,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "CGT.VCV.G",
    motifs: [
      { index: 0, orientation: 1 },
      { index: 2, orientation: 3 },
      { index: 4, orientation: 0 },
      { index: 6, orientation: 2 },
    ],
    direction: "clockwise",
    quarterTurns: 3,
    difficulty: "Wizard",
    correctIndex: 2,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "TV.CGGT.C",
    motifs: [
      { index: 0, orientation: 2 },
      { index: 3, orientation: 0 },
      { index: 5, orientation: 1 },
      { index: 8, orientation: 3 },
    ],
    direction: "counterclockwise",
    quarterTurns: 3,
    difficulty: "Wizard",
    correctIndex: 0,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "GCTV..CVG",
    motifs: [
      { index: 0, orientation: 3 },
      { index: 2, orientation: 1 },
      { index: 6, orientation: 2 },
      { index: 8, orientation: 0 },
    ],
    axis: "vertical",
    difficulty: "Wizard",
    correctIndex: 3,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "V.CGTTC.G",
    motifs: [
      { index: 0, orientation: 0 },
      { index: 3, orientation: 3 },
      { index: 5, orientation: 2 },
      { index: 8, orientation: 1 },
    ],
    axis: "horizontal",
    difficulty: "Wizard",
    correctIndex: 1,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "TC.VG.CGV",
    motifs: [
      { index: 0, orientation: 1 },
      { index: 3, orientation: 2 },
      { index: 6, orientation: 0 },
      { index: 8, orientation: 3 },
    ],
    axis: "main-diagonal",
    difficulty: "Wizard",
    correctIndex: 2,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: ".VCGTG.CT",
    motifs: [
      { index: 1, orientation: 3 },
      { index: 3, orientation: 0 },
      { index: 5, orientation: 2 },
      { index: 8, orientation: 1 },
    ],
    axis: "anti-diagonal",
    difficulty: "Wizard",
    correctIndex: 0,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "CTG.VGCV.",
    motifs: [
      { index: 0, orientation: 2 },
      { index: 2, orientation: 0 },
      { index: 5, orientation: 3 },
      { index: 7, orientation: 1 },
    ],
    direction: "clockwise",
    quarterTurns: 1,
    difficulty: "Wizard",
    correctIndex: 1,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
  },
  {
    pattern: "GTCV.C.VT",
    motifs: [
      { index: 0, orientation: 0 },
      { index: 3, orientation: 1 },
      { index: 5, orientation: 3 },
      { index: 8, orientation: 2 },
    ],
    axis: "horizontal",
    difficulty: "Wizard",
    correctIndex: 3,
    distractors: ["one-motif-off", "one-block-off", "one-motif-off"],
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

function turnLabel(transform: PuzzleTransform): string {
  return transform.kind === "rotation"
    ? `${transform.degrees}° ${transform.direction}`
    : `${MIRROR_AXIS_NAMES[transform.axis]} flip`;
}

function assembleRound(
  clue: Pattern,
  transform: PuzzleTransform,
  difficulty: Difficulty,
  correctIndex: number,
  distractorKinds: readonly [DistractorKind, DistractorKind, DistractorKind],
  salts: readonly [number, number, number],
): Round | null {
  const correctPattern = applyTransform(clue, transform);
  const distractors = distractorKinds.map((kind, index) => ({
    kind,
    pattern: makeDistractor(kind, clue, correctPattern, transform, salts[index]),
  }));
  const options = distractors.map(({ pattern }) => pattern);
  const optionKinds: OptionKind[] = distractors.map(({ kind }) => kind);
  options.splice(correctIndex, 0, correctPattern);
  optionKinds.splice(correctIndex, 0, "correct");

  const correctKey = patternKey(correctPattern);
  const optionKeys = options.map(patternKey);
  const exactMatches = optionKeys.filter((key) => key === correctKey).length;
  if (new Set(optionKeys).size !== 4 || exactMatches !== 1) return null;

  return {
    clue,
    options,
    optionKinds,
    correctIndex,
    correctPattern,
    transform,
    difficulty,
    turn: turnLabel(transform),
  };
}

export function patternKey(pattern: Pattern): string {
  return pattern
    .map((item) => `${item.color}:${item.motif}:${item.orientation}`)
    .join("|");
}

export function differingTileIndexes(
  candidate: Pattern,
  expected: Pattern,
): readonly number[] {
  if (candidate.length !== expected.length) {
    throw new Error("Patterns must have the same number of tiles.");
  }

  return candidate.flatMap((tile, index) => {
    const target = expected[index];
    const matches =
      tile.color === target.color &&
      tile.motif === target.motif &&
      tile.orientation === target.orientation;
    return matches ? [] : [index];
  });
}

function unitRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a finite number from 0 up to 1.");
  }
  return value;
}

function randomInteger(random: () => number, exclusiveMaximum: number): number {
  return Math.floor(unitRandom(random) * exclusiveMaximum);
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function makeGeneratedPattern(
  difficulty: Difficulty,
  random: () => number,
): Pattern {
  const rules = GENERATED_DIFFICULTY_RULES[difficulty];
  const filledCount =
    rules.minFilled +
    randomInteger(random, rules.maxFilled - rules.minFilled + 1);
  const filledIndexes = shuffled(
    Array.from({ length: 9 }, (_, index) => index),
    random,
  ).slice(0, filledCount);
  const pattern = Array.from({ length: 9 }, () => tile("empty"));

  for (const index of filledIndexes) {
    pattern[index] = tile(FILLED_COLORS[randomInteger(random, FILLED_COLORS.length)]);
  }

  if (rules.maxMotifs > 0) {
    const motifCount =
      rules.minMotifs +
      randomInteger(random, rules.maxMotifs - rules.minMotifs + 1);
    for (const index of shuffled(filledIndexes, random).slice(0, motifCount)) {
      pattern[index] = tile(
        pattern[index].color,
        "cap",
        randomInteger(random, 4),
      );
    }
  }

  return pattern;
}

function dihedralKeys(pattern: Pattern): readonly string[] {
  return [
    patternKey(pattern),
    patternKey(rotatePattern(pattern, 1)),
    patternKey(rotatePattern(pattern, 2)),
    patternKey(rotatePattern(pattern, 3)),
    patternKey(reflectPattern(pattern, "vertical")),
    patternKey(reflectPattern(pattern, "horizontal")),
    patternKey(reflectPattern(pattern, "main-diagonal")),
    patternKey(reflectPattern(pattern, "anti-diagonal")),
  ];
}

/**
 * Returns every answer reachable by one supported non-identity rotation or
 * reflection. Equivalent clockwise/counterclockwise rotations collapse to the
 * same pattern key.
 */
export function hiddenTransformKeys(pattern: Pattern): ReadonlySet<string> {
  return new Set([
    patternKey(rotatePattern(pattern, 1)),
    patternKey(rotatePattern(pattern, 2)),
    patternKey(rotatePattern(pattern, 3)),
    patternKey(reflectPattern(pattern, "vertical")),
    patternKey(reflectPattern(pattern, "horizontal")),
    patternKey(reflectPattern(pattern, "main-diagonal")),
    patternKey(reflectPattern(pattern, "anti-diagonal")),
  ]);
}

/** Finds the options that could be answers when the operation is hidden. */
export function hiddenTransformOptionIndexes(
  clue: Pattern,
  options: readonly Pattern[],
): readonly number[] {
  const validKeys = hiddenTransformKeys(clue);
  return options.flatMap((option, index) =>
    validKeys.has(patternKey(option)) ? [index] : [],
  );
}

function isGeneratedDifficulty(
  difficulty: string,
): difficulty is Difficulty {
  return (
    difficulty === "Easy" ||
    difficulty === "Medium" ||
    difficulty === "Hard" ||
    difficulty === "Wizard"
  );
}

function isInterestingGeneratedPattern(
  pattern: Pattern,
  difficulty: Difficulty,
): boolean {
  const rules = GENERATED_DIFFICULTY_RULES[difficulty];
  const filled = pattern.filter(({ color }) => color !== "empty");
  const motifCount = filled.filter(({ motif }) => motif === "cap").length;
  const colorCount = new Set(filled.map(({ color }) => color)).size;

  return (
    filled.length >= rules.minFilled &&
    filled.length <= rules.maxFilled &&
    motifCount >= rules.minMotifs &&
    motifCount <= rules.maxMotifs &&
    colorCount >= 2 &&
    new Set(dihedralKeys(pattern)).size === 8
  );
}

function randomTransform(random: () => number): PuzzleTransform {
  const transformIndex = randomInteger(random, 10);
  if (transformIndex < 6) {
    const direction: RotationDirection =
      transformIndex < 3 ? "clockwise" : "counterclockwise";
    const quarterTurns = ((transformIndex % 3) + 1) as 1 | 2 | 3;
    return makeRotationTransform(direction, quarterTurns);
  }

  const axes: readonly MirrorAxis[] = [
    "vertical",
    "horizontal",
    "main-diagonal",
    "anti-diagonal",
  ];
  return makeReflectionTransform(axes[transformIndex - 6]);
}

function generatedDistractorKinds(
  difficulty: Difficulty,
  transform: PuzzleTransform,
  random: () => number,
): readonly [DistractorKind, DistractorKind, DistractorKind] {
  if (difficulty === "Wizard") {
    return ["one-motif-off", "one-block-off", "one-motif-off"];
  }

  const geometricKinds = shuffled(
    [
      "wrong-rotation" as const,
      ...MIRROR_DISTRACTORS.filter((kind) => {
        if (transform.kind !== "reflection") return true;
        return kind !== `mirror-${transform.axis}`;
      }),
    ],
    random,
  );

  if (difficulty === "Hard") {
    return ["one-motif-off", "one-block-off", geometricKinds[0]];
  }

  return ["one-block-off", geometricKinds[0], geometricKinds[1]];
}

/**
 * Generates one validated round from an effectively unbounded random stream.
 * A supplied random function makes sessions reproducible in tests or seeded UI.
 */
export function generateInfiniteRound(
  difficulty: Difficulty,
  random: () => number = Math.random,
): Round {
  if (!isGeneratedDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const clue = makeGeneratedPattern(difficulty, random);
    if (!isInterestingGeneratedPattern(clue, difficulty)) continue;

    const transform = randomTransform(random);
    const correctIndex = randomInteger(random, 4);
    const distractorKinds = generatedDistractorKinds(
      difficulty,
      transform,
      random,
    );
    const salts = [
      randomInteger(random, 1_000_000),
      randomInteger(random, 1_000_000),
      randomInteger(random, 1_000_000),
    ] as const;
    const round = assembleRound(
      clue,
      transform,
      difficulty,
      correctIndex,
      distractorKinds,
      salts,
    );
    if (!round) continue;

    if (difficulty === "Wizard") {
      const hiddenAnswerIndexes = hiddenTransformOptionIndexes(
        round.clue,
        round.options,
      );
      const fullOrbitKeys = new Set([
        patternKey(round.clue),
        ...hiddenTransformKeys(round.clue),
      ]);
      const everyTrapIsCloseAndOutsideOrbit = round.options.every(
        (option, index) => {
          if (index === round.correctIndex) return true;
          const differenceCount = differingTileIndexes(
            option,
            round.correctPattern,
          ).length;
          return (
            differenceCount >= 1 &&
            differenceCount <= 2 &&
            !fullOrbitKeys.has(patternKey(option))
          );
        },
      );

      if (
        hiddenAnswerIndexes.length === 1 &&
        hiddenAnswerIndexes[0] === round.correctIndex &&
        everyTrapIsCloseAndOutsideOrbit
      ) {
        return round;
      }
      continue;
    }

    const hasCloseDistractor = round.options.some(
      (option, index) =>
        index !== round.correctIndex &&
        differingTileIndexes(option, round.correctPattern).length <= 2,
    );
    if (hasCloseDistractor) return round;
  }

  throw new Error(
    `Unable to generate a valid ${difficulty} round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

/** Identifies a clue-to-answer puzzle independently of option ordering. */
export function roundFingerprint(round: Round): string {
  return `${round.difficulty}:${patternKey(round.clue)}=>${patternKey(
    round.correctPattern,
  )}`;
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
    const round = assembleRound(
      clue,
      transform,
      spec.difficulty,
      spec.correctIndex,
      spec.distractors,
      [roundIndex, roundIndex + 1, roundIndex + 2],
    );
    if (!round) {
      throw new Error(`Round ${roundIndex + 1} has duplicate answer options.`);
    }
    if (
      spec.difficulty === "Wizard" &&
      (new Set(dihedralKeys(round.clue)).size !== 8 ||
        hiddenTransformOptionIndexes(round.clue, round.options).length !== 1 ||
        hiddenTransformOptionIndexes(round.clue, round.options)[0] !==
          round.correctIndex)
    ) {
      throw new Error(
        `Wizard round ${roundIndex + 1} does not have one unique hidden-transform answer.`,
      );
    }
    return round;
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
