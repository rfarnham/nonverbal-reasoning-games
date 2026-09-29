import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGlobeStorms, GLOBE_STORM_EYE_RADIUS, globeHurricaneLightning, getGlobeStormStrike } from '../app/math-world/globe-storms.ts';
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

test('lightning visits separated spiral cells frequently with one smooth pulse per discharge', () => {
  for (const storm of [0,1]) {
    const starts=[], peaks=[], quadrants=new Set(), radii=[];
    let previous=0, peak={intensity:0,x:0,z:0}, samples=[];
    for(let tick=0;tick<6000;tick++) {
      const strike=getGlobeStormStrike(tick/100,storm,1,true);
      assert.ok(strike.intensity>=0&&strike.intensity<=1);
      if(strike.intensity>0 && previous===0){starts.push(tick/100);samples=[];peak=strike;}
      if(strike.intensity>0){samples.push(strike.intensity);if(strike.intensity>peak.intensity)peak=strike;}
      if(strike.intensity===0 && previous>0) {
        peaks.push(peak);const top=samples.indexOf(Math.max(...samples));
        assert.ok(samples.slice(0,top+1).every((v,i,a)=>i===0||v>=a[i-1]));
        assert.ok(samples.slice(top).every((v,i,a)=>i===0||v<=a[i-1]),'one smooth pulse, no flash train');
        quadrants.add(Math.floor((Math.atan2(peak.z,peak.x)+Math.PI)/(Math.PI/2)));
        radii.push(Math.hypot(peak.x,peak.z));
      }
      previous=strike.intensity;
    }
    assert.ok(starts.length>=29 && starts.length<=33,'roughly one discharge every two seconds');
    assert.ok(starts.every((start,i)=>i===0||start-starts[i-1]>=1.60),'never rapid strobes');
    assert.equal(quadrants.size,4,'discharges visit the whole hurricane');
    assert.ok(Math.min(...radii)<.45 && Math.max(...radii)>.70,'inner and outer rain bands both light up');
    for(const peak of peaks) assert.ok(Math.hypot(peak.x,peak.z)>.33 && Math.hypot(peak.x,peak.z)<.82);
  }
});

test('lightning is deterministic and absent when gathering, paused, reduced, or given invalid time', () => {
  const target={intensity:0,x:0,z:0,seed:0};
  for(let time=0;time<20;time+=.05) {
    const active=getGlobeStormStrike(time,0,1,true);
    assert.deepEqual(getGlobeStormStrike(time,0,1,true,target),active);
    assert.equal(globeHurricaneLightning(time,0,.35,true),0);
    assert.equal(globeHurricaneLightning(time,0,1,false),0);
  }
  for(const time of [NaN,Infinity,-10]) assert.equal(globeHurricaneLightning(time,0,1,true),0);
  assert.notDeepEqual(getGlobeStormStrike(5,0,1,true),getGlobeStormStrike(5,1,1,true),'storm schedules and cells differ');
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
