"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { rotationMatchGame } from "./game-info";
import {
  ROUNDS,
  TUTORIAL,
  describePattern,
  patternKey,
  type MirrorAxis,
  type Pattern,
  type PuzzleTransform,
  type RotationTransform,
} from "./game-engine";
import styles from "./rotation-match.module.css";

type PatternSize = "tutorialPattern" | "clue" | "option" | "ghost";
type GamePhase = "idle" | "animating" | "answered";

type GhostState = {
  pattern: Pattern;
  left: number;
  top: number;
  width: number;
  height: number;
  deltaX: number;
  deltaY: number;
  scale: number;
  transformCss: string;
  reducedMotion: boolean;
};

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

function PatternGrid({
  pattern,
  size,
  label,
  hidden = false,
  gridRef,
}: {
  pattern: Pattern;
  size: PatternSize;
  label?: string;
  hidden?: boolean;
  gridRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={`${styles.pattern} ${styles[size]}`}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
      ref={gridRef}
    >
      {pattern.map((tile, index) => {
        const motifStyle = {
          "--motif-turn": `${tile.orientation * 90}deg`,
        } as CustomProperties;

        return (
          <span
            className={`${styles.tile} ${styles[tile.color]}`}
            aria-hidden="true"
            key={`${index}-${tile.color}-${tile.motif}-${tile.orientation}`}
          >
            {tile.motif === "cap" ? (
              <span className={styles.capMark} style={motifStyle} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function TurnArrow({ transform }: { transform: RotationTransform }) {
  const shortDirection = transform.direction === "clockwise" ? "CW" : "CCW";
  const label = `Rotate ${transform.degrees} degrees ${transform.direction}`;
  const cueStyle = {
    "--arc": `${transform.degrees}deg`,
    "--arc-start":
      transform.direction === "clockwise"
        ? "0deg"
        : `-${transform.degrees}deg`,
    "--end-turn": `${transform.angleDegrees}deg`,
  } as CustomProperties;

  return (
    <div className={styles.turnCue} role="img" aria-label={label}>
      <div
        className={`${styles.turnGraphic} ${
          transform.direction === "clockwise"
            ? styles.clockwise
            : styles.counterclockwise
        }`}
        style={cueStyle}
        aria-hidden="true"
      >
        <span className={styles.turnArc} />
        <span className={styles.turnEnd}>
          <span className={styles.turnArrowHead}>
            {transform.direction === "clockwise" ? "›" : "‹"}
          </span>
        </span>
        <span className={styles.turnCenter} />
      </div>
      <span className={styles.turnLabel} aria-hidden="true">
        {transform.degrees}° {shortDirection}
      </span>
    </div>
  );
}

function MirrorCue({ axis }: { axis: MirrorAxis }) {
  const config: Record<
    MirrorAxis,
    { label: string; shortLabel: string; className: string }
  > = {
    vertical: {
      label: "Flip across the vertical axis",
      shortLabel: "V FLIP",
      className: styles.mirrorVertical,
    },
    horizontal: {
      label: "Flip across the horizontal axis",
      shortLabel: "H FLIP",
      className: styles.mirrorHorizontal,
    },
    "main-diagonal": {
      label: "Flip across the diagonal from top left to bottom right",
      shortLabel: "\\ FLIP",
      className: styles.mirrorMainDiagonal,
    },
    "anti-diagonal": {
      label: "Flip across the diagonal from bottom left to top right",
      shortLabel: "/ FLIP",
      className: styles.mirrorAntiDiagonal,
    },
  };
  const current = config[axis];

  return (
    <div className={styles.turnCue} role="img" aria-label={current.label}>
      <div
        className={`${styles.mirrorGraphic} ${current.className}`}
        aria-hidden="true"
      >
        <span className={styles.mirrorAxis} />
        <span className={styles.mirrorSides}>
          <span>→</span>
          <span>←</span>
        </span>
      </div>
      <span className={styles.turnLabel} aria-hidden="true">
        {current.shortLabel}
      </span>
    </div>
  );
}

function TransformCue({ transform }: { transform: PuzzleTransform }) {
  return transform.kind === "rotation" ? (
    <TurnArrow transform={transform} />
  ) : (
    <MirrorCue axis={transform.axis} />
  );
}

function ghostTransformCss(transform: PuzzleTransform) {
  if (transform.kind === "rotation") {
    return `rotate(${transform.angleDegrees}deg)`;
  }

  switch (transform.axis) {
    case "vertical":
      return "rotateY(180deg)";
    case "horizontal":
      return "rotateX(180deg)";
    case "main-diagonal":
      return "rotate(45deg) rotateX(180deg) rotate(-45deg)";
    case "anti-diagonal":
      return "rotate(-45deg) rotateX(180deg) rotate(45deg)";
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
      oscillator.disconnect();
      gain.disconnect();
    },
    { once: true },
  );
}

function playTones(context: AudioContext, correct: boolean) {
  const now = context.currentTime + 0.012;

  if (correct) {
    scheduleTone(context, 523.25, now, 0.13, 0.052);
    scheduleTone(context, 659.25, now + 0.075, 0.15, 0.048);
    return;
  }

  scheduleTone(context, 220, now, 0.11, 0.048);
  scheduleTone(context, 174.61, now + 0.055, 0.12, 0.044);
}

export default function RotationMatchPage() {
  const [started, setStarted] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [complete, setComplete] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const clueGridRef = useRef<HTMLDivElement>(null);
  const optionGridRefs = useRef<Array<HTMLDivElement | null>>([]);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);

  const round = ROUNDS[roundIndex];
  const selectedCorrect = selectedIndex === round.correctIndex;
  const progress = roundIndex + (phase === "answered" ? 1 : 0);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;

    const AudioContextClass =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) return null;

    if (
      audioContextRef.current === null ||
      audioContextRef.current.state === "closed"
    ) {
      try {
        audioContextRef.current = new AudioContextClass();
      } catch {
        return null;
      }
    }

    return audioContextRef.current;
  }, []);

  const resumeAudio = useCallback(() => {
    const context = ensureAudioContext();
    if (!context || context.state !== "suspended") return;
    void context.resume().catch(() => undefined);
  }, [ensureAudioContext]);

  const playFeedbackSound = useCallback(
    (correct: boolean) => {
      if (!soundEnabled) return;
      const context = ensureAudioContext();
      if (!context) return;

      if (context.state === "suspended") {
        void context
          .resume()
          .then(() => playTones(context, correct))
          .catch(() => undefined);
        return;
      }

      if (context.state === "running") playTones(context, correct);
    },
    [ensureAudioContext, soundEnabled],
  );

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (
        inputLockedRef.current ||
        phase !== "idle" ||
        complete ||
        !started
      ) {
        return;
      }

      inputLockedRef.current = true;
      const isCorrect = optionIndex === round.correctIndex;
      const sourceRect = clueGridRef.current?.getBoundingClientRect();
      const targetRect =
        optionGridRefs.current[round.correctIndex]?.getBoundingClientRect();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      playFeedbackSound(isCorrect);
      setSelectedIndex(optionIndex);
      if (isCorrect) setScore((current) => current + 1);
      setPhase("animating");

      if (sourceRect && targetRect) {
        setGhost({
          pattern: round.clue,
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
          deltaX: targetRect.left - sourceRect.left,
          deltaY: targetRect.top - sourceRect.top,
          scale: targetRect.width / sourceRect.width,
          transformCss: ghostTransformCss(round.transform),
          reducedMotion,
        });
      }

      const animationToken = animationTokenRef.current + 1;
      animationTokenRef.current = animationToken;
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
      animationTimerRef.current = setTimeout(
        () => {
          if (animationTokenRef.current !== animationToken) return;
          setGhost(null);
          setPhase("answered");
        },
        reducedMotion ? 140 : 680,
      );
    },
    [complete, phase, playFeedbackSound, round, started],
  );

  const resetRoundState = useCallback(() => {
    animationTokenRef.current += 1;
    if (animationTimerRef.current) {
      clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
    inputLockedRef.current = false;
    setSelectedIndex(null);
    setGhost(null);
    setPhase("idle");
  }, []);

  const startGame = useCallback(() => {
    resumeAudio();
    setStarted(true);
    setComplete(false);
    setRoundIndex(0);
    setScore(0);
    resetRoundState();
    shouldFocusFirstOption.current = true;
  }, [resetRoundState, resumeAudio]);

  const goNext = useCallback(() => {
    if (phase !== "answered") return;

    if (roundIndex === ROUNDS.length - 1) {
      resetRoundState();
      setComplete(true);
      return;
    }

    shouldFocusFirstOption.current = true;
    resetRoundState();
    setRoundIndex((current) => current + 1);
  }, [phase, resetRoundState, roundIndex]);

  const restart = useCallback(() => {
    setComplete(false);
    setStarted(true);
    setRoundIndex(0);
    setScore(0);
    resetRoundState();
    shouldFocusFirstOption.current = true;
  }, [resetRoundState]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      window.localStorage.setItem("rotation-match-sound", String(next));
    } catch {
      // Sound still works for this visit when storage is unavailable.
    }
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("rotation-match-sound");
    } catch {
      return;
    }
    if (stored !== "false") return;
    const timer = window.setTimeout(() => setSoundEnabled(false), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !started ||
        complete ||
        phase !== "idle" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const optionIndex = Number(event.key) - 1;
      if (optionIndex >= 0 && optionIndex < 4) {
        event.preventDefault();
        chooseOption(optionIndex);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseOption, complete, phase, started]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (shouldFocusFirstOption.current && started && !complete) {
      firstOptionRef.current?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [complete, roundIndex, started]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  useEffect(() => {
    function finishAnimationOnResize() {
      if (inputLockedRef.current && phase === "animating") {
        animationTokenRef.current += 1;
        if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
        setGhost(null);
        setPhase("answered");
      }
    }

    window.addEventListener("resize", finishAnimationOnResize);
    return () => window.removeEventListener("resize", finishAnimationOnResize);
  }, [phase]);

  useEffect(() => {
    return () => {
      animationTokenRef.current += 1;
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, []);

  const resultMessage = useMemo(() => {
    const accuracy = score / ROUNDS.length;
    if (accuracy === 1) return "Perfect set.";
    if (accuracy >= 0.7) return "Sharp work.";
    return "Good practice.";
  }, [score]);

  const soundButton = (
    <button
      className={styles.soundButton}
      type="button"
      onClick={toggleSound}
      aria-pressed={soundEnabled}
      aria-label="Sound"
    >
      <span aria-hidden="true">♪</span>
      <small aria-hidden="true">{soundEnabled ? "On" : "Off"}</small>
    </button>
  );

  const ghostPortal =
    ghost &&
    createPortal(
      <div
        className={`${styles.ghostFlight} ${
          ghost.reducedMotion ? styles.ghostReduced : ""
        }`}
        style={
          {
            left: `${ghost.left}px`,
            top: `${ghost.top}px`,
            width: `${ghost.width}px`,
            height: `${ghost.height}px`,
            "--ghost-x": `${ghost.deltaX}px`,
            "--ghost-y": `${ghost.deltaY}px`,
            "--ghost-scale": `${ghost.scale}`,
            "--ghost-transform": ghost.transformCss,
          } as CustomProperties
        }
        aria-hidden="true"
      >
        <div className={styles.ghostTurn}>
          <PatternGrid pattern={ghost.pattern} size="ghost" hidden />
        </div>
      </div>,
      document.body,
    );

  return (
    <div className={styles.pageShell}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/" aria-label="All games">
          <span aria-hidden="true">←</span>
          <span>Games</span>
        </Link>
        <span className={styles.gameTitle}>{rotationMatchGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {!started ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Turn it. Find it.</h1>

            <div className={styles.exampleFlow}>
              <PatternGrid
                pattern={TUTORIAL.clue}
                size="tutorialPattern"
                label={`Starting pattern: ${describePattern(TUTORIAL.clue)}`}
              />
              <TransformCue transform={TUTORIAL.transform} />
              <div className={styles.exampleAnswer}>
                <PatternGrid
                  pattern={TUTORIAL.answer}
                  size="tutorialPattern"
                  label={`Correct answer: ${describePattern(TUTORIAL.answer)}`}
                />
                <span className={styles.exampleMark} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>

            <div className={styles.mirrorExample}>
              <span className={styles.notEqual} aria-hidden="true">
                ≠
              </span>
              <PatternGrid
                pattern={TUTORIAL.mirror}
                size="option"
                label={`Mirror image, not the answer: ${describePattern(
                  TUTORIAL.mirror,
                )}`}
              />
              <span className={styles.mirrorMark} aria-label="Not a match">
                ×
              </span>
            </div>

            <button className={styles.primaryButton} type="button" onClick={startGame}>
              Start
              <span aria-hidden="true">→</span>
            </button>
          </section>
        ) : !complete ? (
          <>
            <div className={styles.gameStatus}>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Game progress"
                aria-valuemin={0}
                aria-valuemax={ROUNDS.length}
                aria-valuenow={progress}
              >
                {ROUNDS.map((_, index) => (
                  <span
                    className={index < progress ? styles.progressDone : undefined}
                    key={index}
                  />
                ))}
              </div>
              <span className={styles.roundCount}>
                {roundIndex + 1} / {ROUNDS.length}
              </span>
              <span className={styles.difficulty}>{round.difficulty}</span>
              <span className={styles.score} aria-label={`Score ${score}`}>
                {score} ✓
              </span>
            </div>

            <div className={styles.gameBoard}>
              <section className={styles.cluePanel} aria-label="Pattern and transform">
                <div
                  className={`${styles.clueStage} ${
                    phase === "animating" ? styles.clueAnimating : ""
                  }`}
                >
                  <PatternGrid
                    pattern={round.clue}
                    size="clue"
                    label={`Starting pattern: ${describePattern(round.clue)}`}
                    gridRef={clueGridRef}
                  />
                  <TransformCue transform={round.transform} />
                </div>
              </section>

              <section className={styles.answerPanel} aria-label="Answer choices">
                <div className={styles.optionGrid} role="group" aria-label="Answer choices">
                  {round.options.map((option, optionIndex) => {
                    const isCorrect = optionIndex === round.correctIndex;
                    const isSelected = selectedIndex === optionIndex;
                    const showAnswer = phase === "answered";
                    const showCorrect = showAnswer && isCorrect;
                    const showWrong = showAnswer && isSelected && !isCorrect;
                    const muted = showAnswer && !isCorrect && !isSelected;
                    const answerState = showCorrect
                      ? ", correct answer"
                      : showWrong
                        ? ", your incorrect answer"
                        : "";

                    return (
                      <button
                        className={`${styles.optionButton} ${
                          showCorrect ? styles.correctOption : ""
                        } ${showWrong ? styles.wrongOption : ""} ${
                          muted ? styles.mutedOption : ""
                        }`}
                        type="button"
                        onClick={() => chooseOption(optionIndex)}
                        disabled={phase !== "idle"}
                        aria-label={`Option ${optionIndex + 1}: ${describePattern(
                          option,
                        )}${answerState}`}
                        aria-keyshortcuts={`${optionIndex + 1}`}
                        ref={optionIndex === 0 ? firstOptionRef : undefined}
                        key={`${optionIndex}-${patternKey(option)}`}
                      >
                        <span className={styles.optionNumber} aria-hidden="true">
                          {optionIndex + 1}
                        </span>
                        <PatternGrid
                          pattern={option}
                          size="option"
                          hidden
                          gridRef={(node) => {
                            optionGridRefs.current[optionIndex] = node;
                          }}
                        />
                        {showCorrect ? (
                          <span className={styles.choiceMark} aria-hidden="true">
                            ✓
                          </span>
                        ) : null}
                        {showWrong ? (
                          <span className={styles.choiceMark} aria-hidden="true">
                            ×
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className={styles.feedbackBar} aria-live="polite" role="status">
              {phase === "answered" ? (
                <>
                  <strong className={selectedCorrect ? styles.correctText : styles.wrongText}>
                    {selectedCorrect ? "Correct" : "Not quite"}
                  </strong>
                  <button
                    className={styles.nextButton}
                    type="button"
                    onClick={goNext}
                    ref={nextButtonRef}
                  >
                    {roundIndex === ROUNDS.length - 1 ? "Results" : "Next"}
                    <span aria-hidden="true">→</span>
                  </button>
                </>
              ) : null}
            </div>

            <p className={styles.keyboardHint}>Keys 1–4</p>
          </>
        ) : (
          <section className={styles.results} aria-labelledby="results-title">
            <p className={styles.kicker}>Complete</p>
            <h1 id="results-title" ref={resultHeadingRef} tabIndex={-1}>
              {resultMessage}
            </h1>
            <p className={styles.resultScore}>
              <strong>{score}</strong>
              <span>/ {ROUNDS.length}</span>
            </p>
            <div className={styles.resultActions}>
              <button className={styles.primaryButton} type="button" onClick={restart}>
                Play again
              </button>
              <Link className={styles.secondaryLink} href="/">
                All games
              </Link>
            </div>
          </section>
        )}
      </main>

      {ghostPortal}
    </div>
  );
}
