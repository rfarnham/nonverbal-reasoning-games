import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WORLD_DEFINITIONS } from "./world-data";
import { getWorldMapLayout, type MapIsland, type MapLandscape } from "./map-layouts";
import {
  GLOBE_DESTINATIONS, getGlobeDestination, getGlobeRoadPoints, mapPointToGlobe,
  type Vec3,
} from "./globe-geometry";

export type GlobeProjectedPoint = Readonly<{ x: number; y: number; visible: boolean; scale: number }>;
export type GlobeProjection = Readonly<{
  width: number; height: number;
  worlds: Readonly<Record<string, GlobeProjectedPoint>>;
  stops: Readonly<Record<string, GlobeProjectedPoint>>;
  books: Readonly<Record<string, GlobeProjectedPoint>>;
  avatar?: GlobeProjectedPoint; boat?: GlobeProjectedPoint;
}>;
export type GlobeSceneFrame = Readonly<{
  focus: Vec3; zoom: number; activeDestinationId: string;
  completedStopIds: readonly string[];
  avatarPosition?: Vec3; avatarHop?: number;
  boatPosition?: Vec3; boatHeading?: Vec3;
}>;
export type GlobeSceneOptions = Readonly<{
  onProject: (projection: GlobeProjection) => void;
  onUnavailable: () => void;
  assetBasePath?: string;
}>;
export type GlobeScene = Readonly<{
  render: (frame: GlobeSceneFrame) => void; resize: () => void; dispose: () => void;
}>;

type Palette = { grass: number; leaf: number; accent: number; rock: number; light: number };
const PALETTES: Record<MapLandscape, Palette> = {
  coast: { grass: 0xa9dc5b, leaf: 0x24995c, accent: 0xfa785e, rock: 0xb98754, light: 0xe9f6a2 },
  mirror: { grass: 0xb9dfae, leaf: 0x9d80ca, accent: 0xd56fbd, rock: 0x80a5ac, light: 0xe9f9de },
  orchard: { grass: 0xc2d958, leaf: 0x4ca556, accent: 0xfb8051, rock: 0xc89a54, light: 0xeef4a2 },
  pattern: { grass: 0xc6b7e5, leaf: 0x54b4a4, accent: 0xeb81b6, rock: 0x9585b2, light: 0xeee1fb },
  shapes: { grass: 0xb2d785, leaf: 0x35b4a2, accent: 0xf2a34e, rock: 0x77ad96, light: 0xe4f0b4 },
  lagoon: { grass: 0xbde298, leaf: 0xeb8f88, accent: 0xeebb5c, rock: 0xb89480, light: 0xedf8c5 },
  desert: { grass: 0xe9bc64, leaf: 0x62ac79, accent: 0xd57c56, rock: 0xb77e46, light: 0xffe5a3 },
  canopy: { grass: 0x8cca69, leaf: 0x27945e, accent: 0xf4a24d, rock: 0x997d51, light: 0xcce996 },
  cliffs: { grass: 0xd4e6d8, leaf: 0x6ba6aa, accent: 0xd78ba5, rock: 0x789cae, light: 0xf8faf0 },
  balance: { grass: 0xcdcf86, leaf: 0xb090c3, accent: 0xe79b59, rock: 0x9e8d9e, light: 0xf4edc5 },
  sharing: { grass: 0xc9df81, leaf: 0x71b36a, accent: 0xf08071, rock: 0xac9762, light: 0xf5f1b3 },
  fractions: { grass: 0xb6d9b5, leaf: 0x4aa8ac, accent: 0xf3b150, rock: 0x729eae, light: 0xeaf4d1 },
  measurement: { grass: 0xd2d795, leaf: 0x8db179, accent: 0xd98567, rock: 0x9e8c70, light: 0xf7ebbc },
  market: { grass: 0xd4d791, leaf: 0x46a69b, accent: 0xf08262, rock: 0xab8e69, light: 0xf8efc0 },
  clock: { grass: 0xd4d697, leaf: 0xaaa1cd, accent: 0xe8a349, rock: 0x9e9181, light: 0xfcf1c5 },
  area: { grass: 0xbcd580, leaf: 0x80ae63, accent: 0xd99561, rock: 0x9e8a60, light: 0xe9edac },
};
const vector = (value: Vec3) => new THREE.Vector3(value.x, value.y, value.z);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** This scene owns only GPU resources. Navigation, clocks, input, and saved progress
 * stay in React; a frame is a complete description of the visible journey. */
export function createGlobeScene(container: HTMLElement, options: GlobeSceneOptions): GlobeScene {
  let renderer: THREE.WebGLRenderer;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { antialias: true, alpha: true, powerPreference: "low-power" });
    if (!context) throw new Error("WebGL2 is unavailable.");
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    throw new Error("WebGL is unavailable on this device.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.dataset.globeCanvas = "true";
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const globe = new THREE.Group();
  scene.add(globe);
  const camera = new THREE.PerspectiveCamera(37, 1, 0.02, 12);
  const ambient = new THREE.HemisphereLight(0xe5ffff, 0x205457, 2.05);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff6dc, 3.15);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x91dcea, 0.7);
  fill.position.set(3, 0, 2);
  scene.add(fill);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const materialCache = new Map<number, THREE.MeshStandardMaterial>();
  const batches = new Map<number, THREE.BufferGeometry[]>();
  const keepGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const keepMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const material = (color: number) => {
    let result = materialCache.get(color);
    if (!result) {
      result = keepMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 }));
      materialCache.set(color, result);
    }
    return result;
  };
  const batch = (geometry: THREE.BufferGeometry, color: number, transform?: THREE.Matrix4) => {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (transform) copy.applyMatrix4(transform);
    // Every merged piece has the same attributes; UVs are unnecessary on painted geometry.
    copy.deleteAttribute("uv");
    const group = batches.get(color) ?? [];
    group.push(copy); batches.set(color, group);
  };
  const sphere = keepGeometry(new THREE.SphereGeometry(1, 96, 64));
  const ocean = new THREE.Mesh(sphere, keepMaterial(new THREE.MeshStandardMaterial({
    color: 0x168caf, roughness: 0.48, metalness: 0.04,
  })));
  globe.add(ocean);
  const atmosphere = new THREE.Mesh(keepGeometry(new THREE.SphereGeometry(1.025, 64, 48)), keepMaterial(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { glowColor: { value: new THREE.Color(0x81e8ef) } },
    vertexShader: "varying vec3 vNormal; varying vec3 vView; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz); gl_Position=projectionMatrix*p; }",
    fragmentShader: "uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vView; void main(){ float edge=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),3.0); gl_FragColor=vec4(glowColor,edge*0.3); }",
  })));
  globe.add(atmosphere);

  const unitBox = keepGeometry(new THREE.BoxGeometry(1, 1, 1));
  const unitBall = keepGeometry(new THREE.IcosahedronGeometry(1, 1));
  const unitCylinder = keepGeometry(new THREE.CylinderGeometry(1, 1, 1, 8));
  const unitCone = keepGeometry(new THREE.ConeGeometry(1, 1, 8));
  const white = 0xfff7dd;
  const wood = 0x95623e;
  const basisAt = (at: Vec3) => {
    const normal = vector(at).normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    if (east.lengthSq() < 0.01) east.set(1, 0, 0);
    const south = east.clone().cross(normal).normalize();
    return new THREE.Matrix4().makeBasis(east, normal, south).setPosition(vector(at));
  };
  const addPiece = (geometry: THREE.BufferGeometry, color: number, base: THREE.Matrix4, position: [number, number, number], scale: [number, number, number], rotation?: [number, number, number]) => {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0])));
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(...scale));
    batch(geometry, color, base.clone().multiply(local));
  };
  const box = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation?: [number, number, number]) => addPiece(unitBox, color, base, [x, y, z], [sx, sy, sz], rotation);
  const ball = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, radius: number, scaleY = 1) => addPiece(unitBall, color, base, [x, y, z], [radius, radius * scaleY, radius]);
  const cylinder = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, radius: number, height: number) => addPiece(unitCylinder, color, base, [x, y, z], [radius, height, radius]);
  const cone = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, radius: number, height: number) => addPiece(unitCone, color, base, [x, y, z], [radius, height, radius]);
  const tree = (base: THREE.Matrix4, palette: Palette, x: number, z: number, size = 1, fruit = false) => {
    cylinder(base, wood, x, 0.009 * size, z, 0.002 * size, 0.019 * size);
    ball(base, palette.leaf, x, 0.024 * size, z, 0.011 * size, 1.1);
    ball(base, palette.grass, x - 0.004 * size, 0.029 * size, z - 0.002, 0.006 * size);
    if (fruit) for (const dx of [-0.006, 0.004]) ball(base, palette.accent, x + dx * size, 0.024 * size, z + 0.008 * size, 0.0027 * size);
  };
  const landmark = (base: THREE.Matrix4, landscape: MapLandscape, p: Palette, index: number) => {
    // Each concept has a silhouette, not just a different paint color.
    if (landscape === "coast") {
      if (index % 2) {
        cylinder(base, white, 0, 0.019, 0, 0.007, 0.038);
        cylinder(base, p.accent, 0, 0.023, 0, 0.0074, 0.009);
        cylinder(base, 0x356378, 0, 0.042, 0, 0.008, 0.008);
        cone(base, p.accent, 0, 0.05, 0, 0.011, 0.011);
      } else {
        cylinder(base, wood, 0, 0.014, 0, 0.0022, 0.028);
        for (let n = 0; n < 5; n++) {
          const angle = n * Math.PI * 2 / 5;
          box(base, p.leaf, Math.cos(angle) * 0.009, 0.031, Math.sin(angle) * 0.009, 0.021, 0.003, 0.008, [0, -angle, 0.12]);
        }
      }
    } else if (landscape === "mirror") {
      for (const x of [-0.011, 0.011]) {
        cone(base, p.leaf, x, 0.018, 0, 0.008, 0.036);
        ball(base, p.accent, x, 0.039, 0, 0.004);
      }
      box(base, 0x76d6e6, 0, 0.003, 0.01, 0.018, 0.003, 0.015);
    } else if (landscape === "orchard" || landscape === "canopy") {
      tree(base, p, -0.009, 0, 0.85, landscape === "orchard");
      tree(base, p, 0.01, -0.008, 1.1, landscape === "orchard");
      if (landscape === "canopy") box(base, wood, 0.004, 0.021, 0.001, 0.028, 0.002, 0.008);
    } else if (landscape === "pattern") {
      for (let i = 0; i < 3; i++) {
        cylinder(base, white, (i - 1) * 0.014, 0.009, 0, 0.002, 0.018);
        const geo = keepGeometry(new THREE.SphereGeometry(0.009, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
        addPiece(geo, i % 2 ? p.leaf : p.accent, base, [(i - 1) * 0.014, 0.017, 0], [1, 1, 1]);
        ball(base, white, (i - 1) * 0.014 + 0.003, 0.024, 0, 0.0022);
      }
    } else if (landscape === "shapes" || landscape === "cliffs") {
      box(base, p.rock, -0.008, 0.011, 0, 0.02, 0.022, 0.021);
      box(base, landscape === "cliffs" ? white : p.accent, 0.009, 0.019, -0.009, 0.02, 0.038, 0.018);
      if (landscape === "shapes") cone(base, p.leaf, -0.007, 0.029, 0, 0.013, 0.015);
      else box(base, p.light, 0.009, 0.039, -0.009, 0.021, 0.004, 0.019);
    } else if (landscape === "lagoon" || landscape === "fractions") {
      cylinder(base, 0x60cee0, 0, 0.002, 0, 0.019, 0.003);
      if (landscape === "fractions") {
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2;
          box(base, white, Math.cos(angle) * 0.009, 0.005, Math.sin(angle) * 0.009, 0.021, 0.003, 0.002, [0, -angle, 0]);
        }
        cone(base, p.accent, 0, 0.017, 0, 0.006, 0.025);
      } else for (let i = 0; i < 3; i++) tree(base, p, -0.016 + i * 0.015, -0.012, 0.7);
    } else if (landscape === "desert") {
      cylinder(base, p.leaf, 0, 0.015, 0, 0.005, 0.03);
      box(base, p.leaf, 0.008, 0.014, 0, 0.018, 0.005, 0.006);
      cylinder(base, p.leaf, 0.015, 0.018, 0, 0.003, 0.012);
      cone(base, p.light, -0.015, 0.01, 0.006, 0.014, 0.02);
    } else if (landscape === "sharing") {
      box(base, p.accent, 0, 0.013, 0, 0.03, 0.004, 0.016);
      for (const x of [-0.011, 0.011]) box(base, wood, x, 0.006, 0, 0.003, 0.012, 0.014);
      for (const z of [-0.012, 0.012]) box(base, white, 0, 0.007, z, 0.034, 0.003, 0.005);
      for (const x of [-0.008, 0.008]) ball(base, p.light, x, 0.017, 0, 0.003);
    } else if (landscape === "measurement") {
      box(base, white, 0, 0.015, 0, 0.021, 0.03, 0.02);
      cone(base, p.accent, 0, 0.035, 0, 0.017, 0.015);
      for (const angle of [Math.PI / 4, -Math.PI / 4]) box(base, p.light, 0, 0.027, 0.012, 0.043, 0.005, 0.002, [0, 0, angle]);
      ball(base, wood, 0, 0.027, 0.014, 0.003);
    } else if (landscape === "market") {
      box(base, wood, 0, 0.009, 0, 0.03, 0.017, 0.02);
      for (let i = 0; i < 5; i++) box(base, i % 2 ? white : p.accent, (i - 2) * 0.007, 0.023, 0, 0.007, 0.003, 0.029, [-0.18, 0, 0]);
      for (const x of [-0.01, 0, 0.01]) ball(base, p.leaf, x, 0.019, 0.009, 0.003);
    } else if (landscape === "clock") {
      cylinder(base, white, 0, 0.02, 0, 0.011, 0.04);
      cone(base, p.accent, 0, 0.046, 0, 0.016, 0.016);
      box(base, p.leaf, 0, 0.03, 0.0115, 0.014, 0.015, 0.002);
      box(base, white, 0, 0.033, 0.013, 0.0015, 0.007, 0.002);
      box(base, white, 0.003, 0.03, 0.013, 0.007, 0.0015, 0.002);
    } else if (landscape === "area") {
      for (let x = 0; x < 3; x++) for (let z = 0; z < 2; z++) box(base, (x + z) % 2 ? p.light : p.leaf, (x - 1) * 0.012, 0.002, (z - 0.5) * 0.013, 0.011, 0.003, 0.012);
      for (const x of [-0.023, 0.023]) box(base, wood, x, 0.007, 0, 0.002, 0.014, 0.034);
    } else if (landscape === "balance") {
      cylinder(base, wood, 0, 0.017, 0, 0.003, 0.033);
      box(base, white, 0, 0.031, 0, 0.038, 0.003, 0.004);
      for (const x of [-0.017, 0.017]) {
        box(base, wood, x, 0.023, 0, 0.001, 0.017, 0.001);
        cylinder(base, p.accent, x, 0.014, 0, 0.009, 0.003);
      }
    }
  };

  const mapAt = (worldNumber: number, x: number, y: number, radius: number, width = 1200, height = 740) => mapPointToGlobe(worldNumber, x / width * 100, y / height * 100, false, radius);
  const islandOutline = (island: MapIsland, scale: number) => {
    const count = ["diamond", "mesa", "terrace"].includes(island.shape) ? 12 : 40;
    const points: [number, number][] = [];
    const rotation = (island.rotation ?? 0) * Math.PI / 180;
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count;
      let wobble = 1 + 0.07 * Math.sin(3 * a + 0.3) + 0.035 * Math.cos(5 * a);
      if (island.shape === "petal" || island.shape === "cloud") wobble = 0.91 + 0.105 * Math.cos(5 * a);
      if (island.shape === "diamond") wobble = 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      if (island.shape === "leaf") wobble = 0.93 + 0.11 * Math.cos(a - 1.2);
      if (island.shape === "crescent") wobble = 0.93 - 0.22 * Math.pow(Math.max(0, Math.cos(a)), 6);
      const x = Math.cos(a) * island.rx * wobble * scale;
      const y = Math.sin(a) * island.ry * wobble * scale;
      points.push([island.x + x * Math.cos(rotation) - y * Math.sin(rotation), island.y + x * Math.sin(rotation) + y * Math.cos(rotation)]);
    }
    return points;
  };
  const landRing = (worldNumber: number, island: MapIsland, innerScale: number, outerScale: number, innerRadius: number, outerRadius: number, color: number) => {
    const outer = islandOutline(island, outerScale);
    const inner = islandOutline(island, innerScale);
    const vertices: number[] = [];
    const put = (p: Vec3) => vertices.push(p.x, p.y, p.z);
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      const a = mapAt(worldNumber, ...inner[i], innerRadius);
      const b = mapAt(worldNumber, ...outer[i], outerRadius);
      const c = mapAt(worldNumber, ...outer[j], outerRadius);
      const d = mapAt(worldNumber, ...inner[j], innerRadius);
      // Map Y points south, so the front face needs clockwise map-space winding.
      put(a); put(c); put(b); put(a); put(d); put(c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals(); batch(geometry, color); geometry.dispose();
  };
  const pathTube = (points: readonly Vec3[], color: number, radius = 0.0015) => {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points.map(vector));
    const geometry = new THREE.TubeGeometry(curve, Math.max(12, Math.min(48, points.length)), radius, 5, false);
    batch(geometry, color); geometry.dispose();
  };
  const stopAnchors = new Map<string, Vec3>();
  const bookAnchors = new Map<string, Vec3>();
  const stopMarkers = new Map<string, THREE.Mesh>();
  const markerGeometry = keepGeometry(new THREE.CylinderGeometry(0.006, 0.008, 0.006, 20));
  const markerPlain = material(white);
  const markerComplete = material(0xffc64b);
  for (const world of WORLD_DEFINITIONS) {
    const authored = getWorldMapLayout(world.number, world.stopIds.length);
    const layout = authored.desktop;
    const palette = PALETTES[authored.landscape];
    const topRadius = authored.landscape === "cliffs" ? 1.023 : 1.013;
    for (const island of layout.islands) {
      landRing(world.number, island, 0.99, 1.14, 1.004, 1.0015, 0x76cfd0);
      landRing(world.number, island, 0.92, 1.06, topRadius - 0.003, 1.004, palette.rock);
      landRing(world.number, island, 0.85, 0.99, topRadius, topRadius - 0.002, 0xfbe1a3);
      landRing(world.number, island, 0, 0.86, topRadius + 0.001, topRadius, palette.grass);
      if (island.stopIndex !== undefined) {
        const decor = mapAt(world.number, island.x + 85, island.y - 20, topRadius + 0.001);
        landmark(basisAt(decor), authored.landscape, palette, island.stopIndex);
        const detail = basisAt(mapAt(world.number, island.x + 81, island.y + 29, topRadius + 0.001));
        if (["desert", "cliffs", "area", "shapes"].includes(authored.landscape)) {
          ball(detail, palette.light, 0, 0.004, 0, 0.005, 0.7);
          ball(detail, palette.rock, 0.007, 0.003, 0.004, 0.0035);
        } else tree(detail, palette, 0, 0, 0.55, authored.landscape === "orchard");
      } else {
        const base = basisAt(mapAt(world.number, island.x + 32, island.y - 7, topRadius + 0.001));
        tree(base, palette, 0, 0, 0.62);
        box(base, wood, -0.012, 0.004, 0.007, 0.014, 0.007, 0.005);
      }
    }
    world.stopIds.forEach((id, index) => {
      const p = layout.stopPoints[index];
      const anchor = mapPointToGlobe(world.number, p.x, p.y, false, topRadius + 0.004);
      stopAnchors.set(id, anchor);
      const marker = new THREE.Mesh(markerGeometry, markerPlain);
      marker.matrixAutoUpdate = false; marker.matrix.copy(basisAt(anchor));
      globe.add(marker); stopMarkers.set(id, marker);
      if (index < layout.roads.length) pathTube(getGlobeRoadPoints(world.number, world.stopIds.length, index, false, 1.018), 0xffe8aa, 0.00165);
    });
    layout.books.forEach(book => {
      bookAnchors.set(`${world.id}:${book.id}`, mapPointToGlobe(world.number, book.x, book.y, false, topRadius + 0.006));
    });
    // Short side paths are a deliberate dotted stepping-stone trail to each book.
    for (const [pathIndex, path] of layout.storyPaths.entries()) {
      const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      if (numbers.length !== 8) continue;
      for (let step = 1; step <= 9; step++) {
        const t = step / 10; const u = 1 - t;
        const x = u ** 3 * numbers[0] + 3 * u * u * t * numbers[2] + 3 * u * t * t * numbers[4] + t ** 3 * numbers[6];
        const y = u ** 3 * numbers[1] + 3 * u * u * t * numbers[3] + 3 * u * t * t * numbers[5] + t ** 3 * numbers[7];
        const at = mapAt(world.number, x, y, 1.01 + pathIndex * 0.0001);
        cylinder(basisAt(at), 0xffe6ad, 0, 0, 0, 0.0015, 0.001);
      }
    }
    const destination = getGlobeDestination(world.id);
    if (destination) {
      const base = basisAt(vector(destination.harbor).multiplyScalar(1.003));
      for (let i = 0; i < 5; i++) box(base, i % 2 ? 0xbc8a55 : 0xd0a168, 0, 0.001, (i - 2) * 0.005, 0.024, 0.003, 0.0045);
      for (const x of [-0.012, 0.012]) for (const z of [-0.012, 0.012]) cylinder(base, wood, x, 0.003, z, 0.0017, 0.012);
    }
  }

  for (const destination of GLOBE_DESTINATIONS.filter(region => region.kind === "boss")) {
    const base = basisAt(vector(destination.center).multiplyScalar(1.014));
    cylinder(base, 0xf6d795, 0, 0, 0, 0.064, 0.023);
    cylinder(base, 0x8c85b8, 0, 0.018, 0, 0.047, 0.016);
    box(base, 0xe7e1f6, 0, 0.048, 0, 0.043, 0.058, 0.038);
    for (const x of [-0.026, 0.026]) {
      cylinder(base, 0xb9a6db, x, 0.044, 0, 0.014, 0.078);
      cone(base, 0x8665ad, x, 0.092, 0, 0.019, 0.024);
      cylinder(base, wood, x, 0.11, 0, 0.001, 0.021);
      box(base, 0xffc651, x + 0.006, 0.116, 0, 0.012, 0.008, 0.001);
    }
    box(base, 0x5c6086, 0, 0.025, 0.021, 0.015, 0.03, 0.002);
    ball(base, 0xffc651, 0, 0.069, 0.021, 0.006);
  }
  for (const [color, pieces] of batches) {
    const merged = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (merged) globe.add(new THREE.Mesh(keepGeometry(merged), material(color)));
  }
  batches.clear();

  // Tiny wave strokes communicate a curved sea without an animated texture or grid.
  const wavePositions: number[] = [];
  const waveMaterial = keepMaterial(new THREE.LineBasicMaterial({ color: 0x92e4e5, transparent: true, opacity: 0.19, depthWrite: false }));
  for (let i = 0; i < 310; i++) {
    const y = 1 - 2 * (i + 0.5) / 310;
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const at = new THREE.Vector3(Math.sqrt(1 - y * y) * Math.sin(angle), y, Math.sqrt(1 - y * y) * Math.cos(angle));
    if (GLOBE_DESTINATIONS.some(region => at.dot(vector(region.center)) > 0.97)) continue;
    const east = new THREE.Vector3(0, 1, 0).cross(at).normalize();
    for (const sign of [-1, 1]) {
      const p = at.clone().addScaledVector(east, sign * 0.009).normalize().multiplyScalar(1.002);
      wavePositions.push(p.x, p.y, p.z);
    }
  }
  const waveGeometry = keepGeometry(new THREE.BufferGeometry());
  waveGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wavePositions, 3));
  globe.add(new THREE.LineSegments(waveGeometry, waveMaterial));

  let disposed = false;
  let unavailable = false;
  let frame: GlobeSceneFrame | undefined;
  let width = 1; let height = 1;
  const spriteMaterial = keepMaterial(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08, depthTest: true, depthWrite: false, toneMapped: false }));
  const animal = new THREE.Sprite(spriteMaterial);
  animal.center.set(0.5, 0.08);
  animal.scale.set(0.031, 0.031, 1);
  animal.visible = false;
  globe.add(animal);
  const basePath = (options.assetBasePath ?? "").replace(/\/$/, "");
  new THREE.TextureLoader().load(`${basePath}/avatars/hedgehog.svg`, texture => {
    if (disposed) { texture.dispose(); return; }
    // SVGs have a 32px intrinsic size. Rasterize once at a larger local canvas
    // size so the billboard stays crisp while zooming in on the animal.
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d");
    let avatarTexture: THREE.Texture = texture;
    if (context) {
      context.drawImage(texture.image as HTMLImageElement, 0, 0, 256, 256);
      avatarTexture = new THREE.CanvasTexture(canvas); texture.dispose();
    }
    avatarTexture.colorSpace = THREE.SRGBColorSpace;
    avatarTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    textures.add(avatarTexture); spriteMaterial.map = avatarTexture; spriteMaterial.needsUpdate = true;
    if (frame) draw(frame);
  }, undefined, () => { /* The 3D boat and stop marker still identify position if the icon fails. */ });

  const boat = new THREE.Group();
  globe.add(boat); boat.visible = false; boat.scale.setScalar(3);
  const hull = new THREE.Mesh(keepGeometry(new THREE.SphereGeometry(1, 16, 10)), material(0x95593b));
  hull.scale.set(0.012, 0.005, 0.024); hull.position.y = 0.004; boat.add(hull);
  const gunwale = new THREE.Mesh(keepGeometry(new THREE.BoxGeometry(0.019, 0.003, 0.032)), material(0xe3b76c));
  gunwale.position.y = 0.007; boat.add(gunwale);
  const mast = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(0.0009, 0.0011, 0.041, 6)), material(wood));
  mast.position.set(0, 0.027, -0.005); boat.add(mast);
  const sailShape = new THREE.Shape(); sailShape.moveTo(0, 0); sailShape.lineTo(0, 0.033); sailShape.quadraticCurveTo(0.011, 0.02, 0.018, 0); sailShape.closePath();
  const sail = new THREE.Mesh(keepGeometry(new THREE.ShapeGeometry(sailShape)), keepMaterial(new THREE.MeshStandardMaterial({ color: 0xfff2cc, roughness: 0.9, side: THREE.DoubleSide })));
  sail.position.set(0, 0.011, -0.005); sail.rotation.y = Math.PI / 2; boat.add(sail);
  const pennantGeometry = keepGeometry(new THREE.BufferGeometry());
  pennantGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.051, -0.005, 0, 0.046, -0.005, 0, 0.049, 0.005], 3)); pennantGeometry.computeVertexNormals();
  boat.add(new THREE.Mesh(pennantGeometry, keepMaterial(new THREE.MeshStandardMaterial({ color: 0xf07659, side: THREE.DoubleSide }))));
  const wakeGeometry = keepGeometry(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.007, 0.001, -0.022), new THREE.Vector3(-0.014, 0.001, -0.038),
    new THREE.Vector3(0.007, 0.001, -0.022), new THREE.Vector3(0.014, 0.001, -0.038),
  ]));
  boat.add(new THREE.LineSegments(wakeGeometry, keepMaterial(new THREE.LineBasicMaterial({ color: 0xc0f4ed, transparent: true, opacity: 0.85 }))));

  const worldLandscape = (id: string) => {
    const world = WORLD_DEFINITIONS.find(candidate => candidate.id === id);
    return world ? getWorldMapLayout(world.number, world.stopIds.length).landscape : "coast";
  };
  const inverseRotation = new THREE.Quaternion();
  const worldPosition = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const eye = new THREE.Vector3();
  function project(at: Vec3): GlobeProjectedPoint {
    worldPosition.copy(vector(at)).applyQuaternion(globe.quaternion);
    eye.copy(camera.position).sub(worldPosition);
    const front = eye.dot(worldPosition) > -0.014;
    projected.copy(worldPosition).project(camera);
    return {
      x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height,
      visible: front && projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.12 && Math.abs(projected.y) < 1.12,
      scale: height / (2 * Math.tan(camera.fov * Math.PI / 360) * eye.length()),
    };
  }
  function draw(next: GlobeSceneFrame) {
    if (disposed || unavailable) return;
    frame = next;
    const focus = vector(next.focus).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(focus, -focus.y).normalize();
    if (up.lengthSq() < 0.01) up.set(0, 0, -1);
    const right = up.clone().cross(focus).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, focus);
    inverseRotation.setFromRotationMatrix(basis).invert();
    globe.quaternion.copy(inverseRotation);
    const zoom = clamp(next.zoom, 0, 1);
    const tan = Math.tan(camera.fov * Math.PI / 360);
    const aspect = width / height;
    const overviewDistance = Math.max(3.7, 1.24 / (tan * aspect));
    const focusDistance = Math.max(0.205 / (tan * aspect), 0.194 / tan);
    // Look across the surface in close view: a visible curved horizon connects
    // the focused islands to the same globe seen in the overview.
    const tilt = (aspect < 1 ? 35 : 45) * Math.PI / 180;
    camera.position.set(0, -focusDistance * Math.sin(tilt) * zoom,
      THREE.MathUtils.lerp(overviewDistance, 1 + focusDistance * Math.cos(tilt), zoom));
    camera.lookAt(0, 0, zoom);
    camera.updateMatrixWorld();
    const completed = new Set(next.completedStopIds);
    for (const [id, marker] of stopMarkers) marker.material = completed.has(id) ? markerComplete : markerPlain;
    boat.visible = !!next.boatPosition;
    if (next.boatPosition) {
      const normal = vector(next.boatPosition).normalize();
      const forward = next.boatHeading ? vector(next.boatHeading).addScaledVector(normal, -vector(next.boatHeading).dot(normal)).normalize() : new THREE.Vector3(0, 1, 0).cross(normal).normalize();
      const boatRight = normal.clone().cross(forward).normalize();
      const boatBasis = new THREE.Matrix4().makeBasis(boatRight, normal, forward);
      boat.quaternion.setFromRotationMatrix(boatBasis);
      boat.position.copy(normal).multiplyScalar(1.007);
    }
    const animalAt = next.boatPosition ?? next.avatarPosition;
    animal.visible = !!animalAt;
    if (animalAt) {
      const foot = vector(animalAt).normalize();
      if (!next.boatPosition) foot.addScaledVector(right, 0.032).addScaledVector(up, -0.004).normalize();
      const islandRadius = worldLandscape(next.activeDestinationId) === "cliffs" ? 1.027 : 1.018;
      animal.position.copy(foot).multiplyScalar(next.boatPosition ? 1.034 : islandRadius + (next.avatarHop ?? 0));
      animal.scale.setScalar(next.boatPosition ? 0.068 : 0.052);
    }
    globe.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const worlds: Record<string, GlobeProjectedPoint> = {};
    for (const region of GLOBE_DESTINATIONS) worlds[region.id] = project(vector(region.center).multiplyScalar(region.kind === "boss" ? 1.065 : 1.031));
    const stops: Record<string, GlobeProjectedPoint> = {};
    const books: Record<string, GlobeProjectedPoint> = {};
    const world = WORLD_DEFINITIONS.find(candidate => candidate.id === next.activeDestinationId);
    if (world) {
      for (const id of world.stopIds) { const at = stopAnchors.get(id); if (at) stops[id] = project(at); }
      for (const [id, at] of bookAnchors) if (id.startsWith(`${world.id}:`)) books[id] = project(at);
    }
    options.onProject({ width, height, worlds, stops, books, ...(animalAt ? { avatar: project(animal.position) } : {}), ...(next.boatPosition ? { boat: project(next.boatPosition) } : {}) });
  }
  function resize() {
    if (disposed || unavailable) return;
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (frame) draw(frame);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const contextLost = (event: Event) => { event.preventDefault(); if (!disposed && !unavailable) { unavailable = true; options.onUnavailable(); } };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  resize();
  return {
    render: draw, resize,
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      for (const geometry of geometries) geometry.dispose();
      for (const entry of materials) entry.dispose();
      for (const texture of textures) texture.dispose();
      renderer.renderLists.dispose(); renderer.dispose();
      // Question panels unmount the map. Release its context immediately rather
      // than waiting for detached canvases to be collected over a long session.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
