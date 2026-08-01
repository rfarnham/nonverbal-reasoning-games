export const SLOW_RESPONSE_MS = 4_000;
export const REVIEW_SPACING = 4;

export const ANSWER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const VISUAL_ORIENTATIONS = ["horizontal", "vertical"] as const;
export const LISTEN_COPIES = 3;

export type AnswerValue = (typeof ANSWER_VALUES)[number];
export type VisualOrientation = (typeof VISUAL_ORIENTATIONS)[number];
export type PracticeMode = "visual" | "listen";
export type RandomSource = () => number;

export type SubtractionFact = Readonly<{
  factKey: string;
  minuend: number;
  subtrahend: number;
  answer: AnswerValue;
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
    minuend <= 18 &&
    subtrahend >= 2 &&
    subtrahend <= 9 &&
    minuend % 10 < subtrahend
  );
}

export const SUBTRACTION_FACTS: readonly SubtractionFact[] = Object.freeze(
  Array.from({ length: 8 }, (_, minuendOffset) => 11 + minuendOffset).flatMap(
    (minuend) =>
      Array.from({ length: 8 }, (_, subtrahendOffset) => 2 + subtrahendOffset)
        .filter((subtrahend) => requiresBorrow(minuend, subtrahend))
        .map((subtrahend) => ({
          factKey: `${minuend}-${subtrahend}`,
          minuend,
          subtrahend,
          answer: (minuend - subtrahend) as AnswerValue,
        })),
  ),
);

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
  if (mode === "visual") {
    return VISUAL_ORIENTATIONS.map((orientation) => ({
      ...fact,
      id: `${mode}:${cycle}:${fact.factKey}:${orientation}`,
      orientation,
      isReview: false,
    }));
  }

  return Array.from({ length: LISTEN_COPIES }, (_, index) => ({
    ...fact,
    id: `${mode}:${cycle}:${fact.factKey}:copy-${index + 1}`,
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
  }> = {},
): SubtractionCard[] {
  const random = options.random ?? Math.random;
  const cycle = options.cycle ?? 1;
  const cards = SUBTRACTION_FACTS.flatMap((fact) =>
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
  if (!ANSWER_VALUES.includes(fact.answer)) {
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
    random?: RandomSource;
    repeat?: boolean;
  }>,
): SubtractionDeck {
  const { mode } = options;
  const random = options.random ?? Math.random;
  const repeat = options.repeat ?? true;
  const baseDeckSize =
    SUBTRACTION_FACTS.length *
    (mode === "visual"
      ? VISUAL_ORIENTATIONS.length
      : LISTEN_COPIES);
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
