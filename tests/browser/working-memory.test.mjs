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
import { AUDIO_TASK_IDS, COMFORT_ADAPTATION, RESEARCH_PROFILE, TASK_IDS, VISUAL_TASK_IDS, advanceRound, createProgress, finalTrackingPositions, recordFirstAttempt } from '../../app/lab/working-memory/engine.ts';
import { conditionKey, fresh, normalizeSaved, restore as restoreSaved, selectTaskStates, taskTotals } from '../../app/lab/working-memory/progress.ts';
import { getMemoryRewards } from '../../app/lab/working-memory/rewards.ts';
import { digitTaskForVariant, digitVariantKey, enumerateDigitVariants, normalizeDigitVariant } from '../../app/lab/working-memory/digit-options.ts';
import { MEMORY_PROGRESS_STORAGE_KEY, memoryAudioContext, memoryContentContext, validateMemoryContent } from '../../app/lab/working-memory/vault.ts';
import { PROGRESSION_STORAGE_KEY } from '../../lib/progression/persistence.ts';

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
    const heldPermissions = [];
    const awaitingResponses = [];
    const microphoneGains = new Set();
    const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const state = {
      microphoneRequests: 0, activeTracks: 0, stoppedTracks: 0, nativeSpeechRequests: 0,
      workersCreated: 0, workersTerminated: 0, endpointResults: 0, stimulusPlays: 0, recognitionDisplays: 0, messages: [], results: [], modelUrls: [],
      holdFinal: Boolean(config.holdFinal),
      holdMicrophone: Boolean(config.holdMicrophone),
      setMicrophoneVolume(volume) { microphoneGains.forEach(gain => { gain.gain.value = volume; }); },
      queue(digits, settings = {}) {
        const response = { digits, confidence: 0.99, endpoint: true, ...settings };
        const pending = awaitingResponses.shift();
        if (pending) pending.worker.responses.set(pending.id, response);
        else this.results.push(response);
      },
      sendSegment(digits, settings = {}) {
        const active = this.latestRecognizer;
        if (active) active.worker.emit({ event: 'result', recognizerId: active.id, result: segment({ digits, confidence: 0.99, ...settings }) });
      },
      releaseFinals() { heldFinals.splice(0).forEach(deliver => deliver()); },
      releaseMicrophones() { heldPermissions.splice(0).forEach(deliver => deliver()); },
      repeatFinal: () => undefined,
      failWorker: () => undefined,
    };
    window.__speechTest = state;
    new MutationObserver(() => {
      if (document.querySelector('[aria-label="Recognized answer"], [aria-label="Spoken digits"]')) state.recognitionDisplays++;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this.src.startsWith('blob:')) state.stimulusPlays++;
      return nativePlay.apply(this, args);
    };
    const nativeSpeech = class {
      constructor() { state.nativeSpeechRequests++; throw new Error('Native speech services are forbidden in this test.'); }
    };
    window.SpeechRecognition = nativeSpeech;
    window.webkitSpeechRecognition = nativeSpeech;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      state.microphoneRequests++;
      if (config.denyMicrophone) throw new DOMException('Synthetic microphone denial', 'NotAllowedError');
      if (state.holdMicrophone) await new Promise(resolve => heldPermissions.push(resolve));
      const source = new NativeAudioContext();
      const oscillator = source.createOscillator(), gain = source.createGain(), destination = source.createMediaStreamDestination();
      gain.gain.value = config.silentMicrophone ? 0 : 0.1;
      microphoneGains.add(gain);
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
            microphoneGains.delete(gain);
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
        if (data.event === 'result') state.endpointResults++;
        const event = new MessageEvent('message', { data });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
      postMessage(message) {
        state.messages.push({ ...message, ...(message.data instanceof Float32Array ? { data: { length: message.data.length } } : {}) });
        if (message.action === 'load') {
          state.modelUrls.push(message.modelUrl);
          setTimeout(() => this.emit({ event: 'load', result: !config.loadFailure }), 0);
        } else if (message.action === 'create') {
          state.latestRecognizer = { worker: this, id: message.recognizerId };
          const response = state.results.shift();
          if (response) this.responses.set(message.recognizerId, response);
          else awaitingResponses.push({ worker: this, id: message.recognizerId });
        } else if (message.action === 'audioChunk') {
          const response = this.responses.get(message.recognizerId);
          if (response?.endpoint && !this.endpointSent.has(message.recognizerId)) {
            this.endpointSent.add(message.recognizerId);
            setTimeout(() => {
              if (this.terminated || !this.responses.has(message.recognizerId)) return;
              this.emit({ event: 'result', recognizerId: message.recognizerId, result: segment(response) });
              if (response.silence !== false) state.setMicrophoneVolume(0);
            }, response.endpointDelay ?? 300);
          }
        } else if (message.action === 'retrieveFinalResult') {
          const response = this.responses.get(message.recognizerId) ?? { digits: [], confidence: 0.99 };
          const deliver = () => this.emit({ event: 'finalresult', recognizerId: message.recognizerId, result: response.endpoint ? { text: '', result: [] } : segment(response) });
          state.repeatFinal = deliver;
          if (state.holdFinal) heldFinals.push(deliver);
          else setTimeout(deliver, 0);
        } else if (message.action === 'remove') {
          this.responses.delete(message.recognizerId);
          const pending = awaitingResponses.findIndex(item => item.worker === this && item.id === message.recognizerId);
          if (pending >= 0) awaitingResponses.splice(pending, 1);
        }
      }
      terminate() {
        if (!this.terminated) state.workersTerminated++;
        this.terminated = true;
        for (let index = awaitingResponses.length - 1; index >= 0; index--) {
          if (awaitingResponses[index].worker === this) awaitingResponses.splice(index, 1);
        }
      }
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
  const spoken = before.session.active.answerKind === 'ordered-digits' && before.sessionCondition?.inputMode === 'spoken';
  if (!spoken) await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
  if (!correct) {
    await page.getByRole('heading', { name: spoken ? 'Answer did not match' : 'Try again', exact: true }).waitFor();
    await assertNoMissSolution(page);
    return;
  }
  const advanced = await saved(page, value => value?.session?.cursor === before.session.cursor + 1, key);
  if (advanced.session.active) {
    await page.getByRole('status').filter({ hasText: new RegExp(`^✓ Round ${before.session.cursor + 1} correct(?: after replay)?$`) }).waitFor();
    await assertAutoPresentation(page);
  }
  else await page.getByRole('heading', { name: /^Session complete\.?$/ }).waitFor();
  if (spoken) await assertNoSpokenTranscript(page);
}
async function assertAutoPresentation(page) {
  await page.getByRole('status').filter({ hasText: /^(Get ready(?: \+)?|Watch|Listen)$/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^(Next round|Finish session|Watch the sequence|Listen to the sequence|Turn sound on & listen)/ }).count(), 0, 'A committed answer starts the next challenge without another action.');
  assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0, 'Answers stay locked while the next sequence is presented.');
  assert.equal(await page.getByRole('button', { name: /^(OK|Restart|Retry)$/ }).count(), 0, 'Spoken controls also stay unavailable during the next presentation.');
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
async function assertMemoryXp(page, xp) {
  const trail = page.getByRole('region', { name: 'Memory Trail', exact: true });
  await trail.getByLabel(`${xp} memory XP`, { exact: true }).waitFor();
}
async function prepareSpeech(page) {
  await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
  await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
}
async function presentForSpeech(page) {
  const previous = await page.evaluate(() => window.__speechTest.microphoneRequests);
  await page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen)/ }).click();
  await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
  assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), previous, 'The microphone stays closed while the stimulus is playing.');
  assert.equal(await page.getByRole('button', { name: /^(OK|Restart|Retry)$/ }).count(), 0, 'There are no spoken answer actions while listening.');
  await speechCapturing(page);
}
async function assertNoSpokenTranscript(page) {
  assert.equal(await page.getByRole('group', { name: 'Recognized answer', exact: true, includeHidden: true }).count(), 0, 'No recognized digits are mounted before a miss is committed.');
  assert.equal(await page.getByRole('list', { name: 'Spoken digits', exact: true, includeHidden: true }).count(), 0, 'Recognition cannot leak through a hidden accessible list.');
  assert.equal(await page.getByRole('listitem', { name: /^Digit \d+$/, includeHidden: true }).count(), 0);
}
async function assertNoMissSolution(page) {
  const feedback = page.getByRole('status').filter({ has: page.getByRole('heading', { name: /^(Try again|Answer did not match)$/ }) });
  await feedback.waitFor();
  assert.equal(await feedback.getByText(/expected response|correct sequence|correct answer|solution/i).count(), 0, 'A missed answer does not reveal the solution.');
  assert.equal(await feedback.locator('svg[aria-label^="Row "]').count(), 0, 'The expected visual positions cannot be exposed through SVG labels.');
  assert.equal(await feedback.getByRole('group', { name: /expected|correct|solution/i, includeHidden: true }).count(), 0);
}
async function assertInputFailure(page, heading) {
  const failure = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
  await failure.waitFor();
  assert.match(await failure.innerText(), /No attempt was scored\./);
  assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0, 'An input failure closes the microphone.');
  const controls = page.getByRole('group', { name: 'Spoken answer controls', exact: true });
  assert.deepEqual(await controls.getByRole('button').allTextContents(), ['Retry'], 'Only failed recognition offers an answer action.');
  assert.equal(await controls.getByRole('button', { name: 'Retry', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: /^(OK|Restart|Check sequence)$/ }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: /^(Try again|Answer did not match)$/ }).count(), 0, 'Input failure cannot masquerade as an incorrect answer.');
  await assertNoSpokenTranscript(page);
}
async function speechCapturing(page) {
  await page.waitForFunction(() => window.__speechTest.activeTracks === 1);
  const controls = page.getByRole('group', { name: 'Spoken answer controls', exact: true });
  await controls.waitFor();
  assert.equal(await controls.getByRole('button').count(), 0, 'A successful spoken answer needs no start, stop, or confirmation action.');
  assert.equal(await page.getByRole('button', { name: /^(OK|Restart|Retry|Record answer|Record again|Stop recording|Check sequence)$/ }).count(), 0);
  assert.equal(await page.getByRole('group', { name: 'Digit keypad', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Digit [1-9]$/ }).count(), 0);
  assert.equal(await page.getByLabel(/^\d+ of \d+ places entered$/).count(), 0, 'Spoken recall has no visual answer slots.');
  await assertNoSpokenTranscript(page);
}
async function recordSpeech(page, digits, settings = {}, { again = false } = {}) {
  const previous = await page.evaluate(({ digits, settings }) => {
    window.__speechTest.queue(digits, settings);
    window.__speechTest.setMicrophoneVolume(0.1);
    return window.__speechTest.messages.filter(message => message.action === 'audioChunk').length;
  }, { digits, settings });
  if (again) await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await speechCapturing(page);
  await page.waitForFunction(count => window.__speechTest.messages.filter(message => message.action === 'audioChunk').length > count, previous);
}
async function submittedSpeech(page) {
  const review = page.getByRole('group', { name: 'Recognized answer', exact: true });
  await review.waitFor();
  assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0, 'The microphone stops before committed recognition is shown.');
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

test('Memory Trail offers twelve buddies, previews every habitat, and keeps its preference encrypted and separate from Journey', { timeout: 45_000 }, async () => {
  const opened = await open({ width: 320 });
  const { context, page } = opened;
  const journeyState = JSON.stringify({ marker: 'existing-journey-player', xp: 735 });
  try {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PROGRESSION_STORAGE_KEY, value: journeyState });
    await unlock(page);
    const trail = page.getByRole('region', { name: 'Memory Trail', exact: true });
    await assertMemoryXp(page, 0);
    await trail.locator('img[src$="/avatars/hedgehog.svg"]').first().waitFor();
    assert.equal(await trail.getByRole('progressbar', { name: 'Current trail stop', exact: true }).getAttribute('aria-valuenow'), '0');
    const habitats = trail.getByLabel('Trail habitat', { exact: true });
    assert.deepEqual(await habitats.locator('option').allTextContents(), ['Acorn Grove', 'Pebble Brook', 'Fern Hollow', 'Moonlit Meadow', 'Starry Summit']);
    await habitats.selectOption({ label: 'Starry Summit' });
    await assertMemoryXp(page, 0);
    assert.equal(await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).isEnabled(), true, 'Previewing a future habitat does not lock any practice game.');
    await trail.getByRole('button', { name: 'Preview previous habitat', exact: true }).click();
    assert.equal(await habitats.locator('option:checked').textContent(), 'Moonlit Meadow');
    await habitats.selectOption({ label: 'Acorn Grove' });
    await trail.getByText('Choose your buddy', { exact: true }).click();
    const buddies = trail.getByRole('group', { name: 'Trail buddies', exact: true });
    assert.equal(await buddies.getByRole('button').count(), 12);
    assert.equal(await buddies.getByRole('button', { name: 'Hedgehog', exact: true }).getAttribute('aria-pressed'), 'true');
    await buddies.getByRole('button', { name: 'Fox', exact: true }).click();
    const chosen = await saved(page, value => value?.buddy === 'fox');
    assert.equal(getMemoryRewards(restoreSaved(chosen)).xp, 0, 'Choosing an animal does not award practice XP.');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    assert.equal(stored.includes('"buddy"'), false, 'The companion preference has no plaintext storage entry.');
    await assertNoPlaintext(page, chosen);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertFits(page, `Memory Trail home ${width}px`);
      await page.screenshot({ path: resolve(shots, `memory-trail-home-${width}.png`), fullPage: true });
    }
    await page.reload();
    await unlock(page);
    await assertMemoryXp(page, 0);
    await page.getByRole('region', { name: 'Memory Trail', exact: true }).locator('img[src$="/avatars/fox.svg"]').first().waitFor();
    assert.equal((await saved(page)).buddy, 'fox');
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Memory Trail', exact: true }).count(), 0);
    await unlock(page);
    assert.equal((await saved(page)).buddy, 'fox');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), PROGRESSION_STORAGE_KEY), journeyState, 'Memory rewards and buddy changes cannot mutate Journey progress.');
    await assertClean(opened);
  } finally { await context.close(); }
});

test('Memory Trail starts eight challenges in one action and continues the exact saved round with practice XP', { timeout: 45_000 }, async () => {
  const opened = await open({ width: 390, touch: true });
  const { context, page } = opened;
  try {
    await unlock(page);
    await assertMemoryXp(page, 0);
    await page.getByRole('button', { name: 'Start adventure', exact: true }).tap();
    await assertAutoPresentation(page);
    const started = await saved(page, value => !!value?.session?.active);
    assert.equal(started.session.length, 8);
    assert.equal(started.session.focusedTask, started.session.active.task);
    assert.equal(started.session.cursor, 0);
    assert.equal(getMemoryRewards(restoreSaved(started)).xp, 0, 'Starting or watching a challenge does not award XP.');
    assert.equal(await page.getByRole('region', { name: 'Memory Trail', exact: true }).count(), 0);
    assert.equal(await page.locator('img[src*="/avatars/"]').count(), 0, 'Animal decorations stay off the memory challenge.');
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, started.session.active, started.session.active.expected, { touch: true });
    await check(page);
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(getMemoryRewards(restoreSaved(advanced)).xp, 10);
    await page.getByRole('button', { name: /Save & exit/ }).click();
    await assertMemoryXp(page, 10);
    assert.equal(await page.getByRole('progressbar', { name: 'Current trail stop', exact: true }).getAttribute('aria-valuenow'), '1');
    await page.getByRole('button', { name: 'Continue adventure', exact: true }).tap();
    await assertAutoPresentation(page);
    const resumed = await saved(page);
    assert.deepEqual(resumed, advanced, 'Continuing an adventure does not generate another session or award XP again.');
    assert.equal(resumed.session.active.id, advanced.session.active.id);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('Memory Trail credits earlier practice across expeditions and keeps all six earned trophies', { timeout: 30_000 }, async () => {
  const opened = await open({ width: 390 });
  const { context, page } = opened;
  try {
    const previous = fresh();
    for (const task of [...VISUAL_TASK_IDS.slice(0, 6), ...AUDIO_TASK_IDS]) previous.legacyTasks[task] = { ...previous.legacyTasks[task], attempts: 20, correct: 0 };
    await seedSaved(page, normalizeSaved(previous));
    await assertMemoryXp(page, 1800);
    await page.getByRole('region', { name: 'Memory trophies', exact: true }).getByRole('listitem', { name: 'Curious explorer, 7 of 9', exact: true }).waitFor();
    for (const task of TASK_IDS) previous.legacyTasks[task] = { ...previous.legacyTasks[task], attempts: 20, correct: 0 };
    const retained = await seedSaved(page, normalizeSaved(previous));
    await assertMemoryXp(page, 2200);
    const trail = page.getByRole('region', { name: 'Memory Trail', exact: true });
    await trail.getByText(/^Memory Trail · Expedition 2$/).waitFor();
    assert.equal(await trail.getByLabel('Trail habitat', { exact: true }).locator('option:checked').textContent(), 'Acorn Grove');
    assert.equal(await trail.getByRole('progressbar', { name: 'Current trail stop', exact: true }).getAttribute('aria-valuenow'), '4');
    const trophies = page.getByRole('region', { name: 'Memory trophies', exact: true });
    assert.equal(await trophies.getByRole('listitem').count(), 6);
    assert.equal(await trophies.getByRole('listitem', { name: /earned/i }).count(), 6, 'Earlier practice keeps all earned trophies after the trail begins another expedition.');
    assert.equal(await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).isEnabled(), true, 'Rewards do not replace the independent adaptive practice controls.');
    await page.reload();
    await unlock(page);
    await assertMemoryXp(page, 2200);
    assert.deepEqual(await saved(page), retained, 'Viewing the new trail does not rewrite historical difficulty or reward evidence.');
    await assertClean(opened);
  } finally { await context.close(); }
});

for (const width of [320, 390]) {
  test(`${width}px touch Practice resumes the current miss and switches games without ending a session`, { timeout: 75_000 }, async () => {
    const opened = await open({ width, height: 844, touch: true });
    const { context, page } = opened;
    try {
      await seedSaved(page, normalizeSaved({ ...fresh(), buddy: 'fox' }));
      const round = await startFocus(page, 'forward');
      await present(page);
      const wrong = [...round.expected]; wrong[0] = (wrong[0] + 1) % 16;
      await enter(page, round, wrong, { touch: true });
      await check(page, { correct: false });
      const missed = await saved(page, value => value?.session?.answered);
      const learned = structuredClone(missed.tasks.forward);
      assert.equal(missed.session.history[0].correct, false);
      assert.equal(missed.session.history[0].retryCorrect, undefined);
      assert.equal(getMemoryRewards(restoreSaved(missed)).xp, 10);
      await page.getByRole('button', { name: /Save & exit/ }).tap();
      await page.reload();
      await unlock(page);
      assert.equal(await page.getByRole('button', { name: /^Practice / }).count(), 9);
      assert.deepEqual(await page.getByRole('button', { name: /^Practice / }).evaluateAll(buttons => buttons.map(button => button.disabled)), Array(9).fill(false), 'A retained session cannot make any game look tappable but inert.');
      await assertFits(page, `switchable games ${width}px`);
      await page.screenshot({ path: resolve(shots, `switchable-games-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).tap();
      await page.getByRole('heading', { name: 'Try again', exact: true }).waitFor();
      assert.deepEqual(await saved(page), missed, 'Tapping the current game resumes the exact saved miss without refreshing its remaining try.');
      await assertNoMissSolution(page);
      await page.getByRole('button', { name: /Save & exit/ }).tap();
      await page.getByRole('button', { name: 'Practice Exercise symbols', exact: true }).tap();
      await page.getByRole('heading', { name: 'Exercise symbols', exact: true }).waitFor();
      const switched = await saved(page, value => value?.session?.focusedTask === 'symbols');
      assert.equal(switched.session.length, 8);
      assert.equal(switched.session.cursor, 0);
      assert.equal(switched.session.answered, false);
      assert.deepEqual(switched.session.history, []);
      assert.notEqual(switched.session.seed, missed.session.seed);
      assert.deepEqual(switched.conditions[conditionKey('forward', missed.sessionCondition)], learned);
      assert.deepEqual(taskTotals(restoreSaved(switched)), taskTotals(restoreSaved(missed)), 'Changing games adds no answer, accuracy evidence, or practice credit.');
      assert.deepEqual(switched.logs, missed.logs, 'An unfinished session is not reported as completed.');
      assert.deepEqual(switched.legacyTasks, missed.legacyTasks);
      assert.deepEqual(switched.archivedConditions, missed.archivedConditions);
      assert.equal(switched.buddy, 'fox');
      assert.equal(getMemoryRewards(restoreSaved(switched)).xp, 10);
      assert.equal(await page.getByRole('dialog').count(), 0, 'Choosing another game opens it directly.');
      await page.getByRole('button', { name: /Save & exit/ }).tap();
      await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).tap();
      await page.getByRole('heading', { name: 'Exercise forward', exact: true }).waitFor();
      const returned = await saved(page, value => value?.session?.focusedTask === 'forward');
      assert.notEqual(returned.session.seed, missed.session.seed);
      assert.equal(returned.session.cursor, 0);
      assert.equal(returned.session.active.span, learned.span);
      assert.deepEqual(returned.session.initialTasks.forward, learned, 'Returning to a game keeps its comfortable span and probe schedule.');
      assert.deepEqual(returned.redeemed, []);
      assert.deepEqual(taskTotals(restoreSaved(returned)), taskTotals(restoreSaved(missed)));
      assert.equal(getMemoryRewards(restoreSaved(returned)).xp, 10, 'Leaving the new unplayed game cannot create or duplicate an attempt.');
      await page.getByRole('button', { name: /Save & exit/ }).tap();
      await page.reload();
      await unlock(page);
      assert.deepEqual(await saved(page), returned, 'Encrypted reload preserves the selected game and all learned records.');
      await assertMemoryXp(page, 10);
      await assertNoPlaintext(page, returned);
      await assertClean(opened);
    } finally { await context.close(); }
  });
}

test('pending Digits and pace choices leave the saved question intact and start independent practice without End session', { timeout: 75_000 }, async () => {
  const opened = await open({ width: 390, touch: true, speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    const originalVariant = { order: 'ascending', inputMode: 'keypad', keypad: 'hidden' };
    await selectDigits(page, originalVariant);
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).tap();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
    const original = await saved(page, value => value?.session?.digitVariant?.order === 'ascending');
    const round = original.session.active;
    await present(page, { audio: true });
    const wrong = [...round.expected]; wrong[0] = wrong[0] % 9 + 1;
    await enter(page, round, wrong, { touch: true });
    await check(page, { correct: false });
    const missed = await saved(page, value => value?.session?.answered);
    const learned = structuredClone(missed.tasks['sort-digits']);
    await page.getByRole('button', { name: /Save & exit/ }).tap();
    const nextVariant = { order: 'descending', inputMode: 'keypad', keypad: 'visible' };
    await selectDigits(page, nextVariant);
    await page.getByLabel('Slower presentation', { exact: true }).check();
    const pending = await saved(page, value => value?.slow && value?.digitVariant?.order === 'descending' && value?.digitVariant?.keypad === 'visible');
    assert.deepEqual(pending.session, missed.session, 'Choosing the next practice conditions cannot mutate the retained round or its first-attempt result.');
    assert.deepEqual(pending.sessionCondition, missed.sessionCondition, 'The old session retains its immutable pace and recall rule.');
    assert.deepEqual(pending.conditions, missed.conditions);
    assert.equal(getMemoryRewards(restoreSaved(pending)).xp, 10);
    await page.reload();
    await unlock(page);
    assert.deepEqual(await saved(page), pending, 'Pending preferences and the separately captured saved question both survive reload.');
    assert.equal(await page.getByLabel('Recall order', { exact: true }).inputValue(), 'descending');
    assert.equal(await page.getByLabel('Slower presentation', { exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).tap();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
    const other = await saved(page, value => value?.session?.seed !== missed.session.seed && value?.session?.digitVariant?.order === 'descending');
    assert.deepEqual(other.session.digitVariant, nextVariant);
    assert.equal(other.sessionCondition.slow, true);
    assert.equal(other.session.active.span, 2);
    assert.equal(other.session.initialTasks['sort-digits'].attempts, 0);
    assert.equal(other.session.initialTasks['sort-digits'].probeBackoff, 0);
    assert.deepEqual(other.conditions[conditionKey('sort-digits', missed.sessionCondition)], learned);
    assert.deepEqual(taskTotals(restoreSaved(other)), taskTotals(restoreSaved(missed)));
    await page.getByRole('button', { name: /Save & exit/ }).tap();
    await selectDigits(page, originalVariant);
    await page.getByLabel('Slower presentation', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).tap();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
    const returned = await saved(page, value => value?.session?.seed !== other.session.seed && value?.session?.digitVariant?.order === 'ascending');
    assert.deepEqual(returned.session.digitVariant, originalVariant);
    assert.equal(returned.sessionCondition.slow, false);
    assert.deepEqual(returned.session.initialTasks['sort-digits'], learned);
    assert.deepEqual(taskTotals(restoreSaved(returned)), taskTotals(restoreSaved(missed)));
    assert.equal(getMemoryRewards(restoreSaved(returned)).xp, 10);
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 }, 'Choosing keypad conditions cannot download a speech model or request the microphone.');
    await assertNoPlaintext(page, returned);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('unprepared spoken practice and Continue actions open setup while visual games remain one-tap selectable', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 390, touch: true, speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).tap();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
    const retained = await saved(page, value => value?.session?.digitVariant?.inputMode === 'spoken');
    await page.getByRole('button', { name: 'Download speech model', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen|Loading audio)/ }).isDisabled(), true);
    assert.equal(retained.session.cursor, 0);
    assert.equal(retained.session.answered, false);
    for (const action of ['Continue adventure', /^Continue session/, 'Practice Digits']) {
      await page.getByRole('button', { name: /Save & exit/ }).tap();
      const control = page.getByRole('button', { name: action, exact: typeof action === 'string' });
      assert.equal(await control.isEnabled(), true, 'A missing model cannot strand the saved session behind a disabled navigation button.');
      await control.tap();
      await page.getByRole('button', { name: 'Download speech model', exact: true }).waitFor();
      assert.deepEqual(await saved(page), retained, 'Opening setup cannot reset or score the saved spoken question.');
    }
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 }, 'Opening or continuing a spoken game does not download its model or start recording.');
    await page.getByRole('button', { name: /Save & exit/ }).tap();
    await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).tap();
    await page.getByRole('heading', { name: 'Exercise forward', exact: true }).waitFor();
    const visual = await saved(page, value => value?.session?.focusedTask === 'forward');
    assert.equal(visual.session.answered, false);
    assert.equal(getMemoryRewards(restoreSaved(visual)).xp, 0, 'Abandoning an unplayed speech question adds no failed answer.');
    await present(page);
    await enter(page, visual.session.active, visual.session.active.expected, { touch: true });
    await check(page);
    const practiced = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(getMemoryRewards(restoreSaved(practiced)).xp, 10);
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 });
    await assertFits(page, 'visual practice after unprepared spoken game');
    await assertNoPlaintext(page, practiced);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
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
    assert.deepEqual(resumed.session, advanceRound(session, { upgradeAdaptation: true }), 'Migration preserves the old history and plan, then upgrades adaptation at the next-round boundary.');
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
    assert.equal(await numberOrder.isEnabled(), true, 'New-practice preferences remain available while the saved round retains its captured direction.');
    await page.reload();
    await unlock(page);
    assert.equal(await page.getByLabel('Recall order', { exact: true }).inputValue(), 'descending');
    assert.deepEqual(await saved(page), redeemed, 'Reload retains the descending session, original result, and preference.');
    await assertNoPlaintext(page, redeemed);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('spoken recall automatically starts, stops, and commits once without exposing correct recognition', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 390, speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 });
    await page.getByLabel('Answer with', { exact: true }).selectOption('spoken');
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isEnabled(), true, 'Digits can open its setup screen before its speech model is ready.');
    assert.equal(await page.getByRole('button', { name: 'Practice Exercise forward', exact: true }).isEnabled(), true, 'Visual exercises remain available without the speech model.');
    assert.deepEqual(await page.evaluate(() => ({ workers: window.__speechTest.workersCreated, microphones: window.__speechTest.microphoneRequests })), { workers: 0, microphones: 0 }, 'Selecting Spoken alone does not load a model or open the microphone.');
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0, 'Model preparation does not request microphone access.');
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 1, 'Recall starts recording without an action.');
    await recordSpeech(page, round.expected);
    await page.waitForFunction(() => window.__speechTest.endpointResults === 1);
    await assertNoSpokenTranscript(page);
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    await page.keyboard.press('1');
    assert.equal(await page.getByRole('group', { name: 'Digit keypad', exact: true }).count(), 0);
    assert.deepEqual(await saved(page), initial, 'Recognition is not graded until the utterance finishes.');
    await assertFits(page, 'spoken phone recording');
    await page.screenshot({ path: resolve(shots, 'spoken-recording-phone.png'), fullPage: true });
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(completed.session.history.length, 1);
    assert.equal(completed.session.history[0].correct, true);
    assert.equal(completed.conditions[conditionKey('reverse-digits', completed.sessionCondition)].attempts, 1);
    assert.equal(selectTaskStates(completed, { ...completed, inputMode: 'keypad', digitVariant: { ...completed.digitVariant, inputMode: 'keypad', keypad: 'visible' } })['reverse-digits'].attempts, 0);
    assert.deepEqual(digitTotals(completed), { attempts: 1, correct: 1 }, 'One automatically submitted utterance contributes exactly one attempt.');
    await assertNoSpokenTranscript(page);
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    await speechCapturing(page);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 2, 'The next sequence also starts recording automatically.');
    await recordSpeech(page, completed.session.active.expected);
    await check(page);
    const twice = await saved(page, value => value?.session?.cursor === 2);
    assert.equal(twice.session.history.length, 2);
    assert.deepEqual(digitTotals(twice), { attempts: 2, correct: 2 });
    assert.equal(await page.evaluate(() => window.__speechTest.recognitionDisplays), 0, 'Correct recognition never transiently mounts its transcript, including accessibility markup.');
    await assertNoPlaintext(page, completed);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('uncertain and unknown speech stay unscored with only Retry, then resume without replaying the sequence', { timeout: 60_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'hidden-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    const stimulusPlays = await page.evaluate(() => window.__speechTest.stimulusPlays);
    await recordSpeech(page, round.expected, { confidence: 0.2 });
    await assertInputFailure(page, 'Input not recognized');
    assert.deepEqual(await saved(page), initial, 'Low-confidence recognition does not become a failed memory attempt.');
    assert.equal(getMemoryRewards(restoreSaved(await saved(page))).xp, 0, 'Uncertain speech earns no practice XP.');
    await recordSpeech(page, [], { text: '[unk]' }, { again: true });
    await assertInputFailure(page, 'Input not recognized');
    assert.deepEqual(await saved(page), initial, 'Unknown speech also preserves the complete first-try record.');
    assert.equal(getMemoryRewards(restoreSaved(await saved(page))).xp, 0, 'Retrying unknown speech cannot create reward activity.');
    await recordSpeech(page, round.expected, {}, { again: true });
    assert.equal(await page.evaluate(() => window.__speechTest.stimulusPlays), stimulusPlays, 'Retry records the already heard sequence without playing it again.');
    assert.equal(await page.getByRole('status').filter({ hasText: /^Listen$/ }).count(), 0);
    await check(page);
    const completed = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(completed.session.history.length, 1);
    assert.equal(completed.session.history[0].correct, true);
    assert.equal(completed.tasks[round.task].attempts, 1);
    assert.equal(getMemoryRewards(restoreSaved(completed)).xp, 10, 'Only the recognized first attempt earns XP after input recovery.');
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 3);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 3);
    assert.equal(await page.evaluate(() => window.__speechTest.recognitionDisplays), 0);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a confident spoken answer with the wrong length is a memory miss and displays only what recognition heard', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    await presentForSpeech(page);
    const shorter = round.expected.slice(0, -1);
    await recordSpeech(page, shorter);
    await assertNoSpokenTranscript(page);
    await check(page, { correct: false });
    await page.getByText('The recognized answer did not match.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0, 'A recognized wrong answer follows memory replay rather than input retry.');
    assert.deepEqual(await submittedSpeech(page), shorter, 'Only a scored miss exposes recognition for debugging.');
    const result = await saved(page, value => value?.session?.answered);
    assert.equal(result.session.cursor, 0);
    assert.equal(result.session.history.length, 1);
    assert.equal(result.session.history[0].correct, false);
    assert.equal(result.tasks['reverse-digits'].attempts, 1);
    assert.equal(result.tasks['reverse-digits'].correct, 0);
    assert.equal(result.tasks['reverse-digits'].baseMisses, 1);
    assert.equal(getMemoryRewards(restoreSaved(result)).xp, 10, 'A recognized wrong answer still receives the same practice XP.');
    await page.getByRole('button', { name: 'Replay sequence', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
    await assertNoSpokenTranscript(page);
    await speechCapturing(page);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 2, 'Replay starts recording automatically.');
    await recordSpeech(page, round.expected);
    await check(page);
    const replayed = await saved(page, value => value?.session?.cursor === 1);
    assert.deepEqual(replayed.tasks, result.tasks, 'Correct replay preserves the original first-try miss.');
    assert.equal(replayed.session.history[0].retryCorrect, true);
    assert.equal(replayed.redeemed.includes(round.id), true);
    assert.equal(replayed.session.history.length, 1);
    assert.equal(getMemoryRewards(restoreSaved(replayed)).xp, 10, 'Replay cannot award the same challenge twice.');
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('pause, hiding, and locking stop auto-capture and ignore a late local recognition result', { timeout: 60_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    for (const interruption of ['pause', 'hidden']) {
      await recordSpeech(page, round.expected, { endpoint: false });
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
      await speechCapturing(page);
      assert.equal(await page.getByRole('status').filter({ hasText: /^Listen$/ }).count(), 0, 'Continuing recall resumes recording without replaying the stimulus.');
    }
    await page.evaluate(() => { window.__speechTest.holdFinal = true; });
    const finalRequests = await page.evaluate(() => window.__speechTest.messages.filter(message => message.action === 'retrieveFinalResult').length);
    await recordSpeech(page, round.expected);
    await page.waitForFunction(previous => window.__speechTest.messages.filter(message => message.action === 'retrieveFinalResult').length > previous, finalRequests);
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    await assertNoSpokenTranscript(page);
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0, 'Recognition in flight offers no extra confirmation action.');
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    await page.evaluate(() => window.__speechTest.releaseFinals());
    await assertNoSpokenTranscript(page);
    assert.deepEqual(await saved(page), initial, 'A result after cancellation cannot commit or reveal an answer.');
    await page.getByRole('button', { name: /^Continue →$/ }).click();
    await recordSpeech(page, round.expected, { endpoint: false });
    await page.getByRole('button', { name: /^Lock/ }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 4);
    assert.equal(await page.evaluate(() => window.__speechTest.workersTerminated), 1);
    assert.deepEqual(await saved(page), initial);
    await unlock(page);
    assert.equal(await page.evaluate(() => window.__speechTest.workersCreated), 1, 'Unlock does not reload the model without an explicit request.');
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 4);
    await page.getByRole('button', { name: 'Download speech model', exact: true }).waitFor();
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('recognizer word segments do not end an utterance until real microphone silence follows the full sequence', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    const stimulusPlays = await page.evaluate(() => window.__speechTest.stimulusPlays);
    const chunks = await page.evaluate(() => window.__speechTest.messages.filter(message => message.action === 'audioChunk').length);
    await recordSpeech(page, round.expected.slice(0, 1), { silence: false });
    await page.waitForFunction(() => window.__speechTest.endpointResults === 1);
    await page.waitForFunction(count => window.__speechTest.messages.filter(message => message.action === 'audioChunk').length >= count + 36, chunks);
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 1, 'A completed recognizer word segment cannot cut off a still-speaking participant.');
    assert.deepEqual(await saved(page), initial, 'The first segment alone does not become a short wrong answer.');
    await assertNoSpokenTranscript(page);
    await page.evaluate(digits => {
      window.__speechTest.sendSegment(digits);
      window.__speechTest.setMicrophoneVolume(0);
    }, round.expected.slice(1));
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(result.session.history[0].correct, true, 'Every recognized segment belongs to the same full utterance.');
    assert.equal(result.tasks[round.task].attempts, 1);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 1);
    assert.equal(await page.evaluate(() => window.__speechTest.stimulusPlays), stimulusPlays, 'Answer capture does not replay the challenge.');
    assert.equal(await page.evaluate(() => window.__speechTest.recognitionDisplays), 0);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('initial microphone silence is an unscored input failure and Retry listens again without replaying', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: { silentMicrophone: true } });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    const stimulusPlays = await page.evaluate(() => window.__speechTest.stimulusPlays);
    await assertInputFailure(page, 'Input not recognized');
    assert.deepEqual(await saved(page), initial, 'Not speaking cannot lower the difficulty or count as a memory error.');
    await recordSpeech(page, round.expected, {}, { again: true });
    await page.evaluate(() => window.__speechTest.setMicrophoneVolume(0.1));
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(result.tasks[round.task].attempts, 1);
    assert.equal(result.tasks[round.task].correct, 1);
    assert.equal(await page.evaluate(() => window.__speechTest.stimulusPlays), stimulusPlays);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 2);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('PCM silence automatically submits a full final result even without an intermediate recognizer endpoint', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    await presentForSpeech(page);
    const chunks = await page.evaluate(() => window.__speechTest.messages.filter(message => message.action === 'audioChunk').length);
    await recordSpeech(page, round.expected, { endpoint: false });
    await page.waitForFunction(count => window.__speechTest.messages.filter(message => message.action === 'audioChunk').length >= count + 8, chunks);
    await page.evaluate(() => window.__speechTest.setMicrophoneVolume(0));
    await check(page);
    const result = await saved(page, value => value?.session?.cursor === 1);
    assert.equal(await page.evaluate(() => window.__speechTest.endpointResults), 0);
    assert.equal(result.session.history[0].correct, true);
    assert.equal(result.tasks[round.task].attempts, 1);
    assert.equal(await page.evaluate(() => window.__speechTest.stoppedTracks), 1);
    assert.equal(await page.evaluate(() => window.__speechTest.recognitionDisplays), 0);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('pause, hiding, and locking cancel auto-capture while microphone permission is pending', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: { holdMicrophone: true } });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen)/ }).click();
    for (const [index, interruption] of ['pause', 'hidden', 'lock'].entries()) {
      await page.waitForFunction(count => window.__speechTest.microphoneRequests === count, index + 1);
      assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
      if (interruption === 'lock') await page.getByRole('button', { name: /^Lock/ }).click();
      else if (interruption === 'pause') await page.keyboard.press('Escape');
      else await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      if (interruption === 'lock') await page.getByLabel('Password', { exact: true }).waitFor();
      else await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
      await page.evaluate(() => window.__speechTest.releaseMicrophones());
      await page.waitForFunction(count => window.__speechTest.stoppedTracks === count && window.__speechTest.activeTracks === 0, index + 1);
      assert.deepEqual(await saved(page), initial, 'A late permission result cannot capture or score after interruption.');
      if (interruption === 'lock') break;
      if (interruption === 'hidden') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.getByRole('button', { name: /^Continue →$/ }).click();
    }
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 3);
    assert.equal(await page.evaluate(() => window.__speechTest.workersTerminated), 1);
    await assertNoSpokenTranscript(page);
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
    await page.getByRole('button', { name: /^(Listen to the sequence|Turn sound on & listen)/ }).click();
    await assertInputFailure(page, 'Speech input unavailable');
    await page.getByRole('alert').filter({ hasText: /Microphone access was not allowed/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isEnabled(), true);
    await assertNoSpokenTranscript(page);
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
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isEnabled(), true, 'A failed model download does not lock game navigation.');
    const progress = await saved(page);
    assert.equal(progress.session, null);
    assert.equal(selectTaskStates(progress)['reverse-digits'].attempts, 0);
    await page.getByLabel('Answer with', { exact: true }).selectOption('keypad');
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isEnabled(), true);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a failed local worker leaves spoken practice selectable and recovers in an unscored active round', { timeout: 45_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    await page.evaluate(() => window.__speechTest.failWorker());
    await page.getByRole('button', { name: 'Download speech model', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Practice Digits', exact: true }).isEnabled(), true, 'An idle worker failure gates listening rather than game navigation.');
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0);
    await page.getByRole('button', { name: 'Download speech model', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Speech model ready$/ }).waitFor();
    const round = await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await presentForSpeech(page);
    await recordSpeech(page, round.expected, { endpoint: false });
    await page.evaluate(() => window.__speechTest.failWorker());
    const recovery = page.getByRole('button', { name: 'Download speech model', exact: true });
    await recovery.waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0, 'A failed recognizer stops the active microphone.');
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /^(OK|Restart)$/ }).count(), 0);
    await assertNoSpokenTranscript(page);
    assert.deepEqual(await saved(page), initial);
    await recovery.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Retry' && !button.disabled));
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0, 'Model recovery does not retry a failed microphone capture automatically.');
    await recordSpeech(page, round.expected, {}, { again: true });
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
    assert.equal(await page.getByRole('button', { name: 'OK', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0);
    assert.equal(advanced.tasks[auditory.task].attempts, 0);
    await recovery.click();
    await presentForSpeech(page);
    await recordSpeech(page, auditory.expected);
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
    const expected = advanceRound(answered, { upgradeAdaptation: true });
    assert.notEqual(expected.active.task, answered.active.task);
    const before = await seedSession(page, answered, { legacy: true });
    assert.equal(restoreSaved(await saved(page)).digitOrder, 'ascending', 'Older sorting preferences retain their original ascending default.');
    await page.getByRole('button', { name: /^Continue session/ }).click();
    const resumed = await saved(page, value => value?.session?.cursor === 1);
    assert.deepEqual(resumed.session, expected);
    assert.deepEqual(resumed.tasks, expected.tasks);
    for (const task of TASK_IDS) {
      assert.equal(resumed.tasks[task].attempts, before.tasks[task].attempts, 'Upgrading adaptation does not score an already answered round again.');
      assert.equal(resumed.tasks[task].correct, before.tasks[task].correct);
    }
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
    assert.equal(getMemoryRewards(restoreSaved(completed)).xp, 80);
    assert.equal(await page.getByRole('button', { name: /^(Finish session|Next round|Check sequence)/ }).count(), 0);
    const celebration = page.getByRole('region', { name: 'Adventure celebration', exact: true });
    await celebration.getByLabel('80 XP earned this session', { exact: true }).waitFor();
    const trophies = celebration.getByRole('group', { name: 'New trophies', exact: true });
    await trophies.getByText('First footsteps', { exact: true }).waitFor();
    await trophies.getByText('Bright eyes', { exact: true }).waitFor();
    assert.equal(await celebration.getByRole('button', { name: /^Back to trail/ }).count(), 1);
    assert.equal(await celebration.getByRole('button', { name: /claim|continue|next/i }).count(), 0, 'Earned XP is settled without another claim or continue step.');
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Session complete');
    assert.equal(await celebration.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'Reduced motion keeps the celebration still.');
    await page.screenshot({ path: resolve(shots, 'complete-desktop.png'), fullPage: true });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertFits(page, `Memory Trail celebration ${width}px`);
      await page.screenshot({ path: resolve(shots, `memory-trail-complete-${width}.png`), fullPage: true });
    }
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Back to trail/ }).click();
    await assertMemoryXp(page, 80);
    await page.getByRole('button', { name: /^Lock/ }).click();
    await unlock(page);
    assert.deepEqual(await saved(page), completed, 'Returning, locking, and unlocking do not duplicate a completed session log.');
    await assertMemoryXp(page, 80);
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

for (const inputMode of ['keypad', 'spoken']) {
test(`${inputMode}: rejected audio playback cannot open recording or create a scored listening attempt`, { timeout: 30_000 }, async () => {
  const opened = await open(inputMode === 'spoken' ? { speech: {} } : {});
  const { context, page } = opened;
  try {
    await unlock(page);
    if (inputMode === 'spoken') await prepareSpeech(page);
    await startFocus(page, 'reverse-digits');
    const initial = await saved(page);
    await page.evaluate(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Synthetic autoplay rejection', 'NotAllowedError'));
    });
    await page.getByRole('button', { name: /^Listen to the sequence/ }).click();
    await page.getByRole('status').filter({ hasText: /audio could not play/ }).waitFor();
    await page.getByRole('button', { name: /^Listen to the sequence/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check sequence', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^(OK|Restart|Retry)$/ }).count(), 0);
    if (inputMode === 'spoken') assert.equal(await page.evaluate(() => window.__speechTest.microphoneRequests), 0, 'An unheard sequence cannot start the microphone.');
    assert.deepEqual(await saved(page), initial, 'A sequence that was not heard leaves progress unchanged.');
    await assertClean(opened);
  } finally { await context.close(); }
});
}

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
    assert.equal(await page.getByText('Example', { exact: true }).count(), 0, 'A missed round cannot expose a solution through the example disclosure.');
    await page.getByRole('button', { name: 'Review round 1: missed on first try', exact: true }).click();
    await page.getByRole('button', { name: 'Close review', exact: true }).waitFor();
    assert.equal(await page.getByText('Watch this order', { exact: true }).count(), 0, 'Unsolved history cannot expose the actual stimulus or solved response.');
    assert.equal(await page.locator('svg[aria-label^="Row "]').count(), 0);
    await page.getByRole('button', { name: 'Close review', exact: true }).click();
    await page.getByRole('heading', { name: 'Try again', exact: true }).waitFor();
    assert.deepEqual(await saved(page), missed, 'Viewing unsolved history never changes the failed round or first-try record.');
    await page.screenshot({ path: resolve(shots, 'wrong-tablet.png'), fullPage: true });
    assert.equal(missed.session.history[0].correct, false);
    assert.equal(missed.session.profile, RESEARCH_PROFILE);
    assert.equal(missed.tasks.forward.span, 3, 'The comfortable-span controller does not lower the base after a single miss.');
    assert.equal(missed.tasks.forward.baseMisses, 1);
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
    assert.equal(redeemed.session.history[0].retryCorrect, true);
    assert.deepEqual(redeemed.tasks, missed.tasks, 'A successful retry never changes adaptive statistics.');
    assert.equal(await page.getByRole('button', { name: 'Review round 1: missed on first try', exact: true }).count(), 1);
    const beforeReview = await saved(page, value => value?.session?.cursor === 1);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review round 1: missed on first try', exact: true }).click();
    await page.getByRole('button', { name: 'Close review', exact: true }).waitFor();
    assert.equal(await page.getByText('Watch this order', { exact: true }).count(), 1, 'A round becomes available as a solved example after a correct replay.');
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

test('two manual misses move on once; Save & exit, Lock, and reload retain the remaining try and hidden history', { timeout: 75_000 }, async () => {
  const opened = await open({ width: 390, touch: true });
  const { context, page } = opened;
  try {
    await unlock(page);
    const round = await startFocus(page, 'forward');
    const wrong = [...round.expected]; wrong[0] = (wrong[0] + 1) % 16;
    await present(page);
    await enter(page, round, wrong, { touch: true });
    await check(page, { correct: false });
    await page.getByText('One more try, then we’ll move on.', { exact: true }).waitFor();
    const missed = await saved(page, value => value?.session?.answered);
    assert.equal(missed.session.adaptation, COMFORT_ADAPTATION);
    assert.equal(missed.session.history[0].retryCorrect, undefined);
    assert.equal(getMemoryRewards(restoreSaved(missed)).xp, 10);
    await page.getByRole('button', { name: /Save & exit/ }).tap();
    await assertMemoryXp(page, 10);
    await page.getByRole('button', { name: 'Lock', exact: true }).tap();
    await page.getByLabel('Password', { exact: true }).waitFor();
    await page.reload();
    await unlock(page);
    await page.getByRole('button', { name: /^Continue session/ }).tap();
    await page.getByRole('button', { name: 'Replay sequence', exact: true }).waitFor();
    assert.deepEqual(await saved(page), missed, 'Leaving or reloading a missed round cannot replenish its scored attempts.');
    await present(page, { replay: true });
    await enter(page, round, wrong, { touch: true });
    await page.getByRole('button', { name: 'Check sequence', exact: true }).dblclick({ delay: 25 });
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    await page.getByRole('status').filter({ hasText: /^Round 1: moving on after two tries\.$/ }).waitFor();
    await assertAutoPresentation(page);
    assert.equal(advanced.session.history.length, 1);
    assert.equal(advanced.session.history[0].round.id, round.id);
    assert.equal(advanced.session.history[0].correct, false);
    assert.equal(advanced.session.history[0].retryCorrect, false);
    assert.equal(advanced.redeemed.includes(round.id), false);
    assert.notEqual(advanced.session.active.id, round.id);
    assert.equal(advanced.session.answered, false);
    assert.deepEqual(advanced.tasks, missed.tasks, 'A second miss cannot add an adaptive observation or duplicate practice XP.');
    assert.equal(advanced.tasks.forward.attempts, 1);
    assert.equal(advanced.tasks.forward.correct, 0);
    assert.equal(getMemoryRewards(restoreSaved(advanced)).xp, 10);
    await page.getByRole('button', { name: 'Pause', exact: true }).tap();
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review round 1: missed on first try', exact: true }).tap();
    await page.getByText('Missed on the first attempt. The answer stays hidden.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Watch this order', { exact: true }).count(), 0, 'Moving on cannot make a missed sequence available as a solved example.');
    assert.equal(await page.locator('svg[aria-label^="Row "]').count(), 0);
    assert.equal(await page.getByRole('group', { name: /expected|correct|solution/i, includeHidden: true }).count(), 0);
    await page.getByRole('button', { name: 'Close review', exact: true }).tap();
    await page.getByRole('button', { name: 'Lock', exact: true }).tap();
    await page.getByLabel('Password', { exact: true }).waitFor();
    await page.reload();
    await unlock(page);
    await page.getByRole('button', { name: /^Continue session/ }).tap();
    await assertAutoPresentation(page);
    assert.deepEqual(await saved(page), advanced, 'An exhausted round remains exhausted after a second lock and reload.');
    await assertNoPlaintext(page, advanced);
    await assertFits(page, 'bounded retry on a phone');
    await assertClean(opened);
  } finally { await context.close(); }
});

test('spoken input failures preserve the final try, then a second recognized miss moves on and ignores a repeated final', { timeout: 75_000 }, async () => {
  const opened = await open({ speech: {} });
  const { context, page } = opened;
  try {
    await unlock(page);
    await prepareSpeech(page);
    const round = await startFocus(page, 'reverse-digits');
    const wrong = round.expected.slice(0, -1);
    await presentForSpeech(page);
    await recordSpeech(page, wrong);
    await check(page, { correct: false });
    assert.deepEqual(await submittedSpeech(page), wrong);
    await page.getByText('One more try, then we’ll move on.', { exact: true }).waitFor();
    const missed = await saved(page, value => value?.session?.answered);
    await page.getByRole('button', { name: 'Replay sequence', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Listen$/ }).waitFor();
    await speechCapturing(page);
    const stimulusPlays = await page.evaluate(() => window.__speechTest.stimulusPlays);
    await recordSpeech(page, round.expected, { confidence: 0.2 });
    await assertInputFailure(page, 'Input not recognized');
    assert.deepEqual(await saved(page), missed, 'Uncertain recognition cannot consume the remaining memory attempt.');
    await recordSpeech(page, [], { text: '[unk]' }, { again: true });
    await assertInputFailure(page, 'Input not recognized');
    assert.deepEqual(await saved(page), missed, 'Unknown speech cannot create a second scored miss.');
    await recordSpeech(page, round.expected, { endpoint: false }, { again: true });
    await page.evaluate(() => window.__speechTest.failWorker());
    const recovery = page.getByRole('button', { name: 'Download speech model', exact: true });
    await recovery.waitFor();
    assert.equal(await page.evaluate(() => window.__speechTest.activeTracks), 0);
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isDisabled(), true);
    await assertNoSpokenTranscript(page);
    assert.deepEqual(await saved(page), missed, 'A technical capture failure also preserves the final scored attempt.');
    await recovery.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Retry' && !button.disabled));
    assert.equal(await page.evaluate(() => window.__speechTest.stimulusPlays), stimulusPlays, 'Input recovery listens again without replaying the remembered sequence.');
    await recordSpeech(page, wrong, {}, { again: true });
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    await page.getByRole('status').filter({ hasText: /^Round 1: moving on after two tries\.$/ }).waitFor();
    await assertAutoPresentation(page);
    assert.equal(advanced.session.history.length, 1);
    assert.equal(advanced.session.history[0].correct, false);
    assert.equal(advanced.session.history[0].retryCorrect, false);
    assert.equal(advanced.redeemed.includes(round.id), false);
    assert.deepEqual(advanced.tasks, missed.tasks);
    assert.deepEqual(digitTotals(advanced), { attempts: 1, correct: 0 });
    assert.equal(getMemoryRewards(restoreSaved(advanced)).xp, 10);
    await assertNoSpokenTranscript(page);
    await page.evaluate(() => window.__speechTest.repeatFinal());
    assert.deepEqual(await saved(page), advanced, 'A late duplicate final cannot score the next challenge or replenish the failed one.');
    assert.equal(await page.getByRole('button', { name: 'Replay sequence', exact: true }).count(), 0);
    await assertNoPlaintext(page, advanced);
    await assertLocalSpeech(opened);
  } finally { await context.close(); }
});

test('a second miss on the final challenge completes the session with practice XP and trophies exactly once', { timeout: 60_000 }, async () => {
  const opened = await open({ width: 320 });
  const { context, page } = opened;
  try {
    let session = createProgress('browser-final-two-misses', 8, { focusedTask: 'forward', profile: RESEARCH_PROFILE, adaptation: COMFORT_ADAPTATION });
    for (let index = 0; index < 7; index++) session = advanceRound(recordFirstAttempt(session, session.active, true));
    const round = session.active;
    const wrong = [...round.expected]; wrong[0] = (wrong[0] + 1) % 16;
    await seedSession(page, session);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    await assertAutoPresentation(page);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, round, wrong);
    await check(page, { correct: false });
    const missed = await saved(page, value => value?.session?.answered);
    assert.equal(missed.logs.length, 0, 'The session remains active while its final memory attempt is available.');
    assert.equal(getMemoryRewards(restoreSaved(missed)).xp, 80);
    await present(page, { replay: true });
    await enter(page, round, wrong);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
    await page.getByRole('heading', { name: /^Session complete\.?$/ }).waitFor();
    const completed = await saved(page, value => value?.session?.cursor === 8 && value?.logs.length === 1);
    assert.equal(completed.session.active, null);
    assert.equal(completed.session.answered, false);
    assert.equal(completed.session.history.length, 8);
    assert.equal(completed.session.history[7].correct, false);
    assert.equal(completed.session.history[7].retryCorrect, false);
    assert.equal(completed.redeemed.includes(round.id), false);
    assert.equal(completed.tasks.forward.attempts, 8);
    assert.equal(completed.tasks.forward.correct, 7);
    assert.equal(completed.logs[0].rounds, 8);
    assert.equal(completed.logs[0].correct, 7);
    const rewards = getMemoryRewards(restoreSaved(completed));
    assert.equal(rewards.xp, 80);
    assert.equal(rewards.correct, 7);
    assert.equal(rewards.trophies.find(trophy => trophy.id === 'first-footsteps').earned, true);
    assert.equal(rewards.trophies.find(trophy => trophy.id === 'bright-eyes').earned, true, 'Trophies reward practice even when the final answer is missed.');
    const celebration = page.getByRole('region', { name: 'Adventure celebration', exact: true });
    await celebration.getByLabel('80 XP earned this session', { exact: true }).waitFor();
    await celebration.getByText('First footsteps', { exact: true }).waitFor();
    await celebration.getByText('Bright eyes', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^(Check sequence|Replay sequence|Next round|Finish session)/ }).count(), 0);
    await assertFits(page, 'bounded final-round celebration');
    await page.getByRole('button', { name: /^Back to trail/ }).click();
    await assertMemoryXp(page, 80);
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    await page.reload();
    await unlock(page);
    assert.deepEqual(await saved(page), completed, 'Reloading a session completed by two misses cannot duplicate its log, XP, or trophy credit.');
    await assertMemoryXp(page, 80);
    await assertNoPlaintext(page, completed);
    await assertClean(opened);
  } finally { await context.close(); }
});

test('an earlier hard span remains exact until two misses, then its easier comfort state survives reload independently of other digit variants', { timeout: 75_000 }, async () => {
  const opened = await open();
  const { context, page } = opened;
  try {
    const digitVariant = { order: 'ascending', inputMode: 'keypad', keypad: 'hidden' };
    const tasks = selectTaskStates({ ...fresh(), digitVariant });
    tasks['sort-digits'] = { ...tasks['sort-digits'], span: 6 };
    const session = createProgress('browser-legacy-hard-digits', 8, { focusedTask: 'sort-digits', profile: RESEARCH_PROFILE, tasks, digitVariant });
    const round = session.active;
    const wrong = [...round.expected]; wrong[0] = wrong[0] % 9 + 1;
    await seedSession(page, session);
    assert.equal(session.adaptation, undefined);
    await page.getByRole('button', { name: /^Continue session/ }).click();
    const resumed = await saved(page);
    assert.deepEqual(resumed.session, session, 'Opening a pre-change save preserves its current stimulus, plan, identity, and load.');
    assert.equal(resumed.session.active.span, 6);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).waitFor();
    await enter(page, round, wrong);
    await check(page, { correct: false });
    const missed = await saved(page, value => value?.session?.answered);
    assert.equal(missed.session.active.span, 6, 'The one remaining attempt replays the same challenge.');
    await present(page, { replay: true, audio: true });
    await enter(page, round, wrong);
    await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
    const advanced = await saved(page, value => value?.session?.cursor === 1);
    await assertAutoPresentation(page);
    assert.equal(advanced.session.adaptation, COMFORT_ADAPTATION);
    assert.equal(advanced.session.comfortFrom, 1);
    assert.equal(advanced.session.active.span, 5, 'An already-stuck earlier session tries a smaller load at the next boundary.');
    assert.equal(advanced.tasks['sort-digits'].comfortSpan, 5);
    assert.ok(advanced.tasks['sort-digits'].probeWait >= 8, 'The failed harder span receives a rest before another probe.');
    assert.ok(advanced.tasks['sort-digits'].probeBackoff > 0);
    const support = structuredClone(advanced.tasks['sort-digits']);
    await page.getByRole('button', { name: /Save & exit/ }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    const ended = await saved(page, value => value?.session === null);
    assert.deepEqual(ended.conditions[conditionKey('sort-digits', ended)], support);
    await page.reload();
    await unlock(page);
    const retained = await saved(page);
    assert.deepEqual(selectTaskStates(retained)['sort-digits'], support, 'The comfort span and failed-probe rest survive encrypted reload.');
    await selectDigits(page, { ...digitVariant, order: 'descending' });
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).click();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
    const other = await saved(page, value => value?.session?.digitVariant?.order === 'descending');
    assert.deepEqual(other.session.digitVariant, { ...digitVariant, order: 'descending' });
    assert.equal(other.session.active.span, 2);
    assert.equal(other.session.initialTasks['sort-digits'].attempts, 0);
    assert.equal(other.session.initialTasks['sort-digits'].probeBackoff, 0, 'A failed ascending probe cannot make another variant wait.');
    await page.getByRole('button', { name: /Save & exit/ }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await selectDigits(page, digitVariant);
    await page.getByRole('button', { name: 'Practice Digits', exact: true }).click();
    await page.getByRole('heading', { name: 'Digits', exact: true }).waitFor();
    const restored = await saved(page, value => value?.session?.digitVariant?.order === 'ascending');
    assert.deepEqual(restored.session.digitVariant, digitVariant);
    assert.equal(restored.session.active.span, 5);
    assert.deepEqual(restored.session.initialTasks['sort-digits'], support, 'Returning to the original variant retains its supported load and probe history.');
    assert.equal(getMemoryRewards(restoreSaved(restored)).xp, 10);
    await assertNoPlaintext(page, restored);
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
    assert.equal(await page.getByRole('button', { name: 'Practice Exercise symbols', exact: true }).isEnabled(), true, 'Ending a session is optional when choosing another exercise.');
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    const ended = await saved(page, value => value?.session === null);
    assert.deepEqual(ended.tasks, selectTaskStates(before), 'Ending a session retains played banks; untouched games remain independent defaults.');
    assert.deepEqual(ended.conditions, before.conditions);
    assert.deepEqual(ended.archivedConditions, before.archivedConditions);
    assert.deepEqual(ended.legacyTasks, before.legacyTasks);
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
    await assertMemoryXp(page, 10);
    await page.getByRole('button', { name: 'Reset device progress', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await saved(page), before, 'Cancelling reset preserves encrypted progress.');
    await page.getByRole('button', { name: 'Reset device progress', exact: true }).click();
    await page.getByRole('button', { name: 'Erase lab progress', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Memory Lab progress reset.' }).waitFor();
    assert.equal(await readSaved(page), null);
    await assertMemoryXp(page, 0);
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
