import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  GLOBE_DESTINATIONS, GLOBE_LAND_OBSTACLES, getGlobeRegion, getVoyageRoute,
  distanceToSurfaceArc, sphericalAngle, dotVec3,
} from "../app/math-world/globe-geometry.ts";
import {
  GLOBE_MARINE_LOOPS, MARINE_LAND_CLEARANCE, MARINE_HARBOR_CLEARANCE, MARINE_VOYAGE_CLEARANCE,
  createGlobeMarine, sampleMarineLoop, sampleWhaleSurfacing,
} from "../app/math-world/globe-marine.ts";

const close = (actual, expected, message, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} ≈ ${expected}`);

test("complete marine loops and their visible footprints stay in the ocean and out of every harbor", () => {
  assert.equal(GLOBE_MARINE_LOOPS.filter(loop => loop.kind === "boat").length, 8);
  assert.equal(GLOBE_MARINE_LOOPS.filter(loop => loop.kind === "fish").length, 12);
  assert.equal(GLOBE_MARINE_LOOPS.filter(loop => loop.kind === "whale").length, 5);
  for (const loop of GLOBE_MARINE_LOOPS) {
    const name = `${loop.kind} at world ${loop.worldNumber}`;
    // Triangle inequality proves the entire spherical disk is safe, including
    // times that a frame-sampling-only test could miss.
    for (const land of GLOBE_LAND_OBSTACLES) {
      assert.ok(sphericalAngle(loop.center, land.center) - loop.radius - loop.extent - land.angularRadius >= MARINE_LAND_CLEARANCE,
        `${name} clears ${land.id} throughout its closed path`);
    }
    for (const destination of GLOBE_DESTINATIONS) {
      assert.ok(sphericalAngle(loop.center, destination.harbor) - loop.radius - loop.extent >= MARINE_HARBOR_CLEARANCE,
        `${name} leaves ${destination.id}'s dock and player boat unobstructed`);
    }
    for (let frame = 0; frame <= 256; frame++) {
      const sample = sampleMarineLoop(loop, frame / 256 * loop.period);
      close(Math.hypot(sample.point.x, sample.point.y, sample.point.z), 1, "unit-sphere center");
      close(Math.hypot(sample.forward.x, sample.forward.y, sample.forward.z), 1, "unit heading");
      close(dotVec3(sample.point, sample.forward), 0, "heading is tangent to the sea");
      assert.ok(sphericalAngle(loop.center, sample.point) <= loop.radius + 1e-10);
      const after = sampleMarineLoop(loop, frame / 256 * loop.period + .0001).point;
      assert.ok(dotVec3(sample.forward, { x: after.x - sample.point.x, y: after.y - sample.point.y, z: after.z - sample.point.z }) > 0,
        "boat bows and swimming animals face their actual movement");
    }
    const start = sampleMarineLoop(loop, 0), end = sampleMarineLoop(loop, loop.period);
    for (const axis of ["x", "y", "z"]) { close(start.point[axis], end.point[axis], "closed position"); close(start.forward[axis], end.forward[axis], "closed heading"); }
  }
  for (let i = 0; i < GLOBE_MARINE_LOOPS.length; i++) for (const other of GLOBE_MARINE_LOOPS.slice(i + 1)) {
    const loop = GLOBE_MARINE_LOOPS[i];
    assert.ok(sphericalAngle(loop.center, other.center) > loop.radius + loop.extent + other.radius + other.extent,
      "neighboring boat and wildlife loops have disjoint footprints");
  }
});

test("marine pockets preserve every canonical world-to-world sailing lane", () => {
  for (let destination = 1; destination < GLOBE_DESTINATIONS.length; destination++) {
    const route = getVoyageRoute(GLOBE_DESTINATIONS[destination - 1].id, GLOBE_DESTINATIONS[destination].id);
    for (const loop of GLOBE_MARINE_LOOPS) for (let segment = 1; segment < route.length; segment++) {
      assert.ok(distanceToSurfaceArc(loop.center, route[segment - 1], route[segment]) - loop.radius - loop.extent >= MARINE_VOYAGE_CLEARANCE,
        `${loop.kind} at world ${loop.worldNumber} leaves room for the full player hull on voyage ${destination}`);
    }
  }
});

test("the first world has discoverable marine life and whales have a real breath-and-dive cycle", () => {
  for (const kind of ["boat", "fish", "whale"]) {
    const loop = GLOBE_MARINE_LOOPS.find(item => item.worldNumber === 1 && item.kind === kind);
    assert.ok(loop && sphericalAngle(loop.center, getGlobeRegion(1).center) < .4);
  }
  const states = Array.from({ length: 381 }, (_, index) => sampleWhaleSurfacing(index / 10, 0));
  assert.ok(states.some(state => state.radius > 1 && state.spout > .95), "a visible whale breathes above the water");
  assert.ok(states.some(state => state.radius + .007 < 1), "the entire body disappears below the opaque ocean");
  assert.ok(states.some(state => state.tailAngle > .4 && state.pitch > .2), "the flukes rise during the dive");
  assert.ok(states.filter(state => state.spout > 0).length < states.length * .1, "spouting is an occasional breath, not a fountain");
});

function inspect(group) {
  const geometry = new Set(), materials = new Set(), buffers = new Set(), meshes = [];
  let triangles = 0;
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes.push(object); geometry.add(object.geometry);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3 * (object.count ?? 1);
    for (const attribute of [...Object.values(object.geometry.attributes), object.instanceMatrix, object.instanceColor].filter(Boolean)) {
      buffers.add(attribute.array);
      assert.ok(Array.from(attribute.array).every(Number.isFinite), `${object.name} has only finite vertex and instance buffers`);
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  return { geometry, materials, buffers, meshes, triangles };
}

test("rendered hulls, enlarged fish, tails, wakes and spray fit the validated ocean disks", () => {
  const globe = new THREE.Group(), marine = createGlobeMarine(globe);
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  const meshes = inspect(globe).meshes;
  for (let frame = 0; frame < 16; frame++) {
    marine.update(frame * 2.53, getGlobeRegion(1).center, 1, getGlobeRegion(1).id);
    for (const mesh of meshes) {
      const name = mesh.name.toLowerCase();
      const kind = name.includes("whale") ? "whale" : name.includes("fishing") ? "boat" : "fish";
      const loops = GLOBE_MARINE_LOOPS.filter(loop => loop.kind === kind);
      const repeat = mesh.count / loops.length;
      const vertices = mesh.geometry.getAttribute("position");
      for (let instance = 0; instance < mesh.count; instance++) {
        const loop = loops[Math.floor(instance / repeat)];
        mesh.getMatrixAt(instance, matrix);
        for (let vertex = 0; vertex < vertices.count; vertex++) {
          point.fromBufferAttribute(vertices, vertex).applyMatrix4(matrix).normalize();
          assert.ok(dotVec3(point, loop.center) >= Math.cos(loop.radius + loop.extent + 1e-6),
            `${mesh.name}'s complete silhouette stays within its reserved footprint`);
        }
      }
    }
  }
  marine.dispose();
});

test("marine animation holds a fixed resource budget and remains pinned to the globe", () => {
  const globe = new THREE.Group(), marine = createGlobeMarine(globe);
  const before = inspect(globe), focus = getGlobeRegion(1).center, sun = new THREE.Vector3();
  assert.equal(before.meshes.length, 8);
  assert.ok(before.triangles < 20_000);
  assert.equal(before.geometry.size, 8);
  assert.equal(before.materials.size, 3);
  for (let frame = 0; frame < 400; frame++) {
    const t = frame * 1.071;
    sun.set(Math.cos(t), .2, Math.sin(t)).normalize();
    globe.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t / 10);
    marine.update(t, focus, frame % 2, getGlobeRegion(1).id, sun);
  }
  for (const time of [NaN, Infinity, -Infinity, -120, 1e15]) marine.update(time, focus, 1, getGlobeRegion(1).id, sun);
  const after = inspect(globe);
  assert.deepEqual(after.geometry, before.geometry);
  assert.deepEqual(after.materials, before.materials);
  assert.deepEqual(after.buffers, before.buffers, "frames reuse the original GPU attributes");
  assert.equal(after.triangles, before.triangles);
  for (const mesh of after.meshes) {
    assert.equal(mesh.parent?.parent, globe, "no detached camera-facing ocean artifacts");
    assert.equal(mesh.material.depthTest, true, "the opaque globe hides every far-side detail");
    assert.equal(mesh.material.emissive?.getHex() ?? 0, 0, "sea life never glows through night lighting");
  }
  marine.update(10.4, focus, 1, getGlobeRegion(1).id, sun);
  const paused = after.meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
  marine.update(10.4, focus, 1, getGlobeRegion(1).id, sun);
  assert.deepEqual(after.meshes.map(mesh => Array.from(mesh.instanceMatrix.array)), paused, "a paused scene time freezes swimming, wakes and breath together");
  marine.dispose();
});

test("marine disposal releases instanced meshes and every owned GPU resource exactly once", () => {
  const globe = new THREE.Group();
  const sentinel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  globe.add(sentinel);
  const marine = createGlobeMarine(globe), owned = inspect(globe.children[1]);
  const events = new Map([...owned.geometry, ...owned.materials, ...owned.meshes].map(item => [item, 0]));
  for (const object of events.keys()) object.addEventListener("dispose", () => events.set(object, events.get(object) + 1));
  let sentinelEvents = 0;
  sentinel.geometry.addEventListener("dispose", () => sentinelEvents++);
  sentinel.material.addEventListener("dispose", () => sentinelEvents++);
  marine.dispose(); marine.dispose();
  marine.update(100, getGlobeRegion(1).center, 1, getGlobeRegion(1).id);
  assert.ok([...events.values()].every(count => count === 1));
  assert.deepEqual(globe.children, [sentinel]); assert.equal(sentinelEvents, 0);
  sentinel.geometry.dispose(); sentinel.material.dispose();
});
