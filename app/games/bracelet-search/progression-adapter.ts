import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type BraceletRound,
  type Difficulty,
} from "./game-engine.ts";
import { progressionMetadata } from "./progression-metadata.ts";

export const progressionAdapter = defineProgressionGameAdapter<
  BraceletRound,
  Difficulty
>({
  gameSlug: "bracelet-search",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  campaignRounds: ROUNDS,
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
