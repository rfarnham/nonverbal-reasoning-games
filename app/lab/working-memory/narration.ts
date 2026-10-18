import source from "../../../content/narration/working-memory.json" with { type: "json" };
import {
  createGameNarrationPlayer,
  defineGameNarrationManifest,
  GAME_NARRATION_UNLOCK_SRC,
  resolveGameNarrationAsset,
  type GameNarrationAudio,
  type GameNarrationClip,
  type GameNarrationPlayer,
} from "../../../lib/game-narration.ts";

const clips: Record<string, GameNarrationClip> = Object.fromEntries(
  Object.entries(source.cues).map(([id, cue]) => [id, {
    src: `/working-memory/audio/${cue.file}`,
    audioDurationMs: cue.audioDurationMs,
    minimumVisualMs: Math.max(cue.minVisualMs, cue.audioDurationMs),
    lingerMs: cue.lingerMs,
    transcript: cue.speechText,
  }]),
);

/** These are virtual local paths: actual audio is decrypted into memory. */
export const MEMORY_DIGIT_NARRATION = defineGameNarrationManifest(
  clips,
  source.narrator,
);

export type MemoryNarrator = GameNarrationPlayer<string> & {
  /** Auditory trials must never score a sequence that the player did not hear. */
  didPlaybackFail(): boolean;
};

type Options = Readonly<{
  isSoundEnabled: () => boolean;
  onPlaybackFailure?: (message: string) => void;
  /** Defaults to the configured GitHub Pages base path. */
  basePath?: string;
  /** Audio factory injection for deterministic playback/error tests. */
  createElement?: () => GameNarrationAudio;
  /** Must remain below the shared player's five-second stall recovery. */
  stallGraceMs?: number;
}>;

/**
 * Reuses the suite narrator's scheduler and one unlocked media element, while
 * resolving its local sources to authenticated, decrypted Blob URLs. No digit
 * source ever falls through to a plaintext public asset or a speech service.
 */
export function createMemoryNarrator(
  urls: Readonly<Record<string, string>>,
  options: Options,
): MemoryNarrator {
  const basePath = options.basePath ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const byUrl = new Map(Object.values(clips).map((clip) => [
    resolveGameNarrationAsset(clip.src, basePath), clip,
  ]));
  const unlockUrl = resolveGameNarrationAsset(GAME_NARRATION_UNLOCK_SRC, basePath);
  const stallGraceMs = options.stallGraceMs ?? 1_500;
  if (!Number.isFinite(stallGraceMs) || stallGraceMs < 0 || stallGraceMs >= 5_000) {
    throw new RangeError("Narration stall grace must be between zero and five seconds.");
  }

  let failed = false;
  let playing = false;
  // The shared player intentionally caches an unavailable element. Remember a
  // failed gesture-time prime so its visual fallback cannot become a silently
  // scored auditory trial later.
  let audioUnavailable = false;
  let disposeAdapter: (() => void) | undefined;
  const reportFailure = () => {
    if (!playing || failed) return;
    failed = true;
    try {
      options.onPlaybackFailure?.("The audio could not play. Check sound and try again.");
    } catch {
      // Failure reporting must not interrupt the shared narrator's cleanup.
    }
  };
  const prepareOperation = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (reason) {
      audioUnavailable = true;
      reportFailure();
      throw reason;
    }
  };

  const shared = createGameNarrationPlayer(MEMORY_DIGIT_NARRATION, {
    basePath,
    isSoundEnabled: options.isSoundEnabled,
    createAudio() {
      let element: GameNarrationAudio;
      try {
        element = options.createElement?.() ?? new Audio();
      } catch {
        audioUnavailable = true;
        reportFailure();
        return null;
      }
      let virtualSrc = "";
      let activeClip: GameNarrationClip | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const listeners = new Map<string, Set<EventListener>>();
      const clearWatchdog = () => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        watchdog = undefined;
      };
      const emit = (type: "ended" | "error", event: Event) => {
        clearWatchdog();
        if (type === "error" && activeClip) reportFailure();
        for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
      };
      const ended: EventListener = (event) => emit("ended", event);
      const error: EventListener = (event) => emit("error", event);
      try {
        prepareOperation(() => {
          element.addEventListener("ended", ended);
          element.addEventListener("error", error);
        });
      } catch {
        try {
          element.removeEventListener("ended", ended);
          element.removeEventListener("error", error);
        } catch {
          // A failed element must not prevent an explicit unavailable result.
        }
        return null;
      }
      disposeAdapter = () => {
        clearWatchdog();
        element.removeEventListener("ended", ended);
        element.removeEventListener("error", error);
        listeners.clear();
      };

      return {
        get src() { return virtualSrc; },
        set src(value) {
          clearWatchdog();
          virtualSrc = value;
          activeClip = byUrl.get(value);
          if (activeClip) {
            const decrypted = urls[activeClip.src] ?? urls[value];
            if (!decrypted?.startsWith("blob:")) {
              reportFailure();
              throw new TypeError("The decrypted narration clip is unavailable.");
            }
            prepareOperation(() => { element.src = decrypted; });
          } else if (value === unlockUrl) {
            prepareOperation(() => { element.src = value; });
          } else {
            reportFailure();
            throw new TypeError("Unknown narration asset.");
          }
        },
        get preload() { return prepareOperation(() => element.preload); },
        set preload(value) { prepareOperation(() => { element.preload = value; }); },
        get currentTime() { return prepareOperation(() => element.currentTime); },
        set currentTime(value) { prepareOperation(() => { element.currentTime = value; }); },
        play() {
          const cue = activeClip;
          try {
            const result = element.play();
            if (cue) {
              clearWatchdog();
              watchdog = setTimeout(() => {
                reportFailure();
                try { element.pause(); } catch { audioUnavailable = true; }
                emit("error", new Event("error"));
              }, cue.audioDurationMs + stallGraceMs);
            }
            return result?.catch((reason: unknown) => {
              clearWatchdog();
              if (cue) reportFailure();
              throw reason;
            });
          } catch (reason) {
            if (cue) reportFailure();
            throw reason;
          }
        },
        pause() { clearWatchdog(); prepareOperation(() => element.pause()); },
        load() { prepareOperation(() => element.load?.()); },
        addEventListener(type, listener) {
          const current = listeners.get(type) ?? new Set<EventListener>();
          current.add(listener);
          listeners.set(type, current);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      };
    },
  });

  return {
    prime: () => shared.prime(),
    async play(ids, hooks) {
      failed = false;
      playing = true;
      // The shared visual fallback is useful for teaching, but auditory memory
      // needs an explicit failure so an unheard sequence cannot be submitted.
      if (audioUnavailable || !options.isSoundEnabled()) reportFailure();
      try {
        return await shared.play(ids, hooks);
      } finally {
        playing = false;
      }
    },
    setEnabled(enabled) {
      if (!enabled) reportFailure();
      shared.setEnabled(enabled);
    },
    cancel: () => shared.cancel(),
    dispose() { shared.dispose(); disposeAdapter?.(); },
    didPlaybackFail: () => failed,
  };
}
