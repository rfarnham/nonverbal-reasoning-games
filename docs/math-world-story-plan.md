# Oceania opening chapter — working plan

Updated: 2026-09-29. Status: implementation and all local checks complete; Pages release pending.

## Story contract

- Working world name: Oceania. Crystal computer: Tideheart.
- Five manuscript pages, each two or three paragraphs: first-entry welcome;
  two existing island books covering separation, invention and prosperity;
  first-world completion reveals sabotage and shattering; final appeal asks
  the player to recover the scattered shards.
- Exactly two reading stops remain on each archipelago. Only World 1 gains
  authored stories in this change; other books remain placeholders.
- After the fracture page, show the actual globe zooming out with glowing
  ballistic shard arcs landing at the summit of each archipelago: exactly
  32 shards. Ordinary stops, bosses and book icons are not destinations.
- Preserve the mystery: no invented villain identity or later plot. This chapter
  introduces the recovery quest; collecting shards is future gameplay work.
- Keep question content, progress, scores, workbooks and earned locks intact.
  Story acknowledgements are versioned and stored separately for normal/QA.
- Explicit reading controls, replay for playtesting, safe reload/resume,
  reduced-motion/static fallback, pause/hidden/offscreen handling and disposal.

## Work and ownership

- Worktree: `/Users/rfarnham/.codex/worktrees/oceania-story/Nonverbal Reasoning Games`.
- Branch: `codex/oceania-first-chapter`; baseline `b75ba41`.
- Root: story state/persistence, integration, camera sequence, release.
- `story_manuscript`: authored pages, illustrated scroll dialog, content tests.
- `crystal_cinematic`: crystal model, shattering/shard geometry, flight tests.
- `story_qa`: independent flow audit and isolated browser QA.
- Evidence: `/private/tmp/math-world-story-qa`, then shared
  `work/math-world-story-2026-09-29/`. Shared workspace has unrelated changes.

## Checklist

- [x] Inspect current flow; create isolated checkout and split ownership.
- [x] Author five pages and responsive manuscript UI.
- [x] First-entry and two island book integrations, saved acknowledgements.
- [x] Complete-world sequence: fracture, globe event, appeal before departure.
- [x] Deterministic octahedral crystal/shards and 32 summit flight paths.
- [x] Replay, reload, storage failures, QA separation and accessibility.
- [x] Focused tests, full repository check and desktop/phone browser review.
- [ ] Commit scoped changes, integrate main, guarded push and Pages verification.
- [ ] Archive evidence, safe mirror and completion receipt.

User correction: one shard at each archipelago summit (32 total), not at
every question stop. Persistent summit markers are decorative; no invented
collection/reward mechanic changes completion history.

## Validation so far

- Eight focused tests pass: authored pages, story save/state and crystal flight.
- Fourteen independent browser cases pass: first-entry, both books, canonical
  final-answer ending, stage reload, history guard/dismissal, QA preview, storage
  isolation/failure, WebGL fallback and desktop/820/620/390px layouts. No errors.
- Pause, hidden and offscreen clocks freeze exactly. Switching to reduced
  motion preserves the final pose. Thirty-two summit shards persist afterward;
  the question and XP ledgers stay unchanged.
- Fixed book focus restoration and framed the full raised octahedron. Flight
  trails use one bounded ribbon draw with blue edges and cyan cores, verified
  in daytime/nighttime WebGL and the actual app. Eight focused tests pass.
- Production export smoke: three cases pass for the catalog, hard-refresh route,
  desktop/390px books and full WebGL scene with automatic appeal. No runtime or
  HTTP errors. The local preview's absolute production favicon is same-origin on Pages.
- Development used localhost:3312/nonverbal-reasoning-games/math-world/. Next
  blocks 127.0.0.1 HMR by default. Static production preview uses port 3311.
- The final release receipt and completed checklist will be archived in shared
  `work/math-world-story-2026-09-29/RELEASE.md` and `PLAN.md`.

## Release validation

`npm run check` passed: lint, TypeScript, static Pages build, 884 JavaScript
tests (8 existing skips), 174 adaptive-core tests and 10 search-build tests.
The local Python environment needed the declared Pillow test dependency; it
was installed into an isolated temporary dependency directory, then the full
check was rerun successfully. No dependency or lockfile changes were needed.

Fourteen development browser cases and three production-export smoke cases
passed. Exact-commit Pages deployment and public verification are the remaining
release steps; their receipt lives at the shared path above.
