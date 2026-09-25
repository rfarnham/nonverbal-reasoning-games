import * as THREE from "three";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import { getGlobeMap, getGlobeRegion, tangentPointToGlobe, type Vec3 } from "./globe-geometry.ts";
import { getWorldBiome } from "./globe-biome-data.ts";
import type { GlobeSmokeSource } from "./globe-weather.ts";

export type GlobeLife = Readonly<{
  update: (timeSeconds: number, focus: Vec3, zoom: number, activeDestinationId: string, sunDirection?: THREE.Vector3) => void;
  dispose: () => void;
}>;
export type GlobeLifeSources = Readonly<{
  smokeSources: readonly GlobeSmokeSource[];
  mistSources?: readonly GlobeSmokeSource[];
}>;

type Particle = Readonly<{ point: Vec3; kind: number; seed: number; strength: number }>;
const random = (seed: number) => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const lushBiomes = new Set(["tropical", "orchard", "woodland", "lagoon", "river", "rainforest", "waterfalls", "mangrove", "autumn", "terraces"]);
const glowingBiomes = new Set(["woodland", "rainforest", "mangrove"]);

function instancePlane(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  return geometry;
}

/** A fixed collection of tiny habitat details. The scene owns the clock: no
 * timers, animation loops, network requests, or question/progress state live here. */
export function createGlobeLife(globe: THREE.Group, sources: GlobeLifeSources): GlobeLife {
  const time = { value: 0 };
  const sunLocal = { value: new THREE.Vector3(-0.4, 0.65, 0.7).normalize() };
  const focusedDirection = { value: new THREE.Vector3(0, 0, 1) };
  const closeAmount = { value: 0 };
  const group = new THREE.Group();
  group.name = "Habitat wildlife and local weather";
  globe.add(group);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const keepGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.push(geometry); return geometry; };
  const keepMaterial = <T extends THREE.Material>(material: T) => { materials.push(material); return material; };
  const particles: Particle[] = [];
  const birds: { point: Vec3; seed: number; pale: number }[] = [];
  const rainOrigins: Vec3[] = [];
  for (const world of WORLD_DEFINITIONS) {
    const biome = getWorldBiome(world.number);
    const map = getGlobeMap(world.number, world.stopIds.length);
    const islands = map.islands.filter(island => typeof island.stopIndex === "number");
    if (lushBiomes.has(biome.id)) {
      for (let bird = 0; bird < 3; bird += 1) {
        birds.push({ point: getGlobeRegion(world.number).center, seed: random(world.number * 11 + bird), pale: ["tropical", "lagoon"].includes(biome.id) ? 1 : 0 });
      }
    }
    if (["glacier", "tundra"].includes(biome.id)) {
      for (let flake = 0; flake < 42; flake += 1) {
        const seed = world.number * 91 + flake;
        const point = tangentPointToGlobe(getGlobeRegion(world.number), (random(seed) - 0.5) * 0.27, (random(seed + 7) - 0.5) * 0.14, 1.018);
        particles.push({ point, kind: 2, seed: random(seed + 13), strength: 0.55 + random(seed + 3) * 0.45 });
      }
    }
    if (glowingBiomes.has(biome.id)) {
      for (const [islandIndex, island] of islands.slice(0, 2).entries()) {
        for (let fly = 0; fly < 9; fly += 1) particles.push({ point: island.point, kind: 3, seed: random(world.number * 83 + islandIndex * 13 + fly), strength: 1 });
      }
    }
    if (biome.id === "rainforest") {
      const origin = tangentPointToGlobe(getGlobeRegion(world.number), -0.112, 0.077, 1.018);
      rainOrigins.push(origin);
      // A small low cloud belongs to the shower; it does not depend on a global
      // drifting bank coincidentally passing over this corner of the forest.
      for (let puff = 0; puff < 5; puff += 1) particles.push({ point: origin, kind: 4, seed: puff / 5, strength: 1 });
    }
  }
  for (const [sourceIndex, source] of sources.smokeSources.entries()) {
    for (let ember = 0; ember < 6; ember += 1) particles.push({ point: source.position, kind: 0, seed: random(sourceIndex * 17 + ember), strength: source.strength });
  }
  for (const [sourceIndex, source] of (sources.mistSources ?? []).entries()) {
    for (let puff = 0; puff < 7; puff += 1) particles.push({ point: source.position, kind: 1, seed: (puff / 7 + sourceIndex * 0.093) % 1, strength: source.strength });
  }

  const particleGeometry = keepGeometry(instancePlane());
  particleGeometry.instanceCount = particles.length;
  const particlePositions = new Float32Array(particles.length * 3);
  const particleData = new Float32Array(particles.length * 3);
  particles.forEach((particle, index) => {
    particlePositions.set([particle.point.x, particle.point.y, particle.point.z], index * 3);
    particleData.set([particle.kind, particle.seed, particle.strength], index * 3);
  });
  particleGeometry.setAttribute("sourcePosition", new THREE.InstancedBufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("particleData", new THREE.InstancedBufferAttribute(particleData, 3));
  const particleMaterial = keepMaterial(new THREE.ShaderMaterial({
    uniforms: { lifeTime: time, sunLocal, closeAmount },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 sourcePosition;
      attribute vec3 particleData;
      uniform float lifeTime;
      uniform vec3 sunLocal;
      uniform float closeAmount;
      varying vec2 particlePoint;
      varying vec3 particleColor;
      varying float particleAlpha;
      varying float particleKind;
      void main() {
        float kind = particleData.x, seed = particleData.y, strength = particleData.z;
        vec3 normal = normalize(sourcePosition);
        vec3 east = normalize(cross(abs(normal.y) > 0.98 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0), normal));
        vec3 north = cross(normal, east);
        float daylight = smoothstep(-0.22, 0.35, dot(normal, sunLocal));
        vec3 center = sourcePosition;
        float size = 0.001;
        particleAlpha = 0.5;
        particleColor = vec3(1.0);
        if (kind < 0.5) {
          float age = fract(seed + lifeTime * 0.19);
          float spin = seed * 29.0 + lifeTime * 1.15;
          center += normal * (0.004 + age * 0.037) + (east * cos(spin) + north * sin(spin)) * (0.003 + age * 0.009);
          size = (0.0007 + strength * 0.00055) * (1.0 - age * 0.45);
          particleAlpha = smoothstep(0.0, 0.1, age) * (1.0 - age) * 0.85;
          particleColor = mix(vec3(1.0, 0.7, 0.13), vec3(1.0, 0.20, 0.018), age);
        } else if (kind < 1.5) {
          float age = fract(seed + lifeTime * 0.16);
          center += normal * (0.001 + age * 0.017)
            + east * sin(seed * 20.0 + lifeTime * 0.35) * (0.004 + age * 0.008)
            + north * cos(seed * 17.0) * age * 0.006;
          size = (0.003 + age * 0.010) * strength;
          particleAlpha = sin(age * 3.14159) * 0.12;
          particleColor = mix(vec3(0.17, 0.30, 0.43), vec3(0.80, 0.94, 0.94), daylight);
        } else if (kind < 2.5) {
          float age = fract(seed + lifeTime * (0.045 + strength * 0.015));
          center = normal * (1.021 + (1.0 - age) * 0.105);
          center += east * sin(lifeTime * 0.55 + seed * 14.0) * 0.009 + north * cos(lifeTime * 0.35 + seed * 19.0) * 0.005;
          size = 0.0009 + strength * 0.0008;
          particleAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.85, 1.0, age)) * 0.65;
          particleColor = mix(vec3(0.41, 0.63, 0.83), vec3(0.94, 0.99, 1.0), daylight);
        } else if (kind < 3.5) {
          float angle = seed * 61.0 + lifeTime * 0.47;
          center = normal * 1.038 + east * sin(angle) * 0.026 + north * cos(angle * 0.71) * 0.019;
          center += normal * sin(lifeTime * 0.9 + seed * 20.0) * 0.006;
          size = 0.0014;
          particleAlpha = (1.0 - daylight) * (0.22 + 0.78 * pow(0.5 + 0.5 * sin(lifeTime * 1.1 + seed * 50.0), 3.0));
          particleColor = vec3(0.80, 1.0, 0.12);
        } else {
          center = normal * 1.118 + east * (seed - 0.5) * 0.058 + north * sin(seed * 13.0) * 0.009;
          size = 0.022 + sin(seed * 8.0 + lifeTime * 0.12) * 0.003;
          particleAlpha = 0.26;
          particleColor = mix(vec3(0.10, 0.15, 0.23), vec3(0.49, 0.63, 0.68), daylight);
        }
        // Sparse accents remain legible when close; they do not become a layer
        // of giant dots when the entire planet is visible.
        particleAlpha *= 0.50 + closeAmount * 0.50;
        vec4 view = modelViewMatrix * vec4(center, 1.0);
        view.xy += position.xy * size;
        gl_Position = projectionMatrix * view;
        particlePoint = position.xy;
        particleKind = kind;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 particlePoint;
      varying vec3 particleColor;
      varying float particleAlpha;
      varying float particleKind;
      void main() {
        float r = length(particlePoint);
        float soft = particleKind > 0.5 && particleKind < 1.5 || particleKind > 3.5 ? 0.08 : 0.22;
        float alpha = (1.0 - smoothstep(soft, 1.0, r)) * particleAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(particleColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  const particleMesh = new THREE.Mesh(particleGeometry, particleMaterial);
  particleMesh.name = "Local embers, waterfall mist, snow, and fireflies";
  particleMesh.frustumCulled = false;
  particleMesh.renderOrder = 7;
  group.add(particleMesh);

  const birdGeometry = keepGeometry(new THREE.InstancedBufferGeometry());
  // Two tapered wings and a narrow body form an actual flapping silhouette.
  birdGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, -1, 0.13, 0, -0.45, -0.19, 0,
    0, 0, 0, 0.45, -0.19, 0, 1, 0.13, 0,
    -0.08, -0.35, 0, 0.08, -0.35, 0, 0, 0.29, 0,
  ], 3));
  birdGeometry.instanceCount = birds.length;
  const birdPositions = new Float32Array(birds.length * 3);
  const birdSeeds = new Float32Array(birds.length * 2);
  birds.forEach((bird, index) => {
    birdPositions.set([bird.point.x, bird.point.y, bird.point.z], index * 3);
    birdSeeds.set([bird.seed, bird.pale], index * 2);
  });
  birdGeometry.setAttribute("birdCenter", new THREE.InstancedBufferAttribute(birdPositions, 3));
  birdGeometry.setAttribute("birdSeed", new THREE.InstancedBufferAttribute(birdSeeds, 2));
  const birdMaterial = keepMaterial(new THREE.ShaderMaterial({
    uniforms: { lifeTime: time, sunLocal },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 birdCenter;
      attribute vec2 birdSeed;
      uniform float lifeTime;
      uniform vec3 sunLocal;
      varying vec3 birdColor;
      void main() {
        vec3 normal = normalize(birdCenter);
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
        vec3 north = cross(normal, east);
        float phase = birdSeed.x * 31.0 + lifeTime * (0.15 + birdSeed.x * 0.05);
        float radius = 0.046 + birdSeed.x * 0.045;
        vec3 center = normal * (1.090 + birdSeed.x * 0.025)
          + east * cos(phase) * radius + north * sin(phase) * radius * 0.6;
        float flap = sin(lifeTime * 6.0 + birdSeed.x * 14.0);
        float glide = smoothstep(-0.4, 0.7, sin(lifeTime * 0.6 + birdSeed.x * 20.0));
        vec2 wing = position.xy;
        wing.y += abs(position.x) * flap * 0.42 * glide;
        float heading = -phase + 0.5;
        mat2 turn = mat2(cos(heading), -sin(heading), sin(heading), cos(heading));
        vec4 view = modelViewMatrix * vec4(center, 1.0);
        view.xy += turn * wing * (0.0040 + birdSeed.x * 0.0012);
        gl_Position = projectionMatrix * view;
        float daylight = smoothstep(-0.2, 0.35, dot(normal, sunLocal));
        vec3 dark = mix(vec3(0.04, 0.07, 0.13), vec3(0.13, 0.25, 0.24), daylight);
        vec3 light = mix(vec3(0.20, 0.29, 0.40), vec3(0.89, 0.94, 0.85), daylight);
        birdColor = mix(dark, light, birdSeed.y);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 birdColor;
      void main() {
        gl_FragColor = vec4(birdColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  const birdMesh = new THREE.Mesh(birdGeometry, birdMaterial);
  birdMesh.name = "Small circling seabirds and forest birds";
  birdMesh.frustumCulled = false;
  group.add(birdMesh);

  const rainGeometry = keepGeometry(instancePlane());
  const dropsPerShower = 108;
  rainGeometry.instanceCount = rainOrigins.length * dropsPerShower;
  const rainPositions = new Float32Array(rainGeometry.instanceCount * 3);
  const rainSeeds = new Float32Array(rainGeometry.instanceCount * 3);
  for (const [shower, origin] of rainOrigins.entries()) {
    for (let drop = 0; drop < dropsPerShower; drop += 1) {
      const index = shower * dropsPerShower + drop;
      rainPositions.set([origin.x, origin.y, origin.z], index * 3);
      rainSeeds.set([random(index + 10), random(index + 37), random(index + 103)], index * 3);
    }
  }
  rainGeometry.setAttribute("showerCenter", new THREE.InstancedBufferAttribute(rainPositions, 3));
  rainGeometry.setAttribute("dropSeed", new THREE.InstancedBufferAttribute(rainSeeds, 3));
  const rainMaterial = keepMaterial(new THREE.ShaderMaterial({
    uniforms: { lifeTime: time, sunLocal, closeAmount },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 showerCenter;
      attribute vec3 dropSeed;
      uniform float lifeTime;
      uniform vec3 sunLocal;
      uniform float closeAmount;
      varying vec2 dropPoint;
      varying float dropAlpha;
      varying float dropDaylight;
      void main() {
        vec3 normal = normalize(showerCenter);
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
        vec3 north = cross(normal, east);
        float age = fract(dropSeed.z + lifeTime * (0.72 + dropSeed.y * 0.22));
        float angle = dropSeed.x * 6.28318;
        float radius = sqrt(dropSeed.y) * 0.035;
        vec3 point = showerCenter + normal * (1.0 - age) * 0.090
          + east * (cos(angle) * radius + age * 0.009) + north * sin(angle) * radius * 0.7;
        // Radial drops follow the curved planet, including in oblique views.
        point += normal * position.y * 0.0045 + east * position.x * 0.0003;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        dropPoint = position.xy;
        dropAlpha = sin(age * 3.14159) * (0.12 + closeAmount * 0.14);
        dropDaylight = smoothstep(-0.2, 0.3, dot(normal, sunLocal));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 dropPoint;
      varying float dropAlpha;
      varying float dropDaylight;
      void main() {
        float alpha = (1.0 - abs(dropPoint.x)) * (1.0 - abs(dropPoint.y)) * dropAlpha;
        if (alpha < 0.004) discard;
        vec3 color = mix(vec3(0.31, 0.43, 0.57), vec3(0.69, 0.85, 0.89), dropDaylight);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  const rain = new THREE.Mesh(rainGeometry, rainMaterial);
  rain.name = "Localized rainforest showers";
  rain.frustumCulled = false;
  rain.renderOrder = 6;
  group.add(rain);

  const rainbowGeometry = keepGeometry(new THREE.BufferGeometry());
  const rainbowVertices: number[] = [];
  const rainbowCenters: number[] = [];
  const rainbowIndices: number[] = [];
  for (const origin of rainOrigins) {
    const offset = rainbowVertices.length / 3;
    for (let segment = 0; segment <= 56; segment += 1) {
      const angle = segment / 56 * Math.PI;
      for (const band of [0, 1]) {
        rainbowVertices.push(angle, band, 0);
        rainbowCenters.push(origin.x, origin.y, origin.z);
      }
      if (segment < 56) { const index = offset + segment * 2; rainbowIndices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2); }
    }
  }
  rainbowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(rainbowVertices, 3));
  rainbowGeometry.setAttribute("bowCenter", new THREE.Float32BufferAttribute(rainbowCenters, 3));
  rainbowGeometry.setIndex(rainbowIndices);
  const rainbowMaterial = keepMaterial(new THREE.ShaderMaterial({
    uniforms: { lifeTime: time, sunLocal },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 bowCenter;
      uniform float lifeTime;
      uniform vec3 sunLocal;
      varying vec2 bowPoint;
      varying float bowAlpha;
      void main() {
        vec3 normal = normalize(bowCenter);
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
        vec3 north = cross(normal, east);
        float radius = 0.035 + position.y * 0.0045;
        vec3 point = normal * 1.020 + east * 0.058 + north * 0.01;
        point += east * cos(position.x) * radius + normal * sin(position.x) * radius;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        bowPoint = position.xy;
        bowAlpha = smoothstep(0.0, 0.45, dot(normal, sunLocal)) * (0.16 + sin(lifeTime * 0.12) * 0.025);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 bowPoint;
      varying float bowAlpha;
      void main() {
        float band = bowPoint.y;
        vec3 color = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + band * 0.78));
        float fade = smoothstep(0.0, 0.2, band) * (1.0 - smoothstep(0.82, 1.0, band));
        float alpha = fade * sin(bowPoint.x) * bowAlpha;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  const rainbow = new THREE.Mesh(rainbowGeometry, rainbowMaterial);
  rainbow.name = "Faint sunlit rainforest rainbows";
  rainbow.frustumCulled = false;
  rainbow.renderOrder = 8;
  group.add(rainbow);

  let disposed = false;
  return {
    update(timeSeconds, focus, zoom, activeDestinationId, sunDirection) {
      if (disposed) return;
      time.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      if (sunDirection && sunDirection.lengthSq() > 0.0001) sunLocal.value.copy(sunDirection).normalize();
      focusedDirection.value.set(focus.x, focus.y, focus.z).normalize();
      closeAmount.value = activeDestinationId ? THREE.MathUtils.clamp(zoom, 0, 1) : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      globe.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
