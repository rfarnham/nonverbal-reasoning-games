import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGlobeHarbors, GLOBE_HARBOR_LAYOUTS } from '../app/math-world/globe-harbors.ts';
import { createGlobeBiomes } from '../app/math-world/globe-biomes.ts';
import { GLOBE_DESTINATIONS, GLOBE_LAND_OBSTACLES, getGlobeMap, sphericalAngle } from '../app/math-world/globe-geometry.ts';

const vector = p => new THREE.Vector3(p.x,p.y,p.z);

test('every harbor preserves its route anchorage and joins actual authored island ground', () => {
  assert.equal(GLOBE_HARBOR_LAYOUTS.length,34);
  assert.deepEqual(GLOBE_HARBOR_LAYOUTS.map(h=>h.destinationId),GLOBE_DESTINATIONS.map(d=>d.id));
  assert.equal(new Set(GLOBE_HARBOR_LAYOUTS.map(h=>h.style)).size,4);
  assert.deepEqual(GLOBE_HARBOR_LAYOUTS.filter(h=>h.lighthouse).map(h=>h.worldNumber),[1,6,10,13,17,22,26,30]);
  const globe=new THREE.Group(),biomes=createGlobeBiomes(globe),surfaces=[];
  globe.updateMatrixWorld(true);
  globe.traverse(object=>{if(object.isMesh&&object.material.isMeshStandardMaterial)surfaces.push(object);});
  const ray=new THREE.Raycaster();ray.far=.25;
  for(const [index,layout]of GLOBE_HARBOR_LAYOUTS.entries()){
    assert.equal(layout.harbor,GLOBE_DESTINATIONS[index].harbor,'navigation endpoints retain their original identity');
    assert.ok(sphericalAngle(layout.shore,layout.pierEnd)>.012,'the dock has a real connection from shore to water');
    if(!layout.shoreIslandId)continue;
    const map=getGlobeMap(layout.worldNumber);
    assert.ok(map.islands.some(island=>island.id===layout.shoreIslandId));
    const direction=vector(layout.shore);
    ray.set(direction.clone().multiplyScalar(1.2),direction.clone().negate());
    const hits=ray.intersectObjects(surfaces,false);
    assert.ok(hits.some(hit=>Math.abs(hit.point.length()-layout.landingRadius)<.001),`${layout.destinationId} begins on existing island ground, not an offshore foundation`);
  }
  biomes.dispose();
});

test('all solid harbor scenery stays inside routed land envelopes and leaves native anchors clear', () => {
  const globe=new THREE.Group(),harbors=createGlobeHarbors(globe);globe.updateMatrixWorld(true);
  const solid=globe.getObjectByName('Attached harbor structures');assert.ok(solid);
  const position=solid.geometry.getAttribute('position'),point=new THREE.Vector3();
  for(let i=0;i<position.count;i++){
    point.fromBufferAttribute(position,i);
    assert.ok(Number.isFinite(point.x+point.y+point.z));
    assert.ok(GLOBE_LAND_OBSTACLES.some(obstacle=>sphericalAngle(point,obstacle.center)<obstacle.angularRadius+1e-6),'piers, quays and lighthouse foundations cannot obstruct the guaranteed ocean routes');
  }
  const ray=new THREE.Raycaster();ray.far=.23;
  for(const destination of GLOBE_DESTINATIONS.filter(d=>d.kind==='teaching')){
    const map=getGlobeMap(destination.worldNumber);
    for(const point of [...map.stops,...map.books]){
      const direction=vector(point.point);ray.set(direction.clone().multiplyScalar(1.2),direction.clone().negate());
      assert.equal(ray.intersectObject(solid,false).length,0,`${destination.id} keeps its original stop and book ground anchors clear`);
    }
  }
  assert.equal(globe.children[0].children.length,3,'static color geometry, lanterns and beams remain three bounded draws');
  harbors.dispose();
});

test('harbor effects use the supplied clock and own each resource through idempotent disposal', () => {
  const globe=new THREE.Group(),keep=new THREE.Group();globe.add(keep);const harbors=createGlobeHarbors(globe),resources=new Set();
  globe.traverse(object=>{if(object.isMesh){resources.add(object.geometry);resources.add(object.material);if(object.isInstancedMesh)resources.add(object);}});
  const counts=new Map([...resources].map(resource=>[resource,0]));for(const resource of resources)resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));
  const beams=globe.getObjectByName('Slow local lighthouse beams'),lanterns=globe.getObjectByName('Warm lighthouse lanterns');
  assert.equal(beams.count,8);assert.equal(lanterns.count,8);
  harbors.update(12,{x:1,y:0,z:0},1,'counting-1',new THREE.Vector3(-1,0,0));
  assert.equal(beams.material.uniforms.harborSeconds.value,12);assert.equal(lanterns.material.uniforms.harborSeconds.value,12);
  assert.deepEqual(beams.material.uniforms.harborSun.value.toArray(),[-1,0,0]);
  harbors.update(0,{x:1,y:0,z:0},1,'counting-1');assert.equal(beams.material.uniforms.harborSeconds.value,0,'a frozen/reduced-motion frame has a deterministic pose');
  harbors.dispose();harbors.dispose();harbors.update(99,{x:1,y:0,z:0},1,'counting-1');
  assert.equal(beams.material.uniforms.harborSeconds.value,0);assert.deepEqual(globe.children,[keep]);
  for(const count of counts.values())assert.equal(count,1);
});
