import * as THREE from "three";
import type { Vec3 } from "./globe-geometry.ts";

/** A continuous body of water: color comes from absorption and reflected sky,
 * not a low-frequency noise texture painted across the sphere. Analytic ripple gradients
 * sample three-dimensional positions, avoiding longitude seams and pole pinches. */
export function createGlobeOcean() {
  const time = { value: 0 }, rotation = { value: new THREE.Matrix3() };
  const sunView = { value: new THREE.Vector3(.4, .8, .3).normalize() };
  const material = new THREE.MeshStandardMaterial({ color: 0x087598, roughness: .28, metalness: 0 });
  material.name = "Open water with wind ripples and reflected sky";
  material.customProgramCacheKey = () => "coherent-ocean-reflections-v4";
  material.onBeforeCompile = shader => {
    shader.uniforms.seaTime = time;
    shader.uniforms.seaRotation = rotation;
    shader.uniforms.seaSunView = sunView;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 seaPoint;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nseaPoint = position;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", /* glsl */ `#include <common>
      varying vec3 seaPoint;
      uniform float seaTime;
      uniform mat3 seaRotation;
      uniform vec3 seaSunView;
      // Quintic noise derivatives give irregular short wavelets, not intersecting
      // periodic bands. Two samples need 16 hashes (the old finite-difference
      // normals needed 48). Screen derivatives remove unresolved micro-detail.
      float seaHash(vec3 p) { p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z); }
      vec3 seaNoiseGradient(vec3 p) {
        vec3 cell=floor(p), f=fract(p);
        vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0);
        vec3 du=30.0*f*f*(f-1.0)*(f-1.0);
        float a=seaHash(cell),b=seaHash(cell+vec3(1,0,0));
        float c=seaHash(cell+vec3(0,1,0)),d=seaHash(cell+vec3(1,1,0));
        float e=seaHash(cell+vec3(0,0,1)),f1=seaHash(cell+vec3(1,0,1));
        float g=seaHash(cell+vec3(0,1,1)),h=seaHash(cell+vec3(1,1,1));
        float x0=mix(a,b,u.x),x1=mix(c,d,u.x),x2=mix(e,f1,u.x),x3=mix(g,h,u.x);
        return vec3(mix(mix(b-a,d-c,u.y),mix(f1-e,h-g,u.y),u.z),
          mix(x1-x0,x3-x2,u.z),mix(x2,x3,u.y)-mix(x0,x1,u.y))*du;
      }
      vec3 seaRipples(vec3 p) {
        vec3 wind=vec3(.744,.145,-.652),crosswind=vec3(-.191,.982,0.),rise=vec3(.640,.125,.758);
        vec3 q=vec3(dot(p,wind)*197.,dot(p,crosswind)*61.,dot(p,rise)*127.)+vec3(seaTime*.22,0.,seaTime*.09);
        float resolved=1.0-smoothstep(.70,1.8,max(length(dFdx(q)),length(dFdy(q))));
        vec3 a=seaNoiseGradient(q);
        vec3 broad=(wind*a.x+crosswind*a.y*.31+rise*a.z*.645)*.085*resolved;
        vec3 fineP=p*373.+vec3(-seaTime*.16,seaTime*.11,seaTime*.07);
        float fineResolved=1.0-smoothstep(.70,1.8,max(length(dFdx(fineP)),length(dFdy(fineP))));
        return broad+seaNoiseGradient(fineP)*.020*fineResolved;
      }
    `).replace("#include <normal_fragment_maps>", /* glsl */ `#include <normal_fragment_maps>
      vec3 sphereNormal = normalize(seaPoint);
      vec3 seaGradient = seaRipples(seaPoint);
      seaGradient -= sphereNormal * dot(seaGradient,sphereNormal);
      normal = normalize(normal - seaRotation*seaGradient);
    `).replace("#include <opaque_fragment>", /* glsl */ `
      vec3 seaRadial = normalize(seaRotation*normalize(seaPoint));
      vec3 seaEye = normalize(vViewPosition);
      vec3 seaReflection = reflect(-seaEye,normal);
      float seaDaylight = smoothstep(-.17,.24,dot(seaRadial,seaSunView));
      float skyElevation = clamp(dot(seaReflection,seaRadial),0.0,1.0);
      vec3 reflectedSky = mix(vec3(.32,.53,.62),vec3(.11,.30,.46),sqrt(skyElevation));
      reflectedSky = mix(vec3(.006,.016,.037),reflectedSky,seaDaylight);
      float sunHaze = pow(max(0.0,dot(seaReflection,seaSunView)),32.0);
      reflectedSky += vec3(.92,.66,.31)*sunHaze*.22*seaDaylight;
      float grazing = pow(1.0-max(0.0,dot(normal,seaEye)),5.0);
      float fresnel = .020 + .98*grazing;
      outgoingLight = mix(outgoingLight,reflectedSky,fresnel*.84);
      #include <opaque_fragment>
    `);
  };
  const model = new THREE.Matrix4(), viewModel = new THREE.Matrix4();
  let disposed = false;
  return {
    material,
    update(seconds: number, globe: THREE.Group, camera: THREE.Camera, sunDirection?: Vec3) {
      if (disposed) return;
      time.value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      rotation.value.setFromMatrix4(viewModel.multiplyMatrices(camera.matrixWorldInverse, model.makeRotationFromQuaternion(globe.quaternion)));
      if (sunDirection) sunView.value.copy(sunDirection).applyMatrix3(rotation.value).normalize();
    },
    dispose() { if (!disposed) { disposed = true; material.dispose(); } },
  };
}
