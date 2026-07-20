import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  campaignQuestionReferences,
  campaignRoundsForLevel,
  createFreshGeneratedQuestion,
  resolveProgressionQuestion,
} from "../lib/progression/game-adapter.ts";
import { questionReferenceKey } from "../lib/progression/questions.ts";
import { PROGRESSION_LEVELS } from "../lib/progression/types.ts";
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
