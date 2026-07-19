import type {
  Difficulty,
  HintPolicy,
  RulePartId,
} from "./rule-engine";

export type RuleLessonMoment = "introduction" | "discovery";

/**
 * Pure transitions shared by the React page and its tests. Keeping these
 * decisions outside the component makes the tested behavior the behavior that
 * actually ships.
 */
export function hintRoundIdsAfterMiss(
  currentRoundIds: readonly string[],
  roundId: string,
  hintPolicy: HintPolicy,
): readonly string[] {
  if (
    hintPolicy !== "after-miss" ||
    currentRoundIds.includes(roundId)
  ) {
    return currentRoundIds;
  }
  return [...currentRoundIds, roundId];
}

export function unseenLessonPartIds(
  discoveredPartIds: readonly RulePartId[],
  pendingPartIds: readonly RulePartId[],
  encounteredPartIds: readonly RulePartId[],
): readonly RulePartId[] {
  const known = new Set<RulePartId>([
    ...discoveredPartIds,
    ...pendingPartIds,
  ]);
  const additions: RulePartId[] = [];

  for (const partId of encounteredPartIds) {
    if (known.has(partId)) continue;
    known.add(partId);
    additions.push(partId);
  }

  return additions;
}

export function ruleLessonMomentForDifficulty(
  difficulty: Difficulty,
): RuleLessonMoment {
  return difficulty === "Easy" || difficulty === "Medium"
    ? "introduction"
    : "discovery";
}

export function lessonPartIdsForMoment({
  difficulty,
  moment,
  discoveredPartIds,
  pendingPartIds,
  encounteredPartIds,
}: {
  difficulty: Difficulty;
  moment: RuleLessonMoment;
  discoveredPartIds: readonly RulePartId[];
  pendingPartIds: readonly RulePartId[];
  encounteredPartIds: readonly RulePartId[];
}): readonly RulePartId[] {
  if (ruleLessonMomentForDifficulty(difficulty) !== moment) return [];
  return unseenLessonPartIds(
    discoveredPartIds,
    pendingPartIds,
    encounteredPartIds,
  );
}

export function discoveredPartIdsAfterLesson(
  currentPartIds: readonly RulePartId[],
  completedPartId: RulePartId,
): readonly RulePartId[] {
  return currentPartIds.includes(completedPartId)
    ? currentPartIds
    : [...currentPartIds, completedPartId];
}

export function canOpenHistoricalReview({
  isIdle,
  isSolved,
  hasPendingLessons,
}: {
  isIdle: boolean;
  isSolved: boolean;
  hasPendingLessons: boolean;
}): boolean {
  return isIdle && isSolved && !hasPendingLessons;
}
