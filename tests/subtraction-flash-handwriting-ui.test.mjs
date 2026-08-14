import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL(
    "../app/lab/subtraction-flash/flash-handwriting.tsx",
    import.meta.url,
  ),
  "utf8",
);

function section(startMarker, endMarker) {
  const start = component.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = component.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return component.slice(start, end);
}

test("default multi-digit handwriting still waits for every required slot", () => {
  const slotGate = section(
    "export function handwritingRecognitionSlots",
    "function clearPixels",
  );
  const recognition = section(
    "const recognizeAnswer = useCallback",
    "const beginStroke =",
  );
  const completeSlotGate = recognition.indexOf("handwritingRecognitionSlots(");
  const recognitionDelay = recognition.indexOf("window.setTimeout");

  assert.ok(completeSlotGate >= 0, "all required slots share one completion gate");
  assert.ok(
    completeSlotGate < recognitionDelay,
    "no recognition starts before every required writing slot has ink",
  );
  assert.match(
    slotGate,
    /entryMode === "exact-slots"[\s\S]*occupied\.every\(Boolean\)/,
  );
  assert.match(
    recognition,
    /const slots = handwritingRecognitionSlots[\s\S]*slots\.map\(\(index\)[\s\S]*getImageData/,
    "the recognizer reads exactly the required one, two, or three fields",
  );
  assert.match(
    section("const finishStroke =", "return ("),
    /recognizeAnswer\(\)/,
    "a one-digit answer keeps recognizing immediately after its stroke",
  );
});

test("curriculum handwriting waits for a contiguous suffix ending in Ones", () => {
  const slotGate = section(
    "export function handwritingRecognitionSlots",
    "function clearPixels",
  );
  assert.match(slotGate, /if \(!occupied\.at\(-1\)\) return null/);
  assert.match(slotGate, /const firstOccupied = occupied\.indexOf\(true\)/);
  assert.match(slotGate, /occupied\.slice\(firstOccupied\)\.every\(Boolean\)/);
  assert.match(component, /entryMode\?: "exact-slots" \| "right-aligned"/);
  assert.match(component, /Use the rightmost boxes/);
  assert.match(component, /PLACE_LABELS\[digitCount\]\[index\]/);
});

test("the shared handwriting control supports three-digit Grade 1 answers", () => {
  assert.match(component, /digitCount: 1 \| 2 \| 3/);
  assert.match(component, /useRef\(\[false, false, false\]\)/);
  assert.match(component, /useState\(\[false, false, false\]\)/);
});

test("default low-confidence handwriting still clears for Borrow Flash", () => {
  const recognizedResult = section(
    ".then((predictions) => {",
    ".catch(() => {",
  );
  const qualityGate = recognizedResult.indexOf("confidence < CONFIDENCE_MINIMUM");
  const clear = recognizedResult.indexOf("clearAll()", qualityGate);

  assert.ok(qualityGate >= 0, "recognition checks both confidence measures");
  assert.match(recognizedResult, /margin < MARGIN_MINIMUM/);
  assert.match(component, /rejectedRecognitionMode = "clear"/);
  assert.ok(clear > qualityGate, "the default path clears uncertain ink");
  assert.match(recognizedResult.slice(clear), /draw it again[\s\S]*return;/);
});

test("curriculum can preserve a low-confidence readout for confirmation or correction", () => {
  assert.match(component, /rejectedRecognitionMode\?: "clear" \| "confirm"/);
  assert.match(component, /rejectedRecognitionMode === "confirm"/);
  assert.match(component, /setPendingRecognition\(rejected\)/);
  assert.match(component, /We read \$\{raw\}\. Is that right\?/);
  assert.match(component, />\s*Yes\s*<\/button>/);
  assert.match(component, />\s*Change\s*<\/button>/);
  assert.match(component, /recognitionStatus[\s\S]*"confirmed"[\s\S]*"corrected"/);
  assert.match(component, /Correct the recognized number\. Press Done to submit\./);
});

test("recognizer failures also clear stale scribbles", () => {
  const failure = section(".catch(() => {", "}, READ_DELAY_MS)");
  assert.match(failure, /clearAll\(\)/);
  assert.match(failure, /Couldn’t read that · draw it again/);
});
