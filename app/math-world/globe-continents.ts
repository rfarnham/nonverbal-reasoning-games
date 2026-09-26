import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { GLOBE_CONTINENTS, continentPointToGlobe, distanceToCoast2D, pointInsideCoast, type ContinentPoint } from "./globe-continent-data.ts";
import { GLOBE_DESTINATIONS } from "./globe-geometry.ts";
import { MAINLAND_RIVERS, mainlandHeightAt, mainlandWaterSample, mainlandMountainRelief } from "./globe-mainland-geography.ts";
import { createMainlandLife } from "./globe-mainland-life.ts";
import { TREE_SWAY_GLSL } from "./globe-foliage.ts";

type Point = ContinentPoint;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const mix = (a: Point,b: Point,t=.5): Point => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const distance = (a: Point,b: Point) => Math.hypot(a[0]-b[0],a[1]-b[1]);
type CachedGeometry = { position: Float32Array; normal: Float32Array; color?: Float32Array; uv?: Float32Array; foliageAnchor?: Float32Array; foliageBend?: Float32Array; index: Uint16Array | Uint32Array };
// CPU arrays are immutable after construction. Each map mount still owns fresh
// geometry, attributes and GPU resources, so disposal never invalidates a peer.
const geometryCache=new Map<string,CachedGeometry>();

/** Broad regional geography, deliberately separate from each world's stop islands.
 * The coast data is shared with the boat planner; vertices follow the globe rather
 * than drawing a large flat polygon that would pass through the ocean sphere. */
export function createGlobeContinents(globe: THREE.Group) {
  const group = new THREE.Group(); group.name="Six connected continental mainlands"; globe.add(group);
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const terrainPositions:number[]=[],terrainColors:number[]=[],shorePositions:number[]=[],shoreColors:number[]=[];
  const foamPositions:number[]=[],foamUV:number[]=[];
  const riverPositions:number[]=[],riverUV:number[]=[];
  const landmarkPositions:number[]=[],landmarkColors:number[]=[];
  const landmarkAnchors:number[]=[],landmarkBends:number[]=[];
  const geometry = (key:string,positions:number[],colors?:number[],uv?:number[],anchors?:number[],bends?:number[]) => {
    const cached=geometryCache.get(key);
    if(cached){
      const result=new THREE.BufferGeometry();
      result.setAttribute("position",new THREE.BufferAttribute(cached.position,3));
      result.setAttribute("normal",new THREE.BufferAttribute(cached.normal,3));
      if(cached.color)result.setAttribute("color",new THREE.BufferAttribute(cached.color,3));
      if(cached.uv)result.setAttribute("uv",new THREE.BufferAttribute(cached.uv,2));
      if(cached.foliageAnchor)result.setAttribute("foliageAnchor",new THREE.BufferAttribute(cached.foliageAnchor,3));
      if(cached.foliageBend)result.setAttribute("foliageBend",new THREE.BufferAttribute(cached.foliageBend,2));
      result.setIndex(new THREE.BufferAttribute(cached.index,1));geometries.push(result);return result;
    }
    const result=new THREE.BufferGeometry();result.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    if(colors)result.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    if(uv)result.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
    if(anchors)result.setAttribute("foliageAnchor",new THREE.Float32BufferAttribute(anchors,3));
    if(bends)result.setAttribute("foliageBend",new THREE.Float32BufferAttribute(bends,2));
    const merged=mergeVertices(result,1e-7);result.dispose();
    const indices=merged.getIndex()!,points=merged.getAttribute("position");
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
    for(let i=0;key!=="landmarks"&&i<indices.count;i+=3){
      const ia=indices.getX(i),ib=indices.getX(i+1),ic=indices.getX(i+2);
      a.fromBufferAttribute(points,ia);b.fromBufferAttribute(points,ib);c.fromBufferAttribute(points,ic);
      ab.subVectors(b,a);ac.subVectors(c,a);
      if(ab.cross(ac).dot(a)<0){indices.setX(i+1,ic);indices.setX(i+2,ib);}
    }
    merged.computeVertexNormals();
    geometryCache.set(key,{position:merged.getAttribute("position").array as Float32Array,normal:merged.getAttribute("normal").array as Float32Array,color:merged.getAttribute("color")?.array as Float32Array|undefined,uv:merged.getAttribute("uv")?.array as Float32Array|undefined,foliageAnchor:merged.getAttribute("foliageAnchor")?.array as Float32Array|undefined,foliageBend:merged.getAttribute("foliageBend")?.array as Float32Array|undefined,index:merged.getIndex()!.array as Uint16Array|Uint32Array});
    geometries.push(merged);return merged;
  };
  const protectedCenters=GLOBE_DESTINATIONS.map(item=>item.center);
  if(geometryCache.size<5)for(const [index,continent] of GLOBE_CONTINENTS.entries()) {
    const baseColor=new THREE.Color(continent.color),highlandColor=new THREE.Color(continent.highlandColor);
    const color=new THREE.Color(),sand=new THREE.Color(0xf3deb0),reef=new THREE.Color(0x5ccfc3),deepReef=new THREE.Color(0x269eac),cliff=new THREE.Color(continent.cliffColor);
    const rivers=MAINLAND_RIVERS[index];
    const riverDistance=(p:Point)=>mainlandWaterSample(index,p).distance;
    const forestColor=new THREE.Color([0x4f985c,0x408d65,0x4e8268,0x89994d,0x739985,0x39834f][index]);
    const dryColor=new THREE.Color([0xc7c877,0xadbd77,0xb8c1a1,0xd6be75,0xc6cdaf,0xb1bd6c][index]);
    const forestCover=(p:Point)=>clamp(.45+.35*Math.sin(p[0]*12+Math.sin(p[1]*8)*1.4+index*1.3)+.22*Math.cos(p[1]*13-p[0]*4+index));
    const coastDistance=(p:Point)=>{let minimum=distanceToCoast2D(p,continent.coastline);for(const hole of continent.inlandWater)minimum=Math.min(minimum,distanceToCoast2D(p,hole));return minimum;};
    const heightAt=(p:Point)=>mainlandHeightAt(index,p);
    const vertexCache=new Map<string,readonly number[]>();
    const snow=new THREE.Color(0xdce6db);
    const put=(p:Point)=>{
      const key=`${p[0].toFixed(8)},${p[1].toFixed(8)}`;
      const cached=vertexCache.get(key);
      if(cached){terrainPositions.push(cached[0],cached[1],cached[2]);terrainColors.push(cached[3],cached[4],cached[5]);return;}
      const h=heightAt(p),at=continentPointToGlobe(continent,p,h);
      terrainPositions.push(at.x,at.y,at.z);
      const variation=.06*Math.sin(p[0]*37+index)+.035*Math.cos(p[1]*41-index);
      color.copy(baseColor).lerp(highlandColor,clamp((h-1.008)*25+.11+variation));
      const inland=clamp((h-1.0035)/.005);
      color.lerp(forestColor,forestCover(p)*inland*.50);
      color.lerp(dryColor,clamp(.22+.28*Math.sin(p[0]*9-p[1]*7+index*2))*inland);
      color.lerp(cliff,clamp((h-1.027)*25)*.50);
      if(h>1.035)color.lerp(snow,clamp((h-1.035)*65)*([2,4].includes(index)?1:.65));
      terrainColors.push(color.r,color.g,color.b);
      vertexCache.set(key,[at.x,at.y,at.z,color.r,color.g,color.b]);
    };
    const pointKey=(p:Point)=>`${p[0].toFixed(8)},${p[1].toFixed(8)}`;
    const edgeKey=(a:Point,b:Point)=>{const ka=pointKey(a),kb=pointKey(b);return ka<kb?`${ka}:${kb}`:`${kb}:${ka}`;};
    const midpoints=new Map<string,Point>();
    const leaves:(readonly[Point,Point,Point])[]=[];
    const triangle=(a:Point,b:Point,c:Point,depth=0)=>{
      const edge=Math.max(distance(a,b),distance(b,c),distance(c,a));
      const nearRiver=Math.min(riverDistance(a),riverDistance(b),riverDistance(c))<edge+.024;
      const highland=Math.max(mainlandMountainRelief(index,a),mainlandMountainRelief(index,b),mainlandMountainRelief(index,c))>.007;
      if(depth<9&&edge>(nearRiver?.010:highland?.023:.038)){
        const ab=mix(a,b),bc=mix(b,c),ca=mix(c,a);
        midpoints.set(edgeKey(a,b),ab);midpoints.set(edgeKey(b,c),bc);midpoints.set(edgeKey(c,a),ca);
        triangle(a,ab,ca,depth+1);triangle(ab,b,bc,depth+1);triangle(ca,bc,c,depth+1);triangle(ab,bc,ca,depth+1);return;
      }
      leaves.push([a,b,c]);
    };
    const outer=continent.coastline.map(p=>new THREE.Vector2(...p));
    const holes=continent.inlandWater.map(hole=>hole.map(p=>new THREE.Vector2(...p)));
    const vertices=[...continent.coastline,...continent.inlandWater.flat()];
    for(const [a,b,c]of THREE.ShapeUtils.triangulateShape(outer,holes))triangle(vertices[a],vertices[b],vertices[c]);
    const existingPoints=new Map(vertices.map(p=>[pointKey(p),p]));
    for(const p of midpoints.values())existingPoints.set(pointKey(p),p);
    const edgeMidpoint=(a:Point,b:Point)=>midpoints.get(edgeKey(a,b))??existingPoints.get(pointKey(mix(a,b)));
    // A refined valley can share an edge with coarser grassland. Both sides must
    // include every existing edge midpoint before heights are projected, or the
    // surface develops visible T-junction cracks despite matching endpoints.
    const stitch=(a:Point,b:Point,c:Point)=>{
      const ab=edgeMidpoint(a,b);if(ab){stitch(a,ab,c);stitch(ab,b,c);return;}
      const bc=edgeMidpoint(b,c);if(bc){stitch(b,bc,a);stitch(bc,c,a);return;}
      const ca=edgeMidpoint(c,a);if(ca){stitch(c,ca,b);stitch(ca,a,b);return;}
      put(a);put(c);put(b);
    };
    for(const [a,b,c]of leaves)stitch(a,b,c);

    // Small groups of trees punctuate the broad forest belts. They occupy the
    // mainland interior and preserve every authored world's foreground clearing.
    const canopy=new THREE.IcosahedronGeometry(1,0);
    const trunk=new THREE.CylinderGeometry(.15,.22,1,5).toNonIndexed();
    const transform=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),origin=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3(),vertex=new THREE.Vector3();
    const treeRoot=new THREE.Vector3(),treeUp=new THREE.Vector3();let treePhase=0;
    const putLandmark=(source:THREE.BufferGeometry,at:Point,height:number,size:readonly[number,number,number],tint:THREE.Color)=>{
      const sphere=continentPointToGlobe(continent,at,height);origin.set(sphere.x,sphere.y,sphere.z);direction.copy(origin).normalize();rotation.setFromUnitVectors(up,direction);scale.set(...size);transform.compose(origin,rotation,scale);
      const points=source.getAttribute("position");for(let i=0;i<points.count;i++){
        vertex.fromBufferAttribute(points,i).applyMatrix4(transform);landmarkPositions.push(vertex.x,vertex.y,vertex.z);landmarkColors.push(tint.r,tint.g,tint.b);
        const height=(vertex.x-treeRoot.x)*treeUp.x+(vertex.y-treeRoot.y)*treeUp.y+(vertex.z-treeRoot.z)*treeUp.z;
        landmarkAnchors.push(treeRoot.x,treeRoot.y,treeRoot.z);landmarkBends.push(Math.pow(clamp(height/.025),2),treePhase);
      }
    };
    let trees=0;
    for(let seed=0;seed<160&&trees<24;seed++){
      const p:Point=[Math.sin(seed*73.19+index*5.3)*.34,Math.sin(seed*31.77+index*2.1)*.33];
      if(forestCover(p)<.54||!pointInsideCoast(p,continent.coastline)||continent.inlandWater.some(hole=>pointInsideCoast(p,hole))||coastDistance(p)<.036||riverDistance(p)<.040)continue;
      const at=continentPointToGlobe(continent,p);
      if(protectedCenters.some(c=>c.x*at.x+c.y*at.y+c.z*at.z>Math.cos(.26)))continue;
      const h=heightAt(p),size=.009+(seed%4)*.0018;
      const root=continentPointToGlobe(continent,p,h);treeRoot.set(root.x,root.y,root.z);treeUp.copy(treeRoot).normalize();treePhase=seed*1.713+index;
      putLandmark(trunk,p,h+.004,[size*.65,.010,size*.65],cliff);
      putLandmark(canopy,p,h+.012,[size,size*1.15,size],forestColor);
      putLandmark(canopy,[p[0]+size*.45,p[1]-.002],h+.008,[size*.76,size*.86,size*.76],forestColor.clone().lerp(highlandColor,.22));
      trees++;
    }
    canopy.dispose();trunk.dispose();

    // Mitered offsets follow each concave coastline, producing broad submerged
    // shelves and shared beaches around entire mainland bodies, not each stop.
    const offset=(coast:readonly Point[],amount:number):Point[]=>{
      const signed=coast.reduce((sum,p,i)=>{const q=coast[(i+1)%coast.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
      const sign=signed>0?1:-1;
      return coast.map((p,i)=>{
        const before=coast[(i+coast.length-1)%coast.length],after=coast[(i+1)%coast.length];
        const dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1;
        return[p[0]+dy/length*amount*sign,p[1]-dx/length*amount*sign];
      });
    };
    const shoreBand=(inner:readonly Point[],outer:readonly Point[],innerHeight:number,outerHeight:number,innerColor:THREE.Color,outerColor:THREE.Color)=>{
      for(let i=0;i<inner.length;i++){
        const j=(i+1)%inner.length;
        for(const [p,h,col]of [[inner[i],innerHeight,innerColor],[outer[j],outerHeight,outerColor],[outer[i],outerHeight,outerColor],[inner[i],innerHeight,innerColor],[inner[j],innerHeight,innerColor],[outer[j],outerHeight,outerColor]] as const){
          const at=continentPointToGlobe(continent,p,h);shorePositions.push(at.x,at.y,at.z);shoreColors.push(col.r,col.g,col.b);
        }
      }
    };
    for(const [coastIndex,coast]of [continent.coastline,...continent.inlandWater].entries()){
      const sign=coastIndex===0?1:-1;
      const inside=offset(coast,-.004*sign),beach=offset(coast,.003*sign),shallows=offset(coast,.010*sign),shelf=offset(coast,.019*sign);
      shoreBand(inside,coast,1.0041,1.0037,cliff,sand);
      shoreBand(coast,beach,1.0037,1.0029,sand,sand);
      shoreBand(beach,shallows,1.0029,1.0018,reef,reef);
      shoreBand(shallows,shelf,1.0018,1.0005,reef,deepReef);
      const foamA=offset(coast,.005*sign),foamB=offset(coast,.012*sign);
      for(let i=0;i<coast.length;i++){
        const j=(i+1)%coast.length;
        for(const [point,along,across]of [[foamA[i],i,0],[foamB[j],i+1,1],[foamB[i],i,1],[foamA[i],i,0],[foamA[j],i+1,0],[foamB[j],i+1,1]] as const){const at=continentPointToGlobe(continent,point,1.0024);foamPositions.push(at.x,at.y,at.z);foamUV.push(along*.38,across);}
      }
    }
    for(const water of rivers)for(let segment=0;segment<water.points.length-1;segment++){
      const river=water.points;
      const a=river[segment],b=river[segment+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=dy/length*water.width,ny=-dx/length*water.width;
      const steps=Math.ceil(length/.012);
      for(let step=0;step<steps;step++)for(const [t,side]of [[step/steps,-1],[(step+1)/steps,1],[step/steps,1],[step/steps,-1],[(step+1)/steps,-1],[(step+1)/steps,1]]){
        const midpoint=mix(a,b,(step+.5)/steps);
        if(!pointInsideCoast(midpoint,continent.coastline)||continent.inlandWater.some(hole=>pointInsideCoast(midpoint,hole)))continue;
        const center=mix(a,b,t),point:Point=[center[0]+nx*side,center[1]+ny*side];
        const level=water.sourceLevel+(1.0021-water.sourceLevel)*(segment+t)/(river.length-1);
        const at=continentPointToGlobe(continent,point,level);riverPositions.push(at.x,at.y,at.z);riverUV.push((side+1)/2,segment+t);
      }
    }
  }
  const terrainMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,side:THREE.DoubleSide});materials.push(terrainMaterial);
  const terrain=new THREE.Mesh(geometry("terrain",terrainPositions,terrainColors),terrainMaterial);terrain.name="Connected mainland terrain with bays and inland seas";terrain.userData.receiveShadow=false;group.add(terrain);
  const shoreMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.69,side:THREE.DoubleSide});materials.push(shoreMaterial);
  const shore=new THREE.Mesh(geometry("shore",shorePositions,shoreColors),shoreMaterial);shore.name="Continuous mainland beaches and coastal shelves";shore.userData.receiveShadow=false;group.add(shore);
  const clock={value:0},sun={value:new THREE.Vector3(1,1,1).normalize()};
  const patchFoliage=(shader:THREE.WebGLProgramParametersWithUniforms)=>{
    shader.uniforms.foliageTime=clock;
    shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>\nattribute vec3 foliageAnchor; attribute vec2 foliageBend; uniform float foliageTime;\n${TREE_SWAY_GLSL}`)
      .replace("#include <begin_vertex>","#include <begin_vertex>\ntransformed=swayTree(transformed,foliageAnchor,foliageBend.x,foliageBend.y,foliageTime);");
  };
  const landmarkMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88,flatShading:true});materials.push(landmarkMaterial);
  landmarkMaterial.onBeforeCompile=patchFoliage;landmarkMaterial.customProgramCacheKey=()=>"mainland-foliage-v1";
  const landmarkDepth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});materials.push(landmarkDepth);
  landmarkDepth.onBeforeCompile=patchFoliage;landmarkDepth.customProgramCacheKey=()=>"mainland-foliage-depth-v1";
  const landmarks=new THREE.Mesh(geometry("landmarks",landmarkPositions,landmarkColors,undefined,landmarkAnchors,landmarkBends),landmarkMaterial);landmarks.name="Mainland forest groves";landmarks.customDepthMaterial=landmarkDepth;group.add(landmarks);
  const makeWaterMaterial=(foam:boolean)=>{
    const material=new THREE.ShaderMaterial({transparent:foam,depthWrite:!foam,side:THREE.DoubleSide,uniforms:{seconds:clock,sunDirection:sun,foam:{value:foam?1:0}},
      vertexShader:"varying vec2 vUv; varying vec3 vNormal; void main(){vUv=uv;vNormal=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:`uniform float seconds; uniform vec3 sunDirection; uniform float foam; varying vec2 vUv; varying vec3 vNormal; void main(){
        float day=mix(.27,1.,smoothstep(-.2,.55,dot(normalize(vNormal),sunDirection)));
        float crest=pow(max(0.,sin(vUv.y*9.-seconds*1.35+sin(vUv.x*1.7)*.8)),5.);
        float along=.5+.5*sin(vUv.x*.9+seconds*.21);
        vec3 color=mix(vec3(.06,.57,.66),vec3(.88,1.,.91),foam);
        color=mix(color,vec3(.66,.96,.9),crest*(1.-foam)*.35)*day;
        float alpha=mix(1.,crest*smoothstep(0.,.2,vUv.y)*(1.-smoothstep(.65,1.,vUv.y))*along*.65,foam);
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});materials.push(material);return material;
  };
  const foam=new THREE.Mesh(geometry("foam",foamPositions,undefined,foamUV),makeWaterMaterial(true));foam.name="Mainland shoreline wave bands";foam.renderOrder=2;group.add(foam);
  const riverMesh=new THREE.Mesh(geometry("rivers",riverPositions,undefined,riverUV),makeWaterMaterial(false));riverMesh.name="Continental rivers from inland water to the coast";group.add(riverMesh);
  const life=createMainlandLife(group);
  let disposed=false;
  return{
    update(seconds:number,sunDirection?:THREE.Vector3){if(disposed)return;clock.value=Number.isFinite(seconds)?seconds:0;life.update(clock.value);if(sunDirection)sun.value.copy(sunDirection);},
    dispose(){if(disposed)return;disposed=true;life.dispose();globe.remove(group);for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();group.clear();},
  };
}
