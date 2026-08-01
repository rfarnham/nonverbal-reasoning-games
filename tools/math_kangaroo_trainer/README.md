# Math Kangaroo adaptive core

This package is the offline, private-data foundation for the adaptive trainer
described in `docs/architecture/adr-0001-math-kangaroo-adaptive-core.md`. The
first implementation deliberately stops at **Stage 0**: it verifies the source
database and declared PDFs, audits a representative sample, records explicit
review work, detects and routes exact duplicate candidates, and produces
reproducible quality reports.

It does **not** publish the private question bank, expose answer keys to the
browser, call an LLM, infer learner mastery, or alter the existing Journey
Math Kangaroo corpus.

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
never manufactures a successful quality result. Do not begin Stage 1, bulk LLM
annotation, or an adaptive player-facing UI until `quality-report.json` says
`PASS`.
