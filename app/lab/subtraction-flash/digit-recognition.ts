const INPUT_SIZE = 28;
const INK_SPAN = 20;
const INK_THRESHOLD = 0.04;
const MODEL_PATH = "/models/handwriting/mnist.onnx";
const RUNTIME_MJS_PATH =
  "/models/handwriting/ort-wasm-simd-threaded.mjs";
const RUNTIME_WASM_PATH =
  "/models/handwriting/ort-wasm-simd-threaded.wasm";

export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type DigitImageData = Readonly<{
  width: number;
  height: number;
  data: ArrayLike<number>;
}>;

export type NormalizedDigitImage = Readonly<{
  data: Float32Array;
  hasInk: boolean;
}>;

export type DigitRecognition = Readonly<{
  digit: Digit;
  confidence: number;
  margin: number;
}>;

export class EmptyDigitImageError extends Error {
  override name = "EmptyDigitImageError";

  constructor() {
    super("Draw a digit before asking for recognition.");
  }
}

type Bounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

type OrtRuntime = typeof import("onnxruntime-web/wasm");
type OrtSession = Awaited<
  ReturnType<OrtRuntime["InferenceSession"]["create"]>
>;

let runtimePromise: Promise<OrtRuntime> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertImageData(image: DigitImageData): void {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new RangeError("Digit image dimensions must be positive integers.");
  }

  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError("Digit image must contain RGBA pixels.");
  }
}

function usesTransparentBackground(image: DigitImageData): boolean {
  let opaquePixels = 0;
  const pixelCount = image.width * image.height;

  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] >= 250) opaquePixels += 1;
  }

  return opaquePixels / pixelCount < 0.5;
}

function extractInk(image: DigitImageData): Readonly<{
  pixels: Float32Array;
  bounds: Bounds | null;
}> {
  const transparentBackground = usesTransparentBackground(image);
  const pixels = new Float32Array(image.width * image.height);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x;
      const rgbaIndex = pixelIndex * 4;
      const alpha = image.data[rgbaIndex + 3] / 255;
      const luminance =
        (0.2126 * image.data[rgbaIndex] +
          0.7152 * image.data[rgbaIndex + 1] +
          0.0722 * image.data[rgbaIndex + 2]) /
        255;
      const ink = transparentBackground
        ? alpha
        : alpha * (1 - luminance);

      if (ink < INK_THRESHOLD) continue;

      pixels[pixelIndex] = ink;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    pixels,
    bounds:
      maxX < minX || maxY < minY
        ? null
        : { minX, minY, maxX, maxY },
  };
}

function areaResize(
  source: Float32Array,
  sourceWidth: number,
  bounds: Bounds,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const output = new Float32Array(targetWidth * targetHeight);
  const cropWidth = bounds.maxX - bounds.minX + 1;
  const cropHeight = bounds.maxY - bounds.minY + 1;

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceTop =
      bounds.minY + (targetY * cropHeight) / targetHeight;
    const sourceBottom =
      bounds.minY + ((targetY + 1) * cropHeight) / targetHeight;
    const firstSourceY = Math.max(bounds.minY, Math.floor(sourceTop));
    const lastSourceY = Math.min(
      bounds.maxY + 1,
      Math.ceil(sourceBottom),
    );

    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceLeft =
        bounds.minX + (targetX * cropWidth) / targetWidth;
      const sourceRight =
        bounds.minX + ((targetX + 1) * cropWidth) / targetWidth;
      const firstSourceX = Math.max(bounds.minX, Math.floor(sourceLeft));
      const lastSourceX = Math.min(
        bounds.maxX + 1,
        Math.ceil(sourceRight),
      );
      let weightedInk = 0;
      let coveredArea = 0;

      for (let sourceY = firstSourceY; sourceY < lastSourceY; sourceY += 1) {
        const verticalCoverage = Math.max(
          0,
          Math.min(sourceBottom, sourceY + 1) -
            Math.max(sourceTop, sourceY),
        );

        for (
          let sourceX = firstSourceX;
          sourceX < lastSourceX;
          sourceX += 1
        ) {
          const horizontalCoverage = Math.max(
            0,
            Math.min(sourceRight, sourceX + 1) -
              Math.max(sourceLeft, sourceX),
          );
          const coverage = verticalCoverage * horizontalCoverage;
          weightedInk += source[sourceY * sourceWidth + sourceX] * coverage;
          coveredArea += coverage;
        }
      }

      output[targetY * targetWidth + targetX] =
        coveredArea > 0 ? weightedInk / coveredArea : 0;
    }
  }

  return output;
}

function centerOfMass(
  pixels: Float32Array,
  width: number,
  height: number,
): Readonly<{ x: number; y: number }> {
  let mass = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixels[y * width + x];
      mass += value;
      weightedX += x * value;
      weightedY += y * value;
    }
  }

  return mass > 0
    ? { x: weightedX / mass, y: weightedY / mass }
    : { x: (width - 1) / 2, y: (height - 1) / 2 };
}

/**
 * Converts canvas pixels into the centered 28×28, white-on-black raster used
 * by the bundled MNIST model. Both transparent canvases and opaque white
 * canvases are accepted.
 */
export function normalizeDigitImage(
  image: DigitImageData,
): NormalizedDigitImage {
  assertImageData(image);
  const { pixels, bounds } = extractInk(image);
  const output = new Float32Array(INPUT_SIZE * INPUT_SIZE);

  if (!bounds) {
    return { data: output, hasInk: false };
  }

  const cropWidth = bounds.maxX - bounds.minX + 1;
  const cropHeight = bounds.maxY - bounds.minY + 1;
  const scale = INK_SPAN / Math.max(cropWidth, cropHeight);
  const resizedWidth = clamp(
    Math.round(cropWidth * scale),
    1,
    INK_SPAN,
  );
  const resizedHeight = clamp(
    Math.round(cropHeight * scale),
    1,
    INK_SPAN,
  );
  const resized = areaResize(
    pixels,
    image.width,
    bounds,
    resizedWidth,
    resizedHeight,
  );
  const massCenter = centerOfMass(
    resized,
    resizedWidth,
    resizedHeight,
  );
  const canvasCenter = (INPUT_SIZE - 1) / 2;
  const initialX = Math.floor((INPUT_SIZE - resizedWidth) / 2);
  const initialY = Math.floor((INPUT_SIZE - resizedHeight) / 2);
  const shiftX = clamp(
    Math.round(canvasCenter - (initialX + massCenter.x)),
    -initialX,
    INPUT_SIZE - resizedWidth - initialX,
  );
  const shiftY = clamp(
    Math.round(canvasCenter - (initialY + massCenter.y)),
    -initialY,
    INPUT_SIZE - resizedHeight - initialY,
  );
  const offsetX = initialX + shiftX;
  const offsetY = initialY + shiftY;

  for (let y = 0; y < resizedHeight; y += 1) {
    for (let x = 0; x < resizedWidth; x += 1) {
      output[(offsetY + y) * INPUT_SIZE + offsetX + x] =
        resized[y * resizedWidth + x];
    }
  }

  return { data: output, hasInk: true };
}

export function rankDigitLogits(logits: ArrayLike<number>): DigitRecognition {
  if (logits.length !== 10) {
    throw new RangeError("The digit model must return exactly ten logits.");
  }

  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < logits.length; index += 1) {
    const value = Number(logits[index]);
    if (!Number.isFinite(value)) {
      throw new TypeError("The digit model returned a non-finite logit.");
    }
    maximum = Math.max(maximum, value);
  }

  const probabilities = new Float64Array(logits.length);
  let probabilityTotal = 0;

  for (let index = 0; index < logits.length; index += 1) {
    const probability = Math.exp(Number(logits[index]) - maximum);
    probabilities[index] = probability;
    probabilityTotal += probability;
  }

  let topIndex = 0;
  let runnerUpIndex = 1;

  for (let index = 0; index < probabilities.length; index += 1) {
    probabilities[index] /= probabilityTotal;
    if (probabilities[index] > probabilities[topIndex]) {
      runnerUpIndex = topIndex;
      topIndex = index;
    } else if (
      index !== topIndex &&
      probabilities[index] > probabilities[runnerUpIndex]
    ) {
      runnerUpIndex = index;
    }
  }

  if (runnerUpIndex === topIndex) {
    runnerUpIndex = topIndex === 0 ? 1 : 0;
  }

  return {
    digit: topIndex as Digit,
    confidence: probabilities[topIndex],
    margin: probabilities[topIndex] - probabilities[runnerUpIndex],
  };
}

function localAssetUrl(path: string): string {
  if (typeof window === "undefined") {
    throw new Error("Digit recognition is available only in the browser.");
  }

  const configuredBasePath =
    process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/+$/, "") ?? "";
  return new URL(`${configuredBasePath}${path}`, window.location.origin).href;
}

async function loadRuntime(): Promise<OrtRuntime> {
  if (!runtimePromise) {
    runtimePromise = import("onnxruntime-web/wasm").then((runtime) => {
      runtime.env.wasm.numThreads = 1;
      runtime.env.wasm.proxy = false;
      runtime.env.wasm.wasmPaths = {
        mjs: localAssetUrl(RUNTIME_MJS_PATH),
        wasm: localAssetUrl(RUNTIME_WASM_PATH),
      };
      return runtime;
    });
  }

  return runtimePromise;
}

async function createWarmedSession(): Promise<OrtSession> {
  const runtime = await loadRuntime();
  const session = await runtime.InferenceSession.create(
    localAssetUrl(MODEL_PATH),
    {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    },
  );
  const inputName = session.inputNames[0];

  if (!inputName) {
    throw new Error("The digit model does not expose an input tensor.");
  }

  await session.run({
    [inputName]: new runtime.Tensor(
      "float32",
      new Float32Array(INPUT_SIZE * INPUT_SIZE),
      [1, 1, INPUT_SIZE, INPUT_SIZE],
    ),
  });

  return session;
}

async function loadSession(): Promise<OrtSession> {
  if (!sessionPromise) {
    sessionPromise = createWarmedSession().catch((error: unknown) => {
      sessionPromise = null;
      throw error;
    });
  }

  return sessionPromise;
}

/**
 * Downloads, initializes, and warms the local model. Call this when Draw mode
 * is selected, before starting its response clock.
 */
export async function warmDigitRecognizer(): Promise<void> {
  await loadSession();
}

/**
 * Recognizes the top digit regardless of confidence. UI code owns confidence
 * thresholds so the QA-visible prediction and submission policy stay aligned.
 */
export async function recognizeDigit(
  image: DigitImageData,
): Promise<DigitRecognition> {
  const normalized = normalizeDigitImage(image);
  if (!normalized.hasInk) throw new EmptyDigitImageError();

  const [runtime, session] = await Promise.all([
    loadRuntime(),
    loadSession(),
  ]);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  if (!inputName || !outputName) {
    throw new Error("The digit model has an unexpected tensor signature.");
  }

  const output = await session.run({
    [inputName]: new runtime.Tensor(
      "float32",
      normalized.data,
      [1, 1, INPUT_SIZE, INPUT_SIZE],
    ),
  });
  const logits = output[outputName]?.data;

  if (
    !(logits instanceof Float32Array) &&
    !(logits instanceof Float64Array)
  ) {
    throw new Error("The digit model did not return scores.");
  }

  return rankDigitLogits(logits);
}
