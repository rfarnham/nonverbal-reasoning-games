export const TWO_MINUTE_SESSION_MS = 120_000;

export const SESSION_MODES = [
  "infinite",
  "two-minute",
  "deck-sprint",
] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export type SessionClock = Readonly<{
  elapsedMs: number;
  runningSince: number | null;
}>;

export function createSessionClock(
  now: number,
  running = true,
): SessionClock {
  return {
    elapsedMs: 0,
    runningSince: running ? now : null,
  };
}

export function readSessionElapsed(
  clock: SessionClock,
  now: number,
): number {
  if (clock.runningSince === null) return clock.elapsedMs;
  return clock.elapsedMs + Math.max(0, now - clock.runningSince);
}

export function pauseSessionClock(
  clock: SessionClock,
  now: number,
): SessionClock {
  if (clock.runningSince === null) return clock;
  return {
    elapsedMs: readSessionElapsed(clock, now),
    runningSince: null,
  };
}

export function resumeSessionClock(
  clock: SessionClock,
  now: number,
): SessionClock {
  if (clock.runningSince !== null) return clock;
  return {
    elapsedMs: clock.elapsedMs,
    runningSince: now,
  };
}

export function sessionAccuracy(
  correct: number,
  answered: number,
): number | null {
  if (answered <= 0) return null;
  return Math.round((Math.max(0, correct) / answered) * 100);
}

export function isTimedAnswerAllowed(elapsedMs: number): boolean {
  return elapsedMs <= TWO_MINUTE_SESSION_MS;
}

export function formatElapsedTime(
  elapsedMs: number,
  includeTenths = false,
): string {
  const safeMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const totalTenths = Math.floor(safeMs / 100);
  const totalSeconds = Math.floor(totalTenths / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return includeTenths ? `${base}.${totalTenths % 10}` : base;
}

export function formatCountdownTime(remainingMs: number): string {
  const seconds = Math.ceil(
    Math.max(0, Number.isFinite(remainingMs) ? remainingMs : 0) / 1_000,
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function sessionEncouragement(
  correct: number,
  answered: number,
): string {
  const accuracy = sessionAccuracy(correct, answered);
  if (accuracy === null) return "Ready for the next run.";
  if (accuracy === 100) return "Perfect accuracy. Clean work.";
  if (accuracy >= 90) return "Sharp and steady.";
  if (accuracy >= 75) return "Strong run. Keep the rhythm.";
  return "Every round builds fluency.";
}
