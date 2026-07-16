# Adding a game

Each mini-game is one client-side experience with one stable URL. Games share
the catalog and broad accessibility conventions, but should not depend on one
another.

## 1. Create the route

Add a folder at `app/games/<slug>/` containing:

```text
page.tsx          # route metadata and the game entry point
Game.tsx          # interactive client component
game-data.ts      # authored rounds or pure puzzle generation
game.module.css   # styles scoped to this game
```

Names can vary when the game is small, but keep logic separate from rendering
once it becomes non-trivial. Do not add server-only APIs: GitHub Pages hosts a
static export.

## 2. Define the puzzle contract

A puzzle should expose enough data to render the prompt and answer options,
plus exactly one correct answer. Generated puzzles must accept a seed. Tests
should sample representative seeds and prove that:

- exactly one option is correct;
- distractors are genuinely distinct;
- the same seed produces the same puzzle;
- every difficulty remains solvable by its stated rule.

Authored rounds are a good first choice. A generator is worthwhile when it can
guarantee those properties, not merely produce more combinations.

## 3. Make it a browser app

Put `"use client"` at the top of the interactive component. Keep current-round
state in the game. Use browser storage only for explicitly device-local settings
or progress; the current project has no backend or account system.

The route must remain usable after a hard refresh at its exported directory URL.
Use `next/link` for internal navigation so the GitHub Pages base path is applied.

## 4. Register it

Add title, slug, status, description, and trained skills to `lib/games.ts`. Mark
the entry `live` only when a complete round and all checks pass.

## 5. Accessibility and input

- Use real buttons for answer choices.
- Provide a visible focus state and meaningful accessible names.
- Support keyboard activation without duplicating native button behavior.
- Use shape, label, or icon changes in addition to color for feedback.
- Keep touch targets at least 44 by 44 CSS pixels.
- Respect reduced-motion preferences.
- If equivalent screen-reader play would undermine an inherently visual task,
  describe the task honestly instead of leaking the answer through alt text.

## 6. Verify

Run:

```bash
npm run check
```

Then complete at least one round with keyboard, touch-sized controls, and mouse.
Check both the home catalog link and a hard refresh of the game URL.
