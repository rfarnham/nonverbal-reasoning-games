export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";

export type CellMask = number;
export type MotifShape = "circle" | "square" | "triangle" | "bar";
export type MotifFill = "solid" | "outline" | "striped";
export type MotifScale = 0 | 1 | 2;
export type QuarterTurn = 0 | 1 | 2 | 3;
export type TexturePhase = 0 | 1 | 2 | 3;

export type Pattern = {
  mask: CellMask;
  shape: MotifShape;
  fill: MotifFill;
  scale: MotifScale;
  orientation: QuarterTurn;
  texturePhase: TexturePhase;
};

export type Matrix = readonly [
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  null,
];

export type CompletedMatrix = readonly [
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
  Pattern,
];

export type Axis = "rows" | "columns";

export type Operation =
  | "join"
  | "overlap"
  | "cancel"
  | "left-minus-right"
  | "right-minus-left"
  | "match"
  | "neither";

export type PatternTransform =
  | "none"
  | "rotate-clockwise"
  | "rotate-half"
  | "rotate-counterclockwise";

export type SequenceStep =
  | "rotate-clockwise"
  | "rotate-counterclockwise"
  | "move-clockwise"
  | "grow"
  | "shrink"
  | "shape-cycle"
  | "fill-cycle"
  | "texture-shift"
  | "motif-turn";

export type CombineRule = {
  family: "combine";
  axis: Axis;
  operation: Operation;
  transform: PatternTransform;
};

export type SequenceRule = {
  family: "sequence";
  axis: Axis;
  step: SequenceStep;
};

export type GridOperation = Exclude<Operation, "join" | "overlap">;
export type GridTransform =
  | "rotate-clockwise"
  | "rotate-counterclockwise";

export type GridRule = {
  family: "grid";
  operation: GridOperation;
  transform: GridTransform;
};

export type MatrixRule = CombineRule | SequenceRule | GridRule;

export type ComposedRule = {
  family: "combine-change";
  axis: Axis;
  operation: Operation;
  step: Exclude<
    SequenceStep,
    "rotate-clockwise" | "rotate-counterclockwise"
  >;
};

export type BooleanClosureRule = {
  family: "boolean-closure";
  axis: Axis;
  truthTable: number;
  transform: PatternTransform;
};

export type BooleanClosureChangeRule = {
  family: "boolean-closure-change";
  axis: Axis;
  truthTable: number;
  step: ComposedRule["step"];
};

export type RuleProgram =
  | MatrixRule
  | ComposedRule
  | BooleanClosureRule
  | BooleanClosureChangeRule;

export type HintPolicy = "always" | "after-miss" | "never";
export type CueMode = "full-rule" | "hidden";

export type OptionKind =
  | "correct"
  | "wrong-rule"
  | "skipped-stage"
  | "one-feature-off"
  | "clear-contrast";

export type Round = {
  id: string;
  difficulty: Difficulty;
  matrix: Matrix;
  rule: MatrixRule;
  hintPolicy: HintPolicy;
  options: readonly [Pattern, Pattern, Pattern, Pattern];
  optionKinds: readonly [OptionKind, OptionKind, OptionKind, OptionKind];
  correctIndex: number;
  correctPattern: Pattern;
};

export type RoundBlueprint = {
  id: string;
  difficulty: Difficulty;
  rule: MatrixRule;
  sourcePatterns: readonly Pattern[];
  correctIndex: number;
};

export type IncorrectFeedback = {
  heading: "Try again";
  message: string;
  differenceCount: number | null;
  revealDifferences: boolean;
};

export type RulePartSection = "combine" | "change";
export type RulePartId = `${RulePartSection}:${string}`;

export type RulePart = {
  id: RulePartId;
  section: RulePartSection;
  name: string;
  shortName: string;
  symbol: string;
  description: string;
};

type RandomSource = () => number;

type DistractorCandidate = {
  kind: Exclude<OptionKind, "correct">;
  pattern: Pattern;
};

const FULL_MASK = 0b1111;
const SHAPES: readonly MotifShape[] = [
  "circle",
  "triangle",
  "square",
  "bar",
];
const FILLS: readonly MotifFill[] = ["solid", "outline", "striped"];
const NON_IDENTITY_TRANSFORMS: readonly Exclude<
  PatternTransform,
  "none"
>[] = ["rotate-clockwise", "rotate-half", "rotate-counterclockwise"];

const COMPOSABLE_SEQUENCE_STEPS: readonly ComposedRule["step"][] = [
  "move-clockwise",
  "grow",
  "shrink",
  "shape-cycle",
  "fill-cycle",
  "texture-shift",
  "motif-turn",
];

const OPERATION_TRUTH_TABLES: Record<Operation, number> = {
  join: 0b1110,
  overlap: 0b1000,
  cancel: 0b0110,
  "left-minus-right": 0b0100,
  "right-minus-left": 0b0010,
  match: 0b1001,
  neither: 0b0001,
};

function truthTableDependsOnBothInputs(truthTable: number): boolean {
  const output = (left: 0 | 1, right: 0 | 1) =>
    (truthTable >> (left * 2 + right)) & 1;
  const dependsOnLeft =
    output(0, 0) !== output(1, 0) ||
    output(0, 1) !== output(1, 1);
  const dependsOnRight =
    output(0, 0) !== output(0, 1) ||
    output(1, 0) !== output(1, 1);
  return dependsOnLeft && dependsOnRight;
}

const COMPOSED_BOOLEAN_TRUTH_TABLES = Array.from(
  { length: 16 },
  (_, truthTable) => truthTable,
).filter(
  (truthTable) =>
    truthTableDependsOnBothInputs(truthTable) &&
    !Object.values(OPERATION_TRUTH_TABLES).includes(truthTable),
);

export const DIFFICULTIES: readonly Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
  "Wizard",
];

export const OPERATIONS: readonly Operation[] = [
  "join",
  "overlap",
  "cancel",
  "left-minus-right",
  "right-minus-left",
  "match",
  "neither",
];

export const PATTERN_TRANSFORMS: readonly PatternTransform[] = [
  "none",
  ...NON_IDENTITY_TRANSFORMS,
];

export const SEQUENCE_STEPS: readonly SequenceStep[] = [
  "rotate-clockwise",
  "rotate-counterclockwise",
  "move-clockwise",
  "grow",
  "shrink",
  "shape-cycle",
  "fill-cycle",
  "texture-shift",
  "motif-turn",
];

const GRID_OPERATIONS: readonly GridOperation[] = [
  "cancel",
  "left-minus-right",
  "right-minus-left",
  "match",
  "neither",
];

const GRID_TRANSFORMS: readonly GridTransform[] = [
  "rotate-clockwise",
  "rotate-counterclockwise",
];

const OPERATION_LABELS: Record<Operation, string> = {
  join: "Union",
  overlap: "Intersection",
  cancel: "Exclusive or",
  "left-minus-right": "Set difference A minus B",
  "right-minus-left": "Set difference B minus A",
  match: "Equivalence",
  neither: "Complement of union",
};

const OPERATION_SHORT_LABELS: Record<Operation, string> = {
  join: "Union",
  overlap: "Intersection",
  cancel: "XOR",
  "left-minus-right": "A minus B",
  "right-minus-left": "B minus A",
  match: "XNOR",
  neither: "NOR",
};

const OPERATION_DESCRIPTIONS: Record<Operation, string> = {
  join: "A ∪ B keeps every occupied position from either input.",
  overlap: "A ∩ B keeps only positions occupied in both inputs.",
  cancel: "A ⊕ B keeps positions occupied in exactly one input.",
  "left-minus-right": "A ∖ B removes B’s occupied positions from A.",
  "right-minus-left": "B ∖ A removes A’s occupied positions from B.",
  match: "¬(A ⊕ B) keeps positions where both inputs agree.",
  neither: "(A ∪ B)ᶜ keeps positions left empty by both inputs.",
};

const OPERATION_SYMBOLS: Record<Operation, string> = {
  join: "∪",
  overlap: "∩",
  cancel: "⊕",
  "left-minus-right": "A∖B",
  "right-minus-left": "B∖A",
  match: "≡",
  neither: "∪ᶜ",
};

const TRANSFORM_LABELS: Record<PatternTransform, string> = {
  none: "Keep in place",
  "rotate-clockwise": "Quarter-turn clockwise",
  "rotate-half": "Half-turn",
  "rotate-counterclockwise": "Quarter-turn counterclockwise",
};

const TRANSFORM_SYMBOLS: Record<PatternTransform, string> = {
  none: "=",
  "rotate-clockwise": "↻90°",
  "rotate-half": "180°",
  "rotate-counterclockwise": "↺90°",
};

const SEQUENCE_LABELS: Record<SequenceStep, string> = {
  "rotate-clockwise": "Turn clockwise",
  "rotate-counterclockwise": "Turn counterclockwise",
  "move-clockwise": "Move around",
  grow: "Grow",
  shrink: "Shrink",
  "shape-cycle": "Change shape",
  "fill-cycle": "Change fill",
  "texture-shift": "Move texture",
  "motif-turn": "Turn motif",
};

const SEQUENCE_DESCRIPTIONS: Record<SequenceStep, string> = {
  "rotate-clockwise":
    "Each panel turns one quarter clockwise, including directional motifs.",
  "rotate-counterclockwise":
    "Each panel turns one quarter counterclockwise.",
  "move-clockwise":
    "Occupied positions move clockwise while the motifs keep their heading.",
  grow: "The motif size increases by one clear step.",
  shrink: "The motif size decreases by one clear step.",
  "shape-cycle": "The motif advances through a fixed shape cycle.",
  "fill-cycle": "The motif advances through solid, outline, and stripe fills.",
  "texture-shift": "The stripe pattern moves one phase inside each motif.",
  "motif-turn": "Directional motifs turn while their positions stay fixed.",
};

const SEQUENCE_SYMBOLS: Record<SequenceStep, string> = {
  "rotate-clockwise": "↻90°",
  "rotate-counterclockwise": "↺90°",
  "move-clockwise": "P↻90°",
  grow: "s↦s+1",
  shrink: "s↦s−1",
  "shape-cycle": "○→△→□→▭",
  "fill-cycle": "●→○→▧",
  "texture-shift": "φ↦φ+1",
  "motif-turn": "θ↦θ+90°",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  Easy: "Starter",
  Medium: "Junior",
  Hard: "Expert",
  Wizard: "Wizard",
};

const HINT_POLICIES: Record<Difficulty, HintPolicy> = {
  Easy: "always",
  Medium: "always",
  Hard: "after-miss",
  Wizard: "never",
};

function normalizeTurn(value: number): QuarterTurn {
  return (((value % 4) + 4) % 4) as QuarterTurn;
}

function normalizeOrientation(
  shape: MotifShape,
  orientation: number,
): QuarterTurn {
  if (shape === "circle" || shape === "square") return 0;
  if (shape === "bar") return (normalizeTurn(orientation) % 2) as QuarterTurn;
  return normalizeTurn(orientation);
}

function assertMask(mask: number): void {
  if (!Number.isInteger(mask) || mask < 0 || mask > FULL_MASK) {
    throw new Error(`Pattern mask must be an integer from 0 to 15: ${mask}`);
  }
}

export function makePattern(
  mask: number,
  overrides: Partial<Omit<Pattern, "mask">> = {},
): Pattern {
  assertMask(mask);
  const shape = overrides.shape ?? "circle";
  const fill = overrides.fill ?? "solid";
  const scale = overrides.scale ?? 1;
  const orientation = normalizeOrientation(
    shape,
    overrides.orientation ?? 0,
  );
  const texturePhase =
    fill === "striped"
      ? normalizeTurn(overrides.texturePhase ?? 0)
      : 0;

  if (!SHAPES.includes(shape)) throw new Error(`Unknown motif shape: ${shape}`);
  if (!FILLS.includes(fill)) throw new Error(`Unknown motif fill: ${fill}`);
  if (scale !== 0 && scale !== 1 && scale !== 2) {
    throw new Error(`Motif scale must be 0, 1, or 2: ${scale}`);
  }

  return {
    mask,
    shape,
    fill,
    scale,
    orientation,
    texturePhase,
  };
}

export function patternFromMask(mask: number): Pattern {
  return makePattern(mask);
}

export function patternMask(pattern: Pattern): number {
  assertMask(pattern.mask);
  return pattern.mask;
}

export function patternCells(pattern: Pattern): readonly [
  boolean,
  boolean,
  boolean,
  boolean,
] {
  return [
    (pattern.mask & 1) !== 0,
    (pattern.mask & 2) !== 0,
    (pattern.mask & 4) !== 0,
    (pattern.mask & 8) !== 0,
  ];
}

export function patternKey(pattern: Pattern): string {
  const normalized = makePattern(pattern.mask, pattern);
  return [
    normalized.mask.toString(16),
    normalized.shape,
    normalized.fill,
    normalized.scale,
    normalized.orientation,
    normalized.texturePhase,
  ].join(":");
}

export const renderKey = patternKey;

export function patternStyleKey(pattern: Pattern): string {
  const normalized = makePattern(pattern.mask, pattern);
  return [
    normalized.shape,
    normalized.fill,
    normalized.scale,
    normalized.orientation,
    normalized.texturePhase,
  ].join(":");
}

export function patternDistance(left: Pattern, right: Pattern): number {
  const cellDifferences = maskDifferenceCount(left, right);
  return (
    cellDifferences +
    Number(left.shape !== right.shape) +
    Number(left.fill !== right.fill) +
    Number(left.scale !== right.scale) +
    Number(left.orientation !== right.orientation) +
    Number(left.texturePhase !== right.texturePhase)
  );
}

export function maskDifferenceCount(
  left: Pattern,
  right: Pattern,
): number {
  const leftCells = patternCells(left);
  const rightCells = patternCells(right);
  return leftCells.filter(
    (filled, index) => filled !== rightCells[index],
  ).length;
}

export function differingDotIndexes(
  candidate: Pattern,
  expected: Pattern,
): readonly number[] {
  const candidateCells = patternCells(candidate);
  const expectedCells = patternCells(expected);
  return candidateCells.flatMap((filled, index) =>
    filled === expectedCells[index] ? [] : [index],
  );
}

export function dotCount(pattern: Pattern): number {
  return patternCells(pattern).filter(Boolean).length;
}

function rotateMask(mask: number, quarterTurnsClockwise: number): number {
  let cells = [
    (mask & 1) !== 0,
    (mask & 2) !== 0,
    (mask & 4) !== 0,
    (mask & 8) !== 0,
  ] as [boolean, boolean, boolean, boolean];
  const turns = normalizeTurn(quarterTurnsClockwise);

  for (let index = 0; index < turns; index += 1) {
    cells = [cells[2], cells[0], cells[3], cells[1]];
  }

  return cells.reduce(
    (result, filled, index) => result | (filled ? 1 << index : 0),
    0,
  );
}

export function rotatePattern(
  pattern: Pattern,
  quarterTurnsClockwise: number,
): Pattern {
  const turns = normalizeTurn(quarterTurnsClockwise);
  return makePattern(rotateMask(pattern.mask, turns), {
    ...pattern,
    orientation: normalizeOrientation(
      pattern.shape,
      pattern.orientation + turns,
    ),
    texturePhase:
      pattern.fill === "striped"
        ? normalizeTurn(pattern.texturePhase + turns)
        : 0,
  });
}

function movePattern(
  pattern: Pattern,
  quarterTurnsClockwise: number,
): Pattern {
  return makePattern(rotateMask(pattern.mask, quarterTurnsClockwise), pattern);
}

export function transformPattern(
  pattern: Pattern,
  transform: PatternTransform,
): Pattern {
  switch (transform) {
    case "none":
      return makePattern(pattern.mask, pattern);
    case "rotate-clockwise":
      return rotatePattern(pattern, 1);
    case "rotate-half":
      return rotatePattern(pattern, 2);
    case "rotate-counterclockwise":
      return rotatePattern(pattern, -1);
  }
}

function matchingStyles(left: Pattern, right: Pattern): boolean {
  return patternStyleKey(left) === patternStyleKey(right);
}

function operationMask(
  leftMask: number,
  rightMask: number,
  operation: Operation,
): number {
  switch (operation) {
    case "join":
      return leftMask | rightMask;
    case "overlap":
      return leftMask & rightMask;
    case "cancel":
      return leftMask ^ rightMask;
    case "left-minus-right":
      return leftMask & ~rightMask & FULL_MASK;
    case "right-minus-left":
      return rightMask & ~leftMask & FULL_MASK;
    case "match":
      return ~(leftMask ^ rightMask) & FULL_MASK;
    case "neither":
      return ~(leftMask | rightMask) & FULL_MASK;
  }
}

function truthTableMask(
  leftMask: number,
  rightMask: number,
  truthTable: number,
): number {
  if (
    !Number.isInteger(truthTable) ||
    truthTable < 0 ||
    truthTable > 0b1111
  ) {
    throw new Error(`Boolean truth table must be from 0 to 15: ${truthTable}`);
  }
  let result = 0;
  for (let cellIndex = 0; cellIndex < 4; cellIndex += 1) {
    const left = (leftMask & (1 << cellIndex)) !== 0;
    const right = (rightMask & (1 << cellIndex)) !== 0;
    const inputIndex = (left ? 2 : 0) + (right ? 1 : 0);
    if ((truthTable & (1 << inputIndex)) !== 0) {
      result |= 1 << cellIndex;
    }
  }
  return result;
}

function combineByTruthTable(
  left: Pattern,
  right: Pattern,
  truthTable: number,
): Pattern | null {
  if (!matchingStyles(left, right)) return null;
  return makePattern(
    truthTableMask(left.mask, right.mask, truthTable),
    left,
  );
}

export function combinePatterns(
  left: Pattern,
  right: Pattern,
  operation: Operation,
): Pattern | null {
  if (!matchingStyles(left, right)) return null;
  return makePattern(operationMask(left.mask, right.mask, operation), left);
}

export function applyCombineRule(
  left: Pattern,
  right: Pattern,
  rule: CombineRule,
): Pattern | null {
  const combined = combinePatterns(left, right, rule.operation);
  return combined ? transformPattern(combined, rule.transform) : null;
}

export function applySequenceStep(
  pattern: Pattern,
  step: SequenceStep,
): Pattern | null {
  switch (step) {
    case "rotate-clockwise":
      return rotatePattern(pattern, 1);
    case "rotate-counterclockwise":
      return rotatePattern(pattern, -1);
    case "move-clockwise":
      return movePattern(pattern, 1);
    case "grow":
      return makePattern(pattern.mask, {
        ...pattern,
        scale: ((pattern.scale + 1) % 3) as MotifScale,
      });
    case "shrink":
      return makePattern(pattern.mask, {
        ...pattern,
        scale: ((pattern.scale + 2) % 3) as MotifScale,
      });
    case "shape-cycle": {
      const shapeIndex = SHAPES.indexOf(pattern.shape);
      return makePattern(pattern.mask, {
        ...pattern,
        shape: SHAPES[(shapeIndex + 1) % SHAPES.length],
      });
    }
    case "fill-cycle": {
      const fillIndex = FILLS.indexOf(pattern.fill);
      return makePattern(pattern.mask, {
        ...pattern,
        fill: FILLS[(fillIndex + 1) % FILLS.length],
        texturePhase: 0,
      });
    }
    case "texture-shift":
      return pattern.fill === "striped"
        ? makePattern(pattern.mask, {
            ...pattern,
            texturePhase: normalizeTurn(pattern.texturePhase + 1),
          })
        : null;
    case "motif-turn":
      return pattern.shape === "triangle" || pattern.shape === "bar"
        ? makePattern(pattern.mask, {
            ...pattern,
            orientation: normalizeOrientation(
              pattern.shape,
              pattern.orientation + 1,
            ),
          })
        : null;
  }
}

export function operationLabel(operation: Operation): string {
  return OPERATION_LABELS[operation];
}

export function operationSymbol(operation: Operation): string {
  return OPERATION_SYMBOLS[operation];
}

export function transformLabel(transform: PatternTransform): string {
  return TRANSFORM_LABELS[transform];
}

export function transformSymbol(transform: PatternTransform): string {
  return TRANSFORM_SYMBOLS[transform];
}

export function sequenceLabel(step: SequenceStep): string {
  return SEQUENCE_LABELS[step];
}

export function sequenceSymbol(step: SequenceStep): string {
  return SEQUENCE_SYMBOLS[step];
}

export function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_LABELS[difficulty];
}

export function hintPolicyForDifficulty(
  difficulty: Difficulty,
): HintPolicy {
  return HINT_POLICIES[difficulty];
}

export function effectiveCueMode(
  hintPolicy: HintPolicy,
  hasMissed: boolean,
): CueMode {
  if (hintPolicy === "always") return "full-rule";
  if (hintPolicy === "after-miss" && hasMissed) return "full-rule";
  return "hidden";
}

export function ruleKey(rule: MatrixRule): string {
  if (rule.family === "combine") {
    return [
      rule.family,
      rule.axis,
      rule.operation,
      rule.transform,
    ].join(":");
  }
  if (rule.family === "sequence") {
    return [rule.family, rule.axis, rule.step].join(":");
  }
  return [
    rule.family,
    rule.operation,
    rule.transform,
  ].join(":");
}

export function programKey(program: RuleProgram): string {
  if (program.family === "combine") {
    return [
      "boolean",
      program.axis,
      OPERATION_TRUTH_TABLES[program.operation],
      program.transform,
    ].join(":");
  }
  if (program.family === "boolean-closure") {
    return [
      "boolean",
      program.axis,
      program.truthTable,
      program.transform,
    ].join(":");
  }
  if (
    program.family === "combine-change" ||
    program.family === "boolean-closure-change"
  ) {
    return [
      "boolean-change",
      program.axis,
      program.family === "combine-change"
        ? OPERATION_TRUTH_TABLES[program.operation]
        : program.truthTable,
      program.step,
    ].join(":");
  }
  return ruleKey(program);
}

export function ruleLabel(rule: MatrixRule): string {
  if (rule.family === "combine") {
    const axis = rule.axis === "rows" ? "across rows" : "down columns";
    const turn =
      rule.transform === "none"
        ? ""
        : `, then ${transformLabel(rule.transform).toLowerCase()}`;
    return `${operationLabel(rule.operation)} ${axis}${turn}.`;
  }
  if (rule.family === "sequence") {
    const axis = rule.axis === "rows" ? "across each row" : "down each column";
    return `${sequenceLabel(rule.step)} ${axis}.`;
  }
  return `${operationLabel(rule.operation)} each linked pair, then ${transformLabel(
    rule.transform,
  ).toLowerCase()}, across the whole matrix.`;
}

export const RULE_CATALOGUE: readonly RulePart[] = [
  ...OPERATIONS.map(
    (operation): RulePart => ({
      id: `combine:${operation}`,
      section: "combine",
      name: operationLabel(operation),
      shortName: OPERATION_SHORT_LABELS[operation],
      symbol: operationSymbol(operation),
      description: OPERATION_DESCRIPTIONS[operation],
    }),
  ),
  ...SEQUENCE_STEPS.map(
    (step): RulePart => ({
      id: `change:${step}`,
      section: "change",
      name: sequenceLabel(step),
      shortName: sequenceLabel(step),
      symbol: sequenceSymbol(step),
      description: SEQUENCE_DESCRIPTIONS[step],
    }),
  ),
  {
    id: "change:rotate-half",
    section: "change",
    name: "Half-turn",
    shortName: "Half-turn",
    symbol: transformSymbol("rotate-half"),
    description: "Turn the combined pattern through 180 degrees.",
  },
  {
    id: "change:columns",
    section: "change",
    name: "Top-down",
    shortName: "Top-down",
    symbol: "↓",
    description: "Read the same relation down columns instead of across rows.",
  },
  {
    id: "change:grid-cascade",
    section: "change",
    name: "Matrix cascade",
    shortName: "Cascade",
    symbol: "f∘f",
    description:
      "Use linked results as inputs to build one connected whole-matrix rule.",
  },
] as const;

export function rulePartIds(rule: MatrixRule): readonly RulePartId[] {
  if (rule.family === "combine") {
    return [
      `combine:${rule.operation}`,
      ...(rule.axis === "columns" ? ["change:columns" as const] : []),
      ...(rule.transform === "none"
        ? []
        : [`change:${rule.transform}` as RulePartId]),
    ];
  }
  if (rule.family === "sequence") {
    return [
      `change:${rule.step}`,
      ...(rule.axis === "columns" ? ["change:columns" as const] : []),
    ];
  }
  return [
    "change:grid-cascade",
    `combine:${rule.operation}`,
    `change:${rule.transform}`,
  ];
}

function lineIndexes(
  axis: Axis,
): readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] {
  return axis === "rows"
    ? [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
      ]
    : [
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
      ];
}

function applyLineRule(
  first: Pattern,
  second: Pattern,
  rule: CombineRule | SequenceRule,
): Pattern | null {
  if (rule.family === "combine") {
    return applyCombineRule(first, second, rule);
  }
  const expectedSecond = applySequenceStep(first, rule.step);
  if (!expectedSecond || patternKey(expectedSecond) !== patternKey(second)) {
    return null;
  }
  return applySequenceStep(second, rule.step);
}

function applyComposedRule(
  first: Pattern,
  second: Pattern,
  rule: ComposedRule,
): Pattern | null {
  const combined = combinePatterns(first, second, rule.operation);
  return combined ? applySequenceStep(combined, rule.step) : null;
}

function applyBooleanClosureRule(
  first: Pattern,
  second: Pattern,
  rule: BooleanClosureRule | BooleanClosureChangeRule,
): Pattern | null {
  const combined = combineByTruthTable(
    first,
    second,
    rule.truthTable,
  );
  if (!combined) return null;
  return rule.family === "boolean-closure"
    ? transformPattern(combined, rule.transform)
    : applySequenceStep(combined, rule.step);
}

function applyGridPair(
  first: Pattern,
  second: Pattern,
  rule: GridRule,
): Pattern | null {
  return applyCombineRule(first, second, {
    family: "combine",
    axis: "rows",
    operation: rule.operation,
    transform: rule.transform,
  });
}

function completedGridFromSources(
  sourcePatterns: readonly Pattern[],
  rule: GridRule,
): CompletedMatrix | null {
  if (sourcePatterns.length !== 3) return null;
  const [first, second, third] = sourcePatterns;
  const topResult = applyGridPair(first, second, rule);
  const leftResult = applyGridPair(first, third, rule);
  const center = applyGridPair(second, third, rule);
  if (!topResult || !leftResult || !center) return null;
  const right = applyGridPair(topResult, center, rule);
  const bottomMiddle = applyGridPair(center, leftResult, rule);
  if (!right || !bottomMiddle) return null;
  const answer = applyGridPair(right, bottomMiddle, rule);
  if (!answer) return null;
  return [
    first,
    second,
    topResult,
    third,
    center,
    right,
    leftResult,
    bottomMiddle,
    answer,
  ];
}

function gridSourcesFromMatrix(
  matrix: Matrix,
): readonly [Pattern, Pattern, Pattern] {
  return [
    matrix[0] as Pattern,
    matrix[1] as Pattern,
    matrix[3] as Pattern,
  ];
}

export function applyGridRule(
  sourcePatterns: readonly [Pattern, Pattern, Pattern],
  rule: GridRule,
): CompletedMatrix {
  const completed = completedGridFromSources(sourcePatterns, rule);
  if (!completed) {
    throw new Error("The supplied panels do not satisfy the grid rule.");
  }
  return completed;
}

function completeFromRule(matrix: Matrix, rule: MatrixRule): Pattern | null {
  if (rule.family === "grid") {
    return completedGridFromSources(
      gridSourcesFromMatrix(matrix),
      rule,
    )?.[8] ?? null;
  }
  const target = lineIndexes(rule.axis)[2];
  return applyLineRule(
    matrix[target[0]] as Pattern,
    matrix[target[1]] as Pattern,
    rule,
  );
}

function completeFromProgram(
  matrix: Matrix,
  program: RuleProgram,
): Pattern | null {
  if (program.family === "combine-change") {
    const target = lineIndexes(program.axis)[2];
    return applyComposedRule(
      matrix[target[0]] as Pattern,
      matrix[target[1]] as Pattern,
      program,
    );
  }
  if (
    program.family === "boolean-closure" ||
    program.family === "boolean-closure-change"
  ) {
    const target = lineIndexes(program.axis)[2];
    return applyBooleanClosureRule(
      matrix[target[0]] as Pattern,
      matrix[target[1]] as Pattern,
      program,
    );
  }
  return completeFromRule(matrix, program);
}

export function applyMatrixRule(
  first: Pattern,
  second: Pattern,
  rule: MatrixRule,
): Pattern {
  if (rule.family === "grid") {
    throw new Error("A whole-matrix rule cannot be applied to one input pair.");
  }
  const result = applyLineRule(first, second, rule);
  if (!result) {
    throw new Error("The supplied panels do not satisfy the rule preconditions.");
  }
  return result;
}

function ruleMatchesLine(
  matrix: Matrix,
  rule: CombineRule | SequenceRule,
  lineIndex: number,
): boolean {
  const indexes = lineIndexes(rule.axis)[lineIndex];
  const result = applyLineRule(
    matrix[indexes[0]] as Pattern,
    matrix[indexes[1]] as Pattern,
    rule,
  );
  return (
    result !== null &&
    patternKey(result) === patternKey(matrix[indexes[2]] as Pattern)
  );
}

export function ruleMatchesEvidence(
  matrix: Matrix,
  rule: MatrixRule,
): boolean {
  if (rule.family === "grid") {
    const completed = completedGridFromSources(
      gridSourcesFromMatrix(matrix),
      rule,
    );
    if (!completed) return false;
    return matrix.every((pattern, index) => {
      if (pattern === null) return true;
      return patternKey(pattern) === patternKey(completed[index]);
    });
  }
  return ruleMatchesLine(matrix, rule, 0) && ruleMatchesLine(matrix, rule, 1);
}

export function programMatchesEvidence(
  matrix: Matrix,
  program: RuleProgram,
): boolean {
  if (
    program.family !== "combine-change" &&
    program.family !== "boolean-closure" &&
    program.family !== "boolean-closure-change"
  ) {
    return ruleMatchesEvidence(matrix, program);
  }
  return [0, 1].every((lineIndex) => {
    const indexes = lineIndexes(program.axis)[lineIndex];
    const result =
      program.family === "combine-change"
        ? applyComposedRule(
            matrix[indexes[0]] as Pattern,
            matrix[indexes[1]] as Pattern,
            program,
          )
        : applyBooleanClosureRule(
            matrix[indexes[0]] as Pattern,
            matrix[indexes[1]] as Pattern,
            program,
          );
    return (
      result !== null &&
      patternKey(result) === patternKey(matrix[indexes[2]] as Pattern)
    );
  });
}

const ALL_COMBINE_RULES: readonly CombineRule[] = (
  ["rows", "columns"] as const
).flatMap((axis) =>
  OPERATIONS.flatMap((operation) =>
    PATTERN_TRANSFORMS.map((transform) => ({
      family: "combine" as const,
      axis,
      operation,
      transform,
    })),
  ),
);

const ALL_SEQUENCE_RULES: readonly SequenceRule[] = (
  ["rows", "columns"] as const
).flatMap((axis) =>
  SEQUENCE_STEPS.map((step) => ({
    family: "sequence" as const,
    axis,
    step,
  })),
);

const ALL_GRID_RULES: readonly GridRule[] = GRID_OPERATIONS.flatMap(
  (operation) =>
    GRID_TRANSFORMS.map((transform) => ({
      family: "grid" as const,
      operation,
      transform,
    })),
);

const ALL_COMPOSED_RULES: readonly ComposedRule[] = (
  ["rows", "columns"] as const
).flatMap((axis) =>
  OPERATIONS.flatMap((operation) =>
    COMPOSABLE_SEQUENCE_STEPS.map((step) => ({
      family: "combine-change" as const,
      axis,
      operation,
      step,
    })),
  ),
);

const ALL_BOOLEAN_CLOSURE_RULES: readonly BooleanClosureRule[] = (
  ["rows", "columns"] as const
).flatMap((axis) =>
  COMPOSED_BOOLEAN_TRUTH_TABLES.flatMap((truthTable) =>
    PATTERN_TRANSFORMS.map((transform) => ({
      family: "boolean-closure" as const,
      axis,
      truthTable,
      transform,
    })),
  ),
);

const ALL_BOOLEAN_CLOSURE_CHANGE_RULES:
  readonly BooleanClosureChangeRule[] = (
  ["rows", "columns"] as const
).flatMap((axis) =>
  COMPOSED_BOOLEAN_TRUTH_TABLES.flatMap((truthTable) =>
    COMPOSABLE_SEQUENCE_STEPS.map((step) => ({
      family: "boolean-closure-change" as const,
      axis,
      truthTable,
      step,
    })),
  ),
);

export const ALL_RULES: readonly MatrixRule[] = [
  ...ALL_COMBINE_RULES,
  ...ALL_SEQUENCE_RULES,
  ...ALL_GRID_RULES,
];

/**
 * The complete player-visible grammar: every normalized Boolean function that
 * genuinely depends on both inputs, followed by zero or one change, plus a
 * standalone sequence or explicit grid cascade. Constant and projection
 * expressions are not combine rules because they discard a shown input.
 * Validation enumerates this same catalogue so an equivalent compound
 * expression can never silently produce a second interpretation.
 */
export const PLAYER_RULE_PROGRAMS: readonly RuleProgram[] = [
  ...ALL_RULES,
  ...ALL_COMPOSED_RULES,
  ...ALL_BOOLEAN_CLOSURE_RULES,
  ...ALL_BOOLEAN_CLOSURE_CHANGE_RULES,
];

export function compatibleRules(matrix: Matrix): readonly MatrixRule[] {
  return ALL_RULES.filter((rule) => ruleMatchesEvidence(matrix, rule));
}

export function compatiblePrograms(matrix: Matrix): readonly RuleProgram[] {
  return PLAYER_RULE_PROGRAMS.filter((program) =>
    programMatchesEvidence(matrix, program),
  );
}

export function inferredAnswerKeys(matrix: Matrix): ReadonlySet<string> {
  return new Set(
    compatiblePrograms(matrix).flatMap((program) => {
      const answer = completeFromProgram(matrix, program);
      return answer ? [patternKey(answer)] : [];
    }),
  );
}

export function inferenceOptionIndexes(
  matrix: Matrix,
  options: readonly Pattern[],
): readonly number[] {
  const validAnswers = inferredAnswerKeys(matrix);
  return options.flatMap((option, index) =>
    validAnswers.has(patternKey(option)) ? [index] : [],
  );
}

function buildCompletedMatrix(
  rule: MatrixRule,
  sourcePatterns: readonly Pattern[],
): CompletedMatrix | null {
  if (rule.family === "grid") {
    return completedGridFromSources(sourcePatterns, rule);
  }

  if (rule.family === "sequence") {
    if (sourcePatterns.length !== 3) return null;
    const lines = sourcePatterns.map((base) => {
      const second = applySequenceStep(base, rule.step);
      const third = second ? applySequenceStep(second, rule.step) : null;
      return second && third ? ([base, second, third] as const) : null;
    });
    if (lines.some((line) => line === null)) return null;
    const completeLines = lines as Array<readonly [Pattern, Pattern, Pattern]>;
    if (rule.axis === "rows") {
      return completeLines.flat() as unknown as CompletedMatrix;
    }
    return [
      completeLines[0][0],
      completeLines[1][0],
      completeLines[2][0],
      completeLines[0][1],
      completeLines[1][1],
      completeLines[2][1],
      completeLines[0][2],
      completeLines[1][2],
      completeLines[2][2],
    ];
  }

  if (sourcePatterns.length !== 6) return null;
  const lines = [0, 1, 2].map((lineIndex) => {
    const first = sourcePatterns[lineIndex * 2];
    const second = sourcePatterns[lineIndex * 2 + 1];
    const result = applyCombineRule(first, second, rule);
    return result ? ([first, second, result] as const) : null;
  });
  if (lines.some((line) => line === null)) return null;
  const completeLines = lines as Array<readonly [Pattern, Pattern, Pattern]>;
  if (rule.axis === "rows") {
    return completeLines.flat() as unknown as CompletedMatrix;
  }
  return [
    completeLines[0][0],
    completeLines[1][0],
    completeLines[2][0],
    completeLines[0][1],
    completeLines[1][1],
    completeLines[2][1],
    completeLines[0][2],
    completeLines[1][2],
    completeLines[2][2],
  ];
}

function hideFinalPattern(completed: CompletedMatrix): Matrix {
  return [
    completed[0],
    completed[1],
    completed[2],
    completed[3],
    completed[4],
    completed[5],
    completed[6],
    completed[7],
    null,
  ];
}

function singleLineCompatibleRules(
  matrix: Matrix,
  axis: Axis,
  evidenceIndex: number,
): readonly (CombineRule | SequenceRule)[] {
  return [...ALL_COMBINE_RULES, ...ALL_SEQUENCE_RULES].filter(
    (rule) => rule.axis === axis && ruleMatchesLine(matrix, rule, evidenceIndex),
  );
}

function targetPredictionKeys(
  matrix: Matrix,
  rules: readonly (CombineRule | SequenceRule)[],
): ReadonlySet<string> {
  return new Set(
    rules.flatMap((rule) => {
      const result = completeFromRule(matrix, rule);
      return result ? [patternKey(result)] : [];
    }),
  );
}

function relevantLineKeys(
  completed: CompletedMatrix,
  rule: CombineRule | SequenceRule,
): readonly string[] {
  return lineIndexes(rule.axis).map((indexes) =>
    indexes.map((index) => patternKey(completed[index])).join(">"),
  );
}

function intermediatePattern(
  first: Pattern,
  second: Pattern,
  rule: CombineRule,
): Pattern | null {
  return combinePatterns(first, second, rule.operation);
}

const GRID_EVIDENCE_RELATIONS = [
  [0, 1, 2],
  [0, 3, 6],
  [1, 3, 4],
  [2, 4, 5],
  [4, 6, 7],
] as const;

function compatibleGridRulesForRelation(
  completed: CompletedMatrix,
  relation: readonly [number, number, number],
): readonly GridRule[] {
  const [firstIndex, secondIndex, resultIndex] = relation;
  return ALL_GRID_RULES.filter((candidate) => {
    const result = applyGridPair(
      completed[firstIndex],
      completed[secondIndex],
      candidate,
    );
    return (
      result !== null &&
      patternKey(result) === patternKey(completed[resultIndex])
    );
  });
}

function validatesInterestingness(
  completed: CompletedMatrix,
  matrix: Matrix,
  rule: MatrixRule,
  difficulty: Difficulty,
): readonly string[] {
  const errors: string[] = [];
  const answer = completed[8];
  const visibleKeys = matrix.flatMap((pattern) =>
    pattern ? [patternKey(pattern)] : [],
  );

  if (visibleKeys.includes(patternKey(answer))) {
    errors.push("The answer must not already appear in the visible matrix.");
  }

  if (rule.family === "grid") {
    if (
      new Set(completed.map((pattern) => patternKey(pattern))).size !==
      completed.length
    ) {
      errors.push("Every whole-matrix panel must add distinct evidence.");
    }

    for (const relation of GRID_EVIDENCE_RELATIONS) {
      const candidates = compatibleGridRulesForRelation(
        completed,
        relation,
      );
      const targetPredictions = new Set(
        candidates.flatMap((candidate) => {
          const prediction = applyGridPair(
            completed[5],
            completed[7],
            candidate,
          );
          return prediction ? [patternKey(prediction)] : [];
        }),
      );
      if (candidates.length < 2 || targetPredictions.size < 2) {
        errors.push(
          "Every visible cascade relation must remain ambiguous on its own.",
        );
        break;
      }
    }
  } else {
    const lines = lineIndexes(rule.axis);
    const lineKeys = relevantLineKeys(completed, rule);
    if (new Set(lineKeys).size !== lineKeys.length) {
      errors.push("No completed relation line may repeat another line.");
    }

    for (const indexes of lines) {
      const first = completed[indexes[0]];
      const second = completed[indexes[1]];
      const result = completed[indexes[2]];
      if (
        patternKey(result) === patternKey(first) ||
        patternKey(result) === patternKey(second)
      ) {
        errors.push("A result must visibly differ from both of its inputs.");
        break;
      }
    }

    if (rule.family === "combine" && rule.transform !== "none") {
      for (const indexes of lines) {
        const intermediate = intermediatePattern(
          completed[indexes[0]],
          completed[indexes[1]],
          rule,
        );
        if (
          !intermediate ||
          patternKey(intermediate) === patternKey(completed[indexes[2]])
        ) {
          errors.push(
            "Every chained transform must visibly change its intermediate.",
          );
          break;
        }
      }
    }

    // A complete sequence line necessarily names its step once that step is in
    // the visible catalogue. Requiring two competing predictions per line
    // therefore rejects every honest sequence puzzle. Sequence rounds instead
    // use two distinct completed lines to confirm the same step; the stronger
    // single-line ambiguity check remains useful for binary-operation rounds.
    if (
      rule.family === "combine" &&
      (difficulty === "Hard" || difficulty === "Wizard")
    ) {
      for (const evidenceIndex of [0, 1]) {
        const compatible = singleLineCompatibleRules(
          matrix,
          rule.axis,
          evidenceIndex,
        );
        if (
          compatible.length < 2 ||
          targetPredictionKeys(matrix, compatible).size < 2
        ) {
          errors.push(
            "Each harder evidence line must remain insufficient on its own.",
          );
          break;
        }
      }
    }
  }

  return errors;
}

function localMutations(pattern: Pattern): readonly Pattern[] {
  const mutations: Pattern[] = [];
  for (let index = 0; index < 4; index += 1) {
    mutations.push(makePattern(pattern.mask ^ (1 << index), pattern));
  }
  mutations.push(
    makePattern(pattern.mask, {
      ...pattern,
      scale: ((pattern.scale + 1) % 3) as MotifScale,
    }),
  );
  mutations.push(
    makePattern(pattern.mask, {
      ...pattern,
      shape: SHAPES[(SHAPES.indexOf(pattern.shape) + 1) % SHAPES.length],
    }),
  );
  mutations.push(
    makePattern(pattern.mask, {
      ...pattern,
      fill: FILLS[(FILLS.indexOf(pattern.fill) + 1) % FILLS.length],
      texturePhase: 0,
    }),
  );
  if (pattern.shape === "triangle" || pattern.shape === "bar") {
    mutations.push(
      makePattern(pattern.mask, {
        ...pattern,
        orientation: normalizeOrientation(
          pattern.shape,
          pattern.orientation + 1,
        ),
      }),
    );
  }
  if (pattern.fill === "striped") {
    mutations.push(
      makePattern(pattern.mask, {
        ...pattern,
        texturePhase: normalizeTurn(pattern.texturePhase + 1),
      }),
    );
  }
  return mutations;
}

function clearContrastMutations(pattern: Pattern): readonly Pattern[] {
  const mutations: Pattern[] = [];
  for (let first = 0; first < 4; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      mutations.push(
        makePattern(
          pattern.mask ^ (1 << first) ^ (1 << second),
          pattern,
        ),
      );
    }
  }
  return mutations;
}

function misconceptionPrediction(
  matrix: Matrix,
  program: RuleProgram,
): Pattern | null {
  if (program.family === "sequence") {
    const target = lineIndexes(program.axis)[2];
    return applySequenceStep(
      matrix[target[1]] as Pattern,
      program.step,
    );
  }
  return completeFromProgram(matrix, program);
}

function distractorCandidates(
  matrix: Matrix,
  rule: MatrixRule,
  correct: Pattern,
): readonly DistractorCandidate[] {
  const candidates: DistractorCandidate[] = [];
  const seen = new Set([patternKey(correct)]);

  const add = (
    kind: Exclude<OptionKind, "correct">,
    pattern: Pattern | null,
  ) => {
    if (!pattern || pattern.mask === 0) return;
    const key = patternKey(pattern);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, pattern });
  };

  if (rule.family === "combine" && rule.transform !== "none") {
    const target = lineIndexes(rule.axis)[2];
    add(
      "skipped-stage",
      combinePatterns(
        matrix[target[0]] as Pattern,
        matrix[target[1]] as Pattern,
        rule.operation,
      ),
    );
  }

  for (const candidateProgram of PLAYER_RULE_PROGRAMS) {
    if (programKey(candidateProgram) === programKey(rule)) continue;
    add(
      "wrong-rule",
      misconceptionPrediction(matrix, candidateProgram),
    );
  }

  for (const mutation of localMutations(correct)) {
    add("one-feature-off", mutation);
  }
  for (const mutation of clearContrastMutations(correct)) {
    add("clear-contrast", mutation);
  }

  return candidates.sort((left, right) => {
    const distance =
      patternDistance(left.pattern, correct) -
      patternDistance(right.pattern, correct);
    if (distance !== 0) return distance;
    if (left.kind < right.kind) return -1;
    if (left.kind > right.kind) return 1;
    return patternKey(left.pattern) < patternKey(right.pattern) ? -1 : 1;
  });
}

function chooseDistractors(
  matrix: Matrix,
  rule: MatrixRule,
  correct: Pattern,
  difficulty: Difficulty,
): readonly [
  DistractorCandidate,
  DistractorCandidate,
  DistractorCandidate,
] | null {
  const sizeIsTheRule =
    rule.family === "sequence" &&
    (rule.step === "grow" || rule.step === "shrink");
  const candidates = distractorCandidates(matrix, rule, correct).filter(
    ({ pattern }) => {
      if (difficulty === "Easy") {
        return (
          patternStyleKey(pattern) === patternStyleKey(correct) &&
          maskDifferenceCount(pattern, correct) >= 2
        );
      }
      if (difficulty === "Medium") {
        return (
          maskDifferenceCount(pattern, correct) >= 2 &&
          pattern.shape === correct.shape &&
          pattern.fill === correct.fill &&
          (sizeIsTheRule || pattern.scale === correct.scale)
        );
      }
      return true;
    },
  );
  const selected: DistractorCandidate[] = [];
  const requiresGenerousSeparation =
    difficulty === "Easy" || difficulty === "Medium";

  const take = (
    predicate: (candidate: DistractorCandidate) => boolean,
  ): boolean => {
    const candidate = candidates.find(
      (item) =>
        !selected.includes(item) &&
        !selected.some(
          (chosen) =>
            chosen.pattern.mask === item.pattern.mask ||
            (requiresGenerousSeparation &&
              maskDifferenceCount(chosen.pattern, item.pattern) < 2),
        ) &&
        predicate(item),
    );
    if (!candidate) return false;
    selected.push(candidate);
    return true;
  };

  if (difficulty === "Easy") {
    if (!take(({ kind }) => kind === "wrong-rule")) return null;
    if (!take(() => true)) return null;
  } else if (difficulty === "Medium") {
    if (!take(({ kind }) => kind === "wrong-rule")) return null;
    if (!take(() => true)) return null;
  } else {
    if (!take(({ kind }) => kind === "one-feature-off")) return null;
    if (!take(({ kind }) => kind === "wrong-rule")) return null;
  }
  if (!take(() => true)) return null;

  return [
    selected[0],
    selected[1],
    selected[2],
  ];
}

function validateCorrectIndex(correctIndex: number): void {
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new Error(`Correct answer index must be from 0 to 3: ${correctIndex}`);
  }
}

export function buildRound(blueprint: RoundBlueprint): Round {
  validateCorrectIndex(blueprint.correctIndex);
  const completed = buildCompletedMatrix(
    blueprint.rule,
    blueprint.sourcePatterns,
  );
  if (!completed) {
    throw new Error(`${blueprint.id} has invalid source panels for its rule.`);
  }
  const matrix = hideFinalPattern(completed);
  const correctPattern = completed[8];
  const distractors = chooseDistractors(
    matrix,
    blueprint.rule,
    correctPattern,
    blueprint.difficulty,
  );
  if (!distractors) {
    throw new Error(`${blueprint.id} could not produce meaningful options.`);
  }

  const options = distractors.map(({ pattern }) => pattern);
  const optionKinds: OptionKind[] = distractors.map(({ kind }) => kind);
  options.splice(blueprint.correctIndex, 0, correctPattern);
  optionKinds.splice(blueprint.correctIndex, 0, "correct");

  const round: Round = {
    id: blueprint.id,
    difficulty: blueprint.difficulty,
    matrix,
    rule: blueprint.rule,
    hintPolicy: hintPolicyForDifficulty(blueprint.difficulty),
    options: options as unknown as Round["options"],
    optionKinds: optionKinds as unknown as Round["optionKinds"],
    correctIndex: blueprint.correctIndex,
    correctPattern,
  };
  const errors = validateRound(round);
  if (errors.length > 0) {
    throw new Error(`${blueprint.id} is invalid: ${errors.join(" ")}`);
  }
  return round;
}

function isDifficulty(value: string): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

function ruleAllowedAtDifficulty(
  difficulty: Difficulty,
  rule: MatrixRule,
): boolean {
  if (rule.family === "grid") {
    return (
      (difficulty === "Hard" || difficulty === "Wizard") &&
      rule.operation === "cancel"
    );
  }
  if (difficulty === "Easy") {
    if (rule.axis !== "rows") return false;
    return (
      rule.family === "combine" &&
      (
        [
          "join",
          "overlap",
          "cancel",
          "left-minus-right",
        ] as readonly Operation[]
      ).includes(rule.operation) &&
      rule.transform === "none"
    );
  }
  if (difficulty === "Medium") {
    if (rule.family === "combine") {
      return (
        rule.transform === "none" &&
        rule.operation !== "match" &&
        rule.operation !== "neither"
      );
    }
    return (
      [
        "rotate-clockwise",
        "rotate-counterclockwise",
        "grow",
        "shrink",
      ] as readonly SequenceStep[]
    ).includes(rule.step);
  }
  if (rule.family === "combine") {
    return (
      rule.transform !== "none" ||
      (
        ["match", "neither"] as readonly Operation[]
      ).includes(rule.operation)
    );
  }
  if (rule.family === "sequence") {
    return (
      [
        "move-clockwise",
        "shape-cycle",
        "fill-cycle",
        "texture-shift",
        "motif-turn",
      ] as readonly SequenceStep[]
    ).includes(rule.step);
  }
  return true;
}

export function validateRound(round: Round): readonly string[] {
  const errors: string[] = [];
  if (!isDifficulty(round.difficulty)) {
    return ["The round has an unknown difficulty."];
  }
  if (round.matrix.length !== 9 || round.matrix[8] !== null) {
    return ["The matrix must have eight panels and one final missing panel."];
  }
  if (!ruleAllowedAtDifficulty(round.difficulty, round.rule)) {
    errors.push("The rule is outside this difficulty’s allowed catalogue.");
  }
  if (round.hintPolicy !== hintPolicyForDifficulty(round.difficulty)) {
    errors.push("The hint policy must match the difficulty.");
  }
  if (!ruleMatchesEvidence(round.matrix, round.rule)) {
    errors.push("Every visible example must be produced by the declared rule.");
  }

  const answer = completeFromRule(round.matrix, round.rule);
  if (!answer || patternKey(answer) !== patternKey(round.correctPattern)) {
    errors.push("The answer must be calculated from the declared rule.");
  }

  const compatible = compatiblePrograms(round.matrix);
  if (
    compatible.length !== 1 ||
    programKey(compatible[0]) !== programKey(round.rule)
  ) {
    errors.push(
      "Exactly one normalized rule program in the complete taught grammar must fit.",
    );
  }

  const optionKeys = round.options.map(renderKey);
  if (round.options.length !== 4 || new Set(optionKeys).size !== 4) {
    errors.push("The four answer options must be visually distinct.");
  }
  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex > 3 ||
    optionKeys.filter((key) => key === renderKey(round.correctPattern)).length !==
      1 ||
    optionKeys[round.correctIndex] !== renderKey(round.correctPattern) ||
    round.optionKinds[round.correctIndex] !== "correct"
  ) {
    errors.push("Exactly one option must be the calculated answer.");
  }
  const inferredIndexes = inferenceOptionIndexes(
    round.matrix,
    round.options,
  );
  if (
    inferredIndexes.length !== 1 ||
    inferredIndexes[0] !== round.correctIndex
  ) {
    errors.push(
      "The complete taught rule grammar must infer only the calculated option.",
    );
  }
  if (
    round.options.some((pattern) => pattern.mask === 0) ||
    round.matrix.some((pattern) => pattern?.mask === 0)
  ) {
    errors.push("Visible panels and options must not be empty.");
  }

  if (answer) {
    const completed = [
      ...round.matrix.slice(0, 8),
      answer,
    ] as unknown as CompletedMatrix;
    errors.push(
      ...validatesInterestingness(
        completed,
        round.matrix,
        round.rule,
        round.difficulty,
      ),
    );
  }

  const wrongOptions = round.options.filter(
    (_, index) => index !== round.correctIndex,
  );
  if (
    (round.difficulty === "Easy" || round.difficulty === "Medium") &&
    round.options.some((option, optionIndex) =>
      round.options
        .slice(optionIndex + 1)
        .some(
          (otherOption) =>
            maskDifferenceCount(option, otherOption) < 2,
        ),
    )
  ) {
    errors.push(
      "Every pair of Starter and Junior options must differ in at least two positions.",
    );
  }
  if (round.difficulty === "Easy") {
    if (
      wrongOptions.some(
        (option) =>
          patternStyleKey(option) !==
            patternStyleKey(round.correctPattern) ||
          maskDifferenceCount(option, round.correctPattern) < 2,
      )
    ) {
      errors.push(
        "Starter distractors must share the answer style and differ in at least two positions.",
      );
    }
  } else if (round.difficulty === "Medium") {
    const sizeIsTheRule =
      round.rule.family === "sequence" &&
      (round.rule.step === "grow" || round.rule.step === "shrink");
    if (
      wrongOptions.some(
        (option) =>
          maskDifferenceCount(option, round.correctPattern) < 2 ||
          option.shape !== round.correctPattern.shape ||
          option.fill !== round.correctPattern.fill ||
          (!sizeIsTheRule &&
            option.scale !== round.correctPattern.scale),
      )
    ) {
      errors.push(
        "Junior distractors must use clearly different positions without unrelated shape, fill, or size traps.",
      );
    }
  } else if (
    !wrongOptions.some(
      (option) => patternDistance(option, round.correctPattern) === 1,
    )
  ) {
    errors.push("Every Expert and Wizard round must include a one-feature near miss.");
  }
  if (
    !round.optionKinds.some(
      (kind, index) => index !== round.correctIndex && kind === "wrong-rule",
    )
  ) {
    errors.push("Every round must include a named rule misconception.");
  }

  return errors;
}

export function incorrectFeedback(
  round: Round,
  optionIndex: number,
): IncorrectFeedback {
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= round.options.length ||
    optionIndex === round.correctIndex
  ) {
    throw new Error(`Unknown incorrect answer option: ${optionIndex}`);
  }

  if (round.hintPolicy === "never") {
    return {
      heading: "Try again",
      message:
        "This choice does not satisfy the same complete relation as all visible evidence.",
      differenceCount: null,
      revealDifferences: false,
    };
  }

  const differenceCount = patternDistance(
    round.options[optionIndex],
    round.correctPattern,
  );
  return {
    heading: "Try again",
    message:
      round.hintPolicy === "after-miss"
        ? "The visual rule hint is now available. Check both examples before trying again."
        : `This choice differs from the rule result in ${differenceCount} ${
            differenceCount === 1 ? "feature" : "features"
          }.`,
    differenceCount,
    revealDifferences: round.hintPolicy === "always",
  };
}

function unitRandom(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a finite number from 0 up to 1.");
  }
  return value;
}

function randomInteger(
  random: RandomSource,
  exclusiveMaximum: number,
): number {
  return Math.floor(unitRandom(random) * exclusiveMaximum);
}

function randomChoice<T>(random: RandomSource, values: readonly T[]): T {
  return values[randomInteger(random, values.length)];
}

function hashSeed(seed: number | string): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new Error("Seed must be finite.");
    return seed >>> 0;
  }
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number | string): RandomSource {
  let state = hashSeed(seed);
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function randomNonEmptyMask(random: RandomSource): number {
  return 1 + randomInteger(random, FULL_MASK);
}

function usefulSourceMaskPairs(
  operation: Operation,
): readonly (readonly [number, number])[] {
  const pairs: Array<readonly [number, number]> = [];
  for (let left = 1; left <= FULL_MASK; left += 1) {
    for (let right = 1; right <= FULL_MASK; right += 1) {
      const result = operationMask(left, right, operation);
      if (result !== 0 && result !== left && result !== right) {
        pairs.push([left, right]);
      }
    }
  }
  return pairs;
}

function randomStyle(
  random: RandomSource,
  step?: SequenceStep,
): Omit<Pattern, "mask"> {
  const shape =
    step === "motif-turn"
      ? randomChoice(random, ["triangle", "bar"] as const)
      : randomChoice(random, SHAPES);
  const fill =
    step === "texture-shift"
      ? "striped"
      : randomChoice(random, FILLS);
  const scale =
    step === "grow"
      ? 0
      : step === "shrink"
        ? 2
        : (randomInteger(random, 3) as MotifScale);
  return {
    shape,
    fill,
    scale,
    orientation: normalizeOrientation(shape, randomInteger(random, 4)),
    texturePhase:
      fill === "striped"
        ? (randomInteger(random, 4) as TexturePhase)
        : 0,
  };
}

function randomSourcePatterns(
  difficulty: Difficulty,
  rule: MatrixRule,
  random: RandomSource,
): readonly Pattern[] {
  if (rule.family === "grid") {
    const style = randomStyle(random);
    return Array.from({ length: 3 }, () =>
      makePattern(randomNonEmptyMask(random), style),
    );
  }
  if (rule.family === "sequence") {
    return Array.from({ length: 3 }, () =>
      makePattern(randomNonEmptyMask(random), randomStyle(random, rule.step)),
    );
  }
  return Array.from({ length: 3 }, () => {
    const style =
      difficulty === "Easy"
        ? {
            shape: randomChoice(
              random,
              ["circle", "square"] as const,
            ),
            fill: randomChoice(
              random,
              ["solid", "outline"] as const,
            ),
            scale: 1 as const,
            orientation: 0 as const,
            texturePhase: 0 as const,
          }
        : randomStyle(random);
    if (difficulty === "Easy") {
      const [leftMask, rightMask] = randomChoice(
        random,
        usefulSourceMaskPairs(rule.operation),
      );
      return [
        makePattern(leftMask, style),
        makePattern(rightMask, style),
      ];
    }
    return [
      makePattern(randomNonEmptyMask(random), style),
      makePattern(randomNonEmptyMask(random), style),
    ];
  }).flat();
}

export const GENERATOR_MAX_ATTEMPTS = 512;

export function generateRoundForRule(
  difficulty: Difficulty,
  rule: MatrixRule,
  random: RandomSource,
  correctIndex: number,
  idPrefix: string,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  if (!ruleAllowedAtDifficulty(difficulty, rule)) {
    throw new Error(`${ruleLabel(rule)} is not allowed at ${difficulty}.`);
  }
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const blueprint: RoundBlueprint = {
      id: `${idPrefix}-${attempt + 1}`,
      difficulty,
      rule,
      sourcePatterns: randomSourcePatterns(difficulty, rule, random),
      correctIndex,
    };
    try {
      const round = buildRound(blueprint);
      if (!excludedFingerprints.has(roundFingerprint(round))) return round;
    } catch {
      // Rejection is expected; bounded exhaustion below is the safe failure.
    }
  }
  throw new Error(
    `Unable to generate a valid ${difficulty} round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

export function rulesForDifficulty(
  difficulty: Difficulty,
): readonly MatrixRule[] {
  return ALL_RULES.filter((rule) => ruleAllowedAtDifficulty(difficulty, rule));
}

export function generateInfiniteRound(
  difficulty: Difficulty,
  random: RandomSource = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  if (!isDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }
  const allowedRules = rulesForDifficulty(difficulty);
  const rule = randomChoice(random, allowedRules);
  const correctIndex = randomInteger(random, 4);
  return generateRoundForRule(
    difficulty,
    rule,
    random,
    correctIndex,
    `infinite-${difficulty.toLowerCase()}`,
    excludedFingerprints,
  );
}

export function roundFingerprint(round: Round): string {
  const visible = round.matrix
    .map((pattern) => (pattern ? patternKey(pattern) : "?"))
    .join("/");
  return `${visible}=>${patternKey(round.correctPattern)}`;
}

export function blueprintFromRound(round: Round): RoundBlueprint {
  if (round.rule.family === "grid") {
    return {
      id: round.id,
      difficulty: round.difficulty,
      rule: round.rule,
      sourcePatterns: [
        round.matrix[0] as Pattern,
        round.matrix[1] as Pattern,
        round.matrix[3] as Pattern,
      ],
      correctIndex: round.correctIndex,
    };
  }

  const indexes = lineIndexes(round.rule.axis);
  const sourcePatterns =
    round.rule.family === "sequence"
      ? indexes.map(([first]) => round.matrix[first] as Pattern)
      : indexes.flatMap(([first, second]) => [
          round.matrix[first] as Pattern,
          round.matrix[second] as Pattern,
        ]);
  return {
    id: round.id,
    difficulty: round.difficulty,
    rule: round.rule,
    sourcePatterns,
    correctIndex: round.correctIndex,
  };
}
