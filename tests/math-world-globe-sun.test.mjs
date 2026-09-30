import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeSun } from "../app/math-world/globe-sun.ts";

test("the distant sun stays compact, circular and inside desktop and phone viewports", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const effect = createGlobeSun(scene, camera), sun = scene.children[0];
  for (const [width, height] of [[1440, 900], [820, 900], [620, 900], [390, 844], [844, 390]]) {
    camera.position.set(0,0,0);
    camera.quaternion.identity();
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    sun.onBeforeRender({ getSize: size => size.set(width, height) });
    const { sunDirection, sunHalfSize } = sun.material.uniforms;
    const sunCenter = sunDirection.value.clone().project(camera);
    const horizontalRadius = sunHalfSize.value.x * width / 2;
    const verticalRadius = sunHalfSize.value.y * height / 2;
    assert.ok(Math.abs(horizontalRadius - verticalRadius) < 1e-10, "aspect never turns the solar disc into an oval");
    assert.ok(horizontalRadius <= 64, "corona footprint remains bounded on large displays");
    assert.ok(horizontalRadius >= 50, "phone disc remains visible");
    assert.ok(sunCenter.x + sunHalfSize.value.x < 1, "corona has a right margin");
    assert.ok(sunCenter.y + sunHalfSize.value.y < 1, "corona stays below top controls");
    camera.position.set(width / 100, 3, -5);
    camera.rotation.set(.4, .2, 1.2);
    const composedDirection = sunDirection.value.clone();
    camera.updateMatrixWorld();
    effect.update(0);
    sun.onBeforeRender({ getSize: size => size.set(width, height) });
    assert.deepEqual(sunDirection.value, composedDirection, "navigation leaves the sun at its authored direction in space");
    const viewDirection = composedDirection.clone().applyQuaternion(camera.quaternion.clone().invert());
    assert.ok(viewDirection.distanceTo(composedDirection)>.1,"an orbiting camera sees a different solar position");
  }
  effect.dispose();
});

test("sun fades with atmosphere and preserves foreground occlusion in a single local draw", () => {
  const scene = new THREE.Scene(), effect = createGlobeSun(scene, new THREE.PerspectiveCamera());
  const sun = scene.children[0];
  assert.equal(scene.children.length, 1);
  assert.equal(sun.geometry.index.count / 3, 2);
  assert.equal(sun.material.depthTest, true);
  assert.equal(sun.material.depthWrite, false);
  assert.equal(sun.material.fog, false);
  assert.ok(Object.values(sun.material.uniforms).every(uniform => !uniform.value?.isTexture));
  for (const [atmosphere, expected] of [[0, 1], [.25, .75], [.8, .2], [1, 0], [3, 0], [-1, 1], [NaN, 1]]) {
    effect.update(atmosphere);
    assert.ok(Math.abs(sun.material.uniforms.sunVisibility.value - expected) < 1e-10);
    assert.equal(sun.visible, expected > 0);
  }
  let disposedGeometry = 0, disposedMaterial = 0;
  sun.geometry.addEventListener("dispose", () => disposedGeometry++);
  sun.material.addEventListener("dispose", () => disposedMaterial++);
  effect.dispose(); effect.dispose(); effect.update(0);
  assert.equal(scene.children.length, 0);
  assert.equal(disposedGeometry, 1);
  assert.equal(disposedMaterial, 1);
});
