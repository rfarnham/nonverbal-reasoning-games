import {
  ROUNDS,
  buildAuthoredRounds,
  roundFingerprint,
  validateRound,
  type Difficulty,
  type ExtraPieceRound,
} from "./game-engine.ts";

export type ExtraPieceJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<ExtraPieceJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Medium",
  "expert-2": "Hard",
  "wizard-2": "Wizard",
};

export function buildExtraPieceJourneyExtraCampaignRounds(): Readonly<
  Record<ExtraPieceJourneyExtraLevel, readonly ExtraPieceRound[]>
> {
  const alternateCorpus = buildAuthoredRounds(2);
  const used = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    ExtraPieceJourneyExtraLevel,
    readonly ExtraPieceRound[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const difficulty = DIFFICULTY_BY_LEVEL[level];
    const rounds = alternateCorpus
      .filter((round) => round.difficulty === difficulty)
      .map((round, index) => ({
        ...round,
        id: `journey:${level}:${String(index + 1).padStart(2, "0")}`,
      }));
    if (rounds.length !== 12) {
      throw new Error(`${level} must contain exactly 12 Extra Piece rounds.`);
    }
    for (const round of rounds) {
      const validation = validateRound(round);
      if (!validation.valid) {
        throw new Error(
          `${round.id} is invalid: ${validation.issues.join("; ")}`,
        );
      }
      const fingerprint = roundFingerprint(round);
      if (used.has(fingerprint)) {
        throw new Error(`${round.id} repeats earlier Extra Piece content.`);
      }
      used.add(fingerprint);
    }
    result[level] = Object.freeze(rounds);
  }
  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildExtraPieceJourneyExtraCampaignRounds();
