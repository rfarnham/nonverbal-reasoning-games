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
import { AUDIO_TASK_IDS, RESEARCH_PROFILE, TASK_IDS, VISUAL_TASK_IDS, advanceRound, createProgress, finalTrackingPositions, recordFirstAttempt } from '../../app/lab/working-memory/engine.ts';
import { conditionKey, fresh, normalizeSaved, restore as restoreSaved, selectTaskStates, taskTotals } from '../../app/lab/working-memory/progress.ts';
import { digitTaskForVariant, digitVariantKey, enumerateDigitVariants, normalizeDigitVariant } from '../../app/lab/working-memory/digit-options.ts';
import { MEMORY_PROGRESS_STORAGE_KEY, memoryAudioContext, memoryContentContext, validateMemoryContent } from '../../app/lab/working-memory/vault.ts';

// Ordinary browser CI exercises the production cryptographic flow with a freshly
// encrypted synthetic pack. Neither the real pack nor its password is a fixture.
const base = '/nonverbal-reasoning-games';
const route = `${base}/lab/working-memory/`;
const root = resolve(fileURLToPath(new URL('../../out/', import.meta.url)));
const shots = resolve(fileURLToPath(new URL('../../outputs/working-memory/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/x-component', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const shapes = ['circle', 'triangle', 'square', 'diamond', 'cross', 'star'];
const orderCueLabels = {
  reverse: 'Recall in reverse order, from last to first.',
  ascending: 'Recall in ascending order, from the smallest number to the largest.',
  descending: 'Recall in descending order, from the largest number to the smallest.',
};
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

async function open({ width = 1200, height = 900, touch = false, reducedMotion = 'reduce', realPack = false, holdManifest, speech } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion });
  if (speech) await installSpeechMock(context, speech);
  const page = await context.newPage(), errors = [], external = [], requests = [];
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    requests.push({ method: request.method(), url: request.url() });
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:') && !request.url().startsWith('blob:') && request.url() !== canonicalFavicon) external.push(request.url());
  });
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
  return { context, page, errors, external, requests };
}
// These cases exercise the real microphone/worklet lifecycle with a local tone
// stream and replace only the recognizer worker. Actual model inference has its
// own integration test; no browser fixture claims to recognize human speech.
async function installSpeechMock(context, options) {
  await context.addInitScript(config => {
    const NativeWorker = window.Worker;
    const NativeAudioContext = window.AudioContext;
    const heldFinals = [];
    const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const state = {
      microphoneRequests: 0, activeTracks: 0, stoppedTracks: 0, nativeSpeechRequests: 0,
      workersCreated: 0, workersTerminated: 0, messages: [], results: [], modelUrls: [],
      holdFinal: Boolean(config.holdFinal),
      queue(digits, settings = {}) { this.results.push({ digits, confidence: 0.99, ...settings }); },
      releaseFinals() { heldFinals.splice(0).forEach(deliver => deliver()); },
      failWorker: () => undefined,
    };
    window.__speechTest = state;
    const nativeSpeech = class {
      constructor() { state.nativeSpeechRequests++; throw new Error('Native speech services are forbidden in this test.'); }
    };
    window.SpeechRecognition = nativeSpeech;
    window.webkitSpeechRecognition = nativeSpeech;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      state.microphoneRequests++;
      if (config.denyMicrophone) throw new DOMException('Synthetic microphone denial', 'NotAllowedError');
      const source = new NativeAudioContext();
      const oscillator = source.createOscillator(), gain = source.createGain(), destination = source.createMediaStreamDestination();
      gain.gain.value = 0.1;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await source.resume();
      for (const track of destination.stream.getTracks()) {
        state.activeTracks++;
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          if (!stopped) {
            stopped = true;
            state.activeTracks--;
            state.stoppedTracks++;
            oscillator.stop();
            void source.close();
          }
          stop();
        };
      }
      return destination.stream;
    } });
    function segment(response) {
      const tokens = response.text === undefined ? response.digits.map(digit => words[digit]) : response.text.split(/\s+/).filter(Boolean);
      return { text: tokens.join(' '), result: tokens.map((word, index) => ({ word, conf: response.confidence, start: index * 0.25, end: index * 0.25 + 0.2 })) };
    }
    window.Worker = class extends EventTarget {
      constructor(url, workerOptions) {
        super();
        const address = new URL(String(url), location.href);
        if (!address.pathname.endsWith('/models/speech/vosk-worker-v0.0.8.js')) return new NativeWorker(url, workerOptions);
        if (address.origin !== location.origin) throw new Error('Recognizer worker left this origin.');
        this.responses = new Map();
        this.endpointSent = new Set();
        this.onmessage = null;
        this.terminated = false;
        state.failWorker = () => this.emit({ event: 'error', error: 'Synthetic local worker failure' });
        state.workersCreated++;
      }
      emit(data) {
        if (this.terminated) return;
        const event = new MessageEvent('message', { data });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
      postMessage(message) {
        state.messages.push({ ...message, ...(message.data instanceof Float32Array ? { data: { length: message.data.length } } : {}) });
        if (message.action === 'load') {
          state.modelUrls.push(message.modelUrl);
          setTimeout(() => this.emit({ event: 'load', result: !config.loadFailure }), 0);
        } else if (message.action === 'create') this.responses.set(message.recognizerId, state.results.shift() ?? { digits: [], confidence: 0.99 });
        else if (message.action === 'audioChunk') {
          const response = this.responses.get(message.recognizerId);
          if (response?.endpoint && !this.endpointSent.has(message.recognizerId)) {
            this.endpointSent.add(message.recognizerId);
            setTimeout(() => this.emit({ event: 'result', recognizerId: message.recognizerId, result: segment(response) }), 0);
          }
        } else if (message.action === 'retrieveFinalResult') {
          const response = this.responses.get(message.recognizerId) ?? { digits: [], confidence: 0.99 };
          const deliver = () => this.emit({ event: 'finalresult', recognizerId: message.recognizerId, result: response.endpoint ? { text: '', result: [] } : segment(response) });
          if (state.holdFinal) heldFinals.push(deliver);
          else setTimeout(deliver, 0);
        }
      }
      terminate() { if (!this.terminated) state.workersTerminated++; this.terminated = true; }
    };
  }, options);
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
async function seedSession(page, session, { legacy = false, inputMode = 'keypad', slow = false } = {}) {
  const settings = {
    slow, digitOrder: session.digitOrder ?? 'ascending', inputMode: session.digitVariant?.inputMode ?? inputMode,
    ...(session.profile === RESEARCH_PROFILE ? { digitVariant: session.digitVariant ?? fresh().digitVariant } : {}),
  };
  const data = session.profile === RESEARCH_PROFILE
    ? normalizeSaved({ ...fresh(), ...settings, session, tasks: session.tasks, sessionCondition: settings })
    : { version: 1, session, tasks: session.tasks, logs: [], redeemed: [], slow, ...(!legacy ? { digitOrder: session.digitOrder ?? 'ascending' } : {}) };
  return seedSaved(page, data);
}
async function seedSaved(page, data) {
  const encrypted = await encryptSearchBytes(new TextEncoder().encode(JSON.stringify(data)), fixture.key, progressContext);
  await page.evaluate(({ key, ciphertext }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, ciphertext }));
  }, { key: MEMORY_PROGRESS_STORAGE_KEY, ciphertext: Buffer.from(encrypted).toString('base64') });
  await page.reload();
  await page.getByLabel('Password', { exact: true }).waitFor();
  await unlock(page);
  const restored = await saved(page);
  assert.deepEqual(restoreSaved(restored), restoreSaved(data), 'Encrypted fixtures retain their exact session and condition records through migration.');
  return restored;
}
async function startFocus(page, task) {
  let selectedTask = task;
  if (AUDIO_TASK_IDS.includes(task)) {
    const order = task === 'sort-digits'
      ? (await page.getByLabel('Recall order', { exact: true }).inputValue()) === 'descending' ? 'descending' : 'ascending'
      : 'reverse';
    const inputMode = await page.getByLabel('Answer with', { exact: true }).inputValue();
    const variant = normalizeDigitVariant({ order, inputMode, keypad: task === 'hidden-digits' ? 'hidden' : 'visible' });
    await selectDigits(page, variant);
    selectedTask = digitTaskForVariant(variant);
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).click();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
  } else {
    await page.getByRole('button', { name: `Practice Exercise ${task}`, exact: true }).click();
    await page.getByRole('heading', { name: `Exercise ${task}`, exact: true }).waitFor();
  }
  const state = await saved(page, value => value?.session?.focusedTask === selectedTask);
  assert.equal(state.session.length, 8);
  assert.equal(state.session.cursor, 0);
  assert.equal(state.session.answered, false);
  return state.session.active;
}
async function selectDigits(page, variant) {
  await page.getByLabel('Recall order', { exact: true }).selectOption(variant.order);
  await page.getByLabel('Answer with', { exact: true }).selectOption(variant.inputMode);
  const visibility = page.getByLabel('Keypad while listening', { exact: true });
  if (variant.inputMode === 'keypad') await visibility.selectOption(variant.keypad);
  else assert.equal(await visibility.count(), 0, 'Spoken answers have no irrelevant keypad option.');
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
  for (const secret of [fixture.password, fixture.content.title, fixture.content.intro, fixture.content.sources[0].title, state?.session?.seed, '"sequence"', '"expected"', '"transcript"', '"digits"']) {
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
function digitTotals(data) {
  const restored = restoreSaved(data);
  assert.ok(restored);
  const totals = taskTotals(restored);
  return AUDIO_TASK_IDS.reduce((sum, task) => ({ attempts: sum.attempts + totals[task].attempts, correct: sum.correct + totals[task].correct }), { attempts: 0, correct: 0 });
}
async function prepareSpeech(page) {
  await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
  await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
}
async function presentForSpeech(page) {
  await page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen)/ }).click();
  await page.getByRole('button', { name: 'Record answer', exact: true }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'Digit keypad', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 0);
  assert.equal(await page.getByLabel(/^\d+ of \d+ places entered$/).count(), 0, 'Spoken recall has no visual answer slots.');
}
async function recordSpeech(page, digits, settings = {}, { again = false } = {}) {
  const previous = await page.evaluate(({ digits, settings }) => {
    window.__speechTest.queue(digits, settings);
    return window.__speechTest.messages.filter(message => message.action === 'audioChunk').length;
  }, { digits, settings });
  await page.getByRole('button', { name: again ? 'Record again' : 'Record answer', exact: true }).click();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor();
  await page.waitForFunction(count => window.__speechTest.messages.filter(message => message.action === 'audioChunk').length > count, previous);
}
async function stopSpeech(page) {
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const review = page.getByRole('group', { name: 'Recognized answer', exact: true });
  await review.waitFor();
  assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0, 'Microphone tracks stop before the recognition review.');
  return (await review.getByRole('listitem').allTextContents()).map(text => Number(text.trim()));
}
async function assertLocalSpeech(opened) {
  const state = await opened.page.evaluate(() => ({
    nativeSpeechRequests: window.__speechTest.nativeSpeechRequests,
    modelUrls: window.__speechTest.modelUrls,
    messages: window.__speechTest.messages,
  }));
  assert.equal(state.nativeSpeechRequests, 0, 'No browser speech service is used.');
  assert.ok(state.modelUrls.every(url => new URL(url).origin === origin), 'The speech model stays on the page origin.');
  assert.ok(opened.requests.every(request => request.method === 'GET' || request.method === 'HEAD'), 'Microphone audio is never posted to a server.');
  const expectedGrammar = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', '[unk]'];
  for (const message of state.messages.filter(message => message.action === 'create')) {
    assert.deepEqual(JSON.parse(message.grammar), expectedGrammar, 'Every recording uses the full digit vocabulary, independent of the challenge answer.');
    for (const key of ['expected', 'sequence', 'answer', 'hints']) assert.equal(Object.hasOwn(message, key), false);
  }
  await assertClean(opened);
}

async function motionFrames(board, markerIndex) {
  return board.evaluate((element, index) => new Promise(resolve => {
    const frames = [], start = performance.now();
    function sample(now) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      const target = index === undefined ? element : element.querySelectorAll('button')[index];
      const box = target.getBoundingClientRect();
      frames.push({ angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, x: box.x + box.width / 2, y: box.y + box.height / 2 });
      if (now - start < 900) requestAnimationFrame(sample);
      else resolve(frames);
    }
    requestAnimationFrame(sample);
  }), markerIndex);
}
async function assertTrackingCenters(board, positions) {
  const geometry = await board.evaluate(element => {
    const box = element.getBoundingClientRect();
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      centers: [...element.querySelectorAll('button')].map(marker => {
        const rect = marker.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }),
    };
  });
  assert.equal(geometry.centers.length, positions.length);
  positions.forEach((cell, id) => {
    const expectedX = geometry.box.x + (cell % 4 + 0.5) * geometry.box.width / 4;
    const expectedY = geometry.box.y + (Math.floor(cell / 4) + 0.5) * geometry.box.height / 4;
    assert.ok(Math.abs(geometry.centers[id].x - expectedX) < 3, `Marker ${id} ends in the expected column.`);
    assert.ok(Math.abs(geometry.centers[id].y - expectedY) < 3, `Marker ${id} ends in the expected row.`);
  });
}

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
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 9);
    await assertNoPlaintext(page);
    await assertClean(opened);
  } finally { releaseManifest(); await context.close(); }
});

test('one Digits game exposes nine unique saved variants and omits keypad options for spoken answers', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 390, speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 9);
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).count(), 1);
    for (const task of AUDIO_TASK_IDS) assert.equal(await page.getByRole('heading', { name: `Exercise ${task}`, exact: true }).count(), 0);
    const variants = enumerateDigitVariants(), selectedKeys = new Set();
    assert.equal(variants.length, 9);
    for (const variant of variants) {
      await selectDigits(page, variant);
      if (variant.inputMode === 'spoken' && await page.getByRole('button', { name: 'Download speech model', exact: true }).count()) {
        await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
        await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
      }
      const configured = await saved(page, value => value?.digitVariant && digitVariantKey(value.digitVariant) === digitVariantKey(variant));
      assert.deepEqual(configured.digitVariant, variant);
      await assertFits(page, 'Digits options on phone');
      await page.getByRole('button', { name: 'Practice Digits', exact: true }).click();
      await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
      const state = await saved(page, value => value?.session?.digitVariant && digitVariantKey(value.session.digitVariant) === digitVariantKey(variant));
      assert.deepEqual(state.session.active.digitVariant, variant);
      assert.equal(state.session.focusedTask, digitTaskForVariant(variant));
      assert.equal(state.session.plan.length, 8);
      assert.ok(state.session.plan.every(task => task === digitTaskForVariant(variant)));
      selectedKeys.add(digitVariantKey(state.session.digitVariant));
      await page.getByRole('button', { name: /Save & exit/ }).click();
      await page.getByRole('button', { name: 'End session', exact: true }).click();
    }
    assert.equal(selectedKeys.size, 9, 'Each advertised combination has a distinct playable identity.');
    for (const order of ['reverse', 'ascending', 'descending']) assert.equal(variants.filter(variant => variant.order === order).length, 3);
    await selectDigits(page, { order: 'reverse', inputMode: 'keypad', keypad: 'visible' });
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    const fromVisible = await saved(page, value => value?.digitVariant?.inputMode === 'spoken');
    await selectDigits(page, { order: 'reverse', inputMode: 'keypad', keypad: 'hidden' });
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    const fromHidden = await saved(page, value => value?.digitVariant?.inputMode === 'spoken');
    assert.deepEqual(fromVisible.digitVariant, fromHidden.digitVariant, 'Keypad history cannot create a second spoken variant.');
    assert.equal(conditionKey('reverse-digits', fromVisible), conditionKey('hidden-digits', fromHidden));
    assert.deepEqual(digitTotals(fromHidden), { attempts: 0, correct: 0 });
    assert.equal(await page.getByLabel('Keypad while listening', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

for (const order of ['ascending', 'descending']) {
  test(`hidden ${order} Digits withholds keypad labels during listening and scores the selected rule`, { timeout: 45_000 }, async () => {
    const opened = await open({ width: 390 });
    const { context, page } = opened;
    try {
      await unlock(page);
      const variant = { order, inputMode: 'keypad', keypad: 'hidden' };
      await selectDigits(page, variant);
      await page.getByRole('button', { name: 'Practice Digits', exact: true }).click();
      const initial = await saved(page, value => value?.session?.active?.digitVariant?.order === order);
      const round = initial.session.active;
      assert.deepEqual(round.digitVariant, variant);
      await page.getByRole('button', { name: /^Listen to the sequence/ }).click();
      await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Hidden keypad button', exact: true }).count(), 9);
      assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 0);
      await page.getByRole('group', { name: orderCueLabels[order], exact: true }).waitFor();
      await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 9);
      const expected = [...round.sequence].sort((a, b) => order === 'ascending' ? a - b : b - a);
      await enter(page, round, expected);
      await check(page);
      const result = await saved(page, value => value?.session?.cursor === 1);
      assert.equal(result.session.history[0].correct, true);
      assert.deepEqual(result.session.active.digitVariant, variant);
      assert.deepEqual(digitTotals(result), { attempts: 1, correct: 1 });
      await assertClean(opened);
    } finally { await context.close(); }
  });
}

test('listening sessions repeat the chosen Digits variant and mixed sessions retain half listening rounds', { timeout: 30_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    await unlock(page);
    const variant = { order: 'ascending', inputMode: 'keypad', keypad: 'hidden' };
    await selectDigits(page, variant);
    await page.getByRole('button', { name: 'Listening only', exact: true }).click();
    await page.getByRole('button', { name: /^Start a session/ }).click();
    const audio = await saved(page, value => value?.session?.modality === 'audio');
    assert.equal(audio.session.plan.length, 24);
    assert.ok(audio.session.plan.every(task => task === digitTaskForVariant(variant)), 'The plan contains the chosen variant without cycling old aliases.');
    assert.deepEqual(audio.session.digitVariant, variant);
    await page.getByRole('button', { name: /Save & exit/ }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('button', { name: 'Visual + listening', exact: true }).click();
    await page.getByRole('button', { name: /^Start a session/ }).click();
    const mixed = await saved(page, value => value?.session?.modality === 'mixed');
    const auditory = mixed.session.plan.filter(task => AUDIO_TASK_IDS.includes(task));
    assert.equal(mixed.session.plan.length, 24);
    assert.equal(auditory.length, 12);
    assert.ok(auditory.every(task => task === digitTaskForVariant(variant)));
    assert.equal(mixed.session.plan.filter(task => VISUAL_TASK_IDS.includes(task)).length, 12);
    assert.deepEqual(mixed.session.digitVariant, variant);
    assert.deepEqual(digitTotals(mixed), { attempts: 0, correct: 0 });
    await assertClean(opened);
  } finally { await context.close(); }
});

test('a recycled Digits sequence remains a new unredeemed challenge after reload', { timeout: 45_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    const digitVariant = { order: 'ascending', inputMode: 'keypad', keypad: 'hidden' };
    const preferences = { ...fresh(), digitVariant, inputMode: 'keypad', digitOrder: 'ascending' };
    let session = createProgress('browser-digit-cycle', 48, { modality: 'audio', profile: RESEARCH_PROFILE, tasks: selectTaskStates(preferences), digitVariant });
    for (let index = 0; index < 36; index++) session = advanceRound(recordFirstAttempt(session, session.active, false));
    const round = session.active;
    const redeemed = session.history.map(result => result.round.id);
    assert.ok(session.history.some(result => result.round.fingerprint === round.fingerprint), 'The small load has exhausted its distinct sorting sequences.');
    assert.equal(redeemed.includes(round.id), false, 'A new occurrence has its own identity.');
    const data = normalizeSaved({ ...preferences, session, tasks: session.tasks, redeemed, sessionCondition: { slow: false, inputMode: 'keypad', digitOrder: 'ascending', digitVariant } });
    await seedSaved(page, data);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, round, [...round.expected].reverse());
    await check(page, { correct: false });
    const missed = await saved(page, value => value?.session?.answered);
    assert.equal(missed.session.cursor, 36);
    assert.equal(missed.session.history.length, 37);
    assert.equal(missed.redeemed.includes(round.id), false);
    await page.reload();
    await unlock(page);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await page.getByRole('button', { name: 'Replay sequence', exact: true }).waitFor();
    assert.deepEqual(await saved(page), missed, 'Earlier redemption cannot solve or skip the recycled occurrence.');
    await assertClean(opened);
  } finally { await context.close(); }
});

test('active earlier spoken aliases resume exactly while their histories count once in the Digits family', { timeout: 60_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    let earlier = createProgress('browser-old-spoken-reverse', 8, { profile: RESEARCH_PROFILE, focusedTask: 'reverse-digits', tasks: selectTaskStates(fresh()) });
    earlier = recordFirstAttempt(earlier, earlier.active, true);
    const oldHiddenTasks = { ...earlier.tasks, 'hidden-digits': { ...earlier.tasks['hidden-digits'], span: 6 } };
    let session = createProgress('browser-old-spoken-hidden', 8, { profile: RESEARCH_PROFILE, focusedTask: 'hidden-digits', tasks: oldHiddenTasks });
    session = recordFirstAttempt(session, session.active, true);
    const oldSettings = { slow: false, inputMode: 'spoken', digitOrder: 'ascending' };
    const oldData = {
      version: 2, ...oldSettings, session, tasks: session.tasks, legacyTasks: fresh().legacyTasks,
      conditions: Object.fromEntries(TASK_IDS.map(task => [conditionKey(task, oldSettings), { ...session.tasks[task] }])),
      sessionCondition: oldSettings, logs: [], redeemed: [],
    };
    await seedSaved(page, oldData);
    assert.deepEqual(digitTotals(await saved(page)), { attempts: 2, correct: 2 });
    assert.match(await page.getByRole('article', { name: 'Digits', exact: true }).innerText(), /\bSpan 6\b/, 'The card displays the active legacy alias load.');
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    const legacyRow = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Digits', exact: true }) });
    assert.equal(await legacyRow.getByRole('cell').first().textContent(), '6', 'Progress and Continue refer to the same legacy span.');
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
    await page.getByRole('button', { name: /^Continue session/ }).click();
    const resumed = await saved(page, value => value?.session?.cursor === 1);
    assert.deepEqual(resumed.session, advanceRound(session), 'Migration preserves the old plan, IDs, answers, and adaptive state.');
    assert.equal(resumed.session.digitVariant, undefined);
    assert.deepEqual(digitTotals(resumed), { attempts: 2, correct: 2 });
    await assertAutoPresentation(page);
    await page.getByRole('button', { name: /Save & exit/ }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    const round = await startFocus(page, 'reverse-digits');
    const canonical = await saved(page, value => !!value?.session?.digitVariant);
    assert.deepEqual(canonical.session.digitVariant, { order: 'reverse', inputMode: 'spoken', keypad: 'none' });
    assert.equal(canonical.session.initialTasks[round.task].attempts, 0, 'Two archived trajectories do not become duplicate adaptive attempts.');
    assert.equal(canonical.session.initialTasks[round.task].balance, 0, 'Conflicting old staircases are not combined into a new calibration.');
    await presentForSpeech(page);
    await recordSpeech(page, round.expected);
    assert.deepEqual(await stopSpeech(page), round.expected);
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.deepEqual(digitTotals(result), { attempts: 3, correct: 3 }, 'Each archived attempt and the new canonical attempt is counted once.');
    assert.equal(result.archivedConditions[conditionKey('reverse-digits', oldSettings)].attempts, 1);
    assert.equal(result.archivedConditions[conditionKey('hidden-digits', oldSettings)].attempts, 1);
    assert.equal(result.conditions[conditionKey('hidden-digits', result)].attempts, 1);
    assert.equal(conditionKey('hidden-digits', result), conditionKey('reverse-digits', result));
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
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

test('Hidden Homes changes the visible encoding load with its research-profile span', { timeout: 60_000 }, async () => {
  const encodedCounts = [];
  for (const span of [2, 5]) {
    const opened = await open();
    const { context, page } = opened;
    try {
      const tasks = selectTaskStates(fresh());
      tasks.locations.span = span;
      const session = createProgress(`browser-binding-load-${span}`, 8, { profile: RESEARCH_PROFILE, focusedTask: 'locations', tasks });
      await seedSession(page, session);
      await page.getByRole('button', { name: /^Continue session/ }).click();
      await page.getByRole('status').filter({ hasText: /^Watch$/ }).waitFor();
      const board = page.getByLabel('Four by four memory board', { exact: true });
      const count = await board.locator('svg').count();
      encodedCounts.push(count);
      assert.equal(count, span, 'The study display contains exactly the bindings that define this load.');
      assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
      assert.equal(await board.locator('svg').count(), 0, 'Shape locations are hidden during recall.');
      await enter(page, session.active);
      await check(page);
      const result = await saved(page, value => value?.session?.cursor === 1);
      assert.equal(result.session.history[0].correct, true);
      assert.equal(result.tasks.locations.attempts, 1);
      await assertClean(opened);
    } finally { await context.close(); }
  }
  assert.deepEqual(encodedCounts, [2, 5]);
});

for (const { task, width } of [{ task: 'rotation', width: 1200 }, { task: 'rotation', width: 390 }, { task: 'tracking', width: 1200 }]) {
  test(`${task}${width === 390 ? ' phone' : ''}: smooth travel is visible, interruption replays safely, and final targets score correctly`, { timeout: 60_000 }, async () => {
    const opened = await open({ width, height: width === 390 ? 844 : 900, reducedMotion: 'no-preference' });
    const { context, page } = opened;
    try {
      await unlock(page);
      const round = await startFocus(page, task);
      const initial = await saved(page);
      const board = page.getByLabel(task === 'rotation' ? 'Four by four memory board' : 'Moving targets on a four by four board', { exact: true });
      await page.getByRole('button', { name: /^Watch the sequence/ }).click();
      await page.getByRole('status').filter({ hasText: task === 'rotation' ? /^Quarter turn/ : /^Follow the circles$/ }).waitFor();
      const frames = await motionFrames(board, task === 'tracking' ? round.moves[0][0] : undefined);
      if (task === 'rotation') {
        const intermediate = frames.filter(frame => Math.abs(frame.angle) > 1 && Math.abs(frame.angle) < 89);
        assert.ok(intermediate.length >= 3, 'The board visibly passes through intermediate angles instead of jumping a quarter turn.');
        assert.ok(new Set(intermediate.map(frame => Math.round(frame.angle))).size >= 3, 'Several different intermediate turn angles are rendered.');
        const [boardBox, phaseBox, slotsBox] = await Promise.all([
          board.boundingBox(),
          page.getByRole('status').filter({ hasText: /^Quarter turn/ }).boundingBox(),
          page.getByLabel(`0 of ${round.span} places entered`, { exact: true }).boundingBox(),
        ]);
        assert.ok(boardBox && phaseBox && slotsBox, 'The turn, phase label, and response slots remain in the layout.');
        assert.ok(boardBox.y >= phaseBox.y + phaseBox.height - 1, 'An intermediate turn stays below its phase instruction.');
        assert.ok(boardBox.y + boardBox.height <= slotsBox.y + 1, 'An intermediate turn stays above the response slots.');
        assert.ok(boardBox.x >= 0 && boardBox.x + boardBox.width <= width + 1, 'An intermediate turn remains within the viewport width.');
      } else {
        const traveled = frames.filter(frame => Math.hypot(frame.x - frames[0].x, frame.y - frames[0].y) > 2);
        assert.ok(traveled.length >= 3, 'The moving marker leaves its starting position during observation.');
        assert.ok(new Set(traveled.map(frame => `${Math.round(frame.x)},${Math.round(frame.y)}`)).size >= 3, 'The marker follows a visible path through intermediate positions.');
      }
      assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0, 'Recall remains locked during travel.');
      await page.screenshot({ path: resolve(shots, `${task}-smooth${width === 390 ? '-phone' : ''}.png`), fullPage: false });
      await page.keyboard.press('Escape');
      await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
      assert.deepEqual(await saved(page), initial, 'Interrupting movement never scores or advances the round.');
      await page.getByRole('button', { name: /^Continue →$/ }).click();
      await page.getByRole('status').filter({ hasText: /^Watch$/ }).waitFor();
      if (task === 'rotation') {
        const angle = await board.evaluate(element => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
          return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        });
        assert.ok(Math.abs(angle) < 0.5, 'An interrupted turn replays from its original orientation.');
      } else await assertTrackingCenters(board, round.positions);
      await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
      if (width === 390) await assertFits(page, 'rotated phone recall');
      if (task === 'rotation') {
        const angle = await board.evaluate(element => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
          return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        });
        const expectedAngle = round.rotation === 'clockwise' ? 90 : -90;
        assert.ok(Math.abs(angle - expectedAngle) < 0.5, 'The complete turn reaches its exact intended orientation.');
      } else await assertTrackingCenters(board, finalTrackingPositions(round));
      await enter(page, round);
      await check(page);
      const result = await saved(page, value => value?.session?.cursor === 1);
      assert.equal(result.session.history.length, 1);
      assert.equal(result.session.history[0].correct, true);
      assert.equal(result.tasks[task].attempts, 1);
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
      const cue = page.getByRole('group', { name: orderCueLabels[task === 'sort-digits' ? 'ascending' : 'reverse'], exact: true });
      await cue.waitFor();
      const genericCue = await cue.innerHTML();
      assert.doesNotMatch(await cue.textContent(), /\d/, 'The order icon adds no printed digits to the auditory memory task.');
      const listen = page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen)/ });
      await listen.click();
      await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
      assert.equal(await cue.innerHTML(), genericCue, 'The order reminder stays visible and unchanged during audio presentation.');
      assert.equal(await page.getByRole('button', { name: 'Sound on', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
      if (task === 'hidden-digits') {
        assert.equal(await page.getByRole('button', { name: 'Hidden keypad button', exact: true }).count(), 9);
        assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 0);
      } else assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 9, 'The visible-keypad option retains its labels during listening.');
      await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
      assert.equal(await cue.innerHTML(), genericCue, 'The same order reminder remains during recall.');
      assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 9);
      await assertFits(page, `${task} phone recall`);
      for (const value of round.expected) await page.keyboard.press(String(value));
      await check(page);
      const result = await saved(page, value => value?.session?.cursor === 1);
      assert.equal(result.session.history[0].correct, true);
      assert.equal(result.tasks[task].attempts, 1);
      assert.notEqual(result.session.active.id, round.id);
      assert.equal(await cue.innerHTML(), genericCue, 'The icon shows a fixed rule example across different challenges, without adopting an active sequence or answer.');
      await assertNoPlaintext(page, result);
      await assertClean(opened);
    } finally { await context.close(); }
  });
}

test('Large to small selection keeps a descending order cue and accepts only descending recall', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 390 });
  const { context, page } = opened;
  try {
    await unlock(page);
    await page.getByLabel('Recall order', { exact: true }).selectOption('descending');
    const round = await startFocus(page, 'sort-digits');
    const initial = await saved(page);
    assert.equal(initial.digitOrder, 'descending');
    assert.equal(initial.session.digitOrder, 'descending');
    assert.equal(round.digitOrder, 'descending');
    const descending = [...round.sequence].sort((first, second) => second - first);
    const ascending = [...descending].reverse();
    assert.notDeepEqual(descending, ascending, 'The exercise distinguishes ascending and descending answers.');
    const cue = page.getByRole('group', { name: orderCueLabels.descending, exact: true });
    await cue.waitFor();
    const genericCue = await cue.innerHTML();
    assert.doesNotMatch(await cue.textContent(), /\d/, 'The descending icon adds no competing printed digits.');
    await present(page, { audio: true });
    assert.equal(await cue.innerHTML(), genericCue);
    await assertFits(page, 'descending phone recall');
    await enter(page, round, ascending);
    await check(page, { correct: false });
    const missed = await saved(page, value => value?.session?.answered);
    assert.equal(missed.session.history[0].correct, false, 'An ascending answer does not satisfy a descending challenge.');
    await present(page, { replay: true });
    await enter(page, round, descending);
    await check(page);
    const redeemed = await saved(page, value => value?.session?.cursor === 1 && value?.redeemed.includes(round.id));
    assert.equal(redeemed.session.history.length, 1);
    assert.equal(redeemed.session.history[0].correct, false, 'Correct descending replay preserves the original first-try result.');
    assert.deepEqual(redeemed.tasks, missed.tasks);
    assert.equal(redeemed.session.active.digitOrder, 'descending');
    assert.equal(await cue.innerHTML(), genericCue, 'The descending rule icon stays generic across rounds.');
    await page.getByRole('button', { name: /Save & exit/ }).click();
    const numberOrder = page.getByLabel('Recall order', { exact: true });
    assert.equal(await numberOrder.inputValue(), 'descending');
    assert.equal(await numberOrder.isDisabled(), true, 'A saved session retains its direction until it ends.');
    await page.reload();
    await unlock(page);
    assert.equal(await page.getByLabel('Recall order', { exact: true }).inputValue(), 'descending');
    assert.deepEqual(await saved(page), redeemed, 'Reload retains the descending session, original result, and preference.');
    await assertNoPlaintext(page, redeemed);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('spoken recall requires explicit local setup, hides live text, and confirms one immutable attempt', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 390, speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 });
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).isEnabled(), true, 'Visual exercises remain available without the speech model.');
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 }, 'Selecting Spoken alone does not load a model or open the microphone.');
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0, 'Model preparation does not request microphone access.');
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0, 'Listening to the stimulus does not activate recording.');
    await recordSpeech(page, round.expected, { endpoint: true });
    assert.equal(await page.getByRole('group', { name: 'Recognized answer', exact: true }).count(), 0, 'Endpoint recognition cannot display a live transcript during recall.');
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    await page.keyboard.press('1');
    assert.equal(await page.getByRole('group', { name: 'Digit keypad', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial);
    assert.deepEqual(await stopSpeech(page), round.expected, 'An endpoint result followed by an empty final flush is retained once.');
    assert.deepEqual(await saved(page), initial, 'Recognition alone does not score the participant.');
    await assertFits(page, 'spoken phone recognition review');
    await page.screenshot({ path: resolve(shots, 'spoken-review-phone.png'), fullPage: true });
    await page.getByRole('button', { name: 'Check sequence', exact: true }).dblclick({ delay: 25 });
    const completed = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(completed.session.history.length, 1);
    assert.equal(completed.session.history[0].correct, true);
    assert.equal(completed.conditions[conditionKey('reverse-digits', completed.sessionCondition)].attempts, 1);
    assert.equal(selectTaskStates(completed, { ...completed, inputMode: 'keypad', digitVariant: { ...completed.digitVariant, inputMode: 'keypad', keypad: 'visible' } })['reverse-digits'].attempts, 0);
    assert.deepEqual(digitTotals(completed), { attempts: 1, correct: 1 }, 'The shared digit condition contributes one attempt to family totals.');
    await assertAutoPresentation(page);
    assert.equal(await page.getByRole('group', { name: 'Recognized answer', exact: true }).count(), 0, 'A confirmed answer is cleared before the next challenge.');
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    await assertNoPlaintext(page, completed);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('uncertain and misheard spoken results can be replaced before any adaptive score is committed', { timeout: 60_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'hidden-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    await recordSpeech(page, round.expected, { confidence: 0.2 });
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Could not recognize a clear digit sequence/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial, 'Low-confidence recognition does not become a failed memory attempt.');
    const misheard = [...round.expected]; misheard[0] = misheard[0] % 9 + 1;
    await recordSpeech(page, misheard, {}, { again: true });
    assert.deepEqual(await stopSpeech(page), misheard);
    assert.deepEqual(await saved(page), initial, 'An unconfirmed transcript cannot change the first-try record.');
    await recordSpeech(page, round.expected, {}, { again: true });
    assert.deepEqual(await stopSpeech(page), round.expected);
    assert.deepEqual(await saved(page), initial);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(completed.session.history.length, 1);
    assert.equal(completed.session.history[0].correct, true);
    assert.equal(completed.tasks[round.task].attempts, 1);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 3);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 3);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a confirmed spoken answer with the wrong length is recorded as a memory miss', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    await presentForSpeech(page);
    const shorter = round.expected.slice(0, -1);
    await recordSpeech(page, shorter);
    assert.deepEqual(await stopSpeech(page), shorter);
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).isEnabled(), true);
    await check(page, { correct: false });
    const result = await saved(page, value => value?.session?.answered);
    assert.equal(result.session.cursor, 0);
    assert.equal(result.session.history.length, 1);
    assert.equal(result.session.history[0].correct, false);
    assert.equal(result.tasks['reverse-digits'].attempts, 1);
    assert.equal(result.tasks['reverse-digits'].correct, 0);
    assert.equal(result.tasks['reverse-digits'].balance, -3);
    await page.getByRole('button', { name: 'Replay sequence', exact: true }).waitFor();
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('pause, hiding, and locking stop the microphone and ignore a late local recognition result', { timeout: 60_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    for (const interruption of ['pause', 'hidden']) {
      await recordSpeech(page, round.expected);
      if (interruption === 'pause') await page.keyboard.press('Escape');
      else await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
      assert.deepEqual(await saved(page), initial);
      if (interruption === 'hidden') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.getByRole('button', { name: /^Continue →$/ }).click();
      await page.getByRole('button', { name: 'Record answer', exact: true }).waitFor();
    }
    await page.evaluate(() => { window.__speechTest.holdFinal = true; });
    await recordSpeech(page, round.expected);
    const finalRequests = await page.evaluate(() => window.__speechTest.messages.filter(message => message.action === 'retrieveFinalResult').length);
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await page.waitForFunction(previous => window.__speechTest.messages.filter(message => message.action === 'retrieveFinalResult').length > previous, finalRequests);
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    await page.evaluate(() => window.__speechTest.releaseFinals());
    assert.equal(await page.getByRole('group', { name: 'Recognized answer', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial, 'A result delivered after cancellation cannot commit or reveal an answer.');
    await page.getByRole('button', { name: /^Continue →$/ }).click();
    await recordSpeech(page, round.expected);
    await page.getByRole('button', { name: /^Lock/ }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 4);
    assert.equal(await page.evaluate(() => window.__speechTest.workersTerminated), 1);
    assert.deepEqual(await saved(page), initial);
    await unlock(page);
    assert.equal(await page.evaluate(() => window.__speechTest.workersCreated), 1, 'Unlock does not reload the speech model without a new explicit request.');
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 4);
    await page.getByRole('button', { name: 'Download speech model', exact: true }).waitFor();
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('microphone denial leaves spoken progress unscored and permits keypad practice', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: { denyMicrophone: true } });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    await page.getByRole('button', { name: 'Record answer', exact: true }).click();
    await page.getByRole('button', { name: 'Record again', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial);
    await page.getByRole('button', { name: /Save & exit/ }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByLabel('Answer with', { exact: true }).selectOption('keypad');
    const round = await startFocus(page, 'reverse-digits');
    await present(page, { audio: true });
    await enter(page, round);
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(selectTaskStates(result, { ...result, inputMode: 'spoken', digitVariant: { ...result.digitVariant, inputMode: 'spoken', keypad: 'none' } })['reverse-digits'].attempts, 0);
    assert.equal(result.tasks['reverse-digits'].attempts, 1);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a failed local model download does not request microphone access', { timeout: 30_000 }, async () => {
  const opened = await open({ speech: { loadFailure: true } });
  const { context, page } = opened;
  try {
    await unlock(page);
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Could not load local speech/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0);
    assert.equal(await page.evaluate(() => window.__speechTest.workersTerminated), 1);
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isDisabled(), true);
    const progress = await saved(page);
    assert.equal(progress.session, null);
    assert.equal(selectTaskStates(progress)['reverse-digits'].attempts, 0);
    await page.getByLabel('Answer with', { exact: true }).selectOption('keypad');
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isEnabled(), true);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a failed local worker disables spoken starts and recovers in an unscored active round', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    await page.evaluate(() => window.__speechTest.failWorker());
    await page.getByRole('button', { name: 'Download speech model', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isDisabled(), true, 'An idle worker failure invalidates the ready state.');
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0);
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    await recordSpeech(page, round.expected);
    await page.evaluate(() => window.__speechTest.failWorker());
    const recovery = page.getByRole('button', { name: 'Download speech model', exact: true });
    await recovery.waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0, 'A failed recognizer stops the active microphone.');
    assert.equal(await page.getByRole('button', { name: 'Record again', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('group', { name: 'Recognized answer', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial);
    await recovery.click();
    await page.getByRole('button', { name: 'Record answer', exact: true }).waitFor();
    await recordSpeech(page, round.expected);
    assert.deepEqual(await stopSpeech(page), round.expected);
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(result.session.history.length, 1);
    assert.equal(result.session.history[0].correct, true);
    assert.equal(result.tasks['reverse-digits'].attempts, 1);
    assert.equal(await page.evaluate(() => window.__speechTest.workersCreated), 3);
    assert.equal(await page.evaluate(() => window.__speechTest.workersTerminated), 2);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a failed idle speech worker gates a mixed visual-to-Digits transition until explicit recovery', { timeout: 60_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    const digitVariant = { order: 'reverse', inputMode: 'spoken', keypad: 'none' };
    const preferences = { ...fresh(), digitVariant, inputMode: 'spoken' };
    let session;
    for (let index = 0; index < 100; index++) {
      const candidate = createProgress(`browser-idle-worker-transition-${index}`, 24, { modality: 'mixed', profile: RESEARCH_PROFILE, tasks: selectTaskStates(preferences), digitVariant });
      if (candidate.plan[0] === 'forward') { session = candidate; break; }
    }
    assert.ok(session, 'The fixture starts with a visual round followed by Digits.');
    await seedSession(page, session);
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await page.evaluate(() => window.__speechTest.failWorker());
    await enter(page, session.active);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    const auditory = advanced.session.active;
    assert.equal(auditory.answerKind, 'ordered-digits');
    assert.equal(advanced.session.history[0].correct, true);
    const recovery = page.getByRole('button', { name: 'Download speech model', exact: true });
    await recovery.waitFor();
    assert.equal(await page.getByRole('button', { name: /^Listen to the sequence/ }).isDisabled(), true);
    assert.equal(await page.getByRole('status').filter({ hasText: /^Listen$/ }).count(), 0, 'The next stimulus is not played without its response method.');
    assert.equal(await page.getByRole('button', { name: 'Record answer', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0);
    assert.equal(advanced.tasks[auditory.task].attempts, 0);
    await recovery.click();
    await presentForSpeech(page);
    await recordSpeech(page, auditory.expected);
    assert.deepEqual(await stopSpeech(page), auditory.expected);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 2);
    assert.equal(completed.session.history.length, 2);
    assert.equal(completed.session.history[1].correct, true);
    assert.deepEqual(digitTotals(completed), { attempts: 1, correct: 1 });
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

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
    const before = await seedSession(page, answered, { legacy: true });
    assert.equal(restoreSaved(await saved(page)).digitOrder, 'ascending', 'Older sorting preferences retain their original ascending default.');
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
    assert.equal(completed.legacyTasks[expected.active.task].attempts, 1);
    assert.deepEqual(completed.conditions, {}, 'Legacy answers do not populate the new difficulty-profile banks.');
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
    assert.equal(missed.session.profile, RESEARCH_PROFILE);
    assert.equal(missed.tasks.forward.span, 3, 'The research profile does not lower load after a single miss.');
    assert.equal(missed.tasks.forward.balance, -3);
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

test('input, presentation speed, and sorting order keep independent adaptive records', { timeout: 30_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    const initial = { ...fresh(), digitVariant: { order: 'ascending', inputMode: 'keypad', keypad: 'visible' } };
    let session = createProgress('browser-condition-banks', 8, { profile: RESEARCH_PROFILE, focusedTask: 'sort-digits', tasks: selectTaskStates(initial), digitVariant: initial.digitVariant });
    session = advanceRound(recordFirstAttempt(session, session.active, true));
    const withSession = normalizeSaved({ ...initial, session, tasks: session.tasks, sessionCondition: { slow: false, inputMode: 'keypad', digitOrder: 'ascending', digitVariant: initial.digitVariant } });
    const data = normalizeSaved({ ...withSession, session: null, sessionCondition: null });
    await seedSaved(page, data);
    const originalConditions = structuredClone(data.conditions);
    assert.equal(selectTaskStates(await saved(page))['sort-digits'].attempts, 1);
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    const spoken = await saved(page, value => value?.inputMode === 'spoken');
    assert.equal(selectTaskStates(spoken)['sort-digits'].attempts, 0);
    await page.getByLabel('Slower presentation', { exact: true }).check();
    const slower = await saved(page, value => value?.slow === true);
    assert.equal(selectTaskStates(slower)['sort-digits'].attempts, 0);
    await page.getByLabel('Recall order', { exact: true }).selectOption('descending');
    const descending = await saved(page, value => value?.digitOrder === 'descending');
    assert.equal(selectTaskStates(descending)['sort-digits'].attempts, 0);
    await page.getByLabel('Answer with', { exact: true }).selectOption('keypad');
    await page.getByLabel('Slower presentation', { exact: true }).uncheck();
    const descendingKeypad = await saved(page, value => value?.inputMode === 'keypad' && !value?.slow);
    assert.equal(selectTaskStates(descendingKeypad)['sort-digits'].attempts, 0);
    await page.getByLabel('Recall order', { exact: true }).selectOption('ascending');
    const restored = await saved(page, value => value?.digitOrder === 'ascending');
    assert.equal(selectTaskStates(restored)['sort-digits'].attempts, 1);
    for (const state of [spoken, slower, descending, descendingKeypad, restored]) {
      assert.deepEqual(state.conditions, originalConditions, 'Changing a condition cannot copy adaptive history into another bank.');
      assert.deepEqual(state.legacyTasks, data.legacyTasks);
      assert.deepEqual(state.archivedConditions, {}, 'Changing current options does not create archived history.');
    }
    await startFocus(page, 'sort-digits');
    const resumed = await saved(page, value => !!value?.session?.active);
    assert.equal(resumed.session.initialTasks['sort-digits'].attempts, 1);
    assert.deepEqual(resumed.sessionCondition, { slow: false, inputMode: 'keypad', digitOrder: 'ascending', digitVariant: initial.digitVariant });
    assert.deepEqual(await page.evaluate(() => ({ models: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { models: 0, microphones: 0 }, 'Selecting Spoken alone cannot download its model or request a microphone.');
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
    assert.equal(ended.conditions[conditionKey('forward', ended)].attempts, 1);
    assert.equal(selectTaskStates(ended).forward.attempts, 1);
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
    assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 9);
    await page.screenshot({ path: resolve(shots, 'real-pack-desktop.png'), fullPage: true });
    const manifest = JSON.parse(await readFile(new URL('working-memory/vault/manifest.json', new URL('../../out/', import.meta.url)), 'utf8'));
    const key = await deriveSearchKey(process.env.MEMORY_LAB_TEST_PASSWORD, manifest.encryption);
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).click();
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
