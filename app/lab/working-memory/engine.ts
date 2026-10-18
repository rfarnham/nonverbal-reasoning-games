/** Pure, deterministic mechanics for the standalone working-memory lab. */
export const VISUAL_TASK_IDS = [
  "forward", "backward", "rotation", "tracking", "symbols", "locations", "pattern", "split",
] as const;
export const AUDIO_TASK_IDS = ["reverse-digits", "hidden-digits", "sort-digits"] as const;
export const TASK_IDS = [...VISUAL_TASK_IDS, ...AUDIO_TASK_IDS] as const;

export type TaskId = (typeof TASK_IDS)[number];
export type SessionModality = "visual" | "audio" | "mixed";
export const SESSION_TASK_POOLS = {
  visual: VISUAL_TASK_IDS,
  audio: AUDIO_TASK_IDS,
  mixed: ["forward", "rotation", "tracking", ...AUDIO_TASK_IDS],
} as const satisfies Record<SessionModality, readonly TaskId[]>;
export type Seed = string | number;
export type SessionLength = 8 | 24 | 48;
export type RotationDirection = "clockwise" | "counterclockwise";
export type DigitOrder = "ascending" | "descending";
/** Explicit opt-in: missing profiles always retain the original saved-session rules. */
export const RESEARCH_PROFILE = "research-v1" as const;
export type DifficultyProfile = typeof RESEARCH_PROFILE;
export type AnswerKind = "ordered-cells" | "unordered-cells" | "ordered-symbols" | "ordered-digits";
export type Swap = [number, number];

export interface MemoryRound {
  version: 1;
  id: string;
  task: TaskId;
  span: number;
  gridSize: 4;
  profile?: DifficultyProfile;
  /** Ordered cells, marker IDs, symbol IDs, or digits 1–9; pattern is a simultaneous set. */
  sequence: number[];
  expected: number[];
  answerKind: AnswerKind;
  rotation?: RotationDirection;
  /** Ascending remains implicit to retain existing saved round identities. */
  digitOrder?: DigitOrder;
  /** Initial cell per marker/symbol. Research binding rounds contain exactly span symbols. */
  positions?: number[];
  /** Swapped marker IDs, applied sequentially to positions. */
  moves?: Swap[];
  /** Symbol IDs to cue during location recall, in response order. */
  cues?: number[];
  fingerprint: string;
}

export interface TaskState {
  span: number;
  successStreak: 0 | 1;
  attempts: number;
  correct: number;
  /** Research profile's independent, 60%-inspired adaptive evidence; never used by legacy sessions. */
  balance?: number;
}
export type TaskStates = Record<TaskId, TaskState>;
export interface RoundResult { round: MemoryRound; correct: boolean }

export interface MemoryProgress {
  version: 1;
  seed: string;
  length: SessionLength;
  modality: SessionModality;
  profile?: DifficultyProfile;
  focusedTask?: TaskId;
  /** The sorting rule for Number Assembly; omitted means ascending. */
  digitOrder?: DigitOrder;
  /** Starting adaptive state is retained so stored progress can be replay-validated. */
  initialTasks: TaskStates;
  tasks: TaskStates;
  plan: TaskId[];
  cursor: number;
  history: RoundResult[];
  active: MemoryRound | null;
  answered: boolean;
}

export interface ProgressOptions { focusedTask?: TaskId; tasks?: TaskStates; modality?: SessionModality; digitOrder?: DigitOrder; profile?: DifficultyProfile }

export interface TaskProfile { minSpan: number; initialSpan: number; maxSpan: number }

const CELLS = Array.from({ length: 16 }, (_, index) => index);
const MIN_SPAN = 2;
const INITIAL_SPAN = 3;
const MAX_SPAN = 9;
const GENERATION_ATTEMPTS = 128;
const MAX_COUNT = 1_000_000;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

function randomFor(seed: Seed): () => number {
  let value = hash(String(seed));
  return () => {
    value += 0x6d2b79f5;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function idSequence(count: number, span: number, random: () => number): number[] {
  const sequence: number[] = [];
  for (let index = 0; index < span; index += 1) {
    const previous = sequence[index - 1];
    const options = Array.from({ length: count }, (_, id) => id).filter((id) => id !== previous);
    sequence.push(options[Math.floor(random() * options.length)]);
  }
  return sequence;
}

function isTask(value: unknown): value is TaskId {
  return typeof value === "string" && TASK_IDS.includes(value as TaskId);
}

function isModality(value: unknown): value is SessionModality {
  return value === "visual" || value === "audio" || value === "mixed";
}

function isDigitOrder(value: unknown): value is DigitOrder {
  return value === "ascending" || value === "descending";
}

function isProfile(value: unknown): value is DifficultyProfile {
  return value === RESEARCH_PROFILE;
}

/** Numeric starts and limits are conservative app choices, not published Cogmed norms. */
export function getTaskProfile(task: TaskId, profile?: DifficultyProfile): TaskProfile {
  if (!isTask(task)) throw new TypeError("Unknown memory task.");
  if (profile !== undefined && !isProfile(profile)) throw new TypeError("Unknown difficulty profile.");
  return {
    minSpan: MIN_SPAN,
    initialSpan: profile === RESEARCH_PROFILE && task !== "forward" && task !== "pattern" ? 2 : INITIAL_SPAN,
    maxSpan: profile === RESEARCH_PROFILE && task === "locations" ? 6 : MAX_SPAN,
  };
}

/** Study-time choices are presentation settings, not published Cogmed timing norms. */
export function studyDuration(round: Pick<MemoryRound, "task" | "span" | "profile">, slow = false): number {
  if (round.task === "locations" && round.profile === RESEARCH_PROFILE)
    return Math.max(5000, round.span * 1000) * (slow ? 1.5 : 1);
  const on = slow ? 1200 : 800;
  return on * Math.max(2, round.task === "locations" ? 4 : round.span * 0.6);
}

function assertSpan(span: number, task: TaskId, profile?: DifficultyProfile): void {
  const { minSpan, maxSpan } = getTaskProfile(task, profile);
  if (!Number.isInteger(span) || span < minSpan || span > maxSpan) {
    throw new RangeError(`Memory span must be an integer from ${minSpan} through ${maxSpan}.`);
  }
}

export function rotateCell(cell: number, direction: RotationDirection): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= 16) throw new RangeError("Invalid grid cell.");
  if (direction !== "clockwise" && direction !== "counterclockwise") throw new TypeError("Invalid turn.");
  const row = Math.floor(cell / 4);
  const column = cell % 4;
  return direction === "clockwise" ? column * 4 + (3 - row) : (3 - column) * 4 + row;
}

export function finalTrackingPositions(round: Pick<MemoryRound, "positions" | "moves">): number[] {
  if (!round.positions || !round.moves) throw new TypeError("Tracking round needs positions and moves.");
  const positions = [...round.positions];
  for (const [first, second] of round.moves) {
    if (first === second || !Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first >= positions.length || second >= positions.length) {
      throw new RangeError("Invalid marker swap.");
    }
    [positions[first], positions[second]] = [positions[second], positions[first]];
  }
  return positions;
}

/** Three successive adjacent cells on one straight line form an easy spatial chunk. */
export function hasStraightRun(sequence: readonly number[]): boolean {
  for (let index = 2; index < sequence.length; index += 1) {
    const [first, second, third] = sequence.slice(index - 2, index + 1);
    const rowStep = Math.floor(second / 4) - Math.floor(first / 4);
    const columnStep = second % 4 - first % 4;
    if (Math.abs(rowStep) <= 1 && Math.abs(columnStep) <= 1 && (rowStep !== 0 || columnStep !== 0)
      && Math.floor(third / 4) - Math.floor(second / 4) === rowStep
      && third % 4 - second % 4 === columnStep) return true;
  }
  return false;
}

function candidate(task: TaskId, span: number, seed: string, digitOrder: DigitOrder, profile?: DifficultyProfile): MemoryRound {
  const random = randomFor(seed);
  let sequence = shuffled(CELLS, random).slice(0, span);
  let expected = [...sequence];
  let answerKind: AnswerKind = "ordered-cells";
  let rotation: RotationDirection | undefined;
  let positions: number[] | undefined;
  let moves: Swap[] | undefined;
  let cues: number[] | undefined;

  if (task === "backward") expected.reverse();
  if (task === "rotation") {
    rotation = profile === RESEARCH_PROFILE ? "clockwise" : random() < 0.5 ? "clockwise" : "counterclockwise";
    expected = sequence.map((cell) => rotateCell(cell, rotation!));
  }
  if (task === "tracking") {
    positions = shuffled(CELLS, random).slice(0, 8);
    const moving = shuffled(Array.from({ length: 8 }, (_, id) => id), random);
    moves = [[moving[0], moving[1]], [moving[2], moving[3]], [moving[4], moving[5]]];
    sequence = idSequence(8, span, random);
    // At least one remembered identity must actually change location.
    if (!sequence.some((id) => moving.slice(0, 6).includes(id))) sequence[0] = moving[0];
    const final = finalTrackingPositions({ positions, moves });
    expected = sequence.map((id) => final[id]);
  }
  if (task === "symbols") {
    sequence = idSequence(6, span, random);
    expected = [...sequence];
    answerKind = "ordered-symbols";
  }
  if (task === "locations") {
    const bindings = profile === RESEARCH_PROFILE ? span : 6;
    positions = shuffled(CELLS, random).slice(0, bindings);
    cues = profile === RESEARCH_PROFILE
      ? shuffled(Array.from({ length: bindings }, (_, id) => id), random)
      : idSequence(6, span, random);
    sequence = [...cues];
    expected = cues.map((id) => positions![id]);
  }
  if (task === "pattern") {
    sequence.sort((first, second) => first - second);
    expected = [...sequence];
    answerKind = "unordered-cells";
  }
  if (task === "split") {
    const left = shuffled(CELLS.filter((cell) => cell % 4 < 2), random);
    const right = shuffled(CELLS.filter((cell) => cell % 4 >= 2), random);
    const startsLeft = random() < 0.5;
    sequence = Array.from({ length: span }, (_, index) => {
      const side = ((index % 2 === 0) === startsLeft) ? left : right;
      return side[Math.floor(index / 2)];
    });
    expected = [...sequence];
  }
  if (task === "reverse-digits" || task === "hidden-digits" || task === "sort-digits") {
    sequence = idSequence(9, span, random).map((id) => id + 1);
    expected = task === "sort-digits"
      ? [...sequence].sort((first, second) => digitOrder === "descending" ? second - first : first - second)
      : [...sequence].reverse();
    answerKind = "ordered-digits";
  }

  // A simultaneous set and disjoint swaps have one stable semantic fingerprint.
  const finalPositions = task === "tracking" ? finalTrackingPositions({ positions, moves }) : undefined;
  const fingerprintParts: unknown[] = [task, sequence, rotation ?? null, positions ?? null, finalPositions ?? null];
  const descendingDigits = task === "sort-digits" && digitOrder === "descending";
  // Keep ascending's original IDs stable, while distinguishing the new rule.
  if (descendingDigits) fingerprintParts.push("descending");
  if (profile !== undefined) fingerprintParts.push(profile);
  const fingerprint = JSON.stringify(fingerprintParts);
  return {
    version: 1, id: `${task}-${hash(fingerprint).toString(36)}`, task, span, gridSize: 4,
    ...(profile ? { profile } : {}),
    sequence, expected, answerKind,
    ...(rotation ? { rotation } : {}), ...(positions ? { positions } : {}),
    ...(descendingDigits ? { digitOrder: "descending" as const } : {}),
    ...(moves ? { moves } : {}), ...(cues ? { cues } : {}), fingerprint,
  };
}

/** Generation is reproducible and never returns a repeated session fingerprint. */
export function generateRound(task: TaskId, span: number, seed: Seed, seen: ReadonlySet<string> = new Set(), digitOrder: DigitOrder = "ascending", profile?: DifficultyProfile): MemoryRound {
  if (!isTask(task)) throw new TypeError("Unknown memory task.");
  if (!isDigitOrder(digitOrder)) throw new TypeError("Unknown digit order.");
  assertSpan(span, task, profile);
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const round = candidate(task, span, `${String(seed)}:candidate:${attempt}`, digitOrder, profile);
    if ((task === "forward" || task === "backward" || task === "rotation" || task === "split") && hasStraightRun(round.sequence)) continue;
    // Every audio manipulation must change the presented order, including palindromes.
    if (round.answerKind === "ordered-digits" && round.expected.every((digit, index) => digit === round.sequence[index])) continue;
    if (!seen.has(round.fingerprint)) return round;
  }
  throw new Error("Could not create a new memory round after 128 attempts.");
}

export function isCorrectResponse(round: MemoryRound, response: readonly number[]): boolean {
  if (response.length !== round.expected.length || response.some((value) => !Number.isInteger(value))) return false;
  if (round.answerKind === "unordered-cells") {
    if (new Set(response).size !== response.length) return false;
    return [...response].sort((first, second) => first - second).every((cell, index) => cell === round.expected[index]);
  }
  return response.every((value, index) => value === round.expected[index]);
}

/** Each block presents every task in the selected pool, with no repeated boundary task. */
export function createSessionPlan(length: SessionLength, seed: Seed, focusedTask?: TaskId, modality: SessionModality = "mixed"): TaskId[] {
  if (!isModality(modality)) throw new TypeError("Unknown session modality.");
  if (focusedTask !== undefined) {
    if (!isTask(focusedTask) || length !== 8) throw new TypeError("Focused practice contains eight rounds of one known task.");
    return Array.from({ length }, () => focusedTask);
  }
  if (length !== 24 && length !== 48) throw new RangeError("A balanced session contains 24 or 48 rounds.");
  const random = randomFor(`${String(seed)}:plan`);
  const pool = SESSION_TASK_POOLS[modality];
  const result: TaskId[] = [];
  for (let block = 0; block < length / pool.length; block += 1) {
    const tasks: TaskId[] = shuffled<TaskId>(pool, random);
    if (tasks[0] === result[result.length - 1]) [tasks[0], tasks[1]] = [tasks[1], tasks[0]];
    result.push(...tasks);
  }
  return result;
}

export function createTaskStates(profile?: DifficultyProfile): TaskStates {
  return Object.fromEntries(TASK_IDS.map((task) => [task, {
    span: getTaskProfile(task, profile).initialSpan, successStreak: 0, attempts: 0, correct: 0,
    ...(profile ? { balance: 0 } : {}),
  }])) as TaskStates;
}

function cloneTasks(tasks: TaskStates): TaskStates {
  return Object.fromEntries(TASK_IDS.map((task) => [task, { ...tasks[task] }])) as TaskStates;
}

export function validateTaskStates(value: unknown, profile?: DifficultyProfile): value is TaskStates {
  if (profile !== undefined && !isProfile(profile)) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tasks = value as Record<string, unknown>;
  if (Object.keys(tasks).length !== TASK_IDS.length) return false;
  return TASK_IDS.every((task) => {
    const state = tasks[task] as TaskState | undefined;
    const { minSpan, maxSpan } = getTaskProfile(task, profile);
    return !!state && typeof state === "object" && !Array.isArray(state)
      && Number.isInteger(state.span) && state.span >= minSpan && state.span <= maxSpan
      && (profile === RESEARCH_PROFILE
        ? state.successStreak === 0 && Number.isInteger(state.balance) && state.balance! >= -4 && state.balance! <= 4
        : (state.successStreak === 0 || state.successStreak === 1) && state.balance === undefined)
      && Number.isInteger(state.attempts) && state.attempts >= 0 && state.attempts <= MAX_COUNT
      && Number.isInteger(state.correct) && state.correct >= 0 && state.correct <= state.attempts
      && (state.successStreak === 0 || state.correct > 0);
  });
}

export function createProgress(seed: Seed, length: SessionLength = 24, options: ProgressOptions = {}): MemoryProgress {
  if ((typeof seed !== "string" && typeof seed !== "number") || String(seed).length > 256 || (typeof seed === "number" && !Number.isFinite(seed))) {
    throw new TypeError("Invalid session seed.");
  }
  if (options.profile !== undefined && !isProfile(options.profile)) throw new TypeError("Unknown difficulty profile.");
  if (options.tasks && !validateTaskStates(options.tasks, options.profile)) throw new TypeError("Invalid starting adaptive state.");
  if (options.digitOrder !== undefined && !isDigitOrder(options.digitOrder)) throw new TypeError("Unknown digit order.");
  const tasks = cloneTasks(options.tasks ?? createTaskStates(options.profile));
  const modality = options.modality ?? "mixed";
  const plan = createSessionPlan(length, seed, options.focusedTask, modality);
  const normalizedSeed = String(seed);
  return {
    version: 1, seed: normalizedSeed, length, modality,
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.focusedTask ? { focusedTask: options.focusedTask } : {}),
    ...(options.digitOrder === "descending" ? { digitOrder: options.digitOrder } : {}),
    initialTasks: cloneTasks(tasks), tasks, plan, cursor: 0, history: [], answered: false,
    active: generateRound(plan[0], tasks[plan[0]].span, `${normalizedSeed}:round:0`, undefined, options.digitOrder, options.profile),
  };
}

export function activeRound(progress: MemoryProgress): MemoryRound | null { return progress.active; }

/** A retry must not call this function: only the first committed response changes adaptation. */
export function recordFirstAttempt(progress: MemoryProgress, round: MemoryRound, correct: boolean): MemoryProgress {
  if (!progress.active || progress.answered || progress.cursor >= progress.length) throw new Error("This round has already recorded its first attempt.");
  if (typeof correct !== "boolean" || JSON.stringify(round) !== JSON.stringify(progress.active)) throw new TypeError("First attempt does not match the active round.");
  const tasks = cloneTasks(progress.tasks);
  const previous = tasks[round.task];
  if (progress.profile === RESEARCH_PROFILE) {
    // Henshaw et al. (2022) report an average daily 60% target, but do not
    // disclose Cogmed's controller. This is our own weighted staircase:
    // E[credit] = 2p - 3(1-p), which is zero at p=.60. It neither estimates
    // an individual's ability nor guarantees an observed 60% success rate.
    let balance = previous.balance! + (correct ? 2 : -3);
    const adjustment = balance >= 5 ? 1 : balance <= -5 ? -1 : 0;
    balance -= adjustment * 5;
    const { minSpan, maxSpan } = getTaskProfile(round.task, progress.profile);
    tasks[round.task] = {
      span: Math.max(minSpan, Math.min(maxSpan, previous.span + adjustment)),
      successStreak: 0, attempts: previous.attempts + 1,
      correct: previous.correct + (correct ? 1 : 0), balance,
    };
    return { ...progress, tasks, answered: true, history: [...progress.history, { round, correct }] };
  }
  const streak = correct ? previous.successStreak + 1 : 0;
  tasks[round.task] = {
    span: Math.max(MIN_SPAN, Math.min(MAX_SPAN, previous.span + (correct ? (streak === 2 ? 1 : 0) : -1))),
    successStreak: streak === 1 ? 1 : 0,
    attempts: previous.attempts + 1,
    correct: previous.correct + (correct ? 1 : 0),
  };
  return { ...progress, tasks, answered: true, history: [...progress.history, { round, correct }] };
}

export function advanceRound(progress: MemoryProgress): MemoryProgress {
  if (!progress.active || !progress.answered) throw new Error("Commit the active round before continuing.");
  const cursor = progress.cursor + 1;
  const task = progress.plan[cursor];
  const active = cursor >= progress.length ? null : generateRound(
    task, progress.tasks[task].span, `${progress.seed}:round:${cursor}`,
    new Set(progress.history.map((result) => result.round.fingerprint)),
    progress.digitOrder,
    progress.profile,
  );
  return { ...progress, cursor, active, answered: false };
}

/** Reject corrupted, incompatible, truncated, or internally inconsistent stored sessions. */
export function validateProgress(value: unknown): MemoryProgress | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const saved = value as MemoryProgress;
    if (saved.version !== 1 || typeof saved.seed !== "string" || saved.seed.length > 256
      || (saved.length !== 8 && saved.length !== 24 && saved.length !== 48)
      || !Number.isInteger(saved.cursor) || saved.cursor < 0 || saved.cursor > saved.length
      || typeof saved.answered !== "boolean" || !Array.isArray(saved.history) || saved.history.length > saved.length
      || (saved.profile !== undefined && !isProfile(saved.profile))
      || !validateTaskStates(saved.initialTasks, saved.profile) || !validateTaskStates(saved.tasks, saved.profile)) return null;
    if ((saved.modality !== undefined && !isModality(saved.modality))
      || (saved.focusedTask !== undefined && !isTask(saved.focusedTask))
      || (saved.digitOrder !== undefined && !isDigitOrder(saved.digitOrder))
      || saved.history.length !== saved.cursor + (saved.answered ? 1 : 0)
      || (saved.cursor === saved.length && saved.answered)) return null;
    let replay = createProgress(saved.seed, saved.length, {
      focusedTask: saved.focusedTask, tasks: saved.initialTasks, modality: saved.modality, digitOrder: saved.digitOrder, profile: saved.profile,
    });
    if (JSON.stringify(replay.plan) !== JSON.stringify(saved.plan)) return null;
    for (let index = 0; index < saved.history.length; index += 1) {
      const result = saved.history[index];
      if (!result || typeof result.correct !== "boolean" || JSON.stringify(result.round) !== JSON.stringify(replay.active)) return null;
      replay = recordFirstAttempt(replay, replay.active!, result.correct);
      if (index < saved.cursor) replay = advanceRound(replay);
    }
    if (JSON.stringify(replay.tasks) !== JSON.stringify(saved.tasks)
      || replay.cursor !== saved.cursor || replay.answered !== saved.answered
      || JSON.stringify(replay.active) !== JSON.stringify(saved.active)) return null;
    return replay;
  } catch { return null; }
}
