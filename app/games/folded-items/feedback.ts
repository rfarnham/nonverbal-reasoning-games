import type { Round } from "./game-engine.ts";

/** Diagnose the attempted relationship without naming any missing item or fold. */
export function incorrectFeedback(round: Round, optionIndex: number | null): string {
  if (round.difficulty === "Wizard") return "This stack does not fit the evidence. Check both folds.";
  if (round.answerMode === "group") return "That item lands in a different stack. Trace it across the crease.";
  const option = optionIndex === null ? [] : round.options[optionIndex] ?? [];
  const sameItems = option.length === round.correctItems.length
    && option.every((id) => round.correctItems.includes(id));
  return sameItems
    ? "The items match, but their layer order does not. Check how each flap turns."
    : "An item in this stack lands elsewhere. Trace it through both folds.";
}
