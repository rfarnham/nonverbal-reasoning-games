# Spatial Gym agent guide

This file is the product, experience, and implementation contract for the
entire repository. It codifies the decisions reached through iterative
play-testing of Transformation Match so that future minigames feel like members
of the same suite.

Use this precedence order when sources disagree:

1. direct user instructions;
2. this `AGENTS.md`;
3. executable tests as evidence of intended invariants;
4. the current implementation as a reference;
5. older project documentation.

Shipped behavior can contain a bug or lag this contract; it does not amend the
design by itself. Update stale documentation when it is in scope.

In this document:

- **MUST** is a release requirement.
- **SHOULD** is the expected default; deviate only for a concrete gameplay or
  accessibility reason and document the choice.
- **MAY** is optional.

## Product north star

Spatial Gym is a collection of short, focused browser games for practicing
nonverbal visual-spatial reasoning.

Every game should feel:

- **Visually clear:** the puzzle is the loudest thing on the page.
- **Aurally coherent:** feedback sounds are brief, gentle, and recognizable
  across games.
- **Intellectually fair:** difficulty comes from reasoning, not ambiguity,
  tiny details, obscure wording, or time pressure.
- **Ludically satisfying:** committing an answer, seeing why it worked or
  failed, building mastery, and redeeming mistakes form a pleasant loop.
- **Frictionless:** no account, download, backend, analytics, advertising, or
  third-party runtime network service, tracking call, or remote asset
  dependency.

These are practice games, not validated cognitive assessments. Never make IQ,
clinical, diagnostic, age-normed, or intelligence-score claims.

When priorities compete, use this order:

1. One provably correct answer and honest rules
2. Perceptual clarity and accessibility
3. Useful teaching feedback
4. Cross-game consistency
5. Delight and visual flourish
6. Novelty

## The shared play loop

The default round loop is:

1. **See** a compact visual prompt.
2. **Infer** one rule, relation, or spatial outcome.
3. **Commit** one deliberate answer.
4. **Observe** immediate, explanatory feedback.
5. **Retry** the same puzzle after a mistake, or **advance** after success.

Games MUST be untimed unless a later product decision explicitly introduces a
timed mode. Accuracy and reasoning matter more than speed. Do not add lives,
countdowns, loss screens, or punitive interruptions to the core practice loop.

Each game MUST focus on one primary reasoning skill. Extra mechanics may support
that skill, but must not turn the round into reading comprehension, dexterity,
or memory work by accident.

## Shared game anatomy

Every minigame MUST be a self-contained client-side experience at
`app/games/<slug>/` with a stable, hard-refresh-safe GitHub Pages URL.

The mode, level, checkpoint, redemption, and Infinite reward structures below
are intentional suite-wide decisions, not incidental copies of one game. New
games MUST use them unless a direct product decision approves a
mechanic-specific exception. A different interaction model does not by itself
prevent a game from using the shared session structure.

The expected experience is:

1. A compact top bar with:
   - back to all games on the left;
   - game title in the center;
   - sound toggle on the right.
2. A solved visual **Example** before play begins.
3. A sparse mode choice: **Campaign** and **Infinite**.
4. A compact progress/status area above the main play surface.
5. One large prompt area and one clear response area.
6. Immediate feedback directly below the play surface.
7. Deliberate level, review, and session checkpoints.

The opening example MUST demonstrate the core action visually and SHOULD show
one likely misconception or near-match. Keep explanatory prose to the minimum
needed to begin. Mode selection comes after the example.

Discrete-choice games SHOULD use four visibly numbered answer options in a 2×2
grid. A direct-manipulation game may use another response model when that is
intrinsic to its reasoning skill, but it must preserve the same feedback,
progress, and accessibility contract.

## Intellectual design

### Fairness before volume

Every puzzle MUST:

- be solvable from the information shown;
- have exactly one correct answer or verifiable completion state under the
  complete rule set;
- in a rule-inference game, admit exactly one normalized rule from the complete
  player-visible rule catalogue, not merely one rule from the intended subset;
- expose enough state for code to verify that result;
- reject accidental equivalence, symmetry, and degeneracy;
- reject duplicate evidence lines, evidence that exposes the answer, and
  transformations whose effect is a no-op or visually imperceptible;
- remain legible at supported phone sizes.

For a discrete-choice puzzle, answer options MUST also be mutually distinct and
free of duplicate choices. A direct-manipulation puzzle must make every legal
outcome resolve unambiguously.

“It looks unique” is not sufficient. Uniqueness must be demonstrated by pure
logic and tests.

### Meaningful distractors

In discrete-choice games, distractors are part of the curriculum. They MUST
represent plausible mistakes:

- applying a nearby but incorrect rule;
- confusing a reflection with a rotation or an analogous misconception;
- changing one local component;
- preserving most of the correct structure while getting one relation wrong.

Do not use filler options that can be dismissed without performing the intended
reasoning. Every discrete-choice puzzle SHOULD include at least one close,
local near-miss. Harder puzzles SHOULD make all alternatives convincingly
similar. Direct-manipulation games need the equivalent treatment: likely wrong
actions or states should receive misconception-based feedback rather than a
generic failure.

Starter and Junior alternatives MUST NOT depend on a style-only distinction
such as texture phase, motif heading, fill, shape, or size. Their four position
patterns MUST be pairwise distinct, and every pair MUST differ in at least two
positions. A size difference is allowed when changing size is the rule being
taught. Close one-feature traps belong in Expert and Wizard, after the
underlying rule is familiar.

Difficulty must not depend on low contrast, microscopic marks, arbitrary visual
noise, trick wording, or a faster clock.

### Difficulty ladder

All games use the same player-facing levels:

| Level | Design role |
| --- | --- |
| **Starter** | Introduce the rule with sparse, simple stimuli and generous distinctions. |
| **Junior** | Increase density or interactions and introduce plausible near-matches. |
| **Expert** | Add a meaningful second feature or reasoning dimension and close one-component traps. |
| **Wizard** | Use Expert-level stimulus complexity, remove one scaffold or cue, and require inference. |

Wizard is not “more visual clutter.” Its base density and feature count SHOULD
match Expert. The challenge comes from hidden information or a deeper inference.
The hidden information MUST still leave exactly one valid answer.

When a mechanic provides multiple evidence groups, Expert and Wizard puzzles
SHOULD keep each group insufficient on its own and require their combined,
gestalt evidence to identify the rule.

In rule-inference games, Starter and Junior MAY show the rule cue throughout the
round. Expert MUST withhold it until the first incorrect attempt, and Wizard
MUST withhold it for the entire round. A post-solve rule discovery or catalogue
explanation MAY name and teach the solved rule; it is not an in-round hint.

### Rule curriculum and notation

Rule-inference games MUST teach atomic rules before their complements, chains,
or whole-matrix compositions. The default conceptual order is:

1. union;
2. intersection;
3. exclusive or;
4. set difference;
5. rotation and other single-pattern sequences;
6. complements such as agreement (the biconditional) and complement of union;
7. chained and whole-matrix rules.

An authored Starter campaign MUST repeat each newly introduced atomic rule for
at least three consecutive puzzles before introducing another. Later levels
SHOULD continue to teach new families in coherent blocks, and Wizard MUST NOT
introduce an atomic rule part the campaign has not already taught. Infinite
difficulty pools MUST NOT surface a rule earlier than its authored curriculum
tier.

Starter alternatives MUST be generously distinguishable while still testing
the intended rule. In a four-cell pattern game, alternatives SHOULD use the
same shape, fill, size, orientation, and texture encoding as the correct answer
and differ in at least two occupied positions. Do not make an early trap depend
only on stripe phase, fill, size, orientation, or one tiny local feature.

Every player-visible rule part MUST have one stable, mathematically appropriate
symbol used consistently in hints, discovery lessons, feedback, and the rule
catalogue. A transformation diagram MUST use evidence from the active puzzle,
preserve a fixed reading direction, and show chained operations as distinct
ordered stages. Do not invent an unrelated miniature example inside a puzzle
cue. A discovery lesson teaches only the newly discovered atomic part; it MUST
NOT present the full compound rule as if every part were new.

Incorrect Wizard feedback MUST NOT reveal the hidden rule, operation, or cue.
Give localized “this does not match” feedback only when it preserves the
remaining reasoning challenge.

## Campaign mode

Campaign is the authored, deterministic learning path.

- It MUST contain 12 puzzles at each of Starter, Junior, Expert, and Wizard:
  48 puzzles total.
- Puzzles within a level MUST be completed sequentially.
- Players MAY switch among level tabs while the game is idle; each level keeps
  its own sequential cursor and history.
- The top progress area MUST use two rows:
  - named level tabs on top;
  - 12 individual problem markers for the active level below.
- Historical problem state is:
  - gray = not attempted;
  - green + check = correct on the first attempt;
  - red + cross = incorrect on the first attempt.
- State must never be communicated by color alone.
- A retry or redemption MUST NOT rewrite a red first-attempt marker or improve
  the recorded first-try score.
- Every completed problem marker MUST open a read-only historical review of that
  problem. Historical review is inspection, not **Review Mistakes**: opening or
  leaving it MUST NOT mutate level cursors, first-attempt history, score,
  outstanding mistakes, redemption state, or adaptive state.
- Focus MUST move into historical review when it opens and return to the
  originating problem marker when it closes.

For every four-choice 12-puzzle level, the correct answer MUST appear exactly
three times in each position. Validate the resulting order as a sequence too:
adjacent puzzles must not repeat the same correct position, and the level must
not be a four-position permutation repeated three times. Avoid other
conspicuous clumps while not creating a pattern players can exploit. Perceived
fairness matters as much as nominal randomness.

### Level checkpoints and redemption

Do not silently jump from the twelfth puzzle into the next level. End every
level at a checkpoint.

- If the level was 100% correct on first attempts, the primary action goes to
  the next incomplete level, or to Results when Campaign is complete.
- If the level contains any outstanding, unredeemed first-attempt errors, the
  primary action MUST say **Review Mistakes**.
- **Review Mistakes** opens **Here’s your chance at redemption** with only the
  outstanding mistakes from that level.
- Redemption retries those puzzles sequentially until correct.
- Completing the queue returns the player to that level’s completed checkpoint,
  where continuation is now available.
- Redeemed puzzles disappear from outstanding review lists but retain their red
  historical markers.
- Final results MUST still offer outstanding mistakes from other levels.

Redemption is a learning loop, not a score rewrite.

## Journey progression mode

Journey is a suite-wide progression layer over the canonical games. It does
not replace Campaign or Infinite, and playing a game directly from the shelf
MUST NOT change Journey progress, XP, or Journey mistake history.

The homepage MUST make **Start Journey** or **Continue Journey** its prominent
primary action. The game shelf remains available for standalone play.

Journey is generic:

- discover games from the generated catalog rather than a handwritten list;
- launch the canonical game route with a typed Journey attempt reference;
- reuse each game's authored Campaign rounds, generator, validator, renderer,
  feedback, retry, and redemption behavior;
- never branch on a game slug inside Journey;
- never copy a game's puzzle data or generation logic into Journey;
- snapshot the ordered game membership when a profile starts so a later catalog
  change cannot rearrange earned progress;
- store compact question references and content versions, not rendered rounds.

Each profile advances through seven Journey boards:

`Starter → Junior I → Junior II → Expert I → Expert II → Wizard I → Wizard II`.

Starter contains eight ordinary stops, four **Turbo Time** stops, and one
culmination. Junior I and above add two Math Kangaroo spatial-review stops, one
after each half of the ordinary/Turbo path. Their cadence is:

`(ordinary, ordinary, turbo) × 2, spatial review` repeated twice, then
culmination.

An ordinary stop runs the selected game's 12-question Campaign level for the
board difficulty. Junior II, Expert II, and Wizard II use separate,
Journey-only authored 12-question banks owned and validated by each game; they
MUST NOT expand or alter the standalone 48-question Campaign. One stop contains
only one game. Intermediate state MUST be saved after every answer and
transition so a reload or later visit resumes the exact stop, question,
first-attempt history, redemption queue, and active practice time.

Math Kangaroo spatial review:

- appears exactly twice on every board from Junior I onward;
- uses 12 distinct questions per stop;
- uses grades 1–2 on Junior I through Expert I;
- uses grades 3–4 on Expert II through Wizard II;
- keeps question prompts as semantic HTML and bundles only selected,
  question-scoped illustrations locally;
- removes prompt text from illustration crops and relabels answer options 1–5;
- verifies every answer against the official answer key;
- provides a question-specific wrong-answer hint, at least two reviewed
  solution steps, and a causal explanation animation grounded in the actual
  local illustration;
- uses named, normalized illustration regions or paths so the animation can
  trace, exactly transform, compare, or count the specific evidence; a generic
  highlight followed by an answer reveal is not sufficient;
- ends every animation by revealing the official-key answer, using a real
  image answer region for visual choices or the semantic answer card for an
  OCR-only text, pair, number, or sequence choice;
- retains the same full-stop and redemption behavior as ordinary stops.

Turbo Time:

- uses the selected game's canonical Infinite generator and adaptive rules;
- lasts two minutes of active answering;
- pauses while the document is hidden and while an explicit explanation or
  teaching modal is open;
- keeps running through ordinary answer feedback, teaching animations, solved
  states, and puzzle-to-puzzle transitions;
- never adapts above the avatar's current board difficulty;
- stops starting new rounds at zero but lets the active puzzle finish;
- finishes with the same untimed redemption loop as other sessions;
- requires at least one solved puzzle to be eligible to clear.

A board culmination runs three questions per snapshotted canonical game: one
Starter Campaign question and two prior missed questions from that game. If
there are not enough distinct misses, fill from the current Campaign level.
From Junior I onward, append four fresh Math Kangaroo questions that were not
used in either review stop on that board. Culmination sections are sequential
and resumable. Before the first question of every section, keep that provider’s
canonical solved Example visible with explicit section context and a
player-triggered Continue action; never flash through it or auto-dismiss it.
Persist that acknowledgement, and do not count time spent reading the Example
as active practice. A non-Wizard-II culmination advances the avatar only after
the complete test and redemption are finished; Wizard II ends with a mastery
celebration. Question selection MUST treat a reference as the same question
before and after its optional fingerprint is materialized, and a saved
culmination with an untouched legacy collision MUST repair generically without
discarding already solved sections.

Only first attempts affect Journey accuracy. Always let the player finish and
redeem the entire stop. Accuracy strictly greater than 70% clears it. A cleared
stop earns its XP once and unlocks the next node. A result at or below 70%
receives encouraging feedback, earns no XP, and may retry the stop. Every
first-attempt miss is retained as a compact, versioned question reference for
future culminations, whether or not the stop clears. Each miss observation MUST
also retain the stop, board, attempt, timestamp, and active practice time
elapsed before that first answer.

XP is celebratory, not a gate. Every cleared node on a board awards a constant
amount, doubling each board: Starter 25, Junior I 50, Junior II 100, Expert I
200, Expert II 400, Wizard I 800, and Wizard II 1600. Awards MUST be idempotent
by stop ID and retained in a write-once amount ledger so later balance changes
cannot rewrite earned XP. Starter’s 13 nodes total 325 XP; each later board has
15 nodes and totals 750, 1500, 3000, 6000, 12000, and 24000 XP respectively.
Show total XP on the board and pair acquisition with a brief locally
synthesized jingle when sound is enabled.

After every attempt, show an extremely positive summary with XP earned,
first-attempt accuracy, and active practice time. Time is informational outside
Turbo and MUST NOT be praised as a measure of ability. Claiming XP or finishing
a passed summary MUST settle the attempt, save the award, and return to the
Journey map in one action; do not add a second **Continue Journey** confirmation.

Journey supports multiple device-local profiles. Prompt for a short display
name and one of at most 16 bundled, consistently styled animal avatars, including
a hedgehog or porcupine. Allow creating, switching, renaming, re-avataring, and
deleting profiles. Store versioned profiles and progress in `localStorage`;
handle blocked, corrupt, stale, and quota-exceeded storage without crashing.
There are no accounts, cookies sent to a server, cloud sync, or remote runtime
assets.

## Infinite mode

Infinite mode generates puzzles on demand and uses the same Starter, Junior,
Expert, and Wizard definitions. It shares Campaign’s per-puzzle correctness,
uniqueness, interestingness, and difficulty predicates. Campaign-only
set-level requirements such as 3/3/3/3 position balance and authored coverage
do not apply literally to an unbounded stream.

It MUST:

- start at Starter;
- avoid repeated puzzle fingerprints within a session;
- adapt only from the first attempt on each unique round;
- ignore retries when updating difficulty, combo, or accuracy;
- allow the player to end the run after at least one solved puzzle;
- use the same mistake review and redemption model at session end.

The current adaptation rule is suite-wide:

- three consecutive first-try wins at the current level promote one level;
- two misses among the latest three attempts at the current level demote one
  level;
- promotion and demotion clamp at Starter and Wizard;
- a round ID contributes to adaptation only once.

### Combo and energy

- Combo increases by one for every first-try correct answer.
- Any first-try miss immediately resets combo to zero.
- A yellow/amber energy bar fills linearly with combo.
- Combo 8 is 100% energy.
- At maximum energy, the treatment becomes an earned electric-blue,
  “supercharged” glow.
- Combo and energy changes MUST have accessible text/status equivalents.

The glow is deliberately exceptional. Do not use equally strong glow effects
for routine controls or decoration, and do not turn energy into currency,
monetization, or a random reward mechanic.

## Feedback is teaching

Only the first attempt affects first-try score, campaign history, adaptive
difficulty, and combo. A wrong answer does not advance; the player retries until
correct.

Feedback MUST combine:

- visible state;
- a check/cross or another non-color symbol;
- concise text;
- a distinct short sound when sound is enabled.

### Correct answer

On a correct answer:

- play the positive earcon;
- clearly mark the successful result with text and a non-color symbol;
- in a discrete-choice game, mark the correct choice and mute irrelevant
  choices;
- show a legible explanatory animation when the mechanic benefits from one;
- move focus to an explicit Next, Finish level, Finish review, or Results
  control.

Explanatory motion SHOULD take roughly 900 ms: long enough to perceive the
causal change, short enough to keep momentum.

### Incorrect answer

On an incorrect answer:

- play the negative earcon;
- clearly mark the attempted response; use the established red treatment and
  cross for discrete choices;
- compare or overlay it with the expected structure when doing so will not
  spoil a hidden-rule challenge;
- highlight exact local differences when that comparison is meaningful;
- otherwise identify the violated relation in a domain-appropriate way without
  revealing hidden information;
- state a concise difference count or domain-appropriate explanation;
- let the explanation linger before retry;
- restore focus to the attempted answer or equivalent interaction control;
- show a simple **Try again** state.

The current normal-motion reference lets wrong feedback linger for about
2.2 seconds. Do not flash an error too quickly to inspect. Do not automatically
advance after a mistake.

Every new game needs its own domain-appropriate answer to “what exactly was
wrong?” A red border by itself is not adequate teaching feedback.

## Visual language

The visual character is warm, crisp, sparse, and editorial: playful without
being childish, tactile without simulated texture, and energetic without
looking like a dashboard.

### Shared shell palette

Use these semantic game-shell colors or shared tokens derived from them:

| Role | Reference |
| --- | --- |
| Ink | `#17213d` |
| Muted ink | `#657087` |
| Warm paper | `#fbf8f0` |
| Bright panel | `#fffdf8` |
| Restrained line | `#cfcabd` |
| Correct | `#16836b` |
| Incorrect | `#bf493e` |
| Focus | `#1679d2` |

The established flat puzzle accents are coral `#f06f5f`, gold `#f3bd4e`,
teal `#35a999`, and violet `#7767d7`. The catalog also uses coral, blue, and
lime as brand accents. New games SHOULD reuse a controlled subset rather than
invent an unrelated palette. Add a new functional color only when the mechanic
needs it and contrast remains accessible.

Marketing artwork may have a print-like treatment. That is not a precedent for
gameplay surfaces.

### Shape, type, and spacing

- Use Inter with the existing system sans-serif fallback.
- Use very bold, tightly tracked display headings.
- Use compact uppercase kickers sparingly.
- Reserve monospace for counters, shortcuts, and machine-like labels.
- Prefer generous breathing room, thin borders, rounded panels, and
  pill-shaped controls.
- Primary actions are dark filled pills.
- Secondary actions are bright-panel pills with restrained borders.
- Hover movement is subtle, typically a 2px lift.
- Keep the live round visually sparse. Remove labels or copy that merely repeat
  what layout, shape, or feedback already communicates.

Gameplay stimuli MUST use flat colors and simple geometry. Do not add bevels,
lighting, faux-3D rendering, decorative shading, or textures to simple pieces.
Necessary advanced marks or patterns may carry information, but they are puzzle
state, not decoration.

When the clue and answer choices use the same visual object, they MUST derive
their rendered panel size from one shared token. Do not let responsive rules
independently enlarge an option or shrink a clue panel.

An active rule hint is teaching content, not metadata. Its mathematical symbol,
name, and visual equation MUST be prominent enough for a child to inspect
without zooming. Catalogue and rule-discovery symbols SHOULD use the same
notation at an equally legible teaching scale.

### Responsive layout

The desktop reference is a two-part board that stacks on smaller screens.
Design and test at the established 820px, 620px, and 390px breakpoints. The
narrow layout MUST not scroll horizontally, crop answer content, or reduce
interactive targets below 44×44 CSS pixels.

## Motion language

Motion explains causality; it is not ambient decoration.

- Animate the actual state change, not a generic flourish.
- Preserve geometry, direction, scale, orientation, and timing truthfully.
- If a piece contains a directional mark or advanced pattern, transform the
  mark with the piece.
- A visual cue for a partial turn or movement must depict its actual extent.
- Translucent “ghost” overlays are encouraged when they help connect prompt to
  outcome.
- Lock input during teaching feedback to prevent double submissions.
- Scrolling, resizing, navigation, and unmounting must safely finish or cancel
  positional overlays.

Transformation Match is the motion reference: a translucent prompt copy travels
to the selected answer while applying the real operation over 900 ms with a
smooth `cubic-bezier(0.2, 0.75, 0.25, 1)` curve. An incorrect result settles
briefly over the attempted answer so local differences can be inspected.

Respect `prefers-reduced-motion` in both CSS and JavaScript. Preserve the
information and final feedback state while removing travel, looping aura, and
nonessential transitions. The current reduced-motion references are about
140 ms for the ghost/fade and 1.3 seconds for wrong-answer review.

## Aural language

There is no background music.

Use short, clean, locally synthesized Web Audio earcons. Audio MUST NOT require
network requests, licensed assets, or successful playback for the game to work.

The shared sound grammar is:

- **Correct:** a quiet ascending C5 to E5 pair, approximately 523.25 Hz then
  659.25 Hz, lasting 130–150 ms.
- **Incorrect:** a quiet descending A3 to F3 pair, approximately 220 Hz then
  174.61 Hz, lasting 110–120 ms.
- Sine waves with an approximately 8 ms attack and quick exponential decay.
- Reference peak gains are `0.052` then `0.048` for correct and `0.048` then
  `0.044` for incorrect.

The positive sound should be satisfying, not triumphant; the negative sound
should be distinct, not scolding. Never rely on sound alone.

Every game MUST expose the same obvious top-bar sound toggle, default on, with
`aria-pressed`. Remember the preference locally on the device. New shared-shell
work SHOULD converge on one suite-wide storage key while honoring any legacy
per-game key during migration. Resume audio only after a user gesture and
handle unavailable, suspended, or rejected audio contexts without uncaught
errors.

Before a second game ships, extract or reuse one shared earcon helper rather
than independently approximating these values in each route.

### Spoken teaching narration

When a game narrates a visual teaching sequence, every game MUST use the same
suite narrator: Kokoro-82M v1.0, voice `af_heart`, speed `0.88`, generated
offline from the pinned revision recorded in the narration manifest. Commit
small same-origin audio clips; the model MUST NOT run or download in the
player's browser, and runtime narration MUST NOT call a speech service.
`window.speechSynthesis` is not the canonical narrator because its voice and
quality vary by device and some installed voices are remote.

Games MUST consume `lib/game-narration.ts` rather than create their own audio
sequencer or choose another voice. Every game-owned clip manifest MUST match
the shared `SUITE_NARRATOR_PROVENANCE`; model, revision, voice, and speed are
validated rather than merely documented. Reuse one media element for the full
sequence and prime it from the answer gesture so narration remains reliable on
WebKit. The shared sound toggle controls narration
as well as earcons. A muted, unavailable, or rejected clip keeps the identical
slow visual schedule, and a stalled clip MUST have a bounded watchdog so it
cannot lock gameplay. Each narrated operation keeps one short caption stable
for the full spoken cue and an absorption pause; do not flash words, highlight
speech word by word, or add a countdown/progress cursor that competes with the
puzzle. The audio ending, minimum visual duration, and linger together control
advancement. Reduced motion removes travel but MUST NOT shorten narration or
teaching time.

## Voice and copy

Use plain, compact, encouraging language for teens and adults.

Preferred vocabulary includes:

- Example
- Campaign
- Infinite
- Correct
- Try again
- Level complete
- Review Mistakes
- Here’s your chance at redemption
- Retry missed
- Finish level
- Results

Avoid tutorials made of paragraphs, excessive labels, childish praise,
punishment language, technical geometry terminology when a visual cue suffices,
and any claim that a score measures intelligence.

Words support the visual reasoning; they do not carry it.

## Accessibility and input

Mouse, touch, and keyboard are equal first-class inputs.

Every game MUST:

- use real buttons for discrete answer choices and semantic native controls for
  other actions;
- keep touch targets at least 44×44 CSS pixels;
- show a strong visible focus state; the current reference is a 3px blue
  outline with 4px offset;
- meet WCAG AA contrast for text, controls, focus, and functional visual cues;
- support native keyboard activation;
- expose number keys 1–4 for four-choice rounds and visibly number the choices;
- use `aria-keyshortcuts` for those shortcuts;
- pair color feedback with symbols, text, and accessible names;
- use semantic header, main, nav, section, heading, button, and progress
  elements;
- give progress bars labels and min/max/current values;
- use `aria-current` for the active step;
- announce feedback, combo, and energy changes with polite live regions;
- hide duplicate decorative substructure from assistive technology;
- provide meaningful names for visual prompts and operation cues without
  leaking the answer.

Global game shortcuts MUST ignore input, textarea, select, and editable
elements. Dragging, drawing, or other fine-motor interactions MUST have a
keyboard-operable, non-fine-motor alternative.

Focus movement is part of the game state:

- focus the first answer or primary interaction control when a round begins;
- focus the next action after a correct answer;
- return focus to the attempted choice or equivalent interaction control when
  retry becomes available;
- focus the level checkpoint action after level completion;
- focus the results heading on completion.

If a text-equivalent description would solve an inherently visual puzzle,
describe the nature of the task honestly rather than encoding the answer in alt
text.

## Puzzle generation and data

Keep authored puzzle data and pure puzzle logic separate from React rendering.
Authored results MUST be calculated by executing typed rule programs over source
pattern objects, never maintained as independently trusted output literals.

Games with composable rules MUST define one explicit, finite player-visible
rule-program grammar. Pattern Matrix permits one combine/compare operation
followed by zero or one change, a standalone sequence, or an explicitly
supported whole-matrix cascade. Its validator expands the taught Boolean
operations to the complete normalized set of Boolean functions that genuinely
depend on both shown inputs, so an equivalent multi-operation expression cannot
evade uniqueness. Constants and projections are not legal combine rules because
they discard a shown input. Generation, distractor construction, inference, and
validation MUST enumerate that same normalized grammar; a puzzle is valid only
when exactly one program fits all evidence and only its calculated answer
appears among the choices.

Generated puzzles MUST:

- accept a seed or deterministic injected random source;
- reproduce the same output from the same seed or random-source sequence;
- use explicit difficulty rules;
- calculate the correct answer rather than label an assumed answer;
- validate exactly one answer after considering every legal equivalence;
- validate all options are distinct in a discrete-choice puzzle;
- enforce meaningful near-miss heuristics;
- reject uninteresting or ambiguous candidates;
- use a stable fingerprint independent of option ordering and semantically
  equivalent rule or instruction representations;
- avoid repeated fingerprints in one session;
- stop after a bounded number of attempts and fail clearly rather than emit a
  bad puzzle.

Authored Campaign puzzles MUST build deterministically without consulting
randomness and MUST have unique fingerprints across all 48 rounds. If authored
content is produced with a generator, freeze and review the resulting data.

A generator may reject candidates or throw on bounded exhaustion internally so
tests can prove safe failure. The runtime caller MUST catch exhaustion and
offer a recoverable retry or known-valid fallback without serving an invalid
puzzle, crashing play, or producing an unhandled rejection.

Tests for a generator MUST sample a large deterministic corpus across every
difficulty. The current acceptance precedent is at least 400 seeds per level,
1,600 puzzles total, plus hostile random-source tests. Prove:

- one exact answer;
- four distinct options where applicable;
- difficulty density/feature bounds;
- transformation or rule-family coverage;
- close and meaningful distractors;
- reproducibility;
- authored-corpus and within-session fingerprint uniqueness;
- safe rejection and bounded failure;
- hidden-rule uniqueness;
- answer-position balance for Campaign.

## Technical and privacy contract

- This is one statically exported Next.js project using TypeScript and React.
- Games run entirely in the browser; do not add server-only APIs.
- Internal navigation uses `next/link` so the GitHub Pages base path works.
- A game URL must survive a hard refresh under
  `/nonverbal-reasoning-games/games/<slug>/`.
- Browser storage is limited to explicit device-local preferences or progress.
- Do not add analytics, tracking, accounts, remote storage, advertisements, or
  third-party runtime calls without a separate product and privacy decision.
- Prefer code-native CSS, SVG, Canvas, and Web Audio assets.
- Do not introduce licensed visual or audio assets casually.
- Each game owns its route, logic, scoped styles, and tests.
- Share shell primitives, semantic tokens, earcons, and progress components
  when reuse is proven; do not force unrelated puzzle mechanics into a generic
  abstraction.
- Every implemented game MUST own a `catalog.tsx` that exports typed `gameInfo`
  metadata and a self-contained `ShelfIcon`. The build-time registry discovers
  route directories with `page.tsx` and `catalog.tsx`; do not maintain a central
  game list.
- A discoverable `catalog.tsx` is the release marker. Add it only after the
  complete session and all checks pass.
- Keep the repository public and open source.
- Link every discovered game from README; the catalog link is generated.
- Verify the production GitHub Pages URL before calling a game live.

Runtime interaction must not produce unhandled promise rejections or console
errors. Audio, storage, animation, and browser API failures must degrade safely.

## Delivery and deployment

Unless a direct user instruction says to keep work local or branch-only,
finishing a game includes merging it into `main`, pushing it to GitHub, and
verifying the production deployment. Do not stop after a local commit or a
feature-branch push.

Use this release sequence:

1. Commit only the intended game and shared changes on the feature branch.
   Confirm the worktree is clean and `npm run check` passes.
2. Fetch `origin`, incorporate the latest `origin/main` into the feature branch,
   resolve only unambiguous in-scope conflicts, and rerun `npm run check`. Stop
   and ask for direction if a conflict would require guessing about unrelated
   work.
3. Push the feature branch to GitHub, then advance `main` with a guarded
   fast-forward. Never force-push or bypass branch protection. If protection
   requires a pull request, create or update the PR and enable its normal
   auto-merge path after required checks pass.
4. Treat a rejected non-fast-forward update as a race: fetch the new
   `origin/main`, integrate it on the feature branch, rerun checks, and retry
   the guarded update. Do not overwrite newer remote work.
5. Follow the GitHub Actions Pages workflow triggered by the `main` update until
   it succeeds. If it fails because of the shipped changes, diagnose the
   failure, fix it on the feature branch, and repeat the safe integration flow.
6. Verify both the production catalog and the game’s hard-refresh URL under
   `https://rfarnham.github.io/nonverbal-reasoning-games/`. Confirm the new
   shelf card, game-owned icon, navigation, page content, and browser console
   load without errors before reporting the game deployed.

A game delivery is complete only when the remote `main` commit contains the
change, the Pages deployment for that commit succeeds, and the public game URL
has been verified. Report the feature branch, final commit, deployment result,
and playable URL.

## Transformation Match reference requirements

The following requirements are specific to Transformation Match. They illustrate
the broader principles above but should not be copied literally into unrelated
games.

- Each puzzle is a 3×3 grid with four answer choices.
- Generated Starter rounds use 3–4 filled tiles and no directional motifs.
  Authored Starter stays sparse and motif-free; two operation-coverage rounds
  currently use 5 filled tiles.
- Junior uses 5–6 filled tiles and no directional motifs.
- Expert and Wizard both use 6–7 filled tiles and 2–4 directional motifs.
- The 12 authored Wizard puzzles match Expert’s overall density/motif profile.
- Simple levels use flat-color tiles without texture or shading.
- Directional cap motifs are meaningful state and rotate or reflect correctly
  with their containing tiles.
- Supported operations are:
  - 90°, 180°, and 270° rotations;
  - clockwise and counterclockwise directions;
  - vertical and horizontal reflections;
  - both diagonal reflections.
- Each authored level covers both directions, all three turn lengths, and all
  four reflection axes.
- A rotation arrow’s arc length depicts the actual turn: a quarter turn looks
  like a quarter turn, not a full circular arrow.
- Harder alternatives include reflection traps, alternate rotations,
  one-block-off answers, and one-motif-off answers.
- Wizard hides the operation behind a large question mark.
- A Wizard clue has eight distinct dihedral states.
- Exactly one Wizard option is reachable by any supported non-identity
  transformation.
- Every Wizard distractor lies outside the clue’s complete transform orbit and
  differs from the correct answer by only one or two tiles.
- Ordinary feedback animates a translucent copy of the clue, applying the
  actual rotation/reflection and scaling it into the selected answer.
- Ordinary incorrect feedback lands that overlay on the wrong choice and
  highlights the exact differing tiles.
- Incorrect Wizard feedback suppresses the transformation ghost because it
  would reveal the hidden operation.

The current engine and tests in `app/games/rotation-match/` and
`tests/rotation-engine.test.mjs` are the executable reference for these rules.

## Definition of ready

Before calling a new game playable or live:

1. The opening example teaches the mechanic without a paragraph.
2. Campaign contains 12 validated puzzles at all four levels.
3. Infinite uses the same level definitions and validated generation rules.
4. Every puzzle has one provable result and misconception-based alternatives or
   wrong-state feedback.
5. Four-choice Campaign answer locations are balanced 3/3/3/3 per level
   without adjacent repeats or a repeated four-position cycle.
6. Correct, incorrect, retry, checkpoint, results, and redemption flows work.
7. First-try history cannot be rewritten by retrying.
8. Sound, reduced motion, focus handoffs, and live announcements work.
9. The full session works with mouse, touch-sized controls, and keyboard.
10. Phone layouts do not scroll horizontally.
11. Hard refresh and internal links work under the GitHub Pages base path, and
    the production URL is verified after deployment.
12. There are no unhandled rejections or console errors in normal play.
13. `npm run check` passes.
