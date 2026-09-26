# Math World celestial scenery — working plan

Updated: 2026-09-25. Status: **implementation and local verification complete; ready to publish**.

Read this file after compaction. Previous hurricane release is deployed at
`7b127db59d9beedb63aebe8a3fcd764d5651ca3d`.

## Product decisions

- Add a static celestial sphere with varied stars, luminous nebula clouds,
  dust lanes and dark space. Fixed directions, no drifting star wallpaper.
- Stars and nebula appear only once the inspected coast is on the night side;
  fade smoothly during the automatic day/night cycle and disappear in Day/Sunset.
- Add an oversized physical moon on an inclined orbit around the planet.
  Actual shared sun direction and camera position determine the visible phase.
  The moon remains visible by day as well so every physical phase is available.
- Model crater bowls, raised rims, maria and highlands. Low-angle sun should
  reveal relief, with restrained earthshine preserving the dark silhouette.
- Use the existing scenery clock: pause/reduced motion/hidden/offscreen must
  freeze orbit; explicit navigation and sky selection may still redraw.
- All resources local/procedural, fixed allocations, safe disposal. No changes
  to curriculum, workbooks, questions, saved progress or locks.

## Workspace and ownership

- Worktree: `/private/tmp/spatial-gym-coast-preview`.
- Branch: `codex/celestial-night-sky`; baseline `7b127db`.
- Shared workspace is dirty; never reset or commit unrelated work there.
- Root: lighting integration, visibility helper/tests, durable plan, final
  visual review, full checks, release and public verification.
- `celestial_sky`: `globe-celestial-sky.ts`, procedural sky and focused tests.
- `lunar_scene`: `globe-moon.ts`, crater relief, orbit/phase helpers and tests.
- `celestial_qa`: independent math review and actual-app browser/motion/resource QA.
- QA: `/private/tmp/math-world-celestial-qa`, static preview port 3308.
- Durable evidence: shared `work/math-world-celestial-2026-09-25/`.

## Integration contracts

- `createGlobeCelestialSky(scene, camera)` returns
  `update(seconds, nightVisibility)` and `dispose()`.
- `createGlobeMoon(scene, globe, camera, anchor)` returns
  `update(seconds, sunDirection, nightVisibility)` and `dispose()`.
- Sun direction is globe-local. Moon orbit transforms through globe quaternion;
  moon surface light uses the same transformed sun as the globe.
- Sky is scene-owned, camera-centered for no parallax, fixed world orientation;
  it renders behind the planet and moon with depth preserved.
- Lighting owns both renderers and disposes them. No new animation loops.

## Checklist

- [x] Durable plan, branch and ownership established.
- [x] Static night-only celestial sphere with varied stars and nebula.
- [x] Orbiting cratered moon with physically consistent phase and sun lighting.
- [x] Integrate visibility/clock/cleanup and remove legacy flat star field.
- [x] Inspect desktop and phone: day, sunset, night, overview and focused coast.
- [x] Validate full/quarter/crescent relief and planet/moon depth occlusion.
- [x] Pause/reduced-motion/hidden/offscreen, resources and performance verified.
- [x] Full repository check passes; question/curriculum content unchanged.
- [ ] Commit intended files, integrate latest main, guarded fast-forward push.
- [ ] Exact-commit Pages deployment succeeds; public game verified.
- [ ] Mirror intended files safely and archive evidence/final receipt.

## Resume notes and evidence

- Camera far plane is 12; sky sphere radius 9. Moon radius .19, orbit radius
  1.9, period 224 seconds planned. These are stylized proportions.
- Night preset puts the sun behind the inspected coast, so the physical moon
  naturally favors crescents. Do not fake a phase overlay or separate sun.
- Prior check baseline: 827 JavaScript + 174 Python tests, 8 existing skips.
- Release workflow is `.github/workflows/deploy-pages.yml`; deployment is
  required by AGENTS.md, and the public Math World route must be smoke-tested.

- Initial actual-app QA passed 13 desktop/390px captures with no browser/shader
  errors. Day ~29.2fps, night ~28.6fps (same30fps cap). Repeated sky changes
  allocate no extra GPU resources; sky corner pixels stay identical as the globe
  rotates. Pause/reduced-motion/hidden/offscreen all stop draws and resume safely.
- Regression passed original 24-question world workbook and both whole-test
  workbooks; eight question/map cycles leave one live WebGL context and preserve
  the scenery clock/night mode. Earned stop unlock and voyage cancellation pass.
  All four curriculum/content hashes remain unchanged (32worlds/680questions).
- First integrated moon was near-new by default. Final visual refinement moves
  its fixed starting orbit to upper-left to expose ~14% crescent under the same
  Night sun. Moon geometry also averages seam/pole normals. Rebuild and review
  final desktop/phone night before full check/release.

- Final rebuilt app accepted at1440/390. Moon now starts upper-left with a
  readable illuminated arc and clear frame/planet separation. Final source has
  no browser/shader errors; private full/quarter/crescent/new renders match
  expected illumination1/.5/.1/~0. Independent sun/orbit/observer math passes.
- `npm run check` passed: lint, TypeScript, static Pages build,837JavaScript
  tests (8existing skips),174Python tests. Total1,011passing tests. Main fetched
  unchanged at baseline7b127db, so no integration changes or repeated check needed.
- Evidence reports: `celestial-app-report.json`, `remaining-report.json`,
  `independent-moon-math.json`, `final-celestial-visuals-report.json`,
  `check-final.log`. Final release receipt will be recorded in shared docs and
  `work/math-world-celestial-2026-09-25/` after public verification.
