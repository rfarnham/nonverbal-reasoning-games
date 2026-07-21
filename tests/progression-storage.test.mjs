import assert from "node:assert/strict";
import test from "node:test";

import {
  PROGRESSION_STORAGE_KEY,
  PROGRESSION_SCHEMA_VERSION,
  addPlayerProfile,
  advanceAttemptQuestion,
  beginCulminationSection,
  buildJourneyPlan,
  createCulminationProgressionAttempt,
  createNormalProgressionAttempt,
  createPlayerProfile,
  createProgressionState,
  createTurboProgressionAttempt,
  decodeProgressionState,
  decodeProgressionStateDiagnostic,
  loadProgressionState,
  loadProgressionStateDiagnostic,
  previousJourneyNodeIds,
  recordQuestionAttempt,
  saveProgressionState,
  settleProgressionAttempt,
  upsertProfileAttempt,
} from "../lib/progression/index.ts";

const games = Array.from({ length: 8 }, (_, index) => ({
  slug: `game-${index + 1}`,
  title: `Game ${index + 1}`,
  contentVersion: `campaign-${index + 1}`,
  generatorVersion: `generator-${index + 1}`,
}));

function questions(gameSlug, level) {
  return Array.from({ length: 12 }, (_, questionIndex) => ({
    source: "campaign",
    gameSlug,
    level,
    questionIndex,
    contentVersion: "v1",
    fingerprint: `${gameSlug}-${level}-${questionIndex}`,
  }));
}

function memoryStorage() {
  const entries = new Map();
  return {
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
    removeItem(key) {
      entries.delete(key);
    },
    entries,
  };
}

test("versioned storage round-trips exact in-progress answer and section state", () => {
  const journey = buildJourneyPlan(games);
  const node = journey.boards[0].nodes[0];
  let attempt = createNormalProgressionAttempt({
    id: "resume-me",
    node,
    campaignQuestions: questions(node.gameSlug, node.level),
    nowMs: 100,
  });
  attempt = recordQuestionAttempt(attempt, {
    correct: false,
    answerToken: "choice-2",
    nowMs: 110,
  });
  let profile = createPlayerProfile({
    id: "profile-1",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: games,
    nowMs: 1,
  });
  profile = {
    ...profile,
    attempts: { [attempt.id]: attempt },
    activeAttemptId: attempt.id,
  };
  const state = addPlayerProfile(createProgressionState(), profile);
  const storage = memoryStorage();

  assert.equal(saveProgressionState(state, storage), true);
  assert.equal(storage.entries.has(PROGRESSION_STORAGE_KEY), true);
  const loaded = loadProgressionState(storage);
  const resumed = loaded.profiles[0].attempts["resume-me"];
  assert.equal(loaded.schemaVersion, PROGRESSION_SCHEMA_VERSION);
  assert.equal(resumed.pendingSectionIndex, null);
  assert.equal(loaded.activeProfileId, "profile-1");
  assert.equal(resumed.currentRoundIndex, 0);
  assert.equal(resumed.currentSectionIndex, 0);
  assert.equal(resumed.rounds[0].phase, "feedback");
  assert.equal(resumed.rounds[0].attemptCount, 1);
  assert.equal(resumed.rounds[0].firstTryCorrect, false);
  assert.equal(resumed.rounds[0].lastAnswerToken, "choice-2");
});

test("schema-v1 culmination at a pristine section opener migrates to a pending intro", () => {
  const journey = buildJourneyPlan(games);
  const node = journey.boards[0].nodes.at(-1);
  let attempt = createCulminationProgressionAttempt({
    id: "legacy-culmination-intro",
    node,
    missedQuestions: [],
    questionPools: games.map(({ slug }) => ({
      gameSlug: slug,
      approachableQuestion: questions(slug, "starter")[0],
      campaignQuestions: questions(slug, node.level),
      currentContentVersion: "v1",
      currentGeneratorVersion: "generator-v1",
    })),
    nowMs: 2,
  });
  attempt = beginCulminationSection(attempt, 3);
  for (let index = 0; index < 3; index += 1) {
    attempt = recordQuestionAttempt(attempt, {
      correct: true,
      nowMs: 4 + index,
    });
    attempt = advanceAttemptQuestion(attempt, 10 + index);
  }
  assert.equal(attempt.currentSectionIndex, 1);
  assert.equal(attempt.currentRoundIndex, 3);
  assert.equal(attempt.pendingSectionIndex, 1);

  const legacyAttempt = { ...attempt, schemaVersion: 1 };
  delete legacyAttempt.pendingSectionIndex;
  const previousStopIds = previousJourneyNodeIds(journey, node.id);
  const profile = {
    ...createPlayerProfile({
      id: "legacy-culmination-profile",
      name: "Ada",
      avatarId: "hedgehog",
      gameSnapshot: games,
      nowMs: 1,
    }),
    clearedStopIds: previousStopIds,
    awardedStopIds: previousStopIds,
    attempts: { [legacyAttempt.id]: legacyAttempt },
    activeAttemptId: legacyAttempt.id,
  };
  const migrated = decodeProgressionStateDiagnostic(
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [profile],
    }),
  );

  assert.equal(migrated.status, "migrated");
  assert.equal(migrated.state.schemaVersion, PROGRESSION_SCHEMA_VERSION);
  const resumed = migrated.state.profiles[0].attempts[legacyAttempt.id];
  assert.equal(resumed.currentRoundIndex, 3);
  assert.equal(resumed.currentSectionIndex, 1);
  assert.equal(resumed.pendingSectionIndex, 1);
  assert.ok(
    resumed.rounds
      .slice(0, 3)
      .every(({ phase, firstTryCorrect }) =>
        phase === "solved" && firstTryCorrect === true
      ),
  );
  assert.equal(resumed.rounds[3].phase, "answering");
  assert.equal(resumed.rounds[3].attemptCount, 0);

  const storage = memoryStorage();
  assert.equal(saveProgressionState(migrated.state, storage), true);
  const reloaded = loadProgressionStateDiagnostic(storage);
  assert.equal(reloaded.status, "loaded");
  assert.equal(
    reloaded.state.profiles[0].attempts[legacyAttempt.id]
      .pendingSectionIndex,
    1,
  );
});

test("a canonical settled summary survives normalization unchanged", () => {
  const journey = buildJourneyPlan(games);
  const node = journey.boards[0].nodes[0];
  let attempt = createNormalProgressionAttempt({
    id: "settled-summary",
    node,
    campaignQuestions: questions(node.gameSlug, node.level),
    nowMs: 1,
  });
  for (let index = 0; index < 12; index += 1) {
    attempt = recordQuestionAttempt(attempt, { correct: true });
    attempt = advanceAttemptQuestion(attempt);
  }
  let profile = createPlayerProfile({
    id: "settled-profile",
    name: "Ada",
    avatarId: "hedgehog",
    gameSnapshot: games,
    nowMs: 1,
  });
  profile = upsertProfileAttempt(profile, attempt);
  profile = settleProgressionAttempt(profile, attempt, journey).profile;
  const state = addPlayerProfile(createProgressionState(), profile);
  const storage = memoryStorage();
  assert.equal(saveProgressionState(state, storage), true);
  const loaded = loadProgressionStateDiagnostic(storage);
  assert.equal(loaded.status, "loaded");
  assert.equal(
    loaded.state.profiles[0].attempts[attempt.id].phase,
    "summary",
  );
  assert.equal(
    loaded.state.profiles[0].attempts[attempt.id].settlement.xpAwarded,
    25,
  );

  const corrupted = JSON.parse(storage.entries.get(PROGRESSION_STORAGE_KEY));
  corrupted.profiles[0].attempts[attempt.id].settlement.accuracy = 0;
  const rejected = decodeProgressionStateDiagnostic(JSON.stringify(corrupted));
  assert.equal(rejected.status, "corrupt");
  assert.deepEqual(rejected.state.profiles[0].attempts, {});
  assert.equal(rejected.state.profiles[0].activeAttemptId, null);
});

test("malformed, unsupported, and unavailable storage fail closed", () => {
  assert.deepEqual(decodeProgressionState("{broken"), {
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    activeProfileId: null,
    profiles: [],
  });
  assert.deepEqual(
    decodeProgressionState(
      JSON.stringify({ schemaVersion: 999, profiles: [{ id: "future" }] }),
    ),
    {
      schemaVersion: PROGRESSION_SCHEMA_VERSION,
      activeProfileId: null,
      profiles: [],
    },
  );

  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadProgressionState(throwingStorage), {
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    activeProfileId: null,
    profiles: [],
  });
  assert.equal(
    loadProgressionStateDiagnostic(throwingStorage).status,
    "unavailable",
  );
  assert.equal(
    saveProgressionState(createProgressionState(), throwingStorage),
    false,
  );
  assert.equal(saveProgressionState(createProgressionState(), null), false);
});

test("diagnostic loads distinguish empty, migrated, corrupt, unsupported, and unavailable data", () => {
  const storage = memoryStorage();
  assert.equal(loadProgressionStateDiagnostic(storage).status, "empty");
  assert.equal(
    decodeProgressionStateDiagnostic(
      JSON.stringify({ version: 0, profiles: [] }),
    ).status,
    "migrated",
  );
  assert.equal(
    decodeProgressionStateDiagnostic("{broken").status,
    "corrupt",
  );
  assert.equal(
    decodeProgressionStateDiagnostic(
      JSON.stringify({ schemaVersion: 999, profiles: [] }),
    ).status,
    "unsupported",
  );
  assert.equal(loadProgressionStateDiagnostic(null).status, "unavailable");

  assert.equal(saveProgressionState(createProgressionState(), storage), true);
  assert.equal(loadProgressionStateDiagnostic(storage).status, "loaded");
});

test("version-zero profile maps migrate without trusting obsolete XP totals", () => {
  const migrated = decodeProgressionState(
    JSON.stringify({
      version: 0,
      activeProfileId: "legacy",
      profiles: {
        legacy: {
          id: "legacy",
          name: "Lin",
          avatarId: "fox",
          gameSlugs: games.map(({ slug }) => slug),
          totalXp: 999_999,
          clearedStopIds: [],
          awardedStopIds: [],
        },
      },
    }),
  );
  assert.equal(migrated.schemaVersion, PROGRESSION_SCHEMA_VERSION);
  assert.equal(migrated.activeProfileId, "legacy");
  assert.equal(migrated.profiles[0].gameSnapshot.length, 8);
  assert.deepEqual(migrated.profiles[0].awardedStopIds, []);
  assert.equal("totalXp" in migrated.profiles[0], false);
});

test("invalid profiles are dropped without discarding another local user", () => {
  const valid = createPlayerProfile({
    id: "valid",
    name: "Grace",
    avatarId: "otter",
    gameSnapshot: games,
    nowMs: 1,
  });
  const decoded = decodeProgressionState(
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId: "bad",
      profiles: [
        { id: "bad", name: "", avatarId: "fox", gameSnapshot: games },
        valid,
      ],
    }),
  );
  assert.equal(decoded.profiles.length, 1);
  assert.equal(decoded.profiles[0].id, "valid");
  assert.equal(decoded.activeProfileId, "valid");
});

test("semantic corruption drops an attempt without discarding its profile", () => {
  const journey = buildJourneyPlan(games);
  const normalNode = journey.boards[0].nodes[0];
  const normal = createNormalProgressionAttempt({
    id: "shortened-normal",
    node: normalNode,
    campaignQuestions: questions(normalNode.gameSlug, normalNode.level),
    nowMs: 2,
  });
  const shortenedNormal = {
    ...normal,
    rounds: normal.rounds.slice(0, 1),
  };
  const turboNode = journey.boards[0].nodes[2];
  const turbo = createTurboProgressionAttempt({
    id: "timerless-turbo",
    node: turboNode,
    generatorVersion: "v1",
    nowMs: 3,
  });
  const timerlessTurbo = { ...turbo };
  delete timerlessTurbo.turboRemainingMs;
  const previousStopIds = journey.boards[0].nodes
    .slice(0, 2)
    .map(({ id }) => id);
  const profile = {
    ...createPlayerProfile({
      id: "corrupt-attempts",
      name: "Ada",
      avatarId: "hedgehog",
      gameSnapshot: games,
      nowMs: 1,
    }),
    clearedStopIds: previousStopIds,
    awardedStopIds: previousStopIds,
    attempts: {
      [shortenedNormal.id]: shortenedNormal,
      [timerlessTurbo.id]: timerlessTurbo,
    },
    activeAttemptId: shortenedNormal.id,
  };

  const decoded = decodeProgressionState(
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [profile],
    }),
  );
  assert.equal(decoded.profiles.length, 1);
  assert.deepEqual(decoded.profiles[0].attempts, {});
  assert.equal(decoded.profiles[0].activeAttemptId, null);
});

test("completion migration keeps only a canonical cleared prefix and its awards", () => {
  const journey = buildJourneyPlan(games);
  const [first, second, third] = journey.boards[0].nodes;
  const profile = {
    ...createPlayerProfile({
      id: "prefix",
      name: "Lin",
      avatarId: "fox",
      gameSnapshot: games,
      nowMs: 1,
    }),
    clearedStopIds: [first.id, third.id],
    awardedStopIds: [first.id, second.id, third.id, "not-a-stop"],
  };
  const decoded = decodeProgressionState(
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [profile],
    }),
  );
  assert.deepEqual(decoded.profiles[0].clearedStopIds, [first.id]);
  assert.deepEqual(decoded.profiles[0].awardedStopIds, [first.id]);
});

test("snapshot migration preserves optional per-game content versions", () => {
  const profile = createPlayerProfile({
    id: "versions",
    name: "Grace",
    avatarId: "otter",
    gameSnapshot: games,
    nowMs: 1,
  });
  const decoded = decodeProgressionState(
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [profile],
    }),
  );
  assert.equal(
    decoded.profiles[0].gameSnapshot[0].contentVersion,
    "campaign-1",
  );
  assert.equal(
    decoded.profiles[0].gameSnapshot[0].generatorVersion,
    "generator-1",
  );
});
