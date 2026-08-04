import {
  BALANCE_TOKENS,
  BALANCE_TOKEN_NAMES,
  FOUNDATIONAL_STRATEGIES,
  orientEquation,
  solutionDerivationMatchesRound,
  type BalanceEquation,
  type BalanceToken,
  type Expression,
  type EquationOrientation,
  type FoundationalStrategy,
  type Round,
  type SolutionStrategy,
} from "./game-engine.ts";

export const STRATEGY_IDS = [
  ...FOUNDATIONAL_STRATEGIES,
  "substitution",
  "create-combo",
  "add-scales",
  "subtract-scales",
] as const satisfies readonly (FoundationalStrategy | SolutionStrategy)[];

export type StrategyId = (typeof STRATEGY_IDS)[number];
export type StrategySectionId = "foundation" | "solve-plans";

export type StrategySection = {
  id: StrategySectionId;
  name: string;
  description: string;
};

export const STRATEGY_SECTIONS: readonly StrategySection[] = [
  {
    id: "foundation",
    name: "Balance basics",
    description: "Moves that keep one balanced scale true.",
  },
  {
    id: "solve-plans",
    name: "Solve plans",
    description: "Ways to link several balanced scales.",
  },
] as const;

export type StrategyCatalogueEntry = {
  id: StrategyId;
  section: StrategySectionId;
  name: string;
  shortName: string;
  symbol: string;
  description: string;
};

export const STRATEGY_CATALOGUE_BY_ID: Readonly<
  Record<StrategyId, StrategyCatalogueEntry>
> = {
  "split-evenly": {
    id: "split-evenly",
    section: "foundation",
    name: "Split evenly",
    shortName: "Split",
    symbol: "÷",
    description:
      "Split both trays into the same number of equal groups, then keep one group from each tray.",
  },
  "cancel-matches": {
    id: "cancel-matches",
    section: "foundation",
    name: "Cancel matches",
    shortName: "Cancel",
    symbol: "− = −",
    description:
      "When the same load appears on both trays, remove that load from each tray.",
  },
  substitution: {
    id: "substitution",
    section: "solve-plans",
    name: "Substitute equals",
    shortName: "Substitute",
    symbol: "⇄",
    description:
      "When two loads balance, one can replace the other on another scale.",
  },
  "create-combo": {
    id: "create-combo",
    section: "solve-plans",
    name: "Create a combo",
    shortName: "Combo",
    symbol: "k( )",
    description:
      "Circle repeated copies of the animal group the question asks for, then keep one group.",
  },
  "add-scales": {
    id: "add-scales",
    section: "solve-plans",
    name: "Add scales",
    shortName: "Add",
    symbol: "+",
    description:
      "Combine two balanced scales tray by tray to put the animals you need together.",
  },
  "subtract-scales": {
    id: "subtract-scales",
    section: "solve-plans",
    name: "Subtract scales",
    shortName: "Subtract",
    symbol: "−",
    description:
      "Remove one balanced scale from another: left tray from left tray, and right tray from right tray.",
  },
};

export const STRATEGY_CATALOGUE: readonly StrategyCatalogueEntry[] =
  STRATEGY_IDS.map((id) => STRATEGY_CATALOGUE_BY_ID[id]);

export const PROOF_STRATEGY_NAMES: Readonly<Record<StrategyId, string>> = {
  "split-evenly": "Split",
  "cancel-matches": "Cancel",
  substitution: "Substitution",
  "create-combo": "Combo",
  "add-scales": "Add scales",
  "subtract-scales": "Subtract scales",
};

type StrategyRound = Round;

/**
 * Returns lesson parts in one stable curriculum order. Starter rounds teach
 * their concrete balance move rather than prematurely naming substitution.
 * Wizard parts remain available here for post-solve discovery.
 */
export function orderedStrategyIdsForRound(
  round: StrategyRound,
): readonly StrategyId[] {
  return buildTeachingProof(round).strategyIds;
}

export function canIntroduceStrategiesBeforeRound(
  round: Pick<Round, "difficulty">,
): boolean {
  return round.difficulty !== "Wizard";
}

export function preRoundStrategyIds(
  round: StrategyRound,
): readonly StrategyId[] {
  return canIntroduceStrategiesBeforeRound(round)
    ? orderedStrategyIdsForRound(round)
    : [];
}

/**
 * Keeps standalone Infinite's first encounters in the same conceptual order
 * as Campaign without changing the deterministic puzzle generator itself.
 * Completed lesson discoveries are the session cursor: a player cannot begin
 * a round until its queued lesson has been closed and recorded.
 */
export function isInfiniteCurriculumCandidate(
  round: StrategyRound,
  discoveredIds: readonly StrategyId[],
): boolean {
  const discovered = new Set(discoveredIds);

  if (round.difficulty === "Starter") {
    if (!discovered.has("split-evenly")) return round.family === "direct";
    if (!discovered.has("cancel-matches")) {
      return round.family === "cancellation";
    }
    return true;
  }

  if (round.difficulty === "Junior") {
    if (!discovered.has("substitution")) return round.family === "chain";
    if (!discovered.has("create-combo")) {
      return round.family === "combo-primer";
    }
    if (!discovered.has("add-scales")) return round.family === "add-combo";
    if (!discovered.has("subtract-scales")) {
      return round.family === "subtract-combo";
    }
    return true;
  }

  if (round.difficulty === "Expert") {
    // Three first-try Junior wins can promote immediately after Add. Use one
    // direct difference round to introduce the remaining Subtract tool before
    // the unrestricted Expert pool begins.
    if (!discovered.has("subtract-scales")) return round.family === "difference";
    return orderedStrategyIdsForRound(round).every((id) => discovered.has(id));
  }

  // Wizard deliberately hides pre-round teaching. Never admit a Wizard proof
  // that depends on a tool this Infinite session has not already discovered.
  return orderedStrategyIdsForRound(round).every((id) => discovered.has(id));
}

export function unseenStrategyIds(
  discoveredIds: readonly StrategyId[],
  pendingIds: readonly StrategyId[],
  encounteredIds: readonly StrategyId[],
): readonly StrategyId[] {
  const known = new Set<StrategyId>([
    ...discoveredIds,
    ...pendingIds,
  ]);
  const additions: StrategyId[] = [];

  for (const id of encounteredIds) {
    if (known.has(id)) continue;
    known.add(id);
    additions.push(id);
  }

  return additions;
}

export function discoveredStrategyIdsAfterLesson(
  currentIds: readonly StrategyId[],
  completedId: StrategyId,
): readonly StrategyId[] {
  return currentIds.includes(completedId)
    ? currentIds
    : [...currentIds, completedId];
}

export function canOpenHistoricalReview({
  isIdle,
  isSolved,
  hasPendingLessons,
  isReplayingLesson,
}: {
  isIdle: boolean;
  isSolved: boolean;
  hasPendingLessons: boolean;
  isReplayingLesson: boolean;
}): boolean {
  return (
    isIdle &&
    isSolved &&
    !hasPendingLessons &&
    !isReplayingLesson
  );
}

export type SolutionProofEquationUse = {
  sourceIndex: number;
  multiplier: number;
  repeatCount: number;
  reversed: boolean;
  orientedEquation: BalanceEquation;
  copies: readonly BalanceEquation[];
  repeatedEquation: BalanceEquation;
  accessibleText: string;
};

export type SolutionProofCancellation = {
  common: Expression;
  leftRemoved: Expression;
  rightRemoved: Expression;
};

export type SolutionProofRegroup = {
  factor: number;
  targetBundle: Expression;
  rightBundle: Expression;
};

export type SolutionProofStepKind =
  | "prepare-scale"
  | "combine-scales"
  | "cancel-matches"
  | "regroup"
  | "final-goal";

export type SolutionProofStep = {
  id: string;
  kind: SolutionProofStepKind;
  text: string;
};

export type SolutionProof = {
  equationUses: readonly SolutionProofEquationUse[];
  combinedEquation: BalanceEquation;
  cancellation: SolutionProofCancellation;
  reducedEquation: BalanceEquation;
  regroup: SolutionProofRegroup;
  finalEquation: BalanceEquation;
  steps: readonly SolutionProofStep[];
  accessibleSteps: readonly string[];
};

export type TeachingEquationSource = {
  sourceIndex: number;
  copies: number;
  equation: BalanceEquation;
};

export type TeachingReplacement = {
  side: "left" | "right";
  sourceFromSide: "left" | "right";
  sourceToSide: "left" | "right";
  from: Expression;
  to: Expression;
  copies: number;
};

export type TeachingGroupedEquation = {
  groupCount: number;
  leftBundle: Expression;
  rightBundle: Expression;
};

type TeachingProofStepBase = {
  id: string;
  title: string;
  text: string;
  strategyId: StrategyId | null;
  scaleFocus: {
    workingScaleIndex: number;
    sourceScaleIndexes: readonly number[];
  } | null;
};

export type TeachingInspectStep = TeachingProofStepBase & {
  kind: "inspect";
  strategyId: null;
  sources: readonly TeachingEquationSource[];
};

export type TeachingSubstituteStep = TeachingProofStepBase & {
  kind: "substitute";
  strategyId: "substitution";
  before: BalanceEquation;
  after: BalanceEquation;
  source: TeachingEquationSource;
  replacement: TeachingReplacement;
};

export type TeachingReorientScaleStep = TeachingProofStepBase & {
  kind: "reorient-scale";
  strategyId: "add-scales" | "subtract-scales";
  before: BalanceEquation;
  after: BalanceEquation;
};

export type TeachingAddScalesStep = TeachingProofStepBase & {
  kind: "add-scales";
  strategyId: "add-scales";
  before: readonly TeachingEquationSource[];
  after: BalanceEquation;
};

export type TeachingSubtractScalesStep = TeachingProofStepBase & {
  kind: "subtract-scales";
  strategyId: "subtract-scales";
  before: readonly TeachingEquationSource[];
  after: BalanceEquation;
};

export type TeachingCancelMatchesStep = TeachingProofStepBase & {
  kind: "cancel-matches";
  strategyId: "cancel-matches";
  before: BalanceEquation;
  after: BalanceEquation;
  removed: Expression;
};

export type TeachingRegroupStep = TeachingProofStepBase & {
  kind: "regroup";
  strategyId: "create-combo";
  before: BalanceEquation;
  after: TeachingGroupedEquation;
};

export type TeachingSplitEvenlyStep = TeachingProofStepBase & {
  kind: "split-evenly";
  strategyId: "split-evenly";
  before: BalanceEquation | TeachingGroupedEquation;
  after: BalanceEquation;
  divisor: number;
};

export type TeachingConcludeStep = TeachingProofStepBase & {
  kind: "conclude";
  strategyId: null;
  equation: BalanceEquation;
};

export type TeachingProofStep =
  | TeachingInspectStep
  | TeachingSubstituteStep
  | TeachingReorientScaleStep
  | TeachingAddScalesStep
  | TeachingSubtractScalesStep
  | TeachingCancelMatchesStep
  | TeachingRegroupStep
  | TeachingSplitEvenlyStep
  | TeachingConcludeStep;

export type TeachingProofPlan = {
  steps: readonly TeachingProofStep[];
  timeline: readonly TeachingProofSceneTiming[];
  strategyIds: readonly StrategyId[];
  finalEquation: BalanceEquation;
  durationMs: number;
  reducedMotionDurationMs: number;
};

export type TeachingProofSceneTiming = {
  stepId: string;
  delayMs: number;
  durationMs: number;
};

// These are the longest measured local narration clip for each proof kind,
// plus its quiet linger. Runtime playback uses the exact per-cue manifest;
// this timeline remains a deterministic summary for tests and review copy.
const NARRATED_PROOF_STEP_DURATIONS_MS: Readonly<
  Record<TeachingProofStep["kind"], number>
> = {
  inspect: 8_550,
  substitute: 9_250,
  "reorient-scale": 9_250,
  "add-scales": 16_900,
  "subtract-scales": 15_425,
  "cancel-matches": 9_950,
  regroup: 8_875,
  "split-evenly": 10_450,
  conclude: 4_625,
};

export function teachingProofStepDurationMs(
  step: Pick<TeachingProofStep, "kind">,
): number {
  return NARRATED_PROOF_STEP_DURATIONS_MS[step.kind];
}

export function teachingProofTimeline(
  steps: readonly TeachingProofStep[],
): readonly TeachingProofSceneTiming[] {
  let delayMs = 0;
  return steps.map((step) => {
    const durationMs = teachingProofStepDurationMs(step);
    const timing = { stepId: step.id, delayMs, durationMs };
    delayMs += durationMs;
    return timing;
  });
}

function emptyCounts(): Record<BalanceToken, number> {
  return Object.fromEntries(
    BALANCE_TOKENS.map((token) => [token, 0]),
  ) as Record<BalanceToken, number>;
}

function expressionCounts(expression: Expression): Record<BalanceToken, number> {
  const counts = emptyCounts();
  for (const { creature, count } of expression) {
    counts[creature] += count;
  }
  return counts;
}

function expressionFromCounts(
  counts: Readonly<Record<BalanceToken, number>>,
): Expression {
  return BALANCE_TOKENS.flatMap((creature) => {
    const count = counts[creature];
    return count > 0 ? [{ creature, count }] : [];
  });
}

function scaleExpression(
  expression: Expression,
  multiplier: number,
): Expression {
  const counts = expressionCounts(expression);
  for (const token of BALANCE_TOKENS) {
    counts[token] *= multiplier;
  }
  return expressionFromCounts(counts);
}

function addExpressions(expressions: readonly Expression[]): Expression {
  const total = emptyCounts();
  for (const expression of expressions) {
    const counts = expressionCounts(expression);
    for (const token of BALANCE_TOKENS) {
      total[token] += counts[token];
    }
  }
  return expressionFromCounts(total);
}

function subtractExpression(
  expression: Expression,
  removed: Expression,
): Expression {
  const remainder = expressionCounts(expression);
  const removedCounts = expressionCounts(removed);
  for (const token of BALANCE_TOKENS) {
    remainder[token] -= removedCounts[token];
    if (remainder[token] < 0) {
      throw new Error("A solution proof cannot remove an absent load.");
    }
  }
  return expressionFromCounts(remainder);
}

function commonExpression(
  left: Expression,
  right: Expression,
): Expression {
  const leftCounts = expressionCounts(left);
  const rightCounts = expressionCounts(right);
  const common = emptyCounts();
  for (const token of BALANCE_TOKENS) {
    common[token] = Math.min(leftCounts[token], rightCounts[token]);
  }
  return expressionFromCounts(common);
}

const BALANCE_TOKEN_PLURAL_NAMES: Readonly<Record<BalanceToken, string>> = {
  chick: "chicks",
  goose: "geese",
  fox: "foxes",
  frog: "frogs",
  rabbit: "rabbits",
  turtle: "turtles",
  cat: "cats",
  owl: "owls",
  beetle: "beetles",
  bear: "bears",
  mystery: "sealed loads",
};

function countedTokenText(creature: BalanceToken, count: number): string {
  if (count === 1) {
    const name = BALANCE_TOKEN_NAMES[creature];
    return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
  }
  return `${count} ${BALANCE_TOKEN_PLURAL_NAMES[creature]}`;
}

function joinNatural(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function sentenceCase(value: string): string {
  return value.length > 0
    ? `${value[0].toUpperCase()}${value.slice(1)}`
    : value;
}

function expressionText(expression: Expression): string {
  if (expression.length === 0) return "nothing";
  return joinNatural(
    expression.map(({ creature, count }) =>
      countedTokenText(creature, count),
    ),
  );
}

function repeatedBundleText(bundle: Expression, copies: number): string {
  if (bundle.length === 1 && bundle[0].count === 1) {
    return countedTokenText(bundle[0].creature, copies);
  }
  return `${copies} equal groups of ${expressionText(bundle)}`;
}

function expressionIsSingular(expression: Expression): boolean {
  return expression.length === 1 && expression[0].count === 1;
}

function equationText(equation: BalanceEquation): string {
  return `${expressionText(equation.left)} ${
    expressionIsSingular(equation.left) ? "balances" : "balance"
  } ${expressionText(
    equation.right,
  )}`;
}

function prepareEquationUse(
  equation: BalanceEquation,
  multiplier: number,
  sourceIndex: number,
): SolutionProofEquationUse {
  const repeatCount = Math.abs(multiplier);
  const reversed = multiplier < 0;
  const orientedEquation: BalanceEquation = reversed
    ? { left: equation.right, right: equation.left }
    : equation;
  const repeatedEquation: BalanceEquation = {
    left: scaleExpression(orientedEquation.left, repeatCount),
    right: scaleExpression(orientedEquation.right, repeatCount),
  };
  const copies = Array.from(
    { length: repeatCount },
    (): BalanceEquation => orientedEquation,
  );
  const actions = [
    ...(reversed ? ["reverse it"] : []),
    ...(repeatCount > 1 ? [`repeat it ${repeatCount} times`] : []),
  ];
  const instruction =
    actions.length === 0
      ? "use it as shown"
      : actions.join(", then ");

  return {
    sourceIndex,
    multiplier,
    repeatCount,
    reversed,
    orientedEquation,
    copies,
    repeatedEquation,
    accessibleText: `Prepare scale ${sourceIndex + 1}: ${instruction}. ${equationText(
      repeatedEquation,
    )}.`,
  };
}

function canonicalExpression(expression: Expression): Expression {
  return expressionFromCounts(expressionCounts(expression));
}

function canonicalEquation(equation: BalanceEquation): BalanceEquation {
  return {
    left: canonicalExpression(equation.left),
    right: canonicalExpression(equation.right),
  };
}

function expressionsMatch(left: Expression, right: Expression): boolean {
  const leftCounts = expressionCounts(left);
  const rightCounts = expressionCounts(right);
  return BALANCE_TOKENS.every(
    (token) => leftCounts[token] === rightCounts[token],
  );
}

function equationsMatch(
  left: BalanceEquation,
  right: BalanceEquation,
): boolean {
  return (
    expressionsMatch(left.left, right.left) &&
    expressionsMatch(left.right, right.right)
  );
}

function teachingSource(
  equation: BalanceEquation,
  sourceIndex: number,
  copies = 1,
): TeachingEquationSource {
  return {
    sourceIndex,
    copies,
    equation: canonicalEquation(equation),
  };
}

function replaceLoad(
  equation: BalanceEquation,
  side: "left" | "right",
  from: Expression,
  to: Expression,
  copies = 1,
): BalanceEquation {
  if (!Number.isSafeInteger(copies) || copies <= 0) {
    throw new Error("A teaching substitution needs a positive copy count.");
  }
  const removed = scaleExpression(from, copies);
  const inserted = scaleExpression(to, copies);
  const nextSide = addExpressions([
    subtractExpression(equation[side], removed),
    inserted,
  ]);
  return canonicalEquation({
    left: side === "left" ? nextSide : equation.left,
    right: side === "right" ? nextSide : equation.right,
  });
}

function addEquations(
  equations: readonly BalanceEquation[],
): BalanceEquation {
  if (equations.length < 2) {
    throw new Error("Adding scales needs at least two equations.");
  }
  return canonicalEquation({
    left: addExpressions(equations.map(({ left }) => left)),
    right: addExpressions(equations.map(({ right }) => right)),
  });
}

function subtractEquations(
  minuend: BalanceEquation,
  subtrahend: BalanceEquation,
): BalanceEquation {
  return canonicalEquation({
    left: subtractExpression(minuend.left, subtrahend.left),
    right: subtractExpression(minuend.right, subtrahend.right),
  });
}

function goalEquation(round: Round): BalanceEquation {
  return canonicalEquation({
    left: round.question.target,
    right: [
      {
        creature: round.question.unit,
        count: round.answer,
      },
    ],
  });
}

function assertChanged(
  before: BalanceEquation,
  after: BalanceEquation,
  kind: TeachingProofStep["kind"],
): void {
  if (equationsMatch(before, after)) {
    throw new Error(`A ${kind} teaching step cannot be a no-op.`);
  }
}

export function displayedProofScaleIndexes(
  round: Pick<Round, "equations" | "scaffold">,
): readonly number[] {
  return (
    round.scaffold?.equationOrder ??
    round.equations.map((_, equationIndex) => equationIndex)
  );
}

export function displayedProofScaleNumber(
  round: Pick<Round, "equations" | "scaffold">,
  sourceIndex: number,
): number {
  const displayedIndex = displayedProofScaleIndexes(round).indexOf(sourceIndex);
  if (displayedIndex < 0) {
    throw new Error("A proof step referenced a scale that is not displayed.");
  }
  return displayedIndex + 1;
}

function oppositeSide(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

function orientSide(
  side: "left" | "right",
  orientation: EquationOrientation,
): "left" | "right" {
  return orientation === "mirrored" ? oppositeSide(side) : side;
}

function orientTeachingSource(
  source: TeachingEquationSource,
  orientation: EquationOrientation,
): TeachingEquationSource {
  return {
    ...source,
    equation: orientEquation(source.equation, orientation),
  };
}

function orientGroupedEquation(
  equation: TeachingGroupedEquation,
  orientation: EquationOrientation,
): TeachingGroupedEquation {
  return orientation === "mirrored"
    ? {
        ...equation,
        leftBundle: equation.rightBundle,
        rightBundle: equation.leftBundle,
      }
    : equation;
}

function orientedScaleLabel(round: Round, sourceIndex: number): string {
  return `scale (${displayedProofScaleNumber(round, sourceIndex)})`;
}

function requiredWorkingScaleIndex(step: TeachingProofStepBase): number {
  if (!step.scaleFocus) {
    throw new Error("A teaching operation needs a focused scale.");
  }
  return step.scaleFocus.workingScaleIndex;
}

function orientedSourceLabel(
  round: Round,
  source: TeachingEquationSource,
): string {
  const label = orientedScaleLabel(round, source.sourceIndex);
  return source.copies === 1 ? label : `${source.copies} copies of ${label}`;
}

function orientedSubstitutionText(
  round: Round,
  step: TeachingSubstituteStep,
): string {
  const sourceLabel = orientedScaleLabel(round, step.source.sourceIndex);
  const workingLabel = orientedScaleLabel(
    round,
    requiredWorkingScaleIndex(step),
  );
  const sourceFrom = step.source.equation[step.replacement.sourceFromSide];
  const sourceTo = step.source.equation[step.replacement.sourceToSide];
  const sourceEquality = equationText(step.source.equation);
  return step.replacement.copies === 1
    ? `${sentenceCase(sourceLabel)} shows that ${sourceEquality}. On ${workingLabel}, replace ${expressionText(
        step.replacement.from,
      )} on the ${step.replacement.side} tray with ${expressionText(
        step.replacement.to,
      )}.`
    : `${sentenceCase(sourceLabel)} shows that ${sourceEquality}. The ${
        step.replacement.side
      } tray of ${workingLabel} has ${expressionText(
        step.replacement.from,
      )}. Replace ${expressionText(sourceFrom)} at a time with ${expressionText(
        sourceTo,
      )}.`;
}

function orientedAddScalesText(
  round: Round,
  step: TeachingAddScalesStep,
): string {
  const removable = commonExpression(step.after.left, step.after.right);
  const motivation =
    removable.length > 0
      ? `Add the scales so ${expressionText(removable)} ${
          expressionIsSingular(removable) ? "appears" : "appear"
        } on both trays.`
      : `Neither scale has ${expressionText(
          round.question.target,
        )} together. Add the scales.`;
  return `${motivation} Add ${orientedSourceLabel(
    round,
    step.before[1],
  )} to ${orientedSourceLabel(
    round,
    step.before[0],
  )}: left tray to left tray and right tray to right tray.`;
}

function orientedSubtractScalesText(
  round: Round,
  step: TeachingSubtractScalesStep,
): string {
  const [minuend, subtrahend] = step.before;
  return `Subtract ${orientedSourceLabel(
    round,
    subtrahend,
  )} from ${orientedSourceLabel(round, minuend)}. Remove ${expressionText(
    subtrahend.equation.left,
  )} from the left tray and ${expressionText(
    subtrahend.equation.right,
  )} from the right tray of ${orientedScaleLabel(
    round,
    minuend.sourceIndex,
  )}. Now ${equationText(step.after)}.`;
}

function orientedCancelText(
  round: Round,
  step: TeachingCancelMatchesStep,
): string {
  const removedIsSingular =
    step.removed.length === 1 && step.removed[0].count === 1;
  return `On ${orientedScaleLabel(
    round,
    requiredWorkingScaleIndex(step),
  )}, ${expressionText(step.removed)} ${
    removedIsSingular ? "appears" : "appear"
  } on both trays. Remove ${expressionText(
    step.removed,
  )} from each tray. Now ${equationText(step.after)}.`;
}

function oppositeProofSide(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

function orientedRegroupText(
  round: Round,
  step: TeachingRegroupStep,
): string {
  const groupSide = expressionsMatch(
    step.after.leftBundle,
    round.question.target,
  )
    ? "left"
    : "right";
  const otherSide = oppositeProofSide(groupSide);
  return `On ${orientedScaleLabel(
    round,
    requiredWorkingScaleIndex(step),
  )}, the ${groupSide} tray has ${expressionText(
    step.before[groupSide],
  )}. Circle ${step.after.groupCount} groups, each with ${expressionText(
    step.after[`${groupSide}Bundle`],
  )}. Split ${expressionText(
    step.before[otherSide],
  )} on the ${otherSide} into ${step.after.groupCount} equal groups.`;
}

function preferredSplitGroupSide(
  round: Round,
  after: BalanceEquation,
): "left" | "right" {
  if (expressionsMatch(after.left, round.question.target)) return "left";
  if (expressionsMatch(after.right, round.question.target)) return "right";
  const leftIsOnlyUnits = after.left.every(
    ({ creature }) => creature === round.question.unit,
  );
  const rightIsOnlyUnits = after.right.every(
    ({ creature }) => creature === round.question.unit,
  );
  return leftIsOnlyUnits && !rightIsOnlyUnits ? "right" : "left";
}

function orientedSplitText(
  round: Round,
  step: TeachingSplitEvenlyStep,
): string {
  const scaleLabel = orientedScaleLabel(
    round,
    requiredWorkingScaleIndex(step),
  );
  if ("groupCount" in step.before) {
    return `On ${scaleLabel}, each tray now has ${step.divisor} equal groups. Keep one group from each tray: ${equationText(
      step.after,
    )}.`;
  }
  const groupSide = preferredSplitGroupSide(round, step.after);
  const otherSide = oppositeProofSide(groupSide);
  return `On ${scaleLabel}, there are ${repeatedBundleText(
    step.after[groupSide],
    step.divisor,
  )} on the ${groupSide}, so split ${expressionText(
    step.before[otherSide],
  )} on the ${otherSide} into ${step.divisor} equal groups. Keep one group from each tray: ${equationText(
    step.after,
  )}.`;
}

/**
 * Builds the shortest curriculum-approved visual path for a round. Unlike the
 * signed certificate, this plan models the order a learner should actually
 * see: replace equal loads in place, remove only visible matches, and combine
 * whole scales only in families that explicitly teach that move.
 */
function buildCanonicalTeachingProof(round: Round): TeachingProofPlan {
  if (!solutionDerivationMatchesRound(round)) {
    throw new Error("Cannot teach an invalid solution derivation.");
  }

  const steps: TeachingProofStep[] = [];
  const equations = round.equations.map(canonicalEquation);
  const finalEquation = goalEquation(round);
  const targetIsCombo = round.question.target.length > 1;
  let stepNumber = 0;

  const nextId = (kind: TeachingProofStep["kind"]): string =>
    `${++stepNumber}-${kind}`;
  const scaleLabel = (sourceIndex: number): string =>
    `scale (${displayedProofScaleNumber(round, sourceIndex)})`;
  const source = (
    equation: BalanceEquation,
    sourceIndex: number,
    copies = 1,
  ): TeachingEquationSource => teachingSource(equation, sourceIndex, copies);
  const sourceLabel = (equationSource: TeachingEquationSource): string =>
    equationSource.copies === 1
      ? scaleLabel(equationSource.sourceIndex)
      : `${equationSource.copies} copies of ${scaleLabel(
          equationSource.sourceIndex,
        )}`;
  const expandedSourceEquation = (
    equationSource: TeachingEquationSource,
  ): BalanceEquation =>
    equationSource.copies === 1
      ? equationSource.equation
      : canonicalEquation({
          left: scaleExpression(
            equationSource.equation.left,
            equationSource.copies,
          ),
          right: scaleExpression(
            equationSource.equation.right,
            equationSource.copies,
          ),
        });
  const substitute = ({
    before,
    beforeScaleIndex,
    sourceEquation,
    sourceIndex,
    side,
    from,
    to,
    copies = 1,
  }: {
    before: BalanceEquation;
    beforeScaleIndex: number;
    sourceEquation: BalanceEquation;
    sourceIndex: number;
    side: "left" | "right";
    from: Expression;
    to: Expression;
    copies?: number;
  }): BalanceEquation => {
    const sourceSupportsReplacement =
      (expressionsMatch(sourceEquation.left, from) &&
        expressionsMatch(sourceEquation.right, to)) ||
      (expressionsMatch(sourceEquation.right, from) &&
        expressionsMatch(sourceEquation.left, to));
    if (!sourceSupportsReplacement) {
      throw new Error(
        "A teaching substitution must replace loads proven equal by its source.",
      );
    }
    const sourceFromSide = expressionsMatch(sourceEquation.left, from)
      ? "left"
      : "right";
    const sourceToSide = sourceFromSide === "left" ? "right" : "left";
    const after = replaceLoad(before, side, from, to, copies);
    assertChanged(before, after, "substitute");
    const sourceEquality = equationText({
      left: canonicalExpression(from),
      right: canonicalExpression(to),
    });
    const scaledFrom = canonicalExpression(scaleExpression(from, copies));
    const scaledTo = canonicalExpression(scaleExpression(to, copies));
    steps.push({
      id: nextId("substitute"),
      kind: "substitute",
      title: "Replace an equal load",
      text:
        copies === 1
          ? `${sentenceCase(scaleLabel(
              sourceIndex,
            ))} shows that ${sourceEquality}. On ${scaleLabel(
              beforeScaleIndex,
            )}, replace ${expressionText(
              scaledFrom,
            )} on the ${side} tray with ${expressionText(scaledTo)}.`
          : `${sentenceCase(scaleLabel(
              sourceIndex,
            ))} shows that ${sourceEquality}. The ${side} tray of ${scaleLabel(
              beforeScaleIndex,
            )} has ${expressionText(
              scaledFrom,
            )}. Replace ${expressionText(
              canonicalExpression(from),
            )} at a time with ${expressionText(canonicalExpression(to))}.`,
      strategyId: "substitution",
      scaleFocus: {
        workingScaleIndex: beforeScaleIndex,
        sourceScaleIndexes: [sourceIndex],
      },
      before: canonicalEquation(before),
      after,
      source: source(sourceEquation, sourceIndex),
      replacement: {
        side,
        sourceFromSide,
        sourceToSide,
        from: canonicalExpression(scaleExpression(from, copies)),
        to: canonicalExpression(scaleExpression(to, copies)),
        copies,
      },
    });
    return after;
  };
  const addScales = (
    inputs: readonly TeachingEquationSource[],
  ): BalanceEquation => {
    const after = addEquations(inputs.map(expandedSourceEquation));
    const removable = commonExpression(after.left, after.right);
    const motivation =
      removable.length > 0
        ? `Add the scales so ${expressionText(removable)} ${
            expressionIsSingular(removable) ? "appears" : "appear"
          } on both trays.`
        : `Neither scale has ${expressionText(
            round.question.target,
          )} together. Add the scales.`;
    steps.push({
      id: nextId("add-scales"),
      kind: "add-scales",
      title: "Join the balanced scales",
      text: `${motivation} Add ${sourceLabel(inputs[1])} to ${sourceLabel(
        inputs[0],
      )}: left tray to left tray and right tray to right tray.`,
      strategyId: "add-scales",
      scaleFocus: {
        workingScaleIndex: inputs[0].sourceIndex,
        sourceScaleIndexes: inputs.slice(1).map(({ sourceIndex }) => sourceIndex),
      },
      before: inputs,
      after,
    });
    return after;
  };
  const subtractScales = (
    minuend: TeachingEquationSource,
    subtrahend: TeachingEquationSource,
  ): BalanceEquation => {
    const after = subtractEquations(minuend.equation, subtrahend.equation);
    assertChanged(minuend.equation, after, "subtract-scales");
    steps.push({
      id: nextId("subtract-scales"),
      kind: "subtract-scales",
      title: "Remove one balance",
      text: `Subtract ${sourceLabel(subtrahend)} from ${sourceLabel(
        minuend,
      )}. Remove ${expressionText(
        subtrahend.equation.left,
      )} from the left tray and ${expressionText(
        subtrahend.equation.right,
      )} from the right tray of ${scaleLabel(
        minuend.sourceIndex,
      )}. Now ${equationText(after)}.`,
      strategyId: "subtract-scales",
      scaleFocus: {
        workingScaleIndex: minuend.sourceIndex,
        sourceScaleIndexes: [subtrahend.sourceIndex],
      },
      before: [minuend, subtrahend],
      after,
    });
    return after;
  };
  const cancelMatches = (
    before: BalanceEquation,
    scaleIndex: number,
    removed: Expression = commonExpression(before.left, before.right),
  ): BalanceEquation => {
    const canonicalRemoved = canonicalExpression(removed);
    if (canonicalRemoved.length === 0) {
      throw new Error("A cancel teaching step needs a visible matching load.");
    }
    const after = canonicalEquation({
      left: subtractExpression(before.left, canonicalRemoved),
      right: subtractExpression(before.right, canonicalRemoved),
    });
    assertChanged(before, after, "cancel-matches");
    const removedIsSingular =
      canonicalRemoved.length === 1 && canonicalRemoved[0].count === 1;
    steps.push({
      id: nextId("cancel-matches"),
      kind: "cancel-matches",
      title: "Remove the matching loads",
      text: `On ${scaleLabel(scaleIndex)}, ${expressionText(
        canonicalRemoved,
      )} ${removedIsSingular ? "appears" : "appear"} on both trays. Remove ${expressionText(
        canonicalRemoved,
      )} from each tray. Now ${equationText(after)}.`,
      strategyId: "cancel-matches",
      scaleFocus: {
        workingScaleIndex: scaleIndex,
        sourceScaleIndexes: [],
      },
      before: canonicalEquation(before),
      after,
      removed: canonicalRemoved,
    });
    return after;
  };
  const regroupAndSplit = (
    before: BalanceEquation,
    divisor: number,
    scaleIndex: number,
  ): BalanceEquation => {
    if (!Number.isSafeInteger(divisor) || divisor <= 1) {
      throw new Error("Regrouping needs at least two matching bundles.");
    }
    const grouped: TeachingGroupedEquation = {
      groupCount: divisor,
      leftBundle: canonicalExpression(round.question.target),
      rightBundle: canonicalExpression(finalEquation.right),
    };
    const expandedGroups: BalanceEquation = {
      left: scaleExpression(grouped.leftBundle, divisor),
      right: scaleExpression(grouped.rightBundle, divisor),
    };
    if (!equationsMatch(before, expandedGroups)) {
      throw new Error(
        "A teaching regroup must expose exact copies of the question bundle.",
      );
    }
    steps.push({
      id: nextId("regroup"),
      kind: "regroup",
      title: `Make ${divisor} equal groups`,
      text: `On ${scaleLabel(scaleIndex)}, the left tray has ${expressionText(
        before.left,
      )}. Circle ${divisor} groups, each with ${expressionText(
        grouped.leftBundle,
      )}. Split ${expressionText(
        before.right,
      )} on the right into ${divisor} equal groups.`,
      strategyId: "create-combo",
      scaleFocus: {
        workingScaleIndex: scaleIndex,
        sourceScaleIndexes: [],
      },
      before: canonicalEquation(before),
      after: grouped,
    });
    steps.push({
      id: nextId("split-evenly"),
      kind: "split-evenly",
      title: `Keep one of the ${divisor} groups`,
      text: `On ${scaleLabel(
        scaleIndex,
      )}, each tray now has ${divisor} equal groups. Keep one group from each tray: ${equationText(
        finalEquation,
      )}.`,
      strategyId: "split-evenly",
      scaleFocus: {
        workingScaleIndex: scaleIndex,
        sourceScaleIndexes: [],
      },
      before: grouped,
      after: finalEquation,
      divisor,
    });
    return finalEquation;
  };
  const splitDirectly = (
    before: BalanceEquation,
    divisor: number,
    scaleIndex: number,
    after: BalanceEquation = finalEquation,
  ): BalanceEquation => {
    if (!Number.isSafeInteger(divisor) || divisor <= 1) {
      throw new Error("Splitting evenly needs at least two equal groups.");
    }
    const expandedAfter: BalanceEquation = {
      left: scaleExpression(after.left, divisor),
      right: scaleExpression(after.right, divisor),
    };
    if (!equationsMatch(before, expandedAfter)) {
      throw new Error(
        "A teaching split must divide every pictured load by the same amount.",
      );
    }
    steps.push({
      id: nextId("split-evenly"),
      kind: "split-evenly",
      title: `Split into ${divisor} equal groups`,
      text: `On ${scaleLabel(scaleIndex)}, there are ${repeatedBundleText(
        after.left,
        divisor,
      )} on the left, so split ${expressionText(
        before.right,
      )} on the right into ${divisor} equal groups. Keep one group from each tray: ${equationText(
        after,
      )}.`,
      strategyId: "split-evenly",
      scaleFocus: {
        workingScaleIndex: scaleIndex,
        sourceScaleIndexes: [],
      },
      before: canonicalEquation(before),
      after: canonicalEquation(after),
      divisor,
    });
    return canonicalEquation(after);
  };

  const finishBySplitting = (
    before: BalanceEquation,
    divisor: number,
    scaleIndex: number,
  ): BalanceEquation =>
    targetIsCombo
      ? regroupAndSplit(before, divisor, scaleIndex)
      : splitDirectly(before, divisor, scaleIndex);

  let current: BalanceEquation;

  switch (round.family) {
    case "direct": {
      current = splitDirectly(
        equations[0],
        round.solutionDerivation.normalizeBy,
        0,
      );
      break;
    }
    case "cancellation": {
      current = cancelMatches(equations[0], 0);
      break;
    }
    case "chain":
    case "offset-chain": {
      const bridge = equations[0].left;
      const bridgeReplacement = equations[0].right;
      const bridgeCopies = expressionCounts(equations[1].right)[
        bridge[0].creature
      ];
      current = substitute({
        before: equations[1],
        beforeScaleIndex: 1,
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "right",
        from: bridge,
        to: bridgeReplacement,
        copies: bridgeCopies,
      });
      if (round.family === "offset-chain") {
        current = cancelMatches(current, 1);
      }
      break;
    }
    case "combo-primer": {
      current = finishBySplitting(
        equations[0],
        round.solutionDerivation.normalizeBy,
        0,
      );
      break;
    }
    case "add-combo": {
      current = addScales([
        source(equations[0], 0),
        source(equations[1], 1),
      ]);
      current = finishBySplitting(
        current,
        round.solutionDerivation.normalizeBy,
        0,
      );
      break;
    }
    case "subtract-combo": {
      current = subtractScales(
        source(equations[0], 0),
        source(equations[1], 1),
      );
      current = finishBySplitting(
        current,
        round.solutionDerivation.normalizeBy,
        0,
      );
      break;
    }
    case "fork": {
      const firstLink = equations[0].left;
      const firstReplacement = equations[0].right;
      const firstCopies = expressionCounts(equations[1].right)[
        firstLink[0].creature
      ];
      let secondSolved = substitute({
        before: equations[1],
        beforeScaleIndex: 1,
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "right",
        from: firstLink,
        to: firstReplacement,
        copies: firstCopies,
      });
      secondSolved = cancelMatches(secondSolved, 1);

      current = equations[2];
      if (!targetIsCombo) {
        current = substitute({
          before: current,
          beforeScaleIndex: 2,
          sourceEquation: equations[0],
          sourceIndex: 0,
          side: "left",
          from: firstLink,
          to: firstReplacement,
        });
      }
      current = substitute({
        before: current,
        beforeScaleIndex: 2,
        sourceEquation: secondSolved,
        sourceIndex: 1,
        side: "right",
        from: secondSolved.left,
        to: secondSolved.right,
      });
      if (!targetIsCombo) current = cancelMatches(current, 2);
      break;
    }
    case "cross": {
      const firstSolved = cancelMatches(equations[0], 0);
      const firstLink = firstSolved.left;
      let secondSolved = substitute({
        before: equations[1],
        beforeScaleIndex: 1,
        sourceEquation: firstSolved,
        sourceIndex: 0,
        side: "right",
        from: firstLink,
        to: firstSolved.right,
        copies: expressionCounts(equations[1].right)[firstLink[0].creature],
      });
      secondSolved = cancelMatches(secondSolved, 1);

      current = equations[2];
      if (!targetIsCombo) {
        current = substitute({
          before: current,
          beforeScaleIndex: 2,
          sourceEquation: firstSolved,
          sourceIndex: 0,
          side: "left",
          from: firstSolved.left,
          to: firstSolved.right,
        });
      }
      current = substitute({
        before: current,
        beforeScaleIndex: 2,
        sourceEquation: secondSolved,
        sourceIndex: 1,
        side: "right",
        from: secondSolved.left,
        to: secondSolved.right,
      });
      if (!targetIsCombo) current = cancelMatches(current, 2);
      break;
    }
    case "parallel": {
      if (targetIsCombo) {
        throw new Error("Composite parallel rounds need an authored teaching path.");
      }
      current = substitute({
        before: equations[2],
        beforeScaleIndex: 2,
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "left",
        from: equations[0].left,
        to: equations[0].right,
      });
      current = substitute({
        before: current,
        beforeScaleIndex: 2,
        sourceEquation: equations[1],
        sourceIndex: 1,
        side: "right",
        from: equations[1].left,
        to: equations[1].right,
      });
      current = cancelMatches(current, 2);
      break;
    }
    case "sum-combo": {
      current = substitute({
        before: equations[0],
        beforeScaleIndex: 0,
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = addScales([
        source(current, 0),
        source(equations[1], 1),
      ]);
      current = finishBySplitting(
        current,
        round.solutionDerivation.normalizeBy,
        0,
      );
      break;
    }
    case "difference": {
      current = substitute({
        before: equations[0],
        beforeScaleIndex: 0,
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = subtractScales(
        source(current, 0),
        source(equations[1], 1),
      );
      if (round.solutionDerivation.normalizeBy > 1) {
        current = finishBySplitting(
          current,
          round.solutionDerivation.normalizeBy,
          0,
        );
      }
      break;
    }
    case "combo-bridge": {
      current = subtractScales(
        source(equations[1], 1),
        source(equations[2], 2),
      );
      const bridgeGoal: BalanceEquation = {
        left: equations[0].right,
        right: finalEquation.right,
      };
      const solvedBridge = splitDirectly(
        current,
        round.solutionDerivation.normalizeBy,
        1,
        bridgeGoal,
      );
      current = substitute({
        before: equations[0],
        beforeScaleIndex: 0,
        sourceEquation: solvedBridge,
        sourceIndex: 1,
        side: "right",
        from: solvedBridge.left,
        to: solvedBridge.right,
      });
      break;
    }
    case "sealed-cancellation": {
      current = substitute({
        before: equations[1],
        beforeScaleIndex: 1,
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "left",
        from: equations[0].right,
        to: equations[0].left,
      });
      current = cancelMatches(current, 1, [
        { creature: "mystery", count: 1 },
      ]);

      const divisor = round.solutionDerivation.normalizeBy;
      if (targetIsCombo) {
        current = addScales([
          source(current, 1),
          source(equations[2], 2, divisor - 1),
        ]);
      } else {
        current = substitute({
          before: current,
          beforeScaleIndex: 1,
          sourceEquation: equations[2],
          sourceIndex: 2,
          side: "left",
          from: equations[2].left,
          to: equations[2].right,
        });
        current = cancelMatches(current, 1);
      }
      current = finishBySplitting(current, divisor, 1);
      break;
    }
    case "sealed-sum": {
      current = substitute({
        before: equations[0],
        beforeScaleIndex: 0,
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = addScales([
        source(current, 0),
        source(equations[1], 1),
      ]);
      current = cancelMatches(current, 0);
      current = finishBySplitting(
        current,
        round.solutionDerivation.normalizeBy,
        0,
      );
      break;
    }
    case "sealed-difference": {
      current = substitute({
        before: equations[0],
        beforeScaleIndex: 0,
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = subtractScales(
        source(current, 0),
        source(equations[1], 1),
      );
      if (round.solutionDerivation.normalizeBy > 1) {
        current = finishBySplitting(
          current,
          round.solutionDerivation.normalizeBy,
          0,
        );
      }
      break;
    }
  }

  if (!equationsMatch(current, finalEquation)) {
    throw new Error(
      `The ${round.family} teaching path did not finish at the exact question goal.`,
    );
  }

  const strategyIds: StrategyId[] = [];
  for (const step of steps) {
    if (step.strategyId !== null && !strategyIds.includes(step.strategyId)) {
      strategyIds.push(step.strategyId);
    }
  }

  const timeline = teachingProofTimeline(steps);
  const lastScene = timeline.at(-1);
  const durationMs = lastScene
    ? lastScene.delayMs + lastScene.durationMs
    : 0;

  return {
    steps,
    timeline,
    strategyIds,
    finalEquation,
    durationMs,
    // Reduced motion removes travel, not thinking time or narration.
    reducedMotionDurationMs: durationMs,
  };
}

function orientTeachingProofPlan(
  round: Round,
  canonicalPlan: TeachingProofPlan,
): TeachingProofPlan {
  const scaleOrientations = round.equationOrientations.map(
    (orientation) => orientation ?? "standard",
  );
  const orientedSteps: TeachingProofStep[] = [];
  let lastWorkingScaleIndex = 0;

  const orientationForScale = (sourceIndex: number): EquationOrientation =>
    scaleOrientations[sourceIndex] ?? "standard";
  const orientEquationForScale = (
    equation: BalanceEquation,
    sourceIndex: number,
  ): BalanceEquation =>
    orientEquation(equation, orientationForScale(sourceIndex));

  for (const step of canonicalPlan.steps) {
    const workingScaleIndex = step.scaleFocus?.workingScaleIndex ?? 0;
    const workingOrientation = orientationForScale(workingScaleIndex);
    lastWorkingScaleIndex = workingScaleIndex;

    switch (step.kind) {
      case "inspect": {
        orientedSteps.push({
          ...step,
          sources: step.sources.map((source) =>
            orientTeachingSource(
              source,
              orientationForScale(source.sourceIndex),
            ),
          ),
        });
        break;
      }
      case "substitute": {
        const sourceOrientation = orientationForScale(
          step.source.sourceIndex,
        );
        const orientedStep: TeachingSubstituteStep = {
          ...step,
          text: "",
          before: orientEquationForScale(step.before, workingScaleIndex),
          after: orientEquationForScale(step.after, workingScaleIndex),
          source: orientTeachingSource(step.source, sourceOrientation),
          replacement: {
            ...step.replacement,
            side: orientSide(step.replacement.side, workingOrientation),
            sourceFromSide: orientSide(
              step.replacement.sourceFromSide,
              sourceOrientation,
            ),
            sourceToSide: orientSide(
              step.replacement.sourceToSide,
              sourceOrientation,
            ),
          },
        };
        orientedSteps.push({
          ...orientedStep,
          text: orientedSubstitutionText(round, orientedStep),
        });
        break;
      }
      case "add-scales":
      case "subtract-scales": {
        for (const source of step.before) {
          const sourceIndex = source.sourceIndex;
          const sourceOrientation = orientationForScale(sourceIndex);
          if (sourceOrientation === workingOrientation) continue;
          const before = orientEquation(source.equation, sourceOrientation);
          const after = orientEquation(source.equation, workingOrientation);
          const workingNumber = displayedProofScaleNumber(
            round,
            workingScaleIndex,
          );
          const sourceNumber = displayedProofScaleNumber(round, sourceIndex);
          orientedSteps.push({
            id: `${step.id}-align-${sourceIndex + 1}`,
            kind: "reorient-scale",
            title: `Turn scale (${sourceNumber}) around`,
            text: `Scale (${sourceNumber}) is balanced in either direction. Turn it around so its trays line up with scale (${workingNumber}).`,
            strategyId: step.strategyId,
            scaleFocus: {
              workingScaleIndex: sourceIndex,
              sourceScaleIndexes: [workingScaleIndex],
            },
            before,
            after,
          });
          scaleOrientations[sourceIndex] = workingOrientation;
        }
        if (step.kind === "add-scales") {
          const orientedStep: TeachingAddScalesStep = {
            ...step,
            text: "",
            before: step.before.map((source) =>
              orientTeachingSource(source, workingOrientation),
            ),
            after: orientEquation(step.after, workingOrientation),
          };
          orientedSteps.push({
            ...orientedStep,
            text: orientedAddScalesText(round, orientedStep),
          });
        } else {
          const orientedStep: TeachingSubtractScalesStep = {
            ...step,
            text: "",
            before: step.before.map((source) =>
              orientTeachingSource(source, workingOrientation),
            ),
            after: orientEquation(step.after, workingOrientation),
          };
          orientedSteps.push({
            ...orientedStep,
            text: orientedSubtractScalesText(round, orientedStep),
          });
        }
        break;
      }
      case "cancel-matches": {
        const orientedStep: TeachingCancelMatchesStep = {
          ...step,
          text: "",
          before: orientEquation(step.before, workingOrientation),
          after: orientEquation(step.after, workingOrientation),
        };
        orientedSteps.push({
          ...orientedStep,
          text: orientedCancelText(round, orientedStep),
        });
        break;
      }
      case "regroup": {
        const orientedStep: TeachingRegroupStep = {
          ...step,
          text: "",
          before: orientEquation(step.before, workingOrientation),
          after: orientGroupedEquation(step.after, workingOrientation),
        };
        orientedSteps.push({
          ...orientedStep,
          text: orientedRegroupText(round, orientedStep),
        });
        break;
      }
      case "split-evenly": {
        const orientedStep: TeachingSplitEvenlyStep = {
          ...step,
          text: "",
          before:
            "groupCount" in step.before
              ? orientGroupedEquation(step.before, workingOrientation)
              : orientEquation(step.before, workingOrientation),
          after: orientEquation(step.after, workingOrientation),
        };
        orientedSteps.push({
          ...orientedStep,
          text: orientedSplitText(round, orientedStep),
        });
        break;
      }
      case "conclude": {
        const equation = orientEquation(step.equation, workingOrientation);
        orientedSteps.push({
          ...step,
          text: `The balanced scale shows ${equationText(equation)}.`,
          equation,
        });
        break;
      }
      case "reorient-scale": {
        orientedSteps.push(step);
        break;
      }
    }
  }

  const timeline = teachingProofTimeline(orientedSteps);
  const lastScene = timeline.at(-1);
  const durationMs = lastScene
    ? lastScene.delayMs + lastScene.durationMs
    : 0;
  return {
    ...canonicalPlan,
    steps: orientedSteps,
    timeline,
    finalEquation: orientEquation(
      canonicalPlan.finalEquation,
      orientationForScale(lastWorkingScaleIndex),
    ),
    durationMs,
    reducedMotionDurationMs: durationMs,
  };
}

export function buildTeachingProof(round: Round): TeachingProofPlan {
  return orientTeachingProofPlan(
    round,
    buildCanonicalTeachingProof(round),
  );
}

/**
 * Enforces teaching-level guarantees above algebraic validity. A round can
 * have one correct answer yet still make a poor lesson—for example, by
 * displaying the requested creature directly against its answer units, or by
 * attaching a forgotten-division distractor to a proof that never splits.
 */
export function assertSoundTeachingRound(round: Round): TeachingProofPlan {
  if (
    round.question.target.length === 1 &&
    round.question.target[0].count === 1
  ) {
    const target = round.question.target;
    const directlyDisplayed = round.equations.some(({ left, right }) => {
      const leftIsTarget = expressionsMatch(left, target);
      const rightIsTarget = expressionsMatch(right, target);
      const leftIsKnownUnits =
        left.length > 0 &&
        left.every(({ creature }) => creature === round.question.unit);
      const rightIsKnownUnits =
        right.length > 0 &&
        right.every(({ creature }) => creature === round.question.unit);
      return (
        (leftIsTarget && rightIsKnownUnits) ||
        (rightIsTarget && leftIsKnownUnits)
      );
    });
    if (directlyDisplayed) {
      throw new Error(
        "A teaching round must not display a lone requested creature directly against the answer units.",
      );
    }
  }

  const proof = buildTeachingProof(round);
  const splitSteps = proof.steps.filter(
    (step): step is TeachingSplitEvenlyStep =>
      step.kind === "split-evenly",
  );
  for (const step of splitSteps) {
    if (step.divisor <= 1) {
      throw new Error("A teaching round must never suggest dividing by one.");
    }
    if ("groupCount" in step.before) {
      if (step.before.groupCount !== step.divisor) {
        throw new Error(
          "A teaching split must use the number of groups shown.",
        );
      }
      continue;
    }
    if (
      [...step.before.left, ...step.before.right].some(
        ({ count }) => count % step.divisor !== 0,
      )
    ) {
      throw new Error(
        "A teaching split must divide every pictured load evenly.",
      );
    }
  }
  if (
    round.optionKinds.includes("forgot-to-divide") &&
    splitSteps.length === 0
  ) {
    throw new Error(
      "A forgotten-division distractor requires a real split in the proof.",
    );
  }

  return proof;
}

export function hasSoundTeachingRound(round: Round): boolean {
  try {
    assertSoundTeachingRound(round);
    return true;
  } catch {
    return false;
  }
}

export function teachingProofDurationMs(round: Round): number {
  return buildTeachingProof(round).durationMs;
}

/**
 * Executes the round's signed linear certificate into visual proof material.
 * Every expression is rebuilt in BALANCE_TOKENS order so animation geometry is
 * deterministic and never relies on authored expression ordering.
 */
export function buildSolutionProof(round: Round): SolutionProof {
  if (!solutionDerivationMatchesRound(round)) {
    throw new Error("Cannot build a proof from an invalid solution derivation.");
  }

  const equationUses = round.equations.flatMap((equation, sourceIndex) => {
    const multiplier =
      round.solutionDerivation.equationMultipliers[sourceIndex];
    return multiplier === 0
      ? []
      : [prepareEquationUse(equation, multiplier, sourceIndex)];
  });
  const combinedEquation: BalanceEquation = {
    left: addExpressions(
      equationUses.map(({ repeatedEquation }) => repeatedEquation.left),
    ),
    right: addExpressions(
      equationUses.map(({ repeatedEquation }) => repeatedEquation.right),
    ),
  };
  const common = commonExpression(
    combinedEquation.left,
    combinedEquation.right,
  );
  const reducedEquation: BalanceEquation = {
    left: subtractExpression(combinedEquation.left, common),
    right: subtractExpression(combinedEquation.right, common),
  };
  const rightBundle: Expression = [
    {
      creature: round.question.unit,
      count: round.answer,
    },
  ];
  const regroup: SolutionProofRegroup = {
    factor: round.solutionDerivation.normalizeBy,
    targetBundle: expressionFromCounts(
      expressionCounts(round.question.target),
    ),
    rightBundle,
  };
  const finalEquation: BalanceEquation = {
    left: regroup.targetBundle,
    right: regroup.rightBundle,
  };

  const steps: SolutionProofStep[] = equationUses.map((use) => ({
    id: `prepare-${use.sourceIndex + 1}`,
    kind: "prepare-scale",
    text: use.accessibleText,
  }));
  steps.push({
    id: "combine",
    kind: "combine-scales",
    text: `Combine the prepared scales: ${equationText(combinedEquation)}.`,
  });
  steps.push({
    id: "cancel",
    kind: "cancel-matches",
    text:
      common.length === 0
        ? "There are no matching loads to remove from both pans."
        : `Remove ${expressionText(common)} from both pans: ${equationText(
            reducedEquation,
          )}.`,
  });
  steps.push({
    id: "regroup",
    kind: "regroup",
    text:
      regroup.factor === 1
        ? `The remaining left pan is one target bundle: ${equationText(
            finalEquation,
          )}.`
        : `Regroup both pans into ${regroup.factor} matching bundles, then take one: ${equationText(
            finalEquation,
          )}.`,
  });
  steps.push({
    id: "goal",
    kind: "final-goal",
    text: `Answer: ${equationText(finalEquation)}.`,
  });

  return {
    equationUses,
    combinedEquation,
    cancellation: {
      common,
      leftRemoved: common,
      rightRemoved: common,
    },
    reducedEquation,
    regroup,
    finalEquation,
    steps,
    accessibleSteps: steps.map(({ text }) => text),
  };
}
