import * as THREE from "three";
import { getGlobeMap, getGlobeRegion, scaleVec3, sphericalAngle, sphericalInterpolate, type Vec3 } from "./globe-geometry.ts";
import { getWorldMapLayout } from "./map-layouts.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";

export const CRYSTAL_STORY_DURATION_MS = 11_000;
/** Planet-local position; the camera can focus here before revealing the globe. */
export const CRYSTAL_STORY_SOURCE: Vec3 = scaleVec3(getGlobeRegion(1).center, 1.125);
export type CrystalShardTarget = Readonly<{
  stopId: string; worldId: string; worldNumber: number; point: Vec3;
  launch: number; arrival: number; height: number;
}>;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** One shard per archipelago, at its authored final (summit) question stop.
 * Ordinary question stops, books and boss tests never receive shards. */
export const CRYSTAL_SHARD_TARGETS: readonly CrystalShardTarget[] = WORLD_DEFINITIONS.map(world => {
  const height = getWorldMapLayout(world.number, world.stopIds.length).landscape === "cliffs" ? 1.032 : 1.022;
  const stops = getGlobeMap(world.number, world.stopIds.length, false, height).stops;
  const index = world.stopIds.length - 1, stopId = world.stopIds[index];
  const phase = ((world.number * 37 + index * 19) % 101) / 101;
  const distance = sphericalAngle(CRYSTAL_STORY_SOURCE, stops[index].point);
  const launch = .235 + phase * .105;
  return { stopId, worldId: world.id, worldNumber: world.number, point: stops[index].point,
    launch, arrival: .7 + phase * .1 + distance / Math.PI * .085,
    height: .16 + distance / Math.PI * .48 + phase * .06 };
});

export function crystalShardFlightProgress(target: CrystalShardTarget, cinematicProgress: number) {
  return clamp((clamp(cinematicProgress) - target.launch) / (target.arrival - target.launch));
}

/** A stylized ballistic arc above the curved planet, rather than a chord through
 * it. The parabolic radial lift is zero at both exact authored endpoints. */
export function sampleCrystalShardFlight(target: CrystalShardTarget, progress: number): Vec3 {
  const t = clamp(progress);
  if (t === 0) return { ...CRYSTAL_STORY_SOURCE };
  if (t === 1) return { ...target.point };
  const startRadius = Math.hypot(CRYSTAL_STORY_SOURCE.x, CRYSTAL_STORY_SOURCE.y, CRYSTAL_STORY_SOURCE.z);
  const endRadius = Math.hypot(target.point.x, target.point.y, target.point.z);
  const radius = startRadius + (endRadius - startRadius) * t + 4 * t * (1 - t) * target.height;
  return sphericalInterpolate(CRYSTAL_STORY_SOURCE, target.point, t, radius);
}

const crystalVertex = `
  varying vec3 facetNormal; varying vec3 towardEye;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.);
    facetNormal = normalize(normalMatrix * normal); towardEye = -view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;
const crystalFragment = `
  uniform float crystalEnergy; varying vec3 facetNormal; varying vec3 towardEye;
  void main() {
    vec3 n = normalize(facetNormal);
    float rim = pow(1. - abs(dot(n, normalize(towardEye))), 2.);
    float facet = pow(max(0., dot(n, normalize(vec3(-.4,.7,.8)))), 3.);
    vec3 blue = mix(vec3(.025,.17,.48), vec3(.23,.94,1.), facet * .6 + rim * .65);
    gl_FragColor = vec4(blue * (1. + crystalEnergy * .7), .30 + rim * .53 + facet * .14);
  }
`;
const arcVertex = `
  attribute float flightT; attribute vec2 flightWindow;
  attribute vec3 flightTangent; attribute float ribbonSide;
  uniform vec2 viewport; uniform float pixelRatio;
  varying float alongArc; varying vec2 timing; varying float acrossRibbon;
  void main() {
    alongArc = flightT; timing = flightWindow; acrossRibbon = ribbonSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position+flightTangent,1.);
    vec2 direction = (ahead.xy/ahead.w-gl_Position.xy/gl_Position.w)*viewport;
    vec2 normal = vec2(-direction.y,direction.x)/max(length(direction),.00001);
    // A three-CSS-pixel ribbon has a deep-blue edge and a luminous core. Its
    // silhouette stays readable against both pale daytime sky and dark water.
    gl_Position.xy += normal*ribbonSide*3.*pixelRatio/viewport*gl_Position.w;
  }
`;
const arcFragment = `
  uniform float storyProgress; varying float alongArc; varying vec2 timing; varying float acrossRibbon;
  void main() {
    float head = clamp((storyProgress-timing.x)/(timing.y-timing.x),0.,1.);
    float appeared = smoothstep(timing.x,timing.x+.015,storyProgress);
    float behind = head-alongArc;
    if (behind < 0. || storyProgress < timing.x) discard;
    float tail = exp(-behind*10.);
    float remembered = .72 * (1.-smoothstep(.84,.96,storyProgress));
    float landed = 1.-smoothstep(timing.y,timing.y+.10,storyProgress);
    float edge = abs(acrossRibbon);
    float alpha = max(tail*landed,remembered)*appeared*(1.-smoothstep(.78,1.,edge));
    vec3 ink = vec3(.018,.105,.28), blue = vec3(.02,.48,.92), light = vec3(.63,.97,1.);
    vec3 color = mix(blue,ink,smoothstep(.35,.8,edge));
    color = mix(color,light,(1.-smoothstep(.12,.38,edge))*(.3+.7*tail));
    gl_FragColor = vec4(color,alpha);
  }
`;

/** Externally clocked cinematic. All resources are allocated once, every pose
 * is a pure function of progress, and null removes the entire effect. */
export function createGlobeCrystalStory(globe: THREE.Group) {
  const root = new THREE.Group(); root.name = "Oceania crystal shattering story"; root.visible = false;
  globe.add(root);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const geometry = <T extends THREE.BufferGeometry>(item: T): T => { geometries.add(item); return item; };
  const material = <T extends THREE.Material>(item: T): T => { materials.add(item); return item; };
  const source = new THREE.Vector3().copy(CRYSTAL_STORY_SOURCE), radial = source.clone().normalize();
  const sourceGroup = new THREE.Group(); sourceGroup.name = "Luminous octahedral weather engine";
  sourceGroup.position.copy(source); sourceGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), radial);
  root.add(sourceGroup);
  const octahedron = geometry(new THREE.OctahedronGeometry(1, 0));
  const crystalMaterial = material(new THREE.ShaderMaterial({ vertexShader: crystalVertex, fragmentShader: crystalFragment,
    uniforms: { crystalEnergy: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const shell = new THREE.Mesh(octahedron, crystalMaterial); shell.scale.set(.061,.092,.061); sourceGroup.add(shell);
  const coreMaterial = material(new THREE.MeshBasicMaterial({ color: 0xd7ffff, transparent: true, opacity: .94, fog: false }));
  const core = new THREE.Mesh(octahedron, coreMaterial); core.scale.set(.018,.042,.018); sourceGroup.add(core);
  const edgeMaterial = material(new THREE.LineBasicMaterial({ color: 0x7ef9ff, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const edges = new THREE.LineSegments(geometry(new THREE.EdgesGeometry(octahedron)), edgeMaterial);
  edges.scale.copy(shell.scale); sourceGroup.add(edges);
  const ringsMaterial = material(new THREE.MeshBasicMaterial({ color: 0x36eaff, transparent: true, opacity: .54, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const ringGeometry = geometry(new THREE.TorusGeometry(1,.008,4,64));
  const rings = [-1,1].map(sign => {
    const ring = new THREE.Mesh(ringGeometry,ringsMaterial); ring.scale.setScalar(.091); ring.position.y = sign*.017;
    ring.rotation.set(Math.PI/2,sign*.17,0); sourceGroup.add(ring); return ring;
  });
  const haloMaterial = material(new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { strength: { value: .8 } }, vertexShader: crystalVertex,
    fragmentShader: `uniform float strength; varying vec3 facetNormal; varying vec3 towardEye;
      void main(){ float rim = pow(1.-abs(dot(normalize(facetNormal),normalize(towardEye))),2.);
      gl_FragColor=vec4(.02,.45,.9,(1.-rim)*strength*.13); }` }));
  const halo = new THREE.Mesh(geometry(new THREE.SphereGeometry(.13,24,16)),haloMaterial); sourceGroup.add(halo);

  // Real zigzag cracks follow the eight triangular crystal faces, and separate
  // facet fragments carry the same glass shader out into the initial burst.
  const cracks: number[] = [], fragments: { mesh: THREE.Mesh; direction: THREE.Vector3 }[] = [];
  const vertices = octahedron.getAttribute("position");
  for (let face=0;face<8;face++) {
    const a=new THREE.Vector3().fromBufferAttribute(vertices,face*3).multiply(shell.scale), b=new THREE.Vector3().fromBufferAttribute(vertices,face*3+1).multiply(shell.scale), c=new THREE.Vector3().fromBufferAttribute(vertices,face*3+2).multiply(shell.scale);
    const centroid=a.clone().add(b).add(c).multiplyScalar(1/3), direction=centroid.clone().normalize();
    const faceGeometry=geometry(new THREE.BufferGeometry().setFromPoints([a,b,c])); faceGeometry.computeVertexNormals();
    const fragment=new THREE.Mesh(faceGeometry,crystalMaterial); fragment.visible=false; sourceGroup.add(fragment); fragments.push({mesh:fragment,direction});
    const crackPoints=[a.clone().lerp(b,.37),centroid.clone().lerp(a,.24),centroid.clone().lerp(c,.2),b.clone().lerp(c,.69)].map(p=>p.multiplyScalar(1.004));
    for(let i=1;i<crackPoints.length;i++)cracks.push(...crackPoints[i-1].toArray(),...crackPoints[i].toArray());
  }
  const cracksMaterial=material(new THREE.LineBasicMaterial({color:0xecffff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
  sourceGroup.add(new THREE.LineSegments(geometry(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(cracks,3))),cracksMaterial));

  // A single GPU draw carries all geodesic arcs; flight windows reveal and fade
  // the immutable paths without rebuilding any geometry during animation.
  const arcPositions: number[]=[],arcTimes:number[]=[],arcWindows:number[]=[],arcTangents:number[]=[],arcSides:number[]=[],arcIndices:number[]=[];
  const samples=40;
  for(const target of CRYSTAL_SHARD_TARGETS) {
    const offset=arcPositions.length/3;
    for(let i=0;i<=samples;i++) {
      const t=i/samples,point=sampleCrystalShardFlight(target,t);
      const before=sampleCrystalShardFlight(target,(i-1)/samples),after=sampleCrystalShardFlight(target,(i+1)/samples);
      for(const side of [-1,1]) {
        arcPositions.push(point.x,point.y,point.z);arcTimes.push(t);arcWindows.push(target.launch,target.arrival);
        arcTangents.push(after.x-before.x,after.y-before.y,after.z-before.z);arcSides.push(side);
      }
      if(i<samples){const start=offset+i*2;arcIndices.push(start,start+1,start+2,start+1,start+3,start+2);}
    }
  }
  const arcGeometry=geometry(new THREE.BufferGeometry());
  arcGeometry.setAttribute("position",new THREE.Float32BufferAttribute(arcPositions,3));
  arcGeometry.setAttribute("flightT",new THREE.Float32BufferAttribute(arcTimes,1));
  arcGeometry.setAttribute("flightWindow",new THREE.Float32BufferAttribute(arcWindows,2));
  arcGeometry.setAttribute("flightTangent",new THREE.Float32BufferAttribute(arcTangents,3));
  arcGeometry.setAttribute("ribbonSide",new THREE.Float32BufferAttribute(arcSides,1));arcGeometry.setIndex(arcIndices);
  const arcMaterial=material(new THREE.ShaderMaterial({vertexShader:arcVertex,fragmentShader:arcFragment,uniforms:{storyProgress:{value:0},viewport:{value:new THREE.Vector2(1,1)},pixelRatio:{value:1}},transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false}));
  const arcs=new THREE.Mesh(arcGeometry,arcMaterial);arcs.name="One luminous flight arc per archipelago summit";arcs.frustumCulled=false;
  arcs.onBeforeRender=renderer=>{renderer.getDrawingBufferSize(arcMaterial.uniforms.viewport.value);arcMaterial.uniforms.pixelRatio.value=renderer.getPixelRatio();};root.add(arcs);

  const shardMaterial=material(new THREE.MeshStandardMaterial({color:0x91efff,emissive:0x2beaff,emissiveIntensity:1.2,metalness:.34,roughness:.18,fog:false}));
  const shards=new THREE.InstancedMesh(octahedron,shardMaterial,CRYSTAL_SHARD_TARGETS.length);shards.name="One fallen crystal shard per archipelago summit";shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);shards.frustumCulled=false;root.add(shards);
  const impactMaterial=material(new THREE.MeshBasicMaterial({color:0x5cecff,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
  const impactGeometry=geometry(new THREE.RingGeometry(.76,1,24));
  const impacts=new THREE.InstancedMesh(impactGeometry,impactMaterial,CRYSTAL_SHARD_TARGETS.length);impacts.name="Crystal landing ripples";impacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);impacts.frustumCulled=false;root.add(impacts);

  const sparkDirections:number[]=[],sparkSeeds:number[]=[];
  for(let i=0;i<256;i++) {const z=1-2*(i+.5)/256,angle=i*2.399963229728653;const radius=Math.sqrt(1-z*z);sparkDirections.push(radius*Math.cos(angle),z,radius*Math.sin(angle));sparkSeeds.push((i*47%257)/257);}
  const sparkGeometry=geometry(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(sparkDirections,3)).setAttribute("sparkSeed",new THREE.Float32BufferAttribute(sparkSeeds,1)));
  const sparkMaterial=material(new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,uniforms:{storyProgress:{value:0},source:{value:source}},
    vertexShader:`attribute float sparkSeed; uniform float storyProgress; uniform vec3 source; varying float alpha; varying float seed;
      void main(){ seed=sparkSeed; float burst=clamp((storyProgress-.21)/.25,0.,1.);
      float distance=.018+burst*(.12+sparkSeed*.2); vec3 p=source+position*distance;
      alpha=smoothstep(.13,.23,storyProgress)*(1.-smoothstep(.25,.49,storyProgress));
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=(2.+sparkSeed*3.)*alpha; }`,
    fragmentShader:`varying float alpha;varying float seed;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
      gl_FragColor=vec4(mix(vec3(.3,.9,1.),vec3(1.,.86,.46),step(.82,seed)),(1.-r*r)*alpha);}` }));
  const sparks=new THREE.Points(sparkGeometry,sparkMaterial);sparks.name="Fracture sparks and crystal dust";sparks.frustumCulled=false;root.add(sparks);

  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),spin=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3();
  const up=new THREE.Vector3(0,1,0),forward=new THREE.Vector3(0,0,1),axis=new THREE.Vector3(.3,.8,.4).normalize();
  let disposed=false, lastPose: number|undefined, lastStatic=false;
  function update(progress: number|null, scattered=false) {
    if(disposed)return;
    root.visible=progress!==null||scattered;if(!root.visible)return;
    const staticMarkers=progress===null,p=staticMarkers?1:clamp(progress!);
    if(lastPose===p&&lastStatic===staticMarkers)return;
    lastPose=p;lastStatic=staticMarkers;
    const burst=clamp((p-.21)/.17),intact=1-clamp((p-.215)/.04);
    root.userData.storyProgress=p;
    crystalMaterial.uniforms.crystalEnergy.value=clamp(p/.22)*2;
    sourceGroup.visible=!staticMarkers&&p<.51;
    arcs.visible=!staticMarkers&&p>=.235&&p<.96;
    sparks.visible=!staticMarkers&&p>.13&&p<.49;
    impacts.visible=!staticMarkers&&p>=.7&&p<.99;
    shards.visible=p>=.235;
    core.rotation.y=-p*4.5;
    shell.visible=p<.24;edges.visible=p<.25;core.visible=p<.34;
    coreMaterial.opacity=intact*.94;edgeMaterial.opacity=intact*.92;
    cracksMaterial.opacity=clamp((p-.04)/.14)*(1-burst);
    ringsMaterial.opacity=.54*(1-burst);haloMaterial.uniforms.strength.value=(.8+clamp(p/.22))*(1-burst);
    rings.forEach((ring,index)=>{ring.rotation.z=p*(index===0?4:-3);ring.scale.setScalar(.091+burst*.18);});
    fragments.forEach(({mesh,direction},index)=>{mesh.visible=p>=.22&&p<.43;mesh.position.copy(direction).multiplyScalar(burst*.18);mesh.rotation.set(burst*(index%3),burst*(index%2?2:-2),burst*.5);mesh.scale.setScalar(1-burst*.9);});
    arcMaterial.uniforms.storyProgress.value=p;sparkMaterial.uniforms.storyProgress.value=p;
    CRYSTAL_SHARD_TARGETS.forEach((target,index)=>{
      const flight=crystalShardFlightProgress(target,p),point=sampleCrystalShardFlight(target,flight),launched=p>=target.launch;
      position.copy(point);rotation.setFromUnitVectors(up,position.clone().normalize());
      spin.setFromAxisAngle(axis,flight*Math.PI*8+index);rotation.multiply(spin);
      const size=launched?(flight===1?.0048:.0075):0;
      scale.set(size*.72,size*1.65,size*.72);matrix.compose(position,rotation,scale);shards.setMatrixAt(index,matrix);
      const impact=clamp((p-target.arrival)/.105),landed=p>=target.arrival;
      position.copy(target.point).multiplyScalar(1.002);rotation.setFromUnitVectors(forward,position.clone().normalize());
      const ripple=landed&&impact<1?.008+impact*.035:0;
      scale.setScalar(ripple*(1-impact));matrix.compose(position,rotation,scale);impacts.setMatrixAt(index,matrix);
    });
    shards.instanceMatrix.needsUpdate=true;impacts.instanceMatrix.needsUpdate=true;
  }
  return {update,dispose(){if(disposed)return;disposed=true;root.removeFromParent();geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());shards.dispose();impacts.dispose();}};
}
