export const SOUND_PREFERENCE_KEY = "spatial-gym-sound";

/** Creates a browser audio context without making sound a runtime dependency. */
export function createGameAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextConstructor) return null;
  try {
    return new AudioContextConstructor();
  } catch {
    return null;
  }
}

function scheduleTone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.015);
  oscillator.addEventListener(
    "ended",
    () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        // A disappearing audio destination must not affect gameplay.
      }
    },
    { once: true },
  );
}

/** Plays the suite's quiet correct or incorrect earcon. */
export function playFeedbackEarcon(
  context: AudioContext,
  correct: boolean,
) {
  try {
    const now = context.currentTime + 0.012;

    if (correct) {
      scheduleTone(context, 523.25, now, 0.13, 0.052);
      scheduleTone(context, 659.25, now + 0.075, 0.15, 0.048);
      return;
    }

    scheduleTone(context, 220, now, 0.11, 0.048);
    scheduleTone(context, 174.61, now + 0.055, 0.12, 0.044);
  } catch {
    // Sound is feedback enhancement; gameplay remains available without it.
  }
}

/** Plays a brief coin-like arpeggio when a Journey XP award is claimed. */
export function playXpJingle(context: AudioContext) {
  try {
    const now = context.currentTime + 0.012;
    scheduleTone(context, 659.25, now, 0.11, 0.044);
    scheduleTone(context, 783.99, now + 0.07, 0.13, 0.04);
    scheduleTone(context, 1046.5, now + 0.14, 0.17, 0.036);
  } catch {
    // XP remains visible and collectible when audio is unavailable.
  }
}

/** Reads the suite preference, falling back to a game's legacy keys. */
export function readSoundPreference(legacyKeys: readonly string[] = []): boolean {
  try {
    const shared = window.localStorage.getItem(SOUND_PREFERENCE_KEY);
    if (shared === "true" || shared === "false") return shared === "true";

    for (const key of legacyKeys) {
      const legacy = window.localStorage.getItem(key);
      if (legacy === "true" || legacy === "false") return legacy === "true";
    }
  } catch {
    // Default-on audio remains available for this visit when storage is blocked.
  }

  return true;
}

export function writeSoundPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, String(enabled));
  } catch {
    // The in-memory preference still applies when storage is blocked.
  }
}
