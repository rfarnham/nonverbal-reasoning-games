import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLOBE_DESTINATIONS, distanceToSurfaceArc, getGlobeMap, mapPointToGlobe, sphericalAngle, sphericalInterpolate, type Vec3, type GlobeDestination } from "./globe-geometry.ts";
import { getWorldMapLayout, type MapIsland } from "./map-layouts.ts";
import { getWorldBiome } from "./globe-biome-data.ts";

export type GlobeHarborLayout = Readonly<{
  destinationId: string; worldNumber: number; style: "timber" | "quay" | "fishing" | "breakwater";
  shore: Vec3; pierEnd: Vec3; harbor: Vec3; landingRadius: number; shoreIslandId?: string;
  lighthouse?: Vec3;
}>;
const LIGHTHOUSE_WORLDS = new Set([1, 6, 10, 13, 17, 22, 26, 30]);
const vector = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const plain = (p: THREE.Vector3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const styles = ["timber", "quay", "fishing", "breakwater"] as const;

/** Same authored shoreline silhouette as the biome's island cap. The pier starts
 * inside that cap, rather than inventing a disconnected offshore rectangle. */
function islandShoulder(island: MapIsland, world: number, index: number): Vec3 {
  const biome = getWorldBiome(world);
  const angular = ["volcanic", "glacier", "tundra", "basalt", "desert"].includes(biome.id);
  const count = angular ? 20 : 40, angle = index * Math.PI * 2 / count;
  let wobble = 1 + .07 * Math.sin(angle * 3 + biome.variant) + .045 * Math.cos(angle * 5);
  if (["petal", "cloud"].includes(island.shape)) wobble = .91 + .09 * Math.cos(angle * 5);
  if (island.shape === "diamond") wobble = 1 / (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
  if (island.shape === "crescent") wobble -= .22 * Math.max(0, Math.cos(angle)) ** 6;
  if (angular) wobble += index % 2 ? .055 : -.025;
  const x = Math.cos(angle) * island.rx * wobble * .76, y = Math.sin(angle) * island.ry * wobble * .76;
  const rotation = (island.rotation ?? 0) * Math.PI / 180;
  return mapPointToGlobe(world, (island.x + x * Math.cos(rotation) - y * Math.sin(rotation)) / 12, (island.y + x * Math.sin(rotation) + y * Math.cos(rotation)) / 7.4);
}
function offsetSide(at: Vec3, toward: Vec3, amount: number): Vec3 {
  const up = vector(at).normalize(), forward = vector(toward).addScaledVector(up, -vector(toward).dot(up)).normalize();
  return plain(up.clone().multiplyScalar(Math.cos(amount)).addScaledVector(up.clone().cross(forward).normalize(), Math.sin(amount)));
}
function makeHarborLayout(destination: GlobeDestination): GlobeHarborLayout {
  if (destination.kind === "boss") {
    const shore = sphericalInterpolate(destination.center, destination.harbor, .048 / sphericalAngle(destination.center, destination.harbor));
    const end = sphericalInterpolate(destination.center, destination.harbor, .112 / sphericalAngle(destination.center, destination.harbor));
    return { destinationId: destination.id, worldNumber: destination.worldNumber, style: "quay", shore, pierEnd: end, harbor: destination.harbor, landingRadius: 1.027 };
  }
  const map = getGlobeMap(destination.worldNumber), authored = getWorldMapLayout(destination.worldNumber, map.stops.length);
  const controls = [...map.stops, ...map.books].map(point => point.point);
  const roads = [...map.roads, ...map.storyPaths].flat();
  const biome = getWorldBiome(destination.worldNumber);
  const sampleCount = ["volcanic", "glacier", "tundra", "basalt", "desert"].includes(biome.id) ? 20 : 40;
  let best: { shore: Vec3; end: Vec3; island: MapIsland; score: number } | undefined;
  for (const island of map.layout.islands) for (let sample = 0; sample < sampleCount; sample++) {
    const shore = islandShoulder(island, destination.worldNumber, sample);
    const distance = sphericalAngle(shore, destination.harbor);
    const normal = vector(shore), islandCenter = vector(mapPointToGlobe(destination.worldNumber, island.x / 12, island.y / 7.4));
    const outward = normal.clone().multiplyScalar(islandCenter.dot(normal)).sub(islandCenter).normalize();
    const towardPort = vector(destination.harbor).addScaledVector(normal, -vector(destination.harbor).dot(normal)).normalize();
    const direction = outward.multiplyScalar(.8).addScaledVector(towardPort, .2).normalize();
    const endpoint = (reach: number) => plain(normal.clone().multiplyScalar(Math.cos(reach)).addScaledVector(direction, Math.sin(reach)));
    let reach = Math.min(.073, distance * .58);
    let end = endpoint(reach);
    while (sphericalAngle(end, destination.center) > .182 && reach > .015) {
      reach -= .004; end = endpoint(reach);
    }
    if (sphericalAngle(end, destination.center) > .184) continue;
    const controlClearance = Math.min(...controls.map(point => distanceToSurfaceArc(point, shore, end)));
    const roadClearance = Math.min(...roads.map(point => distanceToSurfaceArc(point, shore, end)));
    if (controlClearance < .024 || roadClearance < .014) continue;
    const feature = mapPointToGlobe(destination.worldNumber, (island.x + (island.stopIndex === undefined ? 31 : 60)) / 12, (island.y - 10) / 7.4);
    const featureClearance = sphericalAngle(shore, feature);
    const score = -distance + Math.min(controlClearance, .04) * .5 + Math.min(featureClearance, .035) * 2 - (island.stopIndex === undefined ? .018 : 0);
    if (!best || score > best.score) best = { shore, end, island, score };
  }
  if (!best) throw new Error(`No control-safe coastal harbor for ${destination.id}`);
  const lighthouse = LIGHTHOUSE_WORLDS.has(destination.worldNumber) ? offsetSide(best.end, destination.harbor, .013) : undefined;
  return { destinationId: destination.id, worldNumber: destination.worldNumber, style: styles[(destination.worldNumber - 1) % styles.length],
    shore: best.shore, pierEnd: best.end, harbor: destination.harbor, landingRadius: authored.landscape === "cliffs" ? 1.023 : 1.013,
    shoreIslandId: best.island.id, ...(lighthouse ? { lighthouse } : {}) };
}
export const GLOBE_HARBOR_LAYOUTS: readonly GlobeHarborLayout[] = GLOBE_DESTINATIONS.map(makeHarborLayout);

/** Coast-attached port scenery. Its solid geometry remains inside the existing
 * land envelopes; offshore navigational anchorages and boat routes are unchanged. */
export function createGlobeHarbors(globe: THREE.Group) {
  const group = new THREE.Group(); group.name = "Coastal piers, quays and lighthouses"; globe.add(group);
  const ownedGeometries = new Set<THREE.BufferGeometry>(), ownedMaterials = new Set<THREE.Material>();
  const pieces: THREE.BufferGeometry[] = [];
  const templates = {
    box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone: new THREE.ConeGeometry(1, 1, 8), rock: new THREE.IcosahedronGeometry(1, 0),
  };
  const color = new THREE.Color(), transform = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const localPosition = new THREE.Vector3(), localScale = new THREE.Vector3();
  const basisAt = (point: Vec3, toward: Vec3, radius: number) => {
    const up = vector(point).normalize(), forward = vector(toward).addScaledVector(up, -vector(toward).dot(up)).normalize();
    const right = up.clone().cross(forward).normalize();
    return new THREE.Matrix4().makeBasis(right, up, forward).setPosition(up.multiplyScalar(radius));
  };
  const piece = (template: THREE.BufferGeometry, base: THREE.Matrix4, tint: number, position: readonly [number, number, number], scale: readonly [number, number, number], turn = 0) => {
    const copy = template.index ? template.toNonIndexed() : template.clone();
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);localPosition.set(...position);localScale.set(...scale);
    transform.compose(localPosition, quaternion, localScale).premultiply(base);copy.applyMatrix4(transform);copy.deleteAttribute("uv");
    color.setHex(tint);const colors = new Float32Array(copy.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
    copy.setAttribute("color", new THREE.BufferAttribute(colors, 3));pieces.push(copy);
  };
  const box = (base: THREE.Matrix4, tint: number, p: readonly [number, number, number], s: readonly [number, number, number], turn = 0) => piece(templates.box, base, tint, p, s, turn);
  const cylinder = (base: THREE.Matrix4, tint: number, p: readonly [number, number, number], radius: number, height: number) => piece(templates.cylinder, base, tint, p, [radius, height, radius]);
  const lanternBases: THREE.Matrix4[] = [];
  for (const layout of GLOBE_HARBOR_LAYOUTS) {
    const stone = layout.style === "quay" || layout.style === "breakwater";
    const span = sphericalAngle(layout.shore, layout.pierEnd), count = Math.max(7, Math.ceil(span / .004));
    const heading = plain(vector(layout.pierEnd).multiplyScalar(2).sub(vector(layout.shore)).normalize());
    const baseHeight = stone ? 1.005 : 1.007;
    for (let step = 0; step <= count; step++) {
      const t = step / count, at = sphericalInterpolate(layout.shore, layout.pierEnd, t);
      const radius = THREE.MathUtils.lerp(layout.landingRadius + .0015, baseHeight, Math.min(1, t * 2.4));
      const base = basisAt(at, heading, radius);
      if (stone) {
        box(base, step % 3 ? 0x9bafb2 : 0x7f969e, [0, -.004, 0], [.020, .012, span / count * 1.08]);
        box(base, 0xe0d6bd, [0, .003, 0], [.021, .0025, span / count * .95]);
      } else box(base, step % 2 ? 0xbb8756 : 0xd8ad72, [0, 0, 0], [.017, .003, span / count * .88]);
      if (step % 3 === 0 || step === count) for (const side of [-1, 1]) {
        cylinder(base, stone ? 0x526978 : 0x725039, [side * (stone ? .010 : .009), -.002, 0], .0016, .018);
        cylinder(base, 0xe7c995, [side * (stone ? .010 : .009), .0074, 0], .0021, .0017);
      }
    }
    const end = basisAt(layout.pierEnd, heading, baseHeight);
    if (layout.style === "timber") {
      for (let i = -3; i <= 3; i++) box(end, i % 2 ? 0xc99561 : 0xdfb77d, [i * .0045, .0015, .002], [.004, .003, .025]);
    } else if (layout.style === "fishing") {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) box(end, i % 2 ? 0xbb8756 : 0xd8ad72, [side * .014, 0, .003 + i * .004], [.010, .003, .0036]);
        cylinder(end, 0x725039, [side * .014, .002, .024], .0018, .018);
      }
      box(end, 0x638e85, [-.013, .005, -.008], [.008, .006, .008]);
      for (let i = 0; i < 4; i++) box(end, 0xc4c6a4, [-.013 + i * .002, .0082, -.008], [.0006, .0006, .009]);
    } else {
      box(end, 0x879ca1, [.006, -.002, .004], [.038, .016, .024]);
      box(end, 0xe0d6bd, [.006, .007, .004], [.040, .0024, .026]);
      for (const side of [-1, 1]) cylinder(end, 0x465c68, [side * .014, .010, .012], .002, .007);
    }
    if (layout.worldNumber % 3 === 1) {
      box(end, 0xc18d57, [.009, .006, -.011], [.007, .008, .007]);
      box(end, 0x755839, [.009, .006, -.0146], [.001, .0084, .0008]);
    }
    if (layout.lighthouse) {
      const base = basisAt(layout.lighthouse, layout.harbor, 1.006);
      piece(templates.rock, base, 0x7c9698, [0, -.0005, 0], [.013, .009, .012]);
      cylinder(base, 0xe5dbbe, [0, .005, 0], .0092, .007);
      for (let band = 0; band < 6; band++) cylinder(base, band % 2 ? (layout.worldNumber % 2 ? 0xd4614f : 0x39798c) : 0xffefd2, [0, .010 + band * .005, 0], .0068 - band * .00028, .0052);
      cylinder(base, 0x455d6d, [0, .039, 0], .009, .002);
      for (let post = 0; post < 8; post++) {
        const angle = post * Math.PI / 4;
        cylinder(base, 0x455d6d, [Math.cos(angle) * .0076, .042, Math.sin(angle) * .0076], .00065, .006);
      }
      cylinder(base, 0x294955, [0, .041, 0], .0058, .0013);
      for (const x of [-.0048, .0048]) for (const z of [-.0048, .0048]) cylinder(base, 0x294955, [x, .045, z], .0006, .007);
      piece(templates.cone, base, 0x345361, [0, .052, 0], [.009, .007, .009]);
      box(base, 0x334d58, [0, .012, .0068], [.0034, .008, .0009]);
      const lantern = base.clone().multiply(new THREE.Matrix4().makeTranslation(0, .044, 0));
      lanternBases.push(lantern);
    }
  }
  for (const template of Object.values(templates)) template.dispose();
  const solidGeometry = mergeGeometries(pieces, false)!;pieces.forEach(piece => piece.dispose());ownedGeometries.add(solidGeometry);
  const solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .84, flatShading: true });ownedMaterials.add(solidMaterial);
  const solid = new THREE.Mesh(solidGeometry, solidMaterial);solid.name = "Attached harbor structures";group.add(solid);

  const clock = { value: 0 }, sun = { value: new THREE.Vector3(1, 1, 1).normalize() }, focusUniform = { value: new THREE.Vector3(1, 0, 0) }, zoomUniform = { value: 0 };
  const sharedVertex = `attribute float beaconPhase; varying vec3 vLocal; varying float vNight; varying float vVisible; uniform float harborSeconds; uniform vec3 harborSun; uniform vec3 harborFocus; uniform float harborZoom;
    void main(){vec3 p=position;vLocal=position;vec3 origin=instanceMatrix[3].xyz;vec3 normal=normalize(origin);vNight=1.-smoothstep(-.28,.18,dot(normal,harborSun));vVisible=smoothstep(-.15,.12,dot(normal,harborFocus));
    #ifdef BEAM
      float angle=harborSeconds*.19+beaconPhase;float c=cos(angle),s=sin(angle);p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
    #endif
    gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.);}`;
  const lanternGeometry = new THREE.SphereGeometry(.0046, 10, 6);ownedGeometries.add(lanternGeometry);
  lanternGeometry.setAttribute("beaconPhase", new THREE.InstancedBufferAttribute(new Float32Array(lanternBases.map((_, index) => index * 1.71)), 1));
  const makeMaterial = (beam: boolean) => {
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, defines: beam ? { BEAM: 1 } : {},
      uniforms: { harborSeconds: clock, harborSun: sun, harborFocus: focusUniform, harborZoom: zoomUniform }, vertexShader: sharedVertex,
      fragmentShader: `varying vec3 vLocal;varying float vNight;varying float vVisible;void main(){
        ${beam ? "float along=clamp(vLocal.z/.14,0.,1.);float edge=1.-smoothstep(.15,1.,abs(vLocal.x)/max(.001,along*.037));float alpha=vNight*vVisible*pow(1.-along,1.6)*edge*.14;gl_FragColor=vec4(1.,.90,.56,alpha);" : "gl_FragColor=vec4(1.,.74+.17*vNight,.30+.26*vNight,(.48+.52*vNight)*vVisible);"}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });ownedMaterials.add(material);return material;
  };
  const beamGeometry = new THREE.BufferGeometry();
  beamGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0,0,0,-.037,-.006,.14,.037,-.006,.14,0,0,0,.037,-.006,.14,.037,.006,.14,0,0,0,.037,.006,.14,-.037,.006,.14,0,0,0,-.037,.006,.14,-.037,-.006,.14], 3));
  beamGeometry.setAttribute("beaconPhase", new THREE.InstancedBufferAttribute(new Float32Array(lanternBases.map((_, index) => index * 1.71)), 1));ownedGeometries.add(beamGeometry);
  const lanterns = new THREE.InstancedMesh(lanternGeometry, makeMaterial(false), lanternBases.length);lanterns.name = "Warm lighthouse lanterns";
  const beams = new THREE.InstancedMesh(beamGeometry, makeMaterial(true), lanternBases.length);beams.name = "Slow local lighthouse beams";
  for (let i = 0; i < lanternBases.length; i++) { lanterns.setMatrixAt(i, lanternBases[i]);beams.setMatrixAt(i, lanternBases[i]); }
  lanterns.frustumCulled = false;beams.frustumCulled = false;lanterns.renderOrder = 4;beams.renderOrder = 3;
  lanterns.userData.castShadow = false;lanterns.userData.receiveShadow = false;beams.userData.castShadow = false;beams.userData.receiveShadow = false;
  group.add(lanterns, beams);
  let disposed = false;
  return {
    update(timeSeconds: number, focus: Vec3, zoom: number, activeDestinationId: string, sunDirection?: THREE.Vector3) {
      if (disposed) return;
      clock.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;focusUniform.value.set(focus.x, focus.y, focus.z).normalize();zoomUniform.value = zoom;
      if (sunDirection) sun.value.copy(sunDirection);
      group.userData.activeDestinationId = activeDestinationId;
    },
    dispose() { if (disposed) return;disposed = true;globe.remove(group);lanterns.dispose();beams.dispose();for (const geometry of ownedGeometries) geometry.dispose();for (const material of ownedMaterials) material.dispose();group.clear(); },
  };
}
