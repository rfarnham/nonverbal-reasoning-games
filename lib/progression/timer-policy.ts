import type { AttemptKind, AttemptPhase } from "./types.ts";

export type TurboClockPolicyInput = Readonly<{
  visible: boolean;
  attemptKind: AttemptKind;
  attemptPhase: AttemptPhase;
  hasCurrentQuestion: boolean;
  explanationOpen: boolean;
}>;

/**
 * Turbo is a wall-clock challenge while the player is in an active puzzle.
 * Routine feedback, teaching animations, and puzzle transitions still count;
 * only a hidden document or an explicit explanation modal pauses the clock.
 */
export function shouldCountTurboTime({
  visible,
  attemptKind,
  attemptPhase,
  hasCurrentQuestion,
  explanationOpen,
}: TurboClockPolicyInput): boolean {
  return (
    visible &&
    attemptKind === "turbo" &&
    attemptPhase === "playing" &&
    hasCurrentQuestion &&
    !explanationOpen
  );
}

export function shouldShowTurboPaused(
  input: Omit<TurboClockPolicyInput, "hasCurrentQuestion">,
): boolean {
  return (
    input.attemptKind === "turbo" &&
    input.attemptPhase === "playing" &&
    (!input.visible || input.explanationOpen)
  );
}
