"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { recognizeDigit, warmDigitRecognizer } from "../subtraction-flash/digit-recognition";
import { TIER_INFO, type Evidence, type Problem } from "./engine";
import { ANSWER_BOTTOM, ANSWER_TOP, COLUMN_WIDTH, HEIGHT, WIDTH, answerSlots, columnCenter, drawStrokes, inkRegion, type Point, type Stroke } from "./ink";
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
    {!example && Array.from({ length: digits }, (_, i) => <text key={i} x={columnCenter(i, digits)} y="406" fill="#657087" fontSize="12" textAnchor="middle">{["Hundreds", "Tens", "Ones"].slice(3 - digits)[i]}</text>)}
  </svg>;
}

interface Props {
  problem: Problem; initialInk: Stroke[]; disabled: boolean; timingAllowed: boolean;
  onInk(strokes: Stroke[]): void; onAnswer(answer: number, evidence: Evidence): void;
}
interface Readout { value: string; confidence: number; margin: number; processingMs: number; finishedAt: number; }
export function Workspace({ problem, initialInk, disabled, timingAllowed, onInk, onAnswer }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ink = useRef<Stroke[]>(initialInk);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  const shownAt = useRef<number | null>(null);
  const firstInk = useRef<number | null>(null);
  const lastAnswerInk = useRef<number | null>(null);
  const token = useRef(0);
  const reliable = useRef(initialInk.length === 0);
  const answerRef = useRef(onAnswer);
  const disabledRef = useRef(disabled);
  const timingRef = useRef(timingAllowed);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(initialInk.length);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [readout, setReadout] = useState<Readout | null>(null);
  const digits = TIER_INFO[problem.tier].digits;

  useEffect(() => { answerRef.current = onAnswer; disabledRef.current = disabled; timingRef.current = timingAllowed;
    if (!timingAllowed) reliable.current = false;
  }, [disabled, onAnswer, timingAllowed]);
  useEffect(() => {
    let live = true;
    const frame = requestAnimationFrame(() => { shownAt.current = performance.now(); canvas.current?.focus(); });
    const context = canvas.current?.getContext("2d");
    if (context) drawStrokes(context, ink.current);
    const timeout = window.setTimeout(() => { if (live) { setFailed(true); setStatus("Handwriting is taking longer to load. Try loading it again."); } }, 15000);
    void warmDigitRecognizer().then(() => { if (live) { setReady(true); setFailed(false); clearTimeout(timeout); } })
      .catch(() => { if (live) { setFailed(true); setStatus("Handwriting could not load. Your progress is safe."); clearTimeout(timeout); } });
    return () => { live = false;
      // Invalidate async digit results when this particular question unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      token.current++;
      cancelAnimationFrame(frame); clearTimeout(timeout); };
  }, []);
  useEffect(() => { if (readout) confirmRef.current?.focus(); }, [readout]);

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
    if (disabled || busy || readout || active.current || ink.current.length >= 128 || event.button !== 0) return;
    event.preventDefault();
    const p = point(event);
    active.current = { id: event.pointerId, stroke: { points: [p], region: inkRegion(p, digits) } };
    event.currentTarget.setPointerCapture(event.pointerId);
    firstInk.current ??= performance.now();
    setStatus(""); paint();
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (active.current?.id !== event.pointerId) return;
    const p = point(event), stroke = active.current.stroke;
    // Crossing into another region remains visible, but makes recognition a redraw task.
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
    setCount(ink.current.length); onInk(ink.current); paint();
  }
  function replace(next: Stroke[]) {
    token.current++; active.current = null; ink.current = next;
    setReadout(null); setBusy(false); setCount(next.length); setStatus(""); onInk(next); paint(); canvas.current?.focus();
  }
  async function check() {
    if (disabled || busy || readout || active.current) return;
    const slots = answerSlots(ink.current, digits);
    if (!slots) { setStatus("Write the answer in the rightmost boxes, with no empty box between digits."); return; }
    const thisToken = ++token.current;
    setBusy(true); setStatus("Reading your writing…");
    const began = performance.now();
    const finishedAt = lastAnswerInk.current ?? began;
    let timer: number | undefined;
    try {
      const predictions = await Promise.race([
        Promise.all(slots.map(i => {
          const offscreen = document.createElement("canvas"); offscreen.width = WIDTH; offscreen.height = HEIGHT;
          const ctx = offscreen.getContext("2d", { willReadFrequently: true });
          if (!ctx) throw new Error("No drawing context");
          // Render only this digit's strokes: never the prompt, notes, or another digit.
          drawStrokes(ctx, ink.current.filter(s => s.region === i));
          return recognizeDigit(ctx.getImageData(Math.floor(columnCenter(i, digits) - COLUMN_WIDTH / 2), ANSWER_TOP, COLUMN_WIDTH, ANSWER_BOTTOM - ANSWER_TOP));
        })),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error("Reading took too long")), 12000); }),
      ]);
      if (token.current !== thisToken) return;
      const value = predictions.map(p => p.digit).join("");
      setReadout({ value, confidence: Math.min(...predictions.map(p => p.confidence)),
        margin: Math.min(...predictions.map(p => p.margin)), processingMs: performance.now() - began, finishedAt });
      setStatus("");
    } catch { if (token.current === thisToken) { reliable.current = false; setStatus("Couldn’t read that. Try Check again, or clear the answer and redraw."); } }
    finally { clearTimeout(timer); if (token.current === thisToken) setBusy(false); }
  }
  function confirm() {
    if (!readout || disabledRef.current) return;
    const r = readout; setReadout(null); token.current++;
    answerRef.current(Number(r.value), { elapsedMs: Math.max(0, r.finishedAt - (shownAt.current ?? r.finishedAt)),
      firstInkMs: firstInk.current === null ? null : Math.max(0, firstInk.current - (shownAt.current ?? firstInk.current)),
      recognitionMs: r.processingMs, scratch: ink.current.some(s => s.region === -1),
      reliable: reliable.current && timingRef.current && r.confidence >= 0.52 && r.margin >= 0.1 });
  }
  return <div>
    <div className={styles.paper}>
      <Calculation problem={problem} />
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} tabIndex={0} className={styles.ink}
        aria-label={`${problem.top} minus ${problem.bottom}. Draw notes anywhere; write the answer in the boxes below the line.`}
        aria-disabled={disabled || busy || Boolean(readout)} onPointerDown={start} onPointerMove={move} onPointerUp={end}
        onPointerCancel={event => { reliable.current = false; end(event); }}
        onLostPointerCapture={event => { if (active.current) { reliable.current = false; end(event); } }} />
    </div>
    {!disabled && <div className={styles.writingControls}>
      <div className={styles.tools}>
        <button type="button" disabled={!count || busy || Boolean(readout)} onClick={() => replace(ink.current.slice(0, -1))}>Undo</button>
        <button type="button" disabled={!count || busy || Boolean(readout)} onClick={() => replace(ink.current.filter(s => s.region === -1))}>Clear answer</button>
        <button type="button" disabled={!count || busy || Boolean(readout)} onClick={() => replace([])}>Clear all</button>
      </div>
      {readout ? <div className={styles.readout}>
        <p>I read <strong>{Number(readout.value)}</strong></p>
        <div className={styles.actions}>
          <button ref={confirmRef} type="button" className={styles.primary} onClick={confirm}>Use {Number(readout.value)}</button>
          <button type="button" onClick={() => { reliable.current = false; replace(ink.current.filter(s => s.region === -1)); }}>That’s not what I wrote</button>
        </div>
      </div> : <button type="button" className={styles.primary} disabled={!ready || busy || !count} onClick={() => void check()}>{busy ? "Reading…" : ready ? "Check" : "Loading handwriting…"}</button>}
      {failed && !ready && <button type="button" onClick={() => window.location.reload()}>Reload handwriting</button>}
      <p className={styles.inkStatus} role="status">{status || "Write notes anywhere. Put your answer below the line."}</p>
    </div>}
  </div>;
}
