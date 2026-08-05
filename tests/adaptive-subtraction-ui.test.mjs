import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);
const curriculum = await readFile(
  new URL(
    "../app/lab/subtraction-flash/adaptive-curriculum.tsx",
    import.meta.url,
  ),
  "utf8",
);
const parentReport = await readFile(
  new URL(
    "../app/lab/subtraction-flash/adaptive-parent-report.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Borrow Flash keeps Cards and Listen while adding adaptive practice", () => {
  assert.match(route, /import \{ AdaptiveSubtractionCurriculum \}/);
  assert.match(route, />\s*Cards\s*</);
  assert.match(route, />\s*Listen\s*</);
  assert.match(route, /<strong>Adaptive practice<\/strong>/);
  assert.match(route, /onFeedback=\{playEarcon\}/);
  assert.match(route, /soundEnabled=\{soundEnabled\}/);
});

test("the adaptive UI persists and resumes both card and feedback boundaries", () => {
  assert.match(curriculum, /loadAdaptiveSubtractionProgressDiagnostic\(\)/);
  assert.match(curriculum, /writeAdaptiveSubtractionProgress\(next\)/);
  assert.match(curriculum, /setActiveAdaptiveSession/);
  assert.match(curriculum, /pendingFeedbackForSession/);
  assert.match(curriculum, /Continue this session/);
  assert.match(curriculum, /resumeStoredSession/);
  assert.match(curriculum, /visibilitychange/);
  assert.match(curriculum, /pagehide/);
});

test("normal adaptive practice is finite, pauseable, and has no running clock", () => {
  assert.match(curriculum, /Card \{Math\.min\(session\.currentCardIndex \+ 1/);
  assert.match(curriculum, /role="progressbar"/);
  assert.match(curriculum, /aria-valuemax=\{session\.targetCardCount\}/);
  assert.match(curriculum, />\s*Pause\s*</);
  assert.match(curriculum, />\s*End for now\s*</);
  assert.match(curriculum, /adaptiveSessionCompletedAsPlanned\(finished\)/);
  assert.doesNotMatch(curriculum, /formatCountdownTime|countdownMs|setInterval\(/);
});

test("numeric cards keep the answer-neutral Type and Draw switch visible in either mode", () => {
  const navStart = curriculum.indexOf(
    '<nav className={styles.answerModes} aria-label="Answer input">',
  );
  const navEnd = curriculum.indexOf("</nav>", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart);
  const answerModeBranch = curriculum.slice(
    Math.max(0, navStart - 120),
    navEnd + "</nav>".length,
  );
  assert.match(answerModeBranch, /\{drawAvailable \? \(/);
  assert.doesNotMatch(answerModeBranch, /inputMode === "type" \? \(/);
  assert.match(answerModeBranch, /aria-pressed=\{inputMode === "type"\}/);
  assert.match(answerModeBranch, /onClick=\{\(\) => setInputMode\("type"\)\}/);
  assert.match(answerModeBranch, /aria-pressed=\{inputMode === "draw"\}/);
  assert.match(answerModeBranch, /onClick=\{\(\) => setInputMode\("draw"\)\}/);
  assert.match(curriculum, /maxLength=\{3\}/);
  assert.match(curriculum, /\.slice\(0, 3\)/);
});

test("parent-only reporting keeps accuracy, timing, and benchmark data distinct", () => {
  assert.match(parentReport, /<details/);
  assert.match(parentReport, /<summary>Parent details<\/summary>/);
  assert.match(parentReport, /Accuracy and timing stay separate/);
  assert.match(parentReport, /First-attempt accuracy/);
  assert.match(parentReport, /Median response/);
  assert.match(parentReport, /Median time to first ink/);
  assert.match(parentReport, /Latest weekly check/);
  assert.match(parentReport, /External target comparison/);
  assert.match(parentReport, /never block new content or appear in the child session/);
});
