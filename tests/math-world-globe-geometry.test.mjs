import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBE_BOSS_REGIONS, GLOBE_DESTINATIONS, GLOBE_REGIONS, GLOBE_REGION_RADIUS,
  distanceToSurfaceArc, dotVec3, getGlobeDestination, getGlobeMap, getGlobeRegion,
  getGlobeRoadPoints, getSurfaceRouteTangent, getVoyageRoute, mapPointToGlobe,
  sampleSurfaceRoute, sphericalAngle, sphericalInterpolate,
} from "../app/math-world/globe-geometry.ts";
import { WORLD_DEFINITIONS } from "../app/math-world/world-data.ts";

const length = point => Math.hypot(point.x, point.y, point.z);
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const nearPoint = (a, b) => near(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 0);

test("32 persistent archipelagos and two boss destinations occupy distinct non-overlapping spherical regions", () => {
  assert.equal(GLOBE_DESTINATIONS.length, 34);
  assert.equal(GLOBE_REGIONS.length, 32);
  assert.equal(new Set(GLOBE_DESTINATIONS.map(region => region.id)).size, 34);
  assert.deepEqual(GLOBE_REGIONS.map(region => region.id), WORLD_DEFINITIONS.map(world => world.id));
  assert.deepEqual(GLOBE_BOSS_REGIONS.map(region => [region.id, region.worldNumber]), [["boss-2025", 16], ["boss-2026", 32]]);
  assert.equal(GLOBE_DESTINATIONS[16].id, "boss-2025");
  assert.equal(GLOBE_DESTINATIONS[33].id, "boss-2026");
  for (const [index, region] of GLOBE_DESTINATIONS.entries()) {
    near(length(region.center), 1);
    near(length(region.east), 1);
    near(length(region.north), 1);
    near(dotVec3(region.center, region.east), 0);
    near(dotVec3(region.center, region.north), 0);
    near(dotVec3(region.east, region.north), 0);
    assert.equal(getGlobeDestination(region.id), region);
    assert.ok(sphericalAngle(region.center, region.harbor) > region.angularRadius, "harbor is in open water outside its land envelope");
    for (const other of GLOBE_DESTINATIONS.slice(index + 1)) {
      assert.ok(sphericalAngle(region.center, other.center) > region.angularRadius + other.angularRadius + 0.08, "archipelagos leave a navigable ocean corridor");
    }
  }
  assert.throws(() => getGlobeRegion(0));
  assert.throws(() => getGlobeDestination("missing-world"));
});

test("authored islands, stop curves and exactly two books project onto the actual sphere in all 32 regions", () => {
  for (const world of WORLD_DEFINITIONS) for (const mobile of [false, true]) {
    const map = getGlobeMap(world.number, world.stopIds.length, mobile);
    assert.equal(map.stops.length, world.stopIds.length);
    assert.equal(map.books.length, 2);
    assert.equal(map.islands.length, world.stopIds.length + 2);
    assert.equal(map.roads.length, world.stopIds.length - 1);
    assert.equal(map.storyPaths.length, 2);
    nearPoint(mapPointToGlobe(world.number, 50, 50, mobile), map.region.center);
    for (const item of [...map.stops, ...map.books, ...map.islands]) {
      near(length(item.point), 1);
      assert.ok(sphericalAngle(item.point, map.region.center) < GLOBE_REGION_RADIUS);
    }
    for (const island of map.islands) for (let index = 0; index < 32; index += 1) {
      const theta = index * Math.PI / 16;
      const rotation = (island.rotation ?? 0) * Math.PI / 180;
      const dx = island.rx * Math.cos(theta), dy = island.ry * Math.sin(theta);
      const x = island.x + dx * Math.cos(rotation) - dy * Math.sin(rotation);
      const y = island.y + dx * Math.sin(rotation) + dy * Math.cos(rotation);
      const point = mapPointToGlobe(world.number, x / map.layout.width * 100, y / map.layout.height * 100, mobile);
      assert.ok(sphericalAngle(point, map.region.center) < GLOBE_REGION_RADIUS, "the full island footprint stays in its land envelope");
    }
    for (const [index, points] of map.roads.entries()) {
      nearPoint(points[0], map.stops[index].point);
      nearPoint(points.at(-1), map.stops[index + 1].point);
      assert.deepEqual(points, getGlobeRoadPoints(world.number, world.stopIds.length, index, mobile));
      for (const point of points) near(length(point), 1);
    }
    for (const [index, points] of map.storyPaths.entries()) nearPoint(points.at(-1), map.books[index].point);
  }
  assert.equal(getGlobeMap(10).stops.length, 2, "default uses the real compact bank");
  assert.equal(getGlobeMap(12).stops.length, 3);
  assert.throws(() => getGlobeRoadPoints(10, 2, 3));
});

test("desktop projection preserves authored aspect ratio and explicit elevation", () => {
  const center = getGlobeRegion(1).center;
  const east = mapPointToGlobe(1, 50 + 100 / 1200 * 100, 50);
  const north = mapPointToGlobe(1, 50, 50 - 100 / 740 * 100);
  near(sphericalAngle(center, east), sphericalAngle(center, north));
  near(length(mapPointToGlobe(1, 15, 78, false, 1.017)), 1.017);
  near(length(getGlobeRoadPoints(1, 4, 0, false, 1.005)[17]), 1.005);
});

test("spherical interpolation handles equal, near-equal and antipodal points without leaving the surface", () => {
  const pairs = [
    [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }],
    [{ x: 1, y: 0, z: 0 }, { x: 1, y: 1e-11, z: 0 }],
    [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }],
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }],
    [{ x: 0, y: 0, z: 1 }, { x: 1e-8, y: 0, z: -1 }],
  ];
  for (const [start, end] of pairs) {
    for (let index = 0; index <= 100; index += 1) near(length(sphericalInterpolate(start, end, index / 100)), 1);
    nearPoint(sphericalInterpolate(start, end, 0), start);
    nearPoint(sphericalInterpolate(start, end, 1), end);
    nearPoint(sphericalInterpolate(start, end, -1), start);
    nearPoint(sphericalInterpolate(start, end, 2), end);
  }
  assert.throws(() => sphericalInterpolate({ x: 0, y: 0, z: 0 }, pairs[0][1], 0.5));
});

test("every onward voyage and nonadjacent QA jump stays over ocean, reaches exact docks, and reverses faithfully", () => {
  const pairs = GLOBE_DESTINATIONS.slice(1).map((region, index) => [GLOBE_DESTINATIONS[index].id, region.id]);
  pairs.push([1, 17], [1, 32], [5, 26], ["boss-2025", "boss-2026"], [29, 3]);
  for (const [from, to] of pairs) {
    const route = getVoyageRoute(from, to);
    assert.ok(route.length > 2);
    nearPoint(route[0], getGlobeDestination(from).harbor);
    nearPoint(route.at(-1), getGlobeDestination(to).harbor);
    assert.deepEqual(getVoyageRoute(to, from), [...route].reverse());
    for (const point of route) near(length(point), 1);
    for (let index = 1; index < route.length; index += 1) {
      assert.ok(sphericalAngle(route[index - 1], route[index]) <= 0.0120001, "there are no teleporting gaps");
      for (const region of GLOBE_DESTINATIONS) {
        assert.ok(distanceToSurfaceArc(region.center, route[index - 1], route[index]) >= region.angularRadius + 0.0059, `${from}→${to} avoids ${region.id}, including between samples`);
      }
    }
    nearPoint(sampleSurfaceRoute(route, 0), route[0]);
    nearPoint(sampleSurfaceRoute(route, 1), route.at(-1));
    const point = sampleSurfaceRoute(route, 0.4), tangent = getSurfaceRouteTangent(route, 0.4);
    near(length(tangent), 1);
    near(dotVec3(point, tangent), 0);
  }
  const original = getVoyageRoute(1, 32);
  const changed = getVoyageRoute(1, 32);
  changed[0].x = -99;
  changed.pop();
  assert.deepEqual(getVoyageRoute(1, 32), original, "callers cannot mutate cached voyages");
  assert.equal(getVoyageRoute(7, 7).length, 1);
});

test("route sampling runs at constant angular speed through unequal segments", () => {
  const point = angle => ({ x: Math.sin(angle), y: 0, z: Math.cos(angle) });
  const route = [point(0), point(0.1), point(0.7), point(1)];
  for (let index = 0; index <= 10; index += 1) nearPoint(sampleSurfaceRoute(route, index / 10), point(index / 10));
  near(length(sampleSurfaceRoute(route, 0.2, 1.04)), 1.04);
  assert.throws(() => sampleSurfaceRoute([], 0.5));
  near(length(getSurfaceRouteTangent([point(0)], 1)), 1);
});
