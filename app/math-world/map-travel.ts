import { getWorldMapLayout } from "./map-layouts.ts";
import { BREAK_STOPS, REQUIRED_STOPS, WORLD_DEFINITIONS, WORLD_MODE } from "./world-data.ts";

export type MapTravelPoint = { x: number; y: number };

/** Shared by the painted road and avatar travel so their geometry cannot drift. */
export const desktopRoad = [
  "M120 540.2 C169 529 204 418 276 414.4",
  "M276 414.4 C339 406 318 550 420 562.4",
  "M420 562.4 C494 571 477 415 540 377.4",
  "M540 377.4 C615 345 635 477 708 481",
  "M708 481 C790 491 766 346 816 325.6",
  "M816 325.6 C885 295 883 426 960 399.6",
  "M960 399.6 C1025 377 923 228 936 177.6",
  "M936 177.6 C950 132 1030 152 1080 155.4",
];

export const mobileRoad = [
  "M108 854.4 C148 817 237 809 280 768",
  "M280 768 C328 709 155 725 116 672",
  "M116 672 C72 614 254 624 272 576",
  "M272 576 C302 521 128 526 108 480",
  "M108 480 C78 432 248 429 276 384",
  "M276 384 C308 329 141 338 112 288",
  "M112 288 C79 235 246 246 272 192",
  "M272 192 C292 151 220 136 176 96",
];

// These are visual junctions, independent of a detour's progress unlock rule.
export const desktopBonusRoad = [
  { stopId: "turbo-wharf", junctionStopId: "number-bridge", junctionSlot: 1, path: "M276 414.4C248 373 246 273 264 199.8" },
  { stopId: "pattern-picnic", junctionStopId: "orchard-market", junctionSlot: 3, path: "M540 377.4C554 297 574 230 612 170.2" },
];

export const mobileBonusRoad = [
  { stopId: "turbo-wharf", junctionStopId: "digit-dunes", junctionSlot: 2, path: "M116 672C71 695 82 736 92 768" },
  { stopId: "pattern-picnic", junctionStopId: "shape-shore", junctionSlot: 4, path: "M108 480C176 458 252 482 292 480" },
];

const CURVE_SUBDIVISIONS = 160;
const TARGET_SPACING = 10;

function sampleRoadSegment(path: string): MapTravelPoint[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const dense: MapTravelPoint[] = [];
  const lengths = [0];
  for (let index = 0; index <= CURVE_SUBDIVISIONS; index += 1) {
    const t = index / CURVE_SUBDIVISIONS;
    const u = 1 - t;
    const point = {
      x: u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
      y: u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
    };
    dense.push(point);
    if (index > 0) {
      const previous = dense[index - 1];
      lengths.push(lengths[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
    }
  }

  const totalLength = lengths[lengths.length - 1];
  const steps = Math.max(1, Math.ceil(totalLength / TARGET_SPACING));
  const points = [dense[0]];
  let cursor = 1;
  // Arc-length resampling avoids slowing down at a cubic's closely spaced t values.
  for (let index = 1; index < steps; index += 1) {
    const distance = totalLength * index / steps;
    while (lengths[cursor] < distance) cursor += 1;
    const start = dense[cursor - 1];
    const end = dense[cursor];
    const fraction = (distance - lengths[cursor - 1]) / (lengths[cursor] - lengths[cursor - 1]);
    points.push({ x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction });
  }
  points.push(dense[dense.length - 1]);
  return points;
}

const desktopSamples = desktopRoad.map(sampleRoadSegment);
const authoredSamples = new Map<string, MapTravelPoint[][]>();
function worldSamples(worldNumber: number, mobile: boolean, stopCount: number): MapTravelPoint[][] {
  const key = `${worldNumber}:${mobile}:${stopCount}`;
  let samples = authoredSamples.get(key);
  if (!samples) {
    const layout = getWorldMapLayout(worldNumber, stopCount)[mobile ? "mobile" : "desktop"];
    samples = layout.roads.map(sampleRoadSegment);
    authoredSamples.set(key, samples);
  }
  return samples;
}
const mobileSamples = mobileRoad.map(sampleRoadSegment);
const desktopBonusSamples = desktopBonusRoad.map(({ path }) => sampleRoadSegment(path));
const mobileBonusSamples = mobileBonusRoad.map(({ path }) => sampleRoadSegment(path));

/**
 * Percentage coordinates along the selected world's painted roads. The spiral
 * has two to four authored anchors per world; prototype routes retain their original
 * unnumbered junctions. Story islands do not change quiz travel or progression.
 */
export function getMapTravelPoints(fromStopId: string, toStopId: string, mobile = false): MapTravelPoint[] {
  const origin = REQUIRED_STOPS.find(({ id }) => id === fromStopId);
  const destination = REQUIRED_STOPS.find(({ id }) => id === toStopId)
    ?? BREAK_STOPS.find(({ id }) => id === toStopId);
  if (!origin || !destination || origin.worldId !== destination.worldId) return [];

  const width = mobile ? 400 : 1200;
  const height = mobile ? 960 : 740;
  const world = WORLD_DEFINITIONS.find(candidate => candidate.id === origin.worldId);
  if (!world) return [];
  const samples = WORLD_MODE === "spiral-preview"
    ? worldSamples(world.number, mobile, world.stopIds.length)
    : mobile ? mobileSamples : desktopSamples;
  const toPercentage = ({ x, y }: MapTravelPoint): MapTravelPoint => ({ x: x / width * 100, y: y / height * 100 });
  const slotPoint = (slot: number): MapTravelPoint => {
    const point = toPercentage(slot === samples.length ? samples.at(-1)!.at(-1)! : samples[slot][0]);
    // Authored anchors are percentages; avoid tiny binary rounding drift at joins.
    return { x: Math.round(point.x * 1e10) / 1e10, y: Math.round(point.y * 1e10) / 1e10 };
  };
  const betweenSlots = (fromSlot: number, toSlot: number): MapTravelPoint[] => {
    if (fromSlot < 0 || fromSlot > samples.length || toSlot < 0 || toSlot > samples.length) return [];
    if (fromSlot === toSlot) return [slotPoint(fromSlot)];
    const first = Math.min(fromSlot, toSlot);
    const last = Math.max(fromSlot, toSlot);
    const points: MapTravelPoint[] = [slotPoint(first)];
    for (let slot = first; slot < last; slot += 1) {
      points.push(...samples[slot].slice(1, -1).map(toPercentage), slotPoint(slot + 1));
    }
    return fromSlot > toSlot ? points.reverse() : points;
  };
  const pointForStop = (stop: typeof origin | typeof destination): MapTravelPoint => mobile
    ? { x: stop.mobileX, y: stop.mobileY }
    : { x: stop.x, y: stop.y };

  if (destination.kind === "turbo" || destination.kind === "minigame") {
    if (WORLD_MODE !== "prototype") return [];
    const branchIndex = destination.kind === "turbo" ? 0 : 1;
    const branch = (mobile ? mobileBonusRoad : desktopBonusRoad)[branchIndex];
    const branchSamples = (mobile ? mobileBonusSamples : desktopBonusSamples)[branchIndex];
    const points = betweenSlots(origin.mapSlot, branch.junctionSlot);
    points.push(...branchSamples.slice(1, -1).map(toPercentage), pointForStop(destination));
    points[0] = pointForStop(origin);
    return points;
  }

  if (!("mapSlot" in destination)) return [];
  const points = betweenSlots(origin.mapSlot, destination.mapSlot);
  if (points.length > 0) {
    points[0] = pointForStop(origin);
    points[points.length - 1] = pointForStop(destination);
  }
  return points;
}
