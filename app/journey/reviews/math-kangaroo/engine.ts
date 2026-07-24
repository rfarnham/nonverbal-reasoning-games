import type {
  JourneyLevel,
  JourneyReviewGradeBand,
  ProgressionLevel,
} from "../../../../lib/progression/types.ts";
import {
  JOURNEY_LEVELS,
  journeyLevelMetadata,
} from "../../../../lib/progression/types.ts";

export const MK_MECHANICS = [
  "assembly",
  "rotation-reflection",
  "paths-directions",
  "objects-views",
  "folding-nets",
  "layering-order",
  "patterns-relations",
  "other-spatial",
] as const;

export type MkMechanic = (typeof MK_MECHANICS)[number];

export type MkExplanationAnimation =
  | "assemble"
  | "fold"
  | "layer"
  | "pattern"
  | "reflect"
  | "rotate"
  | "trace"
  | "viewpoint";

export type MkSourceAnswer = "A" | "B" | "C" | "D" | "E";

export type MkChoice = Readonly<{
  label: string;
  accessibleLabel: string;
  /**
   * Semantic answer content used when the source crop intentionally omits a
   * text, pair, or sequence answer row. Visual-only choices leave this unset.
   */
  displayText?: string;
}>;

export type MkIllustration = Readonly<{
  src: string;
  width: number;
  height: number;
  alt: string;
}>;

export const MK_VISUAL_BEAT_PRIMITIVES = [
  "spotlight",
  "trace",
  "transform",
  "reveal",
  "compare",
  "count",
] as const;

export type MkVisualBeatPrimitive =
  (typeof MK_VISUAL_BEAT_PRIMITIVES)[number];

/**
 * Illustration annotations use normalized image-space coordinates. The top
 * left of the authored crop is (0, 0), the bottom right is (1, 1), and a
 * translation is expressed as a fraction of the crop's width and height.
 */
export type MkNormalizedPoint = Readonly<{
  x: number;
  y: number;
}>;

export type MkNormalizedTranslation = Readonly<{
  x: number;
  y: number;
}>;

export type MkVisualRegion = Readonly<{
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: "evidence" | "work-area" | "answer-choice";
  choiceIndex?: number;
}>;

export type MkVisualPath = Readonly<{
  id: string;
  label: string;
  points: readonly [
    MkNormalizedPoint,
    MkNormalizedPoint,
    ...MkNormalizedPoint[],
  ];
  closed?: boolean;
}>;

type MkVisualBeatBase = Readonly<{
  narration: string;
}>;

export type MkSpotlightBeat = MkVisualBeatBase & Readonly<{
  kind: "spotlight";
  target: string;
}>;

export type MkTraceBeat = MkVisualBeatBase & Readonly<{
  kind: "trace";
  target: string;
}>;

export type MkTransformBeat = MkVisualBeatBase & Readonly<{
  kind: "transform";
  target: string;
  rotateDeg?: number;
  reflection?: "across-horizontal-axis" | "across-vertical-axis";
  translation?: MkNormalizedTranslation;
}>;

export type MkRevealBeat = MkVisualBeatBase & Readonly<{
  kind: "reveal";
  /**
   * Visual-choice questions reveal a real answer region in the source crop.
   * OCR-only text, pair, and sequence choices instead identify the semantic
   * answer card by index; they must not invent image-space coordinates.
   */
  target?: string;
  choiceIndex?: number;
  /**
   * Required on the final beat. It makes the final reveal independently
   * checkable against either the referenced answer region or semantic choice
   * card and the official key.
   */
  verifiedChoiceIndex?: number;
}>;

export type MkCompareBeat = MkVisualBeatBase & Readonly<{
  kind: "compare";
  targets: readonly [string, string];
}>;

export type MkCountBeat = MkVisualBeatBase & Readonly<{
  kind: "count";
  targets: readonly [string, ...string[]];
  expectedCount: number;
}>;

export type MkGroundedVisualBeat =
  | MkSpotlightBeat
  | MkTraceBeat
  | MkTransformBeat
  | MkRevealBeat
  | MkCompareBeat
  | MkCountBeat;

export type MkVisualExplanation = Readonly<{
  regions: readonly MkVisualRegion[];
  paths: readonly MkVisualPath[];
  beats: readonly [
    MkGroundedVisualBeat,
    MkGroundedVisualBeat,
    MkGroundedVisualBeat,
    ...MkGroundedVisualBeat[],
  ];
}>;

/**
 * Legacy narration beats remain readable while the selected corpus is being
 * grounded. They never drive a visual transform because free-form target
 * strings cannot safely identify pixels in the source illustration.
 */
export type MkAnimationBeat = Readonly<{
  action: string;
  target: string;
  narration: string;
}>;

export type MkExplanation = Readonly<{
  headline: string;
  steps: readonly [string, string, ...string[]];
  wrongAnswerHint: string;
  animation: MkExplanationAnimation;
  animationBeats: readonly MkAnimationBeat[];
  visualExplanation?: MkVisualExplanation;
}>;

export type MkSource = Readonly<{
  year: number;
  gradeBand: JourneyReviewGradeBand;
  questionNumber: number;
  answer: MkSourceAnswer;
  sourceDocument: string;
  answerKeyDocument: string;
  answerKeyVerified: true;
}>;

/**
 * A Math Kangaroo round stores authored learning content and a compact source
 * audit trail, never a PDF page or a complete competition scan. The selected
 * illustration is a local, question-scoped asset; all prompt and feedback text
 * remains semantic HTML in the route.
 */
export type MkRound = Readonly<{
  id: string;
  journeyLevel: JourneyLevel;
  difficulty: ProgressionLevel;
  mechanic: MkMechanic;
  prompt: string;
  illustration: MkIllustration;
  choices: readonly [
    MkChoice,
    MkChoice,
    MkChoice,
    MkChoice,
    MkChoice,
  ];
  correctIndex: number;
  explanation: MkExplanation;
  source: MkSource;
}>;

const SOURCE_ANSWER_INDEX: Readonly<Record<MkSourceAnswer, number>> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
};

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty.`);
  return trimmed;
}

const ANNOTATION_ID = /^[a-z][a-z0-9-]*$/;

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function normalizedCoordinate(value: number, label: string): number {
  finiteNumber(value, label);
  if (value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return value;
}

function annotationId(value: string, label: string): string {
  const id = requiredText(value, label);
  if (!ANNOTATION_ID.test(id)) {
    throw new Error(
      `${label} must start with a letter and use lowercase letters, numbers, or hyphens.`,
    );
  }
  return id;
}

/**
 * Validates that every explanatory mark is anchored to the actual crop and
 * that the final beat visibly reveals the answer verified by the source key.
 */
export function validateMkVisualExplanation(
  visual: MkVisualExplanation,
  correctIndex: number,
  roundId = "Math Kangaroo round",
  usesSemanticChoices = false,
): void {
  if (visual.regions.length < 1) {
    throw new Error(`${roundId} visual explanation needs a named region.`);
  }
  if (visual.beats.length < 3) {
    throw new Error(`${roundId} visual explanation needs at least three beats.`);
  }

  const regions = new Map<string, MkVisualRegion>();
  for (const [index, region] of visual.regions.entries()) {
    const prefix = `${roundId} visual region ${index + 1}`;
    const id = annotationId(region.id, `${prefix} ID`);
    requiredText(region.label, `${prefix} label`);
    normalizedCoordinate(region.x, `${prefix} x`);
    normalizedCoordinate(region.y, `${prefix} y`);
    finiteNumber(region.width, `${prefix} width`);
    finiteNumber(region.height, `${prefix} height`);
    if (
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > 1 + Number.EPSILON ||
      region.y + region.height > 1 + Number.EPSILON
    ) {
      throw new Error(`${prefix} must fit inside the illustration.`);
    }
    if (
      region.role !== "evidence" &&
      region.role !== "work-area" &&
      region.role !== "answer-choice"
    ) {
      throw new Error(`${prefix} has an invalid role.`);
    }
    if (region.role === "answer-choice") {
      const choiceIndex = region.choiceIndex;
      if (
        !Number.isInteger(choiceIndex) ||
        choiceIndex === undefined ||
        choiceIndex < 0 ||
        choiceIndex > 4
      ) {
        throw new Error(
          `${prefix} needs a zero-based answer choice index from 0 to 4.`,
        );
      }
    } else if (region.choiceIndex !== undefined) {
      throw new Error(
        `${prefix} can only set choiceIndex when role is answer-choice.`,
      );
    }
    if (regions.has(id)) {
      throw new Error(`${roundId} repeats visual region ID "${id}".`);
    }
    regions.set(id, region);
  }

  const paths = new Map<string, MkVisualPath>();
  for (const [index, path] of visual.paths.entries()) {
    const prefix = `${roundId} visual path ${index + 1}`;
    const id = annotationId(path.id, `${prefix} ID`);
    requiredText(path.label, `${prefix} label`);
    if (path.points.length < 2) {
      throw new Error(`${prefix} needs at least two points.`);
    }
    for (const [pointIndex, point] of path.points.entries()) {
      normalizedCoordinate(point.x, `${prefix} point ${pointIndex + 1} x`);
      normalizedCoordinate(point.y, `${prefix} point ${pointIndex + 1} y`);
    }
    if (paths.has(id) || regions.has(id)) {
      throw new Error(`${roundId} repeats annotation ID "${id}".`);
    }
    paths.set(id, path);
  }

  const requireRegion = (idValue: string, label: string): MkVisualRegion => {
    const id = annotationId(idValue, label);
    const region = regions.get(id);
    if (!region) {
      throw new Error(`${label} references unknown region "${id}".`);
    }
    return region;
  };
  const requirePath = (idValue: string, label: string): MkVisualPath => {
    const id = annotationId(idValue, label);
    const path = paths.get(id);
    if (!path) {
      throw new Error(`${label} references unknown path "${id}".`);
    }
    return path;
  };

  let hasCausalReasoningBeat = false;
  for (const [index, beat] of visual.beats.entries()) {
    const prefix = `${roundId} visual beat ${index + 1}`;
    requiredText(beat.narration, `${prefix} narration`);
    if (!MK_VISUAL_BEAT_PRIMITIVES.includes(beat.kind)) {
      throw new Error(`${prefix} has an invalid primitive.`);
    }

    if (beat.kind === "spotlight") {
      requireRegion(beat.target, `${prefix} target`);
    } else if (beat.kind === "reveal") {
      const hasRegionTarget = beat.target !== undefined;
      const hasSemanticTarget = beat.choiceIndex !== undefined;
      if (hasRegionTarget === hasSemanticTarget) {
        throw new Error(
          `${prefix} must identify either one real answer region or one semantic choice card.`,
        );
      }
      if (hasRegionTarget) {
        requireRegion(beat.target, `${prefix} target`);
      } else if (
        !usesSemanticChoices ||
        !Number.isInteger(beat.choiceIndex) ||
        beat.choiceIndex === undefined ||
        beat.choiceIndex < 0 ||
        beat.choiceIndex > 4
      ) {
        throw new Error(
          `${prefix} semantic choice index needs an OCR-only choice from 0 to 4.`,
        );
      }
    } else if (beat.kind === "trace") {
      requirePath(beat.target, `${prefix} target`);
      hasCausalReasoningBeat = true;
    } else if (beat.kind === "transform") {
      requireRegion(beat.target, `${prefix} target`);
      if (beat.rotateDeg !== undefined) {
        finiteNumber(beat.rotateDeg, `${prefix} rotation`);
        if (Math.abs(beat.rotateDeg) > 360) {
          throw new Error(`${prefix} rotation must be within ±360 degrees.`);
        }
      }
      if (
        beat.reflection !== undefined &&
        beat.reflection !== "across-horizontal-axis" &&
        beat.reflection !== "across-vertical-axis"
      ) {
        throw new Error(`${prefix} has an invalid reflection axis.`);
      }
      if (beat.translation !== undefined) {
        finiteNumber(beat.translation.x, `${prefix} translation x`);
        finiteNumber(beat.translation.y, `${prefix} translation y`);
        if (
          Math.abs(beat.translation.x) > 1 ||
          Math.abs(beat.translation.y) > 1
        ) {
          throw new Error(
            `${prefix} translation must stay within one illustration width and height.`,
          );
        }
      }
      const hasRotation =
        beat.rotateDeg !== undefined && beat.rotateDeg !== 0;
      const hasTranslation =
        beat.translation !== undefined &&
        (beat.translation.x !== 0 || beat.translation.y !== 0);
      if (!hasRotation && !beat.reflection && !hasTranslation) {
        throw new Error(
          `${prefix} needs an exact non-zero rotation, reflection, or translation.`,
        );
      }
      hasCausalReasoningBeat = true;
    } else if (beat.kind === "compare") {
      if (
        beat.targets.length !== 2 ||
        beat.targets[0] === beat.targets[1]
      ) {
        throw new Error(`${prefix} needs two distinct region targets.`);
      }
      const comparedRegions = beat.targets.map((target, targetIndex) =>
        requireRegion(target, `${prefix} target ${targetIndex + 1}`)
      );
      // Comparing one undifferentiated clue block straight to the answer is
      // only an answer highlight, not an explanation. A compare-only
      // explanation must connect two precise regions in the worked evidence.
      if (
        comparedRegions.every(
          ({ role }) => role !== "answer-choice",
        )
      ) {
        hasCausalReasoningBeat = true;
      }
    } else if (beat.kind === "count") {
      if (
        !Number.isInteger(beat.expectedCount) ||
        beat.expectedCount < 1 ||
        beat.targets.length !== beat.expectedCount ||
        new Set(beat.targets).size !== beat.targets.length
      ) {
        throw new Error(
          `${prefix} expectedCount must equal its distinct region targets.`,
        );
      }
      beat.targets.forEach((target, targetIndex) => {
        requireRegion(target, `${prefix} target ${targetIndex + 1}`);
      });
      hasCausalReasoningBeat = true;
    }
  }
  if (!hasCausalReasoningBeat) {
    throw new Error(
      `${roundId} visual explanation needs a causal reasoning beat before its reveal; comparing the whole clue directly to an answer is insufficient.`,
    );
  }

  const finalBeat = visual.beats.at(-1);
  if (
    finalBeat?.kind !== "reveal" ||
    finalBeat.verifiedChoiceIndex !== correctIndex
  ) {
    throw new Error(
      `${roundId} final visual beat must reveal the officially verified answer choice.`,
    );
  }
  if (finalBeat.choiceIndex !== undefined) {
    if (
      !usesSemanticChoices ||
      finalBeat.choiceIndex !== correctIndex ||
      finalBeat.target !== undefined
    ) {
      throw new Error(
        `${roundId} final visual beat must reveal the matching semantic answer card.`,
      );
    }
    return;
  }
  if (finalBeat.target === undefined) {
    throw new Error(
      `${roundId} final visual beat needs a verified answer target.`,
    );
  }
  const finalRegion = requireRegion(
    finalBeat.target,
    `${roundId} final visual beat target`,
  );
  if (
    finalRegion.role !== "answer-choice" ||
    finalRegion.choiceIndex !== correctIndex
  ) {
    throw new Error(
      `${roundId} final visual beat must target the matching answer-choice region.`,
    );
  }
}

export function mkRoundFingerprint(round: MkRound): string {
  return [
    "mk-spatial",
    round.id,
    round.journeyLevel,
    round.source.year,
    round.source.gradeBand,
    round.source.questionNumber,
    round.source.answer,
  ].join(":");
}

export function validateMkRound(round: MkRound): void {
  requiredText(round.id, "Math Kangaroo round ID");
  requiredText(round.prompt, `${round.id} prompt`);
  requiredText(round.illustration.src, `${round.id} illustration source`);
  requiredText(round.illustration.alt, `${round.id} illustration alternative`);
  if (
    !Number.isInteger(round.illustration.width) ||
    round.illustration.width < 1 ||
    !Number.isInteger(round.illustration.height) ||
    round.illustration.height < 1
  ) {
    throw new Error(`${round.id} has invalid illustration dimensions.`);
  }
  if (round.choices.length !== 5) {
    throw new Error(`${round.id} needs exactly five answer choices.`);
  }
  const choiceLabels = new Set<string>();
  let displayTextCount = 0;
  for (const [index, choice] of round.choices.entries()) {
    const label = requiredText(choice.label, `${round.id} choice ${index + 1}`);
    requiredText(
      choice.accessibleLabel,
      `${round.id} choice ${index + 1} accessible label`,
    );
    if (choiceLabels.has(label)) {
      throw new Error(`${round.id} has duplicate answer choices.`);
    }
    choiceLabels.add(label);
    if (choice.displayText !== undefined) {
      requiredText(
        choice.displayText,
        `${round.id} choice ${index + 1} display text`,
      );
      displayTextCount += 1;
    }
  }
  if (displayTextCount !== 0 && displayTextCount !== round.choices.length) {
    throw new Error(
      `${round.id} must provide display text for all five choices or none.`,
    );
  }
  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex >= round.choices.length
  ) {
    throw new Error(`${round.id} has an invalid correct answer.`);
  }
  if (SOURCE_ANSWER_INDEX[round.source.answer] !== round.correctIndex) {
    throw new Error(`${round.id} disagrees with its verified answer key.`);
  }
  requiredText(round.source.sourceDocument, `${round.id} source document`);
  requiredText(
    round.source.answerKeyDocument,
    `${round.id} answer-key document`,
  );
  if (
    !Number.isInteger(round.source.year) ||
    !Number.isInteger(round.source.questionNumber) ||
    round.source.questionNumber < 1
  ) {
    throw new Error(`${round.id} has invalid source metadata.`);
  }
  if (!JOURNEY_LEVELS.includes(round.journeyLevel)) {
    throw new Error(`${round.id} has an invalid Journey level.`);
  }
  const level = journeyLevelMetadata(round.journeyLevel);
  if (
    level.reviewGradeBand === null ||
    level.difficulty !== round.difficulty ||
    level.reviewGradeBand !== round.source.gradeBand
  ) {
    throw new Error(
      `${round.id} does not match its Journey difficulty and grade band.`,
    );
  }
  if (!MK_MECHANICS.includes(round.mechanic)) {
    throw new Error(`${round.id} has an invalid spatial mechanic.`);
  }
  requiredText(round.explanation.headline, `${round.id} explanation headline`);
  if (round.explanation.steps.length < 2) {
    throw new Error(`${round.id} needs at least two explanation steps.`);
  }
  for (const [index, step] of round.explanation.steps.entries()) {
    requiredText(step, `${round.id} explanation step ${index + 1}`);
  }
  requiredText(
    round.explanation.wrongAnswerHint,
    `${round.id} wrong-answer hint`,
  );
  for (const [index, beat] of round.explanation.animationBeats.entries()) {
    requiredText(beat.action, `${round.id} animation action ${index + 1}`);
    requiredText(beat.target, `${round.id} animation target ${index + 1}`);
    requiredText(
      beat.narration,
      `${round.id} animation narration ${index + 1}`,
    );
  }
  if (round.explanation.visualExplanation) {
    const usesSemanticChoices = round.choices.every(
      ({ displayText }) => displayText !== undefined,
    );
    validateMkVisualExplanation(
      round.explanation.visualExplanation,
      round.correctIndex,
      round.id,
      usesSemanticChoices,
    );
  }
}

export function validateMkRoundBank(rounds: readonly MkRound[]): void {
  if (!rounds.length) throw new Error("A Math Kangaroo bank cannot be empty.");
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const round of rounds) {
    validateMkRound(round);
    const fingerprint = mkRoundFingerprint(round);
    if (ids.has(round.id) || fingerprints.has(fingerprint)) {
      throw new Error(`Duplicate Math Kangaroo round: ${round.id}`);
    }
    ids.add(round.id);
    fingerprints.add(fingerprint);
  }
}

export const MK_JOURNEY_LEVELS = JOURNEY_LEVELS.filter(
  (level): level is Exclude<JourneyLevel, "starter"> => level !== "starter",
);

export const MK_ROUNDS_PER_JOURNEY_LEVEL = 28;
export const MK_STOP_ROUNDS_PER_JOURNEY_LEVEL = 24;
export const MK_CULMINATION_ROUNDS_PER_JOURNEY_LEVEL = 4;

/**
 * Corpus-level checks protect the curriculum split: two disjoint 12-question
 * stops followed by four unseen culmination questions for every eligible
 * board. These checks run when the authored module is imported and in tests.
 */
export function validateMkJourneyCorpus(rounds: readonly MkRound[]): void {
  validateMkRoundBank(rounds);
  if (
    rounds.length !==
    MK_JOURNEY_LEVELS.length * MK_ROUNDS_PER_JOURNEY_LEVEL
  ) {
    throw new Error(
      `Math Kangaroo Journey needs exactly ${
        MK_JOURNEY_LEVELS.length * MK_ROUNDS_PER_JOURNEY_LEVEL
      } rounds; found ${rounds.length}.`,
    );
  }

  const sourceQuestions = new Set<string>();
  for (const round of rounds) {
    const sourceKey = [
      round.source.year,
      round.source.gradeBand,
      round.source.questionNumber,
    ].join(":");
    if (sourceQuestions.has(sourceKey)) {
      throw new Error(
        `Math Kangaroo source question is reused across Journey: ${sourceKey}`,
      );
    }
    sourceQuestions.add(sourceKey);
  }

  for (const journeyLevel of MK_JOURNEY_LEVELS) {
    const levelRounds = rounds.filter(
      (round) => round.journeyLevel === journeyLevel,
    );
    if (levelRounds.length !== MK_ROUNDS_PER_JOURNEY_LEVEL) {
      throw new Error(
        `${journeyLevel} needs ${MK_ROUNDS_PER_JOURNEY_LEVEL} Math Kangaroo rounds; found ${levelRounds.length}.`,
      );
    }
    const mechanics = new Set(levelRounds.map(({ mechanic }) => mechanic));
    const years = new Set(levelRounds.map(({ source }) => source.year));
    if (mechanics.size < 5 || years.size < 6) {
      throw new Error(
        `${journeyLevel} needs broader mechanic and year coverage.`,
      );
    }
    for (let offset = 0; offset < MK_STOP_ROUNDS_PER_JOURNEY_LEVEL; offset += 12) {
      const stop = levelRounds.slice(offset, offset + 12);
      if (new Set(stop.map(({ mechanic }) => mechanic)).size < 4) {
        throw new Error(
          `${journeyLevel} stop ${offset / 12 + 1} needs at least four mechanics.`,
        );
      }
      const answerCounts = Array.from({ length: 5 }, (_, index) =>
        stop.filter(({ correctIndex }) => correctIndex === index).length,
      );
      if (answerCounts.some((count) => count < 1 || count > 4)) {
        throw new Error(
          `${journeyLevel} stop ${offset / 12 + 1} has an imbalanced answer sequence.`,
        );
      }
      if (
        stop.some(
          (round, index) =>
            index > 0 &&
            round.correctIndex === stop[index - 1]?.correctIndex,
        )
      ) {
        throw new Error(
          `${journeyLevel} stop ${offset / 12 + 1} repeats adjacent answer positions.`,
        );
      }
    }
  }
}
