import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_WORLD_STORY } from "../app/math-world/story-content.ts";

test("Oceania's first chapter has an introduction, exactly two reading stops, and a two-page ending", () => {
  assert.deepEqual(Object.keys(FIRST_WORLD_STORY), ["intro", "book1", "book2", "fracture", "appeal"]);
  const pages = Object.values(FIRST_WORLD_STORY);
  assert.equal(new Set(pages.map(page => page.id)).size, 5);
  for (const page of pages) {
    assert.ok(page.title && page.kicker && page.illustration);
    assert.ok(page.paragraphs.length >= 2 && page.paragraphs.length <= 3, `${page.id} stays within the requested 2–3 paragraphs`);
    assert.ok(page.paragraphs.every(paragraph => paragraph.trim().length > 0));
    assert.ok(page.paragraphs.join(" ").split(/\s+/).length <= 130, `${page.id} remains a short read-aloud page`);
  }
});

test("the story preserves the requested chronology and leaves the shadow's identity unknown", () => {
  const prose = key => FIRST_WORLD_STORY[key].paragraphs.join(" ");
  assert.match(prose("intro"), /two little books/);
  assert.match(prose("book1"), /winds.*waves.*archipelagos.*scientists.*Tideheart.*computer.*blue light/s);
  assert.match(prose("book2"), /predict.*guide the winds.*peace/s);
  assert.match(prose("fracture"), /shadow.*spark.*cracks.*bursts apart.*shards/is);
  assert.match(prose("appeal"), /shards.*pieces.*peace/s);
});
