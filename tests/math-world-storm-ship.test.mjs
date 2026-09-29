import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleStormShipMotion} from '../app/math-world/storm-ship-motion.ts';

test('ship rides bounded swells without sinking or tumbling and freezes with the scenery clock',()=>{
  const bounds={heave:.0032,roll:.165,pitch:.085,yaw:.055,sail:.1};
  const poses=[];
  for(let i=0;i<=1800;i++){
    const pose=sampleStormShipMotion(i/10,1);poses.push(pose);
    for(const [key,value]of Object.entries(pose))assert.ok(Number.isFinite(value)&&Math.abs(value)<=bounds[key]+1e-12,`${key} stays within safe visible motion`);
    assert.deepEqual(sampleStormShipMotion(i/10,1),pose,'a paused frame is stable');
    for(const value of Object.values(sampleStormShipMotion(i/10,0)))assert.equal(Math.abs(value),0,'outside a storm the voyage pose is unchanged');
  }
  assert.ok(poses.some(p=>p.heave>.002)&&poses.some(p=>p.heave<-.002),'ship rises and falls with the waves');
  assert.ok(poses.some(p=>p.roll>.12)&&poses.some(p=>p.roll<-.12),'wind rocks both sides');
  assert.deepEqual(sampleStormShipMotion(10,9),sampleStormShipMotion(10,1));
  for(const value of Object.values(sampleStormShipMotion(NaN,Infinity)))assert.ok(Number.isFinite(value));
});
