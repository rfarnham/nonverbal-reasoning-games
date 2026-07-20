import {
  PROGRESSION_LEVELS,
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

  return false;
}

export function questionReferenceKey(question: QuestionReference): string {
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
      encodeURIComponent(question.fingerprint ?? ""),
    ].join(":");
  }

  return [
    ...prefix,
    encodeURIComponent(question.generatorVersion),
    encodeURIComponent(question.seed),
    encodeURIComponent(question.fingerprint ?? ""),
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
