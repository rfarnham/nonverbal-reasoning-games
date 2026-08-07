"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { AnswerValue } from "./game-engine";
import {
  DIGIT_REFERENCE_PATHS,
  resolveDigitTraceAttempt,
  scoreDigitTrace,
  type TracePoint,
} from "./trace-geometry";
import styles from "./subtraction-flash.module.css";

type TraceAnswerSource = "trace" | "keyboard";

type TraceAnswerGridProps = Readonly<{
  answers: readonly AnswerValue[];
  disabled: boolean;
  focusRef: MutableRefObject<HTMLButtonElement | null>;
  selectedAnswer: AnswerValue | null;
  selectedAnswerWasCorrect: boolean | null;
  onAnswer(
    answer: AnswerValue,
    answeredAt: number,
    source: TraceAnswerSource,
  ): void;
}>;

type ActiveTrace = {
  answer: AnswerValue;
  pointerId: number;
  target: HTMLButtonElement;
  points: TracePoint[];
};

type VisibleTrace = Readonly<{
  answer: AnswerValue;
  points: readonly TracePoint[];
  state: "drawing" | "almost" | "accepted";
}>;

type TraceFeedback = Readonly<{
  answer: AnswerValue;
  message: string;
}>;

const TRACE_VIEWBOX_WIDTH = 100;
const TRACE_VIEWBOX_HEIGHT = 140;
const MAX_LIVE_TRACE_POINTS = 360;
const MIN_LIVE_POINT_DISTANCE = 0.008;

function pointDistance(left: TracePoint, right: TracePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function appendDistinctPoint(points: TracePoint[], point: TracePoint): void {
  const previous = points.at(-1);
  if (previous && pointDistance(previous, point) < MIN_LIVE_POINT_DISTANCE) {
    return;
  }
  if (points.length >= MAX_LIVE_TRACE_POINTS) return;
  points.push(point);
}

function svgPoints(points: readonly TracePoint[]): string {
  return points
    .map(
      ({ x, y }) =>
        `${x * TRACE_VIEWBOX_WIDTH},${y * TRACE_VIEWBOX_HEIGHT}`,
    )
    .join(" ");
}

function selectedState(
  answer: AnswerValue,
  selectedAnswer: AnswerValue | null,
  selectedAnswerWasCorrect: boolean | null,
): "idle" | "correct" | "incorrect" | "muted" {
  if (selectedAnswer === null) return "idle";
  if (answer !== selectedAnswer) return "muted";
  return selectedAnswerWasCorrect ? "correct" : "incorrect";
}

export function TraceAnswerGrid({
  answers,
  disabled,
  focusRef,
  selectedAnswer,
  selectedAnswerWasCorrect,
  onAnswer,
}: TraceAnswerGridProps) {
  const instructionId = useId();
  const activeTraceRef = useRef<ActiveTrace | null>(null);
  const svgRefs = useRef<
    Partial<Record<AnswerValue, SVGSVGElement | null>>
  >({});
  const retryAnswerRef = useRef<AnswerValue | null>(null);
  const [visibleTrace, setVisibleTrace] = useState<VisibleTrace | null>(null);
  const [feedback, setFeedback] = useState<TraceFeedback | null>(null);

  useEffect(() => {
    if (!disabled) return;
    retryAnswerRef.current = null;
    const active = activeTraceRef.current;
    if (!active) return;
    activeTraceRef.current = null;
    if (active.target.hasPointerCapture(active.pointerId)) {
      active.target.releasePointerCapture(active.pointerId);
    }
    setVisibleTrace({
      answer: active.answer,
      points: [...active.points],
      state: "almost",
    });
    setFeedback({
      answer: active.answer,
      message: "Trace the full line.",
    });
  }, [disabled]);

  const pointFromClient = useCallback(
    (answer: AnswerValue, clientX: number, clientY: number) => {
      const svg = svgRefs.current[answer];
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      } satisfies TracePoint;
    },
    [],
  );

  const beginTrace = (
    answer: AnswerValue,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (
      disabled ||
      !event.isPrimary ||
      event.button !== 0 ||
      activeTraceRef.current !== null
    ) {
      return;
    }
    const point = pointFromClient(answer, event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    if (
      retryAnswerRef.current !== null &&
      retryAnswerRef.current !== answer
    ) {
      retryAnswerRef.current = null;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const active: ActiveTrace = {
      answer,
      pointerId: event.pointerId,
      target: event.currentTarget,
      points: [point],
    };
    activeTraceRef.current = active;
    setFeedback(null);
    setVisibleTrace({ answer, points: [...active.points], state: "drawing" });
  };

  const extendTrace = (
    answer: AnswerValue,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const active = activeTraceRef.current;
    if (
      !active ||
      active.answer !== answer ||
      active.pointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [
      event.nativeEvent,
    ];
    for (const sample of samples) {
      const point = pointFromClient(answer, sample.clientX, sample.clientY);
      if (point) appendDistinctPoint(active.points, point);
    }
    setVisibleTrace({ answer, points: [...active.points], state: "drawing" });
  };

  const finishTrace = (
    answer: AnswerValue,
    event: ReactPointerEvent<HTMLButtonElement>,
    answeredAt: number,
  ) => {
    const active = activeTraceRef.current;
    if (
      !active ||
      active.answer !== answer ||
      active.pointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();
    const finalPoint = pointFromClient(answer, event.clientX, event.clientY);
    if (finalPoint) appendDistinctPoint(active.points, finalPoint);
    activeTraceRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const result = scoreDigitTrace(active.points, answer);
    const decision = resolveDigitTraceAttempt(
      result,
      answer,
      retryAnswerRef.current,
    );
    retryAnswerRef.current = decision.nextRetryDigit;
    if (decision.disposition === "submit") {
      setFeedback(null);
      setVisibleTrace({
        answer,
        points: [...active.points],
        state: "accepted",
      });
      onAnswer(answer, answeredAt, "trace");
      return;
    }

    const goodFaithAttempt = decision.disposition === "retry";

    setVisibleTrace({
      answer,
      points: [...active.points],
      state: "almost",
    });
    setFeedback({
      answer,
      message: goodFaithAttempt
        ? "Close — trace this number once more. Your next close trace will count."
        : "Draw along most of the number. You can also switch to Tap above.",
    });
  };

  const cancelTrace = (
    answer: AnswerValue,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const active = activeTraceRef.current;
    if (
      !active ||
      active.answer !== answer ||
      active.pointerId !== event.pointerId
    ) {
      return;
    }
    activeTraceRef.current = null;
    setVisibleTrace({
      answer,
      points: [...active.points],
      state: "almost",
    });
    setFeedback({
      answer,
      message: "The trace stopped. Try again.",
    });
  };

  return (
    <div className={styles.traceSurface}>
      <p className={styles.traceInstruction} id={instructionId}>
        Trace one number. Follow the full line.
      </p>

      <div
        className={styles.traceGrid}
        role="group"
        aria-labelledby={instructionId}
      >
        {answers.map((answer, index) => {
          const roundState = selectedState(
            answer,
            selectedAnswer,
            selectedAnswerWasCorrect,
          );
          const traceState =
            selectedAnswer === null && visibleTrace?.answer === answer
              ? visibleTrace.state
              : roundState;
          const tracePoints =
            visibleTrace?.answer === answer ? visibleTrace.points : [];
          const stateLabel =
            traceState === "correct"
              ? ", correct"
              : traceState === "incorrect"
                ? ", incorrect"
                : traceState === "almost"
                  ? ", trace needs another pass"
                  : "";

          return (
            <button
              key={answer}
              ref={index === 0 ? focusRef : undefined}
              className={styles.traceButton}
              type="button"
              data-state={traceState}
              disabled={disabled}
              aria-keyshortcuts={String(answer)}
              aria-label={`${answer}. Trace this number${stateLabel}`}
              aria-pressed={selectedAnswer === answer}
              onPointerDown={(event) => beginTrace(answer, event)}
              onPointerMove={(event) => extendTrace(answer, event)}
              onPointerUp={(event) =>
                finishTrace(answer, event, performance.now())
              }
              onPointerCancel={(event) => cancelTrace(answer, event)}
              onLostPointerCapture={(event) => cancelTrace(answer, event)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onAnswer(answer, performance.now(), "keyboard");
              }}
              onClick={(event) => {
                if (event.detail !== 0) {
                  event.preventDefault();
                  return;
                }
                onAnswer(answer, performance.now(), "keyboard");
              }}
            >
              <svg
                ref={(node) => {
                  svgRefs.current[answer] = node;
                }}
                className={styles.traceDigit}
                viewBox={`0 0 ${TRACE_VIEWBOX_WIDTH} ${TRACE_VIEWBOX_HEIGHT}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  className={styles.traceGuideHalo}
                  points={svgPoints(DIGIT_REFERENCE_PATHS[answer])}
                />
                <polyline
                  className={styles.traceGuide}
                  points={svgPoints(DIGIT_REFERENCE_PATHS[answer])}
                />
                {tracePoints.length > 1 ? (
                  <polyline
                    className={styles.traceInk}
                    points={svgPoints(tracePoints)}
                  />
                ) : null}
              </svg>
              <span className={styles.visuallyHidden}>{answer}</span>
            </button>
          );
        })}
      </div>

      <div
        className={styles.traceFeedback}
        data-visible={feedback !== null}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback ? (
          <>
            <span className={styles.traceFeedbackSymbol} aria-hidden="true">
              ↺
            </span>
            <span>
              <strong>Try the trace again.</strong> {feedback.message}
            </span>
          </>
        ) : (
          <span aria-hidden="true">Trace feedback appears here.</span>
        )}
      </div>
    </div>
  );
}
