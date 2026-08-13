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

test("two-digit handwriting waits for ink in every required slot", () => {
  const recognition = section(
    "const recognizeAnswer = useCallback",
    "const beginStroke =",
  );
  const completeSlotGate = recognition.indexOf(".every(Boolean)");
  const recognitionDelay = recognition.indexOf("window.setTimeout");

  assert.ok(completeSlotGate >= 0, "all required slots share one completion gate");
  assert.ok(
    completeSlotGate < recognitionDelay,
    "no recognition starts before every required writing slot has ink",
  );
  assert.match(
    recognition,
    /Array\.from\(\{ length: digitCount \}, \(_, index\) =>[\s\S]*hasInkRef\.current\[index\][\s\S]*\.every\(Boolean\)/,
  );
  assert.match(
    recognition,
    /Array\.from\(\{ length: digitCount \}, \(_, index\) =>[\s\S]*getImageData/,
    "the recognizer reads exactly the one or two required fields",
  );
  assert.match(
    section("const finishStroke =", "return ("),
    /recognizeAnswer\(\)/,
    "a one-digit answer keeps recognizing immediately after its stroke",
  );
});

test("only a confident complete answer replaces handwriting with the large readout", () => {
  const recognizedResult = section(
    ".then((predictions) => {",
    ".catch(() => {",
  );
  const qualityGate = recognizedResult.indexOf(
    "confidence < CONFIDENCE_MINIMUM || margin < MARGIN_MINIMUM",
  );
  const readout = recognizedResult.indexOf("setReadout(raw)");

  assert.ok(qualityGate >= 0, "recognition checks both confidence measures");
  assert.ok(
    readout > qualityGate,
    "a guessed digit is not rendered before the confidence gate passes",
  );
  assert.match(
    recognizedResult.slice(qualityGate, readout),
    /clearAll\(\)[\s\S]*draw it again[\s\S]*return;/,
    "an uncertain result clears both scribble fields instead of displaying its guess",
  );
});

test("recognizer failures also clear stale scribbles", () => {
  const failure = section(".catch(() => {", "}, READ_DELAY_MS)");
  assert.match(failure, /clearAll\(\)/);
  assert.match(failure, /Couldn’t read that · draw it again/);
});
