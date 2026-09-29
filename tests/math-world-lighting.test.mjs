import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { getGlobeSunDirection, getNightSkyVisibility, SKY_CYCLE_SECONDS } from "../app/math-world/globe-lighting.ts";

test("sun presets keep the inspected coast lit, at twilight, or on the night side", () => {
  const anchor = { x: 0, y: 0, z: 1 };
  for (const focus of [anchor, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
    const day = getGlobeSunDirection(0, "day", focus, anchor);
    const dusk = getGlobeSunDirection(0, "sunset", focus, anchor);
    const night = getGlobeSunDirection(0, "night", focus, anchor);
    for (const sun of [day, dusk, night]) assert.ok(Math.abs(sun.length()-1) < 1e-10);
    const normal = new Vector3().copy(focus);
    assert.ok(day.dot(normal) > .8);
    assert.ok(Math.abs(dusk.dot(normal)) < .03);
    assert.ok(night.dot(normal) < -.8);
  }
});

test("automatic sun is independent of camera navigation and loops only on active scenery time", () => {
  const anchor = { x: 0, y: 0, z: 1 };
  const start = getGlobeSunDirection(0, "cycle", anchor, anchor);
  const orbit = getGlobeSunDirection(0, "cycle", { x: 0, y: -1, z: 0 }, anchor);
  assert.ok(start.distanceTo(orbit) < 1e-10);
  assert.ok(start.distanceTo(getGlobeSunDirection(SKY_CYCLE_SECONDS, "cycle", anchor, anchor)) < 1e-10);
  assert.ok(start.dot(getGlobeSunDirection(SKY_CYCLE_SECONDS/2, "cycle", anchor, anchor)) < -.999);
  assert.ok(start.distanceTo(getGlobeSunDirection(NaN, "cycle", anchor, anchor)) < 1e-10);
});

test("celestial sky is absent at day and sunset, and fully revealed on the night side", () => {
  const anchor = { x: 0, y: 0, z: 1 };
  for (const focus of [anchor, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
    for (const mode of ["day", "sunset"]) assert.equal(getNightSkyVisibility(getGlobeSunDirection(0, mode, focus, anchor), focus), 0);
    assert.equal(getNightSkyVisibility(getGlobeSunDirection(0, "night", focus, anchor), focus), 1);
  }
});

test("night visibility fades monotonically below the horizon and follows the viewed coast", () => {
  const sun = new Vector3(0, 0, 1);
  const values = [-.5, -.38, -.3, -.23, -.15, -.08, 0, .5].map(facing => getNightSkyVisibility(sun, { x: Math.sqrt(1-facing*facing), y: 0, z: facing }));
  assert.equal(values[0], 1);
  assert.ok(values[2] > .5 && values[2] < 1);
  assert.ok(Math.abs(values[3]-.5) < 1e-12);
  assert.equal(values[5], 0);
  assert.ok(values.every((value, index) => index === 0 || value <= values[index-1]));
  assert.equal(getNightSkyVisibility(sun, { x: 0, y: 0, z: -3 }), 1);
  assert.equal(getNightSkyVisibility(sun, { x: 0, y: 0, z: 3 }), 0);
  assert.equal(getNightSkyVisibility(sun, { x: 0, y: 0, z: 0 }), 0);
  assert.equal(getNightSkyVisibility({ x: NaN, y: 0, z: 0 }, sun), 0);
});

test("manual preset illumination carries the quaternion horizon continuously over both poles", async () => {
  const { globeOrientationFocus, northUpGlobeOrientation, rotateGlobeDirection, turnGlobeOrientation } = await import('../app/math-world/globe-navigation.ts');
  const anchor = { x: 0, y: 0, z: 1 };
  let orientation = northUpGlobeOrientation(anchor);
  const expected = new Map(['day', 'sunset', 'night'].map(mode => [mode, getGlobeSunDirection(0, mode, anchor, anchor)]));
  const automatic = getGlobeSunDirection(41, 'cycle', anchor, anchor);
  for (let step = 0; step <= 720; step++) {
    const focus = globeOrientationFocus(orientation);
    const inverse = { x: -orientation.x, y: -orientation.y, z: -orientation.z, w: orientation.w };
    const screenRight = rotateGlobeDirection({ x: 1, y: 0, z: 0 }, inverse);
    for (const mode of ['day', 'sunset', 'night']) {
      const sun = getGlobeSunDirection(0, mode, focus, anchor, new Vector3(), screenRight);
      const inView = new Vector3().copy(rotateGlobeDirection(sun, orientation));
      assert.ok(inView.distanceTo(expected.get(mode)) < 1e-9, `${mode} never flips its light across a pole`);
    }
    assert.ok(automatic.distanceTo(getGlobeSunDirection(41, 'cycle', focus, anchor, new Vector3(), screenRight)) < 1e-9, 'automatic sun ignores the camera tangent');
    orientation = turnGlobeOrientation(orientation, .001, Math.PI / 360);
  }
});
