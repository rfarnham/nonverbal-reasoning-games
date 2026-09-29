import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const browserURL = new URL("../lib/question-search/browser.ts", import.meta.url);
const browserSource = await readFile(browserURL, "utf8");
// Run the actual production class with deterministic Worker/timer doubles.
// Browser imports are omitted because these lifecycle tests never call crypto,
// image or download functions. Query validation is irrelevant to worker failure.
const compiled = ts.transpileModule(browserSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .*;\s*$/gm, "")
  .replace(/^export /gm, "")
  .replaceAll("import.meta.url", JSON.stringify(browserURL.href));

function sessionFixture() {
  const workers = [];
  const timers = new Map();
  let sequence = 0;
  class FakeWorker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({ URL, AbortController, process: { env: {} }, Worker: FakeWorker,
    parseSearchQuery: value => value,
    setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(`${compiled}\nglobalThis.Session = SearchSession;`, context);
  const session = new context.Session({ questions: [] }, {}, {});
  return { session, worker: workers[0], timers };
}

test("fatal worker error rejects current and future searches and clears timers", async () => {
  const { session, worker, timers } = sessionFixture();
  worker.onmessage({ data: { id: 1, ready: true } });
  const pending = session.search({ text: "fold" });
  await Promise.resolve();
  let prevented = false;
  worker.onerror({ preventDefault() { prevented = true; } });
  await assert.rejects(pending, /Search stopped/);
  const sent = worker.messages.length;
  await assert.rejects(session.search({ text: "cube" }), /Search stopped/);
  assert.equal(worker.messages.length, sent);
  assert.equal(timers.size, 0);
  assert.equal(worker.terminated, true);
  assert.equal(prevented, true);
});

test("worker initialization timeout and message decoding errors terminate safely", async () => {
  const first = sessionFixture();
  const pending = first.session.search({ text: "fold" });
  [...first.timers.values()][0]();
  await assert.rejects(pending, /too long/);
  assert.equal(first.worker.terminated, true);
  assert.equal(first.timers.size, 0);
  const second = sessionFixture();
  const next = second.session.search({ text: "cube" });
  second.worker.onmessageerror({});
  await assert.rejects(next, /could not read/);
  assert.equal(second.timers.size, 0);
});

test("locking cancels pending searches and revokes scheduled timeouts", async () => {
  const { session, worker, timers } = sessionFixture();
  const pending = session.search({ text: "fold" });
  session.lock();
  await assert.rejects(pending, /locked/);
  assert.equal(timers.size, 0);
  assert.equal(worker.terminated, true);
});

const serviceWorkerSource = await readFile(new URL("../public/question-search/sw.js", import.meta.url), "utf8");
async function serviceWorkerFetch(caches, fetch) {
  const handlers = {};
  const context = vm.createContext({ URL, caches, fetch, self: {
    location: { origin: "https://example.test" }, addEventListener: (name, fn) => { handlers[name] = fn; },
  } });
  vm.runInContext(serviceWorkerSource, context);
  let response;
  handlers.fetch({ request: { method: "GET", url: "https://example.test/question-search/data/index.bin", mode: "cors" },
    respondWith(value) { response = value; } });
  return await response;
}

test("blocked CacheStorage and broken cache reads retain online resource access", async () => {
  const response = { ok: true, clone() { return this; } };
  let network = 0;
  const fetch = async () => { network++; return response; };
  assert.equal(await serviceWorkerFetch({ open: async () => { throw new Error("blocked"); } }, fetch), response);
  assert.equal(await serviceWorkerFetch({ open: async () => ({ match: async () => { throw new Error("unavailable"); }, put: async () => { throw new Error("quota"); } }) }, fetch), response);
  assert.equal(network, 2);
});
