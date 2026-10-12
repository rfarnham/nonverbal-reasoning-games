import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { FIRST_WORLD_STORY } from "../app/math-world/story-content.ts";
import { VOYAGE_CHAPTERS } from "../app/math-world/voyage-story-content.ts";

test("the independent voyage recovers exactly 32 summit shards before reforging and ascent", () => {
  const recoveries = VOYAGE_CHAPTERS.filter(page => page.shardWorld !== undefined);
  assert.deepEqual(recoveries.map(page => page.shardWorld), Array.from({ length: 32 }, (_, index) => index + 1));
  assert.equal(new Set(VOYAGE_CHAPTERS.map(page => page.id)).size, VOYAGE_CHAPTERS.length);
  assert.deepEqual(VOYAGE_CHAPTERS.slice(32).map(page => page.id), ["oceania-voyage-reforging", "oceania-voyage-ascent"]);
  for (const page of VOYAGE_CHAPTERS) {
    assert.equal(page.paragraphs.length, 2);
    assert.ok(page.paragraphs.join(" ").split(/\s+/).length <= 100, `${page.id} remains a brief optional scene`);
    assert.doesNotMatch(page.paragraphs.join(" "), /curriculum|assessment|accuracy|questions|puzzles/i);
  }
});

test("the student's existing opening, books and sundering remain exactly as shipped", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(FIRST_WORLD_STORY)).digest("hex"),
    "3ab88d33bd61e2122a1409ae760f67a9f9fed050272f57597cd38b7606554f96");
});

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
