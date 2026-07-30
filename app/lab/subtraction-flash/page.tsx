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
import styles from "./subtraction-flash.module.css";

type AnswerMode = "tap" | "draw" | "speak";

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

function newRound(draw: DeckDraw, mode: PracticeMode): RoundState {
  return {
    draw,
    selectedAnswer: null,
    correct: null,
    startedAt: mode === "visual" ? performance.now() : null,
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
  focusRef: MutableRefObject<HTMLButtonElement | null>;
  onBeforeListen: () => void;
  onAnswer: (answer: AnswerValue, answeredAt: number) => void;
}>;

type SpeechState = Readonly<{
  kind:
    | "idle"
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
  focusRef,
  onBeforeListen,
  onAnswer,
}: SpeechAnswerProps) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const sessionTokenRef = useRef(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>({
    kind: "idle",
    message: "Tap to speak",
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
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;

    recognition.onend = null;
    recognition.onerror = null;
    recognition.onnomatch = null;
    recognition.onresult = null;
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

  useEffect(() => {
    if (!supported || disabled) return;
    const frame = requestAnimationFrame(() => {
      focusRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [disabled, focusRef, supported]);

  const startListening = () => {
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
      kind: "listening",
      message: "Listening…",
      transcript: null,
    });

    const finishWithoutAnswer = (nextState: SpeechState) => {
      if (sessionTokenRef.current !== token || handled) return;
      handled = true;
      clearWatchdog();
      setSpeechState(nextState);
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
        finishWithoutAnswer({
          kind: "retry",
          message: "Say one digit, 2–9",
          transcript,
        });
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
      finishWithoutAnswer({
        kind: "retry",
        message: "Didn’t hear 2–9",
        transcript: null,
      });
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      finishWithoutAnswer(speechErrorMessage(event.error));
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
      }
    };

    watchdogRef.current = window.setTimeout(() => {
      finishWithoutAnswer({
        kind: "retry",
        message: "Didn’t hear 2–9",
        transcript: null,
      });
      try {
        recognition.abort();
      } catch {
        // The browser may already have ended.
      }
    }, 8_000);

    try {
      recognition.start();
    } catch {
      finishWithoutAnswer({
        kind: "unsupported",
        message: "Speech unavailable",
        transcript: null,
      });
    }
  };

  const visibleMessage =
    disabled && supported
      ? "Wait for the question"
      : supported === false
        ? "Speech unavailable"
        : speechState.message;

  return (
    <div className={styles.speechSurface}>
      <button
        ref={(node) => {
          focusRef.current = node;
        }}
        className={styles.micButton}
        type="button"
        data-listening={speechState.kind === "listening"}
        disabled={disabled || supported !== true}
        aria-label={
          speechState.kind === "listening"
            ? "Listening for answer"
            : "Speak answer"
        }
        onClick={startListening}
      >
        <MicIcon />
      </button>
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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isQuestionSpeaking, setIsQuestionSpeaking] = useState(false);

  const modeRef = useRef<PracticeMode>("visual");
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackTokenRef = useRef(0);
  const drawFocusRef = useRef<HTMLCanvasElement | null>(null);
  const speechFocusRef = useRef<HTMLButtonElement | null>(null);
  const answerButtonRefs = useRef<
    Partial<Record<AnswerValue, HTMLButtonElement | null>>
  >({});

  const [narrationPlayer] = useState(() =>
    createGameNarrationPlayer(SUBTRACTION_QUESTION_NARRATION),
  );
  const [decks] = useState<Record<PracticeMode, SubtractionDeck>>(() => ({
    visual: createSubtractionDeck({ mode: "visual" }),
    listen: createSubtractionDeck({ mode: "listen" }),
  }));

  const currentRound = rounds[mode];
  const answerOptions = currentRound
    ? buildAnswerOptions(currentRound.draw.card)
    : ANSWER_VALUES;
  const answerReady =
    currentRound !== null &&
    currentRound.selectedAnswer === null &&
    (mode === "visual" ||
      (currentRound.startedAt !== null && !isQuestionSpeaking));

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

  const markListeningRoundReady = useCallback((cardId: string) => {
    if (modeRef.current !== "listen") return;

    setRounds((previous) => {
      const listeningRound = previous.listen;
      if (
        !listeningRound ||
        listeningRound.draw.card.id !== cardId ||
        listeningRound.selectedAnswer !== null ||
        listeningRound.startedAt !== null
      ) {
        return previous;
      }

      return {
        ...previous,
        listen: {
          ...listeningRound,
          startedAt: performance.now(),
        },
      };
    });
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

  const submitAnswer = useCallback(
    (
      answer: AnswerValue,
      answeredWith: AnswerMode = "tap",
      answeredAt = performance.now(),
    ) => {
      const round = rounds[mode];
      const deck = decks[mode];
      if (!round || round.selectedAnswer !== null || !answerReady) {
        return;
      }

      const correct = answer === round.draw.card.answer;
      const elapsedMs =
        round.startedAt === null
          ? 0
          : Math.max(0, answeredAt - round.startedAt);
      deck.recordOutcome(round.draw.card, { correct, elapsedMs });

      if (mode === "listen") stopSpeaking();
      setRounds((previous) => ({
        ...previous,
        [mode]: {
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
        },
      }));
      playEarcon(correct);
    },
    [answerReady, decks, mode, playEarcon, rounds, stopSpeaking],
  );

  const handleAnswerModeChange = useCallback((nextMode: AnswerMode) => {
    setAnswerMode(nextMode);
  }, []);

  const advanceRound = useCallback(() => {
    const deck = decks[mode];

    stopSpeaking();
    const round = newRound(deck.next(), mode);
    setRounds((previous) => ({ ...previous, [mode]: round }));
    if (mode === "listen") speakQuestion(round);
  }, [decks, mode, speakQuestion, stopSpeaking]);

  const handleModeChange = useCallback(
    (nextMode: PracticeMode) => {
      if (nextMode === mode) return;
      const deck = decks[nextMode];

      stopSpeaking();
      modeRef.current = nextMode;
      setMode(nextMode);

      let targetRound = rounds[nextMode];
      if (!targetRound || targetRound.selectedAnswer !== null) {
        targetRound = newRound(deck.next(), nextMode);
      } else {
        targetRound = {
          ...targetRound,
          startedAt: nextMode === "visual" ? performance.now() : null,
        };
      }

      setRounds((previous) => ({
        ...previous,
        [nextMode]: targetRound,
      }));
      if (nextMode === "listen" && targetRound.selectedAnswer === null) {
        speakQuestion(targetRound);
      }
    },
    [decks, mode, rounds, speakQuestion, stopSpeaking],
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
    const listeningRound = rounds.listen;
    if (
      mode === "listen" &&
      listeningRound &&
      listeningRound.selectedAnswer === null
    ) {
      speakQuestion(listeningRound);
    }
  }, [
    ensureAudioContext,
    mode,
    narrationPlayer,
    rounds.listen,
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
    const timer = window.setTimeout(() => {
      setRounds({
        visual: newRound(decks.visual.next(), "visual"),
        listen: null,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [decks]);

  useEffect(() => {
    return () => {
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
        } else if (answerMode === "speak") {
          speechFocusRef.current?.focus();
        } else {
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

  const answerState = (answer: AnswerValue) => {
    if (!currentRound || currentRound.selectedAnswer === null) return "idle";
    if (answer === currentRound.selectedAnswer) {
      return currentRound.correct ? "correct" : "incorrect";
    }
    return "muted";
  };

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
            onClick={() => handleModeChange("visual")}
          >
            <CardsIcon />
            Cards
          </button>
          <button
            className={styles.modeButton}
            type="button"
            aria-pressed={mode === "listen"}
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
          <div className={styles.promptArea}>
            {!currentRound ? (
              <div className={styles.loadingCard} aria-label="Shuffling cards" />
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
                    <span className={styles.resultSymbol} aria-hidden="true">
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
            <nav className={styles.answerModeSwitch} aria-label="Answer input">
              <button
                className={styles.answerModeButton}
                type="button"
                aria-pressed={answerMode === "tap"}
                onClick={() => handleAnswerModeChange("tap")}
              >
                <TapIcon />
                Tap
              </button>
              <button
                className={styles.answerModeButton}
                type="button"
                aria-pressed={answerMode === "draw"}
                onClick={() => handleAnswerModeChange("draw")}
              >
                <DrawIcon />
                Draw
              </button>
              <button
                className={styles.answerModeButton}
                type="button"
                aria-pressed={answerMode === "speak"}
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
                    const selected = currentRound?.selectedAnswer === answer;
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
                  key={`${mode}:${currentRound?.draw.card.id ?? "loading"}`}
                  disabled={!answerReady}
                  focusRef={drawFocusRef}
                  onAnswer={(answer, answeredAt) =>
                    submitAnswer(answer, "draw", answeredAt)
                  }
                />
              ) : (
                <SpeechAnswer
                  key={`${mode}:${currentRound?.draw.card.id ?? "loading"}`}
                  disabled={!answerReady}
                  focusRef={speechFocusRef}
                  onBeforeListen={stopSpeaking}
                  onAnswer={(answer, answeredAt) =>
                    submitAnswer(answer, "speak", answeredAt)
                  }
                />
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
