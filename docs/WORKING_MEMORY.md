# Memory Lab

[Open the lab](https://rfarnham.github.io/nonverbal-reasoning-games/lab/working-memory/)

Memory Lab is an independent working-memory practice suite with visual tasks
and optional, locally narrated auditory tasks.
It draws on the user's supplied Cogmed research and published task descriptions;
it does not reproduce Cogmed's branding, assets, proprietary algorithm, or
clinical service. Exact feature parity and equivalent outcomes are not claimed.

## Scope and repository exception

Eight visual exercises cover forward and backward spatial recall, transformed
locations, moving targets, shape sequences, object-location associations,
simultaneous patterns, and split visual attention. One **Digits** game supplies
the listening exercises, making nine visible games. Its options combine reverse,
ascending, or descending order with keypad or spoken responses. With keypad
responses, the keypad can stay visible or be hidden during presentation; it is
visible for answering. Spoken responses have no keypad. There is no forward
digit-recall option.

These options produce nine distinct variants at each presentation pace: six
keypad variants and three spoken variants. Keypad visibility does not create
duplicate spoken variants. The old Reverse Digits, Hidden Keypad, and Number
Assembly entries remain internal compatibility aliases, not separate game
cards. Authored instructions, their legacy names, and recordings remain in the
existing encrypted bundle; combining the cards does not rebuild the pack or
change the key.

The requested Cogmed-style experience is a mechanic-specific Lab exception to
the canonical Campaign/Infinite session contract in `AGENTS.md`. Brief stimulus
presentation and a retention interval are intrinsic to these memory tasks;
answering is untimed. The lab has its own adaptive sessions and progress. It
does not join the generated game catalog or alter Journey progress or XP.

Mixed sessions contain 24 or 48 trials and alternate the selected Digits
variant with Light Path, Turning Grid, and Moving Lights. Half the rounds are
listening rounds; the three visual exercises share the other half. Visual-only
sessions balance all eight visual exercises. Audio-only sessions repeat the
selected Digits variant, rather than treating its old aliases as different
games. Focused practice contains eight trials of one game or Digits variant.
New sessions use the
`research-v1` difficulty profile: Light Path and Pattern Hold start at three
items; other exercises start at two. Loads range from two to nine, except
Hidden Homes, which displays and queries two to six distinct shape–location
bindings. Hidden Homes allows at least five seconds to study those pairs.
Difficulty adapts independently for each task using an app-defined weighted
staircase inspired by the published Cogmed research edition's daily 60% target.
This is not Cogmed's proprietary controller or empirically matched difficulty.
See [the publication audit and exact practice rules](WORKING_MEMORY_EVIDENCE.md).

There is one finite-pool exception to the repository's no-repeat rule. At a
two-digit load, ascending or descending sorting has only 36 distinct
presentations that require changing the order. A 48-round listening-only
session can exhaust them if load remains at two. Canonical Digits sessions
therefore enumerate all 36 without repetition, then begin another complete
cycle. They never increase memory load just to find a new question. A repeated
presentation retains its semantic fingerprint but receives a distinct,
deterministic occurrence ID, keeping first-attempt and redemption records
separate. Older sessions without `digitVariant` retain their original behavior.

Original-profile saved sessions retain their two-successes-up / one-miss-down
staircase. Earlier research-profile sessions retain their weighted staircase.
All existing active sessions finish with their original rounds, task mix,
settings, and first-attempt history. Missing `digitVariant` fields keep the
saved round identities and generator behavior unchanged.

New sessions keep independent adaptive records for each distinct Digits
variant and standard/slower pace. Visual records depend on pace, independent
of the listening options. Digits settings sit inside its own section; pace
applies to all games. Replay and review are learning aids, not additional
scored attempts.

Earlier research-condition records are archived with their counts. If exactly
one attempted old record maps to a new canonical condition, its learned span
and staircase balance seed that condition, whose new counters start at zero.
If two attempted spoken reverse records map to the same condition, both
histories remain archived and the shared condition starts afresh at span two,
balance zero. Independent learning trajectories are not arbitrarily merged.
An unplayed record does not create a collision. Original-profile records also
remain archived, and historical totals count archived and new attempts once.

Save & exit retains an unfinished session. Ending it from the lab keeps
completed-round totals and adaptive spans, but does not count it as a completed
session. A presentation interrupted by pause or a hidden tab restarts. Paused
manual recall retains the response entered so far; spoken recall stops the
microphone and discards its uncommitted recording. Continue starts a fresh
capture automatically when resuming spoken recall. Hiding the page or locking
the lab also cancels the microphone and uncommitted speech.

Board changes have a separate observation interval: a quarter turn travels for
1.6 seconds and settles for 0.4 seconds. Each moving-circle leg travels for
0.95 seconds and settles for 0.22 seconds; swaps still use an empty place so
identical circles do not cross ambiguously. Setup resets do not animate, and
input remains unavailable until every change has settled. Reduced motion
removes travel while retaining the same observation time and final state.

Listening exercises keep a small order diagram visible beside the instructions.
Reverse order shows three shapes changing positions; numerical sorting uses
rising or falling bars. These symbols never display digits or the active answer.
Digits order, response method, and keypad visibility are selected before a
session and stay fixed for its listening rounds. Saved sessions retain their
chosen options. Each distinct variant keeps its own adaptive record; these are
practice conditions rather than separate ability measures. Hiding the keypad
during numerical sorting is an app extension, not a newly identified Cogmed
task.

Checking a correct sequence now records the result, advances, and presents the
next challenge in the same action. There is no intermediate Next or Start
screen. The last correct result remains in a compact status line. An incorrect
answer shows a mismatch without revealing the expected answer, and retains a
single Replay sequence action. Spoken feedback can also show the submitted
recognized digits. Replay does not change the first-attempt record. Solved
examples use independent practice questions, never the active failed question;
history does not expose the full stimulus or answer to an unredeemed miss.
Actual-round solutions become available only after first-try success or
redemption. The last successful submission completes the session directly.
This is a user-requested exception to the shared shell's explicit Next
checkpoint. Saved sessions from the earlier flow remain valid.
If sound is muted when a listening exercise is next, it waits for an explicit
Turn sound on & listen action rather than changing the saved sound preference.
Each new presentation brings its instructions and board into view before cues
begin, including on short phone screens.

The interface follows the [worksheet workflow's plain-language standard](https://github.com/jamesrp/math-circle-worksheets/blob/main/worksheet-workflow/blocks/spec.md)
and [do-not list](https://github.com/jamesrp/math-circle-worksheets/blob/main/worksheet-workflow/blocks/neg.md):
short concrete instructions, diagrams that serve the task, and no decorative
framing or manufactured praise. The lab removes its promotional hero, slogans,
stickers, icon cards, and repeated stage labels. Statistics sit behind Progress.
Opening examples and optional in-round examples remain because this standalone
app has no adult facilitator supplying the instructions. A separate reviewer
checks the revised screens before release, following the workflow's independent
review and revision principle. Content and recordings remain encrypted. Audio
and instruction updates retain the existing key, so encrypted device progress
remains readable.

To rebuild the encrypted pack, keep source JSON and generated digit MP3s outside
the repository, then run `node scripts/encrypt-working-memory.mjs --source
/private/content.json --audio-directory /private/digits --password-file
/private/password.txt`. The builder validates and replaces only its own pack
files. Rebuilding changes the salt and key, so existing device progress requires
migration or will be unreadable under the new pack. Never commit private inputs.

To update recordings while preserving progress, use
`node scripts/refresh-working-memory-audio.mjs --audio-directory /private/digits
--password-file /private/password.txt`. Its optional `--source /private/content.json`
also replaces validated authored content without rotating the key. The updater
authenticates the existing pack, verifies replacement audio against the narration
manifest, and replaces only the expected encrypted files.

Auditory digits use bundled recordings generated offline with the suite's
pinned Kokoro narrator and voice. The recordings are encrypted with the content;
playback uses the shared local audio player. Narration needs no model download,
speech-service call, or device-dependent browser text-to-speech. Optional spoken
answers use a separate, explicitly downloaded local recognizer described below.
Modality and slower presentation are identified as practice conditions; raw
spans and accuracy are not interchangeable measurements across conditions.
See the [spoken-digit provenance notice](../public/working-memory/NOTICE.md)
for the exact model revision, voice, generation settings, and licensing.
Digits are inferred together in continuous speech, then extracted at word-safe
boundaries with quiet padding and boundary fades. Higher-bitrate recordings
replace isolated full-stop utterances; plaintext source recordings stay outside
the repository.

## Spoken answers

The Digits game offers Keypad and Spoken responses for each order. Spoken mode
uses Vosk recognition in a local WebAssembly worker, with a bundled small
English model. **Download speech model** fetches the runtime and weights from
this site's own origin before microphone use; recordings and inference stay on
the device. There is no Web Speech API, cloud speech service, remote recognition
fallback, or audio upload. Microphone permission is requested for recording.

Once local speech is ready, recording starts automatically after the narrated
sequence and hold interval. The answer controls are **OK** and **Restart**.
OK stops capture, recognizes locally, and commits the recognized sequence in
one tap. Restart discards the uncommitted recording and immediately starts a
fresh capture for the same heard sequence; it does not replay the stimulus or
record an attempt. The keypad, live transcript, and recognized digits remain
hidden before commitment. An audio context can be primed from an earlier user
gesture, but the microphone is not opened during narration.

Only after a wrong committed spoken answer does feedback show the submitted
recognized digits, so the player can inspect a possible recognition mistake.
It does not show the expected answer.
That first-attempt miss remains recorded; the app cannot distinguish a valid
misrecognition from a memory error. The normal Replay sequence action remains
available as a learning retry. Empty, uncertain, or failed recognition stays
unscored and offers Restart. A correct OK submission advances directly to the
next challenge. Keypad remains available when the local speech setup or
microphone is unavailable. Speech is an additional practice condition, not an
input method documented for the audited Cogmed training tasks.

Authored content is password-encrypted. Saved practice progress is encrypted on
the device and does not require an account, server, or remote analytics. The
application code and generic interface remain public in this open-source
repository; browser-side encryption cannot conceal content from someone who
knows the password. Do not commit the password or decrypted content.

## Audit of the supplied research

The [shared Gemini Canvas blueprint](https://share.gemini.google/3tXbJu17f4mB)
was recovered and read. It supplies useful state-machine, pacing, task, and
local-persistence ideas, but its generated claims require independent checking.
The full extracted reference remains outside the public repository.

- Its eight-module specification and six-module closing prompt disagree.
  This implementation chooses eight original visual exercises and, following
  the user's explicit audio request, locally narrated digit exercises. Their
  three original cards are now one Digits game with distinct options.
  Spoken letter-grid and projected-room tasks are not replicated. These are
  selected mechanics and adaptations rather than the report's exact inventory.
- Its consecutive-success staircase conflicts with its fractional-level code.
  Adding 0.5 per success and subtracting 0.75 per miss balances expected drift
  near 60% success. A conventional two-consecutive-success staircase approaches
  roughly 70.7% under ideal psychophysical assumptions, rather than the claimed
  75–80%. Neither figure is a measured target for this app.
  [Methods reference](https://pmc.ncbi.nlm.nih.gov/articles/PMC4104800/)
- Its proposed conversion of span into clinical-looking Start/Max/Training
  indices is unsupported. The lab reports direct practice measurements instead
  of reproducing those indices, age norms, IQ scores, or diagnostic scores.
- Pattern constraints and rotations change a task's demands; they do not prove
  generalized cognitive improvement or eliminate all memory strategies.
  The blueprint's price claims were not verified or adopted.

## Video-reference due diligence

The blueprint cites YouTube videos, but its titles and frame-specific claims
are not reliable provenance by themselves. Reference checks on 18 October 2026
established the following:

| Blueprint reference | Corroborated metadata | Verification limit |
| --- | --- | --- |
| [Modern UI demo](https://www.youtube.com/watch?v=V5spMXesmZ8) | Sonic Learning, **COGMED Demo video 2021**, 5 March 2021 | Search-indexed title, channel, and date; direct footage and transcript were unavailable. |
| [Student dashboard walkthrough](https://www.youtube.com/watch?v=gJ_b7Gyn6iw) | Sonic Learning, **NEW COGMED Demo video**, 30 October 2020 | The indexed title does not identify a dedicated student-dashboard walkthrough; direct footage was unavailable. |
| [Classic robot interface](https://www.youtube.com/watch?v=JHqsyXgoJis) | Current title, channel, and playable status could not be verified. | The claimed robot-interface demonstration remains unverified. |

Direct YouTube playback and metadata requests were blocked in the research
environment. These checks do not constitute watching those three videos or
measuring their stimulus timing.

For direct visual corroboration, Sonic Learning's
[current provider page](https://soniclearning.co.nz/our-programs/cogmed-working-memory-training/)
links its own [7:50 Vimeo demonstration](https://vimeo.com/781665559). Its
auto-generated captions were read and sampled rendered footage and provider
stills were inspected. The demonstration includes backward digit entry around
1:55, describes a hidden-keypad variant around 3:43, demonstrates spatial grid
recall around 4:02 and a moving cube around 5:25, and shows a building reward
around 6:20. Captions are machine-generated and may contain transcription
errors. This Vimeo upload was not established to be identical to either
YouTube upload.

The digit demonstration includes a repeated item around 2:40, so the
blueprint's rule prohibiting repeats within two positions cannot be presented
as exact Cogmed behavior. No millisecond timing, complete task inventory, or
proprietary staircase was inferred from this sampled demonstration. The lab's
adaptations and session rules remain explicit design choices.

As a separate historical source,
[Cogmed QM Demonstration](https://vimeo.com/6367182), credited to the Cogmed
account, was also inspected at settled frames around 0:35, 1:25, 2:15, and
2:55. These show a circular-target task, projected three-dimensional grid,
hidden-digit interface, and rotating circular targets in an older interface.
This corroborates those task families, without establishing that the report's
third YouTube link contains the same footage or that current versions retain
the same layouts.

## Independent sources and evidence limits

The [publication audit](WORKING_MEMORY_EVIDENCE.md) records each primary source,
research edition, concrete task claim, implementation action, and missing
parameter. It also maps every exercise to its nearest published counterpart and
identifies the original extensions. It distinguishes research-backed mechanics
from app-chosen starting loads, timings, and adaptive constants. These changes
ground the design in published methods; they do not establish equivalent Cogmed
difficulty.

- [Cogmed's current training overview](https://www.cogmed.com/training) describes
  adaptive exercises, coaching, and a baseline five-week program with flexible
  session lengths. These commercial protocols do not validate the lab's shorter
  practice sessions.
- [Henshaw and Ferguson's trial protocol](https://pmc.ncbi.nlm.nih.gov/articles/PMC4235173/)
  describes sequence-based verbal and visuospatial exercises and adaptive
  item counts. [Gathercole et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6591133/)
  provide detailed task descriptions and discuss why transfer depends on shared
  task structure. These inform mechanics rather than a claim of exact parity.
- A [2021 child meta-analysis](https://pubmed.ncbi.nlm.nih.gov/34085876/) found
  working-memory improvements without generalization to its attention,
  executive-function, or academic outcomes. A
  [2025 adult meta-analysis](https://pubmed.ncbi.nlm.nih.gov/40581145/) found
  immediate working-memory benefits with limited evidence of sustained gains.
- Evidence beyond the practiced tasks is mixed: a
  [2025 school trial](https://www.journals.uchicago.edu/doi/full/10.1086/732884)
  reported positive cognitive and educational spillovers, while a
  [large earlier trial](https://pubmed.ncbi.nlm.nih.gov/26954779/) found no
  reading, spelling, or mathematics improvement at 12 or 24 months.

This independent app has not been clinically validated. Its scores describe
performance in its own exercises; they are not evidence of improved IQ,
attention, school attainment, or treatment of a medical condition.
