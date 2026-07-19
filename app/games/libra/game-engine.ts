export const DIFFICULTIES = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

export const CREATURES = [
  "chick",
  "goose",
  "fox",
  "frog",
  "rabbit",
  "turtle",
  "cat",
  "owl",
  "beetle",
  "bear",
] as const;

export type Creature = (typeof CREATURES)[number];

export const MYSTERY_TOKEN = "mystery" as const;
export type MysteryToken = typeof MYSTERY_TOKEN;
export type BalanceToken = Creature | MysteryToken;
export const BALANCE_TOKENS: readonly BalanceToken[] = [
  ...CREATURES,
  MYSTERY_TOKEN,
];

export const CREATURE_NAMES: Readonly<Record<Creature, string>> = {
  chick: "chick",
  goose: "goose",
  fox: "fox",
  frog: "frog",
  rabbit: "rabbit",
  turtle: "turtle",
  cat: "cat",
  owl: "owl",
  beetle: "beetle",
  bear: "bear",
};

export const CREATURE_GLYPHS: Readonly<Record<Creature, string>> = {
  chick: "🐥",
  goose: "🪿",
  fox: "🦊",
  frog: "🐸",
  rabbit: "🐇",
  turtle: "🐢",
  cat: "🐈",
  owl: "🦉",
  beetle: "🪲",
  bear: "🐻",
};

export const BALANCE_TOKEN_NAMES: Readonly<Record<BalanceToken, string>> = {
  ...CREATURE_NAMES,
  mystery: "sealed load",
};

export type CreatureGroup = {
  creature: BalanceToken;
  count: number;
};

export type Expression = readonly CreatureGroup[];

export type BalanceEquation = {
  left: Expression;
  right: Expression;
};

export type BalanceQuestion = {
  target: Expression;
  unit: Creature;
};

export type RuleFamily =
  | "direct"
  | "cancellation"
  | "chain"
  | "offset-chain"
  | "combo-primer"
  | "add-combo"
  | "subtract-combo"
  | "fork"
  | "cross"
  | "parallel"
  | "sum-combo"
  | "difference"
  | "combo-bridge"
  | "sealed-cancellation"
  | "sealed-sum"
  | "sealed-difference";

export const SOLUTION_STRATEGIES = [
  "substitution",
  "add-scales",
  "subtract-scales",
  "create-combo",
] as const;

export type SolutionStrategy = (typeof SOLUTION_STRATEGIES)[number];

export const FOUNDATIONAL_STRATEGIES = [
  "split-evenly",
  "cancel-matches",
] as const;

export type FoundationalStrategy = (typeof FOUNDATIONAL_STRATEGIES)[number];

/**
 * Starter rounds teach these concrete balance moves before the four multi-scale
 * solution archetypes. `Round.solutionStrategies` stays API-compatible with
 * the established four-strategy union; curriculum UI should use this mapping
 * for Starter instead of presenting those rounds as substitution.
 */
export const FOUNDATIONAL_STRATEGY_BY_FAMILY: Readonly<
  Partial<Record<RuleFamily, FoundationalStrategy>>
> = {
  direct: "split-evenly",
  cancellation: "cancel-matches",
};

export type SolutionDerivation = {
  equationMultipliers: readonly number[];
  normalizeBy: number;
};

export type DistractorKind =
  | "off-by-one"
  | "forgot-to-normalize"
  | "missed-cancellation"
  | "stopped-at-link"
  | "added-links"
  | "ignored-group"
  | "double-counted"
  | "reversed-relation"
  | "used-one-scale"
  | "added-instead-of-subtracting"
  | "forgot-to-divide";

export type OptionKind = "correct" | DistractorKind;

export type AnswerOption = {
  creature: Creature;
  count: number;
  kind: OptionKind;
};

export type EquationPathScaffold = {
  kind: "equation-path";
  equationOrder: readonly number[];
};

export type Round = {
  id: string;
  difficulty: Difficulty;
  family: RuleFamily;
  equations: readonly BalanceEquation[];
  question: BalanceQuestion;
  options: readonly AnswerOption[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
  answer: number;
  solutionStrategies: readonly SolutionStrategy[];
  solutionDerivation: SolutionDerivation;
  scaffold: EquationPathScaffold | null;
  feedbackPolicy: "explain-difference" | "preserve-inference";
};

export type RoundValidation = {
  valid: boolean;
  errors: readonly string[];
  derivedAnswer: number | null;
  relativeWeights: Readonly<Partial<Record<BalanceToken, number>>> | null;
  freeVariableCount: number | null;
  answerInvariant: boolean;
  hasPositiveSolution: boolean;
};

type RandomSource = () => number;

type MistakeCandidate = {
  count: number;
  kind: DistractorKind;
};

type TemplateResult = {
  family: RuleFamily;
  equations: readonly BalanceEquation[];
  question: BalanceQuestion;
  equationOrder: readonly number[];
  solutionStrategies: readonly SolutionStrategy[];
  solutionDerivation: SolutionDerivation;
  mistakes: readonly MistakeCandidate[];
};

type StarterSpec = {
  difficulty: "Starter";
  family: "direct" | "cancellation";
  creatures: readonly [Creature, Creature];
  answer: number;
  multiplier: number;
  offset: number;
  correctIndex: number;
};

type JuniorSpec =
  | {
      difficulty: "Junior";
      family: "chain" | "offset-chain";
      creatures: readonly [Creature, Creature, Creature];
      bridgeWeight: number;
      multiplier: number;
      offset: number;
      correctIndex: number;
    }
  | {
      difficulty: "Junior";
      family: "combo-primer";
      creatures: readonly [Creature, Creature, Creature];
      firstWeight: number;
      secondWeight: number;
      coefficient: number;
      checkCoefficients: readonly [number, number];
      correctIndex: number;
    }
  | {
      difficulty: "Junior";
      family: "add-combo";
      creatures: readonly [Creature, Creature, Creature];
      firstWeight: number;
      secondWeight: number;
      coefficient: number;
      correctIndex: number;
    }
  | {
      difficulty: "Junior";
      family: "subtract-combo";
      creatures: readonly [Creature, Creature, Creature];
      firstWeight: number;
      secondWeight: number;
      coefficient: number;
      correctIndex: number;
    };

type AdvancedFamilySpec =
  | {
      family: "fork";
      parameters: readonly [number, number, number, number];
      composite: boolean;
    }
  | {
      family: "cross";
      parameters: readonly [number, number, number];
      composite: boolean;
    }
  | {
      family: "parallel";
      parameters: readonly [number, number, number];
      composite: boolean;
    }
  | {
      family: "sum-combo";
      parameters: readonly [number, number, number];
    }
  | {
      family: "difference";
      parameters: readonly [number, number, number];
    }
  | {
      family: "combo-bridge";
      parameters: readonly [number, number, number];
    };

type ExpertSpec = AdvancedFamilySpec & {
  difficulty: "Expert";
  creatures: readonly [Creature, Creature, Creature, Creature];
  correctIndex: number;
};

type WizardSpec =
  | {
      difficulty: "Wizard";
      family: "sealed-cancellation";
      creatures: readonly [Creature, Creature, Creature, Creature];
      targetMultiplier: number;
      targetWeight: number;
      bridgeWeight: number;
      composite: boolean;
      correctIndex: number;
    }
  | {
      difficulty: "Wizard";
      family: "sealed-sum";
      creatures: readonly [Creature, Creature, Creature, Creature];
      coefficient: number;
      firstWeight: number;
      secondWeight: number;
      mysteryWeight: number;
      composite: boolean;
      correctIndex: number;
    }
  | {
      difficulty: "Wizard";
      family: "sealed-difference";
      creatures: readonly [Creature, Creature, Creature, Creature];
      coefficient: number;
      firstWeight: number;
      secondWeight: number;
      mysteryWeight: number;
      composite: boolean;
      correctIndex: number;
    };

type AdvancedSpec = ExpertSpec | WizardSpec;

type CampaignSpec = StarterSpec | JuniorSpec | AdvancedSpec;

type JuniorBlueprint = JuniorSpec extends infer Spec
  ? Spec extends JuniorSpec
    ? Omit<Spec, "correctIndex">
    : never
  : never;

type WizardBlueprint = WizardSpec extends infer Spec
  ? Spec extends WizardSpec
    ? Omit<Spec, "creatures" | "correctIndex">
    : never
  : never;

type Fraction = {
  numerator: number;
  denominator: number;
};

type AffineForm = {
  constant: Fraction;
  freeCoefficients: readonly Fraction[];
};

type LinearSystemAnalysis = {
  tokens: readonly BalanceToken[];
  forms: readonly AffineForm[];
  freeVariableCount: number;
  consistent: boolean;
};

export type BalanceQuestionAnalysis = {
  answer: number | null;
  answerInvariant: boolean;
  freeVariableCount: number;
  hasPositiveSolution: boolean;
  knownWeights: Readonly<Partial<Record<BalanceToken, number>>>;
};

const ZERO: Fraction = { numerator: 0, denominator: 1 };
const ONE: Fraction = { numerator: 1, denominator: 1 };

const EQUATION_COUNTS: Readonly<Record<Difficulty, number>> = {
  Starter: 1,
  Junior: 2,
  Expert: 3,
  Wizard: 3,
};

const CREATURE_COUNTS: Readonly<Record<Difficulty, number>> = {
  Starter: 2,
  Junior: 3,
  Expert: 4,
  Wizard: 4,
};

export const GENERATOR_MAX_ATTEMPTS = 128;

const ANSWER_POSITIONS: Readonly<Record<Difficulty, readonly number[]>> = {
  Starter: [0, 2, 1, 3, 2, 0, 3, 1, 0, 3, 2, 1],
  Junior: [1, 3, 0, 2, 3, 1, 2, 0, 2, 0, 3, 1],
  Expert: [2, 0, 3, 1, 0, 2, 1, 3, 1, 3, 0, 2],
  Wizard: [3, 1, 2, 0, 1, 3, 0, 2, 0, 2, 1, 3],
};

const STARTER_SPECS: readonly Omit<StarterSpec, "correctIndex">[] = [
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["goose", "chick"],
    answer: 4,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["fox", "frog"],
    answer: 3,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["rabbit", "turtle"],
    answer: 2,
    multiplier: 3,
    offset: 0,
  },
  {
    difficulty: "Starter",
    family: "cancellation",
    creatures: ["owl", "beetle"],
    answer: 5,
    multiplier: 1,
    offset: 2,
  },
  {
    difficulty: "Starter",
    family: "cancellation",
    creatures: ["cat", "chick"],
    answer: 6,
    multiplier: 1,
    offset: 1,
  },
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["bear", "frog"],
    answer: 3,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Starter",
    family: "cancellation",
    creatures: ["turtle", "beetle"],
    answer: 4,
    multiplier: 1,
    offset: 3,
  },
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["goose", "rabbit"],
    answer: 2,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Starter",
    family: "cancellation",
    creatures: ["fox", "chick"],
    answer: 7,
    multiplier: 1,
    offset: 1,
  },
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["owl", "frog"],
    answer: 4,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Starter",
    family: "cancellation",
    creatures: ["bear", "turtle"],
    answer: 5,
    multiplier: 1,
    offset: 1,
  },
  {
    difficulty: "Starter",
    family: "direct",
    creatures: ["cat", "beetle"],
    answer: 3,
    multiplier: 2,
    offset: 0,
  },
];

const JUNIOR_SPECS: readonly JuniorBlueprint[] = [
  {
    difficulty: "Junior",
    family: "chain",
    creatures: ["goose", "fox", "chick"],
    bridgeWeight: 2,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Junior",
    family: "chain",
    creatures: ["owl", "rabbit", "frog"],
    bridgeWeight: 3,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Junior",
    family: "chain",
    creatures: ["bear", "cat", "beetle"],
    bridgeWeight: 2,
    multiplier: 3,
    offset: 0,
  },
  {
    difficulty: "Junior",
    family: "chain",
    creatures: ["fox", "turtle", "chick"],
    bridgeWeight: 4,
    multiplier: 2,
    offset: 0,
  },
  {
    difficulty: "Junior",
    family: "offset-chain",
    creatures: ["rabbit", "goose", "frog"],
    bridgeWeight: 3,
    multiplier: 2,
    offset: 1,
  },
  {
    difficulty: "Junior",
    family: "offset-chain",
    creatures: ["cat", "owl", "chick"],
    bridgeWeight: 2,
    multiplier: 3,
    offset: 1,
  },
  {
    difficulty: "Junior",
    family: "offset-chain",
    creatures: ["turtle", "bear", "beetle"],
    bridgeWeight: 4,
    multiplier: 2,
    offset: 2,
  },
  {
    difficulty: "Junior",
    family: "combo-primer",
    creatures: ["cat", "bear", "beetle"],
    firstWeight: 2,
    secondWeight: 2,
    coefficient: 2,
    checkCoefficients: [1, 2],
  },
  {
    difficulty: "Junior",
    family: "combo-primer",
    creatures: ["goose", "fox", "chick"],
    firstWeight: 1,
    secondWeight: 1,
    coefficient: 3,
    checkCoefficients: [1, 3],
  },
  {
    difficulty: "Junior",
    family: "combo-primer",
    creatures: ["rabbit", "turtle", "frog"],
    firstWeight: 1,
    secondWeight: 1,
    coefficient: 4,
    checkCoefficients: [3, 1],
  },
  {
    difficulty: "Junior",
    family: "add-combo",
    creatures: ["cat", "goose", "beetle"],
    firstWeight: 2,
    secondWeight: 3,
    coefficient: 2,
  },
  {
    difficulty: "Junior",
    family: "subtract-combo",
    creatures: ["fox", "owl", "frog"],
    firstWeight: 1,
    secondWeight: 1,
    coefficient: 2,
  },
];

const ADVANCED_BLUEPRINTS: readonly AdvancedFamilySpec[] = [
  { family: "fork", parameters: [2, 2, 1, 3], composite: false },
  { family: "cross", parameters: [1, 4, 2], composite: false },
  { family: "parallel", parameters: [3, 5, 2], composite: false },
  { family: "sum-combo", parameters: [1, 2, 2] },
  { family: "sum-combo", parameters: [2, 1, 2] },
  { family: "sum-combo", parameters: [2, 2, 2] },
  { family: "difference", parameters: [2, 1, 2] },
  { family: "difference", parameters: [2, 1, 3] },
  { family: "difference", parameters: [1, 2, 3] },
  { family: "combo-bridge", parameters: [1, 1, 2] },
  { family: "combo-bridge", parameters: [1, 2, 2] },
  { family: "combo-bridge", parameters: [2, 1, 2] },
];

const WIZARD_BLUEPRINTS: readonly WizardBlueprint[] = [
  {
    difficulty: "Wizard",
    family: "sealed-cancellation",
    targetMultiplier: 2,
    targetWeight: 2,
    bridgeWeight: 2,
    composite: false,
  },
  {
    difficulty: "Wizard",
    family: "sealed-cancellation",
    targetMultiplier: 3,
    targetWeight: 2,
    bridgeWeight: 1,
    composite: false,
  },
  {
    difficulty: "Wizard",
    family: "sealed-cancellation",
    targetMultiplier: 2,
    targetWeight: 3,
    bridgeWeight: 1,
    composite: false,
  },
  {
    difficulty: "Wizard",
    family: "sealed-sum",
    coefficient: 2,
    firstWeight: 2,
    secondWeight: 2,
    mysteryWeight: 1,
    composite: false,
  },
  {
    difficulty: "Wizard",
    family: "sealed-sum",
    coefficient: 3,
    firstWeight: 1,
    secondWeight: 1,
    mysteryWeight: 1,
    composite: false,
  },
  {
    difficulty: "Wizard",
    family: "sealed-sum",
    coefficient: 2,
    firstWeight: 2,
    secondWeight: 1,
    mysteryWeight: 1,
    composite: false,
  },
  {
    difficulty: "Wizard",
    family: "sealed-sum",
    coefficient: 2,
    firstWeight: 1,
    secondWeight: 2,
    mysteryWeight: 1,
    composite: true,
  },
  {
    difficulty: "Wizard",
    family: "sealed-sum",
    coefficient: 2,
    firstWeight: 2,
    secondWeight: 1,
    mysteryWeight: 1,
    composite: true,
  },
  {
    difficulty: "Wizard",
    family: "sealed-sum",
    coefficient: 3,
    firstWeight: 1,
    secondWeight: 1,
    mysteryWeight: 1,
    composite: true,
  },
  {
    difficulty: "Wizard",
    family: "sealed-difference",
    coefficient: 2,
    firstWeight: 1,
    secondWeight: 1,
    mysteryWeight: 1,
    composite: true,
  },
  {
    difficulty: "Wizard",
    family: "sealed-difference",
    coefficient: 2,
    firstWeight: 1,
    secondWeight: 2,
    mysteryWeight: 1,
    composite: true,
  },
  {
    difficulty: "Wizard",
    family: "sealed-difference",
    coefficient: 3,
    firstWeight: 1,
    secondWeight: 1,
    mysteryWeight: 1,
    composite: true,
  },
];

const EXPERT_CREATURES: readonly (readonly [
  Creature,
  Creature,
  Creature,
  Creature,
])[] = [
  ["goose", "fox", "rabbit", "chick"],
  ["owl", "cat", "turtle", "frog"],
  ["bear", "goose", "beetle", "chick"],
  ["fox", "rabbit", "owl", "turtle"],
  ["cat", "bear", "frog", "beetle"],
  ["rabbit", "turtle", "goose", "chick"],
  ["owl", "fox", "cat", "frog"],
  ["bear", "rabbit", "turtle", "beetle"],
  ["goose", "owl", "fox", "chick"],
  ["cat", "turtle", "bear", "frog"],
  ["rabbit", "goose", "owl", "beetle"],
  ["fox", "bear", "cat", "turtle"],
];

const WIZARD_CREATURES: readonly (readonly [
  Creature,
  Creature,
  Creature,
  Creature,
])[] = [
  ["owl", "rabbit", "cat", "beetle"],
  ["bear", "fox", "goose", "turtle"],
  ["cat", "owl", "rabbit", "frog"],
  ["goose", "bear", "fox", "chick"],
  ["turtle", "cat", "owl", "beetle"],
  ["fox", "goose", "bear", "frog"],
  ["rabbit", "turtle", "cat", "chick"],
  ["owl", "bear", "goose", "beetle"],
  ["cat", "fox", "rabbit", "frog"],
  ["turtle", "owl", "bear", "chick"],
  ["goose", "cat", "fox", "beetle"],
  ["bear", "rabbit", "owl", "turtle"],
];

function greatestCommonDivisor(first: number, second: number): number {
  let left = Math.abs(first);
  let right = Math.abs(second);
  while (right !== 0) {
    [left, right] = [right, left % right];
  }
  return left || 1;
}

function fraction(numerator: number, denominator = 1): Fraction {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator === 0
  ) {
    throw new Error("Fractions require safe integer values and a nonzero denominator.");
  }
  if (numerator === 0) return ZERO;
  const sign = denominator < 0 ? -1 : 1;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (sign * numerator) / divisor,
    denominator: Math.abs(denominator) / divisor,
  };
}

function addFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator +
      right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtractFractions(left: Fraction, right: Fraction): Fraction {
  return addFractions(
    left,
    fraction(-right.numerator, right.denominator),
  );
}

function multiplyFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function divideFractions(left: Fraction, right: Fraction): Fraction {
  if (right.numerator === 0) throw new Error("Cannot divide by zero.");
  return fraction(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

function isZero(value: Fraction): boolean {
  return value.numerator === 0;
}

function toNumber(value: Fraction): number {
  return value.numerator / value.denominator;
}

function isCreature(value: string): value is Creature {
  return (CREATURES as readonly string[]).includes(value);
}

function isBalanceToken(value: string): value is BalanceToken {
  return value === MYSTERY_TOKEN || isCreature(value);
}

export function makeExpression(
  ...groups: readonly (readonly [BalanceToken, number])[]
): Expression {
  const counts = new Map<BalanceToken, number>();
  for (const [creature, count] of groups) {
    if (!isBalanceToken(creature)) {
      throw new Error(`Unknown balance token: ${creature}`);
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("Creature counts must be positive integers.");
    }
    counts.set(creature, (counts.get(creature) ?? 0) + count);
  }
  return BALANCE_TOKENS.flatMap((creature) => {
    const count = counts.get(creature);
    return count === undefined ? [] : [{ creature, count }];
  });
}

export function expressionKey(expression: Expression): string {
  return makeExpression(
    ...expression.map(({ creature, count }) => [creature, count] as const),
  )
    .map(({ creature, count }) => `${creature}:${count}`)
    .join("+");
}

export function expressionItemCount(expression: Expression): number {
  return expression.reduce((total, group) => total + group.count, 0);
}

function equationCoefficients(
  equation: BalanceEquation,
): Readonly<Record<BalanceToken, number>> {
  const coefficients = Object.fromEntries(
    BALANCE_TOKENS.map((creature) => [creature, 0]),
  ) as Record<BalanceToken, number>;
  for (const { creature, count } of equation.left) {
    coefficients[creature] += count;
  }
  for (const { creature, count } of equation.right) {
    coefficients[creature] -= count;
  }
  return coefficients;
}

export function canonicalEquationKey(equation: BalanceEquation): string {
  const coefficients = equationCoefficients(equation);
  const nonzero = BALANCE_TOKENS.flatMap((creature) => {
    const coefficient = coefficients[creature];
    return coefficient === 0 ? [] : [[creature, coefficient] as const];
  });
  if (nonzero.length === 0) return "identity";
  const divisor = nonzero.reduce(
    (current, [, coefficient]) =>
      greatestCommonDivisor(current, coefficient),
    0,
  );
  const sign = nonzero[0][1] < 0 ? -1 : 1;
  return nonzero
    .map(
      ([creature, coefficient]) =>
        `${creature}:${(sign * coefficient) / divisor}`,
    )
    .join("|");
}

function involvedTokens(
  equations: readonly BalanceEquation[],
  question: BalanceQuestion,
): readonly BalanceToken[] {
  const values = new Set<BalanceToken>([question.unit]);
  for (const { creature } of question.target) values.add(creature);
  for (const equation of equations) {
    for (const { creature } of equation.left) values.add(creature);
    for (const { creature } of equation.right) values.add(creature);
  }
  return BALANCE_TOKENS.filter((creature) => values.has(creature));
}

function analyzeLinearSystem(
  equations: readonly BalanceEquation[],
  question: BalanceQuestion,
): LinearSystemAnalysis {
  const tokens = involvedTokens(equations, question);
  const augmented = equations.map((equation) => {
    const coefficients = equationCoefficients(equation);
    return [
      ...tokens.map((token) => fraction(coefficients[token])),
      ZERO,
    ];
  });
  augmented.push([
    ...tokens.map((token) => (token === question.unit ? ONE : ZERO)),
    ONE,
  ]);

  let pivotRow = 0;
  const pivotColumns: number[] = [];
  for (
    let column = 0;
    column < tokens.length && pivotRow < augmented.length;
    column += 1
  ) {
    const candidateRow = augmented.findIndex(
      (row, index) => index >= pivotRow && !isZero(row[column]),
    );
    if (candidateRow === -1) continue;
    [augmented[pivotRow], augmented[candidateRow]] = [
      augmented[candidateRow],
      augmented[pivotRow],
    ];

    const pivot = augmented[pivotRow][column];
    augmented[pivotRow] = augmented[pivotRow].map((value) =>
      divideFractions(value, pivot),
    );

    for (let row = 0; row < augmented.length; row += 1) {
      if (row === pivotRow || isZero(augmented[row][column])) continue;
      const factor = augmented[row][column];
      augmented[row] = augmented[row].map((value, entryIndex) =>
        subtractFractions(
          value,
          multiplyFractions(factor, augmented[pivotRow][entryIndex]),
        ),
      );
    }
    pivotColumns.push(column);
    pivotRow += 1;
  }

  const inconsistent = augmented.some(
    (row) =>
      row.slice(0, tokens.length).every(isZero) &&
      !isZero(row[tokens.length]),
  );
  if (inconsistent) {
    return {
      tokens,
      forms: [],
      freeVariableCount: 0,
      consistent: false,
    };
  }

  const freeColumns = Array.from(
    { length: tokens.length },
    (_, index) => index,
  ).filter((column) => !pivotColumns.includes(column));
  const forms = tokens.map((_, column): AffineForm => {
    const freeIndex = freeColumns.indexOf(column);
    if (freeIndex !== -1) {
      return {
        constant: ZERO,
        freeCoefficients: freeColumns.map((__, index) =>
          index === freeIndex ? ONE : ZERO,
        ),
      };
    }
    const row = pivotColumns.indexOf(column);
    return {
      constant: augmented[row][tokens.length],
      freeCoefficients: freeColumns.map((freeColumn) => {
        const coefficient = augmented[row][freeColumn];
        return fraction(-coefficient.numerator, coefficient.denominator);
      }),
    };
  });

  return {
    tokens,
    forms,
    freeVariableCount: freeColumns.length,
    consistent: true,
  };
}

function addAffineForms(
  left: AffineForm,
  right: AffineForm,
): AffineForm {
  return {
    constant: addFractions(left.constant, right.constant),
    freeCoefficients: left.freeCoefficients.map((value, index) =>
      addFractions(value, right.freeCoefficients[index]),
    ),
  };
}

function scaleAffineForm(form: AffineForm, scale: number): AffineForm {
  const factor = fraction(scale);
  return {
    constant: multiplyFractions(form.constant, factor),
    freeCoefficients: form.freeCoefficients.map((value) =>
      multiplyFractions(value, factor),
    ),
  };
}

function expressionAffineForm(
  expression: Expression,
  analysis: LinearSystemAnalysis,
): AffineForm | null {
  if (!analysis.consistent) return null;
  let result: AffineForm = {
    constant: ZERO,
    freeCoefficients: Array.from(
      { length: analysis.freeVariableCount },
      () => ZERO,
    ),
  };
  for (const { creature, count } of expression) {
    const index = analysis.tokens.indexOf(creature);
    if (index === -1) return null;
    result = addAffineForms(
      result,
      scaleAffineForm(analysis.forms[index], count),
    );
  }
  return result;
}

function hasPositiveAffineSolution(analysis: LinearSystemAnalysis): boolean {
  if (!analysis.consistent) return false;
  if (analysis.freeVariableCount === 0) {
    return analysis.forms.every(({ constant }) => toNumber(constant) > 0);
  }
  if (analysis.freeVariableCount === 1) {
    let lowerBound = 0;
    let upperBound = Number.POSITIVE_INFINITY;
    for (const form of analysis.forms) {
      const constant = toNumber(form.constant);
      const coefficient = toNumber(form.freeCoefficients[0]);
      if (coefficient === 0) {
        if (constant <= 0) return false;
        continue;
      }
      const boundary = -constant / coefficient;
      if (coefficient > 0) lowerBound = Math.max(lowerBound, boundary);
      else upperBound = Math.min(upperBound, boundary);
    }
    return upperBound > Math.max(0, lowerBound);
  }

  const samples = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
  const assignments: number[][] = [[]];
  for (let index = 0; index < analysis.freeVariableCount; index += 1) {
    const expanded = assignments.flatMap((prefix) =>
      samples.map((value) => [...prefix, value]),
    );
    assignments.splice(0, assignments.length, ...expanded);
    if (assignments.length > 32_768) return false;
  }
  return assignments.some((assignment) =>
    analysis.forms.every((form) => {
      const value = form.freeCoefficients.reduce(
        (total, coefficient, index) =>
          total + toNumber(coefficient) * assignment[index],
        toNumber(form.constant),
      );
      return value > 0;
    }),
  );
}

export function analyzeBalanceQuestion(
  equations: readonly BalanceEquation[],
  question: BalanceQuestion,
): BalanceQuestionAnalysis {
  const analysis = analyzeLinearSystem(equations, question);
  const targetForm = expressionAffineForm(question.target, analysis);
  const answerInvariant =
    targetForm !== null &&
    targetForm.freeCoefficients.every((coefficient) => isZero(coefficient));
  const candidateAnswer =
    answerInvariant && targetForm ? toNumber(targetForm.constant) : null;
  const answer =
    candidateAnswer !== null &&
    Number.isInteger(candidateAnswer) &&
    candidateAnswer > 0
      ? candidateAnswer
      : null;
  const knownWeights: Partial<Record<BalanceToken, number>> = {};
  if (analysis.consistent) {
    analysis.forms.forEach((form, index) => {
      if (form.freeCoefficients.every(isZero)) {
        knownWeights[analysis.tokens[index]] = toNumber(form.constant);
      }
    });
  }
  return {
    answer,
    answerInvariant,
    freeVariableCount: analysis.freeVariableCount,
    hasPositiveSolution: hasPositiveAffineSolution(analysis),
    knownWeights,
  };
}

export function deriveRelativeWeights(
  equations: readonly BalanceEquation[],
  unit: Creature,
): Readonly<Partial<Record<BalanceToken, number>>> | null {
  const question: BalanceQuestion = {
    target: makeExpression([unit, 1]),
    unit,
  };
  const analysis = analyzeBalanceQuestion(equations, question);
  return analysis.hasPositiveSolution ? analysis.knownWeights : null;
}

export function expressionWeight(
  expression: Expression,
  weights: Readonly<Partial<Record<BalanceToken, number>>>,
): number {
  return expression.reduce((total, { creature, count }) => {
    const weight = weights[creature];
    if (weight === undefined) {
      throw new Error(`No relative weight is available for ${creature}.`);
    }
    return total + count * weight;
  }, 0);
}

export function calculateAnswer(
  equations: readonly BalanceEquation[],
  question: BalanceQuestion,
): number | null {
  const analysis = analyzeBalanceQuestion(equations, question);
  return analysis.hasPositiveSolution && analysis.answerInvariant
    ? analysis.answer
    : null;
}

function makeEquation(
  left: Expression,
  right: Expression,
): BalanceEquation {
  return { left, right };
}

function makeStarterTemplate(spec: StarterSpec): TemplateResult {
  const [target, unit] = spec.creatures;
  const question = {
    target: makeExpression([target, 1]),
    unit,
  } as const;

  if (spec.family === "direct") {
    const rawPanCount = spec.multiplier * spec.answer;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression([target, spec.multiplier]),
          makeExpression([unit, rawPanCount]),
        ),
      ],
      question,
      equationOrder: [0],
      solutionStrategies: ["substitution"],
      solutionDerivation: {
        equationMultipliers: [1],
        normalizeBy: spec.multiplier,
      },
      mistakes: [
        { count: rawPanCount, kind: "forgot-to-normalize" },
        {
          count: Math.abs(rawPanCount - spec.multiplier),
          kind: "missed-cancellation",
        },
        { count: spec.multiplier, kind: "reversed-relation" },
      ],
    };
  }

  return {
    family: spec.family,
    equations: [
      makeEquation(
        makeExpression([target, 1], [unit, spec.offset]),
        makeExpression([unit, spec.answer + spec.offset]),
      ),
    ],
    question,
    equationOrder: [0],
    solutionStrategies: ["substitution"],
    solutionDerivation: {
      equationMultipliers: [1],
      normalizeBy: 1,
    },
    mistakes: [
      {
        count: spec.answer + spec.offset,
        kind: "missed-cancellation",
      },
      {
        count: Math.max(1, spec.answer - spec.offset),
        kind: "missed-cancellation",
      },
      { count: spec.offset, kind: "reversed-relation" },
    ],
  };
}

function makeJuniorTemplate(spec: JuniorSpec): TemplateResult {
  const [target, bridge, unit] = spec.creatures;

  if (spec.family === "combo-primer") {
    const comboTotal =
      spec.coefficient * (spec.firstWeight + spec.secondWeight);
    const [targetCheckCount, bridgeCheckCount] = spec.checkCoefficients;
    const checkTotal =
      targetCheckCount * spec.firstWeight +
      bridgeCheckCount * spec.secondWeight;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression(
            [target, spec.coefficient],
            [bridge, spec.coefficient],
          ),
          makeExpression([unit, comboTotal]),
        ),
        makeEquation(
          makeExpression(
            [target, targetCheckCount],
            [bridge, bridgeCheckCount],
          ),
          makeExpression([unit, checkTotal]),
        ),
      ],
      question: {
        target: makeExpression([target, 1], [bridge, 1]),
        unit,
      },
      equationOrder: [0, 1],
      solutionStrategies: ["create-combo"],
      solutionDerivation: {
        equationMultipliers: [1, 0],
        normalizeBy: spec.coefficient,
      },
      mistakes: [
        { count: comboTotal, kind: "forgot-to-divide" },
        { count: checkTotal, kind: "used-one-scale" },
        { count: spec.coefficient, kind: "forgot-to-normalize" },
      ],
    };
  }

  if (spec.family === "add-combo") {
    const firstTotal =
      spec.coefficient * spec.firstWeight + spec.secondWeight;
    const secondTotal =
      spec.firstWeight + spec.coefficient * spec.secondWeight;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression(
            [target, spec.coefficient],
            [bridge, 1],
          ),
          makeExpression([unit, firstTotal]),
        ),
        makeEquation(
          makeExpression(
            [target, 1],
            [bridge, spec.coefficient],
          ),
          makeExpression([unit, secondTotal]),
        ),
      ],
      question: {
        target: makeExpression([target, 1], [bridge, 1]),
        unit,
      },
      equationOrder: [0, 1],
      solutionStrategies: ["add-scales", "create-combo"],
      solutionDerivation: {
        equationMultipliers: [1, 1],
        normalizeBy: spec.coefficient + 1,
      },
      mistakes: [
        { count: firstTotal, kind: "used-one-scale" },
        { count: secondTotal, kind: "used-one-scale" },
        {
          count: firstTotal + secondTotal,
          kind: "forgot-to-divide",
        },
        {
          count: Math.abs(firstTotal - secondTotal),
          kind: "added-instead-of-subtracting",
        },
      ],
    };
  }

  if (spec.family === "subtract-combo") {
    const total =
      (spec.coefficient + 1) * spec.firstWeight +
      (spec.coefficient + 2) * spec.secondWeight;
    const knownTotal =
      spec.firstWeight + 2 * spec.secondWeight;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression(
            [target, spec.coefficient + 1],
            [bridge, spec.coefficient + 2],
          ),
          makeExpression([unit, total]),
        ),
        makeEquation(
          makeExpression([target, 1], [bridge, 2]),
          makeExpression([unit, knownTotal]),
        ),
      ],
      question: {
        target: makeExpression([target, 1], [bridge, 1]),
        unit,
      },
      equationOrder: [0, 1],
      solutionStrategies: ["subtract-scales", "create-combo"],
      solutionDerivation: {
        equationMultipliers: [1, -1],
        normalizeBy: spec.coefficient,
      },
      mistakes: [
        { count: total, kind: "used-one-scale" },
        {
          count: total - knownTotal,
          kind: "forgot-to-divide",
        },
        { count: knownTotal, kind: "ignored-group" },
        {
          count: total + knownTotal,
          kind: "added-instead-of-subtracting",
        },
      ],
    };
  }

  const product = spec.bridgeWeight * spec.multiplier;
  const answer =
    spec.family === "offset-chain" ? product - spec.offset : product;
  const first = makeEquation(
    makeExpression([bridge, 1]),
    makeExpression([unit, spec.bridgeWeight]),
  );
  const second =
    spec.family === "chain"
      ? makeEquation(
          makeExpression([target, 1]),
          makeExpression([bridge, spec.multiplier]),
        )
      : makeEquation(
          makeExpression([target, 1], [unit, spec.offset]),
          makeExpression([bridge, spec.multiplier]),
        );

  return {
    family: spec.family,
    equations: [first, second],
    question: {
      target: makeExpression([target, 1]),
      unit,
    },
    equationOrder: [0, 1],
    solutionStrategies: ["substitution"],
    solutionDerivation: {
      equationMultipliers: [spec.multiplier, 1],
      normalizeBy: 1,
    },
    mistakes: [
      {
        count: spec.bridgeWeight,
        kind: "stopped-at-link",
      },
      {
        count: spec.bridgeWeight + spec.multiplier,
        kind: "added-links",
      },
      {
        count: product,
        kind:
          spec.family === "offset-chain"
            ? "missed-cancellation"
            : "double-counted",
      },
      {
        count: Math.max(1, answer - spec.bridgeWeight),
        kind: "reversed-relation",
      },
    ],
  };
}

function makeAdvancedTemplate(spec: AdvancedSpec): TemplateResult {
  const [target, firstLink, secondLink, unit] = spec.creatures;

  if (spec.family === "sealed-cancellation") {
    const rightCount =
      spec.targetMultiplier * spec.targetWeight + spec.bridgeWeight;
    const targetExpression = spec.composite
      ? makeExpression([target, 1], [secondLink, 1])
      : makeExpression([target, 1]);
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression(
            [MYSTERY_TOKEN, 1],
            [target, spec.targetMultiplier],
          ),
          makeExpression([firstLink, 1]),
        ),
        makeEquation(
          makeExpression([firstLink, 1], [secondLink, 1]),
          makeExpression([MYSTERY_TOKEN, 1], [unit, rightCount]),
        ),
        makeEquation(
          makeExpression([secondLink, 1]),
          makeExpression([unit, spec.bridgeWeight]),
        ),
      ],
      question: { target: targetExpression, unit },
      equationOrder: [2, 0, 1],
      solutionStrategies: spec.composite
        ? ["substitution", "add-scales", "create-combo"]
        : [
            "substitution",
            "add-scales",
            "subtract-scales",
            "create-combo",
          ],
      solutionDerivation: {
        equationMultipliers: spec.composite
          ? [1, 1, spec.targetMultiplier - 1]
          : [1, 1, -1],
        normalizeBy: spec.targetMultiplier,
      },
      mistakes: [
        {
          count: spec.targetWeight,
          kind: spec.composite ? "ignored-group" : "stopped-at-link",
        },
        {
          count: spec.bridgeWeight,
          kind: "stopped-at-link",
        },
        {
          count: rightCount - spec.bridgeWeight,
          kind: "forgot-to-normalize",
        },
        {
          count: spec.targetWeight + spec.bridgeWeight,
          kind: spec.composite ? "stopped-at-link" : "missed-cancellation",
        },
      ],
    };
  }

  if (spec.family === "sealed-sum") {
    const knownCount = spec.composite
      ? spec.firstWeight +
        spec.coefficient * spec.secondWeight -
        spec.mysteryWeight
      : spec.firstWeight + spec.secondWeight - spec.mysteryWeight;
    const bridgeCount = spec.composite
      ? spec.mysteryWeight +
        spec.coefficient * spec.firstWeight +
        spec.secondWeight
      : spec.mysteryWeight +
        spec.coefficient * spec.firstWeight -
        spec.secondWeight;
    const targetExpression = spec.composite
      ? makeExpression([target, 1], [firstLink, 1])
      : makeExpression([target, 1]);
    const firstLeft = spec.composite
      ? makeExpression(
          [MYSTERY_TOKEN, 1],
          [target, spec.coefficient],
          [firstLink, 1],
        )
      : makeExpression(
          [MYSTERY_TOKEN, 1],
          [target, spec.coefficient],
        );
    const firstRight = spec.composite
      ? makeExpression([secondLink, 1])
      : makeExpression([firstLink, 1], [secondLink, 1]);
    const secondLeft = spec.composite
      ? makeExpression(
          [target, 1],
          [firstLink, spec.coefficient],
        )
      : makeExpression([target, 1], [firstLink, 1]);

    return {
      family: spec.family,
      equations: [
        makeEquation(firstLeft, firstRight),
        makeEquation(
          secondLeft,
          makeExpression([MYSTERY_TOKEN, 1], [unit, knownCount]),
        ),
        makeEquation(
          makeExpression([secondLink, 1]),
          makeExpression([unit, bridgeCount]),
        ),
      ],
      question: { target: targetExpression, unit },
      equationOrder: [0, 1, 2],
      solutionStrategies: ["add-scales", "create-combo"],
      solutionDerivation: {
        equationMultipliers: [1, 1, 1],
        normalizeBy: spec.coefficient + 1,
      },
      mistakes: [
        { count: knownCount, kind: "used-one-scale" },
        { count: bridgeCount, kind: "used-one-scale" },
        {
          count: knownCount + bridgeCount,
          kind: "forgot-to-divide",
        },
        {
          count: Math.abs(bridgeCount - knownCount),
          kind: "added-instead-of-subtracting",
        },
      ],
    };
  }

  if (spec.family === "sealed-difference") {
    const knownCount =
      spec.mysteryWeight + spec.firstWeight + spec.secondWeight;
    const bridgeCount = spec.composite
      ? spec.mysteryWeight +
        spec.coefficient * (spec.firstWeight + spec.secondWeight)
      : spec.mysteryWeight +
        spec.coefficient * spec.firstWeight +
        spec.secondWeight;
    const targetExpression = spec.composite
      ? makeExpression([target, 1], [firstLink, 1])
      : makeExpression([target, 1]);

    return {
      family: spec.family,
      equations: [
        makeEquation(
          spec.composite
            ? makeExpression(
                [MYSTERY_TOKEN, 1],
                [target, spec.coefficient],
                [firstLink, spec.coefficient],
              )
            : makeExpression(
                [MYSTERY_TOKEN, 1],
                [target, spec.coefficient],
                [firstLink, 1],
              ),
          makeExpression([secondLink, 1]),
        ),
        makeEquation(
          makeExpression(
            [MYSTERY_TOKEN, 1],
            [target, 1],
            [firstLink, 1],
          ),
          makeExpression([unit, knownCount]),
        ),
        makeEquation(
          makeExpression([secondLink, 1]),
          makeExpression([unit, bridgeCount]),
        ),
      ],
      question: { target: targetExpression, unit },
      equationOrder: [0, 1, 2],
      solutionStrategies:
        spec.coefficient > 2
          ? ["subtract-scales", "create-combo"]
          : ["subtract-scales"],
      solutionDerivation: {
        equationMultipliers: [1, -1, 1],
        normalizeBy: spec.coefficient - 1,
      },
      mistakes: [
        { count: bridgeCount, kind: "used-one-scale" },
        {
          count: bridgeCount - knownCount,
          kind:
            spec.coefficient > 2
              ? "forgot-to-divide"
              : "reversed-relation",
        },
        { count: knownCount, kind: "used-one-scale" },
        {
          count: bridgeCount + knownCount,
          kind: "added-instead-of-subtracting",
        },
      ],
    };
  }

  if (spec.family === "sum-combo") {
    const [firstWeight, secondWeight, coefficient] = spec.parameters;
    const firstTotal = coefficient * firstWeight + secondWeight;
    const secondTotal = firstWeight + coefficient * secondWeight;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression(
            [target, coefficient],
            [firstLink, 1],
          ),
          makeExpression([secondLink, 1]),
        ),
        makeEquation(
          makeExpression(
            [target, 1],
            [firstLink, coefficient],
          ),
          makeExpression([unit, secondTotal]),
        ),
        makeEquation(
          makeExpression([secondLink, 1]),
          makeExpression([unit, firstTotal]),
        ),
      ],
      question: {
        target: makeExpression([target, 1], [firstLink, 1]),
        unit,
      },
      equationOrder: [0, 1, 2],
      solutionStrategies: ["add-scales", "create-combo"],
      solutionDerivation: {
        equationMultipliers: [1, 1, 1],
        normalizeBy: coefficient + 1,
      },
      mistakes: [
        { count: firstTotal, kind: "used-one-scale" },
        { count: secondTotal, kind: "used-one-scale" },
        {
          count: firstTotal + secondTotal,
          kind: "forgot-to-divide",
        },
        {
          count: Math.abs(firstTotal - secondTotal),
          kind: "added-instead-of-subtracting",
        },
      ],
    };
  }

  if (spec.family === "difference") {
    const [firstWeight, secondWeight, coefficient] = spec.parameters;
    const combinedWeight = firstWeight + secondWeight;
    const scaledWeight = coefficient * firstWeight + secondWeight;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression(
            [target, coefficient],
            [firstLink, 1],
          ),
          makeExpression([secondLink, 1]),
        ),
        makeEquation(
          makeExpression([target, 1], [firstLink, 1]),
          makeExpression([unit, combinedWeight]),
        ),
        makeEquation(
          makeExpression([secondLink, 1]),
          makeExpression([unit, scaledWeight]),
        ),
      ],
      question: { target: makeExpression([target, 1]), unit },
      equationOrder: [0, 1, 2],
      solutionStrategies:
        coefficient > 2
          ? ["subtract-scales", "create-combo"]
          : ["subtract-scales"],
      solutionDerivation: {
        equationMultipliers: [1, -1, 1],
        normalizeBy: coefficient - 1,
      },
      mistakes: [
        { count: combinedWeight, kind: "used-one-scale" },
        { count: scaledWeight, kind: "used-one-scale" },
        {
          count: scaledWeight - combinedWeight,
          kind:
            coefficient > 2
              ? "forgot-to-divide"
              : "reversed-relation",
        },
        {
          count: scaledWeight + combinedWeight,
          kind: "added-instead-of-subtracting",
        },
      ],
    };
  }

  if (spec.family === "combo-bridge") {
    const [firstWeight, secondWeight, coefficient] = spec.parameters;
    const comboWeight = firstWeight + secondWeight;
    const finalTotal = coefficient * comboWeight + firstWeight;
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression([target, 1], [firstLink, 1]),
          makeExpression([secondLink, 1]),
        ),
        makeEquation(
          makeExpression(
            [secondLink, coefficient],
            [target, 1],
          ),
          makeExpression([unit, finalTotal]),
        ),
        makeEquation(
          makeExpression([target, 1]),
          makeExpression([unit, firstWeight]),
        ),
      ],
      question: {
        target: makeExpression([target, 1], [firstLink, 1]),
        unit,
      },
      equationOrder: [0, 1, 2],
      solutionStrategies: [
        "create-combo",
        "subtract-scales",
      ],
      solutionDerivation: {
        equationMultipliers: [coefficient, 1, -1],
        normalizeBy: coefficient,
      },
      mistakes: [
        { count: finalTotal, kind: "used-one-scale" },
        {
          count: finalTotal - firstWeight,
          kind: "forgot-to-divide",
        },
        { count: firstWeight, kind: "ignored-group" },
        { count: secondWeight, kind: "ignored-group" },
      ],
    };
  }

  if (spec.family === "fork") {
    const [firstWeight, multiplier, offset, finalOffset] = spec.parameters;
    const secondWeight = multiplier * firstWeight - offset;
    const targetWeight = secondWeight + finalOffset - firstWeight;
    const targetExpression = spec.composite
      ? makeExpression([target, 1], [firstLink, 1])
      : makeExpression([target, 1]);
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression([firstLink, 1]),
          makeExpression([unit, firstWeight]),
        ),
        makeEquation(
          makeExpression([secondLink, 1], [unit, offset]),
          makeExpression([firstLink, multiplier]),
        ),
        makeEquation(
          makeExpression([target, 1], [firstLink, 1]),
          makeExpression([secondLink, 1], [unit, finalOffset]),
        ),
      ],
      question: { target: targetExpression, unit },
      equationOrder: [0, 1, 2],
      solutionStrategies: ["substitution"],
      solutionDerivation: {
        equationMultipliers: [
          spec.composite ? multiplier : multiplier - 1,
          1,
          1,
        ],
        normalizeBy: 1,
      },
      mistakes: [
        { count: secondWeight, kind: "stopped-at-link" },
        {
          count: targetWeight,
          kind: spec.composite ? "ignored-group" : "stopped-at-link",
        },
        {
          count: secondWeight + finalOffset,
          kind: spec.composite ? "stopped-at-link" : "missed-cancellation",
        },
        {
          count: firstWeight + multiplier + finalOffset,
          kind: "added-links",
        },
      ],
    };
  }

  if (spec.family === "cross") {
    const [leftOffset, rightCount, finalOffset] = spec.parameters;
    const firstWeight = rightCount - leftOffset;
    const secondWeight = 2 * firstWeight - 1;
    const targetWeight = firstWeight + finalOffset - 1;
    const targetExpression = spec.composite
      ? makeExpression([target, 1], [firstLink, 1])
      : makeExpression([target, 1]);
    return {
      family: spec.family,
      equations: [
        makeEquation(
          makeExpression([firstLink, 1], [unit, leftOffset]),
          makeExpression([unit, rightCount]),
        ),
        makeEquation(
          makeExpression([secondLink, 1], [unit, 1]),
          makeExpression([firstLink, 2]),
        ),
        makeEquation(
          makeExpression([target, 1], [firstLink, 1]),
          makeExpression([secondLink, 1], [unit, finalOffset]),
        ),
      ],
      question: { target: targetExpression, unit },
      equationOrder: [0, 1, 2],
      solutionStrategies: ["substitution"],
      solutionDerivation: {
        equationMultipliers: [spec.composite ? 2 : 1, 1, 1],
        normalizeBy: 1,
      },
      mistakes: [
        { count: secondWeight, kind: "stopped-at-link" },
        {
          count: targetWeight,
          kind: spec.composite ? "ignored-group" : "stopped-at-link",
        },
        {
          count: secondWeight + finalOffset,
          kind: spec.composite ? "stopped-at-link" : "missed-cancellation",
        },
        {
          count: leftOffset + rightCount + finalOffset,
          kind: "added-links",
        },
      ],
    };
  }

  const [firstWeight, secondWeight, finalOffset] = spec.parameters;
  const targetWeight = secondWeight + finalOffset - firstWeight;
  const targetExpression = spec.composite
    ? makeExpression([target, 1], [secondLink, 1])
    : makeExpression([target, 1]);
  return {
    family: spec.family,
    equations: [
      makeEquation(
        makeExpression([firstLink, 1]),
        makeExpression([unit, firstWeight]),
      ),
      makeEquation(
        makeExpression([secondLink, 1]),
        makeExpression([unit, secondWeight]),
      ),
      makeEquation(
        makeExpression([target, 1], [firstLink, 1]),
        makeExpression([secondLink, 1], [unit, finalOffset]),
      ),
    ],
    question: { target: targetExpression, unit },
    equationOrder: [0, 1, 2],
    solutionStrategies: ["substitution"],
    solutionDerivation: {
      equationMultipliers: [-1, spec.composite ? 2 : 1, 1],
      normalizeBy: 1,
    },
    mistakes: [
      { count: firstWeight, kind: "stopped-at-link" },
      { count: secondWeight, kind: "stopped-at-link" },
      {
        count: targetWeight,
        kind: spec.composite ? "ignored-group" : "stopped-at-link",
      },
      {
        count: firstWeight + secondWeight + finalOffset,
        kind: "added-links",
      },
    ],
  };
}

function templateForSpec(spec: CampaignSpec): TemplateResult {
  if (spec.difficulty === "Starter") return makeStarterTemplate(spec);
  if (spec.difficulty === "Junior") return makeJuniorTemplate(spec);
  return makeAdvancedTemplate(spec);
}

function makeOptions(
  answer: number,
  unit: Creature,
  correctIndex: number,
  candidates: readonly MistakeCandidate[],
  salt: number,
): readonly AnswerOption[] {
  const nearCount =
    answer >= 8
      ? answer - 1
      : answer <= 2 || salt % 2 === 0
        ? answer + 1
        : answer - 1;
  const candidatePool: readonly MistakeCandidate[] = [
    { count: nearCount, kind: "off-by-one" },
    ...candidates,
    { count: answer + 2, kind: "missed-cancellation" },
    { count: Math.max(1, answer - 2), kind: "reversed-relation" },
    { count: answer * 2, kind: "double-counted" },
    {
      count: Math.max(1, Math.round(answer / 2)),
      kind: "forgot-to-normalize",
    },
    ...Array.from({ length: 8 }, (_, index): MistakeCandidate => ({
      count: index + 1,
      kind:
        index % 2 === 0
          ? "reversed-relation"
          : "missed-cancellation",
    })),
  ];
  const used = new Set<number>([answer]);
  const distractors: AnswerOption[] = [];
  for (const candidate of candidatePool) {
    if (
      !Number.isInteger(candidate.count) ||
      candidate.count <= 0 ||
      candidate.count > 8 ||
      used.has(candidate.count)
    ) {
      continue;
    }
    used.add(candidate.count);
    distractors.push({ ...candidate, creature: unit });
    if (distractors.length === 3) break;
  }
  if (distractors.length !== 3) {
    throw new Error("Unable to construct three distinct misconception options.");
  }
  const options = [...distractors];
  options.splice(correctIndex, 0, {
    creature: unit,
    count: answer,
    kind: "correct",
  });
  return options;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function assembleRound(
  difficulty: Difficulty,
  template: TemplateResult,
  correctIndex: number,
  salt: number,
  idPrefix: string,
): Round {
  const answer = calculateAnswer(template.equations, template.question);
  if (answer === null) {
    throw new Error("The balance equations do not determine one positive integer answer.");
  }
  const options = makeOptions(
    answer,
    template.question.unit,
    correctIndex,
    template.mistakes,
    salt,
  );
  const draft: Round = {
    id: "",
    difficulty,
    family: template.family,
    equations: template.equations,
    question: template.question,
    options,
    optionKinds: options.map(({ kind }) => kind),
    correctIndex,
    answer,
    solutionStrategies: template.solutionStrategies,
    solutionDerivation: template.solutionDerivation,
    scaffold:
      difficulty === "Wizard"
        ? null
        : {
            kind: "equation-path",
            equationOrder: template.equationOrder,
          },
    feedbackPolicy:
      difficulty === "Wizard"
        ? "preserve-inference"
        : "explain-difference",
  };
  const fingerprint = roundFingerprint(draft);
  return { ...draft, id: `${idPrefix}-${hashText(fingerprint)}` };
}

function campaignSpecs(): readonly CampaignSpec[] {
  const starter = STARTER_SPECS.map((spec, index) => ({
    ...spec,
    correctIndex: ANSWER_POSITIONS.Starter[index],
  }));
  const junior = JUNIOR_SPECS.map((spec, index) => ({
    ...spec,
    correctIndex: ANSWER_POSITIONS.Junior[index],
  }));
  const expert = ADVANCED_BLUEPRINTS.map((blueprint, index) => ({
    ...blueprint,
    difficulty: "Expert" as const,
    creatures: EXPERT_CREATURES[index],
    correctIndex: ANSWER_POSITIONS.Expert[index],
  }));
  const wizard = WIZARD_BLUEPRINTS.map((blueprint, index) => ({
    ...blueprint,
    creatures: WIZARD_CREATURES[index],
    correctIndex: ANSWER_POSITIONS.Wizard[index],
  }));
  return [...starter, ...junior, ...expert, ...wizard];
}

function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

function allEquationCreatures(round: Round): readonly Creature[] {
  return involvedTokens(round.equations, round.question).filter(isCreature);
}

export function solutionDerivationMatchesRound(round: Round): boolean {
  const { equationMultipliers, normalizeBy } = round.solutionDerivation;
  if (
    equationMultipliers.length !== round.equations.length ||
    equationMultipliers.some(
      (multiplier) =>
        !Number.isSafeInteger(multiplier),
    ) ||
    !equationMultipliers.some((multiplier) => multiplier !== 0) ||
    !Number.isSafeInteger(normalizeBy) ||
    normalizeBy <= 0
  ) {
    return false;
  }

  const combined = Object.fromEntries(
    BALANCE_TOKENS.map((token) => [token, 0]),
  ) as Record<BalanceToken, number>;
  for (const [equationIndex, equation] of round.equations.entries()) {
    const multiplier = equationMultipliers[equationIndex];
    const coefficients = equationCoefficients(equation);
    for (const token of BALANCE_TOKENS) {
      combined[token] += multiplier * coefficients[token];
    }
  }

  const goal = equationCoefficients({
    left: round.question.target,
    right: makeExpression([round.question.unit, round.answer]),
  });
  return BALANCE_TOKENS.every(
    (token) => combined[token] === normalizeBy * goal[token],
  );
}

export function validateRound(round: Round): RoundValidation {
  const errors: string[] = [];
  if (!isDifficulty(round.difficulty)) {
    errors.push(`Unknown difficulty: ${round.difficulty}`);
  }
  if (round.equations.length !== EQUATION_COUNTS[round.difficulty]) {
    errors.push(`${round.difficulty} must use ${EQUATION_COUNTS[round.difficulty]} equations.`);
  }
  if (allEquationCreatures(round).length !== CREATURE_COUNTS[round.difficulty]) {
    errors.push(`${round.difficulty} uses the wrong number of creatures.`);
  }
  if (
    round.equations.some(
      (equation) => canonicalEquationKey(equation) === "identity",
    )
  ) {
    errors.push("Balance equations must add a nontrivial relation.");
  }
  const panExpressions = round.equations.flatMap(({ left, right }) => [
    left,
    right,
  ]);
  if (
    [...panExpressions, round.question.target].some(
      (expression) => expressionItemCount(expression) > 8,
    )
  ) {
    errors.push("No scale pan may render more than eight individual tokens.");
  }

  const analysis = analyzeBalanceQuestion(round.equations, round.question);
  const weights = analysis.knownWeights;
  const derivedAnswer = analysis.answer;
  if (!analysis.hasPositiveSolution) {
    errors.push("The equations do not admit positive token weights.");
  }
  if (!analysis.answerInvariant) {
    errors.push("The asked balance is not invariant across the legal solutions.");
  }
  if (derivedAnswer === null) {
    errors.push("The question does not have one positive integer answer.");
  }
  if (derivedAnswer !== null && round.answer !== derivedAnswer) {
    errors.push("The stored answer does not match the algebraic result.");
  }
  if (derivedAnswer !== null && derivedAnswer > 8) {
    errors.push("Answers must fit at most eight individual tokens.");
  }

  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex >= 4
  ) {
    errors.push("The correct answer index must be one of four positions.");
  }
  if (round.options.length !== 4 || round.optionKinds.length !== 4) {
    errors.push("Every round must provide four answer options.");
  }
  if (new Set(round.options.map(({ count }) => count)).size !== 4) {
    errors.push("Answer quantities must be mutually distinct.");
  }
  if (
    round.options.some(
      ({ creature, count }) =>
        creature !== round.question.unit ||
        !Number.isInteger(count) ||
        count <= 0 ||
        count > 8,
    )
  ) {
    errors.push("Every option must be one to eight whole copies of the question unit.");
  }
  if (derivedAnswer !== null) {
    const exactIndexes = round.options.flatMap(({ count }, index) =>
      count === derivedAnswer ? [index] : [],
    );
    if (
      exactIndexes.length !== 1 ||
      exactIndexes[0] !== round.correctIndex
    ) {
      errors.push("Exactly one option must equal the derived answer.");
    }
  }
  if (
    round.options[round.correctIndex]?.kind !== "correct" ||
    round.optionKinds[round.correctIndex] !== "correct" ||
    round.options.some(
      ({ kind }, index) => kind !== round.optionKinds[index],
    )
  ) {
    errors.push("Option kinds must identify only the correct position as correct.");
  }
  if (
    derivedAnswer !== null &&
    !round.options.some(
      ({ count }, index) =>
        index !== round.correctIndex &&
        Math.abs(count - derivedAnswer) === 1,
    )
  ) {
    errors.push("Every round needs a close one-unit near-miss.");
  }
  if (
    round.options.filter(
      ({ kind }, index) =>
        index !== round.correctIndex && kind !== "off-by-one",
    ).length < 2
  ) {
    errors.push("At least two distractors must encode algebraic misconceptions.");
  }

  if (
    round.solutionStrategies.length === 0 ||
    new Set(round.solutionStrategies).size !==
      round.solutionStrategies.length ||
    round.solutionStrategies.some(
      (strategy) =>
        !(SOLUTION_STRATEGIES as readonly string[]).includes(strategy),
    )
  ) {
    errors.push("Every round needs distinct known solution strategies.");
  }
  if (!solutionDerivationMatchesRound(round)) {
    errors.push("The stored solution derivation must prove the displayed answer.");
  }
  if (
    round.solutionStrategies.includes("add-scales") &&
    round.solutionDerivation.equationMultipliers.filter(
      (multiplier) => multiplier > 0,
    ).length < 2
  ) {
    errors.push("Adding scales needs at least two positively combined relations.");
  }
  if (
    round.solutionStrategies.includes("subtract-scales") &&
    !round.solutionDerivation.equationMultipliers.some(
      (multiplier) => multiplier < 0,
    )
  ) {
    errors.push("Subtracting scales needs a negatively combined relation.");
  }
  if (
    round.solutionStrategies.includes("create-combo") &&
    round.solutionDerivation.normalizeBy < 2
  ) {
    errors.push("Creating a repeated combo must end with normalization.");
  }

  if (round.difficulty === "Wizard") {
    const mysteryGroups = panExpressions
      .flat()
      .filter(({ creature }) => creature === MYSTERY_TOKEN);
    if (
      !(
        round.family === "sealed-cancellation" ||
        round.family === "sealed-sum" ||
        round.family === "sealed-difference"
      ) ||
      mysteryGroups.length !== 2 ||
      mysteryGroups.some(({ count }) => count !== 1)
    ) {
      errors.push("Wizard must use the same single sealed load in exactly two relations.");
    }
    if (analysis.freeVariableCount !== 1) {
      errors.push("Wizard must leave exactly one nuisance weight underdetermined.");
    }
    if (
      round.equations.some((_, removedIndex) =>
        calculateAnswer(
          round.equations.filter((__, index) => index !== removedIndex),
          round.question,
        ) !== null,
      )
    ) {
      errors.push("Every Wizard relation must be necessary to derive the answer.");
    }
    if (round.scaffold !== null) {
      errors.push("Wizard must hide the equation-path scaffold.");
    }
    if (round.feedbackPolicy !== "preserve-inference") {
      errors.push("Wizard feedback must preserve the missing path inference.");
    }
  } else {
    if (
      panExpressions.some((expression) =>
        expression.some(({ creature }) => creature === MYSTERY_TOKEN),
      )
    ) {
      errors.push("The sealed mystery load is reserved for Wizard.");
    }
    if (analysis.freeVariableCount !== 0) {
      errors.push("Non-Wizard relations must determine every relative weight.");
    }
    if (
      round.scaffold?.kind !== "equation-path" ||
      round.scaffold.equationOrder.length !== round.equations.length ||
      new Set(round.scaffold.equationOrder).size !== round.equations.length
    ) {
      errors.push("The visible equation path must cover every relation once.");
    }
    if (round.feedbackPolicy !== "explain-difference") {
      errors.push("Non-Wizard feedback should explain the weight difference.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    derivedAnswer,
    relativeWeights: weights,
    freeVariableCount: analysis.freeVariableCount,
    answerInvariant: analysis.answerInvariant,
    hasPositiveSolution: analysis.hasPositiveSolution,
  };
}

export function roundFingerprint(round: Round): string {
  const equationKeys = round.equations.map(canonicalEquationKey).sort();
  return [
    round.difficulty,
    equationKeys.join("&"),
    `${expressionKey(round.question.target)}=>${round.question.unit}`,
  ].join(":");
}

function assertAnswerPositionSequence(
  difficulty: Difficulty,
  positions: readonly number[],
): void {
  const counts = [0, 1, 2, 3].map(
    (position) => positions.filter((value) => value === position).length,
  );
  if (counts.some((count) => count !== 3)) {
    throw new Error(`${difficulty} answer positions must be balanced 3/3/3/3.`);
  }
  if (positions.some((position, index) => index > 0 && position === positions[index - 1])) {
    throw new Error(`${difficulty} cannot repeat adjacent answer positions.`);
  }
  const firstBlock = positions.slice(0, 4).join(",");
  if (
    positions.slice(4, 8).join(",") === firstBlock &&
    positions.slice(8, 12).join(",") === firstBlock
  ) {
    throw new Error(`${difficulty} cannot repeat one four-position cycle.`);
  }
}

export function buildRounds(): readonly Round[] {
  const specs = campaignSpecs();
  const levelIndexes: Record<Difficulty, number> = {
    Starter: 0,
    Junior: 0,
    Expert: 0,
    Wizard: 0,
  };
  const rounds = specs.map((spec, index) => {
    const levelIndex = levelIndexes[spec.difficulty];
    levelIndexes[spec.difficulty] += 1;
    const round = assembleRound(
      spec.difficulty,
      templateForSpec(spec),
      spec.correctIndex,
      index,
      `campaign-${spec.difficulty.toLowerCase()}-${String(levelIndex + 1).padStart(2, "0")}`,
    );
    const validation = validateRound(round);
    if (!validation.valid) {
      throw new Error(
        `Invalid authored ${spec.difficulty} round ${levelIndex + 1}: ${validation.errors.join(" ")}`,
      );
    }
    return round;
  });

  for (const difficulty of DIFFICULTIES) {
    const levelRounds = rounds.filter(
      (round) => round.difficulty === difficulty,
    );
    if (levelRounds.length !== 12) {
      throw new Error(`${difficulty} must contain exactly 12 authored rounds.`);
    }
    assertAnswerPositionSequence(
      difficulty,
      levelRounds.map(({ correctIndex }) => correctIndex),
    );
  }
  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error("Authored round fingerprints must be unique.");
  }
  return rounds;
}

export const ROUNDS = buildRounds();

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
  if (!Number.isInteger(exclusiveMaximum) || exclusiveMaximum <= 0) {
    throw new Error("Random ranges must have a positive integer size.");
  }
  return Math.floor(unitRandom(random) * exclusiveMaximum);
}

function shuffled<T>(values: readonly T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function generatedStarterSpec(random: RandomSource): StarterSpec {
  const [target, unit] = shuffled(CREATURES, random).slice(0, 2) as [
    Creature,
    Creature,
  ];
  const answer = 2 + randomInteger(random, 7);
  const wantsCancellation = randomInteger(random, 2) === 1 && answer < 8;
  if (wantsCancellation) {
    return {
      difficulty: "Starter",
      family: "cancellation",
      creatures: [target, unit],
      answer,
      multiplier: 1,
      offset: 1 + randomInteger(random, Math.min(3, 8 - answer)),
      correctIndex: randomInteger(random, 4),
    };
  }
  const maxMultiplier = Math.max(1, Math.min(3, Math.floor(8 / answer)));
  return {
    difficulty: "Starter",
    family: "direct",
    creatures: [target, unit],
    answer,
    multiplier: 1 + randomInteger(random, maxMultiplier),
    offset: 0,
    correctIndex: randomInteger(random, 4),
  };
}

function generatedJuniorSpec(random: RandomSource): JuniorSpec {
  const [target, bridge, unit] = shuffled(CREATURES, random).slice(0, 3) as [
    Creature,
    Creature,
    Creature,
  ];
  const strategyIndex = randomInteger(random, 6);
  const correctIndex = randomInteger(random, 4);

  if (strategyIndex === 0) {
    return {
      difficulty: "Junior",
      family: "add-combo",
      creatures: [target, bridge, unit],
      firstWeight: 1 + randomInteger(random, 2),
      secondWeight: 1 + randomInteger(random, 2),
      coefficient: 2,
      correctIndex,
    };
  }

  if (strategyIndex === 1) {
    return {
      difficulty: "Junior",
      family: "subtract-combo",
      creatures: [target, bridge, unit],
      firstWeight: 1,
      secondWeight: 1,
      coefficient: 2,
      correctIndex,
    };
  }

  const bridgeWeight = 2 + randomInteger(random, 3);
  const multiplier = 2 + randomInteger(random, 2);
  const product = bridgeWeight * multiplier;
  const wantsOffset = randomInteger(random, 2) === 1;
  return {
    difficulty: "Junior",
    family: wantsOffset ? "offset-chain" : "chain",
    creatures: [target, bridge, unit],
    bridgeWeight,
    multiplier,
    offset: wantsOffset
      ? 1 + randomInteger(random, Math.min(3, product - 2))
      : 0,
    correctIndex,
  };
}

function generatedAdvancedSpec(
  difficulty: "Expert" | "Wizard",
  random: RandomSource,
): AdvancedSpec {
  const creatures = shuffled(CREATURES, random).slice(0, 4) as [
    Creature,
    Creature,
    Creature,
    Creature,
  ];
  const correctIndex = randomInteger(random, 4);

  if (difficulty === "Wizard") {
    const blueprint =
      WIZARD_BLUEPRINTS[randomInteger(random, WIZARD_BLUEPRINTS.length)];
    return {
      ...blueprint,
      creatures,
      correctIndex,
    };
  }

  const strategyIndex = randomInteger(random, 4);
  if (strategyIndex === 1) {
    return {
      difficulty,
      family: "sum-combo",
      creatures,
      parameters: [
        1 + randomInteger(random, 2),
        1 + randomInteger(random, 2),
        2 + randomInteger(random, 2),
      ],
      correctIndex,
    };
  }

  if (strategyIndex === 2) {
    return {
      difficulty,
      family: "difference",
      creatures,
      parameters: [
        1 + randomInteger(random, 2),
        1 + randomInteger(random, 2),
        2 + randomInteger(random, 2),
      ],
      correctIndex,
    };
  }

  if (strategyIndex === 3) {
    const parameters = [
      [1, 1, 2],
      [1, 2, 2],
      [2, 1, 2],
    ] as const;
    return {
      difficulty,
      family: "combo-bridge",
      creatures,
      parameters: parameters[randomInteger(random, parameters.length)],
      correctIndex,
    };
  }

  const substitutionFamily = randomInteger(random, 3);
  if (substitutionFamily === 0) {
    const firstWeight = 2 + randomInteger(random, 3);
    const multiplier = 2 + randomInteger(random, 2);
    const maxOffset = Math.min(3, multiplier * firstWeight - 2);
    return {
      difficulty,
      family: "fork",
      creatures,
      parameters: [
        firstWeight,
        multiplier,
        1 + randomInteger(random, maxOffset),
        1 + randomInteger(random, 4),
      ],
      composite: false,
      correctIndex,
    };
  }

  if (substitutionFamily === 1) {
    const leftOffset = 1 + randomInteger(random, 3);
    const firstWeight = 2 + randomInteger(random, 4);
    return {
      difficulty,
      family: "cross",
      creatures,
      parameters: [
        leftOffset,
        leftOffset + firstWeight,
        1 + randomInteger(random, 4),
      ],
      composite: false,
      correctIndex,
    };
  }

  const firstWeight = 2 + randomInteger(random, 4);
  const secondWeight = 2 + randomInteger(random, 5);
  const minimumOffset = Math.max(1, firstWeight - secondWeight + 1);
  return {
    difficulty,
    family: "parallel",
    creatures,
    parameters: [
      firstWeight,
      secondWeight,
      minimumOffset + randomInteger(random, 4),
    ],
    composite: false,
    correctIndex,
  };
}

function generatedSpec(
  difficulty: Difficulty,
  random: RandomSource,
): CampaignSpec {
  if (difficulty === "Starter") return generatedStarterSpec(random);
  if (difficulty === "Junior") return generatedJuniorSpec(random);
  return generatedAdvancedSpec(difficulty, random);
}

/**
 * Generates one validated round. Pass the current session's fingerprint set as
 * the third argument to guarantee no repeated algebra within that session.
 */
export function generateInfiniteRound(
  difficulty: Difficulty,
  random: RandomSource = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  if (!isDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const spec = generatedSpec(difficulty, random);
    let round: Round;
    try {
      round = assembleRound(
        difficulty,
        templateForSpec(spec),
        spec.correctIndex,
        randomInteger(random, 1_000_000),
        `infinite-${difficulty.toLowerCase()}`,
      );
    } catch {
      continue;
    }
    const validation = validateRound(round);
    if (!validation.valid) continue;
    if (round.answer > 8) continue;
    if (excludedFingerprints.has(roundFingerprint(round))) continue;
    return round;
  }

  throw new Error(
    `Unable to generate a valid unique ${difficulty} round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

export function createSeededRandom(seed: number): RandomSource {
  if (!Number.isSafeInteger(seed)) {
    throw new Error("A seed must be a safe integer.");
  }
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function generateInfiniteRoundFromSeed(
  difficulty: Difficulty,
  seed: number,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  return generateInfiniteRound(
    difficulty,
    createSeededRandom(seed),
    excludedFingerprints,
  );
}

export function describeExpression(expression: Expression): string {
  const parts = expression.map(({ creature, count }) => {
    const name = BALANCE_TOKEN_NAMES[creature];
    return `${count} ${name}${count === 1 ? "" : "s"}`;
  });
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function describeEquation(equation: BalanceEquation): string {
  return `${describeExpression(equation.left)} balances ${describeExpression(equation.right)}`;
}

export function solutionStrategyFeedback(round: Round): string {
  const strategies = new Set(round.solutionStrategies);
  const foundationalStrategy = FOUNDATIONAL_STRATEGY_BY_FAMILY[round.family];
  const repeatedScale = round.solutionDerivation.equationMultipliers.some(
    (multiplier) => Math.abs(multiplier) > 1,
  );
  const steps: string[] = [];

  if (foundationalStrategy === "split-evenly") {
    steps.push(
      `Split both pans into ${round.solutionDerivation.normalizeBy} equal groups.`,
    );
  } else if (foundationalStrategy === "cancel-matches") {
    steps.push("Remove the matching unit loads from both pans.");
  } else if (
    strategies.has("add-scales") &&
    strategies.has("subtract-scales")
  ) {
    steps.push("Combine the balances, then remove the matching load.");
  } else if (strategies.has("add-scales")) {
    steps.push("Add the balances.");
  } else if (strategies.has("subtract-scales")) {
    steps.push(
      repeatedScale
        ? "Repeat the needed balance, then subtract the matching loads."
        : "Subtract the matching balance.",
    );
  } else if (strategies.has("substitution")) {
    steps.push("Replace equal loads, then simplify.");
  }

  if (strategies.has("create-combo")) {
    steps.push(
      `Regroup into ${round.solutionDerivation.normalizeBy} matching target groups, then split evenly.`,
    );
  }

  return steps.join(" ");
}

export function optionFeedback(round: Round, optionIndex: number): string {
  const option = round.options[optionIndex];
  if (!option) throw new Error("Option index is outside this round.");
  if (optionIndex === round.correctIndex) {
    return `${describeExpression(round.question.target)} balances ${option.count} ${
      CREATURE_NAMES[option.creature]
    }${option.count === 1 ? "" : "s"}.`;
  }
  if (round.feedbackPolicy === "preserve-inference") {
    return "That group does not leave the target scale balanced.";
  }
  const difference = option.count - round.answer;
  const amount = Math.abs(difference);
  return `That pan is ${amount} ${CREATURE_NAMES[option.creature]}${
    amount === 1 ? "" : "s"
  } too ${difference > 0 ? "heavy" : "light"}.`;
}

const tutorialSpec: StarterSpec = {
  difficulty: "Starter",
  family: "direct",
  creatures: ["goose", "chick"],
  answer: 4,
  multiplier: 2,
  offset: 0,
  correctIndex: 1,
};

export const TUTORIAL = assembleRound(
  "Starter",
  makeStarterTemplate(tutorialSpec),
  tutorialSpec.correctIndex,
  0,
  "tutorial",
);
