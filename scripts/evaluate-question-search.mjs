import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CUTOFFS = [20, 50, 100];

/** Evaluate known judgments only. Missing and uncertain labels are never negatives. */
export function scoreRanking(rankedIds, judgments) {
  const ranking = [...new Set(rankedIds)];
  const definite = new Map();
  for (const judgment of judgments) {
    if (judgment.grade === null || judgment.relationship === "uncertain") continue;
    if (!Number.isInteger(judgment.grade) || judgment.grade < 0 || judgment.grade > 3) {
      throw new Error("Judgment grade must be null or an integer from 0 to 3.");
    }
    if (definite.has(judgment.candidateId)) throw new Error("Duplicate candidate judgment.");
    definite.set(judgment.candidateId, judgment.grade);
  }
  const positives = [...definite].filter(([, grade]) => grade >= 2).map(([id]) => id);
  const recall = Object.fromEntries(CUTOFFS.map((k) => [k, positives.length
    ? positives.filter((id) => ranking.slice(0, k).includes(id)).length / positives.length
    : null]));
  const top = ranking.slice(0, 10);
  const judged = top.filter((id) => definite.has(id)).length;
  const dcg = (grades) => grades.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
  const ideal = dcg([...definite.values()].sort((a, b) => b - a).slice(0, 10));
  // With incomplete top-rank judgments, numerical nDCG would treat unknowns as bad.
  const ndcg10 = judged === top.length && ideal > 0
    ? dcg(top.map((id) => definite.get(id))) / ideal : null;
  return {
    knownPositives: positives.length,
    recallAt: recall,
    strongCandidateFound: positives.some((id) => ranking.includes(id)),
    ndcg10,
    ndcgScope: "Known judgment pool; reported only when every returned top-ten result is judged.",
    top10JudgmentCoverage: { judged, returned: top.length, fraction: top.length ? judged / top.length : null },
    unjudgedTop10: top.filter((id) => !definite.has(id)),
  };
}

function mean(values) {
  const present = values.filter((value) => value !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

/** Search is injected so evaluation rules can be tested without a particular engine. */
export function evaluateCorpus(corpus, benchmark, search, { mode = "hybrid", excludeFamily = false, split } = {}) {
  if (benchmark.schemaVersion !== 1 || !Array.isArray(benchmark.judgments) || !Array.isArray(benchmark.cases)) {
    throw new Error("Expected a version 1 benchmark with cases and judgments.");
  }
  const questions = new Map(corpus.questions.map((question) => [question.id, question]));
  const cases = benchmark.cases.filter((entry) => !split || entry.split === split);
  const results = [];
  const skipped = [];
  const lookup = [];
  const seen = new Set();
  for (const entry of cases) {
    if (seen.has(entry.queryId)) throw new Error("Duplicate benchmark query.");
    seen.add(entry.queryId);
    const query = questions.get(entry.queryId);
    if (!query) { skipped.push({ queryId: entry.queryId, reason: "missing_query" }); continue; }
    if (entry.queryVersion !== query.version) { skipped.push({ queryId: entry.queryId, reason: "stale_query" }); continue; }
    // prompt is source text (possibly translated), never structure/method/description.
    const text = query.prompt || query.originalPrompt;
    if (!text.trim()) { skipped.push({ queryId: entry.queryId, reason: "empty_prompt" }); continue; }
    const exact = search({ text, mode, limit: 100, offset: 0 });
    const exactIds = exact.hits.map((hit) => hit.question.id);
    const position = exactIds.indexOf(query.id);
    lookup.push({ queryId: query.id, rank: position < 0 ? null : position + 1,
      hitAt1: position === 0, hitAt10: position >= 0 && position < 10 });

    const excludedFamily = excludeFamily && query.family ? query.family : undefined;
    const eligible = [];
    const omitted = [];
    for (const judgment of benchmark.judgments.filter((item) => item.queryId === query.id)) {
      const candidate = questions.get(judgment.candidateId);
      let reason;
      if (!candidate) reason = "missing_candidate";
      else if (judgment.queryVersion !== query.version || judgment.candidateVersion !== candidate.version) reason = "stale_judgment";
      else if (candidate.id === query.id) reason = "query_self";
      else if (excludedFamily && candidate.family === excludedFamily) reason = "excluded_variant_family";
      if (reason) omitted.push({ candidateId: judgment.candidateId, reason });
      else eligible.push(judgment);
    }
    const response = search({ text, mode, limit: 100, offset: 0,
      excludeIds: [query.id], ...(excludedFamily ? { excludeFamily: excludedFamily } : {}) });
    // Also enforce exclusion here so an engine bug cannot inflate reported coverage.
    const ids = response.hits.map((hit) => hit.question.id).filter((id) => {
      const candidate = questions.get(id);
      return candidate && id !== query.id && (!excludedFamily || candidate.family !== excludedFamily);
    });
    const score = scoreRanking(ids, eligible);
    if (!score.knownPositives) {
      skipped.push({ queryId: query.id, reason: "no_eligible_known_positive", omitted });
      continue;
    }
    results.push({ queryId: query.id, split: entry.split, ...score, omitted, retrievedIds: ids });
  }
  return {
    schemaVersion: 1,
    corpusVersion: corpus.version,
    benchmarkCorpusVersion: benchmark.corpusVersion,
    benchmarkProvenance: benchmark.provenance,
    mode, excludeFamily, split: split ?? "all",
    scope: "Recall against independently judged known positives (grades 2–3), not exhaustive corpus recall. Known-question lookup is a separate text-only diagnostic.",
    aggregate: {
      selectedQueries: cases.length, evaluatedQueries: results.length, skippedQueries: skipped.length,
      recallAt: Object.fromEntries(CUTOFFS.map((k) => [k, mean(results.map((result) => result.recallAt[k]))])),
      queriesWithoutStrongCandidate: results.filter((result) => !result.strongCandidateFound).length,
      ndcg10: mean(results.map((result) => result.ndcg10)),
      ndcgEvaluatedQueries: results.filter((result) => result.ndcg10 !== null).length,
      top10JudgmentCoverage: mean(results.map((result) => result.top10JudgmentCoverage.fraction)),
      knownQuestionLookup: { queries: lookup.length, hitAt1: mean(lookup.map((entry) => Number(entry.hitAt1))),
        hitAt10: mean(lookup.map((entry) => Number(entry.hitAt10))) },
    }, results, skipped, lookup,
  };
}

async function main() {
  const { parseArgs, loadSearchCorpus, loadEncryptedSearchFile } = await import("./query-question-search.mjs");
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.corpus && !args.manifest)) {
    console.log("Usage: node scripts/evaluate-question-search.mjs --corpus <private.json> --judgments <private-benchmark.json> [--mode hybrid|text|strategy|visual] [--exclude-family] [--split development|heldout]\nEncrypted input: --manifest <manifest.json> --password-file <private-password-file> (or QUESTION_SEARCH_PASSWORD). Without --judgments, decrypts sibling benchmark.bin in memory.\nPrints JSON metrics; redirect only to a private output path.");
    return;
  }
  if (!args.judgments && !args.manifest) throw new Error("--judgments is required for plaintext corpus input.");
  const corpus = await loadSearchCorpus(args);
  const benchmark = JSON.parse(args.judgments ? await readFile(args.judgments, "utf8")
    : new TextDecoder().decode(await loadEncryptedSearchFile(args, "benchmark")));
  const { QuestionSearchIndex } = await import("../lib/question-search/engine.ts");
  const index = new QuestionSearchIndex(corpus);
  console.log(JSON.stringify(evaluateCorpus(corpus, benchmark, (query) => index.search(query), {
    mode: args.mode ?? "hybrid", excludeFamily: Boolean(args["exclude-family"]), split: args.split,
  }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
