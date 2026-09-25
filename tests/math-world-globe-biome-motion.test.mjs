import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeBiomes } from "../app/math-world/globe-biomes.ts";
import { createGlobeContinents } from "../app/math-world/globe-continents.ts";
import { getGlobeRegion } from "../app/math-world/globe-geometry.ts";

function snapshot(group) {
  const geometries = new Set(), materials = new Set();
  let meshes = 0, triangles = 0, rootedVertices = 0, windVertices = 0, floatingVertices = 0;
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1; geometries.add(object.geometry);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
    for (const attribute of Object.values(object.geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite), "all terrain and motion buffers stay finite");
    const motion = object.geometry.getAttribute("motionParams");
    if (motion) {
      assert.ok(object.customDepthMaterial, "moving habitat geometry has matching moving shadow geometry");
      for (let index = 0; index < motion.count; index += 1) {
        assert.ok(motion.getX(index) >= 0 && motion.getX(index) <= 1, "wind weights remain bounded");
        if (motion.getZ(index) === 1) { windVertices += 1; if (motion.getX(index) < 0.001) rootedVertices += 1; }
        else if (motion.getZ(index) === 2) floatingVertices += 1;
        else assert.fail("unknown habitat motion");
      }
    }
  });
  return { geometries, materials, meshes, triangles, rootedVertices, windVertices, floatingVertices };
}

test("biome motion keeps tree roots fixed and has bounded geometry for all 32 worlds", () => {
  const globe = new THREE.Group(), biomes = createGlobeBiomes(globe);
  const initial = snapshot(globe);
  assert.ok(initial.meshes <= 55, "all static and moving biome colors share a fixed batch budget");
  assert.ok(initial.triangles < 260_000, "motion does not duplicate the complete land geometry");
  assert.ok(initial.rootedVertices > 500 && initial.windVertices > initial.rootedVertices, "roots are anchored while crowns can sway");
  assert.ok(initial.floatingVertices > 0, "only designated floating ice receives water motion");
  const sun = new THREE.Vector3(1, 0.4, 0.2).normalize();
  for (let frame = 0; frame < 90; frame += 1) biomes.update(frame / 30, getGlobeRegion(frame % 32 + 1).id, frame % 2, sun);
  const final = snapshot(globe);
  assert.deepEqual(final.geometries, initial.geometries);
  assert.deepEqual(final.materials, initial.materials);
  assert.equal(final.triangles, initial.triangles);
  biomes.dispose();
});

test("biome disposal includes animated depth materials and cannot resurrect scenery", () => {
  const globe = new THREE.Group(), neighbor = new THREE.Group();
  globe.add(neighbor);
  const biomes = createGlobeBiomes(globe), state = snapshot(globe);
  const counts = new Map([...state.geometries, ...state.materials].map(resource => [resource, 0]));
  for (const resource of counts.keys()) resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource) + 1));
  biomes.dispose(); biomes.dispose();
  biomes.update(50, getGlobeRegion(1).id, 1);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.deepEqual(globe.children, [neighbor]);
});

test("mainland groves have fixed roots, moving crowns and independently disposed shadow resources", () => {
  const globe = new THREE.Group(), continents = createGlobeContinents(globe);
  const grove = globe.getObjectByName("Mainland forest groves");
  const anchor = grove.geometry.getAttribute("foliageAnchor"), bend = grove.geometry.getAttribute("foliageBend");
  assert.ok(grove.customDepthMaterial, "canopy shadows follow the same bend as the tree");
  assert.equal(anchor.count, grove.geometry.getAttribute("position").count);
  assert.equal(bend.count, anchor.count);
  let roots = 0, crowns = 0;
  for (let i = 0; i < bend.count; i++) {
    assert.ok(Number.isFinite(anchor.getX(i) + anchor.getY(i) + anchor.getZ(i) + bend.getY(i)));
    assert.ok(bend.getX(i) >= 0 && bend.getX(i) <= 1);
    if (bend.getX(i) < .00001) roots++;
    if (bend.getX(i) > .5) crowns++;
  }
  assert.ok(roots > 50 && crowns > 100, "trunk bases stay rooted while upper foliage responds to wind");
  const original = anchor.array.slice();
  for (let t = 0; t < 120; t++) continents.update(t);
  assert.deepEqual(anchor.array, original, "animation must not mutate the cached CPU mesh shared across map mounts");
  let depthDisposals = 0;
  grove.customDepthMaterial.addEventListener("dispose", () => depthDisposals++);
  continents.dispose(); continents.dispose();
  assert.equal(depthDisposals, 1);
});
