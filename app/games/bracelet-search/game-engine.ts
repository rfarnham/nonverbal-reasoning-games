export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
export type BeadColor =
  | "coral"
  | "gold"
  | "teal"
  | "violet"
  | "black"
  | "lightGray";
export type BraceletColorScheme = "color" | "monochrome";
export type BeadMark = "plain" | "dot";

export type Bead = Readonly<{
  color: BeadColor;
  mark: BeadMark;
}>;

export type Bracelet = readonly Bead[];

export type SegmentToken =
  | Readonly<{ kind: "bead"; bead: Bead }>
  | Readonly<{ kind: "hidden" }>;

export type SegmentPattern = readonly SegmentToken[];

export type DistractorKind =
  | "one-color-off"
  | "two-color-off"
  | "one-mark-off"
  | "adjacent-swap"
  | "skipped-bead";

export type OptionKind = "correct" | DistractorKind;

export type BraceletOption = Readonly<{
  pattern: SegmentPattern;
  kind: OptionKind;
}>;

export type MatchAlignment = "forward" | "reverse" | "both";

export type SegmentOccurrence = Readonly<{
  clockwiseStart: number;
  clockwiseIndexes: readonly number[];
  alignment: MatchAlignment;
}>;

/**
 * One compatible answer at one physical bracelet arc. A forward traversal and
 * the reverse traversal of the same arc are deliberately one solution.
 */
export type CompatibleSolution = Readonly<{
  optionIndex: number;
  occurrence: SegmentOccurrence;
}>;

export type BraceletRound = Readonly<{
  id: string;
  difficulty: Difficulty;
  bracelet: Bracelet;
  options: readonly [
    BraceletOption,
    BraceletOption,
    BraceletOption,
    BraceletOption,
  ];
  correctIndex: 0 | 1 | 2 | 3;
  occurrence: SegmentOccurrence;
}>;

export type ClosestComparison = Readonly<{
  clockwiseStart: number;
  clockwiseIndexes: readonly number[];
  alignment: MatchAlignment;
  mismatchCount: number;
  optionIndexes: readonly number[];
  braceletIndexes: readonly number[];
}>;

export type NormalWrongAttemptAnalysis = Readonly<{
  kind: "comparison";
  visibleMismatchCount: number;
  optionIndexes: readonly number[];
  braceletIndexes: readonly number[];
  occurrence: SegmentOccurrence;
}>;

/**
 * Wizard feedback deliberately contains no placement, bracelet indexes,
 * expected beads, or wildcard value.
 */
export type WizardWrongAttemptAnalysis = Readonly<{
  kind: "visible-conflict";
  visibleMismatchCount: number;
}>;

export type WrongAttemptAnalysis =
  | NormalWrongAttemptAnalysis
  | WizardWrongAttemptAnalysis;

export type ValidationResult = Readonly<{
  valid: boolean;
  issues: readonly string[];
}>;

type DifficultyRules = Readonly<{
  braceletLength: number;
  segmentLength: number;
  colorCount: number;
  dotCount: number;
  hiddenCount: number;
  hiddenIndex: number | null;
  maximumDistractorDistance: number;
}>;

export const DIFFICULTIES = [
  "Easy",
  "Medium",
  "Hard",
  "Wizard",
] as const;

export const DIFFICULTY_RULES: Readonly<
  Record<Difficulty, DifficultyRules>
> = {
  Easy: {
    braceletLength: 8,
    segmentLength: 3,
    colorCount: 4,
    dotCount: 0,
    hiddenCount: 0,
    hiddenIndex: null,
    maximumDistractorDistance: 2,
  },
  Medium: {
    braceletLength: 10,
    segmentLength: 4,
    colorCount: 4,
    dotCount: 0,
    hiddenCount: 0,
    hiddenIndex: null,
    maximumDistractorDistance: 2,
  },
  Hard: {
    braceletLength: 12,
    segmentLength: 5,
    colorCount: 4,
    dotCount: 4,
    hiddenCount: 0,
    hiddenIndex: null,
    maximumDistractorDistance: 2,
  },
  Wizard: {
    braceletLength: 12,
    segmentLength: 5,
    colorCount: 4,
    dotCount: 4,
    hiddenCount: 1,
    hiddenIndex: 2,
    maximumDistractorDistance: 2,
  },
};

export const GENERATOR_MAX_ATTEMPTS = 256;

const COLOR_BEADS: readonly BeadColor[] = [
  "coral",
  "gold",
  "teal",
  "violet",
];
const MONOCHROME_BEADS: readonly BeadColor[] = ["black", "lightGray"];
const COLOR_CODE: Readonly<Record<BeadColor, string>> = {
  coral: "C",
  gold: "G",
  teal: "T",
  violet: "V",
  black: "B",
  lightGray: "L",
};
const CODE_COLOR: Readonly<Record<string, BeadColor>> = {
  C: "coral",
  G: "gold",
  T: "teal",
  V: "violet",
  B: "black",
  L: "lightGray",
};

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function isDifficulty(value: string): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

function sameBead(left: Bead, right: Bead): boolean {
  return left.color === right.color && left.mark === right.mark;
}

function beadToken(bead: Bead): SegmentToken {
  return { kind: "bead", bead: { ...bead } };
}

function hiddenToken(): SegmentToken {
  return { kind: "hidden" };
}

function clonePattern(pattern: SegmentPattern): SegmentToken[] {
  return pattern.map((token) =>
    token.kind === "hidden" ? hiddenToken() : beadToken(token.bead),
  );
}

function patternFromBeads(beads: readonly Bead[]): SegmentPattern {
  return beads.map(beadToken);
}

function maskForDifficulty(
  pattern: SegmentPattern,
  difficulty: Difficulty,
): SegmentPattern {
  const hiddenIndex = DIFFICULTY_RULES[difficulty].hiddenIndex;
  if (hiddenIndex === null) return clonePattern(pattern);
  const masked = clonePattern(pattern);
  masked[hiddenIndex] = hiddenToken();
  return masked;
}

function tokenKey(token: SegmentToken): string {
  return token.kind === "hidden" ? "?" : beadKey(token.bead);
}

export function beadKey(bead: Bead): string {
  return `${COLOR_CODE[bead.color]}${bead.mark === "dot" ? "." : ""}`;
}

export function encodeBracelet(bracelet: Bracelet): string {
  return bracelet
    .map((bead) =>
      bead.mark === "dot"
        ? COLOR_CODE[bead.color].toLowerCase()
        : COLOR_CODE[bead.color],
    )
    .join("");
}

export function encodePattern(pattern: SegmentPattern): string {
  return pattern
    .map((token) => {
      if (token.kind === "hidden") return "?";
      const code = COLOR_CODE[token.bead.color];
      return token.bead.mark === "dot" ? code.toLowerCase() : code;
    })
    .join("");
}

function decodeBead(code: string): Bead {
  const color = CODE_COLOR[code.toUpperCase()];
  if (!color) throw new Error(`Unknown bead code: ${code}`);
  return { color, mark: code === code.toLowerCase() ? "dot" : "plain" };
}

export function decodeBracelet(encoded: string): Bracelet {
  if (encoded.length === 0 || encoded.includes("?")) {
    throw new Error(`Invalid bracelet encoding: ${encoded}`);
  }
  return [...encoded].map(decodeBead);
}

export function decodePattern(encoded: string): SegmentPattern {
  if (encoded.length === 0) {
    throw new Error("A segment pattern cannot be empty.");
  }
  return [...encoded].map((code) =>
    code === "?" ? hiddenToken() : beadToken(decodeBead(code)),
  );
}

export function reversePattern(pattern: SegmentPattern): SegmentPattern {
  return [...pattern].reverse().map((token) =>
    token.kind === "hidden" ? hiddenToken() : beadToken(token.bead),
  );
}

function exactPatternKey(pattern: SegmentPattern): string {
  return pattern.map(tokenKey).join(",");
}

export function segmentClassKey(pattern: SegmentPattern): string {
  const forward = exactPatternKey(pattern);
  const reverse = exactPatternKey(reversePattern(pattern));
  return forward < reverse ? forward : reverse;
}

function rotateBracelet(bracelet: Bracelet, offset: number): Bracelet {
  return bracelet.map(
    (_, index) => bracelet[modulo(index + offset, bracelet.length)],
  );
}

export function braceletViews(bracelet: Bracelet): readonly Bracelet[] {
  const reverse = [...bracelet].reverse();
  return [
    ...bracelet.map((_, offset) => rotateBracelet(bracelet, offset)),
    ...reverse.map((_, offset) => rotateBracelet(reverse, offset)),
  ];
}

export function braceletClassKey(bracelet: Bracelet): string {
  if (bracelet.length === 0) throw new Error("A bracelet cannot be empty.");
  return braceletViews(bracelet)
    .map((view) => view.map(beadKey).join(","))
    .sort()[0];
}

export function braceletColorScheme(
  bracelet: Bracelet,
): BraceletColorScheme | null {
  if (bracelet.length === 0) return null;
  const colors = new Set(bracelet.map(({ color }) => color));
  if ([...colors].every((color) => COLOR_BEADS.includes(color))) {
    return "color";
  }
  if ([...colors].every((color) => MONOCHROME_BEADS.includes(color))) {
    return "monochrome";
  }
  return null;
}

export function braceletOrbitSize(bracelet: Bracelet): number {
  return new Set(
    braceletViews(bracelet).map((view) => view.map(beadKey).join(",")),
  ).size;
}

function clockwiseWindow(
  bracelet: Bracelet,
  start: number,
  length: number,
): readonly Bead[] {
  return Array.from(
    { length },
    (_, offset) => bracelet[modulo(start + offset, bracelet.length)],
  );
}

type AlignmentComparison = Readonly<{
  mismatchCount: number;
  optionIndexes: readonly number[];
  braceletOffsets: readonly number[];
}>;

function comparePatternToWindow(
  pattern: SegmentPattern,
  window: readonly Bead[],
  reverse: boolean,
): AlignmentComparison {
  const optionIndexes: number[] = [];
  const braceletOffsets: number[] = [];
  for (let windowIndex = 0; windowIndex < window.length; windowIndex += 1) {
    const optionIndex = reverse
      ? pattern.length - 1 - windowIndex
      : windowIndex;
    const token = pattern[optionIndex];
    if (token.kind === "hidden") continue;
    if (!sameBead(token.bead, window[windowIndex])) {
      optionIndexes.push(optionIndex);
      braceletOffsets.push(windowIndex);
    }
  }
  return {
    mismatchCount: optionIndexes.length,
    optionIndexes,
    braceletOffsets,
  };
}

export function closestBraceletComparisons(
  bracelet: Bracelet,
  pattern: SegmentPattern,
): readonly ClosestComparison[] {
  if (pattern.length === 0 || pattern.length >= bracelet.length) {
    throw new Error(
      "A segment must contain at least one bead and be shorter than its bracelet.",
    );
  }

  const comparisons = bracelet.map((_, clockwiseStart) => {
    const window = clockwiseWindow(
      bracelet,
      clockwiseStart,
      pattern.length,
    );
    const forward = comparePatternToWindow(pattern, window, false);
    const reverse = comparePatternToWindow(pattern, window, true);
    const chosen =
      forward.mismatchCount <= reverse.mismatchCount ? forward : reverse;
    const alignment: MatchAlignment =
      forward.mismatchCount === reverse.mismatchCount
        ? "both"
        : chosen === forward
          ? "forward"
          : "reverse";
    const clockwiseIndexes = Array.from(
      { length: pattern.length },
      (_, offset) => modulo(clockwiseStart + offset, bracelet.length),
    );
    return {
      clockwiseStart,
      clockwiseIndexes,
      alignment,
      mismatchCount: chosen.mismatchCount,
      optionIndexes: [...chosen.optionIndexes].sort((a, b) => a - b),
      braceletIndexes: chosen.braceletOffsets.map(
        (offset) => clockwiseIndexes[offset],
      ),
    };
  });

  const minimum = Math.min(
    ...comparisons.map(({ mismatchCount }) => mismatchCount),
  );
  return comparisons.filter(
    ({ mismatchCount }) => mismatchCount === minimum,
  );
}

export function findOccurrences(
  bracelet: Bracelet,
  pattern: SegmentPattern,
): readonly SegmentOccurrence[] {
  return closestBraceletComparisons(bracelet, pattern)
    .filter(({ mismatchCount }) => mismatchCount === 0)
    .map(({ clockwiseStart, clockwiseIndexes, alignment }) => ({
      clockwiseStart,
      clockwiseIndexes,
      alignment,
    }));
}

export function matchingOptionIndexes(
  bracelet: Bracelet,
  options: readonly BraceletOption[],
): readonly number[] {
  return [
    ...new Set(
      findCompatibleSolutions(bracelet, options).map(
        ({ optionIndex }) => optionIndex,
      ),
    ),
  ];
}

/**
 * Enumerate the complete solution space for a question. Hidden tokens are
 * wildcards, bracelet wraparound is allowed, and reading from the other side
 * is included by `findOccurrences`. Occurrences identify physical arcs, so the
 * two reading directions of one arc are not double-counted.
 */
export function findCompatibleSolutions(
  bracelet: Bracelet,
  options: readonly BraceletOption[],
): readonly CompatibleSolution[] {
  return options.flatMap((option, optionIndex) =>
    findOccurrences(bracelet, option.pattern).map((occurrence) => ({
      optionIndex,
      occurrence,
    })),
  );
}

function visibleDifferenceCount(
  left: SegmentPattern,
  right: SegmentPattern,
): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftToken = left[index];
    const rightToken = right[index];
    if (leftToken.kind === "hidden" || rightToken.kind === "hidden") continue;
    if (!sameBead(leftToken.bead, rightToken.bead)) differences += 1;
  }
  return differences;
}

export function visibleSegmentDistance(
  left: SegmentPattern,
  right: SegmentPattern,
): number {
  return Math.min(
    visibleDifferenceCount(left, right),
    visibleDifferenceCount(reversePattern(left), right),
  );
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

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function maximumCyclicColorRun(bracelet: Bracelet): number {
  if (bracelet.length === 0) return 0;
  let maximum = 1;
  for (let start = 0; start < bracelet.length; start += 1) {
    let run = 1;
    while (
      run < bracelet.length &&
      bracelet[modulo(start + run, bracelet.length)].color ===
        bracelet[start].color
    ) {
      run += 1;
    }
    maximum = Math.max(maximum, run);
  }
  return maximum;
}

function interestingBracelet(
  bracelet: Bracelet,
  difficulty: Difficulty,
): boolean {
  const rules = DIFFICULTY_RULES[difficulty];
  const colorScheme = braceletColorScheme(bracelet);
  const expectedColorCount =
    colorScheme === "monochrome" ? MONOCHROME_BEADS.length : rules.colorCount;
  return (
    bracelet.length === rules.braceletLength &&
    colorScheme !== null &&
    (colorScheme === "color" ||
      difficulty === "Hard" ||
      difficulty === "Wizard") &&
    new Set(bracelet.map(({ color }) => color)).size === expectedColorCount &&
    bracelet.filter(({ mark }) => mark === "dot").length === rules.dotCount &&
    maximumCyclicColorRun(bracelet) <= 2 &&
    braceletOrbitSize(bracelet) === bracelet.length * 2
  );
}

function makeGeneratedBracelet(
  difficulty: Difficulty,
  random: () => number,
): Bracelet {
  const rules = DIFFICULTY_RULES[difficulty];
  const selectedColors = shuffled(COLOR_BEADS, random).slice(
    0,
    rules.colorCount,
  );
  const beads: Bead[] = [];
  for (let index = 0; index < rules.braceletLength; index += 1) {
    beads.push({
      color: selectedColors[index % selectedColors.length],
      mark: "plain",
    });
  }
  const shuffledBeads = shuffled(beads, random);
  for (const index of shuffled(
    Array.from({ length: shuffledBeads.length }, (_, beadIndex) => beadIndex),
    random,
  ).slice(0, rules.dotCount)) {
    shuffledBeads[index] = { ...shuffledBeads[index], mark: "dot" };
  }
  return shuffledBeads;
}

function resolvedWindowIsInteresting(
  window: readonly Bead[],
  difficulty: Difficulty,
): boolean {
  const forward = window.map(beadKey).join(",");
  const reverse = [...window].reverse().map(beadKey).join(",");
  if (forward === reverse) return false;
  if (new Set(window.map(({ color }) => color)).size < 2) return false;
  if (difficulty === "Hard" || difficulty === "Wizard") {
    const dotCount = window.filter(({ mark }) => mark === "dot").length;
    if (dotCount === 0 || dotCount === window.length) return false;
    if (difficulty === "Wizard") {
      const visible = window.filter((_, index) => index !== 2);
      if (!visible.some(({ mark }) => mark === "dot")) return false;
      if (!visible.some(({ mark }) => mark === "plain")) return false;
      if (
        braceletColorScheme(window) === "monochrome" &&
        new Set(visible.map(({ color }) => color)).size !== 2
      ) {
        return false;
      }
    }
  }
  return true;
}

function occurrenceForStart(
  bracelet: Bracelet,
  pattern: SegmentPattern,
  clockwiseStart: number,
): SegmentOccurrence | null {
  return (
    findOccurrences(bracelet, pattern).find(
      (occurrence) => occurrence.clockwiseStart === clockwiseStart,
    ) ?? null
  );
}

function withChangedColor(
  pattern: SegmentPattern,
  index: number,
  color: BeadColor,
): SegmentPattern {
  const result = clonePattern(pattern);
  const token = result[index];
  if (token.kind === "hidden") return result;
  result[index] = beadToken({ ...token.bead, color });
  return result;
}

function withToggledMark(
  pattern: SegmentPattern,
  index: number,
): SegmentPattern {
  const result = clonePattern(pattern);
  const token = result[index];
  if (token.kind === "hidden") return result;
  result[index] = beadToken({
    ...token.bead,
    mark: token.bead.mark === "dot" ? "plain" : "dot",
  });
  return result;
}

function adjacentSwapCandidates(
  pattern: SegmentPattern,
): readonly SegmentPattern[] {
  return pattern.slice(0, -1).flatMap((_, index) => {
    if (
      pattern[index].kind === "hidden" ||
      pattern[index + 1].kind === "hidden"
    ) {
      return [];
    }
    const result = clonePattern(pattern);
    [result[index], result[index + 1]] = [result[index + 1], result[index]];
    return segmentClassKey(result) === segmentClassKey(pattern) ? [] : [result];
  });
}

function pathIndexesForOccurrence(
  bracelet: Bracelet,
  pattern: SegmentPattern,
  occurrence: SegmentOccurrence,
): readonly (readonly number[])[] {
  const forward = occurrence.clockwiseIndexes;
  const reverse = [...occurrence.clockwiseIndexes].reverse();
  const window = forward.map((index) => bracelet[index]);
  const forwardMatches =
    comparePatternToWindow(pattern, window, false).mismatchCount === 0;
  const reverseMatches =
    comparePatternToWindow(pattern, window, true).mismatchCount === 0;
  return [
    ...(forwardMatches ? [forward] : []),
    ...(reverseMatches ? [reverse] : []),
  ];
}

function skippedBeadCandidates(
  bracelet: Bracelet,
  correctPattern: SegmentPattern,
  occurrence: SegmentOccurrence,
  difficulty: Difficulty,
): readonly SegmentPattern[] {
  const keys = new Set<string>();
  const candidates: SegmentPattern[] = [];
  for (const path of pathIndexesForOccurrence(
    bracelet,
    correctPattern,
    occurrence,
  )) {
    const first = path[0];
    const second = path[1];
    const step =
      modulo(second - first, bracelet.length) === 1 ? 1 : -1;
    const before = modulo(first - step, bracelet.length);
    const after = modulo(path[path.length - 1] + step, bracelet.length);
    for (const extended of [[before, ...path], [...path, after]]) {
      for (let removeIndex = 1; removeIndex < extended.length - 1; removeIndex += 1) {
        const candidateBeads = extended
          .filter((_, index) => index !== removeIndex)
          .map((index) => bracelet[index]);
        const candidate = maskForDifficulty(
          patternFromBeads(candidateBeads),
          difficulty,
        );
        const key = segmentClassKey(candidate);
        if (key === segmentClassKey(correctPattern) || keys.has(key)) continue;
        keys.add(key);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function candidatePool(
  kind: DistractorKind,
  bracelet: Bracelet,
  correctPattern: SegmentPattern,
  occurrence: SegmentOccurrence,
  difficulty: Difficulty,
): readonly SegmentPattern[] {
  if (kind === "one-color-off") {
    const braceletColors =
      braceletColorScheme(bracelet) === "monochrome"
        ? MONOCHROME_BEADS
        : COLOR_BEADS;
    return correctPattern.flatMap((token, index) =>
      token.kind === "hidden"
        ? []
        : braceletColors
            .filter((color) => color !== token.bead.color)
            .map((color) =>
              withChangedColor(correctPattern, index, color),
            ),
    );
  }
  if (kind === "two-color-off") {
    const braceletColors = [
      ...new Set(bracelet.map(({ color }) => color)),
    ];
    const candidates: SegmentPattern[] = [];
    for (let left = 0; left < correctPattern.length; left += 1) {
      const leftToken = correctPattern[left];
      if (leftToken.kind === "hidden") continue;
      for (let right = left + 1; right < correctPattern.length; right += 1) {
        const rightToken = correctPattern[right];
        if (rightToken.kind === "hidden") continue;
        for (const leftColor of braceletColors) {
          if (leftColor === leftToken.bead.color) continue;
          for (const rightColor of braceletColors) {
            if (rightColor === rightToken.bead.color) continue;
            candidates.push(
              withChangedColor(
                withChangedColor(correctPattern, left, leftColor),
                right,
                rightColor,
              ),
            );
          }
        }
      }
    }
    return candidates;
  }
  if (kind === "one-mark-off") {
    return correctPattern.flatMap((token, index) =>
      token.kind === "hidden"
        ? []
        : [withToggledMark(correctPattern, index)],
    );
  }
  if (kind === "adjacent-swap") {
    return adjacentSwapCandidates(correctPattern);
  }
  return skippedBeadCandidates(
    bracelet,
    correctPattern,
    occurrence,
    difficulty,
  );
}

function literalPairDifferences(
  candidate: SegmentPattern,
  expected: SegmentPattern,
): readonly Readonly<{ candidate: Bead; expected: Bead }>[] | null {
  if (candidate.length !== expected.length) return null;
  const differences: Array<{ candidate: Bead; expected: Bead }> = [];
  for (let index = 0; index < candidate.length; index += 1) {
    const candidateToken = candidate[index];
    const expectedToken = expected[index];
    if (
      candidateToken.kind === "hidden" ||
      expectedToken.kind === "hidden"
    ) {
      if (candidateToken.kind !== expectedToken.kind) return null;
      continue;
    }
    if (!sameBead(candidateToken.bead, expectedToken.bead)) {
      differences.push({
        candidate: candidateToken.bead,
        expected: expectedToken.bead,
      });
    }
  }
  return differences;
}

function hasOneFeatureDifference(
  candidate: SegmentPattern,
  expected: SegmentPattern,
  feature: "color" | "mark",
): boolean {
  for (const orientedCandidate of [
    candidate,
    reversePattern(candidate),
  ] as const) {
    const differences = literalPairDifferences(orientedCandidate, expected);
    if (!differences || differences.length !== 1) continue;
    const [{ candidate: candidateBead, expected: expectedBead }] = differences;
    if (
      feature === "color" &&
      candidateBead.color !== expectedBead.color &&
      candidateBead.mark === expectedBead.mark
    ) {
      return true;
    }
    if (
      feature === "mark" &&
      candidateBead.color === expectedBead.color &&
      candidateBead.mark !== expectedBead.mark
    ) {
      return true;
    }
  }
  return false;
}

function hasTwoColorDifferences(
  candidate: SegmentPattern,
  expected: SegmentPattern,
): boolean {
  for (const orientedCandidate of [
    candidate,
    reversePattern(candidate),
  ] as const) {
    const differences = literalPairDifferences(orientedCandidate, expected);
    if (
      differences?.length === 2 &&
      differences.every(
        ({ candidate: candidateBead, expected: expectedBead }) =>
          candidateBead.color !== expectedBead.color &&
          candidateBead.mark === expectedBead.mark,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function distractorKindMatches(
  round: BraceletRound,
  optionIndex: number,
): boolean {
  if (optionIndex === round.correctIndex) {
    return round.options[optionIndex].kind === "correct";
  }
  const option = round.options[optionIndex];
  const correct = round.options[round.correctIndex].pattern;
  if (option.kind === "correct") return false;
  if (option.kind === "one-color-off") {
    return hasOneFeatureDifference(option.pattern, correct, "color");
  }
  if (option.kind === "two-color-off") {
    return hasTwoColorDifferences(option.pattern, correct);
  }
  if (option.kind === "one-mark-off") {
    return hasOneFeatureDifference(option.pattern, correct, "mark");
  }
  if (option.kind === "adjacent-swap") {
    const candidateKey = segmentClassKey(option.pattern);
    return adjacentSwapCandidates(correct).some(
      (candidate) => segmentClassKey(candidate) === candidateKey,
    );
  }
  const candidateKey = segmentClassKey(option.pattern);
  return skippedBeadCandidates(
    round.bracelet,
    correct,
    round.occurrence,
    round.difficulty,
  ).some((candidate) => segmentClassKey(candidate) === candidateKey);
}

function sameOccurrence(
  left: SegmentOccurrence,
  right: SegmentOccurrence,
): boolean {
  return (
    left.clockwiseStart === right.clockwiseStart &&
    left.alignment === right.alignment &&
    left.clockwiseIndexes.length === right.clockwiseIndexes.length &&
    left.clockwiseIndexes.every(
      (value, index) => value === right.clockwiseIndexes[index],
    )
  );
}

export function validateRound(round: BraceletRound): ValidationResult {
  const issues: string[] = [];
  const rules = DIFFICULTY_RULES[round.difficulty];
  if (!rules) return { valid: false, issues: ["Unknown difficulty."] };
  const colorScheme = braceletColorScheme(round.bracelet);
  const allowedColors =
    colorScheme === "monochrome" ? MONOCHROME_BEADS : COLOR_BEADS;
  if (!interestingBracelet(round.bracelet, round.difficulty)) {
    issues.push("Bracelet does not satisfy its difficulty rules.");
  }
  if (round.options.length !== 4) issues.push("A round must have four options.");

  for (const [index, option] of round.options.entries()) {
    if (option.pattern.length !== rules.segmentLength) {
      issues.push(`Option ${index + 1} has the wrong segment length.`);
    }
    const hiddenIndexes = option.pattern.flatMap((token, tokenIndex) =>
      token.kind === "hidden" ? [tokenIndex] : [],
    );
    if (hiddenIndexes.length !== rules.hiddenCount) {
      issues.push(`Option ${index + 1} has the wrong hidden-bead count.`);
    }
    if (
      rules.hiddenIndex !== null &&
      (hiddenIndexes.length !== 1 || hiddenIndexes[0] !== rules.hiddenIndex)
    ) {
      issues.push(`Option ${index + 1} must hide only its center bead.`);
    }
    if (
      option.pattern.some(
        (token) =>
          token.kind === "bead" &&
          !allowedColors.includes(token.bead.color),
      )
    ) {
      issues.push(`Option ${index + 1} mixes bead color schemes.`);
    }
  }

  if (round.difficulty === "Easy" || round.difficulty === "Medium") {
    const braceletColors = new Set(
      round.bracelet.map(({ color }) => color),
    );
    for (const [optionIndex, option] of round.options.entries()) {
      if (
        option.pattern.some(
          (token) =>
            token.kind === "bead" &&
            !braceletColors.has(token.bead.color),
        )
      ) {
        issues.push(
          `Simple option ${optionIndex + 1} uses a color absent from the bracelet.`,
        );
      }
    }
    for (let left = 0; left < round.options.length; left += 1) {
      for (let right = left + 1; right < round.options.length; right += 1) {
        if (
          visibleSegmentDistance(
            round.options[left].pattern,
            round.options[right].pattern,
          ) < 2
        ) {
          issues.push(
            `Simple options ${left + 1} and ${right + 1} must differ in at least two positions.`,
          );
        }
      }
    }
    if (
      round.options.some(
        ({ kind }) =>
          kind === "one-color-off" || kind === "one-mark-off",
      )
    ) {
      issues.push("Simple rounds cannot use one-feature distractors.");
    }
  }

  if (
    new Set(round.options.map(({ pattern }) => segmentClassKey(pattern))).size !==
    4
  ) {
    issues.push("Options must be distinct even when read in reverse.");
  }

  const solutions = findCompatibleSolutions(round.bracelet, round.options);
  if (
    solutions.length !== 1 ||
    solutions[0].optionIndex !== round.correctIndex
  ) {
    issues.push(
      "Exactly one option at one physical placement must match in either direction.",
    );
  }
  if (round.options[round.correctIndex]?.kind !== "correct") {
    issues.push("The calculated answer must carry the correct option kind.");
  }

  const correctPattern = round.options[round.correctIndex]?.pattern;
  if (correctPattern) {
    const occurrences = findOccurrences(round.bracelet, correctPattern);
    if (occurrences.length !== 1) {
      issues.push("The correct strip must have one physical placement.");
    } else if (!sameOccurrence(occurrences[0], round.occurrence)) {
      issues.push("Stored occurrence does not match the calculated occurrence.");
    }
    const resolvedWindow = clockwiseWindow(
      round.bracelet,
      round.occurrence.clockwiseStart,
      rules.segmentLength,
    );
    if (!resolvedWindowIsInteresting(resolvedWindow, round.difficulty)) {
      issues.push("The correct strip is degenerate or too weak.");
    }
  }

  for (const [index, option] of round.options.entries()) {
    if (index === round.correctIndex) continue;
    if (option.kind === "correct") {
      issues.push(`Option ${index + 1} is wrongly labelled correct.`);
    }
    if (!distractorKindMatches(round, index)) {
      issues.push(`Option ${index + 1} does not match its distractor kind.`);
    }
    if (
      correctPattern &&
      visibleSegmentDistance(option.pattern, correctPattern) >
        rules.maximumDistractorDistance
    ) {
      issues.push(`Option ${index + 1} is not a close near-miss.`);
    }
    const comparisons = closestBraceletComparisons(
      round.bracelet,
      option.pattern,
    );
    if (
      comparisons.length !== 1 ||
      comparisons[0].mismatchCount === 0 ||
      (round.difficulty !== "Wizard" &&
        comparisons[0].alignment === "both")
    ) {
      issues.push(
        `Option ${index + 1} must have one unique, directional, nonmatching closest comparison.`,
      );
    }
  }

  if (
    (round.difficulty === "Hard" || round.difficulty === "Wizard") &&
    !round.options.some(({ kind }) => kind === "one-mark-off")
  ) {
    issues.push("Advanced rounds need a one-mark-off near-miss.");
  }

  return { valid: issues.length === 0, issues };
}

function assertValidRound(round: BraceletRound, label: string): void {
  const validation = validateRound(round);
  if (!validation.valid) {
    throw new Error(`${label}: ${validation.issues.join(" ")}`);
  }
}

export function roundFingerprint(round: BraceletRound): string {
  return `bracelet-v1:${braceletClassKey(round.bracelet)}=>${segmentClassKey(
    round.options[round.correctIndex].pattern,
  )}`;
}

export function analyzeWrongAttempt(
  round: BraceletRound,
  optionIndex: number,
): WrongAttemptAnalysis {
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= round.options.length
  ) {
    throw new Error("Option index is out of range.");
  }
  if (optionIndex === round.correctIndex) {
    throw new Error("Correct answers do not have wrong-attempt feedback.");
  }
  const [comparison] = closestBraceletComparisons(
    round.bracelet,
    round.options[optionIndex].pattern,
  );
  if (round.difficulty === "Wizard") {
    return {
      kind: "visible-conflict",
      visibleMismatchCount: comparison.mismatchCount,
    };
  }
  return {
    kind: "comparison",
    visibleMismatchCount: comparison.mismatchCount,
    optionIndexes: comparison.optionIndexes,
    braceletIndexes: comparison.braceletIndexes,
    occurrence: {
      clockwiseStart: comparison.clockwiseStart,
      clockwiseIndexes: comparison.clockwiseIndexes,
      alignment: comparison.alignment,
    },
  };
}

export function resolvedCorrectPattern(
  round: BraceletRound,
): SegmentPattern {
  const beads = round.occurrence.clockwiseIndexes.map(
    (index) => round.bracelet[index],
  );
  return patternFromBeads(
    round.occurrence.alignment === "reverse"
      ? [...beads].reverse()
      : beads,
  );
}

function requiredDistractorKinds(
  difficulty: Difficulty,
  random: () => number,
): readonly [DistractorKind, DistractorKind, DistractorKind] {
  if (difficulty === "Easy") {
    return ["two-color-off", "two-color-off", "two-color-off"];
  }
  if (difficulty === "Medium") {
    return ["two-color-off", "adjacent-swap", "skipped-bead"];
  }
  return [
    "one-color-off",
    "one-mark-off",
    randomInteger(random, 2) === 0 ? "adjacent-swap" : "skipped-bead",
  ];
}

function assembleRound(
  id: string,
  difficulty: Difficulty,
  bracelet: Bracelet,
  options: readonly [
    BraceletOption,
    BraceletOption,
    BraceletOption,
    BraceletOption,
  ],
): BraceletRound | null {
  const matchingIndexes = matchingOptionIndexes(bracelet, options);
  if (matchingIndexes.length !== 1) return null;
  const correctIndex = matchingIndexes[0] as 0 | 1 | 2 | 3;
  const occurrences = findOccurrences(
    bracelet,
    options[correctIndex].pattern,
  );
  if (occurrences.length !== 1) return null;
  const round: BraceletRound = {
    id,
    difficulty,
    bracelet,
    options,
    correctIndex,
    occurrence: occurrences[0],
  };
  return validateRound(round).valid ? round : null;
}

function generatedRoundCandidate(
  difficulty: Difficulty,
  random: () => number,
): BraceletRound | null {
  const bracelet = makeGeneratedBracelet(difficulty, random);
  if (!interestingBracelet(bracelet, difficulty)) return null;
  const rules = DIFFICULTY_RULES[difficulty];

  const targets = bracelet.flatMap((_, clockwiseStart) => {
    const window = clockwiseWindow(
      bracelet,
      clockwiseStart,
      rules.segmentLength,
    );
    if (!resolvedWindowIsInteresting(window, difficulty)) return [];
    const pattern = maskForDifficulty(patternFromBeads(window), difficulty);
    const occurrences = findOccurrences(bracelet, pattern);
    return occurrences.length === 1 &&
      occurrences[0].clockwiseStart === clockwiseStart
      ? [{ clockwiseStart, window }]
      : [];
  });
  if (targets.length === 0) return null;

  const target = targets[randomInteger(random, targets.length)];
  const displayedBeads =
    randomInteger(random, 2) === 0
      ? target.window
      : [...target.window].reverse();
  const correctPattern = maskForDifficulty(
    patternFromBeads(displayedBeads),
    difficulty,
  );
  const occurrence = occurrenceForStart(
    bracelet,
    correctPattern,
    target.clockwiseStart,
  );
  if (!occurrence || occurrence.alignment === "both") return null;

  const selectedKeys = new Set([segmentClassKey(correctPattern)]);
  const distractors: BraceletOption[] = [];
  for (const kind of requiredDistractorKinds(difficulty, random)) {
    const candidates = shuffled(
      candidatePool(
        kind,
        bracelet,
        correctPattern,
        occurrence,
        difficulty,
      ),
      random,
    );
    const chosen = candidates.find((candidate) => {
      const key = segmentClassKey(candidate);
      if (selectedKeys.has(key)) return false;
      if (findOccurrences(bracelet, candidate).length !== 0) return false;
      if (
        visibleSegmentDistance(candidate, correctPattern) >
        rules.maximumDistractorDistance
      ) {
        return false;
      }
      if (
        (difficulty === "Easy" || difficulty === "Medium") &&
        [
          correctPattern,
          ...distractors.map(({ pattern }) => pattern),
        ].some(
          (selected) => visibleSegmentDistance(candidate, selected) < 2,
        )
      ) {
        return false;
      }
      const comparisons = closestBraceletComparisons(bracelet, candidate);
      return (
        comparisons.length === 1 &&
        comparisons[0].mismatchCount > 0 &&
        (difficulty === "Wizard" || comparisons[0].alignment !== "both")
      );
    });
    if (!chosen) return null;
    selectedKeys.add(segmentClassKey(chosen));
    distractors.push({ pattern: chosen, kind });
  }

  const shuffledOptions = shuffled(
    [
      { pattern: correctPattern, kind: "correct" as const },
      ...distractors,
    ],
    random,
  ) as [
    BraceletOption,
    BraceletOption,
    BraceletOption,
    BraceletOption,
  ];
  return assembleRound("infinite:pending", difficulty, bracelet, shuffledOptions);
}

export function generateInfiniteRound(
  difficulty: Difficulty,
  random: () => number = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): BraceletRound {
  if (!isDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generatedRoundCandidate(difficulty, random);
    if (!candidate) continue;
    const fingerprint = roundFingerprint(candidate);
    if (excludedFingerprints.has(fingerprint)) continue;
    return { ...candidate, id: `infinite:${fingerprint}` };
  }
  throw new Error(
    `Unable to generate a valid ${difficulty} bracelet round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

export type EncodedRoundSpec = Readonly<{
  id: string;
  difficulty: Difficulty;
  bracelet: string;
  options: readonly [string, string, string, string];
  optionKinds: readonly [OptionKind, OptionKind, OptionKind, OptionKind];
}>;

// Campaign content is generated offline, visually reviewed, and frozen here.
// The empty scaffold is replaced below with the committed 48-round corpus.
export const CAMPAIGN_SPECS: readonly EncodedRoundSpec[] = [
  {
    "id": "campaign:easy:01",
    "difficulty": "Easy",
    "bracelet": "CCVGVGTT",
    "options": [
      "TTC",
      "GTV",
      "TVV",
      "GGC"
    ],
    "optionKinds": [
      "correct",
      "two-color-off",
      "two-color-off",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:02",
    "difficulty": "Easy",
    "bracelet": "TVVCGCGT",
    "options": [
      "GGV",
      "CVV",
      "CTG",
      "CCT"
    ],
    "optionKinds": [
      "two-color-off",
      "correct",
      "two-color-off",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:03",
    "difficulty": "Easy",
    "bracelet": "GVGVTCTC",
    "options": [
      "TVV",
      "GTV",
      "CGV",
      "CCG"
    ],
    "optionKinds": [
      "two-color-off",
      "two-color-off",
      "correct",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:04",
    "difficulty": "Easy",
    "bracelet": "TGTVVCCG",
    "options": [
      "GCT",
      "VGG",
      "CTT",
      "VVT"
    ],
    "optionKinds": [
      "two-color-off",
      "two-color-off",
      "two-color-off",
      "correct"
    ]
  },
  {
    "id": "campaign:easy:05",
    "difficulty": "Easy",
    "bracelet": "GTTCCVGV",
    "options": [
      "VVT",
      "CCT",
      "CGG",
      "VCG"
    ],
    "optionKinds": [
      "two-color-off",
      "correct",
      "two-color-off",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:06",
    "difficulty": "Easy",
    "bracelet": "TGTGVVCC",
    "options": [
      "GVT",
      "VTT",
      "CGG",
      "CCT"
    ],
    "optionKinds": [
      "two-color-off",
      "two-color-off",
      "two-color-off",
      "correct"
    ]
  },
  {
    "id": "campaign:easy:07",
    "difficulty": "Easy",
    "bracelet": "TCTGVGVC",
    "options": [
      "CVG",
      "CGT",
      "TTG",
      "VCG"
    ],
    "optionKinds": [
      "correct",
      "two-color-off",
      "two-color-off",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:08",
    "difficulty": "Easy",
    "bracelet": "VTVGCGCT",
    "options": [
      "GVC",
      "VGT",
      "GCT",
      "CTT"
    ],
    "optionKinds": [
      "two-color-off",
      "two-color-off",
      "correct",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:09",
    "difficulty": "Easy",
    "bracelet": "CCTTVGVG",
    "options": [
      "CVV",
      "GCV",
      "GGT",
      "CCT"
    ],
    "optionKinds": [
      "two-color-off",
      "two-color-off",
      "two-color-off",
      "correct"
    ]
  },
  {
    "id": "campaign:easy:10",
    "difficulty": "Easy",
    "bracelet": "GTTVCVCG",
    "options": [
      "VVG",
      "CCT",
      "VTT",
      "VGC"
    ],
    "optionKinds": [
      "two-color-off",
      "two-color-off",
      "correct",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:11",
    "difficulty": "Easy",
    "bracelet": "CTCTVGVG",
    "options": [
      "GCV",
      "CTV",
      "TVV",
      "CGG"
    ],
    "optionKinds": [
      "two-color-off",
      "correct",
      "two-color-off",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:easy:12",
    "difficulty": "Easy",
    "bracelet": "GTVVCCGT",
    "options": [
      "CVV",
      "TVG",
      "CTT",
      "GGV"
    ],
    "optionKinds": [
      "correct",
      "two-color-off",
      "two-color-off",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:medium:01",
    "difficulty": "Medium",
    "bracelet": "GCGCVVCTTV",
    "options": [
      "VGGC",
      "TVTC",
      "VTTC",
      "VTCV"
    ],
    "optionKinds": [
      "two-color-off",
      "adjacent-swap",
      "correct",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:medium:02",
    "difficulty": "Medium",
    "bracelet": "VTVCCVGTCG",
    "options": [
      "CVGT",
      "CCGG",
      "CGTC",
      "CVTG"
    ],
    "optionKinds": [
      "correct",
      "two-color-off",
      "skipped-bead",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:medium:03",
    "difficulty": "Medium",
    "bracelet": "VGGVGTTCVC",
    "options": [
      "GTGG",
      "TTVG",
      "CTTV",
      "TTGV"
    ],
    "optionKinds": [
      "two-color-off",
      "adjacent-swap",
      "skipped-bead",
      "correct"
    ]
  },
  {
    "id": "campaign:medium:04",
    "difficulty": "Medium",
    "bracelet": "GGCTVVGVTC",
    "options": [
      "CVVT",
      "VGVT",
      "VVGT",
      "VGTC"
    ],
    "optionKinds": [
      "two-color-off",
      "correct",
      "adjacent-swap",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:medium:05",
    "difficulty": "Medium",
    "bracelet": "GTVGGCCTCV",
    "options": [
      "VGTV",
      "GGCV",
      "VGVT",
      "VTVG"
    ],
    "optionKinds": [
      "correct",
      "two-color-off",
      "adjacent-swap",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:medium:06",
    "difficulty": "Medium",
    "bracelet": "VCVTTGGVTC",
    "options": [
      "TVGT",
      "VTTT",
      "VGGT",
      "VGTG"
    ],
    "optionKinds": [
      "skipped-bead",
      "two-color-off",
      "correct",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:medium:07",
    "difficulty": "Medium",
    "bracelet": "VGCTVCVTTG",
    "options": [
      "GTTC",
      "GCTV",
      "GTCV",
      "VGTV"
    ],
    "optionKinds": [
      "two-color-off",
      "correct",
      "adjacent-swap",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:medium:08",
    "difficulty": "Medium",
    "bracelet": "TGVCTGVCGT",
    "options": [
      "TGTV",
      "VTCV",
      "VGCT",
      "VGTC"
    ],
    "optionKinds": [
      "two-color-off",
      "skipped-bead",
      "adjacent-swap",
      "correct"
    ]
  },
  {
    "id": "campaign:medium:09",
    "difficulty": "Medium",
    "bracelet": "TVGTCCVTCG",
    "options": [
      "TGVG",
      "GVTG",
      "VGTG",
      "GCTT"
    ],
    "optionKinds": [
      "skipped-bead",
      "correct",
      "adjacent-swap",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:medium:10",
    "difficulty": "Medium",
    "bracelet": "CVGTCVVTGG",
    "options": [
      "GTVC",
      "VGCV",
      "VTCT",
      "GTCV"
    ],
    "optionKinds": [
      "adjacent-swap",
      "skipped-bead",
      "two-color-off",
      "correct"
    ]
  },
  {
    "id": "campaign:medium:11",
    "difficulty": "Medium",
    "bracelet": "VCVGCTCTGT",
    "options": [
      "TCGV",
      "TCCG",
      "TCVC",
      "CTGV"
    ],
    "optionKinds": [
      "correct",
      "two-color-off",
      "skipped-bead",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:medium:12",
    "difficulty": "Medium",
    "bracelet": "CGTTCGGTVV",
    "options": [
      "GVVC",
      "GVTV",
      "GTVV",
      "TTGV"
    ],
    "optionKinds": [
      "skipped-bead",
      "adjacent-swap",
      "correct",
      "two-color-off"
    ]
  },
  {
    "id": "campaign:hard:01",
    "difficulty": "Hard",
    "bracelet": "VCGVvtTGCTcg",
    "options": [
      "GvVtT",
      "GVvtT",
      "GVvtC",
      "GVvTT"
    ],
    "optionKinds": [
      "adjacent-swap",
      "correct",
      "one-color-off",
      "one-mark-off"
    ]
  },
  {
    "id": "campaign:hard:02",
    "difficulty": "Hard",
    "bracelet": "TVGCCvgGcTTv",
    "options": [
      "TcgvC",
      "cGcvC",
      "cGGvC",
      "cGgvC"
    ],
    "optionKinds": [
      "skipped-bead",
      "one-color-off",
      "one-mark-off",
      "correct"
    ]
  },
  {
    "id": "campaign:hard:03",
    "difficulty": "Hard",
    "bracelet": "lLBBlBLbLLbB",
    "options": [
      "lBBLl",
      "bBBLl",
      "LBBLl",
      "BlBLl"
    ],
    "optionKinds": [
      "correct",
      "one-color-off",
      "one-mark-off",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:hard:04",
    "difficulty": "Hard",
    "bracelet": "TCvcVTgCGVtG",
    "options": [
      "tgCGV",
      "TgVGV",
      "TgCGV",
      "gTCGV"
    ],
    "optionKinds": [
      "one-mark-off",
      "one-color-off",
      "correct",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:hard:05",
    "difficulty": "Hard",
    "bracelet": "CvvTTgcTVGGC",
    "options": [
      "GVtcg",
      "GVTtg",
      "GVTcT",
      "GVTcg"
    ],
    "optionKinds": [
      "one-mark-off",
      "one-color-off",
      "skipped-bead",
      "correct"
    ]
  },
  {
    "id": "campaign:hard:06",
    "difficulty": "Hard",
    "bracelet": "GVTGcTGtCCvv",
    "options": [
      "cTGTC",
      "cTGtC",
      "cTtGC",
      "cTVtC"
    ],
    "optionKinds": [
      "one-mark-off",
      "correct",
      "adjacent-swap",
      "one-color-off"
    ]
  },
  {
    "id": "campaign:hard:07",
    "difficulty": "Hard",
    "bracelet": "LLBBlLBBLlbb",
    "options": [
      "LLlbb",
      "bLlbb",
      "BLlbb",
      "LBlbb"
    ],
    "optionKinds": [
      "one-color-off",
      "one-mark-off",
      "correct",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:hard:08",
    "difficulty": "Hard",
    "bracelet": "VttGgCVGcCTV",
    "options": [
      "CgGtt",
      "VgGtt",
      "CGGtt",
      "GgGtt"
    ],
    "optionKinds": [
      "correct",
      "skipped-bead",
      "one-mark-off",
      "one-color-off"
    ]
  },
  {
    "id": "campaign:hard:09",
    "difficulty": "Hard",
    "bracelet": "VcvtTCVTGGcG",
    "options": [
      "vtTGV",
      "vtTcV",
      "vtTCV",
      "ctTCV"
    ],
    "optionKinds": [
      "one-color-off",
      "one-mark-off",
      "correct",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:hard:10",
    "difficulty": "Hard",
    "bracelet": "GVcVgVTtCtGC",
    "options": [
      "GtCtT",
      "GtctT",
      "GtCtC",
      "GtCTt"
    ],
    "optionKinds": [
      "correct",
      "one-mark-off",
      "one-color-off",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:hard:11",
    "difficulty": "Hard",
    "bracelet": "BBLlBLlbLbBL",
    "options": [
      "LBLlB",
      "BbLlB",
      "BBlLB",
      "BBLlB"
    ],
    "optionKinds": [
      "one-color-off",
      "one-mark-off",
      "adjacent-swap",
      "correct"
    ]
  },
  {
    "id": "campaign:hard:12",
    "difficulty": "Hard",
    "bracelet": "tTvGCGgCvTVC",
    "options": [
      "vTtCC",
      "vTtCV",
      "vTCtV",
      "vTtcV"
    ],
    "optionKinds": [
      "one-color-off",
      "correct",
      "adjacent-swap",
      "one-mark-off"
    ]
  },
  {
    "id": "campaign:wizard:01",
    "difficulty": "Wizard",
    "bracelet": "GctVtVCGCGtV",
    "options": [
      "Vc?GV",
      "Vt?Gt",
      "vt?GV",
      "Vt?GV"
    ],
    "optionKinds": [
      "one-color-off",
      "skipped-bead",
      "one-mark-off",
      "correct"
    ]
  },
  {
    "id": "campaign:wizard:02",
    "difficulty": "Wizard",
    "bracelet": "LBLBBLblLbLb",
    "options": [
      "LL?lL",
      "BL?lL",
      "Bl?lL",
      "LB?lL"
    ],
    "optionKinds": [
      "one-color-off",
      "correct",
      "one-mark-off",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:wizard:03",
    "difficulty": "Wizard",
    "bracelet": "GTVvTgGCCVct",
    "options": [
      "Cv?tG",
      "TV?tG",
      "CV?tG",
      "CC?cG"
    ],
    "optionKinds": [
      "one-mark-off",
      "one-color-off",
      "correct",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:wizard:04",
    "difficulty": "Wizard",
    "bracelet": "TvGCcGtVGVtC",
    "options": [
      "vT?tV",
      "GT?tV",
      "vC?tV",
      "vT?tv"
    ],
    "optionKinds": [
      "correct",
      "skipped-bead",
      "one-color-off",
      "one-mark-off"
    ]
  },
  {
    "id": "campaign:wizard:05",
    "difficulty": "Wizard",
    "bracelet": "GCVvgcTvTCGT",
    "options": [
      "vc?vT",
      "gc?vT",
      "gc?vt",
      "gc?cT"
    ],
    "optionKinds": [
      "skipped-bead",
      "correct",
      "one-mark-off",
      "one-color-off"
    ]
  },
  {
    "id": "campaign:wizard:06",
    "difficulty": "Wizard",
    "bracelet": "ctVCTGGTvCgV",
    "options": [
      "GT?vt",
      "GG?Ct",
      "GT?Vt",
      "GT?Tt"
    ],
    "optionKinds": [
      "one-mark-off",
      "skipped-bead",
      "correct",
      "one-color-off"
    ]
  },
  {
    "id": "campaign:wizard:07",
    "difficulty": "Wizard",
    "bracelet": "LlbBLlBLBBlB",
    "options": [
      "LB?bL",
      "Lb?lL",
      "LB?Ll",
      "LB?lL"
    ],
    "optionKinds": [
      "one-color-off",
      "one-mark-off",
      "adjacent-swap",
      "correct"
    ]
  },
  {
    "id": "campaign:wizard:08",
    "difficulty": "Wizard",
    "bracelet": "gVTtVCTGGVcc",
    "options": [
      "gV?tV",
      "cV?tV",
      "gV?tv",
      "gV?tC"
    ],
    "optionKinds": [
      "correct",
      "one-color-off",
      "one-mark-off",
      "skipped-bead"
    ]
  },
  {
    "id": "campaign:wizard:09",
    "difficulty": "Wizard",
    "bracelet": "BLbBLLBBLlbl",
    "options": [
      "lL?LL",
      "lL?Bl",
      "lL?BL",
      "Ll?BL"
    ],
    "optionKinds": [
      "one-color-off",
      "one-mark-off",
      "correct",
      "adjacent-swap"
    ]
  },
  {
    "id": "campaign:wizard:10",
    "difficulty": "Wizard",
    "bracelet": "gTggTCVCvVCT",
    "options": [
      "Tg?gg",
      "Tt?gg",
      "Cg?gg",
      "Tg?gG"
    ],
    "optionKinds": [
      "correct",
      "one-color-off",
      "skipped-bead",
      "one-mark-off"
    ]
  },
  {
    "id": "campaign:wizard:11",
    "difficulty": "Wizard",
    "bracelet": "CVCTGGVvttGc",
    "options": [
      "tv?GT",
      "tv?GG",
      "tV?GG",
      "vv?GG"
    ],
    "optionKinds": [
      "skipped-bead",
      "correct",
      "one-mark-off",
      "one-color-off"
    ]
  },
  {
    "id": "campaign:wizard:12",
    "difficulty": "Wizard",
    "bracelet": "tVVtCgGVcGTC",
    "options": [
      "tc?GV",
      "tC?Vc",
      "tC?CV",
      "tC?GV"
    ],
    "optionKinds": [
      "one-mark-off",
      "skipped-bead",
      "one-color-off",
      "correct"
    ]
  }
];

export function buildEncodedBraceletRounds(
  specs: readonly EncodedRoundSpec[],
): readonly BraceletRound[] {
  const rounds = specs.map((spec) => {
    const bracelet = decodeBracelet(spec.bracelet);
    const options = spec.options.map((encoded, index) => ({
      pattern: decodePattern(encoded),
      kind: spec.optionKinds[index],
    })) as [
      BraceletOption,
      BraceletOption,
      BraceletOption,
      BraceletOption,
    ];
    const round = assembleRound(spec.id, spec.difficulty, bracelet, options);
    if (!round) throw new Error(`${spec.id} is not a valid Bracelet Search round.`);
    assertValidRound(round, spec.id);
    return round;
  });

  if (new Set(rounds.map(({ id }) => id)).size !== rounds.length) {
    throw new Error("Bracelet Search round IDs must be unique.");
  }
  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error("Bracelet Search round fingerprints must be unique.");
  }
  return rounds;
}

export function buildCampaignRounds(): readonly BraceletRound[] {
  return buildEncodedBraceletRounds(CAMPAIGN_SPECS);
}

export const ROUNDS = buildCampaignRounds();

const tutorialBracelet = decodeBracelet("GCGVVGVC");
const tutorialAnswer = decodePattern("VGC");
const tutorialOccurrences = findOccurrences(
  tutorialBracelet,
  tutorialAnswer,
);
if (
  tutorialOccurrences.length !== 1 ||
  tutorialOccurrences[0].alignment !== "reverse"
) {
  throw new Error("Bracelet Search tutorial must demonstrate one reverse match.");
}

export const TUTORIAL = {
  bracelet: tutorialBracelet,
  answer: tutorialAnswer,
  nearMiss: decodePattern("VCV"),
  occurrence: tutorialOccurrences[0],
} as const;
