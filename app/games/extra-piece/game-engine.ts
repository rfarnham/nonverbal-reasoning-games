export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
export type Scaffold =
  | "silhouette"
  | "color"
  | "color-orientation"
  | "orientation"
  | "monochrome";
export type AccentColor = "coral" | "gold" | "teal" | "violet" | "ink";
export type Motif = "none" | "chevron";
export type QuarterTurn = 0 | 1 | 2 | 3;
export type ExtraKind = "one-cell-near-miss" | "mirror-trap";

export type Mark = Readonly<{
  color: AccentColor;
  motif: Motif;
  orientation: QuarterTurn;
}>;

export type BoardCell = Readonly<{
  x: number;
  y: number;
  mark: Mark;
}>;

export type PieceCell = Readonly<{
  x: number;
  y: number;
  mark: Mark;
}>;

export type Piece = Readonly<{
  id: string;
  cells: readonly PieceCell[];
  sourceRegion: number;
  kind: "used" | "extra";
  extraKind?: ExtraKind;
}>;

export type PlacementCell = Readonly<{
  x: number;
  y: number;
}>;

export type PiecePlacement = Readonly<{
  pieceIndex: number;
  rotation: QuarterTurn;
  offsetX: number;
  offsetY: number;
  cells: readonly PlacementCell[];
}>;

export type ExtraPieceRound = Readonly<{
  id: string;
  difficulty: Difficulty;
  scaffold: Scaffold;
  boardSize: 4 | 5;
  board: readonly BoardCell[];
  pieces: readonly Piece[];
  correctIndex: number;
  solution: readonly PiecePlacement[];
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  issues: readonly string[];
}>;

export type WrongAttemptAnalysis = Readonly<{
  placement: PiecePlacement;
  message: string;
}>;

type MutableCell = {
  x: number;
  y: number;
  mark: Mark;
};

type RandomSource = () => number;

type DifficultyRules = Readonly<{
  boardSize: 4 | 5;
  regionSizes: readonly number[];
  scaffold: Scaffold;
  extraKind: ExtraKind;
}>;

export const DIFFICULTIES = [
  "Easy",
  "Medium",
  "Hard",
  "Wizard",
] as const;

export const DIFFICULTY_RULES: Readonly<
  Record<Difficulty, DifficultyRules>
> = {
  Easy: {
    boardSize: 4,
    regionSizes: [3, 4, 4, 5],
    scaffold: "silhouette",
    extraKind: "one-cell-near-miss",
  },
  Medium: {
    boardSize: 5,
    regionSizes: [5, 5, 5, 5, 5],
    scaffold: "orientation",
    extraKind: "one-cell-near-miss",
  },
  Hard: {
    boardSize: 5,
    regionSizes: [5, 5, 5, 5, 5],
    scaffold: "orientation",
    extraKind: "mirror-trap",
  },
  Wizard: {
    boardSize: 5,
    regionSizes: [5, 5, 5, 5, 5],
    scaffold: "monochrome",
    extraKind: "mirror-trap",
  },
};

export const GENERATOR_MAX_ATTEMPTS = 512;
const SOLUTION_LIMIT = 2;
const COLORS: readonly AccentColor[] = [
  "coral",
  "gold",
  "teal",
  "violet",
];

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999999, Math.max(0, value));
}

function randomIndex(length: number, random: RandomSource): number {
  return Math.floor(clampRandom(random()) * length);
}

function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [result[index], result[swapIndex]] = [
      result[swapIndex],
      result[index],
    ];
  }
  return result;
}

function cellCoordinateKey(cell: Pick<PieceCell, "x" | "y">): string {
  return `${cell.x},${cell.y}`;
}

function markKey(mark: Mark): string {
  const colorCode: Record<AccentColor, string> = {
    coral: "C",
    gold: "G",
    teal: "T",
    violet: "V",
    ink: "I",
  };
  return `${colorCode[mark.color]}${mark.motif === "chevron" ? mark.orientation : "-"}`;
}

function normalizeCells(cells: readonly PieceCell[]): PieceCell[] {
  const minX = Math.min(...cells.map(({ x }) => x));
  const minY = Math.min(...cells.map(({ y }) => y));
  return cells
    .map(({ x, y, mark }) => ({
      x: x - minX,
      y: y - minY,
      mark: { ...mark },
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function rotateOrientation(
  orientation: QuarterTurn,
  turns: QuarterTurn,
): QuarterTurn {
  return ((orientation + turns) % 4) as QuarterTurn;
}

export function rotatePieceCells(
  cells: readonly PieceCell[],
  turns: QuarterTurn,
): PieceCell[] {
  let transformed = cells.map(({ x, y, mark }) => ({
    x,
    y,
    mark: { ...mark },
  }));
  for (let turn = 0; turn < turns; turn += 1) {
    transformed = transformed.map(({ x, y, mark }) => ({
      x: -y,
      y: x,
      mark: {
        ...mark,
        orientation: rotateOrientation(mark.orientation, 1),
      },
    }));
  }
  return normalizeCells(transformed);
}

export function reflectPieceCells(
  cells: readonly PieceCell[],
): PieceCell[] {
  return normalizeCells(
    cells.map(({ x, y, mark }) => ({
      x: -x,
      y,
      mark: {
        ...mark,
        orientation: ((4 - mark.orientation) % 4) as QuarterTurn,
      },
    })),
  );
}

function rawPieceKey(cells: readonly PieceCell[], includeMarks: boolean) {
  return normalizeCells(cells)
    .map((cell) =>
      includeMarks
        ? `${cellCoordinateKey(cell)}:${markKey(cell.mark)}`
        : cellCoordinateKey(cell),
    )
    .join(";");
}

export function pieceCanonicalKey(
  cells: readonly PieceCell[],
  includeMarks = true,
): string {
  return [0, 1, 2, 3]
    .map((turns) =>
      rawPieceKey(
        rotatePieceCells(cells, turns as QuarterTurn),
        includeMarks,
      ),
    )
    .sort()[0];
}

export function isChiral(cells: readonly PieceCell[]): boolean {
  return (
    pieceCanonicalKey(cells, false) !==
    pieceCanonicalKey(reflectPieceCells(cells), false)
  );
}

function uniqueRotations(cells: readonly PieceCell[]): readonly {
  rotation: QuarterTurn;
  cells: readonly PieceCell[];
}[] {
  const seen = new Set<string>();
  const result: Array<{
    rotation: QuarterTurn;
    cells: readonly PieceCell[];
  }> = [];
  for (const rotation of [0, 1, 2, 3] as const) {
    const rotated = rotatePieceCells(cells, rotation);
    const key = rawPieceKey(rotated, true);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ rotation, cells: rotated });
  }
  return result;
}

function neighbors(
  x: number,
  y: number,
  size: number,
): readonly [number, number][] {
  const candidates: Array<[number, number]> = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  return candidates.filter(
    ([nextX, nextY]) =>
      nextX >= 0 && nextY >= 0 && nextX < size && nextY < size,
  );
}

function connectedCoordinates(
  cells: readonly Pick<PieceCell, "x" | "y">[],
): boolean {
  if (cells.length === 0) return false;
  const coordinates = new Set(cells.map(cellCoordinateKey));
  const seen = new Set<string>();
  const queue = [cells[0]];
  while (queue.length > 0) {
    const cell = queue.shift();
    if (!cell) break;
    const key = cellCoordinateKey(cell);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nextKey = `${cell.x + dx},${cell.y + dy}`;
      if (coordinates.has(nextKey) && !seen.has(nextKey)) {
        queue.push({ x: cell.x + dx, y: cell.y + dy });
      }
    }
  }
  return seen.size === cells.length;
}

function hamiltonianPath(
  size: number,
  random: RandomSource,
): readonly PlacementCell[] | null {
  const total = size * size;
  const starts = shuffled(
    Array.from({ length: total }, (_, index) => ({
      x: index % size,
      y: Math.floor(index / size),
    })),
    random,
  );

  for (const start of starts) {
    const path: PlacementCell[] = [start];
    const visited = new Set([cellCoordinateKey(start)]);

    const search = (): boolean => {
      if (path.length === total) return true;
      const current = path[path.length - 1];
      const candidates = neighbors(current.x, current.y, size)
        .filter(([x, y]) => !visited.has(`${x},${y}`))
        .map(([x, y]) => {
          const onward = neighbors(x, y, size).filter(
            ([nextX, nextY]) => !visited.has(`${nextX},${nextY}`),
          ).length;
          return { x, y, onward, tie: clampRandom(random()) };
        })
        .sort(
          (left, right) =>
            left.onward - right.onward || left.tie - right.tie,
        );

      for (const candidate of candidates) {
        const key = cellCoordinateKey(candidate);
        visited.add(key);
        path.push({ x: candidate.x, y: candidate.y });
        if (search()) return true;
        path.pop();
        visited.delete(key);
      }
      return false;
    };

    if (search()) return path;
  }
  return null;
}

function marksForRegions(
  regions: readonly (readonly PlacementCell[])[],
  scaffold: Scaffold,
): readonly (readonly MutableCell[])[] {
  return regions.map((region, regionIndex) =>
    region.map(({ x, y }, cellIndex) => {
      const color = "ink";
      const showMotif =
        scaffold === "color-orientation" ||
        scaffold === "orientation" ||
        scaffold === "monochrome";
      const motifVisible =
        scaffold === "monochrome"
          ? (cellIndex + regionIndex) % 3 === 0
          : (cellIndex + regionIndex) % 3 !== 1;
      return {
        x,
        y,
        mark: {
          color,
          motif: showMotif && motifVisible
            ? "chevron"
            : "none",
          orientation: ((x + y * 2 + regionIndex) % 4) as QuarterTurn,
        },
      };
    }),
  );
}

function marksMatch(left: Mark, right: Mark, scaffold: Scaffold): boolean {
  if (scaffold === "silhouette") return true;
  if (
    (scaffold === "color" || scaffold === "color-orientation") &&
    left.color !== right.color
  ) {
    return false;
  }
  if (
    scaffold === "color-orientation" ||
    scaffold === "orientation" ||
    scaffold === "monochrome"
  ) {
    return (
      left.motif === right.motif &&
      (left.motif === "none" || left.orientation === right.orientation)
    );
  }
  return true;
}

function boardMap(round: Pick<ExtraPieceRound, "board">): Map<string, Mark> {
  return new Map(
    round.board.map((cell) => [cellCoordinateKey(cell), cell.mark]),
  );
}

export function enumeratePiecePlacements(
  round: Pick<
    ExtraPieceRound,
    "board" | "boardSize" | "pieces" | "scaffold"
  >,
  pieceIndex: number,
): readonly PiecePlacement[] {
  const piece = round.pieces[pieceIndex];
  if (!piece) return [];
  const target = boardMap(round);
  const placements: PiecePlacement[] = [];
  const seen = new Set<string>();

  for (const { rotation, cells } of uniqueRotations(piece.cells)) {
    const width = Math.max(...cells.map(({ x }) => x)) + 1;
    const height = Math.max(...cells.map(({ y }) => y)) + 1;
    for (
      let offsetY = 0;
      offsetY <= round.boardSize - height;
      offsetY += 1
    ) {
      for (
        let offsetX = 0;
        offsetX <= round.boardSize - width;
        offsetX += 1
      ) {
        const matches = cells.every((cell) => {
          const targetMark = target.get(
            `${cell.x + offsetX},${cell.y + offsetY}`,
          );
          return (
            targetMark !== undefined &&
            marksMatch(cell.mark, targetMark, round.scaffold)
          );
        });
        if (!matches) continue;
        const placementCells = cells
          .map(({ x, y }) => ({
            x: x + offsetX,
            y: y + offsetY,
          }))
          .sort((left, right) => left.y - right.y || left.x - right.x);
        const key = placementCells.map(cellCoordinateKey).join(";");
        if (seen.has(key)) continue;
        seen.add(key);
        placements.push({
          pieceIndex,
          rotation,
          offsetX,
          offsetY,
          cells: placementCells,
        });
      }
    }
  }
  return placements;
}

export function solveRound(
  round: Pick<
    ExtraPieceRound,
    "board" | "boardSize" | "pieces" | "scaffold"
  >,
  limit = SOLUTION_LIMIT,
  excludedPieceIndex?: number,
): readonly (readonly PiecePlacement[])[] {
  const fullMask = (1 << (round.boardSize * round.boardSize)) - 1;
  const placements = round.pieces.flatMap((_, pieceIndex) =>
    enumeratePiecePlacements(round, pieceIndex).map((placement) => ({
      placement,
      mask: placement.cells.reduce(
        (mask, { x, y }) =>
          mask | (1 << (y * round.boardSize + x)),
        0,
      ),
    })),
  );
  const byCell = Array.from(
    { length: round.boardSize * round.boardSize },
    (_, index) =>
      placements.filter(({ mask }) => (mask & (1 << index)) !== 0),
  );
  const solutions: Array<readonly PiecePlacement[]> = [];

  const search = (
    occupiedMask: number,
    usedPieces: number,
    selected: readonly PiecePlacement[],
  ) => {
    if (solutions.length >= limit) return;
    if (occupiedMask === fullMask) {
      if (selected.length === round.pieces.length - 1) {
        solutions.push(selected);
      }
      return;
    }
    if (selected.length >= round.pieces.length - 1) return;

    let bestCell = -1;
    let bestCandidates:
      | readonly {
          placement: PiecePlacement;
          mask: number;
        }[]
      | null = null;
    for (
      let cellIndex = 0;
      cellIndex < round.boardSize * round.boardSize;
      cellIndex += 1
    ) {
      if ((occupiedMask & (1 << cellIndex)) !== 0) continue;
      const candidates = byCell[cellIndex].filter(
        ({ placement, mask }) =>
          (mask & occupiedMask) === 0 &&
          (usedPieces & (1 << placement.pieceIndex)) === 0,
      );
      if (candidates.length === 0) return;
      if (bestCandidates === null || candidates.length < bestCandidates.length) {
        bestCell = cellIndex;
        bestCandidates = candidates;
      }
    }
    if (bestCell < 0 || bestCandidates === null) return;

    for (const { placement, mask } of bestCandidates) {
      search(
        occupiedMask | mask,
        usedPieces | (1 << placement.pieceIndex),
        [...selected, placement],
      );
      if (solutions.length >= limit) return;
    }
  };

  search(
    0,
    excludedPieceIndex === undefined ? 0 : 1 << excludedPieceIndex,
    [],
  );
  return solutions;
}

export function possibleExtraIndexes(
  round: Pick<
    ExtraPieceRound,
    "board" | "boardSize" | "pieces" | "scaffold"
  >,
): readonly number[] {
  return round.pieces
    .map((_, pieceIndex) => pieceIndex)
    .filter(
      (pieceIndex) =>
        solveRound(round, 1, pieceIndex).length === 1,
    );
}

function mutatePiece(
  piece: Piece,
  random: RandomSource,
): PieceCell[] | null {
  const normalized = normalizeCells(piece.cells);
  const occupied = new Set(normalized.map(cellCoordinateKey));
  const removals = shuffled(normalized, random);
  for (const removed of removals) {
    const remaining = normalized.filter(
      (cell) => cellCoordinateKey(cell) !== cellCoordinateKey(removed),
    );
    if (!connectedCoordinates(remaining)) continue;
    const candidateCoordinates = new Map<string, PlacementCell>();
    for (const cell of remaining) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        const key = cellCoordinateKey(next);
        if (!occupied.has(key)) candidateCoordinates.set(key, next);
      }
    }
    for (const added of shuffled(
      [...candidateCoordinates.values()],
      random,
    )) {
      const mutated = normalizeCells([
        ...remaining,
        { ...added, mark: { ...removed.mark } },
      ]);
      if (
        pieceCanonicalKey(mutated, false) !==
          pieceCanonicalKey(normalized, false) &&
        connectedCoordinates(mutated)
      ) {
        return mutated;
      }
    }
  }
  return null;
}

function rotateBoard(
  board: readonly BoardCell[],
  boardSize: number,
): BoardCell[] {
  return board
    .map(({ x, y, mark }) => ({
      x: boardSize - 1 - y,
      y: x,
      mark: {
        ...mark,
        orientation: rotateOrientation(mark.orientation, 1),
      },
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function boardKey(board: readonly BoardCell[]): string {
  return [...board]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map(({ mark }) => markKey(mark))
    .join("");
}

export function roundFingerprint(
  round: Pick<
    ExtraPieceRound,
    "board" | "boardSize" | "pieces" | "scaffold"
  >,
): string {
  let rotated = [...round.board];
  const boardKeys: string[] = [];
  for (let turn = 0; turn < 4; turn += 1) {
    boardKeys.push(boardKey(rotated));
    rotated = rotateBoard(rotated, round.boardSize);
  }
  const pieceKeys = round.pieces
    .map((piece) =>
      pieceCanonicalKey(piece.cells, true),
    )
    .sort()
    .join("|");
  return `${round.boardSize}:${round.scaffold}:${boardKeys.sort()[0]}:${pieceKeys}`;
}

export function buildCandidate(
  difficulty: Difficulty,
  random: RandomSource,
  desiredCorrectIndex?: number,
): ExtraPieceRound | null {
  const rules = DIFFICULTY_RULES[difficulty];
  const path = hamiltonianPath(rules.boardSize, random);
  if (!path) return null;
  let regionOffset = 0;
  const rawRegions = rules.regionSizes.map((regionSize) => {
    const region = path.slice(regionOffset, regionOffset + regionSize);
    regionOffset += regionSize;
    return region;
  });
  const markedRegions = marksForRegions(rawRegions, rules.scaffold);
  const board = markedRegions
    .flat()
    .map(({ x, y, mark }) => ({ x, y, mark: { ...mark } }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const solutionPieces: Piece[] = markedRegions.map((region, regionIndex) => {
    const inputRotation = randomIndex(4, random) as QuarterTurn;
    return {
      id: `region-${regionIndex}`,
      cells: rotatePieceCells(normalizeCells(region), inputRotation),
      sourceRegion: regionIndex,
      kind: "used",
    };
  });

  const geometryKeys = solutionPieces.map((piece) =>
    pieceCanonicalKey(piece.cells, true),
  );
  if (new Set(geometryKeys).size !== geometryKeys.length) return null;

  const areaCounts = new Map<number, number>();
  for (const piece of solutionPieces) {
    areaCounts.set(
      piece.cells.length,
      (areaCounts.get(piece.cells.length) ?? 0) + 1,
    );
  }
  const extraSources =
    rules.extraKind === "mirror-trap"
      ? solutionPieces.filter((piece) => isChiral(piece.cells))
      : difficulty === "Easy"
        ? solutionPieces.filter(
            (piece) => (areaCounts.get(piece.cells.length) ?? 0) > 1,
          )
        : solutionPieces;
  if (extraSources.length === 0) return null;
  const source = extraSources[randomIndex(extraSources.length, random)];
  const extraCells =
    rules.extraKind === "mirror-trap"
      ? reflectPieceCells(source.cells)
      : mutatePiece(source, random);
  if (!extraCells) return null;
  const rotatedExtra = rotatePieceCells(
    extraCells,
    randomIndex(4, random) as QuarterTurn,
  );
  const extra: Piece = {
    id: "extra",
    cells: rotatedExtra,
    sourceRegion: source.sourceRegion,
    kind: "extra",
    extraKind: rules.extraKind,
  };
  const allCanonicalKeys = [...solutionPieces, extra].map((piece) =>
    pieceCanonicalKey(piece.cells, true),
  );
  if (new Set(allCanonicalKeys).size !== allCanonicalKeys.length) return null;

  const shuffledPieces = shuffled([...solutionPieces, extra], random);
  if (desiredCorrectIndex !== undefined) {
    const currentExtraIndex = shuffledPieces.findIndex(
      ({ kind }) => kind === "extra",
    );
    const boundedDesired =
      desiredCorrectIndex % shuffledPieces.length;
    [shuffledPieces[currentExtraIndex], shuffledPieces[boundedDesired]] = [
      shuffledPieces[boundedDesired],
      shuffledPieces[currentExtraIndex],
    ];
  }
  const correctIndex = shuffledPieces.findIndex(
    ({ kind }) => kind === "extra",
  );
  const partialRound = {
    id: "candidate",
    difficulty,
    scaffold: rules.scaffold,
    boardSize: rules.boardSize,
    board,
    pieces: shuffledPieces,
    correctIndex,
    solution: [],
  } satisfies ExtraPieceRound;
  const possibleExtras = possibleExtraIndexes(partialRound);
  if (
    possibleExtras.length !== 1 ||
    possibleExtras[0] !== correctIndex
  ) {
    return null;
  }
  const solutions = solveRound(partialRound, 1, correctIndex);
  if (solutions.length !== 1) return null;

  return {
    ...partialRound,
    solution: solutions[0],
  };
}

export class PuzzleGenerationError extends Error {
  constructor(difficulty: Difficulty) {
    super(`Could not build a valid ${difficulty} Extra Piece puzzle.`);
    this.name = "PuzzleGenerationError";
  }
}

function buildInfiniteVariant(
  base: ExtraPieceRound,
  random: RandomSource,
): ExtraPieceRound | null {
  const regionByCoordinate = new Map<string, number>();
  for (const placement of base.solution) {
    const sourceRegion =
      base.pieces[placement.pieceIndex]?.sourceRegion;
    if (sourceRegion === undefined) return null;
    for (const cell of placement.cells) {
      regionByCoordinate.set(cellCoordinateKey(cell), sourceRegion);
    }
  }
  if (
    regionByCoordinate.size !==
    base.boardSize * base.boardSize
  ) {
    return null;
  }

  const colorPermutation = shuffled(COLORS, random);
  const regionTurns = Array.from(
    { length: base.boardSize },
    () => randomIndex(4, random) as QuarterTurn,
  );
  const transformMark = (mark: Mark, region: number): Mark => ({
    color:
      base.scaffold === "color" ||
      base.scaffold === "color-orientation"
        ? colorPermutation[
            Math.max(0, COLORS.indexOf(mark.color))
          ]
        : "ink",
    motif: mark.motif,
    orientation: rotateOrientation(
      mark.orientation,
      regionTurns[region],
    ),
  });
  let board = base.board.map((cell) => {
    const region = regionByCoordinate.get(cellCoordinateKey(cell));
    if (region === undefined) return cell;
    return {
      ...cell,
      mark: transformMark(cell.mark, region),
    };
  });
  let pieces = base.pieces.map((piece) => ({
    ...piece,
    cells: piece.cells.map((cell) => ({
      ...cell,
      mark: transformMark(cell.mark, piece.sourceRegion),
    })),
  }));

  if (randomIndex(2, random) === 1) {
    board = board
      .map(({ x, y, mark }) => ({
        x: base.boardSize - 1 - x,
        y,
        mark: {
          ...mark,
          orientation: ((4 - mark.orientation) % 4) as QuarterTurn,
        },
      }))
      .sort((left, right) => left.y - right.y || left.x - right.x);
    pieces = pieces.map((piece) => ({
      ...piece,
      cells: reflectPieceCells(piece.cells),
    }));
  }

  const inputRotatedPieces = pieces.map((piece) => ({
    ...piece,
    cells: rotatePieceCells(
      piece.cells,
      randomIndex(4, random) as QuarterTurn,
    ),
  }));
  const orderedPieces = shuffled(inputRotatedPieces, random);
  const visualKeys = orderedPieces.map((piece) =>
    pieceCanonicalKey(piece.cells, true),
  );
  if (new Set(visualKeys).size !== visualKeys.length) return null;
  const correctIndex = orderedPieces.findIndex(
    ({ kind }) => kind === "extra",
  );
  const partial = {
    ...base,
    id: "infinite-candidate",
    board,
    pieces: orderedPieces,
    correctIndex,
    solution: [],
  } satisfies ExtraPieceRound;
  const possibleExtras = possibleExtraIndexes(partial);
  if (
    possibleExtras.length !== 1 ||
    possibleExtras[0] !== correctIndex
  ) {
    return null;
  }
  const solution = solveRound(partial, 1, correctIndex)[0];
  return solution ? { ...partial, solution } : null;
}

export function generateInfiniteRound(
  difficulty: Difficulty,
  random: RandomSource = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): ExtraPieceRound {
  const bases = ROUNDS.filter(
    (round) => round.difficulty === difficulty,
  );
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const base = bases[randomIndex(bases.length, random)];
    const candidate = base
      ? buildInfiniteVariant(base, random)
      : null;
    if (!candidate) continue;
    const fingerprint = roundFingerprint(candidate);
    if (excludedFingerprints.has(fingerprint)) continue;
    return {
      ...candidate,
      id: `infinite:${difficulty.toLowerCase()}:${fingerprint}`,
    };
  }
  throw new PuzzleGenerationError(difficulty);
}

function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const EASY_SCHEDULE = [0, 1, 2, 3, 4, 0, 2, 4, 1, 3, 0, 1] as const;
const SIX_OPTION_SCHEDULE = [0, 1, 2, 3, 4, 5, 1, 3, 5, 0, 2, 4] as const;

export function buildAuthoredRounds(
  seedOffset = 0,
): readonly ExtraPieceRound[] {
  const rounds: ExtraPieceRound[] = [];
  const usedFingerprints = new Set<string>();
  for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
    const schedule =
      difficulty === "Easy" ? EASY_SCHEDULE : SIX_OPTION_SCHEDULE;
    for (let index = 0; index < 12; index += 1) {
      const seed =
        73_001 +
        seedOffset * 20_011 +
        difficultyIndex * 50_021 +
        index * 1_009;
      const random = seededRandom(seed);
      let round: ExtraPieceRound | null = null;
      for (
        let attempt = 0;
        attempt < GENERATOR_MAX_ATTEMPTS && round === null;
        attempt += 1
      ) {
        const candidate = buildCandidate(
          difficulty,
          random,
          schedule[index],
        );
        if (
          candidate &&
          !usedFingerprints.has(roundFingerprint(candidate))
        ) {
          round = candidate;
        }
      }
      if (!round) throw new PuzzleGenerationError(difficulty);
      const fingerprint = roundFingerprint(round);
      usedFingerprints.add(fingerprint);
      rounds.push({
        ...round,
        id: `campaign:${difficulty.toLowerCase()}:${String(index + 1).padStart(2, "0")}`,
      });
    }
  }
  return Object.freeze(rounds);
}

export function validateRound(round: ExtraPieceRound): ValidationResult {
  const issues: string[] = [];
  const rules = DIFFICULTY_RULES[round.difficulty];
  if (round.boardSize !== rules.boardSize) {
    issues.push("Board size does not match the difficulty.");
  }
  if (round.scaffold !== rules.scaffold) {
    issues.push("Scaffold does not match the difficulty.");
  }
  if (round.board.length !== round.boardSize * round.boardSize) {
    issues.push("The target board must be completely filled.");
  }
  if (new Set(round.board.map(cellCoordinateKey)).size !== round.board.length) {
    issues.push("The target board contains duplicate cells.");
  }
  if (round.pieces.length !== round.boardSize + 1) {
    issues.push("There must be exactly one more piece than the square uses.");
  }
  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex >= round.pieces.length
  ) {
    issues.push("The correct option index is out of range.");
  }
  for (const [index, piece] of round.pieces.entries()) {
    if (piece.cells.length < 3 || piece.cells.length > 5) {
      issues.push(`Piece ${index + 1} has an unsuitable area.`);
    }
    if (!connectedCoordinates(piece.cells)) {
      issues.push(`Piece ${index + 1} is disconnected.`);
    }
  }
  const expectedAreas = [...rules.regionSizes].sort(
    (left, right) => left - right,
  );
  const usedAreas = round.pieces
    .filter((_, index) => index !== round.correctIndex)
    .map(({ cells }) => cells.length)
    .sort((left, right) => left - right);
  if (
    expectedAreas.length !== usedAreas.length ||
    expectedAreas.some((area, index) => usedAreas[index] !== area)
  ) {
    issues.push("The used piece areas do not match the difficulty.");
  }
  const pieceKeys = round.pieces.map((piece) =>
    pieceCanonicalKey(piece.cells, true),
  );
  if (new Set(pieceKeys).size !== pieceKeys.length) {
    issues.push("Candidate pieces must be mutually distinct.");
  }
  const possibleExtras = possibleExtraIndexes(round);
  if (
    possibleExtras.length !== 1 ||
    possibleExtras[0] !== round.correctIndex
  ) {
    issues.push("The declared extra piece is not uniquely excluded.");
  }
  const solution = solveRound(round, 1, round.correctIndex)[0];
  if (!solution) {
    issues.push("The remaining pieces do not tile the square.");
  } else {
    const storedPieceIndexes = round.solution.map(
      ({ pieceIndex }) => pieceIndex,
    );
    const storedCells = round.solution.flatMap(({ cells }) =>
      cells.map(cellCoordinateKey),
    );
    if (
      round.solution.length !== round.pieces.length - 1 ||
      new Set(storedPieceIndexes).size !== round.pieces.length - 1 ||
      storedPieceIndexes.includes(round.correctIndex) ||
      storedCells.length !== round.boardSize * round.boardSize ||
      new Set(storedCells).size !== storedCells.length
    ) {
      issues.push("The stored teaching solution is not a complete tiling.");
    }
    for (const placement of round.solution) {
      const legal = enumeratePiecePlacements(
        round,
        placement.pieceIndex,
      ).some(
        (candidate) =>
          candidate.cells.map(cellCoordinateKey).join(";") ===
          placement.cells.map(cellCoordinateKey).join(";"),
      );
      if (!legal) {
        issues.push("The stored teaching solution contains an illegal placement.");
        break;
      }
    }
  }
  const extra = round.pieces[round.correctIndex];
  if (!extra || extra.kind !== "extra") {
    issues.push("The correct option must be the authored extra.");
  }
  const extraSource = round.pieces.find(
    (piece) =>
      piece.kind === "used" &&
      piece.sourceRegion === extra?.sourceRegion,
  );
  if (
    extra &&
    (!extraSource || extraSource.cells.length !== extra.cells.length)
  ) {
    issues.push("The extra must be an equal-area near-match.");
  }
  if (
    (round.difficulty === "Hard" || round.difficulty === "Wizard") &&
    (extra?.extraKind !== "mirror-trap" || !isChiral(extra.cells))
  ) {
    issues.push("Advanced rounds require a genuinely chiral mirror trap.");
  }
  if (
    round.difficulty === "Wizard" &&
    round.board.some(({ mark }) => mark.color !== "ink")
  ) {
    issues.push("Wizard must use one monochrome ink treatment.");
  }
  if (
    round.difficulty === "Wizard" &&
    round.board.filter(({ mark }) => mark.motif === "chevron").length > 10
  ) {
    issues.push("Wizard must keep its orientation scaffold sparse.");
  }
  if (
    round.difficulty === "Easy" &&
    round.board.some(
      ({ mark }) => mark.color !== "ink" || mark.motif !== "none",
    )
  ) {
    issues.push("Starter must use clean monochrome silhouettes.");
  }
  return { valid: issues.length === 0, issues };
}

export function analyzeWrongAttempt(
  round: ExtraPieceRound,
  selectedIndex: number,
): WrongAttemptAnalysis {
  const placement = round.solution.find(
    ({ pieceIndex }) => pieceIndex === selectedIndex,
  );
  if (!placement) {
    throw new Error("The selected piece is not part of the solved tiling.");
  }
  const needsTurn = placement.rotation !== 0;
  return {
    placement,
    message: needsTurn
      ? `Piece ${selectedIndex + 1} fits after a turn, so it belongs in the square.`
      : `Piece ${selectedIndex + 1} fits the square, so it is not the extra piece.`,
  };
}

export function pieceBounds(piece: Piece): Readonly<{
  width: number;
  height: number;
}> {
  const normalized = normalizeCells(piece.cells);
  return {
    width: Math.max(...normalized.map(({ x }) => x)) + 1,
    height: Math.max(...normalized.map(({ y }) => y)) + 1,
  };
}

export const ROUNDS = buildAuthoredRounds();
export const TUTORIAL = ROUNDS[0];
