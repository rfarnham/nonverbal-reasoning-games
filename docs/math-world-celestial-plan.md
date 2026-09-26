# Math World celestial scenery — working plan

Updated: 2026-09-25. Status: **correction complete and locally verified; ready to publish**.

Read this file after compaction. The first celestial release is deployed at
`e7252fddc66ba99a4ccf9729f5ebfa8772eaf839`; its completed receipt and visual
checks are in shared `work/math-world-celestial-2026-09-25/`.

## Product contract

- The stars and nebula are fixed relative to each other in inertial space.
  They must move on screen when the planet-bound viewpoint turns or the
  planet's daily rotation advances. They are not screen-fixed wallpaper.
- The previous implementation kept the celestial sphere's scene quaternion
  at identity. This was wrong because navigation rotates the globe rather
  than orbiting the camera. Its old screenshot equality check across navigation
  tested the wrong behavior and has been replaced.
- Both sky layers use one rigid transform: `Qview * Banchor * Ry(daily angle)`.
  `Banchor` is the initial east/north/front basis. This preserves the original
  opening composition. Positive daily rotation matches the automatic sun.
- Daily angle uses the shared active scenery clock and360-second sun cycle.
  In Auto, the sun is constant in celestial coordinates. Day/Sunset/Night
  remain lighting overrides; like the moon's orbit, sky motion continues there.
- Center the sphere on the camera to remove translation parallax. Do not rotate
  the star catalogue independently of the nebula or modify vertex buffers.
- Stars/nebula remain night-only. All sky motion pauses with scenery pause,
  reduced motion, hidden documents and offscreen suspension. Navigation still
  updates perspective while paused.
- Keep the oversized orbiting moon, actual shared-sun phases, displaced crater
  bowls/rims, maria, ejecta and earthshine. No moon changes in this correction.
- Preserve planet depth/occlusion, controls, workbooks, curriculum and progress.
  No additional animation loops, GPU resources or network assets.

## Workspace and ownership

- Worktree: `/private/tmp/spatial-gym-coast-preview`.
- Branch: `codex/celestial-reference-frame`; baseline `e7252fd`.
- Shared workspace is dirty; never reset or commit unrelated work there.
- Root: frame helper/integration, unit tests, plan, release and public verification.
- `celestial_frame_review`: independent math/sign/order review, complete.
- `celestial_motion_qa`: browser motion/navigation/resource/desktop/phone QA.
- QA: `/private/tmp/math-world-celestial-motion-qa`, preview port3309.
- Durable evidence: shared `work/math-world-celestial-motion-2026-09-25/`.

## Current API

- `createGlobeCelestialSky(scene, camera, globe, anchor)` returns
  `update(seconds, nightVisibility)` and `dispose()`.
- `createCelestialFrame(anchor).update(seconds, planetToView, targetQuaternion)`
  samples the apparent sky orientation without per-frame geometry/allocation.
- `getCelestialCycleAngle(seconds)` is shared with automatic sunlight;
  `SKY_CYCLE_SECONDS` remains re-exported from lighting for existing consumers.

## Correction checklist

- [x] Confirm the reference-frame bug and establish independent math review.
- [x] Apply navigation and daily rotation to the complete celestial sphere.
- [x] Keep initial composition and share daily angle with automatic sunlight.
- [x] Test orbit closure/sign, sun invariant, paused navigation and rigid stars.
- [x] Actual-app desktop/390px sky changes during time and globe turns.
- [x] Pause/reduced/hidden/offscreen, night gate and resource behavior verified.
- [x] Full repository check passes; intended source/content scope confirmed.
- [ ] Commit, integrate latest main and guarded fast-forward push.
- [ ] Exact-commit Pages deployment and public browser verification pass.
- [ ] Safe mirror and archive evidence/final receipt.

## Evidence and resume notes

- Independent numerical review found `inverse(Qsky) * Qview * sunLocal(t)`
  constant within1.7e-15. Quarter-cycle sign agrees with existing lighting.
- Eleven focused sky/frame/lighting tests pass. Tests now require apparent
  rotation during navigation and identical poses only at frozen time/view.
- Sky remains two draws with the existing11,800-star catalogue; only its
  quaternion changes. No shader, geometry, moon or scenery-loop edits.
- Full previous release check:837JavaScript+174Python tests passed,8existing
  skips. New correction adds three meaningful reference-frame tests.
- Release is required by AGENTS.md. Follow exact SHA of deploy-pages.yml;
  do not report done before production has been checked.

- Browser review passed on desktop and390px phone: night-sky pixels change
  with navigation and advancing time; identical pixels during pause/reduced
  motion. Navigation remains available while paused. Twelve preset switches
  allocate no GPU resources; hidden/offscreen suspension and night gate pass.
  No browser/shader errors or failed responses.
- Full `npm run check` passes: lint, TypeScript, production export,840JavaScript
  tests (8existing skips),174Python tests. Total1,014passing tests. All four
  question/curriculum hashes remain unchanged. Latest main remains e7252fd;
  no integration change requires repeating those checks.
- Evidence: `celestial-app-report.json`, `mobile-motion-report.json`,
  `independent-browser-review.md`, `content-verification.json`, `check-final.log`.
  Final public receipt will be appended to the shared operational plan/archive.
