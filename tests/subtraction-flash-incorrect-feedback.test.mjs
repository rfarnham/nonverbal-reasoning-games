import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/subtraction-flash.module.css",
    import.meta.url,
  ),
  "utf8",
);
const handwritingStylesSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/flash-handwriting.module.css",
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

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

const liveAnswer = sourceSection(
  "const liveAnswer = currentRound ? (",
  'if (sessionPhase === "playing" || sessionPhase === "settling")',
);
const retryRound = sourceSection(
  "const retryRound = useCallback",
  "const beginSession = useCallback",
);

test("an incorrect submission shows visible red Try again feedback at the answer", () => {
  assert.match(
    liveAnswer,
    /data-state=\{[\s\S]*?currentRound\.correct\s*===\s*false[\s\S]*?["']incorrect["'][\s\S]*?["']idle["'][\s\S]*?\}/,
    "the answer area must enter an explicit incorrect visual state",
  );
  assert.match(
    liveAnswer,
    /currentRound\.correct\s*===\s*false[\s\S]*?className=\{styles\.liveRetryFeedback\}[\s\S]*?>\s*Try again\s*</,
    "Try again must be visible inside the answer slot, not only in a screen-reader-only region",
  );
  assert.doesNotMatch(
    liveAnswer,
    /(?:className=\{styles\.liveRetryFeedback\}[\s\S]{0,160}>\s*)[×✕✖✗]/,
    "retry feedback is calm text, not a wrong/cross mark",
  );

  const answerIncorrectRule = cssRule(
    stylesSource,
    '.liveAnswerSlot[data-state="incorrect"]',
  );
  assert.match(
    answerIncorrectRule,
    /color:\s*var\(--incorrect\)/,
    "the attempted answer area must visibly use the suite red",
  );

  const feedbackRule = cssRule(stylesSource, ".liveRetryFeedback");
  assert.match(feedbackRule, /font-(?:size|weight):/);
  assert.match(
    feedbackRule,
    /(?:color:\s*var\(--incorrect\)|background(?:-color)?:\s*var\(--incorrect\)|color:\s*inherit)/,
    "Try again must inherit or directly use the red incorrect treatment",
  );
});

test("Try again is brief and the child retries the same question", () => {
  const incorrectDuration = pageSource.match(
    /const INCORRECT_RETRY_FLASH_MS\s*=\s*(\d+)/,
  );
  assert.ok(incorrectDuration, "missing a dedicated incorrect-feedback linger");
  assert.ok(
    Number(incorrectDuration[1]) >= 900 && Number(incorrectDuration[1]) <= 1100,
    "Try again should remain readable for about one second without slowing Flash down",
  );
  assert.match(
    pageSource,
    /window\.setTimeout\([\s\S]*?currentRound\.correct[\s\S]*?retryRound\(\)[\s\S]*?resultFlashDuration\(currentRound\.answeredWith,\s*currentRound\.correct\)/,
    "the visible result state must be cleared on the established brief feedback timer",
  );
  assert.match(
    retryRound,
    /const retry[^=]*=\s*\{[\s\S]*?\.\.\.current,[\s\S]*?selectedAnswer:\s*null,[\s\S]*?correct:\s*null/,
    "retry must preserve the active card while clearing only its answer state",
  );
  assert.doesNotMatch(
    liveAnswer,
    /wrongAnswers|styles\.liveWrong|>\s*Incorrect\s*<|[×✕✖✗]/,
    "the focused live round must not add a wrong counter or cross",
  );
});

test("retry feedback has its own legible line below handwriting status", () => {
  const feedbackRule = cssRule(stylesSource, ".liveRetryFeedback");
  const positionedAbsolutely = /position:\s*absolute/.test(feedbackRule);
  const anchoredAfterAnswer =
    /top:\s*(?:100%|calc\(\s*100%\s*\+)/.test(feedbackRule) ||
    /inset-block-start:\s*(?:100%|calc\(\s*100%\s*\+)/.test(feedbackRule);

  assert.ok(
    !positionedAbsolutely || anchoredAfterAnswer,
    "absolute feedback must be anchored after the complete answer widget, not over its handwriting status",
  );
  assert.match(
    feedbackRule,
    /(?:line-height|white-space|min-height|margin-(?:block-)?start|margin-top):/,
    "the feedback line needs explicit legibility or spacing rather than inheriting equation typography",
  );

  const handwritingRootRule = cssRule(handwritingStylesSource, ".root");
  assert.match(
    handwritingRootRule,
    /font-size:\s*1rem/,
    "handwriting UI must stop inheriting the equation's giant font size",
  );
  assert.match(handwritingRootRule, /letter-spacing:\s*(?:normal|0)/);
  assert.match(handwritingRootRule, /line-height:\s*(?:normal|1(?:\.\d+)?)/);

  const handwritingStatusRule = cssRule(handwritingStylesSource, ".status");
  assert.match(
    handwritingStatusRule,
    /line-height:\s*(?:normal|1(?:\.\d+)?)/,
    "handwriting status must override the equation's compressed line height",
  );
  assert.match(
    handwritingStatusRule,
    /letter-spacing:\s*(?:normal|0)/,
    "handwriting status must override the equation's tight tracking",
  );
});
