import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  CAMPAIGN_ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type Difficulty,
  type Round,
} from "./game-engine.ts";
import { progressionMetadata } from "./progression-metadata.ts";

export const progressionAdapter = defineProgressionGameAdapter<
  Round,
  Difficulty
>({
  gameSlug: "whose-left",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  campaignRounds: CAMPAIGN_ROUNDS,
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
