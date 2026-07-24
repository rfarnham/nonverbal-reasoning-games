import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_ROUNDS_BY_DIFFICULTY,
  CELL_STATES,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  TUTORIAL,
  applyProgram,
  applyRule,
  buildCampaignRounds,
  differingStripIndexes,
  encodeStrip,
  generateInfiniteRound,
  makeSeededRandom,
  optionFeedback,
  orderedRuleIndexes,
  roundFingerprint,
  stripDistance,
  validateRound,
} from "../app/games/changing-strips/game-engine.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildChangingStripsJourneyExtraCampaignRounds,
} from "../app/games/changing-strips/journey-campaign.ts";
import { progressionAdapter } from "../app/games/changing-strips/progression-adapter.ts";

const GENERATED_COUNT_PER_DIFFICULTY = 400;

function executionKinds(round) {
  return orderedRuleIndexes(
    round.rules.length,
    round.processingDirection,
  ).map((index) => round.rules[index].kind);
}

function curriculumAllows(round) {
  const kindKey = executionKinds(round).join(",");
  return DIFFICULTY_RULES[round.difficulty].executionKindSequences.some(
    (sequence) => sequence.join(",") === kindKey,
  );
}

function assertTraceTruth(round, label) {
  const result = applyProgram(
    round.input,
    round.rules,
    round.processingDirection,
  );
  assert.deepEqual(result.output, round.answer, `${label} calculated answer`);
  assert.equal(result.steps.length, round.rules.length, `${label} trace length`);

  let current = [...round.input];
  const expectedRuleIndexes = orderedRuleIndexes(
    round.rules.length,
    round.processingDirection,
  );
  result.steps.forEach((step, executionIndex) => {
    assert.equal(step.executionIndex, executionIndex, `${label} execution index`);
    assert.equal(
      step.ruleIndex,
      expectedRuleIndexes[executionIndex],
      `${label} physical card index`,
    );
    assert.deepEqual(step.before, current, `${label} step snapshot`);
    assert.deepEqual(
      step.after,
      applyRule(step.before, step.rule),
      `${label} independently applied step`,
    );
    assert.deepEqual(
      step.changedIndexes,
      differingStripIndexes(step.before, step.after),
      `${label} exact changed indexes`,
    );
    assert.ok(step.changedIndexes.length > 0, `${label} has no no-op stage`);

    if (step.rule.kind === "neighbor") {
      for (const witness of step.conditionWitnesses) {
        const offset = step.rule.neighborDirection === "left" ? -1 : 1;
        assert.equal(
          witness.neighborIndex,
          witness.cellIndex + offset,
          `${label} adjacent witness side`,
        );
        assert.equal(
          step.before[witness.cellIndex],
          step.rule.from,
          `${label} witness source state`,
        );
        assert.equal(
          step.before[witness.neighborIndex],
          step.rule.neighbor,
          `${label} witness neighbor state`,
        );
        assert.equal(
          step.after[witness.cellIndex],
          step.rule.to,
          `${label} witness result state`,
        );
      }
      assert.equal(
        step.conditionWitnesses.length,
        step.changedIndexes.length,
        `${label} every conditional change has one witness`,
      );
    } else {
      assert.deepEqual(
        step.conditionWitnesses,
        [],
        `${label} non-conditional has no witness`,
      );
    }

    if (step.rule.kind === "shift") {
      assert.equal(
        step.movements.length,
        step.before.length,
        `${label} shift maps every cell`,
      );
      assert.equal(
        new Set(step.movements.map(({ fromIndex }) => fromIndex)).size,
        step.before.length,
        `${label} shift uses each source once`,
      );
      assert.equal(
        new Set(step.movements.map(({ toIndex }) => toIndex)).size,
        step.before.length,
        `${label} shift fills each target once`,
      );
      const reconstructed = Array(step.before.length);
      for (const movement of step.movements) {
        assert.equal(
          movement.state,
          step.before[movement.fromIndex],
          `${label} movement retains state`,
        );
        reconstructed[movement.toIndex] = movement.state;
      }
      assert.deepEqual(
        reconstructed,
        step.after,
        `${label} movements reconstruct shift`,
      );
    } else {
      assert.deepEqual(
        step.movements,
        [],
        `${label} stationary rule has no travel map`,
      );
    }
    current = [...step.after];
  });
}

function assertRoundContract(round, label) {
  assert.deepEqual(validateRound(round), [], `${label} validator`);
  assert.equal(round.options.length, 4, `${label} four options`);
  assert.equal(
    new Set(round.options.map(({ strip }) => encodeStrip(strip))).size,
    4,
    `${label} distinct options`,
  );
  assert.deepEqual(
    round.options.flatMap((option, index) =>
      encodeStrip(option.strip) === encodeStrip(round.answer) ? [index] : [],
    ),
    [round.correctIndex],
    `${label} unique exact answer`,
  );
  assert.equal(
    round.options[round.correctIndex].kind,
    "correct",
    `${label} answer label`,
  );
  for (const [index, option] of round.options.entries()) {
    const feedback = optionFeedback(round, index);
    assert.equal(feedback.correct, index === round.correctIndex);
    assert.equal(feedback.kind, option.kind);
    assert.equal(
      feedback.mismatchCount,
      stripDistance(option.strip, round.answer),
    );
    assert.deepEqual(
      feedback.differingIndexes,
      differingStripIndexes(option.strip, round.answer),
    );
    assert.equal(feedback.trace.length, round.rules.length);
    if (index !== round.correctIndex) {
      assert.notEqual(option.kind, "correct", `${label} misconception kind`);
      assert.ok(feedback.message.length > 20, `${label} teaching feedback`);
    }
  }

  if (round.difficulty === "Starter" || round.difficulty === "Junior") {
    for (let first = 0; first < 4; first += 1) {
      for (let second = first + 1; second < 4; second += 1) {
        assert.ok(
          stripDistance(
            round.options[first].strip,
            round.options[second].strip,
          ) >= 2,
          `${label} options ${first + 1}/${second + 1} differ twice`,
        );
      }
    }
    if (round.difficulty === "Junior") {
      assert.ok(
        new Set(round.answer).size > 1,
        `${label} keeps an input-dependent non-uniform answer`,
      );
    }
  } else {
    assert.ok(
      round.options.every(
        (option, index) =>
          index === round.correctIndex || option.kind !== "local-near-miss",
      ),
      `${label} uses named execution mistakes, not arbitrary mutations`,
    );
    assert.ok(
      round.options.some(
        (option, index) =>
          index !== round.correctIndex &&
          stripDistance(option.strip, round.answer) <= 2,
      ),
      `${label} includes a close local trap`,
    );
  }
  assertTraceTruth(round, label);
}

test("single-card rules are simultaneous and neighbor checks use one snapshot", () => {
  assert.deepEqual(
    applyRule(["solid", "open", "solid", "striped"], {
      kind: "replace",
      from: "solid",
      to: "open",
    }),
    ["open", "open", "open", "striped"],
  );

  assert.deepEqual(
    applyRule(["solid", "open", "striped", "solid"], {
      kind: "swap",
      first: "solid",
      second: "open",
    }),
    ["open", "solid", "striped", "open"],
    "both sides of a global swap read the original strip",
  );

  assert.deepEqual(
    applyRule(["solid", "solid", "solid"], {
      kind: "neighbor",
      neighborDirection: "left",
      neighbor: "solid",
      from: "solid",
      to: "open",
    }),
    ["solid", "open", "open"],
    "the second change does not erase evidence for the third cell",
  );
});

test("processing direction selects physical card order and changes the answer", () => {
  const rules = [
    { kind: "replace", from: "solid", to: "open" },
    { kind: "replace", from: "open", to: "striped" },
  ];
  const input = ["solid", "open", "striped", "solid"];
  const ltr = applyProgram(input, rules, "ltr");
  const rtl = applyProgram(input, rules, "rtl");

  assert.deepEqual(ltr.steps.map(({ ruleIndex }) => ruleIndex), [0, 1]);
  assert.deepEqual(rtl.steps.map(({ ruleIndex }) => ruleIndex), [1, 0]);
  assert.deepEqual(ltr.output, ["striped", "striped", "striped", "striped"]);
  assert.deepEqual(rtl.output, ["open", "striped", "striped", "open"]);
  assert.notDeepEqual(ltr.output, rtl.output);
});

test("whole-strip shifts wrap and expose truthful source-to-target motion", () => {
  const input = ["solid", "open", "striped", "open"];
  const left = applyProgram(
    input,
    [{ kind: "shift", direction: "left" }],
    "ltr",
  );
  const right = applyProgram(
    input,
    [{ kind: "shift", direction: "right" }],
    "ltr",
  );
  assert.deepEqual(left.output, ["open", "striped", "open", "solid"]);
  assert.deepEqual(right.output, ["open", "solid", "open", "striped"]);
  assert.deepEqual(
    left.steps[0].movements.map(({ fromIndex, toIndex }) => [
      fromIndex,
      toIndex,
    ]),
    [
      [0, 3],
      [1, 0],
      [2, 1],
      [3, 2],
    ],
  );
});

test("the photographed solved example uses the exact nine cells and an honest trace", () => {
  assert.deepEqual(TUTORIAL.input, [
    "solid",
    "open",
    "striped",
    "open",
    "striped",
    "solid",
    "open",
    "solid",
    "striped",
  ]);
  assert.equal(TUTORIAL.isExample, true);
  assert.deepEqual(TUTORIAL.rules, [
    { kind: "replace", from: "solid", to: "open" },
    { kind: "replace", from: "striped", to: "solid" },
    { kind: "replace", from: "open", to: "striped" },
  ]);
  assert.deepEqual(
    TUTORIAL.answer,
    applyProgram(
      TUTORIAL.input,
      TUTORIAL.rules,
      TUTORIAL.processingDirection,
    ).output,
  );
  assertRoundContract(TUTORIAL, "tutorial");
});

test("Campaign has 48 validated rounds with balanced, non-patterned answer positions", () => {
  assert.equal(ROUNDS.length, 48);
  const rebuiltCampaign = buildCampaignRounds();
  assert.deepEqual(
    rebuiltCampaign,
    CAMPAIGN_ROUNDS_BY_DIFFICULTY,
    "the canonical authored builder reproduces standalone Campaign",
  );
  assert.deepEqual(
    DIFFICULTIES.flatMap((difficulty) => rebuiltCampaign[difficulty]),
    ROUNDS,
    "Journey extensions do not alter the standalone 48-round sequence",
  );

  const allFingerprints = new Set();
  for (const difficulty of DIFFICULTIES) {
    const rounds = ROUNDS.filter((round) => round.difficulty === difficulty);
    assert.equal(rounds.length, 12, `${difficulty} authored count`);
    assert.deepEqual(
      rounds,
      CAMPAIGN_ROUNDS_BY_DIFFICULTY[difficulty],
      `${difficulty} grouped export`,
    );

    const indexes = rounds.map(({ correctIndex }) => correctIndex);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (answerIndex) =>
          indexes.filter((index) => index === answerIndex).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} 3/3/3/3 balance`,
    );
    assert.ok(
      indexes.every((index, position) =>
        position === 0 ? true : index !== indexes[position - 1],
      ),
      `${difficulty} no adjacent answer repeats`,
    );
    assert.equal(
      indexes.slice(0, 4).join(",") === indexes.slice(4, 8).join(",") &&
        indexes.slice(0, 4).join(",") === indexes.slice(8, 12).join(","),
      false,
      `${difficulty} is not one four-position cycle repeated`,
    );
    for (let blockStart = 0; blockStart < indexes.length; blockStart += 4) {
      assert.ok(
        new Set(indexes.slice(blockStart, blockStart + 4)).size < 4,
        `${difficulty} block ${blockStart / 4 + 1} is not a predictable four-answer permutation`,
      );
    }

    const processingDirections = new Set();
    const neighborDirections = new Set();
    const shiftDirections = new Set();
    for (const [index, round] of rounds.entries()) {
      assertRoundContract(round, `${difficulty} Campaign ${index + 1}`);
      assert.ok(
        curriculumAllows(round),
        `${difficulty} family ${executionKinds(round).join(" then ")}`,
      );
      const fingerprint = roundFingerprint(round);
      assert.equal(
        allFingerprints.has(fingerprint),
        false,
        `${difficulty} unique fingerprint`,
      );
      allFingerprints.add(fingerprint);
      processingDirections.add(round.processingDirection);
      for (const rule of round.rules) {
        if (rule.kind === "neighbor") {
          neighborDirections.add(rule.neighborDirection);
        }
        if (rule.kind === "shift") shiftDirections.add(rule.direction);
      }
      if (round.rules.length > 1) {
        const opposite = round.processingDirection === "ltr" ? "rtl" : "ltr";
        assert.notDeepEqual(
          round.answer,
          applyProgram(round.input, round.rules, opposite).output,
          `${difficulty} ${index + 1} order matters`,
        );
      }
    }
    assert.deepEqual(
      [...processingDirections].sort(),
      ["ltr", "rtl"],
      `${difficulty} mixes processing arrows`,
    );
    if (difficulty === "Junior" || difficulty === "Wizard") {
      assert.deepEqual(
        [...neighborDirections].sort(),
        ["left", "right"],
        `${difficulty} checks both relative sides`,
      );
    }
    if (
      difficulty === "Junior" ||
      difficulty === "Expert" ||
      difficulty === "Wizard"
    ) {
      assert.deepEqual(
        [...shiftDirections].sort(),
        ["left", "right"],
        `${difficulty} shifts both ways`,
      );
    }
  }
  assert.equal(allFingerprints.size, 48);
  assert.deepEqual(
    CAMPAIGN_ROUNDS_BY_DIFFICULTY.Junior.map(
      (round) => executionKinds(round)[0],
    ),
    [
      "swap",
      "swap",
      "swap",
      "swap",
      "shift",
      "shift",
      "shift",
      "shift",
      "neighbor",
      "neighbor",
      "neighbor",
      "neighbor",
    ],
    "Junior teaches each atomic family in a coherent four-round block",
  );
});

test("Journey-only banks add 36 deterministic, validated, disjoint rounds", () => {
  const expectations = {
    "junior-2": {
      difficulty: "Junior",
      positions: [1, 3, 0, 2, 1, 0, 3, 2, 0, 2, 1, 3],
    },
    "expert-2": {
      difficulty: "Expert",
      positions: [2, 0, 3, 1, 2, 1, 0, 3, 1, 3, 2, 0],
    },
    "wizard-2": {
      difficulty: "Wizard",
      positions: [0, 2, 3, 1, 3, 0, 1, 2, 1, 3, 0, 2],
    },
  };
  const standaloneFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const journeyFingerprints = new Set();

  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.deepEqual(
    buildChangingStripsJourneyExtraCampaignRounds(),
    JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    "Journey authored construction is deterministic",
  );

  for (const [level, expectation] of Object.entries(expectations)) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    const positions = rounds.map(({ correctIndex }) => correctIndex);

    assert.equal(rounds.length, 12, `${level}: round count`);
    assert.equal(Object.isFrozen(rounds), true, `${level}: frozen bank`);
    assert.ok(
      rounds.every(
        ({ difficulty }) => difficulty === expectation.difficulty,
      ),
      `${level}: mapped difficulty`,
    );
    assert.deepEqual(
      positions,
      expectation.positions,
      `${level}: frozen answer schedule`,
    );
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) =>
          positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${level}: answer balance`,
    );
    assert.ok(
      positions.every(
        (position, index) =>
          index === 0 || positions[index - 1] !== position,
      ),
      `${level}: no adjacent answer-position repeat`,
    );
    assert.equal(
      new Set(
        [0, 4, 8].map((start) =>
          positions.slice(start, start + 4).join(","),
        ),
      ).size,
      3,
      `${level}: no repeated four-position cycle`,
    );

    for (const [index, round] of rounds.entries()) {
      assert.equal(
        round.id,
        `changing-strips-journey-${level}-${String(index + 1).padStart(2, "0")}`,
      );
      assertRoundContract(round, `${level} Journey ${index + 1}`);
      assert.ok(
        curriculumAllows(round),
        `${level} family ${executionKinds(round).join(" then ")}`,
      );

      const fingerprint = roundFingerprint(round);
      assert.equal(
        standaloneFingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1}: standalone disjointness`,
      );
      assert.equal(
        journeyFingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1}: Journey disjointness`,
      );
      journeyFingerprints.add(fingerprint);
    }
  }
  assert.equal(journeyFingerprints.size, 36);
  assert.deepEqual(
    JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"].map(
      (round) => executionKinds(round)[0],
    ),
    [
      "swap",
      "swap",
      "swap",
      "swap",
      "shift",
      "shift",
      "shift",
      "shift",
      "neighbor",
      "neighbor",
      "neighbor",
      "neighbor",
    ],
    "Junior II repeats the taught atomic-family progression",
  );

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Authored Journey construction cannot use randomness.");
  };
  try {
    assert.deepEqual(
      buildChangingStripsJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("the adapter exposes seven explicit Journey banks and keeps Campaign separate", () => {
  const expectedBanks = {
    starter: CAMPAIGN_ROUNDS_BY_DIFFICULTY.Starter,
    "junior-1": CAMPAIGN_ROUNDS_BY_DIFFICULTY.Junior,
    "junior-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["junior-2"],
    "expert-1": CAMPAIGN_ROUNDS_BY_DIFFICULTY.Expert,
    "expert-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["expert-2"],
    "wizard-1": CAMPAIGN_ROUNDS_BY_DIFFICULTY.Wizard,
    "wizard-2": JOURNEY_EXTRA_CAMPAIGN_ROUNDS["wizard-2"],
  };
  const journeyFingerprints = new Set();

  assert.equal(progressionAdapter.journeyContentVersion, "1");
  assert.equal(progressionAdapter.campaignRounds.length, 48);
  assert.deepEqual(progressionAdapter.campaignRounds, ROUNDS);
  assert.deepEqual(
    Object.keys(progressionAdapter.journeyCampaignRounds),
    Object.keys(expectedBanks),
  );

  for (const [level, expectedRounds] of Object.entries(expectedBanks)) {
    const rounds = progressionAdapter.journeyCampaignRounds[level];
    assert.equal(rounds.length, 12, `${level}: adapter round count`);
    assert.deepEqual(rounds, expectedRounds, `${level}: explicit bank`);
    for (const round of rounds) {
      const fingerprint = roundFingerprint(round);
      assert.equal(
        journeyFingerprints.has(fingerprint),
        false,
        `${level}: Journey fingerprint uniqueness`,
      );
      journeyFingerprints.add(fingerprint);
    }
  }
  assert.equal(journeyFingerprints.size, 84);
});

test("fingerprints ignore answer placement and normalize equivalent card presentation", () => {
  const round = ROUNDS.find(
    ({ difficulty }) => difficulty === "Wizard",
  );
  assert.ok(round);
  const reorderedOptions = {
    ...round,
    options: [...round.options].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  assert.equal(roundFingerprint(reorderedOptions), roundFingerprint(round));
  assert.equal(
    roundFingerprint({
      input: round.input,
      rules: [...round.rules].reverse(),
      processingDirection:
        round.processingDirection === "ltr" ? "rtl" : "ltr",
    }),
    roundFingerprint(round),
    "reversing both cards and arrow preserves execution semantics",
  );

  const swapForward = {
    input: ["solid", "open", "striped"],
    rules: [{ kind: "swap", first: "solid", second: "open" }],
    processingDirection: "ltr",
  };
  const swapBackward = {
    ...swapForward,
    rules: [{ kind: "swap", first: "open", second: "solid" }],
  };
  assert.equal(
    roundFingerprint(swapForward),
    roundFingerprint(swapBackward),
    "swap operand order is normalized",
  );

  const collapseSolidThenOpen = {
    input: ["solid", "open", "striped", "solid"],
    rules: [
      { kind: "replace", from: "solid", to: "open" },
      { kind: "replace", from: "open", to: "striped" },
    ],
    processingDirection: "ltr",
  };
  const collapseOpenThenSolid = {
    ...collapseSolidThenOpen,
    rules: [
      { kind: "replace", from: "open", to: "solid" },
      { kind: "replace", from: "solid", to: "striped" },
    ],
  };
  assert.deepEqual(
    applyProgram(
      collapseSolidThenOpen.input,
      collapseSolidThenOpen.rules,
      collapseSolidThenOpen.processingDirection,
    ).output,
    applyProgram(
      collapseOpenThenSolid.input,
      collapseOpenThenSolid.rules,
      collapseOpenThenSolid.processingDirection,
    ).output,
  );
  assert.equal(
    roundFingerprint(collapseSolidThenOpen),
    roundFingerprint(collapseOpenThenSolid),
    "execution-equivalent replacement chains share one semantic fingerprint",
  );
});

test("1,600 seeded Infinite rounds are reproducible, unique, valid, and in tier", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const fingerprints = new Set();
    const answerIndexes = new Set();
    const processingDirections = new Set();
    const neighborDirections = new Set();
    const shiftDirections = new Set();
    const generatedKindSequences = new Set();

    for (
      let seedIndex = 0;
      seedIndex < GENERATED_COUNT_PER_DIFFICULTY;
      seedIndex += 1
    ) {
      const seed =
        0x5c00_0000 + difficultyIndex * 0x1_0000 + seedIndex;
      const exclusionsBefore = new Set(fingerprints);
      const round = generateInfiniteRound(
        difficulty,
        makeSeededRandom(seed),
        exclusionsBefore,
      );
      const reproduced = generateInfiniteRound(
        difficulty,
        makeSeededRandom(seed),
        exclusionsBefore,
      );
      assert.deepEqual(
        reproduced,
        round,
        `${difficulty} seed ${seedIndex} reproducibility`,
      );
      assertRoundContract(
        round,
        `${difficulty} generated seed ${seedIndex}`,
      );
      assert.ok(
        curriculumAllows(round),
        `${difficulty} generated curriculum family`,
      );
      generatedKindSequences.add(executionKinds(round).join(","));
      const fingerprint = roundFingerprint(round);
      assert.equal(
        fingerprints.has(fingerprint),
        false,
        `${difficulty} seed ${seedIndex} session uniqueness`,
      );
      fingerprints.add(fingerprint);
      answerIndexes.add(round.correctIndex);
      processingDirections.add(round.processingDirection);
      for (const rule of round.rules) {
        if (rule.kind === "neighbor") {
          neighborDirections.add(rule.neighborDirection);
        }
        if (rule.kind === "shift") shiftDirections.add(rule.direction);
      }
    }

    assert.equal(
      fingerprints.size,
      GENERATED_COUNT_PER_DIFFICULTY,
      `${difficulty} generated corpus size`,
    );
    assert.deepEqual([...answerIndexes].sort(), [0, 1, 2, 3]);
    assert.deepEqual([...processingDirections].sort(), ["ltr", "rtl"]);
    if (difficulty === "Junior" || difficulty === "Wizard") {
      assert.deepEqual([...neighborDirections].sort(), ["left", "right"]);
    }
    if (
      difficulty === "Junior" ||
      difficulty === "Expert" ||
      difficulty === "Wizard"
    ) {
      assert.deepEqual([...shiftDirections].sort(), ["left", "right"]);
    }
    assert.deepEqual(
      [...generatedKindSequences].sort(),
      DIFFICULTY_RULES[difficulty].executionKindSequences
        .map((sequence) => sequence.join(","))
        .sort(),
      `${difficulty} generated pool covers every curriculum family`,
    );
  }
});

test("excluded fingerprints are honored and hostile randomness fails at the bound", () => {
  const fixed = () => 0;
  const first = generateInfiniteRound("Starter", fixed);
  const excluded = new Set([roundFingerprint(first)]);
  assert.throws(
    () => generateInfiniteRound("Starter", fixed, excluded),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );

  let invalidCalls = 0;
  assert.throws(
    () =>
      generateInfiniteRound("Wizard", () => {
        invalidCalls += 1;
        return Number.NaN;
      }),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.equal(
    invalidCalls,
    GENERATOR_MAX_ATTEMPTS,
    "one rejected candidate per bounded attempt",
  );

  assert.throws(
    () => generateInfiniteRound("Expert", () => 1),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  assert.throws(
    () =>
      generateInfiniteRound("Junior", () => {
        throw new Error("hostile source");
      }),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
});

test("validator rejects no-op stages, duplicate answers, and irrelevant order", () => {
  const starter = structuredClone(
    ROUNDS.find(({ difficulty }) => difficulty === "Starter"),
  );
  starter.input = Array(starter.input.length).fill("striped");
  assert.ok(
    validateRound(starter).some((issue) => issue.includes("no-op")),
    "runtime no-op is rejected",
  );

  const duplicate = structuredClone(
    ROUNDS.find(({ difficulty }) => difficulty === "Junior"),
  );
  duplicate.options[0].strip = [...duplicate.answer];
  duplicate.options[1].strip = [...duplicate.answer];
  assert.ok(
    validateRound(duplicate).some(
      (issue) =>
        issue.includes("mutually distinct") ||
        issue.includes("Exactly the indexed option"),
    ),
    "duplicate answer options are rejected",
  );

  const orderFree = structuredClone(
    ROUNDS.find(({ difficulty }) => difficulty === "Expert"),
  );
  orderFree.rules = [
    { kind: "shift", direction: "left" },
    { kind: "shift", direction: "right" },
    { kind: "shift", direction: "left" },
  ];
  assert.ok(
    validateRound(orderFree).some(
      (issue) => issue.includes("Processing order does not affect"),
    ),
    "a multi-card puzzle cannot pretend order matters when it does not",
  );
});

test("the state catalogue is finite and uses the photographed semantics", () => {
  assert.deepEqual(CELL_STATES, ["solid", "open", "striped"]);
  assert.equal(new Set(CELL_STATES).size, 3);
});
