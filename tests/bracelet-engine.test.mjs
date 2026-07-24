import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_SPECS,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  GENERATOR_MAX_ATTEMPTS,
  ROUNDS,
  TUTORIAL,
  analyzeWrongAttempt,
  braceletClassKey,
  braceletColorScheme,
  braceletOrbitSize,
  braceletViews,
  buildCampaignRounds,
  closestBraceletComparisons,
  createSeededRandom,
  decodeBracelet,
  decodePattern,
  distractorKindMatches,
  encodeBracelet,
  encodePattern,
  findCompatibleSolutions,
  findOccurrences,
  generateInfiniteRound,
  matchingOptionIndexes,
  resolvedCorrectPattern,
  reversePattern,
  roundFingerprint,
  segmentClassKey,
  validateRound,
  visibleSegmentDistance,
} from "../app/games/bracelet-search/game-engine.ts";
import {
  TANGLE_LAYOUT_IDS,
  TANGLED_BRACELET_LAYOUTS,
  braceletPresentationForRound,
  tangledLayoutForPresentation,
} from "../app/games/bracelet-search/tangle-layout.ts";
import { progressionAdapter } from "../app/games/bracelet-search/progression-adapter.ts";
import { progressionMetadata } from "../app/games/bracelet-search/progression-metadata.ts";
import {
  JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  buildBraceletJourneyExtraCampaignRounds,
} from "../app/games/bracelet-search/journey-campaign.ts";

const SIMPLE_DIFFICULTIES = new Set(["Easy", "Medium"]);
const ADVANCED_DIFFICULTIES = new Set(["Hard", "Wizard"]);

function modulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function binaryStrings(length, zero = "C", one = "G") {
  return Array.from({ length: 2 ** length }, (_, value) =>
    Array.from({ length }, (__, index) =>
      value & (1 << index) ? one : zero,
    ).join(""),
  );
}

function tokenMatchesBead(token, bead) {
  return (
    token.kind === "hidden" ||
    (token.bead.color === bead.color && token.bead.mark === bead.mark)
  );
}

/**
 * Independent reference matcher: enumerate both directed traversals, then
 * quotient a traversal and its reverse to one clockwise physical arc.
 */
function brutePhysicalStarts(bracelet, pattern) {
  const starts = new Set();
  for (let start = 0; start < bracelet.length; start += 1) {
    for (const direction of [1, -1]) {
      const matches = pattern.every((token, offset) =>
        tokenMatchesBead(
          token,
          bracelet[modulo(start + direction * offset, bracelet.length)],
        ),
      );
      if (!matches) continue;
      const clockwiseStart =
        direction === 1
          ? start
          : modulo(start - (pattern.length - 1), bracelet.length);
      starts.add(clockwiseStart);
    }
  }
  return [...starts].sort((left, right) => left - right);
}

function hiddenIndexes(pattern) {
  return pattern.flatMap((token, index) =>
    token.kind === "hidden" ? [index] : [],
  );
}

function assertOneExactAnswer(round, label) {
  const validation = validateRound(round);
  assert.equal(
    validation.valid,
    true,
    `${label}: ${validation.issues.join(" ")}`,
  );
  assert.deepEqual(
    matchingOptionIndexes(round.bracelet, round.options),
    [round.correctIndex],
    `${label} matching option`,
  );
  assert.equal(
    findCompatibleSolutions(round.bracelet, round.options).length,
    1,
    `${label} total option/placement solution count`,
  );
  assert.equal(
    findOccurrences(
      round.bracelet,
      round.options[round.correctIndex].pattern,
    ).length,
    1,
    `${label} physical placement`,
  );
  assert.equal(
    new Set(
      round.options.map(({ pattern }) => segmentClassKey(pattern)),
    ).size,
    4,
    `${label} reversal-distinct options`,
  );
}

function bruteSolutions(bracelet, options) {
  return options.flatMap((option, optionIndex) =>
    brutePhysicalStarts(bracelet, option.pattern).map((clockwiseStart) => ({
      optionIndex,
      clockwiseStart,
    })),
  );
}

function assertSimpleOptions(round, label) {
  assert.ok(SIMPLE_DIFFICULTIES.has(round.difficulty));
  const braceletColors = new Set(round.bracelet.map(({ color }) => color));
  for (const option of round.options) {
    assert.ok(
      !["one-color-off", "one-mark-off"].includes(option.kind),
      `${label} has no one-feature option`,
    );
    assert.ok(
      option.pattern.every(
        (token) => token.kind === "bead" && token.bead.mark === "plain",
      ),
      `${label} uses content-only plain beads`,
    );
    assert.ok(
      option.pattern.every(
        (token) =>
          token.kind === "bead" && braceletColors.has(token.bead.color),
      ),
      `${label} uses only colors visible on its bracelet`,
    );
  }
  for (let left = 0; left < round.options.length; left += 1) {
    for (let right = left + 1; right < round.options.length; right += 1) {
      assert.ok(
        visibleSegmentDistance(
          round.options[left].pattern,
          round.options[right].pattern,
        ) >= 2,
        `${label} options ${left + 1}/${right + 1} differ twice`,
      );
    }
  }
}

function assertWizardRound(round, label) {
  assert.equal(round.difficulty, "Wizard");
  for (const [optionIndex, option] of round.options.entries()) {
    assert.deepEqual(
      hiddenIndexes(option.pattern),
      [2],
      `${label} option ${optionIndex + 1} centered wildcard`,
    );
  }
  assert.deepEqual(
    matchingOptionIndexes(round.bracelet, round.options),
    [round.correctIndex],
    `${label} unique compatible option`,
  );
  assert.equal(
    findOccurrences(
      round.bracelet,
      round.options[round.correctIndex].pattern,
    ).length,
    1,
    `${label} unique compatible placement`,
  );
  assert.ok(
    resolvedCorrectPattern(round).every((token) => token.kind === "bead"),
    `${label} resolves only after success`,
  );

  for (const [optionIndex] of round.options.entries()) {
    if (optionIndex === round.correctIndex) continue;
    const feedback = analyzeWrongAttempt(round, optionIndex);
    assert.deepEqual(
      Object.keys(feedback).sort(),
      ["kind", "visibleMismatchCount"],
      `${label} wrong feedback has a deliberately narrow shape`,
    );
    assert.equal(feedback.kind, "visible-conflict");
    assert.ok(feedback.visibleMismatchCount >= 1);
    const serialized = JSON.stringify(feedback).toLowerCase();
    for (const forbidden of [
      "occurrence",
      "placement",
      "braceletindex",
      "optionindex",
      "expected",
      "hidden",
      "wildcard",
      "bead",
      "color",
      "mark",
    ]) {
      assert.ok(
        !serialized.includes(forbidden),
        `${label} feedback must not leak ${forbidden}`,
      );
    }
  }
}

test("cyclic and reverse matching agrees with exhaustive directed traversal", () => {
  for (let braceletLength = 3; braceletLength <= 7; braceletLength += 1) {
    for (const braceletCode of binaryStrings(braceletLength)) {
      const bracelet = decodeBracelet(braceletCode);
      const maximumPatternLength = Math.min(4, braceletLength - 1);
      for (
        let patternLength = 1;
        patternLength <= maximumPatternLength;
        patternLength += 1
      ) {
        for (const exactCode of binaryStrings(patternLength)) {
          const patterns = [decodePattern(exactCode)];
          for (let hiddenIndex = 0; hiddenIndex < patternLength; hiddenIndex += 1) {
            patterns.push(
              decodePattern(
                `${exactCode.slice(0, hiddenIndex)}?${exactCode.slice(
                  hiddenIndex + 1,
                )}`,
              ),
            );
          }
          for (const pattern of patterns) {
            const expected = brutePhysicalStarts(bracelet, pattern);
            const actual = findOccurrences(bracelet, pattern)
              .map(({ clockwiseStart }) => clockwiseStart)
              .sort((left, right) => left - right);
            assert.deepEqual(
              actual,
              expected,
              `${braceletCode} / ${encodePattern(pattern)}`,
            );
          }
        }
      }
    }
  }
});

test("matching recognizes wraparound and a bracelet viewed from the other side", () => {
  assert.deepEqual(
    findOccurrences(decodeBracelet("CGTV"), decodePattern("VCG")).map(
      ({ clockwiseStart }) => clockwiseStart,
    ),
    [3],
  );

  const tutorialOccurrences = findOccurrences(
    TUTORIAL.bracelet,
    TUTORIAL.answer,
  );
  assert.equal(tutorialOccurrences.length, 1);
  assert.equal(tutorialOccurrences[0].alignment, "reverse");
  assert.equal(
    findOccurrences(TUTORIAL.bracelet, reversePattern(TUTORIAL.answer)).length,
    1,
  );
  assert.equal(findOccurrences(TUTORIAL.bracelet, TUTORIAL.nearMiss).length, 0);
  const tutorialColors = new Set(
    TUTORIAL.bracelet.map(({ color }) => color),
  );
  assert.ok(
    TUTORIAL.nearMiss.every(
      (token) =>
        token.kind === "bead" && tutorialColors.has(token.bead.color),
    ),
  );
  assert.equal(visibleSegmentDistance(TUTORIAL.answer, TUTORIAL.nearMiss), 2);

  for (const round of ROUNDS) {
    for (const view of braceletViews(round.bracelet)) {
      assert.deepEqual(
        matchingOptionIndexes(view, round.options),
        [round.correctIndex],
        `${round.id} remains exact from every rotation and side`,
      );
    }
  }
});

test("reverse-equivalent choices are duplicates and repeated physical arcs stay ambiguous", () => {
  assert.equal(
    segmentClassKey(decodePattern("CGT")),
    segmentClassKey(decodePattern("TGC")),
  );
  assert.deepEqual(
    findOccurrences(decodeBracelet("CGTCGT"), decodePattern("CGT")).map(
      ({ clockwiseStart }) => clockwiseStart,
    ),
    [0, 3],
  );

  const base = ROUNDS[0];
  const duplicateIndex = (base.correctIndex + 1) % 4;
  const options = base.options.map((option, index) =>
    index === duplicateIndex
      ? {
          pattern: reversePattern(base.options[base.correctIndex].pattern),
          kind: option.kind,
        }
      : option,
  );
  const result = validateRound({ ...base, options });
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.includes("distinct even when read in reverse")),
  );
  assert.ok(
    result.issues.some((issue) => issue.includes("Exactly one option")),
  );
});

test("the frozen Campaign is exact, balanced, nonperiodic, and deterministic", () => {
  assert.equal(CAMPAIGN_SPECS.length, 48);
  assert.equal(ROUNDS.length, 48);
  assert.deepEqual(
    ROUNDS.map(({ difficulty }) => difficulty),
    DIFFICULTIES.flatMap((difficulty) => Array(12).fill(difficulty)),
  );
  assert.equal(new Set(ROUNDS.map(({ id }) => id)).size, 48);
  assert.equal(new Set(ROUNDS.map(roundFingerprint)).size, 48);

  for (const [roundIndex, round] of ROUNDS.entries()) {
    assertOneExactAnswer(round, `Campaign ${roundIndex + 1}`);
    for (const [optionIndex] of round.options.entries()) {
      assert.equal(
        distractorKindMatches(round, optionIndex),
        true,
        `${round.id} option ${optionIndex + 1} kind`,
      );
      if (optionIndex === round.correctIndex) continue;
      const comparisons = closestBraceletComparisons(
        round.bracelet,
        round.options[optionIndex].pattern,
      );
      assert.equal(comparisons.length, 1, `${round.id} closest comparison`);
      assert.ok(comparisons[0].mismatchCount > 0);
    }
  }

  for (const difficulty of DIFFICULTIES) {
    const level = ROUNDS.filter((round) => round.difficulty === difficulty);
    const positions = level.map(({ correctIndex }) => correctIndex);
    assert.deepEqual(
      [0, 1, 2, 3].map(
        (position) => positions.filter((value) => value === position).length,
      ),
      [3, 3, 3, 3],
      `${difficulty} answer balance`,
    );
    assert.ok(
      positions.every(
        (position, index) => index === 0 || position !== positions[index - 1],
      ),
      `${difficulty} has no adjacent answer-position repeat`,
    );
    assert.ok(
      positions.slice(4).some(
        (position, index) => position !== positions[index],
      ),
      `${difficulty} is not a four-position cycle`,
    );
    assert.deepEqual(
      ["forward", "reverse"].map(
        (alignment) =>
          level.filter(
            ({ occurrence }) => occurrence.alignment === alignment,
          ).length,
      ),
      [6, 6],
      `${difficulty} direction balance`,
    );
  }

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Campaign construction cannot consult randomness.");
  };
  try {
    assert.deepEqual(buildCampaignRounds(), ROUNDS);
  } finally {
    Math.random = originalRandom;
  }
});

test("a few advanced Campaign rounds use a real two-tone monochrome scheme", () => {
  assert.equal(encodeBracelet(decodeBracelet("BLbl")), "BLbl");
  assert.equal(encodeBracelet(decodeBracelet("CGtv")), "CGtv");
  assert.equal(progressionMetadata.contentVersion, "2");
  assert.equal(
    progressionMetadata.generatorVersion,
    "1",
    "Campaign palettes do not rewrite saved Infinite streams",
  );
  assert.equal(
    progressionMetadata.journeyContentVersion,
    "1",
    "Journey-only banks retain their own content version",
  );

  for (const difficulty of DIFFICULTIES) {
    const level = ROUNDS.filter((round) => round.difficulty === difficulty);
    const monochromeIndexes = level.flatMap((round, index) =>
      braceletColorScheme(round.bracelet) === "monochrome" ? [index] : [],
    );
    assert.equal(
      monochromeIndexes.length,
      ADVANCED_DIFFICULTIES.has(difficulty) ? 3 : 0,
      `${difficulty} monochrome round count`,
    );
    assert.ok(
      monochromeIndexes.every(
        (index, position) =>
          position === 0 || index - monochromeIndexes[position - 1] > 1,
      ),
      `${difficulty} monochrome rounds are spaced apart`,
    );
  }

  const monochromeRounds = ROUNDS.filter(
    (round) => braceletColorScheme(round.bracelet) === "monochrome",
  );
  for (const round of monochromeRounds) {
    assert.deepEqual(
      new Set(round.bracelet.map(({ color }) => color)),
      new Set(["black", "lightGray"]),
      `${round.id} uses only black and light gray`,
    );
    assert.equal(
      round.bracelet.filter(({ mark }) => mark === "dot").length,
      4,
    );
    for (const option of round.options) {
      assert.ok(
        option.pattern.every(
          (token) =>
            token.kind === "hidden" ||
            token.bead.color === "black" ||
            token.bead.color === "lightGray",
        ),
        `${round.id} options stay in the same two-tone scheme`,
      );
    }
    if (round.difficulty === "Wizard") {
      assert.deepEqual(
        new Set(
          round.options[round.correctIndex].pattern.flatMap((token) =>
            token.kind === "bead" ? [token.bead.color] : [],
          ),
        ),
        new Set(["black", "lightGray"]),
        `${round.id} keeps both tones visible around its hidden center`,
      );
    }
  }

  const base = monochromeRounds[0];
  const mixedBracelet = {
    ...base,
    bracelet: base.bracelet.map((bead, index) =>
      index === 0 ? { ...bead, color: "coral" } : bead,
    ),
  };
  assert.equal(validateRound(mixedBracelet).valid, false);

  const wrongOptionIndex = (base.correctIndex + 1) % base.options.length;
  const mixedOptions = base.options.map((option, optionIndex) => ({
    ...option,
    pattern:
      optionIndex === wrongOptionIndex
        ? option.pattern.map((token, tokenIndex) =>
            tokenIndex === 0 && token.kind === "bead"
              ? { ...token, bead: { ...token.bead, color: "coral" } }
              : token,
          )
        : option.pattern,
  }));
  const invalidOptions = validateRound({ ...base, options: mixedOptions });
  assert.equal(invalidOptions.valid, false);
  assert.ok(
    invalidOptions.issues.some((issue) =>
      issue.includes("mixes bead color schemes"),
    ),
  );
});

test("Journey-only Bracelet banks are frozen, valid, balanced, and disjoint", () => {
  const expectations = {
    "junior-2": "Medium",
    "expert-2": "Hard",
    "wizard-2": "Wizard",
  };
  const adapterExpectations = {
    starter: "Easy",
    "junior-1": "Medium",
    "junior-2": "Medium",
    "expert-1": "Hard",
    "expert-2": "Hard",
    "wizard-1": "Wizard",
    "wizard-2": "Wizard",
  };
  const canonicalFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const journeyFingerprints = new Set();

  assert.deepEqual(
    Object.keys(JOURNEY_EXTRA_CAMPAIGN_ROUNDS),
    Object.keys(expectations),
  );
  assert.equal(Object.isFrozen(JOURNEY_EXTRA_CAMPAIGN_ROUNDS), true);
  assert.deepEqual(
    buildBraceletJourneyExtraCampaignRounds(),
    JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
  );
  assert.equal(progressionAdapter.campaignRounds.length, 48);
  assert.deepEqual(
    progressionAdapter.campaignRounds.map(roundFingerprint),
    ROUNDS.map(roundFingerprint),
    "standalone Campaign remains the canonical 48-round path",
  );
  assert.equal(progressionAdapter.contentVersion, "2");
  assert.equal(progressionAdapter.generatorVersion, "1");
  assert.equal(progressionAdapter.journeyContentVersion, "1");
  assert.deepEqual(
    Object.keys(progressionAdapter.journeyCampaignRounds),
    Object.keys(adapterExpectations),
  );
  for (const [level, difficulty] of Object.entries(adapterExpectations)) {
    const rounds = progressionAdapter.journeyCampaignRounds[level];
    assert.equal(rounds.length, 12, `${level}: adapter round count`);
    assert.ok(
      rounds.every((round) => round.difficulty === difficulty),
      `${level}: adapter difficulty`,
    );
  }

  for (const [level, difficulty] of Object.entries(expectations)) {
    const rounds = JOURNEY_EXTRA_CAMPAIGN_ROUNDS[level];
    const positions = rounds.map(({ correctIndex }) => correctIndex);
    const presentations = rounds.map(braceletPresentationForRound);

    assert.equal(rounds.length, 12, `${level}: round count`);
    assert.equal(Object.isFrozen(rounds), true, `${level}: frozen bank`);
    assert.ok(
      rounds.every((round) => round.difficulty === difficulty),
      `${level}: mapped difficulty`,
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
    assert.ok(
      new Set(
        [0, 4, 8].map((start) =>
          positions.slice(start, start + 4).join(","),
        ),
      ).size > 1,
      `${level}: no repeated four-position cycle`,
    );
    assert.deepEqual(
      ["forward", "reverse"].map(
        (alignment) =>
          rounds.filter(
            ({ occurrence }) => occurrence.alignment === alignment,
          ).length,
      ),
      [6, 6],
      `${level}: direction balance`,
    );
    if (difficulty === "Medium") {
      assert.ok(
        presentations.every((presentation) => presentation === "circle"),
        `${level}: simple rounds stay circular`,
      );
    } else {
      assert.deepEqual(
        new Set(presentations),
        new Set(TANGLE_LAYOUT_IDS),
        `${level}: Journey rounds cover both tangled presentations`,
      );
    }

    for (const [index, round] of rounds.entries()) {
      assert.equal(
        round.id,
        `journey:${level}:${String(index + 1).padStart(2, "0")}`,
      );
      assertOneExactAnswer(round, `${level} round ${index + 1}`);
      const fingerprint = roundFingerprint(round);
      assert.equal(
        canonicalFingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1}: standalone disjointness`,
      );
      assert.equal(
        journeyFingerprints.has(fingerprint),
        false,
        `${level} round ${index + 1}: Journey disjointness`,
      );
      journeyFingerprints.add(fingerprint);

      const presentation = presentations[index];
      if (difficulty !== "Medium") {
        assert.ok(
          TANGLE_LAYOUT_IDS.includes(presentation),
          `${level} round ${index + 1}: advanced round is tangled`,
        );
        assert.equal(
          tangledLayoutForPresentation(presentation)?.id,
          presentation,
        );
        for (const view of braceletViews(round.bracelet)) {
          assert.equal(
            braceletPresentationForRound({ ...round, bracelet: view }),
            presentation,
            `${level} round ${index + 1}: layout is view-invariant`,
          );
        }
      }
    }

    assert.deepEqual(
      progressionAdapter.journeyCampaignRounds[level].map(
        roundFingerprint,
      ),
      rounds.map(roundFingerprint),
      `${level}: adapter uses the frozen Journey bank`,
    );
  }

  assert.equal(journeyFingerprints.size, 36);
  assert.equal(
    new Set(
      Object.values(progressionAdapter.journeyCampaignRounds)
        .flat()
        .map(roundFingerprint),
    ).size,
    84,
    "all seven Journey banks remain fingerprint-disjoint",
  );

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("Journey campaign construction cannot consult randomness.");
  };
  try {
    assert.deepEqual(
      buildBraceletJourneyExtraCampaignRounds(),
      JOURNEY_EXTRA_CAMPAIGN_ROUNDS,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("Starter and Junior use generous content differences, never one-feature traps", () => {
  for (const round of ROUNDS.filter(({ difficulty }) =>
    SIMPLE_DIFFICULTIES.has(difficulty),
  )) {
    assertSimpleOptions(round, round.id);
  }

  const base = ROUNDS.find(({ difficulty }) => difficulty === "Easy");
  const removedColor = base.bracelet[0].color;
  const replacementColor = base.bracelet.find(
    ({ color }) => color !== removedColor,
  ).color;
  const withoutOneOptionColor = {
    ...base,
    bracelet: base.bracelet.map((bead) =>
      bead.color === removedColor
        ? { ...bead, color: replacementColor }
        : bead,
    ),
  };
  const invalid = validateRound(withoutOneOptionColor);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.issues.some((issue) =>
      issue.includes("color absent from the bracelet"),
    ),
  );
});

test("Expert and Wizard share the same base complexity profile", () => {
  const expert = DIFFICULTY_RULES.Hard;
  const wizard = DIFFICULTY_RULES.Wizard;
  assert.deepEqual(
    {
      braceletLength: wizard.braceletLength,
      segmentLength: wizard.segmentLength,
      colorCount: wizard.colorCount,
      dotCount: wizard.dotCount,
    },
    {
      braceletLength: expert.braceletLength,
      segmentLength: expert.segmentLength,
      colorCount: expert.colorCount,
      dotCount: expert.dotCount,
    },
  );

  for (const round of ROUNDS.filter(({ difficulty }) =>
    ADVANCED_DIFFICULTIES.has(difficulty),
  )) {
    assert.equal(round.bracelet.length, 12);
    assert.equal(
      round.bracelet.filter(({ mark }) => mark === "dot").length,
      4,
    );
    assert.equal(round.options[0].pattern.length, 5);
    assert.ok(round.options.some(({ kind }) => kind === "one-mark-off"));
  }
});

test("advanced presentation selection is deterministic and view-invariant", () => {
  for (const round of ROUNDS) {
    const presentation = braceletPresentationForRound(round);
    if (SIMPLE_DIFFICULTIES.has(round.difficulty)) {
      assert.equal(presentation, "circle", round.id);
      continue;
    }

    assert.ok(TANGLE_LAYOUT_IDS.includes(presentation), round.id);
    assert.equal(
      tangledLayoutForPresentation(presentation)?.id,
      presentation,
    );
    assert.equal(braceletPresentationForRound(round), presentation);
    for (const view of braceletViews(round.bracelet)) {
      assert.equal(
        braceletPresentationForRound({ ...round, bracelet: view }),
        presentation,
        `${round.id} remains on one layout from either side`,
      );
    }
  }

  for (const difficulty of ["Hard", "Wizard"]) {
    assert.deepEqual(
      new Set(
        ROUNDS.filter((round) => round.difficulty === difficulty).map(
          braceletPresentationForRound,
        ),
      ),
      new Set(TANGLE_LAYOUT_IDS),
      `${difficulty} Campaign covers every advanced strand layout`,
    );
  }
});

test("advanced layouts are distinct closed ordered cycles with explicit bridges", () => {
  assert.deepEqual(TANGLE_LAYOUT_IDS, ["figure-eight", "labyrinth"]);
  const strandPaths = new Set();
  const slotGeometries = new Set();

  for (const id of TANGLE_LAYOUT_IDS) {
    const { beadSlots, cycleEdges, overpassPaths, strandPath } =
      TANGLED_BRACELET_LAYOUTS[id];
    assert.equal(beadSlots.length, 12, id);
    assert.deepEqual(
      beadSlots.map(({ braceletIndex }) => braceletIndex),
      Array.from({ length: 12 }, (_, index) => index),
      `${id} keeps traversal order`,
    );
    assert.equal(
      new Set(
        beadSlots.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`),
      ).size,
      12,
      `${id} has twelve distinct bead positions`,
    );

    let minimumSpacing = Number.POSITIVE_INFINITY;
    for (let left = 0; left < beadSlots.length; left += 1) {
      assert.ok(Number.isFinite(beadSlots[left].x));
      assert.ok(Number.isFinite(beadSlots[left].y));
      for (let right = left + 1; right < beadSlots.length; right += 1) {
        minimumSpacing = Math.min(
          minimumSpacing,
          Math.hypot(
            beadSlots[left].x - beadSlots[right].x,
            beadSlots[left].y - beadSlots[right].y,
          ),
        );
      }
    }
    assert.ok(
      minimumSpacing >= 45,
      `${id} beads remain visibly separate`,
    );

    assert.deepEqual(
      cycleEdges,
      Array.from(
        { length: 12 },
        (_, index) => [index, (index + 1) % 12],
      ),
      `${id} is one closed cycle`,
    );
    assert.match(strandPath, /^M .* Z$/, `${id} closes its strand`);
    assert.ok(overpassPaths.length >= 1, `${id} marks every crossing`);
    assert.equal(new Set(overpassPaths).size, overpassPaths.length);
    for (const overpassPath of overpassPaths) {
      assert.match(overpassPath, /^M /);
      assert.doesNotMatch(overpassPath, / Z$/);
    }

    strandPaths.add(strandPath);
    slotGeometries.add(
      beadSlots.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`).join("|"),
    );
  }

  assert.equal(strandPaths.size, TANGLE_LAYOUT_IDS.length);
  assert.equal(slotGeometries.size, TANGLE_LAYOUT_IDS.length);
  assert.equal(TANGLED_BRACELET_LAYOUTS["figure-eight"].overpassPaths.length, 1);
  assert.ok(
    TANGLED_BRACELET_LAYOUTS.labyrinth.overpassPaths.length >= 5,
    "labyrinth uses several explicit over/under crossings",
  );
});

test("Wizard uses one centered wildcard and wrong feedback cannot leak it", () => {
  for (const round of ROUNDS.filter(
    ({ difficulty }) => difficulty === "Wizard",
  )) {
    assertWizardRound(round, round.id);
  }

  const wizard = ROUNDS.find(({ difficulty }) => difficulty === "Wizard");
  const brokenOptions = wizard.options.map((option, index) =>
    index === 0
      ? {
          ...option,
          pattern: option.pattern.map((token, tokenIndex) =>
            tokenIndex === 1
              ? { kind: "hidden" }
              : tokenIndex === 2
                ? resolvedCorrectPattern(wizard)[2]
                : token,
          ),
        }
      : option,
  );
  const invalid = validateRound({ ...wizard, options: brokenOptions });
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.issues.some((issue) => issue.includes("center bead")),
  );
});

test("all tangled Campaign and Infinite rounds have one solution from every view", () => {
  for (const [difficultyIndex, difficulty] of ["Hard", "Wizard"].entries()) {
    const seenLayouts = new Set();
    const campaign = ROUNDS.filter(
      (round) => round.difficulty === difficulty,
    );
    assert.equal(campaign.length, 12);

    const generated = Array.from({ length: 400 }, (_, seed) =>
      generateInfiniteRound(
        difficulty,
        createSeededRandom(0x71a2_0000 + difficultyIndex * 0x1000 + seed),
      ),
    );

    for (const [roundIndex, round] of [...campaign, ...generated].entries()) {
      const source = roundIndex < campaign.length ? "Campaign" : "Infinite";
      const number =
        roundIndex < campaign.length
          ? roundIndex + 1
          : roundIndex - campaign.length + 1;
      const presentation = braceletPresentationForRound(round);
      assert.ok(TANGLE_LAYOUT_IDS.includes(presentation));
      seenLayouts.add(presentation);
      const label = `${difficulty} ${source} ${number} (${presentation})`;
      assertOneExactAnswer(round, label);
      if (difficulty === "Wizard") assertWizardRound(round, label);

      for (const [viewIndex, view] of braceletViews(round.bracelet).entries()) {
        const solutions = bruteSolutions(view, round.options);
        assert.equal(
          solutions.length,
          1,
          `${label}, bracelet view ${viewIndex + 1}: total compatible option/arc pairs`,
        );
        assert.equal(
          solutions[0].optionIndex,
          round.correctIndex,
          `${label}, bracelet view ${viewIndex + 1}: compatible option`,
        );
        assert.equal(
          brutePhysicalStarts(
            view,
            round.options[round.correctIndex].pattern,
          ).length,
          1,
          `${label}, bracelet view ${viewIndex + 1}: physical placement`,
        );
        assert.equal(
          findCompatibleSolutions(view, round.options).length,
          1,
          `${label}, bracelet view ${viewIndex + 1}: engine solution count`,
        );
      }
    }
    assert.deepEqual(
      seenLayouts,
      new Set(TANGLE_LAYOUT_IDS),
      `${difficulty} corpus covers every tangle layout`,
    );
  }
});

function makeGeneratedCorpus(countPerDifficulty = 400) {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty, difficultyIndex) => {
      const random = createSeededRandom(0xbace_1000 + difficultyIndex);
      return [
        difficulty,
        Array.from({ length: countPerDifficulty }, () =>
          generateInfiniteRound(difficulty, random),
        ),
      ];
    }),
  );
}

test("1,600 deterministic generated rounds satisfy every per-round invariant", () => {
  const generated = makeGeneratedCorpus();
  for (const difficulty of DIFFICULTIES) {
    const rules = DIFFICULTY_RULES[difficulty];
    const directions = new Set();
    const answerPositions = new Set();

    for (const [roundIndex, round] of generated[difficulty].entries()) {
      const label = `${difficulty} generated ${roundIndex + 1}`;
      assertOneExactAnswer(round, label);
      assert.equal(round.difficulty, difficulty);
      assert.equal(round.bracelet.length, rules.braceletLength);
      assert.equal(
        new Set(round.bracelet.map(({ color }) => color)).size,
        rules.colorCount,
      );
      assert.equal(
        round.bracelet.filter(({ mark }) => mark === "dot").length,
        rules.dotCount,
      );
      assert.equal(
        braceletOrbitSize(round.bracelet),
        round.bracelet.length * 2,
      );
      directions.add(round.occurrence.alignment);
      answerPositions.add(round.correctIndex);

      for (const [optionIndex, option] of round.options.entries()) {
        assert.equal(option.pattern.length, rules.segmentLength);
        assert.equal(
          distractorKindMatches(round, optionIndex),
          true,
          `${label} option ${optionIndex + 1} kind`,
        );
        if (difficulty === "Wizard") {
          assert.deepEqual(hiddenIndexes(option.pattern), [2]);
        } else {
          assert.deepEqual(hiddenIndexes(option.pattern), []);
        }
        if (optionIndex === round.correctIndex) continue;
        assert.ok(
          visibleSegmentDistance(
            option.pattern,
            round.options[round.correctIndex].pattern,
          ) <= rules.maximumDistractorDistance,
        );
        const comparisons = closestBraceletComparisons(
          round.bracelet,
          option.pattern,
        );
        assert.equal(comparisons.length, 1, `${label} unique closest match`);
        assert.ok(comparisons[0].mismatchCount > 0);
        if (difficulty !== "Wizard") {
          assert.notEqual(comparisons[0].alignment, "both");
        }
      }

      if (SIMPLE_DIFFICULTIES.has(difficulty)) {
        assertSimpleOptions(round, label);
      }
      if (difficulty === "Wizard") {
        assertWizardRound(round, label);
      }
    }

    assert.deepEqual(
      directions,
      new Set(["forward", "reverse"]),
      `${difficulty} generated direction coverage`,
    );
    assert.deepEqual(
      answerPositions,
      new Set([0, 1, 2, 3]),
      `${difficulty} generated answer-position coverage`,
    );
  }
});

test("seeded generation is reproducible with the same exclusion history", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const firstRandom = createSeededRandom(0xdec0_0000 + difficultyIndex);
    const secondRandom = createSeededRandom(0xdec0_0000 + difficultyIndex);
    const firstUsed = new Set();
    const secondUsed = new Set();
    const first = [];
    const second = [];

    for (let index = 0; index < 20; index += 1) {
      const firstRound = generateInfiniteRound(
        difficulty,
        firstRandom,
        firstUsed,
      );
      const secondRound = generateInfiniteRound(
        difficulty,
        secondRandom,
        secondUsed,
      );
      first.push(firstRound);
      second.push(secondRound);
      firstUsed.add(roundFingerprint(firstRound));
      secondUsed.add(roundFingerprint(secondRound));
    }
    assert.deepEqual(first, second, `${difficulty} reproducibility`);
  }
});

test("a realistic Infinite session avoids repeated fingerprints", () => {
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const used = new Set();
    const random = createSeededRandom(0x515e_0000 + difficultyIndex);
    for (let roundIndex = 0; roundIndex < 24; roundIndex += 1) {
      const round = generateInfiniteRound(difficulty, random, used);
      const fingerprint = roundFingerprint(round);
      assert.ok(
        !used.has(fingerprint),
        `${difficulty} session round ${roundIndex + 1} repeated`,
      );
      used.add(fingerprint);
    }
    assert.equal(used.size, 24);
  }
});

test("fingerprints ignore option order, viewing side, and segment direction", () => {
  const round = ROUNDS[0];
  const reordered = {
    ...round,
    options: [...round.options].reverse(),
    correctIndex: 3 - round.correctIndex,
  };
  const reversedAnswerOptions = round.options.map((option, index) =>
    index === round.correctIndex
      ? { ...option, pattern: reversePattern(option.pattern) }
      : option,
  );
  const otherSide = {
    ...round,
    bracelet: [...round.bracelet].reverse(),
  };
  assert.equal(roundFingerprint(reordered), roundFingerprint(round));
  assert.equal(
    roundFingerprint({ ...round, options: reversedAnswerOptions }),
    roundFingerprint(round),
  );
  assert.equal(roundFingerprint(otherSide), roundFingerprint(round));
  assert.equal(
    braceletClassKey(round.bracelet),
    braceletClassKey([...round.bracelet].reverse()),
  );
});

test("generation rejects hostile randomness and retries excluded output safely", () => {
  assert.throws(
    () => generateInfiniteRound("Easy", () => 0),
    new RegExp(`after ${GENERATOR_MAX_ATTEMPTS} attempts`),
  );
  for (const invalidValue of [
    Number.NaN,
    -0.01,
    1,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => generateInfiniteRound("Easy", () => invalidValue),
      /Random source must return/,
    );
  }
  assert.throws(
    () => generateInfiniteRound("Impossible", createSeededRandom(1)),
    /Unknown difficulty/,
  );

  const seed = 0xabc1_2345;
  const first = generateInfiniteRound("Medium", createSeededRandom(seed));
  const excluded = new Set([roundFingerprint(first)]);
  const replacement = generateInfiniteRound(
    "Medium",
    createSeededRandom(seed),
    excluded,
  );
  assert.notEqual(roundFingerprint(replacement), roundFingerprint(first));

  const recoveredRandom = createSeededRandom(731);
  let calls = 0;
  const initiallyDegenerate = () => {
    calls += 1;
    return calls <= 80 ? 0 : recoveredRandom();
  };
  assertOneExactAnswer(
    generateInfiniteRound("Easy", initiallyDegenerate),
    "recovered hostile source",
  );
  assert.ok(calls > 80);
});
