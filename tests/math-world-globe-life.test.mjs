import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeLife } from "../app/math-world/globe-life.ts";
import { createGlobeWeather } from "../app/math-world/globe-weather.ts";
import { globeStormIntensity, GLOBE_RAINBOW_WORLDS } from "../app/math-world/globe-local-weather.ts";
import { getGlobeRegion } from "../app/math-world/globe-geometry.ts";

function resources(scene) {
  const geometries = new Set(), materials = new Set();
  let triangles = 0, meshes = 0;
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    geometries.add(object.geometry);
    const instances = object.geometry.isInstancedBufferGeometry ? object.geometry.instanceCount : 1;
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3 * instances;
    for (const attribute of Object.values(object.geometry.attributes)) {
      assert.ok(Array.from(attribute.array).every(Number.isFinite), "scenery buffers contain only finite coordinates");
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  return { geometries, materials, triangles, meshes };
}

function harness() {
  const scene = new THREE.Scene(), globe = new THREE.Group(), camera = new THREE.PerspectiveCamera(37, 1, 0.02, 12);
  scene.add(globe); camera.position.set(0, 0, 3.7);
  const sentinel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  sentinel.name = "Unrelated scene content";
  globe.add(sentinel);
  const source = (world, strength, radius) => {
    const center = getGlobeRegion(world).center;
    return { position: { x: center.x * radius, y: center.y * radius, z: center.z * radius }, strength };
  };
  const smokeSources = [source(5, 1, 1.06), source(21, 0.45, 1.03)];
  const mistSources = [source(12, 1, 1.009), source(28, 0.6, 1.009)];
  const weather = createGlobeWeather(globe, scene, camera, smokeSources);
  const life = createGlobeLife(globe, { smokeSources, mistSources });
  return { scene, globe, camera, sentinel, weather, life };
}

test("weather and habitat effects have fixed geometry budgets across repeated frame and sun changes", () => {
  const h = harness(), first = resources(h.scene);
  assert.ok(first.meshes <= 15, "fourteen weather/life batches plus the unrelated sentinel: wind and local bolts add two fixed draws");
  assert.ok(first.triangles < 85_000, "all globe weather and habitat details share a bounded mesh budget");
  const sun = new THREE.Vector3(), focus = getGlobeRegion(9).center;
  for (let frame = 0; frame < 180; frame += 1) {
    const t = frame / 30;
    sun.set(Math.cos(t), 0.2, Math.sin(t)).normalize();
    h.globe.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t / 10);
    h.weather.update(t, focus, frame % 2, getGlobeRegion(9).id, sun);
    h.life.update(t, focus, frame % 2, getGlobeRegion(9).id, sun);
  }
  const final = resources(h.scene);
  assert.deepEqual(final.geometries, first.geometries, "idle animation does not allocate geometry");
  assert.deepEqual(final.materials, first.materials, "idle animation does not allocate materials");
  assert.equal(final.meshes, first.meshes);
  assert.equal(final.triangles, first.triangles);
  h.weather.dispose(); h.life.dispose();
  h.sentinel.geometry.dispose(); h.sentinel.material.dispose();
});

test("weather and habitat disposal is idempotent and releases every owned GPU resource without touching neighbors", () => {
  const h = harness(), before = resources(h.scene);
  const owned = [...before.geometries, ...before.materials].filter(resource => resource !== h.sentinel.geometry && resource !== h.sentinel.material);
  const calls = new Map(owned.map(resource => [resource, 0]));
  for (const resource of owned) resource.addEventListener("dispose", () => calls.set(resource, calls.get(resource) + 1));
  let sentinelDisposals = 0;
  h.sentinel.geometry.addEventListener("dispose", () => { sentinelDisposals += 1; });
  h.sentinel.material.addEventListener("dispose", () => { sentinelDisposals += 1; });
  h.weather.dispose(); h.life.dispose();
  h.weather.dispose(); h.life.dispose();
  const center = getGlobeRegion(1).center;
  h.weather.update(60, center, 1, getGlobeRegion(1).id);
  h.life.update(60, center, 1, getGlobeRegion(1).id);
  assert.ok([...calls.values()].every(count => count === 1), "each owned geometry and material is disposed exactly once");
  assert.deepEqual(h.scene.children, [h.globe], "the detached atmosphere is also removed");
  assert.deepEqual(h.globe.children, [h.sentinel]);
  assert.equal(sentinelDisposals, 0);
  h.sentinel.geometry.dispose(); h.sentinel.material.dispose();
});


test("local lightning is sparse, single-pulse, deterministic, and fully suppressed without motion", () => {
  assert.ok(GLOBE_RAINBOW_WORLDS.includes(1), "the opening world includes a visible daylight rainbow");
  for (const storm of [0, 1]) {
    const runs = [];
    let active = false;
    for (let sample = 0; sample <= 12_000; sample++) {
      const time = sample / 60;
      const strength = globeStormIntensity(time, storm);
      assert.ok(strength >= 0 && strength <= 1);
      assert.equal(strength, globeStormIntensity(time, storm));
      assert.equal(globeStormIntensity(time, storm, false), 0, "pausing at any strike phase hides bolts and illumination");
      if (strength > 0 && !active) runs.push({ start: time, end: time });
      if (strength > 0) runs.at(-1).end = time;
      active = strength > 0;
    }
    assert.ok(runs.length >= 8 && runs.length <= 11);
    for (const [index, run] of runs.entries()) {
      assert.ok(run.end - run.start < 0.86, "a strike fades within one second");
      if (index) assert.ok(run.start - runs[index - 1].end >= 18, "long quiet intervals prevent repeated flashing");
    }
  }
  for (const value of [-1, NaN, Infinity, -Infinity]) assert.equal(globeStormIntensity(value, 0), 0);
});

test("life motion control changes shared storm uniforms without mutating or replacing buffers", () => {
  const h = harness(), before = resources(h.scene);
  const snapshots = [...before.geometries].map(geometry => ({ geometry, attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attribute]) => [key, Array.from(attribute.array)])) }));
  const bolt = h.globe.getObjectByName("Occasional forked lightning and local cloud illumination");
  const cloud = h.globe.getObjectByName("Local embers, waterfall mist, snow, and fireflies");
  assert.equal(bolt.material.uniforms.stormIntensity, cloud.material.uniforms.stormIntensity, "cloud glow and local bolt share exactly the same pulse");
  const focus = getGlobeRegion(9).center, sun = new THREE.Vector3(focus.x, focus.y, focus.z);
  h.life.update(3.2, focus, 1, getGlobeRegion(9).id, sun, true);
  assert.ok(bolt.material.uniforms.stormIntensity.value.x > 0.95);
  h.life.update(3.2, focus, 1, getGlobeRegion(9).id, sun, false);
  assert.deepEqual(bolt.material.uniforms.stormIntensity.value.toArray(), [0, 0]);
  for (const { geometry, attributes } of snapshots) for (const [key, values] of Object.entries(attributes)) assert.deepEqual(Array.from(geometry.attributes[key].array), values);
  h.weather.dispose(); h.life.dispose(); h.sentinel.geometry.dispose(); h.sentinel.material.dispose();
});
