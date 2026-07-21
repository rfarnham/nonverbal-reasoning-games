import assert from "node:assert/strict";
import test from "node:test";

import {
  GAME_NARRATION_UNLOCK_SRC,
  SUITE_NARRATOR_ID,
  SUITE_NARRATOR_PROVENANCE,
  createGameNarrationPlayer,
  defineGameNarrationManifest,
  resolveGameNarrationAsset,
} from "../lib/game-narration.ts";

class FakeClock {
  now = 0;
  nextId = 1;
  jobs = new Map();

  timers = {
    setTimeout: (callback, delayMs) => {
      const id = this.nextId++;
      this.jobs.set(id, { at: this.now + delayMs, callback });
      return id;
    },
    clearTimeout: (id) => {
      this.jobs.delete(id);
    },
  };

  async advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const pending = [...this.jobs.entries()]
        .filter(([, job]) => job.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (!pending.length) break;
      const [id, job] = pending[0];
      this.jobs.delete(id);
      this.now = job.at;
      job.callback();
      await flushMicrotasks();
    }
    this.now = target;
    await flushMicrotasks();
  }
}

class FakeAudio {
  src = "";
  preload = "";
  currentTime = 8;
  listeners = new Map();
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  playResult = Promise.resolve();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  play() {
    this.playCalls += 1;
    return this.playResult;
  }

  pause() {
    this.pauseCalls += 1;
  }

  load() {
    this.loadCalls += 1;
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type });
    }
  }

  listenerCount() {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function manifest() {
  return defineGameNarrationManifest(
    {
      notice: {
        src: "/narration/libra/notice.mp3",
        audioDurationMs: 80,
        minimumVisualMs: 100,
        lingerMs: 25,
        transcript: "Look for the same group on both scales.",
      },
      move: {
        src: "/narration/libra/move.mp3",
        audioDurationMs: 150,
        minimumVisualMs: 200,
        lingerMs: 40,
        transcript: "Now move the matching animals into place.",
      },
    },
    SUITE_NARRATOR_PROVENANCE,
  );
}

test("manifests pin every game to one suite narrator", () => {
  const clips = manifest();
  assert.equal(clips.narrator, SUITE_NARRATOR_ID);
  assert.throws(
    () =>
      defineGameNarrationManifest(
        {
          broken: {
            src: "https://voice.example/remote.mp3",
            audioDurationMs: 90,
            minimumVisualMs: 100,
            lingerMs: 20,
            transcript: "Remote narration is not allowed.",
          },
        },
        SUITE_NARRATOR_PROVENANCE,
      ),
    /same-origin public asset path/,
  );
  assert.throws(
    () =>
      defineGameNarrationManifest(
        {
          rushed: {
            src: "/narration/rushed.mp3",
            audioDurationMs: 90,
            minimumVisualMs: -1,
            lingerMs: 0,
            transcript: "Too fast.",
          },
        },
        SUITE_NARRATOR_PROVENANCE,
      ),
    /finite, non-negative/,
  );
  assert.throws(
    () =>
      defineGameNarrationManifest(
        {
          line: {
            src: "/narration/line.mp3",
            audioDurationMs: 90,
            minimumVisualMs: 100,
            lingerMs: 20,
            transcript: "This voice does not match.",
          },
        },
        { ...SUITE_NARRATOR_PROVENANCE, voice: "different" },
      ),
    /must match the suite narrator/,
  );
});

test("local clip URLs retain the configured static-export base path", () => {
  assert.equal(
    resolveGameNarrationAsset(
      "/narration/libra/notice.mp3",
      "/nonverbal-reasoning-games/",
    ),
    "/nonverbal-reasoning-games/narration/libra/notice.mp3",
  );
  assert.equal(
    resolveGameNarrationAsset("narration/libra/notice.mp3", ""),
    "/narration/libra/notice.mp3",
  );
  for (const unsafe of [
    "https://example.com/clip.mp3",
    "//example.com/clip.mp3",
    "data:audio/mp3;base64,abc",
    "/narration/../secret.mp3",
    "/narration/%2e%2e/secret.mp3",
  ]) {
    assert.throws(() => resolveGameNarrationAsset(unsafe), TypeError);
  }
});

test("cues play serially and wait for audio, the visual minimum, and linger", async () => {
  const clock = new FakeClock();
  const audio = [];
  const starts = [];
  const completes = [];
  const player = createGameNarrationPlayer(manifest(), {
    basePath: "/nonverbal-reasoning-games",
    timers: clock.timers,
    createAudio(url) {
      const element = new FakeAudio();
      element.createdWith = url;
      audio.push(element);
      return element;
    },
  });

  const playback = player.play(["notice", "move"], {
    onCueStart(cue) {
      starts.push({ id: cue.id, at: clock.now, url: cue.url });
    },
    onCueComplete(cue) {
      completes.push({ id: cue.id, at: clock.now });
    },
  });
  await flushMicrotasks();

  assert.deepEqual(starts, [
    {
      id: "notice",
      at: 0,
      url: "/nonverbal-reasoning-games/narration/libra/notice.mp3",
    },
  ]);
  audio[0].emit("ended");
  await clock.advance(99);
  assert.deepEqual(completes, []);
  await clock.advance(1);
  await clock.advance(24);
  assert.equal(audio.length, 1);
  await clock.advance(1);

  assert.deepEqual(completes, [{ id: "notice", at: 125 }]);
  assert.equal(audio.length, 1, "one media element is reused across cues");
  assert.equal(audio[0].preload, "auto");
  assert.equal(
    audio[0].src,
    "/nonverbal-reasoning-games/narration/libra/move.mp3",
  );
  await clock.advance(200);
  assert.deepEqual(completes, [{ id: "notice", at: 125 }]);
  audio[0].emit("ended");
  await flushMicrotasks();
  await clock.advance(39);
  assert.equal(completes.length, 1);
  await clock.advance(1);

  assert.deepEqual(await playback, {
    status: "completed",
    completedCueIds: ["notice", "move"],
  });
  assert.deepEqual(completes, [
    { id: "notice", at: 125 },
    { id: "move", at: 365 },
  ]);
});

async function runSilentSchedule({ muted, rejectPlayback }) {
  const clock = new FakeClock();
  const events = [];
  let createCount = 0;
  const player = createGameNarrationPlayer(manifest(), {
    timers: clock.timers,
    isSoundEnabled: () => !muted,
    createAudio() {
      createCount += 1;
      const element = new FakeAudio();
      if (rejectPlayback) {
        element.playResult = Promise.reject(new Error("audio blocked"));
      }
      return element;
    },
  });

  const playback = player.play(["notice"], {
    onCueStart: () => events.push(["start", clock.now]),
    onCueComplete: () => events.push(["complete", clock.now]),
  });
  await flushMicrotasks();
  await clock.advance(100);
  await clock.advance(25);
  return { result: await playback, events, createCount };
}

test("muted and failed audio use the same deliberately slow schedule", async () => {
  const muted = await runSilentSchedule({ muted: true, rejectPlayback: false });
  const failed = await runSilentSchedule({ muted: false, rejectPlayback: true });

  assert.deepEqual(muted.events, [
    ["start", 0],
    ["complete", 125],
  ]);
  assert.deepEqual(failed.events, muted.events);
  assert.equal(muted.createCount, 0);
  assert.equal(failed.createCount, 1);
  assert.equal(muted.result.status, "completed");
  assert.equal(failed.result.status, "completed");
});

test("turning sound off silences the clip without shortening the cue", async () => {
  const clock = new FakeClock();
  const audio = [];
  const events = [];
  const player = createGameNarrationPlayer(manifest(), {
    timers: clock.timers,
    createAudio() {
      const element = new FakeAudio();
      audio.push(element);
      return element;
    },
  });

  const playback = player.play(["notice"], {
    onCueComplete: () => events.push(clock.now),
  });
  await flushMicrotasks();
  await clock.advance(20);
  player.setEnabled(false);
  assert.ok(audio[0].pauseCalls >= 2);
  assert.equal(audio[0].currentTime, 0);
  await clock.advance(79);
  assert.deepEqual(events, []);
  await clock.advance(1);
  await clock.advance(25);
  assert.deepEqual(events, [125]);
  assert.equal((await playback).status, "completed");
});

test("a direct gesture primes and then reuses the same silent media element", async () => {
  const clock = new FakeClock();
  const audio = [];
  const player = createGameNarrationPlayer(manifest(), {
    basePath: "/nonverbal-reasoning-games",
    timers: clock.timers,
    createAudio() {
      const element = new FakeAudio();
      audio.push(element);
      return element;
    },
  });

  player.prime();
  assert.equal(audio.length, 1);
  assert.equal(
    audio[0].src,
    `/nonverbal-reasoning-games${GAME_NARRATION_UNLOCK_SRC}`,
  );
  assert.equal(audio[0].playCalls, 1);

  const playback = player.play(["notice"]);
  await flushMicrotasks();
  assert.equal(audio.length, 1);
  assert.equal(
    audio[0].src,
    "/nonverbal-reasoning-games/narration/libra/notice.mp3",
  );
  assert.equal(audio[0].playCalls, 2);
  audio[0].emit("ended");
  await clock.advance(100);
  await clock.advance(25);
  assert.equal((await playback).status, "completed");
});

test("a stalled media element times out without locking the proof", async () => {
  const clock = new FakeClock();
  const audio = [];
  const player = createGameNarrationPlayer(manifest(), {
    timers: clock.timers,
    audioStallGraceMs: 20,
    createAudio() {
      const element = new FakeAudio();
      audio.push(element);
      return element;
    },
  });

  const playback = player.play(["notice"]);
  await flushMicrotasks();
  await clock.advance(99);
  assert.equal(audio[0].pauseCalls, 1, "cue preparation pauses stale media");
  await clock.advance(1);
  assert.ok(audio[0].pauseCalls >= 2, "watchdog stops the stalled clip");
  await clock.advance(25);
  assert.deepEqual(await playback, {
    status: "completed",
    completedCueIds: ["notice"],
  });
});

test("cancel and dispose clear timers and media listeners and ignore stale events", async () => {
  const clock = new FakeClock();
  const audio = [];
  const completed = [];
  const player = createGameNarrationPlayer(manifest(), {
    timers: clock.timers,
    createAudio() {
      const element = new FakeAudio();
      audio.push(element);
      return element;
    },
  });

  const firstPlayback = player.play(["notice"], {
    onCueComplete: (cue) => completed.push(cue.id),
  });
  await flushMicrotasks();
  assert.equal(clock.jobs.size, 2, "visual and audio watchdog timers are live");
  assert.equal(audio[0].listenerCount(), 2);
  const staleEndedListeners = [
    ...(audio[0].listeners.get("ended") ?? []),
  ];

  const secondPlayback = player.play(["move"], {
    onCueComplete: (cue) => completed.push(cue.id),
  });
  await flushMicrotasks();
  assert.deepEqual(await firstPlayback, {
    status: "cancelled",
    completedCueIds: [],
  });
  assert.equal(audio.length, 1, "the second run reuses the same media element");
  assert.equal(audio[0].listenerCount(), 2);
  assert.ok(audio[0].pauseCalls >= 1);
  assert.equal(audio[0].currentTime, 0);
  for (const listener of staleEndedListeners) listener({ type: "ended" });
  assert.deepEqual(completed, []);

  player.dispose();
  await flushMicrotasks();
  assert.deepEqual(await secondPlayback, {
    status: "cancelled",
    completedCueIds: [],
  });
  assert.equal(clock.jobs.size, 0);
  assert.equal(audio[0].listenerCount(), 0);
  assert.deepEqual(await player.play(["notice"]), {
    status: "disposed",
    completedCueIds: [],
  });
});
