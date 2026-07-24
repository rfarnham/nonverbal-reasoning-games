import { isQuestionReference, questionReferenceKey } from "./questions.ts";
import {
  initialAdaptiveState,
  recordAdaptiveFirstAttempt,
} from "../adaptive-progression.ts";
import {
  CAMPAIGN_QUESTIONS_PER_STOP,
  CLEAR_ACCURACY_THRESHOLD,
  PROGRESSION_LEVELS,
  PROGRESSION_SCHEMA_VERSION,
  REVIEW_QUESTIONS_PER_STOP,
  type AttemptRound,
  type AttemptSection,
  type AttemptSettlement,
  type JourneyNode,
  type ProgressionAttempt,
  type QuestionReference,
  type RedemptionState,
} from "./types.ts";

function fail(message: string): never {
  throw new Error(`Invalid progression attempt: ${message}`);
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeInteger(value: number): boolean {
  return isFiniteNonNegative(value) && Number.isInteger(value);
}

function isAtOrBelowLevel(
  candidate: QuestionReference["level"],
  cap: QuestionReference["level"],
): boolean {
  return PROGRESSION_LEVELS.indexOf(candidate) <= PROGRESSION_LEVELS.indexOf(cap);
}

function isPristineRound(round: AttemptRound): boolean {
  return (
    round.phase === "answering" &&
    round.attemptCount === 0 &&
    round.firstTryCorrect === null &&
    round.firstAnsweredAtMs === undefined &&
    round.lastAnswerToken === undefined
  );
}

function validateRound(round: AttemptRound, index: number): void {
  if (!isQuestionReference(round.question)) {
    fail(`round ${index + 1} has an invalid question reference`);
  }
  if (!isFiniteNonNegativeInteger(round.attemptCount)) {
    fail(`round ${index + 1} has an invalid attempt count`);
  }
  if (
    round.firstAnswerActiveTimeMs !== undefined &&
    !isFiniteNonNegative(round.firstAnswerActiveTimeMs)
  ) {
    fail(`round ${index + 1} has invalid first-answer timing`);
  }
  if (
    round.firstAnsweredAtMs !== undefined &&
    !isFiniteNonNegative(round.firstAnsweredAtMs)
  ) {
    fail(`round ${index + 1} has an invalid first-answer timestamp`);
  }
  if (
    round.phase !== "answering" &&
    round.phase !== "feedback" &&
    round.phase !== "solved"
  ) {
    fail(`round ${index + 1} has an unknown phase`);
  }

  if (round.attemptCount === 0) {
    if (!isPristineRound(round)) {
      fail(`round ${index + 1} has state without a recorded answer`);
    }
    return;
  }

  if (round.firstTryCorrect === null) {
    fail(`round ${index + 1} lost its first-attempt result`);
  }
  if (round.firstTryCorrect === true) {
    if (round.attemptCount !== 1 || round.phase !== "solved") {
      fail(`round ${index + 1} rewrites a first-try success`);
    }
    return;
  }
  if (round.firstTryCorrect !== false) {
    fail(`round ${index + 1} has an invalid first-attempt result`);
  }
  if (round.phase === "feedback" || round.phase === "answering") return;
  if (round.phase !== "solved" || round.attemptCount < 2) {
    fail(`round ${index + 1} has an invalid retry state`);
  }
}

function deriveSections(
  rounds: readonly AttemptRound[],
): readonly AttemptSection[] {
  const sections: AttemptSection[] = [];
  for (const [index, round] of rounds.entries()) {
    const current = sections.at(-1);
    if (current?.gameSlug === round.question.gameSlug) {
      current.questionCount += 1;
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

function sectionsMatch(
  actual: readonly AttemptSection[],
  expected: readonly AttemptSection[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (section, index) =>
        section.gameSlug === expected[index]?.gameSlug &&
        section.startRoundIndex === expected[index]?.startRoundIndex &&
        section.questionCount === expected[index]?.questionCount,
    )
  );
}

function validateQuestionSet(
  attempt: ProgressionAttempt,
  node: JourneyNode,
): void {
  if (!attempt.rounds.length) fail("the stop has no questions");
  const keys = attempt.rounds.map(({ question }) =>
    questionReferenceKey(question),
  );
  if (new Set(keys).size !== keys.length) {
    fail("the stop contains duplicate question references");
  }

  if (node.kind === "normal") {
    if (attempt.rounds.length !== CAMPAIGN_QUESTIONS_PER_STOP) {
      fail(
        `an ordinary stop needs ${CAMPAIGN_QUESTIONS_PER_STOP} questions`,
      );
    }
    attempt.rounds.forEach(({ question }, index) => {
      const campaignMatch =
        question.source === "campaign" &&
        question.questionIndex === index;
      const journeyMatch =
        question.source === "journey" &&
        question.journeyLevel === node.journeyLevel &&
        question.collectionId === node.collectionId &&
        question.questionIndex === node.questionOffset + index;
      if (
        question.gameSlug !== node.gameSlug ||
        question.level !== node.level ||
        (!campaignMatch && !journeyMatch)
      ) {
        fail(`ordinary question ${index + 1} does not match its stop`);
      }
    });
    return;
  }

  if (node.kind === "review") {
    if (attempt.rounds.length !== REVIEW_QUESTIONS_PER_STOP) {
      fail(`a review stop needs ${REVIEW_QUESTIONS_PER_STOP} questions`);
    }
    attempt.rounds.forEach(({ question }, index) => {
      if (
        question.source !== "journey" ||
        question.gameSlug !== node.gameSlug ||
        question.level !== node.level ||
        question.journeyLevel !== node.journeyLevel ||
        question.collectionId !== node.collectionId ||
        question.questionIndex !== node.questionOffset + index
      ) {
        fail(`review question ${index + 1} does not match its stop`);
      }
    });
    return;
  }

  if (node.kind === "turbo") {
    const allowedLevels = PROGRESSION_LEVELS.slice(
      0,
      PROGRESSION_LEVELS.indexOf(node.level) + 1,
    );
    let adaptiveState = initialAdaptiveState(allowedLevels);
    attempt.rounds.forEach(({ question }, index) => {
      if (
        question.gameSlug !== node.gameSlug ||
        !isAtOrBelowLevel(question.level, node.level)
      ) {
        fail(`Turbo question ${index + 1} exceeds its game or level cap`);
      }
      if (question.level !== adaptiveState.targetDifficulty) {
        fail(`Turbo question ${index + 1} does not follow adaptive difficulty`);
      }
      const firstTryCorrect = attempt.rounds[index]?.firstTryCorrect;
      if (firstTryCorrect !== null) {
        adaptiveState = recordAdaptiveFirstAttempt(
          allowedLevels,
          adaptiveState,
          {
            roundId: questionReferenceKey(question),
            difficulty: question.level,
            firstTryCorrect,
          },
        );
      }
    });
    if (
      attempt.turboRemainingMs === undefined ||
      !isFiniteNonNegativeInteger(attempt.turboRemainingMs) ||
      attempt.turboRemainingMs > node.activeTimeMs
    ) {
      fail("Turbo Time has an invalid remaining duration");
    }
    return;
  }

  const expectedQuestionCount = node.sections.reduce(
    (total, section) => total + section.questionCount,
    0,
  );
  if (attempt.rounds.length !== expectedQuestionCount) {
    fail(`the culmination needs ${expectedQuestionCount} questions`);
  }
  let start = 0;
  node.sections.forEach((sectionSpec) => {
    const section = attempt.rounds.slice(
      start,
      start + sectionSpec.questionCount,
    );
    if (sectionSpec.selection === "mistakes") {
      const approachable = section[0]?.question;
      if (
        approachable?.source !== "campaign" ||
        approachable.gameSlug !== sectionSpec.gameSlug ||
        approachable.level !== "starter"
      ) {
        fail(
          `the ${sectionSpec.gameSlug} culmination section has no Starter opener`,
        );
      }
    }
    section.forEach(({ question }, questionIndex) => {
      const fixedMatch =
        sectionSpec.selection === "fixed" &&
        question.source === "journey" &&
        question.journeyLevel === node.journeyLevel &&
        question.collectionId === sectionSpec.collectionId &&
        question.questionIndex ===
          sectionSpec.questionOffset + questionIndex;
      if (
        question.gameSlug !== sectionSpec.gameSlug ||
        !isAtOrBelowLevel(question.level, node.level) ||
        (sectionSpec.selection === "fixed" && !fixedMatch)
      ) {
        fail(
          `${sectionSpec.gameSlug} culmination question ${questionIndex + 1} does not match its section`,
        );
      }
    });
    start += sectionSpec.questionCount;
  });
}

function missedQuestionKeys(
  attempt: ProgressionAttempt,
): readonly string[] {
  return attempt.rounds
    .filter(({ firstTryCorrect }) => firstTryCorrect === false)
    .map(({ question }) => questionReferenceKey(question));
}

function validateRedemptionQueue(
  attempt: ProgressionAttempt,
  redemption: RedemptionState,
): void {
  const missedKeys = missedQuestionKeys(attempt);
  const queueKeys = redemption.queue.map((question) => {
    if (!isQuestionReference(question)) {
      fail("redemption contains an invalid question reference");
    }
    return questionReferenceKey(question);
  });
  if (
    missedKeys.length !== queueKeys.length ||
    missedKeys.some((key, index) => key !== queueKeys[index])
  ) {
    fail("redemption does not match the first-attempt misses");
  }
  if (!redemption.queue.length) fail("redemption has an empty queue");
  if (!isFiniteNonNegativeInteger(redemption.attemptCount)) {
    fail("redemption has an invalid attempt count");
  }
}

function expectedSettlement(
  attempt: ProgressionAttempt,
): Omit<AttemptSettlement, "xpAwarded" | "settledAtMs"> {
  const totalFirstAttempts = attempt.rounds.length;
  const correctFirstAttempts = attempt.rounds.filter(
    ({ firstTryCorrect }) => firstTryCorrect === true,
  ).length;
  const accuracy = correctFirstAttempts / totalFirstAttempts;
  return {
    passed: accuracy > CLEAR_ACCURACY_THRESHOLD,
    correctFirstAttempts,
    totalFirstAttempts,
    accuracy,
    accuracyPercent: Math.round(accuracy * 1000) / 10,
    activeTimeMs: attempt.activeTimeMs,
  };
}

function validateSettlement(
  attempt: ProgressionAttempt,
  node: JourneyNode,
): void {
  const settlement = attempt.settlement;
  if (!settlement) fail(`${attempt.phase} is missing its settlement`);
  const expected = expectedSettlement(attempt);
  if (
    settlement.passed !== expected.passed ||
    settlement.correctFirstAttempts !== expected.correctFirstAttempts ||
    settlement.totalFirstAttempts !== expected.totalFirstAttempts ||
    settlement.accuracy !== expected.accuracy ||
    settlement.accuracyPercent !== expected.accuracyPercent ||
    settlement.activeTimeMs !== expected.activeTimeMs
  ) {
    fail("the settlement does not match its recorded first attempts");
  }
  if (
    !isFiniteNonNegativeInteger(settlement.xpAwarded) ||
    (!settlement.passed && settlement.xpAwarded !== 0) ||
    (settlement.passed &&
      settlement.xpAwarded !== 0 &&
      settlement.xpAwarded !== node.xp)
  ) {
    fail("the settlement has an invalid XP award");
  }
  if (!isFiniteNonNegative(settlement.settledAtMs)) {
    fail("the settlement has an invalid timestamp");
  }
  if (
    (attempt.phase === "summary" && !settlement.passed) ||
    (attempt.phase === "retry-required" && settlement.passed)
  ) {
    fail(`${attempt.phase} disagrees with the settlement result`);
  }
}

/**
 * Enforces the semantic invariants that TypeScript alone cannot protect after
 * a localStorage round-trip. It deliberately accepts current content-version
 * migrations while rejecting shortened, reordered, or phase-incoherent runs.
 */
export function assertProgressionAttemptIntegrity(
  attempt: ProgressionAttempt,
  node: JourneyNode,
): void {
  if (
    attempt.schemaVersion !== PROGRESSION_SCHEMA_VERSION ||
    !attempt.id.trim() ||
    attempt.stopId !== node.id ||
    attempt.kind !== node.kind ||
    attempt.journeyLevel !== node.journeyLevel ||
    attempt.level !== node.level
  ) {
    fail("the attempt does not match its journey stop");
  }
  if (
    !isFiniteNonNegative(attempt.activeTimeMs) ||
    !isFiniteNonNegative(attempt.startedAtMs) ||
    !isFiniteNonNegative(attempt.updatedAtMs)
  ) {
    fail("the attempt has an invalid duration or timestamp");
  }
  if (node.kind !== "turbo" && attempt.turboRemainingMs !== undefined) {
    fail("a non-Turbo stop contains a Turbo timer");
  }

  attempt.rounds.forEach(validateRound);
  validateQuestionSet(attempt, node);

  const sections = deriveSections(attempt.rounds);
  if (!sectionsMatch(attempt.sections, sections)) {
    fail("the saved game sections do not match the question order");
  }
  if (
    attempt.pendingSectionIndex !== null &&
    attempt.kind !== "culmination"
  ) {
    fail("a non-culmination stop contains a pending game section");
  }

  const playing = attempt.phase === "playing";
  if (playing) {
    const currentIndex = attempt.currentRoundIndex;
    if (
      currentIndex === null ||
      !Number.isInteger(currentIndex) ||
      currentIndex < 0 ||
      currentIndex >= attempt.rounds.length
    ) {
      fail("playing has no current question");
    }
    attempt.rounds.forEach((round, index) => {
      if (index < currentIndex && round.phase !== "solved") {
        fail("playing skipped an unsolved question");
      }
      if (index > currentIndex && !isPristineRound(round)) {
        fail("playing contains an attempted future question");
      }
    });
    const expectedSectionIndex = sections.findIndex(
      ({ startRoundIndex, questionCount }) =>
        currentIndex >= startRoundIndex &&
        currentIndex < startRoundIndex + questionCount,
    );
    if (attempt.currentSectionIndex !== expectedSectionIndex) {
      fail("playing has an invalid current game section");
    }
    if (attempt.pendingSectionIndex !== null) {
      const pendingSection = sections[attempt.pendingSectionIndex];
      if (
        attempt.pendingSectionIndex !== expectedSectionIndex ||
        !pendingSection ||
        currentIndex !== pendingSection.startRoundIndex ||
        !isPristineRound(attempt.rounds[currentIndex])
      ) {
        fail("playing has an invalid pending game section");
      }
    }
    if (attempt.redemption !== null || attempt.settlement !== undefined) {
      fail("playing contains later-stage state");
    }
    return;
  }

  if (
    attempt.currentRoundIndex !== null ||
    attempt.currentSectionIndex !== null ||
    attempt.pendingSectionIndex !== null ||
    attempt.rounds.some(({ phase }) => phase !== "solved")
  ) {
    fail(`${attempt.phase} contains unfinished ordinary questions`);
  }
  if (node.kind === "turbo" && attempt.turboRemainingMs !== 0) {
    fail("Turbo Time ended before its active timer expired");
  }

  const hasMisses = missedQuestionKeys(attempt).length > 0;
  if (attempt.phase === "redemption-ready") {
    if (!hasMisses || attempt.redemption !== null || attempt.settlement) {
      fail("redemption-ready has inconsistent mistake state");
    }
    return;
  }

  if (attempt.phase === "redemption") {
    const redemption = attempt.redemption;
    if (!hasMisses || !redemption || attempt.settlement) {
      fail("redemption is missing its mistake queue");
    }
    validateRedemptionQueue(attempt, redemption);
    if (
      redemption.currentIndex < 0 ||
      redemption.currentIndex >= redemption.queue.length
    ) {
      fail("redemption has no current question");
    }
    if (
      (redemption.phase === "answering" &&
        redemption.attemptCount === 0 &&
        redemption.lastAnswerToken !== undefined) ||
      (redemption.phase !== "answering" && redemption.attemptCount < 1)
    ) {
      fail("redemption has an invalid current-question state");
    }
    return;
  }

  const completedRedemption = attempt.redemption;
  if (hasMisses) {
    if (!completedRedemption) {
      fail(`${attempt.phase} skipped required redemption`);
    }
    validateRedemptionQueue(attempt, completedRedemption);
    if (
      completedRedemption.currentIndex !== completedRedemption.queue.length ||
      completedRedemption.phase !== "solved" ||
      completedRedemption.attemptCount < 1
    ) {
      fail(`${attempt.phase} contains unfinished redemption`);
    }
  } else if (completedRedemption !== null) {
    fail(`${attempt.phase} has redemption without a first-attempt miss`);
  }

  if (attempt.phase === "summary-ready") {
    if (attempt.settlement !== undefined) {
      fail("summary-ready already contains a settlement");
    }
    return;
  }

  if (
    attempt.phase !== "summary" &&
    attempt.phase !== "retry-required" &&
    attempt.phase !== "complete"
  ) {
    fail(`unknown attempt phase: ${attempt.phase}`);
  }
  validateSettlement(attempt, node);
}
