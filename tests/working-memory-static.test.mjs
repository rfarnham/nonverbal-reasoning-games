import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { validateMemoryManifest } from '../app/lab/working-memory/vault.ts';

const project = new URL('../', import.meta.url);
const output = new URL('../out/', import.meta.url);
const basePath = '/nonverbal-reasoning-games';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function filesBelow(root, prefix = '') {
  const entries = await readdir(new URL(prefix, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    assert.equal(entry.isSymbolicLink(), false, 'Public lab assets cannot link to private build inputs.');
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesBelow(root, `${relative}/`));
    else files.push(relative);
  }
  return files.sort();
}

test('Memory Lab exports a locked, noindex, hard-refresh-safe GitHub Pages route', async () => {
  const [html, home] = await Promise.all([
    readFile(new URL('lab/working-memory/index.html', output), 'utf8'),
    readFile(new URL('index.html', output), 'utf8'),
  ]);
  assert.match(html, /<title>Memory Lab · Spatial Gym<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Password/);
  assert.match(html, /Unlock/);
  assert.match(home, new RegExp(`href="${basePath}/lab/working-memory/"`));
  assert.match(html, new RegExp(`href="${basePath}/"`));
  const passwordInputs = [...html.matchAll(/<input\b[^>]*type="password"[^>]*>/g)].map(match => match[0]);
  assert.equal(passwordInputs.length, 1);
  assert.match(passwordInputs[0], /value=""/);
  assert.doesNotMatch(html, /<(?:article|audio|source)\b/, 'The locked export cannot prerender exercise cards or audio.');
  // Inspect public format markers, never embed the real content or password in CI.
  assert.doesNotMatch(html, /(?:"|\\")(?:(?:tasks|sources|evidenceNote|sequence|expected|fingerprint|initialTasks|history))(?:"|\\")\s*:/);
  assert.doesNotMatch(html, /speechText|working-memory\/audio\/|data:audio\//);
  assert.doesNotMatch(html, /<(?:script|audio|source|iframe)\b[^>]*\bsrc="https?:/);
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  const assets = urls.filter(url => url.includes('/_next/'));
  assert.ok(assets.length > 0, 'The hard-refresh route must include its local application assets.');
  for (const asset of assets) {
    assert.ok(asset.startsWith(`${basePath}/_next/`), 'An application asset bypasses the Pages base path.');
    await access(new URL(asset.slice(basePath.length + 1).split('?')[0], output));
  }
  for (const url of urls.filter(value => value.startsWith('/'))) {
    assert.ok(url.startsWith(`${basePath}/`), 'An internal route bypasses the Pages base path.');
  }
});

test('the exported lab publishes only a minimal manifest and ten authenticated ciphertexts', async () => {
  const publicRoot = new URL('public/working-memory/', project);
  const exportedRoot = new URL('working-memory/', output);
  const [published, exported] = await Promise.all([filesBelow(publicRoot), filesBelow(exportedRoot)]);
  assert.deepEqual(exported, published, 'Static export must preserve exactly the encrypted public pack.');
  const manifest = JSON.parse(await readFile(new URL('vault/manifest.json', exportedRoot), 'utf8'));
  validateMemoryManifest(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), ['assets', 'encryption', 'payload', 'schemaVersion', 'version']);
  assert.deepEqual(Object.keys(manifest.encryption).sort(), ['hash', 'iterations', 'kdf', 'name', 'salt']);
  assert.equal(manifest.encryption.iterations, 600000);
  const files = [manifest.payload, ...Object.values(manifest.assets)];
  assert.equal(files.length, 10);
  assert.deepEqual(published, ['NOTICE.md', 'vault/manifest.json', ...files.map(file => `vault/${file.path}`)].sort());
  assert.deepEqual(published.filter(file => file.endsWith('.json')), ['vault/manifest.json']);
  assert.equal(published.filter(file => file !== 'NOTICE.md').some(file => /\.(?:mp3|wav|ogg|txt|md)$/i.test(file)), false, 'Only attribution may accompany the encrypted content and spoken digits.');
  const notice = await readFile(new URL('NOTICE.md', exportedRoot), 'utf8');
  assert.match(notice, /Kokoro-82M/);
  assert.match(notice, /Apache(?:-| License )2\.0/);
  assert.doesNotMatch(notice, /speechText|"(?:tasks|sources|sequence|expected)"\s*:/, 'Attribution must not include authored exercises or transcripts.');
  for (const file of files) {
    assert.deepEqual(Object.keys(file).sort(), ['bytes', 'path', 'sha256']);
    const [original, copy] = await Promise.all([
      readFile(new URL(`vault/${file.path}`, publicRoot)),
      readFile(new URL(`vault/${file.path}`, exportedRoot)),
    ]);
    assert.equal(copy.length, file.bytes);
    assert.equal(digest(copy), file.sha256, 'Static export must retain each authenticated ciphertext without changes.');
    assert.equal(digest(original), file.sha256);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /speechText|transcript|working-memory\/audio\/|https?:|password/);
});
