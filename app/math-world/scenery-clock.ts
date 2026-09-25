/** Active scenery time excludes pauses and hidden/offscreen time. Navigation has
 * its own clock, so pausing the scenery cannot interrupt a child's boat trip. */
export function createSceneryClock(options: {
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
  now: () => number;
  onFrame: (seconds: number) => void;
}) {
  let running = false;
  let disposed = false;
  let requestId: number | null = null;
  let previous = 0;
  let painted = 0;
  let seconds = 0;
  function tick(now: number) {
    requestId = null;
    if (!running || disposed) return;
    seconds += Math.max(0, Math.min(100, now - previous)) / 1000;
    previous = now;
    if (now - painted >= 1000 / 30 - 0.1) {
      painted = now;
      options.onFrame(seconds);
    }
    if (running && !disposed) requestId = options.request(tick);
  }
  function setRunning(value: boolean) {
    if (disposed || running === value) return;
    running = value;
    if (requestId !== null) options.cancel(requestId);
    requestId = null;
    if (value) {
      previous = painted = options.now();
      requestId = options.request(tick);
    }
  }
  return {
    setRunning,
    dispose() { setRunning(false); disposed = true; },
  };
}
