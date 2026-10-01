# Oceania hurricane chapter illustrations

Created 2026-09-30 using the imagegen skill's **built-in `image_gen.imagegen` mode**, with one generation for each distinct illustration. No fallback CLI/API or runtime media service is used. The paintings are bundled with the application.

## Content and use

- Authored chapters: `app/math-world/boss-story-content.ts`.
- Export: `BOSS_STORIES`, keyed by `boss-2025` and `boss-2026`, conforming to the existing `StoryPageProps["page"]` contract through a type-only import.
- Each chapter has exactly two short paragraphs. The first describes the storm and the current point in the voyage; the second invites the child to print the complete 24-question test and work with pencil and paper at their own pace.
- The 2025 chapter follows archipelago 16. The 2026 chapter follows archipelago 32, leaving the final destination and ending unwritten.
- Preserve each painting's full 3:2 proportions in the manuscript scroll. Use the app's asset base path on GitHub Pages, as with the other danger stories.
- These illustrations describe imposing story weather. They add no countdown, lost lives, scoring change, or punishment.

## Saved assets and provenance

Both assets are 1536×1024 WebP files, encoded with Sharp at quality 88 and effort 6. Encoding did not resize, crop, composite, or otherwise alter the generated composition. Combined payload: 960,484 bytes (approximately 0.92 MiB). Only the current chapter's artwork needs to load.

| Chapter | Workspace asset | Bytes | Original generated PNG |
| --- | --- | ---: | --- |
| 2025 hurricane | `public/math-world/stories/hurricane-2025.webp` | 517768 | `/Users/rfarnham/.codex/generated_images/01a0f436-3c27-7ea0-9208-3d1b932bf756/exec-c5286747-4c30-49d9-b028-34cd6bf81fd7.png` |
| 2026 hurricane | `public/math-world/stories/hurricane-2026.webp` | 442716 | `/Users/rfarnham/.codex/generated_images/01a0f436-3c27-7ea0-9208-3d1b932bf756/exec-71064b0e-1a02-4e89-928c-753f151233c0.png` |

Final worktree paths:

- `/Users/rfarnham/.codex/worktrees/ocean-danger-reviews/Nonverbal Reasoning Games/public/math-world/stories/hurricane-2025.webp`
- `/Users/rfarnham/.codex/worktrees/ocean-danger-reviews/Nonverbal Reasoning Games/public/math-world/stories/hurricane-2026.webp`

The original PNG files remain in Codex's generated image directory.

## Visual inspection

- Both generated paintings were inspected at full resolution before encoding. Each has a coherent, huge horizontal spiral storm with sculpted cloud bands, an open eye, scattered lightning, rain curtains, and detailed ocean waves.
- The small intact wooden ship, cream sails, brass details, and cyan bow lantern connect them to the existing danger illustration series. The storms are much larger and more organized than the localized squall.
- The 2025 composition places the boat at lower left in turquoise dawn light. The 2026 composition places the boat at lower right under violet dusk clouds. Neither depicts the restoration of the Tideheart or invents a final destination.
- No generated text, watermark, UI, page frame, gore, or ship destruction is present.
- The WebP outputs retain the full composition and intrinsic dimensions. Story rendering should contain the image, not crop it into the old narrow line-art slot.

## Browser verification

Both chapters passed local browser checks at 1280×960 and 390×844. The images load at their authored 1536×1024 dimensions and use contain fitting; the complete paintings remain visible. Prose uses 18px text on desktop and 16px on mobile, with roomy line spacing. The manuscript scroll remains within the viewport, with no horizontal overflow and a full-size, reachable “Prepare for the storm” control. Heading focus and read-state persistence after a hard refresh both passed. No browser console, page, or asset errors were reported. Top and bottom screenshots for all four cases were visually inspected.

The replay script and evidence are in `/private/tmp/hurricane-library-art-qa/`. Its `BASE_URL` and `OUTPUT_DIR` environment variables allow the same checks against the production base path after deployment.

## Exact generation prompts

### Hurricane 2025

```text
Use case: illustration-story. Asset type: a landscape painting for the illustrated manuscript story page before the first hurricane challenge in the Oceania nautical adventure game. Generate exactly a 1536 x 1024 wide 3:2 landscape painting, no text.
Scene: an immense tropical hurricane over an enchanted blue-green ocean. A high oblique panoramic view shows enormous curved spiral rain bands and sculpted indigo cloud walls circling a luminous open eye, the entire storm occupying much of the horizon. This is a huge horizontal atmospheric hurricane with a clearly readable spiral structure, not a tornado, waterspout, small thundercloud or water whirlpool. Distant green archipelagos at the far edges establish scale. Branching silver-blue lightning glows in several widely separated rain bands; wind drives fine spray and curling crests across the near sea.
Subject: in the lower left foreground one small sturdy wooden sailing boat, warm detailed timber hull, cream canvas sails partly reefed for the wind, brass details and a tiny glowing cyan crystal lantern at its bow. The boat stays intact and safely afloat, riding the outer swell, readable and gracefully modeled. No people necessary.
Style: premium richly painted illustrated adventure storybook, elegant ink-and-gouache detail, textured brushwork, cinematic atmospheric depth. Sophisticated, enchanting and adventurous, not babyish. Exquisite cloud sculpting and translucent wave foam. Jewel turquoise and ultramarine, cool violet-gray hurricane clouds, parchment-warm dawn light breaking through the far eye and horizon. Hopeful peril.
Composition: wide scene, boat lower left large enough to read, huge coherent storm spiral dominates upper middle and right, open sunlit water visible beyond. All important subjects within central 85% of frame. Edge-to-edge painting only, not a picture of a page or book.
Constraints: no text, lettering, logo, watermark, borders, page furniture, human characters, wreckage, torn sails, destruction, gore, castles, cartoon faces or victory imagery.
```

### Hurricane 2026

```text
Use case: illustration-story. Asset type: a landscape painting for the illustrated manuscript story page before the second hurricane challenge in the Oceania nautical adventure game. Generate exactly a 1536 x 1024 wide 3:2 landscape painting, no text.
Scene: far out on the open ocean beyond the last familiar archipelago, an immense hurricane turns under a violet dusk sky. Seen from a high oblique panoramic angle, great sweeping spiral bands of dark blue cloud and silver rain curl around a deep open eye with a warm peach-gold glow beyond. The storm has astonishing depth: outer rain curtains over the sea, tall luminous cloud ridges, and many distant delicate lightning forks spread across different spiral bands. A huge horizontal atmospheric hurricane, never a tornado, waterspout, small thundercloud or water whirlpool. The near ocean is rich sapphire with luminous turquoise crests, scattered spray and finely painted white foam. Only a few distant tiny rocky islands far behind at the edge; the horizon ahead remains open and unknown, no new destination or city.
Subject: one small sturdy intact wooden sailing boat rides the outer swell in the lower right foreground, heading toward open water beside the immense storm. Warm detailed timber hull, cream canvas sails partly reefed for the wind, brass details and one softly glowing cyan crystal lantern at the bow. Boat remains safely afloat and clearly legible; no people needed. This is another chapter of a hopeful nautical adventure, not an ending.
Style: premium richly painted illustrated adventure storybook, elegant ink-and-gouache detail, textured brushwork and cinematic atmospheric depth. Sophisticated and enchanting, not babyish. Coherent exquisite cloud sculpture, convincing wave relief, subtle electric-blue lightning reflected in wet water, gentle warm light along the storm's rim. Compatible with a sunlit hurricane painting featuring the same cream-sailed wooden boat and cyan lantern, but a distinct composition and dusk palette.
Composition: wide landscape, boat lower right large enough to read, massive flowing storm spiral dominates upper middle and left, distant open horizon behind. Important subjects within central 85% of frame. Edge-to-edge art only, not a page or book.
Constraints: no text, lettering, logo, watermark, borders, page furniture, human characters, wreckage, torn sails, destruction, gore, castles, cartoon faces, triumphant victory scene or completed crystal.
```
