export type RandomSource = () => number;

/** FNV-1a, kept local so identical string seeds are stable across browsers. */
export function adaptiveSeedHash(seed: string): number {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("Adaptive random seeds must be non-empty strings.");
  }

  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A compact Mulberry32 stream seeded by the stable string hash above. */
export function createAdaptiveRandom(seed: string): RandomSource {
  let state = adaptiveSeedHash(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Read one value while rejecting malformed or adversarial random sources.
 * Silent clamping would bias curriculum coverage and can hide generator bugs.
 */
export function randomUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("Random sources must return a finite value in [0, 1).");
  }
  return value;
}

export function randomInt(random: RandomSource, exclusiveMax: number): number {
  if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax <= 0) {
    throw new RangeError("exclusiveMax must be a positive safe integer.");
  }
  return Math.floor(randomUnit(random) * exclusiveMax);
}

export function randomIntBetween(
  random: RandomSource,
  inclusiveMin: number,
  inclusiveMax: number,
): number {
  if (
    !Number.isSafeInteger(inclusiveMin) ||
    !Number.isSafeInteger(inclusiveMax) ||
    inclusiveMax < inclusiveMin
  ) {
    throw new RangeError("Random integer bounds must be ordered safe integers.");
  }
  return inclusiveMin + randomInt(random, inclusiveMax - inclusiveMin + 1);
}

export function randomChoice<T>(random: RandomSource, values: readonly T[]): T {
  if (values.length === 0) {
    throw new RangeError("Cannot choose from an empty collection.");
  }
  return values[randomInt(random, values.length)]!;
}

export function shuffleWithRandom<T>(random: RandomSource, values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = randomInt(random, index + 1);
    [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function deriveAdaptiveSeed(baseSeed: string, ...parts: readonly (string | number)[]): string {
  if (typeof baseSeed !== "string" || baseSeed.length === 0) {
    throw new TypeError("Adaptive random seeds must be non-empty strings.");
  }
  return [baseSeed, ...parts.map((part) => String(part))]
    .map((part) => `${part.length}:${part}`)
    .join("|");
}

export function stableSeedToken(seed: string): string {
  return adaptiveSeedHash(seed).toString(36).padStart(7, "0");
}
