# ADR 0001: Math Kangaroo adaptive core boundaries

- **Status:** Accepted for Stage 0
- **Date:** 2026-08-01
- **Scope:** Offline corpus audit and the architecture that later adaptive-engine
  stages must preserve
- **Related contract:** `AGENTS.md`, especially the product, technical/privacy,
  and Math Kangaroo Journey requirements

## Context

The local Math Kangaroo corpus contains approximately 1,800 questions from
multiple collections, years, grade bands, languages, and source formats. The
corpus is useful for building a personalized practice engine, but it is not a
single clean or uniformly licensed application data source. Questions differ in
choice count, point notation, diagram dependence, extraction quality, answer
status, and available English text. The original question text, images, answer
keys, and solutions are private working data unless an item has been separately
selected, licensed, transformed, and reviewed for publication.

The proposed trainer eventually needs to organize this corpus, model uncertain
learner knowledge, choose a pedagogically useful next activity, and explain why
that choice was made. Those jobs require different representations. In
particular, semantic similarity is not evidence that a learner has or lacks a
skill: embeddings may capture story wording, visual theme, or source formatting
instead of a solution principle.

This repository is also a statically exported Next.js site. Its current product
contract forbids server-only APIs, accounts, remote storage, analytics, and
third-party runtime calls. Browser persistence is limited to explicit
device-local preferences and progress. An offline development tool may inspect
private local data, but that does not make the data publishable and does not
authorize a runtime service.

The first engineering risk is therefore corpus fidelity, not personalization.
Bulk annotations, embeddings, learner updates, or policies built on incorrectly
parsed questions would make errors look precise and would be expensive to
unwind.

## Decision

We will build the adaptive core in separately versioned stages, beginning with
an offline Stage 0 audit. Stage 0 reads the canonical local question bank
without modifying it, writes a separate derived audit store, and produces a
small reviewed gold set plus machine- and human-readable quality reports. It
does not add a game route, a web API, learner tracking, model calls, or a bulk
corpus export.

The longer-lived architecture keeps six concerns distinct:

| Concern | Authoritative representation | Explicitly not authoritative for |
| --- | --- | --- |
| Source corpus | Versioned items, assets, provenance, answers, and review state | Learner competence |
| Instructional model | Reviewed skill ontology, typed prerequisites, solution paths, and sparse item-to-skill map (Q-matrix) | Surface similarity or calibrated ability |
| Corpus retrieval | Separate surface, strategy, and controlled-tag embeddings plus item-family links | Mastery, prerequisite order, or difficulty |
| Learner model | Probabilistic competence and uncertainty by reviewed skill/path, with retention state | Raw speed or embedding coordinates |
| Timing model | Active-time observations, fluency estimates, interruptions, and uncertainty | Conceptual mastery by itself |
| Policy layer | Versioned eligibility rules, score components, constraints, purpose, and seeded selection | Silent learner-state mutation |

Immutable evidence events and reproducible evaluation form a seventh,
cross-cutting layer. The same ordered event stream, source and derived-data
versions, configuration, and random seed must rebuild the same state and
selection decisions. Snapshots may accelerate replay but never replace the
events that justify a state.

### The canonical bank is private and read-only

The current canonical source is the ignored local database at
`work/math-kangaroo-complete-question-bank/data/questions.sqlite3`. It is an
input to offline tooling, not an application database.

Stage 0 must:

- open the canonical SQLite database in read-only/query-only mode and fail if
  its required schema is missing;
- inventory every declared source document, verify that its local PDF exists,
  and compare the actual byte count and SHA-256 checksum with the source
  manifest rather than trusting metadata alone;
- preserve stable source identifiers, source-PDF bytes, question-scoped asset
  bytes, and checksums rather than rewriting source rows or files;
- write normalized records, audit decisions, reviewer records, and reports to a
  separate derived database beneath ignored `work/` storage;
- keep every ambiguous boundary, answer, diagram, or metadata condition as an
  explicit `needs_review` result instead of silently repairing it;
- read questions and source manifests in one locking-aware SQLite snapshot,
  verify the database is unchanged across the run, and persist versioned
  whole-corpus findings so unsampled source inconsistencies cannot disappear;
- avoid copying question text, original crops, answer keys, solutions, or other
  copyrighted source material into tracked fixtures, logs, test snapshots, or
  build output; and
- use synthetic items for committed tests so CI and a public clone work without
  the private corpus or child data.

Derived data does not become safe to publish merely because it was normalized,
annotated, embedded, or placed in another database. License/use status and
review status remain explicit, versioned fields. Only separately approved,
question-scoped assets may enter a public game bundle under the existing Math
Kangaroo publication workflow.

### Stage 0 precedes bulk inference

Stage 0 operates on a deterministic, stratified sample of 100–200 items. The
sample must span source collections, years, grade bands, known point tiers and
unknown tiers, text-extractable and diagram-dependent items, answer statuses,
choice counts, languages, and extraction-risk conditions. Exact-duplicate
candidate members form a mandatory gold slice: every member is included in the
sample so duplicate evidence is not evaluated from only one side of a pair.
The selection algorithm, seed, sample definition, source-document and asset
checksums, and schema version are recorded so the sample can be reproduced.

Diagram modality is deliberately tri-state during audit:

- `diagram_dependent` means source evidence shows that the asset is necessary;
- `diagram_review_required` means prompt or source evidence suggests a visual
  dependency but cannot establish it safely; and
- `text_extractable` means the available source evidence does not currently
  indicate that a diagram is required.

The middle state is a review route, not a guess that the item is text-only.
No later multimodal or annotation pipeline may treat OCR text as a complete
representation of a `diagram_dependent` or `diagram_review_required` item.

For sampled items, the audit records at least:

- question, choice, and answer boundary fidelity, plus explicit solution
  availability (the current source schema has no official-solution field, so
  Stage 0 reports that as a content gap rather than inventing one);
- source metadata and stable asset references;
- diagram dependence, missing assets, multi-page content, OCR/extraction
  warnings, and visual-verification state;
- an explicit `OCR_CONFIDENCE_NOT_AVAILABLE` content gap for OCR-derived rows
  until the source bank records actual confidence values;
- answer-key status, including void or multiple-answer cases;
- normalized exact-content fingerprints and exact-duplicate groups; and
- explicit review triggers and disposition history.

Exact duplicates are detected deterministically before sampling or any model
call. Every candidate group requires two independent human adjudications. A
group is not confirmed or rejected for Stage 0 until both reviewers agree; a
disagreement or `needs_review` decision remains unresolved. Near duplicates and
same-solution families are deliberately deferred to reviewed annotations and
embedding-assisted discovery; Stage 0 must not call fuzzy similarity an exact
match.

The initial ontology covers orthogonal facets—mathematical content, reasoning
moves, procedures, representations, cognitive demand, and nuisance/load. New
entries begin as `proposed`. Ontology approval requires two independent
reviewers and typed gold-set evidence supporting the proposed boundaries. The
evidence pins the source checksum, deterministic sample checksum, sampled item
content versions, and disjoint positive/negative boundary examples;
the ontology document, review state, and every retained skill must be approved.
Only human-reviewed skills may become `approved`, and only reviewed
`prerequisite` edges may gate a later curriculum. The strict prerequisite
subgraph must be acyclic. Stage 0 establishes a first reviewed ontology and a
doubly reviewed gold set; it does not infer learner mastery from those tags.

### Versioning and correction

Every persisted derived record carries the versions needed to interpret it.
Stage 0 introduces, at minimum, source/content checksum, corpus schema version,
audit-rule/configuration version, ontology version, and gold-review version.
Later stages add annotation schema, prompt and model, embedding, family,
calibration, learner model, timing model, policy, and event schema versions.

Versions identify behavior; timestamps do not substitute for them. A change
that can alter normalized content, review routing, inferred tags, predictions,
or selection results creates a new version rather than overwriting the old
meaning. Gold-item reviews are bound to the audited content hash, and exact-
duplicate reviews are bound to the run, group, and duplicate signature. Both
review streams retain append-only revision history; a latest-state projection
may aid reporting but never replaces or rewrites its evidence. Stale reviews
cannot satisfy a gate after source content or a duplicate signature changes.
Publishing an approved ontology creates a new run identity. Existing human
reviews may be carried into that run only through the audited, dry-run-first
workflow: items must match by ID and content version, while duplicates must
also match signature type, signature, member set, and every member content
version. The carry event retains source and target run and review-event IDs;
every referenced target history event is reverified. A newer source revision
may extend a provenance chain only while the target projection is still its
preceding carried event; an independent target correction is never overwritten.
Occupied target slots or unverifiable history block the operation, and report
generation must succeed before the evidence transaction commits.
Corrections are appended with provenance. Once response events exist,
answer-key or annotation corrections are applied by versioned correction
events and replay, never by silently reinterpreting historical answers.

All randomized operations accept an injected seed or random source. Policies
must persist the candidate-set identity, eligibility and exclusion reasons,
score components, selected purpose, policy/config versions, seed, and an
approximate selection propensity. Learner updates must eventually be
idempotent, bounded, and replayable. When evidence is insufficient, the engine
returns `UNKNOWN`, `INSUFFICIENT_EVIDENCE`, or `CONTENT_GAP` rather than a
manufactured diagnosis.

### Static-site and runtime boundary

Stage 0 is development-time Python tooling and is not imported by the Next.js
application or copied into the static export. It must run without a web server,
an LLM, a network connection, or the public site. No learner identity or attempt
data is required for this stage.

Stage 0 may optionally expose its existing human-review workflow through an
ephemeral, loopback-only helper page. That helper is local development tooling:
it binds only to `127.0.0.1`, serves one private evidence packet at a time,
accepts only the fixed reviewer identity and slot chosen at launch, and writes
through the same validated append-only review repository as the CLI. It is not
an application API, learner service, remote backend, or public asset. The audit
and all review imports remain fully operable without it.

The core specification describes a possible minimal HTTP wrapper, but this
repository does not adopt that learner-facing wrapper in this decision. Adding
such a wrapper would
conflict with the current static-site, no-backend, and no-remote-storage
contract and would require a separate product, hosting, security, licensing,
and privacy decision. Until then, any future browser-facing personalization
must remain device-local and use only content explicitly approved for bundling.

A static client also cannot promise that bundled answer keys or grading logic
are secret. Consequently, Stage 0 will not claim to implement a
"protected server-side entity" or learner-safe network API. It can define and
test a learner-safe serialization boundary for future use, but shipping private
answers or solutions to the browser remains prohibited. The eventual delivery
model—approved offline bundle versus separately authorized service—is deferred.

## Stage 0 acceptance and exit criteria

Stage 0 is accepted only when all of the following are evidenced by automated
checks or its quality reports:

1. The source database passes integrity and required-schema checks and remains
   byte-for-byte unchanged across an audit run. Every declared source PDF is
   present, uses an inspected source format, and matches its declared byte
   count and SHA-256 checksum.
2. A fixed database, source-document and question-asset snapshot,
   configuration, and seed produce the same bounded 100–200-item sample and
   exact-duplicate assignments.
3. The sample records required strata and reports uncovered or underrepresented
   strata instead of hiding coverage gaps.
4. Every parse or source ambiguity is represented as `needs_review`; no fallback
   silently invents text, choices, answers, diagrams, point tiers, or metadata.
5. A doubly reviewed gold set spans the important corpus formats and risk
   conditions. Every review is bound to the audited content version, and all
   revisions are retained in append-only history rather than collapsed into an
   unattributed approval.
6. Every exact-duplicate candidate member is part of the gold sample, and every
   candidate group has two agreeing, independent, signature-bound
   adjudications. Duplicate review revisions are retained append-only; the
   report exposes confirmed, rejected, and unresolved counts.
7. At least 98% of the gold set is faithfully parsed. The denominator, review
   version, boundary checks, and failures are present in the machine-readable
   report; every remaining failure is an explicit review item.
8. The first reviewed ontology has defined facets, typed relations, two
   independent reviewers, and recorded gold-set evidence. Its approved
   prerequisite subgraph is acyclic. Proposed skills and unreviewed edges
   cannot gate curriculum.
9. The audit emits a deterministic machine-readable quality report and a short
   human-readable summary covering failures, uncertainties, duplicates,
   review backlog, and content gaps.
10. Committed tests use only synthetic data, and repository/build checks show
   that no canonical questions, source assets, answer keys, solutions, derived
   private database, or child data entered tracked or public output.

Any source-integrity failure, incomplete or conflicting item review, unresolved
duplicate adjudication, unapproved ontology, fidelity below 98%, or unexplained
parse failure prevents `PASS`. Producing the report is not the same as
satisfying the exit criterion. Stage 1 corpus intelligence, bulk LLM/model
calls, and any adaptive player-facing UI remain blocked until the Stage 0 report
is `PASS`.

The ten end-to-end adaptive acceptance scenarios in the core specification are
retained as future executable contracts. They must be written against a
synthetic corpus before higher-order learner and policy logic is implemented,
but they are not falsely claimed as Stage 0 behavior.

## Consequences

### Benefits

- Corpus defects and redistribution risks surface before expensive model calls
  or player-facing integration.
- Embeddings can improve retrieval without becoming an opaque learner score.
- Skills, timing, retention, and policy behavior remain independently
  inspectable and replaceable.
- Versioned evidence permits correction, replay, simulation, and later
  calibration without rewriting history.
- Synthetic fixtures make the public repository reproducible without exposing
  private questions or information about a child.

### Costs

- Stage 0 delivers audit infrastructure rather than an immediately playable
  adaptive game.
- Human double review of both items and duplicate candidates, plus reviewed
  ontology approval, are real release dependencies and cannot be automated
  away.
- Separate schemas and versions add deliberate bookkeeping.
- A public personalized trainer remains blocked on content approval and a
  separate decision about the client/service privacy boundary.

## Deferred decisions and staged roadmap

The following choices are intentionally not made in Stage 0:

- **Stage 1 — corpus intelligence:** annotation provider and prompts,
  multimodal processing, final Q-matrix granularity, alternate solution paths,
  misconception labels, embedding models and weights, near-duplicate/family
  thresholds, and conservative difficulty/time priors. Model outputs remain
  proposals until measured against the gold set.
- **Stage 2 — diagnostic MVP:** exact probabilistic learner model, update caps,
  mastery thresholds, event store and projector implementation, timing model,
  diagnostic blueprints, and snapshot cadence. These require synthetic learner
  simulations and exact replay tests before use.
- **Stage 3 — personalized practice:** prerequisite-frontier planning, spaced
  review schedule, remediation routes, transfer rules, slate constraints, and
  practice-policy weights. Selection must stay explainable and distinguish
  diagnosis, practice, review, remediation, transfer, and contest preparation.
- **Stage 4 — empirical refinement:** hierarchical item calibration, empirical
  Q-matrix refinement, multidimensional model comparisons, learned time
  distributions, and policy evaluation against delayed unseen-family anchors.
  These wait for sufficient multi-learner evidence.
- **Delivery and governance:** redistribution rights, which items and assets may
  ship, a browser-only versus separately authorized service architecture,
  identity and consent, encryption and deletion, optional synchronization, and
  any public adaptive-game UI.

Deep knowledge tracing, a neural learner embedding, contextual bandits, and
reinforcement learning are not starting points. They may be reconsidered only
after the explicit, auditable baseline has enough data to compare against them.

## Revisit this decision when

- Stage 0 meets its measured exit criterion and Stage 1 is ready to begin;
- a public adaptive experience needs content beyond the already approved
  question-scoped assets;
- a requirement appears for cross-device progress, protected answers, or a
  runtime service; or
- empirical evidence shows that an approved ontology, Q-matrix, learner model,
  or policy version needs replacement.
