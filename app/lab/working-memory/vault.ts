import { decryptSearchBytes, deriveSearchKey, encryptSearchBytes, sha256 } from "../../../lib/question-search/crypto.ts";

export type MemoryTaskId = "forward" | "backward" | "rotation" | "tracking" | "symbols" | "locations" | "pattern" | "split" |
  "reverse-digits" | "hidden-digits" | "sort-digits";
export type MemoryTask = {
  id: MemoryTaskId;
  title: string;
  description: string;
  instruction: string;
  icon: string;
  accent: string;
};
export type MemorySource = { title: string; url: string; note: string };
export type MemoryContent = {
  version: 1;
  title: string;
  intro: string;
  evidenceNote: string;
  tasks: MemoryTask[];
  sources: MemorySource[];
  policy?: Record<string, string>;
  schedule?: { targetSessions: number; note: string };
};
export type MemoryDigitId = `digit-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
export type MemoryEncryptedFile = { path: string; sha256: string; bytes: number };
export type MemoryVaultManifest = {
  schemaVersion: 1;
  version: string;
  payload: MemoryEncryptedFile;
  assets: Record<MemoryDigitId, MemoryEncryptedFile>;
  encryption: {
    name: "AES-GCM";
    kdf: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const vaultRoot = `${basePath}/working-memory/vault/`;
const maximumBytes = 2_000_000;
const taskIds: MemoryTaskId[] = ["forward", "backward", "rotation", "tracking", "symbols", "locations", "pattern", "split",
  "reverse-digits", "hidden-digits", "sort-digits"];
const digitIds: MemoryDigitId[] = ["digit-1", "digit-2", "digit-3", "digit-4", "digit-5", "digit-6", "digit-7", "digit-8", "digit-9"];
export const MEMORY_PROGRESS_STORAGE_KEY = "spatial-gym:working-memory:progress:v1";
const progressContext = "working-memory/v1/device-progress";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

export function validateMemoryContent(value: unknown): asserts value is MemoryContent {
  if (!record(value) || value.version !== 1 || !text(value.title, 120) || !text(value.intro, 2000) ||
      !text(value.evidenceNote, 4000) || !Array.isArray(value.tasks) || value.tasks.length !== taskIds.length ||
      !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 30 ||
      (value.policy !== undefined && (!record(value.policy) || !Object.values(value.policy).every(entry => text(entry, 2400)))) ||
      (value.schedule !== undefined && (!record(value.schedule) || !Number.isInteger(value.schedule.targetSessions) ||
        (value.schedule.targetSessions as number) < 1 || (value.schedule.targetSessions as number) > 1000 || !text(value.schedule.note, 2400)))) {
    throw new Error("This practice pack uses an unsupported format.");
  }
  const seen = new Set<string>();
  for (const task of value.tasks) {
    if (!record(task) || typeof task.id !== "string" || !taskIds.includes(task.id as MemoryTaskId) || seen.has(task.id) ||
        !text(task.title, 120) || !text(task.description, 1200) || !text(task.instruction, 1200) ||
        !text(task.icon, 40) || typeof task.accent !== "string" || !/^(?:#[a-f0-9]{6}|gold|coral|violet|teal)$/i.test(task.accent)) {
      throw new Error("The practice pack has an invalid or missing exercise.");
    }
    seen.add(task.id);
  }
  for (const source of value.sources) {
    if (!record(source) || !text(source.title, 300) || !text(source.note, 2400) || !text(source.url, 2000)) {
      throw new Error("The practice pack has an invalid source.");
    }
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsupported URL");
    } catch {
      throw new Error("The practice pack has an invalid source link.");
    }
  }
}

function encryptedFile(value: unknown, pathPattern: RegExp): value is MemoryEncryptedFile {
  return record(value) && typeof value.path === "string" && pathPattern.test(value.path) &&
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.bytes) && (value.bytes as number) >= 28 && (value.bytes as number) <= maximumBytes;
}

/** Metadata common to current packs and the initial content-only pack format. */
export function validateMemoryEnvelope(value: unknown): asserts value is Omit<MemoryVaultManifest, "assets"> {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.version !== "string" || !/^[a-f0-9]{32,64}$/.test(value.version) ||
      !encryptedFile(value.payload, /^content-[a-f0-9]{32,64}\.bin$/) ||
      !record(value.encryption) || value.encryption.name !== "AES-GCM" || value.encryption.kdf !== "PBKDF2" || value.encryption.hash !== "SHA-256" ||
      !Number.isInteger(value.encryption.iterations) || (value.encryption.iterations as number) < 100000 || (value.encryption.iterations as number) > 2000000 ||
      typeof value.encryption.salt !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(value.encryption.salt)) {
    throw new Error("This encrypted practice pack uses an unsupported format.");
  }
}

export function validateMemoryManifest(value: unknown): asserts value is MemoryVaultManifest {
  validateMemoryEnvelope(value);
  const assets: unknown = (value as MemoryVaultManifest).assets;
  if (!record(assets) || Object.keys(assets).length !== digitIds.length ||
      !digitIds.every(id => encryptedFile(assets[id], /^asset-[a-f0-9]{32}\.bin$/))) {
    throw new Error("This encrypted practice pack uses an unsupported format.");
  }
  if (new Set(Object.values(assets).map(asset => (asset as MemoryEncryptedFile).path)).size !== digitIds.length) {
    throw new Error("The encrypted spoken digits have duplicate asset paths.");
  }
}

export function memoryContentContext(manifest: Pick<MemoryVaultManifest, "version" | "payload">): string {
  return `working-memory/v1/${manifest.version}/${manifest.payload.path}`;
}
export function memoryAudioContext(version: string, id: MemoryDigitId): string {
  return `working-memory/v1/${version}/audio/${id}`;
}

function checkAbort(signal?: AbortSignal): void { signal?.throwIfAborted(); }

async function loadManifest(signal?: AbortSignal): Promise<MemoryVaultManifest> {
  checkAbort(signal);
  const response = await fetch(`${vaultRoot}manifest.json`, { signal, cache: "no-cache", credentials: "same-origin" });
  if (!response.ok) throw new Error("The practice pack could not load. Check your connection and try again.");
  const manifest: unknown = await response.json();
  validateMemoryManifest(manifest);
  checkAbort(signal);
  return manifest;
}

async function loadEncrypted(file: MemoryEncryptedFile, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(`${vaultRoot}${file.path}`, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error("The encrypted practice files could not load. Please try again.");
  const encrypted = new Uint8Array(await response.arrayBuffer());
  if (encrypted.length !== file.bytes || await sha256(encrypted) !== file.sha256) {
    throw new Error("The practice pack is incomplete or damaged. Reload and try again.");
  }
  checkAbort(signal);
  return encrypted;
}

export async function unlockMemoryVault(password: string, signal?: AbortSignal): Promise<{ content: MemoryContent; key: CryptoKey }> {
  const manifest = await loadManifest(signal);
  const [key, encrypted] = await Promise.all([
    deriveSearchKey(password, manifest.encryption), loadEncrypted(manifest.payload, signal),
  ]);
  checkAbort(signal);
  let plain: Uint8Array;
  try { plain = await decryptSearchBytes(encrypted, key, memoryContentContext(manifest)); }
  catch { checkAbort(signal); throw new Error("That password did not unlock the exercises. Please try again."); }
  try {
    checkAbort(signal);
    const content: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    validateMemoryContent(content);
    return { content, key };
  } finally { plain.fill(0); }
}

export async function loadMemoryAudio(key: CryptoKey, signal?: AbortSignal): Promise<{ urls: Record<string, string>; dispose: () => void }> {
  const manifest = await loadManifest(signal);
  const results = await Promise.allSettled(digitIds.map(async id => {
    const encrypted = await loadEncrypted(manifest.assets[id], signal);
    const plain = await decryptSearchBytes(encrypted, key, memoryAudioContext(manifest.version, id));
    return { id, plain };
  }));
  const urls: Record<string, string> = {};
  const opened: string[] = [];
  const dispose = () => { for (const url of opened.splice(0)) URL.revokeObjectURL(url); };
  try {
    checkAbort(signal);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw new Error("The spoken digits could not unlock. Reload and try again.");
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.value.plain)], { type: "audio/mpeg" }));
      opened.push(url);
      const path = `/working-memory/audio/${result.value.id}.mp3`;
      urls[path] = url;
      urls[`${basePath}${path}`] = url;
    }
    checkAbort(signal);
    return { urls, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    for (const result of results) if (result.status === "fulfilled") result.value.plain.fill(0);
  }
}

// One queue orders writes and deletions, including saves still encrypting when a
// user clears progress. A failed write never blocks later attempts.
let storageQueue: Promise<unknown> = Promise.resolve();
function queued<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageQueue.then(operation);
  storageQueue = next.catch(() => undefined);
  return next;
}
function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}
function toBase64(bytes: Uint8Array): string {
  let value = "";
  // Keep the call stack bounded for larger session histories.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(value);
}

export function loadMemoryProgress(key: CryptoKey): Promise<unknown | null> {
  return queued(async () => {
    let plain: Uint8Array | undefined;
    try {
      const value = storage()?.getItem(MEMORY_PROGRESS_STORAGE_KEY);
      if (!value || value.length > maximumBytes * 1.4) return null;
      const envelope: unknown = JSON.parse(value);
      if (!record(envelope) || envelope.version !== 1 || typeof envelope.ciphertext !== "string" ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) return null;
      const encrypted = Uint8Array.from(atob(envelope.ciphertext), character => character.charCodeAt(0));
      if (encrypted.length < 28 || encrypted.length > maximumBytes) return null;
      plain = await decryptSearchBytes(encrypted, key, progressContext);
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    } catch { return null; }
    finally { plain?.fill(0); }
  });
}

export function saveMemoryProgress(key: CryptoKey, data: unknown): Promise<void> {
  // Snapshot before queueing so callers may continue changing their in-memory state.
  let plain: Uint8Array;
  try {
    const json = JSON.stringify(data);
    if (json === undefined) throw new Error("invalid progress");
    plain = new TextEncoder().encode(json);
    if (plain.length > maximumBytes - 28) throw new Error("progress too large");
  } catch {
    return Promise.reject(new Error("Progress could not be saved on this device. You can keep playing."));
  }
  return queued(async () => {
    try {
      const local = storage();
      if (!local) throw new Error("storage unavailable");
      const encrypted = await encryptSearchBytes(plain, key, progressContext);
      local.setItem(MEMORY_PROGRESS_STORAGE_KEY, JSON.stringify({ version: 1, ciphertext: toBase64(encrypted) }));
    } catch {
      throw new Error("Progress could not be saved on this device. You can keep playing.");
    } finally { plain.fill(0); }
  });
}

export function clearMemoryProgress(): Promise<void> {
  return queued(async () => {
    try {
      const local = storage();
      if (!local) throw new Error("storage unavailable");
      local.removeItem(MEMORY_PROGRESS_STORAGE_KEY);
    } catch { throw new Error("Saved progress could not be cleared on this device. Please try again."); }
  });
}
