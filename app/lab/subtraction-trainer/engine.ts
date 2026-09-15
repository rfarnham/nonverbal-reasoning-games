/** Pure, versioned curriculum. Randomness is explicit; answers are always calculated. */
import type { Stroke } from "./ink.ts";
export type Tier = 1 | 2 | 3 | 4 | 5;
export type Pattern = "none" | "ones" | "tens" | "double" | "zero";
export type Purpose = "focus" | "review" | "check" | "benchmark";
export const CONTENT_VERSION = 1;
export const TIERS = [1, 2, 3, 4, 5] as const;
export const TIER_INFO = {
  1: { title: "Single digits", detail: "Single digit − single digit", targetMs: 3000, digits: 1 },
  2: { title: "Across ten", detail: "Numbers under 20 − one digit", targetMs: 4000, digits: 2 },
  3: { title: "Two digits, one step", detail: "Two digits − one digit", targetMs: 5000, digits: 2 },
  4: { title: "Two columns", detail: "Two digits − two digits", targetMs: 6000, digits: 2 },
  5: { title: "Three columns", detail: "Three digits − two digits", targetMs: 7000, digits: 3 },
} as const;
export const PATTERN_NAMES: Record<Pattern, string> = {
  none: "No borrowing", ones: "Borrow into ones", tens: "Borrow into tens",
  double: "Borrow in both columns", zero: "Borrow through zero",
};
export interface Problem {
  id: string; tier: Tier; top: number; bottom: number; purpose: Purpose;
}
export interface Evidence {
  elapsedMs: number; firstInkMs: number | null; recognitionMs: number;
  scratch: boolean; reliable: boolean;
}
export interface Attempt extends Evidence {
  problem: Problem; answer: number; correct: boolean; at: number; sessionId: number;
}
export interface Session {
  id: number; tier: Tier; kind: "practice" | "benchmark"; plan: Problem[];
  index: number; phase: "answer" | "wrong" | "correct";
  results: Attempt[]; review: Problem[] | null; reviewIndex: number;
  lastAnswer: number | null; startedAt: number; activeMs: number;
  complete: boolean; promoted: boolean;
  ink: Stroke[];
}
export interface Summary {
  id: number; tier: Tier; kind: Session["kind"]; at: number; correct: number;
  total: number; activeMs: number; meanMs: number | null; promoted: boolean;
}
export interface Progress {
  version: 1; name: string; seed: number; nextId: number; unlocked: Tier;
  mastered: Tier[]; history: Attempt[]; summaries: Summary[]; active: Session | null;
}

export function freshProgress(seed = 817263): Progress {
  return { version: 1, name: "Player", seed: seed >>> 0, nextId: 1,
    unlocked: 1, mastered: [], history: [], summaries: [], active: null };
}
export function randomSource(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function fingerprint(p: Pick<Problem, "top" | "bottom">): string {
  return `${p.top}-${p.bottom}`;
}
export function features(p: Pick<Problem, "top" | "bottom">) {
  const ones = p.top % 10, lowerOnes = p.bottom % 10;
  const tens = Math.floor(p.top / 10) % 10, lowerTens = Math.floor(p.bottom / 10) % 10;
  const borrowOnes = ones < lowerOnes;
  const effectiveTens = tens - Number(borrowOnes);
  const borrowTens = effectiveTens < lowerTens;
  const pattern: Pattern = borrowOnes && tens === 0 && p.top >= 100 ? "zero"
    : borrowOnes && borrowTens ? "double" : borrowOnes ? "ones" : borrowTens ? "tens" : "none";
  return { pattern, borrowOnes, borrowTens,
    onesFact: `${ones + (borrowOnes ? 10 : 0)}-${lowerOnes}`,
    tensFact: `${effectiveTens + (borrowTens ? 10 : 0)}-${lowerTens}`,
    trivial: p.bottom === 0 || p.top === p.bottom,
  };
}
export function validProblem(p: Problem): boolean {
  if (!Number.isInteger(p.top) || !Number.isInteger(p.bottom) || p.top < p.bottom || p.bottom < 0) return false;
  switch (p.tier) {
    case 1: return p.top >= 1 && p.top <= 9;
    case 2: return p.top >= 10 && p.top <= 19 && p.bottom >= 1 && p.bottom <= 9;
    case 3: return p.top >= 20 && p.top <= 99 && p.bottom >= 1 && p.bottom <= 9;
    case 4: return p.top >= 10 && p.top <= 99 && p.bottom >= 10;
    case 5: return p.top >= 100 && p.top <= 999 && p.bottom >= 10 && p.bottom <= 99;
    default: return false;
  }
}
const pools = new Map<Tier, Problem[]>();
const filteredPools = new Map<string, readonly Problem[]>();
export function problemPool(tier: Tier): readonly Problem[] {
  if (!pools.has(tier)) {
    const pool: Problem[] = [];
    const [lo, hi, subLo, subHi] = tier === 1 ? [1, 9, 0, 9] : tier === 2 ? [10, 19, 1, 9]
      : tier === 3 ? [20, 99, 1, 9] : tier === 4 ? [10, 99, 10, 99] : [100, 999, 10, 99];
    for (let top = lo; top <= hi; top++) for (let bottom = subLo; bottom <= Math.min(top, subHi); bottom++) {
      pool.push({ id: `${tier}:${top}-${bottom}`, tier, top, bottom, purpose: "focus" });
    }
    pools.set(tier, pool);
  }
  return pools.get(tier)!;
}
function candidatePool(tier: Tier, pattern?: Pattern, zeroEnding = false): readonly Problem[] {
  const key = `${tier}:${pattern ?? "all"}:${zeroEnding}`;
  if (!filteredPools.has(key)) filteredPools.set(key, problemPool(tier).filter(p =>
    (pattern === undefined || (features(p).pattern === pattern && !features(p).trivial)) && (!zeroEnding || p.top % 10 === 0)));
  return filteredPools.get(key)!;
}
export function statKeys(p: Problem): string[] {
  const f = features(p);
  return [`fact:${fingerprint(p)}`, `pattern:${p.tier}:${f.pattern}`, `ones:${f.onesFact}`, `tens:${p.tier}:${f.tensFact}`];
}
export function difficultyWeights(history: readonly Attempt[], now: number): Map<string, number> {
  const weights = new Map<string, number>();
  for (const a of history.slice(-600)) {
    const need = !a.correct ? 5 : a.reliable && a.elapsedMs > TIER_INFO[a.problem.tier].targetMs ? 2 : -0.5;
    const recency = Math.exp(-Math.max(0, now - a.at) / (7 * 86400000));
    for (const key of statKeys(a.problem)) weights.set(key, Math.max(0, Math.min(12, (weights.get(key) ?? 0) * 0.9 + need * recency)));
  }
  return weights;
}
function choose(pool: readonly Problem[], random: () => number, weights?: Map<string, number>): Problem {
  if (!pool.length) throw new Error("No valid subtraction problems remain.");
  const score = (p: Problem) => {
    const keys = statKeys(p);
    const targeted = p.tier <= 2 ? (weights?.get(keys[0]) ?? 0)
      : (weights?.get(keys[1]) ?? 0) + (weights?.get(keys[2]) ?? 0) + (weights?.get(keys[3]) ?? 0);
    return (features(p).trivial ? 0.15 : 1) * (1 + targeted);
  };
  if (!weights) return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  // A uniform candidate sample keeps large tiers responsive without losing exploration.
  const sample = pool.length > 256 ? Array.from({ length: 256 }, () => pool[Math.floor(random() * pool.length)]) : pool;
  const scores = sample.map(score);
  let remaining = random() * scores.reduce((a, b) => a + b, 0);
  for (let i = 0; i < sample.length; i++) { remaining -= scores[i]; if (remaining < 0) return sample[i]; }
  return sample[sample.length - 1];
}
const CHECK_PATTERNS: Record<Tier, Pattern[]> = {
  1: Array(8).fill("none"),
  2: ["none", "ones", "ones", "none", "ones", "none", "ones", "ones"],
  3: ["none", "ones", "none", "ones", "ones", "none", "ones", "none"],
  4: ["none", "ones", "ones", "none", "ones", "none", "none", "ones"],
  5: ["none", "ones", "tens", "double", "zero", "ones", "double", "none"],
};
export function createPlan(progress: Progress, tier: Tier, kind: Session["kind"], now: number): Problem[] {
  const random = randomSource(progress.seed ^ Math.imul(progress.nextId, 2654435761));
  const used = new Set<string>();
  const plan: Problem[] = [];
  const weights = difficultyWeights(progress.history, now);
  const add = (t: Tier, purpose: Purpose, pattern?: Pattern, preferZero = false) => {
    const source = candidatePool(t, pattern, preferZero);
    let candidates: readonly Problem[];
    if (source.length > 512) {
      const sample: Problem[] = [];
      for (let attempt = 0; sample.length < 256 && attempt < 1024; attempt++) {
        const p = source[Math.floor(random() * source.length)];
        if (!used.has(fingerprint(p))) sample.push(p);
      }
      candidates = sample.length ? sample : source.filter(p => !used.has(fingerprint(p)));
    } else candidates = source.filter(p => !used.has(fingerprint(p)));
    const p = choose(candidates, random, purpose === "focus" ? weights : undefined);
    used.add(fingerprint(p));
    plan.push({ ...p, purpose, id: `${progress.nextId}:${plan.length}:${fingerprint(p)}` });
  };
  if (kind === "benchmark") {
    const patterns: Pattern[] = ["none", "ones", "tens", "double", "zero"];
    for (let i = 0; i < 30; i++) add(5, "benchmark", patterns[i % 5]);
  } else {
    for (let i = 0; i < 8; i++) {
      const reviewTier: Tier = tier === 3 ? 2 : Math.max(1, tier - 1) as Tier;
      if (tier > 1 && (i === 2 || i === 6)) {
        // Return to previously observed weaknesses after a gap, including older tiers.
        const due = progress.history.filter(a => a.problem.tier < tier &&
          (!a.correct || (a.reliable && !meetsTarget(a.problem.tier, a.elapsedMs))) &&
          now - a.at >= 60000 && !used.has(fingerprint(a.problem)));
        if (due.length) {
          const previous = due[Math.floor(random() * due.length)].problem;
          used.add(fingerprint(previous));
          plan.push({ ...previous, purpose: "review", id: `${progress.nextId}:${plan.length}:${fingerprint(previous)}` });
          continue;
        }
      }
      add(tier > 1 && (i === 2 || i === 6) ? reviewTier : tier,
        tier > 1 && (i === 2 || i === 6) ? "review" : "focus");
    }
    // The check is sampled independently of weakness weights and covers each taught pattern.
    const patterns = [...CHECK_PATTERNS[tier]];
    for (let i = patterns.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [patterns[i], patterns[j]] = [patterns[j], patterns[i]];
    }
    let usedZero = false;
    for (const pattern of patterns) {
      const preferZero = (tier === 3 || tier === 4) && pattern === "ones" && !usedZero;
      add(tier, "check", pattern, preferZero);
      if (preferZero) usedZero = true;
    }
  }
  return plan;
}
export function beginSession(progress: Progress, tier: Tier, kind: Session["kind"], now: number): Progress {
  if (progress.active && !progress.active.complete) return progress;
  if (!TIERS.includes(tier) || tier > progress.unlocked || (kind === "benchmark" && !progress.mastered.includes(5))) return progress;
  const plan = createPlan(progress, tier, kind, now);
  return { ...progress, nextId: progress.nextId + 1, active: {
    id: progress.nextId, tier, kind, plan, index: 0, phase: "answer", results: [], review: null,
    reviewIndex: 0, lastAnswer: null, startedAt: now, activeMs: 0, complete: false, promoted: false, ink: [],
  } };
}
export function currentProblem(s: Session): Problem {
  return s.review ? s.review[s.reviewIndex] : s.plan[s.index];
}
export function meetsTarget(tier: Tier, ms: number): boolean {
  return tier <= 2 ? ms <= TIER_INFO[tier].targetMs : ms < TIER_INFO[tier].targetMs;
}
export function gatePassed(s: Session): boolean {
  if (s.kind !== "practice" || s.index !== s.plan.length - 1 || s.phase !== "correct") return false;
  const checks = s.results.filter(a => a.problem.purpose === "check");
  return checks.length === 8 && checks.every(a => a.correct && a.reliable && meetsTarget(s.tier, a.elapsedMs));
}
export function recordAnswer(progress: Progress, answer: number, evidence: Evidence, at: number): Progress {
  const s = progress.active;
  if (!s || s.complete || s.phase !== "answer" || !Number.isInteger(answer) || answer < 0 || answer > 999 ||
      !Number.isFinite(evidence.elapsedMs) || evidence.elapsedMs < 0 || !Number.isFinite(evidence.recognitionMs) || evidence.recognitionMs < 0) return progress;
  const problem = currentProblem(s);
  const correct = answer === problem.top - problem.bottom;
  const first = !s.review && !s.results.some(a => a.problem.id === problem.id);
  const attempt: Attempt = { ...evidence, problem, answer, correct, at, sessionId: s.id };
  return { ...progress, history: first ? [...progress.history, attempt].slice(-2000) : progress.history,
    active: { ...s, phase: correct ? "correct" : "wrong", lastAnswer: answer,
      results: first ? [...s.results, attempt] : s.results } };
}
export function retryAnswer(progress: Progress): Progress {
  return progress.active?.phase === "wrong" ? { ...progress, active: { ...progress.active, phase: "answer", ink: progress.active.ink.filter(s => s.region === -1) } } : progress;
}
function finish(progress: Progress, at: number): Progress {
  const s = progress.active!;
  const passed = gatePassed(s);
  const newMastery = passed && !progress.mastered.includes(s.tier);
  const reliable = s.results.filter(a => a.reliable);
  const summary: Summary = { id: s.id, tier: s.tier, kind: s.kind, at,
    correct: s.results.filter(a => a.correct).length, total: s.results.length,
    activeMs: s.activeMs, meanMs: reliable.length ? reliable.reduce((n, a) => n + a.elapsedMs, 0) / reliable.length : null,
    promoted: newMastery };
  return { ...progress, unlocked: newMastery ? Math.max(progress.unlocked, Math.min(5, s.tier + 1)) as Tier : progress.unlocked,
    mastered: newMastery ? [...progress.mastered, s.tier] : progress.mastered,
    summaries: [...progress.summaries.filter(r => r.id !== s.id), summary].slice(-40),
    active: { ...s, complete: true, promoted: newMastery } };
}
export function advance(progress: Progress, at: number, endEarly = false): Progress {
  const s = progress.active;
  if (!s || s.complete || s.phase !== "correct") return progress;
  if (s.review) {
    if (s.reviewIndex + 1 === s.review.length) return finish(progress, at);
    return { ...progress, active: { ...s, reviewIndex: s.reviewIndex + 1, phase: "answer", lastAnswer: null, ink: [] } };
  }
  if (!endEarly && s.index + 1 < s.plan.length) {
    return { ...progress, active: { ...s, index: s.index + 1, phase: "answer", lastAnswer: null, ink: [] } };
  }
  const review = s.results.filter(a => !a.correct).map(a => a.problem);
  if (review.length) return { ...progress, active: { ...s, review, phase: "answer", lastAnswer: null, ink: [] } };
  return finish(progress, at);
}
export function addActiveTime(progress: Progress, ms: number): Progress {
  if (!progress.active || progress.active.complete || !Number.isFinite(ms) || ms < 0) return progress;
  return { ...progress, active: { ...progress.active, activeMs: progress.active.activeMs + ms } };
}
/** Only exact local relations are described; errors are never diagnosed from one guess. */
export function explain(p: Problem): string[] {
  const f = features(p);
  const lines: string[] = [];
  const ones = p.top % 10, lowerOnes = p.bottom % 10;
  let tens = Math.floor(p.top / 10) % 10;
  let hundreds = Math.floor(p.top / 100);
  if (f.pattern === "zero") { lines.push("Trade 1 hundred for 10 tens. Then trade 1 ten for 10 ones."); hundreds--; tens = 10; }
  else if (f.borrowOnes) lines.push("Trade 1 ten for 10 ones.");
  if (f.borrowOnes) tens--;
  lines.push(`Ones: ${ones + (f.borrowOnes ? 10 : 0)} − ${lowerOnes} = ${(p.top - p.bottom) % 10}.`);
  const lowerTens = Math.floor(p.bottom / 10) % 10;
  if (tens < lowerTens) { lines.push("Trade 1 hundred for 10 tens."); hundreds--; tens += 10; }
  if (p.top >= 10) lines.push(`Tens: ${tens} − ${lowerTens} = ${tens - lowerTens}.`);
  if (p.top >= 100) lines.push(`Hundreds: ${hundreds}.`);
  return lines;
}
export function differenceFeedback(p: Problem, answer: number): string {
  const expected = p.top - p.bottom;
  const places = ["ones", "tens", "hundreds"];
  const differences = places.filter((_, i) => Math.floor(expected / 10 ** i) % 10 !== Math.floor(answer / 10 ** i) % 10);
  return `Check the ${differences.join(" and ")} ${differences.length === 1 ? "column" : "columns"}.`;
}
