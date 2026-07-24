export const DIFFICULTIES = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * The three monochrome patterns are redundantly encoded by fill and mark, so
 * recognizing a pattern never depends on color.
 */
export type Pattern = "solid" | "hollow" | "striped";
export type CellState = Pattern;
export type Strip = readonly Pattern[];

export type ReplaceRule = Readonly<{
  kind: "replace";
  from: Pattern;
  to: Pattern;
}>;

/** The complete finite rule grammar: one global simultaneous replacement. */
export type TransitionRule = ReplaceRule;

export type TraceStep = Readonly<{
  /** Recipe position, starting at zero. Recipes always run top-to-bottom. */
  executionIndex: number;
  /** Kept explicit so the renderer can associate a proof frame with its card. */
  ruleIndex: number;
  rule: TransitionRule;
  before: Strip;
  after: Strip;
  changedIndexes: readonly number[];
}>;

export type ProgramResult = Readonly<{
  output: Strip;
  steps: readonly TraceStep[];
}>;

export type MisconceptionKind =
  | "wrong-order"
  | "stopped-early"
  | "one-step-only"
  | "skipped-step"
  | "missed-all"
  | "reversed-arrow"
  | "wrong-source"
  | "wrong-target"
  | "changed-some-matches";

export type OptionKind = "correct" | MisconceptionKind;

export type StripOption = Readonly<{
  /** Row-major cells using the owning round's rows and columns. */
  strip: Strip;
  kind: OptionKind;
}>;

export type StripRound = Readonly<{
  id: string;
  difficulty: Difficulty;
  rows: 1 | 2;
  columns: number;
  /** Row-major board cells. Rules never depend on a cell's position. */
  input: Strip;
  /** Cards execute in this array order, visibly top-to-bottom. */
  rules: readonly TransitionRule[];
  options: readonly [
    StripOption,
    StripOption,
    StripOption,
    StripOption,
  ];
  correctIndex: 0 | 1 | 2 | 3;
  answer: Strip;
  isExample?: true;
}>;

export type AuthoredChangingStripsRoundSpec = Readonly<{
  /**
   * Selects a deterministic curriculum variant. Standalone Campaign uses
   * 0–11; Journey-only banks use later variants without duplicating content.
   */
  authoredIndex: number;
  correctIndex: 0 | 1 | 2 | 3;
}>;

export type OptionFeedback = Readonly<{
  correct: boolean;
  kind: OptionKind;
  mismatchCount: number;
  differingIndexes: readonly number[];
  attempted: Strip;
  expected: Strip;
  message: string;
  trace: readonly TraceStep[];
}>;

export type RandomSource = () => number;

export const PATTERNS = [
  "solid",
  "hollow",
  "striped",
] as const satisfies readonly Pattern[];

/** Compatibility name for shared visual helpers that render individual cells. */
export const CELL_STATES = PATTERNS;

export const PATTERN_META: Readonly<
  Record<
    Pattern,
    Readonly<{
      label: string;
      symbol: string;
      color: string;
      accessibleDescription: string;
    }>
  >
> = {
  solid: {
    label: "Solid",
    symbol: "●",
    color: "#17213d",
    accessibleDescription: "solid black square",
  },
  hollow: {
    label: "Hollow",
    symbol: "○",
    color: "#fffdf8",
    accessibleDescription: "hollow white square with a black ring",
  },
  striped: {
    label: "Striped",
    symbol: "◍",
    color: "#17213d",
    accessibleDescription: "black-and-white diagonally striped square",
  },
};

/** Compatibility name for the renderer; values use the simplified patterns. */
export const CELL_STATE_META = PATTERN_META;

export const DIFFICULTY_RULES: Readonly<
  Record<
    Difficulty,
    Readonly<{
      minSteps: 2 | 3 | 4;
      maxSteps: 2 | 3 | 4 | 6;
      rows: 1 | 2;
      columns: number;
    }>
  >
> = {
  Starter: {
    minSteps: 2,
    maxSteps: 2,
    rows: 1,
    columns: 6,
  },
  Junior: {
    minSteps: 2,
    maxSteps: 3,
    rows: 1,
    columns: 6,
  },
  Expert: {
    minSteps: 3,
    maxSteps: 4,
    rows: 2,
    columns: 5,
  },
  Wizard: {
    minSteps: 4,
    maxSteps: 6,
    rows: 2,
    columns: 5,
  },
};

export const GENERATOR_MAX_ATTEMPTS = 256;

const PATTERN_CODE: Readonly<Record<Pattern, string>> = {
  solid: "S",
  hollow: "H",
  striped: "T",
};

const CODE_PATTERN: Readonly<Record<string, Pattern>> = {
  S: "solid",
  H: "hollow",
  T: "striped",
};

const CAMPAIGN_CORRECT_INDEXES = {
  Starter: [0, 2, 0, 3, 1, 0, 1, 3, 2, 1, 2, 3],
  Junior: [1, 0, 1, 2, 3, 1, 3, 2, 0, 2, 0, 3],
  Expert: [2, 1, 2, 3, 0, 1, 0, 2, 3, 0, 3, 1],
  Wizard: [3, 0, 3, 2, 1, 3, 1, 2, 0, 1, 0, 2],
} as const satisfies Readonly<
  Record<Difficulty, readonly (0 | 1 | 2 | 3)[]>
>;

const PATTERN_PERMUTATIONS = [
  ["solid", "hollow", "striped"],
  ["solid", "striped", "hollow"],
  ["hollow", "solid", "striped"],
  ["hollow", "striped", "solid"],
  ["striped", "solid", "hollow"],
  ["striped", "hollow", "solid"],
] as const satisfies readonly (readonly [Pattern, Pattern, Pattern])[];

function cloneStrip(strip: Strip): Pattern[] {
  return [...strip];
}

function cloneRule(rule: TransitionRule): TransitionRule {
  return { ...rule };
}

function sameStrip(firstStrip: Strip, secondStrip: Strip): boolean {
  return (
    firstStrip.length === secondStrip.length &&
    firstStrip.every(
      (pattern, index) => pattern === secondStrip[index],
    )
  );
}

function isPattern(value: unknown): value is Pattern {
  return PATTERNS.includes(value as Pattern);
}

function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

export function encodeStrip(strip: Strip): string {
  return strip.map((pattern) => PATTERN_CODE[pattern]).join("");
}

export function decodeStrip(encoded: string): Strip {
  const patterns = [...encoded].map((code) => CODE_PATTERN[code]);
  if (patterns.some((pattern) => pattern === undefined)) {
    throw new Error(`Invalid board encoding: ${encoded}`);
  }
  return patterns;
}

export function stripDistance(
  firstStrip: Strip,
  secondStrip: Strip,
): number {
  const sharedLength = Math.min(
    firstStrip.length,
    secondStrip.length,
  );
  let distance = Math.abs(firstStrip.length - secondStrip.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (firstStrip[index] !== secondStrip[index]) distance += 1;
  }
  return distance;
}

export function differingStripIndexes(
  firstStrip: Strip,
  secondStrip: Strip,
): readonly number[] {
  const indexes: number[] = [];
  const length = Math.max(firstStrip.length, secondStrip.length);
  for (let index = 0; index < length; index += 1) {
    if (firstStrip[index] !== secondStrip[index]) indexes.push(index);
  }
  return indexes;
}

export function describeRule(rule: TransitionRule): string {
  return `Change every ${rule.from} square to ${rule.to}.`;
}

/**
 * One card reads one immutable snapshot and changes every match together.
 */
export function applyRule(
  input: Strip,
  rule: TransitionRule,
): Strip {
  return input.map((pattern) =>
    pattern === rule.from ? rule.to : pattern,
  );
}

/**
 * Recipe cards execute in their visible array order, top-to-bottom.
 */
export function applyProgram(
  input: Strip,
  rules: readonly TransitionRule[],
): ProgramResult {
  let current = cloneStrip(input);
  const steps: TraceStep[] = [];

  rules.forEach((rule, executionIndex) => {
    const before = cloneStrip(current);
    const after = applyRule(before, rule);
    steps.push({
      executionIndex,
      ruleIndex: executionIndex,
      rule: cloneRule(rule),
      before,
      after: cloneStrip(after),
      changedIndexes: differingStripIndexes(before, after),
    });
    current = cloneStrip(after);
  });

  return {
    output: current,
    steps,
  };
}

function semanticProgramKey(
  rules: readonly TransitionRule[],
): string {
  return PATTERNS.map((pattern) => {
    const result = rules.reduce<Strip>(
      (current, rule) => applyRule(current, rule),
      [pattern],
    );
    return `${PATTERN_CODE[pattern]}>${PATTERN_CODE[result[0]]}`;
  }).join(",");
}

/**
 * Fingerprints board geometry, row-major input, and normalized replacement
 * semantics. Option placement and execution-equivalent recipe spellings do
 * not create false novelty.
 */
export function roundFingerprint(round: Pick<
  StripRound,
  "rows" | "columns" | "input" | "rules"
>): string {
  return `${round.rows}x${round.columns}|${encodeStrip(round.input)}|${semanticProgramKey(round.rules)}`;
}

type Candidate = Readonly<{
  strip: Strip;
  kind: MisconceptionKind;
}>;

function withChangedRule(
  rules: readonly TransitionRule[],
  index: number,
  replacement: TransitionRule,
): readonly TransitionRule[] {
  return rules.map((rule, ruleIndex) =>
    ruleIndex === index ? cloneRule(replacement) : cloneRule(rule),
  );
}

function applyWithPartialStep(
  input: Strip,
  rules: readonly TransitionRule[],
  partialIndex: number,
): Strip | null {
  let current = cloneStrip(input);
  let limited = false;

  rules.forEach((rule, ruleIndex) => {
    const full = applyRule(current, rule);
    const changes = differingStripIndexes(current, full);
    if (ruleIndex === partialIndex && changes.length > 1) {
      const next = cloneStrip(current);
      const appliedCount = changes.length - 1;
      changes.slice(0, appliedCount).forEach((index) => {
        next[index] = full[index];
      });
      current = next;
      limited = true;
    } else {
      current = cloneStrip(full);
    }
  });

  return limited ? current : null;
}

function misconceptionCandidates(
  input: Strip,
  rules: readonly TransitionRule[],
): readonly Candidate[] {
  const result = applyProgram(input, rules);
  const answerKey = encodeStrip(result.output);
  const byStrip = new Map<string, Candidate>();

  const add = (strip: Strip | null, kind: MisconceptionKind) => {
    if (!strip) return;
    const key = encodeStrip(strip);
    if (key === answerKey || byStrip.has(key)) return;
    byStrip.set(key, {
      strip: cloneStrip(strip),
      kind,
    });
  };

  if (rules.length > 1) {
    add(
      applyProgram(input, [...rules].reverse()).output,
      "wrong-order",
    );
  }

  result.steps.slice(0, -1).forEach((step) => {
    add(step.after, "stopped-early");
  });

  rules.forEach((rule) => {
    add(applyRule(input, rule), "one-step-only");
  });

  rules.forEach((_, skippedIndex) => {
    add(
      applyProgram(
        input,
        rules.filter((__, ruleIndex) => ruleIndex !== skippedIndex),
      ).output,
      "skipped-step",
    );
  });

  rules.forEach((rule, ruleIndex) => {
    add(
      applyProgram(
        input,
        withChangedRule(rules, ruleIndex, {
          kind: "replace",
          from: rule.to,
          to: rule.from,
        }),
      ).output,
      "reversed-arrow",
    );

    const alternate = PATTERNS.find(
      (pattern) => pattern !== rule.from && pattern !== rule.to,
    );
    if (alternate) {
      add(
        applyProgram(
          input,
          withChangedRule(rules, ruleIndex, {
            kind: "replace",
            from: rule.from,
            to: alternate,
          }),
        ).output,
        "wrong-target",
      );
      add(
        applyProgram(
          input,
          withChangedRule(rules, ruleIndex, {
            kind: "replace",
            from: alternate,
            to: rule.to,
          }),
        ).output,
        "wrong-source",
      );
    }

    add(
      applyWithPartialStep(input, rules, ruleIndex),
      "changed-some-matches",
    );
  });

  add(input, "missed-all");
  return [...byStrip.values()];
}

function selectDistractors(
  difficulty: Difficulty,
  answer: Strip,
  candidates: readonly Candidate[],
): readonly [Candidate, Candidate, Candidate] {
  const selected: Candidate[] = [];
  const ordered = [...candidates].sort(
    (firstCandidate, secondCandidate) => {
      const distanceDifference =
        stripDistance(firstCandidate.strip, answer) -
        stripDistance(secondCandidate.strip, answer);
      if (distanceDifference !== 0) return distanceDifference;
      return firstCandidate.kind.localeCompare(secondCandidate.kind);
    },
  );
  const isEarly = difficulty === "Starter" || difficulty === "Junior";

  if (!isEarly) {
    const closePartial = ordered.find(
      (candidate) =>
        candidate.kind === "changed-some-matches" &&
        stripDistance(candidate.strip, answer) === 1,
    );
    if (closePartial) selected.push(closePartial);
  }

  for (const candidate of ordered) {
    if (selected.some((other) => sameStrip(other.strip, candidate.strip))) {
      continue;
    }
    const minimumDistance = isEarly ? 2 : 1;
    if (stripDistance(candidate.strip, answer) < minimumDistance) continue;
    if (
      selected.some(
        (other) =>
          stripDistance(candidate.strip, other.strip) < minimumDistance,
      )
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length === 3) break;
  }

  if (selected.length !== 3) {
    throw new Error(
      "Could not construct three distinct named replacement mistakes.",
    );
  }
  return selected as [Candidate, Candidate, Candidate];
}

function placeOptions(
  answer: Strip,
  distractors: readonly [Candidate, Candidate, Candidate],
  correctIndex: 0 | 1 | 2 | 3,
): readonly [StripOption, StripOption, StripOption, StripOption] {
  const options: StripOption[] = [];
  let distractorIndex = 0;

  for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
    if (optionIndex === correctIndex) {
      options.push({
        strip: cloneStrip(answer),
        kind: "correct",
      });
    } else {
      const distractor = distractors[distractorIndex];
      options.push({
        strip: cloneStrip(distractor.strip),
        kind: distractor.kind,
      });
      distractorIndex += 1;
    }
  }

  return options as [
    StripOption,
    StripOption,
    StripOption,
    StripOption,
  ];
}

function makeRound(
  id: string,
  difficulty: Difficulty,
  rows: 1 | 2,
  columns: number,
  input: Strip,
  rules: readonly TransitionRule[],
  correctIndex: 0 | 1 | 2 | 3,
  isExample = false,
): StripRound {
  const answer = applyProgram(input, rules).output;
  const distractors = selectDistractors(
    difficulty,
    answer,
    misconceptionCandidates(input, rules),
  );

  return {
    id,
    difficulty,
    rows,
    columns,
    input: cloneStrip(input),
    rules: rules.map(cloneRule),
    options: placeOptions(answer, distractors, correctIndex),
    correctIndex,
    answer: cloneStrip(answer),
    ...(isExample ? { isExample: true as const } : {}),
  };
}

function recipeFor(
  patterns: readonly [Pattern, Pattern, Pattern],
  stepCount: number,
): readonly TransitionRule[] {
  const [first, second, third] = patterns;
  const completeRecipe = [
    { kind: "replace", from: first, to: second },
    { kind: "replace", from: third, to: first },
    { kind: "replace", from: second, to: third },
    { kind: "replace", from: first, to: second },
    { kind: "replace", from: third, to: first },
    { kind: "replace", from: second, to: third },
  ] as const satisfies readonly TransitionRule[];

  return completeRecipe.slice(0, stepCount).map(cloneRule);
}

function authoredStepCount(
  difficulty: Difficulty,
  authoredIndex: number,
): number {
  const curriculumIndex = authoredIndex % 12;
  if (difficulty === "Starter") return 2;
  if (difficulty === "Junior") return curriculumIndex < 4 ? 2 : 3;
  if (difficulty === "Expert") return curriculumIndex < 6 ? 3 : 4;
  if (curriculumIndex < 4) return 4;
  if (curriculumIndex < 8) return 5;
  return 6;
}

function factorial(value: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) {
    result *= factor;
  }
  return result;
}

function multisetPermutationCount(counts: readonly number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return (
    factorial(total) /
    counts.reduce(
      (denominator, count) => denominator * factorial(count),
      1,
    )
  );
}

function authoredBoardByRank(
  length: number,
  requestedRank: number,
): Strip {
  const baseCount = Math.floor(length / PATTERNS.length);
  const remainder = length % PATTERNS.length;
  const counts = PATTERNS.map(
    (_, index) => baseCount + (index < remainder ? 1 : 0),
  );
  let rank =
    requestedRank % multisetPermutationCount(counts);
  const board: Pattern[] = [];

  while (board.length < length) {
    for (let patternIndex = 0; patternIndex < PATTERNS.length; patternIndex += 1) {
      if (counts[patternIndex] === 0) continue;
      counts[patternIndex] -= 1;
      const branchSize = multisetPermutationCount(counts);
      if (rank < branchSize) {
        board.push(PATTERNS[patternIndex]);
        break;
      }
      rank -= branchSize;
      counts[patternIndex] += 1;
    }
  }

  return board;
}

function authoredSpec(
  difficulty: Difficulty,
  authoredIndex: number,
): Readonly<{
  rows: 1 | 2;
  columns: number;
  input: Strip;
  rules: readonly TransitionRule[];
}> {
  const difficultyRule = DIFFICULTY_RULES[difficulty];
  const difficultyIndex = DIFFICULTIES.indexOf(difficulty);
  const patterns =
    PATTERN_PERMUTATIONS[
      (authoredIndex + difficultyIndex * 2) %
        PATTERN_PERMUTATIONS.length
  ];
  const length = difficultyRule.rows * difficultyRule.columns;
  const boardRank =
    (difficulty === "Starter"
      ? 0
      : difficulty === "Junior"
        ? 12
        : difficulty === "Expert"
          ? 0
          : 24) + authoredIndex;

  return {
    rows: difficultyRule.rows,
    columns: difficultyRule.columns,
    input: authoredBoardByRank(length, boardRank),
    rules: recipeFor(
      patterns,
      authoredStepCount(difficulty, authoredIndex),
    ),
  };
}

export function buildAuthoredChangingStripsRounds(
  difficulty: Difficulty,
  specs: readonly AuthoredChangingStripsRoundSpec[],
  idPrefix: string,
): readonly StripRound[] {
  if (!isDifficulty(difficulty)) {
    throw new RangeError(`Unknown difficulty: ${String(difficulty)}`);
  }
  const normalizedPrefix = idPrefix.trim();
  if (!normalizedPrefix) {
    throw new Error("Changing Strips authored round IDs need a prefix.");
  }

  const fingerprints = new Set<string>();
  return specs.map((spec, index) => {
    if (
      !Number.isSafeInteger(spec.authoredIndex) ||
      spec.authoredIndex < 0
    ) {
      throw new Error(
        `Changing Strips authored index ${spec.authoredIndex} is invalid.`,
      );
    }
    if (
      !Number.isInteger(spec.correctIndex) ||
      spec.correctIndex < 0 ||
      spec.correctIndex > 3
    ) {
      throw new Error(
        `Changing Strips answer position ${spec.correctIndex} is invalid.`,
      );
    }

    const authored = authoredSpec(difficulty, spec.authoredIndex);
    const round = makeRound(
      `${normalizedPrefix}-${String(index + 1).padStart(2, "0")}`,
      difficulty,
      authored.rows,
      authored.columns,
      authored.input,
      authored.rules,
      spec.correctIndex,
    );
    const issues = validateRound(round);
    if (issues.length > 0) {
      throw new Error(`${round.id} is invalid: ${issues.join("; ")}`);
    }
    const fingerprint = roundFingerprint(round);
    if (fingerprints.has(fingerprint)) {
      throw new Error(
        `${normalizedPrefix} repeats an authored round fingerprint.`,
      );
    }
    fingerprints.add(fingerprint);
    return round;
  });
}

export function buildCampaignRounds(): Readonly<
  Record<Difficulty, readonly StripRound[]>
> {
  const byDifficulty: Record<Difficulty, readonly StripRound[]> = {
    Starter: [],
    Junior: [],
    Expert: [],
    Wizard: [],
  };

  DIFFICULTIES.forEach((difficulty) => {
    byDifficulty[difficulty] = buildAuthoredChangingStripsRounds(
      difficulty,
      CAMPAIGN_CORRECT_INDEXES[difficulty].map(
        (correctIndex, authoredIndex) => ({
          authoredIndex,
          correctIndex,
        }),
      ),
      `changing-strips-${difficulty.toLowerCase()}`,
    );
  });

  return byDifficulty;
}

export const CAMPAIGN_ROUNDS_BY_DIFFICULTY = buildCampaignRounds();
export const ROUNDS: readonly StripRound[] = DIFFICULTIES.flatMap(
  (difficulty) => CAMPAIGN_ROUNDS_BY_DIFFICULTY[difficulty],
);

const TUTORIAL_INPUT = [
  "solid",
  "hollow",
  "striped",
  "hollow",
  "striped",
  "solid",
] as const satisfies Strip;

const TUTORIAL_RULES = [
  { kind: "replace", from: "solid", to: "hollow" },
  { kind: "replace", from: "striped", to: "solid" },
] as const satisfies readonly TransitionRule[];

/** A gentle two-card example derived from the photographed exercise. */
export const TUTORIAL: StripRound = makeRound(
  "changing-strips-example",
  "Starter",
  1,
  6,
  TUTORIAL_INPUT,
  TUTORIAL_RULES,
  0,
  true,
);

function validateRule(
  rule: TransitionRule,
  index: number,
): readonly string[] {
  const issues: string[] = [];
  if (rule.kind !== "replace") {
    issues.push(`Rule ${index + 1} is outside the replacement grammar.`);
    return issues;
  }
  if (!isPattern(rule.from) || !isPattern(rule.to)) {
    issues.push(`Rule ${index + 1} uses an unknown pattern.`);
  }
  if (rule.from === rule.to) {
    issues.push(`Rule ${index + 1} is a no-op replacement.`);
  }
  return issues;
}

function isKnownMisconception(
  round: StripRound,
  option: StripOption,
): boolean {
  if (option.kind === "correct") return false;
  return misconceptionCandidates(round.input, round.rules).some(
    (candidate) =>
      candidate.kind === option.kind &&
      sameStrip(candidate.strip, option.strip),
  );
}

export function validateRound(round: StripRound): readonly string[] {
  const issues: string[] = [];
  if (!round.id) issues.push("Round ID is required.");
  if (!isDifficulty(round.difficulty)) issues.push("Unknown difficulty.");
  if (round.rows !== 1 && round.rows !== 2) {
    issues.push("Rows must be one or two.");
  }
  if (!Number.isInteger(round.columns) || round.columns < 2) {
    issues.push("Columns must be an integer of at least two.");
  }
  if (
    round.input.length !== round.rows * round.columns ||
    !round.input.every(isPattern)
  ) {
    issues.push(
      "Input must match the declared board dimensions and pattern grammar.",
    );
  }

  round.rules.forEach((rule, index) => {
    issues.push(...validateRule(rule, index));
  });

  if (!round.isExample && isDifficulty(round.difficulty)) {
    const expected = DIFFICULTY_RULES[round.difficulty];
    if (round.rows !== expected.rows || round.columns !== expected.columns) {
      issues.push(
        `${round.difficulty} must use a ${expected.rows}×${expected.columns} board.`,
      );
    }
    if (
      round.rules.length < expected.minSteps ||
      round.rules.length > expected.maxSteps
    ) {
      issues.push(
        `${round.difficulty} recipes must contain ${expected.minSteps}–${expected.maxSteps} steps.`,
      );
    }
  }

  let result: ProgramResult | null = null;
  try {
    result = applyProgram(round.input, round.rules);
  } catch {
    issues.push("Recipe could not be executed.");
  }

  if (result) {
    if (!sameStrip(result.output, round.answer)) {
      issues.push("Stored answer does not match the calculated output.");
    }
    result.steps.forEach((step) => {
      if (step.changedIndexes.length === 0) {
        issues.push(`Recipe step ${step.executionIndex + 1} is a no-op.`);
      }
    });
    if (stripDistance(round.input, result.output) < 2) {
      issues.push("The complete recipe must visibly change at least two cells.");
    }
    if (new Set(result.output).size < 2) {
      issues.push("The final answer must retain at least two patterns.");
    }
  }

  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex > 3
  ) {
    issues.push("Correct index must be 0–3.");
  }
  if (round.options.length !== 4) {
    issues.push("Round must have exactly four options.");
    return issues;
  }
  if (
    round.options.some(
      (option) =>
        option.strip.length !== round.input.length ||
        !option.strip.every(isPattern),
    )
  ) {
    issues.push(
      "Every option must match the board dimensions and pattern grammar.",
    );
  }

  const optionKeys = round.options.map((option) =>
    encodeStrip(option.strip),
  );
  if (new Set(optionKeys).size !== 4) {
    issues.push("Options must be mutually distinct.");
  }
  const matchingIndexes = round.options.flatMap((option, index) =>
    sameStrip(option.strip, round.answer) ? [index] : [],
  );
  if (
    matchingIndexes.length !== 1 ||
    matchingIndexes[0] !== round.correctIndex
  ) {
    issues.push("Exactly the indexed option must equal the calculated answer.");
  }

  round.options.forEach((option, index) => {
    if (index === round.correctIndex) {
      if (option.kind !== "correct") {
        issues.push("The answer option must be marked correct.");
      }
    } else if (
      option.kind === "correct" ||
      !isKnownMisconception(round, option)
    ) {
      issues.push(`Option ${index + 1} is not a named recipe mistake.`);
    }
  });

  if (
    (round.difficulty === "Expert" ||
      round.difficulty === "Wizard") &&
    !round.options.some(
      (option, index) =>
        index !== round.correctIndex &&
        option.kind === "changed-some-matches" &&
        stripDistance(option.strip, round.answer) === 1,
    )
  ) {
    issues.push(
      "Expert and Wizard require a named one-cell partial-change trap.",
    );
  }

  if (
    round.difficulty === "Starter" ||
    round.difficulty === "Junior"
  ) {
    for (let first = 0; first < round.options.length; first += 1) {
      for (
        let second = first + 1;
        second < round.options.length;
        second += 1
      ) {
        if (
          stripDistance(
            round.options[first].strip,
            round.options[second].strip,
          ) < 2
        ) {
          issues.push(
            `Options ${first + 1} and ${second + 1} must differ in at least two cells.`,
          );
        }
      }
    }
  }

  return issues;
}

const MISCONCEPTION_MESSAGES: Readonly<
  Record<MisconceptionKind, string>
> = {
  "wrong-order":
    "That board runs the recipe from the bottom card upward.",
  "stopped-early":
    "That board stops before every recipe card has had its turn.",
  "one-step-only":
    "That board uses just one of the shown recipe cards.",
  "skipped-step":
    "That board skips one card in the top-to-bottom recipe.",
  "missed-all":
    "That is the starting board before the recipe changes it.",
  "reversed-arrow":
    "That board turns one replacement arrow around.",
  "wrong-source":
    "That board starts one card from the wrong pattern.",
  "wrong-target":
    "That board changes matches into the other pattern.",
  "changed-some-matches":
    "That board changes only some matches; a card changes every match together.",
};

export function optionFeedback(
  round: StripRound,
  optionIndex: number,
): OptionFeedback {
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= round.options.length
  ) {
    throw new RangeError(`Option index ${optionIndex} is outside 0–3.`);
  }

  const option = round.options[optionIndex];
  const differingIndexes = differingStripIndexes(
    option.strip,
    round.answer,
  );
  const correct = optionIndex === round.correctIndex;

  return {
    correct,
    kind: option.kind,
    mismatchCount: differingIndexes.length,
    differingIndexes,
    attempted: cloneStrip(option.strip),
    expected: cloneStrip(round.answer),
    message: correct
      ? "Correct. Every card ran once, from top to bottom."
      : `${MISCONCEPTION_MESSAGES[option.kind as MisconceptionKind]} ${differingIndexes.length} ${differingIndexes.length === 1 ? "cell is" : "cells are"} different.`,
    trace: applyProgram(round.input, round.rules).steps,
  };
}

function sampleUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(
      "Random source must return a finite value in [0, 1).",
    );
  }
  return value;
}

function randomIndex(random: RandomSource, length: number): number {
  return Math.floor(sampleUnit(random) * length);
}

function shuffled<T>(
  items: readonly T[],
  random: RandomSource,
): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(random, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function randomPatternBoard(
  length: number,
  patterns: readonly [Pattern, Pattern, Pattern],
  random: RandomSource,
): Strip {
  const base: Pattern[] = [
    patterns[0],
    patterns[0],
    patterns[1],
    patterns[1],
    patterns[2],
    patterns[2],
  ];
  while (base.length < length) {
    base.push(patterns[randomIndex(random, patterns.length)]);
  }
  return shuffled(base, random);
}

function generatedSpec(
  difficulty: Difficulty,
  random: RandomSource,
): Readonly<{
  rows: 1 | 2;
  columns: number;
  input: Strip;
  rules: readonly TransitionRule[];
  correctIndex: 0 | 1 | 2 | 3;
}> {
  const expected = DIFFICULTY_RULES[difficulty];
  const patterns = PATTERN_PERMUTATIONS[
    randomIndex(random, PATTERN_PERMUTATIONS.length)
  ] as readonly [Pattern, Pattern, Pattern];
  const stepCount =
    expected.minSteps +
    randomIndex(random, expected.maxSteps - expected.minSteps + 1);
  const correctIndex = randomIndex(random, 4) as 0 | 1 | 2 | 3;
  const length = expected.rows * expected.columns;

  return {
    rows: expected.rows,
    columns: expected.columns,
    input: randomPatternBoard(length, patterns, random),
    rules: recipeFor(patterns, stepCount),
    correctIndex,
  };
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function generateInfiniteRound(
  difficulty: Difficulty,
  random: RandomSource = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): StripRound {
  if (!isDifficulty(difficulty)) {
    throw new RangeError(`Unknown difficulty: ${String(difficulty)}`);
  }

  for (
    let attempt = 0;
    attempt < GENERATOR_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const spec = generatedSpec(difficulty, random);
      const provisional = makeRound(
        "generated",
        difficulty,
        spec.rows,
        spec.columns,
        spec.input,
        spec.rules,
        spec.correctIndex,
      );
      const fingerprint = roundFingerprint(provisional);
      if (excludedFingerprints.has(fingerprint)) continue;
      if (validateRound(provisional).length > 0) continue;
      return {
        ...provisional,
        id: `changing-strips-${difficulty.toLowerCase()}-${hashString(fingerprint)}`,
      };
    } catch {
      // Candidate rejection is expected. Only the fixed public boundary fails.
    }
  }

  throw new Error(
    `Unable to generate a valid ${difficulty} Changing Strips round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

/** Mulberry32: compact deterministic randomness for reproducible puzzles. */
export function makeSeededRandom(seed: number | string): RandomSource {
  let state =
    typeof seed === "number"
      ? seed >>> 0
      : [...seed].reduce(
          (hash, character) =>
            Math.imul(
              hash ^ character.charCodeAt(0),
              0x45d9f3b,
            ) >>> 0,
          0x9e3779b9,
        );

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
