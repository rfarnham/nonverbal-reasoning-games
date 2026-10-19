# Memory Lab spoken digit provenance

The nine spoken digit recordings were generated offline on the CPU from
[`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M), pinned revision
`f3ff3571791e39611d31c381e3a41a3af07b4987`, using voice `af_heart`, speed `0.88`,
and the Kokoro Python package `0.9.4`.

Kokoro-82M is distributed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
The model and inference software run only during offline asset preparation;
neither is downloaded or executed by the website.

The voice renders a continuous, deliberately spaced list in one inference.
Every selected digit comes from the interior of that list, with three words
before and after the selected range. The words are not generated as separate
sentences. Explicit phoneme tokens retain the punctuation pauses consistently.

The generated recordings use a native 24,000 Hz sample rate. Whole words are
cut in quiet gaps located from model alignment and the source waveform. Each
cut must contain a 20 ms window below −52 dBFS before the shared peak adjustment.
A 5 ms fade in that quiet region
and 35 ms of silence on each end prevent abrupt playback boundaries. The
complete source receives one shared peak adjustment; individual words are not
independently normalized. Lossless 24-bit PCM source files stay outside the
public repository. The deployed clips use `libmp3lame` at 160 kbit/s, the maximum
MP3 bitrate at this native sample rate. The generator decodes every encoded
clip and checks for silent edges, clipping, and unexpected low volume.

Exact durations, source and clip SHA-256 hashes, extraction sample offsets,
postprocessing settings, and narrator metadata are retained in
[`content/narration/working-memory.json`](https://github.com/rfarnham/nonverbal-reasoning-games/blob/main/content/narration/working-memory.json).
The reproducible build recipe is
[`scripts/generate-working-memory-audio.py`](https://github.com/rfarnham/nonverbal-reasoning-games/blob/main/scripts/generate-working-memory-audio.py).
It fixes the inference seed and CPU thread count as well as model provenance.

The deployed recordings are authenticated AES-256-GCM ciphertext within the
Memory Lab vault. After unlocking, the browser decrypts them into temporary
audio Blob URLs and revokes those URLs when the lab closes. The virtual digit
paths in the narration manifest do not publish plaintext audio files. No
speech service or browser text-to-speech is used during practice.

To refresh audio without replacing the device-progress encryption key, use
`scripts/refresh-working-memory-audio.mjs` with a private audio directory and
`WORKING_MEMORY_PASSWORD` or a private password file. It authenticates the old
pack first, verifies every source clip hash, and retains the encryption salt
and pack version. By default the encrypted content is retained byte for byte;
an optional private `--source` replaces validated content under the same key.
