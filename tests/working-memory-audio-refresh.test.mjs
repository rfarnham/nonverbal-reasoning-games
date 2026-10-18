import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshMemoryAudio } from "../scripts/refresh-working-memory-audio.mjs";
import { deriveSearchKey, encryptSearchBytes, decryptSearchBytes, sha256 } from "../lib/question-search/crypto.ts";
import { memoryContentContext, memoryAudioContext, validateMemoryManifest } from "../app/lab/working-memory/vault.ts";

const encoder = new TextEncoder();
const taskIds = ["forward", "backward", "rotation", "tracking", "symbols", "locations", "pattern", "split",
  "reverse-digits", "hidden-digits", "sort-digits"];
const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "memory-audio-refresh-"));
  const vault = join(directory, "vault");
  const audioDirectory = join(directory, "audio");
  await mkdir(vault);
  await mkdir(audioDirectory);
  const password = randomBytes(24).toString("base64");
  const content = { version: 1, title: "Fixture", intro: "Fixture introduction", evidenceNote: "Fixture evidence",
    tasks: taskIds.map(id => ({ id, title: `Fixture ${id}`, description: "Fixture description", instruction: "Fixture instruction", icon: "◇", accent: "teal" })),
    sources: [{ title: "Fixture source", url: "https://example.test/", note: "Fixture note" }] };
  const manifest = { schemaVersion: 1, version: randomBytes(16).toString("hex"),
    payload: { path: `content-${randomBytes(16).toString("hex")}.bin`, sha256: "", bytes: 0 }, assets: {},
    encryption: { name: "AES-GCM", kdf: "PBKDF2", hash: "SHA-256", iterations: 100000, salt: randomBytes(16).toString("base64") } };
  const key = await deriveSearchKey(password, manifest.encryption);
  const payload = await encryptSearchBytes(encoder.encode(JSON.stringify(content)), key, memoryContentContext(manifest));
  manifest.payload.sha256 = await sha256(payload);
  manifest.payload.bytes = payload.length;
  await writeFile(join(vault, manifest.payload.path), payload);
  const recipe = { cues: {} };
  const audio = new Map();
  for (let digit = 1; digit <= 9; digit++) {
    const id = `digit-${digit}`;
    const cipher = await encryptSearchBytes(randomBytes(80), key, memoryAudioContext(manifest.version, id));
    const path = `asset-${randomBytes(16).toString("hex")}.bin`;
    manifest.assets[id] = { path, bytes: cipher.length, sha256: await sha256(cipher) };
    await writeFile(join(vault, path), cipher);
    const bytes = randomBytes(200 + digit);
    audio.set(id, bytes);
    recipe.cues[digit] = { file: `${id}.mp3`, sha256: await sha256(bytes) };
    await writeFile(join(audioDirectory, `${id}.mp3`), bytes);
  }
  await writeFile(join(vault, "manifest.json"), JSON.stringify(manifest));
  const narration = join(directory, "narration.json");
  await writeFile(narration, JSON.stringify(recipe));
  return { directory, vault, audioDirectory, narration, password, manifest, key, payload, content, audio };
}

async function snapshot(vault) {
  const paths = (await readdir(vault)).sort();
  return Promise.all(paths.map(async path => [path, await readFile(join(vault, path), "hex")]));
}

test("audio refresh preserves existing ciphertext content and the saved-progress key", async () => {
  const f = await fixture();
  try {
    const progress = { fixture: randomBytes(12).toString("hex"), attempts: [true, false] };
    const saved = await encryptSearchBytes(encoder.encode(JSON.stringify(progress)), f.key, "working-memory/v1/device-progress");
    const result = await refreshMemoryAudio(f);
    assert.equal(result.progressKeyPreserved, true);
    assert.equal(result.contentPreserved, true);
    const next = JSON.parse(await readFile(join(f.vault, "manifest.json"), "utf8"));
    validateMemoryManifest(next);
    assert.equal(next.version, f.manifest.version);
    assert.deepEqual(next.encryption, f.manifest.encryption);
    assert.deepEqual(next.payload, f.manifest.payload);
    assert.deepEqual(new Uint8Array(await readFile(join(f.vault, next.payload.path))), f.payload);
    const newKey = await deriveSearchKey(f.password, next.encryption);
    assert.deepEqual(decode(await decryptSearchBytes(saved, newKey, "working-memory/v1/device-progress")), progress);
    for (const [id, file] of Object.entries(next.assets)) {
      assert.notEqual(file.path, f.manifest.assets[id].path);
      const cipher = new Uint8Array(await readFile(join(f.vault, file.path)));
      assert.equal(cipher.length, file.bytes);
      assert.equal(await sha256(cipher), file.sha256);
      assert.deepEqual(Buffer.from(await decryptSearchBytes(cipher, newKey, memoryAudioContext(next.version, id))), f.audio.get(id));
    }
    assert.deepEqual((await readdir(f.vault)).sort(), ["manifest.json", next.payload.path, ...Object.values(next.assets).map(file => file.path)].sort());
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("an optional content update changes its authenticated path while retaining progress encryption", async () => {
  const f = await fixture();
  try {
    const edited = structuredClone(f.content);
    edited.tasks.find(task => task.id === "sort-digits").instruction = "Use the order shown.";
    const source = join(f.directory, "content.json");
    await writeFile(source, JSON.stringify(edited));
    const saved = await encryptSearchBytes(encoder.encode("retained progress"), f.key, "working-memory/v1/device-progress");
    const result = await refreshMemoryAudio({ ...f, source });
    assert.equal(result.contentPreserved, false);
    const next = JSON.parse(await readFile(join(f.vault, "manifest.json"), "utf8"));
    assert.equal(next.version, f.manifest.version);
    assert.deepEqual(next.encryption, f.manifest.encryption);
    assert.notEqual(next.payload.path, f.manifest.payload.path);
    const key = await deriveSearchKey(f.password, next.encryption);
    const cipher = new Uint8Array(await readFile(join(f.vault, next.payload.path)));
    assert.deepEqual(decode(await decryptSearchBytes(cipher, key, memoryContentContext(next))), edited);
    await assert.rejects(decryptSearchBytes(cipher, key, memoryContentContext(f.manifest)));
    assert.equal(new TextDecoder().decode(await decryptSearchBytes(saved, key, "working-memory/v1/device-progress")), "retained progress");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("wrong passwords, damaged sources and stale audio never mutate the vault", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.vault);
    await assert.rejects(refreshMemoryAudio({ ...f, password: randomBytes(24).toString("base64") }));
    assert.deepEqual(await snapshot(f.vault), before);
    const source = join(f.directory, "bad-content.json");
    await writeFile(source, "{}");
    await assert.rejects(refreshMemoryAudio({ ...f, source }), /unsupported/);
    assert.deepEqual(await snapshot(f.vault), before);
    await writeFile(join(f.audioDirectory, "digit-9.mp3"), randomBytes(100));
    await assert.rejects(refreshMemoryAudio(f), /does not match/);
    assert.deepEqual(await snapshot(f.vault), before);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("audio refresh refuses unrelated files and symlinks instead of deleting them", async () => {
  const f = await fixture();
  try {
    const unrelated = join(f.vault, "keep.txt");
    await writeFile(unrelated, "Keep me");
    const before = await snapshot(f.vault);
    await assert.rejects(refreshMemoryAudio(f), /unknown files or symlinks/);
    assert.deepEqual(await snapshot(f.vault), before);
    await rm(unrelated);
    const asset = f.manifest.assets["digit-1"].path;
    const outside = join(f.directory, "outside.bin");
    await writeFile(outside, await readFile(join(f.vault, asset)));
    await rm(join(f.vault, asset));
    await symlink(outside, join(f.vault, asset));
    await assert.rejects(refreshMemoryAudio(f), /unknown files or symlinks/);
    assert.equal((await readFile(outside)).length, f.manifest.assets["digit-1"].bytes);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
