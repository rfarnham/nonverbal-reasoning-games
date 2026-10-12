import assert from "node:assert/strict";
import test from "node:test";
import { BOSS_CHALLENGES } from "../app/math-world/boss-challenges.ts";
import { bossAttempt, bossStorageKey, createBossProgress, hasSubmittedBoss, mergeBossProgress, readBossProgress, setBossAnswer, submitBossAnswers, submittedBossIds, writeBossProgress } from "../app/math-world/boss-progress.ts";

const now = "2026-10-12T12:00:00.000Z";
const boss = BOSS_CHALLENGES[0];
const spiral = Boolean(boss);
const answered = (state = createBossProgress("child-a"), id = boss.id, count = 24) => Array.from({ length: count }).reduce((current, _, index) => setBossAnswer(current, id, index, index % 5), state);
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("storm drafts resume every original A–E answer without clearing the crossing", { skip: !spiral }, () => {
  const storage = memoryStorage();
  const blank = createBossProgress("child-a");
  assert.deepEqual(bossAttempt(blank, boss.id).answers, Array(24).fill(null));
  const draft = answered(blank, boss.id, 11);
  assert.equal(writeBossProgress(draft, storage), true);
  const loaded = readBossProgress("child-a", false, storage);
  assert.deepEqual(loaded, draft);
  assert.deepEqual(bossAttempt(loaded, boss.id).answers.slice(0, 11), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]);
  assert.equal(hasSubmittedBoss(loaded, boss.id), false);
  assert.equal(submitBossAnswers(loaded, boss.id, now), loaded);
  assert.deepEqual(blank.attempts, {}, "immutable answer edits do not alter the starting progress");
});

test("all24 answers require explicit submission, with no inferred correctness or score gate", { skip: !spiral }, () => {
  const draft = answered();
  assert.equal(hasSubmittedBoss(draft, boss.id), false);
  assert.deepEqual(submittedBossIds(draft), []);
  const submitted = submitBossAnswers(draft, boss.id, now);
  assert.equal(hasSubmittedBoss(submitted, boss.id), true);
  assert.deepEqual(submittedBossIds(submitted), [boss.id]);
  assert.equal(submitBossAnswers(submitted, boss.id, "2026-11-01T12:00:00.000Z"), submitted, "submitting twice preserves the original record");
  assert.equal(setBossAnswer(submitted, boss.id, 0, 4), submitted, "submitted answers become read-only");
  assert.deepEqual(bossAttempt(submitted, boss.id).answers, bossAttempt(draft, boss.id).answers);
  assert.equal(bossAttempt(submitted, boss.id).submittedAt, now);
});

test("invalid choices, question indices, dates and unknown storms cannot create completion", { skip: !spiral }, () => {
  const blank = createBossProgress("child-a");
  for (const index of [-1, 24, 2.5, NaN, Infinity]) assert.equal(setBossAnswer(blank, boss.id, index, 0), blank);
  for (const answer of [-1, 5, 1.5, NaN, Infinity, "A", null]) assert.equal(setBossAnswer(blank, boss.id, 0, answer), blank);
  assert.equal(setBossAnswer(blank, "boss-unknown", 0, 0), blank);
  const draft = answered();
  assert.equal(submitBossAnswers(draft, "boss-unknown", now), draft);
  assert.equal(submitBossAnswers(draft, boss.id, "not a date"), draft);
  assert.equal(hasSubmittedBoss({ ...blank, attempts: { "boss-unknown": { answers: Array(24).fill(0), submittedAt: now } } }, "boss-unknown"), false);
  for (const answers of [[], Array(23).fill(0), Array(25).fill(0), Array(24).fill(null), Array(24), [...Array(23).fill(0), 5]]) {
    const invalid = { ...blank, attempts: { [boss.id]: { answers, submittedAt: now } } };
    assert.equal(hasSubmittedBoss(invalid, boss.id), false, "a stray timestamp never clears an incomplete answer sheet");
    assert.equal(submitBossAnswers(invalid, boss.id, now), invalid);
  }
});

test("stored submissions are validated and a corrupt choice becomes an editable missing answer", { skip: !spiral }, () => {
  const storage = memoryStorage();
  const saved = submitBossAnswers(answered(), boss.id, now);
  assert.equal(writeBossProgress(saved, storage), true);
  assert.deepEqual(readBossProgress("child-a", false, storage), saved);
  const raw = structuredClone(saved);
  raw.attempts[boss.id].answers[7] = "C";
  raw.attempts["boss-unknown"] = { answers: Array(24).fill(0), submittedAt: now };
  storage.setItem(bossStorageKey("child-a"), JSON.stringify(raw));
  const repaired = readBossProgress("child-a", false, storage);
  assert.equal(bossAttempt(repaired, boss.id).answers[7], null);
  assert.equal(bossAttempt(repaired, boss.id).submittedAt, undefined);
  assert.equal(bossAttempt(repaired, boss.id).answers.filter(answer => answer !== null).length, 23);
  assert.equal(hasSubmittedBoss(repaired, boss.id), false);
  assert.equal(repaired.attempts["boss-unknown"], undefined);
  assert.equal(hasSubmittedBoss(submitBossAnswers(setBossAnswer(repaired, boss.id, 7, 2), boss.id, now), boss.id), true);
});

test("normal play, QA and child profiles retain separate draft and submitted records", { skip: !spiral }, () => {
  const storage = memoryStorage();
  const normal = submitBossAnswers(answered(), boss.id, now);
  const qa = answered(createBossProgress("child-a", true), boss.id, 3);
  const second = answered(createBossProgress("child-b"), boss.id, 6);
  for (const state of [normal, qa, second]) assert.equal(writeBossProgress(state, storage), true);
  assert.deepEqual(readBossProgress("child-a", false, storage), normal);
  assert.deepEqual(readBossProgress("child-a", true, storage), qa);
  assert.deepEqual(readBossProgress("child-b", false, storage), second);
  assert.equal(hasSubmittedBoss(readBossProgress("child-b", true, storage), boss.id), false);
  storage.setItem(bossStorageKey("child-b"), JSON.stringify(normal));
  assert.deepEqual(readBossProgress("child-b", false, storage), createBossProgress("child-b"), "a copied payload with another identity is rejected");
  storage.setItem(bossStorageKey("child-a", true), JSON.stringify(normal));
  assert.deepEqual(readBossProgress("child-a", true, storage), createBossProgress("child-a", true), "normal payload cannot become a QA save");
  assert.notEqual(bossStorageKey("child:a"), bossStorageKey("child%3Aa"));
});

test("blocked, missing, stale and malformed storage degrades to safe unfinished storms", { skip: !spiral }, () => {
  const blank = createBossProgress("child-a");
  assert.deepEqual(readBossProgress("child-a", false, null), blank);
  assert.equal(writeBossProgress(blank, null), false);
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota exceeded"); } };
  assert.deepEqual(readBossProgress("child-a", false, unavailable), blank);
  assert.equal(writeBossProgress(blank, unavailable), false);
  const storage = memoryStorage();
  for (const text of ["{", "null", "[]", JSON.stringify({ ...blank, version: 2 }), JSON.stringify({ ...blank, attempts: null }), JSON.stringify({ ...blank, attempts: { [boss.id]: { submittedAt: now } } })]) {
    storage.setItem(bossStorageKey("child-a"), text);
    assert.deepEqual(readBossProgress("child-a", false, storage), blank);
  }
});

test("a stale tab cannot replace another tab's submitted workbook with its older draft", { skip: !spiral }, () => {
  const storage = memoryStorage();
  const stale = answered(createBossProgress("child-a"), boss.id, 5);
  const submitted = submitBossAnswers(answered(), boss.id, now);
  writeBossProgress(submitted, storage);
  const refreshed = mergeBossProgress(stale, readBossProgress("child-a", false, storage));
  const afterStaleEdit = setBossAnswer(refreshed, boss.id, 0, 4);
  writeBossProgress(afterStaleEdit, storage);
  assert.deepEqual(readBossProgress("child-a", false, storage), submitted);
  assert.equal(submitBossAnswers(refreshed, boss.id, "2026-11-01T12:00:00.000Z"), refreshed);
  assert.equal(mergeBossProgress(refreshed, readBossProgress("child-a", false, storage)), refreshed, "repeated refresh is stable");
});

test("reconciliation preserves edits to other storms and combines draft choices before an explicit edit", { skip: !spiral }, () => {
  const second = BOSS_CHALLENGES[1];
  let local = setBossAnswer(createBossProgress("child-a"), boss.id, 0, 0);
  local = setBossAnswer(local, boss.id, 1, 1);
  let durable = setBossAnswer(createBossProgress("child-a"), boss.id, 0, 4);
  durable = setBossAnswer(durable, boss.id, 2, 2);
  durable = setBossAnswer(durable, second.id, 3, 3);
  const merged = mergeBossProgress(local, durable);
  assert.deepEqual(bossAttempt(merged, boss.id).answers.slice(0, 3), [4, 1, 2], "durable conflicts win while each tab's other choices survive");
  const edited = setBossAnswer(merged, boss.id, 0, 2);
  assert.equal(bossAttempt(edited, boss.id).answers[0], 2, "the current deliberate answer remains editable");
  assert.deepEqual(bossAttempt(edited, second.id), bossAttempt(durable, second.id), "editing this storm cannot erase another storm's draft");
  assert.deepEqual(bossAttempt(local, boss.id).answers.slice(0, 3), [0, 1, null], "reconciliation is immutable");
});

test("reconciliation keeps in-memory work when storage is blocked and never merges other identities", { skip: !spiral }, () => {
  const blocked = { getItem() { throw new Error("blocked"); } };
  const local = submitBossAnswers(answered(), boss.id, now);
  assert.equal(mergeBossProgress(local, readBossProgress("child-a", false, blocked)), local);
  assert.equal(mergeBossProgress(local, answered(createBossProgress("child-a"), boss.id, 5)), local, "a local unsaved submission survives an older durable draft");
  assert.equal(mergeBossProgress(local, createBossProgress("child-b")), local);
  assert.equal(mergeBossProgress(local, createBossProgress("child-a", true)), local);
  const draft = answered(createBossProgress("child-a"), boss.id, 7);
  assert.equal(mergeBossProgress(draft, readBossProgress("child-a", false, blocked)), draft);
});
