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
    assert.ok(cue.caption.length > 0 && cue.speechText.length > cue.caption.length);
    assert.match(cue.sha256, /^[a-f\d]{64}$/);

    const asset = new URL(cue.file, outputRoot);
    assert.ok((await stat(asset)).size > 10_000, `${cueId} audio exists`);
    const digest = createHash("sha256")
      .update(await readFile(asset))
      .digest("hex");
    assert.equal(digest, cue.sha256, `${cueId} matches its manifest hash`);
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
  assert.doesNotMatch(adapterSource, /https?:\/\//);
});
