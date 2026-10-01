import assert from "node:assert/strict";
import test from "node:test";
import { WORLD_CONTENT_VERSION, WORLD_QUESTIONS } from "../app/math-world/world-data.ts";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { DANGER_CANDIDATE_INDEX, dangerCandidates, dangerQuestion, dangerQuestionType } from "../app/math-world/danger-candidates.ts";
import {
  acknowledgeDangerBriefing, advanceDangerQuestion, allowDangerRetry, answerDangerQuestion,
  createDangerState, dangerPacketAccuracy, dangerPacketQuestions, ensureDangerPacket,
  importLegacyDangerMisses, recordDangerMiss, startDangerPacket,
} from "../app/math-world/danger-engine.ts";
import { claimLegacyDangerMisses, dangerStorageKey, readDangerState, writeDangerState } from "../app/math-world/danger-storage.ts";

const NOW = "2026-09-30T12:00:00.000Z";
const pool = WORLD_QUESTIONS.filter(q => q.source.gradeBand === "1-2" && q.source.pointTier === 3 && q.curriculum.reasoningDemand === 1);
const wrong = q => (q.correctIndex + 1) % q.choices.length;
const emptyIndex = { schemaVersion: 1, version: "test-empty", contentVersion: WORLD_CONTENT_VERSION, classifications: {}, edges: [] };
// Artificial reviewed cohorts isolate scheduler behavior; these are deliberately
// NOT published semantic candidate relationships.
function fixtureIndex(count = 10) {
  const index = structuredClone(emptyIndex);
  const originals = [];
  for (let i = 0; i < count; i++) {
    const group = pool.slice(i * 5, i * 5 + 5);
    originals.push(group[0]);
    for (const q of group) index.classifications[q.id] = { questionType: `fixture-${i}`, method: "fixture-method", reviewed: true, evidence: "Scheduler fixture only" };
    for (const candidate of group.slice(1)) index.edges.push({ sourceQuestionId: group[0].id, candidateQuestionId: candidate.id, ...index.classifications[candidate.id] });
  }
  return { index, originals };
}
function miss(state, q, world = 2, eventId = `miss:${q.id}`, source = "archipelago") {
  return recordDangerMiss(state, { eventId, questionId: q.id, source, sourceId: source === "archipelago" ? q.stopId : "danger-before", worldNumber: world, attemptOrdinal: 1, selectedIndex: wrong(q), at: NOW });
}
function prepare(state, after = 2, index = emptyIndex) {
  return ensureDangerPacket(state, { dangerId: `danger-${String(after).padStart(2, "0")}`, afterWorldNumber: after, now: NOW }, index);
}
function solve(state, id) {
  state = startDangerPacket(acknowledgeDangerBriefing(state, id), id, NOW);
  while (!state.packets[id].completedAt) {
    const p = state.packets[id];
    const q = dangerPacketQuestions(p)[p.attempt.questionIndex];
    state = answerDangerQuestion(state, id, q.correctIndex, { eventId: `correct:${id}:${q.id}`, at: NOW });
    state = advanceDangerQuestion(state, id, NOW);
  }
  return state;
}
function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test("retains every accepted wrong attempt, rejects false misses and deduplicates event callbacks", () => {
  let state = createDangerState("child"); const q = pool[0];
  state = miss(state, q, 2, "first");
  state = miss(state, q, 2, "retry");
  assert.equal(miss(state, q, 2, "retry"), state);
  assert.equal(state.misses.length, 2);
  assert.equal(state.reviews[q.id].latestMissEventId, "retry");
  assert.equal(recordDangerMiss(state, { ...state.misses[0], eventId: "correct-not-a-miss", selectedIndex: q.correctIndex }), state);
});

test("normal packet keeps original then four candidates; repeated prepare is immutable even after index changes", () => {
  const { index, originals } = fixtureIndex(2);
  let state = createDangerState("child"); for (const q of originals) state = miss(state, q);
  state = prepare(state, 2, index);
  const packet = state.packets["danger-02"];
  assert.equal(packet.questionIds.length, 10);
  assert.deepEqual(packet.groups.map(group => group.questionIds.length), [5, 5]);
  assert.ok(packet.groups.every(group => group.questionIds[0] === group.originalQuestionId));
  assert.equal(prepare(state, 2, emptyIndex), state);
  assert.equal(state.reviews[originals[0].id].deferredCandidateIds.length, 4);
  assert.equal(state.misses.length, 2);
});

test("backlog reduces groups to three, caps at24 and keeps postponed reinforcements and original errors", () => {
  const { index, originals } = fixtureIndex(10);
  let state = createDangerState("child"); originals.forEach((q, i) => { state = miss(state, q, i < 3 ? 2 : 4); });
  state = prepare(state, 4, index);
  const packet = state.packets["danger-04"];
  assert.equal(packet.groupSize, 3); assert.equal(packet.questionIds.length, 24);
  assert.equal(new Set(packet.questionIds).size, 24);
  assert.ok(packet.groups.every(group => group.questionIds.length === 3));
  assert.equal(state.misses.length, 10);
  assert.equal(Object.keys(state.reviews).length, 10);
  assert.ok(packet.groups.slice(0, 7).every(group => state.reviews[group.originalQuestionId].latestWorldNumber === 4));
  state = solve(state, "danger-04");
  for (const group of packet.groups) assert.equal(state.reviews[group.originalQuestionId].deferredCandidateIds.length, 2);
  assert.equal(state.misses.length, 10);
  assert.equal(Object.values(state.reviews).filter(review => review.lastReviewedAfterWorld === null).length, 2);
});

test("old unserved errors age ahead of fresh errors and same exact type uses one representative", () => {
  const { index, originals } = fixtureIndex(10);
  let state = miss(createDangerState("child"), originals[0], 2);
  originals.slice(1).forEach(q => { state = miss(state, q, 10); });
  state = prepare(state, 10, index);
  assert.equal(state.packets["danger-10"].groups[0].originalQuestionId, originals[0].id);
  const otherSameType = pool[1];
  let grouped = miss(miss(createDangerState("child"), originals[0], 2), otherSameType, 2);
  grouped = prepare(grouped, 2, index);
  assert.equal(grouped.packets["danger-02"].groups.length, 1);
  assert.equal(grouped.misses.length, 2);
});

test("untimed danger retries retain reinforcement mistakes, preserve first-try score and require every question solved", () => {
  const { index, originals } = fixtureIndex(1);
  let state = prepare(miss(createDangerState("child"), originals[0]), 2, index);
  state = startDangerPacket(acknowledgeDangerBriefing(state, "danger-02"), "danger-02", NOW);
  assert.equal(advanceDangerQuestion(state, "danger-02", NOW), state);
  const first = dangerPacketQuestions(state.packets["danger-02"])[0];
  state = answerDangerQuestion(state, "danger-02", first.correctIndex, { eventId: "ok", at: NOW });
  state = advanceDangerQuestion(state, "danger-02", NOW);
  const reinforcement = dangerPacketQuestions(state.packets["danger-02"])[1];
  state = answerDangerQuestion(state, "danger-02", wrong(reinforcement), { eventId: "wrong-1", at: NOW });
  assert.equal(answerDangerQuestion(state, "danger-02", reinforcement.correctIndex, { eventId: "too-soon", at: NOW }), state);
  state = allowDangerRetry(state, "danger-02");
  state = answerDangerQuestion(state, "danger-02", wrong(reinforcement), { eventId: "wrong-2", at: NOW });
  state = allowDangerRetry(state, "danger-02");
  state = answerDangerQuestion(state, "danger-02", reinforcement.correctIndex, { eventId: "right-retry", at: NOW });
  state = advanceDangerQuestion(state, "danger-02", NOW);
  state = solve(state, "danger-02");
  assert.equal(state.misses.length, 3);
  assert.equal(state.misses.filter(m => m.questionId === reinforcement.id).length, 2);
  assert.equal(state.packets["danger-02"].attempt.firstTryCorrect[reinforcement.id], false);
  assert.equal(dangerPacketAccuracy(state.packets["danger-02"]), 80);
  assert.equal(state.reviews[reinforcement.id].dueAfterWorld, 4);
  assert.equal(state.reviews[originals[0].id].dueAfterWorld, 4);
});

test("two clean spaced reviews retire a mastered error from due queue without deleting history; new errors reactivate", () => {
  const q = pool[0]; let state = prepare(miss(createDangerState("child"), q));
  state = solve(state, "danger-02"); assert.equal(state.reviews[q.id].dueAfterWorld, 6);
  state = prepare(state, 4); assert.equal(state.packets["danger-04"].questionIds.length, 0);
  state = solve(prepare(state, 6), "danger-06"); assert.equal(state.reviews[q.id].dueAfterWorld, null);
  assert.equal(state.misses.length, 1);
  state = miss(state, q, 8, "new-error"); assert.equal(state.reviews[q.id].dueAfterWorld, 8); assert.equal(state.misses.length, 2);
});

test("candidate provider rejects stale indexes, mismatched methods, wrong grade, harder items, unknown assets and holdouts", () => {
  const { index, originals } = fixtureIndex(1); const q = originals[0];
  assert.equal(dangerCandidates(q.id, index).length, 4);
  assert.deepEqual(dangerCandidates(q.id, { ...index, contentVersion: "outdated" }), []);
  const mismatch = structuredClone(index); mismatch.edges.forEach(edge => { edge.method = "wrong"; });
  assert.deepEqual(dangerCandidates(q.id, mismatch), []);
  const harder = WORLD_QUESTIONS.find(candidate => candidate.source.gradeBand === "3-4");
  const unsafe = structuredClone(index); unsafe.classifications[harder.id] = unsafe.classifications[q.id];
  unsafe.edges.push({ ...unsafe.edges[0], candidateQuestionId: harder.id });
  unsafe.edges.push({ ...unsafe.edges[0], candidateQuestionId: "oasis-online-2025-grades-1-2-q01" });
  assert.equal(dangerCandidates(q.id, unsafe).length, 4);
  assert.notEqual(dangerQuestionType(q.id, emptyIndex), dangerQuestionType(pool[1].id, emptyIndex));
  assert.ok(DANGER_CANDIDATE_INDEX.edges.length > 0);
  assert.ok(dangerCandidates("think300-l1-2-4-points-q006").includes("think300-l1-2-4-points-q022"));
});

test("legacy first-try history imports once, and device-wide history can be claimed by only one real profile", () => {
  const q = pool[0]; const progress = { ...createInitialProgress(), stopAttempts: { [q.stopId]: { questionIndex: 0, phase: "retry", selectedIndex: wrong(q), firstTryCorrect: { [q.id]: false }, solvedQuestionIds: [] } } };
  const storage = memoryStorage();
  const first = claimLegacyDangerMisses(createDangerState("child-a"), progress, storage, NOW);
  assert.equal(first.misses.length, 1); assert.equal(first.misses[0].selectedIndex, null);
  assert.equal(importLegacyDangerMisses(first, progress, NOW), first);
  assert.equal(claimLegacyDangerMisses(createDangerState("child-b"), progress, storage, NOW).misses.length, 0);
  assert.equal(claimLegacyDangerMisses(createDangerState("tester", true), progress, storage, NOW).misses.length, 1);
  assert.equal(claimLegacyDangerMisses(createDangerState("offline"), progress, null, NOW).misses.length, 0);
});

test("reload keeps exact packet, attempt, append-only misses and deferred deck; QA and identities stay isolated", () => {
  const { index, originals } = fixtureIndex(1); const storage = memoryStorage();
  let state = prepare(miss(createDangerState("child-a"), originals[0]), 2, index);
  state = startDangerPacket(acknowledgeDangerBriefing(state, "danger-02"), "danger-02", NOW);
  state = answerDangerQuestion(state, "danger-02", wrong(originals[0]), { eventId: "danger-retry", at: NOW });
  assert.equal(writeDangerState(state, storage), true);
  assert.deepEqual(readDangerState("child-a", false, storage), state);
  assert.equal(readDangerState("child-b", false, storage).misses.length, 0);
  assert.equal(readDangerState("child-a", true, storage).misses.length, 0);
  assert.equal(writeDangerState(state, { setItem() { throw new Error("quota"); } }), false);
  assert.equal(readDangerState("child-a", false, { getItem() { throw new Error("blocked"); } }).misses.length, 0);
});

test("corrupt packet does not discard valid miss history; foreign stored identity is rejected", () => {
  const storage = memoryStorage(); const q = pool[0]; const state = prepare(miss(createDangerState("child-a"), q));
  const corrupted = structuredClone(state); corrupted.packets["danger-02"].questionIds.push(q.id);
  storage.setItem(dangerStorageKey("child-a", false), JSON.stringify(corrupted));
  const restored = readDangerState("child-a", false, storage);
  assert.equal(restored.misses.length, 1); assert.deepEqual(restored.packets, {});
  storage.setItem(dangerStorageKey("child-b", false), JSON.stringify(state));
  assert.equal(readDangerState("child-b", false, storage).misses.length, 0);
});

test("one malformed stored observation cannot wipe intact history or a frozen packet", () => {
  const storage = memoryStorage();
  const state = prepare(miss(createDangerState("child"), pool[0]));
  const raw = structuredClone(state);
  raw.misses.unshift({ ...state.misses[0], eventId: 17, sourceId: { invalid: true } });
  storage.setItem(dangerStorageKey("child", false), JSON.stringify(raw));
  assert.deepEqual(readDangerState("child", false, storage), state);
});

test("missing candidate coverage yields originals only and never generic topic filler", () => {
  const q = WORLD_QUESTIONS.find(question => question.id === "oasis-online-2022-grades-1-2-q01");
  const state = ensureDangerPacket(miss(createDangerState("child"), q), { dangerId: "danger-02", afterWorldNumber: 2, now: NOW });
  assert.deepEqual(state.packets["danger-02"].questionIds, [q.id]);
});


test("all 680 teaching questions can enter the miss ledger, including unrelated 2026 mock papers", () => {
  assert.equal(WORLD_QUESTIONS.length, 680);
  assert.deepEqual(WORLD_QUESTIONS.filter(question => !dangerQuestion(question.id)), []);
  let state = createDangerState("all-content");
  for (const question of WORLD_QUESTIONS) state = miss(state, question);
  assert.equal(state.misses.length, WORLD_QUESTIONS.length);
  assert.ok(dangerQuestion("think-academy-mock-2026-march-lv12-q21"));
  assert.equal(dangerQuestion("usa-electronic-2025-grades-1-2-q01"), undefined);
  assert.equal(dangerQuestion("cyprus-2025-grades-1-2-part-single-q01"), undefined);
});

test("every legitimate answer phase and the completed checkpoint round-trips without changing packet contents", () => {
  const { index, originals } = fixtureIndex(1); const storage = memoryStorage();
  let state = prepare(miss(createDangerState("phase-reader"), originals[0]), 2, index);
  const verify = () => { writeDangerState(state, storage); assert.deepEqual(readDangerState("phase-reader", false, storage), state); };
  verify();
  state = startDangerPacket(acknowledgeDangerBriefing(state, "danger-02"), "danger-02", NOW); verify();
  state = answerDangerQuestion(state, "danger-02", wrong(originals[0]), { eventId: "wrong-for-phase", at: NOW }); verify();
  state = allowDangerRetry(state, "danger-02"); verify();
  state = answerDangerQuestion(state, "danger-02", originals[0].correctIndex, { eventId: "retry-right", at: NOW }); verify();
  state = advanceDangerQuestion(state, "danger-02", NOW); verify();
  state = solve(state, "danger-02"); verify();
  assert.equal(state.packets["danger-02"].completedAt, NOW);
  const raw = structuredClone(state);
  raw.packets["danger-02"].attempt.firstTryCorrect[pool[35].id] = true;
  storage.setItem(dangerStorageKey("phase-reader", false), JSON.stringify(raw));
  assert.equal(readDangerState("phase-reader", false, storage).packets["danger-02"], undefined);
});

test("an empty no-misses packet can finish and reload without any phantom question or answer", () => {
  const storage = memoryStorage(); let state = prepare(createDangerState("no-misses"));
  state = startDangerPacket(acknowledgeDangerBriefing(state, "danger-02"), "danger-02", NOW);
  assert.equal(state.packets["danger-02"].completedAt, NOW);
  assert.deepEqual(state.packets["danger-02"].attempt.firstTryCorrect, {});
  writeDangerState(state, storage); assert.deepEqual(readDangerState("no-misses", false, storage), state);
});


test("packets require the canonical danger ID and matching milestone, including on reload", () => {
  const storage = memoryStorage();
  const state = miss(createDangerState("canonical-danger"), pool[0]);
  assert.equal(ensureDangerPacket(state, { dangerId: "invented", afterWorldNumber: 2, now: NOW }), state);
  assert.equal(ensureDangerPacket(state, { dangerId: "danger-02", afterWorldNumber: 32, now: NOW }), state);
  assert.equal(ensureDangerPacket(state, { dangerId: "danger-2", afterWorldNumber: 2, now: NOW }), state);
  const prepared = prepare(state);
  assert.ok(prepared.packets["danger-02"]);
  const corrupt = structuredClone(prepared);
  corrupt.packets["danger-02"].afterWorldNumber = 32;
  storage.setItem(dangerStorageKey("canonical-danger", false), JSON.stringify(corrupt));
  const restored = readDangerState("canonical-danger", false, storage);
  assert.deepEqual(restored.packets, {});
  assert.deepEqual(restored.misses, state.misses);
  assert.ok(restored.reviews[pool[0].id]);
});
