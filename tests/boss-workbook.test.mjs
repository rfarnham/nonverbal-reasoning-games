import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { bossWorkbook, bossWorkbookDocument } from "../app/math-world/boss-workbook.ts";

const challenge = year => ({ id: `boss-${year}`, year, afterWorld: year === 2025 ? 10 : 20, title: `${year} Boss Challenge`, questionCount: 24, gradeBand: "1-2" });

test("each held-out workbook contains its complete original test, Q1 through Q24 once", () => {
  for (const year of [2025, 2026]) {
    const workbook = bossWorkbook(challenge(year));
    assert.deepEqual(workbook.pages.flatMap(page => page.questionNumbers), Array.from({ length: 24 }, (_, index) => index + 1));
    assert.equal(workbook.gradeBand, "1-2");
    assert.equal(workbook.questionCount, 24);
    assert.equal(workbook.pages.length, year === 2025 ? 6 : 24);
    assert.equal(workbook.layout, year === 2025 ? "paper" : "questions");
  }
  assert.throws(() => bossWorkbook({ ...challenge(2025), id: "boss-2026" }), /unavailable/);
  assert.throws(() => bossWorkbook({ ...challenge(2025), year: 2024 }), /unavailable/);
});

test("all original test artwork is pinned locally with verified PNG dimensions", async () => {
  const expectedFiles = [];
  for (const year of [2025, 2026]) {
    for (const page of bossWorkbook(challenge(year)).pages) {
      assert.match(page.src, /^\/math-world\/boss-tests\/(2025|2026)-grades-1-2-(page-\d\d|q\d\d)\.png$/);
      const bytes = await readFile(new URL(`../public${page.src}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), page.sha256, page.src);
      assert.equal(bytes.readUInt32BE(16), page.width, page.src);
      assert.equal(bytes.readUInt32BE(20), page.height, page.src);
      expectedFiles.push(page.src.split("/").at(-1));
    }
  }
  assert.deepEqual((await readdir(new URL("../public/math-world/boss-tests/", import.meta.url))).sort(), expectedFiles.sort());
});

test("source bounds exclude personal paper headers and preserve the complete 2026 Q21 choice E", () => {
  const paper = bossWorkbook(challenge(2025));
  assert.equal(paper.sourceSha256.length, 64);
  for (const [index, page] of paper.pages.entries()) {
    assert.equal(page.renderDpi, 200);
    assert.deepEqual(page.sourceCropPixels, [0, index === 0 ? 80 : 120, 1700, 2200]);
  }
  const q21 = bossWorkbook(challenge(2026)).pages[20];
  assert.deepEqual(q21.questionNumbers, [21]);
  assert.deepEqual(q21.sourceCropPixels, [75, 0, 1280, 720]);
  assert.equal(q21.height, 720);
  assert.equal(q21.captureTimeSeconds, 0.5);
});

test("print documents use original artwork in order, with no reconstructed choices or answer keys", () => {
  for (const year of [2025, 2026]) {
    const workbook = bossWorkbook(challenge(year));
    const html = bossWorkbookDocument(challenge(year), "https://example.test");
    assert.equal((html.match(/<article /g) ?? []).length, workbook.pages.length);
    assert.equal((html.match(/<img /g) ?? []).length, workbook.pages.length);
    assert.match(html, /data-print-ready="false"/);
    assert.match(html, /id="print-workbook" type="button" disabled/);
    let previous = -1;
    for (const page of workbook.pages) {
      const position = html.indexOf(page.src);
      assert.ok(position > previous);
      previous = position;
    }
    assert.doesNotMatch(html, /answer.?key|correct.?answer|<iframe|<script|Rodrigo|Farnham/i);
    assert.equal((html.match(/class="workspace"/g) ?? []).length, year === 2026 ? 24 : 0);
  }
});
