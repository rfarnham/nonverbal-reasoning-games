import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createGlobeContinents } from "../app/math-world/globe-continents.ts";
import {
  GLOBE_CONTINENTS, continentPointToGlobe, globePointToContinent,
  pointInsideCoast, getContinentalCoastDistance,
} from "../app/math-world/globe-continent-data.ts";
import {
  GLOBE_LAND_OBSTACLES, getGlobeMap, sphericalAngle,
} from "../app/math-world/globe-geometry.ts";
import { WORLD_DEFINITIONS } from "../app/math-world/world-data.ts";

const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;
const det = (a, b, c) => a.x*(b.y*c.z-b.z*c.y)-a.y*(b.x*c.z-b.z*c.x)+a.z*(b.x*c.y-b.y*c.x);
function sphericalArea(continent, coast) {
  let area = 0;
  for (let i = 0; i < coast.length; i++) {
    const a = continent.center, b = continentPointToGlobe(continent, coast[i]), c = continentPointToGlobe(continent, coast[(i+1)%coast.length]);
    area += 2*Math.atan2(det(a,b,c), 1+dot(a,b)+dot(b,c)+dot(c,a));
  }
  return Math.abs(area);
}

test("six actual mainlands cover 20–30% of the globe with different concave coasts and inland seas", () => {
  assert.equal(GLOBE_CONTINENTS.length, 6);
  const area = GLOBE_CONTINENTS.reduce((sum, continent) => sum+sphericalArea(continent, continent.coastline)-continent.inlandWater.reduce((total, hole) => total+sphericalArea(continent, hole), 0), 0);
  assert.ok(area/(4*Math.PI) > .20 && area/(4*Math.PI) < .30, "coverage measures filled mainland polygons, excluding lake holes and navigation caps");
  assert.equal(new Set(GLOBE_CONTINENTS.map(c => JSON.stringify(c.coastline))).size, 6);
  assert.equal(GLOBE_CONTINENTS.filter(c => c.inlandWater.length).length, 5);
  for (const continent of GLOBE_CONTINENTS) {
    let clockwise = 0, counterclockwise = 0;
    for (let i=0;i<continent.coastline.length;i++) {
      const a=continent.coastline[i],b=continent.coastline[(i+1)%continent.coastline.length],c=continent.coastline[(i+2)%continent.coastline.length];
      const turn=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(turn>1e-8)clockwise++;if(turn<-1e-8)counterclockwise++;
      const point=continentPointToGlobe(continent,a);
      assert.ok(sphericalAngle(continent.center,point)<continent.angularRadius);
      const recovered=globePointToContinent(continent,point);
      assert.ok(Math.hypot(recovered[0]-a[0],recovered[1]-a[1])<1e-8);
    }
    assert.ok(clockwise>5&&counterclockwise>5, "the shared coast has real bays and peninsulas");
    for(const hole of continent.inlandWater)for(const point of hole)assert.ok(pointInsideCoast(point,continent.coastline),"an inland sea remains inside its own mainland");
    const opposite=globePointToContinent(continent,{x:-continent.center.x,y:-continent.center.y,z:-continent.center.z});
    assert.ok(Math.hypot(...opposite)>3, "the antipode cannot accidentally project into the mainland center");
  }
});

test("real mainland geometry stays in navigation exclusions, preserves every stop, and leaves river water exposed", () => {
  const group=new THREE.Group(),continents=createGlobeContinents(group);
  group.updateMatrixWorld(true);
  const meshes=[];group.traverse(object=>{if(object.isMesh)meshes.push(object);});
  const terrain=meshes.find(mesh=>mesh.name.startsWith("Connected mainland"));
  const rivers=meshes.find(mesh=>mesh.name.startsWith("Continental rivers"));
  assert.ok(terrain&&rivers);
  const terrainIndices=terrain.geometry.getIndex(),terrainVertices=terrain.geometry.getAttribute("position");
  const edgeUses=new Map();
  for(let i=0;i<terrainIndices.count;i+=3)for(const [a,b]of [[terrainIndices.getX(i),terrainIndices.getX(i+1)],[terrainIndices.getX(i+1),terrainIndices.getX(i+2)],[terrainIndices.getX(i+2),terrainIndices.getX(i)]]) {
    const key=Math.min(a,b)*terrainVertices.count+Math.max(a,b);edgeUses.set(key,(edgeUses.get(key)||0)+1);
  }
  for(const [edge,count]of edgeUses)if(count===1) {
    const a=Math.floor(edge/terrainVertices.count),b=edge%terrainVertices.count;
    const midpoint={x:(terrainVertices.getX(a)+terrainVertices.getX(b))/2,y:(terrainVertices.getY(a)+terrainVertices.getY(b))/2,z:(terrainVertices.getZ(a)+terrainVertices.getZ(b))/2};
    assert.ok(Math.abs(getContinentalCoastDistance(midpoint))<.0002,"every open terrain edge follows an authored coast; no internal T-junction cracks");
  }
  const point=new THREE.Vector3(),direction=new THREE.Vector3(),raycaster=new THREE.Raycaster();
  raycaster.far=.25; // Inspect the near shore, never the far continent through the globe.
  for(const mesh of meshes) {
    const position=mesh.geometry.getAttribute("position"),normal=mesh.geometry.getAttribute("normal");
    for(let i=0;i<position.count;i++) {
      point.fromBufferAttribute(position,i);
      assert.ok(Number.isFinite(point.x+point.y+point.z));
      if(mesh!==group.getObjectByName("Mainland forest groves")&&!mesh.userData.mainlandSolidProp)assert.ok(point.x*normal.getX(i)+point.y*normal.getY(i)+point.z*normal.getZ(i)>0,"shared surface normals face outward for consistent sunlight");
      assert.ok(GLOBE_LAND_OBSTACLES.some(obstacle=>sphericalAngle(point,obstacle.center)<=obstacle.angularRadius+1e-6),"every rendered mainland, beach, shelf and river vertex belongs to a routed land envelope");
    }
  }
  for(const world of WORLD_DEFINITIONS)for(const stop of getGlobeMap(world.number,world.stopIds.length).stops) {
    direction.set(stop.point.x,stop.point.y,stop.point.z).normalize();
    raycaster.set(direction.clone().multiplyScalar(1.2),direction.clone().negate());
    const hits=raycaster.intersectObject(terrain,false);
    for(const hit of hits)assert.ok(hit.point.length()<1.011,"mainlands cannot cover the original island surface or animal feet");
  }
  const water=rivers.geometry.getAttribute("position");let mainlandSamples=0;
  for(let i=0;i<water.count;i+=Math.max(1,Math.floor(water.count/150))) {
    point.fromBufferAttribute(water,i);direction.copy(point).normalize();
    raycaster.set(direction.clone().multiplyScalar(1.2),direction.clone().negate());
    const hits=raycaster.intersectObject(terrain,false);
    if(hits.length){mainlandSamples++;assert.ok(hits[0].point.length()<point.length()+.0002,"the river must stay visible above the actual triangulated valley floor");}
  }
  assert.ok(mainlandSamples>20);
  continents.update(0,new THREE.Vector3(0,1,0));continents.update(4);continents.dispose();continents.dispose();
  assert.equal(group.children.length,0);
});

test("returning to the map reuses immutable terrain data with independent disposable render resources", () => {
  const a=new THREE.Group(),b=new THREE.Group(),first=createGlobeContinents(a),second=createGlobeContinents(b);
  const meshes=[];a.traverse(object=>{if(object.isMesh)meshes.push(object);});
  for(const mesh of meshes){
    const peer=b.getObjectByName(mesh.name);
    assert.notEqual(peer.geometry,mesh.geometry);assert.notEqual(peer.material,mesh.material);
    assert.notEqual(peer.geometry.getAttribute("position"),mesh.geometry.getAttribute("position"));
    assert.equal(peer.geometry.getAttribute("position").array,mesh.geometry.getAttribute("position").array,"CPU terrain is reused without retriangulating after a stop");
  }
  first.dispose();assert.equal(a.children.length,0);assert.ok(b.children.length>0);
  second.update(3,new THREE.Vector3(1,0,0));second.dispose();assert.equal(b.children.length,0);
});
