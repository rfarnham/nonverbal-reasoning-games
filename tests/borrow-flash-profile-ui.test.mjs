import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, stylesSource] = await Promise.all([
  readFile(
    new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/lab/subtraction-flash/subtraction-flash.module.css",
      import.meta.url,
    ),
    "utf8",
  ),
]);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("live play has distinct Home and Back controls and safely abandons the run", () => {
  const live = sourceSection(
    pageSource,
    "if (sessionPhase === \"playing\" || sessionPhase === \"settling\")",
    "return (\n    <div className={styles.page}>",
  );

  assert.match(live, /className=\{styles\.liveHome\}[\s\S]*href="\/"[\s\S]*<HomeIcon \/>/);
  assert.match(live, /className=\{styles\.liveBack\}[\s\S]*onClick=\{abandonSession\}[\s\S]*<ArrowLeftIcon \/>/);
  assert.match(live, /className=\{styles\.liveFinish\}/);
  assert.match(pageSource, /finishReason: "abandoned"/);
  assert.match(pageSource, /settleSessionForNavigation\(\);\s*returnToModeChoice\(\);/);
  assert.match(stylesSource, /\.liveHome,[\s\S]*\.liveBack,[\s\S]*min-height:\s*44px/);
});

test("the chooser exposes an accessible profile dialog with deliberate data clearing", () => {
  assert.match(pageSource, /aria-haspopup="dialog"/);
  assert.match(pageSource, /aria-labelledby="profile-dialog-heading"/);
  assert.match(pageSource, /role="radiogroup"/);
  assert.match(pageSource, /role="radio"/);
  assert.match(pageSource, /handleCreateProfile/);
  assert.match(pageSource, /handleRenameProfile/);
  assert.match(pageSource, /clearProfilePending \? \(/);
  assert.match(pageSource, /Clear data…/);
  assert.match(pageSource, /Yes, clear data/);
  assert.doesNotMatch(pageSource, /AdaptiveSubtractionCurriculum|Adaptive practice/);
});

test("every Flash performance write uses the run's profile-scoped storage", () => {
  assert.match(
    pageSource,
    /startPerformanceSession\([\s\S]*createBorrowFlashProfileStorage\(chosenProfileId\)/,
  );
  assert.match(
    pageSource,
    /appendPerformanceAttempt\([\s\S]*createBorrowFlashProfileStorage\(progress\.profileId\)/,
  );
  assert.ok(
    [...pageSource.matchAll(/finishPerformanceSession\(/g)].length >= 2,
    "normal finish and abandonment both settle the session",
  );
  assert.ok(
    [...pageSource.matchAll(/createBorrowFlashProfileStorage\(progress\.profileId\)/g)].length >= 3,
    "attempt, normal finish, and abandonment use the captured profile",
  );
});
