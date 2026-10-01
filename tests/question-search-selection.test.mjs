import assert from "node:assert/strict";
import test from "node:test";
import { MAX_WORKSHEET_QUESTIONS, addWorksheetQuestions, removeWorksheetQuestions, worksheetLimit } from "../lib/question-search/selection.ts";

const q = (id) => ({ id });
test("worksheet selection preserves earlier pages, rank order and unique IDs", () => {
  const selected = addWorksheetQuestions([q("earlier")], [q("first"), q("earlier"), q("second")]);
  assert.deepEqual(selected.map((item) => item.id), ["earlier", "first", "second"]);
  assert.deepEqual(removeWorksheetQuestions(selected, ["first", "second"]).map((item) => item.id), ["earlier"]);
  assert.equal(selected.length, 3, "selection helpers do not mutate the input");
});
test("bulk worksheet limits reject invalid counts and bound image preparation", () => {
  for (const value of ["", "0", "-1", "2.5", "Infinity", "abc", MAX_WORKSHEET_QUESTIONS + 1]) assert.equal(worksheetLimit(value), null);
  assert.equal(worksheetLimit("10"), 10);
  assert.equal(worksheetLimit(MAX_WORKSHEET_QUESTIONS), MAX_WORKSHEET_QUESTIONS);
  const selected = addWorksheetQuestions([], Array.from({ length: 100 }, (_, index) => q(String(index))));
  assert.equal(selected.length, MAX_WORKSHEET_QUESTIONS);
  assert.equal(selected.at(-1).id, String(MAX_WORKSHEET_QUESTIONS - 1));
});
