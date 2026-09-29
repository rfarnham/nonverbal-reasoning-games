import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createCelestialFrame, SKY_CYCLE_SECONDS } from "../app/math-world/globe-celestial-frame.ts";
import { getGlobeSunDirection } from "../app/math-world/globe-lighting.ts";

const anchor = { x: .28, y: .19, z: .94 };
const near = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-10, message);

test("initial celestial composition is preserved and a quarter-day turns stars in the sunlight direction", () => {
  const frame = createCelestialFrame(anchor), pose = new THREE.Quaternion();
  const initialView = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3().copy(anchor), new THREE.Vector3(), new THREE.Vector3(0,1,0))).invert();
  frame.update(0,initialView,pose);
  near(new THREE.Vector3(0,0,1).applyQuaternion(pose),new THREE.Vector3(0,0,1),"authored initial sky is unchanged");
  frame.update(SKY_CYCLE_SECONDS/4,initialView,pose);
  near(new THREE.Vector3(0,0,1).applyQuaternion(pose),new THREE.Vector3(1,0,0),"daily rotation has the same positive sign as the sun");
  frame.update(SKY_CYCLE_SECONDS,initialView,pose);
  near(new THREE.Vector3(0,0,1).applyQuaternion(pose),new THREE.Vector3(0,0,1),"one day closes without a discontinuity");
  for (const seconds of [NaN,Infinity,-1]) {
    frame.update(seconds,initialView,pose);
    near(new THREE.Vector3(0,0,1).applyQuaternion(pose),new THREE.Vector3(0,0,1));
  }
});

test("automatic sun remains fixed in celestial coordinates across daily time and globe navigation", () => {
  for (const origin of [anchor,{x:0,y:1,z:0},{x:0,y:-1,z:0}]) {
    const frame = createCelestialFrame(origin), pose = new THREE.Quaternion();
    for (const seconds of [0,45,90,177,310,360,927]) {
      const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(seconds/370,.64,seconds/510));
      frame.update(seconds,view,pose);
      const sunInSky = getGlobeSunDirection(seconds,"cycle",{x:0,y:0,z:1},origin).applyQuaternion(view).applyQuaternion(pose.clone().invert());
      near(sunInSky,new THREE.Vector3(Math.sin(.62),0,Math.cos(.62)),"sky and automatic sunlight must share one inertial reference frame");
    }
  }
});

test("navigation changes the apparent sky even when scenery time is paused, without moving stars within their sphere", () => {
  const frame = createCelestialFrame(anchor), first = new THREE.Quaternion(), next = new THREE.Quaternion();
  const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(.23,-.84,0));
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.7);
  frame.update(74,view,first);
  frame.update(74,turn.clone().multiply(view),next);
  const a = new THREE.Vector3(.2,.4,-.7).normalize(), b = new THREE.Vector3(-.6,.4,-.3).normalize();
  const before = a.clone().applyQuaternion(first), after = a.clone().applyQuaternion(next);
  assert.ok(before.distanceTo(after) > .1,"turning the view cannot leave screen-fixed stars");
  near(after,before.applyQuaternion(turn),"same view transform as the planet");
  assert.ok(Math.abs(a.angleTo(b)-after.angleTo(b.clone().applyQuaternion(next))) < 1e-10,"the constellation remains rigid");
  const paused = next.toArray();
  frame.update(74,turn.clone().multiply(view),next);
  assert.deepEqual(next.toArray(),paused,"identical paused pose with no accumulated drift");
});
