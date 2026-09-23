import assert from "node:assert/strict";
import test from "node:test";

import { desktopBonusRoad, desktopRoad, getMapTravelPoints, mobileBonusRoad, mobileRoad } from "../app/math-world/map-travel.ts";
import { BREAK_STOPS, REQUIRED_STOPS } from "../app/math-world/world-data.ts";

function stopPoint(stop, mobile) {
  return mobile ? { x: stop.mobileX, y: stop.mobileY } : { x: stop.x, y: stop.y };
}

for (const mobile of [false, true]) {
  const label = mobile ? "portrait" : "desktop";
  const width = mobile ? 400 : 1200;
  const height = mobile ? 960 : 740;
  const roads = mobile ? mobileRoad : desktopRoad;

  test(`${label} travel begins and ends at every actual required stop`, () => {
    for (const from of REQUIRED_STOPS) {
      for (const to of REQUIRED_STOPS) {
        const points = getMapTravelPoints(from.id, to.id, mobile);
        assert.deepEqual(points[0], stopPoint(from, mobile));
        assert.deepEqual(points.at(-1), stopPoint(to, mobile));
        assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100));
        if (from.id === to.id) assert.equal(points.length, 1);
        else assert.ok(points.length > 2);
      }
    }
  });

  test(`${label} travel follows the painted cubic instead of cutting across water`, () => {
    assert.equal(roads.length, REQUIRED_STOPS.length - 1);
    for (let index = 0; index < roads.length; index += 1) {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = roads[index].match(/-?\d+(?:\.\d+)?/g).map(Number);
      const from = REQUIRED_STOPS[index];
      const to = REQUIRED_STOPS[index + 1];
      assert.ok(Math.abs(x0 / width * 100 - stopPoint(from, mobile).x) < 1e-9);
      assert.ok(Math.abs(y0 / height * 100 - stopPoint(from, mobile).y) < 1e-9);
      assert.ok(Math.abs(x3 / width * 100 - stopPoint(to, mobile).x) < 1e-9);
      assert.ok(Math.abs(y3 / height * 100 - stopPoint(to, mobile).y) < 1e-9);
      const reference = Array.from({ length: 2001 }, (_, sample) => {
        const t = sample / 2000;
        const u = 1 - t;
        return {
          x: u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
          y: u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
        };
      });
      for (const point of getMapTravelPoints(from.id, to.id, mobile)) {
        const distance = Math.min(...reference.map(({ x, y }) => Math.hypot(x - point.x / 100 * width, y - point.y / 100 * height)));
        assert.ok(distance < 0.25, `${from.id}: avatar is ${distance}px away from its painted road`);
      }
    }
  });

  test(`${label} multi-stop trips visit each stop with roughly equal-distance steps and reverse faithfully`, () => {
    const first = REQUIRED_STOPS[0];
    const last = REQUIRED_STOPS.at(-1);
    const forward = getMapTravelPoints(first.id, last.id, mobile);
    const backward = getMapTravelPoints(last.id, first.id, mobile);
    assert.deepEqual(backward, [...forward].reverse());
    for (const stop of REQUIRED_STOPS) {
      const expected = stopPoint(stop, mobile);
      assert.ok(forward.some(({ x, y }) => x === expected.x && y === expected.y), stop.id);
    }
    const distances = forward.slice(1).map((point, index) => Math.hypot(
      (point.x - forward[index].x) / 100 * width,
      (point.y - forward[index].y) / 100 * height,
    ));
    assert.ok(Math.max(...distances) < 10.01);
    assert.ok(Math.min(...distances) > 8.5, "there are no tiny pause steps or duplicate joins");
    assert.ok(Math.max(...distances) / Math.min(...distances) < 1.12);

    const originalFirst = { ...forward[0] };
    forward[0].x = -100;
    assert.deepEqual(getMapTravelPoints(first.id, last.id, mobile)[0], originalFirst, "callers cannot corrupt cached routes");
  });

  test(`${label} optional trips take the painted junction and curved detour from every required origin`, () => {
    const branches = mobile ? mobileBonusRoad : desktopBonusRoad;
    assert.deepEqual(branches.map(({ stopId }) => stopId).sort(), BREAK_STOPS.map(({ id }) => id).sort());
    for (const branch of branches) {
      const destination = BREAK_STOPS.find(({ id }) => id === branch.stopId);
      const junction = REQUIRED_STOPS.find(({ id }) => id === branch.junctionStopId);
      assert.ok(junction, "every painted branch has a real required junction");
      const [x0, y0, x1, y1, x2, y2, x3, y3] = branch.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(Math.abs(x0 / width * 100 - stopPoint(junction, mobile).x) < 1e-9);
      assert.ok(Math.abs(y0 / height * 100 - stopPoint(junction, mobile).y) < 1e-9);
      assert.ok(Math.abs(x3 / width * 100 - stopPoint(destination, mobile).x) < 1e-9);
      assert.ok(Math.abs(y3 / height * 100 - stopPoint(destination, mobile).y) < 1e-9);
      const reference = Array.from({ length: 2001 }, (_, sample) => {
        const t = sample / 2000;
        const u = 1 - t;
        return {
          x: u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
          y: u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
        };
      });
      const detour = getMapTravelPoints(junction.id, destination.id, mobile);
      for (const point of detour) {
        const distance = Math.min(...reference.map(({ x, y }) => Math.hypot(x - point.x / 100 * width, y - point.y / 100 * height)));
        assert.ok(distance < 0.25, `${destination.id}: avatar is ${distance}px away from its painted branch`);
      }
      for (const origin of REQUIRED_STOPS) {
        const approach = getMapTravelPoints(origin.id, junction.id, mobile);
        const route = getMapTravelPoints(origin.id, destination.id, mobile);
        assert.deepEqual(route, [...approach, ...detour.slice(1)], "required approach joins the branch without a jump or duplicate point");
        assert.deepEqual(route[0], stopPoint(origin, mobile));
        assert.deepEqual(route.at(-1), stopPoint(destination, mobile));
        const distances = route.slice(1).map((point, index) => Math.hypot(
          (point.x - route[index].x) / 100 * width,
          (point.y - route[index].y) / 100 * height,
        ));
        assert.ok(Math.max(...distances) < 10.01);
        assert.ok(Math.min(...distances) > 8.5);
      }
    }
  });
}

test("unknown IDs and optional origins have no invented route", () => {
  const first = REQUIRED_STOPS[0].id;
  for (const unknown of ["", "invented-stop"]) {
    assert.deepEqual(getMapTravelPoints(unknown, first), []);
    assert.deepEqual(getMapTravelPoints(first, unknown, true), []);
    assert.deepEqual(getMapTravelPoints(unknown, unknown), []);
  }
  for (const optional of BREAK_STOPS) {
    for (const destination of [...REQUIRED_STOPS, ...BREAK_STOPS]) {
      assert.deepEqual(getMapTravelPoints(optional.id, destination.id), []);
      assert.deepEqual(getMapTravelPoints(optional.id, destination.id, true), []);
    }
  }
});
