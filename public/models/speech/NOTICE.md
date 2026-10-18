# Local spoken-digit recognition

The speech model and runtime below run entirely on the player's device. They are
served from this repository's own static origin after the player chooses setup.
There is no Web Speech API, remote recognition fallback, microphone upload, or
analytics. The microphone is requested separately, only when recording an answer.
Raw PCM and the answer transcript remain in memory; the worker's IndexedDB
filesystem caches model files, not microphone audio or answers.

## Sources and attribution

- **Vosk small US English 0.15** — Copyright 2020 Alpha Cephei Inc., Apache 2.0.
  [Official model list](https://alphacephei.com/vosk/models) describes this model
  as a lightweight wideband Android/Raspberry Pi model and lists its license.
  [Original ZIP](https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip).
  The acoustic model and language files are unchanged; ZIP contents are repacked
  deterministically as the tar.gz required by the browser runtime.
  See `MODEL-README.txt` and `LICENSE-vosk.txt`.
- **vosk-browser 0.0.8** — Ciaran O'Reilly and contributors, Apache 2.0.
  [Source](https://github.com/ccoreilly/vosk-browser),
  [API and archive format](https://github.com/ccoreilly/vosk-browser/blob/master/lib/README.md),
  [published package](https://www.npmjs.com/package/vosk-browser/v/0.0.8).
  The published JavaScript embeds a single-threaded WebAssembly build of Vosk.
  We extract its embedded worker as a static same-origin file; the only semantic
  patch renames the explicit final-flush event to `finalresult`, separating it
  from streaming endpoint events. Existing source notices remain intact.
  See `LICENSE-vosk-browser.txt`.
- The upstream runtime links Vosk/Kaldi, OpenFst, CLAPACK/BLAS, zlib, and
  libarchive. Its [build recipe](https://github.com/ccoreilly/vosk-browser/blob/master/builder/Dockerfile)
  and [link configuration](https://github.com/ccoreilly/vosk-browser/blob/master/src/Makefile)
  document these dependencies. Included license files retain their notices.
  The worker also retains its embedded Microsoft TypeScript helper notice.

`manifest.json` records original source SHA-256 hashes and the exact deployed
asset sizes/hashes. Each deployed file is below GitHub's 100 MiB file limit.
`python3 scripts/prepare-local-digit-speech.py /path/to/download-cache`
recreates model/runtime assets from the pinned sources and verifies their hashes.
This is an explicit maintenance command, never part of player setup or a build.

## Device requirements and recognition limits

The first setup transfers approximately **46 MB** including the runtime.
The model expands to approximately 71 MB of device-local model storage.
Upstream estimates roughly 300 MB of runtime memory for small models; actual
memory and startup time vary by browser. Secure-context microphone access,
WebAssembly, workers, IndexedDB, and AudioWorklet are needed. No WebGPU,
SharedArrayBuffer, cross-origin isolation, or server process is required.
The keypad remains available if a device cannot run local speech.

A fixed grammar accepts **one through nine**, plus an unknown token. The
recognizer never receives the task's expected answer or required sequence order.
Unknown words, silence, missing confidence, and low-confidence results return an
uncertain result. Confidence is a heuristic, not a validated error detector:
players must inspect the recognized answer before committing it. Microphone
failure or recognition uncertainty is a technical retry, not a memory error.
Recording stops on explicit stop, cancel, pause/lock, or a 45-second safety cap.

## Real inference verification

On 2026-10-18, the actual WASM runtime recognized a five-digit test assembled
from human recordings by four speakers in the
[Free Spoken Digit Dataset](https://github.com/Jakobovski/free-spoken-digit-dataset)
(Jackson 3/6, Nicolas 1, George 7, Theo 2, recording 0). These temporary test
recordings are not distributed with this app. The same 5.565-second WAV passed
both arbitrary offline PCM inference and the real MediaStream → AudioWorklet →
WASM path, using Chromium's file-backed microphone. Silence was rejected.
All requests were same-origin GETs; no upload request or console error occurred.
Offline inference took about 0.51 seconds on the cloud test CPU. This is a smoke
test, not an accuracy study or a phone-performance guarantee.

To repeat with an independently supplied 16 kHz mono WAV:

```sh
LOCAL_ASR_TEST_WAV=/absolute/path/digits.wav \
LOCAL_ASR_TEST_DIGITS=3,1,7,2,6 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
node --test tests/browser/local-digit-recognition.actual.test.mjs
```

The test's expected digits are used only in assertions and never enter ASR.
