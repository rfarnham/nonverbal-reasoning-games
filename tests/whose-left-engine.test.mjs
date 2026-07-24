import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_ROUNDS,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  EXAMPLE,
  GENERATOR_MAX_ATTEMPTS,
  buildAuthoredWhoseLeftRounds,
  buildCampaignRounds,
  correctSequenceForRound,
  generateInfiniteRound,
  landmarkLinksForRound,
  makeSeededRandom,
  namesForSequence,
  peopleOnSide,
  questionForRound,
  relativeSideOfSegment,
  routeCrossings,
  roundFingerprint,
  routeTopology,
  validateCampaign,
  validateRoute,
  validateRound,
} from "../app/games/whose-left/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildWhoseLeftJourneyExtraCampaignRounds,
} from "../app/games/whose-left/journey-campaign.ts";
import { progressionAdapter } from "../app/games/whose-left/progression-adapter.ts";

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

function routeFromPoints(points) {
  const segments = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const direction =
      from.x === to.x
        ? to.y < from.y
          ? "north"
          : "south"
        : to.x < from.x
          ? "west"
          : "east";
    return {
      index,
      from,
      to,
      direction,
      length: Math.hypot(to.x - from.x, to.y - from.y),
    };
  });
  return {
    points,
    segments,
    viewBox: { minX: -20, minY: -20, width: 40, height: 40 },
  };
}

function distanceToSegment(point, segment) {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const squaredLength = dx * dx + dy * dy;
  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.from.x) * dx +
        (point.y - segment.from.y) * dy) /
        squaredLength,
    ),
  );
  return Math.hypot(
    point.x - (segment.from.x + dx * progress),
    point.y - (segment.from.y + dy * progress),
  );
}

function orientation(first, second, third) {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function pointOnSegment(point, segment) {
  return (
    Math.abs(orientation(segment.from, segment.to, point)) < 1e-9 &&
    point.x >= Math.min(segment.from.x, segment.to.x) - 1e-9 &&
    point.x <= Math.max(segment.from.x, segment.to.x) + 1e-9 &&
    point.y >= Math.min(segment.from.y, segment.to.y) - 1e-9 &&
    point.y <= Math.max(segment.from.y, segment.to.y) + 1e-9
  );
}

function segmentsIntersect(first, second) {
  const firstStart = orientation(first.from, first.to, second.from);
  const firstEnd = orientation(first.from, first.to, second.to);
  const secondStart = orientation(second.from, second.to, first.from);
  const secondEnd = orientation(second.from, second.to, first.to);
  if (firstStart * firstEnd < -1e-9 && secondStart * secondEnd < -1e-9) {
    return true;
  }
  return (
    pointOnSegment(second.from, first) ||
    pointOnSegment(second.to, first) ||
    pointOnSegment(first.from, second) ||
    pointOnSegment(first.to, second)
  );
}

function assertExactLandmarkLinks(round, context = round.id) {
  const links = landmarkLinksForRound(round);
  assert.equal(links.length, round.people.length, context);
  assert.deepEqual(
    links.map(({ person }) => person.id).sort(),
    round.people.map(({ id }) => id).sort(),
    context,
  );

  for (const { person, anchor, markerPosition } of links) {
    const segment = round.route.segments[person.segmentIndex];
    assert.ok(segment, `${context}:${person.id}`);
    assert.ok(
      [
        person.position.x,
        person.position.y,
        anchor.x,
        anchor.y,
        markerPosition.x,
        markerPosition.y,
      ].every(Number.isFinite),
      `${context}:${person.id}: tether coordinates must be finite`,
    );
    assert.ok(
      Math.hypot(person.position.x - anchor.x, person.position.y - anchor.y) >
        1e-9,
      `${context}:${person.id}: tether must have visible length`,
    );
    assert.ok(
      distanceToSegment(anchor, segment) < 1e-9,
      `${context}:${person.id}: anchor must be on assigned segment`,
    );
    const segmentX = segment.to.x - segment.from.x;
    const segmentY = segment.to.y - segment.from.y;
    const tetherX = person.position.x - anchor.x;
    const tetherY = person.position.y - anchor.y;
    assert.ok(
      Math.abs(segmentX * tetherX + segmentY * tetherY) < 1e-8,
      `${context}:${person.id}: tether must meet assigned segment perpendicularly`,
    );
    const renderedTetherX = markerPosition.x - anchor.x;
    const renderedTetherY = markerPosition.y - anchor.y;
    const markerExtensionX = markerPosition.x - person.position.x;
    const markerExtensionY = markerPosition.y - person.position.y;
    const logicalTetherLength = Math.hypot(tetherX, tetherY);
    const renderedTetherLength = Math.hypot(
      renderedTetherX,
      renderedTetherY,
    );
    assert.ok(
      Math.abs(segmentX * renderedTetherX + segmentY * renderedTetherY) < 1e-8,
      `${context}:${person.id}: rendered tether must remain perpendicular`,
    );
    assert.ok(
      renderedTetherX * tetherX + renderedTetherY * tetherY > 0,
      `${context}:${person.id}: marker must extend away from its anchor`,
    );
    assert.ok(
      markerExtensionX * tetherX + markerExtensionY * tetherY > 0,
      `${context}:${person.id}: visual extension must point outward`,
    );
    assert.ok(
      Math.abs(Math.hypot(markerExtensionX, markerExtensionY) - 0.4) < 1e-9,
      `${context}:${person.id}: visual extension must have its authored length`,
    );
    assert.ok(
      Math.abs(renderedTetherLength - logicalTetherLength - 0.4) < 1e-9,
      `${context}:${person.id}: rendered tether must expose its full extension`,
    );
    const { minX, minY, width, height } = round.route.viewBox;
    assert.ok(
      markerPosition.x - 1.45 >= minX - 1e-9 &&
        markerPosition.x + 1.45 <= minX + width + 1e-9 &&
        markerPosition.y - 1.45 >= minY - 1e-9 &&
        markerPosition.y + 1.45 <= minY + height + 1e-9,
      `${context}:${person.id}: rendered marker must remain inside the viewBox`,
    );
    assert.deepEqual(
      round.route.segments
        .filter((candidate) => distanceToSegment(anchor, candidate) < 1e-9)
        .map(({ index }) => index),
      [person.segmentIndex],
      `${context}:${person.id}: anchor cannot sit on a crossing`,
    );
    const tether = { from: anchor, to: markerPosition };
    for (const candidate of round.route.segments) {
      if (candidate.index === person.segmentIndex) continue;
      assert.equal(
        segmentsIntersect(tether, candidate),
        false,
        `${context}:${person.id}: tether cannot cross route section ${candidate.index}`,
      );
    }
  }

  for (const [index, first] of links.entries()) {
    for (const second of links.slice(index + 1)) {
      assert.ok(
        Math.hypot(
          first.markerPosition.x - second.markerPosition.x,
          first.markerPosition.y - second.markerPosition.y,
        ) > 2.9,
        `${context}:${first.person.id}-${second.person.id}: rendered markers cannot overlap`,
      );
    }
  }
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

    assertExactLandmarkLinks(round);

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

test("Journey II Whose Left banks are frozen, balanced, valid, and globally disjoint", () => {
  const expectations = {
    "junior-2": "Junior",
    "expert-2": "Expert",
    "wizard-2": "Wizard",
  };
  const standaloneFingerprints = CAMPAIGN_ROUNDS.map(roundFingerprint);
  const fingerprints = new Set(standaloneFingerprints);

  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.equal(CAMPAIGN_ROUNDS.length, 48);

  for (const [level, difficulty] of Object.entries(expectations)) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    const positions = rounds.map(({ correctIndex }) => correctIndex);
    assert.equal(rounds.length, 12, `${level} round count`);
    assert.equal(Object.isFrozen(rounds), true, `${level} frozen bank`);
    assert.ok(rounds.every(Object.isFrozen), `${level} frozen rounds`);
    assert.ok(
      rounds.every((round) => round.difficulty === difficulty),
      `${level} difficulty mapping`,
    );
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) =>
          positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${level} answer balance`,
    );
    assert.ok(
      positions.every(
        (position, index) =>
          index === 0 || positions[index - 1] !== position,
      ),
      `${level} adjacent answer repeat`,
    );
    const blocks = [0, 4, 8].map((start) =>
      positions.slice(start, start + 4).join(","),
    );
    assert.equal(
      new Set(blocks).size,
      blocks.length,
      `${level} repeated four-answer cycle`,
    );

    for (const round of rounds) {
      assert.deepEqual(validateRound(round).errors, [], round.id);
      assert.deepEqual(
        round.correctSequence,
        correctSequenceForRound(round),
        round.id,
      );
      assert.equal(new Set(round.options.map(sequenceKey)).size, 4);
      assertExactLandmarkLinks(round);
      const fingerprint = roundFingerprint(round);
      assert.equal(
        fingerprints.has(fingerprint),
        false,
        `${round.id} repeats standalone or Journey content`,
      );
      fingerprints.add(fingerprint);
    }
  }

  assert.equal(fingerprints.size, 84);
  assert.deepEqual(
    CAMPAIGN_ROUNDS.map(roundFingerprint),
    standaloneFingerprints,
  );
});

test("Journey II preserves route density while Wizard removes repeated direction cues", () => {
  const junior = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"];
  const expert = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"];
  const wizard = JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"];
  const topologyProfile = (rounds) =>
    rounds.map(({ route }) => {
      const topology = routeTopology(route);
      return `${topology.crossingCount}:${topology.headingReversals}`;
    });
  const sidePattern = (round) =>
    [...round.people]
      .sort((first, second) => first.segmentIndex - second.segmentIndex)
      .map(({ side }) => (side === "left" ? "L" : "R"))
      .join("");

  assert.deepEqual(topologyProfile(junior), [
    "0:1",
    "0:1",
    "0:2",
    "0:2",
    "1:2",
    "1:2",
    "1:2",
    "1:2",
    "1:3",
    "1:3",
    "1:3",
    "1:3",
  ]);
  assert.equal(new Set(junior.map(sidePattern)).size, 12);
  assert.deepEqual(
    new Set(junior.map(({ route }) => route.segments[0].direction)),
    new Set(["north", "east", "south", "west"]),
  );

  const advancedProfile = [
    "1:2",
    "1:2",
    "1:4",
    "1:4",
    "2:3",
    "2:3",
    "2:3",
    "2:3",
    "2:3",
    "2:3",
    "2:3",
    "2:3",
  ];
  assert.deepEqual(topologyProfile(expert), advancedProfile);
  assert.deepEqual(topologyProfile(wizard), advancedProfile);

  for (const round of junior) {
    assert.equal(round.route.segments.length, 6);
    assert.equal(peopleOnSide(round, "left").length, 3);
    assert.equal(peopleOnSide(round, "right").length, 3);
    assert.equal(round.scaffold.showIntermediateChevrons, true);
    assert.deepEqual(
      round.scaffold.directionCueSegmentIndexes,
      [0, 1, 2, 3, 4, 5],
    );
  }
  for (const round of expert) {
    assert.equal(round.route.segments.length, 8);
    assert.equal(peopleOnSide(round, "left").length, 4);
    assert.equal(peopleOnSide(round, "right").length, 4);
    assert.equal(round.scaffold.showIntermediateChevrons, true);
    assert.deepEqual(
      round.scaffold.directionCueSegmentIndexes,
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
  }
  for (const round of wizard) {
    assert.equal(round.route.segments.length, 8);
    assert.equal(peopleOnSide(round, "left").length, 4);
    assert.equal(peopleOnSide(round, "right").length, 4);
    assert.equal(round.scaffold.showIntermediateChevrons, false);
    assert.deepEqual(round.scaffold.directionCueSegmentIndexes, [0]);
  }
  for (const rounds of [junior, expert, wizard]) {
    assert.deepEqual(
      [
        rounds.filter(({ querySide }) => querySide === "left").length,
        rounds.filter(({ querySide }) => querySide === "right").length,
      ],
      [6, 6],
    );
    assert.deepEqual(
      new Set(rounds.map(({ route }) => route.segments[0].direction)),
      new Set(["north", "east", "south", "west"]),
    );
  }
});

test("Journey II options retain all three exact misconception models", () => {
  for (const rounds of Object.values(JOURNEY_EXTRA_CAMPAIGN_ROUNDS)) {
    for (const round of rounds) {
      const expected = correctSequenceForRound(round);
      const oppositeSequence = peopleOnSide(
        round,
        opposite(round.querySide),
      ).map(({ id }) => id);
      assert.deepEqual(
        optionOfKind(round, "opposite-side"),
        oppositeSequence,
      );
      assert.deepEqual(
        optionOfKind(round, "reversed-order"),
        [...expected].reverse(),
      );

      const nearMiss = optionOfKind(round, "one-person-off");
      const differences = nearMiss.flatMap((id, index) =>
        id === expected[index] ? [] : [index],
      );
      assert.equal(differences.length, 1);
      const target = round.people.find(
        ({ id }) => id === expected[differences[0]],
      );
      const replacement = round.people.find(
        ({ id }) => id === nearMiss[differences[0]],
      );
      assert.ok(target);
      assert.ok(replacement);
      assert.equal(replacement.side, opposite(round.querySide));
      const nearestDistance = Math.min(
        ...peopleOnSide(round, opposite(round.querySide)).map(
          ({ segmentIndex }) =>
            Math.abs(segmentIndex - target.segmentIndex),
        ),
      );
      assert.equal(
        Math.abs(replacement.segmentIndex - target.segmentIndex),
        nearestDistance,
      );
    }
  }
});

test("Journey II rebuilds without randomness and wires all seven adapter banks", () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Authored Journey construction cannot use randomness.");
  };
  try {
    assert.deepEqual(
      buildWhoseLeftJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(progressionAdapter.campaignRounds.length, 48);
  assert.equal(progressionAdapter.journeyContentVersion, "1");
  assert.deepEqual(
    Object.keys(progressionAdapter.journeyCampaignRounds),
    [
      "starter",
      "junior-1",
      "junior-2",
      "expert-1",
      "expert-2",
      "wizard-1",
      "wizard-2",
    ],
  );
  for (const [level, rounds] of Object.entries(
    progressionAdapter.journeyCampaignRounds,
  )) {
    assert.equal(rounds.length, 12, `${level} adapter bank`);
  }
  for (const level of ["junior-2", "expert-2", "wizard-2"]) {
    assert.deepEqual(
      progressionAdapter.journeyCampaignRounds[level].map(
        roundFingerprint,
      ),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level].map(roundFingerprint),
    );
  }

  assert.throws(
    () =>
      buildAuthoredWhoseLeftRounds([
        {
          id: "bad-sides",
          difficulty: "Junior",
          points: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
          ],
          sides: "X",
          querySide: "left",
          correctIndex: 0,
          nameOffset: 0,
          nearMissSalt: 0,
          distractorRotation: 0,
        },
      ]),
    /side assignments/,
  );
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

test("Campaign scaffolds bends, windings, and overpass loops in order", () => {
  const byDifficulty = Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      CAMPAIGN_ROUNDS.filter((round) => round.difficulty === difficulty),
    ]),
  );

  const starter = byDifficulty.Starter.map(({ route }) => routeTopology(route));
  assert.deepEqual(starter.map(({ crossingCount }) => crossingCount), Array(12).fill(0));
  assert.ok(starter.slice(0, 4).every(({ headingReversals }) => headingReversals === 0));
  assert.ok(starter.slice(4, 8).every(({ headingReversals }) => headingReversals >= 1));
  assert.ok(starter.slice(8).every(({ headingReversals }) => headingReversals >= 2));

  const junior = byDifficulty.Junior.map(({ route }) => routeTopology(route));
  assert.deepEqual(junior.slice(0, 4).map(({ crossingCount }) => crossingCount), [0, 0, 0, 0]);
  assert.ok(junior.slice(4).every(({ crossingCount }) => crossingCount === 1));
  assert.ok(junior.slice(8).every(({ headingReversals }) => headingReversals >= 3));

  for (const difficulty of ["Expert", "Wizard"]) {
    const topologies = byDifficulty[difficulty].map(({ route }) =>
      routeTopology(route),
    );
    assert.deepEqual(
      topologies.map(({ crossingCount }) => crossingCount),
      [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2],
      difficulty,
    );
  }
  assert.deepEqual(
    byDifficulty.Expert.map(({ route }) => routeTopology(route).crossingCount),
    byDifficulty.Wizard.map(({ route }) => routeTopology(route).crossingCount),
  );
});

test("crossings are straight-through bridges, never touches or junctions", () => {
  const properCrossing = routeFromPoints([
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: -8 },
    { x: 4, y: -8 },
    { x: 4, y: 4 },
  ]);
  assert.deepEqual(validateRoute(properCrossing).errors, []);
  assert.deepEqual(routeCrossings(properCrossing), [
    {
      point: { x: 4, y: 0 },
      underSegmentIndex: 0,
      overSegmentIndex: 3,
    },
  ]);

  const endpointTouch = routeFromPoints([
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: -8 },
    { x: 4, y: -8 },
    { x: 4, y: 0 },
  ]);
  assert.match(validateRoute(endpointTouch).errors.join(" "), /ambiguous/);

  const closedJunction = routeFromPoints([
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: -8 },
    { x: 0, y: -8 },
    { x: 0, y: 0 },
  ]);
  assert.equal(validateRoute(closedJunction).valid, false);

  const overlap = routeFromPoints([
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: -8 },
    { x: 4, y: -8 },
    { x: 4, y: 0 },
    { x: 10, y: 0 },
  ]);
  assert.match(validateRoute(overlap).errors.join(" "), /overlap/);
});

test("landmarks stay clear of every winding strand and answers follow traversal", () => {
  const crossedRounds = CAMPAIGN_ROUNDS.filter(
    ({ route }) => routeCrossings(route).length > 0,
  );
  assert.ok(crossedRounds.length > 0);

  for (const round of crossedRounds) {
    for (const person of round.people) {
      assert.ok(
        round.route.segments.every(
          (segment) => distanceToSegment(person.position, segment) >= 2.4 - 1e-9,
        ),
        `${round.id}:${person.id}`,
      );
    }
    const encounterIndexes = peopleOnSide(round, round.querySide).map(
      ({ segmentIndex }) => segmentIndex,
    );
    assert.deepEqual(encounterIndexes, [...encounterIndexes].sort((a, b) => a - b));
  }

  assert.ok(
    crossedRounds.some((round) => {
      const people = peopleOnSide(round, round.querySide);
      const xOrder = [...people].sort(
        (first, second) => first.position.x - second.position.x,
      );
      return sequenceKey(people.map(({ id }) => id)) !== sequenceKey(xOrder.map(({ id }) => id));
    }),
    "At least one crossing puzzle must make screen order differ from route order.",
  );
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
    const crossingCounts = new Set();
    const turnSequences = new Set();

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
      assertExactLandmarkLinks(first, `${difficulty}:${seed}`);
      const topology = routeTopology(first.route);
      const rules = DIFFICULTY_RULES[difficulty];
      assert.ok(
        topology.crossingCount >= rules.minCrossings &&
          topology.crossingCount <= rules.maxCrossings,
        `${difficulty}:${seed}`,
      );
      assert.ok(
        topology.headingReversals >= rules.minHeadingReversals,
        `${difficulty}:${seed}`,
      );

      fingerprints.add(roundFingerprint(first));
      querySides.add(first.querySide);
      answerPositions.add(first.correctIndex);
      startingDirections.add(first.route.segments[0].direction);
      crossingCounts.add(topology.crossingCount);
      turnSequences.add(topology.turnSequence);
    }

    assert.equal(fingerprints.size, 400, difficulty);
    assert.deepEqual([...querySides].sort(), ["left", "right"], difficulty);
    assert.deepEqual([...answerPositions].sort(), [0, 1, 2, 3], difficulty);
    assert.deepEqual(
      [...startingDirections].sort(),
      ["east", "north", "south", "west"],
      difficulty,
    );
    const expectedCrossingCounts = {
      Starter: [0],
      Junior: [0, 1],
      Expert: [1, 2],
      Wizard: [1, 2],
    };
    assert.deepEqual(
      [...crossingCounts].sort((a, b) => a - b),
      expectedCrossingCounts[difficulty],
      difficulty,
    );
    assert.ok(turnSequences.size >= 4, difficulty);
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

  const deterministic = generateInfiniteRound("Wizard", () => 0);
  const excluded = new Set([roundFingerprint(deterministic)]);
  let calls = 0;
  assert.throws(
    () =>
      generateInfiniteRound("Wizard", () => {
        calls += 1;
        return 0;
      }, excluded),
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
