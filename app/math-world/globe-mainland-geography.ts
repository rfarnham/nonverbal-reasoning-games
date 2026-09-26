import { GLOBE_CONTINENTS, continentPointToGlobe, distanceToCoast2D, pointInsideCoast, type ContinentPoint } from "./globe-continent-data.ts";
import { GLOBE_DESTINATIONS, getGlobeMap } from "./globe-geometry.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";

type Point = ContinentPoint;
const clamp = (value:number) => Math.max(0, Math.min(1, value));
const trunkRivers: readonly (readonly Point[])[] = [
  [[-.06,.12],[-.09,.01],[-.02,-.10],[.08,-.17],[.13,-.29],[.07,-.42]],
  [[-.13,.30],[-.16,.21],[-.11,.14],[-.01,.06],[.08,.04],[.25,.11]],
  [[.0,.08],[.04,-.03],[-.03,-.13],[-.08,-.22],[-.03,-.34],[.08,-.45]],
  [[-.02,.04],[-.07,-.06],[-.03,-.14],[.06,-.24],[.03,-.38],[.10,-.47]],
  [[-.03,.13],[.05,.06],[.12,-.01],[.08,-.10],[.02,-.15],[-.01,-.28]],
  [[-.03,.12],[.07,.04],[.14,-.07],[.12,-.18],[.05,-.26],[.01,-.46]],
];
export type MainlandRiver = Readonly<{ points: readonly Point[]; width:number; sourceLevel:number }>;
/** Tributaries join an existing river exactly, avoiding disconnected blue marks. */
export const MAINLAND_RIVERS: readonly (readonly MainlandRiver[])[] = trunkRivers.map((points,index) => {
  const tributaries = [2,3].map((junction,branch) => {
    const end=points[junction], sign=branch===0?-1:1;
    const start:Point=[end[0]+sign*.115,end[1]+.105];
    const bend:Point=[end[0]+sign*.074,end[1]+.065];
    const elbow:Point=[end[0]+sign*.040,end[1]+.059];
    return { points:[start,bend,elbow,end],width:.0017,sourceLevel:1.0065+index*.0004 };
  });
  return [{points,width:.0032,sourceLevel:1.0021},...tributaries];
});
export function mainlandCoastDistance(index:number,point:Point):number {
  const continent=GLOBE_CONTINENTS[index];
  return Math.min(distanceToCoast2D(point,continent.coastline),...continent.inlandWater.map(hole=>distanceToCoast2D(point,hole)));
}
export function mainlandWaterSample(index:number,point:Point) {
  let distance=Infinity, level=1.0021, width=.0032;
  for(const river of MAINLAND_RIVERS[index])for(let segment=1;segment<river.points.length;segment++) {
    const a=river.points[segment-1],b=river.points[segment],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy));
    const d=Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);
    if(d<distance){distance=d;width=river.width;level=river.sourceLevel+(1.0021-river.sourceLevel)*(segment-1+t)/(river.points.length-1);}
  }
  return {distance,level,width};
}
export function mainlandMountainRelief(index:number,p:Point):number {
  // Broken, overlapping peaks form a chain on either side of the river basin.
  // Their irregular profiles read as ridges rather than repeated cone props.
  let relief=0;
  for(let peak=0;peak<8;peak++) {
    const side=peak<4?-1:1, step=peak%4;
    const x=side*(.17+.018*Math.sin(step*2.7+index)), y=-.23+step*.13+.02*Math.sin(index+peak);
    const dx=(p[0]-x)/(.041+.007*(peak%3)),dy=(p[1]-y)/(.060+.009*((peak+index)%3));
    const mass=Math.exp(-(dx*dx+dy*dy)*1.4)*(.030+.008*((index+peak)%3));
    const spurs=1+.15*Math.sin(p[0]*137+p[1]*72+index)+.10*Math.cos(p[1]*169-p[0]*44);
    relief=Math.max(relief,mass*spurs);
  }
  return relief;
}
export function mainlandHeightAt(index:number,p:Point):number {
  const coastal=clamp(mainlandCoastDistance(index,p)/.032);
  const relief=mainlandMountainRelief(index,p)*coastal;
  let h=1.0035+coastal*.005+relief;
  const at=continentPointToGlobe(GLOBE_CONTINENTS[index],p);
  const destinationDistance=Math.acos(Math.min(1,Math.max(...GLOBE_DESTINATIONS.map(c=>c.center.x*at.x+c.center.y*at.y+c.center.z*at.z))));
  const clearing=clamp((destinationDistance-.235)/.045);
  h=Math.min(h,1.0105+(h-1.0105)*clearing*clearing*(3-2*clearing));
  const plateau=h;
  // At a confluence the lowest connected channel wins. Selecting only the
  // nearest centerline lets an uphill tributary bury the adjacent trunk bank.
  for(const river of MAINLAND_RIVERS[index]) {
    let distance=Infinity,level=1.0021;
    for(let segment=1;segment<river.points.length;segment++) {
      const a=river.points[segment-1],b=river.points[segment],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy));
      const d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
      if(d<distance){distance=d;level=river.sourceLevel+(1.0021-river.sourceLevel)*(segment-1+t)/(river.points.length-1);}
    }
    const channel=clamp((distance-river.width*4.4)/.011);
    h=Math.min(h,level-.001+(plateau-level+.001)*channel);
  }
  return h;
}
const playPoints=WORLD_DEFINITIONS.flatMap(world=>{
  const map=getGlobeMap(world.number,world.stopIds.length);
  return [...map.stops,...map.books].map(item=>item.point);
});
/** Small props use actual controls' clearings, not a continent-sized exclusion. */
export function mainlandDetailSite(index:number,p:Point,clearance=.018):boolean {
  const continent=GLOBE_CONTINENTS[index];
  if(!pointInsideCoast(p,continent.coastline)||continent.inlandWater.some(hole=>pointInsideCoast(p,hole))||mainlandCoastDistance(index,p)<clearance||mainlandWaterSample(index,p).distance<.025)return false;
  const at=continentPointToGlobe(continent,p);
  if(playPoints.some(c=>c.x*at.x+c.y*at.y+c.z*at.z>Math.cos(.060)))return false;
  return true;
}
