/** Crop edges are fractions of the decoded image, independent of preview size. */
export type ImageCrop = { left: number; top: number; right: number; bottom: number };
export const FULL_IMAGE_CROP: ImageCrop = { left: 0, top: 0, right: 1, bottom: 1 };
const MIN_SPAN = 0.01;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function normalizeImageCrop(crop: ImageCrop): ImageCrop {
  const left = clamp(finite(crop.left, 0), 0, 1 - MIN_SPAN);
  const top = clamp(finite(crop.top, 0), 0, 1 - MIN_SPAN);
  return { left, top, right: clamp(finite(crop.right, 1), left + MIN_SPAN, 1), bottom: clamp(finite(crop.bottom, 1), top + MIN_SPAN, 1) };
}

export function imageCropFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): ImageCrop {
  return normalizeImageCrop({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) });
}

export function imageCropPixels(crop: ImageCrop, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error("This picture has invalid dimensions.");
  const bounded = normalizeImageCrop(crop);
  const x = Math.min(width - 1, Math.floor(bounded.left * width));
  const y = Math.min(height - 1, Math.floor(bounded.top * height));
  return { x, y, width: Math.max(1, Math.ceil(bounded.right * width) - x), height: Math.max(1, Math.ceil(bounded.bottom * height) - y) };
}

/** Bound the canvas without enlarging a small screenshot. */
export function imageOutputSize(width: number, height: number, maxEdge = 4096, maxPixels = 12_000_000) {
  if (![width, height, maxEdge, maxPixels].every(value => Number.isFinite(value) && value >= 1)) throw new Error("This picture has invalid dimensions.");
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
