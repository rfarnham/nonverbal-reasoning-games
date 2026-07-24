import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertJourneyReviewReleaseGate,
  defaultReviewsDirectory,
  discoverJourneyReviewPackages,
  renderJourneyReviewRegistry,
} from "../scripts/generate-journey-review-registry.mjs";
import {
  journeyReviewReleaseReady,
} from "../app/journey/reviews/math-kangaroo/progression-adapter.ts";
import { journeyReviews } from "../lib/journey-reviews.ts";

test("Journey review providers are discovered from their route packages", async () => {
  const packages = await discoverJourneyReviewPackages(
    defaultReviewsDirectory,
  );
  assert.deepEqual(
    packages.map(({ slug }) => slug),
    ["math-kangaroo"],
  );
  assert.match(
    packages[0].progressionAdapterFile,
    /math-kangaroo\/progression-adapter\.ts$/,
  );
  assert.equal(journeyReviewReleaseReady, true);
  const rendered = renderJourneyReviewRegistry(packages);
  assert.match(rendered, /math-kangaroo\/provider/);
  assert.match(rendered, /journey\/reviews\/math-kangaroo\//);
  assert.doesNotMatch(
    rendered,
    /progression-adapter|authored-rounds|runtime-manifest|journeyReviewReleaseReady/,
  );
});

test("the generated review catalog exposes local, versioned providers", () => {
  assert.equal(journeyReviews.length, 1);
  assert.deepEqual(journeyReviews[0], {
    slug: "math-kangaroo",
    href: "/journey/reviews/math-kangaroo/",
    role: "review",
    title: "Math Kangaroo Spatial Review",
    description:
      "Carefully selected visual-spatial Math Kangaroo problems with animated explanations.",
    journeyContentVersion: "mk-spatial-cyprus-2026.1",
    gradeBands: ["grades-1-2", "grades-3-4"],
  });
});

test("review discovery fails closed without adding release data to provider metadata", () => {
  assert.doesNotThrow(() =>
    assertJourneyReviewReleaseGate("ready-review", {
      journeyReviewReleaseReady: true,
    })
  );
  for (const value of [false, undefined, "true", 1]) {
    assert.throws(
      () =>
        assertJourneyReviewReleaseGate("unfinished-review", {
          journeyReviewReleaseReady: value,
        }),
      /not release-ready/,
    );
  }

  const provider = readFileSync(
    "app/journey/reviews/math-kangaroo/provider.ts",
    "utf8",
  );
  assert.doesNotMatch(
    provider,
    /progression-adapter|authored-rounds|runtime-manifest|journeyReviewReleaseReady/,
  );
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.ok(
    scripts["generate:games"].indexOf(
      "generate-math-kangaroo-runtime-manifest",
    ) <
      scripts["generate:games"].indexOf(
        "generate-journey-review-registry",
      ),
  );
});
