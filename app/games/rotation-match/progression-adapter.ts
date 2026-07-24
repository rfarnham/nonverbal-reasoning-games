import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type Difficulty,
  type Round,
} from "./game-engine.ts";
import { JOURNEY_EXTRA_CAMPAIGN_ROUNDS } from "./journey-campaign.ts";
import { progressionMetadata } from "./progression-metadata.ts";

function campaignDifficulty(difficulty: Difficulty) {
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

export const progressionAdapter = defineProgressionGameAdapter<
  Round,
  Difficulty
>({
  gameSlug: "rotation-match",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  journeyContentVersion: progressionMetadata.journeyContentVersion,
  campaignRounds: ROUNDS,
  journeyCampaignRounds: {
    starter: campaignDifficulty("Easy"),
    "junior-1": campaignDifficulty("Medium"),
    "junior-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"],
    "expert-1": campaignDifficulty("Hard"),
    "expert-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"],
    "wizard-1": campaignDifficulty("Wizard"),
    "wizard-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"],
  },
  difficultyByLevel: {
    starter: "Easy",
    junior: "Medium",
    expert: "Hard",
    wizard: "Wizard",
  },
  difficultyOf: (round) => round.difficulty,
  fingerprint: roundFingerprint,
  generate: (difficulty, random) =>
    generateInfiniteRound(difficulty, random),
});
