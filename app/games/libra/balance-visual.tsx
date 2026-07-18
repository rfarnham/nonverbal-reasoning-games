"use client";

import type {
  AnswerOption,
  BalanceToken,
  BalanceEquation,
  Creature,
  Expression,
  Round,
} from "./game-engine";
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

export function PuzzleVisual({
  round,
  candidate,
  outcome,
  teaching = false,
  revealDifferences = false,
}: {
  round: Round;
  candidate?: AnswerOption;
  outcome?: "correct" | "wrong";
  teaching?: boolean;
  revealDifferences?: boolean;
}) {
  const accentMap = buildRoundAccentMap(round);

  return (
    <div
      className={`${styles.puzzleVisual} ${teaching ? styles.teaching : ""}`}
      data-family={round.family}
      role="img"
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
      {teaching ? (
        <div className={styles.strategyProof} aria-hidden="true">
          {round.solutionDerivation.equationMultipliers.map(
            (multiplier, equationIndex) => (
              <span
                className={
                  multiplier < 0
                    ? styles.strategyProofSubtract
                    : styles.strategyProofAdd
                }
                key={`${equationIndex}-${multiplier}`}
              >
                {equationIndex === 0
                  ? multiplier < 0
                    ? "− "
                    : ""
                  : multiplier < 0
                    ? "− "
                    : "+ "}
                {Math.abs(multiplier) > 1
                  ? `${Math.abs(multiplier)}× `
                  : ""}
                scale {equationIndex + 1}
              </span>
            ),
          )}
          {round.solutionDerivation.normalizeBy > 1 ? (
            <>
              <span className={styles.strategyProofArrow}>→</span>
              <span className={styles.strategyProofCombo}>
                {round.solutionDerivation.normalizeBy} matching groups
              </span>
              <span className={styles.strategyProofArrow}>→</span>
              <span className={styles.strategyProofDivide}>
                ÷ {round.solutionDerivation.normalizeBy}
              </span>
            </>
          ) : null}
        </div>
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
