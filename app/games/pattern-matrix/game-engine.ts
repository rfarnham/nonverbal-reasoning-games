export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";

/**
 * A compact 2×2 dot pattern, in reading order:
 * top-left, top-right, bottom-left, bottom-right.
 */
export type Pattern = readonly [boolean, boolean, boolean, boolean];

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

export type Operation =
  | "join"
  | "overlap"
  | "cancel"
  | "left-minus-right"
  | "right-minus-left";

export type PatternTransform =
  | "none"
  | "rotate-clockwise"
  | "rotate-half"
  | "rotate-counterclockwise";

export type MatrixRule = {
  operation: Operation;
  transform: PatternTransform;
};

export type CueMode = "full-rule" | "operation-only" | "hidden";

export type DistractorKind =
  | "used-join"
  | "used-overlap"
  | "used-cancel"
  | "used-left-minus-right"
  | "used-right-minus-left"
  | "kept-left"
  | "kept-right"
  | "skipped-turn"
  | "wrong-turn"
  | "one-dot-added"
  | "one-dot-removed";

export type OptionKind = "correct" | DistractorKind;

export type Round = {
  id: string;
  difficulty: Difficulty;
  matrix: Matrix;
  rule: MatrixRule;
  cueMode: CueMode;
  options: readonly Pattern[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
  correctPattern: Pattern;
};

export type IncorrectFeedback = {
  heading: "Try again";
  message: string;
  differenceCount: number | null;
  revealDifferences: boolean;
};

type RandomSource = () => number;

type DifficultyRules = {
  operations: readonly Operation[];
  transforms: readonly PatternTransform[];
  cueMode: CueMode;
  minInputDots: number;
  maxInputDots: number;
  minOutputDots: number;
  maxOutputDots: number;
  requireOverlap: boolean;
  maximumDistractorDifference: number;
};

type DistractorCandidate = {
  kind: DistractorKind;
  pattern: Pattern;
};

type AuthoredRoundSpec = {
  matrixMasks: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  rule: MatrixRule;
  optionMasks: readonly [number, number, number, number];
  optionKinds: readonly [OptionKind, OptionKind, OptionKind, OptionKind];
  correctIndex: number;
};

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
];

export const PATTERN_TRANSFORMS: readonly PatternTransform[] = [
  "none",
  "rotate-clockwise",
  "rotate-half",
  "rotate-counterclockwise",
];

const NON_IDENTITY_TRANSFORMS: readonly PatternTransform[] = [
  "rotate-clockwise",
  "rotate-half",
  "rotate-counterclockwise",
];

const OPERATION_LABELS: Record<Operation, string> = {
  join: "Join",
  overlap: "Keep overlap",
  cancel: "Cancel matches",
  "left-minus-right": "Left minus right",
  "right-minus-left": "Right minus left",
};

const OPERATION_RULE_TEXT: Record<Operation, string> = {
  join: "Join the two patterns",
  overlap: "Keep only their overlapping dots",
  cancel: "Cancel the dots they share",
  "left-minus-right": "Remove the right pattern's dots from the left",
  "right-minus-left": "Remove the left pattern's dots from the right",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  Easy: "Starter",
  Medium: "Junior",
  Hard: "Expert",
  Wizard: "Wizard",
};

const TRANSFORM_LABELS: Record<PatternTransform, string> = {
  none: "keep the result in place",
  "rotate-clockwise": "turn the result right",
  "rotate-half": "turn the result halfway",
  "rotate-counterclockwise": "turn the result left",
};

const OPERATION_DISTRACTOR_KINDS: Record<Operation, DistractorKind> = {
  join: "used-join",
  overlap: "used-overlap",
  cancel: "used-cancel",
  "left-minus-right": "used-left-minus-right",
  "right-minus-left": "used-right-minus-left",
};

const EXPERT_GENERATION_RULES = {
  operations: OPERATIONS,
  transforms: NON_IDENTITY_TRANSFORMS,
  minInputDots: 2,
  maxInputDots: 3,
  minOutputDots: 1,
  maxOutputDots: 3,
  requireOverlap: true,
  maximumDistractorDifference: 2,
} as const;

const DIFFICULTY_RULES: Record<Difficulty, DifficultyRules> = {
  Easy: {
    operations: ["join"],
    transforms: ["none"],
    cueMode: "full-rule",
    minInputDots: 1,
    maxInputDots: 2,
    minOutputDots: 2,
    maxOutputDots: 3,
    requireOverlap: false,
    maximumDistractorDifference: 3,
  },
  Medium: {
    operations: OPERATIONS,
    transforms: ["none"],
    cueMode: "full-rule",
    minInputDots: 2,
    maxInputDots: 3,
    minOutputDots: 1,
    maxOutputDots: 3,
    requireOverlap: true,
    maximumDistractorDifference: 3,
  },
  Hard: {
    ...EXPERT_GENERATION_RULES,
    cueMode: "operation-only",
  },
  Wizard: {
    ...EXPERT_GENERATION_RULES,
    cueMode: "hidden",
  },
};

export const GENERATOR_MAX_ATTEMPTS = 192;

/** Frozen, reviewed Campaign stimuli; only Infinite consults a random source. */
const AUTHORED_ROUND_SPECS: Record<
  Difficulty,
  readonly AuthoredRoundSpec[]
> = {
  Easy: [
    { matrixMasks: [8, 2, 10, 5, 2, 7, 4, 2], rule: { operation: "join", transform: "none" }, optionMasks: [6, 7, 4, 2], optionKinds: ["correct","one-dot-added","used-left-minus-right","used-right-minus-left"], correctIndex: 0 },
    { matrixMasks: [6, 1, 7, 9, 2, 11, 2, 1], rule: { operation: "join", transform: "none" }, optionMasks: [11, 1, 3, 2], optionKinds: ["one-dot-added","used-right-minus-left","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [5, 8, 13, 2, 1, 3, 1, 10], rule: { operation: "join", transform: "none" }, optionMasks: [15, 11, 10, 1], optionKinds: ["one-dot-added","correct","used-right-minus-left","used-left-minus-right"], correctIndex: 1 },
    { matrixMasks: [8, 5, 13, 5, 2, 7, 8, 5], rule: { operation: "join", transform: "none" }, optionMasks: [15, 5, 8, 13], optionKinds: ["one-dot-added","used-right-minus-left","used-left-minus-right","correct"], correctIndex: 3 },
    { matrixMasks: [2, 12, 14, 2, 9, 11, 9, 4], rule: { operation: "join", transform: "none" }, optionMasks: [5, 13, 4, 9], optionKinds: ["one-dot-removed","correct","used-right-minus-left","used-left-minus-right"], correctIndex: 1 },
    { matrixMasks: [4, 10, 14, 8, 4, 12, 12, 1], rule: { operation: "join", transform: "none" }, optionMasks: [13, 15, 1, 12], optionKinds: ["correct","one-dot-added","used-right-minus-left","used-left-minus-right"], correctIndex: 0 },
    { matrixMasks: [8, 1, 9, 8, 1, 9, 10, 4], rule: { operation: "join", transform: "none" }, optionMasks: [15, 10, 4, 14], optionKinds: ["one-dot-added","used-left-minus-right","used-right-minus-left","correct"], correctIndex: 3 },
    { matrixMasks: [1, 4, 5, 2, 5, 7, 1, 12], rule: { operation: "join", transform: "none" }, optionMasks: [5, 12, 13, 1], optionKinds: ["one-dot-removed","used-right-minus-left","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [2, 4, 6, 2, 5, 7, 2, 1], rule: { operation: "join", transform: "none" }, optionMasks: [11, 1, 2, 3], optionKinds: ["one-dot-added","used-right-minus-left","used-left-minus-right","correct"], correctIndex: 3 },
    { matrixMasks: [12, 2, 14, 8, 1, 9, 8, 6], rule: { operation: "join", transform: "none" }, optionMasks: [12, 14, 6, 8], optionKinds: ["one-dot-removed","correct","used-right-minus-left","used-left-minus-right"], correctIndex: 1 },
    { matrixMasks: [1, 8, 9, 5, 8, 13, 4, 1], rule: { operation: "join", transform: "none" }, optionMasks: [13, 1, 5, 4], optionKinds: ["one-dot-added","used-right-minus-left","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [8, 5, 13, 12, 2, 14, 8, 2], rule: { operation: "join", transform: "none" }, optionMasks: [10, 11, 2, 8], optionKinds: ["correct","one-dot-added","used-right-minus-left","used-left-minus-right"], correctIndex: 0 },
  ],
  Medium: [
    { matrixMasks: [9, 3, 11, 3, 10, 11, 12, 6], rule: { operation: "join", transform: "none" }, optionMasks: [15, 14, 4, 10], optionKinds: ["one-dot-added","correct","used-overlap","used-cancel"], correctIndex: 1 },
    { matrixMasks: [14, 6, 8, 13, 10, 7, 6, 3], rule: { operation: "cancel", transform: "none" }, optionMasks: [13, 1, 4, 5], optionKinds: ["one-dot-added","used-right-minus-left","used-left-minus-right","correct"], correctIndex: 3 },
    { matrixMasks: [12, 6, 4, 7, 12, 4, 13, 10], rule: { operation: "overlap", transform: "none" }, optionMasks: [8, 12, 2, 5], optionKinds: ["correct","one-dot-added","used-right-minus-left","used-left-minus-right"], correctIndex: 0 },
    { matrixMasks: [3, 13, 2, 12, 10, 4, 14, 9], rule: { operation: "left-minus-right", transform: "none" }, optionMasks: [4, 15, 6, 7], optionKinds: ["one-dot-removed","used-join","correct","used-cancel"], correctIndex: 2 },
    { matrixMasks: [13, 7, 2, 7, 14, 8, 7, 12], rule: { operation: "right-minus-left", transform: "none" }, optionMasks: [8, 10, 11, 3], optionKinds: ["correct","one-dot-added","used-cancel","used-left-minus-right"], correctIndex: 0 },
    { matrixMasks: [9, 5, 13, 3, 9, 11, 6, 12], rule: { operation: "join", transform: "none" }, optionMasks: [15, 10, 8, 14], optionKinds: ["one-dot-added","used-cancel","used-right-minus-left","correct"], correctIndex: 3 },
    { matrixMasks: [6, 5, 3, 11, 3, 8, 3, 14], rule: { operation: "cancel", transform: "none" }, optionMasks: [5, 12, 13, 1], optionKinds: ["one-dot-removed","used-right-minus-left","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [7, 13, 5, 12, 10, 8, 3, 13], rule: { operation: "overlap", transform: "none" }, optionMasks: [5, 1, 15, 12], optionKinds: ["one-dot-added","correct","used-join","used-right-minus-left"], correctIndex: 1 },
    { matrixMasks: [11, 6, 4, 13, 3, 2, 7, 11], rule: { operation: "right-minus-left", transform: "none" }, optionMasks: [10, 12, 8, 4], optionKinds: ["one-dot-added","used-cancel","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [5, 9, 4, 10, 13, 2, 13, 7], rule: { operation: "left-minus-right", transform: "none" }, optionMasks: [8, 12, 15, 2], optionKinds: ["correct","one-dot-added","used-join","used-right-minus-left"], correctIndex: 0 },
    { matrixMasks: [6, 10, 14, 5, 6, 7, 5, 6], rule: { operation: "join", transform: "none" }, optionMasks: [15, 7, 3, 4], optionKinds: ["one-dot-added","correct","used-cancel","used-overlap"], correctIndex: 1 },
    { matrixMasks: [7, 11, 12, 5, 13, 8, 3, 5], rule: { operation: "cancel", transform: "none" }, optionMasks: [14, 1, 2, 6], optionKinds: ["one-dot-added","used-overlap","used-left-minus-right","correct"], correctIndex: 3 },
  ],
  Hard: [
    { matrixMasks: [5, 3, 11, 6, 5, 11, 5, 9], rule: { operation: "join", transform: "rotate-clockwise" }, optionMasks: [6, 13, 7, 2], optionKinds: ["one-dot-removed","skipped-turn","correct","used-overlap"], correctIndex: 2 },
    { matrixMasks: [5, 14, 13, 7, 6, 8, 7, 5], rule: { operation: "cancel", transform: "rotate-half" }, optionMasks: [4, 6, 2, 14], optionKinds: ["correct","one-dot-added","skipped-turn","used-join"], correctIndex: 0 },
    { matrixMasks: [11, 5, 4, 14, 13, 10, 3, 6], rule: { operation: "overlap", transform: "rotate-counterclockwise" }, optionMasks: [5, 2, 4, 1], optionKinds: ["one-dot-added","skipped-turn","used-left-minus-right","correct"], correctIndex: 3 },
    { matrixMasks: [14, 7, 1, 12, 7, 1, 7, 11], rule: { operation: "left-minus-right", transform: "rotate-half" }, optionMasks: [10, 2, 4, 1], optionKinds: ["one-dot-added","correct","skipped-turn","used-right-minus-left"], correctIndex: 1 },
    { matrixMasks: [9, 5, 1, 3, 5, 1, 11, 14], rule: { operation: "right-minus-left", transform: "rotate-clockwise" }, optionMasks: [9, 4, 2, 1], optionKinds: ["one-dot-added","skipped-turn","used-left-minus-right","correct"], correctIndex: 3 },
    { matrixMasks: [6, 12, 11, 10, 9, 7, 5, 9], rule: { operation: "join", transform: "rotate-counterclockwise" }, optionMasks: [14, 15, 13, 8], optionKinds: ["correct","one-dot-added","skipped-turn","used-left-minus-right"], correctIndex: 0 },
    { matrixMasks: [11, 10, 8, 7, 11, 3, 7, 5], rule: { operation: "cancel", transform: "rotate-half" }, optionMasks: [6, 4, 2, 14], optionKinds: ["one-dot-added","correct","skipped-turn","used-join"], correctIndex: 1 },
    { matrixMasks: [3, 14, 8, 13, 3, 2, 3, 9], rule: { operation: "overlap", transform: "rotate-clockwise" }, optionMasks: [10, 1, 2, 8], optionKinds: ["one-dot-added","skipped-turn","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [14, 7, 4, 3, 5, 8, 13, 3], rule: { operation: "right-minus-left", transform: "rotate-counterclockwise" }, optionMasks: [9, 1, 2, 11], optionKinds: ["one-dot-added","correct","skipped-turn","used-cancel"], correctIndex: 1 },
    { matrixMasks: [13, 14, 2, 6, 11, 1, 13, 14], rule: { operation: "left-minus-right", transform: "rotate-clockwise" }, optionMasks: [6, 1, 10, 2], optionKinds: ["one-dot-added","skipped-turn","used-cancel","correct"], correctIndex: 3 },
    { matrixMasks: [6, 3, 14, 12, 6, 7, 12, 10], rule: { operation: "join", transform: "rotate-half" }, optionMasks: [15, 14, 7, 6], optionKinds: ["one-dot-added","skipped-turn","correct","used-cancel"], correctIndex: 2 },
    { matrixMasks: [5, 14, 7, 10, 7, 14, 14, 11], rule: { operation: "cancel", transform: "rotate-counterclockwise" }, optionMasks: [12, 13, 5, 8], optionKinds: ["correct","one-dot-added","skipped-turn","used-left-minus-right"], correctIndex: 0 },
  ],
  Wizard: [
    { matrixMasks: [12, 9, 10, 14, 6, 1, 3, 14], rule: { operation: "cancel", transform: "rotate-half" }, optionMasks: [9, 13, 8, 11], optionKinds: ["one-dot-removed","skipped-turn","used-left-minus-right","correct"], correctIndex: 3 },
    { matrixMasks: [14, 13, 4, 14, 7, 4, 11, 13], rule: { operation: "right-minus-left", transform: "rotate-counterclockwise" }, optionMasks: [12, 8, 4, 1], optionKinds: ["one-dot-added","correct","skipped-turn","used-left-minus-right"], correctIndex: 1 },
    { matrixMasks: [5, 9, 7, 3, 5, 11, 6, 5], rule: { operation: "join", transform: "rotate-clockwise" }, optionMasks: [3, 7, 11, 8], optionKinds: ["one-dot-removed","skipped-turn","correct","used-left-minus-right"], correctIndex: 2 },
    { matrixMasks: [10, 3, 4, 11, 7, 12, 6, 13], rule: { operation: "overlap", transform: "rotate-half" }, optionMasks: [2, 3, 8, 4], optionKinds: ["correct","one-dot-added","wrong-turn","used-left-minus-right"], correctIndex: 0 },
    { matrixMasks: [13, 11, 8, 3, 13, 1, 12, 11], rule: { operation: "left-minus-right", transform: "rotate-counterclockwise" }, optionMasks: [9, 4, 8, 2], optionKinds: ["one-dot-added","skipped-turn","correct","used-overlap"], correctIndex: 2 },
    { matrixMasks: [14, 9, 11, 14, 3, 7, 3, 9], rule: { operation: "cancel", transform: "rotate-clockwise" }, optionMasks: [13, 12, 10, 8], optionKinds: ["one-dot-added","correct","skipped-turn","used-left-minus-right"], correctIndex: 1 },
    { matrixMasks: [6, 12, 1, 6, 13, 9, 14, 3], rule: { operation: "right-minus-left", transform: "rotate-half" }, optionMasks: [8, 12, 1, 4], optionKinds: ["correct","one-dot-added","skipped-turn","used-overlap"], correctIndex: 0 },
    { matrixMasks: [6, 10, 11, 10, 6, 11, 9, 12], rule: { operation: "join", transform: "rotate-counterclockwise" }, optionMasks: [10, 13, 8, 14], optionKinds: ["one-dot-removed","skipped-turn","used-right-minus-left","correct"], correctIndex: 3 },
    { matrixMasks: [11, 14, 12, 5, 14, 1, 12, 5], rule: { operation: "overlap", transform: "rotate-clockwise" }, optionMasks: [1, 3, 8, 2], optionKinds: ["correct","one-dot-added","wrong-turn","used-right-minus-left"], correctIndex: 0 },
    { matrixMasks: [13, 7, 1, 12, 10, 2, 7, 13], rule: { operation: "left-minus-right", transform: "rotate-half" }, optionMasks: [12, 2, 4, 1], optionKinds: ["one-dot-added","skipped-turn","correct","used-right-minus-left"], correctIndex: 2 },
    { matrixMasks: [6, 13, 14, 11, 5, 13, 11, 5], rule: { operation: "cancel", transform: "rotate-clockwise" }, optionMasks: [9, 14, 1, 13], optionKinds: ["one-dot-removed","skipped-turn","used-right-minus-left","correct"], correctIndex: 3 },
    { matrixMasks: [12, 9, 14, 12, 6, 11, 12, 9], rule: { operation: "join", transform: "rotate-counterclockwise" }, optionMasks: [15, 14, 13, 2], optionKinds: ["one-dot-added","correct","skipped-turn","used-overlap"], correctIndex: 1 },
  ],
};

function assertMask(mask: number): void {
  if (!Number.isInteger(mask) || mask < 0 || mask > 15) {
    throw new Error(`Pattern mask must be an integer from 0 to 15: ${mask}`);
  }
}

export function patternFromMask(mask: number): Pattern {
  assertMask(mask);
  return [
    (mask & 1) !== 0,
    (mask & 2) !== 0,
    (mask & 4) !== 0,
    (mask & 8) !== 0,
  ];
}

export function patternMask(pattern: Pattern): number {
  if (pattern.length !== 4 || pattern.some((dot) => typeof dot !== "boolean")) {
    throw new Error("A pattern must contain exactly four boolean dots.");
  }

  return pattern.reduce(
    (mask, filled, index) => mask | (filled ? 1 << index : 0),
    0,
  );
}

export function patternKey(pattern: Pattern): string {
  return pattern.map((filled) => (filled ? "1" : "0")).join("");
}

export function dotCount(pattern: Pattern): number {
  return pattern.reduce((count, filled) => count + Number(filled), 0);
}

export function differingDotIndexes(
  candidate: Pattern,
  expected: Pattern,
): readonly number[] {
  if (candidate.length !== expected.length) {
    throw new Error("Patterns must contain the same number of dots.");
  }

  return candidate.flatMap((filled, index) =>
    filled === expected[index] ? [] : [index],
  );
}

export function rotatePattern(
  pattern: Pattern,
  quarterTurnsClockwise: number,
): Pattern {
  let result = patternFromMask(patternMask(pattern));
  const turns = ((quarterTurnsClockwise % 4) + 4) % 4;

  for (let index = 0; index < turns; index += 1) {
    result = [result[2], result[0], result[3], result[1]];
  }

  return result;
}

export function transformPattern(
  pattern: Pattern,
  transform: PatternTransform,
): Pattern {
  switch (transform) {
    case "none":
      return patternFromMask(patternMask(pattern));
    case "rotate-clockwise":
      return rotatePattern(pattern, 1);
    case "rotate-half":
      return rotatePattern(pattern, 2);
    case "rotate-counterclockwise":
      return rotatePattern(pattern, -1);
  }
}

export function combinePatterns(
  left: Pattern,
  right: Pattern,
  operation: Operation,
): Pattern {
  const leftMask = patternMask(left);
  const rightMask = patternMask(right);
  let resultMask: number;

  switch (operation) {
    case "join":
      resultMask = leftMask | rightMask;
      break;
    case "overlap":
      resultMask = leftMask & rightMask;
      break;
    case "cancel":
      resultMask = leftMask ^ rightMask;
      break;
    case "left-minus-right":
      resultMask = leftMask & ~rightMask;
      break;
    case "right-minus-left":
      resultMask = rightMask & ~leftMask;
      break;
  }

  return patternFromMask(resultMask & 15);
}

export function applyMatrixRule(
  left: Pattern,
  right: Pattern,
  rule: MatrixRule,
): Pattern {
  return transformPattern(
    combinePatterns(left, right, rule.operation),
    rule.transform,
  );
}

export function operationLabel(operation: Operation): string {
  return OPERATION_LABELS[operation];
}

export function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_LABELS[difficulty];
}

export function transformLabel(transform: PatternTransform): string {
  return TRANSFORM_LABELS[transform];
}

export function ruleLabel(rule: MatrixRule): string {
  const operation = OPERATION_RULE_TEXT[rule.operation];
  if (rule.transform === "none") return `${operation}.`;
  return `${operation}, then ${transformLabel(
    rule.transform,
  )}.`;
}

function ruleKey(rule: MatrixRule): string {
  return `${rule.operation}:${rule.transform}`;
}

const ALL_RULES: readonly MatrixRule[] = OPERATIONS.flatMap((operation) =>
  PATTERN_TRANSFORMS.map((transform) => ({ operation, transform })),
);

function completedEvidenceRows(
  matrix: Matrix,
): readonly (readonly [Pattern, Pattern, Pattern])[] {
  return [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[3], matrix[4], matrix[5]],
  ];
}

export function ruleMatchesEvidence(
  matrix: Matrix,
  rule: MatrixRule,
): boolean {
  return completedEvidenceRows(matrix).every(
    ([left, right, result]) =>
      patternKey(applyMatrixRule(left, right, rule)) === patternKey(result),
  );
}

/**
 * Finds every supported rule that explains both solved rows. The missing row is
 * deliberately ignored so this can validate hidden-rule puzzles.
 */
export function compatibleRules(matrix: Matrix): readonly MatrixRule[] {
  return ALL_RULES.filter((rule) => ruleMatchesEvidence(matrix, rule));
}

export function inferredAnswerKeys(matrix: Matrix): ReadonlySet<string> {
  return new Set(
    compatibleRules(matrix).map((rule) =>
      patternKey(applyMatrixRule(matrix[6], matrix[7], rule)),
    ),
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

function shuffled<T>(values: readonly T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, index + 1);
    [result[index], result[swapIndex]] = [
      result[swapIndex],
      result[index],
    ];
  }
  return result;
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

/** Creates a portable deterministic random source for Infinite sessions. */
export function createSeededRandom(seed: number | string): RandomSource {
  let state = hashSeed(seed);
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function randomPattern(
  random: RandomSource,
  minimumDots: number,
  maximumDots: number,
): Pattern {
  const dots =
    minimumDots + randomInteger(random, maximumDots - minimumDots + 1);
  const indexes = shuffled([0, 1, 2, 3], random).slice(0, dots);
  const mask = indexes.reduce((value, index) => value | (1 << index), 0);
  return patternFromMask(mask);
}

function rowDemonstratesOperation(
  left: Pattern,
  right: Pattern,
  rule: MatrixRule,
  difficulty: Difficulty,
): boolean {
  const leftMask = patternMask(left);
  const rightMask = patternMask(right);
  const overlap = leftMask & rightMask;
  const leftOnly = leftMask & ~rightMask & 15;
  const rightOnly = rightMask & ~leftMask & 15;

  if (difficulty === "Easy") {
    return overlap === 0;
  }

  switch (rule.operation) {
    case "join":
      return overlap !== 0 && leftOnly !== 0 && rightOnly !== 0;
    case "overlap":
      return overlap !== 0 && leftOnly !== 0 && rightOnly !== 0;
    case "cancel":
      return overlap !== 0 && (leftOnly | rightOnly) !== 0;
    case "left-minus-right":
    case "right-minus-left":
      return overlap !== 0 && leftOnly !== 0 && rightOnly !== 0;
  }
}

function tryMakeMatrix(
  difficulty: Difficulty,
  rule: MatrixRule,
  random: RandomSource,
): Matrix | null {
  const rules = DIFFICULTY_RULES[difficulty];
  const rows: Array<readonly [Pattern, Pattern, Pattern]> = [];

  for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
    let row: readonly [Pattern, Pattern, Pattern] | null = null;

    for (let attempt = 0; attempt < 32 && !row; attempt += 1) {
      const left = randomPattern(
        random,
        rules.minInputDots,
        rules.maxInputDots,
      );
      const right = randomPattern(
        random,
        rules.minInputDots,
        rules.maxInputDots,
      );
      const result = applyMatrixRule(left, right, rule);
      const resultDots = dotCount(result);
      const rowKeys = [left, right, result].map(patternKey);

      if (!rowDemonstratesOperation(left, right, rule, difficulty)) continue;
      if (
        resultDots < rules.minOutputDots ||
        resultDots > rules.maxOutputDots
      ) {
        continue;
      }
      if (new Set(rowKeys).size !== 3) continue;

      row = [left, right, result];
    }

    if (!row) return null;
    rows.push(row);
  }

  const visiblePatterns = [
    rows[0][0],
    rows[0][1],
    rows[0][2],
    rows[1][0],
    rows[1][1],
    rows[1][2],
    rows[2][0],
    rows[2][1],
  ];
  if (new Set(visiblePatterns.map(patternKey)).size < 5) return null;

  return [
    rows[0][0],
    rows[0][1],
    rows[0][2],
    rows[1][0],
    rows[1][1],
    rows[1][2],
    rows[2][0],
    rows[2][1],
    null,
  ];
}

function addCandidate(
  candidates: DistractorCandidate[],
  seen: Set<string>,
  correctKey: string,
  kind: DistractorKind,
  pattern: Pattern,
): void {
  const key = patternKey(pattern);
  if (patternMask(pattern) === 0 || key === correctKey || seen.has(key)) return;
  candidates.push({ kind, pattern });
  seen.add(key);
}

function distractorCandidates(
  matrix: Matrix,
  rule: MatrixRule,
  random: RandomSource,
): readonly DistractorCandidate[] {
  const left = matrix[6];
  const right = matrix[7];
  const correct = applyMatrixRule(left, right, rule);
  const correctKey = patternKey(correct);
  const candidates: DistractorCandidate[] = [];
  const seen = new Set<string>();

  for (const operation of shuffled(OPERATIONS, random)) {
    if (operation === rule.operation) continue;
    addCandidate(
      candidates,
      seen,
      correctKey,
      OPERATION_DISTRACTOR_KINDS[operation],
      applyMatrixRule(left, right, {
        operation,
        transform: rule.transform,
      }),
    );
  }

  if (rule.transform !== "none") {
    addCandidate(
      candidates,
      seen,
      correctKey,
      "skipped-turn",
      combinePatterns(left, right, rule.operation),
    );
  }

  for (const transform of shuffled(PATTERN_TRANSFORMS, random)) {
    if (transform === rule.transform) continue;
    addCandidate(
      candidates,
      seen,
      correctKey,
      "wrong-turn",
      applyMatrixRule(left, right, {
        operation: rule.operation,
        transform,
      }),
    );
  }

  addCandidate(candidates, seen, correctKey, "kept-left", left);
  addCandidate(candidates, seen, correctKey, "kept-right", right);

  for (const dotIndex of shuffled([0, 1, 2, 3], random)) {
    const mask = patternMask(correct);
    const filled = (mask & (1 << dotIndex)) !== 0;
    addCandidate(
      candidates,
      seen,
      correctKey,
      filled ? "one-dot-removed" : "one-dot-added",
      patternFromMask(mask ^ (1 << dotIndex)),
    );
  }

  return candidates;
}

function isLocalDistractor(kind: DistractorKind): boolean {
  return kind === "one-dot-added" || kind === "one-dot-removed";
}

function isTurnDistractor(kind: DistractorKind): boolean {
  return kind === "skipped-turn" || kind === "wrong-turn";
}

function chooseDistractors(
  matrix: Matrix,
  rule: MatrixRule,
  difficulty: Difficulty,
  random: RandomSource,
): readonly [
  DistractorCandidate,
  DistractorCandidate,
  DistractorCandidate,
] | null {
  const rules = DIFFICULTY_RULES[difficulty];
  const correct = applyMatrixRule(matrix[6], matrix[7], rule);
  const inferredKeys = inferredAnswerKeys(matrix);
  const candidates = distractorCandidates(matrix, rule, random).filter(
    ({ pattern }) => {
      const differenceCount = differingDotIndexes(pattern, correct).length;
      if (
        differenceCount === 0 ||
        differenceCount > rules.maximumDistractorDifference
      ) {
        return false;
      }
      return difficulty !== "Wizard" || !inferredKeys.has(patternKey(pattern));
    },
  );

  const selected: DistractorCandidate[] = [];
  const take = (
    predicate: (candidate: DistractorCandidate) => boolean,
  ): boolean => {
    const candidate = candidates.find(
      (item) => !selected.includes(item) && predicate(item),
    );
    if (!candidate) return false;
    selected.push(candidate);
    return true;
  };

  if (!take(({ kind }) => isLocalDistractor(kind))) return null;

  if (difficulty === "Hard" || difficulty === "Wizard") {
    if (!take(({ kind }) => isTurnDistractor(kind))) return null;
  } else if (!take(({ kind }) => !isLocalDistractor(kind))) {
    return null;
  }

  if (!take(() => true)) return null;

  return [
    selected[0],
    selected[1],
    selected[2],
  ];
}

function assembleRound(
  difficulty: Difficulty,
  matrix: Matrix,
  rule: MatrixRule,
  correctIndex: number,
  random: RandomSource,
  id: string,
): Round | null {
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new Error(`Correct answer index must be from 0 to 3: ${correctIndex}`);
  }

  const correctPattern = applyMatrixRule(matrix[6], matrix[7], rule);
  const distractors = chooseDistractors(matrix, rule, difficulty, random);
  if (!distractors) return null;

  const options = distractors.map(({ pattern }) => pattern);
  const optionKinds: OptionKind[] = distractors.map(({ kind }) => kind);
  options.splice(correctIndex, 0, correctPattern);
  optionKinds.splice(correctIndex, 0, "correct");

  const round: Round = {
    id,
    difficulty,
    matrix,
    rule,
    cueMode: DIFFICULTY_RULES[difficulty].cueMode,
    options,
    optionKinds,
    correctIndex,
    correctPattern,
  };
  return validateRound(round).length === 0 ? round : null;
}

function isDifficulty(value: string): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

function randomRule(
  difficulty: Difficulty,
  random: RandomSource,
): MatrixRule {
  const rules = DIFFICULTY_RULES[difficulty];
  return {
    operation: rules.operations[randomInteger(random, rules.operations.length)],
    transform:
      rules.transforms[randomInteger(random, rules.transforms.length)],
  };
}

function hiddenDimensionsAreUnique(
  matrix: Matrix,
  rule: MatrixRule,
  difficulty: Difficulty,
): boolean {
  const compatible = compatibleRules(matrix);

  if (difficulty === "Hard") {
    const sameOperation = compatible.filter(
      ({ operation }) => operation === rule.operation,
    );
    return (
      sameOperation.length === 1 &&
      ruleKey(sameOperation[0]) === ruleKey(rule)
    );
  }

  if (difficulty === "Wizard") {
    return compatible.length === 1 && ruleKey(compatible[0]) === ruleKey(rule);
  }

  return true;
}

function generateRoundForRule(
  difficulty: Difficulty,
  rule: MatrixRule,
  random: RandomSource,
  correctIndex: number,
  idPrefix: string,
  excludedFingerprints: ReadonlySet<string>,
): Round {
  const allowed = DIFFICULTY_RULES[difficulty];
  if (
    !allowed.operations.includes(rule.operation) ||
    !allowed.transforms.includes(rule.transform)
  ) {
    throw new Error(
      `${ruleLabel(rule)} is not valid for ${difficulty} generation.`,
    );
  }

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const matrix = tryMakeMatrix(difficulty, rule, random);
    if (!matrix || !hiddenDimensionsAreUnique(matrix, rule, difficulty)) {
      continue;
    }
    const round = assembleRound(
      difficulty,
      matrix,
      rule,
      correctIndex,
      random,
      `${idPrefix}-${attempt + 1}`,
    );
    if (!round) continue;

    const fingerprint = roundFingerprint(round);
    if (!excludedFingerprints.has(fingerprint)) return round;
  }

  throw new Error(
    `Unable to generate a valid ${difficulty} round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

/**
 * Generates one validated Infinite round. Pass the session fingerprint set to
 * guarantee that a repeated candidate is rejected rather than served.
 */
export function generateInfiniteRound(
  difficulty: Difficulty,
  random: RandomSource = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  if (!isDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }

  const rule = randomRule(difficulty, random);
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

/** Identifies the visual problem independently of option ordering and cues. */
export function roundFingerprint(round: Round): string {
  const visible = round.matrix
    .map((pattern) => (pattern ? patternKey(pattern) : "?"))
    .join("/");
  return `${visible}=>${patternKey(round.correctPattern)}`;
}

const OPTION_KINDS: readonly OptionKind[] = [
  "correct",
  "used-join",
  "used-overlap",
  "used-cancel",
  "used-left-minus-right",
  "used-right-minus-left",
  "kept-left",
  "kept-right",
  "skipped-turn",
  "wrong-turn",
  "one-dot-added",
  "one-dot-removed",
];

function isOptionKind(value: string): value is OptionKind {
  return OPTION_KINDS.includes(value as OptionKind);
}

function optionKindMatches(
  round: Round,
  optionIndex: number,
  calculatedAnswer: Pattern,
): boolean {
  const kind = round.optionKinds[optionIndex];
  const option = round.options[optionIndex];
  const optionKey = patternKey(option);
  const answerKey = patternKey(calculatedAnswer);
  const left = round.matrix[6];
  const right = round.matrix[7];

  if (kind === "correct") {
    return optionIndex === round.correctIndex && optionKey === answerKey;
  }
  if (optionIndex === round.correctIndex) return false;

  if (kind.startsWith("used-")) {
    const operation = kind.replace("used-", "") as Operation;
    return (
      OPERATIONS.includes(operation) &&
      optionKey ===
        patternKey(
          applyMatrixRule(left, right, {
            operation,
            transform: round.rule.transform,
          }),
        )
    );
  }

  if (kind === "kept-left") return optionKey === patternKey(left);
  if (kind === "kept-right") return optionKey === patternKey(right);
  if (kind === "skipped-turn") {
    return (
      round.rule.transform !== "none" &&
      optionKey === patternKey(combinePatterns(left, right, round.rule.operation))
    );
  }
  if (kind === "wrong-turn") {
    return PATTERN_TRANSFORMS.some(
      (transform) =>
        transform !== round.rule.transform &&
        optionKey ===
          patternKey(
            applyMatrixRule(left, right, {
              operation: round.rule.operation,
              transform,
            }),
          ),
    );
  }

  const differences = differingDotIndexes(option, calculatedAnswer);
  if (differences.length !== 1) return false;
  const changedIndex = differences[0];
  return kind === "one-dot-added"
    ? !calculatedAnswer[changedIndex] && option[changedIndex]
    : calculatedAnswer[changedIndex] && !option[changedIndex];
}

export function validateRound(round: Round): readonly string[] {
  const errors: string[] = [];

  if (!isDifficulty(round.difficulty)) {
    return ["The round has an unknown difficulty."];
  }
  const difficultyRules = DIFFICULTY_RULES[round.difficulty];

  if (round.matrix.length !== 9 || round.matrix[8] !== null) {
    errors.push("The matrix must have eight patterns and one final missing cell.");
    return errors;
  }
  if (round.options.length !== 4 || round.optionKinds.length !== 4) {
    errors.push("A round must have four labeled answer options.");
    return errors;
  }
  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex > 3
  ) {
    errors.push("The correct answer index must be from 0 to 3.");
    return errors;
  }

  if (round.cueMode !== difficultyRules.cueMode) {
    errors.push("The cue mode must match the round difficulty.");
  }
  if (
    !difficultyRules.operations.includes(round.rule.operation) ||
    !difficultyRules.transforms.includes(round.rule.transform)
  ) {
    errors.push("The rule is outside this difficulty's allowed rule family.");
  }

  const expectedRows = completedEvidenceRows(round.matrix);
  if (
    expectedRows.some(
      ([left, right, result]) =>
        patternKey(applyMatrixRule(left, right, round.rule)) !==
        patternKey(result),
    )
  ) {
    errors.push("Both solved rows must follow the declared rule.");
  }

  const calculatedAnswer = applyMatrixRule(
    round.matrix[6],
    round.matrix[7],
    round.rule,
  );
  if (patternKey(calculatedAnswer) !== patternKey(round.correctPattern)) {
    errors.push("The stored answer must be calculated from the missing row.");
  }

  const allRows: ReadonlyArray<readonly [Pattern, Pattern, Pattern]> = [
    ...expectedRows,
    [round.matrix[6], round.matrix[7], calculatedAnswer],
  ];
  if (
    allRows.some(([left, right]) =>
      [left, right].some((pattern) => {
        const count = dotCount(pattern);
        return (
          count < difficultyRules.minInputDots ||
          count > difficultyRules.maxInputDots
        );
      }),
    )
  ) {
    errors.push("An input pattern is outside the difficulty density bounds.");
  }
  if (
    allRows.some(([, , result]) => {
      const count = dotCount(result);
      return (
        count < difficultyRules.minOutputDots ||
        count > difficultyRules.maxOutputDots
      );
    })
  ) {
    errors.push("A result pattern is outside the difficulty density bounds.");
  }
  if (
    allRows.some(
      ([left, right]) =>
        !rowDemonstratesOperation(
          left,
          right,
          round.rule,
          round.difficulty,
        ),
    )
  ) {
    errors.push("Every row must clearly demonstrate its declared operation.");
  }

  const optionKeys = round.options.map(patternKey);
  if (new Set(optionKeys).size !== 4) {
    errors.push("Answer options must be mutually distinct.");
  }
  const exactIndexes = optionKeys.flatMap((key, index) =>
    key === patternKey(calculatedAnswer) ? [index] : [],
  );
  if (
    exactIndexes.length !== 1 ||
    exactIndexes[0] !== round.correctIndex ||
    round.optionKinds[round.correctIndex] !== "correct"
  ) {
    errors.push("Exactly one option must be the calculated answer.");
  }
  if (
    round.optionKinds.some((kind) => !isOptionKind(kind)) ||
    round.optionKinds.some(
      (_, optionIndex) =>
        !optionKindMatches(round, optionIndex, calculatedAnswer),
    )
  ) {
    errors.push("Every answer label must truthfully describe its option.");
  }
  if (
    round.options.some((option) => patternMask(option) === 0) ||
    round.matrix.slice(0, 8).some((pattern) => patternMask(pattern as Pattern) === 0)
  ) {
    errors.push("Visible patterns and options must not be empty.");
  }

  if (
    (round.difficulty === "Hard" || round.difficulty === "Wizard") &&
    !hiddenDimensionsAreUnique(round.matrix, round.rule, round.difficulty)
  ) {
    errors.push("Every hidden rule dimension must be uniquely inferable.");
  }
  if (
    round.difficulty === "Wizard" &&
    (inferenceOptionIndexes(round.matrix, round.options).length !== 1 ||
      inferenceOptionIndexes(round.matrix, round.options)[0] !==
        round.correctIndex)
  ) {
    errors.push("Wizard must have exactly one inference-valid option.");
  }

  const wrongOptions = round.options.filter(
    (_, index) => index !== round.correctIndex,
  );
  if (
    !wrongOptions.some(
      (option) =>
        differingDotIndexes(option, round.correctPattern).length === 1,
    )
  ) {
    errors.push("Every round must include a one-dot near miss.");
  }

  const maximumDifference = difficultyRules.maximumDistractorDifference;
  if (
    wrongOptions.some(
      (option) =>
        differingDotIndexes(option, round.correctPattern).length >
        maximumDifference,
    )
  ) {
    errors.push("A distractor is too far from the correct pattern.");
  }

  const wrongKinds = round.optionKinds.filter(
    (_, index) => index !== round.correctIndex,
  ) as readonly DistractorKind[];
  if (!wrongKinds.some(isLocalDistractor)) {
    errors.push("Every round must include a local one-dot misconception.");
  }
  if (
    (round.difficulty === "Hard" || round.difficulty === "Wizard") &&
    !wrongKinds.some(isTurnDistractor)
  ) {
    errors.push("Harder rounds must include a turn misconception.");
  }
  if (
    (round.difficulty === "Easy" || round.difficulty === "Medium") &&
    !wrongKinds.some((kind) => !isLocalDistractor(kind))
  ) {
    errors.push("Every round must include a rule misconception.");
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
    optionIndex >= round.options.length
  ) {
    throw new Error(`Unknown answer option: ${optionIndex}`);
  }
  if (optionIndex === round.correctIndex) {
    throw new Error("Incorrect feedback is only available for a wrong option.");
  }

  const differenceCount = differingDotIndexes(
    round.options[optionIndex],
    round.correctPattern,
  ).length;

  if (round.difficulty === "Wizard") {
    return {
      heading: "Try again",
      message:
        "This choice does not complete the third row by the same rule as both solved rows.",
      differenceCount: null,
      revealDifferences: false,
    };
  }

  if (round.difficulty === "Hard") {
    return {
      heading: "Try again",
      message:
        "This choice does not match both the shown combination and the movement demonstrated by the solved rows.",
      differenceCount: null,
      revealDifferences: false,
    };
  }

  const kind = round.optionKinds[optionIndex];
  let message: string;
  if (kind === "one-dot-added" || kind === "one-dot-removed") {
    message = `This choice is ${differenceCount} ${
      differenceCount === 1 ? "dot" : "dots"
    } away from the pattern made by the row.`;
  } else if (kind === "kept-left" || kind === "kept-right") {
    message = "This keeps only one input instead of completing the row.";
  } else if (kind === "skipped-turn" || kind === "wrong-turn") {
    message = "The dots combine, but the result does not make the shown turn.";
  } else {
    const usedOperation = kind.replace("used-", "") as Operation;
    message = `This uses ${operationLabel(
      usedOperation,
    ).toLowerCase()}, but the cue shows ${operationLabel(
      round.rule.operation,
    ).toLowerCase()}.`;
  }

  return {
    heading: "Try again",
    message,
    differenceCount,
    revealDifferences: true,
  };
}

function validateAnswerPositionSequence(
  difficulty: Difficulty,
  sequence: readonly number[],
): void {
  const counts = [0, 1, 2, 3].map(
    (position) => sequence.filter((value) => value === position).length,
  );
  if (
    sequence.length !== 12 ||
    counts.some((count) => count !== 3) ||
    sequence.some((value, index) => index > 0 && value === sequence[index - 1])
  ) {
    throw new Error(`${difficulty} has an invalid answer-position sequence.`);
  }

  const repeatsFourPositionCycle = sequence
    .slice(4)
    .every((value, index) => value === sequence[index % 4]);
  if (repeatsFourPositionCycle) {
    throw new Error(`${difficulty} repeats one four-position answer cycle.`);
  }
}

/** Rebuilds the authored Campaign without consulting generation or randomness. */
export function buildCampaignRounds(): readonly Round[] {
  const rounds: Round[] = [];

  for (const difficulty of DIFFICULTIES) {
    const specs = AUTHORED_ROUND_SPECS[difficulty];
    validateAnswerPositionSequence(
      difficulty,
      specs.map(({ correctIndex }) => correctIndex),
    );

    for (const [index, spec] of specs.entries()) {
      const matrix = [
        ...spec.matrixMasks.map(patternFromMask),
        null,
      ] as unknown as Matrix;
      const correctPattern = applyMatrixRule(matrix[6], matrix[7], spec.rule);
      const round: Round = {
        id: `${difficulty.toLowerCase()}-${index + 1}`,
        difficulty,
        matrix,
        rule: spec.rule,
        cueMode: DIFFICULTY_RULES[difficulty].cueMode,
        options: spec.optionMasks.map(patternFromMask),
        optionKinds: spec.optionKinds,
        correctIndex: spec.correctIndex,
        correctPattern,
      };
      const errors = validateRound(round);
      if (errors.length > 0) {
        throw new Error(
          `Authored ${difficulty} round ${index + 1} is invalid: ${errors.join(
            " ",
          )}`,
        );
      }
      rounds.push(round);
    }
  }

  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error("Campaign puzzle fingerprints must be unique.");
  }
  return rounds;
}

export const CAMPAIGN_ROUNDS = buildCampaignRounds();
export const ROUNDS = CAMPAIGN_ROUNDS;

const tutorialRule: MatrixRule = {
  operation: "join",
  transform: "none",
};
const tutorialMatrix: Matrix = [
  patternFromMask(1),
  patternFromMask(2),
  patternFromMask(3),
  patternFromMask(4),
  patternFromMask(8),
  patternFromMask(12),
  patternFromMask(1),
  patternFromMask(8),
  null,
];

export const TUTORIAL = {
  matrix: tutorialMatrix,
  rule: tutorialRule,
  answer: applyMatrixRule(tutorialMatrix[6], tutorialMatrix[7], tutorialRule),
  nearMiss: patternFromMask(8),
  cueMode: "full-rule" as const,
} as const;
