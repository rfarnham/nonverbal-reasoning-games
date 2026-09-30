import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeReferenceFrame, rotateGlobeOnAxis } from "../app/math-world/globe-camera.ts";
import { getCelestialCycleAngle, SKY_CYCLE_SECONDS } from "../app/math-world/globe-celestial-frame.ts";
import { northUpGlobeOrientation, turnGlobeOrientation } from "../app/math-world/globe-navigation.ts";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} ≈ ${expected}`);
const closeVector = (actual, expected) => { close(actual.x, expected.x); close(actual.y, expected.y); close(actual.z, expected.z); };
const quaternion = value => new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize();
const sameRotation = (actual, expected) => close(Math.abs(actual.dot(expected)), 1, 1e-12);
const front = { x: 0, y: 0, z: 1 };

test("physical planet rotation preserves both geographic poles independently of camera navigation", () => {
  const reference = createGlobeReferenceFrame(), planet = new THREE.Quaternion(), cameraFrame = new THREE.Quaternion();
  const orientation = turnGlobeOrientation(northUpGlobeOrientation(front), 1.7, 2.4);
  const north = new THREE.Vector3(0, 1, 0), south = new THREE.Vector3(0, -1, 0);
  for (const seconds of [0, 17, 90, 180, 270, 360, 815]) {
    reference.update(seconds, orientation, planet, cameraFrame);
    closeVector(north.clone().applyQuaternion(planet), north);
    closeVector(south.clone().applyQuaternion(planet), south);
    const expected = new THREE.Vector3(Math.sin(-getCelestialCycleAngle(seconds)), 0, Math.cos(-getCelestialCycleAngle(seconds)));
    closeVector(new THREE.Vector3(0, 0, 1).applyQuaternion(planet), expected);
  }
  reference.update(0, orientation, planet, cameraFrame);
  const start = planet.clone();
  reference.update(SKY_CYCLE_SECONDS, orientation, planet, cameraFrame);
  sameRotation(planet, start);
});

test("dragging at paused scenery time changes the real camera frame and leaves the planet pose fixed", () => {
  const reference = createGlobeReferenceFrame(), planet = new THREE.Quaternion(), cameraFrame = new THREE.Quaternion();
  let orientation = northUpGlobeOrientation({ x: .3, y: .4, z: Math.sqrt(.75) });
  reference.update(83, orientation, planet, cameraFrame);
  const initialPlanet = planet.clone(), initialCamera = cameraFrame.clone();
  const initialEye = new THREE.Vector3(0, 0, 4).applyQuaternion(cameraFrame);
  orientation = turnGlobeOrientation(orientation, .7, 1.8);
  reference.update(83, orientation, planet, cameraFrame);
  sameRotation(planet, initialPlanet);
  assert.ok(cameraFrame.angleTo(initialCamera) > 1, "the observer genuinely orbits in world space");
  assert.ok(new THREE.Vector3(0, 0, 4).applyQuaternion(cameraFrame).distanceTo(initialEye) > 1);
  const fixedStar = new THREE.Vector3(.2, .1, -1).normalize();
  assert.ok(fixedStar.clone().applyQuaternion(initialCamera.clone().invert()).distanceTo(fixedStar.clone().applyQuaternion(cameraFrame.clone().invert())) > .1,
    "a fixed celestial direction moves across the view when the camera turns");
  const pausedCamera = cameraFrame.clone();
  reference.update(83, orientation, planet, cameraFrame);
  sameRotation(cameraFrame, pausedCamera);
});

test("equal signed axial increments keep the overview observer and celestial view stationary without drift", () => {
  const reference = createGlobeReferenceFrame(), planet = new THREE.Quaternion(), cameraFrame = new THREE.Quaternion();
  let orientation = turnGlobeOrientation(northUpGlobeOrientation(front), -.8, 2.2), seconds = 217.125;
  reference.update(seconds, orientation, planet, cameraFrame);
  const initialCamera = cameraFrame.clone();
  for (let index = 0; index < 6000; index++) {
    const nextSeconds = seconds + [.016, .033, .05, .008][index % 4];
    const delta = -getCelestialCycleAngle(nextSeconds) + getCelestialCycleAngle(seconds);
    orientation = rotateGlobeOnAxis(orientation, delta);
    reference.update(nextSeconds, orientation, planet, cameraFrame);
    sameRotation(cameraFrame, initialCamera);
    close(Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w), 1);
    seconds = nextSeconds;
  }
});

test("axial compensation uses the geographic poles even when the observer is over a pole or rolled", () => {
  const north = new THREE.Vector3(0, 1, 0), south = north.clone().negate();
  for (const direction of [front, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
    const orientation = turnGlobeOrientation(northUpGlobeOrientation(direction), .9, 1.1);
    for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 2.6]) {
      const next = quaternion(rotateGlobeOnAxis(orientation, angle));
      closeVector(north.clone().applyQuaternion(next), north.clone().applyQuaternion(quaternion(orientation)));
      closeVector(south.clone().applyQuaternion(next), south.clone().applyQuaternion(quaternion(orientation)));
    }
  }
});

test("real world camera frames preserve authored marker projections, depth and occlusion throughout tilted and polar views", () => {
  const reference = createGlobeReferenceFrame(), planet = new THREE.Quaternion(), cameraFrame = new THREE.Quaternion();
  const directions = [front, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: .3, y: -.4, z: Math.sqrt(.75) }];
  for (const direction of directions) for (const drag of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2], [1.7, 2.4]]) {
    const orientation = turnGlobeOrientation(northUpGlobeOrientation(direction), ...drag);
    for (const aspect of [390 / 844, 1, 1440 / 900]) for (const zoom of [0, .38, 1]) {
      const canonical = new THREE.PerspectiveCamera(37, aspect, .02, 12);
      const tilt = (aspect < 1 ? 35 : 45) * Math.PI / 180;
      canonical.position.set(0, -.8 * Math.sin(tilt) * zoom, THREE.MathUtils.lerp(4.8, 1 + .8 * Math.cos(tilt), zoom));
      canonical.lookAt(0, 0, zoom);
      canonical.updateMatrixWorld();
      const actual = canonical.clone();
      for (const seconds of [0, 90, 241]) {
        reference.update(seconds, orientation, planet, cameraFrame);
        actual.position.copy(canonical.position).applyQuaternion(cameraFrame);
        actual.quaternion.copy(cameraFrame).multiply(canonical.quaternion);
        actual.updateMatrixWorld();
        for (let index = 0; index < 24; index++) {
          const latitude = -1 + (index + .5) / 12, longitude = index * 2.399963;
          const ring = Math.sqrt(1 - latitude * latitude);
          const local = new THREE.Vector3(Math.sin(longitude) * ring, latitude, Math.cos(longitude) * ring).multiplyScalar(1.031);
          const priorPoint = local.clone().applyQuaternion(quaternion(orientation));
          const worldPoint = local.clone().applyQuaternion(planet);
          closeVector(worldPoint.clone().project(actual), priorPoint.clone().project(canonical));
          const priorEye = canonical.position.clone().sub(priorPoint), currentEye = actual.position.clone().sub(worldPoint);
          close(currentEye.dot(worldPoint), priorEye.dot(priorPoint));
          close(currentEye.length(), priorEye.length());
        }
      }
    }
  }
});

test("the reference frame reuses caller outputs, normalizes input and rejects invalid orientation", () => {
  const reference = createGlobeReferenceFrame(), planet = new THREE.Quaternion(), cameraFrame = new THREE.Quaternion();
  const orientation = { x: 1, y: 2, z: 3, w: 4 };
  assert.equal(reference.update(20, orientation, planet, cameraFrame), undefined);
  close(planet.length(), 1); close(cameraFrame.length(), 1);
  const firstPlanet = planet.clone(), firstCamera = cameraFrame.clone();
  reference.update(20, quaternion(orientation), planet, cameraFrame);
  sameRotation(planet, firstPlanet); sameRotation(cameraFrame, firstCamera);
  for (const seconds of [NaN, Infinity, -10]) {
    reference.update(seconds, orientation, planet, cameraFrame);
    sameRotation(planet, new THREE.Quaternion());
  }
  assert.throws(() => rotateGlobeOnAxis(orientation, NaN));
  for (const invalid of [{ x: 0, y: 0, z: 0, w: 0 }, { x: NaN, y: 0, z: 0, w: 1 }]) {
    assert.throws(() => reference.update(0, invalid, planet, cameraFrame));
    assert.throws(() => rotateGlobeOnAxis(invalid, .1));
  }
});
