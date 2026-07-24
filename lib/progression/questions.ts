import {
  JOURNEY_LEVELS,
  PROGRESSION_LEVELS,
  journeyLevelDifficulty,
  type JourneyLevel,
  type QuestionReference,
} from "./types.ts";

export function isQuestionReference(
  value: unknown,
): value is QuestionReference {
  if (!value || typeof value !== "object") return false;
  const question = value as Record<string, unknown>;
  if (
    typeof question.gameSlug !== "string" ||
    !question.gameSlug.trim() ||
    typeof question.level !== "string" ||
    !PROGRESSION_LEVELS.includes(
      question.level as (typeof PROGRESSION_LEVELS)[number],
    ) ||
    (question.fingerprint !== undefined &&
      typeof question.fingerprint !== "string")
  ) {
    return false;
  }

  if (question.source === "campaign") {
    return (
      Number.isInteger(question.questionIndex) &&
      Number(question.questionIndex) >= 0 &&
      Number(question.questionIndex) < 12 &&
      typeof question.contentVersion === "string" &&
      Boolean(question.contentVersion.trim())
    );
  }

  if (question.source === "generated") {
    return (
      typeof question.seed === "string" &&
      Boolean(question.seed) &&
      typeof question.generatorVersion === "string" &&
      Boolean(question.generatorVersion.trim())
    );
  }

  if (question.source === "journey") {
    return (
      typeof question.journeyLevel === "string" &&
      JOURNEY_LEVELS.includes(question.journeyLevel as JourneyLevel) &&
      question.level ===
        journeyLevelDifficulty(question.journeyLevel as JourneyLevel) &&
      typeof question.collectionId === "string" &&
      Boolean(question.collectionId.trim()) &&
      Number.isInteger(question.questionIndex) &&
      Number(question.questionIndex) >= 0 &&
      typeof question.contentVersion === "string" &&
      Boolean(question.contentVersion.trim())
    );
  }

  return false;
}

export function questionReferenceKey(question: QuestionReference): string {
  return [
    questionReferenceIdentityKey(question),
    encodeURIComponent(question.fingerprint ?? ""),
  ].join(":");
}

/**
 * Identifies the versioned question content without its optional materialized
 * fingerprint. A reference keeps this identity while its fingerprint is added
 * after the canonical game round is resolved.
 */
export function questionReferenceIdentityKey(
  question: QuestionReference,
): string {
  const prefix = [
    encodeURIComponent(question.gameSlug),
    question.level,
    question.source,
  ];

  if (question.source === "campaign") {
    return [
      ...prefix,
      encodeURIComponent(question.contentVersion),
      question.questionIndex,
    ].join(":");
  }

  if (question.source === "journey") {
    return [
      ...prefix,
      question.journeyLevel,
      encodeURIComponent(question.contentVersion),
      encodeURIComponent(question.collectionId),
      question.questionIndex,
    ].join(":");
  }

  return [
    ...prefix,
    encodeURIComponent(question.generatorVersion),
    encodeURIComponent(question.seed),
  ].join(":");
}

export function uniqueQuestionReferences(
  questions: readonly QuestionReference[],
): readonly QuestionReference[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = questionReferenceKey(question);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
