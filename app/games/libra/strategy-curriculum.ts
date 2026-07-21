import {
  BALANCE_TOKENS,
  BALANCE_TOKEN_NAMES,
  FOUNDATIONAL_STRATEGIES,
  solutionDerivationMatchesRound,
  type BalanceEquation,
  type BalanceToken,
  type Expression,
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
      "Split both pans into the same number of matching groups.",
  },
  "cancel-matches": {
    id: "cancel-matches",
    section: "foundation",
    name: "Cancel matches",
    shortName: "Cancel",
    symbol: "− = −",
    description:
      "Remove the same matching load from both pans.",
  },
  substitution: {
    id: "substitution",
    section: "solve-plans",
    name: "Substitute equals",
    shortName: "Substitute",
    symbol: "⇄",
    description:
      "Replace a load with another load that is known to balance it.",
  },
  "create-combo": {
    id: "create-combo",
    section: "solve-plans",
    name: "Create a combo",
    shortName: "Combo",
    symbol: "k( )",
    description:
      "Regroup a pan into repeated copies of the target bundle.",
  },
  "add-scales": {
    id: "add-scales",
    section: "solve-plans",
    name: "Add scales",
    shortName: "Add",
    symbol: "+",
    description:
      "Join left pans together and right pans together.",
  },
  "subtract-scales": {
    id: "subtract-scales",
    section: "solve-plans",
    name: "Subtract scales",
    shortName: "Subtract",
    symbol: "−",
    description:
      "Reverse a balanced scale to remove matching loads.",
  },
};

export const STRATEGY_CATALOGUE: readonly StrategyCatalogueEntry[] =
  STRATEGY_IDS.map((id) => STRATEGY_CATALOGUE_BY_ID[id]);

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
  sourceIndex: number | null;
  equation: BalanceEquation;
};

export type TeachingReplacement = {
  side: "left" | "right";
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
  | TeachingAddScalesStep
  | TeachingSubtractScalesStep
  | TeachingCancelMatchesStep
  | TeachingRegroupStep
  | TeachingSplitEvenlyStep
  | TeachingConcludeStep;

export type TeachingProofPlan = {
  steps: readonly TeachingProofStep[];
  strategyIds: readonly StrategyId[];
  finalEquation: BalanceEquation;
  durationMs: number;
  reducedMotionDurationMs: number;
};

export const TEACHING_PROOF_STEP_MS = 1_100;
export const REDUCED_TEACHING_PROOF_MS = 180;

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

function expressionText(expression: Expression): string {
  if (expression.length === 0) return "nothing";
  return expression
    .map(
      ({ creature, count }) =>
        `${count} × ${BALANCE_TOKEN_NAMES[creature]}`,
    )
    .join(" plus ");
}

function equationText(equation: BalanceEquation): string {
  return `${expressionText(equation.left)} balances ${expressionText(
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
  sourceIndex: number | null,
): TeachingEquationSource {
  return {
    sourceIndex,
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

/**
 * Builds the shortest curriculum-approved visual path for a round. Unlike the
 * signed certificate, this plan models the order a learner should actually
 * see: replace equal loads in place, remove only visible matches, and combine
 * whole scales only in families that explicitly teach that move.
 */
export function buildTeachingProof(round: Round): TeachingProofPlan {
  if (!solutionDerivationMatchesRound(round)) {
    throw new Error("Cannot teach an invalid solution derivation.");
  }

  const steps: TeachingProofStep[] = [];
  const equations = round.equations.map(canonicalEquation);
  const finalEquation = goalEquation(round);
  let stepNumber = 0;

  const nextId = (kind: TeachingProofStep["kind"]): string =>
    `${++stepNumber}-${kind}`;
  const source = (
    equation: BalanceEquation,
    sourceIndex: number | null,
  ): TeachingEquationSource => teachingSource(equation, sourceIndex);
  const inspect = (...sourceIndexes: number[]): void => {
    steps.push({
      id: nextId("inspect"),
      kind: "inspect",
      title: sourceIndexes.length === 1 ? "Look at this scale" : "Choose the useful scales",
      text:
        sourceIndexes.length === 1
          ? `Start with scale ${sourceIndexes[0] + 1}: ${equationText(
              equations[sourceIndexes[0]],
            )}.`
          : `Start with scales ${sourceIndexes
              .map((index) => index + 1)
              .join(", ")}.`,
      strategyId: null,
      sources: sourceIndexes.map((index) => source(equations[index], index)),
    });
  };
  const substitute = ({
    before,
    sourceEquation,
    sourceIndex,
    side,
    from,
    to,
    copies = 1,
  }: {
    before: BalanceEquation;
    sourceEquation: BalanceEquation;
    sourceIndex: number | null;
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
    const after = replaceLoad(before, side, from, to, copies);
    assertChanged(before, after, "substitute");
    steps.push({
      id: nextId("substitute"),
      kind: "substitute",
      title: "Replace the equal load",
      text: `On the ${side} pan, replace ${expressionText(
        scaleExpression(from, copies),
      )} with ${expressionText(scaleExpression(to, copies))}.`,
      strategyId: "substitution",
      before: canonicalEquation(before),
      after,
      source: source(sourceEquation, sourceIndex),
      replacement: {
        side,
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
    const after = addEquations(inputs.map(({ equation }) => equation));
    steps.push({
      id: nextId("add-scales"),
      kind: "add-scales",
      title: "Join the two balanced scales",
      text: `Put the left pans together and the right pans together: ${equationText(
        after,
      )}.`,
      strategyId: "add-scales",
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
      title: "Subtract the known scale",
      text: `Remove the second scale's left pan from the first left pan, and its right pan from the first right pan: ${equationText(
        after,
      )}.`,
      strategyId: "subtract-scales",
      before: [minuend, subtrahend],
      after,
    });
    return after;
  };
  const cancelMatches = (
    before: BalanceEquation,
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
    steps.push({
      id: nextId("cancel-matches"),
      kind: "cancel-matches",
      title: "Remove the same load",
      text: `Take ${expressionText(canonicalRemoved)} off both pans: ${equationText(
        after,
      )}.`,
      strategyId: "cancel-matches",
      before: canonicalEquation(before),
      after,
      removed: canonicalRemoved,
    });
    return after;
  };
  const regroupAndSplit = (
    before: BalanceEquation,
    divisor: number,
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
      title: `See ${divisor} matching bundles`,
      text: `Regroup each pan into ${divisor} equal bundles. Each left bundle is ${expressionText(
        grouped.leftBundle,
      )}.`,
      strategyId: "create-combo",
      before: canonicalEquation(before),
      after: grouped,
    });
    steps.push({
      id: nextId("split-evenly"),
      kind: "split-evenly",
      title: `Keep one of the ${divisor} groups`,
      text: `Split both pans into ${divisor} equal groups: ${equationText(
        finalEquation,
      )}.`,
      strategyId: "split-evenly",
      before: grouped,
      after: finalEquation,
      divisor,
    });
    return finalEquation;
  };
  const splitDirectly = (
    before: BalanceEquation,
    divisor: number,
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
      text: `Keep one equal group on each pan: ${equationText(after)}.`,
      strategyId: "split-evenly",
      before: canonicalEquation(before),
      after: canonicalEquation(after),
      divisor,
    });
    return canonicalEquation(after);
  };

  let current: BalanceEquation;
  const targetIsCombo = round.question.target.length > 1;

  switch (round.family) {
    case "direct": {
      inspect(0);
      current = splitDirectly(equations[0], round.solutionDerivation.normalizeBy);
      break;
    }
    case "cancellation": {
      inspect(0);
      current = cancelMatches(equations[0]);
      break;
    }
    case "chain":
    case "offset-chain": {
      inspect(1, 0);
      const bridge = equations[0].left;
      const bridgeReplacement = equations[0].right;
      const bridgeCopies = expressionCounts(equations[1].right)[
        bridge[0].creature
      ];
      current = substitute({
        before: equations[1],
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "right",
        from: bridge,
        to: bridgeReplacement,
        copies: bridgeCopies,
      });
      if (round.family === "offset-chain") {
        current = cancelMatches(current);
      }
      break;
    }
    case "combo-primer": {
      inspect(0);
      current = regroupAndSplit(
        equations[0],
        round.solutionDerivation.normalizeBy,
      );
      break;
    }
    case "add-combo": {
      inspect(0, 1);
      current = addScales([
        source(equations[0], 0),
        source(equations[1], 1),
      ]);
      current = regroupAndSplit(
        current,
        round.solutionDerivation.normalizeBy,
      );
      break;
    }
    case "subtract-combo": {
      inspect(0, 1);
      current = subtractScales(
        source(equations[0], 0),
        source(equations[1], 1),
      );
      current = regroupAndSplit(
        current,
        round.solutionDerivation.normalizeBy,
      );
      break;
    }
    case "fork": {
      inspect(1, 0, 2);
      const firstLink = equations[0].left;
      const firstReplacement = equations[0].right;
      const firstCopies = expressionCounts(equations[1].right)[
        firstLink[0].creature
      ];
      let secondSolved = substitute({
        before: equations[1],
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "right",
        from: firstLink,
        to: firstReplacement,
        copies: firstCopies,
      });
      secondSolved = cancelMatches(secondSolved);

      current = equations[2];
      if (!targetIsCombo) {
        current = substitute({
          before: current,
          sourceEquation: equations[0],
          sourceIndex: 0,
          side: "left",
          from: firstLink,
          to: firstReplacement,
        });
      }
      current = substitute({
        before: current,
        sourceEquation: secondSolved,
        sourceIndex: null,
        side: "right",
        from: secondSolved.left,
        to: secondSolved.right,
      });
      if (!targetIsCombo) current = cancelMatches(current);
      break;
    }
    case "cross": {
      inspect(0, 1, 2);
      const firstSolved = cancelMatches(equations[0]);
      const firstLink = firstSolved.left;
      let secondSolved = substitute({
        before: equations[1],
        sourceEquation: firstSolved,
        sourceIndex: null,
        side: "right",
        from: firstLink,
        to: firstSolved.right,
        copies: expressionCounts(equations[1].right)[firstLink[0].creature],
      });
      secondSolved = cancelMatches(secondSolved);

      current = equations[2];
      if (!targetIsCombo) {
        current = substitute({
          before: current,
          sourceEquation: firstSolved,
          sourceIndex: null,
          side: "left",
          from: firstSolved.left,
          to: firstSolved.right,
        });
      }
      current = substitute({
        before: current,
        sourceEquation: secondSolved,
        sourceIndex: null,
        side: "right",
        from: secondSolved.left,
        to: secondSolved.right,
      });
      if (!targetIsCombo) current = cancelMatches(current);
      break;
    }
    case "parallel": {
      if (targetIsCombo) {
        throw new Error("Composite parallel rounds need an authored teaching path.");
      }
      inspect(2, 0, 1);
      current = substitute({
        before: equations[2],
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "left",
        from: equations[0].left,
        to: equations[0].right,
      });
      current = substitute({
        before: current,
        sourceEquation: equations[1],
        sourceIndex: 1,
        side: "right",
        from: equations[1].left,
        to: equations[1].right,
      });
      current = cancelMatches(current);
      break;
    }
    case "sum-combo": {
      inspect(0, 2, 1);
      current = substitute({
        before: equations[0],
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = addScales([
        source(current, null),
        source(equations[1], 1),
      ]);
      current = regroupAndSplit(
        current,
        round.solutionDerivation.normalizeBy,
      );
      break;
    }
    case "difference": {
      inspect(0, 2, 1);
      current = substitute({
        before: equations[0],
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = subtractScales(
        source(current, null),
        source(equations[1], 1),
      );
      if (round.solutionDerivation.normalizeBy > 1) {
        current = regroupAndSplit(
          current,
          round.solutionDerivation.normalizeBy,
        );
      }
      break;
    }
    case "combo-bridge": {
      inspect(1, 2, 0);
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
        bridgeGoal,
      );
      current = substitute({
        before: equations[0],
        sourceEquation: solvedBridge,
        sourceIndex: null,
        side: "right",
        from: solvedBridge.left,
        to: solvedBridge.right,
      });
      break;
    }
    case "sealed-cancellation": {
      inspect(1, 0, 2);
      current = substitute({
        before: equations[1],
        sourceEquation: equations[0],
        sourceIndex: 0,
        side: "left",
        from: equations[0].right,
        to: equations[0].left,
      });
      current = cancelMatches(current, [
        { creature: "mystery", count: 1 },
      ]);

      const divisor = round.solutionDerivation.normalizeBy;
      if (targetIsCombo) {
        const repeatedBridge = canonicalEquation({
          left: scaleExpression(equations[2].left, divisor - 1),
          right: scaleExpression(equations[2].right, divisor - 1),
        });
        current = addScales([
          source(current, null),
          source(repeatedBridge, 2),
        ]);
      } else {
        current = substitute({
          before: current,
          sourceEquation: equations[2],
          sourceIndex: 2,
          side: "left",
          from: equations[2].left,
          to: equations[2].right,
        });
        current = cancelMatches(current);
      }
      current = regroupAndSplit(current, divisor);
      break;
    }
    case "sealed-sum": {
      inspect(0, 2, 1);
      current = substitute({
        before: equations[0],
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = addScales([
        source(current, null),
        source(equations[1], 1),
      ]);
      current = cancelMatches(current);
      current = regroupAndSplit(
        current,
        round.solutionDerivation.normalizeBy,
      );
      break;
    }
    case "sealed-difference": {
      inspect(0, 2, 1);
      current = substitute({
        before: equations[0],
        sourceEquation: equations[2],
        sourceIndex: 2,
        side: "right",
        from: equations[2].left,
        to: equations[2].right,
      });
      current = subtractScales(
        source(current, null),
        source(equations[1], 1),
      );
      if (round.solutionDerivation.normalizeBy > 1) {
        current = regroupAndSplit(
          current,
          round.solutionDerivation.normalizeBy,
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

  steps.push({
    id: nextId("conclude"),
    kind: "conclude",
    title: "Balanced",
    text: `So ${equationText(finalEquation)}.`,
    strategyId: null,
    equation: finalEquation,
  });

  const strategyIds: StrategyId[] = [];
  for (const step of steps) {
    if (step.strategyId !== null && !strategyIds.includes(step.strategyId)) {
      strategyIds.push(step.strategyId);
    }
  }

  return {
    steps,
    strategyIds,
    finalEquation,
    durationMs: steps.length * TEACHING_PROOF_STEP_MS,
    reducedMotionDurationMs: REDUCED_TEACHING_PROOF_MS,
  };
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
