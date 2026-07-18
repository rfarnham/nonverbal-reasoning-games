# Adding a game

Each mini-game is one client-side experience with one stable URL. Games share
the catalog and broad accessibility conventions, but should not depend on one
another.

## 1. Create the route

Add a folder at `app/games/<slug>/` containing:

```text
layout.tsx        # route metadata
page.tsx          # game entry point
catalog.tsx       # shelf metadata and game-owned ShelfIcon
Game.tsx          # optional interactive client component
game-data.ts      # authored rounds or pure puzzle generation
game-engine.ts    # optional larger pure puzzle engine
game.module.css   # styles scoped to this game
```

Names can vary when the game is small, but keep logic separate from rendering
once it becomes non-trivial. Keep metadata in the server-rendered layout when
the page or game component uses `"use client"`. Do not add server-only APIs:
GitHub Pages hosts a static export.

## 2. Define the puzzle contract

A new game follows the suite session contract in `AGENTS.md`: a solved visual
example, Campaign and Infinite modes, 12 puzzles at each of Starter, Junior,
Expert, and Wizard, level checkpoints, first-attempt history, mistake
redemption, and adaptive Infinite combo energy.

A puzzle should expose enough data to render the prompt and answer options,
plus exactly one correct answer. Generated puzzles must accept a seed. Tests
must sample at least 400 deterministic seeds per level and prove that:

- exactly one option is correct;
- distractors are genuinely distinct;
- the same seed produces the same puzzle;
- every difficulty remains solvable by its stated rule.
- fingerprints do not repeat within an authored set or Infinite session;
- generation rejects bad candidates within a bounded number of attempts;
- four-choice Campaign answer positions are balanced 3/3/3/3 without adjacent
  repeats or a repeated four-position cycle.

Authored rounds are a good first choice. A generator is worthwhile when it can
guarantee those properties, not merely produce more combinations.

## 3. Make it a browser app

Put `"use client"` at the top of the interactive component. Keep current-round
state in the game. Use browser storage only for explicitly device-local settings
or progress; the current project has no backend or account system.

The route must remain usable after a hard refresh at its exported directory URL.
Use `next/link` for internal navigation so the GitHub Pages base path is applied.

## 4. Provide the shelf entry

Export a typed `gameInfo` object and `ShelfIcon` component from `catalog.tsx`.
The slug and route are derived from the game directory, so do not repeat them in
metadata. The icon must be code-native, self-contained, and make no network
requests.

The standard project commands discover every `app/games/<slug>/` directory that
contains both `page.tsx` and `catalog.tsx`, then generate the shelf registry.
There is no shared catalog list to edit. Add `catalog.tsx` only when the complete
game and all checks are ready to ship; an incomplete implemented route fails the
build rather than disappearing silently.

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
Check the generated home-shelf card, its game-owned icon, and a hard refresh of
the game URL.
