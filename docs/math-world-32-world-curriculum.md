# Math Kangaroo Worlds: sixteen concepts, two passes

**Owner-requested expansion of the password-gated public playtest · 23 September 2026.**

The adventure contains **32 teaching worlds: two complete passes through the original 16 concepts**. The 2025 Grades 1–2 boss test follows World 16; the 2026 Grades 1–2 boss test follows World 32. Both assessments remain separate from teaching and retain their full-test print buttons. Boss artwork and answer-entry gameplay remain placeholders.

The original ten strands keep all 480 questions, their answer choices, answers, assets, stop IDs, and question order. Six restored strands add 200 reviewed source questions. The resulting adventure has **680 teaching questions across 114 stops**, plus the **48 reserved boss-test questions**.

## The complete sequence

Read down the first world column, take the 2025 boss test, then read down the second world column before the 2026 boss test.

| Concept | First pass | Second pass | Stops per world | Questions per world |
| --- | ---: | ---: | --- | ---: |
| Counting | 1 | 17 | 4 × 6 | 24 |
| Symmetry & Turns | 2 | 18 | 4 × 6 | 24 |
| Arithmetic | 3 | 19 | 4 × 6 | 24 |
| Patterns & Cycles | 4 | 20 | 4 × 6 | 24 |
| Shape Building | 5 | 21 | 4 × 6 | 24 |
| Logic | 6 | 22 | 4 × 6 | 24 |
| Groups & Sharing | 7 | 23 | 4 × 6 | 24 |
| Digits & Codes | 8 | 24 | 4 × 6 | 24 |
| Routes & Grids | 9 | 25 | 4 × 6 | 24 |
| Fractions | 10 | 26 | 2 × 6 | 12 |
| Solids & Views | 11 | 27 | 4 × 6 | 24 |
| Length & Measure | 12 | 28 | 3 × 6 | 18 |
| Money & Value | 13 | 29 | 3 × 6 | 18 |
| Time | 14 | 30 | 3 × 6 | 18 |
| Area & Boundary | 15 | 31 | 2 × 5 | 10 |
| Missing Values | 16 | 32 | 4 × 6 | 24 |

Each pass contains 340 questions. Every world has at least two stops, each stop has five or six questions, and no world exceeds 24 questions. The owner explicitly chose shorter worlds where the eligible reviewed corpus is thin. Questions are not repeated or loosely reclassified to fill a quota.

The reference selection is [spiral-32.plan.json](../content/math-world/spiral-32.plan.json); the approved playable source is [spiral-32.runtime.json](../content/math-world/spiral-32.runtime.json). The older [20-world release](math-world-20-world-curriculum.md) remains a historical record and migration baseline. The [original proposal](math-world-spiral-curriculum-proposal.md) provides the 16-concept ontology; its four-pass scope is not the current release.

## Restored teaching coverage

- **Groups & Sharing:** equal groups, multiplication and division, distributing quantities, and remainders. The return visit combines grouping with additional conditions.
- **Fractions:** equal parts, halves and quarters, fractional quantities, and recovering or comparing a whole. A fractional relationship must be essential; an ordinal such as “third” is not fraction coverage.
- **Length & Measure:** compare lengths and measured quantities, interpret rulers and repeated units, and combine measures. A balance-equation story is not included merely because it mentions kilograms.
- **Money & Value:** denominations, prices, change, equivalent purchases, and the value of a group of purchases.
- **Time:** clocks, dates, calendars, durations, and schedules. Age arithmetic alone does not qualify as a time problem.
- **Area & Boundary:** count unit coverage, compare covered regions, trace boundaries, and reason about perimeter. Shaded cells used only as logic clues do not count as area coverage.

The retained ten strands preserve their reviewed progression. New source questions are assigned to a concept and pass before ordering within that pass by reviewed reasoning demand. Grade and published points remain secondary signals, not calibrated difficulty scores.

## Source and review policy

The source scope remains Grades **1–2 at 3, 4, or 5 points**, and Grades **3–4 at 3 or 4 points**. Recent eligible contests receive preference, with older verified papers supplying concepts missing from the recent pool. Practice workbooks and mocks remain explicitly labeled.

Each new question retains a pinned source version, source-image hash, a primary taxonomy type, essential secondary types, and solving-strategy tags. Review includes the actual diagram and all source choices, an independently worked answer matched to the source key, and the published point tier or its source-paper basis. Unresolved key conflicts, broken images, and cross-edition repeats are excluded. Original papers with two choices retain their authentic choices; extra distractors are not invented.

The 2025 and 2026 USA Grades 1–2 annual papers and their documented aliases remain excluded by the [boss holdout policy](../content/math-world/boss-holdouts.json). Matching also checks new selections against the retained 480 questions and against the other restored strands. The broader corpus has not been reclassified; the reviewed annotations describe this selected curriculum.

## Maps and paper workbooks

All 32 worlds have distinct authored routes, including separate returning-visit layouts. Compact worlds have only their real quiz islands and exactly two storybook islands. Avatar motion follows the same road geometry that is drawn on the map. The storybook icons remain placeholders.

Every world has one **Print workbook** button, following its exact question and stop order. Original question artwork is preferred; archived source cards are used where an original crop cannot be recovered. Printed pages retain room for pencil work and do not recreate the answer options as buttons. All print assets are bundled locally, and printing changes no progress. Both boss buttons still print all 24 source questions in exam order.

## Saved progress and playtesting

The new content version explicitly accepts the previous `spiral-20.v1.f665226c7060bba8` save format. The build verifies that all old questions and stop orders are unchanged before allowing that migration. Earned completions, first-attempt records, active question phases, checkpoints, and playtest notes carry forward. Previously started or completed worlds stay accessible after renumbering; newly inserted worlds still need to be completed and are never granted automatically.

Normal and test-mode saves remain separate. `testUser123` and the `?qa=1` playtest URL can inspect all 32 worlds and both boss placeholders. The `hedgehog` gate and its remembered browser cookie remain in place. Use `npm run dev` locally or `npm run build:pages` for the static GitHub Pages build.
