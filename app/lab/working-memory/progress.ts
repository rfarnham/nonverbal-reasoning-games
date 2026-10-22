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
import {
  digitTaskForVariant,
  digitVariantFromLegacy,
  digitVariantKey,
  enumerateDigitVariants,
  isCanonicalDigitVariant,
  type DigitVariant,
  type InputMode,
} from "./digit-options.ts";
export type { InputMode } from "./digit-options.ts";

export interface SessionCondition {
  slow: boolean;
  inputMode: InputMode;
  digitOrder: DigitOrder;
  /** Missing only for a session started before the unified digit family. */
  digitVariant?: DigitVariant;
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
  digitVariant?: DigitVariant;
}

export interface Saved extends SessionCondition {
  version: 3;
  digitVariant: DigitVariant;
  session: MemoryProgress | null;
  /** The session's exact state; use selectTaskStates for a new session. */
  tasks: TaskStates;
  /** Original-profile history is retained separately from research-profile records. */
  legacyTasks: TaskStates;
  conditions: Record<string, TaskState>;
  /** Earlier independent trajectories retain their original first-attempt totals. */
  archivedConditions: Record<string, TaskState>;
  /** Immutable settings for the retained session, even after settings change. */
  sessionCondition: SessionCondition | null;
  logs: Log[];
  redeemed: string[];
  /** Cosmetic choice only; encrypted with the rest of this lab's progress. */
  buddy?: string;
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
    && (settings.digitOrder === "ascending" || settings.digitOrder === "descending")
    && (settings.digitVariant === undefined || (isCanonicalDigitVariant(settings.digitVariant)
      && settings.inputMode === settings.digitVariant.inputMode
      && (settings.digitVariant.order === "reverse" || settings.digitOrder === settings.digitVariant.order)));
}

function snapshot(settings: SessionCondition): SessionCondition {
  return {
    slow: settings.slow, inputMode: settings.inputMode, digitOrder: settings.digitOrder,
    ...(settings.digitVariant ? { digitVariant: { ...settings.digitVariant } } : {}),
  };
}

/** Visual tasks ignore the audio-input setting; only sorting distinguishes order. */
export function conditionKey(task: TaskId, settings: SessionCondition): string {
  if (!TASK_IDS.includes(task) || !condition(settings)) throw new TypeError("Invalid play condition.");
  const audio = AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number]);
  if (audio && settings.digitVariant) return `digits|${settings.slow ? "slow" : "standard"}|${digitVariantKey(settings.digitVariant)}`;
  return `${task}|${settings.slow ? "slow" : "standard"}|${audio ? settings.inputMode : "keypad"}|${task === "sort-digits" ? settings.digitOrder : "none"}`;
}

const archivedTasks = new Map<string, { task: TaskId; settings: SessionCondition }>();
for (const task of TASK_IDS) {
  for (const slow of [false, true]) {
    for (const inputMode of ["keypad", "spoken"] as const) {
      for (const digitOrder of ["ascending", "descending"] as const) {
        const settings = { slow, inputMode, digitOrder };
        archivedTasks.set(conditionKey(task, settings), { task, settings });
      }
    }
  }
}

const conditionTasks = new Map<string, TaskId>();
for (const [key, { task }] of archivedTasks) {
  if (!AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number])) conditionTasks.set(key, task);
}
for (const slow of [false, true]) {
  for (const digitVariant of enumerateDigitVariants()) {
    const settings: SessionCondition = {
      slow, inputMode: digitVariant.inputMode,
      digitOrder: digitVariant.order === "reverse" ? "ascending" : digitVariant.order, digitVariant,
    };
    conditionTasks.set(conditionKey("reverse-digits", settings), digitTaskForVariant(digitVariant));
  }
}

export function fresh(): Saved {
  return {
    version: 3,
    digitVariant: { order: "reverse", inputMode: "keypad", keypad: "visible" },
    session: null,
    tasks: createTaskStates(RESEARCH_PROFILE),
    legacyTasks: createTaskStates(),
    conditions: {},
    archivedConditions: {},
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
    const bank = settings.digitVariant ? saved.conditions : saved.archivedConditions;
    const stored = bank[conditionKey(task, settings)];
    if (stored) tasks[task] = { ...stored };
  }
  return tasks;
}

/** Resume only the selected focused practice; other choices start their own run. */
export function canResumePractice(saved: Saved, task: TaskId): boolean {
  const session = saved.session;
  const context = saved.sessionCondition;
  if (!session?.active || !session.focusedTask || !context || context.slow !== saved.slow) return false;
  const audio = AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number]);
  if (!audio) return session.focusedTask === task;
  if (!AUDIO_TASK_IDS.includes(session.focusedTask as (typeof AUDIO_TASK_IDS)[number])) return false;
  const variant = session.digitVariant ?? digitVariantFromLegacy(
    session.focusedTask, context.inputMode, session.digitOrder ?? context.digitOrder,
  );
  return variant !== null && digitVariantKey(variant) === digitVariantKey(saved.digitVariant);
}

/** Only one played predecessor may seed a canonical adaptive trajectory. */
function seedCanonical(archived: Record<string, TaskState>, existing: Record<string, TaskState>): Record<string, TaskState> {
  const sources = new Map<string, { task: TaskId; states: TaskState[] }>();
  for (const [key, state] of Object.entries(archived)) {
    const old = archivedTasks.get(key);
    if (!old) continue;
    const variant = digitVariantFromLegacy(old.task, old.settings.inputMode, old.settings.digitOrder);
    const canonicalKey = conditionKey(old.task, { ...old.settings, ...(variant ? { digitVariant: variant } : {}) });
    const task = variant ? digitTaskForVariant(variant) : old.task;
    const source = sources.get(canonicalKey) ?? { task, states: [] };
    if (state.attempts > 0) source.states.push(state);
    sources.set(canonicalKey, source);
  }
  const next = { ...existing };
  for (const [key, source] of sources) {
    if (next[key]?.attempts > 0) continue;
    const state = source.states.length === 1 ? source.states[0] : createTaskStates(RESEARCH_PROFILE)[source.task];
    next[key] = { ...state, attempts: 0, correct: 0, successStreak: 0 };
  }
  return next;
}

function sameCondition(first: SessionCondition, second: SessionCondition, canonical: boolean): boolean {
  return first.slow === second.slow && first.inputMode === second.inputMode
    && ((canonical && first.digitVariant?.order === "reverse") || first.digitOrder === second.digitOrder)
    && (!canonical || (first.digitVariant !== undefined && second.digitVariant !== undefined
      && digitVariantKey(first.digitVariant) === digitVariantKey(second.digitVariant)));
}

/**
 * Call before persisting every mutation. A retained session always writes to its
 * own immutable settings, so changing preferences cannot copy its
 * adaptive history into a different condition.
 */
export function normalizeSaved(saved: Saved): Saved {
  if (!condition(saved) || !isCanonicalDigitVariant(saved.digitVariant)) throw new TypeError("Invalid digit preferences.");
  const session = saved.session;
  if (!session) {
    const next = { ...saved, sessionCondition: null };
    return { ...next, tasks: selectTaskStates(next) };
  }
  if (!condition(saved.sessionCondition)) throw new TypeError("Session settings are missing.");
  const context = snapshot(saved.sessionCondition);
  const canonical = context.digitVariant !== undefined;
  const audio = session.plan.some((task) => AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number]));
  if ((!canonical && session.digitVariant !== undefined)
    || (canonical && (session.profile !== RESEARCH_PROFILE || (audio && session.digitVariant === undefined)
      || (session.digitVariant !== undefined && digitVariantKey(session.digitVariant) !== digitVariantKey(context.digitVariant!))))) {
    throw new TypeError("Session digit options do not match its play condition.");
  }
  if (session.plan.includes("sort-digits") && (session.digitOrder ?? "ascending") !== context.digitOrder) {
    throw new TypeError("Session sorting order does not match its play condition.");
  }
  if (session.profile === RESEARCH_PROFILE) {
    const bank = { ...(canonical ? saved.conditions : saved.archivedConditions) };
    for (const task of new Set(session.plan)) bank[conditionKey(task, context)] = { ...session.tasks[task] };
    return {
      ...saved, tasks: cloneTasks(session.tasks), sessionCondition: context,
      ...(canonical ? { conditions: bank } : { archivedConditions: bank, conditions: seedCanonical(bank, saved.conditions) }),
    };
  }
  const legacyTasks = cloneTasks(saved.legacyTasks);
  for (const task of new Set(session.plan)) legacyTasks[task] = { ...session.tasks[task] };
  return {
    ...saved, tasks: cloneTasks(session.tasks), legacyTasks, sessionCondition: context,
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
  for (const [key, state] of Object.entries(saved.archivedConditions)) {
    const task = archivedTasks.get(key)?.task;
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
      && (log.profile === undefined || log.profile === RESEARCH_PROFILE)
      && (log.digitVariant === undefined || (isCanonicalDigitVariant(log.digitVariant)
        && (log.inputMode === undefined || log.inputMode === log.digitVariant.inputMode)
        && (log.digitVariant.order === "reverse" || log.digitOrder === undefined || log.digitOrder === log.digitVariant.order)));
  });
}

function redemptionValid(value: unknown, session: MemoryProgress | null): value is string[] {
  return Array.isArray(value) && value.length <= (session?.length ?? 0)
    && new Set(value).size === value.length
    && value.every((id: unknown) => typeof id === "string"
      && session?.history.some((result) => result.round.id === id && !result.correct && result.retryCorrect !== false));
}

function conditionsValid(value: unknown, archived = false): value is Record<string, TaskState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > (archived ? archivedTasks.size : conditionTasks.size)) return false;
  return entries.every(([key, state]) => {
    const task = archived ? archivedTasks.get(key)?.task : conditionTasks.get(key);
    if (!task) return false;
    const tasks = createTaskStates(RESEARCH_PROFILE);
    tasks[task] = state;
    return validateTaskStates(tasks, RESEARCH_PROFILE);
  });
}

function sameTasks(first: TaskStates, second: TaskStates): boolean {
  return TASK_IDS.every((task) => sameState(first[task], second[task]));
}

function copyBank(bank: Record<string, TaskState>): Record<string, TaskState> {
  return Object.fromEntries(Object.entries(bank).map(([key, state]) => [key, { ...state }]));
}

function oldTaskStates(bank: Record<string, TaskState>, settings: SessionCondition): TaskStates {
  const tasks = createTaskStates(RESEARCH_PROFILE);
  for (const task of TASK_IDS) {
    const state = bank[conditionKey(task, settings)];
    if (state) tasks[task] = { ...state };
  }
  return tasks;
}

function sameState(first: TaskState, second: TaskState): boolean {
  return first.span === second.span && first.successStreak === second.successStreak
    && first.attempts === second.attempts && first.correct === second.correct && first.balance === second.balance
    && first.comfortSpan === second.comfortSpan && first.probeWait === second.probeWait
    && first.probeWins === second.probeWins && first.baseMisses === second.baseMisses
    && first.probeBackoff === second.probeBackoff;
}

function contextMatchesSession(session: MemoryProgress, context: SessionCondition): boolean {
  const canonical = context.digitVariant !== undefined;
  const audio = session.plan.some((task) => AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number]));
  if ((!canonical && session.digitVariant !== undefined)
    || (canonical && (session.profile !== RESEARCH_PROFILE || (audio && session.digitVariant === undefined)
      || (session.digitVariant !== undefined && digitVariantKey(session.digitVariant) !== digitVariantKey(context.digitVariant!))))) return false;
  return !session.plan.includes("sort-digits") || (session.digitOrder ?? "ascending") === context.digitOrder;
}

function migratedPreferences(settings: SessionCondition, session: MemoryProgress | null): DigitVariant {
  const task = session?.focusedTask ?? session?.active?.task ?? "reverse-digits";
  return digitVariantFromLegacy(task, settings.inputMode, settings.digitOrder)
    ?? digitVariantFromLegacy("reverse-digits", settings.inputMode, settings.digitOrder)!;
}

function migrate(
  session: MemoryProgress | null,
  settings: SessionCondition,
  context: SessionCondition | null,
  legacyTasks: TaskStates,
  archivedConditions: Record<string, TaskState>,
  logs: Log[],
  redeemed: string[],
): Saved {
  const saved: Saved = {
    ...fresh(), ...snapshot(settings), digitVariant: migratedPreferences(settings, session),
    session, sessionCondition: context ? snapshot(context) : null,
    legacyTasks: cloneTasks(legacyTasks), archivedConditions: copyBank(archivedConditions),
    conditions: seedCanonical(archivedConditions, {}), logs: logs.map((log) => ({ ...log })), redeemed: [...redeemed],
  };
  saved.tasks = session ? cloneTasks(session.tasks) : selectTaskStates(saved);
  return saved;
}

/** Validate old formats before archiving them; never rewrite their active engine session. */
export function restore(value: unknown): Saved | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    // A malformed cosmetic preference must never discard earned practice.
    const buddy = typeof data.buddy === "string" && data.buddy.trim().length > 0 && data.buddy.length <= 64
      ? { buddy: data.buddy } : {};
    if (![1, 2, 3].includes(data.version as number) || typeof data.slow !== "boolean"
      || (data.digitOrder !== undefined && data.digitOrder !== "ascending" && data.digitOrder !== "descending")
      || !logsValid(data.logs)) return null;
    const session = data.session === null ? null : validateProgress(data.session);
    if (data.session !== null && !session) return null;
    if (!redemptionValid(data.redeemed, session)) return null;

    if (data.version === 1) {
      if (!validateTaskStates(data.tasks) || session?.profile !== undefined || session?.digitVariant !== undefined
        || (session && !sameTasks(session.tasks, data.tasks))) return null;
      const settings: SessionCondition = {
        slow: data.slow, inputMode: "keypad", digitOrder: (data.digitOrder as DigitOrder | undefined) ?? "ascending",
      };
      let context: SessionCondition | null = null;
      if (session) {
        const completedLog = !session.active ? data.logs.find((log) => log.id === session.seed) : undefined;
        context = {
          slow: completedLog?.slow ?? settings.slow, inputMode: "keypad",
          digitOrder: session.plan.includes("sort-digits") ? session.digitOrder ?? "ascending" : settings.digitOrder,
        };
        if (session.active && !sameCondition(context, settings, false)) return null;
      }
      return { ...migrate(session, settings, context, data.tasks, {}, data.logs, data.redeemed), ...buddy };
    }

    if (!condition(data) || !validateTaskStates(data.legacyTasks)) return null;
    const settings = data as unknown as SessionCondition;
    if (session ? !condition(data.sessionCondition) : data.sessionCondition !== null) return null;
    const context = session ? snapshot(data.sessionCondition as SessionCondition) : null;
    const profile = session?.profile ?? (session ? undefined : RESEARCH_PROFILE);
    if (!validateTaskStates(data.tasks, profile)) return null;
    if (session && (!sameTasks(session.tasks, data.tasks) || !contextMatchesSession(session, context!)
      || (data.version === 2 && session.active && !sameCondition(context!, settings, context!.digitVariant !== undefined)))) return null;

    if (data.version === 2) {
      if (data.digitVariant !== undefined || context?.digitVariant !== undefined || session?.digitVariant !== undefined
        || !conditionsValid(data.conditions, true)) return null;
      if (session) {
        if (session.profile === RESEARCH_PROFILE) {
          if (!sameTasks(oldTaskStates(data.conditions, context!), session.tasks)) return null;
        } else if (!sameTasks(data.legacyTasks, session.tasks)) return null;
      } else if (!sameTasks(data.tasks, oldTaskStates(data.conditions, settings))) return null;
      return { ...migrate(session, settings, context, data.legacyTasks, data.conditions, data.logs, data.redeemed), ...buddy };
    }

    if (!isCanonicalDigitVariant(data.digitVariant) || !conditionsValid(data.conditions)
      || !conditionsValid(data.archivedConditions, true)) return null;
    const saved: Saved = {
      version: 3, ...snapshot(settings), digitVariant: { ...data.digitVariant }, session,
      tasks: cloneTasks(data.tasks), legacyTasks: cloneTasks(data.legacyTasks),
      conditions: copyBank(data.conditions), archivedConditions: copyBank(data.archivedConditions), sessionCondition: context,
      logs: data.logs.map((log) => ({ ...log, ...(log.digitVariant ? { digitVariant: { ...log.digitVariant } } : {}) })),
      redeemed: [...data.redeemed],
      ...buddy,
    };
    if (session) {
      if (session.profile === RESEARCH_PROFILE) {
        const bank = context!.digitVariant ? saved.conditions : saved.archivedConditions;
        const selected = context!.digitVariant ? selectTaskStates(saved, context!) : oldTaskStates(bank, context!);
        if (![...new Set(session.plan)].every((task) => sameState(selected[task], session.tasks[task]))) return null;
      } else if (![...new Set(session.plan)].every((task) => sameState(saved.legacyTasks[task], session.tasks[task]))) return null;
    } else if (!sameTasks(saved.tasks, selectTaskStates(saved))) return null;
    return saved;
  } catch {
    return null;
  }
}
