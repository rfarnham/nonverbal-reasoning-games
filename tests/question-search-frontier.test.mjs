import assert from "node:assert/strict";
import test from "node:test";
import { validateFrontierTask, parseFrontierOutput, FRONTIER_LIMITS } from "../lib/question-search/frontier-protocol.ts";
import { companionBase, frontierHttpRequest, generateFrontier, mergeFrontierCandidates, applyFrontierRankings, runFrontierSearch } from "../lib/question-search/frontier.ts";

const understanding = { summary: "Count unordered pairs.", strategies: ["combinatorial counting"], searches: ["unordered pairs", "handshake combinations", "choose two", "complete graph edges"], uncertainties: [] };
const task = { version: 1, stage: "understand", text: "How many handshakes among five people?", images: [] };
const connection = { kind: "companion", url: "http://localhost:4318", token: "test-secret" };
const signal = () => new AbortController().signal;
const hit = (id) => ({ question: { id, prompt: `Question ${id}`, originalPrompt: "", options: ["3", "6"], answer: "6", answerStatus: "verified", structure: "Pairs of objects", method: "Choose two", annotationStatus: "draft" }, score: 1, reasons: [], signals: { text: 1, strategy: 0, structure: 0, visual: 0 } });
const response = (ids) => ({ hits: ids.map(hit), total: ids.length, query: { text: "pairs" } });

test("frontier protocol accepts only bounded data, embedded images, and known output fields", () => {
  assert.deepEqual(validateFrontierTask(task), task);
  for (const invalid of [
    { ...task, command: "open files" }, { ...task, stage: "execute" },
    { ...task, text: "x".repeat(FRONTIER_LIMITS.text + 1) },
    { ...task, images: [{ label: "remote", dataUrl: "https://example.com/image.png" }] },
    { ...task, images: [{ label: "svg", dataUrl: "data:image/svg+xml;base64,AAAA" }] },
  ]) assert.throws(() => validateFrontierTask(invalid));
  assert.deepEqual(parseFrontierOutput("understand", `\x60\x60\x60json\n${JSON.stringify(understanding)}\n\x60\x60\x60`), understanding);
  assert.throws(() => parseFrontierOutput("understand", JSON.stringify({ ...understanding, searches: [] })));
  assert.throws(() => parseFrontierOutput("understand", JSON.stringify({ ...understanding, searches: Array(5).fill("pairs") })));
  assert.throws(() => parseFrontierOutput("understand", JSON.stringify({ ...understanding, command: "run" })));
  const judgment = { id: "q1", relationship: "same_method", reason: "Both count pairs." };
  assert.throws(() => parseFrontierOutput("rerank", JSON.stringify({ rankings: [judgment, judgment] })));
  assert.throws(() => parseFrontierOutput("rerank", JSON.stringify({ rankings: [{ ...judgment, relationship: "perfect" }] })));
});

test("transports keep credentials in headers and expose only fixed provider endpoints", () => {
  const withImage = { ...task, images: [{ label: "Original", dataUrl: "data:image/png;base64,AAAA" }] };
  for (const provider of ["openai", "gemini"]) {
    const request = frontierHttpRequest({ kind: "api", provider, apiKey: "private-api-key", model: "vision-model" }, withImage);
    assert.ok(!request.url.includes("private-api-key"));
    assert.ok(!request.body.includes("private-api-key"));
    const body = JSON.parse(request.body);
    if (provider === "openai") {
      assert.equal(request.url, "https://api.openai.com/v1/responses");
      assert.equal(request.headers.Authorization, "Bearer private-api-key");
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.input[0].content[2].type, "input_image");
    } else {
      assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/vision-model:generateContent");
      assert.equal(request.headers["x-goog-api-key"], "private-api-key");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(body.contents[0].parts[2].inlineData.mimeType, "image/png");
    }
  }
  assert.equal(companionBase("https://host.example/"), "https://host.example");
  for (const url of ["http://192.168.1.2:4318", "https://name:secret@example.com", "https://host.example/?token=secret", "javascript:alert(1)"]) assert.throws(() => companionBase(url));
  assert.throws(() => frontierHttpRequest({ kind: "api", provider: "openai", apiKey: "secret", model: "../../other" }, task));
});

test("fusion deduplicates, caps the pool, and ranking never trusts invented candidate IDs", () => {
  const first = response(["a", "b", "c"]), second = response(["b", "d", "a"]);
  assert.deepEqual(mergeFrontierCandidates([first, second]).map(h => h.question.id), ["b", "a", "d", "c"]);
  assert.equal(mergeFrontierCandidates([response(Array.from({ length: 500 }, (_, i) => String(i)))]).length, 300);
  const hits = response(["a", "b", "c", "d"]).hits;
  const ranked = applyFrontierRankings(hits, [
    { id: "a", relationship: "surface_only", reason: "Similar story only." },
    { id: "c", relationship: "same_method", reason: "Both count unordered pairs." },
    { id: "d", relationship: "uncertain", reason: "Missing diagram." },
  ]);
  assert.deepEqual(ranked.map(h => h.question.id), ["c", "b", "d", "a"]);
  assert.equal(hits[0].ai, undefined);
  assert.equal(ranked[0].ai.relationship, "same_method");
  assert.throws(() => applyFrontierRankings(hits, [{ id: "invented", relationship: "same_method", reason: "fake" }]));
});

test("provider errors redact echoed content and never trigger retries or billing fallback", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++; assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
    return new Response("private-api-key and private question", { status: 429 });
  });
  await assert.rejects(generateFrontier({ kind: "api", provider: "openai", apiKey: "private-api-key", model: "vision" }, task, signal()), error => /quota/.test(error.message) && !/private/.test(error.message));
  assert.equal(calls, 1);
});

test("frontier pipeline makes at most four requests, preserves filters, and keeps unreviewed candidates", async (t) => {
  const sent = [], local = [], progress = [], previews = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const request = JSON.parse(init.body); sent.push(request);
    if (request.stage === "understand") return Response.json(understanding);
    const { candidates } = JSON.parse(request.text);
    assert.equal(candidates.length, 6);
    return Response.json({ rankings: candidates.map(q => ({ id: q.id, relationship: "same_method", reason: "Counts pairs." })) });
  });
  const session = {
    async search(query) { local.push(query); return response(Array.from({ length: 30 }, (_, i) => `q${i}`)); },
    async imageUrl() { throw new Error("image unavailable"); },
  };
  const query = { text: "five people shake hands", grade: "3-4", topics: ["counting"], excludeIds: ["source"], excludeFamily: "family", mode: "strategy" };
  const result = await runFrontierSearch({ connection, query, session, signal: signal(), onProgress: s => progress.push(s), onLocalResults: r => previews.push(r) });
  assert.equal(sent.length, 4); assert.equal(local.length, 5);
  for (const expanded of local) {
    assert.equal(expanded.grade, query.grade); assert.deepEqual(expanded.topics, query.topics);
    assert.deepEqual(expanded.excludeIds, query.excludeIds); assert.equal(expanded.excludeFamily, query.excludeFamily);
  }
  assert.ok(local.slice(1).every(q => q.mode === "hybrid"));
  assert.equal(previews.length, 2); assert.equal(result.reviewed, 18); assert.equal(result.retrieved, 30);
  assert.equal(result.response.hits.filter(h => h.ai).length, 18);
  assert.match(result.warning, /18 candidate images/);
  assert.ok(progress.length >= 5);
});

test("invalid candidate output fails with the local pool already available", async (t) => {
  let calls = 0, localAvailable = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(calls === 1 ? { ...understanding, searches: ["pairs"] } : { rankings: [{ id: "invented", relationship: "same_method", reason: "Invented." }] });
  });
  const session = { async search() { return response(["actual"]); }, async imageUrl() { throw new Error("missing"); } };
  await assert.rejects(runFrontierSearch({ connection, query: { text: "pairs" }, session, signal: signal(), onProgress() {}, onLocalResults() { localAvailable = true; } }), /exact candidate set/);
  assert.equal(calls, 2); assert.equal(localAvailable, true);
});

test("cancellation stops the pipeline before disclosing the query to a provider", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("must not send"); });
  const controller = new AbortController();
  const session = { async search() { controller.abort(); return response(["a"]); }, async imageUrl() { throw new Error("must not load"); } };
  await assert.rejects(runFrontierSearch({ connection, query: { text: "pairs" }, session, signal: controller.signal, onProgress() {} }), { name: "AbortError" });
  assert.equal(calls, 0);
});
