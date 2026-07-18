import assert from "node:assert/strict";
import test from "node:test";

import { CAMPAIGN_ROUNDS } from "../app/games/pattern-matrix/campaign-data.ts";
import {
  ALL_RULES,
  DIFFICULTIES,
  OPERATIONS,
  PLAYER_RULE_PROGRAMS,
  RULE_CATALOGUE,
  applyGridRule,
  applyMatrixRule,
  applySequenceStep,
  combinePatterns,
  compatiblePrograms,
  compatibleRules,
  createSeededRandom,
  effectiveCueMode,
  generateInfiniteRound,
  generateRoundForRule,
  hintPolicyForDifficulty,
  inferredAnswerKeys,
  inferenceOptionIndexes,
  makePattern,
  maskDifferenceCount,
  operationSymbol,
  patternCells,
  patternKey,
  renderKey,
  rotatePattern,
  roundFingerprint,
  programKey,
  programMatchesEvidence,
  ruleKey,
  ruleMatchesEvidence,
  rulePartIds,
  rulesForDifficulty,
  sequenceSymbol,
  transformPattern,
  transformSymbol,
  validateRound,
} from "../app/games/pattern-matrix/rule-engine.ts";

const FULL_MASK = 0b1111;

function rotateMaskOracle(mask, turns) {
  const normalizedTurns = ((turns % 4) + 4) % 4;
  let cells = [
    (mask & 1) !== 0,
    (mask & 2) !== 0,
    (mask & 4) !== 0,
    (mask & 8) !== 0,
  ];
  for (let index = 0; index < normalizedTurns; index += 1) {
    cells = [cells[2], cells[0], cells[3], cells[1]];
  }
  return cells.reduce(
    (result, filled, index) => result | (filled ? 1 << index : 0),
    0,
  );
}

function operationOracle(left, right, operation) {
  switch (operation) {
    case "join":
      return left | right;
    case "overlap":
      return left & right;
    case "cancel":
      return left ^ right;
    case "left-minus-right":
      return left & ~right & FULL_MASK;
    case "right-minus-left":
      return right & ~left & FULL_MASK;
    case "match":
      return ~(left ^ right) & FULL_MASK;
    case "neither":
      return ~(left | right) & FULL_MASK;
    default:
      throw new Error(`Unknown operation ${operation}`);
  }
}

function correctIndexes(round) {
  return round.options.flatMap((option, index) =>
    renderKey(option) === renderKey(round.correctPattern) ? [index] : [],
  );
}

function applyGridPairOracle(first, second, rule) {
  const combined = combinePatterns(first, second, rule.operation);
  assert.ok(combined);
  return transformPattern(combined, rule.transform);
}

function patternStyle(pattern) {
  return {
    shape: pattern.shape,
    fill: pattern.fill,
    scale: pattern.scale,
    orientation: pattern.orientation,
    texturePhase: pattern.texturePhase,
  };
}

function assertGenerousOptionSeparation(round) {
  for (let left = 0; left < round.options.length; left += 1) {
    for (let right = left + 1; right < round.options.length; right += 1) {
      assert.ok(
        maskDifferenceCount(
          round.options[left],
          round.options[right],
        ) >= 2,
        `${round.id} options ${left + 1} and ${right + 1} are too similar`,
      );
    }
  }
}

test("semantic patterns canonicalize invisible state", () => {
  const circle = makePattern(0b1010, {
    shape: "circle",
    fill: "solid",
    scale: 1,
    orientation: 3,
    texturePhase: 2,
  });
  assert.equal(circle.orientation, 0);
  assert.equal(circle.texturePhase, 0);
  assert.deepEqual(patternCells(circle), [false, true, false, true]);

  const stripedTriangle = makePattern(0b1010, {
    shape: "triangle",
    fill: "striped",
    scale: 2,
    orientation: 3,
    texturePhase: 2,
  });
  assert.notEqual(patternKey(circle), patternKey(stripedTriangle));
  assert.equal(renderKey(stripedTriangle), patternKey(stripedTriangle));
});

test("every spatial turn matches an independent coordinate oracle", () => {
  for (let mask = 0; mask <= FULL_MASK; mask += 1) {
    for (let turns = -8; turns <= 8; turns += 1) {
      const source = makePattern(mask, {
        shape: "triangle",
        fill: "striped",
        scale: 1,
        orientation: 0,
        texturePhase: 0,
      });
      const rotated = rotatePattern(source, turns);
      assert.equal(rotated.mask, rotateMaskOracle(mask, turns));
      assert.equal(rotated.orientation, ((turns % 4) + 4) % 4);
      assert.equal(rotated.texturePhase, ((turns % 4) + 4) % 4);
    }
  }

  const source = makePattern(0b0111, {
    shape: "bar",
    fill: "outline",
    orientation: 0,
  });
  assert.equal(
    transformPattern(source, "rotate-half").mask,
    rotateMaskOracle(source.mask, 2),
  );
});

test("all Boolean and complement operations match exhaustive truth tables", () => {
  for (const operation of OPERATIONS) {
    for (let leftMask = 0; leftMask <= FULL_MASK; leftMask += 1) {
      for (let rightMask = 0; rightMask <= FULL_MASK; rightMask += 1) {
        const style = {
          shape: "square",
          fill: "outline",
          scale: 1,
        };
        const result = combinePatterns(
          makePattern(leftMask, style),
          makePattern(rightMask, style),
          operation,
        );
        assert.ok(result);
        assert.equal(
          result.mask,
          operationOracle(leftMask, rightMask, operation),
          `${operation} failed for ${leftMask}/${rightMask}`,
        );
      }
    }
  }

  assert.equal(
    combinePatterns(
      makePattern(1, { shape: "circle" }),
      makePattern(1, { shape: "triangle" }),
      "join",
    ),
    null,
    "binary rules reject mismatched visual styles",
  );
});

test("sequence rules change the intended semantic attribute", () => {
  const base = makePattern(0b0111, {
    shape: "triangle",
    fill: "striped",
    scale: 0,
    orientation: 0,
    texturePhase: 0,
  });
  assert.equal(applySequenceStep(base, "grow")?.scale, 1);
  assert.equal(
    applySequenceStep(base, "shape-cycle")?.shape,
    "square",
  );
  assert.equal(
    applySequenceStep(base, "fill-cycle")?.fill,
    "solid",
  );
  assert.equal(
    applySequenceStep(base, "texture-shift")?.texturePhase,
    1,
  );
  assert.equal(applySequenceStep(base, "motif-turn")?.orientation, 1);
  assert.equal(
    applySequenceStep(base, "move-clockwise")?.mask,
    rotateMaskOracle(base.mask, 1),
  );
  assert.equal(
    applySequenceStep(base, "move-clockwise")?.orientation,
    base.orientation,
    "moving positions does not secretly turn their motif",
  );
});

test("whole-grid rules build one coupled cascade from three anchors", () => {
  const rule = {
    family: "grid",
    operation: "cancel",
    transform: "rotate-clockwise",
  };
  const style = {
    shape: "triangle",
    fill: "outline",
    scale: 1,
    orientation: 0,
  };
  const first = makePattern(0b0011, style);
  const second = makePattern(0b0001, style);
  const third = makePattern(0b0111, style);
  const completed = applyGridRule([first, second, third], rule);

  assert.equal(patternKey(completed[0]), patternKey(first));
  assert.equal(patternKey(completed[1]), patternKey(second));
  assert.equal(patternKey(completed[3]), patternKey(third));
  assert.equal(
    patternKey(completed[2]),
    patternKey(applyGridPairOracle(completed[0], completed[1], rule)),
  );
  assert.equal(
    patternKey(completed[6]),
    patternKey(applyGridPairOracle(completed[0], completed[3], rule)),
  );
  assert.equal(
    patternKey(completed[4]),
    patternKey(applyGridPairOracle(completed[1], completed[3], rule)),
  );
  assert.equal(
    patternKey(completed[5]),
    patternKey(applyGridPairOracle(completed[2], completed[4], rule)),
  );
  assert.equal(
    patternKey(completed[7]),
    patternKey(applyGridPairOracle(completed[4], completed[6], rule)),
  );
  assert.equal(
    patternKey(completed[8]),
    patternKey(applyGridPairOracle(completed[5], completed[7], rule)),
  );
});

test("the inference catalogue keeps every cascade candidate without precedence", () => {
  const gridRules = ALL_RULES.filter((rule) => rule.family === "grid");
  assert.equal(gridRules.length, 10);
  assert.deepEqual(
    [...new Set(gridRules.map((rule) => rule.operation))].sort(),
    [
      "cancel",
      "left-minus-right",
      "match",
      "neither",
      "right-minus-left",
    ],
  );
  assert.deepEqual(
    [...new Set(gridRules.map((rule) => rule.transform))].sort(),
    ["rotate-clockwise", "rotate-counterclockwise"],
  );

  for (const difficulty of DIFFICULTIES) {
    const generatable = rulesForDifficulty(difficulty).filter(
      (rule) => rule.family === "grid",
    );
    if (difficulty === "Hard" || difficulty === "Wizard") {
      assert.equal(generatable.length, 2);
      assert.ok(
        generatable.every((rule) => rule.operation === "cancel"),
        `${difficulty} must select only cascade programs proven feasible`,
      );
      for (const rule of generatable) {
        const round = generateRoundForRule(
          difficulty,
          rule,
          createSeededRandom(
            `cascade:${difficulty}:${rule.transform}`,
          ),
          0,
          "cascade-proof",
        );
        assert.deepEqual(validateRound(round), []);
      }
    } else {
      assert.equal(generatable.length, 0);
    }
  }

  assert.throws(
    () =>
      generateRoundForRule(
        "Hard",
        gridRules.find((rule) => rule.operation === "match"),
        createSeededRandom("inference-only"),
        0,
        "inference-only",
      ),
    /not allowed/,
  );
});

test("the inference grammar exhausts every taught one-stage rule chain", () => {
  assert.equal(ALL_RULES.length, 84);
  assert.equal(PLAYER_RULE_PROGRAMS.length, 248);
  assert.equal(
    PLAYER_RULE_PROGRAMS.filter(
      ({ family }) => family === "combine-change",
    ).length,
    98,
  );
  assert.equal(
    PLAYER_RULE_PROGRAMS.filter(
      ({ family }) => family === "boolean-closure",
    ).length,
    24,
  );
  assert.equal(
    PLAYER_RULE_PROGRAMS.filter(
      ({ family }) => family === "boolean-closure-change",
    ).length,
    42,
  );
  assert.deepEqual(
    [
      ...new Set(
        PLAYER_RULE_PROGRAMS.filter(
          (program) =>
            (program.family === "combine" ||
              program.family === "boolean-closure") &&
            program.axis === "rows" &&
            program.transform === "none",
        ).map((program) => Number(programKey(program).split(":")[2])),
      ),
    ].sort((left, right) => left - right),
    [1, 2, 4, 6, 7, 8, 9, 11, 13, 14],
    "every and only two-input-dependent Boolean function must be normalized",
  );
  assert.equal(
    new Set(PLAYER_RULE_PROGRAMS.map(programKey)).size,
    PLAYER_RULE_PROGRAMS.length,
    "normalized program keys must be unique",
  );

  const oldAmbiguousSources = [
    makePattern(4, {
      shape: "triangle",
      fill: "outline",
      scale: 1,
      orientation: 2,
    }),
    makePattern(10, {
      shape: "triangle",
      fill: "outline",
      scale: 1,
      orientation: 2,
    }),
    makePattern(12, {
      shape: "square",
      fill: "striped",
      scale: 0,
      texturePhase: 2,
    }),
    makePattern(7, {
      shape: "square",
      fill: "striped",
      scale: 0,
      texturePhase: 2,
    }),
    makePattern(12, {
      shape: "triangle",
      fill: "outline",
      scale: 0,
      orientation: 3,
    }),
    makePattern(6, {
      shape: "triangle",
      fill: "outline",
      scale: 0,
      orientation: 3,
    }),
  ];
  const declared = {
    family: "combine",
    axis: "rows",
    operation: "match",
    transform: "none",
  };
  const completed = oldAmbiguousSources.flatMap((first, index, sources) => {
    if (index % 2 !== 0) return [];
    const second = sources[index + 1];
    return [first, second, applyMatrixRule(first, second, declared)];
  });
  const matrix = [...completed.slice(0, 8), null];

  assert.deepEqual(compatibleRules(matrix).map(ruleKey), [
    ruleKey(declared),
  ]);
  assert.deepEqual(compatiblePrograms(matrix).map(programKey), [
    programKey(declared),
    "boolean-change:rows:4:move-clockwise",
  ]);
  assert.equal(inferredAnswerKeys(matrix).size, 2);

  const ambiguousRound = {
    id: "synthetic-composed-ambiguity",
    difficulty: "Hard",
    matrix,
    rule: declared,
    hintPolicy: "after-miss",
    options: [
      completed[8],
      makePattern(4, patternStyle(completed[8])),
      makePattern(2, patternStyle(completed[8])),
      makePattern(8, patternStyle(completed[8])),
    ],
    optionKinds: [
      "correct",
      "wrong-rule",
      "one-feature-off",
      "one-feature-off",
    ],
    correctIndex: 0,
    correctPattern: completed[8],
  };
  const errors = validateRound(ambiguousRound);
  assert.ok(
    errors.includes(
      "Exactly one normalized rule program in the complete taught grammar must fit.",
    ),
  );
  assert.ok(
    errors.includes(
      "The complete taught rule grammar must infer only the calculated option.",
    ),
  );
});

test("every catalogue rule part has metadata", () => {
  const catalogueIds = new Set(RULE_CATALOGUE.map(({ id }) => id));
  assert.equal(catalogueIds.size, RULE_CATALOGUE.length);
  for (const part of RULE_CATALOGUE) {
    assert.equal(typeof part.symbol, "string", `${part.id} needs a symbol`);
    assert.ok(part.symbol.trim().length > 0, `${part.id} needs a symbol`);
  }
  for (const rule of ALL_RULES) {
    for (const partId of rulePartIds(rule)) {
      assert.ok(catalogueIds.has(partId), `${partId} is missing`);
    }
  }
});

test("rule symbols are stable, mathematical, and shared with the catalogue", () => {
  const expectedOperations = {
    join: "∪",
    overlap: "∩",
    cancel: "⊕",
    "left-minus-right": "A∖B",
    "right-minus-left": "B∖A",
    match: "≡",
    neither: "∪ᶜ",
  };
  const expectedTransforms = {
    none: "=",
    "rotate-clockwise": "↻90°",
    "rotate-half": "180°",
    "rotate-counterclockwise": "↺90°",
  };
  const expectedSequences = {
    "rotate-clockwise": "↻90°",
    "rotate-counterclockwise": "↺90°",
    "move-clockwise": "P↻90°",
    grow: "s↦s+1",
    shrink: "s↦s−1",
    "shape-cycle": "○→△→□→▭",
    "fill-cycle": "●→○→▧",
    "texture-shift": "φ↦φ+1",
    "motif-turn": "θ↦θ+90°",
  };

  for (const [operation, symbol] of Object.entries(expectedOperations)) {
    assert.equal(operationSymbol(operation), symbol);
    assert.equal(
      RULE_CATALOGUE.find(({ id }) => id === `combine:${operation}`)
        ?.symbol,
      symbol,
    );
  }
  for (const [transform, symbol] of Object.entries(expectedTransforms)) {
    assert.equal(transformSymbol(transform), symbol);
  }
  for (const [step, symbol] of Object.entries(expectedSequences)) {
    assert.equal(sequenceSymbol(step), symbol);
    assert.equal(
      RULE_CATALOGUE.find(({ id }) => id === `change:${step}`)?.symbol,
      symbol,
    );
  }
  assert.equal(
    RULE_CATALOGUE.find(({ id }) => id === "change:rotate-half")?.symbol,
    expectedTransforms["rotate-half"],
  );
  assert.equal(
    RULE_CATALOGUE.find(({ id }) => id === "change:columns")?.symbol,
    "↓",
  );
  assert.equal(
    RULE_CATALOGUE.find(({ id }) => id === "change:grid-cascade")?.symbol,
    "f∘f",
  );
});

test("Campaign introduces foundational rules in a slow, fixed order", () => {
  const easy = CAMPAIGN_ROUNDS.filter(
    ({ difficulty }) => difficulty === "Easy",
  );
  assert.deepEqual(
    easy.map(({ rule }) => ruleKey(rule)),
    [
      ...Array(3).fill("combine:rows:join:none"),
      ...Array(3).fill("combine:rows:overlap:none"),
      ...Array(3).fill("combine:rows:cancel:none"),
      ...Array(3).fill("combine:rows:left-minus-right:none"),
    ],
  );
  assert.equal(easy[0].rule.operation, "join", "Starter 1 teaches union");
  assert.equal(easy[2].rule.operation, "join", "Starter 3 repeats union");
  assert.equal(
    easy[4].rule.operation,
    "overlap",
    "Starter 5 teaches intersection",
  );

  const medium = CAMPAIGN_ROUNDS.filter(
    ({ difficulty }) => difficulty === "Medium",
  );
  assert.deepEqual(
    medium.map(({ rule }) => ruleKey(rule)),
    [
      ...Array(3).fill("combine:rows:right-minus-left:none"),
      ...Array(3).fill("sequence:rows:rotate-clockwise"),
      ...Array(3).fill("sequence:rows:grow"),
      "combine:columns:join:none",
      "combine:columns:overlap:none",
      "combine:columns:cancel:none",
    ],
  );
});

test("Starter choices are visually generous instead of style-based traps", () => {
  const easy = CAMPAIGN_ROUNDS.filter(
    ({ difficulty }) => difficulty === "Easy",
  );

  for (const round of easy) {
    assertGenerousOptionSeparation(round);
    for (const pattern of [
      ...round.matrix.filter(Boolean),
      ...round.options,
    ]) {
      assert.ok(
        pattern.shape === "circle" || pattern.shape === "square",
        `${round.id} uses an advanced shape`,
      );
      assert.ok(
        pattern.fill === "solid" || pattern.fill === "outline",
        `${round.id} uses an advanced fill`,
      );
      assert.equal(pattern.scale, 1, `${round.id} changes motif size`);
    }

    const correctStyle = patternStyle(round.correctPattern);
    for (const [index, option] of round.options.entries()) {
      assert.deepEqual(
        patternStyle(option),
        correctStyle,
        `${round.id} option ${index + 1} is a style-only trap`,
      );
      if (index !== round.correctIndex) {
        assert.ok(
          maskDifferenceCount(option, round.correctPattern) >= 2,
          `${round.id} option ${index + 1} is diabolically close`,
        );
      }
    }
  }
});

test("Junior choices use distinct positions instead of subtle style traps", () => {
  const medium = CAMPAIGN_ROUNDS.filter(
    ({ difficulty }) => difficulty === "Medium",
  );

  for (const round of medium) {
    assertGenerousOptionSeparation(round);
    assert.equal(
      new Set(round.options.map(({ mask }) => mask)).size,
      4,
      `${round.id} repeats an option position pattern`,
    );

    const sizeIsTheRule =
      round.rule.family === "sequence" &&
      (round.rule.step === "grow" || round.rule.step === "shrink");
    if (!sizeIsTheRule) {
      for (const pattern of round.matrix.filter(Boolean)) {
        assert.equal(
          pattern.scale,
          1,
          `${round.id} adds an unrelated size change to the clue`,
        );
      }
    }

    for (const [index, option] of round.options.entries()) {
      if (index === round.correctIndex) continue;
      assert.ok(
        maskDifferenceCount(option, round.correctPattern) >= 2,
        `${round.id} option ${index + 1} is too close`,
      );
      assert.equal(
        option.shape,
        round.correctPattern.shape,
        `${round.id} option ${index + 1} is a shape-only trap`,
      );
      assert.equal(
        option.fill,
        round.correctPattern.fill,
        `${round.id} option ${index + 1} is a fill-only trap`,
      );
      if (!sizeIsTheRule) {
        assert.equal(
          option.scale,
          round.correctPattern.scale,
          `${round.id} option ${index + 1} is a size-only trap`,
        );
      }
    }
  }

  for (const problemNumber of [3, 5, 11, 12]) {
    const round = medium[problemNumber - 1];
    assert.equal(
      new Set(round.options.map(({ mask }) => mask)).size,
      4,
      `Junior ${problemNumber} regressed to look-alike options`,
    );
  }
});

test("complements wait until Expert and Wizard introduces no atomic rules", () => {
  const easyAndMedium = CAMPAIGN_ROUNDS.filter(
    ({ difficulty }) =>
      difficulty === "Easy" || difficulty === "Medium",
  );
  assert.ok(
    easyAndMedium.every(
      ({ rule }) =>
        rule.family !== "combine" ||
        (rule.operation !== "match" && rule.operation !== "neither"),
    ),
  );

  const hard = CAMPAIGN_ROUNDS.filter(
    ({ difficulty }) => difficulty === "Hard",
  );
  assert.equal(hard[0].rule.family, "combine");
  assert.equal(hard[0].rule.operation, "match");
  assert.equal(hard[0].rule.transform, "none");

  const introducedBeforeWizard = new Set(
    CAMPAIGN_ROUNDS.slice(0, 36).flatMap(({ rule }) => rulePartIds(rule)),
  );
  for (const round of CAMPAIGN_ROUNDS.slice(36)) {
    for (const partId of rulePartIds(round.rule)) {
      assert.ok(
        introducedBeforeWizard.has(partId),
        `${round.id} introduces ${partId}`,
      );
    }
  }
});

test("Infinite Starter and Junior respect the paced rule catalogue", () => {
  const easyRules = rulesForDifficulty("Easy");
  assert.ok(easyRules.every(({ family }) => family === "combine"));
  assert.deepEqual(
    [...new Set(easyRules.map(({ operation }) => operation))].sort(),
    ["cancel", "join", "left-minus-right", "overlap"],
  );
  assert.ok(
    easyRules.every(
      ({ operation }) => operation !== "match" && operation !== "neither",
    ),
  );

  const mediumRules = rulesForDifficulty("Medium");
  assert.ok(
    mediumRules.every(
      (rule) =>
        rule.family !== "combine" ||
        (rule.operation !== "match" && rule.operation !== "neither"),
    ),
  );
});

test("Campaign is a balanced, unique, fully validated 48-round curriculum", () => {
  assert.equal(CAMPAIGN_ROUNDS.length, 48);
  const fingerprints = new Set();
  const patternShapes = new Set();
  const patternFills = new Set();
  const patternScales = new Set();
  const families = new Set();
  const axes = new Set();
  const operations = new Set();

  for (const difficulty of DIFFICULTIES) {
    const rounds = CAMPAIGN_ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    );
    assert.equal(rounds.length, 12, `${difficulty} must have 12 rounds`);

    const positions = [0, 0, 0, 0];
    for (const round of rounds) {
      positions[round.correctIndex] += 1;
      assert.deepEqual(validateRound(round), [], round.id);
      assert.deepEqual(correctIndexes(round), [round.correctIndex]);
      assert.deepEqual(inferenceOptionIndexes(round.matrix, round.options), [
        round.correctIndex,
      ]);
      const compatible = compatiblePrograms(round.matrix);
      const rawCompatiblePrograms = PLAYER_RULE_PROGRAMS.filter((program) =>
        programMatchesEvidence(round.matrix, program),
      );
      assert.deepEqual(
        compatible.map(programKey),
        rawCompatiblePrograms.map(programKey),
        `${round.id} must enumerate the complete taught grammar`,
      );
      assert.equal(compatible.length, 1, round.id);
      assert.equal(
        programKey(compatible[0]),
        programKey(round.rule),
        round.id,
      );

      const compatibleAtomicRules = compatibleRules(round.matrix);
      const rawCompatible = ALL_RULES.filter((rule) =>
        ruleMatchesEvidence(round.matrix, rule),
      );
      assert.deepEqual(
        compatibleAtomicRules.map(ruleKey),
        rawCompatible.map(ruleKey),
        `${round.id} must not suppress lower-precedence matches`,
      );
      assert.equal(
        round.hintPolicy,
        hintPolicyForDifficulty(difficulty),
      );

      const fingerprint = roundFingerprint(round);
      assert.ok(!fingerprints.has(fingerprint), `${round.id} repeats`);
      fingerprints.add(fingerprint);
      families.add(round.rule.family);
      if ("axis" in round.rule) axes.add(round.rule.axis);
      if (round.rule.family === "combine") {
        operations.add(round.rule.operation);
      }
      for (const pattern of [
        ...round.matrix.filter(Boolean),
        ...round.options,
      ]) {
        patternShapes.add(pattern.shape);
        patternFills.add(pattern.fill);
        patternScales.add(pattern.scale);
      }
    }

    assert.deepEqual(positions, [3, 3, 3, 3]);
    for (let index = 1; index < rounds.length; index += 1) {
      assert.notEqual(
        rounds[index - 1].correctIndex,
        rounds[index].correctIndex,
        `${difficulty} repeats adjacent answer positions`,
      );
    }
    assert.notDeepEqual(
      rounds.slice(0, 4).map(({ correctIndex }) => correctIndex),
      rounds.slice(4, 8).map(({ correctIndex }) => correctIndex),
      `${difficulty} repeats a four-position cycle`,
    );
    assert.notDeepEqual(
      rounds.slice(4, 8).map(({ correctIndex }) => correctIndex),
      rounds.slice(8, 12).map(({ correctIndex }) => correctIndex),
      `${difficulty} repeats a four-position cycle`,
    );
  }

  assert.deepEqual([...families].sort(), ["combine", "grid", "sequence"]);
  assert.deepEqual([...axes].sort(), ["columns", "rows"]);
  assert.deepEqual(
    [...patternShapes].sort(),
    ["bar", "circle", "square", "triangle"],
  );
  assert.deepEqual(
    [...patternFills].sort(),
    ["outline", "solid", "striped"],
  );
  assert.deepEqual([...patternScales].sort(), [0, 1, 2]);
  assert.ok(operations.has("match"), "Campaign needs XNOR complement");
  assert.ok(operations.has("neither"), "Campaign needs NOR complement");
});

test("every authored cascade needs the intersection of ambiguous evidence", () => {
  const gridRules = ALL_RULES.filter((rule) => rule.family === "grid");
  const relations = [
    [0, 1, 2],
    [0, 3, 6],
    [1, 3, 4],
    [2, 4, 5],
    [4, 6, 7],
  ];
  const rounds = CAMPAIGN_ROUNDS.filter(
    (round) => round.rule.family === "grid",
  );
  assert.equal(rounds.length, 5);

  for (const round of rounds) {
    const completed = [...round.matrix.slice(0, 8), round.correctPattern];
    const keys = completed.map(patternKey);
    assert.equal(new Set(keys).size, 9, round.id);
    assert.ok(!keys.slice(0, 8).includes(keys[8]), round.id);

    for (const [first, second, result] of relations) {
      const candidates = gridRules.filter(
        (candidate) =>
          patternKey(
            applyGridPairOracle(
              completed[first],
              completed[second],
              candidate,
            ),
          ) === patternKey(completed[result]),
      );
      const predictions = new Set(
        candidates.map((candidate) =>
          patternKey(
            applyGridPairOracle(
              completed[5],
              completed[7],
              candidate,
            ),
          ),
        ),
      );
      assert.ok(candidates.length >= 2, `${round.id} relation ${result}`);
      assert.ok(predictions.size >= 2, `${round.id} relation ${result}`);
    }
  }
});

test("hint policy reveals Expert only after a miss and never reveals Wizard", () => {
  assert.equal(effectiveCueMode("always", false), "full-rule");
  assert.equal(effectiveCueMode("after-miss", false), "hidden");
  assert.equal(effectiveCueMode("after-miss", true), "full-rule");
  assert.equal(effectiveCueMode("never", false), "hidden");
  assert.equal(effectiveCueMode("never", true), "hidden");
});

test("1,600 deterministic Infinite rounds remain valid and reproducible", () => {
  for (const difficulty of DIFFICULTIES) {
    const random = createSeededRandom(`corpus:${difficulty}`);
    const replayRandom = createSeededRandom(`corpus:${difficulty}`);
    const seen = new Set();
    const replaySeen = new Set();

    for (let index = 0; index < 400; index += 1) {
      const round = generateInfiniteRound(difficulty, random, seen);
      const replay = generateInfiniteRound(
        difficulty,
        replayRandom,
        replaySeen,
      );
      assert.deepEqual(round, replay, `${difficulty} seed ${index}`);
      assert.deepEqual(validateRound(round), [], round.id);
      if (difficulty === "Easy" || difficulty === "Medium") {
        assertGenerousOptionSeparation(round);
      }
      assert.equal(
        compatiblePrograms(round.matrix).length,
        1,
        `${difficulty} seed ${index}`,
      );
      assert.deepEqual(inferenceOptionIndexes(round.matrix, round.options), [
        round.correctIndex,
      ]);

      const fingerprint = roundFingerprint(round);
      assert.ok(!seen.has(fingerprint));
      seen.add(fingerprint);
      replaySeen.add(roundFingerprint(replay));
    }
    assert.equal(seen.size, 400);
  }
});

test("hostile randomness fails clearly instead of emitting an invalid puzzle", () => {
  for (const hostile of [
    () => -0.01,
    () => 1,
    () => Number.NaN,
    () => Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => generateInfiniteRound("Easy", hostile),
      /Random source/,
    );
  }

  assert.throws(
    () => generateInfiniteRound("Easy", () => 0),
    /Unable to generate a valid Easy round/,
  );
});
