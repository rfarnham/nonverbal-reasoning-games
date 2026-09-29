"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { recognizeDigit, warmDigitRecognizer } from "../subtraction-flash/digit-recognition";
import { TIER_INFO, type Evidence, type Problem } from "./engine";
import { ANSWER_BOTTOM, ANSWER_TOP, COLUMN_WIDTH, HEIGHT, WIDTH, answerSlots, columnCenter, drawStrokes, inkRegion, readyToRead, READ_DELAY_MS, type Point, type Stroke } from "./ink";
import styles from "./trainer.module.css";

export function Calculation({ problem, solved = false, example = false }: { problem: Problem; solved?: boolean; example?: boolean }) {
  const digits = TIER_INFO[problem.tier].digits;
  const number = (n: number, y: number, color?: string) => String(n).padStart(digits, " ").split("").map((d, i) =>
    <text key={`${y}:${i}`} x={columnCenter(i, digits)} y={y} fill={color}>{d}</text>);
  return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.calculation} aria-hidden="true">
    <g textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="66" fill="#17213d">
      {number(problem.top, 145)}{number(problem.bottom, 228)}
      <text x={Math.max(25, columnCenter(0, digits) - 65)} y="227" fontSize="42">−</text>
      <path d={`M${columnCenter(0, digits) - 44} 252 H${columnCenter(digits - 1, digits) + 44}`} stroke="#17213d" strokeWidth="3" />
      {Array.from({ length: digits }, (_, i) => <rect key={i} x={columnCenter(i, digits) - COLUMN_WIDTH / 2 + 3} y={ANSWER_TOP}
        width={COLUMN_WIDTH - 6} height={ANSWER_BOTTOM - ANSWER_TOP} rx="10" fill="none" stroke="#cfcabd" strokeWidth="1.5" />)}
      {solved && number(problem.top - problem.bottom, 357, "#16836b")}
    </g>
    {example && <g fill="#657087" fontSize="15" textAnchor="middle"><text x="180" y="50">Draw your answer below the line</text><text x="180" y="411">Write notes anywhere</text></g>}
  </svg>;
}

interface Props {
  problem: Problem; initialInk: Stroke[]; disabled: boolean; timingAllowed: boolean;
  onInk(strokes: Stroke[]): void; onAnswer(answer: number, evidence: Evidence): void;
}
export function Workspace({ problem, initialInk, disabled, timingAllowed, onInk, onAnswer }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ink = useRef<Stroke[]>(initialInk);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  const shownAt = useRef<number | null>(null);
  const firstInk = useRef<number | null>(null);
  const lastAnswerInk = useRef<number | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reliable = useRef(initialInk.length === 0);
  const submitted = useRef(false);
  const ready = useRef(false);
  const answerRef = useRef(onAnswer);
  const disabledRef = useRef(disabled);
  const timingRef = useRef(timingAllowed);
  const queue = useRef<() => void>(() => {});
  const [count, setCount] = useState(initialInk.length);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const digits = TIER_INFO[problem.tier].digits;
  const answerDigits = String(problem.top - problem.bottom).length;

  useEffect(() => {
    answerRef.current = onAnswer; disabledRef.current = disabled; timingRef.current = timingAllowed;
    if (!timingAllowed) reliable.current = false;
  }, [disabled, onAnswer, timingAllowed]);
  useEffect(() => {
    let live = true;
    const frame = requestAnimationFrame(() => { shownAt.current = performance.now(); canvas.current?.focus({ preventScroll: true }); });
    const context = canvas.current?.getContext("2d");
    if (context) drawStrokes(context, ink.current);
    const timeout = setTimeout(() => { if (live) { setFailed(true); setStatus("Handwriting could not load."); } }, 15000);
    void warmDigitRecognizer().then(() => {
      if (live) { ready.current = true; setFailed(false); clearTimeout(timeout); queue.current(); }
    }).catch(() => { if (live) { setFailed(true); setStatus("Handwriting could not load."); clearTimeout(timeout); } });
    return () => {
      live = false;
      // Invalidate all in-flight results when pausing, navigating, or advancing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      token.current++;
      if (timer.current !== null) clearTimeout(timer.current);
      cancelAnimationFrame(frame); clearTimeout(timeout);
    };
  }, []);

  function cancelReading() {
    token.current++;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function paint() {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawStrokes(context, active.current ? [...ink.current, active.current.stroke] : ink.current);
  }
  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.round(Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) / rect.width * WIDTH)) * 10) / 10,
      y: Math.round(Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) / rect.height * HEIGHT)) * 10) / 10 };
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabledRef.current || submitted.current || active.current || event.button !== 0) return;
    event.preventDefault();
    cancelReading();
    if (ink.current.length >= 128) { setStatus("Use the eraser to make some room."); return; }
    const p = point(event);
    active.current = { id: event.pointerId, stroke: { points: [p], region: inkRegion(p, digits) } };
    event.currentTarget.setPointerCapture(event.pointerId);
    firstInk.current ??= performance.now();
    setStatus(""); paint();
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (active.current?.id !== event.pointerId) return;
    const p = point(event), stroke = active.current.stroke;
    if (inkRegion(p, digits) !== stroke.region) stroke.region = -1;
    if (stroke.points.length < 512) stroke.points.push(p);
    paint();
  }
  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (active.current?.id !== event.pointerId) return;
    const stroke = active.current.stroke;
    ink.current = [...ink.current, stroke];
    if (stroke.region >= 0) lastAnswerInk.current = performance.now();
    active.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setCount(ink.current.length); onInk(ink.current); paint(); schedule();
  }
  function cancelStroke() {
    if (!active.current) return;
    reliable.current = false; active.current = null; cancelReading(); paint();
  }
  function replace(next: Stroke[]) {
    cancelReading(); active.current = null; ink.current = next;
    setCount(next.length); onInk(next); paint(); canvas.current?.focus({ preventScroll: true });
  }
  function schedule() {
    cancelReading();
    if (!ready.current || submitted.current || disabledRef.current || active.current) return;
    const thisToken = token.current;
    if (!readyToRead(ink.current, digits, answerDigits)) {
      if (ink.current.some(s => s.region >= 0)) timer.current = setTimeout(() => {
        timer.current = null;
        if (token.current === thisToken && !disabledRef.current) setStatus("Keep going in the next box.");
      }, 2000);
      return;
    }
    timer.current = setTimeout(() => { timer.current = null; void read(thisToken); }, READ_DELAY_MS);
  }
  async function read(thisToken: number) {
    if (token.current !== thisToken || disabledRef.current || submitted.current || active.current) return;
    const slots = answerSlots(ink.current, digits);
    if (!slots) return;
    const snapshot = ink.current;
    const began = performance.now(), finishedAt = lastAnswerInk.current ?? began;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const predictions = await Promise.race([
        Promise.all(slots.map(i => {
          const offscreen = document.createElement("canvas"); offscreen.width = WIDTH; offscreen.height = HEIGHT;
          const ctx = offscreen.getContext("2d", { willReadFrequently: true });
          if (!ctx) throw new Error("No drawing context");
          // No printed operands, expected digits, notes, or other answer columns.
          drawStrokes(ctx, snapshot.filter(s => s.region === i));
          return recognizeDigit(ctx.getImageData(Math.floor(columnCenter(i, digits) - COLUMN_WIDTH / 2), ANSWER_TOP, COLUMN_WIDTH, ANSWER_BOTTOM - ANSWER_TOP));
        })),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Reading took too long")), 12000); }),
      ]);
      if (token.current !== thisToken || disabledRef.current || submitted.current) return;
      const confidence = Math.min(...predictions.map(p => p.confidence)), margin = Math.min(...predictions.map(p => p.margin));
      if (confidence < 0.52 || margin < 0.1) {
        reliable.current = false;
        replace(ink.current.filter(s => s.region === -1));
        setStatus("Couldn’t read that. Write it again.");
        return;
      }
      submitted.current = true; cancelReading(); setStatus("");
      answerRef.current(Number(predictions.map(p => p.digit).join("")), {
        elapsedMs: Math.max(0, finishedAt - (shownAt.current ?? finishedAt)),
        firstInkMs: firstInk.current === null ? null : Math.max(0, firstInk.current - (shownAt.current ?? firstInk.current)),
        recognitionMs: performance.now() - began, scratch: snapshot.some(s => s.region === -1),
        reliable: reliable.current && timingRef.current,
      });
    } catch {
      if (token.current === thisToken && !disabledRef.current) {
        reliable.current = false; replace(ink.current.filter(s => s.region === -1));
        setStatus("Couldn’t read that. Write it again.");
      }
    } finally { clearTimeout(timeout); }
  }
  useEffect(() => { queue.current = schedule; });
  return <div className={styles.workspace}>
    <div className={styles.paper}>
      <Calculation problem={problem} />
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} tabIndex={0} className={styles.ink}
        aria-label={`${problem.top} minus ${problem.bottom}. Draw notes anywhere; write the answer below the line. Answers are checked automatically.`}
        aria-disabled={disabled} onPointerDown={start} onPointerMove={move} onPointerUp={end}
        onPointerCancel={cancelStroke} onLostPointerCapture={cancelStroke} />
    </div>
    <button type="button" className={styles.eraser} disabled={disabled || !count} aria-label="Clear writing" title="Clear writing"
      onClick={() => { reliable.current = false; setStatus(""); replace([]); }}>
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 13 9-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-9 9H7l-3-3a3 3 0 0 1 0-4Z M9 8l8 8 M11 20h10" /></svg>
    </button>
    {status && <p className={styles.inkStatus} role="status">{status}</p>}
    {failed && <button type="button" className={styles.reloadInk} onClick={() => window.location.reload()}>Reload handwriting</button>}
  </div>;
}
