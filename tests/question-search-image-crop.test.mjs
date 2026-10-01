import test from "node:test";
import assert from "node:assert/strict";
import { FULL_IMAGE_CROP, imageCropFromPoints, imageCropPixels, imageOutputSize, normalizeImageCrop } from "../lib/question-search/image-crop.ts";

test("crop pixels preserve all edges and honor normalized screenshot coordinates", () => {
  assert.deepEqual(imageCropPixels(FULL_IMAGE_CROP, 4032, 3024), { x: 0, y: 0, width: 4032, height: 3024 });
  assert.deepEqual(imageCropPixels({ left: .1, top: .2, right: .9, bottom: .8 }, 1000, 600), { x: 100, y: 120, width: 800, height: 360 });
  const tiny = imageCropPixels({ left: 1, top: 1, right: 1, bottom: 1 }, 1, 1);
  assert.deepEqual(tiny, { x: 0, y: 0, width: 1, height: 1 });
});

test("reverse and off-image drags stay inside the source with a nonempty crop", () => {
  assert.deepEqual(imageCropFromPoints({ x: .9, y: .8 }, { x: .2, y: .3 }), { left: .2, top: .3, right: .9, bottom: .8 });
  for (const crop of [imageCropFromPoints({ x: -1, y: -1 }, { x: 2, y: 2 }), normalizeImageCrop({ left: NaN, top: Infinity, right: -5, bottom: 0 }), normalizeImageCrop({ left: 1, top: 1, right: 0, bottom: 0 })]) {
    const pixels = imageCropPixels(crop, 853, 1707);
    assert.ok(pixels.width > 0 && pixels.height > 0);
    assert.ok(pixels.x >= 0 && pixels.y >= 0 && pixels.x + pixels.width <= 853 && pixels.y + pixels.height <= 1707);
  }
});

test("camera and crop output is bounded without upscaling", () => {
  assert.deepEqual(imageOutputSize(700, 300), { width: 700, height: 300 });
  for (const [width, height] of [[12000, 5000], [10000, 10000], [6000, 8000], [10000, 1]]) {
    const size = imageOutputSize(width, height);
    assert.ok(size.width <= 4096 && size.height <= 4096 && size.width * size.height <= 12_000_000);
    assert.ok(size.width >= 1 && size.height >= 1);
  }
  assert.throws(() => imageCropPixels(FULL_IMAGE_CROP, 0, 10), /dimensions/);
  assert.throws(() => imageOutputSize(Infinity, 10), /dimensions/);
});
