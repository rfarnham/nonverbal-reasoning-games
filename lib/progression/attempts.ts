import {
  CLEAR_ACCURACY_THRESHOLD,
  PROGRESSION_SCHEMA_VERSION,
  TURBO_ACTIVE_TIME_MS,
  type AttemptRound,
  type AttemptSection,
  type AttemptSettlement,
  type JourneyNode,
  type ProgressionAttempt,
  type QuestionReference,
} from "./types.ts";
import {
  isQuestionReference,
  questionReferenceKey,
} from "./questions.ts";

type CreateAttemptInput = {
  id: string;
  node: JourneyNode;
  questions?: readonly QuestionReference[];
  nowMs?: number;
};

type RecordAnswerInput = {
  correct: boolean;
  answerToken?: string;
  nowMs?: number;
};

function normalizedNow(nowMs: number | undefined): number {
  return Number.isFinite(nowMs) && Number(nowMs) >= 0
    ? Number(nowMs)
    : Date.now();
}

function assertActiveAttempt(attempt: ProgressionAttempt): void {
  if (attempt.phase !== "playing") {
    throw new Error(`Attempt is not accepting answers (${attempt.phase}).`);
  }
}

function makeRound(question: QuestionReference): AttemptRound {
  if (!isQuestionReference(question)) {
    throw new Error("Cannot add an invalid question reference to an attempt.");
  }
  return {
    question,
    phase: "answering",
    attemptCount: 0,
    firstTryCorrect: null,
  };
}

function sectionsForRounds(
  rounds: readonly AttemptRound[],
): readonly AttemptSection[] {
  const sections: AttemptSection[] = [];
  for (const [index, round] of rounds.entries()) {
    const previous = sections.at(-1);
    if (previous?.gameSlug === round.question.gameSlug) {
      previous.questionCount += 1;
    } else {
      sections.push({
        gameSlug: round.question.gameSlug,
        startRoundIndex: index,
        questionCount: 1,
      });
    }
  }
  return sections;
}

function sectionIndexForRound(
  sections: readonly AttemptSection[],
  roundIndex: number | null,
): number | null {
  if (roundIndex === null) return null;
  const sectionIndex = sections.findIndex(
    ({ startRoundIndex, questionCount }) =>
      roundIndex >= startRoundIndex &&
      roundIndex < startRoundIndex + questionCount,
  );
  return sectionIndex < 0 ? null : sectionIndex;
}

export function createProgressionAttempt({
  id,
  node,
  questions = [],
  nowMs,
}: CreateAttemptInput): ProgressionAttempt {
  const attemptId = id.trim();
  if (!attemptId) throw new Error("A progression attempt needs an ID.");

  const keys = new Set<string>();
  const rounds = questions.map((question) => {
    const key = questionReferenceKey(question);
    if (keys.has(key)) {
      throw new Error(`Duplicate question reference in attempt: ${key}`);
    }
    keys.add(key);
    return makeRound(question);
  });
  const now = normalizedNow(nowMs);
  const sections = sectionsForRounds(rounds);

  return {
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    id: attemptId,
    stopId: node.id,
    kind: node.kind,
    level: node.level,
    phase: "playing",
    rounds,
    currentRoundIndex: rounds.length ? 0 : null,
    sections,
    currentSectionIndex: sections.length ? 0 : null,
    redemption: null,
    activeTimeMs: 0,
    ...(node.kind === "turbo"
      ? { turboRemainingMs: TURBO_ACTIVE_TIME_MS }
      : {}),
    startedAtMs: now,
    updatedAtMs: now,
  };
}

export function currentAttemptRound(
  attempt: ProgressionAttempt,
): AttemptRound | undefined {
  return attempt.currentRoundIndex === null
    ? undefined
    : attempt.rounds[attempt.currentRoundIndex];
}

export function currentAttemptSection(
  attempt: ProgressionAttempt,
): AttemptSection | undefined {
  return attempt.currentSectionIndex === null
    ? undefined
    : attempt.sections[attempt.currentSectionIndex];
}

export function appendAttemptQuestion(
  attempt: ProgressionAttempt,
  question: QuestionReference,
  nowMs?: number,
): ProgressionAttempt {
  assertActiveAttempt(attempt);
  const key = questionReferenceKey(question);
  if (
    attempt.rounds.some(
      ({ question: existing }) => questionReferenceKey(existing) === key,
    )
  ) {
    throw new Error(`Question is already in this attempt: ${key}`);
  }

  const rounds = [...attempt.rounds, makeRound(question)];
  const sections = sectionsForRounds(rounds);
  const currentRoundIndex =
    attempt.currentRoundIndex === null
      ? rounds.length - 1
      : attempt.currentRoundIndex;
  return {
    ...attempt,
    rounds,
    currentRoundIndex,
    sections,
    currentSectionIndex: sectionIndexForRound(sections, currentRoundIndex),
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function recordQuestionAttempt(
  attempt: ProgressionAttempt,
  { correct, answerToken, nowMs }: RecordAnswerInput,
): ProgressionAttempt {
  assertActiveAttempt(attempt);
  const currentIndex = attempt.currentRoundIndex;
  const current =
    currentIndex === null ? undefined : attempt.rounds[currentIndex];
  if (currentIndex === null || !current) {
    throw new Error("Attempt has no active question.");
  }
  if (current.phase !== "answering") {
    throw new Error(`Question is not accepting an answer (${current.phase}).`);
  }

  const updatedRound: AttemptRound = {
    ...current,
    phase: correct ? "solved" : "feedback",
    attemptCount: current.attemptCount + 1,
    firstTryCorrect:
      current.firstTryCorrect ?? (current.attemptCount === 0 ? correct : false),
    ...(answerToken === undefined ? {} : { lastAnswerToken: answerToken }),
  };
  const rounds = [...attempt.rounds];
  rounds[currentIndex] = updatedRound;

  return {
    ...attempt,
    rounds,
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function retryCurrentQuestion(
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  assertActiveAttempt(attempt);
  const currentIndex = attempt.currentRoundIndex;
  const current =
    currentIndex === null ? undefined : attempt.rounds[currentIndex];
  if (currentIndex === null || !current || current.phase !== "feedback") {
    throw new Error("Only a question showing incorrect feedback can be retried.");
  }
  const rounds = [...attempt.rounds];
  rounds[currentIndex] = {
    ...current,
    phase: "answering",
    lastAnswerToken: undefined,
  };
  return {
    ...attempt,
    rounds,
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function advanceAttemptQuestion(
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  assertActiveAttempt(attempt);
  const currentIndex = attempt.currentRoundIndex;
  const current =
    currentIndex === null ? undefined : attempt.rounds[currentIndex];
  if (currentIndex === null || !current || current.phase !== "solved") {
    throw new Error("Solve the active question before advancing.");
  }
  if (currentIndex + 1 >= attempt.rounds.length) {
    return finishAttemptQuestions(attempt, nowMs);
  }
  const nextRoundIndex = currentIndex + 1;
  return {
    ...attempt,
    currentRoundIndex: nextRoundIndex,
    currentSectionIndex: sectionIndexForRound(
      attempt.sections,
      nextRoundIndex,
    ),
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function finishAttemptQuestions(
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  assertActiveAttempt(attempt);
  if (!attempt.rounds.length) {
    throw new Error("An attempt needs at least one answered question.");
  }
  if (
    attempt.rounds.some(
      ({ phase, firstTryCorrect }) =>
        phase !== "solved" || firstTryCorrect === null,
    )
  ) {
    throw new Error("All attempt questions must be solved before finishing.");
  }
  const hasMistakes = attempt.rounds.some(
    ({ firstTryCorrect }) => firstTryCorrect === false,
  );
  return {
    ...attempt,
    phase: hasMistakes ? "redemption-ready" : "summary-ready",
    currentRoundIndex: null,
    currentSectionIndex: null,
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function addAttemptActiveTime(
  attempt: ProgressionAttempt,
  elapsedMs: number,
  nowMs?: number,
  options: { countTowardTurbo?: boolean } = {},
): ProgressionAttempt {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error("Active time must be a finite, non-negative duration.");
  }
  const duration = Math.round(elapsedMs);
  const remaining =
    attempt.turboRemainingMs === undefined
      ? undefined
      : options.countTowardTurbo === false
        ? attempt.turboRemainingMs
        : Math.max(0, attempt.turboRemainingMs - duration);
  return {
    ...attempt,
    activeTimeMs: attempt.activeTimeMs + duration,
    ...(remaining === undefined ? {} : { turboRemainingMs: remaining }),
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function isTurboTimeExpired(attempt: ProgressionAttempt): boolean {
  return attempt.kind === "turbo" && attempt.turboRemainingMs === 0;
}

function missedQuestions(
  attempt: ProgressionAttempt,
): readonly QuestionReference[] {
  return attempt.rounds
    .filter(({ firstTryCorrect }) => firstTryCorrect === false)
    .map(({ question }) => question);
}

export function beginAttemptRedemption(
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  if (attempt.phase !== "redemption-ready") {
    throw new Error("This attempt is not ready for redemption.");
  }
  const queue = missedQuestions(attempt);
  if (!queue.length) {
    throw new Error("This attempt has no questions to redeem.");
  }
  return {
    ...attempt,
    phase: "redemption",
    redemption: {
      queue,
      currentIndex: 0,
      phase: "answering",
      attemptCount: 0,
    },
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function currentRedemptionQuestion(
  attempt: ProgressionAttempt,
): QuestionReference | undefined {
  if (attempt.phase !== "redemption" || !attempt.redemption) return undefined;
  return attempt.redemption.queue[attempt.redemption.currentIndex];
}

export function recordRedemptionAttempt(
  attempt: ProgressionAttempt,
  { correct, answerToken, nowMs }: RecordAnswerInput,
): ProgressionAttempt {
  const redemption = attempt.redemption;
  if (
    attempt.phase !== "redemption" ||
    !redemption ||
    redemption.phase !== "answering"
  ) {
    throw new Error("Redemption is not accepting an answer.");
  }
  return {
    ...attempt,
    redemption: {
      ...redemption,
      phase: correct ? "solved" : "feedback",
      attemptCount: redemption.attemptCount + 1,
      ...(answerToken === undefined ? {} : { lastAnswerToken: answerToken }),
    },
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function retryRedemptionQuestion(
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  const redemption = attempt.redemption;
  if (
    attempt.phase !== "redemption" ||
    !redemption ||
    redemption.phase !== "feedback"
  ) {
    throw new Error("Only incorrect redemption feedback can be retried.");
  }
  return {
    ...attempt,
    redemption: {
      ...redemption,
      phase: "answering",
      lastAnswerToken: undefined,
    },
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function advanceRedemptionQuestion(
  attempt: ProgressionAttempt,
  nowMs?: number,
): ProgressionAttempt {
  const redemption = attempt.redemption;
  if (
    attempt.phase !== "redemption" ||
    !redemption ||
    redemption.phase !== "solved"
  ) {
    throw new Error("Solve the redemption question before advancing.");
  }
  const nextIndex = redemption.currentIndex + 1;
  if (nextIndex >= redemption.queue.length) {
    return {
      ...attempt,
      phase: "summary-ready",
      redemption: {
        ...redemption,
        currentIndex: redemption.queue.length,
      },
      updatedAtMs: normalizedNow(nowMs),
    };
  }
  return {
    ...attempt,
    redemption: {
      ...redemption,
      currentIndex: nextIndex,
      phase: "answering",
      attemptCount: 0,
      lastAnswerToken: undefined,
    },
    updatedAtMs: normalizedNow(nowMs),
  };
}

export function isClearAccuracy(
  correctFirstAttempts: number,
  totalFirstAttempts: number,
): boolean {
  return (
    Number.isInteger(correctFirstAttempts) &&
    Number.isInteger(totalFirstAttempts) &&
    totalFirstAttempts > 0 &&
    correctFirstAttempts >= 0 &&
    correctFirstAttempts <= totalFirstAttempts &&
    correctFirstAttempts / totalFirstAttempts > CLEAR_ACCURACY_THRESHOLD
  );
}

export function summarizeAttempt(
  attempt: ProgressionAttempt,
  xpAwarded = 0,
  settledAtMs = Date.now(),
): AttemptSettlement {
  const attempted = attempt.rounds.filter(
    ({ firstTryCorrect }) => firstTryCorrect !== null,
  );
  const totalFirstAttempts = attempted.length;
  const correctFirstAttempts = attempted.filter(
    ({ firstTryCorrect }) => firstTryCorrect,
  ).length;
  const accuracy =
    totalFirstAttempts === 0 ? 0 : correctFirstAttempts / totalFirstAttempts;
  return {
    passed: isClearAccuracy(correctFirstAttempts, totalFirstAttempts),
    correctFirstAttempts,
    totalFirstAttempts,
    accuracy,
    accuracyPercent: Math.round(accuracy * 1000) / 10,
    activeTimeMs: attempt.activeTimeMs,
    xpAwarded,
    settledAtMs: normalizedNow(settledAtMs),
  };
}
