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

test("live rounds retain distinct Home and Back navigation in the compact HUD", () => {
  const liveBranchStart = pageSource.indexOf(
    'if (sessionPhase === "playing" || sessionPhase === "settling")',
  );
  const liveBranchEnd = pageSource.indexOf("\n  return (", liveBranchStart + 10);
  assert.ok(liveBranchStart >= 0, "missing dedicated live-round render branch");
  assert.ok(liveBranchEnd > liveBranchStart, "missing chooser render after live branch");

  const liveBranch = pageSource.slice(liveBranchStart, liveBranchEnd);
  assert.match(liveBranch, /className=\{styles\.liveHud\}/);
  assert.match(liveBranch, /aria-label="Home — all games"/);
  assert.match(liveBranch, /<HomeIcon\s*\/>/);
  assert.match(liveBranch, /aria-label="Back to Borrow Flash setup"/);
  assert.match(liveBranch, /onClick=\{abandonSession\}/);
  assert.match(liveBranch, /<ArrowLeftIcon\s*\/>/);
  assert.match(
    liveBranch,
    /role=\{sessionProgress\.stage === "main" \? "timer" : undefined\}/,
    "only the timed/main clock has timer semantics",
  );
  assert.match(liveBranch, /Time remaining/);
  assert.match(liveBranch, /Time elapsed/);
  assert.match(liveBranch, /styles\.liveCorrect/);
  assert.doesNotMatch(
    liveBranch,
    /styles\.liveWrong|wrongAnswers|\bIncorrect\b|×/,
    "the live round never displays a wrong counter, Incorrect label, or cross",
  );
  assert.match(liveBranch, /sessionProgress\.mode === "infinite"[\s\S]*Finish/);

  assert.match(stylesSource, /\.liveHud\s*\{[\s\S]*position:\s*absolute;/);
  assert.match(stylesSource, /\.liveHud\s*\{[\s\S]*min-height:\s*52px;/);
  assert.match(stylesSource, /\.liveHome,[\s\S]*\.liveBack,[\s\S]*min-width:\s*44px;/);
});
