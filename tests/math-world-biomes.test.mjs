import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { getWorldBiome } from "../app/math-world/globe-biome-data.ts";
import { createGlobeBiomes } from "../app/math-world/globe-biomes.ts";
import { WORLD_DEFINITIONS } from "../app/math-world/world-data.ts";

test("every teaching world has geography, and the second pass names a distinct landscape", () => {
  const families = new Set();
  const labels = new Set();
  for (const world of WORLD_DEFINITIONS) {
    const biome = getWorldBiome(world.number);
    families.add(biome.id); labels.add(biome.label);
    assert.ok(biome.label.length > 8);
    assert.equal(biome.variant, world.number > 16 ? 2 : 1);
    if (world.number <= 16) {
      const second = getWorldBiome(world.number + 16);
      assert.equal(second.id, biome.id);
      assert.notEqual(second.label, biome.label);
    }
  }
  for (const required of ["volcanic", "rainforest", "lagoon", "river", "glacier", "tundra"]) assert.ok(families.has(required));
  assert.equal(labels.size, 32);
  for (const invalid of [0, 33, NaN, 1.5]) assert.throws(() => getWorldBiome(invalid));
});

test("biome geometry stays finite, batches its draw calls, and releases every owned GPU resource", () => {
  const globe = new THREE.Group();
  const other = new THREE.Group(); globe.add(other);
  const biomes = createGlobeBiomes(globe);
  const geometries = new Set(), materials = new Set();
  let meshCount = 0;
  globe.traverse(object => {
    if (!object.isMesh) return;
    meshCount++;
    geometries.add(object.geometry);
    materials.add(object.material);
    for (const attribute of Object.values(object.geometry.attributes)) {
      for (const value of attribute.array) assert.ok(Number.isFinite(value));
    }
    const positions = object.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const radius = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
      assert.ok(radius > 0.99 && radius < 1.1, "terrain hugs the globe without extreme spikes");
    }
  });
  assert.ok(meshCount > 10 && meshCount < 60, "all 32 regions share a bounded number of material batches");
  assert.ok(biomes.smokeSources.length >= 4);
  for (const { position, strength } of biomes.smokeSources) {
    const radius = Math.hypot(position.x, position.y, position.z);
    assert.ok(radius > 1.04 && radius < 1.1, "smoke originates at a raised crater, above the sea");
    assert.ok(strength > 0 && strength <= 1);
  }
  const initialCount = globe.children.length;
  for (const time of [0, 0.5, 8, 0]) biomes.update(time, WORLD_DEFINITIONS[4].id, 1);
  biomes.update(NaN, "boss-2025", 0);
  assert.equal(globe.children.length, initialCount, "animation updates do not accumulate scene objects");
  let releasedGeometry = 0, releasedMaterial = 0;
  for (const geometry of geometries) geometry.addEventListener("dispose", () => releasedGeometry++);
  for (const material of materials) material.addEventListener("dispose", () => releasedMaterial++);
  biomes.dispose(); biomes.dispose();
  assert.equal(releasedGeometry, geometries.size);
  assert.equal(releasedMaterial, materials.size);
  assert.deepEqual(globe.children, [other], "disposing scenery preserves the parent scene's other objects");
});
