import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_ROUNDS,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  EXAMPLE,
  GENERATOR_MAX_ATTEMPTS,
  buildCampaignRounds,
  correctSequenceForRound,
  generateInfiniteRound,
  makeSeededRandom,
  namesForSequence,
  peopleOnSide,
  questionForRound,
  relativeSideOfSegment,
  roundFingerprint,
  validateCampaign,
  validateRound,
} from "../app/games/whose-left/game-engine.ts";

function sequenceKey(sequence) {
  return sequence.join(">");
}

function optionOfKind(round, kind) {
  return round.options[round.optionKinds.indexOf(kind)];
}

function opposite(side) {
  return side === "left" ? "right" : "left";
}

function cloned(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Campaign contains 12 deterministic, frozen rounds at every level", () => {
  assert.equal(CAMPAIGN_ROUNDS.length, 48);
  assert.equal(validateCampaign(CAMPAIGN_ROUNDS).valid, true);
  assert.deepEqual(buildCampaignRounds(), CAMPAIGN_ROUNDS);
  assert.notStrictEqual(buildCampaignRounds(), CAMPAIGN_ROUNDS);
  assert.equal(Object.isFrozen(CAMPAIGN_ROUNDS), true);

  for (const difficulty of DIFFICULTIES) {
    const rounds = CAMPAIGN_ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    );
    assert.equal(rounds.length, 12, difficulty);
    assert.ok(rounds.every(Object.isFrozen), difficulty);
  }
});

test("every Campaign round calculates one exact answer from valid geometry", () => {
  const fingerprints = new Set();

  for (const round of CAMPAIGN_ROUNDS) {
    const validation = validateRound(round);
    assert.deepEqual(validation.errors, [], round.id);
    assert.deepEqual(
      round.correctSequence,
      correctSequenceForRound(round),
      round.id,
    );
    assert.equal(round.options.length, 4, round.id);
    assert.equal(new Set(round.options.map(sequenceKey)).size, 4, round.id);
    assert.equal(
      round.options.filter(
        (option) =>
          sequenceKey(option) === sequenceKey(round.correctSequence),
      ).length,
      1,
      round.id,
    );
    assert.deepEqual(
      round.options[round.correctIndex],
      round.correctSequence,
      round.id,
    );

    const rules = DIFFICULTY_RULES[round.difficulty];
    assert.equal(round.route.segments.length, rules.segmentCount, round.id);
    assert.equal(round.people.length, rules.segmentCount, round.id);
    assert.equal(
      peopleOnSide(round, "left").length,
      rules.peoplePerSide,
      round.id,
    );
    assert.equal(
      peopleOnSide(round, "right").length,
      rules.peoplePerSide,
      round.id,
    );
    assert.equal(
      new Set(round.people.map(({ id }) => id)).size,
      round.people.length,
      round.id,
    );

    for (const person of round.people) {
      assert.equal(
        relativeSideOfSegment(
          round.route.segments[person.segmentIndex],
          person.position,
        ),
        person.side,
        `${round.id}:${person.id}`,
      );
    }

    fingerprints.add(roundFingerprint(round));
  }

  assert.equal(fingerprints.size, CAMPAIGN_ROUNDS.length);
});

test("Campaign answer positions are balanced without exploitable repetition", () => {
  for (const difficulty of DIFFICULTIES) {
    const positions = CAMPAIGN_ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    ).map(({ correctIndex }) => correctIndex);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      difficulty,
    );
    assert.equal(
      positions.some(
        (position, index) =>
          index > 0 && position === positions[index - 1],
      ),
      false,
      difficulty,
    );
    assert.equal(
      positions.slice(4).every(
        (position, index) => position === positions[index],
      ),
      false,
      difficulty,
    );
  }
});

test("distractors encode the opposite side, reverse order, and one local miss", () => {
  for (const round of CAMPAIGN_ROUNDS) {
    const oppositeSequence = peopleOnSide(
      round,
      opposite(round.querySide),
    ).map(({ id }) => id);
    assert.deepEqual(
      optionOfKind(round, "opposite-side"),
      oppositeSequence,
      round.id,
    );
    assert.deepEqual(
      optionOfKind(round, "reversed-order"),
      [...round.correctSequence].reverse(),
      round.id,
    );

    const nearMiss = optionOfKind(round, "one-person-off");
    const differenceIndexes = nearMiss.flatMap((id, index) =>
      id === round.correctSequence[index] ? [] : [index],
    );
    assert.equal(differenceIndexes.length, 1, round.id);
    const differenceIndex = differenceIndexes[0];
    const target = round.people.find(
      ({ id }) => id === round.correctSequence[differenceIndex],
    );
    const replacement = round.people.find(
      ({ id }) => id === nearMiss[differenceIndex],
    );
    assert.ok(target, round.id);
    assert.ok(replacement, round.id);
    assert.equal(replacement.side, opposite(round.querySide), round.id);
    const nearestDistance = Math.min(
      ...peopleOnSide(round, opposite(round.querySide)).map(({ segmentIndex }) =>
        Math.abs(segmentIndex - target.segmentIndex),
      ),
    );
    assert.equal(
      Math.abs(replacement.segmentIndex - target.segmentIndex),
      nearestDistance,
      round.id,
    );
  }
});

test("difficulty increases path load while Wizard removes repeated cues", () => {
  assert.equal(DIFFICULTY_RULES.Starter.segmentCount, 4);
  assert.equal(DIFFICULTY_RULES.Junior.segmentCount, 6);
  assert.equal(DIFFICULTY_RULES.Expert.segmentCount, 8);
  assert.equal(DIFFICULTY_RULES.Wizard.segmentCount, 8);
  assert.equal(
    DIFFICULTY_RULES.Expert.peoplePerSide,
    DIFFICULTY_RULES.Wizard.peoplePerSide,
  );

  for (const round of CAMPAIGN_ROUNDS) {
    const rules = DIFFICULTY_RULES[round.difficulty];
    if (round.difficulty === "Wizard") {
      assert.equal(round.scaffold.showIntermediateChevrons, false, round.id);
      assert.deepEqual(round.scaffold.directionCueSegmentIndexes, [0], round.id);
    } else {
      assert.equal(round.scaffold.showIntermediateChevrons, true, round.id);
      assert.deepEqual(
        round.scaffold.directionCueSegmentIndexes,
        Array.from({ length: rules.segmentCount }, (_, index) => index),
        round.id,
      );
    }
  }
});

test("fingerprints ignore answer order and route translation", () => {
  const round = CAMPAIGN_ROUNDS[9];
  const reordered = {
    ...round,
    options: [...round.options].reverse(),
    optionKinds: [...round.optionKinds].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  assert.equal(roundFingerprint(reordered), roundFingerprint(round));

  const dx = 17;
  const dy = -23;
  const translated = {
    ...round,
    route: {
      ...round.route,
      points: round.route.points.map(({ x, y }) => ({ x: x + dx, y: y + dy })),
      segments: round.route.segments.map((segment) => ({
        ...segment,
        from: { x: segment.from.x + dx, y: segment.from.y + dy },
        to: { x: segment.to.x + dx, y: segment.to.y + dy },
      })),
      viewBox: {
        ...round.route.viewBox,
        minX: round.route.viewBox.minX + dx,
        minY: round.route.viewBox.minY + dy,
      },
    },
    people: round.people.map((person) => ({
      ...person,
      position: {
        x: person.position.x + dx,
        y: person.position.y + dy,
      },
    })),
  };
  assert.equal(validateRound(translated).valid, true);
  assert.equal(roundFingerprint(translated), roundFingerprint(round));
});

test("validation rejects trusted labels that disagree with the geometry", () => {
  const wrongSide = cloned(CAMPAIGN_ROUNDS[0]);
  wrongSide.people[0].side =
    wrongSide.people[0].side === "left" ? "right" : "left";
  assert.equal(validateRound(wrongSide).valid, false);

  const wrongAnswer = cloned(CAMPAIGN_ROUNDS[0]);
  wrongAnswer.correctSequence = [...wrongAnswer.correctSequence].reverse();
  assert.equal(validateRound(wrongAnswer).valid, false);

  const duplicatedCampaign = [
    ...CAMPAIGN_ROUNDS.slice(0, -1),
    CAMPAIGN_ROUNDS[0],
  ];
  assert.equal(validateCampaign(duplicatedCampaign).valid, false);
});

test("1,600 seeded Infinite rounds are valid, reproducible, varied, and unique", () => {
  for (const difficulty of DIFFICULTIES) {
    const fingerprints = new Set();
    const querySides = new Set();
    const answerPositions = new Set();
    const startingDirections = new Set();

    for (let seed = 0; seed < 400; seed += 1) {
      const first = generateInfiniteRound(
        difficulty,
        makeSeededRandom(seed),
      );
      const second = generateInfiniteRound(
        difficulty,
        makeSeededRandom(seed),
      );
      assert.deepEqual(first, second, `${difficulty}:${seed}`);
      assert.equal(validateRound(first).valid, true, `${difficulty}:${seed}`);
      assert.deepEqual(
        first.correctSequence,
        correctSequenceForRound(first),
        `${difficulty}:${seed}`,
      );
      assert.equal(
        new Set(first.options.map(sequenceKey)).size,
        4,
        `${difficulty}:${seed}`,
      );

      fingerprints.add(roundFingerprint(first));
      querySides.add(first.querySide);
      answerPositions.add(first.correctIndex);
      startingDirections.add(first.route.segments[0].direction);
    }

    assert.equal(fingerprints.size, 400, difficulty);
    assert.deepEqual([...querySides].sort(), ["left", "right"], difficulty);
    assert.deepEqual([...answerPositions].sort(), [0, 1, 2, 3], difficulty);
    assert.deepEqual(
      [...startingDirections].sort(),
      ["east", "north", "south", "west"],
      difficulty,
    );
  }
});

test("Infinite excludes fingerprints already seen in the current session", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const seen = new Set();
    const random = makeSeededRandom(7_000 + difficultyIndex);
    for (let index = 0; index < 100; index += 1) {
      const round = generateInfiniteRound(difficulty, random, seen);
      const fingerprint = roundFingerprint(round);
      assert.equal(seen.has(fingerprint), false, `${difficulty}:${index}`);
      seen.add(fingerprint);
    }
    assert.equal(seen.size, 100, difficulty);
  }
});

test("hostile random sources fail clearly within the attempt bound", () => {
  for (const value of [Number.NaN, -0.1, 1]) {
    assert.throws(
      () => generateInfiniteRound("Starter", () => value),
      /Random source/,
    );
  }

  let calls = 0;
  assert.throws(
    () =>
      generateInfiniteRound("Wizard", () => {
        calls += 1;
        return 0;
      }),
    new RegExp(
      `Unable to generate a valid Wizard round after ${GENERATOR_MAX_ATTEMPTS} attempts`,
    ),
  );
  assert.ok(calls <= GENERATOR_MAX_ATTEMPTS * 40, calls);
});

test("the solved example teaches the exact side and an opposite-side near miss", () => {
  assert.equal(validateRound(EXAMPLE.round).valid, true);
  assert.deepEqual(EXAMPLE.answer, correctSequenceForRound(EXAMPLE.round));
  assert.deepEqual(
    EXAMPLE.nearMatch,
    peopleOnSide(EXAMPLE.round, opposite(EXAMPLE.round.querySide)).map(
      ({ id }) => id,
    ),
  );
  assert.match(questionForRound(EXAMPLE.round), /left|right/);
  assert.equal(
    namesForSequence(EXAMPLE.round, EXAMPLE.answer).length,
    EXAMPLE.answer.length,
  );
  assert.equal(
    new Set([
      ...CAMPAIGN_ROUNDS.map(roundFingerprint),
      roundFingerprint(EXAMPLE.round),
    ]).size,
    CAMPAIGN_ROUNDS.length + 1,
  );
});
