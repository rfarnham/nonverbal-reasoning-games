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

async function advanceTime(page, duration, { allowNavigation = false } = {}) {
  try {
    await page.clock.runFor(duration);
    // React may schedule the next zero-delay stage after the elapsed callback.
    for (let turn = 0; turn < 3; turn += 1) {
      await page.evaluate(() => null);
      await page.clock.runFor(1);
    }
  } catch (error) {
    if (allowNavigation && /Execution context was destroyed/.test(error.message)) return;
    throw error;
  }
}
async function painted() { await new Promise(resolve => setTimeout(resolve, 40)); }
function choices(page) { return page.locator("button[aria-keyshortcuts]"); }
function correctFeedback(page) { return page.getByRole("status").filter({ hasText: /Correct/ }).first(); }
function wrongFeedback(page) { return page.getByRole("status").filter({ hasText: /^× Try again$/ }).first(); }
async function assertFocused(locator) {
  await locator.page().waitForFunction(element => element === document.activeElement, await locator.elementHandle());
  assert.equal(await locator.evaluate(element => element === document.activeElement), true);
}
async function assertAutomaticControls(page) {
  assert.equal(await page.getByRole("button", { name: /^(I’m ready|I'm ready|Check answer|Next|Finish level|Finish review)$/ }).count(), 0, "Study, checking, and the next puzzle advance automatically.");
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
  await page.clock.install();
  await page.goto(origin + route + query);
  await page.getByRole("link", { name: /^(All games|Journey map)$/ }).first().waitFor();
  if (fixture) await page.getByRole("region", { name: "Study pictures", exact: true }).waitFor();
  else await page.getByRole("button", { name: "Campaign", exact: true }).waitFor();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  return { context, page, errors };
}
async function reload(page) {
  await page.reload();
  // A restored canonical round hydrates through a zero-delay effect.
  await advanceTime(page, 1);
  await page.getByRole("link", { name: /^(All games|Journey map)$/ }).first().waitFor();
  await advanceTime(page, 1);
}
async function study(page, round) {
  const panel = page.getByRole("region", { name: "Study pictures", exact: true });
  await panel.waitFor();
  assert.equal(await choices(page).count(), 0, "Choices stay hidden while studying.");
  for (const id of round.study) {
    const image = panel.getByRole("img", { name: PICTURE_BY_ID[id].label, exact: true });
    await image.waitFor();
    assert.equal(await image.locator(":scope > g[data-picture-pose]").getAttribute("data-picture-pose"), PICTURE_BY_ID[id].pose, "Study artwork preserves its exact authored pose.");
  }
  await assertAutomaticControls(page);
}
async function recall(page, round) {
  await advanceTime(page, round.difficulty === "Expert" || round.difficulty === "Wizard" ? 12_000 : 4_000);
  await choices(page).first().waitFor();
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0, "The studied objects disappear automatically during recall.");
  assert.equal(await page.getByRole("group", { name: "Pictures to remember", exact: true }).count(), 0);
  assert.equal(await choices(page).count(), round.options.length);
  for (let index = 0; index < round.options.length; index += 1) {
    assert.equal(await choices(page).nth(index).getAttribute("aria-keyshortcuts"), String(index + 1));
    assert.equal(await choices(page).nth(index).getAttribute("aria-label"), `Picture ${index + 1}: ${PICTURE_BY_ID[round.options[index]].label}`);
    assert.equal(await choices(page).nth(index).locator("svg > g[data-picture-pose]").getAttribute("data-picture-pose"), PICTURE_BY_ID[round.options[index]].pose, "Recall artwork preserves each target or foil pose.");
  }
  await assertAutomaticControls(page);
  await assertFocused(choices(page).first());
}
async function select(page, round, selected, keyboard = false, beforeLast) {
  for (let offset = 0; offset < selected.length; offset += 1) {
    if (offset === selected.length - 1 && beforeLast) await beforeLast();
    const index = round.options.indexOf(selected[offset]);
    assert.ok(index >= 0);
    if (keyboard) await page.keyboard.press(String(index + 1));
    else await choices(page).nth(index).click();
  }
  await advanceTime(page, 1);
}
async function assertCorrect(page, round) {
  await correctFeedback(page).waitFor();
  await painted();
  await assertAutomaticControls(page);
  assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(Boolean), "Automatic submission locks all choices during feedback.");
  let opacity;
  let muted = false;
  // Native CSS painting continues on real frames while the JS clock is paused.
  for (let frame = 0; frame < 25; frame += 1) {
    opacity = await choices(page).evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
    muted = opacity.every((value, index) => round.study.includes(round.options[index]) || value < Math.max(...opacity));
    if (muted) break;
    await page.clock.runFor(1);
    await painted();
  }
  assert.ok(muted, `Solved choices mute irrelevant objects: ${JSON.stringify(opacity)}`);
}
async function finishCorrect(page, options) {
  await advanceTime(page, 950, options);
}
async function finishWrong(page, round, { reloadDuringFeedback = false } = {}) {
  await wrongFeedback(page).waitFor();
  assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(Boolean), "Wrong feedback locks the full selection.");
  const selected = page.locator('button[aria-keyshortcuts][aria-pressed="true"]');
  assert.equal(await selected.count(), round.study.length);
  const selectedMarks = await selected.locator('[class*="choiceMark"]').allTextContents();
  assert.ok(selectedMarks.every(mark => mark === "×"), "Every selected picture gets the same group-failure mark, including any correctly remembered member.");
  for (let index = 0; index < round.options.length; index += 1) assert.equal((await choices(page).nth(index).getAttribute("aria-label")).replace(/, try again$/, ""), `Picture ${index + 1}: ${PICTURE_BY_ID[round.options[index]].label}`, "Wrong feedback does not label individual pictures correct or incorrect.");
  if (reloadDuringFeedback) {
    await reload(page);
    await wrongFeedback(page).waitFor();
  }
  assert.equal(await page.getByRole("group", { name: "Study pictures shown again", exact: true }).count(), 0, "Wrong feedback does not reveal the target set.");
  assert.equal(await wrongFeedback(page).locator("svg").count(), 0);
  assert.doesNotMatch(await wrongFeedback(page).textContent(), /missing|not in|correct answer|[0-9]/i, "Wrong feedback does not identify local answer differences.");
  await advanceTime(page, 950);
  await study(page, round);
}
async function answer(page, round, { correct = true, keyboard = false, reloadDuringFeedback = false, beforeLast } = {}) {
  await study(page, round);
  await recall(page, round);
  const selected = correct ? round.study : [round.options.find(id => !round.study.includes(id)), ...round.study.slice(1)];
  await select(page, round, selected, keyboard, beforeLast);
  if (correct) await assertCorrect(page, round);
  else await finishWrong(page, round, { reloadDuringFeedback });
}
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
async function visibility(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

// The PDF's study/recognition action now has automatic exposure and checking.
test("Campaign automatically studies, submits, and advances while preserving history and deliberate checkpoints", async () => {
  const { context, page, errors } = await open();
  await page.screenshot({ path: resolve(shots, "example-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  const rounds = CAMPAIGN_BY_LEVEL.Starter;
  await study(page, rounds[0]);
  assert.equal(await page.getByRole("group", { name: "Starter problems", exact: true }).getByRole("button").count(), 12);
  await answer(page, rounds[0], { correct: false });
  assert.equal(await score(page), "First try score 0");
  await answer(page, rounds[0], { keyboard: true });
  await advanceTime(page, 500);
  assert.equal(await correctFeedback(page).isVisible(), true, "Reduced motion still leaves readable correct feedback.");
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0);
  await advanceTime(page, 450);
  await study(page, rounds[1]);
  const marker = page.getByRole("button", { name: "Starter problem 1: incorrect; review problem", exact: true });
  const markersBefore = await page.getByRole("group", { name: "Starter problems", exact: true }).getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), current: element.getAttribute("aria-current") })));
  await marker.click();
  const heading = page.getByRole("heading", { name: "Starter · Problem 1", exact: true });
  await heading.waitFor();
  await assertFocused(heading);
  await advanceTime(page, 10_000);
  assert.equal(await heading.isVisible(), true, "Historical inspection does not consume the active study exposure.");
  assert.equal(await choices(page).count(), 0);
  await assertAutomaticControls(page);
  await page.keyboard.press("4");
  await page.getByRole("button", { name: "Back to current problem", exact: true }).click();
  await heading.waitFor({ state: "detached" });
  await advanceTime(page, 20);
  await assertFocused(marker);
  assert.equal(await score(page), "First try score 0");
  assert.deepEqual(await page.getByRole("group", { name: "Starter problems", exact: true }).getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), current: element.getAttribute("aria-current") }))), markersBefore);
  for (let index = 1; index < rounds.length; index += 1) {
    await answer(page, rounds[index], { keyboard: index % 2 === 0 });
    await finishCorrect(page);
  }
  await page.getByRole("heading", { name: "Level complete", exact: true }).waitFor();
  assert.equal(await choices(page).count(), 0);
  const review = page.getByRole("button", { name: "Review Mistakes", exact: true });
  await assertFocused(review);
  assert.equal(await score(page), "First try score 11");
  await advanceTime(page, 10_000);
  assert.equal(await review.isVisible(), true, "The level checkpoint waits for the player.");
  await review.click();
  await page.getByRole("heading", { name: "Here’s your chance at redemption.", exact: true }).waitFor();
  assert.match(await page.locator('[class*="resultScore"]').textContent(), /11\s*\/ 12 first try/);
  await page.getByRole("button", { name: "Retry missed", exact: true }).click();
  await answer(page, rounds[0]);
  await finishCorrect(page);
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

test("Infinite auto-advances with first-attempt adaptation and untimed redemption", async () => {
  const { context, page, errors } = await open({ width: 820 });
  const seen = new Set();
  let round = await seedNextGeneration(page, "Starter", 202609270, seen);
  await page.getByRole("button", { name: "Infinite", exact: true }).click();
  await study(page, round);
  assert.equal(await page.getByRole("button", { name: "End", exact: true }).isDisabled(), true);
  for (let ordinal = 0; ordinal < 9; ordinal += 1) {
    const nextDifficulty = ordinal < 2 ? "Starter" : ordinal < 5 ? "Junior" : ordinal < 8 ? "Expert" : "Wizard";
    let nextRound;
    await answer(page, round, { keyboard: true, beforeLast: async () => { nextRound = await seedNextGeneration(page, nextDifficulty, 202609271 + ordinal, seen); } });
    assert.equal(Number(await page.getByRole("progressbar", { name: "Combo energy", exact: true }).getAttribute("aria-valuenow")), Math.min(100, Math.round(((ordinal + 1) / 8) * 100)));
    await finishCorrect(page);
    round = nextRound;
    await study(page, round);
  }
  assert.equal(round.difficulty, "Wizard");
  await answer(page, round, { correct: false, keyboard: true });
  assert.equal(await page.getByRole("progressbar", { name: "Combo energy", exact: true }).getAttribute("aria-valuenow"), "0");
  assert.equal(await score(page), "First try score 9");
  let nextRound;
  await answer(page, round, { beforeLast: async () => { nextRound = await seedNextGeneration(page, "Wizard", 202609299, seen); } });
  assert.equal(await score(page), "First try score 9");
  assert.equal(await page.getByRole("progressbar", { name: "Combo energy", exact: true }).getAttribute("aria-valuenow"), "0");
  await finishCorrect(page);
  await study(page, nextRound);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("heading", { name: "Here’s your chance at redemption.", exact: true }).waitFor();
  assert.match(await page.locator('[class*="resultScore"]').textContent(), /9\s*\/ 10 first try/);
  await page.getByRole("button", { name: "Retry missed", exact: true }).click();
  await answer(page, round, { keyboard: true });
  await finishCorrect(page);
  const results = page.getByRole("heading", { name: "Redemption complete.", exact: true });
  await results.waitFor();
  await assertFocused(results);
  assert.deepEqual(errors, []);
  await context.close();
});

test("study and correct-feedback durations count visible time and then advance without buttons", async () => {
  const { context, page, errors } = await open();
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  const round = CAMPAIGN_BY_LEVEL.Starter[0];
  await study(page, round);
  await advanceTime(page, 2_000);
  await visibility(page, true);
  await advanceTime(page, 20_000);
  await study(page, round);
  await visibility(page, false);
  await advanceTime(page, 1_900);
  await study(page, round);
  await advanceTime(page, 150);
  await choices(page).first().waitFor();
  await select(page, round, round.study, true);
  await assertCorrect(page, round);
  await advanceTime(page, 400);
  await visibility(page, true);
  await advanceTime(page, 20_000);
  await assertCorrect(page, round);
  await visibility(page, false);
  await advanceTime(page, 350);
  await assertCorrect(page, round);
  await advanceTime(page, 200);
  await study(page, CAMPAIGN_BY_LEVEL.Starter[1]);
  await page.getByRole("button", { name: /^Expert,/ }).click();
  const expert = CAMPAIGN_BY_LEVEL.Expert[0];
  await study(page, expert);
  await advanceTime(page, 4_000);
  await study(page, expert);
  await advanceTime(page, 8_000);
  await choices(page).first().waitFor();
  assert.equal(await choices(page).count(), 8, "Expert keeps its pictures visible for twelve seconds.");
  const wrong = [expert.options.find(id => !expert.study.includes(id)), ...expert.study.slice(1)];
  await select(page, expert, wrong);
  await wrongFeedback(page).waitFor();
  await advanceTime(page, 400);
  await visibility(page, true);
  await advanceTime(page, 20_000);
  assert.equal(await wrongFeedback(page).isVisible(), true);
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0);
  await visibility(page, false);
  await advanceTime(page, 350);
  assert.equal(await wrongFeedback(page).isVisible(), true);
  await advanceTime(page, 200);
  await study(page, expert);
  await advanceTime(page, 4_000);
  await study(page, expert);
  await advanceTime(page, 8_000);
  await choices(page).first().waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("automatic study and recall fit 820px, 620px, and 390px with shared picture sizes", async () => {
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
      await painted();
      await assertFits(page, `${width}px ${difficulty} study`);
      studySizes.set(width, await page.getByRole("region", { name: "Study pictures", exact: true }).locator("svg").first().evaluate(element => element.getBoundingClientRect().width));
    }
    await recall(page, round);
    for (const width of [390, 620, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await painted();
      await assertFits(page, `${width}px ${difficulty} recall`);
      const recallSize = await choices(page).first().locator("svg").evaluate(element => element.getBoundingClientRect().width);
      assert.ok(Math.abs(recallSize - studySizes.get(width)) < 1, `${width}px ${difficulty} shares the study (${studySizes.get(width)}) and recall (${recallSize}) object size`);
      if (width === 390) await page.screenshot({ path: resolve(shots, `${difficulty.toLowerCase()}-phone.png`), fullPage: true });
    }
    if (difficulty === "Wizard") assert.doesNotMatch(await page.locator('[class*="questionRow"]').textContent(), /\b3\b/, "Wizard keeps the target count hidden.");
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

test("Journey restores partial recall and wrong feedback, then auto-advances restored correct feedback once", async () => {
  const { fixture, attempt } = journeyFixture();
  const { context, page, errors } = await open({ width: 390, height: 844, fixture, query: `?progression=${attempt.id}` });
  const round = CAMPAIGN_BY_LEVEL.Junior[0];
  await study(page, round);
  assert.equal(await page.getByRole("button", { name: "Campaign", exact: true }).count(), 0);
  await page.evaluate(() => localStorage.setItem("picture-memory-recall-v1:another-profile", JSON.stringify({ playId: "other-round", recalling: true, token: "other-selection" })));
  await recall(page, round);
  await select(page, round, [round.study[0]], true);
  assert.equal(activeAttempt(await saved(page)).rounds[0].attemptCount, 0, "A partial selection is not an attempt.");
  await recallSaved(page, round, [round.study[0]]);
  await reload(page);
  await choices(page).first().waitFor();
  assert.equal(await page.getByRole("region", { name: "Study pictures", exact: true }).count(), 0, "Reload stays in partial recall without revealing targets.");
  assert.equal(await choices(page).nth(round.options.indexOf(round.study[0])).getAttribute("aria-pressed"), "true");
  assert.equal(await choices(page).nth(round.options.indexOf(round.study[1])).getAttribute("aria-pressed"), "false");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("picture-memory-recall-v1:another-profile"))), { playId: "other-round", recalling: true, token: "other-selection" });
  const extra = round.options.find(id => !round.study.includes(id));
  await select(page, round, [extra]);
  await wrongFeedback(page).waitFor();
  assert.equal(activeAttempt(await saved(page)).rounds[0].attemptCount, 1);
  await reload(page);
  await wrongFeedback(page).waitFor();
  assert.equal(activeAttempt(await saved(page)).rounds[0].attemptCount, 1, "Restoring feedback never resubmits the complete set.");
  await finishWrong(page, round);
  await recall(page, round);
  await select(page, round, [round.study[1]]);
  await recallSaved(page, round, [round.study[1]]);
  await reload(page);
  await choices(page).first().waitFor();
  assert.equal(await choices(page).nth(round.options.indexOf(round.study[1])).getAttribute("aria-pressed"), "true");
  await select(page, round, [round.study[0]], true);
  await assertCorrect(page, round);
  const solved = activeAttempt(await saved(page));
  assert.equal(solved.rounds[0].phase, "solved");
  assert.equal(solved.rounds[0].firstTryCorrect, false);
  assert.equal(solved.rounds[0].attemptCount, 2);
  await page.keyboard.press(String(round.options.indexOf(round.study[0]) + 1));
  assert.equal(activeAttempt(await saved(page)).rounds[0].attemptCount, 2, "A full set records one attempt while input is locked.");
  await reload(page);
  await assertCorrect(page, round);
  assert.deepEqual(activeAttempt(await saved(page)).rounds, solved.rounds);
  await advanceTime(page, 500);
  await assertCorrect(page, round);
  await advanceTime(page, 450);
  await study(page, CAMPAIGN_BY_LEVEL.Junior[1]);
  const advanced = activeAttempt(await saved(page));
  assert.equal(advanced.rounds[0].attemptCount, 2);
  assert.equal(advanced.rounds[1].attemptCount, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a restored complete selection auto-submits exactly once and remains recoverable", async () => {
  for (const correct of [true, false]) {
    const { fixture, attempt } = journeyFixture();
    const { context, page, errors } = await open({ fixture, query: `?progression=${attempt.id}` });
    const round = CAMPAIGN_BY_LEVEL.Junior[0];
    await recall(page, round);
    await select(page, round, [round.study[0]]);
    await recallSaved(page, round, [round.study[0]]);
    const selected = correct ? round.study : [round.study[0], round.options.find(id => !round.study.includes(id))];
    await page.evaluate(token => {
      const key = "picture-memory-recall-v1:picture-memory-browser-profile";
      const value = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...value, token }));
    }, encodeSelectionAnswerToken(selected, round.options));
    await reload(page);
    if (correct) await assertCorrect(page, round);
    else await wrongFeedback(page).waitFor();
    const restored = activeAttempt(await saved(page));
    assert.equal(restored.rounds[0].attemptCount, 1);
    assert.equal(restored.rounds[0].firstTryCorrect, correct);
    await reload(page);
    if (correct) {
      await assertCorrect(page, round);
      await finishCorrect(page);
      await study(page, CAMPAIGN_BY_LEVEL.Junior[1]);
    } else {
      await finishWrong(page, round);
    }
    assert.equal(activeAttempt(await saved(page)).rounds[0].attemptCount, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("Journey auto-completes questions and redemption but keeps the review checkpoint deliberate", async () => {
  const { fixture, attempt } = journeyFixture({ boardIndex: 0 });
  const { context, page, errors } = await open({ fixture, query: `?progression=${attempt.id}` });
  const rounds = CAMPAIGN_BY_LEVEL.Starter;
  await answer(page, rounds[0], { correct: false, keyboard: true });
  await answer(page, rounds[0], { keyboard: true });
  await finishCorrect(page);
  for (const round of rounds.slice(1)) {
    await answer(page, round, { keyboard: true });
    await finishCorrect(page);
  }
  await page.getByRole("heading", { name: "Here’s your chance at redemption.", exact: true }).waitFor();
  assert.equal(activeAttempt(await saved(page)).phase, "redemption-ready");
  await advanceTime(page, 10_000);
  assert.equal(activeAttempt(await saved(page)).phase, "redemption-ready", "Redemption starts only when the player chooses Review Mistakes.");
  await reload(page);
  await page.getByRole("button", { name: "Review Mistakes", exact: true }).click();
  await study(page, rounds[0]);
  assert.equal(activeAttempt(await saved(page)).redemption.queue.length, 1);
  await recall(page, rounds[0]);
  await select(page, rounds[0], rounds[0].study, true);
  await assertCorrect(page, rounds[0]);
  await finishCorrect(page, { allowNavigation: true });
  await page.waitForURL(new RegExp(`${base}/journey/summary/`));
  const finished = activeAttempt(await saved(page));
  assert.equal(finished.rounds.filter(round => round.firstTryCorrect).length, 11);
  assert.equal(finished.rounds[0].firstTryCorrect, false);
  assert.deepEqual(errors, []);
  await context.close();
});
