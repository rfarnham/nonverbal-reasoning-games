import type { SearchManifest } from "./types.ts";

const encoder = new TextEncoder();
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
}
export function validateManifest(value: unknown): asserts value is SearchManifest {
  const m = value as SearchManifest;
  if (!m || m.schemaVersion !== 1 || !/^[a-f0-9]{16,64}$/.test(m.version) || !Number.isInteger(m.count) || m.count < 1 || m.count > 100000 ||
      !m.index || !/^index-[a-f0-9]{16,64}\.bin$/.test(m.index.path) || !/^[a-f0-9]{64}$/.test(m.index.sha256) ||
      !Number.isSafeInteger(m.index.bytes) || m.index.bytes < 28 || m.index.bytes > 100_000_000 ||
      m.encryption?.name !== "AES-GCM" || m.encryption.kdf !== "PBKDF2" || m.encryption.hash !== "SHA-256" ||
      !Number.isInteger(m.encryption.iterations) || m.encryption.iterations < 100000 || m.encryption.iterations > 2000000 ||
      typeof m.encryption.salt !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(m.encryption.salt)) {
    throw new Error("This search pack uses an unsupported format.");
  }
}
export async function deriveSearchKey(password: string, config: SearchManifest["encryption"]): Promise<CryptoKey> {
  if (!crypto?.subtle) throw new Error("Unlocking requires HTTPS or localhost in a modern browser.");
  if (!password || password.length > 1024) throw new Error("Enter the search password.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const salt = Uint8Array.from(atob(config.salt), c => c.charCodeAt(0));
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: config.iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptSearchBytes(data: Uint8Array, key: CryptoKey, context: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(context), tagLength: 128 }, key, new Uint8Array(data)));
  const result = new Uint8Array(iv.length + encrypted.length);
  result.set(iv); result.set(encrypted, 12);
  return result;
}
export async function decryptSearchBytes(data: Uint8Array, key: CryptoKey, context: string): Promise<Uint8Array> {
  if (data.length < 28) throw new Error("The encrypted file is incomplete. Reload and try again.");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(data.slice(0, 12)), additionalData: encoder.encode(context), tagLength: 128 }, key, new Uint8Array(data.slice(12))));
}
