export const SLOW_RESPONSE_MS = 4_000;
export const REVIEW_SPACING = 4;

export const ANSWER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const VISUAL_ORIENTATIONS = ["horizontal", "vertical"] as const;
export const LISTEN_COPIES = 3;
export const SUBTRACTION_LEVELS = ["B100", "B120", "B140"] as const;

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
  B140: Object.freeze({
    label: "B140",
    minuendMin: 20,
    minuendMax: 99,
    subtrahendMin: 10,
    subtrahendMax: 89,
    answerDigits: 2,
    includesTenReview: false,
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
  firstAttempt: boolean;
  firstAttemptMiss: boolean;
  resolved: boolean;
}>;

export type SubtractionDeckPhase = "practice" | "redemption" | "complete";

export type RedemptionStart = Readonly<{
  started: boolean;
  pending: number;
  phase: SubtractionDeckPhase;
}>;

export type SubtractionDeck = Readonly<{
  next(): DeckDraw;
  recordOutcome(card: SubtractionCard, outcome: AnswerOutcome): OutcomeRecord;
  /**
   * End the scored part of a run and expose each first-attempt miss or slow
   * response once.
   * Any unplayed practice cards are deliberately discarded, which lets timed
   * and manually-finished Infinite runs share the same redemption path.
   */
  beginRedemption(): RedemptionStart;
  snapshot(): Readonly<{
    cycle: number;
    drawCount: number;
    remaining: number;
    reviewedFactCount: number;
    redemptionPending: number;
    practiceExhausted: boolean;
    phase: SubtractionDeckPhase;
    exhausted: boolean;
  }>;
}>;

export function requiresBorrow(minuend: number, subtrahend: number): boolean {
  return (
    Number.isInteger(minuend) &&
    Number.isInteger(subtrahend) &&
    minuend >= 11 &&
    subtrahend >= 2 &&
    minuend > subtrahend &&
    minuend % 10 < subtrahend % 10
  );
}

/**
 * B140 deliberately uses a compact, authored fact catalogue rather than the
 * several thousand mathematically valid two-digit subtraction facts. The 64
 * pairs cover every minuend decade, contain 32 borrow and 32 non-borrow facts,
 * and include both ends of each configured operand/result range.
 */
const B140_OPERAND_PAIRS = [
  [20, 10],
  [21, 10],
  [22, 11],
  [23, 11],
  [24, 12],
  [25, 13],
  [28, 14],
  [29, 13],
  [30, 14],
  [31, 12],
  [32, 18],
  [33, 23],
  [36, 12],
  [37, 18],
  [38, 25],
  [39, 25],
  [40, 22],
  [41, 11],
  [43, 32],
  [44, 28],
  [45, 23],
  [46, 17],
  [47, 22],
  [48, 19],
  [50, 10],
  [52, 35],
  [53, 25],
  [54, 31],
  [55, 30],
  [56, 37],
  [57, 18],
  [59, 36],
  [61, 15],
  [62, 31],
  [63, 36],
  [64, 21],
  [65, 16],
  [66, 48],
  [68, 19],
  [69, 47],
  [70, 47],
  [71, 41],
  [72, 31],
  [73, 28],
  [74, 29],
  [75, 18],
  [76, 19],
  [79, 44],
  [81, 49],
  [82, 36],
  [83, 56],
  [84, 56],
  [85, 22],
  [87, 17],
  [88, 29],
  [89, 23],
  [90, 77],
  [91, 56],
  [92, 11],
  [93, 17],
  [94, 67],
  [96, 78],
  [99, 10],
  [99, 89],
] as const satisfies readonly (readonly [number, number])[];

function createB140Facts(
  config: SubtractionLevelConfig,
): readonly SubtractionFact[] {
  return Object.freeze(
    B140_OPERAND_PAIRS.map(([minuend, subtrahend]) => ({
      level: config.label,
      factKey: `${minuend}-${subtrahend}`,
      minuend,
      subtrahend,
      answer: minuend - subtrahend,
    })),
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
  B140: createB140Facts(SUBTRACTION_LEVEL_CONFIG.B140),
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
  const attemptedCardIds = new Set<string>();
  const missedCardsByFact = new Map<string, SubtractionCard>();
  const redeemedFactKeys = new Set<string>();
  let queue: SubtractionCard[] = [];
  let redemptionQueue: SubtractionCard[] = [];
  let activePracticeCard: SubtractionCard | null = null;
  let activeRedemptionCard: SubtractionCard | null = null;
  let phase: SubtractionDeckPhase = "practice";
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

  };

  const redemptionPending = () =>
    Math.max(0, missedCardsByFact.size - redeemedFactKeys.size);

  const startRedemption = (): RedemptionStart => {
    if (phase !== "practice") {
      return {
        started: false,
        pending: redemptionPending(),
        phase,
      };
    }

    // A timed/manual finish ends the main run immediately. Redemption is a
    // separate, untimed queue and never resumes the abandoned base deck.
    queue = [];
    activePracticeCard = null;
    redemptionQueue = shuffledWithFactSpacing(
      [...missedCardsByFact.values()].map((card) => ({
        ...card,
        id: `${card.id}:redemption`,
        isReview: true,
      })),
      random,
      recentFactKeys,
    );
    phase = redemptionQueue.length > 0 ? "redemption" : "complete";

    return {
      started: true,
      pending: redemptionPending(),
      phase,
    };
  };

  return {
    next() {
      if (phase === "complete") {
        throw new Error("Subtraction deck is exhausted.");
      }

      if (phase === "redemption") {
        if (activeRedemptionCard) {
          throw new Error(
            "The active redemption card must be solved before advancing.",
          );
        }
        const card = redemptionQueue.shift();
        if (!card) {
          phase = "complete";
          throw new Error("Subtraction deck is exhausted.");
        }

        activeRedemptionCard = card;
        drawCount += 1;
        recentFactKeys.push(card.factKey);
        if (recentFactKeys.length > REVIEW_SPACING) recentFactKeys.shift();

        return {
          card,
          drawNumber: drawCount,
          cycle,
          remaining: redemptionQueue.length,
          baseDeckSize,
        };
      }

      if (activePracticeCard) {
        throw new Error(
          "The active practice card must be solved before advancing.",
        );
      }

      if (queue.length === 0) {
        if (cycle === 0 || repeat) {
          refillBaseDeck();
        } else if (missedCardsByFact.size > 0) {
          startRedemption();
          return this.next();
        } else {
          phase = "complete";
        }
      }
      const card = queue.shift();
      if (!card) throw new Error("Subtraction deck is exhausted.");

      activePracticeCard = card;
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
      const activeCard =
        phase === "practice" ? activePracticeCard : activeRedemptionCard;
      if (!activeCard || activeCard.id !== card.id) {
        throw new Error("Outcome does not match the active subtraction card.");
      }

      const elapsedMs =
        Number.isFinite(outcome.elapsedMs) && outcome.elapsedMs >= 0
          ? outcome.elapsedMs
          : 0;
      // Redemption is deliberately untimed. Long review attempts may still be
      // logged by the caller, but they never carry the gameplay "slow" flag.
      const slow = !card.isReview && elapsedMs > SLOW_RESPONSE_MS;
      const incorrect = !outcome.correct;
      const flagged = incorrect || slow;
      const firstAttempt = !attemptedCardIds.has(card.id);
      attemptedCardIds.add(card.id);
      const firstAttemptMiss = firstAttempt && incorrect && !card.isReview;
      const reason =
        incorrect && slow
          ? "both"
          : incorrect
            ? "incorrect"
            : slow
              ? "slow"
              : null;

      let reinserted = false;
      if (
        phase === "practice" &&
        firstAttempt &&
        flagged &&
        !card.isReview &&
        !missedCardsByFact.has(card.factKey)
      ) {
        missedCardsByFact.set(card.factKey, card);
        reinserted = true;
      }

      if (
        phase === "redemption" &&
        activeRedemptionCard?.id === card.id &&
        outcome.correct
      ) {
        redeemedFactKeys.add(card.factKey);
        activeRedemptionCard = null;
        if (redemptionQueue.length === 0) phase = "complete";
      }
      if (
        phase === "practice" &&
        activePracticeCard?.id === card.id &&
        outcome.correct
      ) {
        activePracticeCard = null;
      }

      return {
        flagged,
        reinserted,
        reason,
        firstAttempt,
        firstAttemptMiss,
        resolved: outcome.correct,
      };
    },

    beginRedemption() {
      return startRedemption();
    },

    snapshot() {
      const practiceExhausted =
        phase !== "practice" ||
        (!repeat &&
          cycle > 0 &&
          queue.length === 0 &&
          activePracticeCard === null);
      return {
        cycle,
        drawCount,
        remaining:
          phase === "practice"
            ? queue.length + missedCardsByFact.size
            : redemptionQueue.length,
        reviewedFactCount: missedCardsByFact.size,
        redemptionPending: redemptionPending(),
        practiceExhausted,
        phase,
        exhausted:
          phase === "complete" ||
          (phase === "practice" &&
            practiceExhausted &&
            missedCardsByFact.size === 0),
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
