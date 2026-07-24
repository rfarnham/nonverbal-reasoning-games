export type CosmeticJourneyLevel = Readonly<{
  level: number;
  xpRequired: number;
}>;

/**
 * Cosmetic milestones only. These levels never unlock content, change
 * difficulty, modify XP awards, or alter Journey validation.
 */
export const COSMETIC_JOURNEY_LEVELS: readonly CosmeticJourneyLevel[] = [
  { level: 1, xpRequired: 0 },
  { level: 2, xpRequired: 100 },
  { level: 3, xpRequired: 250 },
  { level: 4, xpRequired: 500 },
  { level: 5, xpRequired: 900 },
  { level: 6, xpRequired: 1_500 },
  { level: 7, xpRequired: 2_500 },
  { level: 8, xpRequired: 4_000 },
  { level: 9, xpRequired: 6_000 },
  { level: 10, xpRequired: 8_500 },
  { level: 11, xpRequired: 12_000 },
  { level: 12, xpRequired: 16_500 },
  { level: 13, xpRequired: 22_000 },
  { level: 14, xpRequired: 28_500 },
  { level: 15, xpRequired: 36_000 },
  { level: 16, xpRequired: 44_500 },
] as const;

export function cosmeticJourneyLevelForXp(
  xp: number,
): CosmeticJourneyLevel {
  const normalizedXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  for (let index = COSMETIC_JOURNEY_LEVELS.length - 1; index >= 0; index -= 1) {
    const milestone = COSMETIC_JOURNEY_LEVELS[index]!;
    if (normalizedXp >= milestone.xpRequired) return milestone;
  }
  return COSMETIC_JOURNEY_LEVELS[0]!;
}

export function cosmeticJourneyLevelCrossed(
  xpBefore: number,
  xpAfter: number,
): CosmeticJourneyLevel | null {
  if (xpAfter <= xpBefore) return null;
  const previous = cosmeticJourneyLevelForXp(xpBefore);
  const current = cosmeticJourneyLevelForXp(xpAfter);
  return current.level > previous.level ? current : null;
}
