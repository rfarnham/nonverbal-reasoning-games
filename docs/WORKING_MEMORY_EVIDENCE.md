# Memory Lab: publication audit and difficulty design

Last reviewed: 18 October 2026.

Memory Lab uses published Cogmed task descriptions as references for mechanics.
It is an independent implementation. Matching a description is not evidence of
equivalent difficulty: the research editions, stimuli, timing, response supports,
practice schedules, and adaptive controller can differ. No comparison with
players completing both products has yet been conducted.

## Primary sources and what they establish

| Source and edition | Published information used | Implementation consequence | Information the source does not establish |
| --- | --- | --- | --- |
| [Klingberg, Forssberg & Westerberg (2002), *Training of Working Memory in Children With ADHD*](https://doi.org/10.1076/jcen.24.6.781.8395), early research software. [Author-hosted full paper](https://www.klingberglab.se/pub/TrainingWMChildrenADHD.pdf), pp. 782–783. | Training used a near-capacity, trial-by-trial adaptive staircase. For all working-memory tasks, difficulty changed the **number of stimuli to remember**. Tasks included sequential positions on a 4×4 grid, reverse spoken digits entered on a displayed keypad, and letter span. | Adapt the actual amount to remember. In particular, lowering Hidden Homes must remove shape–location bindings, rather than only asking fewer questions about an unchanged six-shape display. | Exact staircase updates, universal starting spans, per-item presentation durations, and the current commercial product's implementation. This early program is not a complete current Cogmed inventory. |
| [Dunning & Holmes (2014), *Does working memory training promote the use of strategies on untrained working memory tasks?*](https://pmc.ncbi.nlm.nih.gov/articles/PMC4110412/), **RM** training, Methods → Working memory training. | Trial-by-trial adaptation to current span; detailed descriptions of nine tasks. Visual Data Link uses a 4×4 grid. Rotating Data Link adds a **clockwise 90° turn before recall**. Both Input Module variants require manual reverse digit recall; the lid hides the keypad during presentation, then shows it for answering. Random Letters pairs spoken letters with illuminated locations. | Use clockwise quarter-turns in new research-informed sessions. Keep keypad and hidden-keypad mechanics distinguishable. Treat simultaneous shape binding and spoken responses as adaptations. | Numeric controller constants, per-task entry levels, task timing, or equal difficulty between this app and RM. The fixed span-two control condition is not a recommended adaptive starting level. |
| [Henshaw & Ferguson (2013), trial protocol](https://pmc.ncbi.nlm.nih.gov/articles/PMC4235173/), **research edition of Cogmed RM**, Working memory training intervention. | Eleven sequence-based tasks; difficulty is the number of to-be-remembered items. Adaptive training aims for approximately **60% of trials correct on average per day**. The nonadaptive control remains at three items. | Use remembered item count as the primary adaptive variable. The 60% daily target can inform an independently specified practice controller. | A particular up/down rule, step size, integer rounding policy, timing table, or adaptive initial span. A control group's three items are not a normative starting load. |
| [Henshaw, Heinrich, Tittle & Ferguson (2022), randomized trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC9007089/), **research edition of Cogmed RM**, Working Memory Training Intervention → Table 2 and Adaptive Training. | Repeats the daily 60% target and item-count adaptation. Task descriptions distinguish serial storage, reverse recall, numerical resequencing, and association. Input Module with Lid reveals the numbered buttons at recall. Backward Digit Span with a spoken response is assessed separately from the manually answered training exercises. | Maintain separate practice conditions for keypad and speech. Speech is a new response condition, not a faithful restoration of a documented Cogmed input method. | That speech is universally harder, that a particular browser recognizer is suitable, or that any proposed controller replicates Cogmed. |
| [Gathercole, Dunning, Holmes & Norris (2019), *Working memory training involves learning new skills*](https://pmc.ncbi.nlm.nih.gov/articles/PMC6591133/), Appendix A, **Cogmed RM tasks**. | Lists stimulus domain, presentation, response, and session schedule. Distinguishes forward grid recall, rotating grid/dial, slowly moving Asteroids, reverse digits, letter–location associations, and spatial numerical sorting. Responses are manual. | Compare tasks by their complete mechanics and response supports, rather than their names. Preserve slower, legible target movement. Label the app's extra mechanics as extensions. | A millisecond movement speed, an optimal difficulty for an individual, or identical challenge across tasks with the same span. |

The 2005 randomized trial by [Klingberg et al.](https://pubmed.ncbi.nlm.nih.gov/15689731/)
was also checked at the abstract/bibliographic level. It does not supply the
missing implementation parameters there, so no starting spans, timings, or
controller constants are attributed to that paper. The author-hosted PDF named
`TrainingWMChildrenADHD.pdf` is the **2002** paper, as its title and journal header
show; its filename must not be used to identify it as the 2005 trial.

## Correspondence of the nine game families

These are comparisons with the research editions above, not a statement about
every exercise in today's commercial product. The interface has eight visual
games and one Digits game. Its old three auditory cards are options within
Digits, not three independent game families.

| Memory Lab exercise | Closest published task | Correspondence and differences |
| --- | --- | --- |
| Light Path | Visual Data Link | Close task structure: ordered recall of illuminated locations on a 4×4 grid. Stimulus timing, sequence constraints, feedback, and adaptation remain independently implemented. |
| Reverse Path | No exact counterpart verified in the audited task lists | Extension: spatial sequence recalled backwards. |
| Turning Grid | Rotating Data Link | Close family. New sessions use the documented clockwise quarter-turn before recall. Animation and timing are app choices. Earlier saved sessions can retain counterclockwise turns. |
| Moving Lights | Asteroids / Rotating Dots | Adaptation: remembered marker identities are followed through discrete swaps. The publications describe slowly moving asteroids or a continuously rotating dial, not this swap system. |
| Shape Sequence | Decoder shares serial identity recall | Extension: visually presented shapes with a six-shape response palette. Decoder instead presents spoken letters and supplies three visual alternatives for each response. |
| Hidden Homes | Random Letters / Stabilizer association family | Substantial adaptation: simultaneous shape–location pairs, then shape prompts. Published descriptions use sequential letter–location association. Matching the binding count does not make the tasks identical. |
| Pattern Hold | No exact counterpart verified in the audited task lists | Extension: simultaneous unordered pattern recall rather than a serial illuminated sequence. |
| Split Focus | No exact counterpart verified in the audited task lists | Extension: spatial serial recall with alternating sides. |
| Digits | Input Module with/without Lid; Numbered Grid / Sorter shares numerical ordering | Reverse recall using a keypad, with labels visible or hidden during presentation, is close to the two Input Module task structures. Sorting spoken digits is an adaptation: the published sorting task requires clicking remembered **spatial locations** in ascending numeric order. Descending order, hidden-keypad sorting, and spoken responses are app extensions. |

The current set omits other published tasks, including the projected Data Room
and Space Cube, and it adds original exercises. Nine game families therefore
does not mean nine exact Cogmed counterparts.

Digits combines three option axes: order (reverse / ascending / descending),
response (keypad / spoken), and keypad visibility during presentation
(visible / hidden). Visibility applies only to keypad input. Spoken input
normalizes it to none, giving `3 × 2 + 3 = 9` distinct variants at each pace,
rather than twelve variants with duplicated spoken mechanics. Forward digit
recall is not included. All options affect listening rounds only; the
presentation-pace setting applies to visual and listening games.

The eleven original task/content identifiers remain compatible with saved
rounds and the encrypted pack. The historical auditory aliases project as
follows:

| Historical card / identifier | Digits options |
| --- | --- |
| Reverse Digits / `reverse-digits` | Reverse order; keypad visible during presentation, or spoken response |
| Hidden Keypad / `hidden-digits` | Reverse order; keypad hidden during presentation, or the same spoken reverse variant |
| Number Assembly / `sort-digits` | Ascending or descending order; originally visible keypad or spoken response |

Hidden-keypad ascending and descending sorting are additional combinations of
app options. They are not attributed to a canonical Cogmed task. New mixed
sessions alternate the chosen Digits variant with the three core visual tasks,
retaining a 50% listening share. Audio-only sessions repeat that variant; legacy
aliases no longer multiply its selection weight. Existing sessions without a
`digitVariant` retain their exact original task plan and round identities.

Two-digit sorting has a finite set of nonidentity presentations: choosing two
distinct digits from 1–9 gives `9 × 8 / 2 = 36` pairs, with exactly one presented
order per pair requiring a change for a given sorting direction. Thus a
48-round listening-only session cannot keep every presentation unique if its
adaptive load stays at two. Canonical Digits generation deterministically
enumerates the entire 36-item pool before starting a new cycle; each cycle has
no repeated presentation. It does not force a higher load to escape the pool.
This is an explicit, necessary finite-pool Lab exception to the repository's
no-repeat rule, not a claim about Cogmed's sequencing or calibration. Semantic
fingerprints stay stable across repeats, while deterministic occurrence IDs
remain unique so first-attempt and redemption histories cannot collide. The
exception does not change saved sessions without `digitVariant`.

## New difficulty profile

The `research-v1` profile applies to new sessions. Previous saved sessions keep
their original generator and staircase so that an update cannot silently change
the answer to a saved round or rewrite its first-attempt history.

The following values are **app design choices**, informed by the methods above
and by the observed entry difficulty. They are not published Cogmed norms or a
measurement of equivalent challenge.

| Exercise | Initial load | Allowed load | Quantity adapted |
| --- | ---: | ---: | --- |
| Light Path | 3 | 2–9 | Sequential locations |
| Reverse Path | 2 | 2–9 | Sequential locations to reverse |
| Turning Grid | 2 | 2–9 | Sequential locations before the turn |
| Moving Lights | 2 | 2–9 | Cued marker identities, including repeats; eight markers and three swaps remain fixed |
| Shape Sequence | 2 | 2–9 | Sequential shape cues; six available shapes remain fixed |
| Hidden Homes | 2 | 2–6 | **Distinct shape–location bindings displayed and subsequently queried once each** |
| Pattern Hold | 3 | 2–9 | Simultaneously illuminated cells |
| Split Focus | 2 | 2–9 | Sequential locations |
| Digits, each distinct variant | 2 | 2–9 | Spoken digits to reverse or sort |

Hidden Homes study time is `max(5, number of bindings)` seconds, multiplied by
1.5 with Slower presentation. Its two-binding entry round therefore shows two
pairs for five seconds, rather than six pairs for 3.2 seconds. These durations
are a legibility and entry-load choice; none of the audited Cogmed methods
specifies this simultaneous-shape display or these timings. Other presentation
and movement timings are likewise app parameters, not measured Cogmed timing.

The new independent controller accumulates **+2 for a first-attempt success and
−3 for a first-attempt miss**. At +5 it raises load by one and subtracts five
from the balance; at −5 it lowers load by one and adds five. Load stays within
the exercise's bounds. Retries, historical review, and technical recognition
failures do not add scored evidence. A correct retry still preserves the
original first-attempt miss.

This weighting is inspired by the published daily target, not copied from
Cogmed. Its expected evidence increment at success probability `p` is
`2p − 3(1 − p) = 5p − 3`, which is zero at `p = 0.60`. That algebra does **not**
guarantee 60% observed accuracy: integer loads, bounds, learning, small sessions,
and differing task conditions all matter. The threshold of five and balance
carry are independently selected implementation details. The old
two-consecutive-successes / one-miss staircase remains only for old sessions;
it must not be described as a 60% controller.

## Response conditions and remaining calibration

Keypad and spoken responses have different external supports. A visible keypad
supplies a spatial map; entered digits also provide a record of a partial
answer. Spoken mode removes those supports during recall and introduces speech
production and recognition. The user's experience motivates offering both, but
the publications do not establish that speech is harder for every player or
more beneficial. Spoken responses use local recognition. Capture starts
automatically after the sequence and an 800 ms hold interval, stops after about
two seconds of trailing quiet, and submits without OK or Restart controls.
Local audio activity and changed speech hypotheses determine the endpoint;
short sound bursts alone do not open it, and repeated unchanged hypotheses do
not keep it open. Neither expected digits nor expected answer length is given
to the recognizer. A confident valid digit sequence is graded, including one
with a different length from the expected answer. Neither a live transcript nor
recognized digits are shown before grading.

Silence, unknown or uncertain speech, and technical failures are input failures,
distinct from recognized incorrect answers. **Input not recognized** or **Speech
input unavailable** feedback offers **Retry** to record another answer to the
same heard sequence without replaying it. No attempt or adaptive evidence is
recorded. The ten-second no-speech and 45-second maximum-recording bounds stop
capture safely; they do not impose a scored response deadline or make silence
a memory error. These endpoint and confidence rules are app design choices,
not published Cogmed parameters or validated diagnostic criteria.

After a wrong recognized spoken answer, **Answer did not match** feedback shows
the submitted digits to help inspect a possible misrecognition. The
first-attempt miss still stands.
This display cannot reliably establish whether confidently recognized digits
were misheard or incorrectly recalled. The ordinary Replay sequence learning
retry remains available and cannot rewrite the original result. Wrong feedback
in every game indicates a mismatch without displaying the expected answer.
Solved examples use independent practice questions, and historical review does
not reveal the full stimulus or answer to an unredeemed miss: for several
mechanics the stimulus itself exposes the solution. Actual-round solutions
are available only after first-try success or redemption. Pausing,
hiding, or locking cancels capture and discards both the recording and pending
recognition results; Continue starts a fresh capture automatically if it
resumes spoken recall. Priming an audio
context from a user gesture does not open the microphone during narration.

Adaptive records are separated by standard/slower presentation and by each
distinct Digits variant. Spoken reverse recall has one shared record, because
there is no keypad whose visibility could distinguish two versions. Visual
exercises share their record across all listening-option preferences. These are
practice conditions, not interchangeable ability measures. Changing input
method must not make an existing score appear to be an improvement under
otherwise identical conditions.

Original-profile records and earlier research-condition records remain
archived with their first-attempt counts. For a canonical condition with exactly
one attempted predecessor, the learned span and staircase balance carry into
the new record, but its counters start at zero so historical totals are not
duplicated. If both former spoken reverse aliases were attempted, they represent
independent adaptive trajectories: archive both and start the common condition
at span two and balance zero, rather than choosing or averaging them. An
unplayed predecessor does not force this reset. Older active sessions continue
their original rules and mix before applying this migration; their existing
answers and first-attempt histories are not rewritten.

Further calibration needs repeated first-attempt observations for each task and
condition: entry-round success, recent accuracy, the load reached, and whether
misses arise from memory, unclear cues, motion, or recognition. The immediate
goal is an understandable entry round and adaptation of the actual memory load.
Equivalent Cogmed difficulty would additionally require a specified edition,
observed timing and stimuli across levels, and comparative performance data.
Published task methods alone cannot establish that equivalence.
