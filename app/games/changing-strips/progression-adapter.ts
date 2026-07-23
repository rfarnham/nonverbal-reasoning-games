import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type Difficulty,
  type StripRound,
} from "./game-engine.ts";
import { progressionMetadata } from "./progression-metadata.ts";

export const progressionAdapter = defineProgressionGameAdapter<
  StripRound,
  Difficulty
>({
  gameSlug: "changing-strips",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  campaignRounds: ROUNDS,
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
