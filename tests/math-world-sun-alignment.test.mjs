import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeLighting } from "../app/math-world/globe-lighting.ts";
import { createGlobeOcean } from "../app/math-world/globe-ocean.ts";
import { createGlobeReferenceFrame } from "../app/math-world/globe-camera.ts";
import { northUpGlobeOrientation, turnGlobeOrientation, globeOrientationFocus } from "../app/math-world/globe-navigation.ts";

const anchor = { x: .28, y: .19, z: .94 };
const sameDirection = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-10, message);

function fixture() {
  const scene = new THREE.Scene(), globe = new THREE.Group(), camera = new THREE.PerspectiveCamera(37, 1.6, .02, 12);
  scene.add(globe);
  const lighting = createGlobeLighting(scene, globe, camera, { style: { removeProperty() {} } }, anchor);
  const ocean = createGlobeOcean();
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  ocean.material.onBeforeCompile(shader, {});
  const sun = scene.getObjectByName("Distant sun"), moon = scene.getObjectByName("Orbiting cratered moon");
  const light = scene.children.find(object => object.isDirectionalLight);
  return { scene, globe, camera, lighting, ocean, shader, sun, moon, light,
    dispose() { ocean.dispose(); lighting.dispose(); } };
}

test("visible sun, surface daylight, ocean reflections and lunar phase share one source through time, presets, pole orbits and zoom", () => {
  const f = fixture(), reference = createGlobeReferenceFrame(), cameraFrame = new THREE.Quaternion();
  const opening = northUpGlobeOrientation(anchor);
  const orientations = [opening, turnGlobeOrientation(opening, .8, .3), turnGlobeOrientation(opening, -.4, Math.PI / 2), turnGlobeOrientation(opening, .2, Math.PI)];
  const canonical = new THREE.PerspectiveCamera();
  for (const mode of ["cycle", "day", "sunset", "night"]) {
    for (const seconds of [0, 31, 90, 180, 360]) {
      for (const orientation of orientations) {
        for (const zoom of [0, .8, 1]) {
          reference.update(seconds, orientation, f.globe.quaternion, cameraFrame);
          canonical.position.set(0, -.42 * zoom, 3.7 - 2.2 * zoom);
          canonical.lookAt(0, 0, zoom);
          f.camera.position.copy(canonical.position).applyQuaternion(cameraFrame);
          f.camera.quaternion.copy(cameraFrame).multiply(canonical.quaternion);
          f.camera.updateMatrixWorld();
          const focus = globeOrientationFocus(orientation);
          f.lighting.update(seconds, mode, focus, zoom);
          f.ocean.update(seconds, f.globe, f.camera, f.lighting.sunDirection);
          const source = f.light.position.clone().sub(f.light.target.position).normalize();
          sameDirection(f.sun.material.uniforms.sunDirection.value, source, "the visible disc is the actual directional light");
          sameDirection(f.lighting.sunDirection.clone().applyQuaternion(f.globe.quaternion), source, "day/night uses the same source in planet coordinates");
          sameDirection(f.shader.uniforms.seaSunView.value, source.clone().transformDirection(f.camera.matrixWorldInverse), "water reflects the visible sun in camera space");
          sameDirection(f.moon.material.uniforms.lunarSun.value, source, "the moon's illuminated hemisphere faces the visible sun");
          sameDirection(f.moon.material.uniforms.lunarLocalSun.value.clone().applyQuaternion(f.moon.quaternion), source, "crater rim light and shadows face the same sun");
          const observer = f.camera.position.clone().sub(f.moon.position).normalize();
          const phase = (1 + source.dot(observer)) / 2;
          assert.ok(Math.abs(f.moon.userData.illuminatedFraction - phase) < 1e-10, "lunar phase follows the actual observer and shared sun");
          const worldFocus = new THREE.Vector3().copy(focus).applyQuaternion(f.globe.quaternion);
          const solarElevation = worldFocus.dot(source);
          if (mode === "day") assert.ok(solarElevation > .8);
          if (mode === "sunset") assert.ok(Math.abs(solarElevation) < .03);
          if (mode === "night") assert.ok(solarElevation < -.8);
          if (zoom === 0) assert.equal(f.scene.getObjectByName("Fixed celestial sphere").children[0].material.uniforms.nightVisibility.value, 1);
        }
      }
    }
  }
  f.dispose();
});

test("the only directional highlight reflects the visible sun; night fill cannot create an opposite glint", () => {
  const f = fixture();
  assert.equal(f.scene.children.filter(object => object.isDirectionalLight).length, 1);
  assert.equal(f.scene.children.filter(object => object.isAmbientLight).length, 1);
  f.globe.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.73);
  f.camera.position.set(0, 0, 4); f.camera.updateMatrixWorld();
  f.lighting.update(42, "cycle", anchor, 0);
  const source = f.sun.material.uniforms.sunDirection.value.clone();
  const tangent = new THREE.Vector3(0, 1, 0).cross(source).normalize();
  const normal = source.clone().addScaledVector(tangent, .6).normalize();
  const surfaceToEye = source.clone().negate().reflect(normal);
  f.camera.position.copy(normal).addScaledVector(surfaceToEye, 3);
  f.camera.lookAt(normal); f.camera.updateMatrixWorld();
  f.ocean.update(42, f.globe, f.camera, f.lighting.sunDirection);
  const localNormal = normal.clone().applyQuaternion(f.globe.quaternion.clone().invert());
  const viewNormal = localNormal.applyMatrix3(f.shader.uniforms.seaRotation.value).normalize();
  const reflected = surfaceToEye.clone().transformDirection(f.camera.matrixWorldInverse).negate().reflect(viewNormal);
  sameDirection(reflected, f.shader.uniforms.seaSunView.value, "the water's specular ray points at the projected solar disc");
  f.dispose();
});
