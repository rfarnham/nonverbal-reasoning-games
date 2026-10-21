/** Conservative practice spans with occasional, answer-independent harder probes. */
export const COMFORT_ADAPTATION = "comfort-v1" as const;

/** Flat scalars keep encrypted task-bank copies independent without nested aliases. */
export interface ComfortState {
  comfortSpan: number;
  probeWait: number;
  probeWins: 0 | 1;
  baseMisses: 0 | 1;
  /** Two bits per span 2–9: 0 = new target, 1 = failed once, 2 = failed repeatedly. */
  probeBackoff: number;
}

export const COMFORT_FIELDS = ["comfortSpan", "probeWait", "probeWins", "baseMisses", "probeBackoff"] as const;
type SpanState = { span: number } & Partial<ComfortState>;
const FIRST_PROBE_WAIT = 2;
const FAILED_PROBE_WAITS = [8, 16] as const;

export function hasComfortState(value: Partial<ComfortState>): value is ComfortState {
  return COMFORT_FIELDS.every((field) => value[field] !== undefined);
}

export function hasAnyComfortState(value: Partial<ComfortState>): boolean {
  return COMFORT_FIELDS.some((field) => value[field] !== undefined);
}

function stage(backoff: number, span: number): number {
  return span < 2 || span > 9 ? 0 : (backoff >>> ((span - 2) * 2)) & 3;
}

function setStage(backoff: number, span: number, value: number): number {
  const shift = (span - 2) * 2;
  return (backoff & ~(3 << shift)) | (value << shift);
}

function failedTarget(backoff: number, span: number): number {
  return setStage(backoff, span, Math.min(2, stage(backoff, span) + 1));
}

function probeDelay(backoff: number, span: number): number {
  const failed = stage(backoff, span);
  return failed === 0 ? FIRST_PROBE_WAIT : FAILED_PROBE_WAITS[failed - 1];
}

function nextSpan(state: ComfortState, maxSpan: number): number {
  return state.probeWait === 0 && state.comfortSpan < maxSpan ? state.comfortSpan + 1 : state.comfortSpan;
}

export function validateComfortState(value: SpanState, minSpan: number, maxSpan: number): value is { span: number } & ComfortState {
  if (!hasComfortState(value)
    || !Number.isInteger(value.comfortSpan) || value.comfortSpan < minSpan || value.comfortSpan > maxSpan
    || !Number.isInteger(value.probeWait) || value.probeWait < 0 || value.probeWait > 16
    || (value.probeWins !== 0 && value.probeWins !== 1)
    || (value.baseMisses !== 0 && value.baseMisses !== 1)
    || !Number.isInteger(value.probeBackoff) || value.probeBackoff < 0 || value.probeBackoff > 0xffff) return false;
  for (let span = 2; span <= 9; span += 1) if (stage(value.probeBackoff, span) > 2) return false;
  return value.span === nextSpan(value, maxSpan)
    && (value.comfortSpan < maxSpan || (value.probeWait === 0 && value.probeWins === 0));
}

/** Upgrade one historical bank without changing its lifetime first-attempt counts. */
export function withComfortState<T extends SpanState>(state: T, minSpan: number, maxSpan: number, missedSpan?: number): T & ComfortState {
  if (hasAnyComfortState(state)) {
    if (!validateComfortState(state, minSpan, maxSpan)) throw new TypeError("Invalid comfortable-span state.");
    return { ...state } as T & ComfortState;
  }
  const comfortSpan = Math.max(minSpan, Math.min(maxSpan,
    missedSpan === undefined ? state.span : Math.min(state.span, missedSpan - 1)));
  const probeBackoff = missedSpan !== undefined && missedSpan > comfortSpan && missedSpan >= 2 && missedSpan <= 9
    ? failedTarget(0, missedSpan) : 0;
  const comfort: ComfortState = {
    comfortSpan, probeWait: comfortSpan === maxSpan ? 0 : probeDelay(probeBackoff, comfortSpan + 1),
    probeWins: 0, baseMisses: 0, probeBackoff,
  };
  return { ...state, ...comfort, span: nextSpan(comfort, maxSpan) };
}

/** Only a first committed answer supplies evidence; retries never call this. */
export function adaptComfortState<T extends SpanState>(state: T, correct: boolean, minSpan: number, maxSpan: number): T & ComfortState {
  if (!validateComfortState(state, minSpan, maxSpan) || typeof correct !== "boolean") throw new TypeError("Invalid comfortable-span evidence.");
  const next: ComfortState = {
    comfortSpan: state.comfortSpan, probeWait: state.probeWait, probeWins: state.probeWins,
    baseMisses: state.baseMisses, probeBackoff: state.probeBackoff,
  };
  if (state.span > state.comfortSpan) {
    next.baseMisses = 0;
    if (correct) {
      if (state.probeWins === 1) {
        next.comfortSpan += 1;
        next.probeWins = 0;
        next.probeBackoff = setStage(next.probeBackoff, next.comfortSpan, 0);
        next.probeWait = next.comfortSpan === maxSpan ? 0 : probeDelay(next.probeBackoff, next.comfortSpan + 1);
      } else {
        next.probeWins = 1;
        next.probeWait = FIRST_PROBE_WAIT;
      }
    } else {
      next.probeBackoff = failedTarget(next.probeBackoff, state.span);
      next.probeWins = 0;
      next.probeWait = probeDelay(next.probeBackoff, state.span);
    }
  } else if (correct) {
    next.baseMisses = 0;
    next.probeWait = Math.max(0, next.probeWait - 1);
  } else if (state.baseMisses === 1) {
    next.baseMisses = 0;
    next.probeWins = 0;
    if (state.comfortSpan > minSpan) {
      next.probeBackoff = failedTarget(next.probeBackoff, state.comfortSpan);
      next.comfortSpan -= 1;
    }
    next.probeWait = next.comfortSpan === maxSpan ? 0 : probeDelay(next.probeBackoff, next.comfortSpan + 1);
  } else next.baseMisses = 1;
  return { ...state, ...next, span: nextSpan(next, maxSpan) };
}
