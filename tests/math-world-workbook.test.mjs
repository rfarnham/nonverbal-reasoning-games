import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { workbookQuestions } from "../app/math-world/workbook.ts";
import { WORLD_DEFINITIONS, WORLD_QUESTIONS } from "../app/math-world/world-data.ts";

test("each workbook follows the playable question order and restarts numbering at each stop", () => {
  for (const world of WORLD_DEFINITIONS) {
    const entries = workbookQuestions(world);
    assert.deepEqual(entries.map(({ question }) => question.id), WORLD_QUESTIONS.filter(question => question.worldId === world.id).map(question => question.id));
    assert.equal(entries.length, 24);
    assert.deepEqual(entries.map(({ stopIndex }) => stopIndex), Array.from({ length: 24 }, (_, index) => Math.floor(index / 6)));
    assert.deepEqual(entries.map(({ questionIndex }) => questionIndex), Array.from({ length: 24 }, (_, index) => index % 6));
  }
});

test("workbook image bounds stay bound to the approved crops and exclude captured footers", async () => {
  const { crops } = JSON.parse(await readFile(new URL("../app/math-world/workbook-image-crops.json", import.meta.url), "utf8"));
  const questions = new Map(WORLD_QUESTIONS.map(question => [question.id, question]));
  for (const question of WORLD_QUESTIONS.filter(question => question.id.startsWith("oasis-online-"))) {
    assert.ok(crops[question.id], `Missing reviewed footer boundary: ${question.id}`);
  }
  for (const [id, crop] of Object.entries(crops)) {
    const question = questions.get(id);
    assert.ok(question, `Unrecognized crop: ${id}`);
    assert.equal(crop.assetSha256, question.asset.sha256, `Changed original needs a new crop review: ${id}`);
    const asset = crop.printAsset ?? question.asset;
    if (crop.printAsset) {
      assert.match(asset.src, /^\/math-world\/workbook-questions\/[a-z0-9.-]+\.(?:png|webp)$/);
      const bytes = await readFile(new URL(`../public${asset.src}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, id);
    }
    assert.ok(Number.isInteger(crop.sourceTop) && crop.sourceTop >= 0 && crop.sourceTop < crop.sourceBottom, id);
    assert.ok((crop.sourceLeft ?? 0) >= 0 && (crop.sourceRight ?? asset.width) <= asset.width && (crop.sourceRight ?? asset.width) > (crop.sourceLeft ?? 0), id);
    assert.ok(Number.isInteger(crop.sourceBottom) && crop.sourceBottom > 0 && crop.sourceBottom <= asset.height, id);
    if (crop.headerBottom !== undefined) {
      assert.ok(Number.isInteger(crop.headerBottom) && crop.headerBottom > crop.sourceTop && crop.headerBottom < crop.sourceBottom, id);
    }
  }
  // This particular capture has an answer note below the source question.
  // The reviewed image boundary must never expand back into that footer.
  assert.equal(crops["oasis-online-2024-grades-1-2-q05"].sourceBottom, 745);
});
