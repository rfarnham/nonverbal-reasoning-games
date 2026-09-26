import * as THREE from "three";
import type { Vec3 } from "./globe-geometry.ts";
import { createCelestialFrame } from "./globe-celestial-frame.ts";

export const CELESTIAL_SKY_RADIUS = 9;
export const CELESTIAL_STAR_COUNT = 11_800;
const galacticNormal = new THREE.Vector3(.955, .23, .187).normalize();

/** A seeded catalogue, fixed to the celestial sphere rather than the planet.
 * The extra galactic stars follow a thick, irregular belt; there is no grid or
 * spiral sampling pattern that would become visible when the camera moves. */
export function createCelestialStarCatalogue() {
  let state = 0x8ca31e27;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const positions = new Float32Array(CELESTIAL_STAR_COUNT * 3);
  const colors = new Float32Array(CELESTIAL_STAR_COUNT * 3);
  const sizes = new Float32Array(CELESTIAL_STAR_COUNT);
  const brightness = new Float32Array(CELESTIAL_STAR_COUNT);
  const east = new THREE.Vector3().crossVectors(galacticNormal, new THREE.Vector3(0, 1, 0)).normalize();
  const north = new THREE.Vector3().crossVectors(galacticNormal, east).normalize();
  const point = new THREE.Vector3();
  const spectralColors = [new THREE.Color("#abcaff"), new THREE.Color("#e6edff"), new THREE.Color("#fff1d8"), new THREE.Color("#ffd4aa")];
  for (let index = 0; index < CELESTIAL_STAR_COUNT; index++) {
    const angle = random() * Math.PI * 2;
    if (index < 7600) {
      const latitude = random() * 2 - 1;
      const ring = Math.sqrt(1 - latitude * latitude);
      point.set(Math.cos(angle) * ring, latitude, Math.sin(angle) * ring);
    } else {
      // Summed uniforms form a soft belt without clipping a Gaussian tail.
      const latitude = (random() + random() + random() - 1.5) * .17;
      const wobble = Math.sin(angle * 3 + .8) * .025 + Math.sin(angle * 7) * .012;
      point.copy(east).multiplyScalar(Math.cos(angle)).addScaledVector(north, Math.sin(angle))
        .addScaledVector(galacticNormal, latitude + wobble).normalize();
    }
    point.multiplyScalar(CELESTIAL_SKY_RADIUS - .08).toArray(positions, index * 3);
    const magnitude = random();
    const bright = magnitude > .994;
    sizes[index] = bright ? 7 + random() * 8 : magnitude > .91 ? 2.6 + random() * 2.1 : 1.1 + random() * 1.5;
    brightness[index] = bright ? .9 + random() * .35 : .22 + magnitude * .7;
    const color = spectralColors[Math.min(3, Math.floor(random() * 4))];
    color.toArray(colors, index * 3);
  }
  return { positions, colors, sizes, brightness };
}

const noiseGlsl = /* glsl */`
  float hash(vec3 p) {
    p = fract(p * .3183099 + vec3(.11,.17,.13));
    p *= 17.;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float cloud(vec3 p) {
    float sum = 0., weight = .53;
    for (int octave=0; octave<5; octave++) {
      sum += noise3(p) * weight;
      p = p.yzx * 2.07 + vec3(13.7,7.3,5.1);
      weight *= .47;
    }
    return sum;
  }
`;

/** A rigid inertial sky seen from the planet-bound reference frame. Two bounded
 * draws, no textures, wall clocks, callbacks or runtime assets. Depth is real so
 * the globe and moon occlude it. Lighting presets affect visibility, while the
 * shared scenery clock still advances the apparent daily rotation. */
export function createGlobeCelestialSky(scene: THREE.Scene, camera: THREE.Camera, globe: THREE.Group, anchor: Vec3) {
  const frame = createCelestialFrame(anchor);
  const group = new THREE.Group();
  group.name = "Fixed celestial sphere";
  group.visible = false;
  scene.add(group);
  const visibility = { value: 0 };
  const nebulaGeometry = new THREE.SphereGeometry(CELESTIAL_SKY_RADIUS, 32, 24);
  const nebulaMaterial = new THREE.ShaderMaterial({
    name: "Night nebula and galactic dust",
    uniforms: { nightVisibility: visibility, galacticNormal: { value: galacticNormal } },
    vertexShader: /* glsl */`
      varying vec3 skyDirection;
      void main() {
        skyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float nightVisibility;
      uniform vec3 galacticNormal;
      varying vec3 skyDirection;
      ${noiseGlsl}
      void main() {
        vec3 direction = normalize(skyDirection);
        vec3 p = direction * 4.8;
        float broad = cloud(p + vec3(7.2,1.3,5.1));
        float detail = cloud(p * 3.8 + broad * 1.8);
        float altitude = dot(direction,galacticNormal);
        float warped = altitude + (broad-.5)*.3;
        float belt = exp(-pow(warped/.24,2.));
        float envelope = .6 + .4*noise3(direction*2.3+11.);
        float wisps = smoothstep(.24,.69,broad) * (.4+.6*detail);
        float density = belt * wisps * envelope;
        float fineCloud = smoothstep(.35,.7,detail);
        // Broken cold dust obscures the bright cloud interior, giving the band
        // depth and negative space instead of a painted rainbow gradient.
        float dust = exp(-pow((altitude+(detail-.5)*.25+.025)/.039,2.));
        dust *= smoothstep(.26,.7,broad);
        float cyanPocket = exp(-7.*(1.-dot(direction,normalize(vec3(.22,-.24,-.945)))));
        float rosePocket = exp(-9.*(1.-dot(direction,normalize(vec3(.13,.49,-.862)))));
        float bluePocket = exp(-8.*(1.-dot(direction,normalize(vec3(.38,-.35,-.86)))));
        vec3 tint = mix(vec3(.18,.09,.46),vec3(.025,.48,.47),cyanPocket*.98);
        tint = mix(tint,vec3(.68,.075,.29),rosePocket*.90);
        tint = mix(tint,vec3(.21,.27,.71),bluePocket*.68);
        vec3 space = vec3(.0018,.0038,.013);
        vec3 emission = tint * density * .78;
        emission += vec3(.40,.53,.67) * density * fineCloud * .36;
        emission *= 1.-dust*.89;
        space += emission + vec3(.009,.008,.028)*belt;
        gl_FragColor = vec4(space,nightVisibility);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide, transparent: true, depthTest: true, depthWrite: false, fog: false,
  });
  const nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
  nebula.name = "Static luminous nebula";
  nebula.renderOrder = -1000;
  nebula.frustumCulled = false;
  group.add(nebula);

  const catalogue = createCelestialStarCatalogue();
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(catalogue.positions, 3));
  starGeometry.setAttribute("starColor", new THREE.BufferAttribute(catalogue.colors, 3));
  starGeometry.setAttribute("starSize", new THREE.BufferAttribute(catalogue.sizes, 1));
  starGeometry.setAttribute("starBrightness", new THREE.BufferAttribute(catalogue.brightness, 1));
  const starMaterial = new THREE.ShaderMaterial({
    name: "Fixed spectral stars",
    uniforms: { nightVisibility: visibility },
    vertexShader: /* glsl */`
      attribute vec3 starColor;
      attribute float starSize;
      attribute float starBrightness;
      varying vec3 color;
      varying float brightness;
      varying float sparkle;
      void main() {
        color = starColor;
        brightness = starBrightness;
        sparkle = step(6.,starSize);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
        gl_PointSize = starSize * 1.8;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float nightVisibility;
      varying vec3 color;
      varying float brightness;
      varying float sparkle;
      void main() {
        vec2 p = gl_PointCoord*2.-1.;
        float radius = length(p);
        float core = exp(-radius*radius*12.);
        float glow = exp(-radius*radius*5.)*.13;
        float rays = (exp(-abs(p.x)*65.) + exp(-abs(p.y)*65.)) * pow(max(0.,1.-radius),2.) * .2 * sparkle;
        float alpha = (core+glow+rays) * (.6+brightness*.9) * nightVisibility;
        if(alpha < .005) discard;
        gl_FragColor = vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.name = "Spectral celestial star field";
  stars.frustumCulled = false;
  stars.renderOrder = -999;
  group.add(stars);
  let disposed = false;
  return {
    update(seconds: number, nightVisibility: number) {
      if (disposed) return;
      const amount = Number.isFinite(nightVisibility) ? THREE.MathUtils.clamp(nightVisibility, 0, 1) : 0;
      visibility.value = amount;
      group.visible = amount > 0;
      camera.getWorldPosition(group.position);
      frame.update(seconds, globe.quaternion, group.quaternion);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      nebulaGeometry.dispose(); nebulaMaterial.dispose();
      starGeometry.dispose(); starMaterial.dispose();
    },
  };
}
