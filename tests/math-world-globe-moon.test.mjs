import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGlobeMoon, createGlobeMoonGeometry, sampleGlobeMoonOrbit, getMoonIlluminatedFraction, GLOBE_MOON_RADIUS, GLOBE_MOON_ORBIT_RADIUS, GLOBE_MOON_ORBIT_SECONDS } from '../app/math-world/globe-moon.ts';

const anchor={x:.28,y:.19,z:.94};
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≈ ${b}`);

test('moon follows one deterministic inclined orbit clear of the globe and closes after a period',()=>{
  const a=sampleGlobeMoonOrbit(0,anchor),b=sampleGlobeMoonOrbit(GLOBE_MOON_ORBIT_SECONDS/4,anchor);
  close(a.length(),GLOBE_MOON_ORBIT_RADIUS);close(b.length(),GLOBE_MOON_ORBIT_RADIUS);close(a.dot(b),0);
  assert.ok(a.distanceTo(sampleGlobeMoonOrbit(GLOBE_MOON_ORBIT_SECONDS,anchor))<1e-10);
  for(let seconds=0;seconds<500;seconds+=7){
    const p=sampleGlobeMoonOrbit(seconds,anchor);close(p.length(),GLOBE_MOON_ORBIT_RADIUS);
    assert.ok(p.length()-GLOBE_MOON_RADIUS*1.04>1.3,'orbit stays clear of the planet and its tallest atmosphere');
    assert.deepEqual(p,sampleGlobeMoonOrbit(seconds,anchor),'same shared scenery time is an identical paused pose');
    assert.ok(p.toArray().every(Number.isFinite));
  }
  assert.deepEqual(sampleGlobeMoonOrbit(NaN,anchor),a);assert.deepEqual(sampleGlobeMoonOrbit(-1,anchor),a);
  const polar=sampleGlobeMoonOrbit(28,{x:0,y:1,z:0});close(polar.length(),GLOBE_MOON_ORBIT_RADIUS);
});

test('phase uses the actual observer-minus-moon vector and a shared directional sun',()=>{
  const moon={x:2,y:1,z:-3},observer={x:2,y:1,z:7};
  close(getMoonIlluminatedFraction(moon,{x:0,y:0,z:4},observer),1);
  close(getMoonIlluminatedFraction(moon,{x:0,y:0,z:-2},observer),0);
  close(getMoonIlluminatedFraction(moon,{x:5,y:0,z:0},observer),.5);
  close(getMoonIlluminatedFraction(moon,{x:.6,y:0,z:-.8},observer),.1);
  const shifted={x:12,y:1,z:-3};
  close(getMoonIlluminatedFraction(moon,{x:0,y:0,z:1},shifted),.5);
});

test('moon relief has actual lowered bowls, raised rims, varied maria and finite lit normals in a bounded single shell',()=>{
  const geometry=createGlobeMoonGeometry();
  assert.equal(geometry.index.count/3,35520);
  const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),colors=geometry.getAttribute('color'),craters=geometry.getAttribute('lunarCrater');
  assert.equal(positions.count,normals.count);assert.equal(positions.count,colors.count);assert.equal(positions.count,craters.count);
  const p=new THREE.Vector3(),n=new THREE.Vector3();let bowls=0,rims=0,darkMaria=0;
  for(let i=0;i<positions.count;i++){
    p.fromBufferAttribute(positions,i);n.fromBufferAttribute(normals,i);
    assert.ok([...p.toArray(),...n.toArray()].every(Number.isFinite));
    assert.ok(p.length()>.91&&p.length()<1.05);close(n.length(),1,1e-6);
    if(p.length()<.97)bowls++;if(p.length()>1.007)rims++;if(colors.getX(i)<.27)darkMaria++;
  }
  assert.ok(bowls>20,'crater bowls are physically below the sphere');assert.ok(rims>100,'raised rims catch grazing light');assert.ok(darkMaria>500,'maria remain visibly distinct from highlands');
  geometry.dispose();
});

test('moon transforms orbit and sunlight together, stays visible by day, and disposes fixed resources exactly once',()=>{
  const scene=new THREE.Scene(),globe=new THREE.Group(),keep=new THREE.Group(),camera=new THREE.PerspectiveCamera();scene.add(keep,globe);camera.position.set(0,0,4);
  const moon=createGlobeMoon(scene,globe,camera,anchor),mesh=scene.getObjectByName('Orbiting cratered moon');assert.ok(mesh);
  const geometry=mesh.geometry,material=mesh.material,positionArray=geometry.attributes.position.array,normalArray=geometry.attributes.normal.array;
  const originalPositions=positionArray.slice(),originalNormals=normalArray.slice();let geometryDisposals=0,materialDisposals=0;
  geometry.addEventListener('dispose',()=>geometryDisposals++);material.addEventListener('dispose',()=>materialDisposals++);
  globe.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.72);
  const sun=new THREE.Vector3(.2,-.4,.9).normalize();moon.update(34,sun,0);
  assert.equal(mesh.parent,scene,'the moon is a true scene object, not a camera overlay or a rotating planet child');
  assert.ok(mesh.position.distanceTo(sampleGlobeMoonOrbit(34,anchor).applyQuaternion(globe.quaternion))<1e-10);
  assert.ok(material.uniforms.lunarSun.value.distanceTo(sun.clone().applyQuaternion(globe.quaternion))<1e-10);
  close(material.uniforms.lunarLocalSun.value.length(),1);
  close(mesh.userData.illuminatedFraction,getMoonIlluminatedFraction(mesh.position,material.uniforms.lunarSun.value,camera.position));
  assert.equal(mesh.visible,true,'daytime phases remain visible');assert.equal(material.depthTest,true);assert.equal(material.depthWrite,true);assert.equal(material.transparent,false,'opaque lunar depth hides stars and obeys globe occlusion');
  const saved=mesh.position.clone();moon.update(34,sun,1);assert.deepEqual(mesh.position,saved);assert.equal(material.uniforms.lunarNight.value,1);
  for(let i=0;i<100;i++)moon.update(i,sun,i%2);
  assert.equal(scene.children.length,3);assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);
  assert.equal(geometry.attributes.position.array,positionArray);assert.equal(geometry.attributes.normal.array,normalArray);
  assert.deepEqual(positionArray,originalPositions);assert.deepEqual(normalArray,originalNormals);
  moon.dispose();moon.dispose();const pose=mesh.position.clone();moon.update(150,sun,1);
  assert.deepEqual(mesh.position,pose);assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);assert.deepEqual(scene.children,[keep,globe]);
});
