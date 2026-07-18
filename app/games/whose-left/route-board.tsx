import type { CSSProperties } from "react";

import {
  namesForSequence,
  type AnswerSequence,
  type Person,
  type Round,
} from "./game-engine";
import styles from "./whose-left.module.css";

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const PERSON_COLOR_CLASSES = [
  styles.personCoral,
  styles.personGold,
  styles.personTeal,
  styles.personViolet,
] as const;

function personColorClass(person: Person): string {
  return PERSON_COLOR_CLASSES[person.segmentIndex % PERSON_COLOR_CLASSES.length];
}

function personForId(round: Pick<Round, "people">, id: string): Person {
  return (
    round.people.find((person) => person.id === id) ?? {
      id,
      name: id,
      initial: "?",
      segmentIndex: 0,
      position: { x: 0, y: 0 },
      side: "left",
    }
  );
}

function routePoints(round: Round): string {
  return round.route.points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function segmentAngle(round: Round, segmentIndex: number): number {
  const segment = round.route.segments[segmentIndex];
  if (!segment) return 0;
  return (
    (Math.atan2(
      segment.to.y - segment.from.y,
      segment.to.x - segment.from.x,
    ) *
      180) /
    Math.PI
  );
}

function segmentPosition(
  round: Round,
  segmentIndex: number,
  progress = 0.58,
) {
  const segment = round.route.segments[segmentIndex];
  if (!segment) return { x: 0, y: 0 };
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * progress,
    y: segment.from.y + (segment.to.y - segment.from.y) * progress,
  };
}

export function sequenceAccessibleLabel(
  round: Pick<Round, "people">,
  sequence: AnswerSequence,
): string {
  return namesForSequence(round, sequence).join(", then ");
}

export function Sequence({
  round,
  sequence,
  mismatchIndexes = [],
  compact = false,
}: {
  round: Pick<Round, "people">;
  sequence: AnswerSequence;
  mismatchIndexes?: readonly number[];
  compact?: boolean;
}) {
  const mismatches = new Set(mismatchIndexes);

  return (
    <span
      className={`${styles.sequence} ${compact ? styles.sequenceCompact : ""}`}
      aria-hidden="true"
    >
      {sequence.map((personId, index) => {
        const person = personForId(round, personId);
        return (
          <span className={styles.sequenceStep} key={`${personId}-${index}`}>
            {index > 0 ? (
              <span className={styles.sequenceArrow}>→</span>
            ) : null}
            <span
              className={`${styles.sequencePerson} ${personColorClass(person)} ${
                mismatches.has(index) ? styles.sequenceMismatch : ""
              }`}
            >
              <span className={styles.sequenceInitial}>{person.initial}</span>
              <span className={styles.sequenceName}>{person.name}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function RouteBoard({
  round,
  revealSide = false,
  animateTrace = false,
  compact = false,
  completed = false,
  className = "",
}: {
  round: Round;
  revealSide?: boolean;
  animateTrace?: boolean;
  compact?: boolean;
  completed?: boolean;
  className?: string;
}) {
  const pathPoints = routePoints(round);
  const targetOrder = new Map(
    round.correctSequence.map((personId, index) => [personId, index + 1]),
  );
  const finalPoint = round.route.points.at(-1) ?? round.route.points[0];
  const { minX, minY, width, height } = round.route.viewBox;
  const boardLabel = completed
    ? `Completed visual route from Start to Finish. The highlighted ${
        round.querySide
      } side passes ${namesForSequence(round, round.correctSequence).join(
        ", then ",
      )}.`
    : `Visual route from Start to Finish with ${round.people.length} people beside successive path sections. Track the walker's changing ${round.querySide}; the answer is intentionally not encoded in this description.`;

  return (
    <figure
      className={`${styles.routeFigure} ${compact ? styles.routeCompact : ""} ${
        revealSide ? styles.routeRevealed : ""
      } ${animateTrace ? styles.routeAnimating : ""} ${
        round.querySide === "left" ? styles.sideLeft : styles.sideRight
      } ${className}`}
    >
      <figcaption className={styles.routePrompt}>
        <span className={styles.sideIcon} aria-hidden="true">
          {round.querySide === "left" ? "←" : "→"}
        </span>
        <span>
          Find <strong>{round.querySide}</strong>
        </span>
      </figcaption>

      <svg
        className={styles.routeSvg}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        role="img"
        aria-label={boardLabel}
      >
        <polyline
          className={styles.routeUnderlay}
          points={pathPoints}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          className={styles.routeLine}
          points={pathPoints}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        {revealSide ? (
          <polyline
            className={styles.routeTrace}
            points={pathPoints}
            fill="none"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {round.scaffold.directionCueSegmentIndexes.map((segmentIndex) => {
          const position = segmentPosition(round, segmentIndex);
          return (
            <g
              className={styles.routeChevron}
              transform={`translate(${position.x} ${position.y}) rotate(${segmentAngle(
                round,
                segmentIndex,
              )})`}
              aria-hidden="true"
              key={`chevron-${segmentIndex}`}
            >
              <path d="M -1.35 -1.15 L 0 0 L -1.35 1.15" />
            </g>
          );
        })}

        {round.people.map((person) => {
          const segment = round.route.segments[person.segmentIndex];
          const midpoint = segmentPosition(round, person.segmentIndex, 0.5);
          const order = targetOrder.get(person.id);
          const isTarget = order !== undefined;
          const visitStyle = {
            "--visit-delay": `${Math.max(0, (order ?? 1) - 1) * 90}ms`,
          } as CustomProperties;

          return (
            <g
              className={isTarget ? styles.targetPerson : undefined}
              style={visitStyle}
              aria-hidden="true"
              key={person.id}
            >
              {isTarget && revealSide ? (
                <line
                  className={styles.sideLink}
                  x1={midpoint.x}
                  y1={midpoint.y}
                  x2={person.position.x}
                  y2={person.position.y}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <circle
                className={`${styles.personToken} ${personColorClass(person)}`}
                cx={person.position.x}
                cy={person.position.y}
                r={1.82}
                vectorEffect="non-scaling-stroke"
              />
              <text
                className={styles.personInitial}
                x={person.position.x}
                y={person.position.y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {person.initial}
              </text>
              {isTarget && revealSide ? (
                <g className={styles.visitBadge}>
                  <circle
                    cx={person.position.x + 1.65}
                    cy={person.position.y - 1.65}
                    r={0.92}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={person.position.x + 1.65}
                    y={person.position.y - 1.65}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {order}
                  </text>
                </g>
              ) : null}
              {!segment ? null : (
                <title>{`${person.name}, beside route section ${
                  person.segmentIndex + 1
                }`}</title>
              )}
            </g>
          );
        })}

        <g className={styles.endpoint} aria-hidden="true">
          <circle
            cx={round.route.points[0].x}
            cy={round.route.points[0].y}
            r={1.55}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={round.route.points[0].x}
            y={round.route.points[0].y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            S
          </text>
        </g>
        <g className={`${styles.endpoint} ${styles.finishEndpoint}`} aria-hidden="true">
          <circle
            cx={finalPoint.x}
            cy={finalPoint.y}
            r={1.55}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={finalPoint.x}
            y={finalPoint.y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            F
          </text>
        </g>
      </svg>

      <div className={styles.endpointKey} aria-hidden="true">
        <span><b>S</b> Start</span>
        <span><b>F</b> Finish</span>
        {!round.scaffold.showIntermediateChevrons ? (
          <span className={styles.singleCueNote}>One direction cue</span>
        ) : null}
      </div>
    </figure>
  );
}
