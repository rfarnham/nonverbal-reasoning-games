"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { createGameNarrationPlayer } from "@/lib/game-narration";

import {
  ANSWER_VALUES,
  SLOW_RESPONSE_MS,
  buildAnswerOptions,
  createSubtractionDeck,
  type AnswerValue,
  type DeckDraw,
  type PracticeMode,
  type SubtractionDeck,
} from "./game-engine";
import {
  createDigitSpeechRecognition,
  getSpeechRecognitionConstructor,
  readSpokenAnswer,
  type BrowserSpeechRecognition,
  type BrowserSpeechRecognitionErrorCode,
} from "./browser-speech";
import {
  recognizeDigit,
  warmDigitRecognizer,
} from "./digit-recognition";
import {
  SUBTRACTION_QUESTION_NARRATION,
  subtractionNarrationCueId,
} from "./question-narration";
import {
  SESSION_MODES,
  TWO_MINUTE_SESSION_MS,
  createSessionClock,
  formatCountdownTime,
  formatElapsedTime,
  isTimedAnswerAllowed,
  pauseSessionClock,
  readSessionElapsed,
  resumeSessionClock,
  sessionAccuracy,
  sessionEncouragement,
  type SessionClock,
  type SessionMode,
} from "./session-engine";
import styles from "./subtraction-flash.module.css";

type AnswerMode = "tap" | "draw" | "speak";
type SessionPhase = "choosing" | "playing" | "settling" | "results";
type SessionFinishReason = "manual" | "time" | "deck";
type SessionPauseReason = "hidden";

type SessionProgress = Readonly<{
  id: number;
  mode: SessionMode;
  clock: SessionClock;
  answered: number;
  correct: number;
  slow: number;
  reviews: number;
  baseDeckSize: number;
  cardsRemaining: number;
}>;

type SessionResult = Readonly<{
  mode: SessionMode;
  finishReason: SessionFinishReason;
  elapsedMs: number;
  answered: number;
  correct: number;
  slow: number;
  reviews: number;
  baseDeckSize: number;
}>;

type RoundState = Readonly<{
  draw: DeckDraw;
  selectedAnswer: AnswerValue | null;
  correct: boolean | null;
  startedAt: number | null;
  answeredWith: AnswerMode | null;
  interpretation: string | null;
}>;

type ModeRounds = Record<PracticeMode, RoundState | null>;

const TAP_RESULT_FLASH_MS = 520;
const RECOGNIZED_RESULT_FLASH_MS = 900;

const SESSION_LABELS: Record<SessionMode, string> = {
  infinite: "Infinite",
  "two-minute": "2 minutes",
  "deck-sprint": "Deck sprint",
};

const SESSION_DESCRIPTIONS: Record<SessionMode, string> = {
  infinite: "Finish whenever you like",
  "two-minute": "Most correct before time is up",
  "deck-sprint": "Finish one shuffled deck",
};

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 5 7.5 12l7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="5"
        y="4"
        width="14"
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9 9h6M9 13h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 10v4h3l4 3V7l-4 3H5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.1c1.2.9 1.8 1.8 1.8 2.9s-.6 2-1.8 2.9M17.7 6.8c2 1.5 3 3.2 3 5.2s-1 3.7-3 5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 11.5V7.8a1.6 1.6 0 0 1 3.2 0v3.7-2a1.6 1.6 0 0 1 3.2 0v2-1a1.6 1.6 0 0 1 3.2 0v4.2c0 3-2.4 5.3-5.3 5.3h-.9a5.2 5.2 0 0 1-4.2-2.1l-2.4-3.2a1.6 1.6 0 0 1 2.5-2l.7.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DrawIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 18 1-4L16.8 3.2a1.7 1.7 0 0 1 2.4 0l1.6 1.6a1.7 1.7 0 0 1 0 2.4L10 18l-4 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m14.8 5.2 4 4M5 21h14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="8.3"
        y="3"
        width="7.4"
        height="12"
        rx="3.7"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SoundIcon({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 10v4h3l4 3V7l-4 3h-3Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {enabled ? (
        <path
          d="M14.5 9.2c1 .8 1.5 1.7 1.5 2.8s-.5 2-1.5 2.8M17 7c1.8 1.4 2.7 3 2.7 5s-.9 3.6-2.7 5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="m15 9 5 6m0-6-5 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function VisualProblem({ round }: Readonly<{ round: RoundState }>) {
  const { card } = round.draw;
  const accessibleProblem =
    card.orientation === "horizontal"
      ? `${card.minuend} minus ${card.subtrahend} equals`
      : `Vertical subtraction: ${card.minuend} minus ${card.subtrahend}`;

  return (
    <div className={styles.questionCard} aria-label={accessibleProblem}>
      <span className={styles.visuallyHidden}>{accessibleProblem}</span>
      {card.orientation === "horizontal" ? (
        <div className={styles.horizontalProblem} aria-hidden="true">
          <span>{card.minuend}</span>
          <span className={styles.operator}>−</span>
          <span>{card.subtrahend}</span>
          <span className={styles.equalsMark}>=</span>
        </div>
      ) : (
        <div className={styles.verticalProblem} aria-hidden="true">
          <span className={styles.verticalTop}>{card.minuend}</span>
          <span className={styles.verticalOperator}>−</span>
          <span className={styles.verticalBottom}>{card.subtrahend}</span>
          <span className={styles.verticalRule} />
        </div>
      )}
    </div>
  );
}

function newRound(
  draw: DeckDraw,
  mode: PracticeMode,
  sessionElapsedMs: number,
): RoundState {
  return {
    draw,
    selectedAnswer: null,
    correct: null,
    startedAt: mode === "visual" ? sessionElapsedMs : null,
    answeredWith: null,
    interpretation: null,
  };
}

type HandwritingAnswerProps = Readonly<{
  disabled: boolean;
  focusRef: MutableRefObject<HTMLCanvasElement | null>;
  onAnswer: (answer: AnswerValue, answeredAt: number) => void;
}>;

type DrawReadout = Readonly<{
  digit: number | null;
  message: string;
  state: "idle" | "reading" | "retry" | "error";
}>;

const HANDWRITING_DELAY_MS = 520;
const HANDWRITING_CONFIDENCE = 0.52;
const HANDWRITING_MARGIN = 0.1;

function HandwritingAnswer({
  disabled,
  focusRef,
  onAnswer,
}: HandwritingAnswerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<Readonly<{ x: number; y: number }> | null>(
    null,
  );
  const pointerIdRef = useRef<number | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);
  const recognitionTokenRef = useRef(0);
  const disabledRef = useRef(disabled);
  const [hasInk, setHasInk] = useState(false);
  const [readout, setReadout] = useState<DrawReadout>({
    digit: null,
    message: "",
    state: "idle",
  });

  const assignCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      focusRef.current = node;
    },
    [focusRef],
  );

  const cancelPendingRecognition = useCallback(() => {
    recognitionTokenRef.current += 1;
    if (recognitionTimerRef.current !== null) {
      window.clearTimeout(recognitionTimerRef.current);
      recognitionTimerRef.current = null;
    }
  }, []);

  const paintCanvasWhite = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) return;

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, rect.width, rect.height);
  }, []);

  const clearDrawing = useCallback(() => {
    cancelPendingRecognition();
    const canvas = canvasRef.current;
    if (canvas) paintCanvasWhite(canvas);
    pointerIdRef.current = null;
    lastPointRef.current = null;
    setHasInk(false);
    setReadout({ digit: null, message: "", state: "idle" });
  }, [cancelPendingRecognition, paintCanvasWhite]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    paintCanvasWhite(canvas);
    const observer = new ResizeObserver(() => {
      paintCanvasWhite(canvas);
    });
    observer.observe(canvas);
    void warmDigitRecognizer().catch(() => {
      setReadout({
        digit: null,
        message: "Pen recognition unavailable",
        state: "error",
      });
    });

    return () => {
      observer.disconnect();
      cancelPendingRecognition();
    };
  }, [
    cancelPendingRecognition,
    paintCanvasWhite,
  ]);

  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) cancelPendingRecognition();
  }, [cancelPendingRecognition, disabled]);

  const pointFromEvent = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const drawToPoint = useCallback(
    (point: Readonly<{ x: number; y: number }>) => {
      const canvas = canvasRef.current;
      const previous = lastPointRef.current;
      if (!canvas || !previous) return;
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) return;

      context.strokeStyle = "#17213d";
      context.lineWidth = 18;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      lastPointRef.current = point;
    },
    [],
  );

  const scheduleRecognition = useCallback(
    (answeredAt: number) => {
      cancelPendingRecognition();
      const token = recognitionTokenRef.current;
      recognitionTimerRef.current = window.setTimeout(() => {
        recognitionTimerRef.current = null;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", {
          willReadFrequently: true,
        });
        if (!canvas || !context || disabledRef.current) return;

        setReadout((previous) => ({
          ...previous,
          message: "Reading…",
          state: "reading",
        }));
        const image = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );

        void recognizeDigit(image)
          .then((prediction) => {
            if (
              recognitionTokenRef.current !== token ||
              disabledRef.current
            ) {
              return;
            }

            const answer = prediction.digit;
            const accepted =
              ANSWER_VALUES.includes(answer as AnswerValue) &&
              prediction.confidence >= HANDWRITING_CONFIDENCE &&
              prediction.margin >= HANDWRITING_MARGIN;

            setReadout({
              digit: answer,
              message: accepted ? "" : "Try again",
              state: accepted ? "idle" : "retry",
            });

            if (accepted) {
              onAnswer(answer as AnswerValue, answeredAt);
            }
          })
          .catch(() => {
            if (recognitionTokenRef.current !== token) return;
            setReadout({
              digit: null,
              message: "Pen recognition unavailable",
              state: "error",
            });
          });
      }, HANDWRITING_DELAY_MS);
    },
    [cancelPendingRecognition, onAnswer],
  );

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (disabled) return;
    const point = pointFromEvent(event);
    if (!point) return;

    event.preventDefault();
    cancelPendingRecognition();
    if (readout.state === "retry") {
      paintCanvasWhite(event.currentTarget);
      setHasInk(false);
    }
    setReadout({ digit: null, message: "", state: "idle" });
    pointerIdRef.current = event.pointerId;
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);

    const context = event.currentTarget.getContext("2d", {
      willReadFrequently: true,
    });
    if (context) {
      context.fillStyle = "#17213d";
      context.beginPath();
      context.arc(point.x, point.y, 9, 0, Math.PI * 2);
      context.fill();
    }
    setHasInk(true);
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [
      event.nativeEvent,
    ];
    for (const sample of events) {
      const canvas = canvasRef.current;
      if (!canvas) break;
      const rect = canvas.getBoundingClientRect();
      drawToPoint({
        x: sample.clientX - rect.left,
        y: sample.clientY - rect.top,
      });
    }
  };

  const finishStroke = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (point) drawToPoint(point);
    pointerIdRef.current = null;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scheduleRecognition(performance.now());
  };

  const cancelStroke = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    lastPointRef.current = null;
  };

  return (
    <div className={styles.drawSurface}>
      <div className={styles.canvasFrame} data-has-ink={hasInk}>
        <canvas
          ref={assignCanvas}
          className={styles.digitCanvas}
          tabIndex={0}
          role="img"
          aria-label="Write one answer digit from 2 to 9. Number keys also work."
          data-disabled={disabled}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={cancelStroke}
        />
        {!hasInk ? (
          <span className={styles.canvasHint} aria-hidden="true">
            Draw 2–9
          </span>
        ) : null}
      </div>

      <div
        className={styles.digitReadout}
        data-state={readout.state}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={styles.readoutLabel}>Read as</span>
        <strong className={styles.readoutDigit}>
          {readout.digit ?? "—"}
        </strong>
        <span className={styles.readoutMessage}>{readout.message}</span>
      </div>

      <button
        className={styles.clearButton}
        type="button"
        disabled={disabled || !hasInk}
        onClick={clearDrawing}
      >
        Clear
      </button>
    </div>
  );
}

type SpeechAnswerProps = Readonly<{
  disabled: boolean;
  microphonePermission: MicrophonePermission;
  onBeforeListen: () => void;
  onAnswer: (answer: AnswerValue, answeredAt: number) => void;
}>;

type MicrophonePermission =
  | "idle"
  | "requesting"
  | "ready"
  | "blocked"
  | "unavailable";

type SpeechState = Readonly<{
  kind:
    | "idle"
    | "starting"
    | "listening"
    | "retry"
    | "blocked"
    | "unsupported";
  message: string;
  transcript: string | null;
}>;

function speechErrorMessage(
  error: BrowserSpeechRecognitionErrorCode,
): SpeechState {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return {
      kind: "blocked",
      message: "Microphone blocked",
      transcript: null,
    };
  }
  if (error === "audio-capture") {
    return {
      kind: "unsupported",
      message: "No microphone",
      transcript: null,
    };
  }
  if (error === "network") {
    return {
      kind: "retry",
      message: "Speech needs a connection",
      transcript: null,
    };
  }
  if (
    error === "language-not-supported" ||
    error === "phrases-not-supported"
  ) {
    return {
      kind: "unsupported",
      message: "Speech unavailable",
      transcript: null,
    };
  }
  return {
    kind: "retry",
    message: "Didn’t hear 2–9",
    transcript: null,
  };
}

function SpeechAnswer({
  disabled,
  microphonePermission,
  onBeforeListen,
  onAnswer,
}: SpeechAnswerProps) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const sessionTokenRef = useRef(0);
  const attemptRef = useRef(0);
  const autoStartedRef = useRef(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>({
    kind: "starting",
    message: "Starting…",
    transcript: null,
  });

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const cancelRecognition = useCallback(() => {
    sessionTokenRef.current += 1;
    clearWatchdog();
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;

    recognition.onend = null;
    recognition.onerror = null;
    recognition.onnomatch = null;
    recognition.onresult = null;
    recognition.onstart = null;
    recognition.onspeechend = null;
    try {
      recognition.abort();
    } catch {
      // Some browser engines throw when an idle recognizer is aborted.
    }
  }, [clearWatchdog]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSupported(getSpeechRecognitionConstructor() !== null);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelRecognition();
    };
  }, [cancelRecognition]);

  useEffect(() => {
    if (disabled) cancelRecognition();
  }, [cancelRecognition, disabled]);

  const startListening = useCallback(() => {
    if (disabled) return;
    cancelRecognition();
    onBeforeListen();

    const recognition = createDigitSpeechRecognition();
    if (!recognition) {
      setSupported(false);
      setSpeechState({
        kind: "unsupported",
        message: "Speech unavailable",
        transcript: null,
      });
      return;
    }

    const token = sessionTokenRef.current;
    let handled = false;
    recognitionRef.current = recognition;
    setSpeechState({
      kind: "starting",
      message: "Starting…",
      transcript: null,
    });

    const finishWithoutAnswer = (
      nextState: SpeechState,
      retryAutomatically = false,
    ) => {
      if (sessionTokenRef.current !== token || handled) return;
      handled = true;
      clearWatchdog();
      setSpeechState(nextState);
      if (retryAutomatically && attemptRef.current < 2) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          autoStartedRef.current = false;
          setSpeechState({
            kind: "starting",
            message: "Listening again…",
            transcript: null,
          });
          setRetryNonce((value) => value + 1);
        }, 600);
      }
      try {
        recognition.stop();
      } catch {
        // The browser may already have ended this one-shot session.
      }
    };

    recognition.onresult = (event) => {
      if (sessionTokenRef.current !== token || handled) return;
      const match = readSpokenAnswer(event);
      if (!match) {
        let transcript: string | null = null;
        for (
          let index = event.resultIndex;
          index < event.results.length && transcript === null;
          index += 1
        ) {
          const result = event.results.item(index);
          const alternative = result?.item(0);
          if (result?.isFinal && alternative?.transcript) {
            transcript = alternative.transcript.trim();
          }
        }
        finishWithoutAnswer(
          {
            kind: "retry",
            message: "Say one digit, 2–9",
            transcript,
          },
          true,
        );
        return;
      }

      handled = true;
      clearWatchdog();
      setSpeechState({
        kind: "idle",
        message: `Heard ${match.answer}`,
        transcript: match.transcript,
      });
      onAnswer(match.answer, performance.now());
      try {
        recognition.stop();
      } catch {
        // The browser may already have ended this one-shot session.
      }
    };

    recognition.onnomatch = () => {
      finishWithoutAnswer(
        {
          kind: "retry",
          message: "Didn’t hear 2–9",
          transcript: null,
        },
        true,
      );
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      finishWithoutAnswer(
        speechErrorMessage(event.error),
        event.error === "no-speech",
      );
    };

    recognition.onstart = () => {
      if (sessionTokenRef.current !== token || handled) return;
      setSpeechState({
        kind: "listening",
        message: "Listening…",
        transcript: null,
      });
      watchdogRef.current = window.setTimeout(() => {
        finishWithoutAnswer(
          {
            kind: "retry",
            message: "Didn’t hear 2–9",
            transcript: null,
          },
          true,
        );
        try {
          recognition.abort();
        } catch {
          // The browser may already have ended.
        }
      }, 8_000);
    };

    recognition.onspeechend = () => {
      try {
        recognition.stop();
      } catch {
        // The browser may already be stopping.
      }
    };

    recognition.onend = () => {
      if (sessionTokenRef.current !== token) return;
      clearWatchdog();
      recognitionRef.current = null;
      if (!handled) {
        handled = true;
        setSpeechState({
          kind: "retry",
          message: "Didn’t hear 2–9",
          transcript: null,
        });
        if (attemptRef.current < 2) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            autoStartedRef.current = false;
            setSpeechState({
              kind: "starting",
              message: "Listening again…",
              transcript: null,
            });
            setRetryNonce((value) => value + 1);
          }, 600);
        }
      }
    };

    try {
      recognition.start();
    } catch {
      finishWithoutAnswer({
        kind: "unsupported",
        message: "Speech unavailable",
        transcript: null,
      });
    }
  }, [cancelRecognition, clearWatchdog, disabled, onAnswer, onBeforeListen]);

  useEffect(() => {
    if (
      !supported ||
      disabled ||
      microphonePermission !== "ready" ||
      autoStartedRef.current
    ) {
      return;
    }
    autoStartedRef.current = true;
    attemptRef.current += 1;
    let started = false;
    const frame = requestAnimationFrame(() => {
      started = true;
      startListening();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (!started) autoStartedRef.current = false;
    };
  }, [
    disabled,
    microphonePermission,
    retryNonce,
    startListening,
    supported,
  ]);

  let visibleMessage = speechState.message;
  if (supported === false) visibleMessage = "Speech unavailable";
  if (disabled && supported) visibleMessage = "Waiting…";
  if (microphonePermission === "requesting") {
    visibleMessage = "Allow microphone";
  } else if (microphonePermission === "blocked") {
    visibleMessage = "Microphone blocked";
  } else if (microphonePermission === "unavailable") {
    visibleMessage = "No microphone";
  }

  return (
    <div
      className={styles.speechSurface}
      data-speech-state={speechState.kind}
    >
      <div
        className={styles.micIndicator}
        data-listening={speechState.kind === "listening"}
        aria-hidden="true"
      >
        <MicIcon />
      </div>
      <div
        className={styles.speechStatus}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>{visibleMessage}</strong>
        {speechState.transcript ? (
          <span>“{speechState.transcript}”</span>
        ) : null}
      </div>
    </div>
  );
}

export default function SubtractionFlashPage() {
  const [mode, setMode] = useState<PracticeMode>("visual");
  const [answerMode, setAnswerMode] = useState<AnswerMode>("tap");
  const [rounds, setRounds] = useState<ModeRounds>({
    visual: null,
    listen: null,
  });
  const [sessionPhase, setSessionPhase] =
    useState<SessionPhase>("choosing");
  const [sessionProgress, setSessionProgress] = useState<SessionProgress>({
    id: 0,
    mode: "infinite",
    clock: createSessionClock(0, false),
    answered: 0,
    correct: 0,
    slow: 0,
    reviews: 0,
    baseDeckSize: 0,
    cardsRemaining: 0,
  });
  const [sessionResult, setSessionResult] =
    useState<SessionResult | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isQuestionSpeaking, setIsQuestionSpeaking] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermission>("idle");

  const modeRef = useRef<PracticeMode>("visual");
  const roundsRef = useRef<ModeRounds>({ visual: null, listen: null });
  const deckRef = useRef<SubtractionDeck | null>(null);
  const sessionProgressRef = useRef(sessionProgress);
  const sessionPhaseRef = useRef<SessionPhase>("choosing");
  const sessionIdRef = useRef(0);
  const answerLockRef = useRef<string | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const pauseReasonsRef = useRef(new Set<SessionPauseReason>());
  const soundEnabledRef = useRef(true);
  const microphonePermissionRef = useRef<MicrophonePermission>("idle");
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackTokenRef = useRef(0);
  const drawFocusRef = useRef<HTMLCanvasElement | null>(null);
  const resultsDialogRef = useRef<HTMLDialogElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const firstSessionChoiceRef = useRef<HTMLButtonElement | null>(null);
  const answerButtonRefs = useRef<
    Partial<Record<AnswerValue, HTMLButtonElement | null>>
  >({});

  const [narrationPlayer] = useState(() =>
    createGameNarrationPlayer(SUBTRACTION_QUESTION_NARRATION),
  );

  const currentRound = rounds[mode];
  const answerOptions = currentRound
    ? buildAnswerOptions(currentRound.draw.card)
    : ANSWER_VALUES;
  const answerReady =
    sessionPhase === "playing" &&
    sessionProgress.clock.runningSince !== null &&
    currentRound !== null &&
    currentRound.selectedAnswer === null &&
    !(answerMode === "speak" && microphonePermission === "requesting") &&
    !(mode === "listen" && !soundEnabled) &&
    (mode === "visual" ||
      (currentRound.startedAt !== null && !isQuestionSpeaking));

  const elapsedMs = readSessionElapsed(sessionProgress.clock, clockNow);
  const remainingTimedMs = Math.max(
    0,
    TWO_MINUTE_SESSION_MS - elapsedMs,
  );

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = createGameAudioContext();
    }
    return audioContextRef.current;
  }, []);

  const playEarcon = useCallback(
    (correct: boolean) => {
      if (!soundEnabledRef.current) return;
      const context = ensureAudioContext();
      if (!context) return;

      if (context.state === "suspended") {
        void context
          .resume()
          .then(() => playFeedbackEarcon(context, correct))
          .catch(() => undefined);
        return;
      }
      playFeedbackEarcon(context, correct);
    },
    [ensureAudioContext],
  );

  const replaceSessionProgress = useCallback((next: SessionProgress) => {
    sessionProgressRef.current = next;
    setSessionProgress(next);
  }, []);

  const pauseSessionFor = useCallback(
    (reason: SessionPauseReason, now = performance.now()) => {
      const reasons = pauseReasonsRef.current;
      if (reasons.has(reason)) return;
      const wasRunning = reasons.size === 0;
      reasons.add(reason);
      if (!wasRunning || sessionPhaseRef.current !== "playing") return;

      const progress = sessionProgressRef.current;
      replaceSessionProgress({
        ...progress,
        clock: pauseSessionClock(progress.clock, now),
      });
      setClockNow(now);
    },
    [replaceSessionProgress],
  );

  const resumeSessionFor = useCallback(
    (reason: SessionPauseReason, now = performance.now()) => {
      const reasons = pauseReasonsRef.current;
      if (!reasons.delete(reason) || reasons.size > 0) return;
      if (sessionPhaseRef.current !== "playing") return;

      const progress = sessionProgressRef.current;
      replaceSessionProgress({
        ...progress,
        clock: resumeSessionClock(progress.clock, now),
      });
      setClockNow(now);
    },
    [replaceSessionProgress],
  );

  const markListeningRoundReady = useCallback((cardId: string) => {
    if (modeRef.current !== "listen") return;
    const previous = roundsRef.current;
    const listeningRound = previous.listen;
    if (
      !listeningRound ||
      listeningRound.draw.card.id !== cardId ||
      listeningRound.selectedAnswer !== null ||
      listeningRound.startedAt !== null
    ) {
      return;
    }

    const now = performance.now();
    const nextRounds: ModeRounds = {
      ...previous,
      listen: {
        ...listeningRound,
        startedAt: readSessionElapsed(
          sessionProgressRef.current.clock,
          now,
        ),
      },
    };
    roundsRef.current = nextRounds;
    setRounds(nextRounds);
  }, []);

  const speakQuestion = useCallback(
    (round: RoundState) => {
      if (!soundEnabledRef.current || round.selectedAnswer !== null) return;

      const playbackToken = playbackTokenRef.current + 1;
      playbackTokenRef.current = playbackToken;
      setIsQuestionSpeaking(true);
      narrationPlayer.prime();

      void narrationPlayer
        .play([subtractionNarrationCueId(round.draw.card)])
        .then((result) => {
          if (playbackTokenRef.current !== playbackToken) return;
          setIsQuestionSpeaking(false);
          if (result.status === "completed") {
            markListeningRoundReady(round.draw.card.id);
          }
        })
        .catch(() => {
          if (playbackTokenRef.current !== playbackToken) return;
          setIsQuestionSpeaking(false);
          markListeningRoundReady(round.draw.card.id);
        });
    },
    [markListeningRoundReady, narrationPlayer],
  );

  const stopSpeaking = useCallback(() => {
    playbackTokenRef.current += 1;
    narrationPlayer.cancel();
    setIsQuestionSpeaking(false);
  }, [narrationPlayer]);

  const finishSession = useCallback(
    (
      finishReason: SessionFinishReason,
      finishedAtMs?: number,
      revealDelayMs = 0,
    ) => {
      if (sessionPhaseRef.current !== "playing") return;

      const now = performance.now();
      const progress = sessionProgressRef.current;
      const elapsed = Math.max(
        0,
        finishedAtMs ?? readSessionElapsed(progress.clock, now),
      );
      const frozenProgress: SessionProgress = {
        ...progress,
        clock: { elapsedMs: elapsed, runningSince: null },
      };

      sessionPhaseRef.current = "settling";
      setSessionPhase("settling");
      replaceSessionProgress(frozenProgress);
      setClockNow(now);
      stopSpeaking();

      const result: SessionResult = {
        mode: progress.mode,
        finishReason,
        elapsedMs: elapsed,
        answered: progress.answered,
        correct: progress.correct,
        slow: progress.slow,
        reviews: progress.reviews,
        baseDeckSize: progress.baseDeckSize,
      };

      const reveal = () => {
        resultTimerRef.current = null;
        sessionPhaseRef.current = "results";
        setSessionPhase("results");
        setSessionResult(result);
      };

      if (revealDelayMs > 0) {
        resultTimerRef.current = window.setTimeout(reveal, revealDelayMs);
      } else {
        reveal();
      }
    },
    [replaceSessionProgress, stopSpeaking],
  );

  const submitAnswer = useCallback(
    (
      answer: AnswerValue,
      answeredWith: AnswerMode = "tap",
      answeredAt = performance.now(),
    ) => {
      if (sessionPhaseRef.current !== "playing") return;
      const activeMode = modeRef.current;
      const round = roundsRef.current[activeMode];
      const deck = deckRef.current;
      if (
        !round ||
        !deck ||
        round.selectedAnswer !== null ||
        round.startedAt === null ||
        answerLockRef.current === round.draw.card.id
      ) {
        return;
      }

      const progress = sessionProgressRef.current;
      if (
        progress.clock.runningSince === null ||
        (activeMode === "listen" && !soundEnabledRef.current)
      ) {
        return;
      }
      const activeElapsedMs = readSessionElapsed(
        progress.clock,
        answeredAt,
      );
      if (
        progress.mode === "two-minute" &&
        !isTimedAnswerAllowed(activeElapsedMs)
      ) {
        finishSession("time", TWO_MINUTE_SESSION_MS);
        return;
      }

      answerLockRef.current = round.draw.card.id;
      const correct = answer === round.draw.card.answer;
      const answerElapsedMs = Math.max(
        0,
        activeElapsedMs - round.startedAt,
      );
      deck.recordOutcome(round.draw.card, {
        correct,
        elapsedMs: answerElapsedMs,
      });

      const answeredRound: RoundState = {
        ...round,
        selectedAnswer: answer,
        correct,
        answeredWith,
        interpretation:
          answeredWith === "draw"
            ? `Read as ${answer}`
            : answeredWith === "speak"
              ? `Heard ${answer}`
              : null,
      };
      const nextRounds: ModeRounds = {
        ...roundsRef.current,
        [activeMode]: answeredRound,
      };
      roundsRef.current = nextRounds;
      setRounds(nextRounds);

      const deckSnapshot = deck.snapshot();
      const nextProgress: SessionProgress = {
        ...progress,
        answered: progress.answered + 1,
        correct: progress.correct + (correct ? 1 : 0),
        slow:
          progress.slow + (answerElapsedMs > SLOW_RESPONSE_MS ? 1 : 0),
        reviews: progress.reviews + (round.draw.card.isReview ? 1 : 0),
        cardsRemaining: deckSnapshot.remaining,
      };
      replaceSessionProgress(nextProgress);

      if (activeMode === "listen") stopSpeaking();
      if (answeredWith !== "speak") playEarcon(correct);

      const feedbackDelay =
        answeredWith === "tap"
          ? TAP_RESULT_FLASH_MS
          : RECOGNIZED_RESULT_FLASH_MS;
      if (progress.mode === "deck-sprint" && deckSnapshot.exhausted) {
        finishSession("deck", activeElapsedMs, feedbackDelay);
      } else if (
        progress.mode === "two-minute" &&
        activeElapsedMs >= TWO_MINUTE_SESSION_MS
      ) {
        finishSession("time", TWO_MINUTE_SESSION_MS, feedbackDelay);
      }
    },
    [finishSession, playEarcon, replaceSessionProgress, stopSpeaking],
  );

  const primeMicrophonePermission = useCallback(() => {
    if (microphonePermissionRef.current !== "idle") return;
    if (getSpeechRecognitionConstructor() === null) {
      microphonePermissionRef.current = "ready";
      setMicrophonePermission("ready");
      return;
    }

    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices,
    );
    if (!getUserMedia) {
      microphonePermissionRef.current = "ready";
      setMicrophonePermission("ready");
      return;
    }

    microphonePermissionRef.current = "requesting";
    setMicrophonePermission("requesting");
    let request: Promise<MediaStream>;
    try {
      request = getUserMedia({ audio: true });
    } catch {
      microphonePermissionRef.current = "unavailable";
      setMicrophonePermission("unavailable");
      return;
    }

    void request
      .then((stream) => {
        for (const track of stream.getTracks()) track.stop();
        microphonePermissionRef.current = "ready";
        setMicrophonePermission("ready");
      })
      .catch((error: unknown) => {
        const blocked =
          error instanceof DOMException &&
          (error.name === "NotAllowedError" ||
            error.name === "SecurityError");
        const nextPermission = blocked ? "blocked" : "unavailable";
        microphonePermissionRef.current = nextPermission;
        setMicrophonePermission(nextPermission);
      });
  }, []);

  const handleAnswerModeChange = useCallback(
    (nextMode: AnswerMode) => {
      if (nextMode === "speak") primeMicrophonePermission();
      setAnswerMode(nextMode);
    },
    [primeMicrophonePermission],
  );

  const advanceRound = useCallback(() => {
    if (sessionPhaseRef.current !== "playing") return;
    const deck = deckRef.current;
    if (!deck || deck.snapshot().exhausted) return;
    const activeMode = modeRef.current;
    const now = performance.now();
    const activeElapsedMs = readSessionElapsed(
      sessionProgressRef.current.clock,
      now,
    );
    if (
      sessionProgressRef.current.mode === "two-minute" &&
      activeElapsedMs >= TWO_MINUTE_SESSION_MS
    ) {
      finishSession("time", TWO_MINUTE_SESSION_MS);
      return;
    }

    stopSpeaking();
    answerLockRef.current = null;
    const round = newRound(deck.next(), activeMode, activeElapsedMs);
    const nextRounds: ModeRounds = {
      visual: activeMode === "visual" ? round : null,
      listen: activeMode === "listen" ? round : null,
    };
    roundsRef.current = nextRounds;
    setRounds(nextRounds);
    if (activeMode === "listen") speakQuestion(round);
  }, [finishSession, speakQuestion, stopSpeaking]);

  const beginSession = useCallback(
    (sessionMode: SessionMode) => {
      if (
        sessionPhaseRef.current === "playing" ||
        sessionPhaseRef.current === "settling"
      ) {
        return;
      }
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
      stopSpeaking();

      const activeMode = modeRef.current;
      const now = performance.now();
      const pauseReasons = pauseReasonsRef.current;
      pauseReasons.clear();
      if (document.hidden) pauseReasons.add("hidden");

      const deck = createSubtractionDeck({
        mode: activeMode,
        repeat: sessionMode !== "deck-sprint",
      });
      const firstDraw = deck.next();
      const nextId = sessionIdRef.current + 1;
      sessionIdRef.current = nextId;
      const progress: SessionProgress = {
        id: nextId,
        mode: sessionMode,
        clock: createSessionClock(now, pauseReasons.size === 0),
        answered: 0,
        correct: 0,
        slow: 0,
        reviews: 0,
        baseDeckSize: firstDraw.baseDeckSize,
        cardsRemaining: firstDraw.remaining + 1,
      };
      const round = newRound(firstDraw, activeMode, 0);
      const nextRounds: ModeRounds = {
        visual: activeMode === "visual" ? round : null,
        listen: activeMode === "listen" ? round : null,
      };

      deckRef.current = deck;
      answerLockRef.current = null;
      roundsRef.current = nextRounds;
      sessionPhaseRef.current = "playing";
      setRounds(nextRounds);
      replaceSessionProgress(progress);
      setClockNow(now);
      setSessionResult(null);
      setSessionPhase("playing");

      if (answerMode === "speak") primeMicrophonePermission();
      if (activeMode === "listen" && soundEnabledRef.current) {
        speakQuestion(round);
      }
    },
    [
      answerMode,
      primeMicrophonePermission,
      replaceSessionProgress,
      speakQuestion,
      stopSpeaking,
    ],
  );

  const handleModeChange = useCallback(
    (nextMode: PracticeMode) => {
      if (
        nextMode === modeRef.current ||
        sessionPhaseRef.current !== "choosing"
      ) {
        return;
      }
      stopSpeaking();
      modeRef.current = nextMode;
      setMode(nextMode);
      const emptyRounds: ModeRounds = { visual: null, listen: null };
      roundsRef.current = emptyRounds;
      setRounds(emptyRounds);
    },
    [stopSpeaking],
  );

  const handleSoundToggle = useCallback(() => {
    const enabled = !soundEnabledRef.current;
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    writeSoundPreference(enabled);
    narrationPlayer.setEnabled(enabled);

    if (!enabled) {
      stopSpeaking();
      return;
    }

    const context = ensureAudioContext();
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    const listeningRound = roundsRef.current.listen;
    if (
      sessionPhaseRef.current === "playing" &&
      modeRef.current === "listen" &&
      listeningRound &&
      listeningRound.selectedAnswer === null
    ) {
      speakQuestion(listeningRound);
    }
  }, [
    ensureAudioContext,
    narrationPlayer,
    speakQuestion,
    stopSpeaking,
  ]);

  useEffect(() => {
    const enabled = readSoundPreference();
    if (enabled) return;
    const timer = window.setTimeout(() => {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    narrationPlayer.setEnabled(soundEnabled);
  }, [narrationPlayer, soundEnabled]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const now = performance.now();
      if (document.hidden) {
        pauseSessionFor("hidden", now);
        if (modeRef.current === "listen") stopSpeaking();
        return;
      }

      resumeSessionFor("hidden", now);
      const listeningRound = roundsRef.current.listen;
      if (
        sessionPhaseRef.current === "playing" &&
        modeRef.current === "listen" &&
        soundEnabledRef.current &&
        listeningRound &&
        listeningRound.selectedAnswer === null
      ) {
        speakQuestion(listeningRound);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
  }, [pauseSessionFor, resumeSessionFor, speakQuestion, stopSpeaking]);

  useEffect(() => {
    if (sessionPhase !== "playing") return;

    const updateClock = () => {
      const now = performance.now();
      setClockNow(now);
      const progress = sessionProgressRef.current;
      if (
        progress.mode === "two-minute" &&
        readSessionElapsed(progress.clock, now) >= TWO_MINUTE_SESSION_MS
      ) {
        const round = roundsRef.current[modeRef.current];
        finishSession(
          "time",
          TWO_MINUTE_SESSION_MS,
          round && round.selectedAnswer !== null ? 240 : 0,
        );
      }
    };

    updateClock();
    const timer = window.setInterval(updateClock, 200);
    return () => window.clearInterval(timer);
  }, [finishSession, sessionPhase, sessionProgress.id]);

  useEffect(() => {
    const dialog = resultsDialogRef.current;
    if (!dialog) return;

    if (sessionResult) {
      if (!dialog.open) dialog.showModal();
      const frame = requestAnimationFrame(() => {
        resultsHeadingRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }

    if (dialog.open) dialog.close();
  }, [sessionResult]);

  useEffect(() => {
    return () => {
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
      }
      narrationPlayer.dispose();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, [narrationPlayer]);

  useEffect(() => {
    if (!currentRound) return;

    const frame = requestAnimationFrame(() => {
      if (answerReady) {
        if (answerMode === "draw") {
          drawFocusRef.current?.focus();
        } else if (answerMode === "tap") {
          answerButtonRefs.current[ANSWER_VALUES[0]]?.focus();
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [answerMode, answerReady, currentRound]);

  useEffect(() => {
    if (!currentRound || currentRound.selectedAnswer === null) return;

    const answeredMode = mode;
    const timer = window.setTimeout(() => {
      if (modeRef.current === answeredMode) {
        advanceRound();
      }
    }, currentRound.answeredWith === "tap"
      ? TAP_RESULT_FLASH_MS
      : RECOGNIZED_RESULT_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [advanceRound, currentRound, mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (sessionPhaseRef.current !== "playing") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") ||
          target.isContentEditable)
      ) {
        return;
      }

      const answer = Number(event.key);
      if (!ANSWER_VALUES.includes(answer as AnswerValue)) return;
      event.preventDefault();
      submitAnswer(answer as AnswerValue);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [submitAnswer]);

  const returnToModeChoice = useCallback(() => {
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    stopSpeaking();
    sessionPhaseRef.current = "choosing";
    deckRef.current = null;
    answerLockRef.current = null;
    pauseReasonsRef.current.clear();
    const emptyRounds: ModeRounds = { visual: null, listen: null };
    roundsRef.current = emptyRounds;
    setRounds(emptyRounds);
    setSessionResult(null);
    setSessionPhase("choosing");
  }, [stopSpeaking]);

  useEffect(() => {
    if (sessionPhase !== "choosing" || sessionProgress.id === 0) return;
    const frame = requestAnimationFrame(() => {
      firstSessionChoiceRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [sessionPhase, sessionProgress.id]);

  const answerState = (answer: AnswerValue) => {
    if (!currentRound || currentRound.selectedAnswer === null) return "idle";
    if (answer === currentRound.selectedAnswer) {
      return currentRound.correct ? "correct" : "incorrect";
    }
    return "muted";
  };

  const resultAccuracy = sessionResult
    ? sessionAccuracy(sessionResult.correct, sessionResult.answered)
    : null;
  const resultHero = sessionResult
    ? sessionResult.mode === "deck-sprint"
      ? formatElapsedTime(sessionResult.elapsedMs, true)
      : sessionResult.mode === "two-minute"
        ? `${sessionResult.correct} correct`
        : `${sessionResult.answered} answered`
    : "";

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/" aria-label="All games">
          <ArrowLeftIcon />
        </Link>

        <nav className={styles.modeSwitch} aria-label="Practice style">
          <button
            className={styles.modeButton}
            type="button"
            aria-pressed={mode === "visual"}
            disabled={sessionPhase !== "choosing"}
            onClick={() => handleModeChange("visual")}
          >
            <CardsIcon />
            Cards
          </button>
          <button
            className={styles.modeButton}
            type="button"
            aria-pressed={mode === "listen"}
            disabled={sessionPhase !== "choosing"}
            onClick={() => handleModeChange("listen")}
          >
            <SpeakerIcon />
            Listen
          </button>
        </nav>

        <button
          className={styles.soundButton}
          type="button"
          aria-pressed={soundEnabled}
          aria-label={`Sound ${soundEnabled ? "on" : "off"}. Toggle sound.`}
          onClick={handleSoundToggle}
        >
          <SoundIcon enabled={soundEnabled} />
        </button>
      </header>

      <main className={styles.main}>
        <section
          className={styles.board}
          data-answer-mode={answerMode}
          aria-labelledby="game-heading"
        >
          <h1 className={styles.visuallyHidden} id="game-heading">
            Borrow Flash
          </h1>
          {sessionPhase === "choosing" ? (
            <section
              className={styles.sessionChooser}
              aria-labelledby="session-choice-heading"
            >
              <div className={styles.sessionChoiceHeading}>
                <span>{mode === "visual" ? "Cards" : "Listen"}</span>
                <h2 id="session-choice-heading">Choose a run</h2>
              </div>
              <div className={styles.sessionChoiceGrid}>
                {SESSION_MODES.map((sessionMode, index) => (
                  <button
                    key={sessionMode}
                    ref={index === 0 ? firstSessionChoiceRef : undefined}
                    className={styles.sessionChoice}
                    type="button"
                    onClick={() => beginSession(sessionMode)}
                  >
                    <strong>{SESSION_LABELS[sessionMode]}</strong>
                    <span>{SESSION_DESCRIPTIONS[sessionMode]}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <div className={styles.promptArea} data-running="true">
                <div className={styles.sessionHud}>
                  <span className={styles.sessionName}>
                    {SESSION_LABELS[sessionProgress.mode]}
                  </span>
                  <div className={styles.sessionReadout}>
                    {sessionProgress.mode === "infinite" ? (
                      <strong>{sessionProgress.answered} answered</strong>
                    ) : sessionProgress.mode === "two-minute" ? (
                      <>
                        <strong role="timer">
                          {formatCountdownTime(remainingTimedMs)}
                        </strong>
                        <span>{sessionProgress.correct} correct</span>
                      </>
                    ) : (
                      <>
                        <strong>{sessionProgress.cardsRemaining} left</strong>
                        <span>{formatElapsedTime(elapsedMs)}</span>
                      </>
                    )}
                  </div>
                  {sessionProgress.mode === "infinite" ? (
                    <button
                      className={styles.finishButton}
                      type="button"
                      disabled={
                        sessionPhase !== "playing" ||
                        sessionProgress.answered === 0
                      }
                      onClick={() => finishSession("manual")}
                    >
                      Finish
                    </button>
                  ) : null}
                </div>

                {!currentRound ? (
                  <div
                    className={styles.loadingCard}
                    aria-label="Shuffling cards"
                  />
                ) : mode === "visual" ? (
                  <VisualProblem round={currentRound} />
                ) : (
                  <button
                    className={`${styles.listeningCard} ${
                      isQuestionSpeaking ? styles.speaking : ""
                    }`}
                    type="button"
                    aria-label={
                      !soundEnabled
                        ? "Sound is off"
                        : isQuestionSpeaking
                          ? "Playing subtraction question"
                          : "Replay subtraction question"
                    }
                    disabled={
                      sessionPhase !== "playing" ||
                      !soundEnabled ||
                      isQuestionSpeaking ||
                      currentRound.selectedAnswer !== null
                    }
                    onClick={() => speakQuestion(currentRound)}
                  >
                    <span className={styles.speakerOrb}>
                      <SpeakerIcon />
                    </span>
                    {!soundEnabled ? (
                      <span className={styles.listeningState}>Sound off</span>
                    ) : null}
                  </button>
                )}

                <div
                  className={`${styles.resultFlash} ${
                    currentRound?.correct === true
                      ? styles.resultCorrect
                      : currentRound?.correct === false
                        ? styles.resultIncorrect
                        : ""
                  }`}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {currentRound?.correct !== null &&
                  currentRound?.correct !== undefined ? (
                    <div className={styles.resultContent}>
                      <div className={styles.resultVerdict}>
                        <span
                          className={styles.resultSymbol}
                          aria-hidden="true"
                        >
                          {currentRound.correct ? "✓" : "×"}
                        </span>
                        {currentRound.correct ? "Correct" : "Incorrect"}
                      </div>
                      {currentRound.interpretation ? (
                        <span className={styles.resultInterpretation}>
                          {currentRound.interpretation}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <section
                className={styles.answerSection}
                aria-labelledby="answer-heading"
              >
                <h2 className={styles.visuallyHidden} id="answer-heading">
                  Give the answer
                </h2>
                <nav
                  className={styles.answerModeSwitch}
                  aria-label="Answer input"
                >
                  <button
                    className={styles.answerModeButton}
                    type="button"
                    aria-pressed={answerMode === "tap"}
                    disabled={sessionPhase !== "playing"}
                    onClick={() => handleAnswerModeChange("tap")}
                  >
                    <TapIcon />
                    Tap
                  </button>
                  <button
                    className={styles.answerModeButton}
                    type="button"
                    aria-pressed={answerMode === "draw"}
                    disabled={sessionPhase !== "playing"}
                    onClick={() => handleAnswerModeChange("draw")}
                  >
                    <DrawIcon />
                    Draw
                  </button>
                  <button
                    className={styles.answerModeButton}
                    type="button"
                    aria-pressed={answerMode === "speak"}
                    disabled={sessionPhase !== "playing"}
                    onClick={() => handleAnswerModeChange("speak")}
                  >
                    <MicIcon />
                    Speak
                  </button>
                </nav>

                <div className={styles.answerSurface}>
                  {answerMode === "tap" ? (
                    <div className={styles.answerGrid}>
                      {answerOptions.map((answer) => {
                        const state = answerState(answer);
                        const selected =
                          currentRound?.selectedAnswer === answer;
                        const stateLabel =
                          state === "correct"
                            ? ", correct"
                            : state === "incorrect"
                              ? ", incorrect"
                              : "";

                        return (
                          <button
                            key={answer}
                            ref={(node) => {
                              answerButtonRefs.current[answer] = node;
                            }}
                            className={styles.answerButton}
                            type="button"
                            data-state={state}
                            disabled={!answerReady}
                            aria-keyshortcuts={String(answer)}
                            aria-label={`${answer}${stateLabel}`}
                            aria-pressed={selected}
                            onClick={() => submitAnswer(answer)}
                          >
                            {answer}
                          </button>
                        );
                      })}
                    </div>
                  ) : answerMode === "draw" ? (
                    <HandwritingAnswer
                      key={`${sessionProgress.id}:${mode}:${
                        currentRound?.draw.card.id ?? "loading"
                      }`}
                      disabled={!answerReady}
                      focusRef={drawFocusRef}
                      onAnswer={(answer, answeredAt) =>
                        submitAnswer(answer, "draw", answeredAt)
                      }
                    />
                  ) : (
                    <SpeechAnswer
                      key={`${sessionProgress.id}:${mode}:${
                        currentRound?.draw.card.id ?? "loading"
                      }`}
                      disabled={!answerReady}
                      microphonePermission={microphonePermission}
                      onBeforeListen={stopSpeaking}
                      onAnswer={(answer, answeredAt) =>
                        submitAnswer(answer, "speak", answeredAt)
                      }
                    />
                  )}
                </div>
              </section>
            </>
          )}
        </section>
      </main>

      <dialog
        ref={resultsDialogRef}
        className={styles.resultsDialog}
        aria-labelledby="results-heading"
        onCancel={(event) => {
          event.preventDefault();
          returnToModeChoice();
        }}
      >
        {sessionResult ? (
          <div className={styles.resultsSplash}>
            <p className={styles.resultsKicker}>
              {SESSION_LABELS[sessionResult.mode]}
              {sessionResult.mode === "deck-sprint"
                ? ` · ${sessionResult.baseDeckSize}-card deck`
                : ""}
            </p>
            <h2
              ref={resultsHeadingRef}
              id="results-heading"
              tabIndex={-1}
            >
              {sessionEncouragement(
                sessionResult.correct,
                sessionResult.answered,
              )}
            </h2>
            <p className={styles.resultsHero}>{resultHero}</p>
            <dl className={styles.resultsStats}>
              <div>
                <dt>Accuracy</dt>
                <dd>
                  {resultAccuracy === null ? "—" : `${resultAccuracy}%`}
                </dd>
              </div>
              <div>
                <dt>
                  {sessionResult.mode === "deck-sprint"
                    ? "Answered"
                    : sessionResult.mode === "two-minute"
                      ? "Answered"
                      : "Correct"}
                </dt>
                <dd>
                  {sessionResult.mode === "infinite"
                    ? sessionResult.correct
                    : sessionResult.answered}
                </dd>
              </div>
              <div>
                <dt>
                  {sessionResult.mode === "deck-sprint" ? "Reviews" : "Time"}
                </dt>
                <dd>
                  {sessionResult.mode === "deck-sprint"
                    ? sessionResult.reviews
                    : formatElapsedTime(sessionResult.elapsedMs)}
                </dd>
              </div>
            </dl>
            <div className={styles.resultsActions}>
              <button
                className={styles.playAgainButton}
                type="button"
                onClick={() => beginSession(sessionResult.mode)}
              >
                Play again
              </button>
              <button
                className={styles.chooseModeButton}
                type="button"
                onClick={returnToModeChoice}
              >
                Choose mode
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
