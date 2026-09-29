export type MarkerPoint = Readonly<{ x: number; y: number }>;

/** Keep an occupied stop's badge below its animal without covering a book or
 * another native target. Only the annotation moves; its ground anchor stays put. */
export function placeOccupiedStopBadge(anchor: MarkerPoint, neighbors: readonly MarkerPoint[], width: number, height: number, narrow: boolean): MarkerPoint {
  const below = narrow ? 22 : 26;
  const half = narrow ? 22 : 24;
  const separation = half * 2 + 3;
  const horizontalClearance = narrow ? separation : 64;
  const belowClearance = narrow ? separation : 78;
  const candidates = [[0, below], [32, below], [-32, below], [50, below], [-50, below], [72, below], [-72, below], [0, 52], [32, 52], [-32, 52], [50, 52], [-50, 52], [0, 78]];
  // Dense book/island arrangements need a wider annotation lane. Search nearby
  // space before falling back onto the animal's feet during clipped travel.
  candidates.push(...[below, 52, 78, 104].flatMap(y => [0, 72, -72, 96, -96, 120, -120, 144, -144].map(x => [x, y])).sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1])));
  for (const [x, y] of candidates) {
    const center = { x: anchor.x + x, y: anchor.y + y };
    if (center.x < (narrow ? half + 2 : 38) || center.x > width - (narrow ? half + 2 : 38) || center.y > height - (narrow ? half + 2 : 52)) continue;
    if (neighbors.every(point => Math.abs(center.x - point.x) >= horizontalClearance || center.y - point.y >= separation || point.y - center.y >= belowClearance)) return { x, y };
  }
  // A dense or temporarily clipped travel frame keeps its original valid native
  // target rather than moving it over another control. The animal still travels.
  return { x: 0, y: 0 };
}

/** Short captions can sit alongside a badge when a nearby book fills the space
 * beneath it. Reserve the widest caption, so text never covers a native target. */
export function placeStopCaption(anchor: MarkerPoint, neighbors: readonly MarkerPoint[], width: number, height: number): "below" | "right" | "left" | "hidden" {
  const candidates = [{ side: "below", x: 0, y: 40 }, { side: "right", x: 67, y: 0 }, { side: "left", x: -67, y: 0 }] as const;
  for (const candidate of candidates) {
    const x = anchor.x + candidate.x, y = anchor.y + candidate.y;
    if (x < 38 || x > width - 38 || y < 11 || y > height - 11) continue;
    if (neighbors.every(point => Math.abs(x - point.x) >= 64 || Math.abs(y - point.y) >= 37)) return candidate.side;
  }
  // The same stop name remains in the native accessible name and ordered list.
  return "hidden";
}
