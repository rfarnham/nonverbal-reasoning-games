# Original-art workbook correction

Updated: 2026-09-29. Status: verified and ready for deployment; live release receipt is archived separately.

## Contract

- Print original publisher artwork and original question layout, including all options.
- Crop or mask unrelated neighboring questions without rearranging retained content.
- Prefer verified original paper/workbook crops over reconstructed cards. Never substitute a near-match with changed mathematical content or ordered choices.
- Remove automatic multi-column recomposition. Preserve each retained source layout with uniform scaling.
- Record any questions without an exact original as unresolved; retain the existing card until that source is available rather than silently substituting a different question.
- Preserve teaching order, stop-local numbering, answer-entry mapping and pencil space.
- World 1, Stop 1, Question 2 is the primary reported regression.
- Preserve game questions, answers, curriculum, progress, story and boss tests.

## Ownership and checklist

- Root: renderer, original-art manifest integration, release.
- workbook_source_audit: locate and verify source PDFs/crops, source coverage.
- workbook_qa: independent print/PDF review and regression coverage.
- [x] Isolated checkout from b16cae3; shared workspace has unrelated changes.
- [x] Audit all 680 selected questions and original source coverage: 646 retain/recover original layouts; 34 exact-source gaps documented.
- [x] Replace 273 reconstructed print sources with verified originals; retain layout and mask neighbors. See [remaining source gaps](math-world-workbook-source-gaps.md).
- [x] Remove automatic header/body splitting and column reconstruction.
- [x] Verify World 1 page 2 and representative layouts in browser/PDF; all 32 worlds / 680 pages pass geometry, order, writing-space, and progress checks. World 1 is 24 pages on Letter and A4.
- [x] Full `npm run check` and production-static workbook/catalog smoke tests pass.
- [ ] Guarded main update, exact Pages deployment and public print verification (recorded in release receipt).
- [x] Archive source-review and browser/PDF evidence in shared work directory.
- [ ] Complete release receipt and safe mirror intended files.

Worktree: /Users/rfarnham/.codex/worktrees/original-workbook-art/Nonverbal Reasoning Games.
Branch: codex/original-workbook-art.
Evidence: /private/tmp/original-workbook-qa, then shared work/math-world-original-workbook-2026-09-29.

## Verification notes

- Every replacement is compared against the selected prompt, diagrams, values, and ordered options. A matching correct letter alone is insufficient.
- Preserve original same-question text, including bilingual editions. A short separate clarification may retain an existing game permission (e.g. rotation) without rewriting the original.
- Source pixels remain untouched except cropping/masking unrelated material; all retained artwork shares a single scale.
- Browser/PDF checks cover order, complete artwork, one page per question, no overflow, and at least 38 mm of writing space. Print preparation must not change saved progress.

## Initial validation

- Five workbook regression tests pass, including source preference, complete bounds, hashes, changed-source rejection, and World 1 question 2.
- Browser failure recovery passes blocked popup, missing image, and closed preparation window; no saved progress changes.
- Full sweep: no console/HTTP errors, no overflow, exactly one uniformly scaled image per page, and at least 38 mm writing space.

## Final local validation

- `npm run check`: passed on latest origin/main baseline b16cae3. Build/typecheck successful; 887 JavaScript tests passed with 8 expected skips; 174 adaptive-core Python tests and 10 search tests passed. ESLint reports 59 existing warnings and zero errors.
- Production-static smoke verifies catalog navigation, hard-refresh game route, workbook control, and exact source hashes for World 1 questions 2 and 3.
- World 1 question 3 now uses the exact official USA 2017 sample paper; remaining cross-page Think workbook crops have unrelated page furniture masked in place.
- 273 new print originals, 335 total overrides. With existing source crops, 646/680 question layouts are original; 34 unresolved cards remain explicitly documented.
