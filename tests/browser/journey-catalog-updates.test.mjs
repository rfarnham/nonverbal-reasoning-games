import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { ROUNDS } from "../../app/games/extra-piece/game-engine.ts";
import { journeyReviews } from "../../lib/journey-reviews.ts";
import {
  PROGRESSION_STORAGE_KEY,
  addPlayerProfile,
  buildPlayerJourney,
  createPlayerProfile,
  createProgressionState,
  nextIncompleteJourneyNode,
  saveProgressionState,
} from "../../lib/progression/index.ts";
import { discoverGamePackages } from "../../scripts/generate-game-registry.mjs";

const basePath = "/nonverbal-reasoning-games";
const root = resolve(fileURLToPath(new URL("../../out/", import.meta.url)));
const shots = resolve(fileURLToPath(new URL("../../outputs/journey-catalog-updates/", import.meta.url)));
const mime = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".txt": "text/x-component", ".json": "application/json",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
let server, browser, origin, fixture;

async function juliaFixture() {
  const packages = await discoverGamePackages();
  const snapshot = await Promise.all(packages.filter(({ slug }) => slug !== "extra-piece")
    .map(async ({ slug, catalogFile }) => {
      const { progressionMetadata } = await import(pathToFileURL(resolve(dirname(catalogFile), "progression-metadata.ts")).href);
      return {
        slug,
        title: slug.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "),
        role: "game",
        ...progressionMetadata,
      };
    }));
  snapshot.push(...journeyReviews.map(({ slug, title, journeyContentVersion }) => ({
    slug, title, role: "review", journeyContentVersion,
  })));
  let profile = createPlayerProfile({
    id: "browser-julia-catalog-update", name: "Julia", avatarId: "hedgehog",
    gameSnapshot: snapshot, nowMs: 1,
  });
  const journey = buildPlayerJourney(profile);
  const clearedNodes = [...journey.boards[0].nodes, ...journey.boards[1].nodes.slice(0, 2)];
  profile = {
    ...profile,
    clearedStopIds: clearedNodes.map(({ id }) => id),
    awardedStopIds: clearedNodes.map(({ id }) => id),
    xpAwards: clearedNodes.map(({ id, xp }) => ({ stopId: id, amount: xp })),
  };
  const forwardNode = nextIncompleteJourneyNode(profile);
  const forwardTitle = snapshot.find(({ slug }) => slug === forwardNode.gameSlug).title;
  let value;
  assert.equal(saveProgressionState(addPlayerProfile(createProgressionState(), profile), {
    getItem: () => null, setItem: (_, encoded) => { value = encoded; },
  }), true);
  return { value, profile, forwardNode, forwardLabel: `Turbo Time · ${forwardTitle}` };
}

before(async () => {
  fixture = await juliaFixture();
  await mkdir(shots, { recursive: true });
  origin = process.env.JOURNEY_TEST_ORIGIN?.replace(/\/+$/, "");
  if (!origin) {
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
        if (!pathname.startsWith(`${basePath}/`)) throw new Error("Unsupported path");
        let file = resolve(root, pathname.slice(basePath.length + 1));
        if (file !== root && !file.startsWith(root + sep)) throw new Error("Unsupported path");
        if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
        response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
});

async function open(width = 1200) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: PROGRESSION_STORAGE_KEY, value: fixture.value });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}${basePath}/journey/`);
  await page.getByRole("heading", { name: "Junior I", exact: true }).waitFor();
  return { context, page, errors };
}

async function savedProfile(page) {
  return page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key));
    return state.profiles.find(({ id }) => id === state.activeProfileId);
  }, PROGRESSION_STORAGE_KEY);
}

async function savedAttempt(page) {
  const profile = await savedProfile(page);
  return profile.attempts[profile.activeAttemptId];
}

async function assertFocused(locator) {
  await locator.page().waitForFunction(element => element === document.activeElement, await locator.elementHandle());
}

async function assertFits(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} has no horizontal overflow`);
  const controls = await page.locator("main button").evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute("aria-label") ?? element.textContent, width: box.width, height: box.height, left: box.left, right: box.right, viewport: innerWidth };
  }));
  for (const control of controls) {
    assert.ok(control.width >= 44 && control.height >= 44, `${label}: ${control.label} is at least 44×44`);
    assert.ok(control.left >= 0 && control.right <= control.viewport, `${label}: ${control.label} is not cropped`);
  }
}

test("Julia visits Extra Piece on Starter, resumes the canonical stop, and returns to her earned Junior I trail", async () => {
  const { context, page, errors } = await open();
  try {
    const initial = await savedProfile(page);
    assert.deepEqual(initial.gameSnapshot, fixture.profile.gameSnapshot);
    assert.deepEqual(initial.journeyAdditions.map(({ slug }) => slug), ["extra-piece"]);
    assert.deepEqual(initial.clearedStopIds, fixture.profile.clearedStopIds);
    assert.deepEqual(initial.xpAwards, fixture.profile.xpAwards);
    assert.equal(await page.getByRole("button", { name: "Junior I", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: `${fixture.forwardLabel}. Locked`, exact: true }).isDisabled(), true);
    const update = page.getByRole("region", { name: "New game on your trail", exact: true });
    assert.match(await update.textContent(), /Extra Piece.*Starter stop before continuing Junior I/);
    await page.getByRole("button", { name: "Visit Starter trail", exact: true }).click();
    await page.getByRole("heading", { name: "Starter", exact: true }).waitFor();
    const extraPiece = page.getByRole("button", { name: "Extra Piece. New game stop. 25 XP when cleared", exact: true });
    await assertFocused(extraPiece);
    await extraPiece.click();
    await page.waitForURL(new RegExp(`${basePath}/games/extra-piece/\\?progression=`));
    const choices = page.locator("button[aria-keyshortcuts]");
    await choices.first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Campaign", exact: true }).count(), 0);
    const attempt = await savedAttempt(page);
    assert.equal(attempt.stopId, "starter:catch-up:extra-piece");
    assert.equal(attempt.rounds.length, 12);
    assert.ok(attempt.rounds.every(({ question }) => question.gameSlug === "extra-piece"));

    const rounds = ROUNDS.filter(({ difficulty }) => difficulty === "Easy");
    await choices.nth((rounds[0].correctIndex + 1) % rounds[0].pieces.length).click();
    await page.getByText("Try again", { exact: true }).waitFor();
    const missed = await savedAttempt(page);
    assert.equal(missed.rounds[0].firstTryCorrect, false);
    assert.equal(missed.rounds[0].attemptCount, 1);
    await page.reload();
    await page.getByText("Try again", { exact: true }).waitFor();
    const resumed = await savedAttempt(page);
    assert.equal(resumed.id, missed.id);
    assert.equal(resumed.currentRoundIndex, missed.currentRoundIndex);
    assert.deepEqual(resumed.rounds, missed.rounds);
    for (const round of rounds) {
      await choices.nth(round.correctIndex).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await page.getByRole("button", { name: "Review Mistakes", exact: true }).click();
    await choices.nth(rounds[0].correctIndex).click();
    await page.getByRole("button", { name: /^(Next|Results)$/ }).click();
    await page.waitForURL(new RegExp(`${basePath}/journey/summary/`));
    assert.equal((await savedAttempt(page)).rounds[0].firstTryCorrect, false);
    await page.getByRole("button", { name: "Claim 25 XP", exact: true }).click();
    await page.waitForURL(`${origin}${basePath}/journey/`);
    await page.getByRole("heading", { name: "Junior I", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: `${fixture.forwardLabel}. 50 XP when cleared`, exact: true }).isEnabled(), true);
    const completed = await savedProfile(page);
    assert.deepEqual(new Set(completed.clearedStopIds), new Set([...fixture.profile.clearedStopIds, "starter:catch-up:extra-piece"]));
    assert.deepEqual(completed.clearedStopIds.filter(id => id !== "starter:catch-up:extra-piece"), fixture.profile.clearedStopIds);
    assert.deepEqual(completed.xpAwards, [...fixture.profile.xpAwards, { stopId: "starter:catch-up:extra-piece", amount: 25 }]);
    assert.equal(completed.activeAttemptId, null);
    assert.equal(completed.missedQuestions.length, 1);
    await page.reload();
    await page.getByRole("heading", { name: "Junior I", exact: true }).waitFor();
    assert.deepEqual((await savedProfile(page)).xpAwards, completed.xpAwards);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("catalog update navigation and new stops fit 820px, 620px, and 390px screens", async () => {
  const { context, page, errors } = await open(820);
  try {
    for (const width of [820, 620, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "Junior I", exact: true }).click();
      await assertFits(page, `${width}px current trail`);
      await page.screenshot({ path: resolve(shots, `junior-catch-up-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Visit Starter trail", exact: true }).click();
      await assertFocused(page.getByRole("button", { name: "Extra Piece. New game stop. 25 XP when cleared", exact: true }));
      await assertFits(page, `${width}px catch-up trail`);
      await page.screenshot({ path: resolve(shots, `starter-catch-up-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
