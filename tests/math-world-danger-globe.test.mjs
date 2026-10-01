import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLOBE_DANGER_LOCATIONS } from '../app/math-world/globe-danger-locations.ts';
import { createGlobeDangers, globeSquallLightning } from '../app/math-world/globe-dangers.ts';
import {
  GLOBE_DANGER_REGIONS, GLOBE_DESTINATIONS, GLOBE_BOSS_REGIONS, GLOBE_LAND_OBSTACLES,
  GLOBE_VOYAGE_CLEARANCE, getGlobeDestination, getVoyageRoute, sphericalAngle,
  distanceToSurfaceArc, sampleSurfaceRoute,
} from '../app/math-world/globe-geometry.ts';

test('sixteen distinct sea encounters leave all teaching geography and hurricanes intact', () => {
  assert.equal(GLOBE_DESTINATIONS.length, 34);
  assert.equal(GLOBE_DANGER_REGIONS.length, 16);
  assert.deepEqual(GLOBE_DANGER_LOCATIONS.map(d => d.afterWorld), Array.from({length:16},(_,i)=>(i+1)*2));
  assert.deepEqual(GLOBE_DANGER_LOCATIONS.map(d => d.kind), ['squall','kraken','maelstrom','fog','reef','squall','kraken','icebergs','maelstrom','icebergs','fog','reef','squall','kraken','maelstrom','icebergs']);
  for(const region of GLOBE_DANGER_REGIONS) {
    assert.equal(getGlobeDestination(region.id),region);
    assert.ok(Math.abs(Math.hypot(...Object.values(region.center))-1)<1e-10);
    assert.ok(region.angularRadius<GLOBE_BOSS_REGIONS[0].angularRadius/2,'squalls and other dangers are smaller than hurricanes');
    for(const obstacle of [...GLOBE_LAND_OBSTACLES,...GLOBE_BOSS_REGIONS,...GLOBE_DANGER_REGIONS.filter(d=>d!==region)]) {
      assert.ok(sphericalAngle(region.center,obstacle.center)>region.angularRadius+obstacle.angularRadius+.005,`${region.id} clears ${obstacle.id} with its complete footprint`);
    }
  }
});

test('every danger is reachable on a rounded ocean route with full hull clearance', () => {
  const pairs=GLOBE_DANGER_REGIONS.flatMap(region=>[
    [region.afterWorld,region.id],
    [region.id,region.afterWorld===16?'boss-2025':region.afterWorld===32?'boss-2026':region.afterWorld+1],
  ]);
  pairs.push(['danger-02','danger-32']);
  for(const [from,to] of pairs) {
    const route=getVoyageRoute(from,to);
    assert.deepEqual(route[0],getGlobeDestination(from).harbor);
    assert.deepEqual(route.at(-1),getGlobeDestination(to).harbor);
    for(let i=1;i<route.length;i++) for(const obstacle of GLOBE_LAND_OBSTACLES) {
      assert.ok(distanceToSurfaceArc(obstacle.center,route[i-1],route[i])>=obstacle.angularRadius+GLOBE_VOYAGE_CLEARANCE-1e-8,`${from} → ${to} never clips ${obstacle.id}`);
    }
    const midpoint=sampleSurfaceRoute(route,.5);
    assert.ok(Math.abs(Math.hypot(midpoint.x,midpoint.y,midpoint.z)-1)<1e-10);
  }
});

test('danger scenery has bounded, smooth geometry and shares only immutable buffers', () => {
  const globe=new THREE.Group(),dangers=createGlobeDangers(globe),geometries=new Set();
  let draws=0;
  globe.traverse(object=>{
    if(!object.isMesh)return;draws++;geometries.add(object.geometry);
    assert.notEqual(object.geometry.type,'BoxGeometry','creatures and clouds have authored curved forms');
  });
  assert.equal(draws,53,'sixteen varied encounters retain the small draw budget');
  for (const group of globe.children[0].children) assert.ok(group.children.length <= 4, `${group.name} uses at most four draws`);
  let triangles=0;
  for(const geometry of geometries) {
    const positions=geometry.getAttribute('position');
    triangles+=(geometry.index?.count??positions.count)/3;
    for(let index=0;index<positions.count;index++) {
      assert.ok(Number.isFinite(positions.getX(index))&&Number.isFinite(positions.getY(index))&&Number.isFinite(positions.getZ(index)));
      assert.ok(Math.hypot(positions.getX(index),positions.getZ(index))<1,'all mesh geometry stays inside its reserved sea disk');
    }
  }
  assert.ok(triangles<55000,'sixteen hazards share fewer than 55k authored triangles');
  const kraken=globe.getObjectByName('danger-04 kraken');
  assert.ok(kraken.children.some(mesh=>mesh.name.includes('suction cups')));
  assert.ok(kraken.children.some(mesh=>mesh.name.includes('eight sculpted tentacles')));
  dangers.dispose();
});

test('eligibility, shared clock, night lighting, LOD and hemisphere culling are caller controlled', () => {
  const globe=new THREE.Group(),dangers=createGlobeDangers(globe),region=GLOBE_DANGER_REGIONS[0];
  const group=globe.getObjectByName(`${region.id} squall`),cloud=group.children[0];
  dangers.update(4,region.center,1,region.id,{},true);assert.equal(group.visible,false);
  dangers.update(4,region.center,1,region.id,{[region.id]:1},true,new THREE.Vector3(1,0,0));
  assert.equal(group.visible,true);assert.equal(cloud.material.uniforms.dangerSeconds.value,4);
  assert.ok(Math.abs(cloud.material.uniforms.dangerSun.value.length()-1)<1e-8);
  const buffers=group.children.flatMap(mesh=>Object.values(mesh.geometry.attributes).map(attribute=>[attribute,Array.from(attribute.array)]));
  dangers.update(4,region.center,1,region.id,{[region.id]:1},false);
  assert.equal(cloud.material.uniforms.dangerSeconds.value,4);
  assert.equal(cloud.material.uniforms.dangerFlash.value,0);
  for(const [attribute,before] of buffers)assert.deepEqual(Array.from(attribute.array),before);
  dangers.update(4,{x:-region.center.x,y:-region.center.y,z:-region.center.z},0,'elsewhere',{[region.id]:1},true);
  assert.equal(group.visible,false);
  const krakenRegion=GLOBE_DANGER_REGIONS[1],details=globe.getObjectByName(`${krakenRegion.id} suction cups and amber eyes`);
  dangers.update(4,krakenRegion.center,0,krakenRegion.id,{[krakenRegion.id]:1},true);assert.equal(details.visible,false);
  dangers.update(4,krakenRegion.center,1,krakenRegion.id,{[krakenRegion.id]:1},true);assert.equal(details.visible,true);
  dangers.dispose();
});

test('new sea passages have distinct relief and leave the central ship anchorage open', () => {
  const globe=new THREE.Group(),dangers=createGlobeDangers(globe);
  const fogRegion=GLOBE_DANGER_REGIONS.find(region=>region.dangerKind==='fog');
  const fog=globe.getObjectByName(`${fogRegion.id} fog`);
  const veils=fog.children.find(mesh=>mesh.name.includes('layered drifting fog'));
  assert.ok(veils.geometry.isInstancedBufferGeometry);
  assert.ok(veils.geometry.instanceCount>=48,'many fine wisps build the bank without a solid cloud shell');
  for(const mesh of fog.children) {
    assert.equal(mesh.material.transparent,true);
    assert.equal(mesh.material.depthWrite,false,'fog never occludes the ship as an opaque surface');
  }
  for(const [kind,parts] of [['icebergs',['glacier peaks','submerged turquoise']],['reef',['rocky reef arcs','coral gardens']]]) {
    const region=GLOBE_DANGER_REGIONS.find(region=>region.dangerKind===kind);
    const group=globe.getObjectByName(`${region.id} ${kind}`);
    for(const part of parts) {
      const mesh=group.children.find(mesh=>mesh.name.includes(part));
      assert.ok(mesh,`${kind} includes ${part}`);
      const positions=mesh.geometry.attributes.position;
      for(let index=0;index<positions.count;index++) {
        const radius=Math.hypot(positions.getX(index),positions.getZ(index));
        assert.ok(radius>.28,`${part} leaves the central ship and single stop clear`);
        assert.ok(radius<.96,`${part} leaves space for its small drift inside the sea disk`);
      }
    }
  }
  dangers.dispose();
});

test('all six kinds fade their arrival and reuse the paused scenery clock without mutating geometry', () => {
  const globe=new THREE.Group(),dangers=createGlobeDangers(globe);
  for(const kind of new Set(GLOBE_DANGER_REGIONS.map(region=>region.dangerKind))) {
    const region=GLOBE_DANGER_REGIONS.find(region=>region.dangerKind===kind);
    const group=globe.getObjectByName(`${region.id} ${kind}`);
    const before=group.children.flatMap(mesh=>Object.values(mesh.geometry.attributes).map(attribute=>[attribute,Array.from(attribute.array)]));
    dangers.update(37,region.center,1,region.id,{[region.id]:.18},true,new THREE.Vector3(1,0,0));
    assert.equal(group.visible,true);
    for(const mesh of group.children) {
      assert.equal(mesh.material.uniforms.dangerStage.value,.18);
      assert.equal(mesh.material.transparent,true,`${kind} relief blends partial appearance stages`);
      assert.equal(mesh.material.uniforms.dangerSeconds.value,37);
    }
    dangers.update(37,region.center,1,region.id,{[region.id]:.18},false,new THREE.Vector3(-1,0,0));
    for(const mesh of group.children) {
      assert.equal(mesh.material.uniforms.dangerSeconds.value,37,'a stopped shared clock freezes drifting, foam and fog');
      assert.equal(mesh.material.uniforms.dangerFlash.value,0);
    }
    for(const [attribute,previous] of before)assert.deepEqual(Array.from(attribute.array),previous);
    dangers.update(38,region.center,1,region.id,{},true);
    assert.equal(group.visible,false,`${kind} immediately leaves the globe when no longer relevant`);
  }
  dangers.dispose();
});

test('squall lightning uses separated smooth pulses and is absent when scenery is paused', () => {
  let starts=0,previous=0,lastStart=-Infinity;
  for(let tick=0;tick<3000;tick++) {
    const seconds=tick/100,value=globeSquallLightning(seconds,0,true);
    assert.ok(value>=0&&value<=1);
    if(value>0&&previous===0){assert.ok(seconds-lastStart>2.8);lastStart=seconds;starts++;}
    assert.equal(globeSquallLightning(seconds,0,false),0);previous=value;
  }
  assert.ok(starts>=9&&starts<=10);
  for(const seconds of [NaN,Infinity,-1])assert.equal(globeSquallLightning(seconds,0,true),0);
});

test('all danger resources dispose once and leave unrelated scene objects untouched', () => {
  const globe=new THREE.Group(),unrelated=new THREE.Group();globe.add(unrelated);
  const dangers=createGlobeDangers(globe),resources=new Set();
  globe.traverse(object=>{if(object.isMesh){resources.add(object.geometry);resources.add(object.material);}});
  const disposed=new Map([...resources].map(resource=>[resource,0]));
  for(const resource of resources)resource.addEventListener('dispose',()=>disposed.set(resource,disposed.get(resource)+1));
  dangers.dispose();dangers.dispose();dangers.update(10,GLOBE_DANGER_REGIONS[0].center,1,'danger-02',{'danger-02':1},true);
  assert.deepEqual(globe.children,[unrelated]);
  for(const count of disposed.values())assert.equal(count,1);
});
