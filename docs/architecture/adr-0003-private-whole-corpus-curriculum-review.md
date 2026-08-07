# ADR 0003: Keep whole-corpus curriculum review private and evidence-bound

Status: accepted

## Context

The canonical Math Kangaroo research corpus contains 1,833 questions. The
existing Stage 0 gold set contains 180 deliberately sampled questions and has a
100--200 item invariant because it measures parser quality; expanding that
sample would change the meaning of the evidence gate rather than complete it.

Teachers nevertheless need to inspect, classify, and prioritize the complete
corpus before the independent gold review is finished. Those judgements must
remain distinguishable from deterministic proposals, parser verification,
player-release readiness, and permission to publish source material.

## Decision

Add a separate, loopback-only **Catalogue QA** workbench over every canonical
question. It uses its own derived SQLite database under ignored `work/`
storage and does not add question content or assets to the Next.js bundle.

The catalogue records:

- an immutable corpus snapshot and item content version;
- a versioned, explicitly non-authoritative classification proposal;
- append-only teacher review history and a latest-state projection;
- orthogonal curriculum facets rather than one overloaded type label; and
- computed promotion states and blockers.

The friendly `Question type` field is an editorial view. It does not replace
content skills, reasoning skills, procedures, representation, modality, or
cognitive demand. A legacy spatial-review label is proposal evidence with
`legacy_spatial_review` provenance, not a reviewed truth. Questions without
that evidence remain unclassified, not “non-spatial.”

The 180-question Stage 0 sample remains the independent parser-quality gold
track. Exact-duplicate adjudication remains a two-reviewer gate. Catalogue
approval does not satisfy either gate.

Promotion is computed rather than entered as a checkbox. Curriculum readiness
requires a faithful source review and a completed teacher classification.
Player-release candidacy additionally requires an authoritative single answer,
playable semantic choices or reviewed answer regions, a reviewed solution
path, resolved duplicate/family evidence, and a learner-safe rendering. Public
eligibility also requires explicit use permission. Every imported item is
currently `private-research-only`, so no catalogue decision authorizes a public
export.

Review exports contain only stable IDs, content and schema versions, reviewer
evidence, classifications, and blocker codes. They exclude prompts, choices,
answers, crops, PDFs, URLs, and filesystem paths.

The workbench also exposes these explicitly experimental QA surfaces:

- **World / Play QA** organizes eligible Grades 1–2 questions into six curated
  realms and smaller districts. Crossroads launches random, exact-ID, or private
  pasted-text exploration. Question Heaven is presentation-only: unresolved or
  not-yet-structured questions remain playable there without receiving a fake
  curricular home. Structured answer choices are randomly reordered and
  relabelled for play; choices embedded in the source crop preserve source A–E
  order. Device-local state restores the current question, permutation, answer
  progress, and semantic route. Teacher placement decisions are separately
  persisted as reversible, append-only, version-bound evidence.
- **UMAP diagnostics** project catalogue questions into separate Surface,
  proposed-tag, and Hybrid two-dimensional maps beneath the authored world.
  The projection is fixed-seed, single-worker UMAP over a precomputed monotone
  distance derived from each view's exact served similarity relation. The UI
  must report the UMAP library version and parameters, measured neighbor
  preservation, and a full-data PCA comparison rather than imply that
  two-dimensional distance is authoritative. Cluster names are
  non-authoritative proposal-derived descriptions ranked by corpus-relative
  enrichment. The bulk map contains no prompt, choice, answer, source URL,
  asset path, or reviewer note; question content is loaded only for a selected
  item or a bounded same-origin POST result. Pasted text never enters URLs and
  is refused when it has no supported corpus signal.
- **Similarity Lab** compares a local surface-semantic view with a controlled
  tag view and records append-only teacher judgements about proposed neighbors.
  The surface baseline is a deterministic, locally built TF-IDF/latent-semantic
  index. A strategy view remains unavailable until reviewed solution paths
  exist; it must not be approximated from story wording. The hybrid view
  reports that missing evidence and renormalizes only over available views.
- **Curriculum Lab** previews hard eligibility gates, score components, and
  constrained slates for a hypothetical target skill, grade, mastery estimate,
  uncertainty, and instructional purpose. It does not update or persist a
  learner model. When only proposed Q-matrix labels exist, every recommendation
  is marked proposal-only. If no eligible content exists it returns
  `CONTENT_GAP` instead of substituting a merely similar question. When a
  reviewer supplies a target question reference, surface similarity is an
  explicit, warned proxy for near-remediation versus farther-transfer scoring;
  recent exposure remains a separate redundancy input, and neither is
  presented as the missing reviewed strategy view.

Semantic proximity is evidence for corpus discovery, not learner competence,
item difficulty, prerequisite order, or curriculum truth. Neighbor judgements
and taxonomy judgements are evidence inputs to later validation; one reviewer
cannot turn the proposed ontology or prerequisite graph into a gating model.

## Consequences

- A teacher can review the full corpus now without weakening the Stage 0 gate.
- Rebuilding against unchanged content preserves review evidence; changed
  content receives a new binding and cannot silently inherit approval.
- The first useful queue can prioritize warning-free questions, while all
  1,833 remain searchable and filterable.
- Reviewers can inspect whether retrieval finds same-strategy, transfer,
  surface-only, duplicate, or unrelated neighbors instead of accepting an
  opaque top-k result.
- Reviewers can inspect cluster boundaries and walk local neighborhoods across
  the complete corpus while seeing how much high-dimensional neighborhood
  structure the two-dimensional projection actually preserves.
- Policy weights and similarity weights remain versioned hypotheses visible in
  the QA output rather than hidden product behavior.
- The workbench must be launched locally and must never be deployed with the
  public Spatial Gym site.
- The local play-QA surface randomizes structured answer placement while saving
  the permutation for exact resume. Source order remains explicit for graphical
  choices still embedded in question crops; those items stay in Question Heaven
  until separately structured.
