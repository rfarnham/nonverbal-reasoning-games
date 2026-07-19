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
