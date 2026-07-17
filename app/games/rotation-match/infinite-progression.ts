import type { Difficulty } from "./game-engine";

export const MAX_ENERGY_COMBO = 8;

export type InfiniteAttempt = {
  roundId: string;
  difficulty: Difficulty;
  firstTryCorrect: boolean;
};

export type InfiniteAdaptiveState = {
  targetDifficulty: Difficulty;
  recentAtLevel: readonly boolean[];
  combo: number;
  attempts: readonly InfiniteAttempt[];
};

const DIFFICULTIES: readonly Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
  "Wizard",
];

const LEVEL_LABELS: Record<Difficulty, string> = {
  Easy: "Starter",
  Medium: "Junior",
  Hard: "Expert",
  Wizard: "Wizard",
};

export function initialInfiniteAdaptiveState(): InfiniteAdaptiveState {
  return {
    targetDifficulty: "Easy",
    recentAtLevel: [],
    combo: 0,
    attempts: [],
  };
}

/**
 * Records one puzzle's first attempt. Three wins at the current level promote;
 * two misses among the latest three demote. Repeated round IDs are ignored.
 */
export function recordInfiniteFirstAttempt(
  state: InfiniteAdaptiveState,
  attempt: InfiniteAttempt,
): InfiniteAdaptiveState {
  if (state.attempts.some(({ roundId }) => roundId === attempt.roundId)) {
    return state;
  }

  const recentAtLevel =
    attempt.difficulty === state.targetDifficulty
      ? [...state.recentAtLevel, attempt.firstTryCorrect].slice(-3)
      : [attempt.firstTryCorrect];
  const currentIndex = DIFFICULTIES.indexOf(attempt.difficulty);
  const shouldPromote =
    recentAtLevel.length === 3 && recentAtLevel.every(Boolean);
  const shouldDemote =
    recentAtLevel.length === 3 &&
    recentAtLevel.filter((correct) => !correct).length >= 2;
  const targetIndex = shouldPromote
    ? Math.min(DIFFICULTIES.length - 1, currentIndex + 1)
    : shouldDemote
      ? Math.max(0, currentIndex - 1)
      : currentIndex;
  const levelChanged = targetIndex !== currentIndex;

  return {
    targetDifficulty: DIFFICULTIES[targetIndex],
    recentAtLevel: levelChanged ? [] : recentAtLevel,
    combo: attempt.firstTryCorrect ? state.combo + 1 : 0,
    attempts: [...state.attempts, attempt],
  };
}

export function infiniteLevelLabel(difficulty: Difficulty): string {
  return LEVEL_LABELS[difficulty];
}

export function comboEnergyPercent(combo: number): number {
  if (!Number.isFinite(combo)) return 0;
  return Math.max(0, Math.min(100, (combo / MAX_ENERGY_COMBO) * 100));
}
