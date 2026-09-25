import * as THREE from "three";
import type { Vec3 } from "./globe-geometry";

export type GlobeSmokeSource = Readonly<{ position: Vec3; strength: number }>;
export type GlobeWeather = Readonly<{
  update: (timeSeconds: number, focus: Vec3, zoom: number, activeDestinationId: string, sunDirection?: THREE.Vector3) => void;
  dispose: () => void;
}>;

const CLOUD_BANK_COUNT = 38;
const SMOKE_PUFFS_PER_SOURCE = 11;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function billboardGeometry(count: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
  ], 3));
  geometry.instanceCount = count;
  return geometry;
}

/** Smoothly union the billows once. A continuous surface avoids the bright
 * intersection rings produced by overlapping translucent ellipsoids. */
function cloudSurface(formation: number): THREE.BufferGeometry {
  const formations = [[
    [-0.074, 0, 0.004, 0.044, 0.018, 0.036],
    [-0.039, 0.010, -0.015, 0.053, 0.031, 0.043],
    [0.011, 0.015, 0.001, 0.058, 0.039, 0.049],
    [0.062, 0.004, 0.006, 0.046, 0.026, 0.035],
    [0.024, -0.003, 0.036, 0.061, 0.017, 0.030],
    [-0.035, -0.004, 0.032, 0.043, 0.015, 0.025],
    [-0.015, 0.035, -0.006, 0.036, 0.042, 0.034],
  ], [
    [-0.087, 0.001, -0.007, 0.062, 0.013, 0.037],
    [-0.023, 0.005, 0.001, 0.071, 0.019, 0.036],
    [0.043, 0.002, 0.009, 0.066, 0.015, 0.031],
    [0.102, -0.001, 0.014, 0.039, 0.010, 0.024],
  ], [
    [-0.104, 0, -0.035, 0.064, 0.009, 0.019],
    [-0.055, 0.001, -0.017, 0.057, 0.013, 0.025],
    [0.002, 0.001, 0.012, 0.060, 0.010, 0.023],
    [0.058, 0.002, 0.038, 0.059, 0.009, 0.018],
    [0.114, 0, 0.050, 0.045, 0.007, 0.013],
  ]];
  const lobes = formations[formation];
  const blend = formation === 2 ? 0.0035 : 0.006;
  const low = [0, 1, 2].map(axis => Math.min(...lobes.map(lobe => lobe[axis] - lobe[axis + 3])) - 0.008);
  const high = [0, 1, 2].map(axis => Math.max(...lobes.map(lobe => lobe[axis] + lobe[axis + 3])) + 0.008);
  const field = (x: number, y: number, z: number) => {
    let result = 1;
    for (const lobe of lobes) {
      const value = (Math.hypot((x - lobe[0]) / lobe[3], (y - lobe[1]) / lobe[4], (z - lobe[2]) / lobe[5]) - 1) * Math.min(lobe[3], lobe[4], lobe[5]);
      const h = THREE.MathUtils.clamp(0.5 + 0.5 * (value - result) / blend, 0, 1);
      result = value * (1 - h) + result * h - blend * h * (1 - h);
    }
    return result;
  };
  const positions: number[] = [], normals: number[] = [];
  type Point = readonly [number, number, number];
  const gradient = (p: Point): Point => {
    const e = 0.0001;
    const x = field(p[0] + e, p[1], p[2]) - field(p[0] - e, p[1], p[2]);
    const y = field(p[0], p[1] + e, p[2]) - field(p[0], p[1] - e, p[2]);
    const z = field(p[0], p[1], p[2] + e) - field(p[0], p[1], p[2] - e);
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };
  const triangle = (a: Point, b: Point, c: Point) => {
    const na = gradient(a), nb = gradient(b), nc = gradient(c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    if ((uy * vz - uz * vy) * na[0] + (uz * vx - ux * vz) * na[1] + (ux * vy - uy * vx) * na[2] < 0) {
      positions.push(...a, ...c, ...b); normals.push(...na, ...nc, ...nb);
    } else { positions.push(...a, ...b, ...c); normals.push(...na, ...nb, ...nc); }
  };
  const nx = 13, ny = 6, nz = 8;
  const points: Point[] = [], values: number[] = [];
  const at = (x: number, y: number, z: number) => (x * (ny + 1) + y) * (nz + 1) + z;
  for (let x = 0; x <= nx; x += 1) for (let y = 0; y <= ny; y += 1) for (let z = 0; z <= nz; z += 1) {
    const p: Point = [low[0] + x / nx * (high[0] - low[0]), low[1] + y / ny * (high[1] - low[1]), low[2] + z / nz * (high[2] - low[2])];
    points.push(p); values.push(field(...p));
  }
  const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  for (let x = 0; x < nx; x += 1) for (let y = 0; y < ny; y += 1) for (let z = 0; z < nz; z += 1) {
    const cube = [at(x,y,z), at(x+1,y,z), at(x+1,y+1,z), at(x,y+1,z), at(x,y,z+1), at(x+1,y,z+1), at(x+1,y+1,z+1), at(x,y+1,z+1)];
    for (const tetrahedron of tetrahedra) {
      const inside = tetrahedron.map(corner => cube[corner]).filter(index => values[index] < 0);
      const outside = tetrahedron.map(corner => cube[corner]).filter(index => values[index] >= 0);
      const edge = (a: number, b: number): Point => {
        const t = values[a] / (values[a] - values[b]);
        return [points[a][0] + (points[b][0] - points[a][0]) * t, points[a][1] + (points[b][1] - points[a][1]) * t, points[a][2] + (points[b][2] - points[a][2]) * t];
      };
      if (inside.length === 1) triangle(edge(inside[0], outside[0]), edge(inside[0], outside[1]), edge(inside[0], outside[2]));
      else if (inside.length === 3) triangle(edge(outside[0], inside[0]), edge(outside[0], inside[1]), edge(outside[0], inside[2]));
      else if (inside.length === 2) {
        const ac = edge(inside[0], outside[0]), ad = edge(inside[0], outside[1]);
        const bc = edge(inside[1], outside[0]), bd = edge(inside[1], outside[1]);
        triangle(ac, ad, bc); triangle(ad, bd, bc);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

const cloudVertexShader = /* glsl */ `
  attribute vec3 bankCenter;
  attribute vec3 puffOffset;
  attribute vec3 cloudPuffSize;
  attribute float bankSeed;
  attribute float bankFormation;
  uniform float weatherTime;
  uniform vec3 focusedDirection;
  uniform float focusedAmount;
  varying vec3 cloudNormal;
  varying vec3 cloudViewNormal;
  varying vec3 cloudViewDirection;
  varying float cloudDaylight;
  varying float cloudOpacity;
  varying float cloudLayer;
  uniform vec3 sunLocal;
  void main() {
    // A smooth continuous billow follows the planet's tangent, so banks curve
    // around the horizon and keep their volume while the globe rotates.
    float velocity = bankFormation < 0.5 ? 0.0055 : bankFormation < 1.5 ? -0.0038 : 0.0105;
    float angle = weatherTime * (velocity + bankSeed * 0.0012);
    float s = sin(angle), c = cos(angle);
    vec3 direction = normalize(vec3(
      bankCenter.x * c - bankCenter.z * s,
      bankCenter.y + sin(weatherTime * 0.035 + bankSeed * 19.0) * 0.005,
      bankCenter.x * s + bankCenter.z * c
    ));
    vec3 east = normalize(cross(abs(direction.y) > 0.98 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0), direction));
    vec3 north = cross(direction, east);
    float orientation = bankSeed * 4.0;
    vec3 along = east * cos(orientation) + north * sin(orientation);
    vec3 across = -east * sin(orientation) + north * cos(orientation);
    float breath = sin(weatherTime * 0.21 + bankSeed * 17.0 + puffOffset.x * 12.0);
    vec3 center = direction * (1.075 + bankFormation * 0.033 + puffOffset.y + breath * 0.0015)
      + along * (puffOffset.x + sin(weatherTime * 0.15 + bankSeed * 9.0) * 0.004)
      + across * puffOffset.z;
    float shear = sin(weatherTime * (0.10 + bankFormation * 0.03) + position.x * 21.0 + bankSeed * 11.0);
    vec3 localPoint = center + along * position.x * cloudPuffSize.x * (1.0 + breath * 0.065)
      + direction * (position.y * cloudPuffSize.y * (1.0 + breath * 0.15) + shear * 0.0015)
      + across * (position.z * cloudPuffSize.z + shear * 0.0018 * bankFormation);
    vec4 worldPoint = modelMatrix * vec4(localPoint, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPoint;
    vec3 adjustedNormal = along * normal.x / cloudPuffSize.x
      + direction * normal.y / cloudPuffSize.y + across * normal.z / cloudPuffSize.z;
    cloudNormal = normalize(adjustedNormal);
    cloudViewNormal = normalize(mat3(modelMatrix) * adjustedNormal);
    cloudViewDirection = cameraPosition - worldPoint.xyz;
    cloudDaylight = smoothstep(-0.16, 0.25, dot(direction, sunLocal));
    float clearFocus = smoothstep(0.82, 0.92, dot(direction, focusedDirection));
    cloudOpacity = (1.0 - clearFocus * focusedAmount) * (bankFormation < 0.5 ? 1.0 : bankFormation < 1.5 ? 0.90 : 0.68);
    float horizon = dot(normalize(mat3(modelMatrix) * direction), normalize(cameraPosition - worldPoint.xyz));
    cloudOpacity *= smoothstep(-0.12, 0.12, horizon);
    cloudLayer = bankFormation;
  }
`;

const cloudFragmentShader = /* glsl */ `
  varying vec3 cloudNormal;
  varying vec3 cloudViewNormal;
  varying vec3 cloudViewDirection;
  varying float cloudDaylight;
  varying float cloudOpacity;
  varying float cloudLayer;
  uniform vec3 sunLocal;
  void main() {
    if (cloudOpacity < 0.12) discard;
    vec3 normal = normalize(cloudNormal);
    float sunlight = dot(normal, sunLocal);
    float lighting = smoothstep(-0.55, 0.8, sunlight);
    vec3 dayColor = mix(vec3(0.28, 0.44, 0.55), vec3(1.0, 0.98, 0.90), lighting);
    dayColor = mix(dayColor, vec3(0.83, 0.91, 0.96), cloudLayer * 0.12);
    vec3 color = mix(vec3(0.035, 0.07, 0.16), dayColor, cloudDaylight);
    float grazing = abs(dot(normalize(cloudViewNormal), normalize(cloudViewDirection)));
    float cottonEdge = smoothstep(0.015, 0.32, grazing);
    gl_FragColor = vec4(color, cloudOpacity * cottonEdge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
  }
`;

const smokeVertexShader = /* glsl */ `
  attribute vec3 chimneyPosition;
  attribute vec3 chimneyDrift;
  attribute vec3 puffShape;
  uniform float weatherTime;
  varying vec2 smokePoint;
  varying float smokeOpacity;
  varying float smokeAge;
  varying float smokeDaylight;
  uniform vec3 sunLocal;
  void main() {
    float age = fract(puffShape.x + weatherTime * (0.115 + puffShape.z * 0.012));
    vec3 normal = normalize(chimneyPosition);
    float rise = age * (0.105 + puffShape.z * 0.05);
    float bend = age * age * (0.035 + puffShape.z * 0.018);
    vec3 center = chimneyPosition + normal * (0.004 + rise) + chimneyDrift * bend;
    center += cross(normal, chimneyDrift) * sin(age * 8.0 + puffShape.x * 6.283) * age * 0.009;
    vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
    float size = puffShape.y * (0.36 + age * 1.45);
    float turn = puffShape.x * 6.283 + age * 0.8;
    mat2 rotation = mat2(cos(turn), -sin(turn), sin(turn), cos(turn));
    viewCenter.xy += rotation * position.xy * size;
    gl_Position = projectionMatrix * viewCenter;
    smokePoint = position.xy;
    smokeAge = age;
    smokeDaylight = smoothstep(-0.25, 0.40, dot(normal, sunLocal));
    smokeOpacity = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age)) * (0.15 + puffShape.z * 0.05);
  }
`;

const smokeFragmentShader = /* glsl */ `
  varying vec2 smokePoint;
  varying float smokeOpacity;
  varying float smokeAge;
  varying float smokeDaylight;
  void main() {
    vec2 p = smokePoint;
    float radial = length(p);
    float curl = 0.06 * sin(p.x * 9.0 + p.y * 4.0) * sin(p.y * 7.0 - p.x * 3.0);
    float alpha = (1.0 - smoothstep(0.27, 0.98, radial + curl)) * smokeOpacity;
    if (alpha < 0.004) discard;
    vec3 warmAsh = vec3(0.32, 0.28, 0.31);
    vec3 paleAsh = vec3(0.64, 0.69, 0.73);
    vec3 color = mix(warmAsh, paleAsh, clamp(smokeAge * 0.85 + p.y * 0.10 + 0.12, 0.0, 1.0));
    color *= 0.38 + 0.62 * smokeDaylight;
    color += vec3(0.65, 0.16, 0.025) * pow(1.0 - smokeAge, 3.0);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereVertexShader = /* glsl */ `
  varying vec3 worldPoint;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    worldPoint = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const atmosphereFragmentShader = /* glsl */ `
  varying vec3 worldPoint;
  uniform float atmosphereStrength;
  uniform vec3 sunWorld;
  void main() {
    vec3 ray = normalize(worldPoint - cameraPosition);
    // Distance from the viewing ray to the planet center produces a smooth
    // halo, with no hard glowing edge at the outer atmosphere mesh.
    float impact = length(cross(cameraPosition, ray));
    float altitude = max(0.0, impact - 1.002);
    float alpha = exp(-altitude * altitude / 0.0014);
    alpha *= 1.0 - smoothstep(1.067, 1.105, impact);
    alpha *= atmosphereStrength;
    float sunlight = dot(normalize(worldPoint), sunWorld);
    float daylight = smoothstep(-0.3, 0.45, sunlight);
    vec3 color = mix(vec3(0.055, 0.13, 0.35), vec3(0.58, 0.92, 0.99), daylight);
    float sunset = exp(-sunlight * sunlight * 20.0);
    color = mix(color, vec3(0.95, 0.42, 0.18), sunset * 0.28);
    alpha *= 0.5 + daylight * 0.5;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Purely visual weather: the caller owns time, reduced motion, and visibility.
 * Passing a constant time renders a complete, still scene without particles
 * disappearing. Geometry and shader budgets are fixed across all 32 worlds. */
export function createGlobeWeather(
  globe: THREE.Group,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  smokeSources: readonly GlobeSmokeSource[],
): GlobeWeather {
  const centers = new Float32Array(CLOUD_BANK_COUNT * 3);
  const puffSizes = new Float32Array(CLOUD_BANK_COUNT * 3);
  const seeds = new Float32Array(CLOUD_BANK_COUNT);
  const formationIds = new Float32Array(CLOUD_BANK_COUNT);
  for (let bank = 0; bank < CLOUD_BANK_COUNT; bank += 1) {
    const y = 1 - 2 * (bank + 0.5) / CLOUD_BANK_COUNT;
    const ring = Math.sqrt(1 - y * y);
    const angle = bank * GOLDEN_ANGLE + 0.73;
    const seed = ((bank * 29 + 17) % 101) / 101;
    const size = 0.79 + seed * 0.47;
    const formation = bank % 3;
    const height = formation === 0 ? 0.88 + seed * 0.37 : 0.85 + seed * 0.25;
    centers.set([Math.cos(angle) * ring, y, Math.sin(angle) * ring], bank * 3);
    puffSizes.set([size, size * height, size * (0.85 + seed * 0.2)], bank * 3);
    seeds[bank] = seed;
    formationIds[bank] = formation;
  }
  const time = { value: 0 };
  const sunLocal = { value: new THREE.Vector3(-0.4, 0.65, 0.7).normalize() };
  const sunWorld = { value: new THREE.Vector3(-0.4, 0.65, 0.7).normalize() };
  const focusedDirection = { value: new THREE.Vector3(0, 0, 1) };
  const focusedAmount = { value: 0 };
  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms: { weatherTime: time, focusedDirection, focusedAmount, sunLocal },
    vertexShader: cloudVertexShader, fragmentShader: cloudFragmentShader,
    // The unified surface can blend its outer fringe without overlapping
    // translucent lobes. Premultiplication keeps the canvas edge free of halos.
    transparent: true, depthWrite: false, premultipliedAlpha: true,
  });
  const cloudMeshes: THREE.Mesh[] = [];
  const cloudGeometries: THREE.InstancedBufferGeometry[] = [];
  for (let formation = 0; formation < 3; formation += 1) {
    const members = Array.from({ length: CLOUD_BANK_COUNT }, (_, index) => index).filter(index => formationIds[index] === formation);
    const surface = cloudSurface(formation);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", surface.getAttribute("position").clone());
    geometry.setAttribute("normal", surface.getAttribute("normal").clone());
    geometry.instanceCount = members.length;
    surface.dispose();
    const points = new Float32Array(members.length * 3), sizes = new Float32Array(members.length * 3);
    const phases = new Float32Array(members.length), types = new Float32Array(members.length);
    members.forEach((member, index) => {
      points.set(centers.subarray(member * 3, member * 3 + 3), index * 3);
      sizes.set(puffSizes.subarray(member * 3, member * 3 + 3), index * 3);
      phases[index] = seeds[member]; types[index] = formation;
    });
    geometry.setAttribute("bankCenter", new THREE.InstancedBufferAttribute(points, 3));
    geometry.setAttribute("puffOffset", new THREE.InstancedBufferAttribute(new Float32Array(members.length * 3), 3));
    geometry.setAttribute("cloudPuffSize", new THREE.InstancedBufferAttribute(sizes, 3));
    geometry.setAttribute("bankSeed", new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute("bankFormation", new THREE.InstancedBufferAttribute(types, 1));
    const mesh = new THREE.Mesh(geometry, cloudMaterial);
    mesh.name = ["Low billowing cumulus clouds", "Wide layered stratus banks", "High feathered cirrus ribbons"][formation];
    mesh.frustumCulled = false; mesh.renderOrder = 6;
    cloudGeometries.push(geometry); cloudMeshes.push(mesh); globe.add(mesh);
  }

  const smokeGeometry = billboardGeometry(smokeSources.length * SMOKE_PUFFS_PER_SOURCE);
  const sourcePositions = new Float32Array(smokeGeometry.instanceCount * 3);
  const sourceDrifts = new Float32Array(smokeGeometry.instanceCount * 3);
  const puffShapes = new Float32Array(smokeGeometry.instanceCount * 3);
  const normal = new THREE.Vector3();
  const drift = new THREE.Vector3();
  const pole = new THREE.Vector3(0, 1, 0);
  for (let sourceIndex = 0; sourceIndex < smokeSources.length; sourceIndex += 1) {
    const source = smokeSources[sourceIndex];
    const strength = THREE.MathUtils.clamp(source.strength, 0.2, 1.5);
    normal.set(source.position.x, source.position.y, source.position.z).normalize();
    drift.crossVectors(pole, normal);
    if (drift.lengthSq() < 0.001) drift.set(1, 0, 0);
    drift.normalize();
    for (let puff = 0; puff < SMOKE_PUFFS_PER_SOURCE; puff += 1) {
      const index = sourceIndex * SMOKE_PUFFS_PER_SOURCE + puff;
      sourcePositions.set([source.position.x, source.position.y, source.position.z], index * 3);
      sourceDrifts.set([drift.x, drift.y, drift.z], index * 3);
      puffShapes.set([
        (puff / SMOKE_PUFFS_PER_SOURCE + sourceIndex * 0.071) % 1,
        0.0108 + strength * 0.0078,
        strength,
      ], index * 3);
    }
  }
  smokeGeometry.setAttribute("chimneyPosition", new THREE.InstancedBufferAttribute(sourcePositions, 3));
  smokeGeometry.setAttribute("chimneyDrift", new THREE.InstancedBufferAttribute(sourceDrifts, 3));
  smokeGeometry.setAttribute("puffShape", new THREE.InstancedBufferAttribute(puffShapes, 3));
  const smokeMaterial = new THREE.ShaderMaterial({
    uniforms: { weatherTime: time, sunLocal },
    vertexShader: smokeVertexShader, fragmentShader: smokeFragmentShader,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial);
  smoke.name = "Volcano rising ash plumes";
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  smoke.visible = smokeSources.length > 0;
  globe.add(smoke);

  const atmosphereGeometry = new THREE.SphereGeometry(1.105, 64, 40);
  const atmosphereStrength = { value: 0.43 };
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: { atmosphereStrength, sunWorld },
    vertexShader: atmosphereVertexShader, fragmentShader: atmosphereFragmentShader,
    transparent: true, depthWrite: false, side: THREE.BackSide,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.name = "Soft blue atmospheric limb";
  atmosphere.renderOrder = 4;
  scene.add(atmosphere);

  const surfaceHazeGeometry = new THREE.SphereGeometry(1.009, 64, 40);
  const surfaceHazeMaterial = new THREE.ShaderMaterial({
    uniforms: { hazeAmount: { value: 0.11 }, sunLocal },
    vertexShader: /* glsl */ `
      varying vec3 viewNormal;
      varying vec3 viewDirection;
      varying vec3 localDirection;
      void main() {
        localDirection = normalize(position);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        viewNormal = normalize(normalMatrix * normal);
        viewDirection = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float hazeAmount;
      uniform vec3 sunLocal;
      varying vec3 viewNormal;
      varying vec3 viewDirection;
      varying vec3 localDirection;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(viewNormal), normalize(viewDirection))), 3.0);
        float light = smoothstep(-0.3, 0.4, dot(normalize(localDirection), sunLocal));
        vec3 color = mix(vec3(0.09, 0.15, 0.28), vec3(0.64, 0.86, 0.97), light);
        gl_FragColor = vec4(color, rim * hazeAmount);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true, depthWrite: false,
  });
  const surfaceHaze = new THREE.Mesh(surfaceHazeGeometry, surfaceHazeMaterial);
  surfaceHaze.name = "Distant sea atmospheric haze";
  surfaceHaze.renderOrder = 3;
  globe.add(surfaceHaze);

  // Soft projected banks darken the water beneath them. They use the same
  // deterministic centers and drift as the visible clouds, with a sun offset.
  const shadowPlane = new THREE.PlaneGeometry(2, 2, 6, 4);
  const shadowGeometry = new THREE.InstancedBufferGeometry();
  shadowGeometry.setIndex(shadowPlane.index!.clone());
  shadowGeometry.setAttribute("position", shadowPlane.getAttribute("position").clone());
  shadowGeometry.instanceCount = CLOUD_BANK_COUNT;
  shadowPlane.dispose();
  const shadowCenters = new Float32Array(CLOUD_BANK_COUNT * 3);
  const shadowSeeds = new Float32Array(CLOUD_BANK_COUNT);
  for (let index = 0; index < CLOUD_BANK_COUNT; index += 1) {
    shadowCenters.set(centers.subarray(index * 3, index * 3 + 3), index * 3);
    shadowSeeds[index] = seeds[index];
  }
  shadowGeometry.setAttribute("bankCenter", new THREE.InstancedBufferAttribute(shadowCenters, 3));
  shadowGeometry.setAttribute("bankSeed", new THREE.InstancedBufferAttribute(shadowSeeds, 1));
  shadowGeometry.setAttribute("bankFormation", new THREE.InstancedBufferAttribute(formationIds, 1));
  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: { weatherTime: time, sunLocal, focusedDirection, focusedAmount },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 bankCenter;
      attribute float bankSeed;
      attribute float bankFormation;
      uniform float weatherTime;
      uniform vec3 sunLocal;
      uniform vec3 focusedDirection;
      uniform float focusedAmount;
      varying vec2 shadowPoint;
      varying float shadowOpacity;
      void main() {
        float velocity = bankFormation < 0.5 ? 0.0055 : bankFormation < 1.5 ? -0.0038 : 0.0105;
        float angle = weatherTime * (velocity + bankSeed * 0.0012);
        float s = sin(angle), c = cos(angle);
        vec3 direction = normalize(vec3(bankCenter.x * c - bankCenter.z * s,
          bankCenter.y + sin(weatherTime * 0.035 + bankSeed * 19.0) * 0.005,
          bankCenter.x * s + bankCenter.z * c));
        float daylight = dot(direction, sunLocal);
        vec3 tangentSun = sunLocal - direction * daylight;
        direction = normalize(direction - tangentSun * 0.075 / max(0.35, daylight));
        vec3 east = normalize(cross(abs(direction.y) > 0.98 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0), direction));
        vec3 north = cross(direction, east);
        float angleBank = bankSeed * 4.0;
        vec3 along = east * cos(angleBank) + north * sin(angleBank);
        vec3 across = -east * sin(angleBank) + north * cos(angleBank);
        vec3 point = normalize(direction + along * position.x * 0.13 + across * position.y * 0.075) * 1.0018;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        shadowPoint = position.xy;
        shadowOpacity = smoothstep(0.08, 0.45, daylight) * (1.0 - focusedAmount * smoothstep(0.82, 0.92, dot(direction, focusedDirection)));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 shadowPoint;
      varying float shadowOpacity;
      void main() {
        float density = exp(-dot(shadowPoint, shadowPoint) * 2.8);
        density *= 1.0 - smoothstep(0.7, 1.0, length(shadowPoint));
        gl_FragColor = vec4(0.015, 0.05, 0.09, density * shadowOpacity * 0.19);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const shadows = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadows.name = "Wind-driven cloud shadows on ocean";
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  globe.add(shadows);

  // Two narrow curtains follow the polar ovals; only their night-side sections
  // light up. Vertical ribs and a soft lower edge suggest luminous moving air.
  const auroraVertices: number[] = [];
  const auroraIndices: number[] = [];
  const auroraSegments = 128;
  for (const hemisphere of [1, -1]) {
    const offset = auroraVertices.length / 3;
    for (let segment = 0; segment <= auroraSegments; segment += 1) {
      const longitude = segment / auroraSegments * Math.PI * 2;
      auroraVertices.push(longitude, 0, hemisphere, longitude, 1, hemisphere);
      if (segment < auroraSegments) {
        const start = offset + segment * 2;
        auroraIndices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
      }
    }
  }
  const auroraGeometry = new THREE.BufferGeometry();
  auroraGeometry.setAttribute("position", new THREE.Float32BufferAttribute(auroraVertices, 3));
  auroraGeometry.setIndex(auroraIndices);
  const auroraMaterial = new THREE.ShaderMaterial({
    uniforms: { weatherTime: time, sunLocal, focusedDirection, focusedAmount },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float weatherTime;
      uniform vec3 sunLocal;
      varying vec2 curtainPoint;
      varying float nightStrength;
      uniform vec3 focusedDirection;
      uniform float focusedAmount;
      void main() {
        float longitude = position.x;
        float height = position.y;
        float latitude = 1.12 + sin(longitude * 3.0 + weatherTime * 0.11) * 0.052;
        latitude += sin(longitude * 7.0 - weatherTime * 0.075) * 0.018;
        vec3 direction = vec3(cos(longitude) * cos(latitude), sin(latitude) * position.z, sin(longitude) * cos(latitude));
        float ripple = 0.8 + sin(longitude * 9.0 + weatherTime * 0.19) * 0.15;
        vec3 point = direction * (1.017 + height * 0.11 * ripple);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        curtainPoint = vec2(longitude, height);
        nightStrength = 1.0 - smoothstep(-0.20, 0.08, dot(direction, sunLocal));
        nightStrength *= 1.0 - focusedAmount * smoothstep(0.85, 0.97, dot(direction, focusedDirection));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float weatherTime;
      varying vec2 curtainPoint;
      varying float nightStrength;
      void main() {
        float h = curtainPoint.y;
        float ribs = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(curtainPoint.x * 53.0 + weatherTime * 0.26), 2.0);
        float bands = 0.55 + 0.45 * sin(curtainPoint.x * 4.0 - weatherTime * 0.055);
        float fade = smoothstep(0.0, 0.10, h) * pow(1.0 - h, 1.65);
        float alpha = fade * ribs * bands * nightStrength * 0.42;
        if (alpha < 0.003) discard;
        vec3 color = mix(vec3(0.12, 0.95, 0.51), vec3(0.47, 0.25, 0.88), smoothstep(0.12, 0.88, h));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const aurora = new THREE.Mesh(auroraGeometry, auroraMaterial);
  aurora.name = "Night-side polar aurora curtains";
  aurora.frustumCulled = false;
  aurora.renderOrder = 8;
  globe.add(aurora);

  let disposed = false;
  return {
    update(timeSeconds, focus, zoom, activeDestinationId, sunDirection) {
      if (disposed) return;
      if (sunDirection && sunDirection.lengthSq() > 0.0001) sunLocal.value.copy(sunDirection).normalize();
      sunWorld.value.copy(sunLocal.value).applyQuaternion(globe.quaternion);
      time.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      focusedDirection.value.set(focus.x, focus.y, focus.z).normalize();
      focusedAmount.value = activeDestinationId ? THREE.MathUtils.smoothstep(zoom, 0.05, 0.72) : 0;
      // At close range the atmospheric horizon remains soft without washing
      // out the nearby islands or making the stop controls harder to see.
      atmosphereStrength.value = THREE.MathUtils.lerp(0.43, 0.30, zoom);
      surfaceHazeMaterial.uniforms.hazeAmount.value = THREE.MathUtils.lerp(0.11, 0.20, zoom);
      atmosphere.visible = camera.position.lengthSq() > 1.105 * 1.105;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      globe.remove(...cloudMeshes, smoke, surfaceHaze, shadows, aurora);
      scene.remove(atmosphere);
      for (const geometry of cloudGeometries) geometry.dispose();
      cloudMaterial.dispose();
      smokeGeometry.dispose();
      smokeMaterial.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      surfaceHazeGeometry.dispose();
      surfaceHazeMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      auroraGeometry.dispose();
      auroraMaterial.dispose();
    },
  };
}
