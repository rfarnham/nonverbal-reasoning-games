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
import { FIRST_WORLD_STORY } from '../../app/math-world/story-content.ts';
import { WORLD_STORY_STORAGE_KEY, WORLD_STORY_PLAYTEST_KEY } from '../../app/math-world/story-progress.ts';
import { VOYAGE_CHAPTERS, VOYAGE_STORY_GLOSSARY } from '../../app/math-world/voyage-story-content.ts';
import { QUESTIONS_BY_STOP, WORLD_DEFINITIONS, WORLD_MODE } from '../../app/math-world/world-data.ts';

const basePath = '/nonverbal-reasoning-games';
const outputRoot = resolve(fileURLToPath(new URL('../../out/', import.meta.url)));
const screenshots = resolve(fileURLToPath(new URL('../../outputs/oceania-story/', import.meta.url)));
const mathKey = WORLD_MODE === 'spiral-preview' ? 'spatial-gym-math-world-spiral-progress' : 'spatial-gym-math-world-progress';
const playtestMathKey = WORLD_MODE === 'spiral-preview' ? 'spatial-gym-math-world-spiral-playtest-progress' : 'spatial-gym-math-world-playtest-progress';
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
function completedFirstArchipelago(selectedWorldId = WORLD_DEFINITIONS[0].id) {
  const completedStopIds = [...WORLD_DEFINITIONS[0].stopIds];
  const stopAttempts = Object.fromEntries(completedStopIds.map((id, stopIndex) => {
    const questions = QUESTIONS_BY_STOP.get(id);
    return [id, {
      questionIndex: questions.length - 1,
      phase: 'correct',
      selectedIndex: questions.at(-1).correctIndex,
      firstTryCorrect: Object.fromEntries(questions.map((question, index) => [question.id, (index + stopIndex) % 3 !== 0])),
      solvedQuestionIds: questions.map(question => question.id),
    }];
  }));
  return { ...createInitialProgress(), selectedWorldId, completedStopIds, stopAttempts };
}

function afterSundering(readChapters = []) {
  return { version: 1, introSeen: true, readBooks: [0, 1], readEncounters: [], ending: 'complete', readChapters };
}

async function openFixture({ progress = completedFirstArchipelago(), story = afterSundering(), extras = {}, width = 1200, height = 900, reducedMotion = 'reduce', query = '' } = {}) {
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
  await page.locator('main[data-world-id]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-globe-renderer="loading"]'));
  assert.deepEqual(await saved(page, mathKey), progress, 'Hydration must preserve completed stops and first-attempt history.');
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

test('all shards, reforging, and space finale remain independent of a completed first-archipelago math save', async () => {
  const playtestStory = afterSundering([VOYAGE_CHAPTERS[9].id]);
  const { context, page, errors, progress } = await openFixture({ extras: { [WORLD_STORY_PLAYTEST_KEY]: playtestStory } });
  const mathBefore = await rawSaved(page, mathKey);
  const continueStory = page.locator('button[data-voyage-continue]');
  assert.equal(await continueStory.count(), 1);
  assert.equal(await page.locator('button[data-story-book-id]').count(), 2, 'The two original books remain on Counting Coast.');
  const storyBefore = await rawSaved(page, WORLD_STORY_STORAGE_KEY);
  await continueStory.click();
  await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  await page.keyboard.press('Escape');
  await storyDialog(page, VOYAGE_CHAPTERS[0]).waitFor({ state: 'detached' });
  assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), storyBefore, 'Escape is dismissal, not a reading acknowledgement.');
  await assertFocused(continueStory);
  await continueStory.click();
  await page.getByRole('button', { name: 'Close story', exact: true }).click();
  assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), storyBefore);
  await continueStory.click();
  const first = await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  await page.screenshot({ path: resolve(screenshots, 'first-shard-desktop.png'), fullPage: false });
  await first.getByRole('button', { name: /^Read on/ }).click();
  await chapterVisible(page, VOYAGE_CHAPTERS[1]);
  assert.deepEqual((await saved(page)).readChapters, [VOYAGE_CHAPTERS[0].id]);
  await page.keyboard.press('Escape');
  await page.reload();
  await continueStory.waitFor();
  assert.equal(await page.locator('dialog[data-story-page][open]').count(), 0, 'Reload resumes only when the reader chooses to continue.');
  await continueStory.click();
  for (let index = 1; index < VOYAGE_CHAPTERS.length; index++) {
    const chapter = VOYAGE_CHAPTERS[index];
    const dialog = await chapterVisible(page, chapter);
    assert.deepEqual((await saved(page)).readChapters, VOYAGE_CHAPTERS.slice(0, index).map(chapter => chapter.id));
    assert.equal(await rawSaved(page, mathKey), mathBefore, `Reading ${chapter.id} must leave math progress unchanged.`);
    if (chapter.illustration === 'reforging' || chapter.illustration === 'ascent') {
      const artwork = dialog.locator(`[data-voyage-artwork="${chapter.illustration}"]`);
      assert.equal(await artwork.getAttribute('data-sequence'), 'still', 'Reduced motion shows the meaningful final picture.');
      await page.screenshot({ path: resolve(screenshots, `${chapter.illustration}-desktop.png`), fullPage: false });
    }
    await dialog.getByRole('button', { name: index === VOYAGE_CHAPTERS.length - 1 ? /^Keep the light/ : /^Read on/ }).click();
  }
  await page.locator('dialog[data-story-page]').waitFor({ state: 'detached' });
  assert.deepEqual((await saved(page)).readChapters, VOYAGE_CHAPTERS.map(chapter => chapter.id));
  assert.deepEqual(await saved(page, mathKey), progress);
  assert.equal(await rawSaved(page, mathKey), mathBefore);
  assert.deepEqual(await saved(page, WORLD_STORY_PLAYTEST_KEY), playtestStory, 'Normal reading never overwrites playtest history.');
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

test('later island books are optional acknowledgements and do not move math progress or skip the first unread chapter', async () => {
  const { context, page, errors, progress } = await openFixture({ progress: completedFirstArchipelago(WORLD_DEFINITIONS[1].id), width: 390, height: 844 });
  const mathBefore = await rawSaved(page, mathKey);
  const book = page.locator('button[data-story-book-id]');
  assert.equal(await book.count(), 1, 'Later archipelagos show one authored optional book.');
  await book.click();
  const chapter = VOYAGE_CHAPTERS.find(chapter => chapter.shardWorld === 2);
  const dialog = await chapterVisible(page, chapter);
  await assertFits(page, 'phone island book');
  await page.screenshot({ path: resolve(screenshots, 'island-book-phone.png'), fullPage: false });
  await page.keyboard.press('Escape');
  assert.deepEqual((await saved(page)).readChapters, []);
  await assertFocused(book);
  await book.click();
  await dialog.getByRole('button', { name: /^Back to the map/ }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual((await saved(page)).readChapters, [chapter.id]);
  assert.equal(await rawSaved(page, mathKey), mathBefore);
  assert.deepEqual(await saved(page, mathKey), progress);
  await page.locator('button[data-voyage-continue]').click();
  await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('malformed reading ledgers sanitize unknown and premature finale flags, with normal and playtest saves separate', async () => {
  const malformedStory = afterSundering([null, VOYAGE_CHAPTERS[0].id, VOYAGE_CHAPTERS[0].id, 'unknown-chapter', 4, VOYAGE_CHAPTERS.at(-1).id, VOYAGE_CHAPTERS.at(-2).id]);
  const qaStory = afterSundering();
  const { context, page, errors } = await openFixture({ story: malformedStory, extras: { [WORLD_STORY_PLAYTEST_KEY]: qaStory, [playtestMathKey]: completedFirstArchipelago() } });
  await page.locator('button[data-voyage-continue]').click();
  const next = await chapterVisible(page, VOYAGE_CHAPTERS[1]);
  await next.getByRole('button', { name: /^Read on/ }).click();
  const normalStory = await rawSaved(page, WORLD_STORY_STORAGE_KEY);
  assert.deepEqual((await saved(page)).readChapters, [VOYAGE_CHAPTERS[0].id, VOYAGE_CHAPTERS[1].id]);
  assert.deepEqual(await saved(page, WORLD_STORY_PLAYTEST_KEY), qaStory);
  await page.goto(`${origin}${basePath}/math-world/?qa=1`);
  await page.locator('button[data-voyage-continue]').waitFor();
  await page.locator('button[data-voyage-continue]').click();
  const qaFirst = await chapterVisible(page, VOYAGE_CHAPTERS[0]);
  await qaFirst.getByRole('button', { name: /^Read on/ }).click();
  assert.deepEqual((await saved(page, WORLD_STORY_PLAYTEST_KEY)).readChapters, [VOYAGE_CHAPTERS[0].id]);
  assert.equal(await rawSaved(page, WORLD_STORY_STORAGE_KEY), normalStory, 'QA reading cannot rewrite the student’s story save.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('maritime and mythological glossary and the paused finale fit every supported breakpoint', async () => {
  const readShards = VOYAGE_CHAPTERS.filter(chapter => chapter.shardWorld !== undefined).map(chapter => chapter.id);
  for (const width of [390, 620, 820, 1200]) {
    const { context, page, errors } = await openFixture({ story: afterSundering(readShards), width, height: width === 390 ? 844 : 900, reducedMotion: 'no-preference', extras: { [sceneryKey]: 'true' } });
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
    const { context, page, errors } = await openFixture({ story: afterSundering(readChapters), reducedMotion: 'no-preference' });
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
