import {
  MK_MECHANICS,
  type MkChoice,
  type MkMechanic,
  type MkRound,
} from "../../journey/reviews/math-kangaroo/engine.ts";
import type { JourneyReviewGradeBand } from "../../../lib/progression/types.ts";

export const MK_LAB_GRADE_BANDS = ["grades-1-2", "grades-3-4"] as const;
export const MK_LAB_POINT_VALUES = [3, 4, 5] as const;
export const MK_LAB_ANSWER_LETTERS = ["A", "B", "C", "D", "E"] as const;

export type MkLabGradeBand = JourneyReviewGradeBand | "all";
export type MkLabPointValue = (typeof MK_LAB_POINT_VALUES)[number];
export type MkLabPointFilter = MkLabPointValue | "all";
export type MkLabMechanicFilter = MkMechanic | "all";

export type MkLabFilters = Readonly<{
  gradeBand: MkLabGradeBand;
  points: MkLabPointFilter;
  mechanic: MkLabMechanicFilter;
}>;

export type MkLabAnswer = Readonly<{
  letter: (typeof MK_LAB_ANSWER_LETTERS)[number];
  sourceIndex: number;
  choice: MkChoice;
  correct: boolean;
}>;

export type MkLabDraw = Readonly<{
  round: MkRound;
  answers: readonly [
    MkLabAnswer,
    MkLabAnswer,
    MkLabAnswer,
    MkLabAnswer,
    MkLabAnswer,
  ];
  poolSize: number;
}>;

export const DEFAULT_MK_LAB_FILTERS: MkLabFilters = Object.freeze({
  gradeBand: "all",
  points: "all",
  mechanic: "all",
});

export const MK_LAB_MECHANIC_LABELS: Readonly<Record<MkMechanic, string>> = {
  assembly: "Assembly & fit",
  "rotation-reflection": "Rotation & reflection",
  "paths-directions": "Paths & directions",
  "objects-views": "Objects & views",
  "folding-nets": "Folding & nets",
  "layering-order": "Layering & order",
  "patterns-relations": "Patterns & relations",
  "other-spatial": "Other spatial",
};

export const MK_LAB_MECHANICS = MK_MECHANICS;

export function mathKangarooPointValue(
  questionNumber: number,
): MkLabPointValue {
  if (
    !Number.isInteger(questionNumber) ||
    questionNumber < 1 ||
    questionNumber > 24
  ) {
    throw new Error("Math Kangaroo question numbers must be between 1 and 24.");
  }
  if (questionNumber <= 8) return 3;
  if (questionNumber <= 16) return 4;
  return 5;
}

export function matchesMkLabFilters(
  round: MkRound,
  filters: MkLabFilters,
): boolean {
  return (
    (filters.gradeBand === "all" ||
      round.source.gradeBand === filters.gradeBand) &&
    (filters.points === "all" ||
      mathKangarooPointValue(round.source.questionNumber) === filters.points) &&
    (filters.mechanic === "all" || round.mechanic === filters.mechanic)
  );
}

export function filterMkLabRounds(
  rounds: readonly MkRound[],
  filters: MkLabFilters,
): readonly MkRound[] {
  return rounds.filter((round) => matchesMkLabFilters(round, filters));
}

function randomIndex(random: () => number, length: number): number {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error("A random selection needs at least one candidate.");
  }
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("The random source must return a number from 0 up to 1.");
  }
  return Math.floor(value * length);
}

export function shuffleMkLabAnswers(
  round: MkRound,
  random: () => number = Math.random,
): MkLabDraw["answers"] {
  const sourceIndexes = [0, 1, 2, 3, 4];

  for (let index = sourceIndexes.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(random, index + 1);
    [sourceIndexes[index], sourceIndexes[swapIndex]] = [
      sourceIndexes[swapIndex],
      sourceIndexes[index],
    ];
  }

  const presentedCorrectIndex = sourceIndexes.indexOf(round.correctIndex);
  if (presentedCorrectIndex === round.correctIndex) {
    const alternatives = sourceIndexes
      .map((_, index) => index)
      .filter((index) => index !== presentedCorrectIndex);
    const swapIndex = alternatives[randomIndex(random, alternatives.length)];
    [sourceIndexes[presentedCorrectIndex], sourceIndexes[swapIndex]] = [
      sourceIndexes[swapIndex],
      sourceIndexes[presentedCorrectIndex],
    ];
  }

  return mkLabAnswersFromSourceIndexes(round, sourceIndexes);
}

export function mkLabAnswersFromSourceIndexes(
  round: MkRound,
  sourceIndexes: readonly number[],
): MkLabDraw["answers"] {
  if (
    sourceIndexes.length !== MK_LAB_ANSWER_LETTERS.length ||
    sourceIndexes.some(
      (sourceIndex) =>
        !Number.isInteger(sourceIndex) ||
        sourceIndex < 0 ||
        sourceIndex >= MK_LAB_ANSWER_LETTERS.length,
    ) ||
    new Set(sourceIndexes).size !== MK_LAB_ANSWER_LETTERS.length
  ) {
    throw new Error("A saved Math Kangaroo answer order must contain 0–4 once.");
  }

  return sourceIndexes.map((sourceIndex, index) => ({
    letter: MK_LAB_ANSWER_LETTERS[index],
    sourceIndex,
    choice: round.choices[sourceIndex],
    correct: sourceIndex === round.correctIndex,
  })) as unknown as MkLabDraw["answers"];
}

export function drawMkLabQuestion({
  rounds,
  filters,
  seenIds = new Set<string>(),
  avoidId,
  random = Math.random,
}: Readonly<{
  rounds: readonly MkRound[];
  filters: MkLabFilters;
  seenIds?: ReadonlySet<string>;
  avoidId?: string;
  random?: () => number;
}>): MkLabDraw | null {
  const matching = filterMkLabRounds(rounds, filters);
  if (matching.length === 0) return null;

  let candidates = matching.filter(
    (round) => !seenIds.has(round.id) && round.id !== avoidId,
  );

  if (candidates.length === 0) {
    candidates = matching.filter(
      (round) => matching.length === 1 || round.id !== avoidId,
    );
  }

  if (candidates.length === 0) candidates = [...matching];

  const round = candidates[randomIndex(random, candidates.length)];
  return {
    round,
    answers: shuffleMkLabAnswers(round, random),
    poolSize: matching.length,
  };
}
