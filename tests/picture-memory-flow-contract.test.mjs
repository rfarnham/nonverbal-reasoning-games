import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/games/picture-memory/page.tsx", import.meta.url);

test("Picture Memory's automatic round flow has no manual study, check, or next controls", async () => {
  const source = await readFile(pageUrl, "utf8");
  assert.doesNotMatch(source, /I[’']m ready|Check answer|["']Next["']/);
  assert.doesNotMatch(source, /onClick=\{submitSelection\}/);
  assert.match(source, /useVisibleTimer\(/);
  assert.match(source, /selected\.length === round\.study\.length/);
  assert.match(source, /const CORRECT_REVEAL_MS = 900;/);
  assert.match(source, /const WRONG_REVIEW_MS = 900;/);
  assert.doesNotMatch(source, /REDUCED_CORRECT_REVEAL_MS|REDUCED_WRONG_REVIEW_MS/);
});

test("Picture Memory's wrong-answer feedback preserves the remaining memory challenge", async () => {
  const source = await readFile(pageUrl, "utf8");
  const feedback = /\{phase === "wrong-review" \? \(([\s\S]*?)\) : phase === "correct-reveal"/.exec(source)?.[1];
  assert.ok(feedback, "Wrong feedback must remain an explicit inspectable state.");
  assert.match(feedback, /× Try again/);
  assert.doesNotMatch(feedback, /selectionFeedback|PictureRow|round\.study|missed|extra/);
  const selectedTreatment = /const wrong = ([^;]+);/.exec(source)?.[1];
  assert.ok(selectedTreatment);
  assert.doesNotMatch(selectedTreatment, /round\.study|includes\(/,
    "The attempted group must not distinguish which individual pictures were correct.");
});
