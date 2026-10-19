#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { deriveSearchKey, encryptSearchBytes, decryptSearchBytes, sha256 } from "../lib/question-search/crypto.ts";
import { validateMemoryContent, validateMemoryManifest, validateMemoryEnvelope, memoryContentContext, memoryAudioContext } from "../app/lab/working-memory/vault.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  source: { type: "string" }, output: { type: "string" }, "password-file": { type: "string" }, "audio-directory": { type: "string" },
} });
if (!values.source || !values["audio-directory"]) throw new Error("Usage: node scripts/encrypt-working-memory.mjs --source /private/content.json --audio-directory /private/digits [--password-file /private/password.txt]");
let password = values["password-file"] ? (await readFile(values["password-file"], "utf8")).replace(/\r?\n$/, "") : process.env.WORKING_MEMORY_PASSWORD;
if (!password || password.length < 8 || password.length > 1024) throw new Error("Supply an 8–1024 character password with WORKING_MEMORY_PASSWORD or --password-file.");
const plain = new Uint8Array(await readFile(resolve(values.source)));
validateMemoryContent(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)));
const output = resolve(values.output ?? join(project, "public/working-memory/vault"));
const temporary = `${output}.building-${randomBytes(8).toString("hex")}`;
const version = randomBytes(16).toString("hex");
const manifest = {
  schemaVersion: 1, version,
  payload: { path: `content-${version}.bin`, sha256: "", bytes: 0 },
  assets: {},
  encryption: { name: "AES-GCM", kdf: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: randomBytes(16).toString("base64") },
};
const key = await deriveSearchKey(password, manifest.encryption);
password = "";
try {
  const encrypted = await encryptSearchBytes(plain, key, memoryContentContext(manifest));
  manifest.payload.sha256 = await sha256(encrypted);
  manifest.payload.bytes = encrypted.length;
  const verified = await decryptSearchBytes(encrypted, key, memoryContentContext(manifest));
  if (await sha256(verified) !== await sha256(plain)) throw new Error("Encrypted pack round-trip verification failed.");
  verified.fill(0);
  const files = new Map([[manifest.payload.path, encrypted]]);
  for (let digit = 1; digit <= 9; digit++) {
    const id = `digit-${digit}`;
    const bytes = new Uint8Array(await readFile(resolve(values["audio-directory"], `${id}.mp3`)));
    try {
      if (bytes.length === 0) throw new Error(`Missing spoken audio for ${id}.`);
      const cipher = await encryptSearchBytes(bytes, key, memoryAudioContext(version, id));
      const back = await decryptSearchBytes(cipher, key, memoryAudioContext(version, id));
      try {
        if (await sha256(back) !== await sha256(bytes)) throw new Error("Audio encryption round-trip verification failed.");
      } finally { back.fill(0); }
      const path = `asset-${randomBytes(16).toString("hex")}.bin`;
      manifest.assets[id] = { path, sha256: await sha256(cipher), bytes: cipher.length };
      files.set(path, cipher);
    } finally { bytes.fill(0); }
  }
  validateMemoryManifest(manifest);
  await mkdir(temporary, { recursive: true });
  for (const [path, bytes] of files) await writeFile(join(temporary, path), bytes);
  await writeFile(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(dirname(output), { recursive: true });
  let previousOutput;
  try {
    const previous = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    // The initial content-only pack may be upgraded, but arbitrary directories,
    // extra files and symlinks must never be removed by this tool.
    if (previous.assets === undefined) validateMemoryEnvelope(previous);
    else validateMemoryManifest(previous);
    const expected = new Set(["manifest.json", previous.payload.path,
      ...Object.values(previous.assets ?? {}).map(asset => asset.path)]);
    const entries = await readdir(output, { withFileTypes: true });
    if (entries.length !== expected.size || entries.some(entry => !entry.isFile() || !expected.has(entry.name))) {
      throw new Error("Refusing to replace an output directory containing unknown files.");
    }
    previousOutput = `${output}.previous-${randomBytes(8).toString("hex")}`;
    await rename(output, previousOutput);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await rename(temporary, output); }
  catch (error) {
    if (previousOutput) await rename(previousOutput, output);
    throw error;
  }
  if (previousOutput) await rm(previousOutput, { recursive: true });
  console.log(JSON.stringify({ output: relative(project, output), encryptedFiles: files.size,
    encryptedBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), roundTripVerified: true }));
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
} finally { plain.fill(0); }
