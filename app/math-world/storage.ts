import {
  createInitialProgress,
  WORLD_PROGRESS_SCHEMA_VERSION,
  canOpenRequiredStop,
  canOpenWorld,
  nextRequiredStopId,
  type QuestionPhase,
  type StopAttempt,
  type WorldProgress,
} from "./engine.ts";
import { QUESTIONS_BY_STOP, REQUIRED_STOPS, WORLD_CONTENT_VERSION, WORLD_COMPATIBLE_CONTENT_VERSIONS, WORLD_DEFINITIONS, WORLD_MODE, worldForStop } from "./world-data.ts";
import { loadProgressionState } from "../../lib/progression/persistence.ts";
import { isJourneyTestProfile } from "../../lib/progression/test-mode.ts";
import type { StorageLike } from "../../lib/progression/types.ts";

const PROGRESS_KEY = WORLD_MODE === "spiral-preview" ? "spatial-gym-math-world-spiral-progress" : "spatial-gym-math-world-progress";
const PLAYTEST_PROGRESS_KEY = WORLD_MODE === "spiral-preview" ? "spatial-gym-math-world-spiral-playtest-progress" : "spatial-gym-math-world-playtest-progress";
const LEGACY_QA_KEY = "spatial-gym-math-world-qa";
const QA_KEY = `${LEGACY_QA_KEY}:${WORLD_MODE}:${WORLD_CONTENT_VERSION}`;
const PHASES = new Set<QuestionPhase>([
  "answering",
  "wrong-review",
  "retry",
  "correct",
]);
const STOP_IDS = new Set(REQUIRED_STOPS.map(({ id }) => id));

export type QaCategory =
  | "answer-key"
  | "prompt-wording"
  | "image-crop"
  | "curriculum-placement"
  | "difficulty-order"
  | "layout-accessibility"
  | "other";

export type QaRecord = Readonly<{
  questionId: string;
  stopId: string;
  categories: readonly QaCategory[];
  note: string;
  status: "looks-good" | "needs-change";
  firstSelectedIndex: number | null;
  updatedAt: string;
}>;

type QaArchive = Readonly<{
  schemaVersion: 1;
  contentVersion: string;
  records: Readonly<Record<string, QaRecord>>;
}>;

function cleanAttempt(value: unknown, stopId: string): StopAttempt | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StopAttempt>;
  const questions = QUESTIONS_BY_STOP.get(stopId);
  if (
    !questions ||
    !Number.isInteger(raw.questionIndex) ||
    Number(raw.questionIndex) < 0 ||
    Number(raw.questionIndex) >= questions.length
  ) return null;
  if (!PHASES.has(raw.phase as QuestionPhase)) return null;
  const question = questions[Number(raw.questionIndex)];
  const selectedIndex = raw.selectedIndex;
  if (
    selectedIndex !== null &&
    (!Number.isInteger(selectedIndex) || Number(selectedIndex) < 0 || Number(selectedIndex) >= question.choices.length)
  ) return null;
  if ((raw.phase === "answering") !== (selectedIndex === null)) return null;
  if (raw.phase !== "answering" && (raw.phase === "correct") !== (selectedIndex === question.correctIndex)) return null;

  const questionIds = new Set(questions.map(({ id }) => id));
  const attempt: StopAttempt = {
    questionIndex: Number(raw.questionIndex),
    phase: raw.phase as QuestionPhase,
    selectedIndex: selectedIndex === null ? null : Number(selectedIndex),
    firstTryCorrect:
      raw.firstTryCorrect && typeof raw.firstTryCorrect === "object"
        ? Object.fromEntries(
            Object.entries(raw.firstTryCorrect).filter(
              ([key, result]) => questionIds.has(key) && typeof result === "boolean",
            ),
          )
        : {},
    solvedQuestionIds: Array.isArray(raw.solvedQuestionIds)
      ? [...new Set(raw.solvedQuestionIds.filter((id): id is string => typeof id === "string" && questionIds.has(id)))]
      : [],
  };
  // A missing solved prefix would make the canonical Finish stop guard refuse
  // completion forever. Discard only that corrupt attempt and return to the map.
  const solvedPrefix = questions.slice(0, attempt.questionIndex + (attempt.phase === "correct" ? 1 : 0));
  if (!solvedPrefix.every(({ id }) => attempt.solvedQuestionIds.includes(id))) return null;
  return attempt;
}

/** Read the active Journey identity without modifying its progress or XP. */
export function readWorldPlaytestMode(storage?: StorageLike | null): boolean {
  const state = loadProgressionState(storage);
  const profile = state.profiles.find(({ id }) => id === state.activeProfileId);
  return profile !== undefined && isJourneyTestProfile(profile);
}

export function readWorldProgress(qaUnlocked = false): WorldProgress {
  try {
    const raw = window.localStorage.getItem(qaUnlocked ? PLAYTEST_PROGRESS_KEY : PROGRESS_KEY);
    if (!raw) return createInitialProgress();
    const parsed = JSON.parse(raw) as Partial<Omit<WorldProgress, "schemaVersion">> & { schemaVersion?: number };
    if (
      (parsed.schemaVersion !== WORLD_PROGRESS_SCHEMA_VERSION && !(WORLD_MODE === "prototype" && parsed.schemaVersion === 1)) ||
      !WORLD_COMPATIBLE_CONTENT_VERSIONS.has(parsed.contentVersion ?? "")
    ) {
      return createInitialProgress();
    }
    const completedStopIds = Array.isArray(parsed.completedStopIds)
      ? parsed.completedStopIds.filter(
          (id): id is string => typeof id === "string" && STOP_IDS.has(id),
        )
      : [];
    const stopAttempts: Record<string, StopAttempt> = {};
    if (parsed.stopAttempts && typeof parsed.stopAttempts === "object") {
      for (const [stopId, attempt] of Object.entries(parsed.stopAttempts)) {
        const cleaned = STOP_IDS.has(stopId) ? cleanAttempt(attempt, stopId) : null;
        if (cleaned) stopAttempts[stopId] = cleaned;
      }
    }
    const result: WorldProgress = {
      schemaVersion: 2,
      selectedWorldId: WORLD_DEFINITIONS.find(world => world.id === parsed.selectedWorldId)?.id ?? WORLD_DEFINITIONS[0].id,
      contentVersion: WORLD_CONTENT_VERSION,
      activeStopId:
        typeof parsed.activeStopId === "string" && Object.hasOwn(stopAttempts, parsed.activeStopId)
          ? parsed.activeStopId
          : null,
      checkpointStopId:
        typeof parsed.checkpointStopId === "string" && Object.hasOwn(stopAttempts, parsed.checkpointStopId)
          ? parsed.checkpointStopId
          : null,
      completedStopIds,
      stopAttempts,
    };
    const activeStopId = result.activeStopId && canOpenRequiredStop(result, result.activeStopId, qaUnlocked) ? result.activeStopId : null;
    const checkpointStopId = result.checkpointStopId && result.completedStopIds.includes(result.checkpointStopId) ? result.checkpointStopId : null;
    const selectedWorldId = worldForStop(activeStopId ?? checkpointStopId)?.id ?? (canOpenWorld(result, result.selectedWorldId, qaUnlocked) ? result.selectedWorldId : worldForStop(nextRequiredStopId(result))?.id ?? WORLD_DEFINITIONS[0].id);
    return { ...result, activeStopId, checkpointStopId, selectedWorldId };
  } catch {
    return createInitialProgress();
  }
}

export function writeWorldProgress(progress: WorldProgress, qaUnlocked = false): void {
  try {
    window.localStorage.setItem(
      qaUnlocked ? PLAYTEST_PROGRESS_KEY : PROGRESS_KEY,
      JSON.stringify(progress),
    );
  } catch {
    // Gameplay remains available in memory when storage is blocked or full.
  }
}

function emptyQaArchive(): QaArchive {
  return {
    schemaVersion: 1,
    contentVersion: WORLD_CONTENT_VERSION,
    records: {},
  };
}

export function readQaArchive(): QaArchive {
  try {
    const keys = [QA_KEY, ...[...WORLD_COMPATIBLE_CONTENT_VERSIONS].filter(version => version !== WORLD_CONTENT_VERSION)
      .map(version => `${LEGACY_QA_KEY}:${WORLD_MODE}:${version}`), LEGACY_QA_KEY];
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      let parsed: Partial<QaArchive> | null;
      try { parsed = JSON.parse(raw) as Partial<QaArchive> | null; } catch { continue; }
      if (!parsed || parsed.schemaVersion !== 1 || !WORLD_COMPATIBLE_CONTENT_VERSIONS.has(parsed.contentVersion ?? "")
        || !parsed.records || typeof parsed.records !== "object") continue;
      return { ...emptyQaArchive(), records: parsed.records as QaArchive["records"] };
    }
    return emptyQaArchive();
  } catch {
    return emptyQaArchive();
  }
}

export function writeQaRecord(record: QaRecord): QaArchive {
  const archive = readQaArchive();
  const next = { ...archive, records: { ...archive.records, [record.questionId]: record } };
  try {
    window.localStorage.setItem(QA_KEY, JSON.stringify(next));
  } catch {
    // The form still closes cleanly when storage is unavailable.
  }
  return next;
}

export function rememberFirstQaSelection(
  questionId: string,
  stopId: string,
  selectedIndex: number,
): void {
  const archive = readQaArchive();
  if (archive.records[questionId]?.firstSelectedIndex !== null && archive.records[questionId]) {
    return;
  }
  const existing = archive.records[questionId];
  writeQaRecord({
    questionId,
    stopId,
    categories: existing?.categories ?? [],
    note: existing?.note ?? "",
    status: existing?.status ?? "looks-good",
    firstSelectedIndex: selectedIndex,
    updatedAt: new Date().toISOString(),
  });
}

export function downloadQaArchive(): void {
  const archive = readQaArchive();
  const blob = new Blob([JSON.stringify(archive, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `math-worlds-qa-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
