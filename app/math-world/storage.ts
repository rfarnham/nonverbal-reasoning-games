import {
  createInitialProgress,
  WORLD_PROGRESS_SCHEMA_VERSION,
  type QuestionPhase,
  type StopAttempt,
  type WorldProgress,
} from "./engine.ts";
import { REQUIRED_STOPS, WORLD_CONTENT_VERSION } from "./world-data.ts";

const PROGRESS_KEY = "spatial-gym-math-world-progress";
const QA_KEY = "spatial-gym-math-world-qa";
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

function cleanAttempt(value: unknown): StopAttempt | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StopAttempt>;
  if (!Number.isInteger(raw.questionIndex) || Number(raw.questionIndex) < 0) return null;
  if (!PHASES.has(raw.phase as QuestionPhase)) return null;
  return {
    questionIndex: Number(raw.questionIndex),
    phase: raw.phase as QuestionPhase,
    selectedIndex:
      Number.isInteger(raw.selectedIndex) && Number(raw.selectedIndex) >= 0
        ? Number(raw.selectedIndex)
        : null,
    firstTryCorrect:
      raw.firstTryCorrect && typeof raw.firstTryCorrect === "object"
        ? Object.fromEntries(
            Object.entries(raw.firstTryCorrect).filter(
              ([key, result]) => Boolean(key) && typeof result === "boolean",
            ),
          )
        : {},
    solvedQuestionIds: Array.isArray(raw.solvedQuestionIds)
      ? raw.solvedQuestionIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export function readWorldProgress(): WorldProgress {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return createInitialProgress();
    const parsed = JSON.parse(raw) as Partial<WorldProgress>;
    if (
      parsed.schemaVersion !== WORLD_PROGRESS_SCHEMA_VERSION ||
      parsed.contentVersion !== WORLD_CONTENT_VERSION
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
        const cleaned = STOP_IDS.has(stopId) ? cleanAttempt(attempt) : null;
        if (cleaned) stopAttempts[stopId] = cleaned;
      }
    }
    return {
      schemaVersion: 1,
      contentVersion: WORLD_CONTENT_VERSION,
      activeStopId:
        typeof parsed.activeStopId === "string" && STOP_IDS.has(parsed.activeStopId)
          ? parsed.activeStopId
          : null,
      checkpointStopId:
        typeof parsed.checkpointStopId === "string" && STOP_IDS.has(parsed.checkpointStopId)
          ? parsed.checkpointStopId
          : null,
      completedStopIds,
      stopAttempts,
    };
  } catch {
    return createInitialProgress();
  }
}

export function writeWorldProgress(progress: WorldProgress): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
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
    const parsed = JSON.parse(window.localStorage.getItem(QA_KEY) ?? "null") as Partial<QaArchive> | null;
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      parsed.contentVersion !== WORLD_CONTENT_VERSION ||
      !parsed.records ||
      typeof parsed.records !== "object"
    ) {
      return emptyQaArchive();
    }
    return { ...emptyQaArchive(), records: parsed.records as QaArchive["records"] };
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
  link.download = `counting-coast-qa-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
