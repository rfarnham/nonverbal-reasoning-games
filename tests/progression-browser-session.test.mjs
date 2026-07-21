import assert from "node:assert/strict";
import test from "node:test";

import {
  addActiveTimeBrowserSession,
  advanceProgressionBrowserSession,
  answerProgressionBrowserSession,
  beginProgressionBrowserSection,
  beginRedemptionBrowserSession,
  loadProgressionBrowserSession,
  progressionAttemptIdFromSearch,
  retryProgressionBrowserSession,
} from "../lib/progression/browser-session.ts";
import {
  campaignQuestionReferences,
  defineProgressionGameAdapter,
} from "../lib/progression/game-adapter.ts";
import {
  PROGRESSION_STORAGE_KEY,
  addPlayerProfile,
  buildJourneyPlan,
  createCulminationProgressionAttempt,
  createNormalProgressionAttempt,
  createPlayerProfile,
  createProgressionState,
  createTurboProgressionAttempt,
  loadProgressionState,
  previousJourneyNodeIds,
  saveProgressionState,
  upsertProfileAttempt,
} from "../lib/progression/index.ts";
import { progressionOptionIndexFromAnswerToken } from "../components/progression/useProgressionGameSession.ts";

const difficulties = ["Starter", "Junior", "Expert", "Wizard"];
const campaignRounds = difficulties.flatMap((difficulty) =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `${difficulty}-${index}`,
    difficulty,
    correctIndex: index % 4,
  })),
);

function adapter(gameSlug = "game-1") {
  return defineProgressionGameAdapter({
    gameSlug,
    contentVersion: "1",
    generatorVersion: "1",
    campaignRounds,
    difficultyByLevel: {
      starter: "Starter",
      junior: "Junior",
      expert: "Expert",
      wizard: "Wizard",
    },
    difficultyOf: (round) => round.difficulty,
    fingerprint: (round) => round.id,
    generate: (difficulty, random) => ({
      id: `generated-${difficulty}-${Math.floor(random() * 1_000_000_000)}`,
      difficulty,
      correctIndex: 0,
    }),
  });
}

function versionedAdapter({
  gameSlug = "game-1",
  contentVersion = "1",
  generatorVersion = "1",
  campaignVersion = contentVersion,
} = {}) {
  const rounds = difficulties.flatMap((difficulty) =>
    Array.from({ length: 12 }, (_, index) => ({
      id: `${campaignVersion}:${difficulty}-${index}`,
      difficulty,
      correctIndex: index % 4,
    })),
  );
  return defineProgressionGameAdapter({
    gameSlug,
    contentVersion,
    generatorVersion,
    campaignRounds: rounds,
    difficultyByLevel: {
      starter: "Starter",
      junior: "Junior",
      expert: "Expert",
      wizard: "Wizard",
    },
    difficultyOf: (round) => round.difficulty,
    fingerprint: (round) => round.id,
    generate: (difficulty, random) => ({
      id: `${generatorVersion}:generated-${difficulty}-${Math.floor(
        random() * 1_000_000_000,
      )}`,
      difficulty,
      correctIndex: 0,
    }),
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const games = Array.from({ length: 8 }, (_, index) => ({
  slug: `game-${index + 1}`,
  title: `Game ${index + 1}`,
  contentVersion: "1",
}));

test("progression answer tokens restore both legacy and explicit option indexes", () => {
  assert.equal(progressionOptionIndexFromAnswerToken("2"), 2);
  assert.equal(progressionOptionIndexFromAnswerToken("option-3"), 3);
  assert.equal(progressionOptionIndexFromAnswerToken(" option-0 "), 0);
  assert.equal(progressionOptionIndexFromAnswerToken("option--1"), null);
  assert.equal(progressionOptionIndexFromAnswerToken("answer-2"), null);
  assert.equal(progressionOptionIndexFromAnswerToken(null), null);
});

function storeAttempt(storage, attempt) {
  const journey = buildJourneyPlan(games);
  const previousStopIds = previousJourneyNodeIds(journey, attempt.stopId);
  const profile = {
    ...createPlayerProfile({
    id: "profile",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: games,
    nowMs: 1,
    }),
    clearedStopIds: previousStopIds,
    awardedStopIds: previousStopIds,
  };
  const withAttempt = upsertProfileAttempt(profile, attempt);
  const state = addPlayerProfile(createProgressionState(), withAttempt);
  assert.equal(saveProgressionState(state, storage), true);
}

test("browser sessions leave corrupt and unsupported storage untouched", () => {
  const gameAdapter = adapter();
  const cases = [
    ["corrupt", "{broken"],
    [
      "unsupported",
      JSON.stringify({ schemaVersion: 999, activeProfileId: null, profiles: [] }),
    ],
  ];

  for (const [label, serialized] of cases) {
    const storage = memoryStorage();
    storage.setItem(PROGRESSION_STORAGE_KEY, serialized);
    const loaded = loadProgressionBrowserSession(gameAdapter, {
      attemptId: `${label}-attempt`,
      storage,
    });
    assert.equal(loaded.mode, "recovery", label);
    assert.equal(loaded.navigationTarget.pathname, "/journey/", label);
    assert.equal(storage.getItem(PROGRESSION_STORAGE_KEY), serialized, label);

    const mutation = answerProgressionBrowserSession(
      gameAdapter,
      `${label}-attempt`,
      { correct: true },
      { storage },
    );
    assert.equal(mutation.mode, "recovery", label);
    assert.equal(storage.getItem(PROGRESSION_STORAGE_KEY), serialized, label);
  }
});

test("browser sessions recover without writes when storage is unavailable", () => {
  let writeCount = 0;
  const unavailableStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      writeCount += 1;
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  const loaded = loadProgressionBrowserSession(adapter(), {
    attemptId: "blocked-attempt",
    storage: unavailableStorage,
  });
  assert.equal(loaded.mode, "recovery");
  assert.equal(writeCount, 0);

  const mutation = answerProgressionBrowserSession(
    adapter(),
    "blocked-attempt",
    { correct: true },
    { storage: unavailableStorage },
  );
  assert.equal(mutation.mode, "recovery");
  assert.equal(writeCount, 0);
});

test("browser session preserves first attempts through retry and redemption", () => {
  const gameAdapter = adapter();
  const node = buildJourneyPlan(games).boards[0].nodes[0];
  const attempt = createNormalProgressionAttempt({
    id: "normal-attempt",
    node,
    campaignQuestions: campaignQuestionReferences(gameAdapter, "starter"),
    nowMs: 2,
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(gameAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.round.id, "Starter-0");

  session = answerProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    { correct: false, answerToken: "2", nowMs: 3 },
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.rounds[0].firstTryCorrect, false);
  assert.equal(session.attempt.rounds[0].phase, "feedback");

  session = retryProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    4,
    { storage },
  );
  session = answerProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    { correct: true, answerToken: "0", nowMs: 5 },
    { storage },
  );
  assert.equal(session.attempt.rounds[0].firstTryCorrect, false);
  session = advanceProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    6,
    { storage },
  );

  for (let index = 1; index < 12; index += 1) {
    session = answerProgressionBrowserSession(
      gameAdapter,
      attempt.id,
      { correct: true, answerToken: "0", nowMs: 10 + index },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      gameAdapter,
      attempt.id,
      30 + index,
      { storage },
    );
  }

  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.phase, "redemption-ready");
  assert.equal(session.current, null);

  session = beginRedemptionBrowserSession(
    gameAdapter,
    attempt.id,
    50,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.isRedemption, true);
  session = answerProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    { correct: true, answerToken: "0", nowMs: 51 },
    { storage },
  );
  session = advanceProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    52,
    { storage },
  );
  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/journey/summary/");

  const saved = loadProgressionState(storage);
  const savedAttempt = saved.profiles[0].attempts[attempt.id];
  assert.equal(savedAttempt.phase, "summary-ready");
  assert.equal(savedAttempt.rounds[0].firstTryCorrect, false);
});

test("Turbo charges feedback and solved transitions but not explanation pauses", () => {
  const gameAdapter = adapter();
  const node = buildJourneyPlan(games).boards[0].nodes[2];
  const attempt = createTurboProgressionAttempt({
    id: "turbo-attempt",
    node,
    generatorVersion: "1",
    nowMs: 2,
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(gameAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  const startingRemaining = session.attempt.turboRemainingMs;

  session = addActiveTimeBrowserSession(
    gameAdapter,
    attempt.id,
    2_000,
    10,
    { storage },
    { countTowardTurbo: false },
  );
  assert.equal(session.attempt.activeTimeMs, 2_000);
  assert.equal(session.attempt.turboRemainingMs, startingRemaining);

  session = answerProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    { correct: false, answerToken: "1", nowMs: 11 },
    { storage },
  );
  assert.equal(session.attempt.rounds[0].phase, "feedback");

  session = addActiveTimeBrowserSession(
    gameAdapter,
    attempt.id,
    2_200,
    20,
    { storage },
    { countTowardTurbo: true },
  );
  assert.equal(
    session.attempt.turboRemainingMs,
    startingRemaining - 2_200,
    "ordinary wrong-answer feedback remains on the clock",
  );

  session = retryProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    21,
    { storage },
  );

  session = answerProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    { correct: true, nowMs: 22 },
    { storage },
  );
  assert.equal(session.attempt.rounds[0].phase, "solved");

  session = addActiveTimeBrowserSession(
    gameAdapter,
    attempt.id,
    session.attempt.turboRemainingMs,
    23,
    { storage },
    { countTowardTurbo: true },
  );
  assert.equal(
    session.attempt.turboRemainingMs,
    0,
    "the solved reveal and Next transition remain on the clock",
  );

  session = advanceProgressionBrowserSession(
    gameAdapter,
    attempt.id,
    24,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.phase, "redemption-ready");
  assert.equal(
    loadProgressionState(storage).profiles[0].attempts[attempt.id].rounds.length,
    1,
    "expiry must not append another Turbo question",
  );
});

test("Turbo starts at Starter, adapts upward, and never exceeds its board cap", () => {
  const gameAdapter = adapter();
  const node = buildJourneyPlan(games).boards[2].nodes[2];
  const attempt = createTurboProgressionAttempt({
    id: "turbo-cap",
    node,
    generatorVersion: "1",
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(gameAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.ref.level, "starter");

  for (let round = 0; round < 9; round += 1) {
    session = answerProgressionBrowserSession(
      gameAdapter,
      attempt.id,
      { correct: true },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      gameAdapter,
      attempt.id,
      undefined,
      { storage },
    );
    if (round === 2) {
      assert.equal(session.current.ref.level, "junior");
    } else if (round === 5) {
      assert.equal(session.current.ref.level, "expert");
    }
  }

  assert.equal(session.mode, "controlled");
  assert.equal(session.current.ref.level, "expert");
  assert.ok(
    session.attempt.rounds.every(
      ({ question }) => question.level !== "wizard",
    ),
  );
});

test("Turbo finishes cleanly when every unique generated and Campaign question is exhausted", () => {
  const gameAdapter = defineProgressionGameAdapter({
    gameSlug: "game-1",
    contentVersion: "1",
    generatorVersion: "1",
    campaignRounds,
    difficultyByLevel: {
      starter: "Starter",
      junior: "Junior",
      expert: "Expert",
      wizard: "Wizard",
    },
    difficultyOf: (round) => round.difficulty,
    fingerprint: (round) => round.id,
    generate: (difficulty) => ({
      id: `one-generated-${difficulty}`,
      difficulty,
      correctIndex: 0,
    }),
  });
  const node = buildJourneyPlan(games).boards[0].nodes[2];
  const attempt = createTurboProgressionAttempt({
    id: "turbo-exhaustion",
    node,
    generatorVersion: "1",
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(gameAdapter, {
    attemptId: attempt.id,
    storage,
  });
  for (let round = 0; round < 13; round += 1) {
    session = answerProgressionBrowserSession(
      gameAdapter,
      attempt.id,
      { correct: true },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      gameAdapter,
      attempt.id,
      undefined,
      { storage },
    );
  }

  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/journey/summary/");
  const saved =
    loadProgressionState(storage).profiles[0].attempts[attempt.id];
  assert.equal(saved.phase, "summary-ready");
  assert.equal(saved.turboRemainingMs, 0);
  assert.equal(saved.rounds.length, 13);
});

test("a controlled URL redirects to the canonical game for the current section", () => {
  const firstAdapter = adapter("game-1");
  const node = buildJourneyPlan(games).boards[0].nodes[0];
  const attempt = createNormalProgressionAttempt({
    id: "wrong-route",
    node,
    campaignQuestions: campaignQuestionReferences(firstAdapter, "starter"),
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  const session = loadProgressionBrowserSession(adapter("game-2"), {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/games/game-1/");
});

test("the opaque progression query is parsed without treating other URL state as authority", () => {
  assert.equal(
    progressionAttemptIdFromSearch(
      "?mode=campaign&progression=attempt%3Aone&level=wizard",
    ),
    "attempt:one",
  );
  assert.equal(progressionAttemptIdFromSearch("?progression=%20%20"), null);
  assert.equal(
    loadProgressionBrowserSession(adapter(), {
      search: "?mode=campaign",
      storage: memoryStorage(),
    }).mode,
    "standalone",
  );
});

test("refresh migrates current Campaign content and persists the canonical ref", () => {
  const originalAdapter = versionedAdapter();
  const updatedAdapter = versionedAdapter({
    contentVersion: "2",
    campaignVersion: "2",
  });
  const node = buildJourneyPlan(games).boards[0].nodes[0];
  const attempt = createNormalProgressionAttempt({
    id: "campaign-migration",
    node,
    campaignQuestions: campaignQuestionReferences(
      originalAdapter,
      "starter",
    ),
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(updatedAdapter, {
    search: `?progression=${attempt.id}`,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.resolution, "campaign-updated");
  assert.equal(session.current.round.id, "2:Starter-0");
  assert.equal(session.attempt.rounds[0].question.contentVersion, "2");
  assert.equal(session.attempt.rounds[0].question.fingerprint, "2:Starter-0");

  session = loadProgressionBrowserSession(updatedAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.resolution, "current");
});

test("refresh replaces stale generated content with a current Campaign fallback", () => {
  const updatedAdapter = versionedAdapter({
    generatorVersion: "2",
    campaignVersion: "2",
    contentVersion: "2",
  });
  const node = buildJourneyPlan(games).boards[0].nodes[2];
  const attempt = createTurboProgressionAttempt({
    id: "generated-migration",
    node,
    generatorVersion: "1",
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(updatedAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.resolution, "generated-fallback");
  assert.equal(session.current.ref.source, "campaign");
  assert.equal(session.attempt.rounds[0].question.source, "campaign");
  assert.match(session.current.round.id, /^2:Starter-/);

  session = loadProgressionBrowserSession(updatedAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.resolution, "current");
  assert.equal(session.current.ref.source, "campaign");
});

test("culmination advances and redemption route by the current question slug", () => {
  const firstAdapter = adapter("game-1");
  const node = buildJourneyPlan(games).boards[0].nodes.at(-1);
  const attempt = createCulminationProgressionAttempt({
    id: "culmination-routing",
    node,
    missedQuestions: [],
    questionPools: games.map(({ slug }) => {
      const gameAdapter = adapter(slug);
      const campaignQuestions = campaignQuestionReferences(
        gameAdapter,
        "starter",
      );
      return {
        gameSlug: slug,
        approachableQuestion: campaignQuestions[0],
        campaignQuestions,
        currentContentVersion: "1",
        currentGeneratorVersion: "1",
      };
    }),
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(firstAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.pendingSectionIndex, 0);
  session = addActiveTimeBrowserSession(
    firstAdapter,
    attempt.id,
    5_000,
    1,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.activeTimeMs, 0);
  assert.equal(session.attempt.pendingSectionIndex, 0);
  const beforeBegin = storage.getItem(PROGRESSION_STORAGE_KEY);
  session = loadProgressionBrowserSession(firstAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.pendingSectionIndex, 0);
  assert.equal(storage.getItem(PROGRESSION_STORAGE_KEY), beforeBegin);

  session = beginProgressionBrowserSection(
    firstAdapter,
    attempt.id,
    2,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.pendingSectionIndex, null);
  assert.equal(
    loadProgressionState(storage).profiles[0].attempts[attempt.id]
      .pendingSectionIndex,
    null,
  );

  session = answerProgressionBrowserSession(
    firstAdapter,
    attempt.id,
    { correct: false },
    { storage },
  );
  session = retryProgressionBrowserSession(
    firstAdapter,
    attempt.id,
    undefined,
    { storage },
  );
  session = answerProgressionBrowserSession(
    firstAdapter,
    attempt.id,
    { correct: true },
    { storage },
  );
  session = advanceProgressionBrowserSession(
    firstAdapter,
    attempt.id,
    undefined,
    { storage },
  );
  for (let index = 1; index < 3; index += 1) {
    session = answerProgressionBrowserSession(
      firstAdapter,
      attempt.id,
      { correct: true },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      firstAdapter,
      attempt.id,
      undefined,
      { storage },
    );
  }
  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/games/game-2/");
  assert.equal(
    session.navigationTarget.query.progression,
    "culmination-routing",
  );
  let saved = loadProgressionState(storage).profiles[0].attempts[attempt.id];
  assert.equal(saved.currentRoundIndex, 3);
  assert.equal(saved.currentSectionIndex, 1);
  assert.equal(saved.pendingSectionIndex, 1);

  session = loadProgressionBrowserSession(adapter("game-2"), {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.ref.gameSlug, "game-2");
  assert.equal(session.attempt.pendingSectionIndex, 1);

  for (let index = 3; index < 24; index += 1) {
    const currentAdapter = adapter(games[Math.floor(index / 3)].slug);
    if (index % 3 === 0) {
      session = beginProgressionBrowserSection(
        currentAdapter,
        attempt.id,
        100 + index,
        { storage },
      );
      assert.equal(session.mode, "controlled");
      assert.equal(session.attempt.pendingSectionIndex, null);
    }
    session = answerProgressionBrowserSession(
      currentAdapter,
      attempt.id,
      { correct: true },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      currentAdapter,
      attempt.id,
      undefined,
      { storage },
    );
  }
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.phase, "redemption-ready");
  saved = loadProgressionState(storage).profiles[0].attempts[attempt.id];
  assert.equal(saved.pendingSectionIndex, null);
  const lastAdapter = adapter("game-8");
  session = beginRedemptionBrowserSession(
    lastAdapter,
    attempt.id,
    undefined,
    { storage },
  );
  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/games/game-1/");

  session = loadProgressionBrowserSession(firstAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.isRedemption, true);
  assert.equal(session.current.ref.gameSlug, "game-1");
});

test("legacy culmination duplicate references repair before a cross-game handoff", () => {
  const node = buildJourneyPlan(games).boards[0].nodes.at(-1);
  const attempt = createCulminationProgressionAttempt({
    id: "culmination-legacy-duplicate",
    node,
    missedQuestions: [],
    questionPools: games.map(({ slug }) => {
      const gameAdapter = adapter(slug);
      const campaignQuestions = campaignQuestionReferences(
        gameAdapter,
        "starter",
      );
      return {
        gameSlug: slug,
        approachableQuestion: campaignQuestions[0],
        campaignQuestions,
        currentContentVersion: "1",
        currentGeneratorVersion: "1",
      };
    }),
  });
  const gameTwoOpener = attempt.rounds[3].question;
  assert.equal(gameTwoOpener.source, "campaign");
  const unmaterializedOpener = {
    source: gameTwoOpener.source,
    gameSlug: gameTwoOpener.gameSlug,
    level: gameTwoOpener.level,
    questionIndex: gameTwoOpener.questionIndex,
    contentVersion: gameTwoOpener.contentVersion,
  };
  const legacyAttempt = {
    ...attempt,
    rounds: attempt.rounds.map((round, index) =>
      index === 3
        ? { ...round, question: unmaterializedOpener }
        : index === 4
          ? { ...round, question: gameTwoOpener }
          : round,
    ),
  };
  const storage = memoryStorage();
  storeAttempt(storage, legacyAttempt);

  const firstAdapter = adapter("game-1");
  let session = loadProgressionBrowserSession(firstAdapter, {
    attemptId: legacyAttempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.pendingSectionIndex, 0);
  session = beginProgressionBrowserSection(
    firstAdapter,
    legacyAttempt.id,
    undefined,
    { storage },
  );
  for (let index = 0; index < 3; index += 1) {
    session = answerProgressionBrowserSession(
      firstAdapter,
      legacyAttempt.id,
      { correct: true },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      firstAdapter,
      legacyAttempt.id,
      undefined,
      { storage },
    );
  }
  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/games/game-2/");

  const secondAdapter = adapter("game-2");
  session = loadProgressionBrowserSession(secondAdapter, {
    attemptId: legacyAttempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.round.id, "Starter-0");
  assert.equal(session.attempt.currentRoundIndex, 3);
  assert.equal(session.attempt.currentSectionIndex, 1);
  assert.equal(session.attempt.pendingSectionIndex, 1);
  assert.ok(
    session.attempt.rounds
      .slice(0, 3)
      .every(
        ({ phase, firstTryCorrect }) =>
          phase === "solved" && firstTryCorrect === true,
      ),
  );
  assert.equal(session.attempt.rounds[3].question.fingerprint, "Starter-0");
  const repairedQuestion = session.attempt.rounds[4].question;
  assert.equal(repairedQuestion.source, "campaign");
  assert.notEqual(repairedQuestion.questionIndex, 0);
  assert.equal(
    repairedQuestion.fingerprint,
    `Starter-${repairedQuestion.questionIndex}`,
  );

  session = loadProgressionBrowserSession(secondAdapter, {
    attemptId: legacyAttempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.resolution, "current");
  assert.equal(session.current.round.id, "Starter-0");

  session = beginProgressionBrowserSection(
    secondAdapter,
    legacyAttempt.id,
    undefined,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.pendingSectionIndex, null);

  session = answerProgressionBrowserSession(
    secondAdapter,
    legacyAttempt.id,
    { correct: true },
    { storage },
  );
  session = advanceProgressionBrowserSession(
    secondAdapter,
    legacyAttempt.id,
    undefined,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.round.id, repairedQuestion.fingerprint);
});

test("redemption practice time never consumes a Turbo countdown", () => {
  const gameAdapter = adapter();
  const node = buildJourneyPlan(games).boards[0].nodes[2];
  const initial = createTurboProgressionAttempt({
    id: "turbo-redemption-clock",
    node,
    generatorVersion: "1",
  });
  const question = initial.rounds[0].question;
  const attempt = {
    ...initial,
    phase: "redemption",
    currentRoundIndex: null,
    currentSectionIndex: null,
    rounds: [
      {
        question,
        phase: "solved",
        attemptCount: 2,
        firstTryCorrect: false,
      },
    ],
    redemption: {
      queue: [question],
      currentIndex: 0,
      phase: "answering",
      attemptCount: 0,
    },
    turboRemainingMs: 0,
  };
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  const session = addActiveTimeBrowserSession(
    gameAdapter,
    attempt.id,
    5_000,
    undefined,
    { storage },
    { countTowardTurbo: true },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.activeTimeMs, 5_000);
  assert.equal(session.attempt.turboRemainingMs, 0);
});
