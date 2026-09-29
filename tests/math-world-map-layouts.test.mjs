import assert from "node:assert/strict";
import test from "node:test";

import { COMPACT_WORLD_MAP_LAYOUTS, getWorldMapLayout, WORLD_MAP_LAYOUTS } from "../app/math-world/map-layouts.ts";
import { getMapTravelPoints } from "../app/math-world/map-travel.ts";
import { REQUIRED_STOPS, WORLD_DEFINITIONS, WORLD_MODE } from "../app/math-world/world-data.ts";
import runtimeManifest from "../app/math-world/data/runtime.generated.json" with { type: "json" };

function values(path) {
  assert.match(path, /^M[\d.]+ [\d.]+ C[\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  return path.match(/-?\d+(?:\.\d+)?/g).map(Number);
}
function curve(path, t) {
  const [x0,y0,x1,y1,x2,y2,x3,y3] = values(path);
  const u = 1 - t;
  return { x: u ** 3*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t**3*x3, y: u**3*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t**3*y3 };
}
const ALL_LAYOUTS = [...WORLD_MAP_LAYOUTS, ...COMPACT_WORLD_MAP_LAYOUTS];

function pixels(point, layout) { return { x: point.x / 100 * layout.width, y: point.y / 100 * layout.height }; }
function near(actual, expected, label) {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7, label);
}

test("thirty-two authored worlds have distinct geometry in both orientations", () => {
  assert.deepEqual(WORLD_MAP_LAYOUTS.map(world => world.worldNumber), Array.from({ length: 32 }, (_, index) => index + 1));
  for (const orientation of ["desktop", "mobile"]) {
    const geometries = WORLD_MAP_LAYOUTS.map(world => JSON.stringify(world[orientation]));
    const routeGeometries = WORLD_MAP_LAYOUTS.map(world => JSON.stringify(world[orientation].roads));
    assert.equal(new Set(geometries).size, 32);
    assert.equal(new Set(routeGeometries).size, 32, "each world has its own journey, including the second spiral");
  }
  assert.equal(new Set(WORLD_MAP_LAYOUTS.map(world => world.landscape)).size, 16);
  for (let index = 0; index < 16; index += 1) {
    assert.equal(WORLD_MAP_LAYOUTS[index].landscape, WORLD_MAP_LAYOUTS[index + 16].landscape);
    assert.equal(WORLD_MAP_LAYOUTS[index].variant, 1);
    assert.equal(WORLD_MAP_LAYOUTS[index + 16].variant, 2);
  }
  assert.throws(() => getWorldMapLayout(0));
  assert.throws(() => getWorldMapLayout(33));
});

test("shorter banks use complete compact maps with no abandoned quiz islands", () => {
  assert.deepEqual(COMPACT_WORLD_MAP_LAYOUTS.map(world => [world.worldNumber, world.desktop.stopPoints.length]), [[10,2],[12,3],[13,3],[14,3],[15,2],[26,2],[28,3],[29,3],[30,3],[31,2]]);
  for (const world of COMPACT_WORLD_MAP_LAYOUTS) {
    assert.strictEqual(getWorldMapLayout(world.worldNumber, world.desktop.stopPoints.length), world);
    assert.equal(world.desktop.stopPoints.length, world.mobile.stopPoints.length);
    assert.equal(world.landscape, getWorldMapLayout(world.worldNumber).landscape);
    assert.equal(world.variant, getWorldMapLayout(world.worldNumber).variant);
  }
  assert.throws(() => getWorldMapLayout(1, 5));
});

for (const orientation of ["desktop", "mobile"]) {
  const mobile = orientation === "mobile";
  test(`${orientation}: exactly two story islands have books and every quiz island has a real stop`, () => {
    for (const world of ALL_LAYOUTS) {
      const layout = world[orientation];
      assert.equal(layout.width, mobile ? 400 : 1200);
      assert.equal(layout.height, mobile ? 960 : 740);
      const stopCount = layout.stopPoints.length;
      assert.ok([2,3,4].includes(stopCount));
      assert.equal(layout.roads.length, stopCount - 1);
      assert.equal(layout.islands.length, stopCount + 2);
      assert.equal(layout.books.length, 2);
      assert.equal(layout.storyPaths.length, 2);
      assert.deepEqual(layout.islands.filter(island => island.stopIndex !== undefined).map(island => island.stopIndex), Array.from({ length: stopCount }, (_, index) => index));
      assert.equal(new Set(layout.islands.map(island => island.id)).size, layout.islands.length);
      assert.equal(new Set(layout.books.map(book => book.islandId)).size, 2);
      assert.deepEqual(world.desktop.books.map(book => book.id), world.mobile.books.map(book => book.id));
      for (const island of layout.islands) {
        assert.ok(island.x - island.rx >= 0 && island.x + island.rx <= layout.width, `${world.worldNumber} ${island.id}: horizontal island bounds`);
        assert.ok(island.y - island.ry >= 0 && island.y + island.ry <= layout.height, `${world.worldNumber} ${island.id}: vertical island bounds`);
        const book = layout.books.find(candidate => candidate.islandId === island.id);
        if (island.stopIndex === undefined) {
          assert.ok(book, "every story island has its book");
          near(pixels(book, layout), island, "book is centered on its dedicated island");
        } else {
          assert.equal(book, undefined, "quiz islands do not repeat the story controls");
          const stop = pixels(layout.stopPoints[island.stopIndex], layout);
          assert.ok(Math.abs(stop.x - island.x) < island.rx * 0.6 && Math.abs(stop.y - island.y) < island.ry * 0.6, "quiz marker is on solid central land");
        }
      }
      const targets = [...layout.stopPoints, ...layout.books];
      for (const [index, target] of targets.entries()) {
        assert.ok(target.x > 0 && target.x < 100 && target.y > 0 && target.y < 100);
        for (const other of targets.slice(index + 1)) {
          const a = pixels(target, layout), b = pixels(other, layout);
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= (mobile ? 80 : 130) - 1e-7, `World ${world.worldNumber}: controls remain separate at narrow widths`);
        }
      }
    }
  });

  test(`${orientation}: roads join their stops and avoid unrelated islands`, () => {
    for (const world of ALL_LAYOUTS) {
      const layout = world[orientation];
      for (const [index, path] of layout.roads.entries()) {
        near(curve(path, 0), pixels(layout.stopPoints[index], layout), "road starts at its quiz marker");
        near(curve(path, 1), pixels(layout.stopPoints[index + 1], layout), "road ends at its quiz marker");
        for (let step = 0; step <= 100; step += 1) {
          const point = curve(path, step / 100);
          assert.ok(point.x >= 0 && point.x <= layout.width && point.y >= 0 && point.y <= layout.height);
          for (const island of layout.islands) {
            if (island.stopIndex === index || island.stopIndex === index + 1) continue;
            assert.ok(Math.hypot((point.x - island.x) / island.rx, (point.y - island.y) / island.ry) >= 1.04, `World ${world.worldNumber}: road ${index} must not cross unrelated ${island.id}`);
          }
        }
      }
      for (const [index, path] of layout.storyPaths.entries()) {
        const island = layout.islands.filter(candidate => candidate.stopIndex === undefined)[index];
        near(curve(path, 1), island, "story tributary reaches its satellite island");
        const start = curve(path, 0);
        const origin = layout.islands.filter(candidate => candidate.stopIndex !== undefined)
          .sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))[0];
        for (let step = 0; step <= 100; step += 1) {
          const point = curve(path, step / 100);
          for (const other of layout.islands) {
            if (other === island || other === origin) continue;
            assert.ok(Math.hypot((point.x - other.x) / other.rx, (point.y - other.y) / other.ry) >= 1.04, `World ${world.worldNumber}: story branch avoids unrelated ${other.id}`);
          }
        }
      }
    }
  });

  test(`${orientation}: every world's avatar follows its exact painted curves forward and backward`, { skip: WORLD_MODE !== "spiral-preview" }, () => {
    for (const world of WORLD_DEFINITIONS) {
      const layout = getWorldMapLayout(world.number, world.stopIds.length)[orientation];
      const stops = REQUIRED_STOPS.filter(stop => stop.worldId === world.id);
      assert.deepEqual(stops.map(stop => stop.mapSlot), Array.from({ length: stops.length }, (_, index) => index));
      const routes = [];
      for (let index = 0; index < stops.length - 1; index += 1) {
        const route = getMapTravelPoints(stops[index].id, stops[index + 1].id, mobile);
        const reference = Array.from({ length: 3201 }, (_, sample) => curve(layout.roads[index], sample / 2000));
        assert.ok(route.length > 2);
        for (const point of route) {
          const pixel = pixels(point, layout);
          const distance = Math.min(...reference.map(sample => Math.hypot(sample.x - pixel.x, sample.y - pixel.y)));
          assert.ok(distance < 0.35, `${world.id}: avatar stays on the road (${distance}px)`);
        }
        routes.push(route);
      }
      for (let from = 0; from < stops.length; from += 1) for (let to = 0; to < stops.length; to += 1) {
        const route = getMapTravelPoints(stops[from].id, stops[to].id, mobile);
        assert.deepEqual(route[0], layout.stopPoints[from]);
        assert.deepEqual(route.at(-1), layout.stopPoints[to]);
        assert.deepEqual(getMapTravelPoints(stops[to].id, stops[from].id, mobile), [...route].reverse());
        if (from === to) assert.equal(route.length, 1);
        else {
          const first = Math.min(from, to), last = Math.max(from, to);
          const expected = [routes[first][0], ...routes.slice(first,last).flatMap(segment => segment.slice(1))];
          assert.deepEqual(route, from > to ? expected.reverse() : expected, "travel includes every intervening curve");
          for (let index = 1; index < route.length; index += 1) {
            const a = pixels(route[index - 1], layout), b = pixels(route[index], layout);
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            assert.ok(distance > 8.4 && distance <= 10.01, "arc-length steps avoid jumps and pauses");
          }
        }
      }
      const route = getMapTravelPoints(stops[0].id, stops.at(-1).id, mobile);
      const original = structuredClone(route);
      route[0].x = -1;
      route[2].y = -1;
      route.pop();
      assert.deepEqual(getMapTravelPoints(stops[0].id, stops.at(-1).id, mobile), original, "callers cannot mutate later travel");
    }
  });
}

test("map-only projection preserves question content and persisted stop membership", { skip: WORLD_MODE !== "spiral-preview" }, () => {
  for (const stop of REQUIRED_STOPS) {
    const original = runtimeManifest.stops.find(candidate => candidate.id === stop.id);
    const coordinates = new Set(["mapSlot", "x", "y", "mobileX", "mobileY"]);
    const identity = value => Object.fromEntries(Object.entries(value).filter(([key]) => !coordinates.has(key)));
    assert.deepEqual(identity(stop), identity(original));
  }
});
