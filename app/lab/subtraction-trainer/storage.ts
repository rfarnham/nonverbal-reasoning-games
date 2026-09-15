import { freshProgress, validProblem, TIERS, type Attempt, type Problem, type Progress, type Session } from "./engine.ts";

export const STORAGE_KEY = "spatial-gym:subtraction-trainer:v1";
type Store = Pick<Storage, "getItem" | "setItem">;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v);
const tier = (v: unknown) => TIERS.includes(v as never);
function problem(v: unknown): v is Problem {
  return object(v) && typeof v.id === "string" && v.id.length < 100 && tier(v.tier) &&
    ["focus", "review", "check", "benchmark"].includes(String(v.purpose)) && validProblem(v as unknown as Problem);
}
function attempt(v: unknown): v is Attempt {
  return object(v) && problem(v.problem) && integer(v.answer) && v.answer <= 999 && finite(v.at) && integer(v.sessionId) &&
    typeof v.correct === "boolean" && v.correct === (v.problem.top - v.problem.bottom === v.answer) &&
    finite(v.elapsedMs) && finite(v.recognitionMs) && (v.firstInkMs === null || finite(v.firstInkMs)) &&
    typeof v.reliable === "boolean" && typeof v.scratch === "boolean";
}
function session(v: unknown): v is Session {
  if (!object(v) || !integer(v.id) || !tier(v.tier) || !["practice", "benchmark"].includes(String(v.kind)) ||
    !Array.isArray(v.plan) || v.plan.length !== (v.kind === "practice" ? 16 : 30) || !v.plan.every(problem) ||
    !integer(v.index) || v.index >= v.plan.length || !["answer", "wrong", "correct"].includes(String(v.phase)) ||
    !Array.isArray(v.results) || !v.results.every(attempt) || v.results.length > v.index + 1 ||
    !integer(v.reviewIndex) || !(v.lastAnswer === null || (integer(v.lastAnswer) && v.lastAnswer <= 999)) ||
    !finite(v.startedAt) || !finite(v.activeMs) || typeof v.complete !== "boolean" || typeof v.promoted !== "boolean") return false;
  if (!Array.isArray(v.ink) || v.ink.length > 128 || !v.ink.every(s => object(s) && Number.isInteger(s.region) &&
    (s.region as number) >= -1 && (s.region as number) <= 2 && Array.isArray(s.points) && s.points.length > 0 && s.points.length <= 512 &&
    s.points.every(p => object(p) && finite(p.x) && p.x <= 360 && finite(p.y) && p.y <= 420))) return false;
  const plan = v.plan as Problem[], results = v.results as Attempt[];
  if (v.starred !== undefined && (!Array.isArray(v.starred) || new Set(v.starred).size !== v.starred.length ||
    !v.starred.every(id => results.some(a => a.problem.id === id)))) return false;
  if (results.length < v.index) return false;
  if (new Set(plan.map(p => `${p.top}-${p.bottom}`)).size !== plan.length || new Set(plan.map(p => p.id)).size !== plan.length) return false;
  if (results.some((a, i) => a.sessionId !== v.id || JSON.stringify(a.problem) !== JSON.stringify(plan[i]))) return false;
  if (v.kind === "practice" && plan.some((p, i) => i >= 8 ? p.purpose !== "check" || p.tier !== v.tier
    : !["focus", "review"].includes(p.purpose) || p.tier > (v.tier as number))) return false;
  if (v.kind === "benchmark" && (v.tier !== 5 || plan.some(p => p.tier !== 5 || p.purpose !== "benchmark"))) return false;
  if (v.review !== null) {
    if (!Array.isArray(v.review) || !v.review.length || !v.review.every(problem) || v.reviewIndex >= v.review.length ||
      JSON.stringify(v.review) !== JSON.stringify(results.filter(a => !a.correct).map(a => a.problem))) return false;
    if (results.length !== v.index + 1 || (v.complete && v.reviewIndex !== v.review.length - 1)) return false;
  } else if (v.reviewIndex !== 0) return false;
  const current = v.review === null ? plan[v.index] : (v.review as Problem[])[v.reviewIndex];
  if (v.review === null && v.phase === "answer" && results.find(a => a.problem.id === current.id)?.correct) return false;
  if (v.phase !== "answer" && (v.lastAnswer === null || (v.phase === "correct") !== (v.lastAnswer === current.top - current.bottom))) return false;
  if (v.phase !== "answer" && !results.some(a => a.problem.id === current.id)) return false;
  if (v.complete && v.phase !== "correct") return false;
  return true;
}
export function parseProgress(raw: string): Progress | null {
  try {
    if (raw.length > 2_000_000) return null;
    const v: unknown = JSON.parse(raw);
    if (!object(v) || v.version !== 1 || typeof v.name !== "string" || !v.name.trim() || v.name.length > 24 ||
      (v.stars !== undefined && !integer(v.stars)) ||
      !integer(v.seed) || v.seed > 4294967295 || !integer(v.nextId) || v.nextId < 1 || !tier(v.unlocked) ||
      !Array.isArray(v.mastered) || !v.mastered.every(tier) || new Set(v.mastered).size !== v.mastered.length ||
      !Array.isArray(v.history) || v.history.length > 2000 || !v.history.every(attempt) ||
      !Array.isArray(v.summaries) || v.summaries.length > 40 || !(v.active === null || session(v.active))) return null;
    const mastered = v.mastered as number[];
    if (mastered.some(t => t > (v.unlocked as number)) ||
      TIERS.some(t => t < (v.unlocked as number) && !mastered.includes(t))) return null;
    if (v.active && (v.active.id >= v.nextId || v.active.tier > (v.unlocked as number))) return null;
    for (const s of v.summaries) {
      if (!object(s) || !integer(s.id) || s.id >= v.nextId || !tier(s.tier) || !["practice", "benchmark"].includes(String(s.kind)) ||
        !finite(s.at) || !integer(s.correct) || !integer(s.total) || s.total > 30 || s.correct > s.total ||
        !finite(s.activeMs) || !(s.meanMs === null || finite(s.meanMs)) || typeof s.promoted !== "boolean") return null;
    }
    // Additive migration: keep existing learning records and start the new star
    // total at zero. Already-solved legacy questions cannot earn replay awards.
    v.stars ??= 0;
    const active = v.active as Session | null;
    if (active && active.starred === undefined) {
      active.starred = active.results.filter((_, i) =>
        active.review !== null || i < active.index || active.phase === "correct").map(a => a.problem.id);
    }
    return v as unknown as Progress;
  } catch { return null; }
}
export function loadProgress(storage: Store | null): { progress: Progress; warning: string; canSave: boolean } {
  try {
    if (!storage) throw new Error("No storage");
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { progress: freshProgress(), warning: "", canSave: true };
    const value = parseProgress(raw);
    if (!value) return { progress: freshProgress(), warning: "Saved progress could not be read. This visit uses temporary progress; the existing save is preserved.", canSave: false };
    return { progress: value, warning: "", canSave: true };
  } catch { return { progress: freshProgress(), warning: "Progress is temporary because this browser cannot save it.", canSave: false }; }
}
export function saveProgress(storage: Store | null, progress: Progress): boolean {
  try { if (!storage) return false; storage.setItem(STORAGE_KEY, JSON.stringify(progress)); return true; }
  catch { return false; }
}
