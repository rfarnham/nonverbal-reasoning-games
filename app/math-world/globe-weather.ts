import * as THREE from "three";
import type { Vec3 } from "./globe-geometry";

export type GlobeSmokeSource = Readonly<{ position: Vec3; strength: number }>;
export type GlobeWeather = Readonly<{
  update: (timeSeconds: number, focus: Vec3, zoom: number, activeDestinationId: string) => void;
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

const cloudVertexShader = /* glsl */ `
  attribute vec3 bankCenter;
  attribute vec3 puffOffset;
  attribute vec3 cloudPuffSize;
  attribute float bankSeed;
  uniform float weatherTime;
  uniform vec3 focusedDirection;
  uniform float focusedAmount;
  varying vec3 cloudNormal;
  varying float cloudOpacity;
  void main() {
    // Actual ellipsoidal billows follow the planet's tangent, so banks curve
    // around the horizon and keep their volume while the globe rotates.
    float angle = weatherTime * (0.007 + bankSeed * 0.0018);
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
    vec3 center = direction * (1.083 + puffOffset.y) + along * puffOffset.x + across * puffOffset.z;
    vec3 localPoint = center + along * position.x * cloudPuffSize.x
      + direction * position.y * cloudPuffSize.y + across * position.z * cloudPuffSize.z;
    vec4 worldPoint = modelMatrix * vec4(localPoint, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPoint;
    vec3 adjustedNormal = along * normal.x / cloudPuffSize.x
      + direction * normal.y / cloudPuffSize.y + across * normal.z / cloudPuffSize.z;
    cloudNormal = normalize(mat3(modelMatrix) * adjustedNormal);
    float clearFocus = smoothstep(0.82, 0.92, dot(direction, focusedDirection));
    cloudOpacity = 1.0 - clearFocus * focusedAmount;
  }
`;

const cloudFragmentShader = /* glsl */ `
  varying vec3 cloudNormal;
  varying float cloudOpacity;
  void main() {
    if (cloudOpacity < 0.12) discard;
    vec3 normal = normalize(cloudNormal);
    float sunlight = dot(normal, normalize(vec3(-0.4, 0.65, 0.7)));
    float lighting = smoothstep(-0.75, 0.8, sunlight);
    vec3 color = mix(vec3(0.38, 0.57, 0.69), vec3(1.0, 0.99, 0.93), lighting);
    gl_FragColor = vec4(color, cloudOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
    smokeOpacity = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age)) * (0.15 + puffShape.z * 0.05);
  }
`;

const smokeFragmentShader = /* glsl */ `
  varying vec2 smokePoint;
  varying float smokeOpacity;
  varying float smokeAge;
  void main() {
    vec2 p = smokePoint;
    float radial = length(p);
    float curl = 0.06 * sin(p.x * 9.0 + p.y * 4.0) * sin(p.y * 7.0 - p.x * 3.0);
    float alpha = (1.0 - smoothstep(0.27, 0.98, radial + curl)) * smokeOpacity;
    if (alpha < 0.004) discard;
    vec3 warmAsh = vec3(0.32, 0.28, 0.31);
    vec3 paleAsh = vec3(0.64, 0.69, 0.73);
    vec3 color = mix(warmAsh, paleAsh, clamp(smokeAge * 0.85 + p.y * 0.10 + 0.12, 0.0, 1.0));
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
  void main() {
    vec3 ray = normalize(worldPoint - cameraPosition);
    // Distance from the viewing ray to the planet center produces a smooth
    // halo, with no hard glowing edge at the outer atmosphere mesh.
    float impact = length(cross(cameraPosition, ray));
    float altitude = max(0.0, impact - 1.002);
    float alpha = exp(-altitude * altitude / 0.0014);
    alpha *= 1.0 - smoothstep(1.067, 1.105, impact);
    alpha *= atmosphereStrength;
    float sunlight = dot(normalize(worldPoint), normalize(vec3(-0.4, 0.65, 0.7))) * 0.5 + 0.5;
    vec3 color = mix(vec3(0.20, 0.48, 0.91), vec3(0.58, 0.92, 0.99), sunlight);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Purely visual weather: the caller owns time, reduced motion, and visibility.
 * Passing a constant time renders a complete, still scene without particles
 * disappearing. Four draw calls cover the entire globe and every volcano. */
export function createGlobeWeather(
  globe: THREE.Group,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  smokeSources: readonly GlobeSmokeSource[],
): GlobeWeather {
  const cloudLobes = [
    [-0.074, 0, 0.004, 0.044, 0.018, 0.036],
    [-0.039, 0.010, -0.015, 0.053, 0.031, 0.043],
    [0.011, 0.015, 0.001, 0.058, 0.039, 0.049],
    [0.062, 0.004, 0.006, 0.046, 0.026, 0.035],
    [0.024, -0.003, 0.036, 0.061, 0.017, 0.030],
    [-0.035, -0.004, 0.032, 0.043, 0.015, 0.025],
  ];
  const cloudCount = CLOUD_BANK_COUNT * cloudLobes.length;
  const cloudSphere = new THREE.SphereGeometry(1, 14, 9);
  const cloudGeometry = new THREE.InstancedBufferGeometry();
  cloudGeometry.setIndex(cloudSphere.index!.clone());
  cloudGeometry.setAttribute("position", cloudSphere.getAttribute("position").clone());
  cloudGeometry.setAttribute("normal", cloudSphere.getAttribute("normal").clone());
  cloudGeometry.instanceCount = cloudCount;
  cloudSphere.dispose();
  const centers = new Float32Array(cloudCount * 3);
  const offsets = new Float32Array(cloudCount * 3);
  const puffSizes = new Float32Array(cloudCount * 3);
  const seeds = new Float32Array(cloudCount);
  for (let bank = 0; bank < CLOUD_BANK_COUNT; bank += 1) {
    const y = 1 - 2 * (bank + 0.5) / CLOUD_BANK_COUNT;
    const ring = Math.sqrt(1 - y * y);
    const angle = bank * GOLDEN_ANGLE + 0.73;
    const seed = ((bank * 29 + 17) % 101) / 101;
    const size = 0.80 + seed * 0.6;
    for (let puff = 0; puff < cloudLobes.length; puff += 1) {
      const index = bank * cloudLobes.length + puff;
      const lobe = cloudLobes[puff];
      centers.set([Math.cos(angle) * ring, y, Math.sin(angle) * ring], index * 3);
      offsets.set([lobe[0] * size, lobe[1] * size, lobe[2] * size], index * 3);
      puffSizes.set([lobe[3] * size, lobe[4] * size, lobe[5] * size], index * 3);
      seeds[index] = seed;
    }
  }
  cloudGeometry.setAttribute("bankCenter", new THREE.InstancedBufferAttribute(centers, 3));
  cloudGeometry.setAttribute("puffOffset", new THREE.InstancedBufferAttribute(offsets, 3));
  cloudGeometry.setAttribute("cloudPuffSize", new THREE.InstancedBufferAttribute(puffSizes, 3));
  cloudGeometry.setAttribute("bankSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  const time = { value: 0 };
  const focusedDirection = { value: new THREE.Vector3(0, 0, 1) };
  const focusedAmount = { value: 0 };
  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms: { weatherTime: time, focusedDirection, focusedAmount },
    vertexShader: cloudVertexShader, fragmentShader: cloudFragmentShader,
    transparent: true, depthWrite: true,
  });
  const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
  clouds.name = "Globe drifting cloud banks";
  clouds.frustumCulled = false;
  clouds.renderOrder = 6;
  globe.add(clouds);

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
    uniforms: { weatherTime: time },
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
    uniforms: { atmosphereStrength },
    vertexShader: atmosphereVertexShader, fragmentShader: atmosphereFragmentShader,
    transparent: true, depthWrite: false, side: THREE.BackSide,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.name = "Soft blue atmospheric limb";
  atmosphere.renderOrder = 4;
  scene.add(atmosphere);

  const surfaceHazeGeometry = new THREE.SphereGeometry(1.009, 64, 40);
  const surfaceHazeMaterial = new THREE.ShaderMaterial({
    uniforms: { hazeAmount: { value: 0.11 } },
    vertexShader: /* glsl */ `
      varying vec3 viewNormal;
      varying vec3 viewDirection;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        viewNormal = normalize(normalMatrix * normal);
        viewDirection = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float hazeAmount;
      varying vec3 viewNormal;
      varying vec3 viewDirection;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(viewNormal), normalize(viewDirection))), 3.0);
        gl_FragColor = vec4(0.64, 0.86, 0.97, rim * hazeAmount);
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

  let disposed = false;
  return {
    update(timeSeconds, focus, zoom) {
      if (disposed) return;
      time.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      focusedDirection.value.set(focus.x, focus.y, focus.z).normalize();
      focusedAmount.value = THREE.MathUtils.smoothstep(zoom, 0.05, 0.72);
      // At close range the atmospheric horizon remains soft without washing
      // out the nearby islands or making the stop controls harder to see.
      atmosphereStrength.value = THREE.MathUtils.lerp(0.43, 0.30, zoom);
      surfaceHazeMaterial.uniforms.hazeAmount.value = THREE.MathUtils.lerp(0.11, 0.20, zoom);
      atmosphere.visible = camera.position.lengthSq() > 1.105 * 1.105;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      globe.remove(clouds, smoke, surfaceHaze);
      scene.remove(atmosphere);
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      smokeGeometry.dispose();
      smokeMaterial.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      surfaceHazeGeometry.dispose();
      surfaceHazeMaterial.dispose();
    },
  };
}
