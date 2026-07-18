export const MAX_ENERGY_COMBO = 8;

export type AdaptiveAttempt<Difficulty extends string> = {
  roundId: string;
  difficulty: Difficulty;
  firstTryCorrect: boolean;
};

export type AdaptiveState<Difficulty extends string> = {
  targetDifficulty: Difficulty;
  recentAtLevel: readonly boolean[];
  combo: number;
  attempts: readonly AdaptiveAttempt<Difficulty>[];
};

export function initialAdaptiveState<Difficulty extends string>(
  levels: readonly Difficulty[],
): AdaptiveState<Difficulty> {
  const firstLevel = levels[0];
  if (!firstLevel) {
    throw new Error("Adaptive progression needs at least one level.");
  }

  return {
    targetDifficulty: firstLevel,
    recentAtLevel: [],
    combo: 0,
    attempts: [],
  };
}

/**
 * Records one round's first attempt. Three wins at the active level promote;
 * two misses among the latest three demote. A round ID is counted only once.
 */
export function recordAdaptiveFirstAttempt<Difficulty extends string>(
  levels: readonly Difficulty[],
  state: AdaptiveState<Difficulty>,
  attempt: AdaptiveAttempt<Difficulty>,
): AdaptiveState<Difficulty> {
  if (state.attempts.some(({ roundId }) => roundId === attempt.roundId)) {
    return state;
  }

  const recentAtLevel =
    attempt.difficulty === state.targetDifficulty
      ? [...state.recentAtLevel, attempt.firstTryCorrect].slice(-3)
      : [attempt.firstTryCorrect];
  const currentIndex = levels.indexOf(attempt.difficulty);

  if (currentIndex < 0) {
    throw new Error(`Unknown adaptive difficulty: ${attempt.difficulty}`);
  }

  const shouldPromote =
    recentAtLevel.length === 3 && recentAtLevel.every(Boolean);
  const shouldDemote =
    recentAtLevel.length === 3 &&
    recentAtLevel.filter((correct) => !correct).length >= 2;
  const targetIndex = shouldPromote
    ? Math.min(levels.length - 1, currentIndex + 1)
    : shouldDemote
      ? Math.max(0, currentIndex - 1)
      : currentIndex;
  const levelChanged = targetIndex !== currentIndex;

  return {
    targetDifficulty: levels[targetIndex],
    recentAtLevel: levelChanged ? [] : recentAtLevel,
    combo: attempt.firstTryCorrect ? state.combo + 1 : 0,
    attempts: [...state.attempts, attempt],
  };
}

export function comboEnergyPercent(combo: number): number {
  if (!Number.isFinite(combo)) return 0;
  return Math.max(0, Math.min(100, (combo / MAX_ENERGY_COMBO) * 100));
}
