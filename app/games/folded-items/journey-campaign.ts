import { CAMPAIGN_ROUND_SPECS } from "./campaign-data.ts";
import { ROUNDS, buildAuthoredFoldedItemsRounds, roundFingerprint, validateRound, type AuthoredFoldedItemsRoundSpec, type Difficulty, type Round } from "./game-engine.ts";

export type FoldedItemsJourneyExtraLevel = "junior-2" | "expert-2" | "wizard-2";
const JUNIOR_ORDER = [3, 10, 0, 12, 6, 14, 8, 1, 13, 5, 15, 9, 2, 11, 4, 7] as const;
const EXPERT_ORDER = [9, 1, 24, 6, 0, 12, 17, 11, 4, 15, 22, 8, 13, 5, 20, 3, 16, 21, 7, 18, 2, 14, 23, 10, 19] as const;
const WIZARD_ORDER = [5, 13, 22, 10, 15, 7, 0, 12, 1, 9, 24, 4, 8, 3, 11, 6, 21, 18, 2, 17, 14, 20, 19, 23, 16] as const;
const LEVELS = ["junior-2", "expert-2", "wizard-2"] as const;
const DIFFICULTY_BY_LEVEL: Readonly<Record<FoldedItemsJourneyExtraLevel, Difficulty>> = { "junior-2": "Medium", "expert-2": "Hard", "wizard-2": "Wizard" };
const ORDERS = { "junior-2": JUNIOR_ORDER, "expert-2": EXPERT_ORDER, "wizard-2": WIZARD_ORDER } as const;

// Distinct, game-owned authored source arrangements preserve the established
// fold curriculum without adding any questions to standalone Campaign.
const SPECS = Object.fromEntries(LEVELS.map((level, levelIndex) => [level,
  CAMPAIGN_ROUND_SPECS.filter(({ difficulty }) => difficulty === DIFFICULTY_BY_LEVEL[level]).map((spec, index): AuthoredFoldedItemsRoundSpec => ({
    ...spec, itemOrder: ORDERS[level], targetDepth: (index + levelIndex + 2) % 4,
    correctIndex: (spec.correctIndex + 1) % 4, distractorSalt: index + 17,
    numberOffset: 41,
  })),
])) as unknown as Readonly<Record<FoldedItemsJourneyExtraLevel, readonly AuthoredFoldedItemsRoundSpec[]>>;

function assertAnswerSchedule(level: FoldedItemsJourneyExtraLevel, rounds: readonly Round[]): void {
  const positions = rounds.map(({ correctIndex }) => correctIndex);
  if ([0, 1, 2, 3].some((position) => positions.filter((value) => value === position).length !== 3)) throw new Error(`${level} answer positions must balance 3/3/3/3.`);
  if (positions.some((position, index) => index > 0 && positions[index - 1] === position)) throw new Error(`${level} cannot repeat adjacent answer positions.`);
  if (new Set([0, 4, 8].map((start) => positions.slice(start, start + 4).join(","))).size !== 3) throw new Error(`${level} cannot repeat a four-position cycle.`);
}
export function buildFoldedItemsJourneyExtraCampaignRounds(): Readonly<Record<FoldedItemsJourneyExtraLevel, readonly Round[]>> {
  const used = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<FoldedItemsJourneyExtraLevel, readonly Round[]>;
  for (const level of LEVELS) {
    const rounds = buildAuthoredFoldedItemsRounds(SPECS[level], `Folded Items ${level}`);
    assertAnswerSchedule(level, rounds);
    for (const round of rounds) {
      if (round.difficulty !== DIFFICULTY_BY_LEVEL[level]) throw new Error(`${level} contains the wrong difficulty.`);
      const errors = validateRound(round);
      if (errors.length) throw new Error(`${level} is invalid: ${errors.join("; ")}`);
      const fingerprint = roundFingerprint(round);
      if (used.has(fingerprint)) throw new Error(`${level} repeats a standalone or Journey Folded Items round.`);
      used.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }
  return Object.freeze(result);
}
export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS = buildFoldedItemsJourneyExtraCampaignRounds();
