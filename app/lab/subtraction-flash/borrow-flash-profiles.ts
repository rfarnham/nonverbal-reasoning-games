import { ADAPTIVE_SUBTRACTION_STORAGE_KEY } from "./adaptive-storage.ts";
import {
  PERFORMANCE_LEGACY_STORAGE_KEY,
  PERFORMANCE_STORAGE_KEY,
} from "./performance-storage.ts";

export const BORROW_FLASH_PROFILE_SCHEMA_VERSION = 1 as const;
export const BORROW_FLASH_PROFILE_STORAGE_KEY =
  "spatial-gym:subtraction-flash:profiles:v1";
export const BORROW_FLASH_DEFAULT_PROFILE_ID = "default";
export const BORROW_FLASH_MAX_PROFILES = 8;
export const BORROW_FLASH_MAX_PROFILE_NAME_LENGTH = 24;

const PROFILE_DATA_PREFIX = "spatial-gym:subtraction-flash:profile-data:";
const PROFILE_NAME_MIN_LENGTH = 1;
const DEFAULT_PROFILE_NAME = "Player 1";

export type BorrowFlashProfile = Readonly<{
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}>;

export type BorrowFlashProfileRegistry = Readonly<{
  schemaVersion: typeof BORROW_FLASH_PROFILE_SCHEMA_VERSION;
  activeProfileId: string;
  profiles: readonly BorrowFlashProfile[];
}>;

export type BorrowFlashProfileStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type BorrowFlashProfileLoadStatus =
  | "empty"
  | "loaded"
  | "corrupt"
  | "unsupported"
  | "unavailable";

export type BorrowFlashProfilesDiagnostic = Readonly<{
  status: BorrowFlashProfileLoadStatus;
  registry: BorrowFlashProfileRegistry;
  canWrite: boolean;
  message: string | null;
}>;

export type BorrowFlashProfileMutationStatus =
  | "created"
  | "switched"
  | "renamed"
  | "cleared"
  | "unchanged"
  | "invalid-name"
  | "duplicate-name"
  | "limit-reached"
  | "not-found"
  | "corrupt"
  | "unsupported"
  | "unavailable"
  | "write-failed";

export type BorrowFlashProfileMutationResult = Readonly<{
  ok: boolean;
  status: BorrowFlashProfileMutationStatus;
  registry: BorrowFlashProfileRegistry;
  profile: BorrowFlashProfile | null;
  message: string | null;
}>;

const DEFAULT_PROFILE: BorrowFlashProfile = Object.freeze({
  id: BORROW_FLASH_DEFAULT_PROFILE_ID,
  name: DEFAULT_PROFILE_NAME,
  createdAt: 0,
  updatedAt: 0,
});

const DEFAULT_REGISTRY: BorrowFlashProfileRegistry = Object.freeze({
  schemaVersion: BORROW_FLASH_PROFILE_SCHEMA_VERSION,
  activeProfileId: BORROW_FLASH_DEFAULT_PROFILE_ID,
  profiles: Object.freeze([DEFAULT_PROFILE]),
});

const PROFILE_KEYS = ["id", "name", "createdAt", "updatedAt"] as const;
const REGISTRY_KEYS = ["schemaVersion", "activeProfileId", "profiles"] as const;
const PROFILE_ID_PATTERN = /^(?:default|profile-[a-z0-9-]{8,80})$/;

function browserStorage(): BorrowFlashProfileStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function normalizeProfileName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function validProfileName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name === normalizeProfileName(name) &&
    name.length >= PROFILE_NAME_MIN_LENGTH &&
    name.length <= BORROW_FLASH_MAX_PROFILE_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isProfile(value: unknown): value is BorrowFlashProfile {
  if (!isRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) return false;
  return (
    typeof value.id === "string" &&
    PROFILE_ID_PATTERN.test(value.id) &&
    validProfileName(value.name) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    value.updatedAt >= value.createdAt
  );
}

function isRegistry(value: unknown): value is BorrowFlashProfileRegistry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REGISTRY_KEYS) ||
    value.schemaVersion !== BORROW_FLASH_PROFILE_SCHEMA_VERSION ||
    typeof value.activeProfileId !== "string" ||
    !Array.isArray(value.profiles) ||
    value.profiles.length < 1 ||
    value.profiles.length > BORROW_FLASH_MAX_PROFILES ||
    !value.profiles.every(isProfile)
  ) {
    return false;
  }
  const ids = new Set(value.profiles.map((profile) => profile.id));
  const names = new Set(
    value.profiles.map((profile) => profile.name.toLocaleLowerCase()),
  );
  return (
    ids.size === value.profiles.length &&
    names.size === value.profiles.length &&
    ids.has(BORROW_FLASH_DEFAULT_PROFILE_ID) &&
    ids.has(value.activeProfileId)
  );
}

export function loadBorrowFlashProfilesDiagnostic(
  storage: BorrowFlashProfileStorage | null = browserStorage(),
): BorrowFlashProfilesDiagnostic {
  if (!storage) {
    return {
      status: "unavailable",
      registry: DEFAULT_REGISTRY,
      canWrite: false,
      message: "Player profiles are unavailable on this device.",
    };
  }
  let serialized: string | null;
  try {
    serialized = storage.getItem(BORROW_FLASH_PROFILE_STORAGE_KEY);
  } catch {
    return {
      status: "unavailable",
      registry: DEFAULT_REGISTRY,
      canWrite: false,
      message: "Player profiles could not be read from this device.",
    };
  }
  if (serialized === null) {
    return {
      status: "empty",
      registry: DEFAULT_REGISTRY,
      canWrite: true,
      message: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {
      status: "corrupt",
      registry: DEFAULT_REGISTRY,
      canWrite: false,
      message: "Saved player profiles are damaged and were left untouched.",
    };
  }
  if (
    isRecord(parsed) &&
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > BORROW_FLASH_PROFILE_SCHEMA_VERSION
  ) {
    return {
      status: "unsupported",
      registry: DEFAULT_REGISTRY,
      canWrite: false,
      message: "Player profiles were saved by a newer version and were left untouched.",
    };
  }
  if (!isRegistry(parsed)) {
    return {
      status: "corrupt",
      registry: DEFAULT_REGISTRY,
      canWrite: false,
      message: "Saved player profiles failed validation and were left untouched.",
    };
  }
  return {
    status: "loaded",
    registry: parsed,
    canWrite: true,
    message: null,
  };
}

export const loadBorrowFlashProfileDiagnostic =
  loadBorrowFlashProfilesDiagnostic;

function mutationFailure(
  diagnostic: BorrowFlashProfilesDiagnostic,
): BorrowFlashProfileMutationResult {
  const status = diagnostic.status === "empty" || diagnostic.status === "loaded"
    ? "write-failed"
    : diagnostic.status;
  return {
    ok: false,
    status,
    registry: diagnostic.registry,
    profile: null,
    message: diagnostic.message ?? "Player profiles could not be saved.",
  };
}

function persistMutation(
  storage: BorrowFlashProfileStorage | null,
  registry: BorrowFlashProfileRegistry,
  status: Extract<
    BorrowFlashProfileMutationStatus,
    "created" | "switched" | "renamed"
  >,
  profile: BorrowFlashProfile,
): BorrowFlashProfileMutationResult {
  if (!storage) {
    return {
      ok: false,
      status: "unavailable",
      registry,
      profile: null,
      message: "Player profiles are unavailable on this device.",
    };
  }
  try {
    storage.setItem(BORROW_FLASH_PROFILE_STORAGE_KEY, JSON.stringify(registry));
    return { ok: true, status, registry, profile, message: null };
  } catch {
    return {
      ok: false,
      status: "write-failed",
      registry,
      profile: null,
      message: "Player profiles could not be saved on this device.",
    };
  }
}

function newProfileId(existingIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let token: string;
    try {
      token = globalThis.crypto.randomUUID().toLowerCase();
    } catch {
      token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
    const id = `profile-${token}`;
    if (!existingIds.has(id)) return id;
  }
  return `profile-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}-fallback`;
}

function duplicateName(
  registry: BorrowFlashProfileRegistry,
  name: string,
  exceptId?: string,
): boolean {
  const foldedName = name.toLocaleLowerCase();
  return registry.profiles.some(
    (profile) =>
      profile.id !== exceptId && profile.name.toLocaleLowerCase() === foldedName,
  );
}

export function createBorrowFlashProfile(
  name: string,
  storage: BorrowFlashProfileStorage | null = browserStorage(),
): BorrowFlashProfileMutationResult {
  const diagnostic = loadBorrowFlashProfilesDiagnostic(storage);
  if (!diagnostic.canWrite) return mutationFailure(diagnostic);
  const normalizedName = normalizeProfileName(name);
  if (!validProfileName(normalizedName)) {
    return {
      ok: false,
      status: "invalid-name",
      registry: diagnostic.registry,
      profile: null,
      message: `Names must be ${PROFILE_NAME_MIN_LENGTH}–${BORROW_FLASH_MAX_PROFILE_NAME_LENGTH} characters.`,
    };
  }
  if (duplicateName(diagnostic.registry, normalizedName)) {
    return {
      ok: false,
      status: "duplicate-name",
      registry: diagnostic.registry,
      profile: null,
      message: "Choose a different player name.",
    };
  }
  if (diagnostic.registry.profiles.length >= BORROW_FLASH_MAX_PROFILES) {
    return {
      ok: false,
      status: "limit-reached",
      registry: diagnostic.registry,
      profile: null,
      message: `Borrow Flash supports up to ${BORROW_FLASH_MAX_PROFILES} players on this device.`,
    };
  }
  const now = Date.now();
  const profile: BorrowFlashProfile = {
    id: newProfileId(new Set(diagnostic.registry.profiles.map(({ id }) => id))),
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
  };
  const registry: BorrowFlashProfileRegistry = {
    schemaVersion: BORROW_FLASH_PROFILE_SCHEMA_VERSION,
    activeProfileId: profile.id,
    profiles: [...diagnostic.registry.profiles, profile],
  };
  return persistMutation(storage, registry, "created", profile);
}

export function setActiveBorrowFlashProfile(
  id: string,
  storage: BorrowFlashProfileStorage | null = browserStorage(),
): BorrowFlashProfileMutationResult {
  const diagnostic = loadBorrowFlashProfilesDiagnostic(storage);
  if (!diagnostic.canWrite) return mutationFailure(diagnostic);
  const profile = diagnostic.registry.profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    return {
      ok: false,
      status: "not-found",
      registry: diagnostic.registry,
      profile: null,
      message: "That player profile no longer exists.",
    };
  }
  if (diagnostic.registry.activeProfileId === profile.id) {
    return {
      ok: true,
      status: "unchanged",
      registry: diagnostic.registry,
      profile,
      message: null,
    };
  }
  const registry: BorrowFlashProfileRegistry = {
    ...diagnostic.registry,
    activeProfileId: profile.id,
  };
  return persistMutation(storage, registry, "switched", profile);
}

export const switchBorrowFlashProfile = setActiveBorrowFlashProfile;

export function renameBorrowFlashProfile(
  id: string,
  name: string,
  storage: BorrowFlashProfileStorage | null = browserStorage(),
): BorrowFlashProfileMutationResult {
  const diagnostic = loadBorrowFlashProfilesDiagnostic(storage);
  if (!diagnostic.canWrite) return mutationFailure(diagnostic);
  const profileIndex = diagnostic.registry.profiles.findIndex(
    (profile) => profile.id === id,
  );
  if (profileIndex < 0) {
    return {
      ok: false,
      status: "not-found",
      registry: diagnostic.registry,
      profile: null,
      message: "That player profile no longer exists.",
    };
  }
  const normalizedName = normalizeProfileName(name);
  if (!validProfileName(normalizedName)) {
    return {
      ok: false,
      status: "invalid-name",
      registry: diagnostic.registry,
      profile: null,
      message: `Names must be ${PROFILE_NAME_MIN_LENGTH}–${BORROW_FLASH_MAX_PROFILE_NAME_LENGTH} characters.`,
    };
  }
  if (duplicateName(diagnostic.registry, normalizedName, id)) {
    return {
      ok: false,
      status: "duplicate-name",
      registry: diagnostic.registry,
      profile: null,
      message: "Choose a different player name.",
    };
  }
  const current = diagnostic.registry.profiles[profileIndex];
  if (current.name === normalizedName) {
    return {
      ok: true,
      status: "unchanged",
      registry: diagnostic.registry,
      profile: current,
      message: null,
    };
  }
  const profile: BorrowFlashProfile = {
    ...current,
    name: normalizedName,
    updatedAt: Math.max(Date.now(), current.updatedAt),
  };
  const profiles = [...diagnostic.registry.profiles];
  profiles[profileIndex] = profile;
  const registry: BorrowFlashProfileRegistry = {
    ...diagnostic.registry,
    profiles,
  };
  return persistMutation(storage, registry, "renamed", profile);
}

function scopedKey(profileId: string, key: string): string {
  if (profileId === BORROW_FLASH_DEFAULT_PROFILE_ID) return key;
  return `${PROFILE_DATA_PREFIX}${encodeURIComponent(profileId)}:${key}`;
}

export function createBorrowFlashProfileStorage(
  profileId: string,
  storage: BorrowFlashProfileStorage | null = browserStorage(),
): BorrowFlashProfileStorage | null {
  if (!storage || !PROFILE_ID_PATTERN.test(profileId)) return null;
  return {
    getItem: (key) => storage.getItem(scopedKey(profileId, key)),
    setItem: (key, value) => storage.setItem(scopedKey(profileId, key), value),
    removeItem: (key) => storage.removeItem(scopedKey(profileId, key)),
  };
}

const BORROW_FLASH_CHILD_DATA_KEYS = [
  PERFORMANCE_STORAGE_KEY,
  PERFORMANCE_LEGACY_STORAGE_KEY,
  ADAPTIVE_SUBTRACTION_STORAGE_KEY,
] as const;

export function clearBorrowFlashProfileData(
  profileId: string,
  storage: BorrowFlashProfileStorage | null = browserStorage(),
): BorrowFlashProfileMutationResult {
  const diagnostic = loadBorrowFlashProfilesDiagnostic(storage);
  if (!diagnostic.canWrite) return mutationFailure(diagnostic);
  const profile = diagnostic.registry.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) {
    return {
      ok: false,
      status: "not-found",
      registry: diagnostic.registry,
      profile: null,
      message: "That player profile no longer exists.",
    };
  }
  const scopedStorage = createBorrowFlashProfileStorage(profileId, storage);
  if (!scopedStorage) {
    return {
      ok: false,
      status: "unavailable",
      registry: diagnostic.registry,
      profile: null,
      message: "Player data is unavailable on this device.",
    };
  }
  try {
    for (const key of BORROW_FLASH_CHILD_DATA_KEYS) {
      scopedStorage.removeItem(key);
    }
  } catch {
    return {
      ok: false,
      status: "write-failed",
      registry: diagnostic.registry,
      profile: null,
      message: "Some player data could not be cleared from this device.",
    };
  }
  return {
    ok: true,
    status: "cleared",
    registry: diagnostic.registry,
    profile,
    message: null,
  };
}
