import { createProgressionAttempt } from "./attempts.ts";
import {
  questionReferenceIdentityKey,
  questionReferenceKey,
} from "./questions.ts";
import {
  CAMPAIGN_QUESTIONS_PER_STOP,
  PROGRESSION_LEVELS,
  type CampaignQuestionReference,
  type CulminationJourneyNode,
  type GeneratedQuestionReference,
  type JourneyQuestionReference,
  type MissedQuestion,
  type NormalJourneyNode,
  type ProgressionAttempt,
  type ProgressionLevel,
  type QuestionReference,
  type ReviewJourneyNode,
  type TurboJourneyNode,
} from "./types.ts";

type TimedBuilderInput = {
  id: string;
  nowMs?: number;
};

type NormalAttemptInput = TimedBuilderInput & {
  node: NormalJourneyNode;
  campaignQuestions?: readonly CampaignQuestionReference[];
  journeyQuestions?: readonly JourneyQuestionReference[];
};

type ReviewAttemptInput = TimedBuilderInput & {
  node: ReviewJourneyNode;
  journeyQuestions: readonly JourneyQuestionReference[];
};

type TurboAttemptInput = TimedBuilderInput & {
  node: TurboJourneyNode;
  generatorVersion: string;
};

export type CulminationQuestionPool = {
  gameSlug: string;
  approachableQuestion: CampaignQuestionReference;
  campaignQuestions: readonly CampaignQuestionReference[];
  currentContentVersion: string;
  currentJourneyContentVersion?: string;
  currentGeneratorVersion?: string;
};

type CulminationAttemptInput = TimedBuilderInput & {
  node: CulminationJourneyNode;
  missedQuestions: readonly MissedQuestion[];
  questionPools: readonly CulminationQuestionPool[];
  fixedSections?: readonly {
    gameSlug: string;
    questions: readonly JourneyQuestionReference[];
  }[];
};

function requiredVersion(value: string, label: string): string {
  const version = value.trim();
  if (!version) throw new Error(`${label} cannot be empty.`);
  return version;
}

function isAtOrBelowLevel(
  candidate: ProgressionLevel,
  cap: ProgressionLevel,
): boolean {
  return (
    PROGRESSION_LEVELS.indexOf(candidate) <=
    PROGRESSION_LEVELS.indexOf(cap)
  );
}

export function deterministicTurboSeed(
  attemptId: string,
  stopId: string,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("Turbo sequence must be a non-negative integer.");
  }
  return [
    "progression",
    encodeURIComponent(attemptId),
    encodeURIComponent(stopId),
    String(sequence),
  ].join(":");
}

export function turboQuestionReference(
  attempt: Pick<
    ProgressionAttempt,
    "id" | "stopId" | "level" | "rounds" | "sections"
  >,
  generatorVersion: string,
  options: { level?: ProgressionLevel; fingerprint?: string } = {},
): GeneratedQuestionReference {
  const gameSlug =
    attempt.sections[0]?.gameSlug ??
    attempt.rounds[0]?.question.gameSlug;
  if (!gameSlug) {
    throw new Error("Turbo attempt is missing its game section.");
  }
  const level = options.level ?? attempt.level;
  if (!isAtOrBelowLevel(level, attempt.level)) {
    throw new Error("Turbo difficulty cannot exceed the board level.");
  }
  return {
    source: "generated",
    gameSlug,
    level,
    seed: deterministicTurboSeed(
      attempt.id,
      attempt.stopId,
      attempt.rounds.length,
    ),
    generatorVersion: requiredVersion(
      generatorVersion,
      "Generator version",
    ),
    ...(options.fingerprint
      ? { fingerprint: options.fingerprint }
      : {}),
  };
}

export function createNormalProgressionAttempt({
  id,
  node,
  campaignQuestions,
  journeyQuestions,
  nowMs,
}: NormalAttemptInput): ProgressionAttempt {
  const questions = journeyQuestions ?? campaignQuestions ?? [];
  if (questions.length !== CAMPAIGN_QUESTIONS_PER_STOP) {
    throw new Error(
      `A normal stop needs ${CAMPAIGN_QUESTIONS_PER_STOP} campaign questions.`,
    );
  }
  if (
    questions.some(
      (question, index) =>
        question.gameSlug !== node.gameSlug ||
        question.level !== node.level ||
        (question.source === "journey"
          ? question.journeyLevel !== node.journeyLevel ||
            question.collectionId !== node.collectionId ||
            question.questionIndex !== node.questionOffset + index
          : question.source !== "campaign"),
    )
  ) {
    throw new Error(
      "Normal stop questions must match the node's game and level.",
    );
  }
  return createProgressionAttempt({
    id,
    node,
    questions,
    nowMs,
  });
}

export function createReviewProgressionAttempt({
  id,
  node,
  journeyQuestions,
  nowMs,
}: ReviewAttemptInput): ProgressionAttempt {
  if (
    journeyQuestions.length !== node.questionCount ||
    journeyQuestions.some(
      (question, index) =>
        question.source !== "journey" ||
        question.gameSlug !== node.gameSlug ||
        question.level !== node.level ||
        question.journeyLevel !== node.journeyLevel ||
        question.collectionId !== node.collectionId ||
        question.questionIndex !== node.questionOffset + index,
    )
  ) {
    throw new Error("Review questions must match the Journey review stop.");
  }
  return createProgressionAttempt({
    id,
    node,
    questions: journeyQuestions,
    nowMs,
  });
}

export function createTurboProgressionAttempt({
  id,
  node,
  generatorVersion,
  nowMs,
}: TurboAttemptInput): ProgressionAttempt {
  const version = requiredVersion(generatorVersion, "Generator version");
  const initialQuestion: GeneratedQuestionReference = {
    source: "generated",
    gameSlug: node.gameSlug,
    level: "starter",
    seed: deterministicTurboSeed(id, node.id, 0),
    generatorVersion: version,
  };
  return createProgressionAttempt({
    id,
    node,
    questions: [initialQuestion],
    nowMs,
  });
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function deterministicFallbackOrder(
  questions: readonly CampaignQuestionReference[],
  seed: string,
): readonly CampaignQuestionReference[] {
  return questions
    .map((question, originalIndex) => ({
      question,
      originalIndex,
      rank: stableHash(`${seed}:${questionReferenceKey(question)}`),
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank || left.originalIndex - right.originalIndex,
    )
    .map(({ question }) => question);
}

function currentMissReference(
  question: QuestionReference,
  pool: CulminationQuestionPool,
): QuestionReference | undefined {
  if (question.gameSlug !== pool.gameSlug) return undefined;
  if (question.source === "generated") {
    return pool.currentGeneratorVersion === question.generatorVersion
      ? question
      : undefined;
  }
  if (question.source === "journey") {
    return pool.currentJourneyContentVersion === question.contentVersion
      ? question
      : undefined;
  }

  return pool.currentContentVersion === question.contentVersion
    ? question
    : undefined;
}

function culminationSectionQuestions(
  attemptId: string,
  node: CulminationJourneyNode,
  pool: CulminationQuestionPool,
  missed: readonly MissedQuestion[],
): readonly QuestionReference[] {
  requiredVersion(pool.currentContentVersion, "Campaign content version");
  if (
    pool.approachableQuestion.gameSlug !== pool.gameSlug ||
    pool.approachableQuestion.source !== "campaign" ||
    pool.approachableQuestion.level !== "starter"
  ) {
    throw new Error(
      `Approachable culmination question must be a Starter Campaign question for ${pool.gameSlug}.`,
    );
  }

  const selected: QuestionReference[] = [pool.approachableQuestion];
  const selectedKeys = new Set(selected.map(questionReferenceIdentityKey));
  const candidates: QuestionReference[] = [];
  for (const missedQuestion of missed) {
    const current = currentMissReference(missedQuestion.question, pool);
    if (current) candidates.push(current);
  }
  candidates.push(
    ...deterministicFallbackOrder(
      pool.campaignQuestions,
      `${attemptId}:${node.id}:${pool.gameSlug}`,
    ),
  );

  for (const question of candidates) {
    if (
      !isAtOrBelowLevel(question.level, node.level) ||
      selectedKeys.has(questionReferenceIdentityKey(question))
    ) {
      continue;
    }
    selected.push(question);
    selectedKeys.add(questionReferenceIdentityKey(question));
    if (selected.length === node.questionsPerGame) return selected;
  }
  throw new Error(
    `Culmination needs ${node.questionsPerGame} current questions for ${pool.gameSlug}.`,
  );
}

export function createCulminationProgressionAttempt({
  id,
  node,
  missedQuestions,
  questionPools,
  fixedSections = [],
  nowMs,
}: CulminationAttemptInput): ProgressionAttempt {
  const poolsBySlug = new Map(
    questionPools.map((pool) => [pool.gameSlug, pool]),
  );
  if (poolsBySlug.size !== questionPools.length) {
    throw new Error("Culmination question pools must have unique game slugs.");
  }

  const fixedBySlug = new Map(
    fixedSections.map((section) => [section.gameSlug, section.questions]),
  );
  if (fixedBySlug.size !== fixedSections.length) {
    throw new Error("Fixed culmination sections must have unique game slugs.");
  }
  const questions = node.sections.flatMap((section) => {
    if (section.selection === "mistakes") {
      const pool = poolsBySlug.get(section.gameSlug);
      if (!pool) {
        throw new Error(
          `Missing culmination question pool for ${section.gameSlug}.`,
        );
      }
      return culminationSectionQuestions(id, node, pool, missedQuestions);
    }
    const fixed = fixedBySlug.get(section.gameSlug);
    if (
      !fixed ||
      fixed.length !== section.questionCount ||
      fixed.some(
        (question, index) =>
          question.source !== "journey" ||
          question.gameSlug !== section.gameSlug ||
          question.level !== node.level ||
          question.journeyLevel !== node.journeyLevel ||
          question.collectionId !== section.collectionId ||
          question.questionIndex !== section.questionOffset + index,
      )
    ) {
      throw new Error(
        `Fixed culmination questions do not match ${section.gameSlug}.`,
      );
    }
    return fixed;
  });
  const attempt = createProgressionAttempt({
    id,
    node,
    questions,
    nowMs,
  });
  if (
    attempt.sections.length !== node.sections.length ||
    attempt.sections.some(
      (section, index) =>
        section.gameSlug !== node.sections[index]?.gameSlug ||
        section.questionCount !== node.sections[index]?.questionCount,
    )
  ) {
    throw new Error("Culmination sections are not aligned to journey games.");
  }
  return attempt;
}
