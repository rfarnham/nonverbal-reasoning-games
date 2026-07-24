import {
  defineProgressionGameAdapter,
  type JourneyQuestionCollection,
} from "../../../../lib/progression/game-adapter.ts";
import {
  JOURNEY_LEVELS,
  journeyReviewCollectionId,
  type JourneyLevel,
  type ProgressionLevel,
} from "../../../../lib/progression/types.ts";
import {
  MK_CONTENT_RELEASE_READY,
  MK_ROUNDS,
  mkRoundsForJourneyLevel,
} from "./authored-rounds.ts";
import { mkRoundFingerprint, type MkRound } from "./engine.ts";
import { reviewInfo } from "./provider.ts";

type MkAdapterRound = MkRound &
  Readonly<{
    adapterDifficulty?: ProgressionLevel;
    adapterSlot?: string;
  }>;

const ELIGIBLE_LEVELS = JOURNEY_LEVELS.filter(
  (level): level is Exclude<JourneyLevel, "starter"> => level !== "starter",
);

export const journeyReviewReleaseReady = MK_CONTENT_RELEASE_READY;

export function assertJourneyReviewReleaseReady(): void {
  if (!journeyReviewReleaseReady) {
    throw new Error(
      "Math Kangaroo content is not release-ready. Complete and verify every asset and explanation review before deployment.",
    );
  }
}

function internalClone(
  round: MkRound,
  adapterDifficulty: ProgressionLevel,
  adapterSlot: string,
): MkAdapterRound {
  return Object.freeze({
    ...round,
    adapterDifficulty,
    adapterSlot,
  });
}

function firstTwelve(
  journeyLevel: Exclude<JourneyLevel, "starter">,
): readonly MkRound[] {
  const rounds = mkRoundsForJourneyLevel(journeyLevel).slice(0, 12);
  if (rounds.length !== 12) {
    throw new Error(`${journeyLevel} is missing its Math Kangaroo stop bank.`);
  }
  return rounds;
}

const starterFallback = firstTwelve("junior-1").map((round, index) =>
  internalClone(round, "starter", `internal:starter:${index}`),
);

const campaignRounds: readonly MkAdapterRound[] = Object.freeze([
  ...starterFallback.map((round, index) =>
    internalClone(round, "starter", `internal:campaign:starter:${index}`),
  ),
  ...firstTwelve("junior-1").map((round, index) =>
    internalClone(round, "junior", `internal:campaign:junior:${index}`),
  ),
  ...firstTwelve("expert-1").map((round, index) =>
    internalClone(round, "expert", `internal:campaign:expert:${index}`),
  ),
  ...firstTwelve("wizard-1").map((round, index) =>
    internalClone(round, "wizard", `internal:campaign:wizard:${index}`),
  ),
]);

const journeyCampaignRounds: Readonly<
  Record<JourneyLevel, readonly MkAdapterRound[]>
> = Object.freeze({
  starter: starterFallback,
  "junior-1": firstTwelve("junior-1"),
  "junior-2": firstTwelve("junior-2"),
  "expert-1": firstTwelve("expert-1"),
  "expert-2": firstTwelve("expert-2"),
  "wizard-1": firstTwelve("wizard-1"),
  "wizard-2": firstTwelve("wizard-2"),
});

const reviewCollections: readonly JourneyQuestionCollection<MkAdapterRound>[] =
  Object.freeze(
    ELIGIBLE_LEVELS.map((journeyLevel) => ({
      id: journeyReviewCollectionId(journeyLevel),
      journeyLevel,
      rounds: mkRoundsForJourneyLevel(journeyLevel),
    })),
  );

function adapterFingerprint(round: MkAdapterRound): string {
  return round.adapterSlot
    ? `${round.adapterSlot}:${mkRoundFingerprint(round)}`
    : mkRoundFingerprint(round);
}

export const progressionAdapter = defineProgressionGameAdapter<
  MkAdapterRound,
  ProgressionLevel
>({
  gameSlug: "math-kangaroo",
  contentVersion: reviewInfo.journeyContentVersion,
  generatorVersion: "not-applicable-1",
  journeyContentVersion: reviewInfo.journeyContentVersion,
  campaignRounds,
  journeyCampaignRounds,
  journeyCollections: reviewCollections,
  difficultyByLevel: {
    starter: "starter",
    junior: "junior",
    expert: "expert",
    wizard: "wizard",
  },
  difficultyOf: (round) =>
    round.adapterDifficulty ?? round.difficulty,
  fingerprint: adapterFingerprint,
  generate: (difficulty, random) => {
    const pool = campaignRounds.filter(
      (round) => (round.adapterDifficulty ?? round.difficulty) === difficulty,
    );
    const index = Math.min(
      pool.length - 1,
      Math.floor(Math.max(0, Math.min(0.999999999, random())) * pool.length),
    );
    const round = pool[index];
    if (!round) {
      throw new Error(`No Math Kangaroo fallback exists for ${difficulty}.`);
    }
    return round;
  },
});

export type { MkAdapterRound };

export { MK_ROUNDS };
