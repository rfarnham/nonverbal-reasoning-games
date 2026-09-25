import * as THREE from "three";

/** Seamless volume noise samples the sphere directly: there is no longitude seam,
 * polar pinch, or planet-wide periodic wave stripe. */
export function createGlobeOcean() {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: 0x1386a2, roughness: 0.34, metalness: 0.04 });
  material.name = "Deep ocean with wind ripples";
  material.onBeforeCompile = shader => {
    shader.uniforms.seaTime = time;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 seaPoint;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nseaPoint = position;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 seaPoint;
      uniform float seaTime;
      float seaHash(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float seaNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(mix(seaHash(i),seaHash(i+vec3(1,0,0)),f.x),mix(seaHash(i+vec3(0,1,0)),seaHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(seaHash(i+vec3(0,0,1)),seaHash(i+vec3(1,0,1)),f.x),mix(seaHash(i+vec3(0,1,1)),seaHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float seaHeight(vec3 p) {
        return seaNoise(p*145. + vec3(seaTime*.23,0.,seaTime*.16))*.66
          + seaNoise(p*293. + vec3(-seaTime*.31,seaTime*.12,0.))*.34;
      }
    `).replace("#include <color_fragment>", `#include <color_fragment>
      float seaDepth = seaNoise(seaPoint*6.7);
      diffuseColor.rgb *= .87 + .18*seaDepth;
    `).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      vec3 sphereNormal = normalize(seaPoint);
      vec3 seaEast = normalize(cross(abs(sphereNormal.y) > .95 ? vec3(1,0,0) : vec3(0,1,0),sphereNormal));
      vec3 seaNorth = cross(sphereNormal,seaEast);
      float seaBase = seaHeight(seaPoint);
      vec2 seaSlope = vec2(seaHeight(seaPoint+seaEast*.0018)-seaBase, seaHeight(seaPoint+seaNorth*.0018)-seaBase);
      normal = normalize(normal - mat3(viewMatrix)*mat3(modelMatrix)*(seaEast*seaSlope.x+seaNorth*seaSlope.y)*.28);
    `);
    // modelMatrix is a vertex-stage built-in; supply the globe's normal transform
    // via the existing view normal instead of requiring a fragment model matrix.
    shader.fragmentShader = shader.fragmentShader.replace("mat3(viewMatrix)*mat3(modelMatrix)", "seaRotation");
    shader.uniforms.seaRotation = rotation;
    shader.fragmentShader = shader.fragmentShader.replace("uniform float seaTime;", "uniform float seaTime; uniform mat3 seaRotation;");
  };
  const rotation = { value: new THREE.Matrix3() };
  const model = new THREE.Matrix4(), viewModel = new THREE.Matrix4();
  return {
    material,
    update(seconds: number, globe: THREE.Group, camera: THREE.Camera) {
      time.value = Number.isFinite(seconds) ? seconds : 0;
      rotation.value.setFromMatrix4(viewModel.multiplyMatrices(camera.matrixWorldInverse, model.makeRotationFromQuaternion(globe.quaternion)));
    },
    dispose() { material.dispose(); },
  };
}
