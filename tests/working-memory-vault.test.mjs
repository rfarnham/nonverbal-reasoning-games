import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveSearchKey, encryptSearchBytes, decryptSearchBytes, sha256 } from "../lib/question-search/crypto.ts";
import {
  unlockMemoryVault, loadMemoryAudio, validateMemoryContent, validateMemoryManifest, memoryContentContext, memoryAudioContext,
  loadMemoryProgress, saveMemoryProgress, clearMemoryProgress, MEMORY_PROGRESS_STORAGE_KEY,
} from "../app/lab/working-memory/vault.ts";

const execute = promisify(execFile);
const encoder = new TextEncoder();
const taskIds = ["forward", "backward", "rotation", "tracking", "symbols", "locations", "pattern", "split",
  "reverse-digits", "hidden-digits", "sort-digits"];
function contentFixture() {
  return {
    version: 1, title: "Private fixture", intro: "Fixture introduction", evidenceNote: "Practice fixture only",
    tasks: taskIds.map(id => ({ id, title: `Fixture ${id}`, description: "Fixture description", instruction: "Fixture instruction", icon: "◇", accent: "#7767d7" })),
    sources: [{ title: "Fixture source", url: "https://example.test/reference", note: "Fixture reference" }],
  };
}
async function encryptedFixture() {
  const password = randomBytes(24).toString("base64");
  const manifest = {
    schemaVersion: 1, version: randomBytes(16).toString("hex"),
    payload: { path: `content-${randomBytes(16).toString("hex")}.bin`, sha256: "", bytes: 0 },
    assets: {},
    encryption: { name: "AES-GCM", kdf: "PBKDF2", hash: "SHA-256", iterations: 100000, salt: randomBytes(16).toString("base64") },
  };
  const key = await deriveSearchKey(password, manifest.encryption);
  const content = contentFixture();
  const encrypted = await encryptSearchBytes(encoder.encode(JSON.stringify(content)), key, memoryContentContext(manifest));
  manifest.payload.sha256 = await sha256(encrypted);
  manifest.payload.bytes = encrypted.length;
  const assets = new Map();
  const audioPlain = new Map();
  for (let digit = 1; digit <= 9; digit++) {
    const id = `digit-${digit}`;
    const bytes = encoder.encode(`Audio fixture ${digit}: ${randomBytes(12).toString("hex")}`);
    const cipher = await encryptSearchBytes(bytes, key, memoryAudioContext(manifest.version, id));
    const path = `asset-${randomBytes(16).toString("hex")}.bin`;
    manifest.assets[id] = { path, sha256: await sha256(cipher), bytes: cipher.length };
    assets.set(path, cipher);
    audioPlain.set(id, bytes);
  }
  return { password, manifest, key, encrypted, content, assets, audioPlain };
}
function replaceFetch(fixture, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    options?.signal?.throwIfAborted();
    assert.equal(options?.credentials, "same-origin");
    if (String(url).endsWith("/manifest.json")) return new Response(JSON.stringify(fixture.manifest));
    const assetPath = String(url).split("/").at(-1);
    if (fixture.assets?.has(assetPath)) return new Response(fixture.assets.get(assetPath));
    assert.ok(String(url).endsWith(`/${fixture.manifest.payload.path}`));
    return new Response(fixture.encrypted);
  };
  return Promise.resolve().then(callback).finally(() => { globalThis.fetch = original; });
}
function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
  };
}
async function withStorage(local, callback) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  try { return await callback(); }
  finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
}

test("vault unlock authenticates content without persisting a password or key", async () => {
  const fixture = await encryptedFixture();
  const local = memoryStorage();
  await withStorage(local, () => replaceFetch(fixture, async () => {
    const session = await unlockMemoryVault(fixture.password);
    assert.deepEqual(session.content, fixture.content);
    assert.equal(session.key.extractable, false);
    assert.equal(session.key.algorithm.name, "AES-GCM");
    assert.equal(local.values.size, 0);
    await assert.rejects(unlockMemoryVault(randomBytes(24).toString("base64")), /password did not unlock/);
    assert.equal(local.values.size, 0);
  }));
});

test("ciphertext changes and authenticated context substitution cannot open the vault", async () => {
  const fixture = await encryptedFixture();
  const changed = fixture.encrypted.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(decryptSearchBytes(changed, fixture.key, memoryContentContext(fixture.manifest)));
  await assert.rejects(decryptSearchBytes(fixture.encrypted, fixture.key, "working-memory/v1/device-progress"));
  await replaceFetch({ ...fixture, encrypted: changed }, async () => {
    await assert.rejects(unlockMemoryVault(fixture.password), /incomplete or damaged/);
  });
  await replaceFetch({ ...fixture, manifest: { ...fixture.manifest, version: randomBytes(16).toString("hex") } }, async () => {
    await assert.rejects(unlockMemoryVault(fixture.password), /password did not unlock/);
  });
});

test("an aborted unlock cannot return usable decrypted content", async () => {
  const fixture = await encryptedFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(unlockMemoryVault(fixture.password, controller.signal), { name: "AbortError" });
  const original = globalThis.fetch;
  let requests = 0;
  const during = new AbortController();
  globalThis.fetch = async () => {
    requests++;
    during.abort();
    return new Response(JSON.stringify(fixture.manifest));
  };
  try {
    await assert.rejects(unlockMemoryVault(fixture.password, during.signal), { name: "AbortError" });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test("spoken digits are authenticated, exposed only through disposable blob URLs and bound to their digit identity", async () => {
  const fixture = await encryptedFixture();
  const audio = await replaceFetch(fixture, () => loadMemoryAudio(fixture.key));
  const url = audio.urls["/working-memory/audio/digit-1.mp3"];
  assert.match(url, /^blob:/);
  const response = await fetch(url);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture.audioPlain.get("digit-1"));
  audio.dispose();
  audio.dispose();
  await assert.rejects(fetch(url));
  const swapped = structuredClone(fixture.manifest);
  [swapped.assets["digit-1"], swapped.assets["digit-2"]] = [swapped.assets["digit-2"], swapped.assets["digit-1"]];
  await replaceFetch({ ...fixture, manifest: swapped }, async () => {
    await assert.rejects(loadMemoryAudio(fixture.key), /spoken digits could not unlock/);
  });
  const modified = fixture.assets.get(fixture.manifest.assets["digit-1"].path).slice();
  modified[14] ^= 1;
  const changed = new Map(fixture.assets);
  changed.set(fixture.manifest.assets["digit-1"].path, modified);
  await replaceFetch({ ...fixture, assets: changed }, async () => {
    await assert.rejects(loadMemoryAudio(fixture.key), /spoken digits could not unlock/);
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadMemoryAudio(fixture.key, controller.signal), { name: "AbortError" });
});

test("manifest and content validation reject unsafe paths, weak KDF bounds and malformed tasks", async () => {
  const fixture = await encryptedFixture();
  validateMemoryManifest(fixture.manifest);
  for (const path of ["../content.bin", "https://example.test/content.bin", "/content.bin", "content.bin?x=1"]) {
    assert.throws(() => validateMemoryManifest({ ...fixture.manifest, payload: { ...fixture.manifest.payload, path } }), /unsupported format/);
  }
  for (const iterations of [0, 99999, 2000001, Infinity, "600000"]) {
    assert.throws(() => validateMemoryManifest({ ...fixture.manifest, encryption: { ...fixture.manifest.encryption, iterations } }), /unsupported format/);
  }
  for (const bytes of [27, 2000001, NaN, "100"]) {
    assert.throws(() => validateMemoryManifest({ ...fixture.manifest, payload: { ...fixture.manifest.payload, bytes } }), /unsupported format/);
  }
  validateMemoryContent(fixture.content);
  const duplicate = structuredClone(fixture.content);
  duplicate.tasks[1].id = duplicate.tasks[0].id;
  assert.throws(() => validateMemoryContent(duplicate), /invalid or missing exercise/);
  const missingAudio = structuredClone(fixture.content);
  missingAudio.tasks = missingAudio.tasks.filter(task => task.id !== "hidden-digits");
  assert.throws(() => validateMemoryContent(missingAudio), /unsupported format/);
  const unknown = structuredClone(fixture.content);
  unknown.tasks[10].id = "unknown-exercise";
  assert.throws(() => validateMemoryContent(unknown), /invalid or missing exercise/);
  const link = structuredClone(fixture.content);
  link.sources[0].url = "javascript:void(0)";
  assert.throws(() => validateMemoryContent(link), /invalid source link/);
});

test("device progress uses fresh authenticated ciphertext and rejects wrong keys or damaged data", async () => {
  const fixture = await encryptedFixture();
  const other = await deriveSearchKey(randomBytes(24).toString("base64"), fixture.manifest.encryption);
  await withStorage(memoryStorage(), async () => {
    const progress = { privateFixture: randomBytes(12).toString("hex"), attempts: [true, false] };
    await saveMemoryProgress(fixture.key, progress);
    const first = localStorage.getItem(MEMORY_PROGRESS_STORAGE_KEY);
    assert.ok(!first.includes(progress.privateFixture));
    assert.ok(!first.includes(fixture.password));
    assert.deepEqual(await loadMemoryProgress(fixture.key), progress);
    assert.equal(await loadMemoryProgress(other), null);
    await saveMemoryProgress(fixture.key, progress);
    const second = localStorage.getItem(MEMORY_PROGRESS_STORAGE_KEY);
    assert.notEqual(second, first, "Every save requires a fresh nonce.");
    const envelope = JSON.parse(second);
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[15] ^= 1;
    localStorage.setItem(MEMORY_PROGRESS_STORAGE_KEY, JSON.stringify({ ...envelope, ciphertext: bytes.toString("base64") }));
    assert.equal(await loadMemoryProgress(fixture.key), null);
    localStorage.setItem(MEMORY_PROGRESS_STORAGE_KEY, "{broken json");
    assert.equal(await loadMemoryProgress(fixture.key), null);
  });
});

test("queued saves snapshot input, retain the latest state and cannot resurrect cleared progress", async () => {
  const fixture = await encryptedFixture();
  await withStorage(memoryStorage(), async () => {
    const mutable = { cursor: 1 };
    const first = saveMemoryProgress(fixture.key, mutable);
    mutable.cursor = 2;
    await first;
    assert.deepEqual(await loadMemoryProgress(fixture.key), { cursor: 1 });
    await Promise.all([saveMemoryProgress(fixture.key, { cursor: 3 }), saveMemoryProgress(fixture.key, { cursor: 4 })]);
    assert.deepEqual(await loadMemoryProgress(fixture.key), { cursor: 4 });
    await Promise.all([saveMemoryProgress(fixture.key, { cursor: 5 }), clearMemoryProgress()]);
    assert.equal(await loadMemoryProgress(fixture.key), null);
    assert.equal(localStorage.getItem(MEMORY_PROGRESS_STORAGE_KEY), null);
  });
});

test("blocked storage and a failed save do not poison the queue", async () => {
  const fixture = await encryptedFixture();
  const local = memoryStorage();
  const write = local.setItem;
  local.setItem = () => { throw new Error("quota"); };
  await withStorage(local, async () => {
    await assert.rejects(saveMemoryProgress(fixture.key, { cursor: 1 }), /can keep playing/);
    local.setItem = write;
    await saveMemoryProgress(fixture.key, { cursor: 2 });
    assert.deepEqual(await loadMemoryProgress(fixture.key), { cursor: 2 });
  });
  await withStorage(undefined, async () => {
    assert.equal(await loadMemoryProgress(fixture.key), null);
    await assert.rejects(saveMemoryProgress(fixture.key, {}), /can keep playing/);
    await assert.rejects(clearMemoryProgress(), /could not be cleared/);
  });
});

test("the pack builder publishes only ciphertext and a minimal manifest that unlocks with its supplied secret", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memory-vault-test-"));
  try {
    const source = join(temporary, "private-content.json");
    const output = join(temporary, "vault");
    const audioDirectory = join(temporary, "private-audio");
    await mkdir(audioDirectory);
    for (let digit = 1; digit <= 9; digit++) await writeFile(join(audioDirectory, `digit-${digit}.mp3`), randomBytes(60));
    const content = contentFixture();
    const password = randomBytes(24).toString("base64");
    await writeFile(source, JSON.stringify(content));
    const result = await execute(process.execPath, [fileURLToPath(new URL("../scripts/encrypt-working-memory.mjs", import.meta.url)),
      "--source", source, "--audio-directory", audioDirectory, "--output", output], {
      env: { ...process.env, WORKING_MEMORY_PASSWORD: password },
    });
    assert.ok(!result.stdout.includes(password));
    assert.ok(!result.stdout.includes(content.intro));
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    validateMemoryManifest(manifest);
    assert.equal(manifest.encryption.iterations, 600000);
    assert.deepEqual(Object.keys(manifest).sort(), ["assets", "encryption", "payload", "schemaVersion", "version"]);
    assert.equal(Object.keys(manifest.assets).length, 9);
    assert.deepEqual((await readdir(output)).sort(), [manifest.payload.path, "manifest.json", ...Object.values(manifest.assets).map(asset => asset.path)].sort());
    const encrypted = new Uint8Array(await readFile(join(output, manifest.payload.path)));
    await replaceFetch({ manifest, encrypted }, async () => {
      assert.deepEqual((await unlockMemoryVault(password)).content, content);
    });
    assert.ok(!Buffer.from(encrypted).includes(Buffer.from(content.intro)));
    const args = [fileURLToPath(new URL("../scripts/encrypt-working-memory.mjs", import.meta.url)),
      "--source", source, "--audio-directory", audioDirectory, "--output", output];
    await execute(process.execPath, args, { env: { ...process.env, WORKING_MEMORY_PASSWORD: password } });
    const replaced = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    assert.notEqual(replaced.version, manifest.version);
    assert.notEqual(replaced.encryption.salt, manifest.encryption.salt);
    assert.ok(!(await readdir(output)).includes(manifest.payload.path), "Rebuilding removes superseded ciphertext.");
    await writeFile(join(output, "keep-this-file.txt"), "unrelated local file");
    await assert.rejects(execute(process.execPath, args, { env: { ...process.env, WORKING_MEMORY_PASSWORD: password } }), /unknown files/);
    assert.equal(await readFile(join(output, "keep-this-file.txt"), "utf8"), "unrelated local file");
    assert.deepEqual(JSON.parse(await readFile(join(output, "manifest.json"), "utf8")), replaced);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("the published practice pack contains only its minimal manifest and verified encrypted payload", async () => {
  const root = new URL("../public/working-memory/vault/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  validateMemoryManifest(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), ["assets", "encryption", "payload", "schemaVersion", "version"]);
  assert.deepEqual(Object.keys(manifest.payload).sort(), ["bytes", "path", "sha256"]);
  assert.deepEqual(Object.keys(manifest.encryption).sort(), ["hash", "iterations", "kdf", "name", "salt"]);
  assert.equal(Object.keys(manifest.assets).length, 9);
  assert.deepEqual((await readdir(root)).sort(), ["manifest.json", manifest.payload.path, ...Object.values(manifest.assets).map(asset => asset.path)].sort());
  const encrypted = new Uint8Array(await readFile(new URL(manifest.payload.path, root)));
  assert.equal(encrypted.length, manifest.payload.bytes);
  assert.equal(await sha256(encrypted), manifest.payload.sha256);
  for (const asset of Object.values(manifest.assets)) {
    const bytes = new Uint8Array(await readFile(new URL(asset.path, root)));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(await sha256(bytes), asset.sha256);
  }
  assert.equal(manifest.encryption.iterations, 600000);
});
