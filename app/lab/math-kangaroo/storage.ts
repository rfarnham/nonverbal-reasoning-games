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
export const MK_LAB_QA_STORAGE_KEY_PREFIX =
  "spatial-gym-math-kangaroo-lab-qa";
export const MK_LAB_QA_STORAGE_SCHEMA_VERSION = 1;

export const MK_LAB_QA_ISSUES = [
  "answer-key",
  "prompt-wording",
  "image-diagram",
  "classification",
  "layout-accessibility",
  "other",
] as const;

export type MkLabQaIssue = (typeof MK_LAB_QA_ISSUES)[number];
export type MkLabQaVerdict = "unreviewed" | "looks-good" | "needs-change";

export type MkLabQaEntry = Readonly<{
  verdict: MkLabQaVerdict;
  issues: readonly MkLabQaIssue[];
  notes: string;
  updatedAt: string;
  observedSourceIndexes?: readonly [number, number, number, number, number];
  selectedAnswerLetter?: "A" | "B" | "C" | "D" | "E" | null;
}>;

export type MkLabQaFeedback = Readonly<
  Partial<Record<string, MkLabQaEntry>>
>;

export type MkLabQaArchive = Readonly<{
  contentVersion: string;
  feedback: MkLabQaFeedback;
}>;

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

type EnumerableStorageLike = Pick<Storage, "getItem" | "key" | "length">;

type StoredPayload = Readonly<{
  schemaVersion: number;
  contentVersion: string;
  progress: MkLabProgress;
}>;

type StoredQaPayload = Readonly<{
  schemaVersion: number;
  contentVersion: string;
  feedback: MkLabQaFeedback;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function normalizeQaEntry(value: unknown): MkLabQaEntry | null {
  if (!isRecord(value)) return null;
  const verdict = value.verdict;
  if (
    verdict !== "unreviewed" &&
    verdict !== "looks-good" &&
    verdict !== "needs-change"
  ) {
    return null;
  }
  if (!Array.isArray(value.issues)) return null;
  const issues = Array.from(
    new Set(
      value.issues.filter(
        (issue): issue is MkLabQaIssue =>
          typeof issue === "string" &&
          MK_LAB_QA_ISSUES.includes(issue as MkLabQaIssue),
      ),
    ),
  );
  if (
    issues.length !== value.issues.length ||
    typeof value.notes !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return null;
  }
  const observedSourceIndexes = value.observedSourceIndexes;
  if (
    observedSourceIndexes !== undefined &&
    (!Array.isArray(observedSourceIndexes) ||
      observedSourceIndexes.length !== 5 ||
      new Set(observedSourceIndexes).size !== 5 ||
      observedSourceIndexes.some(
        (sourceIndex) =>
          !Number.isInteger(sourceIndex) ||
          Number(sourceIndex) < 0 ||
          Number(sourceIndex) > 4,
      ))
  ) {
    return null;
  }
  const selectedAnswerLetter = value.selectedAnswerLetter;
  if (
    selectedAnswerLetter !== undefined &&
    selectedAnswerLetter !== null &&
    !["A", "B", "C", "D", "E"].includes(String(selectedAnswerLetter))
  ) {
    return null;
  }
  return {
    verdict,
    issues,
    notes: value.notes.slice(0, 4_000),
    updatedAt: value.updatedAt,
    ...(observedSourceIndexes === undefined
      ? {}
      : {
          observedSourceIndexes: [...observedSourceIndexes] as unknown as
            NonNullable<MkLabQaEntry["observedSourceIndexes"]>,
        }),
    ...(selectedAnswerLetter === undefined
      ? {}
      : {
          selectedAnswerLetter:
            selectedAnswerLetter as MkLabQaEntry["selectedAnswerLetter"],
        }),
  };
}

export function mkLabQaStorageKey(contentVersion: string): string {
  return `${MK_LAB_QA_STORAGE_KEY_PREFIX}:${contentVersion}`;
}

export function emptyMkLabQaEntry(): MkLabQaEntry {
  return {
    verdict: "unreviewed",
    issues: [],
    notes: "",
    updatedAt: new Date(0).toISOString(),
  };
}

export function captureMkLabQaObservation(
  entry: MkLabQaEntry,
  observedSourceIndexes: readonly [number, number, number, number, number],
  selectedAnswerLetter: "A" | "B" | "C" | "D" | "E" | null,
): MkLabQaEntry {
  const existingOrder = entry.observedSourceIndexes;
  if (
    existingOrder &&
    existingOrder.some(
      (sourceIndex, index) => sourceIndex !== observedSourceIndexes[index],
    )
  ) {
    return entry;
  }
  const nextOrder = existingOrder ?? observedSourceIndexes;
  const nextLetter =
    entry.selectedAnswerLetter === undefined ||
    entry.selectedAnswerLetter === null
      ? selectedAnswerLetter
      : entry.selectedAnswerLetter;
  if (existingOrder && nextLetter === entry.selectedAnswerLetter) {
    return entry;
  }
  return {
    ...entry,
    observedSourceIndexes: nextOrder,
    selectedAnswerLetter: nextLetter,
    updatedAt: new Date().toISOString(),
  };
}

export function hasMkLabQaFeedback(entry: MkLabQaEntry | undefined): boolean {
  return Boolean(
    entry &&
      (entry.verdict !== "unreviewed" ||
        entry.issues.length > 0 ||
        entry.notes.trim()),
  );
}

function normalizeQaPayload(
  value: unknown,
  contentVersion: string,
  allowedRoundIds?: ReadonlySet<string>,
): MkLabQaFeedback | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MK_LAB_QA_STORAGE_SCHEMA_VERSION ||
    value.contentVersion !== contentVersion ||
    !isRecord(value.feedback)
  ) {
    return null;
  }
  const feedback: Record<string, MkLabQaEntry> = {};
  for (const [roundId, rawEntry] of Object.entries(value.feedback)) {
    if (allowedRoundIds && !allowedRoundIds.has(roundId)) continue;
    const entry = normalizeQaEntry(rawEntry);
    if (!entry) continue;
    if (hasMkLabQaFeedback(entry)) feedback[roundId] = entry;
  }
  return feedback;
}

export function normalizeMkLabQaFeedback(
  value: unknown,
  rounds: readonly MkRound[],
  contentVersion: string,
): MkLabQaFeedback | null {
  return normalizeQaPayload(
    value,
    contentVersion,
    new Set(rounds.map(({ id }) => id)),
  );
}

export function readMkLabQaFeedback(
  storage: StorageLike | null,
  rounds: readonly MkRound[],
  contentVersion: string,
): MkLabQaFeedback | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(mkLabQaStorageKey(contentVersion));
    if (!serialized) return null;
    return normalizeMkLabQaFeedback(
      JSON.parse(serialized),
      rounds,
      contentVersion,
    );
  } catch {
    return null;
  }
}

export function writeMkLabQaFeedback(
  storage: StorageLike | null,
  feedback: MkLabQaFeedback,
  contentVersion: string,
): boolean {
  if (!storage) return false;
  const payload: StoredQaPayload = {
    schemaVersion: MK_LAB_QA_STORAGE_SCHEMA_VERSION,
    contentVersion,
    feedback,
  };
  try {
    storage.setItem(
      mkLabQaStorageKey(contentVersion),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
}

export function readMkLabQaArchives(
  storage: EnumerableStorageLike | null,
  currentContentVersion: string,
): readonly MkLabQaArchive[] {
  if (!storage) return [];
  let storageLength: number;
  try {
    storageLength = storage.length;
  } catch {
    return [];
  }
  const prefix = `${MK_LAB_QA_STORAGE_KEY_PREFIX}:`;
  const archives: MkLabQaArchive[] = [];
  for (let index = 0; index < storageLength; index += 1) {
    try {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const contentVersion = key.slice(prefix.length);
      if (!contentVersion || contentVersion === currentContentVersion) continue;
      const serialized = storage.getItem(key);
      if (!serialized) continue;
      const feedback = normalizeQaPayload(
        JSON.parse(serialized),
        contentVersion,
      );
      if (
        feedback &&
        Object.values(feedback).some((entry) => hasMkLabQaFeedback(entry))
      ) {
        archives.push({ contentVersion, feedback });
      }
    } catch {
      continue;
    }
  }
  return archives.sort((left, right) =>
    left.contentVersion.localeCompare(right.contentVersion),
  );
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
