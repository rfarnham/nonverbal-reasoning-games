import * as THREE from "three";
import type { Vec3 } from "./globe-geometry.ts";
import { createGlobeCelestialSky } from "./globe-celestial-sky.ts";
import { createGlobeMoon } from "./globe-moon.ts";

export type GlobeSkyMode = "cycle" | "day" | "sunset" | "night";
export const SKY_CYCLE_SECONDS = 360;
const up = new THREE.Vector3(0, 1, 0);

/** Presets place the sun relative to the inspected coast. The automatic sun is
 * planet-fixed and advances only with active scenery time, never wall time. */
export function getGlobeSunDirection(seconds: number, mode: GlobeSkyMode, focus: Vec3, anchor: Vec3, target = new THREE.Vector3()) {
  const center = new THREE.Vector3().copy(mode === "cycle" ? anchor : focus).normalize();
  const east = new THREE.Vector3().crossVectors(up, center);
  if (east.lengthSq() < 0.001) east.set(1, 0, 0);
  east.normalize();
  const angle = mode === "cycle" ? 0.62 + Math.max(0, Number.isFinite(seconds) ? seconds : 0) * Math.PI * 2 / SKY_CYCLE_SECONDS
    : mode === "day" ? 0.5 : mode === "sunset" ? 1.55 : 2.65;
  return target.copy(center).multiplyScalar(Math.cos(angle)).addScaledVector(east, Math.sin(angle)).normalize();
}

/** Celestial detail emerges after dusk, not while the sun is on the horizon.
 * This depends on the inspected coast, so turning toward the day side also
 * hides the sky naturally without changing the planet-fixed automatic sun. */
export function getNightSkyVisibility(sunDirection: Vec3, focus: Vec3) {
  const scale = Math.hypot(sunDirection.x, sunDirection.y, sunDirection.z) * Math.hypot(focus.x, focus.y, focus.z);
  if (!Number.isFinite(scale) || scale === 0) return 0;
  const facing = (sunDirection.x*focus.x + sunDirection.y*focus.y + sunDirection.z*focus.z) / scale;
  return 1 - THREE.MathUtils.smoothstep(facing, -.38, -.08);
}

export function createGlobeLighting(scene: THREE.Scene, globe: THREE.Group, camera: THREE.Camera, container: HTMLElement, anchor: Vec3) {
  const ambient = new THREE.HemisphereLight(0xc2e2ff, 0x304450, 0.78);
  const sun = new THREE.DirectionalLight(0xffeed0, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1.18, right: 1.18, top: 1.18, bottom: -1.18, near: 2, far: 6 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.0009;
  sun.shadow.radius = 2;
  const nightFill = new THREE.DirectionalLight(0x8abaff, 0.24);
  scene.add(ambient, sun, nightFill);
  const celestialSky = createGlobeCelestialSky(scene, camera);
  const moon = createGlobeMoon(scene, globe, camera, anchor);
  const sunDirection = new THREE.Vector3();
  const sunWorld = { value: new THREE.Vector3() };
  const time = { value: 0 };
  const patched = new Set<THREE.Material>();
  const fog = new THREE.Fog(0x9acbdc, 1.1, 3.7);
  scene.fog = fog;
  const daySky = new THREE.Color(0xa4d8e8), nightSky = new THREE.Color(0x07132d), duskSky = new THREE.Color(0xd9988c);
  const sky = new THREE.Color(), horizon = new THREE.Color(), horizonLight = new THREE.Color(0xffdfbd);
  let skyStyle = "";

  function installSurfaceLighting() {
    globe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) || patched.has(material)) continue;
        patched.add(material);
        const before = material.onBeforeCompile;
        const previousKey = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          before.call(material, shader, renderer);
          shader.uniforms.planetSun = sunWorld;
          shader.uniforms.planetTime = time;
          shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 planetPoint;")
            .replace("#include <project_vertex>", `#include <project_vertex>
              vec4 planetLocal = vec4(transformed,1.);
              #ifdef USE_INSTANCING
                planetLocal = instanceMatrix * planetLocal;
              #endif
              planetPoint = (modelMatrix * planetLocal).xyz;
            `);
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
            varying vec3 planetPoint; uniform vec3 planetSun; uniform float planetTime;
          `).replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
            float planetDay = smoothstep(-.16,.22,dot(normalize(planetPoint),planetSun));
            reflectedLight.indirectDiffuse *= mix(vec3(.68,.80,1.04),vec3(1.),planetDay);
            reflectedLight.indirectSpecular *= .3 + .7*planetDay;
            totalEmissiveRadiance += diffuseColor.rgb * .035 * (1.-planetDay);
            // Broad, irregular shadows are deliberately very gentle. They drift
            // through the same sunlit surface without obscuring the path.
            vec3 cloudP = normalize(planetPoint)*9.;
            float cloudShade = sin(cloudP.x+planetTime*.011+sin(cloudP.z*1.7))
              * sin(cloudP.y*1.3+cos(cloudP.x*1.2)-planetTime*.008);
            reflectedLight.directDiffuse *= 1.-smoothstep(.30,.85,cloudShade)*.13;
          `);
        };
        material.customProgramCacheKey = () => `${previousKey}-living-planet-v2`;
        material.needsUpdate = true;
      }
      if (materials.some(material => material instanceof THREE.MeshStandardMaterial && !material.transparent)) {
        object.castShadow = object.userData.castShadow !== false;
        object.receiveShadow = object.userData.receiveShadow !== false;
      }
    });
  }

  return {
    sunDirection,
    installSurfaceLighting,
    update(seconds: number, mode: GlobeSkyMode, focus: Vec3, zoom: number) {
      getGlobeSunDirection(seconds, mode, focus, anchor, sunDirection);
      time.value = seconds;
      sunWorld.value.copy(sunDirection).applyQuaternion(globe.quaternion);
      sun.position.copy(sunWorld.value).multiplyScalar(4);
      nightFill.position.copy(sun.position).multiplyScalar(-1);
      const facing = sunDirection.x*focus.x + sunDirection.y*focus.y + sunDirection.z*focus.z;
      const daylight = THREE.MathUtils.smoothstep(facing, -.23, .3);
      const twilight = Math.exp(-Math.pow(facing/.25, 2));
      sky.copy(nightSky).lerp(daySky, daylight).lerp(duskSky, twilight*.4);
      horizon.copy(sky).lerp(horizonLight, daylight*.22 + twilight*.18);
      fog.color.copy(sky);
      // Only distant coastlines soften; overview geography retains its contrast.
      const eyeDistance = camera.position.length();
      fog.near = zoom > .7 ? .8 : eyeDistance + .4;
      fog.far = zoom > .7 ? 2.5 : eyeDistance + 3;
      const nextSky = `radial-gradient(ellipse at 50% 100%, #${horizon.getHexString()}, #${sky.getHexString()} 85%)`;
      if (nextSky !== skyStyle) { container.style.background = nextSky; skyStyle = nextSky; }
      const nightVisibility = getNightSkyVisibility(sunDirection, focus);
      celestialSky.update(seconds, nightVisibility);
      moon.update(seconds, sunDirection, nightVisibility);
    },
    dispose() {
      scene.remove(ambient, sun, nightFill);
      sun.shadow.dispose();
      celestialSky.dispose(); moon.dispose();
      scene.fog = null;
      container.style.removeProperty("background");
    },
  };
}
