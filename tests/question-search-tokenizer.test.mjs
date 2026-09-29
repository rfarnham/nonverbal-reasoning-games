import test from "node:test";
import assert from "node:assert/strict";
import { semanticDocuments } from "../scripts/tokenize-question-search.mjs";
import { tokenize } from "../lib/question-search/engine.ts";

test("training text contains the indexed mathematical descriptions and uses the shared tokenizer", () => {
  const corpus = {
    facets: { topics: { fold: "Paper folds" }, strategies: { inverse: "Work backward" } },
    questions: [{ prompt: "The CAFÉ folds 12 sheets.", description: "diagram", structure: "reflection",
      method: "Undo folds", topics: ["fold"], strategies: ["inverse"], answer: "SECRET", id: "PRIVATE-ID" }],
  };
  const [document] = semanticDocuments(corpus);
  assert.deepEqual(tokenize(document), ["cafe", "folds", "12", "sheets", "diagram", "reflection", "undo", "folds", "paper", "folds", "work", "backward"]);
  assert.ok(!document.includes("SECRET"));
  assert.ok(!document.includes("PRIVATE-ID"));
});
