"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  recognizeDigit,
  warmDigitRecognizer,
  type Digit,
  type DigitRecognition,
} from "./digit-recognition";
import {
  ADAPTIVE_HANDWRITING_SLOT_COUNT,
  adaptiveTypedAnswerIsReady,
  handwritingSlotsWithInk,
  normalizeAdaptiveTypedAnswer,
} from "./adaptive-handwriting-logic";
import styles from "./adaptive-handwriting.module.css";

export const ADAPTIVE_HANDWRITING_CONFIDENCE = 0.52;
export const ADAPTIVE_HANDWRITING_MARGIN = 0.1;

export type AdaptiveHandwritingDigitResult = Readonly<{
  index: number;
  digit: Digit;
  confidence: number;
  margin: number;
  reliable: boolean;
}>;

export type AdaptiveNumericAnswerSubmission = Readonly<{
  roundId: string;
  source: "handwriting" | "keyboard";
  value: number;
  rawValue: string;
  digitResults: readonly AdaptiveHandwritingDigitResult[];
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionConfirmedByChild: boolean | null;
  firstInkAt: number | null;
  firstInputAt: number | null;
  recognitionRequestedAt: number | null;
  recognizedAt: number | null;
  submittedAt: number;
  writingDurationMs: number | null;
  correctionCount: number;
}>;

export type AdaptiveRejectedRecognition = Readonly<{
  roundId: string;
  rawValue: string;
  value: number;
  digitResults: readonly AdaptiveHandwritingDigitResult[];
  firstInkAt: number | null;
  recognitionRequestedAt: number;
  recognizedAt: number;
  rejectedAt: number;
  correctionCount: number;
  reason: "child-rejected";
}>;

export type AdaptiveHandwritingInputProps = Readonly<{
  roundId: string;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
  className?: string;
  onAnswer(answer: AdaptiveNumericAnswerSubmission): void;
  onRejectedRecognition?(event: AdaptiveRejectedRecognition): void;
  onFirstInk?(timestamp: number): void;
}>;

type RecognitionPhase =
  | "idle"
  | "reading"
  | "confirming"
  | "complete"
  | "error";

type Point = Readonly<{ x: number; y: number }>;

type ActivePointer = Readonly<{
  canvasIndex: number;
  pointerId: number;
  lastPoint: Point;
}>;

type PendingRecognition = Readonly<{
  rawValue: string;
  value: number;
  digitResults: readonly AdaptiveHandwritingDigitResult[];
  requestedAt: number;
  recognizedAt: number;
}>;

const CANVAS_BACKGROUND = "#fffdf8";
const CANVAS_INK = "#17213d";

function now(): number {
  return Date.now();
}

function clearCanvasPixels(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = CANVAS_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function sizeCanvas(canvas: HTMLCanvasElement, preserveInk: boolean): void {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width === width && canvas.height === height) return;

  let snapshot: HTMLCanvasElement | null = null;
  if (preserveInk && canvas.width > 0 && canvas.height > 0) {
    snapshot = document.createElement("canvas");
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
  }

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = CANVAS_BACKGROUND;
  context.fillRect(0, 0, rect.width, rect.height);
  if (snapshot) {
    context.drawImage(
      snapshot,
      0,
      0,
      snapshot.width,
      snapshot.height,
      0,
      0,
      rect.width,
      rect.height,
    );
  }
}

function pointFromEvent(
  canvas: HTMLCanvasElement,
  event: React.PointerEvent<HTMLCanvasElement>,
): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function paintDot(canvas: HTMLCanvasElement, point: Point): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.fillStyle = CANVAS_INK;
  context.beginPath();
  context.arc(point.x, point.y, 8, 0, Math.PI * 2);
  context.fill();
}

function paintSegment(
  canvas: HTMLCanvasElement,
  from: Point,
  to: Point,
): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.strokeStyle = CANVAS_INK;
  context.lineWidth = 16;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function slotLabel(index: number): string {
  return index === 0 ? "Left writing box" : "Right writing box";
}

function recognitionResult(
  prediction: DigitRecognition,
  index: number,
): AdaptiveHandwritingDigitResult {
  return {
    index,
    digit: prediction.digit,
    confidence: prediction.confidence,
    margin: prediction.margin,
    reliable:
      prediction.confidence >= ADAPTIVE_HANDWRITING_CONFIDENCE &&
      prediction.margin >= ADAPTIVE_HANDWRITING_MARGIN,
  };
}

function minimumResultValue(
  results: readonly AdaptiveHandwritingDigitResult[],
  field: "confidence" | "margin",
): number | null {
  return results.length > 0
    ? Math.min(...results.map((result) => result[field]))
    : null;
}

/**
 * Answer-neutral one- or two-digit handwriting input backed by the existing
 * local MNIST recognizer. Every problem shows the same two writing boxes. A
 * child can use either box for one digit or both boxes, read left to right,
 * for two digits. Recognition never decides mathematical correctness. Every
 * reading requires child confirmation, and a native numeric input remains
 * available as the keyboard/non-fine-motor alternative.
 *
 * Mount a new `roundId` for each problem. The component clears all transient
 * ink, timing, and correction state when that identifier changes.
 */
export function AdaptiveHandwritingInput({
  roundId,
  disabled = false,
  autoFocus = false,
  label = "Write the answer",
  className,
  onAnswer,
  onRejectedRecognition,
  onFirstInk,
}: AdaptiveHandwritingInputProps) {
  const headingId = useId();
  const statusId = useId();
  const typedInputId = useId();
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const recognitionTokenRef = useRef(0);
  const firstInkAtRef = useRef<number | null>(null);
  const firstInputAtRef = useRef<number | null>(null);
  const correctionCountRef = useRef(0);
  const hasInkRef = useRef<boolean[]>(
    Array(ADAPTIVE_HANDWRITING_SLOT_COUNT).fill(false),
  );
  const [hasInk, setHasInk] = useState<boolean[]>(
    Array(ADAPTIVE_HANDWRITING_SLOT_COUNT).fill(false),
  );
  const [phase, setPhase] = useState<RecognitionPhase>("idle");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<PendingRecognition | null>(null);
  const [typedValue, setTypedValue] = useState("");
  const [recognizerReady, setRecognizerReady] = useState(false);

  const busy = phase === "reading" || phase === "confirming";
  const controlsDisabled = disabled || busy || phase === "complete";
  const handwritingAnswerReady = handwritingSlotsWithInk(hasInk).length > 0;
  const typedAnswerReady = adaptiveTypedAnswerIsReady(typedValue);

  const incrementCorrections = useCallback(() => {
    const next = correctionCountRef.current + 1;
    correctionCountRef.current = next;
    return next;
  }, []);

  const updateHasInk = useCallback(
    (index: number, value: boolean) => {
      const next = Array.from(
        { length: ADAPTIVE_HANDWRITING_SLOT_COUNT },
        (_, position) => hasInkRef.current[position] ?? false,
      );
      next[index] = value;
      hasInkRef.current = next;
      setHasInk(next);
    },
    [],
  );

  const clearAllInk = useCallback(() => {
    for (const canvas of canvasRefs.current.slice(
      0,
      ADAPTIVE_HANDWRITING_SLOT_COUNT,
    )) {
      if (canvas) clearCanvasPixels(canvas);
    }
    const next = Array(ADAPTIVE_HANDWRITING_SLOT_COUNT).fill(false) as boolean[];
    hasInkRef.current = next;
    setHasInk(next);
    activePointerRef.current = null;
  }, []);

  const resetForRound = useCallback(() => {
    recognitionTokenRef.current += 1;
    firstInkAtRef.current = null;
    firstInputAtRef.current = null;
    correctionCountRef.current = 0;
    clearAllInk();
    setTypedValue("");
    setPending(null);
    setPhase("idle");
    setStatus("");
  }, [clearAllInk]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      resetForRound();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resetForRound, roundId]);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const frame = window.requestAnimationFrame(() => {
      canvasRefs.current[0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, disabled, roundId]);

  useEffect(() => {
    let disposed = false;
    void warmDigitRecognizer()
      .then(() => {
        if (!disposed) setRecognizerReady(true);
      })
      .catch(() => {
        if (disposed) return;
        setRecognizerReady(false);
        setStatus("Handwriting reading is unavailable. You can type instead.");
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const observers: ResizeObserver[] = [];
    for (let index = 0; index < ADAPTIVE_HANDWRITING_SLOT_COUNT; index += 1) {
      const canvas = canvasRefs.current[index];
      if (!canvas) continue;
      sizeCanvas(canvas, hasInkRef.current[index] ?? false);
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          sizeCanvas(canvas, hasInkRef.current[index] ?? false);
        });
        observer.observe(canvas);
        observers.push(observer);
      }
    }
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [roundId]);

  useEffect(() => {
    return () => {
      recognitionTokenRef.current += 1;
    };
  }, []);

  const markFirstInk = useCallback(() => {
    if (firstInkAtRef.current !== null) return;
    const timestamp = now();
    firstInkAtRef.current = timestamp;
    onFirstInk?.(timestamp);
  }, [onFirstInk]);

  const handlePointerDown = (
    index: number,
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (controlsDisabled) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const point = pointFromEvent(canvas, event);
    markFirstInk();
    activePointerRef.current = {
      canvasIndex: index,
      pointerId: event.pointerId,
      lastPoint: point,
    };
    canvas.setPointerCapture(event.pointerId);
    paintDot(canvas, point);
    updateHasInk(index, true);
    if (phase === "error") setPhase("idle");
    setStatus("");
  };

  const handlePointerMove = (
    index: number,
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const active = activePointerRef.current;
    if (
      !active ||
      active.canvasIndex !== index ||
      active.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [
      event.nativeEvent,
    ];
    let previous = active.lastPoint;
    for (const sample of samples) {
      const rect = event.currentTarget.getBoundingClientRect();
      const point = {
        x: sample.clientX - rect.left,
        y: sample.clientY - rect.top,
      };
      paintSegment(event.currentTarget, previous, point);
      previous = point;
    }
    activePointerRef.current = { ...active, lastPoint: previous };
  };

  const finishPointer = (
    index: number,
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const active = activePointerRef.current;
    if (
      !active ||
      active.canvasIndex !== index ||
      active.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const point = pointFromEvent(event.currentTarget, event);
    paintSegment(event.currentTarget, active.lastPoint, point);
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelPointer = (
    index: number,
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const active = activePointerRef.current;
    if (
      active?.canvasIndex === index &&
      active.pointerId === event.pointerId
    ) {
      activePointerRef.current = null;
    }
  };

  const clearDigit = (index: number) => {
    if (controlsDisabled || !hasInkRef.current[index]) return;
    const canvas = canvasRefs.current[index];
    if (canvas) clearCanvasPixels(canvas);
    updateHasInk(index, false);
    incrementCorrections();
    setPending(null);
    setPhase("idle");
    setStatus(`${slotLabel(index)} cleared.`);
    canvas?.focus();
  };

  const clearEverything = () => {
    if (controlsDisabled) return;
    const hadResponse = hasInkRef.current.some(Boolean) || typedValue !== "";
    clearAllInk();
    setTypedValue("");
    setPending(null);
    setPhase("idle");
    setStatus(hadResponse ? "Answer cleared." : "");
    if (hadResponse) incrementCorrections();
    canvasRefs.current[0]?.focus();
  };

  const emitHandwritingAnswer = useCallback(
    (
      recognition: PendingRecognition,
      recognitionConfirmedByChild: boolean,
      submittedAt: number,
    ) => {
      const firstInkAt = firstInkAtRef.current;
      onAnswer({
        roundId,
        source: "handwriting",
        value: recognition.value,
        rawValue: recognition.rawValue,
        digitResults: recognition.digitResults,
        recognitionConfidence: minimumResultValue(
          recognition.digitResults,
          "confidence",
        ),
        recognitionMargin: minimumResultValue(
          recognition.digitResults,
          "margin",
        ),
        recognitionConfirmedByChild,
        firstInkAt,
        firstInputAt: firstInkAt,
        recognitionRequestedAt: recognition.requestedAt,
        recognizedAt: recognition.recognizedAt,
        submittedAt,
        writingDurationMs:
          firstInkAt === null ? null : Math.max(0, submittedAt - firstInkAt),
        correctionCount: correctionCountRef.current,
      });
    },
    [onAnswer, roundId],
  );

  const readAnswer = async () => {
    if (controlsDisabled || !handwritingAnswerReady) return;
    const requestedAt = now();
    const token = recognitionTokenRef.current + 1;
    recognitionTokenRef.current = token;
    setPhase("reading");
    setStatus("Reading your answer…");

    try {
      const activeSlotIndices = handwritingSlotsWithInk(hasInkRef.current);
      const images = activeSlotIndices.map((index) => {
        const canvas = canvasRefs.current[index];
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !context) {
          throw new Error("A handwriting canvas is unavailable.");
        }
        return context.getImageData(0, 0, canvas.width, canvas.height);
      });
      const predictions = await Promise.all(images.map(recognizeDigit));
      if (recognitionTokenRef.current !== token) return;
      const digitResults = predictions.map(recognitionResult);
      const rawValue = digitResults.map(({ digit }) => digit).join("");
      const recognition: PendingRecognition = {
        rawValue,
        value: Number(rawValue),
        digitResults,
        requestedAt,
        recognizedAt: now(),
      };
      setPending(recognition);
      setPhase("confirming");
      setStatus(`We read ${rawValue}. Is that what you wrote?`);
    } catch {
      if (recognitionTokenRef.current !== token) return;
      setPhase("error");
      setStatus("We couldn’t read that. You can rewrite it or type instead.");
    }
  };

  const confirmRecognition = () => {
    if (!pending || phase !== "confirming") return;
    const uncertain = pending.digitResults.some(({ reliable }) => !reliable);
    const submittedAt = uncertain ? now() : pending.recognizedAt;
    setPhase("complete");
    setStatus(`Confirmed as ${pending.rawValue}.`);
    emitHandwritingAnswer(pending, uncertain, submittedAt);
  };

  const rejectRecognition = () => {
    if (!pending || phase !== "confirming") return;
    const rejectedAt = now();
    const nextCorrectionCount = incrementCorrections();
    onRejectedRecognition?.({
      roundId,
      rawValue: pending.rawValue,
      value: pending.value,
      digitResults: pending.digitResults,
      firstInkAt: firstInkAtRef.current,
      recognitionRequestedAt: pending.requestedAt,
      recognizedAt: pending.recognizedAt,
      rejectedAt,
      correctionCount: nextCorrectionCount,
      reason: "child-rejected",
    });
    clearAllInk();
    setPending(null);
    setPhase("idle");
    setStatus("Okay. Write the answer again, or type it below.");
    window.requestAnimationFrame(() => canvasRefs.current[0]?.focus());
  };

  const handleTypedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = normalizeAdaptiveTypedAnswer(event.currentTarget.value);
    if (next && firstInputAtRef.current === null) {
      firstInputAtRef.current = now();
    }
    if (
      typedValue !== "" &&
      next !== typedValue &&
      (next.length <= typedValue.length || !next.startsWith(typedValue))
    ) {
      incrementCorrections();
    }
    setTypedValue(next);
    if (phase === "error") setPhase("idle");
    setStatus("");
  };

  const submitTypedAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (controlsDisabled || !typedAnswerReady) return;
    recognitionTokenRef.current += 1;
    const submittedAt = now();
    setPhase("complete");
    setStatus(`Typed answer ${typedValue} submitted.`);
    onAnswer({
      roundId,
      source: "keyboard",
      value: Number(typedValue),
      rawValue: typedValue,
      digitResults: [],
      recognitionConfidence: null,
      recognitionMargin: null,
      recognitionConfirmedByChild: null,
      firstInkAt: firstInkAtRef.current,
      firstInputAt: firstInputAtRef.current,
      recognitionRequestedAt: null,
      recognizedAt: null,
      submittedAt,
      writingDurationMs: null,
      correctionCount: correctionCountRef.current,
    });
  };

  return (
    <section
      className={`${styles.root}${className ? ` ${className}` : ""}`}
      aria-labelledby={headingId}
      data-phase={phase}
    >
      <div className={styles.headingRow}>
        <h3 id={headingId}>{label}</h3>
      </div>
      <p className={styles.guidance}>
        Use either box for one digit, or both boxes from left to right.
      </p>

      <div
        className={styles.canvasGrid}
        data-slot-count={ADAPTIVE_HANDWRITING_SLOT_COUNT}
        aria-describedby={statusId}
      >
        {Array.from({ length: ADAPTIVE_HANDWRITING_SLOT_COUNT }, (_, index) => (
          <div className={styles.digitField} key={index}>
            <span className={styles.digitLabel}>{slotLabel(index)}</span>
            <div className={styles.canvasFrame} data-has-ink={hasInk[index]}>
              <canvas
                ref={(node) => {
                  canvasRefs.current[index] = node;
                }}
                className={styles.canvas}
                tabIndex={controlsDisabled ? -1 : 0}
                role="img"
                aria-label={`${slotLabel(index)}. Draw with touch or pointer. Use either box for a one-digit answer, or both boxes from left to right for two digits. Type instead below for keyboard entry.`}
                data-disabled={controlsDisabled}
                onPointerDown={(event) => handlePointerDown(index, event)}
                onPointerMove={(event) => handlePointerMove(index, event)}
                onPointerUp={(event) => finishPointer(index, event)}
                onPointerCancel={(event) => cancelPointer(index, event)}
              />
              {!hasInk[index] ? (
                <span className={styles.canvasHint} aria-hidden="true">
                  0–9
                </span>
              ) : null}
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={controlsDisabled || !hasInk[index]}
              onClick={() => clearDigit(index)}
            >
              Clear {index === 0 ? "left" : "right"}
            </button>
          </div>
        ))}
      </div>

      <div className={styles.actionRow}>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={controlsDisabled || !handwritingAnswerReady}
          onClick={() => void readAnswer()}
        >
          {phase === "reading" ? "Reading…" : "Read answer"}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={controlsDisabled || (!hasInk.some(Boolean) && typedValue === "")}
          onClick={clearEverything}
        >
          Clear all
        </button>
      </div>

      <div
        className={styles.status}
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status || (!recognizerReady ? "Getting handwriting ready…" : " ")}
      </div>

      {phase === "confirming" && pending ? (
        <div className={styles.confirmation} role="group" aria-label="Confirm reading">
          <strong>We read {pending.rawValue}.</strong>
          <span>Is that what you wrote?</span>
          <div className={styles.confirmationActions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={confirmRecognition}
              autoFocus
            >
              Yes, that’s right
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={rejectRecognition}
            >
              Rewrite
            </button>
          </div>
        </div>
      ) : null}

      <form className={styles.keyboardFallback} onSubmit={submitTypedAnswer}>
        <label htmlFor={typedInputId}>Type instead</label>
        <div className={styles.keyboardControls}>
          <input
            id={typedInputId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={ADAPTIVE_HANDWRITING_SLOT_COUNT}
            value={typedValue}
            disabled={controlsDisabled}
            aria-describedby={statusId}
            onChange={handleTypedChange}
          />
          <button
            className={styles.secondaryButton}
            type="submit"
            disabled={controlsDisabled || !typedAnswerReady}
          >
            Submit typed answer
          </button>
        </div>
      </form>
    </section>
  );
}
