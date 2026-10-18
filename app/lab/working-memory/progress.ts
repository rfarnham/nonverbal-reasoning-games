/** Versioned local progress and separate adaptive records for each play condition. */
import {
  AUDIO_TASK_IDS,
  RESEARCH_PROFILE,
  TASK_IDS,
  createTaskStates,
  validateProgress,
  validateTaskStates,
  type DifficultyProfile,
  type DigitOrder,
  type MemoryProgress,
  type TaskId,
  type TaskState,
  type TaskStates,
} from "./engine.ts";

export type InputMode = "keypad" | "spoken";

export interface SessionCondition {
  slow: boolean;
  inputMode: InputMode;
  digitOrder: DigitOrder;
}

export interface Log {
  id: string;
  date: string;
  rounds: number;
  correct: number;
  maxSpan: number;
  slow: boolean;
  modality: string;
  digitOrder?: DigitOrder;
  inputMode?: InputMode;
  profile?: DifficultyProfile;
}

export interface Saved extends SessionCondition {
  version: 2;
  session: MemoryProgress | null;
  /** The session's exact state; use selectTaskStates for a new session. */
  tasks: TaskStates;
  /** Original-profile history is retained separately from research-profile records. */
  legacyTasks: TaskStates;
  conditions: Record<string, TaskState>;
  /** Immutable settings for the retained session, even after settings change. */
  sessionCondition: SessionCondition | null;
  logs: Log[];
  redeemed: string[];
}

export type TaskTotals = Record<TaskId, { attempts: number; correct: number }>;

function cloneTasks(tasks: TaskStates): TaskStates {
  return Object.fromEntries(TASK_IDS.map((task) => [task, { ...tasks[task] }])) as TaskStates;
}

function condition(value: unknown): value is SessionCondition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as SessionCondition;
  return typeof settings.slow === "boolean"
    && (settings.inputMode === "keypad" || settings.inputMode === "spoken")
    && (settings.digitOrder === "ascending" || settings.digitOrder === "descending");
}

function snapshot(settings: SessionCondition): SessionCondition {
  return { slow: settings.slow, inputMode: settings.inputMode, digitOrder: settings.digitOrder };
}

/** Visual tasks ignore the audio-input setting; only sorting distinguishes order. */
export function conditionKey(task: TaskId, settings: SessionCondition): string {
  if (!TASK_IDS.includes(task) || !condition(settings)) throw new TypeError("Invalid play condition.");
  const audio = AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number]);
  return `${task}|${settings.slow ? "slow" : "standard"}|${audio ? settings.inputMode : "keypad"}|${task === "sort-digits" ? settings.digitOrder : "none"}`;
}

const conditionTasks = new Map<string, TaskId>();
for (const task of TASK_IDS) {
  for (const slow of [false, true]) {
    for (const inputMode of ["keypad", "spoken"] as const) {
      for (const digitOrder of ["ascending", "descending"] as const) {
        conditionTasks.set(conditionKey(task, { slow, inputMode, digitOrder }), task);
      }
    }
  }
}

export function fresh(): Saved {
  return {
    version: 2,
    session: null,
    tasks: createTaskStates(RESEARCH_PROFILE),
    legacyTasks: createTaskStates(),
    conditions: {},
    sessionCondition: null,
    logs: [],
    redeemed: [],
    slow: false,
    digitOrder: "ascending",
    inputMode: "keypad",
  };
}

/** Select only the relevant records; missing conditions start independently. */
export function selectTaskStates(saved: Saved, settings: SessionCondition = saved): TaskStates {
  const tasks = createTaskStates(RESEARCH_PROFILE);
  for (const task of TASK_IDS) {
    const stored = saved.conditions[conditionKey(task, settings)];
    if (stored) tasks[task] = { ...stored };
  }
  return tasks;
}

/**
 * Call before persisting every mutation. A retained session always writes to its
 * own immutable settings, so changing settings after completion cannot copy its
 * adaptive history into a different condition.
 */
export function normalizeSaved(saved: Saved): Saved {
  const session = saved.session;
  if (!session) {
    const next = { ...saved, sessionCondition: null };
    return { ...next, tasks: selectTaskStates(next) };
  }
  if (!condition(saved.sessionCondition)) throw new TypeError("Session settings are missing.");
  const context = snapshot(saved.sessionCondition);
  if (session.active && JSON.stringify(context) !== JSON.stringify(snapshot(saved))) {
    throw new TypeError("Finish the active session before changing its play conditions.");
  }
  if (session.plan.includes("sort-digits") && (session.digitOrder ?? "ascending") !== context.digitOrder) {
    throw new TypeError("Session sorting order does not match its play condition.");
  }
  if (session.profile === RESEARCH_PROFILE) {
    const conditions = { ...saved.conditions };
    for (const task of TASK_IDS) conditions[conditionKey(task, context)] = { ...session.tasks[task] };
    return { ...saved, tasks: cloneTasks(session.tasks), conditions, sessionCondition: context };
  }
  return {
    ...saved, tasks: cloneTasks(session.tasks), legacyTasks: cloneTasks(session.tasks), sessionCondition: context,
  };
}

/** Historical totals count each independent condition once, plus retained legacy play. */
export function taskTotals(saved: Saved): TaskTotals {
  const totals = Object.fromEntries(TASK_IDS.map((task) => [task, {
    attempts: saved.legacyTasks[task].attempts,
    correct: saved.legacyTasks[task].correct,
  }])) as TaskTotals;
  for (const [key, state] of Object.entries(saved.conditions)) {
    const task = conditionTasks.get(key);
    if (task) {
      totals[task].attempts += state.attempts;
      totals[task].correct += state.correct;
    }
  }
  return totals;
}

function logsValid(value: unknown): value is Log[] {
  return Array.isArray(value) && value.length <= 500 && value.every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const log = item as Log;
    return typeof log.id === "string" && log.id.length <= 256
      && typeof log.date === "string" && Number.isFinite(Date.parse(log.date))
      && [8, 24, 48].includes(log.rounds)
      && Number.isInteger(log.correct) && log.correct >= 0 && log.correct <= log.rounds
      && Number.isInteger(log.maxSpan) && log.maxSpan >= 0 && log.maxSpan <= 9
      && typeof log.slow === "boolean" && typeof log.modality === "string" && log.modality.length <= 64
      && (log.digitOrder === undefined || log.digitOrder === "ascending" || log.digitOrder === "descending")
      && (log.inputMode === undefined || log.inputMode === "keypad" || log.inputMode === "spoken")
      && (log.profile === undefined || log.profile === RESEARCH_PROFILE);
  });
}

function redemptionValid(value: unknown, session: MemoryProgress | null): value is string[] {
  return Array.isArray(value) && value.length <= (session?.length ?? 0)
    && new Set(value).size === value.length
    && value.every((id: unknown) => typeof id === "string"
      && session?.history.some((result) => result.round.id === id && !result.correct));
}

function conditionsValid(value: unknown): value is Record<string, TaskState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > conditionTasks.size) return false;
  return entries.every(([key, state]) => {
    const task = conditionTasks.get(key);
    if (!task) return false;
    const tasks = createTaskStates(RESEARCH_PROFILE);
    tasks[task] = state;
    return validateTaskStates(tasks, RESEARCH_PROFILE);
  });
}

function sameTasks(first: TaskStates, second: TaskStates): boolean {
  return TASK_IDS.every((task) => {
    const a = first[task];
    const b = second[task];
    return a.span === b.span && a.successStreak === b.successStreak
      && a.attempts === b.attempts && a.correct === b.correct && a.balance === b.balance;
  });
}

/** Strictly validate stored state, migrating original saves without replaying their answers. */
export function restore(value: unknown): Saved | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    if ((data.version !== 1 && data.version !== 2) || typeof data.slow !== "boolean"
      || (data.digitOrder !== undefined && data.digitOrder !== "ascending" && data.digitOrder !== "descending")
      || !logsValid(data.logs)) return null;
    const session = data.session === null ? null : validateProgress(data.session);
    if (data.session !== null && !session) return null;
    if (!redemptionValid(data.redeemed, session)) return null;

    if (data.version === 1) {
      if (!validateTaskStates(data.tasks) || session?.profile !== undefined
        || (session && !sameTasks(session.tasks, data.tasks))) return null;
      const migrated: Saved = {
        ...fresh(), session, legacyTasks: cloneTasks(data.tasks), logs: data.logs,
        redeemed: [...data.redeemed], slow: data.slow,
        digitOrder: (data.digitOrder as DigitOrder | undefined) ?? "ascending",
      };
      if (session) {
        const completedLog = !session.active ? data.logs.find((log) => log.id === session.seed) : undefined;
        migrated.sessionCondition = {
          slow: completedLog?.slow ?? migrated.slow,
          inputMode: "keypad",
          digitOrder: session.plan.includes("sort-digits") ? session.digitOrder ?? "ascending" : migrated.digitOrder,
        };
        if (session.active && migrated.sessionCondition.digitOrder !== migrated.digitOrder) return null;
        migrated.tasks = cloneTasks(session.tasks);
      }
      return migrated;
    }

    if (!condition(data) || !validateTaskStates(data.legacyTasks) || !conditionsValid(data.conditions)) return null;
    const settings = data as unknown as SessionCondition;
    if (session ? !condition(data.sessionCondition) : data.sessionCondition !== null) return null;
    const profile = session?.profile ?? (session ? undefined : RESEARCH_PROFILE);
    if (!validateTaskStates(data.tasks, profile)) return null;
    const saved: Saved = {
      version: 2, session, tasks: cloneTasks(data.tasks), legacyTasks: cloneTasks(data.legacyTasks),
      conditions: Object.fromEntries(Object.entries(data.conditions).map(([key, state]) => [key, { ...state }])),
      sessionCondition: session ? snapshot(data.sessionCondition as SessionCondition) : null,
      logs: data.logs.map((log) => ({ ...log })), redeemed: [...data.redeemed], ...snapshot(settings),
    };
    if (session) {
      if (!sameTasks(session.tasks, saved.tasks)) return null;
      const context = saved.sessionCondition!;
      if (session.active && JSON.stringify(context) !== JSON.stringify(snapshot(saved))) return null;
      if (session.plan.includes("sort-digits") && (session.digitOrder ?? "ascending") !== context.digitOrder) return null;
      if (session.profile === RESEARCH_PROFILE) {
        if (!sameTasks(selectTaskStates(saved, context), session.tasks)) return null;
      } else if (!sameTasks(saved.legacyTasks, session.tasks)) return null;
    } else if (!sameTasks(saved.tasks, selectTaskStates(saved))) return null;
    return saved;
  } catch {
    return null;
  }
}
