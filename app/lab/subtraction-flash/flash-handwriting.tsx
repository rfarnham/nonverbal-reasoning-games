"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { recognizeDigit, warmDigitRecognizer } from "./digit-recognition";
import styles from "./flash-handwriting.module.css";

type Point = Readonly<{ x: number; y: number }>;

type ActivePointer = Readonly<{
  canvasIndex: number;
  pointerId: number;
  lastPoint: Point;
}>;

export type FlashHandwritingEvidence = Readonly<{
  rawRecognition: string;
  recognitionConfidence: number;
  recognitionMargin: number;
  recognitionProcessingMs: number;
  recognitionStatus: "accepted" | "confirmed" | "corrected";
  confirmedAnswer: number | null;
}>;

export type FlashHandwritingRejectedRecognition = Readonly<{
  rawRecognition: string | null;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionProcessingMs: number;
}>;

export type FlashHandwritingProps = Readonly<{
  digitCount: 1 | 2 | 3;
  entryMode?: "exact-slots" | "right-aligned";
  rejectedRecognitionMode?: "clear" | "confirm";
  disabled: boolean;
  focusRef: MutableRefObject<HTMLCanvasElement | null>;
  roundId: string;
  onAnswer(
    answer: number,
    answeredAt: number,
    evidence: FlashHandwritingEvidence,
  ): void;
  onRecognitionRejected?(
    evidence: FlashHandwritingRejectedRecognition,
  ): void;
}>;

const BACKGROUND = "#fffdf8";
const INK = "#17213d";
const CONFIDENCE_MINIMUM = 0.52;
const MARGIN_MINIMUM = 0.1;
const READ_DELAY_MS = 560;

const PLACE_LABELS: Readonly<Record<1 | 2 | 3, readonly string[]>> = {
  1: ["Ones"],
  2: ["Tens", "Ones"],
  3: ["Hundreds", "Tens", "Ones"],
};

export function handwritingRecognitionSlots(
  digitCount: 1 | 2 | 3,
  hasInk: readonly boolean[],
  entryMode: "exact-slots" | "right-aligned",
): readonly number[] | null {
  const occupied = Array.from(
    { length: digitCount },
    (_, index) => Boolean(hasInk[index]),
  );
  if (entryMode === "exact-slots") {
    return occupied.every(Boolean)
      ? occupied.map((_, index) => index)
      : null;
  }
  if (!occupied.at(-1)) return null;
  const firstOccupied = occupied.indexOf(true);
  if (
    firstOccupied < 0 ||
    !occupied.slice(firstOccupied).every(Boolean)
  ) {
    return null;
  }
  return Array.from(
    { length: digitCount - firstOccupied },
    (_, index) => firstOccupied + index,
  );
}

function handwritingEntryGuidance(
  digitCount: 1 | 2 | 3,
  entryMode: "exact-slots" | "right-aligned",
): string {
  return entryMode === "right-aligned" && digitCount > 1
    ? "Use the rightmost boxes"
    : "";
}

function clearPixels(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = BACKGROUND;
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
  context.fillStyle = BACKGROUND;
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
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function paintDot(canvas: HTMLCanvasElement, point: Point): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.fillStyle = INK;
  context.beginPath();
  context.arc(point.x, point.y, 10, 0, Math.PI * 2);
  context.fill();
}

function paintSegment(canvas: HTMLCanvasElement, from: Point, to: Point): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.strokeStyle = INK;
  context.lineWidth = 20;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

export function FlashHandwriting({
  digitCount,
  entryMode = "exact-slots",
  rejectedRecognitionMode = "clear",
  disabled,
  focusRef,
  roundId,
  onAnswer,
  onRecognitionRejected,
}: FlashHandwritingProps) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const hasInkRef = useRef([false, false, false]);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);
  const recognitionTokenRef = useRef(0);
  const disabledRef = useRef(disabled);
  const answeredAtRef = useRef(0);
  const [hasInk, setHasInk] = useState([false, false, false]);
  const [readout, setReadout] = useState<string | null>(null);
  const [pendingRecognition, setPendingRecognition] =
    useState<FlashHandwritingRejectedRecognition | null>(null);
  const [editingRecognition, setEditingRecognition] = useState(false);
  const [correctionValue, setCorrectionValue] = useState("");
  const correctionInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState(
    handwritingEntryGuidance(digitCount, entryMode),
  );

  const cancelRecognition = useCallback(() => {
    recognitionTokenRef.current += 1;
    if (recognitionTimerRef.current !== null) {
      window.clearTimeout(recognitionTimerRef.current);
      recognitionTimerRef.current = null;
    }
  }, []);

  const clearAll = useCallback(() => {
    cancelRecognition();
    for (const canvas of canvasRefs.current) {
      if (canvas) clearPixels(canvas);
    }
    hasInkRef.current = [false, false, false];
    setHasInk([false, false, false]);
    setReadout(null);
    setPendingRecognition(null);
    setEditingRecognition(false);
    setCorrectionValue("");
    setStatus(handwritingEntryGuidance(digitCount, entryMode));
    activePointerRef.current = null;
    canvasRefs.current[0]?.focus();
  }, [cancelRecognition, digitCount, entryMode]);

  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) cancelRecognition();
  }, [cancelRecognition, disabled]);

  useEffect(() => {
    void warmDigitRecognizer().catch(() => {
      setStatus("Handwriting unavailable");
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => clearAll());
    return () => window.cancelAnimationFrame(frame);
  }, [clearAll, roundId]);

  useEffect(() => {
    const observers: ResizeObserver[] = [];
    for (let index = 0; index < digitCount; index += 1) {
      const canvas = canvasRefs.current[index];
      if (!canvas) continue;
      sizeCanvas(canvas, hasInkRef.current[index] ?? false);
      if (typeof ResizeObserver === "undefined") continue;
      const observer = new ResizeObserver(() =>
        sizeCanvas(canvas, hasInkRef.current[index] ?? false),
      );
      observer.observe(canvas);
      observers.push(observer);
    }
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [digitCount, roundId]);

  useEffect(() => () => cancelRecognition(), [cancelRecognition]);

  useEffect(() => {
    if (!editingRecognition) return;
    const frame = window.requestAnimationFrame(() =>
      correctionInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [editingRecognition]);

  const confirmRecognition = useCallback(
    (confirmed: string) => {
      const pending = pendingRecognition;
      if (
        !pending ||
        pending.rawRecognition === null ||
        !/^(0|[1-9]\d{0,2})$/.test(confirmed)
      ) {
        setStatus("Use 0 by itself, or enter up to three digits");
        return;
      }
      const answer = Number(confirmed);
      const recognitionStatus =
        confirmed === pending.rawRecognition ? "confirmed" : "corrected";
      setReadout(confirmed);
      setPendingRecognition(null);
      setEditingRecognition(false);
      setStatus(`Read ${confirmed}`);
      onAnswer(answer, answeredAtRef.current, {
        rawRecognition: pending.rawRecognition,
        recognitionConfidence: pending.recognitionConfidence ?? 0,
        recognitionMargin: pending.recognitionMargin ?? 0,
        recognitionProcessingMs: pending.recognitionProcessingMs,
        recognitionStatus,
        confirmedAnswer: answer,
      });
    },
    [onAnswer, pendingRecognition],
  );

  const recognizeAnswer = useCallback(() => {
    cancelRecognition();
    const slots = handwritingRecognitionSlots(
      digitCount,
      hasInkRef.current,
      entryMode,
    );
    if (!slots) {
      if (entryMode === "right-aligned") {
        const occupied = hasInkRef.current.slice(0, digitCount);
        setStatus(
          occupied.at(-1)
            ? "Keep the written digits together"
            : "Finish in the Ones box",
        );
      }
      return;
    }

    const token = recognitionTokenRef.current;
    recognitionTimerRef.current = window.setTimeout(() => {
      recognitionTimerRef.current = null;
      if (disabledRef.current) return;
      const startedAt = performance.now();
      setStatus("Reading…");
      void Promise.resolve()
        .then(() => {
          const images = slots.map((index) => {
            const canvas = canvasRefs.current[index];
            const context = canvas?.getContext("2d", {
              willReadFrequently: true,
            });
            if (!canvas || !context) {
              throw new Error("Drawing field unavailable");
            }
            return context.getImageData(0, 0, canvas.width, canvas.height);
          });
          return Promise.all(images.map(recognizeDigit));
        })
        .then((predictions) => {
          if (recognitionTokenRef.current !== token || disabledRef.current) {
            return;
          }
          const raw = predictions.map(({ digit }) => digit).join("");
          const confidence = Math.min(
            ...predictions.map(({ confidence: value }) => value),
          );
          const margin = Math.min(
            ...predictions.map(({ margin: value }) => value),
          );
          if (
            confidence < CONFIDENCE_MINIMUM ||
            margin < MARGIN_MINIMUM ||
            (rejectedRecognitionMode === "confirm" && /^0\d/.test(raw))
          ) {
            const rejected = {
              rawRecognition: raw,
              recognitionConfidence: confidence,
              recognitionMargin: margin,
              recognitionProcessingMs: Math.max(
                0,
                performance.now() - startedAt,
              ),
            } satisfies FlashHandwritingRejectedRecognition;
            onRecognitionRejected?.(rejected);
            if (rejectedRecognitionMode === "confirm") {
              setPendingRecognition(rejected);
              setCorrectionValue(raw);
              setReadout(raw);
              setStatus(
                /^(0|[1-9]\d{0,2})$/.test(raw)
                  ? `We read ${raw}. Is that right?`
                  : "Remove the first 0, then press Done",
              );
              return;
            }
            clearAll();
            setStatus("Couldn’t read that · draw it again");
            return;
          }
          setReadout(raw);
          setStatus(`Read ${raw}`);
          onAnswer(Number(raw), answeredAtRef.current, {
            rawRecognition: raw,
            recognitionConfidence: confidence,
            recognitionMargin: margin,
            recognitionProcessingMs: Math.max(
              0,
              performance.now() - startedAt,
            ),
            recognitionStatus: "accepted",
            confirmedAnswer: null,
          });
        })
        .catch(() => {
          if (recognitionTokenRef.current !== token) return;
          onRecognitionRejected?.({
            rawRecognition: null,
            recognitionConfidence: null,
            recognitionMargin: null,
            recognitionProcessingMs: Math.max(
              0,
              performance.now() - startedAt,
            ),
          });
          clearAll();
          setStatus("Couldn’t read that · draw it again");
        });
    }, READ_DELAY_MS);
  }, [
    cancelRecognition,
    clearAll,
    digitCount,
    entryMode,
    onAnswer,
    onRecognitionRejected,
    rejectedRecognitionMode,
  ]);

  const beginStroke = (
    index: number,
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (disabled || !event.isPrimary) return;
    event.preventDefault();
    cancelRecognition();
    setReadout(null);
    setPendingRecognition(null);
    setEditingRecognition(false);
    setStatus("");
    const point = pointFromEvent(event.currentTarget, event);
    activePointerRef.current = {
      canvasIndex: index,
      pointerId: event.pointerId,
      lastPoint: point,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    paintDot(event.currentTarget, point);
    const next = [...hasInkRef.current];
    next[index] = true;
    hasInkRef.current = next;
    setHasInk(next);
  };

  const moveStroke = (
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
    let previous = active.lastPoint;
    for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? [
      event.nativeEvent,
    ]) {
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

  const finishStroke = (
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
    paintSegment(
      event.currentTarget,
      active.lastPoint,
      pointFromEvent(event.currentTarget, event),
    );
    activePointerRef.current = null;
    answeredAtRef.current = event.timeStamp;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    recognizeAnswer();
  };

  return (
    <div
      className={styles.root}
      data-digit-count={digitCount}
      data-entry-mode={entryMode}
      data-has-readout={readout !== null}
    >
      <div className={styles.canvases}>
        {Array.from({ length: digitCount }, (_, index) => {
          const canvas = (
            <canvas
              ref={(node) => {
                canvasRefs.current[index] = node;
                if (index === 0) focusRef.current = node;
              }}
              className={styles.canvas}
              data-has-ink={hasInk[index]}
              tabIndex={disabled ? -1 : 0}
              role="img"
              aria-label={
                entryMode === "right-aligned"
                  ? `${PLACE_LABELS[digitCount][index]} answer place. Draw this digit if needed.`
                  : `Draw answer digit ${index + 1} of ${digitCount}`
              }
              onPointerDown={(event) => beginStroke(index, event)}
              onPointerMove={(event) => moveStroke(index, event)}
              onPointerUp={(event) => finishStroke(index, event)}
              onPointerCancel={() => {
                activePointerRef.current = null;
              }}
            />
          );
          return entryMode === "right-aligned" ? (
            <span className={styles.digitSlot} key={index}>
              {canvas}
              <span className={styles.placeLabel} aria-hidden="true">
                {PLACE_LABELS[digitCount][index]}
              </span>
            </span>
          ) : (
            <span className={styles.exactSlot} key={index}>
              {canvas}
            </span>
          );
        })}
      </div>
      {readout !== null ? (
        <strong className={styles.readout} aria-hidden="true">
          {readout}
        </strong>
      ) : null}
      {pendingRecognition !== null && !disabled ? (
        <div className={styles.confirmation}>
          {editingRecognition ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmRecognition(correctionValue);
              }}
            >
              <input
                ref={correctionInputRef}
                className={styles.correctionInput}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                enterKeyHint="done"
                aria-label="Correct the recognized number. Press Done to submit."
                value={correctionValue}
                onChange={(event) =>
                  setCorrectionValue(
                    event.currentTarget.value.replace(/\D/g, "").slice(0, 3),
                  )
                }
              />
            </form>
          ) : (
            <>
              <button
                type="button"
                className={styles.confirmButton}
                disabled={
                  pendingRecognition.rawRecognition === null ||
                  !/^(0|[1-9]\d{0,2})$/.test(
                    pendingRecognition.rawRecognition,
                  )
                }
                onClick={() =>
                  confirmRecognition(pendingRecognition.rawRecognition ?? "")
                }
              >
                Yes
              </button>
              <button
                type="button"
                className={styles.changeButton}
                onClick={() => setEditingRecognition(true)}
              >
                Change
              </button>
            </>
          )}
        </div>
      ) : null}
      <button
        className={styles.clear}
        type="button"
        aria-label="Clear handwriting"
        disabled={disabled || !hasInk.some(Boolean)}
        onClick={clearAll}
      >
        ×
      </button>
      <span className={styles.status} role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
