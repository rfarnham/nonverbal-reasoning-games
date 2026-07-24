export type Difficulty = "Starter" | "Junior" | "Expert" | "Wizard";

/**
 * A 3x3 pip field stored as a nine-bit row-major mask. Bit zero is the
 * top-left dot and bit eight is the bottom-right dot.
 */
export type PipMask = number;

export type DominoPiece = {
  id: string;
  first: PipMask;
  second: PipMask;
};

export type GridRows = 2;
export type GridColumns = 2 | 3;

export type TargetShapeId =
  | "2x2-rect"
  | "2x3-rect";

export type TargetShape = {
  id: TargetShapeId;
  rows: GridRows;
  columns: GridColumns;
  /** Row-major indexes occupied by the rectangular target. */
  occupiedCells: readonly number[];
};

export type LayoutId =
  | "2x2-rows"
  | "2x2-columns"
  | "2x3-columns"
  | "2x3-left-stack"
  | "2x3-right-stack";

export type TilingLayout = {
  id: LayoutId;
  targetShapeId: TargetShapeId;
  rows: GridRows;
  columns: GridColumns;
  pairs: readonly (readonly [number, number])[];
};

export type PlacedDomino = {
  pieceId: string;
  /** Cell holding the piece's `first` half after rotation. */
  fromCell: number;
  /** Cell holding the piece's `second` half after rotation. */
  toCell: number;
  /** Clockwise quarter turns applied to the source domino. */
  quarterTurns: 0 | 1 | 2 | 3;
};

export type BuildWitness = {
  layoutId: LayoutId;
  placements: readonly PlacedDomino[];
};

export type DominoDesign = {
  /** Null grid positions are holes outside a non-rectangular target. */
  cells: readonly (PipMask | null)[];
};

export type MismatchKind =
  | "seam-trap"
  | "twisted-half"
  | "twisted-pair"
  | "broken-pair";

export type MismatchAnalysis = {
  kind: MismatchKind;
  /** The smallest local edit that would turn this into a buildable design. */
  differingCells: readonly number[];
  matchedPieces: number;
  closestBuildable: DominoDesign;
  closestWitness: BuildWitness;
  message: string;
};

export type DominoOption = {
  design: DominoDesign;
  buildable: boolean;
  kind: "buildable" | MismatchKind;
  witness: BuildWitness | null;
  mismatch: MismatchAnalysis | null;
};

export type DominoRound = {
  id: string;
  difficulty: Difficulty;
  pieces: readonly DominoPiece[];
  targetShapeId: TargetShapeId;
  rows: GridRows;
  columns: GridColumns;
  /** Null means the seams are hidden and every legal tiling is allowed. */
  layoutId: LayoutId | null;
  seamsVisible: boolean;
  options: readonly DominoOption[];
  /** The one option that cannot be built. */
  correctIndex: number;
  prompt: "Which design cannot be built?";
};

export type ReachableDesign = {
  design: DominoDesign;
  witnesses: readonly BuildWitness[];
};

export type DifficultyRule = {
  targetShapeIds: readonly TargetShapeId[];
  pieceCount: 2 | 3;
  seamsVisible: boolean;
  minDirectionalHalves: number;
  maxDirectionalHalves: number;
  minDistinctHalves: number;
  maxDistinctHalves: number;
  minReachableDesigns: number;
};

const bit = (row: number, column: number) => 1 << (row * 3 + column);

/**
 * The simple family is quarter-turn invariant. Directional patterns change
 * visibly when their domino turns, so the rendered motion remains truthful.
 */
export const PIP_PATTERNS = {
  center: bit(1, 1),
  corners: bit(0, 0) | bit(0, 2) | bit(2, 0) | bit(2, 2),
  edges: bit(0, 1) | bit(1, 0) | bit(1, 2) | bit(2, 1),
  "center-corners":
    bit(1, 1) | bit(0, 0) | bit(0, 2) | bit(2, 0) | bit(2, 2),
  "center-edges":
    bit(1, 1) | bit(0, 1) | bit(1, 0) | bit(1, 2) | bit(2, 1),
  ring:
    bit(0, 0) |
    bit(0, 1) |
    bit(0, 2) |
    bit(1, 0) |
    bit(1, 2) |
    bit(2, 0) |
    bit(2, 1) |
    bit(2, 2),
  all: (1 << 9) - 1,
  "diag-two": bit(0, 0) | bit(2, 2),
  "diag-three": bit(0, 0) | bit(1, 1) | bit(2, 2),
  "top-pair": bit(0, 0) | bit(0, 2),
  "corner-l": bit(0, 0) | bit(0, 1) | bit(1, 0),
  "edge-single": bit(0, 1),
  "corner-single": bit(0, 0),
  "top-bar": bit(0, 0) | bit(0, 1) | bit(0, 2),
  six:
    bit(0, 0) |
    bit(0, 2) |
    bit(1, 0) |
    bit(1, 2) |
    bit(2, 0) |
    bit(2, 2),
} as const;

export type PipPatternName = keyof typeof PIP_PATTERNS;

const SIMPLE_PATTERN_NAMES = [
  "center",
  "corners",
  "edges",
  "center-corners",
  "center-edges",
  "ring",
  "all",
] as const satisfies readonly PipPatternName[];

const DIRECTIONAL_PATTERN_NAMES = [
  "diag-two",
  "diag-three",
  "top-pair",
  "corner-l",
  "edge-single",
  "corner-single",
  "top-bar",
  "six",
] as const satisfies readonly PipPatternName[];

const DIAGONAL_PATTERN_NAMES = [
  "diag-two",
  "diag-three",
] as const satisfies readonly PipPatternName[];

const PHASE_PATTERN_NAMES = [
  "top-pair",
  "corner-l",
  "edge-single",
  "corner-single",
  "top-bar",
] as const satisfies readonly PipPatternName[];

const JUNIOR_SUPPORT_PATTERN_NAMES = [
  "top-pair",
  "corner-l",
  "top-bar",
] as const satisfies readonly PipPatternName[];

export const TARGET_SHAPES: Readonly<Record<TargetShapeId, TargetShape>> = {
  "2x2-rect": {
    id: "2x2-rect",
    rows: 2,
    columns: 2,
    occupiedCells: [0, 1, 2, 3],
  },
  "2x3-rect": {
    id: "2x3-rect",
    rows: 2,
    columns: 3,
    occupiedCells: [0, 1, 2, 3, 4, 5],
  },
};

export const TILING_LAYOUTS: Readonly<Record<LayoutId, TilingLayout>> = {
  "2x2-rows": {
    id: "2x2-rows",
    targetShapeId: "2x2-rect",
    rows: 2,
    columns: 2,
    pairs: [
      [0, 1],
      [2, 3],
    ],
  },
  "2x2-columns": {
    id: "2x2-columns",
    targetShapeId: "2x2-rect",
    rows: 2,
    columns: 2,
    pairs: [
      [0, 2],
      [1, 3],
    ],
  },
  "2x3-columns": {
    id: "2x3-columns",
    targetShapeId: "2x3-rect",
    rows: 2,
    columns: 3,
    pairs: [
      [0, 3],
      [1, 4],
      [2, 5],
    ],
  },
  "2x3-left-stack": {
    id: "2x3-left-stack",
    targetShapeId: "2x3-rect",
    rows: 2,
    columns: 3,
    pairs: [
      [0, 1],
      [3, 4],
      [2, 5],
    ],
  },
  "2x3-right-stack": {
    id: "2x3-right-stack",
    targetShapeId: "2x3-rect",
    rows: 2,
    columns: 3,
    pairs: [
      [0, 3],
      [1, 2],
      [4, 5],
    ],
  },
};

export const DIFFICULTY_RULES: Readonly<
  Record<Difficulty, DifficultyRule>
> = {
  Starter: {
    targetShapeIds: ["2x2-rect"],
    pieceCount: 2,
    seamsVisible: false,
    minDirectionalHalves: 0,
    maxDirectionalHalves: 0,
    minDistinctHalves: 4,
    maxDistinctHalves: 4,
    minReachableDesigns: 16,
  },
  Junior: {
    targetShapeIds: ["2x2-rect"],
    pieceCount: 2,
    seamsVisible: false,
    minDirectionalHalves: 4,
    maxDirectionalHalves: 4,
    minDistinctHalves: 4,
    maxDistinctHalves: 4,
    minReachableDesigns: 16,
  },
  Expert: {
    targetShapeIds: ["2x3-rect"],
    pieceCount: 3,
    seamsVisible: false,
    minDirectionalHalves: 6,
    maxDirectionalHalves: 6,
    minDistinctHalves: 6,
    maxDistinctHalves: 6,
    minReachableDesigns: 24,
  },
  Wizard: {
    targetShapeIds: ["2x3-rect"],
    pieceCount: 3,
    seamsVisible: false,
    minDirectionalHalves: 6,
    maxDirectionalHalves: 6,
    minDistinctHalves: 5,
    maxDistinctHalves: 5,
    minReachableDesigns: 24,
  },
};

export const GENERATOR_MAX_ATTEMPTS = 128;

function normalizeQuarterTurns(turns: number): 0 | 1 | 2 | 3 {
  return (((turns % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

export function isPipMask(value: number): value is PipMask {
  return Number.isInteger(value) && value >= 0 && value < 1 << 9;
}

export function pipDotIndexes(mask: PipMask): readonly number[] {
  if (!isPipMask(mask)) throw new Error(`Invalid pip mask: ${mask}`);
  return Array.from({ length: 9 }, (_, index) => index).filter(
    (index) => (mask & (1 << index)) !== 0,
  );
}

export function pipCount(mask: PipMask): number {
  return pipDotIndexes(mask).length;
}

export function rotatePipMask(mask: PipMask, quarterTurns: number): PipMask {
  if (!isPipMask(mask)) throw new Error(`Invalid pip mask: ${mask}`);
  let result = mask;
  const turns = normalizeQuarterTurns(quarterTurns);

  for (let turn = 0; turn < turns; turn += 1) {
    let rotated = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const sourceBit = 1 << (row * 3 + column);
        if ((result & sourceBit) === 0) continue;
        const targetRow = column;
        const targetColumn = 2 - row;
        rotated |= 1 << (targetRow * 3 + targetColumn);
      }
    }
    result = rotated;
  }

  return result;
}

export function isDirectionalPipMask(mask: PipMask): boolean {
  return rotatePipMask(mask, 1) !== mask;
}

export function pipRotationOrbit(mask: PipMask): readonly PipMask[] {
  return [...new Set([0, 1, 2, 3].map((turns) => rotatePipMask(mask, turns)))]
    .sort((left, right) => left - right);
}

export function pipRotationOrbitKey(mask: PipMask): string {
  return pipRotationOrbit(mask)
    .map((value) => value.toString(16).padStart(3, "0"))
    .join(":");
}

function isDiagonalTwoAndThreePair(
  firstMask: PipMask | null | undefined,
  secondMask: PipMask | null | undefined,
): boolean {
  if (firstMask === null || firstMask === undefined) return false;
  if (secondMask === null || secondMask === undefined) return false;
  const diagonalTwoOrbit = pipRotationOrbitKey(PIP_PATTERNS["diag-two"]);
  const diagonalThreeOrbit = pipRotationOrbitKey(PIP_PATTERNS["diag-three"]);
  const firstOrbit = pipRotationOrbitKey(firstMask);
  const secondOrbit = pipRotationOrbitKey(secondMask);
  return (
    (firstOrbit === diagonalTwoOrbit && secondOrbit === diagonalThreeOrbit) ||
    (firstOrbit === diagonalThreeOrbit && secondOrbit === diagonalTwoOrbit)
  );
}

function rotationPhase(mask: PipMask): 0 | 1 | 2 | 3 | null {
  if (pipRotationOrbit(mask).length !== 4) return null;
  const canonical = pipRotationOrbit(mask)[0];
  const phase = [0, 1, 2, 3].find(
    (turns) => rotatePipMask(canonical, turns) === mask,
  );
  return phase === undefined ? null : (phase as 0 | 1 | 2 | 3);
}

type WizardPhaseTwinInfo = {
  fixedOrbitKey: string;
  variableOrbitKey: string;
  twinPieceIds: readonly [string, string];
};

function wizardPhaseTwinInfo(
  pieces: readonly DominoPiece[],
): WizardPhaseTwinInfo | null {
  if (pieces.length !== 3) return null;
  for (let firstIndex = 0; firstIndex < pieces.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < pieces.length;
      secondIndex += 1
    ) {
      const firstTwin = pieces[firstIndex];
      const secondTwin = pieces[secondIndex];
      const fixedOrbitKey = pipRotationOrbitKey(firstTwin.first);
      const variableOrbitKey = pipRotationOrbitKey(firstTwin.second);
      if (
        fixedOrbitKey === variableOrbitKey ||
        pipRotationOrbitKey(secondTwin.first) !== fixedOrbitKey ||
        pipRotationOrbitKey(secondTwin.second) !== variableOrbitKey ||
        firstTwin.first !== secondTwin.first
      ) {
        continue;
      }
      const firstPhase = rotationPhase(firstTwin.second);
      const secondPhase = rotationPhase(secondTwin.second);
      if (
        firstPhase === null ||
        secondPhase === null ||
        ![1, 3].includes(normalizeQuarterTurns(secondPhase - firstPhase))
      ) {
        continue;
      }
      const thirdPiece = pieces.find(
        (_, pieceIndex) =>
          pieceIndex !== firstIndex && pieceIndex !== secondIndex,
      );
      if (!thirdPiece) continue;
      const thirdOrbits = [
        pipRotationOrbitKey(thirdPiece.first),
        pipRotationOrbitKey(thirdPiece.second),
      ];
      if (
        new Set(thirdOrbits).size !== 2 ||
        thirdOrbits.some(
          (orbitKey) =>
            orbitKey === fixedOrbitKey || orbitKey === variableOrbitKey,
        )
      ) {
        continue;
      }
      return {
        fixedOrbitKey,
        variableOrbitKey,
        twinPieceIds: [firstTwin.id, secondTwin.id],
      };
    }
  }
  return null;
}

export function targetShapeIdForDimensions(
  rows: GridRows,
  columns: GridColumns,
): TargetShapeId {
  const matches = Object.values(TARGET_SHAPES).filter(
    (shape) => shape.rows === rows && shape.columns === columns,
  );
  if (matches.length !== 1) {
    throw new Error(`No unique target shape uses a ${rows}x${columns} grid.`);
  }
  return matches[0].id;
}

function layoutsForShape(
  targetShapeId: TargetShapeId,
): readonly TilingLayout[] {
  return Object.values(TILING_LAYOUTS).filter(
    (layout) => layout.targetShapeId === targetShapeId,
  );
}

export function legalLayoutIds(
  rows: GridRows,
  columns: GridColumns,
): readonly LayoutId[] {
  return legalLayoutIdsForShape(targetShapeIdForDimensions(rows, columns));
}

export function legalLayoutIdsForShape(
  targetShapeId: TargetShapeId,
): readonly LayoutId[] {
  return layoutsForShape(targetShapeId).map(({ id }) => id);
}

function checkedLayouts(
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null,
): readonly TilingLayout[] {
  const targetShapeId = targetShapeIdForDimensions(rows, columns);
  if (layoutId === null) return layoutsForShape(targetShapeId);
  const layout = TILING_LAYOUTS[layoutId];
  if (!layout || layout.targetShapeId !== targetShapeId) {
    throw new Error(
      `Layout ${layoutId} does not tile target shape ${targetShapeId}.`,
    );
  }
  return [layout];
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest],
    ),
  );
}

function directionQuarterTurns(
  fromCell: number,
  toCell: number,
  columns: number,
): 0 | 1 | 2 | 3 {
  const fromRow = Math.floor(fromCell / columns);
  const fromColumn = fromCell % columns;
  const toRow = Math.floor(toCell / columns);
  const toColumn = toCell % columns;
  if (toRow === fromRow && toColumn === fromColumn + 1) return 0;
  if (toRow === fromRow + 1 && toColumn === fromColumn) return 1;
  if (toRow === fromRow && toColumn === fromColumn - 1) return 2;
  if (toRow === fromRow - 1 && toColumn === fromColumn) return 3;
  throw new Error(`Cells ${fromCell} and ${toCell} are not adjacent.`);
}

function assertUsablePieces(
  pieces: readonly DominoPiece[],
  expectedCount?: number,
): void {
  if (expectedCount !== undefined && pieces.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} domino pieces.`);
  }
  if (new Set(pieces.map(({ id }) => id)).size !== pieces.length) {
    throw new Error("Domino piece IDs must be unique.");
  }
  for (const piece of pieces) {
    if (!isPipMask(piece.first) || !isPipMask(piece.second)) {
      throw new Error(`Domino ${piece.id} has an invalid pip mask.`);
    }
  }
}

export function designKey(design: DominoDesign): string {
  return design.cells
    .map((mask) =>
      mask === null ? "---" : mask.toString(16).padStart(3, "0"),
    )
    .join(".");
}

export function exactMaskMultiplicitySignature(
  design: DominoDesign,
): string {
  const counts = new Map<PipMask, number>();
  for (const mask of design.cells) {
    if (mask === null) continue;
    counts.set(mask, (counts.get(mask) ?? 0) + 1);
  }
  return [...counts.values()].sort((left, right) => right - left).join(",");
}

export function differingCellIndexes(
  candidate: DominoDesign,
  expected: DominoDesign,
): readonly number[] {
  if (candidate.cells.length !== expected.cells.length) {
    throw new Error("Designs must have the same number of cells.");
  }
  return candidate.cells.flatMap((mask, index) =>
    mask === expected.cells[index] ? [] : [index],
  );
}

function renderAssignment(
  pieces: readonly DominoPiece[],
  layout: TilingLayout,
  flippedBits: number,
): { design: DominoDesign; witness: BuildWitness } {
  const shape = TARGET_SHAPES[layout.targetShapeId];
  const occupiedCells = new Set(shape.occupiedCells);
  const cells: (PipMask | null)[] = Array.from(
    { length: layout.rows * layout.columns },
    () => null,
  );
  const placements: PlacedDomino[] = [];

  for (const [slotIndex, pair] of layout.pairs.entries()) {
    const piece = pieces[slotIndex];
    const reversed = (flippedBits & (1 << slotIndex)) !== 0;
    const fromCell = reversed ? pair[1] : pair[0];
    const toCell = reversed ? pair[0] : pair[1];
    const quarterTurns = directionQuarterTurns(
      fromCell,
      toCell,
      layout.columns,
    );
    cells[fromCell] = rotatePipMask(piece.first, quarterTurns);
    cells[toCell] = rotatePipMask(piece.second, quarterTurns);
    placements.push({
      pieceId: piece.id,
      fromCell,
      toCell,
      quarterTurns,
    });
  }

  if (
    shape.occupiedCells.some((cell) => {
      const mask = cells[cell];
      return mask === null || !isPipMask(mask);
    }) ||
    cells.some((mask, cell) => !occupiedCells.has(cell) && mask !== null)
  ) {
    throw new Error(`Layout ${layout.id} did not exactly cover its target.`);
  }

  return {
    design: { cells },
    witness: { layoutId: layout.id, placements },
  };
}

/**
 * Exhaustively enumerates every board obtainable by assigning every source
 * domino exactly once, rotating whole pieces but never flipping a half alone.
 */
export function enumerateBuildableDesigns(
  pieces: readonly DominoPiece[],
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null = null,
): readonly ReachableDesign[] {
  const layouts = checkedLayouts(rows, columns, layoutId);
  const shape = TARGET_SHAPES[targetShapeIdForDimensions(rows, columns)];
  assertUsablePieces(pieces, shape.occupiedCells.length / 2);
  const byKey = new Map<
    string,
    { design: DominoDesign; witnesses: BuildWitness[] }
  >();

  for (const layout of layouts) {
    for (const assignedPieces of permutations(pieces)) {
      for (
        let flippedBits = 0;
        flippedBits < 1 << pieces.length;
        flippedBits += 1
      ) {
        const rendered = renderAssignment(
          assignedPieces,
          layout,
          flippedBits,
        );
        const key = designKey(rendered.design);
        const existing = byKey.get(key);
        if (existing) {
          const witnessKey = witnessFingerprint(rendered.witness);
          if (
            !existing.witnesses.some(
              (witness) => witnessFingerprint(witness) === witnessKey,
            )
          ) {
            existing.witnesses.push(rendered.witness);
          }
        } else {
          byKey.set(key, {
            design: rendered.design,
            witnesses: [rendered.witness],
          });
        }
      }
    }
  }

  return [...byKey.values()].sort((left, right) =>
    designKey(left.design).localeCompare(designKey(right.design)),
  );
}

function witnessFingerprint(witness: BuildWitness): string {
  return `${witness.layoutId}:${witness.placements
    .map(
      ({ pieceId, fromCell, toCell, quarterTurns }) =>
        `${pieceId}:${fromCell}>${toCell}@${quarterTurns}`,
    )
    .sort()
    .join("|")}`;
}

export function renderWitness(
  pieces: readonly DominoPiece[],
  rows: GridRows,
  columns: GridColumns,
  witness: BuildWitness,
): DominoDesign {
  const shape = TARGET_SHAPES[targetShapeIdForDimensions(rows, columns)];
  const occupiedCells = new Set(shape.occupiedCells);
  assertUsablePieces(pieces, shape.occupiedCells.length / 2);
  const layout = checkedLayouts(rows, columns, witness.layoutId)[0];
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const usedPieces = new Set<string>();
  const usedCells = new Set<number>();
  const cells: (PipMask | null)[] = Array.from(
    { length: rows * columns },
    () => null,
  );

  if (witness.placements.length !== pieces.length) {
    throw new Error("A build witness must place every domino exactly once.");
  }

  for (const placement of witness.placements) {
    const piece = byId.get(placement.pieceId);
    if (!piece || usedPieces.has(piece.id)) {
      throw new Error("A build witness uses an unknown or repeated domino.");
    }
    if (
      !layout.pairs.some(
        ([first, second]) =>
          (first === placement.fromCell && second === placement.toCell) ||
          (first === placement.toCell && second === placement.fromCell),
      )
    ) {
      throw new Error("A build witness crosses its tiling layout.");
    }
    const turns = directionQuarterTurns(
      placement.fromCell,
      placement.toCell,
      columns,
    );
    if (turns !== placement.quarterTurns) {
      throw new Error("A build witness reports an incorrect rotation.");
    }
    if (
      usedCells.has(placement.fromCell) ||
      usedCells.has(placement.toCell)
    ) {
      throw new Error("A build witness overlaps dominoes.");
    }
    cells[placement.fromCell] = rotatePipMask(piece.first, turns);
    cells[placement.toCell] = rotatePipMask(piece.second, turns);
    usedPieces.add(piece.id);
    usedCells.add(placement.fromCell);
    usedCells.add(placement.toCell);
  }

  if (
    shape.occupiedCells.some((cell) => {
      const mask = cells[cell];
      return mask === null || !isPipMask(mask);
    }) ||
    cells.some((mask, cell) => !occupiedCells.has(cell) && mask !== null)
  ) {
    throw new Error("A build witness does not exactly cover the target.");
  }
  return { cells };
}

export function findBuildWitnesses(
  pieces: readonly DominoPiece[],
  design: DominoDesign,
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null = null,
): readonly BuildWitness[] {
  if (design.cells.length !== rows * columns) return [];
  const key = designKey(design);
  return (
    enumerateBuildableDesigns(pieces, rows, columns, layoutId).find(
      (reachable) => designKey(reachable.design) === key,
    )?.witnesses ?? []
  );
}

export function isDesignBuildable(
  pieces: readonly DominoPiece[],
  design: DominoDesign,
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null = null,
): boolean {
  return findBuildWitnesses(pieces, design, rows, columns, layoutId).length > 0;
}

function nearestReachable(
  design: DominoDesign,
  reachable: readonly ReachableDesign[],
): {
  reachable: ReachableDesign;
  differences: readonly number[];
} {
  if (reachable.length === 0) {
    throw new Error("Cannot analyze a design without a buildable comparison.");
  }
  return reachable
    .map((candidate) => ({
      reachable: candidate,
      differences: differingCellIndexes(design, candidate.design),
    }))
    .sort(
      (left, right) =>
        left.differences.length - right.differences.length ||
        Number(
          isQuarterTurnDifference(
            design,
            right.reachable.design,
            right.differences,
          ),
        ) -
          Number(
            isQuarterTurnDifference(
              design,
              left.reachable.design,
              left.differences,
            ),
          ) ||
        designKey(left.reachable.design).localeCompare(
          designKey(right.reachable.design),
        ),
    )[0];
}

function isQuarterTurnDifference(
  shown: DominoDesign,
  buildable: DominoDesign,
  differences: readonly number[],
): boolean {
  return (
    differences.length > 0 &&
    differences.every((cell) => {
      const buildableMask = buildable.cells[cell];
      const shownMask = shown.cells[cell];
      return (
        buildableMask !== null &&
        shownMask !== null &&
        ([1, 3] as const).some(
          (turns) => rotatePipMask(buildableMask, turns) === shownMask,
        )
      );
    })
  );
}

export function analyzeImpossibleDesign(
  pieces: readonly DominoPiece[],
  design: DominoDesign,
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null,
): MismatchAnalysis {
  const allowed = enumerateBuildableDesigns(pieces, rows, columns, layoutId);
  if (
    allowed.some(
      (reachable) => designKey(reachable.design) === designKey(design),
    )
  ) {
    throw new Error("A buildable design does not have an impossible mismatch.");
  }
  const nearest = nearestReachable(design, allowed);
  const closestWitness = nearest.reachable.witnesses[0];
  const renderedClosest = renderWitness(
    pieces,
    rows,
    columns,
    closestWitness,
  );
  const matchedPieces = closestWitness.placements.filter(
    ({ fromCell, toCell }) =>
      design.cells[fromCell] === renderedClosest.cells[fromCell] &&
      design.cells[toCell] === renderedClosest.cells[toCell],
  ).length;
  const buildableWithHiddenSeams =
    layoutId !== null &&
    isDesignBuildable(pieces, design, rows, columns, null);
  const kind: MismatchKind = buildableWithHiddenSeams
    ? "seam-trap"
    : nearest.differences.length === 1 &&
        isQuarterTurnDifference(
          design,
          nearest.reachable.design,
          nearest.differences,
        )
      ? "twisted-half"
      : nearest.differences.length === 2 &&
          isQuarterTurnDifference(
            design,
            nearest.reachable.design,
            nearest.differences,
          )
        ? "twisted-pair"
      : "broken-pair";
  const message =
    kind === "seam-trap"
      ? "Those halves can pair only by crossing one of the shown seams."
      : kind === "twisted-half"
        ? "One half is turned away from every whole-domino match."
        : kind === "twisted-pair"
          ? "Two pip faces turn independently; no whole-domino turns can make both."
        : "The unmatched neighboring halves never belong to the same domino.";

  return {
    kind,
    differingCells: nearest.differences,
    matchedPieces,
    closestBuildable: nearest.reachable.design,
    closestWitness,
    message,
  };
}

function physicalPieceKey(piece: Pick<DominoPiece, "first" | "second">): string {
  const forward = `${piece.first.toString(16)}:${piece.second.toString(16)}`;
  const reversed = `${rotatePipMask(piece.second, 2).toString(16)}:${rotatePipMask(
    piece.first,
    2,
  ).toString(16)}`;
  return forward < reversed ? forward : reversed;
}

function tokenMask(token: string): PipMask {
  const [name, turnsText] = token.split("@");
  if (!(name in PIP_PATTERNS)) {
    throw new Error(`Unknown pip pattern: ${name}`);
  }
  const turns =
    turnsText === undefined ? 0 : Number.parseInt(turnsText, 10);
  if (!Number.isInteger(turns)) {
    throw new Error(`Invalid pip rotation in token: ${token}`);
  }
  return rotatePipMask(PIP_PATTERNS[name as PipPatternName], turns);
}

export type AuthoredDominoRoundSpec = Readonly<{
  pieces: readonly [
    readonly [string, string],
    readonly [string, string],
    ...(readonly [string, string])[],
  ];
  targetShapeId: TargetShapeId;
  layoutId: LayoutId | null;
  preferredTrapPattern?: PipPatternName;
  preferredTrapTurn?: 1 | 3;
  salt: number;
}>;

const STARTER_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["center", "corners"], ["edges", "center-corners"]], targetShapeId: "2x2-rect", layoutId: null, salt: 11 },
  { pieces: [["center", "edges"], ["corners", "center-edges"]], targetShapeId: "2x2-rect", layoutId: null, salt: 24 },
  { pieces: [["center", "center-corners"], ["edges", "ring"]], targetShapeId: "2x2-rect", layoutId: null, salt: 37 },
  { pieces: [["center", "center-edges"], ["corners", "ring"]], targetShapeId: "2x2-rect", layoutId: null, salt: 42 },
  { pieces: [["center", "ring"], ["center-corners", "all"]], targetShapeId: "2x2-rect", layoutId: null, salt: 53 },
  { pieces: [["corners", "edges"], ["center-edges", "all"]], targetShapeId: "2x2-rect", layoutId: null, salt: 68 },
  { pieces: [["corners", "center-corners"], ["edges", "all"]], targetShapeId: "2x2-rect", layoutId: null, salt: 71 },
  { pieces: [["corners", "center-edges"], ["center-corners", "ring"]], targetShapeId: "2x2-rect", layoutId: null, salt: 84 },
  { pieces: [["edges", "center-corners"], ["center-edges", "ring"]], targetShapeId: "2x2-rect", layoutId: null, salt: 97 },
  { pieces: [["edges", "center-edges"], ["corners", "all"]], targetShapeId: "2x2-rect", layoutId: null, salt: 102 },
  { pieces: [["center-corners", "center-edges"], ["center", "all"]], targetShapeId: "2x2-rect", layoutId: null, salt: 113 },
  { pieces: [["center-edges", "ring"], ["edges", "all"]], targetShapeId: "2x2-rect", layoutId: null, salt: 128 },
];

const JUNIOR_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["diag-two", "diag-three"], ["top-pair", "corner-l"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 139 },
  { pieces: [["diag-two", "diag-three@1"], ["top-pair@1", "corner-l@2"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 149 },
  { pieces: [["diag-two", "corner-l"], ["diag-three", "top-pair@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 157 },
  { pieces: [["diag-two", "diag-three"], ["corner-l", "corner-l@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 167 },
  { pieces: [["diag-two@1", "diag-three@1"], ["corner-l@2", "corner-l@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 179 },
  { pieces: [["diag-two", "diag-three@1"], ["top-pair", "top-pair@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 191 },
  { pieces: [["diag-two@1", "diag-three"], ["top-pair@2", "top-pair@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 197 },
  { pieces: [["diag-two", "diag-three"], ["top-bar", "corner-l@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 211 },
  { pieces: [["diag-two@1", "diag-three@1"], ["top-bar@1", "corner-l@2"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 223 },
  { pieces: [["diag-two", "diag-three@1"], ["top-bar@2", "corner-l@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 227 },
  { pieces: [["diag-two@1", "diag-three"], ["top-bar@3", "corner-l"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 239 },
  { pieces: [["diag-two", "diag-three"], ["corner-l@1", "top-pair@2"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 251 },
];

const EXPERT_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["diag-two", "diag-three"], ["top-bar", "edge-single"], ["top-pair", "corner-l"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 263 },
  { pieces: [["diag-two@1", "diag-three@1"], ["corner-single@1", "top-bar@1"], ["top-pair@1", "corner-l@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 271 },
  { pieces: [["diag-two", "top-pair"], ["diag-three", "corner-l"], ["top-bar", "edge-single"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 283 },
  { pieces: [["diag-two@1", "top-pair@1"], ["diag-three@1", "corner-l@1"], ["top-bar@1", "edge-single@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 293 },
  { pieces: [["diag-two", "corner-single"], ["diag-three@1", "top-bar@2"], ["corner-l@2", "edge-single@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 307 },
  { pieces: [["diag-two@1", "corner-single@1"], ["diag-three", "top-bar@3"], ["corner-l@3", "edge-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 311 },
  { pieces: [["diag-two", "top-pair@2"], ["diag-three", "corner-l@3"], ["corner-single@1", "top-bar@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 331 },
  { pieces: [["diag-two@1", "top-pair@3"], ["diag-three@1", "corner-l@2"], ["corner-single@3", "top-bar"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 347 },
  { pieces: [["diag-two", "edge-single@2"], ["diag-three@1", "top-bar"], ["corner-l@1", "corner-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 3, salt: 353 },
  { pieces: [["diag-two@1", "edge-single"], ["diag-three", "top-bar@1"], ["corner-l", "corner-single@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 1, salt: 367 },
  { pieces: [["diag-two", "corner-l@2"], ["diag-three", "top-pair@1"], ["edge-single@3", "top-bar@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 379 },
  { pieces: [["diag-two@1", "corner-l@3"], ["diag-three@1", "top-pair@2"], ["edge-single@1", "top-bar@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 389 },
];

const WIZARD_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["top-pair", "corner-l"], ["top-pair", "corner-l@1"], ["edge-single", "top-bar"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 401 },
  { pieces: [["top-pair@1", "corner-l@2"], ["top-pair@1", "corner-l@3"], ["corner-single@1", "top-bar@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 3, salt: 419 },
  { pieces: [["corner-l", "top-pair"], ["corner-l", "top-pair@1"], ["edge-single@1", "corner-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 1, salt: 431 },
  { pieces: [["edge-single", "corner-l@1"], ["edge-single", "corner-l@2"], ["top-pair@2", "top-bar@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 443 },
  { pieces: [["corner-single", "top-bar"], ["corner-single", "top-bar@1"], ["top-pair@3", "corner-l@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 3, salt: 457 },
  { pieces: [["top-bar", "edge-single"], ["top-bar", "edge-single@1"], ["corner-l@3", "corner-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 463 },
  { pieces: [["top-pair@2", "corner-single@1"], ["top-pair@2", "corner-single@2"], ["corner-l", "top-bar@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-single", preferredTrapTurn: 1, salt: 479 },
  { pieces: [["corner-l@1", "top-bar@2"], ["corner-l@1", "top-bar@3"], ["edge-single@2", "top-pair"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 3, salt: 487 },
  { pieces: [["edge-single@3", "top-pair@1"], ["edge-single@3", "top-pair@2"], ["corner-single@3", "corner-l@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 1, salt: 499 },
  { pieces: [["corner-single@1", "corner-l@3"], ["corner-single@1", "corner-l"], ["top-bar@2", "edge-single@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 509 },
  { pieces: [["top-bar@1", "corner-single@2"], ["top-bar@1", "corner-single@3"], ["top-pair@2", "edge-single"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-single", preferredTrapTurn: 3, salt: 521 },
  { pieces: [["corner-l@2", "edge-single@1"], ["corner-l@2", "edge-single@2"], ["top-pair@3", "top-bar"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 541 },
];

const AUTHORED_SPECS: Readonly<
  Record<Difficulty, readonly AuthoredDominoRoundSpec[]>
> = {
  Starter: STARTER_SPECS,
  Junior: JUNIOR_SPECS,
  Expert: EXPERT_SPECS,
  Wizard: WIZARD_SPECS,
};

const ANSWER_SEQUENCES: Readonly<Record<Difficulty, readonly number[]>> = {
  Starter: [2, 0, 3, 2, 3, 0, 1, 0, 2, 1, 3, 1],
  Junior: [1, 3, 1, 0, 2, 1, 2, 3, 0, 3, 2, 0],
  Expert: [3, 0, 2, 0, 1, 0, 3, 1, 3, 2, 1, 2],
  Wizard: [0, 2, 0, 1, 2, 1, 3, 2, 3, 1, 0, 3],
};

function piecesFromSpec(
  spec: AuthoredDominoRoundSpec,
): readonly DominoPiece[] {
  return spec.pieces.map(([first, second], index) => ({
    id: String.fromCharCode(65 + index),
    first: tokenMask(first),
    second: tokenMask(second),
  }));
}

function distanceToReachable(
  design: DominoDesign,
  reachable: readonly ReachableDesign[],
): number {
  return Math.min(
    ...reachable.map(
      (candidate) => differingCellIndexes(design, candidate.design).length,
    ),
  );
}

function usesGenerousAlternatives(difficulty: Difficulty): boolean {
  return difficulty === "Starter" || difficulty === "Junior";
}

function rotatedValues<T>(values: readonly T[], salt: number): T[] {
  if (values.length === 0) return [];
  const offset = ((salt % values.length) + values.length) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function selectBuildableOptions(
  reachable: readonly ReachableDesign[],
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null,
  salt: number,
  impossibleDesign: DominoDesign,
  minimumDistance: number,
  requiredSharedSignature?: string,
): readonly { design: DominoDesign; witness: BuildWitness }[] {
  const allowedLayoutIds =
    layoutId === null ? legalLayoutIds(rows, columns) : [layoutId];
  const targetLayoutIds = rotatedValues(allowedLayoutIds, salt);
  const sharedSignatureKeys = new Set(
    requiredSharedSignature
      ? reachable
          .filter(
            ({ design }) =>
              exactMaskMultiplicitySignature(design) ===
              requiredSharedSignature,
          )
          .map(({ design }) => designKey(design))
      : [],
  );
  if (requiredSharedSignature && sharedSignatureKeys.size === 0) {
    throw new Error("No buildable design shares the required face-count signature.");
  }
  type SelectedBuildable = {
    design: DominoDesign;
    witness: BuildWitness;
  };

  function search(
    selected: readonly SelectedBuildable[],
  ): readonly SelectedBuildable[] | null {
    if (selected.length === 3) {
      return !requiredSharedSignature ||
        selected.some(({ design }) => sharedSignatureKeys.has(designKey(design)))
        ? selected
        : null;
    }
    const targetLayoutId =
      targetLayoutIds[selected.length % targetLayoutIds.length];
    const rotatedCandidates = rotatedValues(
      reachable,
      targetLayoutId
        ? salt + selected.length * 7
        : salt * 3 + selected.length + 1,
    );
    const alreadySharesSignature = selected.some(({ design }) =>
      sharedSignatureKeys.has(designKey(design)),
    );
    const candidates =
      requiredSharedSignature && !alreadySharesSignature
        ? [
            ...rotatedCandidates.filter(({ design }) =>
              sharedSignatureKeys.has(designKey(design)),
            ),
            ...rotatedCandidates.filter(
              ({ design }) => !sharedSignatureKeys.has(designKey(design)),
            ),
          ]
        : rotatedCandidates;

    for (const candidate of candidates) {
      const candidateKey = designKey(candidate.design);
      if (
        selected.some(({ design }) => designKey(design) === candidateKey)
      ) {
        continue;
      }
      if (layoutId === null && targetLayoutId) {
        const witnessLayouts = new Set(
          candidate.witnesses.map(({ layoutId: value }) => value),
        );
        if (
          witnessLayouts.size !== 1 ||
          !witnessLayouts.has(targetLayoutId)
        ) {
          continue;
        }
      }
      const comparisons = [
        impossibleDesign,
        ...selected.map(({ design }) => design),
      ];
      if (
        comparisons.some(
          (design) =>
            differingCellIndexes(candidate.design, design).length <
            minimumDistance,
        )
      ) {
        continue;
      }
      const witness = targetLayoutId
        ? candidate.witnesses.find(
            (candidateWitness) =>
              candidateWitness.layoutId === targetLayoutId,
          )
        : candidate.witnesses[0];
      if (!witness) continue;

      const result = search([
        ...selected,
        { design: candidate.design, witness },
      ]);
      if (result) return result;
    }
    return null;
  }

  const selected = search([]);
  if (!selected) {
    throw new Error(
      "A round needs three distinct, meaningfully separated buildable designs.",
    );
  }
  return selected;
}

function swappedCandidates(
  reachable: readonly ReachableDesign[],
  salt: number,
): DominoDesign[] {
  const candidates: DominoDesign[] = [];
  for (const item of rotatedValues(reachable, salt)) {
    for (let first = 0; first < item.design.cells.length; first += 1) {
      if (item.design.cells[first] === null) continue;
      for (
        let second = first + 1;
        second < item.design.cells.length;
        second += 1
      ) {
        if (
          item.design.cells[second] === null ||
          item.design.cells[first] === item.design.cells[second]
        ) {
          continue;
        }
        const cells = [...item.design.cells];
        [cells[first], cells[second]] = [cells[second], cells[first]];
        candidates.push({ cells });
      }
    }
  }
  return rotatedValues(candidates, salt * 5 + 3);
}

function twistedCandidates(
  reachable: readonly ReachableDesign[],
  salt: number,
  preferredPattern?: PipPatternName,
  preferredTurn?: 1 | 3,
): DominoDesign[] {
  const candidates: DominoDesign[] = [];
  for (const item of rotatedValues(reachable, salt * 2 + 1)) {
    for (let cell = 0; cell < item.design.cells.length; cell += 1) {
      const mask = item.design.cells[cell];
      if (mask === null) continue;
      if (
        preferredPattern &&
        ![0, 1, 2, 3].some(
          (turns) => rotatePipMask(PIP_PATTERNS[preferredPattern], turns) === mask,
        )
      ) {
        continue;
      }
      // The teaching trap is a true quarter-turn: the pip count stays fixed,
      // but a directional face points 90 degrees away from a legal build.
      const turnsToTry = preferredTurn ? [preferredTurn] : ([1, 3] as const);
      for (const turns of turnsToTry) {
        const rotated = rotatePipMask(mask, turns);
        if (rotated === mask) continue;
        const cells = [...item.design.cells];
        cells[cell] = rotated;
        candidates.push({ cells });
      }
    }
  }
  return rotatedValues(candidates, salt * 7 + 5);
}

function twistedPairCandidates(
  reachable: readonly ReachableDesign[],
  salt: number,
): DominoDesign[] {
  const candidates: DominoDesign[] = [];
  for (const item of rotatedValues(reachable, salt * 3 + 1)) {
    for (let firstCell = 0; firstCell < item.design.cells.length; firstCell += 1) {
      const firstMask = item.design.cells[firstCell];
      if (firstMask === null || !isDirectionalPipMask(firstMask)) continue;
      for (
        let secondCell = firstCell + 1;
        secondCell < item.design.cells.length;
        secondCell += 1
      ) {
        const secondMask = item.design.cells[secondCell];
        if (secondMask === null || !isDirectionalPipMask(secondMask)) continue;
        if (!isDiagonalTwoAndThreePair(firstMask, secondMask)) continue;
        // Junior near-misses turn the two visually confusable diagonal faces,
        // so the decisive error cannot hide in an easier support pattern.
        for (const firstTurn of [1, 3] as const) {
          for (const secondTurn of [1, 3] as const) {
            const cells = [...item.design.cells];
            cells[firstCell] = rotatePipMask(firstMask, firstTurn);
            cells[secondCell] = rotatePipMask(secondMask, secondTurn);
            candidates.push({ cells });
          }
        }
      }
    }
  }
  return rotatedValues(candidates, salt * 11 + 7);
}

function chooseImpossibleDesign(
  pieces: readonly DominoPiece[],
  reachable: readonly ReachableDesign[],
  rows: GridRows,
  columns: GridColumns,
  layoutId: LayoutId | null,
  salt: number,
  difficulty: Difficulty,
  isUsable: (design: DominoDesign) => boolean,
  preferredTrapPattern?: PipPatternName,
  preferredTrapTurn?: 1 | 3,
): DominoDesign {
  const reachableKeys = new Set(
    reachable.map((item) => designKey(item.design)),
  );
  const candidates: DominoDesign[] = [];

  const teachesBrokenPair = difficulty === "Starter";
  const teachesCoupledOrientation = difficulty === "Junior";
  const teachesOrientationError =
    difficulty === "Expert" || difficulty === "Wizard";

  const localFamilies = teachesOrientationError
    ? [
        twistedCandidates(
          reachable,
          salt,
          preferredTrapPattern,
          preferredTrapTurn,
        ),
      ]
    : teachesCoupledOrientation
      ? [twistedPairCandidates(reachable, salt)]
    : teachesBrokenPair
      ? [swappedCandidates(reachable, salt)]
      : [];
  candidates.push(...localFamilies.flat());

  const seen = new Set<string>();
  const closeCandidate = candidates.find((candidate) => {
    const key = designKey(candidate);
    if (seen.has(key) || reachableKeys.has(key)) return false;
    seen.add(key);
    const distance = distanceToReachable(candidate, reachable);
    const distanceIsSuitable =
      teachesOrientationError
        ? distance === 1
        : teachesCoupledOrientation || teachesBrokenPair
          ? distance === 2
          : false;
    return distanceIsSuitable && isUsable(candidate);
  });
  if (!closeCandidate) {
    throw new Error(
      `Unable to construct a close ${difficulty} impossible design for salt ${salt}.`,
    );
  }
  return closeCandidate;
}

function isInterestingPieceSet(
  pieces: readonly DominoPiece[],
  difficulty: Difficulty,
  targetShapeId: TargetShapeId,
): boolean {
  const rules = DIFFICULTY_RULES[difficulty];
  const shape = TARGET_SHAPES[targetShapeId];
  if (pieces.length !== rules.pieceCount) return false;
  const halves = pieces.flatMap(({ first, second }) => [first, second]);
  const directionalCount = halves.filter(isDirectionalPipMask).length;
  const distinctHalfCount = new Set(halves).size;
  if (
    directionalCount < rules.minDirectionalHalves ||
    directionalCount > rules.maxDirectionalHalves ||
    distinctHalfCount < rules.minDistinctHalves ||
    distinctHalfCount > rules.maxDistinctHalves ||
    new Set(pieces.map(physicalPieceKey)).size !== pieces.length
  ) {
    return false;
  }
  if (
    difficulty === "Wizard" &&
    (exactMaskMultiplicitySignature({ cells: halves }) !== "2,1,1,1,1" ||
      wizardPhaseTwinInfo(pieces) === null)
  ) {
    return false;
  }
  const layoutId = rules.seamsVisible
    ? legalLayoutIdsForShape(targetShapeId)[0]
    : null;
  return (
    enumerateBuildableDesigns(
      pieces,
      shape.rows,
      shape.columns,
      layoutId,
    ).length >= rules.minReachableDesigns
  );
}

function assembleRound(
  id: string,
  difficulty: Difficulty,
  pieces: readonly DominoPiece[],
  targetShapeId: TargetShapeId,
  layoutId: LayoutId | null,
  correctIndex: number,
  salt: number,
  preferredTrapPattern?: PipPatternName,
  preferredTrapTurn?: 1 | 3,
): DominoRound {
  const rules = DIFFICULTY_RULES[difficulty];
  const shape = TARGET_SHAPES[targetShapeId];
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new Error("The impossible option index must be between 0 and 3.");
  }
  if (rules.seamsVisible !== (layoutId !== null)) {
    throw new Error(`${difficulty} has an inconsistent seam scaffold.`);
  }
  if (!rules.targetShapeIds.includes(targetShapeId)) {
    throw new Error(`${difficulty} does not teach target ${targetShapeId}.`);
  }
  if (!isInterestingPieceSet(pieces, difficulty, targetShapeId)) {
    throw new Error(`${difficulty} uses an uninteresting domino set.`);
  }
  if (layoutId !== null) {
    checkedLayouts(shape.rows, shape.columns, layoutId);
  }
  const reachable = enumerateBuildableDesigns(
    pieces,
    shape.rows,
    shape.columns,
    layoutId,
  );
  const minimumOptionDistance = usesGenerousAlternatives(difficulty) ? 2 : 1;
  const impossibleDesign = chooseImpossibleDesign(
    pieces,
    reachable,
    shape.rows,
    shape.columns,
    layoutId,
    salt,
    difficulty,
    (candidate) => {
      try {
        selectBuildableOptions(
          reachable,
          shape.rows,
          shape.columns,
          layoutId,
          salt,
          candidate,
          minimumOptionDistance,
          difficulty === "Junior" ||
            difficulty === "Expert" ||
            difficulty === "Wizard"
            ? exactMaskMultiplicitySignature(candidate)
            : undefined,
        );
        return true;
      } catch {
        return false;
      }
    },
    preferredTrapPattern,
    preferredTrapTurn,
  );
  const possibleOptions = selectBuildableOptions(
    reachable,
    shape.rows,
    shape.columns,
    layoutId,
    salt,
    impossibleDesign,
    minimumOptionDistance,
    difficulty === "Junior" ||
      difficulty === "Expert" ||
      difficulty === "Wizard"
      ? exactMaskMultiplicitySignature(impossibleDesign)
      : undefined,
  ).map<DominoOption>(({ design, witness }) => ({
    design,
    buildable: true,
    kind: "buildable",
    witness,
    mismatch: null,
  }));
  const mismatch = analyzeImpossibleDesign(
    pieces,
    impossibleDesign,
    shape.rows,
    shape.columns,
    layoutId,
  );
  const impossibleOption: DominoOption = {
    design: impossibleDesign,
    buildable: false,
    kind: mismatch.kind,
    witness: null,
    mismatch,
  };
  const options = [...possibleOptions];
  options.splice(correctIndex, 0, impossibleOption);

  const round: DominoRound = {
    id,
    difficulty,
    pieces,
    targetShapeId,
    rows: shape.rows,
    columns: shape.columns,
    layoutId,
    seamsVisible: rules.seamsVisible,
    options,
    correctIndex,
    prompt: "Which design cannot be built?",
  };
  const errors = validateRound(round);
  if (errors.length > 0) {
    throw new Error(`Invalid ${id}: ${errors.join(" ")}`);
  }
  return round;
}

function answerSequenceErrors(
  difficulty: Difficulty,
  indexes: readonly number[],
): string[] {
  const errors: string[] = [];
  const counts = [0, 1, 2, 3].map(
    (index) => indexes.filter((value) => value === index).length,
  );
  if (counts.some((count) => count !== 3)) {
    errors.push(`${difficulty} answer positions are not balanced 3/3/3/3.`);
  }
  if (indexes.some((value, index) => index > 0 && value === indexes[index - 1])) {
    errors.push(`${difficulty} repeats adjacent answer positions.`);
  }
  if (
    indexes.length === 12 &&
    indexes.slice(0, 4).every(
      (value, index) =>
        value === indexes[index + 4] && value === indexes[index + 8],
    )
  ) {
    errors.push(`${difficulty} repeats one four-position cycle.`);
  }
  for (let blockStart = 0; blockStart < indexes.length; blockStart += 4) {
    if (new Set(indexes.slice(blockStart, blockStart + 4)).size === 4) {
      errors.push(
        `${difficulty} block ${blockStart / 4 + 1} exposes every answer position once.`,
      );
    }
  }
  return errors;
}

function designMatchesTarget(
  design: DominoDesign,
  shape: TargetShape,
): boolean {
  if (design.cells.length !== shape.rows * shape.columns) return false;
  const occupied = new Set(shape.occupiedCells);
  return design.cells.every((mask, cell) =>
    occupied.has(cell) ? mask !== null && isPipMask(mask) : mask === null,
  );
}

export function validateRound(round: DominoRound): readonly string[] {
  const errors: string[] = [];
  const rules = DIFFICULTY_RULES[round.difficulty];
  if (!rules) return [`Unknown difficulty: ${round.difficulty}`];
  const shape = TARGET_SHAPES[round.targetShapeId];
  if (!shape) return [`Unknown target shape: ${round.targetShapeId}`];
  if (
    !rules.targetShapeIds.includes(round.targetShapeId) ||
    round.rows !== shape.rows ||
    round.columns !== shape.columns ||
    round.pieces.length !== rules.pieceCount
  ) {
    errors.push("Target shape, board dimensions, or piece count do not match the difficulty.");
  }
  if (
    round.seamsVisible !== rules.seamsVisible ||
    round.seamsVisible !== (round.layoutId !== null)
  ) {
    errors.push("Seam visibility does not match the difficulty.");
  }
  if (
    round.difficulty === "Wizard" &&
    (exactMaskMultiplicitySignature({
      cells: round.pieces.flatMap(({ first, second }) => [first, second]),
    }) !== "2,1,1,1,1" ||
      wizardPhaseTwinInfo(round.pieces) === null)
  ) {
    errors.push(
      "Wizard source pieces must form a relative-phase twin pair.",
    );
  }
  if (round.options.length !== 4) errors.push("A round must have four options.");
  if (
    !Number.isInteger(round.correctIndex) ||
    round.correctIndex < 0 ||
    round.correctIndex >= round.options.length
  ) {
    errors.push("The correct option index is out of range.");
    return errors;
  }
  if (
    new Set(round.options.map(({ design }) => designKey(design))).size !==
    round.options.length
  ) {
    errors.push("Answer designs must be distinct.");
  }
  const optionFootprintsAreValid = round.options.every(
    ({ design }) => designMatchesTarget(design, shape),
  );
  if (!optionFootprintsAreValid) {
    errors.push("Every answer design must exactly fill the target footprint.");
  }
  if (
    usesGenerousAlternatives(round.difficulty) &&
    optionFootprintsAreValid
  ) {
    for (let first = 0; first < round.options.length; first += 1) {
      for (let second = first + 1; second < round.options.length; second += 1) {
        if (
          differingCellIndexes(
            round.options[first].design,
            round.options[second].design,
          ).length < 2
        ) {
          errors.push(
            "Starter and Junior answer designs must differ in at least two cells.",
          );
        }
      }
    }
  }

  let scopedReachable: readonly ReachableDesign[];
  try {
    scopedReachable = enumerateBuildableDesigns(
      round.pieces,
      round.rows,
      round.columns,
      round.layoutId,
    );
  } catch {
    errors.push("The round's pieces or tiling scope cannot be enumerated.");
    return errors;
  }
  const scopedReachableByKey = new Map(
    scopedReachable.map((reachable) => [
      designKey(reachable.design),
      reachable,
    ]),
  );
  const actualBuildability = round.options.map(({ design }) =>
    scopedReachableByKey.has(designKey(design)),
  );
  const impossibleIndexes = actualBuildability.flatMap((buildable, index) =>
    buildable ? [] : [index],
  );
  if (
    impossibleIndexes.length !== 1 ||
    impossibleIndexes[0] !== round.correctIndex
  ) {
    errors.push("Exactly one option must be impossible and marked correct.");
  }

  for (const [index, option] of round.options.entries()) {
    if (option.buildable !== actualBuildability[index]) {
      errors.push(`Option ${index + 1} has a false buildability label.`);
    }
    if (actualBuildability[index]) {
      if (!option.witness || option.mismatch || option.kind !== "buildable") {
        errors.push(`Option ${index + 1} needs one clean build witness.`);
        continue;
      }
      try {
        if (
          designKey(
            renderWitness(
              round.pieces,
              round.rows,
              round.columns,
              option.witness,
            ),
          ) !== designKey(option.design)
        ) {
          errors.push(`Option ${index + 1} has an incorrect build witness.`);
        }
      } catch {
        errors.push(`Option ${index + 1} has an invalid build witness.`);
      }
    } else {
      if (
        option.witness ||
        !option.mismatch ||
        option.kind === "buildable" ||
        option.mismatch.differingCells.length <
          (usesGenerousAlternatives(round.difficulty) ? 2 : 1) ||
        option.mismatch.differingCells.length > 2
      ) {
        errors.push(
          `Option ${index + 1} needs a local impossible explanation.`,
        );
        continue;
      }
      const actualDifferences = differingCellIndexes(
        option.design,
        option.mismatch.closestBuildable,
      );
      if (
        actualDifferences.length !== option.mismatch.differingCells.length ||
        actualDifferences.some(
          (cell, differenceIndex) =>
            cell !== option.mismatch?.differingCells[differenceIndex],
        )
      ) {
        errors.push(`Option ${index + 1} reports incorrect local differences.`);
      }
      if (!scopedReachableByKey.has(designKey(option.mismatch.closestBuildable))) {
        errors.push(`Option ${index + 1} needs a buildable comparison.`);
      }

      if (
        round.difficulty === "Starter" &&
        (option.kind !== "broken-pair" ||
          option.mismatch.differingCells.length !== 2 ||
          scopedReachableByKey.has(designKey(option.design)) ||
          [...option.design.cells].sort().join(",") !==
            [...option.mismatch.closestBuildable.cells].sort().join(","))
      ) {
        errors.push(
          `Option ${index + 1} must be a two-cell globally impossible broken pair.`,
        );
      }

      if (
        round.difficulty === "Junior" &&
        (option.kind !== "twisted-pair" ||
          option.mismatch.differingCells.length !== 2 ||
          !isDiagonalTwoAndThreePair(
            option.mismatch.closestBuildable.cells[actualDifferences[0]],
            option.mismatch.closestBuildable.cells[actualDifferences[1]],
          ) ||
          !isQuarterTurnDifference(
            option.design,
            option.mismatch.closestBuildable,
            actualDifferences,
          ))
      ) {
        errors.push(
          `Option ${index + 1} must quarter-turn the diagonal two- and three-pip faces.`,
        );
      }

      const teachesOrientationError =
        round.difficulty === "Expert" || round.difficulty === "Wizard";
      if (
        teachesOrientationError &&
        (option.kind !== "twisted-half" ||
          !isQuarterTurnDifference(
            option.design,
            option.mismatch.closestBuildable,
            actualDifferences,
          ))
      ) {
        errors.push(
          `Option ${index + 1} must be a one-face quarter-turn trap.`,
        );
      }
      if (round.difficulty === "Wizard") {
        const twinInfo = wizardPhaseTwinInfo(round.pieces);
        const buildableMask =
          option.mismatch.closestBuildable.cells[actualDifferences[0]];
        if (
          !twinInfo ||
          buildableMask === null ||
          pipRotationOrbitKey(buildableMask) !== twinInfo.variableOrbitKey
        ) {
          errors.push(
            `Option ${index + 1} must twist the variable face of a phase twin.`,
          );
        }
      }
    }
  }

  if (round.layoutId === null) {
    const exclusivelyRepresentedLayouts = new Set<LayoutId>();
    for (const option of round.options.filter(({ buildable }) => buildable)) {
      const reachable = scopedReachableByKey.get(designKey(option.design));
      const witnessLayouts = new Set(
        reachable?.witnesses.map(({ layoutId }) => layoutId) ?? [],
      );
      if (witnessLayouts.size === 1) {
        exclusivelyRepresentedLayouts.add([...witnessLayouts][0]);
      }
    }
    const missingLayout = legalLayoutIdsForShape(round.targetShapeId).some(
      (layoutId) => !exclusivelyRepresentedLayouts.has(layoutId),
    );
    if (missingLayout) {
      errors.push(
        "Hidden-seam choices must include exclusive evidence for every legal tiling.",
      );
    }
  }
  if (
    round.difficulty === "Junior" ||
    round.difficulty === "Expert" ||
    round.difficulty === "Wizard"
  ) {
    const impossibleSignature = exactMaskMultiplicitySignature(
      round.options[round.correctIndex].design,
    );
    if (
      !round.options.some(
        (option, index) =>
          index !== round.correctIndex &&
          option.buildable &&
          exactMaskMultiplicitySignature(option.design) ===
            impossibleSignature,
      )
    ) {
      errors.push(
        `${round.difficulty}'s impossible option must share its face-count signature with a buildable choice.`,
      );
    }
  }
  return errors;
}

export function buildAuthoredDominoRounds(
  collectionId: string,
  difficulty: Difficulty,
  specs: readonly AuthoredDominoRoundSpec[],
  answers: readonly number[],
): readonly DominoRound[] {
  if (specs.length !== 12 || answers.length !== 12) {
    throw new Error(`${collectionId} must contain exactly 12 authored rounds.`);
  }
  const sequenceErrors = answerSequenceErrors(difficulty, answers);
  if (sequenceErrors.length > 0) {
    throw new Error(sequenceErrors.join(" "));
  }
  const rounds = specs.map((spec, index) =>
    assembleRound(
      `${collectionId}-${String(index + 1).padStart(2, "0")}`,
      difficulty,
      piecesFromSpec(spec),
      spec.targetShapeId,
      spec.layoutId,
      answers[index],
      spec.salt,
      spec.preferredTrapPattern,
      spec.preferredTrapTurn,
    ),
  );
  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error(`${collectionId} fingerprints must be unique.`);
  }
  return rounds;
}

export function buildCampaignRounds(): readonly DominoRound[] {
  const rounds = (
    ["Starter", "Junior", "Expert", "Wizard"] as const
  ).flatMap((difficulty) =>
    buildAuthoredDominoRounds(
      `domino-${difficulty.toLowerCase()}`,
      difficulty,
      AUTHORED_SPECS[difficulty],
      ANSWER_SEQUENCES[difficulty],
    ),
  );
  if (new Set(rounds.map(roundFingerprint)).size !== rounds.length) {
    throw new Error("Authored Domino Twist fingerprints must be unique.");
  }
  return rounds;
}

function unitRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a finite number from 0 up to 1.");
  }
  return value;
}

function randomInteger(random: () => number, exclusiveMaximum: number): number {
  return Math.floor(unitRandom(random) * exclusiveMaximum);
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function makeGeneratedPieces(
  difficulty: Difficulty,
  random: () => number,
  preferredTrapPattern?: PipPatternName,
): readonly DominoPiece[] {
  const rules = DIFFICULTY_RULES[difficulty];
  if (difficulty === "Junior") {
    const [firstSupport, secondSupport] = shuffled(
      JUNIOR_SUPPORT_PATTERN_NAMES,
      random,
    );
    const halves = shuffled(
      [
        ...DIAGONAL_PATTERN_NAMES.map((name) =>
          rotatePipMask(PIP_PATTERNS[name], randomInteger(random, 2)),
        ),
        rotatePipMask(
          PIP_PATTERNS[firstSupport],
          randomInteger(random, 4),
        ),
        rotatePipMask(
          PIP_PATTERNS[secondSupport],
          randomInteger(random, 4),
        ),
      ],
      random,
    );
    return [
      { id: "A", first: halves[0], second: halves[1] },
      { id: "B", first: halves[2], second: halves[3] },
    ];
  }
  if (difficulty === "Wizard") {
    if (
      !preferredTrapPattern ||
      !PHASE_PATTERN_NAMES.includes(
        preferredTrapPattern as (typeof PHASE_PATTERN_NAMES)[number],
      )
    ) {
      throw new Error("Wizard generation needs a phase-twin trap family.");
    }
    const [fixedName, thirdFirstName, thirdSecondName] = shuffled(
      PHASE_PATTERN_NAMES.filter((name) => name !== preferredTrapPattern),
      random,
    );
    const fixedMask = rotatePipMask(
      PIP_PATTERNS[fixedName],
      randomInteger(random, 4),
    );
    const variableTurns = randomInteger(random, 4);
    const variableMask = rotatePipMask(
      PIP_PATTERNS[preferredTrapPattern],
      variableTurns,
    );
    const shiftedVariableMask = rotatePipMask(
      PIP_PATTERNS[preferredTrapPattern],
      variableTurns + (randomInteger(random, 2) === 0 ? 1 : 3),
    );
    return [
      { id: "A", first: fixedMask, second: variableMask },
      { id: "B", first: fixedMask, second: shiftedVariableMask },
      {
        id: "C",
        first: rotatePipMask(
          PIP_PATTERNS[thirdFirstName],
          randomInteger(random, 4),
        ),
        second: rotatePipMask(
          PIP_PATTERNS[thirdSecondName],
          randomInteger(random, 4),
        ),
      },
    ];
  }
  const halfCount = rules.pieceCount * 2;
  const directionalCount =
    rules.minDirectionalHalves +
    randomInteger(
      random,
      rules.maxDirectionalHalves - rules.minDirectionalHalves + 1,
    );
  const categories = shuffled(
    [
      ...Array.from({ length: directionalCount }, () => true),
      ...Array.from({ length: halfCount - directionalCount }, () => false),
    ],
    random,
  );
  const halves = categories.map((directional) => {
    const names = directional
      ? DIRECTIONAL_PATTERN_NAMES
      : SIMPLE_PATTERN_NAMES;
    const name = names[randomInteger(random, names.length)];
    const turns = directional ? randomInteger(random, 4) : 0;
    return rotatePipMask(PIP_PATTERNS[name], turns);
  });
  return Array.from({ length: rules.pieceCount }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    first: halves[index * 2],
    second: halves[index * 2 + 1],
  }));
}

function isDifficulty(value: string): value is Difficulty {
  return (
    value === "Starter" ||
    value === "Junior" ||
    value === "Expert" ||
    value === "Wizard"
  );
}

/**
 * Generates a validated Infinite round. Pass the current session fingerprint
 * set to guarantee that a challenge is not repeated in that session.
 */
export function generateInfiniteRound(
  difficulty: Difficulty,
  random: () => number = Math.random,
  excludedFingerprints: ReadonlySet<string> = new Set(),
): DominoRound {
  if (!isDifficulty(difficulty)) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }
  const rules = DIFFICULTY_RULES[difficulty];

  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const preferredTrapPattern = (() => {
      const names =
        difficulty === "Junior"
          ? DIAGONAL_PATTERN_NAMES
          : difficulty === "Wizard"
            ? PHASE_PATTERN_NAMES
            : null;
      if (!names) return undefined;
      const phase = randomInteger(random, names.length);
      const selection = randomInteger(
        random,
        names.length,
      );
      return names[(phase + selection) % names.length];
    })();
    const pieces = makeGeneratedPieces(
      difficulty,
      random,
      preferredTrapPattern,
    );
    // Choose geometry after piece generation has mixed a seeded source; this
    // avoids adjacent numeric seeds clustering into one shape family.
    const targetShapeId =
      rules.targetShapeIds[randomInteger(random, rules.targetShapeIds.length)];
    const layoutIds = legalLayoutIdsForShape(targetShapeId);
    if (!isInterestingPieceSet(pieces, difficulty, targetShapeId)) continue;
    const layoutId = rules.seamsVisible
      ? layoutIds[randomInteger(random, layoutIds.length)]
      : null;
    const correctIndex = randomInteger(random, 4);
    const salt = randomInteger(random, 1_000_000);
    let round: DominoRound;
    try {
      round = assembleRound(
        `infinite-${difficulty.toLowerCase()}-${salt.toString(36)}`,
        difficulty,
        pieces,
        targetShapeId,
        layoutId,
        correctIndex,
        salt,
        preferredTrapPattern,
      );
    } catch {
      continue;
    }
    if (!excludedFingerprints.has(roundFingerprint(round))) return round;
  }

  throw new Error(
    `Unable to generate a valid ${difficulty} round after ${GENERATOR_MAX_ATTEMPTS} attempts.`,
  );
}

/** A tiny deterministic source for saved or testable Infinite sessions. */
export function makeSeededRandom(seed: number): () => number {
  if (!Number.isFinite(seed)) throw new Error("Seed must be finite.");
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * Canonicalizes source piece order, 180-degree source presentation, and answer
 * order while retaining the exact four-design challenge.
 */
export function roundFingerprint(round: DominoRound): string {
  const pieces = round.pieces.map(physicalPieceKey).sort().join("|");
  const options = round.options
    .map(({ design }) => designKey(design))
    .sort()
    .join("|");
  const impossible = designKey(round.options[round.correctIndex].design);
  return `${round.difficulty}:${round.targetShapeId}:${round.rows}x${round.columns}:${
    round.layoutId ?? "any-layout"
  }:${pieces}:${options}:!${impossible}`;
}

export const ROUNDS = buildCampaignRounds();
export const CAMPAIGN_ROUNDS = ROUNDS;

const tutorialPieces: readonly DominoPiece[] = [
  {
    id: "A",
    first: PIP_PATTERNS["corner-l"],
    second: PIP_PATTERNS.center,
  },
  {
    id: "B",
    first: PIP_PATTERNS["edge-single"],
    second: PIP_PATTERNS.corners,
  },
];
const tutorialWitness: BuildWitness = {
  layoutId: "2x2-columns",
  placements: [
    { pieceId: "A", fromCell: 0, toCell: 2, quarterTurns: 1 },
    { pieceId: "B", fromCell: 1, toCell: 3, quarterTurns: 1 },
  ],
};
const tutorialPossible = renderWitness(
  tutorialPieces,
  2,
  2,
  tutorialWitness,
);
const tutorialNearMiss = tutorialPossible.cells
  .flatMap((mask, cell) => {
    if (mask === null || !isDirectionalPipMask(mask)) return [];
    return ([1, 3] as const).map((turns) => {
      const cells = [...tutorialPossible.cells];
      cells[cell] = rotatePipMask(mask, turns);
      return { cells } satisfies DominoDesign;
    });
  })
  .find(
    (design) =>
      !isDesignBuildable(tutorialPieces, design, 2, 2, null) &&
      analyzeImpossibleDesign(
        tutorialPieces,
        design,
        2,
        2,
        "2x2-columns",
      ).differingCells.length === 1,
  );
if (!tutorialNearMiss) {
  throw new Error("The Domino Twist tutorial needs a global rotation near-miss.");
}
const tutorialNearMissAnalysis = analyzeImpossibleDesign(
  tutorialPieces,
  tutorialNearMiss,
  2,
  2,
  "2x2-columns",
);

export const TUTORIAL = {
  pieces: tutorialPieces,
  targetShapeId: "2x2-rect",
  rows: 2,
  columns: 2,
  layoutId: "2x2-columns",
  possible: tutorialPossible,
  witness: tutorialWitness,
  nearMiss: tutorialNearMiss,
  nearMissReason: tutorialNearMissAnalysis.message,
} as const;
