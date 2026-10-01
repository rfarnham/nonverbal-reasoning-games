import assert from "node:assert/strict";
import test from "node:test";
import { worksheetQuestions, prepareWorksheetImages, decodeWorksheetImages } from "../lib/question-search/worksheet.ts";

const question = id => ({ id });
const signal = () => new AbortController().signal;

test("worksheet selection preserves chosen order, removes duplicates, and enforces a bounded nonempty batch", () => {
  assert.deepEqual(worksheetQuestions([question("b"), question("a"), question("b"), question("c")]).map(q => q.id), ["b", "a", "c"]);
  assert.throws(() => worksheetQuestions([]), /Select at least one/);
  assert.throws(() => worksheetQuestions(Array.from({ length: 51 }, (_, i) => question(String(i)))), /at most 50/);
  assert.equal(worksheetQuestions(Array.from({ length: 50 }, (_, i) => question(String(i)))).length, 50);
});

test("image preparation keeps selected order despite out-of-order responses and loads at most four at a time", async () => {
  let concurrent = 0;
  let peak = 0;
  const progress = [];
  const rows = Array.from({ length: 9 }, (_, i) => question(String(i)));
  const result = await prepareWorksheetImages(rows, async q => {
    concurrent++;
    peak = Math.max(peak, concurrent);
    await new Promise(resolve => setTimeout(resolve, (4 - Number(q.id) % 4) * 2));
    concurrent--;
    return `blob:local-${q.id}`;
  }, { signal: signal(), onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(peak, 4);
  assert.deepEqual(result.map(item => item.question.id), rows.map(q => q.id));
  assert.deepEqual(result.map(item => item.url), rows.map(q => `blob:local-${q.id}`));
  assert.deepEqual(progress, rows.map((_, index) => [index + 1, 9]));
});

test("remote or inline image sources cannot enter a locally decrypted worksheet", async () => {
  for (const url of ["https://example.test/image.png", "data:image/png;base64,abc", "javascript:alert(1)", "/remote.png"]) {
    await assert.rejects(prepareWorksheetImages([question("q")], async () => url, { signal: signal() }), /locally decrypted/);
  }
});

test("a failed load never produces a partial worksheet and stops taking new work", async () => {
  let count = 0;
  await assert.rejects(prepareWorksheetImages(Array.from({ length: 20 }, (_, i) => question(String(i))), async () => {
    count++;
    throw new Error("The bank is locked.");
  }, { signal: signal() }), /locked/);
  assert.equal(count, 4);
});

test("stalled loads time out; closing a worksheet aborts preparation without scheduling more images", async () => {
  await assert.rejects(prepareWorksheetImages([question("q")], () => new Promise(() => {}), { signal: signal(), timeoutMs: 5 }), /too long/);
  const controller = new AbortController();
  let started = 0;
  const pending = prepareWorksheetImages(Array.from({ length: 8 }, (_, i) => question(String(i))), () => {
    started++;
    return new Promise(() => {});
  }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(started, 4);
  await assert.rejects(prepareWorksheetImages([question("q")], async () => { throw new Error("must not run"); }, { signal: controller.signal }), { name: "AbortError" });
});

test("printing readiness waits for every actual image decode and rejects failed or empty cards", async () => {
  let finish;
  let resolved = false;
  const image = { decode: () => Promise.resolve(), complete: true, naturalWidth: 500, naturalHeight: 400 };
  const pending = decodeWorksheetImages([image, { ...image, decode: () => new Promise(resolve => { finish = resolve; }) }], signal()).then(() => { resolved = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolved, false);
  finish();
  await pending;
  assert.equal(resolved, true);
  await assert.rejects(decodeWorksheetImages([], signal()), /no question images/);
  await assert.rejects(decodeWorksheetImages([{ ...image, naturalWidth: 0 }], signal()), /could not be displayed/);
  await assert.rejects(decodeWorksheetImages([{ ...image, decode: () => Promise.reject(new Error("damaged")) }], signal()), /damaged/);
  await assert.rejects(decodeWorksheetImages([{ ...image, decode: () => new Promise(() => {}) }], signal(), 5), /too long/);
});
