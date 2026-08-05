import assert from "node:assert/strict";
import test from "node:test";

import {
  MK_CONTENT_VERSION,
  MK_ROUNDS,
} from "../app/journey/reviews/math-kangaroo/authored-rounds.ts";
import {
  DEFAULT_MK_LAB_FILTERS,
  MK_LAB_ANSWER_LETTERS,
  MK_LAB_MECHANICS,
  drawMkLabQuestion,
  filterMkLabRounds,
  mathKangarooPointValue,
  shuffleMkLabAnswers,
} from "../app/lab/math-kangaroo/engine.ts";
import {
  MK_LAB_QA_ISSUES,
  MK_LAB_STORAGE_KEY,
  captureMkLabQaObservation,
  hasMkLabQaFeedback,
  mkLabQaStorageKey,
  readMkLabQaArchives,
  readMkLabQaFeedback,
  readMkLabProgress,
  restoreMkLabDraw,
  writeMkLabQaFeedback,
  writeMkLabProgress,
} from "../app/lab/math-kangaroo/storage.ts";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("Math Kangaroo point bands follow source question positions", () => {
  assert.equal(mathKangarooPointValue(1), 3);
  assert.equal(mathKangarooPointValue(8), 3);
  assert.equal(mathKangarooPointValue(9), 4);
  assert.equal(mathKangarooPointValue(16), 4);
  assert.equal(mathKangarooPointValue(17), 5);
  assert.equal(mathKangarooPointValue(24), 5);
  assert.throws(() => mathKangarooPointValue(0), /between 1 and 24/);
  assert.throws(() => mathKangarooPointValue(25), /between 1 and 24/);
});

test("grade, point, and question-type filters compose exactly", () => {
  const filters = {
    gradeBand: "grades-3-4",
    points: 5,
    mechanic: "folding-nets",
  };
  const matches = filterMkLabRounds(MK_ROUNDS, filters);

  assert.ok(matches.length > 0);
  assert.ok(
    matches.every(
      (round) =>
        round.source.gradeBand === filters.gradeBand &&
        mathKangarooPointValue(round.source.questionNumber) === filters.points &&
        round.mechanic === filters.mechanic,
    ),
  );
  assert.deepEqual(
    new Set(MK_ROUNDS.map(({ mechanic }) => mechanic)),
    new Set(MK_LAB_MECHANICS),
  );
});

test("every draw exposes one shuffled A-E answer mapping", () => {
  const round = MK_ROUNDS[0];
  const answers = shuffleMkLabAnswers(round, seededRandom(14));

  assert.deepEqual(
    answers.map(({ letter }) => letter),
    MK_LAB_ANSWER_LETTERS,
  );
  assert.deepEqual(
    [...answers.map(({ sourceIndex }) => sourceIndex)].sort(),
    [0, 1, 2, 3, 4],
  );
  assert.equal(answers.filter(({ correct }) => correct).length, 1);
  assert.notEqual(
    answers.findIndex(({ correct }) => correct),
    round.correctIndex,
    "the public answer letter must differ from the source answer placement",
  );
  assert.equal(
    answers.find(({ correct }) => correct)?.sourceIndex,
    round.correctIndex,
  );
});

test("random draws avoid repeats until the filtered pool is exhausted", () => {
  const filters = {
    gradeBand: "grades-1-2",
    points: 5,
    mechanic: "rotation-reflection",
  };
  const pool = filterMkLabRounds(MK_ROUNDS, filters);
  const random = seededRandom(88);
  const seen = new Set();
  let previousId;

  for (let index = 0; index < pool.length; index += 1) {
    const draw = drawMkLabQuestion({
      rounds: MK_ROUNDS,
      filters,
      seenIds: seen,
      avoidId: previousId,
      random,
    });
    assert.ok(draw);
    assert.equal(draw.poolSize, pool.length);
    assert.equal(seen.has(draw.round.id), false);
    seen.add(draw.round.id);
    previousId = draw.round.id;
  }

  assert.equal(seen.size, pool.length);
  const recycled = drawMkLabQuestion({
    rounds: MK_ROUNDS,
    filters,
    seenIds: seen,
    avoidId: previousId,
    random,
  });
  assert.ok(recycled);
  if (pool.length > 1) assert.notEqual(recycled.round.id, previousId);
});

test("an empty filter combination returns a recoverable empty draw", () => {
  const empty = drawMkLabQuestion({
    rounds: MK_ROUNDS,
    filters: {
      gradeBand: "grades-1-2",
      points: 5,
      mechanic: "folding-nets",
    },
    random: seededRandom(2),
  });
  assert.equal(empty, null);

  assert.equal(
    drawMkLabQuestion({
      rounds: MK_ROUNDS,
      filters: DEFAULT_MK_LAB_FILTERS,
      random: seededRandom(2),
    })?.poolSize,
    168,
  );
});

test("saved progress restores the exact question, answer shuffle, and filters", () => {
  const storage = memoryStorage();
  const filters = {
    gradeBand: "grades-3-4",
    points: 4,
    mechanic: "objects-views",
  };
  const draw = drawMkLabQuestion({
    rounds: MK_ROUNDS,
    filters,
    random: seededRandom(611),
  });
  assert.ok(draw);
  const wrongIndex = draw.answers.findIndex(({ correct }) => !correct);
  const progress = {
    filters,
    seenIds: [draw.round.id],
    solvedCount: 7,
    firstTryCorrectCount: 5,
    current: {
      roundId: draw.round.id,
      sourceIndexes: draw.answers.map(({ sourceIndex }) => sourceIndex),
      phase: "retry",
      selectedIndex: wrongIndex,
      missed: true,
    },
  };

  assert.equal(
    writeMkLabProgress(storage, progress, MK_CONTENT_VERSION),
    true,
  );
  const loaded = readMkLabProgress(storage, MK_ROUNDS, MK_CONTENT_VERSION);
  assert.ok(loaded);
  assert.deepEqual(loaded.filters, filters);
  assert.deepEqual(loaded.seenIds, [draw.round.id]);
  assert.equal(loaded.solvedCount, 7);
  assert.equal(loaded.firstTryCorrectCount, 5);
  assert.deepEqual(loaded.current, progress.current);

  const restored = restoreMkLabDraw(loaded, MK_ROUNDS);
  assert.ok(restored);
  assert.equal(restored.round.id, draw.round.id);
  assert.deepEqual(
    restored.answers.map(({ sourceIndex }) => sourceIndex),
    draw.answers.map(({ sourceIndex }) => sourceIndex),
  );
});

test("resumed draws continue excluding every saved seen question", () => {
  const storage = memoryStorage();
  const first = drawMkLabQuestion({
    rounds: MK_ROUNDS,
    filters: DEFAULT_MK_LAB_FILTERS,
    random: seededRandom(91),
  });
  assert.ok(first);
  const progress = {
    filters: DEFAULT_MK_LAB_FILTERS,
    seenIds: [first.round.id],
    solvedCount: 1,
    firstTryCorrectCount: 1,
    current: {
      roundId: first.round.id,
      sourceIndexes: first.answers.map(({ sourceIndex }) => sourceIndex),
      phase: "solved",
      selectedIndex: first.answers.findIndex(({ correct }) => correct),
      missed: false,
    },
  };
  writeMkLabProgress(storage, progress, MK_CONTENT_VERSION);

  const resumed = readMkLabProgress(storage, MK_ROUNDS, MK_CONTENT_VERSION);
  assert.ok(resumed);
  const next = drawMkLabQuestion({
    rounds: MK_ROUNDS,
    filters: resumed.filters,
    seenIds: new Set(resumed.seenIds),
    avoidId: resumed.current?.roundId,
    random: seededRandom(91),
  });
  assert.ok(next);
  assert.notEqual(next.round.id, first.round.id);
});

test("blocked, corrupt, and stale local progress fail safely", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readMkLabProgress(blocked, MK_ROUNDS, MK_CONTENT_VERSION), null);
  assert.equal(
    writeMkLabProgress(
      blocked,
      {
        filters: DEFAULT_MK_LAB_FILTERS,
        seenIds: [],
        solvedCount: 0,
        firstTryCorrectCount: 0,
        current: null,
      },
      MK_CONTENT_VERSION,
    ),
    false,
  );

  const corrupt = memoryStorage();
  corrupt.setItem(MK_LAB_STORAGE_KEY, "not json");
  assert.equal(readMkLabProgress(corrupt, MK_ROUNDS, MK_CONTENT_VERSION), null);

  const draw = drawMkLabQuestion({
    rounds: MK_ROUNDS,
    filters: DEFAULT_MK_LAB_FILTERS,
    random: seededRandom(3),
  });
  assert.ok(draw);
  writeMkLabProgress(
    corrupt,
    {
      filters: DEFAULT_MK_LAB_FILTERS,
      seenIds: [draw.round.id],
      solvedCount: 3,
      firstTryCorrectCount: 2,
      current: {
        roundId: draw.round.id,
        sourceIndexes: draw.answers.map(({ sourceIndex }) => sourceIndex),
        phase: "answering",
        selectedIndex: null,
        missed: false,
      },
    },
    "older-content-version",
  );
  const migrated = readMkLabProgress(corrupt, MK_ROUNDS, MK_CONTENT_VERSION);
  assert.ok(migrated);
  assert.equal(migrated.current, null);
  assert.deepEqual(migrated.seenIds, [draw.round.id]);
  assert.equal(migrated.solvedCount, 3);
});

test("QA feedback survives reload and is isolated by content version", () => {
  const storage = memoryStorage();
  const round = MK_ROUNDS[0];
  const feedback = {
    [round.id]: {
      verdict: "needs-change",
      issues: ["image-diagram", "layout-accessibility"],
      notes: "The lower-left detail is hard to inspect on a phone.",
      updatedAt: "2026-08-05T18:00:00.000Z",
      observedSourceIndexes: [4, 0, 2, 1, 3],
      selectedAnswerLetter: "C",
    },
  };

  assert.equal(
    writeMkLabQaFeedback(storage, feedback, MK_CONTENT_VERSION),
    true,
  );
  assert.deepEqual(
    readMkLabQaFeedback(storage, MK_ROUNDS, MK_CONTENT_VERSION),
    feedback,
  );
  assert.equal(
    readMkLabQaFeedback(storage, MK_ROUNDS, "future-content-version"),
    null,
  );
  storage.setItem(mkLabQaStorageKey("broken-content-version"), "{");
  assert.deepEqual(
    readMkLabQaArchives(storage, "future-content-version"),
    [{ contentVersion: MK_CONTENT_VERSION, feedback }],
    "feedback from the prior catalogue stays exportable after a version bump",
  );
  assert.notEqual(
    mkLabQaStorageKey(MK_CONTENT_VERSION),
    mkLabQaStorageKey("future-content-version"),
  );
  assert.equal(hasMkLabQaFeedback(feedback[round.id]), true);
});

test("QA answer snapshots preserve the first observed attempt", () => {
  const initial = {
    verdict: "needs-change",
    issues: ["answer-key"],
    notes: "The answer looked surprising.",
    updatedAt: "2026-08-05T18:00:00.000Z",
    observedSourceIndexes: [4, 0, 2, 1, 3],
    selectedAnswerLetter: null,
  };
  const firstAttempt = captureMkLabQaObservation(
    initial,
    [4, 0, 2, 1, 3],
    "B",
  );
  assert.equal(firstAttempt.selectedAnswerLetter, "B");
  assert.notEqual(firstAttempt.updatedAt, initial.updatedAt);
  assert.equal(
    captureMkLabQaObservation(firstAttempt, [4, 0, 2, 1, 3], "D"),
    firstAttempt,
    "a correct retry must not replace the disputed first answer",
  );
  assert.equal(
    captureMkLabQaObservation(firstAttempt, [0, 1, 2, 3, 4], "A"),
    firstAttempt,
    "a later reshuffle must not replace the original observation",
  );
});

test("QA feedback salvages valid entries and handles blocked storage", () => {
  const storage = memoryStorage();
  const round = MK_ROUNDS[0];
  const validRound = MK_ROUNDS[1];
  const invalidOrderRound = MK_ROUNDS[2];
  const invalidLetterRound = MK_ROUNDS[3];
  storage.setItem(
    mkLabQaStorageKey(MK_CONTENT_VERSION),
    JSON.stringify({
      schemaVersion: 1,
      contentVersion: MK_CONTENT_VERSION,
      feedback: {
        [round.id]: {
          verdict: "looks-good",
          issues: ["not-a-real-category"],
          notes: "",
          updatedAt: "2026-08-05T18:00:00.000Z",
        },
        [validRound.id]: {
          verdict: "looks-good",
          issues: [],
          notes: "Checked on a phone.",
          updatedAt: "2026-08-05T18:01:00.000Z",
          observedSourceIndexes: [1, 3, 0, 4, 2],
          selectedAnswerLetter: null,
        },
        [invalidOrderRound.id]: {
          verdict: "needs-change",
          issues: ["answer-key"],
          notes: "Bad order snapshot.",
          updatedAt: "2026-08-05T18:02:00.000Z",
          observedSourceIndexes: [0, 0, 2, 3, 4],
          selectedAnswerLetter: "A",
        },
        [invalidLetterRound.id]: {
          verdict: "needs-change",
          issues: ["answer-key"],
          notes: "Bad answer-letter snapshot.",
          updatedAt: "2026-08-05T18:03:00.000Z",
          observedSourceIndexes: [0, 1, 2, 3, 4],
          selectedAnswerLetter: "Z",
        },
      },
    }),
  );
  assert.deepEqual(
    readMkLabQaFeedback(storage, MK_ROUNDS, MK_CONTENT_VERSION),
    {
      [validRound.id]: {
        verdict: "looks-good",
        issues: [],
        notes: "Checked on a phone.",
        updatedAt: "2026-08-05T18:01:00.000Z",
        observedSourceIndexes: [1, 3, 0, 4, 2],
        selectedAnswerLetter: null,
      },
    },
    "one malformed note must not hide valid feedback",
  );
  assert.deepEqual(
    new Set(MK_LAB_QA_ISSUES),
    new Set([
      "answer-key",
      "prompt-wording",
      "image-diagram",
      "classification",
      "layout-accessibility",
      "other",
    ]),
  );

  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(
    readMkLabQaFeedback(blocked, MK_ROUNDS, MK_CONTENT_VERSION),
    null,
  );
  assert.equal(
    writeMkLabQaFeedback(blocked, {}, MK_CONTENT_VERSION),
    false,
  );
});
