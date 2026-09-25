import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WORLD_DEFINITIONS } from "./world-data";
import { getWorldMapLayout } from "./map-layouts";
import { createGlobeBiomes } from "./globe-biomes";
import { createGlobeWeather } from "./globe-weather";
import { createSceneryClock } from "./scenery-clock";
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
  animateScenery?: boolean;
}>;
export type GlobeScene = Readonly<{
  render: (frame: GlobeSceneFrame) => void; resize: () => void; dispose: () => void;
  setSceneryMotion: (enabled: boolean) => void;
}>;

const vector = (value: Vec3) => new THREE.Vector3(value.x, value.y, value.z);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** This scene owns GPU resources and a pausable scenery clock. Navigation,
 * question state, and progress remain outside the renderer. */
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
  const seaTime = { value: 0 };
  const oceanMaterial = keepMaterial(new THREE.MeshStandardMaterial({
    color: 0x087fa3, roughness: 0.4, metalness: 0.06,
  }));
  oceanMaterial.onBeforeCompile = shader => {
    shader.uniforms.uSeaTime = seaTime;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSeaPosition;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSeaPosition = position;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vSeaPosition; uniform float uSeaTime;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float swell = sin(dot(vSeaPosition,vec3(74.,19.,-31.))+uSeaTime*.48);
        float ripple = sin(dot(vSeaPosition,vec3(-46.,83.,57.))-uSeaTime*.65);
        float glint = pow(max(0.,swell*ripple),12.);
        diffuseColor.rgb *= 1. + .055*swell;
        diffuseColor.rgb += vec3(.012,.025,.035)*glint;
      `);
  };
  const ocean = new THREE.Mesh(sphere, oceanMaterial);
  globe.add(ocean);

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
  const mapAt = (worldNumber: number, x: number, y: number, radius: number, width = 1200, height = 740) => mapPointToGlobe(worldNumber, x / width * 100, y / height * 100, false, radius);
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
  const biomes = createGlobeBiomes(globe);
  const weather = createGlobeWeather(globe, scene, camera, biomes.smokeSources);
  for (const world of WORLD_DEFINITIONS) {
    const authored = getWorldMapLayout(world.number, world.stopIds.length);
    const layout = authored.desktop;
    const topRadius = authored.landscape === "cliffs" ? 1.023 : 1.013;
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
  let sceneryTime = 0;
  let lastPaintTime = 0;
  let sceneryEnabled = options.animateScenery ?? true;
  let onScreen = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const updateScenery = () => {
    if (!frame) return;
    seaTime.value = sceneryTime;
    biomes.update(sceneryTime, frame.activeDestinationId, frame.zoom);
    weather.update(sceneryTime, frame.focus, frame.zoom, frame.activeDestinationId);
  };
  const sceneryClock = createSceneryClock({
    request: callback => window.requestAnimationFrame(callback),
    cancel: id => window.cancelAnimationFrame(id), now: () => performance.now(),
    onFrame: seconds => {
      sceneryTime = seconds;
      // Camera travel already paints at display cadence. Idle scenery needs only
      // 30fps and never reprojects HTML buttons whose positions have not changed.
      if (frame && performance.now() - lastPaintTime > 25) {
        updateScenery(); renderer.render(scene, camera); lastPaintTime = performance.now();
      }
    },
  });
  const reconcileScenery = () => sceneryClock.setRunning(!disposed && !unavailable && !!frame && sceneryEnabled && !reducedMotion.matches && !document.hidden && onScreen);
  const visibilityChanged = () => reconcileScenery();
  document.addEventListener("visibilitychange", visibilityChanged);
  reducedMotion.addEventListener("change", visibilityChanged);
  const intersectionObserver = new IntersectionObserver(entries => {
    onScreen = entries.some(entry => entry.isIntersecting);
    reconcileScenery();
  });
  intersectionObserver.observe(container);
  const spriteMaterial = keepMaterial(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08, depthTest: false, depthWrite: false, toneMapped: false }));
  const animal = new THREE.Sprite(spriteMaterial);
  animal.center.set(0.5, 0);
  animal.renderOrder = 8;
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
      const islandRadius = worldLandscape(next.activeDestinationId) === "cliffs" ? 1.027 : 1.018;
      // The player is a map pawn perched over the stop/road. This deliberate
      // billboard layer stays readable beside tall mountains and tree canopies.
      animal.position.copy(foot).multiplyScalar(next.boatPosition ? 1.034 : islandRadius + (next.avatarHop ?? 0));
      animal.scale.setScalar(next.boatPosition ? 0.068 : 0.038);
      const avatarProjection = project(animal.position);
      // Keep its feet just above the native 44/48px stop on every screen size,
      // rather than floating higher as the camera approaches the globe.
      const markerClearance = (window.innerWidth <= 620 ? 22 : 24) + 3;
      animal.center.set(0.5, next.boatPosition ? 0.08 : -markerClearance / (animal.scale.y * avatarProjection.scale));
      animal.visible = (!!next.boatPosition || zoom > 0.72) && avatarProjection.visible;
    }
    updateScenery();
    globe.updateMatrixWorld(true);
    renderer.render(scene, camera);
    lastPaintTime = performance.now();
    reconcileScenery();
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
  const contextLost = (event: Event) => { event.preventDefault(); if (!disposed && !unavailable) { unavailable = true; sceneryClock.setRunning(false); options.onUnavailable(); } };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  resize();
  return {
    render: draw, resize,
    setSceneryMotion(enabled) { sceneryEnabled = enabled; reconcileScenery(); },
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect(); intersectionObserver.disconnect();
      sceneryClock.dispose();
      document.removeEventListener("visibilitychange", visibilityChanged);
      reducedMotion.removeEventListener("change", visibilityChanged);
      weather.dispose(); biomes.dispose();
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
