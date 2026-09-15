# Subtraction Steps

Route: `/lab/subtraction-trainer/`. A standalone handwriting-only subtraction
trainer built on Borrow Flash's locally bundled digit recognizer. It has no
Journey integration, remote service, account, or shared learner-progress store.

## Curriculum

| Tier | Top number | Bottom number | First-response target |
| --- | --- | --- | --- |
| 1 | 1–9 | 0 through the top number | At most 3 seconds |
| 2 | 10–19 | 1–9 | At most 4 seconds |
| 3 | 20–99 | 1–9 | Under 5 seconds |
| 4 | 10–99 | 10 through the top number | Under 6 seconds |
| 5 | 100–999 | 10–99 | Under 7 seconds |

Every session has eight focus/review questions followed by eight independently
sampled progress-check questions. Lower-tier review never qualifies a learner
for a higher-tier gate. The check excludes zero/equality shortcuts, varies
borrowing patterns, includes zero-ending top numbers in tiers 3–4, and covers
all five borrowing patterns in tier 5. Plans contain distinct operand pairs.

After the session and its mistake review, eight correct, reliable check
responses within the tier target unlock the next tier. A missed, slow, or
unreliable check response prevents that promotion. A correct retry never
rewrites a first attempt. Early completion is permitted after a solved question
and still reviews observed mistakes. Earned tiers are retained; replay cannot
earn duplicate mastery.

Practice selection uses seeded randomness and recent performance. Early tiers
weight exact facts. Later tiers weight borrowing pattern, effective ones fact,
and the tens fact after the ones borrow. Two review slots favor earlier-tier
weaknesses after at least a one-minute gap, falling back to mixed earlier-tier
practice. Subsequent sessions naturally provide further spaced exposure. Check
selection does not consult these weakness weights. Large pools use uniform
candidate sampling before weighting to keep selection responsive.

Tier 3 deliberately stops at 99: 100 is a three-digit boundary requiring
borrowing through zero, taught explicitly in tier 5. Tier 2 prioritizes
teen-minus-single-digit facts; it does not introduce teen-minus-teen problems
ahead of tier 4. Tier-5 results can have one, two, or three digits.

## Writing and timing

The complete question area is writable. One SVG supplies the printed operands,
line, and answer bands; a separate canvas holds only learner strokes. Each
stroke is associated with scratch space or an answer column. A stroke that
crosses region boundaries becomes scratch ink. Digit recognition receives only
strokes from the chosen answer column, never printed text or scratch marks.

The child sees the vertical question, a small lifetime star total, Pause, and
an eraser. Titles, tier labels, progress bars, instructions, parent reports,
and navigation are kept off the active practice screen. Pause exposes session
details and an early-finish action between solved questions.

The learner writes right-aligned answers, in either direction. Like Borrow
Flash, recognition starts 560 ms after the last pen lift; there are no Check,
confirmation, or Next buttons. It waits until the required number of answer
columns have ink, so thinking between columns cannot submit an unfinished
answer. An unfinished answer gets a short “Keep going” cue after two seconds,
without recording a math error. Only completion uses the calculated answer length; glyph recognition
never receives the expected digits. The visible answer boxes retain their
fixed tier width. Low-confidence readings clear only the answer and ask for a
redraw, without scoring a math error. Starting another stroke invalidates any
pending read. The interface has no typed, traced, spoken, or choice answer mode.

Response time runs from the fully rendered question to the final answer pen
lift. It includes thinking and any notes made before completing the answer, but
excludes the handwriting debounce, recognition processing, and transitions. First-ink and
recognition durations are also retained. Pauses, backgrounding, reloads,
rejected recognition, and low-confidence readings exclude the response from a
speed gate. The same question remains answerable. Recognition has bounded
timeouts and recoverable errors. The recognized number is never changed to match the expected answer.

Borrow marks are permitted, counted in writing time, and never independently
invalidate a gate. Parent reporting includes how often scratch ink occurred.
Scratch ink does not diagnose a particular strategy.

Correct answers play the shared earcon, briefly show a check, and advance after
320 ms. Incorrect answers identify the differing columns and the recognized
number, then automatically clear the answer for retry after 2.2 seconds (1.3
with reduced motion), preserving borrow marks. Full column explanations remain
in historical review. Input locks during feedback; pausing or backgrounding
cancels pending recognition and advancement until practice resumes.

Each newly solved question earns one decorative star, including a successful
retry. Redemption of that same question cannot award another. Every fifth star
shows five small stars for 950 ms before automatically advancing. The cadence
continues across sessions, and reduced motion shows a static celebration for
the same duration. Stars do not affect gates, timing, accuracy, or difficulty.
The same sound preference and local audio helper are used across the suite.

## Persistence and review

`spatial-gym:subtraction-trainer:v1` stores one named learner, seed, mastery,
active plan, cursor, ink, first responses, review queue, active practice time,
a lifetime star count, per-session awarded question IDs, the latest 2,000 first
attempts, and the latest 40 session summaries. Existing saves migrate in place
with zero initial stars, preserving all learning records and avoiding replay
awards for already-solved questions. Saves
occur on completed strokes, answers, transitions, every five active seconds,
and page hiding. Reload restores the exact problem and review position, pauses
play, and makes the interrupted response ineligible for timing.

Validation rejects invalid operands, contradictory correctness, skipped
questions, broken review queues, malformed ink, unsupported versions, and
inconsistent progress. A corrupt/unsupported existing save is preserved while
the visit uses temporary progress. Blocked or quota-limited storage displays an
explicit temporary-progress message instead of crashing.

Completed first-attempt markers open a native read-only review dialog. They
retain red/green plus cross/check state after redemption. The dialog returns
focus to its originating marker and never mutates learning state.

## Parent reporting and readiness

Reports separate first-try accuracy, reliable mean written-response time,
scratch use, borrowing patterns, and active session time. Means include reliable
incorrect answers rather than reporting only successful ones.

After all five tiers are achieved, an optional 30-question readiness check
samples the five borrowing categories equally and has the same correction and
redemption loop. It does not change mastery or adapt mid-check. Its recorded
mean and total time can be compared with real worksheet performance.

The reported practice reference, 90 questions in 10 minutes, implies about
6.67 seconds per question overall. The seven-second gate is an intermediate
training target, not a claim of worksheet readiness. The app's
feedback, question distribution, and automatic transitions differ from paper. These are
practice measurements, not validated cognitive or diagnostic scores.

## Scope decisions

The direct product brief defines this lab's five tiers, timed fluency gates,
draw-only answers, and purposeful repeated practice. These are explicit
exceptions to the general game suite's four difficulties, Campaign/Infinite
structure, non-repeating sessions, and non-fine-motor answer alternative.
The later product decision explicitly replaces deliberate per-answer controls
with automatic submission, retry, and advancement, and hides the shared top
bar during active practice. Navigation and controls still support keyboard
focus and activation. The lab
is linked from the homepage and README, without registering as a Journey game.

## Validation

- `tests/subtraction-trainer.test.mjs`: 400 seeded sessions per tier, 32,000
  questions, all five tiers, borrowing arithmetic, advancement boundaries,
  retry invariance, redemption, repeat mastery, benchmarking, storage failure
  and resume cases, scratch/answer isolation, incomplete-column waiting, star
  award idempotence, legacy save migration, and paused early completion.
- `tests/static-export.test.mjs`: refresh-safe exported route and home link.
- Browser QA: actual drawn digits through the local model, scratch exclusion,
  one- and three-digit answers, incorrect feedback and retry, redemption,
  reload, immutable history review with focus return, and 820/620/390px layouts.
- Full repository release checks: `npm run check`.

Research rationale: [pre-implementation research](./julia-subtraction-remediation-research.md).
