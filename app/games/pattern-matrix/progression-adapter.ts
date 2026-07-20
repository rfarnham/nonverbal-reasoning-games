import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import { CAMPAIGN_ROUNDS } from "./campaign-data.ts";
import { progressionMetadata } from "./progression-metadata.ts";
import {
  generateInfiniteRound,
  roundFingerprint,
  type Difficulty,
  type Round,
} from "./rule-engine.ts";

export const progressionAdapter = defineProgressionGameAdapter<
  Round,
  Difficulty
>({
  gameSlug: "pattern-matrix",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  campaignRounds: CAMPAIGN_ROUNDS,
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
