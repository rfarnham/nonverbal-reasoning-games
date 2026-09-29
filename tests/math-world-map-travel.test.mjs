import assert from "node:assert/strict";
import test from "node:test";

import { desktopBonusRoad, desktopRoad, getMapTravelPoints, mobileBonusRoad, mobileRoad } from "../app/math-world/map-travel.ts";
import { BREAK_STOPS, REQUIRED_STOPS, WORLD_DEFINITIONS, WORLD_MODE } from "../app/math-world/world-data.ts";

const worldPaths = WORLD_DEFINITIONS.map(world => ({
  id: world.id,
  stops: REQUIRED_STOPS.filter(stop => stop.worldId === world.id),
  breaks: BREAK_STOPS.filter(stop => stop.worldId === world.id),
}));
const branchKinds = ["turbo", "minigame"];

test("spiral worlds contain only their authored required stops and no optional routes", { skip: WORLD_MODE !== "spiral-preview" }, () => {
  assert.equal(BREAK_STOPS.length, 0, "spiral worlds must not add optional quiz stops");
  for (const world of worldPaths) {
    assert.deepEqual(world.stops.map(stop => stop.id), WORLD_DEFINITIONS.find(candidate => candidate.id === world.id).stopIds);
    assert.ok(world.stops.length >= 2 && world.stops.length <= 4, `${world.id} has two to four required stops`);
    for (const mobile of [false, true]) {
      for (const kind of branchKinds) {
        assert.deepEqual(getMapTravelPoints(world.stops[0].id, `${world.id}-${kind}`, mobile), []);
      }
    }
  }
});

function stopPoint(stop, mobile) {
  return mobile ? { x: stop.mobileX, y: stop.mobileY } : { x: stop.x, y: stop.y };
}

function coordinates(path) {
  const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(values.length, 8, "painted road segments are single cubic curves");
  return values;
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function assertPoint(actual, expected, message) {
  assert.ok(actual && samePoint(actual, expected), message);
}

function referenceCurve(path) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = coordinates(path);
  // Independent dense reference: compare positions, not the implementation's sample count.
  return Array.from({ length: 2001 }, (_, sample) => {
    const t = sample / 2000;
    const u = 1 - t;
    return {
      x: u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
      y: u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
    };
  });
}

function assertOnCurve(points, path, width, height, label) {
  const reference = referenceCurve(path);
  assert.ok(points.length > 2, `${label}: a curve has intermediate travel points`);
  for (const point of points) {
    const distance = Math.min(...reference.map(({ x, y }) => Math.hypot(
      x - point.x / 100 * width,
      y - point.y / 100 * height,
    )));
    assert.ok(distance < 0.25, `${label}: avatar is ${distance}px away from its painted curve`);
  }
}

function assertEvenSteps(points, width, height) {
  const distances = points.slice(1).map((point, index) => Math.hypot(
    (point.x - points[index].x) / 100 * width,
    (point.y - points[index].y) / 100 * height,
  ));
  assert.ok(Math.max(...distances) < 10.01, "there are no jumps over intermediate road anchors");
  assert.ok(Math.min(...distances) > 8.5, "there are no tiny pause steps or duplicate joins");
  assert.ok(Math.max(...distances) / Math.min(...distances) < 1.12);
}

for (const mobile of [false, true]) {
  const label = mobile ? "portrait" : "desktop";
  const width = mobile ? 400 : 1200;
  const height = mobile ? 960 : 740;
  const roads = mobile ? mobileRoad : desktopRoad;
  const branches = mobile ? mobileBonusRoad : desktopBonusRoad;
  const asPercentage = (x, y) => ({
    x: Math.round(x / width * 100 * 1e10) / 1e10,
    y: Math.round(y / height * 100 * 1e10) / 1e10,
  });
  const anchors = roads.map(path => {
    const [x, y] = coordinates(path);
    return asPercentage(x, y);
  });
  const finalCurve = coordinates(roads.at(-1));
  anchors.push(asPercentage(finalCurve[6], finalCurve[7]));

  function roadTemplate() {
    const world = worldPaths.find(({ stops }) => stops.some(stop => stop.mapSlot === 0)
      && stops.some(stop => stop.mapSlot === roads.length));
    assert.ok(world, "a world spans the full painted road for template coverage");
    const first = world.stops.find(stop => stop.mapSlot === 0);
    const last = world.stops.find(stop => stop.mapSlot === roads.length);
    const points = getMapTravelPoints(first.id, last.id, mobile);
    const indices = anchors.map((anchor, slot) => {
      const index = points.findIndex(point => samePoint(point, anchor));
      assert.ok(index >= 0, `painted slot ${slot} is visited even when it has no numbered stop`);
      return index;
    });
    assert.ok(indices.every((index, slot) => slot === 0 || index > indices[slot - 1]), "road anchors are visited in order");
    const betweenSlots = (fromSlot, toSlot) => {
      const route = points.slice(indices[Math.min(fromSlot, toSlot)], indices[Math.max(fromSlot, toSlot)] + 1);
      return fromSlot > toSlot ? route.reverse() : route;
    };
    return { world, first, last, points, indices, betweenSlots };
  }

  test(`${label} shared route follows every painted cubic, including unnumbered slots`, { skip: WORLD_MODE !== "prototype" }, () => {
    const { points, indices } = roadTemplate();
    for (let slot = 0; slot < roads.length; slot += 1) {
      const curve = coordinates(roads[slot]);
      assertPoint(asPercentage(curve[6], curve[7]), anchors[slot + 1], `curve ${slot} joins the next anchor`);
      assertOnCurve(points.slice(indices[slot], indices[slot + 1] + 1), roads[slot], width, height, `slot ${slot}`);
    }
    assertEvenSteps(points, width, height);
  });

  test(`${label} each world's required routes respect map slots, endpoints, and reversal`, { skip: WORLD_MODE !== "prototype" }, () => {
    const { betweenSlots } = roadTemplate();
    for (const world of worldPaths) {
      for (const from of world.stops) {
        assertPoint(stopPoint(from, mobile), anchors[from.mapSlot], `${from.id} agrees with its painted map slot`);
        for (const to of world.stops) {
          const points = getMapTravelPoints(from.id, to.id, mobile);
          assert.deepEqual(points[0], stopPoint(from, mobile), `${from.id} origin`);
          assert.deepEqual(points.at(-1), stopPoint(to, mobile), `${to.id} destination`);
          assert.deepEqual(points, betweenSlots(from.mapSlot, to.mapSlot), `${from.id} → ${to.id} includes every intervening curve`);
          assert.deepEqual(getMapTravelPoints(to.id, from.id, mobile), [...points].reverse(), `${world.id} reverses faithfully`);
          assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100));
          if (from.id === to.id) assert.equal(points.length, 1);
          else assert.ok(points.length > 2);
        }
      }
    }
  });

  test(`${label} route callers cannot corrupt later trips`, { skip: WORLD_MODE !== "prototype" }, () => {
    const { first, last, points } = roadTemplate();
    const original = structuredClone(points);
    points[0].x = -100;
    points[Math.floor(points.length / 2)].y = -100;
    points.pop();
    assert.deepEqual(getMapTravelPoints(first.id, last.id, mobile), original);
  });

  test(`${label} prototype optional routes join painted branches by kind and junction slot`, { skip: WORLD_MODE !== "prototype" }, () => {
    const { world: templateWorld, first, betweenSlots } = roadTemplate();
    assert.equal(branches.length, branchKinds.length);
    for (const [branchIndex, branch] of branches.entries()) {
      const kind = branchKinds[branchIndex];
      const templateDestination = templateWorld.breaks.find(stop => stop.kind === kind);
      assert.ok(templateDestination, `template has a ${kind} detour`);
      const [x0, y0, , , , , x3, y3] = coordinates(branch.path);
      assertPoint(asPercentage(x0, y0), anchors[branch.junctionSlot], `${kind} begins at its painted junction slot`);
      assertPoint(asPercentage(x3, y3), stopPoint(templateDestination, mobile), `${kind} ends at its actual map position`);
      const templateRoute = getMapTravelPoints(first.id, templateDestination.id, mobile);
      const junctionIndex = templateRoute.findIndex(point => samePoint(point, anchors[branch.junctionSlot]));
      assert.ok(junctionIndex >= 0, `${kind} visits its junction, which need not be a required stop`);
      const detour = templateRoute.slice(junctionIndex);
      // Expensive geometry inspection is performed once per shared branch, not once per world.
      assertOnCurve(detour, branch.path, width, height, kind);
      assertEvenSteps(detour, width, height);
      for (const world of worldPaths) {
        for (const destination of world.breaks.filter(stop => stop.kind === kind)) {
          assertPoint(stopPoint(destination, mobile), asPercentage(x3, y3), `${destination.id} uses the ${kind} branch endpoint`);
          for (const origin of world.stops) {
            const approach = betweenSlots(origin.mapSlot, branch.junctionSlot);
            const route = getMapTravelPoints(origin.id, destination.id, mobile);
            assert.deepEqual(route, [...approach, ...detour.slice(1)], `${origin.id} → ${destination.id} follows its road approach and detour without skipping anchors`);
            assert.deepEqual(route[0], stopPoint(origin, mobile));
            assert.deepEqual(route.at(-1), stopPoint(destination, mobile));
            assertEvenSteps(route, width, height);
          }
        }
      }
    }
    assert.ok(BREAK_STOPS.every(stop => branchKinds.includes(stop.kind)), "every optional kind has painted branch coverage");
  });

  test(`${label} travel rejects another world's required and optional destinations`, { skip: worldPaths.length < 2 }, () => {
    for (const [index, world] of worldPaths.entries()) {
      const other = worldPaths[(index + 1) % worldPaths.length];
      for (const origin of world.stops) {
        for (const destination of [...other.stops, ...other.breaks]) {
          assert.deepEqual(getMapTravelPoints(origin.id, destination.id, mobile), [], `${origin.id} cannot travel to ${destination.id}`);
        }
      }
    }
  });
}

test("unknown IDs and optional origins have no invented route", () => {
  for (const mobile of [false, true]) {
    const first = REQUIRED_STOPS[0].id;
    for (const unknown of ["", "invented-stop"]) {
      assert.deepEqual(getMapTravelPoints(unknown, first, mobile), []);
      assert.deepEqual(getMapTravelPoints(first, unknown, mobile), []);
      assert.deepEqual(getMapTravelPoints(unknown, unknown, mobile), []);
    }
    for (const world of worldPaths) {
      for (const optional of world.breaks) {
        for (const destination of [...world.stops, ...world.breaks]) {
          assert.deepEqual(getMapTravelPoints(optional.id, destination.id, mobile), []);
        }
      }
    }
  }
});
