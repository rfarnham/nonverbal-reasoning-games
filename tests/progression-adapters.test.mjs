import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  campaignQuestionReferences,
  campaignRoundsForLevel,
  createFreshGeneratedQuestion,
  defineProgressionGameAdapter,
  journeyCampaignRoundsForLevel,
  journeyQuestionReferences,
  resolveProgressionQuestion,
} from "../lib/progression/game-adapter.ts";
import { questionReferenceKey } from "../lib/progression/questions.ts";
import {
  JOURNEY_LEVELS,
  PROGRESSION_LEVELS,
  journeyLevelDifficulty,
} from "../lib/progression/types.ts";
import {
  defaultGamesDirectory,
  discoverGamePackages,
} from "../scripts/generate-game-registry.mjs";

async function discoveredAdapters() {
  const packages = await discoverGamePackages(defaultGamesDirectory);
  return Promise.all(
    packages.map(async ({ slug, catalogFile }) => {
      const adapterFile = resolve(
        dirname(catalogFile),
        "progression-adapter.ts",
      );
      await assert.doesNotReject(
        access(adapterFile),
        `${slug} must provide progression-adapter.ts`,
      );
      const adapterModule = await import(pathToFileURL(adapterFile).href);
      assert.ok(
        adapterModule.progressionAdapter,
        `${slug} must export progressionAdapter`,
      );
      assert.equal(adapterModule.progressionAdapter.gameSlug, slug);
      return {
        slug,
        adapterFile,
        adapter: adapterModule.progressionAdapter,
      };
    }),
  );
}

test("every discovered game exposes only a local, canonical adapter bridge", async () => {
  const adapters = await discoveredAdapters();
  assert.ok(adapters.length > 0);

  for (const { slug, adapterFile } of adapters) {
    const source = await readFile(adapterFile, "utf8");
    const imports = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ].map((match) => match[1]);

    assert.ok(imports.length >= 2, `${slug} adapter must delegate to its engine`);
    for (const specifier of imports) {
      assert.ok(
        specifier.startsWith("./") ||
          specifier === "../../../lib/progression/game-adapter.ts",
        `${slug} adapter imports non-local game code: ${specifier}`,
      );
      assert.ok(
        !specifier.startsWith("../") ||
          specifier === "../../../lib/progression/game-adapter.ts",
        `${slug} adapter must not import another game's code: ${specifier}`,
      );
    }

    assert.equal(
      source.match(/\bgameSlug:\s*"([^"]+)"/)?.[1],
      slug,
      `${slug} adapter slug must be literal and route-local`,
    );
    assert.match(
      source,
      /\bcontentVersion:\s*progressionMetadata\.contentVersion/,
    );
    assert.match(
      source,
      /\bgeneratorVersion:\s*progressionMetadata\.generatorVersion/,
    );
    assert.match(
      source,
      /\bjourneyContentVersion:\s*progressionMetadata\.journeyContentVersion/,
      `${slug} must version its Journey-only authored content`,
    );
    assert.match(
      source,
      /\bjourneyCampaignRounds:\s*\{/,
      `${slug} must provide all seven Journey banks explicitly`,
    );
  }
});

test("all discovered Campaign adapters resolve the canonical 48 rounds", async () => {
  const adapters = await discoveredAdapters();

  for (const { slug, adapter } of adapters) {
    const questionKeys = new Set();
    const fingerprints = new Set();

    for (const level of PROGRESSION_LEVELS) {
      const rounds = campaignRoundsForLevel(adapter, level);
      const references = campaignQuestionReferences(adapter, level);
      assert.equal(rounds.length, 12, `${slug} ${level} round count`);
      assert.equal(references.length, 12, `${slug} ${level} ref count`);

      for (let index = 0; index < references.length; index += 1) {
        const reference = references[index];
        const resolved = resolveProgressionQuestion(adapter, reference);
        const canonicalFingerprint = adapter.fingerprint(rounds[index]);

        assert.equal(reference.questionIndex, index);
        assert.equal(resolved.ref.source, "campaign");
        assert.equal(resolved.ref.level, level);
        assert.equal(resolved.ref.gameSlug, slug);
        assert.equal(resolved.fingerprint, canonicalFingerprint);
        assert.equal(adapter.fingerprint(resolved.round), canonicalFingerprint);
        assert.equal(resolved.resolution, "current");
        assert.equal(resolved.migrated, false);
        questionKeys.add(questionReferenceKey(resolved.ref));
        fingerprints.add(resolved.fingerprint);
      }
    }

    assert.equal(questionKeys.size, 48, `${slug} Campaign ref uniqueness`);
    assert.equal(fingerprints.size, 48, `${slug} Campaign fingerprint uniqueness`);
  }
});

test("Journey banks add seven authored collections without changing standalone Campaign", () => {
  const campaignRounds = PROGRESSION_LEVELS.flatMap((level) =>
    Array.from({ length: 12 }, (_, index) => ({
      id: `campaign:${level}:${index}`,
      difficulty: level,
    })),
  );
  const journeyCampaignRounds = Object.fromEntries(
    JOURNEY_LEVELS.map((journeyLevel) => [
      journeyLevel,
      Array.from({ length: 12 }, (_, index) => ({
        id: `journey:${journeyLevel}:${index}`,
        difficulty: journeyLevelDifficulty(journeyLevel),
      })),
    ]),
  );
  const reviewRounds = Array.from({ length: 28 }, (_, index) => ({
    id: `review:junior-1:${index}`,
    difficulty: "junior",
  }));
  const adapter = defineProgressionGameAdapter({
    gameSlug: "authored-test",
    contentVersion: "campaign-v1",
    generatorVersion: "generator-v1",
    journeyContentVersion: "journey-v1",
    campaignRounds,
    journeyCampaignRounds,
    journeyCollections: [
      {
        id: "review:junior-1",
        journeyLevel: "junior-1",
        rounds: reviewRounds,
      },
    ],
    difficultyByLevel: {
      starter: "starter",
      junior: "junior",
      expert: "expert",
      wizard: "wizard",
    },
    difficultyOf: (round) => round.difficulty,
    fingerprint: (round) => round.id,
    generate: (difficulty) => ({
      id: `generated:${difficulty}`,
      difficulty,
    }),
  });

  assert.equal(adapter.campaignRounds.length, 48);
  const journeyKeys = new Set();
  const journeyFingerprints = new Set();
  for (const journeyLevel of JOURNEY_LEVELS) {
    const rounds = journeyCampaignRoundsForLevel(adapter, journeyLevel);
    const refs = journeyQuestionReferences(adapter, journeyLevel);
    assert.equal(rounds.length, 12);
    assert.equal(refs.length, 12);
    for (const [index, ref] of refs.entries()) {
      const resolved = resolveProgressionQuestion(adapter, ref);
      assert.equal(ref.source, "journey");
      assert.equal(ref.journeyLevel, journeyLevel);
      assert.equal(ref.level, journeyLevelDifficulty(journeyLevel));
      assert.equal(ref.questionIndex, index);
      assert.equal(resolved.resolution, "current");
      assert.equal(resolved.fingerprint, rounds[index].id);
      journeyKeys.add(questionReferenceKey(ref));
      journeyFingerprints.add(resolved.fingerprint);
    }
  }
  assert.equal(journeyKeys.size, 84);
  assert.equal(journeyFingerprints.size, 84);

  const freshCulminationRefs = journeyQuestionReferences(
    adapter,
    "junior-1",
    {
      collectionId: "review:junior-1",
      questionOffset: 24,
      questionCount: 4,
    },
  );
  assert.deepEqual(
    freshCulminationRefs.map(({ questionIndex }) => questionIndex),
    [24, 25, 26, 27],
  );
  assert.ok(
    freshCulminationRefs.every(
      (ref) => resolveProgressionQuestion(adapter, ref).resolution === "current",
    ),
  );

  const stale = resolveProgressionQuestion(adapter, {
    ...freshCulminationRefs[0],
    contentVersion: "stale",
  });
  assert.equal(stale.resolution, "journey-updated");
  assert.equal(stale.ref.contentVersion, "journey-v1");
  assert.equal(stale.migrated, true);
});

test("every adapter deterministically replays generated rounds and migrates stale refs", async () => {
  const adapters = await discoveredAdapters();

  for (const { slug, adapter } of adapters) {
    for (const level of PROGRESSION_LEVELS) {
      const seedBase = `adapter-conformance:${slug}:${level}`;
      const generated = createFreshGeneratedQuestion(adapter, {
        level,
        seedBase,
      });

      assert.equal(
        generated.ref.source,
        "generated",
        `${slug} ${level} should generate from its canonical engine`,
      );
      const firstReplay = resolveProgressionQuestion(adapter, generated.ref);
      const secondReplay = resolveProgressionQuestion(adapter, generated.ref);
      assert.equal(firstReplay.resolution, "current");
      assert.equal(secondReplay.resolution, "current");
      assert.equal(firstReplay.fingerprint, generated.fingerprint);
      assert.equal(secondReplay.fingerprint, generated.fingerprint);
      assert.equal(
        adapter.fingerprint(firstReplay.round),
        adapter.fingerprint(secondReplay.round),
      );

      const stale = resolveProgressionQuestion(adapter, {
        ...generated.ref,
        generatorVersion: "stale-test-version",
      });
      assert.equal(stale.ref.source, "campaign");
      assert.equal(stale.ref.gameSlug, slug);
      assert.equal(stale.ref.level, level);
      assert.equal(stale.resolution, "generated-fallback");
      assert.equal(stale.migrated, true);
      assert.ok(
        campaignRoundsForLevel(adapter, level).some(
          (round) => adapter.fingerprint(round) === stale.fingerprint,
        ),
        `${slug} ${level} stale fallback must be current Campaign content`,
      );
    }
  }
});
