import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRACE_QUALITY_OPTIONS,
  DIGIT_REFERENCE_PATHS,
  isGoodFaithDigitTraceAttempt,
  isAcceptableDigitTrace,
  resamplePolyline,
  resolveDigitTraceAttempt,
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

test("digits 2 through 9 expose bounded, recognizable one-stroke paths", () => {
  assert.deepEqual(Object.keys(DIGIT_REFERENCE_PATHS), DIGITS.map(String));
  for (const digit of DIGITS) {
    const path = DIGIT_REFERENCE_PATHS[digit];
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
    assert.ok(tracePathLength(path) >= 1.2, `${digit}: is more than a tap or line`);
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
    const sparse = resamplePolyline(DIGIT_REFERENCE_PATHS[digit], 15);
    const forward = modestlyNoisy(sparse, digit);
    const reverse = modestlyNoisy([...sparse].reverse(), digit + 0.5);
    const forwardScore = scoreDigitTrace(forward, digit);
    const reverseScore = scoreDigitTrace(reverse, digit);
    assert.equal(forwardScore.accepted, true, `${digit}: close forward trace`);
    assert.equal(forwardScore.direction, "forward", `${digit}: forward direction`);
    assert.equal(reverseScore.accepted, true, `${digit}: close reverse trace`);
    assert.equal(reverseScore.direction, "reverse", `${digit}: reverse direction`);
    assert.equal(isAcceptableDigitTrace(forward, digit), true);
  }
});

test("finger-sized drift, rotation, and short endpoints remain acceptable", () => {
  for (const digit of DIGITS) {
    const source = resamplePolyline(DIGIT_REFERENCE_PATHS[digit], 35);
    const angle = (3 * Math.PI) / 180;
    const transformed = source.slice(2, -2).map((point, index) => {
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
    });
    assert.equal(
      isAcceptableDigitTrace(transformed, digit),
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
        isAcceptableDigitTrace(
          DIGIT_REFERENCE_PATHS[drawnDigit],
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
    const drawn = resamplePolyline(DIGIT_REFERENCE_PATHS[drawnDigit], 29).map(
      (point, index) => ({
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
      }),
    );
    for (const candidateDigit of DIGITS) {
      if (candidateDigit === drawnDigit) continue;
      assert.equal(
        isAcceptableDigitTrace(drawn, candidateDigit),
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
    const score = scoreDigitTrace(tap, digit);
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
    const complete = resamplePolyline(DIGIT_REFERENCE_PATHS[digit], 41);
    const partial = complete.slice(0, 24);
    const score = scoreDigitTrace(partial, digit);
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
    const score = scoreDigitTrace(scribble, digit);
    assert.equal(score.accepted, false, `${digit}: wild scribble rejected`);
    assert.ok(
      score.rejectionReason === "too_long" ||
        score.rejectionReason === "off_path",
      `${digit}: scribble geometry reason`,
    );
    assert.equal(
      isGoodFaithDigitTraceAttempt(score),
      false,
      `${digit}: scribble never earns retry grace`,
    );

    const reference = DIGIT_REFERENCE_PATHS[digit];
    const backtracking = [
      ...reference,
      ...[...reference].reverse(),
      ...reference,
    ];
    assert.equal(
      isAcceptableDigitTrace(backtracking, digit),
      false,
      `${digit}: repeated path is not a valid single trace`,
    );
  }
});

test("a substantial near miss can earn one answer-neutral retry grace", () => {
  for (const digit of DIGITS) {
    const partial = resamplePolyline(DIGIT_REFERENCE_PATHS[digit], 41).slice(
      0,
      32,
    );
    const score = scoreDigitTrace(partial, digit);
    assert.equal(score.accepted, false, `${digit}: fixture is a near miss`);
    assert.equal(
      isGoodFaithDigitTraceAttempt(score),
      true,
      `${digit}: substantial near miss can express a deliberate choice`,
    );
    assert.deepEqual(
      resolveDigitTraceAttempt(score, digit, null),
      { disposition: "retry", nextRetryDigit: digit },
      `${digit}: first near miss asks only once`,
    );
    assert.deepEqual(
      resolveDigitTraceAttempt(score, digit, digit),
      { disposition: "submit", nextRetryDigit: null },
      `${digit}: second near miss submits the expressed choice`,
    );
  }
});

test("retry grace is tile-specific and never turns taps into answers", () => {
  const nearMiss = scoreDigitTrace(
    resamplePolyline(DIGIT_REFERENCE_PATHS[6], 41).slice(0, 32),
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
    const shifted = DIGIT_REFERENCE_PATHS[digit].map(({ x, y }) => ({
      x: x + 0.22,
      y,
    }));
    assert.equal(
      isAcceptableDigitTrace(shifted, digit),
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
  assert.throws(() => scoreDigitTrace(DIGIT_REFERENCE_PATHS[2], 1), RangeError);
});
