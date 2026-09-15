import {
  freezeG1AttemptEvent,
  isG1AttemptEvent,
  type G1AttemptEvent,
} from "./mastery.ts";

export const ARITHMETIC_FLUENCY_STORAGE_KEY = "spatial-gym:arithmetic-fluency:g1";
export const ARITHMETIC_FLUENCY_SCHEMA_VERSION = 1 as const;
export const ARITHMETIC_FLUENCY_CONTENT_VERSION = "g1-v1";

/** Compatible with localStorage and Borrow Flash's profile-scoped adapter. */
export type ArithmeticFluencyStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type ArithmeticFluencyStore = Readonly<{
  schemaVersion: typeof ARITHMETIC_FLUENCY_SCHEMA_VERSION;
  contentVersion: string;
  attemptEvents: readonly G1AttemptEvent[];
  updatedAt: number;
}>;

export type ArithmeticFluencyLoadStatus =
  | "empty"
  | "loaded"
  | "migrated"
  | "corrupt"
  | "unsupported"
  | "unavailable";

export type ArithmeticFluencyLoadResult = Readonly<{
  store: ArithmeticFluencyStore;
  status: ArithmeticFluencyLoadStatus;
  /** Present only for diagnostics; no UI flow should depend on exact wording. */
  message: string | null;
}>;

export type ArithmeticFluencyWriteStatus =
  | "saved"
  | "unavailable"
  | "quota"
  | "unsupported"
  | "corrupt"
  | "conflict";

export type ArithmeticFluencyWriteResult = Readonly<{
  ok: boolean;
  status: ArithmeticFluencyWriteStatus;
  store: ArithmeticFluencyStore;
}>;

function checkedTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Storage update time must be finite and non-negative.");
  }
  return value;
}

function freezeStore(store: ArithmeticFluencyStore): ArithmeticFluencyStore {
  Object.freeze(store.attemptEvents);
  return Object.freeze(store);
}

export function createArithmeticFluencyStore(
  attemptEvents: readonly G1AttemptEvent[] = [],
  updatedAt = Date.now(),
): ArithmeticFluencyStore {
  const ids = new Set<string>();
  const normalized = attemptEvents.map((event) => {
    if (ids.has(event.id)) throw new TypeError(`Duplicate attempt event ID: ${event.id}`);
    ids.add(event.id);
    return freezeG1AttemptEvent(event);
  });
  return freezeStore({
    schemaVersion: ARITHMETIC_FLUENCY_SCHEMA_VERSION,
    contentVersion: ARITHMETIC_FLUENCY_CONTENT_VERSION,
    attemptEvents: normalized,
    updatedAt: checkedTime(updatedAt),
  });
}

export function arithmeticFluencyStorageKey(profileId: string): string {
  const normalized = profileId.trim();
  if (!normalized) throw new TypeError("Profile ID must be non-empty.");
  return `${ARITHMETIC_FLUENCY_STORAGE_KEY}:${encodeURIComponent(normalized)}`;
}

export function browserArithmeticFluencyStorage(): ArithmeticFluencyStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeEvents(value: unknown): readonly G1AttemptEvent[] | null {
  if (!Array.isArray(value) || !value.every(isG1AttemptEvent)) return null;
  const ids = new Set<string>();
  const events: G1AttemptEvent[] = [];
  for (const rawEvent of value) {
    if (ids.has(rawEvent.id)) return null;
    ids.add(rawEvent.id);
    events.push(freezeG1AttemptEvent(rawEvent));
  }
  return events;
}

export function decodeArithmeticFluencyStore(
  serialized: string,
): ArithmeticFluencyLoadResult {
  const empty = createArithmeticFluencyStore([], 0);
  try {
    const value = record(JSON.parse(serialized) as unknown);
    if (!value) {
      return { store: empty, status: "corrupt", message: "Stored data is not an object." };
    }
    const version = value.schemaVersion;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
      return { store: empty, status: "corrupt", message: "Storage version is invalid." };
    }
    if (version > ARITHMETIC_FLUENCY_SCHEMA_VERSION) {
      return {
        store: empty,
        status: "unsupported",
        message: `Storage schema ${version} is newer than this application supports.`,
      };
    }
    const events = decodeEvents(value.attemptEvents ?? value.events ?? value.attempts);
    const updatedAt =
      typeof value.updatedAt === "number" &&
      Number.isFinite(value.updatedAt) &&
      value.updatedAt >= 0
        ? value.updatedAt
        : 0;
    if (!events) {
      return { store: empty, status: "corrupt", message: "Attempt events are invalid." };
    }
    const store = createArithmeticFluencyStore(events, updatedAt);
    return {
      store: Object.freeze({
        ...store,
        contentVersion:
          typeof value.contentVersion === "string" && value.contentVersion.trim()
            ? value.contentVersion.trim()
            : ARITHMETIC_FLUENCY_CONTENT_VERSION,
      }),
      status: version === ARITHMETIC_FLUENCY_SCHEMA_VERSION ? "loaded" : "migrated",
      message: null,
    };
  } catch {
    return { store: empty, status: "corrupt", message: "Stored data is not valid JSON." };
  }
}

export function loadArithmeticFluencyDiagnostic(
  storage: ArithmeticFluencyStorage | null = browserArithmeticFluencyStorage(),
  storageKey = ARITHMETIC_FLUENCY_STORAGE_KEY,
): ArithmeticFluencyLoadResult {
  if (!storage) {
    return {
      store: createArithmeticFluencyStore([], 0),
      status: "unavailable",
      message: "Browser storage is unavailable.",
    };
  }
  try {
    const serialized = storage.getItem(storageKey);
    return serialized === null
      ? {
          store: createArithmeticFluencyStore([], 0),
          status: "empty",
          message: null,
        }
      : decodeArithmeticFluencyStore(serialized);
  } catch {
    return {
      store: createArithmeticFluencyStore([], 0),
      status: "unavailable",
      message: "Browser storage could not be read.",
    };
  }
}

export function loadArithmeticFluencyStore(
  storage: ArithmeticFluencyStorage | null = browserArithmeticFluencyStorage(),
  storageKey = ARITHMETIC_FLUENCY_STORAGE_KEY,
): ArithmeticFluencyStore {
  return loadArithmeticFluencyDiagnostic(storage, storageKey).store;
}

function quotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "QuotaExceededError" ||
    candidate.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}

export function saveArithmeticFluencyStore(
  store: ArithmeticFluencyStore,
  storage: ArithmeticFluencyStorage | null = browserArithmeticFluencyStorage(),
  storageKey = ARITHMETIC_FLUENCY_STORAGE_KEY,
): ArithmeticFluencyWriteResult {
  const normalized = createArithmeticFluencyStore(store.attemptEvents, store.updatedAt);
  if (!storage) return { ok: false, status: "unavailable", store: normalized };
  try {
    storage.setItem(storageKey, JSON.stringify(normalized));
    return { ok: true, status: "saved", store: normalized };
  } catch (error) {
    return {
      ok: false,
      status: quotaError(error) ? "quota" : "unavailable",
      store: normalized,
    };
  }
}

export function appendArithmeticAttempt(
  event: G1AttemptEvent,
  storage: ArithmeticFluencyStorage | null = browserArithmeticFluencyStorage(),
  storageKey = ARITHMETIC_FLUENCY_STORAGE_KEY,
  now = Date.now(),
): ArithmeticFluencyWriteResult {
  const immutableEvent = freezeG1AttemptEvent(event);
  const loaded = loadArithmeticFluencyDiagnostic(storage, storageKey);
  if (loaded.status === "unsupported" || loaded.status === "corrupt") {
    return {
      ok: false,
      status: loaded.status,
      store: loaded.store,
    };
  }
  if (loaded.status === "unavailable") {
    return { ok: false, status: "unavailable", store: loaded.store };
  }
  const existing = loaded.store.attemptEvents.find(({ id }) => id === immutableEvent.id);
  if (existing) {
    const identical = JSON.stringify(existing) === JSON.stringify(immutableEvent);
    return {
      ok: identical,
      status: identical ? "saved" : "conflict",
      store: loaded.store,
    };
  }
  const next = createArithmeticFluencyStore(
    [...loaded.store.attemptEvents, immutableEvent],
    checkedTime(now),
  );
  return saveArithmeticFluencyStore(next, storage, storageKey);
}

export function clearArithmeticFluencyData(
  storage: ArithmeticFluencyStorage | null = browserArithmeticFluencyStorage(),
  storageKey = ARITHMETIC_FLUENCY_STORAGE_KEY,
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export type ArithmeticFluencyRepository = Readonly<{
  load: () => ArithmeticFluencyLoadResult;
  append: (event: G1AttemptEvent, now?: number) => ArithmeticFluencyWriteResult;
  save: (store: ArithmeticFluencyStore) => ArithmeticFluencyWriteResult;
  clear: () => boolean;
}>;

/**
 * Bind once to Borrow Flash's profile-scoped Storage adapter. The adapter owns
 * profile isolation; this repository deliberately uses one stable inner key.
 */
export function createArithmeticFluencyRepository(
  storage: ArithmeticFluencyStorage,
  storageKey = ARITHMETIC_FLUENCY_STORAGE_KEY,
): ArithmeticFluencyRepository {
  return Object.freeze({
    load: () => loadArithmeticFluencyDiagnostic(storage, storageKey),
    append: (event, now) =>
      appendArithmeticAttempt(event, storage, storageKey, now ?? Date.now()),
    save: (store) => saveArithmeticFluencyStore(store, storage, storageKey),
    clear: () => clearArithmeticFluencyData(storage, storageKey),
  });
}
