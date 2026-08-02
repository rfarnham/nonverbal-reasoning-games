# Math Kangaroo adaptive core

This package is the offline, private-data foundation for the adaptive trainer
described in `docs/architecture/adr-0001-math-kangaroo-adaptive-core.md`. The
real-corpus evidence track currently stops at **Stage 0**: it verifies the
source database and declared PDFs, audits a representative sample, records
explicit review work, detects and routes exact duplicate candidates, and
produces reproducible quality reports. Corpus-independent Stage 1 contracts and
the Stage 2 event/replay spine may be exercised only with invented fixtures as
described in
`docs/architecture/adr-0002-deferred-stage0-review-and-synthetic-engine-development.md`.

It does **not** publish the private question bank, expose answer keys to the
browser, ship an LLM provider, infer learner mastery, persist child data, or
alter the existing Journey Math Kangaroo corpus.

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

These are engineering contracts, not completed Stage 1 or Stage 2 exit gates.
There is no bulk corpus annotation, embedding/Q-matrix approval, learner model,
diagnostic policy, practice policy, or learner-facing service yet.

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
