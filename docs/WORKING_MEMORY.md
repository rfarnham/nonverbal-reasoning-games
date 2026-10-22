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
presentation and a retention interval are intrinsic to these memory tasks.
Answers have no scored time limit. Spoken capture has bounded input watchdogs;
silence or an unfinished recording produces an unscored input failure, not a
wrong answer. The lab has its own adaptive sessions and progress. It does not
join the generated game catalog or alter Journey progress or XP.

Mixed sessions contain 24 or 48 trials and alternate the selected Digits
variant with Light Path, Turning Grid, and Moving Lights. Half the rounds are
listening rounds; the three visual exercises share the other half. Visual-only
sessions balance all eight visual exercises. Audio-only sessions repeat the
selected Digits variant, rather than treating its old aliases as different
games. Focused practice contains eight trials of one game or Digits variant.
New sessions use the
`research-v1` stimulus profile: Light Path and Pattern Hold start at three
items; other exercises start at two. Loads range from two to nine, except
Hidden Homes, which displays and queries two to six distinct shape–location
bindings. Hidden Homes allows at least five seconds to study those pairs.
The separate `comfort-v1` controller keeps practice at a comfortable span and
occasionally tries one item more. Two successful comfortable-span answers allow
an initial harder probe. A failed probe returns the next question for that
condition to the comfortable span, with eight successful comfortable-span
answers before another probe, then sixteen after repeated probe failures.
Two successful probes, separated by two comfortable-span successes, establish
the harder span. Two consecutive first-attempt misses at the comfortable span
lower it by one, within the exercise's bounds. These are app design choices for
comfortable practice, not Cogmed's proprietary controller, a fixed accuracy
target, or empirically matched difficulty.
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

An existing active question keeps its exact round, task mix, settings, and
first-attempt history. After that question resolves, the session switches to
comfortable-span adaptation; its recorded upgrade boundary preserves strict
replay of the original staircase before the switch. If that question was missed
on the first attempt, the next question for the condition starts lower, where
the minimum span allows it. Missing `digitVariant` fields still keep the saved
round identities and generator behavior unchanged. Probe progress and failed
target backoff persist across reloads, sessions, and comfortable-span changes.

New sessions keep independent adaptive records for each distinct Digits
variant and standard/slower pace. Visual records depend on pace, independent
of the listening options. Digits settings sit inside its own section; pace
applies to all games. Only the first answer to each question supplies accuracy,
adaptive evidence, and practice credit. One replay is available after a miss;
historical review supplies no additional scored evidence.

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
session. Practice buttons remain available while a session is saved. Choosing
the same focused game and settings resumes that run, including its remaining
answer opportunity. Choosing another game or practice condition starts eight
new questions and ends the old unfinished run; its recorded practice, XP,
comfortable span, and harder-trial backoff are retained. Switching needs no
separate End session action or confirmation.

Preferences can be changed on the game shelf while a run is saved. The retained
run keeps its original presentation pace, digit variant, question, and answer
history; Continue session uses those captured settings. New practice uses the
selected preferences and their independent difficulty bank. Games and saved
runs can also be opened before audio or the speech model is ready: setup is
offered inside the game, and listening and scoring stay blocked until the
required audio/input is available.

A presentation interrupted by pause or a hidden tab restarts. Paused
manual recall retains the response entered so far; spoken recall stops the
microphone and discards its recording and any pending recognition result.
Continue starts a fresh capture automatically when resuming spoken recall.
Hiding the page or locking the lab also cancels capture and pending speech
results.

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

Each question accepts at most **two answers that can be graded**. A correct
first answer records the result and presents the next challenge in the same
action; a recognized spoken answer is checked automatically. A first miss
shows a mismatch without revealing the expected answer and offers one
**Replay sequence** action: "One more try, then we'll move on." The second
answer moves straight to the next challenge, whether correct or incorrect.
There is no intermediate Next or Start screen. A correct second answer redeems
the miss without rewriting first-attempt accuracy or changing adaptation;
an incorrect second answer remains unredeemed. The second result is saved, so
Save & exit, pause, Lock, or reload cannot restore another replay. Recognition
failures are unscored and do not consume either answer.

Spoken mismatch feedback can show the submitted recognized digits. Solved
examples use independent practice questions, never the active failed question;
history does not expose the full stimulus or answer to an unredeemed miss.
Actual-round solutions become available only after first-try success or
redemption. Resolving the last question, including a second miss, completes
the session directly.
This is a user-requested exception to the shared shell's explicit Next
checkpoint. Saved sessions from the earlier flow remain valid.
If sound is muted when a listening exercise is next, it waits for an explicit
Turn sound on & listen action rather than changing the saved sound preference.
Each new presentation brings its instructions and board into view before cues
begin, including on short phone screens.

## Memory Trail and rewards

Memory Trail is the owner-requested child-friendly layer over the lab's existing
practice. It reuses Journey's twelve bundled animal avatars, with Hedgehog as
the default and an optional **Choose your buddy** picker. The assets and their
MIT attribution are documented in [the avatar notice](../public/avatars/README.md).
**Start adventure** begins eight focused challenges and their first
presentation in one action. **Continue adventure** resumes the exact saved
session. The longer mixed sessions, individual games, settings, and optional
progress reports remain available.

The trail moves through Acorn Grove, Pebble Brook, Fern Hollow, Moonlit Meadow,
and Starry Summit. Each habitat has five stops. Every 80 XP, representing eight
recorded first attempts, marks another stop; 25 stops complete an expedition.
Further expeditions retain lifetime XP. Viewing another habitat never changes
the next exercise, its load, or its settings, and the trail does not lock games.

Each recorded first attempt earns **10 XP**, whether correct or incorrect.
Accuracy, span, presentation pace, and answering speed do not change that
award. Two answers to one question still earn only 10 XP. Replay, redemption,
historical review, silence, and uncertain or failed speech recognition earn no
extra XP. The reward total derives from
`taskTotals(saved)`, which already counts canonical, archived, and original
first-attempt records once. It does not add the retained session or its task
snapshot again. Existing legitimate practice therefore receives credit without
a claim or a reset; reloads and repeated completion screens cannot duplicate it.
Session logs are not the source of lifetime XP.

Six collectible trophies use the same durable practice totals:

| Trophy | Requirement |
| --- | --- |
| First footsteps | 8 first attempts |
| Trail explorer | 40 first attempts |
| Expedition explorer | 200 first attempts |
| Bright eyes | 8 visual first attempts |
| Listening ears | 8 listening first attempts |
| Curious explorer | Practice all nine game families; auditory compatibility aliases count as one Digits game |

Completing a session shows a celebrating animal, that session's practice XP,
and any newly reached trophy or trail milestone. XP is already earned; the
single **Back to trail** action returns home without a claim screen. Celebration
motion is brief and respects reduced motion. Animals, reward animations, and
reward overlays do not appear during presentation, the hold interval, or recall,
so the automatic answer-to-next-challenge flow stays uninterrupted.

Companion choice is an optional `buddy` preference in encrypted Saved3 progress;
older saves use the default animal without losing their records. Trail position
and trophies are derived from those encrypted practice records. Memory Trail
does not read or write Journey's profile, XP ledger, or mistake history, and it
adds no account, cloud storage, or third-party runtime service. Its rewards
celebrate practice rather than ability and do not change the adaptive controller
or introduce Journey's accuracy threshold. Resetting lab progress also resets
the lab's derived rewards and companion preference.

## Interface and audio assets

The interface follows the [worksheet workflow's plain-language standard](https://github.com/jamesrp/math-circle-worksheets/blob/main/worksheet-workflow/blocks/spec.md)
and [do-not list](https://github.com/jamesrp/math-circle-worksheets/blob/main/worksheet-workflow/blocks/neg.md):
short concrete instructions, diagrams that serve the task, and no manufactured
praise or repeated stage labels. The owner's later request explicitly adds a
playful trail, animals, trophies, and celebration screens to the home and session
checkpoints. This does not make decorative framing part of the memory stimuli:
active challenges stay sparse, and statistics remain optional. Opening examples
and optional in-round examples remain because this standalone app has no adult
facilitator supplying the instructions. A separate reviewer checks revised
screens before release, following the workflow's independent review and revision
principle. Content and recordings remain encrypted. Audio and instruction
updates retain the existing key, so encrypted device progress remains readable.

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
sequence and its 800 ms hold interval. The player says an answer, then pauses;
capture stops after about two seconds of trailing quiet and recognition is
checked automatically. There are no OK or Restart controls. The keypad, live
transcript, and recognized digits remain hidden before grading. An audio
context can be primed from an earlier user gesture, but the microphone is not
opened during narration.

Endpoint detection uses local microphone activity and answer-independent speech
hypotheses. Sound bursts shorter than 160 ms do not by themselves establish
speech, and repeated unchanged partial transcripts do not prolong capture.
Neither the expected digits nor the expected answer length is supplied to the
recognizer or used to decide when to stop. Confident, valid digit recognition
is a submitted answer even when its length differs from the challenge.

No detected speech within ten seconds, a recording that reaches 45 seconds,
unknown or uncertain speech, and capture or recognition errors produce a
separate input failure. Feedback says **Input not recognized** or **Speech input
unavailable**, explains that no attempt was scored, and offers **Retry**. Retry
starts a fresh capture for the same heard sequence without replaying it.
These failures do not use either of the question's two answer opportunities or
change the first-attempt score or adaptive state. The
recording bounds prevent a microphone from remaining open indefinitely; they
are not a punitive game timer and do not turn silence into an incorrect answer.

Only after a wrong recognized spoken answer does **Answer did not match**
feedback show the submitted digits, so the player can inspect a possible
recognition mistake. It does not show the expected answer. That first-attempt
miss remains recorded: the app
cannot reliably distinguish confidently misheard digits from incorrectly
recalled digits. After a first miss, Replay sequence gives one learning retry.
A correct first answer or either result on the second answer advances directly
to the next challenge. A second miss never exposes the expected answer.
Keypad remains available when the local speech setup or microphone
is unavailable. Speech is an additional practice condition, not an input method
documented for the audited Cogmed training tasks. Existing saved sessions,
condition records, and first-attempt histories retain their meaning.

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
