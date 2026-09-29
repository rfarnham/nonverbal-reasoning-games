import * as THREE from "three";
import type { Vec3 } from "./globe-geometry.ts";

/** Deliberately storybook scale: a real sphere following a planet-local orbit. */
export const GLOBE_MOON_RADIUS = .19;
export const GLOBE_MOON_ORBIT_RADIUS = 1.9;
export const GLOBE_MOON_ORBIT_SECONDS = 224;
const TAU = Math.PI * 2;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const safeSeconds = (seconds: number) => Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

function orbitBasis(anchor: Vec3) {
  const front = new THREE.Vector3(anchor.x, anchor.y, anchor.z).normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(front);
  if (east.lengthSq() < .0001) east.set(1, 0, 0);
  east.normalize();
  const north = front.clone().cross(east).normalize();
  // Start beyond the upper-left limb, including in the narrow overview.
  const start = front.clone().multiplyScalar(-.45).addScaledVector(east, -.62).addScaledVector(north, .64).normalize();
  const tangent = east.clone().addScaledVector(north, -.36).addScaledVector(front, .5);
  tangent.addScaledVector(start, -tangent.dot(start)).normalize();
  return { start, tangent };
}

/** Pure pose sampling: paused time gives the identical orbit, including at reload. */
export function sampleGlobeMoonOrbit(seconds: number, anchor: Vec3, target = new THREE.Vector3()) {
  const { start, tangent } = orbitBasis(anchor);
  const angle = safeSeconds(seconds) / GLOBE_MOON_ORBIT_SECONDS * TAU;
  return target.copy(start).multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle)).multiplyScalar(GLOBE_MOON_ORBIT_RADIUS);
}

/** Directional sunlight and the actual camera-to-moon line determine the phase. */
export function getMoonIlluminatedFraction(moonPosition: Vec3, sunDirection: Vec3, observerPosition: Vec3): number {
  const light = new THREE.Vector3(sunDirection.x, sunDirection.y, sunDirection.z).normalize();
  const observer = new THREE.Vector3(observerPosition.x - moonPosition.x, observerPosition.y - moonPosition.y, observerPosition.z - moonPosition.z).normalize();
  return clamp((1 + light.dot(observer)) / 2);
}

type Crater = Readonly<{ center: THREE.Vector3; angularRadius: number; depth: number; rays: boolean }>;
const craters: readonly Crater[] = Array.from({ length: 96 }, (_, index) => {
  const y = 1 - 2 * (index + .5) / 96;
  const longitude = index * Math.PI * (3 - Math.sqrt(5));
  const radial = Math.sqrt(1 - y*y);
  const large = index % 11 === 0;
  const angularRadius = large ? .18 + (index % 3) * .021 : .042 + ((index * 37) % 19) / 19 * .084;
  return { center: new THREE.Vector3(Math.cos(longitude)*radial, y, Math.sin(longitude)*radial), angularRadius, depth: angularRadius * (large ? .19 : .16), rays: index % 17 === 0 };
});
const maria = [
  { center: new THREE.Vector3(.18,.36,.92).normalize(), radius: .54 },
  { center: new THREE.Vector3(-.60,.34,.73).normalize(), radius: .37 },
  { center: new THREE.Vector3(.73,-.29,.61).normalize(), radius: .26 },
  { center: new THREE.Vector3(-.16,.53,-.83).normalize(), radius: .47 },
  { center: new THREE.Vector3(.74,-.24,-.63).normalize(), radius: .31 },
];

function noiseHash(x: number, y: number, z: number) {
  let hash = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const tx = x - ix, ty = y - iy, tz = z - iz;
  const u = tx*tx*(3-2*tx), v = ty*ty*(3-2*ty), w = tz*tz*(3-2*tz);
  const mix = (a: number, b: number, t: number) => a+(b-a)*t;
  return mix(mix(mix(noiseHash(ix,iy,iz),noiseHash(ix+1,iy,iz),u), mix(noiseHash(ix,iy+1,iz),noiseHash(ix+1,iy+1,iz),u),v),
    mix(mix(noiseHash(ix,iy,iz+1),noiseHash(ix+1,iy,iz+1),u), mix(noiseHash(ix,iy+1,iz+1),noiseHash(ix+1,iy+1,iz+1),u),v),w);
}
const smooth = (low: number, high: number, value: number) => { const t = clamp((value-low)/(high-low)); return t*t*(3-2*t); };

/** One continuous displaced shell: raised crater rims, sunken bowls and hills. */
export function createGlobeMoonGeometry() {
  const geometry = new THREE.SphereGeometry(1, 160, 112);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count*3), relief = new Float32Array(position.count*2), craterData = new Float32Array(position.count*4);
  const normal = new THREE.Vector3();
  const highland = new THREE.Color(0xc8c6bc), mare = new THREE.Color(0x576578), ejecta = new THREE.Color(0xf6efde), color = new THREE.Color();
  for (let index = 0; index < position.count; index++) {
    normal.fromBufferAttribute(position,index).normalize();
    const grain = noise3(normal.x*39+71,normal.y*39+13,normal.z*39+23);
    const highlandNoise = noise3(normal.x*9+31,normal.y*9+13,normal.z*9+19);
    let mareAmount = 0;
    for (const basin of maria) {
      const distance = Math.acos(clamp(normal.dot(basin.center),-1,1));
      mareAmount = Math.max(mareAmount,1-smooth(basin.radius*.55,basin.radius + (highlandNoise-.5)*.15,distance));
    }
    let height = (highlandNoise-.5)*.009 + (grain-.5)*.003 - mareAmount*.012;
    let nearestCrater: Crater | undefined, nearestRatio = 1.16;
    let rimLight = 0, bowlShade = 0, rays = 0;
    for (const crater of craters) {
      // A squared chord rejection avoids almost all inverse cosines.
      const cosine = normal.dot(crater.center);
      if (cosine < Math.cos(crater.angularRadius*(crater.rays ? 3.3 : 1.5))) continue;
      const distance = Math.acos(clamp(cosine,-1,1));
      const r = distance/crater.angularRadius;
      if (r < nearestRatio) { nearestRatio = r; nearestCrater = crater; }
      if (r < 1.48) {
        const bowl = r < .96 ? -crater.depth * Math.pow(Math.max(0,1-r*r),1.35) : 0;
        const rim = crater.depth*.43*Math.exp(-Math.pow((r-1.02)/.15,2));
        const centralPeak = crater.angularRadius > .17 ? crater.depth*.29*Math.exp(-Math.pow(r/.19,2)) : 0;
        height += bowl + rim + centralPeak;
        rimLight = Math.max(rimLight,Math.exp(-Math.pow((r-1.05)/.23,2))*.32);
        bowlShade = Math.max(bowlShade,(1-smooth(.45,.98,r))*.28);
      }
      if (crater.rays && r > 1 && r < 3.3) {
        const theta = Math.atan2(normal.z-crater.center.z,normal.x-crater.center.x);
        const spikes = Math.pow(Math.max(0,Math.cos(theta*13.0+Math.sin(theta*7.0)*1.2)),12);
        rays = Math.max(rays,spikes * (1-smooth(1.15,3.3,r))*.31);
      }
    }
    const radius = 1+height;
    position.setXYZ(index,normal.x*radius,normal.y*radius,normal.z*radius);
    color.copy(highland).lerp(mare,mareAmount*.83).lerp(ejecta,clamp(rimLight+rays));
    color.multiplyScalar(.89+grain*.17-bowlShade*.42);
    colors.set([color.r,color.g,color.b],index*3);
    relief.set([1-bowlShade,grain],index*2);
    if (nearestCrater) craterData.set([...nearestCrater.center.toArray(),nearestCrater.angularRadius],index*4);
  }
  geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  geometry.setAttribute("lunarRelief",new THREE.BufferAttribute(relief,2));
  geometry.setAttribute("lunarCrater",new THREE.BufferAttribute(craterData,4));
  geometry.computeVertexNormals();
  // Sphere UV seams duplicate vertices. Average the same physical edge/poles so
  // grazing light cannot reveal a longitude seam or an unused zero normal.
  const normals = geometry.getAttribute("normal"), mergedNormal = new THREE.Vector3();
  const stride = 161;
  for (let row = 1; row < 112; row++) {
    const first = row*stride, last = first+160;
    mergedNormal.fromBufferAttribute(normals,first).add(normal.fromBufferAttribute(normals,last)).normalize();
    normals.setXYZ(first,mergedNormal.x,mergedNormal.y,mergedNormal.z);
    normals.setXYZ(last,mergedNormal.x,mergedNormal.y,mergedNormal.z);
  }
  for (const row of [0,112]) {
    mergedNormal.set(0,0,0);
    for (let column = 0; column <= 160; column++) mergedNormal.add(normal.fromBufferAttribute(normals,row*stride+column));
    mergedNormal.normalize();
    for (let column = 0; column <= 160; column++) normals.setXYZ(row*stride+column,mergedNormal.x,mergedNormal.y,mergedNormal.z);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGlobeMoon(scene: THREE.Scene, globe: THREE.Group, camera: THREE.Camera, anchor: Vec3) {
  const geometry = createGlobeMoonGeometry();
  const uniforms = {
    lunarSun: { value: new THREE.Vector3(1,0,0) },
    lunarEarth: { value: new THREE.Vector3(0,0,-1) },
    lunarNight: { value: 0 },
    lunarLocalSun: { value: new THREE.Vector3(1,0,0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexColors: true, depthTest: true, depthWrite: true,
    vertexShader: `
      attribute vec2 lunarRelief;
      attribute vec4 lunarCrater;
      varying vec4 moonCrater;
      varying vec3 moonLocal;
      varying vec3 moonColor;
      varying vec3 moonNormal;
      varying vec3 moonPoint;
      varying vec2 moonRelief;
      void main() {
        moonColor = color;
        moonCrater = lunarCrater;
        moonLocal = position;
        moonRelief = lunarRelief;
        moonNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position,1.);
        moonPoint = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 lunarSun;
      uniform vec3 lunarEarth;
      uniform float lunarNight;
      uniform vec3 lunarLocalSun;
      varying vec4 moonCrater;
      varying vec3 moonLocal;
      varying vec3 moonColor;
      varying vec3 moonNormal;
      varying vec3 moonPoint;
      varying vec2 moonRelief;
      void main() {
        vec3 n = normalize(moonNormal);
        vec3 view = normalize(cameraPosition-moonPoint);
        float direct = max(0.,dot(n,lunarSun));
        // Grazing sunlight lights raised rims and leaves the opposite crater
        // walls dark. There is no phase mask: the displaced normal is the light.
        float craterShadow = 1.;
        if (moonCrater.w > .025 && length(moonCrater.xyz) > .95) {
          vec3 c = normalize(moonCrater.xyz);
          float angularRadius = moonCrater.w;
          vec3 q = moonLocal-c*dot(moonLocal,c);
          float rimDepth = angularRadius * (angularRadius > .17 ? .19 : .16);
          float rimRadius = sin(angularRadius)*(1.+rimDepth*.43);
          vec3 tangentLight = lunarLocalSun-c*dot(lunarLocalSun,c);
          float a = dot(tangentLight,tangentLight);
          float b = dot(q,tangentLight);
          float d = dot(q,q)-rimRadius*rimRadius;
          if (a > .0001 && d < 0.) {
            float toRim = (-b+sqrt(max(0.,b*b-a*d)))/a;
            float rayHeight = dot(moonLocal,c)+toRim*dot(lunarLocalSun,c);
            float rimHeight = (1.+rimDepth*.43)*cos(angularRadius);
            craterShadow = smoothstep(rimHeight-.003,rimHeight+.0015,rayHeight);
          }
        }
        float sunlight = pow(direct,.88)*craterShadow;
        float earth = max(0.,dot(n,lunarEarth));
        vec3 daylight = vec3(1.11,1.04,.92) * sunlight * 1.12;
        vec3 earthshine = vec3(.12,.185,.32) * (.10+.24*earth) * moonRelief.x * mix(.65,1.,lunarNight);
        float ridge = pow(max(0.,dot(n,normalize(lunarSun+view))),36.) * direct;
        vec3 surface = moonColor * (daylight+earthshine) + vec3(1.,.88,.64)*ridge*.055;
        gl_FragColor = vec4(surface,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry,material);
  mesh.name = "Orbiting cratered moon";
  mesh.scale.setScalar(GLOBE_MOON_RADIUS);
  mesh.visible = false;
  scene.add(mesh);
  const { start, tangent } = orbitBasis(anchor);
  const orbitNormal = start.clone().cross(tangent).normalize();
  const localPosition = new THREE.Vector3(), worldSun = new THREE.Vector3(), worldOrbitNormal = new THREE.Vector3();
  const facing = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3();
  const basis = new THREE.Matrix4(), inverseMoon = new THREE.Quaternion();
  let disposed = false;
  return {
    update(seconds: number, sunDirection: THREE.Vector3, nightVisibility: number) {
      if (disposed) return;
      const angle = safeSeconds(seconds)/GLOBE_MOON_ORBIT_SECONDS*TAU;
      localPosition.copy(start).multiplyScalar(Math.cos(angle)).addScaledVector(tangent,Math.sin(angle)).multiplyScalar(GLOBE_MOON_ORBIT_RADIUS);
      mesh.position.copy(localPosition).applyQuaternion(globe.quaternion);
      // Tidal orientation is genuine sphere rotation, not a camera-facing card.
      facing.copy(mesh.position).negate().normalize();
      worldOrbitNormal.copy(orbitNormal).applyQuaternion(globe.quaternion);
      east.crossVectors(worldOrbitNormal,facing).normalize();
      north.crossVectors(facing,east).normalize();
      basis.makeBasis(east,north,facing);
      mesh.quaternion.setFromRotationMatrix(basis);
      worldSun.copy(sunDirection).applyQuaternion(globe.quaternion).normalize();
      uniforms.lunarSun.value.copy(worldSun);
      uniforms.lunarEarth.value.copy(facing);
      uniforms.lunarLocalSun.value.copy(worldSun).applyQuaternion(inverseMoon.copy(mesh.quaternion).invert());
      uniforms.lunarNight.value = clamp(Number.isFinite(nightVisibility) ? nightVisibility : 0);
      mesh.visible = true;
      mesh.userData.illuminatedFraction = getMoonIlluminatedFraction(mesh.position,worldSun,camera.position);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(mesh);
      geometry.dispose(); material.dispose();
    },
  };
}
