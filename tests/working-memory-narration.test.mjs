import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryNarrator,
  MEMORY_DIGIT_NARRATION,
} from "../app/lab/working-memory/narration.ts";
import { SUITE_NARRATOR_PROVENANCE } from "../lib/game-narration.ts";

class FakeAudio {
  src = "";
  preload = "";
  currentTime = 0;
  sources = [];
  listeners = new Map();
  reject = false;
  stall = false;
  addEventListener(type, listener) {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type));
  }
  play() {
    this.sources.push(this.src);
    if (this.reject) return Promise.reject(new Error("Blocked playback"));
    if (!this.stall) setImmediate(() => this.emit("ended"));
    return Promise.resolve();
  }
  pause() {}
  load() {}
}

const urls = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [
  `/working-memory/audio/digit-${i + 1}.mp3`, `blob:private-digit-${i + 1}`,
]));
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("neural digit vocabulary pins the suite voice and contains no exercise content", () => {
  assert.deepEqual(MEMORY_DIGIT_NARRATION.provenance, SUITE_NARRATOR_PROVENANCE);
  assert.deepEqual(Object.keys(MEMORY_DIGIT_NARRATION.clips), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  for (const [id, clip] of Object.entries(MEMORY_DIGIT_NARRATION.clips)) {
    assert.equal(clip.src, `/working-memory/audio/digit-${id}.mp3`);
    assert.equal(clip.minimumVisualMs, 800);
    assert.equal(clip.lingerMs, 200);
  }
});

test("one reusable narrator resolves base-path assets only into decrypted blobs", async () => {
  const audio = new FakeAudio();
  let created = 0;
  const narrator = createMemoryNarrator(urls, {
    basePath: "/nonverbal-reasoning-games",
    isSoundEnabled: () => true,
    createElement: () => { created++; return audio; },
  });
  narrator.prime();
  const run = narrator.play(["1", "9"]);
  await nextTurn();
  assert.equal(audio.src, "blob:private-digit-1");
  assert.deepEqual(audio.sources.slice(0, 2), [
    "/nonverbal-reasoning-games/audio/narration/narration-unlock.mp3",
    "blob:private-digit-1",
  ]);
  assert.equal(narrator.didPlaybackFail(), false);
  narrator.cancel();
  assert.equal((await run).status, "cancelled");
  assert.equal(created, 1);
  narrator.dispose();
  assert.equal([...audio.listeners.values()].every((set) => set.size === 0), true);
});

test("missing decrypted audio never requests a plaintext digit", async () => {
  const audio = new FakeAudio();
  let failureCount = 0;
  const narrator = createMemoryNarrator({}, {
    isSoundEnabled: () => true,
    createElement: () => audio,
    onPlaybackFailure: () => failureCount++,
  });
  const run = narrator.play(["2"]);
  await nextTurn();
  assert.equal(narrator.didPlaybackFail(), true);
  assert.equal(failureCount, 1);
  assert.deepEqual(audio.sources, []);
  narrator.cancel();
  await run;
  narrator.dispose();
});

test("a failed gesture-time prime cannot cache a silently unavailable narrator", async () => {
  let failures = 0;
  const narrator = createMemoryNarrator(urls, {
    isSoundEnabled: () => true,
    createElement: () => { throw new Error("Audio is unavailable"); },
    onPlaybackFailure: () => failures++,
  });
  narrator.prime();
  assert.equal(failures, 0);
  const run = narrator.play(["1"]);
  await nextTurn();
  assert.equal(narrator.didPlaybackFail(), true);
  assert.equal(failures, 1);
  narrator.cancel();
  await run;
  narrator.dispose();
});

test("media preparation failures during prime or playback are always reported", async () => {
  for (const phase of ["prime", "playback"]) {
    for (const property of ["src", "preload", "load"]) {
      const audio = new FakeAudio();
      let throwNow = phase === "prime";
      if (property === "load") {
        audio.load = () => { if (throwNow) throw new Error("Unavailable media"); };
      } else {
        let value = "";
        Object.defineProperty(audio, property, {
          get: () => value,
          set: (next) => {
            if (throwNow) throw new Error("Unavailable media");
            value = next;
          },
        });
      }
      let failures = 0;
      const narrator = createMemoryNarrator(urls, {
        isSoundEnabled: () => true,
        createElement: () => audio,
        onPlaybackFailure: () => failures++,
      });
      narrator.prime();
      throwNow = true;
      const run = narrator.play(["2"]);
      await nextTurn();
      assert.equal(narrator.didPlaybackFail(), true, `${property} during ${phase}`);
      assert.equal(failures, 1);
      narrator.cancel();
      await run;
      narrator.dispose();
    }
  }
});

test("rejected or muted narration is reported so unheard trials cannot be scored", async () => {
  for (const soundEnabled of [true, false]) {
    const audio = new FakeAudio();
    audio.reject = true;
    let failures = 0;
    const narrator = createMemoryNarrator(urls, {
      isSoundEnabled: () => soundEnabled,
      createElement: () => audio,
      onPlaybackFailure: () => failures++,
    });
    const run = narrator.play(["3"]);
    await nextTurn();
    assert.equal(narrator.didPlaybackFail(), true);
    assert.equal(failures, 1);
    narrator.cancel();
    await run;
    narrator.dispose();
  }
});

test("a stalled clip reports failure before the shared recovery can advance silently", async () => {
  const audio = new FakeAudio();
  audio.stall = true;
  let signalFailure;
  const failure = new Promise((resolve) => { signalFailure = resolve; });
  const narrator = createMemoryNarrator(urls, {
    isSoundEnabled: () => true,
    createElement: () => audio,
    stallGraceMs: 0,
    onPlaybackFailure: signalFailure,
  });
  const run = narrator.play(["4"]);
  await failure;
  assert.equal(narrator.didPlaybackFail(), true);
  narrator.cancel();
  assert.equal((await run).status, "cancelled");
  narrator.dispose();
});
