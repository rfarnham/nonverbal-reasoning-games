import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'math-world-build-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'scripts/generate-math-world-runtime.mjs');
  const approved = path.join(root, 'content/math-world/spiral-32.runtime.json');
  const assets = path.join(root, 'public/math-world/spiral-questions');
  const generated = path.join(root, 'app/math-world/data/runtime.generated.json');
  for (const directory of [path.dirname(script), path.dirname(approved), assets]) await mkdir(directory, { recursive: true });
  await copyFile(new URL('../scripts/generate-math-world-runtime.mjs', import.meta.url), script);
  await copyFile(new URL('../content/math-world/boss-holdouts.json', import.meta.url), path.join(root, 'content/math-world/boss-holdouts.json'));
  const payload = { schemaVersion: 2, mode: 'spiral-preview', contentVersion: 'approved-version-unchanged', ontologyVersion: 'test-taxonomy', worlds: [], stops: [], breaks: [], questions: [] };
  for (let worldIndex = 0; worldIndex < 32; worldIndex++) {
    const worldId = `world-${worldIndex}`;
    const stopIds = Array.from({ length: 4 }, (_, index) => `${worldId}-stop-${index}`);
    payload.worlds.push({ id: worldId, stopIds, number: worldIndex + 1, spiral: worldIndex < 16 ? 1 : 2, conceptId: `concept-${worldIndex % 16}`, questionCount: 24 });
    for (let stopIndex = 0; stopIndex < 4; stopIndex++) {
      const stopId = stopIds[stopIndex];
      payload.stops.push({ id: stopId, worldId, mapSlot: stopIndex });
      for (let index = 0; index < 6; index++) {
        const id = `${stopId}-question-${index}`;
        const bytes = Buffer.from(`approved asset ${id}`);
        const filename = `${id}.webp`;
        await writeFile(path.join(assets, filename), bytes);
        payload.questions.push({ id, worldId, stopId, prompt: `Approved ${id}`, choices: [1, 2, 3, 4].map(label => ({ label: String(label) })), correctIndex: index % 4,
          source: { gradeBand: '1-2', pointTier: 3 },
          asset: { src: `/math-world/spiral-questions/${filename}`, width: 20, height: 20, sha256: createHash('sha256').update(bytes).digest('hex') } });
      }
    }
  }
  await writeFile(approved, JSON.stringify(payload));
  const run = (env = {}) => execute(process.execPath, [script], {
    cwd: root, env: { ...process.env, MATH_WORLD_PREVIEW: '0', MATH_WORLD_PREVIEW_MANIFEST: '', ...env },
  });
  return { root, approved, assets, generated, payload, run };
}

test('standard builds use the approved complete question bank without changing published files', async context => {
  const f = await fixture(context);
  const original = await readFile(f.approved, 'utf8');
  const sentinel = path.join(f.assets, 'keep-existing.webp');
  await writeFile(sentinel, 'do not remove or overwrite');
  await f.run();
  assert.deepEqual(JSON.parse(await readFile(f.generated, 'utf8')), f.payload);
  assert.equal(await readFile(f.approved, 'utf8'), original);
  assert.equal(await readFile(sentinel, 'utf8'), 'do not remove or overwrite');
  assert.equal((await readdir(f.assets)).length, 769);
  await f.run({ MATH_WORLD_PREVIEW: '1' });
  assert.deepEqual(JSON.parse(await readFile(f.generated, 'utf8')), f.payload, 'preview convenience command defaults to the approved bank');
});

test('a local manifest override requires opt-in and can only reuse approved assets', async context => {
  const f = await fixture(context);
  const local = structuredClone(f.payload);
  local.contentVersion = 'explicit-local-variant';
  local.questions[0].prompt = 'LOCAL WORDING VARIANT';
  const input = path.join(f.root, 'local-manifest.json');
  await writeFile(input, JSON.stringify(local));
  await f.run({ MATH_WORLD_PREVIEW_MANIFEST: input });
  assert.deepEqual(JSON.parse(await readFile(f.generated, 'utf8')), f.payload, 'an unrequested override is ignored');
  await f.run({ MATH_WORLD_PREVIEW: '1', MATH_WORLD_PREVIEW_MANIFEST: input });
  assert.deepEqual(JSON.parse(await readFile(f.generated, 'utf8')), local);
  const unapprovedBytes = Buffer.from('unapproved extra asset');
  await writeFile(path.join(f.assets, 'unapproved.webp'), unapprovedBytes);
  local.questions[0].asset.src = '/math-world/spiral-questions/unapproved.webp';
  local.questions[0].asset.sha256 = createHash('sha256').update(unapprovedBytes).digest('hex');
  await writeFile(input, JSON.stringify(local));
  await assert.rejects(f.run({ MATH_WORLD_PREVIEW: '1', MATH_WORLD_PREVIEW_MANIFEST: input }), /preview asset is not in the approved bank/);
  assert.equal(JSON.parse(await readFile(f.generated, 'utf8')).contentVersion, 'explicit-local-variant', 'rejected preview preserves the last valid output');
  await f.run();
  assert.deepEqual(JSON.parse(await readFile(f.generated, 'utf8')), f.payload);
  assert.equal(await readFile(path.join(f.assets, 'unapproved.webp'), 'utf8'), 'unapproved extra asset', 'the generator never manages public assets');
});

test('missing approved input and missing or corrupt assets fail without a prototype fallback', async context => {
  const f = await fixture(context);
  await f.run();
  const previous = await readFile(f.generated, 'utf8');
  await rm(f.approved);
  await assert.rejects(f.run(), /Cannot read approved Math Worlds manifest/);
  assert.equal(await readFile(f.generated, 'utf8'), previous);
  await writeFile(f.approved, JSON.stringify(f.payload));
  const missing = path.join(f.assets, path.basename(f.payload.questions[0].asset.src));
  await rm(missing);
  await assert.rejects(f.run(), /Missing or unreadable approved Math Worlds asset/);
  assert.equal(await readFile(f.generated, 'utf8'), previous);
  await writeFile(missing, 'corrupted image bytes');
  await assert.rejects(f.run(), /asset hash mismatch/);
  assert.equal(await readFile(f.generated, 'utf8'), previous);
});

test('invalid coverage, membership, answer keys, scope and asset references preserve valid output', async context => {
  const f = await fixture(context);
  await f.run();
  const previous = await readFile(f.generated, 'utf8');
  const cases = [
    [bank => bank.worlds.pop(), /expected 32 worlds/],
    [bank => bank.stops.pop(), /ordered stops/],
    [bank => bank.questions.pop(), /authored question count/],
    [bank => bank.breaks.push({ id: 'unapproved-break' }), /expected no optional break stops/],
    [bank => { bank.questions[0].stopId = bank.questions[6].stopId; }, /must contain five or six questions/],
    [bank => { bank.questions[0].worldId = 'world-1'; }, /invalid question membership/],
    [bank => { bank.questions[1].id = bank.questions[0].id; }, /duplicate or missing question ID/],
    [bank => { bank.worlds[0].stopIds.reverse(); }, /ordered stops/],
    [bank => { bank.questions[0].correctIndex = 4; }, /invalid answer choices/],
    [bank => { bank.questions[0].source = { gradeBand: '3-4', pointTier: 5 }; }, /outside approved grades and point tiers/],
    [bank => { bank.questions[0].asset.src = '/math-world/spiral-questions/../../outside.webp'; }, /invalid asset reference/],
    [bank => { bank.questions[0].asset.sha256 = ''; }, /invalid asset metadata/],
  ];
  for (const [mutate, error] of cases) {
    const invalid = structuredClone(f.payload);
    mutate(invalid);
    await writeFile(f.approved, JSON.stringify(invalid));
    await assert.rejects(f.run(), error);
    assert.equal(await readFile(f.generated, 'utf8'), previous);
  }
});

test('compact worlds keep complete five-question stops and authentic two-choice questions', async context => {
  const f = await fixture(context);
  const world = f.payload.worlds[0];
  world.stopIds = world.stopIds.slice(0,2);
  world.questionCount = 10;
  f.payload.stops = f.payload.stops.filter(stop => stop.worldId !== world.id || world.stopIds.includes(stop.id));
  f.payload.questions = f.payload.questions.filter(question => question.worldId !== world.id
    || (world.stopIds.includes(question.stopId) && !question.id.endsWith('-question-5')));
  f.payload.questions[0].choices = f.payload.questions[0].choices.slice(0,2);
  await writeFile(f.approved, JSON.stringify(f.payload));
  await f.run();
  assert.deepEqual(JSON.parse(await readFile(f.generated, 'utf8')), f.payload);
  f.payload.questions[0].choices.pop();
  await writeFile(f.approved, JSON.stringify(f.payload));
  await assert.rejects(f.run(), /invalid answer choices/);
});

test('declared progress migration cannot conceal changed legacy questions or question order', async context => {
  const f = await fixture(context);
  const previous = { contentVersion: 'prior-reviewed-bank', worlds: [f.payload.worlds[0]],
    questions: f.payload.questions.filter(question => question.worldId === f.payload.worlds[0].id) };
  await writeFile(path.join(f.root, 'content/math-world/spiral-20.runtime.json'), JSON.stringify(previous));
  f.payload.compatibleProgressVersions = [previous.contentVersion];
  await writeFile(f.approved, JSON.stringify(f.payload));
  await f.run();
  const output = await readFile(f.generated, 'utf8');
  for (const change of [
    payload => { payload.questions[0].prompt = 'A different problem'; },
    payload => { payload.questions[0].correctIndex = 1; },
    payload => { [payload.questions[0],payload.questions[1]] = [payload.questions[1],payload.questions[0]]; },
    payload => { payload.compatibleProgressVersions = ['unknown-version']; },
  ]) {
    const invalid = structuredClone(f.payload);
    change(invalid);
    await writeFile(f.approved, JSON.stringify(invalid));
    await assert.rejects(f.run(), /progress compatibility/);
    assert.equal(await readFile(f.generated, 'utf8'), output);
  }
});
