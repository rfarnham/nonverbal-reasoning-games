import {
  BALANCE_TOKENS,
  BALANCE_TOKEN_NAMES,
  FOUNDATIONAL_STRATEGIES,
  FOUNDATIONAL_STRATEGY_BY_FAMILY,
  SOLUTION_STRATEGIES,
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

type StrategyRound = Pick<
  Round,
  "difficulty" | "family" | "solutionStrategies"
>;

/**
 * Returns lesson parts in one stable curriculum order. Starter rounds teach
 * their concrete balance move rather than prematurely naming substitution.
 * Wizard parts remain available here for post-solve discovery.
 */
export function orderedStrategyIdsForRound(
  round: StrategyRound,
): readonly StrategyId[] {
  if (round.difficulty === "Starter") {
    const foundation = FOUNDATIONAL_STRATEGY_BY_FAMILY[round.family];
    return foundation === undefined ? [] : [foundation];
  }

  const encountered = new Set<SolutionStrategy>(
    round.solutionStrategies,
  );
  return STRATEGY_IDS.filter(
    (id): id is SolutionStrategy =>
      (SOLUTION_STRATEGIES as readonly string[]).includes(id) &&
      encountered.has(id as SolutionStrategy),
  );
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
