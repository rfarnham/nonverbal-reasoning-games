import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  advanceQuestion,
  allowRetry,
  answerQuestion,
  canOpenRequiredStop,
  canOpenWorld,
  selectWorld,
  completeStop,
  createInitialProgress,
  nextRequiredStopId,
  startStop,
} from "../app/math-world/engine.ts";
import {
  BREAK_STOPS,
  QUESTIONS_BY_STOP,
  REQUIRED_STOPS,
  WORLD_QUESTIONS,
  WORLD_STOPS,
  WORLD_DEFINITIONS,
  WORLD_MODE,
  stopsForWorld,
} from "../app/math-world/world-data.ts";
import {
  readWorldPlaytestMode,
  readQaArchive,
  writeQaRecord,
  readWorldProgress,
  writeWorldProgress,
} from "../app/math-world/storage.ts";
import {
  PROGRESSION_STORAGE_KEY,
  saveProgressionState,
} from "../lib/progression/persistence.ts";
import {
  addPlayerProfile,
  createPlayerProfile,
  createProgressionState,
} from "../lib/progression/profiles.ts";

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
    entries,
  };
}

function profileState(name = "testUser123") {
  return addPlayerProfile(createProgressionState(), createPlayerProfile({
    id: "world-playtester",
    name,
    avatarId: "hedgehog",
    gameSnapshot: [
      ...Array.from({ length: 8 }, (_, index) => ({
        slug: `game-${index + 1}`,
        title: `Game ${index + 1}`,
        contentVersion: "campaign-v1",
        generatorVersion: "generator-v1",
      })),
      { slug: "math-kangaroo", title: "Math Kangaroo", role: "review", journeyContentVersion: "review-v1" },
    ],
    nowMs: 1,
  }));
}

function solveStop(progress, stopId) {
  const questions = QUESTIONS_BY_STOP.get(stopId);
  for (const question of questions) {
    progress = answerQuestion(progress, stopId, question, question.correctIndex);
    progress = advanceQuestion(progress, stopId, questions.length);
  }
  return progress;
}

test("the approved map ontology has six realms and 27 stable districts", async () => {
  const ontology = JSON.parse(
    await readFile(
      new URL("../content/math-world/mk-map-ontology.v1.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(ontology.status, "approved-static-placement");
  assert.equal(ontology.realms.length, 6);
  const districts = ontology.realms.flatMap((realm) => realm.districts);
  assert.equal(districts.length, 27);
  assert.equal(new Set(ontology.realms.map(({ id }) => id)).size, 6);
  assert.equal(new Set(districts.map(({ id }) => id)).size, 27);
  assert.equal(ontology.placementPolicy.reviewFlagsBlockRelease, false);
  assert.equal(ontology.placementPolicy.prerequisiteEdgesGateProgress, false);

  const knownDistricts = new Set(districts.map(({ id }) => id));
  for (const question of WORLD_MODE === "prototype" ? WORLD_QUESTIONS : []) {
    if (question.curriculum.districtId !== "mixed-expedition") {
      assert.equal(knownDistricts.has(question.curriculum.districtId), true);
    }
  }
});

test("the authored worlds have bounded, nonempty question stops", async () => {
  if (WORLD_MODE === "prototype") {
    assert.equal(WORLD_DEFINITIONS.length, 1);
    assert.equal(REQUIRED_STOPS.length, 9);
    assert.equal(BREAK_STOPS.length, 2);
    assert.equal(WORLD_QUESTIONS.length, 38);
    for (const stop of REQUIRED_STOPS) {
      assert.equal(QUESTIONS_BY_STOP.get(stop.id).length, stop.kind === "culmination" ? 6 : 4);
    }
    return;
  }
  assert.equal(WORLD_DEFINITIONS.length, 20);
  const taxonomy = JSON.parse(await readFile(new URL("../content/math-world/competition-math-taxonomy.v1.0.0.proposed.json", import.meta.url), "utf8"));
  const topics = new Set(taxonomy.domains.flatMap(domain => domain.topics.map(topic => topic.id)));
  const conceptPasses = new Set();
  for (const world of WORLD_DEFINITIONS) {
    conceptPasses.add(`${world.conceptId}:${world.spiral}`);
    const stops = stopsForWorld(world.id);
    assert.deepEqual(stops.map(stop => stop.id), world.stopIds);
    const questions = stops.flatMap(stop => QUESTIONS_BY_STOP.get(stop.id));
    assert.equal(questions.length, 24);
    assert.equal(stops.length, 4);
    for (const stop of stops) assert.equal(QUESTIONS_BY_STOP.get(stop.id).length, 6);
    for (const question of questions) {
      assert.equal(question.worldId, world.id);
      assert.ok(topics.has(question.curriculum.primaryTopic));
      assert.ok(question.source.gradeBand === "1-2" ? [3,4,5].includes(question.source.pointTier) : question.source.gradeBand === "3-4" && [3,4].includes(question.source.pointTier));
    }
  }
  assert.equal(conceptPasses.size, 20);
  assert.equal(WORLD_STOPS.length, REQUIRED_STOPS.length + BREAK_STOPS.length);
});

test("the frozen world package contains unique, mechanically playable questions", async () => {
  const ids = new Set();
  for (const question of WORLD_QUESTIONS) {
    assert.equal(ids.has(question.id), false, question.id);
    ids.add(question.id);
    assert.ok([4, 5].includes(question.choices.length));
    assert.ok(question.correctIndex >= 0 && question.correctIndex < question.choices.length);
    assert.ok(question.prompt.trim());
    assert.equal(question.curriculum.placementStatus, WORLD_MODE === "prototype" ? "provisional-playtest" : "agent-reviewed");
    assert.ok(question.curriculum.realmId);
    assert.ok(question.source.year >= 2000);
    await access(
      new URL(`../public${question.asset.src}`, import.meta.url),
    );
  }

  const runtime = await readFile(
    new URL("../app/math-world/data/runtime.generated.json", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(runtime, /protected_payload|answer_key_ref|local_ref|\/Users\//);
  assert.doesNotMatch(runtime, /archive_url|source_pdf/);
});

test("wrong answers retry in place and only a solved final question completes a stop", () => {
  const stop = REQUIRED_STOPS[0];
  const questions = QUESTIONS_BY_STOP.get(stop.id) ?? [];
  const question = questions[0];
  let progress = startStop(createInitialProgress(), stop.id);

  assert.equal(nextRequiredStopId(progress), stop.id);
  assert.equal(canOpenRequiredStop(progress, REQUIRED_STOPS[1].id), false);

  const wrongIndex = (question.correctIndex + 1) % question.choices.length;
  progress = answerQuestion(progress, stop.id, question, wrongIndex);
  assert.equal(progress.stopAttempts[stop.id].phase, "wrong-review");
  assert.equal(progress.stopAttempts[stop.id].questionIndex, 0);
  assert.equal(progress.stopAttempts[stop.id].firstTryCorrect[question.id], false);

  progress = allowRetry(progress, stop.id);
  progress = answerQuestion(progress, stop.id, question, question.correctIndex);
  assert.equal(progress.stopAttempts[stop.id].phase, "correct");
  assert.equal(progress.stopAttempts[stop.id].firstTryCorrect[question.id], false);

  progress = advanceQuestion(progress, stop.id, questions.length);
  assert.equal(progress.stopAttempts[stop.id].questionIndex, 1);
  assert.deepEqual(progress.completedStopIds, []);
});

test("QA mode may inspect future stops without changing the authored unlock path", () => {
  const progress = createInitialProgress();
  const finalStop = REQUIRED_STOPS.at(-1);
  assert.equal(canOpenRequiredStop(progress, finalStop.id), false);
  assert.equal(canOpenRequiredStop(progress, finalStop.id, true), true);
  assert.equal(nextRequiredStopId(progress), REQUIRED_STOPS[0].id);
});

test("test mode opens every real stop, replaces unfinished runs, and replays completed stops", () => {
  const initial = createInitialProgress();
  const firstStop = REQUIRED_STOPS[0];
  const finalStop = REQUIRED_STOPS.at(-1);
  for (const stop of REQUIRED_STOPS) {
    assert.equal(canOpenRequiredStop(initial, stop.id, true), true);
    assert.equal(startStop(initial, stop.id, true).activeStopId, stop.id);
  }
  assert.equal(canOpenRequiredStop(initial, "invented-stop", true), false);
  assert.equal(startStop(initial, "invented-stop", true), initial);
  assert.equal(startStop(initial, finalStop.id), initial);

  let progress = startStop(initial, firstStop.id, true);
  const firstQuestion = QUESTIONS_BY_STOP.get(firstStop.id)[0];
  progress = answerQuestion(progress, firstStop.id, firstQuestion, (firstQuestion.correctIndex + 1) % firstQuestion.choices.length);
  assert.equal(progress.stopAttempts[firstStop.id].phase, "wrong-review");
  progress = startStop(progress, finalStop.id, true);
  assert.equal(progress.activeStopId, finalStop.id);
  assert.deepEqual(Object.keys(progress.stopAttempts), [finalStop.id]);
  assert.deepEqual(progress.stopAttempts[finalStop.id].firstTryCorrect, {});
  progress = solveStop(progress, finalStop.id);
  assert.equal(progress.checkpointStopId, finalStop.id);
  assert.deepEqual(progress.completedStopIds, [finalStop.id]);
  progress = startStop(progress, finalStop.id, true);
  assert.equal(progress.activeStopId, finalStop.id);
  assert.equal(progress.checkpointStopId, null);
  assert.equal(progress.stopAttempts[finalStop.id].questionIndex, 0);
  assert.equal(progress.stopAttempts[finalStop.id].phase, "answering");
  assert.deepEqual(progress.stopAttempts[finalStop.id].solvedQuestionIds, []);
  assert.deepEqual(initial.completedStopIds, []);
});

test("test mode keeps canonical question validation and requires solving the entire stop", () => {
  const stop = REQUIRED_STOPS.at(-1);
  const questions = QUESTIONS_BY_STOP.get(stop.id);
  const question = questions[0];
  const progress = startStop(createInitialProgress(), stop.id, true);
  for (const invalidIndex of [-1, 5, 0.5, NaN]) {
    assert.equal(answerQuestion(progress, stop.id, question, invalidIndex), progress);
  }
  assert.equal(answerQuestion(progress, stop.id, questions[1], questions[1].correctIndex), progress);
  assert.equal(answerQuestion(progress, REQUIRED_STOPS[0].id, question, question.correctIndex), progress);
  assert.equal(completeStop(progress, stop.id), progress);

  const wrongIndex = (question.correctIndex + 1) % question.choices.length;
  const forgedQuestion = { ...question, correctIndex: wrongIndex };
  assert.equal(answerQuestion(progress, stop.id, forgedQuestion, wrongIndex).stopAttempts[stop.id].phase, "wrong-review");
  const answered = answerQuestion(progress, stop.id, question, question.correctIndex);
  assert.equal(advanceQuestion(answered, stop.id, 1), answered);
  assert.equal(completeStop(answered, stop.id), answered);
  const onMap = { ...answered, activeStopId: null };
  assert.equal(advanceQuestion(onMap, stop.id, questions.length), onMap);
});

test("only the selected exact testUser123 profile enables world test mode", () => {
  const storage = memoryStorage();
  assert.equal(readWorldPlaytestMode(storage), false);
  for (const name of ["TestUser123", "testuser123", "testUser1234", "Ada"]) {
    saveProgressionState(profileState(name), storage);
    assert.equal(readWorldPlaytestMode(storage), false, name);
  }
  saveProgressionState(profileState(), storage);
  assert.equal(readWorldPlaytestMode(storage), true);
  const switched = addPlayerProfile(profileState(), { ...profileState("Ada").profiles[0], id: "regular-player" });
  saveProgressionState(switched, storage);
  assert.equal(readWorldPlaytestMode(storage), false);
  storage.setItem(PROGRESSION_STORAGE_KEY, "{invalid");
  assert.equal(readWorldPlaytestMode(storage), false);
  assert.equal(readWorldPlaytestMode(null), false);
});

test("playtest reloads independently and never writes normal progress or Journey ledgers", (context) => {
  const storage = memoryStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  context.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  saveProgressionState(profileState(), storage);
  const savedJourney = storage.getItem(PROGRESSION_STORAGE_KEY);
  const firstStop = REQUIRED_STOPS[0];
  const normalProgress = startStop(createInitialProgress(), firstStop.id);
  writeWorldProgress(normalProgress);
  const normalSave = storage.getItem(WORLD_MODE === "prototype" ? "spatial-gym-math-world-progress" : "spatial-gym-math-world-spiral-progress");

  const finalStop = REQUIRED_STOPS.at(-1);
  let testProgress = startStop(readWorldProgress(true), finalStop.id, true);
  const question = QUESTIONS_BY_STOP.get(finalStop.id)[0];
  testProgress = answerQuestion(testProgress, finalStop.id, question, (question.correctIndex + 1) % question.choices.length);
  writeWorldProgress(testProgress, true);
  assert.deepEqual(readWorldProgress(true), testProgress);
  assert.equal(readWorldPlaytestMode(), true);

  testProgress = startStop(testProgress, finalStop.id, true);
  testProgress = solveStop(testProgress, finalStop.id);
  writeWorldProgress(testProgress, true);
  assert.deepEqual(readWorldProgress(), normalProgress);
  assert.equal(storage.getItem(WORLD_MODE === "prototype" ? "spatial-gym-math-world-progress" : "spatial-gym-math-world-spiral-progress"), normalSave);
  assert.equal(storage.getItem(PROGRESSION_STORAGE_KEY), savedJourney);

  saveProgressionState(profileState("Ada"), storage);
  assert.equal(readWorldPlaytestMode(), false);
  assert.equal(readWorldProgress().activeStopId, firstStop.id);
  assert.equal(canOpenRequiredStop(readWorldProgress(), finalStop.id), false);
});

test("corrupt saved attempts return to the map instead of freezing a canonical question", (context) => {
  const storage = memoryStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  context.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  const stop = REQUIRED_STOPS[0];
  const questions = QUESTIONS_BY_STOP.get(stop.id);
  const question = questions[0];
  const initial = startStop(createInitialProgress(), stop.id);
  const wrong = answerQuestion(initial, stop.id, question, (question.correctIndex + 1) % question.choices.length);
  const correct = answerQuestion(initial, stop.id, question, question.correctIndex);
  const validStates = [initial, wrong, allowRetry(wrong, stop.id), correct,
    advanceQuestion(correct, stop.id, questions.length), solveStop(initial, stop.id)];
  for (const progress of validStates) {
    writeWorldProgress(progress);
    assert.deepEqual(readWorldProgress(), progress, "legitimate answer phases and checkpoints survive reload");
  }

  const invalidAttempts = [
    { ...initial.stopAttempts[stop.id], questionIndex: questions.length },
    { ...initial.stopAttempts[stop.id], questionIndex: 99 },
    { ...initial.stopAttempts[stop.id], questionIndex: 1 },
    ...[-1, 5, 0.5].map((selectedIndex) => ({ ...wrong.stopAttempts[stop.id], selectedIndex })),
    { ...wrong.stopAttempts[stop.id], selectedIndex: null },
    { ...wrong.stopAttempts[stop.id], phase: "correct" },
    { ...correct.stopAttempts[stop.id], solvedQuestionIds: [] },
  ];
  for (const attempt of invalidAttempts) {
    writeWorldProgress({ ...initial, stopAttempts: { [stop.id]: attempt } });
    const recovered = readWorldProgress();
    assert.equal(recovered.activeStopId, null);
    assert.equal(recovered.stopAttempts[stop.id], undefined);
    const restarted = startStop(recovered, stop.id);
    assert.equal(answerQuestion(restarted, stop.id, question, question.correctIndex).stopAttempts[stop.id].phase, "correct");
  }

  writeWorldProgress({ ...initial, checkpointStopId: stop.id, stopAttempts: {} });
  assert.equal(readWorldProgress().activeStopId, null);
  assert.equal(readWorldProgress().checkpointStopId, null);

  writeWorldProgress({ ...correct, stopAttempts: { [stop.id]: {
    ...correct.stopAttempts[stop.id],
    solvedQuestionIds: [question.id, question.id, "unknown-question"],
    firstTryCorrect: { [question.id]: true, "unknown-question": true },
  } } });
  assert.deepEqual(readWorldProgress(), correct, "unknown and duplicate question references are removed without losing a valid attempt");
});


test("world navigation follows earned progress and never starts a question", () => {
  let progress = createInitialProgress();
  assert.equal(progress.selectedWorldId, WORLD_DEFINITIONS[0].id);
  assert.equal(canOpenWorld(progress, "unknown", true), false);
  assert.equal(selectWorld(progress, "unknown", true), progress);
  for (const [index, world] of WORLD_DEFINITIONS.entries()) {
    assert.equal(canOpenWorld(progress, world.id), index === 0);
    assert.equal(canOpenWorld(progress, world.id, true), true);
    const inspected = selectWorld(progress, world.id, true);
    assert.equal(inspected.selectedWorldId, world.id);
    assert.equal(inspected.activeStopId, null);
    assert.deepEqual(inspected.completedStopIds, []);
    if (index > 0) assert.equal(selectWorld(progress, world.id), progress);
  }
  for (const [index, world] of WORLD_DEFINITIONS.entries()) {
    for (const stop of stopsForWorld(world.id)) {
      assert.equal(nextRequiredStopId(progress), stop.id);
      progress = solveStop(startStop(progress, stop.id), stop.id);
      assert.equal(progress.activeStopId, null, "completion returns to the map");
      assert.equal(progress.checkpointStopId, stop.id);
    }
    assert.equal(nextRequiredStopId(progress, world.id), null);
    const next = WORLD_DEFINITIONS[index + 1];
    if (next) {
      assert.equal(canOpenWorld(progress, next.id), true);
      progress = selectWorld(progress, next.id);
      assert.equal(progress.selectedWorldId, next.id);
      assert.equal(progress.activeStopId, null);
      assert.equal(progress.checkpointStopId, null);
    }
  }
  assert.equal(nextRequiredStopId(progress), null);
});

test("selected QA world survives reload without touching the prototype or Journey saves", (context) => {
  const storage = memoryStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  context.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  storage.setItem(PROGRESSION_STORAGE_KEY, "untouched-journey");
  if (WORLD_MODE === "spiral-preview") storage.setItem("spatial-gym-math-world-progress", "untouched-prototype");
  const selected = selectWorld(createInitialProgress(), WORLD_DEFINITIONS.at(-1).id, true);
  writeWorldProgress(selected, true);
  assert.deepEqual(readWorldProgress(true), selected);
  assert.equal(readWorldProgress().selectedWorldId, WORLD_DEFINITIONS[0].id);
  assert.equal(storage.getItem(PROGRESSION_STORAGE_KEY), "untouched-journey");
  if (WORLD_MODE === "spiral-preview") assert.equal(storage.getItem("spatial-gym-math-world-progress"), "untouched-prototype");
});


test("playtest notes preserve other curriculum versions and migrate matching legacy notes", (context) => {
  const storage = memoryStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  context.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  const version = createInitialProgress().contentVersion;
  const old = JSON.stringify({ schemaVersion: 1, contentVersion: "another-curriculum", records: { old: { note: "Keep this review" } } });
  storage.setItem("spatial-gym-math-world-qa", old);
  assert.deepEqual(readQaArchive().records, {});
  const record = { questionId: WORLD_QUESTIONS[0].id, stopId: WORLD_QUESTIONS[0].stopId, categories: [], note: "Current review", status: "looks-good", firstSelectedIndex: null, updatedAt: "2026-09-22T00:00:00Z" };
  writeQaRecord(record);
  assert.equal(storage.getItem("spatial-gym-math-world-qa"), old);
  assert.deepEqual(readQaArchive().records[record.questionId], record);
  storage.removeItem(`spatial-gym-math-world-qa:${WORLD_MODE}:${version}`);
  const legacy = JSON.stringify({ schemaVersion: 1, contentVersion: version, records: { saved: { note: "Matching legacy review" } } });
  storage.setItem("spatial-gym-math-world-qa", legacy);
  assert.equal(readQaArchive().records.saved.note, "Matching legacy review");
  writeQaRecord(record);
  assert.equal(readQaArchive().records.saved.note, "Matching legacy review");
  assert.equal(storage.getItem("spatial-gym-math-world-qa"), legacy);
});
