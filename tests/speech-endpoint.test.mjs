import assert from "node:assert/strict";
import test from "node:test";
import { SpeechEndpoint, SPEECH_ENDPOINT_TIMING } from "../app/lab/working-memory/speech-endpoint.ts";

function tone(milliseconds, amplitude = 0.08) {
  return Float32Array.from({ length: milliseconds * 16 }, (_, sample) => amplitude * Math.sin(2 * Math.PI * 220 * sample / 16_000));
}

function quiet(milliseconds) { return new Float32Array(milliseconds * 16); }

test("speech endpoint waits through deliberate digit pauses, then fires exactly once", () => {
  const endpoint = new SpeechEndpoint();
  assert.equal(endpoint.push(tone(400)), false);
  assert.equal(endpoint.hasSpeech, true);
  assert.equal(endpoint.push(quiet(1_900)), false, "an interdigit pause shorter than the trailing interval stays open");
  assert.equal(endpoint.push(tone(400)), false);
  assert.equal(endpoint.push(quiet(1_980)), false);
  assert.equal(endpoint.push(quiet(20)), true);
  assert.equal(endpoint.push(quiet(5_000)), false, "an endpoint cannot emit twice");
  endpoint.confirmSpeech();
  assert.equal(endpoint.push(tone(500)), false, "late ASR or audio cannot revive a finished detector");
});

test("silence, microphone offset, quiet noise, and short handling bursts do not count as speech", () => {
  for (const samples of [quiet(10_000), new Float32Array(160_000).fill(0.3), tone(10_000, 0.004)]) {
    const endpoint = new SpeechEndpoint();
    assert.equal(endpoint.push(samples), false);
    assert.equal(endpoint.hasSpeech, false);
  }
  const endpoint = new SpeechEndpoint();
  for (let burst = 0; burst < 5; burst += 1) {
    assert.equal(endpoint.push(tone(100)), false);
    assert.equal(endpoint.push(quiet(300)), false);
  }
  assert.equal(endpoint.hasSpeech, false, "separate short noises cannot accumulate into an utterance");
});

test("changed local ASR speech evidence supports voices below the PCM gate", () => {
  const endpoint = new SpeechEndpoint();
  assert.equal(endpoint.push(tone(500, 0.003)), false);
  assert.equal(endpoint.hasSpeech, false);
  endpoint.confirmSpeech();
  assert.equal(endpoint.hasSpeech, true);
  assert.equal(endpoint.push(quiet(1_900)), false);
  endpoint.confirmSpeech();
  assert.equal(endpoint.push(quiet(1_980)), false);
  assert.equal(endpoint.push(quiet(20)), true);
});

test("worklet chunk boundaries do not change the endpoint", () => {
  const samples = new Float32Array(16 * 2_800);
  samples.set(tone(800));
  for (const chunkSize of [1, 127, 320, 2_048, samples.length]) {
    const endpoint = new SpeechEndpoint();
    let endpoints = 0;
    for (let offset = 0; offset < samples.length; offset += chunkSize) {
      if (endpoint.push(samples.slice(offset, offset + chunkSize))) endpoints += 1;
    }
    assert.equal(endpoints, 1, `chunk size ${chunkSize}`);
  }
  assert.deepEqual(SPEECH_ENDPOINT_TIMING, {
    noSpeechMs: 10_000, trailingSilenceMs: 2_000, minimumActivityMs: 160, maximumRecordingMs: 45_000,
  });
});
