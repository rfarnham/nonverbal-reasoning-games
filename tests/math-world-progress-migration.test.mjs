import assert from "node:assert/strict";
import test from "node:test";

import legacyRuntime from "../content/math-world/spiral-20.runtime.json" with { type: "json" };
import runtime from "../app/math-world/data/runtime.generated.json" with { type: "json" };
import {
  advanceQuestion, allowRetry, answerQuestion, canOpenRequiredStop, canOpenWorld,
  createInitialProgress, nextRequiredStopId, startStop,
} from "../app/math-world/engine.ts";
import {
  QUESTIONS_BY_STOP, REQUIRED_STOPS, WORLD_COMPATIBLE_CONTENT_VERSIONS,
  WORLD_CONTENT_VERSION, WORLD_DEFINITIONS, WORLD_MODE, WORLD_QUESTIONS, worldForStop,
} from "../app/math-world/world-data.ts";
import {
  readQaArchive, readWorldProgress, writeQaRecord, writeWorldProgress,
} from "../app/math-world/storage.ts";

const options = { skip: WORLD_MODE !== "spiral-preview" };
const NORMAL_KEY = "spatial-gym-math-world-spiral-progress";
const PLAYTEST_KEY = "spatial-gym-math-world-spiral-playtest-progress";
const LEGACY_VERSION = "spiral-20.v1.f665226c7060bba8";
const legacyQuestionIds = new Set(legacyRuntime.questions.map(question => question.id));
const legacyStopIds = new Set(legacyRuntime.stops.map(stop => stop.id));
const legacyQuestionsByStop = new Map(legacyRuntime.stops.map(stop => [stop.id, legacyRuntime.questions.filter(question => question.stopId === stop.id)]));

function memoryWindow(context) {
  const entries = new Map();
  const storage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
  return storage;
}

// Reconstruct a real old-curriculum playthrough from the frozen question order.
// Test navigation bypasses only the newly inserted worlds; every answer, retry,
// cursor movement, and completion is still produced by the canonical engine.
// Retain earlier attempts to match normal play instead of QA's one-stop scratchpad.
function beginLegacyStop(progress, stopId) {
  const next = startStop(progress, stopId, true);
  return { ...next, stopAttempts: { ...progress.stopAttempts, ...next.stopAttempts } };
}
function solveCurrentQuestion(progress, stopId, question, missFirst = false) {
  let next = progress;
  if (missFirst) {
    next = answerQuestion(next, stopId, question, (question.correctIndex + 1) % question.choices.length);
    next = allowRetry(next, stopId);
  }
  return answerQuestion(next, stopId, question, question.correctIndex);
}
function legacySnapshot({ worldNumber, stopIndex = 0, questionIndex = 2, phase = "answering", checkpoint = false }) {
  const stopId = legacyRuntime.worlds.find(world => world.number === worldNumber).stopIds[stopIndex];
  let progress = createInitialProgress();
  for (const stop of legacyRuntime.stops) {
    progress = beginLegacyStop(progress, stop.id);
    const questions = legacyQuestionsByStop.get(stop.id);
    if (stop.id === stopId && !checkpoint) {
      for (const [index, question] of questions.entries()) {
        if (index === questionIndex) {
          if (phase === "wrong-review" || phase === "retry") {
            progress = answerQuestion(progress, stop.id, question, (question.correctIndex + 1) % question.choices.length);
            if (phase === "retry") progress = allowRetry(progress, stop.id);
          } else if (phase === "correct") progress = solveCurrentQuestion(progress, stop.id, question);
          return { ...progress, contentVersion: LEGACY_VERSION };
        }
        progress = solveCurrentQuestion(progress, stop.id, question, index === 0);
        progress = advanceQuestion(progress, stop.id, questions.length);
      }
    }
    for (const [index, question] of questions.entries()) {
      progress = solveCurrentQuestion(progress, stop.id, question, index === 0);
      progress = advanceQuestion(progress, stop.id, questions.length);
    }
    assert.ok(progress.completedStopIds.includes(stop.id), `fixture actually completed ${stop.id}`);
    if (stop.id === stopId) return { ...progress, contentVersion: LEGACY_VERSION };
  }
  throw new Error("Legacy fixture stop was not found");
}

function upgraded(snapshot) { return { ...snapshot, contentVersion: WORLD_CONTENT_VERSION }; }

test("the 32-world runtime explicitly preserves all 480 legacy questions and their stop order", options, () => {
  assert.equal(legacyRuntime.contentVersion, LEGACY_VERSION);
  assert.equal(legacyRuntime.questions.length, 480);
  assert.equal(legacyRuntime.worlds.length, 20);
  assert.equal(WORLD_DEFINITIONS.length, 32);
  assert.notEqual(WORLD_CONTENT_VERSION, LEGACY_VERSION);
  assert.ok(runtime.compatibleProgressVersions.includes(LEGACY_VERSION));
  assert.ok(WORLD_COMPATIBLE_CONTENT_VERSIONS.has(LEGACY_VERSION));
  const currentById = new Map(WORLD_QUESTIONS.map(question => [question.id, question]));
  for (const question of legacyRuntime.questions) {
    assert.deepEqual(currentById.get(question.id), question, `${question.id}: unchanged content makes migration safe`);
  }
  assert.deepEqual(WORLD_QUESTIONS.filter(question => legacyQuestionIds.has(question.id)).map(question => question.id), legacyRuntime.questions.map(question => question.id));
  assert.deepEqual(REQUIRED_STOPS.filter(stop => legacyStopIds.has(stop.id)).map(stop => stop.id), legacyRuntime.stops.map(stop => stop.id));
  for (const legacyWorld of legacyRuntime.worlds) {
    const current = WORLD_DEFINITIONS.find(world => world.id === legacyWorld.id);
    assert.deepEqual(current.stopIds, legacyWorld.stopIds, "world renumbering does not change persisted membership");
  }
  assert.equal(WORLD_DEFINITIONS.find(world => world.id === legacyRuntime.worlds[7].id).number, 9);
  assert.equal(WORLD_DEFINITIONS.find(world => world.id === legacyRuntime.worlds[9].id).number, 16);
  assert.equal(WORLD_DEFINITIONS.find(world => world.id === legacyRuntime.worlds[19].id).number, 32);
});

for (const { worldNumber, phase } of [8,10].flatMap(worldNumber => ["answering", "wrong-review", "retry", "correct"].map(phase => ({ worldNumber, phase })))) {
  test(`a legacy World ${worldNumber} ${phase} attempt resumes behind an inserted curriculum gap`, options, context => {
    const storage = memoryWindow(context);
    const saved = legacySnapshot({ worldNumber, stopIndex: 2, questionIndex: 2, phase });
    const original = JSON.stringify(saved);
    storage.setItem(NORMAL_KEY, original);
    const result = readWorldProgress();
    assert.deepEqual(result, upgraded(saved));
    assert.equal(storage.getItem(NORMAL_KEY), original, "read does not overwrite the previous save");
    const activeId = result.activeStopId;
    assert.equal(result.stopAttempts[activeId].phase, phase);
    assert.equal(result.stopAttempts[activeId].firstTryCorrect[QUESTIONS_BY_STOP.get(activeId)[0].id], false, "redeemed first-try miss stays a miss");
    assert.equal(canOpenRequiredStop(result, activeId), true);
    assert.equal(canOpenWorld(result, worldForStop(activeId).id), true);
    assert.deepEqual(result.completedStopIds, saved.completedStopIds);
    const firstNewStop = REQUIRED_STOPS.find(stop => !legacyStopIds.has(stop.id));
    assert.equal(nextRequiredStopId(result), firstNewStop.id);
    assert.equal(canOpenRequiredStop(result, firstNewStop.id), true);
    const secondNewStop = REQUIRED_STOPS.filter(stop => !legacyStopIds.has(stop.id))[1];
    assert.equal(canOpenRequiredStop(result, secondNewStop.id), false, "migration does not clear the inserted material");
    const laterNewWorld = WORLD_DEFINITIONS.find(world => world.conceptId === "fractions" && world.spiral === 1);
    assert.equal(canOpenWorld(result, laterNewWorld.id), false);
    writeWorldProgress(result);
    assert.equal(JSON.parse(storage.getItem(NORMAL_KEY)).contentVersion, WORLD_CONTENT_VERSION);
    assert.deepEqual(readWorldProgress(), result);
  });
}

test("legacy World 10 and World 20 checkpoints keep their earned ledger without completing inserted worlds", options, context => {
  const storage = memoryWindow(context);
  for (const worldNumber of [10,20]) {
    const saved = legacySnapshot({ worldNumber, stopIndex: 3, checkpoint: true });
    storage.setItem(NORMAL_KEY, JSON.stringify(saved));
    const result = readWorldProgress();
    assert.deepEqual(result, upgraded(saved));
    assert.equal(result.activeStopId, null);
    assert.equal(result.checkpointStopId, legacyRuntime.worlds[worldNumber - 1].stopIds[3]);
    assert.equal(result.completedStopIds.length, worldNumber * 4);
    for (const id of saved.completedStopIds) {
      assert.equal(canOpenRequiredStop(result, id), true, "every earned historical stop remains available");
      assert.equal(canOpenWorld(result, worldForStop(id).id), true);
    }
    assert.deepEqual(result.completedStopIds.filter(id => !legacyStopIds.has(id)), []);
    const newSecondPass = WORLD_DEFINITIONS.find(world => world.conceptId === "groups-sharing" && world.spiral === 2);
    assert.equal(canOpenWorld(result, newSecondPass.id), false, "old full completion does not unlock inserted second-pass material");
  }
});

test("normal and QA legacy saves migrate independently and preserve both partial cursors", options, context => {
  const storage = memoryWindow(context);
  const normal = legacySnapshot({ worldNumber: 8, stopIndex: 1, questionIndex: 3, phase: "retry" });
  const playtest = legacySnapshot({ worldNumber: 10, stopIndex: 2, questionIndex: 4, phase: "correct" });
  storage.setItem(NORMAL_KEY, JSON.stringify(normal));
  storage.setItem(PLAYTEST_KEY, JSON.stringify(playtest));
  storage.setItem("spatial-gym:progression", "unchanged Journey profile and XP data");
  assert.deepEqual(readWorldProgress(), upgraded(normal));
  assert.deepEqual(readWorldProgress(true), upgraded(playtest));
  writeWorldProgress(readWorldProgress(true), true);
  assert.equal(storage.getItem(NORMAL_KEY), JSON.stringify(normal));
  const upgradedPlaytest = storage.getItem(PLAYTEST_KEY);
  writeWorldProgress(readWorldProgress());
  assert.equal(storage.getItem(PLAYTEST_KEY), upgradedPlaytest);
  assert.equal(storage.getItem("spatial-gym:progression"), "unchanged Journey profile and XP data");
});

test("compatibility does not admit unrelated versions or invalid saved attempts", options, context => {
  const storage = memoryWindow(context);
  const saved = legacySnapshot({ worldNumber: 8, phase: "wrong-review" });
  for (const key of [NORMAL_KEY,PLAYTEST_KEY]) {
    storage.setItem(key, JSON.stringify({ ...saved, contentVersion: "spiral-unknown.v99" }));
    assert.deepEqual(readWorldProgress(key === PLAYTEST_KEY), createInitialProgress());
  }
  const id = saved.activeStopId;
  const invalid = { ...saved, stopAttempts: { ...saved.stopAttempts, [id]: { ...saved.stopAttempts[id], phase: "correct" } } };
  storage.setItem(NORMAL_KEY, JSON.stringify(invalid));
  const recovered = readWorldProgress();
  assert.equal(recovered.activeStopId, null, "a wrong answer cannot become a completed question during migration");
  assert.equal(recovered.stopAttempts[id], undefined);
  assert.deepEqual(recovered.completedStopIds, saved.completedStopIds, "only the corrupt attempt is removed");
});

test("versioned QA notes carry forward without overwriting their historical archive", options, context => {
  const storage = memoryWindow(context);
  const legacyKey = `spatial-gym-math-world-qa:${WORLD_MODE}:${LEGACY_VERSION}`;
  const currentKey = `spatial-gym-math-world-qa:${WORLD_MODE}:${WORLD_CONTENT_VERSION}`;
  const question = legacyRuntime.questions[172];
  const existing = { questionId: question.id, stopId: question.stopId, categories: ["image-crop"], note: "Keep the original diagram margin.", status: "needs-change", firstSelectedIndex: 2, updatedAt: "2026-09-22T00:00:00Z" };
  const historical = JSON.stringify({ schemaVersion: 1, contentVersion: LEGACY_VERSION, records: { [question.id]: existing } });
  storage.setItem(legacyKey, historical);
  assert.deepEqual(readQaArchive(), { schemaVersion: 1, contentVersion: WORLD_CONTENT_VERSION, records: { [question.id]: existing } });
  assert.equal(storage.getItem(currentKey), null);
  const newQuestion = WORLD_QUESTIONS.find(item => !legacyQuestionIds.has(item.id));
  const added = { ...existing, questionId: newQuestion.id, stopId: newQuestion.stopId, categories: [], note: "New restored concept review.", firstSelectedIndex: null };
  const archive = writeQaRecord(added);
  assert.deepEqual(archive.records, { [question.id]: existing, [added.questionId]: added });
  assert.equal(storage.getItem(legacyKey), historical);
  assert.equal(JSON.parse(storage.getItem(currentKey)).contentVersion, WORLD_CONTENT_VERSION);
  assert.deepEqual(readQaArchive(), archive);
});
