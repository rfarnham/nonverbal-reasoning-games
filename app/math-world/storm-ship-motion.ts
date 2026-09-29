/** A bounded, non-punitive storm pose driven solely by the shared scenery clock.
 * Freezing the clock preserves the exact pose; no gameplay timer is involved. */
export function sampleStormShipMotion(seconds: number, strength: number) {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const amount = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  const swell = Math.sin(t * 1.73) * .7 + Math.sin(t * 2.41 + .8) * .3;
  return {
    heave: amount * swell * .0032,
    roll: amount * (Math.sin(t * 1.73 + .6) * .14 + Math.sin(t * 3.1) * .025),
    pitch: amount * Math.sin(t * 1.31 + 1.2) * .085,
    yaw: amount * Math.sin(t * .67) * .055,
    sail: amount * (Math.sin(t * 7.7) * .075 + Math.sin(t * 11.3) * .025),
  };
}
