"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from "react";
import {
  createGameAudioContext,
  playFeedbackEarcon,
  playXpJingle,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { Avatar, DEFAULT_AVATAR_ID } from "@/components/progression/avatar";
import {
  TASK_IDS,
  AUDIO_TASK_IDS,
  VISUAL_TASK_IDS,
  advanceRound,
  createProgress,
  RESEARCH_PROFILE,
  getTaskProfile,
  studyDuration,
  finalTrackingPositions,
  generateRound,
  isCorrectResponse,
  recordFirstAttempt,
  rotateCell,
  type MemoryProgress,
  type MemoryRound,
  type TaskId,
  type SessionModality,
} from "./engine";
import {
  clearMemoryProgress,
  loadMemoryAudio,
  loadMemoryProgress,
  saveMemoryProgress,
  unlockMemoryVault,
  type MemoryContent,
  type MemoryTask,
} from "./vault";
import { createMemoryNarrator, type MemoryNarrator } from "./narration";
import { MEMORY_MOTION } from "./motion";
import OrderCue from "./OrderCue";
import { fresh, restore, normalizeSaved, selectTaskStates, taskTotals, type Saved, type InputMode } from "./progress";
import { useLocalSpeech } from "./use-local-speech";
import { LOCAL_SPEECH_DOWNLOAD_MB } from "./local-digit-recognition";
import {
  digitTaskForVariant,
  digitVariantFromLegacy,
  normalizeDigitVariant,
  type DigitRecallOrder,
  type DigitVariant,
} from "./digit-options";
import styles from "./memory.module.css";
import { MemoryCelebration, MemoryTrail } from "./MemoryTrail";
import { getMemoryRewards } from "./rewards";

type Phase =
  | "ready"
  | "cue"
  | "watch"
  | "hold"
  | "recall"
  | "correct"
  | "wrong"
  | "paused";

function Shape({ id }: { id: number }) {
  return (
    <svg className={styles.shape} viewBox="0 0 48 48" aria-hidden="true">
      {id % 6 === 0 && <circle cx="24" cy="24" r="15" fill="currentColor" />}
      {id % 6 === 1 && <path d="M24 6 44 40H4Z" fill="currentColor" />}
      {id % 6 === 2 && (
        <rect x="9" y="9" width="30" height="30" rx="2" fill="currentColor" />
      )}
      {id % 6 === 3 && <path d="m24 3 20 21-20 21L4 24Z" fill="currentColor" />}
      {id % 6 === 4 && (
        <path d="M17 5h14v12h12v14H31v12H17V31H5V17h12Z" fill="currentColor" />
      )}
      {id % 6 === 5 && (
        <path
          d="m24 3 6 14 15 2-11 10 3 16-13-8-13 8 3-16L3 19l15-2Z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
const shapeNames = ["circle", "triangle", "square", "diamond", "cross", "star"];

function describeDigitVariant(variant: DigitVariant): string {
  const order = variant.order === "reverse" ? "Reverse" : variant.order === "ascending" ? "Small → large" : "Large → small";
  return `${order} · ${variant.inputMode === "spoken" ? "spoken" : `keypad ${variant.keypad}`}`;
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className={styles.header}>
      <Link href="/" prefetch={false} className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>{" "}
        Spatial Gym <span aria-hidden="true">/</span>{" "}
        <strong>Memory Lab</strong>
      </Link>
      <div className={styles.headerActions}>{children}</div>
    </header>
  );
}

export function MemoryLabClient() {
  const [unlocked, setUnlocked] = useState<{
    content: MemoryContent;
    key: CryptoKey;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => request.current?.abort(), []);

  function lock() {
    request.current?.abort();
    request.current = null;
    setUnlocked(null);
    setPassword("");
    setBusy(false);
    setError("");
    window.requestAnimationFrame(() => passwordRef.current?.focus());
  }
  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const secret = password;
    setPassword("");
    setError("");
    setBusy(true);
    try {
      const result = await unlockMemoryVault(secret, controller.signal);
      if (!controller.signal.aborted && request.current === controller)
        setUnlocked(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to unlock. Please try again.",
        );
        passwordRef.current?.focus();
      }
    } finally {
      if (request.current === controller) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  if (unlocked)
    return (
      <UnlockedLab
        content={unlocked.content}
        cryptoKey={unlocked.key}
        onLock={lock}
      />
    );
  return (
    <div className={styles.shell}>
      <Header>
        {busy && (
          <button className={styles.quietButton} onClick={lock}>
            Cancel unlock
          </button>
        )}
      </Header>
      <main className={styles.main}>
        <div className={styles.lockLayout}>
          <section className={styles.lockCopy} aria-labelledby="lock-title">
            <h1 id="lock-title" className={styles.displayTitle}>
              Memory Lab
            </h1>
            <p className={styles.lede}>
              Memory games, little adventures, and a trail buddy.
            </p>
            <form className={styles.lockForm} onSubmit={unlock}>
              <label className={styles.passwordLabel} htmlFor="memory-password">
                Password
              </label>
              <div className={styles.inputRow}>
                <input
                  ref={passwordRef}
                  id="memory-password"
                  className={styles.passwordInput}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  required
                  aria-describedby={error ? "unlock-error" : undefined}
                />
                <button className={styles.button} disabled={busy || !password}>
                  {busy ? "Unlocking…" : "Unlock"}
                </button>
              </div>
              {error && (
                <p id="unlock-error" role="alert" className={styles.error}>
                  {error}
                </p>
              )}
            </form>
            <p className={styles.privacy}>
              Progress stays on this device. Refreshing or locking closes
              access.
            </p>
          </section>
          <div className={styles.lockBuddy} aria-hidden="true">
            <svg className={styles.lockLandscape} viewBox="0 0 360 250" fill="none">
              <path d="M0 187C56 145 97 157 146 177S260 147 360 167V250H0Z" fill="#e4efd9" />
              <path d="M0 214C92 185 119 240 207 209S312 193 360 221V250H0Z" fill="#cde3d4" />
              <path d="M162 250C222 218 240 211 213 193S172 180 190 164" stroke="#fffdf8" strokeWidth="19" strokeLinecap="round" />
              <path d="M42 132V195M24 157L42 121L61 157Z" stroke="#738f71" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M294 112V181M270 143L294 98L318 143Z" fill="#acc8a0" />
              <circle cx="284" cy="45" r="19" fill="#f3bd4e" />
            </svg>
            <Avatar avatar={DEFAULT_AVATAR_ID} size={160} decorative eager />
            <span className={styles.lockTrailLabel}>Your Memory Trail awaits</span>
          </div>
        </div>
      </main>
      <footer className={styles.footer}>
        <Link href="/" prefetch={false}>
          ← All games
        </Link>
      </footer>
    </div>
  );
}

function Example({ round }: { round: MemoryRound }) {
  const symbol = round.task === "symbols";
  const digit = round.answerKind === "ordered-digits";
  const cells = (answer: boolean) => {
    const values = answer ? round.expected : round.sequence;
    if (digit)
      return (
        <div className={styles.miniSequence}>
          {values.map((value, i) => (
            <span key={i} className={styles.miniCell}>
              {value}
            </span>
          ))}
        </div>
      );
    if (symbol)
      return (
        <div className={styles.miniSequence}>
          {values.map((value, i) => (
            <span key={i} className={styles.miniCell}>
              <Shape id={value} />
            </span>
          ))}
        </div>
      );
    const positions =
      round.task === "tracking"
        ? round.sequence.map((id) => round.positions![id])
        : round.task === "locations"
          ? round.positions!
          : values;
    return (
      <div className={styles.exampleBoard}>
        {Array.from({ length: 16 }, (_, cell) => {
          const indices = values
            .map((v, i) => (v === cell ? i + 1 : 0))
            .filter(Boolean);
          const active = answer ? indices.length > 0 : positions.includes(cell);
          return (
            <span
              key={cell}
              className={`${styles.exampleTile} ${active ? styles.lit : ""}`}
            >
              {round.task === "locations" &&
              !answer &&
              round.positions!.includes(cell) ? (
                <Shape id={round.positions!.indexOf(cell)} />
              ) : active && round.task !== "pattern" ? (
                (answer
                  ? indices
                  : round.task === "tracking"
                    ? round.sequence
                        .map((id, i) =>
                          round.positions![id] === cell ? i + 1 : 0,
                        )
                        .filter(Boolean)
                    : indices
                ).join("·")
              ) : active ? (
                "●"
              ) : (
                ""
              )}
            </span>
          );
        })}
      </div>
    );
  };
  return (
    <div className={styles.example}>
      <div className={styles.exampleSteps}>
        <div>
          {cells(false)}
          <span className={styles.exampleText}>
            {round.task === "locations"
              ? "Remember the homes"
              : round.task === "pattern"
                ? "Watch together"
                : digit
                  ? "Hear these digits"
                  : "Watch this order"}
          </span>
        </div>
        <span className={styles.exampleArrow} aria-hidden="true">
          →
        </span>
        <div>
          {cells(true)}
          <span className={styles.exampleText}>
            ✓{" "}
            {round.task === "backward"
              ? "Tap in reverse"
              : round.task === "pattern"
                ? "Select all lit places"
                : digit
                  ? round.task === "sort-digits"
                    ? round.digitOrder === "descending"
                      ? "Largest → smallest"
                      : "Smallest → largest"
                    : "Enter in reverse"
                  : "Tap in this order"}
          </span>
        </div>
      </div>
      {round.task === "locations" && (
        <div className={styles.miniSequence} aria-label="Example shape cues">
          {round.cues!.map((id, i) => (
            <span key={i} className={styles.miniCell}>
              <Shape id={id} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryBoard({
  target,
  phase,
  flash,
  positions,
  rotated,
  motionEnabled,
  response,
  firstCell,
  answer,
}: {
  target: MemoryRound;
  phase: Phase;
  flash: number;
  positions: number[];
  rotated: boolean;
  motionEnabled: boolean;
  response: number[];
  firstCell: RefObject<HTMLButtonElement | null>;
  answer: (value: number) => void;
}) {
  const turn = target.rotation === "clockwise" ? 90 : -90;
  const boardClass = `${styles.board} ${target.task === "rotation" ? styles.rotationBoard : ""} ${phase === "cue" ? styles.boardSetup : ""} ${motionEnabled ? styles.boardMotion : ""}`;
  const motionStyle = {
    "--turn-duration": `${MEMORY_MOTION.turn}ms`,
    "--marker-duration": `${MEMORY_MOTION.marker}ms`,
  } as CSSProperties;
  const physical = (cell: number) =>
    target.task === "rotation" && rotated
      ? rotateCell(cell, target.rotation!)
      : cell;
  if (target.answerKind === "ordered-digits") {
    const hide =
      (target.digitVariant ? target.digitVariant.keypad === "hidden" : target.task === "hidden-digits") &&
      ["cue", "watch", "hold"].includes(phase);
    return (
      <>
        <div
          className={styles.digitKeypad}
          role="group"
          aria-label="Digit keypad"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <button
              ref={i === 0 ? firstCell : undefined}
              key={i}
              className={styles.digitButton}
              disabled={phase !== "recall"}
              aria-label={hide ? "Hidden keypad button" : `Digit ${i + 1}`}
              aria-keyshortcuts={String(i + 1)}
              onClick={() => answer(i + 1)}
            >
              {hide ? "·" : i + 1}
            </button>
          ))}
        </div>
      </>
    );
  }
  if (target.task === "symbols")
    return (
      <>
        <div className={styles.stimulus} aria-label="Shape presentation">
          {phase === "watch" && flash >= 0 ? (
            <Shape id={target.sequence[flash]} />
          ) : (
            <span aria-hidden="true">{phase === "cue" ? "+" : "·"}</span>
          )}
        </div>
        <div className={styles.symbolPalette}>
          {shapeNames.map((name, id) => (
            <button
              ref={id === 0 ? firstCell : undefined}
              key={name}
              className={styles.symbolButton}
              disabled={phase !== "recall"}
              aria-label={name}
              onClick={() => answer(id)}
            >
              <Shape id={id} />
            </button>
          ))}
        </div>
      </>
    );
  if (target.task === "tracking")
    return (
      <div className={styles.boardWrap}>
        <div
          className={boardClass}
          style={motionStyle}
          aria-label="Moving targets on a four by four board"
        >
          {Array.from({ length: 16 }, (_, cell) => (
            <span key={cell} className={styles.cell} aria-hidden="true" />
          ))}
          {(positions.length ? positions : target.positions!).map(
            (cell, id) => (
              <button
                ref={id === 0 ? firstCell : undefined}
                className={`${styles.marker} ${motionEnabled ? styles.markerMotion : ""} ${phase === "watch" && target.sequence[flash] === id ? styles.markerActive : ""} ${response.includes(cell) ? styles.selected : ""}`}
                style={{
                  // A cell step is 125% of the marker's 20%-board width.
                  transform: `translate3d(${(cell % 4) * 125 + 12.5}%, ${Math.floor(cell / 4) * 125 + 12.5}%, 0)`,
                }}
                key={id}
                disabled={phase !== "recall"}
                onClick={() => answer(cell)}
                aria-label={`Circle at row ${Math.floor(cell / 4) + 1}, column ${(cell % 4) + 1}`}
              >
                {response.includes(cell) && (
                  <span className={styles.cellOrder}>
                    {response
                      .map((v, i) => (v === cell ? i + 1 : 0))
                      .filter(Boolean)
                      .join("·")}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      </div>
    );
  return (
    <div className={`${styles.boardWrap} ${target.task === "rotation" ? styles.rotationWrap : ""}`}>
      <div
        className={`${boardClass} ${target.task === "split" ? styles.splitBoard : ""}`}
        style={{
          ...motionStyle,
          transform:
            target.task === "rotation" && rotated
              ? `rotate(${turn}deg)`
              : undefined,
        }}
        aria-label="Four by four memory board"
      >
        {target.task === "rotation" && (
          <span className={styles.boardCorner} aria-hidden="true">
            ▲
          </span>
        )}
        {Array.from({ length: 16 }, (_, cell) => {
          const actual = physical(cell);
          const selected = response.includes(actual);
          const lit =
            phase === "watch" &&
            (target.task === "pattern"
              ? target.sequence.includes(cell)
              : target.task === "locations"
                ? target.positions!.includes(cell)
                : target.sequence[flash] === cell);
          const locationSymbol =
            target.task === "locations" ? target.positions!.indexOf(cell) : -1;
          return (
            <button
              ref={cell === 0 ? firstCell : undefined}
              key={cell}
              className={`${styles.cell} ${lit ? styles.lit : ""} ${selected ? styles.selected : ""}`}
              disabled={phase !== "recall"}
              aria-label={`Row ${Math.floor(actual / 4) + 1}, column ${(actual % 4) + 1}`}
              aria-pressed={target.task === "pattern" ? selected : undefined}
              onClick={() => answer(actual)}
            >
              <span
                className={styles.cellContent}
                style={{
                  display: "inline-flex",
                  transform:
                    target.task === "rotation" && rotated
                      ? `rotate(${-turn}deg)`
                      : undefined,
                }}
              >
                {lit && locationSymbol >= 0 ? (
                  <Shape id={locationSymbol} />
                ) : lit ? (
                  <span aria-hidden="true">●</span>
                ) : selected ? (
                  <span className={styles.cellOrder}>
                    {target.task === "pattern"
                      ? "✓"
                      : response
                          .map((v, i) => (v === actual ? i + 1 : 0))
                          .filter(Boolean)
                          .join("·")}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UnlockedLab({
  content,
  cryptoKey,
  onLock,
}: {
  content: MemoryContent;
  cryptoKey: CryptoKey;
  onLock: () => void;
}) {
  const speech = useLocalSpeech();
  const cancelSpeech = speech.cancel;
  const [saved, setSaved] = useState<Saved>(fresh);
  const savedRef = useRef(saved);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [coach, setCoach] = useState(false);
  const [sound, setSound] = useState(true);
  const [length, setLength] = useState<24 | 48>(24);
  const [modality, setModality] = useState<SessionModality>("mixed");
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoadAttempt, setAudioLoadAttempt] = useState(0);
  const narration = useRef<MemoryNarrator | null>(null);
  const soundRef = useRef(true);
  const [phase, setPhase] = useState<Phase>("ready");
  const [flash, setFlash] = useState(-1);
  const [rotated, setRotated] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [response, setResponse] = useState<number[]>([]);
  const responseRef = useRef<number[]>([]);
  const [spokenDebug, setSpokenDebug] = useState<{ roundId: string; digits: readonly number[] } | null>(null);
  const speechOperation = useRef(0);
  const speechSubmitting = useRef(false);
  const phaseRef = useRef<Phase>(phase);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [review, setReview] = useState<MemoryRound | null>(null);
  const [lastResult, setLastResult] = useState<{
    number: number;
    retried: boolean;
  } | null>(null);
  const [exampleOpen, setExampleOpen] = useState(false);
  const playback = useRef(0);
  const mounted = useRef(true);
  const [pausedFrom, setPausedFrom] = useState<Phase>("watch");
  const audio = useRef<AudioContext | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const firstCell = useRef<HTMLButtonElement>(null);
  const spokenStatus = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const roundTitleRef = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreReviewFocus = useRef(false);
  const keypadPreference = useRef<"visible" | "hidden">("visible");
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const session = saved.session;
  const round = session?.active ?? null;
  const current = review ?? round;
  const reviewSolved = review && (session?.history.some((item) => item.round.id === review.id && item.correct) || saved.redeemed.includes(review.id));
  const task = content.tasks.find((item) => item.id === current?.task);
  const currentDigitVariant = current?.answerKind === "ordered-digits"
    ? current.digitVariant ?? digitVariantFromLegacy(current.task, saved.sessionCondition?.inputMode ?? "keypad", current.digitOrder ?? "ascending")
    : null;
  const spoken = currentDigitVariant?.inputMode === "spoken";
  const digitsTask = digitTaskForVariant(saved.digitVariant);
  const legacyDigitRound = session?.active?.answerKind === "ordered-digits" && !saved.sessionCondition?.digitVariant ? session.active : null;
  const displayedDigitsTask = legacyDigitRound?.task ?? digitsTask;
  const displayedDigitVariant = legacyDigitRound
    ? digitVariantFromLegacy(legacyDigitRound.task, saved.sessionCondition?.inputMode ?? "keypad", legacyDigitRound.digitOrder ?? "ascending")!
    : saved.digitVariant;
  const visualTasks = content.tasks.filter((item) => VISUAL_TASK_IDS.includes(item.id as (typeof VISUAL_TASK_IDS)[number]));
  const games = [...visualTasks.map((item) => ({ id: item.id, title: item.title, task: item.id as TaskId })), { id: "digits", title: "Digits", task: displayedDigitsTask }];
  const selectedTasks = session?.active ? session.tasks : selectTaskStates(saved);
  const totals = taskTotals(saved);
  const rewards = getMemoryRewards(saved);
  const listeningReady = audioReady && (saved.inputMode !== "spoken" || speech.ready);
  const suggestedGame = games[rewards.completedStops % games.length];
  const adventureGame = suggestedGame.id === "digits" && (!listeningReady || !sound)
    ? games[0]
    : suggestedGame;

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const persist = useCallback(
    (value: Saved) => {
      const next = normalizeSaved(value);
      savedRef.current = next;
      setSaved(next);
      void saveMemoryProgress(cryptoKey, next).catch(() => {
        if (mounted.current)
          setNotice(
            "Device storage is unavailable. Keep this tab open to retain your progress.",
          );
      });
    },
    [cryptoKey],
  );
  useEffect(() => {
    mounted.current = true;
    const frame = requestAnimationFrame(() => {
      const preference = readSoundPreference();
      soundRef.current = preference;
      setSound(preference);
    });
    const pendingTimers = timers.current;
    void loadMemoryProgress(cryptoKey)
      .then((value) => {
        if (!mounted.current) return;
        if (value !== null) {
          const restored = restore(value);
          if (restored) {
            savedRef.current = restored;
            setSaved(restored);
          } else
            setNotice(
              "Saved progress could not be restored. You can begin a new session.",
            );
        }
        setLoaded(true);
      })
      .catch(() => {
        if (mounted.current) {
          setNotice(
            "Saved progress is unavailable. You can still practice in this tab.",
          );
          setLoaded(true);
        }
      });
    return () => {
      mounted.current = false;
      playback.current += 1;
      cancelAnimationFrame(frame);
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
      void audio.current?.close().catch(() => undefined);
    };
  }, [cryptoKey]);

  useEffect(() => {
    const controller = new AbortController();
    let disposeAssets: (() => void) | undefined;
    void loadMemoryAudio(cryptoKey, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          result.dispose();
          return;
        }
        disposeAssets = result.dispose;
        narration.current = createMemoryNarrator(result.urls, {
          isSoundEnabled: () => soundRef.current,
          onPlaybackFailure: (message) => {
            speechOperation.current += 1;
            speechSubmitting.current = false;
            cancelSpeech();
            setSpokenDebug(null);
            playback.current += 1;
            narration.current?.cancel();
            setFlash(-1);
            changePhase("ready");
            setNotice(message);
          },
        });
        setAudioReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice(
            "Audio could not load. You can use the visual exercises or retry the audio.",
          );
      });
    return () => {
      controller.abort();
      narration.current?.dispose();
      narration.current = null;
      disposeAssets?.();
    };
  }, [cryptoKey, audioLoadAttempt, changePhase, cancelSpeech]);

  function cancelPlayback() {
    speechOperation.current += 1;
    speechSubmitting.current = false;
    cancelSpeech();
    setSpokenDebug(null);
    playback.current += 1;
    narration.current?.cancel();
    setMotionEnabled(false);
    setFlash(-1);
  }
  const pause = useCallback(() => {
    if (["cue", "watch", "hold", "recall"].includes(phaseRef.current)) {
      setPausedFrom(phaseRef.current);
      speechOperation.current += 1;
      speechSubmitting.current = false;
      cancelSpeech();
      setSpokenDebug(null);
      if (savedRef.current.sessionCondition?.inputMode === "spoken" && savedRef.current.session?.active?.answerKind === "ordered-digits") {
        responseRef.current = [];
        setResponse([]);
      }
      playback.current += 1;
      narration.current?.cancel();
      setMotionEnabled(false);
      setFlash(-1);
      changePhase("paused");
    }
  }, [changePhase, cancelSpeech]);
  useEffect(() => {
    function hidden() {
      if (document.hidden) pause();
    }
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [pause]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (review) actionRef.current?.focus();
      else if (restoreReviewFocus.current) {
        restoreReviewFocus.current = false;
        reviewTrigger.current?.focus();
      } else if (phase === "cue")
        roundTitleRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      else if (phase === "recall") firstCell.current?.focus();
      else if (["ready", "correct", "wrong", "paused"].includes(phase))
        actionRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, current?.id, playing, review]);

  useEffect(() => {
    if (!spoken || phase !== "recall") return;
    const frame = requestAnimationFrame(() => {
      if (speech.failure) actionRef.current?.focus();
      else spokenStatus.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [speech.state, speech.failure, spoken, phase]);

  useEffect(() => {
    if (!spoken || phase !== "ready" || !speech.ready) return;
    const frame = requestAnimationFrame(() => actionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [spoken, phase, speech.ready]);

  function primeAudio() {
    if (savedRef.current.sessionCondition?.inputMode === "spoken"
      && savedRef.current.session?.plan.some((id) => AUDIO_TASK_IDS.includes(id as (typeof AUDIO_TASK_IDS)[number]))) speech.prime();
    narration.current?.prime();
    if (!audio.current) audio.current = createGameAudioContext();
    if (audio.current?.state === "suspended")
      void audio.current.resume().catch(() => undefined);
  }
  function feedbackAudio(correct: boolean, complete = false) {
    if (!soundRef.current || !audio.current) return;
    if (correct && complete) playXpJingle(audio.current);
    else playFeedbackEarcon(audio.current, correct);
  }
  function wait(ms: number, token: number) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        if (playback.current !== token || !mounted.current)
          reject(new Error("cancelled"));
        else resolve();
      }, ms);
      timers.current.add(timer);
    });
  }
  async function present(target: MemoryRound) {
    if (target.answerKind === "ordered-digits" && savedRef.current.sessionCondition?.inputMode === "spoken" && !speech.ready) {
      changePhase("ready");
      return;
    }
    if (
      target.answerKind === "ordered-digits" &&
      (!soundRef.current || !narration.current)
    ) {
      setNotice(
        "Turn sound on and wait for neural audio before beginning a listening round.",
      );
      return;
    }
    speechOperation.current += 1;
    speechSubmitting.current = false;
    cancelSpeech();
    setSpokenDebug(null);
    setExampleOpen(false);
    primeAudio();
    const token = ++playback.current;
    const slow = savedRef.current.sessionCondition?.slow ?? savedRef.current.slow;
    const on = slow ? 1200 : 800;
    const gap = slow ? 300 : 200;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setResponse([]);
    responseRef.current = [];
    setMotionEnabled(false);
    setRotated(false);
    setPositions(target.positions ? [...target.positions] : []);
    setFlash(-1);
    changePhase("cue");
    try {
      await wait(600, token);
      changePhase("watch");
      if (target.answerKind === "ordered-digits") {
        const narrator = narration.current!;
        for (let index = 0; index < target.sequence.length; index++) {
          const result = await narrator.play([String(target.sequence[index])], {
            onCueStart: () => setFlash(index),
          });
          if (
            result.status !== "completed" ||
            narrator.didPlaybackFail() ||
            playback.current !== token
          )
            return;
          setFlash(-1);
          if (slow) await wait(500, token);
        }
      } else if (target.task === "locations" || target.task === "pattern") {
        setFlash(-2);
        await wait(studyDuration(target, slow), token);
        setFlash(-1);
      } else {
        for (let i = 0; i < target.sequence.length; i++) {
          setFlash(i);
          await wait(on, token);
          setFlash(-1);
          await wait(gap, token);
        }
      }
      changePhase("hold");
      if (target.task === "rotation") {
        setMotionEnabled(!reducedMotion);
        await wait(MEMORY_MOTION.prelude, token);
        setRotated(true);
        await wait(MEMORY_MOTION.turn + MEMORY_MOTION.turnSettle, token);
      } else if (target.task === "tracking") {
        setMotionEnabled(!reducedMotion);
        await wait(MEMORY_MOTION.prelude, token);
        const moving = [...target.positions!];
        for (const [a, b] of target.moves!) {
          const old = moving[a];
          const destination = moving[b];
          const empty = Array.from({ length: 16 }, (_, i) => i).find(
            (cell) => !moving.includes(cell),
          )!;
          // Move through an empty place so identical circles never cross ambiguously.
          moving[a] = empty;
          setPositions([...moving]);
          await wait(MEMORY_MOTION.marker + MEMORY_MOTION.markerSettle, token);
          moving[b] = old;
          setPositions([...moving]);
          await wait(MEMORY_MOTION.marker + MEMORY_MOTION.markerSettle, token);
          moving[a] = destination;
          setPositions([...moving]);
          await wait(MEMORY_MOTION.marker + MEMORY_MOTION.markerSettle, token);
        }
      } else await wait(800, token);
      changePhase("recall");
      if (target.answerKind === "ordered-digits" && savedRef.current.sessionCondition?.inputMode === "spoken"
        && playback.current === token && !document.hidden) beginSpoken();
    } catch {
      /* Pausing, locking, and navigation cancel the presentation. */
    }
  }

  function changeDigitVariant(patch: Partial<DigitVariant>) {
    const previous = savedRef.current;
    if (previous.digitVariant.keypad !== "none") keypadPreference.current = previous.digitVariant.keypad;
    const options = { ...previous.digitVariant, ...patch };
    if (options.inputMode === "keypad" && options.keypad === "none") options.keypad = keypadPreference.current;
    const digitVariant = normalizeDigitVariant(options);
    persist({
      ...previous,
      digitVariant,
      inputMode: digitVariant.inputMode,
      digitOrder: digitVariant.order === "reverse" ? previous.digitOrder : digitVariant.order,
    });
  }
  function start(focusedTask?: TaskId, autoPresent = false) {
    const needsListening = focusedTask ? AUDIO_TASK_IDS.includes(focusedTask as (typeof AUDIO_TASK_IDS)[number]) : modality !== "visual";
    if (needsListening && !listeningReady) return;
    cancelPlayback();
    setReview(null);
    setLastResult(null);
    setExampleOpen(false);
    try {
      const next = createProgress(
        crypto.randomUUID(),
        focusedTask ? 8 : length,
        {
          focusedTask, tasks: selectTaskStates(savedRef.current), modality,
          digitOrder: savedRef.current.digitOrder, profile: RESEARCH_PROFILE,
          ...(needsListening ? { digitVariant: savedRef.current.digitVariant } : {}),
        },
      );
      persist({ ...savedRef.current, session: next, tasks: next.tasks, redeemed: [], sessionCondition: {
        slow: savedRef.current.slow,
        inputMode: savedRef.current.inputMode,
        digitOrder: savedRef.current.digitOrder,
        digitVariant: savedRef.current.digitVariant,
      } });
      setPlaying(true);
      setResponse([]);
      responseRef.current = [];
      changePhase("ready");
      if (autoPresent && next.active) {
        primeAudio();
        presentOrAwaitSound(next.active);
      }
    } catch {
      setNotice("A new session could not be prepared. Please try again.");
    }
  }
  function startAdventure() {
    if (savedRef.current.session?.active) resume();
    else start(adventureGame.task, true);
  }
  function enableListening(target: MemoryRound) {
    if (target.answerKind === "ordered-digits" && !soundRef.current) {
      soundRef.current = true;
      setSound(true);
      writeSoundPreference(true);
      narration.current?.setEnabled(true);
    }
  }
  function presentOrAwaitSound(target: MemoryRound) {
    if (target.answerKind === "ordered-digits" && (!soundRef.current || !audioReady
      || (savedRef.current.sessionCondition?.inputMode === "spoken" && !speech.ready)))
      changePhase("ready");
    else void present(target);
  }
  function resume() {
    cancelPlayback();
    primeAudio();
    setReview(null);
    setLastResult(null);
    setPlaying(true);
    setResponse([]);
    responseRef.current = [];
    const s = savedRef.current.session;
    if (!s?.active) {
      changePhase("ready");
      requestAnimationFrame(() => headingRef.current?.focus());
    } else if (
      s.answered &&
      (s.history.at(-1)?.correct ||
        savedRef.current.redeemed.includes(s.active.id))
    ) {
      changePhase("correct");
      advanceAndPresent(s);
    } else if (s.answered) {
      setRotated(s.active.task === "rotation");
      setPositions(
        s.active.task === "tracking"
          ? finalTrackingPositions(s.active)
          : (s.active.positions ?? []),
      );
      changePhase("wrong");
    } else {
      presentOrAwaitSound(s.active);
    }
  }
  function goHome() {
    cancelPlayback();
    setPlaying(false);
    setReview(null);
    setExampleOpen(false);
    setLastResult(null);
    changePhase("ready");
  }
  function answer(value: number) {
    if (phaseRef.current !== "recall" || !current || review) return;
    const previous = responseRef.current;
    const next =
      current.answerKind === "unordered-cells" && previous.includes(value)
        ? previous.filter((cell) => cell !== value)
        : previous.length < current.span
          ? [...previous, value]
          : previous;
    responseRef.current = next;
    setResponse(next);
  }
  function undo() {
    if (phaseRef.current !== "recall") return;
    const next = responseRef.current.slice(0, -1);
    responseRef.current = next;
    setResponse(next);
  }
  function retrySpoken() {
    if (phaseRef.current !== "recall" || !spoken || review || !speech.ready || !speech.failure) return;
    primeAudio();
    speechOperation.current += 1;
    speechSubmitting.current = false;
    cancelSpeech();
    setSpokenDebug(null);
    beginSpoken();
  }
  function beginSpoken() {
    const active = savedRef.current.session?.active;
    if (phaseRef.current !== "recall" || !active || review
      || active.answerKind !== "ordered-digits" || savedRef.current.sessionCondition?.inputMode !== "spoken") return;
    const operation = ++speechOperation.current;
    const token = playback.current;
    speechSubmitting.current = false;
    void speech.record((recognized) => {
      if (!mounted.current || operation !== speechOperation.current || playback.current !== token
        || document.hidden || phaseRef.current !== "recall" || savedRef.current.session?.active?.id !== active.id
        || speechSubmitting.current) return;
      speechSubmitting.current = true;
      if (recognized.status === "recognized") submit(recognized.digits);
    });
  }
  function submit(spokenDigits?: readonly number[]) {
    const s = savedRef.current.session;
    if (
      phaseRef.current !== "recall" ||
      !s?.active ||
      (savedRef.current.sessionCondition?.inputMode === "spoken" && s.active.answerKind === "ordered-digits"
        ? !spokenDigits?.length
        : responseRef.current.length !== s.active.span) ||
      review
    )
      return;
    primeAudio();
    const isSpoken = savedRef.current.sessionCondition?.inputMode === "spoken" && s.active.answerKind === "ordered-digits";
    const submitted = isSpoken ? spokenDigits! : responseRef.current;
    const correct = isCorrectResponse(s.active, submitted);
    // Lock synchronously so double clicks and held keys cannot submit twice.
    changePhase(correct ? "correct" : "wrong");
    setSpokenDebug(isSpoken && !correct ? { roundId: s.active.id, digits: Object.freeze([...submitted]) } : null);
    if (isSpoken) cancelSpeech();
    setLastResult(null);
    feedbackAudio(correct, s.cursor === s.length - 1);
    const next = s.answered ? s : recordFirstAttempt(s, s.active, correct);
    const retried = !next.history.at(-1)?.correct;
    const redeemed =
      correct && retried
        ? [...new Set([...savedRef.current.redeemed, s.active.id])]
        : savedRef.current.redeemed;
    persist({
      ...savedRef.current,
      session: next,
      tasks: next.tasks,
      redeemed,
    });
    if (correct) {
      setLastResult({ number: s.cursor + 1, retried });
      advanceAndPresent(next);
    }
  }
  function advanceAndPresent(progress: MemoryProgress) {
    if (!progress.active || !progress.answered) return;
    try {
      const next = advanceRound(progress);
      let logs = savedRef.current.logs;
      if (!next.active && !logs.some((log) => log.id === next.seed)) {
        logs = [
          ...logs,
          {
            id: next.seed,
            date: new Date().toISOString(),
            rounds: next.length,
            correct: next.history.filter((item) => item.correct).length,
            maxSpan: Math.max(
              ...next.history
                .filter((item) => item.correct)
                .map((item) => item.round.span),
              0,
            ),
            slow: savedRef.current.sessionCondition?.slow ?? savedRef.current.slow,
            ...(next.plan.some((id) => AUDIO_TASK_IDS.includes(id as (typeof AUDIO_TASK_IDS)[number]))
              ? { inputMode: savedRef.current.sessionCondition?.inputMode ?? "keypad" }
              : {}),
            ...(next.profile ? { profile: next.profile } : {}),
            ...(next.digitVariant ? { digitVariant: next.digitVariant } : {}),
            ...(next.plan.includes("sort-digits")
              ? { digitOrder: next.digitOrder ?? "ascending" }
              : {}),
            modality: next.focusedTask
              ? AUDIO_TASK_IDS.includes(
                  next.focusedTask as (typeof AUDIO_TASK_IDS)[number],
                )
                ? "audio"
                : "visual"
              : next.modality,
          },
        ].slice(-500);
      }
      persist({ ...savedRef.current, session: next, tasks: next.tasks, logs });
      setReview(null);
      setResponse([]);
      responseRef.current = [];
      setRotated(false);
      setFlash(-1);
      if (next.active) {
        presentOrAwaitSound(next.active);
      } else {
        changePhase("ready");
        requestAnimationFrame(() => headingRef.current?.focus());
      }
    } catch {
      changePhase("correct");
      setNotice("The next round could not be prepared. Try continuing again.");
    }
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (event.key === "Escape") pause();
      if (
        /^[1-9]$/.test(event.key) &&
        phaseRef.current === "recall" &&
        savedRef.current.session?.active?.answerKind === "ordered-digits" &&
        savedRef.current.sessionCondition?.inputMode !== "spoken"
      ) {
        event.preventDefault();
        const active = savedRef.current.session.active;
        if (responseRef.current.length < active.span) {
          const next = [...responseRef.current, Number(event.key)];
          responseRef.current = next;
          setResponse(next);
        }
      }
      if (event.key === "Backspace" && phaseRef.current === "recall" && !(savedRef.current.sessionCondition?.inputMode === "spoken" && savedRef.current.session?.active?.answerKind === "ordered-digits")) {
        event.preventDefault();
        const next = responseRef.current.slice(0, -1);
        responseRef.current = next;
        setResponse(next);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [pause]);

  const attempts = TASK_IDS.reduce(
    (sum, id) => sum + totals[id].attempts,
    0,
  );
  const totalCorrect = TASK_IDS.reduce(
    (sum, id) => sum + totals[id].correct,
    0,
  );
  const isLive = ["cue", "watch", "hold", "recall"].includes(phase);

  return (
    <div className={styles.shell}>
      <Header>
        <button
          className={styles.quietButton}
          aria-pressed={sound}
          onClick={() => {
            const next = !sound;
            soundRef.current = next;
            setSound(next);
            writeSoundPreference(next);
            narration.current?.setEnabled(next);
            if (!next && round?.answerKind === "ordered-digits") pause();
            else primeAudio();
          }}
        >
          {sound ? "Sound on" : "Sound off"}
        </button>
        <button
          className={styles.quietButton}
          onClick={() => {
            cancelPlayback();
            onLock();
          }}
        >
          Lock
        </button>
      </Header>
      <main className={styles.main}>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {!loaded ? (
          <p role="status">Loading…</p>
        ) : !playing ? (
          <>
            <MemoryTrail
              saved={saved}
              onStart={startAdventure}
              nextGameTitle={adventureGame.title}
              hasActiveSession={!!session?.active}
              startDisabled={!!session?.active && saved.sessionCondition?.inputMode === "spoken"
                && session.plan.some((id) => AUDIO_TASK_IDS.includes(id as (typeof AUDIO_TASK_IDS)[number])) && !speech.ready}
              onBuddyChange={(buddy) => persist({ ...savedRef.current, buddy })}
            />
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>More ways to play</h2>
              <button
                className={styles.linkButton}
                onClick={() => setCoach(!coach)}
                aria-expanded={coach}
              >
                {coach ? "Hide progress" : "Progress"}
              </button>
            </div>
            {coach && (
              <section className={styles.coach} aria-label="Practice progress">
                <h2 className={styles.sectionTitle}>Progress</h2>
                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>
                      {saved.logs.length}
                    </span>
                    <span className={styles.statLabel}>sessions completed</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>
                      {attempts
                        ? `${Math.round((totalCorrect / attempts) * 100)}%`
                        : "—"}
                    </span>
                    <span className={styles.statLabel}>first-try accuracy</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{attempts || "—"}</span>
                    <span className={styles.statLabel}>rounds practiced</span>
                  </div>
                </div>

                <p>
                  Span is the number of items to recall. Scores describe
                  practice in these exercises. The table shows your current
                  game settings. Earlier records remain included in the totals
                  and session history.
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table className={styles.coachTable}>
                    <thead>
                      <tr>
                        <th>Exercise</th>
                        <th>Next span</th>
                        <th>Rounds</th>
                        <th>First try</th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((game) => (
                        <tr key={game.id}>
                          <th scope="row">{game.title}</th>
                          <td>{selectedTasks[game.task].span}</td>
                          <td>{selectedTasks[game.task].attempts}</td>
                          <td>
                            {selectedTasks[game.task].attempts
                              ? `${Math.round((selectedTasks[game.task].correct / selectedTasks[game.task].attempts) * 100)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {saved.logs.length > 1 && (
                  <svg
                    className={styles.chart}
                    role="img"
                    aria-label="Highest span recalled correctly on the first try in each of the last 20 sessions, range 0 to 9; zero means no first-try correct round"
                    viewBox="0 0 600 150"
                  >
                    <path
                      d="M25 15V125H580"
                      stroke="currentColor"
                      opacity=".2"
                      fill="none"
                    />
                    <text x="4" y="20" fontSize="12">
                      9
                    </text>
                    <text x="4" y="128" fontSize="12">
                      0
                    </text>
                    <polyline
                      points={saved.logs
                        .slice(-20)
                        .map(
                          (log, i, all) =>
                            `${25 + (i * 550) / Math.max(1, all.length - 1)},${125 - (log.maxSpan / 9) * 110}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke="#16836b"
                      strokeWidth="3"
                    />
                    {saved.logs.slice(-20).map((log, i, all) => (
                      <circle
                        key={log.id}
                        cx={25 + (i * 550) / Math.max(1, all.length - 1)}
                        cy={125 - (log.maxSpan / 9) * 110}
                        r="4"
                        fill="#16836b"
                      >
                        <title>
                          {new Date(log.date).toLocaleDateString()}: span{" "}
                          {log.maxSpan} · {log.modality} ·{" "}
                          {log.slow ? "slower" : "standard"}
                          {log.digitVariant ? ` · ${describeDigitVariant(log.digitVariant)}` : `${log.digitOrder ? ` · ${log.digitOrder}` : ""}${log.inputMode ? ` · ${log.inputMode}` : ""}`}
                        </title>
                      </circle>
                    ))}
                  </svg>
                )}
                {saved.logs.length > 0 && (
                  <ul className={styles.historyList}>
                    {saved.logs
                      .slice(-5)
                      .reverse()
                      .map((log) => (
                        <li key={log.id} className={styles.historyItem}>
                          <span>{new Date(log.date).toLocaleDateString()}</span>
                          <span>
                            {log.correct}/{log.rounds} first try ·{" "}
                            {log.modality} ·{" "}
                            {log.slow ? "slower pace" : "standard pace"}
                            {log.digitVariant ? ` · ${describeDigitVariant(log.digitVariant)}` : `${log.digitOrder ? ` · ${log.digitOrder}` : ""}${log.inputMode ? ` · ${log.inputMode}` : ""}`}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            )}
            <div
              className={styles.modalityTabs}
              role="group"
              aria-label="Session exercises"
            >
              {(["mixed", "visual", "audio"] as const).map((mode) => (
                <button
                  key={mode}
                  className={styles.modalityTab}
                  disabled={!!session?.active}
                  aria-pressed={modality === mode}
                  onClick={() => setModality(mode)}
                >
                  {mode === "mixed"
                    ? "Visual + listening"
                    : mode === "visual"
                      ? "Visual only"
                      : "Listening only"}
                </button>
              ))}
            </div>
            <section className={styles.sessionCard}>
              <div className={styles.sessionCopy}>
                <h2 className={styles.sectionTitle}>
                  {session?.active ? "Continue session" : "Start a session"}
                </h2>
                <p>
                  {session?.active
                    ? `Round ${session.cursor + 1} of ${session.length}.`
                    : modality === "mixed"
                      ? "Visual games alternate with your chosen Digits settings."
                      : modality === "visual"
                        ? "Eight visual exercises."
                        : "Digits with the settings below."}
                </p>
              </div>
              <div className={styles.sessionOptions}>
                {session?.active ? (
                  <>
                    <button className={styles.button} onClick={resume} disabled={saved.sessionCondition?.inputMode === "spoken" && session.plan.some((id) => AUDIO_TASK_IDS.includes(id as (typeof AUDIO_TASK_IDS)[number])) && !speech.ready}>
                      Continue session →
                    </button>
                    <button
                      className={styles.quietButton}
                      onClick={() =>
                        persist({
                          ...savedRef.current,
                          session: null,
                          redeemed: [],
                        })
                      }
                    >
                      End session
                    </button>
                  </>
                ) : (
                  <>
                    <label
                      htmlFor="session-length"
                      className={styles.screenReader}
                    >
                      Session length
                    </label>
                    <select
                      className={styles.select}
                      id="session-length"
                      value={length}
                      onChange={(event) =>
                        setLength(Number(event.target.value) as 24 | 48)
                      }
                    >
                      <option value={24}>Short mix · 24 rounds</option>
                      <option value={48}>Full mix · 48 rounds</option>
                    </select>
                    <button
                      className={styles.button}
                      disabled={modality !== "visual" && !listeningReady}
                      onClick={() => start()}
                    >
                      Start a session →
                    </button>
                  </>
                )}
              </div>
            </section>
            <div className={styles.settings}>
              {!audioReady && (
                <button
                  className={styles.secondaryButton}
                  onClick={() => setAudioLoadAttempt((value) => value + 1)}
                >
                  Retry audio
                </button>
              )}
              <label className={styles.settingRow}>
                <input
                  type="checkbox"
                  checked={saved.slow}
                  disabled={!!session?.active}
                  onChange={(event) =>
                    persist({ ...savedRef.current, slow: event.target.checked })
                  }
                />{" "}
                Slower presentation
              </label>

            </div>
            <section aria-labelledby="exercise-title">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="exercise-title" className={styles.sectionTitle}>
                    Games
                  </h2>
                </div>
                <p>Eight rounds of one exercise.</p>
              </div>
              <article className={styles.digitsCard} aria-labelledby="digits-game-title">
                <div className={styles.digitsHeading}>
                  <div>
                    <h3 id="digits-game-title" className={styles.taskTitle}>Digits</h3>
                    <span className={styles.taskMeta}>Span {selectedTasks[displayedDigitsTask].span} · {describeDigitVariant(displayedDigitVariant)}</span>
                  </div>
                  <button className={styles.linkButton} disabled={!!session?.active || !listeningReady} onClick={() => start(digitsTask)} aria-label="Practice Digits">
                    Practice <span aria-hidden="true">→</span>
                  </button>
                </div>
                {session?.active && !saved.sessionCondition?.digitVariant && (
                  <p className={styles.privacy}>This saved session keeps its original settings. Choose new Digits settings after it ends.</p>
                )}
                <div className={styles.digitOptions}>
                  <div>
                    <label htmlFor="digits-recall-order">Recall order</label>
                    <select id="digits-recall-order" className={styles.select} value={saved.digitVariant.order} disabled={!!session?.active} onChange={(event) => changeDigitVariant({ order: event.target.value as DigitRecallOrder })}>
                      <option value="reverse">Reverse</option>
                      <option value="ascending">Small → large</option>
                      <option value="descending">Large → small</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="digits-answer-with">Answer with</label>
                    <select id="digits-answer-with" className={styles.select} value={saved.inputMode} disabled={!!session?.active} onChange={(event) => changeDigitVariant({ inputMode: event.target.value as InputMode })}>
                      <option value="keypad">Keypad</option>
                      <option value="spoken">Spoken</option>
                    </select>
                  </div>
                  {saved.inputMode === "keypad" && <div>
                    <label htmlFor="digits-keypad-visibility">Keypad while listening</label>
                    <select id="digits-keypad-visibility" className={styles.select} value={saved.digitVariant.keypad} disabled={!!session?.active} onChange={(event) => changeDigitVariant({ keypad: event.target.value as "visible" | "hidden" })}>
                      <option value="visible">Visible</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </div>}
                </div>
                <p className={styles.privacy}>{saved.inputMode === "spoken" ? "Speak your answer without a keypad." : "The keypad is available when you answer."} These settings apply to listening rounds.</p>
              {saved.inputMode === "spoken" && (
                <div className={styles.speechSetup}>
                  <p className={styles.privacy}>
                    Say the digits in English. Recognition runs on this device.
                    The {LOCAL_SPEECH_DOWNLOAD_MB} MB model is saved for reuse.
                    Microphone audio stays in this tab and is discarded after recognition.
                  </p>
                  {!speech.supported ? (
                    <p role="status">Local speech is unavailable in this browser. Choose Keypad to listen and answer.</p>
                  ) : speech.ready ? (
                    <p role="status">Speech model ready</p>
                  ) : (
                    <button
                      className={styles.secondaryButton}
                      disabled={speech.setup === "loading"}
                      onClick={() => void speech.prepare()}
                    >
                      {speech.setup === "loading" ? "Loading speech model…" : "Download speech model"}
                    </button>
                  )}
                  {speech.message && <p role="status">{speech.message}</p>}
                </div>
              )}
              </article>
              <div className={styles.taskGrid}>
                {visualTasks.map((item: MemoryTask) => (
                  <article className={styles.taskCard} key={item.id}>
                    <h3 className={styles.taskTitle}>{item.title}</h3>
                    <span className={styles.taskMeta}>
                      Span {selectedTasks[item.id as TaskId].span}
                    </span>
                    <button
                      className={styles.linkButton}
                      disabled={
                        !!session?.active ||
                        (AUDIO_TASK_IDS.includes(
                          item.id as (typeof AUDIO_TASK_IDS)[number],
                        ) &&
                          !listeningReady)
                      }
                      onClick={() => start(item.id as TaskId)}
                      aria-label={`Practice ${item.title}`}
                    >
                      Practice <span aria-hidden="true">→</span>
                    </button>
                  </article>
                ))}
              </div>
              {session?.active && (
                <p className={styles.privacy}>
                  Continue or end the saved session before starting another
                  exercise.
                </p>
              )}
            </section>
            <section className={styles.evidenceNote}>
              <details>
                <summary>About the practice &amp; research</summary>
                <p>{content.evidenceNote}</p>
                <p>
                  New sessions adapt the number of items remembered. Most start
                  at two items; Light Path and Pattern Hold start at three.
                  Hidden Homes shows two to six homes, matching its span.
                  Keypad, spoken answers, pace, and number order keep separate
                  difficulty records. Retries never change first-try results.
                </p>
                <p>
                  Published Cogmed methods describe adaptive span, with some
                  editions targeting about 60% correct per day. Our progression
                  rule, starting spans, and presentation times are design choices,
                  not the proprietary Cogmed algorithm or validated norms.
                  Previous saved sessions finish with their original settings.
                  Recall is untimed.
                </p>
                <p>
                  <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4110412/" target="_blank" rel="noreferrer">Published task descriptions</a>{" · "}
                  <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9007089/" target="_blank" rel="noreferrer">Training methods and adaptation</a>
                </p>
                <ul>
                  {content.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title} →
                      </a>{" "}
                      — {source.note}
                    </li>
                  ))}
                </ul>
                <p>
                  Content and saved progress are encrypted. The open-source
                  engine is public. A shared password permits offline guessing,
                  and unlocked content can be copied.
                </p>
              </details>
            </section>
            <button
              className={styles.quietButton}
              onClick={() => setResetConfirm(!resetConfirm)}
              aria-expanded={resetConfirm}
            >
              Reset device progress
            </button>
            {resetConfirm && (
              <div className={styles.notice}>
                <p>
                  This erases only this lab’s saved sessions and exercise spans
                  on this device.
                </p>
                <button
                  className={styles.secondaryButton}
                  onClick={() => {
                    const next = fresh();
                    savedRef.current = next;
                    setSaved(next);
                    setResetConfirm(false);
                    void clearMemoryProgress()
                      .then(() => {
                        if (mounted.current)
                          setNotice("Memory Lab progress reset.");
                      })
                      .catch(() => {
                        if (mounted.current)
                          setNotice(
                            "Device progress could not be erased. Please try again.",
                          );
                      });
                  }}
                >
                  Erase lab progress
                </button>{" "}
                <button
                  className={styles.quietButton}
                  onClick={() => setResetConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        ) : !round ? (
          <MemoryCelebration saved={saved} onHome={goHome} headingRef={headingRef} />
        ) : (
          <section className={styles.roundLayout} aria-labelledby="round-title">
            <div className={styles.roundHeader}>
              <button className={styles.quietButton} onClick={goHome}>
                ← Save &amp; exit
              </button>
              <span className={styles.roundMeta}>
                Round {session!.cursor + 1} / {session!.length} · Span{" "}
                {round.span}
              </span>
            </div>
            <progress
              className={styles.roundProgress}
              value={session!.cursor}
              max={session!.length}
              aria-label="Session progress"
            />
            <div className={styles.roundTitle} ref={roundTitleRef}>
              <h1 id="round-title">{currentDigitVariant ? "Digits" : task?.title}</h1>
              <p>{currentDigitVariant ? `Listen to the digits, then ${spoken ? "say" : "enter"} them in the order shown.` : task?.instruction}</p>
              {currentDigitVariant && <>
                <OrderCue mode={currentDigitVariant.order} />
                <p className={styles.inputNote}>{currentDigitVariant.inputMode === "spoken" ? "Spoken answer" : `Keypad ${currentDigitVariant.keypad} while listening`}</p>
              </>}
            </div>
            {lastResult && !review && phase !== "wrong" && (
              <p className={styles.lastResult} role="status">
                ✓ Round {lastResult.number} correct
                {lastResult.retried ? " after replay" : ""}
              </p>
            )}
            {review ? (
              <>
                {reviewSolved ? <Example round={review} /> : (
                  <p className={styles.notice}>Missed on the first attempt. Complete this round to review its solution.</p>
                )}
                <button
                  className={styles.button}
                  ref={actionRef}
                  onClick={() => {
                    restoreReviewFocus.current = true;
                    setReview(null);
                  }}
                >
                  Close review
                </button>
              </>
            ) : phase === "ready" ? (
              <>
                <h2 className={styles.sectionTitle}>Example</h2>
                <Example
                  round={generateRound(round.task, getTaskProfile(round.task, round.profile).initialSpan, "solved-example-v1", undefined, round.digitOrder, round.profile, round.digitVariant)}
                />
                {spoken && !speech.ready && (
                  <div className={styles.speechSetup}>
                    <p>Set up spoken answers before listening to this round.</p>
                    {speech.supported ? (
                      <button className={styles.secondaryButton} ref={actionRef} disabled={speech.setup === "loading"} onClick={() => void speech.prepare()}>
                        {speech.setup === "loading" ? "Loading speech model…" : "Download speech model"}
                      </button>
                    ) : <p>Local speech is unavailable in this browser. Save &amp; exit to end this session and choose Keypad.</p>}
                    {speech.message && <p role="status">{speech.message}</p>}
                  </div>
                )}
                <div className={styles.roundActions}>
                  <button
                    className={styles.button}
                    ref={spoken && !speech.ready ? undefined : actionRef}
                    disabled={
                      round.answerKind === "ordered-digits" && (!audioReady || (spoken && !speech.ready))
                    }
                    onClick={() => {
                      enableListening(round);
                      void present(round);
                    }}
                  >
                    {round.answerKind === "ordered-digits"
                      ? !audioReady
                        ? "Loading audio…"
                        : !sound
                          ? "Turn sound on & listen →"
                          : "Listen to the sequence →"
                      : "Watch the sequence →"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.roundStage}>
                  <div
                    className={styles.phaseLabel}
                    role="status"
                    aria-live="polite"
                  >
                    {phase === "cue"
                      ? "Get ready"
                      : phase === "watch"
                        ? round.answerKind === "ordered-digits"
                          ? "Listen"
                          : "Watch"
                        : phase === "hold"
                          ? round.task === "rotation"
                            ? `Quarter turn ${round.rotation === "clockwise" ? "↻" : "↺"}`
                            : round.task === "tracking"
                              ? "Follow the circles"
                              : "Hold it in mind"
                          : phase === "recall"
                            ? round.task === "backward"
                              ? "Your turn · reverse the order"
                              : round.task === "pattern"
                                ? "Your turn · select the pattern"
                                : "Your turn"
                            : phase === "paused"
                              ? "Paused"
                              : phase === "correct"
                                ? "✓ Correct"
                              : spoken ? "× Answer did not match" : "× Try again"}
                  </div>
                  {round.task === "locations" &&
                    phase === "recall" &&
                    response.length < round.span && (
                      <div className={styles.recallCue}>
                        <span>Find this shape’s home</span>
                        <Shape id={round.cues![response.length]} />
                      </div>
                    )}
                  {phase === "paused" ? (
                    <div className={styles.pauseOverlay}>
                      <h2>Paused</h2>
                      <p>
                        {spoken && pausedFrom === "recall"
                          ? "Continue to record your answer again."
                          : pausedFrom === "recall"
                          ? "Continue with the choices you already made."
                          : "We’ll show the sequence again from the beginning."}
                      </p>
                      <button
                        ref={actionRef}
                        className={styles.button}
                        onClick={() => {
                          if (phaseRef.current !== "paused") return;
                          primeAudio();
                          if (pausedFrom === "recall") {
                            changePhase("recall");
                            if (spoken && !document.hidden) beginSpoken();
                          }
                          else {
                            enableListening(round);
                            void present(round);
                          }
                        }}
                      >
                        {round.answerKind === "ordered-digits" &&
                        !sound && pausedFrom !== "recall"
                          ? "Turn sound on & listen →"
                          : "Continue →"}
                      </button>
                    </div>
                  ) : spoken ? (
                    phase === "recall" ? (
                      <div className={styles.spokenRecall} role="group" aria-label="Spoken answer controls">
                        {!speech.ready && speech.supported && (
                          <button className={styles.secondaryButton} disabled={speech.setup === "loading"} onClick={() => void speech.prepare()}>
                            {speech.setup === "loading" ? "Loading speech model…" : "Download speech model"}
                          </button>
                        )}
                        {!speech.ready && speech.message && speech.message !== speech.failure?.message && (
                          <p className={styles.exampleText} role="status">{speech.message}</p>
                        )}
                        {speech.failure ? (
                          <div className={styles.inputFailure} role="alert">
                            <h2>{speech.failure.kind === "uncertain" || speech.failure.kind === "no-speech" ? "Input not recognized" : "Speech input unavailable"}</h2>
                            <p>{speech.failure.message}</p>
                            <p>No attempt was scored.</p>
                            <button className={styles.button} ref={actionRef} disabled={!speech.ready} onClick={retrySpoken}>Retry</button>
                          </div>
                        ) : (
                          <p className={styles.exampleText} role="status" tabIndex={-1} ref={spokenStatus}>
                            {speech.state === "recording" ? "Listening… Say your answer, then pause." : speech.state === "recognizing" || speech.state === "complete" ? "Checking your answer…" : speech.state === "starting" ? "Opening microphone…" : "Getting ready…"}
                          </p>
                        )}
                      </div>
                    ) : null
                  ) : (
                    <MemoryBoard
                      key={round.id}
                      target={round}
                      phase={phase}
                      flash={flash}
                      positions={positions}
                      rotated={rotated}
                      motionEnabled={motionEnabled}
                      response={response}
                      firstCell={firstCell}
                      answer={answer}
                    />
                  )}
                  {!spoken && <div
                    className={styles.responseSlots}
                    aria-label={`${response.length} of ${round.span} places entered`}
                  >
                    {Array.from({ length: round.span }, (_, i) => (
                      <span
                        className={`${styles.responseSlot} ${i < response.length ? styles.filledSlot : ""}`}
                        key={i}
                      >
                        {i < response.length && round.task === "symbols" ? (
                          <Shape id={response[i]} />
                        ) : i < response.length ? (
                          round.answerKind === "ordered-digits" ? (
                            response[i]
                          ) : (
                            "●"
                          )
                        ) : (
                          i + 1
                        )}
                      </span>
                    ))}
                  </div>}
                  {phase === "recall" && !spoken && (
                    <div className={styles.roundActions}>
                      <button
                        className={styles.secondaryButton}
                        disabled={!response.length}
                        onClick={undo}
                        aria-keyshortcuts="Backspace"
                      >
                        Undo
                      </button>
                      <button
                        className={styles.button}
                        disabled={response.length !== round.span}
                        onClick={() => submit()}
                      >
                        Check sequence
                      </button>
                    </div>
                  )}
                  {isLive && (
                    <button
                      className={styles.quietButton}
                      onClick={pause}
                      aria-keyshortcuts="Escape"
                    >
                      Pause
                    </button>
                  )}
                </div>
                {(phase === "correct" || phase === "wrong") && (
                  <div
                    className={`${styles.feedback} ${phase === "correct" ? styles.feedbackCorrect : styles.feedbackWrong}`}
                    role="status"
                  >
                    <h2>{phase === "correct" ? "Correct" : spoken ? "Answer did not match" : "Try again"}</h2>
                    <p>
                      {phase === "correct"
                        ? session!.history.at(-1)?.correct
                          ? "Correct on the first attempt."
                          : "Correct after replay. The first attempt remains recorded as missed."
                        : spoken ? "The recognized answer did not match."
                        : `The ${round.answerKind === "unordered-cells" ? "selected places" : "sequence"} did not match.`}
                    </p>
                    {phase === "wrong" && spoken && spokenDebug?.roundId === round.id && (
                      <div className={styles.feedbackDetail} role="group" aria-label="Recognized answer">
                        <span>Recognized answer</span>
                        <div className={styles.responseSlots} role="list" aria-label="Spoken digits">
                          {spokenDebug.digits.map((digit, index) => (
                            <span className={`${styles.responseSlot} ${styles.filledSlot}`} role="listitem" aria-label={`Digit ${digit}`} key={index}>{digit}</span>
                          ))}
                        </div>
                        <p>This is what speech recognition heard.</p>
                      </div>
                    )}
                    {phase === "correct" ? (
                      <button
                        className={styles.button}
                        ref={actionRef}
                        onClick={() =>
                          advanceAndPresent(savedRef.current.session!)
                        }
                      >
                        Continue
                      </button>
                    ) : (
                      <button
                        className={styles.button}
                        ref={actionRef}
                        onClick={() => {
                          enableListening(round);
                          void present(round);
                        }}
                      >
                        {round.answerKind === "ordered-digits" && !sound
                          ? "Turn sound on & replay"
                          : "Replay sequence"}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {!review && phase !== "ready" && phase !== "wrong" && (
              <details
                className={styles.exampleDisclosure}
                open={exampleOpen}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setExampleOpen(open);
                  if (open) pause();
                }}
              >
                <summary>Example</summary>
                <Example
                  round={generateRound(round.task, getTaskProfile(round.task, round.profile).initialSpan, "solved-example-v1", undefined, round.digitOrder, round.profile, round.digitVariant)}
                />
              </details>
            )}
            {session!.history.length > 0 && (
              <div
                className={styles.progressDots}
                aria-label="First-try round history"
              >
                {session!.history.map((result, i) => (
                  <button
                    className={`${styles.progressDot} ${styles.reviewMark}`}
                    key={result.round.id}
                    aria-label={`Review round ${i + 1}: ${result.correct ? "correct" : "missed"} on first try`}
                    disabled={isLive}
                    onClick={(event) => {
                      reviewTrigger.current = event.currentTarget;
                      cancelPlayback();
                      setReview(result.round);
                    }}
                  >
                    {result.correct ? "✓" : "×"}
                    <span className={styles.screenReader}>Round {i + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
      <footer className={styles.footer}>
        <Link href="/" prefetch={false}>
          ← All games
        </Link>
      </footer>
    </div>
  );
}
