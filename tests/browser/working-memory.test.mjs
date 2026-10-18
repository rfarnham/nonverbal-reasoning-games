import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { SOUND_PREFERENCE_KEY } from '../../lib/game-audio.ts';
import { decryptSearchBytes, deriveSearchKey, encryptSearchBytes, sha256 } from '../../lib/question-search/crypto.ts';
import { AUDIO_TASK_IDS, VISUAL_TASK_IDS, advanceRound, createProgress, recordFirstAttempt } from '../../app/lab/working-memory/engine.ts';
import { MEMORY_PROGRESS_STORAGE_KEY, memoryAudioContext, memoryContentContext, validateMemoryContent } from '../../app/lab/working-memory/vault.ts';

// Ordinary browser CI exercises the production cryptographic flow with a freshly
// encrypted synthetic pack. Neither the real pack nor its password is a fixture.
const base = '/nonverbal-reasoning-games';
const route = `${base}/lab/working-memory/`;
const root = resolve(fileURLToPath(new URL('../../out/', import.meta.url)));
const shots = resolve(fileURLToPath(new URL('../../outputs/working-memory/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/x-component', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const shapes = ['circle', 'triangle', 'square', 'diamond', 'cross', 'star'];
const progressContext = 'working-memory/v1/device-progress';
const canonicalFavicon = 'https://rfarnham.github.io/nonverbal-reasoning-games/favicon.svg';
let server, browser, origin, fixture;

async function encryptedFixture() {
  const password = randomBytes(24).toString('base64');
  const manifest = {
    schemaVersion: 1, version: randomBytes(16).toString('hex'),
    payload: { path: `content-${randomBytes(16).toString('hex')}.bin`, sha256: '', bytes: 0 }, assets: {},
    encryption: { name: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: randomBytes(16).toString('base64') },
  };
  const content = {
    version: 1, title: 'Private browser fixture', intro: 'A synthetic practice introduction.', evidenceNote: 'Synthetic browser-test evidence.',
    tasks: [...VISUAL_TASK_IDS, ...AUDIO_TASK_IDS].map(id => ({ id, title: `Exercise ${id}`, description: 'Synthetic exercise description.', instruction: 'Remember and rebuild the presented items.', icon: '◇', accent: 'teal' })),
    sources: [{ title: 'Synthetic reference', url: 'https://example.test/reference', note: 'Browser-test reference only.' }],
  };
  validateMemoryContent(content);
  const key = await deriveSearchKey(password, manifest.encryption);
  const encrypted = await encryptSearchBytes(new TextEncoder().encode(JSON.stringify(content)), key, memoryContentContext(manifest));
  manifest.payload.sha256 = await sha256(encrypted);
  manifest.payload.bytes = encrypted.length;
  // Reuse a tiny valid local media primer as synthetic audio. Digit wording is
  // audited separately; this fixture verifies decrypt, decode, and sequencing.
  const audio = new Uint8Array(await readFile(new URL('../../public/audio/narration/narration-unlock.mp3', import.meta.url)));
  const assets = new Map();
  for (let digit = 1; digit <= 9; digit++) {
    const id = `digit-${digit}`;
    const cipher = await encryptSearchBytes(audio, key, memoryAudioContext(manifest.version, id));
    const path = `asset-${randomBytes(16).toString('hex')}.bin`;
    manifest.assets[id] = { path, sha256: await sha256(cipher), bytes: cipher.length };
    assets.set(path, cipher);
  }
  return { password, manifest, content, key, encrypted, assets };
}

before(async () => {
  fixture = await encryptedFixture();
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

async function open({ width = 1200, height = 900, touch = false, realPack = false, holdManifest } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], external = [];
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:') && !request.url().startsWith('blob:') && request.url() !== canonicalFavicon) external.push(request.url()); });
  // The shared site's metadata uses its absolute production icon. Serve that
  // existing first-party asset locally during an isolated static-export test.
  await page.route(canonicalFavicon, async intercepted => intercepted.fulfill({ contentType: 'image/svg+xml', body: await readFile(new URL('favicon.svg', new URL('../../public/', import.meta.url))) }));
  if (!realPack) await page.route('**/working-memory/vault/**', async intercepted => {
    const pathname = new URL(intercepted.request().url()).pathname;
    if (pathname.endsWith('/manifest.json')) {
      if (holdManifest) await holdManifest;
      await intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.manifest) });
    } else if (fixture.assets.has(pathname.split('/').at(-1))) {
      await intercepted.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(fixture.assets.get(pathname.split('/').at(-1))) });
    } else {
      assert.equal(pathname, `${base}/working-memory/vault/${fixture.manifest.payload.path}`);
      await intercepted.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(fixture.encrypted) });
    }
  });
  await page.goto(origin + route);
  await page.getByLabel('Password', { exact: true }).waitFor();
  return { context, page, errors, external };
}
async function unlock(page, password = fixture.password) {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^Unlock/ }).click();
  await page.getByRole('heading', { name: 'Memory Lab', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).waitFor();
}
async function readSaved(page, key = fixture.key) {
  const raw = await page.evaluate(key => localStorage.getItem(key), MEMORY_PROGRESS_STORAGE_KEY);
  if (!raw) return null;
  const envelope = JSON.parse(raw);
  assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'version']);
  assert.equal(envelope.version, 1);
  const plain = await decryptSearchBytes(new Uint8Array(Buffer.from(envelope.ciphertext, 'base64')), key, progressContext);
  return JSON.parse(new TextDecoder().decode(plain));
}
async function saved(page, predicate = value => value !== null, key = fixture.key) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await readSaved(page, key);
    if (predicate(value)) return value;
    await page.waitForTimeout(25);
  }
  assert.fail('Encrypted progress did not reach the expected state.');
}
async function seedSession(page, session) {
  const data = { version: 1, session, tasks: session.tasks, logs: [], redeemed: [], slow: false };
  const encrypted = await encryptSearchBytes(new TextEncoder().encode(JSON.stringify(data)), fixture.key, progressContext);
  await page.evaluate(({ key, ciphertext }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, ciphertext }));
  }, { key: MEMORY_PROGRESS_STORAGE_KEY, ciphertext: Buffer.from(encrypted).toString('base64') });
  await page.reload();
  await page.getByLabel('Password', { exact: true }).waitFor();
  await unlock(page);
  assert.deepEqual(await saved(page), data, 'Resume fixtures use valid encrypted production progress.');
  return data;
}
async function startFocus(page, task) {
  await page.getByRole('button', { name: `Practice Exercise ${task}`, exact: true }).click();
  await page.getByRole('heading', { name: `Exercise ${task}`, exact: true }).waitFor();
  const state = await saved(page, value => value?.session?.focusedTask === task);
  assert.equal(state.session.length, 8);
  assert.equal(state.session.cursor, 0);
  assert.equal(state.session.answered, false);
  return state.session.active;
}
async function present(page, { replay = false, audio = false } = {}) {
  await page.getByRole('button', { name: replay ? /^Replay sequence/ : audio ? /^(Listen to the sequence|Turn sound on & listen)/ : /^Watch the sequence/ }).click();
  await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
}
function responseControl(page, round, value) {
  if (round.answerKind === 'ordered-digits') return page.getByRole('button', { name: `Digit ${value}`, exact: true });
  if (round.task === 'symbols') return page.getByRole('button', { name: shapes[value], exact: true });
  const prefix = round.task === 'tracking' ? 'Circle at row' : 'Row';
  return page.getByRole('button', { name: `${prefix} ${Math.floor(value / 4) + 1}, column ${value % 4 + 1}`, exact: true });
}
async function enter(page, round, values = round.expected, { keyboard = false, touch = false } = {}) {
  for (const value of values) {
    const control = responseControl(page, round, value);
    if (keyboard) { await control.focus(); await page.keyboard.press('Enter'); }
    else if (touch) await control.tap();
    else await control.click();
  }
}
async function check(page, { correct = true, key = fixture.key } = {}) {
  const before = await readSaved(page, key);
  await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
  if (!correct) {
    await page.getByRole('heading', { name: 'Try again', exact: true }).waitFor();
    return;
  }
  const advanced = await saved(page, value => value?.session?.cursor === before.session.cursor + 1, key);
  if (advanced.session.active) {
    await page.getByRole('status').filter({ hasText: new RegExp(`^✓ Round ${before.session.cursor + 1} correct(?: after replay)?$`) }).waitFor();
    await assertAutoPresentation(page);
  }
  else await page.getByRole('heading', { name: /^Session complete\.?$/ }).waitFor();
}
async function assertAutoPresentation(page) {
  await page.getByRole('status').filter({ hasText: /^(Get ready(?: \+)?|Watch|Listen)$/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^(Next round|Finish session|Watch the sequence|Listen to the sequence|Turn sound on & listen)/ }).count(), 0, 'A committed answer starts the next challenge without another action.');
  assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0, 'Answers stay locked while the next sequence is presented.');
}
async function assertNoPlaintext(page, state) {
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  for (const secret of [fixture.password, fixture.content.title, fixture.content.intro, fixture.content.sources[0].title, state?.session?.seed, '"sequence"', '"expected"']) {
    if (secret) assert.equal(stored.includes(secret), false, 'Private content, seed, and credentials stay out of plaintext browser storage.');
  }
}
async function assertFits(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} has horizontal overflow`);
  const controls = await page.locator('button, input:not([type="checkbox"]), select').evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  }).map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim() || element.id, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: innerWidth })));
  for (const control of controls) {
    assert.ok(control.width >= 44 && control.height >= 44, `${label}: ${control.label} is ${control.width} by ${control.height}`);
    assert.ok(control.left >= 0 && control.right <= control.viewport + 1, `${label}: ${control.label} is cropped horizontally`);
  }
}
async function assertClean({ errors, external }) { assert.deepEqual(errors, []); assert.deepEqual(external, []); }

test('locked pack discloses no exercises; incorrect password remains locked; unlock can be cancelled', async () => {
  let releaseManifest;
  const held = new Promise(resolve => { releaseManifest = resolve; });
  const opened = await open({ holdManifest: held });
  const { context, page } = opened;
  try {
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 0);
    assert.equal(await page.getByText(fixture.content.title, { exact: true }).count(), 0);
    assert.equal(await page.getByText(fixture.content.intro, { exact: true }).count(), 0);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: /^Unlock/ }).click();
    await page.getByRole('button', { name: 'Cancel unlock', exact: true }).click();
    releaseManifest();
    await page.getByLabel('Password', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Password', { exact: true }).isEnabled(), true);
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
    await page.getByLabel('Password', { exact: true }).fill(randomBytes(24).toString('base64'));
    await page.getByRole('button', { name: /^Unlock/ }).click();
    await page.getByRole('alert').filter({ hasText: /password did not unlock/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 0);
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
    await unlock(page);
    assert.equal(await page.getByRole('button', { name: /^Practice Exercise / }).count(), 11);
    await assertNoPlaintext(page);
    await assertClean(opened);
  } finally { releaseManifest(); await context.close(); }
});

for (const task of VISUAL_TASK_IDS) {
  test(`${task}: focused presentation accepts the engine-derived response and advances once`, { timeout: 60_000 }, async () => {
    const opened = await open();
    const { context, page } = opened;
    try {
      await unlock(page);
      const round = await startFocus(page, task);
      await present(page);
      assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).isDisabled(), true);
      await enter(page, round);
      await check(page);
      const state = await saved(page, value => value?.session?.history.length === 1);
      assert.equal(state.session.history[0].correct, true);
      assert.deepEqual(state.session.history[0].round, round);
      assert.equal(state.tasks[task].attempts, 1);
      assert.equal(state.tasks[task].correct, 1);
      const advanced = await saved(page, value => value?.session?.cursor === 1);
      assert.notEqual(advanced.session.active.id, round.id);
      assert.equal(advanced.session.history.length, 1);
      await assertNoPlaintext(page, advanced);
      await assertClean(opened);
    } finally { await context.close(); }
  });
}

for (const task of AUDIO_TASK_IDS) {
  test(`${task}: encrypted audio presents digits without answer cues and supports keyboard recall`, { timeout: 60_000 }, async () => {
    const opened = await open({ width: 390 });
    const { context, page } = opened;
    try {
      await unlock(page);
      if (task === 'reverse-digits') await page.getByRole('button', { name: 'Sound on', exact: true }).click();
      const round = await startFocus(page, task);
      const listen = page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen)/ });
      await listen.click();
      await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sound on', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
      if (task === 'hidden-digits') {
        assert.equal(await page.getByRole('button', { name: 'Hidden keypad button', exact: true }).count(), 9);
        assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 0);
      }
      await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 9);
      await assertFits(page, `${task} phone recall`);
      for (const value of round.expected) await page.keyboard.press(String(value));
      await check(page);
      const result = await saved(page, value => value?.session?.cursor === 1);
      assert.equal(result.session.history[0].correct, true);
      assert.equal(result.tasks[task].attempts, 1);
      await assertNoPlaintext(page, result);
      await assertClean(opened);
    } finally { await context.close(); }
  });
}

test('double-clicking Check sequence commits once and cannot answer during the next presentation', { timeout: 45_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'forward');
    await present(page);
    await enter(page, round);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).dblclick({ delay: 25 });
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(advanced.session.answered, false);
    assert.equal(advanced.session.history.length, 1);
    assert.equal(advanced.tasks.forward.attempts, 1);
    assert.equal(advanced.tasks.forward.correct, 1);
    await assertAutoPresentation(page);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).isDisabled(), true);
    await page.getByLabel(`0 of ${advanced.session.active.span} places entered`, { exact: true }).waitFor();
    assert.deepEqual(await saved(page), advanced, 'Extra clicks or Enter during presentation cannot score the unseen challenge.');
    await assertClean(opened);
  } finally { await context.close(); }
});

test('Continue session advances a previously scored save and presents a different exercise with one action', { timeout: 45_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    const session = createProgress('browser-legacy-correct', 24, { modality: 'visual' });
    const answered = recordFirstAttempt(session, session.active, true);
    const expected = advanceRound(answered);
    assert.notEqual(expected.active.task, answered.active.task);
    const before = await seedSession(page, answered);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    const resumed = await saved(page, value => value?.session?.cursor === 1);
    assert.deepEqual(resumed.session, expected);
    assert.deepEqual(resumed.tasks, before.tasks, 'Resuming a scored answer does not score it again.');
    assert.deepEqual(resumed.logs, []);
    await assertAutoPresentation(page);
    assert.equal(await page.getByRole('heading', { name: 'Example', exact: true }).count(), 0, 'A new exercise begins without another example or Start action.');
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, expected.active);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 2);
    assert.equal(completed.session.history.length, 2);
    assert.equal(completed.tasks[expected.active.task].attempts, 1);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('final Check sequence completes the session and records its log exactly once', { timeout: 60_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    let session = createProgress('browser-final-round', 8, { focusedTask: 'forward' });
    for (let index = 0; index < 7; index++) session = advanceRound(recordFirstAttempt(session, session.active, true));
    await seedSession(page, session);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await assertAutoPresentation(page);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, session.active);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 8 && value?.logs.length === 1);
    assert.equal(completed.session.active, null);
    assert.equal(completed.session.history.length, 8);
    assert.equal(completed.session.answered, false);
    assert.equal(completed.tasks.forward.attempts, 8);
    assert.equal(completed.tasks.forward.correct, 8);
    assert.equal(completed.logs[0].id, session.seed);
    assert.equal(completed.logs[0].correct, 8);
    assert.equal(completed.logs[0].rounds, 8);
    assert.equal(await page.getByRole('button', { name: /^(Finish session|Next round|Check sequence)/ }).count(), 0);
    await page.screenshot({ path: resolve(shots, 'complete-desktop.png'), fullPage: true });
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Back to the lab/ }).click();
    await page.getByRole('button', { name: /^Lock/ }).click();
    await unlock(page);
    assert.deepEqual(await saved(page), completed, 'Returning, locking, and unlocking do not duplicate a completed session log.');
    await assertNoPlaintext(page, completed);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('pause and lock during automatic advance retain the new unscored round for one-action resume', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 620 });
  const { context, page } = opened;
  try {
    await unlock(page);
    const first = await startFocus(page, 'forward');
    await present(page);
    await enter(page, first);
    await check(page);
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    const second = advanced.session.active;
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    assert.deepEqual(await saved(page), advanced, 'Pausing the next presentation does not score it or return to the prior round.');
    await page.getByRole('button', { name: /^Lock/ }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.deepEqual(await saved(page), advanced);
    await unlock(page);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await assertAutoPresentation(page);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, second);
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 2);
    assert.equal(result.session.history.length, 2);
    assert.deepEqual(result.session.history.map(item => item.round.id), [first.id, second.id]);
    assert.equal(result.tasks.forward.attempts, 2);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('rejected audio playback cannot create a scored listening attempt', { timeout: 30_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    await unlock(page);
    await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await page.evaluate(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Synthetic autoplay rejection', 'NotAllowedError'));
    });
    await page.getByRole('button', { name: /^Listen to the sequence/ }).click();
    await page.getByRole('status').filter({ hasText: /audio could not play/ }).waitFor();
    await page.getByRole('button', { name: /^Listen to the sequence/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial, 'A sequence that was not heard leaves progress unchanged.');
    await assertClean(opened);
  } finally { await context.close(); }
});

test('audio failure after Check sequence preserves the score and leaves the next unheard round unscored', { timeout: 45_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'reverse-digits');
    await present(page, { audio: true });
    await enter(page, round);
    await page.evaluate(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Synthetic autoplay rejection', 'NotAllowedError'));
    });
    await check(page);
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    await page.getByRole('status').filter({ hasText: /audio could not play/ }).waitFor();
    await page.getByRole('button', { name: /^Listen to the sequence/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    assert.notEqual(advanced.session.active.id, round.id);
    assert.equal(advanced.session.answered, false);
    assert.equal(advanced.session.history.length, 1);
    assert.equal(advanced.session.history[0].correct, true);
    assert.equal(advanced.tasks['reverse-digits'].attempts, 1);
    assert.deepEqual(await saved(page), advanced, 'Failed automatic playback neither rescored the prior answer nor scored the unheard next challenge.');
    await assertNoPlaintext(page, advanced);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('pausing and locking during a spoken sequence preserve an unscored round for replay', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 620 });
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await page.getByRole('button', { name: /^Listen to the sequence/ }).click();
    await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    assert.deepEqual(await saved(page), initial);
    await page.getByRole('button', { name: /^Continue →$/ }).click();
    await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
    await page.getByRole('button', { name: /^Lock/ }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.deepEqual(await saved(page), initial);
    await unlock(page);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await assertAutoPresentation(page);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, round);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(completed.session.history.length, 1);
    assert.equal(completed.session.history[0].correct, true);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('wrong response, replay, hard reload, history, and retry retain the first-try record', { timeout: 75_000 }, async () => {
  const opened = await open({ width: 820 });
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'forward');
    await present(page);
    const wrong = [...round.expected]; wrong[0] = (wrong[0] + 1) % 16;
    await enter(page, round, wrong);
    await check(page, { correct: false });
    const missed = await saved(page, value => value?.session?.answered);
    await page.screenshot({ path: resolve(shots, 'wrong-tablet.png'), fullPage: true });
    assert.equal(missed.session.history[0].correct, false);
    assert.equal(missed.tasks.forward.span, 2);
    await assertNoPlaintext(page, missed);
    await page.reload();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: fixture.content.title, exact: true }).count(), 0);
    await unlock(page);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await page.getByRole('button', { name: /^Replay sequence/ }).waitFor();
    assert.deepEqual(await saved(page), missed);
    await present(page, { replay: true });
    await enter(page, round);
    await check(page);
    const redeemed = await saved(page, value => value?.redeemed.includes(round.id));
    assert.equal(redeemed.session.history.length, 1);
    assert.equal(redeemed.session.history[0].correct, false);
    assert.deepEqual(redeemed.tasks, missed.tasks, 'A successful retry never changes adaptive statistics.');
    assert.equal(await page.getByRole('button', { name: 'Review round 1: missed on first try', exact: true }).count(), 1);
    const beforeReview = await saved(page, value => value?.session?.cursor === 1);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review round 1: missed on first try', exact: true }).click();
    await page.getByRole('button', { name: 'Close review', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Row \d+, column \d+$/ }).count(), 0, 'Historical review contains no response controls.');
    await page.getByRole('button', { name: 'Close review', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Review round 1: missed on first try');
    assert.deepEqual(await saved(page), beforeReview, 'Opening and closing history never changes progress.');
    await page.getByRole('button', { name: /^Lock/ }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 0);
    await assertNoPlaintext(page, beforeReview);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('pause and hidden-document interruption replay presentation; recall pause retains choices', { timeout: 75_000 }, async () => {
  const opened = await open({ width: 620 });
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'forward');
    await page.getByRole('button', { name: /^Watch the sequence/ }).click();
    await page.getByRole('status').filter({ hasText: /^Watch$/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Row \d+, column \d+$/ }).count(), 0);
    await page.getByRole('button', { name: /^Continue →$/ }).click();
    await page.getByRole('status').filter({ hasText: /^Hold it in mind$/ }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('button', { name: /^Continue →$/ }).click();
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, round, round.expected.slice(0, 1));
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByText('Continue with the choices you already made.', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Continue →$/ }).click();
    await page.getByLabel(`1 of ${round.span} places entered`, { exact: true }).waitFor();
    await enter(page, round, round.expected.slice(1));
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(result.session.history[0].correct, true);
    assert.equal(result.session.history.length, 1);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('390px touch and keyboard play remain legible with no horizontal overflow', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 390, height: 844, touch: true });
  const { context, page } = opened;
  try {
    await assertFits(page, 'locked phone');
    await page.screenshot({ path: resolve(shots, 'locked-phone.png'), fullPage: true });
    await unlock(page);
    await assertFits(page, 'unlocked phone');
    await page.screenshot({ path: resolve(shots, 'library-phone.png'), fullPage: true });
    const round = await startFocus(page, 'forward');
    await assertFits(page, 'phone example');
    await present(page);
    await assertFits(page, 'phone recall');
    await page.screenshot({ path: resolve(shots, 'recall-phone.png'), fullPage: true });
    await enter(page, round, round.expected.slice(0, 1), { touch: true });
    await page.keyboard.press('Backspace');
    await page.getByLabel(`0 of ${round.span} places entered`, { exact: true }).waitFor();
    await enter(page, round, round.expected, { keyboard: true });
    await page.getByRole('button', { name: 'Check sequence', exact: true }).focus();
    await page.keyboard.press('Enter');
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(advanced.session.history.length, 1);
    assert.equal(advanced.tasks.forward.attempts, 1);
    await assertAutoPresentation(page);
    await assertFits(page, 'phone feedback');
    await page.screenshot({ path: resolve(shots, 'advance-phone.png'), fullPage: true });
    await assertClean(opened);
  } finally { await context.close(); }
});

test('390px by 600px play keeps the automatically presented visual board fully in view', { timeout: 45_000 }, async () => {
  const opened = await open({ width: 390, height: 600, touch: true });
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'forward');
    await present(page);
    await enter(page, round, round.expected, { touch: true });
    await check(page);
    await page.getByRole('status').filter({ hasText: /^Watch$/ }).waitFor();
    const board = await page.getByLabel('Four by four memory board', { exact: true }).boundingBox();
    assert.ok(board, 'The next visual challenge has a visible board.');
    assert.ok(board.y >= 0, `The board starts ${board.y}px above the short viewport.`);
    assert.ok(board.y + board.height <= 600, `The board ends at ${board.y + board.height}px below the short viewport.`);
    await page.screenshot({ path: resolve(shots, 'watch-short-phone.png'), fullPage: false });
    await assertClean(opened);
  } finally { await context.close(); }
});

test('mixed sessions retain Sound off at a visual-to-listening transition until listening is explicitly enabled', { timeout: 60_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    let session;
    for (let index = 0; index < 100; index++) {
      const candidate = createProgress(`browser-muted-transition-${index}`, 24, { modality: 'mixed' });
      if (VISUAL_TASK_IDS.includes(candidate.plan[0]) && AUDIO_TASK_IDS.includes(candidate.plan[1])) {
        session = candidate;
        break;
      }
    }
    assert.ok(session, 'The fixture includes a visual-to-listening transition.');
    await seedSession(page, session);
    await page.getByRole('button', { name: 'Sound on', exact: true }).click();
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await assertAutoPresentation(page);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, session.active);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    const auditory = advanced.session.active;
    assert.equal(auditory.answerKind, 'ordered-digits');
    assert.equal(await page.getByRole('button', { name: 'Sound off', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SOUND_PREFERENCE_KEY), 'false', 'Automatic progression retains the stored sound preference.');
    await page.getByRole('button', { name: /^Turn sound on & listen/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    assert.equal(advanced.session.history.length, 1);
    assert.equal(advanced.session.answered, false);
    assert.equal(advanced.tasks[session.active.task].attempts, 1);
    assert.equal(advanced.tasks[auditory.task].attempts, 0, 'The unheard next challenge remains unscored.');
    assert.deepEqual(await saved(page), advanced);
    await present(page, { audio: true });
    assert.equal(await page.getByRole('button', { name: 'Sound on', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SOUND_PREFERENCE_KEY), 'true');
    await enter(page, auditory);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 2);
    assert.equal(completed.session.history.length, 2);
    assert.equal(completed.tasks[auditory.task].attempts, 1);
    assert.equal(completed.session.history[1].correct, true);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('ending an unfinished session preserves adaptive records and enables another exercise', { timeout: 30_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'forward');
    await present(page);
    await enter(page, round);
    await check(page);
    const before = await saved(page, value => value?.session?.cursor === 1);
    await page.getByRole('button', { name: /Save & exit/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Practice Exercise symbols', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    const ended = await saved(page, value => value?.session === null);
    assert.deepEqual(ended.tasks, before.tasks);
    assert.deepEqual(ended.logs, before.logs, 'A partial session does not count as completed.');
    assert.equal(ended.tasks.forward.attempts, 1);
    assert.equal(ended.tasks.forward.correct, 1);
    await startFocus(page, 'symbols');
    const restarted = await saved(page, value => value?.session?.focusedTask === 'symbols');
    assert.deepEqual(restarted.tasks, before.tasks);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('resetting device progress confirms before erasing the encrypted session', { timeout: 30_000 }, async () => {
  const opened = await open({ width: 390 });
  const { context, page } = opened;
  try {
    const session = createProgress('browser-reset', 8, { focusedTask: 'forward' });
    const before = await seedSession(page, recordFirstAttempt(session, session.active, true));
    await page.getByRole('button', { name: 'Reset device progress', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await saved(page), before, 'Cancelling reset preserves encrypted progress.');
    await page.getByRole('button', { name: 'Reset device progress', exact: true }).click();
    await page.getByRole('button', { name: 'Erase lab progress', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Memory Lab progress reset.' }).waitFor();
    assert.equal(await readSaved(page), null);
    assert.equal(await page.getByRole('button', { name: /^Continue session/ }).count(), 0);
    await startFocus(page, 'forward');
    const restarted = await saved(page, value => value?.session?.cursor === 0);
    assert.equal(restarted.tasks.forward.attempts, 0);
    assert.equal(restarted.tasks.forward.correct, 0);
    assert.equal(restarted.tasks.forward.span, 3);
    assert.deepEqual(restarted.logs, []);
    await assertNoPlaintext(page, restarted);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('optional real encrypted pack unlocks and completes an actual neural-audio round', { skip: !process.env.MEMORY_LAB_TEST_PASSWORD, timeout: 45_000 }, async () => {
  const opened = await open({ realPack: true });
  const { context, page } = opened;
  try {
    await page.getByLabel('Password', { exact: true }).fill(process.env.MEMORY_LAB_TEST_PASSWORD);
    await page.getByRole('button', { name: /^Unlock/ }).click();
    await page.getByRole('button', { name: /^Practice / }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 11);
    await page.screenshot({ path: resolve(shots, 'real-pack-desktop.png'), fullPage: true });
    const manifest = JSON.parse(await readFile(new URL('working-memory/vault/manifest.json', new URL('../../out/', import.meta.url)), 'utf8'));
    const key = await deriveSearchKey(process.env.MEMORY_LAB_TEST_PASSWORD, manifest.encryption);
    await page.getByRole('button', { name: /^Practice / }).nth(8).click();
    const initial = await saved(page, value => !!value?.session?.active, key);
    const round = initial.session.active;
    assert.equal(round.answerKind, 'ordered-digits');
    await present(page, { audio: true });
    await enter(page, round);
    await check(page, { key });
    const completed = await saved(page, value => value?.session?.cursor === 1, key);
    assert.equal(completed.session.history[0].correct, true);
    assert.equal(completed.tasks[round.task].attempts, 1);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.equal(stored.includes(process.env.MEMORY_LAB_TEST_PASSWORD), false);
    await page.screenshot({ path: resolve(shots, 'real-audio-feedback.png'), fullPage: true });
    await assertClean(opened);
  } finally { await context.close(); }
});
