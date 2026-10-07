# Homework Arcade

A single-page, untimed practice game. All homework content, source documents, images, teacher notes, links, and answer keys are encrypted before publication. The public site contains only its interface and ciphertext.

## Protection

The browser derives an AES-256-GCM key from the entered password using PBKDF2-SHA-256 with 600,000 iterations and a random 16-byte salt. Every encrypted file has a unique random 12-byte nonce and authenticated file context. The password and key are never included in the repository or stored in browser storage. Locking clears decrypted content, cancels speech and timers, and revokes document/image URLs. Only opaque question IDs and completion statistics persist on this device.

GitHub Pages serves the encrypted files publicly. The materials remain private to holders of the password; a short password can still be guessed offline. Use a long unique passphrase for stronger protection.

## Run

First run `python3 scripts/homework-vault-archive.py unpack`. Then run `python -m http.server 4173 --directory public/homework-arcade`, then open `http://localhost:4173`. Web Crypto requires HTTPS or localhost.

## Update materials

Keep source files outside this checkout. Run `node scripts/encrypt-homework-vault.mjs /absolute/path/to/source/manifest.json` and provide the password on standard input. The source folder also contains `verbal.json`, `memory-math.json`, `picture.json`, `external-links.json`, and a complete `audio-manifest.json` with private local paths to generated clips. Never commit source files or plaintext generated data. Encryption produces `vault/manifest.json` and randomly named ciphertext files, then packages those files into hash-verified ciphertext bundles under `work/homework-arcade-ciphertext/`. Commit only the bundles and their technical manifest; the loose vault directory is generated and ignored by Git. The encryption script preserves all original bytes and verifies every encrypted output before finishing.

The build first verifies and restores the encrypted files from the bundles using `scripts/homework-vault-archive.py`. Neither packaging nor restoration requires the password or decrypts any material. The existing static export copies `public/homework-arcade/` into the Pages artifact. This is a standalone homework game with source-specific auditory administration, rather than a Spatial Gym campaign or an Infinite puzzle generator. The requested worksheet rules control its order, response types, presentation, and stop rules. Its encrypted source materials and their spoken renditions retain their original rights; they are not granted under the repository’s MIT license.

Narration is generated locally with Kokoro-82M v1.0 using the af_heart voice at speed 0.94. All narration clips are encrypted with the materials. Playback does not call a third-party speech service. The sequence introduction includes the two supplied practice examples and must finish before any trial. Auditory questions hide the written stimulus, symbol audio is scheduled one item per second with a falling final cue, and vocabulary is reviewed using the supplied descriptive 0/1/2-point examples. Point values describe practice answers, not an IQ result.

Correct answers advance after 1.5 seconds. Use **Stay here** to keep the explanation on screen, or **Next challenge** to continue immediately. Partial vocabulary or recall results and incorrect answers stay available for review. Opening a worksheet pauses automatic advancement. Leaving the question or locking cancels the pending move.
