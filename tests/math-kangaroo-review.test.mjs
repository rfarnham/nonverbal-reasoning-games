import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  MK_CONTENT_RELEASE_READY,
  MK_MECHANIC_COUNTS,
  MK_ROUNDS,
  mkRoundsForJourneyLevel,
} from "../app/journey/reviews/math-kangaroo/authored-rounds.ts";
import {
  MK_CULMINATION_ROUNDS_PER_JOURNEY_LEVEL,
  MK_JOURNEY_LEVELS,
  MK_ROUNDS_PER_JOURNEY_LEVEL,
  MK_STOP_ROUNDS_PER_JOURNEY_LEVEL,
  mkRoundFingerprint,
  validateMkJourneyCorpus,
  validateMkRound,
  validateMkVisualExplanation,
} from "../app/journey/reviews/math-kangaroo/engine.ts";
import {
  journeyReviewReleaseReady,
  progressionAdapter,
} from "../app/journey/reviews/math-kangaroo/progression-adapter.ts";
import {
  addActiveTimeBrowserSession,
  advanceProgressionBrowserSession,
  answerProgressionBrowserSession,
  beginProgressionBrowserSection,
  beginRedemptionBrowserSession,
  loadProgressionBrowserSession,
  retryProgressionBrowserSession,
} from "../lib/progression/browser-session.ts";
import {
  campaignQuestionReferences,
  defineProgressionGameAdapter,
  journeyQuestionReferences,
  resolveProgressionQuestion,
} from "../lib/progression/game-adapter.ts";
import {
  PROGRESSION_STORAGE_KEY,
  addPlayerProfile,
  buildJourneyPlan,
  createCulminationProgressionAttempt,
  createPlayerProfile,
  createProgressionState,
  createReviewProgressionAttempt,
  loadProgressionState,
  previousJourneyNodeIds,
  replacePlayerProfile,
  saveProgressionState,
  settleProgressionAttempt,
  upsertProfileAttempt,
} from "../lib/progression/index.ts";
import {
  journeyReviewCollectionId,
} from "../lib/progression/types.ts";

const CORE_LEVELS = ["starter", "junior", "expert", "wizard"];
const CORE_GAMES = Array.from({ length: 8 }, (_, index) => ({
  slug: `integration-game-${index + 1}`,
  title: `Integration Game ${index + 1}`,
  role: "game",
  contentVersion: "integration-campaign-1",
  generatorVersion: "integration-generator-1",
  journeyContentVersion: "integration-journey-1",
}));
const REVIEW_GAME = {
  slug: progressionAdapter.gameSlug,
  title: "Math Kangaroo Spatial Review",
  role: "review",
  journeyContentVersion: progressionAdapter.journeyContentVersion,
};
const JOURNEY_GAMES = [...CORE_GAMES, REVIEW_GAME];
const MK_MANIFEST = JSON.parse(
  readFileSync(
    "app/journey/reviews/math-kangaroo/data/selection-manifest.json",
    "utf8",
  ),
);
const MK_SOLUTION_OVERRIDES = JSON.parse(
  readFileSync(
    "app/journey/reviews/math-kangaroo/data/solution-overrides.json",
    "utf8",
  ),
);
const MK_RUNTIME_MANIFEST_TEXT = readFileSync(
  "app/journey/reviews/math-kangaroo/data/runtime-manifest.json",
  "utf8",
);
const MK_RUNTIME_MANIFEST = JSON.parse(MK_RUNTIME_MANIFEST_TEXT);
const MK_ASSET_AUDIT = JSON.parse(
  readFileSync(
    "app/journey/reviews/math-kangaroo/data/asset-build-audit.json",
    "utf8",
  ),
);
const MK_ASSET_RELEASE_REVIEW_PATH =
  "app/journey/reviews/math-kangaroo/data/asset-release-reviews.json";
const MK_ASSET_RELEASE_REVIEWS = existsSync(MK_ASSET_RELEASE_REVIEW_PATH)
  ? JSON.parse(readFileSync(MK_ASSET_RELEASE_REVIEW_PATH, "utf8"))
  : { schemaVersion: 1, items: {} };
const NUMBER_WORD_TOKENS = new Map([
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
  ["ten", "10"],
  ["eleven", "11"],
  ["twelve", "12"],
]);
const SEMANTIC_TOKEN_STOPWORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "answer",
  "are",
  "choice",
  "is",
  "of",
  "only",
  "or",
  "the",
  "to",
]);

function semanticAnswerTokens(value) {
  return new Set(
    Array.from(String(value ?? "").toLowerCase().matchAll(/[a-z0-9]+/g))
      .map(([token]) => NUMBER_WORD_TOKENS.get(token) ?? token)
      .filter((token) => !SEMANTIC_TOKEN_STOPWORDS.has(token))
      .map((token) =>
        token.length > 4 && token.endsWith("s")
          ? token.slice(0, -1)
          : token,
      ),
  );
}

function finalSolutionSentence(explanation) {
  const body = explanation.solutionSteps.at(-1)?.body ?? "";
  return body.split(/[.!?]+/).map((value) => value.trim()).filter(Boolean).at(-1) ?? "";
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function coreAdapter(gameSlug) {
  const campaignRounds = CORE_LEVELS.flatMap((difficulty) =>
    Array.from({ length: 12 }, (_, questionIndex) => ({
      id: `${gameSlug}:${difficulty}:${questionIndex}`,
      difficulty,
      correctIndex: questionIndex % 4,
    })),
  );
  return defineProgressionGameAdapter({
    gameSlug,
    contentVersion: "integration-campaign-1",
    generatorVersion: "integration-generator-1",
    journeyContentVersion: "integration-journey-1",
    campaignRounds,
    difficultyByLevel: {
      starter: "starter",
      junior: "junior",
      expert: "expert",
      wizard: "wizard",
    },
    difficultyOf: (round) => round.difficulty,
    fingerprint: (round) => round.id,
    generate: (difficulty, random) => ({
      id: `${gameSlug}:${difficulty}:generated:${Math.floor(
        random() * 1_000_000_000,
      )}`,
      difficulty,
      correctIndex: 0,
    }),
  });
}

const CORE_ADAPTERS = new Map(
  CORE_GAMES.map(({ slug }) => [slug, coreAdapter(slug)]),
);

function storeAttempt(storage, attempt) {
  const journey = buildJourneyPlan(JOURNEY_GAMES);
  const previousStopIds = previousJourneyNodeIds(journey, attempt.stopId);
  const profile = {
    ...createPlayerProfile({
      id: "mk-integration-profile",
      name: "Ada",
      avatarId: "hedgehog",
      gameSnapshot: JOURNEY_GAMES,
      nowMs: 1,
    }),
    clearedStopIds: previousStopIds,
  };
  const withAttempt = upsertProfileAttempt(profile, attempt);
  const state = addPlayerProfile(createProgressionState(), withAttempt);
  assert.equal(saveProgressionState(state, storage), true);
}

test("the selected Math Kangaroo corpus is complete, unique, and source-audited", () => {
  assert.equal(MK_ROUNDS.length, 168);
  assert.doesNotThrow(() => validateMkJourneyCorpus(MK_ROUNDS));
  assert.equal(
    new Set(MK_ROUNDS.map(mkRoundFingerprint)).size,
    MK_ROUNDS.length,
  );
  assert.ok(
    MK_ROUNDS.every(
      (round) =>
        round.source.answerKeyVerified &&
        /^https:\/\/thalescyprus\.com\//.test(round.source.sourceDocument) &&
        /^https:\/\/thalescyprus\.com\//.test(
          round.source.answerKeyDocument,
        ),
    ),
  );
  assert.ok(
    Object.values(MK_MECHANIC_COUNTS).every((count) => count >= 9),
  );
  assert.ok(
    MK_ROUNDS.every(
      (round) => !/(?:\.{3}|…)\s*$/.test(round.explanation.headline),
    ),
    "final-reviewed explanation headlines must not end in an ellipsis",
  );
});

test("the browser manifest omits private corpus and crop-build metadata", () => {
  assert.equal(MK_RUNTIME_MANIFEST.rounds.length, 168);
  assert.deepEqual(
    MK_RUNTIME_MANIFEST.rounds.map(({ id }) => id),
    MK_MANIFEST.rounds.map(({ id }) => id),
  );
  assert.doesNotMatch(
    MK_RUNTIME_MANIFEST_TEXT,
    /privateReportCrop|privateSourcePdf|privateAnswerKeyPdf|sourceCrop(?:Top|Bottom)Points|reviewScore|work\/math-kangaroo-spatial-review/,
  );
});

test("all grounded explanations propagate from authoring through browser data", () => {
  const manifestById = new Map(
    MK_MANIFEST.rounds.map((round) => [round.id, round]),
  );
  const runtimeById = new Map(
    MK_RUNTIME_MANIFEST.rounds.map((round) => [round.id, round]),
  );
  assert.equal(
    Object.keys(MK_SOLUTION_OVERRIDES.solutions).length,
    MK_ROUNDS.length,
  );
  for (const [roundId, solution] of Object.entries(
    MK_SOLUTION_OVERRIDES.solutions,
  )) {
    const authored = solution.visualExplanation;
    const selected = manifestById.get(roundId)?.explanationPlan
      ?.visualExplanation;
    const runtime = runtimeById.get(roundId)?.explanationPlan
      ?.visualExplanation;
    assert.ok(authored, `${roundId} authoring visual`);
    assert.deepEqual(selected, authored, `${roundId} selection visual`);
    assert.deepEqual(runtime, authored, `${roundId} runtime visual`);
    assert.equal(
      manifestById.get(roundId)?.explanationPlan?.wrongAnswerHint,
      solution.wrongAnswerHint,
      `${roundId} selection hint`,
    );
    assert.equal(
      runtimeById.get(roundId)?.explanationPlan?.wrongAnswerHint,
      solution.wrongAnswerHint,
      `${roundId} runtime hint`,
    );
  }
});

test("player-facing prompts are reviewed prose, not raw OCR fragments", () => {
  const knownOcrArtifacts =
    /They are both slide|normal dice|glueing|Which of the figure|figures:\s*,+|won[‘’']?t pass|What shall we see|How can the other side.+look like/i;

  for (const round of MK_ROUNDS) {
    assert.ok(round.prompt.endsWith("?"), `${round.id} prompt is a question`);
    assert.doesNotMatch(
      round.prompt,
      knownOcrArtifacts,
      `${round.id} contains an unreviewed OCR phrase`,
    );
    assert.doesNotMatch(
      round.explanation.headline,
      knownOcrArtifacts,
      `${round.id} explanation headline contains an OCR phrase`,
    );
  }
});

test("wrong-answer hints teach a strategy without naming the correct choice", () => {
  for (const round of MK_ROUNDS) {
    const expectedChoice = round.correctIndex + 1;
    const directReference = new RegExp(
      `\\b(?:choice|answer|option)\\s+(?:number\\s+)?(?:is\\s+)?(?:${expectedChoice}|${round.source.answer})\\b`,
      "i",
    );
    assert.doesNotMatch(
      round.explanation.wrongAnswerHint,
      directReference,
      `${round.id} hint names its correct choice`,
    );

    const semanticAnswer = round.choices[round.correctIndex].displayText
      ?.trim();
    if (semanticAnswer) {
      assert.ok(
        !round.explanation.wrongAnswerHint
          .toLowerCase()
          .includes(semanticAnswer.toLowerCase()),
        `${round.id} hint names its semantic answer "${semanticAnswer}"`,
      );
    }
  }
});

test("authored explanation claims stay synchronized with the official answer", () => {
  for (const round of MK_MANIFEST.rounds) {
    const expectedChoice = round.correctIndex + 1;
    const referencedChoices = Array.from(
      finalSolutionSentence(round.explanationPlan).matchAll(
        /\b(?:choice|answer)\s+([1-5])\b/gi,
      ),
      (match) => Number(match[1]),
    );
    assert.ok(
      referencedChoices.every((choice) => choice === expectedChoice),
      `${round.id} references a choice other than ${expectedChoice}`,
    );

    const displayChoices = round.choices.map(
      ({ displayText }) => displayText?.trim() ?? "",
    );
    if (displayChoices.length !== 5 || displayChoices.some((value) => !value)) {
      continue;
    }
    const choiceTokenSets = displayChoices.map(semanticAnswerTokens);
    const commonTokens = new Set(
      [...choiceTokenSets[0]].filter((token) =>
        choiceTokenSets.every((tokens) => tokens.has(token)),
      ),
    );
    const expectedTokens = new Set(
      [...choiceTokenSets[round.correctIndex]].filter(
        (token) => !commonTokens.has(token),
      ),
    );
    if (
      ![...expectedTokens].some(
        (token) => /^\d+$/.test(token) || /^[a-z]$/.test(token),
      )
    ) {
      continue;
    }
    const claimTokens = semanticAnswerTokens(
      finalSolutionSentence(round.explanationPlan),
    );
    assert.ok(
      [...expectedTokens].every((token) => claimTokens.has(token)),
      `${round.id} final explanation does not name ${displayChoices[round.correctIndex]}`,
    );
  }
});

test("the bead-order question includes every operation omitted from its raster", () => {
  const bracelet = MK_ROUNDS.find(
    ({ id }) => id === "mk-cyprus-2026-12-q20",
  );
  assert.ok(bracelet);
  assert.match(
    bracelet.prompt,
    /2 white beads to the left end.*1 black bead to the left end.*2 black beads to the right end.*2 white beads to the left end.*1 white bead to the right end.*1 black bead to the left end/i,
  );
});

test("each eligible board owns two stops and four unseen culmination questions", () => {
  const seenStopSchedules = new Map();
  const seenCulminationSchedules = new Map();
  const hasRepeatedCycle = (schedule) => {
    for (
      let cycleWidth = 2;
      cycleWidth <= Math.min(5, Math.floor(schedule.length / 2));
      cycleWidth += 1
    ) {
      for (
        let start = 0;
        start + cycleWidth * 2 <= schedule.length;
        start += 1
      ) {
        if (
          schedule
            .slice(start, start + cycleWidth)
            .every(
              (answer, index) =>
                answer === schedule[start + cycleWidth + index],
            )
        ) {
          return true;
        }
      }
    }
    return false;
  };

  for (const journeyLevel of MK_JOURNEY_LEVELS) {
    const rounds = mkRoundsForJourneyLevel(journeyLevel);
    assert.equal(rounds.length, MK_ROUNDS_PER_JOURNEY_LEVEL);
    const stopRounds = rounds.slice(
      0,
      MK_STOP_ROUNDS_PER_JOURNEY_LEVEL,
    );
    const culminationRounds = rounds.slice(
      MK_STOP_ROUNDS_PER_JOURNEY_LEVEL,
    );
    assert.equal(stopRounds.length, 24);
    assert.equal(
      culminationRounds.length,
      MK_CULMINATION_ROUNDS_PER_JOURNEY_LEVEL,
    );
    const seenInStops = new Set(stopRounds.map(mkRoundFingerprint));
    assert.ok(
      culminationRounds.every(
        (round) => !seenInStops.has(mkRoundFingerprint(round)),
      ),
    );
    for (let stopIndex = 0; stopIndex < 2; stopIndex += 1) {
      const schedule = stopRounds
        .slice(stopIndex * 12, stopIndex * 12 + 12)
        .map((round) => round.correctIndex);
      assert.ok(
        schedule.every(
          (answer, index) => index === 0 || answer !== schedule[index - 1],
        ),
        `${journeyLevel} stop ${stopIndex + 1} repeats adjacent answers`,
      );
      assert.equal(
        hasRepeatedCycle(schedule),
        false,
        `${journeyLevel} stop ${stopIndex + 1} repeats an exploitable answer cycle`,
      );
      const key = schedule.join("");
      assert.equal(
        seenStopSchedules.has(key),
        false,
        `${journeyLevel} stop ${stopIndex + 1} duplicates ${seenStopSchedules.get(key)}`,
      );
      seenStopSchedules.set(
        key,
        `${journeyLevel} stop ${stopIndex + 1}`,
      );
    }
    const culminationSchedule = culminationRounds
      .map((round) => round.correctIndex)
      .join("");
    assert.equal(
      seenCulminationSchedules.has(culminationSchedule),
      false,
      `${journeyLevel} culmination duplicates ${seenCulminationSchedules.get(culminationSchedule)}`,
    );
    seenCulminationSchedules.set(culminationSchedule, journeyLevel);
  }
});

test("the generic review adapter resolves all 28 fixed collection slots", () => {
  for (const journeyLevel of MK_JOURNEY_LEVELS) {
    const collectionId = journeyReviewCollectionId(journeyLevel);
    const refs = journeyQuestionReferences(
      progressionAdapter,
      journeyLevel,
      { collectionId, questionCount: 28 },
    );
    assert.equal(refs.length, 28);
    assert.deepEqual(
      refs.map((ref) => ref.questionIndex),
      Array.from({ length: 28 }, (_, index) => index),
    );
    for (const ref of refs) {
      const resolved = resolveProgressionQuestion(
        progressionAdapter,
        ref,
      );
      assert.equal(resolved.round.journeyLevel, journeyLevel);
      assert.equal(resolved.ref.source, "journey");
      assert.equal(resolved.ref.collectionId, collectionId);
    }
  }
});

test("every selected illustration is bundled locally at its declared size", () => {
  for (const round of MK_ROUNDS) {
    assert.ok(
      existsSync(`public${round.illustration.src}`),
      `${round.id} illustration`,
    );
    assert.ok(round.illustration.width > 0);
    assert.ok(round.illustration.height > 0);
  }
});

test("semantic choice text is all-or-none and remains separate from its 1–5 index", () => {
  const source = MK_ROUNDS[0];
  const semanticChoices = source.choices.map((choice, index) => ({
    ...choice,
    displayText: `Semantic option ${index + 1}`,
  }));
  assert.doesNotThrow(() =>
    validateMkRound({
      ...source,
      id: `${source.id}-semantic-choice-test`,
      choices: semanticChoices,
    })
  );
  assert.throws(
    () =>
      validateMkRound({
        ...source,
        id: `${source.id}-partial-semantic-choice-test`,
        choices: source.choices.map((choice, index) => ({
          ...choice,
          ...(index === 0 ? { displayText: "Only one option" } : {}),
        })),
      }),
    /display text for all five choices or none/,
  );

  const client = readFileSync(
    "app/journey/reviews/math-kangaroo/MathKangarooReviewClient.tsx",
    "utf8",
  );
  assert.match(client, /styles\.answerIndex/);
  assert.match(client, /\{choice\.displayText\}/);
  assert.match(
    client,
    /mk-example-visual-title/,
    "the culmination section must show a genuinely solved visual example",
  );
  assert.match(
    client,
    /reducedMotion \? 1_300 : 2_200/,
    "wrong-answer review must linger before retry becomes available",
  );
  assert.match(
    client,
    /feedbackCorrect[^]*?role="status"/,
    "correct visual feedback must be announced as a live status",
  );
});

test("release readiness requires every reviewed explanation and exact asset digest", () => {
  assert.equal(MK_CONTENT_RELEASE_READY, true);
  assert.equal(journeyReviewReleaseReady, MK_CONTENT_RELEASE_READY);
  assert.equal(MK_ASSET_AUDIT.releaseReady, true);
  assert.equal(
    Object.keys(MK_ASSET_RELEASE_REVIEWS.items).length,
    MK_ROUNDS.length,
  );
  const auditById = new Map(
    MK_ASSET_AUDIT.items.map((item) => [item.id, item]),
  );
  assert.ok(
    MK_ROUNDS.every((round) => {
      const review = MK_ASSET_RELEASE_REVIEWS.items[round.id];
      const audit = auditById.get(round.id);
      return (
        round.explanation.visualExplanation &&
        /^[a-f0-9]{64}$/.test(review?.pixelSha256 ?? "") &&
        audit?.releaseReviewMatched === true &&
        audit?.reviewFingerprint === review.pixelSha256 &&
        audit?.status === "release-ready"
      );
    }),
  );
  const page = readFileSync(
    "app/journey/reviews/math-kangaroo/page.tsx",
    "utf8",
  );
  assert.match(page, /assertJourneyReviewReleaseReady\(\)/);
});

test("grounded visual explanations use normalized targets and end by revealing the verified choice", () => {
  const grounded = {
    regions: [
      {
        id: "clue-shape",
        label: "distinctive clue shape",
        x: 0.08,
        y: 0.1,
        width: 0.22,
        height: 0.28,
        role: "evidence",
      },
      {
        id: "answer-3",
        label: "answer choice 3",
        x: 0.42,
        y: 0.68,
        width: 0.15,
        height: 0.2,
        role: "answer-choice",
        choiceIndex: 2,
      },
    ],
    paths: [
      {
        id: "clue-route",
        label: "route through the clue",
        points: [
          { x: 0.1, y: 0.18 },
          { x: 0.2, y: 0.25 },
          { x: 0.28, y: 0.32 },
        ],
      },
    ],
    beats: [
      {
        kind: "trace",
        target: "clue-route",
        narration: "Trace the route without changing its turn order.",
      },
      {
        kind: "transform",
        target: "clue-shape",
        rotateDeg: 90,
        translation: { x: 0.18, y: 0.04 },
        narration: "Turn the clue exactly one quarter-turn and move it right.",
      },
      {
        kind: "reveal",
        target: "answer-3",
        verifiedChoiceIndex: 2,
        narration: "Choice 3 is the only picture that preserves the route.",
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateMkVisualExplanation(grounded, 2, "grounded-test")
  );

  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...grounded,
          regions: [
            {
              ...grounded.regions[0],
              x: 0.9,
              width: 0.2,
            },
            grounded.regions[1],
          ],
        },
        2,
        "bad-bounds",
      ),
    /fit inside the illustration/,
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...grounded,
          beats: [
            grounded.beats[0],
            {
              kind: "spotlight",
              target: "missing-region",
              narration: "This target does not exist.",
            },
            grounded.beats[2],
          ],
        },
        2,
        "bad-target",
      ),
    /unknown region/,
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...grounded,
          beats: [
            grounded.beats[0],
            grounded.beats[1],
            {
              ...grounded.beats[2],
              verifiedChoiceIndex: 1,
            },
          ],
        },
        2,
        "wrong-reveal",
      ),
    /officially verified answer choice/,
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...grounded,
          beats: [
            grounded.beats[0],
            {
              kind: "transform",
              target: "clue-shape",
              rotateDeg: 0,
              narration: "A zero turn cannot explain a change.",
            },
            grounded.beats[2],
          ],
        },
        2,
        "zero-transform",
      ),
    /exact non-zero rotation/,
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...grounded,
          beats: [
            {
              kind: "spotlight",
              target: "clue-shape",
              narration: "Only highlight the clue.",
            },
            {
              kind: "spotlight",
              target: "answer-3",
              narration: "Only highlight the answer.",
            },
            grounded.beats[2],
          ],
        },
        2,
        "missing-reasoning",
    ),
    /causal reasoning beat/,
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...grounded,
          beats: [
            {
              kind: "spotlight",
              target: "clue-shape",
              narration: "Highlight the whole clue.",
            },
            {
              kind: "compare",
              targets: ["clue-shape", "answer-3"],
              narration: "Compare the whole clue directly with the answer.",
            },
            grounded.beats[2],
          ],
        },
        2,
        "whole-clue-answer-compare",
      ),
    /comparing the whole clue directly to an answer is insufficient/,
  );
});

test("OCR-only choices reveal the verified semantic card without fake image bounds", () => {
  const semantic = {
    regions: [
      {
        id: "diagram-evidence",
        label: "diagram evidence",
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.5,
        role: "evidence",
      },
      {
        id: "diagram-comparison",
        label: "comparison evidence",
        x: 0.64,
        y: 0.1,
        width: 0.22,
        height: 0.5,
        role: "evidence",
      },
    ],
    paths: [],
    beats: [
      {
        kind: "spotlight",
        target: "diagram-evidence",
        narration: "Inspect the decisive relation in the diagram.",
      },
      {
        kind: "compare",
        targets: ["diagram-evidence", "diagram-comparison"],
        narration: "Compare the two regions to preserve the decisive relation.",
      },
      {
        kind: "reveal",
        choiceIndex: 3,
        verifiedChoiceIndex: 3,
        narration: "The fourth semantic answer preserves that relation.",
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateMkVisualExplanation(
      semantic,
      3,
      "semantic-reveal",
      true,
    )
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        semantic,
        3,
        "semantic-without-ocr-choices",
      ),
    /OCR-only choice/,
  );
  assert.throws(
    () =>
      validateMkVisualExplanation(
        {
          ...semantic,
          beats: [
            semantic.beats[0],
            semantic.beats[1],
            {
              ...semantic.beats[2],
              choiceIndex: 2,
            },
          ],
        },
        3,
        "wrong-semantic-reveal",
        true,
      ),
    /matching semantic answer card/,
  );
});

test("the explanation renderer uses the local question illustration and has no fixed canned half-turn", () => {
  const renderer = readFileSync(
    "app/journey/reviews/math-kangaroo/MkExplanationAnimation.tsx",
    "utf8",
  );
  const styles = readFileSync(
    "app/journey/reviews/math-kangaroo/math-kangaroo.module.css",
    "utf8",
  );
  assert.match(renderer, /href=\{imageSrc\}/);
  assert.match(renderer, /beat\.rotateDeg/);
  assert.match(renderer, /beat\.reflection/);
  assert.match(renderer, /beat\.translation/);
  assert.match(renderer, /semanticChoiceIndex/);
  assert.match(
    renderer,
    /width:\s*VIEWBOX_SIZE\s*\*\s*illustrationAspect/,
    "the SVG coordinate space must retain the illustration aspect ratio",
  );
  assert.match(renderer, /scaledX\(beat\.translation/);
  assert.match(renderer, /scaledY\(beat\.translation/);
  assert.doesNotMatch(
    renderer,
    /viewBox=\{`0 0 \$\{VIEWBOX_SIZE\} \$\{VIEWBOX_SIZE\}`\}/,
    "a stretched square viewBox warps quarter-turn explanations",
  );
  assert.doesNotMatch(renderer, /RotateAnimation|rotate\(180deg\)/);
  assert.doesNotMatch(styles, /rotate\(180deg\)/);
});

test("the visual merge rejects stale asset coordinates and unresolved rebase blockers", () => {
  const mergeScript = readFileSync(
    "scripts/merge-math-kangaroo-visual-explanations.py",
    "utf8",
  );
  assert.match(mergeScript, /source_payload\.get\("rebaseBlockers"\)/);
  assert.match(mergeScript, /coordinateBasisDimensions/);
  assert.match(mergeScript, /current asset is/);
});

test("a 12-question Math Kangaroo stop resumes exactly and persists timed misses through redemption", () => {
  const journey = buildJourneyPlan(JOURNEY_GAMES);
  const board = journey.boards.find(
    ({ journeyLevel }) => journeyLevel === "junior-1",
  );
  assert.ok(board);
  const node = board.nodes.find(({ kind }) => kind === "review");
  assert.ok(node);
  const questions = journeyQuestionReferences(
    progressionAdapter,
    node.journeyLevel,
    {
      collectionId: node.collectionId,
      questionOffset: node.questionOffset,
      questionCount: node.questionCount,
    },
  );
  const attempt = createReviewProgressionAttempt({
    id: "mk-review-resume",
    node,
    journeyQuestions: questions,
    nowMs: 2,
  });
  const storage = memoryStorage();
  storeAttempt(storage, attempt);

  let session = loadProgressionBrowserSession(progressionAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.ref.questionIndex, 0);
  assert.equal(
    session.current.round.id,
    mkRoundsForJourneyLevel(node.journeyLevel)[0].id,
  );

  session = addActiveTimeBrowserSession(
    progressionAdapter,
    attempt.id,
    4_321,
    10,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.rounds[0].firstAnswerActiveTimeMs, 4_321);

  session = loadProgressionBrowserSession(progressionAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.rounds[0].firstAnswerActiveTimeMs, 4_321);

  const firstCorrectIndex = session.current.round.correctIndex;
  session = answerProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    {
      correct: false,
      answerToken: `option-${(firstCorrectIndex + 1) % 5}`,
      nowMs: 11,
    },
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.rounds[0].phase, "feedback");
  assert.equal(session.attempt.rounds[0].firstTryCorrect, false);
  assert.equal(session.attempt.rounds[0].firstAnsweredAtMs, 11);
  const midStopProfile = loadProgressionState(storage).profiles[0];
  const midStopMiss = midStopProfile.missedQuestions.find(
    ({ question }) =>
      question.gameSlug === progressionAdapter.gameSlug &&
      question.source === "journey" &&
      question.questionIndex === 0,
  );
  assert.deepEqual(midStopMiss?.observations, [
    {
      attemptId: attempt.id,
      stopId: node.id,
      journeyLevel: node.journeyLevel,
      elapsedMs: 4_321,
      missedAtMs: 11,
    },
  ]);

  session = loadProgressionBrowserSession(progressionAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.ref.questionIndex, 0);
  assert.equal(session.attempt.rounds[0].phase, "feedback");

  session = retryProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    12,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  session = answerProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    {
      correct: true,
      answerToken: `option-${firstCorrectIndex}`,
      nowMs: 13,
    },
    { storage },
  );
  session = advanceProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    14,
    { storage },
  );

  for (let index = 1; index < 12; index += 1) {
    assert.equal(session.mode, "controlled");
    assert.equal(session.current.ref.questionIndex, index);
    const correctIndex = session.current.round.correctIndex;
    session = answerProgressionBrowserSession(
      progressionAdapter,
      attempt.id,
      {
        correct: true,
        answerToken: `option-${correctIndex}`,
        nowMs: 20 + index,
      },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      progressionAdapter,
      attempt.id,
      40 + index,
      { storage },
    );

    if (index === 5) {
      session = loadProgressionBrowserSession(progressionAdapter, {
        attemptId: attempt.id,
        storage,
      });
      assert.equal(session.mode, "controlled");
      assert.equal(session.attempt.currentRoundIndex, 6);
      assert.equal(session.current.ref.questionIndex, 6);
      assert.ok(
        session.attempt.rounds
          .slice(0, 6)
          .every(({ phase }) => phase === "solved"),
      );
    }
  }

  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.phase, "redemption-ready");
  assert.equal(session.current, null);

  session = beginRedemptionBrowserSession(
    progressionAdapter,
    attempt.id,
    60,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.isRedemption, true);
  assert.equal(session.current.ref.questionIndex, 0);

  session = answerProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    {
      correct: false,
      answerToken: `option-${(firstCorrectIndex + 2) % 5}`,
      nowMs: 61,
    },
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.redemption.phase, "feedback");
  session = retryProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    62,
    { storage },
  );
  session = answerProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    {
      correct: true,
      answerToken: `option-${firstCorrectIndex}`,
      nowMs: 63,
    },
    { storage },
  );
  session = advanceProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    64,
    { storage },
  );
  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/journey/summary/");

  const savedState = loadProgressionState(storage);
  const savedProfile = savedState.profiles[0];
  const savedAttempt = savedProfile.attempts[attempt.id];
  assert.equal(savedAttempt.phase, "summary-ready");
  const settlement = settleProgressionAttempt(
    savedProfile,
    savedAttempt,
    buildJourneyPlan(savedProfile.gameSnapshot),
    100,
  );
  assert.equal(settlement.settlement.passed, true);
  const settledState = replacePlayerProfile(
    savedState,
    settlement.profile,
  );
  assert.equal(saveProgressionState(settledState, storage), true);

  const localData = loadProgressionState(storage);
  const missed = localData.profiles[0].missedQuestions.find(
    ({ question }) =>
      question.gameSlug === progressionAdapter.gameSlug &&
      question.source === "journey" &&
      question.questionIndex === 0,
  );
  assert.ok(missed);
  assert.equal(missed.missCount, 1);
  assert.deepEqual(missed.observations, [
    {
      attemptId: attempt.id,
      stopId: node.id,
      journeyLevel: node.journeyLevel,
      elapsedMs: 4_321,
      missedAtMs: 11,
    },
  ]);
  assert.ok(
    storage.getItem(PROGRESSION_STORAGE_KEY)?.includes('"elapsedMs":4321'),
  );
});

test("the fixed Math Kangaroo culmination section uses offsets 24–27, waits for Continue, and hands off correctly", () => {
  const journey = buildJourneyPlan(JOURNEY_GAMES);
  const board = journey.boards.find(
    ({ journeyLevel }) => journeyLevel === "junior-1",
  );
  assert.ok(board);
  const node = board.nodes.at(-1);
  assert.equal(node.kind, "culmination");
  const fixedSection = node.sections.at(-1);
  assert.deepEqual(fixedSection, {
    selection: "fixed",
    gameSlug: progressionAdapter.gameSlug,
    collectionId: journeyReviewCollectionId(node.journeyLevel),
    questionOffset: 24,
    questionCount: 4,
  });
  const fixedQuestions = journeyQuestionReferences(
    progressionAdapter,
    node.journeyLevel,
    {
      collectionId: fixedSection.collectionId,
      questionOffset: fixedSection.questionOffset,
      questionCount: fixedSection.questionCount,
    },
  );
  const attempt = createCulminationProgressionAttempt({
    id: "mk-fixed-culmination",
    node,
    missedQuestions: [],
    questionPools: CORE_GAMES.map(({ slug }) => {
      const adapter = CORE_ADAPTERS.get(slug);
      assert.ok(adapter);
      return {
        gameSlug: slug,
        approachableQuestion: campaignQuestionReferences(
          adapter,
          "starter",
        )[0],
        campaignQuestions: campaignQuestionReferences(
          adapter,
          node.level,
        ),
        currentContentVersion: adapter.contentVersion,
        currentJourneyContentVersion: adapter.journeyContentVersion,
        currentGeneratorVersion: adapter.generatorVersion,
      };
    }),
    fixedSections: [
      {
        gameSlug: progressionAdapter.gameSlug,
        questions: fixedQuestions,
      },
    ],
    nowMs: 2,
  });
  assert.deepEqual(
    attempt.rounds.slice(24, 28).map(({ question }) => ({
      source: question.source,
      gameSlug: question.gameSlug,
      questionIndex: question.questionIndex,
    })),
    [24, 25, 26, 27].map((questionIndex) => ({
      source: "journey",
      gameSlug: progressionAdapter.gameSlug,
      questionIndex,
    })),
  );

  const storage = memoryStorage();
  storeAttempt(storage, attempt);
  let session;
  for (let gameIndex = 0; gameIndex < CORE_GAMES.length; gameIndex += 1) {
    const game = CORE_GAMES[gameIndex];
    const adapter = CORE_ADAPTERS.get(game.slug);
    assert.ok(adapter);
    session = loadProgressionBrowserSession(adapter, {
      attemptId: attempt.id,
      storage,
    });
    assert.equal(session.mode, "controlled");
    assert.equal(session.attempt.pendingSectionIndex, gameIndex);
    session = beginProgressionBrowserSection(
      adapter,
      attempt.id,
      10 + gameIndex,
      { storage },
    );
    assert.equal(session.mode, "controlled");
    assert.equal(session.attempt.pendingSectionIndex, null);

    for (let questionIndex = 0; questionIndex < 3; questionIndex += 1) {
      session = answerProgressionBrowserSession(
        adapter,
        attempt.id,
        {
          correct: true,
          answerToken: `option-${session.current.round.correctIndex}`,
          nowMs: 100 + gameIndex * 3 + questionIndex,
        },
        { storage },
      );
      session = advanceProgressionBrowserSession(
        adapter,
        attempt.id,
        200 + gameIndex * 3 + questionIndex,
        { storage },
      );
    }
  }

  assert.equal(session.mode, "redirect");
  assert.equal(
    session.navigationTarget.pathname,
    "/journey/reviews/math-kangaroo/",
  );
  assert.equal(
    session.navigationTarget.query.progression,
    attempt.id,
  );

  session = loadProgressionBrowserSession(progressionAdapter, {
    attemptId: attempt.id,
    storage,
  });
  assert.equal(session.mode, "controlled");
  assert.equal(session.current.ref.questionIndex, 24);
  assert.equal(session.attempt.currentRoundIndex, 24);
  assert.equal(session.attempt.pendingSectionIndex, 8);

  const activeTimeBeforeIntro = session.attempt.activeTimeMs;
  session = addActiveTimeBrowserSession(
    progressionAdapter,
    attempt.id,
    9_000,
    300,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.activeTimeMs, activeTimeBeforeIntro);
  assert.equal(session.attempt.pendingSectionIndex, 8);

  const beforeBlockedAnswer = storage.getItem(PROGRESSION_STORAGE_KEY);
  const blockedAnswer = answerProgressionBrowserSession(
    progressionAdapter,
    attempt.id,
    { correct: true, nowMs: 301 },
    { storage },
  );
  assert.equal(blockedAnswer.mode, "recovery");
  assert.equal(
    storage.getItem(PROGRESSION_STORAGE_KEY),
    beforeBlockedAnswer,
  );

  session = beginProgressionBrowserSection(
    progressionAdapter,
    attempt.id,
    302,
    { storage },
  );
  assert.equal(session.mode, "controlled");
  assert.equal(session.attempt.pendingSectionIndex, null);

  for (const questionIndex of [24, 25, 26, 27]) {
    assert.equal(session.mode, "controlled");
    assert.equal(session.current.ref.questionIndex, questionIndex);
    session = answerProgressionBrowserSession(
      progressionAdapter,
      attempt.id,
      {
        correct: true,
        answerToken: `option-${session.current.round.correctIndex}`,
        nowMs: 400 + questionIndex,
      },
      { storage },
    );
    session = advanceProgressionBrowserSession(
      progressionAdapter,
      attempt.id,
      500 + questionIndex,
      { storage },
    );
  }

  assert.equal(session.mode, "redirect");
  assert.equal(session.navigationTarget.pathname, "/journey/summary/");
  assert.equal(session.navigationTarget.query.attempt, attempt.id);
  assert.equal(
    loadProgressionState(storage).profiles[0].attempts[attempt.id].phase,
    "summary-ready",
  );
});
