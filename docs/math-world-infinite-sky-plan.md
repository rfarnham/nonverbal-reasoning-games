# Infinite celestial sky — working plan

> The 30 September 2026 overview design supersedes this historical plan’s
> planet-bound sky motion and night-only visibility. The current contract is in
> [globe navigation](math-world-globe-navigation.md): fixed stars, rotating
> overview planet, independent moon, and atmosphere on close approach only.

Updated: 2026-09-27. Status: implementation and local validation complete; ready to publish.

## Request and finding

All stars and the nebula must be at infinity. The shipped camera-centered
sphere already canceled translation mathematically; there is no evidence that
ordinary translation parallax caused the reported impression. Camera tilt
during zoom, globe navigation and the daily cycle legitimately rotate the sky.
The finite sphere did have a depth edge case at extreme narrow aspect ratios:
it could sit in front of more distant foreground geometry.

## Implementation

- Use one shared direction-only vertex projection for stars and nebula.
- Discard model/camera translation and set clip-space depth to `w` (NDC z=1).
- Keep depth testing, disabled depth writes, catalogue, point sizes, quaternion
  reference frame, night visibility, pause behavior and finite moon unchanged.
- Retain two draws and existing resource ownership; add no runtime dependency.

## Checklist

- [x] Inspect deployed source and independently audit translation cancellation.
- [x] Replace both finite projections with shared infinity projection.
- [x] Correct finite-sphere documentation and misleading test descriptions.
- [x] Actual WebGL: fixed orientation/time/FOV gives identical pixels through
  camera translation, independently for stars and nebula.
- [x] Actual WebGL: rotation changes the sky; foreground beyond the old sphere
  still occludes both layers. Confirm regression sensitivity against baseline.
- [x] Full `npm run check` and local app desktop/phone smoke checks.
- [ ] Commit only intended files, fetch/integrate main and guarded release.
- [ ] Exact-commit Pages workflow and public catalog/game verification.
- [ ] Archive evidence and safely mirror intended files to shared workspace.

## Resume information

- Worktree: `/Users/rfarnham/.codex/worktrees/celestial-infinity/Nonverbal Reasoning Games`.
- Branch: `codex/celestial-infinity`; baseline: `b9893ec`.
- Shared workspace has unrelated local changes; preserve them.
- Evidence: `/private/tmp/math-world-infinity-qa`; durable copy goes to shared
  `work/math-world-infinity-2026-09-27/`.
- Root owns source, full checks, deployment and public QA.
- `sky_parallax_audit` owns independent actual-shader WebGL validation.

## Validation evidence

- Actual source compiled in WebGL: 24/24 checks pass, zero browser/shader errors,
  two draw calls. Fixed-time translation up to 100,000-scale coordinates changes
  zero pixels. Rotation changes each layer as expected.
- Baseline negative control: 18/24 checks pass; the old sky incorrectly covers
  opaque geometry at distance 11, beyond its radius 9. The fixed sky preserves
  foreground occlusion at both tested distances (2 and 11).
- Baseline and final normal-view PNG hashes match exactly for stars, nebula and
  their combination. This is a depth guarantee, not evidence of prior ordinary
  translation parallax or a change to the intended angular motion.
- Local application smoke checks pass at 1440px and 390px: actual compiled sky
  shaders, overview/focus/navigation, night/day, reduced motion, scenery pause,
  stop entry/return, gate cookie, hard refresh and normal progression locks.
  No console errors or failed responses. Local preview's known canonical favicon
  URL is the only cross-origin request; it is same-origin in production.

- Full repository check passes: lint (59 existing vendored-runtime warnings),
  TypeScript, production export, 855 JavaScript tests (8 existing skips) and
  174 Python tests. No curriculum or question-data files changed.
