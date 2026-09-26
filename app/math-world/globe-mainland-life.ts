import * as THREE from "three";
import { GLOBE_CONTINENTS, continentPointToGlobe, type ContinentPoint } from "./globe-continent-data.ts";
import { mainlandDetailSite, mainlandHeightAt, mainlandMountainRelief } from "./globe-mainland-geography.ts";

export type MainlandAnimal = Readonly<{ continent:number; species:"deer"|"rabbit"|"sheep"; point:ContinentPoint; heading:number; size:number; phase:number }>;
const hash=(n:number)=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
/** Deterministic family groups give each meadow a habitat rather than random dots. */
export const MAINLAND_ANIMALS: readonly MainlandAnimal[] = GLOBE_CONTINENTS.flatMap((_,continent)=>{
  const result:MainlandAnimal[]=[];
  for(let herd=0;herd<5;herd++) {
    const species=(['deer','rabbit','sheep','deer','rabbit'] as const)[herd];
    for(let search=0;search<180;search++) {
      const seed=continent*911+herd*137+search*7;
      const center:ContinentPoint=[(hash(seed)-.5)*.75,(hash(seed+1)-.5)*.72];
      if(!mainlandDetailSite(continent,center,.035)||mainlandMountainRelief(continent,center)>.012||result.some(a=>Math.hypot(a.point[0]-center[0],a.point[1]-center[1])<.075))continue;
      for(let member=0;member<(species==='rabbit'?5:4);member++) {
        const angle=member*2.399+hash(seed+3)*Math.PI*2, radius=member===0?0:.012+member*.004;
        const point:ContinentPoint=[center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius];
        if(!mainlandDetailSite(continent,point,.023))continue;
        result.push({continent,species,point,heading:hash(seed+member+4)*Math.PI*2,size:(species==='rabbit'?.0075:.0115)*(member===3?.74:1+hash(seed+member+7)*.17),phase:hash(seed+member+11)*Math.PI*2});
      }
      break;
    }
  }
  return result;
});
type Cached=Record<string,{array:Float32Array;size:number}>;
const cache=new Map<string,Cached>();
const cachedGeometry=(key:string,build:()=>THREE.BufferGeometry)=>{
  let data=cache.get(key);
  if(!data){const built=build();data={};for(const [name,attribute]of Object.entries(built.attributes))data[name]={array:attribute.array as Float32Array,size:attribute.itemSize};cache.set(key,data);built.dispose();}
  const geometry=new THREE.BufferGeometry();for(const [name,attribute]of Object.entries(data))geometry.setAttribute(name,new THREE.BufferAttribute(attribute.array,attribute.size));geometry.computeBoundingSphere();return geometry;
};

type AnimalPart={geometry:THREE.BufferGeometry;color:THREE.Color;head:number};
function animalModel(species:MainlandAnimal['species']):AnimalPart[] {
  const parts:AnimalPart[]=[];
  const ellipsoid=(at:readonly[number,number,number],size:readonly[number,number,number],color:number,head=0,tilt=0)=>{
    const geometry=new THREE.SphereGeometry(1,7,4).toNonIndexed();geometry.scale(...size);geometry.rotateZ(tilt);geometry.translate(...at);parts.push({geometry,color:new THREE.Color(color),head});
  };
  const branch=(a:readonly[number,number,number],b:readonly[number,number,number],radius:number,color:number,head=0)=>{
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av),geometry=new THREE.CylinderGeometry(radius*.63,radius,delta.length(),6,1).toNonIndexed();
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));geometry.translate(...av.add(bv).multiplyScalar(.5).toArray());parts.push({geometry,color:new THREE.Color(color),head});
  };
  if(species==='deer') {
    ellipsoid([-.09,.64,0],[.56,.27,.23],0xb68146); // tapered torso
    ellipsoid([-.08,.55,0],[.47,.12,.205],0xead5a4);
    ellipsoid([-.40,.70,0],[.22,.28,.25],0xb0773f);
    for(const z of [-.15,.15])for(const x of [-.41,.27]) {
      branch([x,.56,z],[x+(x<0?.075:-.025),.24,z],.040,0xad743e);
      branch([x+(x<0?.075:-.025),.24,z],[x+.015,.06,z],.026,0xc69865);
      ellipsoid([x+.035,.043,z],[.070,.040,.044],0x473d34);
    }
    ellipsoid([.38,.84,0],[.145,.33,.14],0xb68146,1,-.30);
    ellipsoid([.51,1.11,0],[.25,.13,.125],0xc89961,1,-.16);
    ellipsoid([.69,1.075,0],[.105,.077,.089],0xddbc89,1);
    ellipsoid([.78,1.082,0],[.038,.046,.058],0x3b342c,1);
    for(const z of [-.095,.095]) {
      ellipsoid([.42,1.28,z*1.6],[.075,.16,.036],0xc79661,1,z<0?.43:-.18);
      ellipsoid([.53,1.155,z*1.19],[.026,.029,.016],0x232b24,1);
      // Swept antlers branch in silhouette, with distinct tines and a real fork.
      branch([.35,1.22,z],[.27,1.52,z*1.6],.022,0x826440,1);
      branch([.27,1.52,z*1.6],[.40,1.69,z*2.0],.016,0x96794e,1);
      branch([.29,1.43,z*1.45],[.10,1.54,z*2.0],.013,0x96794e,1);
      branch([.31,1.57,z*1.8],[.26,1.71,z*2.2],.011,0xa1875c,1);
    }
    ellipsoid([-.62,.79,0],[.16,.075,.080],0xe9d1a2,0,-.60);
  } else if(species==='rabbit') {
    ellipsoid([-.15,.28,0],[.43,.30,.26],0xc2ac8e);
    ellipsoid([-.28,.28,0],[.25,.31,.29],0xb6a085);
    ellipsoid([.29,.48,0],[.22,.20,.19],0xd4c4a9,1);
    ellipsoid([.45,.40,0],[.11,.080,.14],0xf0e5cf,1);
    for(const z of [-.13,.13]) {
      ellipsoid([.20,.83,z*.65],[.072,.32,.047],0xd3c0a1,1,z<0?.19:-.13);
      ellipsoid([.20,.85,z*.65+.033],[.033,.235,.012],0xbb9291,1,z<0?.19:-.13);
      ellipsoid([.36,.52,z*1.27],[.030,.035,.017],0x262f2a,1);
      ellipsoid([.30,.070,z],[.17,.069,.080],0xe1d2b8);
      ellipsoid([-.25,.065,z*1.50],[.21,.073,.10],0xc7b596);
    }
    ellipsoid([.535,.427,0],[.028,.027,.044],0x9c7a71,1);
    ellipsoid([-.52,.34,0],[.145,.14,.14],0xf5eee1);
  } else {
    ellipsoid([-.04,.61,0],[.55,.33,.30],0xe5dfbd);
    for(let tuft=0;tuft<9;tuft++){const angle=tuft*Math.PI*2/9;ellipsoid([-.34+tuft%3*.29,.65+Math.sin(angle)*.15,Math.cos(angle)*.16],[.23,.22,.20],tuft%3?0xf1eacd:0xd6d4ae);}
    for(const z of [-.17,.17])for(const x of [-.36,.30]) {branch([x,.46,z],[x,.065,z],.040,0x7e7460);ellipsoid([x+.035,.050,z],[.085,.046,.050],0x4b4940);}
    ellipsoid([.46,.74,0],[.16,.22,.16],0xc6bb93,1,-.28);
    ellipsoid([.59,.69,0],[.20,.11,.13],0x726e59,1,-.24);
    for(const z of [-.19,.19]){ellipsoid([.45,.83,z],[.13,.048,.075],0x9f9574,1,z<0?.22:-.25);ellipsoid([.60,.76,z*.60],[.026,.030,.017],0x202b24,1);}
    ellipsoid([-.56,.58,0],[.16,.070,.070],0xe1d6b2,0,.50);
  }
  return parts;
}
const pivotFor=(species:MainlandAnimal['species'])=>new THREE.Vector3(species==='deer'?.29:species==='rabbit'?.20:.34,species==='deer'?.69:species==='rabbit'?.38:.55,0);
function animalGeometry(species:MainlandAnimal['species']) {
  const model=animalModel(species),arrays={position:[] as number[],normal:[] as number[],color:[] as number[],grazePivot:[] as number[],grazeAxis:[] as number[],grazeData:[] as number[]};
  const up=new THREE.Vector3(0,1,0),position=new THREE.Vector3(),normal=new THREE.Vector3(),root=new THREE.Vector3(),rotation=new THREE.Quaternion(),yaw=new THREE.Quaternion(),scale=new THREE.Vector3(),matrix=new THREE.Matrix4();
  for(const animal of MAINLAND_ANIMALS.filter(a=>a.species===species)) {
    const at=continentPointToGlobe(GLOBE_CONTINENTS[animal.continent],animal.point,mainlandHeightAt(animal.continent,animal.point)+.0003);root.set(at.x,at.y,at.z);
    rotation.setFromUnitVectors(up,root.clone().normalize());yaw.setFromAxisAngle(up,animal.heading);rotation.multiply(yaw);scale.setScalar(animal.size);matrix.compose(root,rotation,scale);
    const pivot=pivotFor(species).applyMatrix4(matrix),axis=new THREE.Vector3(0,0,1).applyQuaternion(rotation);
    for(const part of model) {
      const points=part.geometry.getAttribute('position'),normals=part.geometry.getAttribute('normal');
      const tint=part.color.clone().multiplyScalar(.93+hash(animal.phase)*.14);
      for(let i=0;i<points.count;i++) {
        position.fromBufferAttribute(points,i).applyMatrix4(matrix);normal.fromBufferAttribute(normals,i).applyQuaternion(rotation);
        arrays.position.push(position.x,position.y,position.z);arrays.normal.push(normal.x,normal.y,normal.z);arrays.color.push(tint.r,tint.g,tint.b);
        arrays.grazePivot.push(pivot.x,pivot.y,pivot.z);arrays.grazeAxis.push(axis.x,axis.y,axis.z);arrays.grazeData.push(part.head,animal.phase);
      }
    }
  }
  for(const part of model)part.geometry.dispose();
  const geometry=new THREE.BufferGeometry();for(const [name,array]of Object.entries(arrays))geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,name==='grazeData'?2:3));return geometry;
}
function flowerGeometry() {
  const positions:number[]=[],colors:number[]=[];
  const v=new THREE.Vector3(),normal=new THREE.Vector3(),rotation=new THREE.Quaternion(),source=new THREE.SphereGeometry(1,4,2).toNonIndexed();
  for(let continent=0;continent<GLOBE_CONTINENTS.length;continent++)for(let meadow=0;meadow<24;meadow++) {
    const seed=continent*737+meadow*61, center:ContinentPoint=[(hash(seed)-.5)*.79,(hash(seed+1)-.5)*.78];
    if(!mainlandDetailSite(continent,center,.025)||mainlandMountainRelief(continent,center)>.008)continue;
    for(let flower=0;flower<11;flower++) {
      const angle=flower*2.399,spread=Math.sqrt(flower)*.0028,p:ContinentPoint=[center[0]+Math.cos(angle)*spread,center[1]+Math.sin(angle)*spread];
      if(!mainlandDetailSite(continent,p))continue;
      const at=continentPointToGlobe(GLOBE_CONTINENTS[continent],p,mainlandHeightAt(continent,p)+.0013),origin=new THREE.Vector3(at.x,at.y,at.z);normal.copy(origin).normalize();rotation.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
      const tint=new THREE.Color([0xffd45e,0xf6f0d7,0xe9abd0,0xad97de][(meadow+continent)%4]);
      for(let petal=0;petal<5;petal++) {
        const a=petal*Math.PI*2/5,points=source.getAttribute('position');
        for(let vertex=0;vertex<points.count;vertex++){v.fromBufferAttribute(points,vertex);v.multiply(new THREE.Vector3(.00080,.00030,.00050));v.x+=Math.cos(a)*.00069;v.z+=Math.sin(a)*.00069;v.applyQuaternion(rotation).add(origin);positions.push(v.x,v.y,v.z);colors.push(tint.r,tint.g,tint.b);}
      }
    }
  }
  source.dispose();const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();return geometry;
}
/** Four merged meshes: all animals share sculpted models, all flowers share a meadow batch. */
export function createMainlandLife(group:THREE.Group) {
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],objects:THREE.Mesh[]=[];
  const seconds={value:0};
  for(const species of ['deer','rabbit','sheep'] as const) {
    const geometry=cachedGeometry(species,()=>animalGeometry(species));geometries.push(geometry);
    const patch=(shader:THREE.WebGLProgramParametersWithUniforms)=>{
      shader.uniforms.mainlandTime=seconds;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 grazePivot; attribute vec3 grazeAxis; attribute vec2 grazeData; uniform float mainlandTime;
        vec3 grazeRotate(vec3 v,vec3 axis,float angle){return v*cos(angle)+cross(axis,v)*sin(angle)+axis*dot(axis,v)*(1.-cos(angle));}`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        float grazeAngle=-(.42+.42*sin(mainlandTime*.35+grazeData.y))*grazeData.x*${species==='rabbit'?'.20':'1.0'};
        objectNormal=grazeRotate(objectNormal,grazeAxis,grazeAngle);`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        float bodyGrazeAngle=-(.42+.42*sin(mainlandTime*.35+grazeData.y))*grazeData.x*${species==='rabbit'?'.20':'1.0'};
        transformed=grazePivot+grazeRotate(transformed-grazePivot,grazeAxis,bodyGrazeAngle);
        ${species==='rabbit'?'transformed+=normalize(grazePivot)*pow(max(0.,sin(mainlandTime*.66+grazeData.y)-.84),2.)*.095;':''}`);
    };
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});material.onBeforeCompile=patch;material.customProgramCacheKey=()=>`mainland-${species}-graze-v1`;materials.push(material);
    const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depth.onBeforeCompile=patch;depth.customProgramCacheKey=()=>`mainland-${species}-graze-depth-v1`;materials.push(depth);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`Mainland ${species} families`;mesh.customDepthMaterial=depth;mesh.userData.mainlandSolidProp=true;group.add(mesh);objects.push(mesh);
  }
  const flowers=cachedGeometry('flowers',flowerGeometry),material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9});geometries.push(flowers);materials.push(material);
  const meadow=new THREE.Mesh(flowers,material);meadow.name='Mainland wildflower meadows';meadow.userData.mainlandSolidProp=true;meadow.userData.castShadow=false;group.add(meadow);objects.push(meadow);
  let disposed=false;
  return {update(time:number){if(!disposed)seconds.value=Number.isFinite(time)?time:0;},dispose(){if(disposed)return;disposed=true;for(const object of objects)group.remove(object);for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();}};
}
