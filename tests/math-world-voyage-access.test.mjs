import assert from "node:assert/strict";
import test from "node:test";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { WORLD_DEFINITIONS } from "../app/math-world/world-data.ts";
import { BOSS_CHALLENGES } from "../app/math-world/boss-challenges.ts";
import { createBossProgress, setBossAnswer, submitBossAnswers } from "../app/math-world/boss-progress.ts";
import { DANGERS } from "../app/math-world/danger-definitions.ts";
import { DANGER_STORIES } from "../app/math-world/danger-content.ts";
import { BOSS_STORIES } from "../app/math-world/boss-story-content.ts";
import { createDangerState, ensureDangerPacket } from "../app/math-world/danger-engine.ts";
import { createStoryProgress, markVoyageChapterRead, recoveredShardWorlds } from "../app/math-world/story-progress.ts";
import { VOYAGE_CHAPTERS } from "../app/math-world/voyage-story-content.ts";
import { storySoFar } from "../app/math-world/voyage-reading.ts";
import { availableStorySoFar, canReadVoyageChapter, eligibleStoryProgress, nextAvailableVoyageChapter, unlockedVoyageChapters } from "../app/math-world/voyage-access.ts";

const now = "2026-10-12T12:00:00.000Z";
const player = "voyage-access-player";
const chapterId = number => `oceania-voyage-${String(number).padStart(2, "0")}`;
const opening = () => ({ ...createStoryProgress(), introSeen: true, readBooks: [0, 1], ending: "complete" });
const finishedThrough = number => ({ ...createInitialProgress(),
  completedStopIds: WORLD_DEFINITIONS.filter(world => world.number <= number).flatMap(world => world.stopIds) });

// These are persisted completion fixtures. Danger engine tests cover the answer
// submission transitions that produce them; no reading action creates one.
function dangersThrough(number, qa = false) {
  let state = createDangerState(player, qa);
  for (const danger of DANGERS.filter(candidate => candidate.afterWorld <= number)) {
    state = ensureDangerPacket(state, { dangerId: danger.id, afterWorldNumber: danger.afterWorld, now });
    state = { ...state, packets: { ...state.packets,
      [danger.id]: { ...state.packets[danger.id], briefingRead: true, startedAt: now, completedAt: now } } };
  }
  return state;
}
function bossesThrough(number, qa = false) {
  let state = createBossProgress(player, qa);
  for (const boss of BOSS_CHALLENGES.filter(candidate => candidate.afterWorld <= number)) {
    for (let index = 0; index < boss.questionCount; index++) state = setBossAnswer(state, boss.id, index, index % 5);
    state = submitBossAnswers(state, boss.id, now);
  }
  return state;
}
const completedStory = () => VOYAGE_CHAPTERS.reduce((story, chapter) => markVoyageChapterRead(story, chapter.id), opening());

test("the continuation needs the existing sundering and every stop of its archipelago", () => {
  const dangers = dangersThrough(32), bosses = bossesThrough(32);
  for (const ending of ["unseen", "shattering", "appeal"]) {
    assert.deepEqual(unlockedVoyageChapters({ ...opening(), ending }, finishedThrough(32), dangers, bosses), []);
  }
  assert.equal(nextAvailableVoyageChapter(opening(), finishedThrough(0), dangers, bosses), undefined);
  assert.equal(nextAvailableVoyageChapter(opening(), finishedThrough(1), dangers, bosses)?.id, chapterId(1));
  const partial = { ...finishedThrough(2), completedStopIds: finishedThrough(2).completedStopIds.slice(0, -1) };
  assert.equal(canReadVoyageChapter(opening(), partial, dangers, bosses, chapterId(2)), false);
  assert.equal(canReadVoyageChapter(opening(), finishedThrough(2), dangers, bosses, chapterId(2)), true);
});

test("a future map selection, attempted stop or scattered later completion never unlocks the story", () => {
  const late = WORLD_DEFINITIONS[19];
  const progress = { ...finishedThrough(1), selectedWorldId: late.id,
    completedStopIds: [...finishedThrough(1).completedStopIds, ...late.stopIds],
    stopAttempts: { [WORLD_DEFINITIONS[1].stopIds[0]]: {
      questionIndex: 0, phase: "answering", selectedIndex: null, firstTryCorrect: {}, solvedQuestionIds: [],
    } } };
  assert.deepEqual(unlockedVoyageChapters(opening(), progress, dangersThrough(32, true), bossesThrough(32, true))
    .map(chapter => chapter.id), [chapterId(1)], "QA packet flags do not grant missing completed stops");
  const gap = { ...finishedThrough(20), completedStopIds: finishedThrough(20).completedStopIds
    .filter(id => id !== WORLD_DEFINITIONS[4].stopIds[0]) };
  assert.equal(canReadVoyageChapter(opening(), gap, dangersThrough(32), bossesThrough(32), chapterId(20)), false);
});

test("each chapter waits for the submitted crossings on the way to its archipelago", () => {
  const story = opening(), progress = finishedThrough(4), bosses = bossesThrough(0);
  const empty = dangersThrough(0);
  assert.equal(canReadVoyageChapter(story, progress, empty, bosses, chapterId(2)), true);
  assert.equal(canReadVoyageChapter(story, progress, empty, bosses, chapterId(3)), false);
  const prepared = ensureDangerPacket(empty, { dangerId: "danger-02", afterWorldNumber: 2, now });
  const read = { ...prepared, packets: { ...prepared.packets,
    "danger-02": { ...prepared.packets["danger-02"], briefingRead: true, startedAt: now } } };
  assert.equal(canReadVoyageChapter(story, progress, read, bosses, chapterId(3)), false,
    "reading, preparing, printing or starting the packet is insufficient");
  assert.equal(canReadVoyageChapter(story, progress, dangersThrough(2), bosses, chapterId(3)), true);
  assert.equal(canReadVoyageChapter(story, progress, dangersThrough(2), bosses, chapterId(4)), true,
    "the ordinary chapter precedes the crossing beyond its own island");
});

test("the two storm chapters require the same-boundary danger and submitted workbook answers", () => {
  for (const number of [16, 32]) {
    const progress = finishedThrough(number), priorBosses = bossesThrough(number - 1);
    const boss = BOSS_CHALLENGES.find(candidate => candidate.afterWorld === number);
    assert.equal(canReadVoyageChapter(opening(), progress, dangersThrough(number - 1), bossesThrough(number), chapterId(number)), false);
    assert.equal(canReadVoyageChapter(opening(), progress, dangersThrough(number), priorBosses, chapterId(number)), false);
    let draft = priorBosses;
    for (let index = 0; index < boss.questionCount; index++) draft = setBossAnswer(draft, boss.id, index, 0);
    assert.equal(canReadVoyageChapter(opening(), progress, dangersThrough(number), draft, chapterId(number)), false,
      "even a complete answer draft waits for Submit");
    const submitted = submitBossAnswers(draft, boss.id, now);
    assert.equal(canReadVoyageChapter(opening(), progress, dangersThrough(number), submitted, chapterId(number)), true);
    if (number === 16) assert.equal(canReadVoyageChapter(opening(), finishedThrough(17), dangersThrough(16), priorBosses, chapterId(17)), false);
  }
});

test("Read on stops at earned progress and island books may revisit any earned chapter", () => {
  const progress = finishedThrough(3), dangers = dangersThrough(2), bosses = bossesThrough(0);
  let story = markVoyageChapterRead(opening(), chapterId(3));
  assert.equal(nextAvailableVoyageChapter(story, progress, dangers, bosses)?.id, chapterId(1));
  for (const number of [1, 2]) story = markVoyageChapterRead(story, chapterId(number));
  assert.equal(nextAvailableVoyageChapter(story, progress, dangers, bosses), undefined);
  assert.equal(canReadVoyageChapter(story, progress, dangers, bosses, chapterId(3)), true);
  assert.equal(canReadVoyageChapter(story, progress, dangers, bosses, chapterId(4)), false);
  assert.equal(canReadVoyageChapter(story, progress, dangers, bosses, "oceania-voyage-99"), false);
});

test("both finales need all work plus the preceding shard and reforge acknowledgements", () => {
  const progress = finishedThrough(32), dangers = dangersThrough(32), bosses = bossesThrough(32);
  let story = opening();
  assert.equal(canReadVoyageChapter(story, progress, dangers, bosses, "oceania-voyage-reforging"), false);
  for (let number = 1; number <= 32; number++) story = markVoyageChapterRead(story, chapterId(number));
  assert.equal(nextAvailableVoyageChapter(story, progress, dangers, bosses)?.id, "oceania-voyage-reforging");
  assert.equal(canReadVoyageChapter(story, progress, dangers, bosses, "oceania-voyage-ascent"), false);
  story = markVoyageChapterRead(story, "oceania-voyage-reforging");
  assert.equal(nextAvailableVoyageChapter(story, progress, dangers, bosses)?.id, "oceania-voyage-ascent");
  for (const [lessProgress, lessDangers, lessBosses] of [
    [finishedThrough(31), dangers, bosses], [progress, dangersThrough(30), bosses], [progress, dangers, bossesThrough(16)],
  ]) {
    for (const id of ["oceania-voyage-reforging", "oceania-voyage-ascent"]) {
      assert.equal(canReadVoyageChapter(story, lessProgress, lessDangers, lessBosses, id), false);
    }
  }
});

test("previous unrestricted reading flags cannot expose spoilers, shards or recaps before earned access", () => {
  const story = completedStory(), progress = finishedThrough(1), dangers = dangersThrough(0), bosses = bossesThrough(0);
  const before = structuredClone({ story, progress, dangers, bosses });
  const eligible = eligibleStoryProgress(story, progress, dangers, bosses);
  assert.deepEqual(eligible.readChapters, [chapterId(1)]);
  assert.deepEqual(recoveredShardWorlds(eligible), [1]);
  assert.deepEqual(storySoFar(eligible, dangers).filter(page => page.id.startsWith("oceania-voyage-")).map(page => page.id), [chapterId(1)]);
  assert.equal(nextAvailableVoyageChapter(story, progress, dangers, bosses), undefined);
  assert.deepEqual({ story, progress, dangers, bosses }, before, "filtering is a read-only view of every ledger");
  assert.equal(story.readChapters.length, 34, "the original history is retained for later earned access");
  const earned = eligibleStoryProgress(story, finishedThrough(32), dangersThrough(32), bossesThrough(32));
  assert.equal(earned, story);
  assert.equal(recoveredShardWorlds(earned).length, 32);
});

test("the recap hides unreachable encounter history and legacy briefings without rewriting either ledger", () => {
  const story = { ...completedStory(), readEncounters: [...DANGERS, ...BOSS_CHALLENGES].map(encounter => encounter.id) };
  const dangers = dangersThrough(32, true), bosses = bossesThrough(32, true), progress = finishedThrough(2);
  const before = structuredClone({ story, dangers, bosses, progress });
  const pages = availableStorySoFar(story, progress, dangers, bosses);
  const dangerPageIds = new Set(Object.values(DANGER_STORIES).map(page => page.id));
  const firstDanger = DANGERS.find(danger => danger.afterWorld === 2);
  assert.deepEqual(pages.filter(page => dangerPageIds.has(page.id)).map(page => page.id), [DANGER_STORIES[firstDanger.kind].id]);
  assert.equal(pages.some(page => Object.values(BOSS_STORIES).some(bossPage => bossPage.id === page.id)), false);
  assert.deepEqual(pages.filter(page => page.id.startsWith("oceania-voyage-")).map(page => page.id), [chapterId(1), chapterId(2)]);
  assert.deepEqual({ story, dangers, bosses, progress }, before);

  const legacy = { ...story, readEncounters: [] };
  const briefing = { ...dangers, packets: { ...dangers.packets,
    [firstDanger.id]: { ...dangers.packets[firstDanger.id], completedAt: null, startedAt: null } } };
  assert(availableStorySoFar(legacy, progress, briefing, bosses).some(page => page.id === DANGER_STORIES[firstDanger.kind].id),
    "the current reachable briefing remains in the recap before answers are submitted");
  const waiting = availableStorySoFar(story, finishedThrough(16), dangersThrough(14), bossesThrough(0));
  assert.equal(waiting.some(page => page.id === BOSS_STORIES["boss-2025"].id), false,
    "the same-boundary danger must be submitted before the storm introduction is reachable");
  const ready = availableStorySoFar(story, finishedThrough(16), dangersThrough(16), bossesThrough(0));
  assert(ready.some(page => page.id === BOSS_STORIES["boss-2025"].id),
    "an earned storm briefing is available before that storm's answer submission");
  assert.equal(ready.some(page => page.id === BOSS_STORIES["boss-2026"].id), false);
});
