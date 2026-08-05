import type { AdaptiveSubtractionProgress } from "../adaptive-storage.ts";
import { skillIsDemonstrated } from "./planner.ts";

/**
 * Choose the next diagnostic placement session from completed evidence only.
 * A child who stops early resumes the same placement step on the next visit.
 */
export function diagnosticSessionNumber(
  progress: Pick<
    AdaptiveSubtractionProgress,
    "attemptEvents" | "completedSessions" | "skillStates"
  >,
): 1 | 2 | 3 | undefined {
  const completed = progress.completedSessions.filter(
    ({ kind, sessionId, completedAsPlanned }) =>
      kind === "diagnostic" &&
      completedAsPlanned &&
      progress.attemptEvents.filter(
        (attempt) => attempt.sessionId === sessionId && !attempt.skipped,
      ).length >= 6,
  ).length;
  if (completed === 0) return 1;
  if (completed === 1) return 2;
  if (completed >= 3) return undefined;
  return skillIsDemonstrated(progress.skillStates.A02) &&
    skillIsDemonstrated(progress.skillStates.A03)
    ? undefined
    : 3;
}
