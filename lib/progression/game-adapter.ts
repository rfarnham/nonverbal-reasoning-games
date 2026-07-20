import { questionReferenceKey } from "./questions.ts";
import {
  PROGRESSION_LEVELS,
  type CampaignQuestionReference,
  type GeneratedQuestionReference,
  type ProgressionLevel,
  type QuestionReference,
} from "./types.ts";

const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_GENERATION_CANDIDATES = 48;

export type ProgressionGameAdapter<
  Round,
  EngineDifficulty extends string,
> = Readonly<{
  gameSlug: string;
  contentVersion: string;
  generatorVersion: string;
  campaignRounds: readonly Round[];
  difficultyByLevel: Readonly<
    Record<ProgressionLevel, EngineDifficulty>
  >;
  difficultyOf(round: Round): EngineDifficulty;
  fingerprint(round: Round): string;
  generate(
    difficulty: EngineDifficulty,
    random: () => number,
  ): Round;
}>;

export type QuestionResolutionKind =
  | "current"
  | "materialized"
  | "campaign-updated"
  | "generated-fallback";

export type ResolvedProgressionQuestion<Round> = Readonly<{
  ref: QuestionReference;
  round: Round;
  playId: string;
  fingerprint: string;
  resolution: QuestionResolutionKind;
  migrated: boolean;
}>;

export type ResolveQuestionOptions = Readonly<{
  excludedFingerprints?: ReadonlySet<string>;
  excludedQuestionKeys?: ReadonlySet<string>;
}>;

export type FreshGeneratedQuestionInput = Readonly<{
  level: ProgressionLevel;
  seedBase: string;
  excludedFingerprints?: ReadonlySet<string>;
  excludedQuestionKeys?: ReadonlySet<string>;
  maxCandidates?: number;
}>;

export class ProgressionQuestionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressionQuestionResolutionError";
  }
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }
  return trimmed;
}

function checkedFingerprint(value: string): string {
  const fingerprint = value.trim();
  if (!fingerprint) {
    throw new ProgressionQuestionResolutionError(
      "A progression round returned an empty fingerprint.",
    );
  }
  return fingerprint;
}

function sameReference(
  left: QuestionReference,
  right: QuestionReference,
): boolean {
  return (
    left.source === right.source &&
    left.gameSlug === right.gameSlug &&
    left.level === right.level &&
    questionReferenceKey(left) === questionReferenceKey(right)
  );
}

export function defineProgressionGameAdapter<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
): ProgressionGameAdapter<Round, EngineDifficulty> {
  const gameSlug = requiredText(adapter.gameSlug, "Game slug");
  if (!GAME_SLUG.test(gameSlug)) {
    throw new Error(`Invalid progression game slug: ${gameSlug}`);
  }
  const contentVersion = requiredText(
    adapter.contentVersion,
    "Campaign content version",
  );
  const generatorVersion = requiredText(
    adapter.generatorVersion,
    "Generator version",
  );

  const seenFingerprints = new Set<string>();
  for (const level of PROGRESSION_LEVELS) {
    const difficulty = adapter.difficultyByLevel[level];
    if (typeof difficulty !== "string" || !difficulty.trim()) {
      throw new Error(`Missing engine difficulty for ${level}.`);
    }
    const rounds = adapter.campaignRounds.filter(
      (round) => adapter.difficultyOf(round) === difficulty,
    );
    if (rounds.length !== 12) {
      throw new Error(
        `${gameSlug} needs exactly 12 ${level} Campaign rounds; found ${rounds.length}.`,
      );
    }
    for (const round of rounds) {
      const fingerprint = checkedFingerprint(adapter.fingerprint(round));
      if (seenFingerprints.has(fingerprint)) {
        throw new Error(
          `${gameSlug} has a duplicate Campaign fingerprint: ${fingerprint}`,
        );
      }
      seenFingerprints.add(fingerprint);
    }
  }

  return {
    ...adapter,
    gameSlug,
    contentVersion,
    generatorVersion,
  };
}

export function campaignRoundsForLevel<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  level: ProgressionLevel,
): readonly Round[] {
  const difficulty = adapter.difficultyByLevel[level];
  return adapter.campaignRounds.filter(
    (round) => adapter.difficultyOf(round) === difficulty,
  );
}

export function campaignQuestionReferences<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  level: ProgressionLevel,
): readonly CampaignQuestionReference[] {
  return campaignRoundsForLevel(adapter, level).map((round, questionIndex) => ({
    source: "campaign",
    gameSlug: adapter.gameSlug,
    level,
    questionIndex,
    contentVersion: adapter.contentVersion,
    fingerprint: checkedFingerprint(adapter.fingerprint(round)),
  }));
}

/**
 * Stable, platform-independent FNV-1a hash. It intentionally hashes strings
 * because generated question references persist their seeds as strings.
 */
export function progressionSeedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A deterministic random source suitable for every current game generator. */
export function createProgressionRandom(seed: string): () => number {
  let state = progressionSeedHash(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function assertMatchingGame<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  ref: QuestionReference,
): void {
  if (ref.gameSlug !== adapter.gameSlug) {
    throw new ProgressionQuestionResolutionError(
      `Question belongs to ${ref.gameSlug}, not ${adapter.gameSlug}.`,
    );
  }
}

function campaignResolution<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  ref: CampaignQuestionReference,
): ResolvedProgressionQuestion<Round> {
  const rounds = campaignRoundsForLevel(adapter, ref.level);
  const round = rounds[ref.questionIndex];
  if (!round) {
    throw new ProgressionQuestionResolutionError(
      `Campaign question ${ref.questionIndex + 1} is unavailable at ${ref.level}.`,
    );
  }
  const fingerprint = checkedFingerprint(adapter.fingerprint(round));
  const normalized: CampaignQuestionReference = {
    source: "campaign",
    gameSlug: adapter.gameSlug,
    level: ref.level,
    questionIndex: ref.questionIndex,
    contentVersion: adapter.contentVersion,
    fingerprint,
  };
  const materialized = ref.fingerprint === undefined;
  const updated =
    ref.contentVersion !== normalized.contentVersion ||
    (ref.fingerprint !== undefined && ref.fingerprint !== fingerprint);
  return {
    ref: normalized,
    round,
    playId: questionReferenceKey(normalized),
    fingerprint,
    resolution: updated
      ? "campaign-updated"
      : materialized
        ? "materialized"
        : "current",
    migrated: !sameReference(ref, normalized),
  };
}

function fallbackCampaignResolution<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  ref: GeneratedQuestionReference,
  options: ResolveQuestionOptions,
): ResolvedProgressionQuestion<Round> {
  const rounds = campaignRoundsForLevel(adapter, ref.level);
  if (!rounds.length) {
    throw new ProgressionQuestionResolutionError(
      `No current Campaign fallback exists for ${ref.level}.`,
    );
  }
  const startIndex = progressionSeedHash(ref.seed) % rounds.length;
  for (let offset = 0; offset < rounds.length; offset += 1) {
    const questionIndex = (startIndex + offset) % rounds.length;
    const round = rounds[questionIndex];
    if (!round) continue;
    const fingerprint = checkedFingerprint(adapter.fingerprint(round));
    const normalized: CampaignQuestionReference = {
      source: "campaign",
      gameSlug: adapter.gameSlug,
      level: ref.level,
      questionIndex,
      contentVersion: adapter.contentVersion,
      fingerprint,
    };
    const key = questionReferenceKey(normalized);
    if (
      options.excludedQuestionKeys?.has(key) ||
      options.excludedFingerprints?.has(fingerprint)
    ) {
      continue;
    }
    return {
      ref: normalized,
      round,
      playId: key,
      fingerprint,
      resolution: "generated-fallback",
      migrated: true,
    };
  }
  throw new ProgressionQuestionResolutionError(
    `No unused Campaign fallback remains for ${adapter.gameSlug} at ${ref.level}.`,
  );
}

function generatedResolution<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  ref: GeneratedQuestionReference,
  options: ResolveQuestionOptions,
): ResolvedProgressionQuestion<Round> {
  if (ref.generatorVersion !== adapter.generatorVersion) {
    return fallbackCampaignResolution(adapter, ref, options);
  }

  try {
    const round = adapter.generate(
      adapter.difficultyByLevel[ref.level],
      createProgressionRandom(ref.seed),
    );
    const fingerprint = checkedFingerprint(adapter.fingerprint(round));
    if (
      (ref.fingerprint !== undefined && ref.fingerprint !== fingerprint) ||
      options.excludedFingerprints?.has(fingerprint)
    ) {
      return fallbackCampaignResolution(adapter, ref, options);
    }
    const normalized: GeneratedQuestionReference = {
      ...ref,
      gameSlug: adapter.gameSlug,
      generatorVersion: adapter.generatorVersion,
      fingerprint,
    };
    return {
      ref: normalized,
      round,
      playId: questionReferenceKey(normalized),
      fingerprint,
      resolution:
        ref.fingerprint === undefined ? "materialized" : "current",
      migrated: !sameReference(ref, normalized),
    };
  } catch {
    return fallbackCampaignResolution(adapter, ref, options);
  }
}

export function resolveProgressionQuestion<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  ref: QuestionReference,
  options: ResolveQuestionOptions = {},
): ResolvedProgressionQuestion<Round> {
  assertMatchingGame(adapter, ref);
  return ref.source === "campaign"
    ? campaignResolution(adapter, ref)
    : generatedResolution(adapter, ref, options);
}

export function createFreshGeneratedQuestion<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  input: FreshGeneratedQuestionInput,
): ResolvedProgressionQuestion<Round> {
  const maxCandidates =
    input.maxCandidates ?? DEFAULT_GENERATION_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error("Generated question attempts must be a positive integer.");
  }

  for (let candidate = 0; candidate < maxCandidates; candidate += 1) {
    const seed =
      candidate === 0
        ? input.seedBase
        : `${input.seedBase}:candidate:${candidate}`;
    const ref: GeneratedQuestionReference = {
      source: "generated",
      gameSlug: adapter.gameSlug,
      level: input.level,
      seed,
      generatorVersion: adapter.generatorVersion,
    };
    try {
      const resolved = generatedResolution(adapter, ref, {
        excludedFingerprints: input.excludedFingerprints,
        excludedQuestionKeys: input.excludedQuestionKeys,
      });
      if (resolved.ref.source === "generated") return resolved;
    } catch {
      // Try another deterministic candidate before using Campaign content.
    }
  }

  const fallbackRef: GeneratedQuestionReference = {
    source: "generated",
    gameSlug: adapter.gameSlug,
    level: input.level,
    seed: input.seedBase,
    generatorVersion: "__campaign-fallback__",
  };
  return fallbackCampaignResolution(adapter, fallbackRef, {
    excludedFingerprints: input.excludedFingerprints,
    excludedQuestionKeys: input.excludedQuestionKeys,
  });
}
