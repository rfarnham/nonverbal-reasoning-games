import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRACE_QUALITY_OPTIONS,
  DIGIT_REFERENCE_STROKES,
  isGoodFaithDigitTraceAttempt,
  isAcceptableDigitStrokes,
  isAcceptableDigitTrace,
  resamplePolyline,
  resolveDigitTraceAttempt,
  scoreDigitStrokes,
  scoreDigitTrace,
  traceBounds,
  tracePathLength,
} from "../app/lab/subtraction-flash/trace-geometry.ts";

const DIGITS = [2, 3, 4, 5, 6, 7, 8, 9];

function modestlyNoisy(points, phase = 0, amplitude = 0.035) {
  return points.map((point, index) => ({
    x: point.x + Math.sin(index * 1.73 + phase) * amplitude,
    y: point.y + Math.cos(index * 1.37 + phase) * amplitude,
  }));
}

test("digits 2 through 9 expose bounded, recognizable local vector strokes", () => {
  assert.deepEqual(Object.keys(DIGIT_REFERENCE_STROKES), DIGITS.map(String));
  for (const digit of DIGITS) {
    const strokes = DIGIT_REFERENCE_STROKES[digit];
    const path = strokes.flat();
    assert.ok(path.length >= 4, `${digit}: enough anchors for a recognizable path`);
    assert.ok(
      path.every(
        ({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1,
      ),
      `${digit}: normalized coordinates`,
    );
    const bounds = traceBounds(path);
    assert.ok(bounds.width >= 0.5, `${digit}: occupies the cell width`);
    assert.ok(bounds.height >= 0.75, `${digit}: occupies the cell height`);
    assert.ok(
      strokes.reduce((total, stroke) => total + tracePathLength(stroke), 0) >= 1.2,
      `${digit}: is more than a tap or line`,
    );
  }
});

test("arc-length resampling is deterministic and approximately even", () => {
  const source = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];
  const sampled = resamplePolyline(source, 9);
  assert.deepEqual(sampled, resamplePolyline(source, 9));
  assert.deepEqual(sampled[0], source[0]);
  assert.deepEqual(sampled.at(-1), source.at(-1));
  const steps = sampled.slice(1).map((point, index) =>
    Math.hypot(
      point.x - sampled[index].x,
      point.y - sampled[index].y,
    ),
  );
  assert.ok(steps.every((step) => Math.abs(step - 0.25) < 1e-9));
});

test("close forward and reverse traces survive sparse sampling and modest noise", () => {
  for (const digit of DIGITS) {
    const sparse = DIGIT_REFERENCE_STROKES[digit].map((stroke, strokeIndex) =>
      resamplePolyline(stroke, 15 + strokeIndex * 2),
    );
    const forward = sparse.map((stroke, strokeIndex) =>
      modestlyNoisy(stroke, digit + strokeIndex),
    );
    const reverse = [...sparse]
      .reverse()
      .map((stroke, strokeIndex) =>
        modestlyNoisy([...stroke].reverse(), digit + strokeIndex + 0.5),
      );
    const forwardScore = scoreDigitStrokes(forward, digit);
    const reverseScore = scoreDigitStrokes(reverse, digit);
    assert.equal(forwardScore.accepted, true, `${digit}: close forward trace`);
    assert.equal(forwardScore.direction, "forward", `${digit}: forward direction`);
    assert.equal(reverseScore.accepted, true, `${digit}: close reverse trace`);
    assert.equal(reverseScore.direction, "reverse", `${digit}: reverse direction`);
    assert.equal(isAcceptableDigitStrokes(forward, digit), true);
  }
});

test("finger-sized drift, rotation, and short endpoints remain acceptable", () => {
  for (const digit of DIGITS) {
    const angle = (3 * Math.PI) / 180;
    const transformed = DIGIT_REFERENCE_STROKES[digit].map((stroke) =>
      resamplePolyline(stroke, 35).slice(2, -2).map((point, index) => {
        const centeredX = (point.x - 0.5) * 0.88;
        const centeredY = (point.y - 0.5) * 0.93;
        return {
          x:
            0.5 +
            centeredX * Math.cos(angle) -
            centeredY * Math.sin(angle) +
            0.025 +
            Math.sin(index * 1.71 + digit) * 0.025,
          y:
            0.5 +
            centeredX * Math.sin(angle) +
            centeredY * Math.cos(angle) -
            0.018 +
            Math.cos(index * 1.39 + digit) * 0.025,
        };
      }),
    );
    assert.equal(
      isAcceptableDigitStrokes(transformed, digit),
      true,
      `${digit}: ordinary finger drift should pass`,
    );
  }
});

test("quality defaults are deliberately forgiving without weakening completion", () => {
  assert.ok(DEFAULT_TRACE_QUALITY_OPTIONS.maximumOrderedRmsError >= 0.18);
  assert.ok(DEFAULT_TRACE_QUALITY_OPTIONS.maximumCenterError >= 0.18);
  assert.ok(DEFAULT_TRACE_QUALITY_OPTIONS.maximumMeanPathError >= 0.12);
  assert.ok(DEFAULT_TRACE_QUALITY_OPTIONS.minimumLengthRatio >= 0.7);
});

test("each reference stroke is accepted only for its own numeral", () => {
  for (const drawnDigit of DIGITS) {
    for (const candidateDigit of DIGITS) {
      assert.equal(
        isAcceptableDigitStrokes(
          DIGIT_REFERENCE_STROKES[drawnDigit],
          candidateDigit,
        ),
        drawnDigit === candidateDigit,
        `${drawnDigit} is not mistaken for ${candidateDigit}`,
      );
    }
  }
});

test("forgiving thresholds still separate mildly imperfect wrong numerals", () => {
  for (const drawnDigit of DIGITS) {
    const drawn = DIGIT_REFERENCE_STROKES[drawnDigit].map((stroke) =>
      resamplePolyline(stroke, 29).map((point, index) => ({
          x:
            0.5 +
            (point.x - 0.5) * 0.94 +
            0.02 +
            Math.sin(index * 1.7 + drawnDigit) * 0.018,
          y:
            0.5 +
            (point.y - 0.5) * 0.96 -
            0.01 +
            Math.cos(index * 1.3 + drawnDigit) * 0.018,
        })),
    );
    for (const candidateDigit of DIGITS) {
      if (candidateDigit === drawnDigit) continue;
      assert.equal(
        isAcceptableDigitStrokes(drawn, candidateDigit),
        false,
        `${drawnDigit} is not mistaken for ${candidateDigit} after finger drift`,
      );
    }
  }
});

test("taps and tiny gestures are rejected before shape scoring", () => {
  for (const digit of DIGITS) {
    const tap = Array.from({ length: 8 }, (_, index) => ({
      x: 0.5 + index * 0.001,
      y: 0.5 + index * 0.001,
    }));
    const score = scoreDigitStrokes([tap], digit);
    assert.equal(score.accepted, false, `${digit}: tap rejected`);
    assert.ok(
      score.rejectionReason === "tap" || score.rejectionReason === "too_small",
      `${digit}: degenerate reason`,
    );
    assert.equal(
      isGoodFaithDigitTraceAttempt(score),
      false,
      `${digit}: a tap never earns retry grace`,
    );
  }
});

test("partial traces are rejected even when their visible segment is on-path", () => {
  for (const digit of DIGITS) {
    const partial = DIGIT_REFERENCE_STROKES[digit].map((stroke) =>
      resamplePolyline(stroke, 41).slice(0, 24),
    );
    const score = scoreDigitStrokes(partial, digit);
    assert.equal(score.accepted, false, `${digit}: partial trace rejected`);
    assert.ok(
      ["too_small", "incomplete", "off_path"].includes(score.rejectionReason),
      `${digit}: partial geometry reason`,
    );
  }
});

test("wild scribbles and repeated backtracking are rejected", () => {
  const scribble = Array.from({ length: 60 }, (_, index) => ({
    x: index % 2 === 0 ? 0.08 : 0.92,
    y: 0.08 + ((index * 7) % 17) / 20,
  }));
  for (const digit of DIGITS) {
    const score = scoreDigitStrokes([scribble], digit);
    assert.equal(score.accepted, false, `${digit}: wild scribble rejected`);
    assert.ok(
      score.rejectionReason === "too_long" ||
      score.rejectionReason === "off_path" ||
        score.rejectionReason === "incomplete",
      `${digit}: scribble geometry reason`,
    );
    assert.equal(
      isGoodFaithDigitTraceAttempt(score),
      false,
      `${digit}: scribble never earns retry grace`,
    );

    const backtracking = DIGIT_REFERENCE_STROKES[digit].map((reference) => [
      ...reference,
      ...[...reference].reverse(),
      ...reference,
    ]);
    assert.equal(
      isAcceptableDigitStrokes(backtracking, digit),
      false,
      `${digit}: repeated path is not a valid single trace`,
    );
  }
});

test("a substantial near miss can earn one answer-neutral retry grace", () => {
  const digit = 6;
  const partial = resamplePolyline(DIGIT_REFERENCE_STROKES[digit][0], 41).slice(
    0,
    32,
  );
  const score = scoreDigitTrace(partial, digit);
  assert.equal(score.accepted, false, "fixture is a near miss");
  assert.equal(isGoodFaithDigitTraceAttempt(score), true);
  assert.deepEqual(resolveDigitTraceAttempt(score, digit, null), {
    disposition: "retry",
    nextRetryDigit: digit,
  });
  assert.deepEqual(resolveDigitTraceAttempt(score, digit, digit), {
    disposition: "submit",
    nextRetryDigit: null,
  });
});

test("retry grace is tile-specific and never turns taps into answers", () => {
  const nearMiss = scoreDigitTrace(
    resamplePolyline(DIGIT_REFERENCE_STROKES[6][0], 41).slice(0, 32),
    6,
  );
  const tap = scoreDigitTrace(
    Array.from({ length: 8 }, (_, index) => ({
      x: 0.5 + index * 0.001,
      y: 0.5 + index * 0.001,
    })),
    6,
  );

  assert.deepEqual(resolveDigitTraceAttempt(nearMiss, 6, 5), {
    disposition: "retry",
    nextRetryDigit: 6,
  });
  assert.deepEqual(resolveDigitTraceAttempt(tap, 6, null), {
    disposition: "reject",
    nextRetryDigit: null,
  });
  assert.deepEqual(resolveDigitTraceAttempt(tap, 6, 6), {
    disposition: "reject",
    nextRetryDigit: 6,
  });
});

test("materially shifted and unrelated full-size paths are rejected", () => {
  const unrelated = [
    { x: 0.12, y: 0.1 },
    { x: 0.88, y: 0.1 },
    { x: 0.12, y: 0.3 },
    { x: 0.88, y: 0.5 },
    { x: 0.12, y: 0.7 },
    { x: 0.88, y: 0.9 },
  ];
  for (const digit of DIGITS) {
    const shifted = DIGIT_REFERENCE_STROKES[digit].map((stroke) =>
      stroke.map(({ x, y }) => ({ x: x + 0.22, y })),
    );
    assert.equal(
      isAcceptableDigitStrokes(shifted, digit),
      false,
      `${digit}: materially shifted path`,
    );
    assert.equal(
      isAcceptableDigitTrace(unrelated, digit),
      false,
      `${digit}: unrelated full-size path`,
    );
  }
});

test("invalid geometry is safely rejected and invalid configuration fails clearly", () => {
  const invalid = scoreDigitTrace(
    [
      { x: 0.2, y: 0.2 },
      { x: Number.NaN, y: 0.3 },
      { x: 0.8, y: 0.8 },
    ],
    2,
  );
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.rejectionReason, "invalid_points");
  assert.throws(() => resamplePolyline([{ x: 0, y: 0 }], 1), RangeError);
  assert.throws(
    () => scoreDigitTrace(DIGIT_REFERENCE_STROKES[2][0], 1),
    RangeError,
  );
});

test("open-top 4 and print 5 accept natural two-stroke handwriting", () => {
  const four = DIGIT_REFERENCE_STROKES[4];
  const five = DIGIT_REFERENCE_STROKES[5];
  assert.equal(four.length, 2, "4 shows a diagonal/crossbar plus downstroke");
  assert.equal(five.length, 2, "5 shows its body and separate top bar");
  assert.ok(
    Math.abs(four[0][0].x - four[1][0].x) > 0.03,
    "the 4 keeps its top visibly open like the supplied sample",
  );

  assert.equal(isAcceptableDigitStrokes(four, 4), true);
  assert.equal(isAcceptableDigitStrokes([...four].reverse(), 4), true);
  assert.equal(
    isAcceptableDigitStrokes(
      [...four].reverse().map((stroke) => [...stroke].reverse()),
      4,
    ),
    true,
    "4 accepts either stroke order and direction",
  );
  assert.equal(isAcceptableDigitStrokes(five, 5), true);

  const oneStrokeFive = [...five[1], ...five[0].slice(1)];
  assert.equal(
    isAcceptableDigitTrace(oneStrokeFive, 5),
    true,
    "a continuous print 5 remains valid",
  );
});

test("8 accepts an imperfect loop from any starting point", () => {
  const sampled = resamplePolyline(DIGIT_REFERENCE_STROKES[8][0], 65);
  const core = sampled.slice(0, -1);
  const rotated = [...core.slice(21), ...core.slice(0, 21)];
  const childlike = [...rotated, rotated[0]].map((point, index) => ({
    x: 0.5 + (point.x - 0.5) * 0.88 + Math.sin(index * 1.41) * 0.045,
    y: 0.5 + (point.y - 0.5) * 0.94 + Math.cos(index * 1.13) * 0.045,
  }));

  assert.equal(
    isAcceptableDigitTrace(childlike, 8),
    true,
    "8 tolerance is local, cyclic, and finger-friendly",
  );
});
