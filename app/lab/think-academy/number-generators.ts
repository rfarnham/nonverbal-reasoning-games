import type { ChallengeLevel, Choice, Diagram, Mark, Point, ProblemType, Round, TypeInfo } from './types.ts';

export const NUMBER_TYPES: TypeInfo[] = [
  { id: 'arithmetic', title: 'Add & subtract', sourceNumber: 1, description: 'Place value, regrouping, and missing numbers.', challenges: ['Two-digit calculation', 'Missing operand', 'Two connected operations', 'Work backward through two operations'] },
  { id: 'length', title: 'Compare lengths', sourceNumber: 2, description: 'Measure from end to end, even when starting points differ.', challenges: ['Shifted pencils on a grid', 'Difference between two lengths', 'Measure a bent path', 'Infer a missing segment'] },
  { id: 'place-value', title: 'Tens & ones', sourceNumber: 3, description: 'Compose numbers and exchange equal place-value units.', challenges: ['Tens and ones', 'Exchange a ten', 'Exchange a hundred', 'Reconstruct exchanged units'] },
  { id: 'fractions', title: 'Shaded fractions', sourceNumber: 4, description: 'Compare shaded area with the whole shape.', challenges: ['Recognize one half', 'Thirds and quarters', 'Equivalent fractions', 'Unequal pieces, equal area'] },
  { id: 'multiplication', title: 'Equal groups', sourceNumber: 5, description: 'Multiplication facts, factors, and connected groups.', challenges: ['Multiplication facts', 'Missing factor', 'Combine two products', 'Infer groups after extras'] },
  { id: 'fruit-equations', title: 'Fruit equations', sourceNumber: 6, description: 'Replace equal fruits to discover their values.', challenges: ['Two-fruit substitution', 'Three-fruit substitution', 'Combine pair totals', 'Infer a new expression'] },
  { id: 'sharing', title: 'Fair shares', sourceNumber: 8, description: 'Divide whole objects equally.', challenges: ['Equal sharing', 'Set some aside first', 'Whole shares and leftovers', 'Combine two sharing rounds'] },
  { id: 'tree-gaps', title: 'Trees & gaps', sourceNumber: 9, description: 'Count spaces between objects, rather than the objects.', challenges: ['Distance across equal gaps', 'Distance between inner trees', 'Two different gap sizes', 'Infer an unmarked gap size'] },
  { id: 'queue', title: 'Places in line', sourceNumber: 10, description: 'Count people, places, and the person in the middle.', challenges: ['Ahead, behind, and you', 'Ranks from both ends', 'People leave and join', 'Combine two people’s positions'] },
  { id: 'balance', title: 'Hanging balances', sourceNumber: 15, description: 'Follow equal weights through a hanging mobile.', challenges: ['Connected balanced bars', 'Include a center weight', 'Follow a nested balance', 'Start from the whole weight'] },
];

const INK = '#17213d';
const TEAL = '#35a999';
const GOLD = '#f3bd4e';
const CORAL = '#f06f5f';
const VIOLET = '#7767d7';
const PAPER = '#fffdf8';
class Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number { let t = this.state += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(values: readonly T[]): T { return values[this.int(0, values.length - 1)]; }
  shuffle<T>(values: readonly T[]): T[] { const out = [...values]; for (let i = out.length - 1; i > 0; i--) { const j = this.int(0, i); [out[i], out[j]] = [out[j], out[i]]; } return out; }
}
const textMark = (x: number, y: number, text: string, size = 20): Mark => ({ kind: 'text', x, y, text, size, color: INK });
const line = (points: Point[], color = INK, width = 2): Mark => ({ kind: 'line', points, color, width });
const diagram = (width: number, height: number, description: string, marks: Mark[]): Diagram => ({ width, height, description, marks });
const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
const symbol = (op: number): string => op === 1 ? '+' : '−';

interface ArithmeticModel { kind: 'arithmetic'; a: number; b: number; c: number; op: 1 | -1; op2: 1 | -1; missing: 'result' | 'b' | 'a'; total: number; family: number }
interface Pencil { points: Point[] }
interface LengthModel { kind: 'length'; paths: Pencil[]; query: 'longest' | 'difference' | 'missing'; unit: number }
interface PlaceModel { kind: 'place-value'; n: number; hundreds: number; tens: number; ones: number; query: 'decompose' | 'ones' | 'tens' | 'number' }
interface FractionPanel { id: string; weights: number[]; shaded: boolean[] }
interface FractionModel { kind: 'fractions'; target: [number, number]; panels: FractionPanel[]; unequal: boolean }
interface ProductModel { kind: 'multiplication'; a: number; b: number; c: number; extras: number; total: number; query: 'product' | 'factor' | 'combine' | 'inverse' }
interface Term { shape: number; count: number }
interface Equation { left: Term[]; right: Term[]; total: number }
interface FruitModel { kind: 'fruit-equations'; equations: Equation[]; target: Term[] }
interface SharingModel { kind: 'sharing'; people: number; total: number; reserve: number; second: number; query: 'each' | 'remainder' | 'combined' }
interface TreeModel { kind: 'tree-gaps'; count: number; split: number; firstGap: number; secondGap: number; from: number; to: number; hiddenSecond: boolean; totalDistance: number }
interface QueueModel { kind: 'queue'; front: number; back: number; leave: number; join: number; between: number; query: 'total' | 'ranks' | 'new-rank' | 'two-people' }
interface WeightGroup { shape: number; count: number }
interface Beam { left: Mobile; right: Mobile; center?: WeightGroup }
type Mobile = WeightGroup | Beam;
interface BalanceModel { kind: 'balance'; mobile: Beam; known: { shape: number | 'whole'; value: number }; target: number }
export type NumberModel = ArithmeticModel | LengthModel | PlaceModel | FractionModel | ProductModel | FruitModel | SharingModel | TreeModel | QueueModel | BalanceModel;

function pathLength(path: Pencil): number { return path.points.slice(1).reduce((sum, p, i) => sum + Math.abs(p[0] - path.points[i][0]) + Math.abs(p[1] - path.points[i][1]), 0); }
function fractionValue(panel: FractionPanel): [number, number] { return [panel.weights.reduce((s, w, i) => s + (panel.shaded[i] ? w : 0), 0), panel.weights.reduce((s, w) => s + w, 0)]; }
function solveLinear(rows: number[][], size: number): number[] {
  const a = rows.map(row => [...row]); let pivotRow = 0;
  for (let column = 0; column < size; column++) {
    const pivot = a.findIndex((row, i) => i >= pivotRow && Math.abs(row[column]) > 1e-8);
    if (pivot < 0) throw new Error('Underdetermined number puzzle');
    [a[pivotRow], a[pivot]] = [a[pivot], a[pivotRow]];
    const divisor = a[pivotRow][column]; a[pivotRow] = a[pivotRow].map(v => v / divisor);
    for (let row = 0; row < a.length; row++) if (row !== pivotRow) { const factor = a[row][column]; a[row] = a[row].map((v, i) => v - factor * a[pivotRow][i]); }
    pivotRow++;
  }
  if (a.slice(size).some(row => row.slice(0, size).every(v => Math.abs(v) < 1e-8) && Math.abs(row[size]) > 1e-8)) throw new Error('Inconsistent number puzzle');
  return a.slice(0, size).map(row => Math.round(row[size] * 1e8) / 1e8);
}
function fruitValues(model: FruitModel): number[] {
  const size = Math.max(...model.equations.flatMap(e => [...e.left, ...e.right].map(t => t.shape))) + 1;
  return solveLinear(model.equations.map(e => { const row = Array(size + 1).fill(0) as number[]; for (const t of e.left) row[t.shape] += t.count; for (const t of e.right) row[t.shape] -= t.count; row[size] = e.total; return row; }), size);
}
function mobileWeights(node: Mobile, size: number): number[] {
  if ('shape' in node) { const result = Array(size).fill(0) as number[]; result[node.shape] = node.count; return result; }
  const left = mobileWeights(node.left, size), right = mobileWeights(node.right, size);
  const result = left.map((v, i) => v + right[i]); if (node.center) result[node.center.shape] += node.center.count; return result;
}
function balanceValues(model: BalanceModel): number[] {
  const size = 4, equations: number[][] = [];
  function visit(node: Mobile): void { if ('shape' in node) return; const left = mobileWeights(node.left, size), right = mobileWeights(node.right, size); equations.push([...left.map((v, i) => v - right[i]), 0]); visit(node.left); visit(node.right); }
  visit(model.mobile);
  const known = model.known.shape === 'whole' ? mobileWeights(model.mobile, size) : Array.from({ length: size }, (_, i) => i === model.known.shape ? 1 : 0);
  equations.push([...known, model.known.value]); return solveLinear(equations, size);
}
function calculate(model: NumberModel): string {
  switch (model.kind) {
    case 'arithmetic': return String(model.missing === 'a' ? model.total - model.op * model.b - model.op2 * model.c : model.missing === 'b' ? (model.total - model.a - model.op2 * model.c) / model.op : model.a + model.op * model.b + model.op2 * model.c);
    case 'length': {
      const lengths = model.paths.map(pathLength);
      if (model.query === 'longest') return `path:${lengths.indexOf(Math.max(...lengths))}`;
      return String(model.query === 'difference' ? Math.abs(lengths[0] - lengths[1]) * model.unit : (lengths[0] - lengths[1]) * model.unit);
    }
    case 'place-value': return model.query === 'decompose' ? `${Math.floor(model.n / 10)} tens + ${model.n % 10} ones` : String(model.query === 'ones' ? model.n - model.hundreds * 100 - model.tens * 10 : model.query === 'tens' ? (model.n - model.hundreds * 100 - model.ones) / 10 : model.hundreds * 100 + model.tens * 10 + model.ones);
    case 'fractions': { const valid = model.panels.filter(p => { const [n, d] = fractionValue(p); return n * model.target[1] === d * model.target[0]; }); if (valid.length !== 1) throw new Error('Ambiguous fraction choices'); return valid[0].id; }
    case 'multiplication': return String(model.query === 'factor' ? model.total / model.a : model.query === 'inverse' ? (model.total - model.extras) / model.a : model.a * model.b + (model.query === 'combine' ? model.a * model.c : 0));
    case 'fruit-equations': { const values = fruitValues(model); return String(model.target.reduce((sum, term) => sum + term.count * values[term.shape], 0)); }
    case 'sharing': { const pool = model.total - model.reserve; return String(model.query === 'remainder' ? pool % model.people : Math.floor(pool / model.people) + (model.query === 'combined' ? Math.floor(model.second / model.people) : 0)); }
    case 'tree-gaps': return String(Array.from({ length: model.to - model.from }, (_, i) => model.from - 1 + i < model.split ? model.firstGap : model.hiddenSecond ? (model.totalDistance - model.split * model.firstGap) / (model.count - 1 - model.split) : model.secondGap).reduce((a, b) => a + b, 0));
    case 'queue': return String(model.query === 'total' ? model.front + model.back + 1 : model.query === 'ranks' ? model.front + model.back - 1 : model.query === 'new-rank' ? model.front - model.leave + model.join + 1 : model.front + model.between + model.back);
    case 'balance': return String(balanceValues(model)[model.target]);
  }
}
function stableModel(model: NumberModel): string {
  // Fingerprint the given problem, excluding cached answers, inactive terms,
  // and generated metadata that cannot change the reasoning task.
  switch (model.kind) {
    case 'arithmetic': return JSON.stringify({ kind: model.kind, a: model.missing === 'a' ? undefined : model.a, b: model.missing === 'b' ? undefined : model.b, op: model.op, c: model.c || undefined, op2: model.c ? model.op2 : undefined, missing: model.missing, total: model.missing === 'result' ? undefined : model.total });
    case 'length': return JSON.stringify({ ...model, paths: model.query === 'difference' ? model.paths.slice(0, 2) : model.paths });
    case 'place-value': return JSON.stringify({ kind: model.kind, query: model.query, n: model.query === 'number' ? undefined : model.n, hundreds: model.query === 'decompose' ? undefined : model.hundreds, tens: model.query === 'decompose' || model.query === 'tens' ? undefined : model.tens, ones: model.query === 'decompose' || model.query === 'ones' ? undefined : model.ones });
    case 'fractions': {
      const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
      const divisor = gcd(model.target[0], model.target[1]);
      const panels = model.panels.map(p => ({ weights: p.weights, shaded: p.shaded })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return JSON.stringify({ kind: model.kind, target: model.target.map(v => v / divisor), unequal: model.unequal, panels });
    }
    case 'multiplication': return JSON.stringify({ kind: model.kind, query: model.query, a: model.a, b: model.query === 'product' || model.query === 'combine' ? model.b : undefined, c: model.query === 'combine' ? model.c : undefined, extras: model.query === 'inverse' ? model.extras : undefined, total: model.query === 'factor' || model.query === 'inverse' ? model.total : undefined });
    case 'sharing': return JSON.stringify({ ...model, second: model.query === 'combined' ? model.second : undefined });
    case 'tree-gaps': return JSON.stringify({ ...model, secondGap: model.hiddenSecond || model.split === model.count - 1 ? undefined : model.secondGap, totalDistance: model.hiddenSecond ? model.totalDistance : undefined });
    case 'queue': return JSON.stringify({ kind: model.kind, query: model.query, front: model.front, back: model.query === 'new-rank' ? undefined : model.back, leave: model.query === 'new-rank' ? model.leave : undefined, join: model.query === 'new-rank' ? model.join : undefined, between: model.query === 'two-people' ? model.between : undefined });
    default: return JSON.stringify(model);
  }
}
function numericChoices(answer: number, guesses: number[], feedback: (value: number) => string, r: Random): Choice[] {
  const distinct = [...new Set([answer, ...guesses].filter(n => Number.isFinite(n) && n >= 0 && Number.isInteger(n)))];
  // Counting one too many/few is a useful near-miss in all numerical domains.
  for (const offset of [-1, 1, -2, 2, -10, 10]) if (distinct.length < 4 && answer + offset >= 0 && !distinct.includes(answer + offset)) distinct.push(answer + offset);
  if (distinct.length < 4) throw new Error('Insufficient distinct numerical choices');
  return r.shuffle(distinct.slice(0, 4)).map(value => ({ id: String(value), label: String(value), feedback: value === answer ? 'Correct.' : feedback(value) }));
}
function finish(type: ProblemType, level: ChallengeLevel, seed: number, model: NumberModel, prompt: string, choices: Choice[], explanation: string, hint: string, drawing?: Diagram): Round {
  return { type, level, seed, model, prompt, choices, correctId: calculate(model), explanation, hint, diagram: drawing, fingerprint: `think-number-v1:${level}:${stableModel(model)}` };
}

function arithmetic(level: ChallengeLevel, seed: number, r: Random): Round {
  const family = r.int(0, 3), op: 1 | -1 = family < 2 ? 1 : -1;
  const a = family === 0 ? 10 * r.int(2, 5) + r.int(1, 4) : family === 1 ? 10 * r.int(1, 3) + r.int(6, 9) : 10 * r.int(5, 9) + r.int(family === 2 ? 5 : 0, family === 2 ? 9 : 3);
  const b = family === 0 ? 10 * r.int(1, 3) + r.int(1, 4) : family === 1 ? 10 * r.int(1, 3) + r.int(6, 9) : 10 * r.int(1, 4) + r.int(family === 2 ? 0 : 6, family === 2 ? 4 : 9);
  const c = level >= 2 ? r.int(3, 18) : 0;
  const op2: 1 | -1 = c > 0 && a + op * b > c + 2 ? r.pick([1, -1]) : 1;
  const missing = level === 1 ? 'b' : level === 3 ? 'a' : 'result';
  const model: ArithmeticModel = { kind: 'arithmetic', a, b, c, op, op2, missing, total: a + op * b + op2 * c, family };
  const result = a + op * b + op2 * c;
  const equation = `${missing === 'a' ? '?' : a} ${symbol(op)} ${missing === 'b' ? '?' : b}${c ? ` ${symbol(op2)} ${c}` : ''} = ${missing === 'result' ? '?' : result}`;
  const answer = Number(calculate(model));
  const explanation = missing === 'result' ? `${a} ${symbol(op)} ${b} = ${a + op * b}.${c ? ` Then ${a + op * b} ${symbol(op2)} ${c} = ${result}.` : ''}` : `Putting ${answer} in the box makes both sides ${result}.`;
  return finish('arithmetic', level, seed, model, 'What number belongs in the box?', numericChoices(answer, [answer + 10, answer - 10, missing === 'result' ? a - op * b + op2 * c : answer + op * 2 * b], v => `${v} does not make the two sides equal. Check the ones, then the tens${c ? ', and both operations' : ''}.`, r), explanation, missing === 'result' ? 'Work from left to right. Trade 10 ones for a ten when needed.' : 'Use the opposite operation to work back to the missing number.', diagram(440, 105, `Equation: ${equation}.`, [textMark(220, 59, equation, 31)]));
}

function pencilDiagram(model: LengthModel, level: ChallengeLevel): Diagram {
  const marks: Mark[] = [], scale = 24, ox = 32, oy = 27;
  if (level < 3) { for (let x = 0; x <= 14; x++) marks.push(line([[ox + x * scale, oy], [ox + x * scale, oy + 12 * scale]], '#cfcabd', 1)); for (let y = 0; y <= 12; y++) marks.push(line([[ox, oy + y * scale], [ox + 14 * scale, oy + y * scale]], '#cfcabd', 1)); }
  model.paths.forEach((p, i) => {
    const points = p.points.map(([x, y]) => [ox + x * scale, oy + y * scale] as Point);
    marks.push(line(points, [CORAL, TEAL, VIOLET, GOLD][i], 10));
    const first = points[0], last = points.at(-1)!;
    marks.push(line([[first[0] - 5, first[1] - 5], [first[0] + 5, first[1] + 5]], INK));
    marks.push({ kind: 'circle', x: last[0], y: last[1], radius: 3, fill: INK });
    marks.push(textMark(first[0] + 2, first[1] - 14, String.fromCharCode(65 + i), 19));
    if (level === 3) for (let j = 1; j < points.length; j++) { const a = points[j - 1], b = points[j]; const n = Math.abs(p.points[j][0] - p.points[j - 1][0]) + Math.abs(p.points[j][1] - p.points[j - 1][1]); marks.push(textMark((a[0] + b[0]) / 2 + (a[0] === b[0] ? 22 : 0), (a[1] + b[1]) / 2 - (a[1] === b[1] ? 14 : 0), i === 1 && j === 2 ? '?' : String(n * model.unit), 19)); }
  });
  marks.push(textMark(200, 343, level === 3 ? 'Lengths in cm · drawing not to scale' : `Each grid step = ${model.unit} cm`, 17));
  return diagram(410, 360, level === 3 ? 'Two bent paths with labeled segment lengths; one segment is unknown.' : 'Labeled lengths start at different positions on a square grid.', marks);
}
function lengthRound(level: ChallengeLevel, seed: number, r: Random): Round {
  let paths: Pencil[];
  if (level < 2) {
    const lengths = r.shuffle([r.int(3, 4), r.int(5, 6), r.int(7, 8), r.int(9, 10)]);
    paths = lengths.map((n, i) => { const start = r.int(0, 3); return { points: i === 3 ? [[13, 1], [13, 1 + n]] : [[start, 1 + i * 4], [start + n, 1 + i * 4]] }; });
  } else if (level === 2) {
    const lengths = r.shuffle([8, 10, 12, 14]);
    paths = lengths.map((n, i) => { const horizontal = r.int(n === 14 ? 5 : 4, 6); const x = i % 2 * 7, y = Math.floor(i / 2) * 6 + 1; return { points: [[x, y], [x + horizontal, y], [x + horizontal, y + (n - horizontal) / 2], [x + horizontal - (n - horizontal) / 2, y + (n - horizontal) / 2]] }; });
  } else {
    const a = r.int(4, 8), b = r.int(2, 4), c = r.int(3, Math.min(7, a + b - 2));
    paths = [{ points: [[1, 1], [1 + a, 1], [1 + a, 1 + b]] }, { points: [[1, 7], [1 + c, 7]] }];
    // The unknown segment is deliberately displayed at a fixed extent: its value must be inferred.
  }
  const model: LengthModel = { kind: 'length', paths, query: level === 1 ? 'difference' : level === 3 ? 'missing' : 'longest', unit: level === 0 || level === 2 ? 1 : r.int(1, 3) };
  const lengths = paths.map(p => pathLength(p) * model.unit), answer = calculate(model);
  const prompt = model.query === 'longest' ? level === 2 ? 'Which bent path is longest from end to end?' : 'Which pencil is longest?' : model.query === 'difference' ? 'How many centimeters longer is the longer of A and B?' : 'Paths A and B have the same total length. How long is the missing segment, in cm?';
  const choices = model.query === 'longest' ? r.shuffle(paths.map((_, i) => ({ id: `path:${i}`, label: String.fromCharCode(65 + i), feedback: `${String.fromCharCode(65 + i)} measures ${lengths[i]} cm. Compare the complete lengths, not where they end.` }))) : numericChoices(Number(answer), model.query === 'difference' ? [lengths[0] + lengths[1], Math.min(...lengths.slice(0, 2)), Math.max(...lengths.slice(0, 2))] : [lengths[0], lengths[0] + Number(answer), Number(answer) + model.unit], () => model.query === 'difference' ? 'Measure each whole length first, then subtract the shorter from the longer.' : 'Add the two known parts of A, then subtract the known part of B.', r);
  const explanation = model.query === 'longest' ? `${String.fromCharCode(65 + Number(answer.split(':')[1]))} is longest at ${Math.max(...lengths)} cm.${level === 2 ? ' Add every straight part of the path.' : ' Count spaces from each start to its end.'}` : model.query === 'difference' ? `${Math.max(lengths[0], lengths[1])} − ${Math.min(lengths[0], lengths[1])} = ${answer} cm.` : `Both paths total ${lengths[0]} cm. The missing part is ${lengths[0]} − ${lengths[1]} = ${answer} cm.`;
  const drawingModel = level === 3 ? { ...model, paths: [paths[0], { points: [paths[1].points[0], paths[1].points[1], [paths[1].points[1][0], 11] as Point] }] } : model;
  const drawing = pencilDiagram(drawingModel, level);
  return finish('length', level, seed, model, prompt, choices, explanation, level === 3 ? 'Equal whole lengths let you find the missing part.' : 'Count the spaces between grid lines, starting at each endpoint.', drawing);
}

function placeValue(level: ChallengeLevel, seed: number, r: Random): Round {
  const n = level < 2 ? 10 * r.int(2, 9) + r.int(1, 9) : 100 * r.int(2, 7) + 10 * r.int(2, 8) + r.int(1, 9);
  const hundreds = level >= 2 ? Math.floor(n / 100) - 1 : 0;
  const tens = level === 0 ? Math.floor(n / 10) : level === 1 ? Math.floor(n / 10) - 1 : level === 2 ? Math.floor(n / 10) % 10 + 10 : Math.floor(n / 10) % 10 + r.int(6, 9);
  const ones = n - hundreds * 100 - tens * 10;
  const query = (['decompose', 'ones', 'tens', 'number'] as const)[level];
  const model: PlaceModel = { kind: 'place-value', n, hundreds, tens, ones, query }, answer = calculate(model);
  let choices: Choice[];
  if (level === 0) {
    const t = Math.floor(n / 10), o = n % 10;
    const pairs = [[t, o], [o, t], [t - 1, o], [t, o + 1], [t + 1, o]].filter(([a, b], i, all) => all.findIndex(([x, y]) => x === a && y === b) === i).slice(0, 4);
    choices = r.shuffle(pairs).map(([tens, ones]) => ({ id: `${tens} tens + ${ones} ones`, label: `${tens} tens + ${ones} ones`, feedback: `That makes ${tens * 10 + ones}. Each ten is worth 10.` }));
  } else choices = numericChoices(Number(answer), [Number(answer) - 10, Number(answer) + 10, level === 3 ? hundreds + tens + ones : n % 10], () => `The units must still total ${n}. One hundred equals 10 tens, and one ten equals 10 ones.`, r);
  const prompt = level === 0 ? `Which shows ${n} as tens and ones?` : level === 1 ? `${n} = ${tens} tens + ? ones` : level === 2 ? `${n} = ${hundreds} hundreds + ? tens + ${ones} ones` : `After exchanging some hundreds and tens, the blocks show ${hundreds} hundreds, ${tens} tens, and ${ones} ones. What was the original number?`;
  const explanation = level === 0 ? `${Math.floor(n / 10)} × 10 + ${n % 10} = ${n}.` : `${hundreds ? `${hundreds} × 100 + ` : ''}${tens} × 10 + ${ones} = ${n}. Exchanging units keeps the total unchanged.`;
  return finish('place-value', level, seed, model, prompt, choices, explanation, 'Count the value of each unit, not just the number of blocks.');
}

function fractionDiagram(panel: FractionPanel, unequal: boolean): Diagram {
  const marks: Mark[] = [];
  if (unequal) {
    const sum = panel.weights.reduce((a, b) => a + b, 0); let y = 15;
    panel.weights.forEach((weight, i) => { const h = weight / sum * 144; marks.push({ kind: 'rect', x: 38, y, width: 144, height: h, fill: panel.shaded[i] ? TEAL : PAPER, stroke: INK }); y += h; });
  } else {
    const columns = panel.weights.length / 2;
    panel.weights.forEach((_, i) => marks.push({ kind: 'rect', x: 20 + i % columns * 180 / columns, y: 25 + Math.floor(i / columns) * 65, width: 180 / columns, height: 65, fill: panel.shaded[i] ? TEAL : PAPER, stroke: INK }));
  }
  return diagram(220, 175, 'A shape divided into shaded and unshaded regions. Compare the shaded area with the whole.', marks);
}
function fractions(level: ChallengeLevel, seed: number, r: Random): Round {
  const target: [number, number] = level === 0 ? [1, 2] : level === 1 ? r.pick([[1, 3], [1, 4]] as [number, number][]) : r.pick([[2, 3], [3, 4], [2, 5], [3, 5]] as [number, number][]);
  const total = level === 0 ? r.pick([6, 8]) : target[1] * (target[1] === 5 ? 2 : level === 3 && target[1] === 3 ? 4 : r.pick([2, 4]));
  const weights = level === 3 ? (total === 8 ? [1, 2, 1, 1, 2, 1] : total === 10 ? [1, 2, 2, 2, 2, 1] : total === 12 ? [1, 3, 2, 2, 3, 1] : [2, 4, 2, 2, 4, 2]) : Array(total).fill(1) as number[];
  const count = weights.length, candidates = r.shuffle(Array.from({ length: (1 << count) - 2 }, (_, i) => i + 1));
  const panels: FractionPanel[] = [];
  for (const mask of candidates) {
    const shaded = Array.from({ length: count }, (_, i) => Boolean(mask & 1 << i));
    const value = weights.reduce((sum, w, i) => sum + (shaded[i] ? w : 0), 0);
    const isAnswer = value * target[1] === total * target[0];
    if (panels.length === 0 && !isAnswer || panels.length > 0 && isAnswer) continue;
    if (level <= 1 && panels.some(p => p.shaded.filter((v, i) => v !== shaded[i]).length < 2)) continue;
    if (panels.length > 0 && Math.abs(value / total - target[0] / target[1]) > 0.4) continue;
    panels.push({ id: `shade:${weights.join('.')}:${mask}`, weights: [...weights], shaded });
    if (panels.length === 4) break;
  }
  if (panels.length !== 4) throw new Error('Fraction candidate pool exhausted');
  const model: FractionModel = { kind: 'fractions', target, panels, unequal: level === 3 };
  const shuffled = r.shuffle(panels);
  const choices = shuffled.map((p, i) => { const [n, d] = fractionValue(p); return { id: p.id, label: `Shape ${String.fromCharCode(65 + i)}`, diagram: fractionDiagram(p, model.unequal), feedback: `This shades ${n} of ${d} equal units of area. Compare area${level === 3 ? ', not the number of pieces' : ''}.` }; });
  return finish('fractions', level, seed, model, `Which shape has ${target[0] === 1 && target[1] === 2 ? 'one half' : `${target[0]}/${target[1]}`} of its area shaded?`, choices, `The shaded area is ${target[0]}/${target[1]} of the whole.${level >= 2 ? ' Equivalent fractions describe the same share of the area.' : ''}`, level === 3 ? 'The pieces are not all equal. Compare their areas.' : 'Count equal parts in the whole, then in the shaded area.');
}

function multiplication(level: ChallengeLevel, seed: number, r: Random): Round {
  const a = r.int(3, 9), b = r.int(3, 9), c = level === 2 ? r.int(2, 8) : 0, extras = level === 3 ? r.int(1, a - 1) : 0;
  const query = (['product', 'factor', 'combine', 'inverse'] as const)[level];
  const model: ProductModel = { kind: 'multiplication', a, b, c, extras, total: a * b + extras, query }, answer = Number(calculate(model));
  const expression = level === 0 ? `${a} × ${b} = ?` : level === 1 ? `${a} × ? = ${a * b}` : level === 2 ? `${a} × ${b} + ${a} × ${c} = ?` : `${a} × ? + ${extras} = ${a * b + extras}`;
  const choices = numericChoices(answer, level === 0 ? [a + b, a * (b - 1), a * (b + 1)] : level === 2 ? [a * b + c, a * (b + c - 1), a * (b + c + 1)] : [b - 1, b + 1, a * b], () => level === 2 ? 'Both groups have the same group size. Multiply both parts before adding.' : level === 3 ? 'Set aside the extra objects, then find the number of equal groups.' : 'Check how many equal groups make the total.', r);
  const explanation = level === 2 ? `${b} groups and ${c} groups make ${b + c} groups of ${a}: ${a * (b + c)}.` : level === 3 ? `Remove ${extras}: ${a * b + extras} − ${extras} = ${a * b}. Then ${a * b} ÷ ${a} = ${b}.` : `${a} groups of ${b} make ${a * b}.`;
  return finish('multiplication', level, seed, model, 'What number belongs in the box?', choices, explanation, level === 3 ? 'Undo the addition before undoing the multiplication.' : 'Think of equal groups.', diagram(440, 110, `Equation: ${expression}.`, [textMark(220, 60, expression, 30)]));
}

function fruitGlyph(shape: number, x: number, y: number): Mark[] {
  if (shape === 0) return [{ kind: 'circle', x: x - 8, y, radius: 16, fill: CORAL, stroke: INK }, { kind: 'circle', x: x + 8, y, radius: 16, fill: CORAL, stroke: INK }, { kind: 'rect', x: x - 8, y: y - 15, width: 16, height: 30, fill: CORAL, stroke: 'none' }, line([[x, y - 14], [x + 4, y - 26]], INK, 3)];
  if (shape === 1) return [{ kind: 'circle', x, y, radius: 22, fill: TEAL, stroke: INK }, line([[x - 9, y - 18], [x - 9, y + 18]], INK, 2), line([[x + 9, y - 18], [x + 9, y + 18]], INK, 2)];
  return [{ kind: 'polygon', points: [[x, y - 22], [x + 11, y - 4], [x + 20, y + 14], [x + 11, y + 22], [x - 11, y + 22], [x - 20, y + 14], [x - 11, y - 4]], fill: GOLD, stroke: INK }, line([[x, y - 22], [x + 3, y - 30]], INK, 3)];
}
function fruitDiagram(model: FruitModel): Diagram {
  const marks: Mark[] = [];
  model.equations.forEach((equation, row) => {
    const tokens: ({ shape: number } | { text: string })[] = [];
    for (const [side, terms] of [[0, equation.left], [1, equation.right]] as const) {
      if (side) tokens.push({ text: '=' });
      const expanded = terms.flatMap(t => Array.from({ length: t.count }, () => t.shape));
      expanded.forEach((shape, i) => { if (i) tokens.push({ text: '+' }); tokens.push({ shape }); });
      if (side && (equation.total || expanded.length === 0)) { if (expanded.length) tokens.push({ text: '+' }); tokens.push({ text: String(equation.total) }); }
    }
    const gap = Math.min(62, 398 / tokens.length), start = 220 - gap * (tokens.length - 1) / 2;
    tokens.forEach((token, i) => { if ('shape' in token) marks.push(...fruitGlyph(token.shape, start + gap * i, 48 + 79 * row)); else marks.push(textMark(start + gap * i, 55 + 79 * row, token.text, 26)); });
  });
  return diagram(440, model.equations.length * 79 + 12, 'Fruit equations. Identical fruit has identical value; different fruits have different values.', marks);
}
function fruitEquations(level: ChallengeLevel, seed: number, r: Random): Round {
  const a = r.int(2, 18), ratio = r.int(2, 3), b = ratio * a, c = b + a + (level >= 2 ? r.int(1, 9) : 0);
  let equations: Equation[];
  if (level === 0) equations = [{ left: [{ shape: 0, count: ratio }], right: [{ shape: 1, count: 1 }], total: 0 }, { left: [{ shape: 0, count: 1 }, { shape: 1, count: 1 }], right: [], total: a + b }];
  else if (level === 1) equations = [{ left: [{ shape: 0, count: ratio }], right: [{ shape: 1, count: 1 }], total: 0 }, { left: [{ shape: 0, count: 1 }, { shape: 1, count: 1 }], right: [{ shape: 2, count: 1 }], total: 0 }, { left: [{ shape: 0, count: 1 }, { shape: 2, count: 1 }], right: [], total: a + c }];
  else equations = [[0, 1], [1, 2], [0, 2]].map(([i, j]) => ({ left: [{ shape: i, count: 1 }, { shape: j, count: 1 }], right: [], total: [a, b, c][i] + [a, b, c][j] }));
  const target = level === 3 ? [{ shape: 2, count: 2 }, { shape: 0, count: -1 }] : [{ shape: level === 0 ? 1 : 2, count: 1 }];
  const model: FruitModel = { kind: 'fruit-equations', equations, target }, answer = Number(calculate(model));
  return finish('fruit-equations', level, seed, model, level === 3 ? 'What is the value of two pears minus one apple?' : `What number does the ${level === 0 ? 'melon' : 'pear'} represent?`, numericChoices(answer, [level === 0 ? a : b, answer + a, answer - a], () => 'Try your value in every equation. The same fruit must keep the same value.', r), `Apple = ${a}; melon = ${b}${level > 0 ? `; pear = ${c}` : ''}.${level === 3 ? ` Two pears minus one apple: ${2 * c} − ${a} = ${answer}.` : ` The ${level === 0 ? 'melon' : 'pear'} is ${answer}.`}`, level < 2 ? 'Replace a fruit with the equal group shown in the first line.' : 'Combine two pair totals, then use the third to separate the fruit values.', fruitDiagram(model));
}

function sharing(level: ChallengeLevel, seed: number, r: Random): Round {
  const people = r.int(3, 9), each = r.int(3, 10), reserve = level === 1 ? r.int(2, 12) : 0, remainder = level >= 2 ? r.int(1, people - 1) : 0, total = people * each + reserve + remainder;
  const second = level === 3 ? people * r.int(2, 7) + r.int(1, people - 1) : 0;
  const model: SharingModel = { kind: 'sharing', people, total, reserve, second, query: level === 2 ? 'remainder' : level === 3 ? 'combined' : 'each' }, answer = Number(calculate(model));
  const prompt = level === 0 ? `Share ${total} cookies equally among ${people} friends. How many does each friend get?` : level === 1 ? `There are ${total} cookies. Set ${reserve} aside, then share the rest equally among ${people} friends. How many does each get?` : level === 2 ? `Share ${total} cookies equally among ${people} friends. Give as many whole cookies as possible. How many cookies are left over?` : `First share ${total} cookies among ${people} friends. Set leftovers aside. Then share ${second} new cookies among the same friends. How many whole cookies does each friend get altogether?`;
  return finish('sharing', level, seed, model, prompt, numericChoices(answer, level === 2 ? [each, people - remainder, remainder + 1] : level === 3 ? [Math.floor((total + second) / people), each, answer + 1] : [each - 1, each + 1, Math.floor(total / people)], () => level >= 2 ? 'Every friend must receive the same whole number of cookies. Keep leftovers separate.' : 'Multiply your share by the number of friends and check it against the cookies available.', r), level === 2 ? `${people} × ${each} = ${people * each}; ${total} − ${people * each} = ${remainder} left over.` : level === 3 ? `Each gets ${each} in the first share and ${Math.floor(second / people)} in the second: ${answer} altogether. The leftovers stay aside.` : `${total}${reserve ? ` − ${reserve} = ${total - reserve}; ${total - reserve}` : ''} ÷ ${people} = ${each}.`, level === 1 ? 'Remove the reserved cookies before dividing.' : 'Make equal groups and keep whole cookies whole.');
}

function treeDiagram(model: TreeModel): Diagram {
  const marks: Mark[] = [], step = 390 / (model.count - 1);
  for (let i = 0; i < model.count; i++) { const x = 25 + step * i; marks.push(line([[x, 61], [x, 98]], INK, 3), { kind: 'polygon', points: [[x, 29], [x + 14, 68], [x - 14, 68]], fill: TEAL, stroke: INK }, textMark(x, 120, String(i + 1), 16)); if (i < model.count - 1) { marks.push(line([[x, 144], [x + step, 144]], INK)); marks.push(textMark(x + step / 2, 170, model.hiddenSecond && i >= model.split ? '?' : String(i < model.split ? model.firstGap : model.secondGap), 15)); } }
  marks.push(textMark(220, 202, 'Gap lengths in meters', 17));
  return diagram(440, 220, 'Numbered trees in a row with distances between neighboring trees.', marks);
}
function treeGaps(level: ChallengeLevel, seed: number, r: Random): Round {
  const count = r.int(6, 10), split = level < 2 ? count - 1 : r.int(2, count - 4), firstGap = r.int(2, 8), secondGap = level < 2 ? firstGap : firstGap + r.int(1, 5), from = level === 0 || level === 2 ? 1 : level === 1 ? r.int(2, count - 3) : split + 2, to = level === 1 ? r.int(from + 2, count) : count;
  const model: TreeModel = { kind: 'tree-gaps', count, split, firstGap, secondGap, from, to, hiddenSecond: level === 3, totalDistance: split * firstGap + (count - 1 - split) * secondGap }, answer = Number(calculate(model));
  const total = split * firstGap + (count - 1 - split) * secondGap;
  const prompt = level < 2 ? `Neighboring trees are ${firstGap} meters apart. How far is it from the ${ordinal(from)} tree to the ${ordinal(to)} tree?` : level === 2 ? `The gap lengths change along the path. How far is it from tree ${from} to tree ${to}, in meters?` : `Tree 1 to tree ${count} is ${total} meters. The unmarked gaps are all equal. How far is it from tree ${from} to tree ${to}?`;
  return finish('tree-gaps', level, seed, model, prompt, numericChoices(answer, [answer + (level < 2 ? firstGap : secondGap), answer - (level < 2 ? firstGap : secondGap), (to - from) * firstGap], () => 'Count gaps, not trees. Include only the spaces between the two named trees.', r), level < 2 ? `${to - from} gaps × ${firstGap} meters = ${answer} meters.` : level === 2 ? `${split} gaps of ${firstGap} m plus ${count - 1 - split} gaps of ${secondGap} m make ${answer} m.` : `The first ${split} gaps use ${split * firstGap} m. The remaining ${total - split * firstGap} m cover ${count - 1 - split} equal gaps, each ${secondGap} m. ${to - from} of those gaps make ${answer} m.`, level === 3 ? 'Subtract the marked part, then divide the remaining length into equal gaps.' : 'Two neighboring trees have one gap between them.', treeDiagram(model));
}

function queueRound(level: ChallengeLevel, seed: number, r: Random): Round {
  const front = r.int(4, 18), back = level === 2 ? 0 : r.int(3, 14), leave = level === 2 ? r.int(1, front - 2) : 0, join = level === 2 ? r.int(1, 6) : 0, between = level === 3 ? r.int(1, 7) : 0;
  const model: QueueModel = { kind: 'queue', front, back, leave, join, between, query: (['total', 'ranks', 'new-rank', 'two-people'] as const)[level] }, answer = Number(calculate(model));
  const prompt = level === 0 ? `There are ${front} people in front of you and ${back} behind you. How many people are in the line?` : level === 1 ? `You are ${ordinal(front)} from the front and ${ordinal(back)} from the back. How many people are in the line?` : level === 2 ? `There are ${front} people in front of you. ${leave} of them leave, then ${join} people join in front of you. What is your new place from the front?` : `Alex is ${ordinal(front)} from the front. Bea is ${ordinal(back)} from the back. Alex is ahead of Bea, with ${between} people between them. How many people are in the line?`;
  const marks: Mark[] = [line([[25, 57], [415, 57]], INK, 2), textMark(35, 25, 'Front', 15), textMark(405, 25, 'Back', 15)];
  if (level < 2) marks.push({ kind: 'circle', x: 220, y: 57, radius: 18, fill: GOLD, stroke: INK }, textMark(220, 99, 'You', 18), textMark(110, 45, level === 0 ? `${front} people` : `${ordinal(front)}`, 18), textMark(330, 45, level === 0 ? `${back} people` : `${ordinal(back)}`, 18));
  else if (level === 2) marks.push(textMark(110, 47, `${front} ahead`, 18), { kind: 'circle', x: 305, y: 57, radius: 18, fill: GOLD, stroke: INK }, textMark(305, 99, 'You', 18), textMark(120, 103, `−${leave} leave   +${join} join`, 17));
  else marks.push({ kind: 'circle', x: 135, y: 57, radius: 17, fill: CORAL, stroke: INK }, { kind: 'circle', x: 305, y: 57, radius: 17, fill: TEAL, stroke: INK }, textMark(135, 97, 'Alex', 18), textMark(305, 97, 'Bea', 18), textMark(220, 41, `${between} between`, 16));
  const explanation = level === 0 ? `${front} + 1 (you) + ${back} = ${answer}.` : level === 1 ? `${front} + ${back} − 1 = ${answer}. Your place is included in both ranks.` : level === 2 ? `${front} − ${leave} + ${join} = ${answer - 1} people ahead, so your place is ${ordinal(answer)}.` : `Alex is counted in the first ${front}; Bea is counted in the last ${back}. Add the ${between} people between: ${front} + ${between} + ${back} = ${answer}.`;
  return finish('queue', level, seed, model, prompt, numericChoices(answer, [answer - 1, answer + 1, level === 2 ? front + leave + join + 1 : front + back], () => level === 1 ? 'Both ranks include you. Do not count yourself twice.' : level === 2 ? 'Leaving reduces the people ahead; joining increases them. Your place also includes you.' : 'Check who is already included in each group and who still needs to be counted.', r), explanation, level === 0 ? 'Remember the person between the front and back groups.' : 'Sketch the line and count each person only once.', diagram(440, 125, 'A line with the named people and their relative positions.', marks));
}

function weightGlyph(shape: number, x: number, y: number, size = 13): Mark[] {
  if (shape === 0) return [{ kind: 'circle', x, y, radius: size, fill: GOLD, stroke: INK }];
  if (shape === 1) return [{ kind: 'circle', x, y, radius: size, fill: VIOLET, stroke: INK }, { kind: 'circle', x: x + size * 0.65, y: y - size * 0.3, radius: size * 0.78, fill: PAPER }];
  if (shape === 2) return [{ kind: 'polygon', points: Array.from({ length: 10 }, (_, i) => { const radius = i % 2 ? size * 0.46 : size; return [x + Math.sin(i * Math.PI / 5) * radius, y - Math.cos(i * Math.PI / 5) * radius] as Point; }), fill: GOLD, stroke: INK }];
  return [{ kind: 'polygon', points: [[x, y + size], [x - size, y], [x - size, y - size * 0.65], [x - size * 0.45, y - size], [x, y - size * 0.5], [x + size * 0.45, y - size], [x + size, y - size * 0.65], [x + size, y]], fill: CORAL, stroke: INK }];
}
function balanceDiagram(model: BalanceModel): Diagram {
  const marks: Mark[] = [line([[220, 8], [220, 43]], INK, 2)];
  const draw = (node: Mobile, x: number, y: number, arm: number): void => {
    if ('shape' in node) { marks.push(...weightGlyph(node.shape, x, y + 17)); if (node.count > 1) marks.push(textMark(x, y + 46, `× ${node.count}`, 17)); return; }
    marks.push(line([[x - arm, y], [x + arm, y]], INK, 4), { kind: 'circle', x, y, radius: 4, fill: INK });
    for (const [child, at] of [[node.left, x - arm], [node.right, x + arm]] as const) { marks.push(line([[at, y], [at, y + 48]], INK, 2)); draw(child, at, y + 48, arm * 0.38); }
    if (node.center) { const cy = y + ('shape' in node.left && 'shape' in node.right ? 105 : 165); marks.push(line([[x, y], [x, cy]], '#657087', 2)); marks.push(...weightGlyph(node.center.shape, x, cy + 15)); if (node.center.count > 1) marks.push(textMark(x, cy + 44, `× ${node.center.count}`, 16)); }
  };
  draw(model.mobile, 220, 43, 112);
  if (model.known.shape === 'whole') marks.push(textMark(220, 334, `Whole mobile: ${model.known.value} oz`, 22));
  else { marks.push(...weightGlyph(model.known.shape, 168, 327)); marks.push(textMark(233, 335, `= ${model.known.value} oz`, 21)); }
  return diagram(440, 355, 'A hanging mobile. Every bar has equal arms and balances. A multiplier shows how many identical shapes hang together. Rods and strings have no weight.', marks);
}
function balance(level: ChallengeLevel, seed: number, r: Random): Round {
  // The generated topology remains equal-armed; center loads affect the parent’s
  // total but do not create torque on their own bar.
  for (let attempt = 0; attempt < 80; attempt++) {
    const circles = r.int(2, 5), hearts = r.int(2, 3), extra = level >= 1 ? r.int(1, 3) : 0, centerStars = level < 2 ? 1 : r.int(1, 2);
    const left: Beam = { left: { shape: 1, count: 1 }, right: { shape: 0, count: circles }, ...(extra ? { center: { shape: 0, count: extra } } : {}) };
    const right: Beam = level < 2 ? { left: { shape: 2, count: 1 }, right: { shape: 3, count: hearts }, ...(centerStars ? { center: { shape: 2, count: centerStars } } : {}) } : { left: { shape: 2, count: 1 }, right: { left: { shape: 3, count: hearts }, right: { shape: 3, count: hearts } }, ...(centerStars ? { center: { shape: 2, count: centerStars } } : {}) };
    const mobile: Beam = { left, right };
    const circle = r.int(1, 12);
    let model: BalanceModel = { kind: 'balance', mobile, known: { shape: 0, value: circle }, target: 3 };
    let values: number[];
    try { values = balanceValues(model); } catch { continue; }
    if (values.some(v => !Number.isInteger(v) || v <= 0 || v > 200)) continue;
    if (level === 3) { const whole = mobileWeights(mobile, 4).reduce((sum, count, i) => sum + count * values[i], 0); model = { ...model, known: { shape: 'whole', value: whole } }; }
    const answer = Number(calculate(model));
    const feedback = 'Each bar balances its two ends. Count every hanging shape, including any shape attached at the center, when weighing the whole branch.';
    return finish('balance', level, seed, model, `Every bar balances; rods and strings weigh nothing. ${level === 3 ? `The whole mobile weighs ${model.known.value} ounces.` : `One circle weighs ${circle} ounces.`} How many ounces does one heart weigh?`, numericChoices(answer, [answer * 2, answer + circle, Math.max(1, answer - circle), values[2]], () => feedback, r), `Moon = ${values[1]} oz; star = ${values[2]} oz; heart = ${values[3]} oz. The two whole branches both weigh ${(2 * circles + extra) * circle} oz.`, 'Work from the smaller bars toward the whole branches. A shape at the center still adds weight to its branch.', balanceDiagram(model));
  }
  throw new Error('Balance generation exhausted 80 candidates');
}

export function generateNumberRound(type: ProblemType, level: ChallengeLevel, seed: number): Round {
  if (!Number.isInteger(seed) || !Number.isFinite(seed) || !Number.isInteger(level) || level < 0 || level > 3) throw new Error('A finite integer seed and level 0–3 are required');
  const r = new Random(seed), factories: Partial<Record<ProblemType, (level: ChallengeLevel, seed: number, random: Random) => Round>> = { arithmetic, length: lengthRound, 'place-value': placeValue, fractions, multiplication, 'fruit-equations': fruitEquations, sharing, 'tree-gaps': treeGaps, queue: queueRound, balance };
  const factory = factories[type]; if (!factory) throw new Error(`Unsupported number type: ${type}`);
  const round = factory(level, seed, r); if (!validateNumberRound(round)) throw new Error(`Invalid generated ${type} round`); return round;
}

export function validateNumberRound(round: Round): boolean {
  try {
    const model = round.model as NumberModel;
    if (!model || model.kind !== round.type || !NUMBER_TYPES.some(t => t.id === model.kind) || !Number.isInteger(round.level) || round.level < 0 || round.level > 3 || round.choices.length !== 4) return false;
    if (new Set(round.choices.map(c => c.id)).size !== 4 || new Set(round.choices.map(c => `${c.label}:${JSON.stringify(c.diagram)}`)).size !== 4) return false;
    const finiteNumbers = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v) : v !== null && typeof v === 'object' ? Object.values(v).every(finiteNumbers) : true;
    if (!finiteNumbers(model)) return false;
    if (model.kind === 'length') { if (model.paths.length !== (round.level === 3 ? 2 : 4) || model.paths.some(p => p.points.length < 2 || p.points.some(p => p.some(n => !Number.isFinite(n))))) return false; const lengths = model.paths.map(pathLength); if (model.query === 'longest' && lengths.filter(n => n === Math.max(...lengths)).length !== 1) return false; if (model.query === 'missing' && (lengths[0] <= lengths[1])) return false; }
    if (model.kind === 'fractions') { if (model.panels.length !== 4 || model.panels.some(p => p.weights.length !== p.shaded.length || p.weights.some(w => !Number.isInteger(w) || w <= 0))) return false; if (round.level <= 1 && model.panels.some((p, i) => model.panels.slice(i + 1).some(q => p.shaded.filter((v, j) => v !== q.shaded[j]).length < 2))) return false; if (model.panels.some(p => !round.choices.some(c => c.id === p.id && JSON.stringify(c.diagram) === JSON.stringify(fractionDiagram(p, model.unequal))))) return false; }
    if (model.kind === 'fruit-equations' && (new Set(fruitValues(model)).size !== fruitValues(model).length || fruitValues(model).some(v => !Number.isInteger(v) || v <= 0))) return false;
    if (model.kind === 'balance' && balanceValues(model).some(v => !Number.isInteger(v) || v <= 0)) return false;
    if (model.kind === 'sharing' && (model.people < 2 || model.total < model.reserve || model.reserve < 0 || model.second < 0)) return false;
    if (model.kind === 'tree-gaps' && (model.from < 1 || model.to > model.count || model.from >= model.to || model.firstGap <= 0 || model.secondGap <= 0)) return false;
    const answer = calculate(model);
    if (answer !== round.correctId || round.choices.filter(c => c.id === answer).length !== 1 || round.fingerprint !== `think-number-v1:${round.level}:${stableModel(model)}`) return false;
    if (model.kind !== 'fractions' && !(model.kind === 'length' && model.query === 'longest') && round.choices.some(c => c.id !== c.label)) return false;
    return true;
  } catch { return false; }
}
