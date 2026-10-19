import {
  BASE_PICTURE_IDS,
  PICTURE_FAMILIES,
  PICTURE_BY_ID,
  type PictureFamily,
  type PictureId,
} from "./picture-data.ts";
import {
  AUTHORED_CAMPAIGN_DATA,
  AUTHORED_JOURNEY_DATA,
} from "./authored-data.ts";
import type { Difficulty, JourneyExtraLevel, Round } from "./round-types.ts";

export type { PictureId } from "./picture-data.ts";
export type { Difficulty, JourneyExtraLevel, Round } from "./round-types.ts";

export const LEVELS: readonly Difficulty[] = Object.freeze([
  "Starter", "Junior", "Expert", "Wizard",
]);

export const LEVEL_RULES = Object.freeze({
  Starter: Object.freeze({ studyCount: 1, optionCount: 4, showTargetCount: true, includeStructuralVariants: false }),
  Junior: Object.freeze({ studyCount: 2, optionCount: 6, showTargetCount: true, includeStructuralVariants: false }),
  Expert: Object.freeze({ studyCount: 3, optionCount: 8, showTargetCount: true, includeStructuralVariants: true }),
  Wizard: Object.freeze({ studyCount: 3, optionCount: 8, showTargetCount: false, includeStructuralVariants: true }),
} as const);

export const GENERATOR_MAX_ATTEMPTS = 128;

/** Exact identities matter: a structural sibling is deliberately a different picture. */
export function structuralSibling(id: PictureId): PictureId {
  const picture = PICTURE_BY_ID[id];
  return `${picture.family}-${picture.variant === 1 ? 2 : 1}`;
}

function isPictureId(value: unknown): value is PictureId {
  return typeof value === "string" && Object.hasOwn(PICTURE_BY_ID, value);
}

function freezeRound(round: Round): Round {
  return Object.freeze({
    ...round,
    study: Object.freeze([...round.study]),
    options: Object.freeze([...round.options]),
  });
}

/** Neither presentation order nor a round's bookkeeping identity changes its content. */
export function roundFingerprint(round: Round): string {
  return `picture-memory:v1:${[...round.study].sort().join(",")}|${[...round.options].sort().join(",")}`;
}

export function roundValidationIssues(round: Round): readonly string[] {
  const issues: string[] = [];
  if (!round || typeof round !== "object") return ["Round is missing."];
  if (!LEVELS.includes(round.difficulty)) return ["Unknown difficulty."];
  const rules = LEVEL_RULES[round.difficulty];
  if (typeof round.id !== "string" || !round.id.trim()) issues.push("Round ID is missing.");
  if (!Array.isArray(round.study) || !Array.isArray(round.options)) return [...issues, "Pictures must be arrays."];
  if (round.study.length !== rules.studyCount) issues.push("Wrong study picture count.");
  if (round.options.length !== rules.optionCount) issues.push("Wrong choice count.");
  if (!round.study.every(isPictureId) || !round.options.every(isPictureId)) return [...issues, "Unknown picture."];
  if (new Set(round.study).size !== round.study.length) issues.push("Study pictures repeat.");
  if (new Set(round.options).size !== round.options.length) issues.push("Choice pictures repeat.");
  if (!round.study.every((id) => round.options.includes(id))) issues.push("A studied picture is missing from the choices.");
  const studyFamilies = round.study.map((id) => PICTURE_BY_ID[id].family);
  if (new Set(studyFamilies).size !== round.study.length) issues.push("Study pictures must have distinct object families.");

  if (!rules.includeStructuralVariants) {
    if (round.options.some((id) => PICTURE_BY_ID[id].variant !== 1)) issues.push("Early rounds use only the base object pictures.");
    if (new Set(round.options.map((id) => PICTURE_BY_ID[id].family)).size !== round.options.length) issues.push("Early choices must have distinct object families.");
  } else {
    if (!round.study.every((id) => round.options.includes(structuralSibling(id)))) issues.push("Every studied picture needs its close structural alternative.");
    const distractors = round.options.filter((id) => !studyFamilies.includes(PICTURE_BY_ID[id].family));
    if (distractors.length !== 2 || new Set(distractors.map((id) => PICTURE_BY_ID[id].family)).size !== 2) issues.push("Advanced rounds need two distinct additional object families.");
  }
  return issues;
}

export function validateRound(round: Round): boolean {
  return roundValidationIssues(round).length === 0;
}

export function evaluateSelection(
  round: Round,
  selected: readonly PictureId[],
): { correct: boolean; missed: PictureId[]; extra: PictureId[] } {
  const uniqueSelected = new Set(selected);
  const expected = new Set(round.study);
  const missed = round.study.filter((id) => !uniqueSelected.has(id));
  const extra = [...uniqueSelected].filter((id) => !expected.has(id));
  return {
    correct: missed.length === 0 && extra.length === 0 && selected.length === uniqueSelected.size,
    missed,
    extra,
  };
}

export const CAMPAIGN_ROUNDS: readonly Round[] = Object.freeze(
  AUTHORED_CAMPAIGN_DATA.map(freezeRound),
);

export const CAMPAIGN_BY_LEVEL: Readonly<Record<Difficulty, readonly Round[]>> = Object.freeze(
  Object.fromEntries(LEVELS.map((level) => [
    level,
    Object.freeze(CAMPAIGN_ROUNDS.filter((round) => round.difficulty === level)),
  ])) as Record<Difficulty, readonly Round[]>,
);

export const JOURNEY_EXTRA_ROUNDS: Readonly<Record<JourneyExtraLevel, readonly Round[]>> = Object.freeze({
  "junior-2": Object.freeze(AUTHORED_JOURNEY_DATA["junior-2"].map(freezeRound)),
  "expert-2": Object.freeze(AUTHORED_JOURNEY_DATA["expert-2"].map(freezeRound)),
  "wizard-2": Object.freeze(AUTHORED_JOURNEY_DATA["wizard-2"].map(freezeRound)),
});

export const EXAMPLE: Round = freezeRound({
  id: "example",
  difficulty: "Starter",
  study: ["apple-1"],
  options: ["key-1", "apple-1", "fish-1", "umbrella-1"],
});

export class PuzzleGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PuzzleGenerationError";
  }
}

/** Mulberry32 makes any explicitly supplied integer seed reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomIndex(length: number, random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new PuzzleGenerationError("The picture generator needs random values from 0 up to, but not including, 1.");
  }
  return Math.floor(value * length);
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1, random);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function pictureInFamily(family: PictureFamily, random: () => number): PictureId {
  return `${family}-${randomIndex(2, random) === 0 ? 1 : 2}`;
}

export function generateInfiniteRound(
  difficulty: Difficulty,
  random: () => number = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): Round {
  if (!LEVELS.includes(difficulty)) throw new PuzzleGenerationError("Unknown picture-memory difficulty.");
  const rules = LEVEL_RULES[difficulty];
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    let study: PictureId[];
    let options: PictureId[];
    if (rules.includeStructuralVariants) {
      const families = shuffled(PICTURE_FAMILIES, random).slice(0, 5);
      study = families.slice(0, 3).map((family) => pictureInFamily(family, random));
      options = [...study, ...study.map(structuralSibling), ...families.slice(3).map((family) => pictureInFamily(family, random))];
    } else {
      options = shuffled(BASE_PICTURE_IDS, random).slice(0, rules.optionCount);
      study = options.slice(0, rules.studyCount);
    }
    const candidate: Round = {
      id: "candidate",
      difficulty,
      study: shuffled(study, random),
      options: shuffled(options, random),
    };
    const fingerprint = roundFingerprint(candidate);
    if (!validateRound(candidate) || excludedFingerprints.has(fingerprint)) continue;
    return freezeRound({ ...candidate, id: `infinite:${difficulty}:${fingerprint}` });
  }
  throw new PuzzleGenerationError(`No fresh ${difficulty} picture puzzle was found after ${GENERATOR_MAX_ATTEMPTS} attempts.`);
}
