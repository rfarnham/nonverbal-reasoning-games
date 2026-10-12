"use client";

import { useEffect, useMemo, useState, type CSSProperties, type Ref } from "react";
import {
  describeAnswer,
  foldDirectionLabel,
  initialPaper,
  itemById,
  targetStack,
  type FoldInstruction,
  type FoldStep,
  type Item,
  type ItemOrientation,
  type PaperState,
  type Round,
} from "./game-engine";
import styles from "./fold-visuals.module.css";

const CELL = 64;
const FOLD_DURATION = 900;
type PaperSize = "sequencePaper" | "answerPaper" | "tutorialPaper" | "reviewPaper";

/** The very same glyph is used on the sheet, in evidence, and in the choices. */
function Glyph({ item }: { item: Item }) {
  if (item.kind !== "shape" || !item.shape) {
    return <text x="32" y="32" textAnchor="middle" dominantBaseline="central" className={styles.glyphText}>{item.label}</text>;
  }
  const { outline, mark } = item.shape;
  return <g stroke="#17213d" strokeWidth="3.5" fill="#fffdf8" strokeLinejoin="round">
    {outline === "circle" ? <circle cx="32" cy="32" r="24" /> : null}
    {outline === "square" ? <rect x="9" y="9" width="46" height="46" rx="2" /> : null}
    {outline === "triangle" ? <path d="M32 5 L59 55 H5 Z" /> : null}
    {outline === "diamond" ? <path d="M32 4 L60 32 L32 60 L4 32 Z" /> : null}
    {outline === "hexagon" ? <path d="M19 7 H45 L59 32 L45 57 H19 L5 32 Z" /> : null}
    <g transform={outline === "triangle" ? "translate(0 7)" : undefined} fill="#17213d" strokeWidth="4.5" strokeLinecap="round">
      {mark === "dot" ? <circle cx="32" cy="32" r="5" stroke="none" /> : null}
      {mark === "plus" ? <path d="M23 32 H41 M32 23 V41" /> : null}
      {mark === "bars" ? <path d="M23 26 H41 M23 38 H41" /> : null}
      {mark === "cross" ? <path d="M25 25 L39 39 M25 39 L39 25" /> : null}
    </g>
  </g>;
}

function orientationTransform(orientation?: ItemOrientation): string {
  return `translate(32 32) scale(${orientation?.flipX ? -1 : 1} ${orientation?.flipY ? -1 : 1}) translate(-32 -32)`;
}

export function ItemToken({ item, orientation }: { item: Item; orientation?: ItemOrientation }) {
  return <svg className={styles.itemToken} viewBox="0 0 64 64" aria-hidden="true">
    <g transform={orientationTransform(orientation)}><Glyph item={item} /></g>
  </svg>;
}

function movingCell(instruction: FoldInstruction, col: number, row: number): boolean {
  return instruction.direction === "left" ? col >= instruction.crease
    : instruction.direction === "right" ? col < instruction.crease
      : instruction.direction === "up" ? row >= instruction.crease
        : row < instruction.crease;
}

function orient(paper: PaperState, id: number): string {
  return orientationTransform(paper.orientations[id]);
}

function CellGlyph({ round, paper, stack, back = false, target = false }: {
  round: Round; paper: PaperState; stack: readonly number[]; back?: boolean; target?: boolean;
}) {
  const id = stack[back ? stack.length - 1 : 0];
  if (id === undefined) return null;
  return <>
    <rect x="0.7" y="0.7" width="62.6" height="62.6" fill={target ? "#fff0c8" : back ? "#e6ecf4" : "#fffdf8"} stroke="#7d8492" strokeWidth="1.4" />
    <g transform={orient(paper, id)}><g transform="translate(10 10) scale(.6875)"><Glyph item={itemById(round, id)} /></g></g>
    {target ? <rect x="3.5" y="3.5" width="57" height="57" fill="none" stroke="#17213d" strokeWidth="3" rx="2" /> : null}
    {stack.length > 1 ? <g aria-hidden="true" stroke="#657087" strokeWidth="1.6">
      {Array.from({ length: Math.min(stack.length - 1, 3) }, (_, i) => <path key={i} d={`M${47 - i * 3} 57 H57 V${47 - i * 3}`} />)}
    </g> : null}
  </>;
}

export function PaperDiagram({ round, paper, size = "sequencePaper", target = false, blank = false, label, hidden = false, paperRef }: {
  round: Round; paper: PaperState; size?: PaperSize; target?: boolean; blank?: boolean;
  label?: string; hidden?: boolean; paperRef?: Ref<HTMLDivElement>;
}) {
  const maxDimension = Math.max(round.source.rows, round.source.cols);
  const style = { "--paper-ratio": paper.cols / maxDimension, aspectRatio: `${paper.cols}/${paper.rows}` } as CSSProperties;
  return <div className={`${styles.paperDiagram} ${styles[size]}`} style={style} ref={paperRef}
    role={hidden ? undefined : "img"} aria-label={hidden ? undefined : label} aria-hidden={hidden || undefined}>
    <svg viewBox={`0 0 ${paper.cols * CELL} ${paper.rows * CELL}`} aria-hidden="true">
      {paper.stacks.map((stack, index) => <g key={index} transform={`translate(${index % paper.cols * CELL} ${Math.floor(index / paper.cols) * CELL})`}>
        {blank ? <rect x=".7" y=".7" width="62.6" height="62.6" fill="#fffdf8" stroke="#7d8492" strokeWidth="1.4" />
          : <CellGlyph round={round} paper={paper} stack={stack} target={target && stack.includes(round.targetId)} />}
      </g>)}
      <rect x="1" y="1" width={paper.cols * CELL - 2} height={paper.rows * CELL - 2} fill="none" stroke="#17213d" strokeWidth="2" />
    </svg>
  </div>;
}

/** Ordered answers use a single vertical reading direction at every viewport. */
export function ItemSet({ round, items, orientations, label, hidden = false }: {
  round: Round; items: readonly number[]; orientations?: readonly ItemOrientation[]; label?: string; hidden?: boolean;
}) {
  const ordered = round.answerMode === "ordered";
  return <div className={`${styles.itemSet} ${ordered ? styles.orderedSet : ""}`}
    role={hidden ? undefined : "img"} aria-label={hidden ? undefined : label} aria-hidden={hidden || undefined}>
    {ordered ? <span className={styles.stackEndpoint} aria-hidden="true">Top</span> : null}
    <div className={styles.setItems} aria-hidden="true">
      {items.map((id, index) => <span className={`${styles.setItem} ${ordered && id === round.targetId ? styles.targetItem : ""}`} key={`${id}-${index}`}>
        <ItemToken item={itemById(round, id)} orientation={round.difficulty === "Wizard" ? orientations?.[index] : undefined} />
      </span>)}
    </div>
    {ordered ? <span className={styles.stackEndpoint} aria-hidden="true">Bottom</span> : null}
  </div>;
}

// Orthographic projection keeps every grid cell recognizable while giving
// height a visible direction. An actual hinge rotation drives both geometry
// and the glyphs: after the midpoint, the former bottom layer is the top face.
function projection(instruction: FoldInstruction, progress: number, moving: boolean): string {
  const horizontal = instruction.direction === "left" || instruction.direction === "right";
  const hinge = instruction.crease * CELL;
  const angle = Math.PI * progress;
  const cosine = moving ? Math.cos(angle) : 1;
  const towardPositive = instruction.direction === "left" || instruction.direction === "up";
  const height = moving ? Math.sin(angle) * (instruction.sense === "over" ? 1 : -1) * (towardPositive ? 1 : -1) : 0;
  // Screen x = x + .16*y; screen y = .94*y - .72*z.
  return horizontal
    ? `matrix(${cosine} ${-.72 * height} .16 .94 ${hinge * (1 - cosine)} ${.72 * height * hinge})`
    : `matrix(1 0 ${.16 * cosine} ${.94 * cosine - .72 * height} ${.16 * hinge * (1 - cosine)} ${.94 * hinge * (1 - cosine) + .72 * height * hinge})`;
}

function hingeLine(instruction: FoldInstruction, paper: PaperState): string {
  return instruction.direction === "left" || instruction.direction === "right"
    ? `M${instruction.crease * CELL} 0 V${paper.rows * CELL}`
    : `M0 ${instruction.crease * CELL} H${paper.cols * CELL}`;
}

function foldBounds(step: FoldStep, guide: boolean) {
  const width = step.before.cols * CELL;
  const height = step.before.rows * CELL;
  const horizontal = step.direction === "left" || step.direction === "right";
  const positive = step.direction === "left" || step.direction === "up";
  const hinge = step.crease * CELL;
  const points: number[][] = [];
  // Reserve the full hinge arc, including an uneven flap's overhang. A small
  // margin covers the extrema between samples and the functional grid stroke.
  for (let frame = 0; frame <= 32; frame += 1) {
    const progress = guide ? .18 : frame / 32;
    for (const moving of [false, true]) {
      const matrix = projection(step.instruction, progress, moving).slice(7, -1).split(" ").map(Number);
      const atPositiveSide = moving === positive;
      const x0 = horizontal && atPositiveSide ? hinge : 0;
      const x1 = horizontal && !atPositiveSide ? hinge : width;
      const y0 = !horizontal && atPositiveSide ? hinge : 0;
      const y1 = !horizontal && !atPositiveSide ? hinge : height;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        points.push([matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
      }
    }
    if (guide) break;
  }
  const x = Math.min(...points.map(([x]) => x)) - 12;
  const y = Math.min(...points.map(([, y]) => y)) - 12;
  return {
    x, y,
    width: Math.max(...points.map(([x]) => x)) + 12 - x,
    height: Math.max(...points.map(([, y]) => y)) + 12 - y,
  };
}

function PaperFoldView({ round, step, progress, guide = false }: {
  round: Round; step: FoldStep; progress: number; guide?: boolean;
}) {
  const before = step.before;
  const viewBox = useMemo(() => {
    const bounds = foldBounds(step, guide);
    const allBounds = guide ? [bounds] : round.foldSteps.map((candidate) => foldBounds(candidate, false));
    // Keep cell scale fixed between the two folds; only the framing recenters.
    const width = Math.max(...allBounds.map((box) => box.width));
    const height = Math.max(...allBounds.map((box) => box.height));
    return `${bounds.x - (width - bounds.width) / 2} ${bounds.y - (height - bounds.height) / 2} ${width} ${height}`;
  }, [guide, round.foldSteps, step]);
  const renderHalf = (moving: boolean) => <g transform={projection(step.instruction, progress, moving)}>
    {before.stacks.map((stack, index) => {
      const col = index % before.cols;
      const row = Math.floor(index / before.cols);
      if (movingCell(step.instruction, col, row) !== moving || stack.length === 0) return null;
      return <g key={index} transform={`translate(${col * CELL} ${row * CELL})`}>
        {guide ? <rect x=".8" y=".8" width="62.4" height="62.4" fill={moving ? "#f9c3b6" : "#fffdf8"} stroke="#657087" strokeWidth="1.6" />
          : <CellGlyph round={round} paper={before} stack={stack} back={moving && progress >= .5} target={stack.includes(round.targetId)} />}
      </g>;
    })}
  </g>;
  return <svg className={guide ? styles.cueSheet : styles.movingSheet}
    viewBox={viewBox} data-fold-animation={guide ? undefined : ""} aria-hidden="true">
    {step.sense === "under" ? renderHalf(true) : null}
    {renderHalf(false)}
    {step.sense === "over" ? renderHalf(true) : null}
    <g transform={projection(step.instruction, 0, false)}><path d={hingeLine(step.instruction, before)} fill="none" stroke="#17213d" strokeWidth={guide ? 4 : 2.5} strokeDasharray="7 5" /></g>
  </svg>;
}

/** Small side view separates an overfold from an underfold without relying on color. */
function FoldArc({ instruction }: { instruction: FoldInstruction }) {
  const over = instruction.sense === "over";
  const forward = instruction.direction === "left" || instruction.direction === "up";
  const transform = forward ? undefined : "translate(100 0) scale(-1 1)";
  return <svg className={styles.foldArc} viewBox="0 0 100 62" aria-hidden="true">
    <g transform={transform}>
      <path d="M10 31 H88" stroke="#657087" strokeWidth="4" />
      <path d={over ? "M85 26 C81 0 26 0 17 23" : "M85 36 C81 62 26 62 17 39"}
        fill="none" stroke="#17213d" strokeWidth="3.5" strokeDasharray={over ? undefined : "6 4"} />
      <path d={over ? "M11 16 L17 25 L26 19" : "M11 46 L17 37 L26 43"}
        fill="none" stroke="#17213d" strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="50" cy="31" r="4" fill="#17213d" />
    </g>
  </svg>;
}

export function FoldCue({ round, step }: { round: Round; step: FoldStep }) {
  return <div className={styles.foldCue} role="img" aria-label={`Fold ${step.index + 1}. ${foldDirectionLabel(step.instruction)}`}>
    <PaperFoldView round={round} step={step} progress={.18} guide />
    <div className={styles.foldSense}><FoldArc instruction={step.instruction} /><strong>{step.sense === "over" ? "Over" : "Under"}</strong></div>
    <span className={styles.foldDirection}>{foldDirectionLabel(step.instruction)}</span>
  </div>;
}

export function FoldSequence({ round, compact = false, reveal = false }: {
  round: Round; compact?: boolean; reveal?: boolean;
}) {
  return <div className={`${styles.foldSequence} ${compact ? styles.compactSequence : ""}`}>
    <div className={styles.sourceCard}>
      <span className={styles.stepLabel}>Start</span>
      <PaperDiagram round={round} paper={initialPaper(round.source)} target
        label={`Original ${round.source.rows} by ${round.source.cols} paper. Track the highlighted item through the folds.`} />
    </div>
    <div className={styles.foldInstructions}>
      {round.foldSteps.map((step, index) => <div className={styles.foldCard} key={index}>
        <span className={styles.stepLabel}>Fold {index + 1}</span>
        <FoldCue round={round} step={step} />
      </div>)}
    </div>
    {reveal ? <div className={styles.revealedPaper}>
      <span className={styles.stepLabel}>Folded</span>
      <PaperDiagram round={round} paper={round.foldSteps[round.foldSteps.length - 1].after} target label="Finished folded paper with the target stack highlighted." />
    </div> : null}
  </div>;
}

function easedProgress(time: number): number {
  // Solve cubic-bezier(.2,.75,.25,1), matching the suite's fold timing.
  let low = 0;
  let high = 1;
  let t = time;
  for (let i = 0; i < 12; i += 1) {
    t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .2 + 3 * (1 - t) * t * t * .25 + t ** 3;
    if (x < time) low = t; else high = t;
  }
  return 3 * (1 - t) ** 2 * t * .75 + 3 * (1 - t) * t * t + t ** 3;
}

function AnimatedFold({ round, step }: { round: Round; step: FoldStep }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const started = performance.now();
    let frame = 0;
    let disposed = false;
    const update = (now: number) => {
      if (disposed) return;
      const duration = media.matches ? 140 : FOLD_DURATION;
      const elapsed = Math.min(1, (now - started) / duration);
      setProgress(media.matches ? 1 : easedProgress(elapsed));
      if (elapsed < 1) frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => { disposed = true; window.cancelAnimationFrame(frame); };
  }, []);
  return <div className={styles.animationStage} role="img" aria-label={`Fold ${step.index + 1}. ${foldDirectionLabel(step.instruction)}`}>
    <PaperFoldView round={round} step={step} progress={progress} />
    <div className={styles.animationCaption}><FoldArc instruction={step.instruction} /><span>{foldDirectionLabel(step.instruction)}</span></div>
  </div>;
}

export function FoldingPaper({ round, stageIndex, complete, inline = false }: {
  round: Round; stageIndex: number; complete: boolean; inline?: boolean;
}) {
  const step = round.foldSteps[Math.min(stageIndex, round.foldSteps.length - 1)];
  const final = round.foldSteps[round.foldSteps.length - 1].after;
  return <div className={`${styles.teachingArea} ${inline ? styles.inlineTeaching : ""}`}>
    {complete ? <div className={styles.finishedFold}>
      <PaperDiagram round={round} paper={final} target label="Folded paper with the target stack highlighted." />
      <div className={styles.finishedStack}>
        <span className={styles.stepLabel}>{round.answerMode === "ordered" ? "The whole stack" : "Stacked together"}</span>
        <ItemSet round={round} items={round.answerMode === "ordered" ? targetStack(round) : round.correctItems}
          orientations={round.correctOrientations}
          label={`${round.answerMode === "ordered" ? "Top to bottom" : "Stacked together"}: ${describeAnswer(round, round.correctItems, round.correctOrientations)}`} />
      </div>
    </div> : <AnimatedFold key={`${stageIndex}-${round.source.items.map((item) => item.label).join("-")}`} round={round} step={step} />}
  </div>;
}
