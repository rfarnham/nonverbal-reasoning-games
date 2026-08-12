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
}>;

export type FlashHandwritingProps = Readonly<{
  digitCount: 1 | 2;
  disabled: boolean;
  focusRef: MutableRefObject<HTMLCanvasElement | null>;
  roundId: string;
  onAnswer(
    answer: number,
    answeredAt: number,
    evidence: FlashHandwritingEvidence,
  ): void;
}>;

const BACKGROUND = "#fffdf8";
const INK = "#17213d";
const CONFIDENCE_MINIMUM = 0.52;
const MARGIN_MINIMUM = 0.1;
const READ_DELAY_MS = 560;

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
  disabled,
  focusRef,
  roundId,
  onAnswer,
}: FlashHandwritingProps) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const hasInkRef = useRef([false, false]);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);
  const recognitionTokenRef = useRef(0);
  const disabledRef = useRef(disabled);
  const answeredAtRef = useRef(0);
  const [hasInk, setHasInk] = useState([false, false]);
  const [readout, setReadout] = useState<string | null>(null);
  const [status, setStatus] = useState("");

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
    hasInkRef.current = [false, false];
    setHasInk([false, false]);
    setReadout(null);
    setStatus("");
    activePointerRef.current = null;
    canvasRefs.current[0]?.focus();
  }, [cancelRecognition]);

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

  const recognizeAnswer = useCallback(() => {
    cancelRecognition();
    if (
      !Array.from({ length: digitCount }, (_, index) =>
        Boolean(hasInkRef.current[index]),
      ).every(Boolean)
    ) {
      return;
    }

    const token = recognitionTokenRef.current;
    recognitionTimerRef.current = window.setTimeout(() => {
      recognitionTimerRef.current = null;
      if (disabledRef.current) return;
      const startedAt = performance.now();
      setStatus("Reading…");
      const images = Array.from({ length: digitCount }, (_, index) => {
        const canvas = canvasRefs.current[index];
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !context) throw new Error("Drawing field unavailable");
        return context.getImageData(0, 0, canvas.width, canvas.height);
      });

      void Promise.all(images.map(recognizeDigit))
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
          setReadout(raw);
          if (
            confidence < CONFIDENCE_MINIMUM ||
            margin < MARGIN_MINIMUM
          ) {
            setStatus(`Read ${raw} · try again`);
            return;
          }
          setStatus(`Read ${raw}`);
          onAnswer(Number(raw), answeredAtRef.current, {
            rawRecognition: raw,
            recognitionConfidence: confidence,
            recognitionMargin: margin,
            recognitionProcessingMs: Math.max(
              0,
              performance.now() - startedAt,
            ),
          });
        })
        .catch(() => {
          if (recognitionTokenRef.current !== token) return;
          setStatus("Couldn’t read that · try again");
        });
    }, READ_DELAY_MS);
  }, [cancelRecognition, digitCount, onAnswer]);

  const beginStroke = (
    index: number,
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (disabled || !event.isPrimary) return;
    event.preventDefault();
    cancelRecognition();
    setReadout(null);
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
      data-has-readout={readout !== null}
    >
      <div className={styles.canvases}>
        {Array.from({ length: digitCount }, (_, index) => (
          <canvas
            key={index}
            ref={(node) => {
              canvasRefs.current[index] = node;
              if (index === 0) focusRef.current = node;
            }}
            className={styles.canvas}
            data-has-ink={hasInk[index]}
            tabIndex={disabled ? -1 : 0}
            role="img"
            aria-label={`Draw answer digit ${index + 1} of ${digitCount}`}
            onPointerDown={(event) => beginStroke(index, event)}
            onPointerMove={(event) => moveStroke(index, event)}
            onPointerUp={(event) => finishStroke(index, event)}
            onPointerCancel={() => {
              activePointerRef.current = null;
            }}
          />
        ))}
      </div>
      {readout !== null ? (
        <strong className={styles.readout} aria-hidden="true">
          {readout}
        </strong>
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
