# Picture Memory

[Play Picture Memory](https://rfarnham.github.io/nonverbal-reasoning-games/games/picture-memory/)

Picture Memory practices visual recognition: study a small group of objects,
then select every object that appeared. Each group hides automatically after
four seconds at Starter and Junior, or twelve seconds at Expert and Wizard.
Completing a selection checks it automatically, and a correct answer advances
after brief feedback. Picture position and selection order do not affect
correctness. Advanced rounds require the same object details and orientation
that appeared during study.

## Source and artwork

The format is adapted from the user-supplied picture-memory practice PDF dated
27 September 2026. The source document is a private local reference; it is not
bundled into the site. The study-and-recall action is retained while the game
supplies new objects, feedback, and repeatable practice.

The 48 base picture designs are original code-native SVG artwork in
[`picture.tsx`](../app/games/picture-memory/picture.tsx). Their 24 everyday object
families and descriptions are recorded in
[`picture-data.ts`](../app/games/picture-memory/picture-data.ts). No source-PDF
images or third-party image assets are required. The pictures are included with
the repository under its existing MIT license and make no runtime network calls.

Each family has two visibly different forms, such as an apple with or without a
bite, a key with one or two teeth, and a bicycle with or without a basket.
Advanced rounds add rotated and reflected appearances of asymmetric objects.
Object details and orientation carry the challenge; it does not depend on a
tiny mark, color change, or texture phase. Pose transforms use a fixed picture
box, and pose-safe objects must remain visibly distinct under every legal
rotation and reflection.

## Difficulty and response model

| Level | Study group | Visible study time | Answer pictures | Scaffold |
| --- | --- | --- | --- | --- |
| Starter | 1 object | 4 seconds | 4 distinct object families | Number to find is shown. |
| Junior | 2 objects | 4 seconds | 6 distinct object families | Number to find is shown. |
| Expert | 3 objects from 3 families | 12 seconds | 3 exact targets, 3 structural alternatives, 1 rotation trap, and 1 reflection trap | Number to find is shown. |
| Wizard | 3 objects from 2 families | 12 seconds | 3 exact targets, 1 structural alternative, 2 rotation traps, and 2 reflection traps | Number to find is withheld during recall. |

Memory is the intended primary skill, as requested by the user. Selecting
multiple remembered objects is a deliberate response-model exception to the
suite's usual four-choice grid: Junior has two correct selections and Expert
and Wizard have three. Every round still has exactly one verifiable correct
selection set. Buttons support touch, native keyboard activation, and the
visible number shortcuts. Selecting the required number of pictures commits
the group automatically; before that point, a selected picture can be deselected.
Wizard withholds the count cue while retaining the three-picture submission
threshold.

The user explicitly requested level-specific study exposure, automatic checking,
and automatic progression. These are game-specific product exceptions to the
suite's untimed default, separate answer-commit control, and per-round **Next**
action. Starting a round begins its study exposure without an extra button.
Level checkpoints, results, and redemption entry remain deliberate actions.

Starter retains the four-choice Campaign schedule: each answer position occurs
three times per level, without adjacent repeats or a repeated four-position
cycle. Later levels have no single correct position; their authored banks
balance target exposure across all available positions instead. The early-level
position-pattern requirements for geometric grid alternatives do not apply to
individual pictured objects. Starter and Junior use distinct object families;
close structural alternatives begin at Expert.

A rotation trap preserves the object's structural form but changes its turn.
A reflection trap preserves the same structural form while reversing its
handedness. Structural alternatives change a visible object feature. The
complete remembered appearance must match; recognizing the object family alone
does not solve an advanced round. Starter and Junior retain their original
unposed, distinct-family vocabulary.

Wizard also removes Expert's one-object-per-family cue. Two studied pictures
share one object family, but differ in both structural form and pose; the third
belongs to another family. Its answer board has four alternatives from each of
those two families. This asks the player to bind each object's details to its
orientation while retaining Expert's three-picture load and twelve-second study
time.

Study exposure counts only while the page is visible and pauses when the
document is hidden. The full exposure duration is preserved with reduced motion.
Recall has no deadline. Journey's existing two-minute Turbo session remains
available through the shared wrapper; its timer follows the same suite rules
as the other canonical games.

## Feedback and sessions

An incorrect selection shows only **× Try again** for about 900 ms. It does not
identify correct or incorrect pictures, show the target group, or disclose a
difference count during feedback. The same puzzle then begins its full study
exposure again before another recall attempt. A correct selection stays marked
for about 900 ms, then advances automatically. Reduced motion retains these
readable feedback durations. Reloading a solved Journey question restores
success feedback before advancing. Retries and redemption retain the original
first-attempt result.

The game provides the standard 48-question Campaign, four difficulty levels,
historical problem review, checkpoints, mistake redemption, and adaptive Infinite
mode. A separate 36-question authored bank supports Journey's Junior II,
Expert II, and Wizard II boards without expanding standalone Campaign. Journey
uses the game's canonical engine, renderer, feedback, and shared progression
hook. Multi-selection answer tokens preserve the whole selection through a
reload; the study/recall phase is saved locally for the active Journey question.
An unfinished study also retains its remaining visible exposure time.

The pure engine checks unique picture identities, complete target availability,
the difficulty-specific vocabulary, structural and orientation alternatives,
and fingerprints.
Tests cover all authored banks, at least 400 seeded generated rounds per level,
bounded generation failure, every possible selection subset, answer-position
exposure, token restoration, and Journey retry persistence.
