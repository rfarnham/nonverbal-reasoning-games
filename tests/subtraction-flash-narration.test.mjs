import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { SUITE_NARRATOR_PROVENANCE } from "../lib/game-narration.ts";

const manifestUrl = new URL(
  "../content/narration/subtraction-flash.json",
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const adapterSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/question-narration.ts",
    import.meta.url,
  ),
  "utf8",
);
const pageSourceUrl = new URL(
  "../app/lab/subtraction-flash/page.tsx",
  import.meta.url,
);
const outputRoot = new URL(
  "../public/audio/narration/kokoro-82m-v1-af-heart/subtraction-flash/",
  import.meta.url,
);

const numberWords = new Map([
  [2, "two"],
  [3, "three"],
  [4, "four"],
  [5, "five"],
  [6, "six"],
  [7, "seven"],
  [8, "eight"],
  [9, "nine"],
  [11, "eleven"],
  [12, "twelve"],
  [13, "thirteen"],
  [14, "fourteen"],
  [15, "fifteen"],
  [16, "sixteen"],
  [17, "seventeen"],
  [18, "eighteen"],
]);

test("every valid borrow fact has one audited fact-only reading", async () => {
  assert.deepEqual(manifest.narrator, SUITE_NARRATOR_PROVENANCE);
  assert.equal(Object.keys(manifest.cues).length, 36);

  for (let minuend = 11; minuend <= 18; minuend += 1) {
    for (let subtrahend = 2; subtrahend <= 9; subtrahend += 1) {
      const requiresBorrow = minuend % 10 < subtrahend;
      const cueId = `${minuend}-${subtrahend}`;
      const cue = manifest.cues[cueId];

      if (!requiresBorrow) {
        assert.equal(cue, undefined, `${cueId} must not enter the deck`);
        continue;
      }

      assert.ok(cue, `${cueId} exists`);
      assert.equal(cue.file, `${minuend}-minus-${subtrahend}.mp3`);
      assert.equal(
        cue.speechText,
        `${numberWords.get(minuend)} minus ${numberWords.get(subtrahend)}?`,
      );
      assert.doesNotMatch(cue.speechText, /\b(?:what|is|answer)\b/i);
      assert.ok(cue.audioDurationMs >= 1_500, `${cueId} is intelligible`);
      assert.ok(cue.audioDurationMs <= 3_000, `${cueId} stays brisk`);
      assert.equal(cue.minVisualMs, 0);
      assert.equal(cue.lingerMs, 0);
      assert.match(cue.sha256, /^[a-f\d]{64}$/);

      const asset = new URL(cue.file, outputRoot);
      assert.ok((await stat(asset)).size > 10_000, `${cueId} audio exists`);
      const digest = createHash("sha256")
        .update(await readFile(asset))
        .digest("hex");
      assert.equal(digest, cue.sha256, `${cueId} matches its manifest`);
    }
  }
});

test("the listening mode uses the shared local narration player", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  assert.match(adapterSource, /defineGameNarrationManifest/);
  assert.match(adapterSource, /narrationSource\.narrator/);
  assert.doesNotMatch(adapterSource, /https?:\/\//);
  assert.match(pageSource, /createGameNarrationPlayer/);
  assert.match(pageSource, /\.prime\(\)/);
  assert.match(pageSource, /\.dispose\(\)/);
  assert.doesNotMatch(pageSource, /speechSynthesis|SpeechSynthesisUtterance/);
});
