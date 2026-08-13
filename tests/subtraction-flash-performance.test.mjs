import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SCRUB_FRAMES,
  PERFORMANCE_LATENCY_BINS,
  buildLatencyDistribution,
  buildRollingPerformanceFrames,
  filterPerformanceAttempts,
  normalizePerformanceAttempts,
} from "../app/lab/subtraction-flash/performance-analytics.ts";
import {
  PERFORMANCE_SCHEMA_VERSION,
  PERFORMANCE_LEGACY_STORAGE_KEY,
  PERFORMANCE_STORAGE_KEY,
  appendPerformanceAttempt,
  createPerformanceAttempt,
  createPerformanceSession,
  finishPerformanceSession,
  loadPerformanceLogDiagnostic,
  performanceAttemptsToCsv,
  startPerformanceSession,
} from "../app/lab/subtraction-flash/performance-storage.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function withoutV2Fields(record) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        key !== "level" &&
        key !== "inputMode" &&
        key !== "attemptOrdinal" &&
        key !== "firstAttempt" &&
        key !== "sessionLane",
    ),
  );
}

const BASE_TIME = new Date(2026, 0, 15, 9, 30).getTime();

function coreAttempt(changes = {}) {
  const sessionPosition = changes.sessionPosition ?? 1;
  const elapsedMs = changes.elapsedMs ?? 1_500;
  const correct = changes.correct ?? true;
  return createPerformanceAttempt({
    sessionId: "run-1",
    occurredAt: BASE_TIME + sessionPosition * 1_000,
    sessionPosition,
    gameType: "infinite",
    level: "B100",
    presentationMode: "visual",
    inputMode: "tap",
    orientation: "horizontal",
    inputSource: "tap",
    cardId: `visual:1:13-4:${sessionPosition}`,
    factKey: "13-4",
    minuend: 13,
    subtrahend: 4,
    expectedAnswer: 9,
    submittedAnswer: correct ? 9 : 8,
    correct,
    elapsedMs,
    slow: elapsedMs > 4_000,
    isReview: false,
    drawNumber: sessionPosition,
    cycle: 1,
    cardsRemainingAfter: Math.max(0, 72 - sessionPosition),
    sessionElapsedMs: sessionPosition * 2_000,
    ...changes,
  });
}

function normalizedAttempt(changes = {}) {
  return {
    id: "test:1",
    source: "flash",
    sessionId: "run",
    timestamp: BASE_TIME,
    localDate: "2026-01-15",
    localTime: "09:30:00.000",
    timeZone: "America/Los_Angeles",
    utcOffsetMinutes: -480,
    gameType: "infinite",
    level: "B100",
    presentationMode: "visual",
    inputMode: "tap",
    orientation: "horizontal",
    inputSource: "tap",
    minuend: 13,
    subtrahend: 4,
    expectedAnswer: 9,
    submittedAnswer: 9,
    correct: true,
    latencyMs: 1_000,
    timingEligible: true,
    slow: false,
    isReview: false,
    cardId: "visual:1:13-4:1",
    factKey: "13-4",
    drawNumber: 1,
    cycle: 1,
    cardsRemainingAfter: 71,
    sessionPosition: 1,
    sessionElapsedMs: 1_000,
    outcomeReason: null,
    reviewQueued: false,
    reinserted: false,
    rawRecognition: null,
    recognitionConfidence: null,
    recognitionMargin: null,
    recognitionProcessingMs: null,
    ...changes,
  };
}

test("storage appends strict session and attempt events without rewriting duplicates", () => {
  const storage = new MemoryStorage();
  const session = createPerformanceSession({
    sessionId: "run-1",
    gameType: "infinite",
    level: "B100",
    presentationMode: "visual",
    inputMode: "tap",
    baseDeckSize: 72,
    startedAt: BASE_TIME,
  });
  const attempt = coreAttempt({
    rawRecognition: "nine, clearly",
    recognitionConfidence: 0.91,
    recognitionMargin: 0.4,
    recognitionProcessingMs: 32,
  });

  assert.deepEqual(startPerformanceSession(session, storage), {
    ok: true,
    status: "written",
  });
  assert.deepEqual(appendPerformanceAttempt(attempt, storage), {
    ok: true,
    status: "written",
  });
  assert.deepEqual(appendPerformanceAttempt(attempt, storage), {
    ok: true,
    status: "duplicate",
  });
  const conflicting = { ...attempt, elapsedMs: attempt.elapsedMs + 1 };
  assert.deepEqual(appendPerformanceAttempt(conflicting, storage), {
    ok: false,
    status: "conflict",
  });
  assert.deepEqual(
    appendPerformanceAttempt(
      coreAttempt({
        id: "run-1:wrong-configured-mode",
        inputMode: "draw",
        inputSource: "handwriting",
      }),
      storage,
    ),
    { ok: false, status: "conflict" },
  );
  assert.deepEqual(
    finishPerformanceSession(
      "run-1",
      {
        finishedAt: BASE_TIME + 10_000,
        finishReason: "manual",
        elapsedMs: 10_000,
        answered: 1,
        correct: 1,
        slow: 0,
        reviews: 0,
        baseDeckSize: 72,
      },
      storage,
    ),
    { ok: true, status: "written" },
  );

  const loaded = loadPerformanceLogDiagnostic(storage);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.canWrite, true);
  assert.equal(loaded.log?.schemaVersion, PERFORMANCE_SCHEMA_VERSION);
  assert.equal(loaded.log?.attempts.length, 1);
  assert.equal(loaded.log?.sessionEvents.length, 2);
  assert.equal(loaded.log?.attempts[0].rawRecognition, "nine, clearly");
  assert.equal(loaded.log?.attempts[0].attemptOrdinal, 1);
  assert.equal(loaded.log?.attempts[0].firstAttempt, true);
  assert.equal(loaded.log?.attempts[0].sessionLane, "main");

  const csv = performanceAttemptsToCsv(undefined, storage);
  assert.match(csv, /date,time,time_zone/);
  assert.match(csv, /correct,true,1500/);
  assert.match(csv, /"nine, clearly"/);
});

test("raw retries and redemption stay stored while analysis scores only the first miss", () => {
  const storage = new MemoryStorage();
  assert.equal(
    startPerformanceSession(
      createPerformanceSession({
        sessionId: "retry-run",
        gameType: "infinite",
        level: "B100",
        presentationMode: "visual",
        inputMode: "draw",
        baseDeckSize: 72,
        startedAt: BASE_TIME,
      }),
      storage,
    ).ok,
    true,
  );

  const shared = {
    sessionId: "retry-run",
    inputMode: "draw",
    inputSource: "handwriting",
    cardId: "visual:1:13-4:1",
  };
  const firstMiss = coreAttempt({
    ...shared,
    sessionPosition: 1,
    submittedAnswer: 8,
    correct: false,
    attemptOrdinal: 1,
    firstAttempt: true,
    sessionLane: "main",
    rawRecognition: "8",
    recognitionConfidence: 0.94,
  });
  const retrySuccess = coreAttempt({
    ...shared,
    sessionPosition: 2,
    submittedAnswer: 9,
    correct: true,
    attemptOrdinal: 2,
    firstAttempt: false,
    sessionLane: "retry",
    rawRecognition: "9",
    recognitionConfidence: 0.9,
  });
  const redemptionSuccess = coreAttempt({
    ...shared,
    sessionPosition: 3,
    submittedAnswer: 9,
    correct: true,
    attemptOrdinal: 1,
    firstAttempt: false,
    sessionLane: "redemption",
    isReview: true,
    rawRecognition: "nine",
    recognitionConfidence: 0.86,
  });

  for (const attempt of [firstMiss, retrySuccess, redemptionSuccess]) {
    assert.equal(appendPerformanceAttempt(attempt, storage).ok, true);
  }

  const raw = loadPerformanceLogDiagnostic(storage).log?.attempts ?? [];
  assert.equal(raw.length, 3);
  assert.deepEqual(
    raw.map(({ attemptOrdinal, firstAttempt, sessionLane, rawRecognition }) => ({
      attemptOrdinal,
      firstAttempt,
      sessionLane,
      rawRecognition,
    })),
    [
      {
        attemptOrdinal: 1,
        firstAttempt: true,
        sessionLane: "main",
        rawRecognition: "8",
      },
      {
        attemptOrdinal: 2,
        firstAttempt: false,
        sessionLane: "retry",
        rawRecognition: "9",
      },
      {
        attemptOrdinal: 1,
        firstAttempt: false,
        sessionLane: "redemption",
        rawRecognition: "nine",
      },
    ],
  );

  const normalized = normalizePerformanceAttempts(raw, []);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].correct, false);
  assert.equal(buildLatencyDistribution(normalized).infinity.count, 1);

  const [header, ...rows] = performanceAttemptsToCsv(raw, storage).split("\r\n");
  assert.equal(rows.length, 3);
  assert.match(header, /attempt_ordinal,first_attempt,session_lane/);
  assert.match(rows[1], /retry/);
  assert.match(rows[2], /redemption/);
});

test("attempt progress metadata rejects ambiguous scored retries", () => {
  assert.throws(
    () =>
      coreAttempt({
        attemptOrdinal: 2,
        firstAttempt: true,
        sessionLane: "retry",
      }),
    /Only ordinal 1 in the main lane/,
  );
  assert.throws(
    () => coreAttempt({ attemptOrdinal: 0 }),
    /positive integer/,
  );
});

test("existing v2 rows gain first-attempt metadata without rewriting storage", () => {
  const storage = new MemoryStorage();
  const current = coreAttempt({ isReview: true });
  const legacyV2 = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) =>
        key !== "attemptOrdinal" &&
        key !== "firstAttempt" &&
        key !== "sessionLane",
    ),
  );
  const serialized = JSON.stringify({
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    attempts: [legacyV2],
    sessionEvents: [],
  });
  storage.setItem(PERFORMANCE_STORAGE_KEY, serialized);

  const loaded = loadPerformanceLogDiagnostic(storage);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.log?.attempts[0].attemptOrdinal, 1);
  assert.equal(loaded.log?.attempts[0].firstAttempt, false);
  assert.equal(loaded.log?.attempts[0].sessionLane, "redemption");
  assert.equal(storage.getItem(PERFORMANCE_STORAGE_KEY), serialized);
});

test("corrupt and newer-schema storage is diagnosed and never overwritten", () => {
  for (const raw of [
    "{bad json",
    JSON.stringify({ schemaVersion: 99, attempts: [], sessionEvents: [] }),
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(PERFORMANCE_STORAGE_KEY, raw);
    const diagnostic = loadPerformanceLogDiagnostic(storage);
    assert.equal(diagnostic.canWrite, false);
    assert.ok(["corrupt", "unsupported"].includes(diagnostic.status));
    assert.equal(appendPerformanceAttempt(coreAttempt(), storage).ok, false);
    assert.equal(storage.getItem(PERFORMANCE_STORAGE_KEY), raw);
  }
});

test("v1 logs migrate in memory and are preserved when v2 data is written", () => {
  const storage = new MemoryStorage();
  const currentAttempt = coreAttempt({
    inputMode: "draw",
    inputSource: "handwriting",
  });
  const currentSession = createPerformanceSession({
    sessionId: "run-1",
    gameType: "infinite",
    level: "B100",
    presentationMode: "visual",
    inputMode: "draw",
    baseDeckSize: 72,
    startedAt: BASE_TIME,
  });
  const legacyAttempt = withoutV2Fields(currentAttempt);
  const legacySession = withoutV2Fields(currentSession);
  const legacyRaw = JSON.stringify({
    schemaVersion: 1,
    attempts: [legacyAttempt],
    sessionEvents: [legacySession],
  });
  storage.setItem(PERFORMANCE_LEGACY_STORAGE_KEY, legacyRaw);

  const migrated = loadPerformanceLogDiagnostic(storage);
  assert.equal(migrated.status, "loaded");
  assert.equal(migrated.log?.schemaVersion, PERFORMANCE_SCHEMA_VERSION);
  assert.equal(migrated.log?.attempts[0].level, "B100");
  assert.equal(migrated.log?.attempts[0].inputMode, "draw");
  assert.equal(migrated.log?.sessionEvents[0].inputMode, "draw");
  assert.equal(storage.getItem(PERFORMANCE_STORAGE_KEY), null);

  const b120Session = createPerformanceSession({
    sessionId: "run-b120",
    gameType: "infinite",
    level: "B120",
    presentationMode: "visual",
    inputMode: "speak",
    baseDeckSize: 100,
    startedAt: BASE_TIME + 1_000,
  });
  assert.equal(startPerformanceSession(b120Session, storage).ok, true);
  const b120Attempt = createPerformanceAttempt({
    ...coreAttempt({
      id: "run-b120:1",
      sessionId: "run-b120",
      sessionPosition: 2,
      level: "B120",
      inputMode: "speak",
      inputSource: "speech",
      cardId: "visual:1:64-10:2",
      factKey: "64-10",
      minuend: 64,
      subtrahend: 10,
      expectedAnswer: 54,
      submittedAnswer: 54,
    }),
  });
  assert.equal(appendPerformanceAttempt(b120Attempt, storage).ok, true);
  assert.equal(storage.getItem(PERFORMANCE_LEGACY_STORAGE_KEY), legacyRaw);
  const persistedV2 = JSON.parse(storage.getItem(PERFORMANCE_STORAGE_KEY));
  assert.equal(persistedV2.schemaVersion, 2);
  assert.equal(persistedV2.attempts.length, 2);
  assert.equal(persistedV2.sessionEvents.length, 2);
});

test("B120 accepts borrowing facts through 64 and the explicit minus-ten exception", () => {
  const accepted = coreAttempt({
    level: "B120",
    minuend: 64,
    subtrahend: 10,
    expectedAnswer: 54,
    submittedAnswer: 54,
    factKey: "64-10",
    cardId: "visual:1:64-10:1",
  });
  assert.equal(accepted.level, "B120");
  assert.equal(accepted.subtrahend, 10);

  assert.throws(
    () => coreAttempt({
      level: "B120",
      minuend: 64,
      subtrahend: 2,
      expectedAnswer: 62,
      submittedAnswer: 62,
      factKey: "64-2",
      cardId: "visual:1:64-2:1",
    }),
    /selected level/,
  );
});

test("wrong answers are the infinity spike while summary timing is correct-only", () => {
  const rows = [
    normalizedAttempt({ id: "a", latencyMs: 1_000 }),
    normalizedAttempt({ id: "b", latencyMs: 3_000 }),
    normalizedAttempt({ id: "c", correct: false, latencyMs: 800 }),
  ];
  const distribution = buildLatencyDistribution(rows);
  assert.equal(distribution.totalCount, 3);
  assert.equal(distribution.correctCount, 2);
  assert.equal(distribution.infinity.count, 1);
  assert.equal(distribution.infinity.share, 1 / 3);
  assert.equal(distribution.correctMeanMs, 2_000);
  assert.equal(distribution.correctMedianMs, 2_000);
  assert.equal(distribution.correctP90Ms, 2_800);
});

test("trace answers count toward accuracy without distorting fluency timing", () => {
  const rows = [
    normalizedAttempt({ id: "tap", latencyMs: 1_000 }),
    normalizedAttempt({
      id: "trace",
      inputSource: "trace",
      latencyMs: 9_000,
      timingEligible: false,
    }),
  ];
  const distribution = buildLatencyDistribution(rows);
  assert.equal(distribution.totalCount, 2);
  assert.equal(distribution.correctCount, 2);
  assert.equal(distribution.accuracy, 1);
  assert.equal(distribution.timedCorrectCount, 1);
  assert.equal(distribution.correctMeanMs, 1_000);
  assert.equal(distribution.correctMedianMs, 1_000);
  assert.equal(distribution.correctP90Ms, 1_000);
  assert.equal(
    distribution.bins.find((bin) => bin.id === "8-12")?.count,
    0,
  );
});

test("fixed bins use half-open edges and retain extreme correct outliers", () => {
  const latencies = [0, 999, 1_000, 1_999, 2_000, 5_999, 6_000, 7_999, 8_000, 11_999, 12_000, 999_999];
  const rows = latencies.map((latencyMs, index) =>
    normalizedAttempt({ id: `edge:${index}`, latencyMs }),
  );
  const distribution = buildLatencyDistribution(rows);
  assert.deepEqual(
    distribution.bins.map((bin) => [bin.id, bin.count]),
    [
      ["0-1", 2],
      ["1-2", 2],
      ["2-3", 1],
      ["3-4", 0],
      ["4-5", 0],
      ["5-6", 1],
      ["6-8", 2],
      ["8-12", 2],
      ["12+", 2],
    ],
  );
  assert.deepEqual(
    distribution.bins.map((bin) => bin.id),
    PERFORMANCE_LATENCY_BINS.map((bin) => bin.id),
  );
});

test("normalization and filters combine Flash and adaptive attempt rows", () => {
  const flash = coreAttempt({
    gameType: "two-minute",
    presentationMode: "listen",
    orientation: null,
    inputSource: "speech",
    inputMode: "speak",
  });
  const adaptive = {
    id: "adaptive-1",
    learnerId: "learner",
    sessionId: "adaptive-run",
    problemId: "problem",
    problem: null,
    problemSeed: "seed",
    problemFingerprint: "subtraction:15:7",
    skillId: "A03",
    supportingSkillIds: [],
    operands: { minuend: 15, subtrahend: 7 },
    metadata: {
      templateId: "test",
      format: "vertical",
      operation: "subtraction",
    },
    sessionPosition: 2,
    sessionLane: "review",
    relatedProblemId: null,
    relatedProblemRelation: null,
    shownAt: BASE_TIME + 1_000,
    firstInkAt: BASE_TIME + 1_100,
    submittedAt: BASE_TIME + 3_000,
    responseMs: 2_000,
    firstInkLatencyMs: 100,
    writingDurationMs: 1_900,
    appWasBackgrounded: false,
    interruptionDurationMs: 0,
    timingEligible: true,
    rawRecognizedValue: "8",
    normalizedRecognizedValue: 8,
    recognitionConfidence: 0.9,
    recognitionMargin: 0.5,
    recognitionConfirmedByChild: false,
    recognizerCorrection: false,
    expectedAnswer: 8,
    firstAttemptCorrect: true,
    eventuallyCorrect: true,
    independent: true,
    hintLevelUsed: 0,
    correctionCount: 0,
    skipped: false,
    pauseUsed: false,
    workedAnswerVisible: false,
    errorCode: null,
    diagnosticProbeResult: null,
    format: "vertical",
    operation: "subtraction",
  };

  const normalized = normalizePerformanceAttempts([flash], [adaptive]);
  assert.deepEqual(normalized.map((row) => row.gameType), ["two-minute", "adaptive"]);
  assert.deepEqual(normalized.map((row) => row.level), ["B100", null]);
  assert.deepEqual(normalized.map((row) => row.inputMode), ["speak", null]);
  assert.equal(normalized[1].inputSource, "handwriting");
  assert.equal(normalized[1].isReview, true);

  assert.deepEqual(
    filterPerformanceAttempts(normalized, {
      gameTypes: ["adaptive"],
      inputSources: ["handwriting"],
      minuends: [15],
      subtrahends: [7],
      dateFrom: normalized[1].localDate,
      dateTo: normalized[1].localDate,
    }).map((row) => row.id),
    ["adaptive:adaptive-1"],
  );
  assert.equal(
    filterPerformanceAttempts(normalized, { presentationModes: ["listen"] }).length,
    1,
  );
  assert.equal(
    filterPerformanceAttempts(normalized, {
      levels: ["B100"],
      inputModes: ["speak"],
    }).length,
    1,
  );
});

test("trace attempts round-trip through storage, filters, and CSV export", () => {
  const storage = new MemoryStorage();
  const session = createPerformanceSession({
    sessionId: "trace-run",
    gameType: "infinite",
    level: "B100",
    presentationMode: "visual",
    inputMode: "trace",
    baseDeckSize: 72,
    startedAt: BASE_TIME,
  });
  const attempt = coreAttempt({
    id: "trace-run:1",
    sessionId: "trace-run",
    inputSource: "trace",
    inputMode: "trace",
    elapsedMs: 5_875,
    slow: false,
  });

  assert.deepEqual(startPerformanceSession(session, storage), {
    ok: true,
    status: "written",
  });
  assert.deepEqual(appendPerformanceAttempt(attempt, storage), {
    ok: true,
    status: "written",
  });

  const loaded = loadPerformanceLogDiagnostic(storage);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.log?.attempts.length, 1);
  assert.equal(loaded.log?.attempts[0].inputSource, "trace");

  const normalized = normalizePerformanceAttempts(
    loaded.log?.attempts ?? [],
    [],
  );
  assert.equal(normalized[0].inputSource, "trace");
  assert.equal(
    normalized[0].timingEligible,
    false,
    "motor-tracing time is not treated as subtraction-fluency timing",
  );
  assert.equal(normalized[0].slow, false);
  assert.deepEqual(
    filterPerformanceAttempts(normalized, { inputSources: ["trace"] }).map(
      (row) => row.id,
    ),
    [`flash:${attempt.id}`],
  );
  assert.equal(
    filterPerformanceAttempts(normalized, { inputSources: ["tap"] }).length,
    0,
  );

  const [header, row] = performanceAttemptsToCsv(undefined, storage).split(
    "\r\n",
  );
  const columns = header.split(",");
  const values = row.split(",");
  assert.equal(values[columns.indexOf("input_source")], "trace");
  assert.equal(values[columns.indexOf("input_mode")], "trace");
  assert.equal(values[columns.indexOf("level")], "B100");
});

test("rolling scrub frames are capped and reuse the fixed distribution bins", () => {
  const rows = Array.from({ length: 75 }, (_, index) =>
    normalizedAttempt({
      id: `timeline:${index}`,
      timestamp: BASE_TIME + index * 86_400_000,
      localDate: new Date(BASE_TIME + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      latencyMs: 500 + index * 200,
      correct: index % 7 !== 0,
    }),
  );
  const frames = buildRollingPerformanceFrames(rows, { maxFrames: 100 });
  assert.equal(frames.length, MAX_SCRUB_FRAMES);
  assert.equal(frames.at(-1)?.timestamp, rows.at(-1)?.timestamp);
  assert.ok((frames.at(-1)?.attemptCount ?? 0) > 1);
  for (const frame of frames) {
    assert.deepEqual(
      frame.distribution.bins.map((bin) => bin.id),
      PERFORMANCE_LATENCY_BINS.map((bin) => bin.id),
    );
  }

  const shortWindow = buildRollingPerformanceFrames(rows, {
    maxFrames: 3,
    windowMs: 0,
  });
  assert.deepEqual(shortWindow.map((frame) => frame.attemptCount), [1, 1, 1]);
});
