# Math Kangaroo Worlds: 20-world spiral

**Approved implementation scope · local playtest · 22 September 2026.**

The adventure visits ten strands, then returns to each for a deeper second pass:

**Counting → Symmetry & Turns → Arithmetic → Patterns & Cycles → Shapes & Fit → Logic → Digits & Codes → Routes & Grids → Solids & Views → Missing Values**, then the same sequence again.

Each world has **four stops of six questions: 24 questions per world, 480 across the adventure**. All 480 are selected from existing source questions and have agent review records. The [reference manifest](../content/math-world/spiral-20.plan.json) records the exact versioned selection; the current snapshot is `spiral-20.v1.f665226c7060bba8`.

| World | Learning focus | Return visit |
| --- | --- | --- |
| 1. Counting 1 | Count a given collection, reconstruct missing objects, and distinguish objects from gaps. | 11. Counting 2: count systematically, combine conditions, and avoid double counting. |
| 2. Symmetry & Turns 1 | Recognize reflections, turns, and the effect of unfolding. | 12. Symmetry & Turns 2: compose transformations, reverse woven views, and track linked gear turns. |
| 3. Arithmetic 1 | Choose and combine addition, subtraction, and equal groups. | 13. Arithmetic 2: evaluate several stages, compare expressions, and organize target totals. |
| 4. Patterns & Cycles 1 | Find a repeating unit or a visible growth rule. | 14. Patterns & Cycles 2: extend growth, follow repeated operations, and reason across cycles. |
| 5. Shapes & Fit 1 | Identify geometric features and fit or assemble pieces. | 15. Shapes & Fit 2: use several geometric constraints and reason about dissection or coverage. |
| 6. Logic 1 | Use given conditions to order, match, or eliminate possibilities. | 16. Logic 2: combine conditions, make cases, and justify a constrained choice. |
| 7. Digits & Codes 1 | Read numerals, use place value, and decode consistent symbols. | 17. Digits & Codes 2: combine digit constraints, number properties, or arithmetic with codes. |
| 8. Routes & Grids 1 | Follow directions, compare routes, and locate positions on a grid. | 18. Routes & Grids 2: track legal turns, count permissible routes, and reason about a network. |
| 9. Solids & Views 1 | Connect an object with a view, layer arrangement, or cube structure. | 19. Solids & Views 2: infer hidden parts and reason about solid orientation, faces, and assembly. |
| 10. Missing Values 1 | Recover an unknown from equalities, comparisons, or a balance. | 20. Missing Values 2: combine relationships, undo operations, and preserve totals during transfers. |

Within a world, the four stops move from a more direct case toward questions requiring additional conditions or a less obvious intermediate step. Returning to a strand adds reasoning demands rather than simply increasing the source grade. The source question order is not the teaching sequence.

## Prerequisites and scope

Pass 1 establishes counting, orientation, calculation, and reading a diagram before the later worlds combine them. Pass 2 assumes the first visit to each strand and draws on the whole first pass: for example, systematic counting helps with routes, and arithmetic supports missing-value relationships. These are curriculum prerequisites, not claims about a child's age or measured ability.

The allowed source pool is Grades **1–2 at 3, 4, or 5 points**, and Grades **3–4 at 3 or 4 points**. A source grade or point value is recorded as provenance, not treated as a calibrated difficulty estimate. Some accessible Grades 3–4 transformations can appear on the first visit where they teach the intended skill more clearly than a forced Grades 1–2 substitute.

The first visit uses 24 Grades 1–2 questions in each world except **Symmetry & Turns 1**, which uses **14 Grades 1–2 and 10 Grades 3–4** questions. Each second visit uses **12 from each grade band**. Ordering follows reviewed reasoning demand first, with source grades and points as secondary signals.

| Source grade | 3-point | 4-point | 5-point | Total |
| --- | ---: | ---: | ---: | ---: |
| Grades 1–2 | 92 | 126 | 132 | 350 |
| Grades 3–4 | 66 | 64 | — | 130 |
| Total | 158 | 190 | 132 | 480 |

Recent eligible contests receive preference. Older contests supply authentic coverage where the recent local pool is thin. Selected Think Academy workbook questions are labeled **practice**, and any mock questions are labeled **mock**; a recent workbook publication date does not make its questions a recent official contest. Variants that retain a teaching method but change the source diagram or values are recorded explicitly.

The selected bank contains **410 contest questions, 68 workbook practice questions, and 2 mock questions**. Of the contest questions, **144 are from 2020–2026**, **132 from 2015–2019**, and **134 from 2000–2014**. Older material is especially useful for a complete set of transformations, number codes, and diagrams with intact choices. These counts describe the selected bank, not the coverage or classification of the entire corpus.

## Classification and review

Worlds are learning groups. The supplied taxonomy's 12 families and 86 problem types remain a separate classification layer: every selected question has one primary type, essential secondary types where needed, and separate strategy tags. The complete corpus has not been reclassified.

The boundaries matter. Counting an existing collection differs from counting possible configurations. A route-counting problem has a counting primary type, whereas finding a legal route has a movement primary type. A reverse-side weave retains its spatial layer type and a transformation facet. An arithmetic question can use a money setting; a money primary type is used when prices or units are essential. A dice question belongs to spatial orientation unless its actual question concerns counting or probability.

Each selected source card is reviewed with its diagram and choices. The authoring records preserve the catalogue ID, content version, published point tier, answer-key provenance, asset hash, and a concise review basis. Original source records are retained alongside these annotations. Identical IDs, known source aliases, duplicate images, and suspiciously similar prompts are checked across the combined bank; matching prompts with different essential diagrams require an explicit distinction.

The combined 480-record audit found no repeated question IDs, identical source-image hashes, or repeated USA exam/grade/question references. All selected grade bands, point tiers, taxonomy IDs, strategy tags, and source versions pass validation. Shared-stem candidate clusters, including gears, woven reversals, and disc views, retain documented differences in their actual diagrams; they are practice variations of a method rather than new concept families.

The result is **agent-reviewed material for local playtesting**, not a calibrated assessment or a publicly released question collection. Private source cards and restricted source text remain in the local preview. Public documentation contains the curriculum outline and aggregate provenance, not the private source material.

## Running the local preview

Use `npm run dev:worlds` for development, or `npm run build:worlds` for the preview build. These commands require the ignored local source export and assets; a clean public checkout does not include that private material. Standard builds exclude it. The exact, case-sensitive local profile name `testUser123` enables the labeled test mode for visiting every world and stop.

The earlier [four-pass proposal](math-world-spiral-curriculum-proposal.md) remains a historical design record. This 20-world plan supersedes that proposed world count and sequence for the current implementation.
