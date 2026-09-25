/** Shared mainland authoring data. Rendering and route exclusions use these exact
 * spherical frames and coastlines, including their peninsulas and inland water. */
export type ContinentPoint = readonly [number, number];
export type ContinentVector = Readonly<{ x: number; y: number; z: number }>;
export type GlobeContinent = Readonly<{
  id: string; label: string; center: ContinentVector; east: ContinentVector; north: ContinentVector;
  coastline: readonly ContinentPoint[]; inlandWater: readonly (readonly ContinentPoint[])[];
  angularRadius: number; color: number; highlandColor: number; cliffColor: number;
}>;
const dot = (a: ContinentVector, b: ContinentVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (p: ContinentVector) => { const length = Math.hypot(p.x, p.y, p.z); return { x: p.x / length, y: p.y / length, z: p.z / length }; };
const cross = (a: ContinentVector, b: ContinentVector) => ({ x: a.y*b.z-a.z*b.y, y: a.z*b.x-a.x*b.z, z: a.x*b.y-a.y*b.x });
const makeFrame = (latitude: number, longitude: number) => {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  const center = { x: Math.cos(lat)*Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat)*Math.sin(lon) };
  const east = unit(cross({x:0,y:1,z:0},center));
  return { center, east, north: unit(cross(center,east)) };
};
function smoothOutline(points: readonly ContinentPoint[], samples = 3): ContinentPoint[] {
  const result: ContinentPoint[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[(index + points.length - 1) % points.length], b = points[index], c = points[(index+1)%points.length], d = points[(index+2)%points.length];
    for (let sample=0;sample<samples;sample++) {
      const t=sample/samples, t2=t*t, t3=t2*t;
      result.push([0.5*((2*b[0])+(-a[0]+c[0])*t+(2*a[0]-5*b[0]+4*c[0]-d[0])*t2+(-a[0]+3*b[0]-3*c[0]+d[0])*t3),
        0.5*((2*b[1])+(-a[1]+c[1])*t+(2*a[1]-5*b[1]+4*c[1]-d[1])*t2+(-a[1]+3*b[1]-3*c[1]+d[1])*t3)]);
    }
  }
  return result;
}
const authored = [
  { id:"sunrise", label:"Sunrise Continent", latitude:35.2644, longitude:0, color:0x8ec864, highland:0xaec979, cliff:0xbca471,
    outer:[[0,.56],[.17,.58],[.24,.47],[.37,.49],[.42,.38],[.55,.34],[.60,.17],[.46,.13],[.43,.02],[.55,-.09],[.50,-.23],[.34,-.24],[.33,-.43],[.15,-.51],[.03,-.46],[-.02,-.58],[-.20,-.53],[-.24,-.38],[-.43,-.43],[-.55,-.29],[-.46,-.18],[-.29,-.12],[-.23,.02],[-.37,.12],[-.56,.11],[-.59,.25],[-.43,.38],[-.25,.32],[-.17,.41],[-.19,.53]],
    lakes:[[[-.10,.23],[.02,.25],[.09,.18],[.06,.08],[-.04,.02],[-.15,.07],[-.19,.16]]], scale:.90 },
  { id:"monsoon", label:"Monsoon Peninsula", latitude:-35.2644, longitude:60, color:0x6fb875, highland:0x98c881, cliff:0x8eaa72,
    outer:[[-.15,.59],[.08,.55],[.23,.60],[.39,.47],[.54,.42],[.55,.25],[.39,.24],[.22,.30],[.05,.21],[-.04,.08],[.04,-.07],[.25,-.13],[.42,-.06],[.60,-.13],[.52,-.32],[.34,-.44],[.15,-.49],[-.02,-.59],[-.22,-.54],[-.34,-.37],[-.49,-.34],[-.56,-.16],[-.47,.02],[-.56,.17],[-.48,.34],[-.28,.40]],
    lakes:[], scale:.94 },
  { id:"jade", label:"Jade Mainland", latitude:35.2644, longitude:120, color:0x8bbb6c, highland:0xb2c798, cliff:0x9ba589,
    outer:[[-.29,.50],[-.06,.58],[.11,.54],[.20,.42],[.41,.48],[.58,.34],[.52,.18],[.36,.10],[.43,-.01],[.59,-.06],[.54,-.25],[.39,-.30],[.27,-.46],[.08,-.55],[-.12,-.51],[-.20,-.34],[-.40,-.41],[-.58,-.30],[-.53,-.13],[-.35,-.09],[-.28,.05],[-.48,.12],[-.57,.28],[-.46,.43]],
    lakes:[[[-.11,.23],[.06,.27],[.22,.17],[.20,.04],[.10,-.07],[-.06,-.02],[-.20,.09]]], scale:.94 },
  { id:"ember", label:"Ember Continent", latitude:-35.2644, longitude:180, color:0xb6b769, highland:0xd1bc81, cliff:0xb18165,
    outer:[[-.16,.61],[.03,.55],[.19,.58],[.36,.46],[.43,.27],[.60,.18],[.58,.03],[.39,-.03],[.29,-.15],[.45,-.29],[.40,-.46],[.20,-.49],[.08,-.60],[-.08,-.52],[-.21,-.40],[-.41,-.47],[-.54,-.32],[-.45,-.15],[-.29,-.04],[-.34,.12],[-.57,.19],[-.56,.36],[-.40,.43],[-.32,.58]],
    lakes:[[[-.12,.13],[.04,.17],[.13,.07],[.04,-.05],[-.13,-.07],[-.21,.01]]], scale:.96 },
  { id:"aurora", label:"Aurora Mainland", latitude:35.2644, longitude:-120, color:0xabbf87, highland:0xc9d0b1, cliff:0x95a69b,
    outer:[[-.08,.60],[.13,.54],[.29,.59],[.43,.42],[.58,.36],[.55,.18],[.40,.10],[.48,-.04],[.59,-.14],[.48,-.35],[.29,-.49],[.13,-.43],[.16,-.24],[.04,-.13],[-.11,-.17],[-.20,-.37],[-.33,-.54],[-.49,-.39],[-.52,-.21],[-.39,-.05],[-.51,.10],[-.57,.29],[-.40,.43],[-.21,.38]],
    lakes:[[[-.11,.25],[.04,.27],[.13,.18],[.06,.08],[-.10,.07],[-.18,.15]]], scale:.96 },
  { id:"wildwood", label:"Wildwood Mainland", latitude:-35.2644, longitude:-60, color:0x78ad68, highland:0xa0bc74, cliff:0x9c9c68,
    outer:[[-.23,.55],[-.05,.59],[.16,.50],[.32,.56],[.47,.42],[.43,.25],[.29,.16],[.45,.07],[.58,-.10],[.49,-.28],[.31,-.29],[.25,-.48],[.05,-.57],[-.14,-.48],[-.31,-.55],[-.48,-.38],[-.42,-.22],[-.25,-.14],[-.34,.01],[-.57,.12],[-.56,.31],[-.42,.45]],
    lakes:[[[-.10,.26],[.06,.28],[.21,.20],[.14,.07],[-.02,.02],[-.14,.09]]], scale:1.00 },
] as const;

export const GLOBE_CONTINENTS: readonly GlobeContinent[] = authored.map(item => {
  const scaled = (points: readonly (readonly [number,number])[]) => smoothOutline(points.map(([x,y])=>[x*item.scale*.87,y*item.scale*.87]));
  const coastline = scaled(item.outer), inlandWater = item.lakes.map(scaled);
  return { id:`continent-${item.id}`, label:item.label, ...makeFrame(item.latitude,item.longitude), coastline, inlandWater,
    angularRadius: Math.max(...coastline.map(([x,y])=>Math.hypot(x,y))) + .024,
    color:item.color, highlandColor:item.highland, cliffColor:item.cliff };
});

export function continentPointToGlobe(continent: Pick<GlobeContinent,"center"|"east"|"north">, point: ContinentPoint, radius=1): ContinentVector {
  const angle=Math.hypot(...point), sine=angle<1e-9?1:Math.sin(angle)/angle;
  return {x:radius*(continent.center.x*Math.cos(angle)+(continent.east.x*point[0]+continent.north.x*point[1])*sine),
    y:radius*(continent.center.y*Math.cos(angle)+(continent.east.y*point[0]+continent.north.y*point[1])*sine),
    z:radius*(continent.center.z*Math.cos(angle)+(continent.east.z*point[0]+continent.north.z*point[1])*sine)};
}
export function globePointToContinent(continent: Pick<GlobeContinent,"center"|"east"|"north">, direction: ContinentVector): ContinentPoint {
  const p=unit(direction), cosine=Math.max(-1,Math.min(1,dot(p,continent.center))),angle=Math.acos(cosine);
  // The antipode has no unique tangent bearing; choose one outside every coast.
  if(cosine < -1+1e-12)return [Math.PI,0];
  const factor=angle<1e-8?1:angle/Math.max(1e-8,Math.sin(angle));
  return [dot(p,continent.east)*factor,dot(p,continent.north)*factor];
}
export function pointInsideCoast(point: ContinentPoint, coast: readonly ContinentPoint[]): boolean {
  let inside=false;
  for(let i=0,j=coast.length-1;i<coast.length;j=i++) {
    const a=coast[i],b=coast[j];
    if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function distanceToCoast2D(point: ContinentPoint, coast: readonly ContinentPoint[]): number {
  let closest=Infinity;
  for(let i=0;i<coast.length;i++) {
    const a=coast[i],b=coast[(i+1)%coast.length],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));
    closest=Math.min(closest,Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dy*t));
  }
  return closest;
}
/** Positive ocean / negative mainland. Tangent-distance approximation is intended
 * for visual coastline effects; boat routing uses conservative spherical caps. */
export function getContinentalCoastDistance(direction: ContinentVector): number {
  let closest=Infinity;
  for(const continent of GLOBE_CONTINENTS) {
    const angle=Math.acos(Math.max(-1,Math.min(1,dot(unit(direction),continent.center))));
    if(angle>continent.angularRadius+.5)continue;
    const p=globePointToContinent(continent,direction);
    const outer=distanceToCoast2D(p,continent.coastline);
    const lake=continent.inlandWater.find(hole=>pointInsideCoast(p,hole));
    const inLand=pointInsideCoast(p,continent.coastline)&&!lake;
    const distance=Math.min(outer,...continent.inlandWater.map(hole=>distanceToCoast2D(p,hole)));
    closest=Math.min(closest,inLand?-distance:distance);
  }
  return closest;
}
