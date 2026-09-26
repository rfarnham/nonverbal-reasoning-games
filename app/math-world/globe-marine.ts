import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { getGlobeRegion, tangentPointToGlobe, type Vec3 } from "./globe-geometry.ts";

export type GlobeMarine = Readonly<{
  update: (timeSeconds: number, focus: Vec3, zoom: number, activeDestinationId: string, sunDirection?: THREE.Vector3) => void;
  dispose: () => void;
}>;
export type MarineLoop = Readonly<{
  kind: "boat" | "fish" | "whale"; worldNumber: number;
  center: Vec3; east: Vec3; north: Vec3;
  radius: number; minorRadius: number; extent: number; period: number; phase: number;
}>;

/** Authored ocean pockets, selected against the complete land envelopes, harbors,
 * storm footprints, and every ordinary voyage. Tests prove the enclosing disks are clear, including
 * the hulls, school spread, fins, wakes, and every point between animation frames.
 * Keeping these placements authored avoids building the voyage graph at startup. */
const placements: readonly [MarineLoop["kind"], number, number, number][] = [
  ["boat", 1, -.23, -.16], ["boat", 5, -.2228073, .2155386],
  ["boat", 7, .2087963, .3759044], ["boat", 10, .2031741, -.2341374],
  ["boat", 13, -.234, -.354], ["boat", 19, -.0321348, .3083299],
  ["boat", 25, -.2407639, -.3562762], ["boat", 28, .1356519, -.2787446],
  ["whale", 1, .3043559, .0588852], ["whale", 8, -.3899464, -.0064661],
  ["whale", 14, .262, -.506], ["whale", 20, -.5022546, .2241435],
  ["whale", 30, .27, .582],
  ["fish", 1, -.0946797, -.3783329], ["fish", 3, .1505275, .2710009],
  ["fish", 6, -.0275445, -.3890261], ["fish", 9, -.3043559, -.0588852],
  ["fish", 12, -.0487619, -.3061409], ["fish", 15, .2658611, .1594299],
  ["fish", 18, .3866458, .1881623], ["fish", 21, -.1952995, -.2407449],
  ["fish", 24, .3043559, .0588852], ["fish", 27, .494, -.394],
  ["fish", 30, -.194, .294], ["fish", 32, -.2787446, -.1356519],
];
export const GLOBE_MARINE_LOOPS: readonly MarineLoop[] = placements.map(([kind, worldNumber, e, n], index) => {
  const center = tangentPointToGlobe(getGlobeRegion(worldNumber), e, n);
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().copy(center)).normalize();
  const north = new THREE.Vector3().crossVectors(new THREE.Vector3().copy(center), east).normalize();
  const radius = kind === "boat" ? .022 : kind === "whale" ? .024 : .018;
  return { kind, worldNumber, center, east: { x: east.x, y: east.y, z: east.z }, north: { x: north.x, y: north.y, z: north.z },
    radius, minorRadius: radius * .58, extent: kind === "boat" ? .028 : kind === "whale" ? .032 : .018,
    period: (kind === "boat" ? 132 : kind === "whale" ? 178 : 48) + index * 2, phase: index * 2.3999632297 };
});
export const MARINE_LAND_CLEARANCE = .014;
export const MARINE_HARBOR_CLEARANCE = .085;
export const MARINE_VOYAGE_CLEARANCE = .044;
export const MARINE_STORM_CLEARANCE = .012;

/** A periodic exponential-map ellipse and its exact tangent, both globe-local.
 * Its complete path lies in a spherical disk of radius loop.radius. */
export function sampleMarineLoop(loop: MarineLoop, timeSeconds: number): Readonly<{ point: Vec3; forward: Vec3 }> {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const angle = (t % loop.period) / loop.period * Math.PI * 2 + loop.phase;
  const u = Math.cos(angle) * loop.radius, v = Math.sin(angle) * loop.minorRadius;
  const du = -Math.sin(angle) * loop.radius, dv = Math.cos(angle) * loop.minorRadius;
  const radius = Math.hypot(u, v), derivative = (u * du + v * dv) / radius;
  const sinc = Math.sin(radius) / radius;
  const dsinc = (radius * Math.cos(radius) - Math.sin(radius)) / (radius * radius) * derivative;
  const p = { x: 0, y: 0, z: 0 }, d = { x: 0, y: 0, z: 0 };
  for (const axis of ["x", "y", "z"] as const) {
    const tangent = loop.east[axis] * u + loop.north[axis] * v;
    p[axis] = loop.center[axis] * Math.cos(radius) + tangent * sinc;
    d[axis] = -loop.center[axis] * Math.sin(radius) * derivative
      + (loop.east[axis] * du + loop.north[axis] * dv) * sinc + tangent * dsinc;
  }
  const length = Math.hypot(d.x, d.y, d.z);
  return { point: p, forward: { x: d.x / length, y: d.y / length, z: d.z / length } };
}

/** A long, quiet swim: rise, breathe once, remain visible, then dip the nose and
 * raise the flukes. Actual submersion behind the opaque sea hides the whale. */
export function sampleWhaleSurfacing(timeSeconds: number, index: number) {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const cycle = ((t + index * 7 + 9) % 38 + 38) % 38;
  const rise = THREE.MathUtils.smoothstep(cycle, 3, 8);
  const dive = THREE.MathUtils.smoothstep(cycle, 23, 29);
  const surface = rise * (1 - dive);
  const breath = cycle > 9 && cycle < 11.8 ? Math.sin((cycle - 9) / 2.8 * Math.PI) : 0;
  return { radius: .985 + surface * .0165,
    pitch: Math.sin(dive * Math.PI) * .30 - Math.sin(rise * Math.PI) * .08,
    tailAngle: Math.sin(t * 1.9 + index) * .12 + Math.sin(dive * Math.PI) * .55,
    spout: breath, surface };
}

/** Decorative marine life only. All eight batches use fixed geometry and the
 * parent's active scenery time; there is no clock, navigation, or game state. */
export function createGlobeMarine(globe: THREE.Group): GlobeMarine {
  const group = new THREE.Group();
  group.name = "Fishing boats, fish schools, and surfacing whales";
  globe.add(group);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const keep = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83, metalness: 0 });
  solid.name = "Painted marine silhouettes";
  const foam = new THREE.MeshStandardMaterial({ color: 0xc1efe8, roughness: 1, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide });
  const spray = new THREE.MeshStandardMaterial({ color: 0xe1f5ee, roughness: 1, transparent: true, opacity: .64, depthWrite: false });
  materials.add(solid); materials.add(foam); materials.add(spray);
  const box = new THREE.BoxGeometry(1, 1, 1), ball = new THREE.IcosahedronGeometry(1, 1), cone = new THREE.ConeGeometry(1, 1, 5);
  const pieces: THREE.BufferGeometry[] = [];
  const transform = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const paint = new THREE.Color();
  const piece = (geometry: THREE.BufferGeometry, color: number, at: [number, number, number], size: [number, number, number], euler: [number, number, number] = [0, 0, 0]) => {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    copy.deleteAttribute("uv");
    transform.compose(position.set(...at), rotation.setFromEuler(new THREE.Euler(...euler)), scale.set(...size));
    copy.applyMatrix4(transform);
    const colors = new Float32Array(copy.getAttribute("position").count * 3);
    paint.setHex(color);
    for (let i = 0; i < colors.length; i += 3) colors.set([paint.r, paint.g, paint.b], i);
    copy.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pieces.push(copy);
  };
  const finish = () => {
    const merged = mergeGeometries(pieces, false)!;
    for (const geometry of pieces) geometry.dispose();
    pieces.length = 0;
    return keep(merged);
  };
  const triangle = (vertices: number[]) => {
    const geometry = new THREE.BufferGeometry();
    // Fins need both faces because their pale underside is visible during rolls.
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([...vertices, ...vertices.slice(6, 9), ...vertices.slice(3, 6), ...vertices.slice(0, 3)], 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  const fin = triangle([0, 0, 0, 1, 0, -.5, .35, 0, -1]);
  const tail = triangle([0, 0, 0, 1, 0, -1, -.75, 0, -.82]);
  // A pointed red hull, cream wheelhouse, dark glazing, roof and two bent rods.
  piece(ball, 0xb95443, [0, .0025, 0], [.0085, .004, .016]);
  piece(box, 0xf0c886, [0, .0042, -.002], [.013, .002, .020]);
  piece(box, 0xffe8b7, [0, .0084, .003], [.010, .007, .009]);
  piece(box, 0x24495b, [0, .0092, .0076], [.0077, .0032, .0008]);
  for (const side of [-1, 1]) {
    piece(box, 0x24495b, [side * .0051, .0092, .003], [.0007, .0032, .006]);
    piece(box, 0x574b40, [side * .0052, .009, -.008], [.00065, .015, .00065], [.43, 0, side * -.32]);
    piece(box, 0x574b40, [side * .0071, .0152, -.0114], [.00065, .005, .00065], [1.0, 0, side * -.48]);
    piece(box, 0xc3e2d2, [side * .0082, .010, -.0133], [.00024, .012, .00024]);
  }
  piece(box, 0xf1b648, [0, .0124, .003], [.013, .0018, .012]);
  piece(box, 0x53564c, [.002, .014, .001], [.002, .0035, .002]);
  const boatGeometry = finish();
  // Small diamond-shaped silver fish, contrasting blue backs and side fins.
  const fishSize = 1.45;
  piece(ball, 0x9dcbbd, [0, 0, .0003], [.0014, .00055, .0035]);
  piece(ball, 0x2a7d83, [0, .00035, .0002], [.0008, .00030, .0029]);
  for (const side of [-1, 1]) piece(fin, 0x84b4ab, [side * .0007, .00005, .0003], [side * .0015, 1, .0018]);
  const fishGeometry = finish();
  fishGeometry.scale(fishSize, fishSize, fishSize);
  piece(tail, 0xb1d1b5, [0, 0, 0], [.0018, 1, .0018]);
  const fishTailGeometry = finish();
  fishTailGeometry.scale(fishSize, fishSize, fishSize);
  // Rounded head, long back, pale cheeks, dorsal fin and broad side flippers.
  piece(ball, 0x31596b, [0, .0014, .002], [.009, .006, .021]);
  piece(ball, 0x73909a, [0, -.0015, .005], [.008, .0038, .017]);
  piece(ball, 0x31596b, [0, .0004, -.018], [.0035, .0024, .009]);
  piece(cone, 0x294d62, [0, .0068, -.004], [.0033, .008, .004], [-.35, 0, 0]);
  for (const side of [-1, 1]) {
    piece(fin, 0x31596b, [side * .006, .0003, .005], [side * .010, 1, .012]);
    piece(ball, 0xd3e7dc, [side * .0072, .0030, .011], [.0011, .00075, .0018]);
    piece(ball, 0x182d3b, [side * .0077, .0036, .0118], [.00055, .00045, .00055]);
  }
  const whaleGeometry = finish();
  for (const side of [-1, 1]) piece(fin, 0x355e70, [0, 0, 0], [side * .012, 1, .007]);
  const whaleTailGeometry = finish();
  box.dispose(); ball.dispose(); cone.dispose(); fin.dispose(); tail.dispose();

  // Broken V wakes and a quiet elliptical surface ripple are actual local
  // geometry, so they remain on the curved sea and behind the far hemisphere.
  const wakeGeometry = keep(new THREE.BufferGeometry());
  const wakeVertices: number[] = [];
  for (const side of [-1, 1]) for (let step = 0; step < 4; step++) {
    const start = step * .004, end = start + .0032;
    const x1 = side * (.006 + start * .36), x2 = side * (.006 + end * .36);
    const z1 = -.006 - start, z2 = -.006 - end;
    wakeVertices.push(x1, 0, z1, x2, 0, z2, x1 + side * .0007, 0, z1, x1 + side * .0007, 0, z1, x2, 0, z2, x2 + side * .0007, 0, z2);
  }
  wakeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wakeVertices, 3));
  wakeGeometry.computeVertexNormals();
  const rippleGeometry = keep(new THREE.RingGeometry(.010, .01065, 24));
  rippleGeometry.rotateX(-Math.PI / 2); rippleGeometry.scale(1.0, 1, 2.1);
  const spoutGeometry = keep(new THREE.IcosahedronGeometry(1, 0));
  const boats = GLOBE_MARINE_LOOPS.filter(loop => loop.kind === "boat");
  const schools = GLOBE_MARINE_LOOPS.filter(loop => loop.kind === "fish");
  const whales = GLOBE_MARINE_LOOPS.filter(loop => loop.kind === "whale");
  const batch = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, count: number) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Tiny silhouettes do not need expensive shadow-map passes. Their standard
    // materials still receive the suite's sun, moon and hemisphere lighting.
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
    group.add(mesh); return mesh;
  };
  const fishingBoats = batch("Small fishing boats with cabins and rods", boatGeometry, solid, boats.length);
  const wakes = batch("Short fishing-boat wakes", wakeGeometry, foam, boats.length);
  const fish = batch("Surface fish schools", fishGeometry, solid, schools.length * 7);
  const fishTails = batch("Swimming fish tails", fishTailGeometry, solid, schools.length * 7);
  const whaleBodies = batch("Occasionally surfacing whales", whaleGeometry, solid, whales.length);
  const whaleTails = batch("Whale tail flukes", whaleTailGeometry, solid, whales.length);
  const spouts = batch("Small whale breaths", spoutGeometry, spray, whales.length * 5);
  const ripples = batch("Whale surface ripples", rippleGeometry, foam, whales.length);
  const meshes = [fishingBoats, wakes, fish, fishTails, whaleBodies, whaleTails, spouts, ripples];
  const up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
  const matrix = new THREE.Matrix4(), base = new THREE.Matrix4(), local = new THREE.Matrix4();
  const localRotation = new THREE.Quaternion(), localScale = new THREE.Vector3();
  const localPosition = new THREE.Vector3(), euler = new THREE.Euler();
  const zeroScale = new THREE.Vector3(0, 0, 0);
  const white = new THREE.Color(1, 1, 1), tint = new THREE.Color();
  const pose = (loop: MarineLoop, seconds: number, radius: number) => {
    const sample = sampleMarineLoop(loop, seconds);
    up.copy(sample.point); forward.copy(sample.forward); right.crossVectors(up, forward).normalize();
    base.makeBasis(right, up, forward).setPosition(position.copy(up).multiplyScalar(radius));
  };
  const instance = (mesh: THREE.InstancedMesh, index: number, at: [number, number, number] = [0, 0, 0], rotation: [number, number, number] = [0, 0, 0], size: [number, number, number] = [1, 1, 1]) => {
    local.compose(localPosition.set(...at), localRotation.setFromEuler(euler.set(...rotation)), localScale.set(...size));
    mesh.setMatrixAt(index, matrix.multiplyMatrices(base, local));
  };
  let disposed = false;
  const update: GlobeMarine["update"] = (timeSeconds, _focus, _zoom, _activeDestinationId, sunDirection) => {
    if (disposed) return;
    const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    for (const [index, loop] of boats.entries()) {
      pose(loop, t, 1.0014 + Math.sin(t * 1.1 + loop.phase) * .00045);
      instance(fishingBoats, index, [0, 0, 0], [Math.sin(t * .8 + index) * .025, 0, Math.sin(t + index) * .04]);
      pose(loop, t, 1.0008);
      instance(wakes, index, [0, 0, 0], [0, 0, 0], [1, 1, 1 + Math.sin(t * 1.4 + index) * .05]);
    }
    for (const [schoolIndex, loop] of schools.entries()) {
      pose(loop, t, 1.0015);
      for (let member = 0; member < 7; member++) {
        const index = schoolIndex * 7 + member;
        const x = (member % 3 - 1) * .006 + Math.sin(t * 1.6 + member + schoolIndex) * .0007;
        const z = (Math.floor(member / 3) - 1) * .006 + (member % 2) * .002;
        const wag = Math.sin(t * 5 + member * 1.3) * .13;
        instance(fish, index, [x, 0, z], [0, wag, 0]);
        instance(fishTails, index, [x - Math.sin(wag) * .0028 * fishSize, 0, z - Math.cos(wag) * .0028 * fishSize], [0, wag + Math.sin(t * 5 + member * 1.3) * .36, 0]);
      }
    }
    for (const [index, loop] of whales.entries()) {
      const state = sampleWhaleSurfacing(t, index);
      pose(loop, t, state.radius);
      instance(whaleBodies, index, [0, 0, 0], [state.pitch, 0, Math.sin(t * .8 + index) * .035]);
      instance(whaleTails, index, [0, Math.sin(state.pitch) * .024, -Math.cos(state.pitch) * .024], [state.pitch + state.tailAngle, 0, 0]);
      pose(loop, t, 1.0007);
      const rippleSize = .80 + state.surface * .22;
      instance(ripples, index, [0, 0, 0], [0, 0, 0], [rippleSize * state.surface, 1, rippleSize * state.surface]);
      for (let drop = 0; drop < 5; drop++) {
        const size = state.spout * (.0013 + drop * .00012);
        // The breath fans gently from the same blowhole, never a detached cloud.
        instance(spouts, index * 5 + drop, [(drop - 2) * .0015 * state.spout, .008 + drop * .0023 * state.spout, .010 + Math.abs(drop - 2) * .0008],
          [0, 0, 0], [size, size * (drop < 2 ? 2.1 : 1.2), size]);
      }
    }
    // Night tint is instance-local and also covers transparent foam. No emissive
    // dots or camera-facing sprites remain visible through the back of the sea.
    if (sunDirection && Number.isFinite(sunDirection.lengthSq()) && sunDirection.lengthSq() > .0001) {
      for (const [mesh, loops, repeat] of [[fishingBoats, boats, 1], [wakes, boats, 1], [fish, schools, 7], [fishTails, schools, 7],
        [whaleBodies, whales, 1], [whaleTails, whales, 1], [spouts, whales, 5], [ripples, whales, 1]] as const) {
        for (const [index, loop] of loops.entries()) {
          const day = THREE.MathUtils.smoothstep(sunDirection.dot(up.copy(loop.center)) / sunDirection.length(), -.2, .3);
          tint.setRGB(.52 + day * .48, .64 + day * .36, .79 + day * .21);
          for (let member = 0; member < repeat; member++) mesh.setColorAt(index * repeat + member, tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };
  // Allocate instance colors before the first render, then only mutate buffers.
  for (const mesh of meshes) {
    for (let index = 0; index < mesh.count; index++) {
      mesh.setMatrixAt(index, matrix.makeScale(zeroScale.x, zeroScale.y, zeroScale.z));
      mesh.setColorAt(index, white);
    }
  }
  update(0, GLOBE_MARINE_LOOPS[0].center, 0, "");
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true; globe.remove(group);
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
