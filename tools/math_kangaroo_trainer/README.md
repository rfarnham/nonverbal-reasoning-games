# Math Kangaroo adaptive core

This package is the offline, private-data foundation for the adaptive trainer
described in `docs/architecture/adr-0001-math-kangaroo-adaptive-core.md`. The
authoritative real-corpus evidence track currently remains at **Stage 0**: it
verifies the source database and declared PDFs, audits a representative sample,
records explicit review work, detects and routes exact duplicate candidates,
and produces reproducible quality reports. A separate, explicitly
non-authoritative Catalogue QA track now lets a teacher inspect proposals,
semantic neighbors, and policy previews over all 1,833 private items without
claiming that Stage 0 or Stage 1 passed. Corpus-independent Stage 1 contracts
and the Stage 2 event/replay spine are described in
`docs/architecture/adr-0002-deferred-stage0-review-and-synthetic-engine-development.md`.

It does **not** publish the private question bank, ship an LLM provider, infer
learner mastery, persist child data, or alter the existing Journey Math
Kangaroo corpus. The local QA browser may display private source and answer
evidence to its fixed teacher reviewer; evidence exports never include that
content.

## Deferred-review boundary

Human review can take place over time without weakening the evidence gate.
Until Stage 0 genuinely passes, real questions cannot cross the annotation
provider boundary and no real-corpus Stage 1 quality report can claim success.
The current continuation work is deliberately narrower:

- Stage 1 defines strict four-pass proposal schemas, trusted answer binding,
  question-scoped multimodal evidence, append-only annotation audit records,
  and gold-set metric contracts against invented fixtures.
- Stage 2 defines factual immutable events, idempotent in-memory storage,
  hint-derived assistance, version-correction chains, hash-verified persisted
  snapshots, and exact synthetic replay.
- Catalogue QA creates deterministic, unapproved lexical taxonomy proposals,
  a local surface latent-semantic index, a proposed-tag index, append-only
  teacher judgements, and an explainable policy simulator. These are review
  instruments, not approved Q-matrix, family, difficulty, or mastery evidence.

These are engineering contracts, not completed Stage 1 or Stage 2 exit gates.
There is no embedding/Q-matrix approval, reviewed strategy embedding, learner
model, production diagnostic/practice policy, or learner-facing service yet.

## Build and use the complete-corpus QA workbench

The catalogue is separate from the 180-item Stage 0 gold sample. Build it from
the complete canonical database and optionally carry the 700 legacy spatial
labels in as proposal provenance:

```bash
.venv/bin/math-kangaroo-trainer catalogue build \
  --source work/math-kangaroo-complete-question-bank/data/questions.sqlite3 \
  --output work/math-kangaroo-adaptive-engine/catalogue \
  --legacy-spatial work/math-kangaroo-spatial-review/report/ranked_questions.csv
```

The command verifies and indexes every source record, writes the separate
`corpus-review.sqlite3`, and builds three compact, same-device retrieval views:

- `surface`: feature-hashed unigram/bigram TF-IDF followed by deterministic
  latent semantic analysis;
- `tag`: normalized proposed taxonomy tags; and
- `hybrid`: versioned weights renormalized across the available views.

The planned strategy view is intentionally unavailable until reviewed solution
paths exist. Hybrid results say so. Semantic distance is never stored as
learner mastery or item difficulty.

Launch the private dashboard for one fixed teacher identity:

```bash
.venv/bin/math-kangaroo-trainer catalogue review-web \
  --catalogue-dir work/math-kangaroo-adaptive-engine/catalogue \
  --source work/math-kangaroo-complete-question-bank/data/questions.sqlite3 \
  --reviewer-id rfarnham \
  --port 8765
```

Open the printed loopback URL. The workbench provides:

- a **Problem Space** over all 1,833 questions: start from a random filtered
  question, an exact stable ID, or pasted question text; walk through nearby
  questions with Back/Forward history; and pan or zoom a labeled two-dimensional
  map filtered by grade, published point tier, domain, and question type;
- separate Surface, Proposed taxonomy, and Hybrid maps. Their deterministic
  PCA-plus-neighbor refinement is an exploratory navigation aid, not a UMAP,
  t-SNE, mastery, or difficulty model. The UI reports measured neighbor
  preservation and labels clusters from enriched unreviewed proposal tags;
- ontology skill inspection and append-only advisory approve/revise/merge/
  split/remove judgements;
- Similarity Lab comparisons across surface, tag, and hybrid neighbors with
  ratings such as same strategy, same skill/different surface, surface only,
  duplicate, or unrelated;
- Curriculum Lab policy previews with hard eligibility gates, logged score
  values, weights, contributions, distinct proposal/teacher-classified/
  curriculum-approved evidence labels, and explicit content gaps. It never
  presents a deterministic rank score as a selection probability. An optional target question feeds the
  surface-similarity proxy used to contrast near remediation with farther
  transfer, while recent item IDs independently drive repeat and redundancy
  controls; the preview warns that reviewed strategy similarity is still
  unavailable;
- the complete 1,833-question source/curriculum review queue; and
- an allowlisted evidence-only JSON export.

Pasted text stays in a same-origin POST body and is never copied into the URL.
Because pasted text has no reviewed taxonomy vector, Proposed taxonomy search
requires a stable catalogue ID and Hybrid pasted-text search honestly uses only
its Surface evidence. Queries with no supported corpus vocabulary return no
confident ranking instead of turning feature-hash collisions into apparent
matches.

One teacher judgement does not approve the ontology or prerequisite graph.
The recommendation preview does not read or update a child profile, and the
private source assets never enter tracked or public output.

## Set up

From the repository root, using Python 3.12:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e './tools/math_kangaroo_trainer[test]'
```

The tracked tests build an invented SQLite corpus in a temporary directory.
They never read `work/`:

```bash
.venv/bin/python -m pytest -q tools/math_kangaroo_trainer/tests/synthetic
```

## Run the private Stage 0 audit

The source and every generated artifact remain below ignored `work/` paths.
The adapter opens the canonical database in one read-only, query-only snapshot
that honors SQLite locking and WAL state. It verifies the database is unchanged
across the run, verifies every declared source PDF against its recorded byte
count and SHA-256 checksum, and writes to a separate derived audit database.
Question-scoped asset bytes also contribute to the reproducible corpus snapshot
and item content versions.

```bash
.venv/bin/math-kangaroo-trainer stage0 build \
  --source work/math-kangaroo-complete-question-bank/data/questions.sqlite3 \
  --output work/math-kangaroo-adaptive-engine/stage0 \
  --sample-size 180 \
  --seed 20260801
```

The command writes:

- `stage0-audit.sqlite3`: migrated, derived audit/review state;
- `source-inventory.jsonl`: private source-document paths, declared metadata,
  actual bytes and checksums, and explicit integrity warnings;
- `review-queue.jsonl`: private review material for the sampled items;
- `review-template.jsonl`: blank, two-slot review records;
- `duplicate-review-queue.jsonl`: every exact-duplicate candidate group and all
  of its mandatory sampled members;
- `duplicate-review-template.jsonl`: blank, two-slot adjudication records for
  each duplicate group;
- `quality-report.json`: machine-readable measurements and exit status; and
- `quality-summary.md`: the same result for human review.

## Use the private review dashboard

Instead of editing the generated JSON Lines templates by hand, launch the
loopback-only reviewer for one fixed reviewer identity and slot:

```bash
.venv/bin/math-kangaroo-trainer stage0 review-web \
  --audit-dir work/math-kangaroo-adaptive-engine/stage0 \
  --reviewer-id reviewer-one \
  --reviewer-slot 1 \
  --port 8765
```

Open the printed `http://127.0.0.1:8765/` URL. The dashboard presents one
question or duplicate group at a time, restores that reviewer's saved slot,
records corrections in append-only history, and regenerates the quality report
after every save. It never enters the Next.js application or public export,
never binds beyond loopback, and never permits the browser to choose a local
file path, content version, reviewer identity, or audit run.

A genuinely different reviewer must later launch a separate session with a
different `--reviewer-id` and `--reviewer-slot 2`. Completing one slot does not
complete Stage 0. The proposed skill ontology remains a later review gate after
the question evidence has been verified.

The modality field is intentionally tri-state. `diagram_dependent` means the
available source evidence shows that a visual asset is required;
`diagram_review_required` conservatively routes a possible visual dependency
to a human; and `text_extractable` means no dependency is currently indicated.
The latter is not proof that an unseen visual is irrelevant.

Malformed option payloads and invalid text, numeric, boolean, boundary, or
source-manifest fields become explicit versioned warnings with private field
evidence; they do not abort the whole audit or get silently repaired. Every
such question is forced into the gold sample. Whole-corpus source consistency
counts are persisted separately so an unsampled orphan or checksum mismatch
still blocks `PASS`. Missing OCR confidence and official solutions are reported
as content gaps rather than inferred.

Record item reviews in JSON Lines and import them:

```bash
.venv/bin/math-kangaroo-trainer stage0 import-reviews \
  --audit-db work/math-kangaroo-adaptive-engine/stage0/stage0-audit.sqlite3 \
  --input work/math-kangaroo-adaptive-engine/stage0/completed-reviews.jsonl
```

Each sampled item needs two independent reviewers. Reviews include the audited
`content_version`; a review for stale or different content is rejected. Imports
append immutable history while maintaining a latest-state projection, so a
correction never erases the prior review.

Independently adjudicate every exact-duplicate candidate group, then import the
two review slots:

```bash
.venv/bin/math-kangaroo-trainer stage0 import-duplicate-reviews \
  --audit-db work/math-kangaroo-adaptive-engine/stage0/stage0-audit.sqlite3 \
  --input work/math-kangaroo-adaptive-engine/stage0/completed-duplicate-reviews.jsonl
```

Duplicate reviews are bound to the audit run, group ID, and exact signature.
They also use append-only revision history. Two distinct reviewers must agree
on `confirmed` or `rejected`; disagreement or `needs_review` remains an
unresolved gate.

When publishing a reviewed ontology creates a new deterministic audit run,
plan review reuse before applying it:

```bash
.venv/bin/math-kangaroo-trainer stage0 carry-forward-reviews \
  --audit-db work/math-kangaroo-adaptive-engine/stage0/stage0-audit.sqlite3 \
  --source-run-id SOURCE_RUN_ID \
  --target-run-id TARGET_RUN_ID \
  --output work/math-kangaroo-adaptive-engine/stage0 \
  --ontology path/to/reviewed-ontology.json
```

This is a read-only dry run by default and writes a private JSON audit plan.
Inspect its skipped records and blockers, then repeat the command with
`--apply`. Application is atomic and regenerates the target quality reports.
Item evidence moves only when `item_id` and `content_version` both match.
Duplicate evidence additionally requires the same signature type, signature,
member set, and every member content version. Reviewer identity, slot, checks,
decision, notes, and original review time are preserved. The database records
source and target run IDs plus both immutable review event IDs. An idempotent
rerun verifies both the provenance and exact target history event. A later
source correction may extend the chain only when it is newer and the target's
current slot is still the preceding carried event; an independent target
correction is preserved and blocks a competing source revision. Unrelated
occupied target evidence, stale history, ambiguous matches, and same-run
requests are rejected. Before applying, the CLI verifies that the supplied
ontology version and checksum belong to the target run. Target reports are
staged and published inside the evidence transaction; publication or commit
failure restores the previous reports while the database rolls back, so the
two evidence surfaces cannot silently diverge.

Then regenerate the reports:

```bash
.venv/bin/math-kangaroo-trainer stage0 report \
  --audit-db work/math-kangaroo-adaptive-engine/stage0/stage0-audit.sqlite3 \
  --output work/math-kangaroo-adaptive-engine/stage0 \
  --ontology tools/math_kangaroo_trainer/src/math_kangaroo_trainer/config/skill-ontology.v1.json
```

The ontology file is bound to the audit run by version and checksum; reporting
with a different document fails rather than silently changing the evidence.
The bundled ontology is intentionally `proposed`, so it cannot pass Stage 0.
An immutable reviewed ontology needs an approved document and skills, two
independent reviewers with review timestamps, and typed gold-set and boundary
evidence. That evidence pins the source SHA-256, deterministic gold-set
checksum, every sampled item content version, and disjoint positive/negative
examples for every skill; stale or mismatched evidence cannot pass.
Only separately approved, doubly reviewed prerequisite relations may ever gate
curriculum.

Stage 0 passes only when all source PDFs verify, the complete sample has two
independent content-bound reviews, all duplicate groups have two agreeing
independent adjudications, the run-bound ontology satisfies its approval gate,
faithful parsing is at least 98%, and every remaining failure is explicit. It
never manufactures a successful quality result. Synthetic contracts may
continue under ADR 0002, but no real question, answer, annotation, embedding,
Q-matrix, learner diagnosis, or player-facing adaptive behavior may consume
them until `quality-report.json` says `PASS`.
