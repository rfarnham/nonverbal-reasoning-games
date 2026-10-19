#!/usr/bin/env node
/** Replace only spoken audio, retaining the content and device-progress key. */
import { readFile, writeFile, mkdir, readdir, rename, rm, lstat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { deriveSearchKey, encryptSearchBytes, decryptSearchBytes, sha256 } from "../lib/question-search/crypto.ts";
import { validateMemoryContent, validateMemoryManifest, memoryContentContext, memoryAudioContext } from "../app/lab/working-memory/vault.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function refreshMemoryAudio({ vault, audioDirectory, narration, password, source }) {
  const output = resolve(vault);
  if (!(await lstat(output)).isDirectory()) throw new Error("The existing vault must be a real directory.");
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  validateMemoryManifest(manifest);
  const files = [manifest.payload, ...Object.values(manifest.assets)];
  const expected = new Set(["manifest.json", ...files.map(file => file.path)]);
  const entries = await readdir(output, { withFileTypes: true });
  if (entries.length !== expected.size || entries.some(entry => !entry.isFile() || !expected.has(entry.name))) {
    throw new Error("Refusing to replace a vault containing unknown files or symlinks.");
  }
  const existing = new Map();
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(join(output, file.path)));
    if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) throw new Error("The existing vault is damaged.");
    existing.set(file.path, bytes);
  }
  const key = await deriveSearchKey(password, manifest.encryption);
  password = "";
  // Authenticate the old payload before preparing any replacement. A wrong
  // password must never produce a new pack that strands existing progress.
  const plain = await decryptSearchBytes(existing.get(manifest.payload.path), key, memoryContentContext(manifest));
  try { validateMemoryContent(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain))); }
  finally { plain.fill(0); }

  const recipe = JSON.parse(await readFile(resolve(narration), "utf8"));
  const next = structuredClone(manifest);
  const replacement = new Map([[manifest.payload.path, existing.get(manifest.payload.path)]]);
  if (source) {
    const content = new Uint8Array(await readFile(resolve(source)));
    try {
      validateMemoryContent(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)));
      const path = `content-${randomBytes(16).toString("hex")}.bin`;
      const payload = { path, sha256: "", bytes: 0 };
      const cipher = await encryptSearchBytes(content, key, memoryContentContext({ version: manifest.version, payload }));
      const verified = await decryptSearchBytes(cipher, key, memoryContentContext({ version: manifest.version, payload }));
      try {
        if (await sha256(verified) !== await sha256(content)) throw new Error("Content encryption verification failed.");
      } finally { verified.fill(0); }
      payload.sha256 = await sha256(cipher);
      payload.bytes = cipher.length;
      next.payload = payload;
      replacement.clear();
      replacement.set(path, cipher);
    } finally { content.fill(0); }
  }
  for (let digit = 1; digit <= 9; digit++) {
    const id = `digit-${digit}`;
    const cue = recipe.cues?.[String(digit)];
    if (cue?.file !== `${id}.mp3` || !/^[a-f0-9]{64}$/.test(cue.sha256)) throw new Error(`Invalid narration metadata for ${id}.`);
    const bytes = new Uint8Array(await readFile(resolve(audioDirectory, cue.file)));
    try {
      if (!bytes.length || await sha256(bytes) !== cue.sha256) throw new Error(`The spoken audio does not match its manifest: ${id}.`);
      const cipher = await encryptSearchBytes(bytes, key, memoryAudioContext(manifest.version, id));
      const verified = await decryptSearchBytes(cipher, key, memoryAudioContext(manifest.version, id));
      try {
        if (await sha256(verified) !== cue.sha256) throw new Error("Audio encryption verification failed.");
      } finally { verified.fill(0); }
      const path = `asset-${randomBytes(16).toString("hex")}.bin`;
      next.assets[id] = { path, sha256: await sha256(cipher), bytes: cipher.length };
      replacement.set(path, cipher);
    } finally { bytes.fill(0); }
  }
  validateMemoryManifest(next);
  const temporary = `${output}.building-${randomBytes(8).toString("hex")}`;
  const previous = `${output}.previous-${randomBytes(8).toString("hex")}`;
  try {
    await mkdir(temporary);
    for (const [path, bytes] of replacement) await writeFile(join(temporary, path), bytes);
    await writeFile(join(temporary, "manifest.json"), `${JSON.stringify(next, null, 2)}\n`);
    await rename(output, previous);
    try { await rename(temporary, output); }
    catch (error) { await rename(previous, output); throw error; }
    await rm(previous, { recursive: true });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { audioFiles: 9, encryptedBytes: [...replacement.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    contentPreserved: !source, progressKeyPreserved: true, roundTripVerified: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    vault: { type: "string" }, "audio-directory": { type: "string" },
    narration: { type: "string" }, "password-file": { type: "string" }, source: { type: "string" },
  } });
  if (!values["audio-directory"]) throw new Error("Supply --audio-directory /private/digits [--password-file /private/password.txt].");
  let password = values["password-file"] ? (await readFile(values["password-file"], "utf8")).replace(/\r?\n$/, "") : process.env.WORKING_MEMORY_PASSWORD;
  if (!password || password.length < 8 || password.length > 1024) throw new Error("Supply an 8–1024 character password with WORKING_MEMORY_PASSWORD or --password-file.");
  const result = await refreshMemoryAudio({
    vault: values.vault ?? join(project, "public/working-memory/vault"),
    audioDirectory: values["audio-directory"],
    narration: values.narration ?? join(project, "content/narration/working-memory.json"), password, source: values.source,
  });
  password = "";
  console.log(JSON.stringify(result));
}
