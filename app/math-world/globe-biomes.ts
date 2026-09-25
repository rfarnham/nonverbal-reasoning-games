import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import { TREE_SWAY_GLSL } from "./globe-foliage.ts";
import { getWorldMapLayout, type MapIsland } from "./map-layouts.ts";
import { GLOBE_POLAR_CAPS, getGlobeRegion, mapPointToGlobe, tangentPointToGlobe, type Vec3 } from "./globe-geometry.ts";

import { getIslandRelief, getWorldBiome, type GlobeBiome, type GlobeBiomeId } from "./globe-biome-data.ts";
export { getWorldBiome } from "./globe-biome-data.ts";

export type GlobeSmokeSource = Readonly<{ position: Vec3; strength: number }>;
export type GlobeBiomes = Readonly<{
  smokeSources: readonly GlobeSmokeSource[];
  mistSources: readonly GlobeSmokeSource[];
  update: (timeSeconds: number, activeDestinationId: string, zoom: number, sunDirection?: THREE.Vector3) => void;
  dispose: () => void;
}>;

type ColorSet = { surface: number; beach: number; rock: number; reef: number };
const C = {
  grass: 0x8ccf4b, lime: 0xb4dc68, moss: 0x599f53, pine: 0x227755, forest: 0x148457, leaf: 0x42b869,
  darkLeaf: 0x166c51, sand: 0xffdf9c, cream: 0xfff2c8, coral: 0xfa9279, orange: 0xed9849,
  clay: 0xba654b, redRock: 0x9f594b, dune: 0xf8c874, brown: 0x89634c, rock: 0x778f91,
  slate: 0x526b7c, basalt: 0x414d62, basaltLight: 0x66788b, snow: 0xf0ffff, ice: 0xa1e8f1,
  blueIce: 0x53bdd6, iceShadow: 0x328aa9, water: 0x25c8c4, waterDeep: 0x149eae, foam: 0xd9fff0,
  gold: 0xf2be53, rust: 0xdb7943, scarlet: 0xc9534f, pink: 0xeeb2bb, purple: 0xb28bd6,
  lava: 0xff6e25, lavaLight: 0xffc25a, crater: 0x342d45,
};
const COLORS: Record<GlobeBiomeId, ColorSet> = {
  tropical: { surface: C.grass, beach: C.sand, rock: C.brown, reef: C.water }, alpine: { surface: C.moss, beach: C.cream, rock: C.slate, reef: C.blueIce },
  orchard: { surface: C.lime, beach: C.cream, rock: C.brown, reef: C.water }, woodland: { surface: C.moss, beach: C.sand, rock: C.brown, reef: C.waterDeep },
  volcanic: { surface: C.basaltLight, beach: C.slate, rock: C.basalt, reef: C.waterDeep }, lagoon: { surface: C.lime, beach: C.cream, rock: C.sand, reef: C.water },
  river: { surface: C.grass, beach: C.sand, rock: C.brown, reef: C.water }, desert: { surface: C.dune, beach: C.sand, rock: C.clay, reef: C.water },
  rainforest: { surface: C.moss, beach: C.sand, rock: C.brown, reef: C.waterDeep }, glacier: { surface: C.snow, beach: C.ice, rock: C.blueIce, reef: C.iceShadow },
  tundra: { surface: C.snow, beach: C.ice, rock: C.slate, reef: C.blueIce }, waterfalls: { surface: C.grass, beach: C.cream, rock: C.slate, reef: C.water },
  mangrove: { surface: C.moss, beach: C.sand, rock: C.brown, reef: C.water }, autumn: { surface: C.gold, beach: C.cream, rock: C.brown, reef: C.waterDeep },
  terraces: { surface: C.lime, beach: C.cream, rock: C.moss, reef: C.water }, basalt: { surface: C.moss, beach: C.rock, rock: C.basalt, reef: C.waterDeep },
};
const vector = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const random = (seed: number) => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123; return n - Math.floor(n); };
type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];

/** Local geometry shares batched flow, shore, foliage, and ice materials.
 * React owns scheduling, visibility, and reduced-motion policy through update(). */
export function createGlobeBiomes(globe: THREE.Group): GlobeBiomes {
  const scenery = new THREE.Group();
  scenery.name = "archipelago-biomes";
  globe.add(scenery);
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  const batches = new Map<number, THREE.BufferGeometry[]>();
  const habitatBatches = new Map<number, THREE.BufferGeometry[]>();
  let habitatMotion: { anchor: THREE.Vector3; height: number; phase: number; kind: 1 | 2 } | null = null;
  const shorePositions: number[] = [], shoreDrifts: number[] = [], shoreUvs: number[] = [], shorePhases: number[] = [];
  const movingBatches: THREE.BufferGeometry[][] = [[], []];
  const smokeSources: GlobeSmokeSource[] = [];
  const mistSources: GlobeSmokeSource[] = [];
  const own = <T extends THREE.BufferGeometry>(geometry: T): T => { ownedGeometries.add(geometry); return geometry; };
  const boxGeometry = own(new THREE.BoxGeometry(1, 1, 1));
  const ballGeometry = own(new THREE.IcosahedronGeometry(1, 1));
  const roughBallGeometry = own(new THREE.IcosahedronGeometry(1, 0));
  const cylinderGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 7));
  const coneGeometry = own(new THREE.ConeGeometry(1, 1, 7));
  const peakGeometry = own(new THREE.ConeGeometry(1, 1, 4));
  const rimGeometry = own(new THREE.TorusGeometry(1, 0.16, 5, 12));
  const capGeometry = own(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2));
  const disposePieces = (pieces: readonly THREE.BufferGeometry[]) => pieces.forEach(piece => piece.dispose());
  const batch = (geometry: THREE.BufferGeometry, color: number, transform?: THREE.Matrix4) => {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (transform) copy.applyMatrix4(transform);
    copy.deleteAttribute("uv");
    const target = habitatMotion ? habitatBatches : batches;
    if (habitatMotion) {
      const positions = copy.getAttribute("position");
      const anchors = new Float32Array(positions.count * 3), params = new Float32Array(positions.count * 3);
      const up = habitatMotion.anchor.clone().normalize();
      for (let index = 0; index < positions.count; index += 1) {
        const height = (positions.getX(index) - habitatMotion.anchor.x) * up.x
          + (positions.getY(index) - habitatMotion.anchor.y) * up.y
          + (positions.getZ(index) - habitatMotion.anchor.z) * up.z;
        const weight = habitatMotion.kind === 2 ? 1 : Math.pow(THREE.MathUtils.clamp(height / habitatMotion.height, 0, 1), 2);
        anchors.set([habitatMotion.anchor.x, habitatMotion.anchor.y, habitatMotion.anchor.z], index * 3);
        params.set([weight, habitatMotion.phase, habitatMotion.kind], index * 3);
      }
      copy.setAttribute("motionAnchor", new THREE.BufferAttribute(anchors, 3));
      copy.setAttribute("motionParams", new THREE.BufferAttribute(params, 3));
    }
    const pieces = target.get(color) ?? [];
    pieces.push(copy); target.set(color, pieces);
  };
  const mapAt = (world: number, x: number, y: number, radius: number) => mapPointToGlobe(world, x / 12, y / 7.4, false, radius);
  const basisAt = (world: number, x: number, y: number, radius: number) => {
    const p = vector(mapAt(world, x, y, radius));
    const up = p.clone().normalize();
    const east = vector(getGlobeRegion(world).east).addScaledVector(up, -vector(getGlobeRegion(world).east).dot(up)).normalize();
    return new THREE.Matrix4().makeBasis(east, up, east.clone().cross(up).normalize()).setPosition(p);
  };
  const piece = (geometry: THREE.BufferGeometry, color: number, base: THREE.Matrix4, position: Point3, scale: Point3, rotation: Point3 = [0, 0, 0]) => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    batch(geometry, color, base.clone().multiply(local));
  };
  const box = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation: Point3 = [0, 0, 0]) => piece(boxGeometry, color, base, [x, y, z], [sx, sy, sz], rotation);
  const ball = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, radius: number, height = 1, rough = false) => piece(rough ? roughBallGeometry : ballGeometry, color, base, [x, y, z], [radius, radius * height, radius]);
  const cylinder = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, radius: number, height: number) => piece(cylinderGeometry, color, base, [x, y, z], [radius, height, radius]);
  const cone = (base: THREE.Matrix4, color: number, x: number, y: number, z: number, radius: number, height: number, jagged = false) => piece(jagged ? peakGeometry : coneGeometry, color, base, [x, y, z], [radius, height, radius], [0, x * 400 + z * 200, 0]);

  const outline = (island: MapIsland, biome: GlobeBiome, scale: number): Point2[] => {
    const angular = ["volcanic", "glacier", "tundra", "basalt", "desert"].includes(biome.id);
    const count = angular ? 20 : 40;
    const rotation = (island.rotation ?? 0) * Math.PI / 180;
    return Array.from({ length: count }, (_, index) => {
      const a = index * Math.PI * 2 / count;
      let wobble = 1 + 0.07 * Math.sin(a * 3 + biome.variant) + 0.045 * Math.cos(a * 5);
      if (["petal", "cloud"].includes(island.shape)) wobble = 0.91 + 0.09 * Math.cos(a * 5);
      if (island.shape === "diamond") wobble = 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      if (island.shape === "crescent") wobble -= 0.22 * Math.max(0, Math.cos(a)) ** 6;
      if (angular) wobble += index % 2 ? 0.055 : -0.025;
      const x = Math.cos(a) * island.rx * wobble * scale;
      const y = Math.sin(a) * island.ry * wobble * scale;
      return [island.x + x * Math.cos(rotation) - y * Math.sin(rotation), island.y + x * Math.sin(rotation) + y * Math.cos(rotation)];
    });
  };
  const polygon = (world: number, boundary: readonly Point2[], radius: number, color: number, holes: readonly Point2[][] = []) => {
    const contour = boundary.map(p => new THREE.Vector2(...p));
    const cuts = holes.map(hole => hole.map(p => new THREE.Vector2(...p)));
    const indices = THREE.ShapeUtils.triangulateShape(contour, cuts);
    const flat = [...boundary, ...holes.flat()];
    const positions: number[] = [];
    for (const triangle of indices) for (const index of [...triangle].reverse()) { const p = mapAt(world, ...flat[index], radius); positions.push(p.x, p.y, p.z); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    batch(geometry, color); geometry.dispose();
  };
  const ring = (world: number, inner: readonly Point2[], outer: readonly Point2[], innerRadius: number, outerRadius: number, color: number) => {
    const vertices: number[] = [];
    const put = (p: Vec3) => vertices.push(p.x, p.y, p.z);
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      const a = mapAt(world, ...inner[i], innerRadius), b = mapAt(world, ...outer[i], outerRadius), c = mapAt(world, ...outer[j], outerRadius), d = mapAt(world, ...inner[j], innerRadius);
      put(a); put(c); put(b); put(a); put(d); put(c);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    batch(geometry, color); geometry.dispose();
  };
  const animateGeometry = (geometry: THREE.BufferGeometry, color: number, world: number, lava = false) => {
    const positions = geometry.getAttribute("position");
    const colorValue = new THREE.Color(color);
    const colors = new Float32Array(positions.count * 3); const regions = new Float32Array(positions.count);
    for (let index = 0; index < positions.count; index++) { colors.set([colorValue.r, colorValue.g, colorValue.b], index * 3); regions[index] = world; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)); geometry.setAttribute("region", new THREE.BufferAttribute(regions, 1));
    movingBatches[lava ? 1 : 0].push(geometry);
  };
  const liquidPool = (world: number, points: readonly Point2[], radius: number, color: number, lava = false) => {
    const center: Point2 = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
    const positions: number[] = [], uv: number[] = [];
    for (let i = 0; i < points.length; i++) for (const p of [center, points[(i + 1) % points.length], points[i]]) {
      const at = mapAt(world, ...p, radius); positions.push(at.x, at.y, at.z); uv.push((p[0] - center[0]) / 16, (p[1] - center[1]) / 16);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    animateGeometry(geometry, color, world, lava);
  };
  const liquidRibbon = (world: number, base: THREE.Matrix4, points: readonly Point3[], width: number, color: number, lava = false) => {
    const positions: number[] = [], uv: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      for (const [pointIndex, side] of [[i, -1], [i + 1, 1], [i, 1], [i, -1], [i + 1, -1], [i + 1, 1]]) {
        const p = points[pointIndex]; const at = new THREE.Vector3(p[0] + side * width / 2, p[1], p[2]).applyMatrix4(base);
        positions.push(at.x, at.y, at.z); uv.push(side * 0.5 + 0.5, pointIndex * 1.2);
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    animateGeometry(geometry, color, world, lava);
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, count = 40): Point2[] => Array.from({ length: count }, (_, index) => [x + Math.cos(index * Math.PI * 2 / count) * rx, y + Math.sin(index * Math.PI * 2 / count) * ry]);

  const tree = (base: THREE.Matrix4, kind: "palm" | "broad" | "pine" | "autumn" | "orchard" | "mangrove" | "redwood", size: number, seed: number) => {
    const previousMotion = habitatMotion;
    habitatMotion = { anchor: new THREE.Vector3().setFromMatrixPosition(base), height: (kind === "redwood" ? 0.073 : 0.041) * size, phase: seed * 1.713, kind: 1 };
    const trunkHeight = (kind === "redwood" ? 0.03 : 0.016) * size;
    cylinder(base, C.brown, 0, trunkHeight / 2, 0, 0.0017 * size, trunkHeight);
    if (kind === "palm") {
      const crown = trunkHeight + 0.004 * size;
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + seed;
        const blade = new THREE.BufferGeometry();
        blade.setAttribute("position", new THREE.Float32BufferAttribute([0, crown, 0, Math.cos(a - 0.22) * 0.013 * size, crown + 0.003 * size, Math.sin(a - 0.22) * 0.013 * size, Math.cos(a) * 0.023 * size, crown - 0.005 * size, Math.sin(a) * 0.023 * size, Math.cos(a + 0.22) * 0.013 * size, crown + 0.003 * size, Math.sin(a + 0.22) * 0.013 * size], 3));
        blade.setIndex([0, 2, 1, 0, 3, 2]); blade.computeVertexNormals(); batch(blade, i % 2 ? C.leaf : C.forest, base); blade.dispose();
      }
      ball(base, C.brown, 0.002 * size, crown - 0.002 * size, 0, 0.0025 * size);
    } else if (kind === "pine" || kind === "redwood") {
      for (let i = 0; i < 3; i++) cone(base, i % 2 ? C.pine : C.forest, 0, trunkHeight + (i * 0.009 - 0.002) * size, 0, (0.012 - i * 0.0027) * size, 0.024 * size);
    } else {
      const autumn = kind === "autumn";
      const leafColor = autumn ? [C.gold, C.rust, C.scarlet][Math.floor(random(seed) * 3)] : kind === "orchard" && seed % 3 < 1 ? C.pink : C.forest;
      ball(base, leafColor, -0.004 * size, trunkHeight + 0.006 * size, 0, 0.0105 * size, 0.95);
      ball(base, autumn ? C.gold : C.leaf, 0.004 * size, trunkHeight + 0.008 * size, 0.001, 0.009 * size, 1.1);
      ball(base, leafColor, 0, trunkHeight + 0.015 * size, -0.003 * size, 0.0085 * size);
      if (kind === "orchard") for (let i = 0; i < 4; i++) ball(base, C.orange, Math.cos(i * 2) * 0.008 * size, trunkHeight + (0.005 + i * 0.002) * size, Math.sin(i * 2) * 0.008 * size, 0.0021 * size);
      if (kind === "mangrove") for (let i = 0; i < 4; i++) box(base, C.brown, Math.cos(i * Math.PI / 2) * 0.003, 0.003, Math.sin(i * Math.PI / 2) * 0.003, 0.0018, 0.013, 0.0018, [Math.cos(i * Math.PI / 2) * 0.55, 0, Math.sin(i * Math.PI / 2) * 0.55]);
    }
    habitatMotion = previousMotion;
  };
  const clearForControls = (island: MapIsland, x: number, y: number) => island.stopIndex === undefined
    ? Math.hypot(x, y) > 29
    : !(x > -125 && x < 15 && y > -22 && y < 60);
  const grove = (world: number, island: MapIsland, radius: number, kind: Parameters<typeof tree>[1], count: number, seed: number, small = false, reliefScale = 1) => {
    for (let i = 0; i < count; i++) {
      const a = i * 2.399963 + seed;
      const reach = Math.sqrt((i + 1) / (count + 1));
      const x = Math.cos(a) * island.rx * 0.71 * reach;
      const y = Math.sin(a) * island.ry * 0.68 * reach;
      if (!clearForControls(island, x, y)) continue;
      tree(basisAt(world, island.x + x, island.y + y, radius), kind, ((small ? 0.45 : 0.72) + random(seed + i * 3) * (small ? 0.2 : 0.4)) * reliefScale, seed + i);
    }
  };

  for (const world of WORLD_DEFINITIONS) {
    const authored = getWorldMapLayout(world.number, world.stopIds.length);
    const biome = getWorldBiome(world.number); const colors = COLORS[biome.id];
    const top = authored.landscape === "cliffs" ? 1.023 : 1.013;
    for (const [islandIndex, island] of authored.desktop.islands.entries()) {
      const quiz = island.stopIndex !== undefined; const seed = world.number * 17 + islandIndex * 7;
      const relief = quiz ? getIslandRelief(world.number, island.stopIndex!, world.stopIds.length) : undefined;
      const upper = outline(island, biome, 0.86);
      ring(world.number, outline(island, biome, 0.99), outline(island, biome, 1.065), 1.003, 1.0018, colors.reef);
      ring(world.number, outline(island, biome, 1.065), outline(island, biome, 1.12), 1.0018, 1.0012, new THREE.Color(colors.reef).lerp(new THREE.Color(0x137e9d), 0.34).getHex());
      const foamInner = outline(island, biome, 1.020), foamOuter = outline(island, biome, 1.047);
      const foamReach = outline(island, biome, 1.117);
      for (let band = 0; band < 2; band += 1) for (let i = 0; i < foamInner.length; i += 1) {
        const j = (i + 1) % foamInner.length;
        for (const [index, side] of [[i, 0], [j, 1], [i, 1], [i, 0], [j, 0], [j, 1]]) {
          const point = side ? foamOuter[index] : foamInner[index];
          const at = mapAt(world.number, ...point, 1.0026);
          const coast = mapAt(world.number, ...foamInner[index], 1.0026);
          const reach = mapAt(world.number, ...foamReach[index], 1.0026);
          shorePositions.push(at.x, at.y, at.z);
          shoreDrifts.push(reach.x - coast.x, reach.y - coast.y, reach.z - coast.z);
          shoreUvs.push((index === 0 && i === foamInner.length - 1 ? foamInner.length : index) / foamInner.length, side);
          shorePhases.push(random(seed) + band * 0.5);
        }
      }
      ring(world.number, outline(island, biome, 0.97), outline(island, biome, 1.04), top - 0.004, 1.003, colors.rock);
      ring(world.number, upper, outline(island, biome, 0.99), top, top - 0.003, colors.beach);
      const poolBiome = ["lagoon", "alpine", "mangrove"].includes(biome.id);
      const poolX = island.x + (biome.id === "lagoon" ? 47 : 52);
      const poolY = island.y + (biome.id === "lagoon" ? 7 : -3);
      const hole = poolBiome && quiz ? ellipse(poolX, poolY, biome.id === "lagoon" ? 53 : 38, biome.id === "lagoon" ? 37 : 25) : undefined;
      polygon(world.number, upper, top + 0.0004, colors.surface, hole ? [hole] : []);
      if (hole) {
        const lip = hole.map(([x, y]) => [poolX + (x - poolX) * 1.06, poolY + (y - poolY) * 1.06] as Point2);
        ring(world.number, hole, lip, top - 0.007, top + 0.0005, colors.beach);
        liquidPool(world.number, hole, top - 0.0013, biome.id === "alpine" ? C.blueIce : C.water);
      }
      const base = basisAt(world.number, island.x + (quiz ? 60 : 31), island.y - (quiz ? 10 : 12), top + 0.0005);
      const small = relief?.scale ?? 0.56;

      // Book islands keep a full central clearing. Their geology lives at the
      // edges, below the book rather than behind its large native hit target.
      if (!quiz) {
        const edge = basisAt(world.number, island.x + 52, island.y - 15, top + 0.001);
        const back = basisAt(world.number, island.x - 25, island.y - 38, top + 0.001);
        if (biome.id === "volcanic") {
          cone(edge, C.basalt, 0, 0.009, 0, 0.008, 0.018);
          ball(edge, C.lava, 0, 0.017, 0, 0.0026, 0.3);
          ball(back, C.basaltLight, 0, 0.003, 0, 0.005, 0.8, true);
        } else if (biome.id === "glacier" || biome.id === "tundra" || biome.id === "alpine") {
          cone(edge, C.blueIce, 0, 0.010, 0, 0.007, 0.023, true);
          cone(edge, C.snow, 0, 0.018, 0, 0.004, 0.009, true);
          ball(back, C.snow, 0, 0.003, 0, 0.005, 0.5, true);
        } else if (biome.id === "desert" || biome.id === "basalt") {
          cylinder(edge, biome.id === "desert" ? C.clay : C.basalt, 0, 0.008, 0, 0.006, 0.016);
          cylinder(edge, biome.id === "desert" ? C.dune : C.moss, 0, 0.016, 0, 0.0062, 0.002);
          ball(back, colors.rock, 0, 0.004, 0, 0.005, 0.8, true);
        } else if (["river", "waterfalls", "terraces"].includes(biome.id)) {
          liquidRibbon(world.number, edge, [[0, 0.001, -0.008], [0.002, 0.001, 0], [0, 0.001, 0.008], [0, 1.003 - top, 0.014]], 0.003, C.water);
          tree(back, "broad", 0.4, seed);
        } else {
          const kind = biome.id === "autumn" ? "autumn" : biome.id === "orchard" ? "orchard" : ["tropical", "lagoon"].includes(biome.id) ? "palm" : biome.id === "mangrove" ? "mangrove" : "broad";
          tree(edge, kind, 0.5, seed); tree(back, kind, 0.38, seed + 1);
        }
        continue;
      }

      if (biome.id === "volcanic") {
        const h = (biome.variant === 2 ? 0.049 : 0.041) * small;
        const r = 0.027 * small; const crater = 0.0095 * small;
        const volcano = new THREE.CylinderGeometry(crater, r, h, 11, 1, true);
        piece(volcano, C.basalt, base, [0, h / 2, 0], [1, 1, 1]); volcano.dispose();
        const rim = new THREE.CylinderGeometry(crater, crater * 0.55, 0.006 * small, 11, 1, true);
        piece(rim, C.crater, base, [0, h - 0.003 * small, 0], [1, 1, 1]); rim.dispose();
        piece(rimGeometry, C.basaltLight, base, [0, h, 0], [crater, crater, crater], [Math.PI / 2, 0, 0]);
        const lava = ellipse(0, 0, 1, 1, 20);
        const positions: number[] = [], uv: number[] = [];
        for (let i = 0; i < lava.length; i++) for (const p of [[0, 0], lava[(i + 1) % lava.length], lava[i]]) {
          const v = new THREE.Vector3(p[0] * crater * 0.7, h - 0.004 * small, p[1] * crater * 0.7).applyMatrix4(base); positions.push(v.x, v.y, v.z); uv.push(p[0] * 2, p[1] * 2);
        }
        const lavaGeometry = new THREE.BufferGeometry(); lavaGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); lavaGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); animateGeometry(lavaGeometry, C.lava, world.number, true);
        // Basalt fans and their lava channel continue from the crater to the coast.
        polygon(world.number, [[island.x + 56, island.y + 34], [island.x + 39, island.y + 67], [island.x + 76, island.y + 83], [island.x + 95, island.y + 66]], top + 0.001, C.basalt);
        liquidRibbon(world.number, base, [[0.002 * small, h + 0.0005, crater * 0.8], [0.004 * small, h * 0.68, r * 0.49], [0.001 * small, h * 0.32, r * 0.8], [0.006 * small, 0.0015, r * 0.99], [0.003, 0.0015, 0.026], [0.003, 1.003 - top, 0.032]], 0.0035 * small, C.lava, true);
        const smoke = new THREE.Vector3(0, h + 0.003, 0).applyMatrix4(base); smokeSources.push({ position: { x: smoke.x, y: smoke.y, z: smoke.z }, strength: relief?.role === "landmark" ? 1 : 0.5 });
        for (let i = 0; i < 5; i++) { const a = i * 1.3; ball(base, i % 2 ? C.basaltLight : C.basalt, Math.cos(a) * r * 1.12, 0.003 * small, Math.sin(a) * r * 0.9, 0.006 * small, 0.8, true); }
        if (biome.variant === 2) for (let i = 0; i < 3; i++) cone(base, C.basalt, 0.024 * small, (0.011 + i * 0.002) * small, (i - 1) * 0.008 * small, 0.004 * small, (0.022 + i * 0.004) * small, true);
      } else if (biome.id === "glacier" || biome.id === "tundra") {
        const ice = biome.id === "glacier";
        for (let i = 0; i < (relief?.role === "landmark" ? 5 : 3); i++) {
          const x = (i - 2) * 0.012 * small; const z = -0.007 - Math.sin(i * 2) * 0.006;
          const h = (0.028 + random(seed + i) * 0.035) * small;
          cone(base, ice ? C.blueIce : C.slate, x, h / 2, z, 0.018 * small, h, true);
          cone(base, i % 2 ? C.snow : C.ice, x, h * 0.8, z, 0.009 * small, h * 0.44, true);
        }
        if (ice) {
          for (let i = 0; i < 4; i++) {
            box(base, i % 2 ? C.ice : C.blueIce, 0, (0.009 - i * 0.004) * small, (0.011 + i * 0.010) * small, (0.027 - i * 0.004) * small, 0.011 * small, 0.012 * small, [0.16, 0.08 * i, 0]);
            box(base, C.snow, 0, (0.015 - i * 0.004) * small, (0.010 + i * 0.010) * small, (0.025 - i * 0.004) * small, 0.002 * small, 0.008 * small, [0.16, 0.08 * i, 0]);
          }
          liquidRibbon(world.number, base, [[0.003, 0.005 * small, 0.018 * small], [0.001, -0.003 * small, 0.033 * small], [0.001, 1.003 - top, 0.042]], 0.003 * small, C.blueIce);
          if (quiz) for (let i = 0; i < (relief?.role === "landmark" ? 3 : 1); i++) {
            const at = basisAt(world.number, island.x + 65 + i * 34, island.y + 86 + i % 2 * 10, 1.001);
            habitatMotion = { anchor: new THREE.Vector3().setFromMatrixPosition(at), height: 0.02, phase: seed + i * 1.7, kind: 2 };
            cone(at, i % 2 ? C.ice : C.snow, 0, 0.004, 0, 0.009 - i * 0.001, 0.019 - i * 0.002, true);
            habitatMotion = null;
          }
        } else {
          grove(world.number, island, top + 0.001, "pine", quiz ? 7 : 4, seed, true, small);
          ball(base, C.snow, 0.02 * small, 0.003, 0.018, 0.012 * small, 0.4, true);
        }
      } else if (biome.id === "desert") {
        for (let i = 0; i < (quiz ? 3 : 2); i++) {
          const h = (0.027 + i * 0.010) * small; const x = (i - 1) * 0.018 * small; const z = -i * 0.007 * small;
          for (let layer = 0; layer < 3; layer++) cylinder(base, [C.redRock, C.clay, C.orange][layer], x, h * (layer + 0.5) / 3, z, (0.017 - layer * 0.0024) * small, h / 3);
          cylinder(base, C.dune, x, h + 0.0008, z, 0.0123 * small, 0.002 * small);
        }
        ball(base, C.sand, -0.014 * small, 0.003, 0.022 * small, 0.018 * small, 0.34);
        const cactus = basisAt(world.number, island.x + (quiz ? 96 : -30), island.y + 30, top + 0.001);
        cylinder(cactus, C.pine, 0, 0.009, 0, 0.0023, 0.018);
        box(cactus, C.pine, 0.004, 0.009, 0, 0.009, 0.0025, 0.003);
        cylinder(cactus, C.pine, 0.008, 0.012, 0, 0.0017, 0.008);
        if (biome.variant === 2 && quiz) liquidPool(world.number, ellipse(island.x + 53, island.y + 39, 20, 10), top + 0.001, C.water);
      } else if (biome.id === "river" || biome.id === "waterfalls" || biome.id === "terraces") {
        const high = biome.id === "waterfalls" || biome.id === "terraces";
        const riverBase = basisAt(world.number, island.x + (quiz ? 54 : 30), island.y, top + 0.0008);
        if (high) for (let i = 0; i < 3; i++) {
          const h = (0.022 - i * 0.007) * small;
          box(riverBase, i % 2 ? colors.rock : C.moss, 0, h / 2, (-0.018 + i * 0.009) * small, (0.048 - i * 0.004) * small, h, 0.018 * small);
          box(riverBase, i % 2 ? C.lime : C.grass, 0, h + 0.0005, (-0.019 + i * 0.009) * small, (0.049 - i * 0.004) * small, 0.002, 0.016 * small);
        }
        const points: Point3[] = high
          ? [[-0.005 * small, 0.0245 * small, -0.025 * small], [0.003 * small, 0.0245 * small, -0.0087 * small], [0.003 * small, 0.0175 * small, -0.0084 * small], [-0.003 * small, 0.0175 * small, 0.0003 * small], [-0.003 * small, 0.0105 * small, 0.0006 * small], [0.003 * small, 0.0105 * small, 0.0093 * small], [0.003 * small, 0.002, 0.0096 * small], [-0.003 * small, 0.002, 0.016 * small], [0.002 * small, 0.002, 0.024], [0.002 * small, 1.003 - top, 0.030]]
          : [[0.005 * small, 0.001, -0.024 * small], [-0.006 * small, 0.001, -0.013 * small], [0.006 * small, 0.001, -0.002 * small], [-0.006 * small, 0.001, 0.010 * small], [0.003 * small, 0.001, 0.022], [0.003 * small, 1.003 - top, 0.031]];
        liquidRibbon(world.number, riverBase, points, (high ? 0.007 : 0.006) * small, C.water);
        if (biome.variant === 2 && biome.id === "river") liquidRibbon(world.number, riverBase, [[0.019, 0.001, -0.014], [0.012, 0.001, -0.006], [0.006, 0.001, -0.002]], 0.0035 * small, C.waterDeep);
        for (let i = 0; i < 3; i++) ball(riverBase, C.foam, 0.003 * small, 1.004 - top, 0.029 + i * 0.002, 0.0035 * small, 0.25);
        const spray = new THREE.Vector3(0.003 * small, 1.005 - top, 0.030).applyMatrix4(riverBase);
        mistSources.push({ position: { x: spray.x, y: spray.y, z: spray.z }, strength: high ? small * 0.8 : 0.25 });
        // A fan-shaped sand bar and branching outflow link the river to its sea.
        polygon(world.number, [[island.x + 55, island.y + 86], [island.x + 33, island.y + 108], [island.x + 70, island.y + 120], [island.x + 82, island.y + 99]], 1.0024, C.sand);
        liquidRibbon(world.number, riverBase, [[0.003 * small, 1.0035 - top, 0.030], [-0.005, 1.0035 - top, 0.038]], 0.003, C.water);
        liquidRibbon(world.number, riverBase, [[0.003 * small, 1.0035 - top, 0.030], [0.009, 1.0035 - top, 0.036]], 0.0027, C.water);
        for (const sign of [-1, 1]) {
          const t = basisAt(world.number, island.x + (quiz ? 53 : 25) + sign * (quiz ? 56 : 25), island.y - 31, top + 0.001);
          tree(t, biome.variant === 2 ? "pine" : "broad", 0.7 * small, seed + sign);
        }
      } else if (biome.id === "basalt") {
        for (let i = 0; i < (quiz ? 9 : 5); i++) {
          const x = (i % 3 - 1) * 0.012 * small; const z = (Math.floor(i / 3) - 1) * 0.011 * small;
          const h = (0.016 + random(seed + i) * 0.029) * small;
          cylinder(base, i % 2 ? C.basalt : C.basaltLight, x, h / 2, z, 0.007 * small, h);
          cylinder(base, C.moss, x, h + 0.001, z, 0.0071 * small, 0.002);
        }
        const archBase = basisAt(world.number, island.x + 79, island.y + 21, top + 0.001);
        for (const sign of [-1, 1]) box(archBase, C.rock, sign * 0.012 * small, 0.013 * small, 0, 0.009 * small, 0.026 * small, 0.010 * small);
        const arch = new THREE.TorusGeometry(0.012 * small, 0.0048 * small, 5, 9, Math.PI);
        piece(arch, C.rock, archBase, [0, 0.022 * small, 0], [1, 1, 1]); arch.dispose();
      } else if (biome.id === "lagoon" || biome.id === "tropical" || biome.id === "mangrove" || biome.id === "alpine") {
        if (biome.id === "alpine") {
          for (let i = 0; i < 3; i++) {
            const ridge = basisAt(world.number, island.x + (i - 1) * 35 + (quiz ? 48 : 15), island.y - 43, top);
            const h = (0.028 + i % 2 * 0.018) * small;
            cone(ridge, C.slate, 0, h / 2, 0, 0.016 * small, h, true);
            cone(ridge, C.snow, 0, h * 0.85, 0, 0.0065 * small, h * 0.36, true);
          }
          for (const x of [quiz ? 8 : -38, quiz ? 111 : 40]) tree(basisAt(world.number, island.x + x, island.y - 29, top), "pine", 0.65, seed + x);
        } else if (biome.id === "tropical") {
          for (let i = 0; i < 2; i++) {
            const stackBase = basisAt(world.number, island.x + 80 + i * 27, island.y - 34, top);
            const h = (0.024 + i * 0.019) * small;
            cylinder(stackBase, C.cream, 0, h / 2, 0, 0.010 * small, h);
            ball(stackBase, C.grass, 0, h + 0.001, 0, 0.011 * small, 0.32, true);
          }
          tree(base, "palm", 1.1 * small, seed);
          tree(basisAt(world.number, island.x + (quiz ? 29 : -32), island.y - 37, top), "palm", 0.75 * small, seed + 1);
          for (let i = 0; i < 3; i++) ball(base, C.coral, (i - 1) * 0.008, 0.002, 0.015, 0.003, 0.5, true);
        } else {
          const palms = biome.id === "lagoon" ? [[22, -44], [101, -36], [116, 3]] : [[26, -40], [99, -31], [107, 24], [39, 37]];
          for (const [x, y] of palms) {
            if (clearForControls(island, x, y)) tree(basisAt(world.number, island.x + x, island.y + y, top), biome.id === "mangrove" ? "mangrove" : "palm", 0.62 + random(seed + x) * 0.24, seed + x);
          }
          for (let i = 0; i < 5; i++) {
            const at = basisAt(world.number, island.x + 70 + i * 9, island.y + 60, 1.004);
            ball(at, i % 2 ? C.coral : C.purple, 0, 0.002, 0, 0.0035, 1.1, true);
          }
        }
      } else {
        const kind = biome.id === "autumn" ? "autumn" : biome.id === "orchard" ? "orchard" : biome.id === "woodland" && biome.variant === 2 ? "redwood" : "broad";
        grove(world.number, island, top + 0.001, kind, quiz ? Math.round((biome.id === "rainforest" ? 25 : 18) * (relief?.vegetationDensity ?? 1)) : 9, seed, !quiz, 0.55 + small * 0.45);
        if (biome.id === "rainforest") {
          ball(base, C.moss, 0.010, 0.005, -0.010, 0.022 * small, 0.5, true);
          tree(base, "broad", 1.4 * small, seed);
          for (let i = 0; i < 3; i++) tree(basisAt(world.number, island.x + 17 + i * 30, island.y - 43, top + 0.002), "palm", 0.8 * small, seed + i);
        } else if (biome.id === "woodland" && biome.variant === 1) {
          for (let i = 0; i < 4; i++) {
            const x = (i - 1) * 0.010; const z = 0.013 + Math.sin(i) * 0.004;
            cylinder(base, C.cream, x, 0.005, z, 0.0016, 0.011);
            piece(capGeometry, i % 2 ? C.coral : C.purple, base, [x, 0.011, z], [0.006, 0.005, 0.006]);
            ball(base, C.cream, x + 0.002, 0.015, z, 0.0015);
          }
        } else if (biome.id === "orchard") {
          for (let row = 0; row < 3; row++) box(base, row % 2 ? C.grass : C.moss, 0, 0.001 + row * 0.001, (row - 1) * 0.009, 0.035 * small, 0.003, 0.004);
        }
        for (let i = 0; i < 4; i++) ball(base, i % 2 ? C.rock : C.moss, 0.017 + i * 0.002, 0.003, -0.005 + i * 0.004, 0.004, 0.7, true);
      }
    }
  }

  // Irregular polar continents are real geometry and share the voyage planner's
  // conservative ice envelopes. Their bergs stay inside those same exclusions.
  for (const [capIndex, cap] of GLOBE_POLAR_CAPS.entries()) {
    const polarFrame = { center: cap.center, east: { x: 1, y: 0, z: 0 }, north: { x: 0, y: 0, z: capIndex === 0 ? -1 : 1 } };
    const count = 96;
    const coastAngles = Array.from({ length: count }, (_, i) => {
      const a = i * Math.PI * 2 / count;
      return 0.232 + 0.019 * Math.sin(a * 3 + capIndex) + 0.012 * Math.cos(a * 7) + 0.009 * Math.sin(a * 11 + 1);
    });
    const polarPoint = (index: number, scale: number, height: number) => {
      const theta = index / count * Math.PI * 2;
      const angle = coastAngles[index % count] * scale;
      return tangentPointToGlobe(polarFrame, Math.cos(theta) * angle, Math.sin(theta) * angle, height);
    };
    const polarBand = (inner: number, outer: number, innerHeight: number, outerHeight: number, color: number) => {
      const vertices: number[] = [];
      const push = (p: Vec3) => vertices.push(p.x, p.y, p.z);
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const a = polarPoint(i, inner, innerHeight), b = polarPoint(i, outer, outerHeight), c = polarPoint(j, outer, outerHeight), d = polarPoint(j, inner, innerHeight);
        push(a); push(b); push(c); push(a); push(c); push(d);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals(); batch(geometry, color); geometry.dispose();
    };
    polarBand(0, 0.48, 1.032, 1.023, C.snow);
    polarBand(0.48, 0.94, 1.023, 1.014, C.snow);
    polarBand(0.94, 1.01, 1.014, 1.007, C.ice);
    polarBand(1.01, 1.055, 1.007, 1.0017, C.blueIce);
    const polarBasis = (at: Vec3) => {
      const up = vector(at).normalize();
      const east = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
      return new THREE.Matrix4().makeBasis(east, up, east.clone().cross(up)).setPosition(vector(at));
    };
    for (let i = 0; i < 15; i++) {
      const theta = i * Math.PI * 2 / 15 + capIndex * 0.25;
      const angle = 0.277 + random(i + capIndex * 20) * 0.005;
      const at = tangentPointToGlobe(polarFrame, Math.cos(theta) * angle, Math.sin(theta) * angle, 1.001);
      const base = polarBasis(at); const size = 0.0045 + random(i + 8) * 0.006;
      habitatMotion = { anchor: new THREE.Vector3().setFromMatrixPosition(base), height: 0.025, phase: i * 1.7 + capIndex, kind: 2 };
      cone(base, i % 2 ? C.ice : C.blueIce, 0, 0.008, 0, size, 0.023, true);
      cone(base, C.snow, 0, 0.016, 0, size * 0.6, 0.009, true);
      habitatMotion = null;
    }
    for (let i = 0; i < 9; i++) {
      const theta = i * 2.399963 + capIndex;
      const angle = 0.08 + Math.sqrt((i + 1) / 9) * 0.10;
      const at = tangentPointToGlobe(polarFrame, Math.cos(theta) * angle, Math.sin(theta) * angle, 1.02);
      const base = polarBasis(at);
      cone(base, i % 2 ? C.ice : C.snow, 0, 0.009, 0, 0.014, 0.025, true);
      box(base, C.blueIce, 0.014, 0.001, 0, 0.002, 0.0015, 0.029, [0, theta, 0]);
    }
  }

  for (const [color, pieces] of batches) {
    const merged = mergeGeometries(pieces, false); disposePieces(pieces);
    if (!merged) continue;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    ownedMaterials.add(material);
    scenery.add(new THREE.Mesh(own(merged), material));
  }
  batches.clear();
  const motionTime = { value: 0 };
  const motionDeclaration = /* glsl */ `
    attribute vec3 motionAnchor;
    attribute vec3 motionParams;
    uniform float sceneryMotionTime;
    ${TREE_SWAY_GLSL}
    vec3 moveHabitat(vec3 point) {
      vec3 up = normalize(motionAnchor);
      vec3 east = normalize(cross(abs(up.y) > 0.98 ? vec3(0.,0.,1.) : vec3(0.,1.,0.), up));
      vec3 north = cross(up, east);
      float phase = motionParams.y;
      if (motionParams.z < 1.5) {
        return swayTree(point, motionAnchor, motionParams.x, phase, sceneryMotionTime);
      }
      return point + east * sin(sceneryMotionTime * 0.10 + phase) * 0.0012
        + north * cos(sceneryMotionTime * 0.08 + phase) * 0.0008
        + up * sin(sceneryMotionTime * 0.78 + phase) * 0.00125;
    }
  `;
  const patchMotion = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.sceneryMotionTime = motionTime;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${motionDeclaration}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = moveHabitat(transformed);");
  };
  for (const [color, pieces] of habitatBatches) {
    const geometry = mergeGeometries(pieces, false); disposePieces(pieces);
    if (!geometry) continue;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    material.onBeforeCompile = patchMotion;
    material.customProgramCacheKey = () => "habitat-wind-and-ice-v2";
    const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depthMaterial.onBeforeCompile = patchMotion;
    depthMaterial.customProgramCacheKey = () => "habitat-wind-and-ice-depth-v2";
    ownedMaterials.add(material); ownedMaterials.add(depthMaterial);
    const mesh = new THREE.Mesh(own(geometry), material);
    mesh.name = "Anchored swaying trees and floating ice";
    mesh.customDepthMaterial = depthMaterial;
    scenery.add(mesh);
  }
  habitatBatches.clear();

  const shoreGeometry = new THREE.BufferGeometry();
  shoreGeometry.setAttribute("position", new THREE.Float32BufferAttribute(shorePositions, 3));
  shoreGeometry.setAttribute("shoreDrift", new THREE.Float32BufferAttribute(shoreDrifts, 3));
  shoreGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(shoreUvs, 2));
  shoreGeometry.setAttribute("shorePhase", new THREE.Float32BufferAttribute(shorePhases, 1));
  const shoreSun = { value: new THREE.Vector3(1, 1, 1).normalize() };
  const shoreMaterial = new THREE.ShaderMaterial({
    uniforms: { sceneryMotionTime: motionTime, sunLocal: shoreSun },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 shoreDrift;
      attribute float shorePhase;
      uniform float sceneryMotionTime;
      uniform vec3 sunLocal;
      varying vec2 waveUv;
      varying float waveAlpha;
      varying float waveDaylight;
      void main() {
        float progress = fract(sceneryMotionTime * 0.155 + shorePhase);
        vec3 point = normalize(position + shoreDrift * (1.0 - progress)) * (1.0026 + sin(progress * 3.14159) * 0.00025);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        waveUv = uv;
        waveAlpha = sin(progress * 3.14159) * 0.61;
        waveDaylight = smoothstep(-0.16, 0.7, dot(normalize(point), sunLocal));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 waveUv;
      varying float waveAlpha;
      varying float waveDaylight;
      void main() {
        float edge = smoothstep(0.0, 0.24, waveUv.y) * (1.0 - smoothstep(0.65, 1.0, waveUv.y));
        float breaks = 0.18 + 0.82 * smoothstep(-0.25, 0.50, sin(waveUv.x * 43.0 + sin(waveUv.x * 17.0) * 1.4));
        float alpha = waveAlpha * breaks * edge;
        if (alpha < 0.006) discard;
        vec3 color = mix(vec3(0.11, 0.24, 0.34), vec3(0.80, 0.98, 0.96), waveDaylight);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  ownedMaterials.add(shoreMaterial);
  const shore = new THREE.Mesh(own(shoreGeometry), shoreMaterial);
  shore.name = "Rolling shoreline wave and foam bands";
  shore.renderOrder = 2;
  shore.frustumCulled = false;
  scenery.add(shore);

  const flowMaterials: THREE.ShaderMaterial[] = [];
  movingBatches.forEach((pieces, index) => {
    const geometry = mergeGeometries(pieces, false); disposePieces(pieces);
    if (!geometry) return;
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, activeWorld: { value: 0 }, motionStrength: { value: 0 }, lava: { value: index }, sunDirection: { value: new THREE.Vector3(1, 1, 1).normalize() } },
      vertexShader: "attribute vec3 color; attribute float region; varying vec3 vColor; varying vec2 vUv; varying float vRegion; varying vec3 vSurface; void main(){vColor=color; vUv=uv; vRegion=region; vSurface=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform float time; uniform float activeWorld; uniform float motionStrength; uniform float lava; uniform vec3 sunDirection; varying vec3 vSurface; varying vec3 vColor; varying vec2 vUv; varying float vRegion; void main(){ float enabled=1.0-step(0.5,abs(vRegion-activeWorld)); float clock=time*enabled*motionStrength; float wave=sin(vUv.y*10.0-clock*2.2+sin(vUv.x*5.0)*0.6); float glint=smoothstep(0.80,0.99,wave); float edges=smoothstep(0.25,0.48,abs(vUv.x-0.5)); vec3 bright=mix(vec3(0.72,1.0,0.94),vec3(1.0,0.62,0.15),lava); vec3 color=mix(vColor,bright,glint*mix(0.27,0.48,lava)+edges*0.035); float daylight=mix(0.14,1.0,smoothstep(-0.16,0.7,dot(normalize(vSurface),sunDirection))); color*=mix(daylight,1.0,lava); gl_FragColor=vec4(color,1.0); \n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
    });
    ownedMaterials.add(material); flowMaterials.push(material);
    scenery.add(new THREE.Mesh(own(geometry), material));
  });
  const numbersById = new Map(WORLD_DEFINITIONS.map(world => [world.id, world.number]));
  let disposed = false;
  return {
    smokeSources, mistSources,
    update(timeSeconds, activeDestinationId, zoom, sunDirection) {
      if (disposed) return;
      motionTime.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      if (sunDirection) shoreSun.value.copy(sunDirection);
      const activeWorld = numbersById.get(activeDestinationId) ?? 0;
      for (const material of flowMaterials) {
        if (sunDirection) material.uniforms.sunDirection.value.copy(sunDirection);
        material.uniforms.time.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
        material.uniforms.activeWorld.value = activeWorld;
        material.uniforms.motionStrength.value = Math.max(0, Math.min(1, zoom * 2));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; globe.remove(scenery);
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      scenery.clear(); ownedGeometries.clear(); ownedMaterials.clear();
    },
  };
}
