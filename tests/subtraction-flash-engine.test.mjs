import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_VALUES,
  LISTEN_COPIES,
  REVIEW_SPACING,
  SLOW_RESPONSE_MS,
  SUBTRACTION_FACTS,
  SUBTRACTION_FACTS_BY_LEVEL,
  SUBTRACTION_LEVEL_CONFIG,
  SUBTRACTION_LEVELS,
  VISUAL_ORIENTATIONS,
  buildAnswerOptions,
  createBaseDeck,
  createSeededRandom,
  createSubtractionDeck,
  requiresBorrow,
  subtractionFactsForLevel,
} from "../app/lab/subtraction-flash/game-engine.ts";

function assertFactSpacing(cards, preceding = []) {
  const keys = [...preceding, ...cards.map((card) => card.factKey)];

  for (let index = REVIEW_SPACING; index < keys.length; index += 1) {
    assert.ok(
      !keys.slice(index - REVIEW_SPACING, index).includes(keys[index]),
      `${keys[index]} repeated inside the ${REVIEW_SPACING}-card cooldown`,
    );
  }
}

test("the fact catalogue contains exactly the 36 borrow-required facts", () => {
  assert.equal(SUBTRACTION_FACTS.length, 36);
  assert.equal(
    new Set(SUBTRACTION_FACTS.map((fact) => fact.factKey)).size,
    SUBTRACTION_FACTS.length,
  );

  for (const fact of SUBTRACTION_FACTS) {
    assert.ok(fact.minuend >= 11 && fact.minuend <= 18);
    assert.ok(fact.subtrahend >= 2 && fact.subtrahend <= 9);
    assert.ok(requiresBorrow(fact.minuend, fact.subtrahend));
    assert.equal(fact.answer, fact.minuend - fact.subtrahend);
    assert.ok(ANSWER_VALUES.includes(fact.answer));
  }

  assert.equal(requiresBorrow(13, 4), true);
  assert.equal(requiresBorrow(11, 3), true);
  assert.equal(requiresBorrow(15, 2), false);
});

test("B120 adds harder borrowing facts through 64 and occasional minus ten", () => {
  assert.deepEqual(SUBTRACTION_LEVELS, ["B100", "B120", "B140"]);
  assert.equal(SUBTRACTION_FACTS_BY_LEVEL.B100, SUBTRACTION_FACTS);

  const facts = subtractionFactsForLevel("B120");
  assert.equal(facts.length, 255);
  assert.equal(new Set(facts.map((fact) => fact.factKey)).size, facts.length);
  assert.ok(facts.some((fact) => fact.minuend === 64));
  assert.ok(facts.some((fact) => fact.answer > 9));

  const minusTen = facts.filter((fact) => fact.subtrahend === 10);
  assert.equal(minusTen.length, 45);
  assert.ok(
    facts.every(
      (fact) =>
        fact.level === "B120" &&
        fact.minuend >= 20 &&
        fact.minuend <= 64 &&
        fact.subtrahend >= 2 &&
        fact.subtrahend <= 10 &&
        fact.answer === fact.minuend - fact.subtrahend &&
        (fact.subtrahend === 10 ||
          requiresBorrow(fact.minuend, fact.subtrahend)),
    ),
  );
  assert.equal(requiresBorrow(64, 9), true);
  assert.equal(requiresBorrow(64, 10), false);
});

test("B140 is a compact, balanced two-digit subtraction catalogue", () => {
  const config = SUBTRACTION_LEVEL_CONFIG.B140;
  const facts = subtractionFactsForLevel("B140");

  assert.deepEqual(config, {
    label: "B140",
    minuendMin: 20,
    minuendMax: 99,
    subtrahendMin: 10,
    subtrahendMax: 89,
    answerDigits: 2,
    includesTenReview: false,
    visualCopies: 1,
    listenCopies: 1,
  });
  assert.equal(facts.length, 64);
  assert.equal(new Set(facts.map((fact) => fact.factKey)).size, facts.length);

  const borrowFacts = facts.filter((fact) =>
    requiresBorrow(fact.minuend, fact.subtrahend),
  );
  assert.equal(borrowFacts.length, 32);
  assert.equal(facts.length - borrowFacts.length, 32);

  for (const fact of facts) {
    assert.equal(fact.level, "B140");
    assert.ok(fact.minuend >= 20 && fact.minuend <= 99);
    assert.ok(fact.subtrahend >= 10 && fact.subtrahend <= 89);
    assert.equal(fact.answer, fact.minuend - fact.subtrahend);
    assert.ok(fact.answer >= 10 && fact.answer <= 89);
  }

  for (let decade = 2; decade <= 9; decade += 1) {
    assert.equal(
      facts.filter(
        (fact) => Math.floor(fact.minuend / 10) === decade,
      ).length,
      8,
    );
  }

  assert.equal(Math.min(...facts.map((fact) => fact.minuend)), 20);
  assert.equal(Math.max(...facts.map((fact) => fact.minuend)), 99);
  assert.equal(Math.min(...facts.map((fact) => fact.subtrahend)), 10);
  assert.equal(Math.max(...facts.map((fact) => fact.subtrahend)), 89);
  assert.equal(Math.min(...facts.map((fact) => fact.answer)), 10);
  assert.equal(Math.max(...facts.map((fact) => fact.answer)), 89);
  assert.equal(requiresBorrow(74, 29), true);
  assert.equal(requiresBorrow(74, 21), false);
});

test("B140 decks ask each fact once per cycle with deterministic spacing", () => {
  for (const mode of ["visual", "listen"]) {
    const first = createBaseDeck(mode, {
      level: "B140",
      cycle: 1,
      random: createSeededRandom(1_140),
    });
    const repeated = createBaseDeck(mode, {
      level: "B140",
      cycle: 1,
      random: createSeededRandom(1_140),
    });

    assert.equal(first.length, 64);
    assert.equal(new Set(first.map((card) => card.factKey)).size, 64);
    assert.deepEqual(
      first.map((card) => card.id),
      repeated.map((card) => card.id),
    );
    assertFactSpacing(first);
  }
});

test("finite B140 decks finish after exactly one compact catalogue", () => {
  const deck = createSubtractionDeck({
    level: "B140",
    mode: "visual",
    repeat: false,
    random: createSeededRandom(14_064),
  });
  let count = 0;

  while (!deck.snapshot().exhausted) {
    const draw = deck.next();
    assert.equal(draw.baseDeckSize, 64);
    count += 1;
    deck.recordOutcome(draw.card, { correct: true, elapsedMs: 900 });
  }

  assert.equal(count, 64);
  assert.equal(deck.snapshot().cycle, 1);
});

test("B120 uses one shuffled card per fact and balances layouts over cycles", () => {
  const firstCycle = createBaseDeck("visual", {
    level: "B120",
    cycle: 1,
    random: createSeededRandom(901),
  });
  const secondCycle = createBaseDeck("visual", {
    level: "B120",
    cycle: 2,
    random: createSeededRandom(902),
  });
  const facts = subtractionFactsForLevel("B120");

  assert.equal(firstCycle.length, facts.length);
  assert.equal(
    firstCycle.length,
    facts.length * SUBTRACTION_LEVEL_CONFIG.B120.visualCopies,
  );
  assertFactSpacing(firstCycle);
  assert.equal(
    new Set(firstCycle.map((card) => card.factKey)).size,
    facts.length,
  );

  for (const fact of facts) {
    const first = firstCycle.find((card) => card.factKey === fact.factKey);
    const second = secondCycle.find((card) => card.factKey === fact.factKey);
    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first.orientation, second.orientation);
  }
});

test("finite B120 decks finish after the harder catalogue plus bounded reviews", () => {
  const deck = createSubtractionDeck({
    level: "B120",
    mode: "visual",
    repeat: false,
    random: createSeededRandom(1_120),
  });
  let count = 0;
  let baseDeckSize = 0;
  while (!deck.snapshot().exhausted) {
    const draw = deck.next();
    baseDeckSize ||= draw.baseDeckSize;
    count += 1;
    deck.recordOutcome(draw.card, { correct: true, elapsedMs: 900 });
  }
  assert.equal(baseDeckSize, subtractionFactsForLevel("B120").length);
  assert.equal(count, baseDeckSize);
});

test("visual cycles balance both layouts and keep duplicate facts apart", () => {
  const cards = createBaseDeck("visual", {
    random: createSeededRandom(91),
  });
  assert.equal(cards.length, 72);
  assertFactSpacing(cards);

  for (const fact of SUBTRACTION_FACTS) {
    const copies = cards.filter((card) => card.factKey === fact.factKey);
    assert.equal(copies.length, 2);
    assert.deepEqual(
      new Set(copies.map((card) => card.orientation)),
      new Set(VISUAL_ORIENTATIONS),
    );
  }
});

test("listening cycles ask every fact the same number of times", () => {
  const cards = createBaseDeck("listen", {
    random: createSeededRandom(812),
  });
  assert.equal(cards.length, SUBTRACTION_FACTS.length * LISTEN_COPIES);
  assertFactSpacing(cards);

  for (const fact of SUBTRACTION_FACTS) {
    const copies = cards.filter((card) => card.factKey === fact.factKey);
    assert.equal(copies.length, LISTEN_COPIES);
    assert.equal(new Set(copies.map((card) => card.id)).size, LISTEN_COPIES);
    assert.ok(copies.every((card) => !("spokenVariant" in card)));
  }
});

test("a seed reproduces the same shuffled cycle", () => {
  const first = createBaseDeck("listen", {
    random: createSeededRandom(2_026),
  }).map((card) => card.id);
  const second = createBaseDeck("listen", {
    random: createSeededRandom(2_026),
  }).map((card) => card.id);
  assert.deepEqual(first, second);
});

test("cycle reshuffles preserve spacing across the boundary", () => {
  const deck = createSubtractionDeck({
    mode: "visual",
    random: createSeededRandom(77),
  });
  const draws = [];
  for (let index = 0; index < 78; index += 1) {
    const draw = deck.next();
    draws.push(draw);
    deck.recordOutcome(draw.card, { correct: true, elapsedMs: 700 });
  }
  const firstCycle = draws.filter((draw) => draw.cycle === 1);

  assert.equal(firstCycle.length, 72);
  assert.equal(draws.at(-1).cycle, 2);
  assertFactSpacing(draws.map((draw) => draw.card));

  const counts = new Map();
  for (const { card } of firstCycle) {
    counts.set(card.factKey, (counts.get(card.factKey) ?? 0) + 1);
  }
  assert.deepEqual(new Set(counts.values()), new Set([2]));
});

test("wrong and over-four-second facts wait for end redemption", () => {
  const deck = createSubtractionDeck({
    mode: "listen",
    random: createSeededRandom(515),
  });
  const first = deck.next().card;
  const queued = deck.recordOutcome(first, {
    correct: false,
    elapsedMs: 800,
  });
  assert.deepEqual(queued, {
    flagged: true,
    reinserted: true,
    reason: "incorrect",
    firstAttempt: true,
    firstAttemptMiss: true,
    resolved: false,
  });

  assert.throws(() => deck.next(), /must be solved/);
  assert.equal(
    deck.recordOutcome(first, {
      correct: false,
      elapsedMs: SLOW_RESPONSE_MS + 1,
    }).reinserted,
    false,
  );
  assert.deepEqual(
    deck.recordOutcome(first, { correct: true, elapsedMs: 900 }),
    {
      flagged: false,
      reinserted: false,
      reason: null,
      firstAttempt: false,
      firstAttemptMiss: false,
      resolved: true,
    },
  );

  const onTime = deck.next().card;
  assert.equal(
    deck.recordOutcome(onTime, {
      correct: true,
      elapsedMs: SLOW_RESPONSE_MS,
    }).flagged,
    false,
  );
  const slow = deck.next().card;
  assert.deepEqual(
    deck.recordOutcome(slow, {
      correct: true,
      elapsedMs: SLOW_RESPONSE_MS + 1,
    }),
    {
      flagged: true,
      reinserted: true,
      reason: "slow",
      firstAttempt: true,
      firstAttemptMiss: false,
      resolved: true,
    },
  );

  const redemption = deck.beginRedemption();
  assert.deepEqual(redemption, {
    started: true,
    pending: 2,
    phase: "redemption",
  });
  assert.equal(deck.snapshot().phase, "redemption");

  const reviewFacts = [];
  while (!deck.snapshot().exhausted) {
    const review = deck.next().card;
    reviewFacts.push(review.factKey);
    assert.equal(review.isReview, true);
    assert.match(review.id, /:redemption$/);
    assert.deepEqual(
      deck.recordOutcome(review, { correct: true, elapsedMs: 80_000 }),
      {
        flagged: false,
        reinserted: false,
        reason: null,
        firstAttempt: true,
        firstAttemptMiss: false,
        resolved: true,
      },
    );
  }
  assert.deepEqual(new Set(reviewFacts), new Set([first.factKey, slow.factKey]));
  assert.equal(deck.snapshot().redemptionPending, 0);
});

test("repeated misses cannot create an infinite review loop", () => {
  const deck = createSubtractionDeck({
    mode: "visual",
    random: createSeededRandom(19),
  });
  for (let index = 0; index < 500; index += 1) {
    const { card } = deck.next();
    deck.recordOutcome(card, {
      correct: false,
      elapsedMs: SLOW_RESPONSE_MS + 10,
    });
    deck.recordOutcome(card, {
      correct: false,
      elapsedMs: SLOW_RESPONSE_MS + 10,
    });
    deck.recordOutcome(card, { correct: true, elapsedMs: 500 });
  }

  assert.equal(
    deck.snapshot().reviewedFactCount,
    SUBTRACTION_FACTS.length,
  );
  assert.equal(deck.beginRedemption().pending, SUBTRACTION_FACTS.length);

  let reviewCount = 0;
  while (!deck.snapshot().exhausted) {
    const { card } = deck.next();
    reviewCount += 1;
    const firstMiss = deck.recordOutcome(card, {
      correct: false,
      elapsedMs: SLOW_RESPONSE_MS + 10,
    });
    assert.equal(firstMiss.reinserted, false);
    assert.throws(() => deck.next(), /must be solved/);
    deck.recordOutcome(card, { correct: true, elapsedMs: 500 });
  }

  assert.equal(reviewCount, SUBTRACTION_FACTS.length);
  assert.equal(deck.snapshot().phase, "complete");
});

test("finite decks stop after one complete cycle", () => {
  for (const [mode, expectedCount] of [
    ["visual", 72],
    ["listen", 108],
  ]) {
    const deck = createSubtractionDeck({
      mode,
      repeat: false,
      random: createSeededRandom(404),
    });
    let count = 0;

    while (!deck.snapshot().exhausted) {
      const { card } = deck.next();
      count += 1;
      deck.recordOutcome(card, { correct: true, elapsedMs: 500 });
    }

    assert.equal(count, expectedCount);
    assert.equal(deck.snapshot().cycle, 1);
    assert.throws(() => deck.next(), /exhausted/);
  }
});

test("a late miss becomes one untimed redemption card", () => {
  const deck = createSubtractionDeck({
    mode: "visual",
    repeat: false,
    random: createSeededRandom(123),
  });
  let finalBaseCard;

  for (let index = 0; index < 72; index += 1) {
    const { card } = deck.next();
    if (index === 71) {
      finalBaseCard = card;
      deck.recordOutcome(card, { correct: false, elapsedMs: 800 });
      assert.equal(deck.snapshot().practiceExhausted, false);
      assert.throws(() => deck.next(), /must be solved/);
      deck.recordOutcome(card, { correct: true, elapsedMs: 800 });
    } else {
      deck.recordOutcome(card, { correct: true, elapsedMs: 800 });
    }
  }

  assert.ok(finalBaseCard);
  assert.equal(deck.snapshot().exhausted, false);
  assert.equal(deck.snapshot().remaining, 1);
  assert.equal(deck.snapshot().practiceExhausted, true);

  const review = deck.next().card;
  assert.equal(review.id, `${finalBaseCard.id}:redemption`);
  assert.equal(review.isReview, true);
  deck.recordOutcome(review, {
    correct: false,
    elapsedMs: SLOW_RESPONSE_MS + 1,
  });
  assert.equal(deck.snapshot().exhausted, false);
  assert.throws(() => deck.next(), /must be solved/);
  deck.recordOutcome(review, { correct: true, elapsedMs: 400 });

  assert.equal(deck.snapshot().exhausted, true);
  assert.equal(deck.snapshot().phase, "complete");
  assert.equal(deck.snapshot().cycle, 1);
});

test("manual Infinite finish is idempotent and discards the unfinished base run", () => {
  const deck = createSubtractionDeck({
    mode: "visual",
    random: createSeededRandom(909),
  });
  const missed = deck.next().card;
  deck.recordOutcome(missed, { correct: false, elapsedMs: 700 });
  deck.recordOutcome(missed, { correct: true, elapsedMs: 500 });

  const next = deck.next().card;
  deck.recordOutcome(next, { correct: true, elapsedMs: 500 });
  assert.ok(deck.snapshot().remaining > 1);

  assert.deepEqual(deck.beginRedemption(), {
    started: true,
    pending: 1,
    phase: "redemption",
  });
  assert.deepEqual(deck.beginRedemption(), {
    started: false,
    pending: 1,
    phase: "redemption",
  });

  const review = deck.next().card;
  assert.equal(review.factKey, missed.factKey);
  deck.recordOutcome(review, { correct: true, elapsedMs: 999_999 });
  assert.equal(deck.snapshot().exhausted, true);
});

test("the answer list is stable, distinct, and always contains the result", () => {
  for (const fact of SUBTRACTION_FACTS) {
    const answers = buildAnswerOptions(fact);
    assert.deepEqual(answers, ANSWER_VALUES);
    assert.equal(new Set(answers).size, answers.length);
    assert.ok(answers.includes(fact.answer));
  }
});
