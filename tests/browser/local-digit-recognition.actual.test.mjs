import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const wavPath = process.env.LOCAL_ASR_TEST_WAV;
const expected = process.env.LOCAL_ASR_TEST_DIGITS?.split(",").map(Number);
const root = fileURLToPath(new URL("../../", import.meta.url));

// Optional real inference with an independently supplied 16kHz mono WAV.
// Expected digits are asserted by this test and never passed to the recognizer.
test("actual local WASM digit recognition and AudioWorklet microphone capture", { skip: !wavPath || !expected, timeout: 180_000 }, async () => {
  const fixture = await readFile(path.resolve(wavPath));
  const source = await readFile(path.join(root, "app/lab/working-memory/local-digit-recognition.ts"), "utf8");
  const compiled = ts.transpileModule(source.replace("process.env.NEXT_PUBLIC_BASE_PATH", '""'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({ url: request.url, method: request.method });
    try {
      if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Local speech verification</title>"); return; }
      if (request.url === "/asr.js") { response.setHeader("Content-Type", "text/javascript"); response.end(compiled); return; }
      if (request.url === "/fixture.wav") { response.setHeader("Content-Type", "audio/wav"); response.end(fixture); return; }
      if (request.url === "/favicon.ico") { response.statusCode = 204; response.end(); return; }
      const relative = String(request.url).slice(1);
      if (!relative.startsWith("models/speech/") || relative.includes("..")) throw new Error("Invalid asset path");
      response.setHeader("Content-Type", relative.endsWith(".js") ? "text/javascript" : "application/octet-stream");
      response.end(await readFile(path.join(root, "public", relative)));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", `--use-file-for-fake-audio-capture=${path.resolve(wavPath)}%noloop`],
  });
  try {
    const context = await browser.newContext();
    const networkViolations = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin || request.method() !== "GET") {
        networkViolations.push({ url: request.url(), method: request.method() });
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const { LocalDigitRecognizer } = await import("/asr.js");
      const recognizer = new LocalDigitRecognizer();
      const setupStart = performance.now();
      await recognizer.prepare();
      const setupMs = performance.now() - setupStart;
      const encoded = await (await fetch("/fixture.wav")).arrayBuffer();
      const decoder = new OfflineAudioContext(1, 16000, 16000);
      const decoded = await decoder.decodeAudioData(encoded);
      const samples = decoded.getChannelData(0);
      const inferenceStart = performance.now();
      const offline = await recognizer.recognize(samples, 16000);
      const inferenceMs = performance.now() - inferenceStart;
      const silence = await recognizer.recognize(new Float32Array(16000), 16000);
      await recognizer.start();
      await new Promise((resolve) => setTimeout(resolve, decoded.duration * 1000 + 600));
      const microphone = await recognizer.stop();
      recognizer.dispose();
      const cached = new LocalDigitRecognizer();
      await cached.prepare();
      const cachedSilence = await cached.recognize(new Float32Array(16000), 16000);
      cached.dispose();
      return { offline, microphone, silence, cachedSilence, setupMs, inferenceMs, audioSeconds: decoded.duration };
    });
    assert.equal(result.offline.status, "recognized");
    assert.deepEqual(result.offline.digits, expected);
    assert.equal(result.microphone.status, "recognized");
    assert.deepEqual(result.microphone.digits, expected);
    assert.equal(result.silence.status, "uncertain");
    assert.equal(result.cachedSilence.status, "uncertain");
    assert.deepEqual(networkViolations, []);
    assert.ok(requests.every((request) => request.method === "GET"));
    assert.ok(requests.some((request) => request.url.endsWith("digit-capture.worklet.js")));
    // Routing disables Chromium's HTTP cache: the fresh worker reuses IndexedDB.
    assert.equal(requests.filter((request) => request.url.endsWith("vosk-model-small-en-us-0.15.tar.gz")).length, 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ localSpeechVerification: result }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
