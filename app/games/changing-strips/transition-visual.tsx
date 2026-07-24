"use client";

import type { CSSProperties } from "react";

import {
  PATTERN_META,
  type CellState,
  type TraceStep,
  type TransitionRule,
} from "./game-engine";
import styles from "./changing-strips.module.css";

type StripVariant = "example" | "clue" | "option" | "story" | "review";

function cellClass(state: CellState): string {
  switch (state) {
    case "solid":
      return styles.cellSolid;
    case "hollow":
      return styles.cellHollow;
    case "striped":
      return styles.cellStriped;
  }
}

export function CellToken({
  state,
  changed = false,
  animateChange = true,
  difference = false,
}: Readonly<{
  state: CellState;
  changed?: boolean;
  animateChange?: boolean;
  difference?: boolean;
}>) {
  return (
    <span
      className={`${styles.cell} ${cellClass(state)} ${
        changed
          ? animateChange
            ? styles.cellChanged
            : styles.cellChangedSettled
          : ""
      } ${difference ? styles.cellDifference : ""}`}
      aria-hidden="true"
    >
      <span className={styles.cellMark} />
    </span>
  );
}

export function StripDiagram({
  cells,
  rows = 1,
  columns,
  variant = "clue",
  changedIndexes = [],
  animateChanges = true,
  differenceIndexes = [],
  label,
}: Readonly<{
  cells: readonly CellState[];
  rows?: 1 | 2;
  columns?: number;
  variant?: StripVariant;
  changedIndexes?: readonly number[];
  animateChanges?: boolean;
  differenceIndexes?: readonly number[];
  label?: string;
}>) {
  const resolvedColumns = columns ?? Math.max(1, cells.length / rows);
  const changed = new Set(changedIndexes);
  const differences = new Set(differenceIndexes);
  const accessibleLabel =
    label ??
    `${rows} row by ${resolvedColumns} column board using solid, hollow, and striped patterns`;
  const variantClass =
    styles[`strip${variant[0].toUpperCase()}${variant.slice(1)}`];

  return (
    <span
      className={`${styles.strip} ${variantClass}`}
      role="img"
      aria-label={accessibleLabel}
      style={
        {
          "--strip-columns": resolvedColumns,
          "--strip-rows": rows,
        } as CSSProperties
      }
    >
      {cells.map((state, index) => (
        <CellToken
          state={state}
          changed={changed.has(index)}
          animateChange={animateChanges}
          difference={differences.has(index)}
          key={`${index}-${state}`}
        />
      ))}
    </span>
  );
}

function RuleGlyph({
  rule,
  compact = false,
}: Readonly<{
  rule: TransitionRule;
  compact?: boolean;
}>) {
  return (
    <span
      className={`${styles.replaceDiagram} ${
        compact ? styles.replaceDiagramCompact : ""
      }`}
      aria-hidden="true"
    >
      <CellToken state={rule.from} />
      <span className={styles.ruleDownArrow}>↓</span>
      <CellToken state={rule.to} />
    </span>
  );
}

export function RulePipeline({
  rules,
  activeRuleIndex = null,
  compact = false,
}: Readonly<{
  rules: readonly TransitionRule[];
  trace?: readonly TraceStep[];
  activeRuleIndex?: number | null;
  compact?: boolean;
}>) {
  return (
    <div
      className={`${styles.rulePipeline} ${
        compact ? styles.pipelineCompact : ""
      }`}
      role="img"
      aria-label={`${rules.length} numbered pattern changes, applied from top to bottom. Each change affects every matching square. ${rules
        .map(
          (rule, index) =>
            `Step ${index + 1}: ${PATTERN_META[rule.from].label} to ${PATTERN_META[rule.to].label}.`,
        )
        .join(" ")}`}
    >
      <div className={styles.recipeHeading} aria-hidden="true">
        <span>TOP</span>
        <span>Every match</span>
      </div>
      <ol
        className={styles.ruleCards}
        style={{ "--rule-count": rules.length } as CSSProperties}
        aria-hidden="true"
      >
        {rules.map((rule, index) => (
          <li className={styles.ruleCardWrap} key={`${index}-${rule.from}-${rule.to}`}>
            <span
              className={`${styles.ruleCard} ${
                activeRuleIndex === index ? styles.ruleCardActive : ""
              }`}
            >
              <span className={styles.ruleNumber}>{index + 1}</span>
              <RuleGlyph rule={rule} compact={compact} />
            </span>
            {index < rules.length - 1 ? (
              <span className={styles.ruleConnector}>↓</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TraceStoryboard({
  input,
  steps,
  rows = 1,
  columns,
  activeStep = null,
}: Readonly<{
  input: readonly CellState[];
  steps: readonly TraceStep[];
  rows?: 1 | 2;
  columns?: number;
  activeStep?: number | null;
}>) {
  const settled = activeStep === null;
  const resolvedColumns = columns ?? Math.max(1, input.length / rows);

  return (
    <ol
      className={`${styles.storyboard} ${
        settled ? styles.storyboardSettled : ""
      }`}
      aria-label="Step-by-step visual proof"
      aria-live="off"
    >
      <li className={styles.storyStart}>
        <span className={styles.storyLabel}>Start</span>
        <StripDiagram
          cells={input}
          rows={rows}
          columns={resolvedColumns}
          variant="story"
          label="Starting board in the visual proof"
        />
      </li>
      {steps.map((step, index) => {
        const isActive = activeStep === index;
        const isFuture = activeStep !== null && index > activeStep;
        return (
          <li
            className={`${styles.storyStep} ${
              isActive ? styles.storyStepActive : ""
            } ${isFuture ? styles.storyStepFuture : ""}`}
            aria-current={isActive ? "step" : undefined}
            key={`${step.executionIndex}-${step.rule.from}-${step.rule.to}`}
          >
            <span className={styles.storyConnector} aria-hidden="true">
              ↓
            </span>
            <div className={styles.storyOperation} aria-hidden="true">
              <span className={styles.storyRuleBadge}>{index + 1}</span>
              <RuleGlyph rule={step.rule} compact />
            </div>
            <StripDiagram
              cells={step.after}
              rows={rows}
              columns={resolvedColumns}
              variant="story"
              changedIndexes={
                activeStep === null || index <= activeStep
                  ? step.changedIndexes
                  : []
              }
              animateChanges={isActive}
              label={`Board after visual change ${index + 1}`}
            />
          </li>
        );
      })}
    </ol>
  );
}

export function stateDifferenceIndexes(
  expected: readonly CellState[],
  attempted: readonly CellState[],
): readonly number[] {
  const differences: number[] = [];
  const length = Math.max(expected.length, attempted.length);
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== attempted[index]) differences.push(index);
  }
  return differences;
}
