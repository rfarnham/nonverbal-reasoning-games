import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialAdaptiveState,
  recordAdaptiveFirstAttempt,
  type AdaptiveAttempt,
  type AdaptiveState,
} from "../../../lib/adaptive-progression.ts";
import type { Difficulty } from "./game-engine";

export { MAX_ENERGY_COMBO, comboEnergyPercent };
export type InfiniteAttempt = AdaptiveAttempt<Difficulty>;
export type InfiniteAdaptiveState = AdaptiveState<Difficulty>;

const DIFFICULTIES: readonly Difficulty[] = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
];

export function initialInfiniteAdaptiveState(): InfiniteAdaptiveState {
  return initialAdaptiveState(DIFFICULTIES);
}

/**
 * Records a unique round's first attempt. Three wins at the current level
 * promote; two misses among the latest three demote. Retries are ignored.
 */
export function recordInfiniteFirstAttempt(
  state: InfiniteAdaptiveState,
  attempt: InfiniteAttempt,
): InfiniteAdaptiveState {
  return recordAdaptiveFirstAttempt(DIFFICULTIES, state, attempt);
}
