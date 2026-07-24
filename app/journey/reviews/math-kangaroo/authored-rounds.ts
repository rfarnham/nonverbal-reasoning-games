import manifestJson from "./data/runtime-manifest.json" with { type: "json" };

import type {
  JourneyLevel,
  JourneyReviewGradeBand,
  ProgressionLevel,
} from "../../../../lib/progression/types.ts";
import {
  MK_MECHANICS,
  validateMkJourneyCorpus,
  type MkChoice,
  type MkExplanationAnimation,
  type MkGroundedVisualBeat,
  type MkMechanic,
  type MkRound,
  type MkSourceAnswer,
  type MkVisualExplanation,
  type MkVisualPath,
  type MkVisualRegion,
  validateMkVisualExplanation,
} from "./engine.ts";

type RawSolutionStep = Readonly<{
  title: string;
  body: string;
}>;

type RawAnimationBeat = Readonly<{
  action: string;
  target: string;
  narration: string;
}>;

type RawVisualExplanation = Readonly<{
  regions: readonly MkVisualRegion[];
  paths: readonly MkVisualPath[];
  beats: readonly MkGroundedVisualBeat[];
}>;

type RawRound = Readonly<{
  id: string;
  journeyLevel: JourneyLevel;
  difficulty: ProgressionLevel;
  gradeBand: JourneyReviewGradeBand;
  mechanic: MkMechanic;
  prompt: string;
  choices: readonly Readonly<{
    label: string;
    accessibleLabel: string;
    displayText?: string;
  }>[];
  correctIndex: number;
  explanationPlan: Readonly<{
    headline: string;
    reasoning: string;
    adaptation: string;
    animation: MkExplanationAnimation;
    status: string;
    solutionSteps?: readonly RawSolutionStep[];
    wrongAnswerHint?: string;
    animationPlan?: Readonly<{
      kind: MkExplanationAnimation;
      beats: readonly RawAnimationBeat[];
    }>;
    visualExplanation?: RawVisualExplanation;
  }>;
  source: Readonly<{
    year: number;
    gradeBand: JourneyReviewGradeBand;
    questionNumber: number;
    sourceDocument: string;
    answer: MkSourceAnswer;
    answerKeyDocument: string;
    answerKeyVerified: true;
  }>;
  asset: Readonly<{
    targetPublicPath: string;
    publicWidth: number;
    publicHeight: number;
    status: string;
    qa?: Readonly<{
      promptFree: boolean;
      optionsRelabeled: boolean;
      diagramComplete: boolean;
      reviewed: boolean;
    }>;
  }>;
}>;

type RawManifest = Readonly<{
  schemaVersion: number;
  contentVersion: string;
  rounds: readonly RawRound[];
}>;

const manifest = manifestJson as unknown as RawManifest;

function requiredText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} cannot be empty.`);
  return result;
}

function fiveChoices(
  choices: RawRound["choices"],
  roundId: string,
): readonly [MkChoice, MkChoice, MkChoice, MkChoice, MkChoice] {
  if (choices.length !== 5) {
    throw new Error(`${roundId} needs exactly five choices.`);
  }
  return choices.map(({ label, accessibleLabel, displayText }) => ({
    label: requiredText(label, `${roundId} choice label`),
    accessibleLabel: requiredText(
      accessibleLabel,
      `${roundId} accessible choice label`,
    ),
    ...(displayText === undefined
      ? {}
      : {
          displayText: requiredText(
            displayText,
            `${roundId} choice display text`,
          ),
        }),
  })) as unknown as readonly [
    MkChoice,
    MkChoice,
    MkChoice,
    MkChoice,
    MkChoice,
  ];
}

function solutionSteps(round: RawRound): readonly [string, string, ...string[]] {
  const authored = round.explanationPlan.solutionSteps
    ?.map(({ title, body }) =>
      `${requiredText(title, `${round.id} step title`)}: ${requiredText(
        body,
        `${round.id} step body`,
      )}`
    )
    .filter(Boolean);
  if (authored && authored.length >= 2) {
    return authored as [string, string, ...string[]];
  }

  throw new Error(
    `${round.id} needs at least two final, question-specific solution steps.`,
  );
}

function visualExplanation(
  round: RawRound,
): MkVisualExplanation | undefined {
  const visual = round.explanationPlan.visualExplanation;
  if (!visual) return undefined;
  if (visual.beats.length < 3) {
    throw new Error(`${round.id} visual explanation needs at least three beats.`);
  }
  const result = {
    regions: visual.regions.map((region) => ({ ...region })),
    paths: visual.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({ ...point })) as unknown as
        MkVisualPath["points"],
    })),
    beats: visual.beats.map((beat) => ({ ...beat })),
  } as unknown as MkVisualExplanation;
  validateMkVisualExplanation(
    result,
    round.correctIndex,
    round.id,
    round.choices.every(({ displayText }) => displayText !== undefined),
  );
  return result;
}

function toMkRound(raw: RawRound): MkRound {
  const animation =
    raw.explanationPlan.animationPlan?.kind ??
    raw.explanationPlan.animation;
  const choices = fiveChoices(raw.choices, raw.id);
  const usesSemanticChoices = choices.every(
    ({ displayText }) => displayText !== undefined,
  );
  return Object.freeze({
    id: raw.id,
    journeyLevel: raw.journeyLevel,
    difficulty: raw.difficulty,
    mechanic: raw.mechanic,
    prompt: requiredText(raw.prompt, `${raw.id} prompt`),
    illustration: {
      src: raw.asset.targetPublicPath,
      width: raw.asset.publicWidth,
      height: raw.asset.publicHeight,
      alt: usesSemanticChoices
        ? "Visual-spatial puzzle diagram. The five answer choices are listed as text below the image."
        : "Visual-spatial puzzle diagram with five numbered answer choices. The spatial relationships in the image are the question.",
    },
    choices,
    correctIndex: raw.correctIndex,
    explanation: {
      headline: requiredText(
        raw.explanationPlan.headline,
        `${raw.id} explanation headline`,
      ),
      steps: solutionSteps(raw),
      wrongAnswerHint:
        raw.explanationPlan.wrongAnswerHint?.trim() ||
        "Nice try. Compare the choices one feature at a time and look for the first position, direction, or connection that changes.",
      animation,
      animationBeats:
        raw.explanationPlan.animationPlan?.beats.map((beat) => ({
          action: requiredText(
            beat.action,
            `${raw.id} animation action`,
          ),
          target: requiredText(
            beat.target,
            `${raw.id} animation target`,
          ),
          narration: requiredText(
            beat.narration,
            `${raw.id} animation narration`,
          ),
        })) ?? [],
      visualExplanation: visualExplanation(raw),
    },
    source: {
      year: raw.source.year,
      gradeBand: raw.source.gradeBand,
      questionNumber: raw.source.questionNumber,
      answer: raw.source.answer,
      sourceDocument: raw.source.sourceDocument,
      answerKeyDocument: raw.source.answerKeyDocument,
      answerKeyVerified: raw.source.answerKeyVerified,
    },
  });
}

if (manifest.schemaVersion !== 1) {
  throw new Error(
    `Unsupported Math Kangaroo manifest schema: ${manifest.schemaVersion}`,
  );
}

export const MK_CONTENT_VERSION = manifest.contentVersion;

export const MK_ROUNDS: readonly MkRound[] = Object.freeze(
  manifest.rounds.map(toMkRound),
);

validateMkJourneyCorpus(MK_ROUNDS);

export const MK_CONTENT_RELEASE_READY = manifest.rounds.every((round) => {
  const qa = round.asset.qa;
  const width = round.asset.publicWidth ?? 0;
  const height = round.asset.publicHeight ?? 0;
  const dimensionsAreSane =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 80 &&
    height >= 80 &&
    width / height <= 10 &&
    height / width <= 10;
  let grounded = false;
  if (round.explanationPlan.visualExplanation) {
    try {
      const visual = visualExplanation(round);
      grounded = visual !== undefined;
    } catch {
      grounded = false;
    }
  }
  return (
    round.explanationPlan.status === "final-reviewed" &&
    (round.explanationPlan.solutionSteps?.length ?? 0) >= 2 &&
    Boolean(round.explanationPlan.wrongAnswerHint?.trim()) &&
    Boolean(round.explanationPlan.animationPlan?.beats.length) &&
    grounded &&
    dimensionsAreSane &&
    round.asset.status === "release-ready" &&
    qa?.promptFree === true &&
    qa.optionsRelabeled === true &&
    qa.diagramComplete === true &&
    qa.reviewed === true
  );
});

export function mkRoundsForJourneyLevel(
  journeyLevel: Exclude<JourneyLevel, "starter">,
): readonly MkRound[] {
  return MK_ROUNDS.filter(
    (round) => round.journeyLevel === journeyLevel,
  );
}

export const MK_MECHANIC_COUNTS: Readonly<Record<MkMechanic, number>> =
  Object.fromEntries(
    MK_MECHANICS.map((mechanic) => [
      mechanic,
      MK_ROUNDS.filter((round) => round.mechanic === mechanic).length,
    ]),
  ) as Readonly<Record<MkMechanic, number>>;
