/**
 * The identity shared by every locally rendered Spatial Gym narration clip.
 *
 * Games publish their own small clip manifests, but this identifier keeps the
 * narrator contract suite-wide instead of letting each game quietly choose a
 * different voice.
 */
export const SUITE_NARRATOR_ID = "spatial-gym-narrator-v1" as const;

/**
 * Pinned offline voice recipe for every narrated Spatial Gym game.
 *
 * Keeping this in shared runtime code makes a different model or voice an
 * explicit suite-level product change instead of a per-game implementation
 * detail.
 */
export const SUITE_NARRATOR_PROVENANCE = {
  model: "hexgrad/Kokoro-82M",
  revision: "f3ff3571791e39611d31c381e3a41a3af07b4987",
  voice: "af_heart",
  speed: 0.88,
  sampleRate: 24_000,
  format: "mp3",
} as const;

export type SuiteNarratorProvenance = Readonly<{
  model: string;
  revision: string;
  voice: string;
  speed: number;
  sampleRate: number;
  format: string;
}>;

/** A tiny silent clip used only to unlock the reusable narrator on WebKit. */
export const GAME_NARRATION_UNLOCK_SRC =
  "/audio/narration/narration-unlock.mp3" as const;

const DEFAULT_AUDIO_STALL_GRACE_MS = 5_000;

export type GameNarrationClip = Readonly<{
  /** Public-root asset path, without the configured Next.js base path. */
  src: string;
  /** Measured duration of the generated local clip. */
  audioDurationMs: number;
  /** The visual must remain in this cue state for at least this long. */
  minimumVisualMs: number;
  /** Quiet absorption time after both the narration and visual have finished. */
  lingerMs: number;
  /** A short text equivalent for captions and assistive technology. */
  transcript: string;
}>;

export type GameNarrationManifest<CueId extends string = string> = Readonly<{
  narrator: typeof SUITE_NARRATOR_ID;
  provenance: typeof SUITE_NARRATOR_PROVENANCE;
  clips: Readonly<Record<CueId, GameNarrationClip>>;
}>;

export type GameNarrationCue<CueId extends string> = Readonly<{
  id: CueId;
  clip: GameNarrationClip;
  url: string;
}>;

export type GameNarrationPlaybackResult<CueId extends string> = Readonly<{
  status: "completed" | "cancelled" | "disposed";
  completedCueIds: readonly CueId[];
}>;

export type GameNarrationPlaybackHooks<CueId extends string> = Readonly<{
  onCueStart?: (cue: GameNarrationCue<CueId>, index: number) => void;
  onCueComplete?: (cue: GameNarrationCue<CueId>, index: number) => void;
}>;

export interface GameNarrationAudio {
  src: string;
  preload: string;
  currentTime: number;
  play(): void | Promise<void>;
  pause(): void;
  load?(): void;
  addEventListener(
    type: "ended" | "error",
    listener: EventListener,
  ): void;
  removeEventListener(
    type: "ended" | "error",
    listener: EventListener,
  ): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type GameNarrationTimers = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}>;

export type CreateGameNarrationPlayerOptions = Readonly<{
  /** Read at the start of every cue so the suite sound toggle stays live. */
  isSoundEnabled?: () => boolean;
  /**
   * Creates the one media element reused for every cue. Defaults to
   * `new Audio(url)`. Return null when audio is unavailable.
   */
  createAudio?: (url: string) => GameNarrationAudio | null;
  /** Extra time after the measured clip duration before a stall is recovered. */
  audioStallGraceMs?: number;
  /** Override only for deterministic tests. */
  timers?: GameNarrationTimers;
  /** Defaults to NEXT_PUBLIC_BASE_PATH. */
  basePath?: string;
}>;

export interface GameNarrationPlayer<CueId extends string> {
  /**
   * Call directly from a click/key gesture before narration. This silently
   * unlocks the same media element that will play every spoken cue.
   */
  prime(): void;
  play(
    cueIds: readonly CueId[],
    hooks?: GameNarrationPlaybackHooks<CueId>,
  ): Promise<GameNarrationPlaybackResult<CueId>>;
  /** Silences the active clip without shortening its visual teaching window. */
  setEnabled(enabled: boolean): void;
  cancel(): void;
  dispose(): void;
}

type ActiveRun = {
  cancelled: boolean;
  disposers: Set<() => void>;
  silenceAudio: (() => void) | null;
};

const browserTimers: GameNarrationTimers = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle);
  },
};

function normalizeLocalPath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} must not be empty.`);
  if (trimmed !== value) {
    throw new TypeError(`${label} must not contain leading or trailing space.`);
  }
  if (
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    throw new TypeError(`${label} must be a same-origin public asset path.`);
  }
  if (trimmed.includes("?") || trimmed.includes("#")) {
    throw new TypeError(`${label} must not contain a query or fragment.`);
  }

  const withoutLeadingSlash = trimmed.replace(/^\/+/, "");
  const segments = withoutLeadingSlash.split("/");
  if (segments.some((segment) => !segment)) {
    throw new TypeError(`${label} contains an empty path segment.`);
  }

  for (const segment of segments) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError(`${label} contains invalid URL escaping.`);
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      throw new TypeError(`${label} must not traverse outside public assets.`);
    }
  }

  return `/${segments.join("/")}`;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath) return "";
  const withoutTrailingSlashes = basePath.replace(/\/+$/, "");
  if (!withoutTrailingSlashes) return "";
  return normalizeLocalPath(withoutTrailingSlashes, "Narration base path");
}

/**
 * Resolves a public narration asset without losing the GitHub Pages base path.
 * Remote URLs, protocol-relative URLs, data URLs, and traversals are rejected.
 */
export function resolveGameNarrationAsset(
  src: string,
  basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
): string {
  const localPath = normalizeLocalPath(src, "Narration clip source");
  return `${normalizeBasePath(basePath)}${localPath}`;
}

function validateMilliseconds(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite, non-negative number.`);
  }
}

/** Defines a game manifest while pinning it to the suite narrator identity. */
export function defineGameNarrationManifest<
  const Clips extends Readonly<Record<string, GameNarrationClip>>,
>(
  clips: Clips,
  provenance: SuiteNarratorProvenance,
): GameNarrationManifest<Extract<keyof Clips, string>> & {
  clips: Clips;
} {
  for (const [field, expected] of Object.entries(
    SUITE_NARRATOR_PROVENANCE,
  )) {
    const actual = provenance[field as keyof SuiteNarratorProvenance];
    if (actual !== expected) {
      throw new TypeError(
        `Narration provenance ${field} must match the suite narrator.`,
      );
    }
  }

  for (const [cueId, clip] of Object.entries(clips)) {
    if (!cueId) throw new TypeError("Narration cue IDs must not be empty.");
    resolveGameNarrationAsset(clip.src, "");
    validateMilliseconds(
      clip.audioDurationMs,
      `Narration cue ${cueId} audioDurationMs`,
    );
    validateMilliseconds(
      clip.minimumVisualMs,
      `Narration cue ${cueId} minimumVisualMs`,
    );
    validateMilliseconds(clip.lingerMs, `Narration cue ${cueId} lingerMs`);
    if (!clip.transcript.trim()) {
      throw new TypeError(`Narration cue ${cueId} needs a transcript.`);
    }
  }

  return {
    narrator: SUITE_NARRATOR_ID,
    provenance: SUITE_NARRATOR_PROVENANCE,
    clips,
  };
}

function defaultCreateAudio(url: string): GameNarrationAudio | null {
  if (typeof Audio === "undefined") return null;
  try {
    return new Audio(url);
  } catch {
    return null;
  }
}

function stopAudio(audio: GameNarrationAudio) {
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // A disappearing media element must not affect the visual teaching flow.
  }
}

function prepareAudio(
  audio: GameNarrationAudio,
  url: string,
): GameNarrationAudio | null {
  try {
    stopAudio(audio);
    audio.preload = "auto";
    audio.src = url;
    audio.load?.();
    return audio;
  } catch {
    return null;
  }
}

function cancelRun(run: ActiveRun) {
  if (run.cancelled) return;
  run.cancelled = true;
  for (const dispose of [...run.disposers]) dispose();
  run.disposers.clear();
}

function waitForDelay(
  run: ActiveRun,
  timers: GameNarrationTimers,
  delayMs: number,
): Promise<boolean> {
  if (run.cancelled) return Promise.resolve(false);
  if (delayMs <= 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      run.disposers.delete(cancel);
      resolve(completed);
    };
    const cancel = () => {
      timers.clearTimeout(handle);
      finish(false);
    };

    const handle = timers.setTimeout(() => finish(true), delayMs);
    run.disposers.add(cancel);
  });
}

function waitForAudio(
  run: ActiveRun,
  audio: GameNarrationAudio,
  timers: GameNarrationTimers,
  watchdogMs: number,
): Promise<boolean> {
  if (run.cancelled) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let watchdog: TimerHandle | null = null;
    // Source changes on a reused WebKit media element can emit `abort` for the
    // previous resource after the next cue has attached listeners. Let the
    // watchdog recover a genuine abort instead of advancing the new cue early.
    const eventTypes = ["ended", "error"] as const;

    const removeListeners = () => {
      for (const eventType of eventTypes) {
        try {
          audio.removeEventListener(eventType, finishFromEvent);
        } catch {
          // A disappearing media element must not affect the teaching flow.
        }
      }
    };
    const settle = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (watchdog !== null) {
        timers.clearTimeout(watchdog);
        watchdog = null;
      }
      removeListeners();
      run.disposers.delete(cancel);
      if (run.silenceAudio === silence) run.silenceAudio = null;
      resolve(completed);
    };
    const finishFromEvent: EventListener = () => settle(true);
    const cancel = () => {
      removeListeners();
      stopAudio(audio);
      settle(false);
    };
    const silence = () => {
      removeListeners();
      stopAudio(audio);
      settle(true);
    };

    for (const eventType of eventTypes) {
      try {
        audio.addEventListener(eventType, finishFromEvent);
      } catch {
        settle(true);
        return;
      }
      if (settled) return;
    }
    run.disposers.add(cancel);
    run.silenceAudio = silence;
    watchdog = timers.setTimeout(() => {
      stopAudio(audio);
      settle(true);
    }, watchdogMs);

    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        void playResult.catch(() => settle(true));
      }
    } catch {
      settle(true);
    }
  });
}

function safelyInvoke(callback: (() => void) | undefined) {
  try {
    callback?.();
  } catch {
    // A presentational hook must not strand or speed up narration timing.
  }
}

/**
 * Plays local narration cues serially. A cue advances only after both its
 * audio and minimum visual window finish, followed by its full linger window.
 */
export function createGameNarrationPlayer<CueId extends string>(
  manifest: GameNarrationManifest<CueId>,
  options: CreateGameNarrationPlayerOptions = {},
): GameNarrationPlayer<CueId> {
  if (manifest.narrator !== SUITE_NARRATOR_ID) {
    throw new TypeError("Narration manifest does not use the suite narrator.");
  }

  const basePath = normalizeBasePath(
    options.basePath ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  );
  const timers = options.timers ?? browserTimers;
  const createAudio = options.createAudio ?? defaultCreateAudio;
  const isSoundEnabled = options.isSoundEnabled ?? (() => true);
  const audioStallGraceMs =
    options.audioStallGraceMs ?? DEFAULT_AUDIO_STALL_GRACE_MS;
  validateMilliseconds(audioStallGraceMs, "Narration audio stall grace");

  let activeRun: ActiveRun | null = null;
  let disposed = false;
  let enabledOverride: boolean | null = null;
  let reusableAudio: GameNarrationAudio | null | undefined;

  const audioForUrl = (url: string): GameNarrationAudio | null => {
    if (reusableAudio === undefined) {
      try {
        reusableAudio = createAudio(url);
      } catch {
        reusableAudio = null;
      }
    }
    return reusableAudio ? prepareAudio(reusableAudio, url) : null;
  };

  const cancel = () => {
    if (!activeRun) return;
    const run = activeRun;
    activeRun = null;
    cancelRun(run);
  };

  return {
    prime() {
      if (disposed || activeRun) return;
      let soundEnabled = false;
      try {
        soundEnabled = enabledOverride ?? isSoundEnabled();
      } catch {
        // A broken preference lookup behaves exactly like muted narration.
      }
      if (!soundEnabled) return;

      const audio = audioForUrl(
        `${basePath}${normalizeLocalPath(
          GAME_NARRATION_UNLOCK_SRC,
          "Narration unlock source",
        )}`,
      );
      if (!audio) return;
      try {
        const playResult = audio.play();
        if (playResult && typeof playResult.then === "function") {
          void playResult.catch(() => undefined);
        }
      } catch {
        // Narration still has its deliberately slow visual fallback.
      }
    },
    async play(cueIds, hooks = {}) {
      if (disposed) {
        return { status: "disposed", completedCueIds: [] };
      }

      const cues = cueIds.map((id) => {
        const clip = manifest.clips[id];
        if (!clip) throw new RangeError(`Unknown narration cue: ${id}`);
        return {
          id,
          clip,
          url: `${basePath}${normalizeLocalPath(
            clip.src,
            `Narration cue ${id} source`,
          )}`,
        } satisfies GameNarrationCue<CueId>;
      });

      cancel();
      const run: ActiveRun = {
        cancelled: false,
        disposers: new Set(),
        silenceAudio: null,
      };
      activeRun = run;
      const completedCueIds: CueId[] = [];

      for (let index = 0; index < cues.length; index += 1) {
        const cue = cues[index];
        if (run.cancelled) break;
        safelyInvoke(() => hooks.onCueStart?.(cue, index));

        let soundEnabled = false;
        try {
          soundEnabled = enabledOverride ?? isSoundEnabled();
        } catch {
          // A broken preference lookup behaves exactly like muted narration.
        }

        const audio = soundEnabled ? audioForUrl(cue.url) : null;
        const [visualCompleted, audioCompleted] = await Promise.all([
          waitForDelay(run, timers, cue.clip.minimumVisualMs),
          soundEnabled && audio
            ? waitForAudio(
                run,
                audio,
                timers,
                cue.clip.audioDurationMs + audioStallGraceMs,
              )
            : Promise.resolve(true),
        ]);
        if (!visualCompleted || !audioCompleted || run.cancelled) break;

        const lingerCompleted = await waitForDelay(
          run,
          timers,
          cue.clip.lingerMs,
        );
        if (!lingerCompleted || run.cancelled) break;

        completedCueIds.push(cue.id);
        safelyInvoke(() => hooks.onCueComplete?.(cue, index));
      }

      if (activeRun === run) activeRun = null;
      run.disposers.clear();
      return {
        status: run.cancelled ? "cancelled" : "completed",
        completedCueIds,
      };
    },
    setEnabled(enabled) {
      enabledOverride = enabled;
      if (!enabled) activeRun?.silenceAudio?.();
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      if (reusableAudio) stopAudio(reusableAudio);
      reusableAudio = null;
    },
  };
}
