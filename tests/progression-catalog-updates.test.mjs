import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNEY_LEVELS,
  PROGRESSION_STORAGE_KEY,
  addAttemptActiveTime,
  addPlayerProfile,
  advanceAttemptQuestion,
  advanceRedemptionQuestion,
  beginAttemptRedemption,
  beginCulminationSection,
  buildJourneyPlan,
  buildLegacyJourneyPlan,
  buildPlayerJourney,
  canPlayerAccessJourneyNode,
  closeAttemptSummary,
  createCulminationProgressionAttempt,
  createNormalProgressionAttempt,
  createPlayerProfile,
  createProgressionState,
  decodeProgressionStateDiagnostic,
  loadProgressionStateDiagnostic,
  nextIncompleteJourneyNode,
  previousJourneyNodeIds,
  profileXpTotal,
  recordQuestionAttempt,
  recordRedemptionAttempt,
  retryCurrentQuestion,
  retryRedemptionQuestion,
  saveProgressionState,
  settleProgressionAttempt,
  switchPlayerProfile,
  upgradePlayerProfileJourneyPlan,
  upsertProfileAttempt,
} from "../lib/progression/index.ts";

const games = Array.from({ length: 8 }, (_, index) => ({
  slug: `game-${index + 1}`,
  title: `Game ${index + 1}`,
  contentVersion: "campaign-v1",
  generatorVersion: "generator-v1",
  journeyContentVersion: "journey-v1",
}));
const review = {
  slug: "spatial-review",
  title: "Spatial Review",
  role: "review",
  journeyContentVersion: "review-v1",
};
const extraPiece = {
  slug: "extra-piece",
  title: "Extra Piece",
  contentVersion: "extra-campaign-v1",
  generatorVersion: "extra-generator-v1",
  journeyContentVersion: "extra-journey-v1",
};
const originalCatalog = [...games, review];
const expandedCatalog = [...games, extraPiece, review];

function createProfile(id = "julia", snapshot = originalCatalog) {
  return createPlayerProfile({
    id,
    name: id === "julia" ? "Julia" : id,
    avatarId: "hedgehog",
    gameSnapshot: snapshot,
    nowMs: 1,
  });
}

function withClearedNodes(profile, nodes) {
  return {
    ...profile,
    clearedStopIds: nodes.map(({ id }) => id),
    awardedStopIds: nodes.map(({ id }) => id),
    xpAwards: nodes.map(({ id, xp }) => ({ stopId: id, amount: xp })),
  };
}

function juniorProfile() {
  const profile = createProfile();
  const journey = buildPlayerJourney(profile);
  return withClearedNodes(profile, [
    ...journey.boards[0].nodes,
    ...journey.boards[1].nodes.slice(0, 2),
  ]);
}

function campaignQuestions(gameSlug, level) {
  return Array.from({ length: 12 }, (_, questionIndex) => ({
    source: "campaign",
    gameSlug,
    level,
    questionIndex,
    contentVersion: "campaign-v1",
  }));
}

function normalAttempt(node, id = "catch-up-attempt") {
  return createNormalProgressionAttempt({
    id,
    node,
    campaignQuestions: campaignQuestions(node.gameSlug, node.level),
    nowMs: 100,
  });
}

function finishQuestions(attempt, correctCount = 12) {
  let next = attempt;
  while (next.currentRoundIndex !== null) {
    if (next.pendingSectionIndex !== null) {
      next = beginCulminationSection(next, 200);
    }
    const index = next.currentRoundIndex;
    next = recordQuestionAttempt(next, {
      correct: index < correctCount,
      answerToken: `answer-${index}`,
      nowMs: 300 + index,
    });
    if (index >= correctCount) {
      next = retryCurrentQuestion(next, 400 + index);
      next = recordQuestionAttempt(next, { correct: true, nowMs: 500 + index });
    }
    next = advanceAttemptQuestion(next, 600 + index);
  }
  return next;
}

function redeemAll(attempt) {
  let next = beginAttemptRedemption(attempt, 700);
  while (next.phase === "redemption") {
    next = recordRedemptionAttempt(next, { correct: true, nowMs: 710 });
    next = advanceRedemptionQuestion(next, 720);
  }
  return next;
}

function roundTripState(state) {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  assert.equal(saveProgressionState(state, storage), true);
  const loaded = loadProgressionStateDiagnostic(storage);
  assert.equal(loaded.status, "loaded");
  return loaded.state;
}

function roundTrip(profile) {
  return roundTripState(addPlayerProfile(createProgressionState(), profile)).profiles[0];
}

test("Julia returns to the new Starter stop before continuing Junior I without losing earned progress", () => {
  const original = juniorProfile();
  const before = structuredClone(original);
  const previousJourney = buildPlayerJourney(original);
  const currentJuniorStop = nextIncompleteJourneyNode(original);
  assert.equal(currentJuniorStop.journeyLevel, "junior-1");

  const upgraded = upgradePlayerProfileJourneyPlan(original, expandedCatalog, 2);
  const journey = buildPlayerJourney(upgraded);
  const catchUp = nextIncompleteJourneyNode(upgraded);
  assert.equal(catchUp.id, "starter:catch-up:extra-piece");
  assert.equal(catchUp.catalogAddition, true);
  assert.equal(catchUp.gameSlug, extraPiece.slug);
  assert.equal(catchUp.questionCount, 12);
  assert.equal(catchUp.collectionId, "campaign:starter");
  assert.equal(canPlayerAccessJourneyNode(upgraded, journey, catchUp.id), true);
  assert.equal(canPlayerAccessJourneyNode(upgraded, journey, currentJuniorStop.id), false);
  assert.throws(
    () => upsertProfileAttempt(upgraded, normalAttempt(previousJourney.boards[1].nodes[3])),
    /locked journey stop/,
  );
  assert.deepEqual(original, before);
  assert.deepEqual(upgraded.gameSnapshot, before.gameSnapshot);
  assert.deepEqual(upgraded.clearedStopIds, before.clearedStopIds);
  assert.deepEqual(upgraded.xpAwards, before.xpAwards);
  assert.deepEqual(upgraded.awardedStopIds, before.awardedStopIds);
  assert.equal(profileXpTotal(upgraded), 425);

  const reloaded = roundTrip(upgraded);
  assert.deepEqual(reloaded, upgraded);
  assert.equal(nextIncompleteJourneyNode(reloaded).id, catchUp.id);
  assert.equal(canPlayerAccessJourneyNode(reloaded, buildPlayerJourney(reloaded), currentJuniorStop.id), false);
});

test("catalog additions use each board's canonical bank and extend culminations without shifting original stops", () => {
  const largerCatalog = [
    ...games,
    ...Array.from({ length: 3 }, (_, index) => ({
      slug: `existing-${index}`,
      title: `Existing ${index}`,
    })),
    review,
  ];
  const original = createProfile("large-snapshot", largerCatalog);
  const baseline = buildPlayerJourney(original);
  const upgraded = upgradePlayerProfileJourneyPlan(original, [...largerCatalog, extraPiece], 2);
  const journey = buildPlayerJourney(upgraded);

  for (const [index, board] of journey.boards.entries()) {
    const originalBoard = baseline.boards[index];
    const catchUp = board.nodes.at(-2);
    assert.deepEqual(
      board.nodes.slice(0, -2),
      originalBoard.nodes.slice(0, -1),
      "Rotating eight-game windows, Turbo, and review stops must retain their IDs and order",
    );
    assert.equal(catchUp.id, `${JOURNEY_LEVELS[index]}:catch-up:extra-piece`);
    assert.equal(catchUp.catalogAddition, true);
    assert.equal(catchUp.kind, "normal");
    assert.equal(catchUp.collectionId, `campaign:${board.journeyLevel}`);
    assert.equal(catchUp.level, originalBoard.level);
    assert.equal(catchUp.questionOffset, 0);
    assert.equal(catchUp.questionCount, 12);
    assert.equal(catchUp.xp, originalBoard.nodes[0].xp);
    assert.equal(board.availableXp, originalBoard.availableXp + catchUp.xp);
    assert.deepEqual(board.nodes.map(({ position }) => position), board.nodes.map((_, i) => i));

    const culmination = board.nodes.at(-1);
    const oldCulmination = originalBoard.nodes.at(-1);
    assert.equal(culmination.id, oldCulmination.id);
    assert.deepEqual(culmination.gameSlugs, [...oldCulmination.gameSlugs, extraPiece.slug]);
    assert.deepEqual(
      culmination.sections.filter(({ gameSlug }) => gameSlug !== extraPiece.slug),
      oldCulmination.sections,
    );
    assert.deepEqual(culmination.sections.find(({ gameSlug }) => gameSlug === extraPiece.slug), {
      selection: "mistakes",
      gameSlug: extraPiece.slug,
      questionCount: 3,
    });
  }
});

test("repeated catalog growth is append-only across reordering, removal, metadata changes, and reload", () => {
  const sourceAddition = { ...extraPiece };
  let profile = upgradePlayerProfileJourneyPlan(createProfile(), [...originalCatalog, sourceAddition], 2);
  const firstAddition = structuredClone(profile.journeyAdditions[0]);
  sourceAddition.title = "Changed source object";
  assert.deepEqual(profile.journeyAdditions[0], firstAddition);
  assert.strictEqual(upgradePlayerProfileJourneyPlan(profile, expandedCatalog, 3), profile);

  const nextGame = { slug: "later-game", title: "Later Game", contentVersion: "later-v1" };
  profile = upgradePlayerProfileJourneyPlan(profile, [nextGame, review, ...games.toReversed(), extraPiece], 4);
  assert.deepEqual(profile.journeyAdditions.map(({ slug }) => slug), [extraPiece.slug, nextGame.slug]);
  const stableJourney = buildPlayerJourney(profile);
  const changedCatalog = [
    { ...nextGame, title: "A renamed game", contentVersion: "later-v2" },
    ...games.slice(0, 2),
    { ...review, slug: "another-review-provider" },
  ];
  const reconciled = upgradePlayerProfileJourneyPlan(roundTrip(profile), changedCatalog, 5);
  assert.deepEqual(reconciled.journeyAdditions, profile.journeyAdditions);
  assert.deepEqual(buildPlayerJourney(reconciled), stableJourney);
  for (const board of stableJourney.boards) {
    assert.deepEqual(
      board.nodes.filter(({ catalogAddition }) => catalogAddition).map(({ gameSlug }) => gameSlug),
      [extraPiece.slug, nextGame.slug],
    );
  }
});

test("catch-up mistakes, redemption, and active time survive reload before awarding XP exactly once", () => {
  let profile = upgradePlayerProfileJourneyPlan(juniorProfile(), expandedCatalog, 2);
  const journey = buildPlayerJourney(profile);
  const node = nextIncompleteJourneyNode(profile);
  const previousJuniorStop = nextIncompleteJourneyNode(juniorProfile());
  let attempt = addAttemptActiveTime(normalAttempt(node), 1_234, 110);
  attempt = recordQuestionAttempt(attempt, { correct: false, answerToken: "choice-2", nowMs: 120 });
  profile = roundTrip(upsertProfileAttempt(profile, attempt, { nowMs: 120 }));
  assert.deepEqual(profile.attempts[attempt.id], JSON.parse(JSON.stringify(attempt)));
  assert.equal(attempt.rounds[0].firstAnswerActiveTimeMs, 1_234);
  attempt = retryCurrentQuestion(profile.attempts[attempt.id], 130);
  attempt = recordQuestionAttempt(attempt, { correct: true, nowMs: 140 });
  attempt = advanceAttemptQuestion(attempt, 150);
  attempt = finishQuestions(attempt);
  assert.equal(attempt.phase, "redemption-ready");
  attempt = beginAttemptRedemption(attempt, 700);
  attempt = recordRedemptionAttempt(attempt, { correct: false, answerToken: "choice-4", nowMs: 710 });
  profile = roundTrip(upsertProfileAttempt(profile, attempt, { nowMs: 710 }));
  assert.deepEqual(profile.attempts[attempt.id], JSON.parse(JSON.stringify(attempt)));
  assert.equal(attempt.redemption.currentIndex, 0);
  assert.equal(attempt.redemption.phase, "feedback");
  assert.equal(canPlayerAccessJourneyNode(profile, journey, previousJuniorStop.id), false);

  attempt = retryRedemptionQuestion(profile.attempts[attempt.id], 720);
  attempt = recordRedemptionAttempt(attempt, { correct: true, nowMs: 730 });
  attempt = advanceRedemptionQuestion(attempt, 740);
  profile = upsertProfileAttempt(profile, attempt, { nowMs: 740 });
  const settled = settleProgressionAttempt(profile, attempt, journey, 800);
  assert.equal(settled.settlement.correctFirstAttempts, 11);
  assert.equal(settled.settlement.totalFirstAttempts, 12);
  assert.equal(settled.settlement.activeTimeMs, 1_234);
  assert.equal(settled.settlement.xpAwarded, 25);
  assert.equal(profileXpTotal(settled.profile), 450);
  assert.deepEqual(settled.profile.xpAwards.slice(0, -1), juniorProfile().xpAwards);
  assert.equal(settled.profile.missedQuestions.length, 1);
  assert.equal(settled.profile.missedQuestions[0].question.gameSlug, extraPiece.slug);
  assert.deepEqual(settled.profile.missedQuestions[0].observations, [{
    attemptId: attempt.id,
    stopId: node.id,
    journeyLevel: "starter",
    elapsedMs: 1_234,
    missedAtMs: 120,
  }]);
  const loadedSettlement = roundTrip(settled.profile);
  const duplicate = settleProgressionAttempt(loadedSettlement, loadedSettlement.attempts[attempt.id], journey, 900);
  assert.strictEqual(duplicate.profile, loadedSettlement);
  profile = roundTrip(closeAttemptSummary(duplicate.profile, attempt.id, 1_000));
  assert.equal(nextIncompleteJourneyNode(profile).id, previousJuniorStop.id);
  assert.equal(canPlayerAccessJourneyNode(profile, journey, previousJuniorStop.id), true);
  assert.equal(profile.clearedStopIds.filter((id) => id === node.id).length, 1);
  assert.equal(profile.xpAwards.filter(({ stopId }) => stopId === node.id).length, 1);
});

test("a redeemed catch-up with insufficient first-attempt accuracy remains required", () => {
  let profile = upgradePlayerProfileJourneyPlan(juniorProfile(), expandedCatalog, 2);
  const journey = buildPlayerJourney(profile);
  const node = nextIncompleteJourneyNode(profile);
  const attempt = redeemAll(finishQuestions(normalAttempt(node, "failed-catch-up"), 8));
  profile = upsertProfileAttempt(profile, attempt);
  const failed = settleProgressionAttempt(profile, attempt, journey, 800);
  assert.equal(failed.settlement.passed, false);
  assert.equal(failed.settlement.xpAwarded, 0);
  profile = roundTrip(closeAttemptSummary(failed.profile, attempt.id, 900));
  assert.equal(profileXpTotal(profile), 425);
  assert.equal(nextIncompleteJourneyNode(profile).id, node.id);
  assert.equal(profile.missedQuestions.length, 4);
  assert.equal(canPlayerAccessJourneyNode(profile, journey, nextIncompleteJourneyNode(juniorProfile()).id), false);
});

test("catalog reconciliation waits for active answering, feedback, redemption, and summary states", () => {
  const profile = juniorProfile();
  const journey = buildPlayerJourney(profile);
  // Continue at the next ordinary node after two already-cleared Junior stops.
  const node = journey.boards[1].nodes[3];
  const ready = withClearedNodes(profile, [
    ...journey.boards[0].nodes,
    ...journey.boards[1].nodes.slice(0, 3),
  ]);
  const playing = normalAttempt(node, "active-original-game");
  const feedback = recordQuestionAttempt(playing, { correct: false, nowMs: 110 });
  const redemptionReady = finishQuestions(playing, 11);
  const redemption = beginAttemptRedemption(redemptionReady, 700);
  const summaryReady = redeemAll(redemptionReady);
  const summary = settleProgressionAttempt(upsertProfileAttempt(ready, summaryReady), summaryReady, journey, 800).attempt;
  const failedReady = redeemAll(finishQuestions(playing, 8));
  const failed = settleProgressionAttempt(upsertProfileAttempt(ready, failedReady), failedReady, journey, 800).attempt;

  for (const attempt of [playing, feedback, redemptionReady, redemption, summaryReady, summary, failed]) {
    let active = upsertProfileAttempt(ready, attempt, { nowMs: 900 });
    if (attempt.settlement) {
      active = {
        ...active,
        settledAttemptIds: [attempt.id],
        ...(attempt.settlement.passed ? {
          clearedStopIds: [...active.clearedStopIds, node.id],
          awardedStopIds: [...active.awardedStopIds, node.id],
          xpAwards: [...active.xpAwards, { stopId: node.id, amount: node.xp }],
        } : {}),
      };
    }
    assert.strictEqual(upgradePlayerProfileJourneyPlan(active, expandedCatalog, 1_000), active, attempt.phase);
    const loaded = roundTrip(active);
    assert.deepEqual(loaded.attempts[attempt.id], JSON.parse(JSON.stringify(attempt)), attempt.phase);
    assert.strictEqual(upgradePlayerProfileJourneyPlan(loaded, expandedCatalog, 1_100), loaded, attempt.phase);
    assert.deepEqual(buildPlayerJourney(loaded), journey, attempt.phase);
  }

  const settled = settleProgressionAttempt(upsertProfileAttempt(ready, summaryReady), summaryReady, journey, 800);
  const closed = closeAttemptSummary(settled.profile, settled.attempt.id, 900);
  const upgraded = upgradePlayerProfileJourneyPlan(closed, expandedCatalog, 1_000);
  assert.equal(nextIncompleteJourneyNode(upgraded).id, "starter:catch-up:extra-piece");
  assert.ok(upgraded.clearedStopIds.includes(node.id));
});

test("an active culmination retains its original section list until it finishes", () => {
  const profile = createProfile("culmination-player", [games[0], review]);
  const journey = buildPlayerJourney(profile);
  const node = journey.boards[0].nodes.at(-1);
  const ready = withClearedNodes(profile, journey.boards[0].nodes.slice(0, -1));
  let attempt = createCulminationProgressionAttempt({
    id: "active-culmination",
    node,
    missedQuestions: [],
    questionPools: [{
      gameSlug: games[0].slug,
      approachableQuestion: campaignQuestions(games[0].slug, "starter")[0],
      campaignQuestions: campaignQuestions(games[0].slug, "starter"),
      currentContentVersion: "campaign-v1",
      currentGeneratorVersion: "generator-v1",
    }],
    nowMs: 100,
  });
  const active = roundTrip(upsertProfileAttempt(ready, attempt));
  const currentCatalog = [games[0], extraPiece, review];
  assert.strictEqual(upgradePlayerProfileJourneyPlan(active, currentCatalog, 110), active);
  assert.deepEqual(active.attempts[attempt.id].sections, [{ gameSlug: games[0].slug, startRoundIndex: 0, questionCount: 3 }]);
  attempt = finishQuestions(active.attempts[attempt.id]);
  const settled = settleProgressionAttempt(upsertProfileAttempt(active, attempt), attempt, journey, 800);
  const upgraded = upgradePlayerProfileJourneyPlan(closeAttemptSummary(settled.profile, attempt.id, 900), currentCatalog, 1_000);
  assert.ok(upgraded.clearedStopIds.includes(node.id));
  assert.equal(nextIncompleteJourneyNode(upgraded).id, "starter:catch-up:extra-piece");
  assert.deepEqual(buildPlayerJourney(upgraded).boards[1].nodes.at(-1).gameSlugs, [games[0].slug, extraPiece.slug]);
});

test("a four-board legacy profile upgrades its original progress and then receives catalog catch-up", () => {
  const legacyJourney = buildLegacyJourneyPlan(games);
  const legacy = withClearedNodes({
    ...createProfile(),
    journeyPlanVersion: 1,
    gameSnapshot: games,
  }, legacyJourney.boards[0].nodes);
  const upgraded = upgradePlayerProfileJourneyPlan(legacy, expandedCatalog, 2);
  assert.equal(upgraded.journeyPlanVersion, 2);
  assert.equal(profileXpTotal(upgraded), profileXpTotal(legacy));
  assert.equal(upgraded.clearedStopIds.length, legacy.clearedStopIds.length);
  assert.equal(nextIncompleteJourneyNode(upgraded).id, "starter:catch-up:extra-piece");
  assert.deepEqual(upgraded.journeyAdditions.map(({ slug }) => slug), [extraPiece.slug]);
  assert.equal(upgraded.gameSnapshot.some(({ slug }) => slug === extraPiece.slug), false);
  assert.deepEqual(roundTrip(upgraded), upgraded);
});

test("schema-three profiles and separate students retain their own membership and progress", () => {
  const legacy = juniorProfile();
  const decoded = decodeProgressionStateDiagnostic(JSON.stringify({
    schemaVersion: 3,
    activeProfileId: legacy.id,
    profiles: [legacy],
  }));
  assert.notEqual(decoded.status, "corrupt");
  const upgraded = upgradePlayerProfileJourneyPlan(decoded.state.profiles[0], expandedCatalog, 2);
  const newStudent = createProfile("new-student", expandedCatalog);
  const existingStudent = createProfile("existing-student");
  let state = createProgressionState();
  for (const profile of [upgraded, newStudent, existingStudent]) state = addPlayerProfile(state, profile);
  state = roundTripState(switchPlayerProfile(state, upgraded.id));
  assert.equal(state.activeProfileId, upgraded.id);
  assert.deepEqual(state.profiles[0], upgraded);
  assert.deepEqual(state.profiles[1], newStudent);
  assert.deepEqual(state.profiles[2], existingStudent);
  assert.equal(buildPlayerJourney(state.profiles[1]).boards.some(({ nodes }) => nodes.some(({ catalogAddition }) => catalogAddition)), false);
  assert.equal(buildPlayerJourney(state.profiles[2]).boards[0].nodes.at(-1).gameSlugs.includes(extraPiece.slug), false);
  assert.deepEqual(previousJourneyNodeIds(buildPlayerJourney(upgraded), "junior-1:normal:01:game-1").filter((id) => id.includes(":catch-up:")), ["starter:catch-up:extra-piece"]);
  assert.deepEqual(buildPlayerJourney(newStudent), buildJourneyPlan(expandedCatalog));
});

for (const [label, journeyAdditions] of [
  ["an original game repeated as an addition", [games[0]]],
  ["duplicate added games", [extraPiece, { ...extraPiece }]],
  ["a review provider added as a canonical game", [{ ...review, slug: "new-review" }]],
  ["a non-array addition manifest", { extraPiece }],
]) {
  test(`malformed catalog additions fail safely: ${label}`, () => {
    const otherStudent = createProfile("unaffected-student");
    let original = addPlayerProfile(createProgressionState(), juniorProfile());
    original = addPlayerProfile(original, otherStudent);
    const corrupted = {
      ...original,
      profiles: original.profiles.map((profile) => profile.id === "julia"
        ? { ...profile, journeyAdditions }
        : profile),
    };

    const diagnostic = decodeProgressionStateDiagnostic(JSON.stringify(corrupted));
    assert.equal(diagnostic.status, "corrupt");
    assert.deepEqual(diagnostic.state.profiles, [otherStudent]);
    const legacyDiagnostic = decodeProgressionStateDiagnostic(JSON.stringify({
      ...corrupted,
      schemaVersion: 3,
    }));
    assert.equal(legacyDiagnostic.status, "corrupt");
    assert.deepEqual(legacyDiagnostic.state.profiles, [otherStudent]);

    const entries = new Map();
    const storage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    };
    assert.equal(saveProgressionState(original, storage), true);
    const savedBeforeInvalidWrite = entries.get(PROGRESSION_STORAGE_KEY);
    assert.equal(saveProgressionState(corrupted, storage), false);
    assert.equal(entries.get(PROGRESSION_STORAGE_KEY), savedBeforeInvalidWrite);
    const restored = loadProgressionStateDiagnostic(storage);
    assert.equal(restored.status, "loaded");
    assert.deepEqual(restored.state, original);
  });
}

test("new profiles already containing the full catalog never gain redundant catch-up stops", () => {
  const profile = createProfile("full-catalog-student", expandedCatalog);
  const initialJourney = buildPlayerJourney(profile);
  assert.deepEqual(profile.journeyAdditions ?? [], []);
  assert.equal(initialJourney.boards.some(({ nodes }) => nodes.some(({ catalogAddition }) => catalogAddition)), false);
  assert.ok(initialJourney.boards.every(({ nodes }) => nodes.at(-1).gameSlugs.includes(extraPiece.slug)));

  for (const catalog of [expandedCatalog, expandedCatalog.toReversed()]) {
    assert.strictEqual(upgradePlayerProfileJourneyPlan(profile, catalog, 2), profile);
  }
  const reloaded = roundTrip(profile);
  assert.strictEqual(upgradePlayerProfileJourneyPlan(reloaded, expandedCatalog, 3), reloaded);
  assert.deepEqual(reloaded.journeyAdditions ?? [], []);
  assert.deepEqual(buildPlayerJourney(reloaded), initialJourney);
});
