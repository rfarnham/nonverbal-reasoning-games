import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { discoverGamePackages } from "../scripts/generate-game-registry.mjs";

const projectRoot = new URL("../", import.meta.url);
const outputRoot = new URL("../out/", import.meta.url);
const basePath = "/nonverbal-reasoning-games";

async function readOutput(relativePath) {
  return readFile(new URL(relativePath, outputRoot), "utf8");
}

test("exports the catalog and implemented game routes as refresh-safe pages", async () => {
  const packages = await discoverGamePackages();
  await Promise.all([
    access(new URL("index.html", outputRoot)),
    ...packages.map(({ slug }) =>
      access(new URL(`games/${slug}/index.html`, outputRoot)),
    ),
    access(new URL("404.html", outputRoot)),
  ]);

  const [home, rotationGame, patternGame, libraGame, whoseLeftGame] = await Promise.all([
    readOutput("index.html"),
    readOutput("games/rotation-match/index.html"),
    readOutput("games/pattern-matrix/index.html"),
    readOutput("games/libra/index.html"),
    readOutput("games/whose-left/index.html"),
  ]);

  assert.match(home, /Spatial Gym/);
  assert.match(home, /Train how/);
  assert.match(home, /Transformation Match/);
  assert.match(home, /Pattern Matrix/);
  assert.match(home, /Libra/);
  assert.match(home, /Whose Left\?/);
  assert.match(rotationGame, /Transformation Match/);
  assert.match(rotationGame, />Campaign</);
  assert.doesNotMatch(rotationGame, />36 puzzles</);
  assert.match(patternGame, /Pattern Matrix/);
  assert.match(patternGame, />Campaign</);
  assert.match(patternGame, />Infinite</);
  assert.match(patternGame, /<title>Pattern Matrix · Spatial Gym<\/title>/);
  assert.match(
    patternGame,
    /https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/pattern-matrix\//,
  );
  assert.match(libraGame, /Libra/);
  assert.match(libraGame, />Campaign</);
  assert.match(libraGame, />Infinite</);
  assert.match(whoseLeftGame, /Whose Left\?/);
  assert.match(whoseLeftGame, />Campaign</);
  assert.match(whoseLeftGame, />Infinite</);
  assert.doesNotMatch(home, /codex-preview|Your site is taking shape/i);
});

test("applies the GitHub Pages project base path to internal assets and links", async () => {
  const packages = await discoverGamePackages();
  const [home, patternGame, libraGame, whoseLeftGame] = await Promise.all([
    readOutput("index.html"),
    readOutput("games/pattern-matrix/index.html"),
    readOutput("games/libra/index.html"),
    readOutput("games/whose-left/index.html"),
  ]);

  for (const { slug } of packages) {
    assert.match(home, new RegExp(`href=["']${basePath}/games/${slug}/`));
    assert.match(home, new RegExp(`data-game-icon=["']${slug}["']`));
  }
  assert.match(home, new RegExp(`["']${basePath}/_next/`));
  assert.match(patternGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(patternGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(libraGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(libraGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(whoseLeftGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(whoseLeftGame, new RegExp(`["']${basePath}/_next/`));
  assert.doesNotMatch(home, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(patternGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(libraGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(whoseLeftGame, /(?:href|src)=["']\/_next\//);
});

test("ships project metadata and contributor documentation", async () => {
  const [home, readme, decisions, gameGuide, deployWorkflow] = await Promise.all([
    readOutput("index.html"),
    readFile(new URL("README.md", projectRoot), "utf8"),
    readFile(new URL("docs/PROJECT_DECISIONS.md", projectRoot), "utf8"),
    readFile(new URL("docs/ADDING_A_GAME.md", projectRoot), "utf8"),
    readFile(new URL(".github/workflows/deploy-pages.yml", projectRoot), "utf8"),
  ]);

  assert.match(home, /og\.png/);
  assert.match(readme, /Play the games/);
  assert.match(
    readme,
    /\[Pattern Matrix\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/pattern-matrix\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Libra\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/libra\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Whose Left\?\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/whose-left\/\).*Playable/,
  );
  assert.match(decisions, /Good next decisions/);
  assert.match(gameGuide, /exactly one correct answer/);
  assert.match(deployWorkflow, /actions\/deploy-pages@v5/);
});
