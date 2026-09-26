import { getWorldMapLayout, type MapLayout } from "./map-layouts.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import { GLOBE_CONTINENTS } from "./globe-continent-data.ts";

/** Unit-sphere geometry shared by the painted globe, HTML controls, and travel. */
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type GlobeDestination = Readonly<{
  id: string;
  kind: "teaching" | "boss";
  /** Storm destinations retain the number of their preceding teaching world. */
  worldNumber: number;
  center: Vec3;
  east: Vec3;
  north: Vec3;
  /** Teaching land envelope, or the outer cloud/particle extent of an ocean storm. */
  angularRadius: number;
  harbor: Vec3;
}>;

export const GLOBE_RADIUS = 1;
export const GLOBE_PATCH_HALF_WIDTH = 0.175;
export const GLOBE_REGION_RADIUS = 0.215;
export const GLOBE_HARBOR_RADIUS = 0.277;
/** The visible boat hull is .072 units wide; reserve half-width plus a small buffer. */
export const GLOBE_VOYAGE_CLEARANCE = 0.04;
const OCEAN_MARGIN = GLOBE_VOYAGE_CLEARANCE;
const POLAR_CAPS = [
  { id: "north-polar-ice", center: { x: 0, y: 1, z: 0 }, angularRadius: 0.303 },
  { id: "south-polar-ice", center: { x: 0, y: -1, z: 0 }, angularRadius: 0.303 },
] as const;
const EPSILON = 1e-10;
const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));

export const dotVec3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const addVec3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scaleVec3 = (a: Vec3, scale: number): Vec3 => ({ x: a.x * scale, y: a.y * scale, z: a.z * scale });
export const crossVec3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length < EPSILON || !Number.isFinite(length)) throw new Error("A globe direction must be finite and nonzero.");
  return scaleVec3(value, 1 / length);
}
export const sphericalAngle = (a: Vec3, b: Vec3): number => Math.acos(clamp(dotVec3(normalizeVec3(a), normalizeVec3(b))));

function frame(center: Vec3): Pick<GlobeDestination, "center" | "east" | "north"> {
  const pole = Math.abs(center.y) > 0.98 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const east = normalizeVec3(crossVec3(pole, center));
  return { center, east, north: normalizeVec3(crossVec3(center, east)) };
}

/** Exponential tangent projection preserves radial angular distances and stays on the sphere. */
export function tangentPointToGlobe(region: Pick<GlobeDestination, "center" | "east" | "north">, east: number, north: number, radius = GLOBE_RADIUS): Vec3 {
  const angle = Math.hypot(east, north);
  if (angle < EPSILON) return scaleVec3(region.center, radius);
  const tangent = addVec3(scaleVec3(region.east, east / angle), scaleVec3(region.north, north / angle));
  return scaleVec3(addVec3(scaleVec3(region.center, Math.cos(angle)), scaleVec3(tangent, Math.sin(angle))), radius);
}

/** Six authored continental chains leave broad open oceans between their denser
 * island groups. Coordinates are latitude/longitude, not a uniform sphere lattice. */
const CLUSTER_LAYOUTS = [
  { id: "sunrise", label: "Sunrise Coast", coordinates: [[9.9012, -15.3313], [57.6544, -33.2358], [29.3596, -36.6841], [27.9179, 35.7757], [58.4105, 25.4427], [6.6274, 15.7797]] },
  { id: "monsoon", label: "Monsoon Isles", coordinates: [[-11.3223, 44.6994], [-27.3005, 92.5843], [-6.3576, 72.0966], [-57.5133, 34.263], [-58.358, 88.81]] },
  { id: "jade", label: "Jade Highlands", coordinates: [[28.4462, 85.2901], [7.9278, 107.4803], [28.5271, 155.6401], [55.7466, 92.1322], [56.1217, 144.8905], [6.0003, 136.2316]] },
  { id: "ember", label: "Ember Reach", coordinates: [[-6.3527, -165.6203], [-55.5028, 149.0413], [-27.8718, 148.1199], [-30.0042, -149.0725], [-57.734, -156.1873], [-5.5339, 166.0435]] },
  { id: "aurora", label: "Aurora Coast", coordinates: [[26.7736, -156.2437], [7.1166, -134.8614], [10.5878, -106.115], [56.1574, -97.4856], [56.4113, -149.1319]] },
  { id: "wildwood", label: "Wildwood Passage", coordinates: [[-29.7269, -97.5025], [-5.6146, -75.4145], [-30.3291, -26.2769], [-58.9533, -93.1913], [-58.4185, -31.114], [-6.518, -43.9832]] },
] as const;

function latitudeLongitudeToGlobe(latitude: number, longitude: number): Vec3 {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon) };
}

/** The final onward destination remains deliberately unspecified. These are sea
 * encounters on the course out of their preceding archipelago, never new land. */
export const GLOBE_STORM_PASSAGES = [
  { id: "boss-2025", afterWorld: 16, nextWorld: 17, latitude: 42, longitude: -179, angularRadius: .19 },
  { id: "boss-2026", afterWorld: 32, nextWorld: null, latitude: -27, longitude: 4, angularRadius: .23 },
] as const;

function makeDestinations(): GlobeDestination[] {
  // Keep the original coast reservations while choosing teaching anchorages.
  // Moving a former boss slot must not rotate a teaching harbor or displace its
  // shoreline structures, marine life, stop controls, or saved voyage endpoints.
  const centers = CLUSTER_LAYOUTS.flatMap(cluster => cluster.coordinates.map(([latitude, longitude]) => latitudeLongitudeToGlobe(latitude, longitude)));
  const destinations: GlobeDestination[] = [];
  for (let worldNumber = 1; worldNumber <= 32; worldNumber += 1) {
    const definition = WORLD_DEFINITIONS.find(world => world.number === worldNumber);
    const add = (id: string, kind: GlobeDestination["kind"]) => {
      const basis = frame(centers[destinations.length]);
      destinations.push({ id, kind, worldNumber, ...basis, angularRadius: GLOBE_REGION_RADIUS,
        harbor: tangentPointToGlobe(basis, GLOBE_HARBOR_RADIUS, 0) });
    };
    add(definition?.id ?? `world-${worldNumber}`, "teaching");
    if (worldNumber === 16 || worldNumber === 32) add(worldNumber === 16 ? "boss-2025" : "boss-2026", "boss");
  }
  const coastDestinations = destinations.map((destination, index) => {
    let first = 0;
    const cluster = CLUSTER_LAYOUTS.find(item => { const contains = index < first + item.coordinates.length; if (!contains) first += item.coordinates.length; return contains; })!;
    const clusterCenter = normalizeVec3(destinations.slice(first, first + cluster.coordinates.length).reduce((sum, item) => addVec3(sum, item.center), { x: 0, y: 0, z: 0 }));
    const towardCluster = addVec3(clusterCenter, scaleVec3(destination.center, -dotVec3(clusterCenter, destination.center)));
    const outward = scaleVec3(normalizeVec3(towardCluster), -1);
    const outwardAngle = Math.atan2(dotVec3(outward, destination.north), dotVec3(outward, destination.east));
    const obstacles = [...destinations.filter(item => item !== destination), ...POLAR_CAPS, ...GLOBE_CONTINENTS];
    let harbor: Vec3 | undefined, bestScore = -Infinity;
    for (const radius of [GLOBE_HARBOR_RADIUS, 0.302, 0.327]) for (let step = -10; step <= 10; step++) {
      const angle = outwardAngle + step * Math.PI / 24;
      const candidate = tangentPointToGlobe(destination, Math.cos(angle) * radius, Math.sin(angle) * radius);
      const clearance = Math.min(...obstacles.map(obstacle => sphericalAngle(candidate, obstacle.center) - obstacle.angularRadius));
      if (clearance < OCEAN_MARGIN + 0.008) continue;
      const score = clearance + Math.cos(angle - outwardAngle) * 0.09 - (radius - GLOBE_HARBOR_RADIUS) * 0.5;
      if (score > bestScore) { bestScore = score; harbor = candidate; }
    }
    if (!harbor) throw new Error(`No safe outward harbor for ${destination.id}.`);
    return { ...destination, harbor };
  });
  return coastDestinations.map(destination => {
    const storm = GLOBE_STORM_PASSAGES.find(passage => passage.id === destination.id);
    if (!storm) return destination;
    const basis = frame(latitudeLongitudeToGlobe(storm.latitude, storm.longitude));
    return { ...destination, ...basis, angularRadius: storm.angularRadius, harbor: basis.center };
  });
}

export const GLOBE_DESTINATIONS: readonly GlobeDestination[] = makeDestinations();
export const GLOBE_REGIONS: readonly GlobeDestination[] = GLOBE_DESTINATIONS.filter(region => region.kind === "teaching");
export const GLOBE_BOSS_REGIONS: readonly GlobeDestination[] = GLOBE_DESTINATIONS.filter(region => region.kind === "boss");

export const GLOBE_GEOGRAPHIC_CLUSTERS = CLUSTER_LAYOUTS.map((cluster, index) => {
  const first = CLUSTER_LAYOUTS.slice(0, index).reduce((count, item) => count + item.coordinates.length, 0);
  return { id: cluster.id, label: cluster.label, destinationIds: GLOBE_DESTINATIONS.slice(first, first + cluster.coordinates.length).filter(destination => destination.kind === "teaching").map(destination => destination.id) };
});
/** Conservative envelopes include the irregular frozen coast and coastal icebergs. */
export const GLOBE_POLAR_CAPS: readonly Readonly<{ id: string; center: Vec3; angularRadius: number }>[] = POLAR_CAPS;
export const GLOBE_LAND_OBSTACLES: readonly Readonly<{ id: string; center: Vec3; angularRadius: number }>[] = [
  ...GLOBE_REGIONS.map(({ id, center, angularRadius }) => ({ id, center, angularRadius })), ...GLOBE_POLAR_CAPS, ...GLOBE_CONTINENTS,
];


export function getGlobeDestination(id: string | number): GlobeDestination {
  const region = typeof id === "number"
    ? GLOBE_REGIONS.find(candidate => candidate.worldNumber === id)
    : GLOBE_DESTINATIONS.find(candidate => candidate.id === id);
  if (!region) throw new Error(`Unknown globe destination: ${id}`);
  return region;
}
export const getGlobeRegion = (worldNumber: number): GlobeDestination => getGlobeDestination(worldNumber);

/** Percentages use the authored map rectangle; y grows downward in that rectangle. */
export function mapPointToGlobe(worldNumber: number, xPercent: number, yPercent: number, mobile = false, radius = GLOBE_RADIUS): Vec3 {
  const halfWidth = mobile ? 0.075 : GLOBE_PATCH_HALF_WIDTH;
  const halfHeight = mobile ? 0.18 : GLOBE_PATCH_HALF_WIDTH * 740 / 1200;
  return tangentPointToGlobe(getGlobeRegion(worldNumber), (xPercent / 50 - 1) * halfWidth, (1 - yPercent / 50) * halfHeight, radius);
}

/** Stable even for coincident and antipodal directions; t is clamped to the segment. */
export function sphericalInterpolate(a: Vec3, b: Vec3, t: number, radius = GLOBE_RADIUS): Vec3 {
  const start = normalizeVec3(a), end = normalizeVec3(b), fraction = clamp(t, 0, 1);
  if (fraction === 0) return scaleVec3(start, radius);
  if (fraction === 1) return scaleVec3(end, radius);
  const cosine = clamp(dotVec3(start, end));
  if (cosine > 1 - EPSILON) return scaleVec3(normalizeVec3(addVec3(scaleVec3(start, 1 - fraction), scaleVec3(end, fraction))), radius);
  const angle = Math.acos(cosine);
  const difference = addVec3(end, scaleVec3(start, -cosine));
  // A fixed perpendicular chooses one deterministic half-circle at the antipode.
  const tangent = Math.hypot(difference.x, difference.y, difference.z) < EPSILON ? frame(start).east : normalizeVec3(difference);
  return scaleVec3(addVec3(scaleVec3(start, Math.cos(angle * fraction)), scaleVec3(tangent, Math.sin(angle * fraction))), radius);
}

function sampleCurve(path: string, layout: MapLayout, worldNumber: number, mobile: boolean, radius: number): Vec3[] {
  const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (values?.length !== 8) throw new Error("Globe roads require one authored cubic curve.");
  const [x0, y0, x1, y1, x2, y2, x3, y3] = values;
  return Array.from({ length: 65 }, (_, index) => {
    const t = index / 64, u = 1 - t;
    const x = u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3;
    const y = u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3;
    return mapPointToGlobe(worldNumber, x / layout.width * 100, y / layout.height * 100, mobile, radius);
  });
}

export function getGlobeRoadPoints(worldNumber: number, stopCount: number, roadIndex: number, mobile = false, radius = GLOBE_RADIUS): Vec3[] {
  const layout = getWorldMapLayout(worldNumber, stopCount)[mobile ? "mobile" : "desktop"];
  const path = layout.roads[roadIndex];
  if (!path) throw new Error(`No globe road ${roadIndex} in world ${worldNumber}.`);
  return sampleCurve(path, layout, worldNumber, mobile, radius);
}

export function getGlobeMap(worldNumber: number, stopCount = WORLD_DEFINITIONS.find(world => world.number === worldNumber)?.stopIds.length ?? 4, mobile = false, radius = GLOBE_RADIUS) {
  const layout = getWorldMapLayout(worldNumber, stopCount)[mobile ? "mobile" : "desktop"];
  return {
    region: getGlobeRegion(worldNumber), layout,
    stops: layout.stopPoints.map((point, index) => ({ index, ...point, point: mapPointToGlobe(worldNumber, point.x, point.y, mobile, radius) })),
    books: layout.books.map(book => ({ ...book, point: mapPointToGlobe(worldNumber, book.x, book.y, mobile, radius) })),
    islands: layout.islands.map(island => ({ ...island, point: mapPointToGlobe(worldNumber, island.x / layout.width * 100, island.y / layout.height * 100, mobile, radius) })),
    roads: layout.roads.map(path => sampleCurve(path, layout, worldNumber, mobile, radius)),
    storyPaths: layout.storyPaths.map(path => sampleCurve(path, layout, worldNumber, mobile, radius)),
  };
}

/** Minimum angular distance from a direction to an entire minor great-circle arc. */
export function distanceToSurfaceArc(center: Vec3, from: Vec3, to: Vec3): number {
  const a = normalizeVec3(from), b = normalizeVec3(to), c = normalizeVec3(center);
  const angle = sphericalAngle(a, b);
  if (angle < EPSILON) return sphericalAngle(c, a);
  if (Math.PI - angle < EPSILON) {
    const middle = sphericalInterpolate(a, b, 0.5);
    return Math.min(distanceToSurfaceArc(c, a, middle), distanceToSurfaceArc(c, middle, b));
  }
  const tangent = normalizeVec3(addVec3(b, scaleVec3(a, -Math.cos(angle))));
  const along = dotVec3(c, a), across = dotVec3(c, tangent);
  const extremum = Math.atan2(across, along);
  const maximum = extremum >= 0 && extremum <= angle ? Math.hypot(along, across) : Math.max(dotVec3(c, a), dotVec3(c, b));
  return Math.acos(clamp(maximum));
}

const coastCount = 16;
type OceanGraph = { nodes: Vec3[]; edges: { to: number; length: number }[][] };
let oceanGraph: OceanGraph | undefined;
const voyageCache = new Map<string, readonly Vec3[]>();
const routeLengths = new WeakMap<readonly Vec3[], readonly number[]>();

function clearOceanArc(from: Vec3, to: Vec3): boolean {
  return GLOBE_LAND_OBSTACLES.every(region => distanceToSurfaceArc(region.center, from, to) >= region.angularRadius + OCEAN_MARGIN - EPSILON);
}

/** Round graph corners with tangent-continuous spherical quadratic bends.
 * Every chord is checked against the same complete hull-clearance envelopes
 * used by the ocean graph; a tighter harbor receives a smaller bend. */
function roundedOceanRoute(waypoints: readonly Vec3[]): Vec3[] {
  const samples: Vec3[] = [waypoints[0]];
  const connect = (end: Vec3) => {
    const start = samples.at(-1)!;
    const count = Math.max(1, Math.ceil(sphericalAngle(start, end) / .008));
    for (let step = 1; step <= count; step++) samples.push(sphericalInterpolate(start, end, step / count));
  };
  for (let index = 1; index < waypoints.length - 1; index++) {
    const before = waypoints[index - 1], corner = waypoints[index], after = waypoints[index + 1];
    const incoming = sphericalAngle(before, corner), outgoing = sphericalAngle(corner, after);
    let trim = Math.min(.09, incoming * .3, outgoing * .3), bend: Vec3[] | undefined;
    for (let attempt = 0; attempt < 9 && trim > 1e-5; attempt++, trim *= .5) {
      const entry = sphericalInterpolate(corner, before, trim / incoming);
      const exit = sphericalInterpolate(corner, after, trim / outgoing);
      // Dense samples keep the rendered hull's heading continuous as well as
      // proving that the actual polyline cannot graze a coastline between points.
      const candidate = Array.from({ length: 65 }, (_, step) => {
        const t = step / 64;
        return sphericalInterpolate(sphericalInterpolate(entry, corner, t), sphericalInterpolate(corner, exit, t), t);
      });
      if (candidate.slice(1).every((point, step) => clearOceanArc(candidate[step], point))) { bend = candidate; break; }
    }
    if (bend) { connect(bend[0]); samples.push(...bend.slice(1)); }
    else connect(corner);
  }
  connect(waypoints.at(-1)!);
  return samples;
}

function getOceanGraph(): OceanGraph {
  if (oceanGraph) return oceanGraph;
  const nodes = GLOBE_DESTINATIONS.flatMap(region => Array.from({ length: coastCount }, (_, index) => {
    if (index === 0) return region.harbor;
    const portAngle = Math.atan2(dotVec3(region.harbor, region.north), dotVec3(region.harbor, region.east));
    const angle = portAngle + index / coastCount * Math.PI * 2;
    return tangentPointToGlobe(region, Math.cos(angle) * GLOBE_HARBOR_RADIUS, Math.sin(angle) * GLOBE_HARBOR_RADIUS);
  }));
  // Polar shore nodes let long voyages go around the ice rather than crossing it.
  for (const cap of GLOBE_POLAR_CAPS) for (let index = 0; index < 32; index++) {
    const angle = index * Math.PI / 16;
    nodes.push(tangentPointToGlobe(frame(cap.center), Math.cos(angle) * (cap.angularRadius + OCEAN_MARGIN + 0.025), Math.sin(angle) * (cap.angularRadius + OCEAN_MARGIN + 0.025)));
  }
  for (const continent of GLOBE_CONTINENTS) for (let index = 0; index < 48; index++) {
    const angle = index * Math.PI / 24;
    nodes.push(tangentPointToGlobe(continent, Math.cos(angle) * (continent.angularRadius + OCEAN_MARGIN + .025), Math.sin(angle) * (continent.angularRadius + OCEAN_MARGIN + .025)));
  }
  const edges: OceanGraph["edges"] = nodes.map(() => []);
  for (let from = 0; from < nodes.length; from += 1) for (let to = from + 1; to < nodes.length; to += 1) {
    const length = sphericalAngle(nodes[from], nodes[to]);
    if (length > 0.9 || !clearOceanArc(nodes[from], nodes[to])) continue;
    edges[from].push({ to, length });
    edges[to].push({ to: from, length });
  }
  oceanGraph = { nodes, edges };
  return oceanGraph;
}

/** Boat routes follow the ocean around conservative land envelopes, including QA jumps. */
export function getVoyageRoute(fromId: string | number, toId: string | number): readonly Vec3[] {
  const from = getGlobeDestination(fromId), to = getGlobeDestination(toId);
  if (from === to) return [{ ...from.harbor }];
  const key = `${from.id}:${to.id}`;
  const cached = voyageCache.get(key);
  if (cached) return cached.map(point => ({ ...point }));
  const graph = getOceanGraph();
  const source = GLOBE_DESTINATIONS.indexOf(from) * coastCount;
  const target = GLOBE_DESTINATIONS.indexOf(to) * coastCount;
  const lengths = graph.nodes.map(() => Infinity), previous = graph.nodes.map(() => -1), visited = new Set<number>();
  lengths[source] = 0;
  while (visited.size < graph.nodes.length) {
    let current = -1;
    for (let index = 0; index < lengths.length; index += 1) if (!visited.has(index) && (current < 0 || lengths[index] < lengths[current])) current = index;
    if (current < 0 || !Number.isFinite(lengths[current])) throw new Error("The globe ocean route is disconnected.");
    if (current === target) break;
    visited.add(current);
    for (const edge of graph.edges[current]) {
      const length = lengths[current] + edge.length;
      if (length < lengths[edge.to]) { lengths[edge.to] = length; previous[edge.to] = current; }
    }
  }
  const waypoints = [graph.nodes[target]];
  for (let current = target; current !== source;) {
    current = previous[current];
    if (current < 0) throw new Error("Missing globe voyage predecessor.");
    waypoints.unshift(graph.nodes[current]);
  }
  // Remove unnecessary graph corners without ever cutting across a land cap.
  const simplified = [waypoints[0]];
  for (let current = 0; current < waypoints.length - 1;) {
    let next = waypoints.length - 1;
    while (next > current + 1 && !clearOceanArc(waypoints[current], waypoints[next])) next -= 1;
    simplified.push(waypoints[next]); current = next;
  }
  const samples = roundedOceanRoute(simplified);
  // Preserve exact shared dock coordinates for boat/HTML/camera alignment.
  samples[0] = from.harbor; samples[samples.length - 1] = to.harbor;
  voyageCache.set(key, samples);
  voyageCache.set(`${to.id}:${from.id}`, [...samples].reverse());
  return samples.map(point => ({ ...point }));
}

function surfaceRouteLengths(points: readonly Vec3[]): readonly number[] {
  if (!points.length) throw new Error("A surface route must contain a point.");
  const cached = routeLengths.get(points);
  if (cached) return cached;
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) lengths.push(lengths[index - 1] + sphericalAngle(points[index - 1], points[index]));
  routeLengths.set(points, lengths);
  return lengths;
}

export function getSurfaceRouteLength(points: readonly Vec3[]): number { return surfaceRouteLengths(points).at(-1)!; }

export function sampleSurfaceRoute(points: readonly Vec3[], progress: number, radius = GLOBE_RADIUS): Vec3 {
  const lengths = surfaceRouteLengths(points);
  if (points.length === 1) return scaleVec3(normalizeVec3(points[0]), radius);
  const distance = clamp(progress, 0, 1) * lengths.at(-1)!;
  if (distance <= EPSILON) return scaleVec3(normalizeVec3(points[0]), radius);
  let low = 1, high = lengths.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lengths[middle] < distance) low = middle + 1; else high = middle;
  }
  const index = low;
  const segmentLength = lengths[index] - lengths[index - 1];
  return sphericalInterpolate(points[index - 1], points[index], segmentLength < EPSILON ? 1 : (distance - lengths[index - 1]) / segmentLength, radius);
}

export function getSurfaceRouteTangent(points: readonly Vec3[], progress: number): Vec3 {
  const point = sampleSurfaceRoute(points, progress);
  const before = sampleSurfaceRoute(points, Math.max(0, progress - 0.001));
  const after = sampleSurfaceRoute(points, Math.min(1, progress + 0.001));
  const movement = addVec3(after, scaleVec3(before, -1));
  const tangent = addVec3(movement, scaleVec3(point, -dotVec3(point, movement)));
  return Math.hypot(tangent.x, tangent.y, tangent.z) < EPSILON ? frame(point).east : normalizeVec3(tangent);
}
