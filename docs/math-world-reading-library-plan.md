# Oceania reading library and hurricane pages

Requested: give both hurricane challenges beautiful illustrated book introductions; add side buttons for reviewing the story so far and a small, succinct fourth-grade-friendly glossary.

## Contract

- Each hurricane receives a distinct, bundled 3:2 painting and two short narrative paragraphs in the existing manuscript reader.
- A hurricane briefing appears on first entry; acknowledging it persists independently of question or workbook progress. Reloading must not repeatedly interrupt the player.
- The storybook contains acknowledged story pages, read island books, and encountered dangers/storms. Repeated danger kinds appear once, in voyage order. Future plot pages are not exposed merely by QA navigation being unlocked.
- Rereading and opening the glossary never advance the story, questions, packets, boat, or completion state.
- A compact glossary defines relevant sea, weather, geography and crystal terms, including squall, tide and octahedron, in short fourth-grade-friendly sentences.
- Labeled book and field-guide buttons sit beside the globe on wide screens and below it on small screens, without covering map stops. Native dialogs support keyboard/Escape, heading focus, focus restoration and readable phone layouts.
- Existing first-world story chronology, full-test printing, danger packets, boss timing, QA separation and scenery controls remain intact.

## Checklist

- [x] Inspect current story, persistence, danger and boss flows on latest main (`118df75`).
- [x] Delegate hurricane art/content, library UI, and glossary/history logic in parallel.
- [x] Integrate encounter-reading persistence, hurricane introductions and side controls.
- [x] Verify history boundaries, migration, read-only behavior and concise glossary content.
- [x] Inspect desktop and 820/620/390px layouts; test keyboard, Escape, focus, reload and both hurricane pages.
- [x] Full repository check passed on `118df75`: lint/typecheck/Pages build, 967 JavaScript tests and 184 Python tests, 8 existing skips, no failures (59 existing vendor lint warnings).
- Publication, exact-SHA Pages success and public verification will be recorded in `work/math-world-reading-library-2026-09-30/RELEASE.md` after deployment.

## Local verification

- 18 alphabetized glossary terms, each one short sentence. Real-world definitions distinguish the legendary kraken from real animals and explain octahedron in the Tideheart story.
- Selector tests verify fresh/QA spoiler boundaries, acknowledgement ordering, legacy danger packets, deduplication, voyage order, invalid markers and immutable history.
- Story persistence tests verify legacy migration, validated encounter IDs, idempotent acknowledgements and normal/QA separation.
- Both normal hurricane arrivals were acknowledged and reloaded; neither repeated its intro. Each appeared in the library and each still printed all 24 original test questions.
- Library browser checks at 1280/820/620/390px verify readable layouts, 44px targets, no overlap/overflow, one modal, keyboard/Escape/focus restoration, and unchanged saved story/game/packet state while reviewing.
- Both paintings passed desktop/mobile scroll inspections with full uncropped art, decoded dimensions, descriptive alt text, readable prose and working controls. No browser/asset errors.
