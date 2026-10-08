# Homework Arcade

A single-page, untimed practice game. Homework prompts, source documents, images, teacher notes, links, audio, and answer keys are encrypted before publication. The public site contains its interface, practice scheduler, difficulty priors keyed by opaque IDs, and ciphertext.
## Protection

The browser derives an AES-256-GCM key from the entered password using PBKDF2-SHA-256 with 600,000 iterations and a random 16-byte salt. Every encrypted file has a unique random 12-byte nonce and authenticated file context. The password and key are never included in the repository or stored in browser storage. Locking clears decrypted content, cancels speech and timers, and revokes document/image URLs. Only opaque question IDs, numeric practice outcomes, generic skill identifiers, and completion statistics persist on this device. Adaptive storage is validated against the unlocked item bank. Prompts, answers, audio, images, documents, and source correspondence remain encrypted.

GitHub Pages serves the encrypted files publicly. The materials remain private to holders of the password; a short password can still be guessed offline. Use a long unique passphrase for stronger protection.

## Run

First run `python3 scripts/homework-vault-archive.py unpack`. Then run `python -m http.server 4173 --directory public/homework-arcade`, then open `http://localhost:4173`. Web Crypto requires HTTPS or localhost.

## Update materials

Keep source files outside this checkout. Run `node scripts/encrypt-homework-vault.mjs /absolute/path/to/source/manifest.json` and provide the password on standard input. The source folder also contains `verbal.json`, `memory-math.json`, `picture.json`, `external-links.json`, and a complete `audio-manifest.json` with private local paths to generated clips. Never commit source files or plaintext generated data. Encryption produces `vault/manifest.json` and randomly named ciphertext files, then packages those files into hash-verified ciphertext bundles under `work/homework-arcade-ciphertext/`. Commit only the bundles and their technical manifest; the loose vault directory is generated and ignored by Git. The encryption script preserves all original bytes and verifies every encrypted output before finishing.

The build first verifies and restores the encrypted files from the bundles using `scripts/homework-vault-archive.py`. Neither packaging nor restoration requires the password or decrypts any material. The existing static export copies `public/homework-arcade/` into the Pages artifact. This is a standalone homework game with source-specific auditory presentation. Per the prep request, practice changes question order and continues after mistakes instead of applying worksheet miss cutoffs. Listening, stimulus hiding, replay limits, response types, and recall timing remain intact. Original administration instructions remain available with the encrypted materials. The source materials and their spoken renditions retain their original rights; they are not granted under the repository’s MIT license.

Narration is generated locally with Kokoro-82M v1.0 using the af_heart voice at speed 0.94. All narration clips are encrypted with the materials. Playback does not call a third-party speech service. The sequence introduction includes the two supplied practice examples and must finish before any trial. Auditory questions hide the written stimulus, symbol audio is scheduled one item per second with a falling final cue, and vocabulary is reviewed using the supplied descriptive 0/1/2-point examples. Point values describe practice answers, not an IQ result.

Correct answers advance after 1.5 seconds. Use **Stay here** to keep the explanation on screen, or **Next challenge** to continue immediately. Partial vocabulary or recall results and incorrect answers stay available for review. Opening a worksheet pauses automatic advancement. Leaving the question or locking cancels the pending move.

## Adaptive practice

Adaptive practice is the primary home-screen action. Choose one skill; each skill saves its own target on this device. Six tracks cover 362 activities: picture similarities, spoken similarities, vocabulary, letter-number sequences, analogies, and word classification. Other homework remains in Browse.

The source-order tracks start in band 4 of 5; sequences start with four spoken tokens. Similarity tiers follow the source’s broadly progressive order. Vocabulary order is a provisional prior, not verified word difficulty. Analogies and classification use reviewed relational/category demands and distractors, recorded as opaque-ID difficulty metadata. Five ambiguous or poorly matched items remain browse-only. Sequence difficulty follows actual token count. These are practice estimates, not age norms or cognitive scores.

The first four graded responses locate a starting target. Two fresh independent successes raise the target during calibration; three raise it during continuing practice. An unmet answer lowers the target, supported success holds it, and a pass does not lower it. Coach controls can steer the next question harder or gentler without adding a pretend answer. Mistakes never end a session; **Finish practice** is voluntary.

Try independently before using a strategy clue. A wrong answer corrected on retry, a declared clue, opening a worksheet before answering, or **Solved with coaching** records supported practice. Parent comparison of an answer already given can still record independence; rubric panels provide explicit independent/support choices. Partial vocabulary meaning is not full success. Only one completed adaptive outcome is committed per question, including leaving during correct feedback. Familiar review successes cannot promote the target: fresh items check independent transfer. Known ordinary-practice exposures and presented passes count as familiar; passing before presentation does not. Recalibration keeps this familiarity. Supported and unmet items can return after at least three intervening trials, with review limited while new parallel questions remain.

The scheduler is deterministic and tested with simulated learning histories, bounds, corruption, per-skill isolation, novelty, spaced reviews, and continuous misses. Source content and narration do not change when the practice target changes.
