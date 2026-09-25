import * as THREE from "three";
import { getGlobeRegion, tangentPointToGlobe, type Vec3 } from "./globe-geometry.ts";

/** These are map accents, deliberately above the back coast rather than over a stop. */
export const GLOBE_RAINBOW_WORLDS = [1, 3, 6, 9, 12, 17, 22, 25, 28] as const;
export const GLOBE_STORM_WORLDS = [9, 25] as const;
export const GLOBE_WIND_WORLDS = [1, 2, 6, 7, 8, 10, 12, 17, 18, 22, 26, 28, 32] as const;

/** One soft pulse, never a repeated strobe. The caller's paused/reduced-motion
 * flag suppresses the bolt even when a saved clock rests inside its window. */
export function globeStormIntensity(seconds: number, stormIndex: number, motionEnabled = true): number {
  if (!motionEnabled || !Number.isFinite(seconds) || seconds < 0) return 0;
  const period = 19 + stormIndex * 4;
  const start = 3 + stormIndex * 7;
  const elapsed = ((seconds - start) % period + period) % period;
  if (elapsed >= 0.85) return 0;
  const rise = THREE.MathUtils.smoothstep(elapsed, 0, 0.14);
  const fall = 1 - THREE.MathUtils.smoothstep(elapsed, 0.22, 0.85);
  return rise * fall;
}

export type GlobeLocalWeather = Readonly<{
  update: (seconds: number, sunDirection: THREE.Vector3, motionEnabled: boolean) => void;
  stormIntensity: THREE.IUniform<THREE.Vector2>;
  dispose: () => void;
}>;

export function createGlobeLocalWeather(parent: THREE.Group, rainOrigins: readonly Vec3[]): GlobeLocalWeather {
  const group = new THREE.Group();
  group.name = "Coastal rainbows, curling wind, and local storms";
  parent.add(group);
  const time = { value: 0 }, sunLocal = { value: new THREE.Vector3(0, 1, 1).normalize() };
  const stormIntensity = { value: new THREE.Vector2() };
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order: number) => {
    geometries.push(geometry); materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.frustumCulled = false; mesh.renderOrder = order;
    group.add(mesh);
  };

  const bowVertices: number[] = [], bowCenters: number[] = [], bowIndices: number[] = [];
  for (const world of GLOBE_RAINBOW_WORLDS) {
    const origin = tangentPointToGlobe(getGlobeRegion(world), 0.005, 0.153, 1);
    const offset = bowVertices.length / 3;
    for (let segment = 0; segment <= 72; segment++) {
      for (const band of [0, 1]) {
        bowVertices.push(segment / 72 * Math.PI, band, 0);
        bowCenters.push(origin.x, origin.y, origin.z);
      }
      if (segment < 72) {
        const i = offset + segment * 2;
        bowIndices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
  }
  const bowGeometry = new THREE.BufferGeometry();
  bowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bowVertices, 3));
  bowGeometry.setAttribute("bowCenter", new THREE.Float32BufferAttribute(bowCenters, 3));
  bowGeometry.setIndex(bowIndices);
  add("Upright sunlit coastal rainbows", bowGeometry, new THREE.ShaderMaterial({
    uniforms: { sunLocal }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 bowCenter;
      uniform vec3 sunLocal;
      varying vec2 bowPoint;
      varying float daylight;
      void main() {
        vec3 normal = normalize(bowCenter);
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
        float radius = 0.061 + position.y * 0.013;
        vec3 point = normal * 1.034 + east * cos(position.x) * radius + normal * sin(position.x) * radius;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        bowPoint = position.xy;
        daylight = smoothstep(-0.03, 0.32, dot(normal, sunLocal));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 bowPoint;
      varying float daylight;
      vec3 spectrum(float t) {
        if (t < 0.2) return mix(vec3(0.44,0.30,0.90),vec3(0.18,0.55,1.0),t/0.2);
        if (t < 0.4) return mix(vec3(0.18,0.55,1.0),vec3(0.18,0.91,0.57),(t-0.2)/0.2);
        if (t < 0.6) return mix(vec3(0.18,0.91,0.57),vec3(1.0,0.91,0.27),(t-0.4)/0.2);
        if (t < 0.8) return mix(vec3(1.0,0.91,0.27),vec3(1.0,0.55,0.17),(t-0.6)/0.2);
        return mix(vec3(1.0,0.55,0.17),vec3(1.0,0.22,0.28),(t-0.8)/0.2);
      }
      void main() {
        float edge = smoothstep(0.0,0.10,bowPoint.y) * (1.0-smoothstep(0.90,1.0,bowPoint.y));
        float feet = smoothstep(0.0,0.22,sin(bowPoint.x));
        float alpha = edge * feet * daylight * 0.72;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(spectrum(bowPoint.y),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }), 8);

  // One instanced curved strip covers every breeze. Its tail turns into a
  // narrowing spiral, so wind is recognizable without particle noise.
  const windGeometry = new THREE.InstancedBufferGeometry();
  const windVertices: number[] = [], windIndices: number[] = [];
  for (let step = 0; step <= 96; step++) {
    const u = step / 96;
    for (const side of [-1, 1]) windVertices.push(u, side, 0);
    if (step < 96) { const i = step * 2; windIndices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  windGeometry.setAttribute("position", new THREE.Float32BufferAttribute(windVertices, 3));
  windGeometry.setIndex(windIndices);
  const windCenters: number[] = [], windSeeds: number[] = [];
  for (const [index, world] of GLOBE_WIND_WORLDS.entries()) {
    for (let ribbon = 0; ribbon < 2; ribbon++) {
      const origin = tangentPointToGlobe(getGlobeRegion(world), -0.005, 0.16 + ribbon * 0.029, 1);
      windCenters.push(origin.x, origin.y, origin.z);
      windSeeds.push((index * 0.193 + ribbon * 0.37) % 1, ribbon);
    }
  }
  windGeometry.instanceCount = windSeeds.length / 2;
  windGeometry.setAttribute("windCenter", new THREE.InstancedBufferAttribute(new Float32Array(windCenters), 3));
  windGeometry.setAttribute("windSeed", new THREE.InstancedBufferAttribute(new Float32Array(windSeeds), 2));
  add("Traveling pale coastal wind curls", windGeometry, new THREE.ShaderMaterial({
    uniforms: { localTime: time, sunLocal }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 windCenter;
      attribute vec2 windSeed;
      uniform float localTime;
      uniform vec3 sunLocal;
      varying float stripEdge;
      varying float windAlpha;
      varying float daylight;
      vec2 curl(float u) {
        if (u < 0.55) return vec2(-0.073+u/0.55*0.083,sin(u/0.55*3.14159)*0.004);
        float turn = (u-0.55)/0.45;
        float angle = -1.570796+turn*7.854;
        float radius = 0.016*(1.0-turn*0.82);
        return vec2(0.010+cos(angle)*radius,0.016+sin(angle)*radius);
      }
      void main() {
        float age = fract(windSeed.x + localTime * (0.090 + windSeed.y*0.007));
        vec3 normal = normalize(windCenter);
        vec3 east = normalize(cross(vec3(0.0,1.0,0.0),normal));
        vec3 north = cross(normal,east);
        vec2 path = curl(position.x);
        vec2 tangent = normalize(curl(min(1.0,position.x+0.002))-curl(max(0.0,position.x-0.002)));
        path += vec2(-tangent.y,tangent.x)*position.y*0.0022*(0.3+0.7*sin(position.x*3.14159));
        path.x += (age-0.5)*0.10;
        vec3 point = normalize(normal+east*path.x+north*path.y)*(1.075+windSeed.y*0.012);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point,1.0);
        stripEdge = position.y;
        windAlpha = smoothstep(0.03,0.22,age)*(1.0-smoothstep(0.69,0.94,age))*0.65;
        windAlpha *= smoothstep(0.0,0.08,position.x)*(1.0-smoothstep(0.92,1.0,position.x));
        daylight = smoothstep(-0.2,0.35,dot(normal,sunLocal));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float stripEdge;
      varying float windAlpha;
      varying float daylight;
      void main() {
        float alpha = (1.0-smoothstep(0.35,1.0,abs(stripEdge)))*windAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(0.44,0.64,0.83),vec3(0.94,0.99,0.94),daylight),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }), 8);

  // Bolts and two small pools of illumination share one buffer/material. There
  // is no point light, fullscreen flash, shadow pass, or dynamic geometry.
  const stormPositions: number[] = [], stormOrigins: number[] = [], stormData: number[] = [];
  const emit = (origin: Vec3, storm: number, kind: number, values: readonly (readonly [number, number, number])[]) => {
    for (const value of values) { stormPositions.push(...value); stormOrigins.push(origin.x, origin.y, origin.z); stormData.push(storm,kind); }
  };
  for (const [storm, origin] of rainOrigins.entries()) {
    const paths = [
      [[-0.006,0.098],[0.004,0.082],[-0.004,0.073],[0.009,0.056],[0.002,0.048],[0.011,0.024]],
      [[0.000,0.078],[-0.015,0.067],[-0.012,0.057],[-0.024,0.043]],
      [[0.009,0.056],[0.021,0.049],[0.019,0.039]],
    ];
    for (const [branch, path] of paths.entries()) for (let i=0;i<path.length-1;i++) {
      const [ax,ay]=path[i], [bx,by]=path[i+1], size=branch===0?0.0011:0.00065;
      const length=Math.hypot(bx-ax,by-ay), dx=-(by-ay)/length*size,dy=(bx-ax)/length*size;
      emit(origin,storm,0,[[ax+dx,ay+dy,0],[ax-dx,ay-dy,0],[bx+dx,by+dy,0],[bx+dx,by+dy,0],[ax-dx,ay-dy,0],[bx-dx,by-dy,0]]);
    }
    const quad = [[-1,-1,0],[1,-1,0],[1,1,0],[-1,-1,0],[1,1,0],[-1,1,0]] as const;
    emit(origin,storm,1,quad); emit(origin,storm,2,quad);
  }
  const stormGeometry = new THREE.BufferGeometry();
  stormGeometry.setAttribute("position",new THREE.Float32BufferAttribute(stormPositions,3));
  stormGeometry.setAttribute("stormOrigin",new THREE.Float32BufferAttribute(stormOrigins,3));
  stormGeometry.setAttribute("stormData",new THREE.Float32BufferAttribute(stormData,2));
  add("Occasional forked lightning and local cloud illumination",stormGeometry,new THREE.ShaderMaterial({
    uniforms:{stormIntensity},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 stormOrigin;
      attribute vec2 stormData;
      uniform vec2 stormIntensity;
      varying vec2 glowPoint;
      varying float glowKind;
      varying float strength;
      void main(){
        vec3 normal=normalize(stormOrigin);
        vec3 east=normalize(cross(vec3(0.0,1.0,0.0),normal));
        vec3 north=cross(normal,east);
        vec3 point=stormOrigin;
        if(stormData.y<0.5)point+=east*position.x+normal*position.y;
        else if(stormData.y>1.5)point=normal*1.029+east*position.x*0.035+north*position.y*0.027;
        else point+=normal*0.088;
        vec4 view=modelViewMatrix*vec4(point,1.0);
        if(stormData.y>0.5&&stormData.y<1.5)view.xy+=position.xy*0.038;
        gl_Position=projectionMatrix*view;
        glowPoint=position.xy;glowKind=stormData.y;
        strength=mix(stormIntensity.x,stormIntensity.y,step(0.5,stormData.x));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 glowPoint;
      varying float glowKind;
      varying float strength;
      void main(){
        float alpha=strength*0.86;
        if(glowKind>0.5)alpha*=pow(max(0.0,1.0-length(glowPoint)),2.0)*0.43;
        if(alpha<0.004)discard;
        gl_FragColor=vec4(vec3(0.83,0.91,1.0),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }),9);

  let disposed=false;
  return {
    stormIntensity,
    update(seconds,sunDirection,motionEnabled){
      if(disposed)return;
      time.value=Number.isFinite(seconds)?Math.max(0,seconds):0;
      if(sunDirection.lengthSq()>0.0001)sunLocal.value.copy(sunDirection).normalize();
      stormIntensity.value.set(globeStormIntensity(seconds,0,motionEnabled),globeStormIntensity(seconds,1,motionEnabled));
    },
    dispose(){
      if(disposed)return;disposed=true;parent.remove(group);
      for(const geometry of geometries)geometry.dispose();
      for(const material of materials)material.dispose();
    },
  };
}
