import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTracks, createState, chooseNext, recordOutcome, adjustLevel, describeState,
} from '../public/homework-arcade/adaptive.js';
import { verbalLevels, verbalExcluded } from '../public/homework-arcade/adaptive-verbal-levels.js';

function track(id = 'test-skill', maxLevel = 5, perLevel = 8) {
  return {
    id, label: 'Test skill', category: 'test', maxLevel, startLevel: Math.min(4, maxLevel),
    items: Array.from({ length: maxLevel * perLevel }, (_, index) => ({
      id: `opaque-${id}-${index}`, level: Math.floor(index / perLevel) + 1,
      question: { id: `opaque-${id}-${index}`, prompt: 'Protected material must stay out of state.', answer: 'SECRET-ANSWER' },
    })),
  };
}

function complete(t, state, outcome) {
  const item = chooseNext(t, state);
  assert.ok(item, 'practice must remain available');
  return { item, state: recordOutcome(t, state, item.id, outcome) };
}

test('starts with a challenging item, never with the easiest default', () => {
  const t = track();
  const state = createState(t);
  assert.equal(state.level, 4);
  assert.equal(chooseNext(t, state).level, 4);
  assert.equal(describeState(t, state).phase, 'calibration');
});

test('calibrates rapidly, climbs on fresh independent answers, and lowers after unmet', () => {
  const t = track();
  let state = createState(t);
  state = complete(t, state, 'independent').state;
  assert.equal(state.level, 4);
  state = complete(t, state, 'independent').state;
  assert.equal(state.level, 5);
  state = complete(t, state, 'unmet').state;
  assert.equal(state.level, 4);
  state = complete(t, state, 'supported').state;
  assert.equal(describeState(t, state).phase, 'practice');
  assert.equal(state.level, 4);
  for (let i = 0; i < 3; i++) state = complete(t, state, 'independent').state;
  assert.equal(state.level, 5);
});

test('continuous practice survives five misses and large runs of unmet answers', () => {
  const t = track();
  let state = createState(t);
  for (let i = 0; i < 100; i++) {
    state = complete(t, state, 'unmet').state;
    assert.ok(state.level >= 1 && state.level <= 5);
    assert.ok(chooseNext(t, state));
  }
  assert.equal(state.level, 1);
  assert.equal(state.trial, 100);
  assert.equal(describeState(t, state).counts.unmet, 100);
});

test('supported success stays separate and can never promote itself', () => {
  const t = track();
  let state = createState(t);
  for (let i = 0; i < 45; i++) state = complete(t, state, 'supported').state;
  assert.equal(state.level, 4);
  assert.deepEqual(describeState(t, state).counts, { independent: 0, supported: 45, unmet: 0 });
  assert.equal(state.independentRun.length, 0);
});

test('familiar coached items cannot supply fresh transfer evidence for promotion', () => {
  const t = track();
  let state = createState(t);
  const item = chooseNext(t, state);
  state = recordOutcome(t, state, item.id, 'supported');
  for (let i = 0; i < 8; i++) state = recordOutcome(t, state, item.id, 'independent');
  assert.equal(state.level, 4);
  assert.equal(state.independentRun.length, 0);
  assert.equal(describeState(t, state).counts.independent, 8);
  assert.equal(describeState(t, state).counts.supported, 1);
});

test('legacy familiarity prevents promotion without inventing independent or supported scores', () => {
  const t = track();
  const known = t.items.filter((item) => item.level === 4).map((item) => item.id);
  let state = createState(t, { ...createState(t), familiar: known });
  for (const id of known.slice(0, 4)) state = recordOutcome(t, state, id, 'independent');
  assert.equal(state.level, 4);
  assert.equal(state.independentRun.length, 0);
  assert.deepEqual(describeState(t, state).counts, { independent: 4, supported: 0, unmet: 0 });
  assert.equal(state.familiar.length, known.length);
});

test('calibration reset can retain familiarity while resetting ability and trial counts', () => {
  const t = track();
  let state = createState(t);
  state = complete(t, state, 'independent').state;
  state = complete(t, state, 'supported').state;
  const reset = createState(t, { ...createState(t), familiar: state.familiar });
  assert.equal(reset.level, 4);
  assert.equal(reset.phase, 0);
  assert.equal(reset.trial, 0);
  assert.deepEqual(reset.evidence, {});
  assert.deepEqual(reset.familiar, state.familiar);
  assert.deepEqual(describeState(t, reset).counts, { independent: 0, supported: 0, unmet: 0 });
});

test('fresh equal-level transfer is selected before legacy-familiar material', () => {
  const t = track();
  const levelFour = t.items.filter((item) => item.level === 4);
  const state = createState(t, { ...createState(t), familiar: levelFour.slice(0, 5).map((item) => item.id) });
  assert.equal(chooseNext(t, state).id, levelFour[5].id);
  const passed = recordOutcome(t, state, levelFour[5].id, 'pass');
  assert.ok(!passed.familiar.includes(levelFour[5].id), 'an unpresented pass does not create familiarity');
  const presentedPass = createState(t, { ...passed, familiar: [...passed.familiar, levelFour[5].id] });
  assert.equal(chooseNext(t, presentedPass).id, levelFour[6].id);
  assert.equal(recordOutcome(t, presentedPass, levelFour[5].id, 'independent').independentRun.length, 0);
});

test('a pass neither demotes nor counts as inability or calibration evidence', () => {
  const t = track();
  let state = createState(t);
  for (let i = 0; i < 10; i++) state = complete(t, state, 'pass').state;
  assert.equal(state.level, 4);
  assert.equal(state.calibrationTrials, 0);
  assert.deepEqual(describeState(t, state).counts, { independent: 0, supported: 0, unmet: 0 });
  assert.equal(describeState(t, state).passed, 10);
});

test('no partial-grade, recall ratio, or unknown outcome becomes supported automatically', () => {
  const t = track();
  const state = createState(t);
  const id = chooseNext(t, state).id;
  for (const outcome of [0, 1, 2, undefined, null, 'partial', 'correct', { grade: 1 }, { recalled: 8, total: 10 }]) {
    assert.deepEqual(recordOutcome(t, state, id, outcome), state);
  }
  assert.deepEqual(recordOutcome(t, state, 'unknown-question', 'independent'), state);
});

test('selection is fresh at the boundary; supported revisits wait three intervening trials', () => {
  const t = track();
  let state = createState(t);
  const first = chooseNext(t, state);
  state = recordOutcome(t, state, first.id, 'supported');
  const intervening = [];
  for (let i = 0; i < 3; i++) {
    const item = chooseNext(t, state);
    assert.notEqual(item.id, first.id);
    assert.ok(!intervening.includes(item.id));
    intervening.push(item.id);
    state = recordOutcome(t, state, item.id, 'pass');
  }
  assert.equal(chooseNext(t, state).id, first.id);
  assert.equal(state.trial - state.evidence[first.id][4], 3);
});

test('unmet revisit spacing holds during a changing target without immediate repeats', () => {
  const t = track();
  let state = createState(t);
  const lastSeen = new Map();
  let previous;
  for (let i = 0; i < 80; i++) {
    const item = chooseNext(t, state);
    assert.notEqual(item.id, previous);
    const previousRecord = lastSeen.get(item.id);
    if (previousRecord?.outcome === 'unmet') assert.ok(i - previousRecord.at >= 4);
    const outcome = i % 3 === 0 ? 'unmet' : 'pass';
    state = recordOutcome(t, state, item.id, outcome);
    lastSeen.set(item.id, { at: i, outcome });
    previous = item.id;
  }
});

test('pool exhaustion keeps selecting, bounded and without immediate repeats when alternatives exist', () => {
  const t = track('tiny', 1, 3);
  let state = createState(t);
  let previous;
  for (let i = 0; i < 120; i++) {
    const item = chooseNext(t, state);
    assert.notEqual(item.id, previous);
    assert.equal(item.level, 1);
    state = recordOutcome(t, state, item.id, 'independent');
    previous = item.id;
  }
  const one = track('single', 1, 1);
  let singleton = createState(one);
  for (let i = 0; i < 12; i++) singleton = complete(one, singleton, 'unmet').state;
  assert.equal(singleton.trial, 12);
  assert.ok(chooseNext(one, singleton));
  assert.equal(chooseNext({ id: 'empty', items: [] }, null), null);
});

test('per-skill states and parent steering preserve independent evidence', () => {
  const picture = track('picture');
  const spoken = track('spoken');
  let state = createState(picture);
  state = complete(picture, state, 'supported').state;
  state = complete(picture, state, 'unmet').state;
  const evidence = structuredClone(state.evidence);
  state = adjustLevel(picture, state, 100);
  assert.equal(state.level, 5);
  assert.deepEqual(state.evidence, evidence);
  state = adjustLevel(picture, state, -100);
  assert.equal(state.level, 1);
  assert.deepEqual(state.evidence, evidence);
  assert.deepEqual(createState(spoken, state), createState(spoken));
});

test('selection and outcomes do not mutate the track, question, or caller state', () => {
  const t = track();
  const state = createState(t);
  const snapshot = JSON.stringify({ t, state });
  const item = chooseNext(t, state);
  recordOutcome(t, state, item.id, 'independent');
  adjustLevel(t, state, -1);
  describeState(t, state);
  assert.equal(JSON.stringify({ t, state }), snapshot);
});

test('storage sanitizes corrupt values, unknown IDs, stale versions, and all content fields', () => {
  const t = track();
  const initial = createState(t);
  for (const corrupt of ['{invalid-json', null, [], { version: 99, trackId: t.id }, { version: 1, trackId: 'another-skill' }]) {
    assert.deepEqual(createState(t, corrupt), initial);
  }
  let state = complete(t, initial, 'independent').state;
  state = complete(t, state, 'supported').state;
  const clean = createState(t, JSON.stringify(state));
  assert.deepEqual(clean, state);
  const stored = { ...state, level: 900, phase: 'mastered', reason: 'SECRET-ANSWER', prompt: 'Protected material',
    evidence: { ...state.evidence, unknown: [999, 0, 0, 0, 999, 1, 0] },
    independentRun: ['unknown', ...state.independentRun], familiar: ['unknown', null, ...state.familiar, ...state.familiar],
    history: [...state.history, ['unknown', 1, 999, 99, 1]] };
  const sanitized = createState(t, stored);
  assert.equal(sanitized.level, initial.level);
  assert.equal(sanitized.phase, 0);
  assert.equal(sanitized.reason, 0);
  assert.equal(sanitized.trial, state.trial);
  assert.ok(!Object.hasOwn(sanitized.evidence, 'unknown'));
  assert.deepEqual(sanitized.familiar, state.familiar);
  assert.ok(!JSON.stringify(sanitized).includes('SECRET-ANSWER'));
  assert.ok(!JSON.stringify(sanitized).includes('Protected material'));
  assert.deepEqual(createState(t, { ...state, evidence: { [t.items[0].id]: [NaN, Infinity, -1, '20'] } }).evidence, {});
});

test('large simulations stay bounded, preserve outcome counts, and keep one JSON-safe state per skill', () => {
  for (let seed = 0; seed < 12; seed++) {
    const t = track(`simulation-${seed}`, 5, 12);
    let state = createState(t);
    const counts = { independent: 0, supported: 0, unmet: 0 };
    let passed = 0;
    let previous;
    for (let i = 0; i < 400; i++) {
      const outcome = ['independent', 'supported', 'unmet', 'pass'][(i * 7 + seed * 3 + Math.floor(i / 5)) % 4];
      const item = chooseNext(t, state);
      assert.notEqual(item.id, previous);
      state = recordOutcome(t, state, item.id, outcome);
      if (outcome === 'pass') passed++; else counts[outcome]++;
      state = createState(t, JSON.stringify(state));
      assert.ok(state.level >= 1 && state.level <= 5);
      previous = item.id;
    }
    assert.deepEqual(describeState(t, state).counts, counts);
    assert.equal(describeState(t, state).passed, passed);
    assert.equal(state.trial, 400);
    assert.ok(state.history.length <= 64);
  }
});

test('track construction uses source ordinals and exact sequence span, never wording length', () => {
  const qs = [];
  for (const category of ['similarities', 'spoken_similarities', 'vocabulary']) {
    for (let i = 1; i <= 25; i++) qs.push({
      id: `q-${category}-${i}`, category, type: 'open', sourceQuestion: i,
      order: category === 'spoken_similarities' ? i + 85 : i,
      prompt: i % 2 ? 'x'.repeat(1000) : 'x',
    });
  }
  for (let span = 2; span <= 7; span++) qs.push({
    id: `span-${span}`, category: 'sequencing', type: 'sequence', sequence: Array(span).fill('X'), order: span,
  });
  qs.push({ id: 'no-anchor', category: 'memory', type: 'recall', words: ['a', 'b'] });
  const tracks = buildTracks(qs.reverse());
  assert.equal(tracks.length, 4);
  for (const t of tracks.filter((x) => x.category !== 'sequencing')) {
    assert.deepEqual(t.items.map((item) => item.sourceOrdinal), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.equal(t.items[0].level, 1);
    assert.equal(t.items.at(-1).level, 5);
    assert.equal(createState(t).level, 4);
  }
  const sequences = tracks.find((t) => t.category === 'sequencing');
  assert.equal(sequences.maxLevel, 6);
  assert.equal(chooseNext(sequences, createState(sequences)).question.sequence.length, 4);
  assert.equal(tracks.find((t) => t.category === 'vocabulary').basis, 'provisional-order');
});

test('authored verbal tiers include only reviewed opaque IDs, while excluded material stays out', () => {
  const ids = Object.keys(verbalLevels);
  assert.ok(ids.length > 50);
  const qs = ids.map((id, i) => ({ id, category: i % 2 ? 'analogies' : 'classification', type: 'choice', order: 100 - i }));
  for (const id of Object.keys(verbalExcluded)) qs.push({ id, category: 'analogies', type: 'choice' });
  const tracks = buildTracks(qs);
  assert.equal(tracks.length, 2);
  assert.equal(tracks.reduce((sum, t) => sum + t.items.length, 0), ids.length);
  for (const t of tracks) for (const item of t.items) assert.equal(item.level, verbalLevels[item.id]);
  assert.deepEqual(buildTracks(null), []);
});
