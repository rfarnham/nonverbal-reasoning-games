import type {
  AnswerForm,
  ExactNumber,
  FiniteDecimalExact,
  IntegerExact,
  MixedNumberExact,
  PercentExact,
  RationalExact,
  RemainderExact,
  SubmittedAnswer,
} from "./types.ts";

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer.`);
  }
}

export function greatestCommonDivisor(left: number, right: number): number {
  assertSafeInteger(left, "left");
  assertSafeInteger(right, "right");
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function integerExact(value: number): IntegerExact {
  assertSafeInteger(value, "Integer value");
  return { kind: "integer", value };
}

export function rationalExact(numerator: number, denominator: number): RationalExact {
  assertSafeInteger(numerator, "Rational numerator");
  assertSafeInteger(denominator, "Rational denominator");
  if (denominator === 0) throw new RangeError("Rational denominator cannot be zero.");
  const sign = denominator < 0 ? -1 : 1;
  const divisor = greatestCommonDivisor(numerator, denominator) || 1;
  return {
    kind: "rational",
    numerator: (sign * numerator) / divisor,
    denominator: Math.abs(denominator) / divisor,
  };
}

export function finiteDecimalExact(coefficient: number, scale: number): FiniteDecimalExact {
  assertSafeInteger(coefficient, "Decimal coefficient");
  assertSafeInteger(scale, "Decimal scale");
  if (scale < 0) throw new RangeError("Decimal scale cannot be negative.");
  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedCoefficient % 10 === 0) {
    normalizedCoefficient /= 10;
    normalizedScale -= 1;
  }
  return { kind: "finite_decimal", coefficient: normalizedCoefficient, scale: normalizedScale };
}

export function mixedNumberExact(
  whole: number,
  numerator: number,
  denominator: number,
): MixedNumberExact {
  assertSafeInteger(whole, "Mixed-number whole");
  assertSafeInteger(numerator, "Mixed-number numerator");
  assertSafeInteger(denominator, "Mixed-number denominator");
  if (whole < 0 || numerator < 0 || denominator <= 0 || numerator >= denominator) {
    throw new RangeError("A mixed number needs a nonnegative whole and a proper fraction.");
  }
  const reduced = rationalExact(numerator, denominator);
  if (reduced.numerator === 0) return { kind: "mixed_number", whole, numerator: 0, denominator: 1 };
  return {
    kind: "mixed_number",
    whole,
    numerator: reduced.numerator,
    denominator: reduced.denominator,
  };
}

export function remainderExact(
  quotient: number,
  remainder: number,
  divisor: number,
): RemainderExact {
  assertSafeInteger(quotient, "Quotient");
  assertSafeInteger(remainder, "Remainder");
  assertSafeInteger(divisor, "Divisor");
  if (quotient < 0 || divisor <= 0 || remainder < 0 || remainder >= divisor) {
    throw new RangeError("Remainder answers require q >= 0, divisor > 0, and 0 <= r < divisor.");
  }
  return { kind: "remainder", quotient, remainder, divisor };
}

/** `numerator / denominator` is the underlying value, so 50% is 1/2. */
export function percentExact(numerator: number, denominator: number): PercentExact {
  const normalized = rationalExact(numerator, denominator);
  return { kind: "percent", numerator: normalized.numerator, denominator: normalized.denominator };
}

interface RationalPair {
  readonly numerator: number;
  readonly denominator: number;
}

function powerOfTen(scale: number): number {
  const value = 10 ** scale;
  if (!Number.isSafeInteger(value)) throw new RangeError("Decimal scale is too large.");
  return value;
}

export function exactNumberAsRational(value: ExactNumber): RationalPair {
  switch (value.kind) {
    case "integer":
      return { numerator: value.value, denominator: 1 };
    case "rational":
    case "percent":
      return rationalExact(value.numerator, value.denominator);
    case "finite_decimal":
      return rationalExact(value.coefficient, powerOfTen(value.scale));
    case "mixed_number":
      return rationalExact(
        value.whole * value.denominator + value.numerator,
        value.denominator,
      );
    case "remainder":
      return rationalExact(
        value.quotient * value.divisor + value.remainder,
        value.divisor,
      );
  }
}

export function exactNumbersEqual(left: ExactNumber, right: ExactNumber): boolean {
  const a = exactNumberAsRational(left);
  const b = exactNumberAsRational(right);
  return BigInt(a.numerator) * BigInt(b.denominator) === BigInt(b.numerator) * BigInt(a.denominator);
}

export function isIntegerExact(value: ExactNumber): value is IntegerExact {
  return value.kind === "integer";
}

export function exactIntegerValue(value: ExactNumber): number | null {
  const rational = exactNumberAsRational(value);
  return rational.denominator === 1 ? rational.numerator : null;
}

export function answerFormForExactNumber(value: ExactNumber): AnswerForm {
  switch (value.kind) {
    case "integer":
      return "integer";
    case "rational":
      return "fraction";
    case "finite_decimal":
      return "finite_decimal";
    case "mixed_number":
      return "mixed_number";
    case "remainder":
      return "remainder";
    case "percent":
      return "percent";
  }
}

function decimalFromText(text: string): FiniteDecimalExact | null {
  const match = /^(-?)(0|[1-9]\d*)\.(\d+)$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fractional] = match;
  const coefficient = Number(`${sign}${whole}${fractional}`);
  if (!Number.isSafeInteger(coefficient)) return null;
  return finiteDecimalExact(coefficient, fractional!.length);
}

function isCanonicalIntegerText(text: string): boolean {
  return /^(?:0|-?[1-9]\d*)$/.test(text);
}

export interface ParsedExactAnswer {
  readonly value: ExactNumber;
  readonly form: AnswerForm;
  readonly reducedFraction: boolean;
}

/** Parse only explicit arithmetic forms; prose and ambiguous punctuation fail closed. */
export function parseExactAnswer(
  submitted: SubmittedAnswer,
  expected?: ExactNumber,
): ParsedExactAnswer | null {
  if (typeof submitted === "number") {
    if (!Number.isFinite(submitted)) return null;
    if (Number.isSafeInteger(submitted)) {
      return { value: integerExact(submitted), form: "integer", reducedFraction: true };
    }
    return parseExactAnswer(String(submitted), expected);
  }
  if (typeof submitted === "object" && submitted !== null && "kind" in submitted) {
    try {
      let value: ExactNumber;
      switch (submitted.kind) {
        case "integer": value = integerExact(submitted.value); break;
        case "rational": value = rationalExact(submitted.numerator, submitted.denominator); break;
        case "finite_decimal": value = finiteDecimalExact(submitted.coefficient, submitted.scale); break;
        case "mixed_number": value = mixedNumberExact(submitted.whole, submitted.numerator, submitted.denominator); break;
        case "remainder": value = remainderExact(submitted.quotient, submitted.remainder, submitted.divisor); break;
        case "percent": value = percentExact(submitted.numerator, submitted.denominator); break;
        default: return null;
      }
      const form = answerFormForExactNumber(value);
      return {
        value,
        form,
        reducedFraction:
          submitted.kind !== "rational" ||
          greatestCommonDivisor(submitted.numerator, submitted.denominator) === 1,
      };
    } catch {
      return null;
    }
  }

  const text = submitted.trim();
  if (isCanonicalIntegerText(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value)
      ? { value: integerExact(value), form: "integer", reducedFraction: true }
      : null;
  }

  const remainder = /^(0|[1-9]\d*)\s*[Rr]\s*(0|[1-9]\d*)$/.exec(text);
  if (remainder && expected?.kind === "remainder") {
    try {
      return {
        value: remainderExact(Number(remainder[1]), Number(remainder[2]), expected.divisor),
        form: "remainder",
        reducedFraction: true,
      };
    } catch {
      return null;
    }
  }

  const mixed = /^(0|[1-9]\d*)\s+(0|[1-9]\d*)\s*\/\s*([1-9]\d*)$/.exec(text);
  if (mixed) {
    try {
      return {
        value: mixedNumberExact(Number(mixed[1]), Number(mixed[2]), Number(mixed[3])),
        form: "mixed_number",
        reducedFraction: true,
      };
    } catch {
      return null;
    }
  }

  const fraction = /^(0|-?[1-9]\d*)\s*\/\s*(-?[1-9]\d*)$/.exec(text);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
      return null;
    }
    const reduced = greatestCommonDivisor(numerator, denominator) === 1;
    return {
      value: rationalExact(numerator, denominator),
      form: "fraction",
      reducedFraction: reduced,
    };
  }

  if (text.endsWith("%")) {
    const percentage = text.slice(0, -1).trim();
    const parsed = isCanonicalIntegerText(percentage)
      ? integerExact(Number(percentage))
      : decimalFromText(percentage);
    if (!parsed) return null;
    try {
      const rational = exactNumberAsRational(parsed);
      return {
        value: percentExact(rational.numerator, rational.denominator * 100),
        form: "percent",
        reducedFraction: true,
      };
    } catch {
      return null;
    }
  }

  const decimal = decimalFromText(text);
  return decimal
    ? { value: decimal, form: "finite_decimal", reducedFraction: true }
    : null;
}

export function exactNumberToString(value: ExactNumber): string {
  switch (value.kind) {
    case "integer":
      return String(value.value);
    case "rational":
      return `${value.numerator}/${value.denominator}`;
    case "finite_decimal": {
      const sign = value.coefficient < 0 ? "-" : "";
      const digits = String(Math.abs(value.coefficient)).padStart(value.scale + 1, "0");
      if (value.scale === 0) return `${sign}${digits}`;
      return `${sign}${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
    }
    case "mixed_number":
      return value.numerator === 0
        ? String(value.whole)
        : `${value.whole} ${value.numerator}/${value.denominator}`;
    case "remainder":
      return `${value.quotient} R ${value.remainder}`;
    case "percent": {
      const scaled = rationalExact(value.numerator * 100, value.denominator);
      return scaled.denominator === 1
        ? `${scaled.numerator}%`
        : `${scaled.numerator}/${scaled.denominator}%`;
    }
  }
}
