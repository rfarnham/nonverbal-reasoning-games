import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createInitialProgress } from '../../app/math-world/engine.ts';
import { BOSS_CHALLENGES } from '../../app/math-world/boss-challenges.ts';
import { createBossProgress, bossStorageKey, setBossAnswer, submitBossAnswers } from '../../app/math-world/boss-progress.ts';
import { DANGERS } from '../../app/math-world/danger-definitions.ts';
import { createDangerState, ensureDangerPacket, acknowledgeDangerBriefing, startDangerPacket, importLegacyDangerMisses, dangerPacketQuestions } from '../../app/math-world/danger-engine.ts';
import { dangerStorageKey, DANGER_GUEST_PROFILE_ID } from '../../app/math-world/danger-storage.ts';
import { FIRST_WORLD_STORY } from '../../app/math-world/story-content.ts';
import { WORLD_STORY_STORAGE_KEY, WORLD_STORY_PLAYTEST_KEY } from '../../app/math-world/story-progress.ts';
import { VOYAGE_CHAPTERS, VOYAGE_STORY_GLOSSARY } from '../../app/math-world/voyage-story-content.ts';
import { QUESTIONS_BY_STOP, WORLD_DEFINITIONS, WORLD_MODE } from '../../app/math-world/world-data.ts';

const basePath = '/nonverbal-reasoning-games';
const outputRoot = resolve(fileURLToPath(new URL('../../out/', import.meta.url)));
const screenshots = resolve(fileURLToPath(new URL('../../outputs/oceania-story/', import.meta.url)));
const mathKey = WORLD_MODE === 'spiral-preview' ? 'spatial-gym-math-world-spiral-progress' : 'spatial-gym-math-world-progress';
const playtestMathKey = WORLD_MODE === 'spiral-preview' ? 'spatial-gym-math-world-spiral-playtest-progress' : 'spatial-gym-math-world-playtest-progress';
const dangerKey = dangerStorageKey(DANGER_GUEST_PROFILE_ID, false);
const bossKey = bossStorageKey(DANGER_GUEST_PROFILE_ID, false);
const fixtureTime = '2026-10-12T12:00:00.000Z';
const sceneryKey = 'spatial-gym-math-world-scenery-paused';
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/x-component', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
let browser, server, origin;

before(async () => {
  assert.equal(WORLD_DEFINITIONS.length, 32, 'Build the 32-archipelago Worlds preview before running this suite.');
  await mkdir(screenshots, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (!pathname.startsWith(`${basePath}/`)) throw new Error('Outside base path');
      let filename = resolve(outputRoot, pathname.slice(basePath.length + 1));
      if (filename !== outputRoot && !filename.startsWith(`${outputRoot}${sep}`)) throw new Error('Outside export');
      if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html');
      response.writeHead(200, { 'content-type': contentTypes[extname(filename)] ?? 'application/octet-stream' }).end(await readFile(filename));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

// Every completed stop has a canonical solved prefix and final correct answer.
// Retained first-try misses make an accidental score/history rewrite observable.
function completedArchipelagos(count = 1, selectedWorldId = WORLD_DEFINITIONS[count - 1].id, includeMisses = true) {
  const completedStopIds = WORLD_DEFINITIONS.slice(0, count).flatMap(world => [...world.stopIds]);
  const stopAttempts = Object.fromEntries(completedStopIds.map((id, stopIndex) => {
    const questions = QUESTIONS_BY_STOP.get(id);
    return [id, {
      questionIndex: questions.length - 1,
      phase: 'correct',
      selectedIndex: questions.at(-1).correctIndex,
      firstTryCorrect: Object.fromEntries(questions.map((question, index) => [question.id, !includeMisses || (index + stopIndex) % 3 !== 0])),
      solvedQuestionIds: questions.map(question => question.id),
    }];
  }));
  return { ...createInitialProgress(), selectedWorldId, completedStopIds, stopAttempts };
}

function completedFirstArchipelago(selectedWorldId = WORLD_DEFINITIONS[0].id) {
  return completedArchipelagos(1, selectedWorldId);
}

function completedCrossings(throughWorld = 32) {
  let state = createDangerState(DANGER_GUEST_PROFILE_ID);
  for (const danger of DANGERS.filter(danger => danger.afterWorld <= throughWorld)) {
    state = ensureDangerPacket(state, { dangerId: danger.id, afterWorldNumber: danger.afterWorld, now: fixtureTime });
    state = acknowledgeDangerBriefing(state, danger.id);
    state = startDangerPacket(state, danger.id, fixtureTime);
  }
  return state;
}

function submittedStorms(throughWorld = 32) {
  let state = createBossProgress(DANGER_GUEST_PROFILE_ID);
  for (const boss of BOSS_CHALLENGES.filter(boss => boss.afterWorld <= throughWorld)) {
    for (let index = 0; index < boss.questionCount; index++) state = setBossAnswer(state, boss.id, index, index % 5);
    state = submitBossAnswers(state, boss.id, fixtureTime);
  }
  return state;
}

function completedVoyageFixture(story = afterSundering()) {
  return { progress: completedArchipelagos(32), story,
    extras: { [dangerKey]: completedCrossings(), [bossKey]: submittedStorms() } };
}

function afterSundering(readChapters = []) {
  return { version: 1, introSeen: true, readBooks: [0, 1], readEncounters: [], ending: 'complete', readChapters };
}

async function openFixture({ progress = completedFirstArchipelago(), story = afterSundering(), extras = {}, width = 1200, height = 900, reducedMotion = 'reduce', query = '', expectProgress = progress } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  // The existing Worlds playtest gate is outside this story regression suite.
  await context.addCookies([{ name: 'spatial-gym-worlds-access', value: 'playtest-v1', url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(values => {
    // Story artwork uses SVG. Exercise the supported static map on this GPU-less
    // runner, avoiding the unrelated globe's expensive software WebGL shaders.
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
    };
    // Seed once, so reload tests exercise the actual persisted reading ledger.
    if (sessionStorage.getItem('oceania-story-browser-fixture')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    sessionStorage.setItem('oceania-story-browser-fixture', 'seeded');
  }, { [mathKey]: progress, [WORLD_STORY_STORAGE_KEY]: story, ...extras });
  await page.goto(`${origin}${basePath}/math-world/${query}`);
  await page.locator('main[data-world-id], main[data-danger-id], main[data-boss-id], main:has([aria-label="Stop progress"])').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-globe-renderer="loading"]'));
  if (expectProgress) assert.deepEqual(await saved(page, mathKey), expectProgress, 'Hydration must preserve completed stops and first-attempt history.');
  return { context, page, errors, progress };
}

async function rawSaved(page, key) { return page.evaluate(key => localStorage.getItem(key), key); }
async function saved(page, key = WORLD_STORY_STORAGE_KEY) { return JSON.parse(await rawSaved(page, key)); }
function storyDialog(page, chapter) { return page.locator(`dialog[data-story-page="${chapter.id}"][open]`); }
async function assertFocused(locator, message = 'Closing reading returns keyboard focus to its opener.') {
  // Restoration intentionally runs on the next frame after removing inert UI.
  const focused = await locator.evaluate(element => new Promise(resolve => {
    const deadline = performance.now() + 2000;
    const check = () => {
      if (element === document.activeElement) resolve(true);
      else if (performance.now() >= deadline) resolve(false);
      else requestAnimationFrame(check);
    };
    check();
  }));
  assert.equal(focused, true, message);
}
async function chapterVisible(page, chapter) {
  const dialog = storyDialog(page, chapter);
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('heading', { name: chapter.title, exact: true }).count(), 1);
  for (const paragraph of chapter.paragraphs) assert.equal(await dialog.getByText(paragraph, { exact: true }).count(), 1);
  await assertFocused(dialog.getByRole('heading'), 'Opening a chapter moves keyboard focus to its title.');
  return dialog;
}

async function assertFits(page, label) {
  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    const rect = dialog?.getBoundingClientRect();
    return {
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      dialogFits: !rect || (rect.left >= 0 && rect.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth + 1),
      targets: dialog ? [...dialog.querySelectorAll('button')].filter(button => !button.disabled).map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) : [],
    };
  });
  assert.equal(metrics.pageFits, true, `${label}: page must not scroll horizontally`);
  assert.equal(metrics.dialogFits, true, `${label}: reading content must fit the dialog`);
  for (const target of metrics.targets) assert.ok(target.width >= 44 && target.height >= 44, `${label}: buttons need 44px targets`);
}

async function readReplayIds(page) {
  await page.getByRole('button', { name: 'Story so far', exact: true }).click();
  const dialog = page.locator('dialog[data-voyage-library="story"][open]');
  await dialog.waitFor();
  const ids = [];
  const next = dialog.getByRole('button', { name: 'Next page', exact: true });
  while (await next.isEnabled()) {
    await next.click();
    ids.push(await dialog.locator('[data-story-replay-page]').getAttribute('data-story-replay-page'));
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  return ids;
}

async function assertStoryGateClosed(page, nextChapter) {
  const continuation = page.locator('button[data-voyage-continue]');
  assert.ok(await continuation.count() === 0 || !(await continuation.isEnabled()), 'There is no enabled continue-story action before its prerequisites.');
  assert.equal(await page.getByText(nextChapter.title, { exact: true }).count(), 0, 'Locked chapter titles do not leak through the reader or map books.');
}

test('finishing only Counting Coast unlocks one chapter and closes the reader at the next archipelago gate', async () => {
  const { context, page, errors, progress } = await openFixture();
  const mathBefore = await rawSaved(page, mathKey);
  const continueStory = page.locator('button[data-voyage-continue]');
  assert.equal(await page.locator('button[data-story-book-id]').count(), 2, 'The two original books remain on Counting Coast.');
  const storyBefore = await rawSaved(page, WORLD_STORY_STORAGE_KEY);
  await continueStory.click();
  await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  await page.keyboard.press('Escape');
  await storyDialog(page, VOYAGE_CHAPTERS[0]).waitFor({ state: 'detached' });
  assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), storyBefore, 'Dismissal does not acknowledge a chapter.');
  await assertFocused(continueStory);
  await continueStory.click();
  const first = await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  await page.screenshot({ path: resolve(screenshots, 'first-shard-gated-desktop.png'), fullPage: false });
  await first.getByRole('button', { name: /^(Read on|Back to the map)/ }).click();
  await first.waitFor({ state: 'detached' });
  assert.deepEqual((await saved(page)).readChapters, [VOYAGE_CHAPTERS[0].id]);
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  await page.locator('aside[aria-label="Voyage library"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(screenshots, 'story-gate-desktop.png'), fullPage: false });
  assert.deepEqual((await readReplayIds(page)).filter(id => id.startsWith('oceania-voyage')), [VOYAGE_CHAPTERS[0].id]);
  await page.reload();
  await page.locator('main[data-world-id]').waitFor();
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  assert.equal(await rawSaved(page, mathKey), mathBefore);
  assert.deepEqual(await saved(page, mathKey), progress);
  assert.deepEqual(errors, []);
  await context.close();
});

test('all chapters and both finales unlock after every prerequisite and reading never rewrites workbook history', async () => {
  const playtestStory = afterSundering([VOYAGE_CHAPTERS[9].id]);
  const fixture = completedVoyageFixture();
  fixture.extras[WORLD_STORY_PLAYTEST_KEY] = playtestStory;
  const { context, page, errors, progress } = await openFixture(fixture);
  const mathBefore = await rawSaved(page, mathKey);
  const bossesBefore = await rawSaved(page, bossKey);
  const dangersBefore = await rawSaved(page, dangerKey);
  const continueStory = page.locator('button[data-voyage-continue]');
  await continueStory.click();
  for (let index = 0; index < VOYAGE_CHAPTERS.length; index++) {
    const chapter = VOYAGE_CHAPTERS[index];
    const dialog = await chapterVisible(page, chapter);
    assert.deepEqual((await saved(page)).readChapters, VOYAGE_CHAPTERS.slice(0, index).map(chapter => chapter.id));
    if (chapter.illustration === 'reforging' || chapter.illustration === 'ascent') {
      assert.equal(await dialog.locator(`[data-voyage-artwork="${chapter.illustration}"]`).getAttribute('data-sequence'), 'still');
    }
    await dialog.getByRole('button', { name: index === VOYAGE_CHAPTERS.length - 1 ? /^Keep the light/ : /^Read on/ }).click();
  }
  await page.locator('dialog[data-story-page]').waitFor({ state: 'detached' });
  assert.deepEqual((await saved(page)).readChapters, VOYAGE_CHAPTERS.map(chapter => chapter.id));
  assert.deepEqual(await saved(page, mathKey), progress);
  assert.equal(await rawSaved(page, mathKey), mathBefore);
  assert.equal(await rawSaved(page, bossKey), bossesBefore);
  assert.equal(await rawSaved(page, dangerKey), dangersBefore);
  assert.deepEqual(await saved(page, WORLD_STORY_PLAYTEST_KEY), playtestStory);
  await assertFocused(continueStory);
  await page.reload();
  await continueStory.waitFor();
  assert.match(await continueStory.textContent(), /Revisit the voyage/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the welcome and both original books remain unchanged before the sundering', async () => {
  assert.equal(createHash('sha256').update(JSON.stringify([FIRST_WORLD_STORY.intro, FIRST_WORLD_STORY.book1, FIRST_WORLD_STORY.book2])).digest('hex'), '1e3843ad41d3668064ef2926be95b0cf898714e63f8939b27f270d2675196d92', 'Preserve the opening already experienced by the student.');
  const progress = createInitialProgress();
  const story = { version: 1, introSeen: false, readBooks: [], readEncounters: [], ending: 'unseen', readChapters: VOYAGE_CHAPTERS.map(chapter => chapter.id) };
  const { context, page, errors } = await openFixture({ progress, story });
  const welcome = await chapterVisible(page, FIRST_WORLD_STORY.intro);
  assert.equal(await page.locator('button[data-voyage-continue]').count(), 0);
  assert.equal(await welcome.getByRole('button', { name: 'Close story', exact: true }).count(), 0, 'The original welcome flow stays intact.');
  await welcome.getByRole('button', { name: /^Begin exploring/ }).click();
  if (await page.locator('[data-globe-phase="overview"][data-globe-renderer="webgl"]').count()) await page.getByRole('button', { name: `Explore ${WORLD_DEFINITIONS[0].title}`, exact: false }).click();
  const books = page.locator('button[data-story-book-id]');
  assert.equal(await books.count(), 2);
  for (let index = 0; index < 2; index++) {
    await books.nth(index).click();
    const book = await chapterVisible(page, index === 0 ? FIRST_WORLD_STORY.book1 : FIRST_WORLD_STORY.book2);
    await book.getByRole('button', { name: /^Back to the map/ }).click();
  }
  assert.equal(await page.locator('button[data-voyage-continue]').count(), 0);
  await page.getByRole('button', { name: /Glossary/, exact: false }).click();
  const glossary = page.locator('dialog[data-voyage-library="glossary"][open]');
  await glossary.waitFor();
  assert.equal(await glossary.locator('dt').count(), 18, 'The glossary before the sundering keeps its original entries.');
  assert.equal(await glossary.getByText('Cyclops', { exact: true }).count(), 0);
  assert.equal(await glossary.getByText('Sundering', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(await saved(page, mathKey), progress);
  assert.deepEqual(errors, []);
  await context.close();
});

test('an island book unlocks only after its final stop, including the final answer submission', async () => {
  const finalStop = WORLD_DEFINITIONS[1].stopIds.at(-1);
  const complete = completedArchipelagos(2);
  const progress = { ...complete, completedStopIds: complete.completedStopIds.filter(id => id !== finalStop) };
  const story = afterSundering([VOYAGE_CHAPTERS[0].id]);
  const { context, page, errors } = await openFixture({ progress, story, width: 390, height: 844 });
  assert.equal(await page.locator('button[data-story-book-id]').count(), 0, 'Unfinished island has no readable future chapter.');
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  await page.getByText('Explore the island stops', { exact: true }).click();
  await page.locator('details ol button[aria-current="step"]').click();
  await page.getByRole('button', { name: /^Finish stop/ }).click();
  await page.locator('main[data-world-id]').waitFor();
  const book = page.locator('button[data-story-book-id]');
  assert.equal(await book.count(), 1, 'Completing the final stop unlocks the island chapter.');
  await book.click();
  const dialog = await chapterVisible(page, VOYAGE_CHAPTERS[1]);
  await assertFits(page, 'phone unlocked island book');
  await page.screenshot({ path: resolve(screenshots, 'island-book-gated-phone.png'), fullPage: false });
  await dialog.getByRole('button', { name: /^Back to the map/ }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual((await saved(page)).readChapters, VOYAGE_CHAPTERS.slice(0, 2).map(chapter => chapter.id));
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[2]);
  await page.locator('aside[aria-label="Voyage library"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(screenshots, 'story-gate-phone.png'), fullPage: false });
  const completed = await saved(page, mathKey);
  assert.ok(completed.completedStopIds.includes(finalStop));
  assert.deepEqual(completed.stopAttempts, progress.stopAttempts, 'Finishing the stop preserves its recorded first attempts.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('old unrestricted read flags cannot reveal locked chapters through replay, map books, continuation, or reload', async () => {
  const readAll = afterSundering(VOYAGE_CHAPTERS.map(chapter => chapter.id));
  const { context, page, errors } = await openFixture({ progress: completedFirstArchipelago(WORLD_DEFINITIONS[1].id), story: readAll });
  const storyBefore = await rawSaved(page, WORLD_STORY_STORAGE_KEY);
  assert.equal(await page.locator('button[data-story-book-id]').count(), 0);
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  assert.deepEqual((await readReplayIds(page)).filter(id => id.startsWith('oceania-voyage')), [VOYAGE_CHAPTERS[0].id]);
  await page.reload();
  await page.locator('main[data-world-id]').waitFor();
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), storyBefore, 'Gate filtering retains the earlier reading ledger.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('malformed ledgers remain gated and normal reading is separate from playtest progress', async () => {
  const malformed = afterSundering([null, VOYAGE_CHAPTERS[0].id, VOYAGE_CHAPTERS[0].id, 'unknown-chapter', 4, ...VOYAGE_CHAPTERS.slice(-2).map(chapter => chapter.id)]);
  const qaStory = afterSundering();
  const { context, page, errors } = await openFixture({ story: malformed, extras: { [WORLD_STORY_PLAYTEST_KEY]: qaStory, [playtestMathKey]: completedFirstArchipelago() } });
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  const normalStory = await rawSaved(page, WORLD_STORY_STORAGE_KEY);
  await page.goto(`${origin}${basePath}/math-world/?qa=1`);
  const continuation = page.locator('button[data-voyage-continue]');
  await continuation.waitFor();
  await continuation.click();
  const qaFirst = await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  await qaFirst.getByRole('button', { name: /^(Read on|Back to the map)/ }).click();
  await qaFirst.waitFor({ state: 'detached' });
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[1]);
  assert.deepEqual((await saved(page, WORLD_STORY_PLAYTEST_KEY)).readChapters, [VOYAGE_CHAPTERS[0].id]);
  assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), normalStory);
  assert.deepEqual(errors, []);
  await context.close();
});

test('maritime and mythological glossary and the paused finale fit every supported breakpoint', async () => {
  const readShards = VOYAGE_CHAPTERS.filter(chapter => chapter.shardWorld !== undefined).map(chapter => chapter.id);
  for (const width of [390, 620, 820, 1200]) {
    const { context, page, errors } = await openFixture({ ...completedVoyageFixture(afterSundering(readShards)), width, height: width === 390 ? 844 : 900, reducedMotion: 'no-preference', extras: { ...completedVoyageFixture().extras, [sceneryKey]: 'true' } });
    const mathBefore = await rawSaved(page, mathKey);
    const glossaryButton = page.getByRole('button', { name: /Glossary/, exact: false });
    await glossaryButton.click();
    const glossary = page.locator('dialog[data-voyage-library="glossary"][open]');
    await glossary.waitFor();
    for (const entry of VOYAGE_STORY_GLOSSARY) {
      assert.equal(await glossary.locator('dt').filter({ hasText: new RegExp(`^${entry.term}$`) }).count(), 1);
      assert.equal(await glossary.getByText(entry.definition, { exact: true }).count(), 1);
    }
    for (const term of ['Rigging', 'Tiller', 'Cyclops', 'Aeolus']) assert.equal(await glossary.getByText(term, { exact: true }).count(), 1);
    await assertFits(page, `${width}px glossary`);
    if (width === 390 || width === 1200) await page.screenshot({ path: resolve(screenshots, `glossary-${width}.png`), fullPage: false });
    await page.keyboard.press('Escape');
    await glossary.waitFor({ state: 'detached' });
    await assertFocused(glossaryButton);
    await page.locator('button[data-voyage-continue]').click();
    for (const chapter of VOYAGE_CHAPTERS.slice(-2)) {
      const dialog = await chapterVisible(page, chapter);
      const artwork = dialog.locator(`[data-voyage-artwork="${chapter.illustration}"]`);
      assert.equal(await artwork.getAttribute('data-sequence'), 'still');
      const finalPicture = await artwork.innerHTML();
      await assertFits(page, `${width}px ${chapter.illustration}`);
      await page.screenshot({ path: resolve(screenshots, `${chapter.illustration}-${width}.png`), fullPage: false });
      assert.equal(await artwork.innerHTML(), finalPicture, 'Remembered Pause scenery preserves the final visual state.');
      await dialog.getByRole('button', { name: chapter.illustration === 'ascent' ? /^Keep the light/ : /^Read on/ }).click();
    }
    assert.equal(await rawSaved(page, mathKey), mathBefore);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('turning on reduced motion settles each active finale to its final picture without changing reading or math progress', async () => {
  const readShards = VOYAGE_CHAPTERS.filter(chapter => chapter.shardWorld !== undefined).map(chapter => chapter.id);
  const [reforging, ascent] = VOYAGE_CHAPTERS.slice(-2);
  for (const chapter of [reforging, ascent]) {
    const readChapters = chapter === ascent ? [...readShards, reforging.id] : readShards;
    const { context, page, errors } = await openFixture({ ...completedVoyageFixture(afterSundering(readChapters)), reducedMotion: 'no-preference' });
    const mathBefore = await rawSaved(page, mathKey);
    const storyBefore = await rawSaved(page, WORLD_STORY_STORAGE_KEY);
    await page.locator('button[data-voyage-continue]').click();
    const dialog = await chapterVisible(page, chapter);
    const artwork = dialog.locator(`[data-voyage-artwork="${chapter.illustration}"]`);
    await dialog.locator(`[data-voyage-artwork="${chapter.illustration}"][data-sequence="playing"]`).waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await dialog.locator(`[data-voyage-artwork="${chapter.illustration}"][data-sequence="still"]`).waitFor({ timeout: 2000 });
    if (chapter === reforging) {
      assert.equal(await artwork.locator('[data-reforged-heart]').getAttribute('opacity'), '1');
      assert.ok((await artwork.locator('[data-tide-shard]').evaluateAll(shards => shards.map(shard => Number(shard.getAttribute('opacity'))))).every(opacity => opacity < 0.00001));
    } else {
      assert.equal(await artwork.locator('[data-blue-signal]').getAttribute('opacity'), '1');
      assert.equal(await artwork.locator('[data-rising-ship]').getAttribute('transform'), 'translate(320 97) scale(1)');
    }
    assert.equal(await rawSaved(page, mathKey), mathBefore);
    assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), storyBefore);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a storm stays active through printing and answer drafts until all 24 workbook answers are deliberately submitted', async () => {
  const boss = BOSS_CHALLENGES[0];
  const story = { ...afterSundering(VOYAGE_CHAPTERS.slice(0, 15).map(chapter => chapter.id)), readEncounters: [boss.id] };
  const { context, page, errors } = await openFixture({ progress: completedArchipelagos(16), story,
    extras: { [dangerKey]: completedCrossings(16) }, width: 390, height: 844, query: `?boss=${boss.id}` });
  const mathBefore = await rawSaved(page, mathKey);
  const sheet = page.locator(`[data-storm-answer-sheet="${boss.id}"]`);
  await sheet.waitFor();
  const submit = sheet.getByRole('button', { name: 'Submit workbook answers', exact: true });
  const world17 = page.locator(`select[aria-label="Choose a world"] option[value="${WORLD_DEFINITIONS[16].id}"]`);
  const stormPin = page.locator(`[data-globe-destination="${boss.id}"]`);
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await world17.evaluate(option => option.disabled), true, await world17.evaluate(option => option.outerHTML));
  assert.equal(await stormPin.getAttribute('data-storm-strength'), '1');
  await assertStoryGateClosed(page, VOYAGE_CHAPTERS[15]);
  await page.evaluate(() => {
    const open = window.open;
    window.open = function (...args) {
      const popup = open.apply(this, args);
      if (popup) popup.print = () => {};
      return popup;
    };
  });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: `Print whole ${boss.year} test workbook`, exact: true }).click();
  const popup = await popupPromise;
  await popup.locator('body[data-print-ready="true"]').waitFor();
  await popup.close();
  assert.equal(await world17.evaluate(option => option.disabled), true, 'Printing alone does not clear a storm.');
  assert.equal(await stormPin.getAttribute('data-storm-strength'), '1');
  assert.equal((await saved(page, bossKey))?.attempts[boss.id]?.submittedAt, undefined);
  for (let index = 0; index < 4; index++) await sheet.getByRole('radio', { name: `Question ${index + 1}, ${'ABCDE'[index % 5]}`, exact: true }).check();
  const draft = await saved(page, bossKey);
  assert.deepEqual(draft.attempts[boss.id].answers.slice(0, 4), [0, 1, 2, 3]);
  assert.equal(draft.attempts[boss.id].submittedAt, undefined);
  assert.equal(await submit.isDisabled(), true);
  await page.reload();
  await sheet.waitFor();
  for (let index = 0; index < 4; index++) assert.equal(await sheet.getByRole('radio', { name: `Question ${index + 1}, ${'ABCDE'[index % 5]}`, exact: true }).isChecked(), true, 'Draft answers survive a hard refresh.');
  for (let index = 4; index < boss.questionCount; index++) await sheet.getByRole('radio', { name: `Question ${index + 1}, ${'ABCDE'[index % 5]}`, exact: true }).check();
  assert.equal(await submit.isEnabled(), true);
  assert.equal(await world17.evaluate(option => option.disabled), true, 'Filling every field still requires an explicit submission.');
  assert.equal(await stormPin.getAttribute('data-storm-strength'), '1');
  assert.equal((await saved(page, bossKey)).attempts[boss.id].submittedAt, undefined);
  const dimensions = await sheet.locator('label').evaluateAll(labels => labels.map(label => ({ width: label.getBoundingClientRect().width, height: label.getBoundingClientRect().height })));
  assert.ok(dimensions.every(({ width, height }) => width >= 44 && height >= 44), 'Every A–E answer target fits a finger on a phone.');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await sheet.getByRole('heading', { name: 'Chart a safe course', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(screenshots, 'storm-answer-sheet-phone.png'), fullPage: false });
  await submit.click();
  await sheet.getByRole('heading', { name: 'Safe course charted', exact: true }).waitFor();
  assert.ok((await saved(page, bossKey)).attempts[boss.id].submittedAt);
  assert.equal(await world17.evaluate(option => !option.disabled), true);
  assert.equal(await stormPin.getAttribute('data-storm-strength'), '0');
  assert.equal(await sheet.getByRole('radio').first().isDisabled(), true, 'Submitted workbook history is read-only.');
  assert.equal(await rawSaved(page, mathKey), mathBefore);
  await page.locator('button[data-voyage-continue]').click();
  const stormChapter = await chapterVisible(page, VOYAGE_CHAPTERS[15]);
  await stormChapter.getByRole('button', { name: /^(Read on|Back to the map)/ }).click();
  await stormChapter.waitFor({ state: 'detached' });
  await page.reload();
  await sheet.getByRole('heading', { name: 'Safe course charted', exact: true }).waitFor();
  assert.equal(await stormPin.getAttribute('data-storm-strength'), '0');
  assert.equal(await world17.evaluate(option => !option.disabled), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a saved later archipelago cannot bypass an unsubmitted earlier storm on reload or via a deep link', async () => {
  const boss = BOSS_CHALLENGES[0];
  const progress = completedArchipelagos(17);
  const story = { ...afterSundering(VOYAGE_CHAPTERS.map(chapter => chapter.id)), readEncounters: [boss.id] };
  const { context, page, errors } = await openFixture({ progress, story, extras: { [dangerKey]: completedCrossings(16) }, expectProgress: null });
  await page.locator(`main[data-boss-id="${boss.id}"]`).waitFor();
  assert.equal(await page.locator(`select option[value="${WORLD_DEFINITIONS[16].id}"]`).evaluate(option => option.disabled), true);
  const after = await saved(page, mathKey);
  assert.deepEqual(after.completedStopIds, progress.completedStopIds);
  assert.deepEqual(after.stopAttempts, progress.stopAttempts);
  assert.deepEqual((await readReplayIds(page)).filter(id => id.startsWith('oceania-voyage')), VOYAGE_CHAPTERS.slice(0, 15).map(chapter => chapter.id));
  await page.goto(`${origin}${basePath}/math-world/?danger=danger-18`);
  await page.locator(`main[data-boss-id="${boss.id}"]`).waitFor();
  assert.equal(await page.locator('main[data-danger-id="danger-18"]').count(), 0);
  await page.goto(`${origin}${basePath}/math-world/?boss=boss-2026`);
  await page.locator(`main[data-boss-id="${boss.id}"]`).waitFor();
  assert.equal(await page.locator('main[data-boss-id="boss-2026"]').count(), 0);
  assert.equal(await page.locator(`select option[value="${WORLD_DEFINITIONS[16].id}"]`).evaluate(option => option.disabled), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a danger requires submitted answers, retains a partial crossing on reload, and cannot be bypassed by saved later progress', async () => {
  const danger = DANGERS[0];
  const progress = { ...completedArchipelagos(3, WORLD_DEFINITIONS[2].id, false), activeStopId: WORLD_DEFINITIONS[2].stopIds[0] };
  const missedStop = WORLD_DEFINITIONS[0].stopIds[0];
  const missedQuestion = QUESTIONS_BY_STOP.get(missedStop)[0];
  progress.stopAttempts[missedStop].firstTryCorrect[missedQuestion.id] = false;
  let dangers = importLegacyDangerMisses(createDangerState(DANGER_GUEST_PROFILE_ID), progress, fixtureTime);
  dangers = ensureDangerPacket(dangers, { dangerId: danger.id, afterWorldNumber: danger.afterWorld, normalGroupSize: 1, now: fixtureTime });
  dangers = acknowledgeDangerBriefing(dangers, danger.id);
  assert.equal(dangers.packets[danger.id].questionIds.length, 1, 'A single recorded miss produces one stable review question for this fixture.');
  const question = dangerPacketQuestions(dangers.packets[danger.id])[0];
  const story = { ...afterSundering(VOYAGE_CHAPTERS.map(chapter => chapter.id)), readEncounters: [danger.id] };
  const { context, page, errors } = await openFixture({ progress, story, extras: { [dangerKey]: dangers }, expectProgress: null, width: 390, height: 844 });
  const world3 = page.locator(`select option[value="${WORLD_DEFINITIONS[2].id}"]`);
  await page.locator(`main[data-danger-id="${danger.id}"]`).waitFor();
  assert.equal((await saved(page, mathKey)).activeStopId, null, 'A stale active stop behind the encounter cannot reopen its practice screen.');
  assert.equal(await world3.evaluate(option => option.disabled), true, await world3.evaluate(option => option.outerHTML));
  assert.deepEqual((await readReplayIds(page)).filter(id => id.startsWith('oceania-voyage')), VOYAGE_CHAPTERS.slice(0, 2).map(chapter => chapter.id));
  assert.equal((await saved(page, dangerKey)).packets[danger.id].completedAt, null);
  await page.locator('section[aria-label="Danger actions"]').getByRole('button', { name: /^(Enter danger crossing|Enter workbook answers)/ }).click();
  await page.locator('[aria-label="Answer choices"]').waitFor();
  await page.locator('[aria-label="Answer choices"] button').nth((question.correctIndex + 1) % question.choices.length).click();
  assert.equal((await saved(page, dangerKey)).packets[danger.id].completedAt, null);
  await page.reload();
  await page.locator('section[aria-label="Danger actions"]').getByRole('button', { name: /^(Resume crossing|Enter workbook answers)/ }).click();
  const correct = page.locator('[aria-label="Answer choices"] button').nth(question.correctIndex);
  await correct.click();
  assert.equal((await saved(page, dangerKey)).packets[danger.id].completedAt, null, 'A solved answer still awaits the final completion action.');
  await page.getByRole('button', { name: /^(Finish stop|Finish crossing|Submit)/ }).click();
  await page.locator(`main[data-danger-id="${danger.id}"]`).waitFor();
  assert.ok((await saved(page, dangerKey)).packets[danger.id].completedAt);
  assert.equal(await world3.evaluate(option => !option.disabled), true);
  assert.equal((await saved(page, dangerKey)).packets[danger.id].attempt.firstTryCorrect[question.id], false, 'Retry preserves the first-answer history.');
  await page.reload();
  await page.locator(`main[data-danger-id="${danger.id}"]`).waitFor();
  assert.equal(await world3.evaluate(option => !option.disabled), true);
  const mathAfter = await saved(page, mathKey);
  assert.deepEqual(mathAfter.completedStopIds, progress.completedStopIds);
  assert.deepEqual(mathAfter.stopAttempts, progress.stopAttempts);
  assert.deepEqual(errors, []);
  await context.close();
});

test('submitting a storm in one tab makes the other tab read-only and preserves the submitted answer history', async () => {
  const boss = BOSS_CHALLENGES[0];
  let draft = createBossProgress(DANGER_GUEST_PROFILE_ID);
  for (let index = 0; index < boss.questionCount; index++) draft = setBossAnswer(draft, boss.id, index, index % 5);
  const story = { ...afterSundering(), readEncounters: [boss.id] };
  const { context, page, errors } = await openFixture({ progress: completedArchipelagos(16), story,
    extras: { [dangerKey]: completedCrossings(16), [bossKey]: draft }, query: `?boss=${boss.id}` });
  const other = await context.newPage();
  other.on('pageerror', error => errors.push(error.message));
  other.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await other.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await other.goto(`${origin}${basePath}/math-world/?boss=${boss.id}`);
  const secondSheet = other.locator(`[data-storm-answer-sheet="${boss.id}"]`);
  await secondSheet.getByRole('button', { name: 'Submit workbook answers', exact: true }).waitFor();
  await page.locator(`[data-storm-answer-sheet="${boss.id}"]`).getByRole('button', { name: 'Submit workbook answers', exact: true }).click();
  await page.getByRole('heading', { name: 'Safe course charted', exact: true }).waitFor();
  const submitted = await rawSaved(page, bossKey);
  await secondSheet.getByRole('heading', { name: 'Safe course charted', exact: true }).waitFor();
  assert.equal(await secondSheet.getByRole('radio').first().isDisabled(), true);
  await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  await other.reload();
  await secondSheet.getByRole('heading', { name: 'Safe course charted', exact: true }).waitFor();
  assert.equal(await rawSaved(other, bossKey), submitted);
  assert.equal(await other.locator(`select option[value="${WORLD_DEFINITIONS[16].id}"]`).evaluate(option => !option.disabled), true);
  assert.deepEqual(errors, []);
  await context.close();
});
