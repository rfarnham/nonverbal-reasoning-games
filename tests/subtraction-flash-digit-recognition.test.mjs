import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  normalizeDigitImage,
  rankDigitLogits,
} from "../app/lab/subtraction-flash/digit-recognition.ts";

const assetRoot = new URL(
  "../public/models/handwriting/",
  import.meta.url,
);

function createRaster(width, height, background = "transparent") {
  const data = new Uint8ClampedArray(width * height * 4);

  if (background === "white") {
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
  }

  return { width, height, data };
}

function fillRectangle(image, left, top, width, height, color = "black") {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const index = (y * image.width + x) * 4;
      const channel = color === "white" ? 255 : 0;
      image.data[index] = channel;
      image.data[index + 1] = channel;
      image.data[index + 2] = channel;
      image.data[index + 3] = 255;
    }
  }
}

function activeBounds(pixels, width) {
  let minX = width;
  let minY = pixels.length / width;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < pixels.length; index += 1) {
    if (pixels[index] <= 0.001) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

test("blank input produces an empty normalized raster", () => {
  const normalized = normalizeDigitImage(createRaster(48, 48));

  assert.equal(normalized.hasInk, false);
  assert.equal(normalized.data.length, 28 * 28);
  assert.ok(normalized.data.every((value) => value === 0));
});

test("normalization ignores opaque white paper and preserves aspect ratio", () => {
  const raster = createRaster(48, 48, "white");
  fillRectangle(raster, 19, 8, 6, 24);

  const normalized = normalizeDigitImage(raster);
  const bounds = activeBounds(normalized.data, 28);

  assert.equal(normalized.hasInk, true);
  assert.equal(bounds.maxX - bounds.minX + 1, 5);
  assert.equal(bounds.maxY - bounds.minY + 1, 20);
  assert.ok(bounds.minX >= 11 && bounds.maxX <= 16);
  assert.ok(bounds.minY >= 4 && bounds.maxY <= 23);
  assert.ok(
    normalized.data.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ),
  );
});

test("normalization is independent of the drawing's canvas position", () => {
  const first = createRaster(64, 64);
  const second = createRaster(64, 64);
  fillRectangle(first, 4, 6, 8, 30, "white");
  fillRectangle(second, 45, 28, 8, 30, "white");

  assert.deepEqual(
    normalizeDigitImage(first).data,
    normalizeDigitImage(second).data,
  );
});

test("ranking returns the top digit, softmax confidence, and margin", () => {
  const logits = new Float32Array(10);
  logits[2] = 3;
  logits[7] = 5;

  const result = rankDigitLogits(logits);

  assert.equal(result.digit, 7);
  assert.ok(result.confidence > 0.7);
  assert.ok(result.margin > 0.6);
});

test("ranking preserves a top prediction even at low confidence", () => {
  const result = rankDigitLogits(new Float32Array(10));

  assert.deepEqual(result, {
    digit: 0,
    confidence: 0.1,
    margin: 0,
  });
});

test("ranking rejects malformed model output", () => {
  assert.throws(
    () => rankDigitLogits(new Float32Array(9)),
    /exactly ten logits/,
  );

  const nonFinite = new Float32Array(10);
  nonFinite[4] = Number.NaN;
  assert.throws(() => rankDigitLogits(nonFinite), /non-finite logit/);
});

test("vendored model and runtime assets match their pinned checksums", async () => {
  const expected = new Map([
    [
      "mnist.onnx",
      {
        bytes: 26_454,
        sha256:
          "0d715376572e89832685c56a65ef1391f5f0b7dd31d61050c91ff3ecab16c032",
      },
    ],
    [
      "ort-wasm-simd-threaded.mjs",
      {
        bytes: 24_180,
        sha256:
          "0a1e718d99c41b22c21f2520ff4f9e883a6b5533856e398d21816ee8eb8185d3",
      },
    ],
    [
      "ort-wasm-simd-threaded.wasm",
      {
        bytes: 13_479_978,
        sha256:
          "d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6",
      },
    ],
  ]);

  for (const [filename, expectation] of expected) {
    const assetUrl = new URL(filename, assetRoot);
    const bytes = await readFile(assetUrl);
    const digest = createHash("sha256").update(bytes).digest("hex");

    assert.equal((await stat(assetUrl)).size, expectation.bytes);
    assert.equal(digest, expectation.sha256);
  }
});
