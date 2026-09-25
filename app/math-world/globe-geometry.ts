import { getWorldMapLayout, type MapLayout } from "./map-layouts.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";

/** Unit-sphere geometry shared by the painted globe, HTML controls, and travel. */
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type GlobeDestination = Readonly<{
  id: string;
  kind: "teaching" | "boss";
  /** Boss regions retain the number of their preceding teaching world. */
  worldNumber: number;
  center: Vec3;
  east: Vec3;
  north: Vec3;
  angularRadius: number;
  harbor: Vec3;
}>;

export const GLOBE_RADIUS = 1;
export const GLOBE_PATCH_HALF_WIDTH = 0.175;
export const GLOBE_REGION_RADIUS = 0.215;
export const GLOBE_HARBOR_RADIUS = 0.25;
const OCEAN_CLEARANCE = GLOBE_REGION_RADIUS + 0.006;
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

function destinationCenters(): Vec3[] {
  // A fixed Fibonacci distribution gives every archipelago real ocean around it.
  // A deterministic nearest-neighbor tour keeps most consecutive boat rides local.
  const count = 34;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const remaining = Array.from({ length: count }, (_, index) => {
    const y = 1 - 2 * (index + 0.5) / count;
    const ringRadius = Math.sqrt(1 - y * y);
    return { x: Math.cos(index * goldenAngle) * ringRadius, y, z: Math.sin(index * goldenAngle) * ringRadius };
  });
  const ordered = [remaining.splice(12, 1)[0]];
  while (remaining.length) {
    let closest = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (dotVec3(ordered.at(-1)!, remaining[index]) > dotVec3(ordered.at(-1)!, remaining[closest])) closest = index;
    }
    ordered.push(remaining.splice(closest, 1)[0]);
  }
  return ordered;
}

function makeDestinations(): GlobeDestination[] {
  const centers = destinationCenters();
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
  return destinations;
}

export const GLOBE_DESTINATIONS: readonly GlobeDestination[] = makeDestinations();
export const GLOBE_REGIONS: readonly GlobeDestination[] = GLOBE_DESTINATIONS.filter(region => region.kind === "teaching");
export const GLOBE_BOSS_REGIONS: readonly GlobeDestination[] = GLOBE_DESTINATIONS.filter(region => region.kind === "boss");

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

function clearOceanArc(from: Vec3, to: Vec3): boolean {
  return GLOBE_DESTINATIONS.every(region => distanceToSurfaceArc(region.center, from, to) >= OCEAN_CLEARANCE - EPSILON);
}

function getOceanGraph(): OceanGraph {
  if (oceanGraph) return oceanGraph;
  const nodes = GLOBE_DESTINATIONS.flatMap(region => Array.from({ length: coastCount }, (_, index) => {
    const angle = index / coastCount * Math.PI * 2;
    return tangentPointToGlobe(region, Math.cos(angle) * GLOBE_HARBOR_RADIUS, Math.sin(angle) * GLOBE_HARBOR_RADIUS);
  }));
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
  const samples = [simplified[0]];
  for (let index = 1; index < simplified.length; index += 1) {
    const start = simplified[index - 1], end = simplified[index];
    const steps = Math.max(1, Math.ceil(sphericalAngle(start, end) / 0.012));
    for (let step = 1; step <= steps; step += 1) samples.push(sphericalInterpolate(start, end, step / steps));
  }
  // Preserve exact shared dock coordinates for boat/HTML/camera alignment.
  samples[0] = from.harbor; samples[samples.length - 1] = to.harbor;
  voyageCache.set(key, samples);
  voyageCache.set(`${to.id}:${from.id}`, [...samples].reverse());
  return samples.map(point => ({ ...point }));
}

export function sampleSurfaceRoute(points: readonly Vec3[], progress: number, radius = GLOBE_RADIUS): Vec3 {
  if (!points.length) throw new Error("A surface route must contain a point.");
  if (points.length === 1) return scaleVec3(normalizeVec3(points[0]), radius);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) lengths.push(lengths[index - 1] + sphericalAngle(points[index - 1], points[index]));
  const distance = clamp(progress, 0, 1) * lengths.at(-1)!;
  if (distance <= EPSILON) return scaleVec3(normalizeVec3(points[0]), radius);
  let index = 1;
  while (index < lengths.length - 1 && lengths[index] < distance) index += 1;
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
