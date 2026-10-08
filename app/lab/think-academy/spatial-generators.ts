import type { ChallengeLevel, Choice, Diagram, Mark, Point, ProblemType, Round, TypeInfo } from './types.ts';

/** All geometry is in the model. SVG marks are a view of it, never the answer key. */
export const SPATIAL_TYPES: TypeInfo[] = [
  { id: 'triangles', title: 'Hidden triangles', sourceNumber: 7, description: 'Find triangles of every size in a line drawing.', challenges: ['Count nested triangles', 'Include crossing lines', 'Track overlapping triangles', 'Count only triangles with the marked side'] },
  { id: 'cube-net', title: 'Fold a cube', sourceNumber: 11, description: 'Imagine which faces meet when a paper net folds.', challenges: ['Find an opposite face', 'Explore different cube nets', 'Find the right-hand face', 'Track two rolls after folding'] },
  { id: 'turns', title: 'Left and right', sourceNumber: 12, description: 'Follow a route and count turns from the traveller’s viewpoint.', challenges: ['Find three left turns', 'Start in different directions', 'Match both left and right turns', 'Infer turns from a total and a difference'] },
  { id: 'solid-views', title: 'Views of stacks', sourceNumber: 13, description: 'Connect solid cube stacks with their flat views.', challenges: ['Find the common view', 'Compare taller, varied stacks', 'Match a top and a front view', 'Infer a solid from front and left views'] },
  { id: 'partition', title: 'Matching pieces', sourceNumber: 14, description: 'Split a board into identical pieces with a star in each.', challenges: ['Four pieces in a cross', 'Four pieces in a rectangle', 'Use six-square pieces', 'Place a star and a circle in every piece'] },
];

const INK = '#17213d';
const TEAL = '#35a999';
const GOLD = '#f3bd4e';
const PAPER = '#fffdf8';
type Random = () => number;
const rng = (seed: number): Random => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const integer = (random: Random, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
const pick = <T,>(random: Random, values: readonly T[]): T => values[integer(random, 0, values.length - 1)];
function shuffle<T>(random: Random, values: readonly T[]): T[] { const out = [...values]; for (let i = out.length - 1; i > 0; i--) { const j = integer(random, 0, i); [out[i], out[j]] = [out[j], out[i]]; } return out; }
const pkey = ([x, y]: Point) => `${x},${y}`;
const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8;
const sortCells = (cells: Point[]): Point[] => cells.map(([x, y]): Point => [x, y]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const cellKey = (cells: Point[]) => sortCells(cells).map(pkey).join(';');
const normalCells = (cells: Point[]): Point[] => { const x = Math.min(...cells.map(p => p[0])), y = Math.min(...cells.map(p => p[1])); return sortCells(cells.map(p => [p[0] - x, p[1] - y])); };
const line = (points: Point[], color = INK, width = 2.5): Mark => ({ kind: 'line', points, color, width });
const text = (x: number, y: number, value: string, size = 17): Mark => ({ kind: 'text', x, y, text: value, size, color: INK });
const numericChoices = (answer: number, random: Random): Choice[] => shuffle(random, [answer, answer - 1, answer + 1, answer + 2]).map(n => ({ id: `n-${n}`, label: String(n), feedback: n === answer ? `There are ${answer} triangles altogether.` : `That is ${Math.abs(n - answer)} too ${n < answer ? 'few' : 'many'}. ${n < answer ? 'Include triangles made from several smaller regions' : 'Check that every side is straight and no triangle is counted twice'}.` }));

export type Segment = [Point, Point];
type Triangle = [Point, Point, Point];
interface TriangleModel { kind: 'triangles'; segments: Segment[]; requiredSide: Segment | null }
const cross2 = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
function intersection(a: Segment, b: Segment): Point | null {
  const r = sub(a[1], a[0]), s = sub(b[1], b[0]), d = cross2(r, s);
  if (Math.abs(d) < 1e-8) return null;
  const q = sub(b[0], a[0]), t = cross2(q, s) / d, u = cross2(q, r) / d;
  return t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8 ? [a[0][0] + t * r[0], a[0][1] + t * r[1]] : null;
}
function drawnSide(a: Point, b: Point, segments: Segment[]): boolean {
  const d = sub(b, a), size = d[0] * d[0] + d[1] * d[1];
  if (size < 1e-8) return false;
  const project = (p: Point) => ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / size;
  const spans = segments.filter(s => s.every(p => Math.abs(cross2(sub(p, a), d)) < 1e-8)).map(s => [Math.min(...s.map(project)), Math.max(...s.map(project))]).sort((x, y) => x[0] - y[0]);
  let end = 0;
  for (const [lo, hi] of spans) { if (lo > end + 1e-8) break; if (hi > end) end = hi; if (end >= 1 - 1e-8) return true; }
  return false;
}
/** Enumerates intersection vertices and proves all three sides are fully drawn, including joined collinear segments. */
export function enumerateTriangles(segments: Segment[], requiredSide: Segment | null = null): Triangle[] {
  const vertices: Point[] = [];
  const add = (p: Point) => { if (!vertices.some(v => same(v, p))) vertices.push(p); };
  for (const s of segments) s.forEach(add);
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) { const p = intersection(segments[i], segments[j]); if (p) add(p); }
  const triangles: Triangle[] = [];
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) for (let k = j + 1; k < vertices.length; k++) {
    const a = vertices[i], b = vertices[j], c = vertices[k];
    if (Math.abs(cross2(sub(b, a), sub(c, a))) < 1e-8) continue;
    const sides: Segment[] = [[a, b], [b, c], [c, a]];
    if (!sides.every(([p, q]) => drawnSide(p, q, segments))) continue;
    if (requiredSide && !sides.some(s => drawnSide(requiredSide[0], requiredSide[1], [s]))) continue;
    triangles.push([a, b, c]);
  }
  return triangles;
}
const BOUNDARY: Segment[] = [[[0, 0], [6, 0]], [[6, 0], [6, 4]], [[6, 4], [0, 4]], [[0, 4], [0, 0]]];
const INTERIOR: Segment[] = [
  [[0, 4], [3, 0]], [[3, 0], [6, 4]], [[3, 0], [3, 4]], [[0, 0], [6, 4]], [[0, 4], [6, 0]],
  [[0, 2], [6, 2]], [[0, 0], [3, 4]], [[3, 4], [6, 0]], [[0, 0], [6, 2]], [[0, 2], [6, 4]],
  [[0, 4], [6, 2]], [[0, 2], [6, 0]], [[0, 0], [3, 2]], [[3, 2], [6, 0]],
];
function triangleDiagram(model: TriangleModel): Diagram {
  const map = ([x, y]: Point): Point => [24 + x * 40, 20 + y * 40];
  const marks = model.segments.map(s => line(s.map(map), INK, 2.7));
  if (model.requiredSide) marks.push(line(model.requiredSide.map(map), '#b57913', 6));
  return { width: 288, height: 200, description: 'A rectangle divided by straight lines. Count only shapes with three straight sides.', marks };
}
function triangleRound(level: ChallengeLevel, seed: number, random: Random): Round {
  for (let attempt = 0; attempt < 180; attempt++) {
    const count = level === 0 ? integer(random, 3, 4) : level === 1 ? 4 : 5;
    const interior = shuffle(random, INTERIOR).slice(0, count);
    const model: TriangleModel = { kind: 'triangles', segments: [...BOUNDARY, ...interior], requiredSide: level === 3 ? pick(random, interior) : null };
    const n = enumerateTriangles(model.segments, model.requiredSide).length;
    const range = level === 0 ? [4, 8] : level === 1 ? [7, 13] : level === 2 ? [10, 22] : [3, 12];
    if (n < range[0] || n > range[1]) continue;
    return finish({ type: 'triangles', level, seed, model, prompt: level === 3 ? 'How many triangles have a side containing the entire gold segment?' : 'How many triangles are in this figure? Count every size.', diagram: triangleDiagram(model), choices: numericChoices(n, random), correctId: `n-${n}`, explanation: `${n} triangles have three completely drawn straight sides${model.requiredSide ? ' and include the entire gold segment on one side' : '. Count small triangles, then ones made from several smaller regions'}.`, hint: level === 3 ? 'A longer straight side may include the gold segment. The whole segment must lie on that side.' : 'A triangle can contain other lines. Check larger triangles as well as the smallest ones.' });
  }
  throw new Error('Triangle generator exhausted its validated candidates.');
}

type Vec = [number, number, number];
interface Frame { u: Vec; v: Vec; n: Vec }
export interface NetFace { x: number; y: number; label: number }
interface CubeModel { kind: 'cube-net'; faces: NetFace[]; query: 'opposite' | 'right' | 'roll'; top: number; front: number | null; options: { id: string; faces: number[] }[] }
const neg = (a: Vec): Vec => [-a[0], -a[1], -a[2]];
const vecKey = (a: Vec) => a.join(',');
const cross3 = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Propagate orthonormal frames through actual 90° edge folds; reject cycles and coincident faces. */
export function foldNet(faces: NetFace[]): Map<number, Frame> | null {
  if (faces.length !== 6 || new Set(faces.map(f => `${f.x},${f.y}`)).size !== 6 || new Set(faces.map(f => f.label)).size !== 6) return null;
  const frames = new Map<number, Frame>([[faces[0].label, { u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1] }]]), queue = [faces[0]];
  while (queue.length) {
    const face = queue.shift()!, frame = frames.get(face.label)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbour = faces.find(f => f.x === face.x + dx && f.y === face.y + dy); if (!neighbour) continue;
      const next: Frame = dx === 1 ? { u: neg(frame.n), v: frame.v, n: frame.u } : dx === -1 ? { u: frame.n, v: frame.v, n: neg(frame.u) } : dy === 1 ? { u: frame.u, v: neg(frame.n), n: frame.v } : { u: frame.u, v: frame.n, n: neg(frame.v) };
      const old = frames.get(neighbour.label);
      if (old) { if (JSON.stringify(old) !== JSON.stringify(next)) return null; } else { frames.set(neighbour.label, next); queue.push(neighbour); }
    }
  }
  return frames.size === 6 && new Set([...frames.values()].map(f => vecKey(f.n))).size === 6 ? frames : null;
}
function orientations(cells: Point[], reflect = true): Point[][] {
  const unique = new Map<string, Point[]>();
  for (const f of reflect ? [1, -1] : [1]) for (let turn = 0; turn < 4; turn++) {
    const result = normalCells(cells.map(([a, b]) => { let x = a * f, y = b; for (let t = 0; t < turn; t++) [x, y] = [-y, x]; return [x, y]; })); unique.set(cellKey(result), result);
  }
  return [...unique.values()];
}
const freeKey = (cells: Point[]) => orientations(cells).map(cellKey).sort()[0];
const polyCache = new Map<number, Point[][]>([[1, [[[0, 0]]]]]);
export function polyominoes(size: number): Point[][] {
  const existing = polyCache.get(size); if (existing) return existing;
  const next = new Map<string, Point[]>();
  for (const shape of polyominoes(size - 1)) for (const [x, y] of shape) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const p: Point = [x + dx, y + dy]; if (shape.some(q => same(p, q))) continue;
    const cells = normalCells([...shape, p]); next.set(freeKey(cells), cells);
  }
  const shapes = [...next.values()]; polyCache.set(size, shapes); return shapes;
}
let nets: Point[][] | null = null;
function cubeNets(): Point[][] { return nets ??= polyominoes(6).filter(shape => foldNet(shape.map(([x, y], i) => ({ x, y, label: i + 1 }))) !== null); }
function cubeAnswer(model: CubeModel): number[] {
  const frames = foldNet(model.faces); if (!frames) return [];
  const top = frames.get(model.top)?.n, front = model.front === null ? null : frames.get(model.front)?.n;
  if (!top) return [];
  const labelAt = (n: Vec) => [...frames].find(([, f]) => vecKey(f.n) === vecKey(n))?.[0] ?? -1;
  if (model.query === 'opposite') return [labelAt(neg(top))];
  if (!front || dot(top, front) !== 0) return [];
  const right = cross3(top, front);
  return model.query === 'right' ? [labelAt(right)] : [labelAt(neg(front)), labelAt(neg(right))];
}
function cubeDiagram(faces: NetFace[]): Diagram {
  const cols = Math.max(...faces.map(f => f.x)) + 1, rows = Math.max(...faces.map(f => f.y)) + 1, size = Math.min(54, 260 / cols);
  const marks: Mark[] = [];
  for (const f of faces) { marks.push({ kind: 'rect', x: 14 + f.x * size, y: 14 + f.y * size, width: size, height: size, fill: '#f3ead2', stroke: INK }, text(14 + (f.x + 0.5) * size, 14 + (f.y + 0.6) * size, String(f.label), 23)); }
  return { width: 28 + cols * size, height: 28 + rows * size, description: 'Six numbered squares connected as a paper cube net.', marks };
}
function cubeRound(level: ChallengeLevel, seed: number, random: Random): Round {
  const source: Point[] = [[0, 1], [1, 1], [2, 1], [3, 1], [2, 0], [2, 2]];
  const shape = level === 0 ? source : pick(random, orientations(pick(random, cubeNets())));
  const labels = shuffle(random, [1, 2, 3, 4, 5, 6]);
  const faces = shape.map(([x, y], i) => ({ x, y, label: labels[i] })), top = pick(random, labels), frames = foldNet(faces)!;
  const front = level < 2 ? null : pick(random, labels.filter(l => dot(frames.get(l)!.n, frames.get(top)!.n) === 0));
  const model: CubeModel = { kind: 'cube-net', faces, query: level < 2 ? 'opposite' : level === 2 ? 'right' : 'roll', top, front, options: [] };
  const answer = cubeAnswer(model), correctId = `face-${answer.join('-')}`;
  let alternatives: number[][];
  if (level < 3) alternatives = shuffle(random, labels.filter(n => n !== top && n !== answer[0])).slice(0, 3).map(n => [n]);
  else {
    const initialRight = [...frames].find(([, f]) => vecKey(f.n) === vecKey(cross3(frames.get(top)!.n, frames.get(front!)!.n)))![0];
    alternatives = [[answer[0], initialRight], [answer[1], answer[0]], [front!, answer[1]]];
  }
  model.options = shuffle(random, [answer, ...alternatives]).map(f => ({ id: `face-${f.join('-')}`, faces: f }));
  const choices = model.options.map(({ id, faces: f }): Choice => ({ id, label: level < 3 ? String(f[0]) : `Top ${f[0]} · front ${f[1]}`, feedback: id === correctId ? 'These faces agree with the folded cube.' : level < 2 ? `Face ${f[0]} meets face ${top} along an edge. Opposite faces never share an edge.` : level === 2 ? `Face ${f[0]} is not on the right when ${top} is on top and ${front} faces you.` : 'That pair does not follow both rolls. After the right roll, the left face is on top; after the forward roll, the back face is on top.' }));
  return finish({ type: 'cube-net', level, seed, model, prompt: level < 2 ? `Fold this net into a cube. Which face is opposite ${top}?` : level === 2 ? `Fold the cube. Put ${top} on top and ${front} facing you. Which face is on the right?` : `Fold the cube with ${top} on top and ${front} facing you. Roll once to your right, then once toward you. Which faces are now on top and facing you?`, diagram: cubeDiagram(faces), choices, correctId, explanation: level < 2 ? `Faces ${top} and ${answer[0]} point in opposite directions after folding.` : level === 2 ? `With ${top} on top and ${front} at the front, ${answer[0]} is on the right.` : `After both rolls, ${answer[0]} is on top and ${answer[1]} faces you. A roll moves the whole cube by a quarter turn.`, hint: level < 2 ? 'Imagine raising the side squares, then closing the lid. Squares touching on the folded cube cannot be opposite.' : 'Keep track of the whole cube. Top, front, and right must agree with one folded orientation.' });
}

interface Route { id: string; points: Point[] }
interface TurnModel { kind: 'turns'; routes: Route[]; left: number; right: number | null; relation: boolean }
export function countTurns(points: Point[]): { left: number; right: number } {
  let left = 0, right = 0;
  for (let i = 1; i < points.length - 1; i++) { const c = cross2(sub(points[i], points[i - 1]), sub(points[i + 1], points[i])); if (c < 0) left++; if (c > 0) right++; }
  return { left, right };
}
function simpleRoute(points: Point[]): boolean {
  if (points.length < 3 || points.some((p, i) => i > 0 && (same(p, points[i - 1]) || (p[0] !== points[i - 1][0] && p[1] !== points[i - 1][1])))) return false;
  for (let i = 0; i < points.length - 1; i++) for (let j = i + 2; j < points.length - 1; j++) {
    const a: Segment = [points[i], points[i + 1]], b: Segment = [points[j], points[j + 1]];
    if (intersection(a, b)) return false;
    // Parallel overlap or a touch also makes a route ambiguous.
    if (Math.abs(cross2(sub(a[1], a[0]), sub(b[0], a[0]))) < 1e-8 && Math.abs(cross2(sub(a[1], a[0]), sub(b[1], a[0]))) < 1e-8) {
      const axis = a[0][0] === a[1][0] ? 1 : 0;
      if (Math.max(Math.min(a[0][axis], a[1][axis]), Math.min(b[0][axis], b[1][axis])) <= Math.min(Math.max(a[0][axis], a[1][axis]), Math.max(b[0][axis], b[1][axis]))) return false;
    }
  }
  return true;
}
function makeRoute(left: number, right: number, start: number, random: Random): Point[] {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const turns = shuffle(random, [...Array.from({ length: left }, () => -1), ...Array.from({ length: right }, () => 1)]);
    const points: Point[] = [[0, 0]]; let direction = start;
    for (let i = 0; i <= turns.length; i++) { const len = integer(random, 2, 5), [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][direction], last = points[points.length - 1]; points.push([last[0] + dx * len, last[1] + dy * len]); if (i < turns.length) direction = (direction + turns[i] + 4) % 4; }
    if (simpleRoute(points)) { const minX = Math.min(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1])); return points.map(([x, y]) => [x - minX, y - minY]); }
  }
  throw new Error('Route generator exhausted its non-crossing candidates.');
}
function routeDiagram(points: Point[]): Diagram {
  const width = Math.max(...points.map(p => p[0])), height = Math.max(...points.map(p => p[1])), scale = Math.min(140 / Math.max(1, width), 96 / Math.max(1, height));
  const ox = (190 - width * scale) / 2, oy = (150 - height * scale) / 2;
  const mapped = points.map(([x, y]): Point => [ox + x * scale, oy + y * scale]);
  const [a, b] = mapped, dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]), tip: Point = [a[0] + dx * Math.min(14, Math.hypot(b[0] - a[0], b[1] - a[1]) * .65), a[1] + dy * Math.min(14, Math.hypot(b[0] - a[0], b[1] - a[1]) * .65)];
  const end = mapped[mapped.length - 1];
  return { width: 190, height: 150, description: 'A route starts at the arrow and ends at the filled circle.', marks: [line(mapped, INK, 3.5), { kind: 'circle', x: a[0], y: a[1], radius: 4.5, fill: PAPER, stroke: INK }, { kind: 'polygon', points: [tip, [tip[0] - 7 * dx + 4 * dy, tip[1] - 7 * dy - 4 * dx], [tip[0] - 7 * dx - 4 * dy, tip[1] - 7 * dy + 4 * dx]], fill: INK, stroke: INK }, { kind: 'circle', x: end[0], y: end[1], radius: 5, fill: TEAL, stroke: INK }] };
}
function turnsRound(level: ChallengeLevel, seed: number, random: Random): Round {
  const left = level === 0 ? 3 : integer(random, 2, 4), right = level < 2 ? null : integer(random, 2, 4);
  const counts: [number, number][] = right === null ? [left - 1, left, left + 1, left === 2 ? left + 2 : left - 2].map(n => [n, Math.max(1, n - integer(random, 0, 1))]) : [[left, right], [left + 1, right - 1], [left - 1, right + 1], [left, right + 1]];
  const routes = shuffle(random, counts).map(([l, r], i) => ({ id: `route-${i}`, points: makeRoute(l, r, level === 0 ? 0 : integer(random, 0, 3), random) }));
  const model: TurnModel = { kind: 'turns', routes, left, right, relation: level === 3 };
  const correctId = routes.find(route => { const turns = countTurns(route.points); return turns.left === left && (right === null || turns.right === right); })!.id;
  const relation = right === null ? '' : left === right ? 'the same number of left and right turns' : `${Math.abs(left - right)} more ${left > right ? 'left' : 'right'} turn${Math.abs(left - right) === 1 ? '' : 's'} than ${left > right ? 'right' : 'left'} turns`;
  return finish({ type: 'turns', level, seed, model, prompt: level === 3 ? `Follow each arrow to its dot. Which route has ${left + right!} turns altogether and ${relation}?` : `Follow each arrow to its dot. Which route has exactly ${left} left turns${right === null ? '' : ` and ${right} right turns`}?`, choices: routes.map(route => { const c = countTurns(route.points); return { id: route.id, label: 'Route', diagram: routeDiagram(route.points), feedback: `This route has ${c.left} left turns and ${c.right} right turns. Turn as if you were walking along it.` }; }), correctId, explanation: `The matching route has ${left} left turns${right === null ? '' : ` and ${right} right turns`}. A left turn is relative to the direction you are walking, not the page.`, hint: 'Start at the arrow. At each corner, imagine turning your body; mark left or right before going on.' });
}

export type Stack = number[][];
type View = 'front' | 'left' | 'top';
interface CommonViewModel { kind: 'solid-views'; query: 'common'; stacks: Stack[] }
interface MatchViewModel { kind: 'solid-views'; query: 'match'; views: [View, View]; targets: [Point[], Point[]]; options: { id: string; stack: Stack }[] }
type SolidModel = CommonViewModel | MatchViewModel;
/** Filled unit-cell orthographic silhouettes, with a fixed origin and reading direction. */
export function projectStack(stack: Stack, view: View): Point[] {
  const cells: Point[] = [];
  if (view === 'top') { stack.forEach((row, y) => row.forEach((h, x) => { if (h > 0) cells.push([x, y]); })); }
  else {
    const heights = view === 'front' ? stack[0].map((_, x) => Math.max(...stack.map(row => row[x]))) : stack.map(row => Math.max(...row)).reverse();
    heights.forEach((h, x) => { for (let z = 0; z < h; z++) cells.push([x, z]); });
  }
  return sortCells(cells);
}
const stackKey = (stack: Stack) => JSON.stringify(stack);
function stackMarks(stack: Stack, offsetX: number, offsetY: number, cell: number): Mark[] {
  const marks: Mark[] = [];
  const point = (x: number, y: number, z: number): Point => [offsetX + (x - .55 * y) * cell, offsetY - (.4 * y + z) * cell];
  // Back-to-front painter order. Every cube is a flat, outlined polygon; no lighting or textures.
  for (let y = stack.length - 1; y >= 0; y--) for (let x = stack[0].length - 1; x >= 0; x--) for (let z = 0; z < stack[y][x]; z++) {
    const polys: Point[][] = [[point(x, y, z), point(x + 1, y, z), point(x + 1, y, z + 1), point(x, y, z + 1)], [point(x, y, z), point(x, y + 1, z), point(x, y + 1, z + 1), point(x, y, z + 1)], [point(x, y, z + 1), point(x + 1, y, z + 1), point(x + 1, y + 1, z + 1), point(x, y + 1, z + 1)]];
    polys.forEach(points => marks.push({ kind: 'polygon', points, fill: '#d8e6e3', stroke: INK }));
  }
  return marks;
}
function stackDiagram(stack: Stack, arrows = true): Diagram {
  const max = Math.max(...stack.flat()), cell = Math.min(27, 148 / (stack[0].length + .55 * stack.length), 112 / (max + .4 * stack.length));
  const originX = 22 + .55 * stack.length * cell, marks = stackMarks(stack, originX, 130, cell);
  if (arrows) {
    marks.push(text(29, 153, 'Left', 13), text(148, 153, 'Front', 13));
    marks.push(line([[38, 138], [originX - 5, 129]], INK, 1.5), line([[originX - 11, 128], [originX - 5, 129], [originX - 10, 133]], INK, 1.5));
    marks.push(line([[142, 139], [originX + cell * .7, 131]], INK, 1.5), line([[originX + cell * .7 + 6, 129], [originX + cell * .7, 131], [originX + cell * .7 + 4, 135]], INK, 1.5));
  }
  return { width: 204, height: 164, description: 'A solid stack of unit cubes, shown from the front and the left side.', marks };
}
function cellsDiagram(cells: Point[], description: string, invertY = false, fill = '#d8e6e3'): Diagram {
  const normal = normalCells(cells), cols = Math.max(...normal.map(p => p[0])) + 1, rows = Math.max(...normal.map(p => p[1])) + 1, size = Math.min(34, 148 / Math.max(cols, rows));
  const ox = (184 - cols * size) / 2, oy = (160 - rows * size) / 2;
  return { width: 184, height: 160, description, marks: normal.map(([x, y]) => ({ kind: 'rect', x: ox + x * size, y: oy + (invertY ? rows - y - 1 : y) * size, width: size, height: size, fill, stroke: INK })) };
}
function translated(diagram: Diagram, dx: number, dy: number): Mark[] {
  return diagram.marks.map(m => m.kind === 'line' || m.kind === 'polygon' ? { ...m, points: m.points.map(([x, y]): Point => [x + dx, y + dy]) } : { ...m, x: m.x + dx, y: m.y + dy });
}
function commonViews(stacks: Stack[]): View[] { return (['front', 'left', 'top'] as View[]).filter(v => new Set(stacks.map(s => cellKey(projectStack(s, v)))).size === 1); }
function connected(cells: Point[]): boolean {
  if (!cells.length) return false; const remaining = new Set(cells.map(pkey)), queue = [cells[0]]; remaining.delete(pkey(cells[0]));
  while (queue.length) { const [x, y] = queue.shift()!; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const p: Point = [x + dx, y + dy]; if (remaining.delete(pkey(p))) queue.push(p); } }
  return remaining.size === 0;
}
function randomStack(random: Random, max: number): Stack {
  const heights = [integer(random, 1, 2)];
  heights.push(integer(random, heights[0], max), 0); heights[2] = integer(random, heights[1], max);
  const stack: Stack = [];
  heights.forEach((h, y) => stack.push(Array.from({ length: 3 }, (_, x) => x === 0 ? h : integer(random, y ? stack[y - 1][x] : 0, h))));
  return stack;
}
function solidRound(level: ChallengeLevel, seed: number, random: Random): Round {
  if (level < 2) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const axis = pick(random, ['front', 'left', 'top'] as const), width = integer(random, 3, 4), profile = [1, integer(random, 1, 2), integer(random, 3, level === 0 ? 4 : 5)];
      let stacks: Stack[];
      if (axis === 'top') {
        const footprint = Array.from({ length: 3 }, (_, y) => Array.from({ length: width }, (_, x) => x === 0 || (y === 2 && x < width - 1) || (y === 1 && x === 1) ? 1 : 0));
        stacks = Array.from({ length: 3 }, () => footprint.map((row, y) => row.map(h => h ? integer(random, 1, Math.min(y + 2, level === 0 ? 4 : 5)) : 0)));
      } else if (axis === 'front') {
        const rear = Array.from({ length: width }, (_, x) => x === 0 ? profile[2] : integer(random, 1, Math.min(3, profile[2])));
        stacks = Array.from({ length: 3 }, () => {
          const middle = rear.map((h, x) => integer(random, x === 0 ? 1 : 0, h)), front = middle.map((h, x) => integer(random, x === 0 ? 1 : 0, h));
          return [front, middle, [...rear]];
        });
      } else {
        stacks = Array.from({ length: 3 }, () => profile.map((h, y) => Array.from({ length: width }, (_, x) => x === 0 ? h : y === 0 ? 0 : integer(random, 0, Math.min(h, level === 0 ? 2 : 3)))));
      }
      if (stacks.some(s => !connected(projectStack(s, 'top')) || s.some((row, y) => y > 0 && row.some((h, x) => h < s[y - 1][x]))) || new Set(stacks.map(stackKey)).size !== 3 || commonViews(stacks).length !== 1) continue;
      const marks: Mark[] = [];
      stacks.forEach((s, i) => { const x = i < 2 ? i * 208 : 104, y = i < 2 ? 0 : 178; marks.push(...translated(stackDiagram(s), x, y), text(x + 102, y + 16, String.fromCharCode(65 + i), 17)); });
      const model: CommonViewModel = { kind: 'solid-views', query: 'common', stacks };
      const choices = shuffle(random, ['front', 'left', 'top', 'none']).map(v => ({ id: v, label: v === 'none' ? 'No common view' : `${v[0].toUpperCase()}${v.slice(1)} view`, feedback: v === axis ? `All three stacks have the same ${axis} outline.` : v === 'none' ? 'One viewing direction hides all the differences between the stacks.' : `The ${v} outlines are different. Compare one row or column at a time.` }));
      return finish({ type: 'solid-views', level, seed, model, prompt: 'Which view looks the same for all three stacks? Every column is solid down to the base.', diagram: { width: 416, height: 342, description: 'Three different cube stacks, labelled A, B, and C. Arrows label the front and left viewing directions.', marks }, choices, correctId: axis, explanation: `Their ${axis} views match. Looking from that direction hides the differences that you can see from the other directions.`, hint: 'For the front and left views, compare the tallest column on each sight line. From above, compare the occupied floor squares.' });
    }
    throw new Error('Common-view generator exhausted its validated candidates.');
  }
  for (let attempt = 0; attempt < 150; attempt++) {
    const correct = randomStack(random, 3), views: [View, View] = level === 2 ? ['top', 'front'] : ['front', 'left'];
    if (!connected(projectStack(correct, 'top'))) continue;
    const targetKeys = views.map(v => cellKey(projectStack(correct, v))), distractors: (Stack | null)[] = [null, null, null];
    for (let n = 0; n < 100 && distractors.some(d => !d); n++) {
      const candidate = randomStack(random, 3); if (!connected(projectStack(candidate, 'top'))) continue;
      const matches = views.map((v, i) => cellKey(projectStack(candidate, v)) === targetKeys[i]);
      const slot = matches[0] && !matches[1] ? 0 : !matches[0] && matches[1] ? 1 : !matches[0] && !matches[1] ? 2 : -1;
      if (slot >= 0 && !distractors[slot]) distractors[slot] = candidate;
    }
    if (distractors.some(d => !d)) continue;
    const options = shuffle(random, [correct, ...distractors as Stack[]]).map((stack, i) => ({ id: `solid-${i}`, stack }));
    const model: MatchViewModel = { kind: 'solid-views', query: 'match', views, targets: views.map(v => projectStack(correct, v)) as [Point[], Point[]], options };
    const correctId = options.find(o => stackKey(o.stack) === stackKey(correct))!.id;
    const marks: Mark[] = [];
    views.forEach((view, i) => { marks.push(...translated(cellsDiagram(model.targets[i], `${view} silhouette`, true), i * 186, 16), text(i * 186 + 92, 22, `${view[0].toUpperCase()}${view.slice(1)} view`, 17)); });
    return finish({ type: 'solid-views', level, seed, model, prompt: `Which solid matches BOTH views? Every column is solid down to the base.${level === 2 ? ' In the top view, the front edge is at the bottom.' : ''}`, diagram: { width: 372, height: 180, description: 'Two flat views of the same stack of cubes.', marks }, choices: options.map(o => ({ id: o.id, label: 'Stack', diagram: stackDiagram(o.stack), feedback: views.filter((v, i) => cellKey(projectStack(o.stack, v)) !== targetKeys[i]).map(v => `Its ${v} view does not match.`).join(' ') || 'Both views match this stack.' })), correctId, explanation: `Only this stack matches both the ${views[0]} and ${views[1]} views. Either view alone would leave another possible choice.`, hint: 'Eliminate a stack only after checking a view. Keep checking the other view when the first one matches.' });
  }
  throw new Error('Projection generator exhausted its validated candidates.');
}

interface PartitionModel { kind: 'partition'; board: Point[]; stars: Point[]; circles: Point[]; pieces: number; options: { id: string; cells: Point[] }[] }
interface Placement { cells: Point[]; mask: number }
const placementCache = new Map<string, Placement[]>();
function placements(board: Point[], piece: Point[]): Placement[] {
  const key = `${cellKey(board)}|${freeKey(piece)}`, prior = placementCache.get(key); if (prior) return prior;
  if (board.length > 30) throw new Error('Partition board exceeds the exact-cover bitset bound.');
  const indices = new Map(board.map((p, i) => [pkey(p), i])), list: Placement[] = [], seen = new Set<number>();
  const minX = Math.min(...board.map(p => p[0])), minY = Math.min(...board.map(p => p[1])), maxX = Math.max(...board.map(p => p[0])), maxY = Math.max(...board.map(p => p[1]));
  for (const shape of orientations(piece)) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const cells = shape.map(([a, b]): Point => [a + x, b + y]); if (!cells.every(p => indices.has(pkey(p)))) continue;
    const mask = cells.reduce((m, p) => m | (1 << indices.get(pkey(p))!), 0);
    if (!seen.has(mask)) { seen.add(mask); list.push({ cells, mask }); }
  }
  placementCache.set(key, list); return list;
}
/** Algorithm X on a ≤24-cell board. Reflections and quarter-turns are legal; every marked piece has exactly one of each supplied marker. */
export function solvePartition(board: Point[], piece: Point[], stars: Point[] = [], circles: Point[] = [], limit = 1): Point[][][] {
  if (!board.length || !piece.length || board.length > 30 || board.length % piece.length || !connected(piece) || new Set(board.map(pkey)).size !== board.length) return [];
  const pieces = board.length / piece.length, boardKeys = new Set(board.map(pkey));
  if ([stars, circles].some(markers => markers.length > 0 && (markers.length !== pieces || new Set(markers.map(pkey)).size !== markers.length || markers.some(p => !boardKeys.has(pkey(p)))))) return [];
  const fits = placements(board, piece).filter(p => [stars, circles].every(markers => !markers.length || markers.filter(s => p.cells.some(c => same(c, s))).length === 1));
  const byCell = board.map((_, i) => fits.filter(p => p.mask & (1 << i))), full = (1 << board.length) - 1, results: Point[][][] = [];
  const visit = (used: number, chosen: Point[][]) => {
    if (results.length >= limit) return;
    if (used === full) { results.push(chosen); return; }
    let candidates: Placement[] | null = null;
    for (let i = 0; i < board.length; i++) if (!(used & (1 << i))) { const available = byCell[i].filter(p => !(p.mask & used)); if (!available.length) return; if (!candidates || available.length < candidates.length) candidates = available; }
    for (const p of candidates ?? []) { visit(used | p.mask, [...chosen, p.cells]); if (results.length >= limit) return; }
  };
  visit(0, []); return results;
}
const boardFor = (level: ChallengeLevel): Point[] => {
  const board: Point[] = [];
  for (let y = 0; y < (level === 0 ? 6 : 4); y++) for (let x = 0; x < (level === 1 ? 5 : 6); x++) if (level !== 0 || x === 2 || x === 3 || y === 2 || y === 3) board.push([x, y]);
  return board;
};
const similarityCache = new Map<string, number>();
const tilingCache = new Map<number, { shape: Point[]; tilings: Point[][][] }[]>();
function tilingTemplates(level: ChallengeLevel): { shape: Point[]; tilings: Point[][][] }[] {
  const key = Math.min(level, 2), cached = tilingCache.get(key); if (cached) return cached;
  const board = boardFor(level), templates = polyominoes(board.length / 4).map(shape => ({ shape, tilings: solvePartition(board, shape, [], [], 8) })).filter(entry => entry.tilings.length);
  tilingCache.set(key, templates); return templates;
}
function partitionDiagram(model: PartitionModel): Diagram {
  const board = cellsDiagram(model.board, 'A gridded board with stars, to divide into four congruent pieces.', false, PAPER), cols = Math.max(...model.board.map(p => p[0])) + 1, rows = Math.max(...model.board.map(p => p[1])) + 1, size = Math.min(34, 148 / Math.max(cols, rows)), ox = (184 - cols * size) / 2, oy = (160 - rows * size) / 2;
  for (const [x, y] of model.stars) board.marks.push(text(ox + (x + .5) * size, oy + (y + .68) * size, '★', size * .75));
  for (const [x, y] of model.circles) board.marks.push({ kind: 'circle', x: ox + (x + .5) * size, y: oy + (y + .5) * size, radius: size * .24, fill: GOLD, stroke: INK });
  return board;
}
function partitionRound(level: ChallengeLevel, seed: number, random: Random): Round {
  const board = boardFor(level), catalogue = polyominoes(board.length / 4), templates = tilingTemplates(level);
  for (let attempt = 0; attempt < 160; attempt++) {
    const { shape, tilings } = pick(random, templates), tiling = pick(random, tilings), stars = tiling.map(piece => pick(random, piece));
    const circles = level === 3 ? tiling.map((piece, i) => pick(random, piece.filter(p => !same(p, stars[i])))) : [];
    const wrong = shuffle(random, catalogue.filter(piece => freeKey(piece) !== freeKey(shape))).filter(piece => solvePartition(board, piece, stars, circles).length === 0);
    if (wrong.length < 3) continue;
    // Use pieces with the same area, with at least one close shape differing by one moved square.
    const similarity = (piece: Point[]) => {
      const key = `${freeKey(shape)}|${freeKey(piece)}`, old = similarityCache.get(key); if (old !== undefined) return old;
      const score = Math.max(...orientations(shape).flatMap(a => orientations(piece).map(b => a.filter(p => b.some(q => same(p, q))).length)));
      similarityCache.set(key, score); return score;
    };
    wrong.sort((a, b) => similarity(b) - similarity(a));
    const selected = [shape, ...wrong.slice(0, 3)], options = shuffle(random, selected).map(cells => ({ id: `piece-${freeKey(cells)}`, cells }));
    const model: PartitionModel = { kind: 'partition', board, stars, circles, pieces: 4, options }, correctId = `piece-${freeKey(shape)}`;
    return finish({ type: 'partition', level, seed, model, prompt: `Divide the board along grid lines into 4 pieces of the same shape and size. Each piece must contain one star${circles.length ? ' and one gold circle' : ''}. Which shape works? You may turn or flip pieces.`, diagram: partitionDiagram(model), choices: options.map(o => ({ id: o.id, label: 'Piece', diagram: cellsDiagram(o.cells, 'An outlined piece made from connected unit squares.', false, '#d8e6e3'), feedback: o.id === correctId ? 'Four copies cover the board exactly, with the required markers in each.' : `Four copies of this piece cannot cover the board with exactly one star${circles.length ? ' and one circle' : ''} in each. Check the arm ends and the marked squares.` })), correctId, explanation: `Each piece has ${shape.length} squares: ${board.length} ÷ 4 = ${shape.length}. Four turned or flipped copies of this shape cover every square, without overlap, with one star${circles.length ? ' and one circle' : ''} each.`, hint: 'Start with a corner or an arm of the board. Every piece must have equal area and the same shape after turning or flipping.' });
  }
  throw new Error('Partition generator exhausted its validated candidates.');
}

type SpatialModel = TriangleModel | CubeModel | TurnModel | SolidModel | PartitionModel;
function modelFingerprint(model: SpatialModel): string {
  switch (model.kind) {
    case 'triangles': return JSON.stringify({ kind: model.kind, segments: model.segments.map(s => s.map(pkey).sort().join(':')).sort(), requiredSide: model.requiredSide?.map(pkey).sort() ?? null });
    case 'cube-net': return JSON.stringify({ kind: model.kind, faces: [...model.faces].sort((a, b) => a.y - b.y || a.x - b.x), query: model.query, top: model.top, front: model.front });
    case 'turns': return JSON.stringify({ kind: model.kind, routes: model.routes.map(r => JSON.stringify(r.points)).sort(), left: model.left, right: model.right, relation: model.relation });
    case 'solid-views': return model.query === 'common' ? JSON.stringify({ kind: model.kind, query: model.query, stacks: model.stacks.map(stackKey).sort() }) : JSON.stringify({ kind: model.kind, query: model.query, views: model.views, targets: model.targets.map(cellKey), options: model.options.map(o => stackKey(o.stack)).sort() });
    case 'partition': return JSON.stringify({ kind: model.kind, board: cellKey(model.board), stars: cellKey(model.stars), circles: cellKey(model.circles), pieces: model.pieces });
  }
}
export function spatialFingerprint(round: Pick<Round, 'model'>): string { return modelFingerprint(round.model as SpatialModel); }
function finish(round: Omit<Round, 'fingerprint'>): Round { return { ...round, fingerprint: modelFingerprint(round.model as SpatialModel) }; }

export function generateSpatialRound(type: ProblemType, level: ChallengeLevel, seed: number): Round {
  if (!Number.isInteger(level) || level < 0 || level > 3 || !Number.isSafeInteger(seed)) throw new Error('Spatial generation requires a valid challenge level and integer seed.');
  const random = rng(seed);
  const round = type === 'triangles' ? triangleRound(level, seed, random) : type === 'cube-net' ? cubeRound(level, seed, random) : type === 'turns' ? turnsRound(level, seed, random) : type === 'solid-views' ? solidRound(level, seed, random) : type === 'partition' ? partitionRound(level, seed, random) : null;
  if (!round) throw new Error(`Unsupported spatial problem type: ${type}`);
  if (!validateSpatialRound(round)) throw new Error(`Spatial generator produced an invalid ${type} candidate.`);
  return round;
}

/** Recompute every choice from geometry. This deliberately does not trust the generated correctId. */
export function validateSpatialRound(round: Round): boolean {
  try {
    if (!SPATIAL_TYPES.some(t => t.id === round.type) || ![0, 1, 2, 3].includes(round.level) || round.choices.length !== 4 || new Set(round.choices.map(c => c.id)).size !== 4 || round.choices.some(c => !c.feedback)) return false;
    const model = round.model as SpatialModel;
    if (model.kind !== round.type || spatialFingerprint(round) !== round.fingerprint) return false;
    let valid: string[] = [];
    if (model.kind === 'triangles') {
      const n = enumerateTriangles(model.segments, model.requiredSide).length;
      const range = round.level === 0 ? [4, 8] : round.level === 1 ? [7, 13] : round.level === 2 ? [10, 22] : [3, 12];
      if (n < range[0] || n > range[1] || (model.requiredSide !== null) !== (round.level === 3) || model.segments.length < (round.level === 0 ? 7 : round.level === 1 ? 8 : 9) || model.segments.length > (round.level < 2 ? 8 : 9)) return false;
      if (!n || model.segments.some(s => same(s[0], s[1])) || new Set(model.segments.map(s => s.map(pkey).sort().join(':'))).size !== model.segments.length) return false;
      if (round.choices.some(c => c.id !== `n-${c.label}` || !Number.isInteger(Number(c.label)))) return false;
      valid = round.choices.filter(c => Number(c.label) === n).map(c => c.id);
    } else if (model.kind === 'cube-net') {
      if (model.query !== (round.level < 2 ? 'opposite' : round.level === 2 ? 'right' : 'roll') || (model.front === null) !== (round.level < 2) || model.faces.some(f => !Number.isInteger(f.label) || f.label < 1 || f.label > 6) || !foldNet(model.faces) || model.options.length !== 4) return false;
      const answer = cubeAnswer(model).join(',');
      if (new Set(model.options.map(o => o.faces.join(','))).size !== 4 || model.options.some(o => !round.choices.some(c => c.id === o.id))) return false;
      valid = model.options.filter(o => o.faces.join(',') === answer).map(o => o.id);
    } else if (model.kind === 'turns') {
      if (model.relation !== (round.level === 3) || (model.right === null) !== (round.level < 2) || !Number.isInteger(model.left) || model.left < 2 || model.left > 4 || (round.level === 0 && model.left !== 3) || (model.right !== null && (!Number.isInteger(model.right) || model.right < 2 || model.right > 4))) return false;
      if (model.routes.length !== 4 || model.routes.some(r => !simpleRoute(r.points)) || new Set(model.routes.map(r => JSON.stringify(r.points))).size !== 4 || model.routes.some(r => !round.choices.some(c => c.id === r.id))) return false;
      valid = model.routes.filter(r => { const c = countTurns(r.points); return c.left === model.left && (model.right === null || c.right === model.right); }).map(r => r.id);
    } else if (model.kind === 'solid-views') {
      if (model.query !== (round.level < 2 ? 'common' : 'match')) return false;
      const stacks = model.query === 'common' ? model.stacks : model.options.map(o => o.stack);
      if (stacks.some(s => !s.length || !s[0].length || s.some(row => row.length !== s[0].length || row.some(h => !Number.isInteger(h) || h < 0 || h > 5)) || !connected(projectStack(s, 'top'))) || new Set(stacks.map(stackKey)).size !== stacks.length) return false;
      if (model.query === 'common') { const views = commonViews(model.stacks); if (views.length > 1 || model.stacks.length !== 3) return false; valid = [views[0] ?? 'none']; }
      else {
        if (model.options.length !== 4 || model.options.some(o => !round.choices.some(c => c.id === o.id))) return false;
        const matches = model.options.map(o => model.views.map((v, i) => cellKey(projectStack(o.stack, v)) === cellKey(model.targets[i])));
        if ([0, 1].some(i => matches.filter(m => m[i]).length < 2)) return false;
        valid = model.options.filter((_, i) => matches[i].every(Boolean)).map(o => o.id);
      }
    } else if (model.kind === 'partition') {
      if (model.board.length !== (round.level < 2 ? 20 : 24) || model.circles.length !== (round.level === 3 ? 4 : 0)) return false;
      if (model.pieces !== 4 || model.stars.length !== model.pieces || (model.circles.length !== 0 && model.circles.length !== model.pieces) || model.options.length !== 4 || !connected(model.board) || new Set(model.options.map(o => freeKey(o.cells))).size !== 4 || model.options.some(o => o.cells.length * model.pieces !== model.board.length || !round.choices.some(c => c.id === o.id))) return false;
      valid = model.options.filter(o => solvePartition(model.board, o.cells, model.stars, model.circles).length > 0).map(o => o.id);
    }
    return valid.length === 1 && valid[0] === round.correctId && round.choices.some(c => c.id === valid[0]);
  } catch { return false; }
}
