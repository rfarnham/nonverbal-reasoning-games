export const DIFFICULTIES = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * The names describe the redundant visual encodings used by the renderer:
 * a filled cell with a dot, an outlined cell with a ring, and a striped cell.
 * A player never has to distinguish the states by color alone.
 */
export type CellState = "solid" | "open" | "striped";
export type Strip = readonly CellState[];
export type ProcessingDirection = "ltr" | "rtl";
export type NeighborDirection = "left" | "right";

export type ReplaceRule = Readonly<{
  kind: "replace";
  from: CellState;
  to: CellState;
}>;

export type SwapRule = Readonly<{
  kind: "swap";
  first: CellState;
  second: CellState;
}>;

export type NeighborRule = Readonly<{
  kind: "neighbor";
  neighborDirection: NeighborDirection;
  neighbor: CellState;
  from: CellState;
  to: CellState;
}>;

export type ShiftRule = Readonly<{
  kind: "shift";
  direction: "left" | "right";
}>;

/** The complete, finite player-visible rule grammar. */
export type TransitionRule =
  | ReplaceRule
  | SwapRule
  | NeighborRule
  | ShiftRule;

export type TraceMovement = Readonly<{
  fromIndex: number;
  toIndex: number;
  state: CellState;
}>;

export type ConditionWitness = Readonly<{
  cellIndex: number;
  neighborIndex: number;
}>;

export type TraceStep = Readonly<{
  /** Position in the actual execution sequence, starting at zero. */
  executionIndex: number;
  /** Position of the physical card in the displayed row. */
  ruleIndex: number;
  rule: TransitionRule;
  before: Strip;
  after: Strip;
  /** Target positions whose visible state changed. */
  changedIndexes: readonly number[];
  /** Whole-strip shifts expose the exact source-to-target travel. */
  movements: readonly TraceMovement[];
  /** Exact adjacent pairs that made a neighbor condition true. */
  conditionWitnesses: readonly ConditionWitness[];
}>;

export type ProgramResult = Readonly<{
  output: Strip;
  steps: readonly TraceStep[];
}>;

export type MisconceptionKind =
  | "reverse-order"
  | "stopped-early"
  | "one-card-only"
  | "skipped-card"
  | "missed-all"
  | "reversed-arrow"
  | "wrong-target"
  | "opposite-neighbor"
  | "opposite-shift"
  | "wrong-swap-pair"
  | "changed-one-match"
  | "local-near-miss";

export type OptionKind = "correct" | MisconceptionKind;

export type StripOption = Readonly<{
  strip: Strip;
  kind: OptionKind;
}>;

export type StripRound = Readonly<{
  id: string;
  difficulty: Difficulty;
  input: Strip;
  rules: readonly TransitionRule[];
  processingDirection: ProcessingDirection;
  options: readonly [
    StripOption,
    StripOption,
    StripOption,
    StripOption,
  ];
  correctIndex: 0 | 1 | 2 | 3;
  answer: Strip;
  /** The solved opening example may use more cards than a Starter round. */
  isExample?: true;
}>;

export type AuthoredChangingStripsRoundSpec = Readonly<{
  /**
   * Selects a deterministic curriculum variant from the canonical authored
   * sequence. Standalone Campaign owns variants 0–11; Journey-only banks use
   * later variants without copying rule or distractor construction.
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

export const CELL_STATES = [
  "solid",
  "open",
  "striped",
] as const satisfies readonly CellState[];

export const CELL_STATE_META: Readonly<
  Record<
    CellState,
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
    color: "#f06f5f",
    accessibleDescription: "solid coral cell with a center dot",
  },
  open: {
    label: "Open",
    symbol: "○",
    color: "#fffdf8",
    accessibleDescription: "open paper cell with a dark ring",
  },
  striped: {
    label: "Striped",
    symbol: "◍",
    color: "#35a999",
    accessibleDescription: "teal cell with diagonal stripes",
  },
};

export const DIFFICULTY_RULES: Readonly<
  Record<
    Difficulty,
    Readonly<{
      programLength: 1 | 3;
      executionKindSequences: readonly (
        readonly TransitionRule["kind"][]
      )[];
    }>
  >
> = {
  Starter: {
    programLength: 1,
    executionKindSequences: [["replace"]],
  },
  Junior: {
    programLength: 1,
    executionKindSequences: [["swap"], ["shift"], ["neighbor"]],
  },
  Expert: {
    programLength: 3,
    executionKindSequences: [["replace", "shift", "swap"]],
  },
  Wizard: {
    programLength: 3,
    executionKindSequences: [["shift", "neighbor", "swap"]],
  },
};

export const GENERATOR_MAX_ATTEMPTS = 256;

const GENERATED_STRIP_LENGTH = 7;

const STATE_CODE: Readonly<Record<CellState, string>> = {
  solid: "S",
  open: "O",
  striped: "T",
};

const CODE_STATE: Readonly<Record<string, CellState>> = {
  S: "solid",
  O: "open",
  T: "striped",
};

const OPPOSITE_PROCESSING_DIRECTION: Readonly<
  Record<ProcessingDirection, ProcessingDirection>
> = {
  ltr: "rtl",
  rtl: "ltr",
};

const OPPOSITE_NEIGHBOR_DIRECTION: Readonly<
  Record<NeighborDirection, NeighborDirection>
> = {
  left: "right",
  right: "left",
};

const CAMPAIGN_CORRECT_INDEXES = {
  Starter: [0, 2, 0, 3, 1, 0, 1, 3, 2, 1, 2, 3],
  Junior: [1, 0, 1, 2, 3, 1, 3, 2, 0, 2, 0, 3],
  Expert: [2, 1, 2, 3, 0, 1, 0, 2, 3, 0, 3, 1],
  Wizard: [3, 0, 3, 2, 1, 3, 1, 2, 0, 1, 0, 2],
} as const satisfies Readonly<Record<Difficulty, readonly number[]>>;

const STATE_PERMUTATIONS = [
  ["solid", "open", "striped"],
  ["solid", "striped", "open"],
  ["open", "solid", "striped"],
  ["open", "striped", "solid"],
  ["striped", "solid", "open"],
  ["striped", "open", "solid"],
] as const satisfies readonly (readonly [
  CellState,
  CellState,
  CellState,
])[];

function cloneStrip(strip: Strip): CellState[] {
  return [...strip];
}

function sameStrip(left: Strip, right: Strip): boolean {
  return (
    left.length === right.length &&
    left.every((state, index) => state === right[index])
  );
}

function isCellState(value: unknown): value is CellState {
  return CELL_STATES.includes(value as CellState);
}

function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

export function encodeStrip(strip: Strip): string {
  return strip.map((state) => STATE_CODE[state]).join("");
}

export function decodeStrip(encoded: string): Strip {
  const states = [...encoded].map((code) => CODE_STATE[code]);
  if (states.some((state) => state === undefined)) {
    throw new Error(`Invalid strip encoding: ${encoded}`);
  }
  return states;
}

export function stripDistance(left: Strip, right: Strip): number {
  const sharedLength = Math.min(left.length, right.length);
  let distance = Math.abs(left.length - right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

export function differingStripIndexes(
  left: Strip,
  right: Strip,
): readonly number[] {
  const indexes: number[] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) indexes.push(index);
  }
  return indexes;
}

export function orderedRuleIndexes(
  ruleCount: number,
  processingDirection: ProcessingDirection,
): readonly number[] {
  const indexes = Array.from({ length: ruleCount }, (_, index) => index);
  return processingDirection === "ltr" ? indexes : indexes.reverse();
}

export function processingDirectionLabel(
  processingDirection: ProcessingDirection,
): string {
  return processingDirection === "ltr" ? "left to right" : "right to left";
}

export function processingDirectionSymbol(
  processingDirection: ProcessingDirection,
): "→" | "←" {
  return processingDirection === "ltr" ? "→" : "←";
}

export function describeRule(rule: TransitionRule): string {
  if (rule.kind === "replace") {
    return `Change every ${rule.from} cell to ${rule.to}.`;
  }
  if (rule.kind === "swap") {
    return `Swap every ${rule.first} cell with every ${rule.second} cell at the same time.`;
  }
  if (rule.kind === "neighbor") {
    return `Change each ${rule.from} cell to ${rule.to} when the cell on its ${rule.neighborDirection} is ${rule.neighbor}.`;
  }
  return `Shift the whole strip one place ${rule.direction}, wrapping the end cell around.`;
}

function applyRuleWithEvidence(
  input: Strip,
  rule: TransitionRule,
  ruleIndex: number,
  executionIndex: number,
): Readonly<{ output: Strip; step: TraceStep }> {
  const before = cloneStrip(input);
  let after = cloneStrip(input);
  const movements: TraceMovement[] = [];
  const conditionWitnesses: ConditionWitness[] = [];

  if (rule.kind === "replace") {
    after = before.map((state) => (state === rule.from ? rule.to : state));
  } else if (rule.kind === "swap") {
    after = before.map((state) => {
      if (state === rule.first) return rule.second;
      if (state === rule.second) return rule.first;
      return state;
    });
  } else if (rule.kind === "neighbor") {
    const offset = rule.neighborDirection === "left" ? -1 : 1;
    after = before.map((state, cellIndex) => {
      const neighborIndex = cellIndex + offset;
      if (
        state === rule.from &&
        neighborIndex >= 0 &&
        neighborIndex < before.length &&
        before[neighborIndex] === rule.neighbor
      ) {
        conditionWitnesses.push({ cellIndex, neighborIndex });
        return rule.to;
      }
      return state;
    });
  } else if (before.length > 0) {
    const offset = rule.direction === "left" ? -1 : 1;
    after = Array<CellState>(before.length);
    for (let fromIndex = 0; fromIndex < before.length; fromIndex += 1) {
      const toIndex =
        (fromIndex + offset + before.length * 2) % before.length;
      after[toIndex] = before[fromIndex];
      movements.push({
        fromIndex,
        toIndex,
        state: before[fromIndex],
      });
    }
  }

  const changedIndexes = differingStripIndexes(before, after);
  return {
    output: after,
    step: {
      executionIndex,
      ruleIndex,
      rule: cloneRule(rule),
      before,
      after: cloneStrip(after),
      changedIndexes,
      movements,
      conditionWitnesses,
    },
  };
}

/**
 * Applies one card. All matches read from one immutable snapshot, so a swap or
 * replacement cannot cascade through the strip during a single card.
 */
export function applyRule(
  input: Strip,
  rule: TransitionRule,
): Strip {
  return applyRuleWithEvidence(input, rule, 0, 0).output;
}

/**
 * Applies physically ordered cards in the direction of the large arrow.
 * Trace steps retain both the physical card index and execution index.
 */
export function applyProgram(
  input: Strip,
  rules: readonly TransitionRule[],
  processingDirection: ProcessingDirection,
): ProgramResult {
  let current = cloneStrip(input);
  const steps: TraceStep[] = [];
  for (const [executionIndex, ruleIndex] of orderedRuleIndexes(
    rules.length,
    processingDirection,
  ).entries()) {
    const result = applyRuleWithEvidence(
      current,
      rules[ruleIndex],
      ruleIndex,
      executionIndex,
    );
    current = cloneStrip(result.output);
    steps.push(result.step);
  }
  return { output: current, steps };
}

function cloneRule(rule: TransitionRule): TransitionRule {
  return { ...rule };
}

function ruleKey(rule: TransitionRule): string {
  if (rule.kind === "replace") {
    return `R:${STATE_CODE[rule.from]}>${STATE_CODE[rule.to]}`;
  }
  if (rule.kind === "swap") {
    const pair = [STATE_CODE[rule.first], STATE_CODE[rule.second]].sort();
    return `W:${pair.join("<>")}`;
  }
  if (rule.kind === "neighbor") {
    return `N:${rule.neighborDirection[0]}:${STATE_CODE[rule.neighbor]}:${STATE_CODE[rule.from]}>${STATE_CODE[rule.to]}`;
  }
  return `H:${rule.direction[0]}`;
}

/**
 * Fingerprints execution semantics rather than option placement. Reversing
 * both the physical card order and the processing arrow yields the same key.
 */
export function roundFingerprint(round: Pick<
  StripRound,
  "input" | "rules" | "processingDirection"
>): string {
  const executionRules = orderedRuleIndexes(
    round.rules.length,
    round.processingDirection,
  ).map((index) => round.rules[index]);
  const executionKey = executionRules.every(
    (rule) => rule.kind === "replace",
  )
    ? `M:${CELL_STATES.map((state) => {
        const output = executionRules.reduce<Strip>(
          (current, rule) => applyRule(current, rule),
          [state],
        );
        return `${STATE_CODE[state]}>${STATE_CODE[output[0]]}`;
      }).join(",")}`
    : executionRules.map(ruleKey).join(",");
  return `${encodeStrip(round.input)}|${executionKey}`;
}

type Candidate = Readonly<{
  strip: Strip;
  kind: MisconceptionKind;
}>;

function oppositeNeighborRules(
  rules: readonly TransitionRule[],
): readonly TransitionRule[] {
  return rules.map((rule) =>
    rule.kind === "neighbor"
      ? {
          ...rule,
          neighborDirection:
            OPPOSITE_NEIGHBOR_DIRECTION[rule.neighborDirection],
        }
      : cloneRule(rule),
  );
}

function oppositeShiftRules(
  rules: readonly TransitionRule[],
): readonly TransitionRule[] {
  return rules.map((rule) =>
    rule.kind === "shift"
      ? {
          ...rule,
          direction: rule.direction === "left" ? "right" : "left",
        }
      : cloneRule(rule),
  );
}

function reverseFirstArrow(
  rules: readonly TransitionRule[],
): readonly TransitionRule[] | null {
  const index = rules.findIndex(
    (rule) => rule.kind === "replace" || rule.kind === "neighbor",
  );
  if (index < 0) return null;
  const changed = rules.map(cloneRule);
  const rule = changed[index];
  changed[index] =
    rule.kind === "replace"
      ? { ...rule, from: rule.to, to: rule.from }
      : rule.kind === "neighbor"
        ? { ...rule, from: rule.to, to: rule.from }
        : rule;
  return changed;
}

function buildWrongTargetRules(
  rules: readonly TransitionRule[],
): readonly TransitionRule[] | null {
  const index = rules.findIndex(
    (rule) => rule.kind === "replace" || rule.kind === "neighbor",
  );
  if (index < 0) return null;
  const changed = rules.map(cloneRule);
  const rule = changed[index];
  if (rule.kind !== "replace" && rule.kind !== "neighbor") return null;
  const alternate = CELL_STATES.find(
    (state) => state !== rule.from && state !== rule.to,
  );
  if (!alternate) return null;
  changed[index] = { ...rule, to: alternate };
  return changed;
}

function buildWrongSwapPairRules(
  rules: readonly TransitionRule[],
): readonly TransitionRule[] | null {
  const index = rules.findIndex((rule) => rule.kind === "swap");
  if (index < 0) return null;
  const changed = rules.map(cloneRule);
  const rule = changed[index];
  if (rule.kind !== "swap") return null;
  const alternate = CELL_STATES.find(
    (state) => state !== rule.first && state !== rule.second,
  );
  if (!alternate) return null;
  changed[index] = {
    kind: "swap",
    first: rule.first,
    second: alternate,
  };
  return changed;
}

function applyProgramWithOneMatch(
  input: Strip,
  rules: readonly TransitionRule[],
  processingDirection: ProcessingDirection,
): Strip | null {
  let current = cloneStrip(input);
  let limited = false;
  for (const ruleIndex of orderedRuleIndexes(
    rules.length,
    processingDirection,
  )) {
    const full = applyRule(current, rules[ruleIndex]);
    const changedIndexes = differingStripIndexes(current, full);
    if (!limited && rules[ruleIndex].kind !== "shift" && changedIndexes.length > 1) {
      const next = cloneStrip(current);
      const changedIndex = changedIndexes[0];
      next[changedIndex] = full[changedIndex];
      current = next;
      limited = true;
    } else {
      current = cloneStrip(full);
    }
  }
  return limited ? current : null;
}

function enumerateLocalNearMisses(answer: Strip): readonly Candidate[] {
  const candidates: Candidate[] = [];
  for (let firstIndex = 0; firstIndex < answer.length; firstIndex += 1) {
    for (const firstState of CELL_STATES) {
      if (firstState === answer[firstIndex]) continue;
      const oneAway = cloneStrip(answer);
      oneAway[firstIndex] = firstState;
      candidates.push({ strip: oneAway, kind: "local-near-miss" });
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < answer.length;
        secondIndex += 1
      ) {
        for (const secondState of CELL_STATES) {
          if (secondState === answer[secondIndex]) continue;
          const twoAway = cloneStrip(oneAway);
          twoAway[secondIndex] = secondState;
          candidates.push({ strip: twoAway, kind: "local-near-miss" });
        }
      }
    }
  }
  return candidates;
}

function misconceptionCandidates(
  input: Strip,
  rules: readonly TransitionRule[],
  processingDirection: ProcessingDirection,
): readonly Candidate[] {
  const result = applyProgram(input, rules, processingDirection);
  const answerKey = encodeStrip(result.output);
  const byStrip = new Map<string, Candidate>();

  const add = (strip: Strip | null, kind: MisconceptionKind) => {
    if (!strip) return;
    const key = encodeStrip(strip);
    if (key === answerKey || byStrip.has(key)) return;
    byStrip.set(key, { strip: cloneStrip(strip), kind });
  };

  if (rules.length > 1) {
    add(
      applyProgram(
        input,
        rules,
        OPPOSITE_PROCESSING_DIRECTION[processingDirection],
      ).output,
      "reverse-order",
    );
  }

  for (const step of result.steps.slice(0, -1)) {
    add(step.after, "stopped-early");
  }

  for (const ruleIndex of orderedRuleIndexes(
    rules.length,
    processingDirection,
  )) {
    add(applyRule(input, rules[ruleIndex]), "one-card-only");
  }

  for (let skippedIndex = 0; skippedIndex < rules.length; skippedIndex += 1) {
    const shortened = rules.filter((_, index) => index !== skippedIndex);
    add(
      applyProgram(input, shortened, processingDirection).output,
      "skipped-card",
    );
  }

  add(
    applyProgramWithOneMatch(input, rules, processingDirection),
    "changed-one-match",
  );
  add(
    applyProgram(
      input,
      oppositeNeighborRules(rules),
      processingDirection,
    ).output,
    "opposite-neighbor",
  );
  add(
    applyProgram(input, oppositeShiftRules(rules), processingDirection).output,
    "opposite-shift",
  );

  const reversedArrow = reverseFirstArrow(rules);
  if (reversedArrow) {
    add(
      applyProgram(input, reversedArrow, processingDirection).output,
      "reversed-arrow",
    );
  }

  const wrongTarget = buildWrongTargetRules(rules);
  if (wrongTarget) {
    add(
      applyProgram(input, wrongTarget, processingDirection).output,
      "wrong-target",
    );
  }

  const wrongSwapPair = buildWrongSwapPairRules(rules);
  if (wrongSwapPair) {
    add(
      applyProgram(input, wrongSwapPair, processingDirection).output,
      "wrong-swap-pair",
    );
  }

  add(input, "missed-all");
  for (const candidate of enumerateLocalNearMisses(result.output)) {
    add(candidate.strip, candidate.kind);
  }
  return [...byStrip.values()];
}

function selectDistractors(
  difficulty: Difficulty,
  answer: Strip,
  candidates: readonly Candidate[],
): readonly [Candidate, Candidate, Candidate] {
  const selected: Candidate[] = [];
  const isEarly = difficulty === "Starter" || difficulty === "Junior";
  const eligible = isEarly
    ? candidates
    : candidates.filter(({ kind }) => kind !== "local-near-miss");
  const ordered =
    isEarly
      ? eligible
      : [...eligible].sort((left, right) => {
          const distanceDifference =
            stripDistance(left.strip, answer) -
            stripDistance(right.strip, answer);
          if (distanceDifference !== 0) return distanceDifference;
          return left.kind.localeCompare(right.kind);
        });

  for (const candidate of ordered) {
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
      `Could not construct three distinct ${difficulty} distractors.`,
    );
  }
  if (
    !isEarly &&
    !selected.some(({ strip }) => stripDistance(strip, answer) <= 2)
  ) {
    throw new Error(
      `Could not construct a close named ${difficulty} misconception.`,
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
      options.push({ strip: cloneStrip(answer), kind: "correct" });
    } else {
      const distractor = distractors[distractorIndex];
      options.push({
        strip: cloneStrip(distractor.strip),
        kind: distractor.kind,
      });
      distractorIndex += 1;
    }
  }
  return options as [StripOption, StripOption, StripOption, StripOption];
}

function makeRound(
  id: string,
  difficulty: Difficulty,
  input: Strip,
  rules: readonly TransitionRule[],
  processingDirection: ProcessingDirection,
  correctIndex: 0 | 1 | 2 | 3,
  isExample = false,
): StripRound {
  const answer = applyProgram(input, rules, processingDirection).output;
  const distractors = selectDistractors(
    difficulty,
    answer,
    misconceptionCandidates(input, rules, processingDirection),
  );
  return {
    id,
    difficulty,
    input: cloneStrip(input),
    rules: rules.map(cloneRule),
    processingDirection,
    options: placeOptions(answer, distractors, correctIndex),
    correctIndex,
    answer: cloneStrip(answer),
    ...(isExample ? { isExample: true as const } : {}),
  };
}

function rotateStrip(strip: Strip, amount: number): Strip {
  if (strip.length === 0) return [];
  const normalized = ((amount % strip.length) + strip.length) % strip.length;
  return [...strip.slice(normalized), ...strip.slice(0, normalized)];
}

function inverseShift(strip: Strip, direction: "left" | "right"): Strip {
  return applyRule(strip, {
    kind: "shift",
    direction: direction === "left" ? "right" : "left",
  });
}

function physicalRulesForDirection(
  executionRules: readonly TransitionRule[],
  processingDirection: ProcessingDirection,
): readonly TransitionRule[] {
  return processingDirection === "ltr"
    ? executionRules.map(cloneRule)
    : [...executionRules].reverse().map(cloneRule);
}

function authoredSpec(
  difficulty: Difficulty,
  index: number,
): Readonly<{
  input: Strip;
  rules: readonly TransitionRule[];
  processingDirection: ProcessingDirection;
}> {
  const [first, second, third] =
    STATE_PERMUTATIONS[index % STATE_PERMUTATIONS.length];
  const processingDirection: ProcessingDirection =
    index % 2 === 0 ? "ltr" : "rtl";
  const rotation = (index * 2 + Math.floor(index / 6)) % GENERATED_STRIP_LENGTH;
  const baseInput = rotateStrip(
    [first, second, third, first, second, third, CELL_STATES[index % 3]],
    rotation,
  );

  if (difficulty === "Starter") {
    return {
      input: baseInput,
      rules: [{ kind: "replace", from: first, to: second }],
      processingDirection,
    };
  }

  if (difficulty === "Junior") {
    const curriculumBlock = Math.floor(index / 4) % 3;
    if (curriculumBlock === 0) {
      return {
        input: baseInput,
        rules: [{ kind: "swap", first, second }],
        processingDirection,
      };
    }
    if (curriculumBlock === 1) {
      const direction: "left" | "right" =
        index % 2 === 0 ? "left" : "right";
      return {
        input: baseInput,
        rules: [{ kind: "shift", direction }],
        processingDirection,
      };
    }
    const neighborDirection: NeighborDirection =
      index % 2 === 0 ? "right" : "left";
    const input = rotateStrip(
      neighborDirection === "right"
        ? [first, second, third, first, second, third, first]
        : [second, first, third, second, first, third, first],
      rotation,
    );
    return {
      input,
      rules: [
        {
          kind: "neighbor",
          neighborDirection,
          neighbor: second,
          from: first,
          to: third,
        },
      ],
      processingDirection,
    };
  }

  const shiftDirection: "left" | "right" =
    Math.floor(index / 2) % 2 === 0 ? "right" : "left";
  const shiftRule: ShiftRule = {
    kind: "shift",
    direction: shiftDirection,
  };
  const swapRule: SwapRule = {
    kind: "swap",
    first: second,
    second: third,
  };

  if (difficulty === "Expert") {
    const executionRules: readonly TransitionRule[] = [
      { kind: "replace", from: first, to: second },
      shiftRule,
      swapRule,
    ];
    return {
      input: baseInput,
      rules: physicalRulesForDirection(executionRules, processingDirection),
      processingDirection,
    };
  }

  const neighborDirection: NeighborDirection =
    Math.floor(index / 2) % 2 === 0 ? "right" : "left";
  const neighborPattern =
    neighborDirection === "right"
      ? [first, second, third, first, second, third, first]
      : [second, first, third, second, first, third, first];
  const afterOptionalShift = rotateStrip(neighborPattern, rotation);
  const neighborRule: NeighborRule = {
    kind: "neighbor",
    neighborDirection,
    neighbor: second,
    from: first,
    to: third,
  };
  const executionRules: readonly TransitionRule[] = [
    shiftRule,
    neighborRule,
    swapRule,
  ];
  return {
    input: inverseShift(afterOptionalShift, shiftDirection),
    rules: physicalRulesForDirection(executionRules, processingDirection),
    processingDirection,
  };
}

export function buildAuthoredChangingStripsRounds(
  difficulty: Difficulty,
  specs: readonly AuthoredChangingStripsRoundSpec[],
  idPrefix: string,
): readonly StripRound[] {
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
      authored.input,
      authored.rules,
      authored.processingDirection,
      spec.correctIndex,
    );
    const issues = validateRound(round);
    if (issues.length > 0) {
      throw new Error(
        `${round.id} is invalid: ${issues.join("; ")}`,
      );
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
  for (const difficulty of DIFFICULTIES) {
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
  }
  return byDifficulty;
}

export const CAMPAIGN_ROUNDS_BY_DIFFICULTY = buildCampaignRounds();
export const ROUNDS: readonly StripRound[] = DIFFICULTIES.flatMap(
  (difficulty) => CAMPAIGN_ROUNDS_BY_DIFFICULTY[difficulty],
);

const TUTORIAL_INPUT = [
  "solid",
  "open",
  "striped",
  "open",
  "striped",
  "solid",
  "open",
  "solid",
  "striped",
] as const satisfies Strip;

const TUTORIAL_RULES = [
  { kind: "replace", from: "solid", to: "open" },
  { kind: "replace", from: "striped", to: "solid" },
  { kind: "replace", from: "open", to: "striped" },
] as const satisfies readonly TransitionRule[];

/**
 * The photographed nine-cell problem, solved by the same engine as live play.
 * The answer is intentionally calculated rather than maintained as a literal.
 */
export const TUTORIAL: StripRound = makeRound(
  "changing-strips-example",
  "Starter",
  TUTORIAL_INPUT,
  TUTORIAL_RULES,
  "ltr",
  0,
  true,
);

function validateRule(rule: TransitionRule, index: number): readonly string[] {
  const issues: string[] = [];
  if (rule.kind === "replace") {
    if (!isCellState(rule.from) || !isCellState(rule.to)) {
      issues.push(`Rule ${index + 1} uses an unknown cell state.`);
    }
    if (rule.from === rule.to) {
      issues.push(`Rule ${index + 1} is a no-op replacement.`);
    }
  } else if (rule.kind === "swap") {
    if (!isCellState(rule.first) || !isCellState(rule.second)) {
      issues.push(`Rule ${index + 1} uses an unknown cell state.`);
    }
    if (rule.first === rule.second) {
      issues.push(`Rule ${index + 1} swaps a state with itself.`);
    }
  } else if (rule.kind === "neighbor") {
    if (
      !isCellState(rule.neighbor) ||
      !isCellState(rule.from) ||
      !isCellState(rule.to)
    ) {
      issues.push(`Rule ${index + 1} uses an unknown cell state.`);
    }
    if (
      rule.neighborDirection !== "left" &&
      rule.neighborDirection !== "right"
    ) {
      issues.push(`Rule ${index + 1} has an unknown neighbor direction.`);
    }
    if (rule.from === rule.to) {
      issues.push(`Rule ${index + 1} has a no-op conditional change.`);
    }
  } else if (
    rule.kind !== "shift" ||
    (rule.direction !== "left" && rule.direction !== "right")
  ) {
    issues.push(`Rule ${index + 1} is outside the finite rule grammar.`);
  }
  return issues;
}

function difficultyFamilyIssues(round: StripRound): readonly string[] {
  if (round.isExample) return [];
  const expected = DIFFICULTY_RULES[round.difficulty];
  const executionRules = orderedRuleIndexes(
    round.rules.length,
    round.processingDirection,
  ).map((index) => round.rules[index]);
  const issues: string[] = [];
  if (executionRules.length !== expected.programLength) {
    issues.push(
      `${round.difficulty} must use ${expected.programLength} rule cards.`,
    );
  }
  const executionKindKey = executionRules
    .map((rule) => rule.kind)
    .join(",");
  if (
    !expected.executionKindSequences.some(
      (sequence) => sequence.join(",") === executionKindKey,
    )
  ) {
    issues.push(
      `${round.difficulty} uses a rule sequence outside its curriculum.`,
    );
  }
  if (
    round.difficulty === "Junior" &&
    new Set(round.answer).size < 2
  ) {
    issues.push("Junior answers must remain non-uniform and input-dependent.");
  }
  return issues;
}

function isKnownMisconception(
  round: StripRound,
  option: StripOption,
): boolean {
  if (option.kind === "correct") return false;
  if (option.kind === "local-near-miss") {
    if (round.difficulty === "Expert" || round.difficulty === "Wizard") {
      return false;
    }
    const distance = stripDistance(option.strip, round.answer);
    return distance === 2;
  }
  return misconceptionCandidates(
    round.input,
    round.rules,
    round.processingDirection,
  ).some(
    (candidate) =>
      candidate.kind === option.kind &&
      sameStrip(candidate.strip, option.strip),
  );
}

export function validateRound(round: StripRound): readonly string[] {
  const issues: string[] = [];
  if (!round.id) issues.push("Round ID is required.");
  if (!isDifficulty(round.difficulty)) issues.push("Unknown difficulty.");
  if (
    round.processingDirection !== "ltr" &&
    round.processingDirection !== "rtl"
  ) {
    issues.push("Unknown processing direction.");
  }
  if (
    round.input.length < 4 ||
    round.input.length > 12 ||
    !round.input.every(isCellState)
  ) {
    issues.push("Input must contain 4–12 known cell states.");
  }
  round.rules.forEach((rule, index) =>
    issues.push(...validateRule(rule, index)),
  );
  issues.push(...difficultyFamilyIssues(round));

  let result: ProgramResult | null = null;
  try {
    result = applyProgram(
      round.input,
      round.rules,
      round.processingDirection,
    );
  } catch {
    issues.push("Program could not be executed.");
  }

  if (result) {
    if (!sameStrip(result.output, round.answer)) {
      issues.push("Stored answer does not match the calculated output.");
    }
    for (const step of result.steps) {
      if (sameStrip(step.before, step.after)) {
        issues.push(`Rule card ${step.ruleIndex + 1} is a no-op in this round.`);
      }
    }
    if (
      result.steps.length > 1 &&
      sameStrip(
        result.output,
        applyProgram(
          round.input,
          round.rules,
          OPPOSITE_PROCESSING_DIRECTION[round.processingDirection],
        ).output,
      )
    ) {
      issues.push("Processing order does not affect this multi-card round.");
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
        !option.strip.every(isCellState),
    )
  ) {
    issues.push("Every option must match the input length and state grammar.");
  }

  const optionKeys = round.options.map((option) => encodeStrip(option.strip));
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
      issues.push(`Option ${index + 1} is not a supported misconception.`);
    }
  });

  if (round.difficulty === "Starter" || round.difficulty === "Junior") {
    for (let first = 0; first < round.options.length; first += 1) {
      for (let second = first + 1; second < round.options.length; second += 1) {
        if (
          stripDistance(
            round.options[first].strip,
            round.options[second].strip,
          ) < 2
        ) {
          issues.push(
            `Options ${first + 1} and ${second + 1} must differ in at least two positions.`,
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
  "reverse-order": "That strip follows the cards in the opposite order.",
  "stopped-early": "That strip stops before every card has had its turn.",
  "one-card-only": "That strip uses just one of the shown cards.",
  "skipped-card": "That strip skips one card in the arrow path.",
  "missed-all": "That is the starting strip before the cards change it.",
  "reversed-arrow": "That strip turns one small change arrow around.",
  "wrong-target": "That strip changes a matching cell into the other state.",
  "opposite-neighbor": "That strip checks the neighbor on the other side.",
  "opposite-shift": "That strip moves the whole row in the other direction.",
  "wrong-swap-pair": "That strip swaps the wrong pair of cell states.",
  "changed-one-match":
    "That strip changes only one match; a card changes every match together.",
  "local-near-miss":
    "That strip is close, but one or two cells do not match the final frame.",
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
  const differingIndexes = differingStripIndexes(option.strip, round.answer);
  const correct = optionIndex === round.correctIndex;
  return {
    correct,
    kind: option.kind,
    mismatchCount: differingIndexes.length,
    differingIndexes,
    attempted: cloneStrip(option.strip),
    expected: cloneStrip(round.answer),
    message: correct
      ? `Correct. The cards run ${processingDirectionLabel(round.processingDirection)}.`
      : `${MISCONCEPTION_MESSAGES[option.kind as MisconceptionKind]} ${differingIndexes.length} ${differingIndexes.length === 1 ? "cell is" : "cells are"} different.`,
    trace: applyProgram(
      round.input,
      round.rules,
      round.processingDirection,
    ).steps,
  };
}

function sampleUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("Random source must return a finite value in [0, 1).");
  }
  return value;
}

function randomIndex(random: RandomSource, length: number): number {
  return Math.floor(sampleUnit(random) * length);
}

function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(random, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function randomStripWithCounts(
  states: readonly [CellState, CellState, CellState],
  random: RandomSource,
): Strip {
  const [first, second, third] = states;
  const extra = states[randomIndex(random, states.length)];
  return shuffled(
    [first, first, second, second, third, third, extra],
    random,
  );
}

function randomNeighborStrip(
  states: readonly [CellState, CellState, CellState],
  neighborDirection: NeighborDirection,
  random: RandomSource,
): Strip {
  const [from, neighbor] = states;
  const strip = Array.from(
    { length: GENERATED_STRIP_LENGTH },
    () => states[randomIndex(random, states.length)],
  );
  const fromIndex =
    neighborDirection === "right"
      ? randomIndex(random, GENERATED_STRIP_LENGTH - 1)
      : 1 + randomIndex(random, GENERATED_STRIP_LENGTH - 1);
  const neighborIndex =
    fromIndex + (neighborDirection === "right" ? 1 : -1);
  strip[fromIndex] = from;
  strip[neighborIndex] = neighbor;
  return strip;
}

function generatedSpec(
  difficulty: Difficulty,
  random: RandomSource,
): Readonly<{
  input: Strip;
  rules: readonly TransitionRule[];
  processingDirection: ProcessingDirection;
  correctIndex: 0 | 1 | 2 | 3;
}> {
  const states = STATE_PERMUTATIONS[
    randomIndex(random, STATE_PERMUTATIONS.length)
  ] as readonly [CellState, CellState, CellState];
  const [first, second, third] = states;
  const processingDirection: ProcessingDirection =
    randomIndex(random, 2) === 0 ? "ltr" : "rtl";
  const correctIndex = randomIndex(random, 4) as 0 | 1 | 2 | 3;

  if (difficulty === "Starter") {
    return {
      input: randomStripWithCounts(states, random),
      rules: [{ kind: "replace", from: first, to: second }],
      processingDirection,
      correctIndex,
    };
  }

  if (difficulty === "Junior") {
    const family = randomIndex(random, 3);
    if (family === 0) {
      return {
        input: randomStripWithCounts(states, random),
        rules: [{ kind: "swap", first, second }],
        processingDirection,
        correctIndex,
      };
    }
    if (family === 1) {
      const direction: "left" | "right" =
        randomIndex(random, 2) === 0 ? "left" : "right";
      return {
        input: randomStripWithCounts(states, random),
        rules: [{ kind: "shift", direction }],
        processingDirection,
        correctIndex,
      };
    }
    const neighborDirection: NeighborDirection =
      randomIndex(random, 2) === 0 ? "left" : "right";
    return {
      input: randomNeighborStrip(states, neighborDirection, random),
      rules: [
        {
          kind: "neighbor",
          neighborDirection,
          neighbor: second,
          from: first,
          to: third,
        },
      ],
      processingDirection,
      correctIndex,
    };
  }

  const shiftDirection: "left" | "right" =
    randomIndex(random, 2) === 0 ? "left" : "right";
  const swapRule: SwapRule = {
    kind: "swap",
    first: second,
    second: third,
  };

  if (difficulty === "Expert") {
    const executionRules: readonly TransitionRule[] = [
      { kind: "replace", from: first, to: second },
      { kind: "shift", direction: shiftDirection },
      swapRule,
    ];
    return {
      input: randomStripWithCounts(states, random),
      rules: physicalRulesForDirection(executionRules, processingDirection),
      processingDirection,
      correctIndex,
    };
  }

  const neighborDirection: NeighborDirection =
    randomIndex(random, 2) === 0 ? "left" : "right";
  const neighborRule: NeighborRule = {
    kind: "neighbor",
    neighborDirection,
    neighbor: second,
    from: first,
    to: third,
  };
  const afterShift = randomNeighborStrip(
    states,
    neighborDirection,
    random,
  );
  const executionRules: readonly TransitionRule[] = [
    { kind: "shift", direction: shiftDirection },
    neighborRule,
    swapRule,
  ];
  return {
    input: inverseShift(afterShift, shiftDirection),
    rules: physicalRulesForDirection(executionRules, processingDirection),
    processingDirection,
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
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    try {
      const spec = generatedSpec(difficulty, random);
      const provisional = makeRound(
        "generated",
        difficulty,
        spec.input,
        spec.rules,
        spec.processingDirection,
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
      // Candidate rejection is expected. The public boundary fails only after
      // the fixed attempt budget, never by returning an invalid round.
    }
  }
  throw new Error(
    `Unable to generate a valid ${difficulty} Changing Strips round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

/** Mulberry32: compact, deterministic, and suitable for reproducible puzzles. */
export function makeSeededRandom(seed: number | string): RandomSource {
  let state =
    typeof seed === "number"
      ? seed >>> 0
      : [...seed].reduce(
          (hash, character) =>
            Math.imul(hash ^ character.charCodeAt(0), 0x45d9f3b) >>> 0,
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
