import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import {
  CAMPAIGN_BY_LEVEL, generateInfiniteRound, roundFingerprint, seededRandom,
} from "../../app/games/picture-memory/game-engine.ts";
import { PICTURE_BY_ID } from "../../app/games/picture-memory/picture-data.ts";
import { progressionAdapter } from "../../app/games/picture-memory/progression-adapter.ts";
import { encodeSelectionAnswerToken } from "../../app/games/picture-memory/selection-tokens.ts";
import { journeyReviews } from "../../lib/journey-reviews.ts";
import {
  PROGRESSION_STORAGE_KEY, addPlayerProfile, buildJourneyPlan,
  createNormalProgressionAttempt, createPlayerProfile, createProgressionState,
  journeyQuestionReferences, saveProgressionState, upsertProfileAttempt,
} from "../../lib/progression/index.ts";

const base = "/nonverbal-reasoning-games";
const route = `${base}/games/picture-memory/`;
const root = resolve(fileURLToPath(new URL("../../out/", import.meta.url)));
const shots = resolve(fileURLToPath(new URL("../../outputs/picture-memory/", import.meta.url)));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/x-component", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
let server, browser, origin;

before(async () => {
  await mkdir(shots, { recursive: true });
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      if (!pathname.startsWith(`${base}/`)) throw new Error("Unsupported path");
      let file = resolve(root, pathname.slice(base.length + 1));
      if (file !== root && !file.startsWith(root + sep)) throw new Error("Unsupported path");
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
});

function choices(page) { return page.locator("button[aria-keyshortcuts]"); }
async function assertFocused(locator) {
  await locator.page().waitForFunction(element => element === document.activeElement, await locator.elementHandle());
  assert.equal(await locator.evaluate(element => element === document.activeElement), true);
}
async function open({ width = 1200, height = 900, fixture, query = "", reducedMotion = "reduce" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  if (fixture) await context.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: PROGRESSION_STORAGE_KEY, value: fixture });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin + route + query);
  await page.getByRole("link", { name: /^(All games|Journey map)$/ }).first().waitFor();
  return { context, page, errors };
}
async function study(page, round, { expectFocus = true } = {}) {
  const panel = page.getByRole("region", { name: "Study pictures", exact: true });
  await panel.waitFor();
  assert.equal(await choices(page).count(), 0, "Choices stay hidden while studying.");
  for (const id of round.study) await panel.getByRole("img", { name: PICTURE_BY_ID[id].label, exact: true }).waitFor();
  const ready = page.getByRole("button", { name: "I’m ready", exact: true });
  if (expectFocus) await assertFocused(ready);
}
async function hide(page, round) {
  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  await choices(page).first().waitFor();
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0, "The studied objects are removed during recall.");
  assert.equal(await page.getByRole("group", { name: "Pictures to remember", exact: true }).count(), 0);
  assert.equal(await choices(page).count(), round.options.length);
  for (let index = 0; index < round.options.length; index += 1) {
    assert.equal(await choices(page).nth(index).getAttribute("aria-keyshortcuts"), String(index + 1));
    assert.equal(await choices(page).nth(index).getAttribute("aria-label"), `Picture ${index + 1}: ${PICTURE_BY_ID[round.options[index]].label}`);
  }
  assert.equal(await page.getByRole("button", { name: "Check answer", exact: true }).isDisabled(), true);
  await assertFocused(choices(page).first());
}
async function select(page, round, selected, keyboard = false) {
  for (const id of selected) {
    const index = round.options.indexOf(id);
    assert.ok(index >= 0);
    if (keyboard) await page.keyboard.press(String(index + 1));
    else await choices(page).nth(index).click();
  }
}
async function answer(page, round, { correct = true, keyboard = false, reloadDuringFeedback = false } = {}) {
  await study(page, round, { expectFocus: false });
  await hide(page, round);
  const selected = correct ? round.study : [round.options.find(id => !round.study.includes(id))];
  await select(page, round, selected, keyboard);
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  if (correct) {
    const next = page.getByRole("button", { name: /^(Next|Finish level|Finish review|Results)$/ });
    await next.waitFor();
    await assertFocused(next);
    assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(Boolean));
    const opacity = await choices(page).evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
    assert.ok(opacity.every((value, index) => round.study.includes(round.options[index]) || value < Math.max(...opacity)), "Solved choices mute irrelevant objects.");
  } else {
    await page.getByRole("status").filter({ hasText: "not in the study set" }).waitFor();
    assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(Boolean), "Wrong feedback locks the full selection.");
    if (reloadDuringFeedback) {
      await page.reload();
      await page.getByRole("status").filter({ hasText: "not in the study set" }).waitFor();
    }
    await page.getByRole("group", { name: "Study pictures shown again", exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "Try again" }).waitFor();
    await study(page, round);
  }
}
async function advance(page) { await page.getByRole("button", { name: /^(Next|Finish level|Finish review|Results)$/ }).click(); }
async function score(page) { return page.locator('[aria-label^="First try score "]').getAttribute("aria-label"); }
async function assertFits(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} has horizontal overflow`);
  const controls = await page.locator("button, a").evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
  }).map(element => ({ label: element.getAttribute("aria-label") || element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: innerWidth })));
  for (const control of controls) {
    assert.ok(control.width >= 44 && control.height >= 44, `${label}: ${control.label} is ${control.width} by ${control.height}`);
    assert.ok(control.left >= 0 && control.right <= control.viewport, `${label}: ${control.label} is cropped horizontally`);
  }
}
async function seedNextGeneration(page, difficulty, seed, seen) {
  await page.evaluate(seedValue => {
    let state = seedValue >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
  }, seed);
  const round = generateInfiniteRound(difficulty, seededRandom(seed), seen);
  seen.add(roundFingerprint(round));
  return round;
}
async function recallSaved(page, round, selected) {
  const token = encodeSelectionAnswerToken(selected, round.options);
  await page.waitForFunction(expected => {
    const value = JSON.parse(localStorage.getItem("picture-memory-recall-v1:picture-memory-browser-profile") ?? "null");
    return value?.recalling === true && value.token === expected;
  }, token);
}
async function saved(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), PROGRESSION_STORAGE_KEY); }
function activeAttempt(state) {
  const profile = state.profiles.find(candidate => candidate.id === state.activeProfileId);
  return profile.attempts[profile.activeAttemptId];
}

// The canonical PDF action is self-paced study, deliberate hide, and exact-set recall.
test("Campaign hides study pictures and preserves misses through retries, history, checkpoint, and redemption", async () => {
  const { context, page, errors } = await open();
  await page.screenshot({ path: resolve(shots, "example-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  const rounds = CAMPAIGN_BY_LEVEL.Starter;
  await study(page, rounds[0]);
  assert.equal(await page.getByRole("group", { name: "Starter problems", exact: true }).getByRole("button").count(), 12);
  await answer(page, rounds[0], { correct: false });
  assert.equal(await score(page), "First try score 0");
  await answer(page, rounds[0], { keyboard: true });
  await advance(page);
  await study(page, rounds[1]);
  const marker = page.getByRole("button", { name: "Starter problem 1: incorrect; review problem", exact: true });
  const markersBefore = await page.getByRole("group", { name: "Starter problems", exact: true }).getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), current: element.getAttribute("aria-current") })));
  await marker.click();
  const heading = page.getByRole("heading", { name: "Starter · Problem 1", exact: true });
  await heading.waitFor();
  await assertFocused(heading);
  assert.equal(await choices(page).count(), 0);
  assert.equal(await page.getByRole("button", { name: "I’m ready", exact: true }).count(), 0, "History is read-only.");
  await page.keyboard.press("4");
  await page.getByRole("button", { name: "Back to current problem", exact: true }).click();
  await heading.waitFor({ state: "detached" });
  await assertFocused(marker);
  assert.equal(await score(page), "First try score 0");
  assert.deepEqual(await page.getByRole("group", { name: "Starter problems", exact: true }).getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), current: element.getAttribute("aria-current") }))), markersBefore);
  for (let index = 1; index < rounds.length; index += 1) {
    await answer(page, rounds[index], { keyboard: index % 2 === 0 });
    await advance(page);
  }
  await page.getByRole("heading", { name: "Level complete", exact: true }).waitFor();
  assert.equal(await choices(page).count(), 0);
  const review = page.getByRole("button", { name: "Review Mistakes", exact: true });
  await assertFocused(review);
  assert.equal(await score(page), "First try score 11");
  await review.click();
  await page.getByRole("heading", { name: "Here’s your chance at redemption.", exact: true }).waitFor();
  assert.match(await page.locator('[class*="resultScore"]').textContent(), /11\s*\/ 12 first try/);
  await page.getByRole("button", { name: "Retry missed", exact: true }).click();
  await answer(page, rounds[0]);
  await advance(page);
  await page.getByRole("heading", { name: "Level complete", exact: true }).waitFor();
  assert.equal(await marker.getAttribute("aria-label"), "Starter problem 1: incorrect; review problem");
  assert.equal(await score(page), "First try score 11");
  assert.equal(await page.getByRole("button", { name: "Review Mistakes", exact: true }).count(), 0);
  const junior = page.getByRole("button", { name: "Junior", exact: true });
  await assertFocused(junior);
  await junior.click();
  await study(page, CAMPAIGN_BY_LEVEL.Junior[0]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("Infinite adapts from first attempts only and ends with untimed redemption", async () => {
  const { context, page, errors } = await open({ width: 820 });
  const seen = new Set();
  let round = await seedNextGeneration(page, "Starter", 202609270, seen);
  await page.getByRole("button", { name: "Infinite", exact: true }).click();
  await study(page, round);
  assert.equal(await page.getByRole("button", { name: "End", exact: true }).isDisabled(), true);
  for (let ordinal = 0; ordinal < 9; ordinal += 1) {
    await answer(page, round, { keyboard: true });
    assert.equal(Number(await page.getByRole("progressbar", { name: "Combo energy", exact: true }).getAttribute("aria-valuenow")), Math.min(100, Math.round(((ordinal + 1) / 8) * 100)));
    const nextDifficulty = ordinal < 2 ? "Starter" : ordinal < 5 ? "Junior" : ordinal < 8 ? "Expert" : "Wizard";
    round = await seedNextGeneration(page, nextDifficulty, 202609271 + ordinal, seen);
    await advance(page);
    await study(page, round);
  }
  assert.equal(round.difficulty, "Wizard");
  await answer(page, round, { correct: false, keyboard: true });
  assert.equal(await page.getByRole("progressbar", { name: "Combo energy", exact: true }).getAttribute("aria-valuenow"), "0");
  assert.equal(await score(page), "First try score 9");
  await answer(page, round);
  assert.equal(await score(page), "First try score 9");
  assert.equal(await page.getByRole("progressbar", { name: "Combo energy", exact: true }).getAttribute("aria-valuenow"), "0");
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("heading", { name: "Here’s your chance at redemption.", exact: true }).waitFor();
  assert.match(await page.locator('[class*="resultScore"]').textContent(), /9\s*\/ 10 first try/);
  await page.getByRole("button", { name: "Retry missed", exact: true }).click();
  await answer(page, round, { keyboard: true });
  await advance(page);
  const results = page.getByRole("heading", { name: "Redemption complete.", exact: true });
  await results.waitFor();
  await assertFocused(results);
  assert.deepEqual(errors, []);
  await context.close();
});

test("study and recall fit 820px, 620px, and 390px with large controls and hidden Wizard count", async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await assertFits(page, "390px example");
  await page.screenshot({ path: resolve(shots, "example-phone.png"), fullPage: true });
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  for (const difficulty of ["Starter", "Junior", "Expert", "Wizard"]) {
    if (difficulty !== "Starter") await page.getByRole("button", { name: new RegExp(`^${difficulty},`) }).click();
    const round = CAMPAIGN_BY_LEVEL[difficulty][0];
    await study(page, round);
    const studySizes = new Map();
    for (const width of [390, 620, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertFits(page, `${width}px ${difficulty} study`);
      studySizes.set(width, await page.getByRole("region", { name: "Study pictures", exact: true }).locator("svg").first().evaluate(element => element.getBoundingClientRect().width));
    }
    await hide(page, round);
    for (const width of [390, 620, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertFits(page, `${width}px ${difficulty} recall`);
      const recallMetrics = await choices(page).first().locator("svg").evaluate(element => ({width: element.getBoundingClientRect().width, cssWidth: getComputedStyle(element).width, token: getComputedStyle(element).getPropertyValue("--picture-size"), viewport: innerWidth, phone: matchMedia("(max-width: 390px)").matches}));
      const recallSize = recallMetrics.width;
      assert.ok(Math.abs(recallSize - studySizes.get(width)) < 1, `${width}px ${difficulty} uses the same object size in study (${studySizes.get(width)}) and recall (${JSON.stringify(recallMetrics)})`);
      if (width === 390) await page.screenshot({ path: resolve(shots, `${difficulty.toLowerCase()}-phone.png`), fullPage: true });
    }
    if (difficulty === "Wizard") {
      assert.equal(await page.getByText("Choose 3 pictures. Then check your answer.", { exact: true }).count(), 0);
      await page.getByText("Choose every picture you remember. Then check your answer.", { exact: true }).waitFor();
    }
  }
  assert.deepEqual(errors, []);
  await context.close();
});

function journeyFixture({ boardIndex = 1 } = {}) {
  const snapshot = [
    { slug: progressionAdapter.gameSlug, title: "Picture Memory", role: "game", contentVersion: progressionAdapter.contentVersion, generatorVersion: progressionAdapter.generatorVersion, journeyContentVersion: progressionAdapter.journeyContentVersion },
    ...journeyReviews.map(review => ({ slug: review.slug, title: review.title, role: "review", journeyContentVersion: review.journeyContentVersion })),
  ];
  const node = buildJourneyPlan(snapshot).boards[boardIndex].nodes.find(candidate => candidate.kind === "normal");
  const attempt = createNormalProgressionAttempt({ id: "browser-picture-memory", node,
    journeyQuestions: journeyQuestionReferences(progressionAdapter, node.journeyLevel, { collectionId: node.collectionId, questionOffset: node.questionOffset, questionCount: node.questionCount }), nowMs: 1 });
  const profile = upsertProfileAttempt(createPlayerProfile({ id: "picture-memory-browser-profile", name: "testUser123", avatarId: "hedgehog", gameSnapshot: snapshot, nowMs: 1 }), attempt);
  let fixture;
  assert.equal(saveProgressionState(addPlayerProfile(createProgressionState(), profile), { getItem: () => null, setItem: (_, value) => { fixture = value; } }), true);
  return { fixture, attempt };
}

test("Journey resumes study, incomplete multi-selection, feedback, retry recall, and solved states across reload", async () => {
  const { fixture, attempt } = journeyFixture();
  const { context, page, errors } = await open({ width: 390, height: 844, fixture, query: `?progression=${attempt.id}` });
  const round = CAMPAIGN_BY_LEVEL.Junior[0];
  await study(page, round);
  assert.equal(await page.getByRole("button", { name: "Campaign", exact: true }).count(), 0);
  await page.reload();
  await study(page, round);
  await page.evaluate(() => localStorage.setItem("picture-memory-recall-v1:another-profile", JSON.stringify({ playId: "other-round", recalling: true, token: "other-selection" })));
  await hide(page, round);
  await select(page, round, [round.study[0]], true);
  await recallSaved(page, round, [round.study[0]]);
  await page.reload();
  await choices(page).first().waitFor();
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0, "Reload stays in recall instead of showing the answers again.");
  assert.equal(await choices(page).nth(round.options.indexOf(round.study[0])).getAttribute("aria-pressed"), "true");
  assert.equal(await choices(page).nth(round.options.indexOf(round.study[1])).getAttribute("aria-pressed"), "false");
  assert.equal(activeAttempt(await saved(page)).rounds[0].attemptCount, 0, "Selecting objects alone is not an attempt.");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("picture-memory-recall-v1:another-profile"))), { playId: "other-round", recalling: true, token: "other-selection" }, "Saving this profile leaves another profile’s recall state intact.");
  const extra = round.options.find(id => !round.study.includes(id));
  await select(page, round, [extra]);
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "not in the study set" }).waitFor();
  await page.reload();
  await page.getByRole("status").filter({ hasText: "not in the study set" }).waitFor();
  assert.equal(activeAttempt(await saved(page)).rounds[0].firstTryCorrect, false);
  await page.getByRole("status").filter({ hasText: "Try again" }).waitFor();
  await study(page, round);
  await hide(page, round);
  await select(page, round, [round.study[1]]);
  await recallSaved(page, round, [round.study[1]]);
  await page.reload();
  await choices(page).first().waitFor();
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0, "Retry recall also resumes without revealing the study set.");
  assert.equal(await choices(page).nth(round.options.indexOf(round.study[1])).getAttribute("aria-pressed"), "true");
  await select(page, round, [round.study[0]], true);
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.waitFor();
  const solved = activeAttempt(await saved(page));
  assert.equal(solved.rounds[0].phase, "solved");
  assert.equal(solved.rounds[0].firstTryCorrect, false);
  assert.equal(solved.rounds[0].attemptCount, 2);
  await page.reload();
  await next.waitFor();
  await assertFocused(next);
  assert.deepEqual(activeAttempt(await saved(page)).rounds, solved.rounds);
  await advance(page);
  await study(page, CAMPAIGN_BY_LEVEL.Junior[1]);
  assert.deepEqual(errors, []);
  await context.close();
});


test("Journey Starter redemption focuses the newly mounted study control and keeps first attempts unchanged", async () => {
  const { fixture, attempt } = journeyFixture({ boardIndex: 0 });
  const { context, page, errors } = await open({ fixture, query: `?progression=${attempt.id}` });
  const rounds = CAMPAIGN_BY_LEVEL.Starter;
  await answer(page, rounds[0], { correct: false, keyboard: true });
  await answer(page, rounds[0], { keyboard: true });
  await advance(page);
  for (const round of rounds.slice(1)) {
    await answer(page, round, { keyboard: true });
    await advance(page);
  }
  await page.getByRole("heading", { name: "Here’s your chance at redemption.", exact: true }).waitFor();
  assert.equal(activeAttempt(await saved(page)).phase, "redemption-ready");
  await page.reload();
  await page.getByRole("button", { name: "Review Mistakes", exact: true }).click();
  await study(page, rounds[0]);
  assert.equal(activeAttempt(await saved(page)).redemption.queue.length, 1);
  await page.keyboard.press("Enter");
  await choices(page).first().waitFor();
  await assertFocused(choices(page).first());
  await select(page, rounds[0], rounds[0].study, true);
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: /^(Next|Results)$/ }).waitFor();
  await advance(page);
  await page.waitForURL(new RegExp(`${base}/journey/summary/`));
  const finished = activeAttempt(await saved(page));
  assert.equal(finished.rounds.filter(round => round.firstTryCorrect).length, 11);
  assert.equal(finished.rounds[0].firstTryCorrect, false);
  assert.deepEqual(errors, []);
  await context.close();
});
