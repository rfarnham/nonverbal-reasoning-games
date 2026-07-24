import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type Difficulty,
  type DominoRound,
} from "./game-engine.ts";
import { progressionMetadata } from "./progression-metadata.ts";
import { JOURNEY_EXTRA_CAMPAIGN_ROUNDS } from "./journey-campaign.ts";

function campaignDifficulty(difficulty: Difficulty) {
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

export const progressionAdapter = defineProgressionGameAdapter<
  DominoRound,
  Difficulty
>({
  gameSlug: "domino-twist",
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
    generateInfiniteRound(difficulty, random),
});
