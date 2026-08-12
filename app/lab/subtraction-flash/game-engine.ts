export const SLOW_RESPONSE_MS = 4_000;
export const REVIEW_SPACING = 4;

export const ANSWER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const VISUAL_ORIENTATIONS = ["horizontal", "vertical"] as const;
export const LISTEN_COPIES = 3;
export const SUBTRACTION_LEVELS = ["B100", "B120"] as const;

export type AnswerValue = (typeof ANSWER_VALUES)[number];
export type SubmittedAnswer = number;
export type VisualOrientation = (typeof VISUAL_ORIENTATIONS)[number];
export type PracticeMode = "visual" | "listen";
export type SubtractionLevel = (typeof SUBTRACTION_LEVELS)[number];
export type RandomSource = () => number;

export type SubtractionLevelConfig = Readonly<{
  label: SubtractionLevel;
  minuendMin: number;
  minuendMax: number;
  subtrahendMin: number;
  subtrahendMax: number;
  answerDigits: 1 | 2;
  includesTenReview: boolean;
  visualCopies: 1 | 2;
  listenCopies: 1 | 3;
}>;

export const SUBTRACTION_LEVEL_CONFIG: Readonly<
  Record<SubtractionLevel, SubtractionLevelConfig>
> = Object.freeze({
  B100: Object.freeze({
    label: "B100",
    minuendMin: 11,
    minuendMax: 18,
    subtrahendMin: 2,
    subtrahendMax: 9,
    answerDigits: 1,
    includesTenReview: false,
    visualCopies: 2,
    listenCopies: 3,
  }),
  B120: Object.freeze({
    label: "B120",
    minuendMin: 20,
    minuendMax: 64,
    subtrahendMin: 2,
    subtrahendMax: 10,
    answerDigits: 2,
    includesTenReview: true,
    visualCopies: 1,
    listenCopies: 1,
  }),
});

export type SubtractionFact = Readonly<{
  level: SubtractionLevel;
  factKey: string;
  minuend: number;
  subtrahend: number;
  answer: SubmittedAnswer;
}>;

export type SubtractionCard = Readonly<
  SubtractionFact & {
    id: string;
    orientation: VisualOrientation;
    isReview: boolean;
  }
>;

export type DeckDraw = Readonly<{
  card: SubtractionCard;
  drawNumber: number;
  cycle: number;
  remaining: number;
  baseDeckSize: number;
}>;

export type AnswerOutcome = Readonly<{
  correct: boolean;
  elapsedMs: number;
}>;

export type OutcomeRecord = Readonly<{
  flagged: boolean;
  reinserted: boolean;
  reason: "incorrect" | "slow" | "both" | null;
}>;

export type SubtractionDeck = Readonly<{
  next(): DeckDraw;
  recordOutcome(card: SubtractionCard, outcome: AnswerOutcome): OutcomeRecord;
  snapshot(): Readonly<{
    cycle: number;
    drawCount: number;
    remaining: number;
    reviewedFactCount: number;
    exhausted: boolean;
  }>;
}>;

export function requiresBorrow(minuend: number, subtrahend: number): boolean {
  return (
    Number.isInteger(minuend) &&
    Number.isInteger(subtrahend) &&
    minuend >= 11 &&
    subtrahend >= 2 &&
    subtrahend <= 10 &&
    minuend > subtrahend &&
    minuend % 10 < subtrahend % 10
  );
}

function createFacts(config: SubtractionLevelConfig): readonly SubtractionFact[] {
  return Object.freeze(
    Array.from(
      { length: config.minuendMax - config.minuendMin + 1 },
      (_, offset) => config.minuendMin + offset,
    ).flatMap((minuend) =>
      Array.from(
        { length: config.subtrahendMax - config.subtrahendMin + 1 },
        (_, offset) => config.subtrahendMin + offset,
      )
        .filter(
          (subtrahend) =>
            requiresBorrow(minuend, subtrahend) ||
            (config.includesTenReview && subtrahend === 10),
        )
        .map((subtrahend) => ({
          level: config.label,
          factKey: `${minuend}-${subtrahend}`,
          minuend,
          subtrahend,
          answer: minuend - subtrahend,
        })),
    ),
  );
}

export const SUBTRACTION_FACTS_BY_LEVEL: Readonly<
  Record<SubtractionLevel, readonly SubtractionFact[]>
> = Object.freeze({
  B100: createFacts(SUBTRACTION_LEVEL_CONFIG.B100),
  B120: createFacts(SUBTRACTION_LEVEL_CONFIG.B120),
});

/** The original catalogue remains a B100 alias for older callers. */
export const SUBTRACTION_FACTS = SUBTRACTION_FACTS_BY_LEVEL.B100;

export function subtractionFactsForLevel(
  level: SubtractionLevel,
): readonly SubtractionFact[] {
  return SUBTRACTION_FACTS_BY_LEVEL[level];
}

function normalizedRandom(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function randomIndex(length: number, random: RandomSource): number {
  if (length <= 1) return 0;
  return Math.min(length - 1, Math.floor(normalizedRandom(random) * length));
}

function takeRandom<T>(values: T[], random: RandomSource): T {
  const index = randomIndex(values.length, random);
  const [value] = values.splice(index, 1);
  return value;
}

function cardCopiesForFact(
  fact: SubtractionFact,
  mode: PracticeMode,
  cycle: number,
): SubtractionCard[] {
  const config = SUBTRACTION_LEVEL_CONFIG[fact.level];
  if (mode === "visual") {
    const orientations =
      config.visualCopies === 2
        ? VISUAL_ORIENTATIONS
        : [
            VISUAL_ORIENTATIONS[
              (fact.minuend + fact.subtrahend + cycle) %
                VISUAL_ORIENTATIONS.length
            ],
          ];
    return orientations.map((orientation) => ({
      ...fact,
      id: `${fact.level}:${mode}:${cycle}:${fact.factKey}:${orientation}`,
      orientation,
      isReview: false,
    }));
  }

  return Array.from({ length: config.listenCopies }, (_, index) => ({
    ...fact,
    id: `${fact.level}:${mode}:${cycle}:${fact.factKey}:copy-${index + 1}`,
    orientation: VISUAL_ORIENTATIONS[index % VISUAL_ORIENTATIONS.length],
    isReview: false,
  }));
}

function shuffledWithFactSpacing(
  cards: readonly SubtractionCard[],
  random: RandomSource,
  precedingFactKeys: readonly string[] = [],
): SubtractionCard[] {
  const cardsByFact = new Map<string, SubtractionCard[]>();

  for (const card of cards) {
    const copies = cardsByFact.get(card.factKey) ?? [];
    copies.push(card);
    cardsByFact.set(card.factKey, copies);
  }

  for (const copies of cardsByFact.values()) {
    for (let index = copies.length - 1; index > 0; index -= 1) {
      const swapIndex = randomIndex(index + 1, random);
      [copies[index], copies[swapIndex]] = [
        copies[swapIndex],
        copies[index],
      ];
    }
  }

  const recent = precedingFactKeys.slice(-REVIEW_SPACING);
  const result: SubtractionCard[] = [];

  while (cardsByFact.size > 0) {
    const activeKeys = [...cardsByFact.keys()];
    let eligibleKeys = activeKeys.filter((factKey) => !recent.includes(factKey));

    if (eligibleKeys.length === 0) {
      eligibleKeys = activeKeys.filter(
        (factKey) => factKey !== recent.at(-1),
      );
    }
    if (eligibleKeys.length === 0) eligibleKeys = activeKeys;

    const largestRemaining = Math.max(
      ...eligibleKeys.map(
        (factKey) => cardsByFact.get(factKey)?.length ?? 0,
      ),
    );
    const balancedKeys = eligibleKeys.filter(
      (factKey) =>
        (cardsByFact.get(factKey)?.length ?? 0) >= largestRemaining - 1,
    );
    const chosenKey =
      balancedKeys[randomIndex(balancedKeys.length, random)] ??
      eligibleKeys[0];
    const copies = cardsByFact.get(chosenKey);

    if (!copies) {
      throw new Error("Subtraction deck lost a fact while shuffling.");
    }

    result.push(copies.pop() as SubtractionCard);
    if (copies.length === 0) cardsByFact.delete(chosenKey);
    recent.push(chosenKey);
    if (recent.length > REVIEW_SPACING) recent.shift();
  }

  return result;
}

export function createBaseDeck(
  mode: PracticeMode,
  options: Readonly<{
    random?: RandomSource;
    cycle?: number;
    precedingFactKeys?: readonly string[];
    level?: SubtractionLevel;
  }> = {},
): SubtractionCard[] {
  const random = options.random ?? Math.random;
  const cycle = options.cycle ?? 1;
  const facts = subtractionFactsForLevel(options.level ?? "B100");
  const cards = facts.flatMap((fact) =>
    cardCopiesForFact(fact, mode, cycle),
  );

  return shuffledWithFactSpacing(
    cards,
    random,
    options.precedingFactKeys,
  );
}

export function buildAnswerOptions(
  fact: Pick<SubtractionFact, "answer">,
): readonly AnswerValue[] {
  if (!ANSWER_VALUES.some((answer) => answer === fact.answer)) {
    throw new RangeError("A subtraction card must have an answer from 2 to 9.");
  }
  return ANSWER_VALUES;
}

function safeInsertionIndexes(
  queue: readonly SubtractionCard[],
  factKey: string,
  minimumIndex: number,
): number[] {
  const indexes: number[] = [];

  for (let index = minimumIndex; index <= queue.length; index += 1) {
    const nearby = queue.slice(
      Math.max(0, index - REVIEW_SPACING),
      Math.min(queue.length, index + REVIEW_SPACING),
    );
    if (nearby.every((card) => card.factKey !== factKey)) {
      indexes.push(index);
    }
  }

  return indexes;
}

function insertReviewAtSafeDistance(
  queue: SubtractionCard[],
  reviewCard: SubtractionCard,
  random: RandomSource,
): boolean {
  if (queue.length < REVIEW_SPACING) return false;

  const safeIndexes = safeInsertionIndexes(
    queue,
    reviewCard.factKey,
    REVIEW_SPACING,
  );
  if (safeIndexes.length === 0) return false;

  const nearbyIndexes = safeIndexes.filter(
    (index) => index <= REVIEW_SPACING + 12,
  );
  const choices = nearbyIndexes.length > 0 ? nearbyIndexes : safeIndexes;
  const index = choices[randomIndex(choices.length, random)];
  queue.splice(index, 0, reviewCard);
  return true;
}

export function createSubtractionDeck(
  options: Readonly<{
    mode: PracticeMode;
    level?: SubtractionLevel;
    random?: RandomSource;
    repeat?: boolean;
  }>,
): SubtractionDeck {
  const { mode, level = "B100" } = options;
  const random = options.random ?? Math.random;
  const repeat = options.repeat ?? true;
  const facts = subtractionFactsForLevel(level);
  const config = SUBTRACTION_LEVEL_CONFIG[level];
  const baseDeckSize =
    facts.length *
    (mode === "visual"
      ? config.visualCopies
      : config.listenCopies);
  const recentFactKeys: string[] = [];
  const reviewedFactKeys = new Set<string>();
  const pendingReviews: SubtractionCard[] = [];
  let queue: SubtractionCard[] = [];
  let cycle = 0;
  let drawCount = 0;

  const refillBaseDeck = () => {
    cycle += 1;
    queue = createBaseDeck(mode, {
      random,
      cycle,
      level,
      precedingFactKeys: recentFactKeys,
    });

    while (pendingReviews.length > 0) {
      const pending = takeRandom(pendingReviews, random);
      if (!insertReviewAtSafeDistance(queue, pending, random)) {
        queue.push(pending);
      }
    }
  };

  const drainPendingReviews = () => {
    if (pendingReviews.length === 0) return;
    queue = shuffledWithFactSpacing(
      pendingReviews.splice(0),
      random,
      recentFactKeys,
    );
  };

  return {
    next() {
      if (queue.length === 0) {
        if (cycle === 0 || repeat) {
          refillBaseDeck();
        } else {
          drainPendingReviews();
        }
      }
      const card = queue.shift();
      if (!card) throw new Error("Subtraction deck is exhausted.");

      drawCount += 1;
      recentFactKeys.push(card.factKey);
      if (recentFactKeys.length > REVIEW_SPACING) recentFactKeys.shift();

      return {
        card,
        drawNumber: drawCount,
        cycle,
        remaining: queue.length,
        baseDeckSize,
      };
    },

    recordOutcome(card, outcome) {
      const elapsedMs =
        Number.isFinite(outcome.elapsedMs) && outcome.elapsedMs >= 0
          ? outcome.elapsedMs
          : 0;
      const slow = elapsedMs > SLOW_RESPONSE_MS;
      const incorrect = !outcome.correct;
      const flagged = incorrect || slow;
      const reason =
        incorrect && slow
          ? "both"
          : incorrect
            ? "incorrect"
            : slow
              ? "slow"
              : null;

      if (!flagged || reviewedFactKeys.has(card.factKey)) {
        return { flagged, reinserted: false, reason };
      }

      reviewedFactKeys.add(card.factKey);
      const reviewCard: SubtractionCard = {
        ...card,
        id: `${card.id}:review`,
        isReview: true,
      };
      const reinserted = insertReviewAtSafeDistance(
        queue,
        reviewCard,
        random,
      );
      if (!reinserted) pendingReviews.push(reviewCard);

      return { flagged: true, reinserted: true, reason };
    },

    snapshot() {
      return {
        cycle,
        drawCount,
        remaining: queue.length + pendingReviews.length,
        reviewedFactCount: reviewedFactKeys.size,
        exhausted:
          !repeat &&
          cycle > 0 &&
          queue.length === 0 &&
          pendingReviews.length === 0,
      };
    },
  };
}

/** Small deterministic source for tests and repeatable local demos. */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
