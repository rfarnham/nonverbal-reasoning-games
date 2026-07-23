import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

const [pageSource, cssSource] = await Promise.all([
  readFile(
    new URL("app/games/bracelet-search/page.tsx", projectRoot),
    "utf8",
  ),
  readFile(
    new URL(
      "app/games/bracelet-search/bracelet-search.module.css",
      projectRoot,
    ),
    "utf8",
  ),
]);

test("every advanced crossing is rendered as a gap plus an overpass", () => {
  assert.equal(
    [...pageSource.matchAll(/tangleLayout\.overpassPaths\.map/g)].length,
    2,
    "the same crossing paths cut the under-strand and redraw the over-strand",
  );
  assert.ok(pageSource.includes("styles.tangleBridgeGap"));
  assert.ok(pageSource.includes("styles.tangleBridge"));
  assert.ok(pageSource.includes("data-presentation={tangleLayout.id}"));
  assert.ok(pageSource.includes("data-bracelet-index={braceletIndex}"));
  assert.match(cssSource, /\.tangleBridgeGap \{[^}]*stroke-width: 15;/s);
});

test("live, mistake, and history views derive one stable per-round layout", () => {
  assert.ok(pageSource.includes("braceletPresentationForRound(round)"));
  assert.ok(
    pageSource.includes("braceletPresentationForRound(missedRound)"),
  );
  assert.ok(
    pageSource.includes(
      "braceletPresentationForRound(\n                  historicalReview.sessionRound.round,",
    ),
  );

  const tutorialStart = pageSource.indexOf(
    "bracelet={TUTORIAL.bracelet}",
  );
  const tutorialEnd = pageSource.indexOf(
    "Example bracelet with one three-bead run",
    tutorialStart,
  );
  assert.ok(tutorialStart >= 0 && tutorialEnd > tutorialStart);
  assert.doesNotMatch(
    pageSource.slice(tutorialStart, tutorialEnd),
    /presentation=/,
    "the solved introductory example remains a simple circle",
  );
});

test("monochrome beads keep dots legible in HTML and SVG", () => {
  assert.match(
    cssSource,
    /\.beadBlack \{[^}]*--bead-fill: #24262d;[^}]*--bead-mark: #d9d8d2;/s,
  );
  assert.match(
    cssSource,
    /\.beadLightGray \{[^}]*--bead-fill: #d9d8d2;[^}]*--bead-mark: var\(--ink\);/s,
  );
  assert.match(
    cssSource,
    /\.tangleBeadDot \{[^}]*fill: var\(--bead-mark, var\(--ink\)\);/s,
  );
  assert.match(
    cssSource,
    /\.beadMark \{[^}]*color: var\(--bead-mark, var\(--ink\)\);/s,
  );
});
