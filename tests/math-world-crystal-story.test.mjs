import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WORLD_DEFINITIONS } from '../app/math-world/world-data.ts';
import { getGlobeMap, getGlobeRegion } from '../app/math-world/globe-geometry.ts';
import { getWorldMapLayout } from '../app/math-world/map-layouts.ts';
import { CRYSTAL_SHARD_TARGETS, CRYSTAL_STORY_SOURCE, CRYSTAL_STORY_DURATION_MS, sampleCrystalShardFlight, crystalShardFlightProgress, createGlobeCrystalStory } from '../app/math-world/globe-crystal-story.ts';

const radius = point => Math.hypot(point.x, point.y, point.z);
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const close = (a,b,tolerance=1e-10) => assert.ok(Math.abs(a-b)<tolerance, `${a} ≈ ${b}`);

test('crystal fragments map exactly to each authored archipelago summit, not ordinary stops, books or bosses',()=>{
  const expected = WORLD_DEFINITIONS.map(world=>world.stopIds.at(-1));
  assert.equal(new Set(CRYSTAL_SHARD_TARGETS.map(target=>target.stopId)).size,expected.length);
  assert.deepEqual(CRYSTAL_SHARD_TARGETS.map(target=>target.stopId),expected);
  assert.equal(new Set(CRYSTAL_SHARD_TARGETS.map(target=>target.worldId)).size,32);
  for(const world of WORLD_DEFINITIONS){
    const top=getWorldMapLayout(world.number,world.stopIds.length).landscape==='cliffs'?1.032:1.022;
    const points=getGlobeMap(world.number,world.stopIds.length,false,top).stops;
    for(const i of [world.stopIds.length-1]){
      const target=CRYSTAL_SHARD_TARGETS.find(target=>target.stopId===world.stopIds[i]);
      assert.equal(target.worldId,world.id);assert.equal(target.worldNumber,world.number);
      assert.deepEqual(target.point,points[i].point);close(radius(target.point),top);
      assert.ok(target.launch>=.23 && target.launch<.35 && target.arrival>.69 && target.arrival<.9);
    }
  }
  assert.ok(distance(new THREE.Vector3().copy(CRYSTAL_STORY_SOURCE).normalize(),getGlobeRegion(1).center)<1e-10);
  assert.equal(CRYSTAL_STORY_DURATION_MS,11000);
});

test('every ballistic arc has exact deterministic endpoints, finite smooth samples, and clears the whole globe',()=>{
  for(const target of CRYSTAL_SHARD_TARGETS){
    assert.deepEqual(sampleCrystalShardFlight(target,0),CRYSTAL_STORY_SOURCE);
    assert.deepEqual(sampleCrystalShardFlight(target,1),target.point);
    assert.deepEqual(sampleCrystalShardFlight(target,-1),CRYSTAL_STORY_SOURCE);
    assert.deepEqual(sampleCrystalShardFlight(target,2),target.point);
    assert.deepEqual(sampleCrystalShardFlight(target,NaN),CRYSTAL_STORY_SOURCE);
    let previous=sampleCrystalShardFlight(target,0);
    for(let sample=1;sample<=200;sample++){
      const point=sampleCrystalShardFlight(target,sample/200);
      assert.ok(Object.values(point).every(Number.isFinite));
      assert.ok(radius(point)>=radius(target.point)-1e-10,'a global flight is never a chord through land/ocean');
      assert.ok(radius(point)<1.83,'all arcs remain within the cinematic framing envelope');
      assert.ok(distance(point,previous)<.035,'successive positions remain continuous even for the far hemisphere');
      assert.deepEqual(point,sampleCrystalShardFlight(target,sample/200));
      previous=point;
    }
    assert.ok(radius(sampleCrystalShardFlight(target,.5))>radius(CRYSTAL_STORY_SOURCE)+.10);
    close(crystalShardFlightProgress(target,target.launch),0);
    close(crystalShardFlightProgress(target,(target.launch+target.arrival)/2),.5);
    close(crystalShardFlightProgress(target,target.arrival),1);
    close(crystalShardFlightProgress(target,1),1);
  }
});

test('cinematic poses are externally clocked, reversible and bounded, with exactly one final shard at every summit',()=>{
  const globe=new THREE.Group(),keep=new THREE.Group();globe.add(keep);
  const effect=createGlobeCrystalStory(globe),root=globe.getObjectByName('Oceania crystal shattering story');
  const shards=root.getObjectByName('One fallen crystal shard per archipelago summit');
  const arcs=root.getObjectByName('One luminous flight arc per archipelago summit');
  const source=root.getObjectByName('Luminous octahedral weather engine');
  assert.equal(root.visible,false);assert.equal(shards.count,CRYSTAL_SHARD_TARGETS.length);
  assert.equal(arcs.geometry.getAttribute('position').count,CRYSTAL_SHARD_TARGETS.length*41*2);
  assert.equal(arcs.geometry.index.count,32*40*6,'all ribbons fit in 2560 triangles and one draw');
  assert.equal(arcs.material.blending,THREE.NormalBlending,'dark ribbon edges keep contrast on a pale daytime sky');
  assert.equal(arcs.material.depthTest,true);assert.equal(arcs.material.depthWrite,false);
  const objects=[],geometries=new Set(),materials=new Set();
  root.traverse(item=>{objects.push(item);if(item.geometry)geometries.add(item.geometry);if(item.material)materials.add(item.material);});
  assert.ok(objects.length<30);assert.ok(geometries.size<20);assert.ok(materials.size<12);
  const arcBuffer=arcs.geometry.attributes.position.array,originalArc=arcBuffer.slice();
  const sourceQuaternion=source.quaternion.clone();
  effect.update(.57);const middle=shards.instanceMatrix.array.slice();
  effect.update(1);
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  CRYSTAL_SHARD_TARGETS.forEach((target,index)=>{
    shards.getMatrixAt(index,matrix);matrix.decompose(point,rotation,scale);
    assert.ok(distance(point,target.point)<1e-7);assert.ok(scale.x>0 && scale.y>scale.x,'resting shard retains an elongated faceted silhouette');
  });
  assert.equal(source.visible,false);assert.equal(root.visible,true);
  effect.update(.57);assert.deepEqual(shards.instanceMatrix.array,middle,'pause, rewind, replay produce exactly the same pose');
  effect.update(null);assert.equal(root.visible,false);
  for(let i=0;i<120;i++)effect.update(i/119);
  const after=[];root.traverse(item=>after.push(item));assert.deepEqual(after,objects);
  assert.equal(arcs.geometry.attributes.position.array,arcBuffer);assert.deepEqual(arcBuffer,originalArc);
  assert.deepEqual(source.quaternion.toArray(),sourceQuaternion.toArray(),'local animation must not overwrite the radial source orientation');
  effect.update(null,true);
  assert.equal(root.visible,true);
  assert.deepEqual(root.children.filter(child=>child.visible),[shards],'persistent summit markers use only one instanced draw');
  const resting=shards.instanceMatrix.array.slice(),version=shards.instanceMatrix.version;
  effect.update(null,true);
  assert.deepEqual(shards.instanceMatrix.array,resting);assert.equal(shards.instanceMatrix.version,version,'unchanged static markers do not rebuild transforms');
  effect.update(null,false);assert.equal(root.visible,false);
  effect.update(null,true);assert.equal(root.visible,true);
  assert.deepEqual(root.children.filter(child=>child.visible),[shards]);
  const resourceDisposals=new Map([...geometries,...materials].map(item=>[item,0]));
  for(const item of resourceDisposals.keys())item.addEventListener('dispose',()=>resourceDisposals.set(item,resourceDisposals.get(item)+1));
  effect.dispose();effect.dispose();
  assert.deepEqual(globe.children,[keep]);assert.ok([...resourceDisposals.values()].every(count=>count===1));
  const final=shards.instanceMatrix.array.slice();effect.update(.5);assert.deepEqual(shards.instanceMatrix.array,final);
});
