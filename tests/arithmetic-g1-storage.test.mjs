import assert from "node:assert/strict";
import test from "node:test";

import { createG1AttemptEvent } from "../lib/arithmetic-fluency/mastery.ts";
import { generateG1Question } from "../lib/arithmetic-fluency/generator.ts";
import {
  ARITHMETIC_FLUENCY_SCHEMA_VERSION,
  ARITHMETIC_FLUENCY_STORAGE_KEY,
  appendArithmeticAttempt,
  arithmeticFluencyStorageKey,
  clearArithmeticFluencyData,
  createArithmeticFluencyRepository,
  loadArithmeticFluencyDiagnostic,
} from "../lib/arithmetic-fluency/storage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function profileStorage(base, profileId) {
  const prefix = `profile:${profileId}:`;
  return {
    getItem(key) {
      return base.getItem(prefix + key);
    },
    setItem(key, value) {
      base.setItem(prefix + key, value);
    },
    removeItem(key) {
      base.removeItem(prefix + key);
    },
  };
}

function event(id = "storage-event", curriculumVersion) {
  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: id,
    difficultyBand: 1,
    orientation: "horizontal",
  });
  assert.equal(question.exactAnswer.kind, "integer");
  const resolvedQuestion = curriculumVersion === undefined
    ? question
    : { ...question, curriculumVersion };
  return createG1AttemptEvent({
    id,
    learnerId: "storage-learner",
    sessionId: "storage-session",
    question: resolvedQuestion,
    startedAt: 1_000,
    completedAt: 2_000,
    activeSolveTimeMs: 700,
    submissions: [{
      submittedAt: 1_700,
      inputMode: "handwriting",
      rawInput: "raw-stroke-payload",
      answer: question.exactAnswer.value,
      recognition: {
        raw: "raw-stroke-payload",
        recognizedAnswer: question.exactAnswer.value,
        confidence: 0.93,
        margin: 0.41,
        processingMs: 72,
        status: "confirmed",
        confirmedAnswer: question.exactAnswer.value,
      },
    }],
  });
}

test("profile-scoped adapters isolate immutable raw attempt ledgers", () => {
  const base = memoryStorage();
  const child = createArithmeticFluencyRepository(profileStorage(base, "child"));
  const tester = createArithmeticFluencyRepository(profileStorage(base, "tester"));

  assert.equal(child.load().status, "empty");
  const write = child.append(event(), 3_000);
  assert.equal(write.ok, true);
  assert.equal(write.status, "saved");
  assert.equal(tester.load().store.attemptEvents.length, 0);

  const loaded = child.load();
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.store.attemptEvents.length, 1);
  assert.equal(loaded.store.attemptEvents[0].submissions[0].rawInput, "raw-stroke-payload");
  assert.equal(
    loaded.store.attemptEvents[0].question.instanceId,
    loaded.store.attemptEvents[0].questionInstanceId,
  );
  assert.equal(loaded.store.attemptEvents[0].recognitionMargin, 0.41);
  assert.equal(loaded.store.attemptEvents[0].recognitionProcessingMs, 72);
  assert.equal(Object.isFrozen(loaded.store.attemptEvents[0]), true);
});

test("append is idempotent by event ID and rejects conflicting immutable history", () => {
  const storage = memoryStorage();
  const original = event("same-id");
  assert.equal(appendArithmeticAttempt(original, storage, undefined, 3_000).status, "saved");
  const duplicate = appendArithmeticAttempt(original, storage, undefined, 4_000);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.store.attemptEvents.length, 1);

  const conflicting = { ...event("other-id"), id: "same-id" };
  const rejected = appendArithmeticAttempt(conflicting, storage, undefined, 5_000);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, "conflict");
  assert.equal(rejected.store.attemptEvents.length, 1);
});

test("blocked, corrupt, newer, and quota-limited storage never crashes", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(loadArithmeticFluencyDiagnostic(blocked).status, "unavailable");
  assert.equal(appendArithmeticAttempt(event("blocked"), blocked).status, "unavailable");
  assert.equal(clearArithmeticFluencyData(blocked), false);

  const corrupt = memoryStorage();
  corrupt.setItem(ARITHMETIC_FLUENCY_STORAGE_KEY, "not-json");
  assert.equal(loadArithmeticFluencyDiagnostic(corrupt).status, "corrupt");
  assert.equal(appendArithmeticAttempt(event("corrupt"), corrupt).status, "corrupt");

  const newer = memoryStorage();
  newer.setItem(
    ARITHMETIC_FLUENCY_STORAGE_KEY,
    JSON.stringify({ schemaVersion: ARITHMETIC_FLUENCY_SCHEMA_VERSION + 1, attemptEvents: [] }),
  );
  assert.equal(loadArithmeticFluencyDiagnostic(newer).status, "unsupported");
  assert.equal(appendArithmeticAttempt(event("newer"), newer).status, "unsupported");

  const quota = memoryStorage();
  quota.setItem = () => {
    const error = new Error("full");
    error.name = "QuotaExceededError";
    throw error;
  };
  const quotaResult = appendArithmeticAttempt(event("quota"), quota);
  assert.equal(quotaResult.ok, false);
  assert.equal(quotaResult.status, "quota");
});

test("schema migration and curriculum-version changes preserve historical events", () => {
  const storage = memoryStorage();
  const historical = event("historical", 7);
  storage.setItem(
    ARITHMETIC_FLUENCY_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 0,
      events: [historical],
      updatedAt: 9_000,
    }),
  );
  const loaded = loadArithmeticFluencyDiagnostic(storage);
  assert.equal(loaded.status, "migrated");
  assert.equal(loaded.store.schemaVersion, ARITHMETIC_FLUENCY_SCHEMA_VERSION);
  assert.equal(loaded.store.attemptEvents[0].curriculumVersion, 7);
});

test("data can be cleared per profile and direct profile keys are stable", () => {
  assert.equal(
    arithmeticFluencyStorageKey("child one"),
    `${ARITHMETIC_FLUENCY_STORAGE_KEY}:child%20one`,
  );
  const storage = memoryStorage();
  appendArithmeticAttempt(event("clear-me"), storage);
  assert.equal(clearArithmeticFluencyData(storage), true);
  assert.equal(loadArithmeticFluencyDiagnostic(storage).status, "empty");
});
