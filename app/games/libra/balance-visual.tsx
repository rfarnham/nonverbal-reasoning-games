"use client";

import type { CSSProperties } from "react";

import type {
  AnswerOption,
  BalanceToken,
  BalanceEquation,
  Creature,
  Expression,
  Round,
} from "./game-engine";
import type { StrategyId, TeachingProofStep } from "./strategy-curriculum";
import { buildTeachingProof } from "./strategy-curriculum";
import styles from "./libra.module.css";

const TOKEN_COLORS: Readonly<Record<Creature, string>> = {
  chick: styles.goldToken,
  goose: styles.tealToken,
  fox: styles.coralToken,
  frog: styles.tealToken,
  rabbit: styles.coralToken,
  turtle: styles.tealToken,
  cat: styles.violetToken,
  owl: styles.violetToken,
  beetle: styles.goldToken,
  bear: styles.coralToken,
};

const ROUND_TOKEN_COLORS = [
  styles.coralToken,
  styles.goldToken,
  styles.tealToken,
  styles.violetToken,
] as const;

export type AccentMap = Readonly<Partial<Record<Creature, number>>>;

export function buildRoundAccentMap(round: Round): AccentMap {
  const creatures = new Set<Creature>();
  const expressions = [
    ...round.equations.flatMap(({ left, right }) => [left, right]),
    round.question.target,
  ];

  for (const expression of expressions) {
    for (const { creature } of expression) {
      if (creature !== "mystery") creatures.add(creature);
    }
  }
  creatures.add(round.question.unit);

  return Object.fromEntries(
    [...creatures].map((creature, index) => [creature, index % 4]),
  );
}

function AnimalDrawing({ creature }: { creature: Creature }) {
  switch (creature) {
    case "chick":
      return (
        <>
          <circle cx="21" cy="24" r="11" />
          <circle cx="29" cy="16" r="7" />
          <path d="m35 16 6 3-6 3Z" />
          <path d="M14 24c4-5 9-5 12 0-4 5-8 6-12 0Z" className={styles.tokenDetail} />
          <circle cx="31" cy="14" r="1.5" className={styles.tokenEye} />
          <path d="M19 34v5m8-5v5" className={styles.tokenLine} />
        </>
      );
    case "goose":
      return (
        <>
          <ellipse cx="20" cy="29" rx="14" ry="9" />
          <path
            d="M27 28c-1-8-1-15 4-19 4-3 8 0 7 4-1 4-6 4-7 8v10Z"
          />
          <path d="m38 11 6 3-6 2Z" />
          <path d="M9 28c5-6 10-7 16-2-4 3-9 5-16 2Z" className={styles.tokenDetail} />
          <circle cx="35" cy="11" r="1.4" className={styles.tokenEye} />
        </>
      );
    case "fox":
      return (
        <>
          <path d="M13 17 8 7l11 6h10L40 7l-4 15-4 13H16l-5-13Z" />
          <path d="m16 26 8 11 8-11-8 5Z" className={styles.tokenDetail} />
          <circle cx="18" cy="21" r="1.7" className={styles.tokenEye} />
          <circle cx="30" cy="21" r="1.7" className={styles.tokenEye} />
        </>
      );
    case "frog":
      return (
        <>
          <ellipse cx="24" cy="26" rx="15" ry="12" />
          <circle cx="15" cy="13" r="6" />
          <circle cx="33" cy="13" r="6" />
          <circle cx="15" cy="12" r="1.8" className={styles.tokenEye} />
          <circle cx="33" cy="12" r="1.8" className={styles.tokenEye} />
          <path d="M17 29c4 3 10 3 14 0" className={styles.tokenLine} />
          <path d="m12 34-8 5m32-5 8 5" className={styles.tokenLine} />
        </>
      );
    case "rabbit":
      return (
        <>
          <ellipse cx="18" cy="12" rx="5" ry="11" transform="rotate(-10 18 12)" />
          <ellipse cx="30" cy="12" rx="5" ry="11" transform="rotate(10 30 12)" />
          <ellipse cx="24" cy="29" rx="14" ry="13" />
          <circle cx="19" cy="26" r="1.7" className={styles.tokenEye} />
          <circle cx="29" cy="26" r="1.7" className={styles.tokenEye} />
          <path d="m22 32 2 2 2-2" className={styles.tokenLine} />
        </>
      );
    case "turtle":
      return (
        <>
          <ellipse cx="22" cy="26" rx="16" ry="11" />
          <circle cx="39" cy="25" r="5" />
          <path d="M11 35 7 40m12-4-2 5m13-5 2 5" className={styles.tokenLine} />
          <path d="m11 25 6-6h10l6 6-6 6H17Z" className={styles.tokenDetail} />
          <circle cx="41" cy="24" r="1.3" className={styles.tokenEye} />
        </>
      );
    case "cat":
      return (
        <>
          <path d="m10 18 2-12 10 7h5l10-7 1 13-3 17H14Z" />
          <circle cx="19" cy="23" r="1.7" className={styles.tokenEye} />
          <circle cx="30" cy="23" r="1.7" className={styles.tokenEye} />
          <path d="m22 29 3 2 3-2M14 29 5 27m9 6-9 2m30-6 9-2m-9 6 9 2" className={styles.tokenLine} />
        </>
      );
    case "owl":
      return (
        <>
          <ellipse cx="24" cy="26" rx="15" ry="17" />
          <circle cx="18" cy="20" r="6" className={styles.tokenDetail} />
          <circle cx="30" cy="20" r="6" className={styles.tokenDetail} />
          <circle cx="18" cy="20" r="1.8" className={styles.tokenEye} />
          <circle cx="30" cy="20" r="1.8" className={styles.tokenEye} />
          <path d="m24 23-4 5h8ZM12 28l7 9m17-9-7 9" className={styles.tokenLine} />
        </>
      );
    case "beetle":
      return (
        <>
          <ellipse cx="24" cy="28" rx="13" ry="15" />
          <ellipse cx="24" cy="13" rx="8" ry="6" />
          <path d="M24 14v28M12 23 5 18m7 13-8 1m32-9 7-5m-7 13 8 1M19 9l-5-6m15 6 5-6" className={styles.tokenLine} />
          <circle cx="18" cy="27" r="2" className={styles.tokenDetail} />
          <circle cx="30" cy="27" r="2" className={styles.tokenDetail} />
          <circle cx="18" cy="35" r="2" className={styles.tokenDetail} />
          <circle cx="30" cy="35" r="2" className={styles.tokenDetail} />
        </>
      );
    case "bear":
      return (
        <>
          <circle cx="14" cy="13" r="7" />
          <circle cx="34" cy="13" r="7" />
          <circle cx="24" cy="25" r="16" />
          <ellipse cx="24" cy="31" rx="8" ry="6" className={styles.tokenDetail} />
          <circle cx="18" cy="22" r="1.7" className={styles.tokenEye} />
          <circle cx="30" cy="22" r="1.7" className={styles.tokenEye} />
          <path d="m22 29 2 2 2-2" className={styles.tokenLine} />
        </>
      );
  }
}

export function CreatureToken({
  creature,
  difference = false,
  ghost = false,
  accent,
}: {
  creature: Creature;
  difference?: boolean;
  ghost?: boolean;
  accent?: number;
}) {
  return (
    <svg
      className={`${styles.creatureToken} ${
        ROUND_TOKEN_COLORS[accent ?? -1] ?? TOKEN_COLORS[creature]
      } ${
        difference ? styles.differenceToken : ""
      } ${ghost ? styles.ghostToken : ""}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-creature={creature}
    >
      <AnimalDrawing creature={creature} />
    </svg>
  );
}

function MysteryLoad() {
  return (
    <span className={styles.mysteryLoad} aria-hidden="true">
      <span className={styles.mysteryLock} />
      <span className={styles.mysteryDots}>•••</span>
    </span>
  );
}

export type ProofState = "hidden" | "animating" | "settled";

type ProofTerm = {
  creature: BalanceToken;
  count: number;
};

function flattenedExpression(expression: Expression) {
  return expression.flatMap(({ creature, count }) =>
    Array.from({ length: count }, () => creature),
  );
}

function BalanceTokenDrawing({
  token,
  difference = false,
  ghost = false,
  accentMap,
}: {
  token: BalanceToken;
  difference?: boolean;
  ghost?: boolean;
  accentMap?: AccentMap;
}) {
  return (
    <span
      className={`${styles.tokenSlot} ${
        difference ? styles.differenceSlot : ""
      } ${ghost ? styles.ghostSlot : ""}`}
    >
      {token === "mystery" ? (
        <MysteryLoad />
      ) : (
        <CreatureToken
          creature={token}
          ghost={ghost}
          accent={accentMap?.[token]}
        />
      )}
    </span>
  );
}

export function CargoGroup({
  expression,
  differenceFrom,
  hideDifferences = false,
  accentMap,
}: {
  expression: Expression;
  differenceFrom?: number;
  hideDifferences?: boolean;
  accentMap?: AccentMap;
}) {
  const creatures = flattenedExpression(expression);
  const expectedCount = differenceFrom ?? creatures.length;
  const showDifferences = !hideDifferences && differenceFrom !== undefined;
  const missingCount = Math.max(0, expectedCount - creatures.length);
  const excessStart = Math.min(creatures.length, expectedCount);

  return (
    <span
      className={`${styles.cargoGroup} ${
        creatures.length + missingCount > 8 ? styles.cargoDense : ""
      }`}
      aria-hidden="true"
    >
      {creatures.map((creature, index) => (
        <BalanceTokenDrawing
          token={creature}
          difference={showDifferences && index >= excessStart}
          accentMap={accentMap}
          key={`${creature}-${index}`}
        />
      ))}
      {showDifferences
        ? Array.from({ length: missingCount }, (_, index) => {
            const creature = expression[0]?.creature;
            return creature && creature !== "mystery" ? (
              <BalanceTokenDrawing
                token={creature}
                ghost
                accentMap={accentMap}
                key={`missing-${creature}-${index}`}
              />
            ) : null;
          })
        : null}
    </span>
  );
}

function ScaleDrawing({ tilt = 0 }: { tilt?: number }) {
  const endpointShift = Math.sin((tilt * Math.PI) / 180) * 142;

  return (
    <svg
      className={styles.scaleDrawing}
      viewBox="0 0 360 126"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g
        className={styles.balanceBeam}
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        <path d="M38 72h284" />
        <circle cx="38" cy="72" r="5" />
        <circle cx="322" cy="72" r="5" />
      </g>
      <g
        className={styles.leftPanDrawing}
        transform={`translate(0 ${-endpointShift})`}
      >
        <path d="M46 72 25 106m126-34 21 34M25 106c29 13 118 13 147 0" />
      </g>
      <g
        className={styles.rightPanDrawing}
        transform={`translate(0 ${endpointShift})`}
      >
        <path d="m209 72-21 34m126-34 21 34m-147 0c29 13 118 13 147 0" />
      </g>
      <path className={styles.scaleStand} d="M180 72v39m-32 10h64l-32-34Z" />
      <circle className={styles.scalePivot} cx="180" cy="72" r="9" />
    </svg>
  );
}

export function BalanceScale({
  left,
  right,
  goal = false,
  candidate,
  expectedCount,
  revealDifferences = false,
  preserveInference = false,
  outcome,
  accentMap,
}: {
  left: Expression;
  right: Expression;
  goal?: boolean;
  candidate?: AnswerOption;
  expectedCount?: number;
  revealDifferences?: boolean;
  preserveInference?: boolean;
  outcome?: "correct" | "wrong";
  accentMap?: AccentMap;
}) {
  const candidateExpression: Expression | undefined = candidate
    ? [{ creature: candidate.creature, count: candidate.count }]
    : undefined;
  const shownRight = candidateExpression ?? right;
  const hasCandidate = Boolean(candidate);
  const tilt =
    goal && !hasCandidate
      ? -4
      : outcome === "correct"
        ? 0
        : outcome === "wrong" && !preserveInference && candidate
          ? candidate.count < (expectedCount ?? candidate.count)
            ? -4
            : 4
          : 0;
  const endpointShift = Math.sin((tilt * Math.PI) / 180) * 142;
  const leftCargoShift = -endpointShift / 3.6;
  const rightCargoShift = endpointShift / 3.6;

  return (
    <div
      className={`${styles.balanceScale} ${goal ? styles.goalScale : ""} ${
        outcome === "correct" ? styles.scaleCorrect : ""
      } ${outcome === "wrong" ? styles.scaleWrong : ""}`}
      aria-hidden="true"
    >
      <ScaleDrawing tilt={tilt} />
      <span
        className={`${styles.panCargo} ${styles.leftCargo}`}
        style={{ transform: `translateY(${leftCargoShift}cqw)` }}
      >
        <CargoGroup expression={left} accentMap={accentMap} />
      </span>
      <span
        className={`${styles.panCargo} ${styles.rightCargo} ${
          goal && !candidate ? styles.emptyCargo : ""
        }`}
        style={{ transform: `translateY(${rightCargoShift}cqw)` }}
      >
        {shownRight.length > 0 ? (
          <CargoGroup
            expression={shownRight}
            differenceFrom={
              revealDifferences && !preserveInference ? expectedCount : undefined
            }
            hideDifferences={preserveInference}
            accentMap={accentMap}
          />
        ) : null}
        {goal && !candidate ? (
          <span className={styles.goalQuestion}>?</span>
        ) : null}
      </span>
    </div>
  );
}

function ProofToken({
  creature,
  accentMap,
}: {
  creature: BalanceToken;
  accentMap?: AccentMap;
}) {
  return creature === "mystery" ? (
    <MysteryLoad />
  ) : (
    <CreatureToken creature={creature} accent={accentMap?.[creature]} />
  );
}

function ProofTokenRun({
  creature,
  count,
  cancelled = false,
  highlighted = false,
  accentMap,
}: {
  creature: BalanceToken;
  count: number;
  cancelled?: boolean;
  highlighted?: boolean;
  accentMap?: AccentMap;
}) {
  if (count <= 0) return null;
  const shownCount = count > 3 ? 1 : count;
  return (
    <span
      className={`${styles.proofTokenRun} ${
        cancelled ? styles.proofTokenRunCancelled : ""
      } ${highlighted ? styles.proofTokenRunHighlighted : ""}`}
    >
      {count > 3 ? <span className={styles.proofCount}>{count}×</span> : null}
      {Array.from({ length: shownCount }, (_, tokenIndex) => (
        <ProofToken
          creature={creature}
          accentMap={accentMap}
          key={`${creature}-${tokenIndex}`}
        />
      ))}
      {cancelled ? <span className={styles.proofStrike} /> : null}
    </span>
  );
}

function ProofExpression({
  expression,
  cancellation,
  highlighted,
  accentMap,
}: {
  expression: readonly ProofTerm[];
  cancellation?: Readonly<Partial<Record<BalanceToken, number>>>;
  highlighted?: readonly BalanceToken[];
  accentMap?: AccentMap;
}) {
  const highlightedTokens = new Set(highlighted);
  const hasTerms = expression.some(({ count }) => count > 0);
  return (
    <span className={styles.proofExpression}>
      {hasTerms ? (
        expression.map((term, termIndex) => {
          const cancelledCount = Math.min(
            term.count,
            cancellation?.[term.creature] ?? 0,
          );
          return (
            <span className={styles.proofTerm} key={term.creature}>
              {termIndex > 0 ? (
                <span className={styles.proofPlus}>+</span>
              ) : null}
              <ProofTokenRun
                creature={term.creature}
                count={cancelledCount}
                cancelled
                accentMap={accentMap}
              />
              <ProofTokenRun
                creature={term.creature}
                count={term.count - cancelledCount}
                highlighted={highlightedTokens.has(term.creature)}
                accentMap={accentMap}
              />
            </span>
          );
        })
      ) : (
        <span className={styles.proofNothing}>0</span>
      )}
    </span>
  );
}

function ProofEquation({
  left,
  right,
  cancellation,
  highlightLeft,
  highlightRight,
  accentMap,
}: {
  left: readonly ProofTerm[];
  right: readonly ProofTerm[];
  cancellation?: Readonly<Partial<Record<BalanceToken, number>>>;
  highlightLeft?: readonly BalanceToken[];
  highlightRight?: readonly BalanceToken[];
  accentMap?: AccentMap;
}) {
  return (
    <span className={styles.proofEquation}>
      <ProofExpression
        expression={left}
        cancellation={cancellation}
        highlighted={highlightLeft}
        accentMap={accentMap}
      />
      <span className={styles.proofEquals}>=</span>
      <ProofExpression
        expression={right}
        cancellation={cancellation}
        highlighted={highlightRight}
        accentMap={accentMap}
      />
    </span>
  );
}

type TeachingSource = Extract<
  TeachingProofStep,
  { kind: "inspect" }
>["sources"][number];

type TeachingGroupedEquationValue = Extract<
  TeachingProofStep,
  { kind: "regroup" }
>["after"];

type ProofSceneStyle = CSSProperties & {
  "--proof-scene-delay": string;
  "--proof-scene-duration": string;
};

function isGroupedEquation(
  value: BalanceEquation | TeachingGroupedEquationValue,
): value is TeachingGroupedEquationValue {
  return "groupCount" in value;
}

function expressionPerCopy(
  expression: Expression,
  copies: number,
): Expression {
  if (
    copies <= 1 ||
    expression.some(({ count }) => count % copies !== 0)
  ) {
    return expression;
  }
  return expression.map(({ creature, count }) => ({
    creature,
    count: count / copies,
  }));
}

type ProofLoadTone =
  | "plain"
  | "match"
  | "replacement"
  | "move"
  | "guide"
  | "remove"
  | "bundle"
  | "keep"
  | "fade";

type ProofLoadGroup = {
  expression: Expression;
  tone?: ProofLoadTone;
  key?: string;
};

type ProofScaleTraveler = {
  groups: readonly ProofLoadGroup[];
  sourceSide: "left" | "right";
  targetSide: "left" | "right";
};

function subtractProofExpression(
  expression: Expression,
  removal: Expression,
): Expression {
  const remaining = new Map(
    expression.map(({ creature, count }) => [creature, count]),
  );
  for (const { creature, count } of removal) {
    const nextCount = (remaining.get(creature) ?? 0) - count;
    if (nextCount < 0) {
      throw new Error("A proof animation cannot remove an unseen load.");
    }
    remaining.set(creature, nextCount);
  }
  return expression.flatMap(({ creature }) => {
    const count = remaining.get(creature) ?? 0;
    return count > 0 ? [{ creature, count }] : [];
  });
}

function proofGroupsForCopies(
  expression: Expression,
  copies: number,
  tone: ProofLoadTone,
  key: string,
): readonly ProofLoadGroup[] {
  const copyExpression = expressionPerCopy(expression, copies);
  return Array.from({ length: Math.max(1, copies) }, (_, copyIndex) => ({
    expression: copyExpression,
    tone,
    key: `${key}-${copyIndex}`,
  }));
}

function proofGroupsAroundTarget(
  expression: Expression,
  target: Expression,
  copies: number,
  tone: ProofLoadTone,
  key: string,
): readonly ProofLoadGroup[] {
  const remainder = subtractProofExpression(expression, target);
  return [
    ...(remainder.length > 0
      ? [{ expression: remainder, tone: "plain" as const, key: `${key}-rest` }]
      : []),
    ...proofGroupsForCopies(target, copies, tone, key),
  ];
}

function sourceLabel(source: TeachingSource): string {
  return source.sourceIndex === null
    ? "What we just found"
    : `Scale ${source.sourceIndex + 1}`;
}

function ProofScaleLoadGroup({
  group,
  accentMap,
}: {
  group: ProofLoadGroup;
  accentMap?: AccentMap;
}) {
  if (group.expression.length === 0) return null;
  return (
    <span
      className={styles.proofScaleLoadGroup}
      data-proof-load-state={group.tone ?? "plain"}
    >
      <CargoGroup expression={group.expression} accentMap={accentMap} />
    </span>
  );
}

function ProofScalePan({
  side,
  groups,
  accentMap,
}: {
  side: "left" | "right";
  groups: readonly ProofLoadGroup[];
  accentMap?: AccentMap;
}) {
  return (
    <span
      className={`${styles.panCargo} ${
        side === "left" ? styles.leftCargo : styles.rightCargo
      } ${styles.proofScalePan}`}
      data-proof-pan={side}
    >
      <span className={styles.proofScalePanGroups}>
        {groups.map((group, groupIndex) => (
          <ProofScaleLoadGroup
            group={group}
            accentMap={accentMap}
            key={group.key ?? `${side}-${groupIndex}`}
          />
        ))}
      </span>
    </span>
  );
}

function ProofBalanceScale({
  equation,
  label,
  role,
  leftGroups,
  rightGroups,
  travelers = [],
  className = "",
  accentMap,
}: {
  equation: BalanceEquation;
  label: string;
  role: string;
  leftGroups?: readonly ProofLoadGroup[];
  rightGroups?: readonly ProofLoadGroup[];
  travelers?: readonly ProofScaleTraveler[];
  className?: string;
  accentMap?: AccentMap;
}) {
  const resolvedLeftGroups = leftGroups ?? [
    { expression: equation.left, tone: "plain" },
  ];
  const resolvedRightGroups = rightGroups ?? [
    { expression: equation.right, tone: "plain" },
  ];

  return (
    <figure
      className={`${styles.proofScaleFigure} ${className}`}
      data-proof-scale-role={role}
    >
      <figcaption>{label}</figcaption>
      <div className={`${styles.balanceScale} ${styles.proofBalanceScale}`}>
        <ScaleDrawing />
        <ProofScalePan
          side="left"
          groups={resolvedLeftGroups}
          accentMap={accentMap}
        />
        <ProofScalePan
          side="right"
          groups={resolvedRightGroups}
          accentMap={accentMap}
        />
        {travelers.flatMap((traveler, travelerIndex) =>
          traveler.groups.map((group, groupIndex) => (
            <span
              className={`${styles.panCargo} ${
                traveler.sourceSide === "left"
                  ? styles.leftCargo
                  : styles.rightCargo
              } ${styles.proofScaleTraveler}`}
              data-proof-motion="substitute-load"
              data-source-side={traveler.sourceSide}
              data-target-side={traveler.targetSide}
              key={`traveler-${travelerIndex}-${groupIndex}`}
            >
              <ProofScaleLoadGroup group={group} accentMap={accentMap} />
            </span>
          )),
        )}
      </div>
    </figure>
  );
}

function ProofCallouts({
  first,
  middle,
  last,
}: {
  first: string;
  middle?: string;
  last: string;
}) {
  return (
    <div
      className={styles.proofScaleCallouts}
      data-proof-callout="sequence"
      data-callout-count={middle ? "3" : "2"}
    >
      <p className={styles.proofScaleCalloutFirst}>
        <span aria-hidden="true">●</span>
        {first}
      </p>
      {middle ? (
        <p className={styles.proofScaleCalloutMiddle}>
          <span aria-hidden="true">→</span>
          {middle}
        </p>
      ) : null}
      <p className={styles.proofScaleCalloutLast}>
        <span aria-hidden="true">✓</span>
        {last}
      </p>
    </div>
  );
}

function InspectScaleScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "inspect" }>;
  accentMap?: AccentMap;
}) {
  return (
    <div className={styles.proofScaleScene} data-proof-motion="inspect-scales">
      <ProofCallouts
        first="Every scale is level."
        last="So each left tray weighs the same as its right tray."
      />
      <div className={styles.proofInspectScales}>
        {step.sources.map((source, sourceIndex) => (
          <ProofBalanceScale
            equation={source.equation}
            label={sourceLabel(source)}
            role="source"
            accentMap={accentMap}
            key={`${source.sourceIndex}-${sourceIndex}`}
          />
        ))}
      </div>
    </div>
  );
}

function SubstitutionScaleScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "substitute" }>;
  accentMap?: AccentMap;
}) {
  const { replacement } = step;
  const sourceLeftGroups: readonly ProofLoadGroup[] = [
    {
      expression: step.source.equation.left,
      tone: replacement.sourceFromSide === "left" ? "match" : "replacement",
      key: "source-left",
    },
  ];
  const sourceRightGroups: readonly ProofLoadGroup[] = [
    {
      expression: step.source.equation.right,
      tone: replacement.sourceFromSide === "right" ? "match" : "replacement",
      key: "source-right",
    },
  ];
  const beforeLeftGroups =
    replacement.side === "left"
      ? proofGroupsAroundTarget(
          step.before.left,
          replacement.from,
          replacement.copies,
          "match",
          "working-before-left",
        )
      : undefined;
  const beforeRightGroups =
    replacement.side === "right"
      ? proofGroupsAroundTarget(
          step.before.right,
          replacement.from,
          replacement.copies,
          "match",
          "working-before-right",
        )
      : undefined;
  const afterLeftGroups =
    replacement.side === "left"
      ? proofGroupsAroundTarget(
          step.after.left,
          replacement.to,
          replacement.copies,
          "replacement",
          "working-after-left",
        )
      : undefined;
  const afterRightGroups =
    replacement.side === "right"
      ? proofGroupsAroundTarget(
          step.after.right,
          replacement.to,
          replacement.copies,
          "replacement",
          "working-after-right",
        )
      : undefined;

  return (
    <div
      className={styles.proofScaleScene}
      data-proof-motion="substitution"
    >
      <ProofCallouts
        first="The violet load appears on both scales. The gold load has the same weight."
        middle="Watch the gold load float to the matching violet spot."
        last="Swap equal loads. The scale stays balanced!"
      />
      <div className={styles.proofSubstitutionScales}>
        <ProofBalanceScale
          equation={step.source.equation}
          label={sourceLabel(step.source)}
          role="substitution-source"
          leftGroups={sourceLeftGroups}
          rightGroups={sourceRightGroups}
          travelers={[
            {
              groups: proofGroupsForCopies(
                replacement.to,
                replacement.copies,
                "replacement",
                "substitution-traveler",
              ),
              sourceSide: replacement.sourceToSide,
              targetSide: replacement.side,
            },
          ]}
          accentMap={accentMap}
        />
        <div className={styles.proofMorphScale}>
          <ProofBalanceScale
            equation={step.before}
            label="Working scale"
            role="substitution-before"
            leftGroups={beforeLeftGroups}
            rightGroups={beforeRightGroups}
            className={styles.proofMorphBefore}
            accentMap={accentMap}
          />
          <ProofBalanceScale
            equation={step.after}
            label="After the equal swap"
            role="substitution-after"
            leftGroups={afterLeftGroups}
            rightGroups={afterRightGroups}
            className={styles.proofMorphAfter}
            accentMap={accentMap}
          />
        </div>
      </div>
      <span className={styles.proofEqualityKey} aria-hidden="true">
        <span className={styles.proofEqualityMatch}>same load</span>
        <span className={styles.proofEqualityReplacement}>equal weight</span>
      </span>
    </div>
  );
}

function AddScalesScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "add-scales" }>;
  accentMap?: AccentMap;
}) {
  const [receiving, joining] = step.before;
  const movingLeft = [{
    expression: joining.equation.left,
    tone: "move" as const,
    key: "joining-left",
  }];
  const movingRight = [{
    expression: joining.equation.right,
    tone: "move" as const,
    key: "joining-right",
  }];

  return (
    <div className={styles.proofScaleScene} data-proof-motion="add-scales">
      <ProofCallouts
        first="Both scales are balanced. Left joins left, and right joins right."
        middle="Both tray loads move together."
        last="One bigger scale. Still balanced!"
      />
      <div className={styles.proofOperationScales}>
        <div className={styles.proofMorphScale}>
          <ProofBalanceScale
            equation={receiving.equation}
            label={sourceLabel(receiving)}
            role="add-receiver"
            className={styles.proofMorphBefore}
            accentMap={accentMap}
          />
          <ProofBalanceScale
            equation={step.after}
            label="The joined scale"
            role="add-result"
            className={styles.proofMorphAfter}
            accentMap={accentMap}
          />
        </div>
        <ProofBalanceScale
          equation={joining.equation}
          label={sourceLabel(joining)}
          role="add-donor"
          leftGroups={movingLeft}
          rightGroups={movingRight}
          className={styles.proofDonorScale}
          accentMap={accentMap}
        />
        <span className={styles.proofSameChangeBadge} aria-hidden="true">
          + left &nbsp;&nbsp; + right
        </span>
      </div>
    </div>
  );
}

function SubtractScalesScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "subtract-scales" }>;
  accentMap?: AccentMap;
}) {
  const [working, guide] = step.before;
  const beforeLeftGroups: readonly ProofLoadGroup[] = [
    ...(step.after.left.length > 0
      ? [{ expression: step.after.left, tone: "plain" as const, key: "left-rest" }]
      : []),
    { expression: guide.equation.left, tone: "remove", key: "left-remove" },
  ];
  const beforeRightGroups: readonly ProofLoadGroup[] = [
    ...(step.after.right.length > 0
      ? [{ expression: step.after.right, tone: "plain" as const, key: "right-rest" }]
      : []),
    { expression: guide.equation.right, tone: "remove", key: "right-remove" },
  ];

  return (
    <div
      className={styles.proofScaleScene}
      data-proof-motion="subtract-scales"
    >
      <ProofCallouts
        first="Use the second balanced scale as a take-away guide."
        middle="Lift the matching load from both trays."
        last="Take left from left and right from right. What remains is balanced."
      />
      <div className={styles.proofOperationScales}>
        <div className={styles.proofMorphScale}>
          <ProofBalanceScale
            equation={working.equation}
            label={sourceLabel(working)}
            role="subtract-working"
            leftGroups={beforeLeftGroups}
            rightGroups={beforeRightGroups}
            className={styles.proofMorphBefore}
            accentMap={accentMap}
          />
          <ProofBalanceScale
            equation={step.after}
            label="What remains"
            role="subtract-result"
            className={styles.proofMorphAfter}
            accentMap={accentMap}
          />
        </div>
        <ProofBalanceScale
          equation={guide.equation}
          label={sourceLabel(guide)}
          role="subtract-guide"
          leftGroups={[{ expression: guide.equation.left, tone: "guide" }]}
          rightGroups={[{ expression: guide.equation.right, tone: "guide" }]}
          className={styles.proofGuideScale}
          accentMap={accentMap}
        />
      </div>
    </div>
  );
}

function CancelScaleScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "cancel-matches" }>;
  accentMap?: AccentMap;
}) {
  const beforeLeftGroups: readonly ProofLoadGroup[] = [
    ...(step.after.left.length > 0
      ? [{ expression: step.after.left, tone: "plain" as const, key: "left-rest" }]
      : []),
    { expression: step.removed, tone: "remove", key: "left-remove" },
  ];
  const beforeRightGroups: readonly ProofLoadGroup[] = [
    ...(step.after.right.length > 0
      ? [{ expression: step.after.right, tone: "plain" as const, key: "right-rest" }]
      : []),
    { expression: step.removed, tone: "remove", key: "right-remove" },
  ];

  return (
    <div
      className={styles.proofScaleScene}
      data-proof-motion="cancel-matches"
    >
      <ProofCallouts
        first="The coral circles show the same load on both trays."
        middle="Lift both circled loads at the same time."
        last="Take one matching load from each tray. Still balanced!"
      />
      <div className={`${styles.proofMorphScale} ${styles.proofSingleScaleMorph}`}>
        <ProofBalanceScale
          equation={step.before}
          label="Before"
          role="cancel-before"
          leftGroups={beforeLeftGroups}
          rightGroups={beforeRightGroups}
          className={styles.proofMorphBefore}
          accentMap={accentMap}
        />
        <ProofBalanceScale
          equation={step.after}
          label="After the matching loads leave"
          role="cancel-after"
          className={styles.proofMorphAfter}
          accentMap={accentMap}
        />
      </div>
    </div>
  );
}

function groupedProofLoads(
  bundle: Expression,
  groupCount: number,
  mode: "bundle" | "split",
  side: "left" | "right",
): readonly ProofLoadGroup[] {
  return Array.from({ length: groupCount }, (_, groupIndex) => ({
    expression: bundle,
    tone:
      mode === "bundle" ? "bundle" : groupIndex === 0 ? "keep" : "fade",
    key: `${side}-bundle-${groupIndex}`,
  }));
}

function RegroupScaleScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "regroup" }>;
  accentMap?: AccentMap;
}) {
  return (
    <div className={styles.proofScaleScene} data-proof-motion="regroup-combos">
      <ProofCallouts
        first={`Put the animals into ${step.after.groupCount} matching groups on each tray.`}
        middle="Now draw an oval around every combo."
        last="Each gold oval is one matching combo."
      />
      <div className={`${styles.proofMorphScale} ${styles.proofSingleScaleMorph}`}>
        <ProofBalanceScale
          equation={step.before}
          label="The same animals"
          role="regroup-before"
          className={styles.proofMorphBefore}
          accentMap={accentMap}
        />
        <ProofBalanceScale
          equation={step.before}
          label={`${step.after.groupCount} matching groups`}
          role="regroup-after"
          leftGroups={groupedProofLoads(
            step.after.leftBundle,
            step.after.groupCount,
            "bundle",
            "left",
          )}
          rightGroups={groupedProofLoads(
            step.after.rightBundle,
            step.after.groupCount,
            "bundle",
            "right",
          )}
          className={styles.proofMorphAfter}
          accentMap={accentMap}
        />
      </div>
    </div>
  );
}

function SplitScaleScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "split-evenly" }>;
  accentMap?: AccentMap;
}) {
  let grouped: TeachingGroupedEquationValue;
  let expandedEquation: BalanceEquation;
  if (isGroupedEquation(step.before)) {
    grouped = step.before;
    expandedEquation = {
      left: grouped.leftBundle.map(({ creature, count }) => ({
        creature,
        count: count * grouped.groupCount,
      })),
      right: grouped.rightBundle.map(({ creature, count }) => ({
        creature,
        count: count * grouped.groupCount,
      })),
    };
  } else {
    grouped = {
      groupCount: step.divisor,
      leftBundle: expressionPerCopy(step.before.left, step.divisor),
      rightBundle: expressionPerCopy(step.before.right, step.divisor),
    };
    expandedEquation = step.before;
  }

  return (
    <div className={styles.proofScaleScene} data-proof-motion="split-groups">
      <ProofCallouts
        first={`There are ${step.divisor} equal groups on each tray.`}
        middle={`Show ÷ ${step.divisor}, then let the extra groups fade away.`}
        last={`÷ ${step.divisor} means keep 1 group on each tray. It still balances!`}
      />
      <div className={`${styles.proofMorphScale} ${styles.proofSingleScaleMorph}`}>
        <ProofBalanceScale
          equation={expandedEquation}
          label={`${step.divisor} equal groups on each side`}
          role="split-grouped"
          leftGroups={groupedProofLoads(
            grouped.leftBundle,
            grouped.groupCount,
            "split",
            "left",
          )}
          rightGroups={groupedProofLoads(
            grouped.rightBundle,
            grouped.groupCount,
            "split",
            "right",
          )}
          className={`${styles.proofMorphBefore} ${styles.proofSplitGroupedScale}`}
          accentMap={accentMap}
        />
        <ProofBalanceScale
          equation={step.after}
          label="One group on each side"
          role="split-result"
          className={`${styles.proofMorphAfter} ${styles.proofSplitFinalScale}`}
          accentMap={accentMap}
        />
        <span className={styles.proofScaleDivideBadge} data-proof-motion="divide-sign">
          ÷ {step.divisor}
        </span>
      </div>
    </div>
  );
}

function ConclusionScaleScene({
  step,
  accentMap,
}: {
  step: Extract<TeachingProofStep, { kind: "conclude" }>;
  accentMap?: AccentMap;
}) {
  return (
    <div className={styles.proofScaleScene} data-proof-motion="conclusion">
      <div className={styles.proofFinalCallout}>
        <span aria-hidden="true">✓</span>
        Balanced! We found it.
      </div>
      <ProofBalanceScale
        equation={step.equation}
        label="The answer"
        role="conclusion"
        className={styles.proofConclusionScale}
        accentMap={accentMap}
      />
    </div>
  );
}

function TeachingProofSceneVisual({
  step,
  accentMap,
}: {
  step: TeachingProofStep;
  accentMap?: AccentMap;
}) {
  switch (step.kind) {
    case "inspect":
      return <InspectScaleScene step={step} accentMap={accentMap} />;
    case "substitute":
      return <SubstitutionScaleScene step={step} accentMap={accentMap} />;
    case "add-scales":
      return <AddScalesScene step={step} accentMap={accentMap} />;
    case "subtract-scales":
      return <SubtractScalesScene step={step} accentMap={accentMap} />;
    case "cancel-matches":
      return <CancelScaleScene step={step} accentMap={accentMap} />;
    case "regroup":
      return <RegroupScaleScene step={step} accentMap={accentMap} />;
    case "split-evenly":
      return <SplitScaleScene step={step} accentMap={accentMap} />;
    case "conclude":
      return <ConclusionScaleScene step={step} accentMap={accentMap} />;
  }
}

function TeachingProofSceneCard({
  step,
  stepIndex,
  stepCount,
  delayMs,
  durationMs,
  accentMap,
  storyboard = false,
}: {
  step: TeachingProofStep;
  stepIndex: number;
  stepCount: number;
  delayMs: number;
  durationMs: number;
  accentMap?: AccentMap;
  storyboard?: boolean;
}) {
  const sceneStyle: ProofSceneStyle = {
    "--proof-scene-delay": `${delayMs}ms`,
    "--proof-scene-duration": `${durationMs}ms`,
  };
  return (
    <article
      className={`${styles.proofTeachingScene} ${
        stepIndex === stepCount - 1 ? styles.proofTeachingSceneLast : ""
      } ${storyboard ? styles.proofStoryboardScene : ""}`}
      data-step-kind={step.kind}
      style={sceneStyle}
    >
      <header className={styles.proofSceneHeader}>
        <span className={styles.proofStepNumber}>
          {stepIndex + 1} / {stepCount}
        </span>
        <strong>{step.title}</strong>
        <span className={styles.proofStepDots} aria-hidden="true">
          {Array.from({ length: stepCount }, (_, dotIndex) => (
            <span
              className={dotIndex === stepIndex ? styles.proofStepDotActive : ""}
              key={dotIndex}
            />
          ))}
        </span>
      </header>
      <div className={styles.proofSceneBody}>
        <TeachingProofSceneVisual step={step} accentMap={accentMap} />
      </div>
      <p className={styles.proofSceneCaption}>{step.text}</p>
    </article>
  );
}

export function SolutionProofVisual({
  round,
  proofState,
  accentMap = buildRoundAccentMap(round),
}: {
  round: Round;
  proofState: Exclude<ProofState, "hidden">;
  accentMap?: AccentMap;
}) {
  const plan = buildTeachingProof(round);

  return (
    <section
      className={styles.solutionProof}
      data-proof-state={proofState}
      role="region"
      aria-label="Step-by-step balance proof"
    >
      <ol className={styles.proofAccessibleSteps}>
        {plan.steps.map((step) => (
          <li key={step.id}>{step.text}</li>
        ))}
      </ol>
      <div className={styles.proofSceneViewport} aria-hidden="true">
        {plan.steps.map((step, stepIndex) => (
          <TeachingProofSceneCard
            step={step}
            stepIndex={stepIndex}
            stepCount={plan.steps.length}
            delayMs={plan.timeline[stepIndex].delayMs}
            durationMs={plan.timeline[stepIndex].durationMs}
            accentMap={accentMap}
            key={step.id}
          />
        ))}
      </div>
      <div className={styles.proofStoryboard} aria-hidden="true">
        {plan.steps.map((step, stepIndex) => (
          <TeachingProofSceneCard
            step={step}
            stepIndex={stepIndex}
            stepCount={plan.steps.length}
            delayMs={0}
            durationMs={plan.timeline[stepIndex].durationMs}
            accentMap={accentMap}
            storyboard
            key={`story-${step.id}`}
          />
        ))}
      </div>
    </section>
  );
}

const LESSON_ACCENTS: AccentMap = {
  rabbit: 0,
  fox: 0,
  cat: 3,
  bear: 2,
  chick: 1,
  beetle: 1,
};

function lessonTerms(
  ...entries: readonly (readonly [BalanceToken, number])[]
): readonly ProofTerm[] {
  return entries.map(([creature, count]) => ({ creature, count }));
}

function LessonEquation({
  left,
  right,
  cancellation,
}: {
  left: readonly ProofTerm[];
  right: readonly ProofTerm[];
  cancellation?: Readonly<Partial<Record<BalanceToken, number>>>;
}) {
  return (
    <span className={styles.lessonEquation}>
      <ProofEquation
        left={left}
        right={right}
        cancellation={cancellation}
        accentMap={LESSON_ACCENTS}
      />
    </span>
  );
}

function LessonFlow({
  label,
  symbol,
}: {
  label: string;
  symbol: string;
}) {
  return (
    <span className={styles.lessonFlow}>
      <span className={styles.lessonFlowLine} />
      <span className={styles.lessonOperator}>{symbol}</span>
      <span className={styles.lessonFlowLabel}>{label}</span>
      <span className={styles.lessonFlowArrow}>→</span>
    </span>
  );
}

function SplitEvenlyLesson() {
  return (
    <>
      <div className={styles.lessonBefore}>
        <span className={styles.lessonStageLabel}>Before</span>
        <LessonEquation
          left={lessonTerms(["rabbit", 2])}
          right={lessonTerms(["chick", 4])}
        />
      </div>
      <LessonFlow label="Split both sides evenly" symbol="÷2" />
      <div className={styles.lessonAfter}>
        <span className={styles.lessonStageLabel}>Each half</span>
        <LessonEquation
          left={lessonTerms(["rabbit", 1])}
          right={lessonTerms(["chick", 2])}
        />
      </div>
    </>
  );
}

function CancelMatchesLesson() {
  const cancellation = { fox: 1 } as const;
  return (
    <>
      <div className={styles.lessonBefore}>
        <span className={styles.lessonStageLabel}>Same fox on both sides</span>
        <LessonEquation
          left={lessonTerms(["cat", 1], ["fox", 1])}
          right={lessonTerms(["fox", 1], ["chick", 3])}
          cancellation={cancellation}
        />
      </div>
      <LessonFlow label="Remove the same load" symbol="×" />
      <div className={styles.lessonAfter}>
        <span className={styles.lessonStageLabel}>Balance stays true</span>
        <LessonEquation
          left={lessonTerms(["cat", 1])}
          right={lessonTerms(["chick", 3])}
        />
      </div>
    </>
  );
}

function SubstitutionLesson() {
  return (
    <>
      <div className={`${styles.lessonBefore} ${styles.lessonSourceStack}`}>
        <span className={styles.lessonStageLabel}>Equal loads</span>
        <LessonEquation
          left={lessonTerms(["fox", 1])}
          right={lessonTerms(["chick", 2])}
        />
        <LessonEquation
          left={lessonTerms(["rabbit", 1])}
          right={lessonTerms(["fox", 2])}
        />
      </div>
      <LessonFlow label="Swap equal loads" symbol="⇄" />
      <div className={styles.lessonAfter}>
        <span className={styles.lessonStageLabel}>Foxes become chicks</span>
        <LessonEquation
          left={lessonTerms(["rabbit", 1])}
          right={lessonTerms(["chick", 4])}
        />
      </div>
    </>
  );
}

function AddScalesLesson() {
  return (
    <>
      <div className={`${styles.lessonBefore} ${styles.lessonSourceStack}`}>
        <span className={styles.lessonStageLabel}>Stack both balances</span>
        <LessonEquation
          left={lessonTerms(["cat", 2], ["bear", 1])}
          right={lessonTerms(["beetle", 6])}
        />
        <span className={styles.lessonInlineOperator}>+</span>
        <LessonEquation
          left={lessonTerms(["cat", 1], ["bear", 2])}
          right={lessonTerms(["beetle", 9])}
        />
      </div>
      <LessonFlow label="Add left to left, right to right" symbol="+" />
      <div className={styles.lessonAfter}>
        <span className={styles.lessonStageLabel}>One larger balance</span>
        <LessonEquation
          left={lessonTerms(["cat", 3], ["bear", 3])}
          right={lessonTerms(["beetle", 15])}
        />
      </div>
    </>
  );
}

function CreateComboLesson() {
  const combo = lessonTerms(["cat", 1], ["bear", 1]);
  return (
    <>
      <div className={styles.lessonBefore}>
        <span className={styles.lessonStageLabel}>Matching coefficients</span>
        <LessonEquation
          left={lessonTerms(["cat", 3], ["bear", 3])}
          right={lessonTerms(["beetle", 15])}
        />
      </div>
      <LessonFlow label="Circle identical combos" symbol="[ ]" />
      <div className={`${styles.lessonAfter} ${styles.lessonComboAfter}`}>
        <span className={styles.lessonStageLabel}>Three copies of cat + bear</span>
        <span className={styles.proofEquation}>
          <span className={styles.proofComboGroups}>
            {Array.from({ length: 3 }, (_, index) => (
              <span className={styles.proofComboGroup} key={index}>
                <ProofExpression expression={combo} accentMap={LESSON_ACCENTS} />
              </span>
            ))}
          </span>
          <span className={styles.proofEquals}>=</span>
          <ProofExpression
            expression={lessonTerms(["beetle", 15])}
            accentMap={LESSON_ACCENTS}
          />
        </span>
        <span className={styles.lessonMiniDivide}>÷3</span>
        <LessonEquation
          left={combo}
          right={lessonTerms(["beetle", 5])}
        />
      </div>
    </>
  );
}

function SubtractScalesLesson() {
  return (
    <>
      <div className={`${styles.lessonBefore} ${styles.lessonSourceStack}`}>
        <span className={styles.lessonStageLabel}>Line up both balances</span>
        <LessonEquation
          left={lessonTerms(["cat", 3], ["bear", 4])}
          right={lessonTerms(["beetle", 7])}
        />
        <span className={styles.lessonInlineOperator}>−</span>
        <LessonEquation
          left={lessonTerms(["cat", 1], ["bear", 2])}
          right={lessonTerms(["beetle", 3])}
        />
      </div>
      <LessonFlow label="Subtract matching columns" symbol="−" />
      <div className={styles.lessonAfter}>
        <span className={styles.lessonStageLabel}>What remains</span>
        <LessonEquation
          left={lessonTerms(["cat", 2], ["bear", 2])}
          right={lessonTerms(["beetle", 4])}
        />
      </div>
    </>
  );
}

const STRATEGY_LESSON_LABELS: Readonly<Record<StrategyId, string>> = {
  "split-evenly":
    "Two rabbits balance four chicks. Divide both sides by two. One rabbit balances two chicks.",
  "cancel-matches":
    "A fox appears on both sides of one balance. Cross out one fox from each side. The remaining cat balances three chicks.",
  substitution:
    "One fox balances two chicks, and one rabbit balances two foxes. Replace the foxes with equal chick loads. One rabbit balances four chicks.",
  "add-scales":
    "Add two balances, left side to left side and right side to right side, to make one larger true balance.",
  "create-combo":
    "Three cats and three bears regroup into three identical cat and bear combos. Divide both sides by three to find one combo.",
  "subtract-scales":
    "Subtract the second balance from the first, matching each animal column. The remaining loads still balance.",
};

function lessonForStrategy(strategy: StrategyId) {
  switch (strategy) {
    case "split-evenly":
      return <SplitEvenlyLesson />;
    case "cancel-matches":
      return <CancelMatchesLesson />;
    case "substitution":
      return <SubstitutionLesson />;
    case "add-scales":
      return <AddScalesLesson />;
    case "create-combo":
      return <CreateComboLesson />;
    case "subtract-scales":
      return <SubtractScalesLesson />;
  }
}

export function StrategyLessonVisual({
  strategy,
  replayKey = 0,
}: {
  strategy: StrategyId;
  replayKey?: string | number;
}) {
  return (
    <div
      className={styles.strategyLessonVisual}
      data-strategy={strategy}
      role="img"
      aria-label={STRATEGY_LESSON_LABELS[strategy]}
    >
      <div
        className={styles.strategyLessonTimeline}
        aria-hidden="true"
        key={replayKey}
      >
        {lessonForStrategy(strategy)}
      </div>
    </div>
  );
}

export function PuzzleVisual({
  round,
  candidate,
  outcome,
  teaching = false,
  proofState,
  revealDifferences = false,
}: {
  round: Round;
  candidate?: AnswerOption;
  outcome?: "correct" | "wrong";
  teaching?: boolean;
  proofState?: ProofState;
  revealDifferences?: boolean;
}) {
  const accentMap = buildRoundAccentMap(round);
  const resolvedProofState = proofState ?? (teaching ? "animating" : "hidden");

  return (
    <div
      className={`${styles.puzzleVisual} ${
        resolvedProofState !== "hidden" ? styles.teaching : ""
      }`}
      data-family={round.family}
      role={resolvedProofState === "hidden" ? "img" : "group"}
      aria-label={
        round.difficulty === "Wizard"
          ? "A visual balance puzzle with level picture scales and one unfinished scale. The same sealed load appears in two clues. Compare the pictured loads and choose the load that completes the unfinished scale."
          : "A visual balance puzzle with level picture scales and one unfinished scale. Compare the pictured loads and choose the load that completes it."
      }
    >
      <div
        className={`${styles.clueRail} ${
          round.scaffold === null ? styles.hiddenScaffold : ""
        }`}
        aria-hidden="true"
      >
        {(round.scaffold
          ? round.scaffold.equationOrder.map(
              (equationIndex) => round.equations[equationIndex],
            )
          : round.equations
        ).map((equation: BalanceEquation | undefined, equationIndex) =>
          equation ? (
          <div className={styles.clueScaleWrap} key={equationIndex}>
            <span className={styles.clueNode} />
            <BalanceScale
              left={equation.left}
              right={equation.right}
              accentMap={accentMap}
            />
          </div>
          ) : null,
        )}
      </div>
      {resolvedProofState !== "hidden" ? (
        <SolutionProofVisual
          round={round}
          proofState={resolvedProofState}
          accentMap={accentMap}
        />
      ) : null}
      <div className={styles.goalDivider} aria-hidden="true">
        <span />
      </div>
      <BalanceScale
        left={round.question.target}
        right={[]}
        goal
        candidate={candidate}
        expectedCount={round.answer}
        outcome={outcome}
        revealDifferences={revealDifferences}
        preserveInference={round.feedbackPolicy === "preserve-inference"}
        accentMap={accentMap}
      />
    </div>
  );
}

export function AnswerLoad({
  option,
  expectedCount,
  revealDifferences,
  accentMap,
}: {
  option: AnswerOption;
  expectedCount: number;
  revealDifferences: boolean;
  accentMap?: AccentMap;
}) {
  return (
    <span className={styles.answerLoad} aria-hidden="true">
      <CargoGroup
        expression={[{ creature: option.creature, count: option.count }]}
        differenceFrom={revealDifferences ? expectedCount : undefined}
        accentMap={accentMap}
      />
      <span className={styles.answerPanLip} />
    </span>
  );
}

export function ExampleVisual() {
  const rabbit: Expression = [{ creature: "rabbit", count: 1 }];
  const twoRabbits: Expression = [{ creature: "rabbit", count: 2 }];
  const twoChicks: Expression = [{ creature: "chick", count: 2 }];
  const threeChicks: Expression = [{ creature: "chick", count: 3 }];
  const fourChicks: Expression = [{ creature: "chick", count: 4 }];

  return (
    <div className={styles.exampleScales}>
      <BalanceScale left={rabbit} right={twoChicks} />
      <div className={styles.exampleResult}>
        <BalanceScale left={twoRabbits} right={fourChicks} outcome="correct" />
        <span className={styles.exampleCheck} aria-label="Correct">
          ✓
        </span>
      </div>
      <div className={styles.exampleNearMiss}>
        <BalanceScale
          left={twoRabbits}
          right={threeChicks}
          expectedCount={4}
          candidate={{ creature: "chick", count: 3, kind: "off-by-one" }}
          outcome="wrong"
        />
        <span className={styles.exampleCross} aria-label="Not balanced">
          ×
        </span>
      </div>
    </div>
  );
}
