import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function source(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

async function discoveredGameSlugs() {
  const gameRoot = path.join(projectRoot, "app", "games");
  const entries = await readdir(gameRoot, { withFileTypes: true });
  const slugs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = new Set(await readdir(path.join(gameRoot, entry.name)));
    if (files.has("page.tsx") && files.has("catalog.tsx")) {
      slugs.push(entry.name);
    }
  }
  return slugs.sort();
}

test("homepage Journey CTA is prominent while the standalone shelf remains", async () => {
  const home = await source("app/page.tsx");
  const cta = await source("components/progression/JourneyHomeCta.tsx");
  assert.match(home, /<JourneyHomeCta\s*\/>/);
  assert.match(cta, /button button-primary journey-home-cta/);
  assert.match(cta, /href="\/journey\/"/);
  assert.match(home, /games\.map/);
  assert.match(home, /href=\{game\.href\}/);
});

test("every released game uses the same controlled progression hook", async () => {
  const slugs = await discoveredGameSlugs();
  assert.equal(slugs.length, 9);
  for (const slug of slugs) {
    const entry =
      slug === "domino-twist"
        ? "app/games/domino-twist/DominoTwistGame.tsx"
        : `app/games/${slug}/page.tsx`;
    const gameSource = await source(entry);
    assert.match(
      gameSource,
      /useProgressionGameSession\(progressionAdapter\)/,
      `${slug} must use the shared controlled-session hook`,
    );
    assert.match(gameSource, /<ProgressionGameHud/);
    assert.match(
      gameSource,
      /paused=\{(?:controlledSession|progression)\.turboClockPaused\}/,
      `${slug} must show the shared Turbo clock state`,
    );
    assert.match(
      gameSource,
      /setTurboClockPaused\(/,
      `${slug} must explicitly release or pause the Turbo clock`,
    );
    assert.match(
      gameSource,
      /redemption=\{(?:controlledSession|progression)\.isRedemption\}/,
      `${slug} must show question progress during Turbo redemption`,
    );
    assert.match(gameSource, /<ProgressionRedemptionIntro/);
    assert.match(
      gameSource,
      /<ProgressionCulminationSectionIntro/,
      `${slug} must show the shared culmination section intro`,
    );
    assert.match(
      gameSource,
      /section=\{(?:controlledSession|progression)\.sectionIntro\}/,
      `${slug} must describe the persisted pending section`,
    );
    assert.match(
      gameSource,
      /onBegin=\{(?:controlledSession|progression)\.beginSection\}/,
      `${slug} must require the explicit shared begin action`,
    );
    assert.match(gameSource, /<ProgressionRecoveryPanel/);
    assert.ok(
      (gameSource.match(/disabled=\{progression\.mode === "booting"\}/g) ?? [])
        .length >= 2,
      `${slug} must keep standalone mode actions inert while Journey hydrates`,
    );
    assert.match(
      gameSource,
      /progression\.mode === "redirect" \? null/,
      `${slug} must not flash recovery UI during a valid redirect`,
    );
    assert.doesNotMatch(
      gameSource,
      /progression\.mode === "recovery" \|\|[\s\S]{0,80}progression\.mode === "redirect"/,
      `${slug} must reserve recovery UI for stale or invalid sessions`,
    );
  }
});

test("Turbo timing is independent from input locks and pauses for real explanations", async () => {
  const hook = await source(
    "components/progression/useProgressionGameSession.ts",
  );
  assert.match(hook, /shouldCountTurboTime/);
  assert.match(hook, /setTurboClockPaused/);
  assert.doesNotMatch(hook, /interactionState === "answering"/);
  assert.doesNotMatch(hook, /activeRoundPhase\(session\) === "answering"/);

  const rotation = await source("app/games/rotation-match/page.tsx");
  const patternMatrix = await source("app/games/pattern-matrix/page.tsx");
  const libra = await source("app/games/libra/page.tsx");
  assert.match(
    rotation,
    /setTurboClockPaused\([\s\S]{0,100}tutorialTransform !== null/,
  );
  assert.match(
    patternMatrix,
    /hasBlockingRuleLesson[\s\S]{0,180}setTurboClockPaused\(true\)/,
  );
  assert.match(
    libra,
    /activeLessonStrategyId !== null[\s\S]{0,180}setTurboClockPaused\(true\)/,
  );
});

test("controlled games restore persisted answer and feedback UI before retrying", async () => {
  const slugs = await discoveredGameSlugs();
  for (const slug of slugs) {
    const entry =
      slug === "domino-twist"
        ? "app/games/domino-twist/DominoTwistGame.tsx"
        : `app/games/${slug}/page.tsx`;
    const gameSource = await source(entry);
    assert.match(
      gameSource,
      /progressionOptionIndexFromAnswerToken/,
      `${slug} must decode saved answer tokens`,
    );
    assert.match(
      gameSource,
      /lastAnswerToken/,
      `${slug} must read the active saved answer`,
    );
    assert.match(
      gameSource,
      /roundPhase === "feedback"/,
      `${slug} must restore persisted feedback`,
    );
    assert.match(
      gameSource,
      /setPhase\("wrong-review"\)/,
      `${slug} must show the inspectable wrong-answer state`,
    );
    assert.match(
      gameSource,
      /currentAttemptCount/,
      `${slug} must preserve retry-ready state`,
    );
    assert.match(
      gameSource,
      /attemptId/,
      `${slug} must scope hydration to the active attempt`,
    );
  }
});

test("controlled game progress and redemption focus use truthful semantics", async () => {
  const hud = await source(
    "components/progression/ProgressionGameHud.tsx",
  );
  const panels = await source(
    "components/progression/ProgressionSessionPanels.tsx",
  );
  assert.match(hud, /aria-label="Current question"/);
  assert.match(hud, /Question \{progressValue\}/);
  assert.match(hud, /` of \$\{total\}`/);
  assert.match(hud, /mode === "turbo" && !redemption/);
  assert.match(hud, /Turbo Time · Redemption/);
  assert.doesNotMatch(hud, /Questions solved/);
  assert.match(
    panels,
    /primaryButtonRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/,
    "the section action receives focus without scrolling the solved example away",
  );
  assert.match(panels, /ref=\{primaryButtonRef\}/);
});

test("culmination section intros persist context and wait for an explicit begin action", async () => {
  const hook = await source(
    "components/progression/useProgressionGameSession.ts",
  );
  const panels = await source(
    "components/progression/ProgressionSessionPanels.tsx",
  );
  assert.match(hook, /sectionIntro:/);
  assert.match(hook, /current: [\s\S]{0,120}total: [\s\S]{0,120}questionCount:/);
  assert.match(hook, /beginSection/);
  assert.match(hook, /beginProgressionBrowserSection/);
  assert.match(
    hook,
    /session\.attempt\.pendingSectionIndex === null/,
    "reading a culmination example must not count as active practice",
  );

  assert.match(
    panels,
    /export function ProgressionCulminationSectionIntro/,
  );
  assert.match(panels, /section\.current/);
  assert.match(panels, /section\.total/);
  assert.match(panels, /section\.questionCount/);
  assert.match(panels, /onClick=\{onBegin\}/);
  assert.match(panels, /primaryButtonRef\.current\?\.focus\(\)/);
  assert.match(panels, /ref=\{primaryButtonRef\}/);
  assert.doesNotMatch(panels, /setTimeout|setInterval/);
});

test("controlled solved resumes preserve post-solve teaching moments", async () => {
  const libra = await source("app/games/libra/page.tsx");
  const patternMatrix = await source(
    "app/games/pattern-matrix/page.tsx",
  );
  assert.match(
    libra,
    /roundPhase === "solved"[\s\S]*orderedStrategyIdsForRound\(currentRound\)/,
  );
  assert.match(
    patternMatrix,
    /roundPhase === "solved"[\s\S]*moment: "discovery"/,
  );
});

test("controlled redemption checkpoints never fall back to shelf rounds", async () => {
  for (const slug of [
    "bracelet-search",
    "braids",
    "rotation-match",
    "whose-left",
  ]) {
    const gameSource = await source(`app/games/${slug}/page.tsx`);
    assert.match(
      gameSource,
      /const activeSessionRound = progressionControlled\s*\?\s*progressionRound/,
      `${slug} must keep a null controlled round at redemption-ready`,
    );
    assert.doesNotMatch(
      gameSource,
      /const activeSessionRound = progressionRound \?\?/,
      `${slug} must not expose a standalone fallback round`,
    );
  }
});

test("shared progression code contains no current game-slug branches", async () => {
  const slugs = await discoveredGameSlugs();
  const sharedSources = (
    await Promise.all([
      source("lib/progression/browser-session.ts"),
      source("lib/progression/game-adapter.ts"),
      source("lib/progression/journey.ts"),
      source("lib/progression/session-builders.ts"),
      source("components/progression/useProgressionGameSession.ts"),
      source("components/progression/JourneyClient.tsx"),
    ])
  ).join("\n");
  for (const slug of slugs) {
    assert.doesNotMatch(
      sharedSources,
      new RegExp(`["']${slug}["']`),
      `shared progression must not special-case ${slug}`,
    );
  }
});

test("avatar collection is local, bounded, licensed, and includes hedgehog", async () => {
  const avatarDirectory = path.join(projectRoot, "public", "avatars");
  const files = await readdir(avatarDirectory);
  const svgs = files.filter((file) => file.endsWith(".svg")).sort();
  assert.equal(svgs.length, 12);
  assert.ok(svgs.length <= 16);
  assert.ok(svgs.includes("hedgehog.svg"));
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("LICENSE-MIT.txt"));

  for (const svg of svgs) {
    const contents = await readFile(path.join(avatarDirectory, svg), "utf8");
    assert.doesNotMatch(contents, /<(?:image|use)[^>]+https?:/i);
  }
});

test("Journey summary rebases writes, restores focus, and rejects mid-stop previews", async () => {
  const summary = await source(
    "components/progression/JourneySummaryClient.tsx",
  );
  const launch = await source(
    "components/progression/journey-launch.ts",
  );
  assert.match(summary, /function readLatestSummary/);
  assert.match(summary, /window\.addEventListener\("storage", syncStorage\)/);
  assert.match(summary, /function isSummaryAttempt/);
  assert.match(summary, /attempt\.phase === "summary-ready"/);
  assert.doesNotMatch(summary, /attempt\.phase === "playing"/);
  assert.match(summary, /ref=\{summaryTitleRef\} tabIndex=\{-1\}/);
  assert.match(
    summary,
    /result\.settlement\.passed[\s\S]{0,300}closeAttemptSummary\(result\.profile, result\.attempt\.id\)/,
  );
  assert.match(
    summary,
    /if \(result\.settlement\.passed\)[\s\S]{0,1000}navigateToJourney\(\{ replace: true \}\)/,
  );
  assert.match(summary, /loaded\.attempt\.phase !== "summary"/);
  assert.match(launch, /window\.location\.replace\(target\)/);
  assert.doesNotMatch(summary, /"Continue Journey"/);
});

test("Journey map keeps cleared stops non-gating and animates finite avatar travel", async () => {
  const client = await source("components/progression/JourneyClient.tsx");
  const journeyStyles = await source("app/journey/journey.module.css");
  assert.doesNotMatch(client, /replay for practice/);
  assert.match(client, /\(isCleared && !isActive\)/);
  assert.match(
    client,
    /activeNode \?\? nextNode \?\? finalJourneyNode\(journey\)/,
  );
  assert.match(client, /aria-current=\{isTrailPosition \? "step" : undefined\}/);
  assert.match(client, /setArrivalNodeId\(null\), 950/);
  assert.match(client, /scrollIntoView/);
  assert.match(client, /viewedLevel !== trailNode\.journeyLevel/);
  assert.doesNotMatch(client, /viewedLevel !== trailNode\.level/);
  assert.match(client, /profile\.gameSnapshot\.find/);
  assert.doesNotMatch(client, /Math Kangaroo spatial review/);
  assert.match(client, /Restart stop/);
  assert.match(client, /discardActiveProgressionAttempt/);
  assert.match(journeyStyles, /\.walkerArriving/);
  assert.match(journeyStyles, /@keyframes walker-follow-path/);
  assert.match(journeyStyles, /\.profileButton > span:last-child/);
});
