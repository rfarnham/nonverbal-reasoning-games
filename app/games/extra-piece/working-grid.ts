export type WorkingGridState = Readonly<
  Record<string, readonly string[]>
>;

export const EMPTY_WORKING_GRID: WorkingGridState = Object.freeze({});

export function workingCellsForRound(
  state: WorkingGridState,
  roundId: string,
): readonly string[] {
  return state[roundId] ?? [];
}

export function toggleWorkingCell(
  state: WorkingGridState,
  roundId: string,
  cellKey: string,
): WorkingGridState {
  const nextCells = new Set(workingCellsForRound(state, roundId));
  if (nextCells.has(cellKey)) {
    nextCells.delete(cellKey);
  } else {
    nextCells.add(cellKey);
  }
  return {
    ...state,
    [roundId]: [...nextCells].sort(),
  };
}

export function clearWorkingCells(
  state: WorkingGridState,
  roundId: string,
): WorkingGridState {
  if (!(roundId in state)) return state;
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== roundId),
  );
}
