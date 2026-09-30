import assert from "node:assert/strict";
import test from "node:test";
import { BOSS_STORIES } from "../app/math-world/boss-story-content.ts";
import { DANGER_STORIES } from "../app/math-world/danger-content.ts";
import { createDangerState, ensureDangerPacket } from "../app/math-world/danger-engine.ts";
import { GLOBE_DANGER_LOCATIONS } from "../app/math-world/globe-danger-locations.ts";
import { FIRST_WORLD_STORY } from "../app/math-world/story-content.ts";
import { createStoryProgress } from "../app/math-world/story-progress.ts";
import { storySoFar, VOYAGE_GLOSSARY } from "../app/math-world/voyage-reading.ts";

const NOW = "2026-09-30T23:00:00.000Z";
const freshDangers = () => createDangerState("story-reader");
const ids = (story, dangers = freshDangers()) => storySoFar(story, dangers).map(page => page.id);
const pageIds = pages => pages.map(page => page.id);
const completeChapter = () => ({ ...createStoryProgress(), introSeen: true, readBooks: [0, 1], ending: "complete" });

test("a fresh voyage has no review pages, including in QA", () => {
  const story = createStoryProgress();
  assert.deepEqual(ids(story), []);
  assert.deepEqual(ids(story, createDangerState("story-reader", true)), []);
});

test("opening stories are included only after their own acknowledgement", () => {
  const fresh = createStoryProgress();
  assert.deepEqual(ids({ ...fresh, introSeen: true }), [FIRST_WORLD_STORY.intro.id]);
  assert.deepEqual(ids({ ...fresh, readBooks: [1] }), [FIRST_WORLD_STORY.book2.id]);
  assert.deepEqual(ids({ ...fresh, readBooks: [1, 0, 1, 9] }), pageIds([FIRST_WORLD_STORY.book1, FIRST_WORLD_STORY.book2]));
  assert.deepEqual(ids(completeChapter()), pageIds(Object.values(FIRST_WORLD_STORY)));
});

test("the shattering and appeal checkpoints do not reveal the unread call for help", () => {
  for (const ending of ["shattering", "appeal"]) {
    const result = ids({ ...createStoryProgress(), ending });
    assert.deepEqual(result, [FIRST_WORLD_STORY.fracture.id]);
    assert.ok(!result.includes(FIRST_WORLD_STORY.appeal.id));
  }
  assert.deepEqual(ids({ ...createStoryProgress(), ending: "complete" }), pageIds([FIRST_WORLD_STORY.fracture, FIRST_WORLD_STORY.appeal]));
});

test("an encounter can be read before its packet exists without exposing future stories", () => {
  const story = { ...createStoryProgress(), readEncounters: ["danger-08"] };
  assert.deepEqual(ids(story), [DANGER_STORIES.fog.id]);
  assert.deepEqual(ids(story, createDangerState("story-reader", true)), [DANGER_STORIES.fog.id]);
  assert.deepEqual(ids({ ...story, readEncounters: ["boss-2025"] }), [BOSS_STORIES["boss-2025"].id]);
});

test("legacy read or completed packets preserve their story, while merely prepared packets do not", () => {
  let dangers = freshDangers();
  for (const number of [2, 4, 6]) dangers = ensureDangerPacket(dangers, {
    dangerId: `danger-${String(number).padStart(2, "0")}`, afterWorldNumber: number, now: NOW,
  });
  dangers = { ...dangers, packets: {
    ...dangers.packets,
    "danger-02": { ...dangers.packets["danger-02"], briefingRead: true },
    "danger-04": { ...dangers.packets["danger-04"], completedAt: NOW },
  } };
  const legacyStory = { version: 1, introSeen: false, readBooks: [], ending: "unseen" };
  assert.deepEqual(ids(legacyStory, dangers), pageIds([DANGER_STORIES.squall, DANGER_STORIES.kraken]));
});

test("story pages follow voyage order and repeated danger kinds appear only once", () => {
  const story = { ...completeChapter(), readEncounters: [
    "boss-2026", ...GLOBE_DANGER_LOCATIONS.map(danger => danger.id).reverse(), "boss-2025", "danger-02",
  ] };
  assert.deepEqual(ids(story), pageIds([
    ...Object.values(FIRST_WORLD_STORY),
    DANGER_STORIES.squall, DANGER_STORIES.kraken, DANGER_STORIES.maelstrom,
    DANGER_STORIES.fog, DANGER_STORIES.reef, DANGER_STORIES.icebergs,
    BOSS_STORIES["boss-2025"], BOSS_STORIES["boss-2026"],
  ]));
});

test("a later repeated danger does not backdate a page to an earlier unread crossing", () => {
  const story = { ...createStoryProgress(), readEncounters: ["danger-32", "boss-2025", "boss-2026", "danger-22"] };
  assert.deepEqual(ids(story), pageIds([
    BOSS_STORIES["boss-2025"], DANGER_STORIES.fog, DANGER_STORIES.icebergs, BOSS_STORIES["boss-2026"],
  ]));
});

test("unknown markers, page IDs and invented packets cannot unlock story pages", () => {
  const story = { ...createStoryProgress(), readEncounters: [
    "danger-01", "danger-99", "boss-2024", "oceania-call", "oceania-danger-kraken", "unknown",
  ] };
  const dangers = { ...freshDangers(), packets: {
    "danger-99": { briefingRead: true, completedAt: NOW },
    "boss-2025": { briefingRead: true, completedAt: NOW },
  } };
  assert.deepEqual(ids(story, dangers), []);
});

test("review selection cannot change reading history, packet identity, answers or mistake records", () => {
  const story = { ...completeChapter(), readEncounters: ["danger-02", "boss-2025"] };
  const dangers = ensureDangerPacket(freshDangers(), { dangerId: "danger-02", afterWorldNumber: 2, now: NOW });
  const before = structuredClone({ story, dangers });
  const packet = dangers.packets["danger-02"];
  const freeze = value => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  freeze(story); freeze(dangers);
  const pages = storySoFar(story, dangers);
  pages.reverse(); pages.pop();
  assert.deepEqual({ story, dangers }, before);
  assert.equal(dangers.packets["danger-02"], packet);
  assert.deepEqual(ids(story, dangers), pageIds([
    ...Object.values(FIRST_WORLD_STORY), DANGER_STORIES.squall, BOSS_STORIES["boss-2025"],
  ]));
});

test("the glossary stays short, alphabetical, grounded in the stories and friendly to young readers", () => {
  assert.ok(VOYAGE_GLOSSARY.length >= 16 && VOYAGE_GLOSSARY.length <= 20);
  const terms = VOYAGE_GLOSSARY.map(entry => entry.term);
  assert.equal(new Set(terms).size, terms.length);
  assert.deepEqual(terms, [...terms].sort((a, b) => a.localeCompare(b)));
  const storyText = [...Object.values(FIRST_WORLD_STORY), ...Object.values(DANGER_STORIES), ...Object.values(BOSS_STORIES)]
    .flatMap(page => page.paragraphs).join(" ").toLowerCase();
  for (const entry of VOYAGE_GLOSSARY) {
    assert.ok(storyText.includes(entry.term.toLowerCase()), `${entry.term} is introduced in the voyage`);
    assert.ok(entry.definition.split(/\s+/).length <= 18, `${entry.term} has a concise definition`);
    assert.equal(entry.definition.match(/[.!?]/g)?.length, 1, `${entry.term} uses one sentence`);
    assert.ok(!/Tideheart|shatter|destroyed/i.test(entry.definition), "the field guide does not spoil the plot");
  }
  const definition = term => VOYAGE_GLOSSARY.find(entry => entry.term === term)?.definition;
  assert.match(definition("Squall"), /sudden.*short.*wind/i);
  assert.match(definition("Tide"), /rise and fall/i);
  assert.match(definition("Octahedron"), /eight triangular faces/i);
  assert.match(definition("Kraken"), /legendary/i);
  assert.match(definition("Coral"), /animals/i);
});
