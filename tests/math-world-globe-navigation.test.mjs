import assert from "node:assert/strict";
import test from "node:test";
import {
  globeOrientationFocus, interpolateGlobeOrientation, northUpGlobeOrientation,
  rotateGlobeDirection, transportGlobeOrientation, turnGlobeOrientation, voyageProgress, advanceGlobeAnimationTime, globeTransitionDuration,
} from "../app/math-world/globe-navigation.ts";
import { getSurfaceRouteLength, getSurfaceRouteTangent, getVoyageRoute, sampleSurfaceRoute, sphericalAngle } from "../app/math-world/globe-geometry.ts";

const front = { x: 0, y: 0, z: 1 };
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const closePoint = (a, b) => { close(a.x, b.x); close(a.y, b.y); close(a.z, b.z); };
const turnAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));

test("free globe rotations cross both poles continuously and return after a complete revolution", () => {
  const initial = northUpGlobeOrientation(front);
  let orientation = initial, north = false, south = false;
  for (let index = 1; index <= 720; index++) {
    const previous = orientation;
    orientation = turnGlobeOrientation(orientation, 0, Math.PI / 360);
    const focus = globeOrientationFocus(orientation);
    closePoint(rotateGlobeDirection(focus, orientation), front);
    close(turnAngle(previous, orientation), Math.PI / 360, 1e-10);
    close(Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w), 1);
    if (focus.y > .999999) north = true;
    if (focus.y < -.999999) south = true;
  }
  assert.ok(north && south, "neither pole has a latitude clamp or a flipped horizon");
  close(turnAngle(initial, orientation), 0);
  closePoint(globeOrientationFocus(orientation), front);
});

test("drag directions remain screen relative after a pole crossing, including mixed-axis turns", () => {
  const overPole = turnGlobeOrientation(northUpGlobeOrientation(front), 0, 2.1);
  const next = turnGlobeOrientation(overPole, .2, -.1);
  const oldFocusInNextView = rotateGlobeDirection(globeOrientationFocus(overPole), next);
  assert.ok(oldFocusInNextView.x < 0 && oldFocusInNextView.y > 0);
  closePoint(rotateGlobeDirection(globeOrientationFocus(next), next), front);
  assert.throws(() => turnGlobeOrientation(next, NaN, 0));
});

test("voyage camera parallel transport has no polar singularity, drift, or instantaneous north reset", () => {
  let orientation = northUpGlobeOrientation(front);
  for (let step = 1; step <= 720; step++) {
    const angle = step * Math.PI / 360;
    const focus = { x: 0, y: Math.sin(angle), z: Math.cos(angle) };
    const previous = orientation;
    orientation = transportGlobeOrientation(orientation, focus);
    closePoint(globeOrientationFocus(orientation), focus);
    close(turnAngle(previous, orientation), Math.PI / 360, 1e-10);
  }
  const antipode = transportGlobeOrientation(orientation, { x: 0, y: 0, z: -1 });
  closePoint(globeOrientationFocus(antipode), { x: 0, y: 0, z: -1 });
});

test("a focus transition continuously restores authored north-up from any free orbit", () => {
  const from = turnGlobeOrientation(northUpGlobeOrientation(front), 1.7, 2.4);
  const target = northUpGlobeOrientation({ x: .3, y: -.4, z: Math.sqrt(.75) });
  let previous = from;
  for (let step = 0; step <= 100; step++) {
    const orientation = interpolateGlobeOrientation(from, target, step / 100);
    closePoint(rotateGlobeDirection(globeOrientationFocus(orientation), orientation), front);
    assert.ok(turnAngle(previous, orientation) < .032, "no reset or spin in a close-view transition");
    previous = orientation;
  }
  close(turnAngle(previous, target), 0, 1e-7);
});

test("voyage has one smooth acceleration and arrival, maintaining full speed through its midpoint", () => {
  close(voyageProgress(0), 0); close(voyageProgress(1), 1);
  close(voyageProgress(.5), .5);
  const velocity = t => (voyageProgress(t + .0001) - voyageProgress(t - .0001)) / .0002;
  assert.ok(velocity(0) < .00001 && velocity(1) < .00001);
  close(velocity(.499), velocity(.501), 1e-9);
  assert.ok(velocity(.5) > 1, "there is no artificial stop halfway across the ocean");
  for (let step = 1; step <= 1000; step++) assert.ok(voyageProgress(step / 1000) > voyageProgress((step - 1) / 1000));
});

test("slow rendering advances navigation by at most one bounded step, without later catch-up", () => {
  let elapsed = 0;
  const frames = [16, 16, 315, 18, 386, 16, 1000, 16];
  for (const frame of frames) {
    const next = advanceGlobeAnimationTime(elapsed, frame, 3000);
    close(next - elapsed, Math.min(40, frame));
    elapsed = next;
  }
  close(elapsed, 202);
  close(advanceGlobeAnimationTime(2990, 400, 3000), 3000);
  close(advanceGlobeAnimationTime(200, NaN, 3000), 200);
  close(advanceGlobeAnimationTime(200, -10, 3000), 200);
  let framesToFinish = 0;
  for (elapsed = 0; elapsed < 2400; framesToFinish++) elapsed = advanceGlobeAnimationTime(elapsed, 100, 2400);
  assert.equal(framesToFinish, 60, "a slow GPU receives all logical animation frames rather than a deadline jump");
});

test("long focus/arrival turns use enough time to keep capped frame rotations gentle", () => {
  const from = northUpGlobeOrientation(front);
  for (const angle of [.05, .8, 1.9, Math.PI]) {
    const to = turnGlobeOrientation(from, 0, angle), duration = globeTransitionDuration(from, to, 1);
    let previous = from;
    for (let elapsed = 0; elapsed <= duration; elapsed += 40) {
      const t = elapsed / duration, eased = t*t*(3-2*t);
      const pose = interpolateGlobeOrientation(from, to, eased);
      assert.ok(turnAngle(previous, pose) < .075, "a slow frame never skips a visible chunk of the focus turn");
      previous = pose;
    }
  }
});

test("rounded sailing routes keep a continuous heading and near-constant angular travel", () => {
  // Long trips exercise mainland detours, polar coasts, and the storm harbor.
  for (const [from, to] of [[1, 32], [1, 16], [4, 24], [9, 27], [16, "boss-2025"], ["boss-2025", 17]]) {
    const route = getVoyageRoute(from, to), length = getSurfaceRouteLength(route);
    let previous = sampleSurfaceRoute(route, 0), heading = getSurfaceRouteTangent(route, 0);
    for (let step = 1; step <= 2000; step++) {
      const point = sampleSurfaceRoute(route, step / 2000), tangent = getSurfaceRouteTangent(route, step / 2000);
      assert.ok(sphericalAngle(heading, tangent) < .14, `${from}→${to} turns smoothly at ${step}`);
      close(sphericalAngle(previous, point), length / 2000, .00003);
      previous = point; heading = tangent;
    }
  }
});
