export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
export type Scaffold =
  | "silhouette"
  | "symbols"
  | "color"
  | "color-orientation"
  | "orientation"
  | "monochrome";
export type AccentColor = "coral" | "gold" | "teal" | "violet" | "ink";
export type Motif =
  | "none"
  | "chevron"
  | "star"
  | "diamond"
  | "circle"
  | "arrow";
export type StarterSymbol = "star" | "diamond" | "circle" | "arrow";
export type StarterSymbolInventory = Readonly<
  Record<StarterSymbol, number>
>;
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
  sourceRegion: number;
  hidden?: boolean;
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
  hiddenPatternCount: number;
  minimumInventoryCandidates: number;
  minimumPlacementGain: number;
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
    scaffold: "symbols",
    extraKind: "one-cell-near-miss",
    hiddenPatternCount: 0,
    minimumInventoryCandidates: 1,
    minimumPlacementGain: 0,
  },
  Medium: {
    boardSize: 5,
    regionSizes: [5, 5, 5, 5, 5],
    scaffold: "symbols",
    extraKind: "one-cell-near-miss",
    hiddenPatternCount: 0,
    minimumInventoryCandidates: 1,
    minimumPlacementGain: 0,
  },
  Hard: {
    boardSize: 5,
    regionSizes: [5, 5, 5, 5, 5],
    scaffold: "symbols",
    extraKind: "one-cell-near-miss",
    hiddenPatternCount: 4,
    minimumInventoryCandidates: 2,
    minimumPlacementGain: 2,
  },
  Wizard: {
    boardSize: 5,
    regionSizes: [5, 5, 5, 5, 5],
    scaffold: "symbols",
    extraKind: "one-cell-near-miss",
    hiddenPatternCount: 8,
    minimumInventoryCandidates: 3,
    minimumPlacementGain: 6,
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
const STARTER_SYMBOLS = [
  "star",
  "diamond",
  "circle",
  "arrow",
] as const satisfies readonly Motif[];
const STARTER_SYMBOL_TEMPLATES = [
  [
    "S", "S", "D", "A",
    "S", "D", "D", "A",
    "S", "C", "D", "A",
    "S", "C", "C", "C",
  ],
  [
    "S", "S", "S", "A",
    "S", "D", "S", "A",
    "D", "D", "C", "A",
    "D", "C", "C", "C",
  ],
  [
    "S", "S", "D", "D",
    "S", "C", "D", "A",
    "S", "C", "D", "A",
    "C", "C", "A", "A",
  ],
  [
    "S", "D", "D", "A",
    "S", "S", "D", "A",
    "C", "S", "D", "A",
    "C", "C", "C", "A",
  ],
] as const;
const FIVE_BY_FIVE_SYMBOL_TEMPLATES = [
  [
    "S", "S", "D", "D", "A",
    "S", "S", "D", "A", "A",
    "S", "C", "D", "D", "A",
    "C", "C", "C", "D", "A",
    "C", "C", "C", "A", "A",
  ],
  [
    "A", "A", "S", "S", "S",
    "A", "D", "D", "S", "C",
    "A", "D", "S", "S", "C",
    "A", "D", "D", "C", "C",
    "A", "A", "C", "C", "C",
  ],
  [
    "S", "D", "D", "A", "A",
    "S", "S", "D", "A", "C",
    "S", "D", "D", "A", "C",
    "S", "C", "C", "C", "C",
    "A", "A", "C", "D", "D",
  ],
  [
    "C", "C", "S", "S", "A",
    "C", "D", "S", "A", "A",
    "C", "D", "D", "S", "A",
    "C", "C", "D", "S", "A",
    "A", "A", "D", "S", "S",
  ],
] as const;

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
  const motifCode: Record<Motif, string> = {
    none: "-",
    chevron: "V",
    star: "S",
    diamond: "D",
    circle: "O",
    arrow: "A",
  };
  const directional =
    mark.motif === "chevron" || mark.motif === "arrow";
  return `${colorCode[mark.color]}${motifCode[mark.motif]}${
    directional ? mark.orientation : "-"
  }`;
}

function isStarterSymbol(motif: Motif): motif is StarterSymbol {
  return STARTER_SYMBOLS.includes(motif as StarterSymbol);
}

function emptyStarterInventory(): Record<StarterSymbol, number> {
  return { star: 0, diamond: 0, circle: 0, arrow: 0 };
}

export function starterSymbolInventory(
  cells: readonly Pick<PieceCell, "mark">[],
): StarterSymbolInventory {
  const inventory = emptyStarterInventory();
  for (const { mark } of cells) {
    if (isStarterSymbol(mark.motif)) {
      inventory[mark.motif] += 1;
    }
  }
  return inventory;
}

function starterInventoryKey(
  inventory: StarterSymbolInventory,
): string {
  return STARTER_SYMBOLS.map(
    (symbol) => `${symbol}:${inventory[symbol]}`,
  ).join("|");
}

export function starterInventoryResidual(
  round: Pick<ExtraPieceRound, "board" | "pieces">,
): StarterSymbolInventory | null {
  const residual = emptyStarterInventory();
  for (const piece of round.pieces) {
    const inventory = starterSymbolInventory(piece.cells);
    for (const symbol of STARTER_SYMBOLS) {
      residual[symbol] += inventory[symbol];
    }
  }
  const boardInventory = starterSymbolInventory(round.board);
  for (const symbol of STARTER_SYMBOLS) {
    residual[symbol] -= boardInventory[symbol];
    if (residual[symbol] < 0) return null;
  }
  return residual;
}

export function starterInventoryMatchIndexes(
  round: Pick<ExtraPieceRound, "board" | "pieces">,
): readonly number[] {
  const residual = starterInventoryResidual(round);
  if (!residual) return [];
  const residualKey = starterInventoryKey(residual);
  return round.pieces
    .map((piece, index) => ({
      index,
      key: starterInventoryKey(
        starterSymbolInventory(piece.cells),
      ),
    }))
    .filter(({ key }) => key === residualKey)
    .map(({ index }) => index);
}

export function hiddenPatternCount(
  round: Pick<ExtraPieceRound, "board">,
): number {
  return round.board.filter(({ hidden }) => hidden).length;
}

export function symbolInventoryCompatibleExtraIndexes(
  round: Pick<ExtraPieceRound, "board" | "pieces">,
): readonly number[] {
  const visibleBoard = round.board.filter(({ hidden }) => !hidden);
  const visibleInventory = starterSymbolInventory(visibleBoard);
  const visibleSymbolCount = STARTER_SYMBOLS.reduce(
    (total, symbol) => total + visibleInventory[symbol],
    0,
  );
  const unknownCount = hiddenPatternCount(round);

  return round.pieces
    .map((_, excludedIndex) => {
      const remaining = emptyStarterInventory();
      let remainingCellCount = 0;
      for (const [pieceIndex, piece] of round.pieces.entries()) {
        if (pieceIndex === excludedIndex) continue;
        remainingCellCount += piece.cells.length;
        const inventory = starterSymbolInventory(piece.cells);
        for (const symbol of STARTER_SYMBOLS) {
          remaining[symbol] += inventory[symbol];
        }
      }
      const canSupplyVisibleSymbols = STARTER_SYMBOLS.every(
        (symbol) => remaining[symbol] >= visibleInventory[symbol],
      );
      const hiddenRemainder = STARTER_SYMBOLS.reduce(
        (total, symbol) =>
          total + remaining[symbol] - visibleInventory[symbol],
        0,
      );
      return {
        excludedIndex,
        compatible:
          canSupplyVisibleSymbols &&
          visibleSymbolCount + unknownCount === remainingCellCount &&
          hiddenRemainder === unknownCount,
      };
    })
    .filter(({ compatible }) => compatible)
    .map(({ excludedIndex }) => excludedIndex);
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
  boardSize: 4 | 5,
  scaffold: Scaffold,
  random: RandomSource,
): readonly (readonly MutableCell[])[] {
  const symbolTemplates =
    boardSize === 4
      ? STARTER_SYMBOL_TEMPLATES
      : FIVE_BY_FIVE_SYMBOL_TEMPLATES;
  const symbolTemplate =
    symbolTemplates[randomIndex(symbolTemplates.length, random)];
  const symmetricSymbols =
    scaffold === "symbols"
      ? shuffled(
          ["star", "diamond", "circle"] as const,
          random,
        )
      : (["star", "diamond", "circle"] as const);
  const starterSymbolByCode: Readonly<Record<string, Motif>> = {
    S: symmetricSymbols[0],
    D: symmetricSymbols[1],
    C: symmetricSymbols[2],
    A: "arrow",
  };
  const arrowOrientation =
    scaffold === "symbols"
      ? (randomIndex(4, random) as QuarterTurn)
      : 0;

  return regions.map((region, regionIndex) =>
    region.map(({ x, y }, cellIndex) => {
      const color = "ink";
      if (scaffold === "symbols") {
        const code = symbolTemplate[y * boardSize + x];
        const motif = starterSymbolByCode[code] ?? "circle";
        return {
          x,
          y,
          mark: {
            color,
            motif,
            orientation: motif === "arrow" ? arrowOrientation : 0,
          },
        };
      }
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
  if (scaffold === "symbols") {
    return (
      left.motif === right.motif &&
      (left.motif !== "arrow" ||
        left.orientation === right.orientation)
    );
  }
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

function boardMap(
  round: Pick<ExtraPieceRound, "board">,
): Map<string, BoardCell> {
  return new Map(
    round.board.map((cell) => [cellCoordinateKey(cell), cell]),
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
          const targetCell = target.get(
            `${cell.x + offsetX},${cell.y + offsetY}`,
          );
          return (
            targetCell !== undefined &&
            (targetCell.hidden ||
              marksMatch(
                cell.mark,
                targetCell.mark,
                round.scaffold,
              ))
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

export function hiddenPlacementGain(
  round: Pick<
    ExtraPieceRound,
    "board" | "boardSize" | "pieces" | "scaffold"
  >,
): number {
  if (hiddenPatternCount(round) === 0) return 0;
  const fullyShownRound = {
    ...round,
    board: round.board.map((cell) => ({
      ...cell,
      hidden: false,
    })),
  };
  const visiblePlacements = round.pieces.reduce(
    (total, _, pieceIndex) =>
      total + enumeratePiecePlacements(round, pieceIndex).length,
    0,
  );
  const fullyShownPlacements = round.pieces.reduce(
    (total, _, pieceIndex) =>
      total +
      enumeratePiecePlacements(fullyShownRound, pieceIndex).length,
    0,
  );
  return visiblePlacements - fullyShownPlacements;
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

function relabelSymbolExtra(
  cells: readonly PieceCell[],
  usedPieces: readonly Piece[],
  random: RandomSource,
): PieceCell[] | null {
  const usedInventoryKeys = new Set(
    usedPieces.map((piece) =>
      starterInventoryKey(starterSymbolInventory(piece.cells)),
    ),
  );
  const candidates = shuffled(
    cells.flatMap((cell, cellIndex) =>
      STARTER_SYMBOLS.filter(
        (symbol) => symbol !== cell.mark.motif,
      ).map((symbol) => ({ cellIndex, symbol })),
    ),
    random,
  );

  for (const { cellIndex, symbol } of candidates) {
    const relabeled = cells.map((cell, index) =>
      index === cellIndex
        ? {
            ...cell,
            mark: {
              color: "ink" as const,
              motif: symbol,
              orientation:
                symbol === "arrow"
                  ? (randomIndex(4, random) as QuarterTurn)
                  : 0,
            },
          }
        : {
            ...cell,
            mark: { ...cell.mark },
          },
    );
    const key = starterInventoryKey(
      starterSymbolInventory(relabeled),
    );
    if (!usedInventoryKeys.has(key)) return relabeled;
  }
  return null;
}

function boardWithHiddenPatterns(
  round: ExtraPieceRound,
  count: number,
  minimumInventoryCandidates: number,
  minimumPlacementGain: number,
  random: RandomSource,
): readonly BoardCell[] | null {
  if (count === 0) return round.board;
  const extraInventory = starterSymbolInventory(
    round.pieces[round.correctIndex].cells,
  );
  const distractorIndexes = round.pieces
    .map((_, pieceIndex) => pieceIndex)
    .filter((pieceIndex) => pieceIndex !== round.correctIndex);

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const targetIndexes = shuffled(distractorIndexes, random).slice(
      0,
      Math.max(1, minimumInventoryCandidates - 1),
    );
    const required = emptyStarterInventory();
    for (const targetIndex of targetIndexes) {
      const targetInventory = starterSymbolInventory(
        round.pieces[targetIndex].cells,
      );
      for (const symbol of STARTER_SYMBOLS) {
        required[symbol] = Math.max(
          required[symbol],
          targetInventory[symbol] - extraInventory[symbol],
        );
      }
    }
    const requiredCount = STARTER_SYMBOLS.reduce(
      (total, symbol) => total + required[symbol],
      0,
    );
    if (requiredCount > count) continue;

    const hiddenIndexes = new Set<number>();
    let enoughRequiredCells = true;
    for (const symbol of STARTER_SYMBOLS) {
      const matchingIndexes = shuffled(
        round.board
          .map((cell, cellIndex) => ({ cell, cellIndex }))
          .filter(({ cell }) => cell.mark.motif === symbol)
          .map(({ cellIndex }) => cellIndex),
        random,
      );
      if (matchingIndexes.length < required[symbol]) {
        enoughRequiredCells = false;
        break;
      }
      for (
        let index = 0;
        index < required[symbol];
        index += 1
      ) {
        hiddenIndexes.add(matchingIndexes[index]);
      }
    }
    if (!enoughRequiredCells) continue;

    for (const cellIndex of shuffled(
      round.board.map((_, index) => index),
      random,
    )) {
      if (hiddenIndexes.size >= count) break;
      hiddenIndexes.add(cellIndex);
    }
    if (hiddenIndexes.size !== count) continue;

    const board = round.board.map((cell, cellIndex) => ({
      ...cell,
      hidden: hiddenIndexes.has(cellIndex),
    }));
    const hiddenCells = board.filter(({ hidden }) => hidden);
    const hiddenRegions = new Map<number, number>();
    for (const cell of hiddenCells) {
      hiddenRegions.set(
        cell.sourceRegion,
        (hiddenRegions.get(cell.sourceRegion) ?? 0) + 1,
      );
    }
    const maximumPerRegion = count <= 4 ? 1 : 2;
    if (
      hiddenRegions.size < 4 ||
      [...hiddenRegions.values()].some(
        (regionCount) => regionCount > maximumPerRegion,
      )
    ) {
      continue;
    }
    const visibleSymbols = starterSymbolInventory(
      board.filter(({ hidden }) => !hidden),
    );
    if (
      STARTER_SYMBOLS.some(
        (symbol) => visibleSymbols[symbol] < 2,
      )
    ) {
      continue;
    }
    const candidate = { ...round, board };
    const inventoryCandidates =
      symbolInventoryCompatibleExtraIndexes(candidate);
    if (
      inventoryCandidates.length < minimumInventoryCandidates ||
      !inventoryCandidates.includes(round.correctIndex) ||
      hiddenPlacementGain(candidate) < minimumPlacementGain
    ) {
      continue;
    }
    const possibleExtras = possibleExtraIndexes(candidate);
    if (
      possibleExtras.length === 1 &&
      possibleExtras[0] === round.correctIndex
    ) {
      return board;
    }
  }
  return null;
}

function rotateBoard(
  board: readonly BoardCell[],
  boardSize: number,
): BoardCell[] {
  return board
    .map((cell) => ({
      ...cell,
      x: boardSize - 1 - cell.y,
      y: cell.x,
      mark: {
        ...cell.mark,
        orientation: rotateOrientation(cell.mark.orientation, 1),
      },
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function boardKey(board: readonly BoardCell[]): string {
  return [...board]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map(({ hidden, mark }) => (hidden ? "?" : markKey(mark)))
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
  const markedRegions = marksForRegions(
    rawRegions,
    rules.boardSize,
    rules.scaffold,
    random,
  );
  const board = markedRegions
    .flatMap((region, sourceRegion) =>
      region.map(({ x, y, mark }) => ({
        x,
        y,
        mark: { ...mark },
        sourceRegion,
      })),
    )
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
  const rawExtraCells =
    rules.extraKind === "mirror-trap"
      ? reflectPieceCells(source.cells)
      : mutatePiece(source, random);
  const extraCells =
    rules.scaffold === "symbols" && rawExtraCells
      ? relabelSymbolExtra(
          rawExtraCells,
          solutionPieces,
          random,
        )
      : rawExtraCells;
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
  const fullyShownRound = {
    id: "candidate",
    difficulty,
    scaffold: rules.scaffold,
    boardSize: rules.boardSize,
    board,
    pieces: shuffledPieces,
    correctIndex,
    solution: [],
  } satisfies ExtraPieceRound;
  const possibleExtras = possibleExtraIndexes(fullyShownRound);
  if (
    possibleExtras.length !== 1 ||
    possibleExtras[0] !== correctIndex
  ) {
    return null;
  }
  if (
    (difficulty === "Easy" || difficulty === "Medium") &&
    (new Set(board.map(({ mark }) => mark.motif)).size !==
      STARTER_SYMBOLS.length ||
      starterInventoryMatchIndexes(fullyShownRound).length !== 1 ||
      starterInventoryMatchIndexes(fullyShownRound)[0] !== correctIndex)
  ) {
    return null;
  }
  if (difficulty === "Easy" || difficulty === "Medium") {
    const shapeOnlyRound = {
      ...fullyShownRound,
      scaffold: "silhouette" as const,
    };
    const forcedUsedPieces = fullyShownRound.pieces.filter(
      (_, pieceIndex) =>
        pieceIndex !== correctIndex &&
        enumeratePiecePlacements(fullyShownRound, pieceIndex).length === 1,
    ).length;
    if (
      possibleExtraIndexes(shapeOnlyRound).length < 2 ||
      forcedUsedPieces < 2
    ) {
      return null;
    }
  }
  const hiddenBoard = boardWithHiddenPatterns(
    fullyShownRound,
    rules.hiddenPatternCount,
    rules.minimumInventoryCandidates,
    rules.minimumPlacementGain,
    random,
  );
  if (!hiddenBoard) return null;
  const partialRound = {
    ...fullyShownRound,
    board: hiddenBoard,
  } satisfies ExtraPieceRound;
  const solutions = solveRound(
    partialRound,
    difficulty === "Easy" || difficulty === "Medium" ? 2 : 1,
    correctIndex,
  );
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
      .map((cell) => ({
        ...cell,
        x: base.boardSize - 1 - cell.x,
        mark: {
          ...cell.mark,
          orientation: ((4 - cell.mark.orientation) % 4) as QuarterTurn,
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
  const rules = DIFFICULTY_RULES[base.difficulty];
  if (
    symbolInventoryCompatibleExtraIndexes(partial).length <
      rules.minimumInventoryCandidates ||
    hiddenPlacementGain(partial) < rules.minimumPlacementGain
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
  if (
    rules.regionSizes.some(
      (regionSize, sourceRegion) =>
        round.board.filter(
          (cell) => cell.sourceRegion === sourceRegion,
        ).length !== regionSize,
    )
  ) {
    issues.push("The target board has invalid source-region metadata.");
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
    extra &&
    extra.extraKind !== rules.extraKind
  ) {
    issues.push("The extra-piece construction does not match the difficulty.");
  }
  if (
    hiddenPatternCount(round) !== rules.hiddenPatternCount
  ) {
    issues.push("The number of hidden patterns does not match the difficulty.");
  }
  if (
    round.board.some(
      ({ mark }) =>
        mark.color !== "ink" || !isStarterSymbol(mark.motif),
    ) ||
    round.pieces.some((piece) =>
      piece.cells.some(
        ({ mark }) =>
          mark.color !== "ink" || !isStarterSymbol(mark.motif),
      ),
    )
  ) {
    issues.push("Every level must use monochrome picture symbols.");
  }
  if (
    new Set(round.board.map(({ mark }) => mark.motif)).size !==
      STARTER_SYMBOLS.length
  ) {
    issues.push("Every target must show all four picture-symbol families.");
  }
  if (
    (round.difficulty === "Easy" || round.difficulty === "Medium") &&
    (starterInventoryMatchIndexes(round).length !== 1 ||
      starterInventoryMatchIndexes(round)[0] !== round.correctIndex)
  ) {
    issues.push(
      "Starter and Junior symbol subtraction must identify the extra without backtracking.",
    );
  }
  if (round.difficulty === "Easy" || round.difficulty === "Medium") {
    const shapeOnlyRound = {
      ...round,
      scaffold: "silhouette" as const,
    };
    if (possibleExtraIndexes(shapeOnlyRound).length < 2) {
      issues.push(
        "Introductory patterns must remove an ambiguity left by the silhouettes.",
      );
    }
    const forcedUsedPieces = round.pieces.filter(
      (_, pieceIndex) =>
        pieceIndex !== round.correctIndex &&
        enumeratePiecePlacements(round, pieceIndex).length === 1,
    ).length;
    if (forcedUsedPieces < 2) {
      issues.push(
        "Starter and Junior must offer at least two pattern-anchored pieces.",
      );
    }
    if (solveRound(round, 2, round.correctIndex).length !== 1) {
      issues.push(
        "Starter and Junior must confirm with one unambiguous marked tiling.",
      );
    }
  }
  if (round.difficulty === "Hard" || round.difficulty === "Wizard") {
    const hiddenRegions = new Map<number, number>();
    for (const cell of round.board.filter(({ hidden }) => hidden)) {
      hiddenRegions.set(
        cell.sourceRegion,
        (hiddenRegions.get(cell.sourceRegion) ?? 0) + 1,
      );
    }
    const maximumPerRegion =
      rules.hiddenPatternCount <= 4 ? 1 : 2;
    if (
      hiddenRegions.size < 4 ||
      [...hiddenRegions.values()].some(
        (count) => count > maximumPerRegion,
      )
    ) {
      issues.push(
        "Hidden patterns must be distributed across the tiling.",
      );
    }
    const visibleSymbols = starterSymbolInventory(
      round.board.filter(({ hidden }) => !hidden),
    );
    if (
      STARTER_SYMBOLS.some(
        (symbol) => visibleSymbols[symbol] < 2,
      )
    ) {
      issues.push(
        "Every picture-symbol family needs at least two visible clues.",
      );
    }
    const inventoryCandidates =
      symbolInventoryCompatibleExtraIndexes(round);
    if (
      inventoryCandidates.length < rules.minimumInventoryCandidates ||
      !inventoryCandidates.includes(round.correctIndex)
    ) {
      issues.push(
        "Hidden patterns must defeat simple symbol subtraction.",
      );
    }
    if (hiddenPlacementGain(round) < rules.minimumPlacementGain) {
      issues.push(
        "Hidden patterns must create additional plausible placements.",
      );
    }
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
  if (round.scaffold === "symbols") {
    const hasHiddenPatterns = hiddenPatternCount(round) > 0;
    const crossesUnknownPattern = placement.cells.some(({ x, y }) =>
      round.board.some(
        (cell) => cell.x === x && cell.y === y && cell.hidden,
      ),
    );
    const unknownCopy =
      hasHiddenPatterns && crossesUnknownPattern
        ? ", including across the ? cells"
        : "";
    return {
      placement,
      message: needsTurn
        ? `Piece ${selectedIndex + 1} fits the shown symbols after a turn${unknownCopy}, so the square still needs it.`
        : `Piece ${selectedIndex + 1} fits the shown symbols${unknownCopy}, so it is not the extra piece.`,
    };
  }
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
