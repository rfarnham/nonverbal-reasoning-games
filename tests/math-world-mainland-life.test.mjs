import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MAINLAND_ANIMALS, createMainlandLife } from '../app/math-world/globe-mainland-life.ts';
import { MAINLAND_RIVERS, mainlandHeightAt, mainlandDetailSite, mainlandMountainRelief, mainlandWaterSample } from '../app/math-world/globe-mainland-geography.ts';
import { GLOBE_CONTINENTS, continentPointToGlobe } from '../app/math-world/globe-continent-data.ts';
import { getGlobeMap, sphericalAngle } from '../app/math-world/globe-geometry.ts';
import { WORLD_DEFINITIONS } from '../app/math-world/world-data.ts';

test('every mainland has real land-based deer, rabbit and grazing herds with clear stop and book space',()=>{
  const controls=WORLD_DEFINITIONS.flatMap(world=>{const map=getGlobeMap(world.number,world.stopIds.length);return [...map.stops,...map.books].map(item=>item.point);});
  assert.ok(MAINLAND_ANIMALS.length>=100&&MAINLAND_ANIMALS.length<=150);
  for(let continent=0;continent<GLOBE_CONTINENTS.length;continent++)for(const species of ['deer','rabbit','sheep']) {
    const herd=MAINLAND_ANIMALS.filter(a=>a.continent===continent&&a.species===species);
    assert.ok(herd.length>=3,`${continent} has a ${species} family, not a lone decorative dot`);
    for(const animal of herd) {
      assert.ok(mainlandDetailSite(continent,animal.point,.023),'feet stand on mainland away from cliffs, rivers and lake holes');
      const point=continentPointToGlobe(GLOBE_CONTINENTS[continent],animal.point);
      for(const control of controls)assert.ok(sphericalAngle(point,control)>.0599,'the entire small animal stays outside the playable clearing');
      assert.ok(herd.some(peer=>peer!==animal&&Math.hypot(peer.point[0]-animal.point[0],peer.point[1]-animal.point[1])<.060),'family members are nearby');
    }
  }
});

test('mainland tributaries join trunk rivers and carve real downhill channels, with raised terrain away from play',()=>{
  for(let continent=0;continent<GLOBE_CONTINENTS.length;continent++) {
    const rivers=MAINLAND_RIVERS[continent],trunk=rivers[0];
    assert.ok(rivers.length>=3);
    for(const tributary of rivers.slice(1)) {
      const end=tributary.points.at(-1);
      assert.ok(trunk.points.some(p=>p[0]===end[0]&&p[1]===end[1]),'each stream ends at an actual river confluence');
      assert.ok(tributary.sourceLevel>1.0021,'streams flow downhill into the river basin');
      for(const point of tributary.points) {
        const water=mainlandWaterSample(continent,point);
        assert.ok(water.distance<1e-9);assert.ok(mainlandHeightAt(continent,point)<water.level,'a stream cuts into relief instead of painting water onto a hill');
      }
    }
    let peak=0;
    for(let x=-.3;x<=.3;x+=.015)for(let y=-.3;y<=.3;y+=.015)if(mainlandDetailSite(continent,[x,y]))peak=Math.max(peak,mainlandHeightAt(continent,[x,y]));
    assert.ok(peak>1.025,'each continent includes substantial three-dimensional mountain relief');
    assert.ok(mainlandMountainRelief(continent,[.18,.03])>=0);
  }
});

test('sculpted fauna remain a bounded four-draw cache with independent materials and complete disposal',()=>{
  const firstGroup=new THREE.Group(),secondGroup=new THREE.Group(),first=createMainlandLife(firstGroup),second=createMainlandLife(secondGroup);
  assert.equal(firstGroup.children.length,4);
  let triangles=0;
  for(const mesh of firstGroup.children) {
    const peer=secondGroup.getObjectByName(mesh.name),position=mesh.geometry.getAttribute('position');triangles+=position.count/3;
    assert.notEqual(mesh.geometry,peer.geometry);assert.notEqual(mesh.material,peer.material);
    assert.equal(position.array,peer.geometry.getAttribute('position').array,'only immutable CPU arrays are shared across map mounts');
    for(const attribute of Object.values(mesh.geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value));
    if(mesh.name.includes('families')) {
      const weights=mesh.geometry.getAttribute('grazeData');let body=0,head=0;
      for(let i=0;i<weights.count;i++){if(weights.getX(i)===0)body++;else head++;}
      assert.ok(body>0&&head>0,'grazing articulates a real head and neck independently of the body and feet');
      assert.ok(mesh.customDepthMaterial,'the animated silhouette and shadow share the same deformation');
    }
  }
  assert.ok(triangles<135000,'small life details retain a bounded triangle budget');
  first.update(4);first.update(Number.NaN);
  const geometry=firstGroup.children[0].geometry,material=firstGroup.children[0].material;let geometryDisposed=0,materialDisposed=0;
  geometry.addEventListener('dispose',()=>geometryDisposed++);material.addEventListener('dispose',()=>materialDisposed++);
  first.dispose();first.dispose();assert.equal(geometryDisposed,1);assert.equal(materialDisposed,1);assert.equal(firstGroup.children.length,0);
  assert.equal(secondGroup.children.length,4);second.update(8);second.dispose();assert.equal(secondGroup.children.length,0);
});
