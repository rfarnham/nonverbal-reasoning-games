# ADR 0002: Deferred Stage 0 review and synthetic engine development

- **Status:** Accepted
- **Date:** 2026-08-02
- **Scope:** Work that may continue while the Math Kangaroo Stage 0 human-review
  gate remains incomplete
- **Related decisions:** `adr-0001-math-kangaroo-adaptive-core.md`

## Context

The Stage 0 source audit is reproducible and its review evidence is append-only,
but completing two independent reviews of the 180-item gold sample and approving
the first ontology requires substantial human time. Exact-duplicate review and
question review may therefore finish after later engine contracts and synthetic
tests have been written.

This timing does not weaken the Stage 0 evidence gate. The current audit report
must not be treated as approval while it says `PENDING_REVIEW`, and proposed
ontology skills or relations must not become an authoritative Q-matrix or
curriculum gate.

There is also a versioning issue that must be resolved before review work can be
relied on across runs. Audit run identity includes the ontology version and
checksum. Publishing an approved ontology correctly creates a new run, while
item and duplicate reviews are deliberately bound to their original run. A
review completed against byte-identical evidence should be reusable without
pretending it was newly performed, but a changed question, answer, crop, or
duplicate group must be reviewed again.

## Decision

Development proceeds on two explicit tracks.

### Evidence track

Stage 0 human review continues independently and remains the only route to a
real-corpus `PASS`. Reviews retain their original reviewer, slot, timestamp,
verification flags or decision, notes, and immutable history.

Cross-run carry-forward is permitted only through an audited workflow with all
of these invariants:

- source and target runs are distinct and present in the same derived audit
  store;
- an item matches by stable item ID and exact `content_version`, which already
  covers source metadata, protected answer evidence, and question-scoped asset
  bytes;
- a duplicate group matches by signature type, exact signature, complete member
  set, and every member's exact content version;
- an occupied target slot is never silently overwritten or merged;
- skipped, conflicting, and transferred evidence is reported explicitly;
- applying the same transfer again is idempotent; and
- provenance records both run IDs and the original review evidence rather than
  representing the transfer as a new human judgment.

Carry-forward defaults to a dry run and requires an explicit apply action. A
content or answer-key correction changes the content version and therefore
invalidates carry-forward for that item. Corrected answers must be fixed in the
canonical catalogue, re-audited, and reviewed against the new evidence; review
notes are not themselves authoritative answer corrections.

### Engineering track

Later-stage engineering may continue only where it is independent of private,
unapproved corpus truth. Permitted work includes:

- schema and interface contracts;
- deterministic synthetic corpus and learner fixtures;
- immutable event, idempotency, snapshot, and replay infrastructure;
- synthetic acceptance scenarios and evaluation metrics;
- provider abstractions that make no model call; and
- readiness checks that remain blocked for real corpus execution.

The first continuation slice is the Stage 2 event/replay spine because it can
record factual evidence without a Q-matrix or competence claim. Its learner
projection may count presentations, attempts, families, hints, timing
observations, and recorded selection decisions. It must not infer mastery,
weakness, difficulty, or fluency until reviewed Stage 1 inputs and the relevant
model tests exist.

While Stage 0 is pending, the engineering track must not:

- run bulk LLM or embedding jobs over the private corpus;
- approve solution paths, item-skill mappings, prerequisites, misconceptions,
  families, or calibration values;
- use unreviewed answers as authoritative grading data;
- make learner diagnoses or production policy decisions;
- add a learner-facing HTTP service or persistent child-data store; or
- publish private questions or assets in the static application.

## Consequences

Human review no longer blocks safe, corpus-independent engineering, and review
work can survive the eventual approved-ontology rebuild when its evidence is
byte-identical. The gate remains honest: synthetic contracts are implementation
progress, not Stage 1 or Stage 2 acceptance and not evidence that the real
corpus is ready.

The project temporarily carries two visible statuses: Stage 0 evidence remains
pending, while later-stage synthetic contracts may be implemented and tested.
Quality reports and documentation must keep those statuses separate.

## Revisit this decision when

- the Stage 0 report reaches `PASS` and real Stage 1 corpus intelligence can
  begin;
- a carried review fails an invariant or a canonical item changes;
- learner data needs persistence, synchronization, or a runtime service; or
- synthetic event/replay contracts are ready to consume a reviewed Q-matrix.
