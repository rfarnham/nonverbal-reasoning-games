# Math World living seas — working plan

Last updated: 2026-09-25. Status: **implementation and local verification complete; ready to publish; not deployed**.

This is the durable checklist for the user's next globe detail pass. Read it
after context compaction; update evidence and status before moving to release.
The previous continental release is complete at `f4562b2` and is documented in
`docs/math-world-visual-completion-plan.md`. This extension does not reopen it.

## Scope and ownership

| Owner | Work | Files |
| --- | --- | --- |
| Root | Tree motion, integration, visual QA and release | `globe-biomes.ts`, `globe-continents.ts`, `globe-scene.ts`, docs |
| `marine_life` | Fishing boats, swimming fish schools and whales | New `globe-marine.ts`, focused tests |
| `biome_terrain` | Lighthouses, piers, quays and varied docks | New `globe-harbors.ts`, focused tests |
| `biome_qa` | Rainbows, localized lightning and curling wind ribbons | `globe-life.ts`, optional new effects modules, tests |

Each module owns its resources and exposes `update(...)` / `dispose()`. Root
integrates with the existing scenery clock. There must be no independent
animation loops, timers, runtime network assets or progress mutations.

## Workspace and release

- Worktree: `/private/tmp/spatial-gym-coast-preview` (clean baseline `f4562b2`).
- Branch: `codex/living-seas`.
- Shared workspace: `/Users/rfarnham/Documents/Nonverbal Reasoning Games`.
  It contains unrelated edits. Preserve those; mirror only files still matching
  the baseline or this task's known plan copies.
- Public playtest: <https://rfarnham.github.io/nonverbal-reasoning-games/math-world/?qa=1>.
- Password remains `hedgehog`.
- QA directory: `/private/tmp/math-world-living-seas-qa` (planned preview port 3306).
- Durable evidence: `work/math-world-living-seas-2026-09-25/` in shared workspace.

## Visual acceptance

Do not check an item merely because the implementation exists. Inspect it in
the running scene at desktop and phone sizes, including motion where relevant.

- [x] Small varied fishing boats move or bob offshore, with subtle wakes.
- [x] Tiny recognizable fish swim in schools near the water surface.
- [x] Whales swim and occasionally surface with a recognizable tail/spout.
- [x] Marine paths stay on water and clear mainland, islands, ice and harbors.
- [x] Recognizable lighthouses stand on coast land with gentle night beacons.
- [x] Piers/quays/docks have varied forms and believable coastal connections.
- [x] Rainbows are clearly visible in selected sunlit locations.
- [x] Occasional localized forked lightning belongs to a rainy storm patch;
  no global flash, rapid strobe or uncontrolled motion under reduced motion.
- [x] Sparse curling wind lines move and fade near coast/ridge scenery.
- [x] Tree canopies/fronds visibly sway with rooted trunks, including mainland
  groves; movement remains subtle and does not intersect controls.
- [x] Day/night lighting, globe occlusion, native controls and grounded animal
  remain coherent; no floating, buried or far-side artifacts.

## Verification and release

- [x] Meaningful path, cadence, finite-buffer and resource/disposal tests pass.
- [x] Representative day/night/overview/phone visuals and motion reviewed.
- [x] Pause, reduced motion, hidden/offscreen suspension and question/map
  lifecycle still work; no context leaks or errors.
- [x] Existing navigation, progression, prints and content remain valid.
- [x] Full `npm run check` passes on frozen implementation.
- [ ] Fetch latest main, commit intended files, clean worktree, push branch and
  guarded fast-forward main; never force-push.
- [ ] Pages deployment succeeds for exact commit.
- [ ] Public catalog + hard-refresh game verified; no browser/asset errors.
- [ ] Intended changes safely mirrored; durable evidence and receipt saved.
- [ ] Final report links live game and checklist and states validation honestly.

## Decisions and evidence

- Current code already has slight island tree sway, basic offshore docks, and
  faint rainforest-only rainbows. The user did not notice enough of these;
  increase their readability and extend them rather than merely list them as done.
- Mainland groves were static in the continental release and need wind motion.
- Decorative boats and wildlife do not affect the player's voyage or learning.
- Keep all 32 teaching worlds, two boss placeholders, two books/world, curriculum,
  saves, scores, workbook crops and password behavior unchanged.

- Root implementation: island and mainland trees share a stronger passing-breeze
  shader with root-anchored weights and matching depth/shadow deformation.
  Finite-buffer, fixed-root, immutable-cache and disposal tests pass; final
  visual acceptance also passed.
- Scene integration is ready for marine/harbor modules and effective-motion
  weather suppression. Pause/reduced-motion changes repaint once to remove any
  frozen lightning pulse. Instanced props now use their actual globe positions
  for day/night surface shading.
- Harbor decision: solid piers attach to existing shore geometry inside the
  existing navigation envelopes. The unchanged offshore harbor coordinates are
  anchorages, not new land or route obstacles.

- First integrated Pages preview built and inspected at port 3306. Root desktop/
  phone overview and biome shots show clear rainbows, shore-connected ports and
  fishing boats, with no shader/browser errors.
- Weather actual-app checks passed: first-world rainbows clear at 1440/390;
  drifting curls and crown motion visible; rainforest lightning localized;
  manual pause at a naturally observed peak and reduced motion clear both bolt
  and glow. The final build includes and verifies the latest cloud polish.
- Harbors: 34 shore-attached structures in four styles, eight lighthouses, three
  draw calls. Three tests prove real shore contact, whole-geometry containment
  and disposal. A T-head deck z-fighting issue was fixed by separating heights;
  final build also includes the open lantern-frame correction.
- Marine: whole-loop land/harbor/voyage clearance and resource tests pass.
  Desktop whale is clearly recognizable. Fish appear in focused Worlds3/9/30;
  visibility pass increases fish/tails 1.45x within reserved footprint and moves
  World1 boat slightly inward. The final visual check passed.
- Browser regression passed original world/boss workbooks, eight question/map
  cycles with one remaining WebGL context, sky/time retention, earned completion,
  boat arrival/cancellation/reload, normal locks and playable WebGL fallback.

- Final frozen build: all 13 implementation/test file hashes remain unchanged.
  Full check passes **818 JS + 174 Python = 992 tests**, eight existing skips,
  plus lint, typecheck and static Pages export. Four curriculum/content hashes
  are unchanged. `origin/main` remains baseline f4562b2.
- Root inspected final World1 day/night, World3 fish, World4 breakwater, World9
  rainforest and World30 fish/lighthouse at desktop/390. Fish schools are now
  readable in phone views; World1 whale and inward fishing boat are clear;
  lantern/beam, clearer rain cloud and rainbow/wind placement accepted. All native
  controls are visible, 44px+ and unobstructed in these final views.
- Final performance regression passes animated pixels, manual pause/reload/resume,
  system reduced motion, hidden-tab and offscreen suspension with zero errors.
  No hardware-phone performance claim is made.

- Independent final harbor review found no release blocker in all four World1
  day/night desktop/phone views. Shore attachment, controls, instanced lighting
  and disposal passed. A small patch of speckled daytime shadow on the timber
  head remains a minor polish limitation; the night beam is visible.

## Resume

1. Read this file, current git status and agent messages before editing.
2. Continue the unchecked items. Reuse passed evidence unless code changed or
   a new concern requires another check.
3. Distinguish implementation, visual acceptance, push, deployment and public
   verification. The shared operational copy gets the final release receipt.
