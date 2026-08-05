export const ADAPTIVE_HANDWRITING_SLOT_COUNT = 2;

export function handwritingSlotsWithInk(
  hasInk: readonly boolean[],
): readonly number[] {
  return Array.from(
    { length: ADAPTIVE_HANDWRITING_SLOT_COUNT },
    (_, index) => index,
  ).filter((index) => hasInk[index] === true);
}

export function normalizeAdaptiveTypedAnswer(rawValue: string): string {
  return rawValue
    .replace(/\D+/g, "")
    .slice(0, ADAPTIVE_HANDWRITING_SLOT_COUNT);
}

export function adaptiveTypedAnswerIsReady(value: string): boolean {
  return /^\d{1,2}$/.test(value);
}
