# Math World hurricane bosses — working plan

Updated: 2026-09-25. Status: **implementation and all local verification complete; ready to publish**.

Read this plan after compaction. The living-seas release is complete at
`81e97545e135275fbe962ee158b7385717f17cb4`; its final receipt and evidence are in
`work/math-world-living-seas-2026-09-25/` in the shared workspace.

## Product decisions

- Replace both boss castles/islands with ocean hurricanes battering the ship.
- First storm lies on the sailing course between teaching Worlds 16 and 17.
- Second lies beyond World 32 toward an undesigned final destination. Do not
  invent or unlock a final world.
- Recommendation being implemented: storm 1 gathers after 14 completed worlds,
  strengthens after 15 and matures after 16. Storm 2 mirrors this at 30/31/32.
  Actual contiguous completion drives weather, not whichever world is selected.
  QA shows mature storms without changing real progress.
- Keep both whole-test print buttons, the 2025/2026 grade 1–2 tests, and existing
  milestone locks. Answer-entry gameplay remains an explicit future feature.
- Use an impressive broad tropical cyclone: recognizable eye, rounded cloud
  bands, layered vortex rotation, rain, sea spray, whitecaps and local lightning.
  The focused view shows the ship rocking in the storm. Avoid a tornado funnel.
- Respect scenery pause, reduced motion, hidden/offscreen suspension, keyboard
  navigation, readable controls, workbook behavior and safe reloads.

## Workspace and ownership

- Clean worktree: `/private/tmp/spatial-gym-coast-preview`.
- Branch: `codex/storm-bosses`; baseline `81e9754`.
- Shared workspace is dirty; never reset or commit unrelated work there.
- Root: scene integration, player ship/weather interaction, harbor cleanup,
  cross-module regressions, browser QA and release.
- `storm_routes`: ocean placement/route geometry and tests.
- `storm_visuals`: new `globe-storms.ts` renderer and tests.
- `storm_experience`: progression stages, React presentation/fallback and tests.
- QA/evidence: `/private/tmp/math-world-storm-bosses-qa`; durable copy in shared
  `work/math-world-storm-bosses-2026-09-25/`.

## Contracts

- `GlobeSceneFrame.stormStages?: Readonly<Record<string, number>>`.
- `createGlobeStorms(globe)` exposes `update(seconds, focus, zoom,
  activeDestinationId, stages, motionEnabled, sunDirection?)` and `dispose()`.
- Boss destination ids remain `boss-2025`/`boss-2026`; kind stays `boss`.
  Boss harbor equals storm center, and bosses are no longer land obstacles.
- Every renderer uses the shared scenery clock, fixed resources and cleanup.

## Checklist

- [x] Durable plan and ownership established; integration contracts agreed.
- [x] Boss 2025 occupies a verified ocean route between Worlds 16 and 17.
- [x] Boss 2026 occupies an outward ocean route beyond World 32.
- [x] Teaching locations preserved; no boss castle, island or floating port.
- [x] Staged visibility at 14/15/16 and 30/31/32, with mature QA previews.
- [x] Impressive cloud eye/vortex/particles visible from globe overview.
- [x] Focused storm has readable ship, waves, rain/spray and local lightning.
- [x] Both storms visually accepted on desktop and phone, day/night.
- [x] Fallback, pause/reduced motion and hidden/offscreen behavior verified.
- [x] Voyage arrival/cancel/reload and real locks/progress verified.
- [x] Whole-test workbooks still print all 24 original questions.
- [x] Meaningful geometry/progression/resource tests, full check and performance pass.
- [ ] Commit intended files, fetch/integrate main and guarded fast-forward push.
- [ ] Exact-commit Pages deployment succeeds and public game is verified.
- [ ] Safely mirror changes and archive evidence; final release receipt recorded.

## Evidence and decisions

- Geometry passes all 561 voyage pairs. Teaching centers/harbors unchanged.
- First storm radius .19 rad at 42°N, 179°W; final .23 rad at 27°S, 4°E.
- Five marine pockets moved to clear new sea lanes and full storm disks. All
  25 footprints remain clear of land/harbors/each other; geometry+marine14tests pass.
- First integrated preview3307 has no shader/browser errors at1440/390.
  Root and renderer review found the clouds too regular/tubular; organic billow
  and cirrus refinement is underway. Ship sail contrast also being improved.
- Root harbor/ship4tests pass; renderer4tests pass; UI10focusedtests pass.

- Final organic cloud geometry replaces the initial regular tubes. Broad cloud
  deck, irregular spiral ridges, clear eye and feathered edges accepted in the
  running app at1440/390 day/night and globe overview. Both storms together use
  119,240 triangles and six draws per visible storm; CPU volume data is cached.
- Cloud/rain/spray/foam rotation signs verified from actual compiled shaders;
  natural animation frames differ and show no depth or browser errors.
- Camera presets blend through both departure and arrival. Companion stays seated
  and scales with the boat. Both natural storm trips, cancel, onward17 and reload
  passed; destinations still commit only on arrival.
- Normal browser state checks passed 0/13/14/15/16/29/30/31/32. QA keeps earned
  completion empty. Direct boss URLs focus immediately; corrected still-SVG phone
  fallback, print control and return32 passed with no overflow.
- Full final check passes **827 JS +174 Python =1001 tests**, eight existing skips,
  lint, TypeScript and static Pages build. All22 implementation/test hashes frozen
  after the final motion sign correction. Four curriculum/content hashes unchanged.
- Actual night lightning observed naturally at3.348seconds, then both pause and
  reduced motion extinguished it immediately. Workbook/8-cycle resource regression
  passed with one live WebGL context, original24-question prints and earned return.

- Final isolated desktop performance:36frames/1200ms (30fps target), no errors.
  Pause survives reload; reduced-motion, hidden-tab and offscreen checks each
  produce zero draws and resume correctly. No hardware-phone FPS claim is made.
- Final fetch: origin/main still baseline81e9754; no integration changes needed.

## Resume

Read current git status and agent messages, then continue unchecked work.
Distinguish implementation, visual acceptance, deployment and public verification.
Do not claim completion from code presence alone. Update the shared operational
copy with the final release receipt after the committed pre-deploy snapshot.
