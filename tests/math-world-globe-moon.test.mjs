import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGlobeMoon, createGlobeMoonGeometry, sampleGlobeMoonOrbit, getMoonIlluminatedFraction, GLOBE_MOON_RADIUS, GLOBE_MOON_ORBIT_RADIUS, GLOBE_MOON_ORBIT_SECONDS, GLOBE_MOON_ORBIT_INCLINATION_DEGREES } from '../app/math-world/globe-moon.ts';

import { GLOBE_DESTINATIONS } from '../app/math-world/globe-geometry.ts';

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

test('moon stays in one shallow equatorial plane for every anchor and follows the planet spin direction',()=>{
  const tilt=GLOBE_MOON_ORBIT_INCLINATION_DEGREES*Math.PI/180;
  assert.equal(GLOBE_MOON_ORBIT_INCLINATION_DEGREES,5);
  const expectedPole=new THREE.Vector3(0,Math.cos(tilt),Math.sin(tilt));
  const anchors=[anchor,{x:0,y:1,z:0},{x:0,y:-1,z:0},...GLOBE_DESTINATIONS.map(destination=>destination.center)];
  for(const center of anchors){
    const start=sampleGlobeMoonOrbit(0,center),quarter=sampleGlobeMoonOrbit(GLOBE_MOON_ORBIT_SECONDS/4,center);
    const momentum=start.clone().cross(quarter).normalize();
    assert.ok(momentum.y<-.99,'moon orbits in the same negative-Y sense as the physical planet');
    assert.ok(momentum.clone().negate().distanceTo(expectedPole)<1e-10,'opening geography changes phase, never the world-space plane');
    close(Math.acos(-momentum.y),tilt);
    for(let step=0;step<=360;step++){
      const point=sampleGlobeMoonOrbit(step*GLOBE_MOON_ORBIT_SECONDS/360,center);
      close(point.length(),GLOBE_MOON_ORBIT_RADIUS);
      assert.ok(Math.abs(point.dot(expectedPole))<1e-10,'the entire orbit stays in the same fixed plane');
      assert.ok(Math.abs(point.y)<=GLOBE_MOON_ORBIT_RADIUS*Math.sin(tilt)+1e-10,'the moon never climbs more than five degrees above or below the equator');
    }
  }
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

test('moon orbit is independent of globe turns, shares surface sunlight, and disposes fixed resources exactly once',()=>{
  const scene=new THREE.Scene(),globe=new THREE.Group(),keep=new THREE.Group(),camera=new THREE.PerspectiveCamera();scene.add(keep,globe);camera.position.set(0,0,4);
  const moon=createGlobeMoon(scene,globe,camera,anchor),mesh=scene.getObjectByName('Orbiting cratered moon');assert.ok(mesh);
  const geometry=mesh.geometry,material=mesh.material,positionArray=geometry.attributes.position.array,normalArray=geometry.attributes.normal.array;
  const originalPositions=positionArray.slice(),originalNormals=normalArray.slice();let geometryDisposals=0,materialDisposals=0;
  geometry.addEventListener('dispose',()=>geometryDisposals++);material.addEventListener('dispose',()=>materialDisposals++);
  globe.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.72);
  const sun=new THREE.Vector3(.2,-.4,.9).normalize();moon.update(34,sun,0);
  assert.equal(mesh.parent,scene,'the moon is a true scene object, not a camera overlay or a rotating planet child');
  assert.ok(mesh.position.distanceTo(sampleGlobeMoonOrbit(34,anchor))<1e-10);
  const orbitPosition=mesh.position.clone();
  globe.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),2.4);
  moon.update(34,sun,0);
  assert.ok(mesh.position.distanceTo(orbitPosition)<1e-10,'turning the globe never rotates the orbit');
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
