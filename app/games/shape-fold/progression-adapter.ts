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
import { progressionMetadata } from "./progression-metadata.ts";

export const progressionAdapter = defineProgressionGameAdapter<
  Round,
  Difficulty
>({
  gameSlug: "shape-fold",
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
