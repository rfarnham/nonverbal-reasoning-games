# Picture Memory

[Play Picture Memory](https://rfarnham.github.io/nonverbal-reasoning-games/games/picture-memory/)

Picture Memory practices visual recognition: study a small group of objects,
hide the group, and select every object that appeared. The player decides when
to hide the pictures and when to check the selection. Picture position and
selection order do not affect correctness.

## Source and artwork

The format is adapted from the user-supplied picture-memory practice PDF dated
27 September 2026. The source document is a private local reference; it is not
bundled into the site. The study-and-recall action is retained while the game
supplies new objects, an explicit check action, feedback, and repeatable practice.

All 48 picture variants are original code-native SVG artwork in
[`picture.tsx`](../app/games/picture-memory/picture.tsx). Their 24 everyday object
families and descriptions are recorded in
[`picture-data.ts`](../app/games/picture-memory/picture-data.ts). No source-PDF
images or third-party image assets are required. The pictures are included with
the repository under its existing MIT license and make no runtime network calls.

Each family has two visibly different forms, such as an apple with or without a
bite, a key with one or two teeth, and a bicycle with or without a basket.
Advanced distinctions change an object feature; they do not depend on a tiny
mark, color change, or texture phase.

## Difficulty and response model

| Level | Study group | Answer pictures | Scaffold |
| --- | --- | --- | --- |
| Starter | 1 object | 4 distinct object families | Number to find is shown. |
| Junior | 2 objects | 6 distinct object families | Number to find is shown. |
| Expert | 3 objects | 8 pictures, including the alternate form of every studied object | Number to find is shown. |
| Wizard | 3 objects | The same complexity as Expert | Number to find is withheld during recall. |

Memory is the intended primary skill, as requested by the user. Selecting
multiple remembered objects is a deliberate response-model exception to the
suite's usual four-choice grid: Junior has two correct selections and Expert
and Wizard have three. Every round still has exactly one verifiable correct
selection set. Buttons support touch, native keyboard activation, and the
visible number shortcuts; **Check answer** commits the complete selection.

Starter retains the four-choice Campaign schedule: each answer position occurs
three times per level, without adjacent repeats or a repeated four-position
cycle. Later levels have no single correct position; their authored banks
balance target exposure across all available positions instead. The early-level
position-pattern requirements for geometric grid alternatives do not apply to
individual pictured objects. Starter and Junior use distinct object families;
close structural alternatives begin at Expert.

There is no study countdown or recall deadline. Journey's existing two-minute
Turbo session remains available through the shared wrapper; its timer follows
the same suite rules as the other canonical games.

## Feedback and sessions

An incorrect check reports how many selected pictures were absent and how many
studied pictures are still missing, marks extra selections, and shows the study
group again before the player retries. A correct check marks the complete
selection and waits for an explicit next action. Retries and redemption retain
the original first-attempt result.

The game provides the standard 48-question Campaign, four difficulty levels,
historical problem review, checkpoints, mistake redemption, and adaptive Infinite
mode. A separate 36-question authored bank supports Journey's Junior II,
Expert II, and Wizard II boards without expanding standalone Campaign. Journey
uses the game's canonical engine, renderer, feedback, and shared progression
hook. Multi-selection answer tokens preserve the whole selection through a
reload; the study/recall phase is saved locally for the active Journey question.

The pure engine checks unique picture identities, complete target availability,
the difficulty-specific vocabulary, structural alternatives, and fingerprints.
Tests cover all authored banks, at least 400 seeded generated rounds per level,
bounded generation failure, every possible selection subset, answer-position
exposure, token restoration, and Journey retry persistence.
