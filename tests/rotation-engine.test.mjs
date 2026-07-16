import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUNDS,
  TUTORIAL,
  applyRotation,
  applyTransform,
  buildRounds,
  patternKey,
  reflectPattern,
  rotatePattern,
} from "../app/games/rotation-match/game-engine.ts";

test("every round has one exact answer and three distinct near-matches", () => {
  assert.equal(ROUNDS.length, 12);

  for (const [index, round] of ROUNDS.entries()) {
    assert.equal(round.clue.length, 9, `round ${index + 1} clue size`);
    assert.equal(round.options.length, 4, `round ${index + 1} option count`);
    assert.equal(round.optionKinds.length, 4, `round ${index + 1} option labels`);
    assert.equal(
      new Set(round.options.map(patternKey)).size,
      4,
      `round ${index + 1} options must be unique`,
    );

    const expected = applyTransform(round.clue, round.transform);
    assert.equal(patternKey(expected), patternKey(round.correctPattern));
    assert.deepEqual(
      round.options.flatMap((option, optionIndex) =>
        patternKey(option) === patternKey(expected) ? [optionIndex] : [],
      ),
      [round.correctIndex],
      `round ${index + 1} must have exactly one exact answer`,
    );
    assert.equal(round.optionKinds[round.correctIndex], "correct");
  }
});

test("the progression starts flat and introduces directional motifs only on hard rounds", () => {
  const difficulties = ROUNDS.map((round) => round.difficulty);
  assert.deepEqual(difficulties, [
    "Easy",
    "Easy",
    "Easy",
    "Easy",
    "Medium",
    "Medium",
    "Medium",
    "Medium",
    "Hard",
    "Hard",
    "Hard",
    "Hard",
  ]);

  for (const round of ROUNDS.filter(({ difficulty }) => difficulty !== "Hard")) {
    assert.ok(round.clue.every((tile) => tile.motif === "none"));
  }

  for (const round of ROUNDS.filter(({ difficulty }) => difficulty === "Hard")) {
    assert.ok(round.clue.some((tile) => tile.motif === "cap"));
  }
});

test("rounds mix both directions and every supported turn length", () => {
  const rotations = ROUNDS.filter(
    ({ transform }) => transform.kind === "rotation",
  );
  assert.deepEqual(
    new Set(rotations.map(({ transform }) => transform.direction)),
    new Set(["clockwise", "counterclockwise"]),
  );
  assert.deepEqual(
    new Set(rotations.map(({ transform }) => transform.degrees)),
    new Set([90, 180, 270]),
  );
  assert.ok(
    rotations.every(({ transform }) =>
      transform.direction === "clockwise"
        ? transform.angleDegrees > 0
        : transform.angleDegrees < 0,
    ),
  );
});

test("all four mirror axes appear as operations and distractors", () => {
  const reflectionAxes = new Set(
    ROUNDS.flatMap(({ transform }) =>
      transform.kind === "reflection" ? [transform.axis] : [],
    ),
  );
  assert.deepEqual(
    reflectionAxes,
    new Set([
      "vertical",
      "horizontal",
      "main-diagonal",
      "anti-diagonal",
    ]),
  );

  const optionKinds = new Set(ROUNDS.flatMap((round) => round.optionKinds));
  assert.ok(optionKinds.has("mirror-vertical"));
  assert.ok(optionKinds.has("mirror-horizontal"));
  assert.ok(optionKinds.has("mirror-main-diagonal"));
  assert.ok(optionKinds.has("mirror-anti-diagonal"));

  const kindToAxis = {
    "mirror-vertical": "vertical",
    "mirror-horizontal": "horizontal",
    "mirror-main-diagonal": "main-diagonal",
    "mirror-anti-diagonal": "anti-diagonal",
  };
  for (const [roundIndex, round] of ROUNDS.entries()) {
    for (const [optionIndex, kind] of round.optionKinds.entries()) {
      if (!(kind in kindToAxis)) continue;
      assert.equal(
        patternKey(round.options[optionIndex]),
        patternKey(reflectPattern(round.clue, kindToAxis[kind])),
        `round ${roundIndex + 1} ${kind} must be the exact reflected clue`,
      );
    }
  }
});

test("motif orientation follows rotations and reflections", () => {
  const source = [
    { color: "empty", motif: "none", orientation: 0 },
    { color: "coral", motif: "cap", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
    { color: "empty", motif: "none", orientation: 0 },
  ];

  const clockwise = rotatePattern(source, 1);
  assert.equal(clockwise[5].color, "coral");
  assert.equal(clockwise[5].orientation, 1);

  const counterclockwise = rotatePattern(source, -1);
  assert.equal(counterclockwise[3].color, "coral");
  assert.equal(counterclockwise[3].orientation, 3);

  assert.equal(reflectPattern(source, "vertical")[1].orientation, 0);
  assert.equal(reflectPattern(source, "horizontal")[7].orientation, 2);
  assert.equal(reflectPattern(source, "main-diagonal")[3].orientation, 3);
  assert.equal(reflectPattern(source, "anti-diagonal")[5].orientation, 1);

  for (const axis of [
    "vertical",
    "horizontal",
    "main-diagonal",
    "anti-diagonal",
  ]) {
    for (const orientation of [0, 1, 2, 3]) {
      const oriented = source.map((tile) =>
        tile.color === "coral" ? { ...tile, orientation } : tile,
      );
      assert.equal(
        patternKey(reflectPattern(reflectPattern(oriented, axis), axis)),
        patternKey(oriented),
        `${axis} reflection must be its own inverse at orientation ${orientation}`,
      );
    }
  }
});

test("medium rounds use one-block-off near matches", () => {
  for (const round of ROUNDS.filter(({ difficulty }) => difficulty === "Medium")) {
    assert.ok(round.optionKinds.includes("one-block-off"));
  }
});

test("hard near-matches include mirrors and one-motif changes", () => {
  const hardRounds = ROUNDS.filter(({ difficulty }) => difficulty === "Hard");
  const hardKinds = hardRounds.flatMap(({ optionKinds }) => optionKinds);
  assert.ok(hardKinds.some((kind) => kind.startsWith("mirror-")));
  assert.ok(
    hardRounds.every(({ optionKinds }) => optionKinds.includes("one-motif-off")),
  );

  const hardRotationOutcomes = hardRounds.flatMap(({ transform }) =>
    transform.kind === "rotation"
      ? [
          ((transform.direction === "clockwise"
            ? transform.quarterTurns
            : -transform.quarterTurns) +
            4) %
            4,
        ]
      : [],
  );
  assert.equal(new Set(hardRotationOutcomes).size, hardRotationOutcomes.length);
});

test("tutorial demonstrates a true turn beside a mirror trap", () => {
  assert.equal(
    patternKey(TUTORIAL.answer),
    patternKey(applyRotation(TUTORIAL.clue, TUTORIAL.transform)),
  );
  assert.notEqual(patternKey(TUTORIAL.answer), patternKey(TUTORIAL.mirror));
});

test("authored rounds build deterministically", () => {
  assert.deepEqual(buildRounds(), ROUNDS);
});
