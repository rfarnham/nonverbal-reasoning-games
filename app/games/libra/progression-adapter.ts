import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type Difficulty,
  type Round,
} from "./game-engine.ts";
import { progressionMetadata } from "./progression-metadata.ts";
import { JOURNEY_EXTRA_CAMPAIGN_ROUNDS } from "./journey-campaign.ts";
import { assertSoundTeachingRound } from "./strategy-curriculum.ts";

function campaignDifficulty(difficulty: Difficulty) {
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

function generateProgressionRound(
  difficulty: Difficulty,
  random: () => number,
): Round {
  const rejectedFingerprints = new Set<string>();
  for (
    let candidate = 0;
    candidate < GENERATOR_MAX_ATTEMPTS;
    candidate += 1
  ) {
    const round = generateInfiniteRound(
      difficulty,
      random,
      rejectedFingerprints,
    );
    try {
      assertSoundTeachingRound(round);
      return round;
    } catch {
      rejectedFingerprints.add(roundFingerprint(round));
    }
  }
  throw new Error(
    `Unable to generate a teaching-sound ${difficulty} Libra round.`,
  );
}

export const progressionAdapter = defineProgressionGameAdapter<
  Round,
  Difficulty
>({
  gameSlug: "libra",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  journeyContentVersion: progressionMetadata.journeyContentVersion,
  campaignRounds: ROUNDS,
  journeyCampaignRounds: {
    starter: campaignDifficulty("Starter"),
    "junior-1": campaignDifficulty("Junior"),
    "junior-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"],
    "expert-1": campaignDifficulty("Expert"),
    "expert-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"],
    "wizard-1": campaignDifficulty("Wizard"),
    "wizard-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"],
  },
  difficultyByLevel: {
    starter: "Starter",
    junior: "Junior",
    expert: "Expert",
    wizard: "Wizard",
  },
  difficultyOf: (round) => round.difficulty,
  fingerprint: roundFingerprint,
  generate: (difficulty, random) =>
    generateProgressionRound(difficulty, random),
});
