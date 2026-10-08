import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPATIAL_TYPES, countTurns, enumerateTriangles, foldNet, generateSpatialRound,
  polyominoes, projectStack, solvePartition, spatialFingerprint, validateSpatialRound,
} from '../app/lab/think-academy/spatial-generators.ts';

const TYPES = SPATIAL_TYPES.map(t => t.id);
const cellsKey = cells => cells.map(p => p.join(',')).sort().join(';');
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const negative = a => a.map(n => -n);
const sameVector = (a, b) => a.every((n, i) => n === b[i]);
const sourceNet = [
  { x: 0, y: 1, label: 1 }, { x: 1, y: 1, label: 2 }, { x: 2, y: 1, label: 3 },
  { x: 3, y: 1, label: 4 }, { x: 2, y: 0, label: 5 }, { x: 2, y: 2, label: 6 },
];
const sourceTriangles = [
  [[0, 0], [6, 0]], [[6, 0], [6, 4]], [[6, 4], [0, 4]], [[0, 4], [0, 0]],
  [[0, 4], [3, 0]], [[3, 0], [6, 4]], [[3, 0], [3, 4]],
];

// This corpus exercises 8,000 rounds, not just the authored source fixtures.
const corpus = new Map();
for (const type of TYPES) for (let level = 0; level < 4; level++) {
  corpus.set(`${type}:${level}`, Array.from({ length: 400 }, (_, seed) => generateSpatialRound(type, level, seed)));
}

test('all spatial source families expose the recorded level and three explicit challenges', () => {
  assert.deepEqual(TYPES, ['triangles', 'cube-net', 'turns', 'solid-views', 'partition']);
  assert.deepEqual(SPATIAL_TYPES.map(t => t.sourceNumber), [7, 11, 12, 13, 14]);
  assert.ok(SPATIAL_TYPES.every(t => t.challenges.length === 4 && new Set(t.challenges).size === 4));
});

for (const type of TYPES) for (let level = 0; level < 4; level++) {
  test(`${type}, challenge ${level}: 400 valid, distinct-choice, deterministic rounds with a practice-sized pool`, () => {
    const rounds = corpus.get(`${type}:${level}`);
    assert.ok(new Set(rounds.map(r => r.fingerprint)).size >= 200, 'substantive pool supports repeat-free twelve-round sessions');
    const positions = new Set();
    for (const round of rounds) {
      assert.equal(validateSpatialRound(round), true, `seed ${round.seed}`);
      assert.equal(new Set(round.choices.map(c => c.id)).size, 4);
      assert.ok(round.choices.every(c => c.feedback.length > 15));
      positions.add(round.choices.findIndex(c => c.id === round.correctId));
      const reversed = { ...round, choices: [...round.choices].reverse() };
      assert.equal(spatialFingerprint(reversed), round.fingerprint);
      assert.equal(validateSpatialRound(reversed), true);
      assert.equal(validateSpatialRound({ ...round, correctId: round.choices.find(c => c.id !== round.correctId).id }), false);
      if (round.seed < 6) assert.deepEqual(generateSpatialRound(type, level, round.seed), round);
    }
    assert.equal(positions.size, 4, 'answers use every choice position');
  });
}

test('triangle enumeration reproduces five in source, eight in crossed rectangle, and joined straight sides', () => {
  assert.equal(enumerateTriangles(sourceTriangles).length, 5);
  assert.equal(enumerateTriangles(sourceTriangles, [[3, 0], [3, 4]]).length, 2);
  assert.equal(enumerateTriangles([...sourceTriangles.slice(0, 4), [[0, 0], [6, 4]], [[0, 4], [6, 0]]]).length, 8);
  assert.equal(enumerateTriangles([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [0, 2]], [[0, 2], [0, 0]]]).length, 1);
  assert.equal(enumerateTriangles([[[0, 0], [1, 0]], [[1.1, 0], [2, 0]], [[2, 0], [0, 2]], [[0, 2], [0, 0]]]).length, 0, 'a gap never closes a triangle');
});

test('triangle challenges add intersections then a marked-side condition without increasing final-level density', () => {
  for (let level = 0; level < 4; level++) for (const round of corpus.get(`triangles:${level}`)) {
    const { segments, requiredSide } = round.model;
    const n = enumerateTriangles(segments, requiredSide).length;
    assert.equal(round.correctId, `n-${n}`);
    assert.ok(round.choices.some(c => Number(c.label) === n + 1));
    assert.ok(segments.length >= 7 && segments.length <= 9);
    if (level === 0) assert.ok(n >= 4 && n <= 8);
    if (level === 1) assert.ok(n >= 7 && n <= 13);
    if (level >= 2) assert.equal(segments.length, 9);
    assert.equal(requiredSide !== null, level === 3);
  }
});

test('cube fold propagation finds exactly eleven free nets and rejects overlap/disconnected layouts', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => polyominoes(n).length), [1, 1, 2, 5, 12, 35]);
  assert.equal(polyominoes(6).filter(s => foldNet(s.map(([x, y], i) => ({ x, y, label: i + 1 })))).length, 11);
  assert.equal(foldNet(Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), label: i }))), null);
  assert.equal(foldNet(Array.from({ length: 6 }, (_, i) => ({ x: i * 2, y: 0, label: i }))), null);
  const frames = foldNet(sourceNet);
  for (const [a, b] of [[1, 3], [2, 4], [5, 6]]) assert.ok(sameVector(frames.get(a).n, negative(frames.get(b).n)));
  assert.ok(sameVector(cross(frames.get(3).n, frames.get(6).n), frames.get(4).n), 'printed net: 3 top, 6 front puts 4 on the right');
});

test('cube answers follow actual folded normals and the two ordered rolls', () => {
  for (let level = 0; level < 4; level++) for (const round of corpus.get(`cube-net:${level}`)) {
    const m = round.model, frames = foldNet(m.faces), top = frames.get(m.top).n;
    const face = n => [...frames].find(([, f]) => sameVector(f.n, n))[0];
    let expected;
    if (level < 2) expected = [face(negative(top))];
    else {
      const front = frames.get(m.front).n, right = cross(top, front);
      expected = level === 2 ? [face(right)] : [face(negative(front)), face(negative(right))];
    }
    assert.deepEqual(m.options.find(o => o.id === round.correctId).faces, expected);
  }
});

test('route turns use the traveller direction and reproduce all four source counts', () => {
  const sourceRoutes = [
    [[0, 1], [2, 1], [2, 0], [3, 0], [3, 1], [6, 1], [6, 0], [7, 0], [7, 1], [9, 1]],
    [[0, 1], [11, 1]],
    [[0, 1], [4, 1], [4, 0], [5, 0], [5, 1], [6, 1], [6, 2], [7, 2], [7, 1], [8, 1]],
    [[0, 1], [2, 1], [2, 0], [5, 0], [5, 2], [8, 2], [8, 1], [9, 1]],
  ];
  assert.deepEqual(sourceRoutes.map(p => countTurns(p).left), [4, 0, 4, 3]);
  assert.deepEqual(countTurns([[0, 0], [0, 1], [1, 1], [1, 0]]), { left: 2, right: 0 });
  for (let level = 0; level < 4; level++) for (const round of corpus.get(`turns:${level}`)) {
    const m = round.model;
    assert.equal(m.relation, level === 3);
    assert.equal(m.right === null, level < 2);
    const matches = m.routes.filter(r => { const t = countTurns(r.points); return t.left === m.left && (m.right === null || t.right === m.right); });
    assert.deepEqual(matches.map(r => r.id), [round.correctId]);
    if (level === 0) assert.equal(m.left, 3);
    for (const r of m.routes) assert.ok(r.points.length >= 4 && r.points.length <= 12);
  }
});

test('source solid models share exactly the true left view; flat projection orientation is fixed', () => {
  const stacks = [[[1, 0], [2, 0], [4, 2]], [[1, 0, 0, 0], [2, 0, 0, 0], [4, 2, 1, 1]], [[1, 0, 0], [2, 2, 0], [4, 2, 1]]];
  assert.equal(new Set(stacks.map(s => cellsKey(projectStack(s, 'left')))).size, 1);
  for (const view of ['top', 'front']) assert.equal(new Set(stacks.map(s => cellsKey(projectStack(s, view)))).size, 3);
  const left = projectStack(stacks[0], 'left');
  assert.deepEqual([0, 1, 2].map(x => left.filter(p => p[0] === x).length), [4, 2, 1], 'left view reads back to front');
});

test('common-view generation covers every viewing direction', () => {
  for (const level of [0, 1]) assert.deepEqual([...new Set(corpus.get(`solid-views:${level}`).map(r => r.correctId))].sort(), ['front', 'left', 'top']);
});

test('hard solid evidence is insufficient individually but jointly selects one solid', () => {
  for (const level of [2, 3]) for (const round of corpus.get(`solid-views:${level}`)) {
    const m = round.model, matches = m.options.map(o => m.views.map((v, i) => cellsKey(projectStack(o.stack, v)) === cellsKey(m.targets[i])));
    for (const i of [0, 1]) assert.ok(matches.filter(match => match[i]).length >= 2);
    assert.equal(matches.filter(match => match.every(Boolean)).length, 1);
    for (const { stack } of m.options) {
      assert.equal(stack.length, 3); assert.equal(stack[0].length, 3);
      assert.ok(stack.flat().every(h => h >= 0 && h <= 3));
      assert.ok(stack.every((row, y) => y === 0 || row.every((h, x) => h >= stack[y - 1][x])), 'back columns remain visible above front columns');
    }
  }
});

test('exact cover reproduces source partition, enforces both marks, and includes missing bbox corners', () => {
  const board = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if ([2, 3].includes(x) || [2, 3].includes(y)) board.push([x, y]);
  const stars = [[3, 0], [2, 2], [4, 2], [2, 3]], p = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]];
  assert.equal(solvePartition(board, [[0, 0], [1, 0], [0, 1], [1, 1]], stars).length, 0);
  assert.equal(solvePartition(board, [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]], stars).length, 0);
  const solutions = solvePartition(board, p, stars);
  assert.ok(solutions.length > 0);
  assert.equal(solutions[0].length, 4);
  assert.equal(new Set(solutions[0].flat().map(p => p.join(','))).size, 20);
  assert.ok(solutions[0].every(piece => stars.filter(s => piece.some(c => cellsKey([c]) === cellsKey([s]))).length === 1));
  const concave = [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];
  assert.equal(solvePartition(concave, concave, [[1, 0]]).length, 1, 'bbox origin can lie outside the board');
  assert.equal(solvePartition(board, p, [...stars, stars[0]]).length, 0, 'duplicate or wrong-count stars fail');
  assert.equal(solvePartition(board, p, stars, [[99, 99], ...stars.slice(1)]).length, 0, 'outside markers fail');
});

test('partition distractors preserve area and exact-cover choices have exactly one valid shape', () => {
  for (let level = 0; level < 4; level++) for (const round of corpus.get(`partition:${level}`)) {
    const m = round.model;
    assert.equal(m.board.length, level < 2 ? 20 : 24);
    assert.equal(m.stars.length, 4);
    assert.equal(m.circles.length, level === 3 ? 4 : 0);
    assert.ok(m.options.every(o => o.cells.length === m.board.length / 4));
    assert.deepEqual(m.options.filter(o => solvePartition(m.board, o.cells, m.stars, m.circles).length).map(o => o.id), [round.correctId]);
  }
});

test('geometry, answer, fingerprint and hostile input corruption fail safely', () => {
  for (const type of TYPES) {
    const round = generateSpatialRound(type, 2, 999999);
    assert.equal(validateSpatialRound({ ...round, model: null }), false);
    assert.equal(validateSpatialRound({ ...round, fingerprint: 'wrong' }), false);
    assert.equal(validateSpatialRound({ ...round, choices: [round.choices[0], ...round.choices.slice(0, 3)] }), false);
    for (const seed of [0, -1, 2147483647, 4294967295, Number.MAX_SAFE_INTEGER]) assert.equal(validateSpatialRound(generateSpatialRound(type, 2, seed)), true);
    for (const seed of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => generateSpatialRound(type, 1, seed), /integer seed/);
  }
  assert.throws(() => generateSpatialRound('balance', 0, 1), /Unsupported/);
  assert.throws(() => generateSpatialRound('triangles', 4, 1), /valid challenge level/);
  assert.deepEqual(solvePartition([], [[0, 0]]), []);
});
