import * as THREE from "three";
import type { Vec3 } from "./globe-geometry.ts";
import { northUpGlobeOrientation } from "./globe-navigation.ts";

/** A deliberately composed distant sun, independent of the terrain light's
 * direction. Its world direction starts above the opening globe's right limb
 * and moves through the view as the camera orbits. Composition adapts to aspect
 * ratio, while navigation cannot attach the sun to the viewport.
 * One small procedural draw, with no assets, timers or animated flare. */
export function createGlobeSun(scene: THREE.Scene, camera: THREE.Camera, anchor: Vec3 = { x: 0, y: 0, z: 1 }) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    sunVisibility: { value: 1 },
    sunDirection: { value: new THREE.Vector3() },
    sunHalfSize: { value: new THREE.Vector2(.14, .14) },
  };
  const material = new THREE.ShaderMaterial({
    name: "Distant sun and restrained corona",
    uniforms,
    vertexShader: /* glsl */`
      uniform vec3 sunDirection;
      uniform vec2 sunHalfSize;
      varying vec2 sunPoint;
      void main() {
        sunPoint = position.xy;
        // At the far plane, opaque planet and moon geometry still occlude the
        // entire sun, including its rays. It cannot paint over the foreground.
        vec4 center = projectionMatrix * vec4(mat3(viewMatrix) * sunDirection, 1.);
        if (center.w <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
        gl_Position = vec4(center.xy + position.xy * sunHalfSize * center.w, center.w, center.w);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float sunVisibility;
      varying vec2 sunPoint;
      void main() {
        float radius = length(sunPoint);
        float angle = atan(sunPoint.y, sunPoint.x);
        float disc = 1. - smoothstep(.175, .193, radius);
        float rim = exp(-pow((radius - .185) / .045, 2.)) * .48;
        float corona = exp(-max(0., radius - .18) * 7.5) * .28;
        float rays = pow(abs(cos(angle * 3. + .3)), 28.);
        rays += pow(abs(cos(angle * 5. - .6)), 48.) * .24;
        rays *= exp(-max(0., radius - .21) * 6.5) * .11;
        float edge = 1. - smoothstep(.65, .98, radius);
        float alpha = clamp(disc + rim + corona + rays, 0., 1.) * edge * sunVisibility;
        if (alpha < .003) discard;
        vec3 gold = vec3(1., .43, .12);
        vec3 light = mix(gold, vec3(1., .94, .73), disc);
        gl_FragColor = vec4(light, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
  const sun = new THREE.Mesh(geometry, material);
  sun.name = "Distant scenic sun";
  sun.renderOrder = -998;
  sun.frustumCulled = false;
  scene.add(sun);

  const viewport = new THREE.Vector2();
  const initial = northUpGlobeOrientation(anchor);
  const openingFrame = new THREE.Quaternion(initial.x, initial.y, initial.z, initial.w).invert();
  // Renderer size is in CSS pixels, so retina density and portrait aspect do
  // not enlarge or stretch the disc. Keep a little room beyond the soft halo.
  sun.onBeforeRender = renderer => {
    renderer.getSize(viewport);
    const width = Math.max(1, viewport.x), height = Math.max(1, viewport.y);
    const radius = Math.min(64, width * .135, height * .17);
    uniforms.sunHalfSize.value.set(radius * 2 / width, radius * 2 / height);
    const openingX = Math.min(.74, 1 - (radius + 8) * 2 / width);
    uniforms.sunDirection.value.set(openingX / camera.projectionMatrix.elements[0], .5 / camera.projectionMatrix.elements[5], -1)
      .normalize().applyQuaternion(openingFrame);
  };

  let disposed = false;
  return {
    update(atmosphereBlend: number) {
      if (disposed) return;
      const atmosphere = Number.isFinite(atmosphereBlend) ? THREE.MathUtils.clamp(atmosphereBlend, 0, 1) : 0;
      uniforms.sunVisibility.value = 1 - atmosphere;
      sun.visible = atmosphere < 1;
      // Direction-only projection keeps the source infinitely distant.
      camera.getWorldPosition(sun.position);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(sun);
      geometry.dispose();
      material.dispose();
    },
  };
}
