import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGlobeStorms, GLOBE_STORM_EYE_RADIUS, globeHurricaneLightning } from '../app/math-world/globe-storms.ts';
import { GLOBE_BOSS_REGIONS, GLOBE_LAND_OBSTACLES, sphericalAngle } from '../app/math-world/globe-geometry.ts';

const direction = point => new THREE.Vector3(point.x,point.y,point.z);

test('hurricanes occupy ocean passages with genuinely hollow eyes and bounded cloud volumes', () => {
  const globe=new THREE.Group(),storms=createGlobeStorms(globe);
  for (const region of GLOBE_BOSS_REGIONS) {
    const group=globe.getObjectByName(`${region.id} tropical cyclone`);
    const cloud=group.children.find(mesh=>mesh.name.includes('rounded spiral'));
    assert.equal(group.children.length,6,'each visible cyclone remains six instanced/procedural draws');
    assert.ok(GLOBE_LAND_OBSTACLES.every(land=>sphericalAngle(land.center,region.center)>region.angularRadius+land.angularRadius),'entire authored storm footprint is in ocean');
    const points=cloud.geometry.getAttribute('position');
    for(let i=0;i<points.count;i++) {
      const radial=Math.hypot(points.getX(i),points.getZ(i));
      assert.ok(radial>=GLOBE_STORM_EYE_RADIUS-1e-6,'eye has real water all the way through the cloud volume');
      assert.ok(radial<1,'every vertex remains inside its ocean footprint while rotating');
      assert.ok(points.getY(i)*Math.tan(region.angularRadius)<.081,'broad satellite-shaped cyclone, not a tall tornado funnel');
    }
    group.updateMatrixWorld(true);
    const pole=new THREE.Vector3(0,1,0).applyMatrix4(group.matrix).normalize();
    assert.ok(pole.distanceTo(direction(region.center))<1e-7,'local ocean patch follows its real globe center');
    assert.ok(group.matrix.determinant()>0,'clouds use a right-handed, outward-facing tangent frame');
  }
  storms.dispose();
});

test('storm appearance is progress supplied and uses only the shared frozen clock', () => {
  const globe=new THREE.Group(),storms=createGlobeStorms(globe),first=GLOBE_BOSS_REGIONS[0];
  const group=globe.getObjectByName(`${first.id} tropical cyclone`),cloud=group.children.find(mesh=>mesh.name.includes('rounded spiral'));
  storms.update(0,first.center,1,first.id,{},true);assert.equal(group.visible,false);
  for (const stage of [.35,.7,1]) {
    storms.update(12,first.center,1,first.id,{[first.id]:stage},true,new THREE.Vector3(1,0,0));
    assert.equal(group.visible,true);assert.equal(cloud.material.uniforms.stormStage.value,stage);
    assert.equal(cloud.material.uniforms.stormSeconds.value,12);
    assert.ok(Math.abs(cloud.material.uniforms.stormSun.value.length()-1)<1e-6);
  }
  const arrays=group.children.flatMap(mesh=>Object.values(mesh.geometry.attributes).map(a=>[a,Array.from(a.array)]));
  storms.update(12,first.center,1,first.id,{[first.id]:1},false);
  assert.equal(cloud.material.uniforms.stormSeconds.value,12,'paused scenery has the same positions');
  assert.equal(cloud.material.uniforms.stormFlash.value,0,'paused/reduced motion cannot freeze a lightning flash');
  for (const [attribute,array] of arrays) assert.deepEqual(Array.from(attribute.array),array,'animation never rewrites CPU vertex buffers');
  storms.update(13,{x:-first.center.x,y:-first.center.y,z:-first.center.z},0,'elsewhere',{[first.id]:1},true);
  assert.equal(group.visible,false,'far hemisphere is also culled before its draw calls');
  storms.dispose();
});

test('lightning is a single smooth local pulse, absent in early gathering and reduced motion', () => {
  assert.equal(globeHurricaneLightning(3.575,0,1,true),1);
  assert.equal(globeHurricaneLightning(3.575,0,.35,true),0);
  assert.equal(globeHurricaneLightning(3.575,0,1,false),0);
  assert.equal(globeHurricaneLightning(NaN,0,1,true),0);
  const active=[];for(let tick=0;tick<1900;tick++)if(globeHurricaneLightning(tick/100,0,1,true)>0)active.push(tick);
  assert.ok(active.length>=113&&active.length<=115);
  assert.equal(active.at(-1)-active[0]+1,active.length,'one contiguous pulse per19seconds, no strobes');
  const rising=Array.from({length:58},(_,i)=>globeHurricaneLightning(3+i*.01,0,1,true));
  assert.ok(rising.every((value,i)=>i===0||value>=rising[i-1]));
});

test('storm resources remain bounded and are disposed exactly once', () => {
  const globe=new THREE.Group(),keep=new THREE.Group();globe.add(keep);
  const storms=createGlobeStorms(globe),resources=new Set();let triangles=0;
  globe.traverse(object=>{if(object.isMesh){resources.add(object.geometry);resources.add(object.material);triangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3*(object.geometry.instanceCount??1);}});
  assert.ok(triangles<130000,'two complete storms share a bounded geometry budget');
  const counts=new Map([...resources].map(r=>[r,0]));for(const resource of resources)resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));
  storms.dispose();storms.dispose();storms.update(100,GLOBE_BOSS_REGIONS[0].center,1,'boss-2025',{'boss-2025':1},true);
  assert.deepEqual(globe.children,[keep]);for(const count of counts.values())assert.equal(count,1);
});
