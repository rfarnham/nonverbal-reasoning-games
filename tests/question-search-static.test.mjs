import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { validateManifest } from "../lib/question-search/crypto.ts";

const project = new URL("../", import.meta.url);
const output = new URL("../out/", import.meta.url);
const basePath = "/nonverbal-reasoning-games";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function filesBelow(root, prefix = "") {
  const entries = await readdir(new URL(prefix, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    assert.equal(entry.isSymbolicLink(), false, "Search assets must be real files, not links to private build inputs.");
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesBelow(root, `${relative}/`));
    else files.push(relative);
  }
  return files.sort();
}

test("question search exports a locked, refresh-safe route with the Pages base path", async () => {
  const html = await readFile(new URL("question-search/index.html", output), "utf8");
  assert.match(html, /<title>Question Search · Spatial Gym<\/title>/);
  assert.match(html, /Unlock question bank/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, new RegExp(`href="${basePath}/"`));
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  const assets = urls.filter((url) => url.includes("/_next/"));
  assert.ok(assets.length > 0, "The route must include its locally exported application assets.");
  for (const asset of assets) {
    assert.ok(asset.startsWith(`${basePath}/_next/`), "An application asset bypasses the Pages base path.");
    await access(new URL(asset.slice(basePath.length + 1).split("?")[0], output));
  }
  for (const url of urls.filter((value) => value.startsWith("/"))) {
    assert.ok(url.startsWith(`${basePath}/`), "An internal route bypasses the Pages base path.");
  }
  const passwordInputs = [...html.matchAll(/<input\b[^>]*type="password"[^>]*>/g)].map((match) => match[0]);
  assert.equal(passwordInputs.length, 1);
  assert.match(passwordInputs[0], /value=""/);
  assert.doesNotMatch(html, /<(?:article|img)\b/, "The locked page must not prerender question results or images.");
  // Test public format markers, never bake an actual hidden prompt/password into CI.
  assert.doesNotMatch(html, /originalPrompt|annotationStatus|candidateVersion|question-search-build|assets\.json/);
  assert.doesNotMatch(html, /data:image\//);
});

test("the published search pack contains only authenticated binary payloads and a minimal manifest", async () => {
  const publicRoot = new URL("public/question-search/data/", project);
  const exportedRoot = new URL("question-search/data/", output);
  const [published, exported] = await Promise.all([filesBelow(publicRoot), filesBelow(exportedRoot)]);
  assert.deepEqual(exported, published, "The static export must contain precisely the published encrypted pack.");
  const manifest = JSON.parse(await readFile(new URL("manifest.json", exportedRoot), "utf8"));
  validateManifest(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), ["count", "encryption", "index", "schemaVersion", "version"]);
  assert.deepEqual(Object.keys(manifest.index).sort(), ["bytes", "path", "sha256"]);
  assert.deepEqual(Object.keys(manifest.encryption).sort(), ["hash", "iterations", "kdf", "name", "salt"]);
  const images = published.filter((file) => file.startsWith("assets/"));
  assert.ok(images.length > 0 && images.length <= manifest.count, "Expected a deduplicated encrypted question-image collection.");
  for (const file of published) {
    assert.ok(file === "manifest.json" || file === manifest.index.path || file === "benchmark.bin" || /^assets\/[a-f0-9]{64}\.bin$/.test(file),
      "Only the manifest and named encrypted index/benchmark/image payloads may be published.");
  }
  const binaryFiles = published.filter((file) => file.endsWith(".bin"));
  for (let offset = 0; offset < binaryFiles.length; offset += 128) {
    await Promise.all(binaryFiles.slice(offset, offset + 128).map(async (file) => {
      const [original, copy] = await Promise.all([stat(new URL(file, publicRoot)), stat(new URL(file, exportedRoot))]);
      assert.ok(original.size >= 28, "An encrypted payload cannot be shorter than its nonce and authentication tag.");
      assert.equal(copy.size, original.size, "An encrypted payload was truncated during static export.");
    }));
  }
  const index = await readFile(new URL(manifest.index.path, exportedRoot));
  assert.equal(index.byteLength, manifest.index.bytes);
  assert.equal(digest(index), manifest.index.sha256);
  assert.deepEqual(published.filter((file) => file.endsWith(".json")), ["manifest.json"]);
});

test("the static search route ships pinned local OCR assets and attribution", async () => {
  const root = new URL("question-search/ocr/", output);
  const publicRoot = new URL("public/question-search/ocr/", project);
  const expected = ["worker.min.js", "eng.traineddata.gz", "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js", "tesseract-core.wasm.js", "tesseract-core-simd.wasm.js", "LICENSE", "NOTICE.md"];
  assert.deepEqual(await filesBelow(root), [...expected].sort());
  for (const file of expected) {
    const [original, copy] = await Promise.all([readFile(new URL(file, publicRoot)), readFile(new URL(file, root))]);
    assert.ok(copy.length > 0);
    assert.equal(digest(copy), digest(original), "A bundled OCR asset changed during export.");
  }
  const notice = await readFile(new URL("NOTICE.md", root), "utf8");
  const modelHash = notice.match(/eng\.traineddata\.gz SHA-256:\s*([a-f0-9]{64})/)?.[1];
  assert.ok(modelHash, "The bundled language model needs a recorded digest.");
  assert.equal(digest(await readFile(new URL("eng.traineddata.gz", root))), modelHash);
  assert.match(notice, /Apache-2\.0/);
  assert.match(notice, /naptha\/tessdata/);
  const packageLock = JSON.parse(await readFile(new URL("package-lock.json", project), "utf8"));
  for (const dependency of ["tesseract.js", "tesseract.js-core"]) {
    const entry = packageLock.packages[`node_modules/${dependency}`];
    assert.ok(entry?.version && entry?.integrity, "OCR dependency versions and integrity must be pinned.");
    assert.ok(notice.includes(`${dependency} ${entry.version}`), "OCR attribution must identify the shipped version.");
  }
  await access(new URL("question-search/sw.js", output));
});
