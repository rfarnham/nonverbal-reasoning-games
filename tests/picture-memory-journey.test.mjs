import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_ROUNDS,
  roundFingerprint,
  validateRound,
} from "../app/games/picture-memory/game-engine.ts";
import { progressionAdapter } from "../app/games/picture-memory/progression-adapter.ts";
import { progressionMetadata } from "../app/games/picture-memory/progression-metadata.ts";
import {
  decodeSelectionFromAnswerToken,
  encodeSelectionAnswerToken,
} from "../app/games/picture-memory/selection-tokens.ts";
import { journeyReviews } from "../lib/journey-reviews.ts";
import {
  JOURNEY_LEVELS,
  PROGRESSION_LEVELS,
  addPlayerProfile,
  buildJourneyPlan,
  createFreshGeneratedQuestion,
  createNormalProgressionAttempt,
  createPlayerProfile,
  createProgressionState,
  journeyQuestionReferences,
  resolveProgressionQuestion,
  saveProgressionState,
  upsertProfileAttempt,
} from "../lib/progression/index.ts";
import {
  answerProgressionBrowserSession,
  loadProgressionBrowserSession,
  retryProgressionBrowserSession,
} from "../lib/progression/browser-session.ts";

test("Picture Memory exposes seven distinct canonical Journey banks and seeded Turbo questions", () => {
  assert.equal(CAMPAIGN_ROUNDS.length, 48);
  assert.equal(progressionAdapter.campaignRounds, CAMPAIGN_ROUNDS);
  const fingerprints = new Set();
  for (const level of JOURNEY_LEVELS) {
    const references = journeyQuestionReferences(progressionAdapter, level);
    assert.equal(references.length, 12);
    for (const reference of references) {
      const resolved = resolveProgressionQuestion(progressionAdapter, reference);
      assert.equal(validateRound(resolved.round), true);
      assert.equal(resolved.fingerprint, roundFingerprint(resolved.round));
      assert.equal(resolved.resolution, "current");
      assert.equal(fingerprints.has(resolved.fingerprint), false);
      fingerprints.add(resolved.fingerprint);
    }
  }
  assert.equal(fingerprints.size, 84);
  for (const level of PROGRESSION_LEVELS) {
    const generated = createFreshGeneratedQuestion(progressionAdapter, {
      level,
      seedBase: `picture-memory:journey:${level}`,
    });
    assert.equal(generated.ref.source, "generated");
    assert.equal(validateRound(generated.round), true);
    assert.equal(
      resolveProgressionQuestion(progressionAdapter, generated.ref).fingerprint,
      generated.fingerprint,
    );
  }
});

test("Journey persists a complete Picture Memory selection through feedback and retries", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const gameSnapshot = [
    {
      slug: "picture-memory",
      title: "Picture Memory",
      contentVersion: progressionAdapter.contentVersion,
      generatorVersion: progressionAdapter.generatorVersion,
      journeyContentVersion: progressionAdapter.journeyContentVersion,
    },
    ...journeyReviews.map(({ slug, title, journeyContentVersion }) => ({
      slug, title, role: "review", journeyContentVersion,
    })),
  ];
  const journey = buildJourneyPlan(gameSnapshot);
  const node = journey.boards.find(({ journeyLevel }) => journeyLevel === "junior-1")
    .nodes.find(({ kind }) => kind === "normal");
  const attempt = createNormalProgressionAttempt({
    id: "picture-memory-selection-test",
    node,
    journeyQuestions: journeyQuestionReferences(progressionAdapter, "junior-1"),
    nowMs: 1,
  });
  const profile = upsertProfileAttempt(createPlayerProfile({
    id: "picture-memory-player", name: "testUser123", avatarId: "hedgehog", gameSnapshot, nowMs: 1,
  }), attempt);
  assert.equal(saveProgressionState(addPlayerProfile(createProgressionState(), profile), storage), true);
  const sessionOptions = { attemptId: attempt.id, storage };
  let session = loadProgressionBrowserSession(progressionAdapter, sessionOptions);
  assert.equal(session.mode, "controlled");
  const round = session.current.round;
  const recalled = round.options.filter((picture) => round.study.includes(picture));
  const lure = round.options.find((picture) => !round.study.includes(picture));
  const selected = [recalled[0], lure];
  assert.equal(selected.length, round.study.length, "The complete group reaches the automatic submission threshold.");
  const token = encodeSelectionAnswerToken(selected, round.options);
  answerProgressionBrowserSession(progressionAdapter, attempt.id, { correct: false, answerToken: token, nowMs: 2 }, { storage });

  session = loadProgressionBrowserSession(progressionAdapter, sessionOptions);
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.rounds[0].phase, "feedback");
  assert.equal(session.attempt.rounds[0].lastAnswerToken, token);
  assert.deepEqual(
    decodeSelectionFromAnswerToken(session.attempt.rounds[0].lastAnswerToken, round.options),
    round.options.filter((picture) => selected.includes(picture)),
  );
  retryProgressionBrowserSession(progressionAdapter, attempt.id, 3, { storage });
  answerProgressionBrowserSession(progressionAdapter, attempt.id, {
    correct: true,
    answerToken: encodeSelectionAnswerToken(recalled, round.options),
    nowMs: 4,
  }, { storage });
  session = loadProgressionBrowserSession(progressionAdapter, sessionOptions);
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.rounds[0].phase, "solved");
  assert.equal(session.attempt.rounds[0].firstTryCorrect, false);
  assert.equal(session.attempt.rounds[0].attemptCount, 2);
});

test("Picture Memory publishes v2 content and round-trips new question references", () => {
  assert.deepEqual(progressionMetadata, {
    contentVersion: "2", generatorVersion: "2", journeyContentVersion: "2",
  });
  for (const level of JOURNEY_LEVELS) {
    for (const reference of journeyQuestionReferences(progressionAdapter, level)) {
      assert.equal(reference.contentVersion, "2");
      const resolved = resolveProgressionQuestion(progressionAdapter, reference);
      assert.equal(resolved.resolution, "current");
      assert.deepEqual(resolved.ref, reference);
      assert.equal(validateRound(resolved.round), true);
    }
  }
  for (const level of PROGRESSION_LEVELS) {
    const generated = createFreshGeneratedQuestion(progressionAdapter, {
      level, seedBase: `picture-memory:v2:${level}`,
    });
    assert.equal(generated.ref.generatorVersion, "2");
    assert.equal(resolveProgressionQuestion(progressionAdapter, generated.ref).fingerprint, generated.fingerprint);
  }
});
