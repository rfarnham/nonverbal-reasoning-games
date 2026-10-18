# Memory Lab spoken digit provenance

The nine spoken digit recordings were generated offline on the CPU from
[`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M), pinned revision
`f3ff3571791e39611d31c381e3a41a3af07b4987`, using voice `af_heart`, speed `0.88`,
and the Kokoro Python package `0.9.4`.

Kokoro-82M is distributed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
The model and inference software run only during offline asset preparation;
neither is downloaded or executed by the website.

The generated recordings use a 24,000 Hz sample rate. Edge silence was trimmed
offline with FFmpeg, then the recordings were encoded as 48 kbit/s MP3 files
using `libmp3lame`. Exact durations, source-file SHA-256 hashes, postprocessing
settings, and narrator metadata are retained in
[`content/narration/working-memory.json`](https://github.com/rfarnham/nonverbal-reasoning-games/blob/main/content/narration/working-memory.json).

The deployed recordings are authenticated AES-256-GCM ciphertext within the
Memory Lab vault. After unlocking, the browser decrypts them into temporary
audio Blob URLs and revokes those URLs when the lab closes. The virtual digit
paths in the narration manifest do not publish plaintext audio files. No
speech service or browser text-to-speech is used during practice.
