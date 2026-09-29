import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { workbookArtwork, workbookQuestions } from "../app/math-world/workbook.ts";
import { WORLD_DEFINITIONS, WORLD_QUESTIONS, QUESTIONS_BY_STOP } from "../app/math-world/world-data.ts";

test("each workbook follows the playable question order and restarts numbering at each stop", () => {
  for (const world of WORLD_DEFINITIONS) {
    const entries = workbookQuestions(world);
    assert.deepEqual(entries.map(({ question }) => question.id), WORLD_QUESTIONS.filter(question => question.worldId === world.id).map(question => question.id));
    assert.equal(entries.length, world.questionCount);
    assert.deepEqual(entries.map(({ stopIndex }) => stopIndex), world.stopIds.flatMap((id, stopIndex) => QUESTIONS_BY_STOP.get(id).map(() => stopIndex)));
    assert.deepEqual(entries.map(({ questionIndex }) => questionIndex), world.stopIds.flatMap(id => QUESTIONS_BY_STOP.get(id).map((_, questionIndex) => questionIndex)));
  }
});

test("workbooks prefer print originals and retain each complete reviewed rectangle", async () => {
  const { crops } = JSON.parse(await readFile(new URL("../app/math-world/workbook-image-crops.json", import.meta.url), "utf8"));
  let originals = 0;
  for (const question of WORLD_QUESTIONS) {
    const crop = crops[question.id];
    const expectedAsset = crop?.printAsset ?? question.asset;
    const artwork = workbookArtwork(question);
    assert.deepEqual(artwork.asset, expectedAsset, `Wrong print source: ${question.id}`);
    // Every point in the source has the same coordinate system, including
    // tall questions whose prompt and choices were previously split apart.
    assert.deepEqual(
      [artwork.left, artwork.top, artwork.right, artwork.bottom],
      [crop?.sourceLeft ?? 0, crop?.sourceTop ?? 0, crop?.sourceRight ?? expectedAsset.width, crop?.sourceBottom ?? expectedAsset.height],
      `The complete reviewed question must stay intact: ${question.id}`,
    );
    if (crop?.printAsset) {
      originals++;
      assert.notEqual(artwork.asset.src, question.asset.src, `Original must replace the game card: ${question.id}`);
    }
  }
  assert.ok(originals >= 335, "Reviewed original print assets must not silently fall back to reconstructed game cards");
});

test("World 1 question 2 prints the original publisher's complete question", () => {
  const world = WORLD_DEFINITIONS.find(world => world.number === 1);
  const { question } = workbookQuestions(world)[1];
  assert.equal(question.id, "oasis-online-2022-grades-1-2-q01");
  const { asset, left, top, right, bottom } = workbookArtwork(question);
  assert.equal(asset.src, "/math-world/workbook-questions/oasis-online-2022-grades-1-2-q01-original.webp");
  assert.deepEqual([left, top, right, bottom], [0, 0, asset.width, asset.height]);
  assert.equal(asset.originalSource.questionId, "cyprus-2022-grades-1-2-part-single-q01");
});

test("printing rejects changed or unreviewed generated source cards", () => {
  const question = WORLD_QUESTIONS.find(question => question.id === "oasis-online-2022-grades-1-2-q01");
  assert.ok(question, "The reported World 1 question must remain covered");
  assert.throws(() => workbookArtwork({ ...question, asset: { ...question.asset, sha256: "changed-source" } }), /artwork has changed/);
  assert.throws(() => workbookArtwork({ ...question, id: "oasis-online-unreviewed-question" }), /crop needs an update/);
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
