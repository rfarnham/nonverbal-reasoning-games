# Math World living-world polish — working plan

Updated: 2026-09-25. Status: **implemented and locally verified; publication in progress**.

Read this file after compaction. Latest deployed baseline is
`9d970ae0350bebaa9d35d6eb7878328cda7a971b` (corrected celestial reference frame).
Its completed receipt is in shared `work/math-world-celestial-motion-2026-09-25/`.

## Requested outcomes

1. More frequent lightning, distributed across the swirling hurricane.
2. Recognizable rabbits, deer herds and grazing animals on the mainland;
   sculpted silhouettes, not arbitrary blocks.
3. Mountains, creeks and richer geography on the non-playable continents.
4. Smooth boat pathing and continuous voyage speed.
5. Continuous navigation through both poles using quaternion orientation.
6. Convincing water with cohesive color, reflection and fine ripples rather
   than a mottled colored sphere.
7. More discoverable schools of fish.
8. Tiny flowers as natural landscape details.

## Workspace and ownership

- Worktree: `/private/tmp/spatial-gym-coast-preview`.
- Branch: `codex/living-world-polish`; baseline `9d970ae`.
- Shared workspace is dirty. Never reset or commit unrelated work; mirror only
  intended files still matching baseline or our own changes.
- Root: marine expansion, integration, external checklist, browser/performance
  checks, final repository check, release and public verification.
- `navigation_polish`: GlobeBoard, globe-scene camera, route geometry and new
  quaternion/route helpers plus tests. Owns scene edits to prevent conflicts.
- `mainland_life`: continents, mainland terrain/fauna/flowers modules and tests.
  Preserve coastlines and route envelopes; integrate through continent renderer.
- `storm_water_polish`: storm renderer/lightning and ocean shader plus tests.
- QA: `/private/tmp/math-world-polish-qa`, planned static preview port3310.
- Evidence: shared `work/math-world-polish-2026-09-25/`.

## Implementation contracts

- Every effect uses the existing scenery clock and owned fixed GPU resources.
  Preserve pause/reduced motion/hidden/offscreen suspension and disposal.
- Preserve all questions, progress, locks, workbooks, stop/book placement and
  original crop assets. No external runtime services or assets.
- Free orbit composes quaternions without latitude clamp. Parallel-transport
  the voyage view; focused arrivals restore their authored frame smoothly.
- `getVoyageRoute` must return the actual rounded samples. Every segment must
  preserve full-hull land clearance, exact docks, cancellation and replay.
- Remove the mid-voyage ease/stop when no mini-game interrupts the crossing.
- Storm lightning is local and alternates through spiral-band cells. Target
  roughly one strike every1.8–2seconds at full strength, with local cloud glow;
  no global flashing. Pause/reduced motion extinguish strikes immediately.
- Ocean remains one draw. `sea.update` adds an optional fourth argument,
  `lighting.sunDirection`, passed by the navigation agent in globe-scene.
- Continents keep update/dispose APIs. Fauna and flowers avoid playable
  controls while remaining visible around the foreground and on mainlands.
- Expanded fish schools keep bounded silhouettes inside tested ocean pockets,
  clear of storms, ports, neighbors and canonical boat routes.

## Checklist

- [x] Isolated branch, source audit, owners and external plan established.
- [x] Storm strike frequency and azimuth/radius distribution visibly improved.
- [x] Animal shapes recognizable in close inspection and natural tiny herds.
- [x] Mainlands show varied mountain ridges, valleys, creeks and flowers.
- [x] More visible fish schools with verified water/route clearance.
- [x] Ocean improved in day/night, overview/close view, including polar views.
- [x] Boat speed/heading continuous; safe bends; no artificial midpoint stop.
- [x] Drag/keyboard can cross both poles with continuous camera orientation.
- [x] Desktop/390px motion and visuals accepted in actual app.
- [x] Pause/reduced/hidden/offscreen, resource/lifecycle and performance pass.
- [x] Existing progression, voyage, prints and content regressions pass.
- [x] Full check on frozen source passes; intended files enumerated for commit.
- [ ] Latest main integrated, guarded push, exact-commit Pages succeeds.
- [ ] Public catalog/game verified, files mirrored, evidence/receipt archived.

## Verified implementation

- Mainland: 124 sculpted deer, rabbits and sheep across six continents; four
  added merged draw batches, roughly 120k life-detail triangles. All six focused
  geometry/ecology tests pass, including exposed rivers and stop clearances.
- Fish: 336 swimmers in 28 schools (was 84 in 12), still eight marine draws;
  all rendered footprints stay in tested ocean pockets clear of canonical routes.
- Navigation: retained planet-to-view quaternion, screen-axis drags, slerped
  focus/arrival, parallel-transported voyages, continuous preset sunlight at poles.
  GPU tracing also exposed wall-clock catch-up after slow frames; navigation now
  advances at most 40ms per delivered frame, with angular-distance transition
  durations and a 1600ms inactivity watchdog. The unchanged browser pose-step
  acceptance must pass on the final snapshot.
- Routes: all 561 pairs pass full-hull clearance and direction continuity; worst
  sampled heading change is 0.73 degrees. One continuous speed envelope per trip.
- Storms: roughly 29–33 localized strikes per minute, visiting inner/outer rain
  bands; six draws per storm. Ocean: coherent color, analytic irregular ripple gradients,
  view/sun-aware reflection, derivative filtering, one draw.
- Integrated regression passed: both original boss test workbooks, 24-question
  world workbook, earned-stop return/unlock, voyage cancellation, eight question
  remounts with exactly one live WebGL context and preserved scenery clock.
- Preview transport failures were local Python server backlog resets, fixed by
  a 128-connection backlog and quiet access logs. Not application failures.
- The first check was stopped after lint/typecheck and compilation for one
  final visual refinement: replacing periodic wave normals removed a woven sun
  reflection. The approved analytic-noise variant is frozen; the final full
  check was paused again for the observed slow-frame navigation fix. All source
  is now frozen; the final full check and final-snapshot UI QA are pending.
- Controlled Apple M2/ANGLE Metal comparison at identical 1278×700 canvas:
  public baseline 11.3–13.0fps, local 11.0–11.3fps; omitting fauna gave
  12.0–12.3fps. The new life costs about 1fps here; the lower rate versus an
  older 30fps report already exists on current public. No rendering errors.
  Preserve this measured limitation; do not claim universally smooth 30fps.

## Baseline findings and resume notes

- GlobeBoard currently clamps latitude to±1.35 and scene rebuilds north-up
  every frame. This loses continuous roll through the poles.
- Sailing separately eases0→.5 and.5→1 even without a mini-game, creating an
  unnecessary middle stop. Current polyline corners also turn abruptly.
- Existing fish:12schools×7fish=84. Existing marine module has8draws; retain
  batching while expanding both school density and geographic coverage.
- Existing lightning pulses only every19/23seconds from a fixed cell.
- Existing ocean multiplies diffuse color with coarse3D noise; replacement
  should put detail in surface normals/reflection instead of broad color spots.
- Baseline full check:840JavaScript+174Python tests pass,8existing skips.
- Do not claim visual completion from source alone. Compare running-app
  desktop/phone and real motion before release.

## Final local verification

- `npm run check` passed: 855 JavaScript tests plus 174 Python tests; eight
  existing skips. Lint has zero errors and only the 59 existing warnings in
  the vendored handwriting runtime. Static GitHub Pages export passed.
- Final navigation browser trace passed unchanged 0.12-radian step acceptance:
  263 rendered poses over 11.31 seconds, largest step 0.07755 radians despite
  a 251ms stall (before frame handling: 0.6463 radians). Natural arrival, cancel,
  skip, reduced-motion arrival, phone polar controls and focus restore passed.
- All 32 teaching worlds, 680 teaching questions and two original-test bosses
  retain their original source hashes. No curriculum or workbook changes.
- Publication and exact commit receipt will be recorded in the shared evidence
  directory after GitHub Pages and the public hard-refresh checks succeed.

Final integrated water and storm views passed on the frozen export: five
observed strikes in distinct cells, visible local forks/glow, natural irregular
water reflections in day/night and desktop/phone views, zero browser/WebGL
errors. Pause/reduced motion extinguishes flashes immediately.
