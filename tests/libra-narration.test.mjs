import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  GAME_NARRATION_UNLOCK_SRC,
  SUITE_NARRATOR_PROVENANCE,
} from "../lib/game-narration.ts";

const manifestUrl = new URL(
  "../content/narration/libra-proof.json",
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const adapterSource = await readFile(
  new URL("../app/games/libra/proof-narration.ts", import.meta.url),
  "utf8",
);
const outputRoot = new URL(
  "../public/audio/narration/kokoro-82m-v1-af-heart/",
  import.meta.url,
);

const activeProofCueIds = [
  "substitute",
  "reorient-scale",
  "add-scales",
  "subtract-scales",
  "cancel-matches",
  "regroup-2",
  "regroup-3",
  "regroup-4",
  "split-2",
  "split-3",
  "split-4",
];

const strategyCueIds = [
  "strategy-split-evenly",
  "strategy-cancel-matches",
  "strategy-substitution",
  "strategy-create-combo",
  "strategy-add-scales",
  "strategy-subtract-scales",
];

const confusingCrossReference =
  /\b(?:like splitting|you added scales|works backwards|as before|as we saw|use what you know)\b/i;

test("Libra pins the suite narrator and ships every cue locally", async () => {
  assert.deepEqual(manifest.narrator, SUITE_NARRATOR_PROVENANCE);

  const unlockAsset = new URL(
    `../public${GAME_NARRATION_UNLOCK_SRC}`,
    import.meta.url,
  );
  assert.ok((await stat(unlockAsset)).size > 100, "WebKit unlock clip exists");

  for (const [cueId, cue] of Object.entries(manifest.cues)) {
    assert.match(cue.file, /^[a-z0-9-]+\.mp3$/);
    assert.ok(cue.audioDurationMs >= 3_000, `${cueId} is not rushed`);
    assert.ok(cue.lingerMs >= 900, `${cueId} leaves absorption time`);
    assert.ok(
      cue.caption.length > 0 && cue.speechText.length > cue.caption.length,
    );
    assert.match(cue.sha256, /^[a-f\d]{64}$/);

    const asset = new URL(cue.file, outputRoot);
    assert.ok((await stat(asset)).size > 10_000, `${cueId} audio exists`);
    const digest = createHash("sha256")
      .update(await readFile(asset))
      .digest("hex");
    assert.equal(digest, cue.sha256, `${cueId} matches its manifest hash`);
  }
});

test("every active proof and strategy cue pauses 1.5 seconds after speech", () => {
  for (const cueId of [...activeProofCueIds, ...strategyCueIds]) {
    assert.equal(
      manifest.cues[cueId]?.lingerMs,
      1_500,
      `${cueId} has the fixed post-speech absorption pause`,
    );
  }
});

test("proof steps map to finite local cues and use measured timing", () => {
  assert.match(
    adapterSource,
    /defineGameNarrationManifest\([\s\S]*?clips,[\s\S]*?narrationSource\.narrator/,
  );
  assert.match(adapterSource, /audioDurationMs: cue\.audioDurationMs/);
  assert.match(adapterSource, /Math\.max\(cue\.audioDurationMs, cue\.minVisualMs\)/);
  assert.match(adapterSource, /count !== 2 && count !== 3 && count !== 4/);
  assert.match(
    adapterSource,
    /case "reorient-scale":[\s\S]{0,80}return "reorient-scale"/,
  );
  assert.doesNotMatch(adapterSource, /https?:\/\//);
});

test("every first-time strategy introduction has a slow local Kokoro cue", () => {
  for (const cueId of strategyCueIds) {
    const cue = manifest.cues[cueId];
    assert.ok(cue, `${cueId} exists`);
    assert.ok(cue.audioDurationMs >= 8_000, `${cueId} is deliberately paced`);
    assert.ok(
      cue.minVisualMs >= cue.audioDurationMs,
      `${cueId} keeps the visual through the spoken cue`,
    );
    assert.match(
      cue.speechText,
      /\b(?:rabbit|chick|fox|cat|bear|beetle|scale|tray)s?\b/i,
      `${cueId} explains its pictured loads`,
    );
    assert.match(
      cue.speechText,
      /\b(?:make|remove|replace|circle|split|move|balance)\w*\b/i,
      `${cueId} names the useful action`,
    );
  }

  assert.match(adapterSource, /strategyLessonNarrationCueId/);
  assert.match(adapterSource, /strategyLessonNarrationCaption/);
});

test("narration explains the current action without confusing callbacks", () => {
  for (const [cueId, cue] of Object.entries(manifest.cues)) {
    assert.doesNotMatch(
      `${cue.caption} ${cue.speechText}`,
      confusingCrossReference,
      `${cueId} is self-contained`,
    );
  }
});

test("multi-scale proof narration follows the persistent Use and Working labels", () => {
  for (const cueId of ["add-scales", "subtract-scales"]) {
    const cue = manifest.cues[cueId];
    assert.match(cue.speechText, /\bWorking scale\b/i);
    assert.doesNotMatch(
      `${cue.caption} ${cue.speechText}`,
      /\b(?:first|second) balance\b/i,
      `${cueId} cannot assume a scale's displayed number`,
    );
  }
  assert.match(manifest.cues["add-scales"].speechText, /\bscale marked Use\b/i);
  assert.match(manifest.cues["subtract-scales"].speechText, /\bgold scale\b/i);
});

test("regroup and reorientation narration works for either tray direction", () => {
  for (const cueId of ["regroup-2", "regroup-3", "regroup-4"]) {
    const cue = manifest.cues[cueId];
    assert.match(cue.speechText, /\bhighlighted tray\b/i);
    assert.match(cue.speechText, /\bother tray\b/i);
    assert.doesNotMatch(
      `${cue.caption} ${cue.speechText}`,
      /\b(?:left|right) tray\b/i,
      `${cueId} follows whichever side is highlighted`,
    );
  }

  const reorient = manifest.cues["reorient-scale"];
  assert.match(reorient.speechText, /balanced in either direction/i);
  assert.match(reorient.speechText, /turn it around/i);
  assert.match(reorient.speechText, /trays line up/i);
});
