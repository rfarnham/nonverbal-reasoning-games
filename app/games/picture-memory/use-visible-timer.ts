"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export type VisibleTimerOptions = {
  active: boolean;
  resetKey: string;
  durationMs: number;
  onElapsed: () => void;
  onRemaining?: (remainingMs: number) => void;
};

/** Counts visible study time. Only a new key or active stint starts a new budget;
 * changing a saved remaining duration during a rerender must not restart it. */
export function useVisibleTimer({ active, resetKey, durationMs, onElapsed, onRemaining }: VisibleTimerOptions): void {
  const latest = useRef({ resetKey, durationMs, onElapsed, onRemaining });

  // Layout effects update before passive timer cleanup. A new round's callback
  // must never receive the remaining budget belonging to the previous key.
  useLayoutEffect(() => {
    latest.current = { resetKey, durationMs, onElapsed, onRemaining };
  }, [resetKey, durationMs, onElapsed, onRemaining]);

  useEffect(() => {
    if (!active) return;

    const initialDuration = latest.current.durationMs;
    let remaining = Number.isFinite(initialDuration) && initialDuration > 0 ? initialDuration : 0;
    let startedAt: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let pageHidden = false;
    let disposed = false;
    let expired = false;

    const ownsKey = () => latest.current.resetKey === resetKey;
    const visible = () => !pageHidden && document.visibilityState === "visible";
    const currentRemaining = () => Math.max(0, remaining - (startedAt === null ? 0 : performance.now() - startedAt));
    const clearPending = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
    };

    const pause = () => {
      if (disposed || expired || !ownsKey() || startedAt === null) return;
      remaining = currentRemaining();
      startedAt = null;
      clearPending();
      latest.current.onRemaining?.(remaining);
    };

    const schedule = () => {
      // The upper bound also keeps a finite, unusually large duration from
      // overflowing the browser's signed 32-bit timeout delay.
      timeout = setTimeout(tick, Math.min(2_147_483_647, Math.ceil(currentRemaining())));
    };

    function tick() {
      timeout = undefined;
      if (disposed || expired || !ownsKey()) return;
      if (!visible()) {
        pause();
        return;
      }
      if (currentRemaining() > 0) {
        schedule();
        return;
      }
      expired = true;
      remaining = 0;
      startedAt = null;
      latest.current.onRemaining?.(0);
      if (ownsKey()) latest.current.onElapsed();
    }

    const resume = () => {
      if (disposed || expired || !ownsKey() || startedAt !== null || !visible()) return;
      startedAt = performance.now();
      // Even a zero budget expires asynchronously, so StrictMode's discarded
      // setup cannot deliver an elapsed callback.
      schedule();
    };

    const visibilityChanged = () => {
      if (visible()) resume();
      else pause();
    };
    const pageHide = () => {
      pageHidden = true;
      pause();
    };
    const pageShow = () => {
      pageHidden = false;
      visibilityChanged();
    };
    const saveRemaining = () => {
      if (!disposed && !expired && ownsKey()) latest.current.onRemaining?.(currentRemaining());
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("beforeunload", saveRemaining);
    latest.current.onRemaining?.(remaining);
    resume();

    return () => {
      const finalRemaining = currentRemaining();
      disposed = true;
      clearPending();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("beforeunload", saveRemaining);
      if (!expired && latest.current.resetKey === resetKey) {
        latest.current.onRemaining?.(finalRemaining);
      }
    };
  }, [active, resetKey]);
}
