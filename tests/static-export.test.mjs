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
    access(new URL("lab/subtraction-flash/index.html", outputRoot)),
    access(new URL("lab/math-kangaroo/index.html", outputRoot)),
    access(new URL("404.html", outputRoot)),
  ]);

  const [
    home,
    rotationGame,
    patternGame,
    libraGame,
    whoseLeftGame,
    shapeFoldGame,
    braidsGame,
    dominoGame,
    changingStripsGame,
    braceletGame,
    subtractionLab,
    mathKangarooLab,
  ] = await Promise.all([
    readOutput("index.html"),
    readOutput("games/rotation-match/index.html"),
    readOutput("games/pattern-matrix/index.html"),
    readOutput("games/libra/index.html"),
    readOutput("games/whose-left/index.html"),
    readOutput("games/shape-fold/index.html"),
    readOutput("games/braids/index.html"),
    readOutput("games/domino-twist/index.html"),
    readOutput("games/changing-strips/index.html"),
    readOutput("games/bracelet-search/index.html"),
    readOutput("lab/subtraction-flash/index.html"),
    readOutput("lab/math-kangaroo/index.html"),
  ]);

  assert.match(home, /Spatial Gym/);
  assert.match(home, /Train how/);
  assert.match(home, /Transformation Match/);
  assert.match(home, /Pattern Matrix/);
  assert.match(home, /Libra/);
  assert.match(home, /Whose Left\?/);
  assert.match(home, /Braids/);
  assert.match(home, /Shape Fold/);
  assert.match(home, /Domino Twist/);
  assert.match(home, /Changing Strips/);
  assert.match(home, /Bracelet Search/);
  assert.match(home, /Math Kangaroo Shuffle/);
  assert.match(home, /Borrow Flash/);
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
  assert.match(shapeFoldGame, /Shape Fold/);
  assert.match(shapeFoldGame, />Campaign</);
  assert.match(shapeFoldGame, /Infinite/);
  assert.match(braidsGame, /Braids/);
  assert.match(braidsGame, />Campaign</);
  assert.match(braidsGame, />Infinite</);
  assert.match(braidsGame, /<title>Braids · Spatial Gym<\/title>/);
  assert.match(dominoGame, /Domino Twist/);
  assert.match(dominoGame, />Campaign</);
  assert.match(dominoGame, /Infinite/);
  assert.match(changingStripsGame, /Changing Strips/);
  assert.match(changingStripsGame, /Campaign/);
  assert.match(changingStripsGame, /Infinite/);
  assert.match(
    changingStripsGame,
    /<title>Changing Strips · Spatial Gym<\/title>/,
  );
  assert.match(braceletGame, /Bracelet Search/);
  assert.match(braceletGame, />Campaign</);
  assert.match(braceletGame, />Infinite</);
  assert.match(
    braceletGame,
    /<title>Bracelet Search · Spatial Gym<\/title>/,
  );
  assert.match(mathKangarooLab, /Math Kangaroo shuffle/);
  assert.match(mathKangarooLab, /Progress is saved on this device/);
  assert.match(mathKangarooLab, /Choose your pool/);
  assert.match(mathKangarooLab, /All spatial types/);
  assert.match(subtractionLab, /Borrow Flash/);
  assert.doesNotMatch(home, /codex-preview|Your site is taking shape/i);
});

test("applies the GitHub Pages project base path to internal assets and links", async () => {
  const packages = await discoverGamePackages();
  const [
    home,
    patternGame,
    libraGame,
    whoseLeftGame,
    shapeFoldGame,
    braidsGame,
    dominoGame,
    changingStripsGame,
    braceletGame,
    subtractionLab,
    mathKangarooLab,
  ] = await Promise.all([
    readOutput("index.html"),
    readOutput("games/pattern-matrix/index.html"),
    readOutput("games/libra/index.html"),
    readOutput("games/whose-left/index.html"),
    readOutput("games/shape-fold/index.html"),
    readOutput("games/braids/index.html"),
    readOutput("games/domino-twist/index.html"),
    readOutput("games/changing-strips/index.html"),
    readOutput("games/bracelet-search/index.html"),
    readOutput("lab/subtraction-flash/index.html"),
    readOutput("lab/math-kangaroo/index.html"),
  ]);

  for (const { slug } of packages) {
    assert.match(home, new RegExp(`href=["']${basePath}/games/${slug}/`));
    assert.match(home, new RegExp(`data-game-icon=["']${slug}["']`));
  }
  assert.match(home, new RegExp(`["']${basePath}/_next/`));
  assert.match(
    home,
    new RegExp(`href=["']${basePath}/lab/math-kangaroo/`),
  );
  assert.match(
    home,
    new RegExp(`href=["']${basePath}/lab/subtraction-flash/`),
  );
  assert.match(patternGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(patternGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(libraGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(libraGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(whoseLeftGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(whoseLeftGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(shapeFoldGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(shapeFoldGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(braidsGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(braidsGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(dominoGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(dominoGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(changingStripsGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(changingStripsGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(braceletGame, new RegExp(`href=["']${basePath}/["']`));
  assert.match(braceletGame, new RegExp(`["']${basePath}/_next/`));
  assert.match(mathKangarooLab, new RegExp(`href=["']${basePath}/["']`));
  assert.match(mathKangarooLab, new RegExp(`["']${basePath}/_next/`));
  assert.match(subtractionLab, new RegExp(`href=["']${basePath}/["']`));
  assert.match(subtractionLab, new RegExp(`["']${basePath}/_next/`));
  assert.doesNotMatch(home, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(patternGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(libraGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(whoseLeftGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(shapeFoldGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(braidsGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(dominoGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(changingStripsGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(braceletGame, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(mathKangarooLab, /(?:href|src)=["']\/_next\//);
  assert.doesNotMatch(subtractionLab, /(?:href|src)=["']\/_next\//);
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
  assert.match(
    readme,
    /\[Shape Fold\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/shape-fold\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Braids\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/braids\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Domino Twist\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/domino-twist\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Changing Strips\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/changing-strips\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Bracelet Search\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/games\/bracelet-search\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Math Kangaroo Shuffle\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/lab\/math-kangaroo\/\).*Playable/,
  );
  assert.match(
    readme,
    /\[Borrow Flash\]\(https:\/\/rfarnham\.github\.io\/nonverbal-reasoning-games\/lab\/subtraction-flash\/\).*Playable/,
  );
  assert.match(decisions, /Good next decisions/);
  assert.match(gameGuide, /exactly one correct answer/);
  assert.match(deployWorkflow, /actions\/deploy-pages@v5/);
});
