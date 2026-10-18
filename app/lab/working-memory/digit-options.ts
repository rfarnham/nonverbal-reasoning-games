/** Independent options for the auditory digit family. No engine/runtime dependency. */
export type InputMode = "keypad" | "spoken";
export type DigitRecallOrder = "reverse" | "ascending" | "descending";
export type DigitTaskId = "reverse-digits" | "hidden-digits" | "sort-digits";

export interface DigitVariant {
  order: DigitRecallOrder;
  inputMode: InputMode;
  /** Spoken answers have no keypad, so visibility cannot distinguish their identity. */
  keypad: "visible" | "hidden" | "none";
}

function hasVariantKeys(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 3
    && ["order", "inputMode", "keypad"].every((key) => Object.hasOwn(value, key));
}

/** Only the irrelevant spoken-keypad setting is normalized; malformed options are rejected. */
export function normalizeDigitVariant(raw: unknown): DigitVariant {
  if (!hasVariantKeys(raw)
    || (raw.order !== "reverse" && raw.order !== "ascending" && raw.order !== "descending")
    || (raw.inputMode !== "keypad" && raw.inputMode !== "spoken")
    || (raw.keypad !== "visible" && raw.keypad !== "hidden" && raw.keypad !== "none")
    || (raw.inputMode === "keypad" && raw.keypad === "none")) {
    throw new TypeError("Invalid digit options.");
  }
  return { order: raw.order, inputMode: raw.inputMode, keypad: raw.inputMode === "spoken" ? "none" : raw.keypad };
}

/** Stored options must already be canonical so corruption cannot silently change a session. */
export function isCanonicalDigitVariant(value: unknown): value is DigitVariant {
  try {
    const normalized = normalizeDigitVariant(value);
    return hasVariantKeys(value) && normalized.keypad === value.keypad;
  } catch { return false; }
}

export function digitVariantKey(variant: DigitVariant): string {
  const normalized = normalizeDigitVariant(variant);
  return `${normalized.order}|${normalized.inputMode}|${normalized.keypad}`;
}

/** Three recall rules × (visible keypad, hidden keypad, spoken) = nine unique variants. */
export function enumerateDigitVariants(): DigitVariant[] {
  return (["reverse", "ascending", "descending"] as const).flatMap((order) => [
    { order, inputMode: "keypad" as const, keypad: "visible" as const },
    { order, inputMode: "keypad" as const, keypad: "hidden" as const },
    { order, inputMode: "spoken" as const, keypad: "none" as const },
  ]);
}

/** Legacy task IDs remain internal compatibility aliases, not separate game families. */
export function digitTaskForVariant(variant: DigitVariant): DigitTaskId {
  const normalized = normalizeDigitVariant(variant);
  if (normalized.order !== "reverse") return "sort-digits";
  return normalized.keypad === "hidden" ? "hidden-digits" : "reverse-digits";
}

export function digitVariantFromLegacy(task: string, inputMode: InputMode, digitOrder: "ascending" | "descending" = "ascending"): DigitVariant | null {
  if (task !== "reverse-digits" && task !== "hidden-digits" && task !== "sort-digits") return null;
  return normalizeDigitVariant({
    order: task === "sort-digits" ? digitOrder : "reverse",
    inputMode,
    keypad: task === "hidden-digits" ? "hidden" : "visible",
  });
}
