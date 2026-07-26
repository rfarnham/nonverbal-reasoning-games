import type {
  ExtraPieceRound,
  PiecePlacement,
} from "./game-engine";

export const SOLUTION_PRESENTATIONS = [
  { id: "coral", fill: "#f7b5aa" },
  { id: "gold", fill: "#f7d98c" },
  { id: "teal", fill: "#9ddbd2" },
  { id: "violet", fill: "#c6bff0" },
  { id: "blue", fill: "#a9d1f2" },
  { id: "lime", fill: "#d3e99e" },
] as const;

export type SolutionPresentation =
  (typeof SOLUTION_PRESENTATIONS)[number];

export type SolutionCellAssignment = Readonly<{
  key: string;
  pieceIndex: number;
  presentationId: SolutionPresentation["id"];
}>;

export function solutionPresentationForPiece(
  pieceIndex: number,
): SolutionPresentation {
  const boundedIndex =
    ((pieceIndex % SOLUTION_PRESENTATIONS.length) +
      SOLUTION_PRESENTATIONS.length) %
    SOLUTION_PRESENTATIONS.length;
  return SOLUTION_PRESENTATIONS[boundedIndex] ?? SOLUTION_PRESENTATIONS[0];
}

export function solutionCellAssignments(
  round: Pick<ExtraPieceRound, "solution">,
): readonly SolutionCellAssignment[] {
  return round.solution
    .flatMap((placement: PiecePlacement) => {
      const presentation = solutionPresentationForPiece(
        placement.pieceIndex,
      );
      return placement.cells.map(({ x, y }) => ({
        key: `${x},${y}`,
        pieceIndex: placement.pieceIndex,
        presentationId: presentation.id,
      }));
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}
