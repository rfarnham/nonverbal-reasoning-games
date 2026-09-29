#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../public/question-search/ocr/", import.meta.url);
await mkdir(root, { recursive: true });
await copyFile(new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url), new URL("worker.min.js", root));
for (const name of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core.wasm.js", "tesseract-core-simd.wasm.js", "LICENSE"]) {
  await copyFile(new URL(`../node_modules/tesseract.js-core/${name}`, import.meta.url), new URL(name, root));
}
const file = new URL("eng.traineddata.gz", root);
const expected = "18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b";
let bytes;
try { bytes = await readFile(file); } catch { /* Fetch the pinned build input when missing. */ }
if (!bytes || createHash("sha256").update(bytes).digest("hex") !== expected) {
  const response = await fetch("https://raw.githubusercontent.com/naptha/tessdata/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_fast/eng.traineddata.gz");
  if (!response.ok) throw new Error(`OCR model download failed (${response.status}).`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("OCR model checksum mismatch.");
  await writeFile(file, bytes);
}
console.log("Bundled OCR assets ready; no runtime CDN dependency.");
