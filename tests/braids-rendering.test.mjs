import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

const [pageSource, cssSource] = await Promise.all([
  readFile(new URL("app/games/braids/page.tsx", projectRoot), "utf8"),
  readFile(
    new URL("app/games/braids/braids.module.css", projectRoot),
    "utf8",
  ),
]);

test("the in-game braid uses continuous masked strands instead of crossing capsules", () => {
  assert.match(pageSource, /const UNDERPASS_GAP = 26;/);
  assert.match(pageSource, /const diagramId = useId\(\)\.replace/);
  assert.ok(
    pageSource.includes(
      'mask={`url(#${maskPrefix}-vertical-${index})`}',
    ),
  );
  assert.ok(
    pageSource.includes(
      'mask={`url(#${maskPrefix}-horizontal-${index})`}',
    ),
  );
  assert.equal(pageSource.includes("styles.crossingBreak"), false);
  assert.equal(cssSource.includes(".crossingBreak"), false);
  assert.match(
    cssSource,
    /\.ribbonOutline,\n\.ribbonBody \{[^}]*stroke-linecap: round;/s,
  );
});

test("the other-side cue shows a static three-dimensional flip sequence", () => {
  assert.match(
    pageSource,
    /aria-label="Pane shown front-on, edge-on, then from its other side"/,
  );
  assert.ok(pageSource.includes("styles.sideCueFront"));
  assert.ok(pageSource.includes("styles.sideCueEdge"));
  assert.ok(pageSource.includes("styles.sideCueBack"));
  assert.equal(pageSource.includes("M22 16C5 28 7 52 27 59"), false);
  assert.equal(pageSource.includes("M62 54c17-12 15-36-5-43"), false);

  const sideCueRules = [...cssSource.matchAll(/\.sideCue[^{]*\{[^}]*\}/g)]
    .map(([rule]) => rule)
    .join("\n");
  assert.doesNotMatch(sideCueRules, /\b(?:animation|transition)(?:-[\w-]+)?\s*:/);
  assert.match(cssSource, /\.sideCueFront \{\s*opacity: 0\.52;/);
  assert.doesNotMatch(cssSource, /\.sideCueCompact \{[^}]*opacity:/s);
  assert.match(cssSource, /\.reviewVisual \.sideCue \{\s*width: 52px;/);
  assert.match(cssSource, /\.exampleFlow \.sideCue \{\s*width: 52px;/);
});
