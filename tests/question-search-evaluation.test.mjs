import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scoreRanking, evaluateCorpus } from "../scripts/evaluate-question-search.mjs";
import { loadSearchCorpus, loadEncryptedSearchFile, parseArgs } from "../scripts/query-question-search.mjs";
import { deriveSearchKey, encryptSearchBytes, sha256 } from "../lib/question-search/crypto.ts";

const judgment = (candidateId, grade, extra = {}) => ({ queryId: "q", queryVersion: "v1", candidateId,
  candidateVersion: "v1", grade, relationship: grade === null ? "uncertain" : grade >= 2 ? "same_method" : "unrelated", ...extra });
const question = (id, family = id) => ({ id, version: "v1", prompt: `Original prompt for ${id}`,
  originalPrompt: "original", family, structure: "Do not leak derived method", method: "Do not use this" });
const corpus = { version: "corpus1", questions: [question("q", "variants"), question("a"), question("b", "variants"), question("c")] };
const benchmark = { schemaVersion: 1, corpusVersion: "corpus1", provenance: "machine-reviewed",
  cases: [{ queryId: "q", queryVersion: "v1", split: "heldout" }], judgments: [judgment("a", 3), judgment("b", 2), judgment("c", 0)] };

test("known-positive recall does not turn unknown or uncertain candidates into negatives", () => {
  const result = scoreRanking(["unknown", "a", "uncertain"], [judgment("a", 3), judgment("b", 2), judgment("uncertain", null)]);
  assert.equal(result.recallAt[20], 0.5);
  assert.equal(result.ndcg10, null);
  assert.deepEqual(result.unjudgedTop10, ["unknown", "uncertain"]);
  assert.equal(result.top10JudgmentCoverage.fraction, 1 / 3);
});

test("fully judged ranking has pool-scoped graded nDCG and respects rank cutoffs", () => {
  const ranked = ["negative", ...Array.from({ length: 19 }, (_, i) => `n${i}`), "a", "b"];
  const labels = [judgment("negative", 0), ...ranked.slice(1, 20).map((id) => judgment(id, 0)), judgment("a", 3), judgment("b", 2)];
  const result = scoreRanking(ranked, labels);
  assert.equal(result.recallAt[20], 0);
  assert.equal(result.recallAt[50], 1);
  assert.equal(result.ndcg10, 0);
  assert.equal(scoreRanking(["a", "b", "negative"], labels).ndcg10, 1);
  assert.equal(scoreRanking(["a", "a"], [judgment("a", 3), judgment("b", 2)]).recallAt[20], 0.5);
});

test("leave-one-out uses original source prompt, hides self, and separates lookup", () => {
  const calls = [];
  const result = evaluateCorpus(corpus, benchmark, (query) => {
    calls.push(query);
    return { hits: corpus.questions.map((question) => ({ question })) };
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, corpus.questions[0].prompt);
  assert.deepEqual(calls[1].excludeIds, ["q"]);
  assert.deepEqual(result.results[0].retrievedIds, ["a", "b", "c"]);
  assert.equal(result.aggregate.recallAt[20], 1);
  assert.equal(result.aggregate.knownQuestionLookup.hitAt1, 1);
});

test("family exclusion removes variants from ranking and positive denominator", () => {
  const result = evaluateCorpus(corpus, benchmark, () => ({ hits: corpus.questions.map((question) => ({ question })) }), { excludeFamily: true });
  assert.equal(result.results[0].knownPositives, 1);
  assert.deepEqual(result.results[0].retrievedIds, ["a", "c"]);
  assert.equal(result.results[0].omitted[0].reason, "excluded_variant_family");
});

test("stale, missing and zero-positive cases are skipped without improving metrics", () => {
  const changed = structuredClone(benchmark);
  changed.judgments = [judgment("a", 3, { candidateVersion: "old" }), judgment("missing", 3), judgment("c", 0)];
  changed.cases.push({ queryId: "unknown", queryVersion: "v1" }, { queryId: "a", queryVersion: "old" });
  const result = evaluateCorpus(corpus, changed, () => ({ hits: [] }));
  assert.equal(result.aggregate.evaluatedQueries, 0);
  assert.equal(result.aggregate.recallAt[20], null);
  assert.deepEqual(result.skipped.map((entry) => entry.reason), ["no_eligible_known_positive", "missing_query", "stale_query"]);
  assert.deepEqual(result.skipped[0].omitted.map((entry) => entry.reason), ["stale_judgment", "missing_candidate"]);
});

test("split selection and malformed label rejection protect held-out evaluations", () => {
  const noCases = evaluateCorpus(corpus, benchmark, () => { throw new Error("should not search"); }, { split: "development" });
  assert.equal(noCases.aggregate.selectedQueries, 0);
  assert.throws(() => scoreRanking([], [judgment("a", 9)]), /grade/);
  assert.throws(() => scoreRanking([], [judgment("a", 3), judgment("a", 2)]), /Duplicate/);
});

test("CLI reads authenticated corpus and benchmark with a password file and rejects tampering", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "question-search-evaluation-"));
  try {
    const version = "0123456789abcdef";
    const encryption = { name: "AES-GCM", kdf: "PBKDF2", hash: "SHA-256", iterations: 100000,
      salt: Buffer.alloc(16, 7).toString("base64") };
    const key = await deriveSearchKey("synthetic-test-only", encryption);
    const indexPath = `index-${version}.bin`;
    const pack = { ...corpus, schemaVersion: 1, version };
    const index = await encryptSearchBytes(new TextEncoder().encode(JSON.stringify(pack)), key, `question-search/v1/${version}/${indexPath}`);
    const labels = await encryptSearchBytes(new TextEncoder().encode(JSON.stringify(benchmark)), key, `question-search/v1/${version}/benchmark.bin`);
    const manifest = { schemaVersion: 1, version, count: pack.questions.length, encryption,
      index: { path: indexPath, bytes: index.length, sha256: await sha256(index) } };
    await writeFile(path.join(directory, indexPath), index);
    await writeFile(path.join(directory, "benchmark.bin"), labels);
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(directory, "password.txt"), "synthetic-test-only\n");
    const args = { manifest: path.join(directory, "manifest.json"), "password-file": path.join(directory, "password.txt") };
    assert.deepEqual(await loadSearchCorpus(args), pack);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(await loadEncryptedSearchFile(args, "benchmark"))), benchmark);
    labels[20] ^= 1;
    await writeFile(path.join(directory, "benchmark.bin"), labels);
    await assert.rejects(loadEncryptedSearchFile(args, "benchmark"), /Unable to unlock/);
    index[20] ^= 1;
    await writeFile(path.join(directory, indexPath), index);
    await assert.rejects(loadSearchCorpus(args), /SHA-256/);
    await assert.rejects(loadSearchCorpus({ ...args, corpus: "another.json" }), /exactly one/);
    assert.throws(() => parseArgs(["--password", "do-not-accept-literals"]), /Unknown option/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
