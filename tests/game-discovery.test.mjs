import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  defaultGamesDirectory,
  defaultOutputFile,
  discoverGamePackages,
  renderGameRegistry,
  writeGameRegistry,
} from "../scripts/generate-game-registry.mjs";

async function addGame(gamesDirectory, slug, { catalog = true } = {}) {
  const directory = join(gamesDirectory, slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "page.tsx"), "export default function Page() {}\n");
  if (catalog) {
    await writeFile(
      join(directory, "catalog.tsx"),
      "export const gameInfo = {}; export function ShelfIcon() {}\n",
    );
  }
}

test("the checked-in game packages are discovered without a central slug list", async () => {
  const packages = await discoverGamePackages();
  assert.ok(packages.length > 0);
  assert.equal(
    new Set(packages.map(({ slug }) => slug)).size,
    packages.length,
  );

  const registry = await readFile(defaultOutputFile, "utf8");
  for (const { slug } of packages) {
    assert.match(registry, new RegExp(`app/games/${slug}/catalog`));
    assert.match(registry, new RegExp(`href: "/games/${slug}/"`));
  }
});

test("a new self-contained game is included deterministically and idempotently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "spatial-gym-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gamesDirectory = join(root, "app/games");
  const outputFile = join(root, "lib/generated/game-registry.ts");
  const typesFile = join(root, "lib/game-catalog-types.ts");
  await mkdir(gamesDirectory, { recursive: true });
  await addGame(gamesDirectory, "zebra-grid");
  await addGame(gamesDirectory, "angle-path");
  await addGame(gamesDirectory, "game-123");
  await addGame(gamesDirectory, "game1-23");
  await mkdir(join(gamesDirectory, "work-in-progress"));

  const first = await writeGameRegistry({
    gamesDirectory,
    outputFile,
    typesFile,
  });
  const second = await writeGameRegistry({
    gamesDirectory,
    outputFile,
    typesFile,
  });
  const registry = await readFile(outputFile, "utf8");

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(
    first.packages.map(({ slug }) => slug),
    ["angle-path", "game-123", "game1-23", "zebra-grid"],
  );
  assert.ok(
    registry.indexOf("Game_angle_pathGameInfo") <
      registry.indexOf("Game_game_123GameInfo"),
  );
  assert.ok(
    registry.indexOf("Game_game_123GameInfo") <
      registry.indexOf("Game_game1_23GameInfo"),
  );
  assert.ok(
    registry.indexOf("Game_game1_23GameInfo") <
      registry.indexOf("Game_zebra_gridGameInfo"),
  );
  assert.match(registry, /href: "\/games\/angle-path\/"/);
  assert.match(registry, /href: "\/games\/game-123\/"/);
  assert.match(registry, /href: "\/games\/game1-23\/"/);
  assert.match(registry, /href: "\/games\/zebra-grid\/"/);
  assert.doesNotMatch(registry, /work-in-progress/);
});

test("implemented routes fail clearly when their catalog contract is incomplete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "spatial-gym-invalid-game-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gamesDirectory = join(root, "games");
  await mkdir(gamesDirectory, { recursive: true });

  await addGame(gamesDirectory, "missing-catalog", { catalog: false });
  await assert.rejects(
    discoverGamePackages(gamesDirectory),
    /missing-catalog.*missing catalog\.tsx/i,
  );

  await rm(join(gamesDirectory, "missing-catalog"), {
    recursive: true,
    force: true,
  });
  await addGame(gamesDirectory, "Bad_Slug");
  await assert.rejects(
    discoverGamePackages(gamesDirectory),
    /lowercase kebab-case/i,
  );
});

test("symlinked directories cannot inject game packages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "spatial-gym-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gamesDirectory = join(root, "games");
  const externalDirectory = join(root, "external-game");
  await mkdir(gamesDirectory, { recursive: true });
  await addGame(root, "external-game");
  await symlink(externalDirectory, join(gamesDirectory, "linked-game"), "dir");

  assert.deepEqual(await discoverGamePackages(gamesDirectory), []);
});

test("registry rendering derives routes from directory slugs", async () => {
  const packages = await discoverGamePackages(defaultGamesDirectory);
  const rendered = renderGameRegistry(packages);

  assert.match(rendered, /slug: "pattern-matrix"/);
  assert.match(rendered, /href: "\/games\/pattern-matrix\/"/);
  assert.match(rendered, /slug: "rotation-match"/);
  assert.match(rendered, /href: "\/games\/rotation-match\/"/);
});
