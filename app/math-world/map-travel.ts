import { BREAK_STOPS, REQUIRED_STOPS } from "./world-data.ts";

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
  { stopId: "turbo-wharf", junctionStopId: "number-bridge", path: "M276 414.4C248 373 246 273 264 199.8" },
  { stopId: "pattern-picnic", junctionStopId: "orchard-market", path: "M540 377.4C554 297 574 230 612 170.2" },
];

export const mobileBonusRoad = [
  { stopId: "turbo-wharf", junctionStopId: "digit-dunes", path: "M116 672C71 695 82 736 92 768" },
  { stopId: "pattern-picnic", junctionStopId: "shape-shore", path: "M108 480C176 458 252 482 292 480" },
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
const mobileSamples = mobileRoad.map(sampleRoadSegment);
const desktopBonusSamples = new Map(desktopBonusRoad.map(({ stopId, path }) => [stopId, sampleRoadSegment(path)]));
const mobileBonusSamples = new Map(mobileBonusRoad.map(({ stopId, path }) => [stopId, sampleRoadSegment(path)]));

/**
 * Percentage coordinates along the actual coast road, including intermediate stops.
 * The caller controls duration, easing, reduced motion, and cancellation.
 * Optional destinations follow the required road to their painted branch junction.
 * Unknown IDs or optional origins have no route and return an empty array.
 */
export function getMapTravelPoints(fromStopId: string, toStopId: string, mobile = false): MapTravelPoint[] {
  const fromIndex = REQUIRED_STOPS.findIndex(({ id }) => id === fromStopId);
  const toIndex = REQUIRED_STOPS.findIndex(({ id }) => id === toStopId);
  if (fromIndex < 0) return [];

  const width = mobile ? 400 : 1200;
  const height = mobile ? 960 : 740;
  const branch = (mobile ? mobileBonusRoad : desktopBonusRoad).find(({ stopId }) => stopId === toStopId);
  if (branch) {
    const destination = BREAK_STOPS.find(({ id }) => id === toStopId)!;
    const branchSamples = (mobile ? mobileBonusSamples : desktopBonusSamples).get(toStopId)!;
    const points = getMapTravelPoints(fromStopId, branch.junctionStopId, mobile);
    for (const point of branchSamples.slice(1, -1)) {
      points.push({ x: point.x / width * 100, y: point.y / height * 100 });
    }
    points.push(mobile ? { x: destination.mobileX, y: destination.mobileY } : { x: destination.x, y: destination.y });
    return points;
  }
  if (toIndex < 0) return [];

  const stopPoint = (index: number): MapTravelPoint => {
    const stop = REQUIRED_STOPS[index];
    return mobile ? { x: stop.mobileX, y: stop.mobileY } : { x: stop.x, y: stop.y };
  };
  if (fromIndex === toIndex) return [stopPoint(fromIndex)];

  const samples = mobile ? mobileSamples : desktopSamples;
  const first = Math.min(fromIndex, toIndex);
  const last = Math.max(fromIndex, toIndex);
  const points: MapTravelPoint[] = [stopPoint(first)];
  for (let index = first; index < last; index += 1) {
    for (const point of samples[index].slice(1, -1)) {
      points.push({ x: point.x / width * 100, y: point.y / height * 100 });
    }
    points.push(stopPoint(index + 1));
  }
  return fromIndex > toIndex ? points.reverse() : points;
}
