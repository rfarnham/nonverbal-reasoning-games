import assert from "node:assert/strict";
import test from "node:test";
import { dangerWorkbookQuestions, printDangerWorkbook, workbookArtwork } from "../app/math-world/workbook.ts";
import { WORLD_DEFINITIONS, WORLD_QUESTIONS } from "../app/math-world/world-data.ts";

test("a danger workbook preserves its saved reinforcement order across worlds in one numbered stop", () => {
  const ids = [
    "oasis-online-2022-grades-1-2-q01",
    WORLD_QUESTIONS.find(question => question.worldId === WORLD_DEFINITIONS[16].id).id,
    WORLD_QUESTIONS.find(question => question.worldId === WORLD_DEFINITIONS[2].id).id,
  ];
  const questions = ids.map(id => WORLD_QUESTIONS.find(question => question.id === id));
  const packet = dangerWorkbookQuestions("danger-after-04", questions);
  assert.deepEqual(packet.map(entry => entry.question.id), ids);
  assert.deepEqual(packet.map(entry => entry.questionNumber), [1, 2, 3]);
  assert.ok(packet.every(entry => entry.stopId === "danger-after-04" && entry.questionCount === 3));
  // Selection must not rewrite the canonical question or its game asset to
  // obtain print art. The same reviewed original is used by both workbooks.
  packet.forEach((entry, index) => assert.equal(entry.question, questions[index]));
  const artwork = workbookArtwork(packet[0].question);
  assert.equal(artwork.asset.src, "/math-world/workbook-questions/oasis-online-2022-grades-1-2-q01-original.webp");
  assert.deepEqual([artwork.left, artwork.top, artwork.right, artwork.bottom], [0, 0, artwork.asset.width, artwork.asset.height]);
  assert.notEqual(artwork.asset.src, packet[0].question.asset.src);
});

test("invalid danger packet sizes are rejected before a browser print window is opened", async () => {
  await assert.rejects(printDangerWorkbook("Squall", "danger-after-02", []), /between 1 and 24/);
  await assert.rejects(printDangerWorkbook("Squall", "danger-after-02", WORLD_QUESTIONS.slice(0, 25)), /between 1 and 24/);
  const complete = dangerWorkbookQuestions("danger-after-02", WORLD_QUESTIONS.slice(0, 24));
  assert.equal(complete.length, 24);
  assert.equal(complete[23].questionNumber, 24);
  assert.equal(complete[23].questionCount, 24);
});
