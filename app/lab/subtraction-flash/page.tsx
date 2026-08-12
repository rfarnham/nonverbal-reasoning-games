"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
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
  SUBTRACTION_LEVEL_CONFIG,
  SUBTRACTION_LEVELS,
  buildAnswerOptions,
  createSubtractionDeck,
  type AnswerValue,
  type DeckDraw,
  type PracticeMode,
  type SubmittedAnswer,
  type SubtractionDeck,
  type SubtractionLevel,
} from "./game-engine";
import {
  createDigitSpeechRecognition,
  getSpeechRecognitionConstructor,
  type BrowserSpeechRecognition,
  type BrowserSpeechRecognitionErrorCode,
  type SpokenAnswerMatch,
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
import { SpokenAnswerStreamGate } from "./speech-answer-stream";
import { AdaptiveSubtractionCurriculum } from "./adaptive-curriculum";
import { TraceAnswerGrid } from "./trace-answer";
import { FlashHandwriting } from "./flash-handwriting";
import {
  appendPerformanceAttempt,
  createPerformanceAttempt,
  createPerformanceSession,
  finishPerformanceSession,
  startPerformanceSession,
} from "./performance-storage";
import styles from "./subtraction-flash.module.css";

type AnswerMode = "tap" | "draw" | "trace" | "speak";
type SessionPhase = "choosing" | "playing" | "settling" | "results";
type SessionFinishReason = "manual" | "time" | "deck";
type SessionPauseReason = "hidden";

type AnswerInputSource =
  | "tap"
  | "keyboard"
  | "handwriting"
  | "trace"
  | "speech";

type AnswerEvidence = Readonly<{
  inputSource: AnswerInputSource;
  rawRecognition?: string | null;
  recognitionConfidence?: number | null;
  recognitionMargin?: number | null;
  recognitionProcessingMs?: number | null;
}>;

type SessionProgress = Readonly<{
  id: number;
  performanceSessionId: string | null;
  mode: SessionMode;
  level: SubtractionLevel;
  presentationMode: PracticeMode;
  answerMode: AnswerMode;
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
  level: SubtractionLevel;
  presentationMode: PracticeMode;
  answerMode: AnswerMode;
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
  selectedAnswer: SubmittedAnswer | null;
  correct: boolean | null;
  startedAt: number | null;
  answeredWith: AnswerMode | null;
  interpretation: string | null;
}>;

type ModeRounds = Record<PracticeMode, RoundState | null>;

const TAP_RESULT_FLASH_MS = 520;
const DRAW_RESULT_FLASH_MS = 900;

function createPerformanceSessionId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === "function"
    ? randomUUID.call(globalThis.crypto)
    : `flash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function epochMillisecondsFromPerformance(timestamp: number): number {
  return Math.max(0, Math.round(performance.timeOrigin + timestamp));
}

function resultFlashDuration(answeredWith: AnswerMode | null) {
  return answeredWith === "draw"
    ? DRAW_RESULT_FLASH_MS
    : TAP_RESULT_FLASH_MS;
}

function speechAnswerRoundId(
  sessionId: number,
  mode: PracticeMode,
  cardId: string,
) {
  return `${sessionId}:${mode}:${cardId}`;
}

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

function TraceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 18c2.6-7.4 4.3-12 7-12 2.2 0 2.7 2.9.9 5.2-1.7 2.2-4.8 3.7-3.3 6 1.4 2.2 4.8.1 6.5-2.5 1.4-2.1 2.7-1.6 3.4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="18" r="1.7" fill="currentColor" />
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

function AnalysisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 19V11m7 8V5m7 14v-6"
        stroke="currentColor"
        strokeWidth="2"
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

type NumericAnswerInputProps = Readonly<{
  digitCount: 1 | 2;
  disabled: boolean;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onAnswer(answer: number, source: "tap" | "keyboard"): void;
}>;

function NumericAnswerInput({
  digitCount,
  disabled,
  inputRef,
  onAnswer,
}: NumericAnswerInputProps) {
  const [value, setValue] = useState("");
  const hardwareKeyRef = useRef(false);

  const submit = (rawValue: string, source: "tap" | "keyboard") => {
    if (!/^\d{1,2}$/.test(rawValue)) return;
    onAnswer(Number(rawValue), source);
  };

  return (
    <input
      ref={inputRef}
      className={styles.numericAnswerInput}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      enterKeyHint="done"
      maxLength={digitCount}
      value={value}
      disabled={disabled}
      aria-label="Answer"
      onKeyDown={(event) => {
        hardwareKeyRef.current = true;
        if (event.key === "Enter") {
          event.preventDefault();
          submit(value, "keyboard");
        }
      }}
      onChange={(event) => {
        const next = event.currentTarget.value.replace(/\D/g, "").slice(0, digitCount);
        const source = hardwareKeyRef.current ? "keyboard" : "tap";
        hardwareKeyRef.current = false;
        setValue(next);
        if (next.length === digitCount) submit(next, source);
      }}
    />
  );
}

function ProblemWithAnswer({
  mode,
  round,
  answer,
}: Readonly<{
  mode: PracticeMode;
  round: RoundState;
  answer: ReactNode;
}>) {
  const { card } = round.draw;
  const accessibleProblem =
    card.orientation === "horizontal"
      ? `${card.minuend} minus ${card.subtrahend} equals. Enter the answer.`
      : `Vertical subtraction: ${card.minuend} minus ${card.subtrahend}. Enter the answer below the line.`;

  if (mode === "listen") {
    return (
      <div className={styles.listenAnswerOnly} aria-label="Enter the answer">
        {answer}
      </div>
    );
  }

  return (
    <div className={styles.liveProblem} aria-label={accessibleProblem}>
      <span className={styles.visuallyHidden}>{accessibleProblem}</span>
      {card.orientation === "horizontal" ? (
        <div className={styles.liveHorizontal}>
          <span aria-hidden="true">{card.minuend}</span>
          <span className={styles.liveOperator} aria-hidden="true">−</span>
          <span aria-hidden="true">{card.subtrahend}</span>
          <span className={styles.liveEquals} aria-hidden="true">=</span>
          {answer}
        </div>
      ) : (
        <div className={styles.liveVertical}>
          <div className={styles.liveVerticalOperands} aria-hidden="true">
            <span className={styles.liveVerticalTop}>{card.minuend}</span>
            <span className={styles.liveVerticalOperator}>−</span>
            <span className={styles.liveVerticalBottom}>{card.subtrahend}</span>
            <span className={styles.liveVerticalRule} />
          </div>
          {answer}
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
  onAnswer: (
    answer: AnswerValue,
    answeredAt: number,
    evidence: AnswerEvidence,
  ) => void;
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
              onAnswer(answer as AnswerValue, answeredAt, {
                inputSource: "handwriting",
                rawRecognition: String(answer),
                recognitionConfidence: prediction.confidence,
                recognitionMargin: prediction.margin,
                recognitionProcessingMs: Math.max(
                  0,
                  performance.now() - answeredAt,
                ),
              });
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
  accepting: boolean;
  active: boolean;
  answerGate: SpokenAnswerStreamGate;
  microphonePermission: MicrophonePermission;
  onAnswer: (match: SpokenAnswerMatch, answeredAt: number) => void;
  roundId: string | null;
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
    | "heard"
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
  accepting,
  active,
  answerGate,
  microphonePermission,
  onAnswer,
  roundId,
}: SpeechAnswerProps) {
  const acceptingRef = useRef(accepting);
  const onAnswerRef = useRef(onAnswer);
  const [retryNonce, setRetryNonce] = useState(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>({
    kind: "starting",
    message: "Starting…",
    transcript: null,
  });

  useEffect(() => {
    acceptingRef.current = accepting;
    answerGate.updateRound(roundId, accepting);
  }, [accepting, answerGate, roundId]);

  useEffect(() => {
    onAnswerRef.current = onAnswer;
  }, [onAnswer]);

  useEffect(() => {
    if (!accepting) return;
    if (!answerGate.peekBufferedAnswer()) return;

    const frame = requestAnimationFrame(() => {
      const bufferedAnswer = answerGate.takeBufferedAnswer();
      if (!bufferedAnswer) return;
      setSpeechState({
        kind: "heard",
        message: `Heard ${bufferedAnswer.answer}`,
        transcript: bufferedAnswer.transcript,
      });
      onAnswerRef.current(bufferedAnswer, performance.now());
    });
    return () => cancelAnimationFrame(frame);
  }, [accepting, answerGate, roundId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSupported(getSpeechRecognitionConstructor() !== null);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!active || !supported || microphonePermission !== "ready") return;

    let disposed = false;
    let fatal = false;
    let activeRecognition: BrowserSpeechRecognition | null = null;
    let recognitionToken = 0;
    let restartTimer: number | null = null;

    const detachRecognition = (recognition: BrowserSpeechRecognition) => {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onnomatch = null;
      recognition.onresult = null;
      recognition.onstart = null;
      recognition.onspeechend = null;
      recognition.onspeechstart = null;
    };

    const stopActiveRecognition = () => {
      recognitionToken += 1;
      const recognition = activeRecognition;
      activeRecognition = null;
      if (!recognition) return;
      detachRecognition(recognition);
      try {
        recognition.abort();
      } catch {
        // Some browser engines throw when an idle recognizer is aborted.
      }
    };

    let startRecognition: () => void = () => undefined;
    const scheduleRestart = () => {
      if (disposed || fatal || document.hidden || restartTimer !== null) return;
      restartTimer = window.setTimeout(() => {
        restartTimer = null;
        startRecognition();
      }, 80);
    };

    startRecognition = () => {
      if (disposed || fatal || document.hidden || activeRecognition) return;

      const recognition = createDigitSpeechRecognition();
      if (!recognition) {
        fatal = true;
        setSupported(false);
        setSpeechState({
          kind: "unsupported",
          message: "Speech unavailable",
          transcript: null,
        });
        return;
      }

      const token = recognitionToken + 1;
      recognitionToken = token;
      activeRecognition = recognition;
      answerGate.beginRecognitionSession();
      setSpeechState({
        kind: "starting",
        message: "Starting…",
        transcript: null,
      });

      recognition.onresult = (event) => {
        if (recognitionToken !== token) return;
        const match = answerGate.read(event);
        if (match) {
          setSpeechState({
            kind: "heard",
            message: `Heard ${match.answer}`,
            transcript: match.transcript,
          });
          onAnswerRef.current(match, performance.now());
          return;
        }

        if (!answerGate.isListeningForAnswer() || !acceptingRef.current) {
          return;
        }
        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const result = event.results.item(index);
          const transcript = result?.item(0)?.transcript.trim();
          if (!result?.isFinal || !transcript) continue;
          setSpeechState({
            kind: "listening",
            message: "Say one digit, 2–9",
            transcript,
          });
          break;
        }
      };

      recognition.onnomatch = () => {
        if (recognitionToken !== token || !acceptingRef.current) return;
        setSpeechState({
          kind: "listening",
          message: "Say one digit, 2–9",
          transcript: null,
        });
      };

      recognition.onerror = (event) => {
        if (recognitionToken !== token || event.error === "aborted") return;
        if (event.error === "no-speech") return;
        fatal = true;
        setSpeechState(speechErrorMessage(event.error));
      };

      recognition.onstart = () => {
        if (recognitionToken !== token) return;
        setSpeechState({
          kind: "listening",
          message: "Listening…",
          transcript: null,
        });
      };

      recognition.onspeechstart = () => {
        if (recognitionToken !== token) return;
        answerGate.speechStarted();
      };

      recognition.onspeechend = () => {
        if (recognitionToken !== token) return;
        answerGate.speechEnded();
      };

      recognition.onend = () => {
        if (recognitionToken !== token) return;
        detachRecognition(recognition);
        activeRecognition = null;
        scheduleRestart();
      };

      try {
        recognition.start();
      } catch {
        fatal = true;
        detachRecognition(recognition);
        activeRecognition = null;
        setSpeechState({
          kind: "retry",
          message: "Speech paused",
          transcript: null,
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (restartTimer !== null) {
          window.clearTimeout(restartTimer);
          restartTimer = null;
        }
        stopActiveRecognition();
        return;
      }
      startRecognition();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startRecognition();

    return () => {
      disposed = true;
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      stopActiveRecognition();
    };
  }, [
    active,
    answerGate,
    microphonePermission,
    retryNonce,
    supported,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSpeechState((previous) => {
        if (
          previous.kind === "blocked" ||
          previous.kind === "retry" ||
          previous.kind === "unsupported"
        ) {
          return previous;
        }
        return {
          kind: "listening",
          message: "Listening…",
          transcript: null,
        };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [roundId]);

  let visibleMessage = speechState.message;
  if (supported === false) visibleMessage = "Speech unavailable";
  if (!active && supported) visibleMessage = "Mic off";
  if (microphonePermission === "requesting") {
    visibleMessage = "Allow microphone";
  } else if (microphonePermission === "blocked") {
    visibleMessage = "Microphone blocked";
  } else if (microphonePermission === "unavailable") {
    visibleMessage = "No microphone";
  } else if (
    active &&
    speechState.kind === "listening" &&
    speechState.transcript === null
  ) {
    visibleMessage = accepting
      ? "Listening…"
      : "Mic on · wait for the question";
  }

  return (
    <div
      className={styles.speechSurface}
      data-speech-state={speechState.kind}
    >
      <div
        className={styles.micIndicator}
        data-listening={
          speechState.kind === "listening" && accepting
        }
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
        {speechState.kind === "retry" &&
        microphonePermission === "ready" ? (
          <button
            className={styles.micRetryButton}
            type="button"
            onClick={() => setRetryNonce((value) => value + 1)}
          >
            Try microphone again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function SubtractionFlashPage() {
  const [adaptiveOpen, setAdaptiveOpen] = useState(false);
  const [interactionReady, setInteractionReady] = useState(false);
  const [selectedLevel, setSelectedLevel] =
    useState<SubtractionLevel>("B100");
  const [mode, setMode] = useState<PracticeMode>("visual");
  const [answerMode, setAnswerMode] = useState<AnswerMode | null>(null);
  const [rounds, setRounds] = useState<ModeRounds>({
    visual: null,
    listen: null,
  });
  const [sessionPhase, setSessionPhase] =
    useState<SessionPhase>("choosing");
  const [sessionProgress, setSessionProgress] = useState<SessionProgress>({
    id: 0,
    performanceSessionId: null,
    mode: "infinite",
    level: "B100",
    presentationMode: "visual",
    answerMode: "tap",
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
  const [performanceSaveWarning, setPerformanceSaveWarning] = useState<
    string | null
  >(null);

  const modeRef = useRef<PracticeMode>("visual");
  const selectedLevelRef = useRef<SubtractionLevel>("B100");
  const selectedAnswerModeRef = useRef<AnswerMode | null>(null);
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
  const traceFocusRef = useRef<HTMLButtonElement | null>(null);
  const numericInputRef = useRef<HTMLInputElement | null>(null);
  const resultsDialogRef = useRef<HTMLDialogElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const firstSessionChoiceRef = useRef<HTMLButtonElement | null>(null);
  const answerButtonRefs = useRef<
    Partial<Record<AnswerValue, HTMLButtonElement | null>>
  >({});

  const [narrationPlayer] = useState(() =>
    createGameNarrationPlayer(SUBTRACTION_QUESTION_NARRATION),
  );
  const [speechAnswerGate] = useState(() => new SpokenAnswerStreamGate());

  const currentRound = rounds[mode];
  const activeLevel =
    sessionPhase === "choosing" ? selectedLevel : sessionProgress.level;
  const activeAnswerMode =
    sessionPhase === "choosing" ? answerMode : sessionProgress.answerMode;
  const answerOptions = currentRound
    ? currentRound.draw.card.level === "B100"
      ? buildAnswerOptions(currentRound.draw.card)
      : ANSWER_VALUES
    : ANSWER_VALUES;
  const answerReady =
    sessionPhase === "playing" &&
    sessionProgress.clock.runningSince !== null &&
    currentRound !== null &&
    currentRound.selectedAnswer === null &&
    !(activeAnswerMode === "speak" && microphonePermission === "requesting") &&
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

  const markListeningRoundReady = useCallback(
    (cardId: string) => {
      if (modeRef.current !== "listen") return;
      const previous = roundsRef.current;
      const listeningRound = previous.listen;
      if (
        !listeningRound ||
        listeningRound.draw.card.id !== cardId ||
        listeningRound.selectedAnswer !== null
      ) {
        return;
      }

      const roundId = speechAnswerRoundId(
        sessionIdRef.current,
        "listen",
        cardId,
      );
      if (listeningRound.startedAt !== null) {
        speechAnswerGate.updateRound(roundId, true);
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
      speechAnswerGate.updateRound(roundId, true);
      setRounds(nextRounds);
    },
    [speechAnswerGate],
  );

  const speakQuestion = useCallback(
    (round: RoundState) => {
      if (!soundEnabledRef.current || round.selectedAnswer !== null) return;

      const cueId = subtractionNarrationCueId(round.draw.card);
      speechAnswerGate.beginPrompt(
        speechAnswerRoundId(
          sessionIdRef.current,
          "listen",
          round.draw.card.id,
        ),
        SUBTRACTION_QUESTION_NARRATION.clips[cueId].transcript,
      );
      const playbackToken = playbackTokenRef.current + 1;
      playbackTokenRef.current = playbackToken;
      setIsQuestionSpeaking(true);
      narrationPlayer.prime();

      void narrationPlayer
        .play([cueId])
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
    [markListeningRoundReady, narrationPlayer, speechAnswerGate],
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
        level: progress.level,
        presentationMode: progress.presentationMode,
        answerMode: progress.answerMode,
        finishReason,
        elapsedMs: elapsed,
        answered: progress.answered,
        correct: progress.correct,
        slow: progress.slow,
        reviews: progress.reviews,
        baseDeckSize: progress.baseDeckSize,
      };

      if (progress.performanceSessionId) {
        const write = finishPerformanceSession(
          progress.performanceSessionId,
          {
            finishedAt: epochMillisecondsFromPerformance(now),
            finishReason,
            elapsedMs: elapsed,
            answered: progress.answered,
            correct: progress.correct,
            slow: progress.slow,
            reviews: progress.reviews,
            baseDeckSize: progress.baseDeckSize,
          },
        );
        if (!write.ok) {
          setPerformanceSaveWarning(
            "Performance data could not be saved on this device.",
          );
        }
      }

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
      answer: SubmittedAnswer,
      answeredWith: AnswerMode = "tap",
      answeredAt = performance.now(),
      evidence: AnswerEvidence = { inputSource: "tap" },
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
      const timingEligible = evidence.inputSource !== "trace";
      const answerWasSlow =
        timingEligible && answerElapsedMs > SLOW_RESPONSE_MS;
      const outcomeRecord = deck.recordOutcome(round.draw.card, {
        correct,
        elapsedMs: timingEligible ? answerElapsedMs : 0,
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
      if (progress.performanceSessionId) {
        try {
          const attempt = createPerformanceAttempt({
            sessionId: progress.performanceSessionId,
            occurredAt: epochMillisecondsFromPerformance(answeredAt),
            sessionPosition: progress.answered + 1,
            gameType: progress.mode,
            level: progress.level,
            presentationMode: activeMode,
            inputMode: progress.answerMode,
            orientation:
              activeMode === "visual" ? round.draw.card.orientation : null,
            inputSource: evidence.inputSource,
            cardId: round.draw.card.id,
            factKey: round.draw.card.factKey,
            minuend: round.draw.card.minuend,
            subtrahend: round.draw.card.subtrahend,
            expectedAnswer: round.draw.card.answer,
            submittedAnswer: answer,
            correct,
            elapsedMs: answerElapsedMs,
            slow: answerWasSlow,
            isReview: round.draw.card.isReview,
            reviewQueued: outcomeRecord.flagged,
            reinserted: outcomeRecord.reinserted,
            outcomeReason: outcomeRecord.reason,
            drawNumber: round.draw.drawNumber,
            cycle: round.draw.cycle,
            cardsRemainingAfter: deckSnapshot.remaining,
            sessionElapsedMs: activeElapsedMs,
            rawRecognition: evidence.rawRecognition ?? null,
            recognitionConfidence:
              evidence.recognitionConfidence ?? null,
            recognitionMargin: evidence.recognitionMargin ?? null,
            recognitionProcessingMs:
              evidence.recognitionProcessingMs ?? null,
          });
          const write = appendPerformanceAttempt(attempt);
          if (!write.ok) {
            setPerformanceSaveWarning(
              "Performance data could not be saved on this device.",
            );
          }
        } catch {
          setPerformanceSaveWarning(
            "Performance data could not be saved on this device.",
          );
        }
      } else {
        setPerformanceSaveWarning(
          "Performance data could not be saved on this device.",
        );
      }

      const nextProgress: SessionProgress = {
        ...progress,
        answered: progress.answered + 1,
        correct: progress.correct + (correct ? 1 : 0),
        slow: progress.slow + (answerWasSlow ? 1 : 0),
        reviews: progress.reviews + (round.draw.card.isReview ? 1 : 0),
        cardsRemaining: deckSnapshot.remaining,
      };
      replaceSessionProgress(nextProgress);

      if (activeMode === "listen") stopSpeaking();
      if (answeredWith !== "speak") playEarcon(correct);

      const feedbackDelay = resultFlashDuration(answeredWith);
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
      if (sessionPhaseRef.current !== "choosing") return;
      if (selectedLevelRef.current === "B120" && nextMode === "trace") return;
      if (nextMode === "speak") primeMicrophonePermission();
      selectedAnswerModeRef.current = nextMode;
      setAnswerMode(nextMode);
    },
    [primeMicrophonePermission],
  );

  const handleLevelChange = useCallback(
    (nextLevel: SubtractionLevel) => {
      if (
        nextLevel === selectedLevelRef.current ||
        sessionPhaseRef.current !== "choosing"
      ) {
        return;
      }
      selectedLevelRef.current = nextLevel;
      setSelectedLevel(nextLevel);
      if (nextLevel === "B120") {
        if (modeRef.current === "listen") {
          modeRef.current = "visual";
          setMode("visual");
        }
        if (selectedAnswerModeRef.current === "trace") {
          selectedAnswerModeRef.current = null;
          setAnswerMode(null);
        }
      }
      const emptyRounds: ModeRounds = { visual: null, listen: null };
      roundsRef.current = emptyRounds;
      setRounds(emptyRounds);
    },
    [],
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
      const chosenAnswerMode = selectedAnswerModeRef.current;
      const chosenLevel = selectedLevelRef.current;
      if (!chosenAnswerMode) return;
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
      stopSpeaking();

      const activeMode = modeRef.current;
      if (chosenLevel === "B120" && activeMode === "listen") return;
      const now = performance.now();
      const pauseReasons = pauseReasonsRef.current;
      pauseReasons.clear();
      if (document.hidden) pauseReasons.add("hidden");

      const deck = createSubtractionDeck({
        mode: activeMode,
        level: chosenLevel,
        repeat: sessionMode !== "deck-sprint",
      });
      const firstDraw = deck.next();
      const nextId = sessionIdRef.current + 1;
      const performanceSessionId = createPerformanceSessionId();
      sessionIdRef.current = nextId;
      const progress: SessionProgress = {
        id: nextId,
        performanceSessionId,
        mode: sessionMode,
        level: chosenLevel,
        presentationMode: activeMode,
        answerMode: chosenAnswerMode,
        clock: createSessionClock(now, pauseReasons.size === 0),
        answered: 0,
        correct: 0,
        slow: 0,
        reviews: 0,
        baseDeckSize: firstDraw.baseDeckSize,
        cardsRemaining: firstDraw.remaining + 1,
      };

      try {
        const session = createPerformanceSession({
          sessionId: performanceSessionId,
          gameType: sessionMode,
          level: chosenLevel,
          presentationMode: activeMode,
          inputMode: chosenAnswerMode,
          baseDeckSize: firstDraw.baseDeckSize,
          startedAt: epochMillisecondsFromPerformance(now),
        });
        const write = startPerformanceSession(session);
        setPerformanceSaveWarning(
          write.ok
            ? null
            : "Performance data could not be saved on this device.",
        );
      } catch {
        setPerformanceSaveWarning(
          "Performance data could not be saved on this device.",
        );
      }
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

      if (chosenAnswerMode === "speak") primeMicrophonePermission();
      if (activeMode === "listen" && soundEnabledRef.current) {
        speakQuestion(round);
      }
    },
    [
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
        sessionPhaseRef.current !== "choosing" ||
        (selectedLevelRef.current === "B120" && nextMode === "listen")
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
    const frame = requestAnimationFrame(() => setInteractionReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

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
        if (activeAnswerMode === "draw") {
          drawFocusRef.current?.focus();
        } else if (activeAnswerMode === "trace") {
          traceFocusRef.current?.focus({ preventScroll: true });
        } else if (activeAnswerMode === "tap") {
          numericInputRef.current?.focus({ preventScroll: true });
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [
    activeAnswerMode,
    answerReady,
    currentRound,
    mode,
    sessionProgress.id,
  ]);

  useEffect(() => {
    if (!currentRound || currentRound.selectedAnswer === null) return;

    const answeredMode = mode;
    const timer = window.setTimeout(() => {
      if (modeRef.current === answeredMode) {
        advanceRound();
      }
    }, resultFlashDuration(currentRound.answeredWith));
    return () => window.clearTimeout(timer);
  }, [advanceRound, currentRound, mode]);

  useEffect(() => {
    if (sessionPhase !== "playing" || sessionProgress.mode !== "infinite") {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || sessionProgressRef.current.answered === 0) {
        return;
      }
      event.preventDefault();
      finishSession("manual");
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [finishSession, sessionPhase, sessionProgress.mode]);

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

      if (sessionProgressRef.current.answerMode !== "trace") return;
      const answer = Number(event.key);
      if (!ANSWER_VALUES.includes(answer as (typeof ANSWER_VALUES)[number])) return;
      event.preventDefault();
      submitAnswer(
        answer as AnswerValue,
        "trace",
        performance.now(),
        { inputSource: "keyboard" },
      );
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

  const liveAnswer = currentRound ? (
    <div
      className={styles.liveAnswerSlot}
      data-state={
        currentRound.correct === true
          ? "correct"
          : currentRound.correct === false
            ? "incorrect"
            : "idle"
      }
    >
      {activeAnswerMode === "tap" ? (
        <NumericAnswerInput
          key={`${sessionProgress.id}:${currentRound.draw.card.id}`}
          digitCount={SUBTRACTION_LEVEL_CONFIG[activeLevel].answerDigits}
          disabled={!answerReady}
          inputRef={numericInputRef}
          onAnswer={(answer, source) =>
            submitAnswer(answer, "tap", performance.now(), {
              inputSource: source,
            })
          }
        />
      ) : activeAnswerMode === "draw" ? (
        <FlashHandwriting
          key={`${sessionProgress.id}:${currentRound.draw.card.id}`}
          digitCount={SUBTRACTION_LEVEL_CONFIG[activeLevel].answerDigits}
          disabled={!answerReady}
          focusRef={drawFocusRef}
          roundId={currentRound.draw.card.id}
          onAnswer={(answer, answeredAt, evidence) =>
            submitAnswer(answer, "draw", answeredAt, {
              inputSource: "handwriting",
              ...evidence,
            })
          }
        />
      ) : activeAnswerMode === "trace" ? (
        <TraceAnswerGrid
          key={`${sessionProgress.id}:${currentRound.draw.card.id}`}
          answers={answerOptions}
          disabled={!answerReady}
          focusRef={traceFocusRef}
          selectedAnswer={
            currentRound.selectedAnswer !== null &&
            ANSWER_VALUES.some(
              (answer) => answer === currentRound.selectedAnswer,
            )
              ? (currentRound.selectedAnswer as AnswerValue)
              : null
          }
          selectedAnswerWasCorrect={currentRound.correct}
          onAnswer={(answer, answeredAt, source) =>
            submitAnswer(answer, "trace", answeredAt, {
              inputSource: source,
            })
          }
        />
      ) : (
        <SpeechAnswer
          key={`${sessionProgress.id}:${mode}`}
          accepting={answerReady}
          active={
            sessionPhase === "playing" &&
            (mode !== "listen" || soundEnabled)
          }
          answerGate={speechAnswerGate}
          microphonePermission={microphonePermission}
          onAnswer={(match, answeredAt) =>
            submitAnswer(match.answer, "speak", answeredAt, {
              inputSource: "speech",
              rawRecognition: match.transcript,
              recognitionConfidence: match.confidence,
            })
          }
          roundId={speechAnswerRoundId(
            sessionProgress.id,
            mode,
            currentRound.draw.card.id,
          )}
        />
      )}
      {currentRound.correct !== null ? (
        <span className={styles.liveVerdict} aria-hidden="true">
          {currentRound.correct ? "✓" : "×"}
        </span>
      ) : null}
    </div>
  ) : null;

  if (sessionPhase === "playing" || sessionPhase === "settling") {
    return (
      <main className={styles.livePage}>
        {currentRound && liveAnswer ? (
          <ProblemWithAnswer
            mode={sessionProgress.presentationMode}
            round={currentRound}
            answer={liveAnswer}
          />
        ) : null}
        <span
          className={styles.visuallyHidden}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {currentRound?.correct === true
            ? "Correct"
            : currentRound?.correct === false
              ? "Incorrect"
              : ""}
        </span>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/" aria-label="All games">
          <ArrowLeftIcon />
        </Link>

        {adaptiveOpen ? (
          <div className={styles.adaptiveModeLabel}>Adaptive practice</div>
        ) : (
          <nav className={styles.levelSwitch} aria-label="Level">
            {SUBTRACTION_LEVELS.map((level) => (
              <button
                key={level}
                className={styles.levelButton}
                type="button"
                aria-pressed={selectedLevel === level}
                disabled={!interactionReady}
                onClick={() => handleLevelChange(level)}
              >
                {level}
              </button>
            ))}
          </nav>
        )}

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
          data-session-active={
            !adaptiveOpen && sessionPhase !== "choosing"
          }
          aria-labelledby="game-heading"
        >
          <h1 className={styles.visuallyHidden} id="game-heading">
            Borrow Flash
          </h1>
          {adaptiveOpen ? (
            <AdaptiveSubtractionCurriculum
              soundEnabled={soundEnabled}
              onFeedback={playEarcon}
              onExit={() => setAdaptiveOpen(false)}
            />
          ) : sessionPhase === "choosing" ? (
            <section
              className={styles.sessionChooser}
              aria-labelledby="session-choice-heading"
            >
              <div className={styles.sessionChoiceHeading}>
                <span>{selectedLevel}</span>
                <h2 id="session-choice-heading">Set up a run</h2>
              </div>
              <div className={styles.setupControls}>
                <fieldset className={styles.setupGroup}>
                  <legend>Question</legend>
                  <div className={styles.setupOptions}>
                    <button
                      className={styles.setupOption}
                      type="button"
                      aria-pressed={mode === "visual"}
                      disabled={!interactionReady}
                      onClick={() => handleModeChange("visual")}
                    >
                      <CardsIcon />
                      Cards
                    </button>
                    <button
                      className={styles.setupOption}
                      type="button"
                      aria-pressed={mode === "listen"}
                      disabled={!interactionReady || selectedLevel === "B120"}
                      onClick={() => handleModeChange("listen")}
                    >
                      <SpeakerIcon />
                      Listen
                    </button>
                  </div>
                </fieldset>
                <fieldset className={styles.setupGroup}>
                  <legend>Answer</legend>
                  <div className={styles.setupOptions}>
                    <button
                      className={styles.setupOption}
                      type="button"
                      aria-pressed={answerMode === "tap"}
                      disabled={!interactionReady}
                      onClick={() => handleAnswerModeChange("tap")}
                    >
                      <TapIcon />
                      Type
                    </button>
                    <button
                      className={styles.setupOption}
                      type="button"
                      aria-pressed={answerMode === "draw"}
                      disabled={!interactionReady}
                      onClick={() => handleAnswerModeChange("draw")}
                    >
                      <DrawIcon />
                      Draw
                    </button>
                    <button
                      className={styles.setupOption}
                      type="button"
                      aria-pressed={answerMode === "trace"}
                      disabled={!interactionReady || selectedLevel === "B120"}
                      onClick={() => handleAnswerModeChange("trace")}
                    >
                      <TraceIcon />
                      Trace
                    </button>
                    <button
                      className={styles.setupOption}
                      type="button"
                      aria-pressed={answerMode === "speak"}
                      disabled={!interactionReady}
                      onClick={() => handleAnswerModeChange("speak")}
                    >
                      <MicIcon />
                      Speak
                    </button>
                  </div>
                </fieldset>
              </div>
              <div className={styles.sessionChoiceGrid}>
                {SESSION_MODES.map((sessionMode, index) => (
                  <button
                    key={sessionMode}
                    ref={index === 0 ? firstSessionChoiceRef : undefined}
                    className={styles.sessionChoice}
                    type="button"
                    disabled={!interactionReady || answerMode === null}
                    onClick={() => beginSession(sessionMode)}
                  >
                    <strong>{SESSION_LABELS[sessionMode]}</strong>
                    <span>{SESSION_DESCRIPTIONS[sessionMode]}</span>
                  </button>
                ))}
                <button
                  className={`${styles.sessionChoice} ${styles.adaptiveSessionChoice}`}
                  type="button"
                  disabled={!interactionReady}
                  onClick={() => setAdaptiveOpen(true)}
                >
                  <strong>Adaptive practice</strong>
                  <span>
                    A short, finite mix that finds the next useful step
                  </span>
                </button>
              </div>
              <Link
                className={styles.analysisLink}
                href="/lab/subtraction-flash/analysis/"
              >
                <AnalysisIcon />
                Analyze results
              </Link>
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
                      disabled={sessionProgress.answered === 0}
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
                  <ProblemWithAnswer
                    mode="visual"
                    round={currentRound}
                    answer={<span />}
                  />
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
                    disabled
                    onClick={() => handleAnswerModeChange("tap")}
                  >
                    <TapIcon />
                    Tap
                  </button>
                  <button
                    className={styles.answerModeButton}
                    type="button"
                    aria-pressed={answerMode === "draw"}
                    disabled
                    onClick={() => handleAnswerModeChange("draw")}
                  >
                    <DrawIcon />
                    Draw
                  </button>
                  <button
                    className={styles.answerModeButton}
                    type="button"
                    aria-pressed={answerMode === "trace"}
                    disabled
                    onClick={() => handleAnswerModeChange("trace")}
                  >
                    <TraceIcon />
                    Trace
                  </button>
                  <button
                    className={styles.answerModeButton}
                    type="button"
                    aria-pressed={answerMode === "speak"}
                    disabled
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
                            onClick={(event) =>
                              submitAnswer(
                                answer,
                                "tap",
                                performance.now(),
                                {
                                  inputSource:
                                    event.detail === 0 ? "keyboard" : "tap",
                                },
                              )
                            }
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
                      onAnswer={(answer, answeredAt, evidence) =>
                        submitAnswer(answer, "draw", answeredAt, evidence)
                      }
                    />
                  ) : answerMode === "trace" ? (
                    <TraceAnswerGrid
                      key={`${sessionProgress.id}:${mode}:${
                        currentRound?.draw.card.id ?? "loading"
                      }`}
                      answers={answerOptions}
                      disabled={!answerReady}
                      focusRef={traceFocusRef}
                      selectedAnswer={
                        currentRound?.selectedAnswer !== null &&
                        currentRound?.selectedAnswer !== undefined &&
                        ANSWER_VALUES.some(
                          (answer) =>
                            answer === currentRound.selectedAnswer,
                        )
                          ? (currentRound.selectedAnswer as AnswerValue)
                          : null
                      }
                      selectedAnswerWasCorrect={
                        currentRound?.correct ?? null
                      }
                      onAnswer={(answer, answeredAt, source) =>
                        submitAnswer(answer, "trace", answeredAt, {
                          inputSource: source,
                        })
                      }
                    />
                  ) : (
                    <SpeechAnswer
                      key={`${sessionProgress.id}:${mode}`}
                      accepting={answerReady}
                      active={
                        mode !== "listen" || soundEnabled
                      }
                      answerGate={speechAnswerGate}
                      microphonePermission={microphonePermission}
                      onAnswer={(match, answeredAt) =>
                        submitAnswer(match.answer, "speak", answeredAt, {
                          inputSource: "speech",
                          rawRecognition: match.transcript,
                          recognitionConfidence: match.confidence,
                        })
                      }
                      roundId={
                        currentRound
                          ? speechAnswerRoundId(
                              sessionProgress.id,
                              mode,
                              currentRound.draw.card.id,
                            )
                          : null
                      }
                    />
                  )}
                </div>
              </section>
            </>
          )}
        </section>
        {performanceSaveWarning ? (
          <p className={styles.storageWarning} role="status">
            {performanceSaveWarning}
          </p>
        ) : null}
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
            {performanceSaveWarning ? (
              <p className={styles.storageWarning} role="status">
                {performanceSaveWarning}
              </p>
            ) : null}
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
            <Link
              className={`${styles.analysisLink} ${styles.resultsAnalysisLink}`}
              href="/lab/subtraction-flash/analysis/"
            >
              <AnalysisIcon />
              Analyze results
            </Link>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
