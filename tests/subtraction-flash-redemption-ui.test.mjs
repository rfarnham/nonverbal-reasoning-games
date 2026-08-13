import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);
const progressionPanelsSource = await readFile(
  new URL(
    "../components/progression/ProgressionSessionPanels.tsx",
    import.meta.url,
  ),
  "utf8",
);

function sourceSection(startMarker, endMarker) {
  const start = pageSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = pageSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return pageSource.slice(start, end);
}

const submitAnswer = sourceSection(
  "const submitAnswer = useCallback",
  "const primeMicrophonePermission",
);
const finishSession = sourceSection(
  "const finishSession = useCallback",
  "const startRedemption = useCallback",
);
const startRedemption = sourceSection(
  "const startRedemption = useCallback",
  "const submitAnswer = useCallback",
);
const advanceRound = sourceSection(
  "const advanceRound = useCallback",
  "const beginSession = useCallback",
);
const retryRound = sourceSection(
  "const retryRound = useCallback",
  "const beginSession = useCallback",
);
const liveBranch = sourceSection(
  'if (sessionPhase === "playing" || sessionPhase === "settling")',
  "\n  return (",
);

test("a miss clears the answer and retries the same card without advancing", () => {
  assert.match(
    retryRound,
    /const retry[^=]*=\s*\{[\s\S]*?\.\.\.current,[\s\S]*?selectedAnswer:\s*null,[\s\S]*?correct:\s*null,[\s\S]*?attemptOrdinal:\s*current\.attemptOrdinal\s*\+\s*1/,
    "a retry preserves the active card while clearing its answer state",
  );
  assert.match(
    retryRound,
    /answerLockRef\.current\s*=\s*null/,
    "the same card unlocks before the child tries again",
  );
  assert.match(
    pageSource,
    /if\s*\(currentRound\.correct\)\s*\{\s*advanceRound\(\);\s*\}\s*else\s*\{\s*retryRound\(\);/,
    "only a solved round advances; a miss routes back to the same round",
  );
  assert.match(
    pageSource,
    /<FlashHandwriting[\s\S]*?(?:key|roundId)=\{[^}]*?(?:attemptOrdinal|retryNonce|inputRevision)[^}]*\}/,
    "a same-card retry remounts or resets handwriting so its recognized readout clears",
  );
});

test("live feedback never exposes a miss marker or wrong counter", () => {
  assert.doesNotMatch(
    liveBranch,
    /styles\.liveWrong|wrongAnswers|\bIncorrect\b|data-state=[^\n]*incorrect|×/,
  );
  assert.match(liveBranch, /currentRound\?\.correct\s*===\s*true/);
});

test("score counters use only each practice card's first attempt", () => {
  assert.match(
    submitAnswer,
    /const scoredFirstAttempt\s*=\s*progress\.stage\s*===\s*["']main["']\s*&&\s*outcomeRecord\.firstAttempt/,
  );
  assert.match(
    submitAnswer,
    /answered:\s*progress\.answered\s*\+\s*\(scoredFirstAttempt\s*\?\s*1\s*:\s*0\s*\)/,
  );
  assert.match(
    submitAnswer,
    /correct:\s*progress\.correct\s*\+\s*\(scoredFirstAttempt\s*&&\s*correct\s*\?\s*1\s*:\s*0\s*\)/,
  );
  assert.match(
    submitAnswer,
    /slow:\s*progress\.slow\s*\+[\s\S]{0,40}\(scoredFirstAttempt\s*&&\s*answerWasSlow\s*\?\s*1\s*:\s*0\s*\)/,
  );
});

test("every raw answer records its ordinal, first-attempt flag, and lane", () => {
  const performanceAttempt = sourceSection(
    "const attempt = createPerformanceAttempt({",
    "});",
  );
  assert.match(performanceAttempt, /attemptOrdinal:\s*[^,]+,/);
  assert.match(performanceAttempt, /firstAttempt:\s*[^,]+,/);
  assert.match(performanceAttempt, /(?:sessionLane:\s*[^,]+|\bsessionLane\s*),/);
});

test("all normal finish paths pause at a redemption intro before results", () => {
  assert.match(finishSession, /\.beginRedemption\(\)/);
  assert.match(
    finishSession,
    /redemption\.phase\s*!==\s*["']redemption["'][\s\S]*?completeSession\([\s\S]*?return;/,
    "results are deferred when the deck has missed facts to redeem",
  );
  assert.match(
    finishSession,
    /stage:\s*["']redemption-intro["']/,
    "a nonempty missed-fact queue first switches to the explicit intro",
  );
  assert.match(finishSession, /const nextRounds[^=]*=\s*\{\s*visual:\s*null,\s*listen:\s*null\s*\}/);
  assert.match(
    startRedemption,
    /progress\.stage\s*!==\s*["']redemption-intro["']/,
    "the review cannot start from any other stage",
  );
  assert.match(startRedemption, /const round\s*=\s*newRound\(deck\.next\(\)/);
  assert.match(startRedemption, /stage:\s*["']redemption["']/);
  assert.match(
    liveBranch,
    /["']Untimed redemption["']/i,
    "the live HUD explicitly labels redemption as untimed",
  );
  assert.match(
    liveBranch,
    /`Question \$\{redemptionQuestion\} of \$\{sessionProgress\.redemptionTotal\}`/,
    "active redemption uses the suite's question-of-total progress language",
  );
  assert.match(liveBranch, /aria-label="Redemption progress"/);
  assert.match(pageSource, /finishSession\(["']manual["']\)/);
  assert.match(pageSource, /finishSession\(["']time["']/);
  assert.match(pageSource, /finishSession\(["']deck["']/);
});

test("Borrow Flash reuses the suite redemption intro without changing Journey defaults", () => {
  assert.match(
    pageSource,
    /import\s*\{\s*RedemptionIntroPanel\s*\}\s*from\s*["']@\/components\/progression\/ProgressionSessionPanels["']/,
  );
  assert.match(
    liveBranch,
    /sessionProgress\.stage\s*===\s*["']redemption-intro["'][\s\S]*?<RedemptionIntroPanel[\s\S]*?missedCount=\{sessionProgress\.redemptionTotal\}[\s\S]*?focusKey=\{sessionProgress\.id\}[\s\S]*?complete=\{sessionProgress\.pendingFinishReason\s*===\s*["']deck["']\}[\s\S]*?onBegin=\{startRedemption\}/,
    "the shared intro receives count, focus, completion context, and explicit start action",
  );
  assert.match(
    progressionPanelsSource,
    /export function RedemptionIntroPanel/,
  );
  assert.match(
    progressionPanelsSource,
    /<ProgressionRedemptionIntro[\s\S]*?<RedemptionIntroPanel|export function ProgressionRedemptionIntro[\s\S]*?<RedemptionIntroPanel/,
    "Journey and Borrow Flash both render the same generic panel",
  );
  assert.match(
    progressionPanelsSource,
    /complete\s*=\s*true/,
    "omitting the optional context preserves the canonical completed-stop treatment",
  );
  const progressionWrapper = progressionPanelsSource.slice(
    progressionPanelsSource.indexOf("export function ProgressionRedemptionIntro"),
    progressionPanelsSource.indexOf("export function RedemptionIntroPanel"),
  );
  assert.doesNotMatch(
    progressionWrapper,
    /\bcomplete=/,
    "Journey continues to use the canonical completed-stop default",
  );
  assert.match(progressionPanelsSource, /Full stop complete/);
  assert.match(progressionPanelsSource, /Practice paused/);
  assert.match(
    progressionPanelsSource,
    /You made it through every question\. Revisit/,
  );
  assert.match(progressionPanelsSource, /Before you finish, revisit/);
  assert.match(
    progressionPanelsSource,
    /Here’s your chance at redemption\./,
  );
  assert.match(progressionPanelsSource, /Review Mistakes/);
  assert.doesNotMatch(
    pageSource,
    /Here’s your chance at redemption\.|Review Mistakes/,
    "Borrow Flash does not fork or duplicate the suite redemption copy",
  );
});

test("the two-minute deadline never interrupts redemption", () => {
  assert.match(
    submitAnswer,
    /progress\.stage\s*===\s*["']main["'][\s\S]{0,160}!isTimedAnswerAllowed\(activeElapsedMs\)/,
    "the submit-time deadline is gated to the main practice lane",
  );
  assert.match(
    advanceRound,
    /progress\.stage\s*===\s*["']main["'][\s\S]{0,160}activeElapsedMs\s*>=\s*TWO_MINUTE_SESSION_MS/,
    "round advancement only applies the deadline during main practice",
  );
  assert.match(
    pageSource,
    /progress\.stage\s*===\s*["']main["'][\s\S]{0,180}readSessionElapsed\(progress\.clock, now\)\s*>=\s*TWO_MINUTE_SESSION_MS/,
    "the interval deadline is gated to the main practice lane",
  );
});
