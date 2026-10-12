import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ROUNDS,
  TUTORIAL,
  describeItem,
  foldPaper,
  initialPaper,
  matchingFirstFolds,
  roundFingerprint,
  validateRound,
} from "../app/games/folded-items/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildFoldedItemsJourneyExtraCampaignRounds,
} from "../app/games/folded-items/journey-campaign.ts";
import { progressionAdapter } from "../app/games/folded-items/progression-adapter.ts";
import {
  JOURNEY_LEVELS,
  PROGRESSION_LEVELS,
  buildJourneyPlan,
  campaignQuestionReferences,
  createFreshGeneratedQuestion,
  journeyCampaignRoundsForLevel,
  journeyQuestionReferences,
  resolveProgressionQuestion,
} from "../lib/progression/index.ts";
import {
  defaultGamesDirectory,
  discoverGamePackages,
} from "../scripts/generate-game-registry.mjs";

test("Folded Items adds 36 deterministic Journey rounds without expanding standalone Campaign", () => {
  assert.equal(ROUNDS.length, 48);
  assert.equal(progressionAdapter.campaignRounds, ROUNDS);
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.deepEqual(Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), [
    "junior-2", "expert-2", "wizard-2",
  ]);
  assert.deepEqual(buildFoldedItemsJourneyExtraCampaignRounds(), JOURNEY_EXTRA_CAMPAIGN_ROUNDS);
  const fingerprints = new Set(ROUNDS.map(roundFingerprint));
  for (const [level, rounds] of Object.entries(JOURNEY_EXTRA_CAMPAIGN_ROUNDS)) {
    assert.equal(rounds.length, 12);
    assert.equal(Object.isFrozen(rounds), true);
    const positions = rounds.map(({ correctIndex }) => correctIndex);
    assert.deepEqual([0, 1, 2, 3].map((position) =>
      positions.filter((value) => value === position).length,
    ), [3, 3, 3, 3]);
    assert.equal(positions.some((position, index) => index > 0 && positions[index - 1] === position), false);
    assert.equal(new Set([0, 4, 8].map((offset) => positions.slice(offset, offset + 4).join())).size, 3);
    const shapeRounds = rounds.filter(({ source }) => source.items[0].kind === "shape");
    assert.equal(shapeRounds.length, 4);
    for (const round of rounds) {
      assert.deepEqual(validateRound(round), [], level);
      const fingerprint = roundFingerprint(round);
      assert.equal(fingerprints.has(fingerprint), false, `${level} must be fresh`);
      fingerprints.add(fingerprint);
      if (level === "wizard-2") {
        assert.deepEqual(matchingFirstFolds(round), [round.folds[0]]);
        assert.notEqual(round.overlapClue.aboveId, round.targetId);
        assert.notEqual(round.overlapClue.belowId, round.targetId);
      }
    }
  }
  assert.equal(fingerprints.size, 84);
});

test("Folded Items resolves all seven Journey banks and replays Turbo questions canonically", () => {
  const fingerprints = new Set();
  for (const level of JOURNEY_LEVELS) {
    const rounds = journeyCampaignRoundsForLevel(progressionAdapter, level);
    const refs = journeyQuestionReferences(progressionAdapter, level);
    assert.equal(rounds.length, 12);
    assert.equal(refs.length, 12);
    for (const [index, ref] of refs.entries()) {
      const resolved = resolveProgressionQuestion(progressionAdapter, ref);
      assert.equal(resolved.resolution, "current");
      assert.equal(resolved.ref.gameSlug, "folded-items");
      assert.equal(resolved.ref.journeyLevel, level);
      assert.equal(resolved.fingerprint, roundFingerprint(rounds[index]));
      fingerprints.add(resolved.fingerprint);
    }
  }
  assert.equal(fingerprints.size, 84);
  for (const level of PROGRESSION_LEVELS) {
    const standaloneRefs = campaignQuestionReferences(progressionAdapter, level);
    assert.equal(standaloneRefs.length, 12);
    const question = createFreshGeneratedQuestion(progressionAdapter, {
      level,
      seedBase: `folded-items-journey:${level}`,
    });
    assert.equal(question.ref.source, "generated");
    assert.deepEqual(validateRound(question.round), []);
    assert.equal(resolveProgressionQuestion(progressionAdapter, question.ref).fingerprint, question.fingerprint);
  }
});

test("catalog discovery includes Folded Items throughout Journey without excluding other games", async () => {
  const packages = await discoverGamePackages(defaultGamesDirectory);
  assert.ok(packages.some(({ slug }) => slug === "folded-items"));
  assert.ok(packages.some(({ slug }) => slug === "shape-fold"));
  const snapshot = packages.map(({ slug }) => ({ slug, title: slug }));
  const journey = buildJourneyPlan([
    ...snapshot,
    { slug: "review-provider", title: "Review Provider", role: "review" },
  ]);
  assert.deepEqual(
    journey.gameSnapshot.filter(({ role }) => role === "game").map(({ slug }) => slug),
    snapshot.map(({ slug }) => slug),
  );
  const ordinary = new Set(journey.boards.flatMap(({ nodes }) =>
    nodes.filter(({ kind }) => kind === "normal").map(({ gameSlug }) => gameSlug),
  ));
  assert.ok(ordinary.has("folded-items"));
  assert.equal(ordinary.size, snapshot.length);
  for (const board of journey.boards) {
    assert.ok(board.nodes.at(-1).gameSlugs.includes("folded-items"));
    assert.equal(board.nodes.at(-1).gameSlugs.length, snapshot.length);
  }
  const launchSource = await readFile(new URL("../components/progression/journey-launch.ts", import.meta.url), "utf8");
  const snapshotSource = launchSource.slice(
    launchSource.indexOf("export function journeyCatalogSnapshot"),
    launchSource.indexOf("export function journeyCampaignQuestions"),
  );
  assert.match(snapshotSource, /games\.map/);
  assert.doesNotMatch(snapshotSource, /\.slice\(/);
  assert.doesNotMatch(launchSource, /folded-items|shape-fold/);
});

test("the solved opening example is a legible one-fold introduction before ordered Junior play", () => {
  const first = foldPaper(initialPaper(TUTORIAL.source), { direction: "up", sense: "over", crease: 1 });
  assert.deepEqual(first.stacks, [[4, 0], [5, 1], [6, 2], [7, 3]]);
  assert.equal(TUTORIAL.answerMode, "group");
  assert.equal(describeItem(TUTORIAL, TUTORIAL.targetId), "B");
  assert.deepEqual(TUTORIAL.correctItems.map((id) => describeItem(TUTORIAL, id)), ["F"]);
  assert.equal(progressionAdapter.contentVersion, "2");
  assert.equal(progressionAdapter.generatorVersion, "2");
  assert.equal(progressionAdapter.journeyContentVersion, "2");
});
