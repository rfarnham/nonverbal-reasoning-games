# Oceania danger story illustrations

Created 2026-09-30 using the built-in `image_gen.imagegen` tool, one generation per distinct danger. No external runtime service, remote asset, or text embedded in the art is required. The local source PNGs are retained in Codex’s generated image folder; the project uses full-resolution WebP copies.

## Content and integration

- Authored content: `app/math-world/danger-content.ts`.
- Exports: `DangerKind`, `DangerStoryContent`, and `DANGER_STORIES`.
- Each entry contains exactly two brief narrative paragraphs, plus a local illustration path, intrinsic dimensions, and descriptive alt text.
- Render the image above the prose in the existing manuscript scroll treatment. Preserve the 3:2 image proportions so the boat and the whole danger remain visible; do not crop this art into the older narrow 640×240 illustration slot.
- Apply the app’s asset base path to each `illustration.src` before rendering on GitHub Pages.
- These encounters are patient opportunities for review. The story explicitly permits thinking, drawing, and trying again; it introduces no countdown, lost lives, punishment, or new scoring rule.

## Asset details

All three assets are 1536×1024 and were encoded without resizing or altering the scene, using Sharp WebP quality 88, effort 6. Combined shipped payload: 1,539,462 bytes (approximately 1.47 MiB). Images are loaded when their story is opened rather than eagerly requesting all three.

| Danger | Bundled asset | Bytes | Original generated PNG |
| --- | --- | ---: | --- |
| squall | `public/math-world/dangers/squall.webp` | 441282 | `/Users/rfarnham/.codex/generated_images/01a0f3b3-42ec-7303-b7f1-d4a919739280/exec-6b7dd5c9-ed28-4a28-a9ba-3d41ef3802c3.png` |
| kraken | `public/math-world/dangers/kraken.webp` | 538664 | `/Users/rfarnham/.codex/generated_images/01a0f3b3-42ec-7303-b7f1-d4a919739280/exec-d2006716-5959-41ee-ba3a-96cd1b8e4199.png` |
| maelstrom | `public/math-world/dangers/maelstrom.webp` | 559516 | `/Users/rfarnham/.codex/generated_images/01a0f3b3-42ec-7303-b7f1-d4a919739280/exec-01299d58-4e15-4e32-88a2-c1ab49c57c94.png` |

## Visual inspection

- Squall: compact dark cloud, localized rain and lightning, visible curling wind, open sky beyond. It is visually distinct from the hurricane boss.
- Kraken: coherent enormous central body, intelligent eyes, long curling arms with clearly sculpted suckers, and an intact small ship for scale. No gore or destruction.
- Maelstrom: water and foam visibly spiral down into a deep center, with the ship on the outer edge. It is distinct from an atmospheric tornado.
- All three share the warm timber vessel, cream sails, cyan crystal lantern, jewel-colored sea, distant archipelagos, and hopeful sunlight. No generated text, watermark, frame, or page furniture appears in the paintings.
- Full-resolution generated outputs were visually inspected. WebP encoding preserves the approved composition and pixel dimensions.

## Exact generation prompts

### squall

```text
Use case: illustration-story. Asset type: a landscape illustration for the top panel of a beautifully styled manuscript scroll story page in the Oceania nautical adventure game. Generate a wide 3:2 landscape painting, no text.
Scene: a small localized squall crosses a luminous turquoise sea between distant green archipelagos. A compact towering indigo cloud with luminous silver edges hangs low over the water, thin branching lightning beneath it, visible curling wind and diagonal fine rain in a contained patch. Blue sky and warm light remain beyond the cloud: this is a small squall, distinctly not a hurricane.
Subject: one small sturdy wooden sailing boat with cream canvas sails, warm timber hull, brass details and a tiny softly glowing cyan crystal lantern at the bow. Its sails lean with the gust as it approaches the edge of the storm; the hull is safely afloat. No people are necessary.
Style: premium richly painted illustrated adventure storybook; elegant ink-and-gouache detail, textured brushwork, cinematic depth, saturated ocean blues and sea greens balanced with parchment-warm sunlight. Sophisticated, enchanting and adventurous, not babyish. Cloud sculpting, wave foam and the boat should be exquisite and physically legible.
Composition: landscape, boat large enough to read in the lower left third, storm cloud dominating upper middle and right, luminous open water leads the eye toward a safe bright horizon. All important subjects inside central 85% of frame. Edge-to-edge art, not an image of a book or UI. No page, decorative frame, lettering, symbols, signature, logo, watermark or embedded text. Hopeful peril, no destruction or gore.
```

### kraken

```text
Use case: illustration-story. Asset type: a landscape illustration for the top panel of a beautifully styled manuscript scroll story page in the Oceania nautical adventure game. Generate a wide 3:2 landscape painting, no text.
Scene: the enchanted turquoise ocean at late golden afternoon, with distant hazy emerald archipelagos. An enormous majestic kraken rises from the deep beside one small sturdy wooden sailing boat. The kraken is a believable giant octopus/squid creature with a beautifully modeled central head, intelligent deep golden eyes, many strong curved tapering tentacles with clearly sculpted rows of pale suction cups. Its violet, teal and coral skin catches luminous water reflections; some tentacles arch gracefully above the surface and others vanish into the depths. One tentacle curls near the vessel without breaking it. Its size makes clear it could swallow a ship; mysterious and imposing, never cartoon-cute or gory.
Boat: warm timber hull, cream canvas sails, brass details and a tiny softly glowing cyan crystal lantern at its bow, hull safely afloat, no people necessary.
Style: premium richly painted illustrated adventure storybook; elegant ink-and-gouache detail, textured brushwork, cinematic depth. Sophisticated, enchanting and adventurous, not babyish. Meticulous water foam, tentacle anatomy and sculpted creature contours.
Composition: landscape, boat in lower left third, immense kraken center and right in a natural coherent silhouette, tentacles framing rather than hiding the boat, warm horizon behind. All important subjects inside central 85% of frame. Edge-to-edge art, not an image of a book or UI. No page, decorative frame, lettering, symbols, signature, logo, watermark or embedded text. Hopeful peril, no destruction or gore.
```

### maelstrom

```text
Use case: illustration-story. Asset type: a landscape illustration for the top panel of a beautifully styled manuscript scroll story page in the Oceania nautical adventure game. Generate a wide 3:2 landscape painting, no text.
Scene: a dramatic ocean maelstrom between remote misty green archipelagos. Seen from an elevated oblique angle, vast spiral streams of turquoise water and luminous white sea foam curl down into a deep midnight-blue central hollow. Clearly water flowing inward and downward, with convincing depth and circular motion, wet translucent ridges and delicate spray in afternoon light. A maelstrom, not an atmospheric tornado and not a hurricane cloud.
Subject: one small sturdy wooden sailing boat rides the outer rim in the lower left foreground, still safely afloat and pointed along the arc. Warm timber hull, cream canvas sails, brass details and a tiny softly glowing cyan crystal lantern at its bow. No people necessary. Emphasize the size difference between the boat and the swirling water.
Style: premium richly painted illustrated adventure storybook; elegant ink-and-gouache detail, textured brushwork, cinematic depth. Sophisticated, enchanting and adventurous, not babyish. Beautifully painted water geometry, lace-like foam and bold sculptural depth. Jewel turquoise and ultramarine with parchment-warm sunlight.
Composition: landscape, great vortex center and right, boat separated clearly on the near left edge, open warm horizon at top. All important subjects inside central 85% of frame. Edge-to-edge art, not an image of a book or UI. No page, decorative frame, lettering, symbols, signature, logo, watermark or embedded text. Hopeful peril, no destruction or gore.
```

