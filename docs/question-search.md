# Question bank search

The `/question-search/` route is a static research tool. Its browser and local
agent interface use the same versioned corpus and deterministic retrieval engine.
No AI API key or application server is required. Question text, descriptions,
answer data, and source images are encrypted before entering `public/`.

## Access and privacy

This is shared-password encryption, not individual GitHub authentication. Give
the password only to designated contributors through a separate channel. Keep
the password out of commits, build arguments, URLs, screenshots, and public
reports. The app derives its decryption key in memory using PBKDF2-SHA256 and
decrypts authenticated AES-256-GCM files locally. Neither the password nor
decrypted content needs to be sent to an AI provider to search.

The public manifest reveals format, corpus version, count, and encrypted file
sizes. Anyone can download the ciphertext and attempt offline password guesses:
use a strong randomly generated password. An authorized reader can copy unlocked
content. Rotating a password protects newly encrypted packs but cannot revoke
previously downloaded packs or plaintext. Encryption does not remove material
already published elsewhere or from repository history. Per-person revocation
would require a separate authenticated delivery service or private distribution.

The corpus retains explicit annotation provenance. Search tags and method
descriptions can be heuristic or machine-reviewed; they are retrieval evidence,
not verified solutions. Images remain necessary for judging visual questions.
Shared vocabulary, visual resemblance, and ranking scores do not prove a shared
solution strategy.

## Build a pack

Use Node 22+ and Python with Pillow and NumPy. Keep source files and all plaintext outputs
under the ignored `work/` directory. The source SQLite bank is read-only.

```sh
python3 scripts/export-question-search.py --source-root /path/to/source-checkout
python3 scripts/build-question-search-lsa.py \
  --corpus work/question-search-build/corpus.json \
  --assets work/question-search-build/assets.json
node scripts/encrypt-question-search.mjs \
  --corpus work/question-search-build/corpus.json \
  --assets work/question-search-build/assets.json \
  --benchmark work/question-search-build/benchmark.json \
  --output public/question-search/data \
  --password-file /private/search-password.txt
```

Omit `--benchmark` when no reviewed benchmark is available. The exporter also
accepts `--bank`, `--annotations`, and `--created-at`; run `--help` for details.
Reviewed enrichment JSONL must identify each record, evidence, and its review
status. `assets.json` includes local source paths and is private build input.
Do not copy either plaintext JSON file into the website.

The LSA builder invokes `scripts/tokenize-question-search.mjs` through Node so
training and browser queries share the exact tokenizer. Use its `--node` option
if Node is not on PATH. It adds the compact projection to the corpus and updates
the corpus and asset-map versions together. Run it after exporting and before
encrypting; it does not change individual question versions. A benchmark that
was prepared before this step may update its corpus version only after checking
that every referenced question version still matches.

The encryptor accepts `QUESTION_SEARCH_PASSWORD` as an alternative to a password
file. Rebuilding encryption changes salt and IVs. A corpus version identifies
its content; per-question versions keep judgments tied to the records inspected.
Changing labels or source content requires reviewing affected judgments rather
than silently carrying them forward.

The search implementation ranks every eligible record. It combines source text,
structure descriptions, methods, taxonomy facets, an optional corpus-trained
LSA projection, and optional visual fingerprints. LSA is a compact statistical
text model, not a vision model or a verified strategy classifier. The `text`
mode is the lexical comparison baseline. Visual hashes
help recognize similar source images; they do not understand a new diagram.
Network-free retrieval begins once the pack is loaded. Do not assume every
question image has been downloaded merely because text search is available.
The browser's explicit offline-download action caches the encrypted bank,
images, and local OCR/runtime assets on this device. Browser storage can be
evicted, so confirm download completion before disconnecting. Uploaded images
can be read by bundled local OCR; extracted text remains editable. OCR transcribes
words, not the mathematical meaning of an unfamiliar diagram.

## Local agent interface

```sh
node scripts/query-question-search.mjs \
  --manifest public/question-search/data/manifest.json \
  --password-file /private/search-password.txt \
  --query 'undo successive operations to recover the initial quantity' --limit 50

node scripts/query-question-search.mjs \
  --corpus work/question-search-build/corpus.json \
  --question QUESTION_ID --details
```

`--ids ID1,ID2` retrieves exact records; `--query-file private-recipe.json` accepts
the same validated query object as the browser. `--offset` paginates results.
`--details` includes the full evidence and method fields. JSON output can contain
private material; redirect it only to a private destination. No password is
accepted as a literal command-line argument or printed by these scripts.

An agent should interpret the input, search multiple plausible methods, inspect
original question diagrams, and refine the search. Use inferred facets as
hypotheses: an incorrect hard filter can hide the best match. Separate close
variants, the same method in another context, adaptations, related skills, and
uncertain candidates. The reusable workflow is in
[the question-bank-search skill](../.agents/skills/question-bank-search/SKILL.md).

## ChatGPT without an API key

Ask ChatGPT to analyze the supplied question and produce a recipe such as:

```json
{
  "text": "Recover an initial quantity by reversing a sequence of halvings and subtractions. Work backward, undo operations in reverse order.",
  "mode": "hybrid",
  "limit": 50
}
```

Run the recipe in the unlocked browser or CLI, then provide selected candidate
records and their diagrams back to ChatGPT for comparison. The user controls
that disclosure. Keep the unlock password out of the candidate packet. A
ChatGPT environment that can execute local files can run the CLI directly;
ordinary browsing of an encrypted page is not an automatic search integration.
The skill does not introduce an MCP server, a plugin service, or an API credential.

## Evaluation and contributor judgments

```sh
node scripts/evaluate-question-search.mjs \
  --corpus work/question-search-build/corpus.json \
  --judgments work/question-search-build/benchmark.json \
  --mode hybrid --split heldout

node scripts/evaluate-question-search.mjs \
  --manifest public/question-search/data/manifest.json \
  --password-file /private/search-password.txt --split heldout
```

With `--manifest` and no `--judgments`, the evaluator decrypts the sibling
`benchmark.bin` in memory. This reproduces the bundled evaluation without saving
plaintext question or judgment files.

Repeat with `--mode text` for the lexical baseline and `--exclude-family` to
exclude variants with the same recorded family. Family exclusion is only as
complete as those labels: the first exporter uses conservative exact identity,
not a semantic duplicate detector. A family-disjoint benchmark requires reviewed
family memberships and cannot be claimed merely from this switch.

Benchmark format:

```json
{
  "schemaVersion": 1,
  "corpusVersion": "CONTENT_VERSION",
  "provenance": "machine-reviewed",
  "cases": [
    { "queryId": "QUERY_ID", "queryVersion": "VERSION", "split": "heldout" }
  ],
  "judgments": [
    {
      "queryId": "QUERY_ID", "queryVersion": "VERSION",
      "candidateId": "CANDIDATE_ID", "candidateVersion": "VERSION",
      "grade": 3, "relationship": "same_method",
      "reason": "The same key solution move, verified against both originals.",
      "reviewer": "CONTRIBUTOR", "createdAt": "ISO_TIMESTAMP"
    }
  ]
}
```

Grade 3 means the same core move; 2 is a useful adaptation; 1 is a neighboring
skill or surface resemblance; 0 is unrelated; null is uncertain. Valid
relationships are `same_method`, `adaptation`, `related_skill`, `surface_only`,
`unrelated`, and `uncertain`. Leave uninspected candidates unjudged.

The evaluator distinguishes known-question text lookup from leave-one-out
retrieval. Leave-one-out uses only the source prompt, excludes the query itself,
and measures Recall@20/50/100 against current, independently judged positives
with grade 2 or 3. It never supplies the query's stored strategy or description.
Missing/stale records and queries with no eligible positives are reported as
skipped, not as successes. A partial judgment set cannot measure exhaustive
corpus recall. nDCG@10 is reported only when every returned top-ten candidate is
judged, and remains relative to the known judgment pool. Its separate judgment
coverage makes that limitation visible.

The initial private benchmark is a small purposive machine-reviewed pilot with
source-text and selected diagram inspection. It is not human-adjudicated or a
representative gold standard. Keep held-out judgments frozen; inspect failed
development queries to improve enrichment. Extend the benchmark with different
stories sharing a method, misleading visual neighbors, genuine external inputs,
paraphrases, image crops, and OCR errors. The current command measures source-text
retrieval, not end-to-end image interpretation or OCR accuracy.

The initial 12-query, 44-pair pilot produced the following results with the
64-dimensional LSA pack (`6cbdd4b330f1094820f74ec939db14888367ded7e39bf999fa5215976c4f7d87`).
Percentages are macro averages of **known-positive** recall per query.

| Split | Retrieval | Recall@20 | Recall@50 | Recall@100 |
| --- | --- | ---: | ---: | ---: |
| All 12 | Text | 63.9% | 66.7% | 76.4% |
| All 12 | Hybrid | 59.7% | 70.8% | 87.5% |
| Held-out 6 | Text | 36.1% | 41.7% | 52.8% |
| Held-out 6 | Hybrid | 36.1% | 50.0% | 75.0% |

This pilot supports using a larger candidate set for agent inspection; it does
not establish better ranking at the top twenty. One held-out query still had no
strong known match in the hybrid top hundred. nDCG was withheld because the
top-ten lists were not fully judged. Known-question text lookup found the source
in the first ten for all twelve queries in both modes; this is a separate,
easier task. No weights were tuned on these held-out results. Exact-family
exclusion currently removes no additional records for this pilot, so these
numbers are not evidence of leave-variant-family-out quality.
