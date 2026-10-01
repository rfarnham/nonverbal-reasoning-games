export const DANGER_REVEAL_SECONDS = 4;

/** Visual state only. The caller supplies the same active-time clock used by
 * all scenery; hidden/offscreen time and pauses cannot advance this reveal. */
export function createDangerReveal() {
  const entries = new Map<string, { time: number; elapsed: number; strength: number }>();
  return {
    sample(seconds: number, targets: Readonly<Record<string, number>>, options: Readonly<{ running: boolean; reducedMotion: boolean }>) {
      const now = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      const stages: Record<string, number> = {};
      for (const id of entries.keys()) if (!(targets[id] > 0)) entries.delete(id);
      for (const [id, target] of Object.entries(targets)) {
        if (!Number.isFinite(target) || target <= 0) { stages[id] = 0; continue; }
        const maximum = Math.min(1, target);
        let entry = entries.get(id);
        if (!entry) {
          entry = { time: now, elapsed: options.running && !options.reducedMotion ? 0 : DANGER_REVEAL_SECONDS, strength: 0 };
          entries.set(id, entry);
        } else if (options.running && !options.reducedMotion) {
          entry.elapsed = Math.min(DANGER_REVEAL_SECONDS, entry.elapsed + Math.max(0, now - entry.time));
        }
        if (options.reducedMotion) entry.elapsed = DANGER_REVEAL_SECONDS;
        entry.time = now;
        const t = Math.min(1, entry.elapsed / DANGER_REVEAL_SECONDS);
        entry.strength = maximum * t * t * (3 - 2 * t);
        stages[id] = entry.strength;
      }
      return stages;
    },
  };
}
