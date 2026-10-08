import assert from 'node:assert/strict';
import test from 'node:test';
import { NUMBER_TYPES, generateNumberRound, validateNumberRound } from '../app/lab/think-academy/number-generators.ts';

const length = p => p.points.slice(1).reduce((sum, point, i) => sum + Math.abs(point[0] - p.points[i][0]) + Math.abs(point[1] - p.points[i][1]), 0);
function independentAnswer(round) {
  const m = round.model;
  switch (m.kind) {
    case 'arithmetic': {
      if (m.missing === 'a') return String(m.total - m.op * m.b - m.op2 * m.c);
      if (m.missing === 'b') return String((m.total - m.a - m.op2 * m.c) * m.op);
      return String(m.a + m.op * m.b + m.op2 * m.c);
    }
    case 'length': {
      const values = m.paths.map(length);
      if (m.query === 'longest') return `path:${values.indexOf(Math.max(...values))}`;
      return String((m.query === 'difference' ? Math.abs(values[0] - values[1]) : values[0] - values[1]) * m.unit);
    }
    case 'place-value': return m.query === 'decompose' ? `${Math.floor(m.n / 10)} tens + ${m.n % 10} ones` : String(m.query === 'number' ? m.hundreds * 100 + m.tens * 10 + m.ones : m.query === 'tens' ? (m.n - m.hundreds * 100 - m.ones) / 10 : m.n - m.tens * 10);
    case 'fractions': {
      const answers = m.panels.filter(p => p.weights.reduce((sum, w, i) => sum + w * Number(p.shaded[i]), 0) / p.weights.reduce((a, b) => a + b, 0) === m.target[0] / m.target[1]);
      assert.equal(answers.length, 1); return answers[0].id;
    }
    case 'multiplication': return String(m.query === 'factor' || m.query === 'inverse' ? (m.total - m.extras) / m.a : m.a * m.b + (m.query === 'combine' ? m.a * m.c : 0));
    case 'fruit-equations': {
      let a, b, c;
      if (round.level < 2) {
        const ratio = m.equations[0].left[0].count;
        a = m.equations.at(-1).total / (ratio + (round.level === 0 ? 1 : 2)); b = ratio * a; c = a + b;
      } else { a = (m.equations[0].total + m.equations[2].total - m.equations[1].total) / 2; b = m.equations[0].total - a; c = m.equations[2].total - a; }
      const values = [a, b, c];
      for (const e of m.equations) assert.equal(e.left.reduce((s, t) => s + t.count * values[t.shape], 0), e.right.reduce((s, t) => s + t.count * values[t.shape], e.total));
      return String(m.target.reduce((s, t) => s + t.count * values[t.shape], 0));
    }
    case 'sharing': return String(m.query === 'remainder' ? (m.total - m.reserve) % m.people : Math.trunc((m.total - m.reserve) / m.people) + (m.query === 'combined' ? Math.trunc(m.second / m.people) : 0));
    case 'tree-gaps': {
      const gap2 = m.hiddenSecond ? (m.totalDistance - m.split * m.firstGap) / (m.count - 1 - m.split) : m.secondGap;
      let total = 0; for (let tree = m.from; tree < m.to; tree++) total += tree <= m.split ? m.firstGap : gap2;
      return String(total);
    }
    case 'queue': return String(m.query === 'ranks' ? m.front + m.back - 1 : m.query === 'new-rank' ? m.front - m.leave + m.join + 1 : m.query === 'two-people' ? m.front + m.between + m.back : m.front + m.back + 1);
    case 'balance': {
      // An independent top-down mass calculation: every equal-armed pair
      // splits equally; center loads contribute to the enclosing total.
      const left = m.mobile.left, right = m.mobile.right;
      const circles = left.right.count, centerCircles = left.center?.count ?? 0;
      const circle = m.known.shape === 'whole' ? m.known.value / (2 * (2 * circles + centerCircles)) : m.known.value;
      const branchWeight = (2 * circles + centerCircles) * circle;
      const star = branchWeight / (2 + (right.center?.count ?? 0));
      const heart = 'shape' in right.right ? star / right.right.count : star / (right.right.left.count + right.right.right.count);
      const weights = [circle, circles * circle, star, heart];
      const sum = node => {
        if ('shape' in node) return node.count * weights[node.shape];
        assert.equal(sum(node.left), sum(node.right));
        return sum(node.left) + sum(node.right) + (node.center ? sum(node.center) : 0);
      };
      const whole = sum(m.mobile);
      if (m.known.shape === 'whole') assert.equal(whole, m.known.value);
      return String(heart);
    }
    default: throw new Error(m.kind);
  }
}

for (const type of NUMBER_TYPES) for (let level = 0; level < 4; level++) {
  test(`${type.id}: 400 deterministic level ${level} rounds have one verified answer`, () => {
    const fingerprints = new Set(), positions = new Set();
    for (let seed = 0; seed < 400; seed++) {
      const round = generateNumberRound(type.id, level, seed);
      assert.deepEqual(round, generateNumberRound(type.id, level, seed));
      assert.equal(validateNumberRound(round), true);
      assert.equal(round.correctId, independentAnswer(round));
      assert.equal(new Set(round.choices.map(c => c.id)).size, 4);
      assert.ok(round.choices.every(c => c.feedback.length > 0));
      assert.ok(round.hint.length > 0 && round.explanation.length > 0);
      assert.equal(validateNumberRound({ ...round, choices: [...round.choices].reverse() }), true, 'order does not affect answer or fingerprint');
      assert.equal(validateNumberRound({ ...round, correctId: round.choices.find(c => c.id !== round.correctId).id }), false);
      assert.equal(validateNumberRound({ ...round, choices: [round.choices[0], ...round.choices.slice(0, 3)] }), false);
      fingerprints.add(round.fingerprint); positions.add(round.choices.findIndex(c => c.id === round.correctId));
    }
    assert.ok(fingerprints.size >= 24, `${fingerprints.size} substantive puzzles must support repeated 12-round practice`);
    assert.equal(positions.size, 4);
  });
}

test('arithmetic baseline covers add/subtract with and without regrouping', () => {
  const families = new Set();
  for (let seed = 0; seed < 400; seed++) {
    const m = generateNumberRound('arithmetic', 0, seed).model;
    families.add(m.family);
    assert.equal(m.c, 0); assert.equal(m.missing, 'result');
    assert.ok(m.a >= 10 && m.a <= 99 && m.b >= 10 && m.b <= 99);
    if (m.family === 0) assert.ok(m.a % 10 + m.b % 10 < 10);
    if (m.family === 1) assert.ok(m.a % 10 + m.b % 10 >= 10);
    if (m.family === 2) assert.ok(m.a % 10 >= m.b % 10);
    if (m.family === 3) assert.ok(m.a % 10 < m.b % 10);
  }
  assert.equal(families.size, 4);
});

test('challenge ladders change reasoning rather than only numerical size', () => {
  for (let seed = 0; seed < 100; seed++) {
    const models = id => [0, 1, 2, 3].map(l => generateNumberRound(id, l, seed).model);
    const arithmetic = models('arithmetic');
    assert.deepEqual(arithmetic.map(m => m.missing), ['result', 'b', 'result', 'a']);
    assert.ok(arithmetic[2].c > 0 && arithmetic[3].c > 0);
    assert.deepEqual(models('place-value').map(m => m.query), ['decompose', 'ones', 'tens', 'number']);
    assert.deepEqual(models('multiplication').map(m => m.query), ['product', 'factor', 'combine', 'inverse']);
    assert.deepEqual(models('sharing').map(m => m.query), ['each', 'each', 'remainder', 'combined']);
    assert.ok(models('sharing')[1].reserve > 0 && models('sharing')[3].second > 0);
    assert.deepEqual(models('queue').map(m => m.query), ['total', 'ranks', 'new-rank', 'two-people']);
    const lengths = models('length');
    assert.deepEqual(lengths.map(m => m.query), ['longest', 'difference', 'longest', 'missing']);
    assert.ok(lengths[0].paths.some(p => p.points[0][0] === p.points[1][0]));
    assert.ok(lengths[2].paths.every(p => p.points.length === 4));
    assert.equal(lengths[3].paths[1].points.length, 2, 'hidden segment is inferred, not recorded as an answer');
    const fractions = models('fractions');
    assert.deepEqual(fractions[0].target, [1, 2]);
    assert.equal(fractions[1].target[0], 1);
    assert.ok(fractions[2].target[0] > 1);
    assert.ok(fractions[3].panels.every(p => new Set(p.weights).size > 1));
    const fruit = models('fruit-equations');
    assert.deepEqual(fruit.map(m => m.equations.length), [2, 3, 3, 3]);
    assert.ok(fruit[3].target.some(t => t.count < 0));
    const trees = models('tree-gaps');
    assert.ok(trees[1].from > 1 && trees[2].firstGap !== trees[2].secondGap);
    assert.ok(trees[3].hiddenSecond && trees[3].from > trees[3].split + 1);
    const balance = models('balance');
    assert.ok(!balance[0].mobile.left.center && balance[1].mobile.left.center);
    assert.ok(!('shape' in balance[2].mobile.right.right));
    assert.equal(balance[3].known.shape, 'whole');
  }
});

test('simple fraction choices differ in at least two occupied positions', () => {
  for (const level of [0, 1]) for (let seed = 0; seed < 400; seed++) {
    const { panels } = generateNumberRound('fractions', level, seed).model;
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) assert.ok(panels[i].shaded.filter((v, k) => v !== panels[j].shaded[k]).length >= 2);
  }
});

test('hostile seeds and malformed rounds fail safely; uint32 aliases remain deterministic', () => {
  for (const seed of [NaN, Infinity, -Infinity, 1.5, undefined]) assert.throws(() => generateNumberRound('arithmetic', 0, seed));
  for (const level of [-1, 4, NaN]) assert.throws(() => generateNumberRound('arithmetic', level, 1));
  assert.throws(() => generateNumberRound('triangles', 0, 1));
  for (const bad of [null, {}, { type: 'arithmetic', model: null }, { choices: [] }]) assert.equal(validateNumberRound(bad), false);
  for (const type of NUMBER_TYPES) for (const level of [0, 1, 2, 3]) for (const seed of [-2147483648, -1, 2147483647, 4294967295]) assert.equal(validateNumberRound(generateNumberRound(type.id, level, seed)), true);
  const round = generateNumberRound('arithmetic', 0, 1);
  assert.equal(validateNumberRound({ ...round, model: { ...round.model, a: NaN } }), false);
  assert.equal(generateNumberRound('arithmetic', 0, -1).fingerprint, generateNumberRound('arithmetic', 0, 4294967295).fingerprint);
});

test('fraction fingerprints ignore panel order and validators reject visual answer tampering', () => {
  const round = generateNumberRound('fractions', 1, 2);
  assert.equal(validateNumberRound({ ...round, model: { ...round.model, panels: [...round.model.panels].reverse() } }), true);
  const choices = structuredClone(round.choices); choices[0].diagram.marks[0].fill = '#000';
  assert.equal(validateNumberRound({ ...round, choices }), false);
});


test('Expert bent paths remain inside the complete measurement grid', () => {
  for (let seed = 0; seed < 400; seed++) {
    const round = generateNumberRound('length', 2, seed);
    for (const path of round.model.paths) for (const [x, y] of path.points) {
      assert.ok(x >= 0 && x <= 14, `seed ${seed}: x=${x} outside grid`);
      assert.ok(y >= 0 && y <= 12, `seed ${seed}: y=${y} outside grid`);
    }
  }
});


test('fingerprints ignore inactive and derived model fields, never seed or option order', () => {
  const cases = [
    ['arithmetic', 0, m => ({ ...m, op2: -m.op2, total: m.total + 1, family: 123 })],
    ['arithmetic', 1, m => ({ ...m, b: m.b + 1, family: 123 })],
    ['arithmetic', 3, m => ({ ...m, a: m.a + 1, family: 123 })],
    ['queue', 2, m => ({ ...m, back: m.back + 17, between: 4 })],
    ['queue', 0, m => ({ ...m, leave: 3, join: 5, between: 2 })],
    ['place-value', 0, m => ({ ...m, hundreds: 8, tens: 12, ones: 13 })],
    ['place-value', 1, m => ({ ...m, ones: m.ones + 1 })],
    ['place-value', 2, m => ({ ...m, tens: m.tens + 1 })],
    ['place-value', 3, m => ({ ...m, n: m.n + 1 })],
    ['multiplication', 0, m => ({ ...m, c: 8, extras: 3, total: 999 })],
    ['multiplication', 1, m => ({ ...m, b: m.b + 1, c: 8, extras: 5 })],
    ['sharing', 0, m => ({ ...m, second: 99 })],
    ['tree-gaps', 0, m => ({ ...m, secondGap: 27, totalDistance: 999 })],
    ['tree-gaps', 3, m => ({ ...m, secondGap: m.secondGap + 1 })],
    ['length', 1, m => ({ ...m, paths: [...m.paths.slice(0, 2), { points: [[0, 0], [3, 0]] }, { points: [[0, 0], [5, 0]] }] })],
  ];
  for (const [type, level, change] of cases) {
    const round = generateNumberRound(type, level, 19);
    assert.equal(validateNumberRound({ ...round, model: change(round.model) }), true, `${type} level ${level} changed an inactive field`);
    assert.equal(validateNumberRound({ ...round, seed: 999, choices: [...round.choices].reverse() }), true);
  }
});
