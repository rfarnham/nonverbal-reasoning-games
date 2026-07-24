import {
  ROUNDS,
  buildAuthoredLibraRounds,
  roundFingerprint,
  type AuthoredLibraRoundSpec,
  type Difficulty,
  type Round,
} from "./game-engine.ts";
import { assertSoundTeachingRound } from "./strategy-curriculum.ts";

export type LibraJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

const JUNIOR_2_SPECS: readonly AuthoredLibraRoundSpec[] = [
  { difficulty: "Junior", family: "chain", creatures: ["turtle", "owl", "chick"], bridgeWeight: 3, multiplier: 2, offset: 0, correctIndex: 1 },
  { difficulty: "Junior", family: "offset-chain", creatures: ["bear", "frog", "beetle"], bridgeWeight: 2, multiplier: 3, offset: 1, correctIndex: 3 },
  { difficulty: "Junior", family: "chain", creatures: ["cat", "rabbit", "goose"], bridgeWeight: 2, multiplier: 3, offset: 0, correctIndex: 0 },
  { difficulty: "Junior", family: "offset-chain", creatures: ["fox", "turtle", "owl"], bridgeWeight: 4, multiplier: 2, offset: 2, correctIndex: 2 },
  { difficulty: "Junior", family: "combo-primer", creatures: ["bear", "cat", "frog"], firstWeight: 2, secondWeight: 2, coefficient: 2, correctIndex: 1 },
  { difficulty: "Junior", family: "combo-primer", creatures: ["owl", "fox", "chick"], firstWeight: 1, secondWeight: 2, coefficient: 2, correctIndex: 0 },
  { difficulty: "Junior", family: "add-combo", creatures: ["rabbit", "bear", "turtle"], firstWeight: 2, secondWeight: 3, coefficient: 2, correctIndex: 3 },
  { difficulty: "Junior", family: "add-combo", creatures: ["goose", "cat", "beetle"], firstWeight: 1, secondWeight: 3, coefficient: 2, correctIndex: 2 },
  { difficulty: "Junior", family: "combo-primer", creatures: ["frog", "turtle", "owl"], firstWeight: 1, secondWeight: 1, coefficient: 3, correctIndex: 0 },
  { difficulty: "Junior", family: "add-combo", creatures: ["fox", "rabbit", "chick"], firstWeight: 2, secondWeight: 2, coefficient: 2, correctIndex: 2 },
  { difficulty: "Junior", family: "subtract-combo", creatures: ["cat", "goose", "turtle"], firstWeight: 1, secondWeight: 1, coefficient: 2, correctIndex: 1 },
  { difficulty: "Junior", family: "subtract-combo", creatures: ["bear", "owl", "beetle"], firstWeight: 1, secondWeight: 1, coefficient: 2, correctIndex: 3 },
];

const EXPERT_2_SPECS: readonly AuthoredLibraRoundSpec[] = [
  { difficulty: "Expert", family: "fork", creatures: ["turtle", "fox", "bear", "chick"], parameters: [3, 2, 2, 1], composite: false, correctIndex: 2 },
  { difficulty: "Expert", family: "cross", creatures: ["rabbit", "owl", "cat", "beetle"], parameters: [2, 6, 1], composite: false, correctIndex: 0 },
  { difficulty: "Expert", family: "parallel", creatures: ["goose", "turtle", "frog", "bear"], parameters: [2, 5, 1], composite: false, correctIndex: 3 },
  { difficulty: "Expert", family: "sum-combo", creatures: ["fox", "cat", "owl", "chick"], parameters: [1, 3, 2], correctIndex: 1 },
  { difficulty: "Expert", family: "difference", creatures: ["bear", "rabbit", "goose", "turtle"], parameters: [3, 2, 2], correctIndex: 2 },
  { difficulty: "Expert", family: "combo-bridge", creatures: ["owl", "frog", "cat", "beetle"], parameters: [1, 1, 3], correctIndex: 1 },
  { difficulty: "Expert", family: "fork", creatures: ["cat", "goose", "turtle", "frog"], parameters: [2, 3, 1, 2], composite: false, correctIndex: 0 },
  { difficulty: "Expert", family: "cross", creatures: ["bear", "fox", "rabbit", "chick"], parameters: [1, 5, 3], composite: false, correctIndex: 3 },
  { difficulty: "Expert", family: "parallel", creatures: ["owl", "turtle", "goose", "beetle"], parameters: [4, 6, 2], composite: false, correctIndex: 1 },
  { difficulty: "Expert", family: "sum-combo", creatures: ["rabbit", "cat", "bear", "frog"], parameters: [3, 1, 2], correctIndex: 3 },
  { difficulty: "Expert", family: "difference", creatures: ["fox", "owl", "turtle", "chick"], parameters: [2, 3, 2], correctIndex: 2 },
  { difficulty: "Expert", family: "combo-bridge", creatures: ["goose", "bear", "cat", "beetle"], parameters: [1, 1, 3], correctIndex: 0 },
];

const WIZARD_2_SPECS: readonly AuthoredLibraRoundSpec[] = [
  { difficulty: "Wizard", family: "sealed-cancellation", creatures: ["frog", "bear", "owl", "chick"], targetMultiplier: 2, targetWeight: 3, bridgeWeight: 1, composite: false, correctIndex: 0 },
  { difficulty: "Wizard", family: "sealed-cancellation", creatures: ["turtle", "cat", "fox", "beetle"], targetMultiplier: 3, targetWeight: 2, bridgeWeight: 1, composite: false, correctIndex: 2 },
  { difficulty: "Wizard", family: "sealed-cancellation", creatures: ["rabbit", "goose", "bear", "frog"], targetMultiplier: 2, targetWeight: 2, bridgeWeight: 3, composite: true, correctIndex: 3 },
  { difficulty: "Wizard", family: "sealed-cancellation", creatures: ["owl", "fox", "turtle", "chick"], targetMultiplier: 3, targetWeight: 1, bridgeWeight: 2, composite: true, correctIndex: 1 },
  { difficulty: "Wizard", family: "sealed-sum", creatures: ["cat", "rabbit", "goose", "beetle"], coefficient: 2, firstWeight: 2, secondWeight: 2, mysteryWeight: 1, composite: false, correctIndex: 3 },
  { difficulty: "Wizard", family: "sealed-sum", creatures: ["bear", "turtle", "owl", "frog"], coefficient: 3, firstWeight: 1, secondWeight: 1, mysteryWeight: 1, composite: false, correctIndex: 0 },
  { difficulty: "Wizard", family: "sealed-sum", creatures: ["fox", "goose", "cat", "chick"], coefficient: 2, firstWeight: 1, secondWeight: 2, mysteryWeight: 1, composite: true, correctIndex: 1 },
  { difficulty: "Wizard", family: "sealed-sum", creatures: ["rabbit", "owl", "bear", "beetle"], coefficient: 3, firstWeight: 1, secondWeight: 1, mysteryWeight: 1, composite: true, correctIndex: 2 },
  { difficulty: "Wizard", family: "sealed-difference", creatures: ["turtle", "fox", "goose", "frog"], coefficient: 3, firstWeight: 1, secondWeight: 1, mysteryWeight: 1, composite: false, correctIndex: 1 },
  { difficulty: "Wizard", family: "sealed-difference", creatures: ["cat", "bear", "rabbit", "chick"], coefficient: 2, firstWeight: 1, secondWeight: 2, mysteryWeight: 1, composite: false, correctIndex: 3 },
  { difficulty: "Wizard", family: "sealed-difference", creatures: ["owl", "turtle", "fox", "beetle"], coefficient: 3, firstWeight: 1, secondWeight: 1, mysteryWeight: 1, composite: true, correctIndex: 0 },
  { difficulty: "Wizard", family: "sealed-difference", creatures: ["goose", "cat", "bear", "frog"], coefficient: 2, firstWeight: 2, secondWeight: 1, mysteryWeight: 1, composite: true, correctIndex: 2 },
];

const SPECS: Readonly<
  Record<LibraJourneyExtraLevel, readonly AuthoredLibraRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<LibraJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Junior",
  "expert-2": "Expert",
  "wizard-2": "Wizard",
};

export function buildLibraJourneyExtraCampaignRounds(): Readonly<
  Record<LibraJourneyExtraLevel, readonly Round[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    LibraJourneyExtraLevel,
    readonly Round[]
  >;

  const levels = [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const;
  for (const [levelIndex, level] of levels.entries()) {
    const rounds = buildAuthoredLibraRounds(
      `journey-${level}`,
      DIFFICULTY_BY_LEVEL[level],
      SPECS[level],
      100 + levelIndex * 12,
    );
    for (const round of rounds) {
      assertSoundTeachingRound(round);
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Libra round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }

  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildLibraJourneyExtraCampaignRounds();
