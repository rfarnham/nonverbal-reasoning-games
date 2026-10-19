import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { DIGIT_GRAMMAR, LocalDigitRecognizer, LocalSpeechInputError, parseLocalDigitResult } from "../app/lab/working-memory/local-digit-recognition.ts";

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

async function captureHarness(run) {
  const descriptors = new Map();
  const order = [];
  const modules = [];
  const contexts = [];
  const permissions = [];
  const worklets = [];
  const workers = [];
  const recognizers = [];
  let inGesture = false;
  function replace(name, value) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  class FakeWorker {
    messages = [];
    constructor() { workers.push(this); }
    postMessage(message) {
      this.messages.push(message);
      if (message.action === "load") queueMicrotask(() => this.emit({ event: "load", result: true }));
    }
    emit(data) { this.onmessage?.({ data }); }
    terminate() {}
  }
  class FakeContext {
    state = "suspended";
    destination = {};
    audioWorklet = { addModule() {
      order.push("module");
      return new Promise((resolve, reject) => modules.push({ resolve, reject }));
    } };
    constructor() { contexts.push(this); }
    resume() {
      order.push("resume");
      if (!inGesture) return Promise.reject(new Error("A gesture is required"));
      this.state = "running";
      return Promise.resolve();
    }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createMediaStreamSource() {
      return { connect() { order.push("connected"); }, disconnect() { order.push("disconnected"); } };
    }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  class FakeWorklet {
    port = { onmessage: null, close() {}, postMessage: (message) => {
      if (message.action === "flush") queueMicrotask(() => {
        this.port.onmessage?.({ data: { type: "samples", samples: new Float32Array([0.5]) } });
        this.port.onmessage?.({ data: { type: "flushed" } });
      });
    } };
    constructor() { order.push("worklet"); worklets.push(this); }
    connect() {}
    disconnect() {}
  }
  try {
    replace("window", { isSecureContext: true, location: { origin: "https://games.example" } });
    replace("navigator", { mediaDevices: { getUserMedia() {
      order.push("microphone");
      return new Promise((resolve) => permissions.push({ resolve }));
    } } });
    replace("AudioContext", FakeContext);
    replace("AudioWorkletNode", FakeWorklet);
    replace("Worker", FakeWorker);
    await run({
      order, modules, contexts, permissions, worklets, workers,
      async recognizer(options) {
        const recognizer = new LocalDigitRecognizer(options);
        recognizers.push(recognizer);
        await recognizer.prepare();
        return recognizer;
      },
      gesture(callback) { inGesture = true; try { return callback(); } finally { inGesture = false; } },
      async tick() { await new Promise((resolve) => setImmediate(resolve)); },
      stream() {
        const track = { stops: 0, stop() { this.stops += 1; }, addEventListener() {} };
        return { track, getTracks() { return [track]; }, getAudioTracks() { return [track]; } };
      },
    });
  } finally {
    recognizers.forEach((recognizer) => recognizer.dispose());
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test("gesture priming opens no microphone or recognizer, and survives cancellation for delayed recall", async () => {
  await captureHarness(async (h) => {
    const recognizer = await h.recognizer();
    h.gesture(() => recognizer.prime());
    assert.deepEqual(h.order, ["resume", "module"], "resume is invoked synchronously in the gesture");
    assert.equal(h.workers[0].messages.some((message) => message.action === "create"), false);
    assert.equal(h.permissions.length, 0);
    const cancelled = recognizer.start();
    const rejected = assert.rejects(cancelled, { name: "AbortError" });
    recognizer.cancel();
    await rejected; // Cancellation cannot wait for a cold worklet or permission.
    assert.equal(h.contexts[0].state, "running");
    h.modules[0].resolve();
    await h.tick();
    assert.equal(h.permissions.length, 0, "cancelled startup must not open the microphone later");

    const delayed = recognizer.start(); // No gesture remains at recall time.
    await h.tick();
    assert.equal(h.contexts.length, 1);
    assert.equal(h.modules.length, 1);
    assert.deepEqual(h.order.slice(-2), ["worklet", "microphone"]);
    const stream = h.stream();
    h.permissions[0].resolve(stream);
    await delayed;
    assert.equal(recognizer.recording, true);
    recognizer.cancel();
    assert.ok(stream.track.stops >= 1);
    assert.equal(h.contexts[0].state, "running");
    recognizer.dispose();
    assert.equal(h.contexts[0].state, "closed");
  });
});

function captureSamples(h, samples, index = h.worklets.length - 1) {
  h.worklets[index].port.onmessage?.({ data: { type: "samples", samples } });
}

function captureTone(milliseconds, amplitude = 0.08) {
  return Float32Array.from({ length: milliseconds * 16 }, (_, sample) => amplitude * Math.sin(2 * Math.PI * 220 * sample / 16_000));
}

async function beginAutomaticCapture(h, callbacks, recognizerOptions) {
  const recognizer = await h.recognizer(recognizerOptions);
  h.gesture(() => recognizer.prime());
  h.modules.at(-1).resolve();
  const starting = recognizer.start({ autoEndpoint: callbacks });
  await h.tick();
  const stream = h.stream();
  h.permissions.at(-1).resolve(stream);
  await starting;
  const worker = h.workers.at(-1);
  const id = worker.messages.filter((message) => message.action === "create").at(-1).recognizerId;
  return { recognizer, worker, id, stream };
}

test("automatic capture waits across digit pauses, flushes once, and returns all segments without answer bias", async () => {
  await captureHarness(async (h) => {
    const events = [];
    const { recognizer, worker, id, stream } = await beginAutomaticCapture(h, {
      onStopping() { events.push("stopping"); },
      onResult(result) { events.push(result); },
      onFailure(error) { events.push(error); },
    });
    captureSamples(h, captureTone(400));
    worker.emit({ event: "partialresult", recognizerId: id, result: { partial: "three" } });
    captureSamples(h, new Float32Array(16 * 1_900));
    assert.deepEqual(events, []);
    worker.emit({ event: "result", recognizerId: id, result: segment(["three"]) });
    captureSamples(h, captureTone(400));
    worker.emit({ event: "partialresult", recognizerId: id, result: { partial: "one" } });
    captureSamples(h, new Float32Array(16 * 2_000));
    assert.deepEqual(events, ["stopping"]);
    assert.ok(stream.track.stops >= 1, "microphone is stopped before final decoding");
    await h.tick();
    const messages = worker.messages.filter((message) => message.recognizerId === id);
    assert.equal(messages.filter((message) => message.action === "retrieveFinalResult").length, 1);
    assert.equal(messages.at(-2).action, "audioChunk", "flushed tail reaches ASR before final decode");
    worker.emit({ event: "finalresult", recognizerId: id, result: segment(["one", "nine"]) });
    await h.tick();
    assert.deepEqual(events, ["stopping", { digits: [3, 1, 9], transcript: "three one nine", status: "recognized" }]);
    assert.equal(recognizer.recording, false);
    assert.deepEqual(JSON.parse(worker.messages.find((message) => message.action === "create").grammar), DIGIT_GRAMMAR);
    worker.emit({ event: "finalresult", recognizerId: id, result: segment(["two"]) });
    captureSamples(h, new Float32Array(32_000));
    await h.tick();
    assert.equal(events.length, 2, "duplicate and late completions do not emit another answer");
  });
});

test("unchanged ASR partials cannot keep quiet capture open, while quiet voices can supply speech evidence", async () => {
  await captureHarness(async (h) => {
    const events = [];
    const { worker, id } = await beginAutomaticCapture(h, {
      onStopping() { events.push("stopping"); }, onResult(result) { events.push(result); }, onFailure(error) { events.push(error); },
    });
    captureSamples(h, captureTone(400, 0.003));
    worker.emit({ event: "partialresult", recognizerId: id, result: { partial: "seven" } });
    for (let frame = 0; frame < 20; frame += 1) {
      captureSamples(h, new Float32Array(1_600));
      worker.emit({ event: "partialresult", recognizerId: id, result: { partial: "seven" } });
    }
    assert.deepEqual(events, ["stopping"]);
    await h.tick();
    worker.emit({ event: "finalresult", recognizerId: id, result: segment(["seven"]) });
    await h.tick();
    assert.equal(events[1].status, "recognized");
  });
});

test("automatic no-speech and maximum duration failures stop tracks and remain separate from recognized answers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await captureHarness(async (h) => {
      const events = [];
      const callbacks = { onStopping() { events.push("stopping"); }, onResult(result) { events.push(result); }, onFailure(error) { events.push(error); } };
      const first = await beginAutomaticCapture(h, callbacks);
      captureSamples(h, new Float32Array(16 * 9_000));
      t.mock.timers.tick(10_000);
      assert.equal(events.length, 1);
      assert.ok(events[0] instanceof LocalSpeechInputError);
      assert.equal(events[0].code, "no-speech");
      assert.ok(first.stream.track.stops >= 1);
      assert.equal(first.worker.messages.some((message) => message.action === "retrieveFinalResult"), false, "silence is not decoded as an answer");
      assert.equal(first.recognizer.ready, true);

      const recording = first.recognizer.start({ autoEndpoint: callbacks });
      await h.tick();
      const secondStream = h.stream();
      h.permissions.at(-1).resolve(secondStream);
      await recording;
      captureSamples(h, captureTone(400));
      t.mock.timers.tick(10_000);
      assert.equal(events.length, 1, "the initial deadline does not truncate detected speech");
      t.mock.timers.tick(35_000);
      assert.equal(events.length, 2);
      assert.equal(events[1].code, "timeout");
      assert.ok(secondStream.track.stops >= 1);
      assert.equal(first.recognizer.recording, false);
    });
  } finally { t.mock.timers.reset(); }
});

test("uncertain automatic recognition remains a decode failure candidate rather than guessed digits", async () => {
  await captureHarness(async (h) => {
    const events = [];
    const { worker, id } = await beginAutomaticCapture(h, {
      onStopping() { events.push("stopping"); }, onResult(result) { events.push(result); }, onFailure(error) { events.push(error); },
    });
    captureSamples(h, captureTone(400));
    captureSamples(h, new Float32Array(32_000));
    await h.tick();
    worker.emit({ event: "finalresult", recognizerId: id, result: segment(["one", "two"], 0.6) });
    await h.tick();
    assert.deepEqual(events, ["stopping", { digits: [], transcript: "one two", status: "uncertain" }]);
  });
});

test("pause, lock, disposal, and late worker results cannot deliver an automatic answer", async () => {
  for (const cancelAt of ["capture", "flush", "inference", "dispose"]) {
    await captureHarness(async (h) => {
      const events = [];
      const { recognizer, worker, id, stream } = await beginAutomaticCapture(h, {
        onStopping() { events.push("stopping"); }, onResult(result) { events.push(result); }, onFailure(error) { events.push(error); },
      });
      captureSamples(h, captureTone(400));
      if (cancelAt !== "capture") captureSamples(h, new Float32Array(32_000));
      if (cancelAt === "inference") await h.tick();
      if (cancelAt === "dispose") recognizer.dispose();
      else recognizer.cancel();
      worker.emit({ event: "finalresult", recognizerId: id, result: segment(["one"]) });
      await h.tick();
      assert.deepEqual(events, cancelAt === "capture" ? [] : ["stopping"], cancelAt);
      assert.ok(stream.track.stops >= 1);
      assert.equal(recognizer.recording, false);
    });
  }
});

test("active automatic worker failure emits one failure with updated readiness", async () => {
  await captureHarness(async (h) => {
    const events = [];
    let recognizer;
    ({ recognizer } = await beginAutomaticCapture(h, {
      onStopping() { events.push("stopping"); }, onResult(result) { events.push(result); },
      onFailure(error) { events.push({ error, ready: recognizer.ready }); },
    }, { onError() { events.push("duplicate global failure"); } }));
    const worker = h.workers[0];
    worker.onerror({ preventDefault() {} });
    await h.tick();
    assert.equal(events.length, 1);
    assert.equal(events[0].ready, false);
    assert.match(events[0].error.message, /could not run/);
    assert.equal(recognizer.recording, false);
  });
});

test("late microphone permission is stopped, and an unlocked context records again without a new gesture", async () => {
  await captureHarness(async (h) => {
    const recognizer = await h.recognizer();
    h.gesture(() => recognizer.prime());
    h.modules[0].resolve();
    const late = recognizer.start();
    const rejected = assert.rejects(late, { name: "AbortError" });
    await h.tick();
    recognizer.cancel();
    await rejected;
    const lateStream = h.stream();
    h.permissions[0].resolve(lateStream);
    await h.tick();
    assert.equal(lateStream.track.stops, 1);
    assert.equal(h.order.includes("connected"), false);

    const recording = recognizer.start();
    await h.tick();
    const stream = h.stream();
    h.permissions[1].resolve(stream);
    await recording;
    const worker = h.workers[0];
    const id = worker.messages.filter((message) => message.action === "create").at(-1).recognizerId;
    const final = recognizer.stop();
    await h.tick();
    assert.equal(h.contexts.length, 1);
    assert.equal(h.contexts[0].state, "running");
    assert.ok(stream.track.stops >= 1, "microphone closes before final inference");
    const messages = worker.messages.filter((message) => message.recognizerId === id);
    assert.equal(messages.findIndex((message) => message.action === "audioChunk") < messages.findIndex((message) => message.action === "retrieveFinalResult"), true);
    worker.emit({ event: "finalresult", recognizerId: id, result: segment(["three", "one"]) });
    assert.deepEqual((await final).digits, [3, 1]);
    assert.equal(recognizer.recording, false);
    assert.equal(h.contexts[0].state, "running");
  });
});

test("cancelled inference and stale final results cannot become a new recording's answer", async () => {
  await captureHarness(async (h) => {
    const recognizer = await h.recognizer();
    h.gesture(() => recognizer.prime());
    h.modules[0].resolve();
    const recording = recognizer.start();
    await h.tick();
    h.permissions[0].resolve(h.stream());
    await recording;
    const worker = h.workers[0];
    const oldId = worker.messages.filter((message) => message.action === "create").at(-1).recognizerId;
    const cancelled = recognizer.stop();
    const rejected = assert.rejects(cancelled, { name: "AbortError" });
    await h.tick();
    recognizer.cancel();
    await rejected;
    const next = recognizer.start();
    await h.tick();
    h.permissions[1].resolve(h.stream());
    await next;
    const id = worker.messages.filter((message) => message.action === "create").at(-1).recognizerId;
    worker.emit({ event: "finalresult", recognizerId: oldId, result: segment(["nine"]) });
    const final = recognizer.stop();
    await h.tick();
    worker.emit({ event: "finalresult", recognizerId: id, result: segment(["two"]) });
    assert.deepEqual((await final).digits, [2]);
  });
});

test("failed or disposed priming never opens a microphone and can recover on a new gesture", async () => {
  await captureHarness(async (h) => {
    const recognizer = await h.recognizer();
    h.gesture(() => recognizer.prime());
    const failed = recognizer.start();
    const rejected = assert.rejects(failed, /module unavailable/);
    h.modules[0].reject(new Error("module unavailable"));
    await rejected;
    assert.equal(h.permissions.length, 0);
    assert.equal(h.contexts[0].state, "closed");
    await assert.rejects(recognizer.start(), /module unavailable/, "delayed recall cannot retry activation without a gesture");
    assert.equal(h.contexts.length, 1);
    h.gesture(() => recognizer.prime());
    assert.equal(h.contexts.length, 2);
    const pending = recognizer.start();
    const cancelled = assert.rejects(pending, { name: "AbortError" });
    recognizer.dispose();
    await cancelled;
    assert.equal(h.contexts[1].state, "closed");
    h.modules[1].resolve();
    await h.tick();
    assert.equal(h.permissions.length, 0);
    assert.equal(recognizer.ready, false);
  });
});

test("stalled gesture priming is bounded and cannot open a microphone after its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await captureHarness(async (h) => {
      const recognizer = await h.recognizer();
      h.gesture(() => recognizer.prime());
      const recording = recognizer.start();
      const rejected = assert.rejects(recording, /setup took too long/);
      t.mock.timers.tick(15_000);
      await rejected;
      assert.equal(h.contexts[0].state, "closed");
      assert.equal(h.permissions.length, 0);
      h.modules[0].resolve();
      await h.tick();
      assert.equal(h.permissions.length, 0);
    });
  } finally { t.mock.timers.reset(); }
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
