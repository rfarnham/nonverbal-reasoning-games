import { crossVec3, dotVec3, normalizeVec3, type Vec3 } from "./globe-geometry.ts";

/** Planet-local directions to the viewer's frame. Keeping all four components
 * preserves roll when a drag crosses either pole. */
export type GlobeOrientation = Readonly<{ x: number; y: number; z: number; w: number }>;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const normalized = (q: GlobeOrientation): GlobeOrientation => {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error("A globe orientation must be finite and nonzero.");
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
};
const inverse = (q: GlobeOrientation): GlobeOrientation => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
function multiply(a: GlobeOrientation, b: GlobeOrientation): GlobeOrientation {
  return normalized({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}
export function rotateGlobeDirection(point: Vec3, orientation: GlobeOrientation): Vec3 {
  const q = normalized(orientation), vector = { x: q.x, y: q.y, z: q.z };
  const first = crossVec3(vector, point), second = crossVec3(vector, first);
  return { x: point.x + 2 * (q.w * first.x + second.x), y: point.y + 2 * (q.w * first.y + second.y), z: point.z + 2 * (q.w * first.z + second.z) };
}
export function globeOrientationFocus(orientation: GlobeOrientation): Vec3 {
  return normalizeVec3(rotateGlobeDirection({ x: 0, y: 0, z: 1 }, inverse(orientation)));
}
/** Authored close views start north-up; this is never recomputed during a drag. */
export function northUpGlobeOrientation(direction: Vec3): GlobeOrientation {
  const focus = normalizeVec3(direction), latitude = Math.atan2(focus.y, Math.hypot(focus.x, focus.z));
  const longitude = Math.atan2(focus.x, focus.z);
  return multiply({ x: Math.sin(latitude / 2), y: 0, z: 0, w: Math.cos(latitude / 2) },
    { x: 0, y: Math.sin(-longitude / 2), z: 0, w: Math.cos(longitude / 2) });
}
/** Drag axes stay in screen space even after passing over a pole. */
export function turnGlobeOrientation(orientation: GlobeOrientation, dx: number, dy: number): GlobeOrientation {
  const angle = Math.hypot(dx, dy);
  if (!Number.isFinite(angle)) throw new Error("A globe turn must be finite.");
  if (angle < 1e-12) return normalized(orientation);
  const scale = Math.sin(angle / 2) / angle;
  return multiply({ x: dy * scale, y: -dx * scale, z: 0, w: Math.cos(angle / 2) }, orientation);
}
/** Move the focus with the shortest rotation, carrying its existing horizon
 * along the surface instead of rebuilding a singular north-up basis. */
export function transportGlobeOrientation(orientation: GlobeOrientation, direction: Vec3): GlobeOrientation {
  const from = globeOrientationFocus(orientation), to = normalizeVec3(direction);
  const cosine = clamp(dotVec3(from, to), -1, 1);
  if (cosine > 1 - 1e-14) return normalized(orientation);
  let rotation: GlobeOrientation;
  if (cosine < -1 + 1e-12) {
    const axis = rotateGlobeDirection({ x: 0, y: 1, z: 0 }, inverse(orientation));
    rotation = { ...axis, w: 0 };
  } else rotation = normalized({ ...crossVec3(from, to), w: 1 + cosine });
  return multiply(orientation, inverse(rotation));
}
export function interpolateGlobeOrientation(from: GlobeOrientation, to: GlobeOrientation, progress: number): GlobeOrientation {
  const start = normalized(from), target = normalized(to), t = clamp(progress, 0, 1);
  let cosine = start.x * target.x + start.y * target.y + start.z * target.z + start.w * target.w;
  const sign = cosine < 0 ? -1 : 1;
  cosine = clamp(Math.abs(cosine), 0, 1);
  const angle = Math.acos(cosine), sine = Math.sin(angle);
  const a = cosine > .9995 ? 1 - t : Math.sin((1 - t) * angle) / sine;
  const b = (cosine > .9995 ? t : Math.sin(t * angle) / sine) * sign;
  return normalized({ x: start.x * a + target.x * b, y: start.y * a + target.y * b, z: start.z * a + target.z * b, w: start.w * a + target.w * b });
}

/** Busy GPUs must slow a voyage instead of skipping a large section of it.
 * Navigation time is separate from practice time and scenery time. */
export function advanceGlobeAnimationTime(elapsedMs: number, frameMs: number, durationMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const step = Number.isFinite(frameMs) ? clamp(frameMs, 0, 40) : 0;
  return Math.min(Math.max(0, durationMs), elapsed + step);
}

export function globeTransitionDuration(from: GlobeOrientation, to: GlobeOrientation, zoomChange: number, minimumMs = 900): number {
  const a = normalized(from), b = normalized(to);
  const angle = 2 * Math.acos(clamp(Math.abs(a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w), 0, 1));
  // Include the tilted close-view camera's change as well as globe rotation.
  return Math.max(minimumMs, (angle + Math.PI / 4 * Math.abs(zoomChange)) * 850);
}

/** One acceleration/deceleration over a voyage. The midpoint stays at full
 * speed unless an explicitly supplied activity needs the ship to stop. */
export function voyageProgress(progress: number): number {
  const t = clamp(progress, 0, 1), ramp = .18, peak = 1 / (1 - ramp);
  if (t < ramp) return peak * (t / 2 - ramp * Math.sin(Math.PI * t / ramp) / (2 * Math.PI));
  if (t > 1 - ramp) return 1 - voyageProgress(1 - t);
  return peak * (t - ramp / 2);
}
