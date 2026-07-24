import {
  ROUNDS,
  buildAuthoredChangingStripsRounds,
  roundFingerprint,
  validateRound,
  type AuthoredChangingStripsRoundSpec,
  type Difficulty,
  type StripRound,
} from "./game-engine.ts";

export type ChangingStripsJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

const ANSWER_SCHEDULES = {
  "junior-2": [1, 3, 1, 0, 2, 1, 2, 0, 3, 2, 3, 0],
  "expert-2": [3, 2, 3, 0, 1, 3, 1, 0, 2, 0, 2, 1],
  "wizard-2": [3, 2, 3, 0, 1, 2, 1, 3, 0, 1, 0, 2],
} as const satisfies Readonly<
  Record<
    ChangingStripsJourneyExtraLevel,
    readonly (0 | 1 | 2 | 3)[]
  >
>;

const DIFFICULTY_BY_LEVEL = {
  "junior-2": "Junior",
  "expert-2": "Expert",
  "wizard-2": "Wizard",
} as const satisfies Readonly<
  Record<ChangingStripsJourneyExtraLevel, Difficulty>
>;

function specsForLevel(
  level: ChangingStripsJourneyExtraLevel,
): readonly AuthoredChangingStripsRoundSpec[] {
  return ANSWER_SCHEDULES[level].map((correctIndex, index) => ({
    authoredIndex: 12 + index,
    correctIndex,
  }));
}

function assertAnswerSchedule(
  level: ChangingStripsJourneyExtraLevel,
  rounds: readonly StripRound[],
): void {
  const positions = rounds.map(({ correctIndex }) => correctIndex);
  const counts = [0, 1, 2, 3].map(
    (position) => positions.filter((value) => value === position).length,
  );
  if (counts.some((count) => count !== 3)) {
    throw new Error(`${level} answer positions must balance 3/3/3/3.`);
  }
  if (
    positions.some(
      (position, index) =>
        index > 0 && positions[index - 1] === position,
    )
  ) {
    throw new Error(`${level} cannot repeat adjacent answer positions.`);
  }
  const blocks = [0, 4, 8].map((start) =>
    positions.slice(start, start + 4),
  );
  if (
    new Set(blocks.map((block) => block.join(","))).size !==
    blocks.length
  ) {
    throw new Error(`${level} cannot repeat a four-position cycle.`);
  }
  if (blocks.some((block) => new Set(block).size === 4)) {
    throw new Error(
      `${level} cannot reveal one answer in every position per four-question block.`,
    );
  }
}

export function buildChangingStripsJourneyExtraCampaignRounds(): Readonly<
  Record<ChangingStripsJourneyExtraLevel, readonly StripRound[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    ChangingStripsJourneyExtraLevel,
    readonly StripRound[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const difficulty = DIFFICULTY_BY_LEVEL[level];
    const rounds = buildAuthoredChangingStripsRounds(
      difficulty,
      specsForLevel(level),
      `changing-strips-journey-${level}`,
    );
    if (rounds.length !== 12) {
      throw new Error(`${level} must contain exactly 12 Journey rounds.`);
    }
    assertAnswerSchedule(level, rounds);

    for (const round of rounds) {
      if (round.difficulty !== difficulty) {
        throw new Error(`${level} contains the wrong difficulty.`);
      }
      const issues = validateRound(round);
      if (issues.length > 0) {
        throw new Error(`${level} is invalid: ${issues.join("; ")}`);
      }
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Changing Strips round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }

  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildChangingStripsJourneyExtraCampaignRounds();
