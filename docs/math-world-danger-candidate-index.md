# Danger reinforcement candidate contract

The runtime contract is `DangerCandidateIndex` in
`app/math-world/danger-candidates.ts`. A candidate is accepted only when both
questions have a reviewed, identical **question type and solving method**, and
an explicitly reviewed directed edge joins them. Evidence must explain the
shared method and diagram structure. Topic labels, strategy tags, text
similarity and embedding proximity are retrieval hints, not approval.

Each exported index declares schema version 1, its own index version, and the
exact `WORLD_CONTENT_VERSION`. Its `classifications` map canonical question IDs
to `questionType`, `method`, `reviewed: true`, and `evidence`. Its `edges` list
`sourceQuestionId`, `candidateQuestionId`, those same type/method identifiers,
`reviewed: true`, and edge evidence. Edges are directed, so a more complex
original can point to an easier reinforcement without implying the reverse.

Only the already validated, bundled teaching questions are currently eligible.
Candidates must retain the original's grade band and cannot exceed its point
tier or reasoning demand. Questions from the reserved 2025 and 2026 Grade 1–2
full tests are excluded. New corpus questions require the existing canonical
question/asset/answer validation pipeline before they can be indexed here.
Nothing downloads at runtime.

## Bootstrap coverage

The initial index is intentionally small: eight canonical questions in three
cohorts. Their actual diagrams were inspected on 2026-09-30.

- Visible-unit tally: 2023 Grade 1–2 Q1 circles, 2012 Grade 1–2 Q1 animals,
  2016 Grade 1–2 Q3 individual matches, and 2015 Grade 1–2 Q3 ladybug spots.
  Count each visible target unit once; exclude hidden quantities and
  compare-the-largest-box tasks.
- Two perpendicular card flips: Think Academy Grade 1–2 4-point Q6 and Q22.
  Track symbol order and triangle orientation through top-edge then side-edge
  flips.
- Twice-folded numbered grid with one punch: Think Academy Grade 3–4 4-point
  Q91 and Q95. Both use a 6×6 grid and perpendicular half folds; unfold by
  reflecting the punched cell across both midlines.

This does **not** supply four candidates for every missed question. Missing
coverage produces a shorter packet containing the original missed question,
never loosely related filler. Unclassified originals remain distinct rather
than being grouped using an over-broad curriculum topic.

## Packet lifecycle

Preparing a packet snapshots its IDs, order, groups and index version. Viewing
a danger's introductory page must not prepare a packet. Once prepared,
printing, reloading, leaving or installing a new index cannot change it.

A group normally has one missed original followed by up to four available
candidates. When that would exceed 24 questions overall, groups shrink to one
original plus up to two candidates. The packet always contains at most 24
unique questions. Recent archipelagos lead; an error waiting through three
unserved danger opportunities gains priority so older work cannot starve.
Unused candidates remain in the original's deferred deck until a completed
packet has actually covered them. Only packet completion consumes served
reinforcement references.

Every accepted wrong response, including a retry or reinforcement error, is
appended to the profile's observation ledger. Correct answers never erase it.
A separate due queue repeats an error after unsuccessful review, spaces a clean
review by four worlds, and retires an error after two clean reviews once its
deferred deck is empty. A new mistake reactivates it. Accuracy uses only each
question's first attempt; all questions must be solved to finish.

Progress is namespaced by explicit profile identity and separately by QA mode.
Historical device-wide first-try misses may be claimed by only one durable
identity; other children must not inherit that old shared history. Legacy
records honestly store an unknown selected option rather than inventing one.
