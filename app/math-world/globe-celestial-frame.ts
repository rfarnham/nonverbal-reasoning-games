export const SKY_CYCLE_SECONDS = 360;

export function getCelestialCycleAngle(seconds: number) {
  return Math.max(0, Number.isFinite(seconds) ? seconds : 0) * Math.PI * 2 / SKY_CYCLE_SECONDS;
}
