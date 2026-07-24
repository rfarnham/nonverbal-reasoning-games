import {
  ROUNDS,
  buildAuthoredBraidRounds,
  roundFingerprint,
  type AuthoredBraidRoundSpec,
  type Difficulty,
  type Round,
} from "./game-engine.ts";

export type BraidJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

type FrozenRoundSpec = readonly [
  crossingCode: string,
  variant: number,
  correctIndex: number,
  columns: number,
  rows: number,
];

// These hand-selected crossing programs extend the canonical curriculum
// without changing its mechanics. Junior II alternates wide and tall panes,
// Expert II keeps both body colors and endpoint motifs, and Wizard II removes
// the body-color scaffold while retaining the same 3x3 reasoning density.
const JUNIOR_2_SPECS: readonly FrozenRoundSpec[] = [
  ["001011", 17, 1, 3, 2],
  ["111000", 18, 3, 2, 3],
  ["010110", 19, 0, 3, 2],
  ["101011", 20, 2, 2, 3],
  ["011010", 21, 1, 3, 2],
  ["110100", 22, 0, 2, 3],
  ["000110", 23, 3, 3, 2],
  ["111010", 24, 2, 2, 3],
  ["100101", 25, 0, 3, 2],
  ["011011", 26, 2, 2, 3],
  ["110110", 27, 1, 3, 2],
  ["001111", 28, 3, 2, 3],
];

const EXPERT_2_SPECS: readonly FrozenRoundSpec[] = [
  ["000101010", 23, 2, 3, 3],
  ["111010100", 24, 0, 3, 3],
  ["010100111", 25, 3, 3, 3],
  ["101111000", 26, 1, 3, 3],
  ["011000110", 27, 2, 3, 3],
  ["110011001", 28, 1, 3, 3],
  ["000111010", 29, 0, 3, 3],
  ["111100010", 30, 3, 3, 3],
  ["001110101", 31, 1, 3, 3],
  ["100101011", 32, 3, 3, 3],
  ["011111100", 33, 2, 3, 3],
  ["101000111", 34, 0, 3, 3],
];

const WIZARD_2_SPECS: readonly FrozenRoundSpec[] = [
  ["000101100", 41, 0, 3, 3],
  ["111011100", 42, 2, 3, 3],
  ["001101011", 43, 3, 3, 3],
  ["110010011", 44, 1, 3, 3],
  ["010110110", 45, 3, 3, 3],
  ["101001101", 46, 0, 3, 3],
  ["011011000", 47, 1, 3, 3],
  ["100100111", 48, 2, 3, 3],
  ["001111100", 49, 1, 3, 3],
  ["110100011", 50, 3, 3, 3],
  ["010011110", 51, 0, 3, 3],
  ["101110001", 52, 2, 3, 3],
];

const FROZEN_SPECS: Readonly<
  Record<BraidJourneyExtraLevel, readonly FrozenRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<BraidJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Junior",
  "expert-2": "Expert",
  "wizard-2": "Wizard",
};

function expandedSpecs(
  level: BraidJourneyExtraLevel,
): readonly AuthoredBraidRoundSpec[] {
  return FROZEN_SPECS[level].map(
    ([crossingCode, variant, correctIndex, columns, rows]) => ({
      crossingCode,
      variant,
      correctIndex,
      columns,
      rows,
    }),
  );
}

export function buildBraidJourneyExtraCampaignRounds(): Readonly<
  Record<BraidJourneyExtraLevel, readonly Round[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    BraidJourneyExtraLevel,
    readonly Round[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const difficulty = DIFFICULTY_BY_LEVEL[level];
    const rounds = buildAuthoredBraidRounds(
      difficulty,
      expandedSpecs(level),
      `Braids ${level}`,
    );

    for (const round of rounds) {
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Braids round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }

  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildBraidJourneyExtraCampaignRounds();
