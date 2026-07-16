export type Tile = "empty" | "coral" | "gold" | "teal" | "violet";
export type Pattern = readonly Tile[];

export type Round = {
  clue: Pattern;
  options: readonly Pattern[];
  correctIndex: number;
  turn: "quarter turn" | "half turn" | "three-quarter turn";
};

const TILE_NAMES: Record<Tile, string> = {
  empty: "empty",
  coral: "coral",
  gold: "gold",
  teal: "teal",
  violet: "violet",
};

const TILE_CODES: Record<string, Tile> = {
  ".": "empty",
  C: "coral",
  G: "gold",
  T: "teal",
  V: "violet",
};

const ROUND_SPECS = [
  { pattern: "CT..G.V.C", turns: 1, correctIndex: 2 },
  { pattern: ".GCT...VT", turns: 2, correctIndex: 0 },
  { pattern: "V.CGT..T.", turns: 3, correctIndex: 3 },
  { pattern: "T.G.CVG..", turns: 1, correctIndex: 1 },
  { pattern: "C.VT.G.CT", turns: 2, correctIndex: 2 },
  { pattern: ".TGC.VG.C", turns: 3, correctIndex: 1 },
  { pattern: "G.CVT..CG", turns: 1, correctIndex: 3 },
  { pattern: "CV..GTT.C", turns: 2, correctIndex: 0 },
] as const;

function decodePattern(encoded: string): Pattern {
  const pattern = [...encoded].map((code) => TILE_CODES[code]);

  if (pattern.length !== 9 || pattern.some((tile) => tile === undefined)) {
    throw new Error(`Invalid 3x3 pattern: ${encoded}`);
  }

  return pattern;
}

export function rotatePattern(
  pattern: Pattern,
  quarterTurns: number,
): Pattern {
  let result = [...pattern];

  for (let turn = 0; turn < quarterTurns % 4; turn += 1) {
    const rotated = Array<Tile>(9).fill("empty");

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        rotated[column * 3 + (2 - row)] = result[row * 3 + column];
      }
    }

    result = rotated;
  }

  return result;
}

function reflectPattern(pattern: Pattern): Pattern {
  return pattern.flatMap((_, index) => {
    if (index % 3 !== 0) return [];
    return [...pattern.slice(index, index + 3)].reverse();
  });
}

function swapTiles(pattern: Pattern, first: number, second: number): Pattern {
  const result = [...pattern];
  [result[first], result[second]] = [result[second], result[first]];
  return result;
}

function moveTile(pattern: Pattern, from: number, to: number): Pattern {
  const result = [...pattern];
  result[to] = result[from];
  result[from] = "empty";
  return result;
}

export function patternKey(pattern: Pattern): string {
  return pattern.join("|");
}

export function isRotationOf(candidate: Pattern, clue: Pattern): boolean {
  const candidateKey = patternKey(candidate);
  return [0, 1, 2, 3].some(
    (turns) => patternKey(rotatePattern(clue, turns)) === candidateKey,
  );
}

function makeDistractors(clue: Pattern, correct: Pattern): Pattern[] {
  const filled = correct
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => tile !== "empty");
  const empty = correct
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => tile === "empty");

  const reflected = [0, 1, 2, 3].map((turns) =>
    rotatePattern(reflectPattern(clue), turns),
  );
  const swapped = filled.flatMap((first, firstIndex) =>
    filled.slice(firstIndex + 1).flatMap((second) =>
      first.tile === second.tile
        ? []
        : [swapTiles(correct, first.index, second.index)],
    ),
  );
  const moved = filled.flatMap(({ index: from }) =>
    empty.map(({ index: to }) => moveTile(correct, from, to)),
  );

  const seen = new Set<string>();
  const distractors: Pattern[] = [];

  for (const candidateGroup of [reflected, swapped, moved]) {
    const candidate = candidateGroup.find((option) => {
      const key = patternKey(option);
      return !seen.has(key) && !isRotationOf(option, clue);
    });

    if (candidate) {
      seen.add(patternKey(candidate));
      distractors.push(candidate);
    }
  }

  if (distractors.length < 3) {
    const fallbackCandidates = [...reflected, ...swapped, ...moved].filter(
      (candidate) => {
        const key = patternKey(candidate);
        if (seen.has(key) || isRotationOf(candidate, clue)) return false;
        seen.add(key);
        return true;
      },
    );

    distractors.push(...fallbackCandidates.slice(0, 3 - distractors.length));
  }

  if (distractors.length < 3) {
    throw new Error("A round needs at least three unique distractors.");
  }

  return distractors;
}

export function buildRounds(): readonly Round[] {
  return ROUND_SPECS.map(({ pattern, turns, correctIndex }) => {
    const clue = decodePattern(pattern);
    const correct = rotatePattern(clue, turns);
    const options = makeDistractors(clue, correct);
    options.splice(correctIndex, 0, correct);

    const turnLabels: Round["turn"][] = [
      "quarter turn",
      "half turn",
      "three-quarter turn",
    ];

    return {
      clue,
      options,
      correctIndex,
      turn: turnLabels[turns - 1],
    };
  });
}

export const ROUNDS = buildRounds();

export function describePattern(pattern: Pattern): string {
  const positions = [
    "top left",
    "top middle",
    "top right",
    "middle left",
    "center",
    "middle right",
    "bottom left",
    "bottom middle",
    "bottom right",
  ];

  const filled = pattern.flatMap((tile, index) =>
    tile === "empty" ? [] : [`${TILE_NAMES[tile]} at ${positions[index]}`],
  );

  return filled.join(", ");
}
