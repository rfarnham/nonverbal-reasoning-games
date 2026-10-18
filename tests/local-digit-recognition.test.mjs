import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { DIGIT_GRAMMAR, LocalDigitRecognizer, parseLocalDigitResult } from "../app/lab/working-memory/local-digit-recognition.ts";

function segment(words, confidence = 0.99) {
  return { text: words.join(" "), result: words.map((word) => ({ word, conf: confidence })) };
}

test("local digit parsing preserves spoken order and repetitions across endpoint segments", () => {
  assert.deepEqual(parseLocalDigitResult([segment(["seven", "one"]), segment(["one", "three"]), { text: "" }]), {
    digits: [7, 1, 1, 3], transcript: "seven one one three", status: "recognized",
  });
});

test("unknown, silence, absent confidence, and weak recognition stay unscored candidates", () => {
  for (const result of [[], [{ text: "" }], [segment(["one", "[unk]"])], [segment(["eleven"])],
    [{ text: "one two" }], [segment(["one", "two"], 0.64)], [segment(["one", "two"], 0.79)],
    [{ text: "one two", result: [{ word: "one", conf: 1 }] }], [segment(["one"], Number.NaN)]]) {
    assert.equal(parseLocalDigitResult(result).status, "uncertain");
    assert.deepEqual(parseLocalDigitResult(result).digits, []);
  }
});

test("model grammar is an answer-independent complete digit vocabulary with unknown rejection", () => {
  assert.deepEqual(DIGIT_GRAMMAR, ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "[unk]"]);
  assert.equal(Object.isFrozen(DIGIT_GRAMMAR), true);
});

test("local recognition rejects invalid and unbounded audio before allocating a worker", async () => {
  const recognizer = new LocalDigitRecognizer();
  for (const [samples, rate] of [[new Float32Array(), 16000], [new Float32Array([0]), 48000],
    [new Float32Array([Infinity]), 16000], [new Float32Array([1.01]), 16000], [new Float32Array(16000 * 46), 16000]]) {
    await assert.rejects(recognizer.recognize(samples, rate), /16 kHz/);
  }
  assert.equal(recognizer.ready, false);
  assert.equal(recognizer.recording, false);
  recognizer.cancel();
  recognizer.dispose();
});

test("local setup, PCM scaling, cancellation, and idle worker failure preserve readiness", async () => {
  const descriptors = new Map();
  const workers = [];
  function replace(name, value) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  class FakeWorker {
    messages = [];
    terminated = false;
    constructor(url) { this.url = url.href; workers.push(this); }
    postMessage(message) {
      this.messages.push(message);
      if (message.action === "load") queueMicrotask(() => this.onmessage({ data: { event: "load", result: true } }));
    }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }
  try {
    replace("window", { isSecureContext: true, location: { origin: "https://games.example" } });
    replace("navigator", { mediaDevices: { getUserMedia() { throw new Error("Microphone must not be requested"); } } });
    replace("AudioContext", class { constructor() { throw new Error("No capture graph during setup or offline recognition"); } });
    replace("AudioWorkletNode", class {});
    replace("Worker", FakeWorker);
    const failures = [];
    const recognizer = new LocalDigitRecognizer({ onError: (error) => failures.push({ error, ready: recognizer.ready }) });
    assert.equal(workers.length, 0);
    await recognizer.prepare();
    const worker = workers[0];
    assert.equal(new URL(worker.url).origin, "https://games.example");
    assert.equal(new URL(worker.messages.find((message) => message.action === "load").modelUrl).origin, "https://games.example");
    const recognized = recognizer.recognize(new Float32Array([-0.5, 0.5, 1]), 16000);
    const created = worker.messages.find((message) => message.action === "create");
    assert.deepEqual(JSON.parse(created.grammar), DIGIT_GRAMMAR);
    assert.deepEqual([...worker.messages.find((message) => message.action === "audioChunk").data], [-16384, 16384, 32768]);
    worker.emit({ event: "result", recognizerId: created.recognizerId, result: segment(["nine"]) });
    worker.emit({ event: "finalresult", recognizerId: created.recognizerId, result: segment(["two"]) });
    assert.deepEqual((await recognized).digits, [9, 2]);
    const cancelled = recognizer.recognize(new Float32Array([0]), 16000);
    const lastId = worker.messages.filter((message) => message.action === "create").at(-1).recognizerId;
    recognizer.cancel();
    await assert.rejects(cancelled, { name: "AbortError" });
    worker.emit({ event: "finalresult", recognizerId: lastId, result: segment(["one"]) });
    assert.equal(recognizer.recording, false);
    // Failure after setup but between rounds must disable spoken input at once.
    worker.onerror({ preventDefault() {} });
    assert.equal(recognizer.ready, false);
    assert.equal(worker.terminated, true);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].ready, false);
    worker.onmessageerror();
    assert.equal(failures.length, 1);
    await recognizer.prepare();
    const replacement = workers[1];
    assert.equal(recognizer.ready, true);
    // Queued events from the failed worker cannot stop its replacement.
    worker.onerror({ preventDefault() {} });
    worker.onmessageerror();
    worker.emit({ event: "load", result: true });
    assert.equal(recognizer.ready, true);
    assert.equal(failures.length, 1);
    // A worker failure during final inference rejects the promise and notifies
    // once; it must not rely on failRecording's separate recording callback.
    const interrupted = recognizer.recognize(new Float32Array([0]), 16000);
    const rejected = assert.rejects(interrupted, /could not run/);
    replacement.onerror({ preventDefault() {} });
    await rejected;
    assert.equal(recognizer.ready, false);
    assert.equal(failures.length, 2);
    assert.equal(failures[1].ready, false);
    recognizer.dispose();
    assert.equal(worker.terminated, true);
    assert.equal(recognizer.ready, false);
    assert.equal(failures.length, 2);
    // A queued response from a terminated worker cannot revive setup state.
    worker.emit({ event: "load", result: true });
    assert.equal(recognizer.ready, false);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test("local speech assets match the audited sources and fit ordinary static hosting", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/models/speech/manifest.json", import.meta.url), "utf8"));
  for (const asset of manifest.assets) {
    const bytes = await readFile(new URL(`../public/models/speech/${asset.file}`, import.meta.url));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    assert.ok(bytes.length < 100 * 1024 * 1024);
  }
});
