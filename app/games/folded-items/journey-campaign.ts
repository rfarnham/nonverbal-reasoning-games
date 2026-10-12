import {
  ROUNDS,
  buildAuthoredFoldedItemsRounds,
  roundFingerprint,
  validateRound,
  type AuthoredFoldedItemsRoundSpec,
  type Difficulty,
  type Round,
} from "./game-engine.ts";

export type FoldedItemsJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

const JUNIOR_ORDER = [3, 10, 0, 12, 6, 14, 8, 1, 13, 5, 15, 9, 2, 11, 4, 7] as const;
const EXPERT_ORDER = [9, 1, 14, 6, 0, 12, 7, 11, 4, 15, 2, 8, 13, 5, 10, 3] as const;
const WIZARD_ORDER = [5, 13, 2, 10, 15, 7, 0, 12, 1, 9, 14, 4, 8, 3, 11, 6] as const;

// Separate reviewed prompt inputs keep the II boards fresh. Every overlap,
// hidden-fold clue, answer and misconception is calculated by the native engine.
const JUNIOR_2_SPECS: readonly AuthoredFoldedItemsRoundSpec[] = [
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "letters", itemOrder: JUNIOR_ORDER, folds: ["up", "left"], targetCell: 2, correctIndex: 1, distractorSalt: 0 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: JUNIOR_ORDER, folds: ["up", "right"], targetCell: 1, correctIndex: 3, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: JUNIOR_ORDER, folds: ["down", "left"], targetCell: 0, correctIndex: 0, distractorSalt: 2 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "letters", itemOrder: JUNIOR_ORDER, folds: ["down", "right"], targetCell: 3, correctIndex: 2, distractorSalt: 0 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: JUNIOR_ORDER, folds: ["left", "up"], targetCell: 3, correctIndex: 1, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: JUNIOR_ORDER, folds: ["left", "down"], targetCell: 2, correctIndex: 0, distractorSalt: 2 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "letters", itemOrder: JUNIOR_ORDER, folds: ["right", "up"], targetCell: 1, correctIndex: 3, distractorSalt: 0 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: JUNIOR_ORDER, folds: ["right", "down"], targetCell: 0, correctIndex: 2, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: JUNIOR_ORDER, folds: ["up", "left"], targetCell: 0, correctIndex: 0, distractorSalt: 2 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "letters", itemOrder: JUNIOR_ORDER, folds: ["left", "down"], targetCell: 0, correctIndex: 2, distractorSalt: 0 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: JUNIOR_ORDER, folds: ["up", "right"], targetCell: 2, correctIndex: 1, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Medium", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: JUNIOR_ORDER, folds: ["right", "up"], targetCell: 3, correctIndex: 3, distractorSalt: 2 },
];

const EXPERT_2_SPECS: readonly AuthoredFoldedItemsRoundSpec[] = [
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: EXPERT_ORDER, folds: ["up", "left"], targetCell: 3, correctIndex: 2, distractorSalt: 0 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: EXPERT_ORDER, folds: ["down", "right"], targetCell: 0, correctIndex: 0, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: EXPERT_ORDER, folds: ["left", "up"], targetCell: 1, correctIndex: 3, distractorSalt: 2 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: EXPERT_ORDER, folds: ["right", "down"], targetCell: 2, correctIndex: 1, distractorSalt: 0 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: EXPERT_ORDER, folds: ["up", "up"], targetCell: 1, correctIndex: 2, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: EXPERT_ORDER, folds: ["down", "down"], targetCell: 0, correctIndex: 1, distractorSalt: 2 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: EXPERT_ORDER, folds: ["left", "left"], targetCell: 2, correctIndex: 0, distractorSalt: 0 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: EXPERT_ORDER, folds: ["right", "right"], targetCell: 3, correctIndex: 3, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: EXPERT_ORDER, folds: ["up", "down"], targetCell: 2, correctIndex: 1, distractorSalt: 2 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: EXPERT_ORDER, folds: ["down", "up"], targetCell: 3, correctIndex: 3, distractorSalt: 0 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: EXPERT_ORDER, folds: ["left", "right"], targetCell: 0, correctIndex: 2, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Hard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: EXPERT_ORDER, folds: ["right", "left"], targetCell: 1, correctIndex: 0, distractorSalt: 2 },
];

const WIZARD_2_SPECS: readonly AuthoredFoldedItemsRoundSpec[] = [
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: WIZARD_ORDER, folds: ["up", "left"], targetCell: 0, correctIndex: 0, distractorSalt: 0 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: WIZARD_ORDER, folds: ["down", "right"], targetCell: 3, correctIndex: 2, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: WIZARD_ORDER, folds: ["left", "up"], targetCell: 2, correctIndex: 3, distractorSalt: 2 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: WIZARD_ORDER, folds: ["right", "down"], targetCell: 1, correctIndex: 1, distractorSalt: 0 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: WIZARD_ORDER, folds: ["up", "up"], targetCell: 2, correctIndex: 3, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: WIZARD_ORDER, folds: ["down", "down"], targetCell: 3, correctIndex: 0, distractorSalt: 2 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: WIZARD_ORDER, folds: ["left", "left"], targetCell: 1, correctIndex: 1, distractorSalt: 0 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: WIZARD_ORDER, folds: ["right", "right"], targetCell: 0, correctIndex: 2, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: WIZARD_ORDER, folds: ["up", "down"], targetCell: 3, correctIndex: 3, distractorSalt: 2 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "letters", itemOrder: WIZARD_ORDER, folds: ["down", "up"], targetCell: 0, correctIndex: 1, distractorSalt: 0 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "numbers", itemOrder: WIZARD_ORDER, folds: ["left", "right"], targetCell: 1, correctIndex: 0, distractorSalt: 1, numberOffset: 41 },
  { difficulty: "Wizard", rows: 4, cols: 4, itemStyle: "flowers", itemOrder: WIZARD_ORDER, folds: ["right", "left"], targetCell: 2, correctIndex: 2, distractorSalt: 2 },
];

const SPECS: Readonly<Record<FoldedItemsJourneyExtraLevel, readonly AuthoredFoldedItemsRoundSpec[]>> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<Record<FoldedItemsJourneyExtraLevel, Difficulty>> = {
  "junior-2": "Medium",
  "expert-2": "Hard",
  "wizard-2": "Wizard",
};

function assertAnswerSchedule(level: FoldedItemsJourneyExtraLevel, rounds: readonly Round[]): void {
  const positions = rounds.map(({ correctIndex }) => correctIndex);
  if ([0, 1, 2, 3].some((position) => positions.filter((value) => value === position).length !== 3)) {
    throw new Error(`${level} answer positions must balance 3/3/3/3.`);
  }
  if (positions.some((position, index) => index > 0 && positions[index - 1] === position)) {
    throw new Error(`${level} cannot repeat adjacent answer positions.`);
  }
  const blocks = [0, 4, 8].map((start) => positions.slice(start, start + 4).join(","));
  if (new Set(blocks).size !== blocks.length) {
    throw new Error(`${level} cannot repeat a four-position cycle.`);
  }
}

export function buildFoldedItemsJourneyExtraCampaignRounds(): Readonly<Record<FoldedItemsJourneyExtraLevel, readonly Round[]>> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<FoldedItemsJourneyExtraLevel, readonly Round[]>;
  for (const level of ["junior-2", "expert-2", "wizard-2"] as const) {
    const rounds = buildAuthoredFoldedItemsRounds(SPECS[level], `Folded Items ${level}`);
    assertAnswerSchedule(level, rounds);
    for (const round of rounds) {
      if (round.difficulty !== DIFFICULTY_BY_LEVEL[level]) {
        throw new Error(`${level} contains the wrong difficulty.`);
      }
      const errors = validateRound(round);
      if (errors.length > 0) {
        throw new Error(`${level} is invalid: ${errors.join("; ")}`);
      }
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(`${level} repeats a standalone or Journey Folded Items round.`);
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }
  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS = buildFoldedItemsJourneyExtraCampaignRounds();
