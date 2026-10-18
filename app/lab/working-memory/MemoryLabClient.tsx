"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  TASK_IDS,
  AUDIO_TASK_IDS,
  advanceRound,
  createProgress,
  createTaskStates,
  finalTrackingPositions,
  generateRound,
  isCorrectResponse,
  recordFirstAttempt,
  rotateCell,
  validateProgress,
  type MemoryProgress,
  type MemoryRound,
  type TaskId,
  type TaskStates,
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
import styles from "./memory.module.css";

type Phase =
  | "ready"
  | "cue"
  | "watch"
  | "hold"
  | "recall"
  | "correct"
  | "wrong"
  | "paused";
type Log = {
  id: string;
  date: string;
  rounds: number;
  correct: number;
  maxSpan: number;
  slow: boolean;
  modality: string;
};
type Saved = {
  version: 1;
  session: MemoryProgress | null;
  tasks: TaskStates;
  logs: Log[];
  redeemed: string[];
  slow: boolean;
};
const fresh = (): Saved => ({
  version: 1,
  session: null,
  tasks: createTaskStates(),
  logs: [],
  redeemed: [],
  slow: false,
});

function restore(value: unknown): Saved | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Saved;
  try {
    if (
      data.version !== 1 ||
      typeof data.slow !== "boolean" ||
      !Array.isArray(data.logs) ||
      data.logs.length > 500 ||
      !Array.isArray(data.redeemed)
    )
      return null;
    // Reuse the engine's strict adaptive-state validator, including count bounds.
    createProgress("validate-state", 24, { tasks: data.tasks });
    const session =
      data.session === null ? null : validateProgress(data.session);
    if (data.session !== null && !session) return null;
    if (session && JSON.stringify(session.tasks) !== JSON.stringify(data.tasks))
      return null;
    if (
      !data.redeemed.every(
        (id) =>
          typeof id === "string" &&
          session?.history.some(
            (result) => result.round.id === id && !result.correct,
          ),
      )
    )
      return null;
    if (
      !data.logs.every(
        (log) =>
          log &&
          typeof log.id === "string" &&
          log.id.length <= 256 &&
          typeof log.date === "string" &&
          Number.isFinite(Date.parse(log.date)) &&
          [8, 24, 48].includes(log.rounds) &&
          Number.isInteger(log.correct) &&
          log.correct >= 0 &&
          log.correct <= log.rounds &&
          Number.isInteger(log.maxSpan) &&
          log.maxSpan >= 0 &&
          log.maxSpan <= 9 &&
          typeof log.slow === "boolean" &&
          typeof log.modality === "string",
      )
    )
      return null;
    return {
      version: 1,
      session,
      tasks: data.tasks,
      logs: data.logs,
      redeemed: data.redeemed,
      slow: data.slow,
    };
  } catch {
    return null;
  }
}

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

function TaskIcon({ task }: { task: TaskId }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      {AUDIO_TASK_IDS.includes(task as (typeof AUDIO_TASK_IDS)[number]) ? (
        <>
          <path
            d="M12 34V25a20 20 0 0 1 40 0v9"
            stroke="currentColor"
            strokeWidth="5"
          />
          <rect
            x="8"
            y="30"
            width="10"
            height="21"
            rx="5"
            fill="currentColor"
          />
          <rect
            x="46"
            y="30"
            width="10"
            height="21"
            rx="5"
            fill="currentColor"
          />
          <path
            d="M26 28v18m7-25v30m7-23v18"
            stroke="currentColor"
            strokeWidth="3"
          />
        </>
      ) : task === "symbols" || task === "locations" ? (
        <>
          <circle cx="18" cy="21" r="9" fill="currentColor" />
          <path d="m43 9 13 23H30Z" fill="currentColor" />
          <rect
            x="26"
            y="39"
            width="17"
            height="17"
            rx="2"
            fill="currentColor"
          />
        </>
      ) : (
        <>
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={i}
              x={8 + (i % 3) * 18}
              y={8 + Math.floor(i / 3) * 18}
              width="12"
              height="12"
              rx={task === "tracking" ? 6 : 3}
              fill="currentColor"
              opacity={[0, 4, 8].includes(i) ? 1 : 0.2}
            />
          ))}
          {task === "rotation" && (
            <path
              d="M56 19V5H42M56 5 42 19"
              stroke="currentColor"
              strokeWidth="3"
            />
          )}
          {task === "backward" && (
            <path
              d="M48 32H15m0 0 8-8m-8 8 8 8"
              stroke="currentColor"
              strokeWidth="3"
            />
          )}
          {task === "split" && (
            <path
              d="M32 4v56"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="3 4"
            />
          )}
        </>
      )}
    </svg>
  );
}

function HeroArt() {
  return (
    <div className={styles.heroArt} aria-hidden="true">
      <div className={styles.artTag}>Watch. Remember. Rebuild.</div>
      <div className={styles.artGrid}>
        {Array.from({ length: 16 }, (_, i) => (
          <span
            key={i}
            className={`${styles.artCell} ${[1, 6, 8].includes(i) ? styles.artLit : i === 11 ? styles.artCoral : i === 13 ? styles.artTeal : ""}`}
          >
            {[1, 6, 8, 11, 13].includes(i) ? (
              <span>{[1, 6, 8, 11, 13].indexOf(i) + 1}</span>
            ) : null}
          </span>
        ))}
      </div>
      <span className={styles.artTag}>A little stretch for your mind →</span>
    </div>
  );
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
        <span className={styles.tag}>◈ Encrypted content</span>
      </Header>
      <main className={styles.main}>
        <div className={styles.lockLayout}>
          <section className={styles.lockCopy} aria-labelledby="lock-title">
            <p className={styles.kicker}>The working-memory lab</p>
            <h1 id="lock-title" className={styles.displayTitle}>
              Make room for
              <br />
              <em>a little more.</em>
            </h1>
            <p className={styles.lede}>
              A quiet space to practice holding things in mind. Unlock the lab
              to begin.
            </p>
            <form className={styles.lockForm} onSubmit={unlock}>
              <label className={styles.passwordLabel} htmlFor="memory-password">
                Your access password
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
                  {busy ? "Unlocking…" : "Unlock lab →"}
                </button>
              </div>
              {error && (
                <p id="unlock-error" role="alert" className={styles.error}>
                  {error}
                </p>
              )}
            </form>
            <p className={styles.privacy}>
              Content is decrypted in your browser. Locking or refreshing closes
              access. No account. No tracking.
            </p>
          </section>
          <HeroArt />
        </div>
      </main>
      <footer className={styles.footer}>
        <span>Small exercises. Room to grow.</span>
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
      <p className={styles.kicker}>Example · already solved</p>
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
                  : "Watch 1 → 2 → 3"}
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
              ? "Tap 3 → 2 → 1"
              : round.task === "pattern"
                ? "Select all lit places"
                : digit
                  ? round.task === "sort-digits"
                    ? "Smallest → largest"
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
  response,
  firstCell,
  answer,
}: {
  target: MemoryRound;
  phase: Phase;
  flash: number;
  positions: number[];
  rotated: boolean;
  response: number[];
  firstCell: RefObject<HTMLButtonElement | null>;
  answer: (value: number) => void;
}) {
  const turn = target.rotation === "clockwise" ? 90 : -90;
  const physical = (cell: number) =>
    target.task === "rotation" && rotated
      ? rotateCell(cell, target.rotation!)
      : cell;
  if (target.answerKind === "ordered-digits") {
    const hide =
      target.task === "hidden-digits" &&
      ["cue", "watch", "hold"].includes(phase);
    return (
      <>
        <div
          className={styles.listeningStimulus}
          aria-label="Spoken digit presentation"
        >
          <span aria-hidden="true">◉</span>
          <p>
            {phase === "watch"
              ? "Listen carefully"
              : phase === "recall"
                ? target.task === "sort-digits"
                  ? "Smallest to largest"
                  : "Last digit first"
                : "Hold the digits in mind"}
          </p>
        </div>
        <div className={styles.digitKeypad}>
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
          className={styles.board}
          aria-label="Moving targets on a four by four board"
        >
          {Array.from({ length: 16 }, (_, cell) => (
            <span key={cell} className={styles.cell} aria-hidden="true" />
          ))}
          {(positions.length ? positions : target.positions!).map(
            (cell, id) => (
              <button
                ref={id === 0 ? firstCell : undefined}
                className={`${styles.marker} ${phase === "watch" && target.sequence[flash] === id ? styles.markerActive : ""} ${response.includes(cell) ? styles.selected : ""}`}
                style={{
                  left: `${(cell % 4) * 25 + 2.5}%`,
                  top: `${Math.floor(cell / 4) * 25 + 2.5}%`,
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
    <div className={styles.boardWrap}>
      <div
        className={`${styles.board} ${target.task === "split" ? styles.splitBoard : ""}`}
        style={{
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
  const [response, setResponse] = useState<number[]>([]);
  const responseRef = useRef<number[]>([]);
  const phaseRef = useRef<Phase>(phase);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [review, setReview] = useState<MemoryRound | null>(null);
  const playback = useRef(0);
  const mounted = useRef(true);
  const [pausedFrom, setPausedFrom] = useState<Phase>("watch");
  const audio = useRef<AudioContext | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const firstCell = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const session = saved.session;
  const round = session?.active ?? null;
  const current = review ?? round;
  const task = content.tasks.find((item) => item.id === current?.task);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const persist = useCallback(
    (next: Saved) => {
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
            "Neural audio could not load. Visual practice is available; retry loading the audio below.",
          );
      });
    return () => {
      controller.abort();
      narration.current?.dispose();
      narration.current = null;
      disposeAssets?.();
    };
  }, [cryptoKey, audioLoadAttempt, changePhase]);

  function cancelPlayback() {
    playback.current += 1;
    narration.current?.cancel();
    setFlash(-1);
  }
  const pause = useCallback(() => {
    if (["cue", "watch", "hold", "recall"].includes(phaseRef.current)) {
      setPausedFrom(phaseRef.current);
      playback.current += 1;
      narration.current?.cancel();
      setFlash(-1);
      changePhase("paused");
    }
  }, [changePhase]);
  useEffect(() => {
    function hidden() {
      if (document.hidden) pause();
    }
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [pause]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (phase === "recall") firstCell.current?.focus();
      else if (["ready", "correct", "wrong", "paused"].includes(phase))
        actionRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, current?.id, playing]);

  function primeAudio() {
    narration.current?.prime();
    if (!audio.current) audio.current = createGameAudioContext();
    if (audio.current?.state === "suspended")
      void audio.current.resume().catch(() => undefined);
  }
  function feedbackAudio(correct: boolean) {
    if (sound && audio.current) playFeedbackEarcon(audio.current, correct);
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
    if (
      target.answerKind === "ordered-digits" &&
      (!soundRef.current || !narration.current)
    ) {
      setNotice(
        "Turn sound on and wait for neural audio before beginning a listening round.",
      );
      return;
    }
    primeAudio();
    const token = ++playback.current;
    const slow = savedRef.current.slow;
    const on = slow ? 1200 : 800;
    const gap = slow ? 300 : 200;
    setResponse([]);
    responseRef.current = [];
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
        await wait(
          on * Math.max(2, target.task === "locations" ? 4 : target.span * 0.6),
          token,
        );
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
        setRotated(true);
        await wait(1000, token);
      } else if (target.task === "tracking") {
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
          await wait(500, token);
          moving[b] = old;
          setPositions([...moving]);
          await wait(500, token);
          moving[a] = destination;
          setPositions([...moving]);
          await wait(500, token);
        }
      } else await wait(800, token);
      changePhase("recall");
    } catch {
      /* Pausing, locking, and navigation cancel the presentation. */
    }
  }

  function start(focusedTask?: TaskId) {
    cancelPlayback();
    setReview(null);
    try {
      const next = createProgress(
        crypto.randomUUID(),
        focusedTask ? 8 : length,
        { focusedTask, tasks: savedRef.current.tasks, modality },
      );
      persist({ ...savedRef.current, session: next, redeemed: [] });
      setPlaying(true);
      setResponse([]);
      responseRef.current = [];
      changePhase("ready");
    } catch {
      setNotice("A new session could not be prepared. Please try again.");
    }
  }
  function resume() {
    cancelPlayback();
    setReview(null);
    setPlaying(true);
    setResponse([]);
    responseRef.current = [];
    const s = savedRef.current.session;
    setRotated(s?.active?.task === "rotation" && s.answered);
    setPositions(
      s?.active?.task === "tracking" && s.answered
        ? finalTrackingPositions(s.active)
        : (s?.active?.positions ?? []),
    );
    if (
      s?.answered &&
      (s.history.at(-1)?.correct ||
        savedRef.current.redeemed.includes(s.active?.id ?? ""))
    )
      changePhase("correct");
    else if (s?.answered) changePhase("wrong");
    else changePhase("ready");
    if (!s?.active) requestAnimationFrame(() => headingRef.current?.focus());
  }
  function goHome() {
    cancelPlayback();
    setPlaying(false);
    setReview(null);
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
  function submit() {
    const s = savedRef.current.session;
    if (
      phaseRef.current !== "recall" ||
      !s?.active ||
      responseRef.current.length !== s.active.span ||
      review
    )
      return;
    const correct = isCorrectResponse(s.active, responseRef.current);
    changePhase(correct ? "correct" : "wrong");
    feedbackAudio(correct);
    let next = s;
    if (!s.answered) next = recordFirstAttempt(s, s.active, correct);
    const redeemed =
      correct && !next.history.at(-1)?.correct
        ? [...new Set([...savedRef.current.redeemed, s.active.id])]
        : savedRef.current.redeemed;
    persist({
      ...savedRef.current,
      session: next,
      tasks: next.tasks,
      redeemed,
    });
  }
  function nextRound() {
    const s = savedRef.current.session;
    if (!s?.active || phaseRef.current !== "correct") return;
    try {
      const next = advanceRound(s);
      let logs = savedRef.current.logs;
      if (!next.active && !logs.some((log) => log.id === next.seed))
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
            slow: savedRef.current.slow,
            modality: next.focusedTask
              ? AUDIO_TASK_IDS.includes(
                  next.focusedTask as (typeof AUDIO_TASK_IDS)[number],
                )
                ? "audio"
                : "visual"
              : next.modality,
          },
        ].slice(-500);
      persist({ ...savedRef.current, session: next, tasks: next.tasks, logs });
      setResponse([]);
      responseRef.current = [];
      setRotated(false);
      setFlash(-1);
      changePhase("ready");
      if (!next.active)
        requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setNotice(
        "The next round could not be prepared. Your progress is saved; return to the lab and try again.",
      );
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
        savedRef.current.session?.active?.answerKind === "ordered-digits"
      ) {
        event.preventDefault();
        const active = savedRef.current.session.active;
        if (responseRef.current.length < active.span) {
          const next = [...responseRef.current, Number(event.key)];
          responseRef.current = next;
          setResponse(next);
        }
      }
      if (event.key === "Backspace" && phaseRef.current === "recall") {
        event.preventDefault();
        const next = responseRef.current.slice(0, -1);
        responseRef.current = next;
        setResponse(next);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [pause]);

  const correctCount =
    session?.history.filter((item) => item.correct).length ?? 0;
  const attempts = TASK_IDS.reduce(
    (sum, id) => sum + saved.tasks[id].attempts,
    0,
  );
  const totalCorrect = TASK_IDS.reduce(
    (sum, id) => sum + saved.tasks[id].correct,
    0,
  );
  const isLive = ["cue", "watch", "hold", "recall"].includes(phase);
  const displayTask = (id: TaskId) =>
    content.tasks.find((item) => item.id === id)!;

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
          <p role="status">Opening your practice space…</p>
        ) : !playing ? (
          <>
            <section className={styles.hero}>
              <div className={styles.heroCopy}>
                <p className={styles.kicker}>Your space to stretch</p>
                <h1 className={styles.displayTitle}>{content.title}</h1>
                <p className={styles.lede}>{content.intro}</p>
                <div className={styles.heroMeta}>
                  <span className={styles.tag}>
                    8 visual + 3 listening exercises
                  </span>
                  <span className={styles.tag}>At your own pace</span>
                  <span className={styles.tag}>Saved on this device</span>
                </div>
              </div>
              <HeroArt />
            </section>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statValue}>
                  {saved.logs.length.toString().padStart(2, "0")}
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
              <button
                className={styles.linkButton}
                onClick={() => setCoach(!coach)}
                aria-expanded={coach}
              >
                {coach ? "Close progress ↑" : "View progress →"}
              </button>
            </div>
            {coach && (
              <section className={styles.coach} aria-label="Practice progress">
                <h2 className={styles.sectionTitle}>
                  Your practice, over time.
                </h2>
                <p>
                  Span is the number of items in a round. These are practice
                  records, not cognitive test scores.
                </p>
                <div
                  className={styles.progressDots}
                  aria-label={`${Math.min(25, saved.logs.length)} of 25 optional sessions completed`}
                >
                  {Array.from({ length: 25 }, (_, i) => (
                    <span
                      className={`${styles.progressDot} ${i < saved.logs.length ? styles.progressDone : ""}`}
                      key={i}
                    >
                      {i < saved.logs.length ? "✓" : i + 1}
                    </span>
                  ))}
                </div>
                <p className={styles.privacy}>
                  An optional 25-session path. Take breaks whenever you need
                  them.
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
                      {TASK_IDS.map((id) => (
                        <tr key={id}>
                          <th scope="row">{displayTask(id).title}</th>
                          <td>{saved.tasks[id].span}</td>
                          <td>{saved.tasks[id].attempts}</td>
                          <td>
                            {saved.tasks[id].attempts
                              ? `${Math.round((saved.tasks[id].correct / saved.tasks[id].attempts) * 100)}%`
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
                <p className={styles.kicker}>A balanced session</p>
                <h2 className={styles.sectionTitle}>
                  {session?.active
                    ? "Pick up where you left off."
                    : "A fresh mix for your mind."}
                </h2>
                <p>
                  {session?.active
                    ? `Round ${session.cursor + 1} of ${session.length}. Your first-try record is saved.`
                    : modality === "mixed"
                      ? "Three visual and three listening exercises, balanced across your session."
                      : modality === "visual"
                        ? "Eight visual exercises, balanced across your session."
                        : "Three listening exercises, balanced across your session."}
                </p>
              </div>
              <div className={styles.sessionOptions}>
                {session?.active ? (
                  <>
                    <button className={styles.button} onClick={resume}>
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
                      disabled={modality !== "visual" && !audioReady}
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
                  Retry loading neural audio
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
                Slower presentation <span>More time to see each item</span>
              </label>
            </div>
            <section aria-labelledby="exercise-title">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>One skill at a time</p>
                  <h2 id="exercise-title" className={styles.sectionTitle}>
                    Find your focus.
                  </h2>
                </div>
                <p>Eight rounds of one exercise.</p>
              </div>
              <div className={styles.taskGrid}>
                {content.tasks.map((item: MemoryTask) => (
                  <article
                    className={`${styles.taskCard} ${styles[`accent${item.accent.charAt(0).toUpperCase() + item.accent.slice(1)}`] ?? ""}`}
                    key={item.id}
                  >
                    <div className={styles.taskTop}>
                      <span className={styles.taskIcon}>
                        <TaskIcon task={item.id as TaskId} />
                      </span>
                      <span className={styles.taskMeta}>
                        Span {saved.tasks[item.id as TaskId].span}
                      </span>
                    </div>
                    <h3 className={styles.taskTitle}>{item.title}</h3>
                    <p className={styles.taskDescription}>{item.description}</p>
                    <button
                      className={styles.linkButton}
                      disabled={
                        !!session?.active ||
                        (AUDIO_TASK_IDS.includes(
                          item.id as (typeof AUDIO_TASK_IDS)[number],
                        ) &&
                          !audioReady)
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
                  Finish your saved session to start another exercise.
                </p>
              )}
            </section>
            <section className={styles.evidenceNote}>
              <details>
                <summary>About the practice &amp; research</summary>
                <p>{content.evidenceNote}</p>
                <p>
                  Each exercise starts at span 3. Two consecutive first-try
                  correct rounds increase its span by one; one miss decreases it
                  by one, within spans 2–9. Retrying does not change the
                  recorded result.
                </p>
                <p>
                  Standard presentation uses 800 ms per item and a 200 ms gap.
                  Recall is untimed. Slower-presentation sessions are labeled
                  separately in the history.
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
          <section className={styles.summary}>
            <p className={styles.kicker}>A little practice, well spent</p>
            <h1 className={styles.summaryTitle} ref={headingRef} tabIndex={-1}>
              Session complete.
            </h1>
            <div className={styles.summaryStats}>
              <strong>
                {correctCount}/{session?.length}
              </strong>
              <span>correct on the first try</span>
            </div>
            <p>
              Your exercise spans and session history are saved on this device.
            </p>
            <button className={styles.button} onClick={goHome}>
              Back to the lab →
            </button>
          </section>
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
            <div className={styles.roundTitle}>
              <p className={styles.kicker}>
                {review
                  ? "First-try history · read only"
                  : "Watch. Hold. Recall."}
              </p>
              <h1 id="round-title">{task?.title}</h1>
              <p>{task?.instruction}</p>
            </div>
            {review ? (
              <>
                <Example round={review} />
                <button
                  className={styles.button}
                  ref={actionRef}
                  onClick={() => {
                    setReview(null);
                    requestAnimationFrame(() => reviewTrigger.current?.focus());
                  }}
                >
                  Close review
                </button>
              </>
            ) : phase === "ready" ? (
              <>
                <Example
                  round={generateRound(round.task, 3, "solved-example-v1")}
                />
                <div className={styles.roundActions}>
                  <button
                    className={styles.button}
                    ref={actionRef}
                    disabled={
                      round.answerKind === "ordered-digits" && !audioReady
                    }
                    onClick={() => {
                      if (
                        round.answerKind === "ordered-digits" &&
                        !soundRef.current
                      ) {
                        soundRef.current = true;
                        setSound(true);
                        writeSoundPreference(true);
                        narration.current?.setEnabled(true);
                      }
                      void present(round);
                    }}
                  >
                    {round.answerKind === "ordered-digits"
                      ? !audioReady
                        ? "Preparing neural audio…"
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
                      ? "Get ready +"
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
                                : "Your turn · take your time"
                            : phase === "paused"
                              ? "Paused"
                              : phase === "correct"
                                ? "✓ Correct"
                                : "× Try again"}
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
                      <h2>Take a breath.</h2>
                      <p>
                        {pausedFrom === "recall"
                          ? "Continue with the choices you already made."
                          : "We’ll show the sequence again from the beginning."}
                      </p>
                      <button
                        ref={actionRef}
                        className={styles.button}
                        onClick={() =>
                          pausedFrom === "recall"
                            ? changePhase("recall")
                            : void present(round)
                        }
                      >
                        Continue →
                      </button>
                    </div>
                  ) : (
                    <MemoryBoard
                      target={round}
                      phase={phase}
                      flash={flash}
                      positions={positions}
                      rotated={rotated}
                      response={response}
                      firstCell={firstCell}
                      answer={answer}
                    />
                  )}
                  <div
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
                  </div>
                  {phase === "recall" && (
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
                        onClick={submit}
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
                    <h2>
                      {phase === "correct"
                        ? "✓ You’ve got it."
                        : "× Let’s look at that again."}
                    </h2>
                    <p>
                      {phase === "correct"
                        ? session!.history.at(-1)?.correct
                          ? "Saved as correct on your first try."
                          : "Practice complete. Your original first-try result is kept."
                        : `The ${round.answerKind === "unordered-cells" ? "selected places" : "sequence"} did not match. Replay and try again; your first-try result is already saved.`}
                    </p>
                    {phase === "wrong" && (
                      <div className={styles.feedbackDetail}>
                        <span>The expected response</span>
                        <div className={styles.miniSequence}>
                          {round.expected.map((cell, i) => (
                            <span key={i} className={styles.miniCell}>
                              {round.task === "symbols" ? (
                                <Shape id={cell} />
                              ) : round.answerKind === "ordered-digits" ? (
                                cell
                              ) : (
                                <svg
                                  viewBox="0 0 40 40"
                                  aria-label={`Row ${Math.floor(cell / 4) + 1}, column ${(cell % 4) + 1}`}
                                >
                                  {Array.from({ length: 16 }, (_, j) => (
                                    <rect
                                      key={j}
                                      x={(j % 4) * 10 + 1}
                                      y={Math.floor(j / 4) * 10 + 1}
                                      width="8"
                                      height="8"
                                      rx="1"
                                      fill={j === cell ? "#17213d" : "#d8d2c5"}
                                    />
                                  ))}
                                </svg>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {phase === "correct" ? (
                      <button
                        className={styles.button}
                        ref={actionRef}
                        onClick={nextRound}
                      >
                        {session!.cursor === session!.length - 1
                          ? "Finish session →"
                          : "Next round →"}
                      </button>
                    ) : (
                      <button
                        className={styles.button}
                        ref={actionRef}
                        onClick={() => void present(round)}
                      >
                        Replay &amp; try again →
                      </button>
                    )}
                  </div>
                )}
              </>
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
                    disabled={isLive || phase === "paused"}
                    onClick={(event) => {
                      reviewTrigger.current = event.currentTarget;
                      cancelPlayback();
                      setReview(result.round);
                      requestAnimationFrame(() => actionRef.current?.focus());
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
        <span>Private practice. Progress at your pace.</span>
        <Link href="/" prefetch={false}>
          ← All games
        </Link>
      </footer>
    </div>
  );
}
