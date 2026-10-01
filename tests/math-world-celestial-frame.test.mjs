import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeLighting } from "../app/math-world/globe-lighting.ts";

import { createGlobeReferenceFrame, rotateGlobeOnAxis } from "../app/math-world/globe-camera.ts";
import { getCelestialCycleAngle } from "../app/math-world/globe-celestial-frame.ts";
import { northUpGlobeOrientation, globeOrientationFocus, turnGlobeOrientation } from "../app/math-world/globe-navigation.ts";

const anchor = { x: .28, y: .19, z: .94 };

test("overview sun and stars stay in space while the planet turns and the moon orbits", () => {
  const scene = new THREE.Scene(), globe = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  const container = { style: { background: "", removeProperty() {} } };
  camera.position.set(0,0,4);
  scene.add(globe);
  const lighting = createGlobeLighting(scene,globe,camera,container,anchor);
  const stars = scene.getObjectByName("Fixed celestial sphere"), moon = scene.getObjectByName("Orbiting cratered moon");
  const light = scene.children.find(child => child.isDirectionalLight && child.castShadow);
  const reference = createGlobeReferenceFrame(), opening = northUpGlobeOrientation(anchor), cameraFrame = new THREE.Quaternion();
  function view(seconds, orientation) {
    reference.update(seconds,orientation,globe.quaternion,cameraFrame);
    camera.position.set(0,0,4).applyQuaternion(cameraFrame);
    camera.quaternion.copy(cameraFrame);
    camera.updateMatrixWorld();
    lighting.update(seconds,"cycle",globeOrientationFocus(orientation),0);
  }
  view(0,opening);
  const initialStars = stars.quaternion.clone(), initialCamera = camera.matrixWorld.clone();
  const firstSun = light.position.clone(), firstMoon = moon.position.clone(), background = container.style.background;
  for (const seconds of [0,45,90,177,310,360,927]) {
    view(seconds,rotateGlobeOnAxis(opening,-getCelestialCycleAngle(seconds)));
    assert.ok(light.position.distanceTo(firstSun) < 1e-10, "sunlight is stationary while the planet rotates");
    assert.ok(stars.quaternion.angleTo(initialStars) < 1e-7);
    assert.ok(camera.matrixWorld.elements.every((value,index)=>Math.abs(value-initialCamera.elements[index])<1e-10),"idle rotation keeps the observer stationary");
    assert.equal(container.style.background,background,"wide daylight never changes the space background");
    assert.equal(stars.children[0].material.uniforms.nightVisibility.value,1);
    if (seconds===0) assert.ok(moon.position.distanceTo(firstMoon) < 1e-10,"planet turns do not move the orbit");
    if (seconds===45) assert.ok(moon.position.distanceTo(firstMoon) > 1,"the moon still advances on its own orbit");
    assert.ok(lighting.sunDirection.clone().applyQuaternion(globe.quaternion).distanceTo(firstSun.clone().normalize()) < 1e-10,"surface and lunar shaders share the stationary light");
  }
  const pausedPlanet = globe.quaternion.clone(), pausedMoon = moon.position.clone(), pausedCamera = camera.quaternion.clone();
  view(927,turnGlobeOrientation(rotateGlobeOnAxis(opening,-getCelestialCycleAngle(927)),.4,-.2));
  assert.ok(globe.quaternion.angleTo(pausedPlanet)<1e-7,"dragging does not rotate the physical planet");
  assert.ok(moon.position.distanceTo(pausedMoon)<1e-10,"dragging does not move the moon's orbit");
  assert.ok(camera.quaternion.angleTo(pausedCamera)>.3,"dragging orbits the real camera");
  assert.ok(light.position.distanceTo(firstSun)<1e-10,"dragging leaves the automatic sun fixed in space");
  lighting.dispose();
});

test("close-up atmosphere returns day/night sky without changing the fixed star catalogue", () => {
  const scene = new THREE.Scene(), globe = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  const container = { style: { background: "", removeProperty() {} } };
  camera.position.set(0,-.4,1.5);
  const lighting = createGlobeLighting(scene,globe,camera,container,{x:0,y:0,z:1});
  const stars = scene.getObjectByName("Fixed celestial sphere");
  lighting.update(0,"day",{x:0,y:0,z:1},0);
  const space = container.style.background;
  lighting.update(0,"day",{x:0,y:0,z:1},1);
  assert.equal(stars.visible,false);
  assert.notEqual(container.style.background,space);
  lighting.update(0,"night",{x:0,y:0,z:1},1);
  assert.equal(stars.visible,true);
  assert.equal(stars.children[0].material.uniforms.nightVisibility.value,1);
  lighting.dispose();
});
