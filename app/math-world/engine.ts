import {
  QUESTIONS_BY_STOP,
  REQUIRED_STOPS,
  WORLD_CONTENT_VERSION,
  WORLD_DEFINITIONS,
  worldForStop,
  stopsForWorld,
  type WorldQuestion,
} from "./world-data.ts";

export const WORLD_PROGRESS_SCHEMA_VERSION = 2;

export type QuestionPhase = "answering" | "wrong-review" | "retry" | "correct";

export type StopAttempt = Readonly<{
  questionIndex: number;
  phase: QuestionPhase;
  selectedIndex: number | null;
  firstTryCorrect: Readonly<Record<string, boolean>>;
  solvedQuestionIds: readonly string[];
}>;

export type WorldProgress = Readonly<{
  schemaVersion: 2;
  selectedWorldId: string;
  contentVersion: string;
  activeStopId: string | null;
  checkpointStopId: string | null;
  completedStopIds: readonly string[];
  stopAttempts: Readonly<Record<string, StopAttempt>>;
}>;

export function createInitialProgress(): WorldProgress {
  return {
    schemaVersion: WORLD_PROGRESS_SCHEMA_VERSION,
    contentVersion: WORLD_CONTENT_VERSION,
    selectedWorldId: WORLD_DEFINITIONS[0].id,
    activeStopId: null,
    checkpointStopId: null,
    completedStopIds: [],
    stopAttempts: {},
  };
}

export function nextRequiredStopId(progress: WorldProgress, worldId?: string): string | null {
  return (
    (worldId ? stopsForWorld(worldId) : REQUIRED_STOPS).find(({ id }) => !progress.completedStopIds.includes(id))?.id ??
    null
  );
}

export function canOpenWorld(progress: WorldProgress, worldId: string, qaUnlocked = false): boolean {
  const index = WORLD_DEFINITIONS.findIndex(world => world.id === worldId);
  if (index < 0) return false;
  if (qaUnlocked) return true;
  // An inserted curriculum world never removes access to previously earned work.
  if (WORLD_DEFINITIONS[index].stopIds.some(id => progress.completedStopIds.includes(id) || Object.hasOwn(progress.stopAttempts, id))) return true;
  const next = worldForStop(nextRequiredStopId(progress));
  return !next || index <= WORLD_DEFINITIONS.findIndex(world => world.id === next.id);
}

export function selectWorld(progress: WorldProgress, worldId: string, qaUnlocked = false): WorldProgress {
  if (!canOpenWorld(progress, worldId, qaUnlocked)) return progress;
  return { ...progress, selectedWorldId: worldId, activeStopId: null, checkpointStopId: null };
}

export function canOpenRequiredStop(
  progress: WorldProgress,
  stopId: string,
  qaUnlocked = false,
): boolean {
  return (
    QUESTIONS_BY_STOP.has(stopId) &&
    (qaUnlocked ||
      progress.completedStopIds.includes(stopId) ||
      Object.hasOwn(progress.stopAttempts, stopId) ||
      nextRequiredStopId(progress) === stopId)
  );
}

export function startStop(
  progress: WorldProgress,
  stopId: string,
  qaUnlocked = false,
): WorldProgress {
  if (!canOpenRequiredStop(progress, stopId, qaUnlocked)) return progress;
  // Selecting a test stop starts a fresh, canonical attempt. Returning to the
  // map never traps a playtester in an unfinished run or a completed review.
  const existing = qaUnlocked ? undefined : progress.stopAttempts[stopId];
  const attempt: StopAttempt = existing ?? {
    questionIndex: 0,
    phase: "answering",
    selectedIndex: null,
    firstTryCorrect: {},
    solvedQuestionIds: [],
  };
  return {
    ...progress,
    activeStopId: stopId,
    selectedWorldId: worldForStop(stopId)!.id,
    checkpointStopId: null,
    stopAttempts: qaUnlocked
      ? { [stopId]: attempt }
      : { ...progress.stopAttempts, [stopId]: attempt },
  };
}

export function answerQuestion(
  progress: WorldProgress,
  stopId: string,
  question: WorldQuestion,
  selectedIndex: number,
): WorldProgress {
  const attempt = progress.stopAttempts[stopId];
  const canonicalQuestion = QUESTIONS_BY_STOP.get(stopId)?.[attempt?.questionIndex ?? -1];
  if (
    progress.activeStopId !== stopId ||
    !attempt ||
    !["answering", "retry"].includes(attempt.phase) ||
    !canonicalQuestion ||
    canonicalQuestion.id !== question.id ||
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= canonicalQuestion.choices.length
  ) return progress;

  const correct = selectedIndex === canonicalQuestion.correctIndex;
  const firstTryCorrect =
    question.id in attempt.firstTryCorrect
      ? attempt.firstTryCorrect
      : { ...attempt.firstTryCorrect, [question.id]: correct };
  const solvedQuestionIds = correct && !attempt.solvedQuestionIds.includes(question.id)
    ? [...attempt.solvedQuestionIds, question.id]
    : attempt.solvedQuestionIds;
  return {
    ...progress,
    stopAttempts: {
      ...progress.stopAttempts,
      [stopId]: {
        ...attempt,
        phase: correct ? "correct" : "wrong-review",
        selectedIndex,
        firstTryCorrect,
        solvedQuestionIds,
      },
    },
  };
}

export function allowRetry(progress: WorldProgress, stopId: string): WorldProgress {
  const attempt = progress.stopAttempts[stopId];
  if (progress.activeStopId !== stopId || !attempt || attempt.phase !== "wrong-review") return progress;
  return {
    ...progress,
    stopAttempts: {
      ...progress.stopAttempts,
      [stopId]: { ...attempt, phase: "retry" },
    },
  };
}

export function advanceQuestion(
  progress: WorldProgress,
  stopId: string,
  questionCount: number,
): WorldProgress {
  const attempt = progress.stopAttempts[stopId];
  const questions = QUESTIONS_BY_STOP.get(stopId);
  if (
    progress.activeStopId !== stopId ||
    !attempt ||
    attempt.phase !== "correct" ||
    !questions ||
    questionCount !== questions.length ||
    !attempt.solvedQuestionIds.includes(questions[attempt.questionIndex]?.id)
  ) return progress;
  if (attempt.questionIndex >= questionCount - 1) {
    return completeStop(progress, stopId);
  }
  return {
    ...progress,
    stopAttempts: {
      ...progress.stopAttempts,
      [stopId]: {
        ...attempt,
        questionIndex: attempt.questionIndex + 1,
        phase: "answering",
        selectedIndex: null,
      },
    },
  };
}

export function completeStop(progress: WorldProgress, stopId: string): WorldProgress {
  const attempt = progress.stopAttempts[stopId];
  const questions = QUESTIONS_BY_STOP.get(stopId);
  if (
    progress.activeStopId !== stopId ||
    !attempt ||
    attempt.phase !== "correct" ||
    !questions ||
    attempt.questionIndex !== questions.length - 1 ||
    !questions.every(({ id }) => attempt.solvedQuestionIds.includes(id))
  ) return progress;
  const completedStopIds = progress.completedStopIds.includes(stopId)
    ? progress.completedStopIds
    : [...progress.completedStopIds, stopId];
  return {
    ...progress,
    activeStopId: null,
    checkpointStopId: stopId,
    completedStopIds,
  };
}

export function leaveCheckpoint(progress: WorldProgress): WorldProgress {
  return { ...progress, checkpointStopId: null };
}

export function stopFirstTryAccuracy(
  attempt: StopAttempt | undefined,
  questions: readonly WorldQuestion[],
): number {
  if (!attempt || questions.length === 0) return 0;
  const correct = questions.filter(
    ({ id }) => attempt.firstTryCorrect[id] === true,
  ).length;
  return Math.round((correct / questions.length) * 100);
}
