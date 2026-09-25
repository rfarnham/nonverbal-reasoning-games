import assert from "node:assert/strict";
import test from "node:test";
import { placeOccupiedStopBadge, placeStopCaption } from "../app/math-world/globe-marker-layout.ts";

test("an occupied stop keeps its full touch target clear of a nearby storybook", () => {
  const anchor = { x: 190, y: 190 };
  const book = { x: 180, y: 222 };
  for (const narrow of [true, false]) {
    const offset = placeOccupiedStopBadge(anchor, [book], 360, 450, narrow);
    const center = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    assert.ok(center.y > anchor.y, "the badge leaves the animal visible above it");
    assert.ok(Math.abs(center.x - book.x) >= (narrow ? 44 : 48) || Math.abs(center.y - book.y) >= (narrow ? 44 : 48), "neither full target overlaps the other");
    assert.ok(center.x >= 24 && center.x <= 336 && center.y <= 426);
  }
});

test("a dense summit uses a wider annotation lane instead of covering the animal", () => {
  const anchor = { x: 437, y: 202 };
  const neighbors = [{ x: 410, y: 242 }, { x: 560, y: 195 }, { x: 536, y: 300 }, { x: 267, y: 317 }, { x: 209, y: 222 }];
  const offset = placeOccupiedStopBadge(anchor, neighbors, 786, 531, false);
  assert.ok(offset.y > 0);
  assert.ok(neighbors.every(point => Math.abs(anchor.x + offset.x - point.x) >= 64 || anchor.y + offset.y - point.y >= 51 || point.y - anchor.y - offset.y >= 78));
  assert.equal(placeStopCaption(anchor, neighbors, 786, 531), "left");
  assert.equal(placeStopCaption({ x: 698, y: 266 }, [{ x: 666, y: 320 }, { x: 860, y: 258 }], 1278, 701), "right");
});

test("badge placement keeps edge targets onscreen and leaves clear layouts stable", () => {
  assert.deepEqual(placeOccupiedStopBadge({ x: 180, y: 200 }, [], 360, 450, true), { x: 0, y: 22 });
  const edge = { x: 328, y: 300 };
  const offset = placeOccupiedStopBadge(edge, [{ x: 328, y: 330 }], 360, 450, true);
  assert.ok(edge.x + offset.x >= 24 && edge.x + offset.x <= 336);
  assert.ok(Math.abs(offset.x) >= 44 || Math.abs(edge.y + offset.y - 330) >= 44);
});
