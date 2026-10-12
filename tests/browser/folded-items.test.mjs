import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import {
  ROUNDS, describeAnswer, describeItem, foldDirectionLabel, generateInfiniteRound, roundFingerprint,
} from '../../app/games/folded-items/game-engine.ts';
import { progressionAdapter } from '../../app/games/folded-items/progression-adapter.ts';
import { journeyReviews } from '../../lib/journey-reviews.ts';
import {
  PROGRESSION_STORAGE_KEY, addPlayerProfile, buildJourneyPlan,
  createNormalProgressionAttempt, createPlayerProfile, createProgressionState,
  journeyQuestionReferences, saveProgressionState, upsertProfileAttempt,
} from '../../lib/progression/index.ts';

const base = '/nonverbal-reasoning-games';
const route = `${base}/games/folded-items/`;
const shots = resolve(fileURLToPath(new URL('../../outputs/folded-items/', import.meta.url)));
const root = resolve(fileURLToPath(new URL('../../out/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/x-component', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
let server, browser, origin;

before(async () => {
  await mkdir(shots, { recursive: true });
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (!pathname.startsWith(`${base}/`)) throw new Error('Unsupported path');
      let file = resolve(root, pathname.slice(base.length + 1));
      if (file !== root && !file.startsWith(root + sep)) throw new Error('Unsupported path');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
});

function levelRounds(difficulty) { return ROUNDS.filter(round => round.difficulty === difficulty); }
function choices(page) { return page.locator('button[aria-keyshortcuts]'); }
async function assertFocused(locator) {
  await locator.page().waitForFunction(element => element === document.activeElement, await locator.elementHandle());
  assert.equal(await locator.evaluate(element => element === document.activeElement), true);
}
async function open({ width = 1200, height = 900, fixture, query = '', reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  if (fixture) await context.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: PROGRESSION_STORAGE_KEY, value: fixture });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin + route + query);
  await page.getByRole('link', { name: /^(All games|Journey map)$/ }).first().waitFor();
  return { context, page, errors };
}
async function waitForRound(page, round) {
  await choices(page).first().waitFor();
  assert.equal(await choices(page).count(), 4);
  for (let index = 0; index < 4; index++) {
    assert.equal(await choices(page).nth(index).getAttribute('aria-keyshortcuts'), String(index + 1));
    assert.equal(await choices(page).nth(index).getAttribute('aria-label'), `Option ${index + 1}${round.answerMode === 'ordered' ? ', top to bottom' : ''}: ${describeAnswer(round, round.options[index], round.optionOrientations[index])}`);
  }
  await assertFocused(choices(page).first());
}
async function answer(page, round, { correct = true, keyboard = false, reloadDuringFeedback = false, optionIndex = null } = {}) {
  const index = optionIndex ?? (correct ? round.correctIndex : (round.correctIndex + 1) % 4);
  const clue = page.getByRole('region', { name: 'Labeled paper and folds', exact: true });
  const promptBefore = correct ? null : await clue.innerHTML();
  const optionsBefore = correct ? null : await choices(page).evaluateAll(elements => elements.map(element => element.textContent));
  const glyphsBefore = correct ? null : await choices(page).evaluateAll(elements => elements.map(element => [...element.querySelectorAll('svg')].map(svg => svg.outerHTML)));
  if (keyboard) await page.keyboard.press(String(index + 1));
  else await choices(page).nth(index).click();
  if (correct) {
    const next = page.getByRole('button', { name: /^(Next|Finish level|Finish review|Results)$/ });
    await next.waitFor();
    await assertFocused(next);
    await page.waitForFunction(selectedIndex => {
      const values = [...document.querySelectorAll('button[aria-keyshortcuts]')].map(element => Number(getComputedStyle(element).opacity));
      return values.length === 4 && values.every((value, index) => index === selectedIndex || value < values[selectedIndex]);
    }, round.correctIndex);
    const opacity = await choices(page).evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
    assert.ok(opacity.every((value, optionIndex) => optionIndex === round.correctIndex || value < opacity[round.correctIndex]), 'Solved rounds visually mute irrelevant choices.');
  } else {
    await page.getByRole('status').filter({ hasText: 'Not quite' }).waitFor();
    if (reloadDuringFeedback) {
      await page.reload();
      await page.getByRole('status').filter({ hasText: 'Not quite' }).waitFor();
    }
    assert.equal(await clue.innerHTML(), promptBefore, 'A mistake preserves the complete visual and accessible prompt without revealing the folding result.');
    assert.deepEqual(await choices(page).evaluateAll(elements => elements.map(element => [...element.querySelectorAll('svg')].map(svg => svg.outerHTML))), glyphsBefore, 'A mistake never changes the pictured answer orientations.');
    assert.equal(await page.locator('[class*="teachingArea"]').count(), 0, 'A mistake never runs the solution animation.');
    assert.equal(await page.locator('[class*="missingItem"], [class*="extraItem"]').count(), 0, 'A mistake never adds or identifies correct-answer tokens.');
    assert.deepEqual(await choices(page).evaluateAll(elements => elements.map(element => element.textContent.replace(/×/g, ''))), optionsBefore, 'Only the cross is added; all answer content remains unchanged.');
    assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(Boolean), 'Feedback prevents duplicate submissions.');
    await page.waitForFunction(selectedIndex => {
      const values = [...document.querySelectorAll('button[aria-keyshortcuts]')].map(element => Number(getComputedStyle(element).opacity));
      return values.length === 4 && values.every((value, index) => index === selectedIndex || value < values[selectedIndex]);
    }, index);
    const opacity = await choices(page).evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
    assert.ok(opacity.every((value, optionIndex) => optionIndex === index || value < opacity[index]), 'Incorrect feedback keeps the attempted choice prominent.');
    await page.getByRole('status').filter({ hasText: 'Try again' }).waitFor();
    await assertFocused(choices(page).nth(index));
  }
  return index;
}
async function advance(page) {
  await page.getByRole('button', { name: /^(Next|Finish level|Finish review|Results)$/ }).click();
}
async function score(page) {
  return page.locator('[aria-label^="First try score "]').getAttribute('aria-label');
}
async function assertFits(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} has horizontal overflow`);
  const controls = await page.locator('button, a').evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  }).map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: innerWidth })));
  for (const control of controls) {
    assert.ok(control.width >= 44 && control.height >= 44, `${label}: ${control.label} is ${control.width} by ${control.height}`);
    assert.ok(control.left >= 0 && control.right <= control.viewport, `${label}: ${control.label} is cropped horizontally`);
  }
}
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
async function seedNextGeneration(page, difficulty, seed, seen) {
  await page.evaluate(seedValue => {
    let value = seedValue >>> 0;
    Math.random = () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let mixed = value;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
  }, seed);
  const round = generateInfiniteRound(difficulty, seededRandom(seed), seen);
  seen.add(roundFingerprint(round));
  return round;
}
async function saved(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), PROGRESSION_STORAGE_KEY); }
function activeAttempt(state) {
  const profile = state.profiles.find(candidate => candidate.id === state.activeProfileId);
  return profile.attempts[profile.activeAttemptId];
}

test('Starter Campaign preserves misses through retry, read-only history, checkpoints, and redemption', async () => {
  const { context, page, errors } = await open();
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  const rounds = levelRounds('Easy');
  await waitForRound(page, rounds[0]);
  assert.equal(await page.getByRole('group', { name: 'Starter problems', exact: true }).getByRole('button').count(), 12);
  await answer(page, rounds[0], { correct: false });
  assert.equal(await score(page), 'First try score 0');
  await answer(page, rounds[0], { keyboard: true });
  await advance(page);
  await waitForRound(page, rounds[1]);
  assert.equal(await score(page), 'First try score 0');

  const marker = page.getByRole('button', { name: 'Starter problem 1: incorrect; review problem', exact: true });
  const markersBefore = await page.getByRole('group', { name: 'Starter problems', exact: true }).getByRole('button').evaluateAll(elements => elements.map(element => ({ label: element.getAttribute('aria-label'), current: element.getAttribute('aria-current') })));
  await marker.click();
  const heading = page.getByRole('heading', { name: 'Starter · Problem 1', exact: true });
  await heading.waitFor();
  await assertFocused(heading);
  assert.equal(await choices(page).count(), 0, 'Historical answers are read-only.');
  await page.keyboard.press('4');
  const closeReview = page.getByRole('button', { name: 'Back to current problem', exact: true });
  await closeReview.focus();
  await page.keyboard.press('Enter');
  await heading.waitFor({ state: 'detached' });
  await assertFocused(marker);
  assert.equal(await score(page), 'First try score 0');
  assert.deepEqual(await page.getByRole('group', { name: 'Starter problems', exact: true }).getByRole('button').evaluateAll(elements => elements.map(element => ({ label: element.getAttribute('aria-label'), current: element.getAttribute('aria-current') }))), markersBefore);

  for (let index = 1; index < rounds.length; index++) {
    await answer(page, rounds[index], { keyboard: index % 2 === 0 });
    await advance(page);
  }
  await page.getByRole('heading', { name: 'Level complete', exact: true }).waitFor();
  assert.equal(await choices(page).count(), 0, 'Question twelve stops at a checkpoint.');
  const review = page.getByRole('button', { name: 'Review Mistakes', exact: true });
  await assertFocused(review);
  assert.equal(await score(page), 'First try score 11');
  await review.click();
  await page.getByRole('heading', { name: 'Here’s your chance at redemption.', exact: true }).waitFor();
  assert.match(await page.locator('[class*="resultScore"]').textContent(), /11\s*\/ 12 first try/);
  await page.getByRole('button', { name: 'Retry missed', exact: true }).click();
  await waitForRound(page, rounds[0]);
  await answer(page, rounds[0]);
  await advance(page);
  await page.getByRole('heading', { name: 'Level complete', exact: true }).waitFor();
  assert.equal(await marker.getAttribute('aria-label'), 'Starter problem 1: incorrect; review problem');
  assert.equal(await score(page), 'First try score 11');
  assert.equal(await page.getByRole('button', { name: 'Review Mistakes', exact: true }).count(), 0);
  const junior = page.getByRole('button', { name: 'Junior', exact: true });
  await assertFocused(junior);
  await junior.click();
  await waitForRound(page, levelRounds('Medium')[0]);
  assert.equal(await page.getByRole('button', { name: 'Junior problem 1: not done', exact: true }).getAttribute('aria-current'), 'step');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Infinite promotes only from first attempts and ending offers untimed redemption', async () => {
  const { context, page, errors } = await open({ width: 820 });
  const seen = new Set();
  let round = await seedNextGeneration(page, 'Easy', 202610121, seen);
  await page.getByRole('button', { name: 'Infinite', exact: true }).click();
  await waitForRound(page, round);
  assert.equal(await page.getByRole('button', { name: 'End', exact: true }).isDisabled(), true);
  for (let ordinal = 0; ordinal < 9; ordinal++) {
    await answer(page, round, { keyboard: true });
    const energy = page.getByRole('progressbar', { name: 'Combo energy', exact: true });
    assert.equal(Number(await energy.getAttribute('aria-valuenow')), Math.min(100, Math.round(((ordinal + 1) / 8) * 100)));
    const nextDifficulty = ordinal < 2 ? 'Easy' : ordinal < 5 ? 'Medium' : ordinal < 8 ? 'Hard' : 'Wizard';
    round = await seedNextGeneration(page, nextDifficulty, 202610122 + ordinal, seen);
    await advance(page);
    await waitForRound(page, round);
  }
  assert.equal(round.difficulty, 'Wizard');
  await answer(page, round, { correct: false, keyboard: true });
  assert.equal(await page.getByRole('progressbar', { name: 'Combo energy', exact: true }).getAttribute('aria-valuenow'), '0');
  assert.equal(await score(page), 'First try score 9');
  await answer(page, round);
  assert.equal(await score(page), 'First try score 9', 'Retry does not improve first-try score.');
  assert.equal(await page.getByRole('progressbar', { name: 'Combo energy', exact: true }).getAttribute('aria-valuenow'), '0', 'Retry does not rebuild combo.');
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await page.getByRole('heading', { name: 'Here’s your chance at redemption.', exact: true }).waitFor();
  assert.match(await page.locator('[class*="resultScore"]').textContent(), /9\s*\/ 10 first try/);
  await page.getByRole('button', { name: 'Retry missed', exact: true }).click();
  await waitForRound(page, round);
  await answer(page, round, { keyboard: true });
  await advance(page);
  const results = page.getByRole('heading', { name: 'Redemption complete.', exact: true });
  await results.waitFor();
  await assertFocused(results);
  assert.equal(await page.getByRole('button', { name: 'Retry missed', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('all levels fit the phone and tablet breakpoints; Wizard preserves the hidden fold and uses distinct shapes', async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await assertFits(page, '390px example');
  await page.screenshot({ path: resolve(shots, 'example-phone.png'), fullPage: true });
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  const levels = [['Starter', 'Easy'], ['Junior', 'Medium'], ['Expert', 'Hard'], ['Wizard', 'Wizard']];
  for (const [level, difficulty] of levels) {
    if (level !== 'Starter') await page.getByRole('button', { name: new RegExp(`^${level},`) }).click();
    await waitForRound(page, levelRounds(difficulty)[0]);
    for (const width of [390, 620, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await assertFits(page, `${width}px ${level}`);
      if (width === 390) await page.screenshot({ path: resolve(shots, `${level.toLowerCase()}-phone.png`), fullPage: true });
    }
    if (level === 'Expert') {
      const expert = levelRounds('Hard');
      const shapeIndex = expert.findIndex(round => round.source.items[0].kind === 'shape');
      for (let index = 0; index < shapeIndex; index++) {
        await answer(page, expert[index], { keyboard: true });
        await advance(page);
        await waitForRound(page, expert[index + 1]);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await assertFits(page, '390px Expert shapes');
      await page.screenshot({ path: resolve(shots, 'expert-shapes-phone.png'), fullPage: true });
      await page.setViewportSize({ width: 1200, height: 900 });
      await assertFits(page, '1200px Expert shapes');
      await page.screenshot({ path: resolve(shots, 'expert-shapes-desktop.png'), fullPage: true });
    }
  }
  const wizard = levelRounds('Wizard');
  const clue = page.getByRole('region', { name: 'Labeled paper and folds', exact: true });
  const hidden = page.getByRole('img', { name: /^Find the hidden first fold\./ });
  await hidden.waitFor();
  await page.getByText('After fold 1 · symbols shown upright', { exact: true }).waitFor();
  assert.match(await hidden.textContent(), /\?/);
  const hiddenDirection = foldDirectionLabel(wizard[0].folds[0]);
  assert.equal((await clue.textContent()).includes(hiddenDirection), false);
  await answer(page, wizard[0], { correct: false, keyboard: true });
  assert.equal(await hidden.count(), 1);
  assert.equal((await clue.textContent()).includes(hiddenDirection), false, 'A Wizard mistake preserves the hidden fold.');
  const imageNames = await clue.getByRole('img').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')).join(' '));
  assert.equal(imageNames.includes(hiddenDirection), false, 'A Wizard mistake does not reveal the direction through an accessible cue.');

  const shapeIndex = wizard.findIndex(round => round.source.items[0].kind === 'shape');
  assert.ok(shapeIndex >= 0 && shapeIndex < 12, 'Wizard includes a picture-item round.');
  for (let index = 0; index < shapeIndex; index++) {
    await answer(page, wizard[index], { keyboard: true });
    await advance(page);
    await waitForRound(page, wizard[index + 1]);
  }
  const shapeRound = wizard[shapeIndex];
  const original = page.getByRole('img', { name: /^Original / }).first();
  const shapes = await original.evaluate(element => [...element.querySelector('svg').children]
    .filter(cell => cell.tagName.toLowerCase() === 'g')
    .map(cell => cell.querySelector('[transform^="translate(32 32)"]').innerHTML));
  assert.equal(shapes.length, shapeRound.source.items.length);
  assert.equal(new Set(shapes).size, shapes.length, 'Every picture item has its own visible shape design.');
  for (const width of [390, 620, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await assertFits(page, `${width}px Wizard shapes`);
    await page.screenshot({ path: resolve(shots, `wizard-shapes-${width}.png`), fullPage: true });
  }
  await answer(page, shapeRound, { keyboard: true });
  assert.equal(await page.getByRole('img', { name: /^Top to bottom:/ }).count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

function journeyFixture() {
  const snapshot = [
    { slug: progressionAdapter.gameSlug, title: 'Folded Items', role: 'game', contentVersion: progressionAdapter.contentVersion, generatorVersion: progressionAdapter.generatorVersion, journeyContentVersion: progressionAdapter.journeyContentVersion },
    ...journeyReviews.map(review => ({ slug: review.slug, title: review.title, role: 'review', journeyContentVersion: review.journeyContentVersion })),
  ];
  const node = buildJourneyPlan(snapshot).boards[0].nodes[0];
  const attempt = createNormalProgressionAttempt({
    id: 'browser-folded-items', node,
    journeyQuestions: journeyQuestionReferences(progressionAdapter, node.journeyLevel, { collectionId: node.collectionId, questionOffset: node.questionOffset, questionCount: node.questionCount }),
    nowMs: 1,
  });
  const profile = upsertProfileAttempt(createPlayerProfile({ id: 'folded-items-browser-profile', name: 'Ada', avatarId: 'hedgehog', gameSnapshot: snapshot, nowMs: 1 }), attempt);
  const state = addPlayerProfile(createProgressionState(), profile);
  let fixture;
  assert.equal(saveProgressionState(state, { getItem: () => null, setItem: (_, value) => { fixture = value; } }), true);
  return { fixture, node, attempt };
}

test('Journey uses canonical rounds, persists retry and redemption across reload, and awards the stop once', async () => {
  const { fixture, node, attempt } = journeyFixture();
  const { context, page, errors } = await open({ width: 390, height: 844, fixture, query: `?progression=${attempt.id}` });
  const rounds = levelRounds('Easy');
  await waitForRound(page, rounds[0]);
  assert.equal(await page.getByRole('button', { name: 'Campaign', exact: true }).count(), 0, 'A controlled stop reuses the game without opening standalone mode.');
  await assertFits(page, '390px Journey question');
  await answer(page, rounds[0], { correct: false, reloadDuringFeedback: true });
  const missed = activeAttempt(await saved(page));
  assert.equal(missed.rounds[0].firstTryCorrect, false);
  assert.equal(missed.rounds[0].attemptCount, 1);
  assert.equal(missed.rounds[0].phase, 'answering');
  await page.reload();
  await page.getByRole('status').filter({ hasText: 'Try again' }).waitFor();
  assert.deepEqual(activeAttempt(await saved(page)).rounds, missed.rounds, 'Reload preserves the canonical question reference and first answer.');
  await answer(page, rounds[0], { keyboard: true });
  const solved = activeAttempt(await saved(page));
  assert.equal(solved.rounds[0].phase, 'solved');
  assert.equal(solved.rounds[0].attemptCount, 2);
  await page.reload();
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await next.waitFor();
  await assertFocused(next);
  assert.deepEqual(activeAttempt(await saved(page)).rounds, solved.rounds);
  await advance(page);
  for (let index = 1; index < 12; index++) {
    await waitForRound(page, rounds[index]);
    await answer(page, rounds[index], { keyboard: true });
    await advance(page);
  }
  await page.getByRole('heading', { name: 'Here’s your chance at redemption.', exact: true }).waitFor();
  assert.equal(activeAttempt(await saved(page)).phase, 'redemption-ready');
  assert.equal((await saved(page)).profiles[0].missedQuestions.length, 1);
  await page.getByRole('button', { name: 'Review Mistakes', exact: true }).click();
  await waitForRound(page, rounds[0]);
  const redemption = activeAttempt(await saved(page));
  assert.equal(redemption.phase, 'redemption');
  assert.equal(redemption.redemption.queue.length, 1);
  await page.reload();
  await waitForRound(page, rounds[0]);
  assert.deepEqual(activeAttempt(await saved(page)).redemption, redemption.redemption);
  await answer(page, rounds[0], { keyboard: true });
  await advance(page);
  await page.waitForURL(new RegExp(`${base}/journey/summary/`));
  const claim = page.getByRole('button', { name: 'Claim 25 XP', exact: true });
  await claim.waitFor();
  const beforeClaim = activeAttempt(await saved(page));
  assert.equal(beforeClaim.rounds.filter(round => round.firstTryCorrect).length, 11);
  assert.equal(beforeClaim.rounds[0].firstTryCorrect, false, 'Redemption preserves Journey accuracy.');
  await claim.click();
  await page.waitForURL(origin + base + '/journey/');
  const finalProfile = (await saved(page)).profiles[0];
  assert.deepEqual(finalProfile.clearedStopIds, [node.id]);
  assert.deepEqual(finalProfile.awardedStopIds, [node.id]);
  assert.equal(finalProfile.xpAwards.length, 1);
  assert.equal(finalProfile.xpAwards[0].amount, 25);
  assert.equal(finalProfile.missedQuestions.length, 1);
  assert.equal(finalProfile.activeAttemptId, null);
  await page.goto(origin + route);
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await answer(page, rounds[0], { keyboard: true });
  assert.deepEqual((await saved(page)).profiles[0], finalProfile, 'Standalone play leaves Journey XP, stop history, and misses unchanged.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('normal motion tracks the real two folds, settles on resize, and remembers sound', async () => {
  const { context, page, errors } = await open({ reducedMotion: 'no-preference' });
  const sound = page.getByRole('button', { name: 'Sound', exact: true });
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.getByRole('button', { name: /^Expert,/ }).click();
  const rounds = levelRounds('Hard');
  await waitForRound(page, rounds[0]);
  const started = performance.now();
  await choices(page).nth(rounds[0].correctIndex).click();
  const firstFold = page.getByRole('img', { name: `Fold 1. ${foldDirectionLabel(rounds[0].folds[0])}`, exact: true });
  await firstFold.waitFor();
  assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(Boolean));
  const firstSheet = firstFold.locator('svg[class*="movingSheet"]');
  assert.equal(await firstSheet.locator(':scope > g > g').count(), rounds[0].foldSteps[0].before.stacks.filter(stack => stack.length).length);
  const transforms = await firstSheet.locator(':scope > g').evaluateAll(elements => elements.map(element => element.getAttribute('transform')));
  await page.waitForFunction(({ selector, prior }) => {
    const sheet = document.querySelector(selector);
    return sheet && [...sheet.children].some((element, index) => element.getAttribute('transform') !== prior[index]);
  }, { selector: 'svg[class*="movingSheet"]', prior: transforms });
  const secondFold = page.getByRole('img', { name: `Fold 2. ${foldDirectionLabel(rounds[0].folds[1])}`, exact: true });
  await secondFold.waitFor();
  assert.equal(await secondFold.locator('svg[class*="movingSheet"] > g > g').count(), rounds[0].foldSteps[1].before.stacks.filter(stack => stack.length).length);
  await page.screenshot({ path: resolve(shots, 'normal-motion-second-fold.png'), fullPage: false });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await next.waitFor();
  await assertFocused(next);
  assert.ok(performance.now() - started >= 2_000, 'Normal motion leaves time to inspect both folds.');
  assert.equal(await page.getByRole('img', { name: `Top to bottom: ${rounds[0].correctItems.map(id => describeItem(rounds[0], id)).join(', ')}`, exact: true }).count(), 1);
  await advance(page);
  await waitForRound(page, rounds[1]);
  await choices(page).nth(rounds[1].correctIndex).click();
  await page.setViewportSize({ width: 820, height: 900 });
  await next.waitFor();
  await assertFocused(next);
  await assertFits(page, '820px settled teaching');
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  await page.reload();
  await sound.waitFor();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Sound"]')?.getAttribute('aria-pressed') === 'false');
  assert.deepEqual(errors, []);
  await context.close();
});


test('incorrect answers at every level preserve the puzzle in both motion preferences', async () => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const { context, page, errors } = await open({ reducedMotion });
    await page.getByRole('button', { name: 'Campaign', exact: true }).click();
    for (const [level, difficulty] of [['Starter', 'Easy'], ['Junior', 'Medium'], ['Expert', 'Hard'], ['Wizard', 'Wizard']]) {
      if (level !== 'Starter') await page.getByRole('button', { name: new RegExp(`^${level},`) }).click();
      const round = levelRounds(difficulty)[0];
      await waitForRound(page, round);
      const before = performance.now();
      await answer(page, round, { correct: false, keyboard: true });
      assert.ok(performance.now() - before >= (reducedMotion === 'reduce' ? 1_200 : 2_100), 'Incorrect feedback leaves time to inspect the attempted answer.');
      assert.equal(await score(page), 'First try score 0');
      assert.equal(await page.getByRole('button', { name: `${level} problem 1: incorrect`, exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: /^(Next|Finish level)$/ }).count(), 0, 'An incorrect answer does not advance.');
    }
    await page.getByRole('button', { name: /^Starter,/ }).click();
    const starter = levelRounds('Easy')[0];
    await waitForRound(page, starter);
    await answer(page, starter, { keyboard: true });
    assert.equal(await score(page), 'First try score 0', 'Leaving a missed puzzle and returning cannot turn its retry into a first attempt.');
    await advance(page);
    assert.equal(await page.getByRole('button', { name: 'Starter problem 1: incorrect; review problem', exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('number shortcuts ignore every native editable control and nested editable content', async () => {
  const { context, page, errors } = await open();
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  const round = levelRounds('Easy')[0];
  await waitForRound(page, round);
  for (const tag of ['input', 'textarea', 'select', 'editable', 'nested-editable']) {
    const selector = await page.evaluate(kind => {
      const control = document.createElement(kind.includes('editable') ? 'div' : kind);
      control.id = 'keyboard-audit-control';
      if (kind.includes('editable')) control.contentEditable = 'true';
      if (kind === 'nested-editable') control.innerHTML = '<span id="keyboard-audit-child" tabindex="0">edit</span>';
      if (kind === 'select') control.innerHTML = '<option>1</option><option>2</option>';
      document.querySelector('main').prepend(control);
      return kind === 'nested-editable' ? '#keyboard-audit-child' : '#keyboard-audit-control';
    }, tag);
    await page.locator(selector).focus();
    await page.keyboard.press(String(round.correctIndex + 1));
    assert.equal(await score(page), 'First try score 0', `${tag} must not submit an answer`);
    assert.ok((await choices(page).evaluateAll(elements => elements.map(element => element.disabled))).every(value => !value));
    await page.locator('#keyboard-audit-control').evaluate(element => element.remove());
  }
  await answer(page, round, { keyboard: true });
  assert.equal(await score(page), 'First try score 1');
  assert.deepEqual(errors, []);
  await context.close();
});

test('phone teaching remains in view through both folds and the next round', async () => {
  const { context, page, errors } = await open({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.getByRole('button', { name: /^Expert,/ }).click();
  const rounds = levelRounds('Hard');
  // Reach a shape round with an underfold, after Next has focused and scrolled.
  for (let index = 0; index < 2; index += 1) {
    await answer(page, rounds[index]);
    await advance(page);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const index of [2, 3]) {
    await waitForRound(page, rounds[index]);
    const source = await page.getByRole('img', { name: /^Original / }).boundingBox();
    assert.ok(source && source.y >= 0 && source.y + source.height <= 900, 'Next brings the new paper into view without losing answer focus.');
    // Use a native pointer click, which can itself scroll/focus the answer.
    await choices(page).nth(rounds[index].correctIndex).click();
    for (const [stageIndex, wait] of [[0, 300], [1, 1400]]) {
      await page.waitForTimeout(wait);
      const stage = page.getByRole('img', { name: `Fold ${stageIndex + 1}. ${foldDirectionLabel(rounds[index].folds[stageIndex])}`, exact: true });
      assert.equal(await stage.count(), 1, `Fold ${stageIndex + 1} remains active at its teaching sample.`);
      const sheet = await stage.locator('svg[class*="movingSheet"]').boundingBox();
      assert.ok(sheet && sheet.x >= 0 && sheet.x + sheet.width <= 390 && sheet.y >= 0 && sheet.y + sheet.height <= 900,
        `The entire animated paper stays in the phone viewport: ${JSON.stringify(sheet)}`);
      assert.match(await page.getByRole('status').textContent(), /Tracking the folds/);
    }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await next.waitFor();
    await assertFocused(next);
    await advance(page);
  }
  assert.deepEqual(errors, []);
  await context.close();
});


function orientationTransforms(orientations) {
  return orientations.map(({ flipX, flipY }) => `translate(32 32) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1}) translate(-32 -32)`);
}
async function renderedOrientations(locator) {
  return locator.locator('svg[class*="itemToken"]').evaluateAll(elements => elements.map(element => element.firstElementChild.getAttribute('transform')));
}
async function assertUnmarkedGlyphs(page) {
  const marks = await page.locator('text[class*="glyphText"]').evaluateAll(elements => elements.flatMap(element =>
    [...element.parentElement.children].filter(sibling => ['path', 'line'].includes(sibling.tagName.toLowerCase())).map(sibling => sibling.outerHTML)));
  assert.deepEqual(marks, [], 'Alphanumeric glyphs have no baseline or ground marks in any view.');
}

test('Wizard answers preserve real glyph flips, including an orientation-only trap and read-only history', async () => {
  const { context, page, errors } = await open({ width: 390, height: 900 });
  await assertUnmarkedGlyphs(page);
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  for (const [level, difficulty] of [['Starter', 'Easy'], ['Junior', 'Medium'], ['Expert', 'Hard']]) {
    if (level !== 'Starter') await page.getByRole('button', { name: new RegExp(`^${level},`) }).click();
    const round = levelRounds(difficulty)[0];
    await waitForRound(page, round);
    for (const [index, option] of round.options.entries()) {
      assert.deepEqual(await renderedOrientations(choices(page).nth(index)), orientationTransforms(option.map(() => ({ flipX: false, flipY: false }))), `${level} answer glyphs stay upright.`);
    }
    await assertUnmarkedGlyphs(page);
  }
  await page.getByRole('button', { name: /^Wizard,/ }).click();
  const round = levelRounds('Wizard')[0];
  await waitForRound(page, round);
  assert.equal(round.orientationMatters, true);
  await page.getByText('After fold 1 · symbols shown upright', { exact: true }).waitFor();
  const evidence = await renderedOrientations(page.locator('[class*="overlapClue"]'));
  assert.deepEqual(evidence, orientationTransforms(Array.from({ length: 3 }, () => ({ flipX: false, flipY: false }))), 'The explicitly upright evidence preserves the hidden-fold challenge.');
  await assertFits(page, '390px Wizard orientation evidence');
  const orientationTrap = round.optionKinds.indexOf('orientation');
  assert.ok(orientationTrap >= 0, 'Wizard has a same-items, same-order orientation trap.');
  assert.deepEqual(round.options[orientationTrap], round.correctItems);
  assert.notDeepEqual(round.optionOrientations[orientationTrap], round.correctOrientations);
  for (const [index, orientations] of round.optionOrientations.entries()) {
    assert.deepEqual(await renderedOrientations(choices(page).nth(index)), orientationTransforms(orientations));
  }
  assert.ok(round.correctOrientations.some(({ flipX, flipY }) => flipX || flipY));
  await assertUnmarkedGlyphs(page);
  await answer(page, round, { correct: false, keyboard: true, optionIndex: orientationTrap });
  assert.equal(await score(page), 'First try score 0');
  assert.equal(await page.getByRole('img', { name: /^Top to bottom:/ }).count(), 0, 'Wrong orientation does not reveal the correct stack.');
  for (const [index, orientations] of round.optionOrientations.entries()) {
    assert.deepEqual(await renderedOrientations(choices(page).nth(index)), orientationTransforms(orientations));
  }
  await answer(page, round, { keyboard: true });
  const solved = page.getByRole('img', { name: `Top to bottom: ${describeAnswer(round, round.correctItems, round.correctOrientations)}`, exact: true });
  assert.deepEqual(await renderedOrientations(solved), orientationTransforms(round.correctOrientations));
  await assertUnmarkedGlyphs(page);
  await page.screenshot({ path: resolve(shots, 'wizard-oriented-answer-phone.png'), fullPage: true });
  await advance(page);
  const marker = page.getByRole('button', { name: 'Wizard problem 1: incorrect; review problem', exact: true });
  await marker.click();
  const history = page.getByRole('heading', { name: 'Wizard · Problem 1', exact: true });
  await assertFocused(history);
  const correctHistory = page.getByRole('img', { name: `Correct stack: ${describeAnswer(round, round.correctItems, round.correctOrientations)}`, exact: true });
  const wrongHistory = page.getByRole('img', { name: `Your first incorrect answer: ${describeAnswer(round, round.options[orientationTrap], round.optionOrientations[orientationTrap])}`, exact: true });
  assert.deepEqual(await renderedOrientations(correctHistory), orientationTransforms(round.correctOrientations));
  assert.deepEqual(await renderedOrientations(wrongHistory), orientationTransforms(round.optionOrientations[orientationTrap]));
  assert.equal(await choices(page).count(), 0);
  await assertUnmarkedGlyphs(page);
  await page.getByRole('button', { name: 'Back to current problem', exact: true }).click();
  await assertFocused(marker);
  assert.equal(await score(page), 'First try score 0');
  assert.deepEqual(errors, []);
  await context.close();
});
