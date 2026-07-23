"use client";

import {
  describeRule,
  orderedRuleIndexes,
  processingDirectionLabel,
  type CellState,
  type ProcessingDirection,
  type TraceStep,
  type TransitionRule,
} from "./game-engine";
import type { CSSProperties } from "react";
import styles from "./changing-strips.module.css";

type StripVariant = "example" | "clue" | "option" | "story" | "review";

const CELL_LABELS: Record<CellState, string> = {
  solid: "solid",
  open: "open",
  striped: "striped",
};

function cellClass(state: CellState): string {
  switch (state) {
    case "solid":
      return styles.cellSolid;
    case "open":
      return styles.cellOpen;
    case "striped":
      return styles.cellStriped;
  }
}

export function CellToken({
  state,
  changed = false,
  difference = false,
  subject = false,
  cue = false,
}: Readonly<{
  state: CellState;
  changed?: boolean;
  difference?: boolean;
  subject?: boolean;
  cue?: boolean;
}>) {
  return (
    <span
      className={`${styles.cell} ${cellClass(state)} ${
        changed ? styles.cellChanged : ""
      } ${difference ? styles.cellDifference : ""} ${
        subject ? styles.cellSubject : ""
      } ${cue ? styles.cellCue : ""}`}
      aria-hidden="true"
    >
      <span className={styles.cellMark} />
    </span>
  );
}

export function StripDiagram({
  cells,
  variant = "clue",
  changedIndexes = [],
  differenceIndexes = [],
  label,
}: Readonly<{
  cells: readonly CellState[];
  variant?: StripVariant;
  changedIndexes?: readonly number[];
  differenceIndexes?: readonly number[];
  label?: string;
}>) {
  const changed = new Set(changedIndexes);
  const differences = new Set(differenceIndexes);
  const accessibleLabel =
    label ??
    `${cells.length}-tile strip using solid, open, and striped tiles`;

  return (
    <span
      className={`${styles.strip} ${styles[`strip${variant[0].toUpperCase()}${variant.slice(1)}`]}`}
      role="img"
      aria-label={accessibleLabel}
      style={{ "--strip-cells": cells.length } as CSSProperties}
    >
      {cells.map((state, index) => (
        <CellToken
          state={state}
          changed={changed.has(index)}
          difference={differences.has(index)}
          key={`${index}-${state}`}
        />
      ))}
    </span>
  );
}

function MiniStrip({
  cells,
  subjects = [],
  cues = [],
}: Readonly<{
  cells: readonly CellState[];
  subjects?: readonly number[];
  cues?: readonly number[];
}>) {
  const subjectIndexes = new Set(subjects);
  const cueIndexes = new Set(cues);
  return (
    <span className={styles.ruleMiniStrip} aria-hidden="true">
      {cells.map((state, index) => (
        <CellToken
          state={state}
          subject={subjectIndexes.has(index)}
          cue={cueIndexes.has(index)}
          key={`${index}-${state}`}
        />
      ))}
    </span>
  );
}

function NeutralCell() {
  return (
    <span className={`${styles.cell} ${styles.cellNeutral}`} aria-hidden="true">
      <span className={styles.cellMark} />
    </span>
  );
}

function NeutralMiniStrip({ count }: Readonly<{ count: number }>) {
  return (
    <span className={styles.ruleMiniStrip} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <NeutralCell key={index} />
      ))}
    </span>
  );
}

function RuleDiagram({
  rule,
  traceStep,
  clueCells,
}: Readonly<{
  rule: TransitionRule;
  traceStep: TraceStep;
  clueCells?: readonly CellState[];
}>) {
  if (rule.kind === "replace") {
    return (
      <span className={styles.replaceDiagram} aria-hidden="true">
        <CellToken state={rule.from} />
        <span className={styles.ruleDownArrow}>↓</span>
        <CellToken state={rule.to} />
      </span>
    );
  }

  if (rule.kind === "swap") {
    return (
      <span className={styles.swapDiagram} aria-hidden="true">
        <span className={styles.swapRow}>
          <CellToken state={rule.first} />
          <CellToken state={rule.second} />
        </span>
        <svg
          className={styles.swapTrails}
          viewBox="0 0 72 28"
          focusable="false"
        >
          <path d="M16 3C16 17 56 11 56 25" />
          <path d="M56 3C56 17 16 11 16 25" />
          <path d="m51 20 5 5 5-5M11 20l5 5 5-5" />
        </svg>
        <span className={styles.swapRow}>
          <CellToken state={rule.second} />
          <CellToken state={rule.first} />
        </span>
      </span>
    );
  }

  if (rule.kind === "neighbor") {
    const before =
      rule.neighborDirection === "left"
        ? ([rule.neighbor, rule.from] as const)
        : ([rule.from, rule.neighbor] as const);
    const after =
      rule.neighborDirection === "left"
        ? ([rule.neighbor, rule.to] as const)
        : ([rule.to, rule.neighbor] as const);
    const subjectIndex = rule.neighborDirection === "left" ? 1 : 0;
    const cueIndex = subjectIndex === 0 ? 1 : 0;

    return (
      <span className={styles.neighborDiagram} aria-hidden="true">
        <MiniStrip
          cells={before}
          subjects={[subjectIndex]}
          cues={[cueIndex]}
        />
        <span className={styles.ruleDownArrow}>↓</span>
        <MiniStrip
          cells={after}
          subjects={[subjectIndex]}
          cues={[cueIndex]}
        />
      </span>
    );
  }

  const shiftCells = clueCells ?? traceStep.before;
  const hideIntermediateState =
    clueCells !== undefined && traceStep.executionIndex > 0;
  const wrapState =
    rule.direction === "left"
      ? shiftCells[0]
      : shiftCells[shiftCells.length - 1];

  return (
    <span className={styles.shiftDiagram} aria-hidden="true">
      {hideIntermediateState ? (
        <NeutralMiniStrip count={shiftCells.length} />
      ) : (
        <MiniStrip cells={shiftCells} />
      )}
      <span className={styles.shiftArrow}>
        <span className={styles.shiftTravelArrow}>
          {rule.direction === "left" ? "←" : "→"}
        </span>
        {wrapState || hideIntermediateState ? (
          <span className={styles.shiftWrap}>
            {hideIntermediateState ? (
              <NeutralCell />
            ) : wrapState ? (
              <CellToken state={wrapState} />
            ) : null}
            <span className={styles.shiftWrapPath}>
              {rule.direction === "left" ? "↪ ───→" : "←─── ↩"}
            </span>
            {hideIntermediateState ? (
              <NeutralCell />
            ) : wrapState ? (
              <CellToken state={wrapState} />
            ) : null}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function RulePipeline({
  rules,
  processingDirection,
  trace,
  activeRuleIndex = null,
  compact = false,
  showStepNumbers = true,
  sourceStrip,
}: Readonly<{
  rules: readonly TransitionRule[];
  processingDirection: ProcessingDirection;
  trace: readonly TraceStep[];
  activeRuleIndex?: number | null;
  compact?: boolean;
  showStepNumbers?: boolean;
  sourceStrip?: readonly CellState[];
}>) {
  const executionOrder = orderedRuleIndexes(
    rules.length,
    processingDirection,
  );

  return (
    <div
      className={`${styles.rulePipeline} ${
        processingDirection === "rtl"
          ? styles.pipelineRtl
          : ""
      } ${compact ? styles.pipelineCompact : ""} ${
        showStepNumbers ? "" : styles.ruleNumbersHidden
      }`}
      aria-label={`${processingDirectionLabel(processingDirection)}. ${executionOrder
        .map((ruleIndex, executionIndex) => {
          return `Step ${executionIndex + 1}: ${describeRule(
            rules[ruleIndex],
          )}`;
        })
        .join(" ")}`}
      style={{ "--rule-count": rules.length } as CSSProperties}
    >
      <div className={styles.orderRail} aria-hidden="true">
        {processingDirection === "ltr" ? (
          <>
            <span className={styles.startLabel}>START</span>
            <span className={styles.startDot} />
            <span className={styles.railLine} />
            <span className={styles.railArrow}>→</span>
          </>
        ) : (
          <>
            <span className={styles.railArrow}>←</span>
            <span className={styles.railLine} />
            <span className={styles.startDot} />
            <span className={styles.startLabel}>START</span>
          </>
        )}
      </div>
      <div className={styles.ruleCards}>
        {rules.map((rule, ruleIndex) => {
          const executionIndex = executionOrder.indexOf(ruleIndex);
          const traceStep = trace.find(
            (step) => step.ruleIndex === ruleIndex,
          );
          if (!traceStep) return null;
          return (
            <div
              className={`${styles.ruleCard} ${
                activeRuleIndex === ruleIndex ? styles.ruleCardActive : ""
              }`}
              aria-label={`Step ${executionIndex + 1}: ${describeRule(rule)}`}
              key={`${ruleIndex}-${rule.kind}`}
            >
              <span className={styles.ruleNumber} aria-hidden="true">
                {executionIndex + 1}
              </span>
              <RuleDiagram
                rule={rule}
                traceStep={traceStep}
                clueCells={sourceStrip}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TraceStoryboard({
  input,
  steps,
  activeStep = null,
  finalLabel = "Answer",
}: Readonly<{
  input: readonly CellState[];
  steps: readonly TraceStep[];
  activeStep?: number | null;
  finalLabel?: string;
}>) {
  const animationRunning = activeStep !== null;

  return (
    <ol
      className={`${styles.storyboard} ${
        animationRunning ? styles.storyboardPlaying : styles.storyboardSettled
      }`}
      aria-label={`Step-by-step proof from start to ${finalLabel.toLowerCase()}`}
    >
      <li className={styles.storyStep}>
        <span className={styles.storyLabel}>Start</span>
        <StripDiagram
          cells={input}
          variant="story"
          label="Starting strip"
        />
      </li>
      {steps.map((step, index) => {
        const isActive = activeStep === index;
        const isFuture = activeStep !== null && index > activeStep;
        const isLast = index === steps.length - 1;
        return (
          <li
            className={`${styles.storyStep} ${
              isActive ? styles.storyStepActive : ""
            } ${isFuture ? styles.storyStepFuture : ""}`}
            aria-current={isActive ? "step" : undefined}
            key={`${step.executionIndex}-${step.ruleIndex}`}
          >
            <span className={styles.storyConnector} aria-hidden="true">
              ↓
            </span>
            <span className={styles.storyLabel}>
              {isLast ? finalLabel : `Step ${index + 1}`}
            </span>
            <StripDiagram
              cells={step.after}
              variant="story"
              changedIndexes={isActive ? step.changedIndexes : []}
              label={
                isLast
                  ? `Final strip after ${steps.length} ${
                      steps.length === 1 ? "step" : "steps"
                    }`
                  : `Strip after step ${index + 1}`
              }
            />
            <span
              className={`${styles.storyOperation} ${
                styles[
                  `storyOperation${step.rule.kind[0].toUpperCase()}${step.rule.kind.slice(1)}`
                ]
              } ${
                step.rule.kind === "shift"
                  ? step.rule.direction === "left"
                    ? styles.storyShiftLeft
                    : styles.storyShiftRight
                  : ""
              }`}
              aria-hidden="true"
            >
              <span className={styles.storyRuleBadge}>{index + 1}</span>
              <RuleDiagram rule={step.rule} traceStep={step} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function stateDifferenceIndexes(
  expected: readonly CellState[],
  actual: readonly CellState[],
): readonly number[] {
  const count = Math.max(expected.length, actual.length);
  return Array.from({ length: count }, (_, index) => index).filter(
    (index) => expected[index] !== actual[index],
  );
}

export function stateSequenceLabel(states: readonly CellState[]): string {
  return states.map((state) => CELL_LABELS[state]).join(", ");
}
