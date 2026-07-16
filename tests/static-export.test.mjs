import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const outputRoot = new URL("../out/", import.meta.url);
const basePath = "/nonverbal-reasoning-games";

async function readOutput(relativePath) {
  return readFile(new URL(relativePath, outputRoot), "utf8");
}

test("exports the catalog and first game as refresh-safe pages", async () => {
  await Promise.all([
    access(new URL("index.html", outputRoot)),
    access(new URL("games/rotation-match/index.html", outputRoot)),
    access(new URL("404.html", outputRoot)),
  ]);

  const [home, game] = await Promise.all([
    readOutput("index.html"),
    readOutput("games/rotation-match/index.html"),
  ]);

  assert.match(home, /Spatial Gym/);
  assert.match(home, /Train how/);
  assert.match(home, /Transformation Match/);
  assert.match(game, /Transformation Match/);
  assert.doesNotMatch(home, /codex-preview|Your site is taking shape/i);
});

test("applies the GitHub Pages project base path to internal assets and links", async () => {
  const home = await readOutput("index.html");

  assert.match(home, new RegExp(`href=["']${basePath}/games/rotation-match/`));
  assert.match(home, new RegExp(`["']${basePath}/_next/`));
  assert.doesNotMatch(home, /(?:href|src)=["']\/_next\//);
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
  assert.match(decisions, /Good next decisions/);
  assert.match(gameGuide, /exactly one correct answer/);
  assert.match(deployWorkflow, /actions\/deploy-pages@v5/);
});
