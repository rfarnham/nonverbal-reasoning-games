import {
  BASE_PICTURE_IDS,
  POSE_SAFE_FAMILIES,
  PICTURE_POSES,
  PICTURE_BY_ID,
  isPictureId,
  normalizePictureId,
  pictureBaseId,
  pictureHasDistinctPoseOrbit,
  picturePose,
  reflectionTrap,
  rotationTrap,
  structuralSibling as pictureStructuralSibling,
  withPicturePose,
  type PictureFamily,
  type PictureId,
  type PicturePose,
} from "./picture-data.ts";
import { AUTHORED_CAMPAIGN_DATA, AUTHORED_JOURNEY_DATA } from "./authored-data.ts";
import type {
  AuthoredRoundSpec, AuthoredTrapSpec, Difficulty, JourneyExtraLevel,
  ReflectionAxis, Round, TrapKind,
} from "./round-types.ts";

export type { PictureId } from "./picture-data.ts";
export type { AuthoredRoundSpec, AuthoredTrapSpec, Difficulty, JourneyExtraLevel, Round, TrapKind } from "./round-types.ts";

export const LEVELS: readonly Difficulty[] = Object.freeze(["Starter", "Junior", "Expert", "Wizard"]);

export const LEVEL_RULES = Object.freeze({
  Starter: Object.freeze({ studyCount: 1, optionCount: 4, showTargetCount: true, includeStructuralVariants: false, studyFamilyCount: 1, structuralTraps: 0, rotationTraps: 0, reflectionTraps: 0 }),
  Junior: Object.freeze({ studyCount: 2, optionCount: 6, showTargetCount: true, includeStructuralVariants: false, studyFamilyCount: 2, structuralTraps: 0, rotationTraps: 0, reflectionTraps: 0 }),
  Expert: Object.freeze({ studyCount: 3, optionCount: 8, showTargetCount: true, includeStructuralVariants: true, studyFamilyCount: 3, structuralTraps: 3, rotationTraps: 1, reflectionTraps: 1 }),
  Wizard: Object.freeze({ studyCount: 3, optionCount: 8, showTargetCount: false, includeStructuralVariants: true, studyFamilyCount: 2, structuralTraps: 1, rotationTraps: 2, reflectionTraps: 2 }),
} as const);

export const GENERATOR_MAX_ATTEMPTS = 128;
const TURNED_POSES = ["turn-90", "turn-180", "turn-270"] as const;
const MIRROR_POSES = ["mirror-left-right", "mirror-top-bottom", "mirror-diagonal", "mirror-antidiagonal"] as const;
const REFLECTION_AXES: readonly ReflectionAxis[] = ["left-right", "top-bottom", "diagonal", "antidiagonal"];
export type OptionMisconception = "correct" | TrapKind | "unrelated" | "ambiguous";

export function structuralSibling(id: PictureId): PictureId {
  return pictureStructuralSibling(id);
}

function reflected(id: PictureId): boolean {
  return picturePose(id).startsWith("mirror-");
}

/** Classifies the visible relation to the study set, rather than trusting a foil label. */
export function optionMisconception(round: Pick<Round, "study">, option: PictureId): OptionMisconception {
  if (round.study.includes(option)) return "correct";
  const kinds = new Set<TrapKind>();
  for (const target of round.study) {
    if (PICTURE_BY_ID[target].family !== PICTURE_BY_ID[option].family) continue;
    if (picturePose(target) === picturePose(option) && PICTURE_BY_ID[target].variant !== PICTURE_BY_ID[option].variant) {
      kinds.add("structural");
    }
    if (pictureBaseId(target) === pictureBaseId(option) && picturePose(target) !== picturePose(option)) {
      kinds.add(reflected(target) === reflected(option) ? "rotation" : "reflection");
    }
  }
  return kinds.size === 0 ? "unrelated" : kinds.size === 1 ? [...kinds][0] : "ambiguous";
}

export function trapCounts(round: Round): Readonly<Record<TrapKind, number>> {
  const counts = { structural: 0, rotation: 0, reflection: 0 };
  for (const option of round.options) {
    const kind = optionMisconception(round, option);
    if (kind === "structural" || kind === "rotation" || kind === "reflection") counts[kind] += 1;
  }
  return counts;
}

function freezeRound(round: Round): Round {
  return Object.freeze({ ...round, study: Object.freeze([...round.study]), options: Object.freeze([...round.options]) });
}

/** Appearance normalization removes aliases without discarding pose or handedness. */
export function roundFingerprint(round: Round): string {
  return `picture-memory:v2:${round.study.map(normalizePictureId).sort().join(",")}|${round.options.map(normalizePictureId).sort().join(",")}`;
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
  if (!round.study.every(isPictureId) || !round.options.every(isPictureId)) return [...issues, "Unknown or noncanonical picture appearance."];
  if (new Set(round.study.map(normalizePictureId)).size !== round.study.length) issues.push("Study appearances repeat.");
  if (new Set(round.options.map(normalizePictureId)).size !== round.options.length) issues.push("Choice appearances repeat.");
  if (!round.study.every((id) => round.options.includes(id))) issues.push("A studied appearance is missing from the choices.");
  const studyFamilies = round.study.map((id) => PICTURE_BY_ID[id].family);
  const familySet = new Set(studyFamilies);
  if (familySet.size !== rules.studyFamilyCount) issues.push("Wrong number of study object families.");

  if (!rules.includeStructuralVariants) {
    if (round.options.some((id) => PICTURE_BY_ID[id].variant !== 1 || picturePose(id) !== "upright")) issues.push("Early rounds use distinct upright base objects.");
    if (new Set(round.options.map((id) => PICTURE_BY_ID[id].family)).size !== round.options.length) issues.push("Early choices must have distinct object families.");
  } else {
    if (round.study.some((id) => !(POSE_SAFE_FAMILIES as readonly PictureFamily[]).includes(PICTURE_BY_ID[id].family) || !pictureHasDistinctPoseOrbit(id))) issues.push("Advanced objects must have eight perceptually distinct poses.");
    if (!round.study.some((id) => TURNED_POSES.includes(picturePose(id) as typeof TURNED_POSES[number])) || !round.study.some(reflected)) issues.push("Advanced study sets need both a turned and a mirrored target.");
    if (round.options.some((id) => !familySet.has(PICTURE_BY_ID[id].family))) issues.push("Advanced choices must all be close alternatives from studied families.");
    if (round.options.some((id) => ["unrelated", "ambiguous"].includes(optionMisconception(round, id)))) issues.push("Every advanced foil needs one unambiguous structural, rotation, or reflection relation.");
    const counts = trapCounts(round);
    if (counts.structural !== rules.structuralTraps || counts.rotation !== rules.rotationTraps || counts.reflection !== rules.reflectionTraps) issues.push("Wrong distribution of structural, rotation, and reflection traps.");
    if (round.difficulty === "Expert" && !round.study.every((id) => round.options.includes(structuralSibling(id)))) issues.push("Expert needs a same-pose structural sibling for every target.");
    if (round.difficulty === "Wizard") {
      const pair = round.study.filter((id) => studyFamilies.filter((family) => family === PICTURE_BY_ID[id].family).length === 2);
      if (pair.length !== 2 || PICTURE_BY_ID[pair[0]].variant === PICTURE_BY_ID[pair[1]].variant || picturePose(pair[0]) === picturePose(pair[1])) issues.push("Wizard must bind different details and poses within one repeated object family.");
      if ([...familySet].some((family) => round.options.filter((id) => PICTURE_BY_ID[id].family === family).length !== 4)) issues.push("Wizard needs four appearances from each of its two families.");
      if (!round.study.every((target) => round.options.some((id) => pictureBaseId(id) === pictureBaseId(target) && ["rotation", "reflection"].includes(optionMisconception(round, id))))) issues.push("Every Wizard target needs a close pose alternative.");
    }
  }
  return issues;
}

export function validateRound(round: Round): boolean { return roundValidationIssues(round).length === 0; }

export function evaluateSelection(round: Round, selected: readonly PictureId[]): { correct: boolean; missed: PictureId[]; extra: PictureId[] } {
  const uniqueSelected = new Set(selected);
  const expected = new Set(round.study);
  const missed = round.study.filter((id) => !uniqueSelected.has(id));
  const extra = [...uniqueSelected].filter((id) => !expected.has(id));
  return { correct: missed.length === 0 && extra.length === 0 && selected.length === uniqueSelected.size, missed, extra };
}

export function applyTrap(study: readonly PictureId[], trap: AuthoredTrapSpec): PictureId {
  const source = study[trap.source];
  if (!source) throw new Error("An authored picture trap needs a studied source.");
  if (trap.kind === "structural") return structuralSibling(source);
  if (trap.kind === "rotation") return rotationTrap(source, trap.quarterTurns);
  return reflectionTrap(source, trap.axis);
}

export function buildAuthoredRound(spec: AuthoredRoundSpec): Round {
  let round: Round;
  if ("traps" in spec) {
    const pool = [...spec.study, ...spec.traps.map((trap) => applyTrap(spec.study, trap))];
    if (new Set(spec.optionOrder).size !== 8 || spec.optionOrder.some((index) => !Number.isInteger(index) || index < 0 || index >= 8)) throw new Error(`${spec.id} has an invalid option permutation.`);
    round = freezeRound({ id: spec.id, difficulty: spec.difficulty, study: spec.study, options: spec.optionOrder.map((index) => pool[index]) });
  } else round = freezeRound(spec);
  const issues = roundValidationIssues(round);
  if (issues.length) throw new Error(`${round.id}: ${issues.join(" ")}`);
  return round;
}

export const CAMPAIGN_ROUNDS: readonly Round[] = Object.freeze(AUTHORED_CAMPAIGN_DATA.map(buildAuthoredRound));
export const CAMPAIGN_BY_LEVEL: Readonly<Record<Difficulty, readonly Round[]>> = Object.freeze(Object.fromEntries(LEVELS.map((level) => [level, Object.freeze(CAMPAIGN_ROUNDS.filter((round) => round.difficulty === level))])) as Record<Difficulty, readonly Round[]>);
export const JOURNEY_EXTRA_ROUNDS: Readonly<Record<JourneyExtraLevel, readonly Round[]>> = Object.freeze({
  "junior-2": Object.freeze(AUTHORED_JOURNEY_DATA["junior-2"].map(buildAuthoredRound)),
  "expert-2": Object.freeze(AUTHORED_JOURNEY_DATA["expert-2"].map(buildAuthoredRound)),
  "wizard-2": Object.freeze(AUTHORED_JOURNEY_DATA["wizard-2"].map(buildAuthoredRound)),
});
export const EXAMPLE: Round = freezeRound({ id: "example", difficulty: "Starter", study: ["apple-1"], options: ["key-1", "apple-1", "fish-1", "umbrella-1"] });

export class PuzzleGenerationError extends Error {
  constructor(message: string) { super(message); this.name = "PuzzleGenerationError"; }
}
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
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new PuzzleGenerationError("The picture generator needs random values from 0 up to, but not including, 1.");
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
function pick<T>(items: readonly T[], random: () => number): T { return items[randomIndex(items.length, random)]; }
function posedPicture(family: PictureFamily, variant: 1 | 2, pose: PicturePose): PictureId { return withPicturePose(`${family}-${variant}`, pose); }

function poseFoil(study: readonly PictureId[], source: PictureId, kind: "rotation" | "reflection", used: readonly PictureId[], random: () => number): PictureId {
  const candidates = kind === "rotation"
    ? ([1, 2, 3] as const).map((turns) => rotationTrap(source, turns))
    : REFLECTION_AXES.map((axis) => reflectionTrap(source, axis));
  const allowed = candidates.filter((id) => !used.includes(id) && optionMisconception({ study }, id) === kind);
  if (!allowed.length) throw new PuzzleGenerationError("No distinct, perceptible pose alternative is available.");
  return pick(allowed, random);
}

export function generateInfiniteRound(difficulty: Difficulty, random: () => number = Math.random, excludedFingerprints: ReadonlySet<string> = new Set()): Round {
  if (!LEVELS.includes(difficulty)) throw new PuzzleGenerationError("Unknown picture-memory difficulty.");
  const rules = LEVEL_RULES[difficulty];
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    let study: PictureId[];
    let options: PictureId[];
    if (!rules.includeStructuralVariants) {
      options = shuffled(BASE_PICTURE_IDS, random).slice(0, rules.optionCount);
      study = options.slice(0, rules.studyCount);
    } else {
      const families = shuffled(POSE_SAFE_FAMILIES, random);
      const firstVariant = randomIndex(2, random) === 0 ? 1 : 2;
      const secondVariant = difficulty === "Wizard" ? (firstVariant === 1 ? 2 : 1) : (randomIndex(2, random) === 0 ? 1 : 2);
      study = [
        posedPicture(families[0], firstVariant, pick(TURNED_POSES, random)),
        posedPicture(difficulty === "Wizard" ? families[0] : families[1], secondVariant, pick(MIRROR_POSES, random)),
        posedPicture(difficulty === "Wizard" ? families[1] : families[2], randomIndex(2, random) === 0 ? 1 : 2, pick(PICTURE_POSES, random)),
      ];
      options = [...study];
      if (difficulty === "Expert") {
        options.push(...study.map(structuralSibling));
        const sourceOrder = shuffled([0, 1, 2], random);
        options.push(poseFoil(study, study[sourceOrder[0]], "rotation", options, random));
        options.push(poseFoil(study, study[sourceOrder[1]], "reflection", options, random));
      } else {
        options.push(structuralSibling(study[2]));
        const firstKind = randomIndex(2, random) === 0 ? "rotation" : "reflection";
        options.push(poseFoil(study, study[0], firstKind, options, random));
        options.push(poseFoil(study, study[1], firstKind === "rotation" ? "reflection" : "rotation", options, random));
        options.push(poseFoil(study, study[2], "rotation", options, random));
        options.push(poseFoil(study, study[2], "reflection", options, random));
      }
    }
    const candidate: Round = { id: "candidate", difficulty, study: shuffled(study, random), options: shuffled(options, random) };
    const fingerprint = roundFingerprint(candidate);
    if (!validateRound(candidate) || excludedFingerprints.has(fingerprint)) continue;
    return freezeRound({ ...candidate, id: `infinite:${difficulty}:${fingerprint}` });
  }
  throw new PuzzleGenerationError(`No fresh ${difficulty} picture puzzle was found after ${GENERATOR_MAX_ATTEMPTS} attempts.`);
}
