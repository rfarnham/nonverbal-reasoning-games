import * as THREE from "three";
import { GLOBE_BOSS_REGIONS, type Vec3 } from "./globe-geometry.ts";

/** Fractions of the authored ocean footprint. The clear eye fits the smaller
 * storm ship, while every cloud and particle remains inside the same footprint. */
export const GLOBE_STORM_EYE_RADIUS = .24;
export type GlobeStormStages = Readonly<Record<string, number>>;
const TAU = Math.PI * 2;
const random = (index: number) => { const value = Math.sin(index * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };

/** One soft, local pulse, never a repeating flash train. Pausing extinguishes it
 * immediately rather than leaving a bright strike frozen on the screen. */
export function globeHurricaneLightning(seconds: number, stormIndex: number, stage: number, motionEnabled: boolean): number {
  if (!motionEnabled || stage < .65 || !Number.isFinite(seconds)) return 0;
  const period = stormIndex ? 23 : 19, start = stormIndex ? 9 : 3;
  const phase = ((seconds - start) % period + period) % period;
  return phase < 1.15 ? Math.sin(phase / 1.15 * Math.PI) ** 2 * Math.min(1, stage) : 0;
}

const SURFACE_GLSL = /* glsl */ `
  uniform float stormSeconds;
  uniform float stormRadius;
  uniform float stormStage;
  uniform float stormDirection;
  uniform float stormFlash;
  uniform vec3 stormSun;
  uniform float stormFinal;
  vec3 onSea(vec2 p, float height) { return normalize(vec3(p.x, 1.0, p.y)) * (1.0 + height); }
  mat2 turn(float angle) { float c=cos(angle),s=sin(angle); return mat2(c,-s,s,c); }
`;
const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p) {
    vec2 cell=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(cell),hash(cell+vec2(1,0)),f.x),mix(hash(cell+vec2(0,1)),hash(cell+vec2(1)),f.x),f.y);
  }
`;
function instancedGeometry(template: THREE.BufferGeometry, count: number, data: number[], sizes?: number[]) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(template.getIndex());
  for (const [name, attribute] of Object.entries(template.attributes)) geometry.setAttribute(name, attribute.clone());
  geometry.instanceCount = count;
  geometry.setAttribute("stormData", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
  if (sizes) geometry.setAttribute("puffSize", new THREE.InstancedBufferAttribute(new Float32Array(sizes), 3));
  return geometry;
}
function discGeometry() {
  const geometry = new THREE.CircleGeometry(1, 96); geometry.rotateX(-Math.PI / 2); return geometry;
}

/** Smooth implicit union produces one continuous cloud bank. The broad spiral
 * sheets blend into a hollow eyewall; small three-dimensional billows perturb
 * the surface without leaving visible intersecting sphere seams. */
let cachedCloudVolume: Readonly<{ positions: Float32Array; normals: Float32Array }> | undefined;
function cloudVolumeGeometry(data: Readonly<{ positions: Float32Array; normals: Float32Array }>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  return geometry;
}
function hurricaneCloudVolume() {
  if (cachedCloudVolume) return cloudVolumeGeometry(cachedCloudVolume);
  const smoothMin = (a: number, b: number, k: number) => {
    const h = Math.max(0, Math.min(1, .5 + .5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  };
  const field = (x: number, y: number, z: number) => {
    const r = Math.hypot(x, z), angle = Math.atan2(z, x);
    const center = .367 + .012 * Math.sin(angle * 4) + .006 * Math.sin(angle * 9);
    const ring = (Math.hypot((r - center) / .100, (y - .098 - .013 * Math.sin(angle * 5)) / .086) - 1) * .09;
    const t = Math.max(0, Math.min(1, (r - .40) / .52));
    const curl = angle + (r - .41) / .48 * 2.75;
    const distance = Math.acos(Math.max(-1, Math.min(1, Math.cos(curl * 3)))) / 3 * r;
    const width = .113 * (1 - t) + .020;
    const arm = Math.max((Math.hypot(distance / width, (y - (.052 + (1 - t) * .055)) / (.026 + (1 - t) * .061)) - 1) * width,
      .30 - r, r - .93);
    const sheet = Math.max(Math.abs(y - .053) - .032, (r - (.72 + .072 * Math.cos(curl * 3))) * .42, .31 - r);
    const billow = Math.sin(x * 29 + Math.sin(z * 17)) * Math.sin(z * 31 + Math.cos(y * 27)) * Math.sin(y * 39 + x * 13);
    const detail = Math.sin(x * 91 + z * 27) * Math.sin(z * 83 - y * 62) * Math.sin(y * 96 + x * 41);
    return Math.max(smoothMin(smoothMin(ring, arm, .043), sheet, .030) + billow * .016 + detail * .0016, .244 - r, .010 - y);
  };
  const positions: number[] = [], normals: number[] = [];
  type Point = readonly [number, number, number];
  const gradient = (p: Point): Point => {
    const e = .0008, x = field(p[0]+e,p[1],p[2])-field(p[0]-e,p[1],p[2]);
    const y = field(p[0],p[1]+e,p[2])-field(p[0],p[1]-e,p[2]);
    const z = field(p[0],p[1],p[2]+e)-field(p[0],p[1],p[2]-e), length = Math.hypot(x,y,z)||1;
    return [x/length,y/length,z/length];
  };
  const triangle = (a: Point, b: Point, c: Point) => {
    const na=gradient(a),nb=gradient(b),nc=gradient(c);
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    if((u[1]*v[2]-u[2]*v[1])*na[0]+(u[2]*v[0]-u[0]*v[2])*na[1]+(u[0]*v[1]-u[1]*v[0])*na[2]<0){positions.push(...a,...c,...b);normals.push(...na,...nc,...nb);}
    else{positions.push(...a,...b,...c);normals.push(...na,...nb,...nc);}
  };
  const nx=72,ny=18,nz=72,points:Point[]=[],values:number[]=[];
  const at=(x:number,y:number,z:number)=>(x*(ny+1)+y)*(nz+1)+z;
  for(let x=0;x<=nx;x++)for(let y=0;y<=ny;y++)for(let z=0;z<=nz;z++){
    const p:Point=[-.99+x/nx*1.98,-.01+y/ny*.29,-.99+z/nz*1.98];points.push(p);values.push(field(...p));
  }
  const tetrahedra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  for(let x=0;x<nx;x++)for(let y=0;y<ny;y++)for(let z=0;z<nz;z++){
    const cube=[at(x,y,z),at(x+1,y,z),at(x+1,y+1,z),at(x,y+1,z),at(x,y,z+1),at(x+1,y,z+1),at(x+1,y+1,z+1),at(x,y+1,z+1)];
    if(cube.every(i=>values[i]>=0)||cube.every(i=>values[i]<0))continue;
    for(const tetrahedron of tetrahedra){
      const inside=tetrahedron.map(i=>cube[i]).filter(i=>values[i]<0),outside=tetrahedron.map(i=>cube[i]).filter(i=>values[i]>=0);
      const edge=(a:number,b:number):Point=>{const t=values[a]/(values[a]-values[b]);return[points[a][0]+(points[b][0]-points[a][0])*t,points[a][1]+(points[b][1]-points[a][1])*t,points[a][2]+(points[b][2]-points[a][2])*t];};
      if(inside.length===1)triangle(edge(inside[0],outside[0]),edge(inside[0],outside[1]),edge(inside[0],outside[2]));
      else if(inside.length===3)triangle(edge(outside[0],inside[0]),edge(outside[0],inside[1]),edge(outside[0],inside[2]));
      else if(inside.length===2){const ac=edge(inside[0],outside[0]),ad=edge(inside[0],outside[1]),bc=edge(inside[1],outside[0]),bd=edge(inside[1],outside[1]);triangle(ac,ad,bc);triangle(ad,bd,bc);}
    }
  }
  cachedCloudVolume = { positions: new Float32Array(positions), normals: new Float32Array(normals) };
  return cloudVolumeGeometry(cachedCloudVolume);
}

/** A low, broad tropical cyclone: a hollow, rounded eyewall and curved banks of
 * cloud billows above wind-driven rain and whitecaps. All movement uses the
 * caller's scenery clock; no timers, dynamic buffers or external textures. */
export function createGlobeStorms(globe: THREE.Group) {
  const root = new THREE.Group(); root.name = "Ocean hurricane boss passages"; globe.add(root);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const vector = (point: Vec3) => new THREE.Vector3(point.x, point.y, point.z);
  const quad = new THREE.PlaneGeometry(2, 2), disc = discGeometry();
  const cloudGeometry = hurricaneCloudVolume(); geometries.add(cloudGeometry);
  const particleData: number[] = [];
  for (let i = 0; i < 560; i++) particleData.push(.3 + Math.sqrt(random(i + 1701)) * .62, random(i + 701) * TAU, random(i + 2701), random(i + 3701));
  const rainGeometry = instancedGeometry(quad, particleData.length / 4, particleData); geometries.add(rainGeometry);
  const mistData: number[] = [];
  for (let i = 0; i < 160; i++) mistData.push(.25 + random(i + 5101) * .64, random(i + 6101) * TAU, random(i + 7101), random(i + 8101));
  const mistGeometry = instancedGeometry(quad, mistData.length / 4, mistData); geometries.add(mistGeometry);
  geometries.add(disc); quad.dispose();

  const systems = GLOBE_BOSS_REGIONS.map((region, index) => {
    const group = new THREE.Group(); group.name = `${region.id} tropical cyclone`;
    // Use a right-handed local frame: x=east, y=outward, z=south.
    group.matrix.makeBasis(vector(region.east), vector(region.center), vector(region.north).negate()); group.matrixAutoUpdate = false;
    root.add(group);
    const uniforms = {
      stormSeconds: { value: 0 }, stormRadius: { value: Math.tan(region.angularRadius) }, stormStage: { value: 0 },
      stormDirection: { value: index ? -1 : 1 }, stormFlash: { value: 0 },
      stormSun: { value: new THREE.Vector3(.4, .8, .3).normalize() }, stormFinal: { value: index },
    };
    const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order = 0) => {
      materials.add(material); const mesh = new THREE.Mesh(geometry, material); mesh.name = `${region.id} ${name}`;
      mesh.frustumCulled = false; mesh.renderOrder = order; group.add(mesh); return mesh;
    };
    add("storm sea and curling whitecaps", disc, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `${SURFACE_GLSL}
        varying vec2 seaPoint; varying vec3 seaNormal;
        void main(){
          seaPoint=position.xz;
          vec2 p=seaPoint*stormRadius*(.55+.45*stormStage);
          vec3 point=onSea(p,.003);
          seaNormal=normalize(point);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
        }`,
      fragmentShader: /* glsl */ `${SURFACE_GLSL}${NOISE_GLSL}
        varying vec2 seaPoint; varying vec3 seaNormal;
        void main(){
          float radius=length(seaPoint);float angle=atan(seaPoint.y,seaPoint.x);
          float wave=sin(radius*112.0-angle*5.0-stormSeconds*stormDirection*1.9+noise(seaPoint*12.0)*3.0);
          float broken=noise(turn(-stormSeconds*.014*stormDirection)*seaPoint*53.0);
          float foam=smoothstep(.68,.98,wave)*smoothstep(.45,.78,broken);
          foam*=smoothstep(.12,.34,radius)*(1.0-smoothstep(.80,1.0,radius));
          float daylight=smoothstep(-.14,.30,dot(seaNormal,stormSun));
          vec3 deep=mix(vec3(.008,.035,.079),mix(vec3(.018,.145,.20),vec3(.03,.12,.20),stormFinal),daylight);
          vec3 tint=mix(deep,vec3(.61,.83,.87)*(.42+daylight*.58),foam*.87);
          tint+=vec3(.10,.20,.28)*pow(max(0.0,broken-.57),2.0)*4.0;
          tint+=vec3(.20,.33,.46)*stormFlash*.14*(1.0-radius);
          float alpha=(1.0-smoothstep(.67,1.0,radius))*stormStage*.84;
          gl_FragColor=vec4(tint,alpha);
        }`,
    }), 1);
    add("feathered cirrus spiral underlayer", disc, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `${SURFACE_GLSL}
        varying vec2 cloudSheetPoint;
        void main(){
          cloudSheetPoint=position.xz;
          vec3 point=onSea(position.xz*stormRadius*(.45+.55*stormStage),.009);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
        }`,
      fragmentShader: /* glsl */ `${SURFACE_GLSL}${NOISE_GLSL}
        varying vec2 cloudSheetPoint;
        void main(){
          float radius=length(cloudSheetPoint);
          float angle=atan(cloudSheetPoint.y,cloudSheetPoint.x)+stormSeconds*.042*stormDirection;
          float curl=angle+(radius-.41)/.48*2.75;
          float arm=pow(.5+.5*cos(curl*3.0),3.0);
          vec2 advected=turn(-stormSeconds*.024*stormDirection)*cloudSheetPoint;
          float cloudNoise=noise(advected*26.0)*.54+noise(advected*61.0)*.30+noise(advected*121.0)*.16;
          float density=smoothstep(.28,.77,cloudNoise+arm*.26);
          float mask=smoothstep(.235,.29,radius)*(1.0-smoothstep(.79,.99,radius));
          float daylight=smoothstep(-.17,.26,stormSun.y);
          vec3 tint=mix(vec3(.18,.27,.42),vec3(.66,.79,.86),daylight);
          float alpha=density*mask*stormStage*(.17+arm*.39);
          gl_FragColor=vec4(tint,alpha);
        }`,
    }), 1);
    add("rounded spiral cloud banks and open eyewall", cloudGeometry, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: true,
      vertexShader: /* glsl */ `${SURFACE_GLSL}
        varying vec3 billowNormal; varying vec3 billowPoint; varying vec3 billowViewNormal; varying vec3 billowViewDirection;
        varying float puffSeed; varying float puffHeight;
        void main(){
          float growth=.45+.55*stormStage;
          float radius=length(position.xz);
          float angle=stormSeconds*stormDirection*(.042+(1.0-radius)*.017);
          mat2 rotation=turn(angle);
          vec2 horizontal=rotation*position.xz*stormRadius*growth;
          float height=position.y*stormRadius*growth*(.54+.46*stormStage);
          vec3 point=onSea(horizontal,max(.006,height));
          vec2 rotatedNormal=rotation*normal.xz;
          billowNormal=normalize(vec3(rotatedNormal.x,normal.y,rotatedNormal.y));
          billowViewNormal=normalMatrix*billowNormal;billowViewDirection=-(modelViewMatrix*vec4(point,1.0)).xyz;
          billowPoint=point;puffSeed=.5+.5*sin(position.x*17.0+position.z*23.0);puffHeight=normal.y;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
        }`,
      fragmentShader: /* glsl */ `${SURFACE_GLSL}
        varying vec3 billowNormal; varying vec3 billowPoint; varying vec3 billowViewNormal; varying vec3 billowViewDirection;
        varying float puffSeed; varying float puffHeight;
        void main(){
          vec3 normal=normalize(billowNormal);
          float daylight=smoothstep(-.17,.26,dot(normalize(billowPoint),stormSun));
          float light=dot(normal,stormSun)*.5+.5;
          float top=smoothstep(-.38,.82,puffHeight);
          vec3 shadow=mix(vec3(.10,.18,.28),vec3(.18,.20,.34),stormFinal);
          vec3 bright=mix(vec3(.87,.94,.98),vec3(.90,.91,.99),stormFinal);
          vec3 tint=mix(shadow,bright,clamp(.25+light*.26+top*.39,0.0,1.0));
          tint*=mix(vec3(.23,.35,.53),vec3(1.0),daylight);
          tint+=vec3(.035,.055,.07)*puffSeed;
          vec2 location=billowPoint.xz/stormRadius;
          float localFlash=exp(-length(location-vec2(.38,-.30))*4.8)*stormFlash;
          tint=mix(tint,vec3(.72,.84,1.0),localFlash*.69);
          float facing=abs(dot(normalize(billowViewNormal),normalize(billowViewDirection)));
          float opacity=smoothstep(.015,.34,facing)*(.28+.67*stormStage);
          if(opacity<.025)discard;
          gl_FragColor=vec4(tint,opacity);
        }`,
    }), 2);
    add("slanting vortex rain curtains", rainGeometry, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `${SURFACE_GLSL}
        attribute vec4 stormData;varying vec2 dropUv;varying float dropLight;
        void main(){
          float fall=fract(stormData.z+stormSeconds*(.47+stormData.w*.18));
          float angle=stormData.y-stormDirection*(stormSeconds*.13+fall*.13);
          vec2 radial=vec2(cos(angle),sin(angle)),tangent=vec2(-radial.y,radial.x);
          float radius=stormData.x*stormRadius*(.55+.45*stormStage);
          vec2 p=radial*radius+tangent*(position.x*.00038+position.y*.0019*stormDirection);
          float height=.007+(1.0-fall)*stormRadius*.31+position.y*(.0025+stormData.w*.0031);
          vec3 point=onSea(p,max(.004,height));
          gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
          dropUv=uv;dropLight=smoothstep(-.17,.25,dot(normalize(point),stormSun));
        }`,
      fragmentShader: /* glsl */ `${SURFACE_GLSL}
        varying vec2 dropUv;varying float dropLight;
        void main(){
          float alpha=sin(dropUv.y*3.14159)*(.12+dropLight*.17)*stormStage*stormStage;
          gl_FragColor=vec4(mix(vec3(.25,.47,.69),vec3(.65,.86,.94),dropLight),alpha);
        }`,
    }), 3);
    add("windborne spray and flying foam particles", mistGeometry, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `${SURFACE_GLSL}
        attribute vec4 stormData;varying vec2 mistUv;varying float mistLife;varying float mistDay;
        void main(){
          float life=fract(stormData.z+stormSeconds*(.10+stormData.w*.06));
          float angle=stormData.y-stormDirection*(stormSeconds*(.19+stormData.w*.11)+life*.15);
          float radius=(stormData.x+sin(life*3.14159)*.025)*stormRadius*(.55+.45*stormStage);
          vec3 point=onSea(vec2(cos(angle),sin(angle))*radius,.005+sin(life*3.14159)*stormRadius*.046);
          vec4 view=modelViewMatrix*vec4(point,1.0);
          view.xy+=position.xy*vec2(.0015+stormData.w*.0018,.00065+stormData.w*.00055);
          gl_Position=projectionMatrix*view;mistUv=uv;mistLife=sin(life*3.14159);
          mistDay=smoothstep(-.17,.25,dot(normalize(point),stormSun));
        }`,
      fragmentShader: /* glsl */ `${SURFACE_GLSL}
        varying vec2 mistUv;varying float mistLife;varying float mistDay;
        void main(){
          float alpha=(1.0-smoothstep(.18,.50,length(mistUv-.5)))*mistLife*stormStage*.71;
          gl_FragColor=vec4(mix(vec3(.30,.48,.68),vec3(.82,.94,.97),mistDay),alpha);
        }`,
    }), 4);
    // A forked discharge sits at the visible outer eyewall. Its rare soft pulse
    // also lights the surrounding cloud, rather than flashing the entire globe.
    const boltPositions: number[] = [];
    const paths = [[[.075,.063],[.067,.050],[.073,.037],[.062,.022],[.063,.009]],[[.071,.044],[.085,.032],[.079,.023]]];
    for (const path of paths) for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1], width = .00065;
      for (const p of [[ax-width,ay],[ax+width,ay],[bx-width,by],[bx-width,by],[ax+width,ay],[bx+width,by]]) boltPositions.push(p[0],p[1],-.06);
    }
    const boltGeometry = new THREE.BufferGeometry(); boltGeometry.setAttribute("position", new THREE.Float32BufferAttribute(boltPositions,3)); geometries.add(boltGeometry);
    add("occasional local lightning fork", boltGeometry, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `${SURFACE_GLSL}
        void main(){vec3 point=onSea(position.xz*stormRadius/.19,position.y*stormRadius/.19);gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);}`,
      fragmentShader: /* glsl */ `${SURFACE_GLSL}
        void main(){gl_FragColor=vec4(.72,.88,1.0,stormFlash*.86);}`,
    }), 5);
    const inverseFrame = group.matrix.clone().invert();
    return { group, region, uniforms, inverseFrame };
  });
  let disposed = false;
  return {
    update(seconds: number, focus: Vec3, _zoom: number, activeDestinationId: string, stages: GlobeStormStages, motionEnabled: boolean, sunDirection?: THREE.Vector3) {
      if (disposed) return;
      for (const [index, system] of systems.entries()) {
        const stage = THREE.MathUtils.clamp(Number.isFinite(stages[system.region.id]) ? stages[system.region.id] : 0, 0, 1);
        const facing = system.region.center.x * focus.x + system.region.center.y * focus.y + system.region.center.z * focus.z;
        system.group.visible = stage > 0 && (facing > -.32 || activeDestinationId === system.region.id);
        system.uniforms.stormStage.value = stage;
        system.uniforms.stormSeconds.value = Number.isFinite(seconds) ? seconds : 0;
        system.uniforms.stormFlash.value = globeHurricaneLightning(seconds, index, stage, motionEnabled);
        if (sunDirection) system.uniforms.stormSun.value.copy(sunDirection).transformDirection(system.inverseFrame);
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      globe.remove(root); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
      root.clear();
    },
  };
}
