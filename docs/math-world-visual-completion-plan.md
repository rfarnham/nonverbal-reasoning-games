# Math World visual completion — working plan

Last updated: 2026-09-25. Status: **implementation and local verification accepted; ready to publish; not deployed**.

This file is the durable handoff and acceptance checklist for the globe visual
work. Read it after context compaction. Update it when work changes, evidence is
collected, or a release is made. A code change alone does not complete a visual
requirement: inspect the rendered result before checking it off.

## Objective and source of truth

Finish the user's approved globe visual plan. The previous release added effects
but did not create recognizable shared land masses. Its six geographic clusters
only grouped destination coordinates. The user correctly identified this gap.

User-approved requirements: particles; coherent lighting and local lava glow;
realistic water without axial bands; subtle wildlife and shoreline motion; icy
north and south poles; nonuniform archipelagos clustered into substantial land
masses; varied moving clouds with rain and occasional rainbows; day/night with a
visible terminator; varied geology including volcanoes/smoke, forests, lagoons,
rivers, tundra, and glaciers. Finish the related promised motion and grounding
details as listed below.

Do not change curriculum, questions, scoring, saves, workbooks, password gate,
the 32 teaching worlds, the two boss placeholders, or two books per world.
Arithmetic voyage gameplay and story writing are separate future work.

## Work location and release baseline

- Repository: `rfarnham/nonverbal-reasoning-games`.
- Implementation worktree: `/private/tmp/spatial-gym-coast-preview`.
- Feature branch: `codex/continental-globe`.
- Starting release: `99f12c40afee36927ec69498d2e0bef4934b36d4` (`99f12c4`).
- Shared workspace: `/Users/rfarnham/Documents/Nonverbal Reasoning Games`.
  It contains unrelated uncommitted work: do not reset it or commit from it.
- Public URL: <https://rfarnham.github.io/nonverbal-reasoning-games/math-world/?qa=1>.
- Existing public playtest password: `hedgehog`.
- New QA evidence: `/private/tmp/math-world-continental-qa` (static port 3305).
- Previous QA/reference: `/private/tmp/math-world-living-qa` (port 3304).

## Ownership and active work

| Owner | Files / responsibility | Current state |
| --- | --- | --- |
| Root | `globe-scene.ts`, integration, avatar grounding, docs, release | Integrated continents and grounded avatar; collision-aware occupied badge placement; local verification passed; publish and verify public release |
| `biome_terrain` | `globe-geometry.ts`, new continent geometry/data module(s), routing tests | Complete: connected mainlands, shared navigation envelopes, stitched mesh, CPU cache; geometry and visual review passed |
| `globe_weather` | `globe-biomes.ts`, `globe-weather.ts`, related tests | Complete: moving coast foam, anchored vegetation sway, ice motion, three cloud formations; lifecycle and shader checks passed |
| `biome_qa` | QA scripts/artifacts, independent acceptance | Visual, lifecycle, navigation and layout acceptance passed; release smoke test remains |

Integration API agreed: `createGlobeContinents(globe)` returns
`{ update(seconds, sunDirection?), dispose() }`. Navigation must use the same
land definition as rendering. The avatar now uses the original authored stop/road
positions; only the occupied native badge moves below the ground anchor with a leader line.
Crowded captions use side placement; other badges remain at their original stops.
All 114 original stop anchors have passed land/blocker raycast checks; screenshots
must still confirm foot contact and readable controls.

## Acceptance checklist — new work

Items remain unchecked until their required verification is complete.

- [x] **Substantial connected land:** whole-globe views unmistakably show large
  regional land masses grouping the archipelagos. No reliance on labels,
  coordinate statistics, or recolored isolated platforms as proof.
- [x] **Interesting coastline:** visibly irregular silhouettes, bays/inlets,
  peninsulas and inland water; broad open seas between regions. Inspect several
  globe rotations, including the default opening view.
- [x] **Coherent terrain:** focused worlds sit naturally near the larger land;
  terrain, native controls, paths and two books remain readable. Inspect all
  32 teaching worlds and both bosses for intersections and obstructions.
- [x] **Shared safe navigation:** route finding accounts for every new land
  mass and polar ice, including the boat's full width. Test all 561 destination
  pairs and visually inspect representative departures, coasts and arrivals.
- [x] **Water/coasts:** shallow turquoise shelves and reefs transition into
  deeper ocean; moving foam follows local shores. No axial sphere banding,
  shoreline z-fighting, or waves sweeping over dry land.
- [x] **Vegetation and ice motion:** subtle tree movement and bobbing/drifting
  coastal ice are visible, bounded, and controlled by the shared scenery clock.
- [x] **Cloud variety:** materially different formations and layered natural
  movement, with no loss of readability at focused stops.
- [x] **Grounded animal:** feet meet the visible land beside a stop, with a
  matching contact shadow; travel still follows the authored path. Check desktop
  and phone views and ensure native targets remain usable.

## Regression checklist — preserve and verify

These existed in the baseline; they are not claimed as newly completed work.

- [x] Day / Sunset / Night / Auto, terminator, terrain shadows, readable night
  fill, warm crater light, stars and atmosphere still render correctly.
- [x] Volcano smoke/embers; birds, snow, spray, fireflies; localized rain,
  rainbow and aurora effects remain present and bounded.
- [x] Both irregular polar caps remain visible and participate in navigation.
- [x] Pause scenery, system reduced motion, hidden tab and offscreen suspension
  stop ambient updates; no question-panel render loop or leaked WebGL contexts.
- [x] Scenery time and selected sky survive entering/leaving question panels.
- [x] Normal progression and locks, QA access, boat arrival/cancel/reload,
  stop completion returning to the map, and original-art printing still work.
- [x] Responsive checks at 1440, 820, 620 and 390px: no horizontal overflow,
  cropped controls or inaccessible stop/book buttons; targets at least 44px.
- [x] No shader/browser errors, failed local assets, or external runtime calls.
- [x] WebGL failure retains the playable fallback.

## Validation and release checklist

- [x] Render a frozen candidate and collect before/after overview, rotated
  globe, representative biome, night and phone screenshots.
- [x] Root and independent QA agent inspect those screenshots against this
  checklist; resolve deficiencies before declaring completion.
- [x] Relevant geometry, route, motion and lifecycle tests pass (final frozen source).
- [x] Full `npm run check` passes (lint, typecheck, Pages build, JS/Python tests).
- [x] Fetch/integrate current `origin/main`; rerun required checks if needed.
- [ ] Commit only intended files on the feature branch; clean worktree.
- [ ] Push feature branch, then guarded fast-forward of `main`; no force push.
- [ ] Pages workflow for the final commit succeeds.
- [ ] Verify public catalog and hard-refresh game URL, content and console.
- [ ] Safely mirror intended source files back to shared workspace after
  checking they still match the baseline; preserve unrelated local edits.
- [ ] Final report names branch, commit, successful deployment, playable URL,
  verification evidence and any remaining limitations honestly.

## Evidence and decisions log

- Baseline audit: grouped coordinates are not actual continents; shoreline
  foam, trees and ice were static; clouds reused one formation; the animal was
  lifted in screen space above its native stop button.
- 2026-09-25: split implementation across terrain and weather agents with an
  independent visual QA agent. Root integrates and owns delivery.
- 2026-09-25: root replaced screen-space avatar lift with a real surface landing
  offset near stops, matching ground shadow and unchanged road between stops.
  **Not yet visually accepted.**
- 2026-09-25: user requested durable external tracking; this plan was created
  and copied to the shared workspace for direct inspection.

- 2026-09-25: QA raycasts found the initial avatar landing collides with scenery
  at 48 of 114 stops. All have land beneath, but some feet intersect tree, ice,
  peak or terrace geometry. **Open defect:** choose safer clearing positions and
  visually verify; do not solve by perching the avatar on top of scenery.

- 2026-09-25: biome/weather implementation ready for first build. Focused
  lifecycle/resource tests pass; animated shores, anchored foliage, coastal ice
  and three cloud formations remain pending visual review.

- 2026-09-25: candidate 1 build passes. Root and QA inspected opening/rotated
  views: six connected mainlands, bays, inland lakes, and broad seas are now
  unmistakable. Terrain sampling reports 26.86% mainland coverage, excluding
  poles and stop islands. First two visual requirements accepted.
- Candidate 1 is **not release-ready**: dense mainland shadow acne; jagged dark
  lake/river banks; some rivers buried; avatar feet covered by a pedestal and its
  body obscured by rainforest canopy; phone Summit label overlaps a book.
- Candidate 2 fixes in progress: terrain surface/shadow and river corrections;
  cloud limb fade; remove pedestal at the avatar; use the readable illustrated
  body layer while grounding feet/shadow at original stops; road-height feet
  between stops; hide redundant phone short labels while retaining full native
  names and 44px targets. Require another screenshot inspection.

- Candidate 2: root and QA confirm the shadow grid and jagged dark banks are
  fixed, grounded avatar feet/body are readable, and the phone label/book overlap
  is removed. Remaining defect: thin mainland cracks from adaptive subdivision
  T-junctions. Terrain agent is stitching shared edge points and adding a test.
- Full check completed: 802 JS tests passed, eight existing tests skipped;
  174 Python tests passed. Subsequent final geometry edits require fresh checks.
- Independent current-source audits: 828,927 above-water vertices remain inside
  navigation envelopes; all 114 original foot anchors are grounded/clear;
  106 bounded river samples have zero burial; no inward or degenerate faces.
  An earlier river diagnostic included antipodal hits and was discarded.
- Isolated browser latency: previous release cold 706ms / map returns 241–279ms;
  candidate 2 cold 1515ms / returns 1148–1218ms. No errors. Cache immutable mainland
  CPU geometry across map mounts to recover return speed; do not share live GPU
  objects or break disposal. Recheck after caching.
- Final terrain polish also adds restrained regional land-cover color variation
  so large mainland interiors do not read as uniform green fill.

- Final candidate 3: stitched closed mesh, outward smooth normals, regional
  land-cover variation and interior groves accepted by root/terrain/QA review.
  A very faint dotted line remains in one overview as minor rendering polish;
  it is not an open mesh boundary or navigation defect.
- Final full check passed on frozen source: **805 JS + 174 Python = 979 passed**,
  eight existing skips. ESLint, TypeScript and Pages export passed. The source
  hashes in `final-source-hashes.json` still match. `origin/main` remains baseline
  `99f12c4`; no integration conflict.
- Candidate 2's world-17 phone badge/book collision prompted the final rule:
  only the occupied stop's badge moves; it chooses a collision-free annotation
  position while every ground anchor and native hit target stays intact. The
  114 occupied stops × four widths (456 layouts) are being verified.
- Final navigation report passed natural boat arrival, cancel/reload preservation,
  normal locks, locked-boss rejection and playable phone WebGL fallback.

- Candidate 3 exhaustive scan: all 456 occupied-stop views have visible 44px+
  controls, native center hits, and no horizontal overflow. Seven caption/book
  overlaps in world 17 and five zero-offset badges still obscure the animal.
  Final correction widens badge placement and chooses side captions when needed;
  regression tests pass, browser recheck pending. This supersedes the earlier
  assumption that only one label collision remained.
- Final performance/control audit passed: 30fps, 146 GL calls/frame on this
  desktop; manual pause survives reload; reduced motion, hidden and settled
  offscreen views produce zero draws and resume correctly. No hardware-phone
  performance claim. Cached map returns 387–409ms versus 1148–1218ms uncached;
  cold start 1844ms in this sample.
- Original world and whole boss-test crop workbooks pass. Eight question/map
  cycles leave one live WebGL context and one canvas; question screens make no
  globe draws. Sky/time persists; earned completion returns to the map and
  unlocks the next world. No browser errors.

- Candidate 4 independent pure layout audit passes all 456 recorded projections:
  no occupied zero-offset fallback, occupied-target overlap, clipping, hidden
  caption, caption/target collision, or caption/caption collision. Only the five
  previously bad badge offsets changed. The original unoccupied controls have
  small corner overlaps in 18 views, but every native center remains usable;
  these are unchanged and do not cover the animal.
- Final integration code review found no correctness, accessibility or resource
  lifecycle blockers. Candidate 4 browser spot checks and full check are pending.

- Candidate 4 release check passed: **806 JS + 174 Python = 980 tests passed**,
  eight existing skips; lint, TypeScript and static Pages export passed. All 15
  implementation/test hashes match the frozen build and all four curriculum/
  question-content hashes match the baseline.
- Final browser follow-up: 80 occupied-stop views across the five affected worlds
  pass at 390/620/820/1440px, with no control or caption failures and no errors.
  Root inspected the dense phone layouts and accepts the visible animal, ground
  contact and connected annotation. The 456-view audit proves only those five
  bad offsets changed. A conservative sprite/caption overlap warning was inspected
  at its worst case and proved to be transparent sprite padding; no visual issue.
- Release is now the only remaining work: commit, push feature/main, await the
  exact-commit Pages workflow, verify the public site, and mirror source safely.

## Resume instructions

1. Read this file and `git status` in the isolated worktree.
2. Check live agent messages before editing their owned files.
3. Continue unchecked implementation/verification; do not repeat passed checks
   without a change or unresolved concern that warrants it.
4. Keep this file's state and evidence accurate. Do not mark “implemented” as
   “visually accepted,” or “pushed” as “deployed.”
