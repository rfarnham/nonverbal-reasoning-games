import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNEY_LEVELS,
  journeyLevelDifficulty,
  journeyLevelLabel,
  addAttemptActiveTime,
  addPlayerProfile,
  advanceAttemptQuestion,
  advanceRedemptionQuestion,
  assertProgressionAttemptIntegrity,
  beginAttemptRedemption,
  beginCulminationSection,
  buildJourneyPlan,
  closeAttemptSummary,
  createCulminationProgressionAttempt,
  createNormalProgressionAttempt,
  createPlayerProfile,
  createProgressionAttempt,
  createProgressionState,
  createTurboProgressionAttempt,
  currentAttemptSection,
  deterministicTurboSeed,
  discardActiveProgressionAttempt,
  isClearAccuracy,
  isJourneyNodeUnlocked,
  profileXpTotal,
  questionReferenceIdentityKey,
  recordQuestionAttempt,
  recordRedemptionAttempt,
  retryCurrentQuestion,
  settleProgressionAttempt,
  switchPlayerProfile,
  turboQuestionReference,
  upsertProfileAttempt,
} from "../lib/progression/index.ts";

const games = Array.from({ length: 8 }, (_, index) => ({
  slug: `game-${index + 1}`,
  title: `Game ${index + 1}`,
  contentVersion: "campaign-v1",
  generatorVersion: "generator-v1",
}));
const reviewGame = {
  slug: "spatial-review",
  title: "Spatial Review",
  journeyContentVersion: "review-v1",
  role: "review",
};
const gamesWithReview = [...games, reviewGame];

function campaignQuestion(gameSlug, level, questionIndex, version = "v1") {
  return {
    source: "campaign",
    gameSlug,
    level,
    questionIndex,
    contentVersion: version,
    fingerprint: `${gameSlug}-${level}-${questionIndex}-${version}`,
  };
}

function journeyQuestion(
  gameSlug,
  journeyLevel,
  level,
  collectionId,
  questionIndex,
) {
  return {
    source: "journey",
    gameSlug,
    journeyLevel,
    level,
    collectionId,
    questionIndex,
    contentVersion: "journey-v1",
  };
}

function campaignLevel(gameSlug, level, version = "v1") {
  return Array.from({ length: 12 }, (_, questionIndex) =>
    campaignQuestion(gameSlug, level, questionIndex, version),
  );
}

test("journey is seven generic boards with balanced review cadence and doubling XP", () => {
  const journey = buildJourneyPlan(gamesWithReview);
  assert.deepEqual(
    JOURNEY_LEVELS.map(journeyLevelLabel),
    [
      "Starter",
      "Junior I",
      "Junior II",
      "Expert I",
      "Expert II",
      "Wizard I",
      "Wizard II",
    ],
  );
  assert.deepEqual(
    JOURNEY_LEVELS.map(journeyLevelDifficulty),
    ["starter", "junior", "junior", "expert", "expert", "wizard", "wizard"],
  );
  assert.deepEqual(
    journey.boards.map(({ journeyLevel }) => journeyLevel),
    JOURNEY_LEVELS,
  );
  assert.deepEqual(
    journey.boards[0].nodes.map(({ kind }) => kind),
    [
      "normal",
      "normal",
      "turbo",
      "normal",
      "normal",
      "turbo",
      "normal",
      "normal",
      "turbo",
      "normal",
      "normal",
      "turbo",
      "culmination",
    ],
  );
  assert.deepEqual(
    journey.boards[1].nodes.map(({ kind }) => kind),
    [
      "normal",
      "normal",
      "turbo",
      "normal",
      "normal",
      "turbo",
      "review",
      "normal",
      "normal",
      "turbo",
      "normal",
      "normal",
      "turbo",
      "review",
      "culmination",
    ],
  );
  assert.deepEqual(
    journey.boards.map(({ availableXp }) => availableXp),
    [325, 750, 1500, 3000, 6000, 12000, 24000],
  );

  const turboCounts = new Map(games.map(({ slug }) => [slug, 0]));
  for (const node of journey.boards.flatMap(({ nodes }) => nodes)) {
    if (node.kind === "turbo") {
      turboCounts.set(node.gameSlug, turboCounts.get(node.gameSlug) + 1);
    }
  }
  assert.deepEqual([...turboCounts.values()], [4, 3, 4, 3, 4, 3, 4, 3]);

  const juniorCulmination = journey.boards[1].nodes.at(-1);
  assert.equal(juniorCulmination.kind, "culmination");
  assert.equal(juniorCulmination.sections.length, 9);
  assert.deepEqual(juniorCulmination.sections.at(-1), {
    selection: "fixed",
    gameSlug: reviewGame.slug,
    collectionId: "review:junior-1",
    questionOffset: 24,
    questionCount: 4,
  });

  const firstNormal = journey.boards[1].nodes[0];
  const sameNormalPosition = { ...firstNormal, position: 99 };
  assert.equal(firstNormal.id, sameNormalPosition.id);
});

test("journey construction caps core games, snapshots review content, and stays immutable", () => {
  assert.throws(
    () => buildJourneyPlan(games),
    /needs one discovered review provider/,
  );
  const partialJourney = buildJourneyPlan([
    ...games.slice(0, 7),
    reviewGame,
  ]);
  assert.equal(
    partialJourney.boards[0].nodes.filter(({ kind }) => kind === "normal")
      .length,
    8,
  );
  assert.equal(
    partialJourney.boards[0].nodes.at(-1).gameSlugs.length,
    7,
  );
  const expandedJourney = buildJourneyPlan([
    ...games,
    {
      slug: "game-9",
      title: "Game 9",
      contentVersion: "campaign-v1",
      generatorVersion: "generator-v1",
    },
    reviewGame,
  ]);
  assert.equal(expandedJourney.gameSnapshot.length, 9);
  assert.equal(expandedJourney.gameSnapshot.some(({ slug }) => slug === "game-9"), false);
  assert.equal(
    expandedJourney.gameSnapshot.some(({ slug }) => slug === reviewGame.slug),
    true,
  );
  assert.throws(
    () => buildJourneyPlan([...games.slice(0, 7), games[0]]),
    /Duplicate/,
  );

  const input = games.map((game) => ({ ...game }));
  const journey = buildJourneyPlan([...input, reviewGame]);
  input[0].slug = "changed-later";
  assert.equal(journey.gameSnapshot[0].slug, "game-1");
});

test("only a result strictly greater than 70 percent clears", () => {
  assert.equal(isClearAccuracy(7, 10), false);
  assert.equal(isClearAccuracy(8, 10), true);
  assert.equal(isClearAccuracy(8, 12), false);
  assert.equal(isClearAccuracy(9, 12), true);
  assert.equal(isClearAccuracy(16, 24), false);
  assert.equal(isClearAccuracy(17, 24), true);
  assert.equal(isClearAccuracy(0, 0), false);
});

test("profile boundaries reject shortened, mismatched, locked, and early-ended attempts", () => {
  const journey = buildJourneyPlan(gamesWithReview);
  const firstNode = journey.boards[0].nodes[0];
  const secondNode = journey.boards[0].nodes[1];
  const turboNode = journey.boards[0].nodes[2];
  const profile = createPlayerProfile({
    id: "integrity-profile",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: gamesWithReview,
    nowMs: 1,
  });

  let shortened = createProgressionAttempt({
    id: "shortened",
    node: firstNode,
    questions: [campaignQuestion(firstNode.gameSlug, firstNode.level, 0)],
    nowMs: 2,
  });
  shortened = recordQuestionAttempt(shortened, { correct: true, nowMs: 3 });
  shortened = advanceAttemptQuestion(shortened, 4);
  assert.throws(
    () => upsertProfileAttempt(profile, shortened),
    /ordinary stop needs 12 questions/,
  );

  const normal = createNormalProgressionAttempt({
    id: "wrong-level",
    node: firstNode,
    campaignQuestions: campaignLevel(firstNode.gameSlug, firstNode.level),
  });
  const wrongLevel = {
    ...normal,
    rounds: normal.rounds.map((round, index) =>
      index === 0
        ? {
            ...round,
            question: { ...round.question, level: "junior" },
          }
        : round,
    ),
  };
  assert.throws(
    () => upsertProfileAttempt(profile, wrongLevel),
    /ordinary question 1/,
  );
  const impossibleRetry = {
    ...normal,
    id: "impossible-retry",
    rounds: normal.rounds.map((round, index) =>
      index === 0
        ? {
            ...round,
            phase: "solved",
            attemptCount: 1,
            firstTryCorrect: false,
          }
        : round,
    ),
  };
  assert.throws(
    () => upsertProfileAttempt(profile, impossibleRetry),
    /invalid retry state/,
  );

  const locked = createNormalProgressionAttempt({
    id: "locked",
    node: secondNode,
    campaignQuestions: campaignLevel(secondNode.gameSlug, secondNode.level),
  });
  assert.throws(
    () => upsertProfileAttempt(profile, locked),
    /locked journey stop/,
  );

  let earlyTurbo = createTurboProgressionAttempt({
    id: "early-turbo",
    node: turboNode,
    generatorVersion: "generator-v1",
  });
  earlyTurbo = recordQuestionAttempt(earlyTurbo, { correct: true });
  earlyTurbo = advanceAttemptQuestion(earlyTurbo);
  const previousStopIds = journey.boards[0].nodes
    .slice(0, 2)
    .map(({ id }) => id);
  const turboReadyProfile = {
    ...profile,
    clearedStopIds: previousStopIds,
    awardedStopIds: previousStopIds,
  };
  assert.throws(
    () => upsertProfileAttempt(turboReadyProfile, earlyTurbo),
    /timer expired/,
  );

  const finished = finishNormalAttempt(
    createNormalProgressionAttempt({
      id: "not-persisted",
      node: firstNode,
      campaignQuestions: campaignLevel(firstNode.gameSlug, firstNode.level),
    }),
    12,
  );
  assert.throws(
    () => settleProgressionAttempt(profile, finished, journey),
    /persisted active attempt/,
  );
});

function finishNormalAttempt(attempt, correctCount) {
  let next = attempt;
  for (let index = 0; index < 12; index += 1) {
    const firstTryCorrect = index < correctCount;
    next = recordQuestionAttempt(next, {
      correct: firstTryCorrect,
      answerToken: `answer-${index}`,
      nowMs: 200 + index,
    });
    if (!firstTryCorrect) {
      next = retryCurrentQuestion(next, 300 + index);
      next = recordQuestionAttempt(next, {
        correct: true,
        answerToken: `fixed-${index}`,
        nowMs: 400 + index,
      });
    }
    next = advanceAttemptQuestion(next, 500 + index);
  }
  return next;
}

function redeemAll(attempt) {
  let next = beginAttemptRedemption(attempt, 700);
  while (next.phase === "redemption") {
    next = recordRedemptionAttempt(next, {
      correct: true,
      nowMs: 701,
    });
    next = advanceRedemptionQuestion(next, 702);
  }
  return next;
}

test("normal attempts resume round state, redeem misses, and gate XP idempotently", () => {
  const journey = buildJourneyPlan(gamesWithReview);
  const node = journey.boards[0].nodes[0];
  assert.equal(node.kind, "normal");
  let profile = createPlayerProfile({
    id: "p1",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: gamesWithReview,
    nowMs: 1,
  });

  let failed = createNormalProgressionAttempt({
    id: "attempt-fail",
    node,
    campaignQuestions: campaignLevel(node.gameSlug, node.level),
    nowMs: 100,
  });
  failed = finishNormalAttempt(failed, 8);
  assert.equal(failed.phase, "redemption-ready");
  failed = redeemAll(failed);
  assert.equal(failed.phase, "summary-ready");
  profile = upsertProfileAttempt(profile, failed);
  const failedResult = settleProgressionAttempt(profile, failed, journey, 800);
  profile = failedResult.profile;
  assert.equal(failedResult.settlement.passed, false);
  assert.equal(failedResult.settlement.accuracyPercent, 66.7);
  assert.equal(failedResult.settlement.xpAwarded, 0);
  assert.equal(profile.missedQuestions.length, 4);
  assert.deepEqual(profile.clearedStopIds, []);
  profile = closeAttemptSummary(profile, failed.id, 850);

  let passed = createNormalProgressionAttempt({
    id: "attempt-pass",
    node,
    campaignQuestions: campaignLevel(node.gameSlug, node.level),
    nowMs: 900,
  });
  passed = redeemAll(finishNormalAttempt(passed, 9));
  profile = upsertProfileAttempt(profile, passed);
  const passedResult = settleProgressionAttempt(
    profile,
    passed,
    journey,
    1_000,
  );
  profile = passedResult.profile;
  assert.equal(passedResult.settlement.passed, true);
  assert.equal(passedResult.settlement.xpAwarded, 25);
  assert.equal(profileXpTotal(profile, journey), 25);
  assert.equal(
    isJourneyNodeUnlocked(
      journey,
      profile.clearedStopIds,
      journey.boards[0].nodes[1].id,
    ),
    true,
  );
  profile = closeAttemptSummary(profile, passed.id, 1_050);

  const replay = createNormalProgressionAttempt({
    id: "attempt-replay",
    node,
    campaignQuestions: campaignLevel(node.gameSlug, node.level),
    nowMs: 1_100,
  });
  const finishedReplay = finishNormalAttempt(replay, 12);
  profile = upsertProfileAttempt(profile, finishedReplay);
  const replayResult = settleProgressionAttempt(
    profile,
    finishedReplay,
    journey,
    1_200,
  );
  assert.equal(replayResult.settlement.xpAwarded, 0);
  assert.equal(profileXpTotal(replayResult.profile, journey), 25);

  const duplicateSettlement = settleProgressionAttempt(
    replayResult.profile,
    replayResult.attempt,
    journey,
    1_300,
  );
  assert.strictEqual(duplicateSettlement.profile, replayResult.profile);
});

test("profile state supports several named local users and closes summaries", () => {
  const first = createPlayerProfile({
    id: "first",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: gamesWithReview,
    nowMs: 1,
  });
  const second = createPlayerProfile({
    id: "second",
    name: "Grace",
    avatarId: "otter",
    gameSnapshot: gamesWithReview,
    nowMs: 2,
  });
  let state = addPlayerProfile(createProgressionState(), first);
  state = addPlayerProfile(state, second);
  state = switchPlayerProfile(state, first.id);
  assert.equal(state.activeProfileId, "first");

  const journey = buildJourneyPlan(gamesWithReview);
  const node = journey.boards[0].nodes[0];
  const attempt = finishNormalAttempt(
    createNormalProgressionAttempt({
      id: "perfect",
      node,
      campaignQuestions: campaignLevel(node.gameSlug, node.level),
      nowMs: 3,
    }),
    12,
  );
  const activeFirst = upsertProfileAttempt(first, attempt);
  const settled = settleProgressionAttempt(activeFirst, attempt, journey, 4);
  const closed = closeAttemptSummary(settled.profile, attempt.id, 5);
  assert.equal(closed.attempts[attempt.id], undefined);
  assert.equal(closed.settledAttemptIds.includes(attempt.id), false);
  assert.equal(closed.activeAttemptId, null);
});

test("restarting an active stop preserves recorded misses without changing XP", () => {
  const journey = buildJourneyPlan(gamesWithReview);
  const node = journey.boards[0].nodes[0];
  let attempt = createNormalProgressionAttempt({
    id: "restart-me",
    node,
    campaignQuestions: campaignLevel(node.gameSlug, node.level),
  });
  attempt = addAttemptActiveTime(attempt, 3_456, 9, {
    countTowardFirstAnswer: true,
  });
  attempt = recordQuestionAttempt(attempt, {
    correct: false,
    answerToken: "option-2",
    nowMs: 10,
  });
  assert.equal(attempt.rounds[0].firstAnsweredAtMs, 10);
  let profile = createPlayerProfile({
    id: "restart-profile",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: gamesWithReview,
    nowMs: 1,
  });
  profile = upsertProfileAttempt(profile, attempt);
  assert.equal(profile.missedQuestions.length, 1);
  assert.deepEqual(profile.missedQuestions[0].observations, [
    {
      attemptId: attempt.id,
      stopId: node.id,
      journeyLevel: node.journeyLevel,
      elapsedMs: 3_456,
      missedAtMs: 10,
    },
  ]);

  const restarted = discardActiveProgressionAttempt(
    profile,
    attempt.id,
    20,
  );
  assert.equal(restarted.activeAttemptId, null);
  assert.equal(restarted.attempts[attempt.id], undefined);
  assert.equal(restarted.missedQuestions.length, 1);
  assert.equal(restarted.missedQuestions[0].missCount, 1);
  assert.deepEqual(restarted.missedQuestions[0].observations, [
    {
      attemptId: attempt.id,
      stopId: node.id,
      journeyLevel: node.journeyLevel,
      elapsedMs: 3_456,
      missedAtMs: 10,
    },
  ]);
  assert.deepEqual(restarted.clearedStopIds, []);
  assert.deepEqual(restarted.awardedStopIds, []);
  assert.deepEqual(restarted.xpAwards, []);
});

test("Turbo refs use deterministic seeds and enforce the avatar level cap", () => {
  const node = buildJourneyPlan(gamesWithReview).boards[3].nodes[2];
  assert.equal(node.kind, "turbo");
  const attempt = createTurboProgressionAttempt({
    id: "turbo-1",
    node,
    generatorVersion: "generator-v3",
    nowMs: 50,
  });
  assert.equal(
    attempt.rounds[0].question.seed,
    deterministicTurboSeed("turbo-1", node.id, 0),
  );
  assert.equal(attempt.rounds[0].question.level, "starter");
  assert.throws(
    () =>
      assertProgressionAttemptIntegrity(
        {
          ...attempt,
          rounds: attempt.rounds.map((round) => ({
            ...round,
            question: { ...round.question, level: "expert" },
          })),
        },
        node,
      ),
    /adaptive difficulty/,
  );
  const next = turboQuestionReference(attempt, "generator-v3", {
    level: "junior",
  });
  assert.equal(next.seed, deterministicTurboSeed("turbo-1", node.id, 1));
  assert.throws(
    () =>
      turboQuestionReference(attempt, "generator-v3", {
        level: "wizard",
      }),
    /cannot exceed/,
  );

  const pausedCountdown = addAttemptActiveTime(
    attempt,
    2_500,
    60,
    { countTowardTurbo: false },
  );
  assert.equal(pausedCountdown.activeTimeMs, 2_500);
  assert.equal(pausedCountdown.turboRemainingMs, attempt.turboRemainingMs);
  const activeCountdown = addAttemptActiveTime(pausedCountdown, 2_500, 70);
  assert.equal(
    activeCountdown.turboRemainingMs,
    attempt.turboRemainingMs - 2_500,
  );
});

test("culmination keeps ordered three-question game sections and replaces stale misses", () => {
  const journey = buildJourneyPlan(gamesWithReview);
  const node = journey.boards[1].nodes.at(-1);
  assert.equal(node.kind, "culmination");
  const fixedSection = node.sections.at(-1);
  assert.equal(fixedSection.selection, "fixed");
  const pools = games.map(({ slug }) => {
    const campaignQuestions = campaignLevel(slug, "junior", "current");
    return {
      gameSlug: slug,
      approachableQuestion: campaignQuestion(
        slug,
        "starter",
        0,
        "current",
      ),
      campaignQuestions,
      currentContentVersion: "current",
      currentGeneratorVersion: "generator-current",
    };
  });
  const crossLevelMiss = campaignQuestion(
    "game-1",
    "starter",
    7,
    "current",
  );
  const currentMiss = campaignQuestion("game-1", "junior", 9, "current");
  const staleMiss = campaignQuestion("game-1", "junior", 8, "old");
  const attempt = createCulminationProgressionAttempt({
    id: "culmination-1",
    node,
    missedQuestions: [
      {
        key: "cross-level",
        question: crossLevelMiss,
        missCount: 1,
        lastMissedAtMs: 25,
      },
      {
        key: "current",
        question: currentMiss,
        missCount: 1,
        lastMissedAtMs: 20,
      },
      {
        key: "stale",
        question: staleMiss,
        missCount: 10,
        lastMissedAtMs: 30,
      },
    ],
    questionPools: pools,
    fixedSections: [
      {
        gameSlug: fixedSection.gameSlug,
        questions: Array.from({ length: 4 }, (_, index) =>
          journeyQuestion(
            fixedSection.gameSlug,
            node.journeyLevel,
            node.level,
            fixedSection.collectionId,
            fixedSection.questionOffset + index,
          ),
        ),
      },
    ],
    nowMs: 40,
  });
  assert.equal(attempt.rounds.length, 28);
  assert.deepEqual(
    attempt.sections.map(({ gameSlug, questionCount }) => ({
      gameSlug,
      questionCount,
    })),
    [
      ...games.map(({ slug }) => ({ gameSlug: slug, questionCount: 3 })),
      { gameSlug: reviewGame.slug, questionCount: 4 },
    ],
  );
  assert.equal(attempt.rounds[0].question.questionIndex, 0);
  assert.equal(attempt.rounds[1].question.questionIndex, 7);
  assert.equal(attempt.rounds[1].question.level, "starter");
  assert.deepEqual(attempt.rounds[1].question, crossLevelMiss);
  assert.equal(attempt.rounds[2].question.questionIndex, 9);
  assert.equal(
    attempt.rounds
      .slice(0, 3)
      .some(({ question }) => question.contentVersion === "old"),
    false,
  );
  assert.equal(attempt.pendingSectionIndex, 0);
  assert.equal(addAttemptActiveTime(attempt, 5_000, 40).activeTimeMs, 0);
  assertProgressionAttemptIntegrity(attempt, node);
  assert.throws(
    () =>
      assertProgressionAttemptIntegrity(
        { ...attempt, pendingSectionIndex: 1 },
        node,
      ),
    /pending.*section/i,
  );
  assert.throws(
    () => recordQuestionAttempt(attempt, { correct: true }),
    /Begin the current culmination section/,
  );

  let progressed = beginCulminationSection(attempt, 41);
  assert.equal(progressed.pendingSectionIndex, null);
  for (let index = 0; index < 3; index += 1) {
    progressed = recordQuestionAttempt(progressed, { correct: true });
    progressed = advanceAttemptQuestion(progressed);
  }
  assert.equal(currentAttemptSection(progressed).gameSlug, "game-2");
  assert.equal(progressed.currentSectionIndex, 1);
  assert.equal(progressed.currentRoundIndex, 3);
  assert.equal(progressed.pendingSectionIndex, 1);
  assert.throws(
    () => recordQuestionAttempt(progressed, { correct: true }),
    /Begin the current culmination section/,
  );

  progressed = beginCulminationSection(progressed, 42);
  assert.equal(progressed.pendingSectionIndex, null);
  assert.equal(progressed.currentSectionIndex, 1);
  assert.throws(
    () => beginCulminationSection(progressed),
    /not waiting to begin/,
  );
});

test("culmination treats a materialized miss as the same approachable question", () => {
  const node = buildJourneyPlan(gamesWithReview).boards[0].nodes.at(-1);
  const duplicateMiss = campaignQuestion(
    "game-1",
    "starter",
    0,
    "current",
  );
  const approachable = {
    source: duplicateMiss.source,
    gameSlug: duplicateMiss.gameSlug,
    level: duplicateMiss.level,
    questionIndex: duplicateMiss.questionIndex,
    contentVersion: duplicateMiss.contentVersion,
  };
  const attempt = createCulminationProgressionAttempt({
    id: "culmination-materialized-duplicate",
    node,
    missedQuestions: [
      {
        key: "materialized-opener",
        question: duplicateMiss,
        missCount: 1,
        lastMissedAtMs: 10,
      },
    ],
    questionPools: games.map(({ slug }) => ({
      gameSlug: slug,
      approachableQuestion:
        slug === "game-1"
          ? approachable
          : campaignQuestion(slug, "starter", 0, "current"),
      campaignQuestions: campaignLevel(slug, "starter", "current"),
      currentContentVersion: "current",
      currentGeneratorVersion: "generator-current",
    })),
  });

  const firstSection = attempt.rounds.slice(0, 3).map(({ question }) => question);
  const identities = firstSection.map(questionReferenceIdentityKey);
  assert.equal(new Set(identities).size, 3);
  assert.equal(
    firstSection.filter(
      ({ source, level, questionIndex }) =>
        source === "campaign" && level === "starter" && questionIndex === 0,
    ).length,
    1,
  );
});

test("expanded culmination appends four unseen fixed review questions", () => {
  const journey = buildJourneyPlan(gamesWithReview);
  const node = journey.boards.find(
    ({ journeyLevel }) => journeyLevel === "junior-1",
  ).nodes.at(-1);
  assert.equal(node.kind, "culmination");
  const fixed = node.sections.find(
    ({ selection }) => selection === "fixed",
  );
  assert.ok(fixed);

  const attempt = createCulminationProgressionAttempt({
    id: "culmination-with-review",
    node,
    missedQuestions: [],
    questionPools: games.map(({ slug }) => ({
      gameSlug: slug,
      approachableQuestion: campaignQuestion(slug, "starter", 0),
      campaignQuestions: campaignLevel(slug, "junior"),
      currentContentVersion: "v1",
      currentJourneyContentVersion: "journey-v1",
      currentGeneratorVersion: "generator-v1",
    })),
    fixedSections: [
      {
        gameSlug: fixed.gameSlug,
        questions: Array.from({ length: 4 }, (_, index) =>
          journeyQuestion(
            fixed.gameSlug,
            node.journeyLevel,
            node.level,
            fixed.collectionId,
            fixed.questionOffset + index,
          ),
        ),
      },
    ],
  });

  assert.equal(attempt.rounds.length, 28);
  assert.equal(attempt.sections.length, 9);
  assert.equal(attempt.sections.at(-1).gameSlug, reviewGame.slug);
  assert.equal(attempt.sections.at(-1).questionCount, 4);
  assert.equal(attempt.rounds.at(-1).question.questionIndex, 27);
  assertProgressionAttemptIntegrity(attempt, node);
});
