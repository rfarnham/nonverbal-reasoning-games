# Adaptive subtraction curriculum

## Integration map

Borrow Flash remains available at `/lab/subtraction-flash/`. Its existing Cards
and Listen runs continue to use `game-engine.ts` and `session-engine.ts` without
changing their deck behavior. The adaptive curriculum is an additional finite
practice path in the same route.

The integration deliberately keeps three layers separate:

1. `app/lab/subtraction-flash/adaptive/` owns pure curriculum data and logic:
   the skill graph, deterministic problem generation, answer evaluation,
   attempt events, mastery and fluency reduction, error probes, session
   planning, fatigue checks, review scheduling, benchmarks, and summaries.
2. `adaptive-storage.ts` validates and versions the device-local event log and
   resumable session state. Aggregate skill states are derived from attempts;
   they are not the only record of progress. New events retain the complete
   generated-problem snapshot (seed, operands, expected answer, prompt and
   answer specifications, metadata, and content version), while migration
   continues to accept older events that predate that snapshot.
3. `adaptive-curriculum.tsx` adapts those domain objects to the existing card
   surface. It uses the existing `recognizeDigit` function and its confidence
   and margin values. It does not replace or retrain the recognizer.

The current Borrow Flash page has no learner profile or shared lab-progress
store. The curriculum therefore uses one explicitly named device-local learner
(`device-learner`) and a route-scoped, schema-versioned local-storage record.
Blocked, stale, corrupt, or quota-limited storage degrades to an in-memory
session without crashing. This store is intentionally independent of Journey:
standalone lab practice must not mutate Journey progress or XP.

## Curriculum model

The graph contains four tracks:

- fact retrieval: F01–F05;
- regrouping micro-steps: R01–R05;
- complete subtraction: A01–A06;
- transfer and error awareness: T01–T05.

Prerequisites unlock from `conceptStatus`, never from a response-time target.
Diagnostic cards in the first two or three short sessions may directly mark a
prerequisite as demonstrated, so a learner is not forced through content they
already understand.

Concept mastery and fluency are independent reductions over qualifying attempt
events. Concept mastery uses recency-weighted accuracy, minimum independent
attempts across sessions, and recent misconception checks. A single miss does
not demote a mastered skill. Fluency uses only reliable, uninterrupted,
independent correct attempts and considers response time, time to first ink,
writing duration, and variability. An accurate but slower learner advances
conceptually while receiving small, spaced fluency doses. A plateau moves to
maintenance instead of increasing repetition.

Hints earn graduated concept credit: direct-attention and operation prompts
count less than an independent response, while renamed-number and worked-example
hints do not count as independent mastery evidence. Mastery also requires a
meaningful unhinted sample, so repeated assisted success cannot unlock a skill
by itself. Parent reporting treats every hinted response as assisted even when
the mastery reducer awards partial evidence.

## Sessions and remediation

Adaptive sessions are finite. Standard sessions contain ten to twelve cards;
short sessions contain eight. They show cards remaining, not a countdown. The
planner interleaves warm-up, a current focus, full-problem integration, due
review, transfer, and an easy close, with caps on narrow-skill and repeated
template exposure.

An incorrect full-problem answer produces a tentative error pattern, not a
claim about the child's reasoning. The planner queues the smallest useful
component probe and a nonidentical integrated retry two to four cards later.
The append-only attempt relation identifies whether a card is a
`remediation_probe` or a `delayed_retry`; only a correct delayed retry of the
original skill resolves the miss as eventually correct. Correct component
probes reclassify an isolated miss as an execution slip and avoid a remediation
block. Repeated confirmed patterns temporarily raise the relevant micro-skill
weight for at most a few cards before reintegration. If a finite session ends
before this compact sequence fits, the unresolved original miss is derived
from the event log and carried into the next non-benchmark session; fatigue
errors are deliberately excluded from that carryover.

Transfer constraints are curriculum rules, not presentation accidents. T01
starts with missing answers/subtrahends and holds missing minuends until enough
independent exposure has been collected. T03 schedules the same operands in
horizontal and vertical formats as an inseparable pair, including remediation,
while keeping format-specific fingerprints for duplicate control. T05 falls
back to an introductory-safe T01/T02 card because this route has no external
challenge provider. T04 remains disabled by default because Borrow Flash has
no compatible addition curriculum to reuse.

Fatigue signals can replace the remaining plan with one easy close. Repeated
late-session deterioration reduces the next session length; it never demotes a
concept or creates a backlog. Manual stops, elapsed-time caps, and fatigue
closures are recorded as partial completions. Partial diagnostics do not move
placement forward, and partial benchmarks do not start the seven-day benchmark
lockout.

## Handwriting and timing

Each adaptive attempt stores `shownAt`, optional `firstInkAt`, and
`submittedAt`, along with the derived response, first-ink latency, and writing
duration. Thinking before writing remains part of total response time.

The UI treats recognition as a separate uncertainty source. A prediction below
the existing reliable confidence or margin thresholds is shown for confirmation
or rewrite and is never submitted as a mathematical answer automatically. If
the child rejects it, the event is retained for recognizer diagnostics but does
not affect mastery, remediation, or fluency. Confirmed low-confidence answers
may count for mathematics, while their timing remains excluded. Backgrounding,
pauses, answer-revealing hints, and recognizer corrections also exclude timing
without discarding the learning record.

Draw mode uses an answer-neutral two-box surface for every numeric problem, so
the control never reveals whether the expected answer has one or two digits.
Either box may contain a single digit; two entered digits are read left to
right. The ordinary numeric input remains available as a keyboard fallback and
for valid three-digit misconception responses. Every recognition result is
confirmed or rewriteable before mathematical evaluation.

## Parent-only information

The compact parent details panel reports concept and fluency separately, then
accuracy, independent versus assisted attempts, response components, hint and
correction rates, error patterns, review retention, fatigue, and plateau notes.
No single score combines accuracy with speed, and private timing targets never
appear in the child flow.

An optional benchmark is eligible no more than once every seven days. It uses a
fresh balanced set of ordinary subtraction cards, has no visible countdown,
does not gate new content, and is reported only in the parent details. Benchmark
plans do not adapt after a miss. Their pacing summaries include every reliable
numeric response, correct or incorrect, while mathematical accuracy remains a
separate measure. A parent may optionally enter an external target for private
comparison; the target never enters scheduling or child-facing copy.

## Determinism and testing

All problem and session selection accepts a seed. Problem records retain the
seed, structured operands, template, format, and regrouping metadata so a card
can be reconstructed without trusting a rendered prompt string. The store uses
schema version 1 and adaptive content version 3; migrations normalize legacy
relation, completion, and missing-problem-snapshot fields before semantic
validation. Stored active sessions are rejected when their phase, position,
active-card flags, or current-problem snapshot disagree, preventing corrupt
resume state from contaminating the event log.

Unit, integration, and simulation tests cover generator invariants across the
full deterministic corpus, the mastery/fluency split, all eight required
synthetic learner profiles, diagnostic placement, remediation and cross-session
carryover, fatigue, plateau protection, persistence/migration, benchmark
eligibility and pacing, low-confidence recognition handling, and resume-state
boundaries.
