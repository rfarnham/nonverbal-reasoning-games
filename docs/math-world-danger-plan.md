# Ocean danger crossings

User request: dangers after every two of the 32 archipelagos, illustrated briefing, printable packet, one review stop; revisit original mistakes followed by verified similar questions. Maximum 24 questions. Preserve every wrong response and deferred reinforcement.

## Working decisions

- Six squalls, five krakens, five maelstroms; fixed ocean locations independent of progress.
- Keep review crossings before the existing full-test hurricanes after 16 and 32.
- Five questions per group where verified candidates exist; compress to three total when the backlog exceeds 24. Shorter groups are honest when the index has no reviewed matches.
- Recent mistakes lead; old unserved work ages into priority. Keep immutable mistake observations separately from review scheduling.
- Freeze the packet on preparation, not story viewing. Print, play and resume use the same ordered IDs.
- Reviewed offline candidate edges only. No runtime AI or network dependency, no 2025/2026 holdout questions.
- Exact original artwork printer shared with teaching workbooks.
- Per-child danger saves and separate QA. Claim the old shared mistake history only once.
- Honor pause scenery, reduced motion, keyboard access and the canonical answer/retry interface.

## Checklist

- [x] Inspect current progress, story, workbook, globe and search-index code.
- [x] Parallelize engine/candidates, globe scenery, and illustrated artwork.
- [x] Integrate navigation gates, briefing, preparation, single stop and canonical quiz.
- [x] Retain mistakes from every teaching and danger answer; persist frozen packets.
- [x] Verify candidate relationships, backlog/deferred scheduling, profile and QA isolation.
- [x] Browser check normal/QA navigation, reload, keyboard, fallback, responsive layouts.
- [x] Visually inspect dangers and printed original-art packet.
- [x] Full repository checks on the current main baseline.
- [ ] Publish and verify exact deployed SHA and public play flow; post-commit result is recorded in `work/math-world-danger-crossings-2026-09-30/release-receipt.json`.

Potential later dangers: fog banks, drifting icebergs and reef passages. Not included in this first three-kind implementation.

## Verification evidence

- Engine/gate regression tests cover every one of the 680 teaching questions, immutable repeated misses, packet caps, backlog priority/deferred candidates, profile and QA isolation, corrupted storage, canonical encounter IDs, and boss gates.
- Browser normal/QA runs preserved the 12-question sample packet across print, answers, reload and resume. Letter/A4 output each had 12 pages, one intact image per question and at least 38mm workspace. Sample contains 11 reviewed originals and one previously documented source-gap fallback.
- Dialogs checked at 820, 620 and 390 pixels; zero page errors. Three hazards checked by day/night; paused frames identical, mobile kraken and maelstrom checked.
- Local evidence: `work/math-world-danger-crossings-2026-09-30/`.

Production-build flow also completed the sample packet entirely by keyboard, unlocked World 3, passed an empty QA crossing into the 2026 boss, and retained two repeated teaching misses without altering normal history. Full `npm run check` passed: 937 JavaScript tests plus 174 curriculum-engine and 10 search Python tests; 8 existing JavaScript skips, 59 pre-existing vendored-runtime lint warnings, no lint errors.
