import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertNotBossHoldout, findBossHoldout } from '../scripts/generate-math-world-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const policy = JSON.parse(await readFile(path.join(root, 'content/math-world/boss-holdouts.json'), 'utf8'));
const bank = JSON.parse(await readFile(path.join(root, 'content/math-world/spiral-20.runtime.json'), 'utf8'));
const references = policy.challenges.flatMap(challenge => challenge.questions.flatMap(question =>
  [question.sourceId, ...question.reservedReferences.map(reference => reference.id)]));

const allowed = [
  { id: 'think-academy-mock-2026-march-lv12-q21', source: { year: 2026, gradeBand: '1-2', sourceFamily: 'Think Academy', sourceKind: 'mock' } },
  { id: 'workbook-2025-example', source: { year: 2025, gradeBand: '1-2', sourceFamily: 'Think Academy', sourceKind: 'practice' } },
  { id: 'usa-video-2026-grades-3-4-q03', source: { year: 2026, gradeBand: '3-4', sourceFamily: 'USA Video Questions', sourceKind: 'contest' } },
  { id: 'usa-2024-grades-1-2-q01', source: { year: 2024, gradeBand: '1-2', sourceFamily: 'USA', sourceKind: 'contest' } },
  { id: 'usa-team-full-2025-grades-1-2-q01', source: { year: 2025, gradeBand: '1-2', sourceFamily: 'USA Team', sourceKind: 'contest' } },
  { id: 'usa-mock-2026-q01', source: { year: 2026, gradeBand: '1-2', sourceFamily: 'USA', sourceKind: 'mock' } },
  { id: 'usa-practice-2025-q01', source: { year: 2025, gradeBand: '1-2', sourceFamily: 'USA', sourceKind: 'practice' } },
];
const renamedAnnual = [2025, 2026].map(year => ({ id: `renamed-annual-${year}`, source: {
  year, gradeBand: '1-2', sourceFamily: 'USA Annual Archive', sourceKind: 'contest', questionNumber: 1,
} }));

test('the two boss milestones reserve 24 ordered annual questions each', () => {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.challenges.length, 2);
  assert.deepEqual(policy.challenges.map(({ year, afterWorldNumber }) => [year, afterWorldNumber]), [[2025, 10], [2026, 20]]);
  for (const challenge of policy.challenges) {
    assert.equal(challenge.status, 'placeholder');
    assert.equal(challenge.gradeBand, '1-2');
    assert.equal(challenge.questionCount, 24);
    assert.deepEqual(challenge.questions.map(question => question.number), Array.from({ length: 24 }, (_, index) => index + 1));
    for (const question of challenge.questions) {
      const prefix = challenge.year === 2025 ? 'electronic' : 'video';
      assert.equal(question.sourceId, `usa-${prefix}-${challenge.year}-grades-1-2-q${String(question.number).padStart(2, '0')}`);
      assert(question.reservedReferences.length > 0, `${question.sourceId} needs its documented canonical counterpart`);
      for (const reference of question.reservedReferences) {
        assert(reference.id && reference.relation && reference.linkedFromId);
        assert.match(reference.evidence, /^oasis-sources\/corpus-integration\/[a-z-]+\.jsonl:\d+$/);
      }
    }
  }
  assert.equal(new Set(references).size, references.length, 'each source identity belongs to only one test question');
  assert(!JSON.stringify(policy).includes('/Users/'));
  assert(!/https?:\/\//.test(JSON.stringify(policy)));
});

test('all annual occurrences, canonical aliases, and related variants are excluded from teaching', () => {
  for (const id of references) assert.throws(() => assertNotBossHoldout({ id }), /boss holdout: .*reserved for.*challenge after world (10|20)/);
  for (const question of renamedAnnual) assert.throws(() => assertNotBossHoldout(question), /Remove it from the 20 teaching worlds/);
  assert.throws(() => assertNotBossHoldout({ id: 'renamed-copy', source: { canonicalId: references[1] } }), /boss holdout/);
});

test('publication years, mocks, team tests, and other grades are not blanket holdouts', () => {
  for (const question of allowed) assert.equal(findBossHoldout(question), undefined, question.id);
});

test('the approved 480 teaching questions contain no boss exposure and keep their content version', () => {
  assert.equal(bank.contentVersion, 'spiral-20.v1.f665226c7060bba8');
  assert.equal(bank.worlds.length, 20);
  assert.equal(bank.questions.length, 480);
  for (const question of bank.questions) assertNotBossHoldout(question);
});

test('the runtime exporter refuses held-out aliases and renamed annual sources before writing output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'math-world-holdout-'));
  const output = path.join(root, 'app/math-world/data/runtime.generated.json');
  const before = await readFile(output, 'utf8');
  try {
    for (const replacement of [{ id: 'cyprus-2025-grades-1-2-part-single-q01' }, renamedAnnual[1]]) {
      const payload = structuredClone(bank);
      Object.assign(payload.questions[0], replacement);
      const manifest = path.join(directory, 'preview.json');
      await writeFile(manifest, JSON.stringify(payload));
      assert.throws(() => execFileSync(process.execPath, ['scripts/generate-math-world-runtime.mjs'], {
        cwd: root, env: { ...process.env, MATH_WORLD_PREVIEW: '1', MATH_WORLD_PREVIEW_MANIFEST: manifest }, stdio: 'pipe',
      }), error => /boss holdout/.test(error.stderr.toString()));
    }
    assert.equal(await readFile(output, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the private authoring builder enforces the same source identities and provenance policy', () => {
  const cases = [...references.map(id => ({ question: { id }, blocked: true })),
    ...renamedAnnual.map(question => ({ question, blocked: true })),
    ...allowed.map(question => ({ question, blocked: false }))];
  const script = `
import importlib.util, json, pathlib, sqlite3, sys, tempfile
spec = importlib.util.spec_from_file_location('spiral_builder', 'scripts/build-spiral-worlds.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for case in json.load(sys.stdin):
    question = case['question']
    blocked = False
    try: module.assert_not_boss_holdout(question['id'], question.get('source', {}))
    except ValueError as error:
        assert 'boss holdout' in str(error)
        blocked = True
    assert blocked == case['blocked'], question['id']
with tempfile.TemporaryDirectory() as directory:
    directory = pathlib.Path(directory)
    database = directory / 'catalogue.sqlite3'
    connection = sqlite3.connect(database)
    connection.execute('CREATE TABLE catalogue_items (run_id TEXT, item_id TEXT, year INTEGER, grade_band TEXT, source_family TEXT)')
    connection.execute('INSERT INTO catalogue_items VALUES (?, ?, ?, ?, ?)', (module.RUN_ID, 'renamed-annual', 2025, '1-2', 'USA'))
    connection.commit()
    connection.close()
    review = directory / 'review.json'
    review.write_text(json.dumps({'catalogueRunId':module.RUN_ID, 'records':[{'itemId':'renamed-annual'}]}))
    try: module.build(database, [review], directory/'runtime.json', directory/'plan.json')
    except ValueError as error: assert 'boss holdout' in str(error), str(error)
    else: raise AssertionError('Authoring builder accepted a held-out annual source')
    assert not (directory/'runtime.json').exists()
    assert not (directory/'plan.json').exists()
`;
  execFileSync('python3', ['-c', script], {
    cwd: root, input: JSON.stringify(cases), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
});
