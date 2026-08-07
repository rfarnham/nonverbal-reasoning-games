import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);
const traceSource = await readFile(
  new URL("../app/lab/subtraction-flash/trace-answer.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/subtraction-flash.module.css",
    import.meta.url,
  ),
  "utf8",
);
const analysisSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/analysis/performance-analysis-client.tsx",
    import.meta.url,
  ),
  "utf8",
);
const storageSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/performance-storage.ts",
    import.meta.url,
  ),
  "utf8",
);
const engineSource = await readFile(
  new URL("../app/lab/subtraction-flash/game-engine.ts", import.meta.url),
  "utf8",
);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function cssRule(selectorPattern) {
  const match = stylesSource.match(
    new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, "i"),
  );
  assert.ok(match, `missing CSS rule: ${selectorPattern}`);
  return match[1];
}

test("Trace is a fourth regular answer mode wired to trace performance evidence", () => {
  assert.match(pageSource, /type AnswerMode\s*=\s*[^;]*["']trace["'][^;]*;/s);
  assert.match(
    pageSource,
    /type AnswerInputSource\s*=\s*[^;]*["']trace["'][^;]*;/s,
  );
  assert.match(pageSource, /from ["']\.\/trace-answer["']/);
  assert.match(pageSource, /aria-pressed=\{answerMode === ["']trace["']\}/);
  assert.match(pageSource, /handleAnswerModeChange\(["']trace["']\)/);
  assert.match(pageSource, /answerMode === ["']trace["'][\s\S]*<TraceAnswerGrid/);

  const traceGridUse = sourceSection(pageSource, "<TraceAnswerGrid", "/>");
  assert.match(traceGridUse, /submitAnswer\(/);
  assert.ok(
    /inputSource:\s*source/.test(traceGridUse) ||
      (/inputSource:\s*["']trace["']/.test(traceGridUse) &&
        /inputSource:\s*["']keyboard["']/.test(traceGridUse)),
    "Trace forwards both pointer and keyboard input sources into evidence",
  );
  assert.match(
    traceSource,
    /type TraceAnswerSource\s*=\s*["']trace["']\s*\|\s*["']keyboard["']/,
  );
  assert.match(
    pageSource,
    /const timingEligible\s*=\s*evidence\.inputSource\s*!==\s*["']trace["']/,
    "motor-tracing time does not create a slow-fact review",
  );

  const modeSwitch = sourceSection(
    pageSource,
    "className={styles.answerModeSwitch}",
    "</nav>",
  );
  assert.equal(
    [...modeSwitch.matchAll(/className=\{styles\.answerModeButton\}/g)].length,
    4,
    "answer method switch exposes Tap, Draw, Trace, and Speak",
  );

  assert.match(storageSource, /PerformanceInputSource[\s\S]*["']trace["']/);
  assert.match(storageSource, /INPUT_SOURCES[\s\S]*["']trace["']/);
  assert.match(
    analysisSource,
    /<option\s+value=["']trace["']>Trace(?:\s*\/\s*tracing)?<\/option>/i,
  );
});

test("pointer traces require quality while keyboard activation remains available", () => {
  assert.match(traceSource, /answers\.map\(/);
  assert.match(traceSource, /<button/);
  assert.match(traceSource, /onPointerDown=/);
  assert.match(traceSource, /onPointerMove=/);
  assert.match(traceSource, /onPointerUp=/);
  assert.match(traceSource, /onPointerCancel=/);
  assert.match(traceSource, /onLostPointerCapture=/);
  assert.match(traceSource, /setPointerCapture\(/);
  assert.match(traceSource, /!event\.isPrimary/);
  assert.match(traceSource, /event\.button\s*!==\s*0/);
  assert.match(traceSource, /scoreDigitTrace\(/);
  assert.ok(
    /isAcceptableDigitTrace\(/.test(traceSource) ||
      /\bresult\.accepted\b/.test(traceSource),
    "trace score gates acceptance",
  );

  const finishTrace = sourceSection(
    traceSource,
    "const finishTrace",
    "const cancelTrace",
  );
  const qualityGate = Math.max(
    finishTrace.indexOf("isAcceptableDigitTrace"),
    finishTrace.indexOf("result.accepted"),
  );
  const acceptedSubmission = finishTrace.indexOf("onAnswer(", qualityGate);
  const rejectedFeedback = finishTrace.indexOf("setFeedback(", acceptedSubmission);
  assert.ok(qualityGate >= 0, "finished gestures pass through the quality gate");
  assert.ok(
    acceptedSubmission > qualityGate,
    "only a quality-accepted trace reaches answer submission",
  );
  assert.ok(
    rejectedFeedback > acceptedSubmission,
    "the rejected path gives input feedback after the accepted path returns",
  );
  assert.match(
    finishTrace.slice(acceptedSubmission, rejectedFeedback),
    /return;/,
    "accepted submission exits before retry feedback",
  );
  assert.equal(
    finishTrace.indexOf("onAnswer(", acceptedSubmission + 1),
    -1,
    "a rejected trace never becomes a math attempt",
  );

  assert.match(
    traceSource,
    /onClick=\{\(event\) => \{\s*if \(event\.detail !== 0\) \{\s*event\.preventDefault\(\);\s*return;\s*\}\s*onAnswer\([^;]*["']keyboard["']\);\s*\}\}/s,
    "pointer-generated clicks are ignored while native keyboard clicks submit",
  );
  assert.match(
    traceSource,
    /onKeyDown=\{\(event\) => \{[\s\S]*event\.key !== ["']Enter["'][\s\S]*event\.key !== ["'] ["'][\s\S]*onAnswer\([^;]*["']keyboard["']\);/s,
    "Enter and Space provide an explicit non-motor activation path",
  );
  assert.match(traceSource, /aria-keyshortcuts=\{String\(answer\)\}/);
});

test("rejected traces use one answer-neutral amber retry state", () => {
  const finishTrace = sourceSection(
    traceSource,
    "const finishTrace",
    "const cancelTrace",
  );
  assert.match(finishTrace, /state:\s*["']almost["']/);
  assert.doesNotMatch(
    traceSource,
    /correctAnswer|correctChoice/,
    "low-quality gestures cannot probe which candidate is mathematically correct",
  );
  assert.match(finishTrace, /Stay on the full line/i);

  const almostRule = cssRule(
    String.raw`\.traceButton\[data-state=["']almost["']\]`,
  );
  assert.match(almostRule, /background(?:-color)?\s*:/i);
  assert.match(almostRule, /border-color\s*:/i);
  assert.doesNotMatch(
    almostRule,
    /#bf493e|var\(\s*--(?:color-)?incorrect\s*\)/i,
    "trace-quality feedback must not reuse the jarring wrong-answer red",
  );

  const visibleFeedbackRule = cssRule(
    String.raw`\.traceFeedback\[data-visible=["']true["']\]`,
  );
  assert.match(visibleFeedbackRule, /background(?:-color)?\s*:/i);
  assert.doesNotMatch(visibleFeedbackRule, /#bf493e/i);
  assert.match(traceSource, /role=["']status["']/);
  assert.match(traceSource, /aria-live=["']polite["']/);
});

test("the trace answers form a large compact 3-by-3 grid with one empty cell", () => {
  assert.match(
    engineSource,
    /ANSWER_VALUES\s*=\s*\[\s*2\s*,\s*3\s*,\s*4\s*,\s*5\s*,\s*6\s*,\s*7\s*,\s*8\s*,\s*9\s*\]/,
    "the grid has eight unique answer tiles, leaving its ninth slot empty",
  );
  assert.match(traceSource, /\{answers\.map\(/);

  const gridRule = cssRule(String.raw`\.traceGrid`);
  assert.match(gridRule, /grid-template-columns\s*:\s*repeat\(3\s*,/i);

  const buttonRule = cssRule(String.raw`\.traceButton`);
  const height = buttonRule.match(/min-height\s*:\s*(\d+(?:\.\d+)?)px/i);
  assert.ok(height, "trace buttons define a concrete large minimum height");
  assert.ok(Number(height[1]) >= 90, "trace buttons have a large touch surface");
  assert.match(buttonRule, /touch-action\s*:\s*none/i);

  const phoneBreakpoint = stylesSource.match(
    /@media\s*\([^)]*max-width\s*:\s*(?:620|600|540|480|420|390)px[^)]*\)\s*\{[\s\S]*?\.traceGrid\s*\{[^}]*grid-template-columns\s*:\s*repeat\(3\s*,/i,
  );
  assert.ok(phoneBreakpoint, "phone trace grid stays three columns");

  assert.match(
    pageSource,
    /data-session-active=\{\s*!adaptiveOpen\s*&&\s*sessionPhase\s*!==\s*["']choosing["']\s*\}/s,
    "the compact landscape board is enabled only during a game session",
  );
  assert.match(
    stylesSource,
    /\.board\[data-answer-mode=["']trace["']\]\[data-session-active=["']true["']\]/,
    "the side-by-side landscape layout cannot trap the run chooser in one column",
  );
});
