import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CELESTIAL_SKY_RADIUS, CELESTIAL_STAR_COUNT, createCelestialStarCatalogue, createGlobeCelestialSky } from "../app/math-world/globe-celestial-sky.ts";

test("the celestial catalogue is repeatable, irregular and fills the entire sphere", () => {
  const first = createCelestialStarCatalogue(), second = createCelestialStarCatalogue();
  assert.deepEqual(first, second, "reloads and world visits show the same sky");
  assert.equal(first.positions.length, CELESTIAL_STAR_COUNT * 3);
  const octants = new Array(8).fill(0), occupied = new Set();
  const galacticNormal = new THREE.Vector3(.955, .23, .187).normalize();
  const point = new THREE.Vector3();
  let belt = 0, bright = 0, small = 0;
  for (let star = 0; star < CELESTIAL_STAR_COUNT; star++) {
    point.fromArray(first.positions, star * 3);
    assert.ok(Math.abs(point.length() - (CELESTIAL_SKY_RADIUS - .08)) < 1e-6);
    octants[(point.x > 0 ? 1 : 0) + (point.y > 0 ? 2 : 0) + (point.z > 0 ? 4 : 0)]++;
    const identity = point.toArray().map(value => value.toFixed(5)).join(",");
    assert.ok(!occupied.has(identity), "no coincident star sprites");
    occupied.add(identity);
    if (Math.abs(point.normalize().dot(galacticNormal)) < .16) belt++;
    if (first.sizes[star] >= 7) bright++;
    if (first.sizes[star] < 3) small++;
    assert.ok(Number.isFinite(first.brightness[star]) && first.brightness[star] > 0 && first.brightness[star] <= 1.25);
  }
  assert.ok(octants.every(count => count > 900), "no empty sky direction");
  assert.ok(belt > CELESTIAL_STAR_COUNT * .4 && belt < CELESTIAL_STAR_COUNT * .6, "denser Milky Way with a populated surrounding sky");
  assert.ok(bright > 30 && bright < 100, "occasional bright stars, without a sky full of flare sprites");
  assert.ok(small > CELESTIAL_STAR_COUNT * .85, "pinpoints dominate the field");
});

test("night visibility gates every celestial draw and the sphere remains behind the planet", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(37, 1, .02, 12);
  const sky = createGlobeCelestialSky(scene, camera), group = scene.children[0];
  assert.equal(group.visible, false);
  for (const visibility of [-2, 0, NaN, Infinity]) {
    sky.update(0, visibility);
    assert.equal(group.visible, false, "no daytime or invalid-state sky draws");
  }
  for (const visibility of [.01, .5, 1, 2]) {
    sky.update(0, visibility);
    assert.equal(group.visible, true);
    for (const object of group.children) {
      assert.equal(object.material.uniforms.nightVisibility.value, Math.min(visibility, 1));
      assert.equal(object.material.depthTest, true, "opaque planet and lunar relief hide stars behind them");
      assert.equal(object.material.depthWrite, false, "sky cannot cover closer transparent scenery");
      assert.equal(object.material.fog, false, "planet-local fog does not erase the distant night sky");
      assert.equal(object.castShadow, false);
    }
  }
  assert.ok(CELESTIAL_SKY_RADIUS > 5 && CELESTIAL_SKY_RADIUS < camera.far);
  assert.equal(group.children[0].material.side, THREE.BackSide, "the viewer is inside a real far-depth celestial sphere");
  sky.dispose();
});

test("sky translation removes parallax while fixed directions survive time and camera rotation", () => {
  const scene = new THREE.Scene(), cameraRig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  cameraRig.add(camera); scene.add(cameraRig);
  const sky = createGlobeCelestialSky(scene, camera), group = scene.children[1];
  const buffers = group.children.map(object => Object.values(object.geometry.attributes).map(attribute => ({ attribute, values: Array.from(attribute.array) })));
  const worldPosition = new THREE.Vector3();
  for (let frame = 0; frame < 80; frame++) {
    camera.position.set(frame / 17, -.43, 1.43);
    cameraRig.position.set(-frame / 41, .3, .8);
    cameraRig.rotation.y = frame / 19;
    camera.lookAt(0, 0, 1);
    sky.update(frame * 100, .75);
    camera.getWorldPosition(worldPosition);
    assert.ok(group.position.distanceTo(worldPosition) < 1e-10);
    assert.deepEqual(group.quaternion.toArray(), [0, 0, 0, 1], "the sky does not follow the globe or camera's rotation");
  }
  for (const objects of buffers) for (const { attribute, values } of objects) {
    assert.deepEqual(Array.from(attribute.array), values, "stars and nebula positions are immutable, even as time advances");
  }
  sky.dispose();
});

test("celestial scenery keeps two draws and disposes each owned GPU resource once", () => {
  const scene = new THREE.Scene(), sky = createGlobeCelestialSky(scene, new THREE.PerspectiveCamera());
  const group = scene.children[0];
  assert.equal(group.children.length, 2);
  const resources = group.children.flatMap(object => [object.geometry, object.material]);
  const disposed = new Map(resources.map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener("dispose", () => disposed.set(resource, disposed.get(resource) + 1));
  const nebula = group.children[0], stars = group.children[1];
  assert.ok(nebula.geometry.index.count / 3 < 1600);
  assert.equal(stars.geometry.getAttribute("position").count, CELESTIAL_STAR_COUNT);
  assert.ok(resources.filter(resource => resource.isMaterial).every(material => Object.values(material.uniforms).every(uniform => !uniform.value?.isTexture)), "all sky content is local procedural geometry/shading");
  for (let frame = 0; frame < 600; frame++) sky.update(frame / 60, frame % 2);
  assert.deepEqual(group.children.flatMap(object => [object.geometry, object.material]), resources);
  sky.dispose(); sky.dispose(); sky.update(100, 1);
  assert.equal(scene.children.length, 0);
  assert.ok([...disposed.values()].every(count => count === 1));
});
