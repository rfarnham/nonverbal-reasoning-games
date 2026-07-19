export type Difficulty = "Starter" | "Junior" | "Expert" | "Wizard";
export type RibbonColor =
  | "coral"
  | "gold"
  | "teal"
  | "violet"
  | "neutral";
export type RibbonMotif =
  | "none"
  | "dot"
  | "ring"
  | "bars"
  | "diamond"
  | "cross"
  | "square";
export type RibbonEnd = "start" | "end";
export type CrossingTop = "vertical" | "horizontal";

export type Ribbon = {
  color: RibbonColor;
  motif: RibbonMotif;
  motifEnd: RibbonEnd;
};

export type Weave = {
  verticalRibbons: readonly Ribbon[];
  horizontalRibbons: readonly Ribbon[];
  crossings: readonly CrossingTop[];
};

export type DistractorKind =
  | "mirror-only"
  | "depth-only"
  | "top-turn"
  | "one-crossing-off"
  | "two-crossings-off"
  | "one-motif-off";

export type OptionKind = "correct" | DistractorKind;

export type Round = {
  clue: Weave;
  options: readonly Weave[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
  correctPattern: Weave;
  difficulty: Difficulty;
};

export type WeaveDifferences = {
  crossingIndexes: readonly number[];
  verticalRibbonIndexes: readonly number[];
  horizontalRibbonIndexes: readonly number[];
  total: number;
};

type DifficultyRule = {
  columns: readonly number[];
  rows: readonly number[];
  crossingCount: number;
  ribbonCount: number;
  motifCount: number;
  usesBodyColor: boolean;
};

type AuthoredSpec = {
  crossingCode: string;
  variant: number;
  correctIndex: number;
  columns: number;
  rows: number;
};

const COLORS: readonly Exclude<RibbonColor, "neutral">[] = [
  "coral",
  "gold",
  "teal",
  "violet",
];

const VERTICAL_MOTIFS: readonly Exclude<RibbonMotif, "none">[] = [
  "dot",
  "ring",
  "bars",
];

const HORIZONTAL_MOTIFS: readonly Exclude<RibbonMotif, "none">[] = [
  "diamond",
  "cross",
  "square",
];

export const DIFFICULTY_RULES: Readonly<Record<Difficulty, DifficultyRule>> = {
  Starter: {
    columns: [2],
    rows: [2],
    crossingCount: 4,
    ribbonCount: 4,
    motifCount: 0,
    usesBodyColor: true,
  },
  Junior: {
    columns: [2, 3],
    rows: [2, 3],
    crossingCount: 6,
    ribbonCount: 5,
    motifCount: 0,
    usesBodyColor: true,
  },
  Expert: {
    columns: [3],
    rows: [3],
    crossingCount: 9,
    ribbonCount: 6,
    motifCount: 6,
    usesBodyColor: true,
  },
  Wizard: {
    columns: [3],
    rows: [3],
    crossingCount: 9,
    ribbonCount: 6,
    motifCount: 6,
    usesBodyColor: false,
  },
};

export const GENERATOR_MAX_ATTEMPTS = 128;

const ANSWER_SCHEDULES: Readonly<Record<Difficulty, readonly number[]>> = {
  Starter: [0, 1, 3, 2, 0, 2, 1, 3, 1, 0, 2, 3],
  Junior: [2, 0, 1, 3, 2, 1, 0, 3, 1, 3, 2, 0],
  Expert: [1, 3, 0, 2, 3, 1, 2, 0, 2, 0, 3, 1],
  Wizard: [3, 1, 2, 0, 1, 3, 0, 2, 0, 2, 1, 3],
};

const CAMPAIGN_CODES: Readonly<Record<Difficulty, readonly string[]>> = {
  Starter: [
    "1000",
    "0100",
    "0010",
    "0001",
    "1100",
    "1010",
    "1001",
    "0110",
    "0101",
    "0011",
    "1110",
    "1101",
  ],
  Junior: [
    "101001",
    "110010",
    "011001",
    "100110",
    "010111",
    "101100",
    "001110",
    "110001",
    "100011",
    "011100",
    "010101",
    "101010",
  ],
  Expert: [
    "101010110",
    "110001011",
    "011101000",
    "100110010",
    "010011101",
    "111000101",
    "001101110",
    "101100011",
    "011010100",
    "110101000",
    "100011110",
    "010110101",
  ],
  Wizard: [
    "101101001",
    "011010110",
    "110100101",
    "001011101",
    "100101110",
    "010111001",
    "111001010",
    "101010011",
    "011100101",
    "110010100",
    "100111010",
    "010001111",
  ],
};

function oppositeEnd(end: RibbonEnd): RibbonEnd {
  return end === "start" ? "end" : "start";
}

function oppositeCrossing(crossing: CrossingTop): CrossingTop {
  return crossing === "vertical" ? "horizontal" : "vertical";
}

function copyRibbon(ribbon: Ribbon): Ribbon {
  return { ...ribbon };
}

function copyWeave(weave: Weave): Weave {
  return {
    verticalRibbons: weave.verticalRibbons.map(copyRibbon),
    horizontalRibbons: weave.horizontalRibbons.map(copyRibbon),
    crossings: [...weave.crossings],
  };
}

function ribbonKey(ribbon: Ribbon): string {
  return ribbon.motif === "none"
    ? `${ribbon.color}.none`
    : `${ribbon.color}.${ribbon.motif}.${ribbon.motifEnd}`;
}

/** A visual key that is independent of object identity and option order. */
export function weaveKey(weave: Weave): string {
  const columns = weave.verticalRibbons.length;
  const rows = weave.horizontalRibbons.length;
  const vertical = weave.verticalRibbons.map(ribbonKey).join(",");
  const horizontal = weave.horizontalRibbons.map(ribbonKey).join(",");
  const crossings = weave.crossings
    .map((crossing) => (crossing === "vertical" ? "V" : "H"))
    .join("");
  return `${columns}x${rows}|${vertical}|${horizontal}|${crossings}`;
}

/**
 * Computes the upright view from the opposite side of a transparent pane.
 * Left and right swap, horizontal ribbon ends swap, and every crossing reverses
 * depth. Top and bottom remain fixed.
 */
export function otherSideOf(weave: Weave): Weave {
  const columns = weave.verticalRibbons.length;
  const rows = weave.horizontalRibbons.length;
  const crossings: CrossingTop[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sourceIndex = row * columns + (columns - column - 1);
      crossings.push(oppositeCrossing(weave.crossings[sourceIndex]));
    }
  }

  return {
    verticalRibbons: [...weave.verticalRibbons]
      .reverse()
      .map(copyRibbon),
    horizontalRibbons: weave.horizontalRibbons.map((ribbon) => ({
      ...ribbon,
      motifEnd:
        ribbon.motif === "none"
          ? ribbon.motifEnd
          : oppositeEnd(ribbon.motifEnd),
    })),
    crossings,
  };
}

/** The tempting but physically wrong result of mirroring only the drawing. */
export function mirrorOnly(weave: Weave): Weave {
  const columns = weave.verticalRibbons.length;
  const rows = weave.horizontalRibbons.length;
  const crossings: CrossingTop[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      crossings.push(
        weave.crossings[row * columns + (columns - column - 1)],
      );
    }
  }

  return {
    verticalRibbons: [...weave.verticalRibbons]
      .reverse()
      .map(copyRibbon),
    horizontalRibbons: weave.horizontalRibbons.map((ribbon) => ({
      ...ribbon,
      motifEnd:
        ribbon.motif === "none"
          ? ribbon.motifEnd
          : oppositeEnd(ribbon.motifEnd),
    })),
    crossings,
  };
}

/** Reverses depth without moving the viewer to the opposite side. */
export function depthOnly(weave: Weave): Weave {
  return {
    verticalRibbons: weave.verticalRibbons.map(copyRibbon),
    horizontalRibbons: weave.horizontalRibbons.map(copyRibbon),
    crossings: weave.crossings.map(oppositeCrossing),
  };
}

/** A plausible mistake: turning the pane over its top edge. */
export function turnOverTop(weave: Weave): Weave {
  const columns = weave.verticalRibbons.length;
  const rows = weave.horizontalRibbons.length;
  const crossings: CrossingTop[] = [];

  for (let row = 0; row < rows; row += 1) {
    const sourceRow = rows - row - 1;
    for (let column = 0; column < columns; column += 1) {
      crossings.push(
        oppositeCrossing(weave.crossings[sourceRow * columns + column]),
      );
    }
  }

  return {
    verticalRibbons: weave.verticalRibbons.map((ribbon) => ({
      ...ribbon,
      motifEnd:
        ribbon.motif === "none"
          ? ribbon.motifEnd
          : oppositeEnd(ribbon.motifEnd),
    })),
    horizontalRibbons: [...weave.horizontalRibbons]
      .reverse()
      .map(copyRibbon),
    crossings,
  };
}

function decodeCrossings(code: string): readonly CrossingTop[] {
  if (!/^[01]+$/.test(code)) {
    throw new Error(`Invalid crossing code: ${code}`);
  }
  return [...code].map((value) =>
    value === "1" ? "vertical" : "horizontal",
  );
}

function makeRibbonSet(
  count: number,
  axis: "vertical" | "horizontal",
  difficulty: Difficulty,
  variant: number,
): readonly Ribbon[] {
  const advanced = difficulty === "Expert" || difficulty === "Wizard";
  const neutral = difficulty === "Wizard";
  const motifs = axis === "vertical" ? VERTICAL_MOTIFS : HORIZONTAL_MOTIFS;
  const axisOffset = axis === "vertical" ? 0 : 2;

  return Array.from({ length: count }, (_, index) => ({
    color: neutral
      ? "neutral"
      : COLORS[(index + variant + axisOffset) % COLORS.length],
    motif: advanced ? motifs[(index + variant) % motifs.length] : "none",
    motifEnd: advanced
      ? (variant + index + axisOffset) % 2 === 0
        ? "start"
        : "end"
      : "start",
  }));
}

function makeWeave(
  difficulty: Difficulty,
  columns: number,
  rows: number,
  crossingCode: string,
  variant: number,
): Weave {
  if (crossingCode.length !== columns * rows) {
    throw new Error(
      `${difficulty} crossing code must contain ${columns * rows} entries.`,
    );
  }

  return {
    verticalRibbons: makeRibbonSet(
      columns,
      "vertical",
      difficulty,
      variant,
    ),
    horizontalRibbons: makeRibbonSet(
      rows,
      "horizontal",
      difficulty,
      variant,
    ),
    crossings: decodeCrossings(crossingCode),
  };
}

function toggleCrossings(
  weave: Weave,
  indexes: readonly number[],
): Weave {
  const indexSet = new Set(indexes);
  return {
    ...copyWeave(weave),
    crossings: weave.crossings.map((crossing, index) =>
      indexSet.has(index) ? oppositeCrossing(crossing) : crossing,
    ),
  };
}

function moveOneMotif(weave: Weave, salt: number): Weave {
  const candidates = weave.horizontalRibbons.flatMap((ribbon, index) =>
    ribbon.motif === "none" ? [] : [index],
  );
  if (candidates.length === 0) return copyWeave(weave);
  const targetIndex = candidates[Math.abs(salt) % candidates.length];

  return {
    ...copyWeave(weave),
    horizontalRibbons: weave.horizontalRibbons.map((ribbon, index) =>
      index === targetIndex
        ? { ...ribbon, motifEnd: oppositeEnd(ribbon.motifEnd) }
        : copyRibbon(ribbon),
    ),
  };
}

function makeDistractor(
  clue: Weave,
  correct: Weave,
  kind: DistractorKind,
  salt: number,
): Weave {
  const crossingCount = correct.crossings.length;
  const firstIndex = Math.abs(salt) % crossingCount;
  const secondIndex = (firstIndex + 1 + (Math.abs(salt) % 3)) % crossingCount;

  switch (kind) {
    case "mirror-only":
      return mirrorOnly(clue);
    case "depth-only":
      return depthOnly(clue);
    case "top-turn":
      return turnOverTop(clue);
    case "one-crossing-off":
      return toggleCrossings(correct, [firstIndex]);
    case "two-crossings-off":
      return toggleCrossings(correct, [firstIndex, secondIndex]);
    case "one-motif-off":
      return moveOneMotif(correct, salt);
  }
}

function distractorKindsFor(
  difficulty: Difficulty,
): readonly [DistractorKind, DistractorKind, DistractorKind] {
  switch (difficulty) {
    case "Starter":
      return ["mirror-only", "depth-only", "two-crossings-off"];
    case "Junior":
      return ["mirror-only", "top-turn", "two-crossings-off"];
    case "Expert":
      return ["mirror-only", "one-crossing-off", "one-motif-off"];
    case "Wizard":
      return ["mirror-only", "one-crossing-off", "one-motif-off"];
  }
}

function assembleRound(
  clue: Weave,
  difficulty: Difficulty,
  correctIndex: number,
  salts: readonly [number, number, number],
): Round | null {
  const correctPattern = otherSideOf(clue);
  const distractorKinds = distractorKindsFor(difficulty);
  const distractors = distractorKinds.map((kind, index) =>
    makeDistractor(clue, correctPattern, kind, salts[index]),
  );
  const options: Weave[] = [];
  const optionKinds: OptionKind[] = [];
  let distractorCursor = 0;

  for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
    if (optionIndex === correctIndex) {
      options.push(correctPattern);
      optionKinds.push("correct");
    } else {
      options.push(distractors[distractorCursor]);
      optionKinds.push(distractorKinds[distractorCursor]);
      distractorCursor += 1;
    }
  }

  const optionKeys = options.map(weaveKey);
  const correctKey = weaveKey(correctPattern);
  const exactMatches = optionKeys.flatMap((key, index) =>
    key === correctKey ? [index] : [],
  );
  if (new Set(optionKeys).size !== 4) return null;
  if (exactMatches.length !== 1 || exactMatches[0] !== correctIndex) {
    return null;
  }
  if (
    (difficulty === "Starter" || difficulty === "Junior") &&
    options.some((option, optionIndex) =>
      options
        .slice(optionIndex + 1)
        .some((candidate) => weaveDifferences(option, candidate).total < 2),
    )
  ) {
    return null;
  }

  return {
    clue,
    options,
    optionKinds,
    correctIndex,
    correctPattern,
    difficulty,
  };
}

function isInterestingWeave(weave: Weave, difficulty: Difficulty): boolean {
  const rule = DIFFICULTY_RULES[difficulty];
  const columns = weave.verticalRibbons.length;
  const rows = weave.horizontalRibbons.length;
  const verticalCount = weave.crossings.filter(
    (crossing) => crossing === "vertical",
  ).length;
  const motifCount = [...weave.verticalRibbons, ...weave.horizontalRibbons].filter(
    (ribbon) => ribbon.motif !== "none",
  ).length;
  const allRibbons = [
    ...weave.verticalRibbons,
    ...weave.horizontalRibbons,
  ];
  const advanced = difficulty === "Expert" || difficulty === "Wizard";
  const hasEndpointVariety = (ribbons: readonly Ribbon[]) =>
    ribbons.some((ribbon) => ribbon.motifEnd === "start") &&
    ribbons.some((ribbon) => ribbon.motifEnd === "end");

  return (
    rule.columns.includes(columns) &&
    rule.rows.includes(rows) &&
    columns * rows === rule.crossingCount &&
    columns + rows === rule.ribbonCount &&
    weave.crossings.length === rule.crossingCount &&
    verticalCount >= Math.max(1, Math.floor(rule.crossingCount / 3)) &&
    verticalCount <= Math.min(
      rule.crossingCount - 1,
      Math.ceil((rule.crossingCount * 2) / 3),
    ) &&
    motifCount === rule.motifCount &&
    weave.verticalRibbons.every(
      (ribbon, index, ribbons) =>
        ribbons.findIndex((candidate) => ribbonKey(candidate) === ribbonKey(ribbon)) ===
        index,
    ) &&
    weave.horizontalRibbons.every(
      (ribbon, index, ribbons) =>
        ribbons.findIndex((candidate) => ribbonKey(candidate) === ribbonKey(ribbon)) ===
        index,
    ) &&
    (rule.usesBodyColor
      ? allRibbons.every((ribbon) => ribbon.color !== "neutral")
      : allRibbons.every((ribbon) => ribbon.color === "neutral")) &&
    (!advanced ||
      (hasEndpointVariety(weave.verticalRibbons) &&
        hasEndpointVariety(weave.horizontalRibbons)))
  );
}

function validateAnswerSchedule(
  difficulty: Difficulty,
  schedule: readonly number[],
) {
  if (schedule.length !== 12) {
    throw new Error(`${difficulty} must contain 12 answer positions.`);
  }
  const counts = [0, 1, 2, 3].map(
    (position) => schedule.filter((value) => value === position).length,
  );
  if (counts.some((count) => count !== 3)) {
    throw new Error(`${difficulty} answer positions must balance 3/3/3/3.`);
  }
  if (schedule.some((value, index) => index > 0 && schedule[index - 1] === value)) {
    throw new Error(`${difficulty} cannot repeat adjacent answer positions.`);
  }
  const blocks = [0, 4, 8].map((start) =>
    schedule.slice(start, start + 4).join(""),
  );
  if (new Set(blocks).size === 1) {
    throw new Error(`${difficulty} cannot repeat one four-position cycle.`);
  }
}

function campaignSpecs(difficulty: Difficulty): readonly AuthoredSpec[] {
  const schedule = ANSWER_SCHEDULES[difficulty];
  const codes = CAMPAIGN_CODES[difficulty];
  validateAnswerSchedule(difficulty, schedule);

  return codes.map((crossingCode, index) => {
    const juniorWide = difficulty === "Junior" && index % 2 === 0;
    const columns = difficulty === "Starter" ? 2 : juniorWide ? 3 : difficulty === "Junior" ? 2 : 3;
    const rows = difficulty === "Starter" ? 2 : juniorWide ? 2 : difficulty === "Junior" ? 3 : 3;
    return {
      crossingCode,
      variant: index + (difficulty === "Wizard" ? 5 : 0),
      correctIndex: schedule[index],
      columns,
      rows,
    };
  });
}

export function buildCampaignRounds(): readonly Round[] {
  const difficulties: readonly Difficulty[] = [
    "Starter",
    "Junior",
    "Expert",
    "Wizard",
  ];
  const rounds = difficulties.flatMap((difficulty) =>
    campaignSpecs(difficulty).map((spec, index) => {
      const clue = makeWeave(
        difficulty,
        spec.columns,
        spec.rows,
        spec.crossingCode,
        spec.variant,
      );
      if (!isInterestingWeave(clue, difficulty)) {
        throw new Error(
          `${difficulty} campaign round ${index + 1} violates its difficulty rules.`,
        );
      }
      const round = assembleRound(clue, difficulty, spec.correctIndex, [
        index,
        index + 5,
        index + 11,
      ]);
      if (!round) {
        throw new Error(
          `${difficulty} campaign round ${index + 1} has ambiguous options.`,
        );
      }
      return round;
    }),
  );

  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error("Campaign rounds must have unique braid fingerprints.");
  }
  return rounds;
}

function unitRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a finite value from 0 up to 1.");
  }
  return value;
}

function randomInteger(random: () => number, exclusiveMaximum: number): number {
  return Math.floor(unitRandom(random) * exclusiveMaximum);
}

function generatedDimensions(
  difficulty: Difficulty,
  random: () => number,
): readonly [number, number] {
  if (difficulty === "Starter") return [2, 2];
  if (difficulty === "Junior") {
    return randomInteger(random, 2) === 0 ? [3, 2] : [2, 3];
  }
  return [3, 3];
}

function generatedCrossingCode(count: number, random: () => number): string {
  return Array.from({ length: count }, () =>
    unitRandom(random) < 0.5 ? "0" : "1",
  ).join("");
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function makeGeneratedRibbonSet(
  count: number,
  axis: "vertical" | "horizontal",
  difficulty: Difficulty,
  random: () => number,
): readonly Ribbon[] {
  const advanced = difficulty === "Expert" || difficulty === "Wizard";
  const neutral = difficulty === "Wizard";
  const motifPool =
    axis === "vertical" ? VERTICAL_MOTIFS : HORIZONTAL_MOTIFS;
  const colors = shuffled(COLORS, random).slice(0, count);
  const motifs = advanced
    ? shuffled(motifPool, random).slice(0, count)
    : Array<RibbonMotif>(count).fill("none");

  return Array.from({ length: count }, (_, index) => ({
    color: neutral ? "neutral" : colors[index],
    motif: motifs[index],
    motifEnd:
      advanced && randomInteger(random, 2) !== 0 ? "end" : "start",
  }));
}

/** A supplied random source makes generated sessions reproducible in tests. */
export function generateInfiniteRound(
  difficulty: Difficulty,
  random: () => number = Math.random,
): Round {
  if (!(difficulty in DIFFICULTY_RULES)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const [columns, rows] = generatedDimensions(difficulty, random);
    const crossingCode = generatedCrossingCode(columns * rows, random);
    const clue: Weave = {
      verticalRibbons: makeGeneratedRibbonSet(
        columns,
        "vertical",
        difficulty,
        random,
      ),
      horizontalRibbons: makeGeneratedRibbonSet(
        rows,
        "horizontal",
        difficulty,
        random,
      ),
      crossings: decodeCrossings(crossingCode),
    };
    if (!isInterestingWeave(clue, difficulty)) continue;

    const correctIndex = randomInteger(random, 4);
    const round = assembleRound(clue, difficulty, correctIndex, [
      randomInteger(random, 1_000_000),
      randomInteger(random, 1_000_000),
      randomInteger(random, 1_000_000),
    ]);
    if (!round) continue;

    const hasLocalNearMiss = round.options.some(
      (option, optionIndex) =>
        optionIndex !== round.correctIndex &&
        weaveDifferences(option, round.correctPattern).total ===
          (difficulty === "Starter" || difficulty === "Junior" ? 2 : 1),
    );
    if (hasLocalNearMiss) return round;
  }

  throw new Error(
    `Unable to generate a valid ${difficulty} braid after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

/** Identifies the physical front/back puzzle independently of option ordering. */
export function roundFingerprint(round: Round): string {
  const front = weaveKey(round.clue);
  const back = weaveKey(otherSideOf(round.clue));
  return front < back ? front : back;
}

export function weaveDifferences(
  candidate: Weave,
  expected: Weave,
): WeaveDifferences {
  const crossingIndexes = expected.crossings.flatMap((crossing, index) =>
    candidate.crossings[index] === crossing ? [] : [index],
  );
  const verticalRibbonIndexes = expected.verticalRibbons.flatMap(
    (ribbon, index) =>
      ribbonKey(candidate.verticalRibbons[index] ?? ribbon) === ribbonKey(ribbon)
        ? []
        : [index],
  );
  const horizontalRibbonIndexes = expected.horizontalRibbons.flatMap(
    (ribbon, index) =>
      ribbonKey(candidate.horizontalRibbons[index] ?? ribbon) === ribbonKey(ribbon)
        ? []
        : [index],
  );

  return {
    crossingIndexes,
    verticalRibbonIndexes,
    horizontalRibbonIndexes,
    total:
      crossingIndexes.length +
      verticalRibbonIndexes.length +
      horizontalRibbonIndexes.length,
  };
}

export function optionMatchesCorrect(round: Round): readonly number[] {
  const correctKey = weaveKey(otherSideOf(round.clue));
  return round.options.flatMap((option, index) =>
    weaveKey(option) === correctKey ? [index] : [],
  );
}

export function isDifficultyValid(
  weave: Weave,
  difficulty: Difficulty,
): boolean {
  return isInterestingWeave(weave, difficulty);
}

export const ROUNDS = buildCampaignRounds();

const tutorialClue = makeWeave("Starter", 2, 2, "1001", 2);

export const TUTORIAL = {
  clue: tutorialClue,
  answer: otherSideOf(tutorialClue),
  mirror: mirrorOnly(tutorialClue),
} as const;

export function describeWeave(weave: Weave): string {
  const ribbonCount =
    weave.verticalRibbons.length + weave.horizontalRibbons.length;
  const motifCount = [...weave.verticalRibbons, ...weave.horizontalRibbons].filter(
    (ribbon) => ribbon.motif !== "none",
  ).length;
  return `${ribbonCount} interwoven ribbons with ${
    weave.crossings.length
  } crossings${motifCount > 0 ? " and endpoint symbols" : ""}`;
}
