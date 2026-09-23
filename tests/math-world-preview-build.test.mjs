import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("private world material requires opt-in and is removed by the standard generator", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "math-world-build-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of [
    "scripts/generate-math-world-runtime.mjs",
    "app/math-world/legacy-world-data.ts",
    "app/math-world/data/world-01.questions.json",
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await copyFile(new URL(`../${relative}`, import.meta.url), path.join(root, relative));
  }
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  const input = path.join(root, "private-input/manifest.json");
  const assetDirectory = path.join(root, "private-input/assets");
  const publicAssets = path.join(root, "public/math-world/spiral-questions");
  const generated = path.join(root, "app/math-world/data/runtime.generated.json");
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(path.join(assetDirectory, "private-sentinel.webp"), "private-question-material");
  const payload = {
    schemaVersion: 2, mode: "spiral-preview", contentVersion: "synthetic-preview",
    worlds: Array.from({ length: 20 }, (_, index) => ({ id: `world-${index}` })),
    questions: [{ prompt: "PRIVATE PROMPT SENTINEL" }],
  };
  await writeFile(input, JSON.stringify(payload));
  const run = (optIn) => execute(process.execPath, [path.join(root, "scripts/generate-math-world-runtime.mjs")], {
    cwd: root,
    env: { ...process.env, MATH_WORLD_PREVIEW: optIn, MATH_WORLD_PREVIEW_MANIFEST: input },
  });

  await run("1");
  assert.deepEqual(JSON.parse(await readFile(generated, "utf8")), payload);
  assert.equal(await readFile(path.join(publicAssets, "private-sentinel.webp"), "utf8"), "private-question-material");

  await run("0");
  const ordinary = JSON.parse(await readFile(generated, "utf8"));
  assert.equal(ordinary.mode, "prototype");
  assert.equal(ordinary.worlds.length, 1);
  assert.equal(ordinary.questions.length, 38);
  assert.doesNotMatch(JSON.stringify(ordinary), /PRIVATE PROMPT SENTINEL/);
  await assert.rejects(access(publicAssets), { code: "ENOENT" });

  await writeFile(input, JSON.stringify({ ...payload, worlds: payload.worlds.slice(0, 19) }));
  await assert.rejects(run("1"), /complete, validated 20-world manifest/);
  await assert.rejects(access(publicAssets), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(generated, "utf8")), ordinary, "invalid preview never replaces the last valid manifest");
});
