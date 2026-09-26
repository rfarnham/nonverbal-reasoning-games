import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGlobeOcean } from '../app/math-world/globe-ocean.ts';

function compile(ocean) {
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  ocean.material.onBeforeCompile(shader,{});return shader;
}

test('water keeps its ripples and sun in the same camera space through arbitrary pole rotations', () => {
  const ocean=createGlobeOcean(),shader=compile(ocean),globe=new THREE.Group(),camera=new THREE.PerspectiveCamera();
  const sun=new THREE.Vector3(.31,.78,-.41).normalize();
  camera.position.set(.2,.8,3);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI*2]) {
    globe.quaternion.setFromAxisAngle(new THREE.Vector3(.2,0,.98).normalize(),angle);
    ocean.update(17,globe,camera,sun);
    const expected=sun.clone().applyQuaternion(globe.quaternion).transformDirection(camera.matrixWorldInverse);
    assert.ok(expected.distanceTo(shader.uniforms.seaSunView.value)<1e-10);
    const local=new THREE.Vector3(.8,.2,.4).normalize();
    const normal=local.clone().applyMatrix3(shader.uniforms.seaRotation.value);
    assert.ok(Math.abs(normal.length()-1)<1e-10);
    assert.ok(normal.distanceTo(local.clone().applyQuaternion(globe.quaternion).transformDirection(camera.matrixWorldInverse))<1e-10);
  }
  ocean.dispose();
});

test('water uses the supplied scenery clock and releases its single material exactly once', () => {
  const ocean=createGlobeOcean(),shader=compile(ocean),globe=new THREE.Group(),camera=new THREE.PerspectiveCamera();
  let disposed=0;ocean.material.addEventListener('dispose',()=>disposed++);
  ocean.update(12.5,globe,camera);assert.equal(shader.uniforms.seaTime.value,12.5);
  ocean.update(12.5,globe,camera);assert.equal(shader.uniforms.seaTime.value,12.5);
  for(const time of [NaN,Infinity,-1]) {ocean.update(time,globe,camera);assert.equal(shader.uniforms.seaTime.value,0);}
  ocean.dispose();ocean.dispose();ocean.update(999,globe,camera);
  assert.equal(disposed,1);assert.equal(shader.uniforms.seaTime.value,0);
});
