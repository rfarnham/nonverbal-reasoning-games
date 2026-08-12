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
  assert.deepEqual(SUBTRACTION_LEVELS, ["B100", "B120"]);
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
  const draws = Array.from({ length: 78 }, () => deck.next());
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

test("wrong and over-four-second facts return once, then stop", () => {
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
  });

  const intervening = [];
  let review;
  for (let index = 0; index < 130; index += 1) {
    const draw = deck.next();
    if (draw.card.id === `${first.id}:review`) {
      review = draw.card;
      break;
    }
    intervening.push(draw.card);
  }

  assert.ok(review, "the flagged card returns");
  assert.ok(intervening.length >= REVIEW_SPACING);
  assert.equal(review.isReview, true);
  assert.equal(
    deck.recordOutcome(review, {
      correct: false,
      elapsedMs: SLOW_RESPONSE_MS + 1,
    }).reinserted,
    false,
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
    { flagged: true, reinserted: true, reason: "slow" },
  );
});

test("repeated misses cannot create an infinite review loop", () => {
  const deck = createSubtractionDeck({
    mode: "visual",
    random: createSeededRandom(19),
  });
  let reviewCount = 0;

  for (let index = 0; index < 500; index += 1) {
    const { card } = deck.next();
    if (card.isReview) reviewCount += 1;
    deck.recordOutcome(card, {
      correct: false,
      elapsedMs: SLOW_RESPONSE_MS + 10,
    });
  }

  assert.ok(reviewCount > 0);
  assert.ok(reviewCount <= SUBTRACTION_FACTS.length);
  assert.equal(
    deck.snapshot().reviewedFactCount,
    SUBTRACTION_FACTS.length,
  );
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

test("a late review drains without starting a second finite cycle", () => {
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
    } else {
      deck.recordOutcome(card, { correct: true, elapsedMs: 800 });
    }
  }

  assert.ok(finalBaseCard);
  assert.equal(deck.snapshot().exhausted, false);
  assert.equal(deck.snapshot().remaining, 1);

  const review = deck.next().card;
  assert.equal(review.id, `${finalBaseCard.id}:review`);
  assert.equal(review.isReview, true);
  deck.recordOutcome(review, {
    correct: false,
    elapsedMs: SLOW_RESPONSE_MS + 1,
  });

  assert.equal(deck.snapshot().exhausted, true);
  assert.equal(deck.snapshot().cycle, 1);
});

test("the answer list is stable, distinct, and always contains the result", () => {
  for (const fact of SUBTRACTION_FACTS) {
    const answers = buildAnswerOptions(fact);
    assert.deepEqual(answers, ANSWER_VALUES);
    assert.equal(new Set(answers).size, answers.length);
    assert.ok(answers.includes(fact.answer));
  }
});
