# Contributing

Thanks for helping make visual-spatial practice more useful and more fun.

## Before starting

- Open an issue before a large new game or architectural change.
- Keep a game focused on one primary reasoning skill.
- Do not add tracking, accounts, remote storage, or licensed assets without a
  separate product and privacy decision.
- Prefer deterministic puzzle data or a seeded generator so a reported puzzle
  can be reproduced.

## Development

1. Install Node.js 22 or newer and run `npm install`.
2. Create a branch from `main`.
3. Follow [the game contract](docs/ADDING_A_GAME.md).
4. Run `npm run check`.
5. Open a pull request that explains the trained skill and how the answer is
   guaranteed to be unambiguous.

## Experience checklist

- A full round works with mouse, touch, and keyboard.
- Focus is visible and touch targets are at least 44 by 44 CSS pixels.
- Correctness is not communicated by color alone.
- Motion respects `prefers-reduced-motion`.
- Instructions are short and avoid unnecessary verbal clues.
- The narrow mobile layout does not scroll horizontally.

By contributing, you agree that your contribution is licensed under the MIT
license used by this repository.
