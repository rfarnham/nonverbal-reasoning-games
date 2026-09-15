import assert from "node:assert/strict";
import test from "node:test";
import { advance, beginSession, createPlan, currentProblem, difficultyWeights, explain, features, fingerprint, freshProgress, meetsTarget,
  recordAnswer, retryAnswer, TIERS, TIER_INFO, validProblem } from "../app/lab/subtraction-trainer/engine.ts";
import { loadProgress, parseProgress, saveProgress, STORAGE_KEY } from "../app/lab/subtraction-trainer/storage.ts";
import { answerSlots, columnCenter, inkRegion } from "../app/lab/subtraction-trainer/ink.ts";

const now = 1700000000000;
const fast = { elapsedMs: 1500, firstInkMs: 700, recognitionMs: 600, scratch: false, reliable: true };
function solve(p, options = {}) {
  const s = p.active, q = currentProblem(s);
  const wrong = !s.review && options.wrongAt === s.index;
  const evidence = !s.review && options.unreliableAt === s.index ? { ...fast, reliable: false }
    : !s.review && options.slowAt === s.index ? { ...fast, elapsedMs: 12000 } : fast;
  p = recordAnswer(p, q.top - q.bottom + Number(wrong), evidence, now);
  if (wrong) p = recordAnswer(retryAnswer(p), q.top - q.bottom, fast, now + 5000);
  return advance(p, now + 10000);
}
function finishSession(p, options = {}) { let count = 0; while (!p.active.complete) { p = solve(p, options); assert.ok(++count < 60); } return p; }
function unlocked(tier, seed = 17) { return { ...freshProgress(seed), unlocked: tier, mastered: TIERS.filter(t => t < tier) }; }

test("400 seeds per tier: deterministic, legal, distinct questions and representative independent checks", () => {
  for (const tier of TIERS) {
    const observed = new Set();
    for (let seed = 0; seed < 400; seed++) {
      const p = unlocked(tier, seed), plan = createPlan(p, tier, "practice", now);
      assert.equal(plan.length, 16);
      assert.equal(new Set(plan.map(fingerprint)).size, 16);
      assert.ok(plan.every(validProblem));
      const checks = plan.slice(-8);
      assert.ok(checks.every(q => q.tier === tier && q.purpose === "check" && !features(q).trivial));
      checks.forEach(q => observed.add(features(q).pattern));
      if (tier === 5) assert.equal(new Set(checks.map(q => features(q).pattern)).size, 5);
      if (tier === 3 || tier === 4) assert.ok(checks.some(q => q.top % 10 === 0));
      if (seed === 8) assert.deepEqual(plan, createPlan(p, tier, "practice", now));
    }
    assert.ok(observed.has("none"));
    if (tier > 1) assert.ok(observed.has("ones"));
  }
});
test("all five tiers advance only at completed checkpoints; benchmark leaves mastery unchanged", () => {
  let p = freshProgress();
  for (const tier of TIERS) {
    p = beginSession(p, tier, "practice", now);
    assert.equal(p.active.tier, tier);
    p = finishSession(p);
    assert.equal(p.active.promoted, true);
    assert.deepEqual(p.mastered, TIERS.filter(t => t <= tier));
    assert.equal(p.unlocked, Math.min(5, tier + 1));
    assert.deepEqual(parseProgress(JSON.stringify(p)), p);
  }
  p = beginSession(p, 5, "benchmark", now);
  assert.equal(p.active.plan.length, 30);
  const counts = Object.groupBy(p.active.plan, q => features(q).pattern);
  assert.ok(Object.values(counts).every(items => items.length === 6));
  p = finishSession(p);
  assert.equal(p.active.promoted, false);
  assert.equal(p.summaries.at(-1).kind, "benchmark");
});
test("slow, wrong, or uncertain check attempts cannot be repaired into a promotion", () => {
  for (const options of [{ wrongAt: 12 }, { unreliableAt: 12 }, { slowAt: 12 }]) {
    let p = beginSession(freshProgress(), 1, "practice", now);
    p = finishSession(p, options);
    assert.equal(p.unlocked, 1); assert.equal(p.active.promoted, false);
    assert.equal(p.active.results.length, 16); assert.equal(p.history.length, 16);
    assert.equal(p.active.results[12].correct, !options.wrongAt);
    assert.deepEqual(parseProgress(JSON.stringify(p)), p);
  }
});
test("a focus mistake can be redeemed without rewriting history or blocking a later successful check", () => {
  let p = finishSession(beginSession(freshProgress(), 1, "practice", now), { wrongAt: 2 });
  assert.equal(p.unlocked, 2); assert.equal(p.active.results[2].correct, false);
  assert.equal(p.active.review.length, 1); assert.equal(p.summaries[0].correct, 15);
  const unchanged = advance(p, now);
  assert.deepEqual(unchanged, p);
  p = finishSession(beginSession(p, 1, "practice", now));
  assert.equal(p.active.promoted, false); assert.deepEqual(p.mastered, [1]);
});
test("early finish reviews only observed misses and never grants a tier", () => {
  let p = beginSession(freshProgress(), 1, "practice", now);
  const q = currentProblem(p.active);
  p = recordAnswer(p, q.top - q.bottom + 1, fast, now);
  assert.equal(advance(p, now).active.phase, "wrong");
  p = recordAnswer(retryAnswer(p), q.top - q.bottom, fast, now);
  p = advance(p, now, true);
  assert.equal(p.active.review.length, 1);
  p = solve(p);
  assert.equal(p.active.complete, true); assert.equal(p.unlocked, 1);
  assert.equal(p.summaries.at(-1).total, 1);
});
test("double submission, locked tiers, and benchmark shortcuts cannot affect a session", () => {
  let p = freshProgress();
  assert.equal(beginSession(p, 5, "practice", now), p);
  assert.equal(beginSession(p, 1, "benchmark", now), p);
  p = beginSession(p, 1, "practice", now);
  assert.equal(beginSession(p, 1, "practice", now), p);
  const q = currentProblem(p.active);
  p = recordAnswer(p, q.top - q.bottom, fast, now);
  assert.equal(recordAnswer(p, 999, fast, now), p);
  assert.equal(p.history.length, 1);
});
test("threshold boundaries honor at most for tiers 1–2 and under for tiers 3–5", () => {
  for (const t of TIERS) {
    assert.equal(meetsTarget(t, TIER_INFO[t].targetMs), t <= 2);
    assert.ok(meetsTarget(t, TIER_INFO[t].targetMs - 1));
    assert.equal(meetsTarget(t, TIER_INFO[t].targetMs + 1), false);
  }
});
test("borrowing features execute sequentially, including through-zero and a second borrow", () => {
  for (const [top, bottom, pattern, onesFact, tensFact] of [[386,42,"none","6-2","8-4"], [352,27,"ones","12-7","4-2"],
    [324,51,"tens","4-1","12-5"], [332,57,"double","12-7","12-5"], [302,57,"zero","12-7","9-5"]]) {
    assert.deepEqual(features({ top, bottom }).pattern, pattern);
    assert.equal(features({ top, bottom }).onesFact, onesFact); assert.equal(features({ top, bottom }).tensFact, tensFact);
    assert.ok(explain({ top, bottom }).every(s => !/undefined|NaN|Tens: -/.test(s)));
  }
});
test("weak facts raise sampling priority, while later successes reduce it", () => {
  const problem = { id: "x", top: 9, bottom: 7, tier: 1, purpose: "focus" };
  const miss = { ...fast, problem, answer: 3, correct: false, at: now, sessionId: 1 };
  const key = "fact:9-7";
  assert.ok(difficultyWeights([miss], now).get(key) > 0);
  assert.ok(difficultyWeights([miss, ...Array(12).fill({ ...miss, answer: 2, correct: true })], now).get(key) < difficultyWeights([miss], now).get(key));
  const previous = { ...unlocked(2), history: [miss] };
  assert.ok(createPlan(previous, 2, "practice", now + 86400000).some(p => p.purpose === "review" && fingerprint(p) === "9-7"));
});
test("resume validation accepts every transition and rejects incorrect arithmetic and skipped questions", () => {
  let p = beginSession(freshProgress(), 1, "practice", now);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual(parseProgress(JSON.stringify(p)), p);
    const q = currentProblem(p.active);
    p = recordAnswer(p, q.top - q.bottom, fast, now);
    assert.deepEqual(parseProgress(JSON.stringify(p)), p);
    p = advance(p, now);
  }
  for (const corrupt of [s => s.active.plan[0].bottom = 100, s => s.active.index = 900, s => s.active.results[0].correct = false,
    s => s.version = 22, s => s.active.ink = [{ region: 8, points: [] }], s => s.history[0].elapsedMs = -1]) {
    const copy = structuredClone(p); corrupt(copy); assert.equal(parseProgress(JSON.stringify(copy)), null);
  }
  const skipped = beginSession(freshProgress(), 1, "practice", now); skipped.active.index = 3;
  assert.equal(parseProgress(JSON.stringify(skipped)), null);
});
test("blocked, quota-limited, corrupt, and unsupported storage degrade safely without overwriting", () => {
  const store = new Map(); const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(loadProgress(storage).canSave, true);
  assert.ok(saveProgress(storage, freshProgress())); assert.equal(loadProgress(storage).progress.name, "Player");
  storage.setItem(STORAGE_KEY, '{"version":99}');
  assert.equal(loadProgress(storage).canSave, false); assert.equal(store.get(STORAGE_KEY), '{"version":99}');
  assert.equal(loadProgress(null).canSave, false);
  assert.equal(saveProgress({ setItem: () => { throw Error("Quota"); } }, freshProgress()), false);
});
test("scratch ink is excluded and answer slots support any right-aligned answer length", () => {
  const stroke = region => ({ region, points: [{ x: 180, y: 300 }] });
  assert.deepEqual(answerSlots([stroke(-1), stroke(2)], 3), [2]);
  assert.deepEqual(answerSlots([stroke(1), stroke(2)], 3), [1, 2]);
  assert.equal(answerSlots([stroke(0), stroke(2)], 3), null);
  assert.equal(answerSlots([stroke(-1)], 3), null);
  assert.equal(inkRegion({ x: columnCenter(0, 3), y: 100 }, 3), -1);
  assert.equal(inkRegion({ x: columnCenter(2, 3), y: 300 }, 3), 2);
});
