import type { MkRound } from "../../journey/reviews/math-kangaroo/engine.ts";
import {
  DEFAULT_MK_LAB_FILTERS,
  MK_LAB_GRADE_BANDS,
  MK_LAB_MECHANICS,
  MK_LAB_POINT_VALUES,
  filterMkLabRounds,
  matchesMkLabFilters,
  mkLabAnswersFromSourceIndexes,
  type MkLabDraw,
  type MkLabFilters,
} from "./engine.ts";

export const MK_LAB_STORAGE_KEY = "spatial-gym-math-kangaroo-lab";
export const MK_LAB_STORAGE_SCHEMA_VERSION = 1;

export type MkLabStoredPhase = "answering" | "retry" | "solved";

export type MkLabSavedQuestion = Readonly<{
  roundId: string;
  sourceIndexes: readonly [number, number, number, number, number];
  phase: MkLabStoredPhase;
  selectedIndex: number | null;
  missed: boolean;
}>;

export type MkLabProgress = Readonly<{
  filters: MkLabFilters;
  seenIds: readonly string[];
  solvedCount: number;
  firstTryCorrectCount: number;
  current: MkLabSavedQuestion | null;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type StoredPayload = Readonly<{
  schemaVersion: number;
  contentVersion: string;
  progress: MkLabProgress;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function normalizeFilters(value: unknown): MkLabFilters | null {
  if (!isRecord(value)) return null;
  const gradeBand = value.gradeBand;
  const points = value.points;
  const mechanic = value.mechanic;
  if (
    gradeBand !== "all" &&
    !MK_LAB_GRADE_BANDS.includes(
      gradeBand as (typeof MK_LAB_GRADE_BANDS)[number],
    )
  ) {
    return null;
  }
  if (
    points !== "all" &&
    !MK_LAB_POINT_VALUES.includes(
      points as (typeof MK_LAB_POINT_VALUES)[number],
    )
  ) {
    return null;
  }
  if (
    mechanic !== "all" &&
    !MK_LAB_MECHANICS.includes(
      mechanic as (typeof MK_LAB_MECHANICS)[number],
    )
  ) {
    return null;
  }
  return {
    gradeBand: gradeBand as MkLabFilters["gradeBand"],
    points: points as MkLabFilters["points"],
    mechanic: mechanic as MkLabFilters["mechanic"],
  };
}

function normalizeCurrent(
  value: unknown,
  roundsById: ReadonlyMap<string, MkRound>,
  filters: MkLabFilters,
): MkLabSavedQuestion | null {
  if (!isRecord(value) || typeof value.roundId !== "string") return null;
  const round = roundsById.get(value.roundId);
  if (!round || !matchesMkLabFilters(round, filters)) return null;
  if (!Array.isArray(value.sourceIndexes)) return null;

  let answers: MkLabDraw["answers"];
  try {
    answers = mkLabAnswersFromSourceIndexes(round, value.sourceIndexes);
  } catch {
    return null;
  }

  const phase = value.phase;
  if (phase !== "answering" && phase !== "retry" && phase !== "solved") {
    return null;
  }
  const selectedIndex = value.selectedIndex;
  if (
    selectedIndex !== null &&
    (!Number.isInteger(selectedIndex) ||
      Number(selectedIndex) < 0 ||
      Number(selectedIndex) >= answers.length)
  ) {
    return null;
  }
  if (
    (phase === "answering" && selectedIndex !== null) ||
    (phase !== "answering" && selectedIndex === null) ||
    (phase === "retry" &&
      selectedIndex !== null &&
      answers[Number(selectedIndex)].correct) ||
    (phase === "solved" &&
      selectedIndex !== null &&
      !answers[Number(selectedIndex)].correct) ||
    typeof value.missed !== "boolean"
  ) {
    return null;
  }

  return {
    roundId: value.roundId,
    sourceIndexes: [...value.sourceIndexes] as unknown as
      MkLabSavedQuestion["sourceIndexes"],
    phase,
    selectedIndex: selectedIndex as number | null,
    missed: value.missed,
  };
}

export function emptyMkLabProgress(): MkLabProgress {
  return {
    filters: DEFAULT_MK_LAB_FILTERS,
    seenIds: [],
    solvedCount: 0,
    firstTryCorrectCount: 0,
    current: null,
  };
}

export function normalizeMkLabProgress(
  value: unknown,
  rounds: readonly MkRound[],
  contentVersion: string,
): MkLabProgress | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MK_LAB_STORAGE_SCHEMA_VERSION ||
    typeof value.contentVersion !== "string" ||
    !isRecord(value.progress)
  ) {
    return null;
  }

  const filters = normalizeFilters(value.progress.filters);
  if (!filters) return null;
  const solvedCount = value.progress.solvedCount;
  const firstTryCorrectCount = value.progress.firstTryCorrectCount;
  if (
    !nonnegativeInteger(solvedCount) ||
    !nonnegativeInteger(firstTryCorrectCount) ||
    firstTryCorrectCount > solvedCount
  ) {
    return null;
  }

  const roundsById = new Map(rounds.map((round) => [round.id, round]));
  const seenIds = Array.isArray(value.progress.seenIds)
    ? Array.from(
        new Set(
          value.progress.seenIds.filter(
            (roundId): roundId is string =>
              typeof roundId === "string" && roundsById.has(roundId),
          ),
        ),
      )
    : null;
  if (!seenIds) return null;

  const current =
    value.contentVersion === contentVersion
      ? normalizeCurrent(value.progress.current, roundsById, filters)
      : null;
  if (current && !seenIds.includes(current.roundId)) {
    seenIds.push(current.roundId);
  }

  return {
    filters,
    seenIds,
    solvedCount,
    firstTryCorrectCount,
    current,
  };
}

export function readMkLabProgress(
  storage: StorageLike | null,
  rounds: readonly MkRound[],
  contentVersion: string,
): MkLabProgress | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(MK_LAB_STORAGE_KEY);
    if (!serialized) return null;
    return normalizeMkLabProgress(
      JSON.parse(serialized),
      rounds,
      contentVersion,
    );
  } catch {
    return null;
  }
}

export function writeMkLabProgress(
  storage: StorageLike | null,
  progress: MkLabProgress,
  contentVersion: string,
): boolean {
  if (!storage) return false;
  const payload: StoredPayload = {
    schemaVersion: MK_LAB_STORAGE_SCHEMA_VERSION,
    contentVersion,
    progress,
  };
  try {
    storage.setItem(MK_LAB_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function restoreMkLabDraw(
  progress: MkLabProgress,
  rounds: readonly MkRound[],
): MkLabDraw | null {
  if (!progress.current) return null;
  const round = rounds.find(({ id }) => id === progress.current?.roundId);
  if (!round) return null;
  return {
    round,
    answers: mkLabAnswersFromSourceIndexes(
      round,
      progress.current.sourceIndexes,
    ),
    poolSize: filterMkLabRounds(rounds, progress.filters).length,
  };
}
