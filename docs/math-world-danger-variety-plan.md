# Danger variety and relevance

Requested: add fog banks, drifting icebergs and reef passages, and make dangers appear only when their crossing is imminent.

## Contract

- Keep 16 crossings after the same even-numbered teaching worlds and preserve both full-test hurricane bosses.
- All six danger kinds get distinct globe scenery, map symbols and illustrated manuscript introductions.
- Glacier/iceberg passages use the existing northern and southern ocean pockets; coordinates and boat routes stay stable.
- In normal play, no danger appears before all stops of its preceding archipelago have been completed. Only the next due crossing appears, with a four-second reveal on the existing scenery clock.
- Completing or passing that crossing removes it from the globe immediately; reviewing an old coast does not bring old dangers back. Printed packets and miss history remain intact.
- QA still unlocks every destination. Selecting a danger previews only that danger; selecting a teaching world follows actual progress. It no longer paints all 16 threats at the start.
- Paused/reduced scenery, offscreen/hidden maps and fallback views obey the same relevance rules. Scenery never determines navigation, answers or progress.

## Checklist

- [x] Audit existing behavior: unlocked old dangers persisted; completed danger strength was 0.35; QA displayed all 16.
- [x] Parallel renderer, illustrated-page and independent lifecycle test work.
- [x] Add all six kinds and captions, with geography-aware iceberg placement.
- [x] Integrate relevance and shared-clock reveal; remove old threats in WebGL and fallback.
- [x] Verify all 32 progress boundaries, each final stop, skipped/legacy saves, paused/reduced states and QA preview.
- [x] Browser and visual QA, including new day/night/mobile art and actual final-stop completion.
- [x] Full check on latest main: lint, typecheck, Pages build, 954 JavaScript tests and 184 Python tests; 8 existing skips, no failures.
- Publication and exact production verification are recorded in the post-deployment receipt below (written after this source commit).

Release evidence will be stored under `work/math-world-danger-variety-2026-09-30/`, with a post-deployment receipt and completed checklist.

## Verification completed locally

- 15 independent lifecycle/reveal tests cover every 0–32 completion boundary, partial summits, old saves, packet completion, QA previews and the shared scenery clock.
- 8 globe tests cover the six kinds, sea/land clearance, a free center for the ship, smooth arrival, lighting, pause and disposal. Shared geometry remains within the existing budget: 53 draw calls and 54,856 triangles.
- Chrome verified the actual last-answer → Finish stop → danger reveal → review completion → calm sea flow, plus fresh maps, selected QA previews, and the cleared 390px fallback.
- All three new models were inspected in daylight, at night and at 390px. Paused canvas snapshots are identical and no horizontal overflow or browser/shader errors were found.
- All three new manuscript pages and the existing squall passed at 1280px and 390px: complete decoded art, readable prose, working controls, no overflow or browser errors.
