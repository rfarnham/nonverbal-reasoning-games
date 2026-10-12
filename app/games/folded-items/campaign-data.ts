import type { AuthoredFoldedItemsRoundSpec, Difficulty, FoldInstruction, ItemStyle } from "./game-engine.ts";

const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const SIXTEEN = [6, 0, 13, 8, 2, 10, 5, 15, 9, 3, 14, 1, 12, 7, 4, 11] as const;
const TWENTY_FIVE = [11, 3, 20, 7, 15, 0, 18, 5, 24, 9, 22, 13, 1, 17, 6, 4, 21, 10, 2, 19, 16, 8, 23, 14, 12] as const;
const STYLES: readonly ItemStyle[] = ["letters", "numbers", "shapes", "numbers", "shapes", "letters", "shapes", "letters", "numbers", "letters", "numbers", "shapes"];
const ANSWERS = [0, 1, 2, 3, 1, 3, 0, 2, 3, 0, 2, 1] as const;
const fold = (direction: FoldInstruction["direction"], sense: FoldInstruction["sense"], crease: number): FoldInstruction => ({ direction, sense, crease });

// Explicit authored programs. Atomic moving-side directions repeat three times
// in Starter; Junior then introduces ordering and under-folds in coherent blocks.
const STARTER = ["up", "up", "up", "down", "down", "down", "left", "left", "left", "right", "right", "right"] as const;
const JUNIOR: readonly (readonly FoldInstruction[])[] = [
  [fold("up", "over", 2), fold("left", "over", 2)],
  [fold("down", "over", 2), fold("right", "over", 2)],
  [fold("left", "over", 2), fold("up", "over", 2)],
  [fold("right", "under", 2), fold("down", "over", 2)],
  [fold("up", "under", 2), fold("right", "over", 2)],
  [fold("down", "under", 2), fold("left", "over", 2)],
  [fold("left", "over", 2), fold("down", "under", 2)],
  [fold("right", "over", 2), fold("up", "under", 2)],
  [fold("up", "over", 2), fold("left", "under", 2)],
  [fold("down", "under", 2), fold("right", "under", 2)],
  [fold("left", "under", 2), fold("up", "under", 2)],
  [fold("right", "under", 2), fold("down", "under", 2)],
];
// The 5×5 paper uses an honest between-cell crease: initially two rows/columns
// fold onto three. The second half introduces one-row/column flaps. Wizard uses
// exactly the same programs and density, removing the first operation cue.
const ADVANCED: readonly (readonly FoldInstruction[])[] = [
  [fold("up", "over", 3), fold("left", "over", 3)],
  [fold("down", "under", 2), fold("right", "over", 2)],
  [fold("left", "over", 3), fold("up", "under", 3)],
  [fold("right", "under", 2), fold("down", "under", 2)],
  [fold("up", "under", 3), fold("right", "under", 2)],
  [fold("down", "over", 2), fold("left", "under", 3)],
  [fold("left", "over", 4), fold("up", "under", 3)],
  [fold("right", "under", 1), fold("down", "over", 2)],
  [fold("up", "over", 4), fold("left", "over", 3)],
  [fold("down", "under", 1), fold("right", "under", 2)],
  [fold("left", "under", 4), fold("down", "under", 1)],
  [fold("right", "over", 1), fold("up", "over", 4)],
];
// Final target-cell inputs, derived from the authored crease geometry and
// reviewed here. Every selected cell contains four layers, never an edge singleton.
const ADVANCED_TARGETS = [4, 0, 4, 0, 3, 1, 7, 0, 10, 0, 3, 12] as const;
function authoredLevel(difficulty: Difficulty): AuthoredFoldedItemsRoundSpec[] {
  return Array.from({ length: 12 }, (_, index) => {
    const easy = difficulty === "Easy"; const junior = difficulty === "Medium";
    const verticalStarter = index < 6;
    return {
      difficulty, rows: easy ? verticalStarter ? 2 : 4 : junior ? 4 : 5,
      cols: easy ? verticalStarter ? 4 : 2 : junior ? 4 : 5,
      itemStyle: STYLES[index], itemOrder: easy ? EIGHT : junior ? SIXTEEN : TWENTY_FIVE,
      folds: easy ? [fold(STARTER[index], "over", 1)] : junior ? JUNIOR[index] : ADVANCED[index],
      targetCell: easy || junior ? [0, 2, 3, 1, 0, 3, 2, 1, 0, 3, 2, 1][index] : ADVANCED_TARGETS[index],
      targetDepth: easy ? 1 : (index + (difficulty === "Wizard" ? 1 : 0)) % 4,
      correctIndex: (ANSWERS[index] + (difficulty === "Medium" ? 2 : difficulty === "Hard" ? 3 : difficulty === "Wizard" ? 1 : 0)) % 4,
      distractorSalt: index, numberOffset: 1,
    };
  });
}
export const CAMPAIGN_ROUND_SPECS: readonly AuthoredFoldedItemsRoundSpec[] = [
  ...authoredLevel("Easy"), ...authoredLevel("Medium"), ...authoredLevel("Hard"), ...authoredLevel("Wizard"),
];
