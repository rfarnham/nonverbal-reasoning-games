import assert from "node:assert/strict";
import test from "node:test";

import {
  COSMETIC_JOURNEY_LEVELS,
  cosmeticJourneyLevelCrossed,
  cosmeticJourneyLevelForXp,
} from "../lib/progression/cosmetic-levels.ts";

test("cosmetic Journey levels use a fixed, increasing XP schedule", () => {
  assert.equal(COSMETIC_JOURNEY_LEVELS[0].xpRequired, 0);
  assert.deepEqual(
    COSMETIC_JOURNEY_LEVELS.map(({ level }) => level),
    Array.from(
      { length: COSMETIC_JOURNEY_LEVELS.length },
      (_, index) => index + 1,
    ),
  );
  for (let index = 1; index < COSMETIC_JOURNEY_LEVELS.length; index += 1) {
    assert.ok(
      COSMETIC_JOURNEY_LEVELS[index].xpRequired >
        COSMETIC_JOURNEY_LEVELS[index - 1].xpRequired,
    );
  }
});

test("cosmetic levels derive from lifetime XP without changing progression", () => {
  assert.equal(cosmeticJourneyLevelForXp(0).level, 1);
  assert.equal(cosmeticJourneyLevelForXp(99).level, 1);
  assert.equal(cosmeticJourneyLevelForXp(100).level, 2);
  assert.equal(cosmeticJourneyLevelForXp(47_575).level, 16);
});

test("cosmetic levels work in legacy browsers without Array.findLast", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "findLast",
  );
  try {
    Object.defineProperty(Array.prototype, "findLast", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    assert.equal(cosmeticJourneyLevelForXp(6_000).level, 9);
    assert.equal(cosmeticJourneyLevelCrossed(5_975, 6_000)?.level, 9);
  } finally {
    if (descriptor) {
      Object.defineProperty(Array.prototype, "findLast", descriptor);
    } else {
      delete Array.prototype.findLast;
    }
  }
});

test("a splash is requested only when an XP award crosses a milestone", () => {
  assert.equal(cosmeticJourneyLevelCrossed(25, 50), null);
  assert.equal(cosmeticJourneyLevelCrossed(100, 125), null);
  assert.equal(cosmeticJourneyLevelCrossed(500, 500), null);
  assert.equal(cosmeticJourneyLevelCrossed(75, 100)?.level, 2);
  assert.equal(cosmeticJourneyLevelCrossed(8_400, 8_800)?.level, 10);
});
